// Vista «Mente de Elffuss»: mundo trance + consolas de pensamiento + música.
import { chromium } from 'playwright';
const OUT = '/private/tmp/claude-501/-Users-kikocisneros-work2026-osin/0bdd22f4-b99b-49b2-ace3-ea4e15c92435/scratchpad';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n,c,e='')=>{console.log((c?'✅':'❌')+' '+n+(e?'  — '+e:''));if(!c)fails++};
const b = await chromium.launch({ args:['--enable-unsafe-webgpu','--use-angle=metal','--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext(); await ctx.addInitScript(()=>{try{localStorage.setItem('elffusscode.model','rules')}catch{}});
const p = await ctx.newPage({ viewport:{width:1500,height:900} });
p.on('console', m=>{ if(m.type()==='error' && !/allow-same-origin|soundcloud|widget/i.test(m.text())) console.log('   console.error:', m.text().slice(0,140)); });
await p.goto(BASE+'/',{waitUntil:'domcontentloaded'});
await p.evaluate(async()=>{const o=await navigator.storage.getDirectory();const w=async(n,t)=>{const f=await o.getFileHandle(n,{create:true});const s=await f.createWritable();await s.write(t);await s.close()};await w('README.md','# demo');await w('app.js','export const x=1;')});
await p.goto(BASE+'/?test-opfs',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(2000);

// abrir la Mente vía la elfa
await p.locator('#activity img').click();
await p.waitForTimeout(1200);
ok('overlay de la Mente montado', await p.locator('#mind-overlay').count()>0);
ok('canvas WebGL del mundo trance', await p.evaluate(()=>{const c=document.getElementById('mind-canvas');const gl=c&&(c.getContext('webgl2')||c.getContext('webgl'));return !!gl && !gl.isContextLost();}));
ok('widget de música (SoundCloud)', await p.locator('.mind-music iframe').count()>0);

// inyectar pensamientos paralelos y una mejora construida
await p.evaluate(async ()=>{
  const m = await import('/js/mind.js');
  m.pushThought('sys', {type:'status', text:'CEO en guardia'});
  m.pushThought('ceo', {type:'cycle', n:1, text:'Reviso el proyecto y reparto el trabajo…'});
  for (const [id,name] of [['arq','Arquitectura'],['cal','Calidad'],['rend','Rendimiento'],['dx','Producto/DX']]) {
    m.pushThought(id, {type:'open', name, focus:'foco '+id});
    for (const w of ('analizo '+name+' … encuentro una mejora concreta en app.js … propongo extraer una función y añadir un test. ').split(' '))
      m.pushThought(id, {type:'token', text: w+' '});
    m.pushThought(id, {type:'done'});
  }
  m.pushThought('ceo', {type:'built', text:'Propuesta guardada en elffuss-mind/mejoras-001.md', proposals:[1,2,3,4]});
});
await p.waitForTimeout(1500);
const consoles = await p.locator('.mind-console').count();
ok('consolas flotantes de pensamiento (CEO + departamentos)', consoles>=4, consoles+' consolas');
ok('una consola tiene texto de pensamiento', await p.evaluate(()=>{const b=document.querySelector('.mind-console.c-arq .mc-body');return b && b.textContent.length>10;}));
ok('la mejora forjada flota en el centro', await p.locator('.mind-built-card').count()>0);
await p.waitForTimeout(1200);
await p.screenshot({ path: OUT+'/mind.png' });
console.log('captura → mind.png');
console.log(fails?`\n❌ ${fails} FALLO(S)`:'\n✅ MENTE DE ELFFUSS OK');
await b.close(); process.exit(fails?1:0);
