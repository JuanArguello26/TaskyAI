import hashlib
import hmac
import os
from zoneinfo import ZoneInfo


def _db_url() -> str:
    url = os.getenv("DATABASE_URL", "sqlite:///./aurora.db").strip()
    # Neon / Render dan "postgres://" o "postgresql://"; usamos el driver psycopg 3.
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


class Settings:
    def __init__(self) -> None:
        self.database_url = _db_url()
        self.family_pin = os.getenv("FAMILY_PIN", "1234")
        self.secret_key = os.getenv("SECRET_KEY", "dev-secret-change-me")
        self.cron_key = os.getenv("CRON_KEY", "dev-cron")
        self.telegram_token = os.getenv("TELEGRAM_TOKEN", "").strip()
        self.public_url = (os.getenv("PUBLIC_URL") or os.getenv("RENDER_EXTERNAL_URL") or "").rstrip("/")
        self.tz_name = os.getenv("APP_TZ", "America/Bogota")
        self.tz = ZoneInfo(self.tz_name)
        self.baby_name = os.getenv("BABY_NAME", "Aurora")
        self.feed_alert_hours = float(os.getenv("FEED_ALERT_HOURS", "3"))

    def _hmac(self, msg: str) -> str:
        return hmac.new(self.secret_key.encode(), msg.encode(), hashlib.sha256).hexdigest()

    @property
    def web_token(self) -> str:
        # Cambiar el PIN o la SECRET_KEY invalida todas las sesiones.
        return self._hmac("web:" + self.family_pin)

    @property
    def webhook_secret(self) -> str:
        return self._hmac("telegram-webhook")[:48]


settings = Settings()
