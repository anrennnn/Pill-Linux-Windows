import { test } from "node:test";
import assert from "node:assert/strict";

import { askMessages, classifyMessages, closeToText, parseClassify, parseClose, parsePlan, planMessages } from "../ui/js/ai-prompts.js";

const ctx = {
  now: "09:10",
  dateLabel: "lunes 26 de octubre",
  dayEnd: "19:00",
  focusMin: 50,
  breakMin: 10,
  today: [{ id: "t1", text: "Auditoría SEO", minutes: 0 }],
  inbox: [{ id: "i1", text: "Newsletter" }],
  agenda: [{ start: "11:00", end: "12:00", title: "Reunión" }],
  focusMinutes: 0,
};

test("el prompt del plan incluye ids, agenda y límites", () => {
  const [sys, user] = planMessages(ctx);
  assert.equal(sys.role, "system");
  assert.match(user.content, /t1 · Auditoría SEO/);
  assert.match(user.content, /11:00–12:00 Reunión/);
  assert.match(user.content, /antes de 19:00/);
});

test("el plan se valida: horas, minutos e ids inventados", () => {
  const raw = `Aquí tienes: {"resumen":"Día centrado","bloques":[
    {"inicio":"9:20","minutos":50,"tarea_id":"t1","titulo":"Auditoría"},
    {"inicio":"25:00","minutos":30,"tarea_id":"t1","titulo":"mala hora"},
    {"inicio":"13:00","minutos":2,"tarea_id":"t1","titulo":"muy corto"},
    {"inicio":"12:10","minutos":40,"tarea_id":"inventado","titulo":"Newsletter"}
  ],"consejo":"Agua"}`;
  const plan = parsePlan(raw, ["t1", "i1"]);
  assert.equal(plan.summary, "Día centrado");
  assert.deepEqual(plan.blocks.map((b) => [b.start, b.minutes, b.taskId]), [["09:20", 50, "t1"], ["12:10", 40, null]]);
  assert.equal(parsePlan("no sé", []), null);
});

test("cierre del día: JSON o texto libre", () => {
  const c = parseClose('{"resumen":"Buen día","logros":["A"],"aprender":"Menos Discord","mañana":["B","C","D","E"]}');
  assert.equal(c.summary, "Buen día");
  assert.deepEqual(c.tomorrow, ["B", "C", "D"]);
  assert.match(closeToText(c, "26 oct"), /Logros:\n• A/);
  assert.equal(parseClose("Un día normal.").summary, "Un día normal.");
  assert.equal(parseClose(""), null);
});

test("clasificar capturas", () => {
  assert.match(classifyMessages('llamar a "Ana" hoy')[1].content, /llamar a 'Ana' hoy/);
  assert.deepEqual(parseClassify('{"tipo":"tarea","lista":"hoy","texto":"Llamar a Ana"}', "llamar a ana hoy"), { type: "task", list: "today", text: "Llamar a Ana" });
  assert.deepEqual(parseClassify('{"tipo":"nota","lista":"bandeja","texto":""}', "idea"), { type: "note", list: "inbox", text: "idea" });
  assert.equal(parseClassify("???", "x"), null);
});

test("preguntar conserva un historial corto", () => {
  const history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: String(i) }));
  const msgs = askMessages("¿Qué hago ahora?", ctx, history);
  assert.equal(msgs.length, 1 + 6 + 1);
  assert.match(msgs[0].content, /Auditoría SEO/);
});
