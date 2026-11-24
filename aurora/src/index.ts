import { handleUpdate, setupWebhook, timingSafeEqual } from "./bot";
import { HttpError, type Env } from "./env";
import { App, Appointment, Entry, escapeHtml, KINDS, Note, Reminder } from "./logic";
import { tgEnabled } from "./tg";
import { DEFAULT_OPTS, emailKey, googleCalendarUrl, hmacHex, isEmail, normalizeScriptUrl, SCRIPT_VERSION, scriptCode } from "./email";
import * as T from "./time";

// ------------------------------------------------------------------ utilidades

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });


// Cambiar el PIN o la SECRET_KEY invalida todas las sesiones.
const webToken = (env: Env) => hmacHex(env.SECRET_KEY, "web:" + env.FAMILY_PIN);
export const webhookSecret = async (env: Env) => (await hmacHex(env.SECRET_KEY, "telegram-webhook")).slice(0, 48);

async function body(req: Request): Promise<Record<string, any>> {
  try {
    const b = await req.json();
    if (b && typeof b === "object" && !Array.isArray(b)) return b as Record<string, any>;
  } catch { /* vacío */ }
  throw new HttpError(422, "JSON inválido");
}

function str(v: unknown, max: number, field: string, required = false): string | null {
  if (v == null || v === "") {
    if (required) throw new HttpError(422, `Falta ${field}`);
    return null;
  }
  const s = String(v).trim();
  if (required && !s) throw new HttpError(422, `Falta ${field}`);
  if (s.length > max) throw new HttpError(422, `${field} es muy largo`);
  return s || null;
}

function amountOf(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (typeof v === "boolean" || !Number.isFinite(n) || n < 0 || n > 100000) throw new HttpError(422, "Cantidad inválida");
  return n;
}

function dateOf(app: App, v: unknown, field: string, required = false): number | null {
  try {
    const ms = T.parseIso(v, app.tz);
    if (ms === null && required) throw new HttpError(422, `Falta ${field}`);
    return ms;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(422, `${field}: fecha inválida`);
  }
}

function idOf(s: string): number {
  if (!/^\d+$/.test(s)) throw new HttpError(404, "No encontrado");
  return Number(s);
}

const apptOut = (a: Appointment) => ({
  id: a.id, title: a.title, at: T.iso(a.at), place: a.place, notes: a.notes, done: !!a.done,
  calendar_url: googleCalendarUrl(a.title, a.at, a.place), in_calendar: !!a.gcal_event_id,
});
const noteOut = (n: Note) => ({ id: n.id, text: n.text, done: !!n.done, author: n.author, created_at: T.iso(n.created_at) });
const remOut = (r: Reminder) => ({
  id: r.id, text: r.text, due_at: T.iso(r.due_at), repeat_minutes: r.repeat_minutes, active: !!r.active,
  ends_at: T.iso(r.ends_at), action: r.action,
});

// ------------------------------------------------------------------ rutas

async function route(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;
  const app = new App(env);

  if (path === "/healthz") return json({ ok: true });

  // ---------------- Telegram
  if (path === "/telegram/webhook" && method === "POST") {
    if (!env.FAMILY_PIN || !env.SECRET_KEY) return json({ ok: true });
    const got = req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
    if (!timingSafeEqual(got, await webhookSecret(env))) return json({ detail: "forbidden" }, 403);
    const update = await req.json().catch(() => null);
    if (update) await handleUpdate(app, update);
    return json({ ok: true });
  }

  // ---------------- pruebas locales
  if (path.startsWith("/__test/")) {
    if (env.TEST_MODE !== "1") return json({ detail: "No encontrado" }, 404);
    if (path === "/__test/reset") {
      await env.DB.batch(["entries", "appointments", "reminders", "caregivers", "kv", "auth_fails", "chat_state", "notes"]
        .map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
      return json({ ok: true });
    }
    if (path === "/__test/tick") {
      const at = url.searchParams.get("at");
      if (at) app.nowOverride = Number(at);
      return json({ sent: await app.tick() });
    }
    if (path === "/__test/webhook-secret") return json({ secret: await webhookSecret(env) });
  }

  if (!path.startsWith("/api/")) return env.ASSETS.fetch(req);

  if (!env.FAMILY_PIN || !env.SECRET_KEY) {
    throw new HttpError(503, "Falta configurar el PIN familiar en Cloudflare (npx wrangler secret put FAMILY_PIN)");
  }

  // ---------------- login
  if (path === "/api/login" && method === "POST") {
    const ip = req.headers.get("CF-Connecting-IP") ?? "?";
    if (await app.pinBlocked([["ip:" + ip, 5], ["web", 20]])) throw new HttpError(429, "Demasiados intentos. Espera 15 minutos.");
    const b = await body(req);
    if (!timingSafeEqual(String(b.pin ?? "").trim(), env.FAMILY_PIN)) {
      await app.pinFail(["ip:" + ip, "web"]);
      throw new HttpError(401, "PIN incorrecto");
    }
    return json({ token: await webToken(env), baby_name: app.babyName });
  }

  // ---------------- todo lo demás requiere sesión
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!timingSafeEqual(token, await webToken(env))) throw new HttpError(401, "No autorizado");
  let author: string | null = null;
  try { author = decodeURIComponent(req.headers.get("X-Author") ?? "").trim().slice(0, 60) || null; } catch { /* nada */ }

  let m: RegExpMatchArray | null;

  if (path === "/api/status" && method === "GET") {
    if ((await app.kvGet("app_url")) !== url.origin) await app.kvSet("app_url", url.origin);
    const s = await app.daySummary();
    const { entries: _omit, ...today } = s;
    const out = async (e: Promise<Entry | null>) => { const x = await e; return x ? app.entryOut(x) : null; };
    const [feed, sleep, diaper, poop, bath, medicine, temp, weight, sleeping] = await Promise.all([
      out(app.lastOf("feed")), out(app.lastOf("sleep")), out(app.lastOf("diaper")), out(app.lastOf("diaper", ["popo", "ambos"])),
      out(app.lastOf("bath")), out(app.lastOf("medicine")), out(app.lastOf("temp")), out(app.lastOf("weight")), out(app.activeSleep()),
    ]);
    return json({
      baby_name: app.babyName,
      birth_date: await app.birthDate(),
      age: await app.ageText(),
      feed_alert_hours: app.feedAlertHours,
      server_time: T.iso(app.now()),
      last: { feed, sleep, diaper, poop, bath, medicine, temp, weight },
      sleeping,
      today,
      appointments: (await app.upcomingAppointments(3)).map(apptOut),
      reminders: (await app.activeReminders(5)).map(remOut),
      telegram: {
        enabled: tgEnabled(env),
        connected: !!(await app.kvGet("webhook_url")),
        summary_hour: Number((await app.kvGet("tg_summary_hour")) ?? 21),
        caregivers: (await app.caregivers()).map((c) => c.name),
      },
    });
  }

  // ---------------- registros
  if (path === "/api/entries" && method === "GET") {
    const days = Math.max(1, Math.min(Number(url.searchParams.get("days") ?? 3) || 3, 90));
    const kind = url.searchParams.get("kind");
    const [start] = app.dayBounds(app.todayNaive() - (days - 1) * T.DAY);
    const q = kind
      ? env.DB.prepare("SELECT * FROM entries WHERE start_at >= ? AND kind = ? ORDER BY start_at DESC LIMIT 1000").bind(start, kind)
      : env.DB.prepare("SELECT * FROM entries WHERE start_at >= ? ORDER BY start_at DESC LIMIT 1000").bind(start);
    return json((await q.all<Entry>()).results.map((e) => app.entryOut(e)));
  }

  if (path === "/api/entries" && method === "POST") {
    const b = await body(req);
    const kind = String(b.kind ?? "");
    if (!(KINDS as readonly string[]).includes(kind)) throw new HttpError(422, `Tipo inválido: ${kind}`);
    const start = dateOf(app, b.start, "inicio");
    const end = dateOf(app, b.end, "fin");
    if (kind === "sleep" && end === null && (await app.activeSleep())) throw new HttpError(409, "Ya hay un sueño en curso");
    if (start !== null && end !== null && end < start) throw new HttpError(422, "El fin es antes del inicio");
    const e = await app.createEntry(kind, author, {
      start, end, detail: str(b.detail, 80, "detalle"), amount: amountOf(b.amount), note: str(b.note, 2000, "nota"),
    });
    ctx.waitUntil(app.notifyEntry(e));
    return json(app.entryOut(e));
  }

  if ((m = path.match(/^\/api\/entries\/([^/]+)$/))) {
    const id = idOf(m[1]);
    const e = await app.getEntry(id);
    if (method === "DELETE") {
      if (e) await env.DB.prepare("DELETE FROM entries WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
    if (method === "PATCH") {
      if (!e) throw new HttpError(404, "No encontrado");
      const b = await body(req);
      const kind = String(b.kind ?? e.kind);
      if (!(KINDS as readonly string[]).includes(kind)) throw new HttpError(422, `Tipo inválido: ${kind}`);
      const start = dateOf(app, b.start, "inicio") ?? e.start_at;
      let end = dateOf(app, b.end, "fin");
      if (end === null && kind !== "sleep") end = start;
      if (end !== null && end < start) throw new HttpError(422, "El fin es antes del inicio");
      if (kind === "sleep" && end === null) {
        const other = await app.activeSleep();
        if (other && other.id !== id) throw new HttpError(409, "Ya hay otro sueño en curso");
      }
      const u = await env.DB.prepare(
        "UPDATE entries SET kind = ?, start_at = ?, end_at = ?, detail = ?, amount = ?, note = ? WHERE id = ? RETURNING *",
      ).bind(kind, start, end, str(b.detail, 80, "detalle"), amountOf(b.amount), str(b.note, 2000, "nota"), id).first<Entry>();
      return json(app.entryOut(u!));
    }
  }

  if (path === "/api/sleep/toggle" && method === "POST") {
    const [e, slept] = await app.toggleSleep(author);
    ctx.waitUntil(app.notifyEntry(e, slept ? "registró que se durmió" : "registró que se despertó"));
    return json({ sleeping: slept, entry: app.entryOut(e) });
  }

  // ---------------- citas y controles
  if (path === "/api/appointments" && method === "GET") {
    const all = url.searchParams.get("include_past") === "true";
    const q = all
      ? env.DB.prepare("SELECT * FROM appointments ORDER BY at")
      : env.DB.prepare("SELECT * FROM appointments WHERE at >= ? ORDER BY at").bind(app.now() - T.DAY);
    return json((await q.all<Appointment>()).results.map(apptOut));
  }

  if (path === "/api/appointments" && method === "POST") {
    const b = await body(req);
    const title = str(b.title, 120, "título", true)!;
    const at = dateOf(app, b.at, "fecha", true)!;
    const [a] = await app.createAppointment({ title, at, place: str(b.place, 160, "lugar"), notes: str(b.notes, 2000, "notas"), author });
    ctx.waitUntil(app.broadcast(`📅 ${escapeHtml(author || "Alguien")} agendó: ${escapeHtml(title)} — ${app.fmtTime(a.at)}`,
      { excludeName: author, onlySubscribed: true }));
    const fresh = await env.DB.prepare("SELECT * FROM appointments WHERE id = ?").bind(a.id).first<Appointment>();
    return json(apptOut(fresh!));
  }

  if ((m = path.match(/^\/api\/appointments\/([^/]+)(\/done)?$/))) {
    const id = idOf(m[1]);
    const a = await env.DB.prepare("SELECT * FROM appointments WHERE id = ?").bind(id).first<Appointment>();
    if (method === "DELETE" && !m[2]) {
      await app.deleteAppointment(id);
      return json({ ok: true });
    }
    if (!a) throw new HttpError(404, "No encontrado");
    if (method === "POST" && m[2]) {
      const u = await env.DB.prepare("UPDATE appointments SET done = ? WHERE id = ? RETURNING *").bind(a.done ? 0 : 1, id).first<Appointment>();
      return json(apptOut(u!));
    }
    if (method === "PATCH" && !m[2]) {
      const b = await body(req);
      // Más simple y seguro: se reemplaza (recalcula avisos y el evento de Calendar)
      const title = str(b.title, 120, "título", true)!;
      const at = dateOf(app, b.at, "fecha", true)!;
      await app.deleteAppointment(id);
      const [n] = await app.createAppointment({ title, at, place: str(b.place, 160, "lugar"), notes: str(b.notes, 2000, "notas"), author: a.author });
      const fresh = await env.DB.prepare("SELECT * FROM appointments WHERE id = ?").bind(n.id).first<Appointment>();
      return json(apptOut(fresh!));
    }
  }

  // ---------------- recordatorios
  if (path === "/api/reminders" && method === "GET") {
    return json((await app.activeReminders(100)).map(remOut));
  }

  if (path === "/api/reminders" && method === "POST") {
    const b = await body(req);
    const text = str(b.text, 200, "texto", true)!;
    const due = dateOf(app, b.due_at, "fecha", true)!;
    let repeat: number | null = null;
    if (b.repeat_minutes != null && b.repeat_minutes !== "") {
      repeat = Number(b.repeat_minutes);
      if (!Number.isInteger(repeat) || repeat < 5 || repeat > 60 * 24 * 30) throw new HttpError(422, "Repetición inválida");
    }
    const r = await app.createReminder({ text, due, repeat, author });
    return json(remOut(r));
  }

  if ((m = path.match(/^\/api\/reminders\/([^/]+)$/)) && method === "DELETE") {
    await env.DB.prepare("DELETE FROM reminders WHERE id = ?").bind(idOf(m[1])).run();
    return json({ ok: true });
  }

  // ---------------- libreta de notas
  if (path === "/api/notes" && method === "GET") {
    return json((await app.listNotes(url.searchParams.get("all") === "1", 200)).map(noteOut));
  }
  if (path === "/api/notes" && method === "POST") {
    const b = await body(req);
    return json(noteOut(await app.addNote(str(b.text, 1000, "nota", true)!, author)));
  }
  if ((m = path.match(/^\/api\/notes\/([^/]+)(\/done)?$/))) {
    const id = idOf(m[1]);
    if (method === "DELETE" && !m[2]) {
      await env.DB.prepare("DELETE FROM notes WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
    if (method === "POST" && m[2]) {
      const n = await env.DB.prepare("UPDATE notes SET done = 1 - done WHERE id = ? RETURNING *").bind(id).first<Note>();
      if (!n) throw new HttpError(404, "No encontrado");
      return json(noteOut(n));
    }
  }

  // ---------------- ajustes y respaldo
  if (path === "/api/settings" && method === "PUT") {
    const b = await body(req);
    if ("birth_date" in b) {
      const bd = b.birth_date ? String(b.birth_date) : null;
      if (bd && (!/^\d{4}-\d{2}-\d{2}$/.test(bd) || Number.isNaN(Date.parse(bd)))) throw new HttpError(422, "Fecha inválida");
      await app.kvSet("birth_date", bd);
    }
    if ("tg_summary_hour" in b) {
      const h = Number(b.tg_summary_hour);
      if (!Number.isInteger(h) || h < -1 || h > 23) throw new HttpError(422, "Hora inválida");
      await app.kvSet("tg_summary_hour", String(h));
    }
    return json({ ok: true });
  }

  if (path === "/api/export" && method === "GET") {
    const [e, a, r, n] = await Promise.all([
      env.DB.prepare("SELECT * FROM entries ORDER BY start_at").all<Entry>(),
      env.DB.prepare("SELECT * FROM appointments ORDER BY at").all<Appointment>(),
      env.DB.prepare("SELECT * FROM reminders ORDER BY id").all<Reminder>(),
      env.DB.prepare("SELECT * FROM notes ORDER BY id").all<Note>(),
    ]);
    return json({
      exported_at: T.iso(app.now()),
      entries: e.results.map((x) => app.entryOut(x)),
      appointments: a.results.map(apptOut),
      reminders: r.results.map(remOut),
      notes: n.results.map(noteOut),
    });
  }

  // ---------------- correo (Gmail vía Apps Script)
  if (path === "/api/email" && method === "GET") {
    const cfg = await app.emailConfig();
    return json({ configured: !!(cfg.url && cfg.to.length), url: cfg.url, to: cfg.to, opts: cfg.opts,
      script: scriptCode(await emailKey(env), app.babyName),
      script_version: Number(await app.kvGet("script_version")) || (cfg.url ? 1 : 0),
      latest_version: SCRIPT_VERSION,
      calendar_auto: (await app.kvGet("calendar_auto")) !== "0" });
  }

  if (path === "/api/email" && method === "PUT") {
    const b = await body(req);
    let u: string | null = null;
    if (b.url && String(b.url).trim()) {
      u = normalizeScriptUrl(env, String(b.url));
      if (!u) {
        throw new HttpError(422, "Esa no parece la URL del script. En Google: Implementar → Gestionar implementaciones → "
          + "copia la «URL de la aplicación web» (empieza por https://script.google.com/ y termina en /exec).");
      }
    }
    const to = (Array.isArray(b.to) ? b.to : []).map((x: unknown) => String(x).trim().toLowerCase()).filter(Boolean);
    const bad = to.find((x: string) => !isEmail(x));
    if (bad) throw new HttpError(422, `Correo inválido: ${bad}`);
    if (to.length > 5) throw new HttpError(422, "Máximo 5 correos");
    const o = b.opts ?? {};
    const hour = Number(o.summary_hour ?? DEFAULT_OPTS.summary_hour);
    const opts = {
      reminders: o.reminders !== false, appointments: o.appointments !== false, feed: o.feed !== false,
      summary: o.summary !== false, summary_hour: Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 21,
    };
    await app.kvSet("email_url", u);
    await app.kvSet("email_to", JSON.stringify([...new Set(to)]));
    await app.kvSet("email_opts", JSON.stringify(opts));
    await app.kvSet("calendar_auto", b.calendar_auto === false ? "0" : "1");
    const version = u ? await app.checkScript() : 0;
    return json({ ok: true, script_version: version });
  }

  if (path === "/api/email/test" && method === "POST") {
    const res = await app.email("test", `✅ Tasky ya puede enviarte correos`,
      `¡Hola! Este es un correo de prueba de <b>Tasky</b>, el asistente de <b>${escapeHtml(app.babyName)}</b>.\n\n`
      + `Aquí te llegarán los recordatorios, los controles médicos, las alertas de comida y el resumen del día.`);
    if (!res.ok) throw new HttpError(502, "No se pudo enviar: " + (res.error ?? "error desconocido"));
    return json({ ok: true, script_version: await app.checkScript() });
  }

  if (path === "/api/telegram/setup" && method === "POST") {
    if (!tgEnabled(env)) throw new HttpError(400, "Falta el secreto TELEGRAM_TOKEN");
    const res = await setupWebhook(app, url.origin, await webhookSecret(env));
    if (!res?.ok) throw new HttpError(502, "Telegram rechazó la conexión: " + (res?.description ?? "sin respuesta"));
    return json({ ok: true });
  }

  throw new HttpError(404, "No encontrado");
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await route(req, env, ctx);
    } catch (e) {
      if (e instanceof HttpError) return json({ detail: e.message }, e.status);
      console.error("Error no controlado", e);
      return json({ detail: "Error interno" }, 500);
    }
  },

  async scheduled(ev: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const app = new App(env);
    // La hora programada del cron (13:02:00.000) manda: así nunca se corre un minuto.
    app.nowOverride = Math.max(Date.now(), ev.scheduledTime);
    ctx.waitUntil(app.tick().then((sent) => { if (sent.length) console.log("Avisos enviados", sent); }));
  },
} satisfies ExportedHandler<Env>;
