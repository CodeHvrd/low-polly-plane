/**
 * PAPERCRASH — game/replay.js
 * ============================================================
 * Arquitectura Anti-Trampas por Replay Determinista.
 *
 * ── Cómo funciona ──
 * 1. El cliente NO envía "mi distancia es 8.500 m" como verdad absoluta.
 * 2. Durante el vuelo, `InputRecorder` registra el seed, la configuración de la
 *    nave/mejoras, el ángulo/potencia de lanzamiento y un stream comprimido por
 *    delta de las entradas del jugador (`steer`, `nose`, `thrust` por tick).
 * 3. El servidor (Node.js / Edge Worker) ejecuta `verifyReplay()` de forma
 *    100% headless (sin Three.js ni DOM) con el motor físico determinista.
 * 4. Si la distancia, monedas o aros re-simulados no coinciden con lo reclamado
 *    dentro de la tolerancia, el envío al ranking se rechaza por manipulación.
 * ============================================================
 */

import { ECONOMY, LAUNCH_POS, SIM, WORLD, OBSTACLES, PICKUPS, PROPULSION, STAGES } from '../config.js';
import { clamp, round, createRng } from '../core/math.js';
import {
  addGlideBudget,
  applyBoost,
  setControls,
  createState,
  velocityFromAim,
  paramsFromSpec,
  step as stepFlight,
} from '../physics/flightModel.js';
import { getSpec } from '../physics/specs.js';
import { modsFromLevels } from './state.js';
import { groundHeightAt, setTerrainAmplitudeProvider } from '../world/terrainField.js';
import {
  generateCourse,
  findCollision,
  findNearMiss,
  findRingsPassed,
  setCourseAltitudeProvider,
} from '../world/obstacles.js';
import { generatePickups, collectAt, setAltitudeProvider } from '../world/collectibles.js';
import { buildProfile, desiredAltitudeAt, valueAt } from './flightProfile.js';

const PLANE_RADIUS = 0.7;
const HARD_LANDING_VY = 4.2;

/**
 * Grabador compacto de entradas por delta (RLE de controles).
 * Un vuelo completo de varios minutos suele pesar menos de 2-3 KB en JSON.
 */
export class InputRecorder {
  constructor() {
    this.reset();
  }

  /**
   * @param {object} [launchMeta]
   */
  reset(launchMeta = null) {
    this.launch = launchMeta ? { ...launchMeta } : null;
    this.lastSteer = 0;
    this.lastNose = 0;
    /** @type {Array<[number, number, number]>} [tick, steer, nose] */
    this.events = [];
    /** @type {number[]} ticks donde se activó propulsión */
    this.thrusts = [];
  }

  /**
   * Registra los controles solo cuando cambian (delta-encoding).
   * @param {number} tick
   * @param {number} steer
   * @param {number} nose
   */
  recordControls(tick, steer, nose) {
    const s = Math.round((steer ?? 0) * 100) / 100;
    const n = Math.round((nose ?? 0) * 100) / 100;
    if (s !== this.lastSteer || n !== this.lastNose) {
      this.events.push([tick, s, n]);
      this.lastSteer = s;
      this.lastNose = n;
    }
  }

  /**
   * Registra una activación exitosa de propulsión en el tick exacto.
   * @param {number} tick
   */
  recordThrust(tick) {
    this.thrusts.push(tick);
  }

  /** Exporta el payload comprimido de replay. */
  export() {
    return {
      v: 1,
      launch: this.launch,
      events: this.events.slice(),
      thrusts: this.thrusts.slice(),
    };
  }
}

/**
 * Re-simula de forma headless un vuelo completo a partir de su replay y
 * verifica que el resultado reclamado sea físicamente auténtico.
 *
 * @param {object} params
 * @param {number} params.seed         Semilla de recolectables/viento
 * @param {string} params.ship         ID de la aeronave
 * @param {Record<string,number>} params.upgrades Niveles de mejora
 * @param {object} params.replay       Payload generado por `InputRecorder.export()`
 * @param {object} [params.claimed]    Resultado reclamado a validar
 * @param {number} [params.toleranceMeters=2] Tolerancia máxima en metros
 * @returns {{verified:boolean, reason:string, simulated:object, deltaDistance:number, deltaCoins:number}}
 */
export function verifyReplay({
  seed = 0,
  ship = 'paper',
  upgrades = {},
  replay,
  claimed = null,
  toleranceMeters = 2,
}) {
  if (!replay || !replay.launch) {
    return {
      verified: false,
      reason: 'MISSING_REPLAY_DATA',
      simulated: null,
      deltaDistance: Infinity,
      deltaCoins: Infinity,
    };
  }

  const { pitchDeg, azimuthDeg, power01 } = replay.launch;
  if (
    typeof pitchDeg !== 'number' ||
    typeof azimuthDeg !== 'number' ||
    typeof power01 !== 'number' ||
    !Number.isFinite(pitchDeg) ||
    !Number.isFinite(azimuthDeg) ||
    !Number.isFinite(power01)
  ) {
    return {
      verified: false,
      reason: 'INVALID_LAUNCH_PARAMS',
      simulated: null,
      deltaDistance: Infinity,
      deltaCoins: Infinity,
    };
  }

  // Clamp de seguridad en el lanzamiento (anti-hack de potencia > 100%)
  const safePower = clamp(power01, 0, 1);
  const spec = getSpec(ship);
  const mods = modsFromLevels(upgrades);
  const params = paramsFromSpec(spec, mods);

  // Inicializar perfil de vuelo y proveedores puros (igual que Game.buildWorld)
  const profile = buildProfile({
    stageCount: Math.max(1, Math.ceil(WORLD.COURSE_LENGTH / STAGES.SEGMENT_LENGTH)),
    segmentLength: STAGES.SEGMENT_LENGTH,
    courseLength: WORLD.COURSE_LENGTH,
    heightGrowth: STAGES.HEIGHT_GROWTH,
    groundAmplitude: STAGES.GROUND_AMPLITUDE,
  });
  setTerrainAmplitudeProvider((x) => valueAt(profile, x, 'amplitude', 1));
  setAltitudeProvider((x, terrainY = 0) => desiredAltitudeAt(profile, x, WORLD.COURSE_LENGTH, terrainY));
  setCourseAltitudeProvider((x, groundY = 0) => desiredAltitudeAt(profile, x, WORLD.COURSE_LENGTH, groundY));

  const speed = (spec.baseSpeed + safePower * spec.speedRange) * mods.launchPowerMult;
  const vel = { x: 0, y: 0, z: 0 };
  velocityFromAim(pitchDeg, azimuthDeg, speed, vel);
  const s = createState(LAUNCH_POS.y);
  s.x = LAUNCH_POS.x;
  s.y = LAUNCH_POS.y;
  s.z = LAUNCH_POS.z;
  s.vx = vel.x;
  s.vy = vel.y;
  s.vz = vel.z;
  s.maxAltitude = LAUNCH_POS.y;
  s.maxSpeed = speed;
  s.landed = false;

  addGlideBudget(s, PROPULSION.BASE_GLIDE, PROPULSION.GLIDE_MAX);

  // Viento determinista a partir de la semilla
  const windRng = createRng((seed >>> 0) ^ 0x9e3779b9);
  const wind = {
    x: (windRng.next() - 0.5) * 1.6,
    z: (windRng.next() - 0.5) * 1.8,
    timer: 0,
    nextChange: 3 + windRng.next() * 4,
  };

  // Ventana inicial de obstáculos y recolectables
  const seg = STAGES.SEGMENT_LENGTH;
  let chunkCenter = 0;
  const buildWindow = (centro) => {
    const desde = Math.max(
      OBSTACLES.CLEAR_RUNWAY - seg,
      (centro - STAGES.CHUNKS_BEHIND) * seg,
    );
    const hasta = (centro + STAGES.CHUNKS_AHEAD + 1) * seg;
    const obs = generateCourse({ from: desde, to: hasta, startId: centro * 1000 });
    const pks = generatePickups(obs, PICKUPS.SEED + seed, desde, hasta);
    return { obs, pks };
  };

  let { obs: obstacles, pks: pickups } = buildWindow(0);

  let charges = 0;
  let thrustCooldown = 0;
  let fuel = PROPULSION.FUEL_MAX;
  let thrustsUsed = 0;
  let bounces = 0;

  const stats = {
    distance: 0,
    distanceZ: 0,
    maxAltitude: LAUNCH_POS.y,
    maxSpeed: speed,
    launchSpeed: speed,
    time: 0,
    rings: 0,
    ringCombos: 0,
    coins: 0,
    coinsCollected: 0,
    boosters: 0,
    nearMisses: 0,
  };

  const events = Array.isArray(replay.events) ? replay.events : [];
  const thrusts = Array.isArray(replay.thrusts) ? replay.thrusts : [];
  let evIdx = 0;
  let thIdx = 0;

  let tick = 0;
  const maxTicks = Math.ceil(SIM.MAX_FLIGHT_TIME / SIM.FIXED_DT) + 120;

  while (tick < maxTicks && !s.landed) {
    // 1. Aplicar entradas de control grabadas para este tick
    while (evIdx < events.length && events[evIdx][0] <= tick) {
      const [, steer, nose] = events[evIdx];
      setControls(s, clamp(steer, -1, 1), clamp(nose, -1, 1));
      evIdx++;
    }

    // 2. Aplicar propulsión si fue solicitada en este tick y es válida
    while (thIdx < thrusts.length && thrusts[thIdx] <= tick) {
      if (thrusts[thIdx] === tick && charges > 0 && thrustCooldown <= 0) {
        const cfg = PROPULSION;
        const accel = stats.launchSpeed * cfg.THRUST;
        const climbKick = s.nose > 0 ? cfg.CLIMB_KICK * s.nose : 0;
        if (cfg.FUEL_COST > 0 && fuel < cfg.FUEL_COST) fuel = cfg.FUEL_COST;
        applyBoost(s, accel, cfg.BURN_TIME, climbKick);
        addGlideBudget(s, cfg.GLIDE_BONUS, cfg.GLIDE_MAX);
        charges--;
        thrustsUsed++;
        thrustCooldown = cfg.COOLDOWN;

        const curSpd = Math.hypot(s.vx, s.vy, s.vz);
        if (curSpd > cfg.MAX_SPEED) {
          const factor = cfg.MAX_SPEED / curSpd;
          s.vx *= factor;
          s.vy *= factor;
          s.vz *= factor;
        }
        fuel = Math.max(0, fuel - cfg.FUEL_COST);
      }
      thIdx++;
    }

    // 3. Avance fijo de viento, enfriamiento y combustible
    if (thrustCooldown > 0) thrustCooldown = Math.max(0, thrustCooldown - SIM.FIXED_DT);
    if (fuel > 0) fuel = Math.max(0, fuel - SIM.FIXED_DT);

    wind.timer += SIM.FIXED_DT;
    if (wind.timer >= wind.nextChange) {
      wind.timer = 0;
      wind.nextChange = 3 + windRng.next() * 4;
      wind.x = clamp(wind.x + (windRng.next() - 0.5) * 1.4, -3.5, 3.5);
      wind.z = clamp(wind.z + (windRng.next() - 0.5) * 1.6, -4, 4);
    }
    params.windX = wind.x;
    params.windZ = wind.z;

    const prevX = s.x;
    stepFlight(s, params, SIM.FIXED_DT);

    const spd = Math.hypot(s.vx, s.vy, s.vz);
    if (spd > stats.maxSpeed) stats.maxSpeed = spd;
    stats.time += SIM.FIXED_DT;
    stats.distance = s.x;
    stats.distanceZ = s.z;
    if (s.y > stats.maxAltitude) stats.maxAltitude = s.y;

    // 4. Actualizar ventana de chunks si cruzó de tramo
    const centro = Math.floor(s.x / seg);
    if (centro !== chunkCenter) {
      chunkCenter = centro;
      const win = buildWindow(centro);
      obstacles = win.obs;
      pickups = win.pks;
    }

    // 5. Aros
    const passed = findRingsPassed(obstacles, prevX, s.x, s.y, s.z, PLANE_RADIUS);
    for (const _ob of passed) {
      stats.rings++;
      const combo = PICKUPS.BOOSTERS.RING_COMBO;
      if (stats.rings % combo.EVERY === 0) {
        applyBoost(s, stats.launchSpeed * combo.SPEED_FRACTION, combo.BURN_TIME, 0);
        const cSpd = Math.hypot(s.vx, s.vy, s.vz);
        if (cSpd > combo.MAX_SPEED) {
          const k = combo.MAX_SPEED / cSpd;
          s.vx *= k;
          s.vy *= k;
          s.vz *= k;
        }
        addGlideBudget(s, combo.GLIDE_BONUS, PROPULSION.GLIDE_MAX);
        stats.ringCombos++;
      }
    }

    // 6. Vendavales
    for (const u of obstacles) {
      if (u.type !== 'updraft') continue;
      const r = u.params?.radius ?? 7;
      if (Math.abs(s.x - u.x) > r || Math.abs(s.z - u.z) > r) continue;
      const alto = u.params?.height ?? 40;
      const base = u.params?.baseY ?? 0;
      if (s.y > base + alto) continue;

      if (s.vy < PICKUPS.UPDRAFT.LIFT_MAX) {
        s.vy = Math.min(PICKUPS.UPDRAFT.LIFT_MAX, s.vy + PICKUPS.UPDRAFT.LIFT * SIM.FIXED_DT);
      }
      if (!u._empujado) {
        u._empujado = true;
        applyBoost(s, stats.launchSpeed * PICKUPS.UPDRAFT.SPEED_BONUS, 0, 0);
        addGlideBudget(s, PROPULSION.BASE_GLIDE * 0.3, PROPULSION.GLIDE_MAX);
      }
    }

    // 7. Colisiones
    const hit = findCollision(obstacles, s.x, s.y, s.z, PLANE_RADIUS);
    if (hit) {
      s.landed = true;
      break;
    }

    // 8. Near Miss
    const near = findNearMiss(obstacles, s.x, s.y, s.z, PLANE_RADIUS);
    if (near) {
      near._nearMissed = true;
      stats.nearMisses++;
      stats.coins += 15;
      stats.coinsCollected++;
    }

    // 9. Recolectables
    const picked = collectAt(pickups, s.x, s.y, s.z);
    if (picked) {
      if (picked.kind === 'coin') {
        stats.coins += picked.value;
        stats.coinsCollected++;
      } else {
        stats.boosters++;
        const bKind = picked.boosterKind ?? 'charge';
        if (bKind === 'instant') {
          applyBoost(s, stats.launchSpeed * PICKUPS.BOOSTERS.SPEED_FRACTION, PICKUPS.BOOSTERS.BURN_TIME, 0);
          const curSpd = Math.hypot(s.vx, s.vy, s.vz);
          if (curSpd > PICKUPS.BOOSTERS.MAX_SPEED) {
            const k = PICKUPS.BOOSTERS.MAX_SPEED / curSpd;
            s.vx *= k;
            s.vy *= k;
            s.vz *= k;
          }
          addGlideBudget(s, PROPULSION.GLIDE_BONUS, PROPULSION.GLIDE_MAX);
          fuel = Math.min(PROPULSION.FUEL_MAX, fuel + PROPULSION.FUEL_REFILL);
        } else {
          const gain = bKind === 'super' ? 2 : 1;
          charges = Math.min(PROPULSION.MAX_CHARGES, charges + gain);
          addGlideBudget(s, PROPULSION.GLIDE_BONUS * gain, PROPULSION.GLIDE_MAX);
          fuel = Math.min(PROPULSION.FUEL_MAX, fuel + PROPULSION.FUEL_REFILL * gain);
        }
      }
    }

    // 10. Límite de corredor lateral
    if (Math.abs(s.z) > WORLD.CORRIDOR_HALF_WIDTH) {
      s.landed = true;
      break;
    }

    // 11. Suelo y rebotes
    const groundY = groundHeightAt(s.x, s.z);
    if (s.y <= groundY + 0.12) {
      const vertical = Math.abs(s.vy);
      const canBounce =
        mods.bounceMult > 0 &&
        bounces < Math.floor(mods.bounceMult * 8) &&
        vertical > 1.5;

      if (canBounce) {
        bounces++;
        s.y = groundY + 0.12;
        s.vy = vertical * (0.35 + mods.bounceMult);
        s.vx *= 0.88;
      } else {
        s.y = groundY + 0.12;
        s.landed = true;
        break;
      }
    }

    if (stats.time > SIM.MAX_FLIGHT_TIME) {
      s.landed = true;
      break;
    }

    tick++;
  }

  const dist = Math.max(0, Math.round(stats.distance));
  const altitudeGain = Math.max(0, stats.maxAltitude - LAUNCH_POS.y);
  const performance = Math.max(
    1,
    Math.floor(
      dist * ECONOMY.COIN_PER_METER +
        altitudeGain * ECONOMY.COIN_PER_ALTITUDE +
        stats.maxSpeed * ECONOMY.COIN_PER_SPEED +
        stats.time * ECONOMY.COIN_PER_SECOND +
        stats.rings * ECONOMY.COIN_PER_RING,
    ),
  );
  const totalCoins = performance + stats.coins;

  const simulated = {
    distance: dist,
    coins: totalCoins,
    rings: stats.rings,
    boosters: stats.boosters,
    nearMisses: stats.nearMisses,
    time: round(stats.time, 1),
    maxSpeed: round(stats.maxSpeed, 1),
    thrustsUsed,
  };

  if (!claimed) {
    return {
      verified: true,
      reason: 'OK',
      simulated,
      deltaDistance: 0,
      deltaCoins: 0,
    };
  }

  const deltaDistance = Math.abs(simulated.distance - (claimed.distance ?? 0));
  const deltaCoins = Math.abs(simulated.coins - (claimed.coins ?? 0));
  const ringsMatch = simulated.rings === (claimed.rings ?? simulated.rings);

  if (deltaDistance > toleranceMeters) {
    return {
      verified: false,
      reason: `DISTANCE_MISMATCH (claimed=${claimed.distance}, sim=${simulated.distance})`,
      simulated,
      deltaDistance,
      deltaCoins,
    };
  }

  if (deltaCoins > 25) {
    return {
      verified: false,
      reason: `COINS_MISMATCH (claimed=${claimed.coins}, sim=${simulated.coins})`,
      simulated,
      deltaDistance,
      deltaCoins,
    };
  }

  if (!ringsMatch) {
    return {
      verified: false,
      reason: `RINGS_MISMATCH (claimed=${claimed.rings}, sim=${simulated.rings})`,
      simulated,
      deltaDistance,
      deltaCoins,
    };
  }

  return {
    verified: true,
    reason: 'OK',
    simulated,
    deltaDistance,
    deltaCoins,
  };
}
