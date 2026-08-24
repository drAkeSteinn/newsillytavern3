// ============================================
// Relationships — pure helpers
// ============================================
//
// A Relationship is a BOND between two entities (character ↔ character or
// character ↔ user). It is stored as points 0-100 in
// SessionStats.relationships[pairKey] and MIRRORED into both parties'
// characterStats.attributeValues as:
//   - `relacion`      (number 0-100)
//   - `relacion_etapa` (keyword: stage label)
// so that ALL existing gates (lorebook attribute entries, sprite conditions,
// skill requirements, proactive case-selector) work without touching the
// evaluators. Characters may also define a `relacion` AttributeDefinition
// to show the bond bar in the HUD.

export interface RelationshipStage {
  key: string;
  label: string;
  min: number;
  max: number;
}

/** Stage table (ascending). Points are clamped to 0-100. */
export const RELATIONSHIP_STAGES: RelationshipStage[] = [
  { key: 'extranos', label: 'Extraños', min: 0, max: 15 },
  { key: 'conocidos', label: 'Conocidos', min: 16, max: 35 },
  { key: 'amigos', label: 'Amigos', min: 36, max: 60 },
  { key: 'intimos', label: 'Íntimos', min: 61, max: 85 },
  { key: 'pareja', label: 'Pareja', min: 86, max: 100 },
];

/** Default bond for brand-new pairs */
export const DEFAULT_RELATIONSHIP_POINTS = 15;

/** Mirror attribute keys (written into both parties' attributeValues) */
export const RELATIONSHIP_MIRROR_KEY = 'relacion';
export const RELATIONSHIP_STAGE_KEY = 'relacion_etapa';

/** Stable pair key regardless of direction */
export function relationshipPairKey(aId: string, bId: string): string {
  return [aId, bId].sort().join('|');
}

/** Clamp helper */
export function clampRelationshipPoints(points: number): number {
  if (!Number.isFinite(points)) return DEFAULT_RELATIONSHIP_POINTS;
  return Math.min(100, Math.max(0, Math.round(points)));
}

/** Derive stage from points */
export function computeRelationshipStage(points: number): RelationshipStage {
  const p = clampRelationshipPoints(points);
  return RELATIONSHIP_STAGES.find(s => p >= s.min && p <= s.max) || RELATIONSHIP_STAGES[0];
}

/** Find a bond from a raw relationships record */
export function getRelationship(
  relationships: Record<string, unknown> | undefined,
  aId: string,
  bId: string
): { pairKey: string; points: number; stage: RelationshipStage } | null {
  const rec = relationships?.[relationshipPairKey(aId, bId)] as { points?: number } | undefined;
  if (!rec) return null;
  const points = clampRelationshipPoints(rec.points ?? DEFAULT_RELATIONSHIP_POINTS);
  return { pairKey: relationshipPairKey(aId, bId), points, stage: computeRelationshipStage(points) };
}

/** User aliases accepted as relationship target */
export function isUserTarget(target: string, userName?: string): boolean {
  const t = (target || '').toLowerCase().trim();
  if (t === '__user__' || t === 'user' || t === 'usuario' || t === 'la persona' || t === 'persona') return true;
  if (userName && t === userName.toLowerCase().trim()) return true;
  return false;
}
