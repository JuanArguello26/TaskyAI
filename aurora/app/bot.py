"""Bot de Telegram: el asistente de la familia."""

import hmac
import re
from datetime import timedelta
from html import escape

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import services as S
from . import tg_api
from .config import settings
from .models import Appointment, Caregiver, Entry, Reminder

COMMANDS = [
    ("estado", "Resumen: última comida, sueño, pañal"),
    ("menu", "Botones rápidos"),
    ("comida", "Biberón: /comida 90 (ml)"),
    ("pecho", "Pecho: /pecho izq 15 (min)"),
    ("dormir", "Se durmió (o /dormir 14:30)"),
    ("desperto", "Se despertó"),
    ("panal", "Pañal: /panal pipi | popo | ambos"),
    ("bano", "Baño"),
    ("medicina", "Medicina: /medicina Vitamina D"),
    ("temp", "Temperatura: /temp 37.2"),
    ("peso", "Peso: /peso 3.4"),
    ("nota", "Nota libre"),
    ("hoy", "Registros de hoy"),
    ("recordar", "Recordatorio: /recordar 30m vitamina"),
    ("control", "Control médico: /control 01/12 9:00 Pediatra"),
    ("agenda", "Controles y recordatorios"),
    ("deshacer", "Borra tu último registro"),
    ("avisos", "Activar/desactivar avisos de lo que registra el otro"),
    ("ayuda", "Cómo usar el bot"),
]

HELP = f"""<b>👶 Asistente de {escape(settings.baby_name)}</b>

Toca /menu para los botones rápidos o usa comandos:

🍼 /comida 90 — biberón de 90 ml
🤱 /pecho izq 15 — pecho izquierdo 15 min
😴 /dormir y /desperto
🧷 /panal pipi · /panal popo · /panal ambos
🛁 /bano · 💊 /medicina Paracetamol · 🌡️ /temp 37.2 · ⚖️ /peso 3.4
📝 /nota lo que quieras

<b>Registrar algo que ya pasó:</b> agrega la hora al final o "hace":
/comida 60 hace 20m · /panal popo 14:10 · /dormir 13:45

⏰ /recordar 30m vitamina D
⏰ /recordar cada 3h dar pecho
⏰ /recordar mañana 8:00 llamar al pediatra
📅 /control 01/12 9:30 Control pediatra | Clínica X
📋 /estado · /hoy · /agenda · /deshacer"""


def menu_keyboard(db: Session) -> list:
    sleeping = S.active_sleep(db) is not None
    return [
        [{"text": "🍼 Biberón", "callback_data": "feed:biberon"},
         {"text": "🤱 Pecho izq", "callback_data": "log:feed:pecho_izq"},
         {"text": "🤱 Pecho der", "callback_data": "log:feed:pecho_der"}],
        [{"text": "😊 Se despertó" if sleeping else "😴 Se durmió", "callback_data": "sleep"}],
        [{"text": "💧 Pipí", "callback_data": "log:diaper:pipi"},
         {"text": "💩 Popó", "callback_data": "log:diaper:popo"},
         {"text": "💧💩 Ambos", "callback_data": "log:diaper:ambos"}],
        [{"text": "🛁 Baño", "callback_data": "log:bath:"},
         {"text": "📊 Estado", "callback_data": "status"},
         {"text": "📋 Hoy", "callback_data": "today"}],
    ]


def ml_keyboard() -> list:
    vals = [30, 45, 60, 75, 90, 120, 150, 180]
    rows = [[{"text": f"{v} ml", "callback_data": f"ml:{v}"} for v in vals[i:i + 4]] for i in (0, 4)]
    rows.append([{"text": "Sin medir", "callback_data": "ml:0"}, {"text": "↩️ Menú", "callback_data": "menu"}])
    return rows


# ------------------------------------------------------------------ helpers

_AGO = re.compile(r"\bhace\s+(\S+)\s*$", re.I)
_AT = re.compile(r"\b(?:a las\s+)?(\d{1,2}:\d{2})\s*$", re.I)


def split_time(text: str):
    """Saca 'hace 20m' o '14:10' del final del texto. Devuelve (resto, utc|None)."""
    text = text.strip()
    if m := _AGO.search(text):
        mins = S.parse_dur(m.group(1))
        if mins:
            return text[:m.start()].strip(), S.now_utc() - timedelta(minutes=mins)
    if m := _AT.search(text):
        hm = S._parse_hhmm(m.group(1))
        if hm:
            now_l = S.to_local(S.now_utc()).replace(tzinfo=None)
            at = now_l.replace(hour=hm[0], minute=hm[1], second=0, microsecond=0)
            if at > now_l + timedelta(minutes=5):
                at -= timedelta(days=1)  # "23:50" dicho a las 00:10 -> ayer
            return text[:m.start()].strip(), S.local_to_utc(at)
    return text, None


def _float(tok: str) -> float | None:
    try:
        return float(tok.replace(",", "."))
    except ValueError:
        return None


def _caregiver(db: Session, chat_id: str) -> Caregiver | None:
    return db.scalars(select(Caregiver).where(Caregiver.chat_id == chat_id)).first()


def _log(db: Session, cg: Caregiver, chat_id: str, kind: str, **kw) -> str:
    e = S.create_entry(db, kind, cg.name, **kw)
    S.notify_entry(db, e, exclude_chat=chat_id)
    return f"✅ {escape(S.describe(e))} — {S.fmt_time(e.start)}"


def _sleep(db: Session, cg: Caregiver, chat_id: str, want: str | None, at=None) -> str:
    current = S.active_sleep(db)
    if want == "sleep" and current:
        return f"Ya está durmiendo desde {S.fmt_time(current.start)}. ¿Se despertó? /desperto"
    if want == "wake" and not current:
        return "No hay un sueño en curso. Para registrar que se durmió: /dormir"
    e, slept = S.toggle_sleep(db, cg.name, at)
    if slept:
        S.notify_entry(db, e, verb="registró que se durmió", exclude_chat=chat_id)
        return f"😴 Se durmió a las {S.fmt_time(e.start)}. Dulces sueños 🌙"
    S.notify_entry(db, e, verb="registró que se despertó", exclude_chat=chat_id)
    return f"😊 Se despertó. Durmió {S.fmt_dur((e.end - e.start).total_seconds())}"


# ------------------------------------------------------------------ comandos

def handle_command(db: Session, cg: Caregiver, chat_id: str, cmd: str, args: str):
    """Devuelve (texto, teclado|None)."""
    a, at = split_time(args)
    kw = {"start": at} if at else {}

    if cmd in ("menu", "start"):
        return "¿Qué registramos?", menu_keyboard(db)
    if cmd in ("estado", "resumen", "status"):
        return S.status_text(db), menu_keyboard(db)
    if cmd == "hoy":
        return S.today_text(db), None
    if cmd in ("ayuda", "help"):
        return HELP, None

    if cmd in ("comida", "biberon", "formula"):
        toks = a.split()
        ml = _float(toks[0]) if toks else None
        if ml is None and not toks:
            return "¿Cuántos ml?", ml_keyboard()
        note = " ".join(toks[1:] if ml is not None else toks) or None
        return _log(db, cg, chat_id, "feed", detail="formula" if cmd == "formula" else "biberon",
                    amount=ml or None, note=note, **kw), None
    if cmd == "pecho":
        toks = a.split()
        side = None
        if toks and toks[0].lower()[:3] in ("izq", "der"):
            side = "pecho_izq" if toks.pop(0).lower().startswith("izq") else "pecho_der"
        if side is None:
            return "¿Qué lado?", [[{"text": "🤱 Izquierdo", "callback_data": "log:feed:pecho_izq"},
                                   {"text": "🤱 Derecho", "callback_data": "log:feed:pecho_der"}]]
        mins = _float(toks.pop(0)) if toks and _float(toks[0]) is not None else None
        return _log(db, cg, chat_id, "feed", detail=side, amount=mins, note=" ".join(toks) or None, **kw), None
    if cmd in ("dormir", "durmio", "dormida"):
        return _sleep(db, cg, chat_id, "sleep", at), menu_keyboard(db)
    if cmd in ("desperto", "despertar", "despierta"):
        return _sleep(db, cg, chat_id, "wake", at), menu_keyboard(db)
    if cmd in ("panal", "pañal", "pipi", "popo"):
        det = cmd if cmd in ("pipi", "popo") else (a.split()[0].lower() if a.split() else "")
        det = {"pipí": "pipi", "popó": "popo", "caca": "popo", "ambas": "ambos", "los2": "ambos"}.get(det, det)
        if det not in ("pipi", "popo", "ambos"):
            return "¿Qué tenía?", [[{"text": "💧 Pipí", "callback_data": "log:diaper:pipi"},
                                    {"text": "💩 Popó", "callback_data": "log:diaper:popo"},
                                    {"text": "💧💩 Ambos", "callback_data": "log:diaper:ambos"}]]
        rest = " ".join(a.split()[1:]) if cmd == "panal" else a
        return _log(db, cg, chat_id, "diaper", detail=det, note=rest or None, **kw), None
    if cmd in ("bano", "baño"):
        return _log(db, cg, chat_id, "bath", note=a or None, **kw), None
    if cmd == "medicina":
        if not a:
            return "Escribe el nombre: /medicina Vitamina D", None
        return _log(db, cg, chat_id, "medicine", detail=a[:80], **kw), None
    if cmd == "temp":
        v = _float(a.split()[0]) if a.split() else None
        if v is None:
            return "Ejemplo: /temp 37.2", None
        msg = _log(db, cg, chat_id, "temp", amount=v, **kw)
        if v >= 38:
            msg += "\n⚠️ 38 °C o más en un recién nacido: llama al pediatra o ve a urgencias."
        return msg, None
    if cmd == "peso":
        v = _float(a.split()[0]) if a.split() else None
        if v is None:
            return "Ejemplo: /peso 3.4 (kg)", None
        return _log(db, cg, chat_id, "weight", amount=v, **kw), None
    if cmd == "nota":
        if not args:
            return "Ejemplo: /nota hoy estuvo muy tranquila", None
        return _log(db, cg, chat_id, "note", note=args), None

    if cmd == "recordar":
        try:
            due, repeat, text = S.parse_when(args)
        except ValueError as exc:
            return f"❌ {exc}", None
        if not text:
            return "Falta qué recordar. Ej: /recordar 30m vitamina D", None
        r = Reminder(text=text[:200], due_at=due, repeat_minutes=repeat, active=True, author=cg.name)
        db.add(r)
        S.commit(db)
        rep = f", y luego cada {S.fmt_dur(repeat * 60)}" if repeat else ""
        return f"⏰ Listo, les aviso {S.fmt_time(due)}{rep}: {escape(r.text)}\n(cancelar: /borrar_recordatorio {r.id})", None
    if cmd in ("borrar_recordatorio", "cancelar"):
        r = db.get(Reminder, int(a)) if a.isdigit() else None
        if not r:
            return "Indica el número: /borrar_recordatorio 3 (míralo en /agenda)", None
        r.active = False
        S.commit(db)
        return f"🗑️ Recordatorio cancelado: {escape(r.text)}", None
    if cmd == "control":
        try:
            when, _, text = S.parse_when(args, allow_repeat=False)
        except ValueError as exc:
            return f"❌ {exc}\nEj: /control 01/12 9:30 Pediatra | Clínica X", None
        if not text:
            return "Falta el título. Ej: /control 01/12 9:30 Pediatra | Clínica X", None
        title, _, place = text.partition("|")
        ap = Appointment(title=title.strip()[:120], place=place.strip()[:160] or None, at=when, author=cg.name)
        db.add(ap)
        S.commit(db)
        S.broadcast(db, f"📅 {escape(cg.name)} agendó: {escape(ap.title)} — {S.fmt_time(ap.at)}",
                    exclude_chat=chat_id, only_subscribed=True)
        return f"📅 Agendado: {escape(ap.title)} — {S.fmt_time(ap.at)}. Les recuerdo 24 h y 2 h antes.", None
    if cmd == "agenda":
        return S.agenda_text(db), None
    if cmd == "deshacer":
        e = db.scalars(select(Entry).where(Entry.author == cg.name).order_by(Entry.created_at.desc())).first()
        if not e or S.now_utc() - e.created_at > timedelta(hours=1):
            return "No hay registros tuyos de la última hora para deshacer.", None
        desc = S.describe(e)
        db.delete(e)
        S.commit(db)
        return f"↩️ Borrado: {escape(desc)}", None
    if cmd == "avisos":
        cg.notify_others = not cg.notify_others
        S.commit(db)
        return ("🔔 Te aviso cuando alguien más registre algo." if cg.notify_others
                else "🔕 Ya no te aviso de los registros de otros (los recordatorios siguen llegando)."), None
    return "No conozco ese comando. Mira /ayuda", None


# ------------------------------------------------------------------ callbacks (botones)

def handle_callback(db: Session, cg: Caregiver, chat_id: str, data: str):
    if data == "menu":
        return "¿Qué registramos?", menu_keyboard(db)
    if data == "status":
        return S.status_text(db), menu_keyboard(db)
    if data == "today":
        return S.today_text(db), None
    if data == "sleep":
        return _sleep(db, cg, chat_id, None), menu_keyboard(db)
    if data == "feed:biberon":
        return "🍼 ¿Cuántos ml?", ml_keyboard()
    if data.startswith("ml:"):
        ml = float(data[3:])
        return _log(db, cg, chat_id, "feed", detail="biberon", amount=ml or None), menu_keyboard(db)
    if data.startswith("log:"):
        _, kind, detail = data.split(":", 2)
        return _log(db, cg, chat_id, kind, detail=detail or None), menu_keyboard(db)
    return "🤔", None


# ------------------------------------------------------------------ entrada

def _link(db: Session, chat_id: str, args: str, first_name: str) -> str:
    toks = args.split()
    if not toks or not hmac.compare_digest(toks[0], settings.family_pin):
        return ("👋 Hola. Para vincularte escribe:\n<code>/start PIN TuNombre</code>\n"
                "(el PIN familiar lo tienen papá y mamá)")
    name = (" ".join(toks[1:]) or first_name or "Familia")[:60]
    db.add(Caregiver(name=name, chat_id=chat_id))
    S.commit(db)
    S.broadcast(db, f"👋 {escape(name)} se unió al asistente de {escape(settings.baby_name)}.", exclude_chat=chat_id)
    return f"🎉 ¡Listo, {escape(name)}! Ya estás vinculado/a.\n\n" + HELP


def handle_update(db: Session, update: dict) -> None:
    if cb := update.get("callback_query"):
        chat_id = str(cb["message"]["chat"]["id"])
        tg_api.call("answerCallbackQuery", callback_query_id=cb["id"])
        cg = _caregiver(db, chat_id)
        if not cg:
            tg_api.send(chat_id, "Primero vincúlate: /start PIN TuNombre")
            return
        text, kb = handle_callback(db, cg, chat_id, cb.get("data", ""))
        tg_api.send(chat_id, text, kb)
        return

    msg = update.get("message")
    if not msg or "text" not in msg:
        return
    chat_id = str(msg["chat"]["id"])
    text = msg["text"].strip()
    first_name = msg.get("from", {}).get("first_name", "")
    cg = _caregiver(db, chat_id)

    if not text.startswith("/"):
        if not cg:
            tg_api.send(chat_id, _link(db, chat_id, "", first_name))
        else:
            tg_api.send(chat_id, "¿Qué registramos? (para guardar texto usa /nota …)", menu_keyboard(db))
        return

    head, _, args = text[1:].partition(" ")
    cmd = head.split("@")[0].lower()
    args = args.strip()

    if not cg:
        tg_api.send(chat_id, _link(db, chat_id, args if cmd == "start" else "", first_name))
        return
    if cmd == "start" and not args:
        tg_api.send(chat_id, HELP, menu_keyboard(db))
        return

    reply, kb = handle_command(db, cg, chat_id, cmd, args)
    tg_api.send(chat_id, reply, kb)


def setup_webhook() -> dict | None:
    if not (tg_api.enabled() and settings.public_url):
        return None
    res = tg_api.call("setWebhook", url=f"{settings.public_url}/telegram/webhook",
                      secret_token=settings.webhook_secret,
                      allowed_updates=["message", "callback_query"])
    tg_api.call("setMyCommands", commands=[{"command": c, "description": d} for c, d in COMMANDS])
    return res
