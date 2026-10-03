// ============================================
// Wardrobe System V2 — GUARDARROPA (Utility Functions)
// ============================================
//
// The character has a wardrobe (WardrobeConfig) with multiple OUTFITS.
// Each outfit = { id, name, description, isDefault? }.
//
// The ACTIVE outfit is stored in the session state
// (CharacterSessionStats.activeOutfitId) and is set by:
//   - the manage_wardrobe tool (the character decides what to wear), or
//   - a manual override from the chat UI.
//
// Resolution order for the worn outfit:
//   1. activeOutfitId (if it still exists in the wardrobe)
//   2. the outfit flagged isDefault
//   3. the first outfit in the list
//
// The {{vestuario}} key (alias {{wardrobe}}) resolves to the worn outfit's
// description, wrapped in the block header (default: [VESTUARIO]).

import type { WardrobeConfig, WardrobeOutfit, SessionStats, CharacterCard } from '@/types';

/** Raw wardrobe config as it may arrive from legacy data, imports or stale localStorage. */
export function normalizeWardrobeConfig(raw: any): WardrobeConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;

  // Legacy V1 format: { enabled, levels: [{ id, threshold, content }] } — migrate to outfits.
  if (!Array.isArray(raw.outfits) && Array.isArray(raw.levels)) {
    const migrated: WardrobeOutfit[] = raw.levels
      .filter((lvl: any) => lvl && typeof lvl === 'object')
      .map((lvl: any, i: number) => ({
        id: typeof lvl.id === 'string' && lvl.id ? lvl.id : `outfit-legacy-${i}-${Date.now()}`,
        name: typeof lvl.name === 'string' && lvl.name.trim() ? lvl.name.trim() : `Nivel ${lvl.threshold ?? i + 1}`,
        description: typeof lvl.content === 'string' ? lvl.content.trim() : '',
        isDefault: i === 0,
      }))
      .filter(o => o.description.length > 0);
    if (migrated.length === 0) return undefined;
    return { enabled: raw.enabled !== false, outfits: migrated, blockHeader: raw.blockHeader };
  }

  if (!Array.isArray(raw.outfits)) return undefined;

  // Keep only valid outfit objects (id + name + description strings)
  const outfits: WardrobeOutfit[] = raw.outfits
    .filter((o: any) => o && typeof o === 'object' && typeof o.id === 'string' && o.id)
    .map((o: any) => ({
      id: o.id,
      name: typeof o.name === 'string' ? o.name : '',
      description: typeof o.description === 'string' ? o.description : '',
      ...(o.isDefault === true ? { isDefault: true } : {}),
    }));

  // Ensure exactly one default (first one wins; falls back to first outfit)
  if (outfits.length > 0 && !outfits.some(o => o.isDefault)) {
    outfits[0] = { ...outfits[0], isDefault: true };
  }
  const seenDefault = outfits.findIndex(o => o.isDefault);
  if (seenDefault !== -1) {
    for (let i = 0; i < outfits.length; i++) {
      if (i !== seenDefault && outfits[i].isDefault) outfits[i] = { ...outfits[i], isDefault: false };
    }
  }

  return {
    enabled: raw.enabled === true,
    outfits,
    ...(typeof raw.blockHeader === 'string' && raw.blockHeader ? { blockHeader: raw.blockHeader } : {}),
  };
}

/** Get all enabled outfits from the wardrobe config (order preserved). */
export function getOutfits(config: WardrobeConfig | undefined): WardrobeOutfit[] {
  if (!config?.enabled || !config.outfits || config.outfits.length === 0) return [];
  return config.outfits.filter(o => o && o.id);
}

/** Get the outfit flagged as default (or null if none). */
export function getDefaultOutfit(config: WardrobeConfig | undefined): WardrobeOutfit | null {
  const outfits = getOutfits(config);
  return outfits.find(o => o.isDefault === true) || null;
}

/** Get the active outfit id from session stats (null = none / follow default). */
export function getActiveOutfitId(
  sessionStats: SessionStats | null | undefined,
  characterId: string | undefined
): string | null {
  if (!sessionStats || !characterId) return null;
  return sessionStats.characterStats?.[characterId]?.activeOutfitId ?? null;
}

/** Normalize a string for outfit matching (lowercase, no accents, trimmed). */
function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Find an outfit by id or name (normalized). Falls back to a substring match.
 * Returns null if no match is found.
 */
export function findOutfitByNameOrId(
  outfits: WardrobeOutfit[],
  query: string
): WardrobeOutfit | null {
  const q = normalizeName(query);
  if (!q) return null;

  // 1) exact id match
  const byId = outfits.find(o => o.id === query);
  if (byId) return byId;

  // 2) exact normalized name match
  const byName = outfits.find(o => normalizeName(o.name) === q);
  if (byName) return byName;

  // 3) substring match (name contains query or query contains name)
  const byIncludes = outfits.find(
    o => normalizeName(o.name).includes(q) || q.includes(normalizeName(o.name))
  );
  return byIncludes || null;
}

/**
 * Resolve the outfit currently worn by the character.
 *
 * @returns The worn WardrobeOutfit, or null if the wardrobe is not configured.
 */
export function resolveActiveOutfit(
  character: CharacterCard | undefined,
  sessionStats: SessionStats | null | undefined,
  characterId: string | undefined
): WardrobeOutfit | null {
  const config = character?.wardrobeConfig;
  const outfits = getOutfits(config);
  if (outfits.length === 0) return null;

  const activeId = getActiveOutfitId(sessionStats, characterId);

  // 1) explicit active outfit from the session (still exists?)
  if (activeId) {
    const active = outfits.find(o => o.id === activeId);
    if (active) return active;
  }

  // 2) default outfit
  const fallback = getDefaultOutfit(config);
  if (fallback) return fallback;

  // 3) first outfit
  return outfits[0];
}

/**
 * Resolve the {{vestuario}} key to the worn outfit's description.
 * Returns the content string, or empty string if the wardrobe is not configured.
 *
 * The content is wrapped in the block header (default: [VESTUARIO]) if non-empty.
 */
export function resolveWardrobeKey(
  character: CharacterCard | undefined,
  sessionStats: SessionStats | null | undefined,
  characterId: string | undefined
): string {
  const outfit = resolveActiveOutfit(character, sessionStats, characterId);
  if (!outfit) return '';

  const config = character?.wardrobeConfig;
  const header = config?.blockHeader || '[VESTUARIO]';
  const content = outfit.description?.trim();
  if (!content) return '';

  return `${header}\n${content}`;
}

/**
 * Get wardrobe info for the manage_wardrobe tool and the prompt section.
 * Returns the worn outfit, the active/default ids and the full outfit list.
 */
export function getWardrobeInfo(
  character: CharacterCard | undefined,
  sessionStats: SessionStats | null | undefined,
  characterId: string | undefined
): {
  current: WardrobeOutfit | null;
  activeId: string | null;
  defaultId: string | null;
  outfits: WardrobeOutfit[];
  totalOutfits: number;
} | null {
  const config = character?.wardrobeConfig;
  const outfits = getOutfits(config);
  if (outfits.length === 0) return null;

  const current = resolveActiveOutfit(character, sessionStats, characterId);
  const activeId = getActiveOutfitId(sessionStats, characterId);
  const defaultOutfit = getDefaultOutfit(config);

  return {
    current,
    activeId,
    defaultId: defaultOutfit?.id ?? null,
    outfits,
    totalOutfits: outfits.length,
  };
}

/**
 * Check if the wardrobe is available for a character.
 * Requires: wardrobeConfig.enabled === true and at least 1 outfit.
 */
export function isWardrobeAvailable(character: CharacterCard | undefined): boolean {
  if (!character) return false;
  const config = character.wardrobeConfig;
  if (!config?.enabled) return false;
  return getOutfits(config).length > 0;
}
