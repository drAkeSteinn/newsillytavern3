/**
 * Memory Extraction LLM Config Helper
 *
 * NOTE (Memory V2): the legacy fact-extraction pipeline (extractMemories /
 * saveMemoriesAsEmbeddings / extractGroupDynamics) was removed when Memory V2
 * became the only memory system. This module now only builds the LLM config
 * used by the V2 merged extraction pass.
 */

import type { LLMConfig } from '@/lib/llm/types';

// ============================================
// Extraction Model Config Helper
// ============================================

/** Fields from embeddingsChat settings for extraction model */
export interface ExtractionModelConfig {
  extractionModelEnabled?: boolean;
  extractionModelProvider?: string;
  extractionModelEndpoint?: string;
  extractionModelApiKey?: string;
  extractionModelName?: string;
}

/**
 * Memory types accepted by the memory tools (Spanish, LLM-facing).
 * Mirrors MemoryRecordType from the V2 store (plus legacy aliases).
 */
export type MemoryType = 'hecho' | 'evento' | 'relacion' | 'preferencia' | 'secreto' | 'otro';

/**
 * Build an LLMConfig for memory extraction, using a separate extraction model
 * if configured, otherwise falling back to the chat model's config.
 *
 * @param chatLlmConfig - The chat model's LLM config (fallback)
 * @param extractionConfig - Extraction model settings from embeddingsChat
 * @returns LLMConfig to use for extraction
 */
export function buildExtractionLlmConfig(
  chatLlmConfig: LLMConfig,
  extractionConfig?: ExtractionModelConfig,
): LLMConfig {
  if (!extractionConfig?.extractionModelEnabled) {
    return chatLlmConfig;
  }

  const provider = extractionConfig.extractionModelProvider || 'ollama';
  const endpoint = extractionConfig.extractionModelEndpoint || '';
  const apiKey = extractionConfig.extractionModelApiKey || '';
  const model = extractionConfig.extractionModelName || 'llama3.1:8b';

  // Build extraction LLM config with same parameter structure but different model
  return {
    ...chatLlmConfig,
    id: `extraction-${provider}`,
    name: `Extraction: ${model}`,
    provider: provider as LLMConfig['provider'],
    endpoint,
    apiKey: apiKey || undefined,
    model,
    parameters: {
      ...chatLlmConfig.parameters,
      temperature: 0.1,  // Low temperature for consistent extraction
      maxTokens: 512,    // Enough for JSON array output
    },
  };
}
