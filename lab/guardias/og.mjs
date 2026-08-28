/* Saca la imagen de anuncio (og:image) de una portada.
 *
 *   node og.mjs <url> <salida.png>
 *   ffmpeg -i <salida.png> -vf scale=1200:630 -q:v 3 og-v5.jpg
 *
 * Existe aparte de `mirar.mjs` por dos cosas que aquel no hace: encuadra a
 * 1600x840 —la proporcion de la tarjeta de anuncio, 1.905, no la de la
 * pantalla— y ESPERA a que el titular tenga una palabra completa. El titular
 * de v5 se teclea solo letra por letra, asi que una captura al azar cae a
 * media palabra casi la mitad de las veces, y «Hacemos portaf|» en la tarjeta
 * que le llega a un prospecto por WhatsApp parece un sitio roto.
 *
 * De paso congela el parpadeo del cursor de texto: apagado a medio ciclo
 * tambien parece un error. */
import { spawn } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const [url, salida] = process.argv.slice(2);
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(ws) {
    this.ws = ws; this.n = 0; this.p = new Map(); this.o = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.p.has(m.id)) {
        const { ok, mal } = this.p.get(m.id); this.p.delete(m.id);
        m.error ? mal(new Error(m.error.message)) : ok(m.result);
      } else if (m.method) (this.o.get(m.method) || []).forEach((f) => f(m.params));
    });
  }
  al(m, f) { if (!this.o.has(m)) this.o.set(m, []); this.o.get(m).push(f); }
  enviar(me, pa = {}, si) {
    const id = ++this.n;
    return new Promise((ok, mal) => { this.p.set(id, { ok, mal });
      this.ws.send(JSON.stringify(si ? { id, method: me, params: pa, sessionId: si } : { id, method: me, params: pa })); });
  }
}
async function traer(u, n = 80) {
  for (let i = 0; i < n; i++) { try { const r = await fetch(u); if (r.ok) return await r.json(); } catch (_) {} await dormir(250); }
  throw new Error('sin puerto');
}

const perfil = join(tmpdir(), 'nerv-og-' + process.pid);
const puerto = 9500 + (process.pid % 400);
const nav = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + puerto,
  '--user-data-dir=' + perfil, '--no-first-run', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--disable-lcd-text',
  '--window-size=1600,840', 'about:blank'], { stdio: 'ignore' });

let ws;
try {
  const v = await traer('http://127.0.0.1:' + puerto + '/json/version');
  ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((ok, mal) => { ws.addEventListener('open', ok); ws.addEventListener('error', mal); });
  const cdp = new Cdp(ws);
  const { targetId } = await cdp.enviar('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.enviar('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => cdp.enviar(m, p, sessionId);
  await s('Page.enable'); await s('Runtime.enable');
  await s('Emulation.setDeviceMetricsOverride', { width: 1600, height: 840, deviceScaleFactor: 1, mobile: false });
  await s('Page.navigate', { url });
  await new Promise((ok) => cdp.al('Page.loadEventFired', ok));

  const ev = async (x) => (await s('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.value;

  const PALABRAS = ['sitios','apps','tiendas','portafolios','paneles','catálogos','reservas','menús','landings','agentes'];
  let ok = false;
  for (let i = 0; i < 240; i++) {
    const w = await ev("(()=>{const h=document.querySelector('#dc-root h1');if(!h)return null;" +
      "const c=[...h.querySelectorAll('span')].map(s=>s.textContent.trim());return c.join('|')})()");
    if (w && PALABRAS.some((p) => ('|' + w + '|').includes('|' + p + '|'))) { ok = true; break; }
    await dormir(150);
  }
  if (!ok) throw new Error('el titular nunca enseno una palabra completa');
  // El cursor de texto parpadea: se congela apagado para que no salga a medias.
  await ev("(()=>{document.querySelectorAll('*').forEach(e=>{" +
    "if(getComputedStyle(e).animationName==='blink')e.style.animation='none';});})()");
  await dormir(120);

  const tiro = await s('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await writeFile(salida, Buffer.from(tiro.data, 'base64'));
  console.log('listo: ' + salida);
} finally {
  try { ws && ws.close(); } catch (_) {}
  nav.kill(); await dormir(400);
  await rm(perfil, { recursive: true, force: true }).catch(() => {});
}
