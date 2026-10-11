// Los ficheros de texto del repo son texto para git: ninguno lleva un byte NUL
// literal. Con uno dentro, git trata el fichero entero como binario: `git diff`
// solo dice «Binary files differ» y `git grep -I` se lo salta, así que nada de lo
// que cambia en él se ve al revisar ni al barrer el diff antes de publicar. Pasó
// con md.js y arch.js (un centinela '\0' escrito tal cual); dentro de una cadena
// se escribe '\u0000', que es lo mismo para JavaScript.
//
//   node tests/texto-plano.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const TEXTO = new Set(['.js', '.mjs', '.cjs', '.css', '.html', '.json', '.md', '.py', '.sh', '.go', '.txt', '.svg', '.webmanifest', '.yml', '.yaml']);
const FUERA = new Set(['node_modules', '.git']);

let fallos = 0, vistos = 0;
const ok = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? '  — ' + e : ''}`); if (!c) fallos++; };

const conNul = [];
function recorre(dir) {
  for (const nombre of readdirSync(dir)) {
    if (FUERA.has(nombre)) continue;
    const ruta = join(dir, nombre);
    const st = statSync(ruta, { throwIfNoEntry: false });
    if (!st) continue;
    if (st.isDirectory()) { recorre(ruta); continue; }
    if (!TEXTO.has(extname(nombre).toLowerCase())) continue;
    vistos++;
    if (readFileSync(ruta).includes(0)) conNul.push(relative(RAIZ, ruta));
  }
}
recorre(RAIZ);

ok(`se revisan los ficheros de texto del repo (${vistos})`, vistos > 50, `${vistos} ficheros`);
ok('ninguno lleva un byte NUL literal (git lo trataría como binario)', conNul.length === 0, conNul.join(', '));
console.log(fallos ? `\n❌ ${fallos} FALLO(S)` : '\n✅ TEXTO PLANO: git ve todos los ficheros de texto como texto');
process.exit(fallos ? 1 : 0);
