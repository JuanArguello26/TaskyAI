from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class ReminderBase(BaseModel):
    title: str
    description: Optional[str] = None
    remind_at: datetime
    related_task_id: Optional[int] = None


class ReminderCreate(ReminderBase):
    pass


class ReminderUpdate(BaseModel):
    is_dismissed: Optional[bool] = None


class ReminderResponse(ReminderBase):
    id: int
    user_id: int
    related_habit_id: Optional[int] = None
    related_event_id: Optional[int] = None
    is_sent: bool
    is_dismissed: bool
    created_at: datetime

    class Config:
        from_attributes = True
