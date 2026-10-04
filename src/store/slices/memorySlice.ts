// ============================================
// Memory & Summary Slice - State management for conversation summaries
// ============================================
// NOTE (Memory V2): CharacterMemory (events/relationships/notes) was removed.
// Character memories live exclusively in the Memory V2 unified store
// (src/lib/memory/v2, data/memory-v2-fallback.json / LanceDB memories_v2).
// This slice now only handles session SUMMARIES (context compression).

import type { StateCreator } from 'zustand';
import {
  DEFAULT_SUMMARY_SETTINGS,
  type SummaryData,
  type SummarySettings,
} from '@/types';

// Re-export for convenience
export { DEFAULT_SUMMARY_SETTINGS };

// ============================================
// Session Summary Tracking (per session)
// ============================================

export interface SessionSummaryTracking {
  sessionId: string;
  messagesSinceLastSummary: number;
  lastSummaryMessageIndex: number;
  isGroupChat: boolean;
}

// ============================================
// Slice Type
// ============================================

export interface MemorySlice {
  // Summary State
  summaries: SummaryData[];
  summarySettings: SummarySettings;
  isGeneratingSummary: boolean;
  lastSummaryError: string | null;

  // Session tracking for summaries
  sessionTracking: Record<string, SessionSummaryTracking>;

  // Summary Actions
  addSummary: (summary: SummaryData) => void;
  updateSummary: (id: string, updates: Partial<SummaryData>) => void;
  deleteSummary: (id: string) => void;
  clearSummaries: () => void;
  getSessionSummaries: (sessionId: string) => SummaryData[];

  // Summary Settings Actions
  setSummarySettings: (settings: Partial<SummarySettings>) => void;
  setGeneratingSummary: (generating: boolean) => void;
  setSummaryError: (error: string | null) => void;

  // Session Tracking Actions
  incrementMessageCount: (sessionId: string, isGroupChat: boolean) => void;
  resetMessageCount: (sessionId: string) => void;
  shouldGenerateSummary: (sessionId: string) => boolean;
  getSessionTracking: (sessionId: string) => SessionSummaryTracking | undefined;
  initSessionTracking: (sessionId: string, isGroupChat: boolean) => void;
}

// ============================================
// Slice Creator
// ============================================

export const createMemorySlice: StateCreator<MemorySlice, [], [], MemorySlice> = (set, get) => ({
  // Initial State
  summaries: [],
  summarySettings: DEFAULT_SUMMARY_SETTINGS,
  isGeneratingSummary: false,
  lastSummaryError: null,
  sessionTracking: {},

  // Summary Actions
  addSummary: (summary) => set((state) => ({
    summaries: [...state.summaries, summary]
  })),

  updateSummary: (id, updates) => set((state) => ({
    summaries: state.summaries.map(s =>
      s.id === id ? { ...s, ...updates } : s
    )
  })),

  deleteSummary: (id) => set((state) => ({
    summaries: state.summaries.filter(s => s.id !== id)
  })),

  clearSummaries: () => set({ summaries: [] }),

  getSessionSummaries: (sessionId) => {
    return get().summaries.filter(s => s.sessionId === sessionId);
  },

  // Summary Settings Actions
  setSummarySettings: (settings) => set((state) => ({
    summarySettings: { ...state.summarySettings, ...settings }
  })),

  setGeneratingSummary: (generating) => set({ isGeneratingSummary: generating }),

  setSummaryError: (error) => set({ lastSummaryError: error }),

  // Session Tracking Actions
  initSessionTracking: (sessionId, isGroupChat) => set((state) => {
    if (state.sessionTracking[sessionId]) return state;
    return {
      sessionTracking: {
        ...state.sessionTracking,
        [sessionId]: {
          sessionId,
          messagesSinceLastSummary: 0,
          lastSummaryMessageIndex: 0,
          isGroupChat,
        }
      }
    };
  }),

  incrementMessageCount: (sessionId, isGroupChat) => set((state) => {
    const tracking = state.sessionTracking[sessionId];
    if (!tracking) {
      // Initialize if not exists
      return {
        sessionTracking: {
          ...state.sessionTracking,
          [sessionId]: {
            sessionId,
            messagesSinceLastSummary: 1,
            lastSummaryMessageIndex: 0,
            isGroupChat,
          }
        }
      };
    }

    return {
      sessionTracking: {
        ...state.sessionTracking,
        [sessionId]: {
          ...tracking,
          messagesSinceLastSummary: tracking.messagesSinceLastSummary + 1,
          isGroupChat,
        }
      }
    };
  }),

  resetMessageCount: (sessionId) => set((state) => {
    const tracking = state.sessionTracking[sessionId];
    if (!tracking) return state;

    return {
      sessionTracking: {
        ...state.sessionTracking,
        [sessionId]: {
          ...tracking,
          messagesSinceLastSummary: 0,
        }
      }
    };
  }),

  shouldGenerateSummary: (sessionId) => {
    const state = get();
    const tracking = state.sessionTracking[sessionId];
    const settings = state.summarySettings;

    if (!settings.enabled || !settings.autoSummarize) return false;
    if (!tracking) return false;

    const threshold = tracking.isGroupChat
      ? settings.groupChatInterval
      : settings.normalChatInterval;

    return tracking.messagesSinceLastSummary >= threshold;
  },

  getSessionTracking: (sessionId) => {
    return get().sessionTracking[sessionId];
  },
});
