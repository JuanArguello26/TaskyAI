from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from app.db.session import get_db
from app.models.user import User
from app.models.note import Note
from app.schemas.note import NoteCreate, NoteUpdate, NoteResponse
from app.core.security import get_current_user
from app.api.v1.endpoints.users import add_xp

router = APIRouter(prefix="/notes", tags=["notes"])


@router.get("", response_model=List[NoteResponse])
def list_notes(
    category: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(Note).filter(Note.user_id == current_user.id)
    if category:
        query = query.filter(Note.category == category)
    return query.order_by(Note.updated_at.desc()).all()


@router.post("", response_model=NoteResponse)
def create_note(
    note_data: NoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    note = Note(**note_data.model_dump(), user_id=current_user.id)
    db.add(note)
    db.commit()
    db.refresh(note)
    
    add_xp(current_user, db, "create_note", 3, note.id, "note")
    db.commit()
    
    return note


@router.get("/{note_id}", response_model=NoteResponse)
def get_note(
    note_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    note = db.query(Note).filter(Note.id == note_id, Note.user_id == current_user.id).first()
    if not note:
        raise HTTPException(404, "Note not found")
    return note


@router.put("/{note_id}", response_model=NoteResponse)
def update_note(
    note_id: int,
    note_data: NoteUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    note = db.query(Note).filter(Note.id == note_id, Note.user_id == current_user.id).first()
    if not note:
        raise HTTPException(404, "Note not found")
    
    for key, value in note_data.model_dump(exclude_unset=True).items():
        setattr(note, key, value)
    
    db.commit()
    db.refresh(note)
    return note


@router.delete("/{note_id}")
def delete_note(
    note_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    note = db.query(Note).filter(Note.id == note_id, Note.user_id == current_user.id).first()
    if not note:
        raise HTTPException(404, "Note not found")
    
    db.delete(note)
    db.commit()
    return {"message": "Note deleted"}
