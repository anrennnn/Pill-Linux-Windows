// Estado de la aplicación: carga, guardado diferido y avisos de cambios.

import { invoke } from "./bridge.js";
import { DEFAULT_STATE, migrate } from "./core.js";

export let state = DEFAULT_STATE();

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);

let saveTimer = null;
/** Guarda (con un pequeño retraso) y repinta. */
export function commit({ render = true } = {}) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => invoke("save_state", { data: JSON.stringify(state) }), 250);
  if (render) listeners.forEach((fn) => fn());
}

export async function load() {
  try {
    const raw = await invoke("load_state");
    state = migrate(raw ? JSON.parse(raw) : null);
  } catch (e) {
    console.error("No se pudo leer el estado", e);
    state = DEFAULT_STATE();
  }
  return state;
}

/** Sustituye todo el estado (importar o restaurar una copia). */
export function replace(raw) {
  state = migrate(raw);
  commit();
}

export const S = () => state.settings;
export const F = () => state.focus;
