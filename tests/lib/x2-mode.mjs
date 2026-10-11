// Extension mode for Code's own suites, unchanged:
//
//   BASE=http://127.0.0.1:<port> node --import ./lib/x2-mode.mjs codeedit.mjs
//
// (tests/run-modes.sh runs every suite this way and without it.)
//
// A Node preload that patches Playwright's chromium.launch and
// launchPersistentContext. Before a page of the suite first goes to a Code
// origin (http://127.0.0.1:<port>, the only host that has a sandbox in
// development), that page visits <origin>/manifest.json?x2seed and installs two
// synthetic code extensions there with Code's own store.js, then carries on to
// where the suite was going:
//   noop      one command (so the palette and F1 carry an extension command)
//   observer  hover, completion and symbol providers for every file, always
//             empty, never a formatter (so every feature the suite uses goes
//             through the sandbox and back)
// Both have their code on, so whenever the suite opens the IDE, host.js starts
// the sandbox and they run in it while the suite works.
//
// The seeding runs in that small document of Code's own origin (a JSON file
// that is always there, so no 404 shows up in the console of suites that count
// console errors). Nothing is added to web/, and no request is routed (a
// Playwright route would turn off the HTTP cache for the whole context and make
// this mode differ from the default one in a way users never see).
//
// Checks, printed with ✅/❌ so run-modes.sh counts them, for each browser when
// the suite closes it:
//   · premise: the seed installed both extensions with their code on;
//   · every page that opened the IDE got the sandbox running (before the suite
//     navigates away, reloads or closes it, this waits for that, so the check
//     never passes because nobody looked); pages opened with ?noext or ?noext2,
//     where the user turned code off, must NOT have loaded the bridge at all;
//   · no level 2 errors: the bridge never in "error", no [x2] warnings, no page
//     error from js/ext2/;
//   · nothing requested from the sandbox site but its two documents.
// A failed check makes the suite exit 1 whatever it said itself.
//
// X2_SEEDED (set here) names the two seeded extensions, for the one suite
// that counts installed extensions itself (extensions.mjs).

import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { NOOP, OBSERVER, recordFor } from './x2-fixtures.mjs';

const CODE_ORIGIN = /^http:\/\/127\.0\.0\.1:\d+$/;
const SEED_PATH = '/manifest.json?x2seed';
const SANDBOX_DOCS = new Set(['/x2/v1/sandbox.html', '/x2/v1/exthost-iframe.html']);
const WAIT_RUNNING = 90000;
const SEEDED = [NOOP, OBSERVER].map(f => recordFor(f));
const SEEDED_IDS = SEEDED.map(r => r.rec.id);
// para la suite del nivel 1, que cuenta y desinstala solo las suyas
process.env.X2_SEEDED = SEEDED_IDS.join(',');

let failed = 0;
const say = (good, text) => { console.log((good ? '✅' : '❌') + ' x2-mode: ' + text); if (!good) failed++; };
const note = text => console.log('   x2-mode: ' + text);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// En cada documento de Code (marco principal): avisa cuando el IDE abre
// (el editor de Monaco dentro de #editor) y, en cuanto la página carga
// js/ext2/bridge.js (lo hace host.js), el estado del puente. Importar ese
// mismo módulo da la misma instancia: no carga nada que la página no cargara.
const INIT = `(() => {
  if (window.top !== window || !${CODE_ORIGIN}.test(location.origin) || location.pathname + location.search === ${JSON.stringify(SEED_PATH)}) return;
  const doc = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const tell = d => console.debug('[x2mode]' + JSON.stringify(Object.assign({ doc, at: location.pathname + location.search }, d)));
  tell({ open: true });
  let ide = false, hooked = false;
  const look = () => { if (!ide && document.querySelector('#editor .monaco-editor')) { ide = true; tell({ ide: true }); } };
  new MutationObserver(look).observe(document, { childList: true, subtree: true });
  const hook = () => {
    if (hooked) return;
    hooked = true;
    tell({ bridge: true });
    import('/js/ext2/bridge.js').then(m => {
      let last = '';
      const send = () => {
        const s = m.state();
        const error = s.error ? String(s.error.message || s.error).slice(0, 300) : null;
        const k = s.state + '|' + error + '|' + (s.violations || 0);
        if (k !== last) { last = k; tell({ state: s.state, error, violations: s.violations || 0 }); }
      };
      m.onChange(send);
      send();
      setInterval(send, 400);
    }, e => tell({ hookError: String(e && e.message || e) }));
  };
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.name.includes('/js/ext2/bridge.js')) hook(); })
      .observe({ type: 'resource', buffered: true });
  } catch (e) { tell({ hookError: 'no PerformanceObserver' }); }
})();`;

const browsers = [];                       // { id, contexts: [] }
let anyBrowser = false;

async function track(browserRec, ctx) {
  const st = {
    seeded: new Map(),                     // origin → ids seeded with code on
    docs: new Map(),                       // doc → { page, at, ide, states: [], error }
    current: new WeakMap(),                // page → doc
    sandboxBad: [], sandboxOk: 0,
    x2errors: [],
    ports: new Set(),
  };
  browserRec.contexts.push(st);
  await ctx.addInitScript({ content: INIT });
  ctx.on('console', msg => {
    const text = msg.text();
    if (text.startsWith('[x2mode]')) {
      let d;
      try { d = JSON.parse(text.slice(8)); } catch { return; }
      const page = msg.page();
      let rec = st.docs.get(d.doc);
      if (!rec) { rec = { page, at: d.at, ide: false, ideAt: 0, bridge: false, states: [], error: null, hookError: null }; st.docs.set(d.doc, rec); }
      if (page) st.current.set(page, d.doc);
      if (d.ide) { rec.ide = true; rec.ideAt = Date.now(); }
      if (d.bridge) rec.bridge = true;
      if (d.state) rec.states.push(d.state);
      if (d.error) rec.error = d.error;
      if (d.violations) rec.violations = d.violations;
      if (d.hookError) rec.hookError = d.hookError;
      return;
    }
    if (/\[x2\]/.test(text) && (msg.type() === 'warning' || msg.type() === 'error')) st.x2errors.push(text.slice(0, 300));
  });
  ctx.on('weberror', e => {
    const err = e.error();
    const stack = String(err?.stack || '');
    if (/\/js\/ext2\//.test(stack)) st.x2errors.push('page error: ' + String(err?.message || err).slice(0, 200));
  });
  ctx.on('request', r => {
    let u;
    try { u = new URL(r.url()); } catch { return; }
    if (u.hostname !== 'localhost' || !st.ports.has(u.port)) return;
    if (SANDBOX_DOCS.has(u.pathname)) st.sandboxOk++;
    else st.sandboxBad.push(u.pathname + u.search);
  });
  ctx.on('page', p => wrapPage(p, st));
  for (const p of ctx.pages()) wrapPage(p, st);
  const origNewPage = ctx.newPage.bind(ctx);
  ctx.newPage = async (...a) => { const p = await origNewPage(...a); wrapPage(p, st); return p; };
  const origClose = ctx.close.bind(ctx);
  ctx.close = async (...a) => { await Promise.all(ctx.pages().map(p => settle(p, st))); return origClose(...a); };
  return st;
}

async function seed(page, origin, st, goto) {
  st.seeded.set(origin, []);
  st.ports.add(new URL(origin).port);
  await goto(origin + SEED_PATH, { waitUntil: 'domcontentloaded' });
  const ids = await page.evaluate(async recs => {
    const store = await import('/js/ext/store.js');
    for (const { rec, files } of recs) {
      const m = new Map();
      for (const [p, t] of Object.entries(files)) m.set(store.codeKey(rec.id, rec.version, p), new TextEncoder().encode(t).buffer);
      await store.put(rec, m);
    }
    return (await store.list()).filter(r => r.enabled && r.runs).map(r => r.id);
  }, SEEDED).catch(e => { st.x2errors.push('seed: ' + String(e?.message || e).slice(0, 200)); return []; });
  st.seeded.set(origin, ids);
}

// Antes de que la prueba se vaya de un documento que abrió el IDE: que el
// recinto haya llegado a algo (en marcha o error), o se acaba el tiempo. Si la
// página ni siquiera cargó el puente al poco de abrir el IDE, no se espera más
// (el informe lo dirá: «never started»).
async function settle(page, st) {
  const doc = st.current.get(page);
  const rec = doc && st.docs.get(doc);
  if (!rec || !rec.ide || page.isClosed() || /[?&]noext2?(?:[=&]|$)/.test(rec.at)) return;
  const end = Date.now() + WAIT_RUNNING;
  const done = () => rec.states.some(s => s === 'running' || s === 'error');
  while (Date.now() < end && !page.isClosed() && !done() && (rec.bridge || Date.now() - rec.ideAt < 15000)) await sleep(150);
}

const wrapped = new WeakSet();
function wrapPage(page, st) {
  if (wrapped.has(page)) return;
  wrapped.add(page);
  const goto = page.goto.bind(page);
  page.goto = async (url, opts) => {
    await settle(page, st);
    let origin = null;
    try { origin = new URL(url).origin; } catch { /* about:blank, data: … */ }
    if (origin && CODE_ORIGIN.test(origin) && !st.seeded.has(origin)) await seed(page, origin, st, goto);
    return goto(url, opts);
  };
  const reload = page.reload.bind(page);
  page.reload = async (...a) => { await settle(page, st); return reload(...a); };
  const close = page.close.bind(page);
  page.close = async (...a) => { await settle(page, st); return close(...a); };
}

function report(browserRec) {
  for (const st of browserRec.contexts) {
    for (const [origin, ids] of st.seeded) {
      const missing = SEEDED_IDS.filter(id => !ids.includes(id));
      say(!missing.length, missing.length ? `the seed did not install ${missing.join(', ')} on ${origin}` : `${ids.length} code extensions installed and on (${SEEDED_IDS.join(', ')})`);
    }
    // con ?noext o ?noext2 el usuario apagó el código a propósito: ahí el
    // recinto NO debe arrancar, y eso también se comprueba
    const off = d => /[?&]noext2?(?:[=&]|$)/.test(d.at);
    const switched = [...st.docs.values()].filter(d => d.ide && off(d));
    if (switched.length) {
      const ran = switched.filter(d => d.bridge || d.states.length);
      say(!ran.length, `with ?noext or ?noext2 the sandbox stayed off (${switched.length} pages)` + (ran.length ? ' — it ran in: ' + ran.map(d => d.at).join(', ') : ''));
    }
    const ide = [...st.docs.values()].filter(d => d.ide && !off(d));
    if (!st.seeded.size && !ide.length) { note('this context never opened Code'); continue; }
    if (!ide.length) { note('no page opened the IDE in this context'); }
    else {
      const notRunning = ide.filter(d => !d.states.includes('running'));
      say(!notRunning.length, `the sandbox was running in every page that opened the IDE (${ide.length - notRunning.length} of ${ide.length})`
        + (notRunning.length ? ' — not in: ' + notRunning.map(d => `${d.at} [${d.states.join('>') || 'never started'}${d.error ? ': ' + d.error : ''}${d.hookError ? '; ' + d.hookError : ''}]`).slice(0, 4).join(', ') : ''));
    }
    const broken = [...st.docs.values()].filter(d => d.states.includes('error') || d.violations);
    const errs = [...st.x2errors, ...broken.map(d => `${d.at}: bridge ${d.states.join('>')}${d.error ? ' (' + d.error + ')' : ''}${d.violations ? ', ' + d.violations + ' violations' : ''}`)];
    say(!errs.length, 'no level 2 errors' + (errs.length ? ' — ' + errs.slice(0, 4).join(' | ') : ''));
    say(!st.sandboxBad.length, `from the sandbox site, only its two documents (${st.sandboxOk} requests)` + (st.sandboxBad.length ? ' — also: ' + st.sandboxBad.slice(0, 4).join(' ') : ''));
  }
}

function wrapBrowser(browser) {
  anyBrowser = true;
  const rec = { contexts: [], reported: false };
  browsers.push(rec);
  const origNewContext = browser.newContext.bind(browser);
  browser.newContext = async (...a) => { const ctx = await origNewContext(...a); await track(rec, ctx); return ctx; };
  const origClose = browser.close.bind(browser);
  browser.close = async (...a) => {
    if (!rec.reported) {
      await Promise.all(browser.contexts().flatMap(c => c.pages()).map(p => {
        const st = rec.contexts.find(s => s.current.has(p));
        return st ? settle(p, st) : null;
      }));
      rec.reported = true;
      report(rec);
    }
    return origClose(...a);
  };
  return browser;
}

// El `chromium` de `import 'playwright'` y el de require('playwright') (las
// baterías lo cargan así) son objetos distintos: se parchean los dos.
function patch(bt) {
  if (!bt || bt.__x2mode) return;
  bt.__x2mode = true;
  const origLaunch = bt.launch.bind(bt);
  bt.launch = async (...a) => wrapBrowser(await origLaunch(...a));
  const origPersistent = bt.launchPersistentContext.bind(bt);
  bt.launchPersistentContext = async (...a) => {
    const ctx = await origPersistent(...a);
    anyBrowser = true;
    const rec = { contexts: [], reported: false };
    browsers.push(rec);
    const st = await track(rec, ctx);
    const origClose = ctx.close;                  // ya envuelto por track (settle)
    ctx.close = async (...b) => { if (!rec.reported) { await Promise.all(ctx.pages().map(p => settle(p, st))); rec.reported = true; report(rec); } return origClose(...b); };
    return ctx;
  };
}
patch(chromium);
patch(createRequire(import.meta.url)('playwright').chromium);

// Si la prueba sale sin cerrar el navegador: lo que se sepa, sin esperar.
const origExit = process.exit.bind(process);
let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  for (const rec of browsers) if (!rec.reported) { rec.reported = true; report(rec); }
  if (!anyBrowser) note('no browser in this suite');
}
process.exit = code => { finish(); return origExit(failed ? 1 : code); };
process.on('exit', code => { finish(); if (failed && !code) process.exitCode = 1; });
