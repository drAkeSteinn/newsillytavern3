'use client';

// ============================================
// Fake streaming (typewriter) helper
// ============================================
//
// Some LLM providers (notably Grok, and some Ollama / KoboldCPP setups)
// deliver the entire assistant response in a single SSE chunk instead of
// streaming token-by-token. When that happens the chat shows the whole text
// at once, which breaks immersion: no typewriter effect, and sound/sprite
// triggers that rely on incremental content scanning fire all at once.
//
// This helper re-introduces a smooth typewriter effect on the CLIENT side:
// it accepts the full text and gradually reveals it word-by-word (or
// chunk-by-chunk), invoking a callback for each partial reveal so the UI
// can update `streamingContent` and triggers can be processed incrementally.
//
// The same pattern is already used by the "Replay" feature in chat-panel.tsx.
//
// Behaviour:
//   - Splits text into tokens (words + whitespace + punctuation) to preserve
//     formatting exactly (no lost spaces, no mangled punctuation).
//   - Respects TypewriterSettings (speed in chars/sec, pauseOnPunctuation,
//     punctuationPauseMs, startDelay).
//   - Cancellable via the provided isStillActive() callback — important so a
//     new generation or an interrupt can abort an in-flight typewriter.
//   - Resolves before the final `addMessage` is dispatched, so post-message
//     effects (TTS, Text Actions scan) only fire once the typewriter is done.

import type { TypewriterSettings } from '@/types';

export interface TypewriterCallbacks {
  /** Called for each revealed partial (the full accumulated text so far). */
  onChunk: (accumulated: string) => void;
  /** Called once the typewriter has finished revealing the full text. */
  onDone: () => void;
}

export interface TypewriterOptions {
  /** Cancellation guard. Return false to abort the typewriter mid-flight. */
  isStillActive: () => boolean;
  /** Optional delay clamp (ms) — overrides settings for safety. */
  maxDelayMs?: number;
}

/** Default settings used when none provided (mirrors DEFAULT_DIALOGUE_SETTINGS). */
const DEFAULT_TYPEWRITER: TypewriterSettings = {
  enabled: true,
  speed: 50,
  startDelay: 0,
  pauseOnPunctuation: true,
  punctuationPauseMs: 100,
  cursorChar: '▋',
  showCursor: true,
  cursorBlinkMs: 530,
};

/**
 * Split text into reveal tokens preserving all whitespace and punctuation so
 * the reconstructed string is byte-identical to the input.
 *
 * Strategy: split by word boundaries but keep the separators. We use a regex
 * that captures words, runs of whitespace, and individual punctuation marks
 * as separate tokens.
 */
function splitRevealTokens(text: string): string[] {
  if (!text) return [];
  // Match: sequences of word chars (incl. accented), OR sequences of
  // whitespace, OR any single non-word/non-whitespace char (punctuation).
  const re = /[\wÀ-ÿ\u00f1\u00d1]+|\s+|[^\w\s]/g;
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tokens.push(m[0]);
  }
  return tokens;
}

/**
 * Compute the delay (ms) before revealing the NEXT token, given the just-revealed
 * character. Base delay comes from `speed` (chars/sec). If `pauseOnPunctuation`
 * is enabled, sentence-ending punctuation adds an extra pause.
 */
function computeDelay(
  lastChar: string,
  settings: TypewriterSettings,
  maxDelayMs: number | undefined,
): number {
  // Base per-token delay: convert chars/sec to ms/char.
  const basePerChar = settings.speed > 0 ? 1000 / settings.speed : 20;
  let delay = basePerChar;
  if (settings.pauseOnPunctuation && /[.!?…]/.test(lastChar)) {
    delay += settings.punctuationPauseMs;
  }
  if (maxDelayMs !== undefined && delay > maxDelayMs) {
    delay = maxDelayMs;
  }
  // Never go below ~8ms so we yield to the event loop.
  return Math.max(8, delay);
}

/**
 * Simulate a typewriter reveal of `text`.
 *
 * @param text         Full text to reveal progressively.
 * @param settings     TypewriterSettings (speed, pause, etc). If settings.enabled
 *                     is false OR text is empty, the helper resolves immediately
 *                     after a single onChunk.
 * @param callbacks    onChunk(accumulated) called for each partial; onDone() at the end.
 * @param options      Cancellation + delay clamp.
 */
export async function simulateTypewriter(
  text: string,
  settings: TypewriterSettings | undefined,
  callbacks: TypewriterCallbacks,
  options: TypewriterOptions,
): Promise<void> {
  const cfg = settings ?? DEFAULT_TYPEWRITER;

  // Fast path: typewriter disabled, empty text, or cancellation already
  // tripped — emit the full text in one shot and finish.
  if (!cfg.enabled || !text || !options.isStillActive()) {
    callbacks.onChunk(text);
    callbacks.onDone();
    return;
  }

  // Optional start delay.
  if (cfg.startDelay > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, cfg.startDelay));
    if (!options.isStillActive()) {
      callbacks.onChunk(text);
      callbacks.onDone();
      return;
    }
  }

  const tokens = splitRevealTokens(text);
  let accumulated = '';
  let lastChar = '';

  for (let i = 0; i < tokens.length; i++) {
    if (!options.isStillActive()) {
      // Aborted: flush the rest so downstream sees the full text.
      accumulated += tokens.slice(i).join('');
      callbacks.onChunk(accumulated);
      callbacks.onDone();
      return;
    }

    const token = tokens[i];
    accumulated += token;

    // Reveal and trigger side-effects.
    callbacks.onChunk(accumulated);

    // Track last non-whitespace char for punctuation pause.
    if (token.trim().length > 0) {
      lastChar = token[token.length - 1] || lastChar;
    }

    const delay = computeDelay(lastChar, cfg, options.maxDelayMs);
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
  }

  callbacks.onDone();
}

/**
 * Heuristic: should a chunk of received content be routed through the
 * typewriter instead of being shown immediately?
 *
 * Providers that stream token-by-token produce many small chunks (<~20 chars);
 * providers that return the whole reply at once produce one giant chunk. We
 * trigger fake-streaming when a single delta is large enough that showing it
 * raw would look like a "dump".
 *
 * Also returns true when the chunk ends a sentence and looks like a final
 * block (heuristic: contains a newline + substantial length).
 */
export function shouldFakeStream(chunk: string, threshold = 120): boolean {
  if (!chunk) return false;
  return chunk.length >= threshold;
}
