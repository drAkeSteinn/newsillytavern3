/**
 * Memory V2 — Partitioned prompt injection (VoiceMem-style).
 *
 * Replaces the undifferentiated [MEMORIA RELEVANTE] blob AND the legacy
 * CharacterMemory section. Curated records are ALWAYS injected (no
 * suppression rule); automatic records are ranked alongside them.
 *
 * Blocks (each with an "as of" timestamp and usage instructions):
 *   [HECHOS SOBRE {user}]   → hecho, preferencia, nota
 *   [EVENTOS ANTERIORES]    → evento, resumen_escena (with absolute dates)
 *   [ESTADO DE LA RELACIÓN] → relacion
 */

import { getV2 } from './store';
import { searchMemoriesV2 } from './retrieval';
import type { MemoryV2Record, V2ContextStats } from './types';

const CHARS_PER_TOKEN = 3.5;

function fmtDateShort(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function todayLabel(): string {
  return fmtDateShort(new Date().toISOString());
}

function trimLinesToBudget(lines: { text: string; score: number }[], budgetChars: number): { kept: string[]; omitted: number } {
  const kept: string[] = [];
  let used = 0;
  let omitted = 0;
  for (const line of lines) {
    const len = line.text.length + 1;
    if (used + len > budgetChars) {
      omitted++;
      continue;
    }
    kept.push(line.text);
    used += len;
  }
  return { kept, omitted };
}

export interface V2InjectionParams {
  charId: string;
  charName: string;
  userName: string;
  sessionId?: string;
  groupId?: string;
  crossSession?: boolean;
  /** Search query (usually the enriched user message) */
  query: string;
  /** Token budget for the whole memory context (default 1024 tokens) */
  maxTokenBudget?: number;
  /** Max records per block */
  maxPerBlock?: number;
}

export interface V2InjectionResult {
  context: string;
  stats: V2ContextStats;
}

/**
 * Build the partitioned memory context for a character.
 * Auto-migrates legacy CharacterMemory/namespace data on first use per char.
 */
export async function buildV2MemoryContext(params: V2InjectionParams): Promise<V2InjectionResult> {
  const {
    charId, charName, userName, sessionId = '', groupId = '', crossSession = true,
    query = '', maxTokenBudget = 1024, maxPerBlock = 8,
  } = params;

  const stats: V2ContextStats = {
    backend: 'json', considered: 0, injected: 0, curatedInjected: 0,
    blocks: [], migratedNow: false,
  };

  try {
    const store = await getV2();
    stats.backend = store.backend;
    stats.migratedNow = store.migratedNow;

    // ---- Auto-migration (first use per character) ----
    const counts = await store.counts(charId);
    if (counts.total === 0) {
      try {
        const { migrateLegacyForCharacter } = await import('./migration');
        const mig = await migrateLegacyForCharacter(charId, groupId || undefined);
        stats.migratedNow = stats.migratedNow || mig.migrated > 0;
        if (mig.migrated > 0) {
          console.log(`[MemoryV2] Auto-migrated ${mig.migrated} legacy records for ${charName}`);
        }
      } catch (migErr) {
        console.warn('[MemoryV2] Auto-migration failed (non-blocking):', migErr);
      }
    }

    // ---- Curated: ALWAYS injected (no suppression) ----
    const curated = await store.list({
      charId,
      groupId: groupId || undefined,
      sessionId,
      crossSession,
      activeOnly: true,
      curatedOnly: true,
      limit: 40,
      orderBy: 'smart',
    });

    // ---- Automatic: vector search + rerank ----
    let searched: import('./types').ScoredMemory[] = [];
    if (query.trim()) {
      searched = await searchMemoriesV2({
        query,
        charId,
        sessionId,
        groupId: groupId || undefined,
        crossSession,
        limit: 12,
      });
    }

    // Merge (dedupe by id) — searched first (relevance), curated appended.
    const pool = new Map<string, import('./types').ScoredMemory | MemoryV2Record>();
    for (const rec of searched) pool.set(rec.id, rec);
    for (const rec of curated) if (!pool.has(rec.id)) pool.set(rec.id, rec);
    const all = Array.from(pool.values());
    stats.considered = all.length;
    const curatedIds = new Set(curated.map(c => c.id));

    // Budget: maxTokenBudget tokens → chars; blocks split 35/45/20.
    const budgetChars = Math.max(600, Math.floor(maxTokenBudget * CHARS_PER_TOKEN));
    const budgets = {
      hechos: Math.floor(budgetChars * 0.35),
      eventos: Math.floor(budgetChars * 0.45),
      relacion: Math.floor(budgetChars * 0.20),
    };

    const scoreOf = (r: MemoryV2Record): number => {
      const s = (r as import('./types').ScoredMemory).score;
      return typeof s === 'number' ? s : r.importance;
    };

    const sections: string[] = [];
    const today = todayLabel();

    // ---- Block 1: HECHOS ----
    const hechos = all.filter(r => ['hecho', 'preferencia', 'nota'].includes(r.type));
    if (hechos.length) {
      const lines = hechos
        .sort((a, b) => scoreOf(b) - scoreOf(a))
        .slice(0, maxPerBlock)
        .map(r => ({ text: `- ${r.content}`, score: scoreOf(r) }));
      const { kept } = trimLinesToBudget(lines, budgets.hechos);
      if (kept.length) {
        sections.push(
          `[HECHOS SOBRE ${userName}]\n(actualizado: ${today})\n${kept.join('\n')}\n` +
          `Instrucciones: estos datos son CANÓNICOS. Dalos por sabidos: no los contradigas, no los preguntes de nuevo y úsalos con naturalidad.`
        );
        stats.injected += kept.length;
      }
    }

    // ---- Block 2: EVENTOS ----
    const eventos = all.filter(r => ['evento', 'resumen_escena'].includes(r.type));
    if (eventos.length) {
      const lines = eventos
        .sort((a, b) => scoreOf(b) - scoreOf(a))
        .slice(0, maxPerBlock)
        .map(r => {
          const date = fmtDateShort(r.eventDate || r.createdAt);
          return { text: `- ${date ? `${date} — ` : ''}${r.content}`, score: scoreOf(r) };
        });
      const { kept } = trimLinesToBudget(lines, budgets.eventos);
      if (kept.length) {
        sections.push(
          `[EVENTOS ANTERIORES]\n(registrados hasta: ${today})\n${kept.join('\n')}\n` +
          `Instrucciones: son recuerdos reales de interacciones anteriores con ${userName}. Referéncialos con naturalidad cuando encajen, sin recontarlos textualmente. Si algo NO está listado, actúa como NO lo recuerdas — nunca lo inventes.`
        );
        stats.injected += kept.length;
      }
    }

    // ---- Block 3: RELACIÓN ----
    const relacion = all.filter(r => r.type === 'relacion');
    if (relacion.length) {
      const lines = relacion
        .sort((a, b) => scoreOf(b) - scoreOf(a))
        .slice(0, Math.min(6, maxPerBlock))
        .map(r => ({ text: `- ${r.content}`, score: scoreOf(r) }));
      const { kept } = trimLinesToBudget(lines, budgets.relacion);
      if (kept.length) {
        sections.push(
          `[ESTADO DE LA RELACIÓN]\n(actualizado: ${today})\n${kept.join('\n')}\n` +
          `Instrucciones: refleja este estado en la actitud y el tono de ${charName}. Hazlo evolucionar de forma gradual y coherente con lo que ocurra, sin saltos bruscos.`
        );
        stats.injected += kept.length;
      }
    }

    stats.curatedInjected = all.filter(r => curatedIds.has(r.id)).length;
    stats.blocks = sections.map(s => s.split('\n')[0]);

    // Fire-and-forget heat bump on injected records
    const touched = all.slice(0, 12).map(r => r.id);
    if (touched.length) {
      store.touch(touched).catch(() => { /* non-blocking */ });
    }

    const context = sections.join('\n\n');
    return { context, stats };
  } catch (err: any) {
    console.error('[MemoryV2] buildV2MemoryContext failed:', err);
    return { context: '', stats };
  }
}
