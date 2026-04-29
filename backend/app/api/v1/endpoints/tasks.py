from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Any
from datetime import datetime, timedelta
from app.db.session import get_db
from app.models.user import User
from app.models.task import Task, SubTask, TaskStatus
from app.models.reminder import Reminder
from app.schemas.task import TaskCreate, TaskUpdate, TaskResponse, TaskStatusUpdate, SubTaskCreate
from app.core.security import get_current_user
from app.api.v1.endpoints.users import add_xp, can_complete_for_xp

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _enum_to_value(v: Any) -> Any:
    if hasattr(v, 'value'):
        return v.value
    return v


def _dict_convert_enums(data: dict) -> dict:
    result = {}
    for k, v in data.items():
        result[k] = _enum_to_value(v)
    return result


@router.get("", response_model=List[TaskResponse])
def list_tasks(
    status: TaskStatus = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = db.query(Task).filter(Task.user_id == current_user.id)
    if status:
        query = query.filter(Task.status == status)
    return query.order_by(Task.created_at.desc()).all()


def _create_task_reminder(task: Task, db: Session, user_id: int):
    if task.due_date and task.due_date > datetime.utcnow().isoformat():
        due_date = datetime.fromisoformat(task.due_date.replace('Z', '+00:00'))
        reminder_time = due_date - timedelta(minutes=30)
        
        if reminder_time > datetime.utcnow():
            reminder = Reminder(
                user_id=user_id,
                title=f"Recordatorio: {task.title}",
                description=task.description or "Tarea pendiente",
                remind_at=reminder_time,
                related_task_id=task.id
            )
            db.add(reminder)


@router.post("", response_model=TaskResponse)
def create_task(
    task_data: TaskCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    task_dict = _dict_convert_enums(task_data.model_dump())
    task = Task(**task_dict, user_id=current_user.id)
    db.add(task)
    db.commit()
    db.refresh(task)
    
    _create_task_reminder(task, db, current_user.id)
    db.commit()
    
    add_xp(current_user, db, "create_task", 5, task.id, "task")
    db.commit()
    
    return task


@router.get("/{task_id}", response_model=TaskResponse)
def get_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise HTTPException(404, "Task not found")
    return task


@router.put("/{task_id}", response_model=TaskResponse)
def update_task(
    task_id: int,
    task_data: TaskUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise HTTPException(404, "Task not found")
    
    for key, value in task_data.model_dump(exclude_unset=True).items():
        setattr(task, key, value)
    
    db.commit()
    db.refresh(task)
    return task


@router.delete("/{task_id}")
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise HTTPException(404, "Task not found")
    
    db.delete(task)
    db.commit()
    return {"message": "Task deleted"}


@router.put("/{task_id}/status", response_model=TaskResponse)
def update_task_status(
    task_id: int,
    status_data: TaskStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise HTTPException(404, "Task not found")
    
    was_completed = task.status == TaskStatus.COMPLETED
    task.status = status_data.status
    if status_data.status == TaskStatus.COMPLETED and not was_completed:
        task.completed_at = datetime.utcnow()
        if can_complete_for_xp(current_user.id, task.id, "task", db):
            add_xp(current_user, db, "complete_task", 15, task.id, "task")
    
    db.commit()
    db.refresh(task)
    return task


@router.post("/{task_id}/subtasks", response_model=dict)
def add_subtask(
    task_id: int,
    subtask_data: SubTaskCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == current_user.id).first()
    if not task:
        raise HTTPException(404, "Task not found")
    
    subtask = SubTask(**subtask_data.model_dump(), task_id=task_id)
    db.add(subtask)
    db.commit()
    db.refresh(subtask)
    return {"message": "Subtask added", "subtask": subtask}
