/**
 * Memory V2 — Legacy data migration into the unified store.
 *
 * Sources (both idempotent via `legacyId`):
 *   1. CharacterMemory (data/memory.json → characterMemories[charId])
 *      events/relationships/notes → source='curada' records.
 *   2. Legacy LanceDB namespaces (memory-character-{id}, memory-character-{id}-{session},
 *      memory-group-{gid}) → source='auto' records (re-embedded).
 */

import { readDataFile } from '@/lib/persistence';
import { DATA_FILES } from '@/lib/persistence';
import { getV2 } from './store';
import { sanitizeContent, normalizeEventDate } from './store';
import type { MemoryV2Record, MemoryV2Type } from './types';

const CM_TYPE_MAP: Record<string, MemoryV2Type> = {
  event: 'evento',
  state_change: 'evento',
  fact: 'hecho',
  location: 'hecho',
  item: 'hecho',
  emotion: 'relacion',
  relationship: 'relacion',
};

const LEGACY_TYPE_MAP: Record<string, MemoryV2Type> = {
  hecho: 'hecho',
  evento: 'evento',
  relacion: 'relacion',
  preferencia: 'preferencia',
  secreto: 'hecho',
  otro: 'hecho',
};

interface LegacyCharacterMemory {
  events?: Array<{
    id: string;
    type?: string;
    content?: string;
    importance?: number;
    timestamp?: string | number;
    embeddingId?: string;
    metadata?: Record<string, any>;
  }>;
  relationships?: Array<{
    targetName?: string;
    relationship?: string;
    sentiment?: number;
    notes?: string;
    lastUpdated?: string;
  }>;
  notes?: string;
}

interface MemoryFileShape {
  characterMemories?: Record<string, LegacyCharacterMemory>;
}

function mkRecord(base: Partial<MemoryV2Record> & { type: MemoryV2Type; content: string }): MemoryV2Record {
  const t = new Date().toISOString();
  return {
    id: `v2m_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    subject: 'pareja',
    charId: '',
    groupId: '',
    sessionId: '',
    source: 'auto',
    importance: 0.5,
    heat: 1,
    eventDate: t,
    createdAt: t,
    updatedAt: t,
    lastAccessedAt: t,
    accessCount: 0,
    linkedIds: [],
    supersededBy: '',
    ...base,
    content: sanitizeContent(base.content),
  };
}

/** Normalize legacy importance (1-5 or 0-1) → 0..1 */
function normImportance(imp: number | undefined, fallback = 0.5): number {
  if (imp === undefined || imp === null || isNaN(Number(imp))) return fallback;
  const v = Number(imp);
  const unit = v > 1 ? (v - 1) / 4 : v;
  return Math.min(1, Math.max(0.05, unit));
}

function toDate(ts: string | number | undefined): string {
  if (ts === undefined || ts === null || ts === '') return new Date().toISOString();
  const d = new Date(ts);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export interface MigrationResult {
  migrated: number;
  skipped: number;
  errors: number;
}

/**
 * Migrate all legacy sources for one character (and optionally its group).
 * Idempotent: records already migrated (legacyId present) are skipped.
 */
export async function migrateLegacyForCharacter(charId: string, groupId?: string): Promise<MigrationResult> {
  const result: MigrationResult = { migrated: 0, skipped: 0, errors: 0 };
  const store = await getV2();

  // ---------- 1) CharacterMemory (curated) ----------
  try {
    const memoryFile = readDataFile<MemoryFileShape>(DATA_FILES.memory, {} as MemoryFileShape);
    const cm = memoryFile?.characterMemories?.[charId];

    if (cm) {
      for (const event of cm.events || []) {
        if (!event?.content?.trim()) continue;
        const legacyId = `cm:${event.id}`;
        try {
          if (await store.getByLegacyId(legacyId, charId)) { result.skipped++; continue; }
          const type = CM_TYPE_MAP[event.type || ''] || 'evento';
          const rec = mkRecord({
            type,
            content: event.content,
            subject: type === 'relacion' ? 'pareja' : 'usuario',
            charId,
            groupId: groupId || '',
            sessionId: '',
            source: 'curada',
            importance: normImportance(event.importance, 0.6),
            eventDate: toDate(event.timestamp),
            legacyId,
          });
          await store.add(rec);
          result.migrated++;
        } catch (e) {
          console.warn(`[MemoryV2-migrate] cm event ${event.id} failed:`, e);
          result.errors++;
        }
      }

      for (const rel of cm.relationships || []) {
        if (!rel?.targetName || !rel?.relationship) continue;
        const legacyId = `cmr:${charId}:${rel.targetName}`;
        try {
          if (await store.getByLegacyId(legacyId, charId)) { result.skipped++; continue; }
          const sentiment = Math.max(-100, Math.min(100, Number(rel.sentiment || 0)));
          const content = `${rel.targetName}: ${rel.relationship} (sentimiento ${sentiment >= 0 ? '+' : ''}${sentiment})${rel.notes ? ` — ${rel.notes}` : ''}`;
          const rec = mkRecord({
            type: 'relacion',
            content,
            subject: 'pareja',
            charId,
            groupId: groupId || '',
            source: 'curada',
            importance: Math.min(0.95, 0.35 + Math.abs(sentiment) / 200),
            eventDate: toDate(rel.lastUpdated),
            legacyId,
          });
          await store.add(rec);
          result.migrated++;
        } catch (e) {
          console.warn(`[MemoryV2-migrate] relationship ${rel.targetName} failed:`, e);
          result.errors++;
        }
      }

      if (cm.notes?.trim()) {
        const lines = cm.notes.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 10);
        for (let i = 0; i < lines.length; i++) {
          const legacyId = `cmn:${charId}:${i}:${lines[i].slice(0, 24)}`;
          try {
            if (await store.getByLegacyId(legacyId, charId)) { result.skipped++; continue; }
            const rec = mkRecord({
              type: 'nota',
              content: lines[i],
              subject: 'mundo',
              charId,
              groupId: groupId || '',
              source: 'curada',
              importance: 0.5,
              legacyId,
            });
            await store.add(rec);
            result.migrated++;
          } catch (e) {
            console.warn(`[MemoryV2-migrate] note ${i} failed:`, e);
            result.errors++;
          }
        }
      }
    }
  } catch (e) {
    console.warn('[MemoryV2-migrate] CharacterMemory migration failed:', e);
    result.errors++;
  }

  // ---------- 2) Legacy LanceDB namespaces (auto memories) ----------
  try {
    const { getEmbeddingClient } = await import('@/lib/embeddings/client');
    const client = getEmbeddingClient();
    const namespaces = await client.getAllNamespaces();
    const targets = namespaces
      .map(n => n.namespace)
      .filter(ns => {
        if (ns.startsWith(`memory-character-${charId}`)) return true;
        if (groupId && ns === `memory-group-${groupId}`) return true;
        return false;
      });

    for (const ns of targets) {
      let rows: Array<{ id: string; content: string; metadata?: any; created_at?: string }> = [];
      try {
        rows = await client.getNamespaceEmbeddingsMetadata(ns, { limit: 500, sourceType: 'memory' });
        if (!rows.length) {
          rows = await client.getNamespaceEmbeddingsMetadata(ns, { limit: 500 });
        }
      } catch (e) {
        console.warn(`[MemoryV2-migrate] namespace ${ns} read failed:`, e);
        result.errors++;
        continue;
      }

      for (const row of rows) {
        if (!row?.content?.trim()) continue;
        const legacyId = `emb:${row.id}`;
        try {
          if (await store.getByLegacyId(legacyId, charId)) { result.skipped++; continue; }
          const meta = row.metadata || {};
          const tipo = String(meta.tipo || meta.type || '');
          const type = LEGACY_TYPE_MAP[tipo] || (meta.episodica ? 'evento' : 'hecho');
          const isGroup = ns.startsWith('memory-group-');
          const rec = mkRecord({
            type,
            content: row.content,
            subject: type === 'relacion' ? 'pareja' : 'usuario',
            charId: isGroup ? '' : charId,
            groupId: isGroup && groupId ? groupId : '',
            sessionId: '',
            source: 'auto',
            importance: normImportance(meta.importancia ?? meta.importance, 0.5),
            eventDate: normalizeEventDate(row.created_at) || new Date().toISOString(),
            legacyId,
          });
          await store.add(rec);
          result.migrated++;
        } catch (e) {
          console.warn(`[MemoryV2-migrate] emb ${row.id} failed:`, e);
          result.errors++;
        }
      }
    }
  } catch (e) {
    console.warn('[MemoryV2-migrate] LanceDB namespace migration failed:', e);
    result.errors++;
  }

  return result;
}

/**
 * Full migration across every character present in data/memory.json.
 */
export async function migrateLegacyToV2(opts?: { charId?: string }): Promise<MigrationResult & { chars: string[] }> {
  const memoryFile = readDataFile<MemoryFileShape>(DATA_FILES.memory, {} as MemoryFileShape);
  const chars = Object.keys(memoryFile?.characterMemories || {}).filter(Boolean);
  const total: MigrationResult & { chars: string[] } = { migrated: 0, skipped: 0, errors: 0, chars: [] };

  const targets = opts?.charId ? [opts.charId] : chars;
  for (const charId of targets) {
    const r = await migrateLegacyForCharacter(charId);
    total.migrated += r.migrated;
    total.skipped += r.skipped;
    total.errors += r.errors;
    if (r.migrated > 0) total.chars.push(charId);
  }
  return total;
}
