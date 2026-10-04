/**
 * Memory V2 — Merged extraction service.
 *
 * One LLM pass per exchange (user + assistant together) produces structured
 * ops (ADD/UPDATE/DELETE) against the unified store:
 *   - ADD      → vector dedup (cosine ≥ 0.92 vs same type) → skip + heat bump
 *   - UPDATE   → insert new record + supersede the old one (history kept)
 *   - DELETE   → tombstone the target (supersededBy = MEMORY_TOMBSTONE)
 * Absolute dates on every write; links preserved for causal chains.
 */

import { generateResponse } from '@/lib/llm/generation';
import type { LLMConfig } from '@/lib/llm/types';
import { getV2 } from './store';
import { normalizeEventDate, sanitizeContent } from './store';
import { MEMORY_TOMBSTONE } from './types';
import type {
  ExtractedItem,
  ExtractionOutput,
  MemoryV2Record,
  MemoryV2Type,
  V2ExtractionResult,
} from './types';
import { MEMORY_V2_EXTRACTION_SYSTEM, fillV2ExtractionTemplate } from './prompts';

const VALID_TYPES: MemoryV2Type[] = ['evento', 'hecho', 'preferencia', 'relacion', 'nota', 'resumen_escena'];
const DEDUP_COSINE = 0.92;
const DEFAULT_MAX_ITEMS = 8;

/** Robustly parse the extractor JSON out of an LLM response */
export function parseExtractionOutput(text: string): ExtractionOutput {
  if (!text) return { items: [] };
  let raw = text.trim();
  // Strip code fences
  raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  // Find the outermost JSON object
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return { items: [] };
  raw = raw.slice(start, end + 1);
  try {
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.items)) return parsed as ExtractionOutput;
  } catch {
    // One retry: strip trailing commas
    try {
      const cleaned = raw.replace(/,\s*([}\]])/g, '$1');
      const parsed = JSON.parse(cleaned);
      if (parsed && Array.isArray(parsed.items)) return parsed as ExtractionOutput;
    } catch { /* fallthrough */ }
  }
  return { items: [] };
}

function coerceItem(raw: any): ExtractedItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const op = String(raw.op || '').toUpperCase();
  if (!['ADD', 'UPDATE', 'DELETE'].includes(op)) return null;
  const type = VALID_TYPES.includes(raw.type) ? raw.type : 'evento';
  const text = sanitizeContent(raw.text || '');
  const importance = Math.min(1, Math.max(0, Number(raw.importance ?? 0.5)));
  const date = normalizeEventDate(raw.date);
  const targetId = String(raw.targetId || '').trim();
  const links = Array.isArray(raw.links) ? raw.links.map((l: any) => String(l)).filter(Boolean) : [];
  if (op === 'DELETE') {
    if (!targetId) return null;
    return { type, op: 'DELETE', text: '', importance, date, targetId, links: [] };
  }
  if (op === 'UPDATE' && !targetId) return null;
  if (!text) return null;
  return { type, op: op as 'ADD' | 'UPDATE', text, importance, date, targetId, links };
}

function formatCandidates(candidates: MemoryV2Record[]): string {
  if (!candidates.length) return '(vacía — primera interacción registrada)';
  return candidates
    .map(c => `${c.id} | ${c.type} | ${c.content}`)
    .join('\n');
}

export interface V2ExtractionParams {
  /** Recent exchange window (already includes last user + assistant turns) */
  transcript: string;
  charId: string;
  charName: string;
  userName?: string;
  sessionId?: string;
  groupId?: string;
  llmConfig: LLMConfig;
  minImportance?: number;   // legacy 1-5 scale (default 2)
  maxItems?: number;
  sourceMessageId?: string;
}

/**
 * Run the merged extraction pass and apply the resulting ops to the store.
 */
export async function extractAndSaveV2(params: V2ExtractionParams): Promise<V2ExtractionResult> {
  const {
    transcript, charId, charName, userName = 'el usuario', sessionId = '',
    groupId = '', llmConfig, minImportance = 2, maxItems = DEFAULT_MAX_ITEMS,
    sourceMessageId,
  } = params;

  const result: V2ExtractionResult = {
    success: false, backend: 'json', added: 0, updated: 0, deleted: 0, skipped: 0, records: [],
  };

  try {
    const store = await getV2();
    result.backend = store.backend;

    // Candidates: active records for this char (or group), curated first.
    const candidates = await store.list({
      charId,
      groupId: groupId || undefined,
      crossSession: true,
      activeOnly: true,
      limit: 14,
      orderBy: 'smart',
    });

    const today = new Date().toISOString().slice(0, 10);
    const payload = fillV2ExtractionTemplate({
      charName,
      userName,
      today,
      transcript: transcript.slice(-6000),
      candidates: formatCandidates(candidates),
      maxItems,
    });

    // Same message pattern as legacy extraction (provider-quirk friendly).
    // Low temperature for consistent JSON output (same as legacy extractor).
    const extractionConfig: LLMConfig = {
      ...llmConfig,
      parameters: {
        ...llmConfig.parameters,
        temperature: 0.1,
        maxTokens: llmConfig.parameters?.maxTokens ?? 800,
      },
    };
    const messages = [
      { role: 'assistant' as const, content: MEMORY_V2_EXTRACTION_SYSTEM },
      { role: 'user' as const, content: payload },
    ];
    const response = await generateResponse(llmConfig.provider, messages, extractionConfig, 'MemoryV2Extractor');
    // Provider shapes vary: z-ai → { message }, others → string | { content | text }
    const rawResp: any = response;
    const content: string = typeof rawResp === 'string'
      ? rawResp
      : rawResp?.message || rawResp?.content || rawResp?.text || '';

    const output = parseExtractionOutput(content);
    const items = output.items.map(coerceItem).filter((i): i is ExtractedItem => i !== null);

    // Legacy 1-5 minImportance → 0-1 threshold (2 → 0.25)
    const minImp01 = Math.min(1, Math.max(0, (minImportance - 1) / 4));
    const candidateIds = new Set(candidates.map(c => c.id));

    for (const item of items) {
      try {
        if (item.op === 'DELETE') {
          if (!candidateIds.has(item.targetId!)) { result.skipped++; continue; }
          const ok = await store.supersede(item.targetId!, MEMORY_TOMBSTONE);
          if (ok) result.deleted++; else result.skipped++;
          continue;
        }

        if (item.op === 'UPDATE') {
          const old = candidateIds.has(item.targetId!) ? await store.get(item.targetId!) : null;
          if (!old) { result.skipped++; continue; }
          const t = new Date().toISOString();
          const newRec: MemoryV2Record = {
            id: '',
            type: item.type,
            content: item.text,
            subject: old.subject,
            charId: old.charId,
            groupId: old.groupId,
            sessionId: old.sessionId,
            source: 'auto',
            importance: Math.max(item.importance ?? old.importance, 0.3),
            heat: Math.max(Number(old.heat) || 1, 1),
            eventDate: item.date || old.eventDate,
            createdAt: old.createdAt,
            updatedAt: t,
            lastAccessedAt: t,
            accessCount: old.accessCount,
            linkedIds: Array.from(new Set([old.id, ...(item.links || []).filter(l => candidateIds.has(l))])),
            supersededBy: '',
            sourceMessageId,
          };
          newRec.id = `v2_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
          const saved = await store.add(newRec);
          await store.supersede(old.id, saved.id);
          result.updated++;
          result.records.push(saved);
          continue;
        }

        // ADD — importance gate first (cheap), then vector dedup.
        if ((item.importance ?? 0.5) < minImp01) { result.skipped++; continue; }
        // Dedup: try the vector path first. When the embedding backend is down
        // (Ollama offline) the JSON fallback store is still fully writable, so
        // we must NOT discard the extracted memory — fall back to a dummy
        // vector so searchVector's lexical dedup runs instead. Only a real
        // lancedb backend (which needs embeddings to store anything) skips.
        let dedupVector: number[];
        try {
          dedupVector = await store.embed(item.text);
        } catch {
          if (store.backend !== 'json') { result.skipped++; continue; }
          dedupVector = [0]; // normalizeVector passes it through untouched
        }
        const dupHits = await store.searchVector({
          vector: dedupVector,
          query: item.text, // enables lexical dedup in JSON fallback mode
          charId,
          groupId: groupId || undefined,
          crossSession: true,
          types: [item.type],
          activeOnly: true,
          limit: 5,
          threshold: DEDUP_COSINE,
        });
        if (dupHits.length > 0) {
          // Duplicate → reinforce the existing record instead of inserting.
          await store.touch(dupHits.slice(0, 1).map(h => h.record.id));
          result.skipped++;
          continue;
        }
        const t = new Date().toISOString();
        const rec: MemoryV2Record = {
          id: `v2_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
          type: item.type,
          content: item.text,
          subject: item.type === 'relacion' ? 'pareja' : item.type === 'preferencia' ? 'usuario' : item.type === 'hecho' ? 'usuario' : 'pareja',
          charId,
          groupId: groupId || '',
          sessionId: '',
          source: 'auto',
          importance: item.importance ?? 0.5,
          heat: 1,
          eventDate: item.date || t,
          createdAt: t,
          updatedAt: t,
          lastAccessedAt: t,
          accessCount: 0,
          linkedIds: (item.links || []).filter(l => candidateIds.has(l)),
          supersededBy: '',
          sourceMessageId,
        };
        const saved = await store.add(rec);
        result.added++;
        result.records.push(saved);
      } catch (itemErr) {
        console.warn('[MemoryV2] Failed to apply extraction item:', itemErr);
        result.skipped++;
      }
    }

    result.success = true;
    return result;
  } catch (err: any) {
    result.error = err?.message || String(err);
    console.error('[MemoryV2] Extraction failed:', result.error);
    return result;
  }
}
