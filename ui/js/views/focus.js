// Vista "Foco": anillo, tarea, controles, presets, ambiente y "no molestar".

import * as A from "../actions.js";
import { esc, fmt, phaseMs } from "../core.js";
import { AMBIENTS, playAmbient, setAmbientVolume, stopAmbient } from "../sounds.js";
import { F, S, commit } from "../store.js";
import { $, $$, ui } from "../ui.js";

const C = 2 * Math.PI * 86;

export function renderClock() {
  const f = F();
  const rem = A.remaining();
  const total = f.phase === "idle" ? phaseMs(S(), "focus") : phaseMs(S(), f.phase);
  const progress = f.phase === "idle" ? 0 : 1 - rem / total;
  const ring = $("#ringFill");
  ring.style.strokeDasharray = String(C);
  ring.style.strokeDashoffset = String(C * (1 - progress));
  ring.classList.toggle("break", f.phase === "break" || f.phase === "long");
  $("#ringTime").textContent = fmt(rem);
  $("#ringPhase").textContent =
    f.phase === "focus" ? (f.running ? "Enfocado" : "En pausa") : f.phase === "break" ? "Descanso" : f.phase === "long" ? "Descanso largo" : "Listo";
  const every = Math.max(2, S().longEvery);
  const doneInSet = f.cycle % every;
  $("#ringCycle").innerHTML = Array.from({ length: every }, (_, i) => `<i class="${i < doneInSet ? "on" : ""}"></i>`).join("");
  $("#startBtn").textContent = f.running ? "Pausar" : f.phase === "idle" ? "Empezar" : "Reanudar";
}

export function render() {
  renderClock();
  const sel = $("#focusTask");
  const opts = [...A.todayTasks(), ...A.inboxTasks()];
  const cur = A.currentTask()?.id || "";
  sel.innerHTML =
    `<option value="">Sin tarea concreta</option>` +
    opts.map((t) => `<option value="${t.id}" ${t.id === cur ? "selected" : ""}>${t.list === "today" ? "★ " : ""}${esc(t.text)}</option>`).join("");
  $$("#presets button").forEach((b) => {
    const [fm, bm] = b.dataset.preset.split(",").map(Number);
    b.classList.toggle("active", fm === Number(S().focusMin) && bm === Number(S().breakMin));
  });

  const amb = S().ambient;
  $("#ambient").innerHTML = [["none", "Silencio"], ...Object.entries(AMBIENTS)]
    .map(([k, v]) => `<button data-ambient="${k}" class="${amb.sound === k ? "active" : ""}">${v}</button>`)
    .join("");
  $("#ambientVol").value = amb.volume;
  $("#ambientWithFocus").checked = amb.withFocus;
  $("#dndToggle").checked = S().dnd;
  $("#dndRow").hidden = !ui.env?.dnd_supported;
  $("#distractToggle").checked = S().distractionAlerts;
}

export function bind() {
  $("#startBtn").addEventListener("click", () => {
    const sel = $("#focusTask").value || null;
    if (F().phase === "idle") A.startFocus(sel);
    else A.toggleFocus();
  });
  $("#resetBtn").addEventListener("click", A.resetFocus);
  $("#skipBtn").addEventListener("click", () => F().phase !== "idle" && A.completePhase({ natural: false }));
  $("#focusTask").addEventListener("change", (e) => {
    F().taskId = e.target.value || null;
    commit();
  });
  $("#presets").addEventListener("click", (e) => {
    const b = e.target.closest("[data-preset]");
    if (!b) return;
    const [fm, bm] = b.dataset.preset.split(",").map(Number);
    Object.assign(S(), { focusMin: fm, breakMin: bm, longBreakMin: Math.max(bm * 3, 15) });
    if (F().phase !== "idle" && !F().running) F().remaining = phaseMs(S(), F().phase);
    commit();
  });

  $("#ambient").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ambient]");
    if (!b) return;
    const amb = S().ambient;
    amb.sound = b.dataset.ambient;
    // Previsualizamos el sonido; si va ligado al foco se detiene al salir del foco.
    if (amb.sound === "none") stopAmbient();
    else if (!amb.withFocus || (F().phase === "focus" && F().running)) playAmbient(amb.sound, amb.volume);
    else {
      playAmbient(amb.sound, amb.volume);
      setTimeout(() => !(F().phase === "focus" && F().running) && stopAmbient(), 4000);
    }
    commit();
  });
  $("#ambientVol").addEventListener("input", (e) => {
    S().ambient.volume = Number(e.target.value);
    setAmbientVolume(S().ambient.volume);
    commit({ render: false });
  });
  $("#ambientWithFocus").addEventListener("change", (e) => {
    S().ambient.withFocus = e.target.checked;
    commit();
  });
  $("#dndToggle").addEventListener("change", (e) => {
    S().dnd = e.target.checked;
    commit();
  });
  $("#distractToggle").addEventListener("change", (e) => {
    S().distractionAlerts = e.target.checked;
    commit();
  });
}
