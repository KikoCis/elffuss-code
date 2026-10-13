// Stand-in for @vscode/diff, the optional external diff algorithm (it ships a
// wasm binary and spawns its own worker from a URL). VS Code only loads it when
// diffEditor.diffAlgorithm names it; the sandbox never shows a diff editor and
// keeps VS Code's built-in algorithm.
const unavailable = () => Promise.reject(new Error('The external diff algorithm is not available in Elffuss Code.'));
export const createDiffComputer = unavailable;
export const createWorkerDiffComputer = unavailable;
export default { createDiffComputer, createWorkerDiffComputer };
