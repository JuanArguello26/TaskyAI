from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base

# Todas las fechas se guardan en UTC "naive".

KINDS = ("feed", "sleep", "diaper", "bath", "medicine", "temp", "weight", "note")


class Entry(Base):
    """Un registro del bebé: comida, sueño, pañal, baño, medicina, etc."""

    __tablename__ = "entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), index=True)
    start: Mapped[datetime] = mapped_column(DateTime, index=True)
    end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # feed: pecho_izq | pecho_der | biberon | formula ; diaper: pipi | popo | ambos ; medicine: nombre
    detail: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # ml (biberón/fórmula), minutos (pecho), °C (temp), kg (peso)
    amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    author: Mapped[str | None] = mapped_column(String(60), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)


class Appointment(Base):
    """Controles médicos, vacunas, citas."""

    __tablename__ = "appointments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    at: Mapped[datetime] = mapped_column(DateTime, index=True)
    place: Mapped[str | None] = mapped_column(String(160), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    done: Mapped[bool] = mapped_column(Boolean, default=False)
    notified_24h: Mapped[bool] = mapped_column(Boolean, default=False)
    notified_2h: Mapped[bool] = mapped_column(Boolean, default=False)
    author: Mapped[str | None] = mapped_column(String(60), nullable=True)


class Reminder(Base):
    __tablename__ = "reminders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    text: Mapped[str] = mapped_column(String(200))
    due_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    repeat_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    author: Mapped[str | None] = mapped_column(String(60), nullable=True)


class Caregiver(Base):
    """Personas vinculadas al bot de Telegram."""

    __tablename__ = "caregivers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(60))
    chat_id: Mapped[str] = mapped_column(String(40), unique=True)
    notify_others: Mapped[bool] = mapped_column(Boolean, default=True)


class KV(Base):
    __tablename__ = "kv"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)
