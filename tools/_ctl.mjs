Promise.all([import("../js/physics/flightModel.js"), import("../js/physics/specs.js"), import("../js/modes/index.js"), import("../js/config.js"), import("../js/game/state.js")]).then(([fm, sp, m, c, st]) => {
  m.setMode("frenetic");
  console.log("  autoridad de los mandos (control):");
  for (const id of ["paper", "jet", "heli", "passenger"]) {
    const spec = sp.getSpec(id);
    const sin = fm.paramsFromSpec(spec, {}).control;
    const conEstab = fm.paramsFromSpec(spec, { stabilityMult: 2.5 }).control;
    console.log("    " + id.padEnd(10) + " sin mejoras " + sin.toFixed(2) + "   con estabilizadores al max " + conEstab.toFixed(2));
  }
  console.log("\n  techo: " + c.FLIGHT_CONTROLS.CONTROL_MAX + " (asintota), rodilla " + c.FLIGHT_CONTROLS.CONTROL_KNEE);
});
