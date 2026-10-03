// ============================================
// Threshold Message Effects
// ============================================
//
// Implements the "message" reward type for ThresholdEffects (attribute
// threshold effects in the character stats editor).
//
// Behavior: at the END OF A TURN, every participant's threshold effects are
// re-evaluated. When an effect that carries a `message` reward is met, its
// message is sent to the chat as if it were a quick reply (a user message),
// which naturally triggers the next generation.
//
// Anti-loop protection (edge-triggering): each effect's "condition met" state
// is persisted in sessionStats.thresholdMessageStates (keyed by
// `${characterId}:${attributeKey}:${effectId}`). The message only fires on the
// false → true edge, i.e. when the attribute CROSSES the threshold. While the
// condition stays true no new messages are sent; when it stops being met the
// state resets so a future crossing fires again.
//
// Tag support: the message text is resolved with the same key resolver used
// across the app — {{char}}, {{user}}, {{time}}, {{eventos}}, {{relacion}},
// {{escenario}}, attribute keys ({{fuerza}}, {{vida}}, ...), etc.

import type {
  CharacterCard,
  QuestReward,
  ResolvedStats,
  SessionStats,
} from '@/types';
import { evaluateThresholdEffects } from '@/lib/sprites/condition-evaluator';
import { resolveAllKeys, type KeyResolutionContext } from '@/lib/key-resolver';

export interface ThresholdMessageTarget {
  characterId: string;
  characterName: string;
  statsConfig?: import('@/types').CharacterStatsConfig;
}

export interface ThresholdMessageItem {
  characterId: string;
  characterName: string;
  effectName: string;
  text: string;
}

export interface CollectThresholdMessagesResult {
  /** Messages to send to the chat (already tag-resolved), in firing order. */
  messages: ThresholdMessageItem[];
  /** New edge states to persist into sessionStats.thresholdMessageStates. */
  newStates: Record<string, boolean>;
}

/**
 * Check whether a threshold effect has at least one active, non-empty message reward.
 */
function getMessageRewards(rewards: QuestReward[] | undefined): QuestReward[] {
  if (!rewards || rewards.length === 0) return [];
  return rewards.filter(r => r.type === 'message' && r.message?.text && r.message.text.trim());
}

/**
 * Build a minimal ResolvedStats from sessionStats so attribute keys
 * ({{fuerza}}, {{vida}}, ...) resolve inside threshold message templates.
 * Character attributes take precedence; persona attributes are the fallback.
 */
function buildResolvedStatsForMessage(
  sessionStats: SessionStats | null | undefined,
  characterId: string
): ResolvedStats {
  const attributes: Record<string, string> = {};

  const pushAttrs = (id: string) => {
    const attrs = sessionStats?.characterStats?.[id]?.attributeValues || {};
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null) continue;
      if (key in attributes) continue;
      attributes[key] = String(value);
    }
  };

  // Owner attributes first, then persona attributes as fallback
  pushAttrs(characterId);
  if (characterId !== '__user__') pushAttrs('__user__');

  return {
    attributes,
    availableSkills: [],
    availableIntentions: [],
    availableInvitations: [],
    availableSolicitudes: [],
    skillsBlock: '',
    intentionsBlock: '',
    invitationsBlock: '',
    solicitudesBlock: '',
  };
}

/**
 * Resolve the tags of a threshold message template.
 */
export function resolveThresholdMessageText(
  template: string,
  target: ThresholdMessageTarget,
  sessionStats: SessionStats | null | undefined,
  userName: string,
  characterCard?: CharacterCard,
): string {
  const resolvedStats = buildResolvedStatsForMessage(sessionStats, target.characterId);

  const context: KeyResolutionContext = {
    user: userName,
    char: target.characterName,
    character: characterCard,
    sessionStats,
    characterId: target.characterId,
    resolvedStats,
  };

  return resolveAllKeys(template, context);
}

/**
 * Collect threshold "message" rewards at end of turn.
 *
 * Scans every target's threshold effects against the CURRENT session stats,
 * fires messages for new condition crossings and (re)computes the edge states
 * that must be persisted (true while the condition holds, false otherwise).
 */
export function collectThresholdMessages(params: {
  sessionStats: SessionStats | null | undefined;
  targets: ThresholdMessageTarget[];
  userName: string;
  /** Optional character cards for richer tag resolution ({{description}}, ...). */
  characterCards?: Record<string, CharacterCard>;
}): CollectThresholdMessagesResult {
  const { sessionStats, targets, userName, characterCards } = params;

  const messages: ThresholdMessageItem[] = [];
  const newStates: Record<string, boolean> = {};

  if (!sessionStats || !targets || targets.length === 0) {
    return { messages, newStates };
  }

  for (const target of targets) {
    const statsConfig = target.statsConfig;
    if (!statsConfig?.enabled || !statsConfig.attributes) continue;

    for (const attr of statsConfig.attributes) {
      const effects = attr.thresholdEffects;
      if (!effects || effects.length === 0) continue;

      // Only effects that actually carry message rewards are relevant here.
      const messageEffects = effects.filter(e => {
        if (!e.enabled) return false;
        return getMessageRewards(e.rewards).length > 0;
      });
      if (messageEffects.length === 0) continue;

      // Evaluate which effects match with the CURRENT stats
      const matching = evaluateThresholdEffects(effects, sessionStats, target.characterId);

      for (const effect of messageEffects) {
        const edgeKey = `${target.characterId}:${attr.key}:${effect.id}`;
        const prevState = sessionStats.thresholdMessageStates?.[edgeKey] ?? false;
        const isMatched = matching.some(m => m.id === effect.id);

        // Always refresh the persisted edge state (true while condition holds)
        newStates[edgeKey] = isMatched;

        // Fire ONLY on the false → true edge (threshold crossed this turn)
        if (!isMatched || prevState) continue;

        for (const reward of getMessageRewards(effect.rewards)) {
          const rawText = reward.message!.text.trim();
          const resolved = resolveThresholdMessageText(rawText, target, sessionStats, userName, characterCards?.[target.characterId]);
          if (!resolved.trim()) continue;
          messages.push({
            characterId: target.characterId,
            characterName: target.characterName,
            effectName: effect.name,
            text: resolved,
          });
        }
      }
    }
  }

  return { messages, newStates };
}
