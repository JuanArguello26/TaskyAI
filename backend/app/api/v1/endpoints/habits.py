from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from datetime import date, datetime, timedelta
from app.db.session import get_db
from app.models.user import User
from app.models.habit import Habit, HabitLog
from app.models.reminder import Reminder
from app.schemas.habit import HabitCreate, HabitUpdate, HabitResponse, HabitLogCreate, HabitLogResponse
from app.core.security import get_current_user

router = APIRouter(prefix="/habits", tags=["habits"])


@router.get("", response_model=List[HabitResponse])
def list_habits(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    return db.query(Habit).filter(Habit.user_id == current_user.id, Habit.is_active == True).order_by(Habit.created_at.desc()).all()


@router.post("", response_model=HabitResponse)
def create_habit(
    habit_data: HabitCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    habit = Habit(**habit_data.model_dump(), user_id=current_user.id)
    db.add(habit)
    db.commit()
    db.refresh(habit)
    
    if habit.start_time:
        _create_habit_reminders(habit, db, current_user.id)
    
    return habit


def _create_habit_reminders(habit: Habit, db: Session, user_id: int):
    if not habit.start_time:
        return
    
    reminder_title = f"Recordatorio: {habit.name}"
    reminder_description = habit.description or f"Scheduled at {habit.start_time}"
    
    today = date.today()
    for i in range(14):
        check_date = today + timedelta(days=i)
        
        day_name = check_date.strftime("%A").lower()
        
        if habit.recurrence and day_name not in habit.recurrence:
            continue
        
        reminder_dt = datetime.combine(check_date, habit.start_time)
        reminder_dt = reminder_dt - timedelta(minutes=habit.reminder_minutes_before)
        
        if reminder_dt > datetime.now():
            reminder = Reminder(
                user_id=user_id,
                title=reminder_title,
                description=reminder_description,
                remind_at=reminder_dt,
                related_habit_id=habit.id
            )
            db.add(reminder)
    
    db.commit()


@router.get("/{habit_id}", response_model=HabitResponse)
def get_habit(
    habit_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    habit = db.query(Habit).filter(Habit.id == habit_id, Habit.user_id == current_user.id).first()
    if not habit:
        raise HTTPException(404, "Habit not found")
    return habit


@router.put("/{habit_id}", response_model=HabitResponse)
def update_habit(
    habit_id: int,
    habit_data: HabitUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    habit = db.query(Habit).filter(Habit.id == habit_id, Habit.user_id == current_user.id).first()
    if not habit:
        raise HTTPException(404, "Habit not found")
    
    old_start_time = habit.start_time
    
    for key, value in habit_data.model_dump(exclude_unset=True).items():
        setattr(habit, key, value)
    
    db.commit()
    db.refresh(habit)
    
    if habit.start_time and habit.start_time != old_start_time:
        db.query(Reminder).filter(
            Reminder.related_habit_id == habit.id
        ).delete()
        _create_habit_reminders(habit, db, current_user.id)
    
    return habit


@router.delete("/{habit_id}")
def delete_habit(
    habit_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    habit = db.query(Habit).filter(Habit.id == habit_id, Habit.user_id == current_user.id).first()
    if not habit:
        raise HTTPException(404, "Habit not found")
    
    db.query(Reminder).filter(Reminder.related_habit_id == habit_id).delete()
    
    db.delete(habit)
    db.commit()
    return {"message": "Habit deleted"}


@router.post("/{habit_id}/log", response_model=HabitLogResponse)
def log_habit(
    habit_id: int,
    log_data: HabitLogCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    habit = db.query(Habit).filter(Habit.id == habit_id, Habit.user_id == current_user.id).first()
    if not habit:
        raise HTTPException(404, "Habit not found")
    
    existing_log = db.query(HabitLog).filter(
        HabitLog.habit_id == habit_id,
        HabitLog.date == log_data.date
    ).first()
    
    if existing_log:
        existing_log.is_completed = log_data.is_completed
        db.commit()
        db.refresh(existing_log)
        return existing_log
    
    log = HabitLog(**log_data.model_dump(), habit_id=habit_id)
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


@router.get("/{habit_id}/logs", response_model=List[HabitLogResponse])
def get_habit_logs(
    habit_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    habit = db.query(Habit).filter(Habit.id == habit_id, Habit.user_id == current_user.id).first()
    if not habit:
        raise HTTPException(404, "Habit not found")
    
    return db.query(HabitLog).filter(HabitLog.habit_id == habit_id).order_by(HabitLog.date.desc()).all()
