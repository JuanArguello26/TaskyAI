"""Cliente mínimo de la Bot API de Telegram."""

import logging

import httpx

from .config import settings

log = logging.getLogger("aurora.tg")
_client = httpx.Client(timeout=10)


def enabled() -> bool:
    return bool(settings.telegram_token)


def call(method: str, **payload):
    if not enabled():
        return None
    try:
        r = _client.post(f"https://api.telegram.org/bot{settings.telegram_token}/{method}", json=payload)
        data = r.json()
        if not data.get("ok"):
            log.warning("Telegram %s falló: %s", method, data)
        return data
    except Exception as exc:  # nunca tumbar la app por Telegram
        log.warning("Telegram %s error: %s", method, exc)
        return None


def send(chat_id: str | int, text: str, keyboard: list | None = None):
    payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True}
    if keyboard:
        payload["reply_markup"] = {"inline_keyboard": keyboard}
    return call("sendMessage", **payload)
