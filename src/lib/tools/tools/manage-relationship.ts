// ============================================
// Tool: Manage Relationship
// ============================================
// Category: in_character
// Lets an LLM character manage its RELATIONSHIP BOND with another character
// or with the user. Follows the server-validate / client-execute pattern:
// this executor only validates and returns a `relationshipActivation`
// payload; the CLIENT applies it via statsSlice.updateRelationship (which
// mirrors `relacion`/`relacion_etapa` into both parties' stats so lorebooks,
// sprites, skills and proactive cases can gate on the bond).

import type { ToolDefinition, ToolContext, ToolExecutionResult } from '../types';
import {
  getRelationship,
  isUserTarget,
  relationshipPairKey,
  DEFAULT_RELATIONSHIP_POINTS,
} from '@/lib/relationships';

export const manageRelationshipTool: ToolDefinition = {
  id: 'manage_relationship',
  name: 'manage_relationship',
  label: 'Gestionar Relación',
  icon: 'Heart',
  description:
    'Gestiona el vínculo afectivo (relación) entre tu personaje y otra persona del roleplay (el usuario u otro personaje). ' +
    'Úsala SIEMPRE que pase algo significativo en la relación: un gesto tierno, un regalo, un beso, una traición, una pelea, ' +
    'una reconciliación, celos, un secreto compartido, etc. También puedes consultar el estado con get_info. ' +
    'La relación va de 0 a 100: 0-15 Extraños, 16-35 Conocidos, 36-60 Amigos, 61-85 Íntimos, 86-100 Pareja. ' +
    'Los cambios de etapa influyen en cómo los personajes se comportan entre sí.',
  category: 'in_character',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'enum',
        enum: ['modify', 'get_info'],
        description: '"modify" para cambiar el vínculo, "get_info" para consultar las relaciones actuales',
        required: true,
      },
      target_character: {
        type: 'string',
        description: 'Nombre de la otra persona (el usuario u otro personaje). Requerido para modify. Para el usuario usa "usuario".',
        required: false,
      },
      delta: {
        type: 'number',
        description: 'Cantidad a sumar (positivo, ej: +10 por un gesto significativo) o restar (negativo, ej: -15 por una traición). Rango típico: ±5 a ±20.',
        required: false,
      },
      set: {
        type: 'number',
        description: 'Fijar el valor absoluto 0-100 (alternativa a delta, usar solo para saltos dramáticos como bodas o rupturas).',
        required: false,
      },
      reason: {
        type: 'string',
        description: 'Motivo breve del cambio (ej: "le regaló su flor favorita", "lo descubrió mintiendo")',
        required: false,
      },
    },
    required: ['action'],
  },
  permissionMode: 'auto',
};

/** Resolve target: user aliases or character by id/name (allCharacters + groupMembers) */
function resolveTarget(
  target: string | undefined,
  context: ToolContext
): { id: string; name: string } | null {
  if (!target) return null;
  if (isUserTarget(target, context.userName)) return { id: '__user__', name: context.userName || 'Usuario' };

  const wanted = target.toLowerCase().trim();
  const candidates = [
    ...(context.allCharacters || []),
  ].map(c => ({ id: c.id, name: c.name }));

  const exact = candidates.find(c => c.id === wanted || c.name.toLowerCase().trim() === wanted);
  if (exact) return exact;

  const firstWord = candidates.find(c => c.name.toLowerCase().trim().split(/\s+/)[0] === wanted);
  if (firstWord) return firstWord;

  return null;
}

export async function manageRelationshipExecutor(
  params: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolExecutionResult> {
  const action = String(params.action || '').toLowerCase().trim();
  const fail = (msg: string, err: string): ToolExecutionResult => ({
    success: false, toolName: 'manage_relationship', result: null, displayMessage: msg, error: err,
  });

  if (!action) return fail('Error: Debes especificar action (modify o get_info).', 'Missing action');

  const relationships = context.sessionStats?.relationships as Record<string, unknown> | undefined;

  // ── get_info: list bonds involving the caller ──
  if (action === 'get_info') {
    const me = context.characterId;
    const lines: string[] = [];
    // bonds with user and with other characters
    const parties = ['__user__', ...(context.allCharacters || []).map(c => c.id).filter(id => id !== me)];
    for (const other of parties) {
      if (other === me) continue;
      const bond = getRelationship(relationships, me, other);
      if (bond) {
        const otherName = other === '__user__' ? (context.userName || 'Usuario')
          : context.allCharacters?.find(c => c.id === other)?.name || other;
        lines.push(`- ${context.characterName} ↔ ${otherName}: ${bond.points}/100 (${bond.stage.label})`);
      }
    }
    if (lines.length === 0) {
      lines.push(`- Sin vínculos registrados todavía (los nuevos vínculos inician en ${DEFAULT_RELATIONSHIP_POINTS}/100 = Conocidos).`);
    }
    return {
      success: true,
      toolName: 'manage_relationship',
      result: { bonds: lines },
      displayMessage: `💜 Relaciones de ${context.characterName}:\n${lines.join('\n')}`,
    };
  }

  if (action !== 'modify') {
    return fail(`Error: Acción desconocida "${action}". Usa modify o get_info.`, 'Invalid action');
  }

  // ── modify ──
  const target = params.target_character ? String(params.target_character).trim() : undefined;
  const delta = typeof params.delta === 'number' ? params.delta : undefined;
  const set = typeof params.set === 'number' ? params.set : undefined;
  const reason = params.reason ? String(params.reason) : undefined;

  if (!target) return fail('Error: modify requiere target_character.', 'Missing target');
  if (delta === undefined && set === undefined) {
    return fail('Error: modify requiere delta o set.', 'Missing delta/set');
  }

  const resolved = resolveTarget(target, context);
  if (!resolved) {
    const options = [context.userName || 'usuario', ...(context.allCharacters || []).filter(c => c.id !== context.characterId).map(c => c.name)];
    return fail(`Error: "${target}" no existe en esta sesión. Opciones: ${options.join(', ')}.`, 'Target not found');
  }
  if (resolved.id === context.characterId) {
    return fail('Error: no puedes modificar la relación contigo mismo.', 'Self target');
  }

  const pairKey = relationshipPairKey(context.characterId, resolved.id);
  const prev = (relationships?.[pairKey] as { points?: number } | undefined)?.points ?? DEFAULT_RELATIONSHIP_POINTS;
  const raw = set !== undefined ? set : prev + (delta ?? 0);
  const newPoints = Math.min(100, Math.max(0, Math.round(raw)));

  const verb = newPoints > prev ? 'mejora' : newPoints < prev ? 'empeora' : 'se mantiene';
  return {
    success: true,
    toolName: 'manage_relationship',
    result: { pairKey, prev, newPoints },
    displayMessage: `💜 Relación ${context.characterName} ↔ ${resolved.name} ${verb}: ${prev} → ${newPoints}${reason ? ` (${reason})` : ''}`,
    relationshipActivation: {
      aId: context.characterId,
      aName: context.characterName,
      bId: resolved.id,
      bName: resolved.name,
      prevPoints: prev,
      newPoints,
      reason: reason || '',
    },
  };
}
