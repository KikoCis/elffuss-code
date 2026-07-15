// Glue específico de Elffuss Code para la Mente genérica (mind.js, core): le
// da su ciudad de fondo real (motor VibeCodeViewer sobre el proyecto abierto)
// y la semilla de pensamientos ya guardados en la carpeta-alma del cerebro.
import * as THREE from 'three';
import * as codeTools from './tools/code.js';
import * as ceo from './ceo.js';
import { buildModel } from './vcc/model.js';
import { buildCity } from './vcc/builder.js';
import { THEME as VCC_THEME } from './vcc/theme.js';

const CITY_MAX_FILES = 2600;
const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'target', '__pycache__', '.next', 'venv', '.venv', '.DS_Store']);

async function scanForCity(dir, budget) {
  const dirs = [], files = [];
  for await (const e of dir.values()) { if (IGNORE.has(e.name)) continue; (e.kind === 'directory' ? dirs : files).push(e); }
  dirs.sort((a, b) => a.name.localeCompare(b.name)); files.sort((a, b) => a.name.localeCompare(b.name));
  const outFiles = [];
  for (const f of files) { if (budget.n >= CITY_MAX_FILES) break; let size = 0; try { size = (await f.getFile()).size; } catch { /* */ } outFiles.push([f.name, size]); budget.n++; }
  const outDirs = [];
  for (const d of dirs) { if (budget.n >= CITY_MAX_FILES) break; outDirs.push(await scanForCity(d, budget)); }
  return [dir.name, outDirs, outFiles];
}

export async function buildCityAdapter(scene) {
  const root = codeTools.handle();
  if (!root) return null;
  const tree = await scanForCity(root, { n: 0 });
  const model = buildModel(tree, null);
  if (!model.files.length) return null;
  const extent = Math.max(model.city.box.sx, model.city.box.sz, 1);
  const scale = Math.min(1, Math.max(0.05, 170 / extent));
  const cityWrap = new THREE.Group();
  cityWrap.position.set(0, -95, 0);
  cityWrap.scale.setScalar(scale);
  scene.add(cityWrap);
  const cityCity = buildCity(cityWrap, model, VCC_THEME);
  return { cityWrap, cityCity, cityModel: model };
}

export async function loadThoughtsAdapter() {
  const soul = ceo.getSoulDir();
  let dir = codeTools.handle();
  for (const seg of soul.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(seg);
  const files = [];
  for await (const e of dir.values()) if (e.kind === 'file' && e.name.endsWith('.md')) files.push(e);
  files.sort((a, b) => a.name.localeCompare(b.name));
  const out = [];
  for (const f of files.slice(-24)) out.push({ path: soul + '/' + f.name, md: await (await f.getFile()).text() });
  return out;
}
