// ============================================
// TavernFlow Store - Combined store with persistence
// ============================================

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CharacterCard, Persona } from '@/types';

// Import all slices
import {
  createCharacterSlice,
  createSessionSlice,
  createGroupSlice,
  createLLMSlice,
  createSettingsSlice,
  createLorebookSlice,
  createPersonaSlice,
  createBackgroundSlice,
  createSoundSlice,
  createUISlice,
  createSpriteSlice,
  createHUDSlice,
  createAtmosphereSlice,
  createMemorySlice,
  createQuestSlice,
  createDialogueSlice,
  createInventorySlice,
  createStatsSlice,
  createQuestTemplateSlice,
  createTimelineEditorSlice,
} from './slices';

// Import slice types
import type {
  CharacterSlice,
  SessionSlice,
  GroupSlice,
  LLMSlice,
  SettingsSlice,
  LorebookSlice,
  PersonaSlice,
  BackgroundSlice,
  SoundSlice,
  UISlice,
  SpriteSlice,
  HUDSlice,
  AtmosphereSlice,
  MemorySlice,
  QuestSlice,
  DialogueSlice,
  InventorySlice,
  StatsSlice,
  QuestTemplateSlice,
  TimelineEditorSlice,
} from './slices';

// Import defaults for merge function
import { defaultSettings, defaultPersona } from './defaults';
import { DEFAULT_DIALOGUE_SETTINGS, DEFAULT_SUMMARY_SETTINGS, DEFAULT_QUEST_SETTINGS, DEFAULT_CHATBOX_APPEARANCE, DEFAULT_TOOLS_SETTINGS, DEFAULT_HANDY_SETTINGS } from '@/types';
import { DEFAULT_ATMOSPHERE_PRESETS, DEFAULT_ATMOSPHERE_SETTINGS } from './slices/atmosphereSlice';

// Combined store type
export type TavernState = CharacterSlice &
  SessionSlice &
  GroupSlice &
  LLMSlice &
  SettingsSlice &
  LorebookSlice &
  PersonaSlice &
  BackgroundSlice &
  SoundSlice &
  UISlice &
  SpriteSlice &
  HUDSlice &
  AtmosphereSlice &
  MemorySlice &
  QuestSlice &
  DialogueSlice &
  InventorySlice &
  StatsSlice &
  QuestTemplateSlice &
  TimelineEditorSlice;

// Create the combined store
export const useTavernStore = create<TavernState>()(
  persist(
    (set, get) => ({
      // Combine all slices
      ...createCharacterSlice(set, get),
      ...createSessionSlice(set, get),
      ...createGroupSlice(set, get),
      ...createLLMSlice(set, get),
      ...createSettingsSlice(set, get),
      ...createLorebookSlice(set, get),
      ...createPersonaSlice(set, get),
      ...createBackgroundSlice(set, get),
      ...createSoundSlice(set, get),
      ...createUISlice(set, get),
      ...createSpriteSlice(set, get),
      ...createHUDSlice(set, get),
      ...createAtmosphereSlice(set, get),
      ...createMemorySlice(set, get),
      ...createQuestSlice(set, get),
      ...createDialogueSlice(set, get),
      ...createInventorySlice(set, get),
      ...createStatsSlice(set, get),
      ...createQuestTemplateSlice(set, get),
      ...createTimelineEditorSlice(set, get),
    }),
    {
      name: 'tavernflow-storage', // Same name for backward compatibility
      partialize: (state) => ({
        // Data to persist
        characters: state.characters,
        sessions: state.sessions,  // sessionStats is stored within sessions
        groups: state.groups,
        backgrounds: state.backgrounds,
        llmConfigs: state.llmConfigs,
        ttsConfigs: state.ttsConfigs,
        promptTemplates: state.promptTemplates,
        settings: state.settings,
        soundTriggers: state.soundTriggers,
        soundCollections: state.soundCollections,
        soundSequenceTriggers: state.soundSequenceTriggers,
        // Background triggers (unified system)
        backgroundTriggerPacks: state.backgroundTriggerPacks,
        backgroundCollections: state.backgroundCollections,
        personas: state.personas,
        backgroundPacks: state.backgroundPacks,
        backgroundIndex: state.backgroundIndex,
        lorebooks: state.lorebooks,
        activeLorebookIds: state.activeLorebookIds,
        // Sprite data (V2 system)
        spritePacksV2: state.spritePacksV2,
        // HUD data (templates only, not session state)
        hudTemplates: state.hudTemplates,
        // Active states
        activeSessionId: state.activeSessionId,
        activeCharacterId: state.activeCharacterId,
        activeGroupId: state.activeGroupId,
        activeBackground: state.activeBackground,
        activeOverlayBack: state.activeOverlayBack,
        activeOverlayFront: state.activeOverlayFront,
        activePersonaId: state.activePersonaId,
        // Atmosphere state
        activeAtmospherePresetId: state.activeAtmospherePresetId,
        atmosphereSettings: state.atmosphereSettings,
        // Memory state
        summaries: state.summaries,
        summarySettings: state.summarySettings,
        characterMemories: state.characterMemories,
        sessionTracking: state.sessionTracking,
        // Quest state
        quests: state.quests,
        questSettings: state.questSettings,
        questNotifications: state.questNotifications,
        // Dialogue state
        dialogueSettings: state.dialogueSettings,
        // Inventory state (V2)
        items: state.items,
        activeConsumableEffects: state.activeConsumableEffects,
        dynamicEquipmentState: state.dynamicEquipmentState,
        inventorySettings: state.inventorySettings,
        inventoryNotifications: state.inventoryNotifications,
        // Legacy inventory state (kept for migration)
        containers: state.containers,
        currencies: state.currencies,
        // Stats state is stored within sessions.sessionStats
        // Timeline Editor state
        collections: state.collections,
        // Handy / Haptic settings are stored within settings.handy
      }),
      merge: (persistedState: unknown, currentState) => {
        const persisted = persistedState as Record<string, unknown> | undefined;
        if (!persisted) return currentState;

        // Merge settings with defaults to ensure new fields exist
        const persistedSettings = persisted.settings as Record<string, unknown> | undefined;
        const persistedChatboxAppearance = persistedSettings?.chatboxAppearance as Record<string, unknown> | undefined;
        const mergedSettings = {
          ...currentState.settings,
          ...(persistedSettings || {}),
          // Ensure sound settings exist with defaults
          sound: {
            ...currentState.settings.sound,
            ...((persistedSettings?.sound as Record<string, unknown>) || {})
          },
          // Ensure backgroundTriggers settings exist with defaults
          backgroundTriggers: {
            ...currentState.settings.backgroundTriggers,
            ...((persistedSettings?.backgroundTriggers as Record<string, unknown>) || {})
          },
          // Ensure chatLayout settings exist with defaults
          chatLayout: {
            ...currentState.settings.chatLayout,
            ...((persistedSettings?.chatLayout as Record<string, unknown>) || {})
          },
          // Ensure context settings exist with defaults
          context: {
            ...currentState.settings.context,
            ...((persistedSettings?.context as Record<string, unknown>) || {})
          },
          // Ensure embeddingsChat settings exist with defaults
          embeddingsChat: {
            ...currentState.settings.embeddingsChat,
            ...((persistedSettings?.embeddingsChat as Record<string, unknown>) || {})
          },
          // Ensure chatboxAppearance settings exist with defaults
          chatboxAppearance: {
            ...DEFAULT_CHATBOX_APPEARANCE,
            ...(persistedChatboxAppearance || {}),
            // Deep merge nested objects
            background: {
              ...DEFAULT_CHATBOX_APPEARANCE.background,
              ...((persistedChatboxAppearance?.background as Record<string, unknown>) || {})
            },
            font: {
              ...DEFAULT_CHATBOX_APPEARANCE.font,
              ...((persistedChatboxAppearance?.font as Record<string, unknown>) || {})
            },
            textFormatting: {
              ...DEFAULT_CHATBOX_APPEARANCE.textFormatting,
              ...((persistedChatboxAppearance?.textFormatting as Record<string, unknown>) || {})
            },
            textColors: {
              ...DEFAULT_CHATBOX_APPEARANCE.textColors,
              ...((persistedChatboxAppearance?.textColors as Record<string, unknown>) || {})
            },
            bubbles: {
              ...DEFAULT_CHATBOX_APPEARANCE.bubbles,
              ...((persistedChatboxAppearance?.bubbles as Record<string, unknown>) || {})
            },
            avatars: {
              ...DEFAULT_CHATBOX_APPEARANCE.avatars,
              ...((persistedChatboxAppearance?.avatars as Record<string, unknown>) || {})
            },
            streaming: {
              ...DEFAULT_CHATBOX_APPEARANCE.streaming,
              ...((persistedChatboxAppearance?.streaming as Record<string, unknown>) || {})
            },
            input: {
              ...DEFAULT_CHATBOX_APPEARANCE.input,
              ...((persistedChatboxAppearance?.input as Record<string, unknown>) || {})
            }
          },
          // Ensure tools settings exist with defaults (for backward compatibility)
          tools: {
            ...DEFAULT_TOOLS_SETTINGS,
            ...((persistedSettings?.tools as Record<string, unknown>) || {})
          },
          // Ensure handy settings exist with defaults (for backward compatibility)
          handy: {
            ...DEFAULT_HANDY_SETTINGS,
            ...((persistedSettings?.handy as Record<string, unknown>) || {})
          }
        };

        // Ensure characters have the characterNote field
        const persistedCharacters = persisted.characters as CharacterCard[] | undefined;
        const mergedCharacters = (persistedCharacters || currentState.characters).map(char => ({
          ...char,
          characterNote: char.characterNote ?? '' // Add characterNote if missing
        }));

        // Ensure personas exist with default if not present
        const persistedPersonas = persisted.personas as Persona[] | undefined;
        const mergedPersonas = (persistedPersonas && persistedPersonas.length > 0
          ? persistedPersonas
          : currentState.personas).map(p => ({
            ...p,
            currency: p.currency ?? 0,
            currencyName: p.currencyName ?? 'Divisa',
            currencyIcon: p.currencyIcon ?? '💰',
            inventoryItems: p.inventoryItems ?? [],
          }));

        // Migrate groups to new format with members array
        const persistedGroups = persisted.groups as Array<Record<string, unknown>> | undefined;
        const mergedGroups = (persistedGroups || currentState.groups).map(g => {
          const group = g as any;
          if (!group.members && group.characterIds) {
            return {
              ...group,
              members: group.characterIds.map((id: string, index: number) => ({
                characterId: id,
                role: 'member' as const,
                isActive: true,
                isPresent: true,
                joinOrder: index
              }))
            };
          }
          return group;
        });

        // Migrate messages to have swipes array
        const persistedSessions = persisted.sessions as Array<Record<string, unknown>> | undefined;
        const mergedSessions = (persistedSessions || currentState.sessions).map(session => {
          const s = session as any;
          if (s.messages) {
            return {
              ...s,
              messages: s.messages.map((m: any) => ({
                ...m,
                // Add swipes array if missing (use current content as first swipe)
                swipes: m.swipes?.length ? m.swipes : [m.content || ''],
                // Ensure swipeIndex exists
                swipeIndex: m.swipeIndex ?? 0
              }))
            };
          }
          return s;
        });

        // Ensure dialogueSettings has complete structure
        const persistedDialogue = persisted.dialogueSettings as Record<string, unknown> | undefined;
        const mergedDialogue = {
          ...DEFAULT_DIALOGUE_SETTINGS,
          ...(persistedDialogue || {}),
          // Ensure nested objects exist
          typewriter: {
            ...DEFAULT_DIALOGUE_SETTINGS.typewriter,
            ...((persistedDialogue?.typewriter as Record<string, unknown>) || {})
          },
          formatting: {
            ...DEFAULT_DIALOGUE_SETTINGS.formatting,
            ...((persistedDialogue?.formatting as Record<string, unknown>) || {})
          }
        };

        // Ensure summarySettings has complete structure
        const persistedSummary = persisted.summarySettings as Record<string, unknown> | undefined;
        const mergedSummary = {
          ...DEFAULT_SUMMARY_SETTINGS,
          ...(persistedSummary || {})
        };

        // Ensure questSettings has complete structure
        const persistedQuest = persisted.questSettings as Record<string, unknown> | undefined;
        const mergedQuest = {
          ...DEFAULT_QUEST_SETTINGS,
          ...(persistedQuest || {})
        };

        // Fix lorebooks with missing/undefined active property
        const persistedLorebooks = persisted.lorebooks as Array<Record<string, unknown>> | undefined;
        const mergedLorebooks = persistedLorebooks
          ? persistedLorebooks.map(lb => ({
              ...lb,
              active: lb.active ?? (persisted.activeLorebookIds as string[] || []).includes(lb.id),
            }))
          : currentState.lorebooks;

        // Sync activeLorebookIds with lorebook active states
        const finalActiveLorebookIds = persisted.activeLorebookIds as string[] | undefined
          ?? mergedLorebooks.filter(lb => lb.active).map(lb => lb.id as string);

        // Ensure inventorySettings has all fields with proper defaults (migration)
        const persistedInventorySettings = persisted.inventorySettings as Record<string, unknown> | undefined;
        let mergedInventorySettings: Record<string, unknown> = {
          ...currentState.inventorySettings,
          ...(persistedInventorySettings || {}),
          // Deep-merge equipmentSlots: always ensure it exists and is an array
          equipmentSlots: Array.isArray(persistedInventorySettings?.equipmentSlots)
            ? persistedInventorySettings!.equipmentSlots
            : currentState.inventorySettings.equipmentSlots || [],
        };

        // MIGRATION (global slots → persona slots): global equipment slots were
        // removed from the Inventory UI; slots are managed in Persona/Character
        // config. Migrate any persisted legacy global slots to the active persona
        // so this survives regardless of the order in which localStorage
        // rehydration and loadFromServer() resolve (prevents a race that lost
        // the slots). Mirrors the migration in use-persistence-sync.ts.
        const legacyGlobalSlots = mergedInventorySettings.equipmentSlots as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(legacyGlobalSlots) && legacyGlobalSlots.length > 0) {
          const activePid = (persisted.activePersonaId as string | undefined)
            ?? (currentState as { activePersonaId?: string }).activePersonaId;
          const targetIdx = mergedPersonas.findIndex(p => p.id === activePid);
          if (targetIdx !== -1) {
            const target = mergedPersonas[targetIdx] as unknown as { equipmentSlots?: unknown[] };
            if (!target.equipmentSlots || target.equipmentSlots.length === 0) {
              (mergedPersonas as unknown as Array<Record<string, unknown>>)[targetIdx] = {
                ...mergedPersonas[targetIdx],
                equipmentSlots: legacyGlobalSlots,
              };
            }
            mergedInventorySettings = { ...mergedInventorySettings, equipmentSlots: [] };
          }
        }

        // Re-derive activeAtmosphereLayers from the persisted preset ID.
        // The layers themselves are not persisted (only the preset ID is), so on reload
        // the live store starts with an empty array while the preset ID still says e.g. 'rainy-day'.
        // This caused the AtmosphereRenderer to silently return null (no effects reproduced).
        const persistedAtmospherePresetId = persisted.activeAtmospherePresetId as string | undefined;
        let rederivedAtmosphereLayers: unknown[] | undefined;
        if (
          persistedAtmospherePresetId &&
          persistedAtmospherePresetId !== 'clear'
        ) {
          const preset = DEFAULT_ATMOSPHERE_PRESETS.find(p => p.id === persistedAtmospherePresetId);
          if (preset && preset.layers && preset.layers.length > 0) {
            rederivedAtmosphereLayers = preset.layers
              .map(layer => ({ ...layer, active: true }))
              .sort((a, b) => a.priority - b.priority);
          }
        }

        // Deep-merge atmosphereSettings: persisted state may have an old schema
        // (e.g. only { intensity, weatherEffects, autoDetect, enabled }) missing newer
        // fields like globalVolume / globalIntensity / performanceMode. Without this
        // deep merge, those fields are undefined and downstream math (audio volume,
        // particle target count) produces NaN — causing "Failed to set volume:
        // non-finite" errors and invisible particle layers.
        const persistedAtmosphereSettings = persisted.atmosphereSettings as Record<string, unknown> | undefined;
        const mergedAtmosphereSettings = {
          ...DEFAULT_ATMOSPHERE_SETTINGS,
          ...(persistedAtmosphereSettings || {}),
        };

        // Return merged state
        return {
          ...currentState,
          ...persisted,
          settings: mergedSettings,
          characters: mergedCharacters,
          personas: mergedPersonas,
          groups: mergedGroups,
          sessions: mergedSessions,
          dialogueSettings: mergedDialogue,
          summarySettings: mergedSummary,
          questSettings: mergedQuest,
          lorebooks: mergedLorebooks,
          activeLorebookIds: finalActiveLorebookIds,
          inventorySettings: mergedInventorySettings,
          atmosphereSettings: mergedAtmosphereSettings,
          // Only override if we re-derived; otherwise let the live store keep its initial []
          ...(rederivedAtmosphereLayers ? { activeAtmosphereLayers: rederivedAtmosphereLayers } : {}),
        };
      },
    }
  )
);

// Export types
export type { CharacterSlice, SessionSlice, GroupSlice, LLMSlice, SettingsSlice, LorebookSlice, PersonaSlice, BackgroundSlice, SoundSlice, UISlice, SpriteSlice, HUDSlice, AtmosphereSlice, MemorySlice, QuestSlice, DialogueSlice, InventorySlice, StatsSlice, QuestTemplateSlice, TimelineEditorSlice };
