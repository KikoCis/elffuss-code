// Panel de extensiones: buscar en Open VSX, ver qué aplicaría cada una,
// instalar (o un .vsix suelto), activar/desactivar, desinstalar, licencia, y
// el selector de tema de color. Mismo patrón que el panel de Skills: se pinta
// dentro de #settings-panel. Todo texto que viene de una extensión entra con
// textContent, nunca como HTML.
import { tx } from './i18n.js';

const $ = id => document.getElementById(id);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const CATS = [['', 'catAll'], ['Themes', 'catThemes'], ['Snippets', 'catSnippets'], ['Programming Languages', 'catLangs']];

let host = null;
let cssPuesto = false;
const estado = { q: '', cat: null, items: [], total: 0, cargando: false, msg: null, ctl: null };
let temporizador = null;
let desuscribe = null;

function ponCss() {
  if (cssPuesto) return;
  cssPuesto = true;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('../../css/ext.css', import.meta.url).href;
  document.head.appendChild(l);
}

export function open(h, { themes = false } = {}) {
  host = h;
  ponCss();
  desuscribe?.();
  desuscribe = h.onChange(() => { if ($('ext-panel')?.isConnected) pintaInstaladas(); });
  if (themes) return openThemePicker(h);
  estado.msg = null;                    // un aviso viejo no se repite al volver a abrir
  pinta();
}

// ── mensajes de error legibles ──
function textoError(e) {
  if (e?.code === 'rate') return tx('errRate');
  if (e?.code === 'net') return tx('errNet', { e: e.message });
  if (e?.code === 'sha') return tx('errSha');
  if (e?.code === 'nothing') return tx('errNothing');
  if (e?.code === 'notvsix') return tx('errNotVsix');
  if (e?.code === 'cancel' || e?.name === 'AbortError') return tx('cancelled');
  return tx('err', { e: e?.message || String(e) });
}
function aviso(texto, error = false) {
  estado.msg = texto ? { texto, error } : null;
  const m = $('ext-msg');
  if (!m) return;
  m.textContent = texto || '';
  m.hidden = !texto;
  m.classList.toggle('err', !!error);
}

// «Aplica: 2 temas · No aplica: commands (necesita su código)»
function lineasResumen({ themes = 0, grammars = 0, languages = 0, snippetLangs = [], ignored = [], hasCode = false, pack = [] }) {
  const aplica = [];
  if (themes) aplica.push(tx('themes', { n: themes }));
  if (grammars) aplica.push(tx('grammars', { n: grammars }));
  if (languages) aplica.push(tx('languages', { n: languages }));
  if (snippetLangs.length) aplica.push(tx('snippets', { langs: snippetLangs.slice(0, 6).join(', ') + (snippetLangs.length > 6 ? '…' : '') }));
  const porMotivo = { code: [], later: [] };
  for (const i of ignored) (porMotivo[i.why] || porMotivo.later).push(i.key);
  const no = [];
  if (porMotivo.code.length) no.push(`${porMotivo.code.join(', ')} (${tx('needsCode')})`);
  if (porMotivo.later.length) no.push(`${porMotivo.later.join(', ')} (${tx('notYet')})`);
  const out = [];
  out.push(aplica.length ? { cls: 'ext-applies', t: tx('applies', { list: aplica.join(' · ') }) } : { cls: 'ext-nothing', t: tx('nothing') });
  if (no.length) out.push({ cls: 'ext-ignored', t: tx('ignores', { list: no.join(' · ') }) });
  if (hasCode) out.push({ cls: 'ext-ignored', t: tx('hasCode') });
  if (pack.length) out.push({ cls: 'ext-ignored', t: tx('pack', { n: pack.length }) });
  return out;
}

// ── panel ──
function pinta() {
  const box = $('settings-panel');
  box.hidden = false;
  box.replaceChildren();
  const cerrar = el('button', null, '✕');
  cerrar.id = 'settings-close';
  cerrar.onclick = () => { box.hidden = true; };
  const wrap = el('div', 'ext-panel');
  wrap.id = 'ext-panel';
  const h3 = el('h3', null, tx('title') + ' ');
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
  inp.autocomplete = 'off';
  inp.spellcheck = false;
  inp.value = estado.q;
  inp.oninput = () => { estado.q = inp.value.trim(); clearTimeout(temporizador); temporizador = setTimeout(() => busca_(), 350); };
  inp.onkeydown = e => { if (e.key === 'Enter') { clearTimeout(temporizador); busca_(); } };
  const chips = el('div', 'ext-chips');
  for (const [cat, key] of CATS) {
    const c = el('button', 'ext-chip' + (estado.cat === cat ? ' on' : ''), tx(key));
    c.dataset.cat = cat;
    c.onclick = () => { estado.cat = estado.cat === cat && cat ? '' : cat; busca_(); };
    chips.appendChild(c);
  }
  busca.append(inp, chips);
  wrap.appendChild(busca);

  const msg = el('div', 'ext-msg');
  msg.id = 'ext-msg';
  msg.hidden = true;
  wrap.appendChild(msg);
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
  document.querySelectorAll('.ext-chip').forEach(c => c.classList.toggle('on', c.dataset.cat === (estado.cat || '') && estado.cat != null));
  try {
    const r = await ovsx.search(estado.q, { category: estado.cat || '', offset: mas ? estado.items.length : 0, size: 20, signal: ctl.signal });
    if (estado.ctl !== ctl) return;
    estado.items = mas ? estado.items.concat(r.items) : r.items;
    estado.total = r.total;
  } catch (e) {
    if (e.name === 'AbortError') return;
    aviso(textoError(e), true);
  } finally {
    if (estado.ctl === ctl) { estado.cargando = false; pintaResultados(); }
  }
}

function pintaResultados() {
  const res = $('ext-results');
  if (!res) return;
  res.replaceChildren();
  if (estado.cargando && !estado.items.length) { res.appendChild(el('div', 'muted ext-hint', tx('searching'))); return; }
  if (!estado.items.length) {
    if (estado.q || estado.cat != null) res.appendChild(el('div', 'muted ext-hint', estado.cargando ? tx('searching') : tx('noResults')));
    return;
  }
  res.appendChild(el('div', 'sk-h', estado.q ? tx('results', { n: estado.total }) : tx('popular')));
  const instaladas = new Map(host.list().map(e => [e.id, e]));
  for (const it of estado.items) res.appendChild(filaResultado(it, instaladas.get(`${it.namespace}.${it.name}`.toLowerCase())));
  if (estado.items.length < estado.total) {
    const mas = el('button', 'ghost ext-more', tx('more'));
    mas.onclick = () => busca_({ mas: true });
    res.appendChild(mas);
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
  return el('div', 'ext-ico ext-ico-letra', (nombre || '?').trim().charAt(0).toUpperCase());
}

function filaResultado(it, instalada) {
  const row = el('div', 'ext-row');
  row.dataset.id = `${it.namespace}.${it.name}`;
  const main = el('div', 'ext-main');
  const t = el('div', 'ext-title');
  t.append(el('b', null, it.displayName), el('span', 'muted', ` ${it.namespace} · v${it.version}`));
  if (it.verified) t.appendChild(el('span', 'ext-badge', '✓'));
  main.append(t, el('div', 'ext-desc', it.description));
  main.appendChild(el('div', 'ext-meta muted', tx('downloads', { n: it.downloadCount.toLocaleString() })));
  const det = el('div', 'ext-detail');
  det.hidden = true;
  main.appendChild(det);
  main.onclick = () => detalle(it, det);
  main.title = tx('details');

  const acc = el('div', 'ext-actions');
  const b = el('button', 'primary ext-install');
  if (instalada && instalada.version === it.version) { b.textContent = tx('installedOk'); b.className = 'ghost ext-install'; b.disabled = true; }
  else b.textContent = instalada ? tx('update', { v: it.version }) : tx('install');
  b.onclick = e => { e.stopPropagation(); instala(it, b); };
  acc.appendChild(b);
  row.append(icono(it.icon, it.displayName), main, acc);
  return row;
}

async function detalle(it, det) {
  if (!det.hidden) { det.hidden = true; return; }
  det.hidden = false;
  if (det.dataset.listo) return;
  det.replaceChildren(el('div', 'muted', tx('loadingDetails')));
  try {
    const ovsx = await import('./openvsx.js');
    const { analyzeManifest } = await import('./vsix.js');
    const meta = await ovsx.metadata(it.namespace, it.name, it.version);
    const a = analyzeManifest(await ovsx.manifest(meta));
    det.replaceChildren();
    for (const l of lineasResumen({ ...a.applies, snippetLangs: a.snippetLangs, ignored: a.ignored, hasCode: a.hasCode, pack: a.pack })) det.appendChild(el('div', l.cls, l.t));
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
    // nada aplicable: instalarla solo daría un error, mejor decirlo en el botón
    const boton = det.closest('.ext-row')?.querySelector('.ext-install');
    if (!a.any && boton && !boton.disabled) { boton.disabled = true; boton.title = tx('nothing'); boton.className = 'ghost ext-install'; }
  } catch (e) { det.replaceChildren(el('div', 'ext-ignored', textoError(e))); }
}

async function instala(src, boton) {
  const nombre = src instanceof Blob ? src.name : src.displayName;
  const original = boton?.textContent;
  if (boton) { boton.disabled = true; boton.textContent = tx('installing'); }
  aviso(null);
  try {
    const rec = await host.install(src instanceof Blob ? src : { namespace: src.namespace, name: src.name, version: src.version }, {
      onProgress: (n, total) => { if (boton && total) boton.textContent = tx('downloading', { pct: Math.round(n / total * 100) }); },
      confirmLarge: async mb => confirm(tx('bigConfirm', { mb })),
    });
    if (boton) { boton.textContent = tx('installedOk'); boton.className = 'ghost ext-install'; }
    aviso(tx('installedMsg', { name: rec.displayName || nombre }));
  } catch (e) {
    if (boton) { boton.disabled = false; boton.textContent = original; }
    aviso(textoError(e), true);
  }
}

function pintaInstaladas() {
  const box = $('ext-installed');
  if (!box) return;
  const lista = host.list();
  box.replaceChildren(el('div', 'sk-h', tx('installedH', { n: lista.length })));
  if (!lista.length) { box.appendChild(el('p', 'muted ext-hint', tx('none'))); return; }
  const saltadas = host.skippedGrammars();
  for (const e of lista.slice().reverse()) {
    const row = el('div', 'ext-row installed' + (e.enabled ? '' : ' off'));
    row.dataset.id = e.id;
    const main = el('div', 'ext-main');
    const t = el('div', 'ext-title');
    t.append(el('b', null, e.displayName), el('span', 'muted', ` ${e.id} · v${e.version}${e.enabled ? '' : ' · ' + tx('disabled')}`));
    main.append(t);
    if (e.description) main.appendChild(el('div', 'ext-desc', e.description));
    const langsSnip = [...new Set((e.snippets || []).map(s => s.language))];
    for (const l of lineasResumen({ themes: e.themes?.length, grammars: e.grammars?.length, languages: e.languages?.length, snippetLangs: langsSnip, ignored: e.ignored || [], hasCode: e.hasCode, pack: e.pack || [] })) main.appendChild(el('div', l.cls, l.t));
    for (const g of saltadas.filter(g => g.ext === e.id)) main.appendChild(el('div', 'ext-ignored', tx('grammarSkipped', { lang: g.language })));
    if (e.enabled && e.themes?.length) {
      const chips = el('div', 'ext-chips ext-theme-chips');
      for (const th of e.themes) {
        const c = el('button', 'ext-chip' + (host.currentTheme() === th.themeId ? ' on' : ''), '◐ ' + th.label);
        c.dataset.theme = th.themeId;
        c.onclick = async () => { await host.setTheme(th.themeId); pintaInstaladas(); };
        chips.appendChild(c);
      }
      main.appendChild(chips);
    }
    const meta = el('div', 'ext-meta muted', tx('license', { l: e.license || tx('noLicense') }) + ' · ' + (e.source === 'file' ? tx('fromFile') : e.verified ? tx('verified') : tx('unverified')) + ' ');
    if (e.licenseKey) {
      const ver = el('a', null, tx('viewLicense'));
      ver.href = '#';
      const pre = el('pre', 'ext-license');
      pre.hidden = true;
      ver.onclick = async ev => {
        ev.preventDefault();
        if (pre.hidden && !pre.textContent) pre.textContent = await host.licenseText(e.id);
        pre.hidden = !pre.hidden;
      };
      meta.appendChild(ver);
      main.append(meta, pre);
    } else main.appendChild(meta);

    const acc = el('div', 'ext-actions');
    const bOn = el('button', 'ghost ext-toggle', e.enabled ? tx('disable') : tx('enable'));
    bOn.onclick = async () => { bOn.disabled = true; try { await host.setEnabled(e.id, !e.enabled); } catch (err) { aviso(textoError(err), true); } pintaInstaladas(); };
    const bDel = el('button', 'ghost ext-uninstall', tx('uninstall'));
    bDel.onclick = async () => {
      if (!confirm(tx('confirmUninstall', { name: e.displayName }))) return;
      bDel.disabled = true;
      try { await host.uninstall(e.id); } catch (err) { aviso(textoError(err), true); }
      pintaInstaladas();
      pintaResultados();
    };
    acc.append(bOn, bDel);
    row.append(icono(null, e.displayName), main, acc);
    box.appendChild(row);
  }
}

// ── selector de tema (estilo «Color Theme» de VS Code) ──
export function openThemePicker(h) {
  host = h;
  ponCss();
  $('ext-themepick')?.remove();
  const original = h.currentTheme();
  const caja = el('div');
  caja.id = 'ext-themepick';
  const inp = el('input');
  inp.placeholder = tx('pickPh');
  inp.autocomplete = 'off';
  inp.spellcheck = false;
  const lista = el('div', 'tp-list');
  caja.append(inp, lista);
  document.body.appendChild(caja);

  let items = [], sel = 0, cerrado = false;
  const etiqueta = t => (t.builtin ? tx(t.labelKey) : t.label);
  const cerrar = async aplicar => {
    if (cerrado) return;
    cerrado = true;
    document.removeEventListener('mousedown', fuera, true);
    caja.remove();
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
    let grupo = null;
    items.forEach((t, i) => {
      const g = t.builtin ? tx('builtinGroup') : t.extName;
      if (g !== grupo) { grupo = g; lista.appendChild(el('div', 'tp-group', g)); }
      const row = el('button', 'tp-item' + (i === sel ? ' sel' : ''));
      row.dataset.theme = t.id;
      row.append(el('span', null, etiqueta(t)));
      if (t.id === original) row.appendChild(el('span', 'muted', tx('current')));
      row.onclick = () => cerrar(t.id);
      lista.appendChild(row);
    });
  }
  const marca = () => {
    lista.querySelectorAll('.tp-item').forEach((r, i) => r.classList.toggle('sel', i === sel));
    lista.querySelectorAll('.tp-item')[sel]?.scrollIntoView({ block: 'nearest' });
  };
  inp.oninput = () => { sel = 0; pintaLista(); };
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
