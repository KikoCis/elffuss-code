// Atajos de teclado de las extensiones (contributes.keybindings) → Monaco.
// Solo valen con el foco en el editor, y NUNCA pisan los de Code (paleta,
// guardar, terminal, ir a símbolo), los de edición básica ni los del
// navegador (cerrar pestaña, recargar…): esos se saltan y se informa.

const MOD = { CtrlCmd: 2048, Shift: 1024, Alt: 512, WinCtrl: 256 };

// nombre de tecla de VS Code → KeyCode de Monaco 0.52
const NAMED = {
  enter: 'Enter', escape: 'Escape', backspace: 'Backspace', tab: 'Tab', space: 'Space', delete: 'Delete', insert: 'Insert',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', up: 'UpArrow', down: 'DownArrow', left: 'LeftArrow', right: 'RightArrow',
  '-': 'Minus', '=': 'Equal', '[': 'BracketLeft', ']': 'BracketRight', '\\': 'Backslash', ';': 'Semicolon', "'": 'Quote',
  '`': 'Backquote', ',': 'Comma', '.': 'Period', '/': 'Slash',
  numpad_multiply: 'NumpadMultiply', numpad_add: 'NumpadAdd', numpad_subtract: 'NumpadSubtract', numpad_decimal: 'NumpadDecimal',
  numpad_divide: 'NumpadDivide', numpad_separator: 'NUMPAD_SEPARATOR',
};

function keyCode(monaco, name) {
  const KC = monaco.KeyCode;
  if (/^[a-z]$/.test(name)) return KC['Key' + name.toUpperCase()];
  if (/^[0-9]$/.test(name)) return KC['Digit' + name];
  if (/^f([1-9]|1[0-9])$/.test(name)) return KC[name.toUpperCase()];
  if (/^numpad[0-9]$/.test(name)) return KC['Numpad' + name.slice(6)];
  return NAMED[name] ? KC[NAMED[name]] : undefined;
}

export const platformOf = (nav = globalThis.navigator) => (/Mac|iPhone|iPad/.test(nav?.platform || nav?.userAgent || '') ? 'mac' : /Win/.test(nav?.platform || nav?.userAgent || '') ? 'win' : 'linux');

// «ctrl+shift+k» → número de Monaco; null si no se entiende
export function parsePart(monaco, part, platform) {
  const bits = part.toLowerCase().split('+').map(x => x.trim()).filter(Boolean);
  if (!bits.length) return null;
  const key = bits.pop();
  let mods = 0;
  for (const b of bits) {
    if (b === 'shift') mods |= MOD.Shift;
    else if (b === 'alt' || b === 'option') mods |= MOD.Alt;
    else if (b === 'ctrl') mods |= platform === 'mac' ? MOD.WinCtrl : MOD.CtrlCmd;
    else if (b === 'cmd' || b === 'meta' || b === 'win') mods |= platform === 'mac' ? MOD.CtrlCmd : MOD.WinCtrl;
    else return null;
  }
  const kc = keyCode(monaco, key);
  return kc === undefined ? null : (mods | kc);
}

// entrada de contributes.keybindings → { keybinding, chord: [a, b?], when } | { skip: motivo }
export function parseKeybinding(monaco, kb, platform = platformOf()) {
  if (!kb || typeof kb !== 'object' || typeof kb.command !== 'string') return { skip: 'invalid' };
  const src = typeof kb[platform] === 'string' ? kb[platform] : typeof kb.key === 'string' ? kb.key : null;
  if (!src) return { skip: 'no key for this platform' };
  const parts = src.trim().split(/\s+/);
  if (parts.length > 2) return { skip: 'more than two chords' };
  const chord = parts.map(p => parsePart(monaco, p, platform));
  if (chord.some(c => c === null)) return { skip: 'unknown key ' + src };
  const reserved = reservedChords(monaco);
  if (reserved.has(chord[0])) return { skip: 'reserved by Elffuss Code or the browser', key: src };
  const keybinding = chord.length === 2 ? monaco.KeyMod.chord(chord[0], chord[1]) : chord[0];
  const when = typeof kb.when === 'string' && kb.when.trim() ? kb.when.trim().slice(0, 2000) : null;
  return { keybinding, chord, key: src, when, command: kb.command, args: kb.args };
}

let reservadas = null;
export function reservedChords(monaco) {
  if (reservadas) return reservadas;
  const KC = monaco.KeyCode;
  const C = MOD.CtrlCmd, S = MOD.Shift, A = MOD.Alt, W = MOD.WinCtrl;
  const set = new Set([
    // de Code: paleta, comandos, terminal, guardar, F1, ir a símbolo
    C | KC.KeyP, C | S | KC.KeyP, W | KC.Backquote, C | KC.Backquote, C | KC.KeyS, KC.F1, C | S | KC.KeyO,
    // edición básica
    C | KC.KeyZ, C | S | KC.KeyZ, C | KC.KeyY, C | KC.KeyX, C | KC.KeyC, C | KC.KeyV, C | KC.KeyA, C | KC.KeyF, C | KC.KeyH, C | A | KC.KeyF,
    // del navegador
    C | KC.KeyW, C | KC.KeyT, C | KC.KeyN, C | KC.KeyQ, C | KC.KeyL, C | KC.KeyR, C | S | KC.KeyT, C | S | KC.KeyN, C | S | KC.KeyW,
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => C | KC['Digit' + n]),
  ]);
  reservadas = set;
  return set;
}
