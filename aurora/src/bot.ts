/**
 * Tasky: el bot de Telegram de la familia.
 *
 * Cómo entiende los mensajes, en orden (lo barato primero):
 *  1. Botones del teclado fijo y botones inline.
 *  2. Respuesta a una pregunta pendiente ("¿cuántos ml?" -> "5").
 *  3. Frases simples conocidas ("popó", "tetero 5", "se durmió").
 *  4. Comandos con "/" (siguen funcionando).
 *  5. Todo lo demás: IA (Workers AI) -> acciones. También notas de voz.
 */

import { aiEnabled, answer, interpret, transcribe, type Action } from "./ai";
import { googleCalendarUrl } from "./email";
import { App, Caregiver, Entry, escapeHtml as esc } from "./logic";
import { tgCall, tgDownload, tgEdit, tgSend, type Keyboard, type Markup } from "./tg";
import * as T from "./time";

type Reply = [string, Markup];

// ------------------------------------------------------------------ teclados

export const BTN = {
  feed: "🍼 Tetero",
  breast: "🤱 Pecho",
  sleep: "😴 Sueño",
  diaper: "🧷 Pañal",
  status: "📊 ¿Cómo va?",
  more: "➕ Más",
};

/** Teclado fijo abajo (reemplaza al teclado del celular cuando se toca el ícono). */
export const MAIN_KB = {
  keyboard: [
    [{ text: BTN.feed }, { text: BTN.breast }],
    [{ text: BTN.sleep }, { text: BTN.diaper }],
    [{ text: BTN.status }, { text: BTN.more }],
  ],
  resize_keyboard: true,
  is_persistent: true,
  input_field_placeholder: "Escribe o dicta: «tomó 5 ml», «hizo popó»…",
};

// Recién nacido: ~2-7 ml el día 1, ~15-30 ml el día 3, ~45-60 ml a la semana. Cualquier otra cantidad: se escribe.
const ML = [2, 3, 5, 7, 10, 15, 20, 30, 45, 60];

export function mlKeyboard(detail: "biberon" | "formula" = "biberon"): Keyboard {
  const b = (v: number) => ({ text: `${v} ml`, callback_data: `ml:${detail}:${v}` });
  return [
    [{ text: (detail === "biberon" ? "✅ " : "") + "Leche materna", callback_data: "mlk:biberon" },
      { text: (detail === "formula" ? "✅ " : "") + "Fórmula", callback_data: "mlk:formula" }],
    ML.slice(0, 5).map(b),
    ML.slice(5).map(b),
    [{ text: "Sin medir", callback_data: `ml:${detail}:0` }, { text: "✖️ Cancelar", callback_data: "cancel" }],
  ];
}

function breastSideKeyboard(): Keyboard {
  return [
    [{ text: "⬅️ Izquierdo", callback_data: "br:izq" }, { text: "Derecho ➡️", callback_data: "br:der" }],
    [{ text: "↔️ Ambos", callback_data: "br:ambos" }, { text: "✖️ Cancelar", callback_data: "cancel" }],
  ];
}

function breastMinKeyboard(side: string): Keyboard {
  const b = (v: number) => ({ text: `${v} min`, callback_data: `bm:${side}:${v}` });
  return [
    [5, 10, 15, 20].map(b),
    [25, 30, 40].map(b),
    [{ text: "Sin contar", callback_data: `bm:${side}:0` }, { text: "✖️ Cancelar", callback_data: "cancel" }],
  ];
}

function diaperKeyboard(): Keyboard {
  return [
    [{ text: "💧 Pipí", callback_data: "dp:pipi" }, { text: "💩 Popó", callback_data: "dp:popo" }],
    [{ text: "💧💩 Las dos", callback_data: "dp:ambos" }, { text: "✖️ Cancelar", callback_data: "cancel" }],
  ];
}

function moreKeyboard(): Keyboard {
  return [
    [{ text: "📝 Notas", callback_data: "m:notes" }, { text: "🗓️ Rutinas", callback_data: "m:rut" }],
    [{ text: "⏰ Recordatorio", callback_data: "m:rem" }, { text: "🩺 Control médico", callback_data: "m:appt" }],
    [{ text: "🛁 Baño", callback_data: "m:bath" }, { text: "🧸 Tummy time", callback_data: "m:tummy" }],
    [{ text: "💊 Medicina", callback_data: "m:med" }, { text: "🌡️ Temperatura", callback_data: "m:temp" }],
    [{ text: "⚖️ Peso", callback_data: "m:weight" }, { text: "📋 Hoy", callback_data: "m:today" }],
    [{ text: "📅 Agenda", callback_data: "m:agenda" }, { text: "❓ Ayuda", callback_data: "m:help" }],
  ];
}

function tummyKeyboard(): Keyboard {
  const b = (v: number) => ({ text: `${v} min`, callback_data: `tm:${v}` });
  return [[2, 3, 5, 10, 15].map(b), [{ text: "Sin contar", callback_data: "tm:0" }, { text: "✖️ Cancelar", callback_data: "cancel" }]];
}

// ---------------- rutinas de bebé (recordatorios repetitivos listos)

type Routine = { label: string; text: string; repeat: number; action: string | null; options: [string, string[]][] };
export const ROUTINES: Record<string, Routine> = {
  vitd: { label: "💊 Vitamina D diaria", text: "💊 Darle la vitamina D", repeat: 1440, action: "medicine:Vitamina D",
    options: [["7:00", ["07:00"]], ["8:00", ["08:00"]], ["9:00", ["09:00"]], ["12:00", ["12:00"]], ["20:00", ["20:00"]]] },
  tummy: { label: "🧸 Tummy time 3 veces al día", text: "🧸 Tummy time (boca abajo, despierta y vigilada)", repeat: 1440, action: "tummy",
    options: [["10 · 14 · 18 h", ["10:00", "14:00", "18:00"]], ["9 · 13 · 17 h", ["09:00", "13:00", "17:00"]], ["11 · 15 · 19 h", ["11:00", "15:00", "19:00"]]] },
  bath: { label: "🛁 Baño cada 2 días", text: "🛁 Hora del baño", repeat: 2880, action: "bath",
    options: [["9:00", ["09:00"]], ["11:00", ["11:00"]], ["17:00", ["17:00"]], ["19:00", ["19:00"]]] },
  cord: { label: "🩹 Revisar ombliguito 2 veces al día", text: "🩹 Revisar el ombliguito (limpio y seco, según indique el pediatra)", repeat: 1440, action: null,
    options: [["8 · 20 h", ["08:00", "20:00"]], ["9 · 21 h", ["09:00", "21:00"]]] },
};

function routinesKeyboard(): Keyboard {
  return [
    ...Object.entries(ROUTINES).map(([k, r]) => [{ text: r.label, callback_data: `rt:${k}` }]),
    [{ text: "💊 Tratamiento (antibiótico, etc.)", callback_data: "rt:course" }],
    [{ text: "✖️ Cerrar", callback_data: "cancel" }],
  ];
}

async function notesKeyboard(app: App): Promise<Keyboard> {
  const notes = await app.listNotes(false, 15);
  const rows: Keyboard = notes.map((n, i) => [{ text: `✅ ${i + 1}. ${n.text.slice(0, 40)}${n.text.length > 40 ? "…" : ""}`, callback_data: `nd:${n.id}` }]);
  rows.push([{ text: "➕ Nueva nota", callback_data: "m:note" }]);
  return rows;
}

/** Botones de corrección debajo de cada registro. */
function afterKeyboard(ids: number[], allowShift = true): Keyboard {
  const key = ids.join(",");
  const rows: Keyboard = [[{ text: ids.length > 1 ? "↩️ Deshacer todo" : "↩️ Deshacer", callback_data: `undo:${key}` }]];
  if (allowShift && ids.length === 1) {
    rows.push([10, 30, 60].map((m) => ({ text: `🕐 Fue hace ${m < 60 ? m + " min" : "1 h"}`, callback_data: `ago:${key}:${m}` })));
  }
  return rows;
}

// ------------------------------------------------------------------ textos

export const COMMANDS: [string, string][] = [
  ["menu", "Mostrar los botones"],
  ["estado", "¿Cómo va? Última comida, sueño, pañal"],
  ["hoy", "Todo lo de hoy"],
  ["agenda", "Controles y recordatorios"],
  ["notas", "Mis notas pendientes"],
  ["rutinas", "Vitamina D, tummy time, baño, tratamientos"],
  ["deshacer", "Borrar mi último registro"],
  ["avisos", "Activar/desactivar avisos de lo que registra el otro"],
  ["ayuda", "Cómo usar a Tasky"],
];

function helpText(app: App): string {
  const ai = aiEnabled(app.env);
  return `<b>👋 Soy Tasky, el asistente de ${esc(app.babyName)}</b>

Usa los <b>botones de abajo</b> ⬇️ o ${ai ? "<b>escríbeme o mándame un audio</b> como le hablarías a alguien" : "escríbeme frases cortas"}:

${ai ? `<i>«le di 5 ml de fórmula hace 20 minutos»</i>
<i>«tomó pecho izquierdo 15 minutos y luego hizo popó»</i>
<i>«se durmió a las 3 y se despertó hace un rato»</i>
<i>«pesó 3200 gramos»</i> · <i>«tiene 37,5 de temperatura»</i>
<i>«recuérdame la vitamina D todos los días a las 8»</i>
<i>«el control con la pediatra es el 2 de diciembre a las 10:30»</i>
<i>«amoxicilina 2.5 ml cada 8 horas por 7 días desde las 8»</i>
<i>«anota: preguntarle a la pediatra por el ombligo»</i>
<i>«hizo 5 minutos de tummy time»</i>
<i>«¿cuánto ha comido hoy?»</i> · <i>«¿hace cuánto no hace popó?»</i>` : `<i>popó</i> · <i>pipí</i> · <i>tetero 5</i> · <i>pecho izq 10</i> · <i>se durmió</i> · <i>se despertó</i> · <i>estado</i>`}

Después de cada registro tienes <b>↩️ Deshacer</b> y <b>🕐 Fue hace…</b> por si te equivocas o lo anotas tarde.
En <b>➕ Más</b>: 📝 Notas, 🗓️ Rutinas (vitamina D, tummy time, baño, tratamientos), controles y más.

⏰ Recordatorios: aviso 1 h y 10 min antes. 🩺 Controles: 24 h, 12 h y 2 h antes.`;
}

// ------------------------------------------------------------------ helpers

const words = (s: string) => s.split(/\s+/).filter(Boolean);

export function toFloat(tok: string | undefined): number | null {
  if (tok == null || !/^\d+(?:[.,]\d+)?$/.test(tok.trim())) return null;
  const v = Number(tok.replace(",", "."));
  return Number.isFinite(v) && v >= 0 ? v : null;
}

async function getCaregiver(app: App, chatId: string): Promise<Caregiver | null> {
  return app.db.prepare("SELECT * FROM caregivers WHERE chat_id = ?").bind(chatId).first<Caregiver>();
}

// ---------------- estado de la conversación ("¿cuántos ml?" esperando respuesta)

type State = { state: string; data: Record<string, any> };

async function getState(app: App, chatId: string): Promise<State | null> {
  const r = await app.db.prepare("SELECT state, data, updated_at FROM chat_state WHERE chat_id = ?").bind(chatId)
    .first<{ state: string; data: string; updated_at: number }>();
  if (!r || app.now() - r.updated_at > 15 * T.MIN) return null;
  return { state: r.state, data: JSON.parse(r.data || "{}") };
}

async function setState(app: App, chatId: string, state: string, data: Record<string, any> = {}) {
  await app.db.prepare(
    "INSERT INTO chat_state (chat_id, state, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET state = excluded.state, data = excluded.data, updated_at = excluded.updated_at",
  ).bind(chatId, state, JSON.stringify(data), app.now()).run();
}

async function clearState(app: App, chatId: string) {
  await app.db.prepare("DELETE FROM chat_state WHERE chat_id = ?").bind(chatId).run();
}

// ---------------- horas

/**
 * Hora en que pasó algo: "hace X min" o "HH:MM" (si es ambigua como "2:00",
 * toma la más reciente que ya pasó: 02:00 o 14:00).
 */
export function resolvePast(app: App, ago?: number | null, time?: string | null): number {
  const now = app.now();
  if (typeof ago === "number" && ago > 0 && ago < 7 * 24 * 60) return now - ago * T.MIN;
  const hm = time ? T.parseHHMM(String(time)) : null;
  if (!hm) return now;
  const nowN = T.toNaive(now, app.tz);
  const hours = hm[0] >= 1 && hm[0] <= 11 ? [hm[0], hm[0] + 12] : [hm[0]];
  let best = -Infinity;
  for (const h of hours) {
    let t = T.setHM(nowN, h, hm[1]);
    if (t > nowN + 5 * T.MIN) t -= T.DAY;
    best = Math.max(best, t);
  }
  return T.fromNaive(best, app.tz);
}

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
      if (at > nowN + 5 * T.MIN) at -= T.DAY;
      return [text.slice(0, m.index).trim(), T.fromNaive(at, app.tz)];
    }
  }
  return [text, null];
}

// ---------------- registrar

async function save(app: App, cg: Caregiver, chatId: string, kind: string, o: Parameters<App["createEntry"]>[2] = {}) {
  const e = await app.createEntry(kind, cg.name, o);
  await app.notifyEntry(e, "registró", chatId);
  return e;
}

function savedLine(app: App, e: Entry): string {
  return `✅ ${esc(app.describe(e))} · ${app.fmtTime(e.start_at)}`;
}

async function logReply(app: App, cg: Caregiver, chatId: string, kind: string, o: Parameters<App["createEntry"]>[2] = {}): Promise<Reply> {
  const e = await save(app, cg, chatId, kind, o);
  let text = savedLine(app, e);
  if (kind === "temp" && (e.amount ?? 0) >= 38) {
    text += "\n\n⚠️ <b>38 °C o más en un recién nacido:</b> llamen al pediatra o vayan a urgencias.";
  }
  return [text, afterKeyboard([e.id])];
}

async function sleepReply(app: App, cg: Caregiver, chatId: string, want: "sleep" | "wake" | null, at?: number | null): Promise<Reply> {
  const current = await app.activeSleep();
  if (want === "sleep" && current) return [`😴 Ya estaba durmiendo desde las ${app.fmtTime(current.start_at)}.`, [[{ text: "😊 Ya se despertó", callback_data: "sleep" }]]];
  if (want === "wake" && !current) return ["No tenía un sueño en curso. ¿Quieres registrar que se durmió?", [[{ text: "😴 Se durmió", callback_data: "sleep" }]]];
  const [e, slept] = await app.toggleSleep(cg.name, at);
  if (slept) {
    await app.notifyEntry(e, "registró que se durmió", chatId);
    return [`😴 Se durmió a las ${app.fmtTime(e.start_at)}. Dulces sueños 🌙`, afterKeyboard([e.id])];
  }
  await app.notifyEntry(e, "registró que se despertó", chatId);
  return [`😊 Se despertó. Durmió <b>${T.fmtDur((e.end_at! - e.start_at) / 1000)}</b>.`,
    [[{ text: "↩️ Deshacer (sigue dormida)", callback_data: `unwake:${e.id}` }]]];
}

/** /sueno 13:00 14:30  ó  /sueno 13:00 1h30m */
async function pastSleep(app: App, cg: Caregiver, chatId: string, args: string): Promise<Reply> {
  const toks = words(args);
  const usage: Reply = ["Dime inicio y fin, por ejemplo: <i>durmió de 13:00 a 14:30</i>", null];
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
  } else if (mins) end = start + mins * T.MIN;
  else return usage;
  if (end > nowN + T.MIN) return ["Ese sueño termina en el futuro. Si está durmiendo ahora, toca 😴 Sueño.", null];
  return logReply(app, cg, chatId, "sleep", {
    start: T.fromNaive(start, app.tz), end: T.fromNaive(end, app.tz), note: toks.slice(2).join(" ") || null,
  });
}

// ------------------------------------------------------------------ frases simples (sin IA)

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
  "ya se durmio": ["dormir", ""], "se quedo dormida": ["dormir", ""],
  "desperto": ["desperto", ""], "se desperto": ["desperto", ""], "desperte": ["desperto", ""], "ya se desperto": ["desperto", ""],
  "bano": ["bano", ""], "se bano": ["bano", ""], "banada": ["bano", ""],
  "estado": ["estado", ""], "resumen": ["estado", ""], "como va": ["estado", ""], "como esta": ["estado", ""],
  "hoy": ["hoy", ""], "agenda": ["agenda", ""], "menu": ["menu", ""], "ayuda": ["ayuda", ""],
  "deshacer": ["deshacer", ""], "notas": ["notas", ""], "mis notas": ["notas", ""], "ver notas": ["notas", ""],
  "rutinas": ["rutinas", ""], "tummy time": ["tummy", ""], "tummy": ["tummy", ""], "barriguita": ["tummy", ""],
  "hola": ["hola", ""], "ola": ["hola", ""], "hola tasky": ["hola", ""], "hola bot": ["hola", ""], "buenas": ["hola", ""], "buenos dias": ["hola", ""], "buen dia": ["hola", ""], "buenas tardes": ["hola", ""], "buenas noches": ["hola", ""], "hey": ["hola", ""], "holi": ["hola", ""], "que mas": ["hola", ""], "quiubo": ["hola", ""], "hola hola": ["hola", ""],
  "gracias": ["gracias", ""], "muchas gracias": ["gracias", ""], "gracias tasky": ["gracias", ""], "mil gracias": ["gracias", ""], "ok": ["gracias", ""], "listo": ["gracias", ""], "vale": ["gracias", ""], "dale": ["gracias", ""],
};
const ML_RE = /^(?:(?:tomo|comio|le di)\s+)?(?:biberon|tetero|formula|leche|toma)?\s*(\d+(?:[.,]\d+)?)\s*(?:ml)?$/;
const ML_WORD = /^(?:(?:tomo|comio)\s+)?(biberon|tetero|formula|leche|toma)$/;
const BREAST_RE = /^(?:dio\s+|tomo\s+)?(?:pecho|teta|seno)\s+(izq\S*|der\S*)(?:\s+(\d+)\s*(?:m|min|minutos)?)?$/;

/** 'popó hace 10m' -> ['panal', 'popo hace 10m']. null si no es una frase simple. */
const NOTE_RE = /^(?:anota(?:r|me)?|apunta(?:r|me)?|nota|no olvidar|no olvides|no se me olvide)\s*[:,-]?\s+(.+)$/is;

export function plainToCommand(text: string): [string, string] | null {
  const nm = text.trim().match(NOTE_RE);
  if (nm) return ["nota", nm[1].trim()];
  const m = norm(text).match(TIME_SUFFIX)!;
  // "hizo popó", "ya hizo pipí", "acaba de hacer popó" -> "popo"
  const base = m[1].trim().replace(/^(?:ya |acaba de |acabo de )?(?:hizo|hacer|se hizo|tuvo) (?=(?:pipi|popo|caca|pis|popis)\b)/, "");
  const suffix = m[2] ?? "";
  if (PLAIN[base]) {
    const [cmd, args] = PLAIN[base];
    return [cmd, (args + suffix).trim()];
  }
  const mm = base.match(ML_RE);
  if (mm && (base.includes("ml") || !/^[\d.,]+$/.test(base))) {
    return [base.includes("formula") ? "formula" : "comida", (mm[1] + suffix).trim()];
  }
  if (ML_WORD.test(base)) return ["comida", suffix.trim()];
  const mb = base.match(BREAST_RE);
  if (mb) return ["pecho", `${mb[1].startsWith("izq") ? "izq" : "der"} ${mb[2] ?? ""}${suffix}`.replace(/\s+/g, " ").trim()];
  return null;
}

// ------------------------------------------------------------------ comandos y frases simples

export async function handleCommand(app: App, cg: Caregiver, chatId: string, cmd: string, args: string): Promise<Reply> {
  const [a, at] = splitTime(app, args);
  const start = at ?? undefined;
  const toks = words(a);

  switch (cmd) {
    case "menu": case "start":
      return ["¿Qué registramos? Usa los botones de abajo ⬇️ o escríbeme.", MAIN_KB];
    case "hola":
      return [`¡Hola, ${esc(cg.name)}! 👋 ¿Qué registramos? Usa los botones o cuéntame qué pasó.`, MAIN_KB];
    case "gracias":
      return ["¡Con gusto! 💜", null];
    case "estado": case "resumen": case "status":
      return [await app.statusText(), null];
    case "hoy":
      return [await app.todayText(), null];
    case "ayuda": case "help":
      return [helpText(app), MAIN_KB];

    case "comida": case "biberon": case "formula": {
      const detail = cmd === "formula" ? "formula" : "biberon";
      if (!toks.length) {
        await setState(app, chatId, "ml", { detail });
        return ["🍼 ¿Cuánto tomó? Toca una cantidad o <b>escribe el número</b> (ej: 4).", mlKeyboard(detail)];
      }
      const ml = toFloat(toks[0]);
      const note = (ml !== null ? toks.slice(1) : toks).join(" ") || null;
      return logReply(app, cg, chatId, "feed", { detail, amount: ml || null, note, start });
    }
    case "pecho": {
      let side: string | null = null;
      const rest = [...toks];
      if (rest.length && ["izq", "der"].includes(rest[0].toLowerCase().slice(0, 3))) {
        side = rest.shift()!.toLowerCase().startsWith("izq") ? "pecho_izq" : "pecho_der";
      }
      if (!side) return ["🤱 ¿Qué lado?", breastSideKeyboard()];
      const mins = toFloat(rest[0]);
      if (mins !== null) rest.shift();
      return logReply(app, cg, chatId, "feed", { detail: side, amount: mins, note: rest.join(" ") || null, start });
    }
    case "dormir": case "durmio": case "dormida":
      return sleepReply(app, cg, chatId, "sleep", at);
    case "desperto": case "despertar": case "despierta":
      return sleepReply(app, cg, chatId, "wake", at);
    case "sueno": case "sueño": case "siesta":
      return pastSleep(app, cg, chatId, args);

    case "panal": case "pañal": case "pipi": case "popo": {
      let det = cmd === "pipi" || cmd === "popo" ? cmd : norm(toks[0] ?? "");
      det = ({ caca: "popo", ambas: "ambos", los2: "ambos" } as Record<string, string>)[det] ?? det;
      if (!["pipi", "popo", "ambos"].includes(det)) return ["🧷 ¿Qué tenía el pañal?", diaperKeyboard()];
      const rest = (cmd === "panal" || cmd === "pañal" ? toks.slice(1) : toks).join(" ");
      return logReply(app, cg, chatId, "diaper", { detail: det, note: rest || null, start });
    }
    case "bano": case "baño":
      return logReply(app, cg, chatId, "bath", { note: a || null, start });
    case "medicina":
      if (!a) { await setState(app, chatId, "med"); return ["💊 ¿Qué medicina y qué dosis? (ej: <i>vitamina D 2 gotas</i>)", null]; }
      return logReply(app, cg, chatId, "medicine", { detail: a.slice(0, 80), start });
    case "temp": {
      const v = toFloat(toks[0]);
      if (v === null || v < 30 || v > 45) { await setState(app, chatId, "temp"); return ["🌡️ ¿Cuánta temperatura tiene? (ej: <i>37.2</i>)", null]; }
      return logReply(app, cg, chatId, "temp", { amount: v, start });
    }
    case "peso": {
      let v = toFloat(toks[0]);
      if (v !== null && v > 100) v = v / 1000; // gramos
      if (v === null || v < 0.5 || v > 40) { await setState(app, chatId, "weight"); return ["⚖️ ¿Cuánto pesó? (ej: <i>3.2</i> kg o <i>3200</i> gramos)", null]; }
      return logReply(app, cg, chatId, "weight", { amount: Math.round(v * 1000) / 1000, start });
    }
    case "nota": case "anota": case "apunta": case "anotar":
      if (!args) { await setState(app, chatId, "note"); return ["📝 Escribe la nota:", null]; }
      return noteReply(app, cg, args);
    case "notas":
      return [await app.notesText(), await notesKeyboard(app)];
    case "rutinas":
      return ["🗓️ <b>Rutinas</b> — elige una y te la recuerdo siempre:", routinesKeyboard()];
    case "tummy":
      if (toFloat(toks[0]) === null) { await setState(app, chatId, "tummy"); return ["🧸 ¿Cuántos minutos de tummy time?", tummyKeyboard()]; }
      return logReply(app, cg, chatId, "tummy", { amount: toFloat(toks[0]) || null, start });

    case "recordar": {
      if (!args) { await setState(app, chatId, "rem"); return [REM_PROMPT, null]; }
      return createReminderFromText(app, cg, args);
    }
    case "borrar_recordatorio": case "cancelar": {
      const id = /^\d+$/.test(a) ? Number(a) : null;
      const r = id ? await app.db.prepare("SELECT text FROM reminders WHERE id = ?").bind(id).first<{ text: string }>() : null;
      if (!r) return ["Indica el número: /borrar_recordatorio 3 (míralo en 📅 Agenda)", null];
      await app.db.prepare("UPDATE reminders SET active = 0 WHERE id = ?").bind(id).run();
      return [`🗑️ Recordatorio cancelado: ${esc(r.text)}`, null];
    }
    case "control": {
      if (!args) { await setState(app, chatId, "appt"); return [APPT_PROMPT, null]; }
      return createAppointmentFromText(app, cg, chatId, args);
    }
    case "agenda":
      return [await app.agendaText(), null];
    case "deshacer":
      return undoLast(app, cg);
    case "avisos": {
      const on = cg.notify_others ? 0 : 1;
      await app.db.prepare("UPDATE caregivers SET notify_others = ? WHERE id = ?").bind(on, cg.id).run();
      return [on ? "🔔 Te aviso cuando alguien más registre algo."
        : "🔕 Ya no te aviso de los registros de otros (los recordatorios siguen llegando).", null];
    }
  }
  return ["No conozco ese comando. Toca ❓ Ayuda en ➕ Más.", MAIN_KB];
}

async function noteReply(app: App, cg: Caregiver, text: string): Promise<Reply> {
  const n = await app.addNote(text, cg.name);
  return [`📝 Anotado: <i>${esc(n.text)}</i>`, [[{ text: "📝 Ver notas", callback_data: "m:notes" }, { text: "↩️ Borrar", callback_data: `ndel:${n.id}` }]]];
}

const REM_PROMPT = "⏰ ¿Qué te recuerdo y cuándo?\nEj: <i>vitamina D mañana a las 8</i> · <i>sacarme leche en 30 minutos</i> · <i>dar pecho cada 3 horas</i>";
const APPT_PROMPT = "🩺 ¿Qué control y cuándo?\nEj: <i>pediatra el 2 de diciembre a las 10:30 en la Clínica del Country</i>";

async function undoLast(app: App, cg: Caregiver): Promise<Reply> {
  const e = await app.db.prepare("SELECT * FROM entries WHERE author = ? ORDER BY created_at DESC LIMIT 1")
    .bind(cg.name).first<Entry>();
  if (!e || app.now() - e.created_at > T.HOUR) return ["No hay registros tuyos de la última hora para deshacer.", null];
  await app.db.prepare("DELETE FROM entries WHERE id = ?").bind(e.id).run();
  return [`↩️ Borrado: ${esc(app.describe(e))}`, null];
}

async function insertReminder(app: App, cg: Caregiver, text: string, due: number, repeat: number | null,
  extra: { action?: string | null; endsAt?: number | null } = {}): Promise<Reply> {
  const r = await app.createReminder({ text, due, repeat, author: cg.name, action: extra.action, endsAt: extra.endsAt });
  const rep = repeat ? `, y luego ${app.repeatLabel(repeat)}` : "";
  const until = r.ends_at ? ` hasta ${app.fmtTime(r.ends_at)}` : "";
  const pre = [r.pre_60_sent ? "" : "1 h", r.pre_10_sent ? "" : "10 min"].filter(Boolean);
  return [`⏰ Listo, les aviso <b>${app.fmtTime(r.due_at)}</b>${rep}${until}: ${esc(text)}`
    + (pre.length ? `\n<i>También ${pre.join(" y ")} antes.</i>` : ""),
    [[{ text: "🗑️ Cancelar recordatorio", callback_data: `rmrem:${r.id}` }]]];
}

/** Próxima vez que el reloj marque HH:MM (hoy o mañana). */
function nextAt(app: App, hhmm: string): number {
  const hm = T.parseHHMM(hhmm)!;
  const nowN = T.toNaive(app.now(), app.tz);
  let t = T.setHM(nowN, hm[0], hm[1]);
  if (t <= nowN) t += T.DAY;
  return T.fromNaive(t, app.tz);
}

async function createRoutine(app: App, cg: Caregiver, key: string, times: string[]): Promise<string> {
  const r = ROUTINES[key];
  if (!r) return "🤔";
  for (const t of times) await app.createReminder({ text: r.text, due: nextAt(app, t), repeat: r.repeat, author: cg.name, action: r.action });
  return `✅ Rutina creada: <b>${esc(r.label)}</b>\n🕐 ${times.join(", ")} · ${app.repeatLabel(r.repeat)}\n`
    + "Cuando llegue el aviso toca <b>✅ Hecho</b> y queda registrado. Puedes verla o borrarla en 📅 Agenda.";
}

async function insertAppointment(app: App, cg: Caregiver, chatId: string, title: string, at: number, place: string | null): Promise<Reply> {
  const t = title.trim().slice(0, 120) || "Control médico";
  const [a, inCal] = await app.createAppointment({ title: t, at, place, author: cg.name });
  await app.broadcast(`📅 ${esc(cg.name)} agendó: ${esc(t)} — ${app.fmtTime(a.at)}`, { excludeChat: chatId, onlySubscribed: true });
  const left = a.at - app.now();
  const pre = [left > 24 * T.HOUR ? "24 h" : "", left > 12 * T.HOUR ? "12 h" : "", left > 2 * T.HOUR ? "2 h" : ""].filter(Boolean);
  const kb: Keyboard = inCal ? [] : [[{ text: "📅 Agregar a Google Calendar", url: googleCalendarUrl(`${t} (${app.babyName})`, a.at, place) }]];
  kb.push([{ text: "🗑️ Borrar control", callback_data: `rmappt:${a.id}` }]);
  return [`🩺 Agendado: <b>${esc(t)}</b> — ${app.fmtTime(a.at)}${place ? `\n📍 ${esc(place)}` : ""}`
    + (pre.length ? `\nLes recuerdo ${pre.join(", ")} antes.` : "")
    + (inCal ? "\n📅 Ya está en Google Calendar ✅" : ""), kb];
}

/** Recordatorio desde texto: primero formato fijo ("30m vitamina"); si no, IA. */
async function createReminderFromText(app: App, cg: Caregiver, text: string): Promise<Reply> {
  try {
    const [due, repeat, rest] = app.parseWhen(text);
    if (rest) return insertReminder(app, cg, rest, due, repeat);
  } catch { /* probar con IA */ }
  if (aiEnabled(app.env)) {
    try {
      const acts = await interpret(app, "recuérdame " + text);
      const r = acts.find((x) => x.type === "reminder");
      if (r) {
        const res = reminderFromAction(app, r);
        if (res) return insertReminder(app, cg, res.text, res.due, res.repeat);
      }
    } catch (e) { console.warn("IA recordatorio", String(e)); }
  }
  return ["❌ No entendí cuándo. " + REM_PROMPT.slice(2), null];
}

async function createAppointmentFromText(app: App, cg: Caregiver, chatId: string, text: string): Promise<Reply> {
  try {
    const [when, , rest] = app.parseWhen(text, false);
    if (rest) {
      const [title, ...place] = rest.split("|");
      return insertAppointment(app, cg, chatId, title, when, place.join("|").trim() || null);
    }
  } catch { /* probar con IA */ }
  if (aiEnabled(app.env)) {
    try {
      const acts = await interpret(app, "control médico: " + text);
      const a = acts.find((x) => x.type === "appointment");
      const at = a ? appointmentTime(app, a) : null;
      if (a && at) return insertAppointment(app, cg, chatId, a.title || "Control médico", at, a.place ?? null);
    } catch (e) { console.warn("IA control", String(e)); }
  }
  return ["❌ No entendí la fecha. " + APPT_PROMPT.slice(2), null];
}

const COURSE_PROMPT = "💊 Cuéntame el tratamiento: medicina, dosis, cada cuántas horas, por cuántos días y desde qué hora.\n"
  + "Ej: <i>amoxicilina 2.5 ml cada 8 horas por 7 días desde las 8 am</i>";

async function courseFromAction(app: App, cg: Caregiver, x: Action): Promise<Reply> {
  const name = String(x.name ?? "").trim();
  const every = Number(x.every_hours);
  if (!name || !(every >= 1 && every <= 72)) return ["❌ Me faltó la medicina o cada cuántas horas. " + COURSE_PROMPT.slice(2), null];
  const dose = String(x.dose ?? "").trim();
  const label = `${name}${dose ? " " + dose : ""}`.slice(0, 80);
  const first = x.start_time && T.parseHHMM(String(x.start_time)) ? nextAt(app, String(x.start_time)) : app.now() + every * T.HOUR;
  const days = Number(x.days);
  const endsAt = days >= 1 && days <= 90 ? first + days * T.DAY - T.MIN : null;
  return insertReminder(app, cg, `💊 ${label}`, first, Math.round(every * 60), { action: `medicine:${label}`, endsAt });
}

async function createCourse(app: App, cg: Caregiver, text: string): Promise<Reply> {
  if (!aiEnabled(app.env)) return ["Para tratamientos necesito la IA activa 🙈 Usa ⏰ Recordatorio con «cada 8h».", null];
  try {
    const acts = await interpret(app, "tratamiento: " + text);
    const c = acts.find((a) => a.type === "medication");
    if (c) return courseFromAction(app, cg, c);
  } catch (e) { console.warn("IA tratamiento", String(e)); }
  return ["❌ No lo entendí. " + COURSE_PROMPT.slice(2), null];
}

function reminderFromAction(app: App, r: Action): { text: string; due: number; repeat: number | null } | null {
  const text = String(r.text ?? "").trim();
  if (!text) return null;
  const now = app.now();
  const repeat = typeof r.repeat_minutes === "number" && r.repeat_minutes >= 5 ? Math.round(r.repeat_minutes) : null;
  let due: number | null = null;
  if (typeof r.in_minutes === "number" && r.in_minutes > 0) due = now + r.in_minutes * T.MIN;
  else {
    const hm = r.time ? T.parseHHMM(String(r.time)) : null;
    const nowN = T.toNaive(now, app.tz);
    if (r.date && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date)) && hm) {
      due = T.fromNaive(Date.parse(r.date + "T00:00:00Z") + hm[0] * T.HOUR + hm[1] * T.MIN, app.tz);
    } else if (hm) {
      let t = T.setHM(nowN, hm[0], hm[1]);
      if (t <= nowN) t += T.DAY;
      due = T.fromNaive(t, app.tz);
    } else if (repeat) due = now + repeat * T.MIN;
  }
  if (due === null || due < now - T.MIN) return null;
  return { text, due, repeat };
}

function appointmentTime(app: App, a: Action): number | null {
  const hm = a.time ? T.parseHHMM(String(a.time)) : null;
  if (!a.date || !/^\d{4}-\d{2}-\d{2}$/.test(String(a.date)) || !hm) return null;
  return T.fromNaive(Date.parse(a.date + "T00:00:00Z") + hm[0] * T.HOUR + hm[1] * T.MIN, app.tz);
}

// ------------------------------------------------------------------ respuestas a preguntas pendientes

async function handleState(app: App, cg: Caregiver, chatId: string, st: State, text: string): Promise<Reply | null> {
  const n = norm(text);
  const num = toFloat(n.replace(/\s*(ml|mililitros|min|minutos|kg|kilos|gramos|gr|g|grados|°c?)$/, ""));
  switch (st.state) {
    case "ml":
      if (num === null) return null;
      await clearState(app, chatId);
      return logReply(app, cg, chatId, "feed", { detail: st.data.detail ?? "biberon", amount: num || null });
    case "bm":
      if (num === null) return null;
      await clearState(app, chatId);
      return logReply(app, cg, chatId, "feed", { detail: st.data.detail, amount: num || null });
    case "temp":
      if (num === null || num < 30 || num > 45) return null;
      await clearState(app, chatId);
      return logReply(app, cg, chatId, "temp", { amount: num });
    case "weight": {
      if (num === null) return null;
      const kg = num > 100 ? num / 1000 : num;
      if (kg < 0.5 || kg > 40) return null;
      await clearState(app, chatId);
      return logReply(app, cg, chatId, "weight", { amount: Math.round(kg * 1000) / 1000 });
    }
    case "med":
      await clearState(app, chatId);
      return logReply(app, cg, chatId, "medicine", { detail: text.trim().slice(0, 80) });
    case "note":
      await clearState(app, chatId);
      return noteReply(app, cg, text);
    case "tummy":
      if (num === null) return null;
      await clearState(app, chatId);
      return logReply(app, cg, chatId, "tummy", { amount: num || null });
    case "course":
      await clearState(app, chatId);
      return createCourse(app, cg, text);
    case "rem":
      await clearState(app, chatId);
      return createReminderFromText(app, cg, text);
    case "appt":
      await clearState(app, chatId);
      return createAppointmentFromText(app, cg, chatId, text);
  }
  return null;
}

// ------------------------------------------------------------------ IA: ejecutar acciones

async function runActions(app: App, cg: Caregiver, chatId: string, actions: Action[], original: string): Promise<Reply[]> {
  const lines: string[] = [];
  const ids: number[] = [];
  const extra: Reply[] = [];
  let warn = "";

  for (const x of actions) {
    const at = resolvePast(app, x.ago, x.time);
    try {
      switch (x.type) {
        case "feed": {
          const detail = ["biberon", "formula", "pecho_izq", "pecho_der", "pecho"].includes(String(x.detail)) ? String(x.detail) : "biberon";
          const amount = typeof x.amount === "number" && x.amount > 0 && x.amount < 1000 ? x.amount : null;
          const e = await save(app, cg, chatId, "feed", { detail, amount, start: at });
          lines.push(savedLine(app, e)); ids.push(e.id);
          break;
        }
        case "diaper": {
          const detail = ["pipi", "popo", "ambos"].includes(String(x.detail)) ? String(x.detail) : "pipi";
          const e = await save(app, cg, chatId, "diaper", { detail, start: at });
          lines.push(savedLine(app, e)); ids.push(e.id);
          break;
        }
        case "bath": {
          const e = await save(app, cg, chatId, "bath", { start: at });
          lines.push(savedLine(app, e)); ids.push(e.id);
          break;
        }
        case "medicine": {
          const name = String(x.name ?? "").trim().slice(0, 80);
          if (!name) { warn = "¿Qué medicina fue?"; break; }
          const e = await save(app, cg, chatId, "medicine", { detail: name, start: at });
          lines.push(savedLine(app, e)); ids.push(e.id);
          break;
        }
        case "temp": {
          const v = Number(x.value);
          if (!(v >= 30 && v <= 45)) { warn = "No entendí la temperatura."; break; }
          const e = await save(app, cg, chatId, "temp", { amount: v, start: at });
          lines.push(savedLine(app, e)); ids.push(e.id);
          if (v >= 38) warn = "⚠️ <b>38 °C o más en un recién nacido:</b> llamen al pediatra o vayan a urgencias.";
          break;
        }
        case "weight": {
          let kg = Number(x.kg);
          if (kg > 100) kg /= 1000;
          if (!(kg >= 0.5 && kg <= 40)) { warn = "No entendí el peso."; break; }
          const e = await save(app, cg, chatId, "weight", { amount: Math.round(kg * 1000) / 1000, start: at });
          lines.push(savedLine(app, e)); ids.push(e.id);
          break;
        }
        case "note": {
          extra.push(await noteReply(app, cg, String(x.text ?? original)));
          break;
        }
        case "tummy": {
          const amount = typeof x.amount === "number" && x.amount > 0 && x.amount < 180 ? x.amount : null;
          const e = await save(app, cg, chatId, "tummy", { amount, start: at });
          lines.push(savedLine(app, e)); ids.push(e.id);
          break;
        }
        case "medication": {
          extra.push(await courseFromAction(app, cg, x));
          break;
        }
        case "sleep_start": {
          const [t] = await sleepReply(app, cg, chatId, "sleep", at);
          lines.push(t);
          break;
        }
        case "sleep_end": {
          const [t] = await sleepReply(app, cg, chatId, "wake", at);
          lines.push(t);
          break;
        }
        case "sleep_past": {
          let end = resolvePast(app, null, x.end);
          let start = resolvePast(app, null, x.start);
          if (start >= end) start -= T.DAY;
          if (end - start > 16 * T.HOUR) { warn = "No entendí las horas del sueño."; break; }
          const e = await save(app, cg, chatId, "sleep", { start, end });
          lines.push(savedLine(app, e)); ids.push(e.id);
          break;
        }
        case "reminder": {
          const r = reminderFromAction(app, x);
          if (!r) { extra.push(["❌ No entendí cuándo recordarte. " + REM_PROMPT.slice(2), null]); break; }
          extra.push(await insertReminder(app, cg, r.text, r.due, r.repeat));
          break;
        }
        case "appointment": {
          const when = appointmentTime(app, x);
          if (!when) { extra.push(["❌ Me faltó la fecha u hora del control. " + APPT_PROMPT.slice(2), null]); break; }
          extra.push(await insertAppointment(app, cg, chatId, x.title || "Control médico", when, x.place ?? null));
          break;
        }
        case "undo":
          extra.push(await undoLast(app, cg));
          break;
        case "question":
          extra.push([esc(await answer(app, original)), null]);
          break;
        case "chat":
          extra.push([`¡Hola, ${esc(cg.name)}! 👋 Cuéntame qué pasó con ${esc(app.babyName)} o usa los botones.`, MAIN_KB]);
          break;
      }
    } catch (e) {
      console.warn("Acción falló", x.type, String(e));
    }
  }

  const replies: Reply[] = [];
  if (lines.length || warn) {
    const text = [...lines, ...(warn ? ["", warn] : [])].join("\n");
    replies.push([text, ids.length ? afterKeyboard(ids, ids.length === 1) : null]);
  }
  return [...replies, ...extra];
}

// ------------------------------------------------------------------ botones inline

async function handleCallback(app: App, cg: Caregiver, chatId: string, data: string, msgId: number): Promise<void> {
  const edit = (text: string, kb?: Keyboard | null) => tgEdit(app.env, chatId, msgId, text, kb);
  const p = data.split(":");

  switch (p[0]) {
    case "cancel":
      await clearState(app, chatId);
      return void (await edit("✖️ Cancelado."));
    case "mlk":
      await setState(app, chatId, "ml", { detail: p[1] === "formula" ? "formula" : "biberon" });
      return void (await edit("🍼 ¿Cuánto tomó? Toca una cantidad o <b>escribe el número</b> (ej: 4).", mlKeyboard(p[1] === "formula" ? "formula" : "biberon")));
    case "ml": {
      await clearState(app, chatId);
      const amount = toFloat(p[2]) || null;
      const [t, kb] = await logReply(app, cg, chatId, "feed", { detail: p[1] === "formula" ? "formula" : "biberon", amount });
      return void (await edit(t, kb as Keyboard));
    }
    case "br": {
      const side = p[1] === "izq" ? "pecho_izq" : p[1] === "der" ? "pecho_der" : "pecho_ambos";
      await setState(app, chatId, "bm", { detail: side });
      return void (await edit("🤱 ¿Cuánto tiempo? Toca o <b>escribe los minutos</b>.", breastMinKeyboard(p[1])));
    }
    case "bm": {
      await clearState(app, chatId);
      const side = p[1] === "izq" ? "pecho_izq" : p[1] === "der" ? "pecho_der" : "pecho_ambos";
      const [t, kb] = await logReply(app, cg, chatId, "feed", { detail: side, amount: toFloat(p[2]) || null });
      return void (await edit(t, kb as Keyboard));
    }
    case "dp": {
      if (!["pipi", "popo", "ambos"].includes(p[1])) return;
      const [t, kb] = await logReply(app, cg, chatId, "diaper", { detail: p[1] });
      return void (await edit(t, kb as Keyboard));
    }
    case "sleep": {
      const [t, kb] = await sleepReply(app, cg, chatId, null);
      return void (await edit(t, kb as Keyboard));
    }
    case "undo": {
      const ids = p[1].split(",").filter((x) => /^\d+$/.test(x)).map(Number).slice(0, 10);
      const gone: string[] = [];
      for (const id of ids) {
        const e = await app.getEntry(id);
        if (!e) continue;
        await app.db.prepare("DELETE FROM entries WHERE id = ?").bind(id).run();
        gone.push(esc(app.describe(e)));
      }
      return void (await edit(gone.length ? `↩️ Borrado:\n${gone.join("\n")}` : "Ya estaba borrado."));
    }
    case "unwake": {
      const e = await app.getEntry(Number(p[1]));
      if (!e || e.kind !== "sleep" || (await app.activeSleep())) return void (await edit("No se pudo deshacer."));
      await app.db.prepare("UPDATE entries SET end_at = NULL WHERE id = ?").bind(e.id).run();
      return void (await edit(`😴 Listo, sigue durmiendo desde las ${app.fmtTime(e.start_at)}.`));
    }
    case "ago": {
      const id = Number(p[1]);
      const mins = Number(p[2]);
      const e = await app.getEntry(id);
      if (!e || !(mins > 0)) return;
      const start = e.created_at - mins * T.MIN;
      const end = e.kind === "sleep" ? e.end_at : start;
      await app.db.prepare("UPDATE entries SET start_at = ?, end_at = ? WHERE id = ?").bind(start, end, id).run();
      const u = (await app.getEntry(id))!;
      return void (await edit(savedLine(app, u), [[{ text: "↩️ Deshacer", callback_data: `undo:${id}` }]]));
    }
    case "rmrem": {
      await app.db.prepare("UPDATE reminders SET active = 0 WHERE id = ?").bind(Number(p[1])).run();
      return void (await edit("🗑️ Recordatorio cancelado."));
    }
    case "rmappt": {
      const a = await app.deleteAppointment(Number(p[1]));
      return void (await edit(a?.gcal_event_id ? "🗑️ Control borrado (también de Google Calendar)." : "🗑️ Control borrado."));
    }
    case "rdone": {
      const r = await app.db.prepare("SELECT * FROM reminders WHERE id = ?").bind(Number(p[1])).first<any>();
      if (!r) return void (await edit("Ese recordatorio ya no existe."));
      const key = `rdone:${p[1]}:${p[2]}`;
      const who = await app.kvGet(key);
      if (who) return void (await edit(`✅ ${esc(r.text)}\n<i>Ya lo marcó ${esc(who)}.</i>`));
      await app.kvSet(key, cg.name);
      const act = String(r.action ?? "");
      let logged = "";
      if (act.startsWith("medicine:")) logged = savedLine(app, await save(app, cg, chatId, "medicine", { detail: act.slice(9, 89) }));
      else if (act === "tummy") logged = savedLine(app, await save(app, cg, chatId, "tummy", {}));
      else if (act === "bath") logged = savedLine(app, await save(app, cg, chatId, "bath", {}));
      return void (await edit(`✅ <b>Hecho</b> por ${esc(cg.name)} · ${app.fmtTime(app.now())}\n${esc(r.text)}${logged ? "\n" + logged : ""}`));
    }
    case "rsnz": {
      const r = await app.db.prepare("SELECT * FROM reminders WHERE id = ?").bind(Number(p[1])).first<any>();
      if (!r) return void (await edit("Ese recordatorio ya no existe."));
      const n = await app.createReminder({ text: r.text, due: app.now() + 10 * T.MIN, author: cg.name, action: r.action });
      return void (await edit(`⏰ ${esc(r.text)}\n<i>Te lo recuerdo de nuevo a las ${app.fmtTime(n.due_at)}.</i>`));
    }
    case "nd": {
      await app.db.prepare("UPDATE notes SET done = 1 WHERE id = ?").bind(Number(p[1])).run();
      return void (await edit(await app.notesText(), await notesKeyboard(app)));
    }
    case "ndel": {
      await app.db.prepare("DELETE FROM notes WHERE id = ?").bind(Number(p[1])).run();
      return void (await edit("↩️ Nota borrada."));
    }
    case "tm": {
      await clearState(app, chatId);
      const [t, kb] = await logReply(app, cg, chatId, "tummy", { amount: toFloat(p[1]) || null });
      return void (await edit(t, kb as Keyboard));
    }
    case "rt": {
      if (p[1] === "course") {
        await setState(app, chatId, "course");
        return void (await edit(COURSE_PROMPT));
      }
      const r = ROUTINES[p[1]];
      if (!r) return;
      return void (await edit(`${esc(r.label)}\n¿A qué hora?`, [
        ...r.options.map(([label], i) => [{ text: `🕐 ${label}`, callback_data: `rth:${p[1]}:${i}` }]),
        [{ text: "✖️ Cancelar", callback_data: "cancel" }],
      ]));
    }
    case "rth": {
      const r = ROUTINES[p[1]];
      const opt = r?.options[Number(p[2])];
      if (!r || !opt) return;
      return void (await edit(await createRoutine(app, cg, p[1], opt[1])));
    }
    case "m": {
      const prompts: Record<string, [string, string]> = {
        med: ["med", "💊 ¿Qué medicina y qué dosis? (ej: <i>vitamina D 2 gotas</i>)"],
        temp: ["temp", "🌡️ ¿Cuánta temperatura tiene? (ej: <i>37.2</i>)"],
        weight: ["weight", "⚖️ ¿Cuánto pesó? (ej: <i>3.2</i> kg o <i>3200</i> gramos)"],
        note: ["note", "📝 Escribe la nota:"],
        rem: ["rem", REM_PROMPT],
        appt: ["appt", APPT_PROMPT],
      };
      if (prompts[p[1]]) {
        await setState(app, chatId, prompts[p[1]][0]);
        return void (await edit(prompts[p[1]][1]));
      }
      if (p[1] === "bath") {
        const [t, kb] = await logReply(app, cg, chatId, "bath");
        return void (await edit(t, kb as Keyboard));
      }
      if (p[1] === "notes") return void (await tgSend(app.env, chatId, await app.notesText(), await notesKeyboard(app)));
      if (p[1] === "rut") return void (await edit("🗓️ <b>Rutinas</b> — elige una y te la recuerdo siempre:", routinesKeyboard()));
      if (p[1] === "tummy") {
        await setState(app, chatId, "tummy");
        return void (await edit("🧸 ¿Cuántos minutos de tummy time? Toca o escribe el número.", tummyKeyboard()));
      }
      if (p[1] === "today") return void (await tgSend(app.env, chatId, await app.todayText()));
      if (p[1] === "agenda") return void (await tgSend(app.env, chatId, await app.agendaText()));
      if (p[1] === "help") return void (await tgSend(app.env, chatId, helpText(app), MAIN_KB));
      return;
    }
    // compatibilidad con botones de mensajes viejos
    case "log":
      if (["feed", "diaper", "bath"].includes(p[1])) {
        const [t, kb] = await logReply(app, cg, chatId, p[1], { detail: p[2] || null });
        return void (await tgSend(app.env, chatId, t, kb));
      }
      return;
  }
}

// ------------------------------------------------------------------ vincular con PIN

export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function link(app: App, chatId: string, args: string, firstName: string): Promise<Reply> {
  const toks = words(args);
  const hello = `👋 Hola, soy Tasky, el asistente de ${esc(app.babyName)}.\nPara empezar escribe:\n<code>/start PIN TuNombre</code>\n(el PIN familiar lo tienen papá y mamá)`;
  if (!toks.length) return [hello, null];
  const key = "tg:" + chatId;
  if (await app.pinBlocked([[key, 5], ["bot", 20]])) return ["⛔ Demasiados intentos. Espera 15 minutos.", null];
  if (!timingSafeEqual(toks[0], app.env.FAMILY_PIN)) {
    await app.pinFail([key, "bot"]);
    return ["❌ PIN incorrecto.\n\n" + hello, null];
  }
  const name = (toks.slice(1).join(" ") || firstName || "Familia").slice(0, 60);
  await app.db.prepare("INSERT INTO caregivers (name, chat_id) VALUES (?, ?) ON CONFLICT(chat_id) DO UPDATE SET name = excluded.name")
    .bind(name, chatId).run();
  await app.broadcast(`👋 ${esc(name)} se unió al asistente de ${esc(app.babyName)}.`, { excludeChat: chatId });
  return [`🎉 ¡Listo, ${esc(name)}!\n\n` + helpText(app), MAIN_KB];
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
    if (chat) await tgSend(app.env, chat, "😕 Algo falló con ese mensaje. Intenta de nuevo o usa los botones.", MAIN_KB);
  }
}

async function send(app: App, chatId: string, replies: Reply[]) {
  for (const [text, kb] of replies) await tgSend(app.env, chatId, text, kb);
}

/** Texto libre: estado pendiente -> botón -> frase simple -> IA. */
async function handleText(app: App, cg: Caregiver, chatId: string, text: string, fromVoice = false): Promise<Reply[]> {
  // Botones del teclado fijo
  switch (text) {
    case BTN.feed: await setState(app, chatId, "ml", { detail: "biberon" }); return [["🍼 ¿Cuánto tomó? Toca una cantidad o <b>escribe el número</b> (ej: 4).", mlKeyboard()]];
    case BTN.breast: return [["🤱 ¿Qué lado?", breastSideKeyboard()]];
    case BTN.sleep: return [await sleepReply(app, cg, chatId, null)];
    case BTN.diaper: return [["🧷 ¿Qué tenía el pañal?", diaperKeyboard()]];
    case BTN.status: return [[await app.statusText(), null]];
    case BTN.more: return [["¿Qué más necesitas?", moreKeyboard()]];
  }

  const st = await getState(app, chatId);
  if (st) {
    const r = await handleState(app, cg, chatId, st, text);
    if (r) return [r];
    await clearState(app, chatId); // respondió otra cosa: seguimos normal
  }

  const simple = plainToCommand(text);
  if (simple) return [await handleCommand(app, cg, chatId, simple[0], simple[1])];

  if (!aiEnabled(app.env)) return [["No te entendí 🙈 Usa los botones de abajo.", MAIN_KB]];
  let actions: Action[];
  try {
    actions = await interpret(app, text);
  } catch (e) {
    console.warn("IA no disponible", String(e));
    return [["No pude entenderte ahora mismo 🙈 Usa los botones de abajo (o frases cortas como «popó» o «tetero 5»).", MAIN_KB]];
  }
  if (!actions.length) {
    return [[fromVoice ? "No entendí bien el audio 🙈 ¿Me lo repites o usas los botones?" : "No te entendí 🙈 ¿Me lo dices de otra forma? También puedes usar los botones.", MAIN_KB]];
  }
  return runActions(app, cg, chatId, actions, text);
}

async function handle(app: App, update: any): Promise<void> {
  const cb = update?.callback_query;
  if (cb) {
    if (!cb.message) return;
    const chatId = String(cb.message.chat.id);
    await tgCall(app.env, "answerCallbackQuery", { callback_query_id: cb.id });
    const cg = await getCaregiver(app, chatId);
    if (!cg) return void (await tgSend(app.env, chatId, "Primero vincúlate: /start PIN TuNombre"));
    await handleCallback(app, cg, chatId, String(cb.data ?? ""), cb.message.message_id);
    return;
  }

  const msg = update?.message;
  if (!msg?.chat) return;
  const chatId = String(msg.chat.id);
  const firstName = msg.from?.first_name ?? "";
  const cg = await getCaregiver(app, chatId);

  // Notas de voz
  const voice = msg.voice ?? msg.audio;
  if (voice?.file_id) {
    if (!cg) return void (await send(app, chatId, [await link(app, chatId, "", firstName)]));
    if (!aiEnabled(app.env)) return void (await tgSend(app.env, chatId, "Aún no entiendo audios 🙈 Escríbeme o usa los botones.", MAIN_KB));
    if ((voice.duration ?? 0) > 120) return void (await tgSend(app.env, chatId, "Ese audio es muy largo 🙈 Mándame uno de menos de 2 minutos."));
    let heard = "";
    try {
      const audio = await tgDownload(app.env, voice.file_id);
      if (audio) heard = await transcribe(app.env, audio);
    } catch (e) { console.warn("Transcripción falló", String(e)); }
    if (!heard) return void (await tgSend(app.env, chatId, "No pude escuchar el audio 🙈 Intenta de nuevo o escríbeme.", MAIN_KB));
    await tgSend(app.env, chatId, `🎙️ <i>«${esc(heard.slice(0, 300))}»</i>`);
    return void (await send(app, chatId, await handleText(app, cg, chatId, heard, true)));
  }

  if (typeof msg.text !== "string") return;
  const text = msg.text.trim();

  if (!text.startsWith("/")) {
    if (!cg) return void (await send(app, chatId, [await link(app, chatId, "", firstName)]));
    return void (await send(app, chatId, await handleText(app, cg, chatId, text)));
  }

  const space = text.indexOf(" ");
  const head = space < 0 ? text.slice(1) : text.slice(1, space);
  const args = space < 0 ? "" : text.slice(space + 1).trim();
  const cmd = head.split("@")[0].toLowerCase();

  if (!cg) return void (await send(app, chatId, [await link(app, chatId, cmd === "start" ? args : "", firstName)]));
  if (cmd === "start" && !args) return void (await send(app, chatId, [[helpText(app), MAIN_KB]]));
  await clearState(app, chatId);
  await send(app, chatId, [await handleCommand(app, cg, chatId, cmd, args)]);
}

export async function setupWebhook(app: App, origin: string, secret: string) {
  const res = await tgCall(app.env, "setWebhook", {
    url: `${origin}/telegram/webhook`, secret_token: secret, allowed_updates: ["message", "callback_query"],
  });
  await tgCall(app.env, "setMyCommands", { commands: COMMANDS.map(([command, description]) => ({ command, description })) });
  if (res?.ok) await app.kvSet("webhook_url", `${origin}/telegram/webhook`);
  return res;
}
