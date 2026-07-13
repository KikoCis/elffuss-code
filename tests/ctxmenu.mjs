import { chromium } from 'playwright';
const BASE = process.env.BASE || 'https://elffuss-code.utopiaia.com';
let fails = 0; const ok = (n,c,e='')=>{console.log((c?'✅':'❌')+' '+n+(e?'  — '+e:''));if(!c)fails++};
const b = await chromium.launch(); const ctx = await b.newContext();
await ctx.addInitScript(()=>{try{localStorage.setItem('elffusscode.model','rules')}catch{}});
const p = await ctx.newPage();
await p.goto(BASE+'/',{waitUntil:'domcontentloaded'});
await p.evaluate(async()=>{const o=await navigator.storage.getDirectory();const w=async(d,n,t)=>{const f=await d.getFileHandle(n,{create:true});const s=await f.createWritable();await s.write(t);await s.close()};await w(o,'hola.txt','contenido')});
await p.goto(BASE+'/?test-opfs',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(2500);
// botón derecho sobre el fichero
await p.locator('#tree').getByText('hola.txt').click({button:'right'});
await p.waitForTimeout(300);
const items = await p.locator('#tree-menu .tm-item').allInnerTexts().catch(()=>[]);
ok('el menú contextual aparece con acciones', items.length>=3 && items.some(t=>/Eliminar/.test(t)) && items.some(t=>/Renombrar/.test(t)), items.join(' · '));
// crear carpeta nueva vía menú (dialog)
p.once('dialog', d=>d.accept('nueva-carpeta'));
await p.locator('#tree-menu .tm-item', {hasText:'Nueva carpeta'}).click();
await p.waitForTimeout(500);
const hasFolder = await p.locator('#tree').getByText('nueva-carpeta').count();
ok('«Nueva carpeta» crea la carpeta en el árbol', hasFolder>0);
// eliminar el fichero vía menú (confirm)
await p.locator('#tree').getByText('hola.txt').click({button:'right'});
await p.waitForTimeout(200);
p.once('dialog', d=>d.accept());
await p.locator('#tree-menu .tm-item', {hasText:'Eliminar'}).click();
await p.waitForTimeout(500);
const gone = await p.locator('#tree').getByText('hola.txt').count();
ok('«Eliminar» quita el fichero del árbol', gone===0);
console.log(fails?`\n❌ ${fails} FALLO(S)`:'\n✅ MENÚ CONTEXTUAL OK');
await b.close(); process.exit(fails?1:0);
