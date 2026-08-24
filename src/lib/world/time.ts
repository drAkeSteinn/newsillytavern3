// ============================================
// World Time — pure helpers
// ============================================
//
// The WorldClock advances the fictional time of a session:
//   - +minutesPerTurn on every USER turn (turn-based, like a tabletop RPG)
//   - optional real-time catch-up (1 real minute = 1 world minute) for idle life
//
// Derived values are MIRRORED into characterStats['__user__'].attributeValues:
//   hora (number 0-23), minuto (0-59), momento_del_dia (keyword),
//   dia (number), estacion (keyword)
// so lorebook attribute entries / sprite conditions can gate on them
// (e.g. characterId '__user__', attributeKey 'hora', condition '>= 22').

export type DayMoment = 'madrugada' | 'mañana' | 'tarde' | 'noche';

export interface WorldClock {
  enabled: boolean;
  /** Total minutes since Day 1 00:00 */
  totalMinutes: number;
  /** World minutes advanced per user turn (default 20) */
  minutesPerTurn: number;
  /** Advance with real time while away (1:1) */
  realTimeSync: boolean;
  /** Timestamp of last real-time catch-up */
  lastRealSync?: number;
  /** Season label (free keyword) */
  season?: string;
  lastAdvancedAt?: number;
}

export const DEFAULT_MINUTES_PER_TURN = 20;
export const DEFAULT_SEASON = 'primavera';

export function createDefaultWorldClock(): WorldClock {
  // Sessions start at 20:00 (evening) — most RP starts at night
  return {
    enabled: true,
    totalMinutes: 20 * 60,
    minutesPerTurn: DEFAULT_MINUTES_PER_TURN,
    realTimeSync: false,
    season: DEFAULT_SEASON,
    lastAdvancedAt: Date.now(),
  };
}

export function computeHour(totalMinutes: number): number {
  return Math.floor((totalMinutes % 1440) / 60);
}

export function computeMinute(totalMinutes: number): number {
  return totalMinutes % 60;
}

export function computeDay(totalMinutes: number): number {
  return Math.floor(totalMinutes / 1440) + 1;
}

export function computeMoment(hour: number): DayMoment {
  if (hour < 6) return 'madrugada';
  if (hour < 12) return 'mañana';
  if (hour < 19) return 'tarde';
  return 'noche';
}

export function formatHour(totalMinutes: number): string {
  const h = computeHour(totalMinutes);
  const m = computeMinute(totalMinutes);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatWorldClock(clock: WorldClock): string {
  return `Día ${computeDay(clock.totalMinutes)} — ${formatHour(clock.totalMinutes)} (${computeMoment(computeHour(clock.totalMinutes))}${clock.season ? `, ${clock.season}` : ''})`;
}

/** Advance by N minutes (pure) */
export function advanceMinutes(clock: WorldClock, minutes: number): WorldClock {
  if (!Number.isFinite(minutes) || minutes <= 0) return clock;
  return {
    ...clock,
    totalMinutes: Math.max(0, clock.totalMinutes + Math.round(minutes)),
    lastAdvancedAt: Date.now(),
  };
}

/** Real-time catch-up (only when realTimeSync enabled). Caps at 12h to avoid runaway */
export function catchUpRealTime(clock: WorldClock): WorldClock {
  if (!clock.realTimeSync || !clock.lastRealSync) return clock;
  const elapsedMin = (Date.now() - clock.lastRealSync) / 60000;
  if (!Number.isFinite(elapsedMin) || elapsedMin <= 0) return clock;
  return advanceMinutes({ ...clock, lastRealSync: Date.now() }, Math.min(elapsedMin, 12 * 60));
}

/** Set clock to a specific hour:minute today (or add a day if before current time → next occurrence) */
export function setToHour(clock: WorldClock, hour: number, minute = 0): WorldClock {
  const h = Math.min(23, Math.max(0, Math.round(hour)));
  const m = Math.min(59, Math.max(0, Math.round(minute)));
  const target = (computeDay(clock.totalMinutes) - 1) * 1440 + h * 60 + m; // today at h:m
  const next = target > clock.totalMinutes ? target : target + 1440; // next occurrence
  return { ...clock, totalMinutes: next, lastAdvancedAt: Date.now() };
}

/**
 * Derive the attribute mirror map for characterStats['__user__'].
 * Numeric `hora` enables lorebook conditions like '>= 22'.
 */
export function worldClockAttributes(clock: WorldClock): Record<string, number | string> {
  const hour = computeHour(clock.totalMinutes);
  return {
    hora: hour,
    minuto: computeMinute(clock.totalMinutes),
    momento_del_dia: computeMoment(hour),
    dia: computeDay(clock.totalMinutes),
    estacion: clock.season || DEFAULT_SEASON,
  };
}
