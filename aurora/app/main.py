import hmac
import logging
from contextlib import asynccontextmanager
from datetime import date, timedelta
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import bot, models
from . import services as S
from .config import settings
from .db import Base, SessionLocal, engine, get_db

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("aurora")
STATIC = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(engine)
    if settings.family_pin == "1234":
        log.warning("FAMILY_PIN sigue en 1234: cámbialo en las variables de entorno")
    try:
        res = bot.setup_webhook()
        if res is not None:
            log.info("Webhook de Telegram: %s", res)
    except Exception as exc:
        log.warning("No se pudo configurar el webhook: %s", exc)
    yield


app = FastAPI(title="Aurora", lifespan=lifespan, docs_url=None, redoc_url=None)


# ------------------------------------------------------------------ auth

def require_auth(authorization: str = Header(default="")) -> None:
    token = authorization.removeprefix("Bearer ").strip()
    if not hmac.compare_digest(token, settings.web_token):
        raise HTTPException(401, "No autorizado")


def author(x_author: str = Header(default="")) -> str | None:
    from urllib.parse import unquote
    return unquote(x_author).strip()[:60] or None


class LoginIn(BaseModel):
    pin: str


@app.post("/api/login")
def login(body: LoginIn):
    if not hmac.compare_digest(body.pin.strip(), settings.family_pin):
        raise HTTPException(401, "PIN incorrecto")
    return {"token": settings.web_token, "baby_name": settings.baby_name}


# ------------------------------------------------------------------ serializadores

def entry_out(e: models.Entry) -> dict:
    return {"id": e.id, "kind": e.kind, "start": S.iso(e.start), "end": S.iso(e.end), "detail": e.detail,
            "amount": e.amount, "note": e.note, "author": e.author, "text": S.describe(e)}


def appt_out(a: models.Appointment) -> dict:
    return {"id": a.id, "title": a.title, "at": S.iso(a.at), "place": a.place, "notes": a.notes, "done": a.done}


def rem_out(r: models.Reminder) -> dict:
    return {"id": r.id, "text": r.text, "due_at": S.iso(r.due_at), "repeat_minutes": r.repeat_minutes,
            "active": r.active}


def _maybe(e):
    return entry_out(e) if e else None


# ------------------------------------------------------------------ estado

@app.get("/api/status", dependencies=[Depends(require_auth)])
def status(db: Session = Depends(get_db)):
    s = S.day_summary(db)
    s.pop("entries")
    b = S.birth_date(db)
    return {
        "baby_name": settings.baby_name,
        "birth_date": b.isoformat() if b else None,
        "age": S.age_text(db),
        "server_time": S.iso(S.now_utc()),
        "last": {
            "feed": _maybe(S.last_of(db, "feed")),
            "sleep": _maybe(S.last_of(db, "sleep")),
            "diaper": _maybe(S.last_of(db, "diaper")),
            "poop": _maybe(S.last_of(db, "diaper", ("popo", "ambos"))),
            "bath": _maybe(S.last_of(db, "bath")),
            "medicine": _maybe(S.last_of(db, "medicine")),
            "temp": _maybe(S.last_of(db, "temp")),
            "weight": _maybe(S.last_of(db, "weight")),
        },
        "sleeping": _maybe(S.active_sleep(db)),
        "today": s,
        "appointments": [appt_out(a) for a in S.upcoming_appointments(db, 3)],
        "reminders": [rem_out(r) for r in S.active_reminders(db, 5)],
        "telegram": {"enabled": bool(settings.telegram_token),
                     "caregivers": [c.name for c in db.scalars(select(models.Caregiver))]},
    }


# ------------------------------------------------------------------ registros

class EntryIn(BaseModel):
    kind: str
    start: str | None = None
    end: str | None = None
    detail: str | None = Field(default=None, max_length=80)
    amount: float | None = None
    note: str | None = Field(default=None, max_length=2000)


def _check_kind(kind: str):
    if kind not in models.KINDS:
        raise HTTPException(422, f"Tipo inválido: {kind}")


@app.get("/api/entries", dependencies=[Depends(require_auth)])
def list_entries(days: int = 3, kind: str | None = None, db: Session = Depends(get_db)):
    days = max(1, min(days, 90))
    today = S.to_local(S.now_utc()).date()
    start, _ = S.local_day_bounds(today - timedelta(days=days - 1))
    q = select(models.Entry).where(models.Entry.start >= start)
    if kind:
        q = q.where(models.Entry.kind == kind)
    return [entry_out(e) for e in db.scalars(q.order_by(models.Entry.start.desc()).limit(1000))]


@app.post("/api/entries", dependencies=[Depends(require_auth)])
def add_entry(body: EntryIn, who: str | None = Depends(author), db: Session = Depends(get_db)):
    _check_kind(body.kind)
    start, end = S.parse_iso(body.start), S.parse_iso(body.end)
    if body.kind == "sleep" and end is None and S.active_sleep(db):
        raise HTTPException(409, "Ya hay un sueño en curso")
    if start and end and end < start:
        raise HTTPException(422, "El fin es antes del inicio")
    e = S.create_entry(db, body.kind, who, start=start, end=end, detail=body.detail or None,
                       amount=body.amount, note=(body.note or "").strip() or None)
    S.notify_entry(db, e)
    return entry_out(e)


@app.patch("/api/entries/{entry_id}", dependencies=[Depends(require_auth)])
def edit_entry(entry_id: int, body: EntryIn, db: Session = Depends(get_db)):
    e = db.get(models.Entry, entry_id)
    if not e:
        raise HTTPException(404)
    _check_kind(body.kind)
    e.kind = body.kind
    if body.start:
        e.start = S.parse_iso(body.start)
    e.end = S.parse_iso(body.end) if body.end else (None if e.kind == "sleep" else e.start)
    e.detail, e.amount, e.note = body.detail or None, body.amount, (body.note or "").strip() or None
    S.commit(db)
    return entry_out(e)


@app.delete("/api/entries/{entry_id}", dependencies=[Depends(require_auth)])
def delete_entry(entry_id: int, db: Session = Depends(get_db)):
    e = db.get(models.Entry, entry_id)
    if e:
        db.delete(e)
        S.commit(db)
    return {"ok": True}


@app.post("/api/sleep/toggle", dependencies=[Depends(require_auth)])
def sleep_toggle(who: str | None = Depends(author), db: Session = Depends(get_db)):
    e, slept = S.toggle_sleep(db, who)
    S.notify_entry(db, e, verb="registró que se durmió" if slept else "registró que se despertó")
    return {"sleeping": slept, "entry": entry_out(e)}


# ------------------------------------------------------------------ agenda

class ApptIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    at: str
    place: str | None = Field(default=None, max_length=160)
    notes: str | None = Field(default=None, max_length=2000)


@app.get("/api/appointments", dependencies=[Depends(require_auth)])
def list_appts(include_past: bool = False, db: Session = Depends(get_db)):
    q = select(models.Appointment)
    if not include_past:
        q = q.where(models.Appointment.at >= S.now_utc() - timedelta(days=1))
    return [appt_out(a) for a in db.scalars(q.order_by(models.Appointment.at))]


@app.post("/api/appointments", dependencies=[Depends(require_auth)])
def add_appt(body: ApptIn, who: str | None = Depends(author), db: Session = Depends(get_db)):
    a = models.Appointment(title=body.title.strip(), at=S.parse_iso(body.at), place=body.place or None,
                           notes=body.notes or None, author=who)
    db.add(a)
    S.commit(db)
    from html import escape
    S.broadcast(db, f"📅 {escape(who or 'Alguien')} agendó: {escape(a.title)} — {S.fmt_time(a.at)}",
                exclude_name=who, only_subscribed=True)
    return appt_out(a)


@app.patch("/api/appointments/{appt_id}", dependencies=[Depends(require_auth)])
def edit_appt(appt_id: int, body: ApptIn, db: Session = Depends(get_db)):
    a = db.get(models.Appointment, appt_id)
    if not a:
        raise HTTPException(404)
    new_at = S.parse_iso(body.at)
    if new_at != a.at:
        a.notified_24h = a.notified_2h = False
    a.title, a.at, a.place, a.notes = body.title.strip(), new_at, body.place or None, body.notes or None
    S.commit(db)
    return appt_out(a)


@app.post("/api/appointments/{appt_id}/done", dependencies=[Depends(require_auth)])
def done_appt(appt_id: int, db: Session = Depends(get_db)):
    a = db.get(models.Appointment, appt_id)
    if not a:
        raise HTTPException(404)
    a.done = not a.done
    S.commit(db)
    return appt_out(a)


@app.delete("/api/appointments/{appt_id}", dependencies=[Depends(require_auth)])
def delete_appt(appt_id: int, db: Session = Depends(get_db)):
    if a := db.get(models.Appointment, appt_id):
        db.delete(a)
        S.commit(db)
    return {"ok": True}


class ReminderIn(BaseModel):
    text: str = Field(min_length=1, max_length=200)
    due_at: str
    repeat_minutes: int | None = Field(default=None, ge=5, le=60 * 24 * 30)


@app.get("/api/reminders", dependencies=[Depends(require_auth)])
def list_reminders(db: Session = Depends(get_db)):
    return [rem_out(r) for r in S.active_reminders(db, 100)]


@app.post("/api/reminders", dependencies=[Depends(require_auth)])
def add_reminder(body: ReminderIn, who: str | None = Depends(author), db: Session = Depends(get_db)):
    r = models.Reminder(text=body.text.strip(), due_at=S.parse_iso(body.due_at),
                        repeat_minutes=body.repeat_minutes or None, active=True, author=who)
    db.add(r)
    S.commit(db)
    return rem_out(r)


@app.delete("/api/reminders/{rem_id}", dependencies=[Depends(require_auth)])
def delete_reminder(rem_id: int, db: Session = Depends(get_db)):
    if r := db.get(models.Reminder, rem_id):
        db.delete(r)
        S.commit(db)
    return {"ok": True}


# ------------------------------------------------------------------ ajustes

class SettingsIn(BaseModel):
    birth_date: date | None = None


@app.put("/api/settings", dependencies=[Depends(require_auth)])
def put_settings(body: SettingsIn, db: Session = Depends(get_db)):
    S.kv_set(db, "birth_date", body.birth_date.isoformat() if body.birth_date else None)
    S.commit(db)
    return {"ok": True}


@app.get("/api/export", dependencies=[Depends(require_auth)])
def export(db: Session = Depends(get_db)):
    """Respaldo completo en JSON."""
    return {
        "entries": [entry_out(e) for e in db.scalars(select(models.Entry).order_by(models.Entry.start))],
        "appointments": [appt_out(a) for a in db.scalars(select(models.Appointment))],
        "reminders": [rem_out(r) for r in db.scalars(select(models.Reminder))],
    }


# ------------------------------------------------------------------ cron + telegram

@app.get("/cron/tick")
def cron_tick(key: str = "", force: bool = False):
    if not hmac.compare_digest(key, settings.cron_key):
        raise HTTPException(403)
    return S.tick(SessionLocal, force=force)


@app.post("/telegram/webhook")
async def telegram_webhook(request: Request,
                           x_telegram_bot_api_secret_token: str = Header(default="")):
    if not hmac.compare_digest(x_telegram_bot_api_secret_token, settings.webhook_secret):
        raise HTTPException(403)
    update = await request.json()
    from starlette.concurrency import run_in_threadpool
    await run_in_threadpool(_process_update, update)
    return {"ok": True}


def _process_update(update: dict) -> None:
    db = SessionLocal()
    try:
        bot.handle_update(db, update)
    except Exception:
        log.exception("Error procesando update de Telegram")
        db.rollback()
    finally:
        db.close()


@app.post("/api/telegram/setup", dependencies=[Depends(require_auth)])
def telegram_setup():
    return {"result": bot.setup_webhook()}


@app.get("/healthz")
def healthz():
    return {"ok": True}


# ------------------------------------------------------------------ web

app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/manifest.webmanifest")
def manifest():
    return FileResponse(STATIC / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/sw.js")
def sw():
    return FileResponse(STATIC / "sw.js", media_type="application/javascript")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")
