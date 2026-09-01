// ============================================
// Tool Registry
// ============================================
//
// Central registry for all available tools.
// Each tool has a definition (schema for the LLM)
// and an executor (actual logic).

import type {
  ToolDefinition,
  ToolExecutionResult,
  ToolContext,
  ToolCategory,
  ToolParameterSchema,
} from './types';
import type { KeyResolutionContext } from '@/lib/key-resolver';
import { resolveAllKeys } from '@/lib/key-resolver';

// Executor function signature
export type ToolExecutorFn = (
  params: Record<string, unknown>,
  context: ToolContext,
) => Promise<ToolExecutionResult>;

// Internal registered tool
interface RegisteredTool {
  definition: ToolDefinition;
  executor: ToolExecutorFn;
}

// ============================================
// Registry
// ============================================

const toolRegistry = new Map<string, RegisteredTool>();

/** Register a tool in the registry */
export function registerTool(definition: ToolDefinition, executor: ToolExecutorFn): void {
  toolRegistry.set(definition.id, { definition, executor });
}

/** Get a registered tool by ID */
export function getToolById(id: string): RegisteredTool | undefined {
  return toolRegistry.get(id);
}

/** Get a tool by name (the name sent by the LLM) */
export function getToolByName(name: string): RegisteredTool | undefined {
  for (const [, tool] of toolRegistry) {
    if (tool.definition.name === name) return tool;
  }
  return undefined;
}

/** Get all tool definitions */
export function getAllToolDefinitions(): ToolDefinition[] {
  return Array.from(toolRegistry.values()).map(t => t.definition);
}

/** Get tool definitions by IDs */
export function getToolDefinitionsByIds(ids: string[]): ToolDefinition[] {
  return ids
    .map(id => toolRegistry.get(id)?.definition)
    .filter((d): d is ToolDefinition => !!d);
}

/** Get tools by category */
export function getToolsByCategory(category: ToolCategory): ToolDefinition[] {
  return getAllToolDefinitions().filter(t => t.category === category);
}

/**
 * Tools that only make sense in GROUP chats (they require group context like
 * scene members). These are filtered out of 1-on-1 chat requests so the LLM
 * never sees them outside groups.
 */
export const GROUP_ONLY_TOOL_IDS: string[] = ['manage_scene'];

/**
 * Resolve all {{keys}} in tool definitions (descriptions and parameter descriptions).
 * Returns NEW tool definition objects with resolved descriptions.
 * This should be called ONCE after filtering tools, before passing them to the LLM.
 */
export function resolveToolDefinitionsKeys(
  tools: ToolDefinition[],
  keyContext: KeyResolutionContext,
): ToolDefinition[] {
  if (!tools.length) return tools;

  return tools.map(t => {
    // Resolve main tool description
    const resolvedDescription = resolveAllKeys(t.description, keyContext);

    // Resolve parameter descriptions
    const resolvedProperties: typeof t.parameters.properties = {};
    for (const [key, param] of Object.entries(t.parameters.properties)) {
      resolvedProperties[key] = {
        ...param,
        description: resolveAllKeys(param.description, keyContext),
      };
    }

    return {
      ...t,
      description: resolvedDescription,
      parameters: {
        ...t.parameters,
        properties: resolvedProperties,
      },
    };
  });
}

/**
 * Convert internal ToolParameterSchema to strict JSON Schema.
 * Fixes provider validation errors (xAI/Grok is strict):
 *   - `type: 'enum'` is NOT valid JSON Schema → becomes `type: 'string'` + `enum: [...]`
 *   - per-property `required: boolean` is not part of JSON Schema → stripped
 *     (top-level `required: string[]` is the correct place)
 */
export function toJSONSchemaParameters(parameters: ToolParameterSchema): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(parameters.properties)) {
    const prop: Record<string, unknown> = {};
    if (val.type === 'enum') {
      prop.type = 'string';
      if (Array.isArray(val.enum) && val.enum.length > 0) {
        prop.enum = val.enum;
      }
    } else {
      prop.type = val.type;
    }
    if (val.description) prop.description = val.description;
    if (val.default !== undefined) prop.default = val.default;
    properties[key] = prop;
  }
  return {
    type: 'object',
    properties,
    required: parameters.required,
  };
}

/** Convert tool definitions to OpenAI tools format (strict JSON Schema) */
export function toOpenAITools(tools: ToolDefinition[]) {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: toJSONSchemaParameters(t.parameters),
    },
  }));
}

/** Build the prompt-based tools section for models without native tool calling */
export function buildPromptBasedToolsSection(
  tools: ToolDefinition[],
  characterName?: string,
): string {
  if (tools.length === 0) return '';

  const charRef = characterName ? `, como ${characterName}` : '';
  const charNameMsg = characterName
    ? `Recuerda: estás roleando como ${characterName}. Usa las herramientas cuando la situación del roleplay lo requiera, pero mantén siempre tu personalidad y estilo al responder.`
    : '';

  const lines: string[] = [
    '[HERRAMIENTAS DISPONIBLES]',
    `Eres un personaje en un roleplay${charRef}. Las herramientas te permiten realizar acciones en el mundo del roleplay:`,
    '- Buscar información en internet o en tu memoria',
    '- Tirar dados para resolver acciones',
    '- Modificar stats del personaje (vida, experiencia, etc.)',
    '- Gestionar misiones y objetivos',
    '- Crear recordatorios',
    '- Actualizar relaciones con otros personajes',
    '',
    'INSTRUCCIONES IMPORTANTES:',
    '- USA HERRAMIENTAS para cualquier acción que tenga consecuencias en el mundo del roleplay',
    '- USA HERRAMIENTAS cuando necesites información que no conoces (clima, datos, etc.)',
    '- NUNCA inventes respuestas: usa las herramientas disponibles',
    '- USA HERRAMIENTAS DE STATS cuando ganes/perdas experiencia, salud, etc.',
    '- USA HERRAMIENTAS DE QUESTS para reportar progreso en misiones',
    '- USA HERRAMIENTAS DE MEMORIA para guardar eventos importantes',
    '- USA manage_action ACTIVAMENTE: cada vez que el personaje haga algo más allá de hablar, usa la acción correspondiente. No esperes a que haya misiones u objetivos.',
    '',
    charNameMsg,
    '',
    'FORMATO DE USO:',
    'Para usar una herramienta, incluye EXACTAMENTE este bloque en tu respuesta — sin texto antes ni después:',
    '```tool_call',
    '{"name": "nombre_herramienta", "parameters": {"param1": "valor1"}}',
    '```',
    '',
    'Ejemplos de uso:',
    '```tool_call',
    '{"name": "roll_dice", "parameters": {"dice": "1d20", "label": "Ataque"}}',
    '```',
    '```tool_call',
    '{"name": "modify_stat", "parameters": {"stat_name": "experiencia", "new_value": 150, "reason": "Derroté al dragón"}}',
    '```',
    '```tool_call',
    '{"name": "manage_quest", "parameters": {"action": "report_progress", "quest_name": "rescate", "objective_name": "encontrar_prisionero", "narrative_description": "Encontré al prisionero en la celda"}}',
    '```',
    '',
    'HERRAMIENTAS DISPONIBLES:',
  ];

  for (const tool of tools) {
    const params = Object.entries(tool.parameters.properties)
      .map(([key, val]) => {
        const req = tool.parameters.required.includes(key) ? ' (REQUERIDO)' : ' (opcional)';
        const enumVals = val.enum ? ` [valores: ${val.enum.join(', ')}]` : '';
        return `    - ${key}${enumVals}: ${val.description}${req}`;
      })
      .join('\n');

    lines.push(`- ${tool.name}: ${tool.description}`);
    if (params) lines.push(params);
    lines.push('');
  }

  lines.push('REGLAS IMPORTANTES:');
  lines.push('1. Cuando uses una herramienta, TU respuesta debe ser SOLO el bloque ```tool_call```. No agregues texto antes ni después del bloque.');
  lines.push('2. Si el usuario NO pide algo que requiera una herramienta (ej: una conversación normal de roleplay), responde normalmente SIN usar ```tool_call```.');
  lines.push('3. Después de usar una herramienta, el sistema te dará el resultado y podrás responder al usuario con esa información — SIEMPRE respondiendo en personaje.');
  lines.push('4. NUNCA inventes datos que podrías obtener con una herramienta. Siempre usa la herramienta correspondiente.');
  lines.push('5. Al recibir los resultados de una herramienta, intégralos naturalmente en tu respuesta de roleplay. No menciones que usaste una herramienta ni el proceso interno.');
  lines.push('6. USA modify_stat para cualquier cambio de stats: experiencia ganada, daño recibido, curación, etc.');
  lines.push('7. USA manage_quest para reportar cuando completes un objetivo o avances en una misión.');
  lines.push('8. USA manage_memory para guardar eventos importantes del roleplay.');

  lines.push('');
  lines.push('GUÍA DE TIPOS DE MEMORIA:');
  lines.push('- hecho: Información factual estática (nombre, posesión, característica, habilidad)');
  lines.push('- evento: Algo que sucedió o va a suceder (batalla, reunión, ceremonia)');
  lines.push('- relacion: Vínculo entre personajes (confianza, enemistad, alianza)');
  lines.push('- preferencia: Gustos, disgustos, hábitos del personaje');
  lines.push('- secreto: Información oculta o sensible que el personaje guarda');
  lines.push('- otro: No encaja en las categorías anteriores');

  return lines.join('\n');
}

/** Execute a tool by name */
export async function executeTool(
  toolName: string,
  params: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolExecutionResult> {
  const tool = getToolByName(toolName);

  if (!tool) {
    return {
      success: false,
      toolName,
      result: null,
      displayMessage: `Herramienta "${toolName}" no encontrada`,
      error: 'TOOL_NOT_FOUND',
    };
  }

  // Check permission mode - 'ask' tools are logged but not blocked here
  // (actual permission handling is done on the client side)

  const startTime = Date.now();

  try {
    const result = await tool.executor(params, context);
    return {
      ...result,
      toolName,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      toolName,
      result: null,
      displayMessage: `Error ejecutando "${toolName}"`,
      error: error instanceof Error ? error.message : 'Unknown error',
      duration: Date.now() - startTime,
    };
  }
}

// ============================================
// Tool Result Summarizer — builds a human-readable tooltip
// ============================================

/**
 * Build a concise, human-readable summary of what a tool changed.
 * This is shown in the message bubble tooltip so the user understands
 * what happened (e.g., "Lujuria: 55 → 70 (+15)" instead of just "Modificar Stat").
 */
export function summarizeToolResult(result: ToolExecutionResult, params?: Record<string, unknown>): string {
  if (!result.success) {
    return `❌ ${result.displayMessage || result.error || 'Error'}`;
  }

  const parts: string[] = [];

  // Stat modification
  if (result.statActivation) {
    const sa = result.statActivation;
    const oldVal = sa.oldValue ?? '?';
    const newVal = sa.newValue;
    const arrow = oldVal !== newVal ? ` → ${newVal}` : ` = ${newVal}`;
    let delta = '';
    if (typeof oldVal === 'number' && typeof newVal === 'number') {
      const diff = newVal - oldVal;
      if (diff > 0) delta = ` (+${diff})`;
      else if (diff < 0) delta = ` (${diff})`;
    }
    parts.push(`${sa.attributeName}: ${oldVal}${arrow}${delta}`);
    if (sa.reason) parts.push(`Razón: ${sa.reason}`);
  }

  // Relationship modification
  if (result.relationshipActivation) {
    const ra = result.relationshipActivation;
    const diff = ra.newPoints - ra.prevPoints;
    const delta = diff > 0 ? ` (+${diff})` : diff < 0 ? ` (${diff})` : '';
    parts.push(`Relación ${ra.aName} ↔ ${ra.bName}: ${ra.prevPoints} → ${ra.newPoints}${delta}`);
    if (ra.reason) parts.push(`Razón: ${ra.reason}`);
  }

  // Scene change
  if (result.sceneActivation) {
    const sc = result.sceneActivation;
    if (sc.type === 'scene_change') {
      const action = sc.action === 'enter' ? 'entró a' : sc.action === 'leave' ? 'salió de' : 'enfocó';
      parts.push(`${sc.characterName} ${action} la escena`);
      if (sc.narrative) parts.push(sc.narrative);
    } else if (sc.type === 'scene_focus') {
      parts.push(`Enfoque en ${sc.characterName}`);
    }
  }

  // Quest activation
  if (result.questActivation) {
    const qa = result.questActivation;
    const action = qa.type === 'activate_quest' ? 'Quest activado' : qa.type === 'complete_objective' ? 'Objetivo completado' : 'Objetivo progresado';
    parts.push(`${action}: ${qa.key}`);
  }

  // Solicitud/peticion activation
  if (result.solicitudActivation) {
    const sol = result.solicitudActivation;
    if (sol.type === 'create_solicitud') {
      parts.push(`Solicitud creada: ${sol.fromCharacterName} → ${sol.targetCharacterName || 'usuario'}`);
    } else {
      parts.push(`Solicitud completada: ${sol.solicitudKey}`);
    }
    if (sol.description) parts.push(sol.description);
  }

  // Action/skill activation
  if (result.actionActivation) {
    const aa = result.actionActivation;
    parts.push(`Acción: ${aa.skillName}`);
    if (aa.skillCompletedDescription) parts.push(aa.skillCompletedDescription);
  }

  // Skill check
  if (result.checkActivation) {
    const ca = result.checkActivation;
    parts.push(`Check ${ca.statName} (d20=${ca.roll}${ca.modifier ? (ca.modifier >= 0 ? `+${ca.modifier}` : `${ca.modifier}`) : ''} vs DC ${ca.dc}) = ${ca.total} → ${ca.outcomeLabel}`);
    if (ca.narrative) parts.push(ca.narrative);
  }

  // Time activation
  if (result.timeActivation) {
    const ta = result.timeActivation;
    if (ta.type === 'advance' && ta.minutes) {
      parts.push(`Tiempo avanzado: +${ta.minutes} min`);
    } else if (ta.type === 'set_hour') {
      parts.push(`Hora: ${ta.hour}:${String(ta.minute || 0).padStart(2, '0')}`);
    } else if (ta.type === 'set_season') {
      parts.push(`Estación: ${ta.season}`);
    }
  }

  // Memory activation
  if (result.memoryActivation) {
    const ma = result.memoryActivation;
    if (ma.type === 'save_memory' && ma.eventData) {
      parts.push(`Recuerdo guardado: ${ma.eventData.content.slice(0, 60)}`);
    } else if (ma.type === 'update_relationship' && ma.relationshipData) {
      parts.push(`Relación actualizada: ${ma.relationshipData.targetName} (${ma.relationshipData.relationship})`);
    } else if (ma.type === 'save_note' && ma.noteContent) {
      parts.push(`Nota: ${ma.noteContent.slice(0, 60)}`);
    } else if (ma.type === 'delete_memory') {
      parts.push(`Recuerdo eliminado`);
    }
  }

  // Wardrobe activation
  if (result.wardrobeActivation) {
    const wa = result.wardrobeActivation;
    if (wa.action === 'get_info') {
      parts.push(`Vestuario actual: ${wa.newLevelName} (offset ${wa.newOffset >= 0 ? '+' : ''}${wa.newOffset})`);
    } else if (wa.changed) {
      const actionLabel = wa.action === 'escalate' ? 'Escalado' : wa.action === 'regress' ? 'Regresado' : 'Reseteado';
      parts.push(`Vestuario ${actionLabel}: → ${wa.newLevelName}`);
      if (wa.reason) parts.push(`Razón: ${wa.reason}`);
    } else {
      parts.push(`Vestuario: ${wa.newLevelName} (sin cambio)`);
    }
  }

  // Fallback: if no specific activation was detected, show the displayMessage (first 2 lines)
  if (parts.length === 0) {
    // For tools like roll_dice, search_web, search_memory, get_weather, set_reminder, etc.
    // Use the displayMessage which already has a human-readable summary
    const msg = result.displayMessage?.trim();
    if (msg) {
      // Take first 2 non-empty lines to keep the tooltip compact
      const lines = msg.split('\n').filter(l => l.trim()).slice(0, 3);
      return lines.join('\n');
    }
    return 'Herramienta ejecutada';
  }

  return parts.join('\n');
}

// ============================================
// Auto-register all built-in tools
// ============================================

import { rollDiceTool, rollDiceExecutor } from './tools/roll-dice';
import { searchMemoryTool, searchMemoryExecutor } from './tools/search-memory';
import { getWeatherTool, getWeatherExecutor } from './tools/get-weather';
import { searchWebTool, searchWebExecutor } from './tools/search-web';
import { setReminderTool, setReminderExecutor } from './tools/set-reminder';
import { modifyStatTool, modifyStatExecutor } from './tools/modify-stat';
import { checkStatTool, checkStatExecutor } from './tools/check-stat';
import { manageQuestTool, manageQuestExecutor } from './tools/manage-quest';
import { manageSolicitudTool, manageSolicitudExecutor } from './tools/manage-solicitud';
import { manageMemoryTool, manageMemoryExecutor } from './tools/manage-memory';
import { manageActionTool, manageActionExecutor } from './tools/manage-action';
import { manageSceneTool, manageSceneExecutor } from './tools/manage-scene';
import { manageRelationshipTool, manageRelationshipExecutor } from './tools/manage-relationship';
import { skillCheckTool, skillCheckExecutor } from './tools/skill-check';
import { manageTimeTool, manageTimeExecutor } from './tools/manage-time';
import { manageWardrobeTool, manageWardrobeExecutor } from './tools/manage-wardrobe';

// Register built-in tools
registerTool(rollDiceTool, rollDiceExecutor);
registerTool(searchMemoryTool, searchMemoryExecutor);
registerTool(getWeatherTool, getWeatherExecutor);
registerTool(searchWebTool, searchWebExecutor);
registerTool(setReminderTool, setReminderExecutor);
registerTool(modifyStatTool, modifyStatExecutor);
registerTool(checkStatTool, checkStatExecutor);
registerTool(manageQuestTool, manageQuestExecutor);
registerTool(manageSolicitudTool, manageSolicitudExecutor);
registerTool(manageMemoryTool, manageMemoryExecutor);
registerTool(manageActionTool, manageActionExecutor);
registerTool(manageSceneTool, manageSceneExecutor);
registerTool(manageRelationshipTool, manageRelationshipExecutor);
registerTool(skillCheckTool, skillCheckExecutor);
registerTool(manageTimeTool, manageTimeExecutor);
registerTool(manageWardrobeTool, manageWardrobeExecutor);

console.log(`[Tools] Registered ${toolRegistry.size} built-in tools: ${Array.from(toolRegistry.keys()).join(', ')}`);
