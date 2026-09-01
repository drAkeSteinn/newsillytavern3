// ============================================
// Tool: Manage Wardrobe
// ============================================
// Category: in_character
// Escalates, regresses, or resets the character's wardrobe level.
//
// The wardrobe is a clothing/outfit system tied to the character's main attribute.
// The base level is determined by the attribute value (like attribute lorebooks),
// and an offset (stored in session stats) can shift it ±1.
//
// The tool can:
// - get_info: see current, above (if exists), and below (if exists) levels
// - escalate: shift offset +1 (one level above current, if above exists)
// - regress: shift offset -1 (one level below current, if below exists)
// - reset: set offset back to 0 (follow the attribute)
//
// After escalating, the next turn's {{wardrobe}} key injects the escalated level
// (no downgrade), and the tool sees the new current + one above (if exists) + one below.

import type { ToolDefinition, ToolContext, ToolExecutionResult } from '../types';
import { getWardrobeInfo, getSortedLevels, isWardrobeAvailable } from '@/lib/wardrobe';

export const manageWardrobeTool: ToolDefinition = {
  id: 'manage_wardrobe',
  name: 'manage_wardrobe',
  label: 'Gestionar Vestuario',
  icon: 'Crown',
  description:
    'Gestiona el vestuario del personaje. Permite ver el estado actual del vestuario, ' +
    'y escalar (subir un nivel), regresar (bajar un nivel) o resetear al nivel base. ' +
    'El vestuario está vinculado al atributo principal del personaje. ' +
    'Usa "get_info" para ver las opciones disponibles, luego "escalate" o "regress" para cambiar.',
  category: 'in_character',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Acción a realizar: "get_info" (ver niveles actual/anterior/siguiente), "escalate" (subir un nivel), "regress" (bajar un nivel), o "reset" (volver al nivel base del atributo).',
        required: true,
        enum: ['get_info', 'escalate', 'regress', 'reset'],
      },
      reason: {
        type: 'string',
        description: 'Razón narrativa del cambio de vestuario (ej: "El personaje se quitó la chaqueta", "Se puso ropa más cómoda").',
        required: false,
      },
    },
    required: ['action'],
  },
  permissionMode: 'auto',
};

export async function manageWardrobeExecutor(
  params: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolExecutionResult> {
  const action = String(params.action || 'get_info').trim().toLowerCase() as 'get_info' | 'escalate' | 'regress' | 'reset';
  const reason = params.reason ? String(params.reason).trim() : '';

  const character = context.character;
  if (!character) {
    return {
      success: false,
      toolName: 'manage_wardrobe',
      result: null,
      displayMessage: 'No hay personaje activo.',
      error: 'No active character',
    };
  }

  if (!isWardrobeAvailable(character)) {
    return {
      success: false,
      toolName: 'manage_wardrobe',
      result: null,
      displayMessage: 'El vestuario no está configurado para este personaje. Necesita un wardrobeConfig habilitado con al menos 2 niveles y un atributo principal.',
      error: 'Wardrobe not available',
    };
  }

  const info = getWardrobeInfo(character, context.sessionStats, context.characterId);
  if (!info) {
    return {
      success: false,
      toolName: 'manage_wardrobe',
      result: null,
      displayMessage: 'No se pudo resolver la información del vestuario.',
      error: 'Wardrobe info unavailable',
    };
  }

  // GET_INFO: return current, above, below
  if (action === 'get_info') {
    const lines = [
      `👗 **Vestuario actual:** ${info.current?.name || 'N/A'}`,
      `   Nivel: ${info.effectiveIndex + 1}/${info.totalLevels} (offset: ${info.offset >= 0 ? '+' : ''}${info.offset})`,
    ];
    if (info.above) {
      lines.push(`⬆️ **Nivel superior disponible:** ${info.above.name}`);
    } else {
      lines.push(`⬆️ No hay nivel superior disponible (ya está al máximo).`);
    }
    if (info.below) {
      lines.push(`⬇️ **Nivel inferior disponible:** ${info.below.name}`);
    } else {
      lines.push(`⬇️ No hay nivel inferior disponible (ya está al mínimo).`);
    }
    lines.push('');
    lines.push('Usa "escalate" para subir un nivel o "regress" para bajar un nivel.');

    return {
      success: true,
      toolName: 'manage_wardrobe',
      result: {
        current: info.current,
        above: info.above,
        below: info.below,
        effectiveIndex: info.effectiveIndex,
        totalLevels: info.totalLevels,
        offset: info.offset,
      },
      displayMessage: lines.join('\n'),
      wardrobeActivation: {
        characterId: context.characterId,
        action: 'get_info',
        newOffset: info.offset,
        previousOffset: info.offset,
        newLevelName: info.current?.name || '',
        newLevelContent: info.current?.content || '',
        changed: false,
        reason: reason || undefined,
      },
    };
  }

  // ESCALATE: shift offset +1 (if above exists)
  if (action === 'escalate') {
    if (!info.above) {
      return {
        success: false,
        toolName: 'manage_wardrobe',
        result: null,
        displayMessage: `No se puede escalar el vestuario: ya está en el nivel máximo ("${info.current?.name}").`,
        error: 'Already at max level',
      };
    }

    const newOffset = info.offset + 1;
    return {
      success: true,
      toolName: 'manage_wardrobe',
      result: {
        action: 'escalate',
        previousLevel: info.current?.name,
        newLevel: info.above.name,
        newOffset,
      },
      displayMessage: `👗 **Vestuario escalado:** "${info.current?.name}" → "${info.above.name}"\n  Nivel anterior: ${info.current?.name}\n  Nuevo nivel: ${info.above.name}${reason ? `\n  Razón: ${reason}` : ''}`,
      wardrobeActivation: {
        characterId: context.characterId,
        action: 'escalate',
        newOffset,
        previousOffset: info.offset,
        newLevelName: info.above.name,
        newLevelContent: info.above.content,
        changed: true,
        reason: reason || undefined,
      },
    };
  }

  // REGRESS: shift offset -1 (if below exists)
  if (action === 'regress') {
    if (!info.below) {
      return {
        success: false,
        toolName: 'manage_wardrobe',
        result: null,
        displayMessage: `No se puede regresar el vestuario: ya está en el nivel mínimo ("${info.current?.name}").`,
        error: 'Already at min level',
      };
    }

    const newOffset = info.offset - 1;
    return {
      success: true,
      toolName: 'manage_wardrobe',
      result: {
        action: 'regress',
        previousLevel: info.current?.name,
        newLevel: info.below.name,
        newOffset,
      },
      displayMessage: `👗 **Vestuario regresado:** "${info.current?.name}" → "${info.below.name}"\n  Nivel anterior: ${info.current?.name}\n  Nuevo nivel: ${info.below.name}${reason ? `\n  Razón: ${reason}` : ''}`,
      wardrobeActivation: {
        characterId: context.characterId,
        action: 'regress',
        newOffset,
        previousOffset: info.offset,
        newLevelName: info.below.name,
        newLevelContent: info.below.content,
        changed: true,
        reason: reason || undefined,
      },
    };
  }

  // RESET: set offset back to 0
  if (action === 'reset') {
    const levels = getSortedLevels(character.wardrobeConfig);
    const baseLevel = levels[info.baseIndex];
    const changed = info.offset !== 0;

    return {
      success: true,
      toolName: 'manage_wardrobe',
      result: {
        action: 'reset',
        previousOffset: info.offset,
        newOffset: 0,
        baseLevel: baseLevel?.name,
      },
      displayMessage: `👗 **Vestuario reseteado** al nivel base del atributo: "${baseLevel?.name || 'N/A'}"${info.offset !== 0 ? `\n  Offset anterior: ${info.offset >= 0 ? '+' : ''}${info.offset} → 0` : ''}${reason ? `\n  Razón: ${reason}` : ''}`,
      wardrobeActivation: {
        characterId: context.characterId,
        action: 'reset',
        newOffset: 0,
        previousOffset: info.offset,
        newLevelName: baseLevel?.name || '',
        newLevelContent: baseLevel?.content || '',
        changed,
        reason: reason || undefined,
      },
    };
  }

  return {
    success: false,
    toolName: 'manage_wardrobe',
    result: null,
    displayMessage: `Acción no reconocida: "${action}". Usa "get_info", "escalate", "regress", o "reset".`,
    error: 'Unknown action',
  };
}
