import os
import tempfile
from datetime import datetime, timedelta

_tmp = tempfile.mkdtemp()
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmp}/test.db")
os.environ["FAMILY_PIN"] = "4321"
os.environ["SECRET_KEY"] = "test-secret"
os.environ["CRON_KEY"] = "cronkey"
os.environ["TELEGRAM_TOKEN"] = "fake"
os.environ["APP_TZ"] = "America/Bogota"
os.environ.pop("RENDER_EXTERNAL_URL", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import bot, models, tg_api  # noqa: E402
from app import services as S  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402

SENT: list[tuple[str, str]] = []


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    S.invalidate()
    SENT.clear()
    monkeypatch.setattr(tg_api, "send", lambda chat, text, kb=None: SENT.append((str(chat), text)))
    monkeypatch.setattr(tg_api, "call", lambda method, **kw: {"ok": True})
    yield


@pytest.fixture
def client():
    with TestClient(app) as c:
        token = c.post("/api/login", json={"pin": "4321"}).json()["token"]
        c.headers.update({"Authorization": f"Bearer {token}", "X-Author": "Juan"})
        yield c


def tg(text, chat=100, name="Juan"):
    db = SessionLocal()
    try:
        bot.handle_update(db, {"message": {"chat": {"id": chat}, "from": {"first_name": name}, "text": text}})
    finally:
        db.close()
    return SENT[-1][1] if SENT else ""


# ---------------------------------------------------------------- web

def test_login_rejects_bad_pin():
    with TestClient(app) as c:
        assert c.post("/api/login", json={"pin": "0000"}).status_code == 401
        assert c.get("/api/status").status_code == 401


def test_entries_and_status(client):
    r = client.post("/api/entries", json={"kind": "feed", "detail": "biberon", "amount": 90})
    assert r.status_code == 200, r.text
    assert r.json()["text"] == "🍼 Comida · biberón · 90 ml"
    client.post("/api/entries", json={"kind": "diaper", "detail": "popo"})
    st = client.get("/api/status").json()
    assert st["last"]["feed"]["amount"] == 90
    assert st["last"]["poop"]["detail"] == "popo"
    assert st["today"]["feeds"] == 1 and st["today"]["feed_ml"] == 90 and st["today"]["poop"] == 1


def test_sleep_toggle_and_past_sleep(client):
    assert client.post("/api/sleep/toggle").json()["sleeping"] is True
    assert client.post("/api/entries", json={"kind": "sleep"}).status_code == 409
    assert client.get("/api/status").json()["sleeping"] is not None
    r = client.post("/api/sleep/toggle").json()
    assert r["sleeping"] is False and r["entry"]["end"]
    # sueño pasado con inicio y fin
    start = (datetime.utcnow() - timedelta(hours=3)).isoformat() + "Z"
    end = (datetime.utcnow() - timedelta(hours=2)).isoformat() + "Z"
    r = client.post("/api/entries", json={"kind": "sleep", "start": start, "end": end})
    assert r.status_code == 200 and "1 h 00 min" in r.json()["text"]


def test_edit_and_delete_entry(client):
    e = client.post("/api/entries", json={"kind": "temp", "amount": 37}).json()
    r = client.patch(f"/api/entries/{e['id']}", json={"kind": "temp", "amount": 37.5, "start": e["start"]})
    assert r.json()["amount"] == 37.5
    client.delete(f"/api/entries/{e['id']}")
    assert client.get("/api/entries").json() == []


def test_web_entry_notifies_linked_caregivers_except_author(client):
    tg("/start 4321 Juan", chat=1)
    tg("/start 4321 Maria", chat=2)
    SENT.clear()
    client.post("/api/entries", json={"kind": "bath"})
    assert [c for c, _ in SENT] == ["2"]


# ---------------------------------------------------------------- bot

def test_bot_requires_pin():
    assert "PIN" in tg("/estado", chat=9)
    assert "PIN" in tg("/start 1111 X", chat=9)
    assert "Listo" in tg("/start 4321 Mamá", chat=9)
    assert "Aurora" in tg("/estado", chat=9)


def test_bot_logging_commands():
    tg("/start 4321 Juan", chat=1)
    assert "90 ml" in tg("/comida 90", chat=1)
    assert "pecho izquierdo · 15 min" in tg("/pecho izq 15", chat=1)
    assert "popó" in tg("/panal popo", chat=1)
    assert "Se durmió" in tg("/dormir", chat=1)
    assert "Ya está durmiendo" in tg("/dormir", chat=1)
    assert "Se despertó" in tg("/desperto", chat=1)
    assert "38 °C" in tg("/temp 38.2", chat=1)
    db = SessionLocal()
    assert db.query(models.Entry).count() == 5
    db.close()
    assert "Borrado" in tg("/deshacer", chat=1)


def test_bot_past_time():
    tg("/start 4321 Juan", chat=1)
    tg("/comida 60 hace 30m", chat=1)
    db = SessionLocal()
    e = db.query(models.Entry).one()
    assert timedelta(minutes=29) < S.now_utc() - e.start < timedelta(minutes=31)
    db.close()


def test_bot_callbacks():
    tg("/start 4321 Juan", chat=1)
    db = SessionLocal()
    bot.handle_update(db, {"callback_query": {"id": "x", "data": "ml:120", "message": {"chat": {"id": 1}}}})
    bot.handle_update(db, {"callback_query": {"id": "y", "data": "log:diaper:ambos", "message": {"chat": {"id": 1}}}})
    kinds = sorted(e.kind for e in db.query(models.Entry))
    db.close()
    assert kinds == ["diaper", "feed"]


def test_bot_reminder_and_control():
    tg("/start 4321 Juan", chat=1)
    assert "Listo, les aviso" in tg("/recordar 30m vitamina D", chat=1)
    assert "Agendado" in tg("/control mañana 9:30 Pediatra | Clínica", chat=1)
    agenda = tg("/agenda", chat=1)
    assert "vitamina D" in agenda and "Pediatra" in agenda


# ---------------------------------------------------------------- parseo de fechas

def test_parse_when():
    now = S.now_utc()
    due, rep, rest = S.parse_when("30m dar vitamina")
    assert rest == "dar vitamina" and rep is None and timedelta(minutes=29) < due - now <= timedelta(minutes=30)
    due, rep, rest = S.parse_when("cada 3h dar pecho")
    assert rep == 180 and rest == "dar pecho"
    due, _, rest = S.parse_when("1h30m algo")
    assert rest == "algo" and timedelta(minutes=89) < due - now <= timedelta(minutes=90)
    due, _, rest = S.parse_when("mañana 9:00 pediatra")
    loc = S.to_local(due)
    assert (loc.hour, loc.minute) == (9, 0) and loc.date() == S.to_local(now).date() + timedelta(days=1)
    due, _, _ = S.parse_when("3pm x")
    assert S.to_local(due).hour == 15
    due, _, _ = S.parse_when("01/12/2027 10:00 vacuna")
    assert S.to_local(due).strftime("%Y-%m-%d %H:%M") == "2027-12-01 10:00"
    with pytest.raises(ValueError):
        S.parse_when("algún día")


# ---------------------------------------------------------------- cron

def test_cron_requires_key(client):
    assert client.get("/cron/tick?key=bad").status_code == 403


def test_tick_sends_due_reminders_and_repeats(client):
    tg("/start 4321 Juan", chat=1)
    db = SessionLocal()
    now = S.now_utc()
    db.add(models.Reminder(text="vitamina", due_at=now - timedelta(minutes=1), active=True))
    db.add(models.Reminder(text="pecho", due_at=now - timedelta(minutes=1), repeat_minutes=180, active=True))
    db.commit()
    db.close()
    S.invalidate()
    SENT.clear()
    r = client.get("/cron/tick?key=cronkey").json()
    assert r["checked"] and len(r["sent"]) == 2
    assert any("vitamina" in t for _, t in SENT)
    # el siguiente tick no consulta la base porque ya sabe cuándo es el próximo aviso
    assert client.get("/cron/tick?key=cronkey").json()["checked"] is False
    db = SessionLocal()
    rems = {r.text: r for r in db.query(models.Reminder)}
    assert rems["vitamina"].active is False
    assert rems["pecho"].active and rems["pecho"].due_at > now + timedelta(hours=2)
    db.close()


def test_tick_appointment_and_feed_alert(client):
    tg("/start 4321 Juan", chat=1)
    db = SessionLocal()
    now = S.now_utc()
    db.add(models.Appointment(title="Pediatra", at=now + timedelta(hours=1)))
    db.add(models.Entry(kind="feed", start=now - timedelta(hours=4), end=now - timedelta(hours=4),
                        detail="biberon", amount=60, created_at=now))
    db.commit()
    db.close()
    S.invalidate()
    SENT.clear()
    sent = client.get("/cron/tick?key=cronkey").json()["sent"]
    assert any(s.startswith("appt2h") for s in sent) and any(s.startswith("feed_alert") for s in sent)
    # no repite
    assert client.get("/cron/tick?key=cronkey&force=true").json()["sent"] == []


def test_writes_invalidate_next_check(client):
    client.get("/cron/tick?key=cronkey")
    assert client.get("/cron/tick?key=cronkey").json()["checked"] is False
    client.post("/api/reminders", json={"text": "x", "due_at": (datetime.utcnow() - timedelta(minutes=1)).isoformat() + "Z"})
    assert client.get("/cron/tick?key=cronkey").json()["checked"] is True


def test_webhook_rejects_bad_secret(client):
    assert client.post("/telegram/webhook", json={}, headers={"X-Telegram-Bot-Api-Secret-Token": "no"}).status_code == 403


def test_index_served():
    with TestClient(app) as c:
        assert "Aurora" in c.get("/").text
        assert c.get("/static/app.js").status_code == 200
