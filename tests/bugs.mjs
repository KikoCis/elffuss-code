// Bug A: al cerrar la última pestaña → estado vacío (no Monaco en blanco).
// Bug B: abrir/cerrar/alternar vistas (grafo/ciudad) → siempre cargan bien.
import { chromium } from 'playwright';
const OUT='/private/tmp/claude-501/-Users-kikocisneros-work2026-osin/0bdd22f4-b99b-49b2-ace3-ea4e15c92435/scratchpad';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails=0; const ok=(n,c,e='')=>{console.log((c?'✅':'❌')+' '+n+(e?'  — '+e:''));if(!c)fails++};
const b=await chromium.launch({args:['--enable-unsafe-webgpu','--use-angle=metal']});
const ctx=await b.newContext(); await ctx.addInitScript(()=>{try{localStorage.setItem('elffusscode.model','rules')}catch{}});
const p=await ctx.newPage({viewport:{width:1500,height:900}});
p.on('pageerror',e=>{if(!/allow-same-origin/.test(e.message))console.log('   pageerror:',e.message.slice(0,120))});
await p.goto(BASE+'/',{waitUntil:'domcontentloaded'});
await p.evaluate(async()=>{const o=await navigator.storage.getDirectory();const w=async(path,txt)=>{const pr=path.split('/');const nm=pr.pop();let d=o;for(const x of pr)d=await d.getDirectoryHandle(x,{create:true});const f=await d.getFileHandle(nm,{create:true});const s=await f.createWritable();await s.write(txt);await s.close()};
  await w('README.md','# demo'); await w('src/a.js',"import {b} from './b.js';\nexport const a=b;"); await w('src/b.js',"export const b=1;");});
await p.goto(BASE+'/?test-opfs',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(2500);

// ── Bug A ──
await p.locator('#tree').getByText('README.md').first().click(); await p.waitForTimeout(700);
ok('al abrir un fichero, sin estado vacío', await p.evaluate(()=>{const e=document.getElementById('editor-empty');return !e||getComputedStyle(e).display==='none';}));
await p.locator('#tabs-bar .tab b').first().click(); await p.waitForTimeout(500); // cerrar la pestaña
ok('al cerrar la última pestaña → estado vacío visible', await p.evaluate(()=>{const e=document.getElementById('editor-empty');return !!e && getComputedStyle(e).display!=='none';}));

// ── Bug B ── abrir/cerrar/alternar vistas varias veces
const openArch=async()=>{ await p.click('#act-arch'); await p.waitForTimeout(3500); return p.evaluate(()=>{const g=document.getElementById('arch-graph');return !!g && !!g.querySelector('canvas') && +g.dataset.nodes>0;}); };
const openCity=async()=>{ await p.click('#act-city'); await p.waitForTimeout(3500); return p.evaluate(()=>{const c=document.getElementById('city-canvas');const gl=c&&(c.getContext('webgl2')||c.getContext('webgl'));return !!gl && !gl.isContextLost() && c.width>50; }); };
ok('grafo carga (1ª vez)', await openArch());
await p.click('#view-close'); await p.waitForTimeout(400);
ok('ciudad carga tras cerrar el grafo', await openCity());
await p.click('#view-close'); await p.waitForTimeout(400);
ok('grafo RE-carga (reapertura)', await openArch());
// alternar directo grafo→ciudad sin cerrar
ok('ciudad carga alternando directo desde el grafo', await openCity());
ok('grafo carga alternando directo desde la ciudad', await openArch());
await p.screenshot({path:OUT+'/bugs.png'});
console.log(fails?`\n❌ ${fails} FALLO(S)`:'\n✅ BUGS (estado vacío + recarga de vistas) OK');
await b.close(); process.exit(fails?1:0);
