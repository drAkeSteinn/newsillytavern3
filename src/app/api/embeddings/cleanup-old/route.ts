// ============================================
// Memory Cleanup API Route (FASE 14)
// ============================================
// POST /api/embeddings/cleanup-old
//
// Runs the memory decay cleanup — NO LLM calls, pure DB operations.
// Deletes memories older than decayDays from LanceDB and cleans old
// event log entries from sessions.json.
//
// Body:
//   { decayDays?: number, decayEnabled?: boolean, cleanEventLog?: boolean }
//
// Returns:
//   { success: true, result: CleanupResult }

import { NextRequest, NextResponse } from 'next/server';
import { cleanupOldMemories, DEFAULT_DECAY_CONFIG, type MemoryDecayConfig } from '@/lib/embeddings/decay';

export const runtime = 'nodejs';
export const maxDuration = 120; // 2 minutes — cleanup can take a while for large DBs

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const config: MemoryDecayConfig = {
      ...DEFAULT_DECAY_CONFIG,
      ...body,
      decayDays: typeof body.decayDays === 'number' ? body.decayDays : DEFAULT_DECAY_CONFIG.decayDays,
      decayEnabled: body.decayEnabled !== false,
      cleanEventLog: body.cleanEventLog !== false,
    };

    if (config.decayDays < 1 || config.decayDays > 365) {
      return NextResponse.json(
        { success: false, error: 'decayDays must be between 1 and 365' },
        { status: 400 }
      );
    }

    console.log(`[CleanupOld] Starting cleanup with config:`, config);
    const result = await cleanupOldMemories(config);

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error) {
    console.error('[CleanupOld] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Cleanup failed',
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const decayDays = parseInt(searchParams.get('decayDays') || '14', 10);

    const { getDecayPreview } = await import('@/lib/embeddings/decay');
    const { DEFAULT_DECAY_CONFIG } = await import('@/lib/embeddings/decay');

    const preview = await getDecayPreview({
      ...DEFAULT_DECAY_CONFIG,
      decayDays,
    });

    return NextResponse.json({
      success: true,
      preview,
    });
  } catch (error) {
    console.error('[CleanupOld Preview] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Preview failed',
      },
      { status: 500 }
    );
  }
}
