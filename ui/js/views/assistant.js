// Vista "IA": planificar el día, cierre del día y preguntas libres.

import * as A from "../actions.js";
import { dayKey, esc } from "../core.js";
import { ICONS } from "../icons.js";
import { S, commit, state } from "../store.js";
import { $, busy, ui } from "../ui.js";

function connectCard() {
  const distro = ui.aiStatus?.distro;
  return `<div class="card intro">
      <div class="card-title">${ICONS.sparkle} Conecta una IA</div>
      <p>FocusPill no envía tus datos a ninguna nube: usa la IA de tu distro o un modelo local.</p>
      ${
        distro
          ? `<button class="btn primary small" data-act="use-distro">Usar ${esc(distro.name)}</button>
             <p class="hint">Detectada en <code>${esc(distro.source)}</code></p>`
          : `<button class="btn primary small" data-act="use-ollama">Usar Ollama local</button>
             <p class="hint">También funciona con LM Studio, llama.cpp, Jan o cualquier servidor compatible con OpenAI. Configúralo en Ajustes → IA.</p>`
      }
    </div>`;
}

function planCard() {
  const plan = state.ai.plan;
  if (busy("plan")) return `<div class="card"><div class="loading"><span class="spinner"></span>Pensando tu día…</div></div>`;
  const err = ui.errors.plan ? `<p class="error">${esc(ui.errors.plan)}</p>` : "";
  if (!plan || plan.day !== dayKey()) return err ? `<div class="card">${err}</div>` : "";
  const rows = plan.blocks
    .map((b) => {
      const t = A.findTask(b.taskId);
      return `<li><span class="ag-time">${b.start}</span><i class="ag-bar" style="background:var(--accent)"></i><span class="ag-title">${esc(t ? t.text : b.title)}</span><span class="ag-meta">${b.minutes} min</span></li>`;
    })
    .join("");
  return `<div class="card">
      <div class="card-title">${ICONS.calendar} Plan propuesto</div>
      ${plan.summary ? `<p>${esc(plan.summary)}</p>` : ""}
      <ul class="agenda">${rows}</ul>
      ${plan.tip ? `<p class="hint">💡 ${esc(plan.tip)}</p>` : ""}
      ${err}
      <div class="card-actions">
        ${plan.applied ? `<span class="ok-text">${ICONS.check} Añadido a tu agenda</span>` : `<button class="btn primary small" data-act="apply-plan">Añadir a mi agenda</button>`}
        <button class="btn ghost small" data-act="discard-plan">Descartar</button>
      </div>
    </div>`;
}

function closeCard() {
  const c = state.ai.close;
  if (busy("close")) return `<div class="card"><div class="loading"><span class="spinner"></span>Resumiendo tu día…</div></div>`;
  const err = ui.errors.close ? `<p class="error">${esc(ui.errors.close)}</p>` : "";
  if (!c || c.day !== dayKey()) return err ? `<div class="card">${err}</div>` : "";
  const list = (items) => `<ul class="bullets">${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  const notion = S().notion.token && S().notion.page;
  return `<div class="card">
      <div class="card-title">${ICONS.moon} Cierre del día</div>
      <p>${esc(c.summary)}</p>
      ${c.wins.length ? `<div class="mini-title">Logros</div>${list(c.wins)}` : ""}
      ${c.learn ? `<div class="mini-title">Para mejorar</div><p>${esc(c.learn)}</p>` : ""}
      ${c.tomorrow.length ? `<div class="mini-title">Mañana</div>${list(c.tomorrow)}` : ""}
      <div class="card-actions">
        <button class="btn ghost small" data-act="close-note">Guardar en Notas</button>
        ${notion ? `<button class="btn ghost small" data-act="close-notion" ${busy("notion") ? "disabled" : ""}>Enviar a Notion</button>` : ""}
      </div>
    </div>`;
}

function weeklyCard() {
  const w = state.ai.weekly;
  if (busy("weekly")) return `<div class="card"><div class="loading"><span class="spinner"></span>Revisando tu semana…</div></div>`;
  const err = ui.errors.weekly ? `<p class="error">${esc(ui.errors.weekly)}</p>` : "";
  if (!w) return err ? `<div class="card">${err}</div>` : "";
  const list = (items) => `<ul class="bullets">${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  const notion = S().notion.token && S().notion.page;
  return `<div class="card">
      <div class="card-title">${ICONS.calendar} Revisión semanal <span class="muted small">${esc(w.label)}</span></div>
      <p>${esc(w.summary)}</p>
      ${w.wins.length ? `<div class="mini-title">Logros</div>${list(w.wins)}` : ""}
      ${w.patterns ? `<div class="mini-title">Lo que funcionó</div><p>${esc(w.patterns)}</p>` : ""}
      ${w.improve ? `<div class="mini-title">Para mejorar</div><p>${esc(w.improve)}</p>` : ""}
      ${w.priorities.length ? `<div class="mini-title">Prioridades del lunes</div>${list(w.priorities)}` : ""}
      <div class="card-actions">
        ${w.priorities.length ? (w.scheduled ? `<span class="ok-text">${ICONS.check} Programadas para el lunes</span>` : `<button class="btn primary small" data-act="weekly-schedule">Programar para el lunes</button>`) : ""}
        <button class="btn ghost small" data-act="weekly-note">Guardar en Notas</button>
        ${notion ? `<button class="btn ghost small" data-act="weekly-notion" ${busy("notion") ? "disabled" : ""}>Enviar a Notion</button>` : ""}
      </div>
    </div>`;
}

function chat() {
  const bubbles = state.ai.chat
    .map((m) => `<div class="bubble ${m.role}">${esc(m.content)}</div>`)
    .join("");
  const thinking = busy("ask") ? `<div class="bubble assistant"><span class="spinner"></span></div>` : "";
  return bubbles || thinking ? `<div class="chat">${bubbles}${thinking}</div>` : "";
}

export function render() {
  const ready = A.aiReady();
  $("#aiConnect").innerHTML = ready ? "" : connectCard();
  $("#aiActions").hidden = !ready;
  $("#aiProviderLabel").textContent = ready ? providerLabel() : "";
  $("#aiPlan").innerHTML = ready ? planCard() : "";
  $("#aiClose").innerHTML = ready ? closeCard() : "";
  $("#aiWeekly").innerHTML = ready ? weeklyCard() : "";
  $("#weeklyBtn").disabled = busy("weekly");
  $("#aiChat").innerHTML = ready ? chat() : "";
  $("#askForm").hidden = !ready;
  $("#planBtn").disabled = busy("plan");
  $("#closeBtn").disabled = busy("close");
  const chatEl = $("#aiChat .chat");
  if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
}

function providerLabel() {
  const a = S().ai;
  if (a.provider === "distro") return `Conectado a ${ui.aiStatus?.distro?.name || "la IA de tu distro"}`;
  return `Conectado a ${a.model || "modelo local"} · ${a.endpoint.replace(/^https?:\/\//, "")}`;
}

export function bind(root) {
  $("#planBtn").addEventListener("click", A.planDay);
  $("#closeBtn").addEventListener("click", A.closeDay);
  $("#weeklyBtn").addEventListener("click", A.weeklyReview);
  $("#askForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#askInput");
    const q = input.value;
    input.value = "";
    A.askAI(q);
  });
  root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    switch (btn.dataset.act) {
      case "use-distro":
        S().ai.provider = "distro";
        return commit();
      case "use-ollama":
        Object.assign(S().ai, { provider: "custom", endpoint: "http://127.0.0.1:11434/v1", model: S().ai.model || "llama3.2" });
        return commit();
      case "apply-plan": return A.applyPlan();
      case "discard-plan":
        state.ai.plan = null;
        return commit();
      case "close-note": return A.saveCloseAsNote();
      case "close-notion": return A.sendCloseToNotion();
      case "weekly-schedule": return A.scheduleMondayPriorities();
      case "weekly-note": return A.saveWeeklyAsNote();
      case "weekly-notion": return A.sendWeeklyToNotion();
    }
  });
}
