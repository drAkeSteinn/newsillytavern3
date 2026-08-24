// ============================================
// Text Actions — NO tool-calling required
// ============================================
//
// Universal fallback so important mechanics (dice checks, relationships,
// world time) work even when tool calling is DISABLED in the Tools panel.
// The LLM simply writes tokens inside its response text; this scanner
// (running client-side on the finished message) detects and executes them
// through the same store actions the tools use.
//
// Supported tokens (case-insensitive, Spanish-friendly):
//   [check:stat:dificultad]   → dice check vs stat (easy|medium|hard|extreme|1-25)
//   [check:stat]              → check with default difficulty (medium)
//   [rel:+10 motivo]          → bond with the user +10 (also -N or =N)
//   [rel:Nombre:+10 motivo]   → bond with another character
//   [tiempo:+2h] / [+90m]     → advance world time
//   [tiempo:22:00]            → jump to hour
//   [tiempo:estacion:invierno]→ set season
//
// Mirrors the app's dual-path philosophy: stats, skills, quests, items and
// sprites already work via text detection; now checks/relationships/time
// do too.

export interface TextCheckAction {
  kind: 'check';
  stat: string;
  difficulty: string; // 'easy'|'medium'|'hard'|'extreme' or numeric CD
  raw: string;
}

export interface TextRelAction {
  kind: 'rel';
  target?: string;    // character name (undefined = user)
  op: '+' | '-' | '=';
  value: number;
  reason?: string;
  raw: string;
}

export interface TextTimeAction {
  kind: 'tiempo';
  mode: 'advance' | 'hour' | 'season';
  minutes?: number;   // advance
  hour?: number;      // hour
  minute?: number;
  season?: string;
  raw: string;
}

export type TextAction = TextCheckAction | TextRelAction | TextTimeAction;

const DIFFICULTIES = ['easy', 'medium', 'hard', 'extreme', 'facil', 'media', 'dificil', 'extrema'];

/** Parse all text-action tokens from a message (pure) */
export function parseTextActions(content: string): TextAction[] {
  if (!content) return [];
  const actions: TextAction[] = [];

  // [check:stat] / [check:stat:difficulty] / [check:stat:12]
  const checkRe = /\[check:([a-zA-Z0-9_áéíóúñü]+)(?::([a-zA-Z0-9]+))?\]/gi;
  let m: RegExpExecArray | null;
  while ((m = checkRe.exec(content)) !== null) {
    const difficulty = (m[2] || 'medium').toLowerCase();
    actions.push({
      kind: 'check',
      stat: m[1].toLowerCase(),
      difficulty: DIFFICULTIES.includes(difficulty) ? normalizeDifficulty(difficulty) : (/^\d+$/.test(difficulty) ? difficulty : 'medium'),
      raw: m[0],
    });
  }

  // [rel:+10 motivo] / [rel:-5] / [rel:=50] / [rel:Nombre:+10 motivo]
  const relRe = /\[rel:(?:([a-zA-Z0-9_áéíóúñü ]+?):)?([+\-=]\d+)(?:\s+([^\]]+))?\]/gi;
  while ((m = relRe.exec(content)) !== null) {
    const op = m[2][0] as '+' | '-' | '=';
    actions.push({
      kind: 'rel',
      target: m[1]?.trim() || undefined,
      op,
      value: parseInt(m[2].slice(1), 10),
      reason: m[3]?.trim(),
      raw: m[0],
    });
  }

  // [tiempo:+2h] / [tiempo:+90m] / [tiempo:22:00] / [tiempo:22] / [tiempo:estacion:invierno]
  const timeRe = /\[tiempo:([^\]]+)\]/gi;
  while ((m = timeRe.exec(content)) !== null) {
    const arg = m[1].trim().toLowerCase();
    if (arg.startsWith('estacion:')) {
      actions.push({ kind: 'tiempo', mode: 'season', season: arg.slice(9).trim(), raw: m[0] });
      continue;
    }
    const adv = arg.match(/^([+\-]?)(\d+)\s*(h|hr|hora|horas)$/);
    if (adv) {
      const mins = parseInt(adv[2], 10) * 60 * (adv[1] === '-' ? -1 : 1);
      actions.push({ kind: 'tiempo', mode: 'advance', minutes: mins, raw: m[0] });
      continue;
    }
    const advM = arg.match(/^([+\-]?)(\d+)\s*(m|min|minuto|minutos)$/);
    if (advM) {
      const mins = parseInt(advM[2], 10) * (advM[1] === '-' ? -1 : 1);
      actions.push({ kind: 'tiempo', mode: 'advance', minutes: mins, raw: m[0] });
      continue;
    }
    const hour = arg.match(/^(\d{1,2})(?::(\d{2}))?$/);
    if (hour) {
      actions.push({ kind: 'tiempo', mode: 'hour', hour: parseInt(hour[1], 10), minute: hour[2] ? parseInt(hour[2], 10) : 0, raw: m[0] });
    }
  }

  return actions;
}

function normalizeDifficulty(d: string): string {
  switch (d) {
    case 'facil': return 'easy';
    case 'media': return 'medium';
    case 'dificil': return 'hard';
    case 'extrema': return 'extreme';
    default: return d;
  }
}

/** Instruction block injected into prompts so the LLM knows the tokens.
 *  Kept compact (~90 tokens). Always included — this is the universal path
 *  that works with ANY provider, even those without tool calling. */
export function buildTextActionsSection(): string {
  return [
    '[ACCIONES DE TEXTO — FUNCIONAN SIEMPRE]',
    'Además de tus herramientas, puedes incluir estos tokens EN TU RESPUESTA (el sistema los ejecuta automáticamente):',
    '- [check:stat:dificultad] — Resuelve una acción INCiertA con dados (d20 + stat del personaje indicado vs CD). Dificultades: easy/medium/hard/extreme o una CD numérica (5-25). Ejemplos: [check:fuerza:hard], [check:autocontrol], [check:carisma:14]. Úsalo SIEMPRE que el resultado de una acción no esté garantizado (convencer, seducir, resistir, forcejear, esconderse…), especialmente acciones del usuario. El sistema tira los dados; TÚ narras el resultado según el outcome que se te devuelva.',
    '- [rel:+N motivo] / [rel:-N motivo] / [rel:=N] — Cambia tu vínculo (relación) con el usuario. Ejemplos: [rel:+10 le regaló su flor favorita], [rel:-15 lo descubrió mintiendo]. Para otro personaje: [rel:Nombre:+10].',
    '- [tiempo:+2h] / [tiempo:+90m] / [tiempo:22:00] / [tiempo:estacion:invierno] — Avanza o cambia el tiempo del mundo cuando la escena lo requiera (dormir, esperar, viajar).',
    'Estos tokens son tu vía principal cuando NO tienes herramientas disponibles; con herramientas también puedes usarlos.',
  ].join('\n');
}
