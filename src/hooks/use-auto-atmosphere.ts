'use client';

// ============================================
// Auto Atmosphere — real-time → atmosphere preset
// ============================================
//
// OPT-IN feature: when enabled (localStorage flag), the app reads the REAL
// system time and applies the matching atmosphere preset whenever the
// day-moment changes (madrugada/mañana/tarde/noche).
//
// The effect runs:
//   1. On mount (initial scene setup).
//   2. After each assistant reply (so the atmosphere follows real time as
//      a conversation unfolds, e.g. transitioning from "tarde" to "noche"
//      when the real clock crosses 19:00).
//
// There is no fictional "world clock" anymore — the app uses `new Date()`.
//
// Mapping (uses the app's default presets):
//   madrugada (00:00–05:59) → cozy-fire    (warm embers in the dark)
//   mañana    (06:00–11:59) → clear        (clean daylight)
//   tarde     (12:00–18:59) → autumn-day   (warm afternoon light)
//   noche     (19:00–23:59) → summer-night (soft night ambiance)

import { useEffect, useRef } from 'react';
import { useTavernStore } from '@/store';

const STORAGE_KEY = 'tavernflow-auto-atmosphere';

const MOMENT_TO_PRESET: Record<string, string> = {
  madrugada: 'cozy-fire',
  mañana: 'clear',
  tarde: 'autumn-day',
  noche: 'summer-night',
};

export function isAutoAtmosphereEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setAutoAtmosphereEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // ignore storage errors
  }
}

/** Derives the day-moment label from the REAL system clock. */
export function momentFromRealTime(): string {
  const hour = new Date().getHours();
  if (hour < 6) return 'madrugada';
  if (hour < 12) return 'mañana';
  if (hour < 19) return 'tarde';
  return 'noche';
}

/** Maps a day-moment label to its atmosphere preset id. */
export function presetForMoment(moment: string): string | undefined {
  return MOMENT_TO_PRESET[moment];
}

/**
 * Watches the REAL system time and applies atmosphere presets on moment
 * changes. The effect re-runs whenever `triggerKey` changes — pass the id
 * (or timestamp) of the latest assistant message so the atmosphere refreshes
 * after each LLM reply.
 */
export function useAutoAtmosphere(triggerKey?: string | number | null) {
  const activateAtmospherePreset = useTavernStore((state) => state.activateAtmospherePreset);
  const lastMomentRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isAutoAtmosphereEnabled()) return;

    const moment = momentFromRealTime();
    if (moment === lastMomentRef.current) return;

    lastMomentRef.current = moment;
    const presetId = MOMENT_TO_PRESET[moment];
    if (presetId) {
      console.log(`[AutoAtmosphere] Momento real "${moment}" → preset "${presetId}"`);
      activateAtmospherePreset(presetId);
    }
    // deps: the trigger key (so the effect re-runs after each assistant reply)
    // plus a periodic re-check every 5 minutes in case a long conversation
    // spans a moment boundary without a new reply.
  }, [triggerKey, activateAtmospherePreset]);

  // Periodic re-check: covers long pauses where no new messages arrive but
  // the real clock crossed a moment boundary (e.g. user leaves the tab open
  // and the sun sets). Runs every 5 minutes.
  useEffect(() => {
    if (!isAutoAtmosphereEnabled()) return;
    const interval = setInterval(() => {
      const moment = momentFromRealTime();
      if (moment !== lastMomentRef.current) {
        lastMomentRef.current = moment;
        const presetId = MOMENT_TO_PRESET[moment];
        if (presetId) {
          console.log(`[AutoAtmosphere] (poll) Momento real "${moment}" → preset "${presetId}"`);
          activateAtmospherePreset(presetId);
        }
      }
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [activateAtmospherePreset]);
}
