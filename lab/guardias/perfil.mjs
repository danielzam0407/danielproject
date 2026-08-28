/* Mide QUIEN se come los cuadros en /v5, apagando un sospechoso a la vez.
 *
 *   node perfil.mjs <url>
 *
 * El Browser pane no sirve para esto: no compone, asi que rAF no corre y todo
 * mide 0. Edge headless si compone -- ya se comprobo con el video y el FLIP.
 *
 * El raton se mueve por CDP (`Input.dispatchMouseEvent`) y no con eventos
 * sinteticos de JS: el cursor de la pagina es lo que se esta midiendo, y un
 * `new MouseEvent` no pasa por la misma tuberia de entrada que un raton.
 */
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const url = process.argv[2];
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
    return new Promise((ok, mal) => {
      const t = setTimeout(() => { if (this.p.delete(id)) mal(new Error('sin respuesta a ' + me)); }, 60000);
      this.p.set(id, { ok: (v) => { clearTimeout(t); ok(v); }, mal: (v) => { clearTimeout(t); mal(v); } });
      this.ws.send(JSON.stringify(si ? { id, method: me, params: pa, sessionId: si } : { id, method: me, params: pa }));
    });
  }
}
async function traer(u, n = 80) {
  for (let i = 0; i < n; i++) { try { const r = await fetch(u); if (r.ok) return await r.json(); } catch (_) {} await dormir(250); }
  throw new Error('sin puerto');
}

const perfil = join(tmpdir(), 'nerv-perf-' + process.pid);
const puerto = 9700 + (process.pid % 200);
/* Sin `--use-angle=swiftshader` a proposito: se quiere medir con la GPU de
   verdad, que es lo que tiene su laptop. Con dibujado por software todo sale
   lento y no se distingue al culpable. */
const nav = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + puerto,
  '--user-data-dir=' + perfil, '--no-first-run', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--window-size=1600,900',
  '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });

let ws;
try {
  const v = await traer('http://127.0.0.1:' + puerto + '/json/version');
  ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((ok, mal) => { ws.addEventListener('open', ok); ws.addEventListener('error', mal); });
  const cdp = new Cdp(ws);
  nav.on('exit', () => {});
  const { targetId } = await cdp.enviar('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.enviar('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => cdp.enviar(m, p, sessionId);
  await s('Page.enable'); await s('Runtime.enable');
  await s('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await s('Page.navigate', { url });
  await new Promise((ok) => cdp.al('Page.loadEventFired', ok));
  await dormir(4000);

  const ev = async (x) => {
    const r = await s('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };

  // ── 1. que se bajo de verdad ───────────────────────────────────────────
  console.log('RECURSOS');
  const res = await ev(`JSON.stringify(performance.getEntriesByType('resource')
    .map(e=>[e.name.replace(location.origin,''), Math.round(e.transferSize/1024)])
    .filter(x=>x[0].indexOf('rum')<0))`);
  JSON.parse(res).forEach(([n, k]) => console.log('  ' + String(k).padStart(5) + ' KB  ' + n));
  console.log('  three/nerv-bot cargado: ' +
    await ev("String(performance.getEntriesByType('resource').some(e=>/three|nerv-bot/.test(e.name)))"));
  console.log('  WebGL vivo: ' + await ev("String(document.querySelectorAll('canvas').length) + ' canvas'"));

  // ── 2. cuadros, moviendo el raton ──────────────────────────────────────
  const mover = async (ms) => {
    const t0 = Date.now();
    let i = 0;
    while (Date.now() - t0 < ms) {
      const x = 200 + ((i * 37) % 1100), y = 200 + ((i * 53) % 500);
      await s('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      i++;
      await dormir(8);
    }
  };

  const medir = async (etiqueta, preparar) => {
    if (preparar) await ev(preparar);
    await dormir(800);
    /* Cada medicion sube la generacion; el bucle anterior se ve viejo y se
       apaga solo. Sin esto los bucles se apilaban y se pisaban el array. */
    await ev(`window.__t=[];window.__lt=0;window.__gen=(window.__gen||0)+1;
      if(!window.__po){window.__po=new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lt+=e.duration});
        try{window.__po.observe({type:'longtask',buffered:false})}catch(_){}}
      (function(){const mia=window.__gen;let u=performance.now();
        function f(n){if(window.__gen!==mia)return;window.__t.push(n-u);u=n;requestAnimationFrame(f)}
        requestAnimationFrame(f)})();`);
    await mover(3200);
    const r = await ev(`JSON.stringify((()=>{const t=window.__t.slice(5).sort((a,b)=>a-b);
      if(!t.length) return {n:0};
      const q=(p)=>t[Math.min(t.length-1,Math.floor(t.length*p))];
      return {n:t.length, mediana:+q(.5).toFixed(1), p95:+q(.95).toFixed(1), peor:+t[t.length-1].toFixed(1),
              fps:+(1000/q(.5)).toFixed(1), tareasLargas:Math.round(window.__lt)};})())`);
    const d = JSON.parse(r);
    console.log('  ' + etiqueta.padEnd(26) +
      ' mediana ' + String(d.mediana).padStart(5) + ' ms   p95 ' + String(d.p95).padStart(6) +
      '   peor ' + String(d.peor).padStart(6) + '   ~' + d.fps + ' fps   tareas largas ' + d.tareasLargas + ' ms');
    return d;
  };

  console.log('\nCUADROS (moviendo el raton todo el rato)');
  await medir('base', null);
  await medir('sin el lienzo', "document.querySelector('#dc-root canvas').style.display='none'");
  await medir('  + sin mezcla del cursor',
    "document.querySelector('[style*=\"mix-blend-mode\"]').style.mixBlendMode='normal'");
  await medir('  + sin video',
    "document.querySelectorAll('video').forEach(v=>v.pause())");
  await medir('  + sin velo',
    "(document.getElementById('nerv-velo')||{style:{}}).style.display='none'");

  console.log('\nAL REVES, para aislar');
  await ev(`document.querySelector('#dc-root canvas').style.display='';
            document.querySelector('[style*="mix-blend-mode"]').style.mixBlendMode='difference';
            (document.getElementById('nerv-velo')||{style:{}}).style.display='';`);
  await medir('todo menos el video', "document.querySelectorAll('video').forEach(v=>v.pause())");
  await medir('todo menos la mezcla',
    "document.querySelectorAll('video').forEach(v=>{v.play().catch(()=>{})});document.querySelector('[style*=\"mix-blend-mode\"]').style.mixBlendMode='normal'");
} finally {
  try { ws && ws.close(); } catch (_) {}
  nav.kill(); await dormir(400);
  await rm(perfil, { recursive: true, force: true }).catch(() => {});
}
