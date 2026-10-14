// ============================================
// Scenario Library V3 — App-level scenario collections
// ============================================
//
// Global scenario library (App Config → Escenarios) with a 3-level hierarchy:
//   ScenarioDefinition ("Departamento")
//     └─ ScenarioPlace ("Cuarto", "Cocina")
//          └─ ScenarioSpot ("Cama", "Escritorio")
//
// Characters reference collections by id (character.scenarioIds — dropdown in
// the character editor); groups can too (group.scenarioIds, shared scene).
// LEGACY FALLBACK: characters/groups with the old scenarioConfig (flat
// locations) are synthesized as a single-collection view so the whole system
// (prompt block, manage_escenario tool, background/pose sync) works uniformly.
//
// The ACTIVE location is stored in the SESSION state:
//   - sessionStats.activeScenarioCollectionId → ScenarioDefinition.id (V3)
//   - sessionStats.activeScenarioId           → place-or-spot id (place or spot)
// Resolution order (resolveActiveScenarioLocation):
//   1. collectionId + locationId inside it (spot → place → default place)
//   2. locationId searched across ALL effective collections (greeting pinning)
//   3. first collection → its default place
//
// Each place/spot can pin a backgroundUrl (applied by the client when the
// scene moves) and a spritePose (position + scale for the character sprite).

import type {
  ScenarioDefinition,
  ScenarioPlace,
  ScenarioSpot,
  ScenarioConfig,
  ScenarioLocation,
  SessionStats,
  CharacterCard,
  SpritePose,
} from '@/types';
import type { ScenarioSource } from './index';

// ============ Per-request library registry ============
//
// The Scenario Library is App-level global data (like settings). Chat routes
// call setActiveScenarioLibrary(body.scenarios) at the start of each request so
// the {{escenario}} key resolves with the current library without threading a
// parameter through every prompt-builder function. The explicit `library`
// arguments always take precedence over the registry.

let activeLibraryRegistry: ScenarioDefinition[] | null = null;

export function setActiveScenarioLibrary(library: ScenarioDefinition[] | null | undefined): void {
  activeLibraryRegistry = Array.isArray(library) && library.length > 0 ? library : null;
}

export function getActiveScenarioLibrary(): ScenarioDefinition[] | null {
  return activeLibraryRegistry;
}

// ============ Normalization ============

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asOptionalString(v: unknown): string | undefined {
  const s = asString(v).trim();
  return s ? s : undefined;
}

/** Normalize a sprite pose from untrusted data (clamped to sane ranges). */
export function normalizeSpritePose(raw: any): SpritePose | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const num = (v: unknown, fallback: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  return {
    x: num(raw.x, 50, 0, 100),
    y: num(raw.y, 0, 0, 100),
    width: num(raw.width, 30, 5, 90),
    height: num(raw.height, 70, 5, 95),
    opacity: num(raw.opacity, 1, 0, 1),
  };
}

function normalizeSpot(raw: any): ScenarioSpot | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = asString(raw.id);
  const name = asString(raw.name).trim();
  if (!id || !name) return null;
  const pose = normalizeSpritePose(raw.spritePose);
  return {
    id,
    name,
    ...(asOptionalString(raw.description) ? { description: asOptionalString(raw.description) } : {}),
    ...(asOptionalString(raw.backgroundUrl) ? { backgroundUrl: asOptionalString(raw.backgroundUrl) } : {}),
    ...(pose ? { spritePose: pose } : {}),
  };
}

function normalizePlace(raw: any): ScenarioPlace | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = asString(raw.id);
  const name = asString(raw.name).trim();
  if (!id || !name) return null;
  const pose = normalizeSpritePose(raw.spritePose);
  return {
    id,
    name,
    ...(asOptionalString(raw.description) ? { description: asOptionalString(raw.description) } : {}),
    ...(asOptionalString(raw.backgroundUrl) ? { backgroundUrl: asOptionalString(raw.backgroundUrl) } : {}),
    ...(pose ? { spritePose: pose } : {}),
    spots: Array.isArray(raw.spots)
      ? raw.spots.map(normalizeSpot).filter((s: ScenarioSpot | null): s is ScenarioSpot => !!s)
      : [],
  };
}

/** Validate + normalize one ScenarioDefinition from untrusted data. */
export function normalizeScenarioDefinition(raw: any): ScenarioDefinition | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = asString(raw.id);
  const name = asString(raw.name).trim();
  if (!id || !name) return null;
  const pose = undefined; // scenario level has no pose (places/spots own it)
  void pose;
  return {
    id,
    name,
    ...(asOptionalString(raw.description) ? { description: asOptionalString(raw.description) } : {}),
    enabled: raw.enabled !== false, // default enabled
    ...(asOptionalString(raw.defaultBackgroundUrl) ? { defaultBackgroundUrl: asOptionalString(raw.defaultBackgroundUrl) } : {}),
    places: Array.isArray(raw.places)
      ? raw.places.map(normalizePlace).filter((p: ScenarioPlace | null): p is ScenarioPlace => !!p)
      : [],
    ...(typeof raw.defaultPlaceId === 'string' && raw.defaultPlaceId ? { defaultPlaceId: raw.defaultPlaceId } : {}),
    createdAt: asString(raw.createdAt) || new Date().toISOString(),
    updatedAt: asString(raw.updatedAt) || new Date().toISOString(),
  };
}

/** Normalize a whole library array (drops invalid entries). */
export function normalizeScenarioLibrary(raw: unknown): ScenarioDefinition[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeScenarioDefinition).filter((d): d is ScenarioDefinition => !!d);
}

// ============ Legacy synthesis (scenarioConfig V2 → V3 view) ============

/**
 * Synthesize a ScenarioDefinition from the legacy flat scenarioConfig.
 * Every legacy location becomes a PLACE (no spots). The synthetic id is
 * namespaced (`legacy:${ownerId}`) so it can never collide with the library.
 */
export function synthesizeLegacyScenario(
  config: ScenarioConfig | undefined,
  ownerId: string,
  ownerName: string
): ScenarioDefinition | null {
  if (!config?.enabled || !Array.isArray(config.locations)) return null;
  const places: ScenarioPlace[] = config.locations
    .filter((l: ScenarioLocation) => l && typeof l.id === 'string' && l.id && typeof l.name === 'string' && l.name.trim())
    .map((l: ScenarioLocation) => ({
      id: l.id,
      name: l.name.trim(),
      ...(l.description?.trim() ? { description: l.description.trim() } : {}),
      ...(l.spritePose ? { spritePose: l.spritePose } : {}),
      spots: [],
    }));
  if (places.length === 0) return null;
  const now = new Date().toISOString();
  return {
    id: `legacy:${ownerId}`,
    name: ownerName,
    enabled: true,
    places,
    defaultPlaceId: places.find(p => p.id === config.locations.find(l => l.isDefault)?.id)?.id
      ?? places[0].id,
    createdAt: now,
    updatedAt: now,
  };
}

// ============ Effective definitions ============

/** Source that can carry scenarioIds (character or group). */
export type ScenarioIdsSource = { scenarioIds?: string[]; id?: string; name?: string } | null | undefined;

/** Minimal character shape needed to resolve effective scenarios.
 *  Deliberately loose: accepts full CharacterCards AND editor drafts
 *  (Omit<CharacterCard, 'id'|'createdAt'|'updatedAt'>). */
export type ScenarioCharacterSource = {
  id?: string;
  name?: string;
  scenarioIds?: string[];
  scenarioConfig?: ScenarioConfig;
} | null | undefined;

/**
 * Effective App-level scenario definitions for a chat.
 * Priority: group.scenarioIds → character.scenarioIds → LEGACY synthesis
 * (group.scenarioConfig → character.scenarioConfig).
 */
export function getEffectiveScenarioDefinitions(
  character: ScenarioCharacterSource,
  library: ScenarioDefinition[] | undefined,
  group?: ScenarioIdsSource & ScenarioSource
): ScenarioDefinition[] {
  // 1) group-level App scenarios (shared scene)
  if (group?.scenarioIds?.length && library?.length) {
    const defs = group.scenarioIds
      .map(id => library.find(d => d.id === id))
      .filter((d): d is ScenarioDefinition => !!d && d.enabled && d.places.length > 0);
    if (defs.length > 0) return defs;
  }

  // 2) character-level App scenarios
  if (character?.scenarioIds?.length && library?.length) {
    const defs = character.scenarioIds
      .map(id => library.find(d => d.id === id))
      .filter((d): d is ScenarioDefinition => !!d && d.enabled && d.places.length > 0);
    if (defs.length > 0) return defs;
  }

  // 3) LEGACY fallback: group config first, then character config
  if (group?.scenarioConfig) {
    const legacy = synthesizeLegacyScenario(group.scenarioConfig, `group:${group.id || 'group'}`, group.name || 'Escenario del grupo');
    if (legacy) return [legacy];
  }
  if (character?.scenarioConfig) {
    const legacy = synthesizeLegacyScenario(character.scenarioConfig, character.id || 'character', character.name || 'Escenario');
    if (legacy) return [legacy];
  }

  return [];
}

/** Whether any scenario is usable for this chat (V3 or legacy). */
export function isScenarioLibraryAvailable(
  character: CharacterCard | undefined,
  library: ScenarioDefinition[] | undefined,
  group?: ScenarioIdsSource & ScenarioSource
): boolean {
  return getEffectiveScenarioDefinitions(character, library, group).length > 0;
}

// ============ Active location resolution ============

export interface ActiveScenarioLocation {
  definition: ScenarioDefinition;
  place: ScenarioPlace;
  /** Defined only when the active location is a spot inside the place. */
  spot: ScenarioSpot | null;
  /** The id stored in sessionStats.activeScenarioId (place, spot or the scenario id itself). */
  locationId: string;
  locationName: string;
  locationDescription: string;
  isSpot: boolean;
  /**
   * V3.2 — True when the scene is parked AT THE SCENARIO LEVEL itself
   * (activeScenarioId === definition.id). Each of the 3 levels (escenario /
   * lugar / punto de interés) can pin its own fondo; at scenario level the
   * shown background is definition.defaultBackgroundUrl.
   */
  isScenarioLevel: boolean;
  /** True when resolved from the legacy scenarioConfig synthesis. */
  isLegacy: boolean;
}

function resolveDefaultPlace(def: ScenarioDefinition): ScenarioPlace | null {
  if (def.places.length === 0) return null;
  return def.places.find(p => p.id === def.defaultPlaceId) || def.places[0];
}

/**
 * Resolve where the scene currently is across the effective definitions.
 * See the module header for the resolution order.
 */
export function resolveActiveScenarioLocation(
  definitions: ScenarioDefinition[],
  sessionStats: SessionStats | null | undefined
): ActiveScenarioLocation | null {
  if (!definitions.length) return null;

  const collectionId = sessionStats?.activeScenarioCollectionId ?? null;
  const locationId = sessionStats?.activeScenarioId ?? null;

  const findInDef = (def: ScenarioDefinition, locId: string | null): ActiveScenarioLocation | null => {
    if (!locId) return null;
    // spot first (more specific)
    for (const place of def.places) {
      const spot = place.spots.find(s => s.id === locId);
      if (spot) {
        return {
          definition: def,
          place,
          spot,
          locationId: spot.id,
          locationName: spot.name,
          locationDescription: spot.description?.trim() || '',
          isSpot: true,
          isScenarioLevel: false,
          isLegacy: def.id.startsWith('legacy:'),
        };
      }
    }
    const place = def.places.find(p => p.id === locId);
    if (place) {
      return {
        definition: def,
        place,
        spot: null,
        locationId: place.id,
        locationName: place.name,
        locationDescription: place.description?.trim() || '',
        isSpot: false,
        isScenarioLevel: false,
        isLegacy: def.id.startsWith('legacy:'),
      };
    }
    // V3.2: the location id IS the scenario id → parked at scenario level
    // (its own fondo — definition.defaultBackgroundUrl — is the one shown).
    if (locId === def.id) {
      const place = resolveDefaultPlace(def);
      if (!place) return null;
      return {
        definition: def,
        place,
        spot: null,
        locationId: def.id,
        locationName: def.name,
        locationDescription: def.description?.trim() || '',
        isSpot: false,
        isScenarioLevel: true,
        isLegacy: def.id.startsWith('legacy:'),
      };
    }
    return null;
  };

  const buildDefaultInDef = (def: ScenarioDefinition): ActiveScenarioLocation | null => {
    const place = resolveDefaultPlace(def);
    if (!place) return null;
    return {
      definition: def,
      place,
      spot: null,
      locationId: place.id,
      locationName: place.name,
      locationDescription: place.description?.trim() || '',
      isSpot: false,
      isScenarioLevel: false,
      isLegacy: def.id.startsWith('legacy:'),
    };
  };

  // 1) explicit collection + location
  if (collectionId) {
    const def = definitions.find(d => d.id === collectionId);
    if (def) {
      const found = findInDef(def, locationId) || buildDefaultInDef(def);
      if (found) return found;
    }
  }

  // 2) location id searched across all definitions (greeting pinning, legacy ids)
  if (locationId) {
    for (const def of definitions) {
      const found = findInDef(def, locationId);
      if (found) return found;
    }
  }

  // 3) first definition → default place
  return buildDefaultInDef(definitions[0]);
}

/**
 * Background for the active location.
 * V3.2: at SCENARIO LEVEL the scenario's OWN fondo wins (each of the 3 levels
 * can pin its own background). Otherwise: spot → place → scenario default.
 */
export function resolveLocationBackground(active: ActiveScenarioLocation | null): string | null {
  if (!active) return null;
  if (active.isScenarioLevel) {
    return active.definition.defaultBackgroundUrl
      || active.place.backgroundUrl
      || null;
  }
  return active.spot?.backgroundUrl
    || active.place.backgroundUrl
    || active.definition.defaultBackgroundUrl
    || null;
}

/** Sprite pose for the active location: spot → place. */
export function resolveLocationPose(active: ActiveScenarioLocation | null): SpritePose | null {
  if (!active) return null;
  return active.spot?.spritePose || active.place.spritePose || null;
}

// ============ Hierarchy search (manage_escenario) ============

export type ScenarioMatch =
  | { type: 'spot'; definition: ScenarioDefinition; place: ScenarioPlace; spot: ScenarioSpot }
  | { type: 'place'; definition: ScenarioDefinition; place: ScenarioPlace }
  | { type: 'collection'; definition: ScenarioDefinition };

function normalizeName(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function nameMatches(candidate: string, query: string): boolean {
  const c = normalizeName(candidate);
  const q = normalizeName(query);
  if (!c || !q) return false;
  return c === q || c.includes(q) || q.includes(c);
}

/** Exact id match first, then normalized name/substring match. */
function idOrNameMatch(id: string, name: string, query: string): boolean {
  return id === query || nameMatches(name, query);
}

/**
 * Find a place/spot/collection by id or name across the definitions.
 * Matches inside the CURRENT collection are preferred (spot → place), then
 * the current collection by name (scenario switch), then the rest.
 */
export function findInScenarioHierarchy(
  definitions: ScenarioDefinition[],
  query: string,
  currentCollectionId?: string | null
): ScenarioMatch | null {
  if (!query.trim() || definitions.length === 0) return null;
  const current = definitions.find(d => d.id === currentCollectionId) || null;
  const others = definitions.filter(d => d.id !== current?.id);

  // 1) spots in current collection → 2) places in current collection
  if (current) {
    for (const place of current.places) {
      const spot = place.spots.find(s => idOrNameMatch(s.id, s.name, query));
      if (spot) return { type: 'spot', definition: current, place, spot };
    }
    const place = current.places.find(p => idOrNameMatch(p.id, p.name, query));
    if (place) return { type: 'place', definition: current, place };
  }

  // 3) current collection by id or name (explicit scenario switch)
  if (current && (current.id === query || nameMatches(current.name, query))) {
    return { type: 'collection', definition: current };
  }

  // 4) other collections: spots → places → collection ids/names
  for (const def of others) {
    for (const place of def.places) {
      const spot = place.spots.find(s => idOrNameMatch(s.id, s.name, query));
      if (spot) return { type: 'spot', definition: def, place, spot };
    }
    const place = def.places.find(p => idOrNameMatch(p.id, p.name, query));
    if (place) return { type: 'place', definition: def, place };
  }
  for (const def of others) {
    if (def.id === query || nameMatches(def.name, query)) return { type: 'collection', definition: def };
  }

  return null;
}

// ============ Move-target resolution (rewards / quick replies) ============

export interface ScenarioMoveTarget {
  /** Id to store in sessionStats.activeScenarioId (spot id, place id or the
   *  scenario id itself for scenario-level parking). */
  locationId: string;
  /** Background of the destination (spot → place → scenario default; at
   *  scenario level the scenario's OWN fondo). null → keep current background. */
  backgroundUrl: string | null;
  /** Human-readable "Escenario → Lugar · Punto de interés" label. */
  label: string;
}

/**
 * Derive the concrete move data (location id + background + label) from a
 * hierarchy match. Used by the 'ubicacion' reward executor and quick replies —
 * the SAME pattern as the manual scenario-switcher: collection + location +
 * background. Changing the background alone re-applies the saved sprite pose.
 */
export function resolveScenarioMoveTarget(match: ScenarioMatch): ScenarioMoveTarget {
  switch (match.type) {
    case 'spot':
      return {
        locationId: match.spot.id,
        backgroundUrl: match.spot.backgroundUrl
          || match.place.backgroundUrl
          || match.definition.defaultBackgroundUrl
          || null,
        label: `${match.definition.name} → ${match.place.name} · ${match.spot.name}`,
      };
    case 'place':
      return {
        locationId: match.place.id,
        backgroundUrl: match.place.backgroundUrl
          || match.definition.defaultBackgroundUrl
          || null,
        label: `${match.definition.name} → ${match.place.name}`,
      };
    case 'collection':
      return {
        locationId: match.definition.id,
        backgroundUrl: match.definition.defaultBackgroundUrl || null,
        label: `${match.definition.name} (escenario)`,
      };
  }
}

/**
 * Resolve a human-readable label for a stored location id across the given
 * definitions (used by badges/UI where only the id was saved).
 */
export function describeScenarioLocationId(
  definitions: ScenarioDefinition[] | undefined | null,
  locationId: string | undefined
): string | undefined {
  if (!locationId) return undefined;
  for (const d of definitions || []) {
    if (d.id === locationId) return d.name;
    for (const p of d.places) {
      if (p.id === locationId) return `${d.name} → ${p.name}`;
      for (const s of p.spots) {
        if (s.id === locationId) return `${d.name} → ${p.name} · ${s.name}`;
      }
    }
  }
  return undefined;
}

// ============ Prompt block builder ({{escenario}}) ============

function shortText(text: string | undefined, max = 140): string {
  const t = (text || '').trim();
  if (!t) return '';
  return t.length > max ? `${t.slice(0, max - 3)}...` : t;
}

/**
 * Build the full hierarchical [ESCENARIO] block injected by {{escenario}}.
 *
 * STRATEGY — PROGRESSIVE DISCLOSURE (deliberate expert choice over dumping the
 * full tree of every scenario):
 *   1. Token economy — the block is injected EVERY turn; full trees of every
 *      scenario would burn context on places the scene may never visit.
 *   2. Narrative discovery ("fog of war") — places/pois of other scenarios are
 *      revealed when the scene moves there, exactly like the user described.
 *   3. Anti-hallucination — listing only scenario NAMES for the others (plus an
 *      explicit "don't invent" rule) prevents the LLM from referencing or
 *      inventing unvisited places. The manage_escenario "list"/"get_info"
 *      actions give it the full tree on demand.
 *
 * Visibility rules:
 *   - Breadcrumb "Ruta actual" (Escenario > Lugar > Punto de interés).
 *   - ACTIVE scenario → full tree: all places (name + description), and the
 *     CURRENT place always lists its points of interest (so tool calling has
 *     the complete context of where the scene is). Current location(s) are
 *     marked with ← UBICACIÓN ACTUAL / ← ESCENARIO ACTUAL.
 *   - OTHER scenarios → name + short description only.
 * Followed by the mandatory manage_escenario instructions and the current
 * location's full description.
 */
export function buildScenarioPromptBlock(
  definitions: ScenarioDefinition[],
  active: ActiveScenarioLocation | null,
  options?: { userName?: string; header?: string }
): string {
  if (!definitions.length || !active) return '';

  const header = options?.header || '[ESCENARIO]';
  const userName = options?.userName || '{{user}}';
  const lines: string[] = [];

  lines.push(header);
  lines.push('Jerarquía: ESCENARIO (colección) → LUGARES → PUNTOS DE INTERÉS. Dónde estáis ahora se marca con ← UBICACIÓN ACTUAL.');
  lines.push('');

  // Breadcrumb of the current path (parent levels always visible).
  // V3.2: at SCENARIO LEVEL the path is just the scenario (the scene is not
  // inside any place yet — e.g. right after arriving at the scenario).
  const path = active.isScenarioLevel
    ? [`"${active.definition.name}" (escenario)`]
    : [`"${active.definition.name}"`, `"${active.place.name}"`];
  if (!active.isScenarioLevel && active.isSpot && active.spot) path.push(`"${active.spot.name}"`);
  lines.push(`Ruta actual: ${path.join(' > ')}`);
  lines.push('');
  lines.push('Mapa de ubicaciones:');

  for (const def of definitions) {
    const isActiveScenario = def.id === active.definition.id;
    if (!isActiveScenario) {
      // Other scenarios: name + short description only. Their places/pois are
      // NOT shown — they are discovered when the scene moves there.
      const d = shortText(def.description);
      lines.push(`- "${def.name}"${d ? `: ${d}` : ''}`);
      continue;
    }
    const desc = shortText(def.description);
    // V3.2: at scenario level the SCENARIO line is the current location.
    const scenarioMarker = active.isScenarioLevel ? ' ← UBICACIÓN ACTUAL' : ' ← ESCENARIO ACTUAL';
    lines.push(`- "${def.name}"${scenarioMarker}${desc ? `: ${desc}` : ''}`);
    for (const place of def.places) {
      const isCurrentPlace = place.id === active.place.id;
      const placeDesc = shortText(place.description);
      if (active.isScenarioLevel) {
        lines.push(`  - "${place.name}"${place.id === def.defaultPlaceId ? ' (lugar predeterminado)' : ''}${placeDesc ? `: ${placeDesc}` : ''}`);
      } else if (isCurrentPlace && active.isSpot) {
        lines.push(`  - "${place.name}" (lugar actual)${placeDesc ? `: ${placeDesc}` : ''}`);
      } else if (isCurrentPlace) {
        lines.push(`  - "${place.name}" ← UBICACIÓN ACTUAL${placeDesc ? `: ${placeDesc}` : ''}`);
      } else {
        lines.push(`  - "${place.name}"${placeDesc ? `: ${placeDesc}` : ''}`);
      }
      // The CURRENT place ALWAYS lists its points of interest — the LLM needs
      // the full context of the place it is in (and of the spots next to it).
      // At scenario level no place is current, so no spots are listed.
      if (!active.isScenarioLevel && isCurrentPlace) {
        for (const spot of place.spots) {
          const isCurrentSpot = active.isSpot && spot.id === active.spot?.id;
          const spotDesc = shortText(spot.description);
          lines.push(`    - "${spot.name}"${isCurrentSpot ? ' ← UBICACIÓN ACTUAL' : ''}${spotDesc ? `: ${spotDesc}` : ''}`);
        }
      }
    }
  }

  lines.push('');
  lines.push('INSTRUCCIONES PARA GESTIONAR LA UBICACIÓN DE LA ESCENA (HERRAMIENTA OBLIGATORIA):');
  lines.push('- REGLA CRÍTICA: CUALQUIER cambio de ubicación (moveros a otro lugar) DEBE reflejarse llamando a la herramienta "manage_escenario" con action "go" ANTES de narrarlo. NUNCA narres que os movisteis a otro lugar sin haber llamado primero a la herramienta.');
  lines.push(`- Si ${userName} pide cambiar de lugar (ir a la cama, al sofá, al escritorio, salir, etc.), SIEMPRE responde con una tool call a "manage_escenario" eligiendo la ubicación más adecuada de tu escenario.`);
  lines.push('- Cuando la narrativa lo justifique (irse a dormir, ir a la cocina, entrar a otra habitación, salir de casa...), MUEVE la escena TÚ MISMO usando la herramienta "manage_escenario" con action "go" y el nombre del lugar.');
  lines.push('- Elige la ubicación que mejor encaje con la escena, la hora y el estado de ánimo. No necesitas permiso del usuario para mover la escena.');
  lines.push('- Usa el nombre EXACTO de la ubicación tal como aparece en la lista (ej: "Cama", "Cocina"). Con action "list" ves todas las ubicaciones con sus detalles.');
  lines.push('- Puedes moveros a un PUNTO DE INTERÉS del lugar actual, a otro LUGAR del escenario actual, o a OTRO ESCENARIO de la lista si la narrativa lo justifica (salir de casa, ir al bar...).');
  lines.push('- Los puntos de interés solo se listan en el lugar ACTUAL: al moveros a otro lugar, los suyos aparecerán aquí (usa action "list" si quieres verlos antes de moveros).');
  lines.push('- De los OTROS escenarios solo ves su nombre: NUNCA inventes lugares o puntos de interés de esos escenarios. Muévete primero al escenario (action "go" con su nombre) y sus lugares se revelarán.');
  lines.push('- Mantén coherencia narrativa con la ubicación actual: no narres objetos o personas de otro lugar mientras estéis aquí.');
  lines.push('- Usa la ubicación ACTIVAMENTE cuando la narrativa lo justifique. No esperes a que el usuario lo pida explícitamente.');

  // Current location full description
  const currentDesc = active.isScenarioLevel
    ? (active.definition.description?.trim() || '')
    : (active.spot?.description?.trim() || active.place.description?.trim() || '');
  if (currentDesc) {
    lines.push('');
    lines.push(`UBICACIÓN ACTUAL: "${active.locationName}"`);
    lines.push(currentDesc);
  }

  return lines.join('\n');
}
