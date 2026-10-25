// ============================================
// Tool System Types
// ============================================
//
// Defines all types for the tool/action system.
// Tools allow LLM characters to perform actions
// (roll dice, search memory, get weather, etc.)
// during chat responses.

import type { SessionQuestInstance, QuestTemplate, CharacterStatsConfig, SessionStats, ActivationCost, QuestReward, SkillDefinition, CharacterCard, SolicitudInstance, GroupMember } from '@/types';

// ============================================
// Tool Definition
// ============================================

/** Parameter definition using a simplified JSON Schema */
export interface ToolParameterDef {
  type: 'string' | 'number' | 'boolean' | 'enum';
  description: string;
  enum?: string[];
  default?: unknown;
  required: boolean;
}

/** Schema for tool parameters (OpenAI-compatible JSON Schema subset) */
export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, ToolParameterDef>;
  required: string[];
}

/** Tool category */
export type ToolCategory = 'in_character' | 'cognitive' | 'real_world' | 'system';

/** Permission mode for tool execution */
export type ToolPermissionMode = 'auto' | 'ask';

/** Full definition of a tool (what the LLM sees) */
export interface ToolDefinition {
  id: string;
  name: string;
  label: string;
  icon: string;
  description: string;
  category: ToolCategory;
  parameters: ToolParameterSchema;
  permissionMode: ToolPermissionMode;
}

// ============================================
// Tool Execution
// ============================================

/** Context provided to tool executors */
export interface ToolContext {
  characterId: string;
  characterName: string;
  sessionId: string;
  groupId?: string;
  userName: string;
  /** Quest data for quest-related tools */
  sessionQuests?: SessionQuestInstance[];
  questTemplates?: QuestTemplate[];
  /** Stats data for action/skill-related tools */
  statsConfig?: CharacterStatsConfig;
  sessionStats?: SessionStats;
  /** All characters for resolving invitations/solicitudes across characters */
  allCharacters?: CharacterCard[];
  /** Lorebooks for resolving {{key}} in action descriptions and completion descriptions */
  lorebooks?: import('@/types').Lorebook[];
  /** Group members with presence state (for manage_scene, group chats only) */
  groupMembers?: GroupMember[];
  /** The active character card (for wardrobe tool — needs wardrobeConfig + main attribute) */
  character?: CharacterCard;
  /** The group (ESCENARIO V2: when set, manage_escenario uses the GROUP's
   *  scenarioConfig — shared scene — instead of the character's own). */
  group?: import('@/types').CharacterGroup | null;
  /** ESCENARIO V3: App-level scenario library (ScenarioDefinition collections).
   *  Sent by the client in the chat request body; manage_escenario uses the
   *  collections referenced by character.scenarioIds / group.scenarioIds. */
  scenarios?: import('@/types').ScenarioDefinition[];
}

/** Activation payload emitted when a tool changes one attribute */
export interface StatActivation {
  characterId: string;
  attributeKey: string;
  attributeName: string;
  attributeType: 'number' | 'keyword' | 'text';
  oldValue: number | string | undefined;
  newValue: number | string;
  reason: string;
  /**
   * Operation the server performed to reach newValue:
   *  '+' → delta ADDED to oldValue · '-' → delta SUBTRACTED from oldValue
   *  '=' → explicit absolute set (parser "=50" or bare numeric)
   *  'set' → keyword/text assignment (non-numeric)
   * The client uses this to REPLAY the operation as a delta on ITS current
   * value, so skill costs (applied client-side) and tool changes (computed
   * server-side from the request snapshot) ACCUMULATE instead of cancelling
   * each other when both touch the same attribute in the same turn.
   */
  operator?: '+' | '-' | '=' | 'set';
  /** Signed magnitude for operator '+'/'-' (always positive; sign comes from operator) */
  delta?: number;
  /** Present when the change could not be applied (unknown stat, bad value, ...) */
  failed?: boolean;
  errorMessage?: string;
}

/** Result from tool execution */
export interface ToolExecutionResult {
  success: boolean;
  toolName: string;
  result: unknown;
  displayMessage: string;
  duration?: number;
  error?: string;
  /** Special result for quest-related tools */
  questActivation?: {
    /** Type of quest activation */
    type: 'activate_quest' | 'complete_objective' | 'progress_objective';
    /** The key/target for the activation (quest name, objective key, etc.) */
    key: string;
    /** Additional metadata */
    metadata?: Record<string, unknown>;
  };
  /** Special result for action/skill activation tools */
  actionActivation?: {
    skillId: string;
    skillName: string;
    skillDescription?: string;
    skillCompletedDescription?: string;
    activationCosts: ActivationCost[];
    activationRewards: QuestReward[];
    characterId: string;
  };
  /** Special result for solicitud activation/completion tools */
  solicitudActivation?: {
    type: 'create_solicitud' | 'complete_solicitud';
    solicitudKey: string;
    targetCharacterId?: string;
    targetCharacterName?: string;
    fromCharacterId: string;
    fromCharacterName: string;
    description?: string;
    peticionKey?: string;
  };
  /** Special result for stat modification tools — syncs to client-side store */
  statActivation?: StatActivation;
  /** ALL stat changes from a batch modify_stat call (one SSE per change) */
  statActivations?: StatActivation[];
  /** Special result for scene management tools (group chats) — synced to client group store */
  sceneActivation?: {
    /** 'scene_change' mutates isPresent; 'scene_focus' only logs a narrative event */
    type: 'scene_change' | 'scene_focus';
    /** enter | leave (for scene_change) */
    action: 'enter' | 'leave' | 'focus';
    /** Character that enters/leaves the scene */
    characterId: string;
    characterName: string;
    /** Character that triggered the change (the speaker) */
    byCharacterId: string;
    byCharacterName: string;
    /** New presence state (for scene_change) */
    present: boolean;
    /** Optional narrative for the scene change */
    narrative?: string;
  };
  /** Special result for relationship tools — synced to client statsSlice.updateRelationship */
  relationshipActivation?: {
    aId: string;
    aName: string;
    bId: string;
    bName: string;
    prevPoints: number;
    newPoints: number;
    reason: string;
  };
  /** Special result for world-time tools — client applies via setWorldTime/advanceWorldTime */
  timeActivation?: {
    type: 'advance' | 'set_hour' | 'set_season';
    minutes?: number;
    hour?: number;
    minute?: number;
    season?: string;
  };
  /** Special result for skill_check tools — client logs event + toast */
  checkActivation?: {
    characterId: string;
    characterName: string;
    statName: string;
    statValue: number | null;
    roll: number;
    modifier: number;
    dc: number;
    total: number;
    outcome: 'critical_success' | 'success' | 'partial' | 'failure' | 'critical_failure';
    outcomeLabel: string;
    narrative: string;
  };
  /** Special result for wardrobe tools — syncs to client-side session stats activeOutfitId */
  wardrobeActivation?: {
    characterId: string;
    /** Action taken: list (info only), wear (put on outfit), remove (back to default), get_info */
    action: 'list' | 'wear' | 'remove' | 'get_info';
    /** The outfit now being worn (null after remove → falls back to default) */
    outfitId: string | null;
    /** Name of the outfit after the action (for toast / UI display) */
    outfitName: string;
    /** Full description of the outfit after the action */
    outfitDescription: string;
    /** Outfit that was worn before the action (null if none/default) */
    previousOutfitId?: string | null;
    /** Whether the action actually changed the worn outfit */
    changed: boolean;
    /** Reason for the change (narrative) */
    reason?: string;
  };
  /** Special result for scenario tools — syncs to client-side session stats activeScenarioId (SESSION-level) */
  scenarioActivation?: {
    characterId: string;
    /** Action taken: list (info only), go (move the scene), get_info */
    action: 'list' | 'go' | 'get_info';
    /** The place-or-spot id now active (null = follow default) */
    locationId: string | null;
    /** Name of the location after the action (for toast / UI display) */
    locationName: string;
    /** Full description of the location after the action */
    locationDescription: string;
    /** Location the scene was in before the action (null if none/default) */
    previousLocationId?: string | null;
    /** Whether the action actually changed the active location */
    changed: boolean;
    /** Reason for the change (narrative) */
    reason?: string;
    /** ESCENARIO V3: id of the ScenarioDefinition (collection) the scene is now in. */
    collectionId?: string | null;
    /** Name of the ScenarioDefinition (collection) the scene is now in. */
    collectionName?: string;
    /** Background resolved for the new location (spot → place → scenario default). */
    backgroundUrl?: string | null;
    /** Sprite pose saved for the new location (applied by the client to the sprite). */
    spritePose?: { x: number; y: number; width: number; height: number; opacity: number } | null;
  };
}

/** Parsed tool call from LLM output */
export interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
  raw: string;
}

// ============================================
// Tool Settings (persisted in store)
// ============================================

/** Settings for a single tool */
export interface ToolSetting {
  toolId: string;
  enabled: boolean;
}

/** Per-character tool configuration */
export interface CharacterToolConfig {
  characterId: string;
  enabledTools: string[];  // Tool IDs that are enabled for this character
}

/** Global tools settings */
export interface ToolsSettings {
  /** Master switch for the entire tool system */
  enabled: boolean;
  /** Maximum tool calls per turn (default: 4) */
  maxToolCallsPerTurn: number;
  /** Per-character tool configs */
  characterConfigs: CharacterToolConfig[];
}

export const DEFAULT_TOOLS_SETTINGS: ToolsSettings = {
  enabled: true,
  maxToolCallsPerTurn: 4,
  characterConfigs: [],
};

// ============================================
// SSE Event Types (sent to client)
// ============================================

export interface ToolCallStartEvent {
  type: 'tool_call_start';
  toolName: string;
  toolLabel: string;
  toolIcon: string;
  params: Record<string, unknown>;
}

export interface ToolCallResultEvent {
  type: 'tool_call_result';
  toolName: string;
  success: boolean;
  displayMessage: string;
  duration: number;
}

export interface ToolCallErrorEvent {
  type: 'tool_call_error';
  toolName: string;
  error: string;
}
