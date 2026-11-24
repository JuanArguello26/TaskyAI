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
  "le hice masajes con aceite 10 minutos": { actions: [{ type: "activity", name: "masajes con aceite", amount: 10 }] },
  "recuérdame masajes con aceite todos los días a las 7 pm":
    { actions: [{ type: "reminder", time: "19:00", repeat_minutes: 1440, text: "masajes con aceite" }] },
  "tratamiento: amoxicilina 2.5 ml cada 8 horas por 7 días desde las 8":
    { actions: [{ type: "medication", name: "Amoxicilina", dose: "2.5 ml", every_hours: 8, days: 7, start_time: "08:00" }] },
  "hizo 5 minutos de tummy time y anota que hay que comprar pañales":
    { actions: [{ type: "tummy", amount: 5 }, { type: "note", text: "Comprar pañales" }] },
};
let AI_DOWN = false;
const EMAILS = [];
const CAL = [];
let GS_VERSION = 2;
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
        const key = AI_MAP[user] ? user : user.replace(/^recuérdame |^control médico: /, "");
        const out = AI_MAP[user] ?? AI_MAP[key] ?? { actions: [] };
        return res.end(JSON.stringify({ choices: [{ message: { content: "```json\n" + JSON.stringify(out) + "\n```" } }] }));
      }
      return res.end(JSON.stringify({ response: "Hoy tomó 1 vez (8 ml de fórmula)." }));
    }
    if (req.url === "/gs") {
      const d = JSON.parse(data);
      if (d.action && GS_VERSION < 2) return res.end(JSON.stringify({ ok: false, error: "sin destinatarios" }));
      if (d.action === "ping") return res.end(JSON.stringify({ ok: true, version: GS_VERSION }));
      if (d.action === "calendar_create") { CAL.push(d); return res.end(JSON.stringify({ ok: true, id: "ev" + CAL.length })); }
      if (d.action === "calendar_delete") { CAL.push(d); return res.end(JSON.stringify({ ok: true })); }
      EMAILS.push(d);
      return res.end(JSON.stringify({ ok: true, quota: 99 }));
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

const tick = async (at) => (await (await fetch(BASE + "/__test/tick" + (at ? `?at=${at}` : ""), { method: "POST" })).json()).sent;
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

test("cron: alerta de comida sin repetir", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  await api("/api/entries", { method: "POST", body: { kind: "feed", detail: "biberon", amount: 20, start: iso(4 * HOUR) } });
  assert.ok((await tick()).some((s) => s.startsWith("feed_alert")));
  assert.deepEqual(await tick(), []);
});

test("recordatorio: 1 h antes, 10 min antes y a la hora exacta (sin retraso)", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  const minute = Math.floor(Date.now() / MIN) * MIN;
  const due = minute + 2 * HOUR; // en punto
  // con segundos sueltos (como cuando la IA dice "en 2 horas"): se ajusta al minuto
  const r = (await api("/api/reminders", { method: "POST", body: { text: "Control prenatal", due_at: new Date(due + 49_000).toISOString() } })).data;
  assert.equal(Date.parse(r.due_at), due);
  assert.deepEqual(await tick(minute), []);
  assert.deepEqual(await tick(due - 61 * MIN), []);
  assert.deepEqual(await tick(due - 60 * MIN), [`pre60:${r.id}`]);
  assert.deepEqual(await tick(due - 30 * MIN), []);
  SENT.length = 0;
  assert.deepEqual(await tick(due - 10 * MIN), [`pre10:${r.id}`]);
  assert.match(SENT[0].text, /En 10 minutos/);
  assert.deepEqual(await tick(due - MIN), []);
  SENT.length = 0;
  assert.deepEqual(await tick(due + 1000), [`reminder:${r.id}`], "sale en el minuto exacto");
  assert.deepEqual(kbData(SENT[0]).map((d) => d.split(":")[0]), ["rdone", "rsnz"]);
  assert.deepEqual(await tick(due + 59_000), []);
});

test("recordatorio repetitivo: solo 10 min antes y se apaga al terminar el tratamiento", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  const minute = Math.floor(Date.now() / MIN) * MIN;
  const r = (await api("/api/reminders", { method: "POST", body: { text: "vitamina", due_at: new Date(minute + 3 * HOUR).toISOString(), repeat_minutes: 1440 } })).data;
  const due = Date.parse(r.due_at);
  assert.deepEqual(await tick(due - 60 * MIN), [], "sin aviso de 1 h en los repetitivos");
  assert.deepEqual(await tick(due - 10 * MIN), [`pre10:${r.id}`]);
  assert.deepEqual(await tick(due), [`reminder:${r.id}`]);
  assert.deepEqual(await tick(due + 1440 * MIN - 10 * MIN), [`pre10:${r.id}`], "vuelve a avisar 10 min antes al día siguiente");
});

test("controles: avisos 24 h, 12 h y 2 h antes, una vez cada uno", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  const minute = Math.floor(Date.now() / MIN) * MIN;
  const at = minute + 30 * HOUR;
  const a = (await api("/api/appointments", { method: "POST", body: { title: "Pediatra", at: new Date(at).toISOString() } })).data;
  assert.deepEqual(await tick(minute), []);
  assert.deepEqual(await tick(at - 24 * HOUR), [`appt24h:${a.id}`]);
  assert.deepEqual(await tick(at - 20 * HOUR), []);
  assert.deepEqual(await tick(at - 12 * HOUR), [`appt12h:${a.id}`]);
  assert.deepEqual(await tick(at - 3 * HOUR), []);
  assert.deepEqual(await tick(at - 2 * HOUR), [`appt2h:${a.id}`]);
  assert.deepEqual(await tick(at - HOUR), []);
  // uno creado para dentro de 5 h solo avisa 2 h antes
  const b = (await api("/api/appointments", { method: "POST", body: { title: "Vacuna", at: new Date(minute + 5 * HOUR).toISOString() } })).data;
  assert.deepEqual(await tick(minute + 2 * HOUR), []);
  assert.deepEqual(await tick(minute + 3 * HOUR), [`appt2h:${b.id}`]);
});

test("✅ Hecho registra la medicina (una sola vez) y ⏰ En 10 min la pospone", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  await tg(`/start ${PIN} Maria`, 2);
  await tg("➕ Más", 1);
  await tgButton("m:rut", 1);
  await tgButton("rt:vitd", 1);
  const m = await tgButton("rth:vitd:1", 1);
  assert.match(m.text, /Rutina creada.*Vitamina D/s);
  const [r] = (await api("/api/reminders")).data;
  assert.equal(r.repeat_minutes, 1440);
  assert.equal(r.action, "medicine:Vitamina D");
  SENT.length = 0;
  await tick(Date.parse(r.due_at));
  const done = kbData(SENT.find((x) => x.chat === "1")).find((d) => d.startsWith("rdone:"));
  const snooze = kbData(SENT.find((x) => x.chat === "1")).find((d) => d.startsWith("rsnz:"));
  assert.match((await tgButton(done, 1)).text, /Hecho.*Juan/s);
  assert.match((await tgButton(done, 2)).text, /Ya lo marcó Juan/);
  const meds = (await api("/api/entries?kind=medicine")).data;
  assert.equal(meds.length, 1);
  assert.match(meds[0].text, /Vitamina D/);
  assert.match((await tgButton(snooze, 2)).text, /de nuevo a las/);
  assert.equal((await api("/api/reminders")).data.length, 2);
});

test("rutina de tummy time crea 3 recordatorios diarios", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  await tgButton("rt:tummy", 1);
  await tgButton("rth:tummy:0", 1);
  const rems = (await api("/api/reminders")).data;
  assert.equal(rems.length, 3);
  assert.ok(rems.every((r) => r.action === "tummy" && r.repeat_minutes === 1440));
});

test("tratamiento con IA: cada 8 h por 7 días", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  await tgButton("rt:course", 1);
  const t = await tg("amoxicilina 2.5 ml cada 8 horas por 7 días desde las 8", 1);
  assert.match(t, /Amoxicilina 2\.5 ml/);
  assert.match(t, /cada 8 h/);
  const [r] = (await api("/api/reminders")).data;
  assert.equal(r.repeat_minutes, 480);
  assert.equal(r.action, "medicine:Amoxicilina 2.5 ml");
  const days = (Date.parse(r.ends_at) - Date.parse(r.due_at)) / (24 * HOUR);
  assert.ok(days > 6.99 && days < 7, String(days));
});

test("notas: anotar, listar, marcar hecha (bot y web)", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  assert.match(await tg("anota: preguntarle a la pediatra por el ombligo", 1), /Anotado/);
  assert.match(await tg("Apunta comprar pañales talla 0", 1), /Anotado/);
  const list = (await tgAll("mis notas", 1)).pop();
  assert.match(list.text, /pediatra por el ombligo/);
  const ndone = kbData(list).find((d) => d.startsWith("nd:"));
  await tgButton(ndone, 1);
  assert.equal((await api("/api/notes")).data.length, 1);
  assert.equal((await api("/api/notes?all=1")).data.length, 2);
  const n = (await api("/api/notes", { method: "POST", body: { text: "llevar el carnet de vacunas" } })).data;
  await api(`/api/notes/${n.id}/done`, { method: "POST" });
  await api(`/api/notes/${n.id}`, { method: "DELETE" });
  assert.equal((await api("/api/notes?all=1")).data.length, 2);
});

test("IA: tummy time + nota en un mensaje; tummy por botón", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  const all = (await tgAll("hizo 5 minutos de tummy time y anota que hay que comprar pañales", 1)).map((m) => m.text).join("\n");
  assert.match(all, /Tummy time · 5 min/);
  assert.match(all, /Anotado.*Comprar pañales/s);
  await tgButton("m:tummy", 1);
  assert.match(await tg("3", 1), /Tummy time · 3 min/);
  assert.equal((await api("/api/entries?kind=tummy")).data.length, 2);
});

test("rutina propia (cualquier texto) y ✅ Hecho la registra en el historial", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  await tgButton("rt:custom", 1);
  assert.match(await tg("masajes con aceite todos los días a las 7 pm", 1), /Listo, les aviso.*todos los días/s);
  const [r] = (await api("/api/reminders")).data;
  assert.equal(r.repeat_minutes, 1440);
  SENT.length = 0;
  await tick(Date.parse(r.due_at));
  const done = kbData(SENT.find((x) => x.chat === "1")).find((d) => d.startsWith("rdone:"));
  assert.match((await tgButton(done, 1)).text, /✨ Masajes con aceite/);
  const [e] = (await api("/api/entries?kind=activity")).data;
  assert.equal(e.text, "✨ Masajes con aceite");
  // sin recordatorio, por IA
  assert.match(await tg("le hice masajes con aceite 10 minutos", 1), /✨ Masajes con aceite · 10 min/);
  // y desde la web
  const w = (await api("/api/entries", { method: "POST", body: { kind: "activity", detail: "Baño de sol", amount: 15 } })).data;
  assert.equal(w.text, "✨ Baño de sol · 15 min");
});

test("Google Calendar automático (script v2) y respaldo con enlace (script viejo)", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  const gs = `http://127.0.0.1:${TG_PORT}/gs`;
  CAL.length = 0;
  GS_VERSION = 2;
  assert.equal((await api("/api/email", { method: "PUT", body: { url: gs, to: ["papa@gmail.com", "mama@gmail.com"] } })).data.script_version, 2);
  const m = (await tgAll("/control 01/12/2027 9:30 Pediatra | Clínica", 1)).pop();
  assert.match(m.text, /Ya está en Google Calendar/);
  assert.ok(!m.kb.inline_keyboard.flat().some((b) => b.url), "sin enlace manual");
  assert.equal(CAL[0].action, "calendar_create");
  assert.deepEqual(CAL[0].guests, ["papa@gmail.com", "mama@gmail.com"]);
  assert.deepEqual(CAL[0].popups, [1440, 720, 120]);
  const [a] = (await api("/api/appointments")).data;
  assert.equal(a.in_calendar, true);
  await api(`/api/appointments/${a.id}`, { method: "DELETE" });
  assert.equal(CAL[1].action, "calendar_delete");
  assert.equal(CAL[1].id, "ev1");
  // script viejo: queda el botón para agregarlo a mano
  GS_VERSION = 1;
  await api("/api/email", { method: "PUT", body: { url: gs, to: ["papa@gmail.com"] } });
  const m2 = (await tgAll("/control 02/12/2027 9:30 Vacuna", 1)).pop();
  assert.ok(m2.kb.inline_keyboard.flat().some((b) => b.url), "con enlace manual");
  GS_VERSION = 2;
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

test("correo: configurar, validar y probar", async () => {
  const g = (await api("/api/email")).data;
  assert.equal(g.configured, false);
  assert.match(g.script, /const CLAVE = "[0-9a-f]{32}"/);
  assert.equal((await api("/api/email", { method: "PUT", body: { url: "https://evil.example/x", to: ["a@b.co"] } })).status, 422);
  assert.equal((await api("/api/email", { method: "PUT", body: { url: null, to: ["no-es-correo"] } })).status, 422);
  const id = "AKfycbx1234567890abcdefghijklmnop_-XYZ";
  for (const u of [id, `https://script.google.com/a/macros/colegio.edu.co/s/${id}/exec`, ` script.google.com/macros/s/${id}/dev?x=1 `]) {
    assert.equal((await api("/api/email", { method: "PUT", body: { url: u, to: [] } })).status, 200, u);
  }
  assert.equal((await api("/api/email")).data.url, `https://script.google.com/macros/s/${id}/exec`);
  assert.equal((await api("/api/email", { method: "PUT", body: { url: "https://script.google.com/home/projects/1abc/edit", to: [] } })).status, 422);
  const gs = `http://127.0.0.1:${TG_PORT}/gs`;
  assert.equal((await api("/api/email", { method: "PUT", body: { url: gs, to: ["Papa@Gmail.com", "mama@gmail.com"], opts: {} } })).status, 200);
  EMAILS.length = 0;
  assert.equal((await api("/api/email/test", { method: "POST" })).status, 200);
  assert.equal(EMAILS.length, 1);
  assert.deepEqual(EMAILS[0].to, ["papa@gmail.com", "mama@gmail.com"]);
  assert.equal(EMAILS[0].key, g.script.match(/CLAVE = "(\w+)"/)[1]);
  assert.match(EMAILS[0].html, /Tasky/);
});

test("correo: recordatorios, controles y resumen diario", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  const gs = `http://127.0.0.1:${TG_PORT}/gs`;
  await api("/api/email", { method: "PUT", body: { url: gs, to: ["papa@gmail.com"], opts: { summary_hour: 0, feed: false } } });
  await api("/api/reminders", { method: "POST", body: { text: "vitamina D", due_at: iso(MIN) } });
  const at = Math.floor(Date.now() / MIN) * MIN + 26 * HOUR;
  await api("/api/appointments", { method: "POST", body: { title: "Pediatra", at: new Date(at).toISOString() } });
  EMAILS.length = 0;
  await tick();
  await tick(at - 24 * HOUR);
  const subjects = EMAILS.map((e) => e.subject);
  assert.ok(subjects.some((x) => x.includes("Recordatorio: vitamina D")), subjects.join(" | "));
  assert.ok(subjects.some((x) => x.includes("Control en")), subjects.join(" | "));
  assert.ok(subjects.some((x) => x.startsWith("📋 Resumen de Aurora")), subjects.join(" | "));
  EMAILS.length = 0;
  await tick();
  await tick(at - 23 * HOUR);
  assert.equal(EMAILS.length, 0, "el resumen sale una sola vez al día");
  // categoría desactivada: no manda correo (pero Telegram sí)
  await api("/api/email", { method: "PUT", body: { url: gs, to: ["papa@gmail.com"], opts: { reminders: false, summary: false } } });
  await api("/api/reminders", { method: "POST", body: { text: "solo telegram", due_at: iso(MIN) } });
  SENT.length = 0;
  await tick();
  assert.equal(EMAILS.length, 0);
  assert.ok(SENT.some((m) => m.text.includes("solo telegram")));
});

test("control trae botón de Google Calendar (bot y web)", async () => {
  await tg(`/start ${PIN} Juan`, 1);
  await tg("/control 01/12/2027 9:30 Pediatra | Clínica", 1);
  const m = SENT[SENT.length - 1];
  const urlBtn = m.kb.inline_keyboard.flat().find((b) => b.url);
  assert.match(urlBtn.url, /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);
  assert.match(decodeURIComponent(urlBtn.url), /dates=20271201T143000Z\/20271201T153000Z/);
  const [a] = (await api("/api/appointments")).data;
  assert.match(a.calendar_url, /calendar\.google\.com/);
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
