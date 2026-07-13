// Vista «Arquitectura» — mapa de dependencias del proyecto abierto, inspirado
// en CodeFlow (braedonsaunders/codeflow, MIT). Nativo: lee los ficheros reales,
// extrae los imports, resuelve las aristas y los pinta como grafo dirigido
// (force-directed) en SVG. Clic en un nodo → abre el fichero en Monaco.
import * as code from './tools/code.js';

const CODE_EXT = /\.(js|mjs|cjs|jsx|ts|tsx|py|go|rs|java|c|h|cpp|hpp|vue|svelte)$/i;
const COLORS = { js: '#f1dd3f', ts: '#3178c6', tsx: '#3178c6', jsx: '#61dafb', py: '#4b8bbe', go: '#00add8', rs: '#dea584', vue: '#42b883', default: '#7c5cff' };
const extOf = p => (p.split('.').pop() || '').toLowerCase();

// Extrae destinos de import de un fichero (JS/TS/Py, tolerante).
function importsOf(path, src) {
  const t = [];
  const re = /(?:import\s+[^'"]*from\s+|import\s+|require\(\s*|export\s+[^'"]*from\s+)['"]([^'"]+)['"]/g;
  let m; while ((m = re.exec(src))) t.push(m[1]);
  const py = /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm;
  while ((m = py.exec(src))) t.push((m[1] || m[2]).replace(/\./g, '/'));
  return t;
}

// Resuelve un import relativo a un fichero real del proyecto.
function resolve(from, spec, files) {
  if (!/^[./]/.test(spec)) { // no relativo: intenta por sufijo (módulo interno)
    const hit = files.find(f => f.endsWith('/' + spec) || f.includes('/' + spec + '.') || f.includes('/' + spec + '/'));
    return hit || null;
  }
  const base = from.split('/').slice(0, -1);
  for (const part of spec.split('/')) { if (part === '..') base.pop(); else if (part !== '.') base.push(part); }
  const cand = base.join('/');
  return files.find(f => f === cand) ||
    files.find(f => f.replace(CODE_EXT, '') === cand) ||
    files.find(f => f === cand + '/index.js' || f === cand + '/__init__.py') || null;
}

export async function renderArchitecture(container, onOpenFile) {
  container.innerHTML = '<div class="view-loading">Analizando dependencias del proyecto…</div>';
  const all = (await code.fileList()).filter(f => CODE_EXT.test(f));
  const files = all.slice(0, 220);                 // tope para repos enormes
  const nodes = files.map((p, i) => ({ id: p, i, deg: 0, x: 0, y: 0, vx: 0, vy: 0 }));
  const idx = new Map(nodes.map(n => [n.id, n]));
  const edges = [];
  let read = 0;
  for (const p of files) {
    if (read++ > 220) break;
    let src = ''; try { src = await code.read({ path: p }); } catch { continue; }
    for (const spec of importsOf(p, src)) {
      const target = resolve(p, spec, files);
      if (target && target !== p && idx.has(target)) {
        edges.push({ s: idx.get(p), t: idx.get(target) });
        idx.get(p).deg++; idx.get(target).deg++;
      }
    }
  }
  if (!nodes.length) { container.innerHTML = '<div class="view-loading">Sin ficheros de código para analizar.</div>'; return; }

  // layout force-directed determinista
  const W = 1600, H = 1000;
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) & 0x7fffffff) / 0x7fffffff;
  nodes.forEach(n => { n.x = rnd() * W; n.y = rnd() * H; });
  for (let it = 0; it < 220; it++) {
    for (let a = 0; a < nodes.length; a++) for (let b = a + 1; b < nodes.length; b++) {
      const dx = nodes[a].x - nodes[b].x, dy = nodes[a].y - nodes[b].y;
      const d2 = dx * dx + dy * dy + 0.01, f = 900 / d2;
      const fx = dx * f, fy = dy * f;
      nodes[a].vx += fx; nodes[a].vy += fy; nodes[b].vx -= fx; nodes[b].vy -= fy;
    }
    for (const e of edges) {
      const dx = e.t.x - e.s.x, dy = e.t.y - e.s.y;
      const f = 0.006;
      e.s.vx += dx * f; e.s.vy += dy * f; e.t.vx -= dx * f; e.t.vy -= dy * f;
    }
    for (const n of nodes) {
      n.x += (n.vx = Math.max(-30, Math.min(30, n.vx)) * 0.85);
      n.y += (n.vy = Math.max(-30, Math.min(30, n.vy)) * 0.85);
      n.x = Math.max(20, Math.min(W - 20, n.x)); n.y = Math.max(20, Math.min(H - 20, n.y));
    }
  }

  const svg = ['<svg id="arch-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">'];
  svg.push('<defs><marker id="ah" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0 0L7 3L0 6Z" fill="#3a4560"/></marker></defs>');
  for (const e of edges)
    svg.push(`<line x1="${e.s.x.toFixed(1)}" y1="${e.s.y.toFixed(1)}" x2="${e.t.x.toFixed(1)}" y2="${e.t.y.toFixed(1)}" stroke="#2a3350" stroke-width="1" marker-end="url(#ah)"/>`);
  for (const n of nodes) {
    const r = 5 + Math.min(14, n.deg * 1.6);
    const col = COLORS[extOf(n.id)] || COLORS.default;
    const short = n.id.split('/').pop();
    svg.push(`<g class="arch-node" data-path="${n.id}"><circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${r}" fill="${col}22" stroke="${col}" stroke-width="1.5"/><text x="${n.x.toFixed(1)}" y="${(n.y + r + 11).toFixed(1)}" text-anchor="middle" font-size="10" fill="#8b93a8">${short}</text><title>${n.id} · ${n.deg} conexiones</title></g>`);
  }
  svg.push('</svg>');
  container.innerHTML = `<div class="view-head">Arquitectura · ${nodes.length} ficheros, ${edges.length} dependencias <span class="view-hint">clic en un nodo → abrir</span></div>` + svg.join('');
  container.querySelectorAll('.arch-node').forEach(g =>
    g.addEventListener('click', () => onOpenFile(g.dataset.path)));
}
