/**
 * Memory V2 — Unified memory data model (VoiceMem-inspired).
 *
 * ONE store, ONE record type. Replaces the fragmented duality of:
 *   - CharacterMemory (Zustand → data/memory.json, "curated")
 *   - LanceDB `embeddings` table with namespace hacks ("auto")
 *
 * Records of both kinds live in the same table with `source` = 'curada' | 'auto'.
 * Curated records are always injected and never decayed.
 * Records are NEVER hard-deleted on story operations: supersede semantics
 * (supersededBy) keep the full history recoverable.
 *
 * Two brains (RP-adapted):
 *   - Hechos   → types: hecho, preferencia, nota
 *   - Relación → types: relacion
 *   - Episodic → types: evento, resumen_escena  (first-class for RP continuity)
 */

export type MemoryV2Type =
  | 'evento'          // something that HAPPENED in the story (first-class for RP)
  | 'hecho'           // stable fact about the user or the world
  | 'preferencia'     // user likes/limits regarding the roleplay
  | 'relacion'        // how the character feels about the user / dynamic shifts
  | 'nota'            // free note (curated, from the Memorias tab)
  | 'resumen_escena'; // consolidated scene summary (episodic compression)

export type MemoryV2Source = 'auto' | 'curada';
export type MemoryV2Subject = 'usuario' | 'personaje' | 'pareja' | 'mundo';
export type MemoryV2Op = 'ADD' | 'UPDATE' | 'DELETE' | 'NONE';
export type MemoryV2Backend = 'lancedb' | 'json';

/** supersededBy value when an explicit DELETE marks a record as no longer true */
export const MEMORY_TOMBSTONE = '__deleted__';

export interface MemoryV2Record {
  id: string;
  type: MemoryV2Type;
  /** Self-contained memory text (3rd person, real names — never "el usuario") */
  content: string;
  subject: MemoryV2Subject;
  /** Owning character id ('' = group-wide record) */
  charId: string;
  /** Group id for group-scoped records ('' = 1-on-1 chat) */
  groupId: string;
  /** Owning session ('' = global / cross-session) */
  sessionId: string;
  source: MemoryV2Source;
  /** 0..1 */
  importance: number;
  /** Access heat: starts at 1, boosted on retrieval, decays on consolidation */
  heat: number;
  /** Absolute ISO date of WHEN the event happened (VoiceMem "Observation Date") */
  eventDate: string;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
  accessCount: number;
  /** Related memory ids (causal chains, VoiceMem linked_memory_ids) */
  linkedIds: string[];
  /** '' = active; else id of the replacing record or MEMORY_TOMBSTONE */
  supersededBy: string;
  /** Provenance: CharacterMemory event id (`cm:...`) or legacy embedding id (`emb:...`) */
  legacyId?: string;
  sourceMessageId?: string;
}

/** Persisted in data/memory-v2-meta.json — guards model/dimension changes */
export interface MemoryV2Meta {
  model: string;
  dimension: number;
  schemaVersion: number;
  /** True when a model/dim change was detected but re-embedding failed (Ollama down) */
  needsReembed: boolean;
  updatedAt: string;
}

/** One item produced by the merged extraction LLM pass */
export interface ExtractedItem {
  type: MemoryV2Type;
  op: MemoryV2Op;
  text: string;
  /** Absolute date (YYYY-MM-DD or ISO) of the event; empty → today */
  date?: string;
  /** 0..1 */
  importance?: number;
  /** Target record id for UPDATE / DELETE */
  targetId?: string;
  /** Linked candidate ids (causal chain) */
  links?: string[];
}

export interface ExtractionOutput {
  items: ExtractedItem[];
}

export interface V2ExtractionResult {
  success: boolean;
  backend: MemoryV2Backend;
  added: number;
  updated: number;
  deleted: number;
  skipped: number;
  records: MemoryV2Record[];
  error?: string;
}

export interface ScoredMemory extends MemoryV2Record {
  /** cosine similarity (or lexical sim in JSON fallback) */
  cosine: number;
  /** final reranked score 0..1+ */
  score: number;
}

export interface V2ContextStats {
  backend: MemoryV2Backend;
  considered: number;
  injected: number;
  curatedInjected: number;
  blocks: string[];
  migratedNow: boolean;
}

export interface V2Health {
  backend: MemoryV2Backend;
  lancedbNative: boolean;
  model: string;
  dimension: number;
  meta: MemoryV2Meta | null;
  counts: {
    total: number;
    active: number;
    superseded: number;
    byType: Record<string, number>;
  };
  ollama?: {
    reachable: boolean;
    model: string;
    dimension: number;
    contextLength?: number;
  };
  error?: string;
}
