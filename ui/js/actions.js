// Acciones de la app: tareas, foco, agenda, IA e integraciones.

import { invoke } from "./bridge.js";
import {
  MAX_TODAY, addDays, agendaFor, atTime, breakAfter, categorize, completeTask, dayKey, expandEvents, hhmm,
  minutesOn, moveItem, parseCapture, parseDay, parseIcs, phaseMs, remainingMs, rollover, sortTasks, uid, usageSummary,
} from "./core.js";
import { askMessages, classifyMessages, closeMessages, closeToText, parseClassify, parseClose, parsePlan, planMessages } from "./ai-prompts.js";
import { F, S, commit, state } from "./store.js";
import { chime, playAmbient, stopAmbient } from "./sounds.js";
import { flash, toast, track, ui } from "./ui.js";

const rerender = () => commit({ render: true });

/* ============================================================
   Tareas
   ============================================================ */
export const listTasks = (list) => sortTasks(state.tasks.filter((t) => t.list === list && !t.done));
export const todayTasks = () => listTasks("today");
export const inboxTasks = () => listTasks("inbox");
export const scheduledTasks = () => sortTasks(state.tasks.filter((t) => t.list === "scheduled" && !t.done));
export const doneToday = () => state.tasks.filter((t) => t.done && dayKey(t.doneAt) === dayKey());
export const findTask = (id) => state.tasks.find((t) => t.id === id);

export function currentTask() {
  const pinned = findTask(F().taskId);
  if (pinned && !pinned.done) return pinned;
  return todayTasks()[0] || null;
}

const nextOrder = (list) => Math.max(-1, ...state.tasks.filter((t) => t.list === list).map((t) => t.order ?? 0)) + 1;

export function addTask(text, list = "inbox", extra = {}) {
  text = text.trim();
  if (!text) return null;
  let target = list;
  if (target === "today" && todayTasks().length >= MAX_TODAY) {
    target = "inbox";
    toast(`Máximo ${MAX_TODAY} prioridades: va a la bandeja`);
  }
  const t = { id: uid(), text, list: target, done: false, createdAt: Date.now(), doneAt: null, order: nextOrder(target), sub: [], repeat: null, dueDay: null, ...extra };
  state.tasks.push(t);
  commit();
  return t;
}

export function toggleDone(id) {
  const t = findTask(id);
  if (!t) return;
  if (t.done) {
    t.done = false;
    t.doneAt = null;
    return commit();
  }
  const wasToday = t.list === "today";
  const next = completeTask(state.tasks, id);
  if (F().taskId === id && F().phase !== "focus") F().taskId = null;
  if (t.todoistId && S().todoist.token) {
    invoke("todoist_close", { token: S().todoist.token, id: t.todoistId }).catch((e) => toast(`Todoist: ${e}`));
  }
  if (wasToday && todayTasks().length === 0) toast("¡Prioridades de hoy completadas! 🎉");
  else toast(next ? `Hecho ✓ · vuelve el ${parseDay(next.dueDay).toLocaleDateString("es", { weekday: "long" })}` : "Hecho ✓");
  commit();
}

export function moveTask(id, list) {
  const t = findTask(id);
  if (!t) return;
  if (list === "today" && todayTasks().length >= MAX_TODAY) {
    toast(`Ya tienes ${MAX_TODAY} prioridades. Termina o baja una.`);
    return;
  }
  t.list = list;
  t.order = nextOrder(list);
  commit();
}

export function deleteTask(id) {
  const idx = state.tasks.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const [removed] = state.tasks.splice(idx, 1);
  const blocks = state.blocks.filter((b) => b.taskId === id);
  state.blocks = state.blocks.filter((b) => b.taskId !== id);
  if (F().taskId === id) F().taskId = null;
  commit();
  toast("Tarea borrada", {
    label: "Deshacer",
    run: () => {
      state.tasks.splice(idx, 0, removed);
      state.blocks.push(...blocks);
      commit();
    },
  });
}

export function renameTask(id, text) {
  const t = findTask(id);
  text = text.trim();
  if (t && text) t.text = text;
  commit();
}

export function reorder(list, fromId, toIndex) {
  const items = listTasks(list);
  const from = items.findIndex((t) => t.id === fromId);
  if (from === -1) return;
  moveItem(items, from, toIndex).forEach((t, i) => (t.order = i));
  commit();
}

export function setRepeat(id, repeat) {
  const t = findTask(id);
  if (!t) return;
  t.repeat = repeat || null;
  commit();
}

export function addSub(id, text) {
  const t = findTask(id);
  if (!t || !text.trim()) return;
  t.sub.push({ id: uid(), text: text.trim(), done: false });
  commit();
}

export function toggleSub(id, subId) {
  const s = findTask(id)?.sub.find((x) => x.id === subId);
  if (!s) return;
  s.done = !s.done;
  commit();
}

export function deleteSub(id, subId) {
  const t = findTask(id);
  if (!t) return;
  t.sub = t.sub.filter((x) => x.id !== subId);
  commit();
}

export function focusMinutesFor(taskId) {
  return state.sessions.filter((s) => s.taskId === taskId).reduce((a, s) => a + s.minutes, 0);
}

/** Al cambiar de día vuelven las tareas recurrentes. */
export function dailyRollover() {
  if (rollover(state.tasks, dayKey())) commit();
}

/* ============================================================
   Bloques de tiempo
   ============================================================ */
export function nextSlot(now = Date.now()) {
  const d = new Date(now + 5 * 60000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return hhmm(d);
}

export function scheduleTask(taskId, start, minutes, day = dayKey()) {
  const t = findTask(taskId);
  state.blocks.push({ id: uid(), day, start, minutes: Number(minutes), taskId, title: t?.text || "Bloque", source: "manual" });
  commit();
  toast(`Programado a las ${start}`);
}

export function deleteBlock(id) {
  state.blocks = state.blocks.filter((b) => b.id !== id);
  commit();
}

export function agendaToday() {
  return agendaFor(dayKey(), state.calendar.events, state.blocks, state.tasks);
}

/* ============================================================
   Foco (Pomodoro)
   ============================================================ */
export const remaining = () => remainingMs(F(), S());

function syncCycleDay() {
  if (F().cycleDay !== dayKey()) {
    F().cycleDay = dayKey();
    F().cycle = 0;
  }
}

let dndOn = false;
/** Efectos de la sesión: "no molestar" y sonido ambiente. */
function applyFocusEffects() {
  const f = F();
  const deep = f.phase === "focus" && f.running;
  if (S().dnd && deep !== dndOn) {
    dndOn = deep;
    state.ui.dndOn = deep;
    invoke("set_dnd", { on: deep }).catch((e) => console.warn("No molestar:", e));
  } else if (!S().dnd && dndOn) {
    dndOn = false;
    state.ui.dndOn = false;
    invoke("set_dnd", { on: false }).catch(() => {});
  }
  const amb = S().ambient;
  if (amb.withFocus && amb.sound !== "none") {
    if (deep) playAmbient(amb.sound, amb.volume);
    else stopAmbient();
  }
}

/** Si la app se cerró con "no molestar" activo, lo restauramos. */
export function restoreDnd() {
  if (state.ui.dndOn) {
    state.ui.dndOn = false;
    invoke("set_dnd", { on: false }).catch(() => {});
  }
}

export function startFocus(taskId) {
  const f = F();
  syncCycleDay();
  if (taskId !== undefined) f.taskId = taskId;
  else if (!findTask(f.taskId) || findTask(f.taskId).done) f.taskId = currentTask()?.id ?? null;
  Object.assign(f, { phase: "focus", running: true, endAt: Date.now() + phaseMs(S(), "focus"), remaining: null });
  distraction.reset();
  applyFocusEffects();
  commit();
}

export function toggleFocus() {
  const f = F();
  if (f.phase === "idle") return startFocus();
  if (f.running) {
    Object.assign(f, { remaining: Math.max(0, f.endAt - Date.now()), running: false, endAt: null });
  } else {
    Object.assign(f, { endAt: Date.now() + (f.remaining ?? phaseMs(S(), f.phase)), remaining: null, running: true });
  }
  applyFocusEffects();
  commit();
}

function recordSession(minutes) {
  if (minutes < 1) return;
  const t = findTask(F().taskId);
  state.sessions.push({ start: Date.now() - minutes * 60000, minutes, taskId: t?.id ?? null, taskText: t?.text ?? null });
}

const elapsedFocusMinutes = () => Math.floor((phaseMs(S(), "focus") - remaining()) / 60000);

export function resetFocus() {
  const f = F();
  if (f.phase === "focus") recordSession(elapsedFocusMinutes());
  Object.assign(f, { phase: "idle", running: false, endAt: null, remaining: null });
  applyFocusEffects();
  commit();
}

export function completePhase({ natural = true, quiet = false } = {}) {
  const f = F();
  const s = S();
  syncCycleDay();
  let next;
  // Desactivamos "no molestar" antes de avisar para que la notificación se vea.
  Object.assign(f, { running: false });
  applyFocusEffects();
  if (f.phase === "focus") {
    const mins = natural ? Math.round(phaseMs(s, "focus") / 60000) : elapsedFocusMinutes();
    recordSession(mins);
    f.cycle += 1;
    next = breakAfter(f.cycle, s.longEvery);
    if (!quiet) {
      const t = findTask(f.taskId);
      notify("Bloque de foco completado", `${t ? t.text + " · " : ""}${mins} min. Toca ${next === "long" ? "un descanso largo" : "descansar"}.`);
    }
  } else {
    next = "focus";
    if (!quiet) notify("Descanso terminado", "Vuelve a tu prioridad cuando quieras.");
  }
  f.phase = next;
  const auto = next === "focus" ? s.autoFocus : s.autoBreak;
  if (auto && !quiet) Object.assign(f, { running: true, endAt: Date.now() + phaseMs(s, next), remaining: null });
  else Object.assign(f, { running: false, endAt: null, remaining: phaseMs(s, next) });
  if (!quiet && s.sound) chime();
  applyFocusEffects();
  commit();
}

export function notify(title, body) {
  invoke("notify", { title, body });
}

/* ============================================================
   Distracciones
   ============================================================ */
export const distraction = {
  since: null,
  app: null,
  warned: false,
  reset() {
    this.since = null;
    this.app = null;
    this.warned = false;
  },
};

export function onActiveApp({ app, idle }) {
  ui.activeApp = app;
  if (idle || categorize(app, S().apps) !== "distraction") return distraction.reset();
  if (distraction.app !== app) {
    distraction.app = app;
    distraction.since = Date.now();
    distraction.warned = false;
  }
}

/** Se llama en cada tic: avisa si la distracción dura demasiado durante el foco. */
export function checkDistraction(now = Date.now()) {
  const f = F();
  if (!S().distractionAlerts || f.phase !== "focus" || !f.running || !distraction.since || distraction.warned) return;
  if (now - distraction.since < S().distractionSeconds * 1000) return;
  distraction.warned = true;
  const t = findTask(f.taskId);
  flash(`${distraction.app} · vuelve a ${t ? t.text : "tu foco"}`, 6000, "warn");
}

/* ============================================================
   Calendarios y recordatorios
   ============================================================ */
export async function syncCalendars() {
  const feeds = S().calendars.filter((c) => c.url);
  if (!feeds.length) {
    state.calendar.events = [];
    return commit();
  }
  const today = dayKey();
  const from = parseDay(addDays(today, -1)).getTime();
  const to = parseDay(addDays(today, 3)).getTime();
  const events = [];
  const errors = {};
  await Promise.all(
    feeds.map(async (feed) => {
      try {
        const text = await invoke("fetch_calendar", { url: feed.url });
        for (const e of expandEvents(parseIcs(text), from, to)) events.push({ ...e, calendar: feed.name, color: feed.color });
      } catch (e) {
        errors[feed.id] = String(e);
      }
    })
  );
  state.calendar = { ...state.calendar, events: events.sort((a, b) => a.start - b.start), fetchedAt: Date.now(), errors };
  commit();
}

/** Avisos de reuniones y comienzo de bloques. */
export function checkAgenda(now = Date.now()) {
  const notified = state.calendar.notified;
  const lead = S().meetingReminderMin * 60000;
  let changed = false;
  for (const e of state.calendar.events) {
    const key = `e|${e.uid}|${e.start}`;
    if (e.allDay || notified[key] || e.start - now > lead || e.start < now - 60000) continue;
    notified[key] = now;
    changed = true;
    const mins = Math.max(0, Math.round((e.start - now) / 60000));
    notify(mins ? `En ${mins} min: ${e.title}` : `Ahora: ${e.title}`, `${hhmm(e.start)}–${hhmm(e.end)}${e.calendar ? " · " + e.calendar : ""}`);
    flash(mins ? `En ${mins} min · ${e.title}` : `Ahora · ${e.title}`, 8000, "info");
  }
  for (const b of state.blocks.filter((x) => x.day === dayKey(now))) {
    const start = atTime(b.day, b.start);
    const key = `b|${b.id}`;
    if (notified[key] || start > now || now - start > 120000) continue;
    notified[key] = now;
    changed = true;
    const t = findTask(b.taskId);
    notify(`Hora de: ${t ? t.text : b.title}`, `${b.minutes} min reservados`);
    if (S().blockAutoFocus && F().phase === "idle" && (!t || !t.done)) startFocus(t?.id ?? null);
    else flash(`Hora de · ${t ? t.text : b.title}`, 8000, "info");
  }
  // Limpiamos avisos de hace más de 3 días.
  for (const [k, t] of Object.entries(notified)) {
    if (now - t > 3 * 86400000) {
      delete notified[k];
      changed = true;
    }
  }
  if (changed) commit({ render: false });
}

/** Lo que muestra la píldora en reposo: reunión en curso o próxima. */
export function agendaHint(now = Date.now()) {
  const items = agendaToday().filter((i) => !i.allDay && !(i.kind === "block" && i.done));
  const ongoing = items.find((i) => i.start <= now && i.end > now);
  if (ongoing) return { label: `Ahora · ${ongoing.title}`, meta: `hasta ${hhmm(ongoing.end)}` };
  const next = items.find((i) => i.start > now && i.start - now <= 15 * 60000);
  if (next) return { label: next.title, meta: `en ${Math.max(1, Math.round((next.start - now) / 60000))} min` };
  return null;
}

/* ============================================================
   IA
   ============================================================ */
export function aiConfig() {
  const a = S().ai;
  return { provider: a.provider, endpoint: a.endpoint, model: a.model, api_key: a.apiKey };
}

export const aiReady = () => S().ai.provider !== "none";

function aiContext() {
  const today = dayKey();
  const now = Date.now();
  return {
    now: hhmm(now),
    dateLabel: new Date().toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" }),
    dayEnd: S().ai.dayEnd || "19:00",
    focusMin: S().focusMin,
    breakMin: S().breakMin,
    today: todayTasks().map((t) => ({ id: t.id, text: t.text, minutes: focusMinutesFor(t.id) })),
    inbox: inboxTasks().slice(0, 12).map((t) => ({ id: t.id, text: t.text })),
    agenda: agendaToday()
      .filter((i) => !i.allDay && i.end > now)
      .map((i) => ({ start: hhmm(i.start), end: hhmm(i.end), title: i.title })),
    focusMinutes: minutesOn(state.sessions, today),
  };
}

async function chat(messages, json) {
  return invoke("ai_chat", { config: aiConfig(), messages, json });
}

export async function planDay() {
  const ctx = aiContext();
  const ids = [...ctx.today, ...ctx.inbox].map((t) => t.id);
  const result = await track("plan", async () => {
    const raw = await chat(planMessages(ctx), true);
    const plan = parsePlan(raw, ids);
    if (!plan || !plan.blocks.length) throw new Error("La IA no devolvió un plan utilizable. Prueba otra vez o con otro modelo.");
    return plan;
  }, rerender);
  if (result) {
    state.ai.plan = { day: dayKey(), ...result };
    commit();
  }
}

export function applyPlan() {
  const plan = state.ai.plan;
  if (!plan) return;
  const day = dayKey();
  state.blocks = state.blocks.filter((b) => !(b.day === day && b.source === "ai"));
  for (const b of plan.blocks) {
    state.blocks.push({ id: uid(), day, start: b.start, minutes: b.minutes, taskId: b.taskId, title: b.title, source: "ai" });
  }
  state.ai.plan = { ...plan, applied: true };
  commit();
  toast(`${plan.blocks.length} bloques añadidos a tu agenda`);
}

export async function closeDay() {
  const today = dayKey();
  const sum = usageSummary(ui.usage[today] || {}, S().apps);
  const ctx = {
    dateLabel: new Date().toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" }),
    done: doneToday().map((t) => t.text),
    pending: todayTasks().map((t) => t.text),
    focusMinutes: minutesOn(state.sessions, today),
    goal: S().dailyGoalMin,
    blocks: state.sessions.filter((s) => dayKey(s.start) === today).length,
    productive: `${Math.round(sum.productive / 60)} min`,
    distraction: `${Math.round(sum.distraction / 60)} min`,
  };
  const result = await track("close", async () => {
    const close = parseClose(await chat(closeMessages(ctx), true));
    if (!close) throw new Error("La IA no devolvió un resumen.");
    return close;
  }, rerender);
  if (result) {
    state.ai.close = { day: today, dateLabel: ctx.dateLabel, ...result };
    commit();
  }
}

export function saveCloseAsNote() {
  const c = state.ai.close;
  if (!c) return;
  state.notes.push({ id: uid(), text: closeToText(c, c.dateLabel), createdAt: Date.now() });
  commit();
  toast("Cierre guardado en Notas");
}

export async function sendCloseToNotion() {
  const c = state.ai.close;
  const n = S().notion;
  if (!c || !n.token || !n.page) return toast("Configura Notion en Ajustes");
  const ok = await track("notion", () => invoke("notion_append", { token: n.token, page: n.page, title: `Cierre · ${c.dateLabel}`, text: closeToText(c, c.dateLabel) }), rerender);
  if (ok !== null) toast("Enviado a Notion ✓");
  else toast(`Notion: ${ui.errors.notion}`);
}

export async function askAI(question) {
  const q = question.trim();
  if (!q) return;
  state.ai.chat.push({ role: "user", content: q });
  commit();
  const answer = await track("ask", () => chat(askMessages(q, aiContext(), state.ai.chat.slice(0, -1)), false), rerender);
  state.ai.chat.push({ role: "assistant", content: answer ?? `⚠ ${ui.errors.ask}` });
  state.ai.chat = state.ai.chat.slice(-12);
  commit();
}

/** Reclasifica en segundo plano una captura sin prefijo. */
async function classifyCapture(taskId, original) {
  try {
    const result = parseClassify(await chat(classifyMessages(original), true), original);
    const t = findTask(taskId);
    if (!result || !t || t.done) return;
    if (result.type === "note") {
      state.tasks = state.tasks.filter((x) => x.id !== taskId);
      state.notes.push({ id: uid(), text: result.text, createdAt: Date.now() });
      flash("IA: guardado como nota");
    } else {
      t.text = result.text;
      if (result.list === "today" && todayTasks().length < MAX_TODAY) {
        t.list = "today";
        t.order = nextOrder("today");
        flash("IA: movido a Hoy");
      }
    }
    commit();
  } catch (e) {
    console.warn("Clasificación IA:", e);
  }
}

/* ============================================================
   Captura rápida
   ============================================================ */
export function submitCapture(raw) {
  const { dest, text } = parseCapture(raw);
  if (!text) return false;
  if (dest === "note") {
    state.notes.push({ id: uid(), text, createdAt: Date.now() });
    commit();
    flash("Nota guardada ✓", 1600);
    return true;
  }
  const t = addTask(text, dest);
  flash(`Añadido a ${t && t.list === "today" ? "Hoy" : "la bandeja"} ✓`, 1600);
  if (t && dest === "inbox" && aiReady() && S().ai.classify) classifyCapture(t.id, text);
  return true;
}

/* ============================================================
   Todoist
   ============================================================ */
export async function importTodoist() {
  const token = S().todoist.token;
  if (!token) return toast("Añade tu token de Todoist en Ajustes");
  const remote = await track("todoist", () => invoke("todoist_today", { token }), rerender);
  if (!remote) return toast(`Todoist: ${ui.errors.todoist}`);
  const known = new Set(state.tasks.map((t) => t.todoistId).filter(Boolean));
  let added = 0;
  for (const r of remote) {
    if (known.has(r.id)) continue;
    addTask(r.text, "inbox", { todoistId: r.id });
    added++;
  }
  toast(added ? `${added} tareas importadas de Todoist` : "Todoist: nada nuevo para hoy");
}
