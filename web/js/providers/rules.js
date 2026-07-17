// Modo básico de Elffuss Code: órdenes deterministas sin modelo.
export const name = 'Básico (sin modelo)';
export async function load() {}

const call = obj => '```tool\n' + JSON.stringify(obj) + '\n```';

const HELP = `Estoy en modo básico (sin modelo). Entiendo:
• «árbol» / «qué hay en el proyecto»
• «lee <archivo>» · «abre <archivo>»
• «busca <texto>»
• «escribe <archivo>: <contenido>»
Para programar de verdad, carga el modelo local (selector 🧠) o configura uno en ⚙️.`;

export async function chat(history, systemPrompt) {
  const last = history[history.length - 1];
  const text = (last?.content || '').trim();

  // 🎯 Modo Objetivo (goal.js) también funciona en modo básico: un plan fijo
  // de 2 tareas (explorar + escribir), para poder probar/usar el planificador
  // sin depender de un modelo real cargado.
  if (/^ROL: PLANIFICADOR/.test(systemPrompt || '')) {
    return JSON.stringify({
      plan: 'Plan básico (sin modelo) para: ' + text.slice(0, 60),
      tasks: [
        { title: 'Explorar el proyecto', description: 'Mira el árbol del proyecto para entender qué hay.' },
        { title: 'Escribir el resultado', description: 'escribe objetivo.txt: ' + text },
      ],
    });
  }

  if (text.startsWith('[resultado')) {
    const body = text.slice(text.indexOf('\n') + 1).trim();
    return body.startsWith('ERROR:') ? 'No pude: ' + body.slice(6).trim() : body;
  }

  const t = text.toLowerCase();
  if (/(árbol|arbol|estructura|qué hay|que hay)/.test(t))
    return call({ tool: 'code.tree', args: {} });
  const mRead = text.match(/(?:lee|abre|muestra|cat)\s+([\w./-]+\.\w+)/i);
  if (mRead) return call({ tool: 'code.read', args: { path: mRead[1] } });
  const mSearch = text.match(/busca(?:r)?\s+(?:d[oó]nde\s+)?(?:se\s+\w+\s+)?["«']?([^"»']{2,60})["»']?$/i);
  if (mSearch) return call({ tool: 'code.search', args: { query: mSearch[1].trim() } });
  const mWrite = text.match(/escribe\s+([\w./-]+\.\w+)\s*[:=]\s*([\s\S]+)/i);
  if (mWrite) return call({ tool: 'code.write', args: { path: mWrite[1], content: mWrite[2] } });

  if (/^(hola|buenas|hey|hi)\b/.test(t)) return '¡Hola! ' + HELP;
  return HELP;
}
