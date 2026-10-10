// Gramáticas TextMate de las extensiones, con el mismo motor que VS Code:
// vscode-textmate + Oniguruma (WebAssembly). El motor va en el repositorio
// (vendor/, el release/main.js de cada paquete sin cambios) y el WebAssembly se
// baja del CDN con comprobación de integridad. Todo SOLO cuando un fichero
// necesita la primera gramática; sin extensiones de lenguaje no se carga nada.
//
// Los tokens van a Monaco en binario (tokenizeEncoded), igual que en VS Code:
// cada token lleva el índice de su color en el mapa de colores de TextMate, y
// el tema de Monaco se define con ese mismo mapa delante (encodedTokensColors),
// así los dos mapas coinciden índice a índice. Resultado: los colores exactos
// del tema (incluidos los selectores con contexto), cursivas/negritas, y el
// tipo de token (comentario/cadena) que Monaco usa para el autocierre.
import { NOMBRES_PROTO } from './formats.js';

const TM_URL = './vendor/vscode-textmate@9.3.2/main.js';
const ONIG_URL = './vendor/vscode-oniguruma@2.0.1/main.js';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/vscode-oniguruma@2.0.1/release/onig.wasm';
const WASM_SRI = 'sha384-bmaXom6bK+vfssb0IcRH2lE1asksQiEsK/WnxAcnHDB3Cx8v3KxZ7BthuGq1DU8v';
const LIMITE_MS = 500;              // por línea, como VS Code: una gramática mala no congela la pestaña
const TIPOS = { other: 0, comment: 1, string: 2, regex: 3 };

// ── gramáticas seguras para el motor ─────────────────────────────────────────
// vscode-textmate busca las reglas en objetos normales: `repository[nombre]` y,
// para otra gramática, `_includedGrammars[ámbito]`. Con un nombre como
// «__proto__» o «constructor» la búsqueda acaba en Object.prototype (o en
// Object) y el motor le escribe `.id`: toda la página queda contaminada y las
// gramáticas que se compilan después dejan de pintar. Así que, al instalar y
// al cargar de la base:
//   · las claves de repository con nombre de Object.prototype se renombran, y
//     los include que las citan también: lo legítimo sigue funcionando y una
//     búsqueda ya no puede salir del propio objeto;
//   · fuera los include a una gramática con ese nombre (los ámbitos de verdad
//     llevan punto: source.x);
//   · fuera toda clave «__proto__» (al clonar, el motor la convertiría en el
//     prototipo del objeto) y el `id` de las reglas (es la marca que pone el
//     motor al compilar).
const RENOMBRE = '$elffuss-safe:';
const nombreSeguro = k => (NOMBRES_PROTO.has(k) ? RENOMBRE + k : k);
const CAPTURAS = new Set(['captures', 'beginCaptures', 'endCaptures', 'whileCaptures']);

function includeSeguro(inc) {
  if (inc === '$self' || inc === '$base') return inc;
  const i = inc.indexOf('#');
  const ambito = i < 0 ? inc : inc.slice(0, i);
  if (i !== 0 && NOMBRES_PROTO.has(ambito)) return null;
  return i < 0 ? inc : ambito + '#' + nombreSeguro(inc.slice(i + 1));
}
// Copia sin claves «__proto__» (datos que no son reglas: fileTypes, comment…).
function copiaPlana(v) {
  if (Array.isArray(v)) return v.map(copiaPlana);
  if (!v || typeof v !== 'object') return v;
  const o = {};
  for (const [k, x] of Object.entries(v)) if (k !== '__proto__') o[k] = copiaPlana(x);
  return o;
}
function mapaDeReglas(m, renombrar) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return undefined;
  const o = {};
  for (const [k, r] of Object.entries(m)) {
    if (k === '__proto__' && !renombrar) continue;
    const limpia = regla(r);
    if (limpia) o[renombrar ? nombreSeguro(k) : k] = limpia;
  }
  return o;
}
function regla(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const o = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === '__proto__' || k === 'id') continue;
    if (k === 'include') {
      if (typeof v !== 'string') return null;
      const inc = includeSeguro(v);
      if (inc == null) return null;            // la regla entera fuera, como un include que no existe
      o.include = inc;
    } else if (k === 'patterns') o.patterns = Array.isArray(v) ? v.map(regla).filter(Boolean) : undefined;
    else if (k === 'repository') o.repository = mapaDeReglas(v, true);
    else if (CAPTURAS.has(k)) o[k] = mapaDeReglas(v, false);
    else if (k === 'injections') o.injections = mapaDeReglas(v, false);
    else o[k] = copiaPlana(v);
  }
  return o;
}
export function sanitizeGrammar(g) {
  const o = regla(g);
  if (!o) throw new Error('no parece una gramática TextMate');
  return o;
}
// Un ámbito que el motor usará de clave (scopeName de una gramática).
export const ambitoValido = s => typeof s === 'string' && !!s.trim() && !NOMBRES_PROTO.has(s);

let motor = null;
export function loadEngine() {
  if (!motor) {
    motor = (async () => {
      const [tmMod, onigMod] = await Promise.all([import(TM_URL), import(ONIG_URL)]);
      const tm = tmMod.default?.Registry ? tmMod.default : tmMod;
      const onig = onigMod.default?.loadWASM ? onigMod.default : onigMod;
      const res = await fetch(WASM_URL, { integrity: WASM_SRI, credentials: 'omit' });
      if (!res.ok) throw new Error('onig.wasm: ' + res.status);
      await onig.loadWASM(await res.arrayBuffer());
      return { tm, onig };
    })();
    motor.catch(() => { motor = null; });
  }
  return motor;
}

// Lenguajes de serie de Monaco (Monarch): su definición tiene un `loader`.
const defDeSerie = (monaco, lang) => monaco.languages.getLanguages().find(l => l.id === lang);
export function canOverride(monaco, lang) { return typeof defDeSerie(monaco, lang)?.loader === 'function'; }
async function cargaDeSerie(monaco, lang) {
  try { return await defDeSerie(monaco, lang)?.loader?.(); } catch { return null; }
}

export class Grammars {
  // builtin: lenguajes que ya tenía Monaco antes de las extensiones.
  constructor(monaco, { loadFile, onActivate, builtin }) {
    Object.assign(this, { monaco, loadFile, onActivate, builtin });
    this.gen = 0;
    this.providers = new Map();       // lenguaje → { ready, disposable }
    this.registry = null;
    this.rawTheme = null;
    this._ready = null;
    this.restaurando = Promise.resolve();
    this.configure([]);
  }

  get active() { return !!this.registry; }
  hasGrammarFor(lang) { return this.byLanguage.has(lang); }

  // Gramáticas activas, en orden (la última instalada gana). Las de un
  // lenguaje de serie sin Monarch (JSON, por ejemplo) no se aplican: al
  // quitarlas no habría forma de devolverle su coloreado.
  configure(contribs) {
    this.gen++;
    this.disposeProviders();
    this.registry = null;
    this._ready = null;
    this.byLanguage = new Map();
    this.byScope = new Map();
    this.injections = new Map();
    this.skipped = [];
    for (const c of contribs) {
      if (!ambitoValido(c.scopeName)) continue;
      this.byScope.set(c.scopeName, c);
      for (const destino of c.injectTo || []) {
        if (!this.injections.has(destino)) this.injections.set(destino, []);
        this.injections.get(destino).push(c.scopeName);
      }
      if (!c.language) continue;
      if (this.builtin.has(c.language) && !canOverride(this.monaco, c.language)) { this.skipped.push(c); continue; }
      this.byLanguage.set(c.language, c);
    }
  }

  ensure() {
    if (this._ready) return this._ready;
    const gen = this.gen;
    this._ready = (async () => {
      const { tm, onig } = await loadEngine();
      if (gen !== this.gen) return this.ensure();      // se reconfiguró mientras bajaba
      this.tm = tm;
      this.registry = new tm.Registry({
        onigLib: Promise.resolve({ createOnigScanner: p => onig.createOnigScanner(p), createOnigString: s => onig.createOnigString(s) }),
        loadGrammar: async scope => {
          const c = this.byScope.get(scope);
          if (!c) return null;
          // también aquí: lo guardado antes de sanearse al instalar
          try { const g = await this.loadFile(c.key); if (!g) return null; const s = sanitizeGrammar(g); s.scopeName = scope; return s; } catch { return null; }
        },
        getInjections: scope => this.injections.get(scope),
      });
      if (this.rawTheme) this.registry.setTheme(this.rawTheme);
      await this.onActivate?.();
    })().catch(e => {
      if (gen === this.gen) { this._ready = null; this.registry = null; }   // se reintenta en el próximo fichero
      throw e;
    });
    return this._ready;
  }

  // Tema TextMate actual → mapa de colores para encodedTokensColors (null si
  // el motor aún no está activo: entonces no hay tokens TextMate que pintar).
  setTheme(rawTheme) {
    this.rawTheme = rawTheme;               // ya sin ámbitos peligrosos: toTextMateTheme (themes.js)
    if (!this.registry) return null;
    this.registry.setTheme(rawTheme);
    return this.registry.getColorMap().slice(1);
  }

  prepare(lang) {
    const c = this.byLanguage.get(lang);
    if (!c) return Promise.resolve(false);
    const hecho = this.providers.get(lang);
    if (hecho) return hecho.ready;
    const entry = { disposable: null, ready: null };
    this.providers.set(lang, entry);
    const vivo = () => this.providers.get(lang) === entry;
    entry.ready = (async () => {
      await this.ensure();
      if (!vivo() || !this.registry) return false;     // reconfigurado mientras tanto
      const m = this.monaco;
      const enc = m.languages.getEncodedLanguageId(lang);
      const embeddedLanguages = {};
      for (const [scope, l] of Object.entries(c.embeddedLanguages || {})) {
        const id = m.languages.getEncodedLanguageId(l);
        if (id) embeddedLanguages[scope] = id;
      }
      const tokenTypes = {};
      for (const [sel, t] of Object.entries(c.tokenTypes || {})) if (t in TIPOS) tokenTypes[sel] = TIPOS[t];
      const grammar = await this.registry.loadGrammarWithConfiguration(c.scopeName, enc, {
        embeddedLanguages, tokenTypes,
        balancedBracketSelectors: c.balancedBracketScopes ?? ['*'],
        unbalancedBracketSelectors: c.unbalancedBracketScopes ?? [],
      });
      if (!grammar) throw new Error('no se pudo cargar ' + c.scopeName);
      if (!vivo()) return false;
      // un lenguaje de serie carga su Monarch en diferido: que termine ANTES
      // de registrar el nuestro, o el suyo llegaría después y ganaría
      if (this.builtin.has(lang)) { await cargaDeSerie(m, lang); await this.restaurando; await new Promise(r => setTimeout(r, 0)); }
      if (!vivo()) return false;
      entry.disposable = m.languages.setTokensProvider(lang, proveedor(grammar, this.tm.INITIAL, enc, lang));
      return true;
    })().catch(e => { console.warn('[elffuss-ext] gramática de ' + lang + ':', e?.message || e); return false; });
    return entry.ready;
  }

  // Fuera los proveedores; a los lenguajes de serie se les devuelve su Monarch.
  disposeProviders() {
    const pendientes = [];
    for (const [lang, e] of this.providers) {
      if (!e.disposable) continue;
      e.disposable.dispose();
      if (this.builtin?.has(lang)) {
        pendientes.push(cargaDeSerie(this.monaco, lang).then(mod => {
          if (mod?.language && !this.providers.get(lang)?.disposable) this.monaco.languages.setMonarchTokensProvider(lang, mod.language);
        }));
      }
    }
    this.providers = new Map();
    this.restaurando = Promise.all(pendientes);
  }
}

function proveedor(grammar, INITIAL, enc, lang) {
  // metadatos de un token «normal»: color 1 (primer plano por defecto) y 2 (fondo)
  const normal = (enc | (1 << 15) | (2 << 24)) >>> 0;
  let avisado = false;
  const fallo = e => { if (!avisado) { avisado = true; console.warn('[elffuss-ext] la gramática de ' + lang + ' falló:', e?.message || e); } };
  return {
    getInitialState: () => INITIAL,
    tokenizeEncoded(line, state) {
      try {
        const r = grammar.tokenizeLine2(line, state, LIMITE_MS);
        // si se pasó del tiempo, el estado de la línea no es fiable: la
        // siguiente arranca desde el de esta, como hace VS Code
        return { tokens: r.tokens, endState: r.stoppedEarly ? state : r.ruleStack };
      } catch (e) { fallo(e); return { tokens: new Uint32Array([0, normal]), endState: state }; }
    },
    // versión con nombres de ámbito (monaco.editor.tokenize, inspección)
    tokenize(line, state) {
      try {
        const r = grammar.tokenizeLine(line, state, LIMITE_MS);
        return { tokens: r.tokens.map(t => ({ startIndex: t.startIndex, scopes: t.scopes[t.scopes.length - 1] })), endState: r.stoppedEarly ? state : r.ruleStack };
      } catch (e) { fallo(e); return { tokens: [{ startIndex: 0, scopes: '' }], endState: state }; }
    },
  };
}
