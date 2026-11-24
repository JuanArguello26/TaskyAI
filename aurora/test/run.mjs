// Pruebas de integración: levanta el Worker real con `wrangler dev` (D1 local)
// y un Telegram falso que guarda los mensajes que el bot enviaría.
import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
import { rmSync } from "node:fs";
import assert from "node:assert/strict";

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const STATE = ".wrangler/test-state";
const PIN = "4321";

// ---------------------------------------------------------------- Telegram falso
const SENT = [];
// Respuestas de la IA falsa: texto del usuario -> acciones
const AI_MAP = {
  "le di 8 ml de fórmula hace un rato y después hizo popó":
    { actions: [{ type: "feed", detail: "formula", amount: 8, ago: null, time: null }, { type: "diaper", detail: "popo" }] },
  "tomó teta derecha como 15 minutos": { actions: [{ type: "feed", detail: "pecho_der", amount: 15 }] },
  "¿cuánto ha comido hoy?": { actions: [{ type: "question" }] },
  "pesó 3200 gramos y tiene 38,4 de temperatura": { actions: [{ type: "weight", kg: 3.2 }, { type: "temp", value: 38.4 }] },
  "recuérdame en 20 minutos sacarme leche": { actions: [{ type: "reminder", in_minutes: 20, text: "sacarme leche" }] },
  "el control con la pediatra es el 2 de diciembre de 2027 a las 10 y media":
    { actions: [{ type: "appointment", date: "2027-12-02", time: "10:30", title: "Control con la pediatra", place: null }] },
  "30": { actions: [] },
};
let AI_DOWN = false;
const tgServer = http.createServer((req, res) => {
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/ai") {
      if (AI_DOWN) { res.statusCode = 500; return res.end("{}"); }
      const { input } = JSON.parse(data);
      if (input.audio) return res.end(JSON.stringify({ text: "hizo popó" }));
      const sys = input.messages[0].content;
      const user = input.messages[1].content;
      if (sys.startsWith("Conviertes")) {
        const key = user.replace(/^recuérdame |^control médico: /, "");
        const out = AI_MAP[user] ?? AI_MAP[key] ?? { actions: [] };
        return res.end(JSON.stringify({ choices: [{ message: { content: "```json\n" + JSON.stringify(out) + "\n```" } }] }));
      }
      return res.end(JSON.stringify({ response: "Hoy tomó 1 vez (8 ml de fórmula)." }));
    }
    if (req.url.startsWith("/file/")) { res.setHeader("Content-Type", "audio/ogg"); return res.end(Buffer.from([1, 2, 3, 4])); }
    const method = req.url.split("/").pop();
    const body = data ? JSON.parse(data) : {};
    if (method === "sendMessage" || method === "editMessageText") {
      SENT.push({ chat: String(body.chat_id), text: body.text, kb: body.reply_markup, edit: method === "editMessageText" });
    }
    if (method === "getFile") return res.end(JSON.stringify({ ok: true, result: { file_path: "voice/1.ogg" } }));
    res.end(JSON.stringify({ ok: true, result: { message_id: 1 } }));
  });
});
await new Promise((r) => tgServer.listen(0, "127.0.0.1", r));
const TG_PORT = tgServer.address().port;

// ---------------------------------------------------------------- Worker
rmSync(STATE, { recursive: true, force: true });
execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "aurora-db", "--local", "--persist-to", STATE], { stdio: "ignore" });
const vars = { FAMILY_PIN: PIN, SECRET_KEY: "test-secret", TELEGRAM_TOKEN: "fake",
  TG_API_BASE: `http://127.0.0.1:${TG_PORT}`, AI_TEST_URL: `http://127.0.0.1:${TG_PORT}/ai`,
  TEST_MODE: "1", APP_TZ: "America/Bogota" };
const worker = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1", "--persist-to", STATE,
  "--test-scheduled", ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`])],
{ stdio: ["ignore", "pipe", "pipe"], detached: true });
let workerLog = "";
worker.stdout.on("data", (d) => (workerLog += d));
worker.stderr.on("data", (d) => (workerLog += d));
const stop = () => { try { process.kill(-worker.pid); } catch { /* ya terminó */ } tgServer.close(); };
process.on("exit", stop);

for (let i = 0; i < 120; i++) {
  try { if ((await fetch(BASE + "/healthz")).ok) break; } catch { /* esperando */ }
  await new Promise((r) => setTimeout(r, 500));
  if (i === 119) { console.error(workerLog); throw new Error("wrangler dev no arrancó"); }
}

// ---------------------------------------------------------------- helpers
let TOKEN = null;
const SECRET = (await (await fetch(BASE + "/__test/webhook-secret")).json()).secret;

async function api(path, { method = "GET", body, auth = true, author = "Juan" } = {}) {
  const headers = { "Content-Type": "application/json", "X-Author": encodeURIComponent(author) };
  if (auth) headers.Authorization = `Bearer ${TOKEN}`;
  const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}

async function tg(text, chat = 100, name = "Juan") {
  const before = SENT.length;
  const r = await fetch(BASE + "/telegram/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": SECRET },
    body: JSON.stringify({ message: { chat: { id: chat }, from: { first_name: name }, text } }),
  });
  assert.equal(r.status, 200);
  const mine = SENT.slice(before).filter((m) => m.chat === String(chat));
  return mine.length ? mine[mine.length - 1].text : "";
}

async function tgButton(data, chat = 100) {
  const before = SENT.length;
  await fetch(BASE + "/telegram/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": SECRET },
    body: JSON.stringify({ callback_query: { id: "x", data, message: { chat: { id: chat }, message_id: 7 } } }),
  });
  const mine = SENT.slice(before).filter((m) => m.chat === String(chat));
  return mine.length ? mine[mine.length - 1] : null;
}

async function tgAll(text, chat = 100) {
  const before = SENT.length;
  await tg(text, chat);
  return SENT.slice(before).filter((m) => m.chat === String(chat));
}

const kbData = (m) => (m?.kb?.inline_keyboard ?? []).flat().map((b) => b.callback_data);

const tick = async () => (await (await fetch(BASE + "/__test/tick", { method: "POST" })).json()).sent;
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const MIN = 60_000, HOUR = 60 * MIN;

// Hora local de la familia (Bogotá = UTC-5, sin horario de verano)
const localHHMM = (msAgo) => {
  const d = new Date(Date.now() - msAgo - 5 * HOUR);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

// ---------------------------------------------------------------- pruebas
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("login rechaza PIN malo y protege la API", async () => {
  assert.equal((await api("/api/login", { method: "POST", body: { pin: "0000" }, auth: false })).status, 401);
  assert.equal((await api("/api/status", { auth: false })).status, 401);
});

test("login bloquea tras 5 intentos", async () => {
  for (let i = 0; i < 5; i++) await api("/api/login", { method: "POST", body: { pin: "0000" }, auth: false });
  assert.equal((await api("/api/login", { method: "POST", body: { pin: PIN }, auth: false })).status, 429);
});

test("registros y estado", async () => {
  const r = await api("/api/entries", { method: "POST", body: { kind: "feed", detail: "biberon", amount: 30 } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.text, "🍼 Comida · biberón · 30 ml");
  await api("/api/entries", { method: "POST", body: { kind: "diaper", detail: "popo" } });
  const st = (await api("/api/status")).data;
  assert.equal(st.last.feed.amount, 30);
  assert.equal(st.last.poop.detail, "popo");
  assert.equal(st.today.feeds, 1);
  assert.equal(st.today.feed_ml, 30);
  assert.equal(st.today.poop, 1);
});

test("sueño: iniciar, no duplicar, terminar y sueño pasado", async () => {
  assert.equal((await api("/api/sleep/toggle", { method: "POST" })).data.sleeping, true);
  assert.equal((await api("/api/entries", { method: "POST", body: { kind: "sleep" } })).status, 409);
  assert.ok((await api("/api/status")).data.sleeping);
  const r = (await api("/api/sleep/toggle", { method: "POST" })).data;
  assert.equal(r.sleeping, false);
  assert.ok(r.entry.end);
  const p = await api("/api/entries", { method: "POST", body: { kind: "sleep", start: iso(3 * HOUR), end: iso(2 * HOUR) } });
  assert.equal(p.status, 200);
  assert.match(p.data.text, /1 h 00 min/);
});

test("editar y borrar registro; validaciones", async () => {
  const e = (await api("/api/entries", { method: "POST", body: { kind: "temp", amount: 37 } })).data;
  const r = await api(`/api/entries/${e.id}`, { method: "PATCH", body: { kind: "temp", amount: 37.5, start: e.start } });
  assert.equal(r.data.amount, 37.5);
  await api(`/api/entries/${e.id}`, { method: "DELETE" });
  assert.deepEqual((await api("/api/entries")).data, []);
  assert.equal((await api("/api/entries", { method: "POST", body: { kind: "feed", amount: -5 } })).status, 422);
  assert.equal((await api("/api/entries", { method: "POST", body: { kind: "bad" } })).status, 422);
  const s = (await api("/api/entries", { method: "POST", body: { kind: "sleep", start: iso(3 * HOUR), end: iso(2 * HOUR) } })).data;
  assert.equal((await api(`/api/entries/${s.id}`, { method: "PATCH", body: { kind: "sleep", start: s.start, end: iso(4 * HOUR) } })).status, 422);
});

test("registro en la web avisa al otro, no al autor", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  await tg(`/start ${PIN} Maria`, 2);
  SENT.length = 0;
  await api("/api/entries", { method: "POST", body: { kind: "bath" } });
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(SENT.map((m) => m.chat), ["2"]);
});

test("citas y recordatorios por la web", async () => {
  const a = await api("/api/appointments", { method: "POST", body: { title: "Pediatra", at: iso(-48 * HOUR), place: "Clínica" } });
  assert.equal(a.status, 200);
  assert.equal((await api("/api/appointments")).data.length, 1);
  assert.equal((await api(`/api/appointments/${a.data.id}/done`, { method: "POST" })).data.done, true);
  const r = await api("/api/reminders", { method: "POST", body: { text: "Vitamina D", due_at: iso(-HOUR), repeat_minutes: 1440 } });
  assert.equal(r.status, 200);
  assert.equal((await api("/api/reminders", { method: "POST", body: { text: "x", due_at: iso(0), repeat_minutes: 1 } })).status, 422);
  await api(`/api/reminders/${r.data.id}`, { method: "DELETE" });
  assert.equal((await api("/api/reminders")).data.length, 0);
});

test("bot exige PIN y bloquea tras 5 intentos", async () => {
  assert.match(await tg("/estado", 9), /PIN/);
  for (let i = 0; i < 5; i++) assert.match(await tg("/start 0000 X", 9), /incorrecto/);
  assert.match(await tg(`/start ${PIN} X`, 9), /Demasiados/);
  assert.match(await tg(`/start ${PIN} Mamá`, 10), /Listo/);
  assert.match(await tg("/estado", 10), /Aurora/);
});

test("bot: comandos de registro", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  assert.match(await tg("/comida 30", 1), /30 ml/);
  assert.match(await tg("/pecho izq 15", 1), /pecho izquierdo · 15 min/);
  assert.match(await tg("/panal popo", 1), /popó/);
  assert.match(await tg("/dormir", 1), /Se durmió/);
  assert.match(await tg("/dormir", 1), /Ya estaba durmiendo/);
  assert.match(await tg("/desperto", 1), /Se despertó/);
  const t = await tg("/temp 38.2", 1);
  assert.match(t, /38\.2 °C/);
  assert.match(t, /urgencias/);
  assert.match(await tg("/temp inf", 1), /¿Cuánta temperatura/);
  assert.equal((await api("/api/entries")).data.length, 5);
  assert.match(await tg("/deshacer", 1), /Borrado/);
  assert.equal((await api("/api/entries")).data.length, 4);
});

test("bot: hora pasada con 'hace'", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  await tg("/comida 20 hace 30m", 1);
  const [e] = (await api("/api/entries")).data;
  const diff = Date.now() - Date.parse(e.start);
  assert.ok(diff > 29 * MIN && diff < 31 * MIN, String(diff));
});

test("bot: botones inline", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  const m = await tgButton("ml:formula:2.5", 1);
  assert.ok(m.edit, "edita el mensaje en vez de mandar otro");
  assert.match(m.text, /fórmula · 2\.5 ml/);
  await tgButton("dp:ambos", 1);
  await tgButton("log:evil:x", 1);
  await tgButton("dp:evil", 1);
  const kinds = (await api("/api/entries")).data.map((e) => e.kind).sort();
  assert.deepEqual(kinds, ["diaper", "feed"]);
});

test("bot: teclado fijo al vincularse y cantidades de recién nacido", async () => {
  const all = await tgAll(`/start ${PIN} Juan`, 1);
  const kb = all[all.length - 1].kb;
  assert.ok(kb.keyboard && kb.is_persistent, "teclado fijo");
  assert.deepEqual(kb.keyboard.flat().map((b) => b.text), ["🍼 Tetero", "🤱 Pecho", "😴 Sueño", "🧷 Pañal", "📊 ¿Cómo va?", "➕ Más"]);
  await tg("🍼 Tetero", 1);
  const labels = SENT[SENT.length - 1].kb.inline_keyboard.flat().map((b) => b.text);
  assert.ok(labels.includes("2 ml") && labels.includes("3 ml") && labels.includes("5 ml"), labels.join());
});

test("bot: conversación paso a paso (tetero -> escribir 4)", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  await tg("🍼 Tetero", 1);
  assert.match(await tg("4", 1), /biberón · 4 ml/);
  await tgButton("br:izq", 1);
  assert.match(await tg("12 min", 1), /pecho izquierdo · 12 min/);
  await tg("➕ Más", 1);
  await tgButton("m:weight", 1);
  assert.match(await tg("3250 gramos", 1), /3\.25 kg/);
  await tgButton("m:med", 1);
  assert.match(await tg("Vitamina D 2 gotas", 1), /Vitamina D 2 gotas/);
  // si responde otra cosa, se olvida la pregunta y sigue normal
  await tg("🍼 Tetero", 1);
  assert.match(await tg("popó", 1), /popó/);
  assert.equal((await api("/api/entries")).data.length, 5);
});

test("bot: deshacer y 'fue hace' desde los botones", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  await tg("popó", 1);
  const msg = SENT[SENT.length - 1];
  const [undo, ago10] = kbData(msg);
  assert.match(undo, /^undo:/);
  const m = await tgButton(kbData(msg).find((d) => d.startsWith("ago:") && d.endsWith(":30")), 1);
  assert.match(m.text, /popó/);
  const [e] = (await api("/api/entries")).data;
  const diff = Date.now() - Date.parse(e.start);
  assert.ok(diff > 29 * MIN && diff < 32 * MIN, String(diff));
  await tgButton(undo, 1);
  assert.equal((await api("/api/entries")).data.length, 0);
  assert.ok(ago10);
});

test("bot: texto libre y sueño pasado", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  assert.match(await tg("popó", 1), /popó/);
  assert.match(await tg("Pipí y popó", 1), /pipí \+ popó/);
  assert.match(await tg("tetero 30", 1), /30 ml/);
  assert.match(await tg("pecho izq", 1), /pecho izquierdo/);
  assert.match(await tg("hola", 1), /Hola, Juan/);
  assert.match(await tg("Hola Tasky!", 1), /Hola, Juan/);
  assert.match(await tg("Buenos días", 1), /Hola, Juan/);
  assert.match(await tg("gracias", 1), /Con gusto/);
  assert.match(await tg("30", 1), /No te entendí/);
  assert.match(await tg(`/sueno ${localHHMM(3 * HOUR)} ${localHHMM(2 * HOUR)}`, 1), /1 h 00 min/);
  assert.match(await tg(`/sueno ${localHHMM(3 * HOUR)} 5h`, 1), /futuro/);
});

test("bot: recordatorio, control, agenda y fecha inválida", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  assert.match(await tg("/recordar 30m vitamina D", 1), /Listo, les aviso/);
  assert.match(await tg("/recordar cada 1d hierro", 1), /todos los días/);
  assert.match(await tg("/control mañana 9:30 Pediatra | Clínica", 1), /Agendado/);
  const ag = await tg("/agenda", 1);
  assert.match(ag, /vitamina D/);
  assert.match(ag, /Pediatra/);
  assert.match(await tg("/control 31/02 9:00 Pediatra", 1), /No entendí la fecha/);
  assert.match(await tg("/recordar algún día", 1), /No entendí cuándo/);
});

test("cron: recordatorios únicos y repetitivos", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  await api("/api/reminders", { method: "POST", body: { text: "vitamina", due_at: iso(MIN) } });
  await api("/api/reminders", { method: "POST", body: { text: "pecho", due_at: iso(MIN), repeat_minutes: 180 } });
  SENT.length = 0;
  const sent = await tick();
  assert.equal(sent.length, 2);
  assert.ok(SENT.some((m) => m.text.includes("vitamina")));
  assert.deepEqual(await tick(), []);
  const rems = (await api("/api/reminders")).data;
  assert.equal(rems.length, 1);
  assert.equal(rems[0].text, "pecho");
  assert.ok(Date.parse(rems[0].due_at) > Date.now() + 2 * HOUR);
});

test("cron: aviso de control y de comida, sin repetir", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  await api("/api/appointments", { method: "POST", body: { title: "Pediatra", at: iso(-HOUR) } });
  await api("/api/appointments", { method: "POST", body: { title: "Vacuna", at: iso(-20 * HOUR) } });
  await api("/api/entries", { method: "POST", body: { kind: "feed", detail: "biberon", amount: 20, start: iso(4 * HOUR) } });
  const sent = await tick();
  assert.ok(sent.some((s) => s.startsWith("appt2h")), sent.join());
  assert.ok(sent.some((s) => s.startsWith("appt24h")), sent.join());
  assert.ok(sent.some((s) => s.startsWith("feed_alert")), sent.join());
  assert.deepEqual(await tick(), []);
});

test("el cron real de Cloudflare dispara los recordatorios", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  await api("/api/reminders", { method: "POST", body: { text: "desde el cron", due_at: iso(MIN) } });
  SENT.length = 0;
  let r = await fetch(BASE + "/cdn-cgi/handler/scheduled?cron=*+*+*+*+*");
  if (r.status === 404) r = await fetch(BASE + "/__scheduled?cron=*+*+*+*+*");
  assert.equal(r.status, 200);
  for (let i = 0; i < 20 && !SENT.length; i++) await new Promise((x) => setTimeout(x, 100));
  assert.ok(SENT.some((m) => m.text.includes("desde el cron")), JSON.stringify(SENT));
});

test("IA: varias cosas en un mensaje + deshacer todo", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  const m = (await tgAll("le di 8 ml de fórmula hace un rato y después hizo popó", 1)).pop();
  assert.match(m.text, /fórmula · 8 ml/);
  assert.match(m.text, /popó/);
  assert.match(kbData(m)[0], /^undo:\d+,\d+$/);
  assert.equal((await api("/api/entries")).data.length, 2);
  await tgButton(kbData(m)[0], 1);
  assert.equal((await api("/api/entries")).data.length, 0);
});

test("IA: pecho con duración, peso en gramos y fiebre", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  assert.match(await tg("tomó teta derecha como 15 minutos", 1), /pecho derecho · 15 min/);
  const t = await tg("pesó 3200 gramos y tiene 38,4 de temperatura", 1);
  assert.match(t, /3\.2 kg/);
  assert.match(t, /38\.4 °C/);
  assert.match(t, /urgencias/);
});

test("IA: recordatorio, control y pregunta", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  assert.match(await tg("recuérdame en 20 minutos sacarme leche", 1), /Listo, les aviso.*sacarme leche/s);
  assert.match(await tg("el control con la pediatra es el 2 de diciembre de 2027 a las 10 y media", 1), /Agendado.*pediatra/s);
  const st = (await api("/api/status")).data;
  assert.equal(st.reminders.length, 1);
  assert.equal((await api("/api/appointments")).data.length, 1);
  assert.match(await tg("¿cuánto ha comido hoy?", 1), /Hoy tomó/);
});

test("IA caída: el bot sigue respondiendo", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  AI_DOWN = true;
  try {
    assert.match(await tg("algo raro que no es frase simple", 1), /Usa los botones/);
    assert.match(await tg("popó", 1), /popó/); // lo simple sigue sin IA
  } finally { AI_DOWN = false; }
});

test("nota de voz -> registro", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  const before = SENT.length;
  await fetch(BASE + "/telegram/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": SECRET },
    body: JSON.stringify({ message: { chat: { id: 1 }, from: { first_name: "Juan" }, voice: { file_id: "abc", duration: 3 } } }),
  });
  const mine = SENT.slice(before).map((m) => m.text).join("\n");
  assert.match(mine, /hizo popó/);
  assert.equal((await api("/api/entries?kind=diaper")).data.length, 1);
});

test("webhook rechaza secreto malo", async () => {
  const r = await fetch(BASE + "/telegram/webhook", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "no" }, body: "{}" });
  assert.equal(r.status, 403);
});

test("bot responde con amabilidad ante JSON raro", async () => {
  const r = await fetch(BASE + "/telegram/webhook", {
    method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": SECRET, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { chat: { id: 5 } } }),
  });
  assert.equal(r.status, 200);
});

test("la web se sirve", async () => {
  const html = await (await fetch(BASE + "/")).text();
  assert.match(html, /Aurora/);
  assert.equal((await fetch(BASE + "/static/app.js")).status, 200);
  assert.equal((await fetch(BASE + "/manifest.webmanifest")).status, 200);
  assert.equal((await fetch(BASE + "/__nope")).status, 404);
});

// ---------------------------------------------------------------- ejecutar
let failed = 0;
for (const [name, fn] of tests) {
  await fetch(BASE + "/__test/reset", { method: "POST" });
  SENT.length = 0;
  TOKEN = (await api("/api/login", { method: "POST", body: { pin: PIN }, auth: false })).data?.token;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${e.stack?.split("\n").slice(0, 3).join("\n    ")}`);
  }
}
console.log(`\n${tests.length - failed} pasaron, ${failed} fallaron`);
if (failed) console.log("\n--- log de wrangler ---\n" + workerLog.slice(-3000));
stop();
process.exit(failed ? 1 : 0);
