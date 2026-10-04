import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Memory V2 — unified memory API.
 *
 * GET  ?action=health                       → store health (backend, model, counts, ollama)
 * GET  ?action=records&charId=...           → active records for a character (grouped by type)
 *                                      [&includeArchived=1]  → also return superseded records
 * GET  ?action=search&charId=...&query=...  → debug search with reranking
 *
 * POST { action }:
 *   add        { charId, type, content, importance?, eventDate?, groupId? } → manual (curada) record
 *   edit       { id, content, type?, importance?, eventDate?, subject? }    → in-place user edit (re-embeds)
 *   supersede  { id }               → archive a record (history kept)
 *   hard-delete { id }              → permanently remove a record (no history)
 *   extract    { transcript, charId, charName, userName?, llmConfig, ... } → manual extraction pass
 *   migrate    { charId? }          → legacy → V2 migration (idempotent)
 *   reinit                          → reset store state (after model change / recovery)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'health';
    const charId = searchParams.get('charId') || '';
    const groupId = searchParams.get('groupId') || '';
    const sessionId = searchParams.get('sessionId') || '';
    const query = searchParams.get('query') || '';
    const limit = parseInt(searchParams.get('limit') || '100', 10);

    if (action === 'health') {
      const { v2Health, isMemoryV2Enabled } = await import('@/lib/memory/v2');
      const health = await v2Health(true);
      return NextResponse.json({ success: true, health, v2Default: isMemoryV2Enabled(null) });
    }

    if (action === 'records') {
      if (!charId && !groupId) {
        return NextResponse.json({ error: 'charId or groupId required' }, { status: 400 });
      }
      const includeArchived = searchParams.get('includeArchived') === '1';
      const { getV2 } = await import('@/lib/memory/v2');
      const store = await getV2();
      const records = await store.list({
        charId: charId || undefined,
        groupId: groupId || undefined,
        crossSession: true,
        activeOnly: !includeArchived,
        limit: Math.min(limit, 500),
        orderBy: 'smart',
      });
      const grouped: Record<string, typeof records> = {};
      for (const r of records) {
        (grouped[r.type] ||= []).push(r);
      }
      return NextResponse.json({ success: true, backend: store.backend, total: records.length, records, grouped });
    }

    if (action === 'search') {
      if ((!charId && !groupId) || !query) {
        return NextResponse.json({ error: 'charId (or groupId) and query required' }, { status: 400 });
      }
      const { searchMemoriesV2 } = await import('@/lib/memory/v2');
      const results = await searchMemoriesV2({
        query,
        charId: charId || undefined,
        sessionId,
        groupId: groupId || undefined,
        crossSession: true,
        limit: Math.min(limit, 30),
      });
      return NextResponse.json({ success: true, count: results.length, results });
    }

    if (action === 'context') {
      // Debug: preview the exact partitioned blocks that would be injected.
      if (!charId) {
        return NextResponse.json({ error: 'charId required' }, { status: 400 });
      }
      const { buildV2MemoryContext } = await import('@/lib/memory/v2');
      const { context, stats } = await buildV2MemoryContext({
        charId,
        charName: searchParams.get('charName') || 'Personaje',
        userName: searchParams.get('userName') || 'Usuario',
        sessionId,
        groupId: groupId || undefined,
        crossSession: true,
        query,
        maxTokenBudget: parseInt(searchParams.get('budget') || '1024', 10),
      });
      return NextResponse.json({ success: true, context, stats });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error: any) {
    console.error('[MemoryV2 API] GET error:', error);
    return NextResponse.json({ success: false, error: error?.message || 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body?.action;

    if (action === 'add') {
      const { charId, type, content, importance, eventDate, groupId, sessionId, subject } = body;
      // charId optional when groupId is provided → creates a GROUP-WIDE record
      // (charId='') that every member of the group injects (see buildWhere).
      if ((!charId && !groupId) || !content?.trim()) {
        return NextResponse.json({ error: 'charId (or groupId) and content required' }, { status: 400 });
      }
      const { getV2 } = await import('@/lib/memory/v2');
      const store = await getV2();
      const t = new Date().toISOString();
      const record = await store.add({
        id: '',
        type: ['evento', 'hecho', 'preferencia', 'relacion', 'nota', 'resumen_escena'].includes(type) ? type : 'nota',
        content: String(content),
        subject: subject || 'mundo',
        charId: charId || '',
        groupId: groupId || '',
        sessionId: sessionId || '',
        source: 'curada',
        importance: Math.min(1, Math.max(0, Number(importance ?? 0.5))),
        heat: 1,
        eventDate: eventDate || t,
        createdAt: t,
        updatedAt: t,
        lastAccessedAt: t,
        accessCount: 0,
        linkedIds: [],
        supersededBy: '',
      });
      return NextResponse.json({ success: true, record });
    }

    if (action === 'edit') {
      const { id, content, type, importance, eventDate, subject } = body;
      if (!id || !content?.trim()) {
        return NextResponse.json({ error: 'id and content required' }, { status: 400 });
      }
      const { getV2, sanitizeContent, normalizeEventDate } = await import('@/lib/memory/v2');
      const store = await getV2();
      const rec = await store.get(id);
      if (!rec) {
        return NextResponse.json({ error: `Record ${id} not found` }, { status: 404 });
      }
      rec.content = sanitizeContent(String(content));
      if (type && ['evento', 'hecho', 'preferencia', 'relacion', 'nota', 'resumen_escena'].includes(type)) {
        rec.type = type;
      }
      if (importance !== undefined) {
        rec.importance = Math.min(1, Math.max(0, Number(importance)));
      }
      if (eventDate !== undefined) {
        const d = normalizeEventDate(eventDate);
        if (d) rec.eventDate = d;
      }
      if (subject && ['usuario', 'personaje', 'pareja', 'mundo'].includes(subject)) {
        rec.subject = subject;
      }
      rec.updatedAt = new Date().toISOString();
      // Re-embed: the content changed, so the stored vector is stale.
      await store.update(rec, { reembed: true });
      return NextResponse.json({ success: true, record: rec });
    }

    if (action === 'supersede') {
      const { id } = body;
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      const { getV2, MEMORY_TOMBSTONE } = await import('@/lib/memory/v2');
      const store = await getV2();
      const ok = await store.supersede(id, MEMORY_TOMBSTONE);
      return NextResponse.json({ success: ok });
    }

    if (action === 'hard-delete') {
      const { id } = body;
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      const { getV2 } = await import('@/lib/memory/v2');
      const store = await getV2();
      const ok = await store.hardDelete(id);
      return NextResponse.json({ success: ok });
    }

    if (action === 'extract') {
      const { transcript, charId, charName, userName, sessionId, groupId, llmConfig, minImportance, extractionModelConfig } = body;
      if (!transcript || !charId || !charName) {
        return NextResponse.json({ error: 'transcript, charId and charName required' }, { status: 400 });
      }
      const { extractAndSaveV2 } = await import('@/lib/memory/v2');
      const { buildExtractionLlmConfig } = await import('@/lib/embeddings/memory-extraction');
      const result = await extractAndSaveV2({
        transcript,
        charId,
        charName,
        userName,
        sessionId: sessionId || '',
        groupId: groupId || '',
        llmConfig: buildExtractionLlmConfig(llmConfig, extractionModelConfig),
        minImportance,
      });
      return NextResponse.json({ success: result.success, ...result });
    }

    if (action === 'migrate') {
      const { migrateLegacyToV2 } = await import('@/lib/memory/v2');
      const result = await migrateLegacyToV2(body?.charId ? { charId: body.charId } : undefined);
      return NextResponse.json({ success: true, ...result });
    }

    if (action === 'reinit') {
      const { resetV2, v2Health } = await import('@/lib/memory/v2');
      resetV2();
      const health = await v2Health(true);
      return NextResponse.json({ success: true, health });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error: any) {
    console.error('[MemoryV2 API] POST error:', error);
    return NextResponse.json({ success: false, error: error?.message || 'Internal error' }, { status: 500 });
  }
}
