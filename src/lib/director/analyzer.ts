// ============================================
// Director Agent — Heuristic Analyzer (pure)
// ============================================
//
// Deterministic analysis of a session snapshot, inspired by the Left 4 Dead
// "AI Director" pattern: measure tension, detect pacing, and emit decisions
// that break monotony (calm too long → spark) or release pressure
// (intense too long → cool down). No LLM required, fully testable.

import type {
  DirectorDecision,
  DirectorPacing,
  DirectorResult,
  DirectorSnapshot,
} from './types';

/** Stat keys that read as "arousal/heat" for tension scoring */
const HEAT_STAT_PATTERNS = ['lujuria', 'deseo', 'calentur', 'hambre', 'adiccion', 'addicion', 'intoxicacion', 'modo_pantera', 'exigencia', 'twerking', 'estupidez'];

/** Stats that read as "depletion" (high = tension draining) */
const DEPLETION_STAT_PATTERNS = ['energia', 'resistencia'];

/** Attribute value clamp helper */
function num(v: unknown): number | null {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

/** 0-100 average of all numeric stats matching patterns (per character, then global) */
function scorePatterns(sessionStats: DirectorSnapshot['sessionStats'], patterns: string[]): number | null {
  if (!sessionStats?.characterStats) return null;
  const values: number[] = [];
  for (const charStats of Object.values(sessionStats.characterStats)) {
    for (const [key, raw] of Object.entries(charStats.attributeValues || {})) {
      const k = key.toLowerCase();
      if (patterns.some(p => k.includes(p))) {
        const v = num(raw);
        if (v !== null) values.push(Math.min(100, Math.max(0, v)));
      }
    }
  }
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Count recent events (last `windowMs`) in the event log */
function recentEvents(snapshot: DirectorSnapshot, windowMs: number): number {
  const log = snapshot.sessionStats?.eventLog || [];
  const cutoff = Date.now() - windowMs;
  return log.filter(e => (e.timestamp || 0) >= cutoff).length;
}

/** Messages per minute from recentMessages timestamps */
function messageRhythm(snapshot: DirectorSnapshot): { perMinute: number; lastActivityMs: number } {
  const msgs = (snapshot.recentMessages || []).filter(m => m.timestamp);
  if (msgs.length === 0) return { perMinute: 0, lastActivityMs: Number.MAX_SAFE_INTEGER };
  const times = msgs.map(m => new Date(m.timestamp as string).getTime()).filter(t => Number.isFinite(t));
  if (times.length === 0) return { perMinute: 0, lastActivityMs: Number.MAX_SAFE_INTEGER };
  const last = Math.max(...times);
  const spanMin = Math.max(1, (Date.now() - Math.min(...times)) / 60000);
  return { perMinute: times.length / spanMin, lastActivityMs: Date.now() - last };
}

/**
 * Compute tension 0-100.
 * Base 20 + heat stats (up to 45) + recent event density (up to 20)
 * - depletion (up to 15) + message rhythm (up to 15).
 */
export function computeTension(snapshot: DirectorSnapshot): number {
  let tension = 20;

  const heat = scorePatterns(snapshot.sessionStats, HEAT_STAT_PATTERNS);
  if (heat !== null) tension += (heat / 100) * 45;

  const events = recentEvents(snapshot, 10 * 60 * 1000); // last 10 min
  tension += Math.min(20, events * 4);

  const depletion = scorePatterns(snapshot.sessionStats, DEPLETION_STAT_PATTERNS);
  if (depletion !== null) tension -= ((100 - depletion) / 100) * 15;

  const { perMinute } = messageRhythm(snapshot);
  tension += Math.min(15, perMinute * 3);

  return Math.round(Math.min(100, Math.max(0, tension)));
}

/** Derive pacing from tension + activity */
export function computePacing(tension: number, snapshot: DirectorSnapshot): DirectorPacing {
  const { lastActivityMs } = messageRhythm(snapshot);
  const idleMinutes = lastActivityMs / 60000;
  if (idleMinutes >= 15) return 'cooldown';
  if (tension >= 75) return 'intense';
  if (tension >= 45) return 'building';
  if (tension < 30 && idleMinutes >= 5) return 'calm';
  return tension >= 45 ? 'building' : 'calm';
}

/** Deterministic pseudo-random in [0,1) seeded by string+number */
function seededRandom(seed: string, salt: number): number {
  let h = 2166136261;
  const s = `${seed}:${salt}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** Pools of world events by pacing — Spanish, setting-agnostic, short */
const WORLD_EVENT_POOLS: Record<DirectorPacing, string[]> = {
  calm: [
    'Suena el timbre del edificio: el repartidor de siempre deja un paquete en la puerta y se va silbando.',
    'Alguien sube el volumen de la música en el departamento de al lado; los paredes vibran suavecito.',
    'El celular de {{user}} zumba con un mensaje random de un número desconocido: "¿estás despierto?"',
    'Se va la luz un segundo y regresa. Los focos parpadean y algo se cayó en la cocina.',
    'Empieza a llover afuera; las gotas golpean la ventana del cuarto.',
  ],
  building: [
    'Se escuchan unos golpes fuertes en la pared del vecino, como si estuvieran moviendo muebles… o algo más.',
    'El celular de una de las chicas vibra sin parar sobre la mesa: son mensajes de alguien insistente.',
    'Un ruido extrajo viene del pasillo: pasos que se detienen justo frente a la puerta un par de segundos y luego se alejan.',
    'Suena una notificación con una foto subida a redes que a más de uno va a poner celoso/curioso.',
  ],
  intense: [
    'Alguien toca la puerta con urgencia: tres golpes seguidos, nadie responde cuando preguntan quién es.',
    'Se escucha un cristazo en la calle y unos gritos que se apagan corriendo.',
    'El teléfono de la casa suena a media conversación y nadie quiere contestar.',
  ],
  cooldown: [
    'La lluvia afuera se calma y deja solo un goteo tranquilo contra el cristal.',
    'Alguien pone música suave en el equipo y el ambiente se relaja de a poco.',
    'El olor a café recién hecho invade el departamento desde la cocina.',
  ],
};

/**
 * Heuristic decisions for a snapshot.
 * Strategy:
 * - calm + idle ≥5min → minor world event (spark)
 * - intense + many recent events → cooldown world event (release valve)
 * - group + a present-but-silent member with low "heat" OR an absent member
 *   while tension is low → scene rotation suggestion (probabilistic)
 */
export function heuristicDecisions(
  snapshot: DirectorSnapshot,
  tension: number,
  pacing: DirectorPacing,
  maxWorldEvents: number,
): DirectorDecision[] {
  const decisions: DirectorDecision[] = [];
  const seed = snapshot.sessionId;
  const turn = snapshot.turnCount || 0;
  const roll = seededRandom(seed, turn);

  // ── World events (monotony breaker / release valve) ──
  const wantsEvent =
    (pacing === 'calm' && roll < 0.5) ||
    (pacing === 'cooldown' && roll < 0.35) ||
    (pacing === 'intense' && recentEvents(snapshot, 5 * 60 * 1000) >= 3 && roll < 0.5) ||
    (pacing === 'building' && roll < 0.15);

  if (wantsEvent && maxWorldEvents > 0) {
    const pool = WORLD_EVENT_POOLS[pacing];
    const idx = Math.floor(seededRandom(seed, turn * 7 + 13) * pool.length) % pool.length;
    decisions.push({
      type: 'world_event',
      description: pool[idx],
      severity: pacing === 'intense' ? 'major' : 'minor',
    });
  }

  // ── Group scene rotation (only groups) ──
  const members = snapshot.groupMembers || [];
  const actors = members.filter(m => !m.isNarrator && m.isActive);
  if (actors.length >= 2 && snapshot.groupId) {
    const absent = actors.filter(m => !m.isPresent);
    const present = actors.filter(m => m.isPresent);

    // Someone off-scene may return when things get interesting
    if (absent.length > 0 && pacing !== 'calm' && seededRandom(seed, turn * 3 + 5) < 0.35) {
      const who = absent[Math.floor(seededRandom(seed, turn + 2) * absent.length) % absent.length];
      decisions.push({
        type: 'scene_change',
        characterId: who.characterId,
        characterName: who.name,
        present: true,
        reason: `El escándalo se escucha desde el otro cuarto y ${who.name} no aguanta la curiosidad: entra a la escena.`,
      });
    }

    // Under high tension with many present, someone may storm out
    if (present.length >= 3 && pacing === 'intense' && seededRandom(seed, turn * 11 + 7) < 0.3) {
      const who = present[Math.floor(seededRandom(seed, turn + 29) * present.length) % present.length];
      decisions.push({
        type: 'scene_change',
        characterId: who.characterId,
        characterName: who.name,
        present: false,
        reason: `${who.name} se harta del ambiente tenso y se sale de la escena dando un portazo.`,
      });
    }
  }

  return decisions;
}

/** Full heuristic run */
export function analyzeSnapshot(
  snapshot: DirectorSnapshot,
  maxWorldEvents = 1,
): DirectorResult {
  const tension = computeTension(snapshot);
  const pacing = computePacing(tension, snapshot);
  const decisions = heuristicDecisions(snapshot, tension, pacing, maxWorldEvents);
  decisions.push({ type: 'tension_shift', from: tension, to: tension, pacing });
  return { tension, pacing, decisions, source: 'heuristic' };
}
