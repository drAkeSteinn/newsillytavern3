// ============================================
// Tool: Modify Stat
// ============================================
// Category: in_character
// Modifies character stats based on LLM decisions
//
// Supports all attribute types (number, keyword, text)
// Supports operators: set (default), add (+), subtract (-)
// Applies min/max clamping for numeric attributes
//
// TWO calling modes:
//   1. Legacy single change: { stat_name, new_value, reason? }
//   2. Batch (preferred):    { changes: [{ stat_name, new_value, reason? }, ...] }
//      → lets the LLM evolve several attributes at once (e.g. lujuria +10,
//        energia -5, adiccion +5 in one call).
//
// Returns statActivations (array) for client-side store updates.
// `statActivation` (first change) is kept for backward compatibility.

import type { ToolDefinition, ToolContext, ToolExecutionResult } from '../types';
import type { StatActivation } from '../types';
import type { AttributeDefinition } from '@/types';

export const modifyStatTool: ToolDefinition = {
  id: 'modify_stat',
  name: 'modify_stat',
  label: 'Modificar Stats',
  icon: 'TrendingUp',
  description:
    'Evoluciona los atributos del personaje según lo que pasa en la escena. ' +
    'Los atributos NO son estáticos: deben cambiar en cada turno cuando la narrativa lo justifique, ' +
    'siguiendo la semántica definida en la lista de atributos del personaje (qué lo sube, qué lo baja y su ritmo). ' +
    'Para atributos numéricos usa operadores: "+10" suma, "-5" resta, "=50" establece un valor exacto. ' +
    'Puedes modificar VARIOS atributos en una sola llamada con el parámetro "changes", ' +
    'y llamar esta herramienta VARIAS veces en el mismo turno. ' +
    'IMPORTANTE: los efectos SE ACUMULAN. Si una acción (manage_action) ya modificó un atributo este turno, ' +
    'usa "+N"/"-N" para sumar o restar sobre el valor actual — NUNCA canceles ese efecto con "=valor" ' +
    'salvo que sea explícitamente tu intención. ' +
    'SOLO modifica atributos que existan en la lista de atributos del personaje: usa exactamente sus keys.',
  category: 'in_character',
  parameters: {
    type: 'object',
    properties: {
      changes: {
        type: 'string',
        description:
          'ARRAY JSON de cambios para modificar VARIOS atributos a la vez (formato preferido). ' +
          'Cada item: {"stat_name": "key_del_atributo", "new_value": "+10" | "-5" | "=50" | "texto", "reason": "motivo narrativo"}. ' +
          'Usa las keys EXACTAS de la lista de atributos del personaje. ' +
          'Ejemplo: [{"stat_name":"atributo_a","new_value":"+10","reason":"motivo narrativo"},{"stat_name":"atributo_b","new_value":"-5","reason":"motivo narrativo"}].',
        required: false,
      },
      stat_name: {
        type: 'string',
        description: 'Nombre o key del stat a modificar (modo single, si no usas "changes"). Puede ser la key exacta o el nombre del atributo.',
        required: false,
      },
      new_value: {
        type: 'string',
        description: 'Nuevo valor del stat (modo single). Números: "50" establece, "+10" suma, "-5" resta. Texto/keyword: el nuevo valor directamente (ej: "feliz", "enojada").',
        required: false,
      },
      reason: {
        type: 'string',
        description: 'Razón narrativa del cambio (modo single).',
        required: false,
      },
    },
    required: [],
  },
  permissionMode: 'auto',
};

/** Clamp a numeric value to attribute min/max bounds */
function clampValue(value: number, attr: AttributeDefinition): number {
  let result = value;
  if (attr.min !== undefined) {
    const minVal = typeof attr.min === 'number' ? attr.min : parseFloat(String(attr.min));
    if (!isNaN(minVal)) result = Math.max(result, minVal);
  }
  if (attr.max !== undefined) {
    const maxVal = typeof attr.max === 'number' ? attr.max : parseFloat(String(attr.max));
    if (!isNaN(maxVal)) result = Math.min(result, maxVal);
  }
  return result;
}

// ============================================
// LLM-friendly matching helpers
// ============================================
// Models frequently misspell attribute keys ("statname" aliases, typos like
// "hambnre", or separators dropped: "hambre_verga" → "hambreverga"). We match
// in 3 passes: exact → normalized (separators stripped) → fuzzy Levenshtein.

/** Strip separators and lowercase so "Hambre_Verga" === "hambreverga". */
function normalizeAttrKey(s: string): string {
  return s.toLowerCase().replace(/[\s_-]/g, '');
}

/** Classic Levenshtein distance (small inputs: attribute lists are tiny). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Max edit distance allowed for fuzzy key matching (0 disables). */
function fuzzyMaxDistance(candidate: string): number {
  if (candidate.length < 4) return 0; // too short to fuzzy-match safely
  if (candidate.length <= 7) return 1;
  return 2;
}

/** One requested change, normalized from either calling mode */
interface RequestedChange {
  statName: string;
  rawValue: string;
  reason: string;
}

interface AppliedChange {
  activation: StatActivation;
  displayLines: string[];
}

/** Apply one change against the LIVE sessionStats (mutates it so subsequent changes stack) */
function applyOneChange(
  change: RequestedChange,
  context: ToolContext,
  sessionStats: ToolContext['sessionStats'],
): AppliedChange {
  const { statsConfig, characterId } = context;
  const statName = change.statName.trim();
  const rawValue = change.rawValue.trim();

  const fail = (msg: string, error: string): AppliedChange => ({
    activation: {
      characterId,
      attributeKey: statName,
      attributeName: statName,
      attributeType: 'text',
      oldValue: undefined,
      newValue: rawValue,
      reason: change.reason,
      failed: true,
      errorMessage: msg,
    } as StatActivation,
    displayLines: [`❌ ${msg}`],
  });

  // Find the matching attribute by key, name, or detection keys.
  // Pass 1: exact (key / name / aliases / detectionTags).
  // Pass 2: normalized (separators stripped, e.g. "niveldecrack" → "nivel_de_crack").
  // Pass 3: fuzzy Levenshtein (LLM typos like "hambnre" or "lujuriaa").
  const normalizedStatName = statName.toLowerCase();
  const normalizedCompact = normalizeAttrKey(statName);
  let matchedAttr: AttributeDefinition | null = null;
  let matchedViaFuzzy: string | null = null;

  const candidateKeys = (attr: AttributeDefinition): string[] =>
    [attr.key, attr.name, ...(attr.keys || [])].filter((k): k is string => Boolean(k));

  for (const attr of statsConfig?.attributes || []) {
    if (attr.key.toLowerCase() === normalizedStatName ||
        attr.name.toLowerCase() === normalizedStatName) {
      matchedAttr = attr;
      break;
    }
    if (attr.keys?.some(k => k.toLowerCase() === normalizedStatName)) {
      matchedAttr = attr;
      break;
    }
    if (attr.detectionTags) {
      const tags = attr.detectionTags.split(',').map(t => t.trim().toLowerCase());
      if (tags.includes(normalizedStatName)) {
        matchedAttr = attr;
        break;
      }
    }
  }

  // Pass 2: separator-insensitive comparison
  if (!matchedAttr) {
    for (const attr of statsConfig?.attributes || []) {
      if (candidateKeys(attr).some(k => normalizeAttrKey(k) === normalizedCompact)) {
        matchedAttr = attr;
        break;
      }
    }
  }

  // Pass 3: fuzzy match against the best (lowest distance) candidate
  if (!matchedAttr) {
    const maxDist = fuzzyMaxDistance(normalizedCompact);
    if (maxDist > 0) {
      let bestDist = maxDist + 1;
      for (const attr of statsConfig?.attributes || []) {
        for (const k of candidateKeys(attr)) {
          const nk = normalizeAttrKey(k);
          if (Math.abs(nk.length - normalizedCompact.length) > maxDist) continue;
          const dist = levenshtein(normalizedCompact, nk);
          if (dist <= maxDist && dist < bestDist) {
            bestDist = dist;
            matchedAttr = attr;
            matchedViaFuzzy = k;
          }
        }
      }
    }
  }

  if (!matchedAttr) {
    const availableStats = (statsConfig?.attributes || []).map(a => {
      const keys = [a.key, ...(a.keys || [])].filter(Boolean);
      const mainTag = a.isMain ? ' 👑 PRINCIPAL' : '';
      return `  - "${a.name}" (key: ${a.key}${keys.length > 1 ? ', alias: ' + keys.slice(1).join(', ') : ''})${mainTag}`;
    });
    return fail(
      `Stat "${statName}" no encontrado. Stats disponibles:\n${availableStats.join('\n')}`,
      'Stat not found',
    );
  }

  // Current value read from the LIVE sessionStats (so batch changes stack correctly)
  const charStats = sessionStats?.characterStats?.[characterId];
  const oldValue = charStats?.attributeValues?.[matchedAttr.key] ?? matchedAttr.defaultValue;

  // Compute new value based on attribute type and operator
  let newValue: number | string;
  let operatorLabel = 'establecido a';
  // Replay metadata: tells the client HOW to reach newValue (delta vs absolute
  // set) so skill costs and tool changes accumulate instead of cancelling.
  let operator: '+' | '-' | '=' | 'set' = 'set';
  let delta: number | undefined;

  const treatAsNumeric = matchedAttr.type === 'number' ||
    (matchedAttr.type !== 'keyword' && matchedAttr.type !== 'text' && typeof oldValue === 'number');

  if (treatAsNumeric) {
    if (rawValue.startsWith('+')) {
      const deltaVal = parseFloat(rawValue.slice(1));
      if (isNaN(deltaVal)) {
        return fail(`Valor inválido para suma: "${rawValue}". Usa formato "+10" para sumar.`, 'Invalid value for add operation');
      }
      const baseValue = typeof oldValue === 'number' ? oldValue : parseFloat(String(oldValue)) || 0;
      newValue = clampValue(baseValue + deltaVal, matchedAttr);
      operatorLabel = `+${deltaVal}`;
      operator = '+';
      delta = deltaVal;
    } else if (rawValue.startsWith('-')) {
      const deltaVal = parseFloat(rawValue.slice(1));
      if (isNaN(deltaVal)) {
        return fail(`Valor inválido para resta: "${rawValue}". Usa formato "-5" para restar.`, 'Invalid value for subtract operation');
      }
      const baseValue = typeof oldValue === 'number' ? oldValue : parseFloat(String(oldValue)) || 0;
      newValue = clampValue(baseValue - deltaVal, matchedAttr);
      operatorLabel = `-${deltaVal}`;
      operator = '-';
      delta = deltaVal;
    } else if (rawValue.startsWith('=')) {
      const parsed = parseFloat(rawValue.slice(1));
      if (isNaN(parsed)) {
        return fail(`Valor numérico inválido: "${rawValue.slice(1)}".`, 'Invalid numeric value');
      }
      newValue = clampValue(parsed, matchedAttr);
      operator = '=';
    } else {
      const parsed = parseFloat(rawValue);
      if (isNaN(parsed)) {
        return fail(`Valor numérico inválido: "${rawValue}". El atributo "${matchedAttr.name}" es de tipo numérico.`, 'Invalid numeric value for number attribute');
      }
      newValue = clampValue(parsed, matchedAttr);
      operator = '=';
    }
  } else {
    // Keyword or text attribute - set directly
    newValue = rawValue;
    operator = 'set';
  }

  // Build display lines
  const lines = [`📊 **${matchedAttr.name}** (${matchedAttr.key}): ${oldValue} → **${newValue}**${operatorLabel !== 'establecido a' ? ` (${operatorLabel})` : ''}`];
  if (matchedViaFuzzy) lines.push(`   ℹ️ "${statName}" interpretado como "${matchedViaFuzzy}" (coincidencia aproximada)`);
  if (change.reason) lines.push(`   Razón: ${change.reason}`);

  // Clamping warning (all operation types)
  if (treatAsNumeric) {
    const baseValue = typeof oldValue === 'number' ? oldValue : parseFloat(String(oldValue)) || 0;
    let expectedValue: number | null = null;
    if (rawValue.startsWith('+') || rawValue.startsWith('-')) {
      const delta = parseFloat(rawValue.slice(1));
      if (!isNaN(delta)) expectedValue = rawValue.startsWith('+') ? baseValue + delta : baseValue - delta;
    } else if (rawValue.startsWith('=')) {
      const parsed = parseFloat(rawValue.slice(1));
      if (!isNaN(parsed)) expectedValue = parsed;
    } else {
      const parsed = parseFloat(rawValue);
      if (!isNaN(parsed)) expectedValue = parsed;
    }
    if (expectedValue !== null && typeof newValue === 'number' && newValue !== expectedValue) {
      lines.push(`   ⚠️ Limitado por min/max: ${expectedValue} → ${newValue}`);
    }
  }

  if (matchedAttr.isMain) lines.push(`   👑 Atributo principal del personaje`);

  return {
    activation: {
      characterId,
      attributeKey: matchedAttr.key,
      attributeName: matchedAttr.name,
      attributeType: matchedAttr.type || 'number',
      oldValue,
      newValue,
      reason: change.reason || 'llm_tool',
      operator,
      ...(delta !== undefined ? { delta } : {}),
    },
    displayLines: lines,
  };
}

export async function modifyStatExecutor(
  params: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolExecutionResult> {
  const { statsConfig, sessionStats } = context;

  if (!statsConfig?.enabled) {
    return {
      success: false,
      toolName: 'modify_stat',
      result: null,
      displayMessage: 'El sistema de stats no está habilitado para este personaje.',
      error: 'Stats system not enabled',
    };
  }

  // Normalize both calling modes into a list of changes
  const changes: RequestedChange[] = [];
  let changesRaw: unknown = params.changes;

  // LLMs frequently send "changes" as a JSON-encoded STRING instead of a real
  // array (e.g. "{\"changes\":\"[{...}]\"}") — parse it defensively. Also accept
  // a single change object (not wrapped in an array).
  if (typeof changesRaw === 'string') {
    try {
      changesRaw = JSON.parse(changesRaw);
    } catch {
      changesRaw = null;
    }
  }

  if (Array.isArray(changesRaw)) {
    for (const raw of changesRaw) {
      if (raw && typeof raw === 'object') {
        const c = raw as Record<string, unknown>;
        // Tolerate every field alias LLMs invent: stat_name/statName/statname/stat/attribute/attr
        const statName = String(
          c.stat_name ?? c.statName ?? c.statname ?? c.stat ?? c.attribute ?? c.attr ?? '',
        ).trim();
        const rawValue = c.new_value !== undefined ? String(c.new_value).trim()
          : c.newValue !== undefined ? String(c.newValue).trim()
          : c.newvalue !== undefined ? String(c.newvalue).trim()
          : c.value !== undefined ? String(c.value).trim() : '';
        if (statName && rawValue) {
          changes.push({ statName, rawValue, reason: c.reason ? String(c.reason).trim() : '' });
        }
      }
    }
  } else if (changesRaw && typeof changesRaw === 'object') {
    const c = changesRaw as Record<string, unknown>;
    const statName = String(
      c.stat_name ?? c.statName ?? c.statname ?? c.stat ?? c.attribute ?? c.attr ?? '',
    ).trim();
    const rawValue = c.new_value !== undefined ? String(c.new_value).trim()
      : c.newValue !== undefined ? String(c.newValue).trim()
      : c.newvalue !== undefined ? String(c.newvalue).trim()
      : c.value !== undefined ? String(c.value).trim() : '';
    if (statName && rawValue) {
      changes.push({ statName, rawValue, reason: c.reason ? String(c.reason).trim() : '' });
    }
  }

  // Legacy/compat single mode (also works as fallback if "changes" was malformed)
  if (changes.length === 0) {
    const statName = String(
      params.stat_name ?? params.statName ?? params.statname ?? params.stat ?? params.attribute ?? '',
    ).trim();
    const rawValue = params.new_value !== undefined ? String(params.new_value).trim()
      : params.newValue !== undefined ? String(params.newValue).trim()
      : params.newvalue !== undefined ? String(params.newvalue).trim()
      : params.value !== undefined ? String(params.value).trim() : '';
    if (statName && rawValue) {
      changes.push({
        statName,
        rawValue,
        reason: params.reason ? String(params.reason).trim() : '',
      });
    }
  }

  if (changes.length === 0) {
    return {
      success: false,
      toolName: 'modify_stat',
      result: null,
      displayMessage:
        'Debes especificar cambios. Usa "changes" (array) para varios atributos a la vez, ' +
        'o "stat_name" + "new_value" para uno solo.',
      error: 'Missing required parameters: changes or stat_name/new_value',
    };
  }

  // Apply every change against the live sessionStats
  const applied: AppliedChange[] = changes.map(c => applyOneChange(c, context, sessionStats));
  const okActivations = applied.filter(a => !a.activation.failed).map(a => a.activation);

  const allLines = applied.flatMap(a => a.displayLines);
  const failedCount = applied.length - okActivations.length;
  if (failedCount > 0) allLines.push(`⚠️ ${failedCount} cambio(s) no aplicado(s).`);

  const header = okActivations.length > 1
    ? `📊 **${okActivations.length} atributos modificados:**\n`
    : '';

  // Keep working sessionStats in sync so SUBSEQUENT tool calls / rounds read fresh values
  if (sessionStats) {
    for (const act of okActivations) {
      if (!sessionStats.characterStats) sessionStats.characterStats = {};
      if (!sessionStats.characterStats[act.characterId]) {
        sessionStats.characterStats[act.characterId] = {
          attributeValues: {},
          lastUpdated: {},
        } as any;
      }
      const cs = sessionStats.characterStats[act.characterId];
      cs.attributeValues = cs.attributeValues || {};
      cs.attributeValues[act.attributeKey] = act.newValue;
      cs.lastUpdated = cs.lastUpdated || {};
      cs.lastUpdated[act.attributeKey] = Date.now();
    }
    sessionStats.lastModified = Date.now();
  }

  const first = okActivations[0];

  return {
    success: okActivations.length > 0,
    toolName: 'modify_stat',
    result: {
      changes: okActivations.map(a => ({
        stat: a.attributeKey,
        newValue: a.newValue,
        previousValue: a.oldValue ?? null,
        reason: a.reason,
      })),
      failed: failedCount,
    },
    displayMessage: header + allLines.join('\n'),
    // NEW: full list for the stream routes to emit one SSE per change
    statActivations: okActivations,
    // BACKWARD COMPAT: first change (director, use-director, etc.)
    statActivation: first,
    error: failedCount > 0 && okActivations.length === 0 ? 'All changes failed' : undefined,
  };
}
