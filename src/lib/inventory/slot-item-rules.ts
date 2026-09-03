// ============================================
// Slot Item Rules — lorebook-style conditions for equipment slots
// ============================================
//
// FASE 20. Each CharacterSlotDefinition can carry `itemRules`: per-item rules
// that bind an inventory item to conditions evaluated against the slot OWNER's
// attribute (exactly like attribute-based lorebook entries).
//
// This module holds the PURE logic (no store imports — everything receives
// plain data or a state-like object) so it can be reused by:
//   - The slots editor UI (defaults, helper metadata)
//   - inventorySlice (runtime activation / deactivation / per-turn tick)
//
// State mutation (updateCharacterStat / applyTriggerForCharacter) lives in
// inventorySlice.ts, which has access to the existing apply/fallback helpers.

import type {
  AttributeComparator,
  SlotItemRule,
  SlotItemCondition,
  SlotConditionEffect,
  SlotAttributeEffect,
  SlotSpriteEffect,
  ActiveSlotRuleState,
  CharacterSlotDefinition,
  AttributeDefinition,
  EquipmentSlotDefinition,
} from '@/types';
import { evaluateCondition } from '@/lib/attributes/condition-evaluator';

// ============================================
// Types
// ============================================

/** Where a resolved rule lives, plus whose stats should be read. */
export interface SlotRuleResolution {
  rule: SlotItemRule;
  /** Stats ID whose attribute is evaluated: '__user__' (persona) or a character ID. */
  ownerStatId: string;
  /** Entity whose slotDefinitions contain the rule. */
  ruleSourceKind: 'persona' | 'character';
  ruleSourceId: string;
}

/** Minimal shape of personas/characters the resolvers need. */
export interface SlotRulePersona {
  id: string;
  slotDefinitions?: CharacterSlotDefinition[];
  equipmentSlots?: EquipmentSlotDefinition[];
}

export interface SlotRuleCharacter extends SlotRulePersona {
  name?: string;
  spritePacksV2?: Array<{
    id: string;
    name: string;
    sprites: Array<{ id: string; label: string; url: string }>;
  }>;
}

// ============================================
// Evaluation (lorebook-style)
// ============================================

/**
 * Evaluate a slot item rule against the current attribute value.
 * Returns the matching conditions sorted by priority (highest first):
 * - 'first-match' resolution → at most one condition (the highest priority match)
 * - 'concat-all' (default) → all matching conditions in priority order
 */
export function evaluateSlotItemRule(
  rule: SlotItemRule,
  attributeValue: number | string | null | undefined
): SlotItemCondition[] {
  if (!rule?.conditions?.length) return [];

  const matched = rule.conditions.filter(cond =>
    evaluateCondition(attributeValue, cond.comparator as AttributeComparator, cond.value)
  );

  if (matched.length === 0) return [];

  const sorted = [...matched].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  if (rule.resolution === 'first-match') {
    return sorted.slice(0, 1);
  }
  return sorted;
}

/**
 * Get the "winner" condition of an evaluation — the highest-priority match.
 * Used to pick which activation / end message is sent to the chat.
 */
export function getWinnerCondition(conditions: SlotItemCondition[]): SlotItemCondition | null {
  if (!conditions.length) return null;
  // Already sorted by priority in evaluateSlotItemRule; defensive sort anyway.
  const sorted = [...conditions].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  return sorted[0];
}

// ============================================
// Rule resolution (persona / character slotDefinitions)
// ============================================

/**
 * Find the item rule for a slot, preferring the target character's own slot
 * definitions (when the item is equipped/used ON a character) and falling back
 * to the persona's slot definitions.
 */
export function resolveSlotItemRule(
  personas: SlotRulePersona[],
  characters: SlotRuleCharacter[],
  opts: {
    personaId: string;
    slotId: string;
    itemId: string;
    /** Character the item is equipped on / used on (if any). */
    targetCharacterId?: string;
  }
): SlotRuleResolution | null {
  const { personaId, slotId, itemId, targetCharacterId } = opts;

  // 1. Target character's own slot definitions (items equipped ON the character)
  if (targetCharacterId && targetCharacterId !== '__user__') {
    const character = characters.find(c => c.id === targetCharacterId);
    const rule = findRuleInDefinitions(character?.slotDefinitions, slotId, itemId, character?.equipmentSlots);
    if (rule) {
      return {
        rule,
        ownerStatId: targetCharacterId,
        ruleSourceKind: 'character',
        ruleSourceId: targetCharacterId,
      };
    }
  }

  // 2. Persona's slot definitions
  const persona = personas.find(p => p.id === personaId);
  const rule = findRuleInDefinitions(persona?.slotDefinitions, slotId, itemId, persona?.equipmentSlots);
  if (rule) {
    return {
      rule,
      ownerStatId: '__user__',
      ruleSourceKind: 'persona',
      ruleSourceId: personaId,
    };
  }

  return null;
}

/**
 * Find the FIRST rule for an item across ALL slots of a persona (and optionally
 * a target character). Used for consumables, which are not equipped in a slot:
 * the rule can live in any slot of the owner.
 */
export function resolveSlotItemRuleAnySlot(
  personas: SlotRulePersona[],
  characters: SlotRuleCharacter[],
  opts: {
    personaId: string;
    itemId: string;
    targetCharacterId?: string;
  }
): SlotRuleResolution | null {
  const { personaId, itemId, targetCharacterId } = opts;

  if (targetCharacterId && targetCharacterId !== '__user__') {
    const character = characters.find(c => c.id === targetCharacterId);
    const found = findRuleAnySlot(character?.slotDefinitions, itemId);
    if (found) {
      return {
        rule: found.rule,
        ownerStatId: targetCharacterId,
        ruleSourceKind: 'character',
        ruleSourceId: targetCharacterId,
      };
    }
  }

  const persona = personas.find(p => p.id === personaId);
  const found = findRuleAnySlot(persona?.slotDefinitions, itemId);
  if (found) {
    return {
      rule: found.rule,
      ownerStatId: '__user__',
      ruleSourceKind: 'persona',
      ruleSourceId: personaId,
    };
  }

  return null;
}

/** Re-resolve the live rule referenced by an ActiveSlotRuleState. */
export function resolveRuleFromRuleState(
  personas: SlotRulePersona[],
  characters: SlotRuleCharacter[],
  ruleState: ActiveSlotRuleState,
  itemId: string
): SlotItemRule | null {
  const source = ruleState.ruleSourceKind === 'character'
    ? characters.find(c => c.id === ruleState.ruleSourceId)
    : personas.find(p => p.id === ruleState.ruleSourceId);

  if (!source?.slotDefinitions) return null;

  if (ruleState.slotId) {
    return findRuleInDefinitions(source.slotDefinitions, ruleState.slotId, itemId, source.equipmentSlots);
  }
  return findRuleAnySlot(source.slotDefinitions, itemId)?.rule || null;
}

// ============================================
// Internal helpers
// ============================================

/**
 * Find the item rule for a slot within a set of slot definitions.
 * Matches by slot ID first; falls back to matching the slot by KEY
 * (the caller may pass a raw slot key, e.g. a legacy Item.slot value,
 * that matches one of the entity's equipment slot keys).
 */
function findRuleInDefinitions(
  definitions: CharacterSlotDefinition[] | undefined,
  slotId: string,
  itemId: string,
  equipmentSlots?: EquipmentSlotDefinition[]
): SlotItemRule | null {
  if (!definitions || !slotId) return null;
  let def = definitions.find(d => d.slotId === slotId);
  if (!def && equipmentSlots?.length) {
    const slot = equipmentSlots.find(s => s.key === slotId || s.id === slotId);
    if (slot) def = definitions.find(d => d.slotId === slot.id);
  }
  return def?.itemRules?.find(r => r.itemId === itemId) || null;
}

function findRuleAnySlot(
  definitions: CharacterSlotDefinition[] | undefined,
  itemId: string
): { rule: SlotItemRule; slotId: string } | null {
  if (!definitions) return null;
  for (const def of definitions) {
    const rule = def.itemRules?.find(r => r.itemId === itemId);
    if (rule) return { rule, slotId: def.slotId };
  }
  return null;
}

// ============================================
// Sprite lookup
// ============================================

export interface CharacterSpriteInfo {
  packId: string;
  packName: string;
  spriteId: string;
  label: string;
  url: string;
}

/** Flatten a character's spritePacksV2 into a sprite list for dropdowns. */
export function getCharacterSprites(character: SlotRuleCharacter | undefined): CharacterSpriteInfo[] {
  if (!character?.spritePacksV2) return [];
  const result: CharacterSpriteInfo[] = [];
  for (const pack of character.spritePacksV2) {
    for (const sprite of pack.sprites || []) {
      result.push({
        packId: pack.id,
        packName: pack.name,
        spriteId: sprite.id,
        label: sprite.label,
        url: sprite.url,
      });
    }
  }
  return result;
}

/** Find a specific sprite (by id) within a character's sprite packs. */
export function findCharacterSprite(
  character: SlotRuleCharacter | undefined,
  spriteId: string
): CharacterSpriteInfo | null {
  if (!spriteId) return null;
  return getCharacterSprites(character).find(s => s.spriteId === spriteId) || null;
}

// ============================================
// Effect helpers
// ============================================

/**
 * Resolve '__self__' to a concrete stats ID.
 * - persona-owned rules → '__user__'
 * - character-owned rules → the character's ID
 */
export function resolveEffectTarget(targetId: string, ownerStatId: string): string {
  if (targetId === '__self__') return ownerStatId;
  return targetId;
}

/** True when the effect has an explicit fallback to revert to. */
export function effectHasFallback(effect: SlotConditionEffect): boolean {
  if (effect.type === 'attribute') {
    return Boolean(effect.fallbackEnabled) && effect.fallbackValue !== undefined;
  }
  return Boolean(effect.fallbackEnabled);
}

// ============================================
// Defaults (used by the editor UI)
// ============================================

export function createDefaultSlotItemRule(
  itemId: string,
  itemName: string,
  attributes: AttributeDefinition[]
): SlotItemRule {
  const attr = attributes[0];
  return {
    itemId,
    itemName,
    attributeKey: attr?.key || '',
    attributeName: attr?.name,
    attributeType: attr?.type || 'number',
    comparisonMode: 'static',
    resolution: 'concat-all',
    conditions: [createDefaultSlotItemCondition()],
  };
}

export function createDefaultSlotItemCondition(): SlotItemCondition {
  return {
    id: generateRuleId('cond'),
    priority: 0,
    comparator: '>=',
    value: 0,
    activationMessage: '',
    endMessage: '',
    effects: [],
  };
}

export function createDefaultAttributeEffect(): SlotAttributeEffect {
  return {
    id: generateRuleId('eff'),
    type: 'attribute',
    targetId: '__self__',
    targetName: 'Dueño del slot',
    attributeKey: '',
    attributeName: '',
    operator: '+',
    value: 1,
  };
}

export function createDefaultSpriteEffect(): SlotSpriteEffect {
  return {
    id: generateRuleId('eff'),
    type: 'sprite',
    targetId: '',
    targetName: '',
    spriteId: '',
    spriteLabel: '',
  };
}

let _idCounter = 0;
function generateRuleId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${_idCounter.toString(36)}`;
}
