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
const tgServer = http.createServer((req, res) => {
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => {
    const method = req.url.split("/").pop();
    const body = data ? JSON.parse(data) : {};
    if (method === "sendMessage") SENT.push({ chat: String(body.chat_id), text: body.text, kb: body.reply_markup });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, result: {} }));
  });
});
await new Promise((r) => tgServer.listen(0, "127.0.0.1", r));
const TG_PORT = tgServer.address().port;

// ---------------------------------------------------------------- Worker
rmSync(STATE, { recursive: true, force: true });
execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "aurora-db", "--local", "--persist-to", STATE], { stdio: "ignore" });
const vars = { FAMILY_PIN: PIN, SECRET_KEY: "test-secret", TELEGRAM_TOKEN: "fake",
  TG_API_BASE: `http://127.0.0.1:${TG_PORT}`, TEST_MODE: "1", APP_TZ: "America/Bogota" };
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
  await fetch(BASE + "/telegram/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": SECRET },
    body: JSON.stringify({ callback_query: { id: "x", data, message: { chat: { id: chat } } } }),
  });
}

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
  assert.match(await tg("/dormir", 1), /Ya está durmiendo/);
  assert.match(await tg("/desperto", 1), /Se despertó/);
  const t = await tg("/temp 38.2", 1);
  assert.match(t, /38\.2 °C/);
  assert.match(t, /urgencias/);
  assert.match(await tg("/temp inf", 1), /Ejemplo/);
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

test("bot: botones", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  await tgButton("ml:15", 1);
  await tgButton("log:diaper:ambos", 1);
  await tgButton("log:evil:x", 1);
  const kinds = (await api("/api/entries")).data.map((e) => e.kind).sort();
  assert.deepEqual(kinds, ["diaper", "feed"]);
  const feed = (await api("/api/entries?kind=feed")).data[0];
  assert.equal(feed.amount, 15);
});

test("bot: botones de ml para recién nacido", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  await tg("/comida", 1);
  const kb = SENT[SENT.length - 1].kb.inline_keyboard.flat().map((b) => b.text);
  assert.deepEqual(kb.slice(0, 4), ["5 ml", "10 ml", "15 ml", "20 ml"]);
});

test("bot: texto libre y sueño pasado", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  assert.match(await tg("popó", 1), /popó/);
  assert.match(await tg("Pipí y popó", 1), /pipí \+ popó/);
  assert.match(await tg("tetero 30", 1), /30 ml/);
  assert.match(await tg("pecho izq", 1), /pecho izquierdo/);
  assert.match(await tg("hola", 1), /No te entendí/);
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
  assert.match(await tg("/control 31/02 9:00 Pediatra", 1), /no existe/);
  assert.match(await tg("/recordar algún día", 1), /No entendí la hora/);
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
