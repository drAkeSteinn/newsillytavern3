/**
 * Memory V2 — Markdown serialization (.MD import/export).
 *
 * Human-readable format so users can back up, edit, and restore memories
 * without touching JSON. Each memory is a fenced block with YAML-like
 * frontmatter.
 *
 * Example:
 *
 *   ## evento
 *   <!-- type: evento | subject: personaje | date: 2026-10-15 | importance: 0.8 | source: curada -->
 *   Ney Walker se arrodilló frente a drAke y le practicó sexo oral profundo.
 *
 *   ## hecho
 *   <!-- type: hecho | subject: usuario | date: 2026-10-12 | importance: 0.6 | source: auto -->
 *   A drAke le gusta que le llamen "Edu" en la intimidad.
 *
 * The parser is tolerant: missing fields fall back to defaults, and blocks
 * without a `## type` header are ignored. Unknown types are coerced to `nota`.
 */

import type { MemoryV2Record, MemoryV2Type, MemoryV2Subject, MemoryV2Source } from './types';

const VALID_TYPES: MemoryV2Type[] = ['evento', 'hecho', 'preferencia', 'relacion', 'nota', 'resumen_escena'];
const VALID_SUBJECTS: MemoryV2Subject[] = ['usuario', 'personaje', 'pareja', 'mundo'];

export interface ParsedMemoryEntry {
  type: MemoryV2Type;
  content: string;
  subject: MemoryV2Subject;
  eventDate: string;
  importance: number;
  source: MemoryV2Source;
  charId?: string;
  groupId?: string;
}

// ============================================
// Export: records → markdown
// ============================================

function escapeAttr(value: string): string {
  return String(value).replace(/\|/g, '\\|').trim();
}

function formatDate(iso: string): string {
  if (!iso) return new Date().toISOString().slice(0, 10);
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    return d.toISOString().slice(0, 10);
  } catch {
    return iso.slice(0, 10);
  }
}

function recordToMdBlock(r: MemoryV2Record): string {
  const header = `## ${r.type}`;
  const meta = `<!-- type: ${r.type} | subject: ${r.subject} | date: ${formatDate(r.eventDate)} | importance: ${r.importance.toFixed(2)} | source: ${r.source}${r.charId ? ` | charId: ${escapeAttr(r.charId)}` : ''}${r.groupId ? ` | groupId: ${escapeAttr(r.groupId)}` : ''} -->`;
  const archived = r.supersededBy ? ' *(archivado)*' : '';
  return `${header}\n${meta}\n${r.content.trim()}${archived}`;
}

/** Serialize an array of V2 records to a markdown document. */
export function exportRecordsToMarkdown(records: MemoryV2Record[]): string {
  if (!records || records.length === 0) {
    return '# Memorias TavernFlow\n\n(Sin registros para exportar)\n';
  }
  const sorted = [...records].sort((a, b) => {
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return (b.eventDate || '').localeCompare(a.eventDate || '');
  });
  const groups = new Map<MemoryV2Type, MemoryV2Record[]>();
  for (const r of sorted) {
    const t = VALID_TYPES.includes(r.type) ? r.type : 'nota';
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t)!.push(r);
  }
  const lines: string[] = [
    '# Memorias TavernFlow',
    '',
    `> Exportado: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
    `> Total: ${records.length} registros (${records.filter(r => !r.supersededBy).length} activos, ${records.filter(r => r.supersededBy).length} archivados)`,
    '',
    '<!--',
    'Formato: cada memoria es un bloque "## tipo" seguido de un meta-comment',
    'con campos type|subject|date|importance|source (y opcional charId|groupId).',
    'El contenido va en la línea siguiente. Líneas en blanco separan bloques.',
    'Para importar de vuelta, usa el botón "Importar .MD" en Memoria V2.',
    '-->',
    '',
  ];
  const TYPE_LABELS: Record<string, string> = {
    evento: 'Eventos',
    hecho: 'Hechos',
    preferencia: 'Preferencias',
    relacion: 'Relación',
    nota: 'Notas',
    resumen_escena: 'Resúmenes de escena',
  };
  for (const t of VALID_TYPES) {
    const recs = groups.get(t);
    if (!recs || recs.length === 0) continue;
    lines.push(`# ${TYPE_LABELS[t] || t} (${recs.length})`, '');
    for (const r of recs) {
      lines.push(recordToMdBlock(r), '');
    }
  }
  return lines.join('\n').trim() + '\n';
}

// ============================================
// Import: markdown → parsed entries
// ============================================

function parseMetaLine(line: string): Record<string, string> {
  // <!-- type: evento | subject: personaje | date: 2026-10-15 | importance: 0.8 | source: curada -->
  const out: Record<string, string> = {};
  const inner = line.replace(/<!--/, '').replace(/-->/, '').trim();
  const parts = inner.split('|');
  for (const p of parts) {
    const idx = p.indexOf(':');
    if (idx === -1) continue;
    const key = p.slice(0, idx).trim().toLowerCase();
    const val = p.slice(idx + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

function coerceType(raw: string | undefined): MemoryV2Type {
  const t = String(raw || 'nota').toLowerCase().trim();
  return (VALID_TYPES as string[]).includes(t) ? (t as MemoryV2Type) : 'nota';
}

function coerceSubject(raw: string | undefined): MemoryV2Subject {
  const s = String(raw || 'mundo').toLowerCase().trim();
  return (VALID_SUBJECTS as string[]).includes(s) ? (s as MemoryV2Subject) : 'mundo';
}

function coerceDate(raw: string | undefined): string {
  if (!raw) return new Date().toISOString();
  const s = String(raw).trim();
  // YYYY-MM-DD → ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T12:00:00.000Z').toISOString();
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
  try {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  } catch { /* ignore */ }
  return new Date().toISOString();
}

function coerceImportance(raw: string | undefined): number {
  const n = parseFloat(String(raw ?? '0.5'));
  if (!Number.isFinite(n)) return 0.5;
  // Accept 0-5 (importance scale) → normalize to 0-1
  const normalized = n > 1 ? n / 5 : n;
  return Math.min(1, Math.max(0, normalized));
}

function coerceSource(raw: string | undefined): MemoryV2Source {
  return raw === 'curada' ? 'curada' : 'auto';
}

/** Parse a markdown document into memory entries. Tolerant of formatting. */
export function parseMarkdownToEntries(md: string): ParsedMemoryEntry[] {
  if (!md || typeof md !== 'string') return [];
  const lines = md.split(/\r?\n/);
  const entries: ParsedMemoryEntry[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Look for a block header: "## type" (with optional trailing content)
    const headerMatch = line.match(/^##\s+(\w[\w_]*)/);
    if (!headerMatch) {
      i++;
      continue;
    }
    const declaredType = headerMatch[1].toLowerCase();
    i++;
    // Next non-empty line should be the meta comment
    let meta: Record<string, string> = {};
    while (i < lines.length && lines[i].trim() === '') i++;
    if (i < lines.length && /<!--/.test(lines[i])) {
      meta = parseMetaLine(lines[i]);
      i++;
    }
    // Collect content lines until next "## " header or section "# " or EOF
    const contentLines: string[] = [];
    while (i < lines.length) {
      const l = lines[i];
      if (/^##\s+/.test(l) || /^#\s+/.test(l)) break;
      contentLines.push(l);
      i++;
    }
    const content = contentLines.join('\n').replace(/\*\(archivado\)\s*$/, '').trim();
    if (!content) continue;
    entries.push({
      type: coerceType(meta.type || declaredType),
      content,
      subject: coerceSubject(meta.subject),
      eventDate: coerceDate(meta.date),
      importance: coerceImportance(meta.importance),
      source: coerceSource(meta.source),
      charId: meta.charId || undefined,
      groupId: meta.groupId || undefined,
    });
  }
  return entries;
}

/** Build V2 record payloads from parsed entries (for the import-records API). */
export function entriesToRecords(
  entries: ParsedMemoryEntry[],
  fallback: { charId?: string; groupId?: string; sessionId?: string },
): Array<Partial<MemoryV2Record> & { content: string; type: MemoryV2Type; subject: MemoryV2Subject; source: MemoryV2Source }> {
  const t = new Date().toISOString();
  return entries.map((e) => ({
    id: '', // store.add generates one
    type: e.type,
    content: e.content,
    subject: e.subject,
    charId: e.charId || fallback.charId || '',
    groupId: e.groupId || fallback.groupId || '',
    sessionId: fallback.sessionId || '',
    source: e.source,
    importance: e.importance,
    heat: 1,
    eventDate: e.eventDate,
    createdAt: t,
    updatedAt: t,
    lastAccessedAt: t,
    accessCount: 0,
    linkedIds: [],
    supersededBy: '',
  }));
}
