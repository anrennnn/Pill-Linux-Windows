// Vista "Notas".

import * as A from "../actions.js";
import { esc, uid } from "../core.js";
import { ICONS } from "../icons.js";
import { commit, state } from "../store.js";
import { $, toast } from "../ui.js";

export function render() {
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

export function bind(root) {
  const saveNote = () => {
    const ta = $("#noteInput");
    const text = ta.value.trim();
    if (!text) return;
    state.notes.push({ id: uid(), text, createdAt: Date.now() });
    ta.value = "";
    commit();
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
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const id = btn.closest("[data-id]")?.dataset.id;
    const idx = state.notes.findIndex((x) => x.id === id);
    const n = state.notes[idx];
    if (!n) return;
    switch (btn.dataset.act) {
      case "note-delete":
        state.notes.splice(idx, 1);
        commit();
        return toast("Nota borrada", { label: "Deshacer", run: () => (state.notes.splice(idx, 0, n), commit()) });
      case "note-copy":
        return navigator.clipboard?.writeText(n.text).then(() => toast("Copiado"), () => toast("No se pudo copiar"));
      case "note-task":
        A.addTask(n.text.split("\n")[0].slice(0, 140), "inbox");
        return toast("Convertida en tarea");
    }
  });
}
