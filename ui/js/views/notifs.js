// Avisos: isla que se asoma al llegar uno y lista en el panel.

import * as A from "../actions.js";
import { NOTIF_RULES, avatarColor, esc, groupNotifs, timeAgo } from "../core.js";
import { ICONS } from "../icons.js";
import { S, state } from "../store.js";
import { $, busy, ui } from "../ui.js";

const avatar = (source) => `<span class="avatar" style="--c:${avatarColor(source)}">${esc((source || "?").trim().charAt(0).toUpperCase())}</span>`;

/** Isla que se asoma con el último aviso. */
export function renderIsland() {
  const n = ui.notifPeek;
  const box = $("#notifView");
  if (!n) {
    box.innerHTML = "";
    return;
  }
  const more = A.unreadNotifs().length - 1;
  box.innerHTML = `${avatar(n.source)}
    <div class="nv-main">
      <div class="nv-top"><span class="nv-source">${esc(n.source)}</span><span class="nv-time">${timeAgo(n.at)}${more > 0 ? ` · +${more}` : ""}</span></div>
      <div class="nv-title">${esc(n.title)}</div>
      ${n.body ? `<div class="nv-body">${esc(n.body)}</div>` : ""}
    </div>`;
}

function summaryCard() {
  if (busy("notifSummary")) return `<div class="card"><div class="loading"><span class="spinner"></span>Resumiendo tus avisos…</div></div>`;
  const s = state.notifs.summary;
  const err = ui.errors.notifSummary ? `<p class="error">${esc(ui.errors.notifSummary)}</p>` : "";
  if (!s) return err ? `<div class="card">${err}</div>` : "";
  const list = (items) => `<ul class="bullets">${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  return `<div class="card">
      <div class="card-title">${ICONS.sparkle} Resumen de ${s.count} avisos</div>
      ${s.summary ? `<p>${esc(s.summary)}</p>` : ""}
      ${s.urgent.length ? `<div class="mini-title">Atender ya</div>${list(s.urgent)}` : ""}
      ${s.later.length ? `<div class="mini-title">Puede esperar</div>${list(s.later)}` : ""}
    </div>`;
}

/** Vista del panel con todos los avisos, agrupados por app o web. */
export function render() {
  const box = $("#notifsBox");
  const cfg = S().notifications;
  if (!ui.env?.notifications_supported) {
    box.innerHTML = `<div class="card intro"><div class="card-title">${ICONS.bell} Avisos</div><p>En Windows, leer las notificaciones del sistema solo se permite a apps de la Microsoft Store. Llegará con esa versión (pendiente).</p></div>`;
    return;
  }
  if (!cfg.enabled) {
    box.innerHTML = `<div class="card intro">
        <div class="card-title">${ICONS.bell} Tus avisos, en la píldora</div>
        <p>FocusPill puede mostrar las notificaciones del sistema y de las webs abiertas (Slack, Gmail, WhatsApp…). Durante el foco las guarda y te las enseña al terminar.</p>
        <p class="hint">Solo lectura y en tu equipo: no responde por ti ni envía nada fuera. El historial se borra solo a las ${cfg.keepHours} h.</p>
        <button class="btn primary small" data-act="notif-enable">Activar avisos</button>
      </div>`;
    return;
  }
  const groups = groupNotifs(state.notifs.items);
  const unread = A.unreadNotifs().length;
  const head = `<div class="nf-head">
      <span class="muted">${unread ? `${unread} sin leer` : "Todo leído"}</span>
      <span class="nf-actions">
        ${unread && A.aiReady() ? `<button class="link-btn" data-act="notif-ai" ${busy("notifSummary") ? "disabled" : ""}>${ICONS.sparkle} Resumir</button>` : ""}
        ${unread ? `<button class="link-btn" data-act="notif-read">Marcar leídos</button>` : ""}
        ${groups.length ? `<button class="link-btn muted-link" data-act="notif-clear">Borrar</button>` : ""}
      </span>
    </div>`;
  if (!groups.length) {
    box.innerHTML = `${head}<div class="empty">Sin avisos. Llegarán aquí las notificaciones de tus apps y webs.</div>`;
    return;
  }
  const rule = (source) => state.notifs.rules[source] || "";
  const rows = groups
    .map(
      (g) => `<section class="nf-group">
        <header>${avatar(g.source)}<b>${esc(g.source)}</b>${g.unread ? `<span class="badge">${g.unread}</span>` : ""}
          <select class="rule" data-rule="${esc(g.source)}" title="Qué hacer con los avisos de ${esc(g.source)}">
            <option value="">Por defecto</option>${Object.entries(NOTIF_RULES).map(([k, v]) => `<option value="${k}" ${rule(g.source) === k ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </header>
        <ul>${g.items
          .slice(0, 6)
          .map(
            (n) => `<li class="nf-item ${n.read ? "" : "unread"}" data-id="${n.id}" title="Abrir ${esc(n.source)}">
              <div class="nf-line"><b>${esc(n.title)}</b><span class="nv-time">${timeAgo(n.at)}</span></div>
              ${n.body ? `<div class="nf-body">${esc(n.body)}</div>` : ""}
            </li>`
          )
          .join("")}</ul>
      </section>`
    )
    .join("");
  box.innerHTML = head + summaryCard() + rows;
}

export function bind(root) {
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (btn) {
      switch (btn.dataset.act) {
        case "notif-enable": return A.setNotificationsEnabled(true);
        case "notif-ai": return A.summarizeNotifs();
        case "notif-read": return A.markNotifsRead();
        case "notif-clear": return A.clearNotifs();
      }
      return;
    }
    const item = e.target.closest(".nf-item");
    if (item) {
      const n = state.notifs.items.find((x) => x.id === item.dataset.id);
      if (n) A.openNotifSource(n);
    }
  });
  root.addEventListener("change", (e) => {
    const sel = e.target.closest("[data-rule]");
    if (sel) A.setNotifRule(sel.dataset.rule, sel.value);
  });
}
