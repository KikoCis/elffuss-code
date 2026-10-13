// Panel de extensiones: buscar en Open VSX, ver qué aplicaría cada una,
// instalar (o un .vsix suelto), activar/desactivar, desinstalar, licencia, y
// el selector de tema de color. Mismo patrón que el panel de Skills: se pinta
// dentro de #settings-panel. Todo texto que viene de una extensión entra con
// textContent, nunca como HTML.
//
// Teclado y lector de pantalla: todo lo que se pulsa es un botón (o un
// <summary>), los resultados y avisos se anuncian (role=status/alert), el
// foco no se pierde al repintar ni al cerrar, y Escape cierra el panel.
import { tx } from './i18n.js';
import { uiLang } from '../i18n.js';
import { describe, lista, listaO, works, languageName, languageExts, factsFromManifest, factsFromRecord } from './verdict.js';

// Las bases de Monaco que son oscuras. El resto del IDE no tiene modo claro.
const esOscuro = t => t?.uiTheme === 'vs-dark' || t?.uiTheme === 'hc-black';

const $ = id => document.getElementById(id);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const CATS = [['', 'catAll'], ['Themes', 'catThemes'], ['Snippets', 'catSnippets'], ['Programming Languages', 'catLangs']];

let host = null;
let cssPuesto = false;
const estado = { q: '', cat: null, items: [], total: 0, cargando: false, msg: null, ctl: null, solo: leeSolo(), objetivo: 0, auto: 0 };
// «Solo las que funcionan en Code»: encendido salvo que quien usa el panel lo
// apagara (se recuerda en este navegador, si se puede)
const CLAVE_SOLO = 'elffusscode.ext.onlyWorks';
function leeSolo() { try { return localStorage.getItem(CLAVE_SOLO) !== '0'; } catch { return true; } }
function guardaSolo(v) { try { localStorage.setItem(CLAVE_SOLO, v ? '1' : '0'); } catch { /* sin almacenamiento: solo esta sesión */ } }
const POR_PAGINA = 20;                  // filas que se quieren ver por tanda
const MAX_AUTO = 3;                     // páginas que se piden solas para llenarla

let temporizador = null;
let desuscribe = null;
let abridor = null;                     // quién tenía el foco al abrir el panel
let focoPendiente = null;               // control a recuperar tras repintar «Instaladas»
let nDetalle = 0;
let ideCargado = null;                  // ../ide.js, para contar pestañas al pintar «Instaladas»

function ponCss() {
  if (cssPuesto) return;
  cssPuesto = true;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('../../css/ext.css', import.meta.url).href;
  document.head.appendChild(l);
}

const visible = x => !!x && x.isConnected && x !== document.body && !x.disabled && x.getClientRects().length > 0;
// El foco vuelve a donde estaba; si eso ya no existe o no se ve (un menú que
// se cerró, la paleta), a lo primero que se vea de la lista.
function devuelveFoco(previo, ...alternativas) {
  for (const x of [previo, ...alternativas]) {
    if (typeof x === 'function') { if (x()) return; continue; }
    if (visible(x)) { x.focus(); return; }
  }
}
const enfocaEditor = () => {
  const ed = window.monaco?.editor?.getEditors?.()[0];
  if (!ed || !visible(ed.getDomNode())) return false;
  ed.focus();
  return true;
};

export function open(h, { themes = false } = {}) {
  host = h;
  ponCss();
  desuscribe?.();
  desuscribe = h.onChange(() => { if ($('ext-panel')?.isConnected) pintaInstaladas(); });
  if (themes) return openThemePicker(h);
  const box = $('settings-panel');
  if (!$('ext-panel')?.isConnected || box.hidden) abridor = document.activeElement;
  estado.msg = null;                    // un aviso viejo no se repite al volver a abrir
  pinta();
  if (!ideCargado) ide().then(m => { ideCargado = m; if ($('ext-panel')?.isConnected) pintaInstaladas(); });
}

function cierraPanel() {
  $('settings-panel').hidden = true;
  devuelveFoco(abridor, $('act-ext'), document.querySelector('#menubar button[data-menu="view"]'), enfocaEditor, $('prompt'));
}
// Para el Escape global de main.js (la capa de más arriba): cerrar el panel de
// extensiones es esto, no cerrar Ajustes, que no sabe quién lo abrió.
export function close() { if ($('ext-panel')?.isConnected && !$('settings-panel').hidden) cierraPanel(); }

// ── mensajes legibles (exportados para las pruebas en Node) ──
const ERRORES = {
  rate: 'errRate', sha: 'errSha', nothing: 'errNothing', notvsix: 'errNotVsix', notfound: 'errNotFound',
  big: 'errBig', noname: 'errNoName', blocked: 'errBlocked', codeonly: 'notHere',
};
export function textoError(e) {
  const code = e?.code;
  if (code === 'cancel' || e?.name === 'AbortError') return tx('cancelled');
  if (e?.name === 'QuotaExceededError') return tx('errQuota');
  if (typeof code === 'string' && Object.hasOwn(ERRORES, code)) return tx(ERRORES[code]);
  switch (code) {
    case 'net': return tx('errNet', { e: e.message });
    case 'http': return tx('errHttp', { status: e.status ? ` (${e.status})` : '' });
    case 'mismatch': return tx('errMismatch', { got: e.got, want: e.want });
    case 'corrupt': case 'missing': return tx('errCorrupt', { entry: e.entry ? ` (${e.entry})` : '' });
    case 'badmanifest': return tx('errBadManifest', { e: e.message });
    case 'unreadable': return tx('errUnreadable', { w: e.warning ? textoAviso(e.warning) : '' }).trim();
  }
  return tx('err', { e: e?.message || String(e) });
}
// Una parte del paquete que no se pudo usar (vsix.js: { kind, name, code, detail }).
const MOTIVOS = {
  missing: 'whyMissing', corrupt: 'whyCorrupt', big: 'whyBig', json: 'whyJson', plist: 'whyPlist',
  notgrammar: 'whyNotGrammar', notheme: 'whyNotTheme', scope: 'whyScope', outside: 'whyOutside',
};
const TIPOS_AVISO = new Set(['theme', 'grammar', 'snippets', 'config', 'regex']);
export function textoAviso(w) {
  if (typeof w === 'string') return w;                // instaladas antes de que hubiera códigos
  if (!w || typeof w !== 'object') return '';
  const why = w.kind !== 'regex' && typeof w.code === 'string' && Object.hasOwn(MOTIVOS, w.code) ? tx(MOTIVOS[w.code], { e: w.detail }) : w.detail;
  return TIPOS_AVISO.has(w.kind) ? tx('warn_' + w.kind, { name: w.name, why }) : `${w.name}: ${why}`;
}

// Los avisos que importan: la configuración de un lenguaje de serie no se
// aplica, así que sus expresiones descartadas no cuentan (ya lo dice «No aplica»).
const avisosVisibles = ws => (ws || []).filter(w => !(w?.kind === 'regex' && w.where === 'config' && host.builtinLanguage?.(w.name)));

function aviso(texto, error = false) {
  estado.msg = texto ? { texto, error } : null;
  const m = $('ext-msg');
  if (!m) return;
  // vacío pero presente: una región viva que aparece a la vez que su texto
  // no siempre se anuncia
  m.setAttribute('role', error ? 'alert' : 'status');
  m.setAttribute('aria-live', error ? 'assertive' : 'polite');
  m.hidden = false;
  m.textContent = texto || '';
  m.classList.toggle('err', !!error);
  m.classList.remove('ext-msg-sr');
}
// Estado de la búsqueda para el lector de pantalla (la cabecera visible se
// rehace en cada repintado y no podría anunciarse).
function anunciaBusqueda(texto) {
  const s = $('ext-status');
  if (s && s.textContent !== texto) s.textContent = texto;
}

// «Aplica: 2 temas · No aplica: commands (necesita su código)», con lo que de
// verdad se aplicaría aquí: la gramática de un lenguaje de serie sin Monarch
// (JSON) y la configuración de un lenguaje de serie no se aplican, y no cuentan.
// ── qué hace cada extensión, en llano (verdict.js) ──
const nombreLenguaje = (id, langs = []) => languageName(host, id, langs);
const extsDe = (id, langs = []) => languageExts(host, id, langs);
const hechosDeManifiesto = a => factsFromManifest(host, a);
const hechosDeRegistro = e => factsFromRecord(host, e);
// El bloque del veredicto: primero la frase que decide, luego el detalle.
function bloqueVeredicto(f, v, { principal = true } = {}) {
  const box = el('div', 'ext-verdict ext-v-' + v.kind);
  box.id = 'ext-v-' + (++nDetalle);
  if (principal || v.kind === 'code' || v.kind === 'nothing') box.appendChild(el('div', 'ext-v-main', v.verdict));
  for (const l of v.lines) box.appendChild(el('div', 'ext-v-more', l));
  if (f.keepsBuiltin?.length) box.appendChild(el('div', 'ext-v-more', tx('keepsBuiltin', { list: lista(f.keepsBuiltin) })));
  if (f.pack?.length) box.appendChild(el('div', 'ext-v-more', tx('pack', { n: f.pack.length })));
  return box;
}
// El botón de instalar dice lo que vas a tener; si no se ve nada, no se ofrece.
function botonSegunVeredicto(b, v, nombre) {
  const texto = tx(v.button.key);
  rotula(b, texto, v.button.key === 'install' ? tx('installNamed', { name: nombre }) : `${texto}: ${nombre}`);
  b.className = (v.button.style === 'primary' ? 'primary' : 'ghost') + ' ext-install';
  inerte(b, v.button.disabled);
}

function rotula(b, texto, accesible = null) {
  b.textContent = texto;
  if (accesible) b.setAttribute('aria-label', accesible); else b.removeAttribute('aria-label');
}
// Ocupado o ya hecho, pero SIN disabled: un botón deshabilitado pierde el foco
// y quien va con teclado se quedaría en ninguna parte.
const inerte = (b, si) => { if (si) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled'); };
const esInerte = b => b.getAttribute('aria-disabled') === 'true';

// ── panel ──
function pinta() {
  const box = $('settings-panel');
  box.hidden = false;
  box.replaceChildren();
  // Es un diálogo con su propio nombre. La caja la comparten Ajustes y Skills,
  // y Ajustes le deja role=dialog con aria-labelledby a su título: abierto
  // Ajustes antes, este panel quedaba como un diálogo sin nombre (ese título
  // aquí no existe), y si no, sin rol de diálogo.
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-labelledby', 'ext-title');
  box.dataset.kind = 'ext';
  const cerrar = el('button', null, '✕');
  cerrar.id = 'settings-close';
  cerrar.type = 'button';
  cerrar.title = tx('close');
  cerrar.setAttribute('aria-label', tx('close'));
  cerrar.onclick = cierraPanel;
  const wrap = el('div', 'ext-panel');
  wrap.id = 'ext-panel';
  const conEscape = e => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); cierraPanel(); } };
  wrap.addEventListener('keydown', conEscape);
  cerrar.addEventListener('keydown', conEscape);
  const h3 = el('h3', null, tx('title') + ' ');
  h3.id = 'ext-title';
  h3.appendChild(el('span', 'muted', '· ' + tx('sub')));
  wrap.append(h3, el('p', 'muted ext-intro', tx('intro')));
  if (host.paused) wrap.appendChild(el('p', 'ext-paused', tx('paused')));

  const barra = el('div', 'ext-toolbar');
  const fichero = el('input');
  fichero.type = 'file';
  fichero.accept = '.vsix,application/zip,application/vsix';
  fichero.hidden = true;
  fichero.id = 'ext-file';
  fichero.onchange = async () => {
    const f = fichero.files?.[0];
    fichero.value = '';
    if (f) await instala(f, null);
  };
  const bVsix = el('button', 'ghost', tx('vsix'));
  bVsix.id = 'ext-install-vsix';
  bVsix.onclick = () => fichero.click();
  const bTema = el('button', 'ghost', tx('themeBtn'));
  bTema.id = 'ext-theme-btn';
  bTema.onclick = () => openThemePicker(host);
  barra.append(bVsix, bTema, fichero);
  wrap.appendChild(barra);

  const busca = el('div', 'ext-search');
  const inp = el('input');
  inp.id = 'ext-q';
  inp.type = 'search';
  inp.placeholder = tx('searchPh');
  inp.setAttribute('aria-label', tx('searchPh'));
  inp.autocomplete = 'off';
  inp.spellcheck = false;
  inp.value = estado.q;
  inp.oninput = () => { estado.q = inp.value.trim(); clearTimeout(temporizador); temporizador = setTimeout(() => busca_(), 350); };
  inp.onkeydown = e => { if (e.key === 'Enter') { clearTimeout(temporizador); busca_(); } };
  const chips = el('div', 'ext-chips');
  for (const [cat, key] of CATS) {
    const c = el('button', 'ext-chip' + (estado.cat === cat ? ' on' : ''), tx(key));
    c.dataset.cat = cat;
    c.setAttribute('aria-pressed', String(estado.cat === cat));
    c.onclick = () => { estado.cat = estado.cat === cat && cat ? '' : cat; busca_(); };
    chips.appendChild(c);
  }
  busca.append(inp, chips);
  wrap.appendChild(busca);
  const filtro = el('label', 'ext-filter');
  const solo = el('input');
  solo.type = 'checkbox';
  solo.id = 'ext-only-works';
  solo.checked = estado.solo;
  solo.onchange = () => ponSolo(solo.checked);
  filtro.append(solo, el('span', null, tx('onlyWorks')));
  wrap.appendChild(filtro);

  const msg = el('div', 'ext-msg');
  msg.id = 'ext-msg';
  msg.setAttribute('role', 'status');
  msg.setAttribute('aria-live', 'polite');
  wrap.appendChild(msg);
  const estadoBusqueda = el('div', 'ext-sr');
  estadoBusqueda.id = 'ext-status';
  estadoBusqueda.setAttribute('role', 'status');
  estadoBusqueda.setAttribute('aria-live', 'polite');
  wrap.appendChild(estadoBusqueda);
  const res = el('div', 'ext-results');
  res.id = 'ext-results';
  wrap.appendChild(res);
  const inst = el('div', 'ext-installed');
  inst.id = 'ext-installed';
  wrap.appendChild(inst);
  box.append(cerrar, wrap);

  if (estado.msg) aviso(estado.msg.texto, estado.msg.error);
  pintaResultados();
  pintaInstaladas();
  inp.focus();
}

async function busca_({ mas = false } = {}) {
  estado.ctl?.abort();
  const ctl = new AbortController();
  estado.ctl = ctl;
  // solo las categorías: las fichas de tema de «Instaladas» también son .ext-chip
  for (const c of document.querySelectorAll('#ext-panel .ext-search .ext-chip')) {
    const on = c.dataset.cat === (estado.cat || '') && estado.cat != null;
    c.classList.toggle('on', on);
    c.setAttribute('aria-pressed', String(on));
  }
  if (!mas) { estado.objetivo = POR_PAGINA; estado.auto = 0; }
  // sin buscar nada: la lista de populares que funcionan, ya calculada
  if (mostrandoPopulares()) { estado.items = []; estado.total = 0; estado.cargando = false; pintaResultados(); return; }
  const ovsx = await import('./openvsx.js');
  if (estado.ctl !== ctl) return;
  estado.cargando = true;
  if (!mas) { estado.items = []; estado.total = 0; }
  aviso(null);
  if (mas) pintaPie(); else pintaResultados();
  let nuevos = null;
  try {
    const r = await ovsx.search(estado.q, { category: estado.cat || '', offset: mas ? estado.items.length : 0, size: POR_PAGINA, signal: ctl.signal });
    if (estado.ctl !== ctl) return;
    // (una extensión puede repetirse entre páginas si cambia el orden)
    const ya = new Set(estado.items.map(claveDe));
    nuevos = mas ? r.items.filter(it => !ya.has(claveDe(it))) : r.items;
    estado.items = mas ? estado.items.concat(nuevos) : r.items;
    estado.total = mas && !r.items.length ? estado.items.length : r.total;
  } catch (e) {
    if (e.name === 'AbortError') return;
    aviso(textoError(e), true);
  } finally {
    if (estado.ctl === ctl) {
      estado.cargando = false;
      if (mas && $('ext-list')) { if (nuevos) añadeFilas(nuevos); pintaPie(); } else pintaResultados();
    }
  }
}
const mostrandoPopulares = () => !estado.q && !estado.cat;

// ── «Solo las que funcionan en Code» ──
// Lo que se sabe de cada resultado: true (funciona), false (no hace nada aquí),
// null (no se pudo leer su package.json: se enseña, sin veredicto). Sin
// entrada: todavía se está mirando.
const veredictos = new Map();
function ponSolo(v) {
  estado.solo = v;
  guardaSolo(v);
  const cb = $('ext-only-works');
  if (cb) cb.checked = v;
  for (const row of document.querySelectorAll('#ext-list .ext-row')) filtraFila(row);
  pintaPie();
}
function filtraFila(row) {
  const w = veredictos.get(row.dataset.key);
  row.hidden = estado.solo && !row.dataset.popular && (w === undefined || w === false);
}
function cuentas() {
  let pendientes = 0, ocultas = 0, visibles = 0;
  for (const it of estado.items) {
    const w = veredictos.get(claveDe(it));
    if (w === undefined) pendientes++;
    else if (w === false) ocultas++;
    else visibles++;
  }
  return { pendientes, ocultas, visibles: estado.solo ? visibles : estado.items.length };
}
let piePendiente = false;
function programaPie() {
  if (piePendiente) return;
  piePendiente = true;
  queueMicrotask(() => { piePendiente = false; pintaPie(); });
}
// Debajo de la lista: cuántas se ocultaron (con «mostrar»), «comprobando…»,
// «más resultados»; y si faltan filas para llenar la tanda, pide otra página.
function pintaPie() {
  const pie = $('ext-foot'), ocultasBox = $('ext-hidden');
  if (!pie || !ocultasBox || mostrandoPopulares()) return;
  const teniaFoco = pie.contains(document.activeElement) || ocultasBox.contains(document.activeElement);
  const { pendientes, ocultas, visibles } = cuentas();
  const quedan = estado.items.length < estado.total;
  ocultasBox.replaceChildren();
  ocultasBox.hidden = !(estado.solo && ocultas);
  if (estado.solo && ocultas) {
    ocultasBox.append(tx('hiddenN', { n: ocultas }) + ' · ');
    const b = el('button', 'ext-link', tx('showHidden'));
    b.type = 'button';
    b.id = 'ext-show-hidden';
    b.setAttribute('aria-label', tx('showHiddenNamed', { n: ocultas }));
    b.onclick = () => { ponSolo(false); $('ext-only-works')?.focus(); };
    ocultasBox.appendChild(b);
  }
  // ¿llenar la tanda? solo con el filtro, cuando ya se sabe todo lo pedido
  const llenando = estado.solo && !pendientes && visibles < estado.objetivo && quedan && !estado.cargando && estado.auto < MAX_AUTO;
  pie.replaceChildren();
  if (estado.cargando || (estado.solo && pendientes) || llenando) pie.appendChild(el('div', 'muted ext-hint', tx(estado.solo ? 'checking' : 'searching')));
  else if (estado.solo && !visibles && estado.items.length) pie.appendChild(el('div', 'muted ext-hint', tx(quedan ? 'noneWorkYet' : 'noneWork', { n: estado.items.length })));
  if (!estado.cargando && !llenando && quedan) {
    const mas = el('button', 'ghost ext-more', tx('more'));
    mas.type = 'button';
    mas.id = 'ext-more';
    mas.onclick = () => { estado.objetivo = cuentas().visibles + POR_PAGINA; estado.auto = 0; busca_({ mas: true }); };
    pie.appendChild(mas);
    if (teniaFoco) mas.focus();
  } else if (teniaFoco && !ocultasBox.contains(document.activeElement)) {
    // el botón que tenía el foco ya no está: a la primera fila que se ve
    ([...document.querySelectorAll('#ext-list .ext-row:not([hidden]) .ext-name')].pop() || $('ext-only-works'))?.focus();
  }
  if (!pendientes && !estado.cargando) {
    anunciaBusqueda(tx('results', { n: estado.total }) + (estado.solo && ocultas ? ' · ' + tx('hiddenN', { n: ocultas }) : ''));
  }
  if (llenando) { estado.auto++; busca_({ mas: true }); }
}

// ── populares: una lista corta, ya comprobada (popular.json, generada por
// tests/ext_popular_build.mjs), que se pinta al instante y sin pedir nada a
// Open VSX: el veredicto de cada una va dentro ──
let populares = null, cargaPop = null;
function cargaPopulares() {
  cargaPop ||= fetch(new URL('./popular.json', import.meta.url)).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
    .then(j => { populares = (j.items || []).map(p => ({ ...p, it: itemPopular(p) })); for (const p of populares) analisis.set(claveDe(p.it), Promise.resolve(p.analysis)); })
    .catch(e => { cargaPop = null; throw e; });
  return cargaPop;
}
function itemPopular(p) {
  return {
    namespace: p.namespace, name: p.name, version: p.version, displayName: p.displayName,
    description: p.description?.[uiLang()] || p.description?.en || '', downloadCount: p.downloads || 0, verified: !!p.verified, icon: null,
  };
}
function pintaPopulares(res) {
  if (!populares) {
    res.appendChild(el('div', 'muted ext-hint', tx('searching')));
    cargaPopulares().then(() => { if (mostrandoPopulares()) pintaResultados(); })
      .catch(() => { if (mostrandoPopulares()) { res.replaceChildren(el('div', 'muted ext-hint', tx('popularFailed'))); } });
    return;
  }
  const h = el('div', 'sk-h', tx('popularH'));
  h.id = 'ext-popular-h';
  res.append(h, el('p', 'muted ext-pop-note', tx('popularNote')));
  const lista = el('div', 'ext-list ext-popular');
  lista.id = 'ext-list';
  lista.setAttribute('aria-labelledby', 'ext-popular-h');
  const instaladas = new Map(host.list().map(e => [e.id, e]));
  for (const p of populares) {
    const row = filaResultado(p.it, instaladas.get(p.id.toLowerCase()), { kind: p.kind });
    row.dataset.popular = '1';
    lista.appendChild(row);
  }
  res.appendChild(lista);
  anunciaBusqueda(tx('popularCount', { n: populares.length }));
}

function pintaResultados() {
  const res = $('ext-results');
  if (!res) return;
  res.replaceChildren();
  if (mostrandoPopulares()) { pintaPopulares(res); return; }
  if (estado.cargando && !estado.items.length) {
    res.appendChild(el('div', 'muted ext-hint', tx('searching')));
    anunciaBusqueda(tx('searching'));
    return;
  }
  if (!estado.items.length) {
    if (estado.q || estado.cat != null) {
      const t = estado.cargando ? tx('searching') : tx('noResults');
      res.appendChild(el('div', 'muted ext-hint', t));
      anunciaBusqueda(t);
    } else anunciaBusqueda('');
    return;
  }
  res.appendChild(el('div', 'sk-h', estado.q ? tx('results', { n: estado.total }) : tx('popular')));
  const lista = el('div', 'ext-list');
  lista.id = 'ext-list';
  const ocultas = el('div', 'muted ext-hidden');
  ocultas.id = 'ext-hidden';
  ocultas.hidden = true;
  const pie = el('div', 'ext-foot');
  pie.id = 'ext-foot';
  res.append(ocultas, lista, pie);
  añadeFilas(estado.items);
  pintaPie();
}
function añadeFilas(items) {
  const lista = $('ext-list');
  if (!lista) return;
  const instaladas = new Map(host.list().map(e => [e.id, e]));
  for (const it of items) {
    const row = filaResultado(it, instaladas.get(`${it.namespace}.${it.name}`.toLowerCase()));
    filtraFila(row);
    lista.appendChild(row);
  }
}

function icono(url, nombre) {
  if (url) {
    const img = el('img', 'ext-ico');
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.src = url;
    img.onerror = () => img.replaceWith(icono(null, nombre));
    return img;
  }
  const letra = el('div', 'ext-ico ext-ico-letra', (nombre || '?').trim().charAt(0).toUpperCase());
  letra.setAttribute('aria-hidden', 'true');
  return letra;
}

// ── análisis previo de cada resultado: su package.json (una petición por fila,
// cuatro a la vez, en caché) para dar el veredicto ANTES de instalar ──
const analisis = new Map();
const colaAnalisis = [];
let analizando = 0;
const claveDe = it => `${it.namespace}.${it.name}@${it.version}`;
function bombea() {
  while (analizando < 4 && colaAnalisis.length) {
    const { it, res, rej } = colaAnalisis.shift();
    analizando++;
    (async () => {
      const ovsx = await import('./openvsx.js');
      const { analyzeManifest } = await import('./vsix.js');
      return analyzeManifest(await ovsx.manifestOf(it));
    })().then(res, rej).finally(() => { analizando--; bombea(); });
  }
}
function analiza(it) {
  const k = claveDe(it);
  if (!analisis.has(k)) {
    const p = new Promise((res, rej) => { colaAnalisis.push({ it, res, rej }); bombea(); });
    analisis.set(k, p);
    p.catch(() => analisis.delete(k));          // se reintenta la próxima vez
  }
  return analisis.get(k);
}
function pintaVeredictoFila(row, it, a, instalada) {
  const f = hechosDeManifiesto(a);
  const v = describe(f);
  const sitio = row.querySelector('.ext-verdict-slot');
  if (!sitio) return v;
  const bloque = bloqueVeredicto(f, v);
  sitio.replaceChildren(bloque);
  const b = row.querySelector('.ext-install');
  if (b && !instalada && !b.dataset.ocupado) {
    botonSegunVeredicto(b, v, it.displayName);
    if (v.button.disabled) { b.setAttribute('aria-describedby', bloque.id); b.title = v.verdict; } else { b.removeAttribute('aria-describedby'); b.removeAttribute('title'); }
  }
  return v;
}

function filaResultado(it, instalada, { kind = null } = {}) {
  const row = el('div', 'ext-row');
  row.dataset.id = `${it.namespace}.${it.name}`;
  row.dataset.key = claveDe(it);
  const main = el('div', 'ext-main');
  const det = el('div', 'ext-detail');
  det.id = 'ext-det-' + (++nDetalle);
  det.hidden = true;
  const t = el('div', 'ext-title');
  const nombre = el('button', 'ext-name', it.displayName);
  nombre.type = 'button';
  nombre.title = tx('details');
  nombre.setAttribute('aria-expanded', 'false');
  nombre.setAttribute('aria-controls', det.id);
  nombre.onclick = e => { e.stopPropagation(); detalle(it, det, nombre); };
  t.append(nombre, el('span', 'muted', ` ${it.namespace} · v${it.version}`));
  if (it.verified) t.appendChild(el('span', 'ext-badge', '✓'));
  if (kind) { row.dataset.kind = kind; t.appendChild(el('span', 'ext-kind ext-kind-' + kind, tx('kind_' + kind))); }
  main.append(t, el('div', 'ext-desc', it.description));
  main.appendChild(el('div', 'ext-verdict-slot'));
  main.appendChild(el('div', 'ext-meta muted', tx('downloads', { n: it.downloadCount.toLocaleString() })));
  main.appendChild(det);
  main.onclick = e => { if (!e.target.closest('button, a, summary')) detalle(it, det, nombre); };

  const acc = el('div', 'ext-actions');
  const b = el('button', 'primary ext-install');
  b.type = 'button';
  if (instalada && instalada.version === it.version) {
    rotula(b, tx('installedOk'), tx('installedNamed', { name: it.displayName }));
    b.className = 'ghost ext-install';
    inerte(b, true);
  } else if (instalada) rotula(b, tx('update', { v: it.version }), tx('updateNamed', { name: it.displayName, v: it.version }));
  else rotula(b, tx('install'), tx('installNamed', { name: it.displayName }));
  b.onclick = e => { e.stopPropagation(); if (!esInerte(b)) instala(it, b); };
  acc.appendChild(b);
  row.append(icono(it.icon, it.displayName), main, acc);
  const k = claveDe(it);
  analiza(it).then(a => { veredictos.set(k, works(pintaVeredictoFila(row, it, a, instalada))); })
    .catch(() => { if (!veredictos.has(k)) veredictos.set(k, null); })      // sin veredicto: el botón de siempre
    .finally(() => { filtraFila(row); programaPie(); });
  return row;
}

async function detalle(it, det, boton) {
  det.hidden = !det.hidden;
  boton?.setAttribute('aria-expanded', String(!det.hidden));
  if (det.hidden || det.dataset.listo) return;
  det.replaceChildren(el('div', 'muted', tx('loadingDetails')));
  try {
    const ovsx = await import('./openvsx.js');
    const meta = await ovsx.metadata(it.namespace, it.name, it.version);
    const a = await analiza(it);
    const f = hechosDeManifiesto(a);
    const v = describe(f);
    det.replaceChildren();
    // el veredicto ya va en la fila; aquí, además, todo lo que no funcionaría
    if (v.missing.length && v.kind !== 'partial') det.appendChild(el('div', 'ext-v-more', tx(v.future === 'next' ? 'vMissingNext' : 'vMissingNever', { list: lista(v.missing) })));
    const lic = el('div', 'ext-meta muted', tx('license', { l: meta.license || tx('noLicense') }) + ' ');
    if (meta.files.license) {
      const a2 = el('a', null, tx('viewLicense'));
      a2.href = meta.files.license;
      a2.target = '_blank';
      a2.rel = 'noopener noreferrer';
      lic.appendChild(a2);
    }
    det.appendChild(lic);
    det.dataset.listo = '1';
    const fila = det.closest('.ext-row');
    if (fila) pintaVeredictoFila(fila, it, a, host.list().find(e => e.id === `${it.namespace}.${it.name}`.toLowerCase()));
  } catch (e) { det.replaceChildren(el('div', 'ext-ignored', textoError(e))); }
}

// «No se ha instalado», con el porqué en llano.
function textoNoInstalada(nombre, a) {
  const v = describe(hechosDeManifiesto(a));
  return [tx('errCodeOnly', { name: nombre }), v.verdict, ...v.lines].join(' ');
}

async function instala(src, boton) {
  const esFichero = src instanceof Blob;
  const nombre = esFichero ? src.name : src.displayName;
  if (!esFichero) {
    // sin veredicto todavía (red lenta): se pide ahora, y si no se vería nada, no se baja
    const a = await analiza(src).catch(() => null);
    if (a) {
      const fila = boton?.closest('.ext-row');
      const v = fila ? pintaVeredictoFila(fila, src, a, null) : describe(hechosDeManifiesto(a));
      if (v.button.disabled) { aviso(textoNoInstalada(nombre, a), true); return; }
    }
  }
  const original = boton ? { texto: boton.textContent, accesible: boton.getAttribute('aria-label') } : null;
  if (boton) { inerte(boton, true); boton.dataset.ocupado = '1'; rotula(boton, tx('installing')); }
  aviso(null);
  $('ext-done')?.remove();
  const temaAntes = host.currentTheme();
  try {
    const rec = await host.install(esFichero ? src : { namespace: src.namespace, name: src.name, version: src.version }, {
      onProgress: (n, total) => { if (boton && total) boton.textContent = tx('downloading', { pct: Math.round(n / total * 100) }); },
      confirmLarge: async mb => confirm(tx('bigConfirm', { mb })),
    });
    if (boton) { delete boton.dataset.ocupado; rotula(boton, tx('installedOk'), tx('installedNamed', { name: rec.displayName || nombre })); boton.className = 'ghost ext-install'; }
    // una extensión que solo trae temas se ve al instante: se aplica el primero
    // (con «Deshacer» en el aviso)
    const soloTemas = rec.themes?.length && !rec.grammars?.length && !rec.snippets?.length && !(rec.languages || []).some(l => l.configKey && !host.builtinLanguage?.(l.id));
    // Solo se aplica sola una variante OSCURA. El IDE es oscuro y un tema claro
    // solo repinta el editor: quedaba un rectángulo blanco en medio de todo lo
    // demás, y bastaba con que el paquete listara primero su variante clara
    // (GitHub Theme y compañía). Si no trae ninguna oscura, no se aplica nada y
    // queda el botón «Aplicar ahora».
    const oscuro = rec.themes?.find(esOscuro);
    let auto = false;
    if (soloTemas && oscuro && !rec.themes.some(t => t.themeId === host.currentTheme()) && rec.enabled !== false && !host.paused) {
      await host.setTheme(oscuro.themeId);
      auto = true;
    }
    const nAvisos = avisosVisibles(rec.warnings).length;
    const primera = auto ? ' ' + tx('cThemeApplied', { name: oscuro.label }) : '';
    aviso(tx('installedMsg', { name: rec.displayName || nombre }) + primera + (nAvisos ? ' ' + tx('warnSummary', { n: nAvisos }) + '.' : ''));
    await pintaTarjeta(rec, { previo: auto ? temaAntes : null });
    pintaInstaladas();
  } catch (e) {
    if (boton) { delete boton.dataset.ocupado; inerte(boton, false); rotula(boton, original.texto, original.accesible); }
    if (e?.code === 'codeonly') {
      aviso(textoNoInstalada(e.displayName || nombre, e.analysis), true);
      if (boton) { const v = describe(hechosDeManifiesto(e.analysis)); botonSegunVeredicto(boton, v, nombre); }
    } else aviso(textoError(e), true);
  }
}

// ── después de instalar: qué cambió, dónde verlo y un botón para probarlo ──
const baseName = p => String(p).split('/').pop();
const cita = x => tx('quoted', { x });
async function ide() { try { return await import('../ide.js'); } catch { return null; } }
async function ficherosDelProyecto() { try { return await (await import('../tools/code.js')).fileList(); } catch { return []; } }
function pestañasCon(ideMod, langs) {
  const ids = new Set(langs);
  return (ideMod?.openTabs?.() || []).filter(t => ids.has(t.language) || ids.has(host.languageForPath?.(t.path)));
}
async function ficheroCon(ideMod, langs) {
  const ids = new Set(langs);
  const abiertas = pestañasCon(ideMod, langs);
  if (abiertas.length) return { path: (abiertas.find(t => t.active) || abiertas[0]).path, abierta: true };
  for (const f of await ficherosDelProyecto()) if (ids.has(host.languageForPath?.(f) || ideMod?.languageOfPath?.(f))) return { path: f, abierta: false };
  return null;
}
async function irA(path, { foco = true } = {}) {
  const m = await ide();
  cierraPanel();
  await m?.openFile(path);
  if (foco) m?.focusEditor();
}
async function pruebaSnippets(rec, objetivo) {
  const prefijos = await host.snippetPrefixes(rec.id).catch(() => []);
  const pista = tx('statusTrySnippets', { prefixes: listaO(prefijos.map(cita)) });
  if (!objetivo) { aviso(pista); return; }
  await irA(objetivo);
  const sb = document.getElementById('statusbar');
  if (sb) sb.textContent = pista;
}
async function pruebaResaltado(langs) {
  const m = await ide();
  const f = await ficheroCon(m, langs);
  if (f) { await irA(f.path); return; }
  aviso(tx('cHighlightTry', { exts: lista(langs.flatMap(l => extsDe(l)).slice(0, 4)) }));
}
function resumenAjustes(conf) {
  if (!conf || typeof conf !== 'object') return [];
  const que = [];
  const lc = conf.comments?.lineComment, bc = conf.comments?.blockComment;
  if (typeof lc === 'string') que.push(tx('sComment', { c: lc }));
  else if (Array.isArray(bc) && bc.length === 2) que.push(tx('sComment', { c: bc.join(' … ') }));
  const par = p => (Array.isArray(p) ? p[0] + p[1] : p && typeof p.open === 'string' ? p.open + p.close : null);
  if (Array.isArray(conf.brackets) && conf.brackets.length) que.push(tx('sBrackets', { b: conf.brackets.map(par).filter(Boolean).slice(0, 4).join(' ') }));
  if (Array.isArray(conf.autoClosingPairs) && conf.autoClosingPairs.length) que.push(tx('sAutoClose', { p: conf.autoClosingPairs.map(par).filter(Boolean).slice(0, 5).join(' ') }));
  return que;
}

async function pintaTarjeta(rec, { previo = null } = {}) {
  const sitio = $('ext-msg');
  if (!sitio) return;
  const m = await ide();
  const f = hechosDeRegistro(rec);
  const v = describe(f);
  const box = el('section', 'ext-done');
  box.id = 'ext-done';
  box.setAttribute('aria-labelledby', 'ext-done-h');
  const h = el('div', 'ext-done-h', tx('installedMsg', { name: rec.displayName }));
  h.id = 'ext-done-h';
  box.appendChild(h);
  const parte = () => { const p = el('div', 'ext-done-part'); box.appendChild(p); return p; };
  const botones = p => { const x = el('div', 'ext-done-acts'); p.appendChild(x); return x; };
  const boton = (fila, texto, act, fn, accesible = null) => {
    const b = el('button', 'ghost', texto);
    b.type = 'button';
    b.dataset.act = act;
    if (accesible) b.setAttribute('aria-label', accesible);
    b.onclick = fn;
    fila.appendChild(b);
    return b;
  };

  if (rec.themes?.length) {
    const p = parte();
    const pinta = (enfoca = null) => {
      p.replaceChildren();
      const activo = rec.themes.find(t => t.themeId === host.currentTheme());
      p.appendChild(el('div', null, activo ? tx('cThemeApplied', { name: activo.label })
        : rec.themes.length === 1 ? tx('cThemeReady', { name: rec.themes[0].label }) : tx('cThemesReady', { n: rec.themes.length, list: lista(rec.themes.map(t => cita(t.label))) })));
      const fila = botones(p);
      if (activo && previo && previo !== activo.themeId) boton(fila, tx('bUndo'), 'undo-theme', async () => { await host.setTheme(previo); pinta('apply-theme'); pintaInstaladas(); });
      if (!activo) boton(fila, tx('bApplyNow'), 'apply-theme', async () => { await host.setTheme((rec.themes.find(esOscuro) || rec.themes[0]).themeId); pinta('undo-theme'); pintaInstaladas(); });
      boton(fila, tx('bPickTheme'), 'pick-theme', () => openThemePicker(host));
      if (enfoca) (fila.querySelector(`[data-act="${enfoca}"]`) || fila.querySelector('button'))?.focus();
    };
    pinta();
  }

  if (f.highlight.length) {
    const p = parte();
    const ids = f.highlight.map(x => x.id);
    p.appendChild(el('div', null, tx('cHighlight', { list: lista(f.highlight.map(x => x.name + (x.exts.length ? ` (${x.exts.slice(0, 3).join(', ')})` : ''))) })));
    const abiertas = pestañasCon(m, ids);
    if (abiertas.length) {
      p.appendChild(el('div', null, tx('cHighlightOpen', { n: abiertas.length, files: lista(abiertas.slice(0, 3).map(t => baseName(t.path))) })));
      const destino = abiertas.find(t => t.active) || abiertas[0];
      boton(botones(p), tx('bGoto', { file: baseName(destino.path) }), 'goto', () => irA(destino.path));
    } else {
      const fich = await ficheroCon(m, ids);
      if (fich) boton(botones(p), tx('bOpenFile', { file: baseName(fich.path) }), 'open-example', () => irA(fich.path));
      else p.appendChild(el('div', 'muted', tx('cHighlightTry', { exts: lista(f.highlight.flatMap(x => x.exts).slice(0, 4)) })));
    }
  }

  for (const l of rec.languages || []) {
    if (!l.configKey || host.builtinLanguage?.(l.id)) continue;
    const que = resumenAjustes(await host.languageConfig(rec.id, l.id).catch(() => null));
    if (que.length) parte().appendChild(el('div', null, tx('cSettings', { lang: nombreLenguaje(l.id, [{ id: l.id, name: l.aliases?.[0] }]), what: lista(que) })));
  }

  if (f.snippets.length) {
    const p = parte();
    const n = f.snippets.reduce((a, s) => a + (s.count || 0), 0);
    p.appendChild(el('div', null, tx('cSnippets', { n, list: lista(f.snippets.map(s => s.name)) })));
    const prefijos = await host.snippetPrefixes(rec.id).catch(() => []);
    if (prefijos.length) p.appendChild(el('div', null, tx('cSnippetsTry', { prefixes: listaO(prefijos.map(cita)) })));
    const destino = await ficheroCon(m, f.snippets.map(s => s.id));
    if (destino) boton(botones(p), tx('bTryIn', { file: baseName(destino.path) }), 'try-snippet', () => pruebaSnippets(rec, destino.path));
  }

  for (const l of v.lines) box.appendChild(el('div', 'ext-done-part ext-v-more', l));
  if (f.keepsBuiltin.length) box.appendChild(el('div', 'ext-done-part ext-v-more', tx('keepsBuiltin', { list: lista(f.keepsBuiltin) })));
  $('ext-done')?.remove();
  sitio.after(box);
  // la región viva sigue anunciándolo; a la vista basta con la tarjeta
  if (!sitio.classList.contains('err')) sitio.classList.add('ext-msg-sr');
}

function claveFoco(x) {
  const k = x?.closest?.('[data-k]')?.dataset.k;
  const id = x?.closest?.('.ext-row')?.dataset.id;
  return k && id ? { id, k } : null;
}
function recuperaFoco(box, f) {
  if (!f) return;
  if (f.heading) { $('ext-installed-h')?.focus(); return; }
  const fila = [...box.querySelectorAll('.ext-row')].find(r => r.dataset.id === f.id);
  const x = fila && ([...fila.querySelectorAll('[data-k]')].find(c => c.dataset.k === f.k) || fila.querySelector('[data-k="toggle"]'));
  if (x) x.focus(); else $('ext-installed-h')?.focus();
}

// Lo que esta extensión está haciendo AHORA, con un botón para verlo.
function lineasAhora(e, f) {
  const box = el('div', 'ext-now');
  const linea = (texto, act = null, accesible = null, fn = null) => {
    const d = el('div', 'ext-now-line', texto + ' ');
    if (act) {
      const b = el('button', 'ext-link', tx('bTry'));
      b.type = 'button';
      b.dataset.act = act;
      b.dataset.k = act;
      if (accesible) b.setAttribute('aria-label', accesible);
      b.onclick = fn;
      d.appendChild(b);
    }
    box.appendChild(d);
  };
  if (e.themes?.length) {
    const activo = e.themes.find(t => t.themeId === host.currentTheme());
    linea(activo ? tx('nThemeActive', { name: activo.label }) : tx('nThemeIdle'));
  }
  if (f.highlight.length) {
    const ids = f.highlight.map(x => x.id);
    const abiertas = pestañasCon(ideCargado, ids);
    const nombres = lista(f.highlight.map(x => x.name));
    linea(abiertas.length ? tx('nHighlighting', { n: abiertas.length, list: nombres })
      : tx('nHighlightIdle', { list: lista(f.highlight.map(x => x.name + (x.exts.length ? ` (${x.exts.slice(0, 3).join(', ')})` : ''))) }),
    'try-highlight', tx('tryHighlightNamed', { name: nombres }), () => pruebaResaltado(ids));
  }
  if (f.settingsOnly.length) linea(tx('nSettings', { list: lista(f.settingsOnly) }));
  if (f.snippets.length) {
    const n = f.snippets.reduce((a, s) => a + (s.count || 0), 0);
    const langs = lista(f.snippets.map(s => s.name));
    linea(tx('nSnippets', { n, list: langs }), 'try-snippet', tx('trySnippetsNamed', { name: e.displayName }), async () => {
      const destino = await ficheroCon(await ide(), f.snippets.map(s => s.id));
      await pruebaSnippets(e, destino?.path);
    });
  }
  return box.childNodes.length ? box : null;
}

function pintaInstaladas() {
  const box = $('ext-installed');
  if (!box) return;
  // se rehace entera: lo que tenía el foco aquí dentro lo recupera después
  const foco = focoPendiente || (box.contains(document.activeElement) ? claveFoco(document.activeElement) : null);
  focoPendiente = null;
  // …y los avisos que estaban desplegados siguen desplegados
  const desplegados = new Set([...box.querySelectorAll('details.ext-warn[open]')].map(d => d.closest('.ext-row')?.dataset.id));
  const lista = host.list();
  const cab = el('div', 'sk-h', tx('installedH', { n: lista.length }));
  cab.id = 'ext-installed-h';
  cab.tabIndex = -1;
  box.replaceChildren(cab);
  if (!lista.length) { box.appendChild(el('p', 'muted ext-hint', tx('none'))); recuperaFoco(box, foco && { heading: true }); return; }
  for (const e of lista.slice().reverse()) {
    const row = el('div', 'ext-row installed' + (e.enabled ? '' : ' off'));
    row.dataset.id = e.id;
    const main = el('div', 'ext-main');
    const t = el('div', 'ext-title');
    t.append(el('b', null, e.displayName), el('span', 'muted', ` ${e.id} · v${e.version}${e.enabled ? '' : ' · ' + tx('disabled')}`));
    main.append(t);
    if (e.description) main.appendChild(el('div', 'ext-desc', e.description));
    const f = hechosDeRegistro(e);
    const v = describe(f);
    if (e.enabled && !host.paused) {
      const ahora = lineasAhora(e, f);
      if (ahora) main.appendChild(ahora);
    } else main.appendChild(el('div', 'ext-now muted', tx('nOff')));
    main.appendChild(bloqueVeredicto(f, v, { principal: false }));
    const avisos = avisosVisibles(e.warnings).map(textoAviso).filter(Boolean);
    if (avisos.length) {
      const d = el('details', 'ext-warn');
      d.open = desplegados.has(e.id);
      const s = el('summary', null, tx('warnSummary', { n: avisos.length }));
      s.dataset.k = 'warn';
      const ul = el('ul');
      for (const a of avisos) ul.appendChild(el('li', null, a));
      d.append(s, ul);
      main.appendChild(d);
    }
    if (e.enabled && e.themes?.length) {
      const chips = el('div', 'ext-chips ext-theme-chips');
      for (const th of e.themes) {
        const on = host.currentTheme() === th.themeId;
        const c = el('button', 'ext-chip' + (on ? ' on' : ''), '◐ ' + th.label);
        c.type = 'button';
        c.dataset.theme = th.themeId;
        c.dataset.k = 'theme:' + th.themeId;
        c.setAttribute('aria-pressed', String(on));
        c.onclick = async () => { focoPendiente = { id: e.id, k: c.dataset.k }; await host.setTheme(th.themeId); pintaInstaladas(); };
        chips.appendChild(c);
      }
      main.appendChild(chips);
    }
    const meta = el('div', 'ext-meta muted', tx('license', { l: e.license || tx('noLicense') }) + ' · ' + (e.source === 'file' ? tx('fromFile') : e.verified ? tx('verified') : tx('unverified')) + ' ');
    if (e.licenseKey) {
      const ver = el('button', 'ext-link', tx('viewLicense'));
      ver.type = 'button';
      ver.dataset.k = 'license';
      const pre = el('pre', 'ext-license');
      pre.hidden = true;
      pre.id = 'ext-lic-' + (++nDetalle);
      ver.setAttribute('aria-expanded', 'false');
      ver.setAttribute('aria-controls', pre.id);
      ver.onclick = async () => {
        if (pre.hidden && !pre.textContent) pre.textContent = await host.licenseText(e.id);
        pre.hidden = !pre.hidden;
        ver.setAttribute('aria-expanded', String(!pre.hidden));
      };
      meta.appendChild(ver);
      main.append(meta, pre);
    } else main.appendChild(meta);

    const acc = el('div', 'ext-actions');
    const bOn = el('button', 'ghost ext-toggle');
    bOn.type = 'button';
    bOn.dataset.k = 'toggle';
    rotula(bOn, e.enabled ? tx('disable') : tx('enable'), tx(e.enabled ? 'disableNamed' : 'enableNamed', { name: e.displayName }));
    bOn.onclick = async () => {
      focoPendiente = { id: e.id, k: 'toggle' };
      bOn.disabled = true;
      try { await host.setEnabled(e.id, !e.enabled); } catch (err) { aviso(textoError(err), true); }
      pintaInstaladas();
    };
    const bDel = el('button', 'ghost ext-uninstall');
    bDel.type = 'button';
    bDel.dataset.k = 'uninstall';
    rotula(bDel, tx('uninstall'), tx('uninstallNamed', { name: e.displayName }));
    bDel.onclick = async () => {
      if (!confirm(tx('confirmUninstall', { name: e.displayName }))) return;
      // la fila desaparece: el foco pasa a la siguiente (o a la anterior, o al título)
      const filas = [...box.querySelectorAll('.ext-row')];
      const i = filas.findIndex(f => f.dataset.id === e.id);
      const otra = filas[i + 1] || filas[i - 1];
      focoPendiente = otra ? { id: otra.dataset.id, k: 'toggle' } : { heading: true };
      bDel.disabled = true;
      try { await host.uninstall(e.id); } catch (err) { focoPendiente = { id: e.id, k: 'uninstall' }; aviso(textoError(err), true); }
      pintaInstaladas();
      pintaResultados();
    };
    acc.append(bOn, bDel);
    row.append(icono(null, e.displayName), main, acc);
    box.appendChild(row);
  }
  recuperaFoco(box, foco);
}

// ── selector de tema (estilo «Color Theme» de VS Code) ──
// Un combobox con su lista: las flechas mueven la opción activa (y la
// previsualizan), el lector la anuncia (aria-activedescendant), y al cerrar el
// foco vuelve a donde estaba.
export function openThemePicker(h) {
  host = h;
  ponCss();
  $('ext-themepick')?.remove();
  const previo = document.activeElement;
  const original = h.currentTheme();
  const caja = el('div');
  caja.id = 'ext-themepick';
  const inp = el('input');
  inp.placeholder = tx('pickPh');
  inp.autocomplete = 'off';
  inp.spellcheck = false;
  inp.setAttribute('role', 'combobox');
  inp.setAttribute('aria-label', tx('pickPh'));
  inp.setAttribute('aria-expanded', 'true');
  inp.setAttribute('aria-autocomplete', 'list');
  inp.setAttribute('aria-controls', 'ext-tp-list');
  const lista = el('div', 'tp-list');
  lista.id = 'ext-tp-list';
  lista.setAttribute('role', 'listbox');
  lista.setAttribute('aria-label', tx('themeList'));
  caja.append(inp, lista);
  document.body.appendChild(caja);

  let items = [], sel = 0, cerrado = false;
  const etiqueta = t => (t.builtin ? tx(t.labelKey) : t.label);
  const cerrar = async aplicar => {
    if (cerrado) return;
    cerrado = true;
    document.removeEventListener('mousedown', fuera, true);
    caja.remove();
    devuelveFoco(previo, $('ext-theme-btn'), enfocaEditor, $('act-ext'));
    if (aplicar) await h.setTheme(aplicar);
    else await h.previewTheme(original);
    if ($('ext-panel')?.isConnected) pintaInstaladas();
  };
  const fuera = e => { if (!caja.contains(e.target)) cerrar(null); };
  setTimeout(() => document.addEventListener('mousedown', fuera, true), 0);

  function pintaLista() {
    const q = inp.value.trim().toLowerCase();
    const todos = h.themes();
    items = todos.filter(t => !q || (etiqueta(t) + ' ' + (t.extName || '')).toLowerCase().includes(q));
    lista.replaceChildren();
    let grupo = null, caja2 = null;
    items.forEach((t, i) => {
      const g = t.builtin ? tx('builtinGroup') : t.extName;
      if (g !== grupo || !caja2) {
        grupo = g;
        caja2 = el('div', 'tp-grupo');
        caja2.setAttribute('role', 'group');
        caja2.setAttribute('aria-label', g);
        const cab = el('div', 'tp-group', g);
        cab.setAttribute('aria-hidden', 'true');
        caja2.appendChild(cab);
        lista.appendChild(caja2);
      }
      const row = el('div', 'tp-item' + (i === sel ? ' sel' : ''));
      row.id = 'ext-tp-' + i;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(i === sel));
      row.dataset.theme = t.id;
      row.append(el('span', null, etiqueta(t)));
      if (t.id === original) row.appendChild(el('span', 'muted', tx('current')));
      row.onclick = () => cerrar(t.id);
      caja2.appendChild(row);
    });
  }
  const marca = () => {
    const filas = lista.querySelectorAll('.tp-item');
    filas.forEach((r, i) => { r.classList.toggle('sel', i === sel); r.setAttribute('aria-selected', String(i === sel)); });
    const activa = filas[sel];
    if (activa) { inp.setAttribute('aria-activedescendant', activa.id); activa.scrollIntoView({ block: 'nearest' }); }
    else inp.removeAttribute('aria-activedescendant');
  };
  inp.oninput = () => { sel = 0; pintaLista(); marca(); };
  inp.onkeydown = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      marca();
      h.previewTheme(items[sel].id);
    } else if (e.key === 'Enter') { e.preventDefault(); if (items[sel]) cerrar(items[sel].id); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(null); }
  };
  pintaLista();
  sel = Math.max(0, items.findIndex(t => t.id === original));
  marca();
  inp.focus();
}
