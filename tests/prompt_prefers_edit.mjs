// Guardia: el system prompt debe empujar a code.edit (edición parcial) para
// MODIFICAR ficheros, reservando code.write para CREAR. Nació de un bug real:
// la lista de herramientas permitidas OMITÍA code.edit y el paso 3 mandaba
// reescribir entero con code.write → el modelo reescribía ficheros completos
// (carísimo y destructivo en ficheros grandes). Determinista, sin modelo.
import { chromium } from 'playwright';
const BASE=process.env.BASE||'http://localhost:8790';
let fails=0; const ok=(n,c,e='')=>{console.log((c?'✅':'❌')+' '+n+(e?'  — '+e:''));if(!c)fails++;};
const b=await chromium.launch();const ctx=await b.newContext();
await ctx.addInitScript(()=>{try{localStorage.setItem('elffusscode.model','rules');}catch{}});
const p=await ctx.newPage();
await p.goto(BASE+'/?test-opfs',{waitUntil:'domcontentloaded'});await p.waitForTimeout(1200);
const sp=await p.evaluate(async()=>{ const a=await import('/js/agent.js'); return a.systemPrompt(''); });
ok('code.edit está en la lista de herramientas permitidas', /USA SOLO[^\n]*code\.edit/.test(sp));
ok('toolHelp describe code.edit (sin reescribir entero)', /Editar PARTE|sin reescribirlo entero/.test(sp));
ok('regla dura: MODIFICAR existente → code.edit, no reescribir', /MODIFICAR un fichero que YA existe: usa code\.edit/.test(sp));
ok('paso 3 distingue crear (write) vs modificar (edit)', /Para MODIFICARLO usa code\.edit/.test(sp));
ok('hay un ejemplo de code.edit', /"tool": "code\.edit"/.test(sp));
ok('ya NO dice «al escribir con code.write pasa el contenido COMPLETO» como única vía de edición', !/Antes de tocar código: lee el archivo\. Al escribir con code\.write pasa el contenido COMPLETO\./.test(sp));
console.log(fails?`\n❌ ${fails} FALLO(S)`:'\n✅ el prompt ya empuja a edición parcial');
await b.close();process.exit(fails?1:0);
