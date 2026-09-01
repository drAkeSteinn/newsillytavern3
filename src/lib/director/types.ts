// ============================================
// Director Agent — Types
// ============================================
//
// The Director observes the session (stats, event log, group scene, message
// rhythm) and emits DECISIONS that keep the world alive between user turns:
// world events, scene rotations in groups, and tension telemetry.
//
// Architecture follows the app's server-validate / client-execute pattern:
// the route computes decisions (heuristics always, optional LLM narration),
// the CLIENT applies them through existing primitives (pushSessionEvent,
// applySceneChange, toasts).

import type { SessionStats } from '@/types';
import type { ToolExecutionResult } from '@/lib/tools/types';

/** Settings persisted in AppSettings.director */
export interface DirectorSettings {
  /** Master switch (default: true) */
  enabled: boolean;
  /** 'heuristic' = deterministic only (no LLM cost); 'llm' = heuristics + LLM narration */
  mode: 'heuristic' | 'llm';
  /** Minimum minutes between director runs */
  minIntervalMinutes: number;
  /** Max world events emitted per run (default 1) */
  maxWorldEventsPerRun: number;
}

export const DEFAULT_DIRECTOR_SETTINGS: DirectorSettings = {
  enabled: true,
  mode: 'heuristic',
  minIntervalMinutes: 3,
  maxWorldEventsPerRun: 1,
};

/** Compact session snapshot sent to the director route */
export interface DirectorSnapshot {
  sessionId: string;
  /** Main character id (1-on-1) */
  characterId?: string;
  characterNames: Record<string, string>;
  /** Group context (group chats) */
  groupId?: string;
  groupMembers?: Array<{
    characterId: string;
    name: string;
    isActive: boolean;
    isPresent: boolean;
    isNarrator: boolean;
  }>;
  sessionStats?: SessionStats;
  /** Last few messages (already truncated) for rhythm + tone sensing */
  recentMessages?: Array<{
    role: 'user' | 'assistant';
    characterName?: string;
    content: string;
    timestamp?: string;
  }>;
  turnCount?: number;
}

/** Decision types the client can apply */
export type DirectorDecision =
  | {
      type: 'world_event';
      description: string;
      severity: 'minor' | 'major';
    }
  | {
      type: 'scene_change';
      characterId: string;
      characterName: string;
      /** true = bring INTO the scene, false = take OUT of the scene */
      present: boolean;
      reason: string;
    }
  | {
      type: 'tension_shift';
      from: number;
      to: number;
      pacing: DirectorPacing;
    };

export type DirectorPacing = 'calm' | 'building' | 'intense' | 'cooldown';

export interface DirectorResult {
  tension: number; // 0-100
  pacing: DirectorPacing;
  decisions: DirectorDecision[];
  source: 'heuristic' | 'hybrid';
  /** Tool execution results from the Director's LLM call (modify_stat, manage_scene, etc.)
   *  The client applies these through existing store primitives. */
  toolResults?: ToolExecutionResult[];
}
