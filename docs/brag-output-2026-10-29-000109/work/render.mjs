// Minimal CDP frame renderer: node render.mjs <out-dir> <fps> <duration> [t1,t2,... stills]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [outDir, fpsArg = '30', durArg = '22.5', stillsArg] = process.argv.slice(2);
const fps = +fpsArg, dur = +durArg;
const workers = +(process.env.WORKERS || 6);
mkdirSync(outDir, { recursive: true });
const chrome = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const port = 9400 + Math.floor(Math.random() * 400);
const proc = spawn(chrome, [`--remote-debugging-port=${port}`, '--allow-file-access-from-files', '--hide-scrollbars', '--force-color-profile=srgb', '--font-render-hinting=none', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });

async function json(path, method = 'GET') {
  for (let i = 0; i < 50; i++) {
    try { return await (await fetch(`http://127.0.0.1:${port}${path}`, { method })).json(); } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  throw new Error('chrome did not start');
}
function client(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); } };
  const open = new Promise(r => ws.onopen = r);
  return { open, send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }) };
}
async function page() {
  const tgt = await json('/json/new?about:blank', 'PUT');
  const c = client(tgt.webSocketDebuggerUrl); await c.open;
  await c.send('Page.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await c.send('Page.navigate', { url: 'file://' + resolve(here, 'index.html') });
  for (let i = 0; i < 100; i++) {
    const r = await c.send('Runtime.evaluate', { expression: 'window.ready ? window.ready.then(()=>true) : false', awaitPromise: true, returnByValue: true }).catch(() => ({ result: {} }));
    if (r.result?.value === true) break;
    await new Promise(r => setTimeout(r, 100));
  }
  return c;
}
async function shot(c, t, file) {
  await c.send('Runtime.evaluate', { expression: `render(${t})`, returnByValue: true });
  await c.send('Runtime.evaluate', { expression: 'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(1))))', awaitPromise: true });
  const { data } = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(file, Buffer.from(data, 'base64'));
}

await json('/json/version');
if (stillsArg) {
  const c = await page();
  for (const t of stillsArg.split(',')) await shot(c, +t, `${outDir}/still-${(+t).toFixed(2)}.png`);
} else {
  const n = Math.round(fps * dur);
  const pages = await Promise.all(Array.from({ length: workers }, page));
  let next = 0;
  await Promise.all(pages.map(async c => {
    while (next < n) { const f = next++; await shot(c, f / fps, `${outDir}/f${String(f).padStart(5, '0')}.png`); if (f % 60 === 0) console.log('frame', f, '/', n); }
  }));
}
proc.kill();
process.exit(0);
