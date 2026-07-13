// Vista «Ciudad 3D» — el proyecto abierto como metrópolis, inspirado en
// VibeCodeViewer (Sendery/VibeCodeViewer, Apache-2.0). Nativo con Three.js:
// carpetas = distritos, ficheros = edificios (altura ~ tamaño, color por tipo).
// Órbita con el ratón; clic en un edificio → abre el fichero en Monaco.
import * as code from './tools/code.js';

const COLORS = { js: 0xf1dd3f, ts: 0x3178c6, tsx: 0x3178c6, jsx: 0x61dafb, py: 0x4b8bbe, go: 0x00add8, rs: 0xdea584, json: 0xcbcb41, md: 0x519aba, css: 0x9b7cf6, html: 0xe34c26, default: 0x7c5cff };
const extOf = p => (p.split('.').pop() || '').toLowerCase();
const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'target', '__pycache__', '.next', 'venv', '.venv']);

let raf = null, disposer = null;

export async function renderCity(container, onOpenFile) {
  disposeCity();
  container.innerHTML = '<div class="view-loading">Construyendo la ciudad del proyecto…</div>';
  const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');

  // archivos → agrupados por carpeta de primer nivel (distritos)
  const files = [];
  const root = code.handle();
  if (!root) { container.innerHTML = '<div class="view-loading">Abre un proyecto primero.</div>'; return; }
  async function walk(dir, prefix, depth) {
    if (depth > 7 || files.length > 1200) return;
    for await (const e of dir.values()) {
      if (IGNORE.has(e.name)) continue;
      const p = prefix ? prefix + '/' + e.name : e.name;
      if (e.kind === 'directory') await walk(e, p, depth + 1);
      else { const f = await e.getFile(); files.push({ path: p, size: f.size, district: p.split('/')[0] }); }
    }
  }
  await walk(root, '', 0);
  if (!files.length) { container.innerHTML = '<div class="view-loading">Proyecto vacío.</div>'; return; }

  const districts = [...new Set(files.map(f => f.district))];
  const perRow = Math.ceil(Math.sqrt(districts.length));
  const dPos = new Map(districts.map((d, i) => [d, { gx: (i % perRow), gz: Math.floor(i / perRow) }]));
  const GAP = 26;                                     // separación entre distritos

  container.innerHTML = '<canvas id="city-canvas"></canvas><div class="view-head">Ciudad 3D · ' + files.length + ' ficheros en ' + districts.length + ' distritos <span class="view-hint">arrastra para orbitar · clic en un edificio → abrir</span></div><div id="city-tip"></div>';
  const canvas = container.querySelector('#city-canvas');
  const W = container.clientWidth, H = container.clientHeight;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(W, H); renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d12);
  scene.fog = new THREE.Fog(0x0b0d12, 120, 400);
  const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, 1000);
  camera.position.set(90, 80, 120);
  scene.add(new THREE.AmbientLight(0x8899ff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 0.9); key.position.set(60, 120, 40); scene.add(key);
  scene.add(new THREE.HemisphereLight(0x7c5cff, 0x111122, 0.4));

  // suelo por distrito
  const meshes = [];
  const byDistrict = {};
  files.forEach(f => (byDistrict[f.district] ||= []).push(f));
  for (const [d, arr] of Object.entries(byDistrict)) {
    const { gx, gz } = dPos.get(d);
    const cols = Math.ceil(Math.sqrt(arr.length));
    const ox = gx * (perRow > 1 ? (cols + 4) * 2.2 + GAP : GAP), oz = gz * (perRow > 1 ? (cols + 4) * 2.2 + GAP : GAP);
    arr.forEach((f, i) => {
      const bx = ox + (i % cols) * 2.4, bz = oz + Math.floor(i / cols) * 2.4;
      const h = 1.5 + Math.min(24, Math.log2((f.size || 20) + 2) * 2.2);
      const geo = new THREE.BoxGeometry(1.7, h, 1.7);
      const mat = new THREE.MeshLambertMaterial({ color: COLORS[extOf(f.path)] || COLORS.default });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(bx, h / 2, bz);
      m.userData = f;
      scene.add(m); meshes.push(m);
    });
  }
  // centra la cámara en el conjunto
  const box = new THREE.Box3().setFromObject(scene);
  const c = box.getCenter(new THREE.Vector3());
  camera.lookAt(c);
  let theta = 0.7, phi = 0.9, radius = box.getSize(new THREE.Vector3()).length() * 0.7;

  // órbita con ratón (sin dependencias)
  let dragging = false, px = 0, py = 0;
  const onDown = e => { dragging = true; px = e.clientX; py = e.clientY; };
  const onUp = () => { dragging = false; };
  const onMove = e => { if (!dragging) return; theta -= (e.clientX - px) * 0.006; phi = Math.max(0.15, Math.min(1.4, phi - (e.clientY - py) * 0.006)); px = e.clientX; py = e.clientY; };
  const onWheel = e => { e.preventDefault(); radius = Math.max(20, Math.min(500, radius + e.deltaY * 0.12)); };
  canvas.addEventListener('pointerdown', onDown); addEventListener('pointerup', onUp); addEventListener('pointermove', onMove); canvas.addEventListener('wheel', onWheel, { passive: false });

  // clic → raycast → abrir
  const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
  let downX = 0, downY = 0;
  canvas.addEventListener('pointerdown', e => { downX = e.clientX; downY = e.clientY; });
  canvas.addEventListener('click', e => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 4) return; // era un drag
    const r = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(meshes)[0];
    if (hit) onOpenFile(hit.object.userData.path);
  });

  function frame() {
    raf = requestAnimationFrame(frame);
    camera.position.set(c.x + radius * Math.sin(phi) * Math.cos(theta), c.y + radius * Math.cos(phi), c.z + radius * Math.sin(phi) * Math.sin(theta));
    camera.lookAt(c);
    renderer.render(scene, camera);
  }
  frame();

  disposer = () => {
    if (raf) cancelAnimationFrame(raf);
    removeEventListener('pointerup', onUp); removeEventListener('pointermove', onMove);
    meshes.forEach(m => { m.geometry.dispose(); m.material.dispose(); });
    renderer.dispose();
  };
}

export function disposeCity() { if (disposer) { disposer(); disposer = null; } }
