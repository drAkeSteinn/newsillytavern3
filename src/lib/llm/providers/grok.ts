// ============================================
// Grok Provider (xAI) - Streaming and generation
// ============================================

import type { LLMConfig, ChatApiMessage, GenerateResponse } from '../types';
import type { ToolDefinition } from '@/lib/tools/types';
import type { ToolCallAccumulator } from '@/lib/tools/parsers/native-parser';
import { toOpenAITools } from '@/lib/tools/tool-registry';
import { processOpenAIDelta, finalizeToolCalls } from '@/lib/tools/parsers/native-parser';

const DEFAULT_TIMEOUT = 300000;

const GROK_DEFAULT_ENDPOINT = 'https://api.x.ai/v1';

// Fallback model when the config has no explicit model. Legacy names like
// `grok-4-1-fast-non-reasoning` are aliases xAI silently routes to grok-4.3,
// so we default to the current stable model directly (verified via /v1/models).
const GROK_DEFAULT_MODEL = 'grok-4.3';

/**
 * True when the configured endpoint points at the official xAI API.
 * The current xAI API rejects `frequency_penalty`, `presence_penalty` and
 * `stop` with a 400 invalid-argument for every model (empirically verified
 * on grok-4.3 / grok-4.5 / grok-4.20), so those params are only forwarded
 * to third-party OpenAI-compatible proxies where they may be supported.
 */
function isOfficialXaiEndpoint(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).host;
    return host === 'api.x.ai' || host.endsWith('.x.ai');
  } catch {
    return endpoint.includes('x.ai');
  }
}

/** Converts a camelCase parameter name from an API error to snake_case. */
function camelToSnake(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function buildGrokRequestBody(
  messages: ChatApiMessage[],
  config: LLMConfig,
  opts: { stream: boolean; tools?: unknown[] },
): Record<string, unknown> {
  const endpoint = (config.endpoint || GROK_DEFAULT_ENDPOINT).replace(/\/$/, '');
  const official = isOfficialXaiEndpoint(endpoint);

  const body: Record<string, unknown> = {
    model: config.model || GROK_DEFAULT_MODEL,
    messages,
    max_tokens: config.parameters.maxTokens,
    temperature: config.parameters.temperature,
    top_p: config.parameters.topP,
    stream: opts.stream,
  };
  if (opts.tools?.length) {
    body.tools = opts.tools;
    // Explicit 'auto' (default on xAI but some grok-4.x versions behave better
    // with it explicit). If a model rejects it, grokFetchWithParamAdaptation
    // strips it automatically and retries.
    body.tool_choice = 'auto';
  }

  // Anti-repetition params. On the official xAI API these are stripped
  // before sending (they 400-reject otherwise); non-zero values are logged
  // once so the user understands why they have no effect on Grok.
  const dropped: string[] = [];
  if (Number.isFinite(config.parameters.frequencyPenalty) && config.parameters.frequencyPenalty !== 0) {
    if (official) dropped.push(`frequency_penalty=${config.parameters.frequencyPenalty}`);
    else body.frequency_penalty = config.parameters.frequencyPenalty;
  }
  if (Number.isFinite(config.parameters.presencePenalty) && config.parameters.presencePenalty !== 0) {
    if (official) dropped.push(`presence_penalty=${config.parameters.presencePenalty}`);
    else body.presence_penalty = config.parameters.presencePenalty;
  }
  if (config.parameters.stopStrings?.length) {
    if (official) dropped.push('stop');
    else body.stop = config.parameters.stopStrings;
  }
  if (dropped.length) {
    console.info(`[Grok] La API de xAI no soporta ${dropped.join(', ')} — omitidos automáticamente. Alternativa anti-bucle: temperatura moderada + guardia anti-bucle de tools (ya activa).`);
  }

  return body;
}

/** Extracts a readable message from xAI / OpenAI style error payloads. */
function parseGrokErrorMessage(errorText: string): string {
  try {
    const json = JSON.parse(errorText);
    // xAI format: {"code":"invalid-argument","error":"Model ... does not support parameter X."}
    if (typeof json.error === 'string') return json.error;
    // OpenAI format: {"error":{"message":"..."}}
    if (json.error?.message) return json.error.message;
    if (typeof json.message === 'string') return json.message;
  } catch {
    // Not JSON — keep original text
  }
  return errorText;
}

const MAX_PARAM_ADAPT_RETRIES = 5;

/**
 * POSTs the chat completion request. If the API answers 400
 * "Model X does not support parameter Y" (xAI validates params per model and
 * changes the list over time), the offending parameter is removed and the
 * request retried, so a single unsupported field never breaks the turn.
 */
async function grokFetchWithParamAdaptation(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<Response> {
  let current = { ...body };

  for (let attempt = 0; attempt <= MAX_PARAM_ADAPT_RETRIES; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(current),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (response.ok) return response;

    const errorText = await response.text();
    const message = parseGrokErrorMessage(errorText);
    const match = message.match(/does not support parameter\s+([A-Za-z_][A-Za-z0-9_]*)/i);
    const rejectedKey = match ? camelToSnake(match[1]) : null;

    if (response.status !== 400 || !rejectedKey || !(rejectedKey in current)) {
      throw new Error(`Grok Error (${response.status}): ${message}`);
    }

    delete current[rejectedKey];
    console.warn(`[Grok] El modelo "${current.model}" rechazó el parámetro "${rejectedKey}" — reintentando sin él.`);
  }

  throw new Error('Grok Error (400): la API rechazó demasiados parámetros incluso tras reintentos adaptativos.');
}

function grokHeaders(config: LLMConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...(config.apiKey && { 'Authorization': `Bearer ${config.apiKey}` }),
  };
}

export async function* streamGrok(
  messages: ChatApiMessage[],
  config: LLMConfig,
): AsyncGenerator<string> {
  const endpoint = (config.endpoint || GROK_DEFAULT_ENDPOINT).replace(/\/$/, '');
  const timeoutMs = config.parameters.timeout || DEFAULT_TIMEOUT;

  const requestBody = buildGrokRequestBody(messages, config, { stream: true });

  const response = await grokFetchWithParamAdaptation(
    `${endpoint}/chat/completions`,
    grokHeaders(config),
    requestBody,
    timeoutMs,
  );

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;

        const data = trimmedLine.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content || '';
          if (content) {
            yield content;
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* streamGrokWithTools(
  messages: ChatApiMessage[],
  config: LLMConfig,
  tools: ToolDefinition[],
  accumulator: ToolCallAccumulator,
): AsyncGenerator<string> {
  const endpoint = (config.endpoint || GROK_DEFAULT_ENDPOINT).replace(/\/$/, '');
  const timeoutMs = config.parameters.timeout || DEFAULT_TIMEOUT;

  const openAITools = toOpenAITools(tools);

  console.log(`[Grok+Tools] Streaming with ${openAITools.length} tools`);

  const requestBody = buildGrokRequestBody(messages, config, { stream: true, tools: openAITools });

  const response = await grokFetchWithParamAdaptation(
    `${endpoint}/chat/completions`,
    grokHeaders(config),
    requestBody,
    timeoutMs,
  );

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;

        const data = trimmedLine.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const choice = parsed.choices?.[0];

          if (choice?.finish_reason) {
            accumulator.finishReason = choice.finish_reason;
          }

          const delta = choice?.delta || {};
          const textContent = processOpenAIDelta(delta, accumulator);
          if (textContent) {
            yield textContent;
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }
  } finally {
    reader.releaseLock();
    finalizeToolCalls(accumulator);
  }

  console.log(`[Grok+Tools] Stream complete. finishReason=${accumulator.finishReason}, toolCalls=${accumulator.toolCalls.length}`);
}

export async function callGrok(
  messages: ChatApiMessage[],
  config: LLMConfig,
): Promise<GenerateResponse> {
  const endpoint = (config.endpoint || GROK_DEFAULT_ENDPOINT).replace(/\/$/, '');
  const timeoutMs = DEFAULT_TIMEOUT;

  const requestBody = buildGrokRequestBody(messages, config, { stream: false });

  const response = await grokFetchWithParamAdaptation(
    `${endpoint}/chat/completions`,
    grokHeaders(config),
    requestBody,
    timeoutMs,
  );

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';

  return {
    message: content,
    usage: {
      promptTokens: data.usage?.prompt_tokens || 0,
      completionTokens: data.usage?.completion_tokens || 0,
      totalTokens: data.usage?.total_tokens || 0,
    },
    model: data.model,
  };
}
