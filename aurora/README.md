# 🌙 Aurora — diario de la bebé

App web + bot de Telegram para que papá y mamá registren comidas, sueño, pañales, baños,
medicinas, temperatura y peso, agenden controles y reciban recordatorios.

**Todo gratis:** Render (hosting) · Neon (Postgres) · cron-job.org (recordatorios) · Telegram.

---

## Despliegue (≈ 20 minutos)

### 1. Base de datos — Neon (gratis)
1. Entra a https://neon.tech y crea una cuenta (con GitHub o Google; no pide tarjeta).
2. Crea un proyecto llamado `aurora` (región: la más cercana, ej. `AWS US East`).
3. En **Connection string** copia la URL que empieza con `postgresql://…?sslmode=require`.
   Esa es tu `DATABASE_URL`. Las tablas se crean solas al arrancar.

### 2. Bot de Telegram
1. En Telegram habla con **@BotFather** → `/newbot` → ponle nombre (ej. *Aurora Bebé*) y usuario (ej. `aurora_arguello_bot`).
2. Copia el **token** que te da. Ese es tu `TELEGRAM_TOKEN`.

### 3. Hosting — Render (gratis)
1. Entra a https://render.com con tu cuenta de GitHub.
2. **New → Blueprint** → elige el repo `TaskyAI` (rama `aurora`). Render lee `render.yaml`.
3. Te pedirá 3 valores:
   - `DATABASE_URL` → la de Neon
   - `FAMILY_PIN` → el PIN que usarán tú y tu esposa (ej. 6 dígitos)
   - `TELEGRAM_TOKEN` → el de BotFather
4. Deploy. Cuando termine tendrás una URL tipo `https://aurora-bebe.onrender.com`.
   El webhook de Telegram se configura solo al arrancar.

> Si cambias de zona horaria, edita `APP_TZ` (ej. `America/Santiago`, `America/Mexico_City`).

### 4. Recordatorios — cron-job.org (gratis)
Render gratis "se duerme" tras 15 min sin visitas y además alguien tiene que revisar
cada minuto si toca mandar un recordatorio. Para eso:

1. En Render → tu servicio → **Environment**, copia el valor de `CRON_KEY`.
2. Entra a https://cron-job.org, crea cuenta y **Create cronjob**:
   - URL: `https://TU-APP.onrender.com/cron/tick?key=TU_CRON_KEY`
   - Horario: **cada 1 minuto**
3. Listo. Ese ping mantiene la app despierta y dispara los avisos.
   La app recuerda en memoria cuándo toca el próximo aviso, así que la mayoría de pings
   **no tocan la base de datos** (Neon puede dormir y no gastas horas gratis).

### 5. Vincular a papá y mamá
- **Web:** abre la URL en el celular, entra con el PIN y tu nombre.
  En el menú del navegador → *Agregar a pantalla de inicio* para tenerla como app.
- **Telegram:** abre tu bot y escribe `/start TUPIN Juan` (tu esposa: `/start TUPIN SuNombre`).

---

## Uso en Telegram

| Comando | Qué hace |
|---|---|
| `/menu` | Botones rápidos (biberón, pecho, dormir/despertar, pañal, baño) |
| `/estado` | Última comida, sueño, pañal, baño y resumen del día |
| `/comida 90` | Biberón de 90 ml (`/formula 90` para fórmula) |
| `/pecho izq 15` | Pecho izquierdo 15 min |
| `/dormir` · `/desperto` | Inicia / termina el sueño |
| `/panal pipi` · `popo` · `ambos` | Pañal |
| `/bano` · `/medicina Vitamina D` · `/temp 37.2` · `/peso 3.4` · `/nota …` | Otros registros |
| `/hoy` | Todo lo registrado hoy |
| `/recordar 30m vitamina` | Recordatorio (también `15:30 …`, `mañana 8:00 …`, `cada 3h …`) |
| `/control 01/12 9:30 Pediatra \| Clínica X` | Control médico (avisa 24 h y 2 h antes) |
| `/agenda` | Controles y recordatorios |
| `/deshacer` | Borra tu último registro (última hora) |
| `/avisos` | Activa/desactiva avisos cuando el otro registra algo |

**¿Se te olvidó registrar?** Agrega la hora al final: `/comida 60 hace 20m`, `/panal popo 14:10`, `/dormir 13:45`.

Avisos automáticos:
- Cuando uno registra algo, al otro le llega un aviso (desactivable con `/avisos`).
- Si pasan **3 h** sin comer (`FEED_ALERT_HOURS`), avisa a ambos.
- Controles: 24 h y 2 h antes.

---

## Desarrollo local

```bash
cd aurora
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt pytest
FAMILY_PIN=1111 .venv/bin/uvicorn app.main:app --reload   # http://localhost:8000
.venv/bin/python -m pytest -q
```

Sin `DATABASE_URL` usa SQLite local (`aurora.db`). Sin `TELEGRAM_TOKEN` el bot queda apagado.

## Variables de entorno

| Variable | Default | |
|---|---|---|
| `DATABASE_URL` | SQLite local | Cualquier Postgres (Neon, Aiven, etc.) |
| `FAMILY_PIN` | `1234` | **Cámbialo.** Entrada web y vinculación del bot |
| `SECRET_KEY` | — | Firma las sesiones (Render la genera) |
| `CRON_KEY` | — | Protege `/cron/tick` (Render la genera) |
| `TELEGRAM_TOKEN` | — | Token de BotFather |
| `APP_TZ` | `America/Bogota` | Zona horaria de la familia |
| `BABY_NAME` | `Aurora` | |
| `FEED_ALERT_HOURS` | `3` | `0` para desactivar |
| `PUBLIC_URL` | `RENDER_EXTERNAL_URL` | Solo si no usas Render |

## Respaldo
Ajustes → **Descargar respaldo (JSON)**, o `GET /api/export`.
