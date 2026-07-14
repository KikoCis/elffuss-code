// Vista «Mente de Elffuss» — el pensamiento subyacente del cerebro CEO en un
// mundo 3D de fantasía psicodélica trance. v2:
//  · overlay PERSISTENTE (se oculta/mostra, no se destruye) → la música y la
//    animación NO reinician al salir y volver.
//  · las consolas de pensamiento FLOTAN en el mundo (ancladas a puntos 3D que
//    orbitan con la cámara).
//  · puntos/nodos CLICABLES: cada propuesta forjada es un nodo brillante; al
//    hacer clic se abre su .md (o el fichero que referencia).
//  · al abrir, carga lo que el cerebro YA generó (elffuss-mind/*.md).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as code from './tools/code.js';
import * as ceo from './ceo.js';

const SOUNDCLOUD = 'https://soundcloud.com/dekel-official/dekel-baoba-festival-2023';
const DEPTS = { arq: 'Arquitectura', cal: 'Calidad', rend: 'Rendimiento', dx: 'Producto/DX' };
const DEPT_POS = { // ancla 3D de cada consola (orbita con el mundo)
  ceo: [0, 46, 0], arq: [-70, 20, -30], cal: [70, 20, -30], rend: [-70, 8, 40], dx: [70, 8, 40],
};

let open = false, built = false, raf = null;
let overlay, S, widget, onOpenFile = () => {};
const consoles = new Map();
const anchors = [];            // { el, pos:THREE.Vector3 }
let nodesGroup, thoughtNodes = []; // nodos clicables (propuestas)

export function isOpen() { return open; }
export function setOpenFile(fn) { onOpenFile = fn; }

// ── música con Widget API (persistente: pausa al salir, reanuda al volver) ──
function mountMusic(root) {
  const wrap = document.createElement('div');
  wrap.className = 'mind-music';
  const url = 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(SOUNDCLOUD) +
    '&auto_play=true&hide_related=true&show_comments=false&show_user=false&show_reposts=false&visual=false&color=%23ff4d8d';
  wrap.innerHTML = '<iframe id="mind-sc" title="música" width="100%" height="120" frameborder="no" allow="autoplay" src="' + url + '"></iframe>' +
    '<div class="mind-music-cap">▶ Dekel · Baoba Festival — modo trance</div>';
  root.appendChild(wrap);
  const iframe = wrap.querySelector('#mind-sc');
  const initWidget = () => { try { widget = window.SC.Widget(iframe); } catch { /* aún no */ } };
  if (window.SC && window.SC.Widget) initWidget();
  else { const s = document.createElement('script'); s.src = 'https://w.soundcloud.com/player/api.js'; s.onload = initWidget; document.head.appendChild(s); }
}

function makeConsole(id, name, focus) {
  if (consoles.has(id)) return consoles.get(id);
  const el = document.createElement('div');
  el.className = 'mind-console c-' + id;
  el.innerHTML = `<div class="mc-head"><span class="mc-dot"></span>${name}<span class="mc-focus">${focus || ''}</span></div><div class="mc-body"></div>`;
  document.getElementById('mind-consoles').appendChild(el);
  const c = { el, body: el.querySelector('.mc-body') };
  consoles.set(id, c);
  // anclar la consola a su punto 3D (flota en el mundo)
  const pos = DEPT_POS[id] || [0, 0, 0];
  anchors.push({ el, pos: new THREE.Vector3(...pos) });
  return c;
}
function append(c, t) { c.body.textContent = (c.body.textContent + t).slice(-1400); c.body.scrollTop = c.body.scrollHeight; }

// alimenta las consolas + crea nodos clicables (ceo.js → aquí)
export function pushThought(channel, ev) {
  if (!open) return;
  if (channel === 'ceo') {
    const c = makeConsole('ceo', '★ CEO', 'reparte y sintetiza');
    if (ev.type === 'cycle') { c.body.textContent = ''; append(c, `● ${ev.text}\n`); }
    else if (ev.type === 'built') { append(c, `\n✦ ${ev.text}\n`); addThoughtNode(ev); }
    else append(c, `${ev.text}\n`);
    return;
  }
  if (channel === 'sys') { append(makeConsole('ceo', '★ CEO', ''), `· ${ev.text}\n`); return; }
  const c = makeConsole(channel, DEPTS[channel] || channel, ev.focus);
  if (ev.type === 'open') { c.body.textContent = ''; c.el.classList.add('active'); }
  else if (ev.type === 'token') append(c, ev.text);
  else if (ev.type === 'tool') append(c, `\n  ⟐ ${ev.text}\n`);
  else if (ev.type === 'done') { c.el.classList.remove('active'); c.el.classList.add('settled'); }
}

// ── nodos de pensamiento clicables (cada .md forjado = un punto brillante) ──
function addThoughtNode({ path, md, text }) {
  if (!nodesGroup) return;
  const i = thoughtNodes.length;
  const a = i * 2.399963; // ángulo áureo
  const r = 30 + i * 5;
  const mesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(3.2, 0),
    new THREE.MeshBasicMaterial({ color: 0xff4d8d, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
  mesh.position.set(Math.cos(a) * r, 6 + Math.sin(i * 0.7) * 10, Math.sin(a) * r);
  mesh.userData = { path, md, text };
  nodesGroup.add(mesh);
  thoughtNodes.push(mesh);
  // etiqueta flotante
  const lab = document.createElement('div');
  lab.className = 'mind-node-label';
  lab.textContent = (path || 'pensamiento').split('/').pop();
  document.getElementById('mind-consoles').appendChild(lab);
  anchors.push({ el: lab, pos: mesh.position });
  mesh.userData.label = lab;
}

// al abrir: cargar lo que el cerebro YA dejó en su carpeta-alma (recuperable)
async function loadExistingThoughts() {
  try {
    const soul = ceo.getSoulDir();
    let dir = code.handle();
    for (const seg of soul.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(seg);
    const files = [];
    for await (const e of dir.values()) if (e.kind === 'file' && e.name.endsWith('.md')) files.push(e);
    files.sort((a, b) => a.name.localeCompare(b.name));
    for (const f of files.slice(-24)) {
      const md = await (await f.getFile()).text();
      addThoughtNode({ path: soul + '/' + f.name, md });
    }
  } catch { /* aún no hay */ }
}

// panel flotante con el contenido del pensamiento .md
function showThoughtPanel(node) {
  const root = document.getElementById('mind-panel');
  const md = node.userData.md || node.userData.text || '(sin contenido)';
  const path = node.userData.path || 'pensamiento';
  root.innerHTML = `<div class="mp-head">${path}<button id="mp-x">✕</button></div>` +
    `<pre class="mp-body">${md.replace(/[<>&]/g, s => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[s]))}</pre>` +
    (node.userData.path ? `<button id="mp-open" class="mp-open">Abrir en el editor</button>` : '');
  root.classList.add('show');
  root.querySelector('#mp-x').onclick = () => root.classList.remove('show');
  const openBtn = root.querySelector('#mp-open');
  if (openBtn) openBtn.onclick = () => { onOpenFile(node.userData.path); root.classList.remove('show'); };
}

// panel de configuración: reprograma la MISIÓN del cerebro y su carpeta-alma
function wireConfig(root) {
  const btn = root.querySelector('#mind-config');
  const cfg = root.querySelector('#mind-cfg');
  const draw = () => {
    cfg.innerHTML =
      '<div class="cfg-head">⚙ Reprogramar el cerebro<button id="cfg-x">✕</button></div>' +
      '<label>Misión (qué quieres que haga por su cuenta)</label>' +
      '<textarea id="cfg-mission" rows="4">' + ceo.getMission().replace(/</g, '&lt;') + '</textarea>' +
      '<label>Carpeta-alma (dentro del proyecto)</label>' +
      '<input id="cfg-dir" value="' + ceo.getSoulDir() + '">' +
      '<button id="cfg-save" class="cfg-save">Reprogramar y crear skill de cerebro</button>' +
      '<div class="cfg-note">La elfa trabajará según esta misión cuando estés ocioso y volcará todo en esa carpeta.</div>';
    cfg.querySelector('#cfg-x').onclick = () => cfg.classList.remove('show');
    cfg.querySelector('#cfg-save').onclick = () => {
      ceo.setMission(cfg.querySelector('#cfg-mission').value);
      ceo.setSoulDir(cfg.querySelector('#cfg-dir').value);
      if (!ceo.isEnabled()) ceo.enable();
      cfg.classList.remove('show');
    };
  };
  btn.onclick = () => { if (cfg.classList.contains('show')) cfg.classList.remove('show'); else { draw(); cfg.classList.add('show'); } };
}

// ── mundo psicodélico ───────────────────────────────────────────────────────
function buildScene(canvas, W, H) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 2000);
  camera.position.set(0, 40, 150);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = 0.45;
  controls.enablePan = false; controls.minDistance = 60; controls.maxDistance = 400;

  const N = 14000;
  const pos = new Float32Array(N * 3), rad = new Float32Array(N);
  let s = 987654321; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < N; i++) {
    const arm = Math.floor(rnd() * 4);
    const r = Math.pow(rnd(), 0.6) * 120 + 6;
    const a = arm * (Math.PI / 2) + r * 0.03 + (rnd() - 0.5) * 0.5;
    const y = (rnd() - 0.5) * (14 - r * 0.06);
    pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = y; pos[i * 3 + 2] = Math.sin(a) * r; rad[i] = r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aRad', new THREE.BufferAttribute(rad, 1));
  // Mundo audio-reactivo con ruido FRACTAL (fbm): los MEDIOS (uMid) hacen vibrar
  // las partículas por fbm; los GRAVES (uBass) expanden/contraen el espacio.
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uBass: { value: 0 }, uMid: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float uTime, uBass, uMid; attribute float aRad; varying vec3 vC;
      vec3 hsv(float h){ vec3 k=vec3(1.,2./3.,1./3.); vec3 p=abs(fract(h+k)*6.-3.); return clamp(p-1.,0.,1.);}
      // hash + ruido de valor 3D + fbm (fractal, 4 octavas) — barato
      float hash(vec3 p){ p=fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float vnoise(vec3 x){ vec3 i=floor(x),f=fract(x); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
      float fbm(vec3 p){ float a=0.5,s=0.0; for(int i=0;i<4;i++){ s+=a*vnoise(p); p*=2.02; a*=0.5;} return s; }
      void main(){
        vec3 pos=position;
        float n=fbm(pos*0.03 + vec3(0.0,uTime*0.25,0.0));       // campo fractal que fluye
        // MEDIOS → vibración fractal fina · GRAVES → morphs GRANDES (el mundo se deforma en el kick)
        pos += normalize(pos+0.001) * (n-0.5) * (6.0 + uMid*24.0 + uBass*46.0);
        // remolino (vórtice) que se aprieta con los graves → sensación de túnel
        float sw = uTime*0.2 + aRad*0.02 + uBass*1.4;
        float cs=cos(sw), sn=sin(sw);
        pos.xz = mat2(cs,-sn,sn,cs) * pos.xz;
        pos *= (1.0 + uBass*0.30);                               // GRAVES → el espacio respira fuerte
        float h=fract(aRad*0.004+uTime*0.03+n*0.15); vC=hsv(h)*(1.3-aRad*0.004)*(0.85+uMid*0.7+uBass*0.5);
        vec4 mv=modelViewMatrix*vec4(pos,1.0); gl_PointSize=(2.2+60.0/-mv.z)*(1.0+uBass*0.7); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `varying vec3 vC; void main(){ vec2 d=gl_PointCoord-0.5; float m=smoothstep(0.5,0.0,length(d)); gl_FragColor=vec4(vC*2.0,m); }`,
  });
  const galaxy = new THREE.Points(geo, mat); scene.add(galaxy);
  const core = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(18, 1)),
    new THREE.LineBasicMaterial({ color: 0xff4d8d, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(core);
  // túnel/vórtice: anillos que suben por el eje y laten con los graves
  const rings = [];
  for (let i = 0; i < 24; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(22, 0.5, 8, 80),
      new THREE.MeshBasicMaterial({ color: 0x7c5cff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = Math.PI / 2; ring.position.y = -70 + i * 6; ring.userData.i = i;
    scene.add(ring); rings.push(ring);
  }
  nodesGroup = new THREE.Group(); scene.add(nodesGroup);
  const composer = new EffectComposer(renderer);
  composer.setSize(W, H); composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 1.1, 0.5, 0.2);
  composer.addPass(bloom); composer.addPass(new OutputPass());
  return { renderer, scene, camera, controls, composer, bloom, mat, galaxy, core, rings };
}

export async function openMind() {
  if (open) return;
  open = true;
  if (built) { overlay.style.display = ''; try { widget?.play(); } catch {} startLoop(); return; }

  overlay = document.createElement('div');
  overlay.id = 'mind-overlay';
  overlay.innerHTML =
    '<canvas id="mind-canvas"></canvas>' +
    '<div id="mind-title">MENTE DE ELFFUSS</div>' +
    '<button id="mind-config" title="reprogramar el cerebro">⚙ cerebro</button>' +
    '<button id="mind-close" title="salir">✕ salir</button>' +
    '<div id="mind-consoles"></div><div id="mind-panel"></div><div id="mind-cfg"></div>';
  document.body.appendChild(overlay);
  wireConfig(overlay);
  mountMusic(overlay);
  consoles.clear(); anchors.length = 0; thoughtNodes = [];

  const canvas = overlay.querySelector('#mind-canvas');
  S = buildScene(canvas, window.innerWidth, window.innerHeight);
  await loadExistingThoughts();

  // raycast: clic en un nodo de pensamiento → abre su panel
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let downXY = null;
  canvas.addEventListener('pointerdown', e => { downXY = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', e => {
    if (!downXY) return; const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]); downXY = null;
    if (moved > 5 || !thoughtNodes.length) return;
    ptr.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ptr, S.camera);
    const hit = ray.intersectObjects(thoughtNodes)[0];
    if (hit) showThoughtPanel(hit.object);
  });

  const onResize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    S.renderer.setSize(w, h, false); S.composer.setSize(w, h); S.bloom.resolution.set(w, h);
    S.camera.aspect = w / h; S.camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize); S.onResize = onResize;
  overlay.querySelector('#mind-close').addEventListener('click', closeMind);
  S.onKey = e => { if (e.key === 'Escape') closeMind(); };
  document.addEventListener('keydown', S.onKey);
  built = true;
  startLoop();
}

// proyecta las anclas 3D a la pantalla → las pantallas «flotan» en el mundo
function projectAnchors() {
  const w = window.innerWidth, h = window.innerHeight, v = new THREE.Vector3();
  for (const a of anchors) {
    v.copy(a.pos).project(S.camera);
    const behind = v.z > 1;
    a.el.style.display = behind ? 'none' : '';
    if (behind) continue;
    const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
    a.el.style.left = x + 'px'; a.el.style.top = y + 'px';
    a.el.style.transform = 'translate(-50%,-50%)';
  }
}

let startT = 0, elapsed = 0, lastMs = 0;
function startLoop() {
  if (raf) return;
  const loop = (ms) => {
    raf = requestAnimationFrame(loop);
    if (lastMs) elapsed += (ms - lastMs) / 1000; lastMs = ms;
    const t = elapsed;
    // envolventes de audio (simuladas a ritmo trance ~138 BPM; el audio de
    // SoundCloud es cross-origin y no se puede analizar por FFT).
    const beat = 60 / 138;                     // 0.4348 s
    const bp = (t % beat) / beat;
    const bass = Math.pow(1 - bp, 3);          // kick con caída aguda cada tiempo
    const mid = 0.5 + 0.5 * Math.sin(t * 9.2) * (0.6 + 0.4 * Math.sin(t * 0.73)); // shimmer de medios
    S.mat.uniforms.uTime.value = t;
    S.mat.uniforms.uBass.value = bass;
    S.mat.uniforms.uMid.value = mid;
    S.galaxy.rotation.y = t * 0.06;
    S.galaxy.scale.setScalar(1 + bass * 0.05);  // el espacio respira con los graves
    const pulse = 1 + bass * 0.2 + Math.sin(t * 1.6) * 0.05;
    S.core.scale.setScalar(pulse); S.core.rotation.y = t * 0.2; S.core.rotation.x = t * 0.12;
    S.core.material.color.setHSL((t * 0.05) % 1, 0.9, 0.6);
    // túnel/vórtice: los anillos suben, se aprietan y brillan con los graves
    for (const r of S.rings) {
      r.position.y += 0.35 + bass * 0.9;
      if (r.position.y > 74) r.position.y -= 144;
      const rs = 1 + bass * 0.5 + Math.sin(t * 1.2 + r.userData.i) * 0.06;
      r.scale.setScalar(rs);
      r.material.opacity = 0.22 + bass * 0.55;
      r.material.color.setHSL((t * 0.06 + r.userData.i * 0.03) % 1, 0.85, 0.6);
    }
    // punch de zoom en el kick (modulando el FOV, sin pelear con OrbitControls)
    S.camera.fov = 60 - bass * 9; S.camera.updateProjectionMatrix();
    for (let i = 0; i < thoughtNodes.length; i++) { const n = thoughtNodes[i]; n.rotation.y = t + i; n.scale.setScalar(1 + Math.sin(t * 2 + i) * 0.14); }
    S.controls.update();
    projectAnchors();
    S.composer.render();
  };
  loop(performance.now());
}

export function closeMind() {
  open = false;
  if (raf) { cancelAnimationFrame(raf); raf = null; }
  lastMs = 0;                       // congela el reloj de animación (reanuda donde iba)
  try { widget?.pause(); } catch {} // pausa la música conservando la posición
  if (overlay) overlay.style.display = 'none';
}
