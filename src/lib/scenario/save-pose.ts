// ============================================
// Scenario Pose Saver — FONDO-BOUND, stored IN THE COLLECTION JSON (V3.2)
// ============================================
// The sprite pose (position + scale + opacity) is bound to the BACKGROUND
// (fondo), NOT to the escenario/lugar/punto level, and it is UNIQUE per
// (fondo × personaje): each character keeps its own pose on every fondo.
//
// STORAGE (per user request):
//   PRIMARY  → the fondo's collection entry: entry.spritePoses[characterId].
//              Persisted SERVER-SIDE in the collection folder's own JSON
//              (public/backgrounds/{colección}/collection.json) via
//              PUT /api/backgrounds/collections { poseAction } — so poses
//              travel with the collection (Datos export includes
//              backgroundCollections) and survive reloads.
//   FALLBACK → settings.spriteBackgroundPoses[characterId][backgroundUrl],
//              only for fondos that do NOT belong to any collection (and for
//              poses saved by the V3.1 build).
//
// The pose is applied automatically whenever the ACTIVE background changes to
// a fondo that has a saved pose, no matter the source of the change:
//   - manual (Ajustes → Fondos gallery, or any background picker)
//   - scenario switcher (manual scene move — escenario, lugar or punto)
//   - tool calling (manage_escenario "go" → scenario_activation SSE)
//   - activation keys (use-trigger-system)
// All of those converge on `activeBackground`, which the CharacterSprite
// component watches reactively.
//
// LEGACY COMPAT: node poses from Task 17 (spot/place/legacy-location
// .spritePose) still work via resolveLegacyLocationPoseForBackground().

import { useTavernStore } from '@/store';
import {
  getEffectiveScenarioDefinitions,
  resolveActiveScenarioLocation,
  resolveLocationBackground,
  normalizeSpritePose,
} from './library';
import type { SpritePose } from '@/types';

/** Minimal structural view of the store pieces needed for pose lookup. */
export interface SpritePoseLookupState {
  backgroundCollections: {
    name: string;
    path?: string;
    entries?: { url: string; name?: string; spritePoses?: Record<string, SpritePose> }[];
  }[];
  settings: { spriteBackgroundPoses?: Record<string, Record<string, SpritePose>> };
}

export interface SaveSpritePoseResult {
  ok: boolean;
  /** Human readable name of the fondo the pose was bound to. */
  where?: string;
  /** Where the pose was persisted. */
  storage?: 'collection' | 'settings';
  error?:
    | 'no-background'   // no active background to bind the pose to
    | 'invalid-pose'    // pose could not be normalized
    | 'save-failed';    // server rejected the collection.json write
}

/** Registry shape kept in settings as FALLBACK: characterId → backgroundUrl → pose. */
export type SpriteBackgroundPoseMap = NonNullable<
  import('@/types').AppSettings['spriteBackgroundPoses']
>;

// ============================================
// LOOKUP (pure — safe inside zustand selectors)
// ============================================

/**
 * Read the pose saved for (character, fondo).
 * Order: collection entry (the collection JSON) → settings fallback.
 * PURE: takes the state explicitly so CharacterSprite can use it inside a
 * reactive zustand selector (stable object identity per store version).
 */
export function lookupSpritePoseForBackground(
  state: SpritePoseLookupState,
  characterId: string | undefined | null,
  backgroundUrl: string | undefined | null
): SpritePose | null {
  if (!characterId || !backgroundUrl) return null;
  // 1) PRIMARY: the fondo's collection entry (collection.json)
  const collections = state.backgroundCollections;
  if (Array.isArray(collections)) {
    for (const col of collections) {
      const entry = col.entries?.find((e) => e.url === backgroundUrl);
      if (entry) {
        const fromEntry = entry.spritePoses?.[characterId];
        if (fromEntry) return fromEntry;
        // Entry exists but has no pose for THIS character → fall through to
        // the settings compat check (V3.1 poses may live there).
        break;
      }
    }
  }
  // 2) FALLBACK: settings registry (V3.1 poses / orphan fondos)
  return state.settings.spriteBackgroundPoses?.[characterId]?.[backgroundUrl] ?? null;
}

/** Imperative wrapper of lookupSpritePoseForBackground over the live store. */
export function getSpritePoseForBackground(
  characterId: string | undefined | null,
  backgroundUrl: string | undefined | null
): SpritePose | null {
  const state = useTavernStore.getState();
  return lookupSpritePoseForBackground(state, characterId, backgroundUrl);
}

/** Find the collection + entry that own a fondo URL (imperative). */
export function findCollectionEntryForBackground(
  backgroundUrl: string
): { collectionName: string; folderName: string; entryUrl: string } | null {
  const collections = useTavernStore.getState().backgroundCollections;
  for (const col of collections) {
    if (col.entries?.some((e) => e.url === backgroundUrl)) {
      const folderName = decodeURIComponent(col.path?.split('/').filter(Boolean).pop() || col.name);
      return { collectionName: col.name, folderName, entryUrl: backgroundUrl };
    }
  }
  return null;
}

/** Pretty name for a fondo URL (entry name in the collections, else filename). */
export function resolveBackgroundDisplayName(backgroundUrl: string): string {
  try {
    const collections = useTavernStore.getState().backgroundCollections;
    for (const col of collections) {
      const entry = col.entries?.find((e) => e.url === backgroundUrl);
      if (entry?.name?.trim()) return entry.name.trim();
    }
  } catch {
    // fall through to the URL fallback
  }
  const raw = backgroundUrl.split('/').pop() || backgroundUrl;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// ============================================
// SAVE (async — persists to the collection JSON server-side)
// ============================================

/**
 * Save `pose` bound to the CURRENT active background for `characterId`.
 * The pose is normalized/clamped before writing.
 *
 * Flow: optimistic store update (setEntrySpritePose) → PUT to the collections
 * API (writes collection.json in the collection folder). If the fondo is not
 * in any collection, falls back to the settings registry. If the store copy
 * looks stale the collections are re-fetched from the server first.
 */
export async function saveSpritePoseToCurrentBackground(
  characterId: string,
  pose: unknown
): Promise<SaveSpritePoseResult> {
  const normalized: SpritePose | undefined = normalizeSpritePose(pose);
  if (!normalized) return { ok: false, error: 'invalid-pose' };

  const store = useTavernStore.getState();
  const backgroundUrl = store.activeBackground;
  if (!backgroundUrl) return { ok: false, error: 'no-background' };

  const where = resolveBackgroundDisplayName(backgroundUrl);
  const target = findCollectionEntryForBackground(backgroundUrl);

  // --- PRIMARY: the fondo belongs to a collection → collection JSON ---
  if (target) {
    // Optimistic store update (reactive for CharacterSprite + badges)
    store.setEntrySpritePose?.(backgroundUrl, characterId, normalized);
    try {
      const res = await fetch('/api/backgrounds/collections', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderName: target.folderName,
          entryUrl: backgroundUrl,
          poseAction: 'set',
          characterId,
          pose: normalized,
        }),
      });
      if (!res.ok) throw new Error(`PUT /api/backgrounds/collections → ${res.status}`);
      return { ok: true, where, storage: 'collection' };
    } catch (err) {
      console.error('[save-pose] Failed to persist pose in collection.json:', err);
      return { ok: false, error: 'save-failed' };
    }
  }

  // --- The store copy may be stale: refresh once from the server scan ---
  try {
    const res = await fetch('/api/backgrounds/collections');
    if (res.ok) {
      const data = await res.json();
      const fresh = Array.isArray(data.collections) ? data.collections : null;
      if (fresh) {
        const found = fresh.some((col: { entries?: { url: string }[] }) =>
          col.entries?.some((e) => e.url === backgroundUrl)
        );
        if (found) {
          useTavernStore.getState().setBackgroundCollections(fresh);
          useTavernStore.getState().setEntrySpritePose?.(backgroundUrl, characterId, normalized);
          const col2 = fresh.find((col: { entries?: { url: string }[] }) =>
            col.entries?.some((e) => e.url === backgroundUrl)
          );
          const folderName = decodeURIComponent(
            col2?.path?.split('/').filter(Boolean).pop() || col2?.name || ''
          );
          const res2 = await fetch('/api/backgrounds/collections', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              folderName,
              entryUrl: backgroundUrl,
              poseAction: 'set',
              characterId,
              pose: normalized,
            }),
          });
          if (!res2.ok) throw new Error(`PUT → ${res2.status}`);
          return { ok: true, where, storage: 'collection' };
        }
      }
    }
  } catch (err) {
    console.error('[save-pose] Collection refresh failed:', err);
  }

  // --- FALLBACK: fondo not in any collection → settings registry ---
  const state = useTavernStore.getState();
  const registry: SpriteBackgroundPoseMap = {
    ...(state.settings.spriteBackgroundPoses ?? {}),
  };
  registry[characterId] = {
    ...(registry[characterId] ?? {}),
    [backgroundUrl]: normalized,
  };
  state.updateSettings?.({ spriteBackgroundPoses: registry });
  return { ok: true, where, storage: 'settings' };
}

// ============================================
// CLEAR
// ============================================

/** Remove the saved pose of `characterId` for a fondo (both storages). True if something was removed. */
export async function clearSpritePoseForBackground(
  characterId: string,
  backgroundUrl: string
): Promise<boolean> {
  let removed = false;

  // 1) collection entry (collection.json)
  const target = findCollectionEntryForBackground(backgroundUrl);
  if (target) {
    const had = !!lookupSpritePoseForBackground(useTavernStore.getState(), characterId, backgroundUrl);
    useTavernStore.getState().setEntrySpritePose?.(backgroundUrl, characterId, null);
    try {
      await fetch('/api/backgrounds/collections', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderName: target.folderName,
          entryUrl: backgroundUrl,
          poseAction: 'clear',
          characterId,
        }),
      });
    } catch (err) {
      console.error('[save-pose] Failed to clear pose in collection.json:', err);
    }
    removed = removed || had;
  }

  // 2) settings fallback (always cleaned too)
  const store = useTavernStore.getState();
  const registry = store.settings.spriteBackgroundPoses;
  if (registry?.[characterId]?.[backgroundUrl]) {
    const charMap = { ...registry[characterId] };
    delete charMap[backgroundUrl];
    const next: SpriteBackgroundPoseMap = { ...registry };
    if (Object.keys(charMap).length > 0) {
      next[characterId] = charMap;
    } else {
      delete next[characterId];
    }
    store.updateSettings?.({ spriteBackgroundPoses: next });
    removed = true;
  }
  return removed;
}

/**
 * Remove a fondo's pose for EVERY character (App library panel button).
 * Clears the collection entry's spritePoses (collection.json) and the
 * settings fallback. Returns how many characters had a pose.
 */
export async function clearSpritePoseForAllCharacters(backgroundUrl: string): Promise<number> {
  const state = useTavernStore.getState();
  const collectionCount =
    state.backgroundCollections
      ?.find((col) => col.entries?.some((e) => e.url === backgroundUrl))
      ?.entries?.find((e) => e.url === backgroundUrl)?.spritePoses
    ? Object.keys(
        state.backgroundCollections!
          .find((col) => col.entries?.some((e) => e.url === backgroundUrl))!
          .entries!.find((e) => e.url === backgroundUrl)!.spritePoses!
      ).length
    : 0;
  const settingsCount = Object.values(state.settings.spriteBackgroundPoses ?? {}).filter(
    (charMap) => !!charMap?.[backgroundUrl]
  ).length;

  // collection JSON: one clear-all server call + per-key store clears
  const target = findCollectionEntryForBackground(backgroundUrl);
  if (target) {
    const entry = state.backgroundCollections
      ?.find((col) => col.entries?.some((e) => e.url === backgroundUrl))
      ?.entries?.find((e) => e.url === backgroundUrl);
    for (const charId of Object.keys(entry?.spritePoses ?? {})) {
      useTavernStore.getState().setEntrySpritePose?.(backgroundUrl, charId, null);
    }
    try {
      await fetch('/api/backgrounds/collections', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderName: target.folderName,
          entryUrl: backgroundUrl,
          poseAction: 'clear-all',
        }),
      });
    } catch (err) {
      console.error('[save-pose] Failed to clear all poses in collection.json:', err);
    }
  }

  // settings fallback cleanup
  const registry = state.settings.spriteBackgroundPoses;
  if (registry && settingsCount > 0) {
    const next: SpriteBackgroundPoseMap = {};
    for (const [charId, charMap] of Object.entries(registry)) {
      if (charMap[backgroundUrl]) {
        const copy = { ...charMap };
        delete copy[backgroundUrl];
        if (Object.keys(copy).length > 0) next[charId] = copy;
      } else {
        next[charId] = charMap;
      }
    }
    state.updateSettings?.({ spriteBackgroundPoses: next });
  }

  return collectionCount + settingsCount;
}

/** How many characters have a pose saved for a fondo (library panel badge). */
export function countCharactersWithPoseForBackground(backgroundUrl: string): number {
  const state = useTavernStore.getState();
  const entry = state.backgroundCollections
    ?.find((col) => col.entries?.some((e) => e.url === backgroundUrl))
    ?.entries?.find((e) => e.url === backgroundUrl);
  const collectionCount = entry?.spritePoses ? Object.keys(entry.spritePoses).length : 0;
  const settingsCount = Object.values(state.settings.spriteBackgroundPoses ?? {}).filter(
    (charMap) => !!charMap?.[backgroundUrl]
  ).length;
  return collectionCount + settingsCount;
}

/**
 * LEGACY COMPAT (Task 17 node-based poses): resolve the ACTIVE location of the
 * chat and return its node pose ONLY if that node's effective background
 * matches `backgroundUrl`. Lets poses saved before the fondo-bound system keep
 * working without any migration.
 */
export function resolveLegacyLocationPoseForBackground(
  characterId: string,
  backgroundUrl: string
): SpritePose | null {
  try {
    const store = useTavernStore.getState();
    const session = store.sessions.find((s) => s.id === store.activeSessionId);
    const character = store.characters.find((c) => c.id === characterId);
    const groupId = session?.groupId || store.activeGroupId;
    const group = groupId ? store.groups.find((g) => g.id === groupId) : undefined;

    const definitions = getEffectiveScenarioDefinitions(character, store.scenarios, group);
    const active = resolveActiveScenarioLocation(definitions, session?.sessionStats ?? null);
    if (!active) return null;

    const locationBg = resolveLocationBackground(active);
    if (!locationBg || locationBg !== backgroundUrl) return null;

    return active.spot?.spritePose || active.place.spritePose || null;
  } catch {
    return null;
  }
}

export type { SpritePose };
