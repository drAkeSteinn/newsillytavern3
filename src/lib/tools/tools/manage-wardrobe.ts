// ============================================
// Tool: Manage Wardrobe (GUARDARROPA V2)
// ============================================
// Category: in_character
// Lets the character manage its own wardrobe: see the available outfits and
// WEAR one by name or id. The worn outfit is stored in the session state
// (activeOutfitId) and its description is injected via {{vestuario}}.
//
// Actions:
// - list:     see the whole wardrobe (names + descriptions + which is worn/default)
// - wear:     put on a specific outfit (by name or id) — the character decides
// - remove:   take off the current outfit (falls back to the default outfit)
// - get_info: details of the currently worn outfit (or a specific one)
//
// After a "wear", the next turn's {{vestuario}} key injects the new outfit's
// description, and the change persists in the session JSON.

import type { ToolDefinition, ToolContext, ToolExecutionResult } from '../types';
import {
  getWardrobeInfo,
  resolveActiveOutfit,
  findOutfitByNameOrId,
  isWardrobeAvailable,
} from '@/lib/wardrobe';

export const manageWardrobeTool: ToolDefinition = {
  id: 'manage_wardrobe',
  name: 'manage_wardrobe',
  label: 'Gestionar Guardarropa',
  icon: 'Shirt',
  description:
    'Gestiona tu guardarropa. Permite ver los outfits disponibles y ponerte el que quieras ' +
    '(por nombre o id), quitarte el actual (vuelves al predeterminado) o ver lo que llevas puesto. ' +
    'La ropa que llevas se inyecta en tu prompt como [VESTUARIO]. ' +
    'Usa "list" para ver el guardarropa y "wear" para ponerte un outfit según la escena.',
  category: 'in_character',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description:
          'Acción a realizar: "list" (ver el guardarropa completo), "wear" (ponerte un outfit concreto), ' +
          '"remove" (quitarte el outfit actual y volver al predeterminado) o "get_info" (detalle del outfit actual o de uno específico).',
        required: true,
        enum: ['list', 'wear', 'remove', 'get_info'],
      },
      outfit: {
        type: 'string',
        description:
          'Nombre o id del outfit (para "wear" y "get_info"). Ej: "Vestido de gala". Debe coincidir con un outfit de tu guardarropa.',
        required: false,
      },
      reason: {
        type: 'string',
        description: 'Razón narrativa del cambio de vestuario (ej: "Se va a dormir", "Llegó a casa y se cambió de ropa").',
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
  const action = String(params.action || 'get_info').trim().toLowerCase() as 'list' | 'wear' | 'remove' | 'get_info';
  const outfitQuery = params.outfit ? String(params.outfit).trim() : '';
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
      displayMessage: 'El guardarropa no está configurado para este personaje. Necesita un wardrobeConfig habilitado con al menos 1 outfit.',
      error: 'Wardrobe not available',
    };
  }

  const info = getWardrobeInfo(character, context.sessionStats, context.characterId);
  if (!info) {
    return {
      success: false,
      toolName: 'manage_wardrobe',
      result: null,
      displayMessage: 'No se pudo resolver la información del guardarropa.',
      error: 'Wardrobe info unavailable',
    };
  }

  const current = info.current;

  // LIST: show the whole wardrobe
  if (action === 'list') {
    const lines = [
      `👕 **Guardarropa de ${character.name}** (${info.totalOutfits} outfits):`,
      '',
    ];
    for (const outfit of info.outfits) {
      const isWorn = current?.id === outfit.id;
      const isDefault = info.defaultId === outfit.id;
      const badges = [
        isWorn ? '← llevado puesto' : '',
        isDefault ? '(predeterminado)' : '',
      ].filter(Boolean).join(' ');
      lines.push(`• "${outfit.name}"${badges ? ` ${badges}` : ''}`);
      if (outfit.description?.trim()) {
        lines.push(`  ${outfit.description.trim()}`);
      }
    }
    lines.push('');
    lines.push('Usa "wear" con el nombre del outfit que quieras ponerte.');

    return {
      success: true,
      toolName: 'manage_wardrobe',
      result: {
        outfits: info.outfits,
        currentOutfitId: current?.id ?? null,
        defaultOutfitId: info.defaultId,
      },
      displayMessage: lines.join('\n'),
      wardrobeActivation: {
        characterId: context.characterId,
        action: 'list',
        outfitId: current?.id ?? null,
        outfitName: current?.name || '',
        outfitDescription: current?.description || '',
        previousOutfitId: current?.id ?? null,
        changed: false,
        reason: reason || undefined,
      },
    };
  }

  // WEAR: put on a specific outfit (by name or id)
  if (action === 'wear') {
    if (!outfitQuery) {
      return {
        success: false,
        toolName: 'manage_wardrobe',
        result: null,
        displayMessage: 'Debes indicar el outfit a ponerte. Usa "list" para ver tu guardarropa.',
        error: 'Missing outfit param',
      };
    }

    const target = findOutfitByNameOrId(info.outfits, outfitQuery);
    if (!target) {
      const available = info.outfits.map(o => `"${o.name}"`).join(', ');
      return {
        success: false,
        toolName: 'manage_wardrobe',
        result: null,
        displayMessage: `No existe el outfit "${outfitQuery}" en tu guardarropa. Outfits disponibles: ${available}.`,
        error: 'Outfit not found',
      };
    }

    const changed = current?.id !== target.id;
    return {
      success: true,
      toolName: 'manage_wardrobe',
      result: {
        action: 'wear',
        outfitId: target.id,
        outfitName: target.name,
        previousOutfit: current?.name ?? null,
      },
      displayMessage: `👗 **${character.name} se puso:** "${target.name}"${current && changed ? `\n  Antes llevaba: "${current.name}"` : ''}${reason ? `\n  Razón: ${reason}` : ''}`,
      wardrobeActivation: {
        characterId: context.characterId,
        action: 'wear',
        outfitId: target.id,
        outfitName: target.name,
        outfitDescription: target.description || '',
        previousOutfitId: current?.id ?? null,
        changed,
        reason: reason || undefined,
      },
    };
  }

  // REMOVE: take off the current outfit → falls back to the default outfit
  if (action === 'remove') {
    if (!current) {
      return {
        success: false,
        toolName: 'manage_wardrobe',
        result: null,
        displayMessage: 'No hay outfit activo que quitarse.',
        error: 'No active outfit',
      };
    }

    const defaultOutfit = info.outfits.find(o => o.id === info.defaultId) || info.outfits[0];
    const changed = current.id !== defaultOutfit.id;

    return {
      success: true,
      toolName: 'manage_wardrobe',
      result: {
        action: 'remove',
        removedOutfit: current.name,
        fallbackOutfit: defaultOutfit.name,
      },
      displayMessage: `👗 **${character.name} se quitó** "${current.name}" → vuelve a su outfit predeterminado "${defaultOutfit.name}"${reason ? `\n  Razón: ${reason}` : ''}`,
      wardrobeActivation: {
        characterId: context.characterId,
        action: 'remove',
        outfitId: changed ? null : current.id,
        outfitName: defaultOutfit.name,
        outfitDescription: defaultOutfit.description || '',
        previousOutfitId: current.id,
        changed,
        reason: reason || undefined,
      },
    };
  }

  // GET_INFO: detail of the worn outfit (or a specific one)
  if (action === 'get_info') {
    const target = outfitQuery ? findOutfitByNameOrId(info.outfits, outfitQuery) : current;
    if (!target) {
      return {
        success: false,
        toolName: 'manage_wardrobe',
        result: null,
        displayMessage: `No existe el outfit "${outfitQuery}" en tu guardarropa. Usa "list" para verlo.`,
        error: 'Outfit not found',
      };
    }

    const lines = [
      target.id === current?.id
        ? `👗 **Vestuario actual:** "${target.name}"`
        : `👗 **Outfit:** "${target.name}" (no puesto)`,
    ];
    if (target.description?.trim()) lines.push(`   ${target.description.trim()}`);
    if (info.defaultId === target.id) lines.push('   (outfit predeterminado)');

    return {
      success: true,
      toolName: 'manage_wardrobe',
      result: {
        outfit: target,
        isWorn: target.id === current?.id,
        isDefault: info.defaultId === target.id,
      },
      displayMessage: lines.join('\n'),
      wardrobeActivation: {
        characterId: context.characterId,
        action: 'get_info',
        outfitId: current?.id ?? null,
        outfitName: current?.name || '',
        outfitDescription: current?.description || '',
        previousOutfitId: current?.id ?? null,
        changed: false,
        reason: reason || undefined,
      },
    };
  }

  // Fallback (shouldn't happen — action is enum-validated)
  const worn = resolveActiveOutfit(character, context.sessionStats, context.characterId);
  return {
    success: false,
    toolName: 'manage_wardrobe',
    result: null,
    displayMessage: `Acción no reconocida: "${action}". Usa "list", "wear", "remove" o "get_info".${worn ? ` Vestuario actual: "${worn.name}".` : ''}`,
    error: 'Unknown action',
  };
}
