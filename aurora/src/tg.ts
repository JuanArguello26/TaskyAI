import type { Env } from "./env";

export type Keyboard = { text: string; callback_data: string }[][];

export function tgEnabled(env: Env): boolean {
  return !!env.TELEGRAM_TOKEN;
}

export async function tgCall(env: Env, method: string, payload: Record<string, unknown>): Promise<any> {
  if (!tgEnabled(env)) return null;
  const base = env.TG_API_BASE || "https://api.telegram.org";
  try {
    const r = await fetch(`${base}/bot${env.TELEGRAM_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data: any = await r.json().catch(() => ({}));
    if (!data.ok) console.warn(`Telegram ${method} falló`, JSON.stringify(data).slice(0, 300));
    return data;
  } catch (e) {
    // Nunca tumbar la app por Telegram
    console.warn(`Telegram ${method} error`, String(e));
    return null;
  }
}

export function tgSend(env: Env, chatId: string | number, text: string, keyboard?: Keyboard | null) {
  const payload: Record<string, unknown> = {
    chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true,
  };
  if (keyboard) payload.reply_markup = { inline_keyboard: keyboard };
  return tgCall(env, "sendMessage", payload);
}
