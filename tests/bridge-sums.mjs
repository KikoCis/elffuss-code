// web/bridge-dl/SHA256SUMS dice la verdad sobre los binarios que se descargan.
//
// Ajustes enseña la huella SHA-256 de cada descarga del bridge (sale de este
// fichero) para que se pueda comprobar antes de ejecutarlo. Si alguien
// recompila los binarios y no regenera SHA256SUMS, la página enseñaría huellas
// que no casan: esta prueba lo impide. Para regenerarlo:
//   cd web/bridge-dl && shasum -a 256 elffuss-bridge-* > SHA256SUMS
//
//   node tests/bridge-sums.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'bridge-dl');
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const binarios = readdirSync(DIR).filter(f => f.startsWith('elffuss-bridge-')).sort();
const lineas = readFileSync(join(DIR, 'SHA256SUMS'), 'utf8').split('\n').filter(Boolean);
const sumas = new Map(lineas.map(l => { const m = l.match(/^([0-9a-f]{64})\s+\*?(\S+)$/); return m ? [m[2], m[1]] : [l, null]; }));
ok('cada línea de SHA256SUMS tiene el formato de shasum -a 256', [...sumas.values()].every(Boolean), JSON.stringify(lineas.filter(l => !/^[0-9a-f]{64}\s+\S+$/.test(l))));
ok('hay un binario para cada línea, y una línea para cada binario', JSON.stringify([...sumas.keys()].sort()) === JSON.stringify(binarios), JSON.stringify({ binarios, sumas: [...sumas.keys()] }));
for (const f of binarios) {
  const real = createHash('sha256').update(readFileSync(join(DIR, f))).digest('hex');
  ok(`la huella de ${f} es la del fichero`, sumas.get(f) === real, sumas.get(f) === real ? real.slice(0, 16) + '…' : `${sumas.get(f)} ≠ ${real}`);
}
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ SHA256SUMS casa con los binarios del bridge');
process.exit(fails ? 1 : 0);
