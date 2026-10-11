// Stand-in for the keyboard layout tables of VS Code's keybinding service. The
// sandbox never receives key events (Code's page binds the keys and runs the
// commands), so it needs no layout tables: the service falls back to the
// browser's own layout information.
export class KeyboardLayoutContribution {
  static INSTANCE = new KeyboardLayoutContribution();
  get layoutInfos() { return []; }
  registerKeyboardLayout() {}
}
