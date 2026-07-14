// Construcción de la escena: ciudad de cristal nítida.
// Receta anti-difuminado: aristas finas con colores HDR (el bloom solo se
// dispara en lo resaltado), cristal con fresnel de opacidad mínima y nada
// de volúmenes aditivos permanentes.
// Toda la paleta viene del tema activo (src/themes.js); los temas claros
// usan blending normal en lugar de aditivo.
import * as THREE from 'three';

function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function configureCanvasTexture(tx) {
  tx.colorSpace = THREE.SRGBColorSpace;
  tx.anisotropy = 8;
  // Las texturas son texto fino sobre fondo transparente. Sin mipmaps, los
  // píxeles transparentes no se mezclan con negro al orbitar y solaparse.
  tx.generateMipmaps = false;
  tx.minFilter = THREE.LinearFilter;
  tx.magFilter = THREE.LinearFilter;
  return tx;
}

// 12 aristas de una caja → 24 vértices
const EDGE_PAIRS = [
  [0, 1], [1, 3], [3, 2], [2, 0],
  [4, 5], [5, 7], [7, 6], [6, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];
function corners(b) {
  const x0 = b.cx - b.sx / 2, x1 = b.cx + b.sx / 2;
  const y0 = b.cy - b.sy / 2, y1 = b.cy + b.sy / 2;
  const z0 = b.cz - b.sz / 2, z1 = b.cz + b.sz / 2;
  return [
    [x0, y0, z0], [x1, y0, z0], [x0, y0, z1], [x1, y0, z1],
    [x0, y1, z0], [x1, y1, z0], [x0, y1, z1], [x1, y1, z1],
  ];
}

// ── suelo: placa de circuito impreso ──────────────────────────────────────
function circuitTexture(theme) {
  const T = theme.ground;
  const S = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = T.bg;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = T.grid;
  g.lineWidth = 1;
  for (let i = 0; i <= S; i += 64) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(S, i); g.stroke();
  }
  const rnd = (() => { let s = 1234567; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  for (let i = 0; i < 260; i++) {
    const isA = rnd() < 0.58;
    const a = 0.18 + rnd() * 0.5;
    const [tr, tg, tb] = isA ? T.traceA : T.traceB;
    g.strokeStyle = `rgba(${tr}, ${tg}, ${tb}, ${isA ? a : a * 0.9})`;
    g.lineWidth = rnd() < 0.12 ? 3 : 1.4;
    let x = rnd() * S, y = rnd() * S;
    g.beginPath(); g.moveTo(x, y);
    const segs = 2 + Math.floor(rnd() * 4);
    for (let sg = 0; sg < segs; sg++) {
      const len = 24 + rnd() * 150;
      if (rnd() < 0.5) x += rnd() < 0.5 ? len : -len; else y += rnd() < 0.5 ? len : -len;
      g.lineTo(x, y);
    }
    g.stroke();
    const [pr, pg, pb] = isA ? T.padA : T.padB;
    g.fillStyle = `rgba(${pr}, ${pg}, ${pb}, ${a + 0.2})`;
    const ps = 2 + rnd() * 3;
    g.fillRect(x - ps / 2, y - ps / 2, ps, ps);
  }
  const tx = new THREE.CanvasTexture(cv);
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  tx.colorSpace = THREE.SRGBColorSpace;
  tx.anisotropy = 8;
  return tx;
}

// ── cristal con fresnel (bordes algo más vivos, centro casi invisible) ────
function glassMaterial(theme, dim = 1, solid = 0) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(...theme.glass) },
      uHi: { value: new THREE.Color(...theme.glassHi) },
      uGlow: { value: 0 },
      uDim: { value: dim },
      uSolid: { value: solid },
    },
    vertexShader: /* glsl */`
      varying vec3 vN, vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalMatrix * normal;
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      uniform vec3 uHi;
      uniform float uGlow;
      uniform float uDim;
      uniform float uSolid;
      varying vec3 vN, vV;
      void main() {
        float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.6);
        vec3 col = mix(uColor, uHi, uGlow);
        float alpha = (0.022 + fr * 0.12 + uSolid * 0.12) * uDim + uGlow * 0.05;
        gl_FragColor = vec4(col * ((0.5 + fr * 1.9) * uDim + uGlow), alpha);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ── fachada: árbol de ficheros impreso sobre el cristal ───────────────────
const FACADE_MAX_LINES = 150;

function facadeLines(building) {
  const lines = [];
  let overflow = false;
  (function walk(node, depth) {
    if (lines.length > FACADE_MAX_LINES) { overflow = true; return; }
    lines.push({ text: node.name + '/', depth, key: 'n' + node.id });
    for (const c of node.children) walk(c, depth + 1);
    for (const fid of node.fileIds) {
      if (lines.length > FACADE_MAX_LINES) { overflow = true; return; }
      const f = building.modelFiles[fid];
      lines.push({ text: f.name, depth: depth + 1, key: 'f' + f.id });
    }
  })(building, 0);
  if (overflow) lines.push({ text: '· · ·', depth: 1, key: '' });
  return lines;
}

function drawFacade(building, highlight, theme) {
  const cv = building.facadeCanvas;
  if (!cv) return; // edificio sin fachada (recorte en ciudades enormes)
  const g = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  const lines = building.facadeLineCache;
  const fs = Math.max(9, Math.min(30, (H - 60) / (lines.length + 1)));
  g.font = `${fs}px "JetBrains Mono", "Cascadia Code", monospace`;
  g.textBaseline = 'top';
  let y = 26;
  for (const ln of lines) {
    const x = 22 + ln.depth * fs * 1.1;
    const hot = highlight && highlight.has(ln.key);
    if (hot) {
      g.shadowColor = theme.facade.hotGlow;
      g.shadowBlur = 14;
      g.fillStyle = theme.facade.hotBg;
      g.fillRect(x - 6, y - 3, g.measureText(ln.text).width + 12, fs + 6);
      g.fillStyle = theme.facade.hot;
    } else {
      g.shadowBlur = 0;
      g.fillStyle = theme.facade.text;
    }
    g.fillText(ln.text, x, y);
    y += fs * 1.18;
    if (y > H - fs) break;
  }
  g.shadowBlur = 0;
  building.facadeTexture.needsUpdate = true;
}

function buildFacade(building, model, group, theme) {
  building.modelFiles = model.files;
  building.facadeLineCache = facadeLines(building);
  const b = building.box;
  const H = 1024;
  const W = Math.round(Math.min(2048, Math.max(256, H * (b.sx / b.sy))));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  building.facadeCanvas = cv;
  const tx = configureCanvasTexture(new THREE.CanvasTexture(cv));
  building.facadeTexture = tx;
  drawFacade(building, null, theme);
  const mat = new THREE.MeshBasicMaterial({
    map: tx, transparent: true, alphaTest: 0.025, depthWrite: false, side: THREE.FrontSide,
    blending: theme.light ? THREE.NormalBlending : THREE.AdditiveBlending,
  });
  mat.userData.vccKind = 'facade';
  const E = 0.14;
  const faces = [
    { w: b.sx, pos: [b.cx, b.cy, b.cz + b.sz / 2 + E], rot: 0 },
    { w: b.sx, pos: [b.cx, b.cy, b.cz - b.sz / 2 - E], rot: Math.PI },
    { w: b.sz, pos: [b.cx + b.sx / 2 + E, b.cy, b.cz], rot: Math.PI / 2 },
    { w: b.sz, pos: [b.cx - b.sx / 2 - E, b.cy, b.cz], rot: -Math.PI / 2 },
  ];
  for (const f of faces) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(f.w, b.sy), mat);
    plane.position.set(...f.pos);
    plane.rotation.y = f.rot;
    plane.renderOrder = 3;
    group.add(plane);
  }
}

// ── leyenda: nombres serigrafiados (suelo de distrito y tejado) ───────────
function labelTexture(text, color) {
  const fs = 96, pad = 40;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = `bold ${fs}px "JetBrains Mono", monospace`;
  const tw = probe.measureText(text).width;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(tw + pad * 2 + 220);
  cv.height = 190;
  const g = cv.getContext('2d');
  g.font = `bold ${fs}px "JetBrains Mono", monospace`;
  g.textBaseline = 'middle';
  // pista de circuito: línea con pads a ambos lados del texto
  g.strokeStyle = color; g.globalAlpha = 0.65; g.lineWidth = 5;
  const y = cv.height / 2;
  g.beginPath(); g.moveTo(14, y); g.lineTo(pad + 60, y); g.stroke();
  g.beginPath(); g.moveTo(pad + 100 + tw, y); g.lineTo(cv.width - 14, y); g.stroke();
  g.fillStyle = color;
  for (const px of [14, pad + 60, pad + 100 + tw, cv.width - 26]) g.fillRect(px - 7, y - 7, 14, 14);
  g.globalAlpha = 0.92;
  g.shadowColor = color; g.shadowBlur = 16;
  g.fillText(text, pad + 80, y);
  const tx = configureCanvasTexture(new THREE.CanvasTexture(cv));
  return { tx, aspect: cv.width / cv.height };
}

const LEGEND_MAX_BUILDINGS = 400;

function buildLegend(model, labeled, theme) {
  const legend = new THREE.Group();
  const add = (text, color, width, pos, flat) => {
    const { tx, aspect } = labelTexture(text, color);
    const w = Math.min(width, aspect * 8);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, w / aspect),
      new THREE.MeshBasicMaterial({
        map: tx, transparent: true, alphaTest: 0.025, depthWrite: false,
        blending: theme.light ? THREE.NormalBlending : THREE.AdditiveBlending,
      }),
    );
    mesh.material.userData.vccKind = 'label';
    if (flat) mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(...pos);
    mesh.renderOrder = 4;
    legend.add(mesh);
  };
  for (const di of model.districts) {
    add(di.name, theme.labels.district, di.box.sx * 0.85,
      [di.box.cx, 0.3, di.box.cz + di.box.sz / 2 - 2], true);
  }
  // urbanizaciones: mismo serigrafiado de suelo que los distritos, en tono
  // intermedio; en monorepos se etiquetan las de mayor superficie
  const urbs = [...model.urbs].sort((a, b) => b.box.sx * b.box.sz - a.box.sx * a.box.sz);
  for (const u of urbs.slice(0, LEGEND_MAX_BUILDINGS)) {
    add(u.name, theme.labels.urb, u.box.sx * 0.8,
      [u.box.cx, 0.32, u.box.cz + u.box.sz / 2 - 1.4], true);
  }
  for (const b of labeled.slice(0, LEGEND_MAX_BUILDINGS)) {
    if (b.isBasement) continue; // su tejado es la calle: sin etiqueta
    add(b.name, theme.labels.building, b.box.sx * 0.95,
      [b.box.cx, b.box.cy + b.box.sy / 2 + 0.12, b.box.cz], true);
  }
  return legend;
}

// ── ciudad completa ───────────────────────────────────────────────────────
export function buildCity(scene, model, theme) {
  const group = new THREE.Group();
  scene.add(group);
  // paleta del tema; en temas claros el blending aditivo no funciona
  const ROLE_COLOR = theme.roleColor;
  const HI = theme.hi;
  const FILE_BASE = theme.fileBase;
  const FILE_HI = theme.fileHi;
  const BLEND = theme.light ? THREE.NormalBlending : THREE.AdditiveBlending;

  // suelo
  const extent = Math.max(model.city.box.sx, model.city.box.sz);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(extent * 7, extent * 7),
    // semitransparente y a doble cara: los sótanos (ficheros ignorados)
    // se intuyen a través del plano de circuitos. depthWrite: false — era el
    // único material que escribía profundidad y, con el rango near/far de la
    // ciudad, las plotas y serigrafías a ras de suelo hacían z-fighting
    // (parpadeo en franjas) al mover la cámara
    new THREE.MeshBasicMaterial({
      map: circuitTexture(theme), transparent: true, opacity: 0.8, side: THREE.DoubleSide,
      depthWrite: false,
      // separa el suelo en el z-buffer de plotas y serigrafías a ras de
      // suelo (evita el z-fighting cuando el modo opaco activa depthWrite)
      polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2,
    }),
  );
  ground.material.map.repeat.set(7, 7);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  group.add(ground);

  // aristas de las cajas en un único buffer con rangos por nodo.
  // LOD por presupuesto para monorepos: decenas de miles de wireframes
  // aditivos se acumulan en blanco. Distritos y edificios siempre dibujan;
  // del interior se conservan las cajas más grandes y menos profundas.
  const LINE_BUDGET = 12000;
  const ROLE_DEPTH = { distrito: 0, urbanizacion: 0, edificio: 0, planta: 1, apartamento: 2, habitacion: 3, archivador: 4, cajon: 5 };
  const candidates = model.nodes.filter(n => n.role !== 'ciudad' && n.box);
  let boxNodes = candidates;
  if (candidates.length > LINE_BUDGET) {
    const score = (n) => (n.role === 'distrito' || n.role === 'urbanizacion' || n.role === 'edificio')
      ? Infinity
      : Math.max(n.box.sx, n.box.sy, n.box.sz) - ROLE_DEPTH[n.role] * 3;
    boxNodes = candidates.sort((a, b) => score(b) - score(a)).slice(0, LINE_BUDGET);
  }
  const positions = new Float32Array(boxNodes.length * 24 * 3);
  const colors = new Float32Array(boxNodes.length * 24 * 3);
  // brillo de arista normalizado por edificio: el interior de un edificio
  // reparte un presupuesto de luz constante (mismo principio que las celdas)
  const boxesPerBuilding = new Map();
  for (const n of boxNodes) {
    if (n.building && n.building !== n) {
      boxesPerBuilding.set(n.building.id, (boxesPerBuilding.get(n.building.id) ?? 0) + 1);
    }
  }
  // …y una atenuación global suave en ciudades con miles de edificios:
  // uniforme (todos los edificios conservan el mismo aspecto entre sí),
  // solo evita que la acumulación aditiva a vista de pájaro se queme
  const cityDim = Math.min(1, Math.max(0.45, Math.sqrt(900 / Math.max(model.buildings.length, 1))));
  for (const n of boxNodes) {
    const local = (!n.building || n.building === n)
      ? 1
      : Math.min(1, Math.max(0.12, 30 / (boxesPerBuilding.get(n.building.id) ?? 1)));
    // las plotas (distrito y urbanización) son solo perímetro: siempre nítidas
    n.lineDim = (n.role === 'distrito' || n.role === 'urbanizacion') ? 1 : local * cityDim;
  }

  let v = 0;
  for (const node of boxNodes) {
    node.lineStart = v;
    const cs = corners(node.box);
    const base = (ROLE_COLOR[node.role] ?? ROLE_COLOR.cajon).map(c => c * node.lineDim);
    node.baseColor = base;
    for (const [a, b] of EDGE_PAIRS) {
      for (const p of [cs[a], cs[b]]) {
        positions[v * 3] = p[0]; positions[v * 3 + 1] = p[1]; positions[v * 3 + 2] = p[2];
        colors[v * 3] = base[0]; colors[v * 3 + 1] = base[1]; colors[v * 3 + 2] = base[2];
        v++;
      }
    }
  }
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  lineGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  lineGeo.computeBoundingSphere();
  // opacidad adaptativa: cuantas más cajas, más tenue cada arista
  const lineOpacity = Math.min(0.95, Math.max(0.4, Math.sqrt(4000 / Math.max(boxNodes.length, 1))));
  const lineBaseOpacity = lineOpacity;
  const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: lineOpacity,
    blending: BLEND, depthWrite: false,
  }));
  lines.renderOrder = 2;
  group.add(lines);

  // carcasas de cristal por edificio (también sirven para el raycast).
  // En ciudades enormes las fachadas con texto se reservan a los edificios
  // más grandes (una textura canvas por edificio no escala a miles).
  const byArea = [...model.buildings].sort(
    (a, b) => b.box.sx * b.box.sz - a.box.sx * a.box.sz);
  const facadeSet = new Set(byArea.slice(0, 250));
  const shells = [];
  for (const b of model.buildings) {
    const mat = glassMaterial(theme, cityDim, b.onlyBasement ? 1 : 0);
    mat.userData.baseDim = cityDim;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.box.sx, b.box.sy, b.box.sz), mat);
    mesh.position.set(b.box.cx, b.box.cy, b.box.cz);
    mesh.renderOrder = 1;
    mesh.userData.building = b;
    b.shell = mesh;
    shells.push(mesh);
    group.add(mesh);
    if (facadeSet.has(b)) buildFacade(b, model, group, theme);
  }

  // forjados de las plantas (losa fina, casi invisible); con tope en
  // monorepos, priorizando las plantas de mayor superficie
  let slabNodes = model.nodes.filter(n => n.role === 'planta');
  if (slabNodes.length > 4000) {
    slabNodes = slabNodes
      .sort((a, b) => b.box.sx * b.box.sz - a.box.sx * a.box.sz)
      .slice(0, 4000);
  }
  if (slabNodes.length) {
    const slabGeo = new THREE.BoxGeometry(1, 1, 1);
    const slabMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(...theme.slab), transparent: true,
      opacity: Math.min(0.045, 0.045 * Math.sqrt(1500 / slabNodes.length)),
      depthWrite: false, blending: BLEND,
    });
    const slabs = new THREE.InstancedMesh(slabGeo, slabMat, slabNodes.length);
    const m = new THREE.Matrix4();
    slabNodes.forEach((n, i) => {
      m.makeScale(n.box.sx, 0.12, n.box.sz);
      m.setPosition(n.box.cx, n.box.cy - n.box.sy / 2, n.box.cz);
      slabs.setMatrixAt(i, m);
    });
    slabs.computeBoundingSphere();
    slabs.renderOrder = 1;
    group.add(slabs);
  }

  // celdas de fichero (instanciadas)
  const fileGeo = new THREE.BoxGeometry(1, 1, 1);
  const fileMat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0.9, depthWrite: false, blending: BLEND,
  });
  const fileBaseOpacity = fileMat.opacity;
  const filesMesh = new THREE.InstancedMesh(fileGeo, fileMat, model.files.length);
  {
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    for (const f of model.files) {
      m.makeScale(f.box.sx, f.box.sy, f.box.sz);
      m.setPosition(f.box.cx, f.box.cy, f.box.cz);
      filesMesh.setMatrixAt(f.id, m);
      filesMesh.setColorAt(f.id, c.setRGB(...FILE_BASE));
    }
    filesMesh.instanceColor.needsUpdate = true;
    filesMesh.computeBoundingSphere();
  }
  filesMesh.renderOrder = 2;
  group.add(filesMesh);

  // cajas de relleno para los niveles encendidos (pool reutilizable)
  const fillPool = [];
  for (let i = 0; i < 10; i++) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(...theme.fill), transparent: true, opacity: 0,
        depthWrite: false, blending: BLEND,
      }),
    );
    mesh.visible = false;
    mesh.renderOrder = 2;
    group.add(mesh);
    fillPool.push(mesh);
  }

  // ── API de iluminación ──────────────────────────────────────────────
  const touchedNodes = new Set();
  const touchedFiles = new Set();
  const colorAttr = lineGeo.getAttribute('color');
  const tmpColor = new THREE.Color();
  // atenuación normalizada por edificio: cada edificio reparte un presupuesto
  // de luz constante entre sus celdas — así un rascacielos con 50k ficheros
  // no se quema y uno con 20 sigue viéndose igual que antes
  const filesPerBuilding = new Map();
  for (const f of model.files) {
    const b = f.node.building;
    if (b) filesPerBuilding.set(b.id, (filesPerBuilding.get(b.id) ?? 0) + 1);
  }
  const dimOf = (f) => {
    const n = filesPerBuilding.get(f.node.building?.id) ?? 1;
    return Math.min(1, Math.max(0.05, 350 / n)) * cityDim;
  };
  // color base por fichero, reescribible por los modos de coloreado
  const fileBase = model.files.map(f => FILE_BASE.map(c => c * dimOf(f)));

  function paintNode(node, glow, hi = HI) {
    // los nodos diminutos no tienen aristas (LOD): solo carcasa/relleno
    if (node.lineStart !== undefined) {
      const col = lerp3(node.baseColor, hi, Math.pow(glow, 1.35));
      for (let i = node.lineStart; i < node.lineStart + 24; i++) {
        colorAttr.array[i * 3] = col[0];
        colorAttr.array[i * 3 + 1] = col[1];
        colorAttr.array[i * 3 + 2] = col[2];
      }
      // subida parcial: en monorepos el buffer completo pesa decenas de MB
      colorAttr.addUpdateRange(node.lineStart * 3, 72);
      colorAttr.needsUpdate = true;
    }
    if (node.shell) node.shell.material.uniforms.uGlow.value = glow * 0.3;
    if (glow > 0.01) touchedNodes.add(node); else touchedNodes.delete(node);
  }

  function paintFile(fileId, glow, hi = FILE_HI) {
    const col = lerp3(fileBase[fileId], hi, glow);
    filesMesh.setColorAt(fileId, tmpColor.setRGB(...col));
    filesMesh.instanceColor.addUpdateRange(fileId * 3, 3);
    filesMesh.instanceColor.needsUpdate = true;
    if (glow > 0.01) touchedFiles.add(fileId); else touchedFiles.delete(fileId);
  }

  function clearGlows() {
    for (const n of [...touchedNodes]) paintNode(n, 0);
    for (const f of [...touchedFiles]) paintFile(f, 0);
    for (const mesh of fillPool) mesh.visible = false;
  }

  // haces del modo Blast: del fichero seleccionado a sus relacionados,
  // con pulsos viajando por la línea como paquetes de datos
  let blastBeams = null;
  function setBlastBeams(pairs) {
    if (blastBeams) {
      group.remove(blastBeams);
      blastBeams.geometry.dispose();
      blastBeams.material.dispose();
      blastBeams = null;
    }
    if (!pairs?.length) return;
    // pairs: { a, b, impact } — impact=true: b depende del seleccionado
    // (consecuencias de un cambio); el pulso siempre viaja en el sentido de
    // la propagación: hacia fuera en impactos, hacia dentro en dependencias
    const pos = new Float32Array(pairs.length * 6);
    const dist = new Float32Array(pairs.length * 2);
    const dir = new Float32Array(pairs.length * 2);
    pairs.forEach(({ a, b, impact }, i) => {
      pos.set(a, i * 6);
      pos.set(b, i * 6 + 3);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      dist[i * 2] = impact ? 0 : len;
      dist[i * 2 + 1] = impact ? len : 0;
      dir[i * 2] = dir[i * 2 + 1] = impact ? 1 : 0;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aDist', new THREE.BufferAttribute(dist, 1));
    geo.setAttribute('aDir', new THREE.BufferAttribute(dir, 1));
    blastBeams = new THREE.LineSegments(geo, new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(...theme.beam) },
        uColorIn: { value: new THREE.Color(...(theme.beamIn ?? theme.beam)) },
      },
      vertexShader: /* glsl */`
        attribute float aDist;
        attribute float aDir;
        varying float vD;
        varying float vDir;
        void main() {
          vD = aDist;
          vDir = aDir;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime;
        uniform vec3 uColor;
        uniform vec3 uColorIn;
        varying float vD;
        varying float vDir;
        void main() {
          // tren de pulsos avanzando por la línea (cada ~8 unidades); la
          // línea base se mantiene bien visible entre pulsos
          float w = fract(vD * 0.125 - uTime * 1.4);
          float pulse = exp(-pow((w - 0.2) * 6.0, 2.0));
          vec3 col = mix(uColor, uColorIn, vDir);
          gl_FragColor = vec4(col * (0.6 + pulse * 2.4), 0.5 + pulse * 0.5);
        }`,
      transparent: true,
      blending: BLEND,
      depthWrite: false,
    }));
    blastBeams.renderOrder = 3;
    group.add(blastBeams);
  }

  function tickBeams(timeMs) {
    if (blastBeams) blastBeams.material.uniforms.uTime.value = timeMs / 1000;
  }

  // modos de coloreado: reescribe los colores base de nodos y ficheros
  // (fileColorFn/nodeColorFn → [r,g,b] o null para el color por defecto)
  function setModeColors(fileColorFn, nodeColorFn) {
    for (const node of boxNodes) {
      const col = nodeColorFn?.(node) ?? (ROLE_COLOR[node.role] ?? ROLE_COLOR.cajon);
      node.baseColor = col.map(c => c * (node.lineDim ?? 1));
      paintNode(node, 0);
    }
    for (const f of model.files) {
      const dim = dimOf(f);
      const col = fileColorFn?.(f) ?? FILE_BASE;
      fileBase[f.id] = col.map(c => c * dim);
      paintFile(f.id, 0);
    }
    // se ha tocado todo: mejor una única subida completa que miles de rangos
    colorAttr.clearUpdateRanges();
    filesMesh.instanceColor.clearUpdateRanges();
  }

  function fillBoxes(boxesWithGlow) {
    fillPool.forEach((mesh, i) => {
      const entry = boxesWithGlow[i];
      if (!entry) { mesh.visible = false; return; }
      const { box, glow } = entry;
      mesh.scale.set(box.sx, box.sy, box.sz);
      mesh.position.set(box.cx, box.cy, box.cz);
      mesh.material.opacity = 0.008 + glow * 0.045;
      mesh.visible = true;
    });
  }

  // leyenda serigrafiada (conmutable)
  const legend = buildLegend(model, byArea, theme);
  group.add(legend);

  let groundOpaque = false;
  const groundBaseOpacity = 0.8;
  let visualSettings = {};
  function setVisuals(v = {}) {
    visualSettings = { ...visualSettings, ...v };
    const linesMul = visualSettings.lines ?? 1;
    const filesMul = visualSettings.files ?? 1;
    const glassMul = visualSettings.glass ?? 1;
    const facadeMul = visualSettings.facades ?? 1;
    const labelMul = visualSettings.labels ?? 1;
    const groundMul = visualSettings.ground ?? 1;

    lines.material.opacity = Math.min(1, lineBaseOpacity * linesMul);
    fileMat.opacity = Math.min(1, fileBaseOpacity * filesMul);
    if (!groundOpaque) ground.material.opacity = Math.min(1, groundBaseOpacity * groundMul);

    for (const shell of shells) {
      const mat = shell.material;
      mat.uniforms.uDim.value = (mat.userData.baseDim ?? cityDim) * glassMul;
    }
    group.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const mat of mats) {
        if (mat?.userData?.vccKind === 'facade') mat.opacity = Math.min(1, facadeMul);
        if (mat?.userData?.vccKind === 'label') mat.opacity = Math.min(1, labelMul);
      }
    });
  }

  function dispose() {
    scene.remove(group);
    const geometries = new Set();
    const materials = new Set();
    group.traverse((o) => {
      if (o.geometry) geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (m) materials.add(m);
      }
    });
    for (const g of geometries) g.dispose();
    for (const m of materials) {
      m.map?.dispose?.();
      m.dispose();
    }
  }

  return {
    group, lines, shells, filesMesh, ground, legend,
    paintNode, paintFile, clearGlows, fillBoxes, dispose, setModeColors, setBlastBeams, tickBeams, setVisuals,
    setLegend: (v) => { legend.visible = v; },
    // suelo opaco/translúcido. Opaco = escribe profundidad y se dibuja en la
    // pasada de opacos: oculta de verdad los sótanos (ficheros ignorados)
    setGroundOpaque: (v) => {
      groundOpaque = v;
      const m = ground.material;
      m.opacity = v ? 1 : Math.min(1, groundBaseOpacity * (visualSettings.ground ?? 1));
      m.transparent = !v;
      m.depthWrite = v;
      m.needsUpdate = true;
    },
    redrawFacade: (building, highlightKeys) => drawFacade(building, highlightKeys, theme),
  };
}
