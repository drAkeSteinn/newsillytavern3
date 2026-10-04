/**
 * Memory V2 — Merged extraction prompt (VoiceMem merged_extraction, RP-adapted).
 *
 * ONE LLM pass per exchange classifies everything at once:
 *   evento (what happened) / hecho (stable facts) / preferencia (likes & limits)
 *   / relacion (emotional dynamic) — with explicit ADD/UPDATE/DELETE/NONE ops,
 *   absolute dates and links to existing memories.
 */

export const MEMORY_V2_EXTRACTION_SYSTEM = `Eres el módulo de memoria a largo plazo de un rol narrativo interactivo (ERP).
Analizas el intercambio reciente entre el usuario y el personaje, junto con la memoria ya existente, y decides quémemorias crear, actualizar o invalidar.
Responde ÚNICAMENTE con un objeto JSON válido. Sin markdown, sin explicaciones, sin texto fuera del JSON.`;

export const MEMORY_V2_EXTRACTION_PAYLOAD_TEMPLATE = `PERSONAJE: {charName}
USUARIO: {userName}
FECHA ACTUAL: {today}

INTERCAMBIO RECIENTE:
{transcript}

MEMORIA EXISTENTE (candidatas — id | tipo | texto):
{candidates}

TAREAS — clasifica la información NUEVA o ALTERADA del intercambio en estos tipos:
- "evento": algo que PASÓ en la historia (acciones, decisiones, encuentros, lugares, promesas, primeras veces, conflictos). Es la categoría más importante.
- "hecho": datos estables sobre el usuario o el mundo (nombre, trabajo, gustos generales, límites duros, posesiones, relaciones familiares).
- "preferencia": gustos, límites o deseos del usuario respecto al rol y al personaje.
- "relacion": cómo se siente {charName} hacia {userName} y cambios de dinámica (confianza, deseo, celos, tensión, cariño, distancia).

PARA CADA ÍTEM elige UNA operación:
- "ADD": información nueva que no está en la memoria.
- "UPDATE": corrige o amplía una candidata existente → targetId obligatorio. El texto nuevo REEMPLAZA al anterior.
- "DELETE": una candidata ya NO es cierta (fue desmentida en el intercambio) → targetId obligatorio.
- "NONE": no usar; si no hay nada relevante devuelve items: [].

REGLAS ESTRICTAS:
1. NO inventes nada. Solo registra lo dicho u ocurrido explícitamente en el intercambio.
2. Deduplica: si una candidata ya contiene la información, usa UPDATE (o nada). NUNCA crees un ADD que repita una candidata.
3. Escribe el texto en 3ª persona, autocontenido, con los nombres reales ({userName}, {charName}). PROHIBIDO "el usuario" o "el personaje".
4. date = fecha ABSOLUTA del evento en formato YYYY-MM-DD. Usa {today} salvo que el intercambio indique otra cosa ("ayer", "la semana pasada" → calcula la fecha real).
5. importance (0-1): 0.9-1.0 = promesas, traumas, límites, primeras veces, confessiones; 0.6-0.8 = eventos significativos; 0.3-0.5 = detalles menores. Detalles triviales (saludos, cotidianidad sin cambios) → omítelos.
6. links = ids de candidatas relacionadas causalmente (ej: una promesa vinculada al evento que la originó). [] si no hay.
7. Máximo {maxItems} ítems. Prioriza calidad sobre cantidad.

FORMATO DE SALIDA (exacto):
{"items":[{"type":"evento","op":"ADD","text":"...","date":"YYYY-MM-DD","importance":0.7,"targetId":"","links":[]}]}`;

export function fillV2ExtractionTemplate(vars: {
  charName: string;
  userName: string;
  today: string;
  transcript: string;
  candidates: string;
  maxItems: number;
}): string {
  return MEMORY_V2_EXTRACTION_PAYLOAD_TEMPLATE
    .replace(/\{charName\}/g, vars.charName)
    .replace(/\{userName\}/g, vars.userName)
    .replace(/\{today\}/g, vars.today)
    .replace(/\{transcript\}/g, vars.transcript)
    .replace(/\{candidates\}/g, vars.candidates)
    .replace(/\{maxItems\}/g, String(vars.maxItems));
}
