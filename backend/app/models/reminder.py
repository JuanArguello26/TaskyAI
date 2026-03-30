from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime
from app.db.session import Base


class Reminder(Base):
    __tablename__ = "reminders"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String(500), nullable=False)
    description = Column(String(1000), nullable=True)
    remind_at = Column(DateTime, nullable=False)
    related_task_id = Column(Integer, ForeignKey("tasks.id"), nullable=True)
    related_habit_id = Column(Integer, ForeignKey("habits.id"), nullable=True)
    related_event_id = Column(Integer, ForeignKey("events.id"), nullable=True)
    is_sent = Column(Boolean, default=False)
    is_dismissed = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="reminders")
    related_task = relationship("Task", back_populates="reminders")
