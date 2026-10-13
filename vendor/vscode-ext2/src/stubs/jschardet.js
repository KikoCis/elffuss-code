// Stand-in for jschardet (LGPL-2.1), which is not shipped. VS Code only uses it
// to guess the encoding of bytes read from disk. The sandbox never reads files:
// Code's page hands it text, so there is never anything to guess.
export function detect() { return null; }
export function detectAll() { return []; }
export function enableDebug() {}
export default { detect, detectAll, enableDebug };
