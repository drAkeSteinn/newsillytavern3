/**
 * Text Splitters for Embedding Chunking
 * 
 * Different strategies for splitting text into chunks before embedding.
 */

export interface SplitterConfig {
  chunkSize: number;
  chunkOverlap: number;
}

export interface ChunkResult {
  chunks: string[];
  totalChunks: number;
  totalCharacters: number;
  avgChunkSize: number;
}

export type SplitterType =
  | 'character'
  | 'recursive-character'
  | 'markdown'
  | 'code';

// ============ Character Text Splitter ============
// Simple split by character count

export function characterTextSplit(
  text: string,
  config: SplitterConfig
): ChunkResult {
  const { chunkSize, chunkOverlap } = config;
  if (!text || text.trim().length === 0) {
    return { chunks: [], totalChunks: 0, totalCharacters: 0, avgChunkSize: 0 };
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    let chunk = text.slice(start, end);

    // If not at the end, try to break at a space
    if (end < text.length) {
      const lastSpace = chunk.lastIndexOf(' ');
      if (lastSpace > chunkSize * 0.5) {
        chunk = chunk.slice(0, lastSpace);
        start += lastSpace + 1;
      } else {
        start = end;
      }
    } else {
      start = end;
    }

    if (chunk.trim()) {
      chunks.push(chunk.trim());
    }

    // Apply overlap
    if (chunkOverlap > 0 && chunks.length > 0) {
      const lastChunk = chunks[chunks.length - 1];
      const overlapStart = Math.max(0, lastChunk.length - chunkOverlap);
      start = Math.max(start - (lastChunk.length - overlapStart), start);
    }
  }

  return {
    chunks,
    totalChunks: chunks.length,
    totalCharacters: text.length,
    avgChunkSize: chunks.length > 0 ? Math.round(chunks.reduce((a, c) => a + c.length, 0) / chunks.length) : 0,
  };
}

// ============ Recursive Character Text Splitter ============
// Splits by separators in order: \n\n, \n, space, then character

const RECURSIVE_SEPARATORS = ['\n\n', '\n', ' ', ''];

export function recursiveCharacterSplit(
  text: string,
  config: SplitterConfig
): ChunkResult {
  const { chunkSize, chunkOverlap } = config;
  if (!text || text.trim().length === 0) {
    return { chunks: [], totalChunks: 0, totalCharacters: 0, avgChunkSize: 0 };
  }

  const chunks = splitTextWithOverlap(text, chunkSize, chunkOverlap);

  return {
    chunks,
    totalChunks: chunks.length,
    totalCharacters: text.length,
    avgChunkSize: chunks.length > 0 ? Math.round(chunks.reduce((a, c) => a + c.length, 0) / chunks.length) : 0,
  };
}

function splitTextWithOverlap(
  text: string,
  chunkSize: number,
  chunkOverlap: number
): string[] {
  // Try each separator
  for (const separator of RECURSIVE_SEPARATORS) {
    const splits = separator === '' ? text.split('') : text.split(separator);

    // If all splits are small enough, we can use this separator
    if (splits.every(s => s.length <= chunkSize)) {
      return mergeSplits(splits, separator, chunkSize, chunkOverlap);
    }
  }

  // Fallback: character-by-character
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    start = end - chunkOverlap;
  }
  return chunks;
}

function mergeSplits(
  splits: string[],
  separator: string,
  chunkSize: number,
  chunkOverlap: number
): string[] {
  const chunks: string[] = [];
  let currentChunk = '';

  for (const split of splits) {
    if (!split) continue;

    if (currentChunk.length + split.length + (separator ? separator.length : 0) <= chunkSize) {
      currentChunk += (currentChunk ? separator : '') + split;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }

      // Start new chunk with overlap
      if (chunkOverlap > 0 && currentChunk) {
        const overlapText = currentChunk.slice(-chunkOverlap);
        currentChunk = overlapText + (separator ? separator : '') + split;
      } else {
        currentChunk = split;
      }
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

// ============ Markdown Text Splitter ============
// Splits by markdown headings first, then recursively.
// FASE 16: Preserves heading hierarchy context in each chunk —
// each chunk starts with its section heading so the embedding
// captures what the section is about.

export function markdownTextSplit(
  text: string,
  config: SplitterConfig
): ChunkResult {
  const { chunkSize, chunkOverlap } = config;
  if (!text || text.trim().length === 0) {
    return { chunks: [], totalChunks: 0, totalCharacters: 0, avgChunkSize: 0 };
  }

  // Split by headings (# ## ### etc.)
  // Match: # Heading, ## Heading, ### Heading, etc.
  const headingRegex = /^(#{1,6})\s+.+$/gm;
  const sections: Array<{ heading: string; content: string; level: number }> = [];
  let lastIndex = 0;
  let match;

  // Track heading hierarchy for context
  const headingStack: string[] = [];

  while ((match = headingRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      // Content before this heading (preamble)
      const preamble = text.slice(lastIndex, match.index).trim();
      if (preamble) {
        sections.push({
          heading: headingStack.length > 0 ? headingStack[headingStack.length - 1] : '',
          content: preamble,
          level: 0,
        });
      }
    }

    // Parse the heading
    const fullHeading = match[0]; // e.g., "## Escuela Secundaria: la fama se le adelanta"
    const level = match[1].length; // number of # (1-6)

    // Update heading stack
    while (headingStack.length >= level) {
      headingStack.pop();
    }
    headingStack.push(fullHeading);

    // Find the end of this heading's content (start of next heading or end of text)
    lastIndex = match.index;
    headingRegex.lastIndex = match.index + match[0].length;
    const nextMatch = headingRegex.exec(text);
    const sectionEnd = nextMatch ? nextMatch.index : text.length;
    // Reset lastIndex to continue from current position
    headingRegex.lastIndex = match.index + match[0].length;

    const sectionContent = text.slice(lastIndex, sectionEnd).trim();

    sections.push({
      heading: fullHeading,
      content: sectionContent,
      level,
    });

    lastIndex = sectionEnd;
  }

  // Handle remaining content after last heading
  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex).trim();
    if (remaining) {
      sections.push({
        heading: headingStack.length > 0 ? headingStack[headingStack.length - 1] : '',
        content: remaining,
        level: 0,
      });
    }
  }

  // If no sections found (no headings), treat entire text as one section
  if (sections.length === 0) {
    sections.push({ heading: '', content: text.trim(), level: 0 });
  }

  // Process each section: if too big, split recursively
  const chunks: string[] = [];
  for (const section of sections) {
    let sectionText = section.content;
    if (!sectionText.trim()) continue;

    // If the section is small enough, keep it as one chunk (with heading as context)
    if (sectionText.length <= chunkSize) {
      chunks.push(sectionText.trim());
    } else {
      // Split large sections recursively, but preserve the heading context
      // by prepending the heading to each sub-chunk
      const subChunks = splitTextWithOverlap(sectionText, chunkSize, chunkOverlap);
      for (const subChunk of subChunks) {
        // If the sub-chunk doesn't already start with the heading, and there's room, prepend it
        if (section.heading && !subChunk.startsWith(section.heading)) {
          const headingPrefix = section.heading + '\n';
          if (subChunk.length + headingPrefix.length <= chunkSize) {
            chunks.push((headingPrefix + subChunk).trim());
          } else {
            chunks.push(subChunk.trim());
          }
        } else {
          chunks.push(subChunk.trim());
        }
      }
    }
  }

  return {
    chunks,
    totalChunks: chunks.length,
    totalCharacters: text.length,
    avgChunkSize: chunks.length > 0 ? Math.round(chunks.reduce((a, c) => a + c.length, 0) / chunks.length) : 0,
  };
}

// ============ Code Text Splitter ============
// Splits by code blocks, functions, classes

const CODE_SEPARATORS = [
  '\nclass ',
  '\nfunction ',
  '\nasync function ',
  '\nconst ',
  '\nlet ',
  '\nvar ',
  '\ndef ',
  '\nasync def ',
  '\n\n',
  '\n',
  '  ',
  ' ',
  '',
];

export function codeTextSplit(
  text: string,
  config: SplitterConfig
): ChunkResult {
  const { chunkSize, chunkOverlap } = config;
  if (!text || text.trim().length === 0) {
    return { chunks: [], totalChunks: 0, totalCharacters: 0, avgChunkSize: 0 };
  }

  // Try to split by code structures
  for (const separator of CODE_SEPARATORS) {
    const splits = text.split(separator);

    if (splits.every(s => s.length <= chunkSize)) {
      const chunks = mergeSplits(splits, separator, chunkSize, chunkOverlap);
      return {
        chunks,
        totalChunks: chunks.length,
        totalCharacters: text.length,
        avgChunkSize: chunks.length > 0 ? Math.round(chunks.reduce((a, c) => a + c.length, 0) / chunks.length) : 0,
      };
    }
  }

  // Fallback
  const chunks = splitTextWithOverlap(text, chunkSize, chunkOverlap);
  return {
    chunks,
    totalChunks: chunks.length,
    totalCharacters: text.length,
    avgChunkSize: chunks.length > 0 ? Math.round(chunks.reduce((a, c) => a + c.length, 0) / chunks.length) : 0,
  };
}

// ============ Main Splitter Function ============

export function splitText(
  text: string,
  type: SplitterType,
  config: SplitterConfig
): ChunkResult {
  switch (type) {
    case 'character':
      return characterTextSplit(text, config);
    case 'recursive-character':
      return recursiveCharacterSplit(text, config);
    case 'markdown':
      return markdownTextSplit(text, config);
    case 'code':
      return codeTextSplit(text, config);
    default:
      return recursiveCharacterSplit(text, config);
  }
}

export const SPLITTER_INFO: Record<SplitterType, { name: string; description: string; defaultChunkSize: number; defaultOverlap: number }> = {
  'character': {
    name: 'Character Text Splitter',
    description: 'Simple split by character count. Breaks at spaces when possible.',
    defaultChunkSize: 1000,
    defaultOverlap: 200,
  },
  'recursive-character': {
    name: 'Recursive Character Splitter',
    description: 'Tries multiple separators (paragraphs, lines, words) for natural breaks.',
    defaultChunkSize: 1000,
    defaultOverlap: 200,
  },
  'markdown': {
    name: 'Markdown Text Splitter',
    description: 'Splits by markdown headings first, then recursively within sections.',
    defaultChunkSize: 1000,
    defaultOverlap: 200,
  },
  'code': {
    name: 'Code Text Splitter',
    description: 'Splits by code structures (classes, functions, blocks).',
    defaultChunkSize: 1500,
    defaultOverlap: 300,
  },
};
