// ============================================
// Client-side stat activation applier (delta-aware)
// ============================================
// The server computes modify_stat changes against its request-start snapshot
// and emits `stat_activation` SSE events. Meanwhile, skill/action costs
// (activateSkillByTool) are applied CLIENT-side as deltas on the live store.
//
// If the client applied the server's `newValue` as an ABSOLUTE set (old
// behavior), whichever writer ran last silently CANCELLED the other's effect
// (e.g. skill cost energia -10 + tool -5 → ended at -5 or -10, never -15).
//
// This helper replays the operation using the operator/delta metadata that
// now travels inside every stat_activation:
//   operator '+'/'-'  → current(client) ± delta  → ACCUMULATES with skills
//   operator '='/'set' or missing metadata → absolute set (backward compat)
//
// updateCharacterStat() clamps to the attribute's min/max internally, so we
// only need to compute the raw base ± delta here.

/** Minimal shape of a stat_activation payload (SSE event or toolResults entry) */
export interface StatActivationLike {
  characterId: string;
  attributeKey: string;
  attributeName?: string;
  oldValue?: number | string;
  newValue: number | string;
  operator?: '+' | '-' | '=' | 'set';
  delta?: number;
}

interface AttributeDefLike {
  key: string;
  type?: string;
  defaultValue?: number | string;
}

interface StoreLike {
  sessions?: Array<{
    id: string;
    sessionStats?: {
      characterStats?: Record<string, {
        attributeValues?: Record<string, number | string>;
      }>;
    };
  }>;
  characters?: Array<{ id: string; statsConfig?: { attributes?: AttributeDefLike[] } }>;
  personas?: Array<{ id: string; statsConfig?: { attributes?: AttributeDefLike[] } }>;
  activePersonaId?: string;
  updateCharacterStat?: (
    sessionId: string,
    characterId: string,
    attributeKey: string,
    value: number | string,
    reason?: string,
  ) => unknown;
}

export interface AppliedStatActivation {
  attributeKey: string;
  /** Value actually written to the store */
  appliedValue: number | string;
  /** 'delta' → replayed +N/-N on client value · 'absolute' → set as-is */
  mode: 'delta' | 'absolute';
  /** Client value BEFORE the write (when known) */
  clientOldValue?: number | string;
}

function findAttributeDef(store: StoreLike, characterId: string, attributeKey: string): AttributeDefLike | undefined {
  if (characterId === '__user__') {
    const personas = store.personas || [];
    const active = personas.find(p => p.id === store.activePersonaId);
    return active?.statsConfig?.attributes?.find(a => a.key === attributeKey);
  }
  return store.characters?.find(c => c.id === characterId)?.statsConfig?.attributes?.find(
    a => a.key === attributeKey,
  );
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Apply one stat_activation to the tavern store, accumulating correctly with
 * every other writer (skill costs, other tool calls in the same turn).
 * Returns how the value was applied so callers can log/toast accurately.
 * The store is accepted as a opaque object (cast internally to the minimal
 * shape we need) so any zustand store instance passes type checking.
 */
export function applyStatActivationToStore(
  store: object,
  sessionId: string,
  activation: StatActivationLike,
  reason = 'llm_detection',
): AppliedStatActivation {
  const s = store as unknown as StoreLike;
  const { characterId, attributeKey } = activation;

  // ── Read the CURRENT client-side value (authoritative for deltas) ──
  const session = s.sessions?.find(s2 => s2.id === sessionId);
  const clientValue = session?.sessionStats?.characterStats?.[characterId]?.attributeValues?.[attributeKey];
  const clientCurrent = toFiniteNumber(clientValue);

  // Fallback bases when the client has no numeric value yet
  const serverOld = toFiniteNumber(activation.oldValue);
  const attrDefault = toFiniteNumber(
    findAttributeDef(s, characterId, attributeKey)?.defaultValue,
  );

  // ── Delta replay path ('+' / '-' operators from modify_stat) ──
  const delta = toFiniteNumber(activation.delta);
  if ((activation.operator === '+' || activation.operator === '-') && delta !== null) {
    const base = clientCurrent ?? serverOld ?? attrDefault;
    if (base !== null) {
      const applied = activation.operator === '+' ? base + delta : base - delta;
      s.updateCharacterStat?.(sessionId, characterId, attributeKey, applied, reason);
      return {
        attributeKey,
        appliedValue: applied,
        mode: 'delta',
        clientOldValue: clientCurrent ?? clientValue,
      };
    }
    // No numeric base available anywhere → fall through to absolute set
  }

  // ── Absolute path ('=' / 'set' / legacy events without metadata) ──
  s.updateCharacterStat?.(sessionId, characterId, attributeKey, activation.newValue, reason);
  return {
    attributeKey,
    appliedValue: activation.newValue,
    mode: 'absolute',
    clientOldValue: clientCurrent ?? clientValue,
  };
}
