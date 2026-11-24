/** Bot de Telegram: el asistente de la familia. */

import { App, Caregiver, escapeHtml as esc } from "./logic";
import { tgCall, tgSend, type Keyboard } from "./tg";
import * as T from "./time";

export const COMMANDS: [string, string][] = [
  ["estado", "Resumen: última comida, sueño, pañal"],
  ["menu", "Botones rápidos"],
  ["comida", "Biberón: /comida 30 (ml)"],
  ["pecho", "Pecho: /pecho izq 15 (min)"],
  ["dormir", "Se durmió (o /dormir 14:30)"],
  ["desperto", "Se despertó"],
  ["sueno", "Sueño pasado: /sueno 13:00 14:30"],
  ["panal", "Pañal: /panal pipi | popo | ambos"],
  ["bano", "Baño"],
  ["medicina", "Medicina: /medicina Vitamina D"],
  ["temp", "Temperatura: /temp 37.2"],
  ["peso", "Peso: /peso 3.4"],
  ["nota", "Nota libre"],
  ["hoy", "Registros de hoy"],
  ["recordar", "Recordatorio: /recordar 30m vitamina"],
  ["control", "Control médico: /control 01/12 9:00 Pediatra"],
  ["agenda", "Controles y recordatorios"],
  ["deshacer", "Borra tu último registro"],
  ["avisos", "Activar/desactivar avisos de lo que registra el otro"],
  ["ayuda", "Cómo usar el bot"],
];

type Reply = [string, Keyboard | null];

function helpText(app: App): string {
  return `<b>👶 Asistente de ${esc(app.babyName)}</b>

Toca /menu para los botones rápidos o usa comandos:

🍼 /comida 30 — biberón de 30 ml
🤱 /pecho izq 15 — pecho izquierdo 15 min
😴 /dormir y /desperto · sueño pasado: /sueno 13:00 14:30
🧷 /panal pipi · /panal popo · /panal ambos
🛁 /bano · 💊 /medicina Paracetamol · 🌡️ /temp 37.2 · ⚖️ /peso 3.4
📝 /nota lo que quieras

<b>Registrar algo que ya pasó:</b> agrega la hora al final o "hace":
/comida 20 hace 20m · /panal popo 14:10 · /dormir 13:45

⏰ /recordar 30m vitamina D
⏰ /recordar cada 3h dar pecho
⏰ /recordar mañana 8:00 llamar al pediatra
📅 /control 01/12 9:30 Control pediatra | Clínica X
📋 /estado · /hoy · /agenda · /deshacer

<b>También puedes escribir sin "/":</b>
<i>popó</i> · <i>pipí</i> · <i>ambos</i> · <i>tetero 30</i> · <i>30 ml</i> · <i>pecho izq</i> ·
<i>se durmió</i> · <i>se despertó</i> · <i>baño</i> · <i>estado</i>`;
}

async function menuKeyboard(app: App): Promise<Keyboard> {
  const sleeping = (await app.activeSleep()) !== null;
  return [
    [{ text: "🍼 Biberón", callback_data: "feed:biberon" },
      { text: "🤱 Pecho izq", callback_data: "log:feed:pecho_izq" },
      { text: "🤱 Pecho der", callback_data: "log:feed:pecho_der" }],
    [{ text: sleeping ? "😊 Se despertó" : "😴 Se durmió", callback_data: "sleep" }],
    [{ text: "💧 Pipí", callback_data: "log:diaper:pipi" },
      { text: "💩 Popó", callback_data: "log:diaper:popo" },
      { text: "💧💩 Ambos", callback_data: "log:diaper:ambos" }],
    [{ text: "🛁 Baño", callback_data: "log:bath:" },
      { text: "📊 Estado", callback_data: "status" },
      { text: "📋 Hoy", callback_data: "today" }],
    [{ text: "📅 Agenda", callback_data: "agenda" },
      { text: "❓ Ayuda", callback_data: "help" }],
  ];
}

export function mlKeyboard(): Keyboard {
  // Recién nacido: ~5-7 ml el día 1, ~20-30 ml el día 3, ~45-60 ml a la semana.
  const vals = [5, 10, 15, 20, 30, 45, 60, 90];
  return [
    vals.slice(0, 4).map((v) => ({ text: `${v} ml`, callback_data: `ml:${v}` })),
    vals.slice(4).map((v) => ({ text: `${v} ml`, callback_data: `ml:${v}` })),
    [{ text: "Sin medir", callback_data: "ml:0" }, { text: "↩️ Menú", callback_data: "menu" }],
  ];
}

// ------------------------------------------------------------------ helpers

const AGO = /\bhace\s+(\S+)\s*$/i;
const AT = /\b(?:a las\s+)?(\d{1,2}:\d{2})\s*$/i;

/** Saca 'hace 20m' o '14:10' del final del texto. */
export function splitTime(app: App, text: string): [string, number | null] {
  text = text.trim();
  let m = text.match(AGO);
  if (m) {
    const mins = T.parseDur(m[1]);
    if (mins) return [text.slice(0, m.index).trim(), app.now() - mins * T.MIN];
  }
  m = text.match(AT);
  if (m) {
    const hm = T.parseHHMM(m[1]);
    if (hm) {
      const nowN = T.toNaive(app.now(), app.tz);
      let at = T.setHM(nowN, hm[0], hm[1]);
      if (at > nowN + 5 * T.MIN) at -= T.DAY; // "23:50" dicho a las 00:10 -> ayer
      return [text.slice(0, m.index).trim(), T.fromNaive(at, app.tz)];
    }
  }
  return [text, null];
}

export function toFloat(tok: string | undefined): number | null {
  if (tok == null || !/^\d+(?:[.,]\d+)?$/.test(tok.trim())) return null;
  const v = Number(tok.replace(",", "."));
  return Number.isFinite(v) && v >= 0 ? v : null;
}

const words = (s: string) => s.split(/\s+/).filter(Boolean);

async function getCaregiver(app: App, chatId: string): Promise<Caregiver | null> {
  return app.db.prepare("SELECT * FROM caregivers WHERE chat_id = ?").bind(chatId).first<Caregiver>();
}

async function log(app: App, cg: Caregiver, chatId: string, kind: string, o: Parameters<App["createEntry"]>[2] = {}) {
  const e = await app.createEntry(kind, cg.name, o);
  await app.notifyEntry(e, "registró", chatId);
  return `✅ ${esc(app.describe(e))} — ${app.fmtTime(e.start_at)}`;
}

async function sleepCmd(app: App, cg: Caregiver, chatId: string, want: "sleep" | "wake" | null, at?: number | null) {
  const current = await app.activeSleep();
  if (want === "sleep" && current) return `Ya está durmiendo desde ${app.fmtTime(current.start_at)}. ¿Se despertó? /desperto`;
  if (want === "wake" && !current) return "No hay un sueño en curso. Para registrar que se durmió: /dormir";
  const [e, slept] = await app.toggleSleep(cg.name, at);
  if (slept) {
    await app.notifyEntry(e, "registró que se durmió", chatId);
    return `😴 Se durmió a las ${app.fmtTime(e.start_at)}. Dulces sueños 🌙`;
  }
  await app.notifyEntry(e, "registró que se despertó", chatId);
  return `😊 Se despertó. Durmió ${T.fmtDur((e.end_at! - e.start_at) / 1000)}`;
}

/** /sueno 13:00 14:30  ó  /sueno 13:00 1h30m */
async function pastSleep(app: App, cg: Caregiver, chatId: string, args: string): Promise<string> {
  const toks = words(args);
  const usage = "Ejemplo: /sueno 13:00 14:30 (inicio y fin) o /sueno 13:00 1h30m";
  const hm = toks.length >= 2 ? T.parseHHMM(toks[0]) : null;
  if (!hm) return usage;
  const nowN = Math.floor(T.toNaive(app.now(), app.tz) / T.MIN) * T.MIN;
  let start = T.setHM(nowN, hm[0], hm[1]);
  if (start > nowN) start -= T.DAY;
  let end: number;
  const hm2 = T.parseHHMM(toks[1]);
  const mins = hm2 ? null : T.parseDur(toks[1]);
  if (hm2) {
    end = T.setHM(start, hm2[0], hm2[1]);
    if (end <= start) end += T.DAY;
  } else if (mins) {
    end = start + mins * T.MIN;
  } else return usage;
  if (end > nowN + T.MIN) return "Ese sueño termina en el futuro. Si está durmiendo ahora usa /dormir 13:00";
  return log(app, cg, chatId, "sleep", {
    start: T.fromNaive(start, app.tz), end: T.fromNaive(end, app.tz), note: toks.slice(2).join(" ") || null,
  });
}

// ------------------------------------------------------------------ texto libre (sin "/")

export function norm(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/[¡!¿?.,;]+/g, " ").replace(/\s+/g, " ").trim();
}

const TIME_SUFFIX = /^(.*?)((?:\s+hace\s+\S+)|(?:\s+(?:a las\s+)?\d{1,2}:\d{2}))?$/;
const PLAIN: Record<string, [string, string]> = {
  "pipi": ["panal", "pipi"], "pis": ["panal", "pipi"], "orino": ["panal", "pipi"],
  "popo": ["panal", "popo"], "caca": ["panal", "popo"], "popis": ["panal", "popo"],
  "ambos": ["panal", "ambos"], "pipi y popo": ["panal", "ambos"], "popo y pipi": ["panal", "ambos"],
  "durmio": ["dormir", ""], "se durmio": ["dormir", ""], "dormida": ["dormir", ""], "a dormir": ["dormir", ""],
  "desperto": ["desperto", ""], "se desperto": ["desperto", ""], "desperte": ["desperto", ""],
  "bano": ["bano", ""], "se bano": ["bano", ""], "banada": ["bano", ""],
  "estado": ["estado", ""], "resumen": ["estado", ""], "como va": ["estado", ""], "como esta": ["estado", ""],
  "hoy": ["hoy", ""], "agenda": ["agenda", ""], "menu": ["menu", ""], "ayuda": ["ayuda", ""],
  "deshacer": ["deshacer", ""],
};
const ML = /^(?:(?:tomo|comio)\s+)?(?:biberon|tetero|formula|leche|toma)?\s*(\d+(?:[.,]\d+)?)\s*(?:ml)?$/;
const ML_WORD = /^(?:(?:tomo|comio)\s+)?(biberon|tetero|formula|leche|toma)$/;
const BREAST = /^(?:dio\s+|tomo\s+)?(?:pecho|teta|seno)\s+(izq\S*|der\S*)(?:\s+(\d+)\s*(?:m|min|minutos)?)?$/;

/** 'popó hace 10m' -> ['panal', 'popo hace 10m']. null si no lo entiende. */
export function plainToCommand(text: string): [string, string] | null {
  const m = norm(text).match(TIME_SUFFIX)!;
  const base = m[1].trim();
  const suffix = m[2] ?? "";
  if (PLAIN[base]) {
    const [cmd, args] = PLAIN[base];
    return [cmd, (args + suffix).trim()];
  }
  const mm = base.match(ML);
  if (mm && (base.includes("ml") || !/^[\d.,]+$/.test(base))) {
    return [base.includes("formula") ? "formula" : "comida", (mm[1] + suffix).trim()];
  }
  if (ML_WORD.test(base)) return ["comida", suffix.trim()];
  const mb = base.match(BREAST);
  if (mb) return ["pecho", `${mb[1].startsWith("izq") ? "izq" : "der"} ${mb[2] ?? ""}${suffix}`.replace(/\s+/g, " ").trim()];
  return null;
}

// ------------------------------------------------------------------ comandos

export async function handleCommand(app: App, cg: Caregiver, chatId: string, cmd: string, args: string): Promise<Reply> {
  const [a, at] = splitTime(app, args);
  const start = at ?? undefined;
  const toks = words(a);

  switch (cmd) {
    case "menu": case "start":
      return ["¿Qué registramos?", await menuKeyboard(app)];
    case "estado": case "resumen": case "status":
      return [await app.statusText(), await menuKeyboard(app)];
    case "hoy":
      return [await app.todayText(), null];
    case "ayuda": case "help":
      return [helpText(app), null];

    case "comida": case "biberon": case "formula": {
      if (!toks.length) return ["🍼 ¿Cuántos ml?", mlKeyboard()];
      const ml = toFloat(toks[0]);
      const note = (ml !== null ? toks.slice(1) : toks).join(" ") || null;
      return [await log(app, cg, chatId, "feed", {
        detail: cmd === "formula" ? "formula" : "biberon", amount: ml || null, note, start,
      }), null];
    }
    case "pecho": {
      let side: string | null = null;
      const rest = [...toks];
      if (rest.length && ["izq", "der"].includes(rest[0].toLowerCase().slice(0, 3))) {
        side = rest.shift()!.toLowerCase().startsWith("izq") ? "pecho_izq" : "pecho_der";
      }
      if (!side) {
        return ["¿Qué lado?", [[{ text: "🤱 Izquierdo", callback_data: "log:feed:pecho_izq" },
          { text: "🤱 Derecho", callback_data: "log:feed:pecho_der" }]]];
      }
      const mins = toFloat(rest[0]);
      if (mins !== null) rest.shift();
      return [await log(app, cg, chatId, "feed", { detail: side, amount: mins, note: rest.join(" ") || null, start }), null];
    }
    case "dormir": case "durmio": case "dormida":
      return [await sleepCmd(app, cg, chatId, "sleep", at), await menuKeyboard(app)];
    case "desperto": case "despertar": case "despierta":
      return [await sleepCmd(app, cg, chatId, "wake", at), await menuKeyboard(app)];
    case "sueno": case "sueño": case "siesta":
      return [await pastSleep(app, cg, chatId, args), null];

    case "panal": case "pañal": case "pipi": case "popo": {
      let det = cmd === "pipi" || cmd === "popo" ? cmd : norm(toks[0] ?? "");
      det = ({ caca: "popo", ambas: "ambos", los2: "ambos" } as Record<string, string>)[det] ?? det;
      if (!["pipi", "popo", "ambos"].includes(det)) {
        return ["¿Qué tenía?", [[{ text: "💧 Pipí", callback_data: "log:diaper:pipi" },
          { text: "💩 Popó", callback_data: "log:diaper:popo" },
          { text: "💧💩 Ambos", callback_data: "log:diaper:ambos" }]]];
      }
      const rest = (cmd === "panal" || cmd === "pañal" ? toks.slice(1) : toks).join(" ");
      return [await log(app, cg, chatId, "diaper", { detail: det, note: rest || null, start }), null];
    }
    case "bano": case "baño":
      return [await log(app, cg, chatId, "bath", { note: a || null, start }), null];
    case "medicina":
      if (!a) return ["Escribe el nombre: /medicina Vitamina D", null];
      return [await log(app, cg, chatId, "medicine", { detail: a.slice(0, 80), start }), null];
    case "temp": {
      const v = toFloat(toks[0]);
      if (v === null || v < 30 || v > 45) return ["Ejemplo: /temp 37.2", null];
      let msg = await log(app, cg, chatId, "temp", { amount: v, start });
      if (v >= 38) msg += "\n⚠️ 38 °C o más en un recién nacido: llamen al pediatra o vayan a urgencias.";
      return [msg, null];
    }
    case "peso": {
      const v = toFloat(toks[0]);
      if (v === null || v < 0.5 || v > 40) return ["Ejemplo: /peso 3.4 (kg)", null];
      return [await log(app, cg, chatId, "weight", { amount: v, start }), null];
    }
    case "nota":
      if (!args) return ["Ejemplo: /nota hoy estuvo muy tranquila", null];
      return [await log(app, cg, chatId, "note", { note: args.slice(0, 2000) }), null];

    case "recordar": {
      let parsed;
      try { parsed = app.parseWhen(args); } catch (e) { return [`❌ ${esc((e as Error).message)}`, null]; }
      const [due, repeat, text] = parsed;
      if (!text) return ["Falta qué recordar. Ej: /recordar 30m vitamina D", null];
      const r = await app.db.prepare(
        "INSERT INTO reminders (text, due_at, repeat_minutes, active, author) VALUES (?, ?, ?, 1, ?) RETURNING id, text",
      ).bind(text.slice(0, 200), due, repeat, cg.name).first<{ id: number; text: string }>();
      const rep = repeat ? `, y luego ${app.repeatLabel(repeat)}` : "";
      return [`⏰ Listo, les aviso ${app.fmtTime(due)}${rep}: ${esc(r!.text)}\n(cancelar: /borrar_recordatorio ${r!.id})`, null];
    }
    case "borrar_recordatorio": case "cancelar": {
      const id = /^\d+$/.test(a) ? Number(a) : null;
      const r = id ? await app.db.prepare("SELECT text FROM reminders WHERE id = ?").bind(id).first<{ text: string }>() : null;
      if (!r) return ["Indica el número: /borrar_recordatorio 3 (míralo en /agenda)", null];
      await app.db.prepare("UPDATE reminders SET active = 0 WHERE id = ?").bind(id).run();
      return [`🗑️ Recordatorio cancelado: ${esc(r.text)}`, null];
    }
    case "control": {
      let parsed;
      try { parsed = app.parseWhen(args, false); } catch (e) {
        return [`❌ ${esc((e as Error).message)}\nEj: /control 01/12 9:30 Pediatra | Clínica X`, null];
      }
      const [when, , text] = parsed;
      if (!text) return ["Falta el título. Ej: /control 01/12 9:30 Pediatra | Clínica X", null];
      const [title, ...placeParts] = text.split("|");
      const place = placeParts.join("|").trim().slice(0, 160) || null;
      const t = title.trim().slice(0, 120);
      await app.db.prepare("INSERT INTO appointments (title, at, place, author) VALUES (?, ?, ?, ?)")
        .bind(t, when, place, cg.name).run();
      await app.broadcast(`📅 ${esc(cg.name)} agendó: ${esc(t)} — ${app.fmtTime(when)}`, { excludeChat: chatId, onlySubscribed: true });
      return [`📅 Agendado: ${esc(t)} — ${app.fmtTime(when)}. Les recuerdo 24 h y 2 h antes.`, null];
    }
    case "agenda":
      return [await app.agendaText(), null];
    case "deshacer": {
      const e = await app.db.prepare("SELECT * FROM entries WHERE author = ? ORDER BY created_at DESC LIMIT 1")
        .bind(cg.name).first<any>();
      if (!e || app.now() - e.created_at > T.HOUR) return ["No hay registros tuyos de la última hora para deshacer.", null];
      await app.db.prepare("DELETE FROM entries WHERE id = ?").bind(e.id).run();
      return [`↩️ Borrado: ${esc(app.describe(e))}`, null];
    }
    case "avisos": {
      const on = cg.notify_others ? 0 : 1;
      await app.db.prepare("UPDATE caregivers SET notify_others = ? WHERE id = ?").bind(on, cg.id).run();
      return [on ? "🔔 Te aviso cuando alguien más registre algo."
        : "🔕 Ya no te aviso de los registros de otros (los recordatorios siguen llegando).", null];
    }
  }
  return ["No conozco ese comando. Mira /ayuda", null];
}

// ------------------------------------------------------------------ botones

async function handleCallback(app: App, cg: Caregiver, chatId: string, data: string): Promise<Reply> {
  if (data === "menu") return ["¿Qué registramos?", await menuKeyboard(app)];
  if (data === "status") return [await app.statusText(), await menuKeyboard(app)];
  if (data === "today") return [await app.todayText(), null];
  if (data === "agenda") return [await app.agendaText(), null];
  if (data === "help") return [helpText(app), null];
  if (data === "sleep") return [await sleepCmd(app, cg, chatId, null), await menuKeyboard(app)];
  if (data === "feed:biberon") return ["🍼 ¿Cuántos ml?", mlKeyboard()];
  if (data.startsWith("ml:")) {
    const ml = toFloat(data.slice(3)) || null;
    return [await log(app, cg, chatId, "feed", { detail: "biberon", amount: ml }), await menuKeyboard(app)];
  }
  const parts = data.split(":");
  if (parts.length === 3 && parts[0] === "log" && ["feed", "diaper", "bath"].includes(parts[1])) {
    return [await log(app, cg, chatId, parts[1], { detail: parts[2] || null }), await menuKeyboard(app)];
  }
  return ["🤔", null];
}

// ------------------------------------------------------------------ vincular con PIN

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
export { timingSafeEqual };

async function link(app: App, chatId: string, args: string, firstName: string): Promise<string> {
  const toks = words(args);
  const hello = "👋 Hola. Para vincularte escribe:\n<code>/start PIN TuNombre</code>\n(el PIN familiar lo tienen papá y mamá)";
  if (!toks.length) return hello;
  const key = "tg:" + chatId;
  if (await app.pinBlocked([[key, 5], ["bot", 20]])) return "⛔ Demasiados intentos. Espera 15 minutos.";
  if (!timingSafeEqual(toks[0], app.env.FAMILY_PIN)) {
    await app.pinFail([key, "bot"]);
    return "❌ PIN incorrecto.\n\n" + hello;
  }
  const name = (toks.slice(1).join(" ") || firstName || "Familia").slice(0, 60);
  await app.db.prepare("INSERT INTO caregivers (name, chat_id) VALUES (?, ?) ON CONFLICT(chat_id) DO UPDATE SET name = excluded.name")
    .bind(name, chatId).run();
  await app.broadcast(`👋 ${esc(name)} se unió al asistente de ${esc(app.babyName)}.`, { excludeChat: chatId });
  return `🎉 ¡Listo, ${esc(name)}! Ya estás vinculado/a.\n\n` + helpText(app);
}

// ------------------------------------------------------------------ entrada

function chatOf(update: any): string | null {
  const id = update?.callback_query?.message?.chat?.id ?? update?.message?.chat?.id;
  return id == null ? null : String(id);
}

export async function handleUpdate(app: App, update: any): Promise<void> {
  try {
    await handle(app, update);
  } catch (e) {
    console.error("Error en el bot", e);
    const chat = chatOf(update);
    if (chat) await tgSend(app.env, chat, "😕 Algo falló con ese mensaje. Intenta de nuevo o usa /menu.");
  }
}

async function handle(app: App, update: any): Promise<void> {
  const cb = update?.callback_query;
  if (cb) {
    if (!cb.message) return;
    const chatId = String(cb.message.chat.id);
    await tgCall(app.env, "answerCallbackQuery", { callback_query_id: cb.id });
    const cg = await getCaregiver(app, chatId);
    if (!cg) {
      await tgSend(app.env, chatId, "Primero vincúlate: /start PIN TuNombre");
      return;
    }
    const [text, kb] = await handleCallback(app, cg, chatId, String(cb.data ?? ""));
    await tgSend(app.env, chatId, text, kb);
    return;
  }

  const msg = update?.message;
  if (!msg || typeof msg.text !== "string") return;
  const chatId = String(msg.chat.id);
  const text = msg.text.trim();
  const firstName = msg.from?.first_name ?? "";
  const cg = await getCaregiver(app, chatId);

  if (!text.startsWith("/")) {
    if (!cg) {
      await tgSend(app.env, chatId, await link(app, chatId, "", firstName));
      return;
    }
    const parsed = plainToCommand(text);
    if (!parsed) {
      await tgSend(app.env, chatId, "No te entendí 🙈 Toca un botón, o usa /nota para guardar texto.", await menuKeyboard(app));
      return;
    }
    const [reply, kb] = await handleCommand(app, cg, chatId, parsed[0], parsed[1]);
    await tgSend(app.env, chatId, reply, kb);
    return;
  }

  const space = text.indexOf(" ");
  const head = space < 0 ? text.slice(1) : text.slice(1, space);
  const args = space < 0 ? "" : text.slice(space + 1).trim();
  const cmd = head.split("@")[0].toLowerCase();

  if (!cg) {
    await tgSend(app.env, chatId, await link(app, chatId, cmd === "start" ? args : "", firstName));
    return;
  }
  if (cmd === "start" && !args) {
    await tgSend(app.env, chatId, helpText(app), await menuKeyboard(app));
    return;
  }
  const [reply, kb] = await handleCommand(app, cg, chatId, cmd, args);
  await tgSend(app.env, chatId, reply, kb);
}

export async function setupWebhook(app: App, origin: string, secret: string) {
  const res = await tgCall(app.env, "setWebhook", {
    url: `${origin}/telegram/webhook`, secret_token: secret, allowed_updates: ["message", "callback_query"],
  });
  await tgCall(app.env, "setMyCommands", { commands: COMMANDS.map(([command, description]) => ({ command, description })) });
  if (res?.ok) await app.kvSet("webhook_url", `${origin}/telegram/webhook`);
  return res;
}
