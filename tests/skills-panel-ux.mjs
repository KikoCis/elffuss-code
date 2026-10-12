// Panel de Skills: claro de usar, con teclado y en el teléfono. GitHub se
// stubea aquí (nada sale a la red).
//
//   1. Dos partes que no se mezclan: «Instaladas» y «Explorar catálogos», cada
//      una con su encabezado, y una sola acción por fila.
//   2. «Explorar» abre la lista DENTRO de la tarjeta del catálogo (antes se
//      añadía al final del panel, debajo de «Añadir repo») y otra vez la cierra
//      (aria-expanded).
//   3. «Instalar» NO cierra el panel: el botón pasa a «Instalada ✓», conserva
//      el foco, la skill aparece arriba y el chat recibe el «cómo usarla».
//   4. «Quitar» la quita al momento, el foco no cae a <body> y la lista
//      abierta vuelve a ofrecer «Instalar».
//   5. Un catálogo añadido por ti se quita desde dentro de su lista.
//   6. En el teléfono los nombres no se cortan («Co…») ni hay desplazamiento
//      lateral, y los botones caben.
//   7. En inglés, todo en inglés (también los nombres de los catálogos y los
//      errores).
//
//   BASE=http://127.0.0.1:8898 node tests/skills-panel-ux.mjs
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8799';
let fails = 0; const ok = (n, c, e = '') => { console.log((c ? '✅' : '❌') + ' ' + n + (e ? '  — ' + e : '')); if (!c) fails++; };

const REPO = 'anthropics/skills';
const ARBOL = { tree: [{ path: 'skills/pdf/SKILL.md' }, { path: 'skills/docx/SKILL.md' }] };
const md = n => `---\nname: ${n}\ndescription: Hace cosas de ${n}.\n---\nInstrucciones de ${n}.`;
const b = await chromium.launch();
async function abre(locale, viewport, movil = false) {
  const ctx = await b.newContext({ locale, viewport, isMobile: movil, hasTouch: movil });
  await ctx.addInitScript(() => { try { localStorage.setItem('elffusscode.model', 'rules'); } catch {} });
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith('https://api.github.com/repos/')) return u.includes('/no/existe/') ? r.fulfill({ status: 404, body: '{}' }) : r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ARBOL) });
    if (u.startsWith('https://raw.githubusercontent.com/')) return r.fulfill({ status: 200, contentType: 'text/plain', body: md(u.match(/skills\/([^/]+)\/SKILL/)?.[1] || 'x') });
    if (/soundcloud|huggingface|hf\.co/.test(u)) return r.abort();
    return r.continue();
  });
  const p = await ctx.newPage();
  p.errs = []; p.on('pageerror', e => p.errs.push(e.message.slice(0, 160)));
  await p.goto(BASE + '/?test-opfs', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.elffussClaw?.conv?.getActive?.(), null, { timeout: 30000 });
  return { ctx, p };
}
const foco = p => p.evaluate(() => { const a = document.activeElement; return !a || a === document.body ? 'BODY' : (a.getAttribute('aria-label') || a.textContent || a.id).trim().slice(0, 60); });
const enter = async (p, loc) => { await loc.focus(); await p.keyboard.press('Enter'); };

// ── escritorio, en español y con teclado ──
{
  const { ctx, p } = await abre('es-ES', { width: 1280, height: 800 });
  await p.click('#act-skills');
  await p.waitForSelector('#settings-panel .sk-catalogos .sk-cat');
  const heads = await p.$$eval('#settings-panel .skills-panel h4', hs => hs.map(h => h.textContent));
  ok('1 · dos partes con encabezado: Instaladas y Explorar catálogos', heads.length === 2 && /^Instaladas \(0\)$/.test(heads[0]) && /^Explorar catálogos$/.test(heads[1]), JSON.stringify(heads));
  const acciones = await p.$$eval('#settings-panel .sk-catalogos .sk-cat', fs => fs.map(f => f.querySelectorAll(':scope > button').length));
  ok('1 · cada catálogo tiene UNA acción', acciones.length >= 3 && acciones.every(n => n === 1), JSON.stringify(acciones));

  const tarjeta = p.locator(`#settings-panel .sk-cat[data-repo="${REPO}"]`);
  const explorar = tarjeta.locator(':scope > button');
  await enter(p, explorar);
  await p.waitForFunction(r => document.querySelector(`.sk-cat[data-repo="${r}"] .sk-browse .sk-install`), REPO);
  ok('2 · «Explorar» abre la lista DENTRO de la tarjeta del catálogo', await tarjeta.locator('.sk-browse .sk-row').count() === 2
    && await explorar.getAttribute('aria-expanded') === 'true' && await explorar.innerText() === 'Ocultar');
  ok('2 · …y el foco sigue en el botón', (await foco(p)) === 'Explorar anthropics/skills', await foco(p));

  const nombre = (await tarjeta.locator('.sk-install', { hasText: 'Instalar' }).first().getAttribute('aria-label')).replace(/^Instalar: /, '');
  const instalar = tarjeta.locator(`.sk-install[data-nombre="${nombre}"]`);
  await enter(p, instalar);
  await p.waitForFunction(() => document.querySelectorAll('#settings-panel .sk-instaladas .sk-row').length === 1);
  ok('3 · instalar NO cierra el panel', await p.isVisible('#settings-panel'));
  ok('3 · el botón pasa a «Instalada ✓» (inerte) y conserva el foco', await instalar.getAttribute('aria-disabled') === 'true'
    && (await foco(p)) === `Instalada ✓: ${nombre}`, await foco(p));
  ok('3 · la skill aparece arriba y el contador sube', /^Instaladas \(1\)$/.test(await p.textContent('#sk-inst-h'))
    && (await p.innerText('#settings-panel .sk-instaladas .sk-row b')) === nombre);
  ok('3 · el aviso lo dice y el chat tiene el «cómo usarla»', /instalada/.test(await p.innerText('.skills-panel > .sk-msg'))
    && await p.evaluate(n => [...document.querySelectorAll('#chat-log .msg')].some(m => m.textContent.includes(`Skill «${n}» instalada`)), nombre));

  await enter(p, p.locator('#settings-panel .sk-instaladas .sk-remove').first());
  await p.waitForTimeout(200);
  ok('4 · «Quitar» la quita al momento', /^Instaladas \(0\)$/.test(await p.textContent('#sk-inst-h')));
  ok('4 · …el foco no cae a <body> (va al encabezado)', (await foco(p)) === 'Instaladas (0)', await foco(p));
  ok('4 · …y la lista abierta vuelve a ofrecer «Instalar»', await p.locator(`#settings-panel .sk-install[aria-label="Instalar: ${nombre}"]`).getAttribute('aria-disabled') === null);

  await explorar.click();
  ok('2 · otra vez «Ocultar» la cierra', await tarjeta.locator('.sk-browse').isHidden() && await explorar.getAttribute('aria-expanded') === 'false');

  // un catálogo propio
  await p.fill('#settings-panel .sk-add input', 'https://github.com/alguien/mis-skills');
  await p.keyboard.press('Enter');
  const propia = p.locator('#settings-panel .sk-cat[data-repo="alguien/mis-skills"]');
  await propia.waitFor();
  ok('5 · añadir un repo lo enseña con una sola acción y el foco en «Explorar»', await propia.locator(':scope > button').count() === 1
    && (await foco(p)) === 'Explorar alguien/mis-skills', await foco(p));
  await propia.locator(':scope > button').click();
  const quitarRepo = propia.locator('.sk-remove-repo');
  await quitarRepo.waitFor();
  await enter(p, quitarRepo);
  await p.waitForTimeout(250);
  ok('5 · …y se quita desde dentro de su lista (el foco va al encabezado)', await p.locator('#settings-panel .sk-cat[data-repo="alguien/mis-skills"]').count() === 0
    && (await foco(p)) === 'Explorar catálogos', await foco(p));
  ok('sin errores de página', !p.errs.length, p.errs.join(' | '));
  await ctx.close();
}

// ── teléfono ──
{
  const { ctx, p } = await abre('es-ES', { width: 390, height: 844 }, true);
  await p.tap('#btn-drawer');
  await p.waitForTimeout(200);
  await p.tap('#act-skills');
  await p.waitForSelector('#settings-panel .sk-cat');
  await p.locator(`#settings-panel .sk-cat[data-repo="${REPO}"] > button`).tap();
  await p.waitForSelector('#settings-panel .sk-browse .sk-install');
  const m = await p.evaluate(() => {
    const cortados = [...document.querySelectorAll('#settings-panel .sk-info b')].filter(b => b.scrollWidth > b.clientWidth + 1).map(b => b.textContent);
    const fuera = [...document.querySelectorAll('#settings-panel button')].filter(b => { const r = b.getBoundingClientRect(); return r.width && (r.right > innerWidth || r.left < 0); }).map(b => b.textContent);
    return { cortados, fuera, scrollX: document.documentElement.scrollWidth - innerWidth };
  });
  ok('6 · en el teléfono ningún nombre se corta', !m.cortados.length, JSON.stringify(m.cortados));
  ok('6 · …ningún botón se sale de la pantalla y no hay desplazamiento lateral', !m.fuera.length && m.scrollX <= 0, JSON.stringify(m));
  ok('6 · sin errores de página', !p.errs.length, p.errs.join(' | '));
  await ctx.close();
}

// ── en inglés ──
{
  const { ctx, p } = await abre('en-US', { width: 1280, height: 800 });
  await p.click('#act-skills');
  await p.waitForSelector('#settings-panel .sk-cat');
  const txt = await p.textContent('#settings-panel');
  ok('7 · en inglés: título, partes y catálogos en inglés', /Skills for Elffuss/.test(txt) && /Installed \(0\)/.test(txt) && /Browse catalogs/i.test(txt)
    && /Community · Mega collection/.test(txt) && !/Comunidad|Catálogos|Instaladas|Explorar/.test(txt), txt.slice(0, 400));
  await p.fill('#settings-panel .sk-add input', 'esto no vale');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(200);
  ok('7 · …y el error de un repo que no vale, también', /Type owner\/repo/.test(await p.innerText('#settings-panel .sk-add + .sk-msg')), await p.innerText('#settings-panel .sk-add + .sk-msg'));
  ok('7 · sin errores de página', !p.errs.length, p.errs.join(' | '));
  await ctx.close();
}
await b.close();
console.log(fails ? `\n❌ ${fails} FALLO(S)` : '\n✅ panel de Skills: claro, con teclado, en el teléfono y en inglés');
process.exit(fails ? 1 : 0);
