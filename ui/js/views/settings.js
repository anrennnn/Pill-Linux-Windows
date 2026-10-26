// Vista "Ajustes". Se pinta entera desde aquí; los campos se guardan al cambiar.

import * as A from "../actions.js";
import { invoke } from "../bridge.js";
import { dayKey, esc, uid } from "../core.js";
import { ICONS } from "../icons.js";
import { S, commit, replace, state } from "../store.js";
import { $, busy, toast, track, ui } from "../ui.js";

const ACCENTS = ["#8492ff", "#5ab0ff", "#2dd4bf", "#4ade80", "#fbbf24", "#fb923c", "#f472b6", "#c084fc"];
const CAL_COLORS = ["#5ab0ff", "#f472b6", "#4ade80", "#fbbf24", "#c084fc", "#fb923c"];
const AI_PRESETS = [
  ["Ollama", "http://127.0.0.1:11434/v1"],
  ["LM Studio", "http://127.0.0.1:1234/v1"],
  ["llama.cpp", "http://127.0.0.1:8080/v1"],
  ["Jan", "http://127.0.0.1:1337/v1"],
];

const get = (path) => path.split(".").reduce((o, k) => o?.[k], S());
function set(path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  keys.reduce((o, k) => o[k], S())[last] = value;
}

const toggle = (path, label, hint = "") =>
  `<label class="toggle"><input type="checkbox" data-set="${path}" ${get(path) ? "checked" : ""} /><span>${label}${hint ? `<small>${hint}</small>` : ""}</span></label>`;

const num = (path, label, min, max) =>
  `<label>${label}<input type="number" min="${min}" max="${max}" data-set="${path}" value="${esc(get(path))}" /></label>`;

const text = (path, label, placeholder = "", type = "text") =>
  `<label class="field-line">${label}<input class="input" type="${type}" data-set="${path}" value="${esc(get(path))}" placeholder="${esc(placeholder)}" spellcheck="false" autocomplete="off" /></label>`;

function group(title, body, id = "") {
  return `<section class="set-group" ${id ? `id="${id}"` : ""}><div class="set-title">${title}</div>${body}</section>`;
}

function status(key, okText) {
  if (busy(key)) return `<span class="status-line"><span class="spinner"></span>Comprobando…</span>`;
  if (ui.errors[key]) return `<span class="status-line error">${esc(ui.errors[key])}</span>`;
  return okText ? `<span class="status-line ok">${okText}</span>` : "";
}

function aiSection() {
  const a = S().ai;
  const distro = ui.aiStatus?.distro;
  const seg = [
    ["none", "Ninguna"],
    ["distro", "Mi distro"],
    ["custom", "Local / servidor"],
  ]
    .map(([k, v]) => `<button data-act="ai-provider" data-value="${k}" class="${a.provider === k ? "active" : ""}">${v}</button>`)
    .join("");
  let body = `<div class="seg three">${seg}</div>`;
  if (a.provider === "distro") {
    body += distro
      ? `<div class="info-box">${ICONS.sparkle}<div><b>${esc(distro.name)}</b><br><code>${esc(distro.endpoint)}</code><br><small>Declarada en ${esc(distro.source)}</small></div></div>
         ${text("ai.model", "Modelo (opcional)", distro.model || "el que indique la distro")}`
      : `<div class="info-box warn">No se encontró <code>ai-provider.json</code>. Tu distro debe instalarlo en <code>/etc/xdg/focuspill/</code> (ver docs/DISTRO-AI.md).</div>`;
  }
  if (a.provider === "custom") {
    body += `<div class="presets left">${AI_PRESETS.map(([n, url]) => `<button data-act="ai-preset" data-value="${url}" class="${a.endpoint === url ? "active" : ""}">${n}</button>`).join("")}</div>
      ${text("ai.endpoint", "Dirección (compatible con OpenAI)", "http://127.0.0.1:11434/v1 o unix:///ruta.sock")}
      <label class="field-line">Modelo
        <div class="input-row">
          ${ui.aiModels.length
            ? `<select class="input" data-set="ai.model">${ui.aiModels.map((m) => `<option ${m === a.model ? "selected" : ""}>${esc(m)}</option>`).join("")}${ui.aiModels.includes(a.model) || !a.model ? "" : `<option selected>${esc(a.model)}</option>`}</select>`
            : `<input class="input" data-set="ai.model" value="${esc(a.model)}" placeholder="llama3.2, qwen2.5…" spellcheck="false" />`}
          <button class="btn ghost small" data-act="ai-models">Detectar</button>
        </div>
      </label>
      ${text("ai.apiKey", "Clave (si tu servidor la pide)", "", "password")}`;
  }
  if (a.provider !== "none") {
    body += `<div class="row-actions"><button class="btn ghost small" data-act="ai-test">Probar conexión</button>${status("aiTest", ui.aiTestOk)}</div>
      ${toggle("ai.classify", "Clasificar capturas con IA", "Decide si lo que capturas es tarea, nota o algo para hoy")}
      <label class="field-line inline">Mi jornada termina a las<input class="input time" type="time" data-set="ai.dayEnd" value="${esc(a.dayEnd)}" /></label>`;
  }
  return group("IA", body, "set-ai");
}

function calendarSection() {
  const cals = S().calendars;
  const rows = cals
    .map((c) => {
      const err = state.calendar.errors?.[c.id];
      return `<li class="cal-row" data-id="${c.id}"><i style="background:${c.color}"></i><div><b>${esc(c.name)}</b><small>${esc(c.url.replace(/^(https?|webcal):\/\//, "").slice(0, 46))}…</small>${err ? `<small class="error">${esc(err)}</small>` : ""}</div><button class="act" data-act="cal-del" title="Quitar">${ICONS.x}</button></li>`;
    })
    .join("");
  const updated = state.calendar.fetchedAt ? `Actualizado ${new Date(state.calendar.fetchedAt).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}` : "";
  return group(
    "Calendarios",
    `<p class="hint">Pega la dirección secreta en formato iCal de Google Calendar, Outlook, Nextcloud o Proton. Solo se lee.</p>
     <ul class="cals">${rows}</ul>
     <form class="cal-add" data-form="cal-add" autocomplete="off">
       <input class="input" name="name" placeholder="Nombre (Trabajo)" spellcheck="false" />
       <input class="input" name="url" placeholder="https://…/basic.ics" spellcheck="false" required />
       <button class="btn primary small">Añadir</button>
     </form>
     <div class="row-actions"><button class="btn ghost small" data-act="cal-sync" ${cals.length ? "" : "disabled"}>${ICONS.refresh} Actualizar</button><span class="status-line">${updated}</span></div>
     <div class="num-grid">${num("meetingReminderMin", "Avisar antes (min)", 0, 60)}</div>
     ${toggle("blockAutoFocus", "Empezar el foco al llegar un bloque programado")}`,
    "set-cal"
  );
}

function integrationsSection() {
  return group(
    "Integraciones",
    `${text("todoist.token", "Token de Todoist", "Configuración → Integraciones → Desarrollador", "password")}
     <div class="row-actions"><button class="btn ghost small" data-act="todoist-import" ${S().todoist.token ? "" : "disabled"}>Importar tareas de hoy</button>${status("todoist")}</div>
     ${text("notion.token", "Token de integración de Notion", "secret_… o ntn_…", "password")}
     ${text("notion.page", "Página de Notion para el diario", "https://www.notion.so/…")}
     <p class="hint">Comparte la página con tu integración de Notion para que FocusPill pueda escribir el cierre del día.</p>`
  );
}

function screenSection() {
  const mons = ui.monitors;
  const env = ui.env || {};
  const monitorSelect = mons.length > 1
    ? `<label class="field-line">Monitor de la píldora<select class="input" data-act-change="monitor"><option value="">Principal</option>${mons.map((m) => `<option value="${esc(m.name)}" ${S().monitor === m.name ? "selected" : ""}>${esc(m.name)} · ${m.width}×${m.height}${m.primary ? " (principal)" : ""}</option>`).join("")}</select></label>`
    : "";
  const shortcuts = env.system_shortcuts_supported
    ? `<div class="row-actions"><button class="btn ghost small" data-act="sys-shortcuts">Crear atajos en ${esc(env.desktop || "el escritorio")}</button>${status("shortcuts", S().systemShortcuts ? "Atajos del sistema activos" : "")}</div>
       <p class="hint">Recomendado en Wayland: así los atajos funcionan aunque la ventana activa no sea X11.</p>`
    : `<p class="hint">${env.session === "wayland" ? "En Wayland, si los atajos no responden, " : "Si algún atajo choca con otro programa, "}crea uno en tu escritorio con <code>focuspill --capture</code>, <code>--toggle-focus</code> o <code>--toggle-panel</code>.</p>`;
  return group(
    "Pantalla y atajos",
    `${monitorSelect}
     <div class="row-actions"><button class="btn ghost small" data-act="reset-pos">Volver arriba al centro</button></div>
     <dl class="keys">
       <dt><kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>Espacio</kbd></dt><dd>Captura rápida</dd>
       <dt><kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>F</kbd></dt><dd>Iniciar / pausar foco</dd>
       <dt><kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>P</kbd></dt><dd>Abrir / plegar panel</dd>
     </dl>
     ${shortcuts}`
  );
}

function dataSection() {
  const backups = ui.backups.slice(0, 7);
  return group(
    "Datos",
    `<p class="hint">Todo se guarda en tu equipo. Se hace una copia automática cada día (se conservan 14).</p>
     <div class="row-actions">
       <button class="btn ghost small" data-act="export">Exportar…</button>
       <button class="btn ghost small" data-act="import">Importar…</button>
     </div>
     ${backups.length ? `<div class="mini-title">Copias automáticas</div><div class="presets left">${backups.map((d) => `<button data-act="restore" data-value="${d}">${d === dayKey() ? "Hoy" : d}</button>`).join("")}</div>` : ""}
     ${toggle("tracking", "Registrar la app en primer plano", "Solo el nombre de la app, nunca títulos ni contenido")}
     <div class="row-actions"><button class="btn ghost small" data-act="clear-usage">Borrar historial de apps</button></div>`
  );
}

function aboutSection() {
  const lic = ui.license;
  const store = lic?.edition === "store";
  const licBody = store
    ? lic.pro
      ? `<p class="ok-text">${ICONS.check} Licencia Pro activa ${esc(lic.key || "")}</p>`
      : `<form class="input-row" data-form="license" autocomplete="off"><input class="input" placeholder="Clave de licencia" spellcheck="false" /><button class="btn primary small">Activar</button></form>${status("license")}`
    : `<p class="hint">Edición comunidad: todas las funciones desbloqueadas.</p>`;
  const upd = ui.update
    ? `<button class="btn primary small" data-act="install-update" ${busy("install") ? "disabled" : ""}>Instalar ${esc(ui.update.version)}</button>`
    : `<button class="btn ghost small" data-act="check-update">Buscar actualizaciones</button>`;
  return group(
    "FocusPill",
    `${licBody}
     <div class="row-actions">${upd}${status("update", ui.updateChecked && !ui.update ? "Tienes la última versión" : "")}${status("install")}</div>
     <div class="set-actions">
       <button class="btn ghost small" data-act="hide">Ocultar píldora</button>
       <button class="btn danger small" data-act="quit">Salir</button>
     </div>`
  );
}

export function render() {
  const box = $("#settingsBox");
  // No repintamos mientras se escribe en un campo.
  if (box.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.type !== "checkbox") return;
  const s = S();
  const env = ui.env || {};
  box.innerHTML = [
    group(
      "Apariencia",
      `<div class="seg three">${[["dark", "Oscuro"], ["light", "Claro"], ["system", "Sistema"]].map(([k, v]) => `<button data-act="theme" data-value="${k}" class="${s.theme === k ? "active" : ""}">${v}</button>`).join("")}</div>
       <div class="swatches">${ACCENTS.map((c) => `<button data-act="accent" data-value="${c}" style="background:${c}" class="${c === s.accent ? "active" : ""}" aria-label="Color ${c}"></button>`).join("")}</div>`
    ),
    group(
      "Pomodoro",
      `<div class="num-grid">${num("focusMin", "Foco (min)", 1, 180)}${num("breakMin", "Descanso", 1, 60)}${num("longBreakMin", "Descanso largo", 1, 90)}${num("longEvery", "Largo cada", 2, 12)}${num("dailyGoalMin", "Meta diaria (min)", 10, 720)}${num("distractionSeconds", "Aviso distracción (s)", 10, 600)}</div>`
    ),
    group(
      "Comportamiento",
      `${toggle("autoBreak", "Empezar descansos automáticamente")}
       ${toggle("autoFocus", "Empezar foco tras el descanso")}
       ${toggle("sound", "Sonido al terminar")}
       ${toggle("collapseOnBlur", "Plegar al hacer clic fuera")}
       ${env.dnd_supported ? toggle("dnd", "«No molestar» durante el foco", "Silencia las notificaciones del escritorio") : ""}
       ${toggle("distractionAlerts", "Avisar si me distraigo durante el foco")}
       <label class="toggle"><input type="checkbox" id="autostart" ${ui.autostart ? "checked" : ""} /><span>Abrir al iniciar sesión</span></label>`
    ),
    aiSection(),
    calendarSection(),
    integrationsSection(),
    screenSection(),
    dataSection(),
    aboutSection(),
  ].join("");
}

/* ---------------- Eventos ---------------- */

async function testAI(rerender) {
  ui.aiTestOk = "";
  const result = await track("aiTest", async () => {
    try {
      const models = await invoke("ai_models", { config: A.aiConfig() });
      ui.aiModels = models || [];
      return models?.length ? `Conectado · ${models.length} modelos` : "Conectado";
    } catch (_) {
      // Algunos servicios no exponen /models: probamos un mensaje corto.
      const reply = await invoke("ai_chat", { config: A.aiConfig(), messages: [{ role: "user", content: "Responde solo: OK" }], json: false });
      return `Conectado · respondió «${String(reply).slice(0, 20)}»`;
    }
  }, rerender);
  if (result) ui.aiTestOk = result;
  rerender();
}

export function bind(root, { rerender, applyTheme, collapse }) {
  root.addEventListener("change", async (e) => {
    const el = e.target;
    if (el.dataset.set) {
      let value = el.type === "checkbox" ? el.checked : el.value;
      if (el.type === "number") {
        value = Math.min(Number(el.max), Math.max(Number(el.min), Math.round(Number(el.value) || Number(el.min))));
        el.value = value;
      }
      set(el.dataset.set, value);
      if (el.dataset.set === "tracking") invoke("set_tracking", { enabled: value });
      if (el.dataset.set === "todoist.token" || el.dataset.set.startsWith("ai.")) ui.errors.aiTest = null;
      commit({ render: el.type === "checkbox" || el.tagName === "SELECT" });
      return;
    }
    if (el.dataset.actChange === "monitor") {
      S().monitor = el.value;
      commit();
      return invoke("set_monitor", { name: el.value || null });
    }
    if (el.id === "autostart") {
      try {
        await invoke("set_autostart", { enabled: el.checked });
        ui.autostart = el.checked;
        toast(el.checked ? "Se abrirá al iniciar sesión" : "Inicio automático desactivado");
      } catch (_) {
        el.checked = !el.checked;
        toast("No se pudo cambiar el inicio automático");
      }
    }
  });

  root.addEventListener("submit", async (e) => {
    const form = e.target.closest("[data-form]");
    if (!form) return;
    e.preventDefault();
    if (form.dataset.form === "cal-add") {
      const name = form.elements.name.value.trim() || "Calendario";
      const url = form.elements.url.value.trim();
      if (!url) return;
      S().calendars.push({ id: uid(), name, url, color: CAL_COLORS[S().calendars.length % CAL_COLORS.length] });
      commit();
      A.syncCalendars();
    }
    if (form.dataset.form === "license") {
      const key = form.querySelector("input").value;
      const ok = await track("license", () => invoke("license_activate", { key }), rerender);
      if (ok !== null) {
        ui.license = await invoke("license_status");
        toast("Licencia activada ✓");
        rerender();
      }
    }
  });

  root.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const v = btn.dataset.value;
    switch (btn.dataset.act) {
      case "theme":
        S().theme = v;
        applyTheme();
        return commit();
      case "accent":
        S().accent = v;
        applyTheme();
        return commit();
      case "ai-provider":
        S().ai.provider = v;
        ui.aiModels = [];
        ui.aiTestOk = "";
        ui.errors.aiTest = null;
        if (v === "custom" && !S().ai.endpoint) S().ai.endpoint = AI_PRESETS[0][1];
        return commit();
      case "ai-preset":
        S().ai.endpoint = v;
        ui.aiModels = [];
        return commit();
      case "ai-models":
      case "ai-test":
        return testAI(rerender);
      case "cal-del": {
        const id = btn.closest("[data-id]").dataset.id;
        S().calendars = S().calendars.filter((c) => c.id !== id);
        commit();
        return A.syncCalendars();
      }
      case "cal-sync":
        await A.syncCalendars();
        return toast("Calendarios actualizados");
      case "todoist-import":
        return A.importTodoist();
      case "reset-pos":
        await collapse();
        return setTimeout(() => invoke("reset_position"), 380);
      case "sys-shortcuts": {
        const msg = await track("shortcuts", () => invoke("setup_system_shortcuts"), rerender);
        if (msg) {
          S().systemShortcuts = true;
          commit();
          toast(msg);
        }
        return;
      }
      case "export": {
        const path = await invoke("export_data", { data: JSON.stringify(state, null, 2), suggested: `focuspill-${dayKey()}.json` }).catch((err) => toast(String(err)));
        if (path) toast("Copia exportada");
        return;
      }
      case "import": {
        const raw = await invoke("import_data").catch((err) => toast(String(err)));
        if (!raw) return;
        replace(JSON.parse(raw));
        applyTheme();
        return toast("Datos importados");
      }
      case "restore": {
        const raw = await invoke("read_backup", { day: v }).catch((err) => toast(String(err)));
        if (!raw) return;
        const before = JSON.stringify(state);
        replace(JSON.parse(raw));
        applyTheme();
        return toast(`Restaurada la copia del ${v}`, { label: "Deshacer", run: () => (replace(JSON.parse(before)), applyTheme()) });
      }
      case "clear-usage":
        await invoke("clear_usage");
        ui.usage = {};
        return toast("Historial de apps borrado");
      case "check-update": {
        ui.updateChecked = false;
        const u = await track("update", () => invoke("check_update"), rerender);
        ui.update = u || null;
        ui.updateChecked = true;
        return rerender();
      }
      case "install-update":
        return track("install", () => invoke("install_update"), rerender);
      case "hide":
        await collapse();
        return setTimeout(() => invoke("hide_pill"), 380);
      case "quit":
        return invoke("quit");
    }
  });
}
