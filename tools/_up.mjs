Promise.all([import("../js/physics/flightModel.js"), import("../js/physics/specs.js"), import("../js/modes/index.js"), import("../js/config.js"), import("../js/game/state.js")]).then(([fm, sp, m, c, st]) => {
  m.setMode("frenetic");
  const base = st.getUpgradeMods ? st.getUpgradeMods() : null;
  // Mods maximos: alas 8, peso 6, aero 8.
  const maxMods = { liftMult: 1 + 8 * 0.10, dragMult: Math.max(0.55, 1 - 8 * 0.06), massMult: Math.max(0.6, 1 - 6 * 0.07), hullStr: 1 + 6 * 0.30, launchPowerMult: 1 + 8 * 0.09 };
  console.log("  mods iniciales: " + JSON.stringify(base));
  console.log("  mods maximos:   " + JSON.stringify(maxMods));
  for (const id of ["paper"]) {
    const spec = sp.getSpec(id);
    for (const [nombre, mods] of [["sin mejoras", {}], ["al maximo", maxMods]]) {
      const p = fm.paramsFromSpec(spec, mods);
      console.log("\n  " + id + " " + nombre + ":");
      console.log("    control=" + p.control.toFixed(2) + "  cl=" + p.cl.toFixed(5) + "  cd=" + p.cd.toFixed(5) + "  liftCap=" + p.liftCap.toFixed(1));
      // Respuesta lateral.
      const s = fm.createState(20);
      fm.addGlideBudget(s, 60, 60);
      s.vx = 25; s.vy = 0; s.vz = 0;
      fm.setControls(s, 1, 0);
      let t90 = null; const objetivo = c.FLIGHT_CONTROLS.LATERAL_MAX * 0.9;
      for (let i = 0; i < 120 * 3; i++) {
        fm.step(s, p, 1 / 120);
        if (t90 === null && Math.abs(s.lateralVel) >= objetivo) t90 = i / 120;
      }
      console.log("    lateral: 90% del tope en " + (t90 === null ? "-" : t90.toFixed(3)) + "s");
      // Respuesta de morro.
      const s2 = fm.createState(20);
      fm.addGlideBudget(s2, 60, 60);
      s2.vx = 25; s2.vy = 0; s2.vz = 0;
      for (let i = 0; i < 60; i++) { fm.setControls(s2, 0, 0); fm.step(s2, p, 1 / 120); }
      const vy0 = s2.vy;
      fm.setControls(s2, 0, 1);
      for (let i = 0; i < 30; i++) fm.step(s2, p, 1 / 120);
      console.log("    morro arriba 0.25s: vy " + vy0.toFixed(2) + " -> " + s2.vy.toFixed(2) + "  (delta " + (s2.vy - vy0).toFixed(2) + " m/s)");
    }
  }
});
