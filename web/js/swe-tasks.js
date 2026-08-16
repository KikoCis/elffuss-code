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

  // ── Tareas DURAS ────────────────────────────────────────────────────────────
  // Las de arriba tienen ficheros de tres líneas: ahí localizar es gratis y no
  // se parecen en nada a editar un proyecto real. Estas llevan el bug enterrado
  // entre decenas de funciones con nombres que se repiten, indentación mixta y
  // algún CRLF, que es donde la cita del modelo empieza a fallar de verdad.
  {
    id: 'total-iva',
    target: 'src/carrito.js',
    files: {
      'src/carrito.js': `// pago auxiliar 0
export function pagoAux0(valor, opciones = {}) {
  const previo = opciones.previo ?? 0;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 1
export function pagoAux1(valor, opciones = {}) {
  const previo = opciones.previo ?? 1;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 2
export function pagoAux2(valor, opciones = {}) {
  const previo = opciones.previo ?? 2;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 3
export function pagoAux3(valor, opciones = {}) {
  const previo = opciones.previo ?? 3;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 4
export function pagoAux4(valor, opciones = {}) {
  const previo = opciones.previo ?? 4;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 5
export function pagoAux5(valor, opciones = {}) {
  const previo = opciones.previo ?? 5;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 6
export function pagoAux6(valor, opciones = {}) {
  const previo = opciones.previo ?? 6;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 7
export function pagoAux7(valor, opciones = {}) {
  const previo = opciones.previo ?? 7;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 8
export function pagoAux8(valor, opciones = {}) {
  const previo = opciones.previo ?? 8;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 9
export function pagoAux9(valor, opciones = {}) {
  const previo = opciones.previo ?? 9;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 10
export function pagoAux10(valor, opciones = {}) {
  const previo = opciones.previo ?? 10;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 11
export function pagoAux11(valor, opciones = {}) {
  const previo = opciones.previo ?? 11;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 12
export function pagoAux12(valor, opciones = {}) {
  const previo = opciones.previo ?? 12;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 13
export function pagoAux13(valor, opciones = {}) {
  const previo = opciones.previo ?? 13;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 14
export function pagoAux14(valor, opciones = {}) {
  const previo = opciones.previo ?? 14;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 15
export function pagoAux15(valor, opciones = {}) {
  const previo = opciones.previo ?? 15;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 16
export function pagoAux16(valor, opciones = {}) {
  const previo = opciones.previo ?? 16;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 17
export function pagoAux17(valor, opciones = {}) {
  const previo = opciones.previo ?? 17;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 18
export function pagoAux18(valor, opciones = {}) {
  const previo = opciones.previo ?? 18;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 19
export function pagoAux19(valor, opciones = {}) {
  const previo = opciones.previo ?? 19;
  if (valor == null) return previo;
  return valor + previo;
}

// Calcula el total del carrito aplicando descuento e impuestos.
export function totalCarrito(lineas, descuento = 0, iva = 0.21) {
  let suma = 0;
  for (const l of lineas) {
    suma += l.precio * l.unidades;
  }
  const conDescuento = suma - descuento;
  return conDescuento;                       // BUG: no aplica el IVA
}
// pago auxiliar 20
export function pagoAux20(valor, opciones = {}) {
  const previo = opciones.previo ?? 20;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 21
export function pagoAux21(valor, opciones = {}) {
  const previo = opciones.previo ?? 21;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 22
export function pagoAux22(valor, opciones = {}) {
  const previo = opciones.previo ?? 22;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 23
export function pagoAux23(valor, opciones = {}) {
  const previo = opciones.previo ?? 23;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 24
export function pagoAux24(valor, opciones = {}) {
  const previo = opciones.previo ?? 24;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 25
export function pagoAux25(valor, opciones = {}) {
  const previo = opciones.previo ?? 25;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 26
export function pagoAux26(valor, opciones = {}) {
  const previo = opciones.previo ?? 26;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 27
export function pagoAux27(valor, opciones = {}) {
  const previo = opciones.previo ?? 27;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 28
export function pagoAux28(valor, opciones = {}) {
  const previo = opciones.previo ?? 28;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 29
export function pagoAux29(valor, opciones = {}) {
  const previo = opciones.previo ?? 29;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 30
export function pagoAux30(valor, opciones = {}) {
  const previo = opciones.previo ?? 30;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 31
export function pagoAux31(valor, opciones = {}) {
  const previo = opciones.previo ?? 31;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 32
export function pagoAux32(valor, opciones = {}) {
  const previo = opciones.previo ?? 32;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 33
export function pagoAux33(valor, opciones = {}) {
  const previo = opciones.previo ?? 33;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 34
export function pagoAux34(valor, opciones = {}) {
  const previo = opciones.previo ?? 34;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 35
export function pagoAux35(valor, opciones = {}) {
  const previo = opciones.previo ?? 35;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 36
export function pagoAux36(valor, opciones = {}) {
  const previo = opciones.previo ?? 36;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 37
export function pagoAux37(valor, opciones = {}) {
  const previo = opciones.previo ?? 37;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 38
export function pagoAux38(valor, opciones = {}) {
  const previo = opciones.previo ?? 38;
  if (valor == null) return previo;
  return valor + previo;
}

// pago auxiliar 39
export function pagoAux39(valor, opciones = {}) {
  const previo = opciones.previo ?? 39;
  if (valor == null) return previo;
  return valor + previo;
}
`,
      'spec/total-iva.md': '# totalCarrito(lineas, descuento, iva)\nDebe aplicar el IVA al final: totalCarrito([{precio:100,unidades:1}],0,0.21) → 121.',
    },
    task: 'totalCarrito() no aplica el IVA al resultado; arréglalo para que lo aplique después del descuento.',
    test: m => Math.round(m.totalCarrito([{precio:100,unidades:1}],0,0.21)) === 121 && Math.round(m.totalCarrito([{precio:50,unidades:2}],10,0.1)) === 99,
  },
  {
    id: 'recorta-pie',
    target: 'src/texto.js',
    files: {
      'src/texto.js': `// texto auxiliar 0
export function textoAux0(valor, opciones = {}) {
  const previo = opciones.previo ?? 0;
  if (valor == null) return previo;
  return valor + previo;
}

// texto auxiliar 1
export function textoAux1(valor, opciones = {}) {
  const previo = opciones.previo ?? 1;
  if (valor == null) return previo;
  return valor + previo;
}

// texto auxiliar 2
export function textoAux2(valor, opciones = {}) {
  const previo = opciones.previo ?? 2;
  if (valor == null) return previo;
  return valor + previo;
}

// texto auxiliar 3
export function textoAux3(valor, opciones = {}) {
  const previo = opciones.previo ?? 3;
  if (valor == null) return previo;
  return valor + previo;
}

// texto auxiliar 4
export function textoAux4(valor, opciones = {}) {
  const previo = opciones.previo ?? 4;
  if (valor == null) return previo;
  return valor + previo;
}

// texto auxiliar 5
export function textoAux5(valor, opciones = {}) {
  const previo = opciones.previo ?? 5;
  if (valor == null) return previo;
  return valor + previo;
}

// texto auxiliar 6
export function textoAux6(valor, opciones = {}) {
  const previo = opciones.previo ?? 6;
  if (valor == null) return previo;
  return valor + previo;
}

// texto auxiliar 7
export function textoAux7(valor, opciones = {}) {
  const previo = opciones.previo ?? 7;
  if (valor == null) return previo;
  return valor + previo;
}

// texto auxiliar 8
export function textoAux8(valor, opciones = {}) {
  const previo = opciones.previo ?? 8;
  if (valor == null) return previo;
  return valor + previo;
}

// texto auxiliar 9
export function textoAux9(valor, opciones = {}) {
  const previo = opciones.previo ?? 9;
  if (valor == null) return previo;
  return valor + previo;
}

// texto auxiliar 10
export function textoAux10(valor, opciones = {}) {
  const previo = opciones.previo ?? 10;
  if (valor == null) return previo;
  return valor + previo;
}

// texto auxiliar 11
export function textoAux11(valor, opciones = {}) {
  const previo = opciones.previo ?? 11;
  if (valor == null) return previo;
  return valor + previo;
}

export function recortaTitulo(s, max = 30) {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

export function recortaResumen(s, max = 30) {
  if (s.length <= max) return s;
  return s.slice(0, max);
}

export function recortaPie(s, max = 30) {
  if (s.length <= max) return s;
  return s.slice(0, max);                    // BUG: aquí SÍ hay que poner puntos suspensivos
}
// texto auxiliar 12
export function textoAux12(valor, opciones = {}) {
  const previo = opciones.previo ?? 12;
  if (valor == null) return previo;
  return valor + previo;
}

// texto auxiliar 13
export function textoAux13(valor, opciones = {}) {
  const previo = opciones.previo ?? 13;
  if (valor == null) return previo;
  return valor + previo;
}

// texto auxiliar 14
export function textoAux14(valor, opciones = {}) {
  const previo = opciones.previo ?? 14;
  if (valor == null) return previo;
  return valor + previo;
}

// texto auxiliar 15
export function textoAux15(valor, opciones = {}) {
  const previo = opciones.previo ?? 15;
  if (valor == null) return previo;
  return valor + previo;
}

// texto auxiliar 16
export function textoAux16(valor, opciones = {}) {
  const previo = opciones.previo ?? 16;
  if (valor == null) return previo;
  return valor + previo;
}

// texto auxiliar 17
export function textoAux17(valor, opciones = {}) {
  const previo = opciones.previo ?? 17;
  if (valor == null) return previo;
  return valor + previo;
}

// texto auxiliar 18
export function textoAux18(valor, opciones = {}) {
  const previo = opciones.previo ?? 18;
  if (valor == null) return previo;
  return valor + previo;
}

// texto auxiliar 19
export function textoAux19(valor, opciones = {}) {
  const previo = opciones.previo ?? 19;
  if (valor == null) return previo;
  return valor + previo;
}

// texto auxiliar 20
export function textoAux20(valor, opciones = {}) {
  const previo = opciones.previo ?? 20;
  if (valor == null) return previo;
  return valor + previo;
}

// texto auxiliar 21
export function textoAux21(valor, opciones = {}) {
  const previo = opciones.previo ?? 21;
  if (valor == null) return previo;
  return valor + previo;
}

// texto auxiliar 22
export function textoAux22(valor, opciones = {}) {
  const previo = opciones.previo ?? 22;
  if (valor == null) return previo;
  return valor + previo;
}

// texto auxiliar 23
export function textoAux23(valor, opciones = {}) {
  const previo = opciones.previo ?? 23;
  if (valor == null) return previo;
  return valor + previo;
}
`,
      'spec/recorta-pie.md': '# recortaPie(s, max)\nSolo recortaPie debe terminar en «…» cuando recorta. Las otras dos NO cambian.',
    },
    task: 'recortaPie() debe añadir «…» al final cuando recorta. recortaTitulo y recortaResumen deben quedarse EXACTAMENTE como están.',
    // Lo que mide esta tarea es la DISCRIMINACIÓN entre tres cuerpos idénticos, no
    // si el modelo escribe «…» o «...»: las dos son respuestas razonables a la spec.
    test: m => { const r = m.recortaPie('a'.repeat(40));
      return r.startsWith('a'.repeat(30)) && /(…|\.\.\.)$/.test(r)
        && m.recortaTitulo('a'.repeat(40)) === 'a'.repeat(30)
        && m.recortaResumen('a'.repeat(40)) === 'a'.repeat(30); },
  },
  {
    id: 'dias-entre',
    target: 'src/fecha.js',
    files: {
      'src/fecha.js': `// fecha auxiliar 0
export function fechaAux0(valor, opciones = {}) {
  const previo = opciones.previo ?? 0;
  if (valor == null) return previo;
  return valor + previo;
}

// fecha auxiliar 1
export function fechaAux1(valor, opciones = {}) {
  const previo = opciones.previo ?? 1;
  if (valor == null) return previo;
  return valor + previo;
}

// fecha auxiliar 2
export function fechaAux2(valor, opciones = {}) {
  const previo = opciones.previo ?? 2;
  if (valor == null) return previo;
  return valor + previo;
}

// fecha auxiliar 3
export function fechaAux3(valor, opciones = {}) {
  const previo = opciones.previo ?? 3;
  if (valor == null) return previo;
  return valor + previo;
}

// fecha auxiliar 4
export function fechaAux4(valor, opciones = {}) {
  const previo = opciones.previo ?? 4;
  if (valor == null) return previo;
  return valor + previo;
}

// fecha auxiliar 5
export function fechaAux5(valor, opciones = {}) {
  const previo = opciones.previo ?? 5;
  if (valor == null) return previo;
  return valor + previo;
}

// fecha auxiliar 6
export function fechaAux6(valor, opciones = {}) {
  const previo = opciones.previo ?? 6;
  if (valor == null) return previo;
  return valor + previo;
}

// fecha auxiliar 7
export function fechaAux7(valor, opciones = {}) {
  const previo = opciones.previo ?? 7;
  if (valor == null) return previo;
  return valor + previo;
}

// fecha auxiliar 8
export function fechaAux8(valor, opciones = {}) {
  const previo = opciones.previo ?? 8;
  if (valor == null) return previo;
  return valor + previo;
}

// fecha auxiliar 9
export function fechaAux9(valor, opciones = {}) {
  const previo = opciones.previo ?? 9;
  if (valor == null) return previo;
  return valor + previo;
}

// fecha auxiliar 10
export function fechaAux10(valor, opciones = {}) {
  const previo = opciones.previo ?? 10;
  if (valor == null) return previo;
  return valor + previo;
}

// fecha auxiliar 11
export function fechaAux11(valor, opciones = {}) {
  const previo = opciones.previo ?? 11;
  if (valor == null) return previo;
  return valor + previo;
}

// fecha auxiliar 12
export function fechaAux12(valor, opciones = {}) {
  const previo = opciones.previo ?? 12;
  if (valor == null) return previo;
  return valor + previo;
}

// fecha auxiliar 13
export function fechaAux13(valor, opciones = {}) {
  const previo = opciones.previo ?? 13;
  if (valor == null) return previo;
  return valor + previo;
}

// fecha auxiliar 14
export function fechaAux14(valor, opciones = {}) {
  const previo = opciones.previo ?? 14;
  if (valor == null) return previo;
  return valor + previo;
}

export function diasEntre(a, b) {
	const ms = Math.abs(new Date(b) - new Date(a));
	return Math.floor(ms / 86400000) + 1;      // BUG: el +1 sobra
}
// fecha auxiliar 15
export function fechaAux15(valor, opciones = {}) {
  const previo = opciones.previo ?? 15;
  if (valor == null) return previo;
  return valor + previo;
}

// fecha auxiliar 16
export function fechaAux16(valor, opciones = {}) {
  const previo = opciones.previo ?? 16;
  if (valor == null) return previo;
  return valor + previo;
}

// fecha auxiliar 17
export function fechaAux17(valor, opciones = {}) {
  const previo = opciones.previo ?? 17;
  if (valor == null) return previo;
  return valor + previo;
}

// fecha auxiliar 18
export function fechaAux18(valor, opciones = {}) {
  const previo = opciones.previo ?? 18;
  if (valor == null) return previo;
  return valor + previo;
}

// fecha auxiliar 19
export function fechaAux19(valor, opciones = {}) {
  const previo = opciones.previo ?? 19;
  if (valor == null) return previo;
  return valor + previo;
}

// fecha auxiliar 20
export function fechaAux20(valor, opciones = {}) {
  const previo = opciones.previo ?? 20;
  if (valor == null) return previo;
  return valor + previo;
}

// fecha auxiliar 21
export function fechaAux21(valor, opciones = {}) {
  const previo = opciones.previo ?? 21;
  if (valor == null) return previo;
  return valor + previo;
}

// fecha auxiliar 22
export function fechaAux22(valor, opciones = {}) {
  const previo = opciones.previo ?? 22;
  if (valor == null) return previo;
  return valor + previo;
}

// fecha auxiliar 23
export function fechaAux23(valor, opciones = {}) {
  const previo = opciones.previo ?? 23;
  if (valor == null) return previo;
  return valor + previo;
}

// fecha auxiliar 24
export function fechaAux24(valor, opciones = {}) {
  const previo = opciones.previo ?? 24;
  if (valor == null) return previo;
  return valor + previo;
}

// fecha auxiliar 25
export function fechaAux25(valor, opciones = {}) {
  const previo = opciones.previo ?? 25;
  if (valor == null) return previo;
  return valor + previo;
}

// fecha auxiliar 26
export function fechaAux26(valor, opciones = {}) {
  const previo = opciones.previo ?? 26;
  if (valor == null) return previo;
  return valor + previo;
}

// fecha auxiliar 27
export function fechaAux27(valor, opciones = {}) {
  const previo = opciones.previo ?? 27;
  if (valor == null) return previo;
  return valor + previo;
}

// fecha auxiliar 28
export function fechaAux28(valor, opciones = {}) {
  const previo = opciones.previo ?? 28;
  if (valor == null) return previo;
  return valor + previo;
}

// fecha auxiliar 29
export function fechaAux29(valor, opciones = {}) {
  const previo = opciones.previo ?? 29;
  if (valor == null) return previo;
  return valor + previo;
}
`,
      'spec/dias-entre.md': '# diasEntre(a, b)\ndiasEntre("2026-01-01","2026-01-03") → 2. No se suma un día extra.',
    },
    task: 'diasEntre() devuelve un día de más; quita ese +1.',
    test: m => m.diasEntre('2026-01-01','2026-01-03') === 2 && m.diasEntre('2026-01-01','2026-01-01') === 0,
  },
  {
    id: 'dos-sitios',
    target: 'src/valida.js',
    files: {
      'src/valida.js': `// valida auxiliar 0
export function validaAux0(valor, opciones = {}) {
  const previo = opciones.previo ?? 0;
  if (valor == null) return previo;
  return valor + previo;
}

// valida auxiliar 1
export function validaAux1(valor, opciones = {}) {
  const previo = opciones.previo ?? 1;
  if (valor == null) return previo;
  return valor + previo;
}

// valida auxiliar 2
export function validaAux2(valor, opciones = {}) {
  const previo = opciones.previo ?? 2;
  if (valor == null) return previo;
  return valor + previo;
}

// valida auxiliar 3
export function validaAux3(valor, opciones = {}) {
  const previo = opciones.previo ?? 3;
  if (valor == null) return previo;
  return valor + previo;
}

// valida auxiliar 4
export function validaAux4(valor, opciones = {}) {
  const previo = opciones.previo ?? 4;
  if (valor == null) return previo;
  return valor + previo;
}

// valida auxiliar 5
export function validaAux5(valor, opciones = {}) {
  const previo = opciones.previo ?? 5;
  if (valor == null) return previo;
  return valor + previo;
}

// valida auxiliar 6
export function validaAux6(valor, opciones = {}) {
  const previo = opciones.previo ?? 6;
  if (valor == null) return previo;
  return valor + previo;
}

// valida auxiliar 7
export function validaAux7(valor, opciones = {}) {
  const previo = opciones.previo ?? 7;
  if (valor == null) return previo;
  return valor + previo;
}

// valida auxiliar 8
export function validaAux8(valor, opciones = {}) {
  const previo = opciones.previo ?? 8;
  if (valor == null) return previo;
  return valor + previo;
}

// valida auxiliar 9
export function validaAux9(valor, opciones = {}) {
  const previo = opciones.previo ?? 9;
  if (valor == null) return previo;
  return valor + previo;
}

const MINIMO = 3;

export function validaUsuario(nombre) {
  if (nombre.length < MINIMO) return false;   // BUG: debe ser <= para exigir MÁS de 3
  return true;
}

export function validaAlias(alias) {
  if (alias.length < MINIMO) return false;    // BUG: mismo fallo aquí
  return true;
}
// valida auxiliar 10
export function validaAux10(valor, opciones = {}) {
  const previo = opciones.previo ?? 10;
  if (valor == null) return previo;
  return valor + previo;
}

// valida auxiliar 11
export function validaAux11(valor, opciones = {}) {
  const previo = opciones.previo ?? 11;
  if (valor == null) return previo;
  return valor + previo;
}

// valida auxiliar 12
export function validaAux12(valor, opciones = {}) {
  const previo = opciones.previo ?? 12;
  if (valor == null) return previo;
  return valor + previo;
}

// valida auxiliar 13
export function validaAux13(valor, opciones = {}) {
  const previo = opciones.previo ?? 13;
  if (valor == null) return previo;
  return valor + previo;
}

// valida auxiliar 14
export function validaAux14(valor, opciones = {}) {
  const previo = opciones.previo ?? 14;
  if (valor == null) return previo;
  return valor + previo;
}

// valida auxiliar 15
export function validaAux15(valor, opciones = {}) {
  const previo = opciones.previo ?? 15;
  if (valor == null) return previo;
  return valor + previo;
}

// valida auxiliar 16
export function validaAux16(valor, opciones = {}) {
  const previo = opciones.previo ?? 16;
  if (valor == null) return previo;
  return valor + previo;
}

// valida auxiliar 17
export function validaAux17(valor, opciones = {}) {
  const previo = opciones.previo ?? 17;
  if (valor == null) return previo;
  return valor + previo;
}

// valida auxiliar 18
export function validaAux18(valor, opciones = {}) {
  const previo = opciones.previo ?? 18;
  if (valor == null) return previo;
  return valor + previo;
}

// valida auxiliar 19
export function validaAux19(valor, opciones = {}) {
  const previo = opciones.previo ?? 19;
  if (valor == null) return previo;
  return valor + previo;
}
`,
      'spec/dos-sitios.md': '# validaUsuario / validaAlias\nAmbas deben exigir MÁS de 3 caracteres: una cadena de 3 es inválida, una de 4 es válida.',
    },
    task: 'validaUsuario() y validaAlias() aceptan cadenas de 3 caracteres y no deberían: hay que exigir más de 3 en LAS DOS.',
    test: m => m.validaUsuario('abc')===false && m.validaUsuario('abcd')===true && m.validaAlias('abc')===false && m.validaAlias('abcd')===true,
  },
  {
    id: 'orden-descendente',
    target: 'src/informe.js',
    files: {
      'src/informe.js': `// informe auxiliar 0
export function informeAux0(valor, opciones = {}) {
  const previo = opciones.previo ?? 0;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 1
export function informeAux1(valor, opciones = {}) {
  const previo = opciones.previo ?? 1;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 2
export function informeAux2(valor, opciones = {}) {
  const previo = opciones.previo ?? 2;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 3
export function informeAux3(valor, opciones = {}) {
  const previo = opciones.previo ?? 3;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 4
export function informeAux4(valor, opciones = {}) {
  const previo = opciones.previo ?? 4;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 5
export function informeAux5(valor, opciones = {}) {
  const previo = opciones.previo ?? 5;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 6
export function informeAux6(valor, opciones = {}) {
  const previo = opciones.previo ?? 6;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 7
export function informeAux7(valor, opciones = {}) {
  const previo = opciones.previo ?? 7;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 8
export function informeAux8(valor, opciones = {}) {
  const previo = opciones.previo ?? 8;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 9
export function informeAux9(valor, opciones = {}) {
  const previo = opciones.previo ?? 9;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 10
export function informeAux10(valor, opciones = {}) {
  const previo = opciones.previo ?? 10;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 11
export function informeAux11(valor, opciones = {}) {
  const previo = opciones.previo ?? 11;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 12
export function informeAux12(valor, opciones = {}) {
  const previo = opciones.previo ?? 12;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 13
export function informeAux13(valor, opciones = {}) {
  const previo = opciones.previo ?? 13;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 14
export function informeAux14(valor, opciones = {}) {
  const previo = opciones.previo ?? 14;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 15
export function informeAux15(valor, opciones = {}) {
  const previo = opciones.previo ?? 15;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 16
export function informeAux16(valor, opciones = {}) {
  const previo = opciones.previo ?? 16;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 17
export function informeAux17(valor, opciones = {}) {
  const previo = opciones.previo ?? 17;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 18
export function informeAux18(valor, opciones = {}) {
  const previo = opciones.previo ?? 18;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 19
export function informeAux19(valor, opciones = {}) {
  const previo = opciones.previo ?? 19;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 20
export function informeAux20(valor, opciones = {}) {
  const previo = opciones.previo ?? 20;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 21
export function informeAux21(valor, opciones = {}) {
  const previo = opciones.previo ?? 21;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 22
export function informeAux22(valor, opciones = {}) {
  const previo = opciones.previo ?? 22;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 23
export function informeAux23(valor, opciones = {}) {
  const previo = opciones.previo ?? 23;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 24
export function informeAux24(valor, opciones = {}) {
  const previo = opciones.previo ?? 24;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 25
export function informeAux25(valor, opciones = {}) {
  const previo = opciones.previo ?? 25;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 26
export function informeAux26(valor, opciones = {}) {
  const previo = opciones.previo ?? 26;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 27
export function informeAux27(valor, opciones = {}) {
  const previo = opciones.previo ?? 27;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 28
export function informeAux28(valor, opciones = {}) {
  const previo = opciones.previo ?? 28;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 29
export function informeAux29(valor, opciones = {}) {
  const previo = opciones.previo ?? 29;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 30
export function informeAux30(valor, opciones = {}) {
  const previo = opciones.previo ?? 30;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 31
export function informeAux31(valor, opciones = {}) {
  const previo = opciones.previo ?? 31;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 32
export function informeAux32(valor, opciones = {}) {
  const previo = opciones.previo ?? 32;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 33
export function informeAux33(valor, opciones = {}) {
  const previo = opciones.previo ?? 33;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 34
export function informeAux34(valor, opciones = {}) {
  const previo = opciones.previo ?? 34;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 35
export function informeAux35(valor, opciones = {}) {
  const previo = opciones.previo ?? 35;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 36
export function informeAux36(valor, opciones = {}) {
  const previo = opciones.previo ?? 36;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 37
export function informeAux37(valor, opciones = {}) {
  const previo = opciones.previo ?? 37;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 38
export function informeAux38(valor, opciones = {}) {
  const previo = opciones.previo ?? 38;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 39
export function informeAux39(valor, opciones = {}) {
  const previo = opciones.previo ?? 39;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 40
export function informeAux40(valor, opciones = {}) {
  const previo = opciones.previo ?? 40;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 41
export function informeAux41(valor, opciones = {}) {
  const previo = opciones.previo ?? 41;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 42
export function informeAux42(valor, opciones = {}) {
  const previo = opciones.previo ?? 42;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 43
export function informeAux43(valor, opciones = {}) {
  const previo = opciones.previo ?? 43;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 44
export function informeAux44(valor, opciones = {}) {
  const previo = opciones.previo ?? 44;
  if (valor == null) return previo;
  return valor + previo;
}

export function ordenaPorFecha(filas) {
  return filas.slice().sort((a, b) => a.fecha - b.fecha);   // BUG: debe ser descendente
}
// informe auxiliar 45
export function informeAux45(valor, opciones = {}) {
  const previo = opciones.previo ?? 45;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 46
export function informeAux46(valor, opciones = {}) {
  const previo = opciones.previo ?? 46;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 47
export function informeAux47(valor, opciones = {}) {
  const previo = opciones.previo ?? 47;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 48
export function informeAux48(valor, opciones = {}) {
  const previo = opciones.previo ?? 48;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 49
export function informeAux49(valor, opciones = {}) {
  const previo = opciones.previo ?? 49;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 50
export function informeAux50(valor, opciones = {}) {
  const previo = opciones.previo ?? 50;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 51
export function informeAux51(valor, opciones = {}) {
  const previo = opciones.previo ?? 51;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 52
export function informeAux52(valor, opciones = {}) {
  const previo = opciones.previo ?? 52;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 53
export function informeAux53(valor, opciones = {}) {
  const previo = opciones.previo ?? 53;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 54
export function informeAux54(valor, opciones = {}) {
  const previo = opciones.previo ?? 54;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 55
export function informeAux55(valor, opciones = {}) {
  const previo = opciones.previo ?? 55;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 56
export function informeAux56(valor, opciones = {}) {
  const previo = opciones.previo ?? 56;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 57
export function informeAux57(valor, opciones = {}) {
  const previo = opciones.previo ?? 57;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 58
export function informeAux58(valor, opciones = {}) {
  const previo = opciones.previo ?? 58;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 59
export function informeAux59(valor, opciones = {}) {
  const previo = opciones.previo ?? 59;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 60
export function informeAux60(valor, opciones = {}) {
  const previo = opciones.previo ?? 60;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 61
export function informeAux61(valor, opciones = {}) {
  const previo = opciones.previo ?? 61;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 62
export function informeAux62(valor, opciones = {}) {
  const previo = opciones.previo ?? 62;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 63
export function informeAux63(valor, opciones = {}) {
  const previo = opciones.previo ?? 63;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 64
export function informeAux64(valor, opciones = {}) {
  const previo = opciones.previo ?? 64;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 65
export function informeAux65(valor, opciones = {}) {
  const previo = opciones.previo ?? 65;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 66
export function informeAux66(valor, opciones = {}) {
  const previo = opciones.previo ?? 66;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 67
export function informeAux67(valor, opciones = {}) {
  const previo = opciones.previo ?? 67;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 68
export function informeAux68(valor, opciones = {}) {
  const previo = opciones.previo ?? 68;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 69
export function informeAux69(valor, opciones = {}) {
  const previo = opciones.previo ?? 69;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 70
export function informeAux70(valor, opciones = {}) {
  const previo = opciones.previo ?? 70;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 71
export function informeAux71(valor, opciones = {}) {
  const previo = opciones.previo ?? 71;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 72
export function informeAux72(valor, opciones = {}) {
  const previo = opciones.previo ?? 72;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 73
export function informeAux73(valor, opciones = {}) {
  const previo = opciones.previo ?? 73;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 74
export function informeAux74(valor, opciones = {}) {
  const previo = opciones.previo ?? 74;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 75
export function informeAux75(valor, opciones = {}) {
  const previo = opciones.previo ?? 75;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 76
export function informeAux76(valor, opciones = {}) {
  const previo = opciones.previo ?? 76;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 77
export function informeAux77(valor, opciones = {}) {
  const previo = opciones.previo ?? 77;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 78
export function informeAux78(valor, opciones = {}) {
  const previo = opciones.previo ?? 78;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 79
export function informeAux79(valor, opciones = {}) {
  const previo = opciones.previo ?? 79;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 80
export function informeAux80(valor, opciones = {}) {
  const previo = opciones.previo ?? 80;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 81
export function informeAux81(valor, opciones = {}) {
  const previo = opciones.previo ?? 81;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 82
export function informeAux82(valor, opciones = {}) {
  const previo = opciones.previo ?? 82;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 83
export function informeAux83(valor, opciones = {}) {
  const previo = opciones.previo ?? 83;
  if (valor == null) return previo;
  return valor + previo;
}

// informe auxiliar 84
export function informeAux84(valor, opciones = {}) {
  const previo = opciones.previo ?? 84;
  if (valor == null) return previo;
  return valor + previo;
}
`,
      'spec/orden-descendente.md': '# ordenaPorFecha(filas)\nDe más reciente a más antigua.',
    },
    task: 'ordenaPorFecha() ordena de más antigua a más reciente; debe ser al revés, la más reciente primero.',
    test: m => { const r = m.ordenaPorFecha([{fecha:1},{fecha:3},{fecha:2}]); return r[0].fecha===3 && r[2].fecha===1; },
  },
];
