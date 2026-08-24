'use client';

// ============================================
// Scene Lighting — subtle day-moment color grading
// ============================================
//
// A soft full-screen gradient veil that follows the world clock's day moment.
// Deliberately SUBTLE (max ~10-14% opacity): it tints the scene like golden
// hour / dusk / night ambience instead of a dramatic filter. Layered with
// mix-blend-mode: soft-light for natural color grading, plus a faint
// top-darkening vignette at night.

import { useMemo } from 'react';
import type { WorldClock } from '@/lib/world/time';

interface SceneLightingProps {
  worldClock?: WorldClock | null;
}

interface MomentGrading {
  /** primary tint (soft-light blend) */
  tint: string;
  /** secondary top gradient for sky feel */
  skyTop: string;
  /** overall veil opacity 0..1 */
  strength: number;
}

const GRADINGS: Record<string, MomentGrading> = {
  madrugada: {
    tint: 'linear-gradient(180deg, rgba(63,81,181,0.55) 0%, rgba(30,41,99,0.35) 100%)',
    skyTop: 'rgba(10, 15, 40, 0.30)',
    strength: 0.55,
  },
  'mañana': {
    tint: 'linear-gradient(180deg, rgba(255,214,165,0.35) 0%, rgba(255,236,210,0.18) 100%)',
    skyTop: 'rgba(255, 224, 178, 0.18)',
    strength: 0.35,
  },
  tarde: {
    tint: 'linear-gradient(180deg, rgba(255,183,77,0.30) 0%, rgba(255,152,113,0.16) 100%)',
    skyTop: 'rgba(255, 200, 130, 0.16)',
    strength: 0.30,
  },
  noche: {
    tint: 'linear-gradient(180deg, rgba(30,41,99,0.45) 0%, rgba(15,23,66,0.35) 100%)',
    skyTop: 'rgba(8, 12, 34, 0.34)',
    strength: 0.5,
  },
};

function momentFor(clock: WorldClock | null | undefined): string | null {
  if (!clock) return null;
  const hour = Math.floor((clock.totalMinutes % 1440) / 60);
  if (hour < 6) return 'madrugada';
  if (hour < 12) return 'mañana';
  if (hour < 19) return 'tarde';
  return 'noche';
}

export function SceneLighting({ worldClock }: SceneLightingProps) {
  const moment = momentFor(worldClock);
  const grading = useMemo(() => (moment ? GRADINGS[moment] : null), [moment]);

  if (!grading) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden" aria-hidden="true">
      {/* Sky/top darkening at dawn & night */}
      <div
        className="absolute inset-x-0 top-0 h-[45vh] transition-[background,opacity] duration-[2500ms]"
        style={{ background: `linear-gradient(180deg, ${grading.skyTop} 0%, transparent 100%)` }}
      />
      {/* Full-scene tint (soft-light = natural grading, not a flat filter) */}
      <div
        className="absolute inset-0 transition-opacity duration-[2500ms]"
        style={{
          background: grading.tint,
          mixBlendMode: 'soft-light',
          opacity: grading.strength,
        }}
      />
    </div>
  );
}

export default SceneLighting;
