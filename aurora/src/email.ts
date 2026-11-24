/**
 * Correos gratis a través del Gmail de la familia: un Google Apps Script
 * (que ellos pegan en su cuenta) recibe la petición y envía con MailApp.
 */

import type { Env } from "./env";

export interface EmailOpts {
  reminders: boolean;
  appointments: boolean;
  feed: boolean;
  summary: boolean;
  summary_hour: number;
}

export const DEFAULT_OPTS: EmailOpts = { reminders: true, appointments: true, feed: true, summary: true, summary_hour: 21 };

export type EmailCategory = "reminders" | "appointments" | "feed" | "summary" | "test";

const EMAIL_RE = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/;
export const isEmail = (s: string) => EMAIL_RE.test(s) && s.length <= 120;

export function validScriptUrl(env: Env, url: string): boolean {
  if (env.TEST_MODE === "1" && url.startsWith("http://127.0.0.1:")) return true;
  return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url);
}

export async function hmacHex(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const emailKey = async (env: Env) => (await hmacHex(env.SECRET_KEY, "email-relay")).slice(0, 32);

/** Código para pegar en script.google.com (ya trae la clave de esta app). */
export function scriptCode(key: string, babyName: string): string {
  return `// Tasky · envío de correos desde tu Gmail (gratis)
// 1) Pega este código  2) Ejecuta "probar" una vez y acepta permisos
// 3) Implementar > Nueva implementación > Aplicación web
//    Ejecutar como: Yo · Quién tiene acceso: Cualquier usuario
const CLAVE = "${key}";

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.key !== CLAVE) return out({ ok: false, error: "clave incorrecta" });
    const to = (d.to || []).filter(function (x) { return /^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(x); }).slice(0, 5);
    if (!to.length) return out({ ok: false, error: "sin destinatarios" });
    MailApp.sendEmail({
      to: to.join(","),
      subject: String(d.subject || "Tasky").slice(0, 200),
      htmlBody: String(d.html || ""),
      body: String(d.text || ""),
      name: "Tasky · ${babyName.replace(/[^\p{L}\p{N} ]/gu, "")}",
    });
    return out({ ok: true, quota: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// Ejecútala una vez desde el editor para dar permisos (te llega un correo de prueba).
function probar() {
  MailApp.sendEmail(Session.getActiveUser().getEmail(), "Tasky: permisos listos ✅", "Ya puedes implementar el script como aplicación web.");
}
`;
}

/** Convierte el HTML de Telegram (<b>, <i>, saltos de línea) en un correo sencillo. */
export function emailHtml(title: string, tgHtml: string, appUrl: string | null): string {
  const body = tgHtml.replace(/\n/g, "<br>");
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:auto;color:#2b2433">
<div style="background:linear-gradient(135deg,#3b3570,#c2577a);color:#fff;padding:18px 20px;border-radius:14px 14px 0 0;font-size:18px;font-weight:700">🌙 ${title}</div>
<div style="border:1px solid #e8dfd8;border-top:0;padding:18px 20px;border-radius:0 0 14px 14px;line-height:1.55;font-size:15px">${body}</div>
${appUrl ? `<p style="text-align:center;margin:16px 0"><a href="${appUrl}" style="color:#c2577a">Abrir la app</a></p>` : ""}
<p style="text-align:center;color:#9a93ab;font-size:12px">Enviado por Tasky desde tu Gmail</p></div>`;
}

export const htmlToText = (s: string) =>
  s.replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

export async function postEmail(env: Env, url: string, payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string; quota?: number }> {
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, key: await emailKey(env) }),
      redirect: "follow",
    });
    const text = await r.text();
    try {
      return JSON.parse(text);
    } catch {
      return { ok: false, error: r.status === 200 ? "Google no respondió como se esperaba (¿la implementaste con acceso 'Cualquier usuario'?)" : `Google respondió ${r.status}` };
    }
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Enlace "Agregar a Google Calendar" (evento de 1 hora). */
export function googleCalendarUrl(title: string, atMs: number, place?: string | null, details?: string): string {
  const fmt = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${fmt(atMs)}/${fmt(atMs + 60 * 60_000)}`,
    details: details ?? "Agendado con Tasky",
  });
  if (place) q.set("location", place);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}
