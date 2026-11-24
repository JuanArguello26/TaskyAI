"""Lógica compartida entre la web y el bot de Telegram."""

import re
from datetime import date, datetime, timedelta, timezone
from html import escape

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import tg_api
from .config import settings
from .models import KV, Appointment, Caregiver, Entry, Reminder

# ---------------------------------------------------------------- tiempo


def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_local(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc).astimezone(settings.tz)


def local_to_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=settings.tz)
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def parse_iso(value: str | datetime | None) -> datetime | None:
    """ISO del navegador (con Z u offset) -> UTC naive. Sin zona = hora local de la familia."""
    if value is None or value == "":
        return None
    dt = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return local_to_utc(dt)


def iso(dt: datetime | None) -> str | None:
    return dt.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z") if dt else None


def fmt_dur(seconds: float) -> str:
    minutes = int(seconds // 60)
    if minutes < 1:
        return "menos de 1 min"
    h, m = divmod(minutes, 60)
    if h >= 24:
        d, h = divmod(h, 24)
        return f"{d} d {h} h" if h else (f"{d} días" if d > 1 else "1 día")
    return f"{h} h {m:02d} min" if h else f"{m} min"


def fmt_time(dt: datetime) -> str:
    loc = to_local(dt)
    today = to_local(now_utc()).date()
    hhmm = loc.strftime("%H:%M")
    if loc.date() == today:
        return hhmm
    if loc.date() == today - timedelta(days=1):
        return f"ayer {hhmm}"
    if loc.date() == today + timedelta(days=1):
        return f"mañana {hhmm}"
    return loc.strftime("%d/%m %H:%M")


def ago(dt: datetime) -> str:
    return "hace " + fmt_dur((now_utc() - dt).total_seconds())


# ---------------------------------------------------------------- textos

KIND_LABEL = {
    "feed": "🍼 Comida",
    "sleep": "😴 Sueño",
    "diaper": "🧷 Pañal",
    "bath": "🛁 Baño",
    "medicine": "💊 Medicina",
    "temp": "🌡️ Temperatura",
    "weight": "⚖️ Peso",
    "note": "📝 Nota",
}
DETAIL_LABEL = {
    "pecho_izq": "pecho izquierdo",
    "pecho_der": "pecho derecho",
    "biberon": "biberón",
    "formula": "fórmula",
    "pipi": "pipí",
    "popo": "popó",
    "ambos": "pipí + popó",
}


def _num(x: float) -> str:
    return f"{x:g}"


def describe(e: Entry) -> str:
    parts = [KIND_LABEL.get(e.kind, e.kind)]
    if e.kind == "feed":
        if e.detail:
            parts.append(DETAIL_LABEL.get(e.detail, e.detail))
        if e.amount:
            unit = "min" if (e.detail or "").startswith("pecho") else "ml"
            parts.append(f"{_num(e.amount)} {unit}")
    elif e.kind == "sleep":
        end = e.end or now_utc()
        parts.append(fmt_dur((end - e.start).total_seconds()) + ("" if e.end else " (durmiendo)"))
    elif e.kind == "diaper":
        parts.append(DETAIL_LABEL.get(e.detail or "", e.detail or ""))
    elif e.kind == "temp" and e.amount:
        parts.append(f"{_num(e.amount)} °C")
    elif e.kind == "weight" and e.amount:
        parts.append(f"{_num(e.amount)} kg")
    elif e.kind == "medicine" and e.detail:
        parts.append(e.detail)
    text = " · ".join(p for p in parts if p)
    if e.note:
        text += f" — {e.note}"
    return text


# ---------------------------------------------------------------- KV


def kv_get(db: Session, key: str) -> str | None:
    row = db.get(KV, key)
    return row.value if row else None


def kv_set(db: Session, key: str, value: str | None) -> None:
    row = db.get(KV, key)
    if row:
        row.value = value
    else:
        db.add(KV(key=key, value=value))


# ---------------------------------------------------------------- notificaciones


def broadcast(db: Session, text: str, exclude_chat: str | None = None, exclude_name: str | None = None,
              only_subscribed: bool = False) -> int:
    sent = 0
    for c in db.scalars(select(Caregiver)):
        if exclude_chat and c.chat_id == str(exclude_chat):
            continue
        if exclude_name and c.name.strip().lower() == exclude_name.strip().lower():
            continue
        if only_subscribed and not c.notify_others:
            continue
        tg_api.send(c.chat_id, text)
        sent += 1
    return sent


def notify_entry(db: Session, e: Entry, verb: str = "registró", exclude_chat: str | None = None) -> None:
    who = escape(e.author or "Alguien")
    broadcast(db, f"👤 {who} {verb}: {escape(describe(e))} ({fmt_time(e.start)})",
              exclude_chat=exclude_chat, exclude_name=None if exclude_chat else e.author, only_subscribed=True)


# ---------------------------------------------------------------- registros


def create_entry(db: Session, kind: str, author: str | None, start: datetime | None = None,
                 end: datetime | None = None, detail: str | None = None, amount: float | None = None,
                 note: str | None = None) -> Entry:
    now = now_utc()
    e = Entry(kind=kind, start=start or now, end=end, detail=detail, amount=amount, note=note,
              author=author, created_at=now)
    if kind != "sleep" and e.end is None:
        e.end = e.start
    db.add(e)
    commit(db)
    return e


def active_sleep(db: Session) -> Entry | None:
    return db.scalars(
        select(Entry).where(Entry.kind == "sleep", Entry.end.is_(None)).order_by(Entry.start.desc())
    ).first()


def toggle_sleep(db: Session, author: str | None, at: datetime | None = None) -> tuple[Entry, bool]:
    """Devuelve (registro, se_durmio). Si estaba dormida, la despierta."""
    at = at or now_utc()
    current = active_sleep(db)
    if current:
        current.end = max(at, current.start)
        commit(db)
        return current, False
    return create_entry(db, "sleep", author, start=at), True


def last_of(db: Session, kind: str, detail_in: tuple | None = None) -> Entry | None:
    q = select(Entry).where(Entry.kind == kind)
    if detail_in:
        q = q.where(Entry.detail.in_(detail_in))
    return db.scalars(q.order_by(Entry.start.desc())).first()


def local_day_bounds(day: date) -> tuple[datetime, datetime]:
    start = local_to_utc(datetime.combine(day, datetime.min.time()))
    return start, start + timedelta(days=1)


def entries_between(db: Session, start: datetime, end: datetime, kind: str | None = None) -> list[Entry]:
    q = select(Entry).where(Entry.start < end, (Entry.end.is_(None)) | (Entry.end >= start))
    if kind:
        q = q.where(Entry.kind == kind)
    return list(db.scalars(q.order_by(Entry.start.desc())))


def day_summary(db: Session, day: date | None = None) -> dict:
    day = day or to_local(now_utc()).date()
    start, end = local_day_bounds(day)
    rows = entries_between(db, start, end)
    now = now_utc()
    sleep_secs = 0.0
    for e in rows:
        if e.kind == "sleep":
            s, f = max(e.start, start), min(e.end or now, end)
            sleep_secs += max(0.0, (f - s).total_seconds())
    in_day = [e for e in rows if start <= e.start < end]
    feeds = [e for e in in_day if e.kind == "feed"]
    diapers = [e for e in in_day if e.kind == "diaper"]
    return {
        "date": day.isoformat(),
        "feeds": len(feeds),
        "feed_ml": sum(e.amount or 0 for e in feeds if e.detail in ("biberon", "formula")),
        "breast_feeds": sum(1 for e in feeds if (e.detail or "").startswith("pecho")),
        "diapers": len(diapers),
        "pee": sum(1 for e in diapers if e.detail in ("pipi", "ambos")),
        "poop": sum(1 for e in diapers if e.detail in ("popo", "ambos")),
        "sleep_seconds": int(sleep_secs),
        "baths": sum(1 for e in in_day if e.kind == "bath"),
        "entries": in_day,
    }


def upcoming_appointments(db: Session, limit: int = 5) -> list[Appointment]:
    q = select(Appointment).where(Appointment.done.is_(False), Appointment.at >= now_utc() - timedelta(hours=3))
    return list(db.scalars(q.order_by(Appointment.at).limit(limit)))


def active_reminders(db: Session, limit: int = 20) -> list[Reminder]:
    q = select(Reminder).where(Reminder.active.is_(True)).order_by(Reminder.due_at).limit(limit)
    return list(db.scalars(q))


def birth_date(db: Session) -> date | None:
    v = kv_get(db, "birth_date")
    try:
        return date.fromisoformat(v) if v else None
    except ValueError:
        return None


def age_text(db: Session) -> str | None:
    b = birth_date(db)
    if not b:
        return None
    days = (to_local(now_utc()).date() - b).days
    if days < 0:
        return "falta 1 día para nacer" if days == -1 else f"faltan {-days} días para nacer"
    if days < 14:
        return f"{days} días de vida" if days != 1 else "1 día de vida"
    if days < 60:
        return f"{days // 7} semanas y {days % 7} días"
    return f"{days // 30} meses y {days % 30} días"


# ---------------------------------------------------------------- textos para el bot


def status_text(db: Session) -> str:
    name = escape(settings.baby_name)
    lines = [f"<b>👶 {name}</b>" + (f" · {age_text(db)}" if age_text(db) else "")]
    feed = last_of(db, "feed")
    lines.append(f"🍼 Última comida: {escape(describe(feed))}, {ago(feed.start)} ({fmt_time(feed.start)})"
                 if feed else "🍼 Sin comidas registradas")
    sl = active_sleep(db)
    if sl:
        lines.append(f"😴 Durmiendo desde {fmt_time(sl.start)} ({fmt_dur((now_utc() - sl.start).total_seconds())})")
    else:
        last = last_of(db, "sleep")
        if last and last.end:
            lines.append(f"😊 Despierta desde {fmt_time(last.end)} ({ago(last.end)}). "
                         f"Último sueño: {fmt_dur((last.end - last.start).total_seconds())}")
        else:
            lines.append("😴 Sin sueños registrados")
    dp = last_of(db, "diaper")
    lines.append(f"🧷 Último pañal: {escape(DETAIL_LABEL.get(dp.detail or '', dp.detail or ''))}, {ago(dp.start)}"
                 if dp else "🧷 Sin pañales registrados")
    poop = last_of(db, "diaper", ("popo", "ambos"))
    if poop and poop is not dp:
        lines.append(f"💩 Última popó: {ago(poop.start)}")
    bath = last_of(db, "bath")
    if bath:
        lines.append(f"🛁 Último baño: {ago(bath.start)}")
    s = day_summary(db)
    lines.append("")
    lines.append(f"<b>Hoy:</b> {s['feeds']} tomas"
                 + (f" ({_num(s['feed_ml'])} ml)" if s["feed_ml"] else "")
                 + f" · {s['diapers']} pañales ({s['pee']} pipí, {s['poop']} popó)"
                 + f" · sueño {fmt_dur(s['sleep_seconds']) if s['sleep_seconds'] >= 60 else '0 min'}")
    appts = upcoming_appointments(db, 1)
    if appts:
        a = appts[0]
        lines.append(f"📅 Próximo control: {escape(a.title)} — {fmt_time(a.at)}")
    return "\n".join(lines)


def today_text(db: Session) -> str:
    s = day_summary(db)
    if not s["entries"]:
        return "Hoy no hay registros todavía."
    lines = ["<b>📋 Registros de hoy</b>"]
    for e in reversed(s["entries"]):
        who = f" <i>({escape(e.author)})</i>" if e.author else ""
        lines.append(f"{to_local(e.start).strftime('%H:%M')} {escape(describe(e))}{who}")
    return "\n".join(lines[:60])


def agenda_text(db: Session) -> str:
    lines = ["<b>📅 Próximos controles</b>"]
    appts = upcoming_appointments(db, 10)
    lines += [f"• {fmt_time(a.at)} — {escape(a.title)}" + (f" ({escape(a.place)})" if a.place else "")
              for a in appts] or ["Ninguno. Agrega con /control"]
    lines.append("\n<b>⏰ Recordatorios</b>")
    rems = active_reminders(db)
    lines += [f"• #{r.id} {fmt_time(r.due_at)} — {escape(r.text)}"
              + (f" (cada {fmt_dur(r.repeat_minutes * 60)})" if r.repeat_minutes else "")
              for r in rems] or ["Ninguno. Agrega con /recordar"]
    return "\n".join(lines)


# ---------------------------------------------------------------- interpretar fechas en texto

_DUR = re.compile(r"^(?:(\d+)\s*d)?(?:(\d+)\s*h)?(?:(\d+)\s*m(?:in)?)?$", re.I)
_HHMM = re.compile(r"^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$", re.I)
_YMD = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})$")
_DMY = re.compile(r"^(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?$")


def parse_dur(tok: str) -> int | None:
    """'30m', '2h', '1h30m', '1d' -> minutos."""
    m = _DUR.match(tok.strip())
    if not m or not any(m.groups()):
        return None
    d, h, mi = (int(x) if x else 0 for x in m.groups())
    total = d * 1440 + h * 60 + mi
    return total or None


def _parse_hhmm(tok: str) -> tuple[int, int] | None:
    m = _HHMM.match(tok.strip())
    if not m or (m.group(2) is None and m.group(3) is None):
        return None  # "15" a secas no es hora; "3pm" o "15:00" sí
    h, mi = int(m.group(1)), int(m.group(2) or 0)
    ampm = (m.group(3) or "").lower()
    if ampm == "pm" and h < 12:
        h += 12
    if ampm == "am" and h == 12:
        h = 0
    if h > 23 or mi > 59:
        return None
    return h, mi


def _parse_day(tok: str, today: date) -> date | None:
    try:
        return _parse_day_raw(tok, today)
    except ValueError:
        raise ValueError(f"La fecha {tok} no existe") from None


def _parse_day_raw(tok: str, today: date) -> date | None:
    t = tok.lower()
    if t == "hoy":
        return today
    if t in ("mañana", "manana"):
        return today + timedelta(days=1)
    if t in ("pasado", "pasadomañana", "pasadomanana"):
        return today + timedelta(days=2)
    if m := _YMD.match(t):
        return date(int(m[1]), int(m[2]), int(m[3]))
    if m := _DMY.match(t):
        y = int(m[3]) if m[3] else today.year
        if y < 100:
            y += 2000
        d = date(y, int(m[2]), int(m[1]))
        if not m[3] and d < today:
            d = date(y + 1, d.month, d.day)
        return d
    return None


def parse_when(text: str, allow_repeat: bool = True) -> tuple[datetime, int | None, str]:
    """Interpreta '<cuándo> <texto>' en hora local. Devuelve (utc, repetir_minutos, resto).

    Ejemplos: '30m dar vitamina', '15:30 baño', 'mañana 9:00 pediatra',
    '01/12 10:00 vacuna', 'cada 3h comer'.
    """
    tokens = text.split()
    if not tokens:
        raise ValueError("Falta la hora")
    now_l = to_local(now_utc()).replace(second=0, microsecond=0, tzinfo=None)
    repeat = None
    if allow_repeat and tokens[0].lower() == "cada" and len(tokens) > 1 and (rep := parse_dur(tokens[1])):
        repeat = rep
        tokens = tokens[2:]
        due = now_l + timedelta(minutes=rep)
        # opcional: "cada 3h desde 14:00"
        if len(tokens) >= 2 and tokens[0].lower() == "desde" and (hm := _parse_hhmm(tokens[1])):
            due = now_l.replace(hour=hm[0], minute=hm[1])
            if due <= now_l:
                due += timedelta(days=1)
            tokens = tokens[2:]
    elif tokens[0].lower() == "en" and len(tokens) > 1 and (mins := parse_dur(tokens[1])):
        due = now_l + timedelta(minutes=mins)
        tokens = tokens[2:]
    elif mins := parse_dur(tokens[0]):
        due = now_l + timedelta(minutes=mins)
        tokens = tokens[1:]
    elif (day := _parse_day(tokens[0], now_l.date())) is not None:
        hm = _parse_hhmm(tokens[1]) if len(tokens) > 1 else None
        if hm is None:
            raise ValueError("Después del día pon la hora, ej: mañana 9:00")
        due = datetime.combine(day, datetime.min.time()).replace(hour=hm[0], minute=hm[1])
        tokens = tokens[2:]
    elif hm := _parse_hhmm(tokens[0]):
        due = now_l.replace(hour=hm[0], minute=hm[1])
        if due <= now_l:
            due += timedelta(days=1)
        tokens = tokens[1:]
    else:
        raise ValueError("No entendí la hora. Usa: 30m, 2h, 15:30, mañana 9:00, 01/12 10:00 o 'cada 3h'")
    rest = " ".join(tokens).strip()
    return local_to_utc(due), repeat, rest


# ---------------------------------------------------------------- recordatorios automáticos
#
# El cron externo llama a /cron/tick cada minuto. Para no despertar la base de datos
# (Neon se suspende sola y así no gastamos horas gratis), guardamos en memoria cuándo
# es el próximo aviso. Todas las escrituras pasan por commit(), que borra ese valor.

_next_check: datetime | None = None
_generation = 0  # cambia con cada escritura; evita guardar un cálculo viejo


def invalidate() -> None:
    global _next_check, _generation
    _next_check = None
    _generation += 1


def commit(db: Session) -> None:
    db.commit()
    invalidate()


def _feed_alert_due(db: Session) -> datetime | None:
    if settings.feed_alert_hours <= 0:
        return None
    last = last_of(db, "feed")
    if not last or kv_get(db, "feed_alert_for") == str(last.id):
        return None
    return last.start + timedelta(hours=settings.feed_alert_hours)


def _compute_next(db: Session, now: datetime) -> datetime:
    candidates = [now + timedelta(hours=6)]
    r = db.scalars(select(Reminder.due_at).where(Reminder.active.is_(True)).order_by(Reminder.due_at)).first()
    if r:
        candidates.append(r)
    for a in db.scalars(select(Appointment).where(Appointment.done.is_(False), Appointment.at > now)):
        if not a.notified_24h:
            candidates.append(a.at - timedelta(hours=24))
        if not a.notified_2h:
            candidates.append(a.at - timedelta(hours=2))
    if fa := _feed_alert_due(db):
        candidates.append(fa)
    return min(candidates)


def run_due(db: Session, now: datetime) -> list[str]:
    sent: list[str] = []
    for r in db.scalars(select(Reminder).where(Reminder.active.is_(True), Reminder.due_at <= now)):
        msg = f"⏰ <b>Recordatorio:</b> {escape(r.text)}"
        if r.repeat_minutes:
            while r.due_at <= now:
                r.due_at += timedelta(minutes=r.repeat_minutes)
            msg += f"\n<i>Próximo: {fmt_time(r.due_at)}</i>"
        else:
            r.active = False
        broadcast(db, msg)
        sent.append(f"reminder:{r.id}")

    for a in db.scalars(select(Appointment).where(Appointment.done.is_(False), Appointment.at > now)):
        left = a.at - now
        place = f"\n📍 {escape(a.place)}" if a.place else ""
        if not a.notified_2h and left <= timedelta(hours=2):
            broadcast(db, f"📅 <b>Control en {fmt_dur(left.total_seconds())}:</b> {escape(a.title)} "
                          f"({fmt_time(a.at)}){place}")
            a.notified_2h = a.notified_24h = True
            sent.append(f"appt2h:{a.id}")
        elif not a.notified_24h and left <= timedelta(hours=24):
            broadcast(db, f"📅 <b>Mañana / próximas horas:</b> {escape(a.title)} — {fmt_time(a.at)}{place}")
            a.notified_24h = True
            sent.append(f"appt24h:{a.id}")

    fa = _feed_alert_due(db)
    if fa and fa <= now:
        last = last_of(db, "feed")
        broadcast(db, f"🍼 Ya pasaron {ago(last.start)[5:]} desde la última comida de "
                      f"{escape(settings.baby_name)} ({fmt_time(last.start)}).")
        kv_set(db, "feed_alert_for", str(last.id))
        sent.append(f"feed_alert:{last.id}")

    if sent:
        db.commit()
    return sent


def tick(db_factory, force: bool = False) -> dict:
    global _next_check
    now = now_utc()
    if not force and _next_check is not None and now < _next_check:
        return {"checked": False, "next": iso(_next_check)}
    gen = _generation
    db = db_factory()
    try:
        sent = run_due(db, now)
        nxt = _compute_next(db, now)
        if gen == _generation:
            _next_check = nxt
        return {"checked": True, "sent": sent, "next": iso(nxt)}
    finally:
        db.close()
