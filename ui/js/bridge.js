// Puente con Tauri. Fuera de Tauri (navegador) simula el backend para previsualizar.

const TAURI = window.__TAURI__;
export const PREVIEW = !TAURI;

const now = Date.now();
const MOCKS = {
  load_state: () => localStorage.getItem("focuspill") || null,
  save_state: ({ data }) => localStorage.setItem("focuspill", data),
  get_autostart: () => false,
  env_info: () => ({ os: "linux", session: "x11", desktop: "XFCE", dnd_supported: true, tracking_supported: true, system_shortcuts_supported: true, notifications_supported: true, edition: "community" }),
  set_notifications: () => null,
  list_monitors: () => [{ name: "eDP-1", x: 0, y: 0, width: 1920, height: 1080, scale: 1, primary: true }, { name: "HDMI-1", x: 1920, y: 0, width: 2560, height: 1440, scale: 1, primary: false }],
  list_backups: () => ["2026-10-26", "2026-10-25", "2026-10-24"],
  license_status: () => ({ edition: "community", pro: true }),
  ai_status: () => ({ distro: { name: "MiDistro AI", endpoint: "unix:///run/user/1000/midistro/ai.sock", model: "midistro-8b", source: "/etc/xdg/focuspill/ai-provider.json" } }),
  ai_models: () => ["midistro-8b", "llama3.2:3b", "qwen2.5:7b"],
  ai_chat: ({ messages }) => {
    const last = messages[messages.length - 1].content;
    if (last.includes('"bloques"')) {
      return JSON.stringify({
        resumen: "Dos bloques profundos antes de la reunión y uno corto por la tarde.",
        bloques: [
          { inicio: "09:30", minutos: 50, tarea_id: "a", titulo: "Auditoría SEO" },
          { inicio: "12:15", minutos: 45, tarea_id: "b", titulo: "Propuesta GHL" },
          { inicio: "16:00", minutos: 25, tarea_id: null, titulo: "Revisar Search Console" },
        ],
        consejo: "Deja el móvil en otra habitación durante el primer bloque.",
      });
    }
    if (last.includes('"patrones"')) {
      return JSON.stringify({ resumen: "Semana sólida: 425 minutos de foco, con los mejores días el miércoles y el domingo.", logros: ["Auditoría SEO terminada", "Racha de agua de 3 días"], patrones: "Rindes más por la mañana y en bloques de 50 minutos.", mejorar: "Las distracciones suben después de comer: pon el modo SEO a las 15:00.", prioridades: ["Responder propuesta de GHL", "Revisar Search Console"] });
    }
    if (last.includes('"logros"')) {
      return JSON.stringify({ resumen: "Buen día: cerraste la prioridad más difícil y mantuviste el foco por la mañana.", logros: ["Auditoría SEO terminada", "100 min de foco"], aprender: "Las distracciones subieron después de comer.", "mañana": ["Responder propuesta de GHL", "Grabar reel"] });
    }
    return "Empieza por la auditoría: es la que más impacto tiene y ya llevas medio camino.";
  },
  get_usage: () => {
    const d = new Date();
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { [key]: { code: 5400, firefox: 2700, "gnome-terminal-server": 1500, discord: 900, spotify: 600, telegram: 300 } };
  },
  media_state: () => ({
    player: "org.mpris.MediaPlayer2.spotify", name: "Spotify", pinned: false, status: "Playing",
    title: "Midnight City", artist: "M83", album: "Hurry Up, We're Dreaming", art: "demo-art",
    length: 244, position: 83, can_control: true, can_seek: true, track: "/demo/1",
    players: [{ id: "org.mpris.MediaPlayer2.spotify", name: "Spotify", status: "Playing" }, { id: "org.mpris.MediaPlayer2.vlc", name: "VLC", status: "Paused" }],
  }),
  media_art: () =>
    "data:image/svg+xml;base64," +
    btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5f9e"/><stop offset=".5" stop-color="#7b5cff"/><stop offset="1" stop-color="#1e2a78"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><circle cx="50" cy="58" r="22" fill="#ffd36e" opacity=".9"/><rect y="62" width="100" height="38" fill="#141432" opacity=".85"/></svg>'),
  list_apps: () => [{ id: "code.desktop", name: "Visual Studio Code" }, { id: "firefox.desktop", name: "Firefox" }, { id: "spotify.desktop", name: "Spotify" }, { id: "thunar.desktop", name: "Archivos" }],
  fetch_calendar: () => {
    const d = new Date(now);
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    return `BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:demo1\nSUMMARY:Reunión con cliente\nDTSTART:${ymd}T110000\nDTEND:${ymd}T120000\nEND:VEVENT\nBEGIN:VEVENT\nUID:demo2\nSUMMARY:Daily del equipo\nDTSTART:${ymd}T143000\nDTEND:${ymd}T144500\nEND:VEVENT\nEND:VCALENDAR`;
  },
};

export const invoke = PREVIEW
  ? async (cmd, args = {}) => {
      const mock = MOCKS[cmd];
      await new Promise((r) => setTimeout(r, cmd.startsWith("ai_") ? 250 : 0));
      return mock ? mock(args) : null;
    }
  : TAURI.core.invoke;

export const listen = PREVIEW ? async () => () => {} : TAURI.event.listen;

// Errores no capturados → terminal (en Tauri) para poder diagnosticarlos.
if (!PREVIEW) {
  const report = (level, msg) => TAURI.core.invoke("log_js", { level, message: String(msg).slice(0, 2000) }).catch(() => {});
  window.addEventListener("error", (e) => report("error", `${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => report("promise", e.reason?.stack || e.reason));
}
