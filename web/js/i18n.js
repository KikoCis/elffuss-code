// i18n ligero del «chrome» de Elffuss Code. El modelo ya responde en el idioma
// del navegador (agent.js → userLang); esto localiza los textos estáticos y de
// runtime de la UI (placeholder, indicadores «pensando/escribe», estado del
// modelo, saludo del proyecto, la Mente). ES por defecto — cero impacto en
// usuarios españoles — con inglés de fallback. Sustitución simple {var}.
const L = {
  es: {
    ph: 'Pídele código a Elffuss…',
    thinking: 'Elffuss está pensando', writing: 'Elffuss escribe · {n} car.', using: 'Elffuss usa {name}',
    modelLoading: 'Descargando el modelo IA · {pct}% · {loaded}/{total} MB',
    modelReady: 'Modelo IA listo', modelReadyBadge: 'Modelo IA listo · готово ✳',
    welcome: 'Привіт 👋 Proyecto «{name}» abierto. Pregúntame por el código, pídeme cambios o dime «árbol». Todo se queda en tu máquina.',
    mindTitle: 'MENTE DE ELFFUSS', avatarTitle: 'Mente de Elffuss — cerebro autónomo',
    // landing (estático) + tooltips de la barra/toolbar
    tagline: 'Abre tu carpeta de código y programa con una elfa al lado.',
    tagline2: 'Editor tipo VS Code + agente <b>en tu navegador</b>. Nada sale de tu máquina. 😉',
    openProject: '📁 Abrir carpeta de código', resume: 'Reanudar', discard: 'Descartar', cloneOpen: 'Descargar y abrir',
    clonePh: 'pega la URL de un repo público (GitHub/Bitbucket)…',
    searchPh: 'Buscar archivos por nombre (: para ir a línea, @ para símbolo, > para comandos)',
    tFiles: 'Explorador', tSearch: 'Buscar (Cmd/Ctrl+P)', tArch: 'Arquitectura (grafo de dependencias)',
    tCity: 'Ciudad 3D', tTerm: 'Terminal (Ctrl+`)', tSkills: 'Skills', tActSettings: 'Ajustes y modelo',
    tGitBranch: 'rama actual', tHistory: 'Historial de conversaciones', tTopSettings: 'Ajustes, modelo y API keys',
    tTermClose: 'cerrar (Ctrl+`)', tTermResize: 'arrastra para redimensionar',
    tCtx: 'contexto acumulado en la conversación', tPlus: 'Adjuntar archivo del proyecto (@)',
    tAutoedit: 'Editar archivos automáticamente',
    tGoal: 'Modo Objetivo: descompone el mensaje en tareas y las ejecuta una a una (planificador + ejecutor)',
    tFlip: 'cambiar entre chat y editor', tSlash: 'Comandos',
    // pass-3: chrome profundo del IDE (paleta, menús, historial, ajustes, notifs)
    tabClose: 'Cerrar pestaña (no borra la conversación)', newConv: 'Nueva conversación',
    histEmpty: 'Sin conversaciones guardadas todavía.', histDel: 'Eliminar para siempre',
    confirmDel: '¿Eliminar «{title}» para siempre?', thisConv: 'esta conversación',
    cmdsSep: 'Comandos', slTree: 'árbol del proyecto', slSearch: 'buscar en el código',
    slSkills: 'gestionar skills', slModel: 'proveedores y modelo', slClear: 'nueva conversación',
    pTree: 'árbol', pSearch: 'busca ', pCommit: 'resume los cambios y prepárame el mensaje de commit',
    pProposal: 'Implementa esta propuesta de mejora con cambios reales en el código:\n\n',
    attachSep: 'Adjuntar al mensaje (@)', attachOpen: 'archivo abierto', openProjFirst: 'Abre un proyecto primero',
    autoTxt: 'Auto', reviewTxt: 'Revisar',
    autoOn: 'Editar archivos automáticamente (clic para revisar antes)',
    autoOff: 'Pedir confirmación antes de escribir (clic para automático)',
    pSearchCode: 'Buscar en el código…', pManageSkills: 'Gestionar skills', pToggleExplorer: 'Alternar explorador',
    pToggleTerm: 'Alternar terminal', pSave: 'Guardar (Ctrl+S)', palCmd: 'comando',
    palGotoSym: 'Ir a símbolo en el editor…', palEmpty: 'Sin resultados',
    mNewFile: 'Nuevo archivo…', promptNewPath: 'Ruta del nuevo archivo:', mSave: 'Guardar', mOpenFolder: 'Abrir carpeta…',
    mSearchCode: 'Buscar en el código', mGotoFile: 'Ir a archivo…', mGotoSym: 'Ir a símbolo…',
    mTerminal: 'Terminal', mArch: 'Arquitectura', mAbout: 'Acerca de Elffuss Code (GitHub)',
    gNotRepo: 'No es un repositorio git', gBranch: 'Rama: {b}', gLast: 'Último: {m}', gCommit: 'Pídele a Elffuss que commitee',
    nExec: '▶ Ejecutar', nView: 'Ver en la Mente',
    fallbackToast: 'Ese Gemma no cargó (memoria/GPU) — uso Elffuss LM (ligero)…',
    setStoreTitle: 'Modelo descargado (se cachea en tu navegador)', setClear: 'Vaciar caché', setClearing: 'Vaciando…',
    setCached: '{gb} en caché', setNone: 'Nada cacheado todavía',
    setBrToken: 'Token (lo imprime el programa al arrancarlo)', brTokenPh: 'pega aquí el token…',
    setFeedbackPh: 'Cuéntanos qué ha pasado o qué te gustaría que hiciera…',
    lblModel: 'Modelo', lblApiKey: 'API key',
    setCalc: 'Calculando espacio…', setPersist: '✓ almacenamiento persistente (no se borra solo)',
    setNoPersist: '⚠ sin persistencia: el navegador podría desalojarlo', setLimit: ' · límite ~{gb}',
    setModelPh: 'modelo (p. ej. gpt-4o-mini)', keyNeeded: 'clave (no necesaria)',
  },
  en: {
    ph: 'Ask Elffuss for code…',
    thinking: 'Elffuss is thinking', writing: 'Elffuss writes · {n} chars', using: 'Elffuss uses {name}',
    modelLoading: 'Downloading AI model · {pct}% · {loaded}/{total} MB',
    modelReady: 'AI model ready', modelReadyBadge: 'AI model ready · готово ✳',
    welcome: 'Привіт 👋 Project “{name}” open. Ask me about the code, request changes, or say “tree”. Everything stays on your machine.',
    mindTitle: 'ELFFUSS MIND', avatarTitle: 'Elffuss Mind — autonomous brain',
    tagline: 'Open your code folder and program with an elf by your side.',
    tagline2: 'VS Code–style editor + agent <b>in your browser</b>. Nothing leaves your machine. 😉',
    openProject: '📁 Open code folder', resume: 'Resume', discard: 'Discard', cloneOpen: 'Download & open',
    clonePh: 'paste the URL of a public repo (GitHub/Bitbucket)…',
    searchPh: 'Search files by name (: to go to line, @ for symbol, > for commands)',
    tFiles: 'Explorer', tSearch: 'Search (Cmd/Ctrl+P)', tArch: 'Architecture (dependency graph)',
    tCity: '3D City', tTerm: 'Terminal (Ctrl+`)', tSkills: 'Skills', tActSettings: 'Settings & model',
    tGitBranch: 'current branch', tHistory: 'Conversation history', tTopSettings: 'Settings, model & API keys',
    tTermClose: 'close (Ctrl+`)', tTermResize: 'drag to resize',
    tCtx: 'context accumulated in the conversation', tPlus: 'Attach a project file (@)',
    tAutoedit: 'Edit files automatically',
    tGoal: 'Goal mode: breaks the message into tasks and runs them one by one (planner + executor)',
    tFlip: 'switch between chat and editor', tSlash: 'Commands',
    tabClose: 'Close tab (doesn’t delete the conversation)', newConv: 'New conversation',
    histEmpty: 'No saved conversations yet.', histDel: 'Delete forever',
    confirmDel: 'Delete “{title}” forever?', thisConv: 'this conversation',
    cmdsSep: 'Commands', slTree: 'project tree', slSearch: 'search the code',
    slSkills: 'manage skills', slModel: 'providers & model', slClear: 'new conversation',
    pTree: 'tree', pSearch: 'search ', pCommit: 'summarize the changes and prepare my commit message',
    pProposal: 'Implement this improvement proposal with real changes to the code:\n\n',
    attachSep: 'Attach to message (@)', attachOpen: 'open file', openProjFirst: 'Open a project first',
    autoTxt: 'Auto', reviewTxt: 'Review',
    autoOn: 'Edit files automatically (click to review first)',
    autoOff: 'Ask before writing (click for automatic)',
    pSearchCode: 'Search the code…', pManageSkills: 'Manage skills', pToggleExplorer: 'Toggle explorer',
    pToggleTerm: 'Toggle terminal', pSave: 'Save (Ctrl+S)', palCmd: 'command',
    palGotoSym: 'Go to symbol in editor…', palEmpty: 'No results',
    mNewFile: 'New file…', promptNewPath: 'New file path:', mSave: 'Save', mOpenFolder: 'Open folder…',
    mSearchCode: 'Search the code', mGotoFile: 'Go to file…', mGotoSym: 'Go to symbol…',
    mTerminal: 'Terminal', mArch: 'Architecture', mAbout: 'About Elffuss Code (GitHub)',
    gNotRepo: 'Not a git repository', gBranch: 'Branch: {b}', gLast: 'Latest: {m}', gCommit: 'Ask Elffuss to commit',
    nExec: '▶ Run', nView: 'View in the Mind',
    fallbackToast: 'That Gemma didn’t load (memory/GPU) — using Elffuss LM (light)…',
    setStoreTitle: 'Downloaded model (cached in your browser)', setClear: 'Clear cache', setClearing: 'Clearing…',
    setCached: '{gb} cached', setNone: 'Nothing cached yet',
    setBrToken: 'Token (printed by the program on startup)', brTokenPh: 'paste the token here…',
    setFeedbackPh: 'Tell us what happened or what you’d like it to do…',
    lblModel: 'Model', lblApiKey: 'API key',
    setCalc: 'Calculating space…', setPersist: '✓ persistent storage (won’t be auto-cleared)',
    setNoPersist: '⚠ not persistent: the browser could evict it', setLimit: ' · limit ~{gb}',
    setModelPh: 'model (e.g. gpt-4o-mini)', keyNeeded: 'key (not needed)',
  },
};

// Idioma del chrome: 2 letras, ES por defecto.
export function uiLang() {
  return (navigator.language || 'es').slice(0, 2).toLowerCase();
}

// Traduce una clave de runtime con sustitución {var}. Fallback: idioma →
// inglés → la propia clave.
export function t(key, vars) {
  const s = (L[uiLang()] || L.en)[key] ?? L.en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '')) : s;
}

// Textos estáticos del HTML (landing, placeholders, tooltips) que no pasan por
// t() en runtime. Se cablean una vez al arrancar; ES es el HTML por defecto.
export function applyI18n() {
  document.documentElement.lang = uiLang();
  const set = (sel, prop, key) => { const e = document.querySelector(sel); if (e) e[prop] = t(key); };
  set('#prompt', 'placeholder', 'ph');
  const tag = document.querySelector('#landing .tag');
  if (tag) tag.innerHTML = `${t('tagline')}<br>${t('tagline2')}`;
  set('#open-project', 'textContent', 'openProject');
  set('#resume-clone-btn', 'textContent', 'resume');
  set('#discard-clone-btn', 'textContent', 'discard');
  set('#clone-btn', 'textContent', 'cloneOpen');
  set('#clone-url', 'placeholder', 'clonePh');
  set('#pal-input', 'placeholder', 'searchPh');
  const titles = {
    '#act-files': 'tFiles', '#act-search': 'tSearch', '#act-arch': 'tArch', '#act-city': 'tCity',
    '#act-term': 'tTerm', '#act-skills': 'tSkills', '#act-settings': 'tActSettings',
    '#git-branch': 'tGitBranch', '#btn-history': 'tHistory', '#btn-settings': 'tTopSettings',
    '#term-close': 'tTermClose', '#term-resize': 'tTermResize', '#ctx-meter': 'tCtx',
    '#btn-plus': 'tPlus', '#btn-autoedit': 'tAutoedit', '#btn-goal': 'tGoal',
    '#code-flip': 'tFlip', '#btn-slash': 'tSlash',
  };
  for (const [sel, key] of Object.entries(titles)) set(sel, 'title', key);
}
