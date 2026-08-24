// ============================================
// Tool: Skill Check (dice roll vs stat)
// ============================================
// Category: cognitive
// Resolves UNCERTAIN actions with dice: d20 + stat modifier vs difficulty
// class (DC). Designed primarily against PERSONA stats ({{user}} attributes
// like fuerza/carisma/resistencia), works with any character stat too.
// Follows the server-validate / client-execute pattern: returns a
// `checkActivation` payload; the CLIENT pushes a skill_check event-log entry
// (so every character can react to the outcome) and shows a toast.

import type { ToolDefinition, ToolContext, ToolExecutionResult } from '../types';
import { isUserTarget } from '@/lib/relationships';

export const DIFFICULTY_DC: Record<string, number> = {
  easy: 8,
  medium: 12,
  hard: 16,
  extreme: 19,
};

export const OUTCOME_LABELS: Record<string, string> = {
  critical_success: 'ÉXITO CRÍTICO',
  success: 'ÉXITO',
  partial: 'ÉXITO PARCIAL',
  failure: 'FALLO',
  critical_failure: 'FALLO CRÍTICO',
};

/** d20 roll (isolated for testability) */
export function rollD20(): number {
  return 1 + Math.floor(Math.random() * 20);
}

/** Map a 0-100 stat to a -10..+10 modifier (50 → 0) */
export function statToModifier(value: number | null): number {
  if (value === null) return 0;
  return Math.max(-10, Math.min(10, Math.round((value - 50) / 5)));
}

export const skillCheckTool: ToolDefinition = {
  id: 'skill_check',
  name: 'skill_check',
  label: 'Tirada de Habilidad',
  icon: 'Dices',
  description:
    'Resuelve una acción INCIERTA con una tirada de dados (d20 + modificador del stat vs dificultad). ' +
    'Úsala SIEMPRE que el resultado de una acción no esté garantizado: intentar convencer, seducir, ' +
    'esconderse, resistir un impulso, forcejear, robar, mentir, aguantar, etc. — especialmente acciones ' +
    'del USUARIO contra sus propios stats (fuerza, carisma, resistencia, autocontrol…). ' +
    'Tú narras el resultado según el outcome: critical_success (logra más de lo esperado), ' +
    'success (logra la acción), partial (logra algo a medias o con costo), failure (falla), ' +
    'critical_failure (falla y algo sale peor).',
  category: 'cognitive',
  parameters: {
    type: 'object',
    properties: {
      stat_name: {
        type: 'string',
        description: 'Key del stat que se pone a prueba (ej: "fuerza", "carisma", "resistencia", "autocontrol"). Si no existe, la tirada sale sin modificador.',
        required: false,
      },
      difficulty: {
        type: 'enum',
        enum: ['easy', 'medium', 'hard', 'extreme'],
        description: 'Dificultad: easy (CD 8, rutina con riesgo), medium (CD 12, retador), hard (CD 16, muy difícil), extreme (CD 19, casi imposible)',
        required: false,
      },
      dc: {
        type: 'number',
        description: 'CD personalizada 5-25 (alternativa a difficulty)',
        required: false,
      },
      target_character: {
        type: 'string',
        description: 'Quien intenta la acción. Por defecto (y lo más común): el usuario. Para otro personaje usa su nombre.',
        required: false,
      },
      narrative: {
        type: 'string',
        description: 'Qué se está intentando (ej: "{{user}} intenta zafarse de las ataduras")',
        required: false,
      },
    },
    required: [],
  },
  permissionMode: 'auto',
};

export async function skillCheckExecutor(
  params: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolExecutionResult> {
  const statName = params.stat_name ? String(params.stat_name).toLowerCase().trim() : undefined;
  const difficulty = params.difficulty ? String(params.difficulty).toLowerCase().trim() : 'medium';
  const customDc = typeof params.dc === 'number' ? params.dc : undefined;
  const targetParam = params.target_character ? String(params.target_character).trim() : undefined;
  const narrative = params.narrative ? String(params.narrative) : undefined;

  // Resolve DC
  let dc: number;
  if (customDc !== undefined) {
    dc = Math.min(25, Math.max(5, Math.round(customDc)));
  } else {
    dc = DIFFICULTY_DC[difficulty] ?? DIFFICULTY_DC.medium;
  }

  // Resolve target (default: the user/persona)
  let targetId = '__user__';
  let targetName = context.userName || 'Usuario';
  if (targetParam && !isUserTarget(targetParam, context.userName)) {
    const wanted = targetParam.toLowerCase().trim();
    const found = (context.allCharacters || []).find(
      c => c.id === wanted ||
           c.name.toLowerCase().trim() === wanted ||
           c.name.toLowerCase().trim().split(/\s+/)[0] === wanted
    );
    if (!found) {
      return {
        success: false, toolName: 'skill_check', result: null,
        displayMessage: `Error: "${targetParam}" no existe. Usa "usuario" o el nombre de un personaje.`,
        error: 'Target not found',
      };
    }
    targetId = found.id;
    targetName = found.name;
  }

  // Resolve stat value (if any)
  const attrValue = context.sessionStats?.characterStats?.[targetId]?.attributeValues?.[statName || ''];
  const numeric = typeof attrValue === 'string' ? parseFloat(attrValue) : typeof attrValue === 'number' ? attrValue : NaN;
  const statValue = Number.isFinite(numeric) ? (numeric as number) : null;
  const modifier = statToModifier(statValue);
  const statLabel = statName || 'sin stat';

  // Roll
  const roll = rollD20();
  const total = roll + modifier;

  let outcome: 'critical_success' | 'success' | 'partial' | 'failure' | 'critical_failure';
  if (roll === 20) outcome = 'critical_success';
  else if (roll === 1) outcome = 'critical_failure';
  else if (total >= dc) outcome = 'success';
  else if (total >= dc - 2) outcome = 'partial';
  else outcome = 'failure';

  const label = OUTCOME_LABELS[outcome];
  const modStr = modifier >= 0 ? `+${modifier}` : `${modifier}`;
  const statStr = statValue !== null ? ` (stat ${statValue} → ${modStr})` : ' (sin stat, +0)';

  const lines = [
    `🎲 Tirada ${statLabel} — ${targetName}`,
    `d20(${roll}) ${modifier >= 0 ? '+' : ''}${modifier} = ${total} vs CD ${dc}${statStr}`,
    `Resultado: ${label}`,
  ];
  if (narrative) lines.push(`Acción: ${narrative}`);

  return {
    success: true,
    toolName: 'skill_check',
    result: { roll, modifier, total, dc, outcome },
    displayMessage: lines.join('\n'),
    checkActivation: {
      characterId: targetId,
      characterName: targetName,
      statName: statName || '',
      statValue,
      roll,
      modifier,
      dc,
      total,
      outcome,
      outcomeLabel: label,
      narrative: narrative || '',
    },
  };
}
