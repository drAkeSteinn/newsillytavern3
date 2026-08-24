'use client';

// ============================================
// Director Agent — Client Hook
// ============================================
//
// Watches the active session and periodically runs the Director:
//  - After a turn completes (message count change + debounce)
//  - While idle (every checkInterval, respecting minIntervalMinutes)
//
// Applies decisions through existing store primitives:
//  - world_event  → pushSessionEvent (all characters see it via {{eventos}})
//  - scene_change → applySceneChange (groups) + event log + toast
//  - tension_shift → console telemetry only (future HUD indicator)

import { useEffect, useRef, useCallback } from 'react';
import { useTavernStore } from '@/store';
import type { DirectorResult, DirectorSnapshot, DirectorSettings } from '@/lib/director/types';
import { DEFAULT_DIRECTOR_SETTINGS } from '@/lib/director/types';

const POST_TURN_DEBOUNCE_MS = 8000;   // wait after a turn before directing
const CHECK_INTERVAL_MS = 60 * 1000;  // idle check cadence

export function useDirector(activeSessionId: string | null | undefined) {
  const lastRunRef = useRef<number>(0);
  const lastMessageCountRef = useRef<number>(-1);
  const runningRef = useRef<boolean>(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runDirector = useCallback(async (sessionId: string) => {
    if (runningRef.current) return;
    const store = useTavernStore.getState();

    const settings: DirectorSettings = {
      ...DEFAULT_DIRECTOR_SETTINGS,
      ...((store.settings as Record<string, unknown>)?.director as DirectorSettings | undefined || {}),
    };
    if (!settings.enabled) return;
    if (Date.now() - lastRunRef.current < settings.minIntervalMinutes * 60 * 1000) return;

    runningRef.current = true;
    try {
      const session = (store.sessions as Array<Record<string, unknown>>)?.find(s => s.id === sessionId);
      if (!session) return;

      // Build snapshot
      const characterNames: Record<string, string> = {};
      const groupId = session.groupId as string | undefined;

      let groupMembers: DirectorSnapshot['groupMembers'];
      if (groupId) {
        const group = store.getGroupById?.(groupId);
        if (!group) return;
        groupMembers = (group.members || []).map(m => {
          const char = (store.characters as Array<{ id: string; name: string }>)?.find(c => c.id === m.characterId);
          const name = char?.name || m.characterId;
          characterNames[m.characterId] = name;
          return {
            characterId: m.characterId,
            name,
            isActive: m.isActive !== false,
            isPresent: m.isPresent !== false,
            isNarrator: !!m.isNarrator,
          };
        });
      } else {
        const charId = session.characterId as string | undefined;
        if (!charId) return;
        const char = (store.characters as Array<{ id: string; name: string }>)?.find(c => c.id === charId);
        if (!char) return;
        characterNames[charId] = char.name;
      }

      const messages = ((session.messages as Array<Record<string, unknown>>) || [])
        .filter(m => !m.isDeleted)
        .slice(-5)
        .map(m => ({
          role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
          characterName: m.characterName as string | undefined,
          content: String(m.content || '').slice(0, 200),
          timestamp: m.timestamp as string | undefined,
        }));

      const snapshot: DirectorSnapshot = {
        sessionId,
        characterNames,
        groupId,
        groupMembers,
        sessionStats: session.sessionStats as DirectorSnapshot['sessionStats'],
        recentMessages: messages,
        turnCount: messages.filter(m => m.role === 'user').length,
      };

      // Send active LLM config only when the director runs in LLM mode
      const llmConfigs = (store as unknown as { llmConfigs?: Array<{ id: string; isActive?: boolean }> }).llmConfigs;
      const activeLlm = (llmConfigs || []).find(c => c.isActive) || (llmConfigs || [])[0];
      const llmSettings = (store.settings as { llm?: { activeConfigId?: string } }) || {};
      const activeId = llmSettings.llm?.activeConfigId || activeLlm?.id;
      const llmConfig = (llmConfigs || []).find(c => c.id === activeId);

      const res = await fetch('/api/chat/director', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshot,
          settings,
          llmConfig: settings.mode === 'llm' ? llmConfig : undefined,
        }),
      });
      if (!res.ok) {
        console.warn('[Director] Route returned', res.status);
        return;
      }

      const result: DirectorResult = await res.json();
      lastRunRef.current = Date.now();

      // ── Apply decisions ──
      const { toast } = await import('sonner');
      for (const decision of result.decisions) {
        if (decision.type === 'world_event') {
          store.pushSessionEvent?.(sessionId, {
            type: 'custom',
            description: `[DIRECTOR] ${decision.description.replace(/\{\{user\}\}/gi, (store.personas as Array<{ isActive: boolean; name: string }> | undefined)?.find(p => p.isActive)?.name || 'Usuario')}`,
          });
          if (decision.severity === 'major') {
            toast.info(`🎬 Director: ${decision.description.slice(0, 80)}${decision.description.length > 80 ? '…' : ''}`);
          }
          console.log(`[Director] world_event (${decision.severity}):`, decision.description.slice(0, 60));
        } else if (decision.type === 'scene_change' && groupId) {
          store.applySceneChange?.(groupId, decision.characterId, decision.present);
          store.pushSessionEvent?.(sessionId, {
            type: decision.present ? 'scene_enter' : 'scene_leave',
            description: decision.reason,
            characterId: decision.characterId,
            characterName: decision.characterName,
          });
          const icon = decision.present ? '🚪➡️' : '🚪⬅️';
          toast.success(`${icon} Director: ${decision.characterName} ${decision.present ? 'entró a' : 'salió de'} la escena`);
          console.log(`[Director] scene_change: ${decision.characterName} present=${decision.present}`);
        } else if (decision.type === 'tension_shift') {
          console.log(`[Director] tension=${decision.to} pacing=${decision.pacing}`);
        }
      }
    } catch (err) {
      console.warn('[Director] Run failed:', err);
    } finally {
      runningRef.current = false;
    }
  }, []);

  // ── Post-turn trigger: watch message count of the active session ──
  useEffect(() => {
    if (!activeSessionId) return;
    const unsub = useTavernStore.subscribe((state) => {
      const settings = { ...DEFAULT_DIRECTOR_SETTINGS, ...((state.settings as Record<string, unknown>)?.director as DirectorSettings | undefined || {}) };
      if (!settings.enabled) return;
      if (state.ui?.isGenerating) return; // never direct mid-generation

      const session = (state.sessions as Array<Record<string, unknown>>)?.find(s => s.id === activeSessionId);
      if (!session) return;
      const count = ((session.messages as unknown[]) || []).filter((m) => !(m as Record<string, unknown>).isDeleted).length;

      if (lastMessageCountRef.current !== -1 && count > lastMessageCountRef.current) {
        // A turn just completed — schedule a director run
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
          runDirector(activeSessionId).catch(() => {});
        }, POST_TURN_DEBOUNCE_MS);
      }
      lastMessageCountRef.current = count;
    });

    return () => {
      unsub();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [activeSessionId, runDirector]);

  // ── Idle cadence: run every CHECK_INTERVAL if enough time passed ──
  useEffect(() => {
    if (!activeSessionId) return;
    const interval = setInterval(() => {
      const state = useTavernStore.getState();
      const settings = { ...DEFAULT_DIRECTOR_SETTINGS, ...((state.settings as Record<string, unknown>)?.director as DirectorSettings | undefined || {}) };
      if (!settings.enabled) return;
      if (state.ui?.isGenerating) return;
      runDirector(activeSessionId).catch(() => {});
    }, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [activeSessionId, runDirector]);

  /** Manual trigger (testing / "Force director" button) */
  const triggerNow = useCallback(() => {
    if (!activeSessionId) return;
    lastRunRef.current = 0; // bypass minInterval for manual runs
    return runDirector(activeSessionId);
  }, [activeSessionId, runDirector]);

  return { triggerNow };
}
