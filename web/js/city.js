// Vista «Ciudad 3D» — el proyecto abierto renderizado con el MOTOR REAL de
// VibeCodeViewer (Sendery/VibeCodeViewer, Apache-2.0), vendorizado en js/vcc.
// Aquí solo hacemos de glue: escaneamos la carpeta abierta al árbol empaquetado
// que espera buildModel, montamos el render (cámara + OrbitControls + bloom) y
// conectamos el raycast → abrir fichero en Monaco. La geometría (ciudad anidada
// distrito→edificio→planta→…, cristal fresnel, fachadas con el árbol impreso,
// suelo de circuito, leyenda) es la del builder original, sin tocar.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as code from './tools/code.js';
import { buildModel } from './vcc/model.js';
import { buildCity } from './vcc/builder.js';
import { THEME } from './vcc/theme.js';
import { escuchar } from './actividad.js';

const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'target', '__pycache__', '.next', 'venv', '.venv', '.DS_Store']);
const MAX_FILES = 8000; // tope de seguridad para no colgar el navegador en monorepos

let disposer = null;

// Escanea el handle del proyecto al formato empaquetado de VibeCodeViewer:
//   dir = [nombre, [subdirs], [ficheros]] · fichero = [nombre, bytes]
async function scanTree(dir, budget) {
  const dirs = [], files = [];
  for await (const e of dir.values()) {
    if (IGNORE.has(e.name)) continue;
    (e.kind === 'directory' ? dirs : files).push(e);
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  const outFiles = [];
  for (const f of files) {
    if (budget.n >= MAX_FILES) break;
    let size = 0; try { size = (await f.getFile()).size; } catch { /* ilegible */ }
    outFiles.push([f.name, size]); budget.n++;
  }
  const outDirs = [];
  for (const d of dirs) { if (budget.n >= MAX_FILES) break; outDirs.push(await scanTree(d, budget)); }
  return [dir.name, outDirs, outFiles];
}

export async function renderCity(container, onOpenFile) {
  disposeCity();
  const root = code.handle();
  if (!root) { container.innerHTML = '<div class="view-loading">Abre un proyecto primero.</div>'; return; }
  container.innerHTML = '<div class="view-loading">Construyendo la metrópolis del proyecto…</div>';

  const budget = { n: 0 };
  const tree = await scanTree(root, budget);
  const model = buildModel(tree, null);
  if (!model.files.length) { container.innerHTML = '<div class="view-loading">Proyecto vacío.</div>'; return; }

  container.innerHTML =
    '<canvas id="city-canvas"></canvas>' +
    '<div class="view-head">Ciudad 3D · ' + model.files.length + (budget.n >= MAX_FILES ? '+' : '') +
    ' ficheros en ' + model.districts.length + ' distritos' +
    '<span class="view-hint">arrastra para orbitar · rueda para zoom · clic en un edificio → abrir</span></div>' +
    // Pila de actividad: lo que la elfa hace AHORA, línea a línea, como un terminal.
    '<pre class="city-log" aria-live="off" style="position:absolute;left:0;right:0;bottom:0;max-height:32%;overflow:auto;margin:0;padding:6px 10px;font:12px/1.4 ui-monospace,monospace;background:rgba(0,0,0,.55);color:#cfe;pointer-events:none;white-space:pre-wrap"></pre>';
  const registro = container.querySelector('.city-log');
  const canvas = container.querySelector('#city-canvas');
  const W = container.clientWidth || 800, H = container.clientHeight || 600;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(THEME.background, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(THEME.background);
  const extent = Math.max(model.city.box.sx, model.city.box.sz);
  scene.fog = new THREE.FogExp2(THEME.fog, 0.62 / extent);

  const camera = new THREE.PerspectiveCamera(55, W / H, 0.1, extent * 14);
  camera.position.set(extent * 0.7, extent * 0.6, extent * 0.7);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;   // no bajar del suelo
  controls.target.set(0, extent * 0.04, 0);
  controls.update();

  // pipeline con bloom (la receta del builder: HDR + bloom solo en lo resaltado)
  const composer = new EffectComposer(renderer);
  composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), THEME.bloom.strength, 0.25, THEME.bloom.threshold);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const city = buildCity(scene, model, THEME);

  // ── interacción: hover resalta edificios, clic abre el fichero ────────────
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let hovered = null, lastHover = 0, downXY = null;
  const setPtr = e => { const r = canvas.getBoundingClientRect(); ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); };
  const onMove = e => {
    setPtr(e);
    const now = performance.now(); if (now - lastHover < 50) return; lastHover = now;
    ray.setFromCamera(ptr, camera);
    const b = ray.intersectObjects(city.shells)[0]?.object.userData.building ?? null;
    if (b !== hovered) {
      if (hovered) city.paintNode(hovered, 0);
      hovered = b;
      if (b) city.paintNode(b, 0.16);
      canvas.style.cursor = b ? 'pointer' : 'grab';
    }
  };
  const onDown = e => { downXY = [e.clientX, e.clientY]; };
  const onUp = e => {
    if (!downXY) return;
    const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]); downXY = null;
    if (moved > 5) return; // fue un arrastre de cámara
    setPtr(e); ray.setFromCamera(ptr, camera);
    const fileHit = ray.intersectObject(city.filesMesh)[0];
    const shellHit = ray.intersectObjects(city.shells)[0];
    if (fileHit && (!shellHit || fileHit.distance < shellHit.distance + 2)) {
      const f = model.files[fileHit.instanceId];
      if (f) onOpenFile(f.rel);
    } else if (shellHit) {
      // clic en un edificio (carpeta): centra la cámara en él
      const b = shellHit.object.userData.building;
      controls.target.set(b.box.cx, b.box.cy, b.box.cz);
    }
  };
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);

  const onResize = () => {
    const w = container.clientWidth || W, h = container.clientHeight || H;
    renderer.setSize(w, h, false); composer.setSize(w, h); bloom.resolution.set(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);

  let raf = null;
  const loop = () => { raf = requestAnimationFrame(loop); controls.update(); composer.render(); };
  loop();

  // Lo mismo que el lienzo, como lista (la monta main.js al lado): con teclado
  // o lector de pantalla una ciudad 3D no se puede recorrer. `locate` centra la
  // cámara en el edificio del fichero y lo resalta un momento.
  // ── actividad en directo ───────────────────────────────────────────────
  // Cada fichero que la elfa lee o escribe se enciende en la ciudad (escribir
  // más fuerte que leer) y se apaga solo, para que se vea la ruta del trabajo.
  // El registro muestra cada llamada al empezar y su resultado al acabar.
  const idPorRuta = new Map(model.files.map(f => [f.rel, f.id]));
  const apagados = new Map();
  const LINEAS_MAX = 80;
  const ENCENDIDO = { lee: 0.5, escribe: 1 };
  const apagaTodo = () => { for (const t of apagados.values()) clearTimeout(t); apagados.clear(); };

  const pinta = (ruta, modo) => {
    const id = idPorRuta.get(ruta);
    if (id == null) return;                     // fichero nuevo o fuera del escaneo
    try {
      city.paintFile?.(id, ENCENDIDO[modo] ?? 0.5);
      clearTimeout(apagados.get(id));
      apagados.set(id, setTimeout(() => {
        try { city.paintFile?.(id, 0); } catch { /* ya no está */ }
        apagados.delete(id);
      }, 3000));
    } catch { /* el resaltado es decorativo: no debe romper la vista */ }
  };
  const escribeLinea = txt => {
    if (!registro) return;
    registro.textContent += txt + '\n';
    const lineas = registro.textContent.split('\n');
    if (lineas.length > LINEAS_MAX) registro.textContent = lineas.slice(-LINEAS_MAX).join('\n');
    registro.scrollTop = registro.scrollHeight;
  };
  const quitarActividad = escuchar(ev => {
    if (ev.fase === 'inicio') {
      const donde = ev.ruta ? '  ' + ev.ruta : (ev.args?.query ? '  «' + ev.args.query + '»' : (ev.args?.command ? '  $ ' + ev.args.command : ''));
      escribeLinea('› ' + ev.herramienta + donde);
      if (ev.ruta) pinta(ev.ruta, ev.modo);
    } else {
      escribeLinea((ev.ok ? '  ✓ ' : '  ✗ ') + (ev.resumen || ''));
    }
  });

  let resaltado = null, apaga = null;
  const vista = {
    items: model.files.map(f => ({ path: f.rel, bytes: f.size ?? f.bytes ?? null })),
    locate(path) {
      const f = model.files.find(x => x.rel === path);
      if (!f?.box) return false;
      controls.target.set(f.box.cx, f.box.cy, f.box.cz);
      try {
        if (resaltado != null) city.paintFile?.(resaltado, 0);
        resaltado = f.id; city.paintFile?.(f.id, 1);
        clearTimeout(apaga); apaga = setTimeout(() => { try { city.paintFile?.(f.id, 0); } catch { /* ya no está */ } }, 2500);
      } catch { /* sin resaltado: la cámara ya apunta */ }
      return true;
    },
  };

  disposer = () => {
    quitarActividad();
    apagaTodo();
    clearTimeout(apaga);
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointerup', onUp);
    controls.dispose();
    city.dispose();
    composer.dispose?.();
    renderer.dispose();
  };
  return vista;
}

export function disposeCity() { if (disposer) { disposer(); disposer = null; } }
