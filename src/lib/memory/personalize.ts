// ============================================
// Memory Content Personalization ({{user}})
// ============================================
//
// Pure, dependency-free module shared by:
//   - memory-extraction.ts     (post-extraction sanitization)
//   - manage-memory.ts         (LLM tool save_memory sanitization)
//   - prompt-builder.ts        (prompt-injection safety net for stored events)
//   - character-memory-editor  (manual add + display sanitization)
//   - novel-chat-box           (manual add + display sanitization)
//
// Keeping it dependency-free lets prompt-builder import it without pulling
// the Ollama/LanceDB embedding stack into the prompt-building bundle.

/**
 * Replace generic references to the player ("el jugador", "el usuario",
 * "the player", etc.) with the persona's real name.
 *
 * Even with prompt instructions, LLMs sometimes write "El jugador" in memories
 * (especially via the manage_memory tool). This post-processing guarantees
 * memories always reference the persona by name, so they read naturally and
 * stay consistent when injected into the prompt.
 *
 * Handles Spanish contractions: "del jugador" → "de {name}", "al jugador" → "a {name}".
 * Also handles English: "the player" / "the user" / "of the player".
 */
export function personalizeMemoryContent(content: string, userName?: string): string {
  const name = userName?.trim();
  if (!name || !content) return content;

  return content
    // Spanish contractions first: "del jugador" / "del usuario" → "de {name}"
    .replace(/\bdel\s+(?:[Jj]ugador|[Jj]ugadora|[Uu]suario|[Uu]suaria)\b/g, () => `de ${name}`)
    .replace(/\bal\s+(?:[Jj]ugador|[Jj]ugadora|[Uu]suario|[Uu]suaria)\b/g, () => `a ${name}`)
    // Spanish articles: "el jugador" / "la jugadora" / "el usuario" / "la usuaria" → "{name}"
    .replace(/\b[Ee]l\s+[Jj]ugador\b/g, () => name)
    .replace(/\b[Ll]a\s+[Jj]ugadora\b/g, () => name)
    .replace(/\b[Ee]l\s+[Uu]suario\b/g, () => name)
    .replace(/\b[Ll]a\s+[Uu]suaria\b/g, () => name)
    // English articles: "the player" / "the user" → "{name}"
    .replace(/\b[Tt]he\s+[Pp]layer\b/g, () => name)
    .replace(/\b[Tt]he\s+[Uu]ser\b/g, () => name)
    .replace(/\bof\s+the\s+[Pp]layer\b/g, () => `of ${name}`)
    .replace(/\bto\s+the\s+[Pp]layer\b/g, () => `to ${name}`)
    // Standalone mentions
    .replace(/\b[Jj]ugador\b/g, () => name)
    .replace(/\b[Jj]ugadora\b/g, () => name)
    .replace(/\b[Uu]suario\b/g, () => name)
    .replace(/\b[Uu]suaria\b/g, () => name)
    .replace(/\b[Pp]layer\b/g, () => name)
    .replace(/\bUser\b/g, () => name);
}
