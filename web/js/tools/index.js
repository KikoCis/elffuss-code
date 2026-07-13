// Registro de herramientas de Elffuss Code: solo toca el proyecto abierto.
import * as code from './code.js';

export { code };

export const TOOLS = {
  'code.tree':   { desc: 'Ver el árbol de archivos del proyecto', params: { path: 'subcarpeta (opcional)', depth: 'niveles (3)' }, run: a => code.tree(a) },
  'code.read':   { desc: 'Leer un archivo del proyecto', params: { path: 'ruta relativa' }, run: a => code.read(a) },
  'code.write':  { desc: 'Escribir/crear un archivo (contenido COMPLETO; se refleja al instante en el editor)', params: { path: 'ruta', content: 'contenido íntegro' }, run: a => code.write(a) },
  'code.search': { desc: 'Buscar texto en el proyecto (grep)', params: { query: 'texto', ext: 'filtro extensión (opcional)' }, run: a => code.search(a) },
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
