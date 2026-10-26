import { test } from "node:test";
import assert from "node:assert/strict";

import {
  addDays, agendaFor, breakAfter, categorize, completeTask, dayKey, expandEvents, extractJson, fmt,
  migrate, moveItem, nextDueDay, parseCapture, parseIcs, remainingMs, rollover, streak, usageSummary, wallToMs,
} from "../ui/js/core.js";

process.env.TZ = "Europe/Madrid";

test("captura: prefijos de destino", () => {
  assert.deepEqual(parseCapture("! Llamar a Marta"), { dest: "today", text: "Llamar a Marta" });
  assert.deepEqual(parseCapture("n: idea suelta"), { dest: "note", text: "idea suelta" });
  assert.deepEqual(parseCapture("#apunte"), { dest: "note", text: "apunte" });
  assert.deepEqual(parseCapture("  revisar SEO "), { dest: "inbox", text: "revisar SEO" });
});

test("formato de tiempo", () => {
  assert.equal(fmt(25 * 60000), "25:00");
  assert.equal(fmt(61500), "01:02");
  assert.equal(fmt(90 * 60000), "1:30:00");
  assert.equal(fmt(-5), "00:00");
});

test("pomodoro: restante y descanso largo", () => {
  const s = { focusMin: 25, breakMin: 5, longBreakMin: 15 };
  assert.equal(remainingMs({ phase: "idle" }, s), 25 * 60000);
  assert.equal(remainingMs({ phase: "focus", running: true, endAt: 1000 + 60000 }, s, 1000), 60000);
  assert.equal(remainingMs({ phase: "break", running: false, remaining: null }, s), 5 * 60000);
  assert.equal(breakAfter(4, 4), "long");
  assert.equal(breakAfter(3, 4), "break");
});

test("racha de días con foco", () => {
  const today = "2026-10-26";
  const at = (k) => new Date(k + "T10:00:00").getTime();
  const sessions = ["2026-10-24", "2026-10-25", "2026-10-26"].map((k) => ({ start: at(k), minutes: 25 }));
  assert.equal(streak(sessions, today), 3);
  assert.equal(streak(sessions.slice(0, 2), today), 2, "si hoy aún no hay foco, cuenta desde ayer");
  assert.equal(streak([], today), 0);
});

test("recurrencias", () => {
  assert.equal(nextDueDay("daily", "2026-10-26"), "2026-10-27");
  assert.equal(nextDueDay("weekdays", "2026-10-30"), "2026-11-02", "del viernes al lunes");
  assert.equal(nextDueDay("weekly", "2026-10-26"), "2026-11-02");
  assert.equal(nextDueDay("monthly", "2026-01-31"), "2026-02-28");
  assert.equal(nextDueDay(null, "2026-01-31"), null);
});

test("completar una tarea recurrente programa la siguiente y el cambio de día la trae", () => {
  const tasks = [{ id: "a", text: "Revisar GSC", list: "today", done: false, repeat: "daily", sub: [{ id: "s", text: "x", done: true }], createdAt: 1, order: 0 }];
  const now = new Date("2026-10-26T18:00:00").getTime();
  const next = completeTask(tasks, "a", now, () => "b");
  assert.equal(tasks[0].done, true);
  assert.equal(next.list, "scheduled");
  assert.equal(next.dueDay, "2026-10-27");
  assert.equal(next.sub[0].done, false);
  assert.equal(rollover(tasks, "2026-10-26"), 0);
  assert.equal(rollover(tasks, "2026-10-27"), 1);
  assert.equal(tasks[1].list, "today");
});

test("el cambio de día respeta el máximo de prioridades", () => {
  const tasks = [
    ...[1, 2, 3].map((i) => ({ id: `t${i}`, list: "today", done: false, order: i, createdAt: i })),
    { id: "r", list: "scheduled", homeList: "today", dueDay: "2026-10-27", done: false, order: 9, createdAt: 9 },
  ];
  rollover(tasks, "2026-10-27");
  assert.equal(tasks[3].list, "inbox");
});

test("mover elementos", () => {
  assert.deepEqual(moveItem(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
});

test("migración desde la v0.1", () => {
  const s = migrate({ tasks: [{ id: "x", text: "a", list: "today", done: false, createdAt: 1 }], settings: { focusMin: 50 } });
  assert.equal(s.v, 2);
  assert.equal(s.settings.focusMin, 50);
  assert.equal(s.settings.breakMin, 5);
  assert.equal(s.settings.ai.provider, "none");
  assert.deepEqual(s.tasks[0].sub, []);
  assert.deepEqual(s.blocks, []);
  assert.equal(migrate(null).v, 2);
});

test("JSON dentro de texto de un modelo", () => {
  assert.deepEqual(extractJson('Claro:\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('bla {"b":[1,2]} bla'), { b: [1, 2] });
  assert.equal(extractJson("sin json"), null);
});

test("categorías de aplicaciones", () => {
  assert.equal(categorize("code"), "productive");
  assert.equal(categorize("discord"), "distraction");
  assert.equal(categorize("firefox"), "neutral");
  assert.equal(categorize("firefox", { firefox: "productive" }), "productive");
  const sum = usageSummary({ code: 600, discord: 120, firefox: 60 });
  assert.equal(sum.productive, 600);
  assert.equal(sum.distraction, 120);
  assert.equal(sum.apps[0].app, "code");
});

/* ---------------- ICS ---------------- */

const ics = (body) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;

test("ICS: evento UTC, línea plegada y texto escapado", () => {
  const events = parseIcs(ics(`BEGIN:VEVENT\r\nUID:1\r\nSUMMARY:Reunión\\, equipo de\r\n  SEO\r\nDTSTART:20261026T080000Z\r\nDTEND:20261026T090000Z\r\nEND:VEVENT`));
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Reunión, equipo de SEO");
  const [inst] = expandEvents(events, Date.UTC(2026, 9, 26), Date.UTC(2026, 9, 27));
  assert.equal(inst.start, Date.UTC(2026, 9, 26, 8));
  assert.equal(inst.end - inst.start, 3600000);
});

test("ICS: zona horaria con TZID y nombres de Windows", () => {
  const ny = wallToMs({ y: 2026, m: 7, d: 1, h: 9 }, "America/New_York");
  assert.equal(ny, Date.UTC(2026, 6, 1, 13), "EDT = UTC-4");
  const winter = wallToMs({ y: 2026, m: 12, d: 1, h: 9 }, "America/New_York");
  assert.equal(winter, Date.UTC(2026, 11, 1, 14), "EST = UTC-5");
  const [e] = parseIcs(ics(`BEGIN:VEVENT\r\nUID:w\r\nDTSTART;TZID=Romance Standard Time:20261026T100000\r\nDURATION:PT30M\r\nEND:VEVENT`));
  assert.equal(e.start.tz, "Europe/Paris");
});

test("ICS: semanal con BYDAY, EXDATE, COUNT y cambio de hora", () => {
  const events = parseIcs(ics(`BEGIN:VEVENT\r\nUID:standup\r\nSUMMARY:Daily\r\nDTSTART;TZID=Europe/Madrid:20261019T093000\r\nDTEND;TZID=Europe/Madrid:20261019T094500\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=6\r\nEXDATE;TZID=Europe/Madrid:20261021T093000\r\nBEGIN:VALARM\r\nTRIGGER:-PT10M\r\nEND:VALARM\r\nEND:VEVENT`));
  const from = new Date("2026-10-19T00:00:00").getTime();
  const out = expandEvents(events, from, from + 21 * 86400000);
  const days = out.map((x) => dayKey(x.start));
  // 6 repeticiones (19, 21, 23, 26, 28, 30) menos la excluida del 21.
  assert.deepEqual(days, ["2026-10-19", "2026-10-23", "2026-10-26", "2026-10-28", "2026-10-30"]);
  // La hora de pared se mantiene a las 9:30 tras el cambio de hora del 25 de octubre.
  for (const x of out) assert.equal(new Date(x.start).getHours() * 60 + new Date(x.start).getMinutes(), 9 * 60 + 30);
});

test("ICS: mensual por día de la semana, todo el día, cancelados y excepciones", () => {
  const events = parseIcs(ics([
    "BEGIN:VEVENT\r\nUID:m\r\nSUMMARY:Cierre\r\nDTSTART:20261002T150000Z\r\nDTEND:20261002T160000Z\r\nRRULE:FREQ=MONTHLY;BYDAY=-1FR;UNTIL=20261231T000000Z\r\nEND:VEVENT",
    "BEGIN:VEVENT\r\nUID:d\r\nSUMMARY:Festivo\r\nDTSTART;VALUE=DATE:20261101\r\nEND:VEVENT",
    "BEGIN:VEVENT\r\nUID:c\r\nSTATUS:CANCELLED\r\nDTSTART:20261101T100000Z\r\nEND:VEVENT",
    "BEGIN:VEVENT\r\nUID:r\r\nDTSTART:20261102T100000Z\r\nDTEND:20261102T110000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEND:VEVENT",
    "BEGIN:VEVENT\r\nUID:r\r\nRECURRENCE-ID:20261103T100000Z\r\nDTSTART:20261103T120000Z\r\nDTEND:20261103T130000Z\r\nEND:VEVENT",
  ].join("\r\n")));
  const out = expandEvents(events, Date.UTC(2026, 9, 1), Date.UTC(2027, 0, 1));
  const monthly = out.filter((x) => x.uid === "m").map((x) => new Date(x.start).toISOString().slice(0, 10));
  assert.deepEqual(monthly, ["2026-10-30", "2026-11-27", "2026-12-25"]);
  const allDay = out.find((x) => x.uid === "d");
  assert.equal(allDay.allDay, true);
  assert.equal(allDay.end - allDay.start, 86400000);
  assert.equal(out.filter((x) => x.uid === "c").length, 0);
  const daily = out.filter((x) => x.uid === "r").map((x) => new Date(x.start).toISOString().slice(5, 16));
  assert.deepEqual(daily, ["11-02T10:00", "11-03T12:00", "11-04T10:00"], "la excepción sustituye a la repetición");
});

test("agenda: eventos y bloques ordenados", () => {
  const day = "2026-10-26";
  const base = new Date(day + "T00:00:00").getTime();
  const events = [{ uid: "e", title: "Reunión", start: base + 11 * 3600000, end: base + 12 * 3600000 }];
  const blocks = [{ id: "b", day, start: "09:00", minutes: 50, taskId: "t" }];
  const tasks = [{ id: "t", text: "Auditoría", done: false }];
  const items = agendaFor(day, events, blocks, tasks);
  assert.deepEqual(items.map((i) => i.title), ["Auditoría", "Reunión"]);
  assert.equal(items[0].end - items[0].start, 50 * 60000);
  assert.equal(addDays(day, 1), "2026-10-27");
});
