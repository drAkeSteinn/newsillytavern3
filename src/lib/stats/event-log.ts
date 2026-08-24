// ============================================
// Session Event Log helper
// ============================================
//
// Pure functions to append entries to SessionStats.eventLog
// (a ring buffer of recent events injected via the {{eventos}} key).
//
// The legacy "ultima_X" scalar fields keep working for backwards
// compatibility — every new write should update BOTH the scalar
// (when it applies) and push a log entry.

import type { SessionStats, SessionEventLogEntry, SessionEventLogType } from '@/types';

/** Max entries kept in the ring buffer */
export const MAX_EVENT_LOG_ENTRIES = 30;

/** Max entries rendered into the {{eventos}} prompt block */
export const MAX_EVENT_LOG_IN_PROMPT = 8;

let eventLogCounter = 0;

function createEntryId(): string {
  eventLogCounter += 1;
  return `evt-${Date.now()}-${eventLogCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Returns a NEW SessionStats object with the entry appended to eventLog
 * (capped at MAX_EVENT_LOG_ENTRIES, oldest dropped first).
 * Pure — does not mutate the input.
 */
export function appendEventLogEntry(
  sessionStats: SessionStats | undefined,
  entry: {
    type: SessionEventLogType;
    description: string;
    characterId?: string;
    characterName?: string;
    targetName?: string;
    turn?: number;
  },
): SessionStats {
  const logEntry: SessionEventLogEntry = {
    id: createEntryId(),
    type: entry.type,
    description: entry.description,
    characterId: entry.characterId,
    characterName: entry.characterName,
    targetName: entry.targetName,
    turn: entry.turn,
    timestamp: Date.now(),
  };

  const currentLog = sessionStats?.eventLog ?? [];
  const nextLog = [...currentLog, logEntry];
  if (nextLog.length > MAX_EVENT_LOG_ENTRIES) {
    nextLog.splice(0, nextLog.length - MAX_EVENT_LOG_ENTRIES);
  }

  return {
    ...sessionStats,
    eventLog: nextLog,
    lastModified: Date.now(),
  } as SessionStats;
}

/** Short label for an event type, used inside the {{eventos}} prompt block */
export function eventLogTypeLabel(type: SessionEventLogType): string {
  switch (type) {
    case 'action': return 'ACCION';
    case 'quest_objective': return 'OBJETIVO';
    case 'solicitud_created': return 'PETICION';
    case 'solicitud_completed': return 'SOLICITUD COMPLETADA';
    case 'solicitud_user': return 'PETICION DEL USUARIO';
    case 'scene_enter': return 'ENTRADA A ESCENA';
    case 'scene_leave': return 'SALIDA DE ESCENA';
    case 'scene_focus': return 'FOCO NARRATIVO';
    case 'relationship': return 'RELACION';
    case 'skill_check': return 'TIRADA';
    default: return 'EVENTO';
  }
}
