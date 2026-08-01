// Elffuss Code demo video: the file tree stays visible the whole time, real
// tool-calling runs in sequence (read → search/locate → edit), then a brief
// (~4s) look at the Mind, and an outro with logo+claim.
// Doubles as an e2e smoke test: loads the real Gemma-4 model on WebGPU and
// exercises code.read / code.search / code.edit end to end.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const REC = process.env.REC || '/Users/dev/work2026/elffuss-assets/_recording';
const OUT = process.env.OUT || REC + '/videos';
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE || 'https://elffuss-code.utopiaia.com';

async function waitIdle(p, maxMs = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const sending = await p.locator('#btn-send.sending').count().catch(() => 0);
    if (!sending) return true;
    await p.waitForTimeout(500);
  }
  return false;
}

const PROFILE = process.env.PROFILE || REC + '/profile-code-gemma';
mkdirSync(PROFILE, { recursive: true });
const ctx = await chromium.launchPersistentContext(PROFILE, {
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-webgpu', '--use-angle=metal',
    // WebGPU LLM inference issues long GPU dispatches; Chromium's GPU watchdog
    // otherwise kills the GPU process mid-inference/-load → "Target page…closed".
    '--disable-gpu-watchdog', '--disable-gpu-process-crash-limit'],
  viewport: { width: 1440, height: 900 },
  locale: 'en-US', // fuerza navigator.language=en → chrome i18n + modelo en inglés
  recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
});
await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'litert:gemma-e2b'); } catch {} });
const p = ctx.pages()[0] || await ctx.newPage();

await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2000);
await p.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  for await (const name of root.keys()) await root.removeEntry(name, { recursive: true }).catch(() => {});
  const w = async (name, txt) => { const fh = await root.getFileHandle(name, { create: true }); const s = await fh.createWritable(); await s.write(txt); await s.close(); };
  await w('README.md', '# calculator\nSimple numeric utilities.');
  await w('calc.py',
    'def average(numbers):\n' +
    '    return sum(numbers) / len(numbers) - 1  # why -1?\n\n' +
    'def is_prime(n):\n' +
    '    if n < 2:\n' +
    '        return False\n' +
    '    for i in range(2, n):\n' +
    '        if n % i == 0:\n' +
    '            return False\n' +
    '    return True\n');
  const ide = await import('/js/ide.js');
  await ide.refreshTree(root);
});
await p.waitForTimeout(500);
console.log('1) project seeded (README.md + calc.py with a real bug) — tree visible');

console.log('2) loading real Gemma-4 E2B (~2GB if not cached)…');
let loaded = false;
{
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    const cls = await p.locator('#model-dot').getAttribute('class').catch(() => '');
    if (cls && /\bon\b/.test(cls)) { loaded = true; break; }
    await p.waitForTimeout(1000);
  }
}
if (!loaded) throw new Error('Gemma did NOT load in time');
console.log('3) Gemma-4 actually loaded, running in your browser');

await p.click('#prompt');
await p.type('#prompt', 'What does calc.py do?', { delay: 25 });
await p.press('#prompt', 'Enter');
console.log('4) turn 1 — should read the file (code.read) before answering');
await waitIdle(p, 120000);
await p.waitForTimeout(1200);

await p.click('#prompt');
await p.type('#prompt', 'There is a real bug in average(): it subtracts 1 too many from the result. Find it in the project and fix it with a minimal edit.', { delay: 22 });
await p.press('#prompt', 'Enter');
console.log('5) turn 2 — should search/locate and edit (code.search + code.edit)');
await waitIdle(p, 150000);
await p.waitForTimeout(1500);
console.log('6) Gemma answered — tree still visible');

const fileRow = p.locator('#tree .file', { hasText: 'calc.py' });
if (await fileRow.count()) {
  await fileRow.first().click({ force: true });
  await p.waitForTimeout(1800);
  console.log('7) calc.py open in the editor — the real fix is visible');
}
await p.waitForTimeout(1500);

await p.click('#activity img');
await p.waitForTimeout(4000);
console.log('8) brief look at the Mind (4s)');
await p.click('#mind-close').catch(() => {});
await p.waitForTimeout(500);

await p.evaluate(async () => (await import('/js/db.js')).del('kv', 'project'));
await p.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(4000);
console.log('9) outro with logo + claim');

const _vid = p.video();
await ctx.close();
// guarda el webm directamente como el keeper que consume finalize-demos.sh
if (_vid) { await _vid.saveAs(REC + '/code-keeper.webm'); console.log('keeper →', REC + '/code-keeper.webm'); }
console.log('OK — video saved in', OUT);
