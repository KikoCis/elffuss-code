// Lo que una extensión con código le pide al usuario, pintado por Code.
//
// Avisos (toasts), diálogo modal, selector rápido, cuadro de texto, progreso
// y escribir en el portapapeles. Todo texto que viene del recinto entra con
// textContent: un enlace se queda en texto y un botón solo devuelve cuál se
// pulsó. Hay topes: 3 avisos a la vez y 20 por minuto, un diálogo y un
// selector (o cuadro) a la vez; lo que se pasa se contesta «nada» al momento
// y se cuenta. Escribir en el portapapeles solo con un gesto reciente del
// usuario (navigator.userActivation).
//
// Todo cuelga de #x2-* / .x2-* (web/css/ext2.css): nada del CSS de VS Code
// entra en la página.
import { tx } from '../ext/i18n.js';

const MAX_TOASTS = 3;
const TOASTS_PER_MINUTE = 20;
const TOAST_AUTOCLOSE = 9000;

const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const button = (txt, cls = 'x2-btn') => { const b = el('button', cls, txt); b.type = 'button'; return b; };
let nId = 0;
const uid = p => `${p}-${++nId}`;

export const userActive = () => {
  try { return !!globalThis.navigator?.userActivation?.isActive; } catch { return false; }
};

// Code cierra el panel de ajustes/extensiones con cualquier clic fuera de él
// (main.js, en captura sobre document). Un clic DENTRO de estos diálogos y
// avisos no es «fuera»: se para aquí, en captura sobre window, que va antes.
let guarda = false;
function guardaPanel() {
  if (guarda) return;
  guarda = true;
  window.addEventListener('pointerdown', e => {
    if (e.target instanceof Element && e.target.closest('.x2-backdrop, .x2-pick, #x2-toasts')) e.stopPropagation();
  }, true);
}

export function loadCss() {
  guardaPanel();
  if (document.getElementById('x2-css')) return;
  const l = document.createElement('link');
  l.id = 'x2-css';
  l.rel = 'stylesheet';
  l.href = new URL('../../css/ext2.css', import.meta.url).href;
  document.head.appendChild(l);
}

// Modal genérico: título, cuerpo, una caja opcional en monoespaciado (una
// dirección, una orden) y botones. Escape y fuera = el botón por defecto
// (el de cancelar). Devuelve el `value` del botón pulsado.
const abiertos = new Set();                 // cierres de los modales abiertos
export function closeModals() { for (const c of [...abiertos]) c(); }
export function modal({ id = 'x2-dialog', title, body = [], code = null, buttons, cancelValue = null, focus = 0, labelledBy = null }) {
  return new Promise(resolve => {
    loadCss();
    document.getElementById(id)?.remove();
    const previo = document.activeElement;
    const fondo = el('div', 'x2-backdrop');
    fondo.id = id;
    const caja = el('div', 'x2-modal');
    caja.setAttribute('role', 'dialog');
    caja.setAttribute('aria-modal', 'true');
    const h = el('h2', 'x2-modal-title', title);
    h.id = uid('x2-title');
    caja.setAttribute('aria-labelledby', labelledBy || h.id);
    caja.appendChild(h);
    const desc = [];
    for (const p of [].concat(body).filter(x => x != null && x !== '')) {
      const n = typeof p === 'string' ? el('p', 'x2-modal-text', p) : p;
      if (!n.id) n.id = uid('x2-desc');
      desc.push(n.id);
      caja.appendChild(n);
    }
    if (code != null) {
      const c = typeof code === 'string' ? el('div', 'x2-code', code) : code;
      if (!c.id) c.id = uid('x2-desc');
      desc.push(c.id);
      caja.appendChild(c);
    }
    if (desc.length) caja.setAttribute('aria-describedby', desc.join(' '));
    const fila = el('div', 'x2-modal-buttons');
    const botones = buttons.map(b => {
      const x = button(b.label, 'x2-btn' + (b.primary ? ' x2-primary' : ''));
      if (b.className) x.classList.add(b.className);
      if (b.disabled) { x.setAttribute('aria-disabled', 'true'); x.title = b.disabled; }
      x.onclick = async () => {
        if (x.getAttribute('aria-disabled') === 'true') return;
        if (typeof b.onClick === 'function') { const keep = await b.onClick(x); if (keep) return; }
        cerrar(b.value);
      };
      fila.appendChild(x);
      return x;
    });
    caja.appendChild(fila);
    fondo.appendChild(caja);
    let hecho = false;
    function cerrar(v) {
      if (hecho) return;
      hecho = true;
      abiertos.delete(cancelar);
      fondo.remove();
      document.removeEventListener('keydown', teclas, true);
      if (previo && previo.isConnected && typeof previo.focus === 'function') previo.focus();
      resolve(v);
    }
    const cancelar = () => cerrar(cancelValue);
    abiertos.add(cancelar);
    // el foco no sale del diálogo (Tab da la vuelta) y Escape cancela
    function teclas(e) {
      if (!fondo.isConnected) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(cancelValue); return; }
      if (e.key === 'Tab') {
        const fs = [...caja.querySelectorAll('button, input, textarea, [tabindex="0"]')].filter(x => !x.disabled);
        if (!fs.length) return;
        const i = fs.indexOf(document.activeElement);
        const j = e.shiftKey ? (i <= 0 ? fs.length - 1 : i - 1) : (i === fs.length - 1 ? 0 : i + 1);
        e.preventDefault();
        fs[j].focus();
      }
    }
    document.addEventListener('keydown', teclas, true);
    fondo.addEventListener('mousedown', e => { if (e.target === fondo) cerrar(cancelValue); });
    document.body.appendChild(fondo);
    (botones[focus] || botones[0])?.focus();
  });
}

export class ExtUI {
  constructor({ nameOf = id => id, log = () => {}, statusbar = () => document.getElementById('statusbar') } = {}) {
    this.nameOf = nameOf;
    this.log = log;
    this.statusbar = statusbar;
    this.toasts = [];                   // { el, resolve }
    this.sent = [];                     // instantes de los últimos avisos (para el tope por minuto)
    this.dialogBusy = false;
    this.pickBusy = null;               // { req, close }
    this.progress = new Map();          // id → texto
    this.dropped = { notify: 0, dialog: 0, pick: 0, clipboard: 0 };
    this.closers = new Set();
  }

  origin(source) {
    const n = source ? this.nameOf(source) : null;
    return n ? tx('x2From', { name: n }) : tx('x2FromAny');
  }

  // ── avisos ──
  notify({ sev = 'info', text, actions = [], source }) {
    const now = Date.now();
    this.sent = this.sent.filter(t => now - t < 60000);
    if (this.toasts.length >= MAX_TOASTS || this.sent.length >= TOASTS_PER_MINUTE) {
      this.dropped.notify++;
      this.log('warn', `a notification was not shown (more than ${MAX_TOASTS} on screen or ${TOASTS_PER_MINUTE} a minute): ${String(text).slice(0, 120)}`, source);
      return Promise.resolve(null);
    }
    this.sent.push(now);
    loadCss();
    let box = document.getElementById('x2-toasts');
    if (!box) {
      box = el('div');
      box.id = 'x2-toasts';
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    return new Promise(resolve => {
      const t = el('div', 'x2-toast x2-' + (['info', 'warning', 'error'].includes(sev) ? sev : 'info'));
      t.setAttribute('role', sev === 'error' ? 'alert' : 'status');
      t.appendChild(el('div', 'x2-toast-from', this.origin(source)));
      t.appendChild(el('div', 'x2-toast-text', String(text)));
      const fila = el('div', 'x2-toast-buttons');
      let hecho = false, reloj = null;
      const entry = { el: t, resolve: null };
      const fin = v => {
        if (hecho) return;
        hecho = true;
        clearTimeout(reloj);
        t.remove();
        this.toasts = this.toasts.filter(x => x !== entry);
        this.closers.delete(entry.resolve);
        resolve(v);
      };
      entry.resolve = () => fin(null);
      this.closers.add(entry.resolve);
      actions.forEach((a, i) => { const b = button(a, 'x2-btn' + (i === 0 ? ' x2-primary' : '')); b.onclick = () => fin(i); fila.appendChild(b); });
      const x = button('×', 'x2-toast-close');
      x.setAttribute('aria-label', tx('x2Dismiss'));
      x.onclick = () => fin(null);
      fila.appendChild(x);
      t.appendChild(fila);
      box.appendChild(t);
      this.toasts.push(entry);
      // sin botones, se va solo; con botones espera a que el usuario elija
      if (!actions.length) reloj = setTimeout(() => fin(null), TOAST_AUTOCLOSE);
    });
  }

  // ── diálogo modal (showXMessage con {modal: true}) ──
  async dialog({ sev = 'info', text, detail, buttons = [], cancel, source }) {
    if (this.dialogBusy) { this.dropped.dialog++; this.log('warn', 'a second dialog was refused while one is open', source); return null; }
    this.dialogBusy = true;
    try {
      const v = await modal({
        title: this.origin(source),
        body: [el('p', 'x2-modal-text x2-' + sev, String(text)), detail ? el('p', 'x2-modal-detail', String(detail)) : null].filter(Boolean),
        buttons: [...buttons.map((label, i) => ({ label, value: i, primary: i === 0 })), { label: cancel || tx('x2Cancel'), value: null }],
        cancelValue: null,
        focus: buttons.length,                 // el foco empieza en cancelar
      });
      return v;
    } finally { this.dialogBusy = false; }
  }

  // ── selector rápido (showQuickPick) ──
  pick({ req, items, options = {}, source }) {
    if (this.pickBusy) { this.dropped.pick++; this.log('warn', 'a second quick pick was refused while one is open', source); return Promise.resolve(null); }
    loadCss();
    return new Promise(resolve => {
      const previo = document.activeElement;
      const many = options.canPickMany === true;
      const caja = el('div', 'x2-pick');
      caja.id = 'x2-pick';
      caja.setAttribute('role', 'dialog');
      caja.setAttribute('aria-modal', 'true');
      const titulo = el('div', 'x2-pick-title', options.title || this.origin(source));
      titulo.id = uid('x2-pick-t');
      caja.setAttribute('aria-labelledby', titulo.id);
      const inp = el('input', 'x2-pick-input');
      inp.type = 'text';
      inp.autocomplete = 'off';
      inp.spellcheck = false;
      inp.placeholder = options.placeHolder || (many ? tx('x2PickMany') : tx('x2PickOne'));
      inp.setAttribute('role', 'combobox');
      inp.setAttribute('aria-expanded', 'true');
      inp.setAttribute('aria-autocomplete', 'list');
      const lista = el('div', 'x2-pick-list');
      lista.id = uid('x2-pick-l');
      lista.setAttribute('role', 'listbox');
      if (many) lista.setAttribute('aria-multiselectable', 'true');
      inp.setAttribute('aria-controls', lista.id);
      inp.setAttribute('aria-label', options.title || options.placeHolder || tx('x2PickOne'));
      const pie = el('div', 'x2-pick-foot');
      const ok = button(tx('x2Ok'), 'x2-btn x2-primary');
      const no = button(tx('x2Cancel'));
      pie.append(no, ok);
      if (!many) ok.hidden = true;
      caja.append(titulo, inp, lista, pie);
      document.body.appendChild(caja);

      const marcados = new Set(items.map((it, i) => (it && !it.sep && it.picked ? i : -1)).filter(i => i >= 0));
      let visibles = [], sel = 0, hecho = false;
      const fin = v => {
        if (hecho) return;
        hecho = true;
        caja.remove();
        document.removeEventListener('mousedown', fuera, true);
        this.pickBusy = null;
        this.closers.delete(cerrarYa);
        if (previo && previo.isConnected && typeof previo.focus === 'function') previo.focus();
        resolve(v);
      };
      const cerrarYa = () => fin(null);
      this.closers.add(cerrarYa);
      this.pickBusy = { req, close: cerrarYa };
      const fuera = e => { if (!caja.contains(e.target)) fin(null); };
      setTimeout(() => document.addEventListener('mousedown', fuera, true), 0);
      const coincide = (it, q) => !q || [it.label, options.matchOnDescription ? it.description : '', options.matchOnDetail ? it.detail : '']
        .some(s => typeof s === 'string' && s.toLowerCase().includes(q));
      const pinta = () => {
        const q = inp.value.trim().toLowerCase();
        lista.replaceChildren();
        visibles = [];
        let grupo = null;
        items.forEach((it, i) => {
          if (!it) return;
          if (it.sep !== undefined) { grupo = it.sep; return; }
          if (!coincide(it, q)) return;
          if (grupo !== null) {
            const g = el('div', 'x2-pick-sep', grupo);
            g.setAttribute('role', 'presentation');
            lista.appendChild(g);
            grupo = null;
          }
          const n = visibles.length;
          const row = el('div', 'x2-pick-item');
          row.id = `${lista.id}-${n}`;
          row.setAttribute('role', 'option');
          row.dataset.i = String(i);
          if (many) { const c = el('span', 'x2-check', marcados.has(i) ? '☑' : '☐'); c.setAttribute('aria-hidden', 'true'); row.appendChild(c); }
          const t = el('span', 'x2-pick-label', it.label);
          row.appendChild(t);
          if (it.description) row.appendChild(el('span', 'x2-pick-desc', it.description));
          if (it.detail) row.appendChild(el('div', 'x2-pick-detail', it.detail));
          row.onclick = () => { sel = n; if (many) { alterna(i); } else fin(i); };
          lista.appendChild(row);
          visibles.push(i);
        });
        if (!visibles.length) lista.appendChild(el('div', 'x2-pick-empty', tx('x2PickNone')));
        sel = Math.min(sel, Math.max(0, visibles.length - 1));
        marca();
      };
      const marca = () => {
        const filas = [...lista.querySelectorAll('.x2-pick-item')];
        filas.forEach((r, n) => {
          const i = Number(r.dataset.i);
          r.classList.toggle('sel', n === sel);
          r.setAttribute('aria-selected', String(many ? marcados.has(i) : n === sel));
          if (many) r.setAttribute('aria-checked', String(marcados.has(i)));
        });
        if (filas[sel]) { inp.setAttribute('aria-activedescendant', filas[sel].id); filas[sel].scrollIntoView({ block: 'nearest' }); }
        else inp.removeAttribute('aria-activedescendant');
      };
      const alterna = i => {
        if (marcados.has(i)) marcados.delete(i); else marcados.add(i);
        const fila = lista.querySelector(`.x2-pick-item[data-i="${i}"] .x2-check`);
        if (fila) fila.textContent = marcados.has(i) ? '☑' : '☐';
        marca();
      };
      ok.onclick = () => fin([...marcados].sort((a, b) => a - b));
      no.onclick = () => fin(null);
      inp.oninput = () => { sel = 0; pinta(); };
      inp.onkeydown = e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          if (!visibles.length) return;
          sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + visibles.length) % visibles.length;
          marca();
        } else if (e.key === ' ' && many && visibles.length && !inp.value) { e.preventDefault(); alterna(visibles[sel]); }
        else if (e.key === 'Enter') {
          e.preventDefault();
          if (many) fin([...marcados].sort((a, b) => a - b));
          else if (visibles.length) fin(visibles[sel]);
        } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fin(null); }
      };
      pinta();
      inp.focus();
    });
  }

  // ── cuadro de texto (showInputBox) ──
  input({ req, options = {}, source }) {
    if (this.pickBusy) { this.dropped.pick++; this.log('warn', 'an input box was refused while another one is open', source); return Promise.resolve(null); }
    loadCss();
    return new Promise(resolve => {
      const previo = document.activeElement;
      const caja = el('div', 'x2-pick x2-inputbox');
      caja.id = 'x2-input';
      caja.setAttribute('role', 'dialog');
      caja.setAttribute('aria-modal', 'true');
      const titulo = el('div', 'x2-pick-title', options.title || this.origin(source));
      titulo.id = uid('x2-input-t');
      caja.setAttribute('aria-labelledby', titulo.id);
      const inp = el('input', 'x2-pick-input');
      inp.type = options.password ? 'password' : 'text';
      inp.autocomplete = 'off';
      inp.spellcheck = false;
      inp.placeholder = options.placeHolder || '';
      inp.value = typeof options.value === 'string' ? options.value : '';
      const ayuda = el('div', 'x2-input-prompt', options.prompt || tx('x2InputHint'));
      ayuda.id = uid('x2-input-p');
      const error = el('div', 'x2-input-error', options.validation || '');
      error.id = uid('x2-input-e');
      error.setAttribute('role', 'alert');
      error.hidden = !options.validation;
      inp.setAttribute('aria-describedby', ayuda.id + ' ' + error.id);
      inp.setAttribute('aria-label', options.title || options.prompt || tx('x2InputHint'));
      if (options.validation) inp.setAttribute('aria-invalid', 'true');
      const pie = el('div', 'x2-pick-foot');
      const ok = button(tx('x2Ok'), 'x2-btn x2-primary');
      const no = button(tx('x2Cancel'));
      pie.append(no, ok);
      caja.append(titulo, inp, ayuda, error, pie);
      document.body.appendChild(caja);
      let hecho = false;
      const fin = v => {
        if (hecho) return;
        hecho = true;
        caja.remove();
        document.removeEventListener('mousedown', fuera, true);
        this.pickBusy = null;
        this.closers.delete(cerrarYa);
        if (previo && previo.isConnected && typeof previo.focus === 'function') previo.focus();
        resolve(v);
      };
      const cerrarYa = () => fin(null);
      this.closers.add(cerrarYa);
      this.pickBusy = { req, close: cerrarYa };
      const fuera = e => { if (!caja.contains(e.target)) fin(null); };
      setTimeout(() => document.addEventListener('mousedown', fuera, true), 0);
      ok.onclick = () => fin(inp.value);
      no.onclick = () => fin(null);
      inp.onkeydown = e => {
        if (e.key === 'Enter') { e.preventDefault(); fin(inp.value); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fin(null); }
      };
      inp.focus();
      inp.select();
    });
  }

  // la extensión canceló su selector o su cuadro (token)
  cancel(req) { if (this.pickBusy && this.pickBusy.req === req) this.pickBusy.close(); }

  // ── progreso, en la barra de estado ──
  setProgress({ id, text, done }) {
    if (done) this.progress.delete(id); else this.progress.set(id, text);
    const bar = this.statusbar();
    if (!bar) return;
    let p = document.getElementById('x2-progress');
    if (!this.progress.size) { p?.remove(); return; }
    if (!p) {
      loadCss();
      p = el('span', 'x2-progress');
      p.id = 'x2-progress';
      p.setAttribute('role', 'status');
      bar.appendChild(p);
    } else if (p.parentNode !== bar) bar.appendChild(p);
    const textos = [...this.progress.values()].filter(Boolean);
    p.textContent = '⟳ ' + (textos[textos.length - 1] || tx('x2Working')) + (this.progress.size > 1 ? ` (+${this.progress.size - 1})` : '');
  }

  // ── portapapeles: solo con un gesto reciente del usuario ──
  async clipboard(text, source) {
    if (typeof text !== 'string') return false;
    if (!userActive()) {
      this.dropped.clipboard++;
      this.log('warn', 'a clipboard write without a recent click or key press was dropped', source);
      return false;
    }
    try { await navigator.clipboard.writeText(text.slice(0, 500000)); return true; }
    catch { this.log('warn', 'the browser refused the clipboard write', source); return false; }
  }

  dispose() {
    for (const c of [...this.closers]) { try { c(); } catch { /* — */ } }
    this.closers.clear();
    for (const t of [...this.toasts]) { try { t.resolve(); } catch { /* — */ } }
    document.getElementById('x2-toasts')?.remove();
    closeModals();
    this.progress.clear();
    document.getElementById('x2-progress')?.remove();
  }
}
