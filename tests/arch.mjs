// Vista Arquitectura (grafo 3D fiel a CodeFlow, librería 3d-force-graph).
import { chromium } from 'playwright';
const OUT = '/private/tmp/claude-501/-Users-kikocisneros-work2026-osin/0bdd22f4-b99b-49b2-ace3-ea4e15c92435/scratchpad';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n,c,e='')=>{console.log((c?'✅':'❌')+' '+n+(e?'  — '+e:''));if(!c)fails++};
const b = await chromium.launch({ args:['--enable-unsafe-webgpu','--use-angle=metal'] });
const ctx = await b.newContext(); await ctx.addInitScript(()=>{try{localStorage.setItem('elffusscode.model','rules')}catch{}});
const p = await ctx.newPage({ viewport:{width:1500,height:900} });
p.on('console', m=>{ if(m.type()==='error' && !/allow-same-origin/.test(m.text())) console.log('   console.error:', m.text().slice(0,140)); });
await p.goto(BASE+'/',{waitUntil:'domcontentloaded'});
await p.evaluate(async()=>{const o=await navigator.storage.getDirectory();const w=async(path,txt)=>{const parts=path.split('/');const name=parts.pop();let d=o;for(const x of parts)d=await d.getDirectoryHandle(x,{create:true});const f=await d.getFileHandle(name,{create:true});const s=await f.createWritable();await s.write(txt);await s.close()};
  await w('index.js',"import {app} from './src/app.js';\napp();");
  await w('src/app.js',"import {greet} from './utils.js';\nimport {data} from './data.js';\nexport const app=()=>greet(data);");
  await w('src/utils.js',"import {fmt} from './fmt.js';\nexport const greet=d=>fmt(d);");
  await w('src/fmt.js',"export const fmt=x=>String(x);");
  await w('src/data.js',"export const data='x';");
});
await p.goto(BASE+'/?test-opfs',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(2500);
await p.click('#act-arch'); await p.waitForTimeout(5000); // cargar 3d-force-graph + layout
const head = await p.locator('#view-body .view-head').textContent().catch(()=> '');
ok('cabecera con dependencias', /dependencias/.test(head), head.slice(0,60));
const meta = await p.evaluate(()=>{ const el=document.getElementById('arch-graph'); return el?{nodes:+el.dataset.nodes,links:+el.dataset.links,canvas:!!el.querySelector('canvas')}:null; });
ok('grafo 3D construido (nodos + aristas reales)', meta && meta.nodes>=5 && meta.links>=3, JSON.stringify(meta));
ok('3d-force-graph montó un canvas WebGL', meta && meta.canvas);
ok('la librería 3d-force-graph cargó', await p.evaluate(()=>typeof window.ForceGraph3D==='function'));
await p.screenshot({ path: OUT+'/arch_codeflow.png' });
console.log('captura → arch_codeflow.png');
console.log(fails?`\n❌ ${fails} FALLO(S)`:'\n✅ ARQUITECTURA (CodeFlow / 3d-force-graph) OK');
await b.close(); process.exit(fails?1:0);
