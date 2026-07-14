// Stub de code-ownership: Elffuss Code no alimenta metadatos de propiedad, así
// que makeOwnerResolver devuelve siempre null (file.owner = null en model.js).
// El original (Sendery/VibeCodeViewer, Apache-2.0) parsea CODEOWNERS/package
// meta; aquí no hace falta para dibujar la ciudad.
export function makeOwnerResolver() { return () => null; }
