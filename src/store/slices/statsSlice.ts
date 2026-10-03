// ============================================
// Stats Slice - Character stats management
// ============================================

import type {
  SessionStats,
  CharacterSessionStats,
  StatChangeLogEntry,
  CharacterStatsConfig,
  AttributeDefinition,
  SkillDefinition,
  IntentionDefinition,
  InvitationDefinition,
  StatRequirement,
  SolicitudInstance,
  SessionSolicitudes,
  ThresholdEffect,
} from '@/types';
import { evaluateTimerTicks, hasActiveTimers, type TimerEvaluationResult } from '@/lib/stats/timer-processor';
import { evaluateThresholdEffects } from '@/lib/sprites/condition-evaluator';
import { executeReward } from '@/lib/quest/quest-reward-executor';
import { buildRewardStoreActions } from '@/lib/quest/reward-store-actions';
import { appendEventLogEntry } from '@/lib/stats/event-log';
import {
  relationshipPairKey,
  clampRelationshipPoints,
  computeRelationshipStage,
  DEFAULT_RELATIONSHIP_POINTS,
  RELATIONSHIP_MIRROR_KEY,
  RELATIONSHIP_STAGE_KEY,
} from '@/lib/relationships';
import {
  createDefaultWorldClock,
  advanceMinutes as worldAdvanceMinutes,
  catchUpRealTime,
  setToHour,
  worldClockAttributes,
  computeHour,
  computeMoment,
  formatWorldClock,
  type WorldClock,
} from '@/lib/world/time';

/**
 * Equipment slots are now owned by the active persona (global slots were removed).
 * Resolves the persona's slots safely from a stats-slice state object.
 */
function getPersonaEquipmentSlots(state: unknown): Array<{ key: string }> {
  try {
    const s = state as {
      personas?: Array<{ id?: string; equipmentSlots?: Array<{ key: string }> }>;
      activePersonaId?: string;
    };
    const persona = s.personas?.find(p => p.id === s.activePersonaId);
    return persona?.equipmentSlots || [];
  } catch {
    return [];
  }
}

// ============================================
// Types
// ============================================

/**
 * Recompute the `relacion`/`relacion_etapa` mirror for one character from
 * the FULL bonds record. A character may be in several bonds (group chats):
 * the mirror prefers the bond with the user; otherwise the highest bond.
 * If no bonds remain, the mirror keys are removed.
 */
function recomputeRelationshipMirror(
  characterStats: SessionStats['characterStats'],
  id: string,
  relationships: Record<string, import('@/types').SessionRelationship>,
  now: number
): void {
  const existing = characterStats[id] || { attributeValues: {}, lastUpdated: {} };
  const attributeValues = { ...existing.attributeValues };
  const lastUpdated = { ...existing.lastUpdated };
  const bonds = Object.values(relationships).filter(b => b.aId === id || b.bId === id);
  if (bonds.length === 0) {
    delete attributeValues[RELATIONSHIP_MIRROR_KEY];
    delete attributeValues[RELATIONSHIP_STAGE_KEY];
    delete lastUpdated[RELATIONSHIP_MIRROR_KEY];
    delete lastUpdated[RELATIONSHIP_STAGE_KEY];
  } else {
    const withUser = bonds.find(b => b.aId === '__user__' || b.bId === '__user__');
    const chosen = withUser || bonds.reduce((m, b) => (b.points > m.points ? b : m), bonds[0]);
    const stage = computeRelationshipStage(chosen.points);
    attributeValues[RELATIONSHIP_MIRROR_KEY] = chosen.points;
    attributeValues[RELATIONSHIP_STAGE_KEY] = stage.label;
    lastUpdated[RELATIONSHIP_MIRROR_KEY] = now;
    lastUpdated[RELATIONSHIP_STAGE_KEY] = now;
  }
  characterStats[id] = { ...existing, attributeValues, lastUpdated };
}

// ============================================
// Threshold Reward Execution (runs inside updateCharacterStat)
// ============================================
//
// Rewards from matched ThresholdEffects are executed HERE (store side) so that
// EVERY path that changes an attribute executes them: LLM tool activations,
// post-LLM key detection, skills, timers, manual edits and quest rewards.
// Previously only the skill path executed them — rewards silently did nothing
// for the other paths.
//
// 'message' rewards are skipped here: they are DEFERRED to the end of the turn
// (collected by the chat panel and sent as quick replies with edge-triggering).

let thresholdRewardDepth = 0;
const THRESHOLD_REWARD_MAX_DEPTH = 3;

function executeThresholdRewardsInternal(
  getFn: () => any,
  sessionId: string,
  characterId: string,
  thresholdsReached: ThresholdReachedInfo[]
): void {
  if (!thresholdsReached || thresholdsReached.length === 0) return;

  if (thresholdRewardDepth >= THRESHOLD_REWARD_MAX_DEPTH) {
    console.warn(`[StatsSlice] Threshold reward chain too deep (${thresholdRewardDepth}), skipping to prevent loops`);
    return;
  }

  thresholdRewardDepth++;
  try {
    const state = getFn();
    const session = state.sessions?.find((s: any) => s.id === sessionId);
    const sessionStats = session?.sessionStats;
    if (!sessionStats) return;

    const activePersona = state.personas?.find((p: any) => p.id === state.activePersonaId);

    // Resolve the character (or persona pseudo-character for __user__)
    let character: any = state.characters?.find((c: any) => c.id === characterId);
    if (!character && characterId === '__user__' && activePersona) {
      character = { id: '__user__', name: activePersona.name || 'User', statsConfig: activePersona.statsConfig };
    }

    const allCharacters = [
      ...(state.characters || []),
      ...(activePersona?.statsConfig?.enabled
        ? [{ id: '__user__', name: activePersona.name || 'User', statsConfig: activePersona.statsConfig }]
        : []),
    ];

    const settings = state.settings || {};
    const storeActions = buildRewardStoreActions(state);

    for (const threshold of thresholdsReached) {
      for (const reward of threshold.rewards || []) {
        // Message rewards are deferred to end-of-turn (chat panel)
        if (reward.type === 'message') continue;
        try {
          const result = executeReward(reward, {
            sessionId,
            characterId,
            character,
            allCharacters,
            sessionStats,
            timestamp: Date.now(),
            soundCollections: state.soundCollections,
            soundTriggers: state.soundTriggers,
            backgroundPacks: state.backgroundTriggerPacks,
            soundSettings: {
              enabled: settings.sound?.enabled ?? false,
              globalVolume: settings.sound?.globalVolume ?? 0.85,
            },
            backgroundSettings: {
              transitionDuration: settings.backgroundTriggers?.transitionDuration ?? 500,
              defaultTransitionType: settings.backgroundTriggers?.defaultTransitionType ?? 'fade',
            },
          }, storeActions);
          if (!result.success) {
            console.warn(`[StatsSlice] Threshold reward failed (${reward.type}):`, result.error || result.message);
          }
        } catch (err) {
          console.error('[StatsSlice] Failed to execute threshold reward:', err);
        }
      }
    }
  } finally {
    thresholdRewardDepth--;
  }
}

export interface ThresholdReachedInfo {
  attributeKey: string;
  attributeName: string;
  thresholdType: 'min' | 'max' | 'custom';  // 'custom' = new thresholdEffects system
  thresholdValue?: number;                    // Only for legacy min/max
  effectName?: string;                        // Name of the matching ThresholdEffect
  effectId?: string;                          // ID of the matching ThresholdEffect
  priority?: number;                          // Priority of the matching ThresholdEffect
  rewards: import('@/types').QuestReward[];
}

export interface UpdateCharacterStatResult {
  oldValue: number | string | undefined;
  newValue: number | string;
  clamped: boolean;
  thresholdsReached: ThresholdReachedInfo[];
}

export interface StatsSlice {
  // Session stats state (values per session)
  sessionStats: SessionStats | null;
  
  // Session Stats Actions
  initializeSessionStats: (
    sessionId: string,
    characters: Array<{ id: string; statsConfig?: CharacterStatsConfig; emotionalConfig?: import('@/types').EmotionalStateConfig }>
  ) => void;
  
  updateCharacterStat: (
    sessionId: string,
    characterId: string,
    attributeKey: string,
    value: number | string,
    reason?: 'llm_detection' | 'manual' | 'trigger' | 'initialization' | 'timer'
  ) => UpdateCharacterStatResult;
  
  batchUpdateCharacterStats: (
    sessionId: string,
    characterId: string,
    updates: Array<{ attributeKey: string; value: number | string }>,
    reason?: 'llm_detection' | 'manual' | 'trigger' | 'timer' | 'initialization'
  ) => void;
  
  resetCharacterStats: (
    sessionId: string,
    characterId: string,
    statsConfig?: CharacterStatsConfig
  ) => void;
  
  clearSessionStats: (sessionId: string) => void;
  
  // Getters
  getCharacterStats: (sessionId: string, characterId: string) => CharacterSessionStats | null;
  getAttributeValue: (sessionId: string, characterId: string, attributeKey: string) => number | string | null;

  // Solicitud Management (Peticiones/Solicitudes system)
  createSolicitud: (
    sessionId: string,
    targetCharacterId: string,
    solicitud: Omit<SolicitudInstance, 'id' | 'createdAt' | 'status'>
  ) => SolicitudInstance | null;
  
  completeSolicitud: (
    sessionId: string,
    characterId: string,
    solicitudKey: string
  ) => SolicitudInstance | null;
  
  getPendingSolicitudes: (
    sessionId: string,
    characterId: string
  ) => SolicitudInstance[];

  // User Peticiones/Solicitudes Actions (for {{user}})
  // These work without injecting anything into the chat
  activateUserPeticion: (
    sessionId: string,
    targetCharacterId: string,
    solicitudKey: string,
    description: string,
    completionDescription: string | undefined,
    userName: string,
    expirationTurns?: number,
    expirationMinutes?: number
  ) => SolicitudInstance | null;
  
  acceptUserSolicitud: (
    sessionId: string,
    solicitudId: string
  ) => SolicitudInstance | null;
  
  rejectUserSolicitud: (
    sessionId: string,
    solicitudId: string
  ) => boolean;
  
  getPendingUserSolicitudes: (
    sessionId: string
  ) => SolicitudInstance[];

  // Solicitud Expiration
  expireSolicitudes: (
    sessionId: string,
    currentTurn?: number
  ) => SolicitudInstance[];

  // Session Events (for {{eventos}} key)
  // These track recent important events in the session
  updateSessionEvent: (
    sessionId: string,
    eventType: 'ultimo_objetivo_completado' | 'ultima_solicitud_completada' | 'ultima_solicitud_realizada' | 'ultima_accion_realizada' | 'ultima_accion_character',
    description: string
  ) => void;

  // Push a custom entry into the session event log ({{eventos}} ring buffer).
  // Used for scene changes (enter/leave/focus) and future event sources.
  pushSessionEvent: (
    sessionId: string,
    entry: {
      type: import('@/types').SessionEventLogType;
      description: string;
      characterId?: string;
      characterName?: string;
      targetName?: string;
    }
  ) => void;

  // Relationships (bonds between entities). Updates points, mirrors
  // `relacion`/`relacion_etapa` into both parties' attributeValues and
  // pushes an event-log entry so other characters can react.
  updateRelationship: (
    sessionId: string,
    aId: string,
    bId: string,
    updates: { delta?: number; set?: number; reason?: string },
    names?: { aName?: string; bName?: string }
  ) => { points: number; stageKey: string; stageLabel: string; pairKey: string } | null;

  // Manually delete a bond (UI editing): removes it from relationships and
  // cleans the `relacion`/`relacion_etapa` mirror from both parties.
  removeRelationship: (sessionId: string, aId: string, bId: string) => void;

  // World time — advance by N turns (minutesPerTurn each), mirror hora/momento/dia/estacion
  advanceWorldTime: (sessionId: string, turns?: number) => WorldClock | null;
  // World time — set/override clock values (hour, minutes, season, config)
  setWorldTime: (
    sessionId: string,
    updates: { hour?: number; minute?: number; minutes?: number; season?: string; realTimeSync?: boolean; minutesPerTurn?: number; enabled?: boolean }
  ) => WorldClock | null;
  getWorldClock: (sessionId: string) => WorldClock | null;

  // Threshold MESSAGE effects: persist edge-state (condition met while true).
  // Used by the chat panel at end-of-turn so threshold messages fire only on
  // the false→true edge (prevents repeating the message every turn).
  setThresholdMessageStates: (sessionId: string, states: Record<string, boolean>) => void;

  // Timer System (automatic attribute changes over time)
  processTimerTicks: (
    sessionId: string,
    characterId: string,
    statsConfig: CharacterStatsConfig
  ) => import('@/lib/stats/timer-processor').TimerEvaluationResult | null;

  startSessionTimer: (sessionId: string, characterId: string, statsConfig: CharacterStatsConfig) => void;
  stopSessionTimer: (sessionId: string) => void;
  getTimerRunning: (sessionId: string) => boolean;

  // FASE 5: Emotional State Management
  updateEmotionalState: (
    sessionId: string,
    characterId: string,
    newState: string,
    previousState?: string
  ) => void;

  getEmotionalState: (
    sessionId: string,
    characterId: string
  ) => string | null;

  // GUARDARROPA V2: Wardrobe System — manage the active outfit per character
  /** Set the outfit the character is wearing (activeOutfitId in session stats).
   *  Pass null to fall back to the default outfit. Called by the manage_wardrobe
   *  tool SSE handler or by a manual override from the chat UI. */
  setActiveOutfit: (sessionId: string, characterId: string, outfitId: string | null) => void;
  /** Get the currently worn outfit id for a character (null = default outfit). */
  getActiveOutfitId: (sessionId: string, characterId: string) => string | null;

  // ESCENARIO V2: Scenario System — manage the active scene location (SESSION-level)
  /** Set the location where the scene takes place (activeScenarioId in session
   *  stats — shared by all chat participants). Pass null to fall back to the
   *  default location. Called by the manage_escenario tool SSE handler, by a
   *  quick reply's scenarioAction, or when starting a session with a greeting
   *  that pins a standard location. */
  setActiveScenario: (sessionId: string, scenarioId: string | null) => void;
  /** Get the currently active scenario location id (null = default location). */
  getActiveScenarioId: (sessionId: string) => string | null;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Clamp a numeric value to the attribute's min/max bounds
 * Returns the clamped value, or the original value if not numeric or no bounds defined
 */
function clampAttributeValue(
  value: number | string,
  attributeDef: AttributeDefinition | undefined
): number | string {
  // Only clamp numeric values
  if (typeof value !== 'number') {
    return value;
  }

  // If no attribute definition, return as-is
  if (!attributeDef) {
    return value;
  }

  let clampedValue = value;

  // Apply min bound - handle both number and string min values
  if (attributeDef.min !== undefined) {
    const minVal = typeof attributeDef.min === 'number'
      ? attributeDef.min
      : parseFloat(String(attributeDef.min));

    if (!isNaN(minVal)) {
      clampedValue = Math.max(clampedValue, minVal);
    }
  }

  // Apply max bound - handle both number and string max values
  if (attributeDef.max !== undefined) {
    const maxVal = typeof attributeDef.max === 'number'
      ? attributeDef.max
      : parseFloat(String(attributeDef.max));

    if (!isNaN(maxVal)) {
      clampedValue = Math.min(clampedValue, maxVal);
    }
  }

  return clampedValue;
}

/**
 * Create default character stats from config
 */
function createDefaultCharacterStats(
  statsConfig?: CharacterStatsConfig
): CharacterSessionStats {
  const attributeValues: Record<string, number | string> = {};
  const lastUpdated: Record<string, number> = {};
  const now = Date.now();
  
  if (statsConfig?.attributes) {
    for (const attr of statsConfig.attributes) {
      attributeValues[attr.key] = attr.defaultValue;
      lastUpdated[attr.key] = now;
    }
  }
  
  return {
    attributeValues,
    lastUpdated,
    changeLog: [],
  };
}

/**
 * Add entry to change log
 */
function addChangeLogEntry(
  stats: CharacterSessionStats,
  attribute: AttributeDefinition | undefined,
  attributeKey: string,
  oldValue: number | string | undefined,
  newValue: number | string,
  reason: StatChangeLogEntry['reason']
): void {
  if (!stats.changeLog) {
    stats.changeLog = [];
  }
  
  stats.changeLog.push({
    attributeId: attribute?.id || attributeKey,
    attributeKey,
    attributeName: attribute?.name || attributeKey,
    oldValue: oldValue ?? '',
    newValue,
    reason,
    timestamp: Date.now(),
  });
  
  // Keep only last 100 entries
  if (stats.changeLog.length > 100) {
    stats.changeLog = stats.changeLog.slice(-100);
  }
}

// ============================================
// Slice Factory
// ============================================

export const createStatsSlice = (set: any, get: any): StatsSlice => ({
  // Initial State
  sessionStats: null,

  // ============================================
  // Session Stats Actions
  // ============================================

  initializeSessionStats: (sessionId, characters) => {
    const state = get();
    const sessions = state.sessions as Array<{ id: string; sessionStats?: SessionStats }>;
    const session = sessions.find(s => s.id === sessionId);
    
    if (!session) return;
    
    // Check if already initialized
    if (session.sessionStats?.initialized) return;
    
    const now = Date.now();
    const characterStats: Record<string, CharacterSessionStats> = {};
    
    // Initialize stats for each character
    for (const char of characters) {
      const stats = createDefaultCharacterStats(char.statsConfig);
      // FASE 5: Initialize emotional state if emotional config is present
      if (char.emotionalConfig?.enabled && char.emotionalConfig.initialState) {
        stats.emotionalState = char.emotionalConfig.initialState;
        stats.emotionalStateLastEval = now;
        stats.emotionalStateTurnCount = 0;
        // Also set as attribute value for {{emocion}} key resolution
        stats.attributeValues['emocion'] = char.emotionalConfig.initialState;
      }
      characterStats[char.id] = stats;
    }
    
    const newSessionStats: SessionStats = {
      characterStats,
      solicitudes: {
        characterSolicitudes: {},
        lastModified: now,
      },
      initialized: true,
      lastModified: now,
      // Initialize timer state
      lastTimerUpdate: now,
      keywordCycleIndex: {},
    };
    
    // Update session with new stats
    set((state: any) => ({
      sessions: state.sessions.map((s: any) =>
        s.id === sessionId 
          ? { ...s, sessionStats: newSessionStats, updatedAt: new Date().toISOString() }
          : s
      ),
    }));
  },

  updateCharacterStat: (sessionId, characterId, attributeKey, value, reason = 'manual') => {
    // Default result
    const defaultResult: UpdateCharacterStatResult = {
      oldValue: undefined,
      newValue: typeof value === 'number' ? value : value,
      clamped: false,
      thresholdsReached: [],
    };

    // Read current state
    const state = get();
    const sessions = state.sessions as Array<{ 
      id: string; 
      sessionStats?: SessionStats;
      characterId?: string;
      groupId?: string;
    }>;
    const sessionIndex = sessions.findIndex(s => s.id === sessionId);
    
    if (sessionIndex === -1) return defaultResult;
    
    const session = sessions[sessionIndex];
    let sessionStats = session.sessionStats;
    
    // Auto-initialize sessionStats if missing
    if (!sessionStats) {
      sessionStats = {
        characterStats: {},
        solicitudes: {
          characterSolicitudes: {},
          lastModified: Date.now(),
        },
        ultimo_objetivo_completado: undefined,
        ultima_solicitud_completada: undefined,
        ultima_solicitud_realizada: undefined,
        ultima_accion_realizada: undefined,
        initialized: true,
        lastModified: Date.now(),
      };
    }
    
    // Auto-initialize character stats if missing
    if (!sessionStats.characterStats[characterId]) {
      let statsConfig: CharacterStatsConfig | undefined;
      if (characterId === '__user__') {
        // Look up active persona's statsConfig for __user__
        const activePersonaId = (state as any).activePersonaId;
        const personas: any[] = (state as any).personas || [];
        const activePersona = personas.find((p: any) => p.id === activePersonaId);
        statsConfig = activePersona?.statsConfig;
      } else {
        const character = state.characters.find((c: any) => c.id === characterId);
        statsConfig = character?.statsConfig;
      }
      let newStats = createDefaultCharacterStats(statsConfig);
      // For persona (__user__), also initialize equipment slot values
      if (characterId === '__user__') {
        const equipmentSlots = getPersonaEquipmentSlots(state);
        if (equipmentSlots && equipmentSlots.length > 0) {
          for (const slot of equipmentSlots) {
            if (!(slot.key in newStats.attributeValues)) {
              newStats.attributeValues[slot.key] = '';
              newStats.lastUpdated[slot.key] = Date.now();
            }
          }
        }
      }
      sessionStats = {
        ...sessionStats,
        characterStats: {
          ...sessionStats.characterStats,
          [characterId]: newStats,
        },
      };
    }
    
    const stats = sessionStats.characterStats[characterId];
    if (!stats) return defaultResult;

    const oldValue = stats.attributeValues[attributeKey];

    // Find attribute definition for logging and clamping
    let attributeDef: AttributeDefinition | undefined;
    if (characterId === '__user__') {
      // Look up active persona's statsConfig for __user__
      const activePersonaId = (state as any).activePersonaId;
      const personas: any[] = (state as any).personas || [];
      const activePersona = personas.find((p: any) => p.id === activePersonaId);
      attributeDef = activePersona?.statsConfig?.attributes?.find(
        (a: AttributeDefinition) => a.key === attributeKey
      );
    } else {
      const character = state.characters.find((c: any) => c.id === characterId);
      attributeDef = character?.statsConfig?.attributes?.find(
        (a: AttributeDefinition) => a.key === attributeKey
      );
    }

    // Clamp value to min/max bounds
    const clampedValue = clampAttributeValue(value, attributeDef);
    const clamped = clampedValue !== value;

    // Log if clamping occurred
    if (clamped) {
      console.log(`[StatsSlice] Clamped ${attributeKey}: ${value} → ${clampedValue} (min: ${attributeDef?.min}, max: ${attributeDef?.max})`);
    }

    // Detect threshold reached
    const thresholdsReached: ThresholdReachedInfo[] = [];
    
    if (attributeDef) {
      // V2: Evaluate new thresholdEffects (flexible conditions with priority)
      if (attributeDef.thresholdEffects && attributeDef.thresholdEffects.length > 0) {
        // Build a temporary session stats with the new value for evaluation
        const tempSessionStats: SessionStats = {
          ...sessionStats,
          characterStats: {
            ...sessionStats.characterStats,
            [characterId]: {
              ...stats,
              attributeValues: {
                ...stats.attributeValues,
                [attributeKey]: clampedValue,
              },
            },
          },
        };
        
        const matchingEffects = evaluateThresholdEffects(
          attributeDef.thresholdEffects,
          tempSessionStats,
          characterId
        );
        
        for (const effect of matchingEffects) {
          thresholdsReached.push({
            attributeKey: attributeDef.key,
            attributeName: attributeDef.name,
            thresholdType: 'custom',
            effectName: effect.name,
            effectId: effect.id,
            priority: effect.priority,
            rewards: effect.rewards,
          });
          console.log(`[StatsSlice] Threshold effect "${effect.name}" triggered for ${attributeDef.name} (priority: ${effect.priority})`);
        }
      }
      
      // Legacy: Check old onMinReached/onMaxReached (only if no thresholdEffects defined)
      if (!attributeDef.thresholdEffects || attributeDef.thresholdEffects.length === 0) {
        if (typeof clampedValue === 'number') {
          // Check if reached minimum
          if (attributeDef.min !== undefined && clampedValue === attributeDef.min) {
            if (attributeDef.onMinReached?.enabled && attributeDef.onMinReached.rewards.length > 0) {
              thresholdsReached.push({
                attributeKey: attributeDef.key,
                attributeName: attributeDef.name,
                thresholdType: 'min',
                thresholdValue: attributeDef.min,
                rewards: attributeDef.onMinReached.rewards,
              });
              console.log(`[StatsSlice] Threshold reached: ${attributeDef.name} hit minimum (${attributeDef.min})`);
            }
          }
          
          // Check if reached maximum
          if (attributeDef.max !== undefined && clampedValue === attributeDef.max) {
            if (attributeDef.onMaxReached?.enabled && attributeDef.onMaxReached.rewards.length > 0) {
              thresholdsReached.push({
                attributeKey: attributeDef.key,
                attributeName: attributeDef.name,
                thresholdType: 'max',
                thresholdValue: attributeDef.max,
                rewards: attributeDef.onMaxReached.rewards,
              });
              console.log(`[StatsSlice] Threshold reached: ${attributeDef.name} hit maximum (${attributeDef.max})`);
            }
          }
        }
      }
    }

    // Build the updated state
    const updatedCharacterStats = {
      ...sessionStats.characterStats,
      [characterId]: {
        ...stats,
        attributeValues: {
          ...stats.attributeValues,
          [attributeKey]: clampedValue,
        },
        lastUpdated: {
          ...stats.lastUpdated,
          [attributeKey]: Date.now(),
        },
      },
    };

    // Add to change log
    addChangeLogEntry(
      updatedCharacterStats[characterId],
      attributeDef,
      attributeKey,
      oldValue,
      clampedValue,
      reason
    );
    
    const newSessionStats: SessionStats = {
      ...sessionStats,
      characterStats: updatedCharacterStats,
      lastModified: Date.now(),
    };
    
    // Update the store
    set({
      sessions: state.sessions.map((s: any) =>
        s.id === sessionId
          ? { 
              ...s, 
              sessionStats: newSessionStats,
              updatedAt: new Date().toISOString() 
            }
          : s
      ),
    });

    // Sync currency changes to persona (Inventory V2)
    // When currency is updated via quest rewards/triggers on __user__,
    // also update persona.currency so the InventoryPanel/HUD stay in sync
    if (characterId === '__user__' && attributeKey === 'currency' && typeof clampedValue === 'number') {
      try {
        const activePersonaId = (get() as any).activePersonaId;
        if (activePersonaId) {
          (get() as any).updatePersona?.(activePersonaId, { currency: clampedValue });
        }
      } catch { /* non-critical sync */ }
    }

    // Execute threshold effect rewards (store-side, every path covered).
    // 'message' rewards are deferred to end-of-turn (chat panel sends them as
    // quick replies with edge-triggering via thresholdMessageStates).
    if (thresholdsReached.length > 0) {
      try {
        executeThresholdRewardsInternal(get, sessionId, characterId, thresholdsReached);
      } catch (err) {
        console.error('[StatsSlice] Threshold reward execution error:', err);
      }
    }

    // Refresh objective visibility since attribute conditions may have changed
    try {
      (get() as any).refreshAllObjectiveVisibility?.(sessionId);
    } catch { /* non-critical */ }

    // Refresh activation conditions since attribute conditions may have changed
    try {
      (get() as any).refreshAllActivationConditions?.(sessionId);
    } catch { /* non-critical */ }

    // Return result with threshold info
    return {
      oldValue,
      newValue: clampedValue,
      clamped,
      thresholdsReached,
    };
  },

  batchUpdateCharacterStats: (sessionId, characterId, updates, reason = 'llm_detection') => {
    set((state: any) => {
      const sessions = state.sessions as Array<{
        id: string; 
        sessionStats?: SessionStats;
      }>;
      const sessionIndex = sessions.findIndex(s => s.id === sessionId);
      
      if (sessionIndex === -1) return state;
      
      const session = sessions[sessionIndex];
      let sessionStats = session.sessionStats;
      
      // Auto-initialize sessionStats if missing (includes event fields reset)
      if (!sessionStats) {
        sessionStats = {
          characterStats: {},
          solicitudes: {
            characterSolicitudes: {},
            lastModified: Date.now(),
          },
          ultimo_objetivo_completado: undefined,
          ultima_solicitud_completada: undefined,
          ultima_solicitud_realizada: undefined,
          ultima_accion_realizada: undefined,
          initialized: true,
          lastModified: Date.now(),
        };
      }
      
      // Auto-initialize character stats if missing
      if (!sessionStats.characterStats[characterId]) {
        let statsConfig: CharacterStatsConfig | undefined;
        if (characterId === '__user__') {
          // Look up active persona's statsConfig for __user__
          const activePersonaId = (state as any).activePersonaId;
          const personas: any[] = (state as any).personas || [];
          const activePersona = personas.find((p: any) => p.id === activePersonaId);
          statsConfig = activePersona?.statsConfig;
        } else {
          const character = state.characters.find((c: any) => c.id === characterId);
          statsConfig = character?.statsConfig;
        }
        let autoStats = createDefaultCharacterStats(statsConfig);
        // For persona (__user__), also initialize equipment slot values
        if (characterId === '__user__') {
          const equipmentSlots = getPersonaEquipmentSlots(state);
          if (equipmentSlots && equipmentSlots.length > 0) {
            for (const slot of equipmentSlots) {
              if (!(slot.key in autoStats.attributeValues)) {
                autoStats.attributeValues[slot.key] = '';
                autoStats.lastUpdated[slot.key] = Date.now();
              }
            }
          }
        }
        sessionStats = {
          ...sessionStats,
          characterStats: {
            ...sessionStats.characterStats,
            [characterId]: autoStats,
          },
        };
      }
      
      const stats = sessionStats.characterStats[characterId];
      if (!stats) return state;
      
      // Look up statsConfig for the character (or persona for __user__)
      let statsConfig: CharacterStatsConfig | undefined;
      if (characterId === '__user__') {
        const activePersonaId = (state as any).activePersonaId;
        const personas: any[] = (state as any).personas || [];
        const activePersona = personas.find((p: any) => p.id === activePersonaId);
        statsConfig = activePersona?.statsConfig;
      } else {
        const character = state.characters.find((c: any) => c.id === characterId);
        statsConfig = character?.statsConfig;
      }
      const now = Date.now();
      
      // Apply all updates
      const newAttributeValues = { ...stats.attributeValues };
      const newLastUpdated = { ...stats.lastUpdated };
      const newChangeLog = [...(stats.changeLog || [])];

      for (const update of updates) {
        const oldValue = newAttributeValues[update.attributeKey];
        const attributeDef = statsConfig?.attributes?.find(
          (a: AttributeDefinition) => a.key === update.attributeKey
        );

        // Clamp value to min/max bounds
        const clampedValue = clampAttributeValue(update.value, attributeDef);

        // Log if clamping occurred
        if (clampedValue !== update.value) {
          console.log(`[StatsSlice] Clamped ${update.attributeKey}: ${update.value} → ${clampedValue} (min: ${attributeDef?.min}, max: ${attributeDef?.max})`);
        }

        newAttributeValues[update.attributeKey] = clampedValue;
        newLastUpdated[update.attributeKey] = now;

        newChangeLog.push({
          attributeId: attributeDef?.id || update.attributeKey,
          attributeKey: update.attributeKey,
          attributeName: attributeDef?.name || update.attributeKey,
          oldValue: oldValue ?? '',
          newValue: clampedValue,
          reason,
          timestamp: now,
        });
      }
      
      // Keep only last 100 entries
      const trimmedChangeLog = newChangeLog.slice(-100);
      
      const updatedCharacterStats = {
        ...sessionStats.characterStats,
        [characterId]: {
          ...stats,
          attributeValues: newAttributeValues,
          lastUpdated: newLastUpdated,
          changeLog: trimmedChangeLog,
        },
      };
      
      const newSessionStats: SessionStats = {
        ...sessionStats,
        characterStats: updatedCharacterStats,
        lastModified: now,
      };
      
      return {
        sessions: state.sessions.map((s: any) =>
          s.id === sessionId
            ? { 
                ...s, 
                sessionStats: newSessionStats,
                updatedAt: new Date().toISOString() 
              }
            : s
        ),
      };
    });

    // Evaluate threshold effects for the updated attributes (rewards run store-side,
    // same as updateCharacterStat). 'message' rewards are deferred to end-of-turn.
    try {
      const st = get() as any;
      const freshSession = st.sessions?.find((s: any) => s.id === sessionId);
      const freshStats = freshSession?.sessionStats?.characterStats?.[characterId];
      let batchStatsConfig: CharacterStatsConfig | undefined;
      if (characterId === '__user__') {
        const activePersona = st.personas?.find((p: any) => p.id === st.activePersonaId);
        batchStatsConfig = activePersona?.statsConfig;
      } else {
        const character = st.characters?.find((c: any) => c.id === characterId);
        batchStatsConfig = character?.statsConfig;
      }
      if (freshStats && batchStatsConfig?.attributes) {
        const seenEffects = new Set<string>();
        const allThresholds: ThresholdReachedInfo[] = [];
        for (const update of updates) {
          const attributeDef = batchStatsConfig.attributes.find(
            (a: AttributeDefinition) => a.key === update.attributeKey
          );
          if (!attributeDef?.thresholdEffects || attributeDef.thresholdEffects.length === 0) continue;
          const matching = evaluateThresholdEffects(attributeDef.thresholdEffects, freshSession.sessionStats, characterId);
          for (const effect of matching) {
            const dedupKey = `${attributeDef.key}:${effect.id}`;
            if (seenEffects.has(dedupKey)) continue;
            seenEffects.add(dedupKey);
            allThresholds.push({
              attributeKey: attributeDef.key,
              attributeName: attributeDef.name,
              thresholdType: 'custom',
              effectName: effect.name,
              effectId: effect.id,
              priority: effect.priority,
              rewards: effect.rewards,
            });
          }
        }
        if (allThresholds.length > 0) {
          executeThresholdRewardsInternal(get, sessionId, characterId, allThresholds);
        }
      }
    } catch (err) {
      console.error('[StatsSlice] Batch threshold reward execution error:', err);
    }

    // Refresh objective visibility since attribute conditions may have changed
    try {
      (get() as any).refreshAllObjectiveVisibility?.(sessionId);
    } catch { /* non-critical */ }

    // Refresh activation conditions since attribute conditions may have changed
    try {
      (get() as any).refreshAllActivationConditions?.(sessionId);
    } catch { /* non-critical */ }
  },

  resetCharacterStats: (sessionId, characterId, statsConfig) => {
    set((state: any) => {
      const sessions = state.sessions as Array<{ 
        id: string; 
        sessionStats?: SessionStats;
      }>;
      const session = sessions.find(s => s.id === sessionId);
      
      if (!session?.sessionStats) return state;
      
      const character = state.characters.find((c: any) => c.id === characterId);
      const newStats = createDefaultCharacterStats(statsConfig || character?.statsConfig);
      // For persona (__user__), also initialize equipment slot values
      if (characterId === '__user__') {
        const equipmentSlots = getPersonaEquipmentSlots(state);
        if (equipmentSlots && equipmentSlots.length > 0) {
          for (const slot of equipmentSlots) {
            if (!(slot.key in newStats.attributeValues)) {
              newStats.attributeValues[slot.key] = '';
              newStats.lastUpdated[slot.key] = Date.now();
            }
          }
        }
      }
      
      const updatedCharacterStats = {
        ...session.sessionStats.characterStats,
        [characterId]: newStats,
      };
      
      const newSessionStats: SessionStats = {
        ...session.sessionStats,
        characterStats: updatedCharacterStats,
        lastModified: Date.now(),
      };
      
      return {
        sessions: state.sessions.map((s: any) =>
          s.id === sessionId
            ? { 
                ...s, 
                sessionStats: newSessionStats,
                updatedAt: new Date().toISOString() 
              }
            : s
        ),
      };
    });

    // Refresh objective visibility since attribute values changed
    try {
      (get() as any).refreshAllObjectiveVisibility?.(sessionId);
    } catch { /* non-critical */ }

    // Refresh activation conditions since attribute values changed
    try {
      (get() as any).refreshAllActivationConditions?.(sessionId);
    } catch { /* non-critical */ }
  },

  clearSessionStats: (sessionId) => {
    set((state: any) => ({
      sessions: state.sessions.map((s: any) =>
        s.id === sessionId
          ? { 
              ...s, 
              sessionStats: undefined,
              updatedAt: new Date().toISOString() 
            }
          : s
      ),
    }));
  },

  // ============================================
  // Getters
  // ============================================

  getCharacterStats: (sessionId, characterId) => {
    const state = get();
    const sessions = state.sessions as Array<{ 
      id: string; 
      sessionStats?: SessionStats;
    }>;
    const session = sessions.find(s => s.id === sessionId);
    
    if (!session?.sessionStats) return null;
    
    return session.sessionStats.characterStats[characterId] || null;
  },

  getAttributeValue: (sessionId, characterId, attributeKey) => {
    const state = get();
    const sessions = state.sessions as Array<{ 
      id: string; 
      sessionStats?: SessionStats;
    }>;
    const session = sessions.find(s => s.id === sessionId);
    
    if (!session?.sessionStats) return null;
    
    const stats = session.sessionStats.characterStats[characterId];
    if (!stats) return null;
    
    return stats.attributeValues[attributeKey] ?? null;
  },

  // ============================================
  // Solicitud Management (Peticiones/Solicitudes)
  // ============================================

  createSolicitud: (sessionId, targetCharacterId, solicitudData) => {
    const state = get();
    const sessions = state.sessions as Array<{ 
      id: string; 
      sessionStats?: SessionStats;
    }>;
    const sessionIndex = sessions.findIndex(s => s.id === sessionId);
    
    if (sessionIndex === -1) return null;
    
    const session = sessions[sessionIndex];
    let sessionStats = session.sessionStats;
    
    // Auto-initialize sessionStats if missing (includes event fields)
    if (!sessionStats) {
      sessionStats = {
        characterStats: {},
        solicitudes: {
          characterSolicitudes: {},
          lastModified: Date.now(),
        },
        ultimo_objetivo_completado: undefined,
        ultima_solicitud_completada: undefined,
        ultima_solicitud_realizada: undefined,
        ultima_accion_realizada: undefined,
        initialized: true,
        lastModified: Date.now(),
      };
    }
    
    // Auto-initialize solicitudes if missing
    if (!sessionStats.solicitudes) {
      sessionStats = {
        ...sessionStats,
        solicitudes: {
          characterSolicitudes: {},
          lastModified: Date.now(),
        },
      };
    }
    
    // Create the new solicitud instance
    const newSolicitud: SolicitudInstance = {
      ...solicitudData,
      id: `solicitud-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      status: 'pending',
      createdAt: Date.now(),
    };
    
    console.log(`[createSolicitud] Creating solicitud with data:`, {
      key: solicitudData.key,
      peticionKey: solicitudData.peticionKey,
      fromCharacterId: solicitudData.fromCharacterId,
      targetCharacterId,
    });
    
    // Add to target character's solicitudes
    const currentSolicitudes = sessionStats.solicitudes.characterSolicitudes[targetCharacterId] || [];
    const updatedSolicitudes = [...currentSolicitudes, newSolicitud];
    const targetCharacterName = (get() as any).characters?.find(
      (c: { id: string }) => c.id === targetCharacterId
    )?.name;
    
    const newSessionStats: SessionStats = appendEventLogEntry({
      ...sessionStats,
      solicitudes: {
        characterSolicitudes: {
          ...sessionStats.solicitudes.characterSolicitudes,
          [targetCharacterId]: updatedSolicitudes,
        },
        lastModified: Date.now(),
      },
      // Save event for {{eventos}} key - peticion was activated
      ultima_solicitud_realizada: solicitudData.description,
      lastModified: Date.now(),
    }, {
      type: 'solicitud_created',
      description: solicitudData.description,
      characterId: solicitudData.fromCharacterId,
      characterName: solicitudData.fromCharacterName,
      targetName: targetCharacterName,
    });
    
    set((state: any) => ({
      sessions: state.sessions.map((s: any) =>
        s.id === sessionId
          ? { 
              ...s, 
              sessionStats: newSessionStats,
              updatedAt: new Date().toISOString() 
            }
          : s
      ),
    }));
    
    console.log(`[Solicitud] Created solicitud "${solicitudData.key}" for character ${targetCharacterId} from ${solicitudData.fromCharacterName}`);
    return newSolicitud;
  },

  completeSolicitud: (sessionId, characterId, solicitudKey) => {
    const state = get();
    const sessions = state.sessions as Array<{ 
      id: string; 
      sessionStats?: SessionStats;
    }>;
    const sessionIndex = sessions.findIndex(s => s.id === sessionId);
    
    if (sessionIndex === -1) return null;
    
    const session = sessions[sessionIndex];
    const sessionStats = session.sessionStats;
    
    if (!sessionStats?.solicitudes?.characterSolicitudes?.[characterId]) {
      return null;
    }
    
    const solicitudes = sessionStats.solicitudes.characterSolicitudes[characterId];
    const solicitudIndex = solicitudes.findIndex(
      s => s.key === solicitudKey && s.status === 'pending'
    );
    
    if (solicitudIndex === -1) {
      console.log(`[Solicitud] No pending solicitud found with key "${solicitudKey}" for character ${characterId}`);
      return null;
    }
    
    // Mark as completed
    const updatedSolicitudes = [...solicitudes];
    const completedSolicitud = {
      ...updatedSolicitudes[solicitudIndex],
      status: 'completed' as const,
      completedAt: Date.now(),
    };
    updatedSolicitudes[solicitudIndex] = completedSolicitud;
    
    const newSessionStats: SessionStats = appendEventLogEntry({
      ...sessionStats,
      solicitudes: {
        characterSolicitudes: {
          ...sessionStats.solicitudes.characterSolicitudes,
          [characterId]: updatedSolicitudes,
        },
        lastModified: Date.now(),
      },
      // Save event for {{eventos}} key
      ultima_solicitud_completada: completedSolicitud.completionDescription || 
        `Solicitud "${solicitudKey}" completada por ${completedSolicitud.fromCharacterName}`,
      lastModified: Date.now(),
    }, {
      type: 'solicitud_completed',
      description: completedSolicitud.completionDescription ||
        `Solicitud "${solicitudKey}" completada por ${completedSolicitud.fromCharacterName}`,
      characterId,
    });
    
    set((state: any) => ({
      sessions: state.sessions.map((s: any) =>
        s.id === sessionId
          ? { 
              ...s, 
              sessionStats: newSessionStats,
              updatedAt: new Date().toISOString() 
            }
          : s
      ),
    }));
    
    console.log(`[Solicitud] Completed solicitud "${solicitudKey}" for character ${characterId}`);
    return completedSolicitud;
  },

  getPendingSolicitudes: (sessionId, characterId) => {
    const state = get();
    const sessions = state.sessions as Array<{ 
      id: string; 
      sessionStats?: SessionStats;
    }>;
    const session = sessions.find(s => s.id === sessionId);
    
    if (!session?.sessionStats?.solicitudes?.characterSolicitudes?.[characterId]) {
      return [];
    }
    
    return session.sessionStats.solicitudes.characterSolicitudes[characterId].filter(
      s => s.status === 'pending'
    );
  },

  // ============================================
  // User Peticiones/Solicitudes Actions ({{user}})
  // ============================================
  // These actions allow the user to make peticiones and accept/reject solicitudes
  // without injecting anything into the chat history.
  // User ID is stored as '__user__' in the session stats.

  /**
   * Activate a peticion for the user
   * Creates a SolicitudInstance for the target character directly
   * (No chat message injection)
   * 
   * Returns null if a pending solicitud with the same key already exists for this target.
   */
  activateUserPeticion: (
    sessionId: string,
    targetCharacterId: string,
    solicitudKey: string,
    description: string,
    completionDescription: string | undefined,
    userName: string,
    expirationTurns?: number,
    expirationMinutes?: number
  ) => {
    const state = get();
    const sessions = state.sessions as Array<{ 
      id: string; 
      sessionStats?: SessionStats;
    }>;
    const sessionIndex = sessions.findIndex(s => s.id === sessionId);
    
    if (sessionIndex === -1) return null;
    
    const session = sessions[sessionIndex];
    let sessionStats = session.sessionStats;
    
    // Auto-initialize sessionStats if missing (includes event fields)
    if (!sessionStats) {
      sessionStats = {
        characterStats: {},
        solicitudes: {
          characterSolicitudes: {},
          lastModified: Date.now(),
        },
        ultimo_objetivo_completado: undefined,
        ultima_solicitud_completada: undefined,
        ultima_solicitud_realizada: undefined,
        ultima_accion_realizada: undefined,
        initialized: true,
        lastModified: Date.now(),
      };
    }
    
    // Auto-initialize solicitudes if missing
    if (!sessionStats.solicitudes) {
      sessionStats = {
        ...sessionStats,
        solicitudes: {
          characterSolicitudes: {},
          lastModified: Date.now(),
        },
      };
    }
    
    // Check for duplicate pending solicitud with same key for same target
    const existingSolicitudes = sessionStats.solicitudes.characterSolicitudes[targetCharacterId] || [];
    const duplicateExists = existingSolicitudes.some(
      s => s.key === solicitudKey && s.status === 'pending' && s.fromCharacterId === '__user__'
    );
    
    if (duplicateExists) {
      console.log(`[UserPeticion] Duplicate solicitud "${solicitudKey}" already exists for character ${targetCharacterId}`);
      return null;
    }
    
    // Create the new solicitud instance
    const now = Date.now();
    const currentTurn = get().getTurnCount?.(sessionId) || 0;
    const newSolicitud: SolicitudInstance = {
      id: `solicitud-user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      key: solicitudKey,
      fromCharacterId: '__user__',
      fromCharacterName: userName || 'Usuario',
      description,
      completionDescription,
      status: 'pending',
      createdAt: now,
      expiresAt: expirationMinutes && expirationMinutes > 0 ? now + expirationMinutes * 60 * 1000 : undefined,
      expiresAtTurn: expirationTurns && expirationTurns > 0 ? currentTurn + expirationTurns : undefined,
    };
    
    // Add to target character's solicitudes
    const currentSolicitudes = sessionStats.solicitudes.characterSolicitudes[targetCharacterId] || [];
    const updatedSolicitudes = [...currentSolicitudes, newSolicitud];
    const targetCharacterName = (get() as any).characters?.find(
      (c: { id: string }) => c.id === targetCharacterId
    )?.name;
    
    const newSessionStats: SessionStats = appendEventLogEntry({
      ...sessionStats,
      solicitudes: {
        characterSolicitudes: {
          ...sessionStats.solicitudes.characterSolicitudes,
          [targetCharacterId]: updatedSolicitudes,
        },
        lastModified: Date.now(),
      },
      // Save event for {{eventos}} key - user made a peticion to a character
      ultima_solicitud_realizada: description,
      lastModified: Date.now(),
    }, {
      type: 'solicitud_user',
      description,
      characterId: '__user__',
      characterName: userName || 'Usuario',
      targetName: targetCharacterName,
    });
    
    set((state: any) => ({
      sessions: state.sessions.map((s: any) =>
        s.id === sessionId
          ? { 
              ...s, 
              sessionStats: newSessionStats,
              updatedAt: new Date().toISOString() 
            }
          : s
      ),
    }));
    
    console.log(`[UserPeticion] Created solicitud "${solicitudKey}" for character ${targetCharacterId}`);
    return newSolicitud;
  },

  /**
   * Accept a solicitud received by the user
   * Marks the solicitud as completed directly (no chat injection)
   */
  acceptUserSolicitud: (sessionId, solicitudId) => {
    const state = get();
    const sessions = state.sessions as Array<{ 
      id: string; 
      sessionStats?: SessionStats;
    }>;
    const sessionIndex = sessions.findIndex(s => s.id === sessionId);
    
    if (sessionIndex === -1) return null;
    
    const session = sessions[sessionIndex];
    const sessionStats = session.sessionStats;
    
    // User's solicitudes are stored under '__user__'
    if (!sessionStats?.solicitudes?.characterSolicitudes?.['__user__']) {
      return null;
    }
    
    const solicitudes = sessionStats.solicitudes.characterSolicitudes['__user__'];
    const solicitudIndex = solicitudes.findIndex(
      s => s.id === solicitudId && s.status === 'pending'
    );
    
    if (solicitudIndex === -1) {
      console.log(`[UserSolicitud] No pending solicitud found with id "${solicitudId}"`);
      return null;
    }
    
    // Mark as completed
    const updatedSolicitudes = [...solicitudes];
    const completedSolicitud = {
      ...updatedSolicitudes[solicitudIndex],
      status: 'completed' as const,
      completedAt: Date.now(),
    };
    updatedSolicitudes[solicitudIndex] = completedSolicitud;
    
    const newSessionStats: SessionStats = {
      ...sessionStats,
      solicitudes: {
        characterSolicitudes: {
          ...sessionStats.solicitudes.characterSolicitudes,
          ['__user__']: updatedSolicitudes,
        },
        lastModified: Date.now(),
      },
      // Save event for {{eventos}} key - use completionDescription if available
      ultima_solicitud_completada: completedSolicitud.completionDescription || 
        `${completedSolicitud.fromCharacterName} recibió respuesta del usuario`,
      lastModified: Date.now(),
    };
    
    set((state: any) => ({
      sessions: state.sessions.map((s: any) =>
        s.id === sessionId
          ? { 
              ...s, 
              sessionStats: newSessionStats,
              updatedAt: new Date().toISOString() 
            }
          : s
      ),
    }));
    
    console.log(`[UserSolicitud] Accepted solicitud "${completedSolicitud.key}"`);
    return completedSolicitud;
  },

  /**
   * Reject a solicitud received by the user
   * Removes it from the list
   */
  rejectUserSolicitud: (sessionId, solicitudId) => {
    const state = get();
    const sessions = state.sessions as Array<{ 
      id: string; 
      sessionStats?: SessionStats;
    }>;
    const sessionIndex = sessions.findIndex(s => s.id === sessionId);
    
    if (sessionIndex === -1) return false;
    
    const session = sessions[sessionIndex];
    const sessionStats = session.sessionStats;
    
    // User's solicitudes are stored under '__user__'
    if (!sessionStats?.solicitudes?.characterSolicitudes?.['__user__']) {
      return false;
    }
    
    const solicitudes = sessionStats.solicitudes.characterSolicitudes['__user__'];
    const solicitud = solicitudes.find(s => s.id === solicitudId);
    
    if (!solicitud) {
      return false;
    }
    
    // Remove from list (mark as rejected by filtering out)
    const updatedSolicitudes = solicitudes.filter(s => s.id !== solicitudId);
    
    const newSessionStats: SessionStats = {
      ...sessionStats,
      solicitudes: {
        characterSolicitudes: {
          ...sessionStats.solicitudes.characterSolicitudes,
          ['__user__']: updatedSolicitudes,
        },
        lastModified: Date.now(),
      },
      lastModified: Date.now(),
    };
    
    set((state: any) => ({
      sessions: state.sessions.map((s: any) =>
        s.id === sessionId
          ? { 
              ...s, 
              sessionStats: newSessionStats,
              updatedAt: new Date().toISOString() 
            }
          : s
      ),
    }));
    
    console.log(`[UserSolicitud] Rejected solicitud "${solicitud.key}"`);
    return true;
  },

  /**
   * Get pending solicitudes for the user
   */
  getPendingUserSolicitudes: (sessionId) => {
    const state = get();
    const sessions = state.sessions as Array<{ 
      id: string; 
      sessionStats?: SessionStats;
    }>;
    const session = sessions.find(s => s.id === sessionId);
    
    if (!session?.sessionStats?.solicitudes?.characterSolicitudes?.['__user__']) {
      return [];
    }
    
    return session.sessionStats.solicitudes.characterSolicitudes['__user__'].filter(
      s => s.status === 'pending'
    );
  },

  /**
   * Expire solicitudes that have passed their expiration time or turn.
   * Returns the list of solicitudes that were expired.
   * Should be called after each LLM turn or on a timer.
   */
  expireSolicitudes: (sessionId, currentTurn) => {
    const state = get();
    const sessions = state.sessions as Array<{ 
      id: string; 
      sessionStats?: SessionStats;
    }>;
    const sessionIndex = sessions.findIndex(s => s.id === sessionId);
    
    if (sessionIndex === -1) return [];
    
    const session = sessions[sessionIndex];
    const sessionStats = session.sessionStats;
    
    if (!sessionStats?.solicitudes?.characterSolicitudes) return [];
    
    const now = Date.now();
    const expiredSolicitudes: SolicitudInstance[] = [];
    let hasChanges = false;
    
    const updatedCharacterSolicitudes: Record<string, SolicitudInstance[]> = {};
    
    for (const [charId, solicitudes] of Object.entries(sessionStats.solicitudes.characterSolicitudes)) {
      const updatedSolicitudes = solicitudes.map(solicitud => {
        if (solicitud.status !== 'pending') return solicitud;
        
        let isExpired = false;
        
        // Check time-based expiration
        if (solicitud.expiresAt && now >= solicitud.expiresAt) {
          isExpired = true;
        }
        
        // Check turn-based expiration
        if (solicitud.expiresAtTurn && currentTurn !== undefined && currentTurn >= solicitud.expiresAtTurn) {
          isExpired = true;
        }
        
        if (isExpired) {
          hasChanges = true;
          const expired = {
            ...solicitud,
            status: 'expired' as const,
            completedAt: now,
          };
          expiredSolicitudes.push(expired);
          return expired;
        }
        
        return solicitud;
      });
      
      updatedCharacterSolicitudes[charId] = updatedSolicitudes;
    }
    
    if (!hasChanges) return [];
    
    const newSessionStats: SessionStats = {
      ...sessionStats,
      solicitudes: {
        characterSolicitudes: updatedCharacterSolicitudes,
        lastModified: now,
      },
      lastModified: now,
    };
    
    set((state: any) => ({
      sessions: state.sessions.map((s: any) =>
        s.id === sessionId
          ? { 
              ...s, 
              sessionStats: newSessionStats,
              updatedAt: new Date().toISOString() 
            }
          : s
      ),
    }));
    
    if (expiredSolicitudes.length > 0) {
      console.log(`[Solicitud] Expired ${expiredSolicitudes.length} solicitudes in session ${sessionId}`);
    }
    
    return expiredSolicitudes;
  },

  /**
   * Update session event (for {{eventos}} key)
   * Saves recent important events to session stats
   */
  updateSessionEvent: (sessionId, eventType, description) => {
    set((state: any) => {
      const sessions = state.sessions as Array<{ 
        id: string; 
        sessionStats?: SessionStats;
      }>;
      const sessionIndex = sessions.findIndex(s => s.id === sessionId);
      
      if (sessionIndex === -1) return state;
      
      const session = sessions[sessionIndex];
      let sessionStats = session.sessionStats;
      
      // Auto-initialize sessionStats if missing (includes event fields)
      if (!sessionStats) {
        sessionStats = {
          characterStats: {},
          solicitudes: {
            characterSolicitudes: {},
            lastModified: Date.now(),
          },
          ultimo_objetivo_completado: undefined,
          ultima_solicitud_completada: undefined,
          ultima_solicitud_realizada: undefined,
          ultima_accion_realizada: undefined,
          ultima_accion_character: undefined,
          initialized: true,
          lastModified: Date.now(),
        };
      }
      
      // Update the specific event field
      let newSessionStats: SessionStats = {
        ...sessionStats,
        [eventType]: description,
        lastModified: Date.now(),
      };

      // Push to the event log ring buffer ({{eventos}} history)
      try {
        const turn = get().getTurnCount?.(sessionId) || undefined;
        if (eventType === 'ultimo_objetivo_completado') {
          newSessionStats = appendEventLogEntry(newSessionStats, {
            type: 'quest_objective', description, turn,
          });
        } else if (eventType === 'ultima_solicitud_realizada') {
          newSessionStats = appendEventLogEntry(newSessionStats, {
            type: 'solicitud_created', description, turn,
          });
        } else if (eventType === 'ultima_solicitud_completada') {
          newSessionStats = appendEventLogEntry(newSessionStats, {
            type: 'solicitud_completed', description, turn,
          });
        } else if (eventType === 'ultima_accion_character') {
          // Arrives right after 'ultima_accion_realizada' — build the full entry here
          const actionDesc = sessionStats.ultima_accion_realizada || newSessionStats.ultima_accion_realizada;
          if (actionDesc) {
            newSessionStats = appendEventLogEntry(newSessionStats, {
              type: 'action',
              description: actionDesc,
              characterName: description, // description param carries the author name here
              turn,
            });
          }
        }
      } catch (e) {
        console.warn('[SessionEvent] Failed to append event log entry:', e);
      }
      
      return {
        sessions: state.sessions.map((s: any) =>
          s.id === sessionId
            ? { 
                ...s, 
                sessionStats: newSessionStats,
                updatedAt: new Date().toISOString() 
              }
            : s
        ),
      };
    });
    
    console.log(`[SessionEvent] Updated ${eventType}: ${description}`);
  },

  /**
   * Push a custom entry into the session event log ({{eventos}} ring buffer).
   */
  pushSessionEvent: (sessionId, entry) => {
    set((state: any) => {
      const sessions = state.sessions as Array<{
        id: string;
        sessionStats?: SessionStats;
      }>;
      const sessionIndex = sessions.findIndex(s => s.id === sessionId);
      if (sessionIndex === -1) return state;

      const session = sessions[sessionIndex];
      if (!session.sessionStats) return state; // events require initialized stats

      const turn = get().getTurnCount?.(sessionId) || undefined;
      const newSessionStats = appendEventLogEntry(session.sessionStats, { ...entry, turn });

      return {
        sessions: state.sessions.map((s: any) =>
          s.id === sessionId
            ? {
                ...s,
                sessionStats: newSessionStats,
                updatedAt: new Date().toISOString(),
              }
            : s
        ),
      };
    });

    console.log(`[SessionEvent] Pushed ${entry.type}: ${entry.description}`);
  },

  /**
   * Update a relationship bond (a↔b), mirror it into both parties'
   * attributeValues and log the event.
   */
  updateRelationship: (sessionId, aId, bId, updates, names) => {
    const result = ((): { points: number; stageKey: string; stageLabel: string; pairKey: string; prevPoints: number } | null => {
      const state = get();
      const sessions = state.sessions as Array<{ id: string; sessionStats?: SessionStats }>;
      const session = sessions.find(s => s.id === sessionId);
      if (!session?.sessionStats) return null;

      const sessionStats = session.sessionStats;
      const pairKey = relationshipPairKey(aId, bId);
      const prev = (sessionStats.relationships?.[pairKey]?.points) ?? DEFAULT_RELATIONSHIP_POINTS;
      const raw = typeof updates.set === 'number' ? updates.set : prev + (updates.delta ?? 0);
      const points = clampRelationshipPoints(raw);
      const stage = computeRelationshipStage(points);

      const bond: import('@/types').SessionRelationship = {
        pairKey,
        aId,
        bId,
        points,
        lastChangedAt: Date.now(),
        lastReason: updates.reason,
      };

      // Merge the bond first, then recompute mirrors from the FULL record
      // (a character may be in several bonds — prefer the user bond).
      const newRelationships: Record<string, import('@/types').SessionRelationship> = {
        ...(sessionStats.relationships || {}),
        [pairKey]: bond,
      };

      // Mirror into both parties' attributeValues (creates CharacterSessionStats if missing)
      const characterStats: SessionStats['characterStats'] = { ...sessionStats.characterStats };
      const now = Date.now();
      for (const id of [aId, bId]) {
        if (id === '__user__') {
          const existing = characterStats[id] || { attributeValues: {}, lastUpdated: {} };
          characterStats[id] = {
            ...existing,
            attributeValues: {
              ...existing.attributeValues,
              [RELATIONSHIP_MIRROR_KEY]: points,
              [RELATIONSHIP_STAGE_KEY]: stage.label,
            },
            lastUpdated: {
              ...existing.lastUpdated,
              [RELATIONSHIP_MIRROR_KEY]: now,
              [RELATIONSHIP_STAGE_KEY]: now,
            },
          };
        } else {
          recomputeRelationshipMirror(characterStats, id, newRelationships, now);
        }
      }

      const aName = names?.aName || (state as any).characters?.find((c: any) => c.id === aId)?.name || aId;
      const bName = names?.bName || (state as any).characters?.find((c: any) => c.id === bId)?.name || (bId === '__user__' ? (get() as any).personas?.find?.((p: any) => p.isActive)?.name || 'Usuario' : bId);
      const direction = points > prev ? 'mejoró' : points < prev ? 'empeoró' : 'se mantuvo';
      const eventDesc = `La relación entre ${aName} y ${bName} ${direction}: ${stage.label} (${points}/100)${updates.reason ? ` — ${updates.reason}` : ''}`;

      let newSessionStats: SessionStats = {
        ...sessionStats,
        characterStats,
        relationships: newRelationships,
      };
      newSessionStats = appendEventLogEntry(newSessionStats, {
        type: 'relationship',
        description: eventDesc,
        characterId: aId,
        characterName: aName,
        targetName: bName,
      });

      set((state: any) => ({
        sessions: state.sessions.map((s: any) =>
          s.id === sessionId
            ? { ...s, sessionStats: newSessionStats, updatedAt: new Date().toISOString() }
            : s
        ),
      }));

      console.log(`[Relationship] ${aName} ↔ ${bName}: ${prev} → ${points} (${stage.label})`);
      return { points, stageKey: stage.key, stageLabel: stage.label, pairKey, prevPoints: prev };
    })();

    return result;
  },

  /**
   * Manually delete a bond (UI editing). Removes it from
   * sessionStats.relationships and cleans the mirror attributes
   * (`relacion`/`relacion_etapa`) from both parties' attributeValues.
   */
  removeRelationship: (sessionId, aId, bId) => {
    const state = get();
    const sessions = state.sessions as Array<{ id: string; sessionStats?: SessionStats }>;
    const session = sessions.find(s => s.id === sessionId);
    if (!session?.sessionStats) return;

    const sessionStats = session.sessionStats;
    const pairKey = relationshipPairKey(aId, bId);
    const bond = sessionStats.relationships?.[pairKey];
    if (!bond) return;

    // Remove the bond, then recompute both parties' mirrors from the
    // remaining bonds (keys are cleaned automatically when none remain).
    const relationships = { ...(sessionStats.relationships || {}) };
    delete relationships[pairKey];

    const characterStats: SessionStats['characterStats'] = { ...sessionStats.characterStats };
    const now = Date.now();
    for (const id of [bond.aId, bond.bId]) {
      recomputeRelationshipMirror(characterStats, id, relationships, now);
    }

    const newSessionStats: SessionStats = {
      ...sessionStats,
      characterStats,
      relationships,
    };

    set((state: any) => ({
      sessions: state.sessions.map((s: any) =>
        s.id === sessionId
          ? { ...s, sessionStats: newSessionStats, updatedAt: new Date().toISOString() }
          : s
      ),
    }));

    console.log(`[Relationship] Removed bond ${pairKey}`);
  },

  // ============================================
  // World Time
  // ============================================
  advanceWorldTime: (sessionId, turns = 1) => {
    const result = ((): WorldClock | null => {
      const state = get();
      const sessions = state.sessions as Array<{ id: string; sessionStats?: SessionStats }>;
      const session = sessions.find(s => s.id === sessionId);
      if (!session?.sessionStats) return null;

      const prevClock = session.sessionStats.worldClock || createDefaultWorldClock();
      if (!prevClock.enabled) return prevClock;

      // Real-time catch-up first (if enabled), then turn advance
      let nextClock = catchUpRealTime(prevClock);
      const prevMoment = computeMoment(computeHour(prevClock.totalMinutes));
      nextClock = worldAdvanceMinutes(nextClock, (turns || 1) * (prevClock.minutesPerTurn || 20));
      const nextMoment = computeMoment(computeHour(nextClock.totalMinutes));

      // Mirror into __user__ stats (single source for lorebook/sprite gating)
      const userStats = session.sessionStats.characterStats['__user__'] || { attributeValues: {}, lastUpdated: {} };
      const characterStats: SessionStats['characterStats'] = {
        ...session.sessionStats.characterStats,
        '__user__': {
          ...userStats,
          attributeValues: { ...userStats.attributeValues, ...worldClockAttributes(nextClock) },
          lastUpdated: { ...userStats.lastUpdated },
        },
      };

      let newSessionStats: SessionStats = {
        ...session.sessionStats,
        characterStats,
        worldClock: nextClock,
      };

      // Log moment transitions only (avoids event-log spam every turn)
      if (prevMoment !== nextMoment) {
        newSessionStats = appendEventLogEntry(newSessionStats, {
          type: 'custom',
          description: `El tiempo pasa: ahora es ${nextMoment} (${formatWorldClock(nextClock)})`,
        });
      }

      set((state: any) => ({
        sessions: state.sessions.map((s: any) =>
          s.id === sessionId ? { ...s, sessionStats: newSessionStats, updatedAt: new Date().toISOString() } : s
        ),
      }));

      return nextClock;
    })();

    return result;
  },

  setWorldTime: (sessionId, updates) => {
    const result = ((): WorldClock | null => {
      const state = get();
      const sessions = state.sessions as Array<{ id: string; sessionStats?: SessionStats }>;
      const session = sessions.find(s => s.id === sessionId);
      if (!session?.sessionStats) return null;

      const prevClock = session.sessionStats.worldClock || createDefaultWorldClock();
      let nextClock: WorldClock = { ...prevClock };

      if (typeof updates.minutes === 'number' && updates.minutes > 0) {
        nextClock = worldAdvanceMinutes(nextClock, updates.minutes);
      }
      if (typeof updates.hour === 'number') {
        nextClock = setToHour(nextClock, updates.hour, updates.minute ?? 0);
      }
      if (typeof updates.season === 'string' && updates.season.trim()) {
        nextClock.season = updates.season.trim().toLowerCase();
      }
      if (typeof updates.realTimeSync === 'boolean') {
        nextClock.realTimeSync = updates.realTimeSync;
        nextClock.lastRealSync = Date.now();
      }
      if (typeof updates.minutesPerTurn === 'number' && updates.minutesPerTurn > 0) {
        nextClock.minutesPerTurn = updates.minutesPerTurn;
      }
      if (typeof updates.enabled === 'boolean') {
        nextClock.enabled = updates.enabled;
      }

      const userStats = session.sessionStats.characterStats['__user__'] || { attributeValues: {}, lastUpdated: {} };
      const characterStats: SessionStats['characterStats'] = {
        ...session.sessionStats.characterStats,
        '__user__': {
          ...userStats,
          attributeValues: { ...userStats.attributeValues, ...worldClockAttributes(nextClock) },
          lastUpdated: { ...userStats.lastUpdated },
        },
      };

      let newSessionStats: SessionStats = {
        ...session.sessionStats,
        characterStats,
        worldClock: nextClock,
      };
      newSessionStats = appendEventLogEntry(newSessionStats, {
        type: 'custom',
        description: `El tiempo del mundo cambia: ${formatWorldClock(nextClock)}`,
      });

      set((state: any) => ({
        sessions: state.sessions.map((s: any) =>
          s.id === sessionId ? { ...s, sessionStats: newSessionStats, updatedAt: new Date().toISOString() } : s
        ),
      }));

      return nextClock;
    })();

    return result;
  },

  getWorldClock: (sessionId) => {
    const state = get();
    const sessions = state.sessions as Array<{ id: string; sessionStats?: SessionStats }>;
    const session = sessions.find(s => s.id === sessionId);
    return session?.sessionStats?.worldClock || null;
  },

  setThresholdMessageStates: (sessionId, states) => {
    if (!states || Object.keys(states).length === 0) return;
    set((state: any) => ({
      sessions: state.sessions.map((s: any) =>
        s.id === sessionId
          ? {
              ...s,
              sessionStats: s.sessionStats
                ? {
                    ...s.sessionStats,
                    thresholdMessageStates: {
                      ...(s.sessionStats.thresholdMessageStates || {}),
                      ...states,
                    },
                    lastModified: Date.now(),
                  }
                : s.sessionStats,
              updatedAt: new Date().toISOString(),
            }
          : s
      ),
    }));
  },

  // ============================================
  // Timer System (automatic attribute changes over time)
  // ============================================

  processTimerTicks: (sessionId, characterId, statsConfig) => {
    const state = get();
    const sessions = state.sessions as Array<{
      id: string;
      sessionStats?: SessionStats;
    }>;
    const session = sessions.find(s => s.id === sessionId);

    if (!session?.sessionStats) return null;

    // Check if timer is enabled
    if (!statsConfig.timerEnabled) return null;

    // Evaluate timer ticks
    const result = evaluateTimerTicks(statsConfig, session.sessionStats, characterId);

    if (result.updates.length === 0) {
      // No updates needed — preserve lastTimerUpdate for fractional progress
      // Only update if timer state changed (e.g., newLastTimerUpdate advanced from consumed ticks)
      const currentLastTimerUpdate = session.sessionStats.lastTimerUpdate;
      if (result.newLastTimerUpdate !== currentLastTimerUpdate) {
        set((state: any) => ({
          sessions: state.sessions.map((s: any) =>
            s.id === sessionId
              ? {
                  ...s,
                  sessionStats: {
                    ...s.sessionStats,
                    lastTimerUpdate: result.newLastTimerUpdate,
                    keywordCycleIndex: {
                      ...s.sessionStats?.keywordCycleIndex,
                      ...result.newCycleIndex,
                    },
                  },
                  updatedAt: new Date().toISOString(),
                }
              : s
          ),
        }));
      }
      return result;
    }

    // Apply all updates via batchUpdateCharacterStats
    const storeActions = {
      updateCharacterStat: get().updateCharacterStat,
    };

    // Apply each update individually to get proper clamping, logging, and threshold detection
    for (const update of result.updates) {
      storeActions.updateCharacterStat(
        sessionId,
        characterId,
        update.attributeKey,
        update.value,
        'timer'
      );
    }

    // Update timer state (lastTimerUpdate + keywordCycleIndex)
    set((state: any) => {
      const sessions = state.sessions as Array<{
        id: string;
        sessionStats?: SessionStats;
      }>;
      const session = sessions.find(s => s.id === sessionId);
      if (!session?.sessionStats) return state;

      const newSessionStats: SessionStats = {
        ...session.sessionStats,
        lastTimerUpdate: result.newLastTimerUpdate,
        keywordCycleIndex: {
          ...session.sessionStats.keywordCycleIndex,
          ...result.newCycleIndex,
        },
        lastModified: Date.now(),
      };

      return {
        sessions: state.sessions.map((s: any) =>
          s.id === sessionId
            ? {
                ...s,
                sessionStats: newSessionStats,
                updatedAt: new Date().toISOString(),
              }
            : s
        ),
      };
    });

    // Log timer results
    if (result.details.length > 0) {
      console.log(`[Timer] Processed ${result.details.length} timer updates for character ${characterId}:`);
      for (const detail of result.details) {
        console.log(`  ${detail.attributeName}: ${detail.oldValue} → ${detail.newValue} (${detail.operation})`);
      }
    }

    return result;
  },

  startSessionTimer: (sessionId, characterId, statsConfig) => {
    // First, process any accumulated ticks from offline time for this character
    get().processTimerTicks(sessionId, characterId, statsConfig);

    // Check if timer should run
    if (!hasActiveTimers(statsConfig)) {
      console.log(`[Timer] No active timers for character ${characterId}, not starting periodic timer`);
      return;
    }

    // Get tick interval from config (default 60 seconds)
    const tickSeconds = statsConfig.timerTickSeconds || 60;

    // Store timer reference
    const timerKey = `timer_${sessionId}`;
    const existingInterval = (get() as any)._timerIntervals?.[timerKey];
    if (existingInterval) {
      // Timer already running for this session - check if we need a faster interval
      const existingTickSeconds = (get() as any)._timerTickSeconds?.[timerKey] || 60;
      if (tickSeconds < existingTickSeconds) {
        // Restart with the faster interval to honor this character's requirement
        clearInterval(existingInterval);
        console.log(`[Timer] Restarting timer for session ${sessionId} with faster interval: ${existingTickSeconds}s → ${tickSeconds}s`);
      } else {
        // Existing interval is fast enough, no need to restart
        console.log(`[Timer] Timer already running for session ${sessionId} at ${existingTickSeconds}s, requested ${tickSeconds}s is slower or equal`);
        return;
      }
    }

    const intervalId = setInterval(() => {
      // Process timer ticks for ALL characters in this session that have timerEnabled
      const currentState = get();
      const currentSession = (currentState.sessions as any[])?.find((s: any) => s.id === sessionId);
      if (!currentSession) {
        get().stopSessionTimer(sessionId);
        return;
      }

      let anyTimerActive = false;

      // Collect all character IDs that have stats in this session
      const charIds = Object.keys(currentSession.sessionStats?.characterStats || {});
      for (const charId of charIds) {
        if (charId === '__user__') continue; // Skip persona
        const charStatsConfig = currentState.characters?.find((c: any) => c.id === charId)?.statsConfig;
        if (charStatsConfig?.timerEnabled && hasActiveTimers(charStatsConfig)) {
          get().processTimerTicks(sessionId, charId, charStatsConfig);
          anyTimerActive = true;
        }
      }

      // If no timers are active anymore, stop the interval
      if (!anyTimerActive) {
        console.log(`[Timer] No active timers remaining for session ${sessionId}, stopping`);
        get().stopSessionTimer(sessionId);
      }
    }, tickSeconds * 1000);

    // Store interval reference
    set((state: any) => ({
      ...state,
      _timerIntervals: {
        ...(state._timerIntervals || {}),
        [timerKey]: intervalId,
      },
      _timerTickSeconds: {
        ...(state._timerTickSeconds || {}),
        [timerKey]: tickSeconds,
      },
      _timerRunning: {
        ...(state._timerRunning || {}),
        [sessionId]: true,
      },
    }));

    console.log(`[Timer] Started session timer for ${sessionId} (tick: ${tickSeconds}s)`);
  },

  stopSessionTimer: (sessionId) => {
    const timerKey = `timer_${sessionId}`;
    const state = get();
    const intervalId = (state as any)._timerIntervals?.[timerKey];

    if (intervalId) {
      clearInterval(intervalId);
      set((state: any) => {
        const newIntervals = { ...(state._timerIntervals || {}) };
        delete newIntervals[timerKey];
        const newTickSeconds = { ...(state._timerTickSeconds || {}) };
        delete newTickSeconds[timerKey];
        const newRunning = { ...(state._timerRunning || {}) };
        delete newRunning[sessionId];
        return {
          _timerIntervals: newIntervals,
          _timerTickSeconds: newTickSeconds,
          _timerRunning: newRunning,
        };
      });
      console.log(`[Timer] Stopped session timer for ${sessionId}`);
    }
  },

  getTimerRunning: (sessionId) => {
    const state = get();
    return (state as any)._timerRunning?.[sessionId] === true;
  },

  // FASE 5: Update emotional state for a character
  updateEmotionalState: (sessionId, characterId, newState, previousState) => {
    const state = get();
    // FIX: sessions is an ARRAY — must find by id (string indexing on an
    // array always returned undefined, making this function a no-op).
    const session = state.sessions?.find(s => s.id === sessionId);
    if (!session?.sessionStats) return;

    const charStats = session.sessionStats.characterStats?.[characterId];
    if (!charStats) return;

    // If previousState is specified, only update if it matches the current state
    // This prevents race conditions in concurrent evaluations
    if (previousState && charStats.emotionalState && charStats.emotionalState !== previousState) {
      return;
    }

    const oldState = charStats.emotionalState;
    if (oldState === newState) return; // No change needed

    charStats.emotionalState = newState;
    charStats.emotionalStateLastEval = Date.now();

    // Also sync to attributeValues for {{emocion}} key resolution
    if (!charStats.attributeValues) {
      charStats.attributeValues = {};
    }
    charStats.attributeValues['emocion'] = newState;

    // Increment turn counter
    charStats.emotionalStateTurnCount = (charStats.emotionalStateTurnCount || 0) + 1;

    session.sessionStats.lastModified = Date.now();

    // FIX: spread into a NEW array. `{ ...state.sessions }` converted the
    // array into a plain object, which would break every `sessions.find()`
    // / `sessions.map()` call app-wide (including setActiveOutfit).
    set({ sessions: [...state.sessions] });

    console.log(`[Emotion] ${characterId}: "${oldState || '(none)'}" → "${newState}"`);
  },

  // FASE 5: Get emotional state for a character
  getEmotionalState: (sessionId, characterId) => {
    const state = get();
    const session = state.sessions?.[sessionId];
    if (!session?.sessionStats) return null;

    return session.sessionStats.characterStats?.[characterId]?.emotionalState || null;
  },

  // GUARDARROPA V2: Set the active outfit for a character (manage_wardrobe tool / manual override)
  setActiveOutfit: (sessionId, characterId, outfitId) => {
    const state = get();
    const sessions = state.sessions as Array<{ id: string; sessionStats?: SessionStats }>;
    const session = sessions.find(s => s.id === sessionId);
    if (!session?.sessionStats) return;

    // Ensure the character entry exists (avoid silent failures when stats
    // were never initialized for this character in the session)
    if (!session.sessionStats.characterStats) {
      session.sessionStats.characterStats = {};
    }
    if (!session.sessionStats.characterStats[characterId]) {
      session.sessionStats.characterStats[characterId] = {
        attributeValues: {},
        lastUpdated: {},
      };
    }

    const charStats = session.sessionStats.characterStats[characterId];
    const previousOutfitId = charStats.activeOutfitId ?? null;
    if (previousOutfitId === outfitId) return; // No change

    charStats.activeOutfitId = outfitId;
    session.sessionStats.lastModified = Date.now();

    set((state: any) => ({
      sessions: state.sessions.map((s: any) =>
        s.id === sessionId
          ? { ...s, sessionStats: session.sessionStats, updatedAt: new Date().toISOString() }
          : s
      ),
    }));

    console.log(`[Wardrobe] ${characterId}: outfit ${previousOutfitId ?? '(default)'} → ${outfitId ?? '(default)'}`);
  },

  // GUARDARROPA V2: Get the active outfit id for a character
  getActiveOutfitId: (sessionId, characterId) => {
    const state = get();
    // FIX: sessions is an array — find by id (string indexing returned undefined).
    const session = state.sessions?.find(s => s.id === sessionId);
    if (!session?.sessionStats) return null;
    return session.sessionStats.characterStats?.[characterId]?.activeOutfitId ?? null;
  },

  // ESCENARIO V2: Set the active scenario location (SESSION-level — shared scene)
  setActiveScenario: (sessionId, scenarioId) => {
    const state = get();
    const sessions = state.sessions as Array<{ id: string; sessionStats?: SessionStats }>;
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;

    // Ensure sessionStats exists (characters without statsConfig may have no
    // sessionStats, but the scenario location still needs to persist)
    if (!session.sessionStats) {
      session.sessionStats = {
        characterStats: {},
        solicitudes: { characterSolicitudes: {}, lastModified: Date.now() },
        initialized: false,
        lastModified: Date.now(),
      };
    }

    const previousScenarioId = session.sessionStats.activeScenarioId ?? null;
    if (previousScenarioId === scenarioId) return; // No change

    session.sessionStats.activeScenarioId = scenarioId;
    session.sessionStats.lastModified = Date.now();

    set((state: any) => ({
      sessions: state.sessions.map((s: any) =>
        s.id === sessionId
          ? { ...s, sessionStats: session.sessionStats, updatedAt: new Date().toISOString() }
          : s
      ),
    }));

    console.log(`[Scenario] Session ${sessionId.slice(0, 8)}: location ${previousScenarioId ?? '(default)'} → ${scenarioId ?? '(default)'}`);
  },

  // ESCENARIO V2: Get the active scenario location id (SESSION-level)
  getActiveScenarioId: (sessionId) => {
    const state = get();
    const session = state.sessions?.find(s => s.id === sessionId);
    if (!session?.sessionStats) return null;
    return session.sessionStats.activeScenarioId ?? null;
  },
});

// ============================================
// Utility Functions for Requirements
// ============================================

/**
 * Evaluate a single requirement against current stats
 * Supports target requirements (checking attributes of other characters or persona)
 */
export function evaluateRequirement(
  requirement: StatRequirement,
  attributeValues: Record<string, number | string>,
  sessionStats?: SessionStats | null
): boolean {
  let currentValue: number | string | undefined;

  if (requirement.targetCharacterId) {
    // Target mode - look up attribute from another character or persona
    currentValue = sessionStats?.characterStats?.[requirement.targetCharacterId]?.attributeValues?.[requirement.attributeKey];
  } else {
    // Self mode - use own attribute values
    currentValue = attributeValues[requirement.attributeKey];
  }

  if (currentValue === undefined) return false;

  const currentNum = typeof currentValue === 'number' ? currentValue : parseFloat(currentValue);
  const valueNum = typeof requirement.value === 'number' ? requirement.value : parseFloat(requirement.value);

  // String comparison for text operators
  const isTextOperator = requirement.operator === 'contains' || requirement.operator === 'not_contains';
  if (isTextOperator || isNaN(currentNum) || isNaN(valueNum)) {
    const currentStr = String(currentValue).toLowerCase();
    const valueStr = String(requirement.value).toLowerCase();

    switch (requirement.operator) {
      case '==': return currentStr === valueStr;
      case '!=': return currentStr !== valueStr;
      case 'contains': return currentStr.includes(valueStr);
      case 'not_contains': return !currentStr.includes(valueStr);
      default: return false;
    }
  }

  switch (requirement.operator) {
    case '<': return currentNum < valueNum;
    case '<=': return currentNum <= valueNum;
    case '>': return currentNum > valueNum;
    case '>=': return currentNum >= valueNum;
    case '==': return currentNum === valueNum;
    case '!=': return currentNum !== valueNum;
    case 'between': {
      const maxNum = typeof requirement.valueMax === 'number'
        ? requirement.valueMax
        : parseFloat(requirement.valueMax?.toString() || '0');
      return currentNum >= valueNum && currentNum <= maxNum;
    }
    default: return false;
  }
}

/**
 * Evaluate all requirements (supports AND and OR logic)
 * Default is AND logic for backward compatibility
 */
export function evaluateRequirements(
  requirements: StatRequirement[],
  attributeValues: Record<string, number | string>,
  sessionStats?: SessionStats | null,
  operator?: 'AND' | 'OR'
): boolean {
  if (!requirements || requirements.length === 0) return true;
  const logicFn = operator === 'OR' ? requirements.some.bind(requirements) : requirements.every.bind(requirements);
  return logicFn(req => evaluateRequirement(req, attributeValues, sessionStats));
}

/**
 * Filter skills by requirements
 */
export function filterSkillsByRequirements(
  skills: SkillDefinition[],
  attributeValues: Record<string, number | string>,
  sessionStats?: SessionStats | null
): SkillDefinition[] {
  return (skills || []).filter(skill => evaluateRequirements(skill.requirements, attributeValues, sessionStats, skill.requirementOperator));
}

/**
 * Filter intentions by requirements
 */
export function filterIntentionsByRequirements(
  intentions: IntentionDefinition[],
  attributeValues: Record<string, number | string>,
  sessionStats?: SessionStats | null
): IntentionDefinition[] {
  return (intentions || []).filter(intention => evaluateRequirements(intention.requirements, attributeValues, sessionStats, intention.requirementOperator));
}

/**
 * Filter invitations by requirements
 */
export function filterInvitationsByRequirements(
  invitations: InvitationDefinition[],
  attributeValues: Record<string, number | string>,
  sessionStats?: SessionStats | null
): InvitationDefinition[] {
  return (invitations || []).filter(invitation => evaluateRequirements(invitation.requirements, attributeValues, sessionStats, invitation.requirementOperator));
}
