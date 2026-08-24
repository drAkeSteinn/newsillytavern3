// ============================================
// Director Agent — API Route
// ============================================
// POST /api/chat/director
//
// Body: {
//   snapshot: DirectorSnapshot,
//   llmConfig?: LLMConfig,          // only used when settings.mode === 'llm'
//   settings?: DirectorSettings
// }
//
// Returns DirectorResult JSON:
//   { tension, pacing, decisions: [...], source }
//
// The route NEVER mutates state — the client applies decisions through
// existing primitives (pushSessionEvent / applySceneChange), following the
// app's server-validate / client-execute architecture.

import { NextRequest, NextResponse } from 'next/server';
import type { LLMConfig, ChatApiMessage } from '@/types';
import { analyzeSnapshot } from '@/lib/director/analyzer';
import type { DirectorResult, DirectorSettings, DirectorSnapshot } from '@/lib/director/types';
import { DEFAULT_DIRECTOR_SETTINGS } from '@/lib/director/types';
import { streamZAI } from '@/lib/llm/providers/zai';
import { streamOpenAICompatible } from '@/lib/llm/providers/openai';
import { streamGrok } from '@/lib/llm/providers/grok';

export const runtime = 'nodejs';
export const maxDuration = 60;

const DIRECTOR_SYSTEM_PROMPT = `Eres el DIRECTOR de una sesión de roleplay. Observas el estado de la sesión y tu ÚNICO trabajo es proponer UN evento del mundo (world event) que rompa la monotonía o libere tensión, sin resolver nada tú.

REGLAS:
- El evento debe ser EXTERNO al protagonista y a los personajes (vecinos, clima, teléfono, ruidos, mensajería, interrupciones).
- NO inventes acciones de los personajes ni del usuario.
- Máximo 2 frases, en español, tono neutro-concreto.
- Si la tensión es alta, propón algo que la libere; si es baja, algo que la encienda.
- Responde SOLO con JSON válido: {"tension": <0-100>, "world_event": "<texto>"} sin markdown.`;

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

Propón el evento del mundo en JSON.`;
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

        let raw = '';
        if (llmConfig.provider === 'z-ai') {
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
          const result: DirectorResult = {
            tension: typeof parsed.tension === 'number' ? Math.min(100, Math.max(0, Math.round(parsed.tension))) : heuristicResult.tension,
            pacing: heuristicResult.pacing,
            decisions,
            source: 'hybrid',
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
