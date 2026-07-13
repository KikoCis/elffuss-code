// Batería de tareas estilo SWE-bench, autocontenidas y REPRODUCIBLES en el
// navegador: cada una siembra un repo con un BUG + una especificación (lo que el
// test espera), y un `test(mod)` que se EJECUTA de verdad contra el módulo
// arreglado (métrica `resolved`, como SWE-bench). `solution` es el contenido
// correcto del fichero objetivo (lo usa el solver determinista del arnés; el
// modelo real no lo ve, tiene que deducirlo leyendo `target` y la spec).
export const TASKS = [
  {
    id: 'add-sub',
    target: 'src/math.js',
    files: {
      'src/math.js': 'export function add(a, b) {\n  return a - b; // BUG\n}\n',
      'spec/math.md': '# add(a, b)\nDebe SUMAR: add(2,3) → 5, add(10,-4) → 6.',
    },
    task: 'add() en src/math.js resta en vez de sumar; arréglalo para que sume.',
    solution: 'export function add(a, b) {\n  return a + b;\n}\n',
    test: m => m.add(2, 3) === 5 && m.add(10, -4) === 6 && m.add(0, 0) === 0,
  },
  {
    id: 'max-empty',
    target: 'src/max.js',
    files: {
      'src/max.js': 'export function max(arr) {\n  return arr.reduce((a, b) => a > b ? a : b); // BUG: peta con []\n}\n',
      'spec/max.md': '# max(arr)\nmax([3,1,2]) → 3. Con array vacío NO debe petar: max([]) → undefined.',
    },
    task: 'max() peta con un array vacío; haz que devuelva undefined en ese caso.',
    solution: 'export function max(arr) {\n  if (!arr.length) return undefined;\n  return arr.reduce((a, b) => a > b ? a : b);\n}\n',
    test: m => m.max([3, 1, 2]) === 3 && m.max([]) === undefined && m.max([-1, -5]) === -1,
  },
  {
    id: 'unique',
    target: 'src/unique.js',
    files: {
      'src/unique.js': 'export function unique(arr) {\n  return arr; // BUG: no deduplica\n}\n',
      'spec/unique.md': '# unique(arr)\nDevuelve el array SIN duplicados: unique([1,1,2,3,3]) → [1,2,3].',
    },
    task: 'unique() no elimina duplicados; arréglalo.',
    solution: 'export function unique(arr) {\n  return [...new Set(arr)];\n}\n',
    test: m => { const r = m.unique([1, 1, 2, 3, 3]); return r.length === 3 && r.join(',') === '1,2,3'; },
  },
  {
    id: 'slugify',
    target: 'src/slug.js',
    files: {
      'src/slug.js': 'export function slugify(s) {\n  return s.replace(/ /g, "-"); // BUG: no pasa a minúsculas\n}\n',
      'spec/slug.md': '# slugify(s)\nMinúsculas y guiones: slugify("Hola Mundo") → "hola-mundo".',
    },
    task: 'slugify() no pasa a minúsculas; debe devolver minúsculas con guiones.',
    solution: 'export function slugify(s) {\n  return s.toLowerCase().replace(/ /g, "-");\n}\n',
    test: m => m.slugify('Hola Mundo') === 'hola-mundo' && m.slugify('A B C') === 'a-b-c',
  },
  {
    id: 'clamp',
    target: 'src/clamp.js',
    files: {
      'src/clamp.js': 'export function clamp(v, lo, hi) {\n  return v; // BUG: no acota\n}\n',
      'spec/clamp.md': '# clamp(v, lo, hi)\nAcota v al rango [lo,hi]: clamp(15,0,10) → 10, clamp(-5,0,10) → 0.',
    },
    task: 'clamp() no acota el valor al rango [lo,hi]; arréglalo.',
    solution: 'export function clamp(v, lo, hi) {\n  return Math.min(hi, Math.max(lo, v));\n}\n',
    test: m => m.clamp(15, 0, 10) === 10 && m.clamp(-5, 0, 10) === 0 && m.clamp(5, 0, 10) === 5,
  },
  {
    id: 'fizzbuzz',
    target: 'src/fizzbuzz.js',
    files: {
      'src/fizzbuzz.js': 'export function fizzbuzz(n) {\n  if (n % 3 === 0) return "Fizz";\n  if (n % 5 === 0) return "Buzz";\n  if (n % 15 === 0) return "FizzBuzz"; // BUG: inalcanzable\n  return String(n);\n}\n',
      'spec/fizzbuzz.md': '# fizzbuzz(n)\nMúltiplo de 15 → "FizzBuzz", de 3 → "Fizz", de 5 → "Buzz", si no el número.',
    },
    task: 'fizzbuzz(15) debería dar "FizzBuzz" pero da "Fizz"; el caso de 15 es inalcanzable, arréglalo.',
    solution: 'export function fizzbuzz(n) {\n  if (n % 15 === 0) return "FizzBuzz";\n  if (n % 3 === 0) return "Fizz";\n  if (n % 5 === 0) return "Buzz";\n  return String(n);\n}\n',
    test: m => m.fizzbuzz(15) === 'FizzBuzz' && m.fizzbuzz(9) === 'Fizz' && m.fizzbuzz(10) === 'Buzz' && m.fizzbuzz(7) === '7',
  },
];
