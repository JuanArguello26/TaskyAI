export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  FAMILY_PIN: string;
  SECRET_KEY: string;
  TELEGRAM_TOKEN?: string;
  APP_TZ?: string;
  BABY_NAME?: string;
  FEED_ALERT_HOURS?: string;
  /** Solo para pruebas locales: URL falsa de la API de Telegram. */
  TG_API_BASE?: string;
  /** Solo para pruebas locales: habilita /__test/*. */
  TEST_MODE?: string;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
