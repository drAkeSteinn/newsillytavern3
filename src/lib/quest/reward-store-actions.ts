// ============================================
// Reward Store Actions Builder
// ============================================
//
// Builds a RewardStoreActions object from the Zustand store state so that
// reward execution (executeReward / executeAllRewards) can be invoked from
// anywhere that has access to the store (e.g. statsSlice threshold effects),
// not only from the trigger system hook.
//
// This centralizes the store wiring used to execute rewards:
// - attribute updates
// - trigger execution (sprites / sounds / backgrounds)
// - quest objective completion (by key search)
// - solicitud completion
// - currency sync

import type {
  QuestTemplate,
  SessionQuestInstance,
} from '@/types';
import type { RewardStoreActions } from './quest-reward-executor';

/**
 * Minimal shape of the Zustand store needed to build the actions.
 * (Partial/loose typing on purpose — the app store is a composition of slices.)
 */
type AnyStore = Record<string, any>;

/**
 * Search and complete a quest objective by its completion/detection key.
 * Mirrors the logic from use-trigger-system's completeQuestObjectiveByKey so
 * reward execution works identically outside the hook.
 */
export function completeQuestObjectiveByKey(
  store: AnyStore,
  sessionId: string,
  questTemplateId: string, // Can be empty to search all active quests
  objectiveDetectionKey: string,
  characterId?: string
): boolean {
  try {
    // Read from session.sessionQuests directly (most reliable source)
    const targetSession = store.sessions?.find((s: any) => s.id === sessionId);
    const sessionQuests: SessionQuestInstance[] = targetSession?.sessionQuests || [];

    const activeQuests = sessionQuests.filter((q: any) => q.status === 'active' || q.status === 'available');
    const templates: QuestTemplate[] = store.questTemplates || [];

    if (templates.length === 0) {
      console.warn('[completeQuestObjectiveByKey] No quest templates loaded in store');
      return false;
    }

    // Search for matching objective (exact match first)
    let matchedObjective: any = null;
    let matchedQuest: any = null;
    let matchedTemplate: any = null;

    for (const quest of activeQuests) {
      if (questTemplateId && quest.templateId !== questTemplateId) continue;

      const template = templates.find((t: any) => t.id === quest.templateId);
      if (!template) continue;

      for (const objective of template.objectives || []) {
        const completionKeys = [objective.completion?.key, ...(objective.completion?.keys || [])].filter(Boolean);

        for (const completionKey of completionKeys) {
          if (completionKey === objectiveDetectionKey ||
              completionKey?.toLowerCase() === objectiveDetectionKey.toLowerCase() ||
              completionKey === `obj-${objectiveDetectionKey}`) {
            matchedObjective = objective;
            matchedQuest = quest;
            matchedTemplate = template;
            break;
          }
        }
        if (matchedObjective) break;
      }
      if (matchedObjective) break;
    }

    // Try case-insensitive partial match if no exact match
    if (!matchedObjective) {
      const lowerKey = objectiveDetectionKey.toLowerCase();
      for (const quest of activeQuests) {
        if (questTemplateId && quest.templateId !== questTemplateId) continue;

        const template = templates.find((t: any) => t.id === quest.templateId);
        if (!template) continue;

        for (const objective of template.objectives || []) {
          const completionKeys = [objective.completion?.key, ...(objective.completion?.keys || [])].filter(Boolean);

          for (const completionKey of completionKeys) {
            if (completionKey?.toLowerCase().includes(lowerKey) || lowerKey.includes(completionKey?.toLowerCase())) {
              matchedObjective = objective;
              matchedQuest = quest;
              matchedTemplate = template;
              break;
            }
          }
          if (matchedObjective) break;
        }
        if (matchedObjective) break;
      }
    }

    if (!matchedObjective || !matchedTemplate || !matchedQuest) {
      console.warn(`[completeQuestObjectiveByKey] Objective not found: ${objectiveDetectionKey}`);
      return false;
    }

    // Check if objective is already completed in the session (prevent duplicate rewards)
    const sessionObjective = matchedQuest.objectives?.find((o: any) => o.templateId === matchedObjective.id);
    if (sessionObjective?.isCompleted) {
      return true; // Objective WAS found (just already done)
    }

    // Complete the objective using progressQuestObjective (rewards are executed internally)
    store.progressQuestObjective?.(sessionId, matchedQuest.templateId, matchedObjective.id, 999, characterId);
    return true;
  } catch (err) {
    console.error('[completeQuestObjectiveByKey] Error completing objective:', err);
    return false;
  }
}

/**
 * Build the RewardStoreActions from a store snapshot (e.g. useTavernStore.getState()).
 * All actions are bound to the snapshot's functions; optional ones are wired only
 * if present in the store.
 */
export function buildRewardStoreActions(store: AnyStore): RewardStoreActions {
  return {
    updateCharacterStat: (sessionId, characterId, attributeKey, value, reason) => {
      store.updateCharacterStat?.(sessionId, characterId, attributeKey, value, reason);
    },

    progressQuestObjective: store.progressQuestObjective?.bind(store),

    getSessionQuests: store.getSessionQuests?.bind(store) ?? ((sid: string) => {
      const s = store.sessions?.find((session: any) => session.id === sid);
      return s?.sessionQuests || [];
    }),

    completeQuestObjective: (sessionId, questId, objectiveKey, characterId) =>
      completeQuestObjectiveByKey(store, sessionId, questId, objectiveKey, characterId),

    completeSolicitud: store.completeSolicitud?.bind(store),

    applyTriggerForCharacter: (characterId, hit) => {
      store.applyTriggerForCharacter?.(characterId, hit);
    },

    scheduleReturnToIdleForCharacter: (characterId, triggerSpriteUrl, returnToMode, returnSpriteUrl, returnSpriteLabel, returnToIdleMs) => {
      store.scheduleReturnToIdleForCharacter?.(
        characterId,
        triggerSpriteUrl,
        returnToMode,
        returnSpriteUrl,
        returnSpriteLabel,
        returnToIdleMs,
      );
    },

    isSpriteLocked: () => {
      try { return store.isSpriteLocked?.() ?? false; } catch { return false; }
    },

    playSound: store.playSound?.bind(store),

    setBackground: store.setBackground?.bind(store),

    setActiveOverlays: store.setActiveOverlays?.bind(store),
  };
}
