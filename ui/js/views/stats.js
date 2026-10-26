// Vista "Progreso": foco, racha, últimos 7 días y tiempo real por aplicación.

import { categorize, dayKey, esc, fmtDuration, habitDone, habitStreak, lastDays, minutesOn, parseDay, streak, usageSummary } from "../core.js";
import * as A from "../actions.js";
import { invoke } from "../bridge.js";
import { S, commit, state } from "../store.js";
import { $, $$, ui } from "../ui.js";

const CATS = { productive: "Productiva", neutral: "Neutra", distraction: "Distracción" };
const NEXT_CAT = { productive: "neutral", neutral: "distraction", distraction: "productive" };

export async function refreshUsage() {
  try {
    ui.usage = (await invoke("get_usage")) || {};
  } catch (_) {
    ui.usage = {};
  }
}

function usageFor(range) {
  if (range === "today") return ui.usage[dayKey()] || {};
  const merged = {};
  for (const d of lastDays(7)) for (const [app, secs] of Object.entries(ui.usage[d] || {})) merged[app] = (merged[app] || 0) + secs;
  return merged;
}

function appsSection() {
  if (!S().tracking) return `<p class="hint">El registro de aplicaciones está desactivado en Ajustes.</p>`;
  if (ui.env && !ui.env.tracking_supported) return `<p class="hint">Tu sesión no permite saber qué app está en primer plano (Wayland nativo). Funciona en X11, XWayland y Windows.</p>`;
  const sum = usageSummary(usageFor(ui.statsRange), S().apps);
  const total = sum.productive + sum.neutral + sum.distraction;
  if (!total) return `<p class="hint">Aún no hay datos. FocusPill anota la app activa cada 5 s mientras usas el ordenador.</p>`;
  const pct = (x) => `${((x / total) * 100).toFixed(1)}%`;
  const rows = sum.apps
    .slice(0, 8)
    .map(
      (a) => `<li class="app-row">
        <span class="app-name">${esc(a.app)}</span>
        <button class="cat ${a.cat}" data-app="${esc(a.app)}" title="Clic para cambiar la categoría">${CATS[a.cat]}</button>
        <span class="mins">${fmtDuration(a.secs)}</span></li>`
    )
    .join("");
  return `<div class="stack"><i class="productive" style="width:${pct(sum.productive)}"></i><i class="neutral" style="width:${pct(sum.neutral)}"></i><i class="distraction" style="width:${pct(sum.distraction)}"></i></div>
    <div class="legend"><span><i class="productive"></i>Productivo ${fmtDuration(sum.productive)}</span><span><i class="neutral"></i>Neutro ${fmtDuration(sum.neutral)}</span><span><i class="distraction"></i>Distracción ${fmtDuration(sum.distraction)}</span></div>
    <ul class="apps">${rows}</ul>`;
}

export function render() {
  const today = dayKey();
  const todaySessions = state.sessions.filter((s) => dayKey(s.start) === today);
  const mins = minutesOn(state.sessions, today);
  const st = streak(state.sessions, today);
  const productive = usageSummary(ui.usage[today] || {}, S().apps).productive;
  $("#kpis").innerHTML = [
    ["Foco hoy", `${mins}<small>min</small>`],
    ["Bloques hoy", `${todaySessions.length}`],
    ["Tareas hechas hoy", `${A.doneToday().length}`],
    ["Racha", `${st}<small>${st === 1 ? "día" : "días"}</small>`],
    ...(productive ? [["Tiempo productivo", `${Math.round(productive / 60)}<small>min</small>`]] : []),
  ]
    .map(([l, v]) => `<div class="kpi"><div class="kpi-label">${l}</div><div class="kpi-value">${v}</div></div>`)
    .join("");

  const days = lastDays(7, today);
  const vals = days.map((d) => minutesOn(state.sessions, d));
  const max = Math.max(30, ...vals);
  const names = ["D", "L", "M", "X", "J", "V", "S"];
  $("#bars").innerHTML = days
    .map(
      (d, i) => `<div class="bar ${d === today ? "today" : ""}">
      <span class="bar-val">${vals[i] || ""}</span>
      <span class="bar-col"><i style="height:${Math.round((vals[i] / max) * 100)}%"></i></span>
      <span class="bar-day">${names[parseDay(d).getDay()]}</span></div>`
    )
    .join("");

  const byTask = new Map();
  state.sessions
    .filter((s) => dayKey(s.start) >= days[0])
    .forEach((s) => {
      const key = s.taskText || "Sin tarea concreta";
      byTask.set(key, (byTask.get(key) || 0) + s.minutes);
    });
  const top = [...byTask.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  $("#topTasks").innerHTML = top.length
    ? top.map(([t, m]) => `<li class="item"><div class="row"><span class="txt">${esc(t)}</span><span class="mins">${m} min</span></div></li>`).join("")
    : `<li class="empty">Completa tu primer bloque de foco para ver dónde va tu tiempo.</li>`;

  const days7 = lastDays(7, today);
  $("#habitStats").innerHTML = state.habits.length
    ? `<div class="section-title"><span>Hábitos · 7 días</span></div><ul class="habit-stats">${state.habits
        .map((h) => {
          const st = habitStreak(h, today);
          const dots = days7.map((d) => `<i class="${habitDone(h, d) ? "on" : ""}" title="${parseDay(d).toLocaleDateString("es", { weekday: "short", day: "numeric" })}"></i>`).join("");
          return `<li><span class="hs-name">${esc(h.emoji)} ${esc(h.name)}</span><span class="hs-dots">${dots}</span><span class="hs-streak">${st ? `🔥 ${st}` : ""}</span></li>`;
        })
        .join("")}</ul>`
    : "";

  $$("#rangeSeg button").forEach((b) => b.classList.toggle("active", b.dataset.range === ui.statsRange));
  $("#appsBox").innerHTML = appsSection();
}

export function bind(root, { rerender }) {
  $("#rangeSeg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-range]");
    if (!b) return;
    ui.statsRange = b.dataset.range;
    rerender();
  });
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-app]");
    if (!b) return;
    const app = b.dataset.app;
    S().apps[app] = NEXT_CAT[categorize(app, S().apps)];
    commit();
  });
}
