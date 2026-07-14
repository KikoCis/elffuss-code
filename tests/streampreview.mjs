// Bug real visto por el usuario: la burbuja «Elffuss escribe» enseñaba el JSON
// crudo del tool-call según iba llegando en streaming (```tool\n{"tool":...).
// Debe detectar la cabecera y mostrar una frase humana en su lugar, NUNCA el
// JSON — reproduce el caso exacto de la captura (prosa → code.read).
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const b = await chromium.launch();
const ctx = await b.newContext(); await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
const p = await ctx.newPage();
await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1500);

// ── 1) unidad pura: humanizeStreamPreview nunca deja pasar JSON crudo ──────
const trace = await p.evaluate(async () => {
  const { humanizeStreamPreview } = await import('/js/humanize.js');
  // el mensaje real de la captura: prosa que termina en una frase cortada y
  // LUEGO el fence de tool-call — streameado carácter a carácter, como de verdad
  const full = 'The project structure is now complete for a basic drone hacking simulation, using the `Drone.inject_payload` and `Drone.take_over` methods.\n\n' +
    '```tool\n{"tool": "code.read", "args": {"path": "drone_hacker/config.py"}}\n```';
  let buf = '', sawRawJson = false;
  const previews = [];
  for (const ch of full) {
    buf += ch;
    const preview = humanizeStreamPreview(buf);
    previews.push(preview);
    const shown = preview ? '⟐ ' + preview : buf.slice(-200);
    if (/\{"tool"|```tool|"path"\s*:/.test(shown)) sawRawJson = true;
  }
  return { sawRawJson, last: previews.at(-1), mid: previews.find(x => x === 'preparando una acción…') };
});
ok('NUNCA se muestra el JSON crudo, en ningún punto del streaming', !trace.sawRawJson);
ok('mientras el nombre de la tool aún no es legible, muestra el genérico', !!trace.mid, trace.mid);
ok('al final, la frase humana correcta («leyendo drone_hacker/config.py…»)', trace.last === 'leyendo drone_hacker/config.py…', trace.last);

// ── 2) integración DOM real: thinkingBubble().tick() con el mismo streaming ──
const domTrace = await p.evaluate(async () => {
  const m = await import('/js/main.js');
  const th = m.thinkingBubble();
  const full = 'The project structure is now complete for a basic drone hacking simulation, using the `Drone.inject_payload` and `Drone.take_over` methods.\n\n' +
    '```tool\n{"tool": "code.read", "args": {"path": "drone_hacker/config.py"}}\n```';
  const seen = [];
  for (const ch of full) { th.tick(ch); seen.push(document.querySelector('.msg.thinking .gen').textContent); }
  const finalText = seen.at(-1);
  const anyRawJson = seen.some(s => /\{"tool"|```tool/.test(s));
  th.remove();
  return { finalText, anyRawJson };
});
ok('en el DOM real, nunca aparece el JSON crudo tampoco', !domTrace.anyRawJson);
ok('el DOM real termina mostrando la frase humana', domTrace.finalText === '⟐ leyendo drone_hacker/config.py…', domTrace.finalText);

console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ STREAMING HUMANIZADO OK — el JSON crudo ya no se ve');
await b.close();
process.exit(fails ? 1 : 0);
