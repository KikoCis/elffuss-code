// Vista «Mente de Elffuss» — la interfaz espectacular donde se ve el pensamiento
// subyacente del cerebro CEO: un mundo 3D de fantasía psicodélica (galaxia de
// partículas con hue animado + bloom), consolas flotantes con los pensamientos
// paralelos de cada departamento, y lo que va construyendo flotando en el
// centro. Música de fondo (SoundCloud) al entrar en el modo.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const SOUNDCLOUD = 'https://soundcloud.com/dekel-official/dekel-baoba-festival-2023';
const DEPTS = { arq: 'Arquitectura', cal: 'Calidad', rend: 'Rendimiento', dx: 'Producto/DX' };

let open = false, raf = null, disposer = null;
const consoles = new Map();

export function isOpen() { return open; }

// música: widget de SoundCloud (autoplay permitido porque se abre con un clic)
function mountMusic(root) {
  const wrap = document.createElement('div');
  wrap.className = 'mind-music';
  const url = 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(SOUNDCLOUD) +
    '&auto_play=true&hide_related=true&show_comments=false&show_user=false&show_reposts=false&visual=false&color=%23ff4d8d';
  wrap.innerHTML = '<iframe title="música" width="100%" height="120" frameborder="no" allow="autoplay" src="' + url + '"></iframe>' +
    '<div class="mind-music-cap">▶ Dekel · Baoba Festival — modo trance</div>';
  root.appendChild(wrap);
}

function makeConsole(root, id, name, focus) {
  if (consoles.has(id)) return consoles.get(id);
  const el = document.createElement('div');
  el.className = 'mind-console c-' + id;
  el.innerHTML = `<div class="mc-head"><span class="mc-dot"></span>${name}<span class="mc-focus">${focus || ''}</span></div><div class="mc-body"></div>`;
  root.appendChild(el);
  const c = { el, body: el.querySelector('.mc-body') };
  consoles.set(id, c);
  return c;
}

// alimenta las consolas con los eventos del cerebro CEO (ceo.js → aquí)
export function pushThought(channel, ev) {
  if (!open) return;
  const root = document.getElementById('mind-consoles');
  if (!root) return;
  if (channel === 'ceo') {
    const c = makeConsole(root, 'ceo', '★ CEO', 'reparte y sintetiza');
    if (ev.type === 'cycle') { c.body.textContent = ''; append(c, `● ${ev.text}\n`); }
    else if (ev.type === 'built') { append(c, `\n✦ ${ev.text}\n`); floatBuilt(ev); }
    else append(c, `${ev.text}\n`);
    return;
  }
  if (channel === 'sys') { const c = makeConsole(root, 'ceo', '★ CEO', ''); append(c, `· ${ev.text}\n`); return; }
  const c = makeConsole(root, channel, DEPTS[channel] || channel, ev.focus);
  if (ev.type === 'open') { c.body.textContent = ''; c.el.classList.add('active'); }
  else if (ev.type === 'token') append(c, ev.text);
  else if (ev.type === 'tool') append(c, `\n  ⟐ ${ev.text}\n`);
  else if (ev.type === 'done') { c.el.classList.remove('active'); c.el.classList.add('settled'); }
}
function append(c, t) { c.body.textContent = (c.body.textContent + t).slice(-1400); c.body.scrollTop = c.body.scrollHeight; }

// lo que construye flota en el centro un momento
function floatBuilt(ev) {
  const root = document.getElementById('mind-built');
  if (!root) return;
  const card = document.createElement('div');
  card.className = 'mind-built-card';
  const n = (ev.proposals || []).length;
  card.innerHTML = `<div class="mbc-title">✦ mejora forjada</div><div class="mbc-sub">${ev.text}</div><div class="mbc-n">${n} propuesta${n === 1 ? '' : 's'}</div>`;
  root.appendChild(card);
  setTimeout(() => card.classList.add('rise'), 40);
  setTimeout(() => card.remove(), 12000);
}

// ── mundo psicodélico (galaxia de partículas + cristal central + bloom) ──────
function buildScene(canvas, W, H) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 2000);
  camera.position.set(0, 40, 150);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.autoRotate = true; controls.autoRotateSpeed = 0.5;
  controls.enablePan = false; controls.minDistance = 60; controls.maxDistance = 400;
  controls.target.set(0, 0, 0);

  // galaxia: N partículas en espiral, color por hue animado en el shader
  const N = 14000;
  const pos = new Float32Array(N * 3), rad = new Float32Array(N), ang = new Float32Array(N);
  let s = 987654321; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < N; i++) {
    const arm = Math.floor(rnd() * 4);
    const r = Math.pow(rnd(), 0.6) * 120 + 6;
    const a = arm * (Math.PI * 2 / 4) + r * 0.03 + (rnd() - 0.5) * 0.5;
    const y = (rnd() - 0.5) * (14 - r * 0.06);
    pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = y; pos[i * 3 + 2] = Math.sin(a) * r;
    rad[i] = r; ang[i] = a;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aRad', new THREE.BufferAttribute(rad, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float uTime; attribute float aRad; varying vec3 vC;
      vec3 hsv(float h){ vec3 k=vec3(1.,2./3.,1./3.); vec3 p=abs(fract(h+k)*6.-3.); return clamp(p-1.,0.,1.); }
      void main(){
        float h = fract(aRad*0.004 + uTime*0.03);
        vC = hsv(h) * (1.3 - aRad*0.004);
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_PointSize = (2.2 + 60.0/ -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vC;
      void main(){ vec2 d = gl_PointCoord - 0.5; float m = smoothstep(0.5,0.0,length(d)); gl_FragColor = vec4(vC*2.0, m); }`,
  });
  const galaxy = new THREE.Points(geo, mat);
  scene.add(galaxy);

  // cristal central pulsante (icosaedro alámbrico) — el «núcleo» del pensamiento
  const core = new THREE.LineSegments(
    new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(18, 1)),
    new THREE.LineBasicMaterial({ color: 0xff4d8d, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(core);
  const halo = new THREE.Mesh(new THREE.IcosahedronGeometry(15, 1),
    new THREE.MeshBasicMaterial({ color: 0x7c5cff, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(halo);

  const composer = new EffectComposer(renderer);
  composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 1.1, 0.5, 0.2);
  composer.addPass(bloom); composer.addPass(new OutputPass());

  return { renderer, scene, camera, controls, composer, bloom, mat, galaxy, core, halo, geo };
}

export async function openMind() {
  if (open) return;
  open = true;
  const overlay = document.createElement('div');
  overlay.id = 'mind-overlay';
  overlay.innerHTML =
    '<canvas id="mind-canvas"></canvas>' +
    '<div id="mind-built"></div>' +
    '<div id="mind-title">MENTE DE ELFFUSS<span>pensamiento paralelo del cerebro CEO — mundo trance</span></div>' +
    '<button id="mind-close" title="salir">✕ salir</button>' +
    '<div id="mind-consoles"></div>';
  document.body.appendChild(overlay);
  mountMusic(overlay);
  consoles.clear();

  const canvas = overlay.querySelector('#mind-canvas');
  const W = window.innerWidth, H = window.innerHeight;
  const S = buildScene(canvas, W, H);

  const onResize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    S.renderer.setSize(w, h, false); S.composer.setSize(w, h); S.bloom.resolution.set(w, h);
    S.camera.aspect = w / h; S.camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);

  let t0 = 0;
  const loop = (ms) => {
    raf = requestAnimationFrame(loop);
    const t = ms / 1000; if (!t0) t0 = t; const dt = t - t0;
    S.mat.uniforms.uTime.value = dt;
    S.galaxy.rotation.y = dt * 0.06;
    const pulse = 1 + Math.sin(dt * 1.6) * 0.08;
    S.core.scale.setScalar(pulse); S.core.rotation.y = dt * 0.2; S.core.rotation.x = dt * 0.12;
    S.halo.scale.setScalar(pulse * 1.05 + Math.sin(dt * 2.3) * 0.1);
    S.core.material.color.setHSL((dt * 0.05) % 1, 0.9, 0.6);
    S.controls.update();
    S.composer.render();
  };
  loop(0);

  const close = () => closeMind();
  overlay.querySelector('#mind-close').addEventListener('click', close);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  disposer = () => {
    if (raf) cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('keydown', onKey);
    S.controls.dispose(); S.geo.dispose(); S.mat.dispose(); S.composer.dispose?.(); S.renderer.dispose();
    overlay.remove();
    consoles.clear();
  };
}

export function closeMind() { if (disposer) { disposer(); disposer = null; } open = false; }
