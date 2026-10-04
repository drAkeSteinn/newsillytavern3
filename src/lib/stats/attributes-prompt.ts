// ============================================
// Attribute Management Prompt Blocks
// ============================================
// Content of the two resolvable attribute keys, usable anywhere in character
// cards or lorebooks (any position):
//
//   {{attributes}}       → [GESTIÓN DE ATRIBUTOS] header + current attribute list
//                          (name, key, formatted value, 👑 PRINCIPAL badge)
//   {{attributes_rulz}}  → main attribute explanation + rules for using the
//                          "modify_stat" tool (operators, keyword values, etc.)
//
// Both resolve through the unified key resolver (Phase 5.97 in key-resolver.ts)
// exactly like {{vestuario}} / {{escenario}}. There is NO hardcoded fallback:
// if the keys are not placed anywhere, the LLM receives no attribute section.

import type { CharacterCard } from '@/types';
import type { ResolvedStats } from '@/types';

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

/**
 * First part of the block (the {{attributes}} key content):
 *
 * [GESTIÓN DE ATRIBUTOS]
 * Atributos actuales del personaje:
 *   - Lujuria (key: lujuria): Lujuria: (5/100)
 *   - Adicción (key: adiccion): Adicción: (0/100) 👑 PRINCIPAL
 *
 * Returns null when the stats system is disabled or has no attributes.
 */
export function buildAttributesListBlock(
  character: CharacterCard | undefined,
  resolvedStats: ResolvedStats | null | undefined
): string | null {
  if (!character || !isAttributesSystemAvailable(character, resolvedStats)) return null;

  const attrDefs = character.statsConfig!.attributes || [];
  const attrLines = attrDefs.map(a => {
    const formatted = resolvedStats!.attributes[a.key] || `${a.defaultValue}`;
    const mainTag = a.isMain ? ' 👑 PRINCIPAL' : '';
    return `  - ${a.name} (key: ${a.key}): ${formatted}${mainTag}`;
  });

  return `[GESTIÓN DE ATRIBUTOS]\nAtributos actuales del personaje:\n${attrLines.join('\n')}`;
}

/**
 * Second part of the block (the {{attributes_rulz}} key content):
 *
 * El atributo PRINCIPAL de este personaje es "X" (key: y). Los cambios en este
 * atributo afectan significativamente el comportamiento y la narrativa del personaje.
 *
 * INSTRUCCIONES PARA GESTIONAR ATRIBUTOS:
 * - USA la herramienta "modify_stat" ...
 *
 * Returns null when the stats system is disabled or has no attributes.
 * Without a main attribute the explanation line is omitted (rules only).
 */
export function buildAttributesRulesBlock(character: CharacterCard | undefined): string | null {
  if (!character?.statsConfig?.enabled) return null;
  const attrDefs = character.statsConfig.attributes || [];
  if (attrDefs.length === 0) return null;

  const mainAttr = attrDefs.find(a => a.isMain === true);
  const mainLine = mainAttr
    ? `El atributo PRINCIPAL de este personaje es "${mainAttr.name}" (key: ${mainAttr.key}). Los cambios en este atributo afectan significativamente el comportamiento y la narrativa del personaje.\n\n`
    : '';

  return `${mainLine}` +
    `INSTRUCCIONES PARA GESTIONAR ATRIBUTOS:\n` +
    `- USA la herramienta "modify_stat" cuando un evento narrativo deba cambiar un atributo (ej: ganar experiencia, perder vida, recibir daño, cambiar de estado emocional, progresar una relación).\n` +
    `- Para atributos numéricos usa operadores: "+10" suma, "-5" resta, "=50" establece un valor exacto.\n` +
    `- Para atributos de texto/estado (keyword), pasa el nuevo valor directamente (ej: "envenenado", "armado").\n` +
    `- Modifica atributos ACTIVAMENTE cuando la narrativa lo justifique. No esperes a que el usuario lo pida explícitamente.\n` +
    `- Proporciona siempre una "reason" narrativa para el cambio.`;
}
