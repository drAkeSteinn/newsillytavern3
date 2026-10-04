// ============================================
// Character Slice - Character management state
// ============================================

import type { CharacterCard } from '@/types';
import { uuidv4 } from '@/lib/uuid';
import { needsMigration, migrateCharacterSprites, applyMigrationResult } from '@/lib/migration/sprite-migration';

/**
 * Auto-migrate legacy sprite data to V2 for a character.
 * Only runs if legacy data exists and V2 data is missing.
 * Returns the character with migrated data, or the original if no migration needed.
 * 
 * @deprecated Auto-migration is temporary during the deprecation period.
 */
function autoMigrateCharacter(character: Partial<CharacterCard> & { name: string }): Partial<CharacterCard> {
  const fullChar = character as CharacterCard;
  
  if (!needsMigration(fullChar)) {
    return character;
  }

  try {
    const result = migrateCharacterSprites(fullChar, {
      defaultPackName: `${character.name || 'Character'} - Migrated`,
      createDefaultStateCollections: true,
      skipIfV2Exists: true,
    });

    if (result.success && (result.report.packsCreated > 0 || result.report.triggerCollectionsCreated > 0 || result.report.stateCollectionsCreated > 0)) {
      const migrationUpdates = applyMigrationResult(fullChar, result);
      return {
        ...character,
        ...migrationUpdates,
      };
    }
  } catch {
    // Silently fail - auto-migration is best-effort
  }

  return character;
}

export interface CharacterSlice {
  // State
  characters: CharacterCard[];
  activeCharacterId: string | null;

  // Actions
  addCharacter: (character: Partial<CharacterCard> & { name: string }, preserveId?: boolean) => void;
  updateCharacter: (id: string, updates: Partial<CharacterCard>) => void;
  deleteCharacter: (id: string) => void;
  setActiveCharacter: (id: string | null) => void;

  // Utilities
  getActiveCharacter: () => CharacterCard | undefined;
  getCharacterById: (id: string) => CharacterCard | undefined;
}

export const createCharacterSlice = (set: any, get: any): CharacterSlice => ({
  // Initial State
  characters: [],
  activeCharacterId: null,

  // Actions
  addCharacter: (character, preserveId = false) => set((state: any) => {
    // Auto-migrate legacy sprite data on character add
    const migrated = autoMigrateCharacter(character);
    
    return {
      characters: [...state.characters, {
        ...migrated,
        id: (preserveId && character.id) ? character.id : uuidv4(),
        createdAt: character.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }]
    };
  }),

  updateCharacter: (id, updates) => set((state: any) => {
    const prev = state.characters.find((c: CharacterCard) => c.id === id);

    // Attribute key migration: renaming an attribute key (same attribute id)
    // used to leave session attributeValues under the OLD key, so the new
    // {{newKey}} template resolved to defaultValue and the stat silently
    // reset mid-story. Remap old→new keys across every session's stats.
    const renamedKeys: Array<[string, string]> = [];
    if (prev && updates.statsConfig && prev.statsConfig) {
      const oldById = new Map<string, any>(
        (prev.statsConfig.attributes || []).map((a: any) => [a.id, a])
      );
      for (const attr of updates.statsConfig.attributes || []) {
        const old = oldById.get(attr.id);
        if (old && old.key && attr.key && old.key !== attr.key) {
          renamedKeys.push([old.key, attr.key]);
        }
      }
    }

    return {
      characters: state.characters.map((c: CharacterCard) =>
        c.id === id ? { ...c, ...updates, updatedAt: new Date().toISOString() } : c
      ),
      sessions: renamedKeys.length === 0 ? state.sessions : (state.sessions || []).map((s: any) => {
        const charStats = s.sessionStats?.characterStats?.[id];
        if (!charStats?.attributeValues) return s;
        const values = { ...charStats.attributeValues };
        const lastUpdated = { ...(charStats.lastUpdated || {}) };
        let touched = false;
        for (const [oldKey, newKey] of renamedKeys) {
          if (oldKey in values) {
            values[newKey] = values[oldKey];
            delete values[oldKey];
            touched = true;
          }
          if (oldKey in lastUpdated) {
            lastUpdated[newKey] = lastUpdated[oldKey];
            delete lastUpdated[oldKey];
            touched = true;
          }
        }
        if (!touched) return s;
        return {
          ...s,
          sessionStats: {
            ...s.sessionStats,
            characterStats: {
              ...s.sessionStats.characterStats,
              [id]: { ...charStats, attributeValues: values, lastUpdated },
            },
            lastModified: Date.now(),
          },
        };
      }),
    };
  }),

  deleteCharacter: (id) => set((state: any) => {
    const deletedSessionIds = new Set(
      state.sessions.filter((s: any) => s.characterId === id).map((s: any) => s.id)
    );

    return {
      characters: state.characters.filter((c: CharacterCard) => c.id !== id),
      sessions: state.sessions.filter((s: any) => s.characterId !== id),
      activeCharacterId: state.activeCharacterId === id ? null : state.activeCharacterId,
      // Deleting the active session left the UI on an empty chat panel —
      // clear it the same way deleteSession does.
      activeSessionId: deletedSessionIds.has(state.activeSessionId) ? null : state.activeSessionId,
      // Strip the deleted character from every group. Otherwise round_robin
      // rotation could land on the deleted id → "No active characters to
      // respond" (HTTP 400) every time its turn came up, and
      // group.members[0] could start a session bound to a missing character.
      groups: (state.groups || []).map((g: any) => {
        if (!g.members?.some((m: any) => m.characterId === id) && !g.characterIds?.includes(id)) {
          return g;
        }
        const members = (g.members || []).filter((m: any) => m.characterId !== id);
        return {
          ...g,
          members,
          characterIds: (g.characterIds || []).filter((cid: string) => cid !== id),
          updatedAt: new Date().toISOString(),
        };
      }),
    };
  }),

  setActiveCharacter: (id) => set({ activeCharacterId: id }),

  // Utilities
  getActiveCharacter: () => {
    const state = get();
    return state.characters.find((c: CharacterCard) => c.id === state.activeCharacterId);
  },

  getCharacterById: (id) => get().characters.find((c: CharacterCard) => c.id === id),
});
