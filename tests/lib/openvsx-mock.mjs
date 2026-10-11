// Open VSX simulado para las pruebas del gestor de extensiones: búsqueda,
// metadatos, package.json, suma SHA-256 y el .vsix, servidos con
// context.route desde paquetes de las pruebas (los .vsix reales fijados de
// tests/.cache/vsix o manifiestos sintéticos). Apunta cada petición con el
// marco que la hizo, para comprobar que solo la página de Code habla con
// Open VSX y nunca el recinto.
//
//   const mock = await mockOpenVsx(ctx, [{ namespace, name, version, manifest, vsix?, published?, keywords? }])
//   mock.log → [{ url, path, frame }]
const API = 'https://open-vsx.org';

export async function mockOpenVsx(ctx, packages) {
  const log = [];
  const key = p => `${p.namespace}/${p.name}/${p.version}`.toLowerCase();
  const byKey = new Map(packages.map(p => [key(p), p]));
  const base = p => `${API}/api/${p.namespace}/${p.name}/${p.version}`;
  const summary = p => ({
    namespace: p.namespace, name: p.name, version: p.version, displayName: p.manifest.displayName || p.name,
    description: p.description || p.manifest.description || '', downloadCount: p.downloadCount || 1, verified: true, files: {},
  });
  await ctx.route(`${API}/**`, async route => {
    const req = route.request();
    const u = new URL(req.url());
    let frame = '';
    try { frame = req.frame()?.url() || ''; } catch { /* de un worker */ }
    log.push({ url: u.href, path: u.pathname, frame });
    const cors = { 'access-control-allow-origin': '*' };
    const json = (body, status = 200) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (u.pathname === '/api/-/search') {
      const q = (u.searchParams.get('query') || '').toLowerCase();
      const offset = Number(u.searchParams.get('offset') || 0), size = Number(u.searchParams.get('size') || 20);
      const hits = packages.filter(p => !q || [p.namespace, p.name, p.manifest.displayName || '', ...(p.keywords || [])].join(' ').toLowerCase().includes(q));
      return json({ totalSize: hits.length, offset, extensions: hits.slice(offset, offset + size).map(summary) });
    }
    const m = /^\/api\/([^/]+)\/([^/]+)\/([^/]+)(?:\/file\/(.+))?$/.exec(u.pathname);
    const p = m && byKey.get(`${m[1]}/${m[2]}/${m[3]}`.toLowerCase());
    if (!p) return json({ error: 'not found' }, 404);
    if (!m[4]) {
      return json({
        ...summary(p), license: p.manifest.license || 'MIT',
        files: {
          manifest: base(p) + '/file/package.json',
          ...(p.vsix ? { download: base(p) + `/file/${p.namespace}.${p.name}-${p.version}.vsix` } : {}),
          ...(p.published !== null && p.vsix ? { sha256: base(p) + `/file/${p.namespace}.${p.name}-${p.version}.sha256` } : {}),
        },
      });
    }
    if (m[4] === 'package.json') return json(p.manifest);
    if (m[4].endsWith('.sha256')) {
      if (p.published === null || p.shaStatus) return route.fulfill({ status: p.shaStatus || 404, headers: cors, body: 'not found' });
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'text/plain' }, body: `${p.published}  ${p.namespace}.${p.name}-${p.version}.vsix` });
    }
    if (m[4].endsWith('.vsix') && p.vsix) {
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/octet-stream', 'content-length': String(p.vsix.length) }, body: p.vsix });
    }
    return json({ error: 'not found' }, 404);
  });
  return { log, downloads: () => log.filter(r => r.path.endsWith('.vsix')).map(r => r.path) };
}
