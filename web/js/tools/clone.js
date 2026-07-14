// Descarga un repo PÚBLICO (GitHub/Bitbucket) en una carpeta real elegida por
// el usuario, para abrirlo como proyecto sin necesitar git instalado. Mismo
// patrón que skills.js: árbol de Git vía API + contenidos por raw CDN (sin
// tope de la API, solo la llamada al árbol cuenta contra el límite 60/h).
//
// RESUMIBLE por diseño: listRepo() (el árbol) y downloadFiles() (los ficheros)
// están separados a propósito — quien llama (main.js) persiste la lista y qué
// rutas ya se descargaron, así una descarga interrumpida (recarga, pestaña
// cerrada) continúa donde se quedó en vez de volver a empezar.
const MAX_FILES = 4000;
const MAX_FILE_BYTES = 4 * 1024 * 1024; // ficheros más grandes se saltan (binarios enormes)
const CONCURRENCY = 10;

export function parseRepoUrl(raw) {
  const url = String(raw || '').trim().replace(/\.git$/, '').replace(/\/+$/, '');
  let m = url.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)(?:\/tree\/([\w./-]+))?/i);
  if (m) return { host: 'github', owner: m[1], repo: m[2], branch: m[3] || null };
  m = url.match(/^(?:https?:\/\/)?(?:www\.)?bitbucket\.org\/([\w.-]+)\/([\w.-]+)(?:\/src\/([\w./-]+))?/i);
  if (m) return { host: 'bitbucket', owner: m[1], repo: m[2], branch: m[3] || null };
  throw new Error('URL no reconocida. Usa github.com/usuario/repo o bitbucket.org/usuario/repo');
}

// escribe un fichero (texto o binario) en `root`, creando subcarpetas
async function writeInto(root, path, blob) {
  const parts = path.split('/'); const name = parts.pop();
  let dir = root;
  for (const seg of parts) dir = await dir.getDirectoryHandle(seg, { create: true });
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
}

// pool de concurrencia simple: corre `items` a través de `worker`, máx N a la vez
async function pool(items, n, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await worker(items[i++]);
  });
  await Promise.all(runners);
}

// ── listar (una sola vez, resultado persistible) ─────────────────────────
async function listGithubFiles({ owner, repo, branch }) {
  if (!branch) {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
    if (r.status === 403) throw new Error('GitHub limitó las peticiones (60/h sin login). Reintenta en unos minutos.');
    if (!r.ok) throw new Error(`Repo no encontrado o privado (HTTP ${r.status})`);
    branch = (await r.json()).default_branch || 'main';
  }
  let tree = null;
  for (const b of [branch, 'main', 'master']) {
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${b}?recursive=1`);
    if (r.ok) { tree = (await r.json()).tree || []; branch = b; break; }
    if (r.status === 403) throw new Error('GitHub limitó las peticiones (60/h sin login). Reintenta en unos minutos.');
  }
  if (!tree) throw new Error('No pude leer el árbol del repo');
  const blobs = tree.filter(n => n.type === 'blob');
  const files = blobs.filter(n => !n.size || n.size <= MAX_FILE_BYTES).slice(0, MAX_FILES).map(n => ({ path: n.path, size: n.size || 0 }));
  return { branch, files, skipped: blobs.length - files.length };
}
// Bitbucket no tiene un único endpoint de árbol recursivo: se camina por directorios.
async function bitbucketWalk(owner, repo, branch, path, files) {
  if (files.length >= MAX_FILES) return;
  let url = `https://api.bitbucket.org/2.0/repositories/${owner}/${repo}/src/${branch}/${path}?pagelen=100`;
  while (url && files.length < MAX_FILES) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Bitbucket: HTTP ${r.status} (¿repo privado o rama incorrecta?)`);
    const data = await r.json();
    for (const e of data.values || []) {
      if (files.length >= MAX_FILES) break;
      if (e.type === 'commit_directory') await bitbucketWalk(owner, repo, branch, e.path, files);
      else if (e.type === 'commit_file' && (!e.size || e.size <= MAX_FILE_BYTES)) files.push({ path: e.path, size: e.size || 0 });
    }
    url = data.next || null;
  }
}
async function listBitbucketFiles({ owner, repo, branch }) {
  if (!branch) {
    const r = await fetch(`https://api.bitbucket.org/2.0/repositories/${owner}/${repo}`);
    if (!r.ok) throw new Error(`Repo no encontrado o privado (HTTP ${r.status})`);
    branch = (await r.json()).mainbranch?.name || 'main';
  }
  const files = [];
  await bitbucketWalk(owner, repo, branch, '', files);
  return { branch, files, skipped: 0 };
}

// Lista el repo completo UNA vez. Devuelve todo lo necesario para persistir
// el trabajo: { host, owner, repo, branch, files:[{path,size}], skipped }.
export async function listRepo(url) {
  const info = parseRepoUrl(url);
  const { branch, files, skipped } = info.host === 'github' ? await listGithubFiles(info) : await listBitbucketFiles(info);
  if (!files.length) throw new Error('El repo está vacío (o no pude listarlo)');
  return { host: info.host, owner: info.owner, repo: info.repo, branch, files, skipped };
}

// Descarga los ficheros de `job.files` que NO estén en `doneSet` (Set de
// rutas). Llama a onFileDone(path) tras cada escritura para que quien invoque
// persista el progreso — así una interrupción se retoma sin re-descargar nada.
export async function downloadFiles(job, targetHandle, doneSet, onProgress, onFileDone) {
  const { host, owner, repo, branch, files } = job;
  const pending = files.filter(f => !doneSet.has(f.path));
  let done = files.length - pending.length;
  onProgress?.({ text: `${done}/${files.length}`, done, total: files.length });
  await pool(pending, CONCURRENCY, async f => {
    onProgress?.({ text: `Descargando ${f.path}…`, done, total: files.length });
    const url = host === 'github'
      ? `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${f.path}`
      : `https://api.bitbucket.org/2.0/repositories/${owner}/${repo}/src/${branch}/${f.path}`;
    const r = await fetch(url);
    if (r.ok) await writeInto(targetHandle, f.path, await r.blob());
    done++;
    onFileDone?.(f.path);
    onProgress?.({ text: `${done}/${files.length}`, done, total: files.length });
  });
}

// Conveniencia: listar + descargar todo de una vez (sin resumibilidad; para
// quien no necesite persistir progreso entre sesiones).
export async function cloneToHandle(url, targetHandle, onProgress) {
  const job = await listRepo(url);
  await downloadFiles(job, targetHandle, new Set(), onProgress);
  return { count: job.files.length, skipped: job.skipped };
}
