// Vista "Hoy": agenda, meta de foco, prioridades, bandeja y programadas.

import * as A from "../actions.js";
import { MAX_TODAY, REPEATS, dayKey, esc, habitCount, habitDone, hhmm, minutesOn, parseDay } from "../core.js";
import { ICONS } from "../icons.js";
import { S, state } from "../store.js";
import { $, $$, busy, ui } from "../ui.js";

function chips(t) {
  const out = [];
  if (t.sub?.length) out.push(`<span class="chip-mini">${t.sub.filter((s) => s.done).length}/${t.sub.length}</span>`);
  if (t.repeat) out.push(`<span class="chip-mini" title="${REPEATS[t.repeat]}">${ICONS.repeat}</span>`);
  if (t.todoistId) out.push(`<span class="chip-mini todoist" title="Importada de Todoist">T</span>`);
  const mins = A.focusMinutesFor(t.id);
  if (mins) out.push(`<span class="mins">${mins}′</span>`);
  return out.join("");
}

function detail(t, kind) {
  if (!ui.expanded.has(t.id)) return "";
  const subs = (t.sub || [])
    .map(
      (s) => `<li class="sub ${s.done ? "done" : ""}" data-sub="${s.id}">
        <button class="check small" data-act="sub-toggle" aria-label="Completar subtarea">${ICONS.check}</button>
        <span class="sub-txt">${esc(s.text)}</span>
        <button class="act" data-act="sub-del" title="Borrar subtarea">${ICONS.x}</button></li>`
    )
    .join("");
  const repeatOpts = [`<option value="">No se repite</option>`, ...Object.entries(REPEATS).map(([k, v]) => `<option value="${k}" ${t.repeat === k ? "selected" : ""}>${v}</option>`)].join("");
  const move = kind === "today" ? `<button class="chip-btn" data-act="to-inbox">${ICONS.down} A la bandeja</button>` : kind === "inbox" ? `<button class="chip-btn" data-act="to-today">${ICONS.up} A hoy</button>` : "";
  return `<div class="detail">
      <ul class="subs">${subs}</ul>
      <form class="sub-add" data-form="sub-add" autocomplete="off"><input placeholder="Añadir subtarea…" spellcheck="false" /></form>
      <div class="detail-row">
        <label class="select-wrap">${ICONS.repeat}<select data-change="repeat">${repeatOpts}</select></label>
        ${move}
        <button class="chip-btn danger" data-act="delete">${ICONS.x} Borrar</button>
      </div>
    </div>`;
}

function scheduler(t) {
  if (ui.scheduling !== t.id) return "";
  const mins = [25, 50, 90].includes(Number(S().focusMin)) ? [25, 50, 90] : [Number(S().focusMin), 25, 50, 90];
  return `<form class="schedule" data-form="schedule" autocomplete="off">
      ${ICONS.clock}
      <input type="time" value="${A.nextSlot()}" required />
      <select>${mins.map((m) => `<option value="${m}">${m} min</option>`).join("")}</select>
      <button class="btn primary small">Programar</button>
      <button type="button" class="act" data-act="schedule-cancel" title="Cancelar">${ICONS.x}</button>
    </form>`;
}

function taskItem(t, kind) {
  const cur = A.currentTask();
  const isCurrent = kind === "today" && cur && cur.id === t.id;
  const draggable = kind === "today" || kind === "inbox";
  const acts =
    kind === "done" || kind === "scheduled"
      ? `<button class="act" data-act="expand" title="Más">${ICONS.more}</button>`
      : `<button class="act play" data-act="focus" title="Enfocarme en esto">${ICONS.play}</button>
         <button class="act" data-act="schedule" title="Programar en la agenda">${ICONS.clock}</button>
         <button class="act" data-act="expand" title="Subtareas y más">${ICONS.more}</button>`;
  const due = kind === "scheduled" && t.dueDay ? `<span class="mins">${parseDay(t.dueDay).toLocaleDateString("es", { weekday: "short", day: "numeric" })}</span>` : "";
  return `<li class="item ${t.done ? "done" : ""} ${isCurrent ? "current" : ""} ${ui.expanded.has(t.id) ? "open" : ""}" data-id="${t.id}" data-list="${kind}">
      <div class="row">
        ${draggable ? `<span class="grip" data-drag title="Arrastra para ordenar">${ICONS.grip}</span>` : ""}
        <button class="check" data-act="done" aria-label="Completar">${ICONS.check}</button>
        <span class="txt" data-edit title="Doble clic para editar">${esc(t.text)}</span>
        <span class="chips">${chips(t)}${due}</span>
        <span class="acts">${acts}</span>
      </div>
      ${scheduler(t)}
      ${detail(t, kind)}
    </li>`;
}

function agenda() {
  const items = A.agendaToday();
  if (!items.length) return "";
  const now = Date.now();
  const rows = items
    .map((i) => {
      const state = i.allDay ? "" : i.end <= now ? "past" : i.start <= now ? "now" : "";
      const time = i.allDay ? "Todo el día" : `${hhmm(i.start)}`;
      const meta = i.allDay ? i.calendar || "" : `${Math.round((i.end - i.start) / 60000)} min`;
      const color = i.kind === "event" ? i.color || "var(--muted)" : "var(--accent)";
      const acts =
        i.kind === "block"
          ? `<span class="acts"><button class="act play" data-act="block-focus" title="Empezar ahora">${ICONS.play}</button><button class="act" data-act="block-del" title="Quitar">${ICONS.x}</button></span>`
          : "";
      return `<li class="ag ${i.kind} ${state} ${i.done ? "done" : ""}" data-block="${i.kind === "block" ? i.id : ""}" data-task="${i.taskId || ""}">
          <span class="ag-time">${time}</span><i class="ag-bar" style="background:${color}"></i>
          <span class="ag-title">${esc(i.title)}</span><span class="ag-meta">${esc(meta)}</span>${acts}</li>`;
    })
    .join("");
  return `<div class="section-title"><span>Agenda</span><span class="muted">${new Date().toLocaleDateString("es", { weekday: "long", day: "numeric" })}</span></div><ul class="agenda">${rows}</ul>`;
}

function modesRow() {
  const modes = S().modes;
  if (!modes.length) return "";
  const active = A.activeMode();
  const chips = modes
    .map((m) =>
      active?.id === m.id
        ? `<button class="mode-chip active" data-act="mode-exit" title="Terminar el modo">${esc(m.emoji || "▶")} ${esc(m.name)} <span class="x">${ICONS.x}</span></button>`
        : `<button class="mode-chip" data-act="mode" data-mode="${m.id}" title="Activar: abre sus apps y webs">${esc(m.emoji || "▶")} ${esc(m.name)}</button>`
    )
    .join("");
  return `<div class="mode-row">${chips}</div>`;
}

function habitsRow() {
  if (!state.habits.length) return "";
  const chips = state.habits
    .map((h) => {
      const n = habitCount(h);
      const pct = Math.min(1, n / Math.max(1, h.target));
      const deg = Math.round(pct * 360);
      return `<button class="habit ${habitDone(h) ? "done" : ""}" data-act="habit" data-habit="${h.id}" title="Clic: +1 · Clic derecho: −1">
          <span class="habit-ring" style="--deg:${deg}deg"><span>${esc(h.emoji)}</span></span>
          <span class="habit-txt"><b>${esc(h.name)}</b><small>${n}/${h.target}</small></span>
        </button>`;
    })
    .join("");
  return `<div class="section-title"><span>Hábitos</span></div><div class="habit-row">${chips}</div>`;
}

export function render() {
  const today = A.todayTasks();
  const inbox = A.inboxTasks();
  const done = A.doneToday();
  const scheduled = A.scheduledTasks();

  $("#modesBox").innerHTML = modesRow();
  $("#habitsBox").innerHTML = habitsRow();
  $("#agendaBox").innerHTML = agenda();

  $("#todayCount").textContent = `${today.length}/${MAX_TODAY}`;
  $("#todayList").innerHTML = today.length
    ? today.map((t) => taskItem(t, "today")).join("")
    : `<li class="empty">¿Qué 3 cosas harían que hoy fuera un buen día?</li>`;
  $("#todayInput").placeholder = today.length >= MAX_TODAY ? "Prioridades completas · irá a la bandeja" : "Añade una prioridad para hoy…";

  $("#inboxCount").textContent = inbox.length || "";
  $("#todoistBtn").hidden = !S().todoist.token;
  $("#todoistBtn").classList.toggle("spin", busy("todoist"));
  $("#inboxList").innerHTML = inbox.length
    ? inbox.map((t) => taskItem(t, "inbox")).join("")
    : `<li class="empty">Bandeja vacía. Captura con Ctrl+Alt+Espacio.</li>`;

  $("#doneCount").textContent = done.length || "0";
  $("#doneList").innerHTML = done.map((t) => taskItem(t, "done")).join("");
  $("#doneFold").hidden = !done.length;

  $("#schedCount").textContent = scheduled.length || "0";
  $("#schedList").innerHTML = scheduled.map((t) => taskItem(t, "scheduled")).join("");
  $("#schedFold").hidden = !scheduled.length;

  const mins = minutesOn(state.sessions, dayKey());
  const goal = Math.max(1, S().dailyGoalMin);
  const pct = Math.min(100, Math.round((mins / goal) * 100));
  $("#goal").className = "goal" + (mins >= goal ? " reached" : "");
  $("#goal").innerHTML = `<div class="goal-top"><span>Foco de hoy</span><b>${mins} / ${goal} min</b></div><div class="goal-bar"><i style="width:${pct}%"></i></div>`;
}

/* ---------------- Eventos ---------------- */

function startEdit(txt, id) {
  txt.contentEditable = "true";
  txt.focus();
  document.getSelection().selectAllChildren(txt);
  const finish = (save) => {
    txt.removeEventListener("blur", onBlur);
    txt.removeEventListener("keydown", onKey);
    txt.contentEditable = "false";
    if (save) A.renameTask(id, txt.textContent);
    else render();
  };
  const onBlur = () => finish(true);
  const onKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    }
  };
  txt.addEventListener("blur", onBlur);
  txt.addEventListener("keydown", onKey);
}

function bindDrag(root) {
  let drag = null;
  root.addEventListener("pointerdown", (e) => {
    const grip = e.target.closest("[data-drag]");
    if (!grip || e.button !== 0) return;
    const item = grip.closest(".item");
    drag = { id: item.dataset.id, list: item.dataset.list, el: item, target: null };
    item.classList.add("dragging");
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  root.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const siblings = $$(`.item[data-list="${drag.list}"]`, root).filter((el) => el !== drag.el);
    siblings.forEach((el) => el.classList.remove("drop-before", "drop-after"));
    let index = siblings.length;
    for (let i = 0; i < siblings.length; i++) {
      const r = siblings[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        index = i;
        break;
      }
    }
    drag.target = index;
    if (siblings[index]) siblings[index].classList.add("drop-before");
    else siblings[siblings.length - 1]?.classList.add("drop-after");
  });
  const end = () => {
    if (!drag) return;
    $$(".drop-before, .drop-after, .dragging", root).forEach((el) => el.classList.remove("drop-before", "drop-after", "dragging"));
    if (drag.target !== null) A.reorder(drag.list, drag.id, drag.target);
    drag = null;
  };
  root.addEventListener("pointerup", end);
  root.addEventListener("pointercancel", end);
}

export function bind(root, { goFocus }) {
  $("#todayForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#todayInput");
    if (A.addTask(input.value, "today")) input.value = "";
  });
  $("#todoistBtn").addEventListener("click", A.importTodoist);

  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const item = btn.closest(".item");
    const id = item?.dataset.id;
    const ag = btn.closest(".ag");
    switch (btn.dataset.act) {
      case "done": return A.toggleDone(id);
      case "focus":
        A.startFocus(id);
        return goFocus();
      case "schedule":
        ui.scheduling = ui.scheduling === id ? null : id;
        render();
        return $(`.item[data-id="${id}"] .schedule input`)?.focus();
      case "schedule-cancel":
        ui.scheduling = null;
        return render();
      case "expand":
        ui.expanded.has(id) ? ui.expanded.delete(id) : ui.expanded.add(id);
        render();
        return $(`.item[data-id="${id}"] .sub-add input`)?.focus();
      case "to-inbox": return A.moveTask(id, "inbox");
      case "to-today": return A.moveTask(id, "today");
      case "delete":
        ui.expanded.delete(id);
        return A.deleteTask(id);
      case "sub-toggle": return A.toggleSub(id, btn.closest(".sub").dataset.sub);
      case "sub-del": return A.deleteSub(id, btn.closest(".sub").dataset.sub);
      case "block-focus":
        A.startFocus(ag.dataset.task || null);
        return goFocus();
      case "block-del": return A.deleteBlock(ag.dataset.block);
      case "mode": return A.activateMode(btn.dataset.mode);
      case "mode-exit": return A.exitMode();
      case "habit": return A.habitAdd(btn.dataset.habit, 1);
    }
  });

  root.addEventListener("contextmenu", (e) => {
    const h = e.target.closest('[data-act="habit"]');
    if (!h) return;
    e.preventDefault();
    A.habitAdd(h.dataset.habit, -1);
  });

  root.addEventListener("dblclick", (e) => {
    const txt = e.target.closest(".txt[data-edit]");
    if (txt) startEdit(txt, txt.closest(".item").dataset.id);
  });

  root.addEventListener("submit", (e) => {
    const form = e.target.closest("[data-form]");
    if (!form) return;
    e.preventDefault();
    const id = form.closest(".item").dataset.id;
    if (form.dataset.form === "sub-add") {
      const input = form.querySelector("input");
      A.addSub(id, input.value);
      requestAnimationFrame(() => $(`.item[data-id="${id}"] .sub-add input`)?.focus());
    }
    if (form.dataset.form === "schedule") {
      const [time, minutes] = [form.querySelector("input").value, form.querySelector("select").value];
      ui.scheduling = null;
      A.scheduleTask(id, time, minutes);
    }
  });

  root.addEventListener("change", (e) => {
    const sel = e.target.closest('[data-change="repeat"]');
    if (sel) A.setRepeat(sel.closest(".item").dataset.id, sel.value);
  });

  bindDrag(root);
}
