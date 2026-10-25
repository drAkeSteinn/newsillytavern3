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
 * GET  ?action=export-all                   → ALL records (active + archived) for backup
 *
 * POST { action }:
 *   add        { charId, type, content, importance?, eventDate?, groupId? } → manual (curada) record
 *   edit       { id, content, type?, importance?, eventDate?, subject? }    → in-place user edit (re-embeds)
 *   supersede  { id }               → archive a record (history kept)
 *   hard-delete { id }              → permanently remove a record (no history)
 *   hard-delete-bulk { ids }        → permanently remove several records
 *                    { all: true, charId|groupId } → RESET: wipe ALL records in scope
 *   extract    { transcript, charId, charName, userName?, llmConfig, ... } → manual extraction pass
 *   migrate    { charId? }          → legacy → V2 migration (idempotent)
 *   reinit                          → reset store state (after model change / recovery)
 *   import-records { records }      → bulk restore from backup (merge by id: existing
 *                                    ids are SKIPPED, missing ones re-embedded and added)
 *   export-md  { charId?, groupId?, activeOnly? } → records as a markdown string (human-readable backup)
 *   import-md  { markdown, charId?, groupId?, sessionId?, mode? } → parse MD and add records (mode='replace'|'append', default 'append')
 *   archive-events { sessionId, charId, eventLog } → archive sessionStats.eventLog entries to V2 (auto, dedup by sourceMessageId)
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

    if (action === 'export-md') {
      // Human-readable markdown export. Scope: charId/groupId if provided, else ALL records.
      const { getV2 } = await import('@/lib/memory/v2');
      const { exportRecordsToMarkdown } = await import('@/lib/memory/v2');
      const store = await getV2();
      const activeOnly = searchParams.get('includeArchived') !== '1';
      const records = await store.list({
        charId: charId || undefined,
        groupId: groupId || undefined,
        crossSession: true,
        activeOnly,
        limit: 100000,
        orderBy: 'recent',
      });
      const md = exportRecordsToMarkdown(records);
      return NextResponse.json({
        success: true,
        markdown: md,
        total: records.length,
        activeOnly,
      });
    }

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

    if (action === 'export-all') {
      // Full backup dump: every record (active + superseded/archived) across all
      // characters, groups and sessions. Used by the Datos → Exportar Todo flow.
      const { getV2 } = await import('@/lib/memory/v2');
      const store = await getV2();
      const records = await store.list({ activeOnly: false, limit: 100000, orderBy: 'recent' });
      return NextResponse.json({
        success: true,
        backend: store.backend,
        model: store.model,
        total: records.length,
        records,
      });
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

    if (action === 'hard-delete-bulk') {
      // Two modes:
      //   { ids: [...] }                          → delete exactly those records
      //   { all: true, charId?|groupId?, ... }    → RESET: wipe everything for the
      //     scope (active + archived), looping in batches for stores > 500 records.
      const { ids, all, charId, groupId } = body;
      const { getV2 } = await import('@/lib/memory/v2');
      const store = await getV2();

      if (all) {
        if (!charId && !groupId) {
          return NextResponse.json({ error: 'charId or groupId required' }, { status: 400 });
        }
        let totalDeleted = 0;
        for (let pass = 0; pass < 20; pass++) {
          const records = await store.list({
            charId: charId || undefined,
            groupId: groupId || undefined,
            crossSession: true,
            activeOnly: false, // include archived → a true reset
            limit: 500,
            orderBy: 'recent',
          });
          if (!records.length) break;
          const n = await store.hardDeleteMany(records.map(r => r.id));
          totalDeleted += n;
          if (n < records.length) break; // partial delete → avoid an infinite loop
        }
        return NextResponse.json({ success: true, deleted: totalDeleted, scope: 'all' });
      }

      if (!Array.isArray(ids) || ids.length === 0) {
        return NextResponse.json({ error: 'ids (non-empty array) or all=true required' }, { status: 400 });
      }
      const deleted = await store.hardDeleteMany(ids.map(String));
      return NextResponse.json({ success: true, deleted });
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

    if (action === 'import-records') {
      // Bulk restore from a backup. Merge-by-id semantics (idempotent):
      //   - record id already exists  → SKIPPED (local copy wins, never duplicated)
      //   - record id missing         → added with ALL original fields preserved
      //                                 (createdAt, importance, heat, eventDate,
      //                                  supersededBy/archived status, charId/groupId...)
      // The store re-embeds content automatically on add.
      const { records } = body;
      if (!Array.isArray(records) || records.length === 0) {
        return NextResponse.json({ error: 'records (non-empty array) required' }, { status: 400 });
      }
      const { getV2 } = await import('@/lib/memory/v2');
      const store = await getV2();
      const VALID_TYPES = ['evento', 'hecho', 'preferencia', 'relacion', 'nota', 'resumen_escena'];
      const VALID_SUBJECTS = ['usuario', 'personaje', 'pareja', 'mundo'];
      let added = 0;
      let skipped = 0;
      let invalid = 0;
      for (const raw of records) {
        if (!raw || typeof raw !== 'object' || !String(raw.content ?? '').trim()) {
          invalid++;
          continue;
        }
        const id = String(raw.id ?? '').trim();
        if (id && (await store.get(id))) {
          skipped++;
          continue;
        }
        const t = new Date().toISOString();
        try {
          await store.add({
            id: id || '', // store.add generates one when empty
            type: VALID_TYPES.includes(raw.type) ? raw.type : 'nota',
            content: String(raw.content),
            subject: VALID_SUBJECTS.includes(raw.subject) ? raw.subject : 'mundo',
            charId: String(raw.charId ?? ''),
            groupId: String(raw.groupId ?? ''),
            sessionId: String(raw.sessionId ?? ''),
            source: raw.source === 'curada' ? 'curada' : 'auto',
            importance: Math.min(1, Math.max(0, Number(raw.importance ?? 0.5)) || 0),
            heat: Math.max(0, Number(raw.heat ?? 1) || 1),
            eventDate: raw.eventDate || t,
            createdAt: raw.createdAt || t,
            updatedAt: t,
            lastAccessedAt: raw.lastAccessedAt || t,
            accessCount: Math.max(0, Number(raw.accessCount ?? 0) || 0),
            linkedIds: Array.isArray(raw.linkedIds) ? raw.linkedIds.map(String) : [],
            supersededBy: String(raw.supersededBy ?? ''), // preserve archived status
            ...(raw.legacyId ? { legacyId: String(raw.legacyId) } : {}),
            ...(raw.sourceMessageId ? { sourceMessageId: String(raw.sourceMessageId) } : {}),
          });
          added++;
        } catch (addErr) {
          console.error('[MemoryV2 API] import-records: failed to add one record:', addErr);
          invalid++;
        }
      }
      return NextResponse.json({ success: true, added, skipped, invalid, total: records.length });
    }

    if (action === 'import-md') {
      // Parse markdown into V2 records and add them. mode='append' (default)
      // just adds new records; mode='replace' first wipes all records in scope
      // (charId/groupId) then adds the parsed ones.
      const { markdown, charId, groupId, sessionId, mode } = body;
      if (!markdown || typeof markdown !== 'string') {
        return NextResponse.json({ error: 'markdown (string) required' }, { status: 400 });
      }
      const { getV2, parseMarkdownToEntries, entriesToRecords } = await import('@/lib/memory/v2');
      const store = await getV2();
      const entries = parseMarkdownToEntries(markdown);
      if (entries.length === 0) {
        return NextResponse.json({ success: true, added: 0, skipped: 0, message: 'No se encontraron memorias en el markdown.' });
      }
      // Optional: wipe scope first when mode='replace'
      let wiped = 0;
      if (mode === 'replace' && (charId || groupId)) {
        for (let pass = 0; pass < 20; pass++) {
          const existing = await store.list({
            charId: charId || undefined,
            groupId: groupId || undefined,
            crossSession: true,
            activeOnly: false,
            limit: 500,
            orderBy: 'recent',
          });
          if (!existing.length) break;
          const n = await store.hardDeleteMany(existing.map(r => r.id));
          wiped += n;
          if (n < existing.length) break;
        }
      }
      // Convert entries to record payloads and add them. The store re-embeds
      // content automatically (embedding model available) or falls back to JSON.
      const records = entriesToRecords(entries, { charId, groupId, sessionId });
      let added = 0;
      let failed = 0;
      for (const rec of records) {
        try {
          await store.add(rec);
          added++;
        } catch (err) {
          console.error('[MemoryV2 API] import-md: failed to add one record:', err);
          failed++;
        }
      }
      return NextResponse.json({
        success: true,
        added,
        failed,
        wiped,
        totalParsed: entries.length,
      });
    }

    if (action === 'archive-events') {
      // Archive sessionStats.eventLog entries to V2 so they survive beyond the
      // short {{last_events}} window. Dedup by sourceMessageId avoids
      // re-archiving the same event across turns.
      const { sessionId: sid, charId: cid, groupId: gid, eventLog } = body;
      if (!sid || !Array.isArray(eventLog) || eventLog.length === 0) {
        return NextResponse.json({ error: 'sessionId and eventLog (non-empty array) required' }, { status: 400 });
      }
      const { getV2 } = await import('@/lib/memory/v2');
      const store = await getV2();
      const t = new Date().toISOString();
      let added = 0;
      let skipped = 0;
      // Fetch existing sourceMessageIds for this character to dedup
      const existing = await store.list({
        charId: cid || undefined,
        groupId: gid || undefined,
        crossSession: false,
        activeOnly: true,
        limit: 10000,
        orderBy: 'recent',
      });
      const seenSourceIds = new Set<string>();
      for (const r of existing) {
        if (r.sourceMessageId) seenSourceIds.add(r.sourceMessageId);
      }
      for (const ev of eventLog) {
        const description = String(ev?.description || '').trim();
        if (!description || description.length < 15) {
          skipped++;
          continue;
        }
        const sourceMessageId = ev?.id ? `evt:${String(ev.id)}` : `evt:${sid}:${ev?.turn || 0}:${description.slice(0, 30)}`;
        if (seenSourceIds.has(sourceMessageId)) {
          skipped++;
          continue;
        }
        seenSourceIds.add(sourceMessageId);
        // Map event log types to V2 types
        const evType = String(ev?.type || 'custom');
        let v2Type: 'evento' | 'hecho' | 'relacion' | 'nota' = 'evento';
        if (evType === 'relationship') v2Type = 'relacion';
        else if (evType === 'scene_enter' || evType === 'scene_leave') v2Type = 'evento';
        else if (evType === 'custom' || evType === 'action') v2Type = 'evento';
        const importance = ev?.severity === 'major' ? 0.8 : 0.4;
        const eventDate = ev?.timestamp ? new Date(ev.timestamp).toISOString() : t;
        try {
          await store.add({
            id: '',
            type: v2Type,
            content: description,
            subject: 'personaje',
            charId: cid || '',
            groupId: gid || '',
            sessionId: sid || '',
            source: 'auto',
            importance,
            heat: 1,
            eventDate,
            createdAt: t,
            updatedAt: t,
            lastAccessedAt: t,
            accessCount: 0,
            linkedIds: [],
            supersededBy: '',
            sourceMessageId,
          });
          added++;
        } catch (addErr) {
          console.error('[MemoryV2 API] archive-events: failed to add:', addErr);
          skipped++;
        }
      }
      return NextResponse.json({ success: true, added, skipped, total: eventLog.length });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error: any) {
    console.error('[MemoryV2 API] POST error:', error);
    return NextResponse.json({ success: false, error: error?.message || 'Internal error' }, { status: 500 });
  }
}
