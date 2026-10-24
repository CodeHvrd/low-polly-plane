import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const PORT = 9761;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "pc-shot-"));
const browser = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",
  ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run",
   "--no-default-browser-check", "--use-gl=angle", "--use-angle=swiftshader",
   "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch {} await sleep(250); }
const t = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res) => ws.addEventListener("open", res, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
};
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: "http://127.0.0.1:8765/index.html" });
await sleep(8000);
await ev(`
  const G = window.__papercrash;
  G.controller.forceIdle(); G.controller.launch();
  await new Promise(r => setTimeout(r, 500));
  // Una flecha apretada para ver el estado activo.
  return true;`);
await sleep(500);
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync("tools/_dpad.png", Buffer.from(shot.result.data, "base64"));
console.log("  captura guardada");
browser.kill(); await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);
