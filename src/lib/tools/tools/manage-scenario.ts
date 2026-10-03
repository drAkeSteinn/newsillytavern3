// ============================================
// Tool: Manage Scenario (ESCENARIO V2)
// ============================================
// Category: in_character
// Lets the character manage the scene location: see the available locations
// and MOVE the scene to one by name or id. The active location is stored in
// the SESSION state (SessionStats.activeScenarioId — shared by all chat
// participants) and its description is injected via {{escenario}}.
//
// Actions:
// - list:     see all locations (names + descriptions + which is active/default)
// - go:       move the scene to a specific location (by name or id)
// - get_info: details of the current location (or a specific one)
//
// After a "go", the next turn's {{escenario}} key injects the new location's
// description, and the change persists in the session JSON.

import type { ToolDefinition, ToolContext, ToolExecutionResult } from '../types';
import {
  getScenarioInfo,
  resolveActiveLocation,
  findLocationByNameOrId,
  isScenarioAvailable,
} from '@/lib/scenario';

export const manageScenarioTool: ToolDefinition = {
  id: 'manage_escenario',
  name: 'manage_escenario',
  label: 'Gestionar Escenario',
  icon: 'MapPin',
  description:
    'Gestiona la ubicación de la escena. Permite ver los lugares disponibles y mover la escena ' +
    'al que quieras (por nombre o id) o ver dónde estáis ahora. ' +
    'La ubicación actual se inyecta en tu prompt como [ESCENARIO]. ' +
    'Usa "list" para ver los lugares disponibles y "go" para mover la escena según la narrativa.',
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
          'Nombre o id del lugar (para "go" y "get_info"). Ej: "Cama", "Sofá", "Escritorio", "Departamento". ' +
          'Debe coincidir con un lugar de tu escenario.',
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

  // ESCENARIO V2 (groups): context.group carries the group — when it has its
  // own usable scenarioConfig it REPLACES the character-level one so all
  // members share the same scene locations.
  const group = context.group;

  if (!isScenarioAvailable(character, group)) {
    return {
      success: false,
      toolName: 'manage_escenario',
      result: null,
      displayMessage: group
        ? `El escenario no está configurado ni para el grupo "${group.name}" ni para ${character.name}. Se necesita un escenario habilitado con al menos 1 ubicación.`
        : 'El escenario no está configurado para este personaje. Necesita un scenarioConfig habilitado con al menos 1 ubicación.',
      error: 'Scenario not available',
    };
  }

  const info = getScenarioInfo(character, context.sessionStats, group);
  if (!info) {
    return {
      success: false,
      toolName: 'manage_escenario',
      result: null,
      displayMessage: 'No se pudo resolver la información del escenario.',
      error: 'Scenario info unavailable',
    };
  }

  const current = info.current;
  const scopeLabel = info.isGroupScenario ? `el grupo ${group?.name}` : character.name;

  // LIST: show all locations
  if (action === 'list') {
    const lines = [
      `📍 **Escenario de ${scopeLabel}** (${info.totalLocations} ubicaciones):`,
      '',
    ];
    for (const location of info.locations) {
      const isActive = current?.id === location.id;
      const isDefault = info.defaultId === location.id;
      const badges = [
        isActive ? '← ubicación actual' : '',
        isDefault ? '(predeterminado)' : '',
      ].filter(Boolean).join(' ');
      lines.push(`• "${location.name}"${badges ? ` ${badges}` : ''}`);
      if (location.description?.trim()) {
        lines.push(`  ${location.description.trim()}`);
      }
    }
    lines.push('');
    lines.push('Usa "go" con el nombre del lugar al que quieras mover la escena.');

    return {
      success: true,
      toolName: 'manage_escenario',
      result: {
        locations: info.locations,
        currentLocationId: current?.id ?? null,
        defaultLocationId: info.defaultId,
      },
      displayMessage: lines.join('\n'),
      scenarioActivation: {
        characterId: context.characterId,
        action: 'list',
        locationId: current?.id ?? null,
        locationName: current?.name || '',
        locationDescription: current?.description || '',
        previousLocationId: current?.id ?? null,
        changed: false,
        reason: reason || undefined,
      },
    };
  }

  // GO: move the scene to a specific location (by name or id)
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

    const target = findLocationByNameOrId(info.locations, locationQuery);
    if (!target) {
      const available = info.locations.map(l => `"${l.name}"`).join(', ');
      return {
        success: false,
        toolName: 'manage_escenario',
        result: null,
        displayMessage: `No existe la ubicación "${locationQuery}" en tu escenario. Ubicaciones disponibles: ${available}.`,
        error: 'Location not found',
      };
    }

    const changed = current?.id !== target.id;
    return {
      success: true,
      toolName: 'manage_escenario',
      result: {
        action: 'go',
        locationId: target.id,
        locationName: target.name,
        previousLocation: current?.name ?? null,
      },
      displayMessage: `📍 **La escena se mueve a:** "${target.name}"${current && changed ? `\n  Antes estabais en: "${current.name}"` : ''}${reason ? `\n  Razón: ${reason}` : ''}`,
      scenarioActivation: {
        characterId: context.characterId,
        action: 'go',
        locationId: target.id,
        locationName: target.name,
        locationDescription: target.description || '',
        previousLocationId: current?.id ?? null,
        changed,
        reason: reason || undefined,
      },
    };
  }

  // GET_INFO: detail of the current location (or a specific one)
  if (action === 'get_info') {
    const target = locationQuery ? findLocationByNameOrId(info.locations, locationQuery) : current;
    if (!target) {
      return {
        success: false,
        toolName: 'manage_escenario',
        result: null,
        displayMessage: `No existe la ubicación "${locationQuery}" en tu escenario. Usa "list" para verlas.`,
        error: 'Location not found',
      };
    }

    const lines = [
      target.id === current?.id
        ? `📍 **Ubicación actual:** "${target.name}"`
        : `📍 **Ubicación:** "${target.name}" (no activa)`,
    ];
    if (target.description?.trim()) lines.push(`   ${target.description.trim()}`);
    if (info.defaultId === target.id) lines.push('   (ubicación predeterminada)');

    return {
      success: true,
      toolName: 'manage_escenario',
      result: {
        location: target,
        isActive: target.id === current?.id,
        isDefault: info.defaultId === target.id,
      },
      displayMessage: lines.join('\n'),
      scenarioActivation: {
        characterId: context.characterId,
        action: 'get_info',
        locationId: current?.id ?? null,
        locationName: current?.name || '',
        locationDescription: current?.description || '',
        previousLocationId: current?.id ?? null,
        changed: false,
        reason: reason || undefined,
      },
    };
  }

  // Fallback (shouldn't happen — action is enum-validated)
  const active = resolveActiveLocation(character, context.sessionStats, group);
  return {
    success: false,
    toolName: 'manage_escenario',
    result: null,
    displayMessage: `Acción no reconocida: "${action}". Usa "list", "go" o "get_info".${active ? ` Ubicación actual: "${active.name}".` : ''}`,
    error: 'Unknown action',
  };
}
