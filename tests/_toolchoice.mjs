// PROBE: ¿el modelo REAL elige code.edit (parcial) para MODIFICAR un fichero?
// Reutiliza el perfil con E4B ya cacheado y crea el motor a 4096 directamente.
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8790';
const URL_ = BASE + '/__e4b.litertlm';
const PROFILE = process.env.PROFILE || '/tmp/elf-e4b-live';
const log = (...a) => console.log('[' + new Date().toISOString().slice(11, 19) + '] ' + a.join(' '));

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome', args: ['--enable-unsafe-webgpu', '--use-angle=metal'], timeout: 120000,
});
const p = await ctx.newPage();
p.on('console', m => { const t = m.text(); if (t.startsWith('HITO')) log('  ', t); });
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(1500);
log('página lista');

const r = await p.evaluate(async (u) => {
  const m = await import('/js/providers/litert.js');
  const litertlm = await import('https://cdn.jsdelivr.net/npm/@litert-lm/core/+esm');
  const agent = await import('/js/agent.js');
  const code = await import('/js/tools/code.js');
  const model = await m.cachedModelBlob(u, () => {});
  console.log('HITO A: modelo ' + (model instanceof Blob ? (model.size/1e9).toFixed(2)+'GB' : typeof model));
  const engine = await litertlm.Engine.create({ model, mainExecutorSettings: { maxNumTokens: 4096 } });
  console.log('HITO B: motor listo');

  let s = 'export const CONFIG = {\n  titulo: "Mi App",\n  color: "azul",\n  version: "1.0.0",\n';
  for (let i = 0; i < 30; i++) s += `  opcion${i}: ${i},\n`;
  s += '};\n';
  await code.write({ path: 'config.js', content: s });
  const actual = await code.read({ path: 'config.js' });

  const conv = await engine.createConversation({
    preface: { messages: [{ role: 'system', content: agent.systemPrompt('') }] },
    filterChannelContentFromKvCache: true, prefillPrefaceOnInit: true,
  });
  console.log('HITO C: conversación con el system prompt del agente');
  let out = '';
  for await (const ch of conv.sendMessageStreaming(`En config.js cambia el color "azul" por "rojo". El fichero es:\n\n${actual}`))
    for (const it of (ch.content || [])) if (it.type === 'text') out += it.text;
  console.log('HITO D: respondido (' + out.length + ' chars)');
  const calls = agent.parseToolCalls(out) || [];
  return { out: out.slice(0, 700), calls: calls.map(c => ({ tool: c.tool, path: c.args?.path, search: (c.args?.search||'').slice(0,60), contentLen: (c.args?.content||'').length })) };
}, URL_);
log('RESULTADO →', JSON.stringify(r, null, 1));
await ctx.close().catch(() => {});
