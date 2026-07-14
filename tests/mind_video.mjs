import { chromium } from 'playwright';
const VDIR='/private/tmp/claude-501/-Users-kikocisneros-work2026-osin/0bdd22f4-b99b-49b2-ace3-ea4e15c92435/scratchpad/vid';
const BASE = process.env.BASE || 'http://localhost:8799';
const b=await chromium.launch({args:['--enable-unsafe-webgpu','--use-angle=metal','--autoplay-policy=no-user-gesture-required']});
const ctx=await b.newContext({viewport:{width:1280,height:720},recordVideo:{dir:VDIR,size:{width:1280,height:720}}});
await ctx.addInitScript(()=>{try{localStorage.setItem('elffusscode.model','rules')}catch{}});
const p=await ctx.newPage();
await p.goto(BASE+'/',{waitUntil:'domcontentloaded'});
await p.evaluate(async()=>{const o=await navigator.storage.getDirectory();const w=async(n,t)=>{const f=await o.getFileHandle(n,{create:true});const s=await f.createWritable();await s.write(t);await s.close()};await w('README.md','# demo'); await w('app.js','export const x=1;')});
await p.goto(BASE+'/?test-opfs',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(1800);
await p.locator('#activity img').click(); await p.waitForTimeout(1000);
// ciclo con pensamientos a ritmo legible (~15s)
const push=(ch,ev)=>p.evaluate(async(a)=>{const m=await import('/js/mind.js');m.pushThought(a.ch,a.ev)},{ch,ev});
await push('ceo',{type:'cycle',n:1,text:'Nuevo ciclo: reviso el proyecto y reparto el trabajo entre los departamentos.'});
const texts={arq:'Reviso la estructura. app.js concentra demasiada lógica; propongo extraer un módulo de utilidades y reducir el acoplamiento entre la vista y los datos.',cal:'Busco casos borde. La función no valida entradas vacías ni nulos; propongo añadir guardas y un par de tests unitarios que cubran esos casos.',rend:'Miro cuellos de botella. Hay trabajo repetido en el render; propongo memoizar el cálculo y usar un Map en vez de recorrer el array cada vez.',dx:'Reviso legibilidad. Los nombres son crípticos y falta documentación; propongo renombrar y añadir un README con ejemplos de uso.'};
for(const [id,name] of [['arq','Arquitectura'],['cal','Calidad'],['rend','Rendimiento'],['dx','Producto/DX']]){ await push(id,{type:'open',name,focus:'foco'}); }
// stream palabra a palabra, escalonado, ritmo legible
const words=Object.fromEntries(Object.entries(texts).map(([k,v])=>[k,v.split(' ')]));
const maxLen=Math.max(...Object.values(words).map(w=>w.length));
for(let i=0;i<maxLen;i++){ for(const id of ['arq','cal','rend','dx']){ if(words[id][i]) await push(id,{type:'token',text:words[id][i]+' '}); } await p.waitForTimeout(230); }
for(const id of ['arq','cal','rend','dx']) await push(id,{type:'done'});
await push('ceo',{type:'built',text:'Guardado en .elffuss/soul/mejoras-001.md',path:'.elffuss/soul/mejoras-001.md',proposals:[{dept:'Arquitectura',text:'extraer módulo'},{dept:'Calidad',text:'validar entradas'},{dept:'Rendimiento',text:'memoizar'},{dept:'Producto/DX',text:'documentar'}]});
await p.waitForTimeout(3500);
const path=await p.video().path();
await ctx.close(); await b.close();
console.log('VIDEO:'+path);
