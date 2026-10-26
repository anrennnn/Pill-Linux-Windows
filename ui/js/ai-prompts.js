// Prompts y validación de respuestas de la IA. Sin efectos: se prueban con node.

import { extractJson } from "./core.js";

const SYSTEM = `Eres el asistente de productividad de FocusPill. Respondes siempre en español, con frases cortas y concretas.
Nunca inventas tareas, reuniones ni datos que no estén en el contexto.`;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function list(items, render) {
  return items.length ? items.map(render).join("\n") : "(ninguna)";
}

/** Plan del día: propone bloques de trabajo alrededor de las reuniones. */
export function planMessages(ctx) {
  const user = `Ahora son las ${ctx.now} del ${ctx.dateLabel}. Mi jornada termina a las ${ctx.dayEnd}.
Uso bloques de foco de ${ctx.focusMin} minutos con descansos de ${ctx.breakMin}.

Prioridades de hoy (id · tarea · minutos ya dedicados):
${list(ctx.today, (t) => `- ${t.id} · ${t.text} · ${t.minutes}`)}

Bandeja (opcional, solo si sobra tiempo):
${list(ctx.inbox, (t) => `- ${t.id} · ${t.text}`)}

Reuniones y bloques ya fijados (no los muevas ni los solapes):
${list(ctx.agenda, (e) => `- ${e.start}–${e.end} ${e.title}`)}

Devuelve SOLO un JSON con esta forma:
{"resumen":"una frase","bloques":[{"inicio":"HH:MM","minutos":50,"tarea_id":"id o null","titulo":"texto"}],"consejo":"una frase"}
Reglas: empieza después de ${ctx.now}, termina antes de ${ctx.dayEnd}, no solapes reuniones, prioriza las tareas de hoy y usa sus ids exactos.`;
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ];
}

/** Valida y limpia el plan que devuelve el modelo. */
export function parsePlan(text, validIds = []) {
  const data = extractJson(text);
  if (!data || !Array.isArray(data.bloques)) return null;
  const ids = new Set(validIds);
  const blocks = data.bloques
    .map((b) => ({
      start: String(b.inicio || "").trim().padStart(5, "0"),
      minutes: Math.round(Number(b.minutos)),
      taskId: ids.has(b.tarea_id) ? b.tarea_id : null,
      title: String(b.titulo || "").trim().slice(0, 120),
    }))
    .filter((b) => TIME.test(b.start) && b.minutes >= 5 && b.minutes <= 240 && (b.taskId || b.title))
    .sort((a, b) => a.start.localeCompare(b.start));
  return {
    summary: String(data.resumen || "").slice(0, 400),
    tip: String(data.consejo || "").slice(0, 400),
    blocks,
  };
}

/** Cierre del día. */
export function closeMessages(ctx) {
  const user = `Resume mi día (${ctx.dateLabel}).

Hecho hoy:
${list(ctx.done, (t) => `- ${t}`)}

Pendiente:
${list(ctx.pending, (t) => `- ${t}`)}

Minutos de foco: ${ctx.focusMinutes} (meta ${ctx.goal}). Bloques completados: ${ctx.blocks}.
Tiempo en apps productivas: ${ctx.productive}. En distracciones: ${ctx.distraction}.

Devuelve SOLO un JSON: {"resumen":"2-3 frases honestas y amables","logros":["..."],"aprender":"una frase sobre qué mejorar","mañana":["hasta 3 prioridades sugeridas, sacadas de lo pendiente"]}`;
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ];
}

export function parseClose(text) {
  const data = extractJson(text);
  if (!data) return text?.trim() ? { summary: text.trim().slice(0, 1200), wins: [], learn: "", tomorrow: [] } : null;
  const arr = (v) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 200)).filter(Boolean).slice(0, 6) : []);
  return {
    summary: String(data.resumen || "").slice(0, 1200),
    wins: arr(data.logros),
    learn: String(data.aprender || "").slice(0, 400),
    tomorrow: arr(data["mañana"] ?? data.manana).slice(0, 3),
  };
}

/** Texto para guardar el cierre como nota o en Notion. */
export function closeToText(close, dateLabel) {
  const parts = [`Cierre del día · ${dateLabel}`, close.summary];
  if (close.wins.length) parts.push("Logros:\n" + close.wins.map((w) => `• ${w}`).join("\n"));
  if (close.learn) parts.push("Para mejorar: " + close.learn);
  if (close.tomorrow.length) parts.push("Mañana:\n" + close.tomorrow.map((w) => `• ${w}`).join("\n"));
  return parts.filter(Boolean).join("\n\n");
}

/** Clasificar una captura: tarea para hoy, tarea para la bandeja o nota. */
export function classifyMessages(text) {
  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Clasifica esta captura rápida: "${text.replace(/"/g, "'")}"
Devuelve SOLO un JSON: {"tipo":"tarea" o "nota","lista":"hoy" o "bandeja","texto":"la captura limpia y breve, en imperativo si es tarea"}
Es "hoy" solo si dice explícitamente hoy, urgente o ahora.`,
    },
  ];
}

export function parseClassify(text, original) {
  const data = extractJson(text);
  if (!data) return null;
  const type = data.tipo === "nota" ? "note" : "task";
  const list = data.lista === "hoy" ? "today" : "inbox";
  const clean = String(data.texto || "").trim();
  // Si el modelo se aleja demasiado del original, conservamos lo que escribió el usuario.
  const safe = clean && clean.length <= Math.max(160, original.length * 2) ? clean : original;
  return { type, list, text: safe };
}

/** Pregunta libre con el contexto de tareas. */
export function askMessages(question, ctx, history = []) {
  const context = `Contexto (no lo repitas salvo que haga falta):
Prioridades: ${ctx.today.map((t) => t.text).join("; ") || "ninguna"}
Bandeja: ${ctx.inbox.map((t) => t.text).join("; ") || "vacía"}
Agenda: ${ctx.agenda.map((e) => `${e.start} ${e.title}`).join("; ") || "libre"}
Foco hoy: ${ctx.focusMinutes} min.`;
  return [
    { role: "system", content: `${SYSTEM}\n${context}` },
    ...history.slice(-6),
    { role: "user", content: question },
  ];
}
