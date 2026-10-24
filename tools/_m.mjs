import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const PORT = 9760;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "pc-ps-"));
const browser = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",
  ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run",
   "--no-default-browser-check", "--use-gl=angle", "--use-angle=swiftshader",
   "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch {} await sleep(250); }
const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res) => ws.addEventListener("open", res, { once: true }));
let id = 0; const pending = new Map(); const errs = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") errs.push((m.params.exceptionDetails.exception?.description || "").split("\n")[0]); });
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, returnByValue: true, awaitPromise: true });
  return r.result?.exceptionDetails ? { E: r.result.exceptionDetails.exception?.description?.split("\n")[0] } : r.result?.result?.value;
};
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: "http://127.0.0.1:8765/index.html" });
await sleep(8000);
// Mostrar los mandos y medir.
await ev(`
  const G = window.__papercrash;
  G.controller.forceIdle(); G.controller.launch();
  await new Promise(r => setTimeout(r, 400));
  return true;`);
console.log("  " + JSON.stringify(await ev(`
  const dpad = document.querySelector('.touch-dpad');
  const boost = document.getElementById('touch-thrust');
  const up = document.getElementById('touch-up');
  const rd = dpad.getBoundingClientRect();
  const rb = boost.getBoundingClientRect();
  const ru = up.getBoundingClientRect();
  const eu = getComputedStyle(up);
  return {
    dpad: Math.round(rd.width) + 'x' + Math.round(rd.height),
    cadaFlecha: Math.round(ru.width) + 'x' + Math.round(ru.height),
    fondo: eu.backgroundImage.slice(0, 42),
    radioEsquina: eu.borderTopLeftRadius,
    solapaBoost: rd.right > rb.left,
    cabeEnPantalla: rd.right < innerWidth && rd.bottom < innerHeight,
  };`), null, 1));
console.log("  errores: " + (errs.length ? errs.slice(0,2).join(" | ") : "ninguno"));
browser.kill(); await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
