from fastapi import APIRouter
from app.api.v1.endpoints import auth, tasks, notes, events, habits, reminders, dashboard, ai, users

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(tasks.router)
api_router.include_router(notes.router)
api_router.include_router(events.router)
api_router.include_router(habits.router)
api_router.include_router(reminders.router)
api_router.include_router(dashboard.router)
api_router.include_router(ai.router, prefix="/ai", tags=["ai"])
