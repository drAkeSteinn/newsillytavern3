// ============================================
// Tool: Manage Scenario (ESCENARIO V3)
// ============================================
// Category: in_character
// Lets the character manage the scene location across the scenario hierarchy:
//   ScenarioDefinition ("Departamento") → ScenarioPlace ("Cuarto") → ScenarioSpot ("Cama")
//
// Sources: App-level Scenario Library (context.scenarios filtered by
// character.scenarioIds / group.scenarioIds) with a LEGACY fallback that
// synthesizes a single collection from the old scenarioConfig (flat locations).
//
// Actions:
// - list:     current scenario full tree (places + spots) + other scenarios by name
// - go:       move the scene to a spot / place / another scenario (by name or id)
// - get_info: details of the current location or a specific one
//
// The tool NEVER invents locations: "go" only accepts names/ids that exist in
// the hierarchy (exact id, normalized name or substring match). On success the
// scenarioActivation carries collectionId + backgroundUrl + spritePose so the
// client can sync session state, background and character sprite pose.
//
// After a "go", the next turn's {{escenario}} key injects the new location's
// context, and the change persists in the session JSON.

import type { ToolDefinition, ToolContext, ToolExecutionResult } from '../types';
import type { ScenarioDefinition, SpritePose } from '@/types';
import {
  getEffectiveScenarioDefinitions,
  resolveActiveScenarioLocation,
  resolveLocationBackground,
  resolveLocationPose,
  findInScenarioHierarchy,
  getActiveScenarioLibrary,
  type ActiveScenarioLocation,
} from '@/lib/scenario/library';

export const manageScenarioTool: ToolDefinition = {
  id: 'manage_escenario',
  name: 'manage_escenario',
  label: 'Gestionar Escenario',
  icon: 'MapPin',
  description:
    'Gestiona la ubicación de la escena. Permite ver los lugares disponibles y mover la escena ' +
    'al que quieras (por nombre o id) o ver dónde estáis ahora. ' +
    'La ubicación actual se inyecta en tu prompt como [ESCENARIO]. ' +
    'Usa "list" para ver los lugares disponibles y "go" para mover la escena según la narrativa. ' +
    'Puedes moveros a un punto de interés (ej: "Cama"), a otro lugar del escenario (ej: "Cocina") ' +
    'o a otro escenario disponible (ej: "Bar") si la narrativa lo justifica.',
  category: 'in_character',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description:
          'Acción a realizar: "list" (ver todos los lugares disponibles), "go" (mover la escena a un lugar concreto) ' +
          'o "get_info" (detalle de la ubicación actual o de una específica).',
        required: true,
        enum: ['list', 'go', 'get_info'],
      },
      location: {
        type: 'string',
        description:
          'Nombre o id del lugar (para "go" y "get_info"). Puede ser un punto de interés (ej: "Cama"), ' +
          'un lugar del escenario (ej: "Cocina") o el nombre de otro escenario disponible (ej: "Bar"). ' +
          'Debe coincidir con una ubicación de tu escenario.',
        required: false,
      },
      reason: {
        type: 'string',
        description: 'Razón narrativa del cambio de ubicación (ej: "Se van a dormir", "Se mueve al escritorio a trabajar").',
        required: false,
      },
    },
    required: ['action'],
  },
  permissionMode: 'auto',
};

/** Build the activation payload shared by all actions. */
function buildActivation(
  context: ToolContext,
  action: 'list' | 'go' | 'get_info',
  active: ActiveScenarioLocation | null,
  opts: {
    target?: ActiveScenarioLocation | null;
    previousId?: string | null;
    changed?: boolean;
    reason?: string;
  } = {}
) {
  const target = opts.target ?? active;
  const backgroundUrl = resolveLocationBackground(target);
  const spritePose = resolveLocationPose(target);
  return {
    characterId: context.characterId,
    action,
    locationId: target?.locationId ?? null,
    locationName: target?.locationName ?? '',
    locationDescription: target?.locationDescription ?? '',
    previousLocationId: opts.previousId ?? active?.locationId ?? null,
    changed: opts.changed ?? false,
    ...(opts.reason ? { reason: opts.reason } : {}),
    ...(target ? { collectionId: target.definition.id, collectionName: target.definition.name } : {}),
    ...(backgroundUrl ? { backgroundUrl } : {}),
    ...(spritePose ? { spritePose } : {}),
  };
}

/** Render one active-location line for display messages. */
function describeTarget(active: ActiveScenarioLocation): string {
  if (active.isScenarioLevel) {
    return `"${active.definition.name}" (escenario)`;
  }
  if (active.isSpot && active.spot) {
    return `"${active.spot.name}" (${active.place.name} · ${active.definition.name})`;
  }
  return `"${active.place.name}" (${active.definition.name})`;
}

export async function manageScenarioExecutor(
  params: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolExecutionResult> {
  const action = String(params.action || 'get_info').trim().toLowerCase() as 'list' | 'go' | 'get_info';
  const locationQuery = params.location ? String(params.location).trim() : '';
  const reason = params.reason ? String(params.reason).trim() : '';

  const character = context.character;
  if (!character) {
    return {
      success: false,
      toolName: 'manage_escenario',
      result: null,
      displayMessage: 'No hay personaje activo.',
      error: 'No active character',
    };
  }

  // ESCENARIO V3: effective App-level definitions (library filtered by
  // character/group scenarioIds) with a legacy synthesis fallback.
  // The library comes from the tool context when available; otherwise from the
  // per-request registry set by the chat routes (setActiveScenarioLibrary).
  // GROUP: context.group carries the group — its scenarioIds/scenarioConfig
  // REPLACE the character-level ones so all members share the same scene.
  const definitions: ScenarioDefinition[] = getEffectiveScenarioDefinitions(
    character,
    context.scenarios ?? getActiveScenarioLibrary() ?? undefined,
    context.group
  );

  if (definitions.length === 0) {
    return {
      success: false,
      toolName: 'manage_escenario',
      result: null,
      displayMessage: groupFallbackMessage(character.name, context.group?.name),
      error: 'Scenario not available',
    };
  }

  const active = resolveActiveScenarioLocation(definitions, context.sessionStats);
  if (!active) {
    return {
      success: false,
      toolName: 'manage_escenario',
      result: null,
      displayMessage: 'No se pudo resolver la información del escenario.',
      error: 'Scenario info unavailable',
    };
  }

  // LIST: current scenario full tree + other scenarios by name
  if (action === 'list') {
    const lines: string[] = [];
    lines.push(`📍 **Escenario actual:** "${active.definition.name}" — estás en ${describeTarget(active)}`);
    lines.push('');
    lines.push(`Lugares de "${active.definition.name}" (los puntos de interés del lugar actual se listan debajo):`);
    for (const place of active.definition.places) {
      const isCurrentPlace = place.id === active.place.id;
      const spotCount = place.spots.length;
      lines.push(
        `• "${place.name}"${spotCount > 0 ? ` (${spotCount} punto${spotCount !== 1 ? 's' : ''} de interés)` : ''}${isCurrentPlace ? ' ← lugar actual' : ''}`
      );
      if (place.description?.trim()) {
        lines.push(`  ${place.description.trim()}`);
      }
      // Spots are listed for the current place (the others on demand via get_info)
      if (isCurrentPlace && place.spots.length > 0) {
        for (const spot of place.spots) {
          const isCurrentSpot = active.isSpot && spot.id === active.spot?.id;
          lines.push(`    - ${spot.name}${isCurrentSpot ? ' ← ubicación actual' : ''}`);
          if (spot.description?.trim()) lines.push(`      ${spot.description.trim()}`);
        }
      }
    }
    const otherScenarios = definitions.filter(d => d.id !== active.definition.id);
    if (otherScenarios.length > 0) {
      lines.push('');
      lines.push('Otros escenarios disponibles (muévete a ellos con "go" y sus lugares se revelarán; NUNCA inventes lugares de estos escenarios):');
      for (const def of otherScenarios) {
        const d = def.description?.trim();
        lines.push(`• "${def.name}"${d ? `: ${d}` : ''}`);
      }
    }
    lines.push('');
    lines.push('Usa "go" con el nombre del lugar al que quieras mover la escena.');

    return {
      success: true,
      toolName: 'manage_escenario',
      result: {
        currentScenario: active.definition.name,
        places: active.definition.places,
        otherScenarios: otherScenarios.map(d => d.name),
        currentLocation: active.locationName,
      },
      displayMessage: lines.join('\n'),
      scenarioActivation: buildActivation(context, 'list', active, { reason }),
    };
  }

  // GO: move the scene (spot / place / other scenario)
  if (action === 'go') {
    if (!locationQuery) {
      return {
        success: false,
        toolName: 'manage_escenario',
        result: null,
        displayMessage: 'Debes indicar el lugar al que mover la escena. Usa "list" para ver las ubicaciones disponibles.',
        error: 'Missing location param',
      };
    }

    const match = findInScenarioHierarchy(definitions, locationQuery, active.definition.id);
    if (!match) {
      // NEVER invent locations: list what actually exists
      const available = definitions.map(d => `"${d.name}"`).join(', ');
      const currentPlaces = active.definition.places.map(p => `"${p.name}"`).join(', ');
      return {
        success: false,
        toolName: 'manage_escenario',
        result: null,
        displayMessage: `No existe la ubicación "${locationQuery}" en tu escenario. ` +
          `Lugares del escenario actual: ${currentPlaces}. Otros escenarios: ${available}. ` +
          `NO inventes ubicaciones nuevas: usa solo las listadas.`,
        error: 'Location not found',
      };
    }

    let target: ActiveScenarioLocation;
    if (match.type === 'spot') {
      target = {
        definition: match.definition,
        place: match.place,
        spot: match.spot,
        locationId: match.spot.id,
        locationName: match.spot.name,
        locationDescription: match.spot.description?.trim() || '',
        isSpot: true,
        isScenarioLevel: false,
        isLegacy: match.definition.id.startsWith('legacy:'),
      };
    } else if (match.type === 'place') {
      target = {
        definition: match.definition,
        place: match.place,
        spot: null,
        locationId: match.place.id,
        locationName: match.place.name,
        locationDescription: match.place.description?.trim() || '',
        isSpot: false,
        isScenarioLevel: false,
        isLegacy: match.definition.id.startsWith('legacy:'),
      };
    } else {
      // V3.2: scenario switch → park the scene AT THE SCENARIO LEVEL itself
      // (locationId = def.id). Its OWN fondo (defaultBackgroundUrl) is the one
      // carried in the activation; the places are revealed via list/get_info.
      const def = match.definition;
      const place = def.places.find(p => p.id === def.defaultPlaceId) || def.places[0];
      target = {
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

    const changed = target.locationId !== active.locationId || target.definition.id !== active.definition.id;
    const movedScenarios = target.definition.id !== active.definition.id;

    const lines = [
      changed ? '📍 **La escena se mueve a:**' : '📍 **La escena ya está en:**',
      `   ${describeTarget(target)}`,
    ];
    if (movedScenarios) lines.push(`   (antes: ${describeTarget(active)})`);
    if (changed && reason) lines.push(`   Razón: ${reason}`);
    if (changed) {
      const bg = resolveLocationBackground(target);
      if (bg) lines.push('   (el fondo de la escena cambia automáticamente)');
    }

    return {
      success: true,
      toolName: 'manage_escenario',
      result: {
        action: 'go',
        locationId: target.locationId,
        locationName: target.locationName,
        collectionId: target.definition.id,
        collectionName: target.definition.name,
        previousLocation: active.locationName,
        backgroundUrl: resolveLocationBackground(target),
        spritePose: resolveLocationPose(target),
      },
      displayMessage: lines.join('\n'),
      scenarioActivation: buildActivation(context, 'go', active, {
        target,
        previousId: active.locationId,
        changed,
        reason,
      }),
    };
  }

  // GET_INFO: detail of the current location (or a specific one)
  if (action === 'get_info') {
    let target: ActiveScenarioLocation | null = active;
    if (locationQuery) {
      const match = findInScenarioHierarchy(definitions, locationQuery, active.definition.id);
      if (!match || match.type === 'collection') {
        const available = definitions.map(d => `"${d.name}"`).join(', ');
        return {
          success: false,
          toolName: 'manage_escenario',
          result: null,
          displayMessage: `No existe la ubicación "${locationQuery}" en tu escenario. Usa "list" para verlas. Escenarios: ${available}.`,
          error: 'Location not found',
        };
      }
      target = match.type === 'spot'
        ? {
            definition: match.definition, place: match.place, spot: match.spot,
            locationId: match.spot.id, locationName: match.spot.name,
            locationDescription: match.spot.description?.trim() || '', isSpot: true,
            isScenarioLevel: false,
            isLegacy: match.definition.id.startsWith('legacy:'),
          }
        : {
            definition: match.definition, place: match.place, spot: null,
            locationId: match.place.id, locationName: match.place.name,
            locationDescription: match.place.description?.trim() || '', isSpot: false,
            isScenarioLevel: false,
            isLegacy: match.definition.id.startsWith('legacy:'),
          };
    }

    const lines = [
      target.locationId === active.locationId
        ? `📍 **Ubicación actual:** ${describeTarget(target)}`
        : `📍 **Ubicación:** ${describeTarget(target)} (no activa)`,
    ];
    const desc = target.spot?.description?.trim() || target.place.description?.trim() || '';
    if (desc) lines.push(`   ${desc}`);
    if (target.spot && target.place.spots.length > 1) {
      const siblings = target.place.spots.map(s => s.name).join(', ');
      lines.push(`   Puntos de interés de "${target.place.name}": ${siblings}`);
    }

    return {
      success: true,
      toolName: 'manage_escenario',
      result: {
        location: target.spot ?? target.place,
        collection: target.definition.name,
        isActive: target.locationId === active.locationId,
      },
      displayMessage: lines.join('\n'),
      scenarioActivation: buildActivation(context, 'get_info', active, { target, reason }),
    };
  }

  // Fallback (shouldn't happen — action is enum-validated)
  return {
    success: false,
    toolName: 'manage_escenario',
    result: null,
    displayMessage: `Acción no reconocida: "${action}". Usa "list", "go" o "get_info". Ubicación actual: "${active.locationName}".`,
    error: 'Unknown action',
  };
}

function groupFallbackMessage(characterName: string, groupName?: string): string {
  return groupName
    ? `Ni el grupo "${groupName}" ni ${characterName} tienen un escenario configurado. Se necesita la Biblioteca de Escenarios (Ajustes → Escenarios) con al menos 1 lugar, o un scenarioConfig habilitado con ubicaciones.`
    : `${characterName} no tiene un escenario configurado. Selecciona escenarios en su editor (pestaña Escenario) o crea colecciones en Ajustes → Escenarios.`;
}

// Re-export for typed consumers
export type { SpritePose };
