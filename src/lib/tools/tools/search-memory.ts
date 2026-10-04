// ============================================
// Tool: Search Memory
// ============================================
// Category: cognitive
// Permission: auto
// Searches the Memory V2 unified store for relevant memories
// about a specific topic (semantic + lexical retrieval with reranking).

import type { ToolDefinition, ToolContext, ToolExecutionResult } from '../types';
import { getV2, searchMemoriesV2 } from '@/lib/memory/v2';

export const searchMemoryTool: ToolDefinition = {
  id: 'search_memory',
  name: 'search_memory',
  label: 'Buscar Memoria',
  icon: 'Brain',
  description:
    'Busca en tu memoria (Memoria V2) información relacionada con un tema específico. ' +
    'Usa esta herramienta cuando necesites recordar algo que el usuario mencionó anteriormente ' +
    'o cuando quieras verificar si tienes información sobre un tema en tu memoria.',
  category: 'cognitive',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Qué buscar en la memoria (ej: "gustos del usuario", "nombre del amigo")',
        required: true,
      },
      memory_type: {
        type: 'string',
        description: 'Filtrar por tipo: hecho, evento, relacion, preferencia (opcional)',
        enum: ['hecho', 'evento', 'relacion', 'preferencia', 'secreto', 'otro'],
        required: false,
      },
      memory_subject: {
        type: 'string',
        description: 'Filtrar por sujeto: "usuario" (memorias sobre el jugador), "personaje" (memorias sobre ti), "otro" (sobre otros personajes)',
        enum: ['usuario', 'personaje', 'otro'],
        required: false,
      },
      max_results: {
        type: 'number',
        description: 'Cuántos resultados máximos devolver (default: 5)',
        required: false,
      },
    },
    required: ['query'],
  },
  permissionMode: 'auto',
};

/** Map tool memory_type filter → V2 types (secreto/otro map to nota) */
function toV2Types(t: string): string[] {
  switch (t) {
    case 'hecho': return ['hecho'];
    case 'evento': return ['evento', 'resumen_escena'];
    case 'relacion': return ['relacion'];
    case 'preferencia': return ['preferencia'];
    case 'secreto': return ['nota'];
    default: return ['nota'];
  }
}

export async function searchMemoryExecutor(
  params: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolExecutionResult> {
  const query = String(params.query || '').trim();
  const memoryType = params.memory_type ? String(params.memory_type) : undefined;
  const memorySubject = params.memory_subject ? String(params.memory_subject) : undefined;
  const maxResults = Math.min(Math.max(Number(params.max_results) || 5, 1), 10);

  if (!query || query.length < 2) {
    return {
      success: false,
      toolName: 'search_memory',
      result: null,
      displayMessage: 'La búsqueda de memoria requiere un query de al menos 2 caracteres',
      error: 'EMPTY_QUERY',
    };
  }

  let memories: Awaited<ReturnType<typeof searchMemoriesV2>> = [];

  try {
    const scored = await searchMemoriesV2({
      query,
      charId: context.characterId,
      sessionId: context.sessionId || '',
      groupId: context.groupId || '',
      crossSession: true,
      limit: maxResults * 3, // over-fetch, then apply tool filters
      threshold: 0.1,
    });

    let filtered = scored;

    if (memoryType) {
      const allowed = toV2Types(memoryType);
      filtered = filtered.filter(r => allowed.includes(r.type));
    }
    if (memorySubject) {
      const subj = memorySubject === 'otro' ? 'mundo' : memorySubject;
      filtered = filtered.filter(r => r.subject === subj);
    }

    memories = filtered.slice(0, maxResults);

    // Touch retrieved records (heat boost)
    if (memories.length > 0) {
      try {
        const store = await getV2();
        await store.touch(memories.map(m => m.id));
      } catch { /* non-blocking */ }
    }
  } catch (err) {
    console.warn('[search_memory] V2 search failed:', err);
    return {
      success: false,
      toolName: 'search_memory',
      result: null,
      displayMessage: 'La memoria no está disponible en este momento (backend de memoria V2 no accesible).',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (memories.length === 0) {
    return {
      success: true,
      toolName: 'search_memory',
      result: { query, memories: [], memoryType, memorySubject },
      displayMessage: `🧠 No se encontraron memorias sobre "${query}"${memoryType ? ` (tipo: ${memoryType})` : ''}${memorySubject ? ` (sujeto: ${memorySubject})` : ''}`,
    };
  }

  const lines = [`🧠 Memorias sobre "${query}":`];

  if (memoryType) {
    lines[0] += ` [Tipo: ${memoryType}]`;
  }
  if (memorySubject) {
    lines[0] += ` [Sujeto: ${memorySubject}]`;
  }

  lines.push('');

  for (let i = 0; i < memories.length; i++) {
    const m = memories[i];
    const imp = Math.round(m.importance * 4) + 1;
    const stars = '★'.repeat(imp) + '☆'.repeat(5 - imp);
    const subjectLabel = m.subject === 'usuario' ? '👤 Usuario' : m.subject === 'mundo' ? '🌐 Otro' : '🧑 Personaje';
    const srcLabel = m.source === 'curada' ? '[Fijada]' : '[Automática]';

    lines.push(`${i + 1}. ${m.content}`);
    lines.push(`   ${stars} (${m.type}) [${subjectLabel}] ${srcLabel}`);
  }

  return {
    success: true,
    toolName: 'search_memory',
    result: {
      query,
      memories: memories.map(m => ({
        content: m.content,
        type: m.type,
        subject: m.subject,
        importance: m.importance,
        eventDate: m.eventDate,
        source: m.source,
        score: m.score,
      })),
      memoryType,
      memorySubject,
    },
    displayMessage: lines.join('\n'),
  };
}
