// Modo Objetivo (🎯 Goal): mismo patrón planificador/ejecutor que clonagent
// (~/work2026/clonagent) — un PLANIFICADOR descompone el objetivo en una
// lista de tareas con estado (pending/in-progress/done/failed/skipped), y un
// EJECUTOR las va ejecutando una a una hasta que no queda ninguna pendiente,
// marcando el resultado de cada una. Si una tarea falla, las siguientes se
// saltan (cascada) en vez de seguir a ciegas — igual que el fallo→skip de
// dependencias de clonagent.
//
// Aquí el "ejecutor" de cada tarea es el MISMO bucle de tool-calling que ya
// usa el chat normal (agent.handle): cada tarea del plan se manda como si
// fuera un mensaje de usuario, con todo el historial previo como contexto —
// así una tarea puede apoyarse en lo que hizo la anterior, igual que la
// sesión del ejecutor de clonagent tiene a la vista el fichero de tareas
// entero.
import { toolHelp, snapshot } from './tools/index.js';

const MAX_TASK_RETRIES = 2;
const TASK_PREFIX = '[tarea-objetivo] ';

function plannerPrompt(goalText, context) {
  return `ROL: PLANIFICADOR

Objetivo del usuario: "${goalText}"

CONTEXTO AHORA (estado real del IDE):
${context}

Herramientas disponibles para la fase de EJECUCIÓN (aquí solo planificas, no las llames):
${toolHelp()}

Descompón el objetivo en una lista de tareas CONCRETAS, ORDENADAS y ejecutables una tras otra con esas herramientas. Entre 2 y 6 tareas normalmente basta — no fragmentes de más, cada tarea debe ser un paso real con sentido propio.

Responde SOLO con este JSON, nada de texto ni fences alrededor:
{"plan": "una frase resumiendo el enfoque", "tasks": [{"title": "título corto", "description": "qué hay que hacer, concreto y accionable"}]}`;
}

// Extrae el primer objeto JSON balanceado del texto (el modelo a veces mete
// prosa alrededor pese a la instrucción de "SOLO JSON").
function extractJson(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') inStr = !inStr;
    else if (!inStr) {
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

// Llamada ÚNICA al modelo con el rol de planificador — no toca agent.history
// (el plan resultante se guarda aparte; el objetivo en sí SÍ se añade al
// historial en runGoal, para que las tareas puedan apoyarse en él).
export async function planGoal(agent, goalText) {
  const context = await snapshot().catch(() => '');
  const raw = await agent.provider.chat([{ role: 'user', content: goalText }], plannerPrompt(goalText, context), () => {});
  const parsed = extractJson(raw);
  if (!parsed || !Array.isArray(parsed.tasks) || !parsed.tasks.length) {
    throw new Error('el planificador no devolvió una lista de tareas válida');
  }
  return {
    planText: String(parsed.plan || '').trim(),
    tasks: parsed.tasks.slice(0, 10).map(t => ({
      title: String(t.title || 'tarea').trim(),
      description: String(t.description || t.title || '').trim(),
    })),
  };
}

function clonePlan(plan) { return JSON.parse(JSON.stringify(plan)); }

// Orquesta plan → ejecución. onEvent es el MISMO canal que usa el chat
// normal (conversations.js lo conecta a onConvEvent) — los eventos de las
// tareas (token/tool/tool_result/text/error) se reenvían tal cual, y además
// se emiten 'plan' / 'plan_update' / 'plan_complete' para la tarjeta de plan.
export async function runGoal(conv, goalText, onEvent) {
  conv.agent.history.push({ role: 'user', content: TASK_PREFIX + 'Objetivo: ' + goalText });

  const plan = {
    id: 'g' + Date.now().toString(36), goal: goalText, planText: '', status: 'planning',
    tasks: [], createdAt: Date.now(), updatedAt: Date.now(),
  };
  conv.plan = plan;
  onEvent({ type: 'plan', plan: clonePlan(plan) });

  let parsed;
  try {
    parsed = await planGoal(conv.agent, goalText);
  } catch (e) {
    plan.status = 'failed';
    plan.updatedAt = Date.now();
    onEvent({ type: 'plan_update', plan: clonePlan(plan) });
    onEvent({ type: 'error', text: 'No pude planificar el objetivo: ' + e.message });
    return;
  }

  plan.planText = parsed.planText;
  plan.tasks = parsed.tasks.map((t, i) => ({
    id: 't' + (i + 1), title: t.title, description: t.description,
    status: 'pending', retries: 0, result: '',
  }));
  plan.status = 'running';
  plan.updatedAt = Date.now();
  onEvent({ type: 'plan_update', plan: clonePlan(plan) });

  let cascadeFail = false;
  for (const task of plan.tasks) {
    if (cascadeFail) { task.status = 'skipped'; plan.updatedAt = Date.now(); onEvent({ type: 'plan_update', plan: clonePlan(plan) }); continue; }

    task.status = 'in-progress';
    plan.updatedAt = Date.now();
    onEvent({ type: 'plan_update', plan: clonePlan(plan) });

    const taskPrompt = `${TASK_PREFIX}Tarea ${task.id} del objetivo «${goalText}»: ${task.title}\n${task.description}`;
    let done = false;
    while (!done && task.retries <= MAX_TASK_RETRIES) {
      let sawError = false, errText = '';
      await conv.agent.handle(taskPrompt, ev => {
        if (ev.type === 'error') { sawError = true; errText = ev.text; }
        onEvent(ev);
      });
      if (!sawError) { done = true; }
      else {
        task.retries++;
        task.result = errText;
        if (task.retries > MAX_TASK_RETRIES) break;
      }
    }
    task.status = done ? 'done' : 'failed';
    plan.updatedAt = Date.now();
    onEvent({ type: 'plan_update', plan: clonePlan(plan) });
    if (!done) cascadeFail = true; // el resto se saltan, igual que la cascada de dependencias fallidas en clonagent
  }

  plan.status = plan.tasks.some(t => t.status === 'failed') ? 'failed' : 'done';
  plan.updatedAt = Date.now();
  onEvent({ type: 'plan_complete', plan: clonePlan(plan) });
}

export { TASK_PREFIX };
