import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { join } from 'node:path'; import { tmpdir } from 'node:os';
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const url=process.argv[2]; const dormir=(m)=>new Promise(r=>setTimeout(r,m));
class Cdp{constructor(ws){this.ws=ws;this.n=0;this.p=new Map();this.o=new Map();
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);
  if(m.id&&this.p.has(m.id)){const{ok,mal}=this.p.get(m.id);this.p.delete(m.id);m.error?mal(new Error(m.error.message)):ok(m.result);}
  else if(m.method)(this.o.get(m.method)||[]).forEach(f=>f(m.params));});}
 al(m,f){if(!this.o.has(m))this.o.set(m,[]);this.o.get(m).push(f);}
 enviar(me,pa={},si){const id=++this.n;return new Promise((ok,mal)=>{this.p.set(id,{ok,mal});
  this.ws.send(JSON.stringify(si?{id,method:me,params:pa,sessionId:si}:{id,method:me,params:pa}));});}}
async function traer(u,n=60){for(let i=0;i<n;i++){try{const r=await fetch(u);if(r.ok)return await r.json();}catch(_){}await dormir(250);}throw new Error('x');}
const perfil=join(tmpdir(),'nerv-c-'+process.pid), puerto=9000+(process.pid%900);
const nav=spawn(EDGE,['--headless=new','--remote-debugging-port='+puerto,'--user-data-dir='+perfil,
 '--no-first-run','--hide-scrollbars','--window-size=1600,900','about:blank'],{stdio:'ignore'});
let ws;
try{
 const v=await traer(`http://127.0.0.1:${puerto}/json/version`);
 ws=new WebSocket(v.webSocketDebuggerUrl);
 await new Promise((ok,mal)=>{ws.addEventListener('open',ok);ws.addEventListener('error',mal);});
 const cdp=new Cdp(ws);
 const {targetId}=await cdp.enviar('Target.createTarget',{url:'about:blank'});
 const {sessionId}=await cdp.enviar('Target.attachToTarget',{targetId,flatten:true});
 const s=(m,p)=>cdp.enviar(m,p,sessionId);
 await s('Page.enable');await s('Runtime.enable');
 await s('Emulation.setDeviceMetricsOverride',{width:1600,height:900,deviceScaleFactor:1,mobile:false});
 await s('Page.navigate',{url}); await new Promise(ok=>cdp.al('Page.loadEventFired',ok));
 await dormir(3000);
 // Regla 9: matar transiciones antes de medir.
 await s('Runtime.evaluate',{expression:`(()=>{const e=document.createElement('style');
   e.textContent='*,*::before,*::after{transition:none!important;animation:none!important}';
   document.head.appendChild(e);document.querySelectorAll('[data-revela],.regla,.paso').forEach(n=>n.classList.add('visto'));return 1})()`,returnByValue:true});
 await dormir(500);
 const r=await s('Runtime.evaluate',{returnByValue:true,expression:`(() => {
   const lum=(c)=>{const [r,g,b]=c.map(v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)});
     return .2126*r+.7152*g+.0722*b};
   const rgb=(s)=>{const m=s.match(/[\d.]+/g); if(!m) return null;
     const a=m.length>3?parseFloat(m[3]):1; return {c:[+m[0],+m[1],+m[2]], a}};
   const fondoDe=(el)=>{let n=el; while(n&&n!==document.documentElement){
     const b=rgb(getComputedStyle(n).backgroundColor); if(b&&b.a>0.5) return b.c; n=n.parentElement;}
     return [244,247,252]};
   const malos=[], lectura=[];
   document.querySelectorAll('p,h1,h2,h3,span,a,button,input,div,label').forEach(el=>{
     if(!el.childNodes.length) return;
     const txt=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join('');
     if(!txt) return;
     const cs=getComputedStyle(el);
     if(cs.visibility==='hidden'||cs.display==='none'||parseFloat(cs.opacity)<0.1) return;
     const f=rgb(cs.color); if(!f) return;
     const b=fondoDe(el);
     const l1=lum(f.c), l2=lum(b);
     const ratio=(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);
     const px=parseFloat(cs.fontSize), peso=parseInt(cs.fontWeight)||400;
     const grande = px>=24 || (px>=18.66 && peso>=700);
     const umbral = grande?3:4.5;
     if(ratio < umbral){
       const item={t:txt.slice(0,42), px:+px.toFixed(1), r:+ratio.toFixed(2), umbral};
       malos.push(item);
       if(px>=12) lectura.push(item);   // texto de LEER, no telemetria de 6px
     }
   });
   return JSON.stringify({total:malos.length, lectura:lectura.length, ejemplos:malos.slice(0,10)});
 })()`});
 const d=JSON.parse(r.result.value);
 console.log(`  pares bajo umbral: ${d.total}   de ellos COLUMNA DE LECTURA (>=12px): ${d.lectura}`);
 d.ejemplos.forEach(e=>console.log(`    ${e.r}:1  ${e.px}px  "${e.t}"`));
}finally{ try{ws&&ws.close()}catch(_){}; nav.kill(); await dormir(400);
 await rm(perfil,{recursive:true,force:true}).catch(()=>{}); }
