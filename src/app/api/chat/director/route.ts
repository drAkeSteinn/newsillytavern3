// ============================================
// Director Agent — API Route
// ============================================
// POST /api/chat/director
//
// Body: {
//   snapshot: DirectorSnapshot,
//   llmConfig?: LLMConfig,          // only used when settings.mode === 'llm'
//   settings?: DirectorSettings,
//   characterId?: string,           // main character for tool context
//   groupId?: string,               // group for tool context (group chats)
//   toolsSettings?: ToolsSettings,  // which tools are enabled
// }
//
// Returns DirectorResult JSON:
//   { tension, pacing, decisions, source, toolResults? }
//
// The route NEVER mutates state — the client applies decisions and tool
// activations through existing primitives (pushSessionEvent,
// applySceneChange, updateCharacterStat, etc.), following the app's
// server-validate / client-execute architecture.

import { NextRequest, NextResponse } from 'next/server';
import type { LLMConfig, ToolsSettings } from '@/types';
import type { ChatApiMessage } from '@/lib/llm/types';
import { analyzeSnapshot } from '@/lib/director/analyzer';
import type { DirectorResult, DirectorSettings, DirectorSnapshot } from '@/lib/director/types';
import { DEFAULT_DIRECTOR_SETTINGS } from '@/lib/director/types';
import { streamZAI, streamZAIWithTools } from '@/lib/llm/providers/zai';
import { streamOpenAICompatible, streamOpenAIWithTools } from '@/lib/llm/providers/openai';
import { streamGrok, streamGrokWithTools } from '@/lib/llm/providers/grok';
import {
  getAllToolDefinitions,
  executeTool,
  createToolCallAccumulator,
  hasToolCalls,
} from '@/lib/tools';
import type { ToolDefinition, ToolContext, ToolExecutionResult } from '@/lib/tools/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Tools the Director is allowed to use to actively shape the narrative.
// These are a subset of the full tool registry — the Director should NOT
// use character-action tools (manage_action, manage_solicitud, skill_check)
// because those are the characters' agency, not the Director's.
const DIRECTOR_ALLOWED_TOOL_IDS = [
  'modify_stat',      // adjust character stats based on narrative tension
  'manage_scene',     // bring characters in/out of scene (groups)
  'manage_relationship', // adjust relationship points based on world events
  'manage_memory',    // persist major world events as long-term memories
  'manage_time',      // advance world time during cooldown events
  'manage_quest',     // spawn quests from world events
];

const DIRECTOR_SYSTEM_PROMPT = `Eres el DIRECTOR de una sesión de roleplay. Observas el estado de la sesión y tu trabajo es proponer UN evento del mundo (world event) que rompa la monotonía o libere tensión, sin resolver nada tú.

REGLAS:
- El evento debe ser EXTERNO al protagonista y a los personajes (vecinos, clima, teléfono, ruidos, mensajería, interrupciones).
- NO inventes acciones de los personajes ni del usuario.
- Máximo 2 frases, en español, tono neutro-concreto.
- Si la tensión es alta, propón algo que la libere; si es baja, algo que la encienda.
- Responde SOLO con JSON válido: {"tension": <0-100>, "world_event": "<texto>"} sin markdown.

HERRAMIENTAS DISPONIBLES:
Además de proponer el evento del mundo, PUEDES usar herramientas (tool calling) para ajustar el estado del mundo de forma que el evento tenga impacto real:
- "modify_stat": Sube/baja un atributo de un personaje cuando el evento del mundo lo justifique (ej: un ruido repentino podría subir "irritabilidad" o "miedo"; una noticia excitante podría subir "lujuria"). Usa operadores "+5", "-10", "=50".
- "manage_scene": En chats de grupo, haz que un personaje entre o salga de la escena si el evento del mundo lo provoca (ej: alguien llama a la puerta → entra un personaje; alguien se va molestx → sale).
- "manage_relationship": Ajusta puntos de relación entre personajes si el evento crea o resuelve tensión entre ellos.
- "manage_memory": Crea un recuerdo persistente para eventos importantes (severity 'major') que los personajes deberían recordar a largo plazo.
- "manage_time": Avanza el tiempo del mundo si el evento implica un salto temporal (ej: "pasan dos horas").
- "manage_quest": Activa un quest o completa un objetivo si el evento del mundo lo dispara.

USA LAS HERRAMIENTAS ACTIVAMENTE cuando tengan sentido narrativo, pero no fuerces su uso. El evento del mundo (world_event en JSON) es obligatorio; las herramientas son opcionales y complementarias.`;

function buildDirectorUserPrompt(snapshot: DirectorSnapshot, tension: number, pacing: string): string {
  const names = Object.values(snapshot.characterNames || {}).join(', ') || '—';
  const stats: string[] = [];
  for (const [cid, cs] of Object.entries(snapshot.sessionStats?.characterStats || {})) {
    const vals = Object.entries(cs.attributeValues || {})
      .slice(0, 8)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    if (vals) stats.push(`${snapshot.characterNames?.[cid] || cid}: ${vals}`);
  }
  const events = (snapshot.sessionStats?.eventLog || []).slice(-5).map(e => `- ${e.description}`).join('\n') || '(sin eventos recientes)';
  const scene = snapshot.groupMembers?.length
    ? `Grupo. En escena: ${snapshot.groupMembers.filter(m => m.isPresent && !m.isNarrator).map(m => m.name).join(', ') || 'nadie'}. Fuera: ${snapshot.groupMembers.filter(m => !m.isPresent && !m.isNarrator).map(m => m.name).join(', ') || 'nadie'}.`
    : 'Chat 1 a 1.';
  const lastMsgs = (snapshot.recentMessages || []).slice(-3).map(m => `${m.characterName || m.role}: ${m.content.slice(0, 120)}`).join('\n') || '(sin mensajes)';

  return `[ESTADO DE SESIÓN]
Personajes: ${names}
${scene}
Tensión calculada: ${tension}/100 (pacing: ${pacing})
Stats:
${stats.join('\n') || '(sin stats)'}

Últimos eventos:
${events}

Últimos mensajes:
${lastMsgs}

Propón el evento del mundo en JSON. Si el evento justifica cambios en stats, escena, relaciones, memoria, tiempo o quests, usa las herramientas disponibles para aplicarlos.`;
}

/** Collect a stream into a full string with timeout */
async function collectStream(gen: AsyncGenerator<string>, timeoutMs = 30000): Promise<string> {
  let out = '';
  const race = new Promise<string>((_, reject) =>
    setTimeout(() => reject(new Error('Director LLM timeout')), timeoutMs)
  );
  const consuming = (async () => {
    for await (const chunk of gen) out += chunk;
    return out;
  })();
  await Promise.race([consuming, race]);
  return out;
}

/** Parse the LLM JSON response defensively */
function parseDirectorJson(raw: string): { tension?: number; world_event?: string } | null {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const snapshot: DirectorSnapshot | undefined = body?.snapshot;
    const llmConfig: LLMConfig | undefined = body?.llmConfig;
    const settings: DirectorSettings = { ...DEFAULT_DIRECTOR_SETTINGS, ...(body?.settings || {}) };
    const toolsSettings: ToolsSettings | undefined = body?.toolsSettings;
    const characterId: string | undefined = body?.characterId;
    const groupId: string | undefined = body?.groupId;

    if (!snapshot || !snapshot.sessionId) {
      return NextResponse.json({ error: 'snapshot.sessionId is required' }, { status: 400 });
    }

    // Heuristics always run — they are the source of truth for tension
    const heuristicResult = analyzeSnapshot(snapshot, settings.maxWorldEventsPerRun);

    // Optional LLM narration: replace heuristic world_event description with
    // a contextual one. Scene changes and tension stay deterministic.
    if (settings.mode === 'llm' && llmConfig?.provider) {
      try {
        const messages: ChatApiMessage[] = [
          { role: 'system', content: DIRECTOR_SYSTEM_PROMPT },
          { role: 'user', content: buildDirectorUserPrompt(snapshot, heuristicResult.tension, heuristicResult.pacing) },
        ];

        // ── Determine which tools the Director can use ──
        // Only use tools if tools are globally enabled and not all disabled.
        let directorTools: ToolDefinition[] = [];
        if (toolsSettings?.enabled !== false) {
          const allTools = getAllToolDefinitions();
          const disabled = new Set(toolsSettings?.disabledTools || []);
          directorTools = allTools.filter(t =>
            DIRECTOR_ALLOWED_TOOL_IDS.includes(t.id) && !disabled.has(t.id)
          );
        }

        const useNativeTools = directorTools.length > 0;
        let raw = '';
        const toolResults: ToolExecutionResult[] = [];

        if (useNativeTools && llmConfig.provider === 'z-ai') {
          // Z.ai with tools — buffer, detect tool calls, execute them
          const accumulator = createToolCallAccumulator(directorTools);
          const gen = streamZAIWithTools(messages, directorTools, accumulator, llmConfig.apiKey || undefined);
          raw = await collectStream(gen);

          if (hasToolCalls(accumulator)) {
            // Execute each tool call
            const toolContext: ToolContext = {
              characterId: characterId || snapshot.characterId || '',
              characterName: snapshot.characterNames?.[characterId || snapshot.characterId || ''] || 'Director',
              sessionId: snapshot.sessionId,
              groupId,
              userName: 'Director',
              groupMembers: snapshot.groupMembers,
              sessionStats: snapshot.sessionStats,
              allCharacters: Object.entries(snapshot.characterNames || {}).map(([id, name]) => ({
                id,
                name,
                statsConfig: undefined,
              } as any)),
            };

            for (const tc of accumulator.toolCalls) {
              try {
                const result = await executeTool(tc.name, tc.arguments, toolContext);
                toolResults.push(result);
                console.log(`[Director] Tool ${tc.name} executed: ${result.success ? 'success' : 'failed'}`);
              } catch (toolErr) {
                console.warn(`[Director] Tool ${tc.name} failed:`, toolErr instanceof Error ? toolErr.message : toolErr);
              }
            }
          }
        } else if (useNativeTools && (llmConfig.provider === 'openai' || llmConfig.provider === 'vllm' || llmConfig.provider === 'lm-studio' || llmConfig.provider === 'custom')) {
          const accumulator = createToolCallAccumulator(directorTools);
          const gen = streamOpenAIWithTools(messages, llmConfig, llmConfig.provider, directorTools, accumulator);
          raw = await collectStream(gen);

          if (hasToolCalls(accumulator)) {
            const toolContext: ToolContext = {
              characterId: characterId || snapshot.characterId || '',
              characterName: snapshot.characterNames?.[characterId || snapshot.characterId || ''] || 'Director',
              sessionId: snapshot.sessionId,
              groupId,
              userName: 'Director',
              groupMembers: snapshot.groupMembers,
              sessionStats: snapshot.sessionStats,
              allCharacters: Object.entries(snapshot.characterNames || {}).map(([id, name]) => ({
                id,
                name,
                statsConfig: undefined,
              } as any)),
            };

            for (const tc of accumulator.toolCalls) {
              try {
                const result = await executeTool(tc.name, tc.arguments, toolContext);
                toolResults.push(result);
                console.log(`[Director] Tool ${tc.name} executed: ${result.success ? 'success' : 'failed'}`);
              } catch (toolErr) {
                console.warn(`[Director] Tool ${tc.name} failed:`, toolErr instanceof Error ? toolErr.message : toolErr);
              }
            }
          }
        } else if (useNativeTools && llmConfig.provider === 'grok') {
          const accumulator = createToolCallAccumulator(directorTools);
          const gen = streamGrokWithTools(messages, llmConfig, directorTools, accumulator);
          raw = await collectStream(gen);

          if (hasToolCalls(accumulator)) {
            const toolContext: ToolContext = {
              characterId: characterId || snapshot.characterId || '',
              characterName: snapshot.characterNames?.[characterId || snapshot.characterId || ''] || 'Director',
              sessionId: snapshot.sessionId,
              groupId,
              userName: 'Director',
              groupMembers: snapshot.groupMembers,
              sessionStats: snapshot.sessionStats,
              allCharacters: Object.entries(snapshot.characterNames || {}).map(([id, name]) => ({
                id,
                name,
                statsConfig: undefined,
              } as any)),
            };

            for (const tc of accumulator.toolCalls) {
              try {
                const result = await executeTool(tc.name, tc.arguments, toolContext);
                toolResults.push(result);
                console.log(`[Director] Tool ${tc.name} executed: ${result.success ? 'success' : 'failed'}`);
              } catch (toolErr) {
                console.warn(`[Director] Tool ${tc.name} failed:`, toolErr instanceof Error ? toolErr.message : toolErr);
              }
            }
          }
        } else if (llmConfig.provider === 'z-ai') {
          raw = await collectStream(streamZAI(messages, llmConfig.apiKey || undefined));
        } else if (llmConfig.provider === 'grok') {
          raw = await collectStream(streamGrok(messages, llmConfig));
        } else if (['openai', 'vllm', 'lm-studio', 'custom'].includes(llmConfig.provider)) {
          raw = await collectStream(streamOpenAICompatible(messages, llmConfig, llmConfig.provider));
        } else {
          // Provider without director support — keep heuristic result
        }

        const parsed = parseDirectorJson(raw);
        if (parsed?.world_event && parsed.world_event.trim().length > 10) {
          const decisions = heuristicResult.decisions.map(d =>
            d.type === 'world_event'
              ? { ...d, description: parsed.world_event!.trim() }
              : d
          );
          const result: DirectorResult & { toolResults?: ToolExecutionResult[] } = {
            tension: typeof parsed.tension === 'number' ? Math.min(100, Math.max(0, Math.round(parsed.tension))) : heuristicResult.tension,
            pacing: heuristicResult.pacing,
            decisions,
            source: 'hybrid',
            ...(toolResults.length > 0 ? { toolResults } : {}),
          };
          return NextResponse.json(result);
        }

        // If tools were used but JSON parsing failed, still return tool results
        if (toolResults.length > 0) {
          const result: DirectorResult & { toolResults?: ToolExecutionResult[] } = {
            ...heuristicResult,
            ...(toolResults.length > 0 ? { toolResults } : {}),
          };
          return NextResponse.json(result);
        }
      } catch (llmErr) {
        console.warn('[Director] LLM narration failed, falling back to heuristics:', llmErr instanceof Error ? llmErr.message : llmErr);
      }
    }

    return NextResponse.json(heuristicResult);
  } catch (error) {
    console.error('[Director] Route error:', error);
    return NextResponse.json({ error: 'Director analysis failed' }, { status: 500 });
  }
}
