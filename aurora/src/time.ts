/**
 * Manejo de horas en la zona de la familia.
 *
 * "naive" = milisegundos que representan la hora LOCAL como si fuera UTC
 * (se leen con getUTC*). Así sumar días o fijar una hora es aritmética simple.
 */

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function parts(ms: number, tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute, s: +o.second };
}

/** UTC -> hora local "naive". */
export function toNaive(ms: number, tz: string): number {
  const p = parts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) + (ms % 1000 + 1000) % 1000;
}

/** Hora local "naive" -> UTC. */
export function fromNaive(naive: number, tz: string): number {
  let guess = naive - (toNaive(naive, tz) - naive);
  // segunda pasada por si hay cambio de horario
  guess = naive - (toNaive(guess, tz) - guess);
  return guess;
}

export function startOfDay(naive: number): number {
  return Math.floor(naive / DAY) * DAY;
}

export function setHM(naive: number, h: number, mi: number): number {
  return startOfDay(naive) + h * HOUR + mi * MIN;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function hhmm(naive: number): string {
  const d = new Date(naive);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function fmtDur(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return "menos de 1 min";
  let h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    h %= 24;
    return h ? `${d} d ${h} h` : d > 1 ? `${d} días` : "1 día";
  }
  return h ? `${h} h ${pad(m)} min` : `${m} min`;
}

export function fmtTime(ms: number, now: number, tz: string): string {
  const n = toNaive(ms, tz);
  const today = startOfDay(toNaive(now, tz));
  const day = startOfDay(n);
  if (day === today) return hhmm(n);
  if (day === today - DAY) return `ayer ${hhmm(n)}`;
  if (day === today + DAY) return `mañana ${hhmm(n)}`;
  const d = new Date(n);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} ${hhmm(n)}`;
}

export function ago(ms: number, now: number): string {
  return "hace " + fmtDur((now - ms) / 1000);
}

export function iso(ms: number | null | undefined): string | null {
  return ms == null ? null : new Date(ms).toISOString();
}

/** ISO del navegador (con Z u offset) -> ms UTC. Sin zona = hora local de la familia. */
export function parseIso(value: unknown, tz: string): number | null {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  if (/([zZ]|[+-]\d\d:?\d\d)$/.test(s)) {
    const ms = Date.parse(s);
    if (Number.isNaN(ms)) throw new Error("Fecha inválida");
    return ms;
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) throw new Error("Fecha inválida");
  const naive = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  return fromNaive(naive, tz);
}

// ---------------------------------------------------------------- interpretar texto

const DUR = /^(?:(\d+)\s*d)?(?:(\d+)\s*h)?(?:(\d+)\s*m(?:in)?)?$/i;
const HHMM = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i;
const YMD = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const DMY = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/;

/** '30m', '2h', '1h30m', '1d' -> minutos. */
export function parseDur(tok: string): number | null {
  const m = tok.trim().match(DUR);
  if (!m || !(m[1] || m[2] || m[3])) return null;
  const total = (+(m[1] ?? 0)) * 1440 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0));
  return total || null;
}

/** '15:30', '3pm', '9:00am' -> [h, m]. '15' a secas no es hora. */
export function parseHHMM(tok: string): [number, number] | null {
  const m = tok.trim().match(HHMM);
  if (!m || (m[2] === undefined && m[3] === undefined)) return null;
  let h = +m[1];
  const mi = +(m[2] ?? 0);
  const ampm = (m[3] ?? "").toLowerCase();
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  if (h > 23 || mi > 59) return null;
  return [h, mi];
}

function validDate(y: number, m: number, d: number, tok: string): number {
  const ms = Date.UTC(y, m - 1, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new Error(`La fecha ${tok} no existe`);
  }
  return ms;
}

/** Día -> medianoche "naive", o null si no es un día. */
export function parseDay(tok: string, todayNaive: number): number | null {
  const t = tok.toLowerCase();
  if (t === "hoy") return todayNaive;
  if (t === "mañana" || t === "manana") return todayNaive + DAY;
  if (t === "pasado" || t === "pasadomañana" || t === "pasadomanana") return todayNaive + 2 * DAY;
  let m = t.match(YMD);
  if (m) return validDate(+m[1], +m[2], +m[3], tok);
  m = t.match(DMY);
  if (m) {
    const today = new Date(todayNaive);
    let y = m[3] ? +m[3] : today.getUTCFullYear();
    if (y < 100) y += 2000;
    let d = validDate(y, +m[2], +m[1], tok);
    if (!m[3] && d < todayNaive) d = validDate(y + 1, +m[2], +m[1], tok);
    return d;
  }
  return null;
}

/**
 * '<cuándo> <texto>' -> [utc, repetirMinutos, resto].
 * Ej: '30m dar vitamina', '15:30 baño', 'mañana 9:00 pediatra', '01/12 10:00 vacuna', 'cada 3h comer'.
 */
export function parseWhen(text: string, now: number, tz: string, allowRepeat = true): [number, number | null, string] {
  let tokens = text.split(/\s+/).filter(Boolean);
  if (!tokens.length) throw new Error("Falta la hora");
  const nowN = Math.floor(toNaive(now, tz) / MIN) * MIN;
  let repeat: number | null = null;
  let due: number;
  let x: number | null;
  let hm: [number, number] | null;

  if (allowRepeat && tokens[0].toLowerCase() === "cada" && tokens.length > 1 && (x = parseDur(tokens[1]))) {
    repeat = x;
    tokens = tokens.slice(2);
    due = nowN + x * MIN;
    if (tokens.length >= 2 && tokens[0].toLowerCase() === "desde" && (hm = parseHHMM(tokens[1]))) {
      due = setHM(nowN, hm[0], hm[1]);
      if (due <= nowN) due += DAY;
      tokens = tokens.slice(2);
    }
  } else if (tokens[0].toLowerCase() === "en" && tokens.length > 1 && (x = parseDur(tokens[1]))) {
    due = nowN + x * MIN;
    tokens = tokens.slice(2);
  } else if ((x = parseDur(tokens[0]))) {
    due = nowN + x * MIN;
    tokens = tokens.slice(1);
  } else if ((x = parseDay(tokens[0], startOfDay(nowN))) !== null) {
    hm = tokens.length > 1 ? parseHHMM(tokens[1]) : null;
    if (!hm) throw new Error("Después del día pon la hora, ej: mañana 9:00");
    due = x + hm[0] * HOUR + hm[1] * MIN;
    tokens = tokens.slice(2);
  } else if ((hm = parseHHMM(tokens[0]))) {
    due = setHM(nowN, hm[0], hm[1]);
    if (due <= nowN) due += DAY;
    tokens = tokens.slice(1);
  } else {
    throw new Error("No entendí la hora. Usa: 30m, 2h, 15:30, mañana 9:00, 01/12 10:00 o 'cada 3h'");
  }
  return [fromNaive(due, tz), repeat, tokens.join(" ").trim()];
}
