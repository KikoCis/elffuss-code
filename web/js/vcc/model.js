// Modelo: convierte el árbol del repo en una ciudad con cajas anidadas.
// Jerarquía: ciudad → distrito → edificio → planta → apartamento → habitación
//            → archivador → cajón → fichero (los ficheros pueden vivir en
//            cualquier nivel: se les reserva un hueco en su contenedor).
// Cuando un subárbol es demasiado profundo/poblado para un solo edificio,
// se interpone una «urbanización»: una plota dentro del distrito que agrupa
// procedualmente a sus subcarpetas como edificios (recursivo), de modo que
// la profundidad sobrante se despliega por la ciudad en vez de comprimirse.
// Los ficheros ignorados (.gitignore y equivalentes) se separan en un
// sótano espejado bajo el plano de circuitos.
import { makeOwnerResolver } from './ownership.js';

export const ROLES = ['ciudad', 'distrito', 'edificio', 'planta', 'apartamento', 'habitacion', 'archivador', 'cajon'];
const ROLE_AXIS = { planta: 'y', apartamento: 'x', habitacion: 'z', archivador: 'x', cajon: 'y' };

const STREET = 14;        // separación entre distritos
const ALLEY = 4;          // separación entre edificios
const URB_PAD = 3;        // margen interior de una urbanización
// un edificio absorbe 5 niveles (planta→…→cajón); más allá, urbanización
const URB_DEPTH = 5;
const URB_MIN_FILES = 200;
const URB_MAX_FILES = 2000; // aun siendo poco profundo, esto no cabe en uno
const GROUND_Y = 0;

let nextNode = 0;
let nextFile = 0;

function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 1000) / 1000;
}

function unpack(packed) {
  const [name, dirs, leaf] = packed;
  const node = { name, dirs: dirs.map(unpack), leaf: leaf.map(([n, s, ig]) => ({ name: n, size: s, ignored: !!ig })) };
  node.files = node.leaf.length + node.dirs.reduce((a, d) => a + d.files, 0);
  node.size = node.leaf.reduce((a, f) => a + f.size, 0) + node.dirs.reduce((a, d) => a + d.size, 0);
  return node;
}

function recount(node) {
  node.files = node.leaf.length + node.dirs.reduce((a, d) => a + d.files, 0);
  node.size = node.leaf.reduce((a, f) => a + f.size, 0) + node.dirs.reduce((a, d) => a + d.size, 0);
  return node;
}

// separa un subárbol en parte visible y parte ignorada (sótano)
function splitSrc(src) {
  const kept = { name: src.name, dirs: [], leaf: src.leaf.filter(f => !f.ignored) };
  const ign = { name: src.name, dirs: [], leaf: src.leaf.filter(f => f.ignored) };
  for (const d of src.dirs) {
    const s = splitSrc(d);
    if (s.kept.files) kept.dirs.push(s.kept);
    if (s.ign.files) ign.dirs.push(s.ign);
  }
  return { kept: recount(kept), ign: recount(ign) };
}

function makeNode(model, name, role, parent, { virtual = false } = {}) {
  const node = {
    id: nextNode++, name, role, parent, children: [], fileIds: [],
    virtual, box: null, building: null,
    path: parent ? (virtual ? parent.path : `${parent.path}/${name}`) : name,
  };
  if (parent) parent.children.push(node);
  model.nodes.push(node);
  return node;
}

function addFiles(model, node, leaf) {
  for (const f of leaf) {
    const file = {
      id: nextFile++, name: f.name, size: f.size, node,
      path: `${node.path}/${f.name}`, box: null,
    };
    node.fileIds.push(file.id);
    model.files.push(file);
  }
}

// ── dimensiones de edificio ───────────────────────────────────────────────
function buildingDims(src) {
  const kb = src.size / 1024;
  const side = Math.min(22, Math.max(6, 4 + Math.log2(1 + kb) * 1.5));
  const j = hash01(src.name);
  const w = side * (0.85 + 0.3 * j);
  const d = side * (0.85 + 0.3 * (1 - j));
  const floors = Math.max(1, src.dirs.length + (src.leaf.length ? 1 : 0));
  const h = Math.max(6, Math.max(floors * 3.0, 6 + src.files * 1.8));
  return { w, d, h: Math.min(h, 80) };
}

// ── reparto de un eje en franjas ponderadas ───────────────────────────────
function splitAxis(box, axis, weights, inset) {
  const total = weights.reduce((a, b) => a + b, 0);
  const span = box['s' + axis];
  const start = box['c' + axis] - span / 2;
  const gap = Math.min(inset, span * 0.04);
  const usable = span - gap * (weights.length + 1);
  const out = [];
  let cursor = start + gap;
  for (const w of weights) {
    const s = usable * (w / total);
    out.push({ ...box, ['c' + axis]: cursor + s / 2, ['s' + axis]: s });
    cursor += s + gap;
  }
  return out;
}

function shrink(box, f) {
  return { ...box, sx: box.sx * f, sy: box.sy * f, sz: box.sz * f };
}

// ── celdas de fichero dentro de su contenedor ─────────────────────────────
function placeFiles(model, node, box, files) {
  const n = files.length;
  if (!n) return;
  if (node.role === 'cajon') {
    // carpetas colgantes: láminas verticales en fila
    const slabs = splitAxis({ ...box, sy: box.sy * 0.72, cy: box.cy - box.sy * 0.1 }, 'x',
      files.map(() => 1), 0.05);
    files.forEach((fid, i) => {
      const s = slabs[i];
      model.files[fid].box = { ...s, sx: Math.min(s.sx * 0.55, 0.5), sz: s.sz * 0.78 };
    });
    return;
  }
  // rejilla de cubos apoyada en el suelo del contenedor
  const aspect = box.sx / box.sz || 1;
  const cols = Math.max(1, Math.round(Math.sqrt(n * aspect)));
  const rows = Math.ceil(n / cols);
  const cw = box.sx / cols, cd = box.sz / rows;
  const base = Math.min(cw, cd, box.sy) * 0.5;
  files.forEach((fid, i) => {
    const f = model.files[fid];
    const col = i % cols, row = Math.floor(i / cols);
    const k = 0.65 + 0.45 * Math.min(1, Math.log2(2 + f.size / 1024) / 8);
    const s = Math.max(0.25, base * k);
    f.box = {
      cx: box.cx - box.sx / 2 + cw * (col + 0.5),
      cz: box.cz - box.sz / 2 + cd * (row + 0.5),
      cy: box.cy - box.sy / 2 + s / 2 + 0.05,
      sx: s, sy: s, sz: s,
    };
  });
}

// ── subdivisión recursiva del interior del edificio ───────────────────────
// flipY: en los sótanos las plantas crecen hacia abajo (dirección inversa)
function layoutInterior(model, node, src, box, role, flipY = false) {
  node.box = box;
  const dirs = src.dirs;
  const hasFiles = src.leaf.length > 0;
  addFiles(model, node, src.leaf);

  if (!dirs.length) {
    placeFiles(model, node, shrink(box, 0.9), node.fileIds);
    return;
  }
  const childRole = ROLES[Math.min(ROLES.indexOf(role) + 1, ROLES.length - 1)];
  const axis = ROLE_AXIS[childRole] ?? 'y';
  const weights = dirs.map(d => 1 + Math.sqrt(d.files));
  if (hasFiles) weights.push(0.8 + Math.sqrt(src.leaf.length) * 0.7);
  const slices = splitAxis(box, axis, weights, 0.5);
  if (flipY && axis === 'y') slices.reverse();
  dirs.forEach((d, i) => {
    const child = makeNode(model, d.name, childRole, node);
    child.building = node.building;
    layoutInterior(model, child, d, shrink(slices[i], 0.94), childRole, flipY);
  });
  if (hasFiles) placeFiles(model, node, shrink(slices[slices.length - 1], 0.9), node.fileIds);
}

// ── empaquetado en rejilla (edificios en distrito, distritos en ciudad) ───
function packGrid(items, gap) {
  // items: { w, d } → coloca en filas; devuelve posiciones y tamaño del plot
  const area = items.reduce((a, it) => a + (it.w + gap) * (it.d + gap), 0);
  const targetW = Math.max(Math.sqrt(area) * 1.15, ...items.map(it => it.w + gap));
  let x = 0, z = 0, rowD = 0, plotW = 0;
  const pos = [];
  for (const it of items) {
    if (x > 0 && x + it.w > targetW) { x = 0; z += rowD + gap; rowD = 0; }
    pos.push({ x: x + it.w / 2, z: z + it.d / 2 });
    x += it.w + gap;
    rowD = Math.max(rowD, it.d);
    plotW = Math.max(plotW, x - gap);
  }
  return { pos, w: plotW, d: z + rowD };
}

function subtreeDepth(src) {
  let d = 0;
  for (const s of src.dirs) d = Math.max(d, 1 + subtreeDepth(s));
  return d;
}

// ¿demasiado profundo y poblado para un solo edificio? → urbanización
function needsUrb(src) {
  if (src.virtual || !src.dirs.length) return false;
  if (src.files > URB_MAX_FILES) return true;
  return src.files > URB_MIN_FILES && subtreeDepth(src) > URB_DEPTH;
}

function fileBlockSrc(leaf) {
  return { name: '(ficheros)', dirs: [], leaf, files: leaf.length, size: leaf.reduce((a, f) => a + f.size, 0), virtual: true };
}

// un «bloque» es lo que ocupa una parcela: un edificio o una urbanización.
// Devuelve { w, d, place(cx, cz) } para el empaquetado en rejilla.
function buildBlock(model, parent, src) {
  if (needsUrb(src)) return buildUrb(model, parent, src);
  const split = splitSrc(src);
  const b = makeNode(model, src.name, 'edificio', parent, { virtual: !!src.virtual });
  b.building = b;
  b.dims = buildingDims(split.kept.files ? split.kept : src);
  // sin nada en superficie y todo en el sótano: búnker bajo y más opaco
  // que señala que la información está bajo el suelo
  if (!split.kept.files && split.ign.files) {
    b.onlyBasement = true;
    b.dims.h = 3;
  }
  b.srcKept = split.kept;
  b.srcIgn = split.ign;
  model.buildings.push(b);
  return { w: b.dims.w, d: b.dims.d, place: (cx, cz) => placeBuilding(model, b, cx, cz) };
}

function buildUrb(model, parent, src) {
  const urb = makeNode(model, src.name, 'urbanizacion', parent);
  const childSrcs = [...src.dirs];
  if (src.leaf.length) childSrcs.push(fileBlockSrc(src.leaf));
  const blocks = childSrcs.map(s => buildBlock(model, urb, s));
  const grid = packGrid(blocks, ALLEY);
  const w = grid.w + URB_PAD * 2, d = grid.d + URB_PAD * 2;
  model.urbs.push(urb);
  return {
    w, d,
    place: (cx, cz) => {
      urb.box = { cx, cy: GROUND_Y + 0.26, cz, sx: w, sy: 0.14, sz: d };
      const ox = cx - w / 2 + URB_PAD, oz = cz - d / 2 + URB_PAD;
      blocks.forEach((blk, i) => blk.place(ox + grid.pos[i].x, oz + grid.pos[i].z));
    },
  };
}

function placeBuilding(model, b, cx, cz) {
  const { w, d, h } = b.dims;
  layoutInterior(model, b, b.srcKept, { cx, cz, cy: GROUND_Y + h / 2, sx: w, sy: h, sz: d }, 'edificio');
  // sótano: los ficheros ignorados crecen hacia abajo, mismo patrón invertido
  if (b.srcIgn.files) {
    const hb = Math.min(60, Math.max(5, Math.max(
      (b.srcIgn.dirs.length + (b.srcIgn.leaf.length ? 1 : 0)) * 3.0,
      5 + b.srcIgn.files * 1.6,
    )));
    const bb = makeNode(model, b.name, 'edificio', b.parent, { virtual: b.virtual });
    bb.building = bb;
    bb.isBasement = true;
    model.buildings.push(bb);
    layoutInterior(model, bb, b.srcIgn,
      { cx, cz, cy: GROUND_Y - 0.7 - hb / 2, sx: w, sy: hb, sz: d }, 'edificio', true);
  }
  delete b.srcKept; delete b.srcIgn;
}

function buildDistrict(model, city, srcDir, files) {
  const district = makeNode(model, srcDir ? srcDir.name : '(raíz)', 'distrito', city, { virtual: !srcDir });
  const blockSrcs = [];
  if (srcDir) {
    for (const d of srcDir.dirs) blockSrcs.push(d);
    if (srcDir.leaf.length) blockSrcs.push(fileBlockSrc(srcDir.leaf));
  } else {
    blockSrcs.push(fileBlockSrc(files));
  }
  const blocks = blockSrcs.map(s => buildBlock(model, district, s));
  const grid = packGrid(blocks, ALLEY);
  district.plot = { w: grid.w + ALLEY * 2, d: grid.d + ALLEY * 2 };
  district.blocks = blocks;
  district.grid = grid;
  model.districts.push(district);
  return district;
}

export function buildModel(packedTree, meta = null) {
  nextNode = 0; nextFile = 0;
  const model = { nodes: [], files: [], buildings: [], districts: [], urbs: [], city: null };
  const root = unpack(packedTree);
  const city = makeNode(model, root.name, 'ciudad', null);
  model.city = city;

  for (const d of root.dirs) buildDistrict(model, city, d, []);
  if (root.leaf.length) buildDistrict(model, city, null, root.leaf);

  // colocar distritos en la ciudad
  const plots = model.districts.map(di => ({ w: di.plot.w, d: di.plot.d }));
  const cityGrid = packGrid(plots, STREET);
  const ox = -cityGrid.w / 2, oz = -cityGrid.d / 2;
  model.districts.forEach((di, i) => {
    const p = cityGrid.pos[i];
    const px = ox + p.x, pz = oz + p.z;
    di.box = { cx: px, cy: GROUND_Y + 0.12, cz: pz, sx: di.plot.w, sy: 0.24, sz: di.plot.d };
    const bx = px - di.plot.w / 2 + ALLEY, bz = pz - di.plot.d / 2 + ALLEY;
    di.blocks.forEach((blk, j) => blk.place(bx + di.grid.pos[j].x, bz + di.grid.pos[j].z));
    delete di.blocks; delete di.grid;
  });
  city.box = { cx: 0, cy: 0, cz: 0, sx: cityGrid.w + STREET * 2, sy: 1, sz: cityGrid.d + STREET * 2 };

  // cadena de ancestros por fichero (para la iluminación jerárquica)
  // + metadatos git y code ownership por fichero
  const rootPrefix = city.name + '/';
  const resolveOwner = makeOwnerResolver(meta?.owners);
  const ownerIndex = new Map();
  for (const f of model.files) {
    const chain = [];
    for (let n = f.node; n; n = n.parent) chain.push(n);
    f.chain = chain; // del contenedor inmediato hacia la ciudad
    f.rel = f.path.startsWith(rootPrefix) ? f.path.slice(rootPrefix.length) : f.path;
    const g = meta?.git?.[f.rel];
    f.git = g ? { st: g[0], a: g[1], d: g[2] } : null;
    const owner = resolveOwner(f.rel);
    if (owner != null) {
      if (!ownerIndex.has(owner)) ownerIndex.set(owner, ownerIndex.size);
      f.owner = ownerIndex.get(owner);
    } else {
      f.owner = null;
    }
  }
  model.owners = [...ownerIndex.keys()];
  model.hasGit = !!meta?.git;

  applyCodeMeta(model, meta?.links, meta?.codeIndex);
  model.fileByRel = new Map(model.files.map(f => [f.rel, f]));
  model.dirByRel = new Map();
  for (const n of model.nodes) {
    if (n.role === 'ciudad' || n.virtual || n.isBasement || n.building?.isBasement) continue;
    const rel = n.path.startsWith(rootPrefix) ? n.path.slice(rootPrefix.length) : n.path;
    if (!model.dirByRel.has(rel)) model.dirByRel.set(rel, n);
  }
  return model;
}

// enlaces de código (modo Blast): adyacencia saliente y entrante. Es una
// función aparte porque el análisis perezoso los refresca por lotes sobre
// el modelo ya construido, sin reconstruir la ciudad.
export function applyCodeMeta(model, links, codeIndex) {
  model.linksOut = links ?? {};
  model.linksIn = {};
  for (const [src, toks] of Object.entries(model.linksOut)) {
    for (const tok of toks) {
      if (tok.startsWith('F:')) (model.linksIn[tok.slice(2)] ??= []).push(src);
    }
  }
  // índice de símbolos (funciones/clases/tipos): aristas "src usa sym de target"
  model.defs = codeIndex?.defs ?? {};
  model.symOut = codeIndex?.symLinks ?? {};
  model.symIn = {};
  for (const [src, edges] of Object.entries(model.symOut)) {
    for (const [target, sym] of edges) (model.symIn[target] ??= []).push([src, sym]);
  }
}
