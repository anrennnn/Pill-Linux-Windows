// FocusPill: arranque, modos de la isla (píldora · captura · panel) y reloj.

import { PREVIEW, invoke, listen } from "./bridge.js";
import * as A from "./actions.js";
import { dayKey, fmt, parseCapture, phaseMs } from "./core.js";
import { ICONS } from "./icons.js";
import { F, S, commit, load, onChange, state } from "./store.js";
import { $, $$, toast, ui } from "./ui.js";
import * as Assistant from "./views/assistant.js";
import * as Focus from "./views/focus.js";
import * as Media from "./views/media.js";
import * as Notes from "./views/notes.js";
import * as Settings from "./views/settings.js";
import * as Stats from "./views/stats.js";
import * as Today from "./views/today.js";

// Orden de las pestañas: IA va al final, junto a Ajustes.
const VIEWS = { today: Today, focus: Focus, notes: Notes, stats: Stats, ai: Assistant, settings: Settings };
const TABS = Object.keys(VIEWS);
const SHAPE = { pill: [300, 40, 20], capture: [500, 52, 26], media: [460, 104, 30], panel: [440, 620, 24] };
const area = (m) => SHAPE[m][0] * SHAPE[m][1];

/* ============================================================
   Estado visible de la píldora
   ============================================================ */
function statusView() {
  const f = F();
  const now = Date.now();
  if (ui.flash && ui.flash.until > now) {
    return { dot: ui.flash.kind === "warn" ? "warn" : ui.flash.kind === "info" ? "info" : "done", label: ui.flash.text, meta: "", flash: ui.flash.kind };
  }
  const rem = A.remaining();
  const task = A.findTask(f.taskId) || A.currentTask();
  if (f.phase === "focus") {
    return { dot: f.running ? "focus running" : "paused", label: task ? task.text : "Foco", meta: (f.running ? "" : "‖ ") + fmt(rem), live: true, progress: 1 - rem / phaseMs(S(), "focus"), kind: "focus" };
  }
  if (f.phase === "break" || f.phase === "long") {
    return { dot: f.running ? "break" : "paused", label: f.phase === "long" ? "Descanso largo" : "Descanso", meta: (f.running ? "" : "‖ ") + fmt(rem), live: true, progress: 1 - rem / phaseMs(S(), f.phase), kind: "break" };
  }
  const hint = A.agendaHint(now);
  if (hint) return { dot: "info", label: hint.label, meta: hint.meta, live: true };
  if (S().media.show && Media.mediaPlaying()) {
    const m = ui.media;
    return { dot: "", label: m.title || m.name, meta: "", kind: "media" };
  }
  const doneToday = A.doneToday().filter((t) => t.list === "today").length;
  const total = A.todayTasks().length + doneToday;
  if (task) return { dot: "", label: task.text, meta: total ? `${doneToday}/${total}` : "" };
  if (total && doneToday === total) return { dot: "done", label: "Prioridades completadas", meta: `${doneToday}/${total}` };
  return { dot: "", label: "Planifica tu día", meta: "Ctrl+Alt+␣" };
}

function renderPill() {
  const v = statusView();
  const isMedia = v.kind === "media";
  $("#pillDot").className = "dot " + v.dot;
  $("#pillDot").hidden = isMedia;
  const art = $("#pillArt");
  art.hidden = !isMedia;
  if (isMedia) {
    const src = ui.media.art ? ui.mediaArt[ui.media.art] : null;
    const html = src ? `<img src="${src}" alt="" draggable="false" />` : ICONS.music;
    if (art.dataset.src !== (src || "icon")) {
      art.innerHTML = html;
      art.dataset.src = src || "icon";
    }
  }
  // Ecualizador: con la música de fondo o como protagonista.
  const eq = $("#pillEq");
  eq.hidden = !(S().media.show && Media.mediaPlaying()) || !!v.flash;
  eq.classList.toggle("main", isMedia);
  $("#pillLabel").textContent = v.label;
  const meta = $("#pillMeta");
  meta.textContent = v.meta;
  meta.classList.toggle("live", !!v.live);
  $("#pill").dataset.flash = v.flash || "";
  const running = F().running;
  const play = $("#pillPlay");
  const habit = ui.habitPrompt && ui.habitPrompt.until > Date.now() ? state.habits.find((h) => h.id === ui.habitPrompt.id) : null;
  play.dataset.target = habit ? "habit" : isMedia ? "media" : "focus";
  if (habit) {
    play.textContent = "+1";
    play.title = `Sumar 1 a ${habit.name}`;
  } else if (isMedia) {
    play.innerHTML = ICONS.pause;
    play.title = "Pausar música";
  } else {
    play.innerHTML = running ? ICONS.pause : ICONS.play;
    play.title = running ? "Pausar" : F().phase === "idle" ? "Empezar foco" : "Reanudar";
  }
  const prog = $(".pill-progress");
  prog.classList.toggle("on", v.progress != null);
  prog.classList.toggle("break", v.kind === "break");
  $("#pillProgress").style.width = `${Math.round((v.progress || 0) * 100)}%`;

  $("#headDot").className = "dot " + v.dot;
  $("#headLabel").textContent = v.label;
  $("#headTime").textContent = v.meta;
}

function renderAll() {
  renderPill();
  if (ui.mode === "media") Media.renderIsland();
  if (ui.mode !== "panel") return;
  VIEWS[state.ui.tab]?.render();
}

function setTab(tab) {
  if (!VIEWS[tab]) tab = "today";
  state.ui.tab = tab;
  $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  $$(".view").forEach((v) => v.classList.toggle("active", v.dataset.view === tab));
  if (tab === "stats") Stats.refreshUsage().then(renderAll);
  commit();
}

/* ============================================================
   Tema
   ============================================================ */
function isLight(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 140;
}

function applyTheme() {
  let theme = S().theme;
  if (theme === "system") theme = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  document.body.dataset.themePreview = theme;
  document.documentElement.style.setProperty("--accent", S().accent);
  document.documentElement.style.setProperty("--accent-ink", isLight(S().accent) ? "#0d0f1f" : "#ffffff");
}

/* ============================================================
   Modos y región de clics
   ============================================================ */
let modeToken = 0;
let modeChangedAt = 0;

/** Solo la isla visible acepta clics; el margen transparente deja pasarlos. */
function updateInputRegion() {
  const r = $("#island").getBoundingClientRect();
  invoke("set_input_region", { rect: [r.left, r.top, r.width, r.height, SHAPE[ui.mode][2]] });
}

async function setMode(next) {
  if (next === ui.mode) return;
  const prev = ui.mode;
  const token = ++modeToken;
  ui.mode = next;
  modeChangedAt = Date.now();
  const island = $("#island");
  const apply = () => {
    island.className = "island mode-" + next;
    renderAll();
  };
  invoke("set_input_region", { rect: null });

  if (area(next) > area(prev)) {
    await invoke("set_mode", { mode: next });
    if (token !== modeToken) return;
    requestAnimationFrame(apply);
  } else {
    apply();
    await new Promise((r) => setTimeout(r, 340));
    if (token !== modeToken) return;
    await invoke("set_mode", { mode: next });
  }
  setTimeout(() => token === modeToken && updateInputRegion(), 380);

  if (next === "capture") setTimeout(() => $("#captureInput").focus(), 60);
  if (next === "panel" && state.ui.tab === "today") setTimeout(() => $("#todayInput").focus(), 120);
}

const collapse = () => setMode("pill");

async function openPanel(tab) {
  await setMode("panel");
  setTab(tab || state.ui.tab);
}

/* ============================================================
   Eventos
   ============================================================ */
function bindPill() {
  const pill = $("#pill");
  let down = null;
  pill.addEventListener("pointerdown", (e) => {
    clearTimeout(hoverTimer);
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
    const target = e.currentTarget.dataset.target;
    if (target === "habit") {
      A.habitAdd(ui.habitPrompt.id, 1);
      ui.habitPrompt = null;
      ui.flash = null;
      return renderPill();
    }
    if (target === "media") return A.mediaControl("play-pause");
    A.toggleFocus();
  });
  $("#pillEq").addEventListener("click", (e) => {
    e.stopPropagation();
    openMedia(false);
  });
}

/* Isla de música: se abre al pasar el ratón o al cambiar de canción, como una isla dinámica. */
let hoverTimer = null;
let leaveTimer = null;
let peekTimer = null;
let hovering = false;

function openMedia(peek) {
  if (!ui.media || (ui.mode !== "pill" && ui.mode !== "media")) return;
  ui.mediaPeek = peek;
  setMode("media");
}

function bindMedia() {
  const island = $("#island");
  $("#pill").addEventListener("pointerenter", () => {
    if (!S().media.hover || !Media.mediaPlaying() || ui.mode !== "pill") return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => openMedia(true), 450);
  });
  $("#pill").addEventListener("pointerleave", () => clearTimeout(hoverTimer));
  island.addEventListener("pointerenter", () => {
    hovering = true;
    clearTimeout(leaveTimer);
  });
  island.addEventListener("pointerleave", () => {
    hovering = false;
    if (ui.mode !== "media" || !ui.mediaPeek) return;
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => ui.mode === "media" && !hovering && collapse(), 350);
  });
  // Clic fuera de los controles: abre el panel en la pestaña Foco, donde está "Ahora suena".
  $("#mediaView").addEventListener("click", (e) => {
    if (e.target.closest("[data-media],[data-seek]")) return;
    openPanel("focus");
  });
  Media.bind($("#mediaView"));
  Media.bind($("#nowPlaying"));
}

function onMediaEvent(m) {
  const changed = A.onMedia(m);
  if (!ui.media && ui.mode === "media") collapse();
  if (changed && S().media.peek && ui.mode === "pill" && F().phase !== "focus") {
    openMedia(true);
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => ui.mode === "media" && ui.mediaPeek && !hovering && collapse(), 4500);
  }
  renderAll();
}

function bindCapture() {
  const input = $("#captureInput");
  const chip = $("#captureDest");
  input.addEventListener("input", () => {
    const { dest } = parseCapture(input.value);
    chip.className = "chip " + dest;
    chip.textContent = dest === "note" ? "Nota" : dest === "today" ? "Hoy" : A.aiReady() && S().ai.classify ? "IA decide" : "Bandeja";
  });
  $("#capture").addEventListener("submit", (e) => {
    e.preventDefault();
    A.submitCapture(input.value);
    input.value = "";
    input.dispatchEvent(new Event("input"));
    collapse();
  });
}

function bindPanel() {
  $("#collapseBtn").innerHTML = ICONS.chevronUp;
  $("#collapseBtn").addEventListener("click", collapse);
  $('#tabs [data-tab="settings"]').innerHTML = ICONS.gear;
  $('#tabs [data-tab="ai"]').insertAdjacentHTML("afterbegin", ICONS.sparkle);
  $("#todayForm .add-btn").innerHTML = ICONS.plus;
  $("#todoistBtn").innerHTML = ICONS.refresh + " Todoist";
  $("#tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (b) setTab(b.dataset.tab);
  });
  const ctx = { goFocus: () => setTab("focus"), rerender: renderAll, applyTheme, collapse };
  for (const [name, view] of Object.entries(VIEWS)) view.bind($(`.view[data-view="${name}"]`), ctx);
}

function bindKeys() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && ui.mode !== "pill") {
      e.preventDefault();
      collapse();
      return;
    }
    if (ui.mode === "panel" && e.altKey && /^[1-6]$/.test(e.key)) setTab(TABS[Number(e.key) - 1]);
    if (ui.mode === "media" && e.key === " ") {
      e.preventDefault();
      A.mediaControl("play-pause");
    }
  });
}

function handleAction(action) {
  switch (action) {
    case "capture":
      return setMode("capture");
    case "toggle-focus":
      A.toggleFocus();
      return toast(F().running ? (F().phase === "focus" ? "Foco en marcha" : "Descanso en marcha") : "En pausa");
    case "toggle-panel":
      return ui.mode === "panel" ? collapse() : openPanel();
    case "collapse":
      return collapse();
    case "ai-plan":
      openPanel("ai");
      return A.aiReady() ? A.planDay() : toast("Conecta una IA en Ajustes");
    default:
      return openPanel();
  }
}

/* ============================================================
   Arranque
   ============================================================ */
async function loadEnvironment() {
  const safe = (p, fallback) => p.catch(() => fallback);
  const [env, aiStatus, monitors, backups, license, autostart] = await Promise.all([
    safe(invoke("env_info"), {}),
    safe(invoke("ai_status"), null),
    safe(invoke("list_monitors"), []),
    safe(invoke("list_backups"), []),
    safe(invoke("license_status"), null),
    safe(invoke("get_autostart"), false),
  ]);
  Object.assign(ui, { env, aiStatus, monitors: monitors || [], backups: backups || [], license, autostart });
  // Primera vez: si la distro trae su IA, la usamos sin preguntar.
  if (aiStatus?.distro && S().ai.provider === "none" && !state.ui.aiAutoChecked) {
    S().ai.provider = "distro";
    toast(`IA de tu distro detectada: ${aiStatus.distro.name}`);
  }
  state.ui.aiAutoChecked = true;
}

async function init() {
  if (PREVIEW) document.body.classList.add("preview");
  await load();
  invoke("set_utc_offset", { minutes: -new Date().getTimezoneOffset() });
  A.restoreDnd();
  A.dailyRollover();

  // Si una fase terminó con la app cerrada, la cerramos sin notificar.
  const f = F();
  if (f.running && f.endAt && f.endAt <= Date.now()) A.completePhase({ quiet: true });

  applyTheme();
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", applyTheme);
  onChange(renderAll);
  bindPill();
  bindCapture();
  bindPanel();
  bindMedia();
  bindKeys();

  await loadEnvironment();
  invoke("set_tracking", { enabled: S().tracking });
  if (S().systemShortcuts) invoke("set_app_shortcuts", { enabled: false });
  setTab(state.ui.tab || "today");

  await listen("pill-action", (e) => handleAction(e.payload));
  await listen("pill-blur", () => {
    if (ui.mode === "pill" || !S().collapseOnBlur || Date.now() - modeChangedAt < 600) return;
    collapse();
  });
  await listen("active-app", (e) => A.onActiveApp(e.payload));
  await listen("media", (e) => onMediaEvent(e.payload));
  invoke("media_state").then((m) => m && A.onMedia(m)).catch(() => {});
  if (state.ui.mediaPinned) invoke("media_pin", { player: state.ui.mediaPinned });

  const pending = await invoke("take_pending_action");
  if (pending) handleAction(pending);
  setTimeout(updateInputRegion, 400);

  if (S().calendars.length) A.syncCalendars();
  setInterval(() => S().calendars.length && A.syncCalendars(), 15 * 60000);
  setInterval(() => state.ui.tab === "stats" && ui.mode === "panel" && Stats.refreshUsage().then(renderAll), 60000);
  if (!PREVIEW) {
    setTimeout(async () => {
      ui.update = await invoke("check_update").catch(() => null);
      if (ui.update) toast(`Nueva versión ${ui.update.version} disponible en Ajustes`);
    }, 20000);
  }

  // Vista previa: ?mode=panel&tab=focus
  if (PREVIEW) {
    const q = new URLSearchParams(location.search);
    if (q.get("mode")) await setMode(q.get("mode"));
    if (q.get("tab")) setTab(q.get("tab"));
    if (q.get("plan")) await A.planDay();
    if (q.get("close")) await A.closeDay();
    if (q.get("weekly")) await A.weeklyReview();
  }

  // Reloj
  let today = dayKey();
  let ticks = 0;
  setInterval(() => {
    const fo = F();
    if (fo.running && fo.endAt && Date.now() >= fo.endAt) A.completePhase();
    if (ui.flash && ui.flash.until <= Date.now()) ui.flash = null;
    A.checkDistraction();
    if (++ticks % 20 === 0) {
      A.checkAgenda();
      A.checkHabits();
      A.checkWeekly();
      if (dayKey() !== today) {
        today = dayKey();
        A.dailyRollover();
        renderAll();
      }
    }
    if (ui.habitPrompt && ui.habitPrompt.until <= Date.now()) ui.habitPrompt = null;
    renderPill();
    if (ui.mode === "panel" && state.ui.tab === "focus") Focus.renderClock();
    if (ui.mode === "media" || (ui.mode === "panel" && state.ui.tab === "focus")) Media.tickProgress();
  }, 250);
}

init();
