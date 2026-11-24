import type { Env } from "./env";

export type Button = { text: string; callback_data: string } | { text: string; url: string };
export type Keyboard = Button[][];
/** Teclado inline (array) o cualquier reply_markup de Telegram (objeto). */
export type Markup = Keyboard | Record<string, unknown> | null | undefined;

export function tgEnabled(env: Env): boolean {
  return !!env.TELEGRAM_TOKEN;
}

const base = (env: Env) => env.TG_API_BASE || "https://api.telegram.org";

export async function tgCall(env: Env, method: string, payload: Record<string, unknown>): Promise<any> {
  if (!tgEnabled(env)) return null;
  try {
    const r = await fetch(`${base(env)}/bot${env.TELEGRAM_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data: any = await r.json().catch(() => ({}));
    if (!data.ok && !String(data.description ?? "").includes("message is not modified")) {
      console.warn(`Telegram ${method} falló`, JSON.stringify(data).slice(0, 300));
    }
    return data;
  } catch (e) {
    // Nunca tumbar la app por Telegram
    console.warn(`Telegram ${method} error`, String(e));
    return null;
  }
}

function markup(m: Markup) {
  if (!m) return undefined;
  return Array.isArray(m) ? { inline_keyboard: m } : m;
}

export function tgSend(env: Env, chatId: string | number, text: string, m?: Markup) {
  const payload: Record<string, unknown> = {
    chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true,
  };
  const rm = markup(m);
  if (rm) payload.reply_markup = rm;
  return tgCall(env, "sendMessage", payload);
}

/** Reemplaza el texto (y botones) de un mensaje ya enviado. */
export function tgEdit(env: Env, chatId: string | number, messageId: number, text: string, kb?: Keyboard | null) {
  const payload: Record<string, unknown> = {
    chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", disable_web_page_preview: true,
  };
  if (kb) payload.reply_markup = { inline_keyboard: kb };
  return tgCall(env, "editMessageText", payload);
}

/** Descarga un archivo de Telegram (notas de voz). */
export async function tgDownload(env: Env, fileId: string): Promise<ArrayBuffer | null> {
  const info = await tgCall(env, "getFile", { file_id: fileId });
  const path = info?.result?.file_path;
  if (!path) return null;
  const r = await fetch(`${base(env)}/file/bot${env.TELEGRAM_TOKEN}/${path}`);
  return r.ok ? r.arrayBuffer() : null;
}
