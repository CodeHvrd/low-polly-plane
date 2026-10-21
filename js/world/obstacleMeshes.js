/**
 * PAPERCRASH — world/obstacleMeshes.js
 * ============================================================
 * Representación visual de los obstáculos definidos en `obstacles.js`.
 *
 * Se usa un Group con un mesh por obstáculo (en vez de instancing) porque
 * la cantidad es baja (~20) y así cada pieza conserva su color y su
 * rotación propias sin añadir complejidad. Todo se libera en `dispose()`.
 * ============================================================
 */
import { scene } from '../core/engine.js';
import { createRng } from '../core/math.js';

/** @type {Array<{geometry?:object, material?:object}>} */
const disposables = [];
let group = null;

function rockMaterials() {
  return [
    new THREE.MeshLambertMaterial({ color: 0x4a4038, flatShading: true }),
    new THREE.MeshLambertMaterial({ color: 0x3d3a30, flatShading: true }),
    new THREE.MeshLambertMaterial({ color: 0x554c40, flatShading: true }),
    new THREE.MeshLambertMaterial({ color: 0x33383c, flatShading: true }),
  ];
}

function track(obj) {
  disposables.push(obj);
  return obj;
}

/** Tinte por vértice: oscurece la base y aclara la cima. */
function applyVerticalGradient(geo, baseColor, height) {
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color(baseColor);
  for (let i = 0; i < pos.count; i++) {
    // La geometría está centrada en su origen: y va de -height/2 a +height/2.
    const t = (pos.getY(i) + height / 2) / height;
    const v = 0.72 + t * 0.5;
    colors[i * 3] = Math.min(1, c.r * v);
    colors[i * 3 + 1] = Math.min(1, c.g * v);
    colors[i * 3 + 2] = Math.min(1, c.b * v);
  }
  geo.deleteAttribute('uv');
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
}

function buildSpire(ob, rng, materials) {
  const { height, sides, rotation } = ob.params;
  const radius = Math.max(ob.params.halfX, ob.params.halfZ) * rng.range(0.85, 1.1);
  const geo = new THREE.CylinderGeometry(radius * rng.range(0.35, 0.6), radius, height, sides, 1);
  const mat = materials[rng.int(0, materials.length - 1)];
  applyVerticalGradient(geo, mat.color.getHex(), height);
  const mesh = new THREE.Mesh(geo, mat);
  // El cilindro está centrado: se apoya sobre el suelo.
  mesh.position.set(ob.x, ob.groundY + height / 2, ob.z);
  mesh.rotation.y = rotation;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildMesa(ob, rng, materials) {
  const { height, halfX, halfZ, sides, rotation } = ob.params;
  // Tronco de cono invertido: base ancha, cima más angosta = meseta.
  const geo = new THREE.CylinderGeometry(Math.min(halfX, halfZ) * 0.72, Math.max(halfX, halfZ), height, sides, 1);
  const mat = materials[rng.int(0, materials.length - 1)];
  applyVerticalGradient(geo, mat.color.getHex(), height);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(ob.x, ob.groundY + height / 2, ob.z);
  mesh.rotation.y = rotation;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Árbol: tronco fino y copa de cono.
 *
 * ── Por qué esta forma ──
 * La copa es lo que colisiona (ver `buildTree`), así que el dibujo tiene que
 * hacer evidente hasta dónde llega: un cono con la base a la altura de la copa
 * se lee de un vistazo, y su punta dice "esto se esquiva de costado".
 *
 * El tronco se dibuja más fino que la copa a propósito: si el tronco tuviera el
 * mismo ancho que la caja de colisión, el jugador vería un error cada vez que
 * pasa raspando.
 */
function buildTree(ob, rng, materials) {
  const { height, halfX, halfZ, sides } = ob.params;
  const pieces = [];

  // Tronco: del suelo a un tercio de la altura.
  const trunkH = height * 0.34;
  const trunkGeo = new THREE.CylinderGeometry(halfX * 0.28, halfX * 0.4, trunkH, 5, 1);
  const trunkMat = materials[0];
  applyVerticalGradient(trunkGeo, 0x3a2a1e, trunkH);
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.set(ob.x, ob.groundY + trunkH / 2, ob.z);
  trunk.castShadow = true;
  pieces.push(trunk);

  /*
   * Copa: dos conos superpuestos.
   *
   * El de abajo tiene la base EXACTAMENTE en la caja de colisión (halfX/halfZ),
   * así que lo que se ve es lo que se choca. El de arriba es decorativo y más
   * angosto, para que la silueta no sea un simple triángulo.
   */
  const crownH = height - trunkH;
  const crownGeo = new THREE.ConeGeometry(Math.max(halfX, halfZ) * 1.05, crownH * 0.72, sides, 1);
  applyVerticalGradient(crownGeo, 0x2f5a2a, crownH);
  const crown = new THREE.Mesh(crownGeo, materials[1] ?? materials[0]);
  crown.position.set(ob.x, ob.groundY + trunkH + (crownH * 0.72) / 2, ob.z);
  crown.rotation.y = rng.range(0, Math.PI);
  crown.castShadow = true;
  pieces.push(crown);

  const topGeo = new THREE.ConeGeometry(Math.max(halfX, halfZ) * 0.62, crownH * 0.5, sides, 1);
  applyVerticalGradient(topGeo, 0x3d7038, crownH);
  const top = new THREE.Mesh(topGeo, materials[1] ?? materials[0]);
  top.position.set(ob.x, ob.groundY + height - (crownH * 0.5) / 2, ob.z);
  top.rotation.y = rng.range(0, Math.PI);
  pieces.push(top);

  const group = new THREE.Group();
  group.add(...pieces);
  return group;
}

/**
 * Barrera: un segmento del muro.
 *
 * Cada segmento es una caja que ocupa EXACTAMENTE su caja de colisión. La
 * barrera completa son varios segmentos apilados con huecos entre ellos, y los
 * huecos se marcan con un borde encendido: el jugador tiene que VER la salida,
 * no deducirla de un espacio vacío contra el cielo.
 */
/**
 * Roca: un poliedro irregular.
 *
 * Se aplasta y se gira para que no se lea como una esfera: una piedra redonda
 * parecería un adorno, y el jugador tiene que ver de un vistazo que es un
 * obstáculo duro.
 */
function buildRock(ob, rng, materials) {
  const { radius, height, sides, rotation } = ob.params;
  const geo = new THREE.DodecahedronGeometry(radius, 0);
  // Aplastado y estirado: silueta de piedra, no de pelota.
  geo.scale(1, height / (radius * 2), rng.range(0.8, 1.1));
  const mat = materials[rng.int(0, materials.length - 1)];
  applyVerticalGradient(geo, mat.color.getHex(), height);
  const mesh = new THREE.Mesh(geo, mat);
  // Las rocas se hunden un poco: apoyadas de plano se verían flotando.
  mesh.position.set(ob.x, ob.groundY + height * 0.35, ob.z);
  mesh.rotation.set(rng.range(-0.2, 0.2), rotation, rng.range(-0.2, 0.2));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  void sides;
  return mesh;
}

/**
 * Tronco caído: un cilindro inclinado con un extremo en el suelo.
 *
 * La inclinación es la que da la lectura de "árbol semi caído" y, sobre todo, la
 * que deja un lado bajo por el que se puede pasar por arriba: el tronco no es
 * una barrera pareja, tiene un lado fácil y uno difícil.
 */
function buildLog(ob, rng, materials) {
  const { radio, largo, inclinacion } = ob.params;
  const piezas = [];

  const geo = new THREE.CylinderGeometry(radio, radio * 1.15, largo, 7, 1);
  applyVerticalGradient(geo, 0x4a3524, largo);
  const mat = materials[0];
  const tronco = new THREE.Mesh(geo, mat);
  // El cilindro nace vertical: se acuesta sobre el eje Z y se inclina.
  tronco.rotation.set(Math.PI / 2 - inclinacion, 0, 0);
  tronco.position.set(ob.x, ob.groundY + Math.sin(inclinacion) * largo * 0.5 + radio, ob.z);
  tronco.castShadow = true;
  piezas.push(tronco);

  /*
   * Raíces en el extremo bajo: es lo que ancla visualmente el tronco al suelo.
   * Sin ellas el cilindro parece flotar apoyado en un punto.
   */
  const raiz = new THREE.Mesh(
    new THREE.DodecahedronGeometry(radio * 2.1, 0),
    materials[1] ?? materials[0],
  );
  raiz.position.set(ob.x, ob.groundY + radio * 0.7, ob.z - largo / 2 + radio);
  raiz.scale.set(1, 0.7, 1);
  raiz.rotation.y = rng.range(0, Math.PI);
  raiz.castShadow = true;
  piezas.push(raiz);

  const group = new THREE.Group();
  group.add(...piezas);
  return group;
}

function buildBarrierObsoleto(ob, rng, materials) {
  const { height, halfZ, depth } = ob.params;

  const geo = new THREE.BoxGeometry(depth, height, halfZ * 2);
  const mat = materials[Math.min(1, materials.length - 1)];
  applyVerticalGradient(geo, mat.color.getHex(), height);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(ob.x, ob.params.baseY + height / 2, ob.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  /*
   * Marcas verticales: sin ellas el muro es una pared lisa y el jugador no tiene
   * referencia de velocidad al acercarse. Son parte de la lectura, no adorno.
   */
  const marks = new THREE.Group();
  const markGeo = new THREE.BoxGeometry(depth * 1.02, 1.1, halfZ * 2 * 1.01);
  const markMat = new THREE.MeshBasicMaterial({
    color: 0xff8a1f,
    transparent: true,
    opacity: 0.5,
  });
  const count = Math.max(1, Math.floor(height / 6));
  for (let i = 1; i <= count; i++) {
    const mark = new THREE.Mesh(markGeo, markMat);
    mark.position.set(ob.x, ob.params.baseY + (height * i) / (count + 1), ob.z);
    marks.add(mark);
  }
  disposables.push({ geometry: markGeo, material: markMat });

  const wrapper = new THREE.Group();
  wrapper.add(mesh, marks);
  void rng;
  return wrapper;
}

function buildRing(ob) {
  const { innerRadius, tube, centerY, rotationY } = ob.params;
  const pieces = [];

  const geo = new THREE.TorusGeometry(innerRadius, tube, 8, 24);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x00e5ff,
    emissive: 0x0088aa,
    roughness: 0.35,
    metalness: 0.6,
    flatShading: true,
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.position.set(ob.x, centerY, ob.z);
  // El aro mira a lo largo de +X para que el avión lo atraviese de frente.
  ring.rotation.y = Math.PI / 2 + rotationY;
  ring.castShadow = true;
  pieces.push(ring);

  // Halo tenue para que el aro se lea a distancia contra el cielo oscuro.
  const haloGeo = new THREE.TorusGeometry(innerRadius, tube * 1.9, 6, 20);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.copy(ring.position);
  halo.rotation.copy(ring.rotation);
  pieces.push(halo);

  const g = new THREE.Group();
  for (const p of pieces) g.add(p);
  return g;
}

/**
 * Construye la malla de todos los obstáculos.
 * @param {import('./obstacles.js').Obstacle[]} obstacles
 */
export function buildObstacleMeshes(obstacles) {
  disposeObstacleMeshes();

  /*
   * Los VENDAVALES no tienen malla: son una zona física, no un objeto sólido.
   *
   * Se filtran antes de construir para no intentar generar geometría con sus
   * parámetros, que producía NaN en la bounding sphere y ensuciaba la consola.
   *
   * TODO: darles una columna translúcida visible para que el jugador los vea.
   */
  /*
   * Los VENDAVALES se dibujan aparte, con su propia malla.
   *
   * Antes se filtraban y quedaban invisibles, lo que hacia la mecanica inusable:
   * el avion subia solo sin que se entendiera por que.
   */
  const vendavales = obstacles.filter((o) => o.type === 'updraft');
  obstacles = obstacles.filter((o) => o.type !== 'updraft');

  const rng = createRng(777);
  const materials = rockMaterials();
  materials.forEach(track);
  group = new THREE.Group();
  group.name = 'obstacles';

  for (const ob of obstacles) {
    const mesh = ob.type === 'spire'
      ? buildSpire(ob, rng, materials)
      : ob.type === 'mesa'
        ? buildMesa(ob, rng, materials)
        : ob.type === 'tree'
          ? buildTree(ob, rng, materials)
          : ob.type === 'rock'
            ? buildRock(ob, rng, materials)
            : ob.type === 'log'
              ? buildLog(ob, rng, materials)
              : buildRing(ob);
    mesh.name = `obstacle-${ob.type}-${ob.id}`;
    group.add(mesh);
  }

  scene.add(group);
  track(group);

  // Libera las geometrías creadas para cada obstáculo.
  group.traverse((child) => {
    if (child.geometry) disposables.push(child);
  });

  /*
   * ── Columnas de VENDAVAL ──
   *
   * Cilindros translucidos que se aclaran hacia arriba. Marcan DONDE esta la
   * corriente y hasta que altura llega, que es lo que faltaba para poder usarla.
   *
   * depthWrite desactivado: no ocluyen el corredor. DoubleSide: se ven desde
   * adentro cuando el avion entra en la columna.
   */
  for (const u of vendavales) {
    const radio = u.params?.radius ?? 7;
    const alto = u.params?.height ?? 40;
    const base = u.params?.baseY ?? 0;
    const geo = new THREE.CylinderGeometry(radio * 0.85, radio, alto, 10, 1, true);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x8ef2ff,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
      flatShading: true,
    });
    const malla = new THREE.Mesh(geo, mat);
    malla.position.set(u.x, base + alto / 2, u.z);
    malla.renderOrder = 2;
    track(malla);
    group.add(malla);
  }

  return group;
}

/** Marca un aro como atravesado (cambia su color a verde). */
export function markRingPassed(obstacle) {
  if (!group || obstacle.type !== 'ring') return;
  group.traverse((child) => {
    if (child.name !== `obstacle-ring-${obstacle.id}`) return;
    child.traverse((piece) => {
      if (piece.material && piece.material.emissive) {
        piece.material.emissive.setHex(0x00aa44);
        piece.material.color.setHex(0x66ff99);
      }
    });
  });
}

/** Restaura el color original de todos los aros. */
export function resetRingVisuals() {
  if (!group) return;
  group.traverse((child) => {
    if (!child.name.startsWith('obstacle-ring-')) return;
    child.traverse((piece) => {
      if (piece.material && piece.material.emissive) {
        piece.material.emissive.setHex(0x0088aa);
        piece.material.color.setHex(0x00e5ff);
      }
    });
  });
}

export function setObstacleMeshesVisible(visible) {
  if (group) group.visible = visible;
}

export function disposeObstacleMeshes() {
  // Se recorre de atrás hacia adelante y se deduplica para no liberar dos
  // veces la misma geometría (los materiales son compartidos).
  const seen = new Set();
  for (let i = disposables.length - 1; i >= 0; i--) {
    const item = disposables[i];
    if (seen.has(item)) continue;
    seen.add(item);
    item.traverse?.((child) => {
      child.geometry?.dispose?.();
    });
    item.geometry?.dispose?.();
    if (item.isMaterial) item.dispose();
    else if (Array.isArray(item.material)) item.material.forEach((m) => m.dispose?.());
    else item.material?.dispose?.();
    if (item.parent) item.parent.remove(item);
  }
  disposables.length = 0;
  if (group && group.parent) group.parent.remove(group);
  group = null;
}
