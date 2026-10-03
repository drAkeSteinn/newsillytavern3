// ============================================
// Scenario System V2 — ESCENARIO (Utility Functions)
// ============================================
//
// The character has a scenario (ScenarioConfig) with multiple LOCATIONS.
// Each location = { id, name, description, isDefault? }.
//
// GROUPS: a CharacterGroup can define its OWN scenarioConfig. When enabled
// with at least 1 location, the GROUP scenario REPLACES every member's
// character-level scenario in group chats, so all members share the same
// location list (everyone "en la misma sintonía"). If the group has no
// scenario, each member falls back to their own character-level one.
//
// The ACTIVE location is stored in the SESSION state
// (SessionStats.activeScenarioId — session-level, shared by all chat
// participants) and is set by:
//   - the manage_escenario tool (the character decides where the scene is), or
//   - a quick reply's scenarioAction (moves the scene on click), or
//   - the session start (a greeting that pins a standard location).
//
// Resolution order for the active location:
//   1. activeScenarioId (if it still exists in the scenario config)
//   2. the location flagged isDefault
//   3. the first location in the list
//
// The {{escenario}} key (alias {{scenario}}) resolves to the active
// location's description, wrapped in the block header (default: [ESCENARIO]).

import type { ScenarioConfig, ScenarioLocation, SessionStats, CharacterCard } from '@/types';

/**
 * Any entity that can own a scenario config (CharacterCard or CharacterGroup).
 * Structural typing keeps call sites simple — no imports of the group type.
 */
export type ScenarioSource = { scenarioConfig?: ScenarioConfig } | null | undefined;

/** Check whether a scenario config is USABLE (enabled + ≥1 valid location). */
export function isScenarioConfigAvailable(config: ScenarioConfig | undefined): boolean {
  if (!config?.enabled) return false;
  return getLocations(config).length > 0;
}

/**
 * Effective scenario config for a chat.
 * GROUP PRIORITY: if the group has a usable scenarioConfig, it replaces the
 * character's own one (shared scene for all members). Otherwise the
 * character's config is used (1:1 chats and legacy groups).
 */
export function getEffectiveScenarioConfig(
  character: CharacterCard | undefined,
  group?: ScenarioSource
): ScenarioConfig | undefined {
  if (group?.scenarioConfig && isScenarioConfigAvailable(group.scenarioConfig)) {
    return group.scenarioConfig;
  }
  return character?.scenarioConfig;
}

/**
 * Raw scenario config as it may arrive from imports, stale localStorage or
 * hand-edited data. Validates and normalizes any shape, guaranteeing exactly
 * one default location when the list is non-empty.
 */
export function normalizeScenarioConfig(raw: any): ScenarioConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  if (!Array.isArray(raw.locations)) return undefined;

  // Keep only valid location objects (id + name + description strings)
  const locations: ScenarioLocation[] = raw.locations
    .filter((l: any) => l && typeof l === 'object' && typeof l.id === 'string' && l.id)
    .map((l: any) => ({
      id: l.id,
      name: typeof l.name === 'string' ? l.name : '',
      description: typeof l.description === 'string' ? l.description : '',
      ...(l.isDefault === true ? { isDefault: true } : {}),
    }));

  // Ensure exactly one default (first one wins; falls back to first location)
  if (locations.length > 0 && !locations.some(l => l.isDefault)) {
    locations[0] = { ...locations[0], isDefault: true };
  }
  const seenDefault = locations.findIndex(l => l.isDefault);
  if (seenDefault !== -1) {
    for (let i = 0; i < locations.length; i++) {
      if (i !== seenDefault && locations[i].isDefault) locations[i] = { ...locations[i], isDefault: false };
    }
  }

  return {
    enabled: raw.enabled === true,
    locations,
    ...(typeof raw.blockHeader === 'string' && raw.blockHeader ? { blockHeader: raw.blockHeader } : {}),
  };
}

/** Get all locations from the scenario config (order preserved). */
export function getLocations(config: ScenarioConfig | undefined): ScenarioLocation[] {
  if (!config?.enabled || !config.locations || config.locations.length === 0) return [];
  return config.locations.filter(l => l && l.id);
}

/** Get the location flagged as default (or null if none). */
export function getDefaultLocation(config: ScenarioConfig | undefined): ScenarioLocation | null {
  const locations = getLocations(config);
  return locations.find(l => l.isDefault === true) || null;
}

/**
 * Get the active scenario location id from the SESSION stats.
 * Session-level: the scene is shared by all participants of the chat.
 * (null = none / follow default)
 */
export function getActiveScenarioId(
  sessionStats: SessionStats | null | undefined
): string | null {
  if (!sessionStats) return null;
  return sessionStats.activeScenarioId ?? null;
}

/** Normalize a string for location matching (lowercase, no accents, trimmed). */
function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Find a location by id or name (normalized). Falls back to a substring match.
 * Returns null if no match is found.
 */
export function findLocationByNameOrId(
  locations: ScenarioLocation[],
  query: string
): ScenarioLocation | null {
  const q = normalizeName(query);
  if (!q) return null;

  // 1) exact id match
  const byId = locations.find(l => l.id === query);
  if (byId) return byId;

  // 2) exact normalized name match
  const byName = locations.find(l => normalizeName(l.name) === q);
  if (byName) return byName;

  // 3) substring match (name contains query or query contains name)
  const byIncludes = locations.find(
    l => normalizeName(l.name).includes(q) || q.includes(normalizeName(l.name))
  );
  return byIncludes || null;
}

/**
 * Resolve the location where the scene currently takes place.
 *
 * @param group   Optional group — its scenarioConfig REPLACES the character's when available.
 * @returns The active ScenarioLocation, or null if the scenario is not configured.
 */
export function resolveActiveLocation(
  character: CharacterCard | undefined,
  sessionStats: SessionStats | null | undefined,
  group?: ScenarioSource
): ScenarioLocation | null {
  const config = getEffectiveScenarioConfig(character, group);
  const locations = getLocations(config);
  if (locations.length === 0) return null;

  const activeId = getActiveScenarioId(sessionStats);

  // 1) explicit active location from the session (still exists?)
  if (activeId) {
    const active = locations.find(l => l.id === activeId);
    if (active) return active;
  }

  // 2) default location
  const fallback = getDefaultLocation(config);
  if (fallback) return fallback;

  // 3) first location
  return locations[0];
}

/**
 * Resolve the {{escenario}} key to the active location's description.
 * Returns the content string, or empty string if the scenario is not configured.
 *
 * The content is wrapped in the block header (default: [ESCENARIO]) if non-empty.
 * In group chats the group's scenario (when configured) replaces the character's.
 */
export function resolveScenarioKey(
  character: CharacterCard | undefined,
  sessionStats: SessionStats | null | undefined,
  group?: ScenarioSource
): string {
  const location = resolveActiveLocation(character, sessionStats, group);
  if (!location) return '';

  const config = getEffectiveScenarioConfig(character, group);
  const header = config?.blockHeader || '[ESCENARIO]';
  const content = location.description?.trim();
  if (!content) return '';

  return `${header}\n${content}`;
}

/**
 * Get scenario info for the manage_escenario tool and the prompt section.
 * Returns the active location, the active/default ids and the full location list.
 * In group chats the group's scenario (when configured) replaces the character's.
 */
export function getScenarioInfo(
  character: CharacterCard | undefined,
  sessionStats: SessionStats | null | undefined,
  group?: ScenarioSource
): {
  current: ScenarioLocation | null;
  activeId: string | null;
  defaultId: string | null;
  locations: ScenarioLocation[];
  totalLocations: number;
  isGroupScenario: boolean;
} | null {
  const config = getEffectiveScenarioConfig(character, group);
  const locations = getLocations(config);
  if (locations.length === 0) return null;

  const current = resolveActiveLocation(character, sessionStats, group);
  const activeId = getActiveScenarioId(sessionStats);
  const defaultLocation = getDefaultLocation(config);

  return {
    current,
    activeId,
    defaultId: defaultLocation?.id ?? null,
    locations,
    totalLocations: locations.length,
    isGroupScenario: !!(group?.scenarioConfig && isScenarioConfigAvailable(group.scenarioConfig)),
  };
}

/**
 * Check if the scenario is available for a character (or its group).
 * Requires: an effective scenarioConfig (group first, then character) with
 * enabled === true and at least 1 location.
 */
export function isScenarioAvailable(character: CharacterCard | undefined, group?: ScenarioSource): boolean {
  return isScenarioConfigAvailable(getEffectiveScenarioConfig(character, group));
}

/**
 * Resolve the scenario location pinned to a greeting by swipe/greeting index.
 * Index 0 = firstMes, index >= 1 = alternateGreetings[index - 1].
 *
 * The swipe list used at session creation only contains NON-EMPTY greetings,
 * so this helper mirrors that filter when mapping an index back to a
 * scenario id.
 */
export function resolveGreetingScenarioId(
  character: CharacterCard | undefined,
  greetingIndex: number
): string | null {
  if (!character || greetingIndex < 0) return null;

  // Parallel array of scenario ids aligned with [firstMes, ...alternateGreetings]
  const scenarioIds = [
    character.firstMesScenarioId ?? null,
    ...(character.greetingScenarioIds || []).map(id => id ?? null),
  ];

  // Mirror the non-empty filter applied to greetings at session creation:
  // only greetings with text consume an index in the swipe list.
  const texts = [character.firstMes, ...(character.alternateGreetings || [])];
  let nonEmptySeen = -1;
  for (let i = 0; i < texts.length; i++) {
    if ((texts[i] || '').trim()) {
      nonEmptySeen++;
      if (nonEmptySeen === greetingIndex) return scenarioIds[i] ?? null;
    }
  }
  return null;
}
