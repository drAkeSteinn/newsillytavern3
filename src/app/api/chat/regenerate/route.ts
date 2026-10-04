// ============================================
// Chat Regenerate Route - Generate swipe alternative
// ============================================

import { NextRequest } from 'next/server';
import type { CharacterCard, PromptSection, Lorebook, SessionStats, HUDContextConfig, EmbeddingsChatSettings, QuestTemplate, SessionQuestInstance, QuestSettings, ChatMessage, LLMParameters } from '@/types';
import { DEFAULT_QUEST_SETTINGS } from '@/types';
import {
  DEFAULT_CHARACTER,
  createSSEJSON,
  createErrorResponse,
  createSSEStreamResponse,
  cleanResponseContent,
  buildSystemPrompt,
  buildChatHistorySections,
  buildPostHistorySection,
  buildChatMessages,
  buildCompletionPrompt,
  getEffectiveUserName,
  processCharacter,
  streamZAI,
  streamOpenAICompatible,
  streamAnthropic,
  streamOllama,
  streamTextGenerationWebUI,
  streamGrok,
  buildLorebookSectionForPrompt,
  buildHUDContextSection,
  injectHUDContextIntoMessages,
  injectHUDContextIntoSections,
  buildKeyResolutionContext,
  resolveStats,
  resolveAllKeys,
} from '@/lib/llm';
import {
  sanitizeInput
} from '@/lib/validations';
import {
  retrieveEmbeddingsContext,
  formatEmbeddingsForSSE
} from '@/lib/embeddings/chat-context';

import {
  selectContextMessages,
  type ContextConfig
} from '@/lib/context-manager';


// Validate regenerate request manually
function validateRegenerateRequest(data: unknown) {
  if (typeof data !== 'object' || data === null) {
    return { success: false, error: 'Request body must be an object' } as const;
  }
  const obj = data as Record<string, unknown>;
  
  // sessionId is required
  if (typeof obj.sessionId !== 'string' || !obj.sessionId) {
    return { success: false, error: 'sessionId is required' } as const;
  }
  
  // messageId is required
  if (typeof obj.messageId !== 'string' || !obj.messageId) {
    return { success: false, error: 'messageId is required' } as const;
  }
  
  // llmConfig is required
  if (typeof obj.llmConfig !== 'object' || obj.llmConfig === null) {
    return { success: false, error: 'llmConfig is required' } as const;
  }
  
  return {
    success: true,
    data: {
      sessionId: obj.sessionId,
      messageId: obj.messageId,
      character: obj.character as Record<string, unknown> | undefined,
      characterId: typeof obj.characterId === 'string' ? obj.characterId : undefined,
      messages: Array.isArray(obj.messages) ? obj.messages : [],
      llmConfig: obj.llmConfig as Record<string, unknown>,
      userName: typeof obj.userName === 'string' ? obj.userName : 'User',
      persona: obj.persona as Record<string, unknown> | undefined,
      contextConfig: obj.contextConfig as Record<string, unknown> | undefined,
      lorebooks: Array.isArray(obj.lorebooks) ? obj.lorebooks : [],
      sessionStats: obj.sessionStats,
      hudContext: obj.hudContext as HUDContextConfig | undefined,
      allCharacters: Array.isArray(obj.allCharacters) ? obj.allCharacters : [],
      embeddingsChat: obj.embeddingsChat as Partial<EmbeddingsChatSettings> | undefined,
      summary: obj.summary as Record<string, unknown> | undefined,
      sessionQuests: Array.isArray(obj.sessionQuests) ? obj.sessionQuests : [],
      questTemplates: Array.isArray(obj.questTemplates) ? obj.questTemplates : [],
      questSettings: obj.questSettings as Record<string, unknown> | undefined
    }
  } as const;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate request manually (no Zod)
    const validation = validateRegenerateRequest(body);
    if (!validation.success) {
      return createErrorResponse(validation.error, 400);
    }
    
    const {
      sessionId,
      messageId,
      character,
      characterId,
      messages = [],
      llmConfig,
      userName = 'User',
      persona,
      contextConfig,
      lorebooks = [],
      sessionStats,
      hudContext,
      allCharacters = [],
      embeddingsChat,
      summary,
      sessionQuests = [],
      questTemplates = [],
      questSettings
    } = validation.data;

    // Extract lorebooks for processing
    const typedLorebooks: Lorebook[] = lorebooks;
    
    // Cast sessionStats to proper type
    const typedSessionStats = sessionStats as SessionStats | undefined;

    if (!llmConfig) {
      return createErrorResponse('No LLM configuration provided', 400);
    }

    // Find the message to regenerate
    const messageToRegenerate = messages.find((m: { id: string }) => m.id === messageId);
    if (!messageToRegenerate) {
      return createErrorResponse('Message not found', 404);
    }

    // Only regenerate assistant messages
    if (messageToRegenerate.role !== 'assistant') {
      return createErrorResponse('Can only regenerate assistant messages', 400);
    }

    // Create default character if none provided
    const effectiveCharacter: CharacterCard = character || DEFAULT_CHARACTER;

    // Get effective user name from persona or use provided userName
    const effectiveUserName = getEffectiveUserName(persona, userName);

    // Process character template variables ({{user}}, {{char}}, etc.)
    const processedCharacter = processCharacter(effectiveCharacter, effectiveUserName, persona, typedSessionStats, allCharacters, questTemplates);

    // Get messages before the one to regenerate
    const messageIndex = messages.findIndex((m: { id: string }) => m.id === messageId);
    const messagesBeforeRegenerate = messages.slice(0, messageIndex);

    // Build context configuration from request or use defaults
    const ctxConfig: Partial<ContextConfig> = contextConfig || {};

    // Apply sliding window to messages
    const contextWindow = selectContextMessages(messagesBeforeRegenerate, llmConfig, ctxConfig);

    // Process lorebooks and get matched entries
    const { plan: lorebookPlan, lorebookAttributeKeys, lorebookEntryKeyMap } = buildLorebookSectionForPrompt(
      messagesBeforeRegenerate,
      typedLorebooks,
      {
        scanDepth: ctxConfig.scanDepth,
        // tokenBudget: let the injector use the lorebook's own setting
        userName: effectiveUserName,
        charName: effectiveCharacter?.name,
      },
      { sessionStats: typedSessionStats, characterId: effectiveCharacter?.id, characters: allCharacters }
    );

    // ========================================
    // Embeddings Context Retrieval
    // ========================================
    // Retrieve relevant embeddings based on the last user message before the assistant message to regenerate
    const lastUserMessage = [...messagesBeforeRegenerate].reverse().find((m: { role: string }) => m.role === 'user');
    const queryMessage = lastUserMessage ? sanitizeInput((lastUserMessage as { content: string }).content || '') : '';

    const embeddingsResult = await retrieveEmbeddingsContext(
      queryMessage,
      characterId || effectiveCharacter.id,
      sessionId,
      embeddingsChat,
      undefined, // groupId
    );

    if (embeddingsResult.found) {
      console.log(`[Regenerate Route] Retrieved ${embeddingsResult.count} embeddings from namespaces: ${embeddingsResult.searchedNamespaces.join(', ')}`);
    }

    // Build system prompt with persona and lorebook (using processed character)
    const { prompt: systemPrompt, sections: systemSections, lorebookChatInjections, exampleMessages } = buildSystemPrompt(
      processedCharacter,
      effectiveUserName,
      persona,
      lorebookPlan,
      typedSessionStats,  // Pass session stats for attribute values
      allCharacters,      // Pass all characters for peticiones/solicitudes resolution
      undefined,          // soundTriggers
      undefined,          // soundSettings
      questTemplates,     // Pass quest templates for {{activeQuests}} key resolution
      sessionQuests,      // Pass session quests for {{activeQuests}} key resolution
      questSettings,       // Pass quest settings for {{activeQuests}} key resolution
      lorebookAttributeKeys,
      undefined,          // inventoryData
      lorebookEntryKeyMap // Pass lorebook entry key map for {{entryKey}} resolution
    );

    // Build key resolution context for all sections outside buildSystemPrompt
    // Includes lorebookAttributeKeys so {{injectionKey}} resolves in post-history, HUD, etc.
    let regenPersonaResolvedStats: import('@/types').ResolvedStats | null = null;
    if (persona?.statsConfig?.enabled && typedSessionStats) {
      regenPersonaResolvedStats = resolveStats({
        characterId: '__user__',
        statsConfig: persona.statsConfig,
        sessionStats: typedSessionStats,
      });
    }
    const regenResolvedStats = resolveStats({
      characterId: effectiveCharacter.id,
      statsConfig: effectiveCharacter.statsConfig,
      sessionStats: typedSessionStats,
      allCharacters,
      userName: effectiveUserName,
      characterName: effectiveCharacter.name,
      questTemplates,
      personaDescription: persona?.description,
      personaResolvedStats: regenPersonaResolvedStats,
    });

    // Build outlet sections map from lorebook plan for {{outlet::name}} macro resolution
    const outletSections: Record<string, string> = {};
    if (lorebookPlan?.outletSections.length) {
      for (const outletSection of lorebookPlan.outletSections) {
        const match = outletSection.label.match(/^World Info \((.+)\)$/);
        const outletName = match ? match[1] : outletSection.label;
        outletSections[outletName] = outletSection.content;
      }
    }

    const typedQuestSettings: QuestSettings = { ...DEFAULT_QUEST_SETTINGS, ...(questSettings || {}) };

    const keyContext = buildKeyResolutionContext(
      processedCharacter,
      effectiveUserName,
      persona,
      regenResolvedStats,
      typedSessionStats,  // sessionStats for {{last_events}}
      undefined,          // soundTriggers
      undefined,          // soundSettings
      regenPersonaResolvedStats,  // persona resolved stats
      questTemplates,     // quest templates for {{activeQuests}}
      sessionQuests,      // session quests for {{activeQuests}}
      typedQuestSettings, // quest settings
      outletSections,     // outlet sections for {{outlet::name}}
      lorebookAttributeKeys,  // lorebook attribute keys for {{injectionKey}}
      undefined,          // inventoryData (not part of the regenerate payload)
      lorebookEntryKeyMap // FIX: {{entryKey}} de lorebook tradicional (antes se limpiaba a '' en HUD/PHI)
    );

    // FIX EXPLORE-3: Resolver post-history instructions con resolveAllKeys antes de
    // pasarlas a buildChatMessages/buildCompletionPrompt (antes iban crudas y el LLM
    // recibía {{user}}, {{char}}, {{entryKey}}, etc. literales).
    const _regenRawPHI = effectiveCharacter.postHistoryInstructions?.trim();
    const resolvedPostHistoryInstructions: string | undefined = _regenRawPHI
      ? resolveAllKeys(_regenRawPHI, keyContext)
      : undefined;

    // FIX: authorNote was never injected (passed as undefined) — resolve macros and pass it.
    const _regenRawAuthorNote = effectiveCharacter.authorNote?.trim();
    const resolvedAuthorNote: string | undefined = _regenRawAuthorNote
      ? resolveAllKeys(_regenRawAuthorNote, keyContext)
      : undefined;

    // Build HUD context section if enabled (resolves {{keys}} in HUD content)
    const hudContextSection = hudContext ? buildHUDContextSection(hudContext, keyContext) : null;

    // Build all prompt sections for storage
    const chatHistorySections = buildChatHistorySections(contextWindow.messages, processedCharacter.name, effectiveUserName);
    const postHistorySection = buildPostHistorySection(processedCharacter.postHistoryInstructions, keyContext);

    // FIX: summary was destructured but never used — regenerate ignored the
    // [RECUERDOS ANTERIORES] summary, producing answers inconsistent with normal turns.
    const summaryContent = typeof (summary as { content?: unknown } | undefined)?.content === 'string'
      ? (summary as { content: string }).content
      : '';
    const summaryMessage: ChatMessage | null = summaryContent
      ? {
          id: 'summary-regen-' + Date.now(),
          role: 'assistant',
          content: `[RECUERDOS ANTERIORES]\n${summaryContent}`,
          characterId: effectiveCharacter.id,
          isDeleted: false,
          timestamp: typeof (summary as { createdAt?: unknown })?.createdAt === 'string'
            ? (summary as { createdAt: string }).createdAt
            : new Date().toISOString(),
          swipeId: 'summary',
          swipeIndex: 0,
          swipes: [`[RECUERDOS ANTERIORES]\n${summaryContent}`],
        }
      : null;

    // History actually sent to the LLM (summary first, then windowed history)
    const historyMessages = summaryMessage
      ? [summaryMessage, ...contextWindow.messages]
      : contextWindow.messages;

    // Summary viewer section (parity with stream route)
    const regenSummarySection: PromptSection | null = summaryContent
      ? {
          type: 'system',
          label: 'Recuerdos Anteriores',
          content: `[RECUERDOS ANTERIORES]\n${summaryContent}`,
          color: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
        }
      : null;

    // Build all prompt sections in order
    // Order: System -> Character Memory -> [CONTEXTO] non-memory -> [MEMORIA] memory -> Chat History -> Post-History
    const personaIndex = systemSections.findIndex(s => s.type === 'persona');
    const prePersonaSections = personaIndex >= 0 ? systemSections.slice(0, personaIndex + 1) : systemSections;
    const postPersonaSections = personaIndex >= 0 ? systemSections.slice(personaIndex + 1) : [];

    // Memory V2 — unified store (the ONLY memory system; computed BEFORE building
    // viewer sections so the viewer reflects exactly what the LLM will receive).
    // Partitioned blocks [HECHOS]/[EVENTOS]/[ESTADO DE LA RELACIÓN].
    // Memory V2 gating — SINGLE switch (see stream/route.ts). No dependency on
    // the deprecated embeddingsChat.enabled flag.
    const memoryV2Active = embeddingsChat?.memoryV2Enabled !== false;
    let v2MemoryContext = '';
    if (memoryV2Active) {
      try {
        const { buildV2MemoryContext } = await import('@/lib/memory/v2');
        const v2 = await buildV2MemoryContext({
          charId: characterId || effectiveCharacter.id,
          charName: effectiveCharacter.name || 'Character',
          userName: effectiveUserName,
          sessionId,
          crossSession: embeddingsChat?.crossSessionMemory !== false,
          query: queryMessage || '',
          maxTokenBudget: embeddingsChat?.maxTokenBudget,
        });
        v2MemoryContext = v2.context;
      } catch (v2Err) {
        console.warn('[Regenerate] Memory V2 failed — continuing without memory this turn:', v2Err);
      }
    }

    // Memory V2 viewer section (partitioned blocks)
    const v2ViewerSection: PromptSection | null = memoryV2Active
      ? {
          type: 'character_note',
          label: `Memoria V2 (${effectiveCharacter.name || 'Character'})`,
          content: v2MemoryContext || '(sin registros de memoria V2 aún)',
          color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
        }
      : null;

    let allPromptSections: PromptSection[] = [
      ...prePersonaSections,
      ...postPersonaSections,
      ...(regenSummarySection ? [regenSummarySection] : []),
      ...(v2ViewerSection ? [v2ViewerSection] : []),  // V2 partitioned memory
      ...(embeddingsResult.nonMemorySection ? [embeddingsResult.nonMemorySection] : []),  // Knowledge: before chat
      ...chatHistorySections,
      ...(postHistorySection ? [postHistorySection] : [])
    ];

    // Inject HUD context into sections if enabled
    if (hudContextSection && hudContext) {
      allPromptSections = injectHUDContextIntoSections(allPromptSections, hudContextSection, hudContext.position);
    }

    const contextParts: string[] = [];

    if (embeddingsResult.nonMemoryContextString?.trim()) {
      contextParts.push(embeddingsResult.nonMemoryContextString);
    }
    if (memoryV2Active && v2MemoryContext.trim()) {
      contextParts.push(v2MemoryContext);
    }
    const embeddingsContext = contextParts.length > 0 ? contextParts.join('\n\n') : undefined;

    // Quest content is resolved via {{activeQuests}} key in buildSystemPrompt
    let finalSystemPrompt = systemPrompt;

    // Create a TransformStream for SSE
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send prompt data at the start
          controller.enqueue(createSSEJSON({
            type: 'prompt_data',
            promptSections: allPromptSections
          }));

          // Send embeddings context metadata to the client for UI display
          if (embeddingsResult.found) {
            controller.enqueue(createSSEJSON({
              type: 'embeddings_context',
              data: formatEmbeddingsForSSE(embeddingsResult)
            }));
          }

          let generator: AsyncGenerator<string>;

          // Route to appropriate provider
          switch (llmConfig.provider) {
            case 'test-mock': {
              // Test mode: Simulate LLM response with trigger keys for testing
              console.log('[Regenerate Route] Using TEST-MOCK provider');
              const mockResponse = llmConfig.mockResponse || `*El personaje te mira con interés*

¡Hola! Me alegra verte por aquí. Tenía algo que pedirte...

[peticion_madera]

¿Podrías conseguirme algo de madera para construir un refugio?

También puedo ofrecerte algunos sonidos:

|glohg|

Y cambiar mi expresión:

[sprite:alegre]`;

              generator = async function* mockGenerator() {
                const words = mockResponse.split(/(\s+)/);
                for (const word of words) {
                  yield word;
                  await new Promise(resolve => setTimeout(resolve, 30 + Math.random() * 50));
                }
              }();
              break;
            }

            case 'z-ai': {
              let chatMessages = buildChatMessages(
                finalSystemPrompt,
                historyMessages,
                processedCharacter,
                effectiveUserName,
                resolvedPostHistoryInstructions,
                resolvedAuthorNote,  // authorNote (FIX: was never injected)
                true,       // useSystemRole — parity with stream route (was false: system block sent as 'assistant')
                embeddingsContext,  // Combined embeddings context before chat history
                lorebookChatInjections,
                exampleMessages
              );
              // Inject HUD context into chat messages if enabled
              if (hudContextSection && hudContext) {
                chatMessages = injectHUDContextIntoMessages(chatMessages, hudContextSection, hudContext.position);
              }
              generator = streamZAI(chatMessages, undefined, (() => {
                // llmConfig arrives as Record<string, unknown> in this route — cast params once
                const params = (llmConfig as { parameters?: LLMParameters }).parameters;
                return {
                  temperature: params?.temperature,
                  topP: params?.topP,
                  maxTokens: params?.maxTokens,
                  stop: params?.stopStrings,
                };
              })());
              break;
            }

            case 'openai':
            case 'vllm':
            case 'lm-studio':
            case 'custom': {
              if (!llmConfig.endpoint) {
                throw new Error(`${llmConfig.provider} requires an endpoint URL`);
              }
              let chatMessages = buildChatMessages(
                finalSystemPrompt,
                historyMessages,
                processedCharacter,
                effectiveUserName,
                resolvedPostHistoryInstructions,
                resolvedAuthorNote,  // authorNote (FIX: was never injected)
                true,       // useSystemRole
                embeddingsContext,  // Combined embeddings context before chat history
                lorebookChatInjections,
                exampleMessages
              );
              // Inject HUD context into chat messages if enabled
              if (hudContextSection && hudContext) {
                chatMessages = injectHUDContextIntoMessages(chatMessages, hudContextSection, hudContext.position);
              }
              generator = streamOpenAICompatible(chatMessages, llmConfig, llmConfig.provider);
              break;
            }

            case 'anthropic': {
              if (!llmConfig.apiKey) {
                throw new Error('Anthropic requires an API key');
              }
              let chatMessages = buildChatMessages(
                finalSystemPrompt,
                historyMessages,
                processedCharacter,
                effectiveUserName,
                resolvedPostHistoryInstructions,
                resolvedAuthorNote,  // authorNote (FIX: was never injected)
                true,       // useSystemRole
                embeddingsContext,  // Combined embeddings context before chat history
                lorebookChatInjections,
                exampleMessages
              );
              // Inject HUD context into chat messages if enabled
              if (hudContextSection && hudContext) {
                chatMessages = injectHUDContextIntoMessages(chatMessages, hudContextSection, hudContext.position);
              }
              generator = streamAnthropic(chatMessages, llmConfig);
              break;
            }

            case 'ollama': {
              const prompt = buildCompletionPrompt({
                systemPrompt: finalSystemPrompt,
                messages: historyMessages,
                character: processedCharacter,
                userName: effectiveUserName,
                postHistoryInstructions: resolvedPostHistoryInstructions,
                embeddingsContext: embeddingsContext,  // Memory embeddings before chat history
                exampleMessages: exampleMessages,
                allCharacters: allCharacters  // Pass all characters for proper speaker attribution
              });
              generator = streamOllama(prompt, llmConfig);
              break;
            }

            case 'grok': {
              let chatMessages = buildChatMessages(
                finalSystemPrompt,
                historyMessages,
                processedCharacter,
                effectiveUserName,
                resolvedPostHistoryInstructions,
                undefined,
                true,
                embeddingsContext,
                lorebookChatInjections,
                exampleMessages
              );
              if (hudContextSection && hudContext) {
                chatMessages = injectHUDContextIntoMessages(chatMessages, hudContextSection, hudContext.position);
              }
              generator = streamGrok(chatMessages, llmConfig);
              break;
            }

            case 'text-generation-webui':
            case 'koboldcpp':
            default: {
              const prompt = buildCompletionPrompt({
                systemPrompt: finalSystemPrompt,
                messages: historyMessages,
                character: processedCharacter,
                userName: effectiveUserName,
                postHistoryInstructions: resolvedPostHistoryInstructions,
                embeddingsContext: embeddingsContext,  // Memory embeddings before chat history
                exampleMessages: exampleMessages,
                allCharacters: allCharacters  // Pass all characters for proper speaker attribution
              });
              generator = streamTextGenerationWebUI(prompt, llmConfig);
              break;
            }
          }

          let fullContent = '';
          
          // Stream the response
          for await (const chunk of generator) {
            fullContent += chunk;
            controller.enqueue(createSSEJSON({ type: 'token', content: chunk }));
          }

          // Clean response
          const cleanedContent = cleanResponseContent(fullContent, processedCharacter.name);

          // Send done signal with the full content
          controller.enqueue(createSSEJSON({ 
            type: 'done', 
            content: cleanedContent,
            messageId,
            sessionId
          }));
          controller.close();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          controller.enqueue(createSSEJSON({ type: 'error', error: errorMessage }));
          controller.close();
        }
      }
    });

    return createSSEStreamResponse(stream);
  } catch (error) {
    return createErrorResponse(
      error instanceof Error ? error.message : 'Failed to regenerate response',
      500
    );
  }
}
