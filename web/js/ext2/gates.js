// Puertas de Code ante lo que sale de una extensión con código.
//
//   · Abrir una dirección externa (open.request del recinto, y Cmd+clic en un
//     enlace del editor mientras corren extensiones): un diálogo enseña la
//     dirección ENTERA, con los caracteres de control y bidi visibles, el host
//     en Unicode y en punycode si difieren y el sitio aparte. Cancelar es lo
//     que hay por defecto; solo http, https y mailto se pueden abrir, y solo
//     con window.open(…, 'noopener,noreferrer'). Uno a la vez.
//   · Vista previa HTML de un fichero que una extensión tocó (su texto entró
//     en el documento): la vista previa ejecuta scripts con red e incrusta
//     ficheros del proyecto, así que se pregunta antes.
//   · El agente, mientras corren extensiones: sus peticiones web y los
//     runtimes del Bridge preguntan antes, con la URL o la orden entera, para
//     que un texto escrito por una extensión no pueda sacar datos por él.
import { modal, userActive } from './ui.js';
import { tx } from '../ext/i18n.js';
import * as db from '../db.js';

const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

// ── direcciones: lo invisible, visible ──
// Controles C0/C1, marcas bidi y de ancho cero, separadores de línea y BOM.
// (rangos de puntos de código, sin escribir los caracteres: algunos ni se ven)
const INVISIBLE = [[0x0, 0x1F], [0x7F, 0x9F], [0xAD, 0xAD], [0x61C, 0x61C], [0x115F, 0x1160], [0x17B4, 0x17B5], [0x180E, 0x180E], [0x200B, 0x200F],
  [0x2028, 0x202E], [0x2060, 0x206F], [0x3164, 0x3164], [0xFE00, 0xFE0F], [0xFEFF, 0xFEFF], [0xFFA0, 0xFFA0], [0xFFF9, 0xFFFB], [0xE0000, 0xE007F]];
const invisible = cp => INVISIBLE.some(([a, b]) => cp >= a && cp <= b);
const hex = c => '<U+' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0') + '>';
export function visibleParts(s) {
  const out = [];
  let txt = '';
  for (const ch of String(s)) {
    if (invisible(ch.codePointAt(0))) { if (txt) { out.push({ t: txt }); txt = ''; } out.push({ cc: hex(ch) }); }
    else txt += ch;
  }
  if (txt) out.push({ t: txt });
  return out;
}
export const visibleText = s => visibleParts(s).map(p => p.t ?? p.cc).join('');

// punycode (RFC 3492): solo decodificar, para enseñar el host en Unicode
function punyDecode(input) {
  const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
  let n = 128, i = 0, bias = 72;
  const out = [];
  let b = input.lastIndexOf('-');
  if (b < 0) b = 0;
  for (let j = 0; j < b; j++) { if (input.charCodeAt(j) >= 0x80) return null; out.push(input.charCodeAt(j)); }
  const digit = c => (c >= 48 && c <= 57 ? c - 22 : c >= 65 && c <= 90 ? c - 65 : c >= 97 && c <= 122 ? c - 97 : base);
  const adapt = (delta, num, first) => {
    let k = 0;
    delta = first ? Math.floor(delta / damp) : delta >> 1;
    delta += Math.floor(delta / num);
    for (; delta > ((base - tMin) * tMax) >> 1; k += base) delta = Math.floor(delta / (base - tMin));
    return Math.floor(k + (base - tMin + 1) * delta / (delta + skew));
  };
  for (let idx = b > 0 ? b + 1 : 0; idx < input.length;) {
    const oldi = i;
    for (let w = 1, k = base; ; k += base) {
      if (idx >= input.length) return null;
      const d = digit(input.charCodeAt(idx++));
      if (d >= base) return null;
      i += d * w;
      const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
      if (d < t) break;
      w *= base - t;
      if (w > 1e9) return null;
    }
    bias = adapt(i - oldi, out.length + 1, oldi === 0);
    n += Math.floor(i / (out.length + 1));
    i %= out.length + 1;
    if (n > 0x10FFFF) return null;
    out.splice(i++, 0, n);
  }
  try { return String.fromCodePoint(...out); } catch { return null; }
}
export function unicodeHost(host) {
  return String(host).split('.').map(l => {
    if (!/^xn--/i.test(l)) return l;
    const d = punyDecode(l.slice(4).toLowerCase());
    return d == null ? l : d;
  }).join('.');
}

// Lo que el diálogo enseña de una dirección. `href` es lo que se abriría: la
// dirección ya normalizada por el navegador, que es exactamente lo que llega.
export function describeUrl(s) {
  let u;
  try { u = new URL(String(s)); } catch { return { ok: false, href: String(s), scheme: '', openable: false }; }
  const scheme = u.protocol.replace(/:$/, '').toLowerCase();
  const openable = scheme === 'http' || scheme === 'https' || scheme === 'mailto';
  const host = u.hostname;
  const uni = host ? unicodeHost(host) : '';
  let site = host;
  if (scheme === 'mailto') {
    let path = u.pathname;
    try { path = decodeURIComponent(path); } catch { /* codificación rota: tal cual */ }
    site = (/@([^?&#]+)/.exec(path) || [])[1] || '';
  }
  return { ok: true, href: u.href, scheme, openable, host, hostUnicode: uni !== host ? uni : null, site, original: String(s) };
}

function addressBox(href) {
  const box = el('div', 'x2-code');
  for (const p of visibleParts(href)) {
    if (p.t !== undefined) box.appendChild(document.createTextNode(p.t));
    else box.appendChild(el('span', 'x2-cc', p.cc));
  }
  return box;
}

// ── abrir una dirección ──
export class OpenGate {
  constructor({ log = () => {}, opener = (url) => window.open(url, '_blank', 'noopener,noreferrer') } = {}) {
    this.log = log;
    this.opener = opener;
    this.busy = false;
    this.blocked = false;
    this.dropped = 0;
    this.opened = 0;
    this.shown = [];                         // lo que enseñó el diálogo (para las pruebas y el registro)
  }

  async request(url, { fromEditor = false } = {}) {
    if (this.blocked) { this.dropped++; this.log('warn', 'an address was not opened: requests are blocked for this session'); return false; }
    if (this.busy) { this.dropped++; this.log('warn', 'an address was not opened: another one is waiting for an answer'); return false; }
    const info = describeUrl(url);
    const clicked = userActive();
    this.busy = true;
    this.shown.push({ href: info.href, original: info.original, clicked });
    if (this.shown.length > 50) this.shown.shift();
    try {
      const body = [el('p', 'x2-modal-text', fromEditor ? tx('x2OpenBodyLink') : tx('x2OpenBody'))];
      if (info.ok && info.site) {
        const site = el('p', 'x2-site', tx('x2OpenSite') + ' ');
        site.appendChild(el('b', null, visibleText(info.hostUnicode || info.site)));
        if (info.hostUnicode) site.appendChild(document.createTextNode(' ' + tx('x2OpenPuny', { host: info.host })));
        body.push(site);
      }
      if (!clicked) body.push(el('p', 'x2-note', tx('x2OpenNoClick')));
      if (!info.ok) body.push(el('p', 'x2-note', tx('x2OpenInvalid')));
      else if (!info.openable) body.push(el('p', 'x2-note', tx('x2OpenScheme', { scheme: info.scheme })));
      const buttons = [
        { label: tx('x2Cancel'), value: 'cancel' },
        { label: tx('x2OpenCopy'), value: 'copy', onClick: async b => { try { await navigator.clipboard.writeText(info.href); b.textContent = tx('x2OpenCopied'); } catch { b.textContent = tx('x2OpenCopyFailed'); } return true; } },
      ];
      if (info.ok && info.openable) buttons.push({ label: tx('x2OpenOpen'), value: 'open', primary: true });
      buttons.push({ label: tx('x2OpenBlock'), value: 'block', className: 'x2-block' });
      const v = await modal({ id: 'x2-open', title: tx('x2OpenTitle'), body, code: addressBox(info.href), buttons, cancelValue: 'cancel', focus: 0 });
      if (v === 'block') { this.blocked = true; this.log('info', 'address requests from extensions are blocked for this session'); return false; }
      if (v !== 'open' || !info.openable) return false;
      this.opener(info.href);
      this.opened++;
      return true;
    } finally { this.busy = false; }
  }
}

// ── vista previa de un fichero que tocó una extensión ──
const TOUCHED = 'x2.touched';
let marcas = null, guardando = null;
async function leeMarcas() {
  if (!marcas) { try { marcas = (await db.get('kv', TOUCHED)) || {}; } catch { marcas = {}; } }
  return marcas;
}
function guarda() {
  guardando ??= Promise.resolve().then(async () => { guardando = null; try { await db.set('kv', TOUCHED, { ...marcas }); } catch { /* sin almacenamiento */ } });
  return guardando;
}
export async function markTouched(path) {
  if (typeof path !== 'string' || !path) return;
  const m = await leeMarcas();
  if (m[path]) return;
  m[path] = true;
  await guarda();
}
export async function isTouched(path) { return !!(await leeMarcas())[path]; }
// «Previsualizar igualmente»: la marca se va hasta la próxima edición de una extensión
export async function clearTouched(path) {
  const m = await leeMarcas();
  if (!m[path]) return;
  delete m[path];
  await guarda();
}

let previewOpen = null;
export function previewDialog(path) {
  previewOpen ??= (async () => {
    try {
      const v = await modal({
        id: 'x2-preview', title: tx('x2PreviewTitle'),
        body: [tx('x2PreviewBody')], code: path,
        buttons: [{ label: tx('x2Cancel'), value: false }, { label: tx('x2PreviewAnyway'), value: true, primary: true }],
        cancelValue: false, focus: 0,
      });
      if (v === true) { await clearTouched(path); return true; }
      return false;
    } finally { previewOpen = null; }
  })();
  return previewOpen;
}
// El guardián que pone host.js: sin marca no carga nada más; con marca pregunta.
export async function allowPreview(path) {
  if (!(await isTouched(path))) return true;
  return previewDialog(path);
}

// ── el agente, mientras corren extensiones ──
export const RUNTIMES = new Set(['node', 'npm', 'npx', 'python', 'python3', 'pip', 'yarn', 'pnpm', 'bun', 'deno', 'cargo', 'go']);
export const AGENT_DENIED = 'The user did not allow this request.';
// Primera palabra de cada orden de la línea (&&, ;, |), como la parte shell.js
export function commandHeads(line) {
  const heads = [];
  let cur = '', q = '';
  const flush = () => { const t = cur.trim().split(/\s+/)[0]; if (t) heads.push(t.replace(/^["']|["']$/g, '')); cur = ''; };
  const s = String(line);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { cur += ch; if (ch === q) q = ''; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === ';' || ch === '|' || (ch === '&' && s[i + 1] === '&')) { flush(); if (ch === '&' || (ch === '|' && s[i + 1] === '|')) i++; continue; }
    cur += ch;
  }
  flush();
  return heads;
}
export const runsRuntime = line => commandHeads(line).some(h => RUNTIMES.has(h));
export const searchUrls = q => ['https://html.duckduckgo.com/html/?q=', 'https://lite.duckduckgo.com/lite/?q='].map(e => e + encodeURIComponent(String(q ?? '')));

async function agentAsk(kind, lines) {
  const v = await modal({
    id: 'x2-agent', title: tx(kind === 'run' ? 'x2AgentRunTitle' : 'x2AgentWebTitle'),
    body: [tx('x2AgentBody')],
    code: lines.join('\n'),
    buttons: [{ label: tx('x2AgentDeny'), value: false }, { label: tx('x2AgentAllow'), value: true, primary: true }],
    cancelValue: false, focus: 0,
  });
  return v === true;
}

// Envuelve web.fetch, web.search y terminal.run (solo si lanza un runtime
// del Bridge). Devuelve la función que lo deja todo como estaba.
export function installAgentGate(tools, { ask = agentAsk, log = () => {} } = {}) {
  const orig = {};
  const wrap = (name, fn) => {
    const t = tools[name];
    if (!t || typeof t.run !== 'function') return;
    orig[name] = t.run;
    t.run = async a => fn(a || {}, orig[name]);
  };
  const deny = what => { log('info', 'the user did not allow ' + what); return AGENT_DENIED; };
  wrap('web.fetch', async (a, run) => ((await ask('web', [String(a.url ?? '')])) ? run(a) : deny('a web request')));
  wrap('web.search', async (a, run) => ((await ask('web', searchUrls(a.query))) ? run(a) : deny('a web search')));
  wrap('terminal.run', async (a, run) => (!runsRuntime(a.command) || (await ask('run', [String(a.command ?? '')])) ? run(a) : deny('a local runtime')));
  return () => { for (const [name, fn] of Object.entries(orig)) if (tools[name]) tools[name].run = fn; };
}
