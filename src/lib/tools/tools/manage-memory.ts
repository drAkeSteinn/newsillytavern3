// ============================================
// Tool: Manage Memory
// ============================================
// Category: cognitive
// Manages character memories via the Memory V2 unified store.
// The character can save important events/facts, update how it feels
// about someone, or review recent memories.

import type { ToolDefinition, ToolContext, ToolExecutionResult } from '../types';
import { getV2, type MemoryV2Record } from '@/lib/memory/v2';
import { personalizeMemoryContent } from '@/lib/memory/personalize';

export const manageMemoryTool: ToolDefinition = {
  id: 'manage_memory',
  name: 'manage_memory',
  label: 'Gestionar Memoria',
  icon: 'Brain',
  description:
    'Gestiona tu memoria (Memoria V2): guarda recuerdos importantes, actualiza cómo te sientes con otros personajes, o consulta tus recuerdos recientes. ' +
    'Úsala para guardar información que debes recordar en futuras conversaciones.',
  category: 'cognitive',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Acción: save_memory (guardar), update_relationship (actualizar relación), get_memories (ver recuerdos recientes)',
        enum: ['save_memory', 'update_relationship', 'get_memories', 'save_note'],
        required: true,
      },
      memory_type: {
        type: 'string',
        description: 'Tipo de memoria: hecho, evento, relacion, preferencia, secreto, otro',
        enum: ['hecho', 'evento', 'relacion', 'preferencia', 'secreto', 'otro'],
        required: false,
      },
      content: {
        type: 'string',
        description: 'Contenido de la memoria a guardar (usa nombres reales, nunca "el usuario")',
        required: false,
      },
      subject: {
        type: 'string',
        description: 'Personaje, lugar u objeto relacionado con la memoria',
        required: false,
      },
      memory_subject: {
        type: 'string',
        description: 'Quién es el sujeto de la memoria: "usuario" (sobre el jugador), "personaje" (sobre ti mismo), "otro" (sobre otro personaje o entidad)',
        enum: ['usuario', 'personaje', 'otro'],
        required: false,
      },
      sentiment: {
        type: 'number',
        description: 'Cambio de sentimiento (-100 muy negativo, +100 muy positivo) para relaciones',
        required: false,
      },
      importance: {
        type: 'number',
        description: 'Importancia de la memoria (1-5, default: 3)',
        required: false,
      },
      narrative: {
        type: 'string',
        description: 'Descripción narrativa del evento o acción',
        required: false,
      },
    },
    required: ['action'],
  },
  permissionMode: 'auto',
};

const VALID_MEMORY_TYPES = ['hecho', 'evento', 'relacion', 'preferencia', 'secreto', 'otro'] as const;
type ToolMemoryType = (typeof VALID_MEMORY_TYPES)[number];

function normalizeMemoryType(raw: string): ToolMemoryType {
  const lower = raw.toLowerCase().trim();
  return (VALID_MEMORY_TYPES as readonly string[]).includes(lower) ? (lower as ToolMemoryType) : 'otro';
}

/** Map tool memory types → V2 record types */
function toV2Type(t: ToolMemoryType): MemoryV2Record['type'] {
  switch (t) {
    case 'hecho': return 'hecho';
    case 'evento': return 'evento';
    case 'relacion': return 'relacion';
    case 'preferencia': return 'preferencia';
    case 'secreto': return 'nota';
    default: return 'nota';
  }
}

/** Map tool subject → V2 subject */
function toV2Subject(s: string): MemoryV2Record['subject'] {
  if (s === 'usuario') return 'usuario';
  if (s === 'otro') return 'mundo';
  return 'personaje';
}

/** importance 1-5 → V2 0..1 */
function toV2Importance(imp: number): number {
  return Math.min(1, Math.max(0, (imp - 1) / 4));
}

export async function manageMemoryExecutor(
  params: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolExecutionResult> {
  const action = String(params.action || '');
  const memoryType = params.memory_type ? normalizeMemoryType(String(params.memory_type)) : 'hecho';
  const content = params.content ? String(params.content) : '';
  const subject = params.subject ? String(params.subject) : context.characterName;
  const memorySubject = params.memory_subject ? String(params.memory_subject) : 'personaje';
  const sentiment = params.sentiment !== undefined ? Number(params.sentiment) : 0;
  const importance = params.importance !== undefined ? Math.max(1, Math.min(5, Math.round(Number(params.importance)))) : 3;
  const narrative = params.narrative ? String(params.narrative) : '';

  try {
    const store = await getV2();

    switch (action) {
      case 'save_memory':
      case 'save_note': {
        if (!content && !narrative) {
          return {
            success: false,
            toolName: 'manage_memory',
            result: null,
            displayMessage: 'Para guardar una memoria, especifica content o narrative.',
            error: 'Missing required parameter: content or narrative',
          };
        }

        // Sanitize: LLMs sometimes write "el Jugador"/"el usuario" in tool calls.
        // Replace generic player references with the persona's real name ({{user}}).
        const memoryContent = personalizeMemoryContent(content || narrative, context.userName);

        // Explicit memory saved by the character → curated (never decayed,
        // prioritized in injection). Stored in the unified V2 store.
        const record = await store.add({
          id: '',
          type: toV2Type(memoryType),
          content: memoryContent,
          subject: toV2Subject(memorySubject),
          charId: context.characterId,
          groupId: context.groupId || '',
          sessionId: context.sessionId || '',
          source: 'curada',
          importance: toV2Importance(importance),
          eventDate: new Date().toISOString(),
        });

        console.log(`[manage_memory] Saved V2 record (${record.type}) for ${context.characterName}: ${memoryContent.slice(0, 50)}...`);

        const sentimentEmoji = sentiment > 20 ? '😊' : sentiment < -20 ? '😢' : '📝';
        const importanceStars = '★'.repeat(Math.ceil(importance)) + '☆'.repeat(5 - Math.ceil(importance));
        const subjectLabel = memorySubject === 'usuario' ? '👤 Usuario' : memorySubject === 'otro' ? '👥 Otro' : '🧑 Personaje';

        const lines = [
          '🧠 **Memoria Guardada:**',
          `${sentimentEmoji} Tipo: ${memoryType}`,
          `${importanceStars} Importancia: ${importance}/5`,
          `${subjectLabel} | Relacionado: ${subject}`,
          '',
          `Contenido: ${memoryContent}`,
          '',
          'La memoria ha sido guardada y podrá ser consultada en futuras conversaciones.',
        ];

        return {
          success: true,
          toolName: 'manage_memory',
          result: {
            action: 'save_memory',
            memoryType,
            content: memoryContent,
            subject,
            memorySubject,
            importance,
            characterId: context.characterId,
            sessionId: context.sessionId,
            recordId: record.id,
          },
          displayMessage: lines.join('\n'),
        };
      }

      case 'update_relationship': {
        if (!subject) {
          return {
            success: false,
            toolName: 'manage_memory',
            result: null,
            displayMessage: 'Para actualizar una relación, especifica subject (nombre del otro personaje).',
            error: 'Missing required parameter: subject',
          };
        }

        const sentimentLabel = sentiment > 50 ? 'aliado cercano'
          : sentiment > 20 ? 'amigo'
          : sentiment > 0 ? 'conocido'
          : sentiment > -20 ? 'neutral'
          : sentiment > -50 ? 'desconfiado'
          : 'enemigo';

        const sentimentChange = sentiment > 0 ? `+${sentiment}` : `${sentiment}`;

        // Sanitize narrative so relationships also reference the persona by name
        const sanitizedNarrative = personalizeMemoryContent(narrative, context.userName);

        const relationshipContent = sanitizedNarrative
          ? `${context.characterName} siente que su relación con ${subject} es: ${sentimentLabel}. ${sanitizedNarrative} (cambio de sentimiento: ${sentimentChange})`
          : `${context.characterName} siente que su relación con ${subject} es: ${sentimentLabel} (cambio de sentimiento: ${sentimentChange})`;

        await store.add({
          id: '',
          type: 'relacion',
          content: relationshipContent,
          subject: subject === context.userName ? 'usuario' : 'mundo',
          charId: context.characterId,
          groupId: context.groupId || '',
          sessionId: context.sessionId || '',
          source: 'curada',
          importance: toV2Importance(Math.abs(sentiment) > 50 ? 4 : 3),
          eventDate: new Date().toISOString(),
        });

        console.log(`[manage_memory] Saved V2 relationship for ${context.characterName}: ${subject}`);

        const lines = [
          '💜 **Relación Actualizada:**',
          `Personaje: ${subject}`,
          `Cambio: ${sentimentChange}`,
          `Estado actual: ${sentimentLabel}`,
        ];

        if (narrative) {
          lines.push(`Razón: ${narrative}`);
        }

        lines.push('');
        lines.push('La relación ha sido actualizada en la memoria del personaje.');

        return {
          success: true,
          toolName: 'manage_memory',
          result: {
            action: 'update_relationship',
            subject,
            sentimentDelta: sentiment,
            sentimentLabel,
            characterId: context.characterId,
            sessionId: context.sessionId,
          },
          displayMessage: lines.join('\n'),
        };
      }

      case 'get_memories': {
        const records = await store.list({
          charId: context.characterId,
          groupId: context.groupId || undefined,
          sessionId: context.sessionId || '',
          crossSession: true,
          activeOnly: true,
          limit: 8,
        });

        const lines = ['🧠 **Tus recuerdos recientes:**', ''];

        if (records.length === 0) {
          lines.push('(Aún no tienes recuerdos guardados.)');
        } else {
          for (let i = 0; i < records.length; i++) {
            const r = records[i];
            const imp = Math.round(r.importance * 4) + 1;
            const stars = '★'.repeat(imp) + '☆'.repeat(5 - imp);
            lines.push(`${i + 1}. [${r.type}] ${r.content}`);
            lines.push(`   ${stars} · ${r.eventDate.slice(0, 10)}`);
          }
        }

        return {
          success: true,
          toolName: 'manage_memory',
          result: {
            action: 'get_memories',
            characterId: context.characterId,
            sessionId: context.sessionId,
            count: records.length,
          },
          displayMessage: lines.join('\n'),
        };
      }

      default:
        return {
          success: false,
          toolName: 'manage_memory',
          result: null,
          displayMessage: `Acción desconocida: ${action}. Acciones: save_memory, update_relationship, get_memories`,
          error: `Unknown action: ${action}`,
        };
    }
  } catch (error) {
    return {
      success: false,
      toolName: 'manage_memory',
      result: null,
      displayMessage: 'Error al gestionar la memoria.',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
