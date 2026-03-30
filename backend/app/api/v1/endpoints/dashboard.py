from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List
from datetime import date, datetime, timedelta
from app.db.session import get_db
from app.models.user import User
from app.models.task import Task, TaskStatus
from app.models.event import Event
from app.models.habit import Habit, HabitLog
from app.models.productivity import ProductivityLog
from app.schemas.dashboard import DashboardSummary, ProductivityDay, ProductivityHistory, MotivationalQuote
from app.core.security import get_current_user

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

QUOTES_LOW = [
    "Cada día es una oportunidad para empezar de nuevo.",
    "El éxito no es la meta, es el camino que recorres.",
    "Pequeños pasos führen a grandes cambios.",
    "No esperes a sentirte motivado, empieza y la motivación vendrá.",
    "Hoy es un buen día para hacer algo increíble.",
    "El único modo de hacer un gran trabajo es amar lo que haces.",
    "No te preocupes por los fracasos, preocúpate por las oportunidades de aprender de ellos.",
    "Los momentos difíciles son parte del viaje hacia el éxito.",
    "Tu potencial no tiene límites, solo tus creencias.",
    "Cada mañana tienes una oportunidad de ser mejor que ayer.",
    "El progreso siempre supera la perfección.",
    "Los giant leaps comienzan con pequeños pasos.",
    "Hoy es el día perfecto para comenzar algo nuevo.",
    "La disciplina es el puente entre tus sueños y tus logros.",
    "No esperes a mañana lo que puedes hacer hoy.",
    "Cada esfuerzo cuenta, aunque no veas resultados inmediatos.",
    "Tu única competencia es quien eras ayer.",
    "Los obstáculos son oportunidades disfrazadas.",
    "La perseverancia no es correr rápido, es nunca parar.",
    "Confía en el proceso, los resultados vendrán."
]

QUOTES_MEDIUM = [
    "Vas por buen camino, sigue así.",
    "La consistencia es la clave del éxito.",
    "Cada pequeño progreso cuenta.",
    "Estás haciendo un gran trabajo.",
    "Sigue adelante, estás más cerca de tu objetivo.",
    "Tu esfuerzo de hoy es tu recompensa de mañana.",
    "Mantén el ritmo, los resultados están por llegar.",
    "Estás construyendo el hábito del éxito.",
    "La grandeza se construye día a día.",
    "Tu dedication está dando frutos.",
    "Cada paso cuenta en este viaje.",
    "Estás más cerca de tus metas de lo que crees.",
    "El trabajo duro supera al talento cuando el talento no trabaja duro.",
    "La motivación te trae aquí, la disciplina te hace quedar.",
    "Estás en el camino correcto, no pares ahora.",
    "Tus hábitos de hoy son tus resultados de mañana.",
    "El éxito es la suma de pequeños esfuerzos repetidos.",
    "Continúa pushing forward, estás haciendo progreso.",
    "La energía que pones hoy, verás sus frutos mañana.",
    "Mantén el enfoque, los resultados te sorprenderán."
]

QUOTES_HIGH = [
    "¡Increíble! Estás en tu mejor momento.",
    "Tu disciplina te está llevando lejos.",
    "¡Continúa así, eres imparable!",
    "Los resultados hablan por sí mismos.",
    "¡Eres una máquina de productividad!",
    "¡Tu racha está en llamas! Sigue así.",
    "El mundo no puede stop a alguien que no se rinde.",
    "¡Estás viviendo tu mejor versión!",
    "Tus hábitos son tu superpoder.",
    "La productividad te está transformando.",
    "¡Eres ejemplo de consistencia y dedicación!",
    "Tus esfuerzos están dando resultados extraordinarios.",
    "¡El éxito te queda muy bien!",
    "Estás demostrando de qué estás hecho.",
    "Tu compromiso contigo mismo es inspirador.",
    "¡Cada día superas tus propios récords!",
    "La grandeza es tu camino, no tu destino.",
    "¡Tu futuro yo te lo agradece hoy!",
    "Estás construyendo algo extraordinario.",
    "¡El éxito es tu segundo nombre!"
]


def calculate_productivity_score(tasks_completed: int, habits_completed: int, total_habits: int) -> float:
    if total_habits == 0:
        task_weight = 0.7
        habit_weight = 0.3
    else:
        task_weight = 0.7
        habit_weight = 0.3
    
    task_score = min(tasks_completed * 10, 100) * task_weight
    habit_score = (habits_completed / total_habits * 100) if total_habits > 0 else 0 * habit_weight
    
    return round(task_score + habit_score, 1)


@router.get("/summary", response_model=DashboardSummary)
def get_dashboard_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    today = date.today()
    
    tasks_completed = db.query(Task).filter(
        Task.user_id == current_user.id,
        Task.status == TaskStatus.COMPLETED,
        Task.completed_at >= datetime.combine(today, datetime.min.time())
    ).count()
    
    tasks_pending = db.query(Task).filter(
        Task.user_id == current_user.id,
        Task.status != TaskStatus.COMPLETED
    ).count()
    
    habits = db.query(Habit).filter(Habit.user_id == current_user.id).all()
    habits_completed = db.query(HabitLog).join(Habit).filter(
        Habit.user_id == current_user.id,
        HabitLog.date == today,
        HabitLog.is_completed == True
    ).count()
    
    events_today = db.query(Event).filter(
        Event.user_id == current_user.id,
        Event.start_time >= datetime.combine(today, datetime.min.time()),
        Event.start_time < datetime.combine(today + timedelta(days=1), datetime.min.time())
    ).count()
    
    productivity_score = calculate_productivity_score(tasks_completed, habits_completed, len(habits))
    
    streak = 0
    check_date = today
    while True:
        day_habits = db.query(HabitLog).join(Habit).filter(
            Habit.user_id == current_user.id,
            HabitLog.date == check_date,
            HabitLog.is_completed == True
        ).count()
        if day_habits == len(habits) and len(habits) > 0:
            streak += 1
            check_date -= timedelta(days=1)
        else:
            break
    
    return DashboardSummary(
        productivity_score=productivity_score,
        tasks_completed=tasks_completed,
        tasks_pending=tasks_pending,
        habits_completed=habits_completed,
        habits_total=len(habits),
        events_today=events_today,
        streak=streak
    )


@router.get("/productivity", response_model=ProductivityHistory)
def get_productivity_history(
    days: int = 7,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    today = date.today()
    result = []
    
    for i in range(days - 1, -1, -1):
        check_date = today - timedelta(days=i)
        
        tasks_completed = db.query(Task).filter(
            Task.user_id == current_user.id,
            Task.status == TaskStatus.COMPLETED,
            Task.completed_at >= datetime.combine(check_date, datetime.min.time())
        ).count()
        
        habits_completed = db.query(HabitLog).join(Habit).filter(
            Habit.user_id == current_user.id,
            HabitLog.date == check_date,
            HabitLog.is_completed == True
        ).count()
        
        total_habits = db.query(Habit).filter(Habit.user_id == current_user.id).count()
        
        score = calculate_productivity_score(tasks_completed, habits_completed, total_habits)
        
        result.append(ProductivityDay(
            date=check_date,
            score=score,
            tasks_completed=tasks_completed,
            habits_completed=habits_completed
        ))
    
    return ProductivityHistory(days=result)


@router.get("/quote", response_model=MotivationalQuote)
def get_motivational_quote(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    today = date.today()
    
    tasks_completed = db.query(Task).filter(
        Task.user_id == current_user.id,
        Task.status == TaskStatus.COMPLETED,
        Task.completed_at >= datetime.combine(today, datetime.min.time())
    ).count()
    
    total_habits = db.query(Habit).filter(Habit.user_id == current_user.id).count()
    habits_completed = db.query(HabitLog).join(Habit).filter(
        Habit.user_id == current_user.id,
        HabitLog.date == today,
        HabitLog.is_completed == True
    ).count() if total_habits > 0 else 0
    
    score = calculate_productivity_score(tasks_completed, habits_completed, total_habits)
    
    if score < 30:
        import random
        quote = random.choice(QUOTES_LOW)
    elif score < 70:
        import random
        quote = random.choice(QUOTES_MEDIUM)
    else:
        import random
        quote = random.choice(QUOTES_HIGH)
    
    return MotivationalQuote(text=quote)
