/**
 * Memory V2 — Public API.
 *
 * Unified memory system: one store, merged extraction, partitioned injection.
 * See ./types.ts for the data model and ./store.ts for the storage layer.
 */

export * from './types';
export { getV2, resetV2, v2Health, readV2Meta, sanitizeContent, normalizeEventDate, tokenize, stemLite, tokenizeStem } from './store';
export type { V2Store } from './store';
export { extractAndSaveV2, parseExtractionOutput } from './extraction';
export { timeExpandQuery, searchMemoriesV2, rerankMemories } from './retrieval';
export { buildV2MemoryContext } from './injection';
export { migrateLegacyToV2, migrateLegacyForCharacter } from './migration';

import type { EmbeddingsChatSettings } from '@/types';

/**
 * Memory V2 is the ONLY memory system. This master switch (memoryV2Enabled)
 * turns semantic memory injection/extraction on/off; knowledge retrieval
 * (knowledgeSearchEnabled) and summaries are independent.
 */
export function isMemoryV2Enabled(settings?: EmbeddingsChatSettings | null): boolean {
  return settings?.memoryV2Enabled !== false;
}
