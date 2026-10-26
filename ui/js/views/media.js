// Música: isla expandida (estilo isla dinámica) y tarjeta "Ahora suena" del panel.

import * as A from "../actions.js";
import { esc, fmtTime, mediaPosition } from "../core.js";
import { ICONS } from "../icons.js";
import { $, $$, ui } from "../ui.js";

export const mediaPlaying = () => ui.media?.status === "Playing";

function artHtml(cls) {
  const src = ui.media?.art ? ui.mediaArt[ui.media.art] : null;
  return src ? `<img class="${cls}" src="${src}" alt="" draggable="false" />` : `<span class="${cls} art-empty">${ICONS.music}</span>`;
}

const controls = (big) => {
  const playing = mediaPlaying();
  return `<button class="mbtn" data-media="previous" title="Anterior">${ICONS.prev}</button>
    <button class="mbtn ${big ? "big" : ""}" data-media="play-pause" title="${playing ? "Pausar" : "Reproducir"}">${playing ? ICONS.pause : ICONS.play}</button>
    <button class="mbtn" data-media="next" title="Siguiente">${ICONS.next}</button>`;
};

function progressHtml() {
  const m = ui.media;
  const pos = mediaPosition(m, ui.mediaAt);
  const pct = m.length > 0 ? (pos / m.length) * 100 : 0;
  return `<div class="mprog ${m.can_seek ? "seekable" : ""}">
      <span class="mtime" data-mpos>${fmtTime(pos)}</span>
      <div class="mbar" data-seek><i data-mfill style="width:${pct}%"></i></div>
      <span class="mtime">${m.length > 0 ? fmtTime(m.length) : "--:--"}</span>
    </div>`;
}

/** Isla expandida con la canción actual. */
export function renderIsland() {
  const box = $("#mediaView");
  const m = ui.media;
  if (!m) {
    box.innerHTML = `<div class="media-empty">${ICONS.music} Nada sonando</div>`;
    return;
  }
  const players = m.players.length > 1 ? `<button class="mplayer" data-media="switch" title="Cambiar de reproductor">${esc(m.name)} ${ICONS.chevronDown}</button>` : `<span class="mplayer">${esc(m.name)}</span>`;
  box.innerHTML = `
    ${artHtml("media-art")}
    <div class="media-main">
      <div class="media-title">${esc(m.title || "Sin título")}</div>
      <div class="media-sub"><span class="media-artist">${esc(m.artist || "")}</span>${players}</div>
      ${progressHtml()}
    </div>
    <div class="media-controls">${controls(true)}</div>`;
}

/** Tarjeta compacta para el panel (pestaña Foco). */
export function renderCard() {
  const box = $("#nowPlaying");
  const m = ui.media;
  if (!m || !m.title) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.innerHTML = `${artHtml("np-art")}
    <div class="np-main"><div class="np-title">${esc(m.title)}</div><div class="np-artist">${esc(m.artist || m.name)}</div>${progressHtml()}</div>
    <div class="np-controls">${controls(false)}</div>`;
}

/** Actualiza solo la barra de progreso (cada tic, sin repintar). */
export function tickProgress() {
  const m = ui.media;
  if (!m) return;
  const pos = mediaPosition(m, ui.mediaAt);
  $$("[data-mpos]").forEach((el) => (el.textContent = fmtTime(pos)));
  if (m.length > 0) $$("[data-mfill]").forEach((el) => (el.style.width = `${(pos / m.length) * 100}%`));
}

/** Delegación de eventos para cualquier contenedor con controles multimedia. */
export function bind(root) {
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-media]");
    if (btn) {
      e.stopPropagation();
      const action = btn.dataset.media;
      if (action === "switch") {
        const m = ui.media;
        const idx = m.players.findIndex((p) => p.id === m.player);
        const next = m.players[(idx + 1) % m.players.length];
        A.mediaPin(next.id);
        return;
      }
      return A.mediaControl(action);
    }
    const bar = e.target.closest("[data-seek]");
    if (bar && ui.media?.can_seek && ui.media.length > 0) {
      e.stopPropagation();
      const r = bar.getBoundingClientRect();
      A.mediaSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * ui.media.length);
    }
  });
}
