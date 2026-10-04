/**
 * Memory V2 — Unified store.
 *
 * Single table `memories_v2` (LanceDB, same DB dir as the legacy `embeddings`
 * table) with the full V2 schema, plus a JSON flat-file fallback
 * (data/memory-v2-fallback.json) used when the LanceDB native module is
 * unavailable or a pending model/dimension migration blocks vector search.
 *
 * Model/dimension guard (data/memory-v2-meta.json):
 *   - On init, if the recorded model/dimension differs from the current
 *     embeddings config → re-embed every record into a fresh table.
 *   - If re-embedding fails (Ollama down) → meta.needsReembed = true and the
 *     store degrades to the JSON backend (lexical search) until reinit.
 *
 * The JSON backend also serves as the graceful degradation path on Windows
 * where native-module failures were observed ("native module not available").
 */

import fs from 'fs';
import path from 'path';
import {
  getLanceDBInstance,
  isLanceDBAvailable,
  isLanceDBPermanentlyUnavailable,
} from '@/lib/embeddings/lancedb-db';
import { loadConfig } from '@/lib/embeddings/config-persistence';
import { getOllamaClient } from '@/lib/embeddings/ollama-client';
import type {
  MemoryV2Backend,
  MemoryV2Meta,
  MemoryV2Record,
  MemoryV2Type,
  MemoryV2Health,
  ScoredMemory,
} from './types';
import { MEMORY_TOMBSTONE } from './types';

const V2_TABLE = 'memories_v2';
const META_FILE = path.join(process.cwd(), 'data', 'memory-v2-meta.json');
const FALLBACK_FILE = path.join(process.cwd(), 'data', 'memory-v2-fallback.json');
const SCHEMA_VERSION = 1;
const MAX_CONTENT_LEN = 480;

// ============ Small utils ============

function esc(value: string): string {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  if (!magnitude || !isFinite(magnitude)) return vector;
  return vector.map(v => v / magnitude);
}

/** Cosine similarity for (already) normalized vectors = dot product */
function dot(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function nowISO(): string {
  return new Date().toISOString();
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `v2_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function sanitizeContent(text: string): string {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CONTENT_LEN);
}

/** Validate/normalize an absolute date; returns '' when unusable */
export function normalizeEventDate(date?: string | null): string {
  if (!date) return '';
  const t = String(date).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const d = new Date(t);
  if (!isNaN(d.getTime())) return d.toISOString();
  return '';
}

// ============ Meta (model/dim guard) ============

export function readV2Meta(): MemoryV2Meta | null {
  try {
    if (!fs.existsSync(META_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(META_FILE, 'utf-8'));
    if (!raw || typeof raw !== 'object') return null;
    return {
      model: String(raw.model || ''),
      dimension: Number(raw.dimension || 0),
      schemaVersion: Number(raw.schemaVersion || SCHEMA_VERSION),
      needsReembed: !!raw.needsReembed,
      updatedAt: String(raw.updatedAt || ''),
    };
  } catch {
    return null;
  }
}

function writeV2Meta(meta: MemoryV2Meta): void {
  try {
    fs.mkdirSync(path.dirname(META_FILE), { recursive: true });
    fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2));
  } catch (err) {
    console.warn('[MemoryV2] Failed to write meta file:', err);
  }
}

// ============ JSON fallback backend ============

interface FallbackFile {
  records: MemoryV2Record[];
}

function loadFallback(): FallbackFile {
  try {
    if (!fs.existsSync(FALLBACK_FILE)) return { records: [] };
    const raw = JSON.parse(fs.readFileSync(FALLBACK_FILE, 'utf-8'));
    return { records: Array.isArray(raw?.records) ? raw.records : [] };
  } catch {
    return { records: [] };
  }
}

function saveFallback(records: MemoryV2Record[]): void {
  try {
    fs.mkdirSync(path.dirname(FALLBACK_FILE), { recursive: true });
    fs.writeFileSync(FALLBACK_FILE, JSON.stringify({ records }, null, 2));
  } catch (err) {
    console.warn('[MemoryV2] Failed to write fallback file:', err);
  }
}

// ============ Store state & init ============

interface StoreState {
  backend: MemoryV2Backend;
  db: any | null;
  table: any | null;
  model: string;
  dim: number;
  ready: boolean;
  initPromise: Promise<void> | null;
  initError: string;
  migratedNow: boolean;
}

const state: StoreState = {
  backend: 'json',
  db: null,
  table: null,
  model: '',
  dim: 0,
  ready: false,
  initPromise: null,
  initError: '',
  migratedNow: false,
};

export function resetV2(): void {
  state.ready = false;
  state.initPromise = null;
  state.table = null;
  state.db = null;
  state.initError = '';
  state.migratedNow = false;
}

function getEmbedder(): { client: ReturnType<typeof getOllamaClient>; model: string } {
  const cfg = loadConfig();
  return { client: getOllamaClient(cfg), model: cfg.model || 'bge-m3:567m' };
}

async function embedText(text: string): Promise<{ vector: number[]; model: string }> {
  const { client, model } = getEmbedder();
  const vector = await client.embedText(text);
  return { vector, model };
}

/** Row shape stored in LanceDB (linkedIds serialized) */
function recordToRow(record: MemoryV2Record, vector: number[], model: string): Record<string, unknown> {
  return {
    id: record.id,
    type: record.type,
    content: record.content,
    subject: record.subject,
    charId: record.charId || '',
    groupId: record.groupId || '',
    sessionId: record.sessionId || '',
    source: record.source,
    importance: record.importance,
    heat: record.heat,
    eventDate: record.eventDate || '',
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastAccessedAt: record.lastAccessedAt,
    accessCount: record.accessCount,
    linkedIds: JSON.stringify(record.linkedIds || []),
    supersededBy: record.supersededBy || '',
    legacyId: record.legacyId || '',
    sourceMessageId: record.sourceMessageId || '',
    model_name: model,
    vector,
  };
}

function rowToRecord(row: any): MemoryV2Record {
  let linkedIds: string[] = [];
  try {
    const parsed = typeof row.linkedIds === 'string' ? JSON.parse(row.linkedIds) : row.linkedIds;
    if (Array.isArray(parsed)) linkedIds = parsed.map(String);
  } catch { /* keep [] */ }
  return {
    id: String(row.id),
    type: row.type as MemoryV2Type,
    content: String(row.content || ''),
    subject: row.subject || 'mundo',
    charId: row.charId || '',
    groupId: row.groupId || '',
    sessionId: row.sessionId || '',
    source: row.source === 'curada' ? 'curada' : 'auto',
    importance: Number(row.importance || 0.5),
    heat: Number(row.heat || 1),
    eventDate: row.eventDate || '',
    createdAt: row.createdAt || '',
    updatedAt: row.updatedAt || '',
    lastAccessedAt: row.lastAccessedAt || '',
    accessCount: Number(row.accessCount || 0),
    linkedIds,
    supersededBy: row.supersededBy || '',
    legacyId: row.legacyId || undefined,
    sourceMessageId: row.sourceMessageId || undefined,
  };
}

async function openOrCreateTable(db: any, dim: number, model: string): Promise<any> {
  try {
    const table = await db.openTable(V2_TABLE);
    return table;
  } catch {
    const placeholder = recordToRow(newPlaceholderRecord(), new Array(dim).fill(0), model);
    const table = await db.createTable(V2_TABLE, [placeholder]);
    await table.delete("id = 'placeholder'");
    return table;
  }
}

function newPlaceholderRecord(): MemoryV2Record {
  const t = nowISO();
  return {
    id: 'placeholder',
    type: 'nota',
    content: 'placeholder',
    subject: 'mundo',
    charId: '',
    groupId: '',
    sessionId: '',
    source: 'auto',
    importance: 0,
    heat: 0,
    eventDate: t,
    createdAt: t,
    updatedAt: t,
    lastAccessedAt: t,
    accessCount: 0,
    linkedIds: [],
    supersededBy: 'placeholder',
  };
}

/** Check the actual vector width of an existing table (first row). */
async function probeTableDimension(table: any): Promise<number | null> {
  try {
    const rows = await table.query().limit(1).toArray();
    if (!rows.length) return null;
    const v = rows[0].vector;
    return Array.isArray(v) ? v.length : null;
  } catch {
    return null;
  }
}

/**
 * Re-embed every record into a fresh table with the current model/dimension.
 * Returns false when embedding fails (e.g. Ollama down) — caller degrades.
 */
async function reembedAll(db: any, table: any, dim: number, model: string): Promise<number> {
  const rows = await table.query().toArray();
  const records = rows.map(rowToRecord).filter(r => r.id !== 'placeholder');
  if (!records.length) {
    // Nothing to migrate — just recreate the table with the new dim.
    try { await db.dropTable(V2_TABLE); } catch { /* ignore */ }
    const placeholder = recordToRow(newPlaceholderRecord(), new Array(dim).fill(0), model);
    await db.createTable(V2_TABLE, [placeholder]);
    state.table = await db.openTable(V2_TABLE);
    await state.table.delete("id = 'placeholder'");
    return 0;
  }

  // Embed first — abort without touching the table on failure.
  const vectors: number[][] = [];
  for (const rec of records) {
    const { vector } = await embedText(rec.content);
    if (!Array.isArray(vector) || vector.length === 0) throw new Error('Empty embedding vector');
    vectors.push(vector);
  }

  try { await db.dropTable(V2_TABLE); } catch { /* ignore */ }
  const placeholder = recordToRow(newPlaceholderRecord(), new Array(dim).fill(0), model);
  await db.createTable(V2_TABLE, [placeholder]);
  const newTable = await db.openTable(V2_TABLE);
  await newTable.delete("id = 'placeholder'");
  await newTable.add(records.map((rec, i) => recordToRow(rec, normalizeVector(vectors[i]), model)));
  state.table = newTable;
  return records.length;
}

async function initStore(): Promise<void> {
  state.ready = false;
  state.initError = '';
  state.migratedNow = false;

  const cfg = loadConfig();
  state.model = cfg.model || 'bge-m3:567m';

  // Probe the real embedding dimension (respects the configured model).
  let probeDim = Number(cfg.dimension || 0);
  try {
    const { vector } = await embedText('inicialización de memoria');
    if (Array.isArray(vector) && vector.length > 0) probeDim = vector.length;
  } catch (err: any) {
    state.initError = `Embedder unavailable: ${err?.message || err}`;
    state.backend = 'json';
    state.ready = true;
    console.warn(`[MemoryV2] Init with JSON backend (${state.initError})`);
    return;
  }
  state.dim = probeDim;

  if (isLanceDBPermanentlyUnavailable()) {
    state.backend = 'json';
    state.ready = true;
    return;
  }

  try {
    const avail = await isLanceDBAvailable();
    if (!avail.available) throw new Error(avail.error || 'LanceDB native module unavailable');
    const db = await getLanceDBInstance();
    if (!db) throw new Error('LanceDB instance unavailable');

    const meta = readV2Meta();
    let table = await openOrCreateTable(db, state.dim, state.model);

    // ---- Model/dimension guard ----
    const tableDim = (await probeTableDimension(table)) ?? state.dim;
    const metaMismatch = !!meta && (meta.model !== state.model || meta.dimension !== tableDim);
    const dimMismatch = tableDim !== state.dim;
    if (metaMismatch || dimMismatch || meta?.needsReembed) {
      console.log(
        `[MemoryV2] Model/dim change detected (meta: ${meta?.model}@${meta?.dimension}, ` +
        `table: @${tableDim}, current: ${state.model}@${state.dim}) — re-embedding…`
      );
      const n = await reembedAll(db, table, state.dim, state.model);
      table = state.table;
      writeV2Meta({
        model: state.model,
        dimension: state.dim,
        schemaVersion: SCHEMA_VERSION,
        needsReembed: false,
        updatedAt: nowISO(),
      });
      state.migratedNow = true;
      console.log(`[MemoryV2] Re-embedded ${n} records into fresh table @${state.dim}d`);
    } else if (!meta) {
      writeV2Meta({
        model: state.model,
        dimension: state.dim,
        schemaVersion: SCHEMA_VERSION,
        needsReembed: false,
        updatedAt: nowISO(),
      });
    }

    state.db = db;
    state.table = table;
    state.backend = 'lancedb';
    state.ready = true;
  } catch (err: any) {
    state.initError = err?.message || String(err);
    state.backend = 'json';
    state.ready = true;
    console.warn(`[MemoryV2] LanceDB init failed → JSON backend. ${state.initError}`);
  }
}

/** Lazily-initialized store accessor */
async function ensureReady(): Promise<void> {
  if (state.ready) return;
  if (!state.initPromise) {
    state.initPromise = initStore().catch(err => {
      state.initError = err?.message || String(err);
      state.backend = 'json';
      state.ready = true;
    });
  }
  await state.initPromise;
}

// ============ Filters ============

interface FilterOpts {
  charId?: string;
  groupId?: string;
  sessionId?: string;
  crossSession?: boolean;
  types?: MemoryV2Type[];
  activeOnly?: boolean;
  curatedOnly?: boolean;
}

function buildWhere(opts: FilterOpts): string {
  const clauses: string[] = [];
  const { charId, groupId, sessionId, crossSession, types, activeOnly = true, curatedOnly } = opts;

  if (charId && groupId) {
    clauses.push(`(charId = '${esc(charId)}' OR (charId = '' AND groupId = '${esc(groupId)}'))`);
  } else if (charId) {
    clauses.push(`charId = '${esc(charId)}'`);
  } else if (groupId) {
    clauses.push(`groupId = '${esc(groupId)}'`);
  }
  if (!crossSession && sessionId) {
    clauses.push(`(sessionId = '' OR sessionId = '${esc(sessionId)}')`);
  }
  if (types?.length) {
    clauses.push(`type IN (${types.map(t => `'${esc(t)}'`).join(', ')})`);
  }
  if (activeOnly) clauses.push(`supersededBy = ''`);
  if (curatedOnly) clauses.push(`source = 'curada'`);
  return clauses.join(' AND ');
}

// ============ Public store API ============

export interface V2Store {
  readonly backend: MemoryV2Backend;
  readonly model: string;
  readonly dim: number;
  readonly initError: string;
  readonly migratedNow: boolean;
  embed(text: string): Promise<number[]>;
  add(record: MemoryV2Record, opts?: { vector?: number[] }): Promise<MemoryV2Record>;
  get(id: string): Promise<MemoryV2Record | null>;
  getByLegacyId(legacyId: string, charId?: string): Promise<MemoryV2Record | null>;
  supersede(id: string, supersededBy: string): Promise<boolean>;
  hardDelete(id: string): Promise<boolean>;
  update(record: MemoryV2Record, opts?: { reembed?: boolean }): Promise<void>;
  list(opts: FilterOpts & { limit?: number; orderBy?: 'smart' | 'recent' | 'importance' }): Promise<MemoryV2Record[]>;
  searchVector(opts: FilterOpts & { vector: number[]; query?: string; limit?: number; threshold?: number }): Promise<{ record: MemoryV2Record; cosine: number }[]>;
  searchLexical(opts: FilterOpts & { query: string; limit?: number }): Promise<{ record: MemoryV2Record; cosine: number }[]>;
  touch(ids: string[]): Promise<void>;
  counts(charId?: string): Promise<MemoryV2Health['counts']>;
}

const store: V2Store = {
  get backend() { return state.backend; },
  get model() { return state.model; },
  get dim() { return state.dim; },
  get initError() { return state.initError; },
  get migratedNow() { return state.migratedNow; },

  async embed(text: string): Promise<number[]> {
    const { vector } = await embedText(text);
    return vector;
  },

  async add(record, opts) {
    await ensureReady(); // keep add consistent with every other store method
    record.content = sanitizeContent(record.content);
    const t = nowISO();
    if (!record.id) record.id = `v2_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    record.createdAt = record.createdAt || t;
    record.updatedAt = t;
    record.lastAccessedAt = record.lastAccessedAt || t;
    record.accessCount = record.accessCount || 0;
    record.heat = record.heat ?? 1;
    record.importance = Math.min(1, Math.max(0, record.importance ?? 0.5));
    record.supersededBy = record.supersededBy || '';
    record.linkedIds = record.linkedIds || [];
    if (!record.eventDate) record.eventDate = t;

    if (state.backend === 'lancedb' && state.table) {
      let vector = opts?.vector;
      if (!vector) {
        const res = await embedText(record.content).catch(() => null);
        if (!res) throw new Error('Embedding failed while adding memory record');
        vector = res.vector;
      }
      await state.table.add([recordToRow(record, normalizeVector(vector), state.model)]);
    } else {
      const fb = loadFallback();
      fb.records.push(record);
      saveFallback(fb.records);
    }
    return record;
  },

  async get(id) {
    await ensureReady();
    if (state.backend === 'lancedb' && state.table) {
      const rows = await state.table.query().where(`id = '${esc(id)}'`).limit(2).toArray();
      return rows.length ? rowToRecord(rows[0]) : null;
    }
    return loadFallback().records.find(r => r.id === id) || null;
  },

  async getByLegacyId(legacyId, charId) {
    await ensureReady();
    const cond = [`legacyId = '${esc(legacyId)}'`];
    if (charId) cond.push(`charId = '${esc(charId)}'`);
    if (state.backend === 'lancedb' && state.table) {
      const rows = await state.table.query().where(cond.join(' AND ')).limit(2).toArray();
      return rows.length ? rowToRecord(rows[0]) : null;
    }
    return loadFallback().records.find(r => r.legacyId === legacyId && (!charId || r.charId === charId)) || null;
  },

  async supersede(id, supersededBy) {
    await ensureReady();
    const t = nowISO();
    if (state.backend === 'lancedb' && state.table) {
      const rows = await state.table.query().where(`id = '${esc(id)}'`).limit(2).toArray();
      if (!rows.length) return false;
      const row = rows[0];
      const rec = rowToRecord(row);
      rec.supersededBy = supersededBy || MEMORY_TOMBSTONE;
      rec.updatedAt = t;
      await state.table.delete(`id = '${esc(id)}'`);
      await state.table.add([recordToRow(rec, Array.from(row.vector || []), row.model_name || state.model)]);
      return true;
    }
    const fb = loadFallback();
    const rec = fb.records.find(r => r.id === id);
    if (!rec) return false;
    rec.supersededBy = supersededBy || MEMORY_TOMBSTONE;
    rec.updatedAt = t;
    saveFallback(fb.records);
    return true;
  },

  async hardDelete(id) {
    await ensureReady();
    if (state.backend === 'lancedb' && state.table) {
      await state.table.delete(`id = '${esc(id)}'`);
      return true;
    }
    const fb = loadFallback();
    const before = fb.records.length;
    fb.records = fb.records.filter(r => r.id !== id);
    saveFallback(fb.records);
    return fb.records.length < before;
  },

  async update(record, opts) {
    await ensureReady();
    const t = nowISO();
    record.updatedAt = t;
    if (state.backend === 'lancedb' && state.table) {
      const rows = await state.table.query().where(`id = '${esc(record.id)}'`).limit(2).toArray();
      if (!rows.length) throw new Error(`Record ${record.id} not found`);
      const old = rows[0];
      await state.table.delete(`id = '${esc(record.id)}'`);
      if (opts?.reembed) {
        const { vector } = await embedText(record.content);
        await state.table.add([recordToRow(record, normalizeVector(vector), state.model)]);
      } else {
        await state.table.add([recordToRow(record, Array.from(old.vector || []), old.model_name || state.model)]);
      }
    } else {
      const fb = loadFallback();
      const idx = fb.records.findIndex(r => r.id === record.id);
      if (idx >= 0) fb.records[idx] = record;
      saveFallback(fb.records);
    }
  },

  async list(opts) {
    await ensureReady();
    const { limit = 100, orderBy = 'smart', ...filters } = opts;
    let records: MemoryV2Record[];
    if (state.backend === 'lancedb' && state.table) {
      const where = buildWhere(filters);
      const query: any = state.table.query();
      if (where) query.where(where);
      const rows = await query.limit(Math.max(limit * 4, 200)).toArray();
      records = rows.map(rowToRecord);
    } else {
      const fb = loadFallback();
      records = fb.records.filter(r => {
        if (filters.charId && r.charId !== filters.charId && !(r.charId === '' && filters.groupId && r.groupId === filters.groupId)) return false;
        if (!filters.charId && filters.groupId && r.groupId !== filters.groupId) return false;
        if (!filters.crossSession && filters.sessionId && r.sessionId !== '' && r.sessionId !== filters.sessionId) return false;
        if (filters.types?.length && !filters.types.includes(r.type)) return false;
        if ((filters.activeOnly !== false) && r.supersededBy !== '') return false;
        if (filters.curatedOnly && r.source !== 'curada') return false;
        return true;
      });
    }

    const dayMs = 24 * 60 * 60 * 1000;
    const recency = (r: MemoryV2Record) => {
      const t = Date.parse(r.eventDate || r.createdAt || '');
      return isNaN(t) ? 0 : Math.max(0, 1 - (Date.now() - t) / (90 * dayMs));
    };
    if (orderBy === 'recent') {
      records.sort((a, b) => (b.eventDate || b.createdAt || '').localeCompare(a.eventDate || a.createdAt || ''));
    } else if (orderBy === 'importance') {
      records.sort((a, b) => b.importance - a.importance);
    } else {
      // smart: curated first, then importance × heat × recency
      records.sort((a, b) => {
        const cur = (r: MemoryV2Record) => (r.source === 'curada' ? 1 : 0);
        if (cur(b) !== cur(a)) return cur(b) - cur(a);
        return (
          b.importance * 2 + Math.min(1.5, b.heat / 5) + recency(b) -
          (a.importance * 2 + Math.min(1.5, a.heat / 5) + recency(a))
        );
      });
    }
    return records.slice(0, limit);
  },

  async searchVector(opts) {
    await ensureReady();
    const { vector, query, limit = 10, threshold = 0.15, ...filters } = opts;
    const qv = normalizeVector(vector);
    if (state.backend === 'lancedb' && state.table) {
      const all = await state.table
        .vectorSearch(qv)
        .limit(Math.max(limit * 10, 60))
        .toArray();
      const where = buildWhere(filters);
      return all
        .map((row: any) => ({
          record: rowToRecord(row),
          cosine: 1 - (row._distance || 0) / 2,
        }))
        .filter((hit: any) => {
          if (hit.record.id === 'placeholder') return false;
          if (hit.cosine < threshold) return false;
          if (!where) return true;
          // Reuse the same predicate logic in-memory (cheap at V2 scale)
          return matchesWhere(hit.record, filters);
        })
        .slice(0, limit);
    }
    // JSON fallback: no vectors — lexical sim stands in for cosine (when a
    // text query is provided, e.g. extraction dedup). Lexical overlap scores
    // run much lower than true cosine similarity, so a vector-grade threshold
    // (e.g. DEDUP_COSINE 0.92 ≈ identical text) is unreachable here. Cap the
    // threshold so dedup catches paraphrased duplicates instead of letting
    // near-identical memories pile up.
    const jsonThreshold = Math.min(threshold ?? 0, 0.6);
    const lexical = await store.searchLexical({ ...opts, query: query || '', limit: limit * 2 } as any);
    return lexical
      .filter(h => h.cosine >= jsonThreshold)
      .slice(0, limit);
  },

  async searchLexical(opts) {
    await ensureReady();
    const { query, limit = 10, ...filters } = opts;
    const qTokens = new Set(tokenizeStem(query));
    const records = await store.list({ ...filters, limit: 500 });
    return records
      .map(record => {
        const rTokens = tokenizeStem(record.content);
        let overlap = 0;
        for (const t of rTokens) if (qTokens.has(t)) overlap++;
        const cosine = qTokens.size ? overlap / qTokens.size : 0;
        return { record, cosine };
      })
      .filter(h => h.cosine > 0)
      .sort((a, b) => b.cosine - a.cosine)
      .slice(0, limit);
  },

  async touch(ids) {
    if (!ids.length) return;
    await ensureReady();
    const t = nowISO();
    for (const id of ids) {
      try {
        if (state.backend === 'lancedb' && state.table) {
          const rows = await state.table.query().where(`id = '${esc(id)}'`).limit(2).toArray();
          if (!rows.length) continue;
          const row = rows[0];
          const rec = rowToRecord(row);
          rec.heat = (Number(rec.heat) || 1) + 1; // guard NaN on legacy records
          rec.accessCount = (Number(rec.accessCount) || 0) + 1;
          rec.lastAccessedAt = t;
          await state.table.delete(`id = '${esc(id)}'`);
          await state.table.add([recordToRow(rec, Array.from(row.vector || []), row.model_name || state.model)]);
        } else {
          const fb = loadFallback();
          const rec = fb.records.find(r => r.id === id);
          if (!rec) continue;
          rec.heat = (Number(rec.heat) || 1) + 1; // guard NaN on legacy records
          rec.accessCount = (Number(rec.accessCount) || 0) + 1;
          rec.lastAccessedAt = t;
          saveFallback(fb.records);
        }
      } catch (err) {
        console.warn(`[MemoryV2] touch(${id}) failed:`, err);
      }
    }
  },

  async counts(charId) {
    await ensureReady();
    let records: MemoryV2Record[];
    if (state.backend === 'lancedb' && state.table) {
      const query: any = state.table.query();
      if (charId) query.where(`charId = '${esc(charId)}'`);
      const rows = await query.limit(10000).toArray();
      records = rows.map(rowToRecord).filter(r => r.id !== 'placeholder');
    } else {
      records = loadFallback().records.filter(r => !charId || r.charId === charId);
    }
    const byType: Record<string, number> = {};
    let active = 0;
    let superseded = 0;
    for (const r of records) {
      byType[r.type] = (byType[r.type] || 0) + 1;
      if (r.supersededBy === '') active++; else superseded++;
    }
    return { total: records.length, active, superseded, byType };
  },
};

/** In-memory predicate mirroring buildWhere (used after vectorSearch). */
function matchesWhere(record: MemoryV2Record, opts: FilterOpts): boolean {
  const { charId, groupId, sessionId, crossSession, types, activeOnly = true, curatedOnly } = opts;
  if (charId && groupId) {
    if (record.charId !== charId && !(record.charId === '' && record.groupId === groupId)) return false;
  } else if (charId && record.charId !== charId) return false;
  else if (groupId && !charId && record.groupId !== groupId) return false;
  if (!crossSession && sessionId && record.sessionId !== '' && record.sessionId !== sessionId) return false;
  if (types?.length && !types.includes(record.type)) return false;
  if (activeOnly && record.supersededBy !== '') return false;
  if (curatedOnly && record.source !== 'curada') return false;
  return true;
}

// ============ Tokenizer (shared with retrieval / lexical search) ============

const STOPWORDS = new Set([
  'que', 'del', 'los', 'las', 'una', 'uno', 'unos', 'unas', 'por', 'para', 'con', 'sin', 'sobre',
  'como', 'pero', 'mas', 'muy', 'cuando', 'donde', 'quien', 'cual', 'cuales', 'este', 'esta',
  'esto', 'estos', 'estas', 'ese', 'esa', 'eso', 'aquel', 'aquella', 'the', 'and', 'for', 'with',
  'you', 'your', 'was', 'were', 'are', 'have', 'has', 'had', 'his', 'her', 'they', 'them',
]);

export function tokenize(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9ñ]+/i)
    .filter(t => t.length >= 3 && !STOPWORDS.has(t));
}

/**
 * Light Spanish/English suffix stripper (0-deps) for LEXICAL matching.
 * Lets "conocimos"/"conocieron" both map to "conoc" and "sientes"/"siente"
 * to "sient" — critical for the JSON fallback where there are no vectors.
 * Applied identically to query and record tokens (consistency > accuracy).
 */
export function stemLite(word: string): string {
  let w = word;
  if (w.length <= 4) return w;
  // Longest-first so 'aron' wins over 'on' etc.
  const SUFFIXES = [
    'ariamente', 'imientos', 'amiento', 'imiento', 'aciones', 'uciones',
    'adoras', 'adores', 'ancias', 'encias', 'ancia', 'encia', 'iendo',
    'ieron', 'ando', 'aron', 'imos', 'iste', 'aste', 'idad', 'able',
    'ible', 'ista', 'osos', 'osas', 'idos', 'idas', 'ado', 'ada', 'ido',
    'ida', 'mente', 'mente', 'os', 'as', 'es', 'an', 'en', 'ar', 'er',
    'ir', 's', 'e', 'a',
  ];
  for (const s of SUFFIXES) {
    if (w.length - s.length >= 4 && w.endsWith(s)) {
      w = w.slice(0, w.length - s.length);
      break;
    }
  }
  return w;
}

/** Tokenize + stem — the comparison space for lexical scoring. */
export function tokenizeStem(text: string): string[] {
  return tokenize(text).map(stemLite);
}

// ============ Health ============

export async function v2Health(includeOllama = false): Promise<MemoryV2Health> {
  await ensureReady();
  const health: MemoryV2Health = {
    backend: state.backend,
    lancedbNative: !(await isLanceDBAvailable()).available ? false : !isLanceDBPermanentlyUnavailable(),
    model: state.model,
    dimension: state.dim,
    meta: readV2Meta(),
    counts: await store.counts(),
  };
  if (state.initError) health.error = state.initError;
  if (includeOllama) {
    try {
      const { client, model } = getEmbedder();
      const conn = await client.checkConnection();
      let contextLength: number | undefined;
      try {
        const { loadConfig: lc, getModelContextLength } = await import('@/lib/embeddings/config-persistence');
        contextLength = getModelContextLength();
      } catch { /* optional */ }
      health.ollama = {
        reachable: conn,
        model,
        dimension: state.dim,
        contextLength,
      };
    } catch (err: any) {
      health.ollama = { reachable: false, model: state.model, dimension: state.dim };
    }
  }
  return health;
}

/** Singleton accessor used by extraction / retrieval / injection / routes */
export async function getV2(): Promise<V2Store> {
  await ensureReady();
  return store;
}

export default store;
