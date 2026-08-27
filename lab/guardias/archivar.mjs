/* Respaldo VISUAL de una página: capturas de página completa en varios estados.
 * Git guarda el código; esto guarda cómo se veía.
 *
 *   node archivar.mjs <url> <carpeta-destino>
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const [url, destino] = process.argv.slice(2);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(ws) { this.ws = ws; this.n = 0; this.pend = new Map(); this.oyentes = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pend.has(m.id)) {
        const { ok, mal } = this.pend.get(m.id); this.pend.delete(m.id);
        m.error ? mal(new Error(m.error.message)) : ok(m.result);
      } else if (m.method) (this.oyentes.get(m.method) || []).forEach((f) => f(m.params));
    });
  }
  al(m, f) { if (!this.oyentes.has(m)) this.oyentes.set(m, []); this.oyentes.get(m).push(f); }
  enviar(method, params = {}, sessionId) {
    const id = ++this.n;
    return new Promise((ok, mal) => { this.pend.set(id, { ok, mal });
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params })); });
  }
}
async function traer(u, n = 60) {
  for (let i = 0; i < n; i++) { try { const r = await fetch(u); if (r.ok) return await r.json(); } catch (_) {} await dormir(250); }
  throw new Error('el navegador no abrió su puerto');
}

/* Los estados que de verdad cambian la cara del sitio. `piel.js` guarda el modo
   en sessionStorage y el idioma en localStorage, así que se fijan antes de
   cargar y la página nace ya en ese estado — no hay que pulsar nada. */
const ESTADOS = [
  { id: 'hoja-insignia', w: 1600, h: 900, idioma: 'es', modo: 'claro' },
];

const perfil = join(tmpdir(), 'nerv-archivo-' + process.pid);
const puerto = 9000 + (process.pid % 900);
await mkdir(destino, { recursive: true });

const navegador = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + puerto,
  '--user-data-dir=' + perfil, '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--force-device-scale-factor=1',
  '--use-gl=angle', '--use-angle=swiftshader', 'about:blank'], { stdio: 'ignore' });

let ws;
try {
  const v = await traer(`http://127.0.0.1:${puerto}/json/version`);
  ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((ok, mal) => { ws.addEventListener('open', ok); ws.addEventListener('error', mal); });
  const cdp = new Cdp(ws);

  for (const e of ESTADOS) {
    const { targetId } = await cdp.enviar('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.enviar('Target.attachToTarget', { targetId, flatten: true });
    const s = (m, p) => cdp.enviar(m, p, sessionId);
    await s('Page.enable'); await s('Runtime.enable');
    await s('Emulation.setDeviceMetricsOverride', { width: e.w, height: e.h, deviceScaleFactor: 1, mobile: e.w < 700 });
    await s('Page.addScriptToEvaluateOnNewDocument', {
      source: `try { localStorage.setItem('dp-lang', ${JSON.stringify(e.idioma)});
                     sessionStorage.setItem('nerv:piel', JSON.stringify({modo:${JSON.stringify(e.modo)}})); } catch (x) {}`,
    });
    await s('Page.navigate', { url });
    await new Promise((ok) => cdp.al('Page.loadEventFired', ok));
    await dormir(6000);   // fuentes, arte del flanco, primeras revelaciones
    /* Todo lo que espera animación se fuerza al estado final: el respaldo debe
       enseñar la página LEÍDA, no a medio revelar. Es la regla 3 de la casa
       —nada invisible esperando animación— aplicada al archivo. */
    await s('Runtime.evaluate', { expression: `(() => {
      const e = document.createElement('style');
      e.textContent = '*,*::before,*::after{animation:none !important;transition:none !important}';
      document.head.appendChild(e);
      document.querySelectorAll('[style*="opacity"]').forEach(n => {
        if (parseFloat(getComputedStyle(n).opacity) < 0.05) n.style.opacity = '1';
      });
      return true; })()`, returnByValue: true });
    await dormir(700);
    const m = await s('Page.getLayoutMetrics');
    const alto = Math.min(Math.ceil(m.cssContentSize.height), 26000);
    const tiro = await s('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: e.w, height: alto, scale: 1 },
    });
    await writeFile(join(destino, e.id + '.png'), Buffer.from(tiro.data, 'base64'));
    console.log(`  ${e.id}.png  ${e.w}x${alto}`);
    await cdp.enviar('Target.closeTarget', { targetId });
  }
  console.log('archivo visual completo en ' + destino);
} finally {
  try { ws && ws.close(); } catch (_) {}
  navegador.kill(); await dormir(500);
  await rm(perfil, { recursive: true, force: true }).catch(() => {});
}
