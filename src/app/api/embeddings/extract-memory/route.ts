import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/embeddings/extract-memory
 *
 * Memory V2 — the ONLY memory extraction pipeline.
 *
 * Performs a single merged extraction pass over the recent exchange window
 * (user + assistant together) against the unified V2 store with
 * ADD/UPDATE/DELETE ops, absolute dates and linked memories.
 *
 * Supports a separate extraction model: if `extractionModelConfig` is
 * provided with `extractionModelEnabled: true`, the extraction will use
 * that model instead of the chat model.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      lastMessage,
      characterName,
      characterId,
      sessionId,
      groupId,
      llmConfig,
      minImportance = 2,
      userName,
      extractionModelConfig, // Separate extraction model config
      lastUserMessage,  // The last user message content (fallback if no recentMessages)
      recentMessages,   // Recent exchange window [{role, content}]
    } = body;

    if (!lastMessage || !characterName || !characterId) {
      return NextResponse.json({ error: 'Missing required fields: lastMessage, characterName, characterId' }, { status: 400 });
    }

    const { extractAndSaveV2 } = await import('@/lib/memory/v2');
    const { buildExtractionLlmConfig } = await import('@/lib/embeddings/memory-extraction');
    const extractionLlmConfig = buildExtractionLlmConfig(llmConfig, extractionModelConfig);

    if (extractionModelConfig?.extractionModelEnabled) {
      console.log(`[extract-memory] Using separate extraction model: ${extractionModelConfig.extractionModelProvider}/${extractionModelConfig.extractionModelName}`);
    }

    // Build the transcript from the recent window (fallback: last two turns).
    // Cap 12 = max client window ("Profundidad de contexto" 5 → 5*2+1 = 11) + headroom.
    const parts: string[] = [];
    if (Array.isArray(recentMessages) && recentMessages.length > 0) {
      for (const m of recentMessages.slice(-12)) {
        if (!m?.content?.trim()) continue;
        const who = m.role === 'user' ? (userName || 'Usuario') : characterName;
        parts.push(`${who}: ${m.content}`);
      }
    }
    if (parts.length === 0) {
      if (lastUserMessage?.trim()) parts.push(`${userName || 'Usuario'}: ${lastUserMessage}`);
      parts.push(`${characterName}: ${lastMessage}`);
    }
    const transcript = parts.join('\n\n').slice(-6000);

    const v2Result = await extractAndSaveV2({
      transcript,
      charId: characterId,
      charName: characterName,
      userName,
      sessionId: sessionId || '',
      groupId: groupId || '',
      llmConfig: extractionLlmConfig,
      minImportance,
    });

    return NextResponse.json({
      success: v2Result.success,
      v2: true,
      backend: v2Result.backend,
      count: v2Result.added + v2Result.updated,
      added: v2Result.added,
      updated: v2Result.updated,
      deleted: v2Result.deleted,
      skipped: v2Result.skipped,
      records: v2Result.records,
      embeddingIds: v2Result.records.map(r => r.id),
      namespace: `memories_v2:${characterId}`,
      error: v2Result.error,
    });
  } catch (error: any) {
    console.error('[extract-memory] Error:', error);
    return NextResponse.json({ success: false, error: error.message || 'Memory extraction failed' }, { status: 500 });
  }
}
