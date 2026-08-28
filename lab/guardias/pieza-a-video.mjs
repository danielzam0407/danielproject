/* Graba una pieza de Claude Design como MP4, cuadro por cuadro.
 *
 *   node pieza-a-video.mjs <url> <salida.mp4> [fps]
 *
 * Por que existe: las dos piezas de la seccion de trabajo de /v5 son
 * composiciones de 1920x1080 dibujadas en React. Servirlas vivas en la portada
 * cuesta, POR PIEZA, 654 KB de Babel + 92 KB de JSX compilados en el navegador
 * + medio mega de DOM, y encima compiten por el hilo principal con el resto de
 * la pagina. Y son peliculas: OM_SCENES las declara como una lista de tomas y
 * OM_PLAYBACK dice `loop`. Un MP4 ensena exactamente los mismos pixeles, lo
 * decodifica la GPU y no toca el hilo principal.
 *
 * Como se graba determinista: `animations-v3.jsx` publica un contrato de
 * exportacion. El <svg> raiz lleva `data-om-exportable-video-with-duration-secs`
 * y escucha `data-om-seek-to-time-frame`. Con `detail.sync === true` el
 * componente aplica el salto dentro de `ReactDOM.flushSync`, asi que al volver
 * de `dispatchEvent` el DOM YA es el de ese instante -- no hay que esperar
 * cuadros ni adivinar. Se avisa poniendo `data-om-sync-seek` en el mismo nodo:
 * si el atributo no esta, este script se espera un refresco por cuadro.
 *
 * Los JPEG no tocan el disco: van por tuberia a ffmpeg. Grabar Novatek entero
 * en PNG serian ~400 MB de temporales para tirarlos al minuto siguiente.
 */
import { spawn } from 'node:child_process';
import { rm, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const [url, salida, fpsArg] = process.argv.slice(2);
const FPS = Number(fpsArg) || 30;
if (!url || !salida) { console.error('uso: pieza-a-video.mjs <url> <salida.mp4> [fps]'); process.exit(2); }

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
  /* Plazo por llamada, y muerte del navegador tratada como fallo.

     Sin esto, si el navegador se cae a mitad de la grabacion la promesa no se
     resuelve NUNCA: el script se queda parado, sin gastar CPU y sin decir una
     palabra, y por fuera parece que sigue trabajando. Paso de verdad --Edge se
     murio en el cuadro 1321 de 1575 de Novatek, que es la pieza mas pesada--
     y costo un rato darse cuenta de que el contador llevaba diez minutos
     quieto. Ningun cuadro tarda 60 s, ni con el dibujado por software. */
  romper(e) {
    const pend = [...this.p.values()];
    this.p.clear();
    pend.forEach((x) => x.mal(e));
  }
  enviar(me, pa = {}, si) {
    const id = ++this.n;
    return new Promise((ok, mal) => {
      const t = setTimeout(() => {
        if (this.p.delete(id)) mal(new Error('el navegador no contesto a ' + me + ' en 60 s'));
      }, 60000);
      this.p.set(id, { ok: (v) => { clearTimeout(t); ok(v); },
                      mal: (v) => { clearTimeout(t); mal(v); } });
      this.ws.send(JSON.stringify(si ? { id, method: me, params: pa, sessionId: si } : { id, method: me, params: pa }));
    });
  }
}
async function traer(u, n = 80) {
  for (let i = 0; i < n; i++) { try { const r = await fetch(u); if (r.ok) return await r.json(); } catch (_) {} await dormir(250); }
  throw new Error('el navegador no abrio su puerto de depuracion');
}

const perfil = join(tmpdir(), 'nerv-pieza-' + process.pid);
const puerto = 9100 + (process.pid % 800);
await mkdir(dirname(salida), { recursive: true });

/* `--disable-lcd-text` quita el suavizado subpixel: sus franjas de color se
   vuelven basura en un video que ademas se comprime en 4:2:0. */
const nav = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + puerto,
  '--user-data-dir=' + perfil, '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--force-device-scale-factor=1', '--disable-lcd-text',
  '--font-render-hinting=none', '--use-gl=angle', '--use-angle=swiftshader',
  '--window-size=1920,1180', 'about:blank'], { stdio: 'ignore' });

let ws, ff;
try {
  const v = await traer('http://127.0.0.1:' + puerto + '/json/version');
  ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((ok, mal) => { ws.addEventListener('open', ok); ws.addEventListener('error', mal); });
  const cdp = new Cdp(ws);
  nav.on('exit', (c) => cdp.romper(new Error('el navegador se cerro solo (codigo ' + c + ')')));
  ws.addEventListener('close', () => cdp.romper(new Error('se cayo la conexion con el navegador')));
  const { targetId } = await cdp.enviar('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.enviar('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => cdp.enviar(m, p, sessionId);

  await s('Page.enable'); await s('Runtime.enable');
  await s('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1180, deviceScaleFactor: 1, mobile: false });
  await s('Page.navigate', { url });
  await new Promise((ok) => cdp.al('Page.loadEventFired', ok));

  const ev = async (expression) => {
    const r = await s('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + ' ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || ''));
    }
    return r.result.value;
  };

  /* La pieza tarda: support.js baja React, Babel compila 92 KB de JSX y luego
     React monta medio mega de DOM. Se espera al contrato, no a un reloj. */
  process.stdout.write('  esperando la composicion');
  let listo = null;
  for (let i = 0; i < 200; i++) {
    listo = await ev("(async()=>{" +
      "const el=document.querySelector('[data-om-exportable-video-with-duration-secs]');" +
      "if(!el) return null;" +
      "await document.fonts.ready;" +
      "return { dur:+el.getAttribute('data-om-exportable-video-with-duration-secs')," +
      "         sync: el.hasAttribute('data-om-sync-seek') };})()");
    if (listo) break;
    if (i % 8 === 7) process.stdout.write('.');
    await dormir(250);
  }
  process.stdout.write('\n');
  if (!listo) throw new Error('la pieza nunca publico su raiz exportable');

  /* El Stage encoge el <svg> con `transform:scale()` para que quepa en la
     ventana. Se anula: se graba a su tamano natural, 1920x1080, o el texto de
     un tablero sale ilegible. La barra de reproduccion es del taller; se
     oculta para que no le robe altura al lienzo. */
  const caja = await ev("(()=>{" +
    "const st=document.createElement('style');" +
    "st.textContent='svg[data-om-exportable-video-with-duration-secs]{transform:none!important;box-shadow:none!important}'" +
    "+'[data-om-starter=\"animations-v3\"]>*:not(:first-child){display:none!important}';" +
    "document.head.appendChild(st);" +
    "const el=document.querySelector('[data-om-exportable-video-with-duration-secs]');" +
    "const r=el.getBoundingClientRect();" +
    "return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};})()");
  if (caja.w !== 1920 || caja.h !== 1080) {
    throw new Error('el lienzo mide ' + caja.w + 'x' + caja.h + ', no 1920x1080 -- la ventana lo esta encogiendo');
  }

  const total = Math.round(listo.dur * FPS);
  console.log('  ' + listo.dur + 's · ' + FPS + ' fps · ' + total + ' cuadros · salto ' + (listo.sync ? 'sincrono' : 'asincrono'));

  /* Se queda en 1920x1080 —el texto de un tablero a 12 px no sobrevive a 720p—
     y el peso se controla con el CRF, no bajando la resolucion.

     CRF 30 con `-tune animation` no es pereza: medido sobre Ferropalacios, que
     es lo mas caro que hay aqui (fondo oscuro con una trama diagonal que se
     mueve en cada cuadro, justo lo que un codec no sabe predecir), CRF 20 daba
     20.3 MB para 32 segundos. Eso no es un video de portada, es una descarga.
     A CRF 30 son 4.8 MB con el texto igual de legible, y `-tune animation`
     reparte los bits hacia los filos —que es de lo que estan hechas estas
     piezas— en vez de hacia el grano del fondo. */
  ff = spawn('ffmpeg', ['-y', '-f', 'image2pipe', '-framerate', String(FPS), '-i', 'pipe:0',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'slow',
    '-tune', 'animation', '-profile:v', 'high', '-movflags', '+faststart', '-an',
    salida], { stdio: ['pipe', 'ignore', 'pipe'] });
  let ffErr = '';
  ff.stderr.on('data', (d) => { ffErr += d; if (ffErr.length > 6000) ffErr = ffErr.slice(-6000); });
  const finFf = new Promise((ok, mal) => {
    ff.on('close', (c) => c === 0 ? ok() : mal(new Error('ffmpeg salio ' + c + '\n' + ffErr)));
    ff.on('error', mal);
  });
  const escribir = (buf) => ff.stdin.write(buf) ? Promise.resolve()
    : new Promise((r) => ff.stdin.once('drain', r));

  const clip = { x: caja.x, y: caja.y, width: caja.w, height: caja.h, scale: 1 };
  for (let i = 0; i < total; i++) {
    const t = i / FPS;
    await ev("(()=>{const el=document.querySelector('[data-om-exportable-video-with-duration-secs]');" +
      "el.dispatchEvent(new CustomEvent('data-om-seek-to-time-frame',{detail:{time:" + t + ",sync:true}}));})()");
    if (!listo.sync) await dormir(34);
    const tiro = await s('Page.captureScreenshot', { format: 'jpeg', quality: 94, clip, fromSurface: true, captureBeyondViewport: false });
    await escribir(Buffer.from(tiro.data, 'base64'));
    if (i % 60 === 0 || i === total - 1) process.stdout.write('\r  cuadro ' + (i + 1) + '/' + total + '   ');
  }
  process.stdout.write('\n');
  ff.stdin.end();
  await finFf;
  console.log('  listo: ' + salida);
} finally {
  try { ws && ws.close(); } catch (_) {}
  try { if (ff && !ff.killed) ff.kill(); } catch (_) {}
  nav.kill();
  await dormir(400);
  await rm(perfil, { recursive: true, force: true }).catch(() => {});
}
