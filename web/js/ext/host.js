// Host de extensiones de VS Code — nivel 1: solo contribuciones declarativas
// (temas de color, gramáticas TextMate, snippets y configuración de lenguajes).
// NINGÚN JavaScript de una extensión se ejecuta aquí.
//
// El código de las extensiones (nivel 2) lo lleva ../ext2/host2.js, que solo
// se importa con alguna con su código encendido o al pedir algo de eso.
//
// ide.js lo carga solo si hay alguna extensión activa (o un tema elegido) y el
// panel lo carga al abrirse: sin extensiones, el arranque de Code no cambia.
// Cada cambio (instalar, activar, desactivar, desinstalar) deshace lo aplicado
// y lo vuelve a aplicar desde cero, de uno en uno: más simple y sin restos.
// Las gramáticas solo se rehacen si su lista cambia.
import * as store from './store.js';
import * as maindb from '../db.js';
import { BASES, builtinTheme, toMonacoTheme, toTextMateTheme, chromeCss, themeIdFor } from './themes.js';
import { registerSnippets } from './snippets.js';
import { toLanguageConfiguration, matchLanguage, firstLineCandidates } from './languages.js';
import { Grammars, canOverride } from './grammars.js';
import { uiLang } from '../i18n.js';

export const THEME_PREF = 'elffusscode.theme';
let instancia = null;

// ── primera línea (firstLine) en un Worker con tiempo tope ──
// Una expresión de un paquete puede no terminar nunca con según qué línea; en
// el hilo de la página congelaría la pestaña al abrir un fichero. El Worker
// avisa antes de probar cada expresión: si una se pasa de tiempo, se corta el
// Worker, esa expresión queda fuera hasta recargar y se repite con las demás.
const TOPE_EXPRESION_MS = 250;
const TOPE_ARRANQUE_MS = 8000;             // el Worker ni contestó (no cargó)
const lentas = new Set();
const peticiones = new Map();
let trabajador = null, nPeticion = 0;

function sueltaTrabajador() {
  trabajador?.terminate();
  trabajador = null;
  const resto = [...peticiones.values()];
  peticiones.clear();
  for (const p of resto) clearTimeout(p.timer);
  return resto;
}
function alRecibir({ data }) {
  const p = peticiones.get(data.id);
  if (!p) return;
  clearTimeout(p.timer);
  if ('trying' in data) {
    p.timer = setTimeout(() => {
      const mala = p.candidatos[data.trying];
      lentas.add(mala.src);
      console.warn(`[elffuss-ext] la firstLine de «${mala.id}» no termina a tiempo: no se usa en esta sesión`);
      for (const q of sueltaTrabajador()) firstLineEnWorker(q.candidatos, q.linea).then(q.resolve);
    }, TOPE_EXPRESION_MS);
    return;
  }
  peticiones.delete(data.id);
  p.resolve(data.lang ?? null);
}
function firstLineEnWorker(candidatos, linea) {
  candidatos = candidatos.filter(c => !lentas.has(c.src));
  if (!candidatos.length || !linea) return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      if (!trabajador) {
        trabajador = new Worker(new URL('./firstline-worker.js', import.meta.url), { type: 'module' });
        trabajador.onmessage = alRecibir;
        trabajador.onerror = () => { for (const q of sueltaTrabajador()) q.resolve(null); };
      }
      const id = ++nPeticion;
      const p = { resolve, candidatos, linea, timer: null };
      p.timer = setTimeout(() => { if (peticiones.get(id) === p) { peticiones.delete(id); resolve(null); } }, TOPE_ARRANQUE_MS);
      peticiones.set(id, p);
      trabajador.postMessage({ id, candidates: candidatos, line: linea });
    } catch { resolve(null); }               // sin Workers: sin detección por primera línea
  });
}

export function init(monaco, opts = {}) {
  instancia ??= crear(monaco, opts).catch(e => { instancia = null; throw e; });
  return instancia;
}

async function crear(monaco, { onLanguagesChanged = () => {} } = {}) {
  const paused = /[?&]noext\b/.test(location.search);
  const sinCodigo = /[?&]noext2(?:[=&]|$)/.test(location.search);
  const builtin = new Set(monaco.languages.getLanguages().map(l => l.id));
  const registrados = new Set();      // lenguajes que registramos (Monaco no permite quitarlos)
  const listeners = new Set();
  let exts = [];
  let aplicado = [];                  // disposables de lo aplicado
  let langContribs = [];
  let themeIndex = new Map();         // id de tema → { key, label, uiTheme, ext, extName }
  let pref = leePref();
  let actual = 'vs-dark', monacoId = 'vs-dark', uiTheme = 'vs-dark';
  let n2 = null, dos = null;          // ../ext2/host2.js: su carga, y ya cargado
  let estilo = null;
  let firmaGramaticas = '[]';
  let cola = Promise.resolve();       // los cambios se aplican de uno en uno

  const grammars = new Grammars(monaco, {
    loadFile: store.getFile,
    builtin,
    // la primera gramática enciende el motor: el tema se redefine con el mapa
    // de colores de TextMate antes de pintar ningún token
    onActivate: () => aplicaTema(actual),
  });

  function leePref() { try { return localStorage.getItem(THEME_PREF) || 'vs-dark'; } catch { return 'vs-dark'; } }
  function guardaPref(id) {
    pref = id;
    try { if (id === 'vs-dark') localStorage.removeItem(THEME_PREF); else localStorage.setItem(THEME_PREF, id); } catch { /* sin almacenamiento */ }
  }

  function pintaCromo(tema, id) {
    if (!estilo) { estilo = document.createElement('style'); estilo.id = 'ext-theme-chrome'; document.head.appendChild(estilo); }
    estilo.textContent = id === 'vs-dark' ? '' : chromeCss(tema);
  }

  let turnoTema = 0;
  async function aplicaTema(id, { guardar = false } = {}) {
    const turno = ++turnoTema;
    let elegido = id, tema = null;
    if (themeIndex.has(id)) {
      tema = await store.getFile(themeIndex.get(id).key).catch(() => null);
      if (!tema) elegido = 'vs-dark';
    } else if (!BASES.includes(id)) elegido = 'vs-dark';
    // flechas rápidas en el selector: solo cuenta la última petición
    if (turno !== turnoTema) return actual;
    tema ??= builtinTheme(elegido);
    const encoded = grammars.setTheme(toTextMateTheme(tema));
    let mid = elegido;
    if (!tema.builtin) monaco.editor.defineTheme(elegido, toMonacoTheme(tema, encoded));
    else if (encoded) {
      mid = 'elffuss-tm-' + elegido;
      monaco.editor.defineTheme(mid, { base: elegido, inherit: true, rules: [], colors: {}, encodedTokensColors: encoded });
    }
    monaco.editor.setTheme(mid);
    actual = elegido;
    monacoId = mid;
    pintaCromo(tema, elegido);
    uiTheme = tema.uiTheme;
    dos?.setTheme(uiTheme);
    if (guardar) guardaPref(elegido);
    return elegido;
  }

  async function reaplica() {
    for (const d of aplicado) { try { d.dispose(); } catch { /* ya fuera */ } }
    aplicado = [];
    const activas = paused ? [] : exts.filter(e => e.enabled);

    langContribs = [];
    for (const e of activas) {
      for (const l of e.languages || []) {
        langContribs.push(l);
        if (builtin.has(l.id)) continue;      // los de serie conservan su configuración
        if (!registrados.has(l.id)) {
          // sin firstLine: Monaco la ejecutaría en la página; la detección por
          // primera línea es nuestra y va en un Worker (languageForFirstLine)
          monaco.languages.register({ id: l.id, extensions: l.extensions, filenames: l.filenames, filenamePatterns: l.filenamePatterns, aliases: l.aliases, mimetypes: l.mimetypes });
          registrados.add(l.id);
        }
        if (l.configKey) {
          const conf = await store.getFile(l.configKey).catch(() => null);
          if (conf) aplicado.push(monaco.languages.setLanguageConfiguration(l.id, toLanguageConfiguration(conf, monaco)));
        }
      }
    }

    const porLang = new Map();
    for (const e of activas) {
      for (const s of e.snippets || []) {
        if (!porLang.has(s.language)) porLang.set(s.language, []);
        porLang.get(s.language).push({ key: s.key, ext: e.displayName });
      }
    }
    for (const [lang, fuentes] of porLang) {
      const cargar = async () => (await Promise.all(fuentes.map(async f => ((await store.getFile(f.key)) || []).map(s => ({ ...s, ext: f.ext }))))).flat();
      aplicado.push(registerSnippets(monaco, lang, cargar, s => s.ext));
    }

    // las gramáticas solo se rehacen si cambian: un tema nuevo no obliga a
    // recompilarlas ni a repintar los ficheros con gramática
    const gramaticas = activas.flatMap(e => (e.grammars || []).map(g => ({ ...g, ext: e.id })));
    const firma = JSON.stringify(gramaticas.map(g => [g.key, g.language, g.scopeName]));
    if (firma !== firmaGramaticas) { firmaGramaticas = firma; grammars.configure(gramaticas); }

    themeIndex = new Map();
    for (const e of activas) for (const t of e.themes || []) themeIndex.set(t.themeId, { ...t, ext: e.id, extName: e.displayName });
    await aplicaTema(pref);
  }

  const emit = () => {
    for (const f of listeners) { try { f(); } catch { /* un oyente roto no para al resto */ } }
    try { onLanguagesChanged(); } catch { /* — */ }
  };

  // ── nivel 2 ──
  const oyentesCodigo = new Set();     // el panel: estado del recinto
  const nivelDos = () => (n2 ??= import('../ext2/host2.js').then(m => (dos = m.attach({
    monaco, exts: () => exts, recarga, emit, paused, sinCodigo, listeners: oyentesCodigo, uiTheme: () => uiTheme,
  }))));
  const deDos = f => (...a) => nivelDos().then(d => d[f](...a));
  function sincronizaCodigo() {
    if (n2 || (!paused && !sinCodigo && exts.some(e => e.enabled && e.runs))) deDos('sync')().catch(e => console.warn('[elffuss-ext] nivel 2:', e?.message || e));
  }
  // Con alguna extensión con código instalada, la vista previa HTML de un
  // fichero en el que entró texto suyo (kv «x2.touched») pregunta antes.
  async function guardaVistaPrevia() {
    (await import('../ide.js')).setBeforePreview(exts.some(e => e.code) ? async path => {
      const marcas = await maindb.get('kv', 'x2.touched').catch(() => null);
      return !marcas?.[path] || (await import('../ext2/gates.js')).allowPreview(path);
    } : null);
  }

  function recarga() {
    const r = cola.then(async () => { exts = await store.list(); await reaplica(); sincronizaCodigo(); await guardaVistaPrevia(); });
    cola = r.catch(() => {});
    return r.then(emit);
  }

  // ── arranque ──
  try { await store.reconcile(); } catch (e) { console.warn('[elffuss-ext] no pude ordenar las extensiones guardadas:', e?.message || e); }
  exts = await store.list().catch(() => []);
  await reaplica();
  sincronizaCodigo();
  guardaVistaPrevia().catch(() => {});

  const quitaTemasDe = id => { if (themeIndex.get(pref)?.ext === id) guardaPref('vs-dark'); };

  // Instalar: lo declarativo y, con `withCode` (aceptado por el usuario), su
  // código vía host2.js, con la suma SHA-256 publicada obligatoria.
  async function install(src, { onProgress, confirmLarge, signal, withCode = false } = {}) {
    let bytes, sha256, verified = false, source = 'file', meta = null;
    const ovsx = await import('./openvsx.js');
    if (src instanceof Blob) {
      bytes = new Uint8Array(await src.arrayBuffer());
      sha256 = await ovsx.sha256Hex(bytes);
    } else {
      meta = await ovsx.metadata(src.namespace, src.name, src.version || '', { signal });
      ({ bytes, sha256, verified } = await ovsx.download(meta, { onProgress, confirmLarge, signal, requireHash: withCode }));
      source = 'open-vsx';
    }
    const { readVsix } = await import('./vsix.js');
    const v = await readVsix(bytes, { lang: uiLang() });
    if (meta && v.id !== `${meta.namespace}.${meta.name}`.toLowerCase()) {
      throw Object.assign(new Error(`el paquete dice ser ${v.id}, no ${meta.namespace}.${meta.name}`), { code: 'mismatch', got: v.id, want: `${meta.namespace}.${meta.name}` });
    }
    const previo = exts.find(e => e.id === v.id);
    const codigo = withCode ? await deDos('codeFiles')(v, bytes, previo) : null;
    // lo que el usuario VERÍA: temas, snippets, resaltado de un lenguaje o los
    // ajustes de uno nuevo. Un lenguaje que solo asocia extensiones de fichero
    // no cambia nada en pantalla; si además el valor de la extensión es su
    // código y NO se instala con él (nivel 2), instalarla sería inútil y se dice
    // en vez de fingir que funciona.
    const seVe = v.themes.length || v.snippets.length
      || v.grammars.some(g => g.language && !(builtin.has(g.language) && !canOverride(monaco, g.language)))
      || v.languages.some(l => l.config && !builtin.has(l.id));
    if (!withCode && !seVe && v.analysis.hasCode) throw Object.assign(new Error('codeonly'), { code: 'codeonly', analysis: v.analysis, displayName: v.displayName });
    if (!withCode && !v.themes.length && !v.grammars.length && !v.snippets.length && !v.languages.length) {
      // declaraba cosas aplicables pero ninguna se pudo leer: no es lo mismo
      // que no traer nada, y el usuario tiene que saber por qué
      if (v.warnings.length) throw Object.assign(new Error('unreadable'), { code: 'unreadable', warning: v.warnings[0], warnings: v.warnings });
      // solo trae código para el navegador: eso se instala desde «… y ejecutar su código»
      if (typeof v.manifest.browser === 'string') throw Object.assign(new Error('code-only'), { code: 'codeonly' });
      throw Object.assign(new Error('nothing-applies'), { code: 'nothing' });
    }
    const usados = new Set(exts.filter(e => e.id !== v.id).flatMap(e => (e.themes || []).map(t => t.themeId)));
    const files = new Map();
    const k = p => store.fileKey(v.id, v.version, p);
    const rec = {
      id: v.id, publisher: v.publisher, name: v.name, version: v.version,
      displayName: v.displayName, description: v.description.slice(0, 500),
      license: (meta?.license || v.license || '').slice(0, 200), sha256, verified, source, size: bytes.length,
      installedAt: previo?.installedAt || Date.now(), enabled: previo ? previo.enabled : true,
      hasCode: v.analysis.hasCode, browser: typeof v.manifest.browser === 'string', ignored: v.analysis.ignored, pack: v.analysis.pack, warnings: v.warnings.slice(0, 20),
      categories: v.analysis.categories, sizes: v.analysis.sizes, webviews: v.analysis.webviews, browserEntry: v.analysis.browserEntry,
      themes: v.themes.map(t => { const key = k('theme/' + t.index); files.set(key, t.data); return { key, label: t.label, uiTheme: t.uiTheme, themeId: themeIdFor(v.id, t, t.index, usados) }; }),
      grammars: v.grammars.map(g => {
        const key = k(g.path); files.set(key, g.data);
        return { key, scopeName: g.scopeName, language: g.language, embeddedLanguages: g.embeddedLanguages, tokenTypes: g.tokenTypes, injectTo: g.injectTo, balancedBracketScopes: g.balancedBracketScopes, unbalancedBracketScopes: g.unbalancedBracketScopes };
      }),
      snippets: v.snippets.map(s => { const key = k(s.path); files.set(key, s.data); return { key, language: s.language, count: s.data.length }; }),
      languages: v.languages.map(l => {
        let configKey = null;
        if (l.config) { configKey = k(l.configPath); files.set(configKey, l.config); }
        return { id: l.id, aliases: l.aliases, extensions: l.extensions, filenames: l.filenames, filenamePatterns: l.filenamePatterns, firstLine: l.firstLine, mimetypes: l.mimetypes, configKey };
      }),
      licenseKey: null,
    };
    if (v.licenseText) { rec.licenseKey = k('LICENSE'); files.set(rec.licenseKey, v.licenseText); }
    if (codigo) { for (const [key, d] of codigo.files) files.set(key, d); Object.assign(rec, codigo.fields); }
    await store.put(rec, files);
    await recarga();
    return rec;
  }

  async function setEnabled(id, on) {
    if (!on) quitaTemasDe(id);
    await store.setEnabled(id, on);
    await recarga();
  }
  async function uninstall(id) {
    quitaTemasDe(id);
    await store.remove(id);
    await recarga();
  }

  const nombresSerie = { 'vs-dark': 'builtinDark', vs: 'builtinLight', 'hc-black': 'builtinHc', 'hc-light': 'builtinHcLight' };
  return {
    paused,
    list: () => exts.map(e => ({ ...e })),
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    install, setEnabled, uninstall,
    // nivel 2 (host2.js)
    setRuns: deDos('setRuns'), setSettings: deDos('setSettings'), setFormatter: deDos('setFormatter'), codeRuntime: deDos('runtime'),
    codeState: () => (dos ? dos.state() : { state: 'stopped', extensions: [], commands: [] }),
    codeCommands: () => (dos ? dos.commands() : []),
    onCodeChange(fn) { oyentesCodigo.add(fn); return () => oyentesCodigo.delete(fn); },
    noCode: paused || sinCodigo,
    licenseText: async id => { const e = exts.find(x => x.id === id); return e?.licenseKey ? (await store.getFile(e.licenseKey)) || '' : ''; },
    themes: () => [
      ...BASES.map(id => ({ id, builtin: true, labelKey: nombresSerie[id], uiTheme: id })),
      ...[...themeIndex].map(([id, t]) => ({ id, label: t.label, uiTheme: t.uiTheme, ext: t.ext, extName: t.extName })),
    ],
    currentTheme: () => actual,
    themeId: () => monacoId,
    setTheme: id => aplicaTema(id, { guardar: true }),
    previewTheme: id => aplicaTema(id),
    languageForPath: path => (paused ? null : matchLanguage(langContribs, path)),
    // solo para ficheros que nadie reclama por su nombre (ide.js)
    languageForFirstLine: line => (paused ? Promise.resolve(null) : firstLineEnWorker(firstLineCandidates(langContribs), line)),
    prepareLanguage: async lang => (paused || !grammars.hasGrammarFor(lang) ? false : grammars.prepare(lang)),
    skippedGrammars: () => grammars.skipped.map(g => ({ ext: g.ext, language: g.language, scopeName: g.scopeName })),
    // lo que no se aplicaría aunque la extensión esté activa: la gramática de
    // un lenguaje de serie sin Monarch (JSON) y la configuración de un lenguaje
    // de serie (Monaco conserva la suya)
    grammarSkippedFor: lang => typeof lang === 'string' && builtin.has(lang) && !canOverride(monaco, lang),
    builtinLanguage: id => builtin.has(id),
    // para decir en llano lo que hace cada extensión (panel.js)
    languageName(id) {
      for (let i = langContribs.length - 1; i >= 0; i--) if (langContribs[i].id === id && langContribs[i].aliases?.[0]) return langContribs[i].aliases[0];
      return monaco.languages.getLanguages().find(l => l.id === id)?.aliases?.[0] || null;
    },
    languageExtensions(id) {
      const out = new Set();
      for (const l of langContribs) if (l.id === id) for (const x of l.extensions || []) out.add(x);
      for (const x of monaco.languages.getLanguages().find(l => l.id === id)?.extensions || []) out.add(x);
      return [...out];
    },
    async snippetPrefixes(id, n = 3) {
      const e = exts.find(x => x.id === id);
      const out = [];
      for (const s of e?.snippets || []) {
        for (const x of (await store.getFile(s.key).catch(() => null)) || []) {
          if (x?.prefix && !out.includes(x.prefix)) out.push(x.prefix);
          if (out.length >= n) return out;
        }
      }
      return out;
    },
    async languageConfig(id, lang) {
      const l = exts.find(x => x.id === id)?.languages?.find(x => x.id === lang);
      return l?.configKey ? store.getFile(l.configKey).catch(() => null) : null;
    },
  };
}
