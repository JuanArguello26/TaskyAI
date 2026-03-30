from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.orm import relationship
from datetime import datetime
from app.db.session import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    name = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    tasks = relationship("Task", back_populates="user")
    notes = relationship("Note", back_populates="user")
    events = relationship("Event", back_populates="user")
    habits = relationship("Habit", back_populates="user")
    reminders = relationship("Reminder", back_populates="user")
    productivity_logs = relationship("ProductivityLog", back_populates="user")
