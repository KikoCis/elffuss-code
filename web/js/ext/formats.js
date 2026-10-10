// Formatos que traen las extensiones de VS Code: JSON con comentarios (JSONC),
// plist XML (.tmTheme / .tmLanguage) y colores hex. Sin DOM ni dependencias:
// se prueban en Node igual que en el navegador.

// Nombres que un objeto normal hereda de Object.prototype (más «prototype»).
// Usados como clave de un objeto de datos, una búsqueda sale del objeto y una
// escritura toca el prototipo: los datos de una extensión nunca deben llegar
// con ellos a donde se busca o se escribe por nombre.
export const NOMBRES_PROTO = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);

// JSONC como lo lee VS Code: comentarios // y /* */ y comas finales. Recorre
// el texto respetando las cadenas, así un "http://…" dentro de un string no se
// toma por comentario.
export function parseJsonc(text) {
  const s = String(text ?? '').replace(/^﻿/, '');
  let out = '';
  let coma = false;                       // coma pendiente: se escribe solo si no cierra
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === '"') {
      if (coma) { out += ','; coma = false; }
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
      out += s.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '/' && s[i + 1] === '/') { const e = s.indexOf('\n', i); i = e < 0 ? s.length : e; continue; }
    if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? s.length : e + 2; continue; }
    if (c === ',') { if (coma) out += ','; coma = true; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { out += c; i++; continue; }
    if (coma) { if (c !== '}' && c !== ']') out += ','; coma = false; }
    out += c;
    i++;
  }
  if (coma) out += ',';
  return JSON.parse(out);
}

// plist XML de Apple (temas .tmTheme y gramáticas .tmLanguage). Analizador
// propio y mínimo: nunca resuelve entidades externas ni DTD, y funciona sin DOM.
const ENTIDADES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
function desentidad(t) {
  return t.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return ENTIDADES[e] ?? m;
  });
}

export function parsePlist(text) {
  const s = String(text ?? '').replace(/^﻿/, '');
  let i = 0;
  const fallo = msg => { throw Object.assign(new Error(`plist: ${msg} (posición ${i})`), { code: 'plist' }); };

  // salta espacios, comentarios, <?xml?> y <!DOCTYPE>
  function saltaRelleno() {
    for (;;) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (s.startsWith('<!--', i)) { const e = s.indexOf('-->', i + 4); i = e < 0 ? s.length : e + 3; continue; }
      if (s.startsWith('<?', i)) { const e = s.indexOf('?>', i + 2); i = e < 0 ? s.length : e + 2; continue; }
      if (s.startsWith('<!DOCTYPE', i) || s.startsWith('<!doctype', i)) { const e = s.indexOf('>', i); i = e < 0 ? s.length : e + 1; continue; }
      return;
    }
  }
  // lee una etiqueta: { nombre, cierre, vacia }
  function etiqueta() {
    saltaRelleno();
    if (s[i] !== '<') fallo('se esperaba una etiqueta');
    const e = s.indexOf('>', i);
    if (e < 0) fallo('etiqueta sin cerrar');
    let cuerpo = s.slice(i + 1, e).trim();
    i = e + 1;
    const cierre = cuerpo.startsWith('/');
    const vacia = cuerpo.endsWith('/');
    cuerpo = cuerpo.replace(/^\//, '').replace(/\/$/, '').trim();
    return { nombre: cuerpo.split(/\s+/)[0], cierre, vacia };
  }
  // texto hasta </nombre>, con CDATA y entidades
  function texto(nombre) {
    let out = '';
    for (;;) {
      if (i >= s.length) fallo(`falta </${nombre}>`);
      if (s.startsWith('<![CDATA[', i)) {
        const e = s.indexOf(']]>', i + 9);
        if (e < 0) fallo('CDATA sin cerrar');
        out += s.slice(i + 9, e);
        i = e + 3;
      } else if (s.startsWith('<!--', i)) {
        const e = s.indexOf('-->', i + 4);
        i = e < 0 ? s.length : e + 3;
      } else if (s[i] === '<') {
        const t = etiqueta();
        if (!t.cierre || t.nombre !== nombre) fallo(`se esperaba </${nombre}>`);
        return out;
      } else {
        const e = s.indexOf('<', i);
        const trozo = e < 0 ? s.slice(i) : s.slice(i, e);
        out += desentidad(trozo);
        i = e < 0 ? s.length : e;
      }
    }
  }
  function valor(t) {
    switch (t.nombre) {
      case 'dict': {
        const o = {};
        if (t.vacia) return o;
        for (;;) {
          const k = etiqueta();
          if (k.cierre && k.nombre === 'dict') return o;
          if (k.nombre !== 'key') fallo('se esperaba <key>');
          const clave = k.vacia ? '' : texto('key');
          const v = etiqueta();
          if (v.cierre) fallo('falta el valor de ' + clave);
          const x = valor(v);
          if (clave !== '__proto__') o[clave] = x;     // asignarla cambiaría el prototipo de `o`
        }
      }
      case 'array': {
        const a = [];
        if (t.vacia) return a;
        for (;;) {
          const v = etiqueta();
          if (v.cierre && v.nombre === 'array') return a;
          if (v.cierre) fallo('cierre inesperado');
          a.push(valor(v));
        }
      }
      case 'string': case 'date': case 'data': return t.vacia ? '' : texto(t.nombre);
      case 'integer': return t.vacia ? 0 : parseInt(texto('integer'), 10);
      case 'real': return t.vacia ? 0 : parseFloat(texto('real'));
      case 'true': if (!t.vacia) texto('true'); return true;
      case 'false': if (!t.vacia) texto('false'); return false;
      default: return fallo('etiqueta desconocida <' + t.nombre + '>');
    }
  }
  const raiz = etiqueta();
  if (raiz.nombre !== 'plist') return valor(raiz);   // plist sin envoltorio
  if (raiz.vacia) return null;
  const v = etiqueta();
  if (v.cierre) return null;
  return valor(v);
}

// Colores: solo #rgb, #rgba, #rrggbb o #rrggbbaa. Cualquier otra cosa (un
// url(), un nombre, una variable) no pasa: llegaría a Monaco o a una variable
// CSS y podría hacer una petición a un servidor de fuera.
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
export const isHexColor = v => typeof v === 'string' && HEX.test(v);

// → '#RRGGBB' en mayúsculas. El alfa se mezcla sobre `fondo` si se da (un
// comentario '#ffffff80' sobre fondo oscuro sale gris, como en VS Code) y si
// no, se descarta. null si el color no es válido.
export function hex6(v, fondo = null) {
  if (!isHexColor(v)) return null;
  let h = v.slice(1);
  if (h.length <= 4) h = [...h].map(c => c + c).join('');
  const rgb = [0, 2, 4].map(k => parseInt(h.slice(k, k + 2), 16));
  const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  let final = rgb;
  if (a < 1 && isHexColor(fondo)) {
    const f = hex6(fondo).slice(1);
    const bg = [0, 2, 4].map(k => parseInt(f.slice(k, k + 2), 16));
    final = rgb.map((c, k) => Math.round(c * a + bg[k] * (1 - a)));
  }
  return '#' + final.map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();
}
