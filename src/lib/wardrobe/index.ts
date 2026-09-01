// ============================================
// Wardrobe System — Utility Functions (FASE 12)
// ============================================
//
// Resolves the current wardrobe level based on:
// 1. The character's main attribute value (determines base level)
// 2. A session-state offset (shifts ±1 from base, set by manage_wardrobe tool)
//
// The effective level = clamp(baseIndex + offset, 0, levels.length - 1)
// The {{wardrobe}} key resolves to the effective level's content.

import type { WardrobeConfig, WardrobeLevel, AttributeDefinition, SessionStats, CharacterCard } from '@/types';

/**
 * Get sorted levels (ascending by threshold).
 * Levels should be sorted so that the "highest threshold <= attrValue" is the base.
 */
export function getSortedLevels(config: WardrobeConfig | undefined): WardrobeLevel[] {
  if (!config?.enabled || !config.levels || config.levels.length === 0) return [];
  return [...config.levels].sort((a, b) => a.threshold - b.threshold);
}

/**
 * Find the main attribute definition for a character.
 * Returns the attribute marked with isMain=true, or null if none.
 */
export function getMainAttribute(character: CharacterCard | undefined): AttributeDefinition | null {
  if (!character?.statsConfig?.enabled || !character.statsConfig.attributes) return null;
  const main = character.statsConfig.attributes.find(a => a.isMain === true);
  return main || null;
}

/**
 * Get the current value of the main attribute from session stats.
 */
export function getMainAttributeValue(
  character: CharacterCard | undefined,
  sessionStats: SessionStats | null | undefined,
  characterId: string | undefined
): number | null {
  const mainAttr = getMainAttribute(character);
  if (!mainAttr) return null;

  if (!characterId || !sessionStats) {
    const val = mainAttr.defaultValue;
    return typeof val === 'number' ? val : parseFloat(String(val)) || 0;
  }

  const charStats = sessionStats.characterStats?.[characterId];
  const val = charStats?.attributeValues?.[mainAttr.key];
  if (val === undefined) {
    const def = mainAttr.defaultValue;
    return typeof def === 'number' ? def : parseFloat(String(def)) || 0;
  }
  return typeof val === 'number' ? val : parseFloat(String(val)) || 0;
}

/**
 * Find the base wardrobe level index — the highest threshold <= attrValue.
 * If attrValue is below all thresholds, returns 0 (lowest level).
 * If attrValue is above all thresholds, returns the last index (highest level).
 */
export function getBaseLevelIndex(
  levels: WardrobeLevel[],
  attrValue: number
): number {
  if (levels.length === 0) return 0;
  let baseIndex = 0;
  for (let i = 0; i < levels.length; i++) {
    if (attrValue >= levels[i].threshold) {
      baseIndex = i;
    } else {
      break;
    }
  }
  return baseIndex;
}

/**
 * Get the current wardrobe offset from session stats.
 * Offset is stored per-character in CharacterSessionStats.wardrobeOffset.
 * Default is 0 (follow the attribute).
 */
export function getWardrobeOffset(
  sessionStats: SessionStats | null | undefined,
  characterId: string | undefined
): number {
  if (!sessionStats || !characterId) return 0;
  return sessionStats.characterStats?.[characterId]?.wardrobeOffset ?? 0;
}

/**
 * Resolve the effective wardrobe level.
 *
 * @returns The effective WardrobeLevel, or null if wardrobe is not configured.
 */
export function resolveWardrobeLevel(
  character: CharacterCard | undefined,
  sessionStats: SessionStats | null | undefined,
  characterId: string | undefined
): { level: WardrobeLevel; baseIndex: number; effectiveIndex: number; offset: number } | null {
  const config = character?.wardrobeConfig;
  const levels = getSortedLevels(config);
  if (levels.length === 0) return null;

  // Get the main attribute value
  const attrValue = getMainAttributeValue(character, sessionStats, characterId);
  if (attrValue === null) return null;

  // Find base level
  const baseIndex = getBaseLevelIndex(levels, attrValue);

  // Apply offset
  const offset = getWardrobeOffset(sessionStats, characterId);
  const effectiveIndex = Math.max(0, Math.min(levels.length - 1, baseIndex + offset));

  return {
    level: levels[effectiveIndex],
    baseIndex,
    effectiveIndex,
    offset,
  };
}

/**
 * Resolve the {{wardrobe}} key to the current wardrobe content.
 * Returns the content string, or empty string if wardrobe is not configured.
 *
 * The content is wrapped in the block header (default: [VESTUARIO]) if non-empty.
 */
export function resolveWardrobeKey(
  character: CharacterCard | undefined,
  sessionStats: SessionStats | null | undefined,
  characterId: string | undefined
): string {
  const resolved = resolveWardrobeLevel(character, sessionStats, characterId);
  if (!resolved) return '';

  const config = character?.wardrobeConfig;
  const header = config?.blockHeader || '[VESTUARIO]';
  const content = resolved.level.content?.trim();
  if (!content) return '';

  return `${header}\n${content}`;
}

/**
 * Get wardrobe info for the manage_wardrobe tool.
 * Returns the current level, the level above (if exists), and the level below (if exists).
 *
 * The tool uses this to decide whether to escalate or regress.
 */
export function getWardrobeInfo(
  character: CharacterCard | undefined,
  sessionStats: SessionStats | null | undefined,
  characterId: string | undefined
): {
  current: WardrobeLevel | null;
  above: WardrobeLevel | null;
  below: WardrobeLevel | null;
  baseIndex: number;
  effectiveIndex: number;
  offset: number;
  totalLevels: number;
} | null {
  const config = character?.wardrobeConfig;
  const levels = getSortedLevels(config);
  if (levels.length === 0) return null;

  const attrValue = getMainAttributeValue(character, sessionStats, characterId);
  if (attrValue === null) return null;

  const baseIndex = getBaseLevelIndex(levels, attrValue);
  const offset = getWardrobeOffset(sessionStats, characterId);
  const effectiveIndex = Math.max(0, Math.min(levels.length - 1, baseIndex + offset));

  return {
    current: levels[effectiveIndex],
    above: effectiveIndex < levels.length - 1 ? levels[effectiveIndex + 1] : null,
    below: effectiveIndex > 0 ? levels[effectiveIndex - 1] : null,
    baseIndex,
    effectiveIndex,
    offset,
    totalLevels: levels.length,
  };
}

/**
 * Check if wardrobe is available for a character.
 * Wardrobe requires:
 * 1. wardrobeConfig.enabled === true
 * 2. At least 2 levels (escalation/regression needs somewhere to go)
 * 3. A main attribute (isMain=true) to determine the base level
 */
export function isWardrobeAvailable(character: CharacterCard | undefined): boolean {
  if (!character) return false;
  const config = character.wardrobeConfig;
  if (!config?.enabled) return false;
  const levels = getSortedLevels(config);
  if (levels.length < 2) return false;
  const mainAttr = getMainAttribute(character);
  if (!mainAttr) return false;
  return true;
}
