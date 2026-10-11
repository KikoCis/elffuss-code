// El markdown del chat (web/js/md.js), en Node: lo que se formatea y lo que no.
//
// El caso que fallaba: el énfasis (_cursiva_ y *cursiva*) se aplicaba DENTRO del
// código `inline`, y `def f(_x_)` salía como def f(<i>x</i>), sin los guiones
// bajos. El código se aparta antes del énfasis, como ya se hacía con los
// bloques ```.
//
//   node tests/md.mjs
//   MD_JS=<ruta a otra copia de md.js> node tests/md.mjs   (p. ej. la del core)
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const AQUI = dirname(fileURLToPath(import.meta.url));
const { renderMarkdown: md } = await import(pathToFileURL(resolve(process.env.MD_JS || join(AQUI, '..', 'web', 'js', 'md.js'))).href);
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };
const es = (n, entrada, salida) => { const r = md(entrada); ok(n, r === salida, JSON.stringify(r)); };

es('el código inline no se toca por dentro: _x_ sigue siendo _x_', 'usa `def f(_x_): pass` aquí', 'usa <code>def f(_x_): pass</code> aquí');
es('…ni *asteriscos* dentro del código', '`a *b* c` y *fuera*', '<code>a *b* c</code> y <i>fuera</i>');
es('_cursiva_ y *cursiva* fuera del código sí', '_cursiva_ y *otra*', '<i>cursiva</i> y <i>otra</i>');
es('un nombre_con_guiones no se toca', 'usa nombre_con_guiones ya', 'usa nombre_con_guiones ya');
es('**negrita**, `código` y _cursiva_ juntas', '**negrita** `code` _i_', '<b>negrita</b> <code>code</code> <i>i</i>');
es('los bloques ``` siguen intactos', '```js\n_x_ *y*\n```', '<pre class="codeblock"><span class="lang">js</span><code>_x_ *y*</code></pre>');
es('el HTML se escapa, también dentro del código', '<b>`<i>`</b>', '&lt;b&gt;<code>&lt;i&gt;</code>&lt;/b&gt;');
es('títulos y listas', '#### Título\n- uno\n- dos', '<h4>Título</h4><ul><li>uno</li><li>dos</li></ul>');
es('dos códigos inline en la misma línea', '`a_b_` y `*c*`', '<code>a_b_</code> y <code>*c*</code>');

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ MARKDOWN OK — el código no se formatea por dentro');
process.exit(fails ? 1 : 0);
