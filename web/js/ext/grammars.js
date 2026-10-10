// Gramáticas TextMate de las extensiones, con el mismo motor que VS Code:
// vscode-textmate + Oniguruma (WebAssembly). Se bajan del CDN SOLO cuando un
// fichero necesita la primera gramática; sin extensiones de lenguaje no se
// carga nada.
//
// Los tokens van a Monaco en binario (tokenizeEncoded), igual que en VS Code:
// cada token lleva el índice de su color en el mapa de colores de TextMate, y
// el tema de Monaco se define con ese mismo mapa delante (encodedTokensColors),
// así los dos mapas coinciden índice a índice. Resultado: los colores exactos
// del tema (incluidos los selectores con contexto), cursivas/negritas, y el
// tipo de token (comentario/cadena) que Monaco usa para el autocierre.
const TM_URL = 'https://cdn.jsdelivr.net/npm/vscode-textmate@9.3.2/+esm';
const ONIG_URL = 'https://cdn.jsdelivr.net/npm/vscode-oniguruma@2.0.1/+esm';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/vscode-oniguruma@2.0.1/release/onig.wasm';
const WASM_SRI = 'sha384-bmaXom6bK+vfssb0IcRH2lE1asksQiEsK/WnxAcnHDB3Cx8v3KxZ7BthuGq1DU8v';
const LIMITE_MS = 500;              // por línea, como VS Code: una gramática mala no congela la pestaña
const TIPOS = { other: 0, comment: 1, string: 2, regex: 3 };

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
          try { const g = await this.loadFile(c.key); if (g) g.scopeName = scope; return g || null; } catch { return null; }
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
    this.rawTheme = rawTheme;
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
