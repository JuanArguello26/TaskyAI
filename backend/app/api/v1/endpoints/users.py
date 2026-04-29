from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from app.db.session import get_db
from app.models.user import User
from app.models.xp_history import XPHistory
from app.schemas.user import UserResponse, UserUpdate, PasswordChange, UserWithXP
from app.core.security import get_password_hash, verify_password, get_current_user

router = APIRouter(prefix="/users", tags=["users"])


def calculate_xp_for_level(level: int) -> int:
    return 100 * (level ** 1.5)


def calculate_level_from_xp(experience: int) -> tuple[int, int]:
    level = 1
    while experience >= calculate_xp_for_level(level):
        experience -= calculate_xp_for_level(level)
        level += 1
    return level, experience


@router.get("/me", response_model=UserWithXP)
def get_current_user_info(current_user: User = Depends(get_current_user)):
    xp_to_next = calculate_xp_for_level(current_user.level) - current_user.experience
    return UserWithXP(
        id=current_user.id,
        email=current_user.email,
        name=current_user.name,
        experience=current_user.experience,
        level=current_user.level,
        created_at=current_user.created_at,
        xp_to_next_level=xp_to_next
    )


@router.put("/me", response_model=UserResponse)
def update_user(user_update: UserUpdate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user_update.name:
        current_user.name = user_update.name
    db.commit()
    db.refresh(current_user)
    return current_user


@router.put("/me/password")
def change_password(password_data: PasswordChange, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(password_data.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect"
        )
    
    current_user.password_hash = get_password_hash(password_data.new_password)
    db.commit()
    return {"message": "Password updated successfully"}


@router.delete("/me")
def delete_account(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.delete(current_user)
    db.commit()
    return {"message": "Account deleted successfully"}


def add_xp(user: User, db: Session, action_type: str, xp_amount: int, item_id: int = None, item_type: str = None):
    today = datetime.utcnow().date()
    today_start = datetime.combine(today, datetime.min.time())
    
    daily_xp = db.query(XPHistory).filter(
        XPHistory.user_id == user.id,
        XPHistory.created_at >= today_start
    ).sum(XPHistory.xp_gained) or 0
    
    if daily_xp >= 100:
        return None
    
    xp_to_add = min(xp_amount, 100 - daily_xp)
    
    xp_history = XPHistory(
        user_id=user.id,
        action_type=action_type,
        item_id=item_id,
        item_type=item_type,
        xp_gained=xp_to_add
    )
    db.add(xp_history)
    
    user.experience += xp_to_add
    new_level, remaining_xp = calculate_level_from_xp(user.experience)
    
    if new_level > user.level:
        user.level = new_level
        user.experience = remaining_xp
    
    return xp_to_add


def can_complete_for_xp(user_id: int, item_id: int, item_type: str, db: Session) -> bool:
    twenty_four_hours_ago = datetime.utcnow() - timedelta(hours=24)
    
    recent_creation = db.query(XPHistory).filter(
        XPHistory.user_id == user_id,
        XPHistory.item_id == item_id,
        XPHistory.item_type == item_type,
        XPHistory.action_type.in_(["create_task", "create_habit", "create_note", "create_event"]),
        XPHistory.created_at >= twenty_four_hours_ago
    ).first()
    
    return not recent_creation
