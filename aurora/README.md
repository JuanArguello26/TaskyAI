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
  🤖 Workers AI           → entiende texto y notas de voz (10.000 neuronas/día gratis)
  🗄️ D1 "aurora-db"       → registros, citas, recordatorios, notas, cuidadores, ajustes
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

## Uso en Telegram (bot "Tasky")

Cada persona abre el bot, escribe `/start` y pone el PIN familiar una sola vez. No hay usuarios
ni contraseñas aparte: papá y mamá usan el mismo PIN.

**Botones fijos abajo:** 🍼 Tetero · 🤱 Pecho · 😴 Sueño · 🧷 Pañal · 📊 ¿Cómo va? · ➕ Más
- **Tetero:** 2 a 60 ml (o escribe cualquier cantidad), materna o fórmula.
- **Pecho:** lado y minutos.
- **➕ Más:** Notas, Rutinas, Recordatorio, Control, Baño, Tummy, Medicina, Temp, Peso, Hoy, Agenda, Ayuda.
- Después de cada registro: **↩️ Deshacer** o **"Fue hace 10/30/60 min"** si se te olvidó anotarlo.

**Háblale normal, por texto o 🎙️ nota de voz** (Workers AI gratis):
«le di 20 ml de fórmula hace un rato», «pecho izquierdo 15 min y luego hizo popó»,
«se durmió a las 3», «tuvo hipo después de comer» (va al diario), «pesó 3200 gramos»,
«anota comprar pañales» (nota), «amoxicilina 2,5 ml cada 8 horas por 7 días» (tratamiento),
«recuérdame en 30 min la vitamina», «control con el pediatra el 2 de diciembre a las 9»,
«¿cuánto ha comido hoy?». Las frases simples (`popó`, `30 ml`, `se despertó`) funcionan aun sin IA.

**Comandos (opcionales):** `/menu` `/estado` `/resumen` `/hoy` `/agenda` `/notas` `/rutinas`
`/deshacer` `/avisos` `/ayuda`.

**📝 Notas:** una libreta para no olvidar cosas; se marcan como hechas o se borran (también en la web).

**🔁 Rutinas:** Vitamina D, tummy time, baño, cura del ombligo, un tratamiento con horario
(«cada 8 h por 7 días») o **cualquier texto que tú escribas**, con la frecuencia que quieras.
Cuando suena trae **✅ Hecho** (queda registrado) y **⏰ En 10 min**.

**Avisos automáticos por Telegram** (al minuto exacto):
- Recordatorios: **1 h y 10 min antes**, y a la hora.
- Controles médicos: **24 h, 12 h y 2 h antes**.
- Si pasan **3 h** sin comer (`FEED_ALERT_HOURS`), avisa a ambos.
- Cuando uno registra algo, le llega al otro (desactivable con `/avisos`).
- **🌙 Resumen del día SOLO por Telegram** a las 9 pm por defecto (cámbialo o apágalo en
  Ajustes → Telegram), o pídelo cuando quieras con `/resumen` o «resumen».

---

## Correo y Google Calendar (gratis, desde tu Gmail)
En la web: **Ajustes → Correo** y sigue los pasos (pegar un script en https://script.new e
implementarlo como *aplicación web*; la URL debe terminar en `/exec`).
Llegan por correo los recordatorios, los controles y la alerta de horas sin comer.

**Calendar automático:** con el script **versión 2** y la casilla *"Agregar controles a Google
Calendar"* activada, cada control nuevo se crea solo en tu Google Calendar (y se borra si lo
eliminas). Si la web muestra *"actualiza el script"*: copia el código nuevo, pégalo en el
proyecto, ejecuta `probar`, haz **Implementar → Gestionar implementaciones → Nueva versión** y
pulsa **Guardar** en Ajustes. Mientras tanto, cada control trae el botón **📅 Agregar a Google Calendar**.

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
npm test          # 47 pruebas: levanta el Worker real con D1 local, Telegram, IA y Gmail falsos
npm run typecheck
```
