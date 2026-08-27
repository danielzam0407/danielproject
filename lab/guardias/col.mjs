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
const perfil=join(tmpdir(),'nerv-col-'+process.pid), puerto=9000+(process.pid%900);
const anchos=[1600,1280,900,390];
const nav=spawn(EDGE,['--headless=new','--remote-debugging-port='+puerto,'--user-data-dir='+perfil,
 '--no-first-run','--hide-scrollbars','about:blank'],{stdio:'ignore'});
let ws;
try{
 const v=await traer(`http://127.0.0.1:${puerto}/json/version`);
 ws=new WebSocket(v.webSocketDebuggerUrl);
 await new Promise((ok,mal)=>{ws.addEventListener('open',ok);ws.addEventListener('error',mal);});
 const cdp=new Cdp(ws);
 for (const W of anchos){
  const {targetId}=await cdp.enviar('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await cdp.enviar('Target.attachToTarget',{targetId,flatten:true});
  const s=(m,p)=>cdp.enviar(m,p,sessionId);
  await s('Page.enable'); await s('Runtime.enable');
  await s('Emulation.setDeviceMetricsOverride',{width:W,height:900,deviceScaleFactor:1,mobile:W<700});
  await s('Page.navigate',{url:process.argv[2]}); await new Promise(ok=>cdp.al('Page.loadEventFired',ok));
  await dormir(4200);
  const r=await s('Runtime.evaluate',{returnByValue:true,expression:`(() => {
    const hero=document.querySelector('.v4-hero'); if(!hero) return '{}';
    const tx=[...hero.querySelectorAll('.v4-dsp,.v4-lede,.v4-hero-sup,.v4-demo')].map(n=>n.getBoundingClientRect());
    const todas=[...hero.querySelectorAll('.v4-telem span')];
    const visibles=todas.filter(n=>getComputedStyle(n).visibility!=='hidden');
    const mk=visibles.map(n=>n.getBoundingClientRect());
    let ch=0; mk.forEach(m=>tx.forEach(q=>{ if(m.left<q.right&&m.right>q.left&&m.top<q.bottom&&m.bottom>q.top) ch++; }));
    const env=document.querySelector('.v4-hero .v4-env').getBoundingClientRect();
    return JSON.stringify({sembradas:todas.length, visibles:mk.length, choques:ch, textoEmpiezaEn:Math.round(env.left),
      fondo:!!document.querySelector('.v4-fondo'), alambre:!!document.querySelector('.v4-alambre')});
  })()`});
  console.log(`  ${String(W).padStart(4)}px  ${r.result.value}`);
  await cdp.enviar('Target.closeTarget',{targetId});
 }
}finally{ try{ws&&ws.close()}catch(_){}; nav.kill(); await dormir(400);
 await rm(perfil,{recursive:true,force:true}).catch(()=>{}); }
