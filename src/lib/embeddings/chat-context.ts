/**
 * Embeddings Knowledge Context Retrieval
 *
 * Provides utilities for retrieving relevant KNOWLEDGE embeddings
 * (lore, world info, uploaded files, backstory) during chat and injecting
 * them as context into the LLM prompt as [CONTEXTO RELEVANTE].
 *
 * NOTE (Memory V2): This module is now knowledge-only. Character memories
 * (hechos/eventos/emociones) live exclusively in the Memory V2 unified store
 * (src/lib/memory/v2) and are injected as partitioned blocks by
 * buildV2MemoryContext. Legacy memory namespaces (memory-*) and the old
 * [MEMORIA RELEVANTE] block were removed.
 *
 * Used by /api/chat/stream, /api/chat/group-stream, /api/chat/generate,
 * /api/chat/regenerate and /api/chat/proactive routes.
 */

import type { PromptSection, EmbeddingsChatSettings } from '@/types';
import { getEmbeddingClient } from './client';
import { loadConfig, getModelContextLength } from './config-persistence';
import { LanceDBWrapper } from './lancedb-db';
import type { SearchResult } from './types';
import { CHARS_PER_TOKEN } from './types';

/** Result of embeddings knowledge context retrieval */
export interface EmbeddingsContextResult {
  /** Whether any embeddings were found */
  found: boolean;
  /** Total number of embeddings retrieved */
  count: number;
  /** The raw search results for UI display */
  results: SearchResult[];
  /** Namespaces that were searched */
  searchedNamespaces: string[];

  // --- Knowledge context ---
  /** Knowledge context string (lore, world, files) — goes before chat history */
  nonMemoryContextString: string;
  /** Knowledge prompt section for prompt viewer */
  nonMemorySection: PromptSection | null;
  /** Knowledge count */
  nonMemoryCount: number;
  /** Knowledge groups by namespace type */
  nonMemoryTypeGroups: Record<string, number>;

  // --- Combined (alias of knowledge) for backward compat ---
  contextString: string;
  section: PromptSection | null;
  typeGroups: Record<string, number>;

  /** FASE 14: advanced reranking was applied */
  rerankingApplied: boolean;
}

function emptyResult(): EmbeddingsContextResult {
  return {
    found: false,
    count: 0,
    results: [],
    searchedNamespaces: [],
    nonMemoryContextString: '',
    nonMemorySection: null,
    nonMemoryCount: 0,
    nonMemoryTypeGroups: {},
    contextString: '',
    section: null,
    typeGroups: {},
    rerankingApplied: false,
  };
}

/**
 * Retrieve knowledge embeddings context for a chat message.
 *
 * Searches knowledge namespaces based on the configured strategy,
 * builds a grouped context string and returns a PromptSection.
 *
 * @param userMessage - The user's current message (used as search query)
 * @param characterId - The active character's ID (for character strategy)
 * @param sessionId - The active session's ID (reserved; knowledge is cross-session)
 * @param settings - EmbeddingsChatSettings from the store
 * @param groupId - The group ID (for group strategy)
 * @param lastAssistantMessage - For bidirectional search (optional)
 * @param mainAttributeKey - FASE 14: for importance boost on main attribute content
 * @returns EmbeddingsContextResult with the knowledge section
 */
export async function retrieveEmbeddingsContext(
  userMessage: string,
  characterId?: string,
  sessionId?: string,
  settings?: Partial<EmbeddingsChatSettings>,
  groupId?: string,
  lastAssistantMessage?: string,  // for bidirectional search
  mainAttributeKey?: string,  // FASE 14: for importance boost on main attribute content
): Promise<EmbeddingsContextResult> {
  // Knowledge search is controlled SOLELY by `knowledgeSearchEnabled` (default
  // true). Memory V2 has its own switch (memoryV2Enabled) — the two systems are
  // independent; the deprecated `enabled` master flag no longer gates anything.
  const knowledgeEnabled = settings?.knowledgeSearchEnabled !== false; // default true

  if (!knowledgeEnabled) {
    return emptyResult();
  }

  if (!userMessage.trim()) {
    return emptyResult();
  }

  try {
    const client = getEmbeddingClient();
    const config = loadConfig();

    // Determine namespaces to search based on strategy
    // Character/group embeddingNamespaces are AUGMENTED on top of the strategy namespaces,
    // not replaced. Knowledge namespaces are always searched.
    const strategyNamespaces = getNamespacesForStrategy(
      settings.namespaceStrategy || 'character',
      characterId,
      groupId,
      sessionId,
    );

    const customNamespaces = settings.customNamespaces;
    const namespaceSet = new Set(strategyNamespaces);
    if (customNamespaces && customNamespaces.length > 0) {
      for (const ns of customNamespaces) {
        namespaceSet.add(ns);
      }
    }
    const namespaces = Array.from(namespaceSet);

    if (namespaces.length === 0) {
      return emptyResult();
    }

    // Smart truncation: calculate max chars based on the embedding model's context window.
    // Use 75% of the model's context as safe budget (same as ollama-client.ts).
    // Priority: config.modelContextLength (auto-detected) > hardcoded map > default (512)
    const embeddingModel = config.model || 'bge-m3:567m';
    const modelContextTokens = getModelContextLength();
    const safeTokenBudget = Math.floor(modelContextTokens * 0.75);
    const maxSearchQueryChars = Math.floor(safeTokenBudget * CHARS_PER_TOKEN);

    const searchQuery = userMessage.length > maxSearchQueryChars
      ? userMessage.slice(0, maxSearchQueryChars)
      : userMessage;

    if (userMessage.length > maxSearchQueryChars) {
      console.warn(
        `[Embeddings] Search query truncated from ${userMessage.length} to ${maxSearchQueryChars} chars ` +
        `(model: ${embeddingModel}, context: ${modelContextTokens} tokens)`
      );
    }

    // Search each namespace (with deduplication)
    const maxResults = Math.max(1, settings.knowledgeMaxResults || config.maxResults || 5);
    const threshold = config.similarityThreshold || 0.5;
    const maxBudget = settings.maxTokenBudget || 1024;

    const seenIds = new Set<string>();
    const allResults: SearchResult[] = [];

    for (const ns of namespaces) {
      try {
        let results: SearchResult[];
        if (ns === '*') {
          results = await client.searchSimilar({
            query: searchQuery,
            limit: maxResults * 2,
            threshold,
          });
        } else {
          results = await client.searchInNamespace({
            namespace: ns,
            query: searchQuery,
            limit: maxResults,
            threshold,
          });
        }

        for (const r of results) {
          if (!seenIds.has(r.id)) {
            seenIds.add(r.id);
            allResults.push(r);
          }
        }
      } catch (err) {
        console.warn(`[Embeddings] Search failed for namespace "${ns}":`, err);
      }
    }

    // Bidirectional search: Also search with the last assistant message
    // This captures knowledge relevant to what the character was talking about,
    // even when the user's message is short or context-dependent (e.g., "Sí", "Claro")
    if (lastAssistantMessage && lastAssistantMessage.trim().length > 20) {
      // Truncate assistant query to avoid context-length errors
      let assistantQuery = lastAssistantMessage.trim();
      if (assistantQuery.length > maxSearchQueryChars) {
        assistantQuery = assistantQuery.slice(0, maxSearchQueryChars);
        console.warn(
          `[Embeddings] Assistant search query truncated to ${maxSearchQueryChars} chars`
        );
      }
      const assistantThreshold = Math.min(threshold + 0.1, 1.0);  // Cap at 1.0 to avoid disabling search
      for (const ns of namespaces) {
        try {
          let results: SearchResult[];
          if (ns === '*') {
            results = await client.searchSimilar({
              query: assistantQuery,
              limit: Math.ceil(maxResults / 2),  // Smaller limit for secondary search
              threshold: assistantThreshold,
            });
          } else {
            results = await client.searchInNamespace({
              namespace: ns,
              query: assistantQuery,
              limit: Math.ceil(maxResults / 2),
              threshold: assistantThreshold,
            });
          }

          for (const r of results) {
            if (!seenIds.has(r.id)) {
              seenIds.add(r.id);
              allResults.push(r);
            }
          }
        } catch (err) {
          console.warn(`[Embeddings] Assistant search failed for namespace "${ns}":`, err);
        }
      }
    }

    if (allResults.length === 0) {
      return emptyResult();
    }

    // FASE 14: Advanced Reranking
    // Apply temporal decay (exponential), diversity and content-level boosts.
    const rerankedResults = applyAdvancedReranking(allResults, {
      temporalBoost: settings.knowledgeHeatEnabled !== false,
      diversityBoost: true,
      importanceBoost: true,
      decayDays: settings.knowledgeDecayDays || 14,
      decayEnabled: settings.knowledgeDecayEnabled !== false,
      mainAttributeKey,  // FASE 14: boost content mentioning the main attribute
      queryText: searchQuery,  // FASE 14: for episodic vs semantic boost detection
    });

    // Replace allResults with reranked version
    allResults.length = 0;
    allResults.push(...rerankedResults);

    // Sort by final similarity score (highest first)
    allResults.sort((a, b) => b.similarity - a.similarity);

    // Filter out the LATEST summary embedding — it's injected separately as [RECUERDOS ANTERIORES]
    // to avoid duplication. OLD summaries (is_latest=false or no is_latest flag) are KEPT
    // so they can be found via semantic search for long-term recall.
    // Filter BEFORE slicing so we don't lose non-summary results that rank just below summaries.
    const nonLatestSummaryResults = allResults.filter(r => {
      if (r.source_type !== 'summary') return true; // Keep all non-summary results
      // For summary-type: only keep if it's NOT the latest one
      const isLatest = (r.metadata as Record<string, any>)?.is_latest;
      return !isLatest; // Exclude latest summary (injected directly), keep old ones
    });

    // Content-level dedup: the same chunk may exist in multiple namespaces.
    const seenContents = new Set<string>();
    const dedupedResults = nonLatestSummaryResults.filter(r => {
      const key = r.content.toLowerCase().replace(/\s+/g, ' ').trim();
      if (seenContents.has(key)) return false;
      seenContents.add(key);
      return true;
    });
    let trimmed = dedupedResults.slice(0, maxResults);

    // If we hit the max results limit, prefer higher importance content
    if (trimmed.length >= maxResults) {
      // Sort by importance (desc) as tiebreaker, then similarity
      trimmed.sort((a, b) => {
        const impA = (a.metadata as Record<string, any>)?.importance || 3;
        const impB = (b.metadata as Record<string, any>)?.importance || 3;
        if (impB !== impA) return impB - impA;
        return b.similarity - a.similarity;
      });
      trimmed = trimmed.slice(0, maxResults);
    }

    // Load namespace info to get types for grouping
    const namespaceTypes = await getNamespaceTypesMap(trimmed);

    // All results are knowledge (lore, world info, uploaded files, old summaries)
    const knowledgeResults = trimmed;
    const knowledgeBudget = maxBudget;

    // Build grouped context string for knowledge
    const knowledge = buildGroupedContextString(knowledgeResults, namespaceTypes, knowledgeBudget, 'CONTEXTO RELEVANTE');

    if (!knowledge.contextString.trim()) {
      return emptyResult();
    }

    const showInViewer = settings.showInPromptViewer !== false;

    // Build PromptSection
    const knowledgeSection: PromptSection | null = knowledge.contextString.trim()
      ? {
          type: 'context',
          label: 'CONTEXTO',
          content: knowledge.contextString,
          color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
        }
      : null;

    return {
      found: true,
      count: trimmed.length,
      results: trimmed,
      searchedNamespaces: namespaces,

      // Knowledge
      nonMemoryContextString: knowledge.contextString,
      nonMemorySection: showInViewer ? knowledgeSection : null,
      nonMemoryCount: knowledgeResults.length,
      nonMemoryTypeGroups: knowledge.typeGroups,

      // Combined (alias of knowledge) for backward compat
      contextString: knowledge.contextString,
      section: showInViewer ? knowledgeSection : null,
      typeGroups: knowledge.typeGroups,

      // FASE 14: reranking flag
      rerankingApplied: true,
    };
  } catch (error) {
    console.error('[Embeddings] Context retrieval failed:', error);
    return emptyResult();
  }
}

/**
 * Build a map of namespace name → type string by loading all namespaces from DB.
 */
async function getNamespaceTypesMap(results: SearchResult[]): Promise<Record<string, string>> {
  try {
    const allNamespaces = await LanceDBWrapper.getAllNamespaces();
    const typeMap: Record<string, string> = {};

    const uniqueNamespaces = new Set<string>();
    for (const r of results) {
      if (r.namespace) uniqueNamespaces.add(r.namespace);
    }

    for (const ns of allNamespaces) {
      if (uniqueNamespaces.has(ns.namespace)) {
        const type = (ns.metadata as Record<string, any>)?.type;
        if (type && typeof type === 'string' && type.trim()) {
          typeMap[ns.namespace] = type.trim().toUpperCase();
        }
      }
    }

    return typeMap;
  } catch (err) {
    console.warn('[Embeddings] Could not load namespace types for grouping:', err);
    return {};
  }
}

/**
 * Determine which knowledge namespaces to search based on the configured strategy.
 *
 * Always includes:
 *   - character-{characterId} (character lore/knowledge/backstory files)
 *   - group-{groupId} (group lore, when in a group)
 *   - memory-character-{characterId}[-{sessionId}] and memory-group-{groupId}[-{sessionId}]
 *     (indexed OLD summaries — the latest one is injected directly as [RECUERDOS ANTERIORES]
 *     and excluded from search via the is_latest filter; old ones are only reachable here)
 *
 * Plus any namespaces configured in the character/group card's embeddingNamespaces.
 * The character/group embeddingNamespaces are passed via settings.customNamespaces
 * and merged by the calling code in retrieveEmbeddingsContext().
 */
function getNamespacesForStrategy(
  strategy: EmbeddingsChatSettings['namespaceStrategy'],
  characterId?: string,
  groupId?: string,
  sessionId?: string,
): string[] {
  switch (strategy) {
    case 'global':
      return ['*'];

    case 'character':
    case 'session': {
      const ns: string[] = [];

      // Character/group knowledge namespace (lore, uploaded files, backstory)
      if (characterId) ns.push(`character-${characterId}`);
      if (groupId) ns.push(`group-${groupId}`);
      // Indexed summaries of this scope (per-session + cross-session).
      // Searching a missing namespace simply returns no results — harmless.
      if (characterId) {
        if (sessionId) ns.push(`memory-character-${characterId}-${sessionId}`);
        ns.push(`memory-character-${characterId}`);
      }
      if (groupId) {
        if (sessionId) ns.push(`memory-group-${groupId}-${sessionId}`);
        ns.push(`memory-group-${groupId}`);
      }
      // NO hardcoded 'default', 'world', 'world-building' — only search what's configured.
      // Character/group card namespaces are passed via settings.customNamespaces and merged
      // by the calling code in retrieveEmbeddingsContext().
      return ns;
    }

    default:
      return ['*'];
  }
}

/**
 * Build a grouped context string from search results.
 * Results are grouped by their namespace type (if available).
 *
 * @param header - The main header label (e.g. 'CONTEXTO RELEVANTE')
 */
function buildGroupedContextString(
  results: SearchResult[],
  namespaceTypes: Record<string, string>,
  maxTokenBudget: number,
  header: string
): { contextString: string; typeGroups: Record<string, number> } {
  // FASE 16 FIX: Use CHARS_PER_TOKEN (3.5) instead of hardcoded 4.
  // This was causing ~14% more content than the budget represented.
  const maxChars = Math.floor(maxTokenBudget * CHARS_PER_TOKEN);

  // Group results by type
  const groups = new Map<string, SearchResult[]>();
  const ungrouped: SearchResult[] = [];

  for (const result of results) {
    const type = namespaceTypes[result.namespace];
    if (type) {
      if (!groups.has(type)) {
        groups.set(type, []);
      }
      groups.get(type)!.push(result);
    } else {
      ungrouped.push(result);
    }
  }

  const typeGroups: Record<string, number> = {};
  const parts: string[] = [];
  let totalChars = 0;

  // Main header
  const headerLine = `[${header}]`;
  parts.push(headerLine);
  totalChars += headerLine.length + 2;

  // Add each typed group
  for (const [type, typeResults] of groups) {
    const groupHeader = `[${type}]`;
    const headerLen = groupHeader.length + 2;
    const entries: string[] = [];

    let groupChars = 0;
    for (const result of typeResults) {
      const entry = `- ${result.content}`;
      if (totalChars + headerLen + groupChars + entry.length + 2 > maxChars) {
        break;
      }
      entries.push(entry);
      groupChars += entry.length + 2;
    }

    if (entries.length > 0) {
      parts.push(`${groupHeader}\n${entries.join('\n')}`);
      totalChars += headerLen + groupChars;
      typeGroups[type] = entries.length;
    }
  }

  // Add ungrouped results
  if (ungrouped.length > 0) {
    const entries: string[] = [];
    for (const result of ungrouped) {
      const entry = `- ${result.content}`;
      if (totalChars + entry.length + 2 > maxChars) {
        break;
      }
      entries.push(entry);
      totalChars += entry.length + 2;
    }

    if (entries.length > 0) {
      if (groups.size > 0) {
        const groupHeader = '[OTRO CONTEXTO]';
        parts.push(`${groupHeader}\n${entries.join('\n')}`);
        totalChars += groupHeader.length + 2;
        typeGroups['OTRO CONTEXTO'] = entries.length;
      } else {
        // No types — simple list (no sub-header needed, main header already exists)
        parts.push(entries.join('\n'));
        typeGroups['SIN TIPO'] = entries.length;
      }
    }
  }

  if (parts.length <= 1) return { contextString: '', typeGroups: {} };

  return {
    contextString: parts.join('\n\n'),
    typeGroups,
  };
}

// ============================================
// FASE 14: Advanced Reranking (VoiceMem-inspired)
// ============================================

interface RerankingOptions {
  /** Boost recent content with exponential decay */
  temporalBoost: boolean;
  /** Penalize similar/duplicate content */
  diversityBoost: boolean;
  /** Boost high-importance content */
  importanceBoost: boolean;
  /** Decay period in days (for temporal boost) */
  decayDays: number;
  /** Whether decay is enabled */
  decayEnabled: boolean;
  /** FASE 14: Main attribute key — content mentioning it gets boosted */
  mainAttributeKey?: string;
  /** FASE 14: Original query text — for episodic vs semantic boost detection */
  queryText?: string;
}

/**
 * Apply advanced reranking to search results.
 *
 * Inspired by VoiceMem's approach:
 * - Temporal decay: exponential decay based on age (half-life = decayDays/2)
 * - Importance boost: +0.05 per importance level above 3
 * - Diversity: penalize results with >40% word overlap with already-selected results
 * - Main attribute boost: +0.05 for content mentioning the character's main attribute
 *
 * This runs AFTER the initial cosine search, re-scoring and re-sorting results.
 */
function applyAdvancedReranking(results: SearchResult[], options: RerankingOptions): SearchResult[] {
  if (results.length === 0) return results;

  const now = Date.now();
  const dayMs = 1000 * 60 * 60 * 24;
  const halfLifeDays = Math.max(1, options.decayDays / 2);

  // Score each result with a composite score
  const scored = results.map(r => {
    let compositeScore = r.similarity;
    const contentLower = r.content.toLowerCase();

    // 1. Temporal decay (exponential) — recent content gets boosted, old decayed
    if (options.temporalBoost && options.decayEnabled) {
      const createdAt = new Date((r.metadata as Record<string, any>)?.created_at || r.metadata?.extracted_at || 0).getTime();
      if (createdAt > 0) {
        const daysOld = (now - createdAt) / dayMs;
        // Exponential decay: value halves every `halfLifeDays` days
        // temporalFactor = 1.0 (today) → 0.5 (halfLife) → 0.25 (2x halfLife) → ...
        const temporalFactor = Math.pow(0.5, daysOld / halfLifeDays);
        // Apply: 70% original similarity + 30% temporal factor
        compositeScore = r.similarity * 0.7 + (r.similarity * temporalFactor) * 0.3;
      }
    }

    // 2. Importance boost
    if (options.importanceBoost) {
      const importance = (r.metadata as Record<string, any>)?.importance || 3;
      // +0.05 per importance level above 3, -0.03 per level below
      const importanceBoost = (importance - 3) * 0.05;
      compositeScore += importanceBoost;
    }

    // 3. Content heat boost (if metadata has heat/retrieval_count)
    const heat = (r.metadata as Record<string, any>)?.heat || 0;
    if (heat > 0) {
      // Each retrieval boosts score slightly (max +0.05)
      compositeScore += Math.min(0.05, heat * 0.01);
    }

    // 4. Recency boost (subtle — content from today gets +0.05)
    const createdAt = new Date((r.metadata as Record<string, any>)?.created_at || 0).getTime();
    if (createdAt > 0) {
      const daysOld = (now - createdAt) / dayMs;
      if (daysOld < 1) compositeScore += 0.05; // today
      else if (daysOld < 3) compositeScore += 0.03; // this week
    }

    // 5. FASE 14: Main attribute boost — content mentioning the character's main attribute
    // (e.g., "adiccion" for Ximena) is more central to the character's identity.
    if (options.mainAttributeKey && contentLower.includes(options.mainAttributeKey.toLowerCase())) {
      compositeScore += 0.05;
    }

    // 6. FASE 14: Episodic vs Semantic boost
    // - Episodic content (specific events) gets boosted when the query asks "what happened" / "cuando" / "ayer"
    // - Semantic content (general facts) gets boosted when the query asks "what is" / "le gusta" / "es"
    const isEpisodic = (r.metadata as Record<string, any>)?.episodica === true;
    const queryLower = (options.queryText || '').toLowerCase();
    if (isEpisodic) {
      // Boost episodic content for temporal/event queries
      if (/\b(cuando|ayer|anoche|la semana pasada|hoy|el otro dia|pasado|ocurrio|paso|sucedio|que hizo|que dij|que pas)\b/.test(queryLower)) {
        compositeScore += 0.05;
      }
    } else {
      // Boost semantic content for general-knowledge queries
      if (/\b(le gusta|le interesa|es|tiene|sabe|conoce|prefiere|quiere|odia|leer|disfruta)\b/.test(queryLower)) {
        compositeScore += 0.03;
      }
    }

    return { result: r, score: Math.max(0, Math.min(1.0, compositeScore)) };
  });

  // Sort by composite score
  scored.sort((a, b) => b.score - a.score);

  // Apply diversity boost: penalize similar content
  if (options.diversityBoost) {
    const selected: Array<{ result: SearchResult; score: number }> = [];
    const selectedWordSets: Array<Set<string>> = [];

    for (const item of scored) {
      // Create content signature (words > 3 chars)
      const words = item.result.content
        .toLowerCase()
        .split(/\s+/)
        .filter(w => w.length > 3);
      const wordSet = new Set(words);

      // Calculate diversity penalty based on overlap with already-selected results
      let diversityPenalty = 0;
      for (const selectedWords of selectedWordSets) {
        const overlap = Array.from(wordSet).filter(w => selectedWords.has(w)).length;
        const overlapRatio = overlap / Math.max(wordSet.size, selectedWords.size);
        if (overlapRatio > 0.4) {
          // Heavy penalty for >40% overlap
          diversityPenalty += overlapRatio * 0.15;
        }
      }

      const finalScore = item.score - diversityPenalty;

      selected.push({ result: { ...item.result, similarity: finalScore }, score: finalScore });
      selectedWordSets.push(wordSet);
    }

    return selected.map(s => s.result).sort((a, b) => b.similarity - a.similarity);
  }

  // No diversity boost: just return sorted by score
  return scored.map(s => ({ ...s.result, similarity: s.score }));
}

/**
 * Extract embeddings metadata from a context result for SSE transmission.
 */
export function formatEmbeddingsForSSE(result: EmbeddingsContextResult): {
  count: number;
  namespaces: string[];
  nonMemoryCount: number;
  nonMemoryTypeGroups: Record<string, number>;
  topResults: Array<{
    content: string;
    similarity: number;
    namespace: string;
    source_type?: string;
  }>;
} | null {
  if (!result.found) return null;

  return {
    count: result.count,
    namespaces: result.searchedNamespaces,
    nonMemoryCount: result.nonMemoryCount,
    nonMemoryTypeGroups: result.nonMemoryTypeGroups,
    topResults: result.results.slice(0, 5).map(r => ({
      content: r.content.slice(0, 200),
      similarity: r.similarity,
      namespace: r.namespace,
      source_type: r.source_type,
    })),
  };
}
