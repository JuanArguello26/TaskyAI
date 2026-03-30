from pydantic import BaseModel
from datetime import datetime, date, time
from typing import Optional, List


class HabitBase(BaseModel):
    name: str
    description: Optional[str] = None
    frequency: str = "daily"
    start_date: Optional[date] = None
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    recurrence: Optional[List[str]] = None
    reminder_minutes_before: int = 5


class HabitCreate(HabitBase):
    pass


class HabitUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    frequency: Optional[str] = None
    start_date: Optional[date] = None
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    recurrence: Optional[List[str]] = None
    reminder_minutes_before: Optional[int] = None
    is_active: Optional[bool] = None


class HabitLogCreate(BaseModel):
    date: date
    is_completed: bool = True


class HabitResponse(HabitBase):
    id: int
    user_id: int
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class HabitLogResponse(BaseModel):
    id: int
    habit_id: int
    date: date
    is_completed: bool

    class Config:
        from_attributes = True
