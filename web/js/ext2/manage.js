// Gestor de extensiones con código (nivel 2) dentro del panel de extensiones.
// Lo carga js/ext/panel.js solo cuando hace falta: al desplegar el detalle de
// un resultado, con el filtro «Funciona en Code», al pulsar «Instalar y
// ejecutar su código…» o si hay instalada alguna extensión con código. Con
// solo buscar no se carga.
//
//   · lines(): qué funcionará, en el idioma de la interfaz (lo declarativo,
//     el código en el recinto, «necesita Node», lo que no saldrá aquí y el
//     resultado del censo);
//   · consent(): el diálogo antes de ejecutar código, con los tamaños;
//   · codeBlock(): los mandos de una extensión instalada con código;
//   · classifyResults(): el filtro «Funciona en Code».
// Todo texto que viene de una extensión entra con textContent.
import { tx } from '../ext/i18n.js';
import './strings.js';
import { classify, loadTested, validateSettings, VSCODE } from './classify.js';
import { modal, loadCss } from './ui.js';
import { runtimeInfo } from './vendor.js';
import { uiLang } from '../i18n.js';

// sus estilos (los mandos y las líneas de qué funcionará) viven en ext2.css
if (globalThis.document) loadCss();

// ¿Puede arrancar aquí el código de una extensión (navegador, sitio,
// ?noext2, el interruptor del manifiesto)? Se mira una vez, al cargarse: las
// líneas, el botón y el filtro lo dicen ANTES de que nadie pulse nada.
let aqui = null;
const aquiListo = globalThis.document
  ? runtimeInfo().catch(() => ({ available: false, reason: 'manifest' })).then(r => (aqui = r))
  : Promise.resolve(null);
export const runtimeHere = () => aquiListo;

const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const btn = (txt, cls = 'ghost') => { const b = el('button', cls, txt); b.type = 'button'; return b; };
export const mb = n => (Number(n || 0) / 1e6).toFixed(1).replace('.', uiLang() === 'es' ? ',' : '.') + ' MB';

const WORKBENCH_LABEL = { views: 'views', viewsContainers: 'views', viewsWelcome: 'views', customEditors: 'custom editors', notebooks: 'notebooks',
  notebookRenderer: 'notebooks', walkthroughs: 'walkthroughs', debuggers: 'debugger', breakpoints: 'debugger', terminal: 'terminal', taskDefinitions: 'tasks',
  problemMatchers: 'tasks', authentication: 'sign-in', chatParticipants: 'chat', languageModelTools: 'chat', mcpServerDefinitionProviders: 'MCP servers',
  resourceLabelFormatters: 'file labels', submenus: 'menus', statusBarItems: 'status bar', remoteHelp: 'remote', typescriptServerPlugins: 'TypeScript plugins' };
const unavailableList = c => [...new Set(c.unavailable.map(k => tx('wb_' + (WORKBENCH_LABEL[k] || 'other').replace(/\W+/g, '_'))))].join(', ');

const declList = d => [
  d.themes ? tx('themes', { n: d.themes }) : null, d.grammars ? tx('grammars', { n: d.grammars }) : null,
  d.snippets ? tx('snippetsN', { n: d.snippets }) : null, d.languages ? tx('languages', { n: d.languages }) : null,
].filter(Boolean).join(', ');
const codeList = c => [
  c.counts.commands ? tx('countCommands', { n: c.counts.commands }) : null, c.counts.keybindings ? tx('countKeys', { n: c.counts.keybindings }) : null,
  c.counts.settings ? tx('countSettings', { n: c.counts.settings }) : null,
].filter(Boolean).join(', ');
export function reasonsText(c) {
  return c.reasons.map(r => (r === 'engine' ? tx('reasonEngine', { v: VSCODE }) : r === 'proposals' ? tx('reasonProposals') : r === 'never' ? tx('reasonNever')
    : r === 'deps' ? tx('reasonDeps', { list: c.deps.missing.join(', ') }) : r === 'census' ? tx('reasonCensus') : r)).join(' · ');
}
function censusText(t) {
  if (t.state === 'active') {
    const parts = [tx('testedStarts')];
    if (t.commands) parts.push(tx('countCommands', { n: t.commands }));
    const kinds = Object.keys(t.providers || {});
    if (kinds.some(k => k.startsWith('format'))) parts.push(tx('testedFormatter'));
    const feats = kinds.filter(k => !k.startsWith('format'));
    if (feats.length) parts.push(tx('testedFeatures', { list: feats.slice(0, 6).join(', ') }));
    if (t.diagnostics) parts.push(tx('testedDiagnostics'));
    return parts.join(', ');
  }
  if (t.state === 'install-failed') return tx('testedTooBig', { e: t.error || '' }).trim();
  if (t.state === 'unsupported' || t.unsupported) return tx('testedUnsupported', { e: t.unsupported || t.error || '' }).trim();
  if (t.state === 'installed' || t.state === 'not-activated') return tx('testedNever');
  return tx('testedFails', { e: String(t.error || '').slice(0, 160) }).trim();
}

// Las líneas de «qué funcionará» de una extensión (por su manifiesto). Son
// lo único que se dice de ella: sin un «nada se puede aplicar» del nivel 1 al
// lado de lo que sí corre (o de por qué no).
export function linesFor(c, runtime = aqui) {
  const out = [];
  if (c.hasDeclarative) out.push({ cls: 'ext-applies', t: tx('lineWorksNow', { list: declList(c.declarative) }) });
  if (c.runtime === 'browser') {
    if (!c.eligible) out.push({ cls: 'ext-ignored', t: tx('lineRunsNot', { why: reasonsText(c) }) });
    else if (runtime && !runtime.available) out.push({ cls: 'ext-ignored', t: tx('lineRunsNotHere', { why: tx('x2Unavail_' + runtime.reason) }) });
    else out.push({ cls: 'ext-x2-runs', t: tx(codeList(c) ? 'lineRuns' : 'lineRunsBare', { list: codeList(c) }) });
    if (c.eligible && c.warnings?.includes('proposals')) out.push({ cls: 'ext-ignored', t: tx('lineProposals') });
  } else if (c.runtime === 'node') {
    out.push({ cls: 'ext-ignored', t: tx('lineNode') + (c.hasDeclarative ? ' ' + tx('lineNodeDecl') : '') });
  } else if (!c.hasDeclarative) out.push({ cls: 'ext-nothing', t: tx('nothing') });
  if (c.unavailable.length) out.push({ cls: 'ext-ignored', t: tx('lineUnavailable', { list: unavailableList(c) }) });
  if (c.runtime === 'browser') {
    out.push(c.census ? { cls: c.census.state === 'active' ? 'ext-x2-tested' : 'ext-ignored', t: tx('lineTested', { text: censusText(c.census) }) }
      : { cls: 'ext-x2-untested', t: tx('lineNotTested') });
  }
  return out;
}

// Las reglas del panel: `host` (js/ext/host.js) dice qué lenguajes trae
// Monaco de serie y qué gramáticas no se aplicarían.
async function opciones({ installedIds = new Set(), host = null } = {}) {
  const [tested, rt] = await Promise.all([loadTested(), aquiListo]);
  return {
    tested, installed: installedIds, canRun: !!rt?.available,
    builtinLanguage: host?.builtinLanguage || undefined, grammarSkippedFor: host?.grammarSkippedFor || undefined,
  };
}
export async function describe(manifest, opts = {}) {
  const c = classify(manifest, await opciones(opts));
  return { cls: c, lines: linesFor(c) };
}

// el botón «Instalar y ejecutar su código…»: si sale y si está activo
export function codeButton(c, runtime = aqui) {
  if (!c || c.runtime !== 'browser') return { show: false };
  if (runtime && !runtime.available) return { show: true, disabled: tx('x2Unavail_' + runtime.reason) };
  if (!c.eligible) return { show: true, disabled: reasonsText(c) };
  return { show: true, disabled: null };
}

// Lo que pesa el .vsix, ANTES de bajarlo: una petición HEAD a la misma
// dirección de descarga (la misma que verá Open VSX al instalarla).
export async function downloadSize(meta) {
  const url = meta?.files?.download;
  if (!url) return null;
  try {
    const r = await fetch(url, { method: 'HEAD', credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(30000) });
    const n = Number(r.headers.get('content-length'));
    return r.ok && Number.isSafeInteger(n) && n > 0 ? n : null;
  } catch { return null; }
}

// ── consentimiento ──
// mode 'install' (desde la búsqueda), 'file' (.vsix suelto) o 'run' (ya
// instalada). Devuelve 'code', 'declarative' o null.
export async function consent({ name, publisher, version, license, cls, runtime, extensionBytes = null, downloadBytes = null, mode = 'install' }) {
  const body = [];
  body.push(el('p', 'x2-modal-text', tx('consentWho', { publisher: publisher || '?', v: version || '?', l: license || tx('noLicense') })));
  body.push(el('p', 'x2-modal-text', tx('consentBody')));
  const sizes = el('ul', 'x2-sizes');
  if (runtime && runtime.bytes) sizes.appendChild(el('li', null, tx('consentRuntime', { mb: mb(runtime.bytes) })));
  // el peso del .vsix llega de una petición HEAD: el diálogo no la espera, la
  // línea dice «mirando…» y se completa al llegar (y lo anuncia)
  const extLine = n => (n ? tx('consentExtDownload', { mb: mb(n) }) : extensionBytes ? tx('consentExt', { mb: mb(extensionBytes) }) : tx('consentExtUnknown'));
  const ext = el('li', null, mode === 'run' ? tx('consentExtAlready', { mb: mb(extensionBytes) })
    : typeof downloadBytes?.then === 'function' ? tx('consentExtChecking') : extLine(downloadBytes));
  if (mode !== 'run' && typeof downloadBytes?.then === 'function') {
    ext.setAttribute('aria-live', 'polite');
    downloadBytes.then(n => n, () => null).then(n => { if (ext.isConnected) ext.textContent = extLine(n); });
  }
  sizes.appendChild(ext);
  if (mode === 'file') sizes.appendChild(el('li', null, tx('consentFile')));
  body.push(sizes);
  if (cls && cls.unavailable.length) body.push(el('p', 'x2-note', tx('lineUnavailable', { list: unavailableList(cls) })));
  if (cls && cls.deps.missing.length) body.push(el('p', 'x2-note', tx('reasonDeps', { list: cls.deps.missing.join(', ') })));
  const buttons = [{ label: tx('x2Cancel'), value: null }];
  if (mode !== 'run' && cls && cls.hasDeclarative) buttons.push({ label: tx('consentDecl'), value: 'declarative' });
  buttons.push({ label: mode === 'run' ? tx('consentRunOnly') : tx('consentRun'), value: 'code', primary: true });
  return modal({ id: 'x2-consent', title: tx('consentTitle', { name }), body, buttons, cancelValue: null, focus: 0 });
}

// ── instalar con su código, desde el panel ──
// El consentimiento (qué verá, que no tiene red, cuánto se baja) y, si se
// acepta, la instalación con su código (bajada de Open VSX, con su suma
// SHA-256 publicada obligatoria). `ui` es lo del panel: host() y sus aviso(),
// instala(src, botón, { withCode }), rotula(), inerte() y esInerte().
export function codeInstall(ui) {
  const disponible = async () => {
    const r = await ui.host().codeRuntime();
    if (!r.available) ui.aviso(tx('x2Unavail_' + r.reason), true);
    return r.available ? r : null;
  };
  // «Instalar y ejecutar su código…» en un resultado: solo si trae código para
  // el navegador; inerte (con el motivo) si no puede correr aquí
  function button(acc, it, c, instalada) {
    if (acc.querySelector('.ext-install-code')) return;
    const cb = codeButton(c);
    if (!cb.show || (instalada && instalada.version === it.version && instalada.code)) return;
    const b = btn('', 'ghost ext-install-code');
    ui.rotula(b, tx('btnInstallCode'), tx('btnInstallCodeNamed', { name: it.displayName }));
    if (cb.disabled) { ui.inerte(b, true); b.title = cb.disabled; }
    b.onclick = e => { e.stopPropagation(); if (!ui.esInerte(b)) fromResult(it, c, b); };
    acc.appendChild(b);
    // sin nada declarativo, «Instalar» a secas no haría nada (y si su código
    // tampoco puede correr aquí, se dice por qué)
    const inst = acc.querySelector('.ext-install');
    if (!c.hasDeclarative && inst && !ui.esInerte(inst)) { ui.inerte(inst, true); inst.title = cb.disabled || tx('errCodeonly'); inst.className = 'ghost ext-install'; }
  }
  async function fromResult(it, c, boton) {
    ui.aviso(null);
    const runtime = await disponible();
    if (!runtime) return;
    const meta = await (await import('../ext/openvsx.js')).metadata(it.namespace, it.name, it.version).catch(() => null);
    const v = await consent({ name: it.displayName, publisher: it.namespace, version: it.version, license: meta?.license, cls: c, runtime, extensionBytes: c.census?.bytes || null, downloadBytes: meta?.files?.download ? downloadSize(meta) : null });
    if (v === 'declarative') return ui.instala(it, boton.closest('.ext-actions')?.querySelector('.ext-install') || null);
    if (v === 'code') return ui.instala(it, boton, { withCode: true });
  }
  // una instalada solo con lo declarativo que trae código: se vuelve a bajar con él
  async function installed(rec) {
    const runtime = await disponible();
    if (!runtime) return;
    const meta = await (await import('../ext/openvsx.js')).metadata(rec.publisher, rec.name, rec.version).catch(() => null);
    if ((await consent({ name: rec.displayName, publisher: rec.publisher, version: rec.version, license: rec.license, cls: null, runtime, downloadBytes: meta?.files?.download ? downloadSize(meta) : null })) !== 'code') return;
    return ui.instala({ namespace: rec.publisher, name: rec.name, version: rec.version, displayName: rec.displayName }, null, { withCode: true });
  }
  // un .vsix suelto: su nombre, editor, versión y licencia se leen del propio
  // fichero (es local), y se dice que no hay suma publicada con la que comprobarlo
  async function file(f, { yaInstalada = false } = {}) {
    const r = await ui.host().codeRuntime();
    if (!r.available) { if (!yaInstalada) ui.aviso(tx('errCodeonly') + ' ' + tx('x2Unavail_' + r.reason), true); return; }
    let who = { name: f.name, publisher: '', version: '', license: '' };
    try {
      const { readVsix } = await import('../ext/vsix.js');
      const v = await readVsix(new Uint8Array(await f.arrayBuffer()), { lang: uiLang() });
      who = { name: v.displayName || v.name || f.name, publisher: v.publisher, version: v.version, license: v.license };
    } catch { /* el instalador dirá qué le pasa al fichero */ }
    if ((await consent({ ...who, cls: null, runtime: r, extensionBytes: f.size, mode: 'file' })) !== 'code') { if (!yaInstalada) ui.aviso(tx('cancelled')); return; }
    return ui.instala(f, null, { withCode: true });
  }
  return { button, installed, file };
}

// ── filtro «Funciona en Code»: clasifica una página de resultados ──
// Cada manifiesto se pide una vez (4 a la vez) y se guarda por id@versión.
export async function classifyResults(items, { ovsx, store, installedIds = new Set(), host = null, signal, onEach = () => {} } = {}) {
  const opts = await opciones({ installedIds, host });
  const out = new Map();
  let i = 0;
  const one = async it => {
    const key = `${it.namespace}.${it.name}@${it.version}`.toLowerCase();
    let manifest = null;
    try { manifest = await store.getMeta('manifest:' + key); } catch { /* sin caché */ }
    if (!manifest) {
      try {
        const meta = await ovsx.metadata(it.namespace, it.name, it.version, { signal });
        manifest = await ovsx.manifest(meta, { signal });
        if (manifest && JSON.stringify(manifest).length < 512 * 1024) store.setMeta('manifest:' + key, manifest).catch(() => {});
      } catch (e) {
        if (e?.name === 'AbortError') throw e;
        out.set(key, null);                        // no se pudo comprobar: se enseña sin filtrar
        onEach(it, null);
        return;
      }
    }
    const c = classify(manifest, opts);
    out.set(key, c);
    onEach(it, c, manifest);
  };
  const workers = Array.from({ length: Math.min(4, items.length) }, async () => { while (i < items.length) await one(items[i++]); });
  await Promise.all(workers);
  return out;
}

// ── mandos de una extensión instalada con código ──
const STATE_KEY = { active: 'stateRunning', activating: 'stateStarting', installed: 'stateWaiting', error: 'stateError', stopped: 'stateStopped', unsupported: 'stateUnsupported' };
// por qué un atajo no se ató (keys.js y commands.js dan el código)
const KEY_SKIP = new Set(['reserved', 'invalid', 'platform', 'chords', 'unknown']);
// por qué el recinto no arrancó o se paró (bridge.js, vendor.js, frame.js dan
// el código; su mensaje es técnico y no va en el idioma de la interfaz)
const NO_DISPONIBLE = new Set(['site', 'browser', 'off', 'url', 'manifest']);
const FALLOS = new Set(['network', 'integrity', 'timeout', 'editor', 'violations', 'fatal', 'navigated', 'csp']);
export const isRuntimeError = e => !!e && (NO_DISPONIBLE.has(e.code) || FALLOS.has(e.code) || e.code === 'disabled');
export function runtimeErrorText(e) {
  const code = e?.code === 'disabled' ? 'off' : String(e?.code || '').replace(/^x2-/, '');
  if (NO_DISPONIBLE.has(code)) return tx('x2Unavail_' + code);
  return tx('stateRuntime', { e: tx('x2Err_' + (FALLOS.has(code) ? code : 'other'), { file: e?.file ? ` (${e.file})` : '', code: code || '?' }) });
}
export function codeBlock(rec, { host, onGetCode, onMessage = () => {}, register = () => {} }) {
  const box = el('div', 'ext-x2');
  box.dataset.ext = rec.id;
  const head = el('div', 'ext-x2-head');
  const label = el('span', 'ext-x2-label', tx('codeHead') + ' ');
  const st = el('span', 'ext-x2-state');
  st.setAttribute('role', 'status');
  label.appendChild(st);
  head.appendChild(label);
  const hasCode = !!rec.code;
  // un botón de acción («Apagar el código», «Ejecutar código»): su nombre dice
  // lo que hará, sin aria-pressed (un conmutador no cambia de nombre)
  const toggle = btn(hasCode && rec.runs ? tx('stopCode') : hasCode ? tx('runCode') : tx('getCode'), 'ghost ext-x2-run' + (hasCode && rec.runs ? ' on' : ''));
  toggle.dataset.k = 'x2run';
  toggle.setAttribute('aria-label', tx(hasCode && rec.runs ? 'stopCodeNamed' : 'runCodeNamed', { name: rec.displayName }));
  if (!hasCode && rec.source !== 'open-vsx') { toggle.setAttribute('aria-disabled', 'true'); toggle.title = tx('getCodeFile'); }
  toggle.onclick = async () => {
    if (toggle.getAttribute('aria-disabled') === 'true') return;
    toggle.setAttribute('aria-disabled', 'true');
    try {
      if (!hasCode) { await onGetCode(rec); return; }
      const on = !rec.runs;
      const runtime = on ? await host.codeRuntime() : null;
      if (on && !runtime.available) { onMessage(tx('x2Unavail_' + runtime.reason), true); return; }
      const ok = await host.setRuns(rec.id, on, {
        confirm: async info => (await consent({ name: rec.displayName, publisher: rec.publisher, version: rec.version, license: rec.license, cls: null, runtime: { bytes: info.runtimeBytes }, extensionBytes: info.extensionBytes, mode: 'run' })) === 'code',
      });
      if (ok === false) onMessage(tx('cancelled'));
    } catch (e) { onMessage(isRuntimeError(e) || /^x2-/.test(e?.code || '') ? runtimeErrorText(e) : e, true); }
    finally { toggle.removeAttribute('aria-disabled'); }
  };
  head.appendChild(toggle);
  box.appendChild(head);
  const dyn = el('div', 'ext-x2-dyn');
  box.appendChild(dyn);

  if (hasCode) {
    // ajustes (JSON), validados contra lo que declara la extensión
    const d = el('details', 'ext-x2-settings');
    const s = el('summary', null, tx('settingsH'));
    s.dataset.k = 'x2settings';
    const ta = el('textarea', 'ext-x2-json');
    ta.dataset.k = 'x2json';
    ta.spellcheck = false;
    ta.rows = 4;
    ta.setAttribute('aria-label', tx('settingsFor', { name: rec.displayName }));
    ta.value = JSON.stringify(rec.settings || {}, null, 2);
    const save = btn(tx('settingsSave'));
    save.dataset.k = 'x2save';
    const msg = el('div', 'ext-x2-msg');
    msg.setAttribute('role', 'status');
    save.onclick = async () => {
      const r = validateSettings(rec.code.manifest, ta.value);
      if (!r.ok) {
        msg.setAttribute('role', 'alert');
        msg.textContent = tx('settingsBad', { e: r.errors.slice(0, 3).map(e => tx('set_' + e.code, { k: e.key, t: e.type, list: e.list, e: e.detail })).join(' · ') });
        return;
      }
      try { await host.setSettings(rec.id, r.value); msg.setAttribute('role', 'status'); msg.textContent = tx('settingsSaved'); }
      catch (e) { msg.setAttribute('role', 'alert'); msg.textContent = e?.message || String(e); }
    };
    d.append(s, ta, save, msg);
    box.appendChild(d);
  }

  function update() {
    const s = host.codeState();
    const x = s.extensions.find(e => e.id === rec.id);
    const runtimeOff = s.state === 'error' ? runtimeErrorText(s.error) : null;
    st.textContent = !hasCode ? tx('stateNoCode') : !rec.runs ? tx('stateOff') : runtimeOff || (x ? tx(STATE_KEY[x.state] || 'stateWaiting', { e: x.text || '' }) : tx('stateStarting'));
    dyn.replaceChildren();
    if (!x) return;
    // (las que arrancan con su primer comando están «listas»: el botón las arranca)
    const cmds = s.commands.filter(c => c.ext === rec.id);
    if (cmds.length && ['active', 'activating', 'installed'].includes(x.state)) {
      const ul = el('ul', 'ext-x2-cmds');
      ul.setAttribute('aria-label', tx('commandsH'));
      for (const c of cmds.slice(0, 200)) {
        const li = el('li');
        li.appendChild(el('span', null, c.label));
        const b = btn(tx('runCmd'), 'ghost ext-x2-cmd');
        b.dataset.k = 'cmd:' + c.id;
        b.setAttribute('aria-label', tx('runCmdNamed', { cmd: c.label }));
        b.onclick = async () => {
          const entry = host.codeCommands().find(e => e.id === c.id && e.ext === rec.id);
          if (!entry) return;
          // en el teléfono el panel tapa el editor: se cierra para ver el resultado
          if (window.matchMedia?.('(max-width: 760px)').matches) document.getElementById('settings-panel').hidden = true;
          await entry.run();
        };
        li.appendChild(b);
        ul.appendChild(li);
      }
      dyn.appendChild(ul);
    }
    const langs = (s.formatters || {})[rec.id] || [];
    if (langs.length) {
      const d = el('details', 'ext-x2-fmt');
      d.appendChild(el('summary', null, tx('formatterH', { n: langs.length })));
      for (const lang of langs.slice(0, 60)) {
        const row = el('label', 'ext-x2-fmtrow');
        row.appendChild(el('span', null, tx('formatterFor', { lang })));
        const sel = el('select');
        sel.dataset.k = 'fmt:' + lang;
        for (const [v, t] of [['extension', tx('fmtExt', { name: rec.displayName })], ['builtin', tx('fmtBuiltin')]]) { const o = el('option', null, t); o.value = v; sel.appendChild(o); }
        sel.value = rec.formatter?.[lang] === 'builtin' ? 'builtin' : 'extension';
        sel.onchange = () => host.setFormatter(rec.id, lang, sel.value);
        row.appendChild(sel);
        d.appendChild(row);
      }
      dyn.appendChild(d);
    }
    if (x.skipped?.length) {
      const d = el('details', 'ext-x2-keys');
      d.appendChild(el('summary', null, tx('skippedH', { n: x.skipped.length })));
      const ul = el('ul');
      for (const k of x.skipped.slice(0, 50)) ul.appendChild(el('li', null, `${k.key || '?'} → ${k.command || '?'}: ${k.conflict ? tx('keyConflict', { ext: k.conflict }) : tx('keySkip_' + (KEY_SKIP.has(k.code) ? k.code : 'invalid'))}`));
      d.appendChild(ul);
      dyn.appendChild(d);
    }
    if (x.log?.length) {
      const d = el('details', 'ext-x2-log');
      d.appendChild(el('summary', null, tx('logH', { n: x.log.length })));
      d.appendChild(el('pre', null, x.log.slice(-50).map(l => `[${l.level}] ${l.text}`).join('\n')));
      dyn.appendChild(d);
    }
  }
  update();
  register(host.onCodeChange(() => { if (box.isConnected) update(); }));
  return box;
}

// Una línea para el encabezado de «Instaladas» cuando corre código; si el
// usuario bloqueó las direcciones que piden las extensiones, se dice, con un
// botón para deshacerlo
export function runtimeLine(host, { onUnblock = () => {}, register = () => {} } = {}) {
  const p = el('p', 'ext-x2-runtime muted');
  const update = () => {
    const s = host.codeState();
    p.hidden = s.state !== 'running';
    p.replaceChildren(tx('runtimeRunning') + (s.denials?.n ? ' · ' + tx('denials', { n: s.denials.n }) : ''));
    if (s.state !== 'running' || !s.gate?.blocked) return;
    p.appendChild(el('span', 'ext-x2-blocked', ' · ' + tx('x2Blocked', { n: s.gate.dropped || 0 }) + ' '));
    const b = btn(tx('x2Unblock'), 'ghost ext-x2-unblock');
    b.onclick = async () => { (await import('./bridge.js')).unblockAddresses(); onUnblock(); update(); };
    p.appendChild(b);
  };
  update();
  register(host.onCodeChange(() => { if (p.isConnected && !p.contains(document.activeElement)) update(); }));
  return p;
}
