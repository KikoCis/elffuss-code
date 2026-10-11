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
import { uiLang } from '../i18n.js';

// sus estilos (los mandos y las líneas de qué funcionará) viven en ext2.css
if (globalThis.document) loadCss();

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

// Las líneas de «qué funcionará» de una extensión (por su manifiesto)
export function linesFor(c) {
  const out = [];
  if (c.hasDeclarative) out.push({ cls: 'ext-applies', t: tx('lineWorksNow', { list: declList(c.declarative) }) });
  if (c.runtime === 'browser') {
    if (c.eligible) out.push({ cls: 'ext-x2-runs', t: tx(codeList(c) ? 'lineRuns' : 'lineRunsBare', { list: codeList(c) }) });
    else out.push({ cls: 'ext-ignored', t: tx('lineRunsNot', { why: reasonsText(c) }) });
  } else if (c.runtime === 'node') {
    out.push({ cls: 'ext-ignored', t: tx('lineNode') + (c.hasDeclarative ? ' ' + tx('lineNodeDecl') : '') });
  }
  if (c.unavailable.length) out.push({ cls: 'ext-ignored', t: tx('lineUnavailable', { list: unavailableList(c) }) });
  if (c.runtime === 'browser') {
    out.push(c.census ? { cls: c.census.state === 'active' ? 'ext-x2-tested' : 'ext-ignored', t: tx('lineTested', { text: censusText(c.census) }) }
      : { cls: 'ext-x2-untested', t: tx('lineNotTested') });
  }
  return out;
}

export async function describe(manifest, { installedIds = new Set() } = {}) {
  const c = classify(manifest, { tested: await loadTested(), installed: installedIds });
  return { cls: c, lines: linesFor(c) };
}

// el botón «Instalar y ejecutar su código…»: si sale y si está activo
export function codeButton(c, runtime) {
  if (!c || c.runtime !== 'browser') return { show: false };
  if (runtime && !runtime.available) return { show: true, disabled: tx('x2Unavail_' + runtime.reason) };
  if (!c.eligible) return { show: true, disabled: reasonsText(c) };
  return { show: true, disabled: null };
}

// ── consentimiento ──
// mode 'install' (desde la búsqueda), 'file' (.vsix suelto) o 'run' (ya
// instalada). Devuelve 'code', 'declarative' o null.
export async function consent({ name, publisher, version, license, cls, runtime, extensionBytes = null, mode = 'install' }) {
  const body = [];
  body.push(el('p', 'x2-modal-text', tx('consentWho', { publisher: publisher || '?', v: version || '?', l: license || tx('noLicense') })));
  body.push(el('p', 'x2-modal-text', tx('consentBody')));
  const sizes = el('ul', 'x2-sizes');
  if (runtime && runtime.bytes) sizes.appendChild(el('li', null, tx('consentRuntime', { mb: mb(runtime.bytes) })));
  sizes.appendChild(el('li', null, mode === 'run' ? tx('consentExtAlready', { mb: mb(extensionBytes) })
    : extensionBytes ? tx('consentExt', { mb: mb(extensionBytes) }) : tx('consentExtUnknown')));
  if (mode === 'file') sizes.appendChild(el('li', null, tx('consentFile')));
  body.push(sizes);
  if (cls && cls.unavailable.length) body.push(el('p', 'x2-note', tx('lineUnavailable', { list: unavailableList(cls) })));
  if (cls && cls.deps.missing.length) body.push(el('p', 'x2-note', tx('reasonDeps', { list: cls.deps.missing.join(', ') })));
  const buttons = [{ label: tx('x2Cancel'), value: null }];
  if (mode !== 'run' && cls && cls.hasDeclarative) buttons.push({ label: tx('consentDecl'), value: 'declarative' });
  buttons.push({ label: mode === 'run' ? tx('consentRunOnly') : tx('consentRun'), value: 'code', primary: true });
  return modal({ id: 'x2-consent', title: tx('consentTitle', { name }), body, buttons, cancelValue: null, focus: 0 });
}

// ── filtro «Funciona en Code»: clasifica una página de resultados ──
// Cada manifiesto se pide una vez (4 a la vez) y se guarda por id@versión.
export async function classifyResults(items, { ovsx, store, installedIds = new Set(), signal, onEach = () => {} } = {}) {
  const tested = await loadTested();
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
    const c = classify(manifest, { tested, installed: installedIds });
    out.set(key, c);
    onEach(it, c, manifest);
  };
  const workers = Array.from({ length: Math.min(4, items.length) }, async () => { while (i < items.length) await one(items[i++]); });
  await Promise.all(workers);
  return out;
}

// ── mandos de una extensión instalada con código ──
const STATE_KEY = { active: 'stateRunning', activating: 'stateStarting', installed: 'stateWaiting', error: 'stateError', stopped: 'stateStopped', unsupported: 'stateUnsupported' };
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
  const toggle = btn(hasCode && rec.runs ? tx('stopCode') : hasCode ? tx('runCode') : tx('getCode'), 'ghost ext-x2-run');
  toggle.dataset.k = 'x2run';
  toggle.setAttribute('aria-pressed', String(!!(hasCode && rec.runs)));
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
    } catch (e) { onMessage(e?.message || String(e), true); }
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
    const runtimeOff = s.state === 'error' ? tx('stateRuntime', { e: s.error?.message || '' }) : null;
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
      for (const k of x.skipped.slice(0, 50)) ul.appendChild(el('li', null, `${k.key || '?'} → ${k.command || '?'}: ${k.conflict ? tx('keyConflict', { ext: k.conflict }) : k.why}`));
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

// Una línea para el encabezado de «Instaladas» cuando corre código
export function runtimeLine(host) {
  const s = host.codeState();
  if (s.state !== 'running') return null;
  const p = el('p', 'ext-x2-runtime muted');
  p.textContent = tx('runtimeRunning') + (s.denials?.n ? ' · ' + tx('denials', { n: s.denials.n }) : '');
  return p;
}
