// ============================================
// Text Actions — client-side token scanner
// ============================================
//
// Scanner for inline tokens the LLM may write inside its response text.
// Runs client-side on the finished message and executes them through the
// same store actions the tools use.
//
// NOTE: The hardcoded prompt section that taught the LLM these tokens
// ([ACCIONES DE TEXTO — FUNCIONAN SIEMPRE]) was REMOVED. The [rel:] token
// is still documented to the LLM via the {{attributes_rulz}} block, so the
// scanner is kept to honour tokens that may still appear in responses.
//
// Supported tokens (case-insensitive, Spanish-friendly):
//   [check:stat:dificultad]   → dice check vs stat (easy|medium|hard|extreme|1-25)
//   [check:stat]              → check with default difficulty (medium)
//   [rel:+10 motivo]          → bond with the user +10 (also -N or =N)
//   [rel:Nombre:+10 motivo]   → bond with another character
//
// NOTE: [tiempo:...] tokens were removed when the app switched to the real
// system time — the LLM can no longer advance or change the clock.

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

  // NOTE: [tiempo:...] parser removed — the app now uses the real system time,
  // so the LLM can no longer advance or change it via tokens. Only [check:]
  // and [rel:] are still parsed (the latter is documented in {{attributes_rulz}}).

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
