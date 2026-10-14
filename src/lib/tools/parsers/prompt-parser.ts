// ============================================
// Prompt-Based Tool Call Parser
// ============================================
//
// Parses tool calls from LLM text output when the model
// doesn't support native tool calling (e.g., LM Studio with
// models that generate tool call JSON as text content).
//
// Expected formats in LLM output:
//   ```tool_call
//   {"name": "tool_name", "parameters": {"key": "value"}}
//   ```
//
//   TOOL_CALL: name | {"key": "value"}
//
//   {"type": "function", "name": "search_web", "parameters": {"query": "..."}}
//
//   {"name": "search_web", "arguments": {"query": "..."}}
//
// Bracket shorthand (seen on grok-4.x models that skip native calling):
//   [modifystat:statname:lujuria new_value:+18 reason:arrodillada]
//
// Bracketed tool name + prose + embedded JSON (also seen on grok-4.x):
//   [modifystat with changes is [{"stat_name":"hambre","new_value":"+5","reason":"..."}]]
//
// Supports nested JSON objects via brace-counting extraction.

import type { ParsedToolCall } from '../types';

// ============================================
// Bracket-Format Tool Calls
// ============================================
// The tool name inside brackets is matched against the known tool registry
// (ignoring underscores/case) so narrative brackets like [nota: ...] or
// timestamps like [12:30] can never be mistaken for a tool call.

const DEFAULT_KNOWN_TOOL_NAMES = [
  'roll_dice', 'search_memory', 'get_weather', 'search_web', 'set_reminder',
  'modify_stat', 'check_stat', 'manage_quest', 'manage_solicitud', 'manage_memory',
  'manage_action', 'manage_scene', 'manage_relationship', 'skill_check',
  'manage_time', 'manage_wardrobe', 'manage_escenario',
];

/** normalized tool name -> canonical registered name */
let knownToolNameMap: Map<string, string> | null = null;

function normalizeToolName(name: string): string {
  return name.toLowerCase().replace(/[_\s-]/g, '');
}

function getKnownToolNameMap(): Map<string, string> {
  if (!knownToolNameMap) {
    knownToolNameMap = new Map();
    for (const n of DEFAULT_KNOWN_TOOL_NAMES) knownToolNameMap.set(normalizeToolName(n), n);
  }
  return knownToolNameMap;
}

/** Allows the tool registry to extend the whitelist with custom tools. */
export function registerKnownToolNamesForParsing(names: string[]): void {
  const map = getKnownToolNameMap();
  for (const n of names) {
    if (n) map.set(normalizeToolName(n), n);
  }
}

interface BracketToolCallMatch { raw: string; start: number; end: number; canonicalName: string; paramsRaw: string; }

function findBracketToolCallCandidates(text: string): BracketToolCallMatch[] {
  const results: BracketToolCallMatch[] = [];
  if (!text || !text.includes('[') || !text.includes(':')) return results;

  const known = getKnownToolNameMap();
  const re = /\[\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*:\s*([^\[\]]+?)\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const canonical = known.get(normalizeToolName(m[1]));
    if (!canonical) continue;
    // Must contain at least one "param:" segment after the tool name
    if (!/[a-zA-Z_][\w]*\s*:/.test(m[2])) continue;
    results.push({ raw: m[0], start: m.index, end: m.index + m[0].length, canonicalName: canonical, paramsRaw: m[2] });
  }
  return results;
}

// ============================================
// Bracketed Tool Name + Prose + Embedded JSON
// ============================================
// Some models (grok-4.x) write the tool call as a sentence inside brackets:
//   [modifystat with changes is [{"stat_name":"hambre","new_value":"+5"}, ...] ]
// The old colon-shorthand parser can't catch this (no "tool:param" shape and
// nested brackets), so we scan for '[' + known tool name, balance-count the
// matching ']' (string-aware) and extract the first JSON array/object inside.

interface BracketedJsonBlockMatch { raw: string; start: number; end: number; canonicalName: string; inner: string; }

/** Balance-scan (string-aware) from an opening '[' to its matching ']'. */
function findMatchingBracket(text: string, openIndex: number): number {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Find [knownToolName ... ] blocks (balanced, string-aware). */
function findBracketedToolJsonBlocks(text: string): BracketedJsonBlockMatch[] {
  const results: BracketedJsonBlockMatch[] = [];
  if (!text || !text.includes('[')) return results;

  const known = getKnownToolNameMap();
  const re = /\[\s*([a-zA-Z][a-zA-Z0-9_-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const canonical = known.get(normalizeToolName(m[1]));
    if (!canonical) continue;
    const close = findMatchingBracket(text, m.index);
    if (close === -1) continue;
    const inner = text.slice(m.index + 1 + m[1].length, close);
    results.push({
      raw: text.slice(m.index, close + 1),
      start: m.index,
      end: close + 1,
      canonicalName: canonical,
      inner,
    });
    re.lastIndex = close + 1; // continue after this block
  }
  return results;
}

/** Extract the first JSON array of objects (string-aware balance scan). */
function extractFirstJsonArrayOfObjects(text: string): string | null {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '[') continue;
    const close = findMatchingBracket(text, i);
    if (close === -1) continue;
    const candidate = text.slice(i, close + 1);
    if (candidate.includes('{')) return candidate;
  }
  return null;
}

/** Normalize a modify_stat change item from whatever field aliases the model used. */
function normalizeStatChangeItem(item: Record<string, unknown>): Record<string, unknown> | null {
  const statName = item.stat_name ?? item.statName ?? item.statname ?? item.stat ?? item.attribute ?? item.attr ?? item.key;
  const newValue = item.new_value ?? item.newValue ?? item.newvalue ?? item.value;
  if (statName === undefined || statName === null || String(statName).trim() === '') return null;
  if (newValue === undefined || newValue === null || String(newValue).trim() === '') return null;
  const normalized: Record<string, unknown> = { stat_name: String(statName).trim(), new_value: String(newValue).trim() };
  if (item.reason !== undefined && item.reason !== null && String(item.reason).trim() !== '') {
    normalized.reason = String(item.reason).trim();
  }
  return normalized;
}

/** Build ParsedToolCall args from a bracketed block's inner content. Returns null if no usable JSON. */
function parseBracketedJsonBlockArgs(canonicalName: string, inner: string): Record<string, unknown> | null {
  const normalizedTool = normalizeToolName(canonicalName);

  // 1) JSON array of objects → for modify_stat that's the "changes" batch.
  const arrayJson = extractFirstJsonArrayOfObjects(inner);
  if (arrayJson) {
    try {
      const arr = JSON.parse(arrayJson);
      if (Array.isArray(arr) && arr.length > 0 && arr.every(x => x && typeof x === 'object' && !Array.isArray(x))) {
        if (normalizedTool === 'modifystat') {
          const changes = arr.map(item => normalizeStatChangeItem(item as Record<string, unknown>)).filter(Boolean);
          if (changes.length > 0) return { changes };
          return null; // array without any stat-shaped item → not a tool call
        }
        // Other tools: pass the array under a generic key so the tool can
        // validate; nothing else in the registry consumes arrays today.
        return { items: arr };
      }
    } catch {
      // fall through to object extraction
    }
  }

  // 2) Single JSON object → generic tool call or a single stat change.
  const braceStart = inner.indexOf('{');
  if (braceStart !== -1) {
    const extracted = extractJsonObject(inner, braceStart);
    if (extracted) {
      try {
        const obj = JSON.parse(extracted.json) as Record<string, unknown>;
        // Generic envelope: {"name": "tool", "parameters"/"arguments": {...}}
        // (handled by callers via parseToolCallJSON elsewhere; here map directly)
        if (typeof obj.name === 'string' && (obj.parameters || obj.arguments)) {
          return null; // let the generic JSON-object pattern handle it
        }
        if (normalizedTool === 'modifystat') {
          if (Array.isArray(obj.changes)) {
            const changes = (obj.changes as Record<string, unknown>[])
              .map(item => normalizeStatChangeItem(item)).filter(Boolean);
            if (changes.length > 0) return { changes };
            return null;
          }
          const single = normalizeStatChangeItem(obj);
          if (single) return { changes: [single] };
          return null;
        }
        return obj; // other tools: use the object as arguments directly
      } catch {
        return null;
      }
    }
  }

  return null;
}

/** Parse [toolname ... JSON ...] blocks into tool calls. */
function parseBracketedJsonToolCalls(text: string): ParsedToolCall[] {
  const blocks = findBracketedToolJsonBlocks(text);
  const calls: ParsedToolCall[] = [];
  for (const block of blocks) {
    const args = parseBracketedJsonBlockArgs(block.canonicalName, block.inner);
    if (!args) continue;
    calls.push({ name: block.canonicalName, arguments: args, raw: block.raw });
  }
  return calls;
}

/** Parses "key:value key2:value with spaces" segments of a bracket call. */
function parseBracketParams(paramsRaw: string): Record<string, string> {
  const args: Record<string, string> = {};
  const keyRe = /([a-zA-Z_][\w]*)\s*:\s*/g;
  const marks: Array<{ key: string; valueStart: number; valueEnd: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(paramsRaw)) !== null) {
    if (marks.length > 0) marks[marks.length - 1].valueEnd = m.index;
    marks.push({ key: m[1], valueStart: m.index + m[0].length, valueEnd: paramsRaw.length });
  }
  for (const mark of marks) {
    const value = paramsRaw.slice(mark.valueStart, mark.valueEnd).trim();
    if (value) args[mark.key] = value;
  }
  return args;
}

/** Maps bracket-shorthand args to the tool's native argument schema. */
function coerceBracketArguments(canonicalName: string, args: Record<string, string>): Record<string, unknown> {
  const normalized = normalizeToolName(canonicalName);
  // modify_stat expects changes: [{stat_name, new_value, reason}]
  if (normalized === 'modifystat' && !args.changes) {
    const statName = args.statname || args.stat_name || args.stat || args.attribute || '';
    if (statName) {
      return {
        changes: [{
          stat_name: statName,
          new_value: args.new_value ?? args.value ?? '',
          reason: args.reason || 'Cambio narrado por el personaje',
        }],
      };
    }
  }
  return { ...args };
}

function parseBracketToolCalls(text: string): ParsedToolCall[] {
  const matches = findBracketToolCallCandidates(text);
  const calls: ParsedToolCall[] = [];
  for (const match of matches) {
    const params = parseBracketParams(match.paramsRaw);
    if (Object.keys(params).length === 0) continue;
    calls.push({
      name: match.canonicalName,
      arguments: coerceBracketArguments(match.canonicalName, params),
      raw: match.raw,
    });
  }
  return calls;
}

/** Cheap check: text contains [name:param: ...] shaped brackets. */
function mightContainBracketToolCall(text: string): boolean {
  return /\[\s*[a-zA-Z][a-zA-Z0-9_-]*\s*:\s*[a-zA-Z_][\w]*\s*:/.test(text);
}

// ============================================
// Model Artifact Cleanup
// ============================================

/**
 * Clean special tokens and model artifacts from LLM output.
 * Handles common patterns from:
 * - LLaMA-based models (LM Studio, Ollama): <|reserved_special_token|>, <|startheader_id|>, etc.
 * - ChatML models: <im_start>, <im_end>, <|im_start|>, <|im_end|>
 * - GPT-style:  <|endofprompt|>
 * - Mistral: <s>, </s>
 * - Generic: [INST], [/INST], <<SYS>>, <</SYS>>
 */
export function cleanModelArtifacts(text: string): string {
  if (!text) return text;

  let result = text;

  // LLaMA special tokens (LM Studio common)
  // e.g., <|reserved_special_token_0|>, <|reservedspecialtoken4|>
  result = result.replace(/<\|reserved[_]?special[_]?token[_\d]*\|>/gi, '');
  // <|startheader_id|>assistant: or <|endheader_id|>
  result = result.replace(/<\|start[_]?header[_]?id\|>\s*\w*\s*:?/gi, '');
  result = result.replace(/<\|end[_]?header[_]?id\|>/gi, '');
  // <|eot_id|>, <|eos_id|>
  result = result.replace(/<\|e[oa]s[_]?id\|>/gi, '');

  // ChatML / GPT-NeoX tokens
  result = result.replace(/<\|im_start\|>\s*\w*\s*/gi, '');
  result = result.replace(/<\|im_end\|>/gi, '');

  // Generic special tokens: <|anything|>
  result = result.replace(/<\|[^>]+\|>/g, '');

  // GPT-style end tokens
  result = result.replace(/<\|endoftext\|>/gi, '');
  result = result.replace(/<\|endofprompt\|>/gi, '');

  // Mistral-style
  result = result.replace(/<\/?s>/g, '');

  // LLaMA-style instruction tokens
  result = result.replace(/\[INST\].*?\[\/INST\]\s*/gi, '');
  result = result.replace(/<<SYS>>.*?<\/SYS>>\s*/gi, '');
  result = result.replace(/\[\/INST\]/gi, '');
  result = result.replace(/\[INST\]/gi, '');

  // Clean up multiple consecutive newlines that may result from stripping
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}

// ============================================
// JSON Extraction via Brace Counting
// ============================================

/**
 * Extract a complete JSON object starting at the given position.
 * Uses brace counting to handle nested objects like:
 *   {"name": "search_web", "parameters": {"query": "...", "max_results": 5}}
 *
 * Returns { json: string, endIndex: number } or null if extraction fails.
 */
function extractJsonObject(text: string, startIndex: number): { json: string; endIndex: number } | null {
  if (startIndex >= text.length || text[startIndex] !== '{') return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        // Found the matching closing brace
        return { json: text.slice(startIndex, i + 1), endIndex: i + 1 };
      }
    }
  }

  return null; // Unmatched braces
}

/**
 * Find all JSON objects in text that look like tool calls.
 * Returns array of { json: string, start: number, end: number }.
 */
function findAllToolCallJsonObjects(text: string): Array<{ json: string; start: number; end: number }> {
  const results: Array<{ json: string; start: number; end: number }> = [];

  // Scan for opening braces
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      const extracted = extractJsonObject(text, i);
      if (extracted) {
        // Quick check: does this JSON look like a tool call?
        // Must contain "name" and either "parameters" or "arguments"
        const j = extracted.json;
        if (j.includes('"name"') && (j.includes('"parameters"') || j.includes('"arguments"'))) {
          results.push({ json: j, start: i, end: extracted.endIndex });
          i = extracted.endIndex; // Skip past this object
        } else {
          // Not a tool call, skip past the closing brace
          i = extracted.endIndex - 1;
        }
      }
    }
  }

  return results;
}

// ============================================
// Tool Call Detection (Single)
// ============================================

/**
 * Try to parse the FIRST tool call from the LLM's text output.
 * Returns null if no tool call is found.
 */
export function parseToolCallFromText(text: string): ParsedToolCall | null {
  const allCalls = parseAllToolCallsFromText(text);
  return allCalls.length > 0 ? allCalls[0] : null;
}

/**
 * Parse ALL tool calls from the LLM's text output.
 * Uses brace-counting extraction to handle nested JSON objects.
 * Returns an array of ParsedToolCall (may be empty).
 */
export function parseAllToolCallsFromText(text: string): ParsedToolCall[] {
  if (!text) return [];

  const trimmed = text.trim();

  // Early exit: if text is long and doesn't look like a tool call at all
  if (trimmed.length > 5000 && !trimmed.includes('"name"') && !mightContainToolCall(trimmed)) {
    return [];
  }

  // Pattern 1: ```tool_call ... ``` (preferred format)
  const fencedMatches = trimmed.match(/```tool_call\s*\n?([\s\S]*?)\n?```/g);
  if (fencedMatches) {
    const calls: ParsedToolCall[] = [];
    for (const fenced of fencedMatches) {
      const inner = fenced.replace(/```tool_call\s*\n?/, '').replace(/\n?```$/, '').trim();
      const parsed = parseToolCallJSON(inner);
      if (parsed) calls.push(parsed);
    }
    if (calls.length > 0) return calls;
  }

  // Pattern 2: TOOL_CALL: name | {"key": "value"} (alternative format)
  const altMatches = trimmed.match(/TOOL_CALL:\s*(\w+)\s*\|\s*(\{[\s\S]*?\})/gi);
  if (altMatches) {
    const calls: ParsedToolCall[] = [];
    for (const alt of altMatches) {
      const m = alt.match(/TOOL_CALL:\s*(\w+)\s*\|\s*(\{[\s\S]*?\})/i);
      if (m) {
        try {
          const args = JSON.parse(m[2]);
          calls.push({ name: m[1].trim(), arguments: args, raw: m[0] });
        } catch {
          // Skip invalid
        }
      }
    }
    if (calls.length > 0) return calls;
  }

  // Pattern 3: Standalone JSON tool calls using brace-counting extraction
  // This handles nested objects like:
  //   {"type": "function", "name": "search_web", "parameters": {"query": "...", "max_results": 5}}
  const jsonObjects = findAllToolCallJsonObjects(trimmed);
  if (jsonObjects.length > 0) {
    const calls: ParsedToolCall[] = [];
    for (const { json } of jsonObjects) {
      const parsed = parseToolCallJSON(json);
      if (parsed) calls.push(parsed);
    }
    if (calls.length > 0) return calls;
  }

  // Pattern 4: Bracket shorthand — [toolname:param:value param2:value2]
  // (grok-4.x sometimes emits these instead of native function calling)
  const bracketCalls = parseBracketToolCalls(trimmed);
  if (bracketCalls.length > 0) return bracketCalls;

  // Pattern 5: Bracketed tool name + prose + embedded JSON array/object —
  //   [modifystat with changes is [{"stat_name":"hambre","new_value":"+5"}, ...]]
  // (grok-4.x narration-style tool calls that skip native function calling)
  const jsonBracketCalls = parseBracketedJsonToolCalls(trimmed);
  if (jsonBracketCalls.length > 0) return jsonBracketCalls;

  return [];
}

/**
 * Check if text looks like it might contain a tool call.
 * This is a fast pre-check to avoid full parsing on obvious non-tool-call text.
 */
export function mightContainToolCall(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();

  // Fast checks for likely tool call indicators
  if (trimmed.startsWith('```tool_call')) return true;
  if (trimmed.match(/TOOL_CALL:/i)) return true;
  // Bracket shorthand: [toolname:param:value ...]
  if (mightContainBracketToolCall(trimmed)) return true;
  // Bracketed tool name + prose + embedded JSON: [modifystat with changes is [{...}]]
  if (/\[\s*[a-zA-Z][a-zA-Z0-9_-]*\s+[^\[\]]{0,300}?\[\s*\{/.test(trimmed)) return true;
  // Match JSON containing tool call fields
  if (trimmed.includes('"name"') && (trimmed.includes('"parameters"') || trimmed.includes('"arguments"'))) {
    if (trimmed.includes('{') && (trimmed.includes('"type": "function"') || trimmed.includes('"type":"function"'))) return true;
    // Or just {"name": "...", "parameters"/"arguments": {...}}
    if (/\"name\"\s*:\s*\"[^\"]+\"/.test(trimmed)) return true;
  }
  if (trimmed.includes('"type": "function"') || trimmed.includes('"type":"function"')) return true;

  return false;
}

/**
 * Parse tool call from a JSON string
 */
function parseToolCallJSON(jsonStr: string): ParsedToolCall | null {
  try {
    // Try direct parse
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed.name === 'string' && parsed.name.trim()) {
      return {
        name: parsed.name.trim(),
        arguments: (parsed.parameters || parsed.arguments || {}),
        raw: jsonStr,
      };
    }
  } catch {
    // Try fixing common issues
    try {
      const fixed = jsonStr
        .replace(/,\s*([}\]])/g, '$1') // trailing commas
        .replace(/[\u2018\u2019]/g, "'")   // smart quotes
        .replace(/[\u201C\u201D]/g, '"');
      const parsed = JSON.parse(fixed);
      if (parsed && typeof parsed.name === 'string' && parsed.name.trim()) {
        return {
          name: parsed.name.trim(),
          arguments: (parsed.parameters || parsed.arguments || {}),
          raw: jsonStr,
        };
      }
    } catch {
      // Give up
    }
  }

  return null;
}

/**
 * Remove ALL tool call portions from the LLM's text,
 * returning only the natural language response.
 * Also cleans model artifacts (special tokens).
 * Uses brace-counting for proper nested JSON removal.
 */
export function stripToolCallFromText(text: string): string {
  if (!text) return text;

  let result = text;

  // Remove ```tool_call ... ``` blocks
  result = result.replace(/```tool_call\s*\n?[\s\S]*?\n?```/g, '');

  // Remove TOOL_CALL: lines
  result = result.replace(/TOOL_CALL:\s*\w+\s*\|\s*\{[\s\S]*?\}/gi, '');

  // Remove standalone JSON tool calls using brace-counting extraction
  // Find all JSON objects that look like tool calls and remove them
  const jsonObjects = findAllToolCallJsonObjects(result);
  // Sort by start position (descending) so we can remove from end to start
  jsonObjects.sort((a, b) => b.start - a.start);
  for (const { json, start, end } of jsonObjects) {
    result = result.slice(0, start) + result.slice(end);
  }

  // Remove bracketed tool-name blocks with embedded JSON:
  //   [modifystat with changes is [{...}, ...]]
  // (only blocks whose JSON extraction produced real args are removed)
  const jsonBracketBlocks = findBracketedToolJsonBlocks(result)
    .filter(block => parseBracketedJsonBlockArgs(block.canonicalName, block.inner) !== null);
  jsonBracketBlocks.sort((a, b) => b.start - a.start);
  for (const { start, end } of jsonBracketBlocks) {
    result = result.slice(0, start) + result.slice(end);
  }

  // Remove bracket shorthand tool calls: [toolname:param:value ...]
  const bracketMatches = findBracketToolCallCandidates(result);
  bracketMatches.sort((a, b) => b.start - a.start);
  for (const { start, end } of bracketMatches) {
    result = result.slice(0, start) + result.slice(end);
  }

  // Clean model artifacts (special tokens from LLaMA, Mistral, etc.)
  result = cleanModelArtifacts(result);

  return result.trim();
}

/**
 * Split text into chunks for replaying buffered content as streaming tokens.
 */
export function splitIntoChunks(text: string, chunkSize: number = 3): string[] {
  if (!text) return [];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}
