// Lógica pura de FocusPill: sin DOM ni Tauri, para poder probarla con `node --test`.

export const MAX_TODAY = 3;

/* ============================================================
   Utilidades
   ============================================================ */
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const pad = (n) => String(n).padStart(2, "0");

export function dayKey(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDay(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const d = parseDay(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

export function hhmm(t) {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "HH:MM" del día `key` → milisegundos locales. */
export function atTime(key, time) {
  const [h, m] = time.split(":").map(Number);
  const d = parseDay(key);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

export function fmt(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function fmtDuration(secs) {
  const m = Math.round(secs / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${pad(m % 60)} min`;
}

export function moveItem(list, from, to) {
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(Math.max(0, Math.min(to, copy.length)), 0, item);
  return copy;
}

/* ============================================================
   Ajustes y migración
   ============================================================ */
export const DEFAULT_SETTINGS = {
  theme: "dark",
  accent: "#8492ff",
  focusMin: 25,
  breakMin: 5,
  longBreakMin: 15,
  longEvery: 4,
  dailyGoalMin: 120,
  autoBreak: true,
  autoFocus: false,
  sound: true,
  collapseOnBlur: true,
  dnd: false,
  tracking: true,
  distractionAlerts: true,
  distractionSeconds: 45,
  apps: {},
  monitor: "",
  systemShortcuts: false,
  blockAutoFocus: true,
  meetingReminderMin: 5,
  ambient: { sound: "none", volume: 0.35, withFocus: true },
  ai: { provider: "none", endpoint: "", model: "", apiKey: "", classify: false, dayEnd: "19:00" },
  todoist: { token: "" },
  notion: { token: "", page: "" },
  calendars: [],
  media: { show: true, peek: true, hover: true },
  habitHours: { start: "09:00", end: "21:00" },
  weeklyReview: { enabled: true, day: 5, time: "17:00" },
  modes: [],
  notifications: { enabled: false, show: true, holdInFocus: true, keepHours: 48 },
  tools: { rightClick: "tools", items: ["capture", "focus", "media", "next", "habit", "note", "plan", "panel"] },
  startup: { asked: false },
};

export const DEFAULT_HABITS = () => [
  { id: "agua", name: "Agua", emoji: "💧", target: 8, remindEvery: 60, counts: {}, createdAt: Date.now() },
];

export const DEFAULT_STATE = () => ({
  v: 4,
  tasks: [],
  habits: DEFAULT_HABITS(),
  activeMode: null,
  notifs: { items: [], rules: {} },
  notes: [],
  sessions: [],
  blocks: [],
  focus: { phase: "idle", running: false, endAt: null, remaining: null, taskId: null, cycle: 0, cycleDay: null },
  calendar: { events: [], fetchedAt: 0, errors: {}, notified: {} },
  ai: { plan: null, close: null, weekly: null, chat: [], weeklyNotified: null },
  settings: structuredClone(DEFAULT_SETTINGS),
  ui: { tab: "today", open: {} },
});

/** Combina un estado guardado (v1 o v2) con los valores por defecto. */
export function migrate(raw) {
  const base = DEFAULT_STATE();
  if (!raw || typeof raw !== "object") return base;
  const s = { ...base, ...raw };
  s.v = 4;
  s.settings = { ...base.settings, ...(raw.settings || {}) };
  for (const k of ["ambient", "ai", "todoist", "notion", "media", "habitHours", "weeklyReview", "notifications", "tools", "startup"]) s.settings[k] = { ...base.settings[k], ...(raw.settings?.[k] || {}) };
  s.focus = { ...base.focus, ...(raw.focus || {}) };
  s.calendar = { ...base.calendar, ...(raw.calendar || {}) };
  s.ai = { ...base.ai, ...(raw.ai || {}) };
  s.ui = { ...base.ui, ...(raw.ui || {}) };
  s.tasks = (raw.tasks || []).map((t, i) => ({ sub: [], repeat: null, dueDay: null, order: i, ...t }));
  for (const key of ["notes", "sessions", "blocks"]) s[key] = Array.isArray(raw[key]) ? raw[key] : [];
  // Quien viene de la v0.2 recibe el hábito de agua; si ya los borró, se respeta.
  s.habits = Array.isArray(raw.habits) ? raw.habits.map((h) => ({ counts: {}, remindEvery: 0, target: 1, ...h })) : DEFAULT_HABITS();
  if (!Array.isArray(s.settings.modes)) s.settings.modes = [];
  s.notifs = { items: Array.isArray(raw.notifs?.items) ? raw.notifs.items : [], rules: { ...(raw.notifs?.rules || {}) } };
  return s;
}

/* ============================================================
   Captura rápida
   ============================================================ */
export function parseCapture(raw) {
  const text = raw.trim();
  if (/^(n:|nota:|#)\s*/i.test(text)) return { dest: "note", text: text.replace(/^(n:|nota:|#)\s*/i, "") };
  if (/^!\s*/.test(text)) return { dest: "today", text: text.replace(/^!\s*/, "") };
  return { dest: "inbox", text };
}

/* ============================================================
   Tareas: orden, recurrencia y cambio de día
   ============================================================ */
export const REPEATS = { daily: "Cada día", weekdays: "Laborables", weekly: "Cada semana", monthly: "Cada mes" };

export function sortTasks(tasks) {
  return [...tasks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt);
}

export function nextDueDay(repeat, fromKey) {
  const d = parseDay(fromKey);
  switch (repeat) {
    case "daily":
      d.setDate(d.getDate() + 1);
      break;
    case "weekdays":
      do d.setDate(d.getDate() + 1);
      while (d.getDay() === 0 || d.getDay() === 6);
      break;
    case "weekly":
      d.setDate(d.getDate() + 7);
      break;
    case "monthly": {
      const day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + 1);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, last));
      break;
    }
    default:
      return null;
  }
  return dayKey(d);
}

/** Marca una tarea como hecha y, si se repite, programa la siguiente. */
export function completeTask(tasks, id, now = Date.now(), newId = uid) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return null;
  t.done = true;
  t.doneAt = now;
  let next = null;
  if (t.repeat) {
    next = {
      ...t,
      id: newId(),
      done: false,
      doneAt: null,
      createdAt: now,
      list: "scheduled",
      homeList: t.list === "scheduled" ? t.homeList || "today" : t.list,
      dueDay: nextDueDay(t.repeat, dayKey(now)),
      sub: (t.sub || []).map((s) => ({ ...s, done: false })),
      todoistId: undefined,
    };
    tasks.push(next);
  }
  return next;
}

/** Al empezar el día, las tareas programadas vuelven a su lista. */
export function rollover(tasks, today, max = MAX_TODAY) {
  let moved = 0;
  const openToday = () => tasks.filter((t) => t.list === "today" && !t.done).length;
  for (const t of sortTasks(tasks)) {
    if (t.list !== "scheduled" || t.done || !t.dueDay || t.dueDay > today) continue;
    t.list = (t.homeList || "today") === "today" && openToday() < max ? "today" : "inbox";
    moved++;
  }
  return moved;
}

/* ============================================================
   Pomodoro
   ============================================================ */
export function phaseMs(settings, phase) {
  const min = phase === "focus" ? settings.focusMin : phase === "long" ? settings.longBreakMin : settings.breakMin;
  return Math.max(1, Number(min) || 1) * 60000;
}

export function remainingMs(focus, settings, now = Date.now()) {
  if (focus.phase === "idle") return phaseMs(settings, "focus");
  if (focus.running && focus.endAt) return Math.max(0, focus.endAt - now);
  return focus.remaining ?? phaseMs(settings, focus.phase);
}

export function breakAfter(cycle, longEvery) {
  return cycle % Math.max(2, longEvery) === 0 ? "long" : "break";
}

/* ============================================================
   Estadísticas
   ============================================================ */
export const minutesOn = (sessions, day) => sessions.filter((s) => dayKey(s.start) === day).reduce((a, s) => a + s.minutes, 0);

export function streak(sessions, today = dayKey()) {
  const days = new Set(sessions.filter((s) => s.minutes > 0).map((s) => dayKey(s.start)));
  let key = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(key)) {
    n++;
    key = addDays(key, -1);
  }
  return n;
}

export function lastDays(n, today = dayKey()) {
  return Array.from({ length: n }, (_, i) => addDays(today, i - (n - 1)));
}

/* ============================================================
   Aplicaciones: productivas, neutras o distracciones
   ============================================================ */
const DEFAULT_CATEGORIES = {
  productive: ["code", "code-oss", "vscodium", "cursor", "zed", "jetbrains", "idea", "pycharm", "webstorm", "goland", "android-studio",
    "gnome-terminal", "gnome-terminal-server", "konsole", "kitty", "alacritty", "wezterm", "tilix", "xfce4-terminal", "terminator", "windowsterminal",
    "libreoffice", "soffice", "obsidian", "logseq", "notion", "figma", "inkscape", "gimp", "krita", "blender", "kdenlive", "darktable",
    "thunderbird", "evolution", "zotero", "anki", "focuspill", "winword", "excel", "powerpnt", "onenote", "devenv"],
  distraction: ["discord", "telegram", "telegram-desktop", "whatsapp", "steam", "steamwebhelper", "lutris", "heroic", "spotify",
    "tiktok", "netflix", "slack-huddle", "minecraft-launcher", "epicgameslauncher", "battle.net"],
};

export function categorize(app, overrides = {}) {
  if (!app) return "neutral";
  const a = app.toLowerCase();
  if (overrides[a]) return overrides[a];
  for (const [cat, list] of Object.entries(DEFAULT_CATEGORIES)) {
    if (list.some((name) => a === name || a.startsWith(name + "-") || a.includes(name))) return cat;
  }
  return "neutral";
}

export function usageSummary(dayUsage = {}, overrides = {}) {
  const apps = Object.entries(dayUsage)
    .map(([app, secs]) => ({ app, secs, cat: categorize(app, overrides) }))
    .sort((a, b) => b.secs - a.secs);
  const total = (cat) => apps.filter((x) => x.cat === cat).reduce((s, x) => s + x.secs, 0);
  return { apps, productive: total("productive"), distraction: total("distraction"), neutral: total("neutral") };
}

/* ============================================================
   JSON en respuestas de IA
   ============================================================ */
/** Los modelos locales a veces envuelven el JSON en texto o en ```json. */
export function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const start = c.indexOf("{");
    const end = c.lastIndexOf("}");
    if (start === -1 || end <= start) continue;
    try {
      return JSON.parse(c.slice(start, end + 1));
    } catch (_) {
      /* probamos el siguiente */
    }
  }
  return null;
}

/* ============================================================
   Calendarios ICS
   ============================================================ */
const WINDOWS_ZONES = {
  "Romance Standard Time": "Europe/Paris",
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Budapest",
  "GMT Standard Time": "Europe/London",
  "UTC": "UTC",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "Pacific Standard Time": "America/Los_Angeles",
  "Central Standard Time (Mexico)": "America/Mexico_City",
  "SA Pacific Standard Time": "America/Bogota",
  "Venezuela Standard Time": "America/Caracas",
  "Pacific SA Standard Time": "America/Santiago",
  "Argentina Standard Time": "America/Argentina/Buenos_Aires",
  "E. South America Standard Time": "America/Sao_Paulo",
  "Central America Standard Time": "America/Guatemala",
  "SA Western Standard Time": "America/La_Paz",
  "Tokyo Standard Time": "Asia/Tokyo",
  "India Standard Time": "Asia/Kolkata",
};

const formatters = new Map();
function zoneFormatter(tz) {
  if (!formatters.has(tz)) {
    formatters.set(
      tz,
      new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    );
  }
  return formatters.get(tz);
}

function tzOffset(ms, tz) {
  const parts = Object.fromEntries(zoneFormatter(tz).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

export function resolveZone(tzid) {
  if (!tzid) return "local";
  const clean = tzid.replace(/^"|"$/g, "").replace(/^\/[^/]+\/[^/]+\//, "");
  const zone = WINDOWS_ZONES[clean] || clean;
  try {
    zoneFormatter(zone);
    return zone;
  } catch (_) {
    return "local";
  }
}

/** Hora de pared en una zona → instante UTC (ms). */
export function wallToMs({ y, m, d, h = 0, mi = 0, s = 0 }, tz) {
  if (tz === "utc") return Date.UTC(y, m - 1, d, h, mi, s);
  if (!tz || tz === "local") return new Date(y, m - 1, d, h, mi, s).getTime();
  const guess = Date.UTC(y, m - 1, d, h, mi, s);
  const first = tzOffset(guess, tz);
  let t = guess - first;
  const second = tzOffset(t, tz);
  if (second !== first) t = guess - second;
  return t;
}

function unescapeText(v) {
  return v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

function splitProp(line) {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    if (c === ":" && !inQuote) {
      const [name, ...params] = line.slice(0, i).split(";");
      const p = {};
      for (const kv of params) {
        const [k, ...rest] = kv.split("=");
        p[k.toUpperCase()] = rest.join("=");
      }
      return { name: name.toUpperCase(), params: p, value: line.slice(i + 1) };
    }
  }
  return null;
}

/** "20261026T090000" (+ zona) → { wall, tz, allDay } */
export function parseIcsDate(value, params = {}) {
  const v = value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const wall = { y: +m[1], m: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0) };
  const allDay = params.VALUE === "DATE" || !m[4];
  const tz = allDay ? "local" : m[7] ? "utc" : resolveZone(params.TZID);
  return { wall, tz, allDay };
}

function parseDuration(v) {
  const m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const [, sign, w, d, h, mi, s] = m;
  const ms = ((+w || 0) * 7 * 86400 + (+d || 0) * 86400 + (+h || 0) * 3600 + (+mi || 0) * 60 + (+s || 0)) * 1000;
  return sign === "-" ? -ms : ms;
}

function parseRrule(v) {
  const r = {};
  for (const part of v.split(";")) {
    const [k, val] = part.split("=");
    r[k.toUpperCase()] = val;
  }
  return r;
}

export function parseIcs(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const events = [];
  let cur = null;
  let depth = 0;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = { exdates: [] };
      depth = 0;
      continue;
    }
    if (!cur) continue;
    if (line.startsWith("BEGIN:")) depth++;
    else if (line.startsWith("END:") && line !== "END:VEVENT") depth--;
    if (line === "END:VEVENT") {
      if (cur.start && cur.status !== "CANCELLED") events.push(cur);
      cur = null;
      continue;
    }
    if (depth > 0) continue; // VALARM y similares
    const p = splitProp(line);
    if (!p) continue;
    switch (p.name) {
      case "UID": cur.uid = p.value; break;
      case "SUMMARY": cur.title = unescapeText(p.value); break;
      case "LOCATION": cur.location = unescapeText(p.value); break;
      case "STATUS": cur.status = p.value.toUpperCase(); break;
      case "DTSTART": cur.start = parseIcsDate(p.value, p.params); break;
      case "DTEND": cur.end = parseIcsDate(p.value, p.params); break;
      case "DURATION": cur.duration = parseDuration(p.value); break;
      case "RRULE": cur.rrule = parseRrule(p.value); break;
      case "RECURRENCE-ID": cur.recurrenceId = parseIcsDate(p.value, p.params); break;
      case "EXDATE":
        for (const v of p.value.split(",")) {
          const d = parseIcsDate(v, p.params);
          if (d) cur.exdates.push(d);
        }
        break;
    }
  }
  return events;
}

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function civil(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), dow: t.getUTCDay() };
}

function nthWeekday(y, m, dow, n) {
  if (n > 0) {
    const first = civil(y, m, 1).dow;
    const d = 1 + ((dow - first + 7) % 7) + (n - 1) * 7;
    return d <= new Date(Date.UTC(y, m, 0)).getUTCDate() ? d : null;
  }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lastDow = civil(y, m, lastDay).dow;
  const d = lastDay - ((lastDow - dow + 7) % 7) + (n + 1) * 7;
  return d >= 1 ? d : null;
}

/** Genera fechas (y, m, d) de una regla, en orden, empezando por DTSTART. */
function* occurrenceDates(start, rule) {
  const interval = Math.max(1, +(rule.INTERVAL || 1));
  const s = civil(start.y, start.m, start.d);
  const byday = (rule.BYDAY || "").split(",").filter(Boolean);
  const freq = rule.FREQ;
  for (let i = 0; i < 4000; i++) {
    if (freq === "DAILY") {
      yield civil(s.y, s.m, s.d + i * interval);
    } else if (freq === "WEEKLY") {
      const days = byday.length ? byday.map((b) => WEEKDAYS.indexOf(b.slice(-2))) : [s.dow];
      const mondayOffset = (s.dow + 6) % 7;
      const weekStart = s.d - mondayOffset + i * 7 * interval;
      for (const dow of days.sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))) {
        const c = civil(s.y, s.m, weekStart + ((dow + 6) % 7));
        if (i === 0 && Date.UTC(c.y, c.m - 1, c.d) < Date.UTC(s.y, s.m - 1, s.d)) continue;
        yield c;
      }
    } else if (freq === "MONTHLY") {
      const base = civil(s.y, s.m + i * interval, 1);
      if (byday.length) {
        const found = byday
          .map((b) => {
            const n = parseInt(b, 10) || 1;
            return nthWeekday(base.y, base.m, WEEKDAYS.indexOf(b.slice(-2)), n);
          })
          .filter(Boolean)
          .sort((a, b) => a - b);
        for (const d of found) {
          if (i === 0 && d < s.d) continue;
          yield { y: base.y, m: base.m, d };
        }
      } else {
        const day = +(rule.BYMONTHDAY || s.d);
        const last = new Date(Date.UTC(base.y, base.m, 0)).getUTCDate();
        if (day <= last) yield { y: base.y, m: base.m, d: day };
      }
    } else if (freq === "YEARLY") {
      const y = s.y + i * interval;
      const last = new Date(Date.UTC(y, s.m, 0)).getUTCDate();
      if (s.d <= last) yield { y, m: s.m, d: s.d };
    } else {
      yield s;
      return;
    }
  }
}

/** Instancias de los eventos que se solapan con [from, to). */
export function expandEvents(events, from, to) {
  const out = [];
  const overrides = new Set(events.filter((e) => e.recurrenceId).map((e) => `${e.uid}|${wallToMs(e.recurrenceId.wall, e.recurrenceId.tz)}`));
  for (const e of events) {
    const startMs = wallToMs(e.start.wall, e.start.tz);
    let endMs = e.end ? wallToMs(e.end.wall, e.end.tz) : e.duration ? startMs + e.duration : e.start.allDay ? startMs + 86400000 : startMs;
    const dur = Math.max(0, endMs - startMs);
    const push = (s) => {
      if (s < to && s + Math.max(dur, 1) > from) out.push({ uid: e.uid, title: e.title || "(Sin título)", location: e.location, start: s, end: s + dur, allDay: e.start.allDay });
    };
    if (!e.rrule || e.recurrenceId) {
      push(startMs);
      continue;
    }
    const ex = new Set(e.exdates.map((x) => wallToMs(x.wall, x.tz)));
    const until = e.rrule.UNTIL ? (() => {
      const u = parseIcsDate(e.rrule.UNTIL);
      return u ? wallToMs(u.wall, u.allDay ? "local" : u.tz) + (u.allDay ? 86399999 : 0) : Infinity;
    })() : Infinity;
    const count = e.rrule.COUNT ? +e.rrule.COUNT : Infinity;
    let n = 0;
    for (const date of occurrenceDates(e.start.wall, e.rrule)) {
      const s = wallToMs({ ...e.start.wall, y: date.y, m: date.m, d: date.d }, e.start.tz);
      if (s > until || n >= count || s >= to) break;
      n++;
      if (ex.has(s) || overrides.has(`${e.uid}|${s}`)) continue;
      push(s);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/* ============================================================
   Agenda del día: eventos + bloques de tiempo
   ============================================================ */
export function agendaFor(day, events, blocks, tasks) {
  const from = parseDay(day).getTime();
  const to = from + 86400000;
  const items = events
    .filter((e) => e.start < to && e.end > from)
    .map((e) => ({ kind: "event", id: `${e.uid}|${e.start}`, title: e.title, start: e.start, end: e.end, allDay: e.allDay, calendar: e.calendar, color: e.color }));
  for (const b of blocks.filter((b) => b.day === day)) {
    const task = tasks.find((t) => t.id === b.taskId);
    const start = atTime(day, b.start);
    items.push({ kind: "block", id: b.id, title: task ? task.text : b.title, taskId: b.taskId, start, end: start + b.minutes * 60000, done: task?.done });
  }
  return items.sort((a, b) => (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0) || a.start - b.start);
}

/* ============================================================
   Hábitos
   ============================================================ */
export const habitCount = (h, day = dayKey()) => h.counts?.[day] || 0;
export const habitDone = (h, day = dayKey()) => habitCount(h, day) >= Math.max(1, h.target);

export function habitStreak(h, today = dayKey()) {
  let key = habitDone(h, today) ? today : addDays(today, -1);
  let n = 0;
  while (habitDone(h, key) && n < 3650) {
    n++;
    key = addDays(key, -1);
  }
  return n;
}

const minutesOf = (hhmmStr) => {
  const [h, m] = hhmmStr.split(":").map(Number);
  return h * 60 + m;
};

/** ¿Toca recordar este hábito ahora? */
export function habitReminderDue(h, now, hours, lastAt) {
  if (!h.remindEvery || habitDone(h, dayKey(now))) return false;
  const d = new Date(now);
  const mins = d.getHours() * 60 + d.getMinutes();
  if (mins < minutesOf(hours.start) || mins >= minutesOf(hours.end)) return false;
  // El primer aviso llega tras un intervalo desde el inicio de la jornada.
  const dayStart = atTime(dayKey(now), hours.start);
  const since = Math.max(lastAt || 0, dayStart);
  return now - since >= h.remindEvery * 60000;
}

/* ============================================================
   Semanas
   ============================================================ */
/** Lunes de la semana de `key`. */
export function weekStart(key = dayKey()) {
  const d = parseDay(key);
  return addDays(key, -((d.getDay() + 6) % 7));
}

export const nextMonday = (key = dayKey()) => addDays(weekStart(key), 7);

export function weekDays(key = dayKey()) {
  const start = weekStart(key);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** ¿Toca recordar la revisión semanal? (una vez por semana, desde el día y hora elegidos) */
export function weeklyReviewDue(cfg, now, notifiedWeek) {
  if (!cfg.enabled) return false;
  const today = dayKey(now);
  const week = weekStart(today);
  if (notifiedWeek === week) return false;
  const dow = (parseDay(today).getDay() + 6) % 7; // 0 = lunes
  const target = (Number(cfg.day) + 6) % 7;
  if (dow < target) return false;
  return dow > target || now >= atTime(today, cfg.time);
}

/* ============================================================
   Multimedia
   ============================================================ */
export function fmtTime(secs) {
  const s = Math.max(0, Math.floor(secs || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** Posición estimada entre dos avisos del reproductor. */
export function mediaPosition(media, receivedAt, now = Date.now()) {
  if (!media) return 0;
  const drift = media.status === "Playing" ? (now - receivedAt) / 1000 : 0;
  const pos = media.position + drift;
  return media.length > 0 ? Math.min(pos, media.length) : pos;
}

/* ============================================================
   Notificaciones
   ============================================================ */
export const NOTIF_RULES = { hold: "Guardar durante el foco", show: "Mostrar siempre", always: "Mostrar incluso en foco", ignore: "Silenciar" };

/** Qué hacer con una notificación nueva: "show", "hold" o "ignore". */
export function notifDecision(n, { rules = {}, holdInFocus = true, inFocus = false } = {}) {
  const rule = rules[n.source] || (holdInFocus ? "hold" : "show");
  if (rule === "ignore") return "ignore";
  if (rule === "always" || n.urgency >= 2) return "show";
  if (inFocus && (rule === "hold" || holdInFocus)) return rule === "show" && !holdInFocus ? "show" : "hold";
  return "show";
}

/** Borra las notificaciones antiguas y limita el historial. */
export function pruneNotifs(items, now = Date.now(), keepHours = 48, max = 150) {
  const limit = now - keepHours * 3600000;
  return items.filter((n) => n.at >= limit).slice(-max);
}

/** Agrupa por origen, con las más recientes primero. */
export function groupNotifs(items) {
  const groups = new Map();
  for (const n of [...items].sort((a, b) => b.at - a.at)) {
    if (!groups.has(n.source)) groups.set(n.source, { source: n.source, items: [], unread: 0 });
    const g = groups.get(n.source);
    g.items.push(n);
    if (!n.read) g.unread++;
  }
  return [...groups.values()].sort((a, b) => b.items[0].at - a.items[0].at);
}

const AVATAR_COLORS = ["#8492ff", "#5ab0ff", "#2dd4bf", "#4ade80", "#fbbf24", "#fb923c", "#f472b6", "#c084fc"];
export function avatarColor(name = "") {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function timeAgo(t, now = Date.now()) {
  const m = Math.floor((now - t) / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.floor(h / 24)} d`;
}
