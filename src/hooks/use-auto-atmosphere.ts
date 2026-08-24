'use client';

// ============================================
// Auto Atmosphere — day-moment → atmosphere preset
// ============================================
//
// OPT-IN feature: when enabled (localStorage flag), every time the world
// clock's day-moment changes (madrugada/mañana/tarde/noche), the matching
// atmosphere preset is applied so the scene lighting follows the story time.
//
// Mapping (uses the app's default presets):
//   madrugada → cozy-fire    (warm embers in the dark)
//   mañana    → clear        (clean daylight)
//   tarde     → autumn-day   (warm afternoon light)
//   noche     → summer-night (soft night ambiance)

import { useEffect, useRef } from 'react';
import { useTavernStore } from '@/store';
import type { WorldClock } from '@/lib/world/time';

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

/** Extracts the day-moment label from a formatted clock string */
function momentFromClock(clock: WorldClock | null | undefined): string | null {
  if (!clock) return null;
  const hour = Math.floor((clock.totalMinutes % 1440) / 60);
  if (hour < 6) return 'madrugada';
  if (hour < 12) return 'mañana';
  if (hour < 19) return 'tarde';
  return 'noche';
}

/**
 * Watches the world clock and applies atmosphere presets on moment changes.
 * Mount once in the chat panel.
 */
export function useAutoAtmosphere(worldClock: WorldClock | null | undefined) {
  const activateAtmospherePreset = useTavernStore((state) => state.activateAtmospherePreset);
  const lastMomentRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isAutoAtmosphereEnabled()) return;

    const moment = momentFromClock(worldClock ?? null);
    if (!moment || moment === lastMomentRef.current) return;

    lastMomentRef.current = moment;
    const presetId = MOMENT_TO_PRESET[moment];
    if (presetId) {
      console.log(`[AutoAtmosphere] Momento "${moment}" → preset "${presetId}"`);
      activateAtmospherePreset(presetId);
    }
  }, [worldClock, activateAtmospherePreset]);
}
