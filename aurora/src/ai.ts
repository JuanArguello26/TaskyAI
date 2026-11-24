/**
 * Lenguaje natural con Workers AI (gratis: 10.000 neuronas/día).
 * - interpret(): convierte "le di 5 ml y luego hizo popó" en acciones.
 * - answer(): responde preguntas usando los registros.
 * - transcribe(): notas de voz -> texto.
 * Si la IA no está disponible (o se acabó el cupo del día), lanza error y el bot
 * sigue funcionando con botones y frases simples.
 */

import type { Env } from "./env";
import type { App } from "./logic";
import * as T from "./time";

const TEXT_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const VOICE_MODEL = "@cf/openai/whisper-large-v3-turbo";

export function aiEnabled(env: Env): boolean {
  return !!(env.AI || env.AI_TEST_URL);
}

async function run(env: Env, model: string, input: Record<string, unknown>): Promise<any> {
  if (env.AI_TEST_URL) {
    const r = await fetch(env.AI_TEST_URL, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, input }),
    });
    if (!r.ok) throw new Error("IA de prueba falló");
    return r.json();
  }
  if (!env.AI) throw new Error("IA no configurada");
  return env.AI.run(model as any, input as any);
}

function textOf(r: any): string {
  if (typeof r?.response === "string") return r.response;
  const c = r?.choices?.[0]?.message?.content;
  if (typeof c === "string") return c;
  if (r?.response && typeof r.response === "object") return JSON.stringify(r.response);
  return "";
}

function chat(env: Env, system: string, user: string, maxTokens: number) {
  return run(env, TEXT_MODEL, {
    messages: [{ role: "system", content: system }, { role: "user", content: user.slice(0, 600) }],
    max_tokens: maxTokens,
    temperature: 0,
    chat_template_kwargs: { enable_thinking: false },
  }).then(textOf);
}

// ------------------------------------------------------------------ interpretar

export type Action = {
  type: string;
  detail?: string; amount?: number | null; ago?: number | null; time?: string | null;
  start?: string; end?: string; name?: string; value?: number; kg?: number; text?: string;
  date?: string | null; in_minutes?: number | null; repeat_minutes?: number | null; title?: string; place?: string | null;
  dose?: string | null; every_hours?: number | null; days?: number | null; start_time?: string | null;
};

const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function interpretPrompt(app: App): string {
  const n = T.toNaive(app.now(), app.tz);
  const d = new Date(n);
  const date = d.toISOString().slice(0, 10);
  return `Conviertes mensajes de papás (español de Colombia) sobre su bebé recién nacida ${app.babyName} en acciones JSON. Ahora son las ${T.hhmm(n)} del ${date} (${DAYS[d.getUTCDay()]}).
Responde SOLO un objeto JSON: {"actions":[...]}. Tipos de acción:
feed {"type":"feed","detail":"biberon|formula|pecho_izq|pecho_der|pecho","amount":num|null,"ago":min|null,"time":"HH:MM"|null}
diaper {"type":"diaper","detail":"pipi|popo|ambos","ago","time"}
sleep_start {"type":"sleep_start","ago","time"} · sleep_end {"type":"sleep_end","ago","time"} · sleep_past {"type":"sleep_past","start":"HH:MM","end":"HH:MM"}
bath {"type":"bath","ago","time"} · medicine {"type":"medicine","name"} = ya se la dieron · temp {"type":"temp","value"} · weight {"type":"weight","kg"}
tummy {"type":"tummy","amount":minutos|null,"ago","time"} = tummy time / barriguita / boca abajo
activity {"type":"activity","name","amount":minutos|null,"ago","time"} = cualquier otra cosa que le hicieron a la bebé (masaje, baño de sol, sacar gases, cortar uñas, paseo, extracción de leche…)
note {"type":"note","text"} = algo para anotar y NO olvidar, una tarea (anota, apunta, comprar, preguntar al pediatra…)
diary {"type":"diary","text","ago","time"} = algo que le pasó o cómo estuvo la bebé (hipo, lloró mucho, cólicos, regurgitó, vomitó, estornudos, estuvo tranquila, sarpullido…)
medication {"type":"medication","name","dose":"2.5 ml"|null,"every_hours":num,"days":num|null,"start_time":"HH:MM"|null} = tratamiento con horario (cada X horas por N días)
reminder {"type":"reminder","date":"YYYY-MM-DD"|null,"time":"HH:MM"|null,"in_minutes":num|null,"repeat_minutes":num|null,"text"}
appointment {"type":"appointment","date":"YYYY-MM-DD","time":"HH:MM","title","place":null}
question {"type":"question"} = pregunta sobre la bebé o sus registros. undo {"type":"undo"} = borrar/deshacer lo último. chat {"type":"chat"} = saludo u otra cosa.
Reglas:
- Varias cosas = varias acciones en orden. No inventes cantidades: si no se dicen, null.
- "ago" = hace cuántos minutos OCURRIÓ. "time" = hora a la que ocurrió. Si no se dice cuándo, ambos null.
- pecho = solo si mamó directo del seno; su "amount" es la DURACIÓN en minutos (no es "ago").
- Leche materna o fórmula en tetero, biberón, jeringa, vaso o cuchara = "biberon"/"formula" con amount en ml. tetero = biberon.
- Pañal mojado = pipi; sucio/con caca = popo. Peso en gramos -> kg. 1 onza = 30 ml. cc = ml.
- Una rutina o algo que se repite ("todos los días", "cada 3 horas") = reminder con repeat_minutes.`;
}

function extractJson(s: string): any {
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("La IA no devolvió JSON");
  return JSON.parse(s.slice(a, b + 1));
}

export async function interpret(app: App, text: string): Promise<Action[]> {
  const out = await chat(app.env, interpretPrompt(app), text, 300);
  const data = extractJson(out);
  const actions = Array.isArray(data?.actions) ? data.actions : [];
  return actions.filter((x: any) => x && typeof x.type === "string").slice(0, 8);
}

// ------------------------------------------------------------------ responder preguntas

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

export async function answer(app: App, question: string): Promise<string> {
  const context = [await app.statusText(), await app.todayText(), await app.agendaText()].map(stripHtml).join("\n\n");
  const system = `Eres Tasky, el asistente cálido de una familia con una bebé recién nacida llamada ${app.babyName}.
Responde en español, breve (máximo 4 líneas), con datos concretos y horas. Usa SOLO estos datos; si no están, dilo.
Si preguntan algo de salud: orientación general corta y sugiere consultar al pediatra. Ante signos de alarma (fiebre de 38 °C o más, no quiere comer, muy decaída, le cuesta respirar, piel muy amarilla) recomienda ir a urgencias.
Ahora: ${T.hhmm(T.toNaive(app.now(), app.tz))}.

DATOS:
${context}`;
  const out = (await chat(app.env, system, question, 220)).trim();
  if (!out) throw new Error("Respuesta vacía");
  return out;
}

// ------------------------------------------------------------------ notas de voz

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function transcribe(env: Env, audio: ArrayBuffer): Promise<string> {
  const r = await run(env, VOICE_MODEL, { audio: toBase64(audio), language: "es" });
  return String(r?.text ?? "").trim();
}
