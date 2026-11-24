/** Lógica compartida entre la web, el bot y el cron. */

import type { Env } from "./env";
import * as T from "./time";
import { tgSend } from "./tg";

export const KINDS = ["feed", "sleep", "diaper", "bath", "medicine", "temp", "weight", "note"] as const;

export interface Entry {
  id: number; kind: string; start_at: number; end_at: number | null; detail: string | null;
  amount: number | null; note: string | null; author: string | null; created_at: number;
}
export interface Appointment {
  id: number; title: string; at: number; place: string | null; notes: string | null; done: number;
  notified_24h: number; notified_2h: number; author: string | null;
}
export interface Reminder {
  id: number; text: string; due_at: number; repeat_minutes: number | null; active: number; author: string | null;
}
export interface Caregiver { id: number; name: string; chat_id: string; notify_others: number }

export const KIND_LABEL: Record<string, string> = {
  feed: "🍼 Comida", sleep: "😴 Sueño", diaper: "🧷 Pañal", bath: "🛁 Baño",
  medicine: "💊 Medicina", temp: "🌡️ Temperatura", weight: "⚖️ Peso", note: "📝 Nota",
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

  now(): number {
    return Date.now();
  }

  fmtTime(ms: number): string {
    return T.fmtTime(ms, this.now(), this.tz);
  }

  ago(ms: number): string {
    return T.ago(ms, this.now());
  }

  // ------------------------------------------------------------ textos

  describe(e: Entry): string {
    const parts = [KIND_LABEL[e.kind] ?? e.kind];
    if (e.kind === "feed") {
      if (e.detail) parts.push(DETAIL_LABEL[e.detail] ?? e.detail);
      if (e.amount) parts.push(`${num(e.amount)} ${(e.detail ?? "").startsWith("pecho") ? "min" : "ml"}`);
    } else if (e.kind === "sleep") {
      const end = e.end_at ?? this.now();
      parts.push(T.fmtDur((end - e.start_at) / 1000) + (e.end_at ? "" : " (durmiendo)"));
    } else if (e.kind === "diaper") {
      parts.push(DETAIL_LABEL[e.detail ?? ""] ?? e.detail ?? "");
    } else if (e.kind === "temp" && e.amount) {
      parts.push(`${num(e.amount)} °C`);
    } else if (e.kind === "weight" && e.amount) {
      parts.push(`${num(e.amount)} kg`);
    } else if (e.kind === "medicine" && e.detail) {
      parts.push(e.detail);
    }
    let text = parts.filter(Boolean).join(" · ");
    if (e.note) text += ` — ${e.note}`;
    return text;
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

  async broadcast(text: string, opts: { excludeChat?: string | null; excludeName?: string | null; onlySubscribed?: boolean } = {}) {
    const tasks = [];
    for (const c of await this.caregivers()) {
      if (opts.excludeChat && c.chat_id === String(opts.excludeChat)) continue;
      if (opts.excludeName && c.name.trim().toLowerCase() === opts.excludeName.trim().toLowerCase()) continue;
      if (opts.onlySubscribed && !c.notify_others) continue;
      tasks.push(tgSend(this.env, c.chat_id, text));
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
      baths: inDay.filter((e) => e.kind === "bath").length,
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
    const lines = [`<b>👶 ${escapeHtml(this.babyName)}</b>` + (age ? ` · ${age}` : "")];
    const feed = await this.lastOf("feed");
    lines.push(feed
      ? `🍼 Última comida: ${escapeHtml(this.describe(feed))}, ${this.ago(feed.start_at)} (${this.fmtTime(feed.start_at)})`
      : "🍼 Sin comidas registradas");
    const sl = await this.activeSleep();
    if (sl) {
      lines.push(`😴 Durmiendo desde ${this.fmtTime(sl.start_at)} (${T.fmtDur((this.now() - sl.start_at) / 1000)})`);
    } else {
      const last = await this.lastOf("sleep");
      lines.push(last?.end_at
        ? `😊 Despierta desde ${this.fmtTime(last.end_at)} (${this.ago(last.end_at)}). Último sueño: ${T.fmtDur((last.end_at - last.start_at) / 1000)}`
        : "😴 Sin sueños registrados");
    }
    const dp = await this.lastOf("diaper");
    lines.push(dp
      ? `🧷 Último pañal: ${escapeHtml(DETAIL_LABEL[dp.detail ?? ""] ?? dp.detail ?? "")}, ${this.ago(dp.start_at)}`
      : "🧷 Sin pañales registrados");
    const poop = await this.lastOf("diaper", ["popo", "ambos"]);
    if (poop && poop.id !== dp?.id) lines.push(`💩 Última popó: ${this.ago(poop.start_at)}`);
    const bath = await this.lastOf("bath");
    if (bath) lines.push(`🛁 Último baño: ${this.ago(bath.start_at)}`);
    const s = await this.daySummary();
    lines.push("");
    lines.push(`<b>Hoy:</b> ${s.feeds} tomas` + (s.feed_ml ? ` (${num(s.feed_ml)} ml)` : "")
      + ` · ${s.diapers} pañales (${s.pee} pipí, ${s.poop} popó)`
      + ` · sueño ${s.sleep_seconds >= 60 ? T.fmtDur(s.sleep_seconds) : "0 min"}`);
    const [a] = await this.upcomingAppointments(1);
    if (a) lines.push(`📅 Próximo control: ${escapeHtml(a.title)} — ${this.fmtTime(a.at)}`);
    return lines.join("\n");
  }

  async todayText(): Promise<string> {
    const s = await this.daySummary();
    if (!s.entries.length) return "Hoy no hay registros todavía.";
    const lines = ["<b>📋 Registros de hoy</b>"];
    for (const e of [...s.entries].reverse().slice(0, 60)) {
      const who = e.author ? ` <i>(${escapeHtml(e.author)})</i>` : "";
      lines.push(`${T.hhmm(T.toNaive(e.start_at, this.tz))} ${escapeHtml(this.describe(e))}${who}`);
    }
    return lines.join("\n");
  }

  repeatLabel(min: number): string {
    if (min === 1440) return "todos los días";
    if (min === 10080) return "cada semana";
    return "cada " + T.fmtDur(min * 60);
  }

  async agendaText(): Promise<string> {
    const lines = ["<b>📅 Próximos controles</b>"];
    const appts = await this.upcomingAppointments(10);
    if (appts.length) {
      for (const a of appts) lines.push(`• ${this.fmtTime(a.at)} — ${escapeHtml(a.title)}` + (a.place ? ` (${escapeHtml(a.place)})` : ""));
    } else lines.push("Ninguno. Agrega con /control");
    lines.push("\n<b>⏰ Recordatorios</b>");
    const rems = await this.activeReminders();
    if (rems.length) {
      for (const r of rems) {
        lines.push(`• #${r.id} ${this.fmtTime(r.due_at)} — ${escapeHtml(r.text)}`
          + (r.repeat_minutes ? ` (${this.repeatLabel(r.repeat_minutes)})` : ""));
      }
    } else lines.push("Ninguno. Agrega con /recordar");
    return lines.join("\n");
  }

  parseWhen(text: string, allowRepeat = true) {
    return T.parseWhen(text, this.now(), this.tz, allowRepeat);
  }

  // ------------------------------------------------------------ recordatorios automáticos (cron cada minuto)

  async tick(): Promise<string[]> {
    if (!this.env.FAMILY_PIN || !this.env.TELEGRAM_TOKEN) return [];
    const now = this.now();
    const sent: string[] = [];

    const due = (await this.db.prepare("SELECT * FROM reminders WHERE active = 1 AND due_at <= ?").bind(now).all<Reminder>()).results;
    for (const r of due) {
      let msg = `⏰ <b>Recordatorio:</b> ${escapeHtml(r.text)}`;
      if (r.repeat_minutes) {
        let next = r.due_at;
        while (next <= now) next += r.repeat_minutes * T.MIN;
        await this.db.prepare("UPDATE reminders SET due_at = ? WHERE id = ?").bind(next, r.id).run();
        msg += `\n<i>Próximo: ${this.fmtTime(next)}</i>`;
      } else {
        await this.db.prepare("UPDATE reminders SET active = 0 WHERE id = ?").bind(r.id).run();
      }
      await this.broadcast(msg);
      sent.push(`reminder:${r.id}`);
    }

    const appts = (await this.db.prepare(
      `SELECT * FROM appointments WHERE done = 0 AND at > ? AND at <= ?
       AND (notified_24h = 0 OR notified_2h = 0)`,
    ).bind(now, now + 24 * T.HOUR).all<Appointment>()).results;
    for (const a of appts) {
      const left = a.at - now;
      const place = a.place ? `\n📍 ${escapeHtml(a.place)}` : "";
      if (!a.notified_2h && left <= 2 * T.HOUR) {
        await this.db.prepare("UPDATE appointments SET notified_2h = 1, notified_24h = 1 WHERE id = ?").bind(a.id).run();
        await this.broadcast(`📅 <b>Control en ${T.fmtDur(left / 1000)}:</b> ${escapeHtml(a.title)} (${this.fmtTime(a.at)})${place}`);
        sent.push(`appt2h:${a.id}`);
      } else if (!a.notified_24h) {
        await this.db.prepare("UPDATE appointments SET notified_24h = 1 WHERE id = ?").bind(a.id).run();
        await this.broadcast(`📅 <b>Próximo control:</b> ${escapeHtml(a.title)} — ${this.fmtTime(a.at)}${place}`);
        sent.push(`appt24h:${a.id}`);
      }
    }

    if (this.feedAlertHours > 0) {
      const last = await this.lastOf("feed");
      if (last && now - last.start_at >= this.feedAlertHours * T.HOUR && (await this.kvGet("feed_alert_for")) !== String(last.id)) {
        await this.kvSet("feed_alert_for", String(last.id));
        await this.broadcast(`🍼 Ya pasaron ${T.fmtDur((now - last.start_at) / 1000)} desde la última comida de `
          + `${escapeHtml(this.babyName)} (${this.fmtTime(last.start_at)}).`);
        sent.push(`feed_alert:${last.id}`);
      }
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
