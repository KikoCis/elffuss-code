// Comandos de las extensiones con código en Code: salen en F1 (acciones de
// Monaco), en el menú contextual del editor si la extensión lo pide, y como
// entradas para la paleta de Code (entries()). Sus atajos se atan con el foco
// en el editor, salvo los reservados (keys.js). Al quitar la extensión o parar
// el puente, todo se deshace.
import { parseKeybinding } from './keys.js';

const s = (v, max = 300) => (typeof v === 'string' ? v.slice(0, max) : '');

// manifiesto (ya con %nls% resuelto) → comandos visibles y atajos
export function commandsOf(manifest) {
  const c = manifest && typeof manifest.contributes === 'object' && manifest.contributes ? manifest.contributes : {};
  const hidden = new Set();
  const palette = Array.isArray(c.menus?.commandPalette) ? c.menus.commandPalette : [];
  for (const m of palette) if (m && typeof m.command === 'string' && (m.when === 'false' || m.when === false)) hidden.add(m.command);
  const contextMenu = new Map();
  for (const m of Array.isArray(c.menus?.['editor/context']) ? c.menus['editor/context'] : []) {
    if (m && typeof m.command === 'string') contextMenu.set(m.command, s(m.group, 100) || 'x2');
  }
  const list = [];
  for (const cmd of Array.isArray(c.commands) ? c.commands : []) {
    if (!cmd || typeof cmd.command !== 'string' || !/^[\w.:/-]{1,200}$/.test(cmd.command)) continue;
    const title = typeof cmd.title === 'string' ? cmd.title : cmd.title && typeof cmd.title.value === 'string' ? cmd.title.value : cmd.command;
    const category = typeof cmd.category === 'string' ? cmd.category : cmd.category && typeof cmd.category.value === 'string' ? cmd.category.value : '';
    list.push({ id: cmd.command, title: s(title), category: s(category, 100), hidden: hidden.has(cmd.command), contextGroup: contextMenu.get(cmd.command) || null });
  }
  return { commands: list, keybindings: Array.isArray(c.keybindings) ? c.keybindings.slice(0, 500) : [] };
}

// La lista viva de la paleta de Code (main.js la expone en
// window.elffussClaw.commands y la relee en cada repintado). Este módulo
// nunca importa main.js: solo mete y saca sus propias entradas.
const paletteList = () => {
  const l = globalThis.window?.elffussClaw?.commands;
  return Array.isArray(l) ? l : null;
};

export class Commands {
  constructor({ monaco, editor, run, onReport = () => {} }) {
    this.monaco = monaco;
    this.editor = editor;
    this.run = run;
    this.onReport = onReport;
    this.byExt = new Map();                        // id → { disposables, entries, palette, skipped }
    this.chords = new Map();                       // atajo (número de Monaco) → id de la extensión que lo tiene
  }

  set(ext) {
    this.remove(ext.id);
    const { monaco, editor } = this;
    const { commands, keybindings } = commandsOf(ext.manifest);
    const disposables = [], entries = [], palette = [], skipped = [];
    const name = s(ext.displayName || ext.manifest?.displayName || ext.id, 200);
    for (const c of commands) {
      const label = c.category ? `${c.category}: ${c.title}` : c.title;
      const run = () => this.run(c.id);
      // F1 y menú contextual (Monaco pinta las etiquetas como texto)
      disposables.push(editor.addAction({
        id: 'x2:' + c.id, label,
        ...(c.contextGroup ? { contextMenuGroupId: 'x2_' + c.contextGroup.replace(/[^\w]/g, '_'), contextMenuOrder: 1 } : {}),
        run,
      }));
      if (c.hidden) continue;
      entries.push({ id: c.id, label, hint: name, run, ext: ext.id });
      // en la paleta de Code: se cierra y el comando actúa sobre el editor
      palette.push({
        label, hint: name, x2: ext.id,
        run: () => {
          const p = document.getElementById('palette');
          if (p) p.hidden = true;
          editor.focus();
          return run();
        },
      });
    }
    const list = paletteList();
    if (list) list.push(...palette);
    // atajos: un comando global de Monaco + su regla de teclado (ambos se deshacen)
    const registered = new Set();
    for (const [i, kb] of keybindings.entries()) {
      const p = parseKeybinding(monaco, kb);
      // (la tecla que se miró en esta plataforma: «cmd+p» en un Mac, no «ctrl+p»)
      if (p.skip) { skipped.push({ command: s(kb?.command, 200), key: s(p.key || kb?.key || kb?.mac, 100), why: p.skip, code: p.code || 'invalid' }); continue; }
      // dos extensiones con el mismo atajo: se queda la primera y se avisa
      const owner = this.chords.get(p.keybinding);
      if (owner && owner !== ext.id) { skipped.push({ command: s(kb.command, 200), key: p.key, why: 'conflicts with ' + owner, code: 'conflict', conflict: owner }); continue; }
      this.chords.set(p.keybinding, ext.id);
      const id = `x2-key:${ext.id}:${i}`;
      if (!registered.has(id)) {
        registered.add(id);
        disposables.push(monaco.editor.addCommand({ id, run: () => this.run(p.command, p.args) }));
      }
      const when = 'editorTextFocus' + (p.when ? ` && (${p.when})` : '');
      disposables.push(monaco.editor.addKeybindingRules([{ keybinding: p.keybinding, command: id, when }]));
    }
    this.byExt.set(ext.id, { disposables, entries, palette, skipped });
    if (skipped.length) this.onReport(ext.id, skipped);
  }

  remove(id) {
    const e = this.byExt.get(id);
    if (!e) return;
    for (const d of e.disposables) { try { d?.dispose(); } catch { /* ya fuera */ } }
    const list = paletteList();
    if (list) for (const p of e.palette) { const i = list.indexOf(p); if (i >= 0) list.splice(i, 1); }
    for (const [k, owner] of [...this.chords]) if (owner === id) this.chords.delete(k);
    this.byExt.delete(id);
  }

  entries() { return [...this.byExt.values()].flatMap(e => e.entries); }
  skipped(id) { return this.byExt.get(id)?.skipped || []; }
  dispose() { for (const id of [...this.byExt.keys()]) this.remove(id); }
}
