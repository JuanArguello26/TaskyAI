from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Boolean, Date, Time, JSON
from sqlalchemy.orm import relationship
from datetime import datetime, time
from app.db.session import Base


class Habit(Base):
    __tablename__ = "habits"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(String(500), nullable=True)
    frequency = Column(String(50), default="daily")
    start_date = Column(Date, nullable=True)
    start_time = Column(Time, nullable=True)
    end_time = Column(Time, nullable=True)
    recurrence = Column(JSON, nullable=True)
    reminder_minutes_before = Column(Integer, default=5)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="habits")
    logs = relationship("HabitLog", back_populates="habit", cascade="all, delete-orphan")


class HabitLog(Base):
    __tablename__ = "habit_logs"

    id = Column(Integer, primary_key=True, index=True)
    habit_id = Column(Integer, ForeignKey("habits.id"), nullable=False)
    date = Column(Date, nullable=False)
    is_completed = Column(Boolean, default=True)

    habit = relationship("Habit", back_populates="logs")
