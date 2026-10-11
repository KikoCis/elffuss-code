// Modo básico de Elffuss Code: órdenes deterministas sin modelo.
// La ayuda sale en el idioma de la interfaz (antes siempre en español, también
// con la interfaz en inglés, que decía «Settings → Brain» donde la ayuda decía
// «Ajustes → Cerebro»), y las órdenes se entienden en los dos idiomas: una
// ayuda en inglés que solo entendiera «árbol» mentiría.
import { t } from '../i18n.js';
export const name = 'Básico (sin modelo)';
export async function load() {}

const call = obj => '```tool\n' + JSON.stringify(obj) + '\n```';

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

  const low = text.toLowerCase();
  if (/(árbol|arbol|estructura|qué hay|que hay|\btree\b|\bstructure\b|what'?s in)/.test(low))
    return call({ tool: 'code.tree', args: {} });
  const mRead = text.match(/(?:lee|abre|muestra|cat|read|open|show)\s+([\w./-]+\.\w+)/i);
  if (mRead) return call({ tool: 'code.read', args: { path: mRead[1] } });
  const mSearch = text.match(/(?:busca(?:r)?\s+(?:d[oó]nde\s+)?(?:se\s+\w+\s+)?|(?:search|find)\s+(?:for\s+)?)["«“']?([^"»”']{2,60})["»”']?$/i);
  if (mSearch) return call({ tool: 'code.search', args: { query: mSearch[1].trim() } });
  const mWrite = text.match(/(?:escribe|write)\s+([\w./-]+\.\w+)\s*[:=]\s*([\s\S]+)/i);
  if (mWrite) return call({ tool: 'code.write', args: { path: mWrite[1], content: mWrite[2] } });

  if (/^(hola|buenas|hey|hi|hello)\b/.test(low)) return t('rulesHello') + ' ' + t('rulesHelp');
  return t('rulesHelp');
}
