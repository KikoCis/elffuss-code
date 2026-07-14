// Mente v2: mundo audio-reactivo + consolas flotantes + nodos clicables +
// config de cerebro + persistencia (música/animación) + reporte al chat.
import { chromium } from 'playwright';
const OUT = '/private/tmp/claude-501/-Users-kikocisneros-work2026-osin/0bdd22f4-b99b-49b2-ace3-ea4e15c92435/scratchpad';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n,c,e='')=>{console.log((c?'✅':'❌')+' '+n+(e?'  — '+e:''));if(!c)fails++};
const b = await chromium.launch({ args:['--enable-unsafe-webgpu','--use-angle=metal','--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext(); await ctx.addInitScript(()=>{try{localStorage.setItem('elffusscode.model','rules')}catch{}});
const p = await ctx.newPage({ viewport:{width:1500,height:900} });
p.on('console', m=>{ if(m.type()==='error' && !/allow-same-origin|soundcloud|widget|encrypted-media|permissions policy/i.test(m.text())) console.log('   err:', m.text().slice(0,140)); });
await p.goto(BASE+'/',{waitUntil:'domcontentloaded'});
await p.evaluate(async()=>{const o=await navigator.storage.getDirectory();const w=async(n,t)=>{const f=await o.getFileHandle(n,{create:true});const s=await f.createWritable();await s.write(t);await s.close()};await w('README.md','# demo');await w('app.js','export const x=1;')});
await p.goto(BASE+'/?test-opfs',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(2000);

await p.locator('#activity img').click(); await p.waitForTimeout(1000);
ok('overlay + mundo WebGL', await p.locator('#mind-overlay').count()>0 && await p.evaluate(()=>{const c=document.getElementById('mind-canvas');const gl=c&&(c.getContext('webgl2')||c.getContext('webgl'));return !!gl&&!gl.isContextLost();}));
ok('sin subtítulo (solo título)', await p.evaluate(()=>{const t=document.getElementById('mind-title');return t && !t.querySelector('span') && /MENTE DE ELFFUSS/.test(t.textContent);}));
ok('música (SoundCloud)', await p.locator('.mind-music iframe').count()>0);
ok('botón de config del cerebro', await p.locator('#mind-config').count()>0);

// inyectar pensamientos + una mejora forjada
await p.evaluate(async ()=>{ const m=await import('/js/mind.js');
  m.pushThought('ceo',{type:'cycle',n:1,text:'Reparto el trabajo…'});
  for(const [id,name] of [['arq','Arquitectura'],['cal','Calidad'],['rend','Rendimiento'],['dx','Producto/DX']]){ m.pushThought(id,{type:'open',name,focus:'foco'}); m.pushThought(id,{type:'token',text:'analizo '+name+' y propongo una mejora concreta en app.js. '}); m.pushThought(id,{type:'done'}); }
  m.pushThought('ceo',{type:'built',text:'Guardado en .elffuss/soul/mejoras-001.md',path:'.elffuss/soul/mejoras-001.md',proposals:[{dept:'Arquitectura',text:'extraer helper'},{dept:'Calidad',text:'añadir test'}]});
});
await p.waitForTimeout(1000);
ok('consolas flotantes (ancladas al mundo)', await p.locator('.mind-console').count()>=4, await p.locator('.mind-console').count()+'');
ok('nodo de pensamiento clicable creado', await p.evaluate(()=>document.querySelectorAll('.mind-node-label').length>0));

// abrir el panel de config y reprogramar la misión
await p.locator('#mind-config').click(); await p.waitForTimeout(300);
ok('panel de config visible (misión + carpeta)', await p.locator('#mind-cfg.show #cfg-mission').count()>0 && await p.locator('#cfg-dir').count()>0);
ok('carpeta por defecto .elffuss/soul', (await p.locator('#cfg-dir').inputValue())==='.elffuss/soul');
await p.locator('#cfg-mission').fill('céntrate en seguridad');
await p.locator('#cfg-save').click(); await p.waitForTimeout(300);
ok('la misión se reprograma', await p.evaluate(async()=>{const c=await import('/js/ceo.js');return c.getMission()==='céntrate en seguridad';}));

await p.screenshot({ path: OUT+'/mind2.png' });

// persistencia: cerrar y reabrir NO recrea el overlay (misma música/animación)
await p.locator('#mind-close').click(); await p.waitForTimeout(400);
ok('al cerrar el overlay se oculta (no se destruye)', await p.evaluate(()=>{const o=document.getElementById('mind-overlay');return o && getComputedStyle(o).display==='none';}));
await p.locator('#activity img').click(); await p.waitForTimeout(400);
ok('al reabrir NO se recrea (persistencia música/animación)', await p.evaluate(()=>document.querySelectorAll('#mind-overlay').length===1));
console.log('captura → mind2.png');
console.log(fails?`\n❌ ${fails} FALLO(S)`:'\n✅ MENTE v2 OK');
await b.close(); process.exit(fails?1:0);
