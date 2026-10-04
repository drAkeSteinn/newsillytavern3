// ============================================
// Pre-LLM Handlers - All handler exports
// ============================================

// Lorebook Handler
export {
  lorebookHandler,
  extractLorebookContent,
  hasActiveLorebooks
} from './lorebook-handler';

// NOTE (Memory V2): the legacy memory handler was removed.
// Character memories live exclusively in the Memory V2 unified store
// (src/lib/memory/v2) and are injected by buildV2MemoryContext.
