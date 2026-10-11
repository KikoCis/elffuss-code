// Panel de extensiones: buscar en Open VSX, ver qué aplicaría cada una,
// instalar (o un .vsix suelto), activar/desactivar, desinstalar, licencia, y
// el selector de tema de color. Mismo patrón que el panel de Skills: se pinta
// dentro de #settings-panel. Todo texto que viene de una extensión entra con
// textContent, nunca como HTML.
//
// Teclado y lector de pantalla: todo lo que se pulsa es un botón (o un
// <summary>), los resultados y avisos se anuncian (role=status/alert), el
// foco no se pierde al repintar ni al cerrar, y Escape cierra el panel.
//
// Extensiones con código (nivel 2): lo que funcionará de cada una, el filtro
// «Funciona en Code», el consentimiento y los mandos de las instaladas viven en
// ../ext2/manage.js, que solo se carga cuando hace falta (al desplegar un
// detalle, con el filtro, al pedir ejecutar código o si ya hay alguna).
import { tx } from './i18n.js';

const $ = id => document.getElementById(id);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const CATS = [['', 'catAll'], ['Themes', 'catThemes'], ['Snippets', 'catSnippets'], ['Programming Languages', 'catLangs']];
const PAGINAS_FILTRO = 5;               // con «Funciona en Code», como mucho 5 páginas para llenar una
const gestor = () => import('../ext2/manage.js');

let host = null;
let cssPuesto = false;
const estado = { q: '', cat: null, items: [], total: 0, cargando: false, msg: null, ctl: null, works: false, checked: 0, cls: new Map() };
let bajas = [];                         // suscripciones de los mandos de código (se sueltan al repintar)
let temporizador = null;
let desuscribe = null;
let abridor = null;                     // quién tenía el foco al abrir el panel
let focoPendiente = null;               // control a recuperar tras repintar «Instaladas»
let nDetalle = 0;

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

export async function open(h, { themes = false } = {}) {
  host = h;
  ponCss();
  desuscribe?.();
  desuscribe = h.onChange(() => { if ($('ext-panel')?.isConnected) pintaInstaladas(); });
  if (themes) return openThemePicker(h);
  const box = $('settings-panel');
  if (!$('ext-panel')?.isConnected || box.hidden) abridor = document.activeElement;
  estado.msg = null;                    // un aviso viejo no se repite al volver a abrir
  // con alguna extensión con código instalada, sus mandos se pintan ya
  if (!m2 && h.list().some(e => e.code || e.browser)) { try { m2 = await gestor(); } catch { /* sin mandos de código */ } }
  pinta();
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
  big: 'errBig', noname: 'errNoName', blocked: 'errBlocked',
  nosha: 'errNosha', nocode: 'errNocode', noentry: 'errNoentry', codeonly: 'errCodeonly',
  'x2-site': 'x2Unavail_site', 'x2-browser': 'x2Unavail_browser', 'x2-off': 'x2Unavail_off', 'x2-url': 'x2Unavail_url',
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
// Con `code` (trae código para el navegador y el nivel 2 lo cuenta debajo) no
// se dice «nada se puede aplicar» ni se listan las partes que son de su código.
function resumen({ themes = 0, grammarLangs = [], languageList = [], snippetLangs = [], ignored = [], hasCode = false, pack = [], code = false }) {
  const saltaGram = l => !!l && !!host.grammarSkippedFor?.(l);
  const deSerie = id => !!host.builtinLanguage?.(id);
  const gramSaltadas = [...new Set(grammarLangs.filter(saltaGram))];
  const confSaltadas = [...new Set(languageList.filter(l => l.config && deSerie(l.id)).map(l => l.id))];
  const grammars = grammarLangs.filter(l => !saltaGram(l)).length;
  const languages = languageList.filter(l => !deSerie(l.id)).length;
  const aplica = [];
  if (themes) aplica.push(tx('themes', { n: themes }));
  if (grammars) aplica.push(tx('grammars', { n: grammars }));
  if (languages) aplica.push(tx('languages', { n: languages }));
  if (snippetLangs.length) aplica.push(tx('snippets', { langs: snippetLangs.slice(0, 6).join(', ') + (snippetLangs.length > 6 ? '…' : '') }));
  const porMotivo = { code: [], later: [] };
  for (const i of ignored) (porMotivo[i.why] || porMotivo.later).push(i.key);
  const no = [...gramSaltadas.map(lang => tx('grammarNotApplied', { lang })), ...confSaltadas.map(lang => tx('settingsNotApplied', { lang }))];
  if (porMotivo.code.length && !code) no.push(`${porMotivo.code.join(', ')} (${tx('needsCode')})`);
  if (porMotivo.later.length) no.push(`${porMotivo.later.join(', ')} (${tx('notYet')})`);
  const lineas = [];
  if (aplica.length) lineas.push({ cls: 'ext-applies', t: tx('applies', { list: aplica.join(' · ') }) });
  else if (!code) lineas.push({ cls: 'ext-nothing', t: tx('nothing') });
  if (no.length) lineas.push({ cls: 'ext-ignored', t: tx('ignores', { list: no.join(' · ') }) });
  if (hasCode) lineas.push({ cls: 'ext-ignored', t: tx('hasCode') });
  if (pack.length) lineas.push({ cls: 'ext-ignored', t: tx('pack', { n: pack.length }) });
  return { lineas, any: aplica.length > 0 };
}

// Botón de acción: texto visible y nombre accesible con la extensión
// («Instalar Monokai»). Sin nombre accesible, el lector lee el texto visible
// (el progreso de la descarga, por ejemplo).
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
  // con alguna extensión con código instalada, la explicación cambia
  const conCodigo = host.list().some(e => e.code);
  wrap.append(h3, el('p', 'muted ext-intro', tx(conCodigo ? 'introCode' : 'intro')));
  const iso = el('details', 'ext-iso');
  const isoS = el('summary', null, tx('isoTitle'));
  isoS.dataset.k = 'iso';
  iso.appendChild(isoS);
  const isoUl = el('ul');
  for (const k of ['iso1', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6']) isoUl.appendChild(el('li', null, tx(k)));
  iso.appendChild(isoUl);
  wrap.appendChild(iso);
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
  // «Funciona en Code»: esconde lo que no funcionaría aquí (mira el manifiesto
  // de cada resultado: Open VSX ve esas consultas, y se dice debajo)
  const works = el('button', 'ext-chip ext-works' + (estado.works ? ' on' : ''), tx('chipWorks'));
  works.type = 'button';
  works.id = 'ext-works';
  works.setAttribute('aria-pressed', String(estado.works));
  works.onclick = () => {
    estado.works = !estado.works;
    works.classList.toggle('on', estado.works);
    works.setAttribute('aria-pressed', String(estado.works));
    $('ext-works-note').hidden = !estado.works;
    busca_();
  };
  chips.appendChild(works);
  busca.append(inp, chips);
  wrap.appendChild(busca);
  const nota = el('p', 'muted ext-works-note', tx('worksPrivacy'));
  nota.id = 'ext-works-note';
  nota.hidden = !estado.works;
  wrap.appendChild(nota);

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
  const ovsx = await import('./openvsx.js');
  if (!estado.q && estado.cat == null) { estado.items = []; estado.total = 0; pintaResultados(); return; }
  estado.cargando = true;
  if (!mas) { estado.items = []; estado.total = 0; }
  aviso(null);
  pintaResultados();
  // solo las categorías: las fichas de tema de «Instaladas» también son .ext-chip
  for (const c of document.querySelectorAll('#ext-panel .ext-search .ext-chip[data-cat]')) {
    const on = c.dataset.cat === (estado.cat || '') && estado.cat != null;
    c.classList.toggle('on', on);
    c.setAttribute('aria-pressed', String(on));
  }
  if (!mas) estado.checked = 0;
  try {
    // con «Funciona en Code» se llena una página de las que funcionan, mirando
    // como mucho PAGINAS_FILTRO páginas de resultados
    const objetivo = (mas ? estado.items.filter(seVe).length : 0) + 20;
    for (let paginas = 0; ;) {
      const r = await ovsx.search(estado.q, { category: estado.cat || '', offset: estado.items.length, size: 20, signal: ctl.signal });
      if (estado.ctl !== ctl) return;
      estado.items = estado.items.concat(r.items);
      estado.total = r.total;
      paginas++;
      if (!estado.works) break;
      const m = await gestor();
      const store = await import('./store.js');
      pintaResultados();
      await m.classifyResults(r.items, {
        ovsx, store, signal: ctl.signal, installedIds: new Set(host.list().map(e => e.id)),
        onEach: (it, c) => { if (estado.ctl !== ctl) return; estado.cls.set(clave(it), c); estado.checked++; pintaResultadosPronto(); },
      });
      if (estado.ctl !== ctl) return;
      if (estado.items.filter(seVe).length >= objetivo || estado.items.length >= estado.total || !r.items.length || paginas >= PAGINAS_FILTRO) break;
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
    aviso(textoError(e), true);
  } finally {
    if (estado.ctl === ctl) { estado.cargando = false; pintaResultados(); }
  }
}

const clave = it => `${it.namespace}.${it.name}@${it.version}`.toLowerCase();
// con el filtro: solo lo que funcionaría (lo que no se pudo comprobar se enseña)
const seVe = it => {
  if (!estado.works) return true;
  const c = estado.cls.get(clave(it));
  return c === null || (c !== undefined && c.works);
};
let pintaPendiente = null;
const pintaResultadosPronto = () => { pintaPendiente ??= setTimeout(() => { pintaPendiente = null; pintaResultados(); }, 150); };

function pintaResultados() {
  const res = $('ext-results');
  if (!res) return;
  // el foco no se pierde al repintar (el filtro repinta según comprueba)
  const foco = res.contains(document.activeElement) ? document.activeElement.closest('.ext-row')?.dataset.id : null;
  res.replaceChildren();
  if (estado.cargando && !estado.items.length) {
    res.appendChild(el('div', 'muted ext-hint', tx('searching')));
    anunciaBusqueda(tx('searching'));
    return;
  }
  const vistos = estado.items.filter(seVe);
  if (!vistos.length) {
    if (estado.q || estado.cat != null) {
      const t = estado.cargando ? tx('searching') : estado.works && estado.items.length ? tx('worksNone', { n: estado.checked, total: estado.total }) : tx('noResults');
      res.appendChild(el('div', 'muted ext-hint', t));
      anunciaBusqueda(t);
    } else anunciaBusqueda('');
    return;
  }
  if (estado.works) {
    const t = tx('worksChecked', { k: vistos.length, n: estado.checked, total: estado.total });
    res.appendChild(el('div', 'sk-h', t));
    anunciaBusqueda(estado.cargando ? tx('searching') : t);
  } else {
    res.appendChild(el('div', 'sk-h', estado.q ? tx('results', { n: estado.total }) : tx('popular')));
    anunciaBusqueda(tx('results', { n: estado.total }));
  }
  const instaladas = new Map(host.list().map(e => [e.id, e]));
  for (const it of vistos) res.appendChild(filaResultado(it, instaladas.get(`${it.namespace}.${it.name}`.toLowerCase())));
  if (estado.items.length < estado.total && !estado.cargando) {
    const mas = el('button', 'ghost ext-more', tx('more'));
    mas.onclick = () => busca_({ mas: true });
    res.appendChild(mas);
  }
  if (foco) [...res.querySelectorAll('.ext-row')].find(r => r.dataset.id === foco)?.querySelector('.ext-name')?.focus();
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

function filaResultado(it, instalada) {
  const row = el('div', 'ext-row');
  row.dataset.id = `${it.namespace}.${it.name}`;
  const main = el('div', 'ext-main');
  const det = el('div', 'ext-detail');
  det.id = 'ext-det-' + (++nDetalle);
  det.hidden = true;
  // el nombre es el botón que despliega el detalle (qué aplicaría y qué no):
  // antes de instalar, también con teclado
  const t = el('div', 'ext-title');
  const nombre = el('button', 'ext-name', it.displayName);
  nombre.type = 'button';
  nombre.title = tx('details');
  nombre.setAttribute('aria-expanded', 'false');
  nombre.setAttribute('aria-controls', det.id);
  nombre.onclick = e => { e.stopPropagation(); detalle(it, det, nombre); };
  t.append(nombre, el('span', 'muted', ` ${it.namespace} · v${it.version}`));
  if (it.verified) t.appendChild(el('span', 'ext-badge', '✓'));
  main.append(t, el('div', 'ext-desc', it.description));
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
  // actualizar una que corre su código la trae con su código (y su suma)
  b.onclick = e => { e.stopPropagation(); if (!esInerte(b)) instala(it, b, { withCode: !!instalada?.code }); };
  acc.appendChild(b);
  // nivel 2: si ya se sabe qué funcionará (filtro o detalle), se dice en la fila
  const c = estado.cls.get(clave(it));
  if (c && m2) {
    const lineas = el('div', 'ext-x2-lines');
    for (const l of m2.linesFor(c)) lineas.appendChild(el('div', l.cls, l.t));
    main.insertBefore(lineas, det);
    ponBotonCodigo(acc, it, c, instalada);
  }
  row.append(icono(it.icon, it.displayName), main, acc);
  return row;
}

// Instalar con su código (el botón, el consentimiento y la instalación): en
// ../ext2/manage.js, que se carga con el detalle, el filtro o si hay alguna.
let m2 = null;                          // ../ext2/manage.js, una vez cargado
let conCodigo = null;
const codigo = () => (conCodigo ??= m2.codeInstall({ host: () => host, aviso, instala, rotula, inerte, esInerte }));
const ponBotonCodigo = (...a) => { if (m2) codigo().button(...a); };

async function detalle(it, det, boton) {
  det.hidden = !det.hidden;
  boton?.setAttribute('aria-expanded', String(!det.hidden));
  if (det.hidden || det.dataset.listo) return;
  det.replaceChildren(el('div', 'muted', tx('loadingDetails')));
  try {
    const ovsx = await import('./openvsx.js');
    const { analyzeManifest } = await import('./vsix.js');
    const meta = await ovsx.metadata(it.namespace, it.name, it.version);
    const manifest = await ovsx.manifest(meta);
    const a = analyzeManifest(manifest);
    m2 ??= await gestor();
    const d2 = await m2.describe(manifest, { installedIds: new Set(host.list().map(e => e.id)) });
    estado.cls.set(clave(it), d2.cls);
    // «Funciona ya (sin código)» del nivel 2 en vez del «Aplica» de siempre (lo
    // mismo), luego lo que no se aplica y por qué, y luego lo de su código
    const r = resumen({ themes: a.applies.themes, grammarLangs: a.grammarLangs, languageList: a.languageList, snippetLangs: a.snippetLangs, ignored: a.ignored, hasCode: false, pack: a.pack, code: d2.cls.runtime === 'browser' });
    const ya = d2.lines.filter(l => l.cls === 'ext-applies');
    det.replaceChildren(...[...ya, ...r.lineas.filter(l => l.cls !== 'ext-applies' || !ya.length), ...d2.lines.filter(l => !ya.includes(l))].map(l => el('div', l.cls, l.t)));
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
    // nada aplicable: instalarla solo daría un error, mejor decirlo en el botón
    const inst = fila?.querySelector('.ext-install');
    if (!r.any && !d2.cls.eligible && inst && !esInerte(inst)) { inerte(inst, true); inst.title = tx('nothing'); inst.className = 'ghost ext-install'; }
    const acc = fila?.querySelector('.ext-actions');
    if (acc) ponBotonCodigo(acc, it, d2.cls, host.list().find(e => e.id === `${it.namespace}.${it.name}`.toLowerCase()));
  } catch (e) { det.replaceChildren(el('div', 'ext-ignored', textoError(e))); }
}

async function instala(src, boton, { withCode = false } = {}) {
  const nombre = src instanceof Blob ? src.name : src.displayName;
  const original = boton ? { texto: boton.textContent, accesible: boton.getAttribute('aria-label') } : null;
  if (boton) { inerte(boton, true); rotula(boton, tx('installing')); }
  aviso(null);
  try {
    const rec = await host.install(src instanceof Blob ? src : { namespace: src.namespace, name: src.name, version: src.version }, {
      onProgress: (n, total) => { if (boton && total) boton.textContent = tx('downloading', { pct: Math.round(n / total * 100) }); },
      confirmLarge: async mb => confirm(tx('bigConfirm', { mb })),
      withCode,
    });
    if (boton) { rotula(boton, tx('installedOk'), tx('installedNamed', { name: rec.displayName || nombre })); boton.className = 'ghost ' + (withCode ? 'ext-install-code' : 'ext-install'); }
    const nAvisos = avisosVisibles(rec.warnings).length;
    aviso(tx(withCode ? 'installedCodeMsg' : 'installedMsg', { name: rec.displayName || nombre }) + (nAvisos ? ' ' + tx('warnSummary', { n: nAvisos }) + '.' : ''));
    // un .vsix con temas o snippets Y código para el navegador: se ofrece
    // también su código (desde un fichero no hay otra forma de traerlo luego)
    if (src instanceof Blob && !withCode && rec.browser && !rec.code) return instalaFicheroConCodigo(src, { yaInstalada: true });
  } catch (e) {
    if (boton) { inerte(boton, false); rotula(boton, original.texto, original.accesible); }
    // un .vsix con solo código: se ofrece ejecutarlo (con su consentimiento)
    if (e?.code === 'codeonly' && src instanceof Blob) return instalaFicheroConCodigo(src);
    aviso(textoError(e), true);
  }
}

const instalaFicheroConCodigo = async (file, opts) => { m2 ??= await gestor(); return codigo().file(file, opts); };

// ── instaladas ──
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

function pintaInstaladas() {
  const box = $('ext-installed');
  if (!box) return;
  // se rehace entera: lo que tenía el foco aquí dentro lo recupera después
  const foco = focoPendiente || (box.contains(document.activeElement) ? claveFoco(document.activeElement) : null);
  focoPendiente = null;
  // …y los avisos que estaban desplegados siguen desplegados
  const desplegados = new Set([...box.querySelectorAll('details.ext-warn[open]')].map(d => d.closest('.ext-row')?.dataset.id));
  // (y los plegables de los mandos de código, con lo que se estaba escribiendo)
  const abiertos = new Set([...box.querySelectorAll('.ext-x2 details[open]')].map(d => d.closest('.ext-row')?.dataset.id + '|' + d.className));
  const borradores = new Map([...box.querySelectorAll('.ext-x2-json')].map(t => [t.closest('.ext-row')?.dataset.id, t.value]));
  for (const b of bajas) { try { b(); } catch { /* — */ } }
  bajas = [];
  const lista = host.list();
  // la explicación del panel cambia con la primera extensión con código (y vuelve sin ninguna)
  const intro = document.querySelector('#ext-panel .ext-intro');
  if (intro) intro.textContent = tx(lista.some(e => e.code) ? 'introCode' : 'intro');
  const cab = el('div', 'sk-h', tx('installedH', { n: lista.length }));
  cab.id = 'ext-installed-h';
  cab.tabIndex = -1;
  box.replaceChildren(cab);
  if (!lista.length) { box.appendChild(el('p', 'muted ext-hint', tx('none'))); recuperaFoco(box, foco && { heading: true }); return; }
  // con código en marcha: una línea con su estado y un botón para apagarlo todo
  if (lista.some(e => e.runs && e.enabled) && m2) {
    const linea = m2.runtimeLine(host);
    if (linea) box.appendChild(linea);
    const todo = el('button', 'ghost ext-x2-alloff', tx('allCodeOff'));
    todo.type = 'button';
    todo.onclick = async () => { for (const e of host.list()) if (e.runs) await host.setRuns(e.id, false); };
    box.appendChild(todo);
  }
  if ((lista.some(e => e.code || e.browser)) && !m2) gestor().then(m => { m2 = m; pintaInstaladas(); }).catch(() => {});
  for (const e of lista.slice().reverse()) {
    const row = el('div', 'ext-row installed' + (e.enabled ? '' : ' off'));
    row.dataset.id = e.id;
    const main = el('div', 'ext-main');
    const t = el('div', 'ext-title');
    t.append(el('b', null, e.displayName), el('span', 'muted', ` ${e.id} · v${e.version}${e.enabled ? '' : ' · ' + tx('disabled')}`));
    main.append(t);
    if (e.description) main.appendChild(el('div', 'ext-desc', e.description));
    const r = resumen({
      themes: e.themes?.length || 0,
      grammarLangs: (e.grammars || []).map(g => g.language ?? null),
      languageList: (e.languages || []).map(l => ({ id: l.id, config: !!l.configKey })),
      snippetLangs: [...new Set((e.snippets || []).map(s => s.language))],
      // (el código para el navegador lo cuentan los mandos de abajo)
      ignored: e.ignored || [], hasCode: e.hasCode && !e.code && !e.browser, pack: e.pack || [], code: !!(e.code || e.browser),
    });
    for (const l of r.lineas) main.appendChild(el('div', l.cls, l.t));
    // mandos del código (nivel 2): ejecutar o no, estado, comandos, ajustes…
    if ((e.code || e.browser) && m2) {
      const b = m2.codeBlock(e, {
        host,
        onGetCode: rec => codigo().installed(rec),
        onMessage: (t, error) => aviso(t, error),
        register: f => bajas.push(f),
      });
      for (const d of b.querySelectorAll('details')) if (abiertos.has(e.id + '|' + d.className)) d.open = true;
      const ta = b.querySelector('.ext-x2-json');
      if (ta && borradores.has(e.id)) ta.value = borradores.get(e.id);
      main.appendChild(b);
    }
    // lo que el paquete declaraba y no se pudo usar: plegado, sin esconderlo
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
