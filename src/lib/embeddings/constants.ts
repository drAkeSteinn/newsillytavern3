/**
 * Shared default settings for embeddings chat integration.
 * Single source of truth — used by MemorySettingsPanel, EmbeddingsSettingsPanel, and store defaults.
 */
export const DEFAULT_EMBEDDINGS_CHAT = {
  /** @deprecated Legacy master switch from the "Embeddings" era. No longer gates
   * anything: Memory V2 follows `memoryV2Enabled` and knowledge follows
   * `knowledgeSearchEnabled`. Kept only for persisted-settings compatibility. */
  enabled: false,
  // FASE 16: Knowledge search is SEPARATE from memory extraction.
  // When enabled, the system searches character-{charId} namespace for
  // uploaded knowledge/backhistory, even if memory extraction is disabled.
  // This lets users upload knowledge files and have them work without
  // enabling the full memory extraction pipeline.
  knowledgeSearchEnabled: true,
  maxTokenBudget: 1024,
  // Max knowledge chunks retrieved per search
  knowledgeMaxResults: 5,
  namespaceStrategy: 'character' as const,
  showInPromptViewer: true,
  // Memory V2 extraction settings
  memoryExtractionEnabled: false,
  memoryExtractionFrequency: 5,
  memoryExtractionMinImportance: 2,
  // Context depth for memory extraction (0 = only last response, N = include N recent messages)
  memoryExtractionContextDepth: 2,
  // Context depth for embedding search query (0 = only user message, N = include N recent messages)
  searchContextDepth: 2,
  // Separate extraction model
  extractionModelEnabled: false,
  extractionModelProvider: 'ollama',
  extractionModelEndpoint: 'http://localhost:11434',
  extractionModelApiKey: '',
  extractionModelName: 'llama3.1:8b',
  // FASE 14: Cross-session memory — when enabled, memories persist across sessions
  // (character remembers interactions with user/other characters between sessions).
  // When disabled, memories are isolated per-session (legacy behavior).
  crossSessionMemory: true,
  // Knowledge rerank (FASE 14): temporal decay — knowledge chunks older than
  // decayDays score lower in the knowledge reranker. These are rerank parameters
  // for the KNOWLEDGE pipeline ([CONTEXTO RELEVANTE]), NOT for Memory V2 (which
  // has its own heat/importance in the memories_v2 store).
  knowledgeDecayEnabled: true,
  knowledgeDecayDays: 14, // Standard: 2 weeks
  // Knowledge rerank (FASE 14): recently-retrieved knowledge gets a heat boost.
  knowledgeHeatEnabled: true,
  // Memory V2: unified memory system (single store, merged extraction with
  // ADD/UPDATE/DELETE ops, partitioned injection). Default ON.
  // SINGLE master switch of the memory pipeline (extraction + injection + tools).
  memoryV2Enabled: true,
};

/**
 * Settings renamed in the Memory/Knowledge audit (memory* → knowledge*):
 * these fields only ever affected the KNOWLEDGE retrieval pipeline, but their
 * old names made them look like memory settings.
 *
 * Orphan fields from the REMOVED legacy memory pipeline (consolidation,
 * reinforcement, custom extraction prompts, group dynamics). Nothing reads
 * them anymore — they are deleted on load.
 */
const KNOWLEDGE_KEY_RENAMES: Array<[oldKey: string, newKey: string]> = [
  ['memoryMaxResults', 'knowledgeMaxResults'],
  ['memoryDecayEnabled', 'knowledgeDecayEnabled'],
  ['memoryDecayDays', 'knowledgeDecayDays'],
  ['memoryHeatEnabled', 'knowledgeHeatEnabled'],
];

const ORPHAN_LEGACY_KEYS = [
  // Legacy consolidation pipeline (deleted)
  'memoryConsolidationEnabled',
  'memoryConsolidationThreshold',
  'memoryConsolidationKeepRecent',
  'memoryConsolidationKeepHighImportance',
  // Legacy custom extraction prompts (deleted; extraction is V2-only)
  'memoryExtractionPrompt',
  'groupMemoryExtractionPrompt',
  // Legacy reinforcement pipeline (deleted)
  'memoryReinforcementEnabled',
  'memoryReinforcementThreshold',
  // Legacy group-dynamics extraction (deleted)
  'groupDynamicsExtraction',
  // Legacy user-side extraction (deleted)
  'memoryExtractionFromUserEnabled',
  // Legacy prompt injection cap (deleted)
  'memoryMaxEventsInPrompt',
];

/**
 * Migrates a persisted `embeddingsChat` object:
 * 1. Renames knowledge params (memory* → knowledge*) preserving values.
 * 2. Drops orphan fields of the removed legacy memory pipeline.
 *
 * Idempotent — safe to run on every hydration. Applied in BOTH hydration
 * points (server settings.json via persistence.migrateSettings and client
 * localStorage via the zustand persist merge).
 */
export function migrateEmbeddingsChatLegacyKeys<T extends Record<string, unknown>>(
  embeddingsChat: T | undefined | null,
): T {
  if (!embeddingsChat || typeof embeddingsChat !== 'object') return embeddingsChat as T;
  const out = { ...embeddingsChat } as Record<string, unknown>;
  for (const [oldKey, newKey] of KNOWLEDGE_KEY_RENAMES) {
    if (out[oldKey] !== undefined && out[newKey] === undefined) {
      out[newKey] = out[oldKey];
    }
    // Old keys are dropped once migrated (values live on under the new name).
    delete out[oldKey];
  }
  for (const orphanKey of ORPHAN_LEGACY_KEYS) {
    delete out[orphanKey];
  }
  return out as T;
}
