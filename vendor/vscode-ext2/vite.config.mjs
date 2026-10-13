// Vite settings for the level 2 vendor bundle. build.mjs calls configFor()
// once per entry; there is no `vite build` CLI step. Each entry becomes ONE
// ES module file (the sandbox loads them from blob: URLs, which cannot
// resolve relative imports), with every asset inlined and no source map.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const ENTRIES = ['sandbox-main', 'exthost-worker', 'editor-worker'];

// A URL built from import.meta.url would point at wherever the blob came
// from. Any that survive bundling point at a name that never resolves and
// that the sandbox's CSP refuses anyway: such a URL fails closed.
export const DEAD_BASE = 'https://x2.invalid/';

const STUBS = {
  jschardet: path.join(HERE, 'src/stubs/jschardet.js'),
  '@vscode/iconv-lite-umd': path.join(HERE, 'src/stubs/iconv-lite-umd.js'),
  '@vscode/diff': path.join(HERE, 'src/stubs/vscode-diff.js'),
};
const KEYBOARD_LAYOUTS = /[\\/]keyboardLayouts[\\/]layout\.contribution\.(darwin|linux|win)\.js$/;

function stubs() {
  return {
    name: 'elffuss-x2-stubs',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (Object.hasOwn(STUBS, source)) return STUBS[source];
      if (/layout\.contribution\.(darwin|linux|win)\.js$/.test(source) && importer) {
        const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
        if (resolved && KEYBOARD_LAYOUTS.test(resolved.id)) return path.join(HERE, 'src/stubs/keyboard-layouts.js');
      }
      return null;
    },
  };
}

// VS Code's CSS is imported from JS (`import * as x from './x.css'`) and
// registered as text by the library; load it as a string export.
function cssAsString() {
  return {
    name: 'elffuss-x2-css-as-string',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!source.endsWith('.css') || source.includes('?')) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (resolved && /[\\/]node_modules[\\/](@codingame[\\/]monaco-vscode|monaco-editor)/.test(resolved.id) && resolved.id.endsWith('.css')) {
        return { ...resolved, id: resolved.id + '?inline' };
      }
      return null;
    },
  };
}

// The library points at its own copy of the extension-host iframe document
// with `new URL('….html', import.meta.url)`. The sandbox registers its own
// document instead (registerAssets), so that copy must not be emitted: the
// reference is pinned to the dead base before Vite turns it into an asset.
function noHtmlAssets() {
  const PATTERN = /new URL\(\s*(['"`])([^'"`]+\.html)\1\s*,\s*import\.meta\.url\s*\)/g;
  return {
    name: 'elffuss-x2-no-html-assets',
    enforce: 'pre',
    transform(code, id) {
      if (!/[\\/]node_modules[\\/]/.test(id) || !code.includes('.html')) return null;
      const out = code.replace(PATTERN, (_, q, file) => `new URL(${JSON.stringify(file)}, ${JSON.stringify(DEAD_BASE)})`);
      return out === code ? null : { code: out, map: null };
    },
  };
}

function deadImportMetaUrl() {
  return {
    name: 'elffuss-x2-dead-import-meta-url',
    renderChunk(code) {
      if (!code.includes('import.meta.url')) return null;
      return { code: code.split('import.meta.url').join(JSON.stringify(DEAD_BASE)), map: null };
    },
  };
}

export function configFor(entry, { outDir }) {
  if (!ENTRIES.includes(entry)) throw new Error('unknown entry ' + entry);
  return {
    configFile: false,
    root: HERE,
    logLevel: 'warn',
    clearScreen: false,
    publicDir: false,
    envDir: false,
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [stubs(), cssAsString(), noHtmlAssets(), deadImportMetaUrl()],
    resolve: { dedupe: ['vscode', 'monaco-editor'] },
    build: {
      outDir,
      emptyOutDir: true,
      target: 'es2022',
      minify: true,
      sourcemap: false,
      assetsInlineLimit: 4 * 1024 * 1024,
      cssCodeSplit: false,
      copyPublicDir: false,
      reportCompressedSize: false,
      modulePreload: false,
      write: true,
      license: { fileName: entry + '.licenses.json' },
      // not library mode: Vite keeps the whitespace of ES libraries, and this
      // bundle is never re-bundled by anyone
      rolldownOptions: {
        input: { [entry]: path.join(HERE, 'src', entry + '.js') },
        preserveEntrySignatures: 'strict',
        output: { format: 'es', codeSplitting: false, entryFileNames: '[name].js' },
      },
    },
  };
}
