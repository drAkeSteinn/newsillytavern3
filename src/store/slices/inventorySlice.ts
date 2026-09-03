// ============================================
// Inventory Slice V2 - Redesigned for persona-based inventory
// ============================================
//
// Key concepts:
// - Items belong to the persona (user), not characters
// - Two item types: consumable (temporary, with duration) and equipment (permanent)
// - Currency ("divisa") is on the persona
// - Consumables modify attributes for N turns, then expire
// - Equipment modifies attributes permanently while equipped
// - Effects are applied BEFORE prompt is built
// - Shop allows buying items with currency
// - Items can be detected in AI messages via triggerKeywords

import type { StateCreator } from 'zustand';
import {
  DEFAULT_INVENTORY_V2_SETTINGS,
  type Item,
  type ItemRarity,
  type ItemAttributeEffect,
  type ItemSlotEffect,
  type ActiveConsumableEffect,
  type PersonaInventoryEntry,
  type InventoryV2Settings,
  type EquipmentSlotDefinition,
  type CharacterSlotDefinition,
  type InventoryNotification,
  type CostOperator,
  type SessionStats,
  type DynamicEquipmentState,
  type SessionEquipmentEntry,
  type SlotConditionEffect,
  type SlotItemCondition,
  type ActiveSlotRuleState,
} from '@/types';
import {
  evaluateSlotItemRule,
  getWinnerCondition,
  resolveSlotItemRule,
  resolveSlotItemRuleAnySlot,
  resolveRuleFromRuleState,
  resolveEffectTarget,
  findCharacterSprite,
} from '@/lib/inventory/slot-item-rules';

// Re-export for convenience
export { DEFAULT_INVENTORY_V2_SETTINGS };

// ============================================
// Helper Functions
// ============================================

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Apply a single item attribute effect to SessionStats via updateCharacterStat.
 * This directly modifies the session stats so the UI reflects the change.
 *
 * Supports both numeric and text/keyword attributes:
 * - Numeric: applies arithmetic operators (+, -, *, /, =, set_min, set_max)
 * - Text/Keyword: only '=' operator is valid, sets the attribute to the string value
 *
 * IMPORTANT: When the character stats for a target don't exist in the session
 * yet (e.g., persona stats were configured after session creation), we must
 * look up the default value from the statsConfig BEFORE computing the effect.
 */
function applyEffectToSessionStats(
  stateAny: any,
  effect: ItemAttributeEffect
): void {
  const sessionId = stateAny.activeSessionId as string | undefined;
  if (!sessionId) return;

  const targetId = effect.targetId || '__user__';

  // Detect if this is a text/keyword attribute by checking the statsConfig
  const attrType = getAttributeType(stateAny, targetId, effect.attributeKey);
  const isTextAttr = attrType === 'text' || attrType === 'keyword';

  // For text/keyword attributes with '=' operator, set the string value directly
  if (isTextAttr && effect.operator === '=') {
    const newValue = typeof effect.value === 'string' ? effect.value : String(effect.value);
    stateAny.updateCharacterStat?.(sessionId, targetId, effect.attributeKey, newValue, 'trigger');
    return;
  }

  // For numeric attributes, proceed with arithmetic operations
  let currentValue = stateAny.getAttributeValue?.(sessionId, targetId, effect.attributeKey);

  // If the attribute doesn't exist yet in session stats, look up the default
  // value from the character's/persona's statsConfig.
  if (currentValue === null || currentValue === undefined) {
    const defaultValue = getDefaultAttributeValue(stateAny, targetId, effect.attributeKey);
    if (defaultValue !== null) {
      currentValue = defaultValue;
    }
  }

  // If still null, default to 0 for numeric operations (truly new attribute)
  const currentNum = (currentValue !== null && currentValue !== undefined)
    ? (typeof currentValue === 'number' ? currentValue : parseFloat(String(currentValue)))
    : 0;

  if (isNaN(currentNum) && currentValue !== null && currentValue !== undefined) {
    // If we can't parse as number but it's a text value with '=' operator, set directly
    if (effect.operator === '=' && typeof effect.value === 'string') {
      stateAny.updateCharacterStat?.(sessionId, targetId, effect.attributeKey, effect.value, 'trigger');
      return;
    }
    return;
  }

  const effectNumValue = typeof effect.value === 'number' ? effect.value : parseFloat(String(effect.value));

  let newValue: number | string = currentNum;
  switch (effect.operator) {
    case '+': newValue = currentNum + effectNumValue; break;
    case '-': newValue = currentNum - effectNumValue; break;
    case '*': newValue = currentNum * effectNumValue; break;
    case '/': newValue = effectNumValue !== 0 ? currentNum / effectNumValue : currentNum; break;
    case '=': newValue = effectNumValue; break;
    case 'set_min': newValue = Math.min(currentNum, effectNumValue); break;
    case 'set_max': newValue = Math.max(currentNum, effectNumValue); break;
  }

  newValue = Math.round((newValue as number) * 100) / 100;

  stateAny.updateCharacterStat?.(sessionId, targetId, effect.attributeKey, newValue, 'trigger');
}

/**
 * Look up the default value for an attribute from the character's/persona's statsConfig.
 * Returns null if no default is found.
 */
function getDefaultAttributeValue(
  stateAny: any,
  targetId: string,
  attributeKey: string
): number | string | null {
  let statsConfig: any = undefined;

  if (targetId === '__user__') {
    const activePersonaId = stateAny.activePersonaId;
    const personas: any[] = stateAny.personas || [];
    const activePersona = personas.find((p: any) => p.id === activePersonaId);
    statsConfig = activePersona?.statsConfig;
  } else {
    const characters: any[] = stateAny.characters || [];
    const character = characters.find((c: any) => c.id === targetId);
    statsConfig = character?.statsConfig;
  }

  if (!statsConfig?.attributes) return null;

  const attrDef = statsConfig.attributes.find((a: any) => a.key === attributeKey);
  if (attrDef && attrDef.defaultValue !== undefined) {
    return attrDef.defaultValue;
  }

  return null;
}

/**
 * Look up the type of an attribute from the character's/persona's statsConfig.
 * Returns 'number', 'text', 'keyword', or null if not found.
 */
function getAttributeType(
  stateAny: any,
  targetId: string,
  attributeKey: string
): 'number' | 'text' | 'keyword' | null {
  let statsConfig: any = undefined;

  if (targetId === '__user__') {
    const activePersonaId = stateAny.activePersonaId;
    const personas: any[] = stateAny.personas || [];
    const activePersona = personas.find((p: any) => p.id === activePersonaId);
    statsConfig = activePersona?.statsConfig;
  } else {
    const characters: any[] = stateAny.characters || [];
    const character = characters.find((c: any) => c.id === targetId);
    statsConfig = character?.statsConfig;
  }

  if (!statsConfig?.attributes) return null;

  const attrDef = statsConfig.attributes.find((a: any) => a.key === attributeKey);
  return attrDef?.type || null;
}

/**
 * Apply multiple item effects to SessionStats.
 */
function applyEffectsToSessionStats(
  stateAny: any,
  effects: ItemAttributeEffect[]
): void {
  for (const effect of effects) {
    applyEffectToSessionStats(stateAny, effect);
  }
}

/**
 * Get the cycled text value for a dynamic text effect.
 * For values containing `|` separators, returns the value at (activeTurns % parts.length).
 * For single values, returns the value as-is.
 */
function getDynamicTextValue(value: string | number, activeTurns: number): string | number {
  if (typeof value !== 'string') return value;
  const parts = value.split('|').map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1) return value;
  return parts[activeTurns % parts.length];
}

/**
 * Resolve the {{slot}} template key in an item message.
 * Replaces {{slot}} with the display name of the equipment slot.
 * If the slot is not found or slotId is empty, removes the {{slot}} key.
 *
 * Example:
 *   "Equipaste espada en {{slot}}" → "Equipaste espada en mano derecha"
 */
function resolveSlotKeyInMessage(
  message: string,
  slotId: string | undefined,
  equipmentSlots: EquipmentSlotDefinition[]
): string {
  if (!message || !/\{\{slot\}\}/gi.test(message)) return message;

  const slotDef = slotId ? equipmentSlots.find(s => s.id === slotId) : undefined;
  const slotName = slotDef?.name || '';
  return message.replace(/\{\{slot\}\}/gi, slotName);
}

/**
 * Sync active consumable effects to the current session for per-session storage.
 * This ensures effects are persisted in the session JSON and available for prompt building.
 * Called after every mutation of activeConsumableEffects.
 */
function syncEffectsToSession(stateAny: any, effects: ActiveConsumableEffect[]): void {
  const sessionId = stateAny.activeSessionId as string | undefined;
  if (!sessionId) return;
  try {
    stateAny.updateSession?.(sessionId, { activeConsumableEffects: effects });
  } catch {
    // Non-critical — session might not exist yet
  }
}

/**
 * Apply a single dynamic effect for a given turn.
 * - For text/keyword attributes: cycles through `|`-separated values or sets single value.
 * - For numeric attributes: applies the operator to the current value (cumulative).
 */
function applyDynamicEffectToSessionStats(
  stateAny: any,
  effect: ItemAttributeEffect,
  activeTurns: number
): void {
  const sessionId = stateAny.activeSessionId as string | undefined;
  if (!sessionId) return;

  const targetId = effect.targetId || '__user__';
  const attrType = getAttributeType(stateAny, targetId, effect.attributeKey);
  const isTextAttr = attrType === 'text' || attrType === 'keyword';

  if (isTextAttr) {
    // For text attributes, cycle through values or set single value
    const textValue = getDynamicTextValue(effect.value, activeTurns);
    const newValue = typeof textValue === 'string' ? textValue : String(textValue);
    stateAny.updateCharacterStat?.(sessionId, targetId, effect.attributeKey, newValue, 'trigger');
    return;
  }

  // For numeric attributes, apply the operator (cumulative)
  applyEffectToSessionStats(stateAny, effect);
}

/**
 * Apply a fallback value to SessionStats for a given target/attribute.
 * If no fallback value is provided, reverse the operator of the given effect.
 * Supports both numeric and text/keyword attributes.
 */
function applyFallbackToSessionStats(
  stateAny: any,
  targetId: string,
  attributeKey: string,
  fallbackValue: string | number | undefined,
  effect?: ItemAttributeEffect
): void {
  const sessionId = stateAny.activeSessionId as string | undefined;
  if (!sessionId) return;

  const resolvedTargetId = targetId || '__user__';

  // Detect attribute type for proper handling
  const attrType = getAttributeType(stateAny, resolvedTargetId, attributeKey);
  const isTextAttr = attrType === 'text' || attrType === 'keyword';

  if (fallbackValue !== undefined) {
    // Use explicit fallback value - for text attrs keep as string, for numeric parse
    let valueToSet: string | number;
    if (isTextAttr) {
      valueToSet = typeof fallbackValue === 'string' ? fallbackValue : String(fallbackValue);
    } else {
      valueToSet = typeof fallbackValue === 'number'
        ? fallbackValue
        : (isNaN(Number(fallbackValue)) ? fallbackValue : Number(fallbackValue));
    }
    try {
      stateAny.updateCharacterStat?.(sessionId, resolvedTargetId, attributeKey, valueToSet, 'trigger');
    } catch {
      // Non-critical
    }
  } else if (effect) {
    // No fallback - for text/keyword attributes with '=', we can't reverse without fallback
    if (isTextAttr) {
      // Text attributes cannot be auto-reversed, skip silently
      return;
    }

    // No fallback - reverse the operator for numeric attributes
    const currentValue = stateAny.getAttributeValue?.(sessionId, resolvedTargetId, attributeKey);
    if (currentValue === null || currentValue === undefined) return;

    const currentNum = typeof currentValue === 'number' ? currentValue : parseFloat(String(currentValue));
    if (isNaN(currentNum)) return;

    const effectNumValue = typeof effect.value === 'number' ? effect.value : parseFloat(String(effect.value));

    let newValue = currentNum;
    switch (effect.operator) {
      case '+': newValue = currentNum - effectNumValue; break; // reverse add
      case '-': newValue = currentNum + effectNumValue; break; // reverse subtract
      case '*': newValue = effectNumValue !== 0 ? currentNum / effectNumValue : currentNum; break; // reverse multiply
      case '/': newValue = currentNum * effectNumValue; break; // reverse divide
      case '=': break; // can't reverse a set without fallback
      case 'set_min': break; // can't reverse without fallback
      case 'set_max': break; // can't reverse without fallback
      default: break;
    }

    if (newValue !== currentNum) {
      newValue = Math.round(newValue * 100) / 100;
      try {
        stateAny.updateCharacterStat?.(sessionId, resolvedTargetId, attributeKey, newValue, 'trigger');
      } catch {
        // Non-critical
      }
    }
  }
}

// Get rarity color for display
export function getRarityColor(rarity: ItemRarity): string {
  const colors: Record<ItemRarity, string> = {
    common: 'text-gray-400',
    uncommon: 'text-green-400',
    rare: 'text-blue-400',
    epic: 'text-purple-400',
    legendary: 'text-amber-400',
    unique: 'text-red-400',
    cursed: 'text-fuchsia-400',
  };
  return colors[rarity];
}

// ============================================
// FASE 20: Slot Item Rules — runtime helpers
// ============================================
//
// Activation flow (equip / use):
//   1. resolveSlotItemRule → find the rule in persona/character slotDefinitions
//   2. Read the owner's current attribute value (session stats)
//   3. evaluateSlotItemRule → matching conditions (priority order)
//   4. Apply condition effects (attributes + sprites) + queue activation message
//   5. Persist an ActiveSlotRuleState snapshot on the equipment/consumable entry
//
// Deactivation flow (unequip / expire):
//   1. Read the ActiveSlotRuleState snapshot
//   2. Revert effects with fallback (attribute → fallbackValue, sprite → fallbackSprite)
//   3. Return the end message of the winning matched condition

/**
 * Apply a single sprite effect via the trigger sprite system.
 * A new trigger replaces any previous one (per the sprite priority system).
 */
function applySlotSpriteEffect(
  stateAny: any,
  effect: SlotConditionEffect & { type: 'sprite' },
  useFallback: boolean
): void {
  const characters: any[] = stateAny.characters || [];
  const character = characters.find(c => c.id === effect.targetId);
  if (!character) return;

  const spriteId = useFallback
    ? (effect.fallbackEnabled ? effect.fallbackSpriteId : undefined)
    : effect.spriteId;

  if (!spriteId) {
    // No target sprite: clear the trigger so normal sprite logic resumes.
    stateAny.applyTriggerForCharacter?.(effect.targetId, {
      packId: '',
      spriteUrl: '',
      spriteLabel: null,
    });
    return;
  }

  const sprite = findCharacterSprite(character, spriteId);
  if (!sprite) return;

  stateAny.applyTriggerForCharacter?.(effect.targetId, {
    packId: sprite.packId,
    spriteUrl: sprite.url,
    spriteLabel: sprite.label,
  });
}

/**
 * Apply all effects of the matched conditions (activation or dynamic tick).
 */
function applySlotConditionEffects(
  stateAny: any,
  conditions: SlotItemCondition[],
  ownerStatId: string
): void {
  for (const cond of conditions) {
    for (const effect of cond.effects || []) {
      if (effect.type === 'attribute') {
        applyEffectToSessionStats(stateAny, {
          targetId: resolveEffectTarget(effect.targetId, ownerStatId),
          targetName: effect.targetId === '__self__'
            ? (ownerStatId === '__user__' ? 'Persona' : effect.targetName)
            : effect.targetName,
          attributeKey: effect.attributeKey,
          attributeName: effect.attributeName,
          operator: effect.operator,
          value: effect.value,
        });
      } else {
        applySlotSpriteEffect(stateAny, effect, false);
      }
    }
  }
}

/**
 * Revert applied effects on deactivation:
 * - Attribute with fallbackEnabled → set fallbackValue (or reverse the operator)
 * - Sprite → fallback sprite, or clear the trigger
 */
function revertSlotRuleEffects(
  stateAny: any,
  appliedEffects: SlotConditionEffect[],
  ownerStatId: string
): void {
  for (const effect of appliedEffects) {
    if (effect.type === 'attribute') {
      applyFallbackToSessionStats(
        stateAny,
        resolveEffectTarget(effect.targetId, ownerStatId),
        effect.attributeKey,
        effect.fallbackEnabled ? effect.fallbackValue : undefined,
        {
          targetId: resolveEffectTarget(effect.targetId, ownerStatId),
          attributeKey: effect.attributeKey,
          attributeName: effect.attributeName,
          operator: effect.operator,
          value: effect.value,
        }
      );
    } else {
      applySlotSpriteEffect(stateAny, effect, true);
    }
  }
}

/**
 * Activate the slot item rule for an equip/use. Returns the persisted rule
 * state and the activation message to queue (null when no rule exists or
 * nothing matched).
 */
function activateSlotItemRule(
  stateAny: any,
  opts: {
    personaId: string;
    itemId: string;
    slotId?: string;
    targetCharacterId?: string;
    /** Consumables resolve the rule across ALL slots of the owner. */
    anySlot?: boolean;
  }
): { ruleState: ActiveSlotRuleState; activationMessage: string } | null {
  const sessionId = stateAny.activeSessionId as string | undefined;
  if (!sessionId) return null;

  const personas: any[] = stateAny.personas || [];
  const characters: any[] = stateAny.characters || [];

  const resolution = opts.anySlot
    ? resolveSlotItemRuleAnySlot(personas, characters, {
        personaId: opts.personaId,
        itemId: opts.itemId,
        targetCharacterId: opts.targetCharacterId,
      })
    : resolveSlotItemRule(personas, characters, {
        personaId: opts.personaId,
        slotId: opts.slotId || '',
        itemId: opts.itemId,
        targetCharacterId: opts.targetCharacterId,
      });

  if (!resolution) return null;
  const { rule, ownerStatId, ruleSourceKind, ruleSourceId } = resolution;
  if (!rule.conditions?.length) return null;

  // Read the owner's current attribute value
  let attributeValue: number | string | null = null;
  try {
    attributeValue = stateAny.getAttributeValue?.(sessionId, ownerStatId, rule.attributeKey) ?? null;
  } catch {
    attributeValue = null;
  }

  const matched = evaluateSlotItemRule(rule, attributeValue);
  if (matched.length === 0) return null;

  // Apply the effects of matched conditions
  applySlotConditionEffects(stateAny, matched, ownerStatId);

  const winner = getWinnerCondition(matched);
  const activationMessage = winner?.activationMessage?.trim() || '';

  const ruleState: ActiveSlotRuleState = {
    mode: rule.comparisonMode === 'dynamic' ? 'dynamic' : 'static',
    ownerStatId,
    ruleSourceKind,
    ruleSourceId,
    slotId: opts.slotId,
    matchedConditionIds: matched.map(c => c.id),
    appliedEffects: matched.flatMap(c => c.effects || []),
    appliedAt: new Date().toISOString(),
  };

  return { ruleState, activationMessage };
}

/**
 * Deactivate a previously activated slot item rule: revert fallbacks and
 * return the end message of the winning matched condition (if any).
 */
function deactivateSlotItemRule(
  stateAny: any,
  ruleState: ActiveSlotRuleState,
  itemId: string
): string | null {
  const personas: any[] = stateAny.personas || [];
  const characters: any[] = stateAny.characters || [];

  // Revert fallback effects
  if (ruleState.appliedEffects?.length) {
    revertSlotRuleEffects(stateAny, ruleState.appliedEffects, ruleState.ownerStatId);
  }

  // Find the winning matched condition's end message
  if (!ruleState.matchedConditionIds?.length) return null;

  const rule = resolveRuleFromRuleState(personas, characters, ruleState, itemId);
  if (!rule) return null;

  const matchedConditions = (rule.conditions || []).filter(
    c => ruleState.matchedConditionIds.includes(c.id)
  );
  const winner = getWinnerCondition(matchedConditions);
  const endMessage = winner?.endMessage?.trim() || '';
  return endMessage || null;
}

// Get rarity background color
export function getRarityBgColor(rarity: ItemRarity): string {
  const colors: Record<ItemRarity, string> = {
    common: 'bg-gray-500/10 border-gray-500/20',
    uncommon: 'bg-green-500/10 border-green-500/20',
    rare: 'bg-blue-500/10 border-blue-500/20',
    epic: 'bg-purple-500/10 border-purple-500/20',
    legendary: 'bg-amber-500/10 border-amber-500/20',
    unique: 'bg-red-500/10 border-red-500/20',
    cursed: 'bg-fuchsia-500/10 border-fuchsia-500/20',
  };
  return colors[rarity];
}

// Get type icon
export function getItemTypeIcon(type: 'consumable' | 'equipment'): string {
  return type === 'consumable' ? '🧪' : '⚔️';
}

// Get type label
export function getItemTypeLabel(type: 'consumable' | 'equipment'): string {
  return type === 'consumable' ? 'Consumible' : 'Equipo';
}

// ============================================
// Slice Type
// ============================================

export interface InventorySlice {
  // Item Registry - all defined items available in the system
  items: Item[];

  // Active consumable effects (with remaining duration)
  activeConsumableEffects: ActiveConsumableEffect[];

  // Settings
  inventorySettings: InventoryV2Settings;

  // Notifications
  inventoryNotifications: InventoryNotification[];

  // Pending item message to be sent as user chat message
  pendingItemMessage: string | null;

  // Pending equip/use action (waiting for target selection)
  pendingEquipAction: {
    type: 'equip' | 'use';
    personaId: string;
    itemId: string;
  } | null;

  // ===== Item Registry Actions =====
  addItem: (item: Item) => void;
  updateItem: (id: string, updates: Partial<Item>) => void;
  deleteItem: (id: string) => void;
  getItemById: (id: string) => Item | undefined;
  searchItems: (query: string) => Item[];
  getItemsByType: (type: 'consumable' | 'equipment') => Item[];

  // ===== Persona Inventory Actions =====
  // These read/write persona.inventoryItems via the store's updatePersona
  addToPersona: (personaId: string, itemId: string, quantity?: number) => void;
  removeFromPersona: (personaId: string, itemId: string, quantity?: number) => void;
  getPersonaItems: (personaId: string) => Array<{ entry: PersonaInventoryEntry; item: Item }>;
  getPersonaItemCount: (personaId: string, itemId: string) => number;

  // ===== Equipment Actions =====
  equipItem: (personaId: string, itemId: string) => void;
  equipItemToSlot: (personaId: string, itemId: string, slotId: string) => void;
  unequipItem: (personaId: string, itemId: string) => void;
  getEquippedItems: (personaId: string) => Array<{ entry: PersonaInventoryEntry; item: Item }>;
  getSessionEquipment: (sessionId: string) => SessionEquipmentEntry[];
  isItemEquippedInSession: (sessionId: string, itemId: string) => boolean;
  getEquipmentEffects: (personaId: string) => ItemAttributeEffect[];

  // ===== Consumable Actions =====
  useConsumable: (personaId: string, itemId: string) => { effect: ActiveConsumableEffect; message: string } | null;

  // ===== Active Effects =====
  tickEffects: (personaId: string) => string[];  // Returns list of expired effect messages
  removeExpiredEffects: (personaId: string) => string[];  // Returns list of expired effect messages
  getAllActiveEffects: (personaId: string) => ItemAttributeEffect[]; // consumable + equipment combined
  removeEffect: (effectId: string) => void;
  clearAllEffects: (personaId: string) => void;

  // ===== Currency Actions (delegates to persona) =====
  adjustCurrency: (personaId: string, amount: number) => void;
  canAfford: (personaId: string, price: number) => boolean;
  purchaseItem: (personaId: string, itemId: string) => boolean; // Returns true if purchase succeeded

  // ===== Shop =====
  getShopItems: () => Item[]; // Items with price > 0

  // ===== Settings Actions =====
  setInventorySettings: (settings: Partial<InventoryV2Settings>) => void;

  // ===== Notification Actions =====
  addInventoryNotification: (notification: Omit<InventoryNotification, 'id' | 'timestamp' | 'read'>) => void;
  markNotificationRead: (id: string) => void;
  clearInventoryNotifications: () => void;
  getUnreadNotifications: () => InventoryNotification[];

  // ===== Pending Item Message =====
  clearPendingItemMessage: () => void;

  // ===== Target Selection Actions =====
  requestEquipItem: (personaId: string, itemId: string) => void;
  requestUseItem: (personaId: string, itemId: string) => void;
  clearPendingEquipAction: () => void;
  executeEquipWithTarget: (personaId: string, itemId: string, targetOverrideId: string) => void;
  executeUseWithTarget: (personaId: string, itemId: string, targetOverrideId: string) => void;

  // ===== Pending Fallbacks =====
  pendingFallbacks: Array<{ targetId: string; attributeKey: string; fallbackValue: string | number }>;

  // ===== Dynamic Equipment State =====
  dynamicEquipmentState: Record<string, DynamicEquipmentState>;  // key: `${personaId}:${itemId}`

  // ===== Equipment Slots Resolution (per persona / per character) =====
  /**
   * Get equipment slots for a specific character.
   * Returns character.equipmentSlots if defined, otherwise an empty array.
   * (Global slots were removed — slots are managed in Persona/Character config.)
   */
  getEquipmentSlotsForCharacter: (characterId?: string) => EquipmentSlotDefinition[];
  /**
   * Get equipment slots for a persona (defaults to the active persona).
   * Returns persona.equipmentSlots if defined, otherwise an empty array.
   * (Global slots were removed — slots are managed in Persona/Character config.)
   */
  getEquipmentSlotsForPersona: (personaId?: string) => EquipmentSlotDefinition[];
  /**
   * Get slot definitions (effects, restrictions) for a character.
   * Returns character.slotDefinitions if defined, otherwise empty array.
   */
  getSlotDefinitionsForCharacter: (characterId?: string) => CharacterSlotDefinition[];
  /**
   * Get slot definitions for the active persona.
   */
  getSlotDefinitionsForPersona: () => CharacterSlotDefinition[];

  // ===== Utility =====
  exportInventory: () => { items: Item[]; activeEffects: ActiveConsumableEffect[]; settings: InventoryV2Settings; dynamicEquipmentState: Record<string, DynamicEquipmentState> };
  importInventory: (data: { items?: Item[]; activeEffects?: ActiveConsumableEffect[]; settings?: InventoryV2Settings; dynamicEquipmentState?: Record<string, DynamicEquipmentState> }) => void;
}

// ============================================
// Slice Creator
// ============================================

export const createInventorySlice: StateCreator<InventorySlice, [], [], InventorySlice> = (set, get) => ({
  // Initial State
  items: [],
  activeConsumableEffects: [],
  inventorySettings: DEFAULT_INVENTORY_V2_SETTINGS,
  inventoryNotifications: [],
  pendingItemMessage: null,
  pendingEquipAction: null,
  pendingFallbacks: [],
  dynamicEquipmentState: {},

  // ===== Item Registry Actions =====
  addItem: (item) => set((state) => ({
    items: [...state.items, item]
  })),

  updateItem: (id, updates) => set((state) => ({
    items: state.items.map(item =>
      item.id === id ? { ...item, ...updates, updatedAt: new Date().toISOString() } : item
    )
  })),

  deleteItem: (id) => {
    const stateAny = get() as any;
    const item = get().getItemById(id);

    // Reverse effects and clean up personas that have this item
    if (item) {
      const personas = stateAny.personas as Array<{ id: string; inventoryItems?: PersonaInventoryEntry[] }> | undefined;
      if (personas) {
        for (const persona of personas) {
          const entry = persona.inventoryItems?.find(e => e.itemId === id);
          if (entry) {
            // If the item is equipped, reverse its effects first
            if (entry.equipped && item.type === 'equipment' && item.attributeEffects) {
              for (const ae of item.attributeEffects) {
                const effectTargetId = entry.targetOverrideId || ae.targetId;
                applyFallbackToSessionStats(stateAny, effectTargetId, ae.attributeKey, ae.fallbackValue, ae);
              }
            }
            // Remove the item from this persona's inventory
            const updatedItems = persona.inventoryItems?.filter(e => e.itemId !== id) || [];
            stateAny.updatePersona(persona.id, { inventoryItems: updatedItems });
          }
        }
      }
    }

    // Also reverse active consumable effects for this item
    const activeEffects = get().activeConsumableEffects.filter(e => e.itemId === id);
    for (const effect of activeEffects) {
      if (item?.attributeEffects) {
        for (const ae of item.attributeEffects) {
          const activeEffect = effect.effects.find(e => e.attributeKey === ae.attributeKey);
          const effectTargetId = activeEffect?.targetId || ae.targetId;
          applyFallbackToSessionStats(stateAny, effectTargetId, ae.attributeKey, ae.fallbackValue, ae);
        }
      }
    }

    set((state) => ({
      items: state.items.filter(item => item.id !== id),
      activeConsumableEffects: state.activeConsumableEffects.filter(e => e.itemId !== id),
    }));

    // Sync to session for per-session storage
    syncEffectsToSession(stateAny, get().activeConsumableEffects);
  },

  getItemById: (id) => {
    return get().items.find(item => item.id === id);
  },

  searchItems: (query) => {
    const lowerQuery = query.toLowerCase();
    return get().items.filter(item =>
      item.name.toLowerCase().includes(lowerQuery) ||
      item.description.toLowerCase().includes(lowerQuery) ||
      item.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  },

  getItemsByType: (type) => {
    return get().items.filter(item => item.type === type);
  },

  // ===== Persona Inventory Actions =====
  addToPersona: (personaId, itemId, quantity = 1) => {
    const stateAny = get() as any;
    const personas = stateAny.personas as Array<{ id: string; inventoryItems?: PersonaInventoryEntry[] }>;
    const persona = personas.find(p => p.id === personaId);
    if (!persona) return;

    const currentItems = persona.inventoryItems || [];
    const existing = currentItems.find(e => e.itemId === itemId);
    const item = get().getItemById(itemId);
    if (!item) return;

    let updatedItems: PersonaInventoryEntry[];
    if (existing) {
      // Update quantity (respect maxStack)
      const maxStack = item.maxStack ?? (item.type === 'consumable' ? 99 : 1);
      updatedItems = currentItems.map(e =>
        e.itemId === itemId
          ? { ...e, quantity: Math.min(e.quantity + quantity, maxStack) }
          : e
      );
    } else {
      // Add new entry
      updatedItems = [...currentItems, { itemId, quantity, equipped: false }];
    }

    stateAny.updatePersona(personaId, { inventoryItems: updatedItems });

    get().addInventoryNotification({
      type: 'item_added',
      itemId,
      itemName: item.name,
      quantity,
      message: `Obtuviste ${quantity > 1 ? `${quantity}x ` : ''}${item.name}`,
    });
  },

  removeFromPersona: (personaId, itemId, quantity) => {
    const stateAny = get() as any;
    const personas = stateAny.personas as Array<{ id: string; inventoryItems?: PersonaInventoryEntry[] }>;
    const persona = personas.find(p => p.id === personaId);
    if (!persona?.inventoryItems) return;

    const existing = persona.inventoryItems.find(e => e.itemId === itemId);
    if (!existing) return;

    const item = get().getItemById(itemId);
    const removeQty = quantity ?? existing.quantity;

    let updatedItems: PersonaInventoryEntry[];
    if (quantity && existing.quantity > quantity) {
      // Reduce quantity
      updatedItems = persona.inventoryItems.map(e =>
        e.itemId === itemId
          ? { ...e, quantity: e.quantity - quantity }
          : e
      );
    } else {
      // Remove entirely (also unequip if equipped)
      if (existing.equipped && item?.type === 'equipment') {
        // Reverse equipment effects when removing equipped item
        if (item.attributeEffects) {
          for (const ae of item.attributeEffects) {
            const effectTargetId = existing.targetOverrideId || ae.targetId;
            applyFallbackToSessionStats(stateAny, effectTargetId, ae.attributeKey, ae.fallbackValue, ae);
          }
        }
      }
      updatedItems = persona.inventoryItems.filter(e => e.itemId !== itemId);
    }

    stateAny.updatePersona(personaId, { inventoryItems: updatedItems });

    if (item) {
      get().addInventoryNotification({
        type: 'item_removed',
        itemId: item.id,
        itemName: item.name,
        quantity: removeQty,
        message: `Perdiste ${removeQty > 1 ? `${removeQty}x ` : ''}${item.name}`,
      });
    }
  },

  getPersonaItems: (personaId) => {
    const stateAny = get() as any;
    const personas = stateAny.personas as Array<{ id: string; inventoryItems?: PersonaInventoryEntry[] }>;
    const persona = personas.find(p => p.id === personaId);
    if (!persona?.inventoryItems) return [];

    return persona.inventoryItems
      .map(entry => {
        const item = get().getItemById(entry.itemId);
        return item ? { entry, item } : null;
      })
      .filter((r): r is { entry: PersonaInventoryEntry; item: Item } => r !== null);
  },

  getPersonaItemCount: (personaId, itemId) => {
    const stateAny = get() as any;
    const personas = stateAny.personas as Array<{ id: string; inventoryItems?: PersonaInventoryEntry[] }>;
    const persona = personas.find(p => p.id === personaId);
    if (!persona?.inventoryItems) return 0;

    const entry = persona.inventoryItems.find(e => e.itemId === itemId);
    return entry?.quantity ?? 0;
  },

  // ===== Equipment Actions =====
  equipItem: (personaId, itemId) => {
    const stateAny = get() as any;
    const personas = stateAny.personas as Array<{ id: string; inventoryItems?: PersonaInventoryEntry[]; equipmentSlots?: EquipmentSlotDefinition[] }>;
    const persona = personas.find(p => p.id === personaId);
    if (!persona?.inventoryItems) return;

    const item = get().getItemById(itemId);
    if (!item || item.type !== 'equipment') return;

    const entry = persona.inventoryItems.find(e => e.itemId === itemId);
    if (!entry) return;

    // Determine which slot to equip in (from slotEffects or item.slot)
    const equipmentSlots = persona.equipmentSlots || [];

    // If item has multiple slot effects, use the first one (UI should show slot picker for multiple)
    let targetSlotId = '';
    let targetSlotEffect = item.slotEffects?.[0];

    if (item.slot) {
      const matchingSlot = equipmentSlots.find(s => s.id === item.slot || s.key === item.slot);
      if (matchingSlot) {
        targetSlotId = matchingSlot.id;
        const slotEffectForSlot = item.slotEffects?.find(se => se.slotId === matchingSlot.id);
        targetSlotEffect = slotEffectForSlot || targetSlotEffect;
      }
    }

    if (!targetSlotId && targetSlotEffect) {
      targetSlotId = targetSlotEffect.slotId;
    }

    if (!targetSlotId && item.slot) {
      targetSlotId = item.slot;
    }

    // Delegate to equipItemToSlot
    if (targetSlotId) {
      get().equipItemToSlot(personaId, itemId, targetSlotId);
    }
  },

  equipItemToSlot: (personaId, itemId, slotId) => {
    const stateAny = get() as any;
    const sessionId = stateAny.activeSessionId as string | undefined;
    if (!sessionId) return;

    const personas = stateAny.personas as Array<{ id: string; inventoryItems?: PersonaInventoryEntry[]; equipmentSlots?: EquipmentSlotDefinition[] }>;
    const persona = personas.find(p => p.id === personaId);
    if (!persona?.inventoryItems) return;

    const item = get().getItemById(itemId);
    if (!item || item.type !== 'equipment') return;

    const entry = persona.inventoryItems.find(e => e.itemId === itemId);
    if (!entry) return;

    const equipmentSlots = persona.equipmentSlots || [];
    const slotEffect = item.slotEffects?.find(se => se.slotId === slotId);
    const slotDef = equipmentSlots.find(s => s.id === slotId);

    // Get current session equipment
    const sessions = stateAny.sessions as Array<{ id: string; sessionEquipment?: SessionEquipmentEntry[] }>;
    const session = sessions.find(s => s.id === sessionId);
    const currentEquipment = session?.sessionEquipment || [];

    // FASE 20: Deactivate the slot item rule of any item being replaced
    // (same slot, or this item moving from another slot)
    for (const replaced of currentEquipment) {
      if (!replaced.ruleState) continue;
      const isReplaced = (replaced.equippedSlotId === slotId && replaced.itemId !== itemId)
        || (replaced.itemId === itemId);
      if (!isReplaced) continue;
      const replacedEndMessage = deactivateSlotItemRule(stateAny, replaced.ruleState, replaced.itemId);
      if (replacedEndMessage) {
        set({ pendingItemMessage: resolveSlotKeyInMessage(replacedEndMessage, replaced.equippedSlotId, equipmentSlots) });
      }
    }

    // Remove any existing item in this slot (unequip it)
    let updatedEquipment = currentEquipment.filter(e => e.equippedSlotId !== slotId);

    // Also remove this item from any other slot it might be equipped in
    updatedEquipment = updatedEquipment.filter(e => e.itemId !== itemId);

    // FASE 20: Activate the slot item rule for the newly equipped item
    const ruleActivation = activateSlotItemRule(stateAny, {
      personaId,
      itemId,
      slotId,
    });

    // Add the new equipment entry
    const newEntry: SessionEquipmentEntry = {
      itemId,
      equippedSlotId: slotId,
      slotEffectText: slotEffect?.effectText || undefined,
      ruleState: ruleActivation?.ruleState,
    };
    updatedEquipment.push(newEntry);

    // Save to session
    stateAny.updateSession(sessionId, { sessionEquipment: updatedEquipment });

    // Also update persona.inventoryItems for backward compat (mark as equipped)
    const updatedItems = persona.inventoryItems.map(e =>
      e.itemId === itemId ? { ...e, equipped: true, equippedSlotId: slotId } : e
    );
    stateAny.updatePersona(personaId, { inventoryItems: updatedItems });

    // Apply slot-based effects - set the slot attribute value on the persona
    if (slotDef) {
      const slotValue = slotEffect?.effectText
        ? `${item.name}: ${slotEffect.effectText}`
        : item.name;
      stateAny.updateCharacterStat?.(sessionId, '__user__', slotDef.key, slotValue, 'text');
    }

    const message = resolveSlotKeyInMessage(item.useMessage || `Equipaste ${item.name}${slotDef ? ` en ${slotDef.name}` : ''}`, slotId, equipmentSlots);
    get().addInventoryNotification({
      type: 'item_equipped',
      itemId: item.id,
      itemName: item.name,
      quantity: 1,
      message: ruleActivation?.activationMessage || message,
    });

    // FASE 20: The rule's activation message takes precedence over the
    // legacy useMessage (it is sent to the chat as a user message).
    if (ruleActivation?.activationMessage) {
      set({ pendingItemMessage: resolveSlotKeyInMessage(ruleActivation.activationMessage, slotId, equipmentSlots) });
    } else if (item.useMessage) {
      set({ pendingItemMessage: resolveSlotKeyInMessage(item.useMessage, slotId, equipmentSlots) });
    }
  },

  unequipItem: (personaId, itemId) => {
    const stateAny = get() as any;
    const sessionId = stateAny.activeSessionId as string | undefined;
    const personas = stateAny.personas as Array<{ id: string; inventoryItems?: PersonaInventoryEntry[]; equipmentSlots?: EquipmentSlotDefinition[] }>;
    const persona = personas.find(p => p.id === personaId);
    if (!persona?.inventoryItems) return;

    const item = get().getItemById(itemId);
    if (!item) return;

    const entry = persona.inventoryItems.find(e => e.itemId === itemId);
    const equippedSlotId = entry?.equippedSlotId;

    const equipmentSlots = persona.equipmentSlots || [];

    // FASE 20: Deactivate the slot item rule (fallbacks + end message) BEFORE
    // removing the equipment entry
    let ruleEndMessage: string | null = null;
    if (sessionId) {
      const sessions = stateAny.sessions as Array<{ id: string; sessionEquipment?: SessionEquipmentEntry[] }>;
      const session = sessions.find(s => s.id === sessionId);
      const currentEquipment = session?.sessionEquipment || [];
      const equipmentEntry = currentEquipment.find(e => e.itemId === itemId);
      if (equipmentEntry?.ruleState) {
        ruleEndMessage = deactivateSlotItemRule(stateAny, equipmentEntry.ruleState, itemId);
      }
    }

    // Remove from persona inventory (mark as unequipped)
    const updatedItems = persona.inventoryItems.map(e =>
      e.itemId === itemId ? { ...e, equipped: false, equippedSlotId: undefined } : e
    );
    stateAny.updatePersona(personaId, { inventoryItems: updatedItems });

    // Remove from session equipment
    if (sessionId) {
      const sessions = stateAny.sessions as Array<{ id: string; sessionEquipment?: SessionEquipmentEntry[] }>;
      const session = sessions.find(s => s.id === sessionId);
      const currentEquipment = session?.sessionEquipment || [];
      const updatedEquipment = currentEquipment.filter(e => e.itemId !== itemId);
      stateAny.updateSession(sessionId, { sessionEquipment: updatedEquipment });
    }

    // Clear slot-based effects - reset the slot attribute to empty
    if (equippedSlotId && sessionId) {
      const slotDef = equipmentSlots.find(s => s.id === equippedSlotId);
      if (slotDef) {
        stateAny.updateCharacterStat?.(sessionId, '__user__', slotDef.key, '', 'text');
      }
    }

    const message = resolveSlotKeyInMessage(item.unequipMessage || `Desequipaste ${item.name}`, equippedSlotId, equipmentSlots);
    get().addInventoryNotification({
      type: 'item_equipped',
      itemId: item.id,
      itemName: item.name,
      quantity: 1,
      message: ruleEndMessage || message,
    });

    // Queue message for chat injection AFTER attribute change.
    // FASE 20: the rule's end message takes precedence over legacy unequipMessage.
    if (ruleEndMessage) {
      set({ pendingItemMessage: resolveSlotKeyInMessage(ruleEndMessage, equippedSlotId, equipmentSlots) });
    } else if (item.unequipMessage) {
      set({ pendingItemMessage: resolveSlotKeyInMessage(item.unequipMessage, equippedSlotId, equipmentSlots) });
    }
  },

  getEquippedItems: (personaId) => {
    return get().getPersonaItems(personaId).filter(({ entry }) => entry.equipped);
  },

  getSessionEquipment: (sessionId) => {
    const stateAny = get() as any;
    const sessions = stateAny.sessions as Array<{ id: string; sessionEquipment?: SessionEquipmentEntry[] }>;
    const session = sessions.find(s => s.id === sessionId);
    return session?.sessionEquipment || [];
  },

  isItemEquippedInSession: (sessionId, itemId) => {
    const equipment = get().getSessionEquipment(sessionId);
    return equipment.some(e => e.itemId === itemId);
  },

  getEquipmentEffects: (personaId) => {
    const equipped = get().getEquippedItems(personaId);
    const effects: ItemAttributeEffect[] = [];

    for (const { item } of equipped) {
      if (item.attributeEffects) {
        effects.push(...item.attributeEffects);
      }
    }

    return effects;
  },

  // ===== Consumable Actions =====
  useConsumable: (personaId, itemId) => {
    const stateAny = get() as any;
    const personas = stateAny.personas as Array<{ id: string; inventoryItems?: PersonaInventoryEntry[] }>;
    const persona = personas.find(p => p.id === personaId);
    if (!persona?.inventoryItems) return null;

    const item = get().getItemById(itemId);
    if (!item || item.type !== 'consumable') return null;

    const entry = persona.inventoryItems.find(e => e.itemId === itemId);
    if (!entry || entry.quantity <= 0) return null;

    // Reduce quantity (consumable is consumed on use)
    const updatedItems = persona.inventoryItems.map(e =>
      e.itemId === itemId
        ? { ...e, quantity: e.quantity - 1 }
        : e
    ).filter(e => e.quantity > 0); // Remove entries with 0 quantity

    stateAny.updatePersona(personaId, { inventoryItems: updatedItems });

    // Create active effect
    const duration = item.duration ?? 1;

    // Collect fallback values from item's attributeEffects
    const effectFallbacks: Record<string, string | number> = {};
    for (const ae of (item.attributeEffects || [])) {
      if (ae.fallbackValue !== undefined) {
        effectFallbacks[ae.attributeKey] = ae.fallbackValue;
      }
    }

    const effect: ActiveConsumableEffect = {
      id: generateId('effect'),
      itemId: item.id,
      itemName: item.name,
      personaId,
      effects: item.attributeEffects || [],
      effectFallbacks,
      consumableEffect: item.consumableEffect,
      remainingTurns: duration,
      totalTurns: duration,
      useMessage: item.useMessage,
      expireMessage: item.expireMessage,
      appliedAt: new Date().toISOString(),
    };

    // FASE 20: Activate the slot item rule (any-slot resolution for consumables)
    const ruleActivation = activateSlotItemRule(stateAny, {
      personaId,
      itemId,
      anySlot: true,
    });
    if (ruleActivation) {
      effect.ruleState = ruleActivation.ruleState;
    }

    set((state) => ({
      activeConsumableEffects: [...state.activeConsumableEffects, effect]
    }));

    // Sync to session for per-session storage
    syncEffectsToSession(stateAny, get().activeConsumableEffects);

    // Apply consumable effects FIRST (before message) so attributes are updated
    // before the LLM sees the message in the prompt
    if (item.attributeEffects && item.attributeEffects.length > 0) {
      applyEffectsToSessionStats(stateAny, item.attributeEffects);
    }

    const message = item.useMessage || `Usaste ${item.name} (${duration} turnos)`;

    get().addInventoryNotification({
      type: 'item_used',
      itemId: item.id,
      itemName: item.name,
      quantity: 1,
      message: ruleActivation?.activationMessage || message,
    });

    // Queue message for chat injection AFTER attribute change.
    // FASE 20: the rule's activation message takes precedence.
    if (ruleActivation?.activationMessage) {
      set({ pendingItemMessage: ruleActivation.activationMessage });
    } else if (item.useMessage) {
      set({ pendingItemMessage: item.useMessage });
    }

    return { effect, message };
  },

  // ===== Active Effects =====
  tickEffects: (personaId) => {
    const expiredMessages: string[] = [];
    const stateAny = get() as any;

    // 1. Apply dynamic consumable effects before decrementing
    const consumableEffects = get().activeConsumableEffects.filter(e => e.personaId === personaId);
    for (const activeEffect of consumableEffects) {
      const dynamicEffects = activeEffect.effects.filter(e => e.mode === 'dynamic');
      const activeTurns = activeEffect.totalTurns - activeEffect.remainingTurns;
      for (const dynEffect of dynamicEffects) {
        applyDynamicEffectToSessionStats(stateAny, dynEffect, activeTurns);
      }
    }

    // 2. Apply dynamic equipment effects and increment turn counters
    const dynamicEqState = { ...get().dynamicEquipmentState };
    const equippedItems = get().getEquippedItems(personaId);
    for (const { entry, item } of equippedItems) {
      const dynamicEffects = (item.attributeEffects || []).filter((e: ItemAttributeEffect) => e.mode === 'dynamic');
      if (dynamicEffects.length > 0) {
        const stateKey = `${personaId}:${item.id}`;
        const currentState = dynamicEqState[stateKey] || { activeTurns: 0, appliedAt: new Date().toISOString() };
        for (const dynEffect of dynamicEffects) {
          const resolvedEffect = entry.targetOverrideId ? { ...dynEffect, targetId: entry.targetOverrideId } : dynEffect;
          applyDynamicEffectToSessionStats(stateAny, resolvedEffect, currentState.activeTurns);
        }
        dynamicEqState[stateKey] = { ...currentState, activeTurns: currentState.activeTurns + 1 };
      }
    }

    // 2.5 FASE 20: Re-evaluate dynamic slot item rules — each turn the rule's
    // conditions are re-checked against the owner's CURRENT attribute value and
    // the matching conditions' effects are applied. The snapshot is updated so
    // deactivation reverts the right effects.
    const sessionId = stateAny.activeSessionId as string | undefined;
    if (sessionId) {
      const sessions = stateAny.sessions as Array<{ id: string; sessionEquipment?: SessionEquipmentEntry[] }>;
      const session = sessions.find(s => s.id === sessionId);
      const currentEquipment = session?.sessionEquipment || [];
      const dynamicRuleEntries = currentEquipment.filter(
        e => e.ruleState && e.ruleState.mode === 'dynamic'
      );

      if (dynamicRuleEntries.length > 0) {
        const personasForRules: any[] = stateAny.personas || [];
        const charactersForRules: any[] = stateAny.characters || [];
        let rulesChanged = false;

        const updatedEquipment = currentEquipment.map(eq => {
          const rs = eq.ruleState;
          if (!rs || rs.mode !== 'dynamic') return eq;

          const rule = resolveRuleFromRuleState(personasForRules, charactersForRules, rs, eq.itemId);
          if (!rule) return eq;

          let attributeValue: number | string | null = null;
          try {
            attributeValue = stateAny.getAttributeValue?.(sessionId, rs.ownerStatId, rule.attributeKey) ?? null;
          } catch {
            attributeValue = null;
          }

          const matched = evaluateSlotItemRule(rule, attributeValue);
          if (matched.length > 0) {
            applySlotConditionEffects(stateAny, matched, rs.ownerStatId);
          }

          const newIds = matched.map(c => c.id);
          const newEffects = matched.flatMap(c => c.effects || []);
          const changed = newIds.join(',') !== rs.matchedConditionIds.join(',')
            || newEffects.length !== (rs.appliedEffects?.length || 0);
          if (changed) rulesChanged = true;

          return {
            ...eq,
            ruleState: { ...rs, matchedConditionIds: newIds, appliedEffects: newEffects },
          };
        });

        if (rulesChanged || dynamicRuleEntries.length > 0) {
          stateAny.updateSession?.(sessionId, { sessionEquipment: updatedEquipment });
        }
      }
    }

    // 3. Decrement consumable turns
    set((state) => ({
      activeConsumableEffects: state.activeConsumableEffects.map(effect => {
        if (effect.personaId !== personaId) return effect;
        const newRemaining = effect.remainingTurns - 1;
        if (newRemaining <= 0) {
          const msg = effect.expireMessage || `El efecto de ${effect.itemName} ha expirado`;
          expiredMessages.push(msg);
        }
        return { ...effect, remainingTurns: Math.max(0, newRemaining) };
      }),
      dynamicEquipmentState: dynamicEqState,
    }));

    // Sync to session for per-session storage
    syncEffectsToSession(stateAny, get().activeConsumableEffects);

    return expiredMessages;
  },

  removeExpiredEffects: (personaId) => {
    const expiredMessages: string[] = [];
    const stateAny = get() as any;

    set((state) => {
      const expired = state.activeConsumableEffects.filter(
        e => e.personaId === personaId && e.remainingTurns <= 0
      );
      for (const e of expired) {
        const msg = e.expireMessage || `El efecto de ${e.itemName} ha expirado`;
        expiredMessages.push(msg);

        get().addInventoryNotification({
          type: 'item_removed',
          itemId: e.itemId,
          itemName: e.itemName,
          quantity: 1,
          message: msg,
        });
      }

      // FASE 20: Deactivate slot item rules of expired consumables
      // (revert fallbacks + queue the rule's end message as a user chat message)
      for (const effect of expired) {
        if (!effect.ruleState) continue;
        const ruleEndMessage = deactivateSlotItemRule(stateAny, effect.ruleState, effect.itemId);
        if (ruleEndMessage) {
          expiredMessages.push(ruleEndMessage);
          set({ pendingItemMessage: ruleEndMessage });
        }
      }

      // Apply fallback values directly to SessionStats for expired effects
      for (const effect of expired) {
        const item = get().getItemById(effect.itemId);
        if (!item?.attributeEffects) continue;
        for (const ae of item.attributeEffects) {
          // Use the effect's overridden targetId if it was set (from executeUseWithTarget)
          const activeEffect = effect.effects.find(e => e.attributeKey === ae.attributeKey);
          const effectTargetId = activeEffect?.targetId || ae.targetId;
          applyFallbackToSessionStats(stateAny, effectTargetId, ae.attributeKey, ae.fallbackValue, ae);
        }
      }

      return {
        activeConsumableEffects: state.activeConsumableEffects.filter(
          e => !(e.personaId === personaId && e.remainingTurns <= 0)
        ),
        pendingFallbacks: state.pendingFallbacks || [], // Keep for backward compat but no new additions
      };
    });

    // Sync to session for per-session storage
    syncEffectsToSession(stateAny, get().activeConsumableEffects);

    return expiredMessages;
  },

  getAllActiveEffects: (personaId) => {
    // Combine equipment effects + active consumable effects
    const equipmentEffects = get().getEquipmentEffects(personaId);
    const consumableEffects = get().activeConsumableEffects
      .filter(e => e.personaId === personaId)
      .flatMap(e => e.effects);

    return [...equipmentEffects, ...consumableEffects];
  },

  removeEffect: (effectId) => {
    const stateAny = get() as any;
    // Find the effect before removing so we can reverse its attribute changes
    const effectToRemove = get().activeConsumableEffects.find(e => e.id === effectId);
    if (effectToRemove) {
      // FASE 20: Deactivate the slot item rule (fallbacks + end message)
      if (effectToRemove.ruleState) {
        deactivateSlotItemRule(stateAny, effectToRemove.ruleState, effectToRemove.itemId);
      }
      const item = get().getItemById(effectToRemove.itemId);
      if (item?.attributeEffects) {
        for (const ae of item.attributeEffects) {
          const activeEffect = effectToRemove.effects.find(e => e.attributeKey === ae.attributeKey);
          const effectTargetId = activeEffect?.targetId || ae.targetId;
          applyFallbackToSessionStats(stateAny, effectTargetId, ae.attributeKey, ae.fallbackValue, ae);
        }
      }
    }
    set((state) => ({
      activeConsumableEffects: state.activeConsumableEffects.filter(e => e.id !== effectId)
    }));

    // Sync to session for per-session storage
    syncEffectsToSession(stateAny, get().activeConsumableEffects);
  },

  clearAllEffects: (personaId) => {
    const stateAny = get() as any;
    // Reverse all active consumable effects for this persona before clearing
    const effectsToClear = get().activeConsumableEffects.filter(e => e.personaId === personaId);
    for (const effect of effectsToClear) {
      // FASE 20: Deactivate the slot item rule (fallbacks)
      if (effect.ruleState) {
        deactivateSlotItemRule(stateAny, effect.ruleState, effect.itemId);
      }
      const item = get().getItemById(effect.itemId);
      if (item?.attributeEffects) {
        for (const ae of item.attributeEffects) {
          const activeEffect = effect.effects.find(e => e.attributeKey === ae.attributeKey);
          const effectTargetId = activeEffect?.targetId || ae.targetId;
          applyFallbackToSessionStats(stateAny, effectTargetId, ae.attributeKey, ae.fallbackValue, ae);
        }
      }
    }
    // Also apply fallbacks for dynamic equipment effects for this persona
    const equippedItems = get().getEquippedItems(personaId);
    for (const { entry, item } of equippedItems) {
      const dynamicEffects = (item.attributeEffects || []).filter((e: ItemAttributeEffect) => e.mode === 'dynamic');
      if (dynamicEffects.length > 0) {
        for (const ae of dynamicEffects) {
          const effectTargetId = entry.targetOverrideId || ae.targetId;
          applyFallbackToSessionStats(stateAny, effectTargetId, ae.attributeKey, ae.fallbackValue, ae);
        }
      }
    }
    // Clean up dynamic equipment state for this persona
    const dynamicEqState = { ...get().dynamicEquipmentState };
    let changed = false;
    for (const key of Object.keys(dynamicEqState)) {
      if (key.startsWith(`${personaId}:`)) {
        delete dynamicEqState[key];
        changed = true;
      }
    }
    set((state) => ({
      activeConsumableEffects: state.activeConsumableEffects.filter(e => e.personaId !== personaId),
      ...(changed ? { dynamicEquipmentState: dynamicEqState } : {}),
    }));

    // Sync to session for per-session storage
    syncEffectsToSession(stateAny, get().activeConsumableEffects);
  },

  // ===== Currency Actions =====
  adjustCurrency: (personaId, amount) => {
    const stateAny = get() as any;
    const personas = stateAny.personas as Array<{ id: string; currency?: number; currencyName?: string }>;
    const persona = personas.find(p => p.id === personaId);
    if (!persona) return;

    const currentAmount = persona.currency ?? 0;
    const newAmount = Math.max(0, currentAmount + amount);
    stateAny.updatePersona(personaId, { currency: newAmount });

    const change = amount >= 0 ? `+${amount}` : `${amount}`;
    const currencyName = persona.currencyName || 'Divisa';
    get().addInventoryNotification({
      type: 'currency_changed',
      itemName: currencyName,
      quantity: amount,
      message: `${currencyName}: ${change} (Total: ${newAmount})`,
    });
  },

  canAfford: (personaId, price) => {
    const stateAny = get() as any;
    const personas = stateAny.personas as Array<{ id: string; currency?: number }>;
    const persona = personas.find(p => p.id === personaId);
    if (!persona) return false;
    return (persona.currency ?? 0) >= price;
  },

  purchaseItem: (personaId, itemId) => {
    const item = get().getItemById(itemId);
    if (!item || !item.price || item.price <= 0) return false;

    if (!get().canAfford(personaId, item.price)) return false;

    // Deduct currency and add item
    get().adjustCurrency(personaId, -item.price);
    get().addToPersona(personaId, itemId, 1);

    get().addInventoryNotification({
      type: 'item_added',
      itemId: item.id,
      itemName: item.name,
      quantity: 1,
      message: `Compraste ${item.name} por ${item.price} divisa${item.price !== 1 ? 's' : ''}`,
    });

    return true;
  },

  // ===== Shop =====
  getShopItems: () => {
    return get().items.filter(item => item.price && item.price > 0);
  },

  // ===== Settings Actions =====
  setInventorySettings: (settings) => set((state) => ({
    inventorySettings: { ...state.inventorySettings, ...settings }
  })),

  // ===== Notification Actions =====
  addInventoryNotification: (notification) => set((state) => ({
    inventoryNotifications: [
      {
        ...notification,
        id: generateId('notif'),
        timestamp: new Date().toISOString(),
        read: false,
      },
      ...state.inventoryNotifications
    ].slice(0, 50) // Keep last 50 notifications
  })),

  markNotificationRead: (id) => set((state) => ({
    inventoryNotifications: state.inventoryNotifications.map(n =>
      n.id === id ? { ...n, read: true } : n
    )
  })),

  clearInventoryNotifications: () => set({ inventoryNotifications: [] }),

  getUnreadNotifications: () => {
    return get().inventoryNotifications.filter(n => !n.read);
  },

  // ===== Pending Item Message =====
  clearPendingItemMessage: () => set({ pendingItemMessage: null }),

  // ===== Target Selection Actions =====
  requestEquipItem: (personaId, itemId) => set({
    pendingEquipAction: { type: 'equip', personaId, itemId }
  }),

  requestUseItem: (personaId, itemId) => set({
    pendingEquipAction: { type: 'use', personaId, itemId }
  }),

  clearPendingEquipAction: () => set({ pendingEquipAction: null }),

  executeEquipWithTarget: (personaId, itemId, targetOverrideId) => {
    const stateAny = get() as any;
    const personas = stateAny.personas as Array<{ id: string; inventoryItems?: PersonaInventoryEntry[]; equipmentSlots?: EquipmentSlotDefinition[] }>;
    const persona = personas.find(p => p.id === personaId);
    if (!persona?.inventoryItems) return;

    const item = get().getItemById(itemId);
    if (!item || item.type !== 'equipment') return;

    const entry = persona.inventoryItems.find(e => e.itemId === itemId);
    if (!entry) return;

    // Determine slot for the item
    const equipmentSlots = persona.equipmentSlots || [];
    let targetSlotId = '';
    let targetSlotEffect = item.slotEffects?.[0];

    if (item.slot) {
      const matchingSlot = equipmentSlots.find(s => s.id === item.slot || s.key === item.slot);
      if (matchingSlot) {
        targetSlotId = matchingSlot.id;
        const slotEffectForSlot = item.slotEffects?.find(se => se.slotId === matchingSlot.id);
        targetSlotEffect = slotEffectForSlot || targetSlotEffect;
      }
    }
    if (!targetSlotId && targetSlotEffect) {
      targetSlotId = targetSlotEffect.slotId;
    }
    if (!targetSlotId && item.slot) {
      targetSlotId = item.slot;
    }

    // If this item uses a slot, unequip any existing item in that slot first
    let updatedItems = [...persona.inventoryItems];
    const dynamicEqStateUpdates: Record<string, DynamicEquipmentState | undefined> = {};

    // FASE 20: Session equipment bookkeeping — deactivate rules of replaced
    // items and register the new equipment entry (with rule state)
    const sessionId = stateAny.activeSessionId as string | undefined;
    let ruleActivation: { ruleState: ActiveSlotRuleState; activationMessage: string } | null = null;
    let ruleEndMessage: string | null = null;
    if (sessionId && targetSlotId) {
      const sessions = stateAny.sessions as Array<{ id: string; sessionEquipment?: SessionEquipmentEntry[] }>;
      const session = sessions.find(s => s.id === sessionId);
      const currentEquipment = session?.sessionEquipment || [];

      // Deactivate rules of items being replaced in this slot (or this item elsewhere)
      for (const replaced of currentEquipment) {
        if (!replaced.ruleState) continue;
        const isReplaced = (replaced.equippedSlotId === targetSlotId && replaced.itemId !== itemId)
          || (replaced.itemId === itemId);
        if (!isReplaced) continue;
        const replacedEndMessage = deactivateSlotItemRule(stateAny, replaced.ruleState, replaced.itemId);
        if (replacedEndMessage) ruleEndMessage = replacedEndMessage;
      }

      // Activate the rule for the newly equipped item (target character first)
      ruleActivation = activateSlotItemRule(stateAny, {
        personaId,
        itemId,
        slotId: targetSlotId,
        targetCharacterId: targetOverrideId,
      });

      const updatedEquipment = [
        ...currentEquipment.filter(
          e => e.equippedSlotId !== targetSlotId && e.itemId !== itemId
        ),
        {
          itemId,
          equippedSlotId: targetSlotId,
          slotEffectText: targetSlotEffect?.effectText || undefined,
          ruleState: ruleActivation?.ruleState,
        } as SessionEquipmentEntry,
      ];
      stateAny.updateSession(sessionId, { sessionEquipment: updatedEquipment });
    }

    if (targetSlotId) {
      updatedItems = updatedItems.map(e => {
        if (e.equipped && e.equippedSlotId === targetSlotId && e.itemId !== itemId) {
          const eItem = get().getItemById(e.itemId);
          if (eItem?.attributeEffects) {
            for (const ae of eItem.attributeEffects) {
              const oldTargetId = e.targetOverrideId || ae.targetId;
              applyFallbackToSessionStats(stateAny, oldTargetId, ae.attributeKey, ae.fallbackValue, ae);
            }
          }
          if (eItem?.slotEffects && e.equippedSlotId) {
            const oldSlot = equipmentSlots.find(s => s.id === e.equippedSlotId);
            if (oldSlot) {
              stateAny.updateCharacterStat(targetOverrideId || '__user__', oldSlot.key, '', 'text');
            }
          }
          const oldStateKey = `${personaId}:${e.itemId}`;
          if (get().dynamicEquipmentState[oldStateKey]) {
            dynamicEqStateUpdates[oldStateKey] = undefined;
          }
          return { ...e, equipped: false, equippedSlotId: undefined };
        }
        return e;
      });
    }

    // Equip the item with target override
    updatedItems = updatedItems.map(e =>
      e.itemId === itemId ? { ...e, equipped: true, targetOverrideId, equippedSlotId: targetSlotId || undefined } : e
    );

    stateAny.updatePersona(personaId, { inventoryItems: updatedItems });

    // Clear pending action
    set({ pendingEquipAction: null });

    // Apply legacy equipment effects directly to SessionStats (with targetOverrideId)
    if (item.attributeEffects && item.attributeEffects.length > 0) {
      const effectsWithTarget = item.attributeEffects.map(ae => ({
        ...ae,
        targetId: targetOverrideId || ae.targetId,
        targetName: targetOverrideId === '__user__' ? 'Persona'
          : (targetOverrideId ? (stateAny.getCharacterById?.(targetOverrideId)?.name || targetOverrideId) : ae.targetName),
      }));
      const staticEffects = effectsWithTarget.filter(e => e.mode !== 'dynamic');
      const dynamicEffects = effectsWithTarget.filter(e => e.mode === 'dynamic');

      if (staticEffects.length > 0) {
        applyEffectsToSessionStats(stateAny, staticEffects);
      }

      for (const dynEffect of dynamicEffects) {
        applyDynamicEffectToSessionStats(stateAny, dynEffect, 0);
      }

      if (dynamicEffects.length > 0) {
        dynamicEqStateUpdates[`${personaId}:${itemId}`] = { activeTurns: 0, appliedAt: new Date().toISOString() };
      }
    }

    // Apply slot-based effects
    if (targetSlotId && targetSlotEffect) {
      const slotDef = equipmentSlots.find(s => s.id === targetSlotId);
      if (slotDef) {
        const slotValue = targetSlotEffect.effectText
          ? `${item.name}: ${targetSlotEffect.effectText}`
          : item.name;
        stateAny.updateCharacterStat(targetOverrideId || '__user__', slotDef.key, slotValue, 'text');
      }
    } else if (targetSlotId) {
      const slotDef = equipmentSlots.find(s => s.id === targetSlotId);
      if (slotDef) {
        stateAny.updateCharacterStat(targetOverrideId || '__user__', slotDef.key, item.name, 'text');
      }
    }

    // Apply dynamic equipment state updates (additions and deletions)
    if (Object.keys(dynamicEqStateUpdates).length > 0) {
      set((state) => {
        const newState = { ...state.dynamicEquipmentState };
        for (const [key, value] of Object.entries(dynamicEqStateUpdates)) {
          if (value === undefined) {
            delete newState[key];
          } else {
            newState[key] = value;
          }
        }
        return { dynamicEquipmentState: newState };
      });
    }

    const message = resolveSlotKeyInMessage(item.useMessage || `Equipaste ${item.name}`, targetSlotId || undefined, equipmentSlots);
    get().addInventoryNotification({
      type: 'item_equipped',
      itemId: item.id,
      itemName: item.name,
      quantity: 1,
      message: ruleActivation?.activationMessage || ruleEndMessage || message,
    });

    // Queue message for chat injection.
    // FASE 20: the new rule's activation message takes precedence; if a
    // replaced item's rule produced an end message and no activation message
    // exists, queue the end message instead.
    if (ruleActivation?.activationMessage) {
      set({ pendingItemMessage: resolveSlotKeyInMessage(ruleActivation.activationMessage, targetSlotId || undefined, equipmentSlots) });
    } else if (ruleEndMessage) {
      set({ pendingItemMessage: resolveSlotKeyInMessage(ruleEndMessage, targetSlotId || undefined, equipmentSlots) });
    } else if (item.useMessage) {
      set({ pendingItemMessage: resolveSlotKeyInMessage(item.useMessage, targetSlotId || undefined, equipmentSlots) });
    }
  },

  executeUseWithTarget: (personaId, itemId, targetOverrideId) => {
    const stateAny = get() as any;
    const personas = stateAny.personas as Array<{ id: string; inventoryItems?: PersonaInventoryEntry[] }>;
    const persona = personas.find(p => p.id === personaId);
    if (!persona?.inventoryItems) return;

    const item = get().getItemById(itemId);
    if (!item || item.type !== 'consumable') return;

    const entry = persona.inventoryItems.find(e => e.itemId === itemId);
    if (!entry || entry.quantity <= 0) return;

    // Reduce quantity (consumable is consumed on use)
    const updatedItems = persona.inventoryItems.map(e =>
      e.itemId === itemId
        ? { ...e, quantity: e.quantity - 1 }
        : e
    ).filter(e => e.quantity > 0); // Remove entries with 0 quantity

    stateAny.updatePersona(personaId, { inventoryItems: updatedItems });

    // Create active effect - override targetId in effects with the selected target
    const duration = item.duration ?? 1;
    const overriddenEffects = (item.attributeEffects || []).map(ef => ({
      ...ef,
      targetId: targetOverrideId || ef.targetId,
      targetName: targetOverrideId === '__user__' ? 'Persona'
        : (targetOverrideId ? (stateAny.getCharacterById?.(targetOverrideId)?.name || targetOverrideId) : ef.targetName),
    }));

    const effect: ActiveConsumableEffect = {
      id: generateId('effect'),
      itemId: item.id,
      itemName: item.name,
      personaId,
      effects: overriddenEffects,
      consumableEffect: item.consumableEffect,
      remainingTurns: duration,
      totalTurns: duration,
      useMessage: item.useMessage,
      expireMessage: item.expireMessage,
      appliedAt: new Date().toISOString(),
    };

    // FASE 20: Activate the slot item rule (any-slot resolution, target character first)
    const ruleActivation = activateSlotItemRule(stateAny, {
      personaId,
      itemId,
      targetCharacterId: targetOverrideId,
      anySlot: true,
    });
    if (ruleActivation) {
      effect.ruleState = ruleActivation.ruleState;
    }

    set((state) => ({
      activeConsumableEffects: [...state.activeConsumableEffects, effect],
      pendingEquipAction: null,
    }));

    // Sync to session for per-session storage
    syncEffectsToSession(stateAny, get().activeConsumableEffects);

    // Apply consumable effects directly to SessionStats (with overridden target)
    if (overriddenEffects.length > 0) {
      const staticEffects = overriddenEffects.filter(e => e.mode !== 'dynamic');
      const dynamicEffects = overriddenEffects.filter(e => e.mode === 'dynamic');

      // Apply static effects once
      if (staticEffects.length > 0) {
        applyEffectsToSessionStats(stateAny, staticEffects);
      }

      // Apply dynamic effects for turn 0
      for (const dynEffect of dynamicEffects) {
        applyDynamicEffectToSessionStats(stateAny, dynEffect, 0);
      }
    }

    const message = item.useMessage || `Usaste ${item.name} (${duration} turnos)`;

    get().addInventoryNotification({
      type: 'item_used',
      itemId: item.id,
      itemName: item.name,
      quantity: 1,
      message: ruleActivation?.activationMessage || message,
    });

    // Queue message for chat injection AFTER attribute change.
    // FASE 20: the rule's activation message takes precedence.
    if (ruleActivation?.activationMessage) {
      set({ pendingItemMessage: ruleActivation.activationMessage });
    } else if (item.useMessage) {
      set({ pendingItemMessage: item.useMessage });
    }
  },

  // ===== Utility =====
  // ===== Equipment Slots Resolution (per persona / per character) =====
  // (Global slot management actions were removed — slots live in Persona/Character config)

  getEquipmentSlotsForCharacter: (characterId?: string) => {
    if (!characterId) return [];
    const characters = (get() as any).characters || [];
    const character = characters.find((c: any) => c.id === characterId);
    return character?.equipmentSlots || [];
  },

  getEquipmentSlotsForPersona: (personaId?: string) => {
    const stateAny = get() as any;
    const targetId = personaId || stateAny.activePersonaId;
    if (!targetId) return [];
    const personas = stateAny.personas || [];
    const persona = personas.find((p: any) => p.id === targetId);
    return persona?.equipmentSlots || [];
  },

  getSlotDefinitionsForCharacter: (characterId?: string) => {
    if (!characterId) return [];
    const characters = (get() as any).characters || [];
    const character = characters.find((c: any) => c.id === characterId);
    return character?.slotDefinitions || [];
  },

  getSlotDefinitionsForPersona: () => {
    const personas = (get() as any).personas || [];
    const activePersonaId = (get() as any).activePersonaId;
    const persona = personas.find((p: any) => p.id === activePersonaId);
    return persona?.slotDefinitions || [];
  },

  exportInventory: () => {
    return {
      items: get().items,
      activeEffects: get().activeConsumableEffects,
      settings: get().inventorySettings,
      dynamicEquipmentState: get().dynamicEquipmentState,
    };
  },

  importInventory: (data) => {
    set((state) => {
      const importedSettings = data.settings;
      return {
        items: data.items ?? state.items,
        activeConsumableEffects: data.activeEffects ?? state.activeConsumableEffects,
        inventorySettings: importedSettings
          ? {
              ...state.inventorySettings,
              ...importedSettings,
              // Deep-merge equipmentSlots to avoid losing slots
              equipmentSlots: Array.isArray(importedSettings.equipmentSlots)
                ? importedSettings.equipmentSlots
                : state.inventorySettings.equipmentSlots || [],
            }
          : state.inventorySettings,
        dynamicEquipmentState: data.dynamicEquipmentState ?? state.dynamicEquipmentState,
      };
    });

    // Sync imported effects to session for per-session storage
    const stateAny = get() as any;
    syncEffectsToSession(stateAny, get().activeConsumableEffects);
  },
});

// ============================================
// Item Factory Functions
// ============================================

/**
 * Create a new consumable item
 */
export function createConsumableItem(
  name: string,
  options: {
    description?: string;
    rarity?: ItemRarity;
    icon?: string;
    duration?: number;
    attributeEffects?: ItemAttributeEffect[];
    slotEffects?: ItemSlotEffect[];
    consumableEffect?: string;
    useMessage?: string;
    expireMessage?: string;
    price?: number;
    triggerKeywords?: string[];
    contextKeys?: string[];
    tags?: string[];
    stackable?: boolean;
    maxStack?: number;
  } = {}
): Item {
  return {
    id: generateId('item'),
    name,
    description: options.description || '',
    category: 'consumable' as const,
    type: 'consumable',
    rarity: options.rarity || 'common',
    icon: options.icon || '🧪',
    attributeEffects: options.attributeEffects || [],
    slotEffects: options.slotEffects || [],
    consumableEffect: options.consumableEffect,
    duration: options.duration ?? 1,
    stackable: options.stackable ?? true,
    maxStack: options.maxStack ?? 99,
    useMessage: options.useMessage,
    expireMessage: options.expireMessage,
    price: options.price,
    triggerKeywords: options.triggerKeywords,
    contextKeys: options.contextKeys,
    tags: options.tags,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Create a new equipment item
 */
export function createEquipmentItem(
  name: string,
  options: {
    description?: string;
    rarity?: ItemRarity;
    icon?: string;
    slot?: string;
    attributeEffects?: ItemAttributeEffect[];
    slotEffects?: ItemSlotEffect[];
    useMessage?: string;
    unequipMessage?: string;
    price?: number;
    triggerKeywords?: string[];
    contextKeys?: string[];
    tags?: string[];
  } = {}
): Item {
  return {
    id: generateId('item'),
    name,
    description: options.description || '',
    category: 'weapon' as const,
    type: 'equipment',
    rarity: options.rarity || 'common',
    icon: options.icon || '⚔️',
    attributeEffects: options.attributeEffects || [],
    slotEffects: options.slotEffects || [],
    slot: options.slot,
    useMessage: options.useMessage,
    unequipMessage: options.unequipMessage,
    price: options.price,
    triggerKeywords: options.triggerKeywords,
    contextKeys: options.contextKeys,
    tags: options.tags,
    stackable: false,
    maxStack: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Apply item effects to session stats
 * This modifies session stats based on active item effects (equipment + consumables)
 * Returns the modified stats
 */
export function applyItemEffectsToStats(
  baseStats: Record<string, { value: number | string }>,
  effects: ItemAttributeEffect[],
  targetId: string
): Record<string, { value: number | string; modified: boolean; modifier?: string }> {
  const result: Record<string, { value: number | string; modified: boolean; modifier?: string }> = {};

  // Copy base stats
  for (const [key, stat] of Object.entries(baseStats)) {
    result[key] = { ...stat, modified: false };
  }

  // Apply effects
  for (const effect of effects) {
    if (effect.targetId !== targetId) continue;

    const stat = result[effect.attributeKey];
    if (!stat || typeof stat.value !== 'number') continue;

    const originalValue = stat.value;
    let newValue = originalValue;

    switch (effect.operator) {
      case '+':
        newValue = originalValue + effect.value;
        break;
      case '-':
        newValue = originalValue - effect.value;
        break;
      case '*':
        newValue = originalValue * effect.value;
        break;
      case '/':
        newValue = effect.value !== 0 ? originalValue / effect.value : originalValue;
        break;
      case '=':
        newValue = effect.value;
        break;
      case 'set_min':
        newValue = Math.min(originalValue, effect.value);
        break;
      case 'set_max':
        newValue = Math.max(originalValue, effect.value);
        break;
    }

    stat.value = newValue;
    stat.modified = true;
    stat.modifier = `${effect.operator}${effect.value}`;
  }

  return result;
}

/**
 * Build inventory prompt section
 * Creates a text block showing current inventory, active effects, and currency
 */
export function buildInventoryPromptSectionV2(
  personaId: string,
  getPersonaItems: () => Array<{ entry: PersonaInventoryEntry; item: Item }>,
  getEquippedItems: () => Array<{ entry: PersonaInventoryEntry; item: Item }>,
  activeConsumableEffects: ActiveConsumableEffect[],
  currency: number,
  currencyName: string,
  template: string
): string {
  // Build items list
  const personaItems = getPersonaItems();
  const equippedItems = getEquippedItems();
  const personaEffects = activeConsumableEffects.filter(e => e.personaId === personaId);

  const itemLines = personaItems.map(({ entry, item }) => {
    const qty = entry.quantity > 1 ? ` x${entry.quantity}` : '';
    const eq = entry.equipped ? ' [Equipado]' : '';
    const effects = (item.attributeEffects?.length ?? 0) > 0
      ? ` (${item.attributeEffects!.map(e => `${e.operator}${e.value} ${e.attributeKey}`).join(', ')})`
      : '';
    return `- ${item.icon || ''} ${item.name}${qty}${eq}${effects}`;
  }).join('\n');

  // Build active effects list
  const effectLines = personaEffects.map(e => {
    const turnsLeft = e.remainingTurns > 0 ? ` (${e.remainingTurns}/${e.totalTurns} turnos)` : '';
    const effectDesc = e.effects.map(ef =>
      `${ef.operator}${ef.value} ${ef.attributeKey}${ef.targetId !== '__user__' ? ` → ${ef.targetName || ef.targetId}` : ''}`
    ).join(', ');
    return `- ${e.itemName}: ${effectDesc}${turnsLeft}`;
  }).join('\n');

  // Build equipped items list
  const equipLines = equippedItems.map(({ item }) => {
    const effects = (item.attributeEffects ?? []).map(e => `${e.operator}${e.value} ${e.attributeKey}`).join(', ');
    return `- ${item.icon || ''} ${item.name}${item.slot ? ` [${item.slot}]` : ''}${effects ? ` → ${effects}` : ''}`;
  }).join('\n');

  // Build currency
  const currencyLine = `${currencyName}: ${currency}`;

  return template
    .replace('{{activeItems}}', itemLines || 'Vacío')
    .replace('{{activeEffects}}', effectLines || 'Ninguno')
    .replace('{{equippedItems}}', equipLines || 'Ninguno')
    .replace('{{currency}}', currencyLine);
}

// ============================================
// Session Stats Integration
// ============================================

/**
 * Apply inventory item effects (equipment + consumables) to session stats.
 * Returns a DEEP COPY of sessionStats with attribute values modified by item effects.
 * This is called BEFORE resolveStats() so that item effects are reflected in {{key}} templates.
 *
 * Item effects can target:
 * - '__user__' (persona) — applies to persona's attribute values
 * - characterId — applies to that character's attribute values
 */
export function applyInventoryEffectsToSessionStats(
  sessionStats: SessionStats | undefined,
  equippedItems: Array<{ entry: PersonaInventoryEntry; item: Item }>,
  activeEffects: ActiveConsumableEffect[],
  pendingFallbacks?: Array<{ targetId: string; attributeKey: string; fallbackValue: string | number }>,
): SessionStats | undefined {
  if (!sessionStats?.characterStats) return sessionStats;

  // Deep copy sessionStats to avoid mutation
  const modified: SessionStats = JSON.parse(JSON.stringify(sessionStats));

  // Apply pending fallbacks first (set attribute directly to fallback value)
  if (pendingFallbacks && pendingFallbacks.length > 0) {
    for (const fb of pendingFallbacks) {
      const targetId = fb.targetId || '__user__';
      const charStats = modified.characterStats[targetId];
      if (!charStats?.attributeValues) continue;

      const currentValue = charStats.attributeValues[fb.attributeKey];
      if (currentValue === undefined) continue;

      charStats.attributeValues[fb.attributeKey] = typeof fb.fallbackValue === 'number'
        ? fb.fallbackValue
        : (isNaN(Number(fb.fallbackValue)) ? fb.fallbackValue : Number(fb.fallbackValue));
    }
  }

  // Collect ALL effects: equipment (permanent while equipped) + consumable (temporary)
  const allEffects: ItemAttributeEffect[] = [];

  // Equipment effects (from equipped items) — respect targetOverrideId from entry
  for (const { entry, item } of equippedItems) {
    if (item.attributeEffects) {
      for (const effect of item.attributeEffects) {
        // If the entry has a targetOverrideId, override the effect's targetId
        const effectiveTargetId = entry.targetOverrideId || effect.targetId;
        const effectiveTargetName = entry.targetOverrideId
          ? (entry.targetOverrideId === '__user__' ? 'Persona' : effect.targetName)
          : effect.targetName;
        allEffects.push({ ...effect, targetId: effectiveTargetId, targetName: effectiveTargetName });
      }
    }
  }

  // Consumable effects (from active effects)
  for (const effect of activeEffects) {
    allEffects.push(...effect.effects);
  }

  if (allEffects.length === 0 && (!pendingFallbacks || pendingFallbacks.length === 0)) return sessionStats;

  // Group effects by targetId
  const effectsByTarget = new Map<string, ItemAttributeEffect[]>();
  for (const effect of allEffects) {
    const targetId = effect.targetId || '__user__';
    if (!effectsByTarget.has(targetId)) {
      effectsByTarget.set(targetId, []);
    }
    effectsByTarget.get(targetId)!.push(effect);
  }

  // Apply effects for each target
  for (const [targetId, targetEffects] of effectsByTarget) {
    const charStats = modified.characterStats[targetId];
    if (!charStats?.attributeValues) continue;

    for (const effect of targetEffects) {
      const currentValue = charStats.attributeValues[effect.attributeKey];
      if (currentValue === undefined) continue;

      const currentNum = typeof currentValue === 'number' ? currentValue : parseFloat(String(currentValue));
      if (isNaN(currentNum)) continue;

      let newValue = currentNum;
      switch (effect.operator) {
        case '+': newValue = currentNum + effect.value; break;
        case '-': newValue = currentNum - effect.value; break;
        case '*': newValue = currentNum * effect.value; break;
        case '/': newValue = effect.value !== 0 ? currentNum / effect.value : currentNum; break;
        case '=': newValue = effect.value; break;
        case 'set_min': newValue = Math.min(currentNum, effect.value); break;
        case 'set_max': newValue = Math.max(currentNum, effect.value); break;
      }

      charStats.attributeValues[effect.attributeKey] = Math.round(newValue * 100) / 100;
    }
  }

  return modified;
}
