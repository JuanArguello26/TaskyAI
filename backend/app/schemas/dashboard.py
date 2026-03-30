from pydantic import BaseModel
from datetime import date
from typing import List, Optional


class DashboardSummary(BaseModel):
    productivity_score: float
    tasks_completed: int
    tasks_pending: int
    habits_completed: int
    habits_total: int
    events_today: int
    streak: int


class ProductivityDay(BaseModel):
    date: date
    score: float
    tasks_completed: int
    habits_completed: int


class ProductivityHistory(BaseModel):
    days: List[ProductivityDay]


class MotivationalQuote(BaseModel):
    text: str
    author: Optional[str] = None
