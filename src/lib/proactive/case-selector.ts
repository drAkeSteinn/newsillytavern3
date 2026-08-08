// ============================================
// Proactive Case Selector
// ============================================
//
// Selecciona qué mensaje (caso) enviar en un mensaje proactivo, basándose en
// el valor actual de un atributo del personaje y las condiciones configuradas.
//
// Flujo (FASE 11 - Proactivo Condicional por Atributo):
//   1. Si proactiveAttribute no está habilitado → retorna null (el llamador
//      cae al comportamiento heredado: customPrompt / nudgeTemplate).
//   2. Lee el valor actual del atributo (attributeKey) del personaje configurado.
//   3. Ordena las condiciones por `priority` descendente (mayor prioridad primero).
//   4. La PRIMERA condición habilitada que aplique (según operador + valor) gana.
//   5. De los `cases` (habilitados) de esa condición:
//        - 0 casos   → se ignora la condición (sigue a la siguiente).
//        - 1 caso    → se envía ese caso.
//        - N casos   → según `caseMode`:
//             'linear': recorre la lista cíclicamente usando `usedCaseIndices`
//                       (1, 2, 3, 1, 2, 3, ...). El contador se mantiene en el
//                       cliente y se envía en el body del request.
//             'random': elige uno al azar evitando repetir los ya usados (si
//                       todos fueron usados, reinicia y elige al azar).
//   6. Si NINGUNA condición aplica → usa los `defaultCases` con `defaultCaseMode`.
//   7. Si tampoco hay defaultCases → retorna null (el llamador decide si salta
//      o cae a customPrompt).
//
// Esta lógica corre AMBOS lados:
//   - Cliente (use-proactive-messages.tsx): para hacer un pre-check rápido y
//     evitar un viaje al LLM si no hay ningún caso que aplicar.
//   - Servidor (api/chat/proactive/route.ts): para hacer la selección real y
//     resolver las keys de lorebook en el contenido del caso.
//
// `usedCaseIndices` es un mapa: { [conditionId | '__default__']: number[] }
// que registra los índices ya enviados por condición. El servidor lo recibe
// del cliente para mantener el estado de rotación entre triggers.

import type {
  ProactiveAttributeConfig,
  ProactiveAttributeCondition,
  ProactiveCase,
  SessionStats,
} from '@/types';
import { evaluateCondition } from '@/lib/attributes/condition-evaluator';

/** Clave reservada para trackear los índices usados de los defaultCases. */
export const DEFAULT_CASES_KEY = '__default__';

export interface SelectedProactiveCase {
  /** Contenido crudo del caso seleccionado (sin resolver keys todavía). */
  content: string;
  /** Índice del caso dentro de su contenedor (condición o defaultCases). */
  caseIndex: number;
  /**
   * ID de la condición que aplicó, o `null` si se usaron los defaultCases
   * (porque ninguna condición aplicó).
   */
  conditionId: string | null;
  /** Clave bajo la cual se trackean los índices usados (conditionId o DEFAULT_CASES_KEY). */
  trackingKey: string;
  /** Nueva lista de índices usados para esta trackingKey (el llamador la persiste). */
  nextUsed: number[];
}

export type UsedCaseIndices = Record<string, number[]>;

/**
 * Resuelve el characterId efectivo: '__char__' → currentCharacterId,
 * '__user__' se deja tal cual (el llamador sabe cómo manejarlo), IDs
 * específicos se devuelven intactos.
 */
function resolveCharacterId(
  characterId: string,
  currentCharacterId: string | undefined
): string {
  if (characterId === '__char__') {
    return currentCharacterId ?? '__char__';
  }
  return characterId;
}

/**
 * Obtiene el valor actual de un atributo para un personaje desde SessionStats.
 */
export function getAttributeValue(
  sessionStats: SessionStats | undefined,
  characterId: string,
  attributeKey: string
): number | string | null {
  if (!sessionStats?.characterStats) return null;
  const stats = sessionStats.characterStats[characterId];
  if (!stats?.attributeValues) return null;
  const value = stats.attributeValues[attributeKey];
  if (value === undefined || value === null) return null;
  return value;
}

/**
 * Selecciona un caso de la lista usando el modo 'linear' o 'random',
 * respetando los índices ya usados para evitar repetición inmediata.
 *
 * - 'linear': nextIndex = usedCount % cases.length  (cíclico).
 * - 'random': elige al azar entre los no usados; si todos usados, reinicia.
 *
 * Retorna el índice seleccionado y la nueva lista de usados (para que el
 * llamador la persista).
 */
export function pickCaseIndex(
  cases: ProactiveCase[],
  mode: 'linear' | 'random',
  usedIndices: number[] = []
): { index: number; nextUsed: number[] } {
  // Filtra sólo casos habilitados (enabled !== false).
  const eligibleIndices: number[] = [];
  for (let i = 0; i < cases.length; i++) {
    if (cases[i].enabled !== false) eligibleIndices.push(i);
  }
  if (eligibleIndices.length === 0) {
    return { index: -1, nextUsed: usedIndices };
  }
  if (eligibleIndices.length === 1) {
    const idx = eligibleIndices[0];
    return { index: idx, nextUsed: [...usedIndices, idx] };
  }

  if (mode === 'linear') {
    // Cíclico: el siguiente índice elegible basado en cuántos se han usado.
    const usedCount = usedIndices.length;
    const positionInEligible = usedCount % eligibleIndices.length;
    const idx = eligibleIndices[positionInEligible];
    return { index: idx, nextUsed: [...usedIndices, idx] };
  }

  // mode === 'random'
  const usedSet = new Set(usedIndices);
  const unused = eligibleIndices.filter((i) => !usedSet.has(i));
  const pool = unused.length > 0 ? unused : eligibleIndices;
  const idx = pool[Math.floor(Math.random() * pool.length)];
  // Si reiniciamos el pool (todos usados), empezamos de nuevo con sólo este.
  let nextUsed: number[];
  if (unused.length === 0) {
    nextUsed = [idx];
  } else {
    nextUsed = [...usedIndices, idx];
  }
  return { index: idx, nextUsed };
}

/**
 * Selecciona el caso proactivo según la configuración y el valor actual
 * del atributo. Ver SelectProactiveCase para el contrato del retorno.
 *
 * Retorna `null` si:
 *   - proactiveAttribute no está habilitado.
 *   - el atributo no existe / es null Y no hay defaultCases.
 *   - ninguna condición aplica y no hay defaultCases.
 * En esos casos el llamador debe caer al comportamiento heredado.
 */
export function selectProactiveCase(
  config: ProactiveAttributeConfig | undefined,
  sessionStats: SessionStats | undefined,
  currentCharacterId: string | undefined,
  usedCaseIndices: UsedCaseIndices = {}
): SelectedProactiveCase | null {
  if (!config?.enabled) return null;

  const resolvedCharId = resolveCharacterId(config.characterId, currentCharacterId);
  const attrValue = getAttributeValue(sessionStats, resolvedCharId, config.attributeKey);

  // Ordena condiciones por prioridad descendente (mayor prioridad primero).
  // Las condiciones deshabilitadas (enabled === false) se omiten.
  const sortedConditions = [...config.conditions]
    .filter((c) => c.enabled !== false)
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

  for (const cond of sortedConditions) {
    // Si el atributo es null (no existe), la condición no puede aplicar
    // (evaluateCondition ya retorna false para null, pero lo explicitamos).
    const matches = evaluateCondition(attrValue, cond.operator, cond.value);
    if (!matches) continue;

    // Casos habilitados de esta condición.
    const enabledCases = cond.cases;
    if (enabledCases.length === 0) continue;

    const trackingKey = cond.id;
    const used = usedCaseIndices[trackingKey] ?? [];
    const { index, nextUsed } = pickCaseIndex(enabledCases, cond.caseMode, used);

    // Si pickCaseIndex retornó -1 (ningún caso habilitado), seguimos.
    if (index < 0) continue;

    // Nota: el llamador debe actualizar usedCaseIndices[trackingKey] = nextUsed.
    // Lo retornamos via el campo `nextUsed` para que el servidor lo emita por SSE.
    return {
      content: enabledCases[index].content,
      caseIndex: index,
      conditionId: cond.id,
      trackingKey,
      nextUsed,
    };
  }

  // Ninguna condición aplicó → defaultCases.
  if (config.defaultCases.length > 0) {
    const used = usedCaseIndices[DEFAULT_CASES_KEY] ?? [];
    const { index, nextUsed } = pickCaseIndex(
      config.defaultCases,
      config.defaultCaseMode,
      used
    );
    if (index >= 0) {
      return {
        content: config.defaultCases[index].content,
        caseIndex: index,
        conditionId: null,
        trackingKey: DEFAULT_CASES_KEY,
        nextUsed,
      };
    }
  }

  return null;
}

/**
 * Helper para construir un `UsedCaseIndices` actualizado tras una selección.
 * Si la trackingKey ya existía, se reemplaza con `nextUsed`.
 */
export function withUpdatedUsedIndices(
  current: UsedCaseIndices,
  trackingKey: string,
  nextUsed: number[]
): UsedCaseIndices {
  return { ...current, [trackingKey]: nextUsed };
}
