// Tema «hacker» de VibeCodeViewer (Sendery/VibeCodeViewer, Apache-2.0),
// copiado de src/themes.js. Es la paleta que consume builder.js.
export const THEME = {
  label: 'Hacker',
  light: false,
  background: 0x020309, fog: 0x030510,
  bloom: { strength: 0.65, threshold: 0.85 },
  roleColor: {
    distrito: [0.16, 0.07, 0.30], urbanizacion: [0.13, 0.09, 0.30],
    edificio: [0.10, 0.30, 0.36], planta: [0.06, 0.20, 0.26],
    apartamento: [0.05, 0.16, 0.21], habitacion: [0.045, 0.13, 0.18],
    archivador: [0.04, 0.11, 0.15], cajon: [0.035, 0.10, 0.13],
  },
  hi: [0.28, 3.0, 3.6],
  fileBase: [0.05, 0.22, 0.28], fileHi: [1.0, 5.0, 6.0],
  glass: [0.12, 0.55, 0.65], glassHi: [0.3, 2.4, 2.8],
  ground: {
    bg: '#04050b', grid: 'rgba(50, 80, 140, 0.07)',
    traceA: [112, 60, 235], traceB: [40, 200, 235],
    padA: [170, 120, 255], padB: [120, 240, 255],
  },
  facade: {
    text: 'rgba(140, 232, 250, 0.72)', hot: '#c8ffff',
    hotGlow: 'rgba(0,255,255,0.9)', hotBg: 'rgba(0,255,255,0.16)',
  },
  labels: { district: '#a86cff', urb: '#8a7bff', building: '#49e8ff' },
  beam: [2.6, 1.1, 0.25], beamIn: [3.4, 0.5, 0.8], fill: [0.08, 0.75, 0.95], slab: [0.1, 0.5, 0.6],
};
