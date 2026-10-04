// ============================================
// Scene Events → Memory V2 bridge
// ============================================
//
// When a gameplay event happens (a skill/action is used, a peticion is made,
// a solicitud is completed, a quest objective is done, a scene changes...)
// TWO things must happen:
//
//   1. The event is appended to the session's ephemeral ring buffer
//      (SessionStats.eventLog) — rendered by the {{last_events}} key as
//      [ULTIMOS EVENTOS EN LA ESCENA]. Handled by the store (pushSessionEvent
//      / recordSceneEvent) and src/lib/stats/event-log.ts.
//
//   2. The event is ALSO saved as a persistent Memory V2 record (type
//      'evento') so the character remembers it beyond the session — it shows
//      up in the [EVENTOS ANTERIORES] injection block and in semantic
//      retrieval. This module handles step 2 (fire-and-forget POST to
//      /api/memory/v2 with client-side de-duplication).
//
// The old system stored only "ultima_X" scalar variables in the session;
// that system is gone — memory is now the persistent layer.

import type { SessionEventLogEntry, SessionEventLogType } from '@/types';

/** Default importance per event type (0..1) used when saving to memory */
const EVENT_MEMORY_IMPORTANCE: Record<SessionEventLogType, number> = {
  action: 0.55,
  quest_objective: 0.7,
  solicitud_created: 0.5,
  solicitud_completed: 0.65,
  solicitud_user: 0.6,
  scene_enter: 0.35,
  scene_leave: 0.3,
  scene_focus: 0.3,
  relationship: 0.6,
  skill_check: 0.35,
  custom: 0.4,
};

export function defaultEventMemoryImportance(type: SessionEventLogType): number {
  return EVENT_MEMORY_IMPORTANCE[type] ?? 0.5;
}

function whoLabel(entry: Pick<SessionEventLogEntry, 'characterId' | 'characterName'>): string {
  if (entry.characterName) return entry.characterName;
  if (entry.characterId === '__user__') return 'El usuario';
  return '';
}

/**
 * Build a self-contained, human-readable sentence from a session event log
 * entry. This becomes the content of the Memory V2 record (type 'evento'),
 * so it must make sense on its own when read months later.
 */
export function buildEventMemoryContent(
  entry: Pick<SessionEventLogEntry, 'type' | 'description' | 'characterId' | 'characterName' | 'targetName'>
): string {
  const who = whoLabel(entry);
  const desc = (entry.description || '').trim();
  switch (entry.type) {
    case 'action':
      return `${who || 'Se'} realizó la acción: ${desc}`;
    case 'quest_objective':
      return `${who || 'Se'} completó el objetivo: ${desc}`;
    case 'solicitud_created':
      return `${who || 'Alguien'} hizo una petición${entry.targetName ? ` a ${entry.targetName}` : ''}: ${desc}`;
    case 'solicitud_user':
      return `${who || 'El usuario'} hizo una petición${entry.targetName ? ` a ${entry.targetName}` : ''}: ${desc}`;
    case 'solicitud_completed':
      return `Solicitud completada: ${desc}`;
    case 'relationship':
      return `Relación cambiada: ${desc}`;
    default:
      // scene_enter/leave/focus, skill_check, custom — the description is
      // already self-contained; prefix the actor when known.
      return who ? `${who}: ${desc}` : desc;
  }
}

// ---------- Client-side de-duplication ----------

/** Same content for the same character/group won't be re-saved within this window */
const DEDUP_WINDOW_MS = 10 * 60 * 1000;
const DEDUP_MAX_KEYS = 400;

const recentReports = new Map<string, number>();

function pruneRecentReports(now: number): void {
  for (const [key, ts] of recentReports) {
    if (now - ts > DEDUP_WINDOW_MS) recentReports.delete(key);
  }
  // Hard cap (oldest-first insertion order)
  while (recentReports.size > DEDUP_MAX_KEYS) {
    const first = recentReports.keys().next().value;
    if (first === undefined) break;
    recentReports.delete(first);
  }
}

export interface SceneEventMemoryPayload {
  /** Character whose memory receives the event ('' when groupId is set) */
  charId?: string;
  /** Group-wide memory (every member injects it) */
  groupId?: string;
  sessionId?: string;
  /** Self-contained sentence (see buildEventMemoryContent) */
  content: string;
  subject?: 'usuario' | 'personaje' | 'pareja' | 'mundo';
  importance?: number;
  /** Absolute ISO date of when it happened (defaults to now) */
  eventDate?: string;
}

/**
 * Fire-and-forget save of a scene event into the character's (or group's)
 * Memory V2 store. Never throws; silently ignores SSR and network errors.
 * Exact duplicates within DEDUP_WINDOW_MS are skipped.
 */
export function reportSceneEventToMemory(payload: SceneEventMemoryPayload): void {
  try {
    if (typeof window === 'undefined') return; // SSR guard
    const content = (payload.content || '').trim();
    if (!content) return;
    if (!payload.charId && !payload.groupId) return;

    const now = Date.now();
    const dedupKey = `${payload.groupId || ''}|${payload.charId || ''}|${content}`;
    const last = recentReports.get(dedupKey);
    if (last && now - last < DEDUP_WINDOW_MS) return;
    recentReports.set(dedupKey, now);
    pruneRecentReports(now);

    const body = {
      action: 'add',
      type: 'evento',
      charId: payload.charId || '',
      groupId: payload.groupId || '',
      sessionId: payload.sessionId || '',
      content,
      subject: payload.subject || 'mundo',
      importance: payload.importance ?? 0.5,
      eventDate: payload.eventDate || new Date().toISOString(),
    };

    // Fire-and-forget: never block the UI turn on memory writes.
    window
      .fetch('/api/memory/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        // keepalive helps the request survive quick navigations
        keepalive: true,
      })
      .catch(() => {
        /* silent — memory saves are best-effort */
      });
  } catch {
    /* silent */
  }
}
