/** Lógica compartida entre la web, el bot y el cron. */

import type { Env } from "./env";
import * as T from "./time";
import { tgSend } from "./tg";
import { DEFAULT_OPTS, emailHtml, htmlToText, postEmail, type EmailCategory, type EmailOpts } from "./email";
import type { Keyboard } from "./tg";

export const KINDS = ["feed", "sleep", "diaper", "bath", "medicine", "temp", "weight", "note", "tummy", "activity"] as const;

export interface Entry {
  id: number; kind: string; start_at: number; end_at: number | null; detail: string | null;
  amount: number | null; note: string | null; author: string | null; created_at: number;
}
export interface Appointment {
  id: number; title: string; at: number; place: string | null; notes: string | null; done: number;
  notified_24h: number; notified_12h: number; notified_2h: number; author: string | null; gcal_event_id: string | null;
}
export interface Reminder {
  id: number; text: string; due_at: number; repeat_minutes: number | null; active: number; author: string | null;
  pre_60_sent: number; pre_10_sent: number; action: string | null; ends_at: number | null;
}
export interface Note { id: number; text: string; done: number; author: string | null; created_at: number }
export interface Caregiver { id: number; name: string; chat_id: string; notify_others: number }

export const KIND_LABEL: Record<string, string> = {
  feed: "🍼 Comida", sleep: "😴 Sueño", diaper: "🧷 Pañal", bath: "🛁 Baño",
  medicine: "💊 Medicina", temp: "🌡️ Temperatura", weight: "⚖️ Peso", note: "📝 Nota", tummy: "🧸 Tummy time", activity: "✨",
};
export const DETAIL_LABEL: Record<string, string> = {
  pecho_izq: "pecho izquierdo", pecho_der: "pecho derecho", pecho: "pecho", pecho_ambos: "ambos pechos", biberon: "biberón", formula: "fórmula",
  pipi: "pipí", popo: "popó", ambos: "pipí + popó",
};

export function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

const num = (x: number) => String(+x.toFixed(2));

export class App {
  db: D1Database;
  tz: string;
  babyName: string;
  feedAlertHours: number;

  constructor(public env: Env) {
    this.db = env.DB;
    this.tz = env.APP_TZ || "America/Bogota";
    this.babyName = env.BABY_NAME || "Aurora";
    const h = Number(env.FEED_ALERT_HOURS ?? "3");
    this.feedAlertHours = Number.isFinite(h) ? h : 3;
  }

  /** Solo pruebas: simular otra hora. */
  nowOverride: number | null = null;

  now(): number {
    return this.nowOverride ?? Date.now();
  }

  fmtTime(ms: number): string {
    return T.fmtTime(ms, this.now(), this.tz);
  }

  ago(ms: number): string {
    return T.ago(ms, this.now());
  }

  // ------------------------------------------------------------ textos

  describe(e: Entry): string {
    const note = e.note ? ` — ${e.note}` : "";
    const min = e.amount ? ` · ${num(e.amount)} min` : "";
    switch (e.kind) {
      case "feed": {
        const d = e.detail ?? "biberon";
        if (d.startsWith("pecho")) {
          const side = { pecho_izq: "Pecho izquierdo", pecho_der: "Pecho derecho", pecho_ambos: "Ambos pechos" }[d] ?? "Pecho";
          return `🤱 ${side}${min}${note}`;
        }
        return `🍼 ${d === "formula" ? "Fórmula" : "Tetero"}${e.amount ? ` · ${num(e.amount)} ml` : ""}${note}`;
      }
      case "diaper": {
        const icon = { pipi: "💧", popo: "💩", ambos: "💧💩" }[e.detail ?? ""] ?? "🧷";
        return `${icon} Pañal · ${DETAIL_LABEL[e.detail ?? ""] ?? e.detail ?? ""}${note}`;
      }
      case "sleep": {
        const end = e.end_at ?? this.now();
        return `😴 Sueño · ${T.fmtDur((end - e.start_at) / 1000)}${e.end_at ? "" : " (durmiendo)"}${note}`;
      }
      case "bath": return `🛁 Baño${note}`;
      case "medicine": return `💊 ${e.detail ?? "Medicina"}${note}`;
      case "temp": return `🌡️ ${e.amount ? num(e.amount) + " °C" : "Temperatura"}${note}`;
      case "weight": return `⚖️ ${e.amount ? num(e.amount) + " kg" : "Peso"}${note}`;
      case "tummy": return `🧸 Tummy time${min}${note}`;
      case "activity": return `✨ ${e.detail ?? "Actividad"}${min}${note}`;
      case "note": return `📝 ${e.note ?? "Nota"}`;
    }
    return `${KIND_LABEL[e.kind] ?? e.kind}${note}`;
  }

  entryOut(e: Entry) {
    return {
      id: e.id, kind: e.kind, start: T.iso(e.start_at), end: T.iso(e.end_at), detail: e.detail,
      amount: e.amount, note: e.note, author: e.author, text: this.describe(e),
    };
  }

  // ------------------------------------------------------------ kv

  async kvGet(key: string): Promise<string | null> {
    const r = await this.db.prepare("SELECT value FROM kv WHERE key = ?").bind(key).first<{ value: string }>();
    return r?.value ?? null;
  }

  async kvSet(key: string, value: string | null): Promise<void> {
    await this.db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(key, value).run();
  }

  // ------------------------------------------------------------ notificaciones

  async caregivers(): Promise<Caregiver[]> {
    return (await this.db.prepare("SELECT * FROM caregivers ORDER BY id").all<Caregiver>()).results;
  }

  async broadcast(text: string, opts: { excludeChat?: string | null; excludeName?: string | null; onlySubscribed?: boolean; kb?: Keyboard } = {}) {
    const tasks = [];
    for (const c of await this.caregivers()) {
      if (opts.excludeChat && c.chat_id === String(opts.excludeChat)) continue;
      if (opts.excludeName && c.name.trim().toLowerCase() === opts.excludeName.trim().toLowerCase()) continue;
      if (opts.onlySubscribed && !c.notify_others) continue;
      tasks.push(tgSend(this.env, c.chat_id, text, opts.kb));
    }
    await Promise.all(tasks);
    return tasks.length;
  }

  async notifyEntry(e: Entry, verb = "registró", excludeChat: string | null = null) {
    const who = escapeHtml(e.author || "Alguien");
    await this.broadcast(`👤 ${who} ${verb}: ${escapeHtml(this.describe(e))} (${this.fmtTime(e.start_at)})`, {
      excludeChat, excludeName: excludeChat ? null : e.author, onlySubscribed: true,
    });
  }

  // ------------------------------------------------------------ registros

  async createEntry(kind: string, author: string | null, o: {
    start?: number | null; end?: number | null; detail?: string | null; amount?: number | null; note?: string | null;
  } = {}): Promise<Entry> {
    const now = this.now();
    const start = o.start ?? now;
    const end = o.end ?? (kind === "sleep" ? null : start);
    return (await this.db.prepare(
      `INSERT INTO entries (kind, start_at, end_at, detail, amount, note, author, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    ).bind(kind, start, end, o.detail ?? null, o.amount ?? null, o.note ?? null, author, now).first<Entry>())!;
  }

  async getEntry(id: number): Promise<Entry | null> {
    return this.db.prepare("SELECT * FROM entries WHERE id = ?").bind(id).first<Entry>();
  }

  async activeSleep(): Promise<Entry | null> {
    return this.db.prepare("SELECT * FROM entries WHERE kind = 'sleep' AND end_at IS NULL ORDER BY start_at DESC LIMIT 1")
      .first<Entry>();
  }

  /** Devuelve [registro, seDurmio]. Si estaba dormida, la despierta. */
  async toggleSleep(author: string | null, at?: number | null): Promise<[Entry, boolean]> {
    const when = at ?? this.now();
    const current = await this.activeSleep();
    if (current) {
      const end = Math.max(when, current.start_at);
      await this.db.prepare("UPDATE entries SET end_at = ? WHERE id = ?").bind(end, current.id).run();
      return [{ ...current, end_at: end }, false];
    }
    return [await this.createEntry("sleep", author, { start: when }), true];
  }

  async lastOf(kind: string, details?: string[]): Promise<Entry | null> {
    if (details?.length) {
      return this.db.prepare(
        `SELECT * FROM entries WHERE kind = ? AND detail IN (${details.map(() => "?").join(",")})
         ORDER BY start_at DESC LIMIT 1`,
      ).bind(kind, ...details).first<Entry>();
    }
    return this.db.prepare("SELECT * FROM entries WHERE kind = ? ORDER BY start_at DESC LIMIT 1").bind(kind).first<Entry>();
  }

  todayNaive(): number {
    return T.startOfDay(T.toNaive(this.now(), this.tz));
  }

  dayBounds(dayNaive: number): [number, number] {
    return [T.fromNaive(dayNaive, this.tz), T.fromNaive(dayNaive + T.DAY, this.tz)];
  }

  async daySummary(dayNaive = this.todayNaive()) {
    const [start, end] = this.dayBounds(dayNaive);
    const rows = (await this.db.prepare(
      `SELECT * FROM entries WHERE start_at < ? AND (end_at IS NULL OR end_at >= ?) ORDER BY start_at DESC`,
    ).bind(end, start).all<Entry>()).results;
    const now = this.now();
    let sleepMs = 0;
    for (const e of rows) {
      if (e.kind === "sleep") sleepMs += Math.max(0, Math.min(e.end_at ?? now, end) - Math.max(e.start_at, start));
    }
    const inDay = rows.filter((e) => e.start_at >= start && e.start_at < end);
    const feeds = inDay.filter((e) => e.kind === "feed");
    const diapers = inDay.filter((e) => e.kind === "diaper");
    return {
      date: new Date(dayNaive).toISOString().slice(0, 10),
      feeds: feeds.length,
      feed_ml: feeds.filter((e) => e.detail === "biberon" || e.detail === "formula").reduce((a, e) => a + (e.amount ?? 0), 0),
      breast_feeds: feeds.filter((e) => (e.detail ?? "").startsWith("pecho")).length,
      diapers: diapers.length,
      pee: diapers.filter((e) => e.detail === "pipi" || e.detail === "ambos").length,
      poop: diapers.filter((e) => e.detail === "popo" || e.detail === "ambos").length,
      sleep_seconds: Math.floor(sleepMs / 1000),
      longest_sleep_seconds: Math.floor(Math.max(0, ...rows.filter((e) => e.kind === "sleep")
        .map((e) => Math.min(e.end_at ?? now, end) - Math.max(e.start_at, start))) / 1000),
      breast_minutes: feeds.filter((e) => (e.detail ?? "").startsWith("pecho")).reduce((a, e) => a + (e.amount ?? 0), 0),
      baths: inDay.filter((e) => e.kind === "bath").length,
      meds: inDay.filter((e) => e.kind === "medicine").map((e) => e.detail ?? "Medicina").reverse(),
      activities: inDay.filter((e) => e.kind === "activity" || e.kind === "tummy").map((e) => this.describe(e)).reverse(),
      max_temp: Math.max(0, ...inDay.filter((e) => e.kind === "temp").map((e) => e.amount ?? 0)) || null,
      weight: inDay.find((e) => e.kind === "weight")?.amount ?? null,
      entries: inDay,
    };
  }

  async upcomingAppointments(limit = 5): Promise<Appointment[]> {
    return (await this.db.prepare("SELECT * FROM appointments WHERE done = 0 AND at >= ? ORDER BY at LIMIT ?")
      .bind(this.now() - 3 * T.HOUR, limit).all<Appointment>()).results;
  }

  async activeReminders(limit = 20): Promise<Reminder[]> {
    return (await this.db.prepare("SELECT * FROM reminders WHERE active = 1 ORDER BY due_at LIMIT ?")
      .bind(limit).all<Reminder>()).results;
  }

  async birthDate(): Promise<string | null> {
    const v = await this.kvGet("birth_date");
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  }

  async ageText(): Promise<string | null> {
    const b = await this.birthDate();
    if (!b) return null;
    const days = Math.round((this.todayNaive() - Date.parse(b + "T00:00:00Z")) / T.DAY);
    if (days < 0) return days === -1 ? "falta 1 día para nacer" : `faltan ${-days} días para nacer`;
    if (days < 14) return days === 1 ? "1 día de vida" : `${days} días de vida`;
    if (days < 60) return `${Math.floor(days / 7)} semanas y ${days % 7} días`;
    return `${Math.floor(days / 30)} meses y ${days % 30} días`;
  }

  // ------------------------------------------------------------ textos para el bot

  async statusText(): Promise<string> {
    const age = await this.ageText();
    const out = [`👶 <b>${escapeHtml(this.babyName)}</b>${age ? ` · <i>${age}</i>` : ""}`];
    const q: string[] = [];
    const feed = await this.lastOf("feed");
    q.push(feed
      ? `🍼 <b>Comió</b> ${this.ago(feed.start_at)}\n<i>${escapeHtml(this.describe(feed).replace(/^\S+ /, ""))} · ${this.fmtTime(feed.start_at)}</i>`
      : "🍼 <i>Sin comidas registradas</i>");
    const sl = await this.activeSleep();
    if (sl) {
      q.push(`😴 <b>Durmiendo</b> hace ${T.fmtDur((this.now() - sl.start_at) / 1000)}\n<i>desde las ${this.fmtTime(sl.start_at)}</i>`);
    } else {
      const last = await this.lastOf("sleep");
      q.push(last?.end_at
        ? `😊 <b>Despierta</b> ${this.ago(last.end_at)}\n<i>durmió ${T.fmtDur((last.end_at - last.start_at) / 1000)}</i>`
        : "😴 <i>Sin sueños registrados</i>");
    }
    const dp = await this.lastOf("diaper");
    const poop = await this.lastOf("diaper", ["popo", "ambos"]);
    const bath = await this.lastOf("bath");
    const small = [
      dp ? `🧷 <b>Pañal</b> ${this.ago(dp.start_at)} · <i>${escapeHtml(DETAIL_LABEL[dp.detail ?? ""] ?? "")}</i>` : "🧷 <i>Sin pañales registrados</i>",
      poop ? `💩 <b>Popó</b> ${this.ago(poop.start_at)}` : "",
      bath ? `🛁 <b>Baño</b> ${this.ago(bath.start_at)}` : "",
    ].filter(Boolean).join("\n");
    q.push(small);
    out.push(`<blockquote>${q.join("\n\n")}</blockquote>`);
    const s = await this.daySummary();
    out.push(`📊 <b>Hoy</b>  🍼 ${s.feeds}${s.feed_ml ? ` (${num(s.feed_ml)} ml)` : ""}  ·  🧷 ${s.diapers}  ·  😴 ${s.sleep_seconds >= 60 ? T.fmtDur(s.sleep_seconds) : "0 min"}`);
    const [a] = await this.upcomingAppointments(1);
    if (a) out.push(`🩺 <b>Próximo control:</b> ${escapeHtml(a.title)} · ${this.fmtTime(a.at)}`);
    return out.join("\n");
  }

  async todayText(): Promise<string> {
    const s = await this.daySummary();
    if (!s.entries.length) return "📋 <b>Hoy</b>\n<i>Aún no hay registros. ¡Empieza con los botones de abajo!</i>";
    // Telegram admite 4096 caracteres: mostramos los más recientes que quepan.
    const rows: string[] = [];
    let size = 0;
    for (const e of s.entries) {
      const who = e.author ? ` <i>· ${escapeHtml(e.author)}</i>` : "";
      const row = `<code>${T.hhmm(T.toNaive(e.start_at, this.tz))}</code>  ${escapeHtml(this.describe(e).slice(0, 120))}${who}`;
      if (size + row.length > 3300) { rows.push("<i>… y más en la app web</i>"); break; }
      rows.unshift(row);
      size += row.length + 1;
    }
    if (rows[rows.length - 1]?.startsWith("<i>…")) rows.unshift(rows.pop()!);
    return `📋 <b>Hoy</b> · ${s.entries.length} registros\n`
      + `🍼 ${s.feeds} tomas${s.feed_ml ? ` (${num(s.feed_ml)} ml)` : ""} · 🧷 ${s.diapers} pañales · 😴 ${T.fmtDur(Math.max(60, s.sleep_seconds))}\n`
      + `<blockquote expandable>${rows.join("\n")}</blockquote>`;
  }

  repeatLabel(min: number): string {
    if (min === 1440) return "todos los días";
    if (min === 2880) return "cada 2 días";
    if (min === 10080) return "cada semana";
    return "cada " + T.fmtDur(min * 60);
  }

  async agendaText(): Promise<string> {
    const out = ["📅 <b>Agenda</b>"];
    const appts = await this.upcomingAppointments(10);
    out.push("\n🩺 <b>Controles</b>");
    out.push(appts.length
      ? `<blockquote>${appts.map((a) => `<b>${this.fmtTime(a.at)}</b> · ${escapeHtml(a.title)}${a.place ? `\n<i>📍 ${escapeHtml(a.place)}</i>` : ""}`).join("\n")}</blockquote>`
      : "<i>Ninguno. Escríbeme: «control con la pediatra el 2 de diciembre a las 9»</i>");
    const rems = await this.activeReminders(30);
    out.push("\n⏰ <b>Recordatorios</b>");
    out.push(rems.length
      ? `<blockquote expandable>${rems.map((r) => `<b>${this.fmtTime(r.due_at)}</b> · ${escapeHtml(r.text)}`
        + (r.repeat_minutes ? ` <i>(${this.repeatLabel(r.repeat_minutes)})</i>` : "") + ` <code>#${r.id}</code>`).join("\n")}</blockquote>`
      : "<i>Ninguno. Escríbeme: «recuérdame la vitamina D todos los días a las 8»</i>");
    return out.join("\n");
  }

  /** Resumen bonito del día (Telegram y correo). */
  async dailySummaryText(dayNaive = this.todayNaive()): Promise<string> {
    const [s, y] = await Promise.all([this.daySummary(dayNaive), this.daySummary(dayNaive - T.DAY)]);
    const age = await this.ageText();
    const date = new Date(dayNaive).toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
    const vs = (a: number, b: number) => (b ? ` <i>(ayer ${b}${a > b ? " ↑" : a < b ? " ↓" : ""})</i>` : "");
    const out = [`🌙 <b>Resumen del día · ${escapeHtml(this.babyName)}</b>`, `<i>${date}${age ? ` · ${age}` : ""}</i>`];

    const feedLines = [`<b>${s.feeds} tomas</b>${vs(s.feeds, y.feeds)}`];
    if (s.feed_ml) feedLines.push(`🍼 ${num(s.feed_ml)} ml en tetero`);
    if (s.breast_feeds) feedLines.push(`🤱 ${s.breast_feeds} veces pecho${s.breast_minutes ? ` (${num(s.breast_minutes)} min)` : ""}`);
    out.push(`\n🍼 <b>Alimentación</b>\n<blockquote>${feedLines.join("\n")}</blockquote>`);

    out.push(`🧷 <b>Pañales</b>\n<blockquote><b>${s.diapers} cambios</b>${vs(s.diapers, y.diapers)}\n💧 ${s.pee} pipí · 💩 ${s.poop} popó</blockquote>`);

    const ys = y.sleep_seconds ? ` <i>(ayer ${T.fmtDur(y.sleep_seconds)})</i>` : "";
    out.push(`😴 <b>Sueño</b>\n<blockquote><b>${s.sleep_seconds >= 60 ? T.fmtDur(s.sleep_seconds) : "Sin registrar"}</b>${ys}`
      + (s.longest_sleep_seconds >= 600 ? `\nTramo más largo: ${T.fmtDur(s.longest_sleep_seconds)}` : "") + "</blockquote>");

    const care = [
      s.baths ? `🛁 ${s.baths > 1 ? s.baths + " baños" : "Baño"}` : "",
      ...s.meds.slice(0, 10).map((m) => `💊 ${escapeHtml(m)}`),
      ...s.activities.slice(0, 12).map((a) => escapeHtml(a.slice(0, 100))),
      s.activities.length > 12 ? `<i>… y ${s.activities.length - 12} más</i>` : "",
      s.max_temp ? `🌡️ Temperatura máx. ${num(s.max_temp)} °C${s.max_temp >= 38 ? " ⚠️" : ""}` : "",
      s.weight ? `⚖️ Peso ${num(s.weight)} kg` : "",
    ].filter(Boolean);
    if (care.length) out.push(`✨ <b>Cuidados</b>\n<blockquote>${care.join("\n")}</blockquote>`);

    const [dayStart] = this.dayBounds(dayNaive + T.DAY);
    const dayEnd = dayStart + T.DAY;
    const [appts, rems] = await Promise.all([
      this.db.prepare("SELECT * FROM appointments WHERE done = 0 AND at >= ? AND at < ? ORDER BY at").bind(dayStart, dayEnd).all<Appointment>(),
      this.db.prepare("SELECT * FROM reminders WHERE active = 1 AND due_at >= ? AND due_at < ? ORDER BY due_at LIMIT 8").bind(dayStart, dayEnd).all<Reminder>(),
    ]);
    const tomorrow = [
      ...appts.results.map((a) => `🩺 <b>${T.hhmm(T.toNaive(a.at, this.tz))}</b> ${escapeHtml(a.title)}`),
      ...rems.results.map((r) => `⏰ <b>${T.hhmm(T.toNaive(r.due_at, this.tz))}</b> ${escapeHtml(r.text)}`),
    ];
    if (tomorrow.length) out.push(`📅 <b>Mañana</b>\n<blockquote>${tomorrow.join("\n")}</blockquote>`);

    const notes = (await this.listNotes(false, 100)).length;
    if (notes) out.push(`📝 ${notes === 1 ? "1 nota pendiente" : `${notes} notas pendientes`}`);
    out.push("\n<i>¡Buenas noches! 🌙 Descansen cuando ella descanse.</i>");
    return out.join("\n");
  }

  parseWhen(text: string, allowRepeat = true) {
    return T.parseWhen(text, this.now(), this.tz, allowRepeat);
  }

  // ------------------------------------------------------------ correo

  async emailConfig(): Promise<{ url: string | null; to: string[]; opts: EmailOpts }> {
    const [url, to, opts] = await Promise.all([this.kvGet("email_url"), this.kvGet("email_to"), this.kvGet("email_opts")]);
    let list: string[] = [];
    let o: EmailOpts = { ...DEFAULT_OPTS };
    try { list = JSON.parse(to ?? "[]"); } catch { /* vacío */ }
    try { o = { ...DEFAULT_OPTS, ...JSON.parse(opts ?? "{}") }; } catch { /* default */ }
    return { url, to: Array.isArray(list) ? list : [], opts: o };
  }

  /** Envía un correo si está configurado y esa categoría está activada. */
  async email(category: EmailCategory, subject: string, tgHtml: string): Promise<{ ok: boolean; error?: string }> {
    const cfg = await this.emailConfig();
    if (!cfg.url || !cfg.to.length) return { ok: false, error: "Correo no configurado" };
    if (category !== "test" && !cfg.opts[category]) return { ok: false, error: "Categoría desactivada" };
    const appUrl = await this.kvGet("app_url");
    const html = emailHtml(subject, tgHtml, appUrl);
    const res = await postEmail(this.env, cfg.url, { to: cfg.to, subject, html, text: htmlToText(tgHtml) });
    if (!res.ok) console.warn("Correo falló", res.error);
    return res;
  }

  /** Telegram a todos + correo (si aplica). */
  async alert(category: EmailCategory | null, subject: string, tgHtml: string, kb?: Keyboard) {
    await Promise.all([this.broadcast(tgHtml, { kb }), category ? this.email(category, subject, tgHtml) : null]);
  }

  // ------------------------------------------------------------ Google Calendar (vía el mismo script de Gmail)

  async scriptCall(payload: Record<string, unknown>) {
    const url = await this.kvGet("email_url");
    if (!url) return { ok: false, error: "Script no configurado" } as { ok: boolean; error?: string; id?: string; version?: number };
    return postEmail(this.env, url, payload) as Promise<{ ok: boolean; error?: string; id?: string; version?: number }>;
  }

  /** ¿El script del usuario ya sabe crear eventos? (versión 2+) */
  async calendarReady(): Promise<boolean> {
    return Number(await this.kvGet("script_version")) >= 2 && (await this.kvGet("calendar_auto")) !== "0";
  }

  async checkScript(): Promise<number> {
    const r = await this.scriptCall({ action: "ping" });
    const v = r.ok && typeof r.version === "number" ? r.version : 1;
    await this.kvSet("script_version", String(v));
    return v;
  }

  /** Crea el evento del control en Google Calendar (e invita a los demás correos). */
  async calendarCreate(a: Appointment): Promise<boolean> {
    if (!(await this.calendarReady())) return false;
    const cfg = await this.emailConfig();
    const r = await this.scriptCall({
      action: "calendar_create", title: `🩺 ${a.title} (${this.babyName})`, start: a.at, end: a.at + T.HOUR,
      location: a.place ?? "", description: "Agendado con Tasky", guests: cfg.to, popups: [1440, 720, 120],
    });
    if (r.ok && r.id) {
      await this.db.prepare("UPDATE appointments SET gcal_event_id = ? WHERE id = ?").bind(r.id, a.id).run();
      return true;
    }
    console.warn("Calendar falló", r.error);
    return false;
  }

  async calendarDelete(a: Appointment): Promise<void> {
    if (!a.gcal_event_id) return;
    await this.scriptCall({ action: "calendar_delete", id: a.gcal_event_id });
  }

  // ------------------------------------------------------------ crear recordatorios y controles

  /** Recordatorio a minuto exacto, con avisos previos según el caso. */
  async createReminder(o: { text: string; due: number; repeat?: number | null; action?: string | null; endsAt?: number | null; author: string | null }): Promise<Reminder> {
    const now = this.now();
    const due = Math.floor(o.due / T.MIN) * T.MIN;
    const lead = due - now;
    const repeat = o.repeat ?? null;
    // Simple: 1 h y 10 min antes. Repetitivo: solo 10 min antes si es cada 3 h o más.
    const pre60 = !repeat && lead > 70 * T.MIN ? 0 : 1;
    const pre10 = lead > 15 * T.MIN && (!repeat || repeat >= 180) ? 0 : 1;
    return (await this.db.prepare(
      `INSERT INTO reminders (text, due_at, repeat_minutes, active, author, pre_60_sent, pre_10_sent, action, ends_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?) RETURNING *`,
    ).bind(o.text.slice(0, 200), due, repeat, o.author, pre60, pre10, o.action ?? null, o.endsAt ?? null).first<Reminder>())!;
  }

  /** Control médico: avisos 24 h, 12 h y 2 h antes (los que ya pasaron se omiten) + Google Calendar. */
  async createAppointment(o: { title: string; at: number; place?: string | null; notes?: string | null; author: string | null }): Promise<[Appointment, boolean]> {
    const at = Math.floor(o.at / T.MIN) * T.MIN;
    const left = at - this.now();
    const a = (await this.db.prepare(
      `INSERT INTO appointments (title, at, place, notes, author, notified_24h, notified_12h, notified_2h)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    ).bind(o.title.slice(0, 120), at, o.place?.slice(0, 160) || null, o.notes ?? null, o.author,
      left <= 24 * T.HOUR ? 1 : 0, left <= 12 * T.HOUR ? 1 : 0, left <= 2 * T.HOUR ? 1 : 0).first<Appointment>())!;
    const cal = await this.calendarCreate(a);
    return [a, cal];
  }

  async deleteAppointment(id: number): Promise<Appointment | null> {
    const a = await this.db.prepare("SELECT * FROM appointments WHERE id = ?").bind(id).first<Appointment>();
    if (!a) return null;
    await this.db.prepare("DELETE FROM appointments WHERE id = ?").bind(id).run();
    await this.calendarDelete(a);
    return a;
  }

  // ------------------------------------------------------------ libreta de notas

  async addNote(text: string, author: string | null): Promise<Note> {
    return (await this.db.prepare("INSERT INTO notes (text, author, created_at) VALUES (?, ?, ?) RETURNING *")
      .bind(text.trim().slice(0, 1000), author, this.now()).first<Note>())!;
  }

  async listNotes(includeDone = false, limit = 50): Promise<Note[]> {
    return (await this.db.prepare(
      `SELECT * FROM notes ${includeDone ? "" : "WHERE done = 0"} ORDER BY done, created_at DESC LIMIT ?`,
    ).bind(limit).all<Note>()).results;
  }

  async notesText(): Promise<string> {
    const notes = await this.listNotes(false, 30);
    if (!notes.length) return "📝 <b>Notas</b>\nNo tienes notas pendientes. Escribe <i>«anota: …»</i> para guardar una.";
    return "📝 <b>Notas pendientes</b>\n" + notes.map((n, i) => `${i + 1}. ${escapeHtml(n.text)}`).join("\n");
  }

  async dailySummaryHtml(): Promise<string> {
    return `${await this.dailySummaryText()}\n\n${await this.todayText()}`;
  }

  // ------------------------------------------------------------ recordatorios automáticos (cron cada minuto)

  async tick(): Promise<string[]> {
    if (!this.env.FAMILY_PIN || !this.env.TELEGRAM_TOKEN) return [];
    const now = this.now();
    const sent: string[] = [];

    // Todo lo que vence dentro de este minuto sale ahora (la 1:02 sale a la 1:02, no a la 1:03).
    const until = Math.floor(now / T.MIN) * T.MIN + T.MIN;

    // Avisos previos: 1 h y 10 min antes
    const pres = (await this.db.prepare(
      `SELECT * FROM reminders WHERE active = 1 AND due_at >= ?
       AND ((pre_60_sent = 0 AND due_at - 3600000 < ?) OR (pre_10_sent = 0 AND due_at - 600000 < ?))`,
    ).bind(until, until, until).all<Reminder>()).results;
    for (const r of pres) {
      const in10 = !r.pre_10_sent && r.due_at - 10 * T.MIN < until;
      await this.db.prepare(`UPDATE reminders SET pre_60_sent = 1${in10 ? ", pre_10_sent = 1" : ""} WHERE id = ?`).bind(r.id).run();
      const label = in10 ? "En 10 minutos" : "En 1 hora";
      await this.alert(in10 ? null : "reminders", `⏰ ${label}: ${r.text}`,
        `⏰ <b>${label}</b> (${this.fmtTime(r.due_at)}): ${escapeHtml(r.text)}`);
      sent.push(`pre${in10 ? 10 : 60}:${r.id}`);
    }

    const due = (await this.db.prepare("SELECT * FROM reminders WHERE active = 1 AND due_at < ?").bind(until).all<Reminder>()).results;
    for (const r of due) {
      let msg = `⏰ <b>Recordatorio:</b> ${escapeHtml(r.text)}`;
      const firedAt = r.due_at;
      if (r.repeat_minutes) {
        let next = r.due_at;
        while (next < until) next += r.repeat_minutes * T.MIN;
        if (r.ends_at && next > r.ends_at) {
          await this.db.prepare("UPDATE reminders SET active = 0 WHERE id = ?").bind(r.id).run();
          msg += "\n<i>✅ Fue la última dosis/vez programada.</i>";
        } else {
          const pre10 = r.repeat_minutes >= 180 ? 0 : 1;
          await this.db.prepare("UPDATE reminders SET due_at = ?, pre_10_sent = ?, pre_60_sent = 1 WHERE id = ?").bind(next, pre10, r.id).run();
          msg += `\n<i>Próximo: ${this.fmtTime(next)}</i>`;
        }
      } else {
        await this.db.prepare("UPDATE reminders SET active = 0 WHERE id = ?").bind(r.id).run();
      }
      await this.alert("reminders", `⏰ Recordatorio: ${r.text}`, msg, [[
        { text: "✅ Hecho", callback_data: `rdone:${r.id}:${Math.floor(firedAt / T.MIN)}` },
        { text: "⏰ En 10 min", callback_data: `rsnz:${r.id}` },
      ]]);
      sent.push(`reminder:${r.id}`);
    }

    // Controles: 24 h, 12 h y 2 h antes
    const appts = (await this.db.prepare(
      `SELECT * FROM appointments WHERE done = 0 AND at >= ? AND at < ?
       AND (notified_24h = 0 OR notified_12h = 0 OR notified_2h = 0)`,
    ).bind(until, until + 24 * T.HOUR).all<Appointment>()).results;
    for (const a of appts) {
      const left = a.at - until; // tiempo desde el final de este minuto
      const place = a.place ? `\n📍 ${escapeHtml(a.place)}` : "";
      const leftText = T.fmtDur((a.at - now) / 1000);
      let stage: string | null = null;
      if (!a.notified_2h && left < 2 * T.HOUR) {
        stage = "2h";
        await this.db.prepare("UPDATE appointments SET notified_2h = 1, notified_12h = 1, notified_24h = 1 WHERE id = ?").bind(a.id).run();
      } else if (!a.notified_12h && left < 12 * T.HOUR) {
        stage = "12h";
        await this.db.prepare("UPDATE appointments SET notified_12h = 1, notified_24h = 1 WHERE id = ?").bind(a.id).run();
      } else if (!a.notified_24h) {
        stage = "24h";
        await this.db.prepare("UPDATE appointments SET notified_24h = 1 WHERE id = ?").bind(a.id).run();
      }
      if (!stage) continue;
      await this.alert("appointments", `🩺 Control en ${leftText}: ${a.title}`,
        `🩺 <b>Control en ${leftText}:</b> ${escapeHtml(a.title)}\n🕐 ${this.fmtTime(a.at)}${place}`);
      sent.push(`appt${stage}:${a.id}`);
    }

    if (this.feedAlertHours > 0) {
      const last = await this.lastOf("feed");
      if (last && now - last.start_at >= this.feedAlertHours * T.HOUR && (await this.kvGet("feed_alert_for")) !== String(last.id)) {
        await this.kvSet("feed_alert_for", String(last.id));
        const since = T.fmtDur((now - last.start_at) / 1000);
        await this.alert("feed", `🍼 ${since} sin comer`, `🍼 Ya pasaron ${since} desde la última comida de `
          + `${escapeHtml(this.babyName)} (${this.fmtTime(last.start_at)}).`);
        sent.push(`feed_alert:${last.id}`);
      }
    }

    // resumen diario por Telegram (por defecto 9 p. m.)
    {
      const n = T.toNaive(now, this.tz);
      const day = new Date(n).toISOString().slice(0, 10);
      const h = await this.kvGet("tg_summary_hour");
      const hourTg = h === null ? 21 : Number(h); // -1 = apagado
      if (hourTg >= 0 && new Date(n).getUTCHours() >= hourTg && (await this.kvGet("tg_summary_sent")) !== day) {
        await this.kvSet("tg_summary_sent", day);
        await this.broadcast(await this.dailySummaryText(), { kb: [[
          { text: "📋 Ver todo lo de hoy", callback_data: "m:today" },
          { text: "🕘 Cambiar hora", callback_data: "sumh" },
        ]] });
        sent.push(`tg_summary:${day}`);
      }
    }

    // resumen diario por correo, una vez al día a partir de la hora elegida
    const nowN = T.toNaive(now, this.tz);
    const today = new Date(nowN).toISOString().slice(0, 10);
    const hour = new Date(nowN).getUTCHours();
    const cfg = await this.emailConfig();
    if (cfg.url && cfg.to.length && cfg.opts.summary && hour >= cfg.opts.summary_hour
      && (await this.kvGet("summary_sent")) !== today) {
      await this.kvSet("summary_sent", today);
      const d = new Date(nowN).toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
      await this.email("summary", `📋 Resumen de ${this.babyName} · ${d}`, await this.dailySummaryHtml());
      sent.push(`summary:${today}`);
    }

    // limpieza ocasional de intentos de PIN viejos
    if (new Date(now).getUTCMinutes() === 0) {
      await this.db.prepare("DELETE FROM auth_fails WHERE ts < ?").bind(now - T.DAY).run();
    }
    return sent;
  }

  // ------------------------------------------------------------ límite de intentos de PIN

  async pinBlocked(keys: [string, number][]): Promise<boolean> {
    const since = this.now() - 15 * T.MIN;
    for (const [key, max] of keys) {
      const r = await this.db.prepare("SELECT COUNT(*) AS n FROM auth_fails WHERE key = ? AND ts > ?").bind(key, since).first<{ n: number }>();
      if ((r?.n ?? 0) >= max) return true;
    }
    return false;
  }

  async pinFail(keys: string[]): Promise<void> {
    const now = this.now();
    await this.db.batch(keys.map((k) => this.db.prepare("INSERT INTO auth_fails (key, ts) VALUES (?, ?)").bind(k, now)));
  }
}
