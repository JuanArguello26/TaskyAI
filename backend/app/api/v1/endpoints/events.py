from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime, timedelta
from app.db.session import get_db
from app.models.user import User
from app.models.event import Event
from app.models.reminder import Reminder
from app.schemas.event import EventCreate, EventUpdate, EventResponse
from app.core.security import get_current_user
from app.api.v1.endpoints.users import add_xp

router = APIRouter(prefix="/events", tags=["events"])


@router.get("", response_model=List[EventResponse])
def list_events(
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(Event).filter(Event.user_id == current_user.id, Event.is_active == True)
    if start_date:
        query = query.filter(Event.start_time >= start_date)
    if end_date:
        query = query.filter(Event.start_time <= end_date)
    return query.order_by(Event.start_time.asc()).all()


@router.post("", response_model=EventResponse)
def create_event(
    event_data: EventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    event = Event(**event_data.model_dump(), user_id=current_user.id)
    db.add(event)
    db.commit()
    db.refresh(event)
    
    _create_event_reminder(event, db, current_user.id)
    
    add_xp(current_user, db, "create_event", 3, event.id, "event")
    db.commit()
    
    return event


def _create_event_reminder(event: Event, db: Session, user_id: int):
    if event.reminder_minutes_before and event.reminder_minutes_before > 0:
        reminder_dt = event.start_time - timedelta(minutes=event.reminder_minutes_before)
        
        if reminder_dt > datetime.now():
            reminder = Reminder(
                user_id=user_id,
                title=f"Recordatorio: {event.title}",
                description=event.description,
                remind_at=reminder_dt,
                related_event_id=event.id
            )
            db.add(reminder)
            db.commit()


@router.get("/{event_id}", response_model=EventResponse)
def get_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    event = db.query(Event).filter(Event.id == event_id, Event.user_id == current_user.id).first()
    if not event:
        raise HTTPException(404, "Event not found")
    return event


@router.put("/{event_id}", response_model=EventResponse)
def update_event(
    event_id: int,
    event_data: EventUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    event = db.query(Event).filter(Event.id == event_id, Event.user_id == current_user.id).first()
    if not event:
        raise HTTPException(404, "Event not found")
    
    old_start_time = event.start_time
    
    for key, value in event_data.model_dump(exclude_unset=True).items():
        setattr(event, key, value)
    
    db.commit()
    db.refresh(event)
    
    if event.start_time != old_start_time:
        db.query(Reminder).filter(
            Reminder.related_event_id == event.id
        ).delete()
        _create_event_reminder(event, db, current_user.id)
    
    return event


@router.delete("/{event_id}")
def delete_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    event = db.query(Event).filter(Event.id == event_id, Event.user_id == current_user.id).first()
    if not event:
        raise HTTPException(404, "Event not found")
    
    db.query(Reminder).filter(Reminder.related_event_id == event_id).delete()
    
    db.delete(event)
    db.commit()
    return {"message": "Event deleted"}
