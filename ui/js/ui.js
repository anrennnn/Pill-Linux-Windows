// Estado efímero de la interfaz y avisos (toast en el panel, destello en la píldora).

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

export const ui = {
  mode: "pill",
  flash: null,
  busy: {},
  errors: {},
  env: null,
  aiStatus: null,
  aiModels: [],
  monitors: [],
  backups: [],
  usage: {},
  update: null,
  license: null,
  activeApp: null,
  expanded: new Set(),
  scheduling: null,
  statsRange: "today",
};

let toastTimer = null;

/** Aviso breve. En modo píldora se muestra en la propia píldora. */
export function toast(text, action) {
  if (ui.mode !== "panel") {
    flash(text);
    return;
  }
  const el = $("#toast");
  el.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = text;
  el.append(span);
  if (action) {
    const btn = document.createElement("button");
    btn.textContent = action.label;
    btn.onclick = () => {
      action.run();
      el.classList.remove("on");
    };
    el.append(btn);
  }
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("on"), action ? 4500 : 2000);
}

export function flash(text, ms = 1800, kind = "ok") {
  ui.flash = { text, until: Date.now() + ms, kind };
}

export const busy = (key) => !!ui.busy[key];

/** Ejecuta una tarea asíncrona marcando su estado de carga y error. */
export async function track(key, fn, rerender) {
  ui.busy[key] = true;
  ui.errors[key] = null;
  rerender?.();
  try {
    return await fn();
  } catch (e) {
    ui.errors[key] = String(e?.message || e);
    return null;
  } finally {
    ui.busy[key] = false;
    rerender?.();
  }
}
