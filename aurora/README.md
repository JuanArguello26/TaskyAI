# 🌙 Aurora — diario de la bebé

App web + bot de Telegram para que papá y mamá registren comidas, sueño, pañales, baños,
medicinas, temperatura y peso, agenden controles y reciban recordatorios.

**Todo gratis y en un solo lugar: Cloudflare** (Workers + base de datos D1 + cron).
No se duerme, no necesita pings externos y los despliegues no gastan minutos de compilación.

```
📱 Celulares (web + Telegram)
        │
        ▼
Cloudflare (tu cuenta)
  ⚙️ Worker "aurora"      → API, página web, bot, cron cada minuto
  🗄️ D1 "aurora-db"       → registros, citas, recordatorios, cuidadores, ajustes
```

---

## Despliegue (≈ 15 minutos, desde esta carpeta)

```bash
cd aurora
npm install
```

### 1. Cuenta de Cloudflare
Crea una cuenta gratis en https://dash.cloudflare.com/sign-up (no pide tarjeta) y luego:
```bash
npx wrangler login          # abre el navegador para autorizar
```

### 2. Base de datos
```bash
npx wrangler d1 create aurora-db
```
Copia el `database_id` que aparece y pégalo en `wrangler.toml` (donde dice `PEGA-AQUI-EL-ID-DE-TU-BASE`).
Luego crea las tablas:
```bash
npm run db:migrate
```

### 3. Bot de Telegram
En Telegram habla con **@BotFather** → `/newbot` → nombre (ej. *Aurora Bebé*) y usuario (ej. `aurora_familia_bot`).
Guarda el **token**.

### 4. Secretos
```bash
npx wrangler secret put FAMILY_PIN       # PIN de 6+ dígitos para ti y tu esposa
npx wrangler secret put SECRET_KEY       # cualquier texto largo y aleatorio
npx wrangler secret put TELEGRAM_TOKEN   # el token de BotFather
```
(Te pide el valor; no queda guardado en ningún archivo.)

> Si el primer `secret put` dice que el Worker no existe, haz primero el paso 5 y vuelve.

### 5. Publicar
```bash
npm run deploy
```
Te da una URL tipo `https://aurora.TU-USUARIO.workers.dev`.

### 6. Conectar el bot y vincularse
1. Abre la URL en el celular → entra con el PIN y tu nombre.
2. **Ajustes → 🔗 Conectar bot de Telegram** (una sola vez).
3. En Telegram, abre tu bot y escribe `/start TUPIN Juan`. Tu esposa: `/start TUPIN SuNombre`.
4. En el navegador del celular: menú → **Agregar a pantalla de inicio**.

¡Listo! El cron de Cloudflare revisa cada minuto los recordatorios, controles y alertas de comida.

---

## Uso en Telegram

| Comando | Qué hace |
|---|---|
| `/menu` | Botones rápidos (biberón, pecho, dormir/despertar, pañal, baño, agenda) |
| `/estado` | Última comida, sueño, pañal, baño y resumen del día |
| `/comida 30` | Biberón de 30 ml (`/formula 30` para fórmula) |
| `/pecho izq 15` | Pecho izquierdo 15 min |
| `/dormir` · `/desperto` | Inicia / termina el sueño |
| `/sueno 13:00 14:30` | Registra un sueño que ya pasó (o `/sueno 13:00 1h30m`) |
| `/panal pipi` · `popo` · `ambos` | Pañal |
| `/bano` · `/medicina Vitamina D` · `/temp 37.2` · `/peso 3.4` · `/nota …` | Otros registros |
| `/hoy` | Todo lo registrado hoy |
| `/recordar 30m vitamina` | Recordatorio (también `15:30 …`, `mañana 8:00 …`, `cada 3h …`) |
| `/control 01/12 9:30 Pediatra \| Clínica X` | Control médico (avisa 24 h y 2 h antes) |
| `/agenda` | Controles y recordatorios |
| `/deshacer` | Borra tu último registro (última hora) |
| `/avisos` | Activa/desactiva avisos cuando el otro registra algo |

**Sin "/" también funciona:** `popó`, `pipí`, `ambos`, `tetero 30`, `30 ml`, `pecho izq 10`,
`se durmió`, `se despertó`, `baño`, `estado`.

**¿Se te olvidó registrar?** Agrega la hora: `/comida 20 hace 20m`, `/panal popo 14:10`, `/dormir 13:45`.

Avisos automáticos (por Telegram):
- Cuando uno registra algo, al otro le llega un aviso (desactivable con `/avisos`).
- Si pasan **3 h** sin comer (`FEED_ALERT_HOURS` en `wrangler.toml`), avisa a ambos.
- Controles: 24 h y 2 h antes. Recordatorios: a la hora indicada.

---

## Correo (gratis, desde tu Gmail)
En la web: **Ajustes → Correo** y sigue los 5 pasos (pegar un pequeño script en https://script.new).
Llegan por correo los recordatorios, los controles (24 h y 2 h antes), la alerta de horas sin comer
y un **resumen del día** a la hora que elijas. Gmail personal permite ~100 destinatarios al día.

Los controles traen un botón **📅 Agregar a Google Calendar** (en Telegram y en la web).

## Seguridad
- Usa un **PIN de 6 dígitos o más**. Tras 5 intentos fallidos (web o bot) se bloquea 15 min.
- Usa el **mismo nombre** en la web y en Telegram, así no te llegan avisos de tus propios registros.

## Respaldos
- Web: Ajustes → **Descargar respaldo (JSON)**.
- Base completa: `npm run backup` (crea `respaldo-aurora.sql`).
- Ver las tablas: panel de Cloudflare → Storage & Databases → D1 → `aurora-db`.

## Ajustes en `wrangler.toml`
| Variable | Default | |
|---|---|---|
| `APP_TZ` | `America/Bogota` | Zona horaria de la familia |
| `BABY_NAME` | `Aurora` | |
| `FEED_ALERT_HOURS` | `3` | `0` para desactivar |

Tras cambiarlas: `npm run deploy`.

## Desarrollo
```bash
npm test          # 20 pruebas: levanta el Worker real con D1 local y un Telegram falso
npm run typecheck
```
