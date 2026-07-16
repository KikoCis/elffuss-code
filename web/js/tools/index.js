// Registro de herramientas de Elffuss Code: proyecto abierto + shell + web.
import * as code from './code.js';
import * as shell from '../shell.js';
import * as web from './web.js';

export { code };

// El terminal (UI) se engancha aquí para reflejar lo que ejecuta la elfa.
let onTerminalEcho = () => {};
export function setTerminalEcho(fn) { onTerminalEcho = fn; }

export const TOOLS = {
  'code.tree':   { desc: 'Ver el árbol de archivos del proyecto', params: { path: 'subcarpeta (opcional)', depth: 'niveles (3)' }, run: a => code.tree(a) },
  'code.read':   { desc: 'Leer un archivo del proyecto', params: { path: 'ruta relativa' }, run: a => code.read(a) },
  'code.write':  { desc: 'Escribir/crear un archivo (contenido COMPLETO; se refleja al instante en el editor). Para cambios PEQUEÑOS en un fichero YA existente, usa mejor code.edit', params: { path: 'ruta', content: 'contenido íntegro' }, run: a => code.write(a) },
  'code.edit':   { desc: 'Editar PARTE de un fichero existente sin reescribirlo entero: sustituye "search" (copia literal de unas pocas líneas, con contexto suficiente para ser única en el fichero) por "replace". Preferible a code.write para cambios pequeños/medianos — más rápido y sin riesgo de perder el resto del fichero. Si falla (no encuentra el punto con confianza), relee el fichero y reintenta con un search más ajustado', params: { path: 'ruta', search: 'texto exacto a sustituir', replace: 'texto nuevo' }, run: a => code.edit(a) },
  'code.search': { desc: 'Buscar texto en el proyecto (grep)', params: { query: 'texto', ext: 'filtro extensión (opcional)' }, run: a => code.search(a) },
  'terminal.run': { desc: 'Ejecutar un comando de shell sobre los ficheros del proyecto (ls, cat, grep, find, mkdir, echo>fichero, git status…). node/npm/python REALES si el usuario tiene un Bridge local conectado (⚙ Ajustes → 🔌 Bridge local); si no está conectado, el propio resultado lo indica', params: { command: 'la línea de comando' }, run: async a => { const out = await shell.runForAgent(a.command || ''); onTerminalEcho(a.command || '', out); return out; } },
  'web.search': { desc: 'Buscar en internet (docs, errores, APIs) — devuelve títulos, URLs y fragmentos', params: { query: 'qué buscar' }, run: a => web.search(a) },
  'web.fetch':  { desc: 'Leer el contenido de texto de una URL (documentación, referencia)', params: { url: 'https://…' }, run: a => web.fetchUrl(a) },
};

export function toolHelp() {
  return Object.entries(TOOLS).map(([n, t]) =>
    `- ${n}(${Object.keys(t.params).join(', ')}): ${t.desc}`).join('\n');
}

export async function runTool(name, args) {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`Herramienta desconocida: ${name}`);
  return tool.run(args || {});
}

// CONTEXTO AHORA del IDE: proyecto, archivo abierto y árbol resumido.
export async function snapshot() {
  const { projectName, currentFile } = code.current();
  const parts = [
    'Fecha y hora: ' + new Date().toLocaleString(),
    'Proyecto abierto: ' + (projectName || 'ninguno'),
    'Archivo abierto en el editor: ' + (currentFile || 'ninguno'),
  ];
  try { parts.push('Árbol del proyecto (resumen):\n' + await code.tree({ depth: 2 })); }
  catch { /* aún sin proyecto */ }
  // GROUNDING: incluye el contenido REAL de los archivos clave (README, config)
  // para que el modelo NO alucine sobre el proyecto — el heal no domina las
  // herramientas code.* así que le damos el material masticado.
  for (const key of ['README.md', 'readme.md', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod']) {
    try { const body = await code.read({ path: key }); parts.push(`Contenido REAL de ${key}:\n${body.slice(0, 1400)}`); break; } catch { /* siguiente */ }
  }
  if (currentFile) {
    try {
      const body = await code.read({ path: currentFile });
      parts.push(`Contenido REAL del archivo abierto ${currentFile}:\n` + body.slice(0, 2000));
    } catch { /* borrado */ }
  }
  return parts.join('\n');
}
