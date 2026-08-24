// ============================================
// Tool: Manage Time (world clock)
// ============================================
// Category: cognitive
// Advances or changes the fictional world time (turn-based clock).
// Server-validate / client-execute: returns a timeActivation payload the
// CLIENT applies via statsSlice.setWorldTime / advanceWorldTime.

import type { ToolDefinition, ToolContext, ToolExecutionResult } from '../types';
import { formatWorldClock, createDefaultWorldClock } from '@/lib/world/time';

export const manageTimeTool: ToolDefinition = {
  id: 'manage_time',
  name: 'manage_time',
  label: 'Gestionar Tiempo',
  icon: 'Clock',
  description:
    'Gestiona el TIEMPO DEL MUNDO de la escena. Úsala cuando la historia haga pasar tiempo de forma ' +
    'significativa: dormir (8h), ducharse (30m), esperar a alguien, viajar, cocinar, etc. ' +
    'El tiempo también avanza solo cada turno, así que solo úsala para saltos grandes. ' +
    'Consulta con get_info el momento actual (hora, día, estación).',
  category: 'cognitive',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'enum',
        enum: ['advance', 'set_hour', 'set_season', 'get_info'],
        description: '"advance" (avanzar N minutos), "set_hour" (saltar a una hora), "set_season" (cambiar estación), "get_info" (consultar)',
        required: true,
      },
      minutes: {
        type: 'number',
        description: 'Para advance: minutos a avanzar (ej: 480 para dormir 8 horas)',
        required: false,
      },
      hour: {
        type: 'number',
        description: 'Para set_hour: hora destino 0-23',
        required: false,
      },
      minute: {
        type: 'number',
        description: 'Para set_hour: minuto destino 0-59 (opcional)',
        required: false,
      },
      season: {
        type: 'enum',
        enum: ['primavera', 'verano', 'otoño', 'invierno'],
        description: 'Para set_season: la nueva estación',
        required: false,
      },
    },
    required: ['action'],
  },
  permissionMode: 'auto',
};

export async function manageTimeExecutor(
  params: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolExecutionResult> {
  const action = String(params.action || '').toLowerCase().trim();
  const fail = (msg: string, err: string): ToolExecutionResult => ({
    success: false, toolName: 'manage_time', result: null, displayMessage: msg, error: err,
  });

  const clock = context.sessionStats?.worldClock || createDefaultWorldClock();
  const nowStr = formatWorldClock(clock);

  if (action === 'get_info') {
    return {
      success: true,
      toolName: 'manage_time',
      result: { totalMinutes: clock.totalMinutes, minutesPerTurn: clock.minutesPerTurn, season: clock.season },
      displayMessage: `🕐 Tiempo del mundo: ${nowStr} (avanza ${clock.minutesPerTurn} min por turno)`,
    };
  }

  if (action === 'advance') {
    const minutes = typeof params.minutes === 'number' ? params.minutes : NaN;
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return fail('Error: advance requiere minutes > 0 (ej: 480 para 8 horas).', 'Missing minutes');
    }
    return {
      success: true,
      toolName: 'manage_time',
      result: { minutes },
      displayMessage: `🕐 El tiempo avanza ${Math.round(minutes)} minutos (antes: ${nowStr})`,
      timeActivation: { type: 'advance', minutes: Math.round(minutes) },
    };
  }

  if (action === 'set_hour') {
    const hour = typeof params.hour === 'number' ? params.hour : NaN;
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
      return fail('Error: set_hour requiere hour 0-23.', 'Invalid hour');
    }
    const minute = typeof params.minute === 'number' ? Math.min(59, Math.max(0, params.minute)) : 0;
    return {
      success: true,
      toolName: 'manage_time',
      result: { hour, minute },
      displayMessage: `🕐 El tiempo salta a las ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} (antes: ${nowStr})`,
      timeActivation: { type: 'set_hour', hour: Math.round(hour), minute },
    };
  }

  if (action === 'set_season') {
    const season = String(params.season || '').toLowerCase().trim();
    if (!['primavera', 'verano', 'otoño', 'invierno'].includes(season)) {
      return fail('Error: estación inválida (primavera/verano/otoño/invierno).', 'Invalid season');
    }
    return {
      success: true,
      toolName: 'manage_time',
      result: { season },
      displayMessage: `🕐 Estación: ${season}`,
      timeActivation: { type: 'set_season', season },
    };
  }

  return fail(`Error: acción desconocida "${action}".`, 'Invalid action');
}
