"use strict";

/* ============================================================
   Puente con Tauri (con modo vista previa para el navegador)
   ============================================================ */
const TAURI = window.__TAURI__;
const PREVIEW = !TAURI;

const invoke = PREVIEW
  ? async (cmd, args) => {
      if (cmd === "load_state") return localStorage.getItem("focuspill") || null;
      if (cmd === "save_state") return localStorage.setItem("focuspill", args.data);
      if (cmd === "get_autostart") return false;
      return null;
    }
  : TAURI.core.invoke;

const listen = PREVIEW ? async () => () => {} : TAURI.event.listen;

/* ============================================================
   Estado
   ============================================================ */
const DEFAULT_SETTINGS = {
  theme: "dark",
  accent: "#8492ff",
  focusMin: 25,
  breakMin: 5,
  longBreakMin: 15,
  longEvery: 4,
  dailyGoalMin: 120,
  autoBreak: true,
  autoFocus: false,
  sound: true,
  collapseOnBlur: true,
};

const ACCENTS = ["#8492ff", "#5ab0ff", "#2dd4bf", "#4ade80", "#fbbf24", "#fb923c", "#f472b6", "#c084fc"];
const MAX_TODAY = 3;

let state = {
  v: 1,
  tasks: [],
  notes: [],
  sessions: [],
  focus: { phase: "idle", running: false, endAt: null, remaining: null, taskId: null, cycle: 0, cycleDay: null },
  settings: { ...DEFAULT_SETTINGS },
  ui: { tab: "today" },
};

let mode = "pill";
let modeToken = 0;
let modeChangedAt = 0;
let flash = null;

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const dayKey = (t = Date.now()) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => invoke("save_state", { data: JSON.stringify(state) }), 250);
}

async function load() {
  try {
    const raw = await invoke("load_state");
    if (raw) {
      const s = JSON.parse(raw);
      state = {
        ...state,
        ...s,
        focus: { ...state.focus, ...(s.focus || {}) },
        settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}) },
        ui: { ...state.ui, ...(s.ui || {}) },
      };
    }
  } catch (e) {
    console.error("No se pudo leer el estado", e);
  }
}

/* ============================================================
   Iconos (trazos propios, estilo lineal)
   ============================================================ */
const ICONS = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4.5" height="14" rx="1.2"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.2"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  chevronUp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
  task: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l4 4 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6"/></svg>',
};

/* ============================================================
   Tareas
   ============================================================ */
const todayTasks = () => state.tasks.filter((t) => t.list === "today" && !t.done);
const inboxTasks = () => state.tasks.filter((t) => t.list === "inbox" && !t.done);
const doneToday = () => state.tasks.filter((t) => t.done && dayKey(t.doneAt) === dayKey());
const findTask = (id) => state.tasks.find((t) => t.id === id);

function currentTask() {
  const pinned = findTask(state.focus.taskId);
  if (pinned && !pinned.done) return pinned;
  return todayTasks()[0] || null;
}

function addTask(text, list = "inbox") {
  text = text.trim();
  if (!text) return null;
  let target = list;
  if (target === "today" && todayTasks().length >= MAX_TODAY) {
    target = "inbox";
    toast(`Máximo ${MAX_TODAY} prioridades: va a la bandeja`);
  }
  const t = { id: uid(), text, list: target, done: false, createdAt: Date.now(), doneAt: null };
  state.tasks.push(t);
  save();
  return t;
}

function toggleDone(id) {
  const t = findTask(id);
  if (!t) return;
  t.done = !t.done;
  t.doneAt = t.done ? Date.now() : null;
  if (t.done && state.focus.taskId === id && state.focus.phase !== "focus") state.focus.taskId = null;
  if (t.done) {
    if (t.list === "today" && todayTasks().length === 0) toast("¡Prioridades de hoy completadas! 🎉");
    else toast("Hecho ✓");
  }
  save();
  renderAll();
}

function moveTask(id, list) {
  const t = findTask(id);
  if (!t) return;
  if (list === "today" && todayTasks().length >= MAX_TODAY) {
    toast(`Ya tienes ${MAX_TODAY} prioridades. Termina o baja una.`);
    return;
  }
  t.list = list;
  save();
  renderAll();
}

function deleteTask(id) {
  state.tasks = state.tasks.filter((t) => t.id !== id);
  if (state.focus.taskId === id) state.focus.taskId = null;
  save();
  renderAll();
}

function renameTask(id, text) {
  const t = findTask(id);
  text = text.trim();
  if (!t || !text) return renderAll();
  t.text = text;
  save();
  renderAll();
}

function focusMinutesFor(taskId, sinceDay = null) {
  return state.sessions
    .filter((s) => s.taskId === taskId && (!sinceDay || dayKey(s.start) >= sinceDay))
    .reduce((a, s) => a + s.minutes, 0);
}

/* ============================================================
   Motor de foco (Pomodoro)
   ============================================================ */
const F = () => state.focus;
const S = () => state.settings;

function phaseMs(phase) {
  const s = S();
  const min = phase === "focus" ? s.focusMin : phase === "long" ? s.longBreakMin : s.breakMin;
  return Math.max(1, Number(min) || 1) * 60000;
}

function remainingMs() {
  const f = F();
  if (f.phase === "idle") return phaseMs("focus");
  if (f.running && f.endAt) return Math.max(0, f.endAt - Date.now());
  return f.remaining ?? phaseMs(f.phase);
}

function syncCycleDay() {
  const f = F();
  if (f.cycleDay !== dayKey()) {
    f.cycleDay = dayKey();
    f.cycle = 0;
  }
}

function startFocus(taskId) {
  const f = F();
  syncCycleDay();
  if (taskId !== undefined) f.taskId = taskId;
  else if (!findTask(f.taskId) || findTask(f.taskId).done) f.taskId = currentTask()?.id ?? null;
  f.phase = "focus";
  f.running = true;
  f.endAt = Date.now() + phaseMs("focus");
  f.remaining = null;
  save();
  renderAll();
}

function toggleFocus() {
  const f = F();
  if (f.phase === "idle") return startFocus();
  if (f.running) {
    f.remaining = Math.max(0, f.endAt - Date.now());
    f.running = false;
    f.endAt = null;
  } else {
    f.endAt = Date.now() + (f.remaining ?? phaseMs(f.phase));
    f.remaining = null;
    f.running = true;
  }
  save();
  renderAll();
}

function recordSession(minutes) {
  if (minutes < 1) return;
  const t = findTask(F().taskId);
  state.sessions.push({ start: Date.now() - minutes * 60000, minutes, taskId: t?.id ?? null, taskText: t?.text ?? null });
}

function elapsedFocusMinutes() {
  return Math.floor((phaseMs("focus") - remainingMs()) / 60000);
}

function resetFocus() {
  const f = F();
  if (f.phase === "focus") recordSession(elapsedFocusMinutes());
  Object.assign(f, { phase: "idle", running: false, endAt: null, remaining: null });
  save();
  renderAll();
}

function completePhase({ natural = true, quiet = false } = {}) {
  const f = F();
  const s = S();
  syncCycleDay();
  let next;
  if (f.phase === "focus") {
    const mins = natural ? Math.round(phaseMs("focus") / 60000) : elapsedFocusMinutes();
    recordSession(mins);
    f.cycle += 1;
    next = f.cycle % Math.max(2, s.longEvery) === 0 ? "long" : "break";
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
  if (auto && !quiet) {
    f.running = true;
    f.endAt = Date.now() + phaseMs(next);
    f.remaining = null;
  } else {
    f.running = false;
    f.endAt = null;
    f.remaining = phaseMs(next);
  }
  if (!quiet) chime();
  save();
  renderAll();
}

function notify(title, body) {
  invoke("notify", { title, body });
}

let audioCtx = null;
function chime() {
  if (!S().sound) return;
  try {
    audioCtx = audioCtx || new AudioContext();
    const now = audioCtx.currentTime;
    [660, 880, 1320].forEach((freq, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, now + i * 0.14);
      g.gain.linearRampToValueAtTime(0.18, now + i * 0.14 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.14 + 0.6);
      o.connect(g).connect(audioCtx.destination);
      o.start(now + i * 0.14);
      o.stop(now + i * 0.14 + 0.65);
    });
  } catch (_) {
    /* sin audio disponible */
  }
}

const fmt = (ms) => {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

/* ============================================================
   Estadísticas
   ============================================================ */
function minutesOn(day) {
  return state.sessions.filter((s) => dayKey(s.start) === day).reduce((a, s) => a + s.minutes, 0);
}

function streak() {
  let n = 0;
  const d = new Date();
  if (minutesOn(dayKey(d)) === 0) d.setDate(d.getDate() - 1);
  while (minutesOn(dayKey(d)) > 0) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

function lastDays(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push(d);
  }
  return out;
}

/* ============================================================
   Estado visible (píldora y cabecera del panel)
   ============================================================ */
function statusView() {
  const f = F();
  const task = findTask(f.taskId) || currentTask();
  const rem = remainingMs();
  if (flash && flash.until > Date.now()) {
    return { dot: "done", label: flash.text, meta: "", live: false, progress: null, flash: true };
  }
  if (f.phase === "focus") {
    return {
      dot: f.running ? "focus running" : "paused",
      label: task ? task.text : "Foco",
      meta: (f.running ? "" : "‖ ") + fmt(rem),
      live: true,
      progress: 1 - rem / phaseMs("focus"),
      kind: "focus",
    };
  }
  if (f.phase === "break" || f.phase === "long") {
    return {
      dot: f.running ? "break" : "paused",
      label: f.phase === "long" ? "Descanso largo" : "Descanso",
      meta: (f.running ? "" : "‖ ") + fmt(rem),
      live: true,
      progress: 1 - rem / phaseMs(f.phase),
      kind: "break",
    };
  }
  const total = todayTasks().length + doneToday().filter((t) => t.list === "today").length;
  const done = doneToday().filter((t) => t.list === "today").length;
  if (task) return { dot: "", label: task.text, meta: total ? `${done}/${total}` : "", live: false, progress: null };
  if (total && done === total) return { dot: "done", label: "Prioridades completadas", meta: `${done}/${total}`, live: false, progress: null };
  return { dot: "", label: "Planifica tu día", meta: "Ctrl+Alt+␣", live: false, progress: null };
}

function renderPill() {
  const v = statusView();
  $("#pillDot").className = "dot " + v.dot;
  $("#pillLabel").textContent = v.label;
  const meta = $("#pillMeta");
  meta.textContent = v.meta;
  meta.classList.toggle("live", v.live);
  $("#pill").classList.toggle("flash", !!v.flash);
  const running = F().running;
  $("#pillPlay").innerHTML = running ? ICONS.pause : ICONS.play;
  $("#pillPlay").title = running ? "Pausar" : F().phase === "idle" ? "Empezar foco" : "Reanudar";
  const prog = $(".pill-progress");
  prog.classList.toggle("on", v.progress !== null);
  prog.classList.toggle("break", v.kind === "break");
  $("#pillProgress").style.width = `${Math.round((v.progress || 0) * 100)}%`;

  $("#headDot").className = "dot " + v.dot;
  $("#headLabel").textContent = v.label;
  $("#headTime").textContent = v.meta;
}

/* ============================================================
   Vistas del panel
   ============================================================ */
function taskItem(t, { kind }) {
  const cur = currentTask();
  const isCurrent = kind === "today" && cur && cur.id === t.id;
  const mins = focusMinutesFor(t.id);
  let acts = "";
  if (kind === "today") {
    acts = `<button class="act play" data-act="focus" title="Enfocarme en esto">${ICONS.play}</button>
            <button class="act" data-act="inbox" title="Mover a la bandeja">${ICONS.down}</button>`;
  } else if (kind === "inbox") {
    acts = `<button class="act" data-act="today" title="Subir a hoy">${ICONS.up}</button>`;
  }
  acts += `<button class="act" data-act="delete" title="Borrar">${ICONS.x}</button>`;
  return `<li class="item ${t.done ? "done" : ""} ${isCurrent ? "current" : ""}" data-id="${t.id}">
      <button class="check" data-act="done" aria-label="Completar">${ICONS.check}</button>
      <span class="txt" data-act="edit" title="Doble clic para editar">${esc(t.text)}</span>
      ${mins ? `<span class="mins">${mins}′</span>` : ""}
      <span class="acts">${acts}</span>
    </li>`;
}

function renderToday() {
  const today = todayTasks();
  const inbox = inboxTasks();
  const done = doneToday();

  $("#todayCount").textContent = `${today.length}/${MAX_TODAY}`;
  $("#todayList").innerHTML = today.length
    ? today.map((t) => taskItem(t, { kind: "today" })).join("")
    : `<li class="empty">¿Qué 3 cosas harían que hoy fuera un buen día?</li>`;
  $("#todayInput").placeholder = today.length >= MAX_TODAY ? "Prioridades completas · se añadirá a la bandeja" : "Añade una prioridad para hoy…";

  $("#inboxCount").textContent = inbox.length || "";
  $("#inboxList").innerHTML = inbox.length
    ? inbox.map((t) => taskItem(t, { kind: "inbox" })).join("")
    : `<li class="empty">Tu bandeja está vacía. Captura con Ctrl+Alt+Espacio.</li>`;

  $("#doneCount").textContent = done.length || "0";
  $("#doneList").innerHTML = done.map((t) => taskItem(t, { kind: "done" })).join("");
  $("#doneFold").style.display = done.length ? "" : "none";

  const mins = minutesOn(dayKey());
  const goal = Math.max(1, S().dailyGoalMin);
  const pct = Math.min(100, Math.round((mins / goal) * 100));
  $("#goal").className = "goal" + (mins >= goal ? " reached" : "");
  $("#goal").innerHTML = `<div class="goal-top"><span>Foco de hoy</span><b>${mins} / ${goal} min</b></div>
    <div class="goal-bar"><i style="width:${pct}%"></i></div>`;
}

function renderFocusView() {
  const f = F();
  const rem = remainingMs();
  const total = f.phase === "idle" ? phaseMs("focus") : phaseMs(f.phase);
  const progress = f.phase === "idle" ? 0 : 1 - rem / total;
  const C = 540.35;
  const ring = $("#ringFill");
  ring.style.strokeDashoffset = String(C * (1 - progress));
  ring.classList.toggle("break", f.phase === "break" || f.phase === "long");
  $("#ringTime").textContent = fmt(rem);
  $("#ringPhase").textContent =
    f.phase === "focus" ? (f.running ? "Enfocado" : "En pausa") : f.phase === "break" ? "Descanso" : f.phase === "long" ? "Descanso largo" : "Listo";

  const every = Math.max(2, S().longEvery);
  const doneInSet = f.cycleDay === dayKey() ? f.cycle % every : 0;
  $("#ringCycle").innerHTML = Array.from({ length: every }, (_, i) => `<i class="${i < doneInSet ? "on" : ""}"></i>`).join("");

  $("#startBtn").textContent = f.running ? "Pausar" : f.phase === "idle" ? "Empezar" : "Reanudar";
}

function renderFocusTasks() {
  const sel = $("#focusTask");
  const opts = [...todayTasks(), ...inboxTasks()];
  const cur = findTask(F().taskId) && !findTask(F().taskId).done ? F().taskId : currentTask()?.id || "";
  sel.innerHTML =
    `<option value="">Sin tarea concreta</option>` +
    opts.map((t) => `<option value="${t.id}" ${t.id === cur ? "selected" : ""}>${t.list === "today" ? "★ " : ""}${esc(t.text)}</option>`).join("");
  $$("#presets button").forEach((b) => {
    const [fm, bm] = b.dataset.preset.split(",").map(Number);
    b.classList.toggle("active", fm === Number(S().focusMin) && bm === Number(S().breakMin));
  });
}

function renderNotes() {
  const list = [...state.notes].sort((a, b) => b.createdAt - a.createdAt);
  $("#noteList").innerHTML = list.length
    ? list
        .map(
          (n) => `<li class="note" data-id="${n.id}">
        <div class="note-text">${esc(n.text)}</div>
        <div class="note-foot"><span>${new Date(n.createdAt).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          <span class="acts">
            <button class="act" data-act="note-task" title="Convertir en tarea">${ICONS.task}</button>
            <button class="act" data-act="note-copy" title="Copiar">${ICONS.copy}</button>
            <button class="act" data-act="note-delete" title="Borrar">${ICONS.x}</button>
          </span></div>
      </li>`
        )
        .join("")
    : `<li class="empty">Las notas que captures con <b>n:</b> aparecerán aquí.</li>`;
}

function renderStats() {
  const today = dayKey();
  const todaySessions = state.sessions.filter((s) => dayKey(s.start) === today);
  const mins = minutesOn(today);
  $("#kpis").innerHTML = [
    ["Foco hoy", `${mins}<small>min</small>`],
    ["Bloques hoy", `${todaySessions.length}`],
    ["Tareas hechas hoy", `${doneToday().length}`],
    ["Racha", `${streak()}<small>${streak() === 1 ? "día" : "días"}</small>`],
  ]
    .map(([l, v]) => `<div class="kpi"><div class="kpi-label">${l}</div><div class="kpi-value">${v}</div></div>`)
    .join("");

  const days = lastDays(7);
  const vals = days.map((d) => minutesOn(dayKey(d)));
  const max = Math.max(30, ...vals);
  const names = ["D", "L", "M", "X", "J", "V", "S"];
  $("#bars").innerHTML = days
    .map(
      (d, i) => `<div class="bar ${dayKey(d) === today ? "today" : ""}">
      <span class="bar-val">${vals[i] || ""}</span>
      <span class="bar-col"><i style="height:${Math.round((vals[i] / max) * 100)}%"></i></span>
      <span class="bar-day">${names[d.getDay()]}</span></div>`
    )
    .join("");

  const since = dayKey(days[0]);
  const byTask = new Map();
  state.sessions
    .filter((s) => dayKey(s.start) >= since)
    .forEach((s) => {
      const key = s.taskText || "Sin tarea concreta";
      byTask.set(key, (byTask.get(key) || 0) + s.minutes);
    });
  const top = [...byTask.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  $("#topTasks").innerHTML = top.length
    ? top.map(([t, m]) => `<li class="item"><span class="txt">${esc(t)}</span><span class="mins">${m} min</span></li>`).join("")
    : `<li class="empty">Completa tu primer bloque de foco para ver dónde va tu tiempo.</li>`;
}

function renderSettings() {
  const s = S();
  $$("#themeSeg button").forEach((b) => b.classList.toggle("active", b.dataset.theme === s.theme));
  $("#swatches").innerHTML = ACCENTS.map(
    (c) => `<button data-accent="${c}" style="background:${c}" class="${c === s.accent ? "active" : ""}" aria-label="Color ${c}"></button>`
  ).join("");
  $$("[data-num]").forEach((i) => {
    if (document.activeElement !== i) i.value = s[i.dataset.num];
  });
  $$("[data-bool]").forEach((i) => (i.checked = !!s[i.dataset.bool]));
}

function applyTheme() {
  const s = S();
  let theme = s.theme;
  if (theme === "system") theme = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  document.body.dataset.themePreview = theme;
  document.documentElement.style.setProperty("--accent", s.accent);
  const light = isLightColor(s.accent);
  document.documentElement.style.setProperty("--accent-ink", light ? "#0d0f1f" : "#ffffff");
}

function isLightColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 140;
}

function setTab(tab) {
  state.ui.tab = tab;
  $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $$(".view").forEach((v) => v.classList.toggle("active", v.dataset.view === tab));
  renderAll();
  save();
}

function renderAll() {
  renderPill();
  if (mode !== "panel") return;
  const tab = state.ui.tab;
  if (tab === "today") renderToday();
  if (tab === "focus") {
    renderFocusView();
    renderFocusTasks();
  }
  if (tab === "notes") renderNotes();
  if (tab === "stats") renderStats();
  if (tab === "settings") renderSettings();
}

let toastTimer = null;
function toast(text) {
  if (mode !== "panel") {
    flash = { text, until: Date.now() + 1800 };
    renderPill();
    return;
  }
  const el = $("#toast");
  el.textContent = text;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("on"), 1800);
}

/* ============================================================
   Modos de la isla: píldora · captura · panel
   ============================================================ */
const AREA = { pill: 300 * 40, capture: 500 * 52, panel: 420 * 580 };

async function setMode(next) {
  if (next === mode) return;
  const prev = mode;
  const token = ++modeToken;
  mode = next;
  modeChangedAt = Date.now();
  const island = $("#island");
  const apply = () => {
    island.className = "island mode-" + next;
    renderAll();
  };

  if (AREA[next] > AREA[prev]) {
    // Crece: primero agrandamos la ventana y luego animamos la forma.
    await invoke("set_mode", { mode: next });
    if (token !== modeToken) return;
    requestAnimationFrame(apply);
  } else {
    // Encoge: animamos y después ajustamos la ventana.
    apply();
    setTimeout(() => {
      if (token === modeToken) invoke("set_mode", { mode: next });
    }, 340);
  }

  if (next === "capture") setTimeout(() => $("#captureInput").focus(), 60);
  if (next === "panel" && state.ui.tab === "today") setTimeout(() => $("#todayInput").focus(), 120);
}

const collapse = () => setMode("pill");

function openPanel(tab) {
  if (tab) state.ui.tab = tab;
  setMode("panel").then(() => setTab(state.ui.tab));
}

/* Captura: decide destino según prefijo */
function parseCapture(raw) {
  const text = raw.trim();
  if (/^(n:|nota:|#)\s*/i.test(text)) return { dest: "note", text: text.replace(/^(n:|nota:|#)\s*/i, "") };
  if (/^!\s*/.test(text)) return { dest: "today", text: text.replace(/^!\s*/, "") };
  return { dest: "inbox", text };
}

function updateCaptureChip() {
  const { dest } = parseCapture($("#captureInput").value);
  const chip = $("#captureDest");
  chip.className = "chip " + dest;
  chip.textContent = dest === "note" ? "Nota" : dest === "today" ? "Hoy" : "Bandeja";
}

function submitCapture() {
  const input = $("#captureInput");
  const { dest, text } = parseCapture(input.value);
  if (!text) return collapse();
  if (dest === "note") {
    state.notes.push({ id: uid(), text, createdAt: Date.now() });
    save();
    flash = { text: "Nota guardada ✓", until: Date.now() + 1600 };
  } else {
    const t = addTask(text, dest);
    const where = t && t.list === "today" ? "Hoy" : "la bandeja";
    flash = { text: `Añadido a ${where} ✓`, until: Date.now() + 1600 };
  }
  input.value = "";
  updateCaptureChip();
  collapse();
}

/* ============================================================
   Eventos
   ============================================================ */
function bindPill() {
  const pill = $("#pill");
  let down = null;

  pill.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("#pillPlay")) return;
    down = { x: e.screenX, y: e.screenY, dragging: false };
  });
  pill.addEventListener("pointermove", (e) => {
    if (!down || down.dragging || !(e.buttons & 1)) return;
    if (Math.hypot(e.screenX - down.x, e.screenY - down.y) > 4) {
      down.dragging = true;
      invoke("start_drag");
    }
  });
  pill.addEventListener("pointerup", (e) => {
    if (down && !down.dragging && !e.target.closest("#pillPlay")) openPanel();
    down = null;
  });
  pill.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    setMode("capture");
  });
  $("#pillPlay").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFocus();
  });
}

function bindPanel() {
  $("#collapseBtn").innerHTML = ICONS.chevronUp;
  $("#collapseBtn").addEventListener("click", collapse);
  $('#tabs [data-tab="settings"]').innerHTML = ICONS.gear;
  $("#todayForm .add-btn").innerHTML = ICONS.plus;

  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) setTab(b.dataset.tab);
  });

  $("#todayForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#todayInput");
    if (addTask(input.value, "today")) input.value = "";
    renderAll();
  });

  // Acciones de las listas (delegación)
  $(".views").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const item = btn.closest("[data-id]");
    const id = item?.dataset.id;
    switch (btn.dataset.act) {
      case "done": return toggleDone(id);
      case "inbox": return moveTask(id, "inbox");
      case "today": return moveTask(id, "today");
      case "delete": return deleteTask(id);
      case "focus":
        startFocus(id);
        toast("Foco iniciado");
        return setTab("focus");
      case "note-delete":
        state.notes = state.notes.filter((n) => n.id !== id);
        save();
        return renderAll();
      case "note-copy": {
        const n = state.notes.find((x) => x.id === id);
        navigator.clipboard?.writeText(n.text).then(() => toast("Copiado"), () => toast("No se pudo copiar"));
        return;
      }
      case "note-task": {
        const n = state.notes.find((x) => x.id === id);
        addTask(n.text.split("\n")[0].slice(0, 140), "inbox");
        toast("Convertida en tarea");
        return renderAll();
      }
    }
  });

  // Edición en línea con doble clic
  $(".views").addEventListener("dblclick", (e) => {
    const txt = e.target.closest('.txt[data-act="edit"]');
    if (!txt) return;
    const id = txt.closest("[data-id]").dataset.id;
    txt.contentEditable = "true";
    txt.focus();
    document.getSelection().selectAllChildren(txt);
    const finish = (commit) => {
      txt.removeEventListener("blur", onBlur);
      txt.removeEventListener("keydown", onKey);
      txt.contentEditable = "false";
      if (commit) renameTask(id, txt.textContent);
      else renderAll();
    };
    const onBlur = () => finish(true);
    const onKey = (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); finish(false); }
    };
    txt.addEventListener("blur", onBlur);
    txt.addEventListener("keydown", onKey);
  });

  // Foco
  $("#startBtn").addEventListener("click", () => {
    const sel = $("#focusTask").value || null;
    if (F().phase === "idle") startFocus(sel);
    else toggleFocus();
  });
  $("#resetBtn").addEventListener("click", resetFocus);
  $("#skipBtn").addEventListener("click", () => {
    if (F().phase !== "idle") completePhase({ natural: false });
  });
  $("#focusTask").addEventListener("change", (e) => {
    F().taskId = e.target.value || null;
    save();
    renderAll();
  });
  $("#presets").addEventListener("click", (e) => {
    const b = e.target.closest("[data-preset]");
    if (!b) return;
    const [fm, bm] = b.dataset.preset.split(",").map(Number);
    Object.assign(S(), { focusMin: fm, breakMin: bm, longBreakMin: Math.max(bm * 3, 15) });
    if (F().phase !== "idle" && !F().running) F().remaining = phaseMs(F().phase);
    save();
    renderAll();
  });

  // Notas
  const saveNote = () => {
    const ta = $("#noteInput");
    const text = ta.value.trim();
    if (!text) return;
    state.notes.push({ id: uid(), text, createdAt: Date.now() });
    ta.value = "";
    save();
    renderAll();
    toast("Nota guardada");
  };
  $("#noteForm").addEventListener("submit", (e) => {
    e.preventDefault();
    saveNote();
  });
  $("#noteInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveNote();
    }
  });

  // Ajustes
  $("#themeSeg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-theme]");
    if (!b) return;
    S().theme = b.dataset.theme;
    applyTheme();
    save();
    renderAll();
  });
  $("#swatches").addEventListener("click", (e) => {
    const b = e.target.closest("[data-accent]");
    if (!b) return;
    S().accent = b.dataset.accent;
    applyTheme();
    save();
    renderAll();
  });
  $$("[data-num]").forEach((i) =>
    i.addEventListener("change", () => {
      const min = Number(i.min), max = Number(i.max);
      const v = Math.min(max, Math.max(min, Math.round(Number(i.value) || min)));
      S()[i.dataset.num] = v;
      i.value = v;
      if (F().phase !== "idle" && !F().running) F().remaining = phaseMs(F().phase);
      save();
      renderAll();
    })
  );
  $$("[data-bool]").forEach((i) =>
    i.addEventListener("change", () => {
      S()[i.dataset.bool] = i.checked;
      save();
    })
  );
  $("#autostart").addEventListener("change", async (e) => {
    try {
      await invoke("set_autostart", { enabled: e.target.checked });
      toast(e.target.checked ? "Se abrirá al iniciar sesión" : "Inicio automático desactivado");
    } catch (err) {
      e.target.checked = !e.target.checked;
      toast("No se pudo cambiar el inicio automático");
    }
  });
  $("#resetPosBtn").addEventListener("click", async () => {
    await collapse();
    setTimeout(() => invoke("reset_position"), 380);
  });
  $("#hideBtn").addEventListener("click", async () => {
    await collapse();
    setTimeout(() => invoke("hide_pill"), 380);
  });
  $("#quitBtn").addEventListener("click", () => invoke("quit"));
}

function bindCapture() {
  const input = $("#captureInput");
  input.addEventListener("input", updateCaptureChip);
  $("#capture").addEventListener("submit", (e) => {
    e.preventDefault();
    submitCapture();
  });
}

function bindKeys() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (mode !== "pill") {
        e.preventDefault();
        collapse();
      }
      return;
    }
    if (mode === "panel" && e.altKey && /^[1-5]$/.test(e.key)) {
      setTab(["today", "focus", "notes", "stats", "settings"][Number(e.key) - 1]);
    }
  });
}

function handleAction(action) {
  switch (action) {
    case "capture":
      return setMode("capture");
    case "toggle-focus":
      toggleFocus();
      toast(F().running ? (F().phase === "focus" ? "Foco en marcha" : "Descanso en marcha") : "En pausa");
      return;
    case "toggle-panel":
      return mode === "panel" ? collapse() : openPanel();
    case "collapse":
      return collapse();
    case "open":
    default:
      return openPanel();
  }
}

/* ============================================================
   Arranque
   ============================================================ */
async function init() {
  if (PREVIEW) document.body.classList.add("preview");
  await load();

  // Si una fase terminó con la app cerrada, la cerramos sin notificar.
  const f = F();
  if (f.running && f.endAt && f.endAt <= Date.now()) completePhase({ quiet: true });

  applyTheme();
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", applyTheme);
  bindPill();
  bindPanel();
  bindCapture();
  bindKeys();
  setTab(state.ui.tab || "today");

  invoke("get_autostart").then((on) => ($("#autostart").checked = !!on));

  await listen("pill-action", (e) => handleAction(e.payload));
  await listen("pill-blur", () => {
    if (mode === "pill" || !S().collapseOnBlur) return;
    if (Date.now() - modeChangedAt < 600) return;
    collapse();
  });

  const pending = await invoke("take_pending_action");
  if (pending) handleAction(pending);

  // Vista previa: ?mode=panel&tab=focus
  if (PREVIEW) {
    const q = new URLSearchParams(location.search);
    if (q.get("tab")) state.ui.tab = q.get("tab");
    if (q.get("mode")) setMode(q.get("mode")).then(() => setTab(state.ui.tab));
  }

  // Bucle del reloj
  setInterval(() => {
    const fo = F();
    if (fo.running && fo.endAt && Date.now() >= fo.endAt) completePhase();
    renderPill();
    if (mode === "panel" && state.ui.tab === "focus") renderFocusView();
    if (flash && flash.until <= Date.now()) flash = null;
  }, 250);
}

init();
