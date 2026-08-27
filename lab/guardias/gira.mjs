import { spawn } from 'node:child_process'; import { rm } from 'node:fs/promises';
import { join } from 'node:path'; import { tmpdir } from 'node:os';
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const dormir=m=>new Promise(r=>setTimeout(r,m));
class Cdp{constructor(ws){this.ws=ws;this.n=0;this.p=new Map();this.o=new Map();
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);
  if(m.id&&this.p.has(m.id)){const{ok,mal}=this.p.get(m.id);this.p.delete(m.id);m.error?mal(new Error(m.error.message)):ok(m.result);}
  else if(m.method)(this.o.get(m.method)||[]).forEach(f=>f(m.params));});}
 al(m,f){if(!this.o.has(m))this.o.set(m,[]);this.o.get(m).push(f);}
 enviar(me,pa={},si){const id=++this.n;return new Promise((ok,mal)=>{this.p.set(id,{ok,mal});
  this.ws.send(JSON.stringify(si?{id,method:me,params:pa,sessionId:si}:{id,method:me,params:pa}));});}}
async function traer(u,n=60){for(let i=0;i<n;i++){try{const r=await fetch(u);if(r.ok)return await r.json();}catch(_){}await dormir(250);}throw new Error('x');}
const perfil=join(tmpdir(),'nerv-g-'+process.pid), puerto=9000+(process.pid%900);
const nav=spawn(EDGE,['--headless=new','--remote-debugging-port='+puerto,'--user-data-dir='+perfil,
 '--no-first-run','--hide-scrollbars','--window-size=1500,900','about:blank'],{stdio:'ignore'});
let ws;
try{
 const v=await traer(`http://127.0.0.1:${puerto}/json/version`);
 ws=new WebSocket(v.webSocketDebuggerUrl);
 await new Promise((ok,mal)=>{ws.addEventListener('open',ok);ws.addEventListener('error',mal);});
 const cdp=new Cdp(ws);
 for (const lang of ['en','es']) {
  const {targetId}=await cdp.enviar('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await cdp.enviar('Target.attachToTarget',{targetId,flatten:true});
  const s=(m,p)=>cdp.enviar(m,p,sessionId);
  await s('Page.enable'); await s('Runtime.enable');
  await s('Emulation.setDeviceMetricsOverride',{width:1500,height:900,deviceScaleFactor:1,mobile:false});
  await s('Page.addScriptToEvaluateOnNewDocument',{source:`try{localStorage.setItem('dp-lang','${lang}')}catch(e){}`});
  await s('Page.navigate',{url:process.argv[2]}); await new Promise(ok=>cdp.al('Page.loadEventFired',ok));
  await dormir(3500);
  const r=await s('Runtime.evaluate',{returnByValue:true,awaitPromise:true,expression:`(async () => {
    const p=document.getElementById('v4-gira-p'), n=document.getElementById('v4-indice-n');
    const bs=[...document.querySelectorAll('.v4-indice-lista button')];
    const vistas=[]; const idx=[];
    for(let k=0;k<4;k++){ vistas.push(p.textContent); idx.push(n.textContent); await new Promise(r=>setTimeout(r,2700)); }
    // pausa
    const pb=document.getElementById('v4-pausa'); pb.click();
    const antes=p.textContent; await new Promise(r=>setTimeout(r,3200));
    const pausaFunciona = (p.textContent===antes);
    // un boton: debe fijar esa palabra y marcarla
    bs[2].click(); await new Promise(r=>setTimeout(r,400));
    return JSON.stringify({
      giro: [...new Set(vistas)].length>1, vistas, idx,
      pausaFunciona, botones: bs.length,
      alPulsar: p.textContent, marcada: bs[2].getAttribute('aria-current'),
      abrioAgente: !document.getElementById('ag-panel').hidden
    }); })()`});
  console.log('  ' + lang + ': ' + r.result.value);
  await cdp.enviar('Target.closeTarget',{targetId});
 }
}finally{ try{ws&&ws.close()}catch(_){}; nav.kill(); await dormir(400);
 await rm(perfil,{recursive:true,force:true}).catch(()=>{}); }
