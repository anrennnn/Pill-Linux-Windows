// Herramientas rápidas, al estilo AssistiveTouch del iPhone:
// un menú de accesos directos que se abre desde la píldora.

import * as A from "../actions.js";
import { esc, habitCount } from "../core.js";
import { ICONS } from "../icons.js";
import { F, S, state } from "../store.js";
import { $, ui } from "../ui.js";

/** Catálogo: cada herramienta sabe pintarse, si está disponible y qué hace. */
export const TOOLS = {
  capture: { name: "Capturar", icon: () => ICONS.plus, label: () => "Capturar" },
  focus: {
    name: "Foco",
    icon: () => (F().running ? ICONS.pause : ICONS.play),
    label: () => (F().running ? "Pausar foco" : F().phase === "idle" ? "Empezar foco" : "Reanudar"),
    active: () => F().running,
  },
  media: {
    name: "Música",
    icon: () => (ui.media?.status === "Playing" ? ICONS.pause : ICONS.music),
    label: () => (ui.media?.status === "Playing" ? "Pausar música" : "Música"),
    available: () => !!ui.media,
  },
  next: { name: "Siguiente canción", icon: () => ICONS.next, label: () => "Siguiente", available: () => !!ui.media },
  habit: {
    name: "+1 al primer hábito",
    icon: () => `<span class="emoji">${esc(state.habits[0]?.emoji || "✨")}</span>`,
    label: () => {
      const h = state.habits[0];
      return h ? `+1 ${h.name} (${habitCount(h)}/${h.target})` : "Hábito";
    },
    available: () => state.habits.length > 0,
  },
  note: { name: "Nota rápida", icon: () => ICONS.task, label: () => "Nota" },
  plan: { name: "Planificar el día (IA)", icon: () => ICONS.sparkle, label: () => "Plan IA", available: () => A.aiReady() },
  mode: {
    name: "Primer modo",
    icon: () => `<span class="emoji">${esc(S().modes[0]?.emoji || "▶")}</span>`,
    label: () => (A.activeMode() ? `Salir de ${A.activeMode().name}` : S().modes[0]?.name || "Modo"),
    available: () => S().modes.length > 0,
    active: () => !!A.activeMode(),
  },
  dnd: {
    name: "No molestar",
    icon: () => ICONS.moon,
    label: () => (state.ui.manualDnd ? "Molestar" : "No molestar"),
    available: () => !!ui.env?.dnd_supported,
    active: () => !!state.ui.manualDnd,
  },
  notifs: {
    name: "Avisos",
    icon: () => ICONS.bell,
    label: () => {
      const n = A.unreadNotifs().length;
      return n ? `Avisos (${n})` : "Avisos";
    },
    available: () => !!ui.env?.notifications_supported,
  },
  panel: { name: "Abrir panel", icon: () => ICONS.grid, label: () => "Panel" },
  hide: { name: "Ocultar píldora", icon: () => ICONS.x, label: () => "Ocultar" },
};

export const visibleTools = () =>
  S().tools.items.filter((id) => TOOLS[id] && (!TOOLS[id].available || TOOLS[id].available())).slice(0, 8);

export function render() {
  const items = visibleTools();
  $("#toolsView").innerHTML = items.length
    ? items
        .map((id) => {
          const t = TOOLS[id];
          return `<button class="tool ${t.active?.() ? "active" : ""}" data-tool="${id}"><span class="tool-icon">${t.icon()}</span><span class="tool-label">${esc(t.label())}</span></button>`;
        })
        .join("")
    : `<div class="media-empty">Elige tus herramientas en Ajustes</div>`;
}

/** `ctx` trae las acciones de la isla: setMode, openPanel, collapse, capture. */
export async function run(id, ctx) {
  switch (id) {
    case "capture":
      return ctx.capture("");
    case "note":
      return ctx.capture("n: ");
    case "focus":
      A.toggleFocus();
      return ctx.collapse();
    case "media":
      A.mediaControl("play-pause");
      return ctx.collapse();
    case "next":
      A.mediaControl("next");
      return ctx.collapse();
    case "habit":
      A.habitAdd(state.habits[0].id, 1);
      return ctx.collapse();
    case "plan":
      await ctx.openPanel("ai");
      return A.planDay();
    case "mode":
      if (A.activeMode()) A.exitMode();
      else A.activateMode(S().modes[0].id);
      return ctx.collapse();
    case "dnd":
      A.toggleManualDnd();
      return ctx.collapse();
    case "notifs":
      return ctx.openPanel("notifs");
    case "panel":
      return ctx.openPanel();
    case "hide":
      return ctx.hide();
  }
}

export function bind(ctx) {
  $("#toolsView").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tool]");
    if (b) run(b.dataset.tool, ctx);
  });
}
