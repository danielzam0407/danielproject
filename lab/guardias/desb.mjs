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
const perfil=join(tmpdir(),'nerv-d-'+process.pid), puerto=9000+(process.pid%900);
const nav=spawn(EDGE,['--headless=new','--remote-debugging-port='+puerto,'--user-data-dir='+perfil,
 '--no-first-run','--hide-scrollbars','about:blank'],{stdio:'ignore'});
let ws;
try{
 const v=await traer(`http://127.0.0.1:${puerto}/json/version`);
 ws=new WebSocket(v.webSocketDebuggerUrl);
 await new Promise((ok,mal)=>{ws.addEventListener('open',ok);ws.addEventListener('error',mal);});
 const cdp=new Cdp(ws);
 for (const [W,lang] of [[1600,'en'],[1280,'en'],[900,'es'],[390,'es'],[360,'es']]) {
  const {targetId}=await cdp.enviar('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await cdp.enviar('Target.attachToTarget',{targetId,flatten:true});
  const s=(m,p)=>cdp.enviar(m,p,sessionId);
  await s('Page.enable'); await s('Runtime.enable');
  await s('Emulation.setDeviceMetricsOverride',{width:W,height:844,deviceScaleFactor:1,mobile:W<700});
  await s('Page.addScriptToEvaluateOnNewDocument',{source:`try{localStorage.setItem('dp-lang','${lang}')}catch(e){}`});
  await s('Page.navigate',{url:process.argv[2]}); await new Promise(ok=>cdp.al('Page.loadEventFired',ok));
  await dormir(3800);
  const r=await s('Runtime.evaluate',{returnByValue:true,awaitPromise:true,expression:`(async () => {
   try{
    const bs=[...document.querySelectorAll('.v4-indice-lista button')];
    let peorSobra=0, peorPal='', desbordes=0;
    const h1=document.querySelector('.v4-titular');
    for (let k=0;k<bs.length;k++){
      bs[k].click(); await new Promise(r=>setTimeout(r,320));
      const de=document.documentElement;
      if (de.scrollWidth > de.clientWidth + 1) desbordes++;
      const r1=h1.getBoundingClientRect();
      const env=h1.closest('.v4-env').getBoundingClientRect();
      const sobra=Math.round(r1.right - env.right);
      if (sobra>peorSobra){ peorSobra=sobra; peorPal=bs[k].textContent; }
    }
    return 'desbordes='+desbordes+' · peor exceso='+peorSobra+'px ('+peorPal+')';
   }catch(e){ return 'ERROR '+e.message; }
  })()`});
  console.log(`  ${String(W).padStart(4)}px ${lang}  ${r.result.value}`);
  await cdp.enviar('Target.closeTarget',{targetId});
 }
}finally{ try{ws&&ws.close()}catch(_){}; nav.kill(); await dormir(400);
 await rm(perfil,{recursive:true,force:true}).catch(()=>{}); }
