// ============================================
// Attribute Management Prompt Blocks
// ============================================
// Content of the two resolvable attribute keys, usable anywhere in character
// cards or lorebooks (any position):
//
//   {{attributes}}       → [GESTIÓN DE ATRIBUTOS] header + current attribute list
//                          (name, key, formatted value, 👑 PRINCIPAL badge)
//   {{attributes_rulz}}  → main attribute explanation + DYNAMIC rules for the
//                          "modify_stat" tool.
//
// DYNAMIC STRUCTURE (no hardcoded attribute semantics anymore):
//   1. Main attribute line (👑 PRINCIPAL) if defined.
//   2. Generic mechanics (always valid): operators, "changes" batch format,
//      reason requirement, relation handled by [rel:]/manage_relationship.
//   3. "SEMÁNTICA DE TUS ATRIBUTOS": one line per REAL attribute of THIS
//      character — its llmEssence when defined, otherwise a minimal
//      type/range hint. The LLM can no longer be told to modify attributes
//      that don't exist.
//   4. JSON examples generated with the character's REAL keys (never generic
//      placeholder attributes like "lujuria" for characters without it).
//   5. Anti-invention rule: only listed attributes exist.
//   6. Emotional state line ONLY when the character actually has a keyword
//      attribute that represents it.
//
// Both resolve through the unified key resolver (Phase 5.97 in key-resolver.ts)
// exactly like {{vestuario}} / {{escenario}}. There is NO hardcoded fallback:
// if the keys are not placed anywhere, the LLM receives no attribute section.

import type { CharacterCard } from '@/types';
import type { ResolvedStats } from '@/types';
import type { AttributeDefinition } from '@/types';
import type { SessionStats } from '@/types';
import {
  getRelationship,
  DEFAULT_RELATIONSHIP_POINTS,
  computeRelationshipStage,
} from '@/lib/relationships';

/** Max characters allowed for one essence line (token budget guard). */
const ESSENCE_MAX_LENGTH = 600;

/** True when the stats system is enabled and has at least 1 attribute defined. */
export function isAttributesSystemAvailable(
  character: CharacterCard,
  resolvedStats: ResolvedStats | null | undefined
): boolean {
  return Boolean(
    resolvedStats?.attributes &&
    character.statsConfig?.enabled &&
    (character.statsConfig.attributes || []).length > 0
  );
}

/** Collapse newlines/extra whitespace in a user-authored essence, trim, cap length. */
function sanitizeEssence(raw: string | undefined): string {
  if (!raw) return '';
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= ESSENCE_MAX_LENGTH) return collapsed;
  return collapsed.slice(0, ESSENCE_MAX_LENGTH - 1) + '…';
}

/** Minimal semantic hint for attributes without an authored essence. */
function minimalTypeHint(attr: AttributeDefinition): string {
  if (attr.type === 'number') {
    const min = attr.min !== undefined ? String(attr.min) : '?';
    const max = attr.max !== undefined ? String(attr.max) : '?';
    return `numérico ${min}-${max}`;
  }
  if (attr.type === 'keyword') return 'estado (keyword)';
  return 'texto';
}

/**
 * Compute the current bond with the user for a character (mirrors the
 * {{relacion}} / {{relacion_etapa}} key resolution). Falls back to the
 * default bond (15/100 — Extraños) when no explicit record exists, so the
 * LLM always sees a relationship value inside the attributes block.
 */
function resolveUserBondLine(
  character: CharacterCard | undefined,
  sessionStats: SessionStats | null | undefined,
  characterId: string | undefined,
  userName?: string
): string | null {
  if (!character) return null;
  const customLabels = character.relationshipStageLabels;
  const bond = sessionStats?.relationships
    ? getRelationship(sessionStats.relationships, characterId || '__char__', '__user__', customLabels)
    : null;
  const points = bond?.points ?? DEFAULT_RELATIONSHIP_POINTS;
  const stage = bond?.stage ?? computeRelationshipStage(points, customLabels);
  const target = userName && userName.trim() ? userName : 'el usuario';
  return `  - Relación con ${target} (key: relacion): ${points}/100 — ${stage.label} (gestiónala con [rel:+N motivo] o la herramienta manage_relationship, NO con modify_stat)`;
}

/**
 * First part of the block (the {{attributes}} key content):
 *
 * [GESTIÓN DE ATRIBUTOS]
 * Atributos actuales del personaje:
 *   - Lujuria (key: lujuria): Lujuria: (5/100)
 *   - Adicción (key: adiccion): Adicción: (0/100) 👑 PRINCIPAL
 *   - Relación con {user} (key: relacion): 15/100 — Conocidos
 *
 * The relationship (bond with the user) is now listed as part of the
 * attributes block so the LLM manages it there, since it already mirrors
 * into attributeValues as `relacion` / `relacion_etapa`.
 *
 * Returns null when the stats system is disabled or has no attributes.
 */
export function buildAttributesListBlock(
  character: CharacterCard | undefined,
  resolvedStats: ResolvedStats | null | undefined,
  sessionStats?: SessionStats | null,
  characterId?: string,
  userName?: string
): string | null {
  if (!character || !isAttributesSystemAvailable(character, resolvedStats)) return null;

  const attrDefs = character.statsConfig!.attributes || [];
  const attrLines = attrDefs.map(a => {
    const formatted = resolvedStats!.attributes[a.key] || `${a.defaultValue}`;
    const mainTag = a.isMain ? ' 👑 PRINCIPAL' : '';
    return `  - ${a.name} (key: ${a.key}): ${formatted}${mainTag}`;
  });

  // Append the relationship (bond with the user) as part of the attributes block.
  const bondLine = resolveUserBondLine(character, sessionStats ?? null, characterId, userName);
  if (bondLine) attrLines.push(bondLine);

  return `[GESTIÓN DE ATRIBUTOS]\nAtributos actuales del personaje:\n${attrLines.join('\n')}`;
}

/**
 * Second part of the block (the {{attributes_rulz}} key content) — FULLY DYNAMIC:
 *
 *   El atributo PRINCIPAL de este personaje es "X" (key: y). ...
 *
 *   [EVOLUCIÓN DE ATRIBUTOS — OBLIGATORIO]
 *   ...
 *   SEMÁNTICA DE TUS ATRIBUTOS (única fuente de verdad):
 *     - Adicción (adiccion) 👑: {llmEssence authored in the card}
 *     - Energía (energia): numérico 0-100.
 *   ...
 *   REGLAS DE USO:
 *   - SOLO existen los atributos listados arriba...
 *   - {"changes":[{"stat_name":"<REAL key>","new_value":"+10",...},...]}
 *
 * Returns null when the stats system is disabled or has no attributes.
 */
export function buildAttributesRulesBlock(character: CharacterCard | undefined): string | null {
  if (!character?.statsConfig?.enabled) return null;
  const attrDefs = character.statsConfig.attributes || [];
  if (attrDefs.length === 0) return null;

  // ---------- Main attribute line ----------
  const mainAttr = attrDefs.find(a => a.isMain === true);
  const mainLine = mainAttr
    ? `El atributo PRINCIPAL de este personaje es "${mainAttr.name}" (key: ${mainAttr.key}). Los cambios en este atributo afectan significativamente el comportamiento y la narrativa del personaje.\n\n`
    : '';

  // ---------- Semantics: one line per REAL attribute ----------
  const semanticLines = attrDefs.map(a => {
    const mainTag = a.isMain ? ' 👑' : '';
    const essence = sanitizeEssence(a.llmEssence);
    if (essence) return `  - ${a.name} (${a.key})${mainTag}: ${essence}`;
    return `  - ${a.name} (${a.key})${mainTag}: ${minimalTypeHint(a)}.`;
  });
  const semanticsSection =
    `SEMÁNTICA DE TUS ATRIBUTOS (única fuente de verdad sobre qué significa cada atributo, qué lo sube y qué lo baja):\n` +
    semanticLines.join('\n');

  // ---------- Examples built from the character's REAL keys ----------
  const numericAttrs = attrDefs.filter(a => a.type === 'number');
  const keywordAttrs = attrDefs.filter(a => a.type === 'keyword');

  // Batch example: two distinct keys (prefer numeric; fallback to any).
  const batchPool = numericAttrs.length >= 2 ? numericAttrs : attrDefs;
  const exA = batchPool[0];
  const exB = batchPool.length > 1 ? batchPool[1] : null;

  // Single example: prefer the MAIN attribute (spotlight + avoids picking
  // relation-like attributes that the rules route to [rel:]/manage_relationship),
  // then any numeric key not used in the batch example.
  const singlePool = numericAttrs.filter(a => a.key !== exA.key && a.key !== exB?.key);
  const mainNumeric =
    mainAttr && mainAttr.type === 'number' &&
    mainAttr.key !== exA.key && mainAttr.key !== exB?.key ? mainAttr : undefined;
  const exSingle =
    mainNumeric ??
    singlePool[0] ??
    numericAttrs[0] ??
    (mainAttr && mainAttr.type === 'number' ? mainAttr : undefined) ??
    attrDefs[0];
  const singleValue = exSingle.type === 'number' ? '+5' : 'nuevo_estado';
  const keywordExample = keywordAttrs[0];

  let examplesSection = '';
  if (exB) {
    examplesSection +=
      `- VARIOS atributos a la vez: usa el parámetro "changes" con un array JSON (un item por atributo):\n` +
      `  {"changes":[{"stat_name":"${exA.key}","new_value":"+10","reason":"motivo narrativo"},{"stat_name":"${exB.key}","new_value":"-5","reason":"motivo narrativo"}]}\n`;
  }
  examplesSection +=
    `- Para UN solo atributo también vale el formato corto: {"stat_name":"${exSingle.key}","new_value":"${singleValue}","reason":"..."}.\n`;

  // ---------- Operators line (keyword clause only when relevant) ----------
  let operatorsLine =
    `- Para atributos numéricos usa operadores: "+10" suma, "-5" resta, "=50" establece un valor exacto.`;
  if (keywordExample) {
    operatorsLine += ` Para atributos de texto/estado (keyword) como "${keywordExample.key}": pasa el nuevo valor directamente, ej: {"stat_name":"${keywordExample.key}","new_value":"nuevo_estado"}.`;
  } else if (numericAttrs.length === attrDefs.length) {
    operatorsLine += ` Todos los atributos de este personaje son numéricos: usa siempre operadores.`;
  }
  operatorsLine += '\n';

  // ---------- Emotional state: ONLY when a keyword emotion attribute exists ----------
  const emotionAttr = keywordAttrs.find(a =>
    /emocion|emoci[oó]n|estado|[aá]nimo|humor|sentimiento/i.test(`${a.key} ${a.name}`)
  );
  const emotionLine = emotionAttr
    ? `- El estado emocional del personaje es el atributo keyword "${emotionAttr.key}" (${emotionAttr.name}): cámbialo con modify_stat pasando el nuevo estado directamente cuando la escena lo justifique.\n`
    : '';

  // ---------- Assemble ----------
  return (
    `${mainLine}` +
    `[EVOLUCIÓN DE ATRIBUTOS — OBLIGATORIO]\n` +
    `Los atributos NO son decorativos: son el motor del personaje y DEBEN moverse conforme avanza la escena. Un atributo congelado significa un personaje plano.\n` +
    `AL TERMINAR CADA RESPUESTA, revisa la escena y aplica con la herramienta "modify_stat" los cambios que la narrativa haya justificado.\n\n` +
    `${semanticsSection}\n\n` +
    `REGLAS DE USO:\n` +
    `- SOLO existen los atributos listados arriba: usa exactamente sus keys. Si un evento no corresponde a ninguno, NO llames a modify_stat para ese aspecto. Nunca inventes nombres de atributos.\n` +
    `- Si NADA de lo que pasó en el turno justifica cambiar un atributo, no llames a la herramienta ese turno. Pero si algo cambió y no llamas a modify_stat, el cambio se PIERDE.\n` +
    `- Puedes combinar modify_stat con otras herramientas (manage_action, manage_wardrobe, manage_escenario...) en la misma respuesta.\n` +
    examplesSection +
    operatorsLine +
    emotionLine +
    `- Modifica atributos ACTIVAMENTE cuando la narrativa lo justifique. No esperes a que el usuario lo pida explícitamente.\n` +
    `- Proporciona siempre una "reason" narrativa breve para cada cambio.\n` +
    `- Los cambios de RELACIÓN (vínculo con ${'{user}'}) se aplican con el token [rel:+N motivo] o la herramienta "manage_relationship", no con modify_stat.`
  );
}
