// Protocolo entre la página de Code y el recinto de extensiones (PROTOCOL = 1).
//
// Todo lo que llega del recinto se valida aquí ANTES de tocar nada: tipo
// conocido, campos con su forma y tamaños con tope. Lo desconocido o mal
// formado se descarta y se cuenta; demasiadas faltas desmontan el recinto.
// Lo que la página manda al recinto tiene que ser «datos planos» (isPlainData):
// nunca un FileSystemHandle ni ningún otro objeto del navegador.
export const PROTOCOL = 1;

export const LIMITS = {
  message: 1 << 20,          // 1 MB por mensaje (los documentos, aparte)
  document: 64 << 20,
  label: 4096,
  markdown: 65536,
  url: 8192,
  completions: 5000,
  symbols: 10000,
  markers: 5000,
  violations: 20,
};

export const KINDS = new Set(['format', 'formatRange', 'formatOnType', 'completion', 'hover', 'signature', 'codeAction', 'symbols',
  'definition', 'declaration', 'typeDefinition', 'implementation', 'references', 'rename', 'highlights']);
const STATES = new Set(['installed', 'activating', 'active', 'error', 'stopped', 'unsupported']);
const LEVELS = new Set(['info', 'warn', 'error']);

const isStr = (v, max) => typeof v === 'string' && v.length <= max;
const optStr = (v, max) => v === undefined || v === null || isStr(v, max);
const isInt = v => Number.isSafeInteger(v);
const isPos = v => Number.isSafeInteger(v) && v >= 0;
export const isRange = r => Array.isArray(r) && r.length === 4 && r.every(n => Number.isSafeInteger(n) && n >= 1 && n <= 1e8);
export const isUri = u => isStr(u, LIMITS.url) && u.startsWith('file:///');
const isExtId = v => isStr(v, 300) && /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9._-]*$/i.test(v);
export const isPlainObject = v => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

const isFilter = f => isPlainObject(f) && optStr(f.language, 100) && optStr(f.scheme, 50) && optStr(f.pattern, 500);
const isEditStep = s => Array.isArray(s) && s.length <= 100000 && s.every(c => isPlainObject(c) && isRange(c.range) && typeof c.text === 'string');

// tamaño aproximado (para no aceptar mensajes enormes); corta al pasarse
export function approxSize(v, limit = Infinity) {
  let n = 0;
  const stack = [v];
  while (stack.length) {
    const x = stack.pop();
    if (typeof x === 'string') n += x.length * 2;
    else if (typeof x === 'number' || typeof x === 'boolean' || x == null) n += 8;
    else if (x instanceof ArrayBuffer) n += x.byteLength;
    else if (ArrayBuffer.isView(x)) n += x.byteLength;
    else if (Array.isArray(x)) { n += 8; for (const y of x) stack.push(y); }
    else if (typeof x === 'object') { for (const [k, y] of Object.entries(x)) { n += k.length * 2; stack.push(y); } }
    if (n > limit) return n;
  }
  return n;
}

// Mensajes del recinto → la página: cada tipo con su forma exacta.
const FROM_SANDBOX = {
  ready: m => m.protocol === PROTOCOL && isStr(m.vscode, 32),
  fatal: m => isStr(m.reason, 50) && optStr(m.text, 1000),
  'ext.status': m => isExtId(m.id) && STATES.has(m.state) && optStr(m.text, 4096),
  log: m => LEVELS.has(m.level) && isStr(m.text, LIMITS.label) && (m.id === undefined || isExtId(m.id)),
  'providers.add': m => isInt(m.handle) && KINDS.has(m.kind) && Array.isArray(m.selector) && m.selector.length <= 50 && m.selector.every(isFilter) && isPlainObject(m.meta),
  'providers.remove': m => isInt(m.handle),
  result: m => isInt(m.req) && typeof m.ok === 'boolean' && (m.ok || isStr(m.error, 1000)),
  'doc.edit': m => isUri(m.uri) && isInt(m.base) && Array.isArray(m.steps) && m.steps.length <= 1000 && m.steps.every(isEditStep),
  'doc.need': m => isUri(m.uri),
  markers: m => isUri(m.uri) && isStr(m.owner, 200) && Array.isArray(m.markers) && m.markers.length <= LIMITS.markers,
  'ctx.set': m => isStr(m.key, 100) && /^[\w.:-]{1,100}$/.test(m.key) && (m.value === null || ['string', 'number', 'boolean'].includes(typeof m.value)) && (typeof m.value !== 'string' || m.value.length <= 1000),
  pong: m => isInt(m.n),
};

export function validate(msg) {
  if (!isPlainObject(msg) || typeof msg.t !== 'string') return { ok: false, why: 'shape' };
  const check = Object.hasOwn(FROM_SANDBOX, msg.t) ? FROM_SANDBOX[msg.t] : null;
  if (!check) return { ok: false, why: 'unknown type' };
  if (approxSize(msg, LIMITS.message) > LIMITS.message) return { ok: false, why: 'too large' };
  try { return check(msg) ? { ok: true } : { ok: false, why: 'fields' }; }
  catch { return { ok: false, why: 'fields' }; }
}

// Página → recinto: solo datos planos (y ArrayBuffer para los ficheros).
export function isPlainData(v, depth = 0) {
  if (depth > 64) return false;
  if (v === null || v === undefined || typeof v === 'boolean' || typeof v === 'string') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (v instanceof ArrayBuffer) return true;
  if (Array.isArray(v)) return v.every(x => isPlainData(x, depth + 1));
  if (isPlainObject(v)) return Object.values(v).every(x => isPlainData(x, depth + 1));
  return false;
}

export { isStr, isInt, isPos };
