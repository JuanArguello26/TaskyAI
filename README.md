# Tasky AI - Life OS con Inteligencia Artificial

Sistema de productividad personal (Life OS) con Inteligencia Artificial para gestionar tareas, notas, eventos, hábitos, recordatorios y métricas de productividad en un solo lugar. Cuenta con sugerencias inteligentes de IA para optimizar tu día.

## 🚀 Características

- **Dashboard**: Resumen diario con score de productividad, tareas completadas, hábitos cumplidos y eventos
- **Sistema de Tareas**: CRUD completo con prioridades, fechas límite y estados
- **Notas**: Segundo cerebro con categorías y soporte markdown
- **Calendario**: Vista semanal de eventos
- **Hábitos**: Tracking diario con rachas (streaks) y análisis de consistencia
- **Asistente de IA**: Resúmenes de productividad, sugerencias personalizadas de hábitos y tareas
- **Motivación**: Frases dinámicas según tu nivel de productividad

## 🛠️ Tech Stack

### Backend
- **Framework**: FastAPI (Python)
- **Base de datos**: PostgreSQL
- **ORM**: SQLAlchemy
- **Autenticación**: JWT (Access + Refresh tokens)

### Frontend
- **Framework**: Next.js 14 (React)
- **Estilos**: Tailwind CSS
- **Estado**: Zustand
- **HTTP**: Axios

## 📋 Requisitos

- Python 3.11+
- Node.js 18+
- PostgreSQL (o SQLite para desarrollo)

## 🏃‍♂️ Instalación y Ejecución

### 1. Clonar el proyecto

```bash
git clone <repo-url>
cd tasky
```

### 2. Configurar Backend

```bash
cd backend

# Crear entorno virtual
python -m venv venv
source venv/bin/activate  # Linux/Mac
# o
venv\Scripts\activate  # Windows

# Instalar dependencias
pip install -r requirements.txt

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tu URL de base de datos

# Ejecutar servidor
uvicorn main:app --reload
```

El backend estará disponible en `http://localhost:8000`

### 3. Configurar Frontend

```bash
cd frontend

# Instalar dependencias
npm install

# Ejecutar servidor de desarrollo
npm run dev
```

El frontend estará disponible en `http://localhost:3000`

## 📁 Estructura del Proyecto

```
tasky/
├── backend/
│   ├── app/
│   │   ├── api/v1/endpoints/  # Endpoints de API
│   │   ├── core/              # Configuración y seguridad
│   │   ├── db/                # Sesión de base de datos
│   │   ├── models/            # Modelos SQLAlchemy
│   │   └── schemas/           # Schemas Pydantic
│   ├── main.py
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── app/               # Páginas Next.js
│   │   ├── components/        # Componentes React
│   │   ├── lib/               # API client
│   │   ├── store/             # Zustand store
│   │   └── types/             # TypeScript types
│   ├── package.json
│   └── tailwind.config.ts
│
└── README.md
```

## 🔌 API Endpoints

### Autenticación
- `POST /api/v1/auth/register` - Registro de usuario
- `POST /api/v1/auth/login` - Inicio de sesión
- `POST /api/v1/auth/refresh` - Refresh token
- `POST /api/v1/auth/logout` - Cerrar sesión

### Tareas
- `GET /api/v1/tasks` - Listar tareas
- `POST /api/v1/tasks` - Crear tarea
- `GET/PUT/DELETE /api/v1/tasks/{id}` - CRUD tarea
- `PUT /api/v1/tasks/{id}/status` - Cambiar estado

### Notas
- `GET /api/v1/notes` - Listar notas
- `POST /api/v1/notes` - Crear nota
- `GET/PUT/DELETE /api/v1/notes/{id}` - CRUD nota

### Eventos
- `GET /api/v1/events` - Listar eventos
- `POST /api/v1/events` - Crear evento
- `GET/PUT/DELETE /api/v1/events/{id}` - CRUD evento

### Hábitos
- `GET /api/v1/habits` - Listar hábitos
- `POST /api/v1/habits` - Crear hábito
- `POST /api/v1/habits/{id}/log` - Registrar cumplimiento

### Dashboard
- `GET /api/v1/dashboard/summary` - Resumen diario
- `GET /api/v1/dashboard/productivity` - Score últimos 7 días
- `GET /api/v1/dashboard/quote` - Frase motivacional

## 🎨 Uso

1. **Regístrate** en la página de login
2. **Explora el Dashboard** para ver tu productividad
3. **Crea tareas** en la sección de Tareas
4. **Agrega eventos** en el Calendario
5. **Crea hábitos** y marca tu progreso diario
6. **Escribe notas** en la sección de Notas
7. **Recibe motivación** basada en tu desempeño

## 🚀 Despliegue

### Backend (Railway/Render/Heroku)
1. Configurar DATABASE_URL
2. Configurar SECRET_KEY
3. Desplegar como servicio Python

### Frontend (Vercel)
1. Conectar repositorio a Vercel
2. Configurar NEXT_PUBLIC_API_URL al backend
3. Desplegar

## 📝 Licencia

MIT License
