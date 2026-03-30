from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.user import User
from app.api.v1.endpoints.auth import get_current_user
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timedelta
import random

router = APIRouter()

class ProductivitySummary(BaseModel):
    week_summary: str
    trends: List[str]
    score_change: float

class HabitSuggestion(BaseModel):
    habit_name: str
    reason: str
    difficulty: str
    description: str
    tips: List[str]
    types: List[str]
    resources: List[dict]

class TaskSuggestion(BaseModel):
    task_title: str
    reason: str
    priority: str
    description: str
    steps: List[str]
    benefits: List[str]

class AIResponse(BaseModel):
    summary: ProductivitySummary
    habit_suggestions: List[HabitSuggestion]
    task_suggestions: List[TaskSuggestion]
    insights: List[str]

PRODUCTIVITY_PHRASES = [
    "Basado en tus patrones de productividad, te recomiendo enfocarte en",
    "Analizando tu historial,",
    "Según tus métricas de la última semana,",
    "Tu asistente de IA ha detectado que",
    "Optimizando tu rutina,"
]

HABIT_SUGGESTIONS_DB = [
    {
        "habit_name": "Meditación matutina",
        "reason": "Reduce el estrés y mejora la concentración para el resto del día",
        "difficulty": "media",
        "description": "La meditación matutina de 5-15 minutos puede transformar tu día completo. Establece una intención clara y practica la atención plena antes de revisar correos o redes sociales.",
        "tips": [
            "Comienza con solo 3-5 minutos e incrementa gradualmente",
            "Usa aplicaciones como Headspace, Calm o Insight Timer",
            "Encuentra un lugar tranquilo sin distracciones",
            "Siéntate con la espalda recta pero cómoda",
            "Enfócate en tu respiración: inhala por 4 segundos, exhala por 6"
        ],
        "types": [
            "Meditación de atención plena (mindfulness)",
            "Meditación de visualización",
            "Meditación del cuerpo",
            "Meditación del sonido (mantra)"
        ],
        "resources": [
            {"title": "Guía para principiantes", "url": "https://www.mindful.org/how-to-meditate/"},
            {"title": "Meditaciones guiadas gratuitas", "url": "https://insighttimer.com/"},
            {"title": "Técnica 4-7-8 para dormir", "url": "https://www.healthline.com/health/4-7-8-breathing"}
        ]
    },
    {
        "habit_name": "Lectura de 15 minutos",
        "reason": "Mejora la claridad mental, reduce el estrés y expande tu conocimiento",
        "difficulty": "baja",
        "description": "Dedica 15-20 minutos diarios a la lectura. Puede ser ficción, no ficción, desarrollo personal o cualquier tema que te interese. El hábito de lectura constante multiplica tu conocimiento con el tiempo.",
        "tips": [
            "Lee primero cosa importante del día, no al final",
            "Mantén un libro siempre en tu bolsa o teléfono",
            "Únete a un club de lectura para mantener motivación",
            "Alterna entre lectura técnica y recreativa",
            "Toma notas de conceptos que quieras recordar"
        ],
        "types": [
            "Ficción (novela, cuentos)",
            "No ficción (historia, biografía)",
            "Desarrollo personal y productividad",
            "Ciencia y tecnología",
            "Filosofía y crecimiento personal"
        ],
        "resources": [
            {"title": "Goodreads - Recomendaciones", "url": "https://www.goodreads.com/"},
            {"title": "Audible - Audiolibros", "url": "https://www.audible.com/"},
            {"title": "Project Gutenberg - Libros gratuitos", "url": "https://www.gutenberg.org/"}
        ]
    },
    {
        "habit_name": "Ejercicio diario",
        "reason": "Aumenta la energía, mejora el estado de ánimo y la productividad",
        "difficulty": "media",
        "description": "El ejercicio regular no solo mejora tu salud física, sino que libera endorfinas que elevan tu estado de ánimo y claridad mental. No necesitas ir al gym: caminar, bailar, o ejercicios en casa cuentan.",
        "tips": [
            "Encuentra una actividad que disfrutes",
            "Comienza con 10-15 minutos diarios",
            "Programa el ejercicio como una reunión inmutable",
            "Combina ejercicio cardiovascular con fuerza",
            "舞 Mantén un registro de tu progreso"
        ],
        "types": [
            "Caminata rápida o trote",
            "Yoga o estiramientos",
            "Entrenamiento de fuerza (pesas o peso corporal)",
            "Baile o aeróbicos",
            "Deportes recreativos"
        ],
        "resources": [
            {"title": "YouTube Fitness - Entrenamientos gratuitos", "url": "https://www.youtube.com/results?search_query=home+workout+beginners"},
            {"title": "Nike Training Club", "url": "https://www.nike.com/training/"},
            {"title": "Seven - Ejercicios de 7 minutos", "url": "https://seven.app/"}
        ]
    },
    {
        "habit_name": "Gratitud diaria",
        "reason": "Aumenta la satisfacción personal y bienestar emocional",
        "difficulty": "baja",
        "description": "Escribir 3 cosas por las que agradeces cada día reorienta tu cerebro hacia lo positivo. Este simple hábito reduce la depresión, mejora las relaciones y aumenta la felicidad general.",
        "tips": [
            "Escribe por la mañana o antes de dormir",
            "Sé específico: en lugar de 'salud', escribe 'me siento bien físicamente'",
            "Incluye personas, experiencias y pequeñas cosas",
            "Revisa tu lista anterior para ver tu progreso",
            "No repitas las mismas cosas siempre"
        ],
        "types": [
            "Diario de gratitud escrito",
            "Notas de voz de gratitud",
            "Meditación de gratitud",
            "Agradecimiento mental al despertar"
        ],
        "resources": [
            {"title": "Five Minute Journal", "url": "https://www.fiveminutejournal.com/"},
            {"title": "Investigación sobre gratitud", "url": "https://positivepsychology.com/benefits-gratitude-research/"},
            {"title": "Cómo empezar un journal", "url": "https://www.healthline.com/health/mental-health/how-to-start-a-journal"}
        ]
    },
    {
        "habit_name": "Desconexión digital nocturna",
        "reason": "Mejora la calidad del sueño y descanso",
        "difficulty": "alta",
        "description": "Reducir la exposición a pantallas 1-2 horas antes de dormir mejora drásticamente la calidad del sueño. La luz azul suprime la melatonina y afecta tu ciclo natural de sueño.",
        "tips": [
            "Crea una rutina de desconexión: lectura, estiramientos, baño",
            "Pon el teléfono en modo avión o fuera de la habitación",
            "Usa gafas bloqueadoras de luz azul",
            "Establece una hora límite para redes sociales",
            "Crea un 'espacio de carga' lejos de la cama"
        ],
        "types": [
            "Sin pantallas 1 hora antes de dormir",
            "Modo no molestar extendido",
            "D detox de fines de semana",
            "App blockers programados"
        ],
        "resources": [
            {"title": "Blue Light Filter Apps", "url": "https://www.healthline.com/health/blue-light-filter"},
            {"title": "Sleep Foundation - Higiene del sueño", "url": "https://www.sleepfoundation.org/"},
            {"title": "f.lux - Filtro de luz azul PC", "url": "https://justgetflux.com/"}
        ]
    },
    {
        "habit_name": "Journaling",
        "reason": "Ayuda a procesar emociones, establecer objetivos y reflexionar",
        "difficulty": "baja",
        "description": "Escribir tus pensamientos reduce el estrés, clarifica ideas y te ayuda a identificar patrones. El journaling puede ser свободный: reflexiones, planificación, o simplemente 'brain dump'.",
        "tips": [
            "No te preocupes por la gramática o ortografía",
            "Usa 'prompts' si no sabes qué escribir",
            "Establece un tiempo específico (mañana o noche)",
            "Incluye: qué agradeces, qué aprendí, qué voy a hacer",
            "Revisa entradas antiguas mensualmente"
        ],
        "types": [
            "Journaling de gratitud",
            "Brain dump (escritura libre)",
            "Journaling de metas",
            "Journaling de reflexión diaria",
            "Bullet journal (sistema rápido)"
        ],
        "resources": [
            {"title": "Bullet Journal método", "url": "https://bulletjournal.com/"},
            {"title": "Prompts de journaling", "url": "https://www.thelaughinghousewife.co.uk/2022/04/100-journal-prompts-for-self-discovery.html"},
            {"title": "Aplicaciones de journaling", "url": "https://journey.cloud/"}
        ]
    },
    {
        "habit_name": "Agua mínima diaria",
        "reason": "La hidratación adecuada mejora energía, concentración y salud",
        "difficulty": "baja",
        "description": "Beber suficiente agua es fundamental para el funcionamiento óptimo del cuerpo y mente. La deshidratación causa fatiga, dificultad de concentración y mal humor.",
        "tips": [
            "Empieza el día con un vaso de agua",
            "Usa una botella marcada con objetivos",
            "Configura recordatorios cada hora",
            "Come frutas y verduras con alto contenido de agua",
            "Lleva una botella siempre contigo"
        ],
        "types": [
            "Agua natural",
            "Agua con limón",
            "Tés de hierbas",
            "Frutas con alto contenido de agua"
        ],
        "resources": [
            {"title": "Cuánta agua necesitas", "url": "https://www.mayoclinic.org/water"},
            {"title": "Signos de deshidratación", "url": "https://www.healthline.com/nutrition/water-hydration"}
        ]
    },
    {
        "habit_name": "Dormir 8 horas",
        "reason": "El sueño adecuado es fundamental para la memoria, aprendizaje y productividad",
        "difficulty": "alta",
        "description": "Dormir bien es tan importante como comer y ejercitarse. Durante el sueño, tu cerebro consolida la información del día y tu cuerpo se regenera.",
        "tips": [
            "Mantén un horario constante de sueño (incluso fines de semana)",
            "La habitación debe estar oscura, fresca y silenciosa",
            "Evita cafeína después del mediodía",
            "No comas heavy meals cerca de dormir",
            "Desarrolla una rutina de relajación pre-sueño"
        ],
        "types": [
            "Horario de sueño consistente",
            "Rutina de relajación",
            "Ambiente óptimo para dormir",
            "Gestión de exposición a luz"
        ],
        "resources": [
            {"title": "Sleep Hygiene Tips", "url": "https://www.sleepfoundation.org/sleep-hygiene"},
            {"title": "La ciencia del sueño", "url": "https://www.youtube.com/watch?v=nmwD6kKzK9k"},
            {"title": "Melatonina y sueño", "url": "https://www.healthline.com/health/melatonin-and-sleep"}
        ]
    }
]

TASK_SUGGESTIONS_DB = [
    {
        "task_title": "Revisar pendientes del día anterior",
        "reason": "Mantiene el momentum y asegura continuidad en tu trabajo",
        "priority": "alta",
        "description": "Iniciar el día revisando lo que quedó pendiente te ayuda a mantener continuidad y no perder el hilo de tus proyectos. Es una forma de 'conectar los puntos' antes de empezar algo nuevo.",
        "steps": [
            "Abre tu lista de tareas del día anterior",
            "Identifica qué quedó incompleto",
            "Decide: ¿completar hoy o reprogramar?",
            "Mueve las tareas pendientes a hoy",
            "Celebra lo que ya completaste"
        ],
        "benefits": [
            "Mantienes momentum de trabajo",
            "No pierdes continuidad en proyectos",
            " Reduces acumulación de tareas",
            "Empiezas el día con dirección clara"
        ]
    },
    {
        "task_title": "Bloque de trabajo profundo de 2 horas",
        "reason": "Tu mejor momento de concentración es por la mañana",
        "priority": "alta",
        "description": "El trabajo profundo (deep work) es cuando te enfocas sin distracciones en tareas que requieren concentración máxima. Estas sesiones son las más productivas para trabajo complejo.",
        "steps": [
            "Elimina todas las distracciones (teléfono, notificaciones)",
            "Define UN objetivo específico para la sesión",
            "Usa técnica Pomodoro (25 min trabajo / 5 min descanso)",
            "Escribe cualquier pensamiento que surja y vuelve al trabajo",
            "Al final, documenta lo que lograste"
        ],
        "benefits": [
            "Completa más trabajo de calidad",
            "Mejora tu capacidad de concentración",
            "Reduce el tiempo total necesario para tareas",
            "Experimenta 'flow state' más frecuentemente"
        ]
    },
    {
        "task_title": "Planificar mañana antes de terminar",
        "reason": "Reduce la carga cognitiva y mejora el sueño",
        "priority": "media",
        "description": "Planificar el día siguiente antes de terminar la jornada te permite desconectar mentalmente y empezar el día siguiente con claridad inmediata.",
        "steps": [
            "15 minutos antes del final de tu día",
            "Revisa lo que no completaste hoy",
            "Identifica 3 tareas más importantes para mañana",
            "Prepara lo que necesites (documentos, materiales)",
            "Escribe tu lista y cierra tu día"
        ],
        "benefits": [
            "Duermes mejor sin preocupaciones pendientes",
            "Empiezas mañana con dirección clara",
            " Reduces decisiones matutinas",
            "Tienes sensación de control sobre tu tiempo"
        ]
    },
    {
        "task_title": "Revisar y actualizar metas semanales",
        "reason": "Mantiene el enfoque en objetivos importantes",
        "priority": "media",
        "description": "Las metas a largo plazo pueden perderse en el día a día. Revisar semanalmente te ayuda a mantener el rumbo y hacer ajustes necesarios.",
        "steps": [
            "Elige un momento tranquilo (domingo o viernes)",
            "Revisa tus metas del mes/trimestre/año",
            "Evalúa progreso: ¿qué avanzaste? ¿qué obstáculos hubo?",
            "Ajusta acciones para la siguiente semana",
            "Celebrar logros, aunque sean pequeños"
        ],
        "benefits": [
            "Mantienes perspectiva a largo plazo",
            "Identificas patrones de éxito o fracaso",
            "Ajustas tu estrategia proactivamente",
            "Mantienes motivación al ver progreso"
        ]
    },
    {
        "task_title": "Organizar espacio de trabajo",
        "reason": "Un entorno limpio aumenta la productividad y reduce estrés",
        "priority": "baja",
        "description": "Tu ambiente influye directamente en tu mente. Un espacio de trabajo desordenado genera distracciones visuales y reduce tu capacidad de concentración.",
        "steps": [
            "Guarda lo que no usas frecuentemente",
            "Limpia tu escritorio al final del día",
            "Organiza cables y accesorios",
            "Ten solo lo esencial a la vista",
            "Limpia digitalmente: archivos, escritorio, correo"
        ],
        "benefits": [
            "Reduce distractions visuales",
            "Encuentras cosas más rápido",
            "Mejora tu estado mental",
            "Presentas mejor imagen profesional"
        ]
    },
    {
        "task_title": "Pausa activa: estiramientos",
        "reason": "El movimiento regular previene lesiones y mejora energía",
        "priority": "baja",
        "description": "Estar sentado por largos períodos causa tensión muscular, fatiga y reduce circulación. Pausas activas de 2-3 minutos cada hora mejoran bienestar y concentración.",
        "steps": [
            "Programa alertas cada 50-60 minutos",
            "Levántate y camina un minuto",
            "Estira cuello, hombros, espalda y piernas",
            "Mira a lo lejos para descansar los ojos",
            "Respiración profunda: 3 inhalaciones profundas"
        ],
        "benefits": [
            "Previene dolor de espalda y cuello",
            "Mejora circulación sanguínea",
            "Renueva concentración",
            "Reduce fatiga acumulada"
        ]
    },
    {
        "task_title": "Revisión financiera semanal",
        "reason": "Mantener tus finanzas en orden reduce estrés",
        "priority": "media",
        "description": "Dedica tiempo a revisar tus gastos, ingresos y metas financieras. La conciencia financiera es clave para la tranquilidad y planificación a largo plazo.",
        "steps": [
            "Revisa transacciones de la semana",
            "Compara con tu presupuesto",
            "Registra gastos en tu sistema",
            "Identifica áreas de ahorro",
            "Ajusta si te estás desviando"
        ],
        "benefits": [
            "Control sobre tu dinero",
            "Identificas gastos innecesarios",
            "Avanzas hacia metas financieras",
            "Reduce ansiedad por dinero"
        ]
    },
    {
        "task_title": "Aprendizaje de 30 minutos",
        "reason": "El aprendizaje continuo te mantiene competitivo y estimado",
        "priority": "media",
        "description": "Dedica tiempo diario a aprender algo nuevo relacionado con tus metas, carrera o intereses. El aprendizaje constante multiplica tus habilidades con el tiempo.",
        "steps": [
            "Elige un tema o habilidad a desarrollar",
            "Usa recursos: cursos, libros, podcasts, videos",
            "Toma notas de lo aprendido",
            "Aplica lo que aprendes inmediatamente",
            "Comparte tu conocimiento con otros"
        ],
        "benefits": [
            "Desarrollas habilidades valiosas",
            "Te mantiene actualizado en tu campo",
            "Abre oportunidades profesionales",
            "Satisface curiosidad intelectual"
        ]
    }
]

def generate_ai_response(user_id: int, db: Session) -> AIResponse:
    week_summary = random.choice(PRODUCTIVITY_PHRASES) + " esta semana lograste mantener un buen ritmo de productividad."
    
    trends = [
        "Tu productividad aumenta los martes y miércoles",
        "Completas más tareas por la mañana",
        "Tu racha de hábitos está mejorando"
    ]
    
    score_change = round(random.uniform(-5, 15), 1)
    
    habit_suggestions = [HabitSuggestion(**h) for h in random.sample(HABIT_SUGGESTIONS_DB, 3)]
    
    task_suggestions = [TaskSuggestion(**t) for t in random.sample(TASK_SUGGESTIONS_DB, 3)]
    
    insights = [
        "Has completado el 80% de tus tareas esta semana",
        "Tu racha de hábitos actuales es de 5 días",
        "Considera dividir tareas grandes en acciones más pequeñas",
        "Tu productividad los lunes ha mejorado un 15%"
    ]
    
    return AIResponse(
        summary=ProductivitySummary(
            week_summary=week_summary,
            trends=trends,
            score_change=score_change
        ),
        habit_suggestions=habit_suggestions,
        task_suggestions=task_suggestions,
        insights=insights
    )

@router.get("/insights", response_model=AIResponse)
def get_ai_insights(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    return generate_ai_response(current_user.id, db)

@router.get("/habit-suggestions", response_model=List[HabitSuggestion])
def get_habit_suggestions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    return [HabitSuggestion(**h) for h in random.sample(HABIT_SUGGESTIONS_DB, 5)]

@router.get("/task-suggestions", response_model=List[TaskSuggestion])
def get_task_suggestions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    return [TaskSuggestion(**t) for t in random.sample(TASK_SUGGESTIONS_DB, 5)]
