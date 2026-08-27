/* Captura una página DESPUÉS de recorrerla, para que todo lo que se revela al
 * hacer scroll ya se haya revelado. Y, opcionalmente, con `.mov` arrancada:
 * ésa es la prueba de la regla 3 de la casa — sin el motor de animación, la
 * página tiene que verse entera igual.
 *
 *   node mirar.mjs <url> <salida.png> [--sin-mov]
 */
import { spawn } from 'node:child_process';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const [url, salida, ...banderas] = process.argv.slice(2);
const SIN_MOV = banderas.includes('--sin-mov');
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(ws){ this.ws=ws; this.n=0; this.pend=new Map(); this.oy=new Map();
    ws.addEventListener('message',(ev)=>{ const m=JSON.parse(ev.data);
      if(m.id&&this.pend.has(m.id)){ const{ok,mal}=this.pend.get(m.id); this.pend.delete(m.id);
        m.error?mal(new Error(m.error.message)):ok(m.result); }
      else if(m.method)(this.oy.get(m.method)||[]).forEach(f=>f(m.params)); }); }
  al(m,f){ if(!this.oy.has(m))this.oy.set(m,[]); this.oy.get(m).push(f); }
  enviar(method,params={},sessionId){ const id=++this.n;
    return new Promise((ok,mal)=>{ this.pend.set(id,{ok,mal});
      this.ws.send(JSON.stringify(sessionId?{id,method,params,sessionId}:{id,method,params})); }); }
}
async function traer(u,n=60){ for(let i=0;i<n;i++){ try{const r=await fetch(u); if(r.ok)return await r.json();}catch(_){} await dormir(250);} throw new Error('sin puerto'); }

const perfil = join(tmpdir(), 'nerv-mirar-' + process.pid);
const puerto = 9000 + (process.pid % 900);
await mkdir(dirname(salida), { recursive: true });

const nav = spawn(EDGE, ['--headless=new','--remote-debugging-port='+puerto,
  '--user-data-dir='+perfil,'--no-first-run','--no-default-browser-check',
  '--hide-scrollbars','--force-device-scale-factor=1','--window-size=1600,900',
  '--use-gl=angle','--use-angle=swiftshader','about:blank'], { stdio:'ignore' });

let ws;
try{
  const v = await traer(`http://127.0.0.1:${puerto}/json/version`);
  ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((ok,mal)=>{ ws.addEventListener('open',ok); ws.addEventListener('error',mal); });
  const cdp = new Cdp(ws);
  const { targetId } = await cdp.enviar('Target.createTarget',{url:'about:blank'});
  const { sessionId } = await cdp.enviar('Target.attachToTarget',{targetId,flatten:true});
  const s=(m,p)=>cdp.enviar(m,p,sessionId);
  await s('Page.enable'); await s('Runtime.enable');
  await s('Emulation.setDeviceMetricsOverride',{width:1600,height:900,deviceScaleFactor:1,mobile:false});
  await s('Page.navigate',{url});
  await new Promise(ok=>cdp.al('Page.loadEventFired',ok));
  await dormir(3500);

  if (SIN_MOV) {
    await s('Runtime.evaluate',{expression:`document.documentElement.classList.remove('mov'); 'sin mov'`, returnByValue:true});
    await dormir(400);
  }

  /* Recorrer la pagina entera despacio: es lo que dispara el observador. */
  const alt = (await s('Runtime.evaluate',{expression:'document.documentElement.scrollHeight', returnByValue:true})).result.value;
  for (let y = 0; y < alt; y += 500) {
    await s('Runtime.evaluate',{expression:`scrollTo(0,${y})`, returnByValue:true});
    await dormir(140);
  }
  await s('Runtime.evaluate',{expression:'scrollTo(0,0)', returnByValue:true});
  await dormir(1600);

  /* Cuantos quedaron sin revelar: si no es 0, la regla 3 esta rota. */
  const pend = (await s('Runtime.evaluate',{
    expression:`document.querySelectorAll('[data-revela]:not(.visto)').length`, returnByValue:true})).result.value;
  const invis = (await s('Runtime.evaluate',{expression:`(() => {
    let n = 0;
    document.querySelectorAll('[data-revela],.regla,.paso').forEach(e => {
      const cs = getComputedStyle(e);
      if (parseFloat(cs.opacity) < 0.05) n++;
    });
    return n; })()`, returnByValue:true})).result.value;
  console.log(`  sin revelar: ${pend}   invisibles al final: ${invis}`);

  const m = await s('Page.getLayoutMetrics');
  const alto = Math.min(Math.ceil(m.cssContentSize.height), 26000);
  const tiro = await s('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,
    clip:{x:0,y:0,width:1600,height:alto,scale:1}});
  await writeFile(salida, Buffer.from(tiro.data,'base64'));
  console.log(`  ${salida}  1600x${alto}`);
} finally {
  try{ ws&&ws.close(); }catch(_){}
  nav.kill(); await dormir(400);
  await rm(perfil,{recursive:true,force:true}).catch(()=>{});
}
