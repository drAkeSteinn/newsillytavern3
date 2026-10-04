/**
 * Memory V2 — Retrieval: query expansion + vector search + reranking.
 *
 * time_expand (VoiceMem): 0-LLM regex expansion of relative Spanish dates
 * ("ayer", "la semana pasada", "hace 3 días") into absolute dates appended
 * to the query before embedding — free temporal grounding.
 *
 * Reranking (FASE 14 rescue bonuses, V2-adapted): cosine + lexical overlap
 * + recency + heat + importance + curated bonus + type-aware intent boosts
 * + temporal rescue when the query carries date terms.
 */

import { getV2, tokenizeStem } from './store';
import type { MemoryV2Type, ScoredMemory } from './types';

// ============ time_expand ============

interface DateHit { dates: string[]; label: string }

function shiftDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Expand relative date expressions into absolute dates (0-LLM).
 * Returns the query with " (fechas: ...)" appended + the detected dates.
 */
export function timeExpandQuery(query: string, now: Date = new Date()): { expanded: string; dates: string[] } {
  if (!query) return { expanded: query, dates: [] };
  const q = query.toLowerCase();
  const dates = new Set<string>();

  const addDay = (offset: number) => dates.add(fmt(shiftDays(now, offset)));
  const addRange = (fromOffset: number, toOffset: number) => {
    for (let o = fromOffset; o <= toOffset; o++) dates.add(fmt(shiftDays(now, o)));
  };

  if (/\bhoy\b|\beste día\b/.test(q)) addDay(0);
  if (/\banoche\b/.test(q)) addDay(-1);
  if (/\bayer\b/.test(q)) addDay(-1);
  if (/\banteayer\b/.test(q)) addDay(-2);
  if (/\bel otro d[ií]a\b/.test(q)) addRange(-7, -2);
  if (/\b-la semana pasada\b|\bla semana pasada\b/.test(q)) addRange(-13, -7);
  if (/\bel mes pasado\b/.test(q)) addRange(-60, -30);
  if (/\bel a[nñ]o pasado\b/.test(q)) addRange(-365, -180);

  const haceMatch = q.match(/\bhace\s+(\d+)\s+(d[ií]a|d[ií]as|semana|semanas|mes|meses|a[nñ]o|a[nñ]os)\b/);
  if (haceMatch) {
    const n = parseInt(haceMatch[1], 10) || 1;
    const unit = haceMatch[2];
    if (unit.startsWith('d')) addDay(-n);
    else if (unit.startsWith('semana')) addRange(-(n * 7 + 3), -(n * 7 - 3));
    else if (unit.startsWith('mes')) addRange(-(n * 30 + 15), -(n * 30 - 15));
    else addRange(-(n * 365 + 60), -(n * 365 - 60));
  }

  if (dates.size === 0) return { expanded: query, dates: [] };
  const list = Array.from(dates).sort().slice(0, 6);
  return { expanded: `${query} (fechas relacionadas: ${list.join(', ')})`, dates: list };
}

// ============ Intent detection (type boosts) ============

const INTENT_PATTERNS: { types: MemoryV2Type[]; re: RegExp }[] = [
  { types: ['evento', 'resumen_escena'], re: /qu[eé] pas[oó]|recuerdas|aquella vez|cuando (nos|hicimos|fuimos|pasó)|la vez que|aqu[eé]l d[ií]a|anoche|lo de anoche|lo que (hicimos|pasó)/i },
  { types: ['hecho', 'preferencia'], re: /qui[eé]n soy|mi nombre|c[oó]mo me llamo|d[oó]nde trabajo|qu[eé] s[aá]bes de m[ií]|cu[aá]ntos a[nñ]os|mi trabajo|mi familia|me gusta|no me gusta|mi l[ií]mite/i },
  { types: ['relacion'], re: /sientes|hacia m[ií]|nuestra relaci[oó]n|me quieres|me odias|celos|conf[ií]as|te agrado|te caigo/i },
];

function detectIntent(query: string): MemoryV2Type[] {
  for (const { types, re } of INTENT_PATTERNS) {
    if (re.test(query)) return types;
  }
  return [];
}

// ============ Reranking ============

export interface RerankOptions {
  query: string;
  expandedDates?: string[];
  now?: Date;
}

export function rerankMemories(
  hits: { record: import('./types').MemoryV2Record; cosine: number }[],
  options: RerankOptions,
): ScoredMemory[] {
  const { query, expandedDates = [], now = new Date() } = options;
  const qTokens = new Set(tokenizeStem(query));
  const intentTypes = detectIntent(query);
  const hasTemporal = expandedDates.length > 0 || /\b(hace|ayer|anoche|pasada|pasado|d[ií]a[s]?\s+atr[aá]s|semana pasada)\b/i.test(query);
  const temporalSet = new Set(expandedDates);

  const scored: ScoredMemory[] = hits.map(({ record, cosine }) => {
    // lexical overlap (stemmed — inflection-tolerant)
    const rTokens = tokenizeStem(record.content);
    let overlap = 0;
    for (const t of rTokens) if (qTokens.has(t)) overlap++;
    const lexical = qTokens.size ? overlap / qTokens.size : 0;

    // recency (event age, half-life ~30d)
    const t = Date.parse(record.eventDate || record.createdAt || '');
    const ageDays = isNaN(t) ? 999 : Math.max(0, (now.getTime() - t) / (24 * 3600 * 1000));
    const recency = Math.exp(-ageDays / 30);

    const heat = Math.min(1, record.heat / 5);
    const importance = record.importance;
    const curated = record.source === 'curada' ? 0.06 : 0;

    // type-aware intent boost
    const typeBoost = intentTypes.includes(record.type) ? 0.08 : 0;

    // temporal rescue: if the query carries dates, reward records inside the window
    let temporalRescue = 0;
    if (hasTemporal && !isNaN(t)) {
      const dayKey = new Date(t).toISOString().slice(0, 10);
      if (temporalSet.has(dayKey)) temporalRescue = 0.15;
    }

    const score =
      0.45 * Math.max(0, cosine) +
      0.20 * lexical +
      0.10 * recency +
      0.08 * heat +
      0.08 * importance +
      curated +
      typeBoost +
      temporalRescue;

    return { ...record, cosine, score };
  });

  // Curated records always survive: give them a floor before sorting.
  for (const s of scored) {
    if (s.source === 'curada') s.score = Math.max(s.score, 0.45);
  }

  return scored.sort((a, b) => b.score - a.score);
}

// ============ Public search ============

export interface V2SearchParams {
  query: string;
  charId: string;
  sessionId?: string;
  groupId?: string;
  crossSession?: boolean;
  limit?: number;
  poolFactor?: number;
  threshold?: number;
}

/**
 * Full V2 retrieval: time_expand → embed → vector search (wide pool) → rerank.
 */
export async function searchMemoriesV2(params: V2SearchParams): Promise<ScoredMemory[]> {
  const {
    query, charId, sessionId = '', groupId = '', crossSession = true,
    limit = 12, poolFactor = 3, threshold = 0.15,
  } = params;
  if (!query?.trim()) return [];

  const store = await getV2();
  const { expanded, dates } = timeExpandQuery(query);

  let vector: number[];
  try {
    vector = await store.embed(expanded);
  } catch (err) {
    console.warn('[MemoryV2] Query embedding failed → lexical search:', err);
    const lexical = await store.searchLexical({
      query: expanded, charId, groupId: groupId || undefined,
      sessionId, crossSession, activeOnly: true, limit: limit * poolFactor,
    });
    return rerankMemories(lexical, { query, expandedDates: dates }).slice(0, limit);
  }

  const hits = await store.searchVector({
    vector,
    charId,
    groupId: groupId || undefined,
    sessionId,
    crossSession,
    activeOnly: true,
    limit: limit * poolFactor,
    threshold,
  });

  return rerankMemories(hits, { query, expandedDates: dates }).slice(0, limit);
}
