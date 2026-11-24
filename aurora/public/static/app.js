"use strict";

// ------------------------------------------------------------ storage seguro
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let state = { status: null, days: 3, filter: "" };

// ------------------------------------------------------------ tema
function applyTheme() {
  const t = store.get("theme") || "";
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
  $$("#theme-chips .chip").forEach((c) => c.classList.toggle("on", c.dataset.theme === t));
}
applyTheme();

// ------------------------------------------------------------ API
async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", Authorization: "Bearer " + (store.get("token") || ""),
    "X-Author": encodeURIComponent(store.get("me") || "") };
  const res = await fetch(path, { ...opts, headers: { ...headers, ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined });
  if (res.status === 401 && path !== "/api/login") { logout(); throw new Error("Sesión expirada"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Error " + res.status);
  return data;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), msg.length > 40 ? 6000 : 2600);
}

// ------------------------------------------------------------ tiempo
const pad = (n) => String(n).padStart(2, "0");
function dur(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "< 1 min";
  const h = Math.floor(m / 60);
  if (h >= 24) return h % 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${h / 24} d`;
  return h ? `${h} h ${pad(m % 60)} min` : `${m} min`;
}
function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}
function every(min) {
  if (min === 1440) return "todos los días";
  if (min === 10080) return "cada semana";
  return "cada " + dur(min * 60000);
}
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
function when(iso) {
  const d = new Date(iso), now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86400000);
  if (diff === 0) return hhmm(d);
  if (diff === -1) return "ayer " + hhmm(d);
  if (diff === 1) return "mañana " + hhmm(d);
  return d.toLocaleDateString("es", { weekday: "short", day: "numeric", month: "short" }) + " " + hhmm(d);
}
function toInput(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromInput = (v) => (v ? new Date(v).toISOString() : null);
function dayLabel(d) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const diff = Math.round((x - today) / 86400000);
  if (diff === 0) return "Hoy";
  if (diff === -1) return "Ayer";
  return x.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });
}

// ------------------------------------------------------------ sesión
function showLogin() { $("#login").classList.remove("hidden"); $("#app").classList.add("hidden"); }
function showApp() { $("#login").classList.add("hidden"); $("#app").classList.remove("hidden"); }
function logout() { store.set("token", null); showLogin(); }

$("#me").value = store.get("me") || "";
$$("#me-chips .chip").forEach((c) => c.addEventListener("click", () => { $("#me").value = c.dataset.me; }));
$("#login-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  $("#login-error").textContent = "";
  try {
    const r = await api("/api/login", { method: "POST", body: { pin: $("#pin").value } });
    store.set("token", r.token);
    store.set("me", $("#me").value.trim());
    $("#pin").value = "";
    start();
  } catch (e) { $("#login-error").textContent = e.message; }
});

// ------------------------------------------------------------ navegación
function setTab(name) {
  $$(".tab").forEach((t) => t.classList.toggle("hidden", t.id !== "tab-" + name));
  $$(".nav").forEach((n) => n.classList.toggle("on", n.dataset.tab === name));
  store.set("tab", name);
  if (name === "history") loadHistory();
  if (name === "agenda") loadAgenda();
  if (name === "settings") renderSettings();
  window.scrollTo(0, 0);
}
$$(".nav").forEach((n) => n.addEventListener("click", () => setTab(n.dataset.tab)));

// ------------------------------------------------------------ inicio
async function loadStatus() {
  state.status = await api("/api/status");
  renderStatus();
}

const SUBS = {
  feed: (e) => e.text.replace(/^\S+\s/, ""),
  diaper: (e) => e.text.replace(/^\S+ Pañal · /, ""),
  poop: () => "",
  bath: () => "",
};

function renderStatus() {
  const s = state.status;
  if (!s) return;
  $$(".baby-name").forEach((el) => (el.textContent = s.baby_name));
  document.title = s.baby_name;
  $("#age").textContent = s.age || "Configura la fecha de nacimiento en Ajustes";

  for (const k of ["feed", "diaper", "poop", "bath"]) {
    const e = s.last[k];
    $(`[data-ago="${k}"]`).dataset.iso = e ? e.start : "";
    $(`[data-sub="${k}"]`).textContent = e ? [SUBS[k](e), when(e.start)].filter(Boolean).join(" · ") : "Sin registros";
  }

  const t = s.today;
  $("#today").innerHTML = [
    [t.feeds, "tomas" + (t.feed_ml ? ` · ${t.feed_ml} ml` : "")],
    [t.diapers, `pañales`],
    [`${t.pee}/${t.poop}`, "pipí / popó"],
    [dur(t.sleep_seconds * 1000).replace(" min", "m").replace(" h ", "h "), "de sueño"],
  ].map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("");

  let html = "";
  if (s.appointments.length) {
    html += "<h2>Próximos controles</h2><div class='list'>" + s.appointments.map((a) =>
      `<div class="item"><div class="body"><div>📅 ${esc(a.title)}</div><div class="sub">${esc(when(a.at))}${a.place ? " · " + esc(a.place) : ""}</div></div></div>`).join("") + "</div>";
  }
  if (s.reminders.length) {
    html += "<h2>Recordatorios</h2><div class='list'>" + s.reminders.map((r) =>
      `<div class="item"><div class="body"><div>⏰ ${esc(r.text)}</div><div class="sub">${esc(when(r.due_at))}${r.repeat_minutes ? " · " + every(r.repeat_minutes) : ""}</div></div></div>`).join("") + "</div>";
  }
  $("#home-agenda").innerHTML = html;
  tickClock();
}

function tickClock() {
  const s = state.status;
  if (!s) return;
  const now = Date.now();
  for (const el of $$("[data-ago]")) {
    if (!el.classList.contains("card-v")) continue;
    el.textContent = el.dataset.iso ? "hace " + dur(now - new Date(el.dataset.iso)) : "—";
  }
  const fe = s.last.feed;
  $('.card[data-kind="feed"]').classList.toggle("warn", !!fe && s.feed_alert_hours > 0 && now - new Date(fe.start) > s.feed_alert_hours * 3600000);

  const card = $("#sleep-card"), btn = $("#sleep-btn");
  if (s.sleeping) {
    card.classList.add("sleeping");
    $("#sleep-label").textContent = "Durmiendo desde las " + hhmm(new Date(s.sleeping.start));
    $("#sleep-timer").textContent = clock(now - new Date(s.sleeping.start));
    $("#sleep-sub").textContent = "";
    btn.textContent = "😊 Se despertó";
  } else {
    card.classList.remove("sleeping");
    const last = s.last.sleep;
    if (last && last.end) {
      $("#sleep-label").textContent = "Despierta desde las " + hhmm(new Date(last.end));
      $("#sleep-timer").textContent = clock(now - new Date(last.end));
      $("#sleep-sub").textContent = "Último sueño: " + dur(new Date(last.end) - new Date(last.start));
    } else {
      $("#sleep-label").textContent = "Despierta";
      $("#sleep-timer").textContent = "—";
      $("#sleep-sub").textContent = "Aún no hay sueños registrados";
    }
    btn.textContent = "😴 Se durmió";
  }
}
setInterval(tickClock, 1000);

$("#sleep-btn").addEventListener("click", async () => {
  const btn = $("#sleep-btn");
  btn.disabled = true;
  try {
    const r = await api("/api/sleep/toggle", { method: "POST" });
    toast(r.sleeping ? "😴 Dulces sueños" : "😊 ¡Despertó! " + r.entry.text.replace("😴 Sueño · ", "durmió "));
    await loadStatus();
  } catch (e) { toast(e.message); } finally { btn.disabled = false; }
});
$("#refresh").addEventListener("click", () => refresh().then(() => toast("Actualizado")));

// ------------------------------------------------------------ hoja de registro
const TITLES = { feed: "🍼 Comida", sleep: "😴 Sueño", diaper: "🧷 Pañal", bath: "🛁 Baño", medicine: "💊 Medicina",
  temp: "🌡️ Temperatura", weight: "⚖️ Peso", note: "📝 Diario", tummy: "🧸 Tummy time", activity: "✨ Otra actividad" };
let sheet = null; // {kind, id?, detail, amount}

function opts(name, list, current) {
  return `<div class="big-opts">${list.map(([v, l]) =>
    `<button type="button" class="chip ${v === current ? "on" : ""}" data-opt="${name}" data-v="${v}">${l}</button>`).join("")}</div>`;
}

function renderSheetBody() {
  const { kind, detail, amount } = sheet;
  let h = "";
  if (kind === "feed") {
    h += opts("detail", [["pecho_izq", "🤱 Izq."], ["pecho_der", "🤱 Der."], ["biberon", "🍼 Tetero"]], detail === "formula" ? "biberon" : detail);
    const isBreast = (detail || "").startsWith("pecho");
    h += `<label>${isBreast ? "Minutos (opcional)" : "Cantidad en ml"}
      <input id="amount" type="number" inputmode="decimal" step="any" min="0" value="${amount ?? ""}"></label>`;
    if (!isBreast) {
      h += `<div class="ml-opts">${[2, 3, 5, 7, 10, 15, 20, 30, 45, 60].map((v) => `<button type="button" class="chip" data-ml="${v}">${v} ml</button>`).join("")}</div>`;
      h += opts("detail2", [["biberon", "Leche materna"], ["formula", "Fórmula"]], detail === "formula" ? "formula" : "biberon");
    }
  } else if (kind === "diaper") {
    h += opts("detail", [["pipi", "💧 Pipí"], ["popo", "💩 Popó"], ["ambos", "💧💩 Ambos"]], detail);
  } else if (kind === "medicine") {
    h += `<label>Medicina y dosis<input id="detail" maxlength="80" value="${esc(detail || "")}" placeholder="Ej: Vitamina D 2 gotas"></label>`;
  } else if (kind === "temp") {
    h += `<label>Temperatura (°C)<input id="amount" type="number" inputmode="decimal" step="0.1" min="30" max="45" value="${amount ?? ""}" required></label>`;
  } else if (kind === "activity") {
    h += `<label>¿Qué le hicieron?<input id="detail" maxlength="80" value="${esc(detail || "")}" placeholder="Ej: masajes, baño de sol, cortar uñas" required></label>`;
    h += `<label>Minutos (opcional)<input id="amount" type="number" inputmode="decimal" step="any" min="0" max="600" value="${amount ?? ""}"></label>`;
  } else if (kind === "tummy") {
    h += `<label>Minutos (opcional)<input id="amount" type="number" inputmode="decimal" step="any" min="0" max="180" value="${amount ?? ""}"></label>`;
    h += `<div class="ml-opts">${[2, 3, 5, 10, 15].map((v) => `<button type="button" class="chip" data-ml="${v}">${v} min</button>`).join("")}</div>`;
  } else if (kind === "weight") {
    h += `<label>Peso (kg)<input id="amount" type="number" inputmode="decimal" step="0.01" min="0.5" max="40" value="${amount ?? ""}" required></label>`;
  }
  $("#sheet-body").innerHTML = h;
  $$("[data-opt]", $("#sheet-body")).forEach((b) => b.addEventListener("click", () => {
    sheet.amount = $("#amount") ? $("#amount").value : sheet.amount;
    sheet.detail = b.dataset.v;
    renderSheetBody();
  }));
  $$("[data-ml]").forEach((b) => b.addEventListener("click", () => { $("#amount").value = b.dataset.ml; }));
  $("#end-wrap").classList.toggle("hidden", kind !== "sleep");
  $("#note-input").placeholder = kind === "note" ? "¿Qué pasó hoy? (diario de la bebé)" : "Nota (opcional)";
  $("#note-input").required = kind === "note";
}

function openSheet(kind, entry = null, detail = null) {
  sheet = { kind, id: entry?.id, detail: entry?.detail ?? detail, amount: entry?.amount };
  if (kind === "diaper" && !sheet.detail) sheet.detail = "pipi";
  $("#sheet-title").textContent = (entry ? "Editar · " : "") + TITLES[kind];
  const start = entry ? new Date(entry.start) : new Date();
  $("#when-input").value = toInput(start);
  $("#end-input").value = entry?.end ? toInput(new Date(entry.end)) : (kind === "sleep" ? toInput(new Date()) : "");
  $$("#when-chips .chip").forEach((c) => c.classList.toggle("on", !entry && c.dataset.ago === "0"));
  $("#when-chips").classList.toggle("hidden", kind === "sleep");
  $("#note-input").value = entry?.note || "";
  $("#sheet-delete").classList.toggle("hidden", !entry);
  $("#sheet-save").disabled = false;
  renderSheetBody();
  $("#sheet").classList.remove("hidden");
  $("#sheet-bg").classList.remove("hidden");
}
function closeSheet() { $("#sheet").classList.add("hidden"); $("#sheet-bg").classList.add("hidden"); sheet = null; }
$("#sheet-close").addEventListener("click", closeSheet);
$("#sheet-bg").addEventListener("click", closeSheet);

$$("#when-chips .chip").forEach((c) => c.addEventListener("click", () => {
  $$("#when-chips .chip").forEach((x) => x.classList.toggle("on", x === c));
  $("#when-input").value = toInput(new Date(Date.now() - Number(c.dataset.ago) * 60000));
}));
$("#when-input").addEventListener("input", () => $$("#when-chips .chip").forEach((x) => x.classList.remove("on")));

$$("[data-new]").forEach((b) => b.addEventListener("click", () => openSheet(b.dataset.new, null, b.dataset.detail || null)));
$("#past-sleep").addEventListener("click", () => {
  openSheet("sleep");
  $("#when-input").value = toInput(new Date(Date.now() - 60 * 60000));
});

$("#sheet").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (!sheet) return;
  const { kind } = sheet;
  let detail = sheet.detail;
  if (kind === "feed" && !(detail || "").startsWith("pecho")) {
    detail = $('[data-opt="detail2"].on')?.dataset.v || "biberon";
  }
  if (kind === "medicine" || kind === "activity") detail = $("#detail").value.trim();
  const amountEl = $("#amount");
  const amount = amountEl && amountEl.value !== "" ? Number(amountEl.value) : null;
  const body = { kind, detail, amount, note: $("#note-input").value.trim() || null,
    start: fromInput($("#when-input").value),
    end: kind === "sleep" ? fromInput($("#end-input").value) : null };
  $("#sheet-save").disabled = true;
  try {
    if (sheet.id) await api(`/api/entries/${sheet.id}`, { method: "PATCH", body });
    else await api("/api/entries", { method: "POST", body });
    if (kind === "temp" && amount >= 38) {
      toast("⚠️ 38 °C o más en un recién nacido: llamen al pediatra o vayan a urgencias");
    } else toast("✅ Guardado");
    closeSheet();
    await refresh();
  } catch (e) {
    toast(e.message);
    $("#sheet-save").disabled = false;
  }
});

$("#sheet-delete").addEventListener("click", async (ev) => {
  const b = ev.currentTarget;
  if (!b.dataset.confirm) { b.dataset.confirm = "1"; b.textContent = "¿Seguro?"; return; }
  delete b.dataset.confirm; b.textContent = "Borrar";
  try { await api(`/api/entries/${sheet.id}`, { method: "DELETE" }); toast("🗑️ Borrado"); closeSheet(); await refresh(); }
  catch (e) { toast(e.message); }
});

// ------------------------------------------------------------ historial
let historyCache = [];
async function loadHistory() {
  const q = new URLSearchParams({ days: state.days });
  if (state.filter) q.set("kind", state.filter);
  historyCache = await api("/api/entries?" + q);
  const byDay = new Map();
  for (const e of historyCache) {
    const d = new Date(e.start); d.setHours(0, 0, 0, 0);
    const k = d.getTime();
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(e);
  }
  if (!historyCache.length) { $("#history").innerHTML = `<div class="empty">Sin registros en estos días</div>`; return; }
  let html = "";
  for (const [k, list] of byDay) {
    const feeds = list.filter((e) => e.kind === "feed").length, diapers = list.filter((e) => e.kind === "diaper").length;
    html += `<div class="day-head">${esc(dayLabel(k))}<span>${feeds} tomas · ${diapers} pañales</span></div><div class="list">`;
    html += list.map((e) => `<div class="item" data-entry="${e.id}">
        <div class="t">${hhmm(new Date(e.start))}</div>
        <div class="body"><div>${esc(e.text)}</div>${e.author ? `<div class="sub">${esc(e.author)}</div>` : ""}</div>
        <span class="muted">›</span></div>`).join("");
    html += "</div>";
  }
  $("#history").innerHTML = html;
  $$("[data-entry]").forEach((el) => el.addEventListener("click", () => {
    const e = historyCache.find((x) => x.id === Number(el.dataset.entry));
    if (e) openSheet(e.kind, e);
  }));
}
$$("#filters .chip").forEach((c) => c.addEventListener("click", () => {
  $$("#filters .chip").forEach((x) => x.classList.toggle("on", x === c));
  state.filter = c.dataset.filter;
  loadHistory().catch((e) => toast(e.message));
}));
$("#more").addEventListener("click", () => { state.days += 7; loadHistory().catch((e) => toast(e.message)); });

// ------------------------------------------------------------ agenda
function confirmBtn(b, fn) {
  if (!b.dataset.confirm) {
    b.dataset.confirm = "1"; const old = b.textContent; b.textContent = "¿Seguro?";
    setTimeout(() => { delete b.dataset.confirm; b.textContent = old; }, 3000);
    return;
  }
  fn();
}

async function loadAgenda() {
  const [appts, rems] = await Promise.all([api("/api/appointments"), api("/api/reminders")]);
  $("#appts").innerHTML = appts.length ? `<div class="list">${appts.map((a) => `
    <div class="item ${a.done ? "done" : ""}">
      <div class="body"><div>${esc(a.title)}</div><div class="sub">${esc(when(a.at))}${a.place ? " · " + esc(a.place) : ""}</div></div>
      ${a.in_calendar ? `<span class="mini muted" title="Ya está en Google Calendar">📅✅</span>`
        : `<a class="btn mini" href="${esc(a.calendar_url)}" target="_blank" rel="noopener" title="Agregar a Google Calendar">📅</a>`}
      <button class="btn mini" data-done="${a.id}">${a.done ? "↩️" : "✓"}</button>
      <button class="btn mini danger" data-del-appt="${a.id}">🗑</button>
    </div>`).join("")}</div>` : `<div class="empty">Sin controles agendados</div>`;
  $("#rems").innerHTML = rems.length ? `<div class="list">${rems.map((r) => `
    <div class="item">
      <div class="body"><div>${esc(r.text)}</div><div class="sub">${esc(when(r.due_at))}${r.repeat_minutes ? " · " + every(r.repeat_minutes) : ""}${r.ends_at ? " · hasta " + esc(when(r.ends_at)) : ""}</div></div>
      <button class="btn mini danger" data-del-rem="${r.id}">🗑</button>
    </div>`).join("")}</div>` : `<div class="empty">Sin recordatorios activos</div>`;

  await loadNotes();
  $$("[data-done]").forEach((b) => b.addEventListener("click", async () => {
    await api(`/api/appointments/${b.dataset.done}/done`, { method: "POST" }); loadAgenda();
  }));
  $$("[data-del-appt]").forEach((b) => b.addEventListener("click", () => confirmBtn(b, async () => {
    await api(`/api/appointments/${b.dataset.delAppt}`, { method: "DELETE" }); loadAgenda(); loadStatus();
  })));
  $$("[data-del-rem]").forEach((b) => b.addEventListener("click", () => confirmBtn(b, async () => {
    await api(`/api/reminders/${b.dataset.delRem}`, { method: "DELETE" }); loadAgenda(); loadStatus();
  })));
}

// ------------------------------------------------------------ notas
let showDoneNotes = false;
async function loadNotes() {
  const notes = await api("/api/notes" + (showDoneNotes ? "?all=1" : ""));
  $("#notes").innerHTML = notes.length ? `<div class="list">${notes.map((n) => `
    <div class="item ${n.done ? "done" : ""}">
      <label class="check grow-1"><input type="checkbox" data-note-done="${n.id}" ${n.done ? "checked" : ""}>
        <div class="body"><div>${esc(n.text)}</div>${n.author ? `<div class="sub">${esc(n.author)} · ${esc(when(n.created_at))}</div>` : ""}</div></label>
      <button class="btn mini danger" data-del-note="${n.id}">🗑</button>
    </div>`).join("")}</div>` : `<div class="empty">Sin notas pendientes</div>`;
  $$("[data-note-done]").forEach((c) => c.addEventListener("change", async () => {
    await api(`/api/notes/${c.dataset.noteDone}/done`, { method: "POST" }); loadNotes();
  }));
  $$("[data-del-note]").forEach((b) => b.addEventListener("click", () => confirmBtn(b, async () => {
    await api(`/api/notes/${b.dataset.delNote}`, { method: "DELETE" }); loadNotes();
  })));
}
$("#note-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  try { await api("/api/notes", { method: "POST", body: { text: ev.target.text.value } }); ev.target.reset(); toast("📝 Anotado"); loadNotes(); }
  catch (e) { toast(e.message); }
});
$("#notes-done-toggle").addEventListener("click", (ev) => {
  showDoneNotes = !showDoneNotes;
  ev.currentTarget.textContent = showDoneNotes ? "Ocultar las hechas" : "Ver también las hechas";
  loadNotes().catch((e) => toast(e.message));
});

function defaultDue(form, name, minutes) {
  if (!form[name].value) form[name].value = toInput(new Date(Date.now() + minutes * 60000));
}
$("#appt-form").addEventListener("focusin", (e) => { if (e.target.name === "at") defaultDue($("#appt-form"), "at", 24 * 60); });
$("#rem-form").addEventListener("focusin", (e) => { if (e.target.name === "due_at") defaultDue($("#rem-form"), "due_at", 60); });

$("#appt-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  try {
    await api("/api/appointments", { method: "POST", body: { title: f.title.value, at: fromInput(f.at.value), place: f.place.value || null } });
    f.reset(); toast("📅 Agendado"); loadAgenda(); loadStatus();
  } catch (e) { toast(e.message); }
});
$("#rem-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  try {
    await api("/api/reminders", { method: "POST", body: { text: f.text.value, due_at: fromInput(f.due_at.value),
      repeat_minutes: f.repeat.value ? Number(f.repeat.value) : null } });
    f.reset(); toast("⏰ Recordatorio creado"); loadAgenda(); loadStatus();
  } catch (e) { toast(e.message); }
});

// ------------------------------------------------------------ ajustes
function renderSettings() {
  const s = state.status;
  $("#set-me").value = store.get("me") || "";
  $("#set-birth").value = s?.birth_date || "";
  const tg = s?.telegram;
  $("#tg-info").innerHTML = !tg?.enabled
    ? `<p class="muted">El bot no está configurado (falta <code>TELEGRAM_TOKEN</code> en el servidor).</p>`
    : `${tg.connected ? `<p>✅ Bot conectado.</p>` : `<p>⚠️ El bot aún no está conectado.</p>`}
       <button class="btn ${tg.connected ? "ghost" : "primary"} block" id="tg-connect">${tg.connected ? "Reconectar bot" : "🔗 Conectar bot de Telegram"}</button>
       <p>Luego abre el bot en Telegram y escribe:</p><p><code>/start PIN TuNombre</code></p>
       <p class="muted small">Vinculados: ${tg.caregivers.length ? tg.caregivers.map(esc).join(", ") : "nadie todavía"}</p>
       <label>🌙 Resumen del día por Telegram
         <select id="tg-summary">${[[-1, "Apagado"], [20, "8:00 p. m."], [21, "9:00 p. m."], [22, "10:00 p. m."], [23, "11:00 p. m."]]
           .map(([v, l]) => `<option value="${v}" ${tg.summary_hour === v ? "selected" : ""}>${l}</option>`).join("")}</select>
       </label>`;
  const sumSel = $("#tg-summary");
  if (sumSel) sumSel.addEventListener("change", async () => {
    try { await api("/api/settings", { method: "PUT", body: { tg_summary_hour: Number(sumSel.value) } }); toast("🌙 Guardado"); await loadStatus(); }
    catch (e) { toast(e.message); }
  });
  loadEmail().catch((e) => toast(e.message));
  const btn = $("#tg-connect");
  if (btn) btn.addEventListener("click", async () => {
    btn.disabled = true;
    try { await api("/api/telegram/setup", { method: "POST" }); toast("✅ Bot conectado"); await loadStatus(); renderSettings(); }
    catch (e) { toast(e.message); btn.disabled = false; }
  });
  applyTheme();
}
// ------------------------------------------------------------ correo
let emailScript = "";
const hourSel = $("#eo-hour");
for (let h = 0; h < 24; h++) {
  const o = document.createElement("option");
  o.value = h; o.textContent = `${h === 0 ? 12 : h > 12 ? h - 12 : h}:00 ${h < 12 ? "a. m." : "p. m."}`;
  hourSel.appendChild(o);
}
async function loadEmail() {
  const e = await api("/api/email");
  emailScript = e.script;
  $("#script-code").value = e.script;
  $("#email-url").value = e.url || "";
  $("#email-to").value = (e.to || []).join("\n");
  for (const k of ["reminders", "appointments", "feed", "summary"]) $("#eo-" + k).checked = !!e.opts[k];
  hourSel.value = String(e.opts.summary_hour);
  $("#eo-calendar").checked = !!e.calendar_auto;
  const upd = $("#script-update");
  const outdated = e.configured && e.script_version < e.latest_version;
  upd.classList.toggle("hidden", !outdated);
  if (outdated) {
    upd.innerHTML = `⚠️ <b>Actualiza tu script</b> para que los controles se agreguen solos a Google Calendar: `
      + `toca <b>📋 Copiar código</b>, reemplaza todo el código en Google, guarda, ejecuta <b>probar</b> (acepta el permiso de Calendar) y en `
      + `<b>Implementar → Gestionar implementaciones → ✏️ → Versión: Nueva versión → Implementar</b>. Luego toca <b>Guardar</b> aquí.`;
  }
  $("#email-status").textContent = e.configured ? "✅ Correo conectado." : "Conecta tu Gmail para recibir los avisos también por correo (gratis).";
  $("#email-steps").open = !e.configured;
}
function emailBody() {
  return {
    url: $("#email-url").value.trim() || null,
    to: $("#email-to").value.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean),
    opts: { reminders: $("#eo-reminders").checked, appointments: $("#eo-appointments").checked, feed: $("#eo-feed").checked,
      summary: $("#eo-summary").checked, summary_hour: Number(hourSel.value) },
    calendar_auto: $("#eo-calendar").checked,
  };
}
$("#copy-script").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(emailScript); toast("📋 Código copiado"); }
  catch { const t = $("#script-code"); t.classList.remove("hidden"); t.focus(); t.select(); toast("Selecciona y copia el código"); }
});
$("#email-save").addEventListener("click", async () => {
  try { await api("/api/email", { method: "PUT", body: emailBody() }); toast("Guardado"); await loadEmail(); }
  catch (e) { toast(e.message); }
});
$("#email-test").addEventListener("click", async (ev) => {
  const b = ev.currentTarget; b.disabled = true;
  try {
    await api("/api/email", { method: "PUT", body: emailBody() });
    await api("/api/email/test", { method: "POST" });
    toast("✉️ Correo enviado. Revisa tu bandeja (y spam la primera vez).");
    await loadEmail();
  } catch (e) { toast(e.message); } finally { b.disabled = false; }
});

$("#save-settings").addEventListener("click", async () => {
  store.set("me", $("#set-me").value.trim());
  try {
    await api("/api/settings", { method: "PUT", body: { birth_date: $("#set-birth").value || null } });
    toast("Guardado"); loadStatus();
  } catch (e) { toast(e.message); }
});
$$("#theme-chips .chip").forEach((c) => c.addEventListener("click", () => { store.set("theme", c.dataset.theme || null); applyTheme(); }));
$("#logout").addEventListener("click", logout);
$("#export").addEventListener("click", async () => {
  try {
    const data = await api("/api/export");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = `aurora-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (e) { toast(e.message); }
});

// ------------------------------------------------------------ arranque
async function refresh() {
  await loadStatus();
  const tab = store.get("tab");
  if (tab === "history") await loadHistory();
  if (tab === "agenda") await loadAgenda();
}

async function start() {
  if (!store.get("token")) return showLogin();
  showApp();
  setTab(store.get("tab") || "home");
  try { await loadStatus(); } catch (e) { toast(e.message); }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && store.get("token")) refresh().catch(() => {});
});
setInterval(() => { if (document.visibilityState === "visible" && store.get("token")) loadStatus().catch(() => {}); }, 30000);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
start();
