---

# Task ID: EXPLORE-1
**Agent:** Explore
**Task:** Research proactive messages system + lorebook attribute system for upcoming "proactive messages" redesign.

## Work Log

### Files Read
- `/home/z/my-project/newsillytavern2/src/types/index.ts` (selective: ProactiveMessagesConfig, MicroReactionConfig, Lorebook types, AttributeDefinition, SessionStats)
- `/home/z/my-project/newsillytavern2/src/components/tavern/proactive-messages-panel.tsx` (full, 1126 lines)
- `/home/z/my-project/newsillytavern2/src/hooks/use-proactive-messages.tsx` (full, 846 lines)
- `/home/z/my-project/newsillytavern2/src/app/api/chat/proactive/route.ts` (full, 2029 lines)
- `/home/z/my-project/newsillytavern2/src/lib/lorebook/attribute-evaluator.ts` (full, 574 lines — DEAD CODE)
- `/home/z/my-project/newsillytavern2/src/lib/lorebook/attribute-resolver.ts` (full, 467 lines — LIVE)
- `/home/z/my-project/newsillytavern2/src/lib/lorebook/injector.ts` (full, 254 lines)
- `/home/z/my-project/newsillytavern2/src/lib/lorebook/entry-key-builder.ts` (full, 160 lines)
- `/home/z/my-project/newsillytavern2/src/lib/lorebook/scanner.ts` (first 300 of 608 lines)
- `/home/z/my-project/newsillytavern2/src/lib/lorebook/index.ts` (full, 43 lines)
- `/home/z/my-project/newsillytavern2/src/lib/key-resolver.ts` (selective: resolveLorebookAttributeKeys, resolveLorebookEntryKeys, resolveAllKeys, buildKeyResolutionContext)
- `/home/z/my-project/newsillytavern2/src/lib/llm/prompt-builder.ts` (selective: buildLorebookSectionForPrompt lines 713-761)
- `/home/z/my-project/newsillytavern2/src/components/tavern/lorebook-panel.tsx` (selective: LorebookEntryEditor lines 680-1320)
- `/home/z/my-project/newsillytavern2/src/components/tavern/lorebook-attribute-editor.tsx` (first 300 of 857 lines — DEAD CODE)

---

## 1. Exact TypeScript Type Definitions (verbatim)

### `ProactiveMessagesConfig` — `src/types/index.ts` lines 1277–1337

```ts
export interface ProactiveMessagesConfig {
  enabled: boolean;                   // Master toggle
  intervalSeconds: number;            // How often (in seconds) to send a proactive message
  minMessagesBeforeStart: number;     // Minimum messages in the chat before proactive starts
  maxPerSession: number;              // Max proactive messages per session (0 = unlimited)
  customPrompt?: string;              // Optional custom instruction for proactive message generation
  nudgeTemplate?: string;             // Optional nudge message template (replaces default "[La escena continúa] {{user}} parece distraído...")
  allowedStates: ('idle' | 'user_away')[];  // When to trigger (idle = no user activity, user_away = tab not focused)

  // ─── FASE 3: Proactividad Inteligente ───
  /** Pool of alternative nudge templates that rotate to add variety */
  nudgeTemplates?: string[];
  /** Number of recent messages to include as context in the nudge (0 = disabled, default 3) */
  contextMessagesCount?: number;
  /** Minutes before the character can repeat a similar topic (0 = disabled) */
  thematicCooldownMinutes?: number;
  /** Enable proactivity in group chats */
  groupChatEnabled?: boolean;
  /** Strategy for group chat proactive messages */
  groupChatStrategy?: 'any_speaker' | 'mentioned_only' | 'emotional_reaction';

  // ─── FASE 9: Contexto para Proactividad ───
  /** Include emotional state context in proactive system prompt */
  includeEmotionalContext?: boolean;
  /** Include relationship context in proactive system prompt */
  includeRelationshipContext?: boolean;
  /** Include active quests context in proactive system prompt */
  includeQuestContext?: boolean;
  /** Max characters per context message (0 = no limit, default 300) */
  contextMessageMaxChars?: number;
  /** Inject context into system prompt (true) instead of only the nudge (false) */
  contextInSystemPrompt?: boolean;
  /** Detect and retomar abandoned conversation topics */
  retomarAbandonedTopics?: boolean;
  /** Number of turns of silence before a topic is considered "abandoned" (default 10) */
  abandonedTopicThreshold?: number;
}

export const DEFAULT_PROACTIVE_MESSAGES_CONFIG: ProactiveMessagesConfig = {
  enabled: false,
  intervalSeconds: 300,               // 5 minutes default
  minMessagesBeforeStart: 5,          // Wait for at least 5 messages
  maxPerSession: 0,                   // Unlimited
  customPrompt: '',
  nudgeTemplate: '',
  allowedStates: ['idle'],
  // FASE 3 defaults
  nudgeTemplates: [],
  contextMessagesCount: 3,
  thematicCooldownMinutes: 0,
  groupChatEnabled: false,
  groupChatStrategy: 'any_speaker',
  // FASE 9 defaults
  includeEmotionalContext: true,
  includeRelationshipContext: true,
  includeQuestContext: true,
  contextMessageMaxChars: 300,
  contextInSystemPrompt: true,
  retomarAbandonedTopics: false,
  abandonedTopicThreshold: 10,
};
```

### `ProactiveMessageInfo` — `src/types/index.ts` lines 1340–1349 (stored in `ChatMessage.metadata`)

```ts
export interface ProactiveMessageInfo {
  isProactive: true;
  triggeredAt: string;
  reason: 'timer_idle' | 'timer_away';
  characterName: string;
  /** Index of the nudge template used (for rotation tracking) */
  nudgeIndex?: number;
  /** Brief topic/theme of the proactive message (for cooldown tracking) */
  topic?: string;
}
```

### `MicroReactionConfig` — `src/types/index.ts` lines 824–836

```ts
export interface MicroReactionConfig {
  enabled: boolean;
  maxReactionsPerMessage: number;  // Limit reactions per message (default: 2)
  reactionChance: number;         // 0-1 probability of reacting (default: 0.3)
  triggers: ('mention' | 'emotional' | 'topic')[];  // What triggers reactions
}

export const DEFAULT_MICRO_REACTION_CONFIG: MicroReactionConfig = {
  enabled: false,
  maxReactionsPerMessage: 2,
  reactionChance: 0.3,
  triggers: ['mention', 'emotional'],
};
```

### Lorebook Attribute Types — `src/types/index.ts` lines 2419–2565

```ts
export type LorebookPosition =
  | 0   // After system prompt
  | 1   // After user message
  | 2   // Before user message
  | 3   // After assistant message
  | 4   // Before assistant message
  | 5   // At top of chat
  | 6   // At bottom of chat (newest messages)
  | 7;  // Outlet (custom position, use outletName field)

export type LorebookEntryType = 'traditional' | 'attribute';

/**
 * Operators for attribute comparison in lorebook entries.
 */
export type AttributeComparator = '<' | '<=' | '>' | '>=' | '==' | '!=' | 'contains' | 'not_contains';

/**
 * Mode for attribute entry evaluation.
 * - 'static': single condition, inject entry.content if met
 * - 'dynamic': multiple conditions, each with its own content
 */
export type AttributeEntryMode = 'static' | 'dynamic';

/**
 * Static condition for attribute lorebook entries.
 * If the condition is met, the entry's `content` field is injected.
 */
export interface LorebookStaticCondition {
  operator: AttributeComparator;
  value: number | string;
}

/**
 * Dynamic condition for attribute lorebook entries.
 * Each condition has its own content that gets injected when met.
 * Multiple conditions can match simultaneously (contents are concatenated).
 */
export interface LorebookDynamicCondition {
  id: string;
  operator: AttributeComparator;
  value: number | string;
  content: string;
  /**
   * Priority of this condition (higher = more important).
   * Used in 'first-match' resolution mode: only the highest-priority matching condition wins.
   * In 'concat-all' mode, conditions are concatenated in priority order (highest first).
   * Default: 0
   */
  priority?: number;
}

/**
 * Configuration for attribute-based lorebook entries.
 */
export interface LorebookAttributeConfig {
  /** Target character ID: '__user__' for persona, '__char__' for current character, or specific character ID */
  characterId: string;
  /** Attribute key to check (e.g., 'vida', 'mana') */
  attributeKey: string;
  /** Evaluation mode */
  mode: AttributeEntryMode;
  /**
   * Injection key for this attribute entry.
   * When conditions are met, {{injectionKey}} in prompt text is replaced with the resolved content.
   * Example: 'estadoHeroe' → {{estadoHeroe}} in character description resolves to the entry's content.
   */
  injectionKey: string;
  /** Condition for static mode */
  staticCondition?: LorebookStaticCondition;
  /** Conditions for dynamic mode (multiple, each with own content) */
  dynamicConditions?: LorebookDynamicCondition[];
  /** Optional fallback content when no dynamic condition matches */
  fallbackContent?: string;
  /**
   * Resolution mode for dynamic conditions:
   * - 'concat-all': All matching conditions are concatenated (default). Ordered by priority (highest first).
   * - 'first-match': Only the highest-priority matching condition wins. When multiple match, only the top one is used.
   * Default: 'concat-all'
   */
  dynamicResolution?: 'concat-all' | 'first-match';
}

export interface LorebookEntry {
  uid: number;                    // Unique identifier
  key: string[];                  // Primary keywords (supports regex with /pattern/flags)
  keysecondary: string[];         // Secondary keywords (optional, supports regex)
  comment: string;                // Entry title/description
  content: string;                // Content to inject
  constant: boolean;              // Always active
  selective: boolean;             // Use secondary keys
  order: number;                  // Insertion order (higher = later)
  position: LorebookPosition;     // Where to inject
  outletName?: string;            // Outlet name (used when position = 7)
  disable: boolean;               // Entry disabled
  excludeRecursion: boolean;      // Exclude from recursive scanning
  preventRecursion: boolean;      // Prevent this entry from triggering others
  delayUntilRecursion: boolean;   // Only activate during recursion
  probability: number;            // Activation probability (0-100)
  useProbability: boolean;        // Use probability check
  depth: number;                  // Scan depth (messages to scan back)
  selectLogic: number;            // 0 = AND_ANY, 1 = NOT_ALL, 2 = NOT_ANY, 3 = AND_ALL
  group: string;                  // Group name
  groupOverride: boolean;         // Override group settings
  groupWeight: number;            // Weight within group (for random selection)
  scanDepth: number | null;       // Custom scan depth (null = use global)
  caseSensitive: boolean | null;  // Case sensitive matching (null = use global)
  matchWholeWords: boolean | null; // Match whole words only
  useGroupScoring: boolean | null; // Use group scoring
  automationId: string;           // Automation ID
  role: number | null;            // Role (0 = system, 1 = user, 2 = assistant)
  vectorized: boolean;            // Vectorized for semantic search
  displayIndex: number;           // Display order in UI
  extensions: Record<string, unknown>; // Extension data
  /** Entry type: traditional (keyword-triggered) or attribute (stat-based) */
  entryType: LorebookEntryType;
  /** Attribute configuration (only when entryType = 'attribute') */
  attributeConfig?: LorebookAttributeConfig;
}
```

### Supporting Attribute Types — `src/types/index.ts`

```ts
// Line 4145
export type AttributeType = 'number' | 'keyword' | 'text';

// Line 4192
export interface AttributeDefinition {
  id: string;
  name: string;              // Display name: "Vida", "Maná", "Resistencia"
  key: string;               // Template key: "vida" → {{vida}}
  type: AttributeType;
  defaultValue: number | string;
  min?: number;
  max?: number;
  thresholdEffects?: ThresholdEffect[];
  keys?: string[];           // Alternative detection keys
  caseSensitive?: boolean;
  outputFormat?: string;
  // ... (more fields)
}

// Line 4391
export interface CharacterStatsConfig {
  enabled: boolean;
  attributes: AttributeDefinition[];
  skills: SkillDefinition[];
  intentions: IntentionDefinition[];
  invitations: InvitationDefinition[];
  solicitudDefinitions: SolicitudDefinition[];
  blockHeaders: StatsBlockHeaders;
  timerEnabled?: boolean;
  timerTickSeconds?: number;
  timerMaxAccumulatedTicks?: number;
}

// Line 4422
export interface CharacterSessionStats {
  attributeValues: Record<string, number | string>;
  lastUpdated: Record<string, number>;
  changeLog?: StatChangeLogEntry[];
  emotionalState?: string;
  emotionalStateLastEval?: number;
  emotionalStateTurnCount?: number;
}

// Line 4439
export interface SessionStats {
  characterStats: Record<string, CharacterSessionStats>;
  solicitudes: SessionSolicitudes;
  // ... event tracking fields ...
  initialized: boolean;
  lastModified: number;
  lastTimerUpdate?: number;
  keywordCycleIndex?: Record<string, number>;
}
```

---

## 2. Proactive Trigger Flow (End-to-End)

### Step 1 — Timer fires (client-side hook)
**File:** `src/hooks/use-proactive-messages.tsx`

- `useProactiveMessages({ isGenerating, onProactiveMessage, onProactiveStreamStart, onProactiveStreamToken, onProactiveStreamEnd })` (line 82)
- Two intervals: `countdownRef` (1s — updates `nextIn` for UI display, lines 794-798) and `timerRef` (5s — checks if it's time to fire, lines 801-817).
- `lastActivityTimeRef` is reset to `Date.now()` whenever a new message arrives (effect at lines 196-208).
- When `elapsed = Date.now() - lastActivityTimeRef.current >= intervalMs`:
  - Checks `document.hidden` and `config.allowedStates` to determine if `user_away` or `idle` trigger is permitted (lines 808-814).
  - Calls `generateProactiveMessage(reason)` (line 815, defined at line 211).

### Step 2 — Pre-flight checks
**File:** `src/hooks/use-proactive-messages.tsx` lines 211-265

`generateProactiveMessage(reason: 'timer_idle' | 'timer_away' | 'manual')`:
1. Group chat strategy enforcement (lines 216-246): for `mentioned_only` strategy, checks recent messages for character name; for `emotional_reaction`, scans for emotional keywords + character emotional state.
2. Checks `messageCount >= config.minMessagesBeforeStart` (line 248).
3. Checks `sessionCountRef.current < config.maxPerSession` (line 259).
4. Re-reads latest store state to capture fresh `questTemplates`, `questSettings`, `settings`, `soundTriggers`, `characters`, `hudTemplates`, `hudSessionState` (line 271).
5. Builds `allCharactersWithPersona` (adds `__user__` pseudo-character if persona has statsConfig enabled, lines 290-297).
6. Builds `hudContext` from active HUD template (lines 300-303).
7. Gathers sessionQuests and summary (lines 306-307).
8. Builds `inventoryData` from Zustand store (lines 342-357).

### Step 3 — POST to API
**File:** `src/hooks/use-proactive-messages.tsx` lines 309-369

```ts
const response = await fetch('/api/chat/proactive', {
  method: 'POST',
  body: JSON.stringify({
    character, messages, llmConfig, userName, persona, lorebooks,
    sessionStats, proactiveConfig, reason, lastActivityAt,
    allCharacters: allCharactersWithPersona,
    questTemplates, sessionQuests, questSettings, hudContext,
    embeddingsChat: { ...settings.embeddingsChat, customNamespaces: activeCharacter?.embeddingNamespaces },
    toolsSettings: settings.tools, summary, contextConfig: settings.context,
    sessionId, characterId, soundTriggers, settings,
    characterMemory: useTavernStore.getState().getCharacterMemory(activeCharacter.id),
    inventoryData,
    usedNudgeIndices: usedNudgeIndicesRef.current,
    recentTopics: recentTopicsRef.current.filter(...).map(t => t.topic),
    isGroupChat: !!activeGroupId,
  }),
});
```

### Step 4 — API route constructs the prompt
**File:** `src/app/api/chat/proactive/route.ts` (POST handler at line 289)

4.1 **Validate + extract** (lines 295-395): pulls `character`, `messages`, `llmConfig`, `proactiveConfig`, `lorebooks`, `sessionStats`, `allCharacters`, `hudContext`, `questTemplates`, `sessionQuests`, `questSettings`, `soundTriggers`, `summary`, `embeddingsChat`, `characterMemory`, `sessionId`, `characterId`, `inventoryData`, `toolsSettings` from body.

4.2 **Build context window** (line 407): `selectContextMessages(messages, llmConfig, contextConfig)`.

4.3 **Build lorebook section** (lines 413-422):
```ts
const { plan: lorebookPlan, lorebookAttributeKeys, lorebookEntryKeyMap, lorebookDebugEntries }
  = buildLorebookSectionForPrompt(messages, lorebooks, { scanDepth, userName, charName },
    { sessionStats, characterId: effectiveCharacter?.id, characters: allCharacters });
```
- Internally calls `resolveLorebookAttributeKeys(lorebooks, attributeContext)` → returns `Record<injectionKey, resolvedContent>`.
- Also calls `buildLorebookEntryKeyMap(lorebooks)` → returns `Record<key, entry.content>` for traditional entries.

4.4 **Embeddings retrieval** (lines 445-515): uses recent chat history (last `searchContextDepth * 2` messages) as the search query.

4.5 **Build base system prompt** (lines 520-535):
```ts
const { prompt: systemPrompt, sections: systemSections, lorebookChatInjections, exampleMessages }
  = buildSystemPrompt(effectiveCharacter, effectiveUserName, persona, lorebookPlan,
      sessionStats, allCharacters, soundTriggers, soundSettings,
      questTemplates, sessionQuests, questSettings,
      lorebookAttributeKeys, inventoryData, lorebookEntryKeyMap);
```
This builds the standard character/persona/scenario/personality prompt with `{{injectionKey}}` and `{{key}}` already resolved via `resolveAllKeys` inside `buildSystemPrompt`.

4.6 **Build key resolution context** (lines 546-583):
```ts
const resolvedStats = resolveStats({ characterId, statsConfig, sessionStats, allCharacters, ... });
const keyContext = buildKeyResolutionContext(
  effectiveCharacter, effectiveUserName, persona, resolvedStats,
  sessionStats, soundTriggers, soundSettings, streamPersonaResolvedStats,
  questTemplates, sessionQuests, questSettings,
  outletSections, lorebookAttributeKeys, inventoryData
);
```

4.7 **Build proactive instruction** (lines 709-755):
- `defaultInstruction` (lines 710-718): Spanish instruction text with `{{user}}` placeholder telling character how to behave proactively.
- `groupChatInstructions` (lines 723-748): three strategy variants (`any_speaker`, `mentioned_only`, `emotional_reaction`).
- Selection logic (lines 753-754):
  ```ts
  const rawProactiveInstruction = proactiveConfig.customPrompt?.trim()
    || (isGroupChat ? groupChatInstruction : defaultInstruction);
  const proactiveInstruction = resolveAllKeys(rawProactiveInstruction, keyContext);
  ```
- Appended to finalSystemPrompt (line 759):
  ```ts
  finalSystemPrompt += `\n\n[Proactive Message Instruction]\n${proactiveInstruction}`;
  ```

4.8 **FASE 9: Context sections** (lines 770-934): builds optional context blocks (emotional state, relationship, quests, recent msgs, abandoned topics, thematic cooldown) and appends them to `finalSystemPrompt` if `contextInSystemPrompt === true`.

4.9 **Build nudge message** (lines 990-1068):
- Pool = `nudgeTemplate` (primary) + `nudgeTemplates[]` (rotating alternatives) (lines 998-1012).
- Rotation: skips indices in `clientUsedNudgeIndices`, picks random unused; if all used, picks random from full pool (lines 1014-1026).
- Default nudge (line 995): `[La escena continúa] {{user}} parece distraído así que {{char}} decide hacer o decir algo para que todo continúe.`
- Context snippet (lines 1029-1049): if `!contextInSystemPrompt`, appends recent msgs as `[Contexto reciente de la conversación]`.
- Cooldown instruction (lines 1051-1057): if `!contextInSystemPrompt`, appends `[Evita repetir estos temas recientes: ...]`.
- Resolve keys (line 1060): `nudgeContent = resolveAllKeys(rawNudgeMessage, keyContext)`.
- Append context + cooldown (lines 1062-1068).

4.10 **Assemble final messages** (lines 1097-1116):
```ts
let allMessages = summaryMessage ? [summaryMessage, ...finalContextWindow.messages] : [...finalContextWindow.messages];
allMessages = [...allMessages, {
  id: 'nudge-' + Date.now(),
  role: 'user', characterId: effectiveCharacter.id,
  content: nudgeContent, isDeleted: false,
  timestamp: new Date().toISOString(),
  swipeId: 'nudge', swipeIndex: 0, swipes: [nudgeContent],
}];
```

4.11 **Build provider call** (lines 1182-1896): switches on `llmConfig.provider` (test-mock, z-ai, openai/vllm/lm-studio/custom, anthropic, ollama, grok, text-generation-webui/koboldcpp, default). For each provider, calls `buildChatMessages(finalSystemPrompt, allMessages, character, userName, postHistoryInstructions, ..., lorebookChatInjections, exampleMessages)` then streams response tokens to the client as SSE `token` events.

### Step 5 — SSE events sent to client
**File:** `src/app/api/chat/proactive/route.ts` lines 1119-2020

Event order:
1. `proactive_start` (line 1123) — `{ characterId, characterName, reason, nudgeIndex }`
2. `prompt_data` (line 1132) — `{ promptSections }` (for prompt viewer dialog)
3. `lorebook_debug` (line 1139, conditional) — attribute resolution debug data
4. `embeddings_context` (line 1147, conditional)
5. `token` (multiple, line 1946) — streamed content chunks
6. `tool_call_start` / `tool_call_result` / `quest_activation` / `action_activation` / `stat_activation` / `solicitud_activation` / `memory_activation` (during tool rounds)
7. `done` (line 2003) — `{ toolsUsed, questActivations, isProactive, characterId, characterName, reason, shouldExtract }`

### Step 6 — Client handles SSE and injects the message
**File:** `src/hooks/use-proactive-messages.tsx` lines 377-741

- Reads SSE stream with `response.body.getReader()`, parses `data: {...}` lines.
- On `proactive_start` (line 410): pushes `nudgeIndex` to `usedNudgeIndicesRef`.
- On `token` (line 420): accumulates `accumulatedContent` + calls `onProactiveStreamToken`.
- On `done` (line 566):
  - Strips char-name prefix from `accumulatedContent` if present (line 573).
  - Increments `sessionCountRef` (line 578).
  - Builds `ProactiveMessageInfo` (lines 582-590) with `isProactive: true`, `triggeredAt`, `reason`, `characterName`, `nudgeIndex`, `topic: extractTopic(cleanedMessage)`.
  - Tracks topic for cooldown (lines 593-598).
  - Calls `onProactiveMessage({ characterId, content, metadata })` (line 613) or falls back to direct `addMessage(sessionId, {...})` (line 619).
  - Resets `lastActivityTimeRef` (line 630).
  - Shows toast notification (line 632).
  - If `parsed.shouldExtract`, fires background POST to `/api/embeddings/extract-memory` (lines 640-738).

---

## 3. Lorebook Attribute Evaluation Flow

### Traditional vs Attribute Entries
- **Traditional entries** (`entryType === 'traditional'`): scanned via `scanner.ts scanForLorebookEntries` → injected via `injector.ts buildLorebookInjectionPlan` at one of 7 positions (after system, top/bottom of chat, around messages, outlets). Also exposed via `{{key}}` substitution through `entry-key-builder.ts buildLorebookEntryKeyMap`.
- **Attribute entries** (`entryType === 'attribute'`): NOT scanned. Resolved via `attribute-resolver.ts resolveLorebookAttributeKeys` → returns `Record<injectionKey, resolvedContent>`. The content replaces `{{injectionKey}}` placeholders in any prompt text via `key-resolver.ts resolveLorebookAttributeKeys`.

### Attribute Resolution Flow
**File:** `src/lib/lorebook/attribute-resolver.ts` — `resolveLorebookAttributeKeys(lorebooks, context)` (line 81)

**Phase 1 — Collect** (lines 103-116): gather all `entryType === 'attribute'` entries that are non-disabled and have an `attributeConfig.injectionKey`. Sort by `entry.order` ascending (lower order = higher priority).

**Phase 2 — Resolve each entry** (lines 133-229):
For each entry, in priority order:
1. If `injectionKey` already has a resolved match from a higher-priority entry → skip and emit debug entry with `operator: '(skipped)'` (lines 138-161).
2. Resolve `__user__` / `__char__` to actual character ID via `resolveCharacterId(config.characterId, context)` (lines 374-388).
3. Read attribute value from `sessionStats.characterStats[resolvedCharId].attributeValues[attributeKey]` via `getAttributeValue(characterId, attributeKey, context)` (lines 393-405). Returns `null` if missing.
4. Call `resolveSingleAttributeEntry(entry, context)` (line 199 → defined at line 278).

**`resolveSingleAttributeEntry`** (lines 278-341):
- **Static mode** (lines 300-306): if `evaluateCondition(attrValue, staticCondition.operator, staticCondition.value)` returns true → return `entry.content` formatted with `<START>` dialogue processing. Else return `null`.
- **Dynamic mode** (lines 308-337):
  - Filter `dynamicConditions` where `evaluateCondition(attrValue, cond.operator, cond.value)` is true (lines 310-311).
  - If matches found:
    - Sort by `priority` descending (lines 318 / 323).
    - `first-match` mode (lines 316-320): return only the top match's content.
    - `concat-all` mode (lines 322-328): return all matched contents joined with `\n\n`, ordered by priority desc.
  - If no matches: return `fallbackContent` if set (lines 332-334), else `null`.

**Phase 3 — Build final map** (lines 239-251):
- For each `injectionKey` seen across all entries:
  - If any entry matched → use the highest-priority matched content.
  - If no entry matched → empty string `""` (so `{{injectionKey}}` becomes nothing in the prompt).

### `evaluateCondition` — operator evaluation
**File:** `src/lib/lorebook/attribute-resolver.ts` lines 423-467

```ts
function evaluateCondition(attrValue, operator: AttributeComparator, compareValue): boolean {
  // String operators (always case-insensitive)
  if (operator === 'contains') return String(attrValue).toLowerCase().includes(String(compareValue).toLowerCase());
  if (operator === 'not_contains') return !String(attrValue).toLowerCase().includes(String(compareValue).toLowerCase());

  // Try numeric comparison first
  const numAttr = typeof attrValue === 'number' ? attrValue : parseFloat(String(attrValue));
  const numComp = typeof compareValue === 'number' ? compareValue : parseFloat(String(compareValue));
  const bothNumeric = !isNaN(numAttr) && !isNaN(numComp);

  if (bothNumeric) {
    switch (operator) {
      case '<':  return numAttr <  numComp;
      case '<=': return numAttr <= numComp;
      case '>':  return numAttr >  numComp;
      case '>=': return numAttr >= numComp;
      case '==': return numAttr === numComp;
      case '!=': return numAttr !== numComp;
      default: return false;
    }
  }

  // Text comparison (one or both values are non-numeric)
  const strAttr  = String(attrValue).toLowerCase();
  const strComp  = String(compareValue).toLowerCase();
  switch (operator) {
    case '==': return strAttr === strComp;
    case '!=': return strAttr !== strComp;
    case '<': case '<=': case '>': case '>=': return false;  // numeric-only
    default: return false;
  }
}
```

### {{key}} Substitution Mechanism
**File:** `src/lib/key-resolver.ts`

`resolveAllKeys(text, context)` (line 945) runs 7 phases in order:
1. `resolveTemplateVariables` — `{{user}}`, `{{char}}`, `{{userpersona}}`, `{{persona}}`, conditionals `{{#if}}`, `{{#user}}`, `{{#char}}`, `{{outlet::name}}` (uses `context.outletSections`).
2. `resolveStatsKeys` — `{{attributeKey}}` (e.g., `{{vida}}`) from `context.resolvedStats`.
3. `resolveEventKeys` — `{{solicitante}}`, `{{solicitado}}`, `{{eventos}}`.
4. `resolveSoundKeys` — `{{sonidos}}`.
5. `resolveQuestKeys` / `resolveAvailableQuestsKey` — `{{activeQuests}}`, `{{availableQuests}}`.
6. `resolveLorebookAttributeKeys` (line 620) — `{{injectionKey}}` from attribute entries. **Case-insensitive regex replacement.** After replacement, re-runs `resolveTemplateVariables` + `resolveStatsKeys` on the result (because injected content may itself contain `{{char}}`, `{{vida}}`, etc.).
6.1. `resolveLorebookEntryKeys` (line 686) — `{{key}}` from traditional entries' `entry.key[]` array. Same case-insensitive + re-resolve pattern.
6.5. `resolveInventoryKeys` — `{{slots}}`, `{{currency}}`.
7. `resolveRemainingKeys` — strips any unresolved `{{...}}` to empty string (cleanup).

**Key sorting:** Both `resolveLorebookAttributeKeys` (line 636) and `resolveLorebookEntryKeys` (line 702) sort keys by **length descending** to avoid partial replacement (e.g., replace `{{estadoHeroe}}` before `{{estado}}`).

### Lorebook Attribute Editor UI
**File:** `src/components/tavern/lorebook-panel.tsx` — `LorebookEntryEditor` component (lines 688-1441)

For `entryType === 'attribute'` entries, the UI shows (lines 934-1258):
- **Injection Key** input (line 947-955): sanitized to `[a-zA-Z0-9_]`. Hint: `Usa {{injectionKey}} en la descripción, system prompt, etc.`
- **Character selector** (lines 960-989): `__user__` (Persona), `__char__` (Personaje actual), or specific character IDs.
- **Attribute selector** (lines 992-1014): filtered by selected character's `statsConfig.attributes`.
- **Comparison mode toggle** (lines 1018-1038): Static / Dynamic.
- **Static condition** (lines 1041-1091): comparator dropdown (filtered by attribute type: numeric → `==,!=,<,<=,>,>=`; text/keyword → `==,!=,contains,not_contains`), value input.
- **Dynamic conditions list** (lines 1094-1256):
  - Resolution toggle (lines 1112-1133): `concat-all` (Concatenar todo) / `first-match` (Solo mayor prioridad).
  - Each condition card: priority number input, comparator dropdown, value input, content textarea, reorder up/down buttons, delete button.
  - **Fallback content** textarea (lines 1246-1255): used when no dynamic condition matches.
- **Main content textarea** (lines 1262-1278): always visible; in static mode this is what's injected on match; in dynamic mode it's faded out and labeled "Contenido base (no usado en modo dinámico)".

### Scanner (Traditional entries only)
**File:** `src/lib/lorebook/scanner.ts` lines 120-248

`scanForLorebookEntries(messages, lorebooks, options)`:
- Skips attribute entries (line 164).
- For each non-disabled entry:
  - Constants (`entry.constant === true`) → always included (line 171).
  - Otherwise scans last `entry.scanDepth ?? settings.scanDepth ?? options ?? 5` messages.
  - Supports regex keys (`/pattern/flags`) via `isRegexKey` + `parseRegexKey`.
  - Plain-text matching with optional case sensitivity and whole-word matching.
  - `selectLogic`: 0=AND_ANY, 1=NOT_ALL, 2=NOT_ANY, 3=AND_ALL.
- Returns sorted by `entry.order` ascending.

---

## 4. Files to Modify for the Redesign

### (a) Prefix / Message / Suffix system prompt sections

**Type changes** — `src/types/index.ts`:
- Add new optional fields to `ProactiveMessagesConfig` (around line 1313): `proactivePrefix?: string`, `proactiveMessage?: string`, `proactiveSuffix?: string`. The existing `customPrompt` (used as "instruction") and `nudgeTemplate` (used as the final user message) are conceptually the "message body" and the "user-side nudge". Consider deprecating `customPrompt` in favor of a unified 3-section structure: prefix goes into `finalSystemPrompt`, message goes into both system prompt + nudge user message, suffix goes at the very end of the system prompt (or as post-history instructions).

**API route** — `src/app/api/chat/proactive/route.ts`:
- Lines 709-759 (proactiveInstruction construction): replace with `prefix + "\n\n" + message + "\n\n" + suffix` assembly. Resolve each via `resolveAllKeys(..., keyContext)`.
- Lines 990-1068 (nudge construction): if `proactiveMessage` is set, use it as the nudge content; otherwise fall back to `nudgeTemplate`/`nudgeTemplates[]` for backward compat.
- Lines 1106-1116 (nudge appended as user message): keep behavior, but make sure suffix is appended to `finalSystemPrompt` BEFORE the nudge message.

**UI** — `src/components/tavern/proactive-messages-panel.tsx`:
- Replace or augment the existing "Instrucción Personalizada" card (lines 373-397) and "Mensaje de Impulso (Nudge) Principal" card (lines 399-426) with three cards: Prefix, Message, Suffix — each a `Textarea` with template variable reference.

### (b) Attribute-based conditions for proactive

**Type changes** — `src/types/index.ts`:
- Define a new interface mirroring `LorebookStaticCondition` / `LorebookDynamicCondition`:
  ```ts
  export interface ProactiveAttributeCondition {
    id: string;
    characterId: string;          // '__user__' | '__char__' | specific id
    attributeKey: string;
    operator: AttributeComparator;
    value: number | string;
  }
  ```
- Add to `ProactiveMessagesConfig`: `attributeConditions?: ProactiveAttributeCondition[]`, `attributeConditionLogic?: 'AND' | 'OR'`, plus per-condition dynamic content if needed (mirroring `LorebookDynamicCondition`).

**Hook** — `src/hooks/use-proactive-messages.tsx`:
- In `generateProactiveMessage` (around lines 248-265, after the min/max message checks), evaluate conditions against `useTavernStore.getState().sessions.find(...).sessionStats.characterStats` (already used at line 237 for `emotionalState`). If conditions fail, return early (skip the API call). This is the most efficient place — saves an LLM round-trip when conditions don't match.

**Alternatively (server-side evaluation)** — `src/app/api/chat/proactive/route.ts`:
- After line 422 (after `buildLorebookSectionForPrompt`), evaluate conditions using the existing `evaluateCondition` function from `attribute-resolver.ts`. If conditions fail, return a 200 with `{ skipped: true, reason: 'conditions_not_met' }` and have the client treat it as a no-op.

### (c) Multiple cases per condition with linear/random mode

**Type changes** — `src/types/index.ts`:
- Mirror `LorebookDynamicCondition`:
  ```ts
  export interface ProactiveCase {
    id: string;
    priority?: number;
    content: string;             // nudge message body OR full proactive message
    condition?: ProactiveAttributeCondition;  // optional per-case condition (if not set, always matches)
  }
  ```
- Add to `ProactiveMessagesConfig`: `cases?: ProactiveCase[]`, `caseResolution?: 'concat-all' | 'first-match' | 'linear' | 'random'`.

**API route** — `src/app/api/chat/proactive/route.ts`:
- Extend the nudge pool selection (lines 990-1027) to support `caseResolution`:
  - `linear`: pick `cases[usedCasesCount % cases.length]` (track a counter sent by client, like `usedNudgeIndices`).
  - `random`: pick random unused case (mirror the rotation logic at lines 1014-1026).
  - `first-match` / `concat-all`: evaluate each case's `condition` (if any) using `evaluateCondition`, then either take top-priority match or concatenate all matches (mirror `resolveSingleAttributeEntry` lines 308-329).

**Hook** — `src/hooks/use-proactive-messages.tsx`:
- Add a `usedCaseIndicesRef = useRef<number[]>([])` (mirror `usedNudgeIndicesRef` at line 101).
- Pass `usedCaseIndices` in the API request body (around line 359).
- On `proactive_start` SSE event, push the selected case index to the ref (mirror line 415).

### (d) Lorebook key substitution in proactive messages — ALREADY WORKS

**Verified working** — `src/app/api/chat/proactive/route.ts`:
- Line 755: `resolveAllKeys(rawProactiveInstruction, keyContext)` — resolves `{{injectionKey}}` (from attribute lorebook entries) AND `{{key}}` (from traditional lorebook entries) in `customPrompt`.
- Line 1060: `resolveAllKeys(rawNudgeMessage, keyContext)` — same resolution on the nudge template.
- Line 1158: `resolveAllKeys(rawPostHistoryInstructions, keyContext)` — same on post-history instructions.
- The `keyContext` (built at lines 568-583) includes `lorebookAttributeKeys` and (implicitly via `buildKeyResolutionContext`) `lorebookEntryKeys`.

No changes needed for (d) — just verify the user knows they can use `{{anyLorebookKey}}` or `{{anyInjectionKey}}` in `customPrompt`, `nudgeTemplate`, `nudgeTemplates[]`, and `postHistoryInstructions`.

---

## 5. Existing Patterns to Reuse

1. **Attribute operator evaluation** — `evaluateCondition(attrValue, operator, compareValue)` in `src/lib/lorebook/attribute-resolver.ts` lines 423-467. Handles 8 operators (`==`, `!=`, `<`, `<=`, `>`, `>=`, `contains`, `not_contains`), numeric-vs-string auto-detection, case-insensitive string comparison. Should be extracted to a shared utility (e.g., `src/lib/attributes/evaluate.ts`) so the proactive hook/route can import it without coupling to the lorebook module.

2. **Priority resolution** — `resolveSingleAttributeEntry` in `src/lib/lorebook/attribute-resolver.ts` lines 278-341, specifically lines 316-329. Sorts matching conditions by `priority` descending and either takes the top match (`first-match`) or joins all with `\n\n` (`concat-all`). This is exactly the pattern needed for proactive case selection.

3. **Rotation / random-without-recent-repeat** — `/api/chat/proactive/route.ts` lines 1014-1026. Finds unused indices by filtering out `clientUsedNudgeIndices`, picks random unused; if all used, picks random from full pool. Client tracks state in `usedNudgeIndicesRef` (`use-proactive-messages.tsx` line 101) and sends it in the request body (line 359). This pattern can be directly applied to proactive cases for `linear`/`random` modes.

4. **{{key}} substitution (case-insensitive + re-resolve)** — `resolveLorebookAttributeKeys` (`key-resolver.ts` lines 620-667) and `resolveLorebookEntryKeys` (lines 686-733). Both:
   - Sort keys by length descending to prevent partial replacement.
   - Use case-insensitive regex `\{\{escapedKey\}\}` with `gi` flag.
   - After replacement, **re-run** `resolveTemplateVariables` and `resolveStatsKeys` on the result, because injected content may itself contain `{{char}}`, `{{vida}}`, etc. This recursive resolution is critical for layered templates.

5. **`buildKeyResolutionContext` factory** — `src/lib/key-resolver.ts` lines 1027-1063. Already accepts every piece of data needed: `lorebookAttributeKeys`, `lorebookEntryKeys`, `outletSections`, `inventoryData`, `resolvedStats`, `personaResolvedStats`, `questTemplates`, etc. The proactive route already builds this (lines 568-583) and passes it to every `resolveAllKeys` call.

6. **`resolveAllKeys` main entry** — `src/lib/key-resolver.ts` lines 945-984. Single function that runs all 7 resolution phases. Always use this (never call individual phase functions directly) to ensure consistent resolution order.

7. **SSE streaming pattern** — The proactive route returns a `ReadableStream` (line 1119) and uses `controller.enqueue(createSSEJSON({...}))` to emit typed events. Client-side reader parses `data: {...}` lines split by `\n\n`. This is the established pattern for any new event types (e.g., a `case_selected` event before `proactive_start` if the redesign needs to communicate which case won).

8. **ProactiveMessageInfo metadata** — `src/types/index.ts` lines 1340-1349. Already has `nudgeIndex` and `topic` fields. Add `caseIndex?: number` (or `caseId?: string`) for the redesign's case tracking.

---

## Stage Summary

**Status:** COMPLETE — research only, no files modified.

**Key takeaways for the redesign:**

1. **Dead code identified** — Two files are stale and should NOT be used as references:
   - `src/lib/lorebook/attribute-evaluator.ts` (574 lines) — imports nonexistent types (`AttributeRequirement`, `AttributeOperator`, `AttributeEntryConfig`, etc.) from `@/types`; not exported from `@/lib/lorebook/index.ts`; has zero live consumers. The actual attribute evaluation logic lives in `attribute-resolver.ts`.
   - `src/components/tavern/lorebook-attribute-editor.tsx` (857 lines) — also imports nonexistent types; only referenced by itself; the LIVE attribute editor UI is inline inside `src/components/tavern/lorebook-panel.tsx` (component `LorebookEntryEditor`, lines 688-1441).

2. **Lorebook key substitution in proactive messages already works** — Both `{{injectionKey}}` (from attribute entries) and `{{key}}` (from traditional entries) are substituted in `customPrompt`, `nudgeTemplate`, `nudgeTemplates[]`, and `postHistoryInstructions` via `resolveAllKeys`. No new work needed for requirement (d).

3. **Prefix/message/suffix is a natural extension** — The current code already has implicit sections: `finalSystemPrompt` (character + persona + lorebook + proactive instruction + FASE 9 context), `nudgeContent` (final user message), `postHistoryInstructions` (suffix-like). Adding explicit `proactivePrefix` / `proactiveMessage` / `proactiveSuffix` fields to `ProactiveMessagesConfig` and assembling them in `route.ts` lines 709-759 is straightforward.

4. **Attribute conditions for proactive should evaluate client-side** — In `use-proactive-messages.tsx` `generateProactiveMessage`, after the min/max message checks (around line 265), the hook has access to `useTavernStore.getState().sessions` (already used at line 237 for emotional state). Evaluate conditions there to avoid wasting an LLM call when the character "shouldn't" be proactive right now.

5. **Multiple cases with linear/random mode should reuse the rotation pattern** — The nudge-pool rotation logic at `route.ts` lines 998-1026 + `use-proactive-messages.tsx` `usedNudgeIndicesRef` is a clean, working pattern. Add `usedCaseIndicesRef` on the client, send `usedCaseIndices` in the request body, and extend the pool-selection switch to handle `linear`/`random`/`first-match`/`concat-all` modes.

6. **`evaluateCondition` should be extracted** — Currently it's a non-exported function inside `attribute-resolver.ts` (lines 423-467). For the proactive redesign to reuse it without importing the whole lorebook module, extract it to a shared utility like `src/lib/attributes/condition-evaluator.ts` and have both `attribute-resolver.ts` and the new proactive condition evaluator import from there.

7. **ProactiveMessageInfo needs a `caseIndex`/`caseId` field** — For tracking which proactive case was selected (analogous to `nudgeIndex`), add this to `src/types/index.ts` line 1340.

8. **The UI panel `proactive-messages-panel.tsx` is well-structured** — Each section is a self-contained `<Card>` with `updateSettings({...})` calls. New sections (attribute conditions, cases list, prefix/message/suffix textareas) can be added as additional `<Card>` components following the same pattern. The component already accepts `config` and `onChange` props (lines 81-87) which is all that's needed.

---
Task ID: FASE11-IMPL
Agent: main (Z.ai Code)
Task: Implementar la sección de proactivo mejorada con system prompt personalizado (Prefix/Message/Suffix), condiciones basadas en atributos del personaje (estilo lorebook attribute), y múltiples casos por condición con modos lineal/random.

Work Log:
- Clonado https://github.com/drAkeSteinn/newsillytavern2 en /home/z/my-project/newsillytavern2 (luego sincronizado a /home/z/my-project como proyecto activo en puerto 3000).
- Instaladas dependencias con `bun install` y aplicado `bun run db:push`.
- Tipos (src/types/index.ts): agregados ProactiveCase, ProactiveAttributeCondition, ProactiveAttributeConfig, ProactiveComparator, ProactiveCaseMode; campos proactivePrefix/proactiveSuffix/proactiveAttribute en ProactiveMessagesConfig; conditionId/caseIndex en ProactiveMessageInfo; defaults en DEFAULT_PROACTIVE_MESSAGES_CONFIG.
- Util compartido (src/lib/attributes/condition-evaluator.ts): extraído evaluateCondition desde attribute-resolver.ts (8 operadores, numeric/string auto-detect, case-insensitive) + COMPARATOR_LABELS, NUMERIC_COMPARATORS, TEXT_COMPARATORS.
- attribute-resolver.ts refactorizado para importar evaluateCondition del util compartido (sin duplicación).
- Selector de casos (src/lib/proactive/case-selector.ts): selectProactiveCase evalúa condiciones por prioridad desc, pickCaseIndex implementa linear (cíclico) y random (sin repetir reciente), defaultCases como fallback, nextUsed para tracking.
- API route (src/app/api/chat/proactive/route.ts): importado selectProactiveCase; extrae usedCaseIndices del body; selecciona caso tras construir keyContext; ensambla instruction = Prefix + Message(caso) + Suffix (cada uno resolveAllKeys); si proactiveAttribute activo y sin caso → retorna stream proactive_skipped; emite SSE case_selected antes de proactive_start (con conditionId, caseIndex, trackingKey, nextUsed).
- Hook (src/hooks/use-proactive-messages.tsx): agregado usedCaseIndicesRef + pendingCaseInfoRef; envía usedCaseIndices en body; handler case_selected actualiza tracking; handler proactive_skipped reinicia timer; proactive_start captura conditionId/caseIndex; ProactiveMessageInfo incluye conditionId/caseIndex.
- UI Panel (src/components/tavern/proactive-messages-panel.tsx): nueva Card "Prefijo y Sufijo del Prompt" (2 textareas con soporte de keys); nueva Card "Proactivo Condicional por Atributo" (toggle, selector de personaje, selector de atributo, lista de condiciones con prioridad/operador/valor/caseMode + casos editables, casos por defecto). Helpers ensureProactiveAttribute/updateProactiveAttribute/comparatorsForAttribute/makeId.
- character-editor.tsx: renderProactiveTab ahora construye availableTargets (__char__ actual + __user__ persona + otros personajes) y lo pasa al panel.

Verificación:
- ESLint: LIMPIO (bun run lint sin errores).
- TypeScript: los nuevos archivos (types, condition-evaluator, case-selector) no introducen errores; los errores de tsc en el proyecto son pre-existentes del repo clonado (tipado suelto en generate/group-stream/backgrounds routes, examples/, skills/).
- Test end-to-end vía API (POST /api/chat/proactive con proactiveAttribute habilitado, codicia=80):
  * case_selected emitido: conditionId=c1, caseIndex=0, trackingKey=c1, nextUsed=[0]
  * proactive_start con conditionId=c1, caseIndex=0
  * prompt_data mostró la instrucción ensamblada: "[PREFIJO] Tu codicia actual es Codicia: (80/100).\n\n[CODICIA ALTA] Quiero más oro, Hero. Dame todo lo que tienes.\n\n[SUFijo] Mantén el rol."
  * {{codicia}} resuelto a "Codicia: (80/100)" (sustitución de atributo)
  * {{user}} resuelto a "Hero" (variable de plantilla)
  * tokens streamados correctamente
- Test de lógica selectProactiveCase (bun script directo):
  * Lineal cíclico: 0→1→2→0→1 (cicla correctamente)
  * Default: codicia=50 → defaultCases, conditionId=null
  * Random: codicia=20 → c2 (<30) aplica
  * Disabled → null (fallback heredado)
  * Atributo null → default
- Dev server: compila / (GET 200) y todas las rutas API (persistence, tts, backgrounds, quest-templates, proactive) retornan 200.

Limitación conocida del entorno:
- La app newsillytavern2/TavernFlow es muy grande (ruta proactiva sola 2000+ líneas, + lancedb, embeddings, VR, sprites, quests, inventory, atmosphere). En el sandbox de 4GB, el next-server es OOM-killer tras compilar múltiples rutas simultáneamente durante una sesión de browser completa. Esto impide verificación visual interactiva completa en el browser, pero la verificación funcional (API + lógica) es completa y definitiva.

Stage Summary:
- Sistema FASE 11 de proactivo condicional por atributo IMPLEMENTADO y VERIFICADO end-to-end.
- Cumple todos los requisitos del usuario: 3 secciones (Prefix/Message/Suffix), condiciones por atributo con operadores y prioridad (estilo lorebook attribute), múltiples casos por condición con modos lineal (cíclico) y random, soporte de keys de lorebook en los mensajes, construcción del prompt = Prefix + Message + Sufix.
- Backward compatible: si proactiveAttribute está deshabilitado, usa customPrompt (comportamiento heredado).
- Artefactos: src/lib/attributes/condition-evaluator.ts, src/lib/proactive/case-selector.ts (nuevos); types/index.ts, attribute-resolver.ts, api/chat/proactive/route.ts, use-proactive-messages.tsx, proactive-messages-panel.tsx, character-editor.tsx (modificados).

---

# Task ID: EXPLORE-2
**Agent:** Explore
**Task:** Research-only comparison of NORMAL chat prompt construction (`/api/chat/stream/route.ts`) vs PROACTIVE chat prompt construction (`/api/chat/proactive/route.ts`), so a follow-up refactor can make the proactive route mirror the normal chat structure — with `proactivePrefix` flowing into the system prompt and `proactiveSuffix` flowing into the post-history instructions slot.

## Work Log

### Files read (full or targeted)
- `/home/z/my-project/src/app/api/chat/stream/route.ts` (1888 lines, fully read) — the reference normal chat route.
- `/home/z/my-project/src/lib/llm/prompt-builder.ts` (1798 lines, key functions fully read) — `buildSystemPrompt`, `buildLorebookSectionForPrompt`, `buildPostHistorySection`, `buildAuthorNoteSection`, `buildChatHistorySections`, `buildChatMessages`, `buildCompletionPrompt`, `buildHUDContextSection`, `injectHUDContextIntoMessages`, `injectHUDContextIntoSections`, `buildMemorySection`, `SECTION_COLORS`.
- `/home/z/my-project/src/app/api/chat/proactive/route.ts` (2147 lines, prompt-construction portions fully read) — current state after FASE11-IMPL.
- `/home/z/my-project/src/lib/proactive/case-selector.ts` (235 lines, fully read) — `selectProactiveCase`, `pickCaseIndex`, `UsedCaseIndices`, `SelectedProactiveCase`.
- `/home/z/my-project/src/types/index.ts` targeted — `ProactiveMessagesConfig` (lines 1362-1418), `DEFAULT_PROACTIVE_MESSAGES_CONFIG` (1420-1446), `ProactiveAttributeConfig` (1347-1360), `EmotionalStateConfig` (843-870), `CharacterStatsConfig` (4510-4527), `CharacterSessionStats` (4541-4555), `CharacterMemory`/`MemoryEvent`/`RelationshipMemory` (2812-2836).
- `/home/z/my-project/src/hooks/use-proactive-messages.tsx` targeted — `generateProactiveMessage`, timer loop, emotional-state check.
- Compared all `buildChatMessages(...)` call sites in both routes (6 each) + all `buildCompletionPrompt(...)` call sites (3 each).

---

## Part A — Normal chat prompt structure (the reference)

`/api/chat/stream/route.ts` builds the prompt in this exact order. Sections marked **[SYSTEM]** go into `finalSystemPrompt` (the first system message built by `buildChatMessages`); sections marked **[ALLMESSAGES]** become chat messages; sections marked **[POST-HISTORY]** go into the SAME system message as `finalSystemPrompt` (appended by `buildChatMessages` via the `postHistoryInstructions` arg); sections marked **[VIEWER-ONLY]** exist only in `finalAllPromptSections` for the prompt viewer but are already merged into `finalSystemPrompt` or `embeddingsContext` by the time we call `buildChatMessages`.

### A.1 The exact code that assembles `finalSystemPrompt` (stream/route.ts lines 524-539, 683-725)

```ts
// stream/route.ts lines 524-539
const { prompt: systemPrompt, sections: systemSections, lorebookChatInjections, exampleMessages } = buildSystemPrompt(
  effectiveCharacter,
  effectiveUserName,
  persona,
  lorebookPlan,
  sessionStats,
  allCharacters,            // peticiones/solicitudes resolution
  soundTriggers,           // {{sonidos}}
  soundSettings,
  questTemplates,          // {{activeQuests}}
  sessionQuests,
  questSettings,
  lorebookAttributeKeys,
  inventoryData,           // Inventory V2 ({{slots}})
  lorebookEntryKeyMap      // {{entryKey}}
);
```

`buildSystemPrompt(...)` (prompt-builder.ts lines 502-706) returns `sections` in this exact order:

1. **System Prompt** — `character.systemPrompt` or default `"You are now in roleplay mode. You will act as ${character.name}."` — label `'System Prompt'` (color `system`).
2. **Lorebook position 0** — `lorebookPlan.position0Section` (after system prompt) — label is set by the lorebook plan, type `lorebook`.
3. *(Persona section intentionally omitted — replaced by `{{persona}}` key in card fields.)*
4. **Character Description** — `character.description` — label `'Character Description'`.
5. **Personality** — `character.personality` — label `'Personality'`.
6. **Estado Emocional** (FASE 5) — only if `character.emotionalConfig?.enabled && includeInPrompt && sessionStats.characterStats[id].emotionalState` exists — label `'Estado Emocional'`, format from `promptInjectionFormat` (default `"Estado emocional actual: {estado}"`).
7. **Scenario** — `character.scenario` — label `'Scenario'`.
8. **Character's Note** — `character.characterNote` — label `"Character's Note"`.
9. **EJEMPLOS DE MENSAJES** — `character.mesExample` processed by `processExampleDialogue(...)` — label `'EJEMPLOS DE MENSAJES'`. *(Returns empty `exampleMessages` array — examples are now inlined as a text section, NOT injected as chat messages.)*
10. **Lorebook position 5** — `lorebookPlan.position5Section` (top of chat).
11. **Lorebook position 7** — `lorebookPlan.outletSections` (custom outlets — label `"World Info (outletName)"`).
12. **Lorebook position 6** — `lorebookPlan.position6Section` (bottom of chat).

All sections are then run through `resolveSectionsKeys(sections, keyContext)` (line 696) — which resolves `{{user}}`, `{{char}}`, `{{persona}}`, `{{stats}}`, `{{sonidos}}`, `{{injectionKey}}`, `{{entryKey}}`, `{{activeQuests}}`, `{{slots}}`, `{{outlet::name}}`, etc. — and joined into the final prompt string by `[${label}]\n${content}` joined with `\n\n`.

```ts
// stream/route.ts lines 683-685
let finalSystemPrompt = systemPrompt;
// (prompt-based tools section may be appended if !shouldUseTools — lines 720-725)
```

### A.2 The exact code that assembles `finalAllPromptSections` (stream/route.ts lines 633-776)

```ts
// stream/route.ts lines 635-653
const personaIndex = systemSections.findIndex(s => s.type === 'persona');
const prePersonaSections = personaIndex >= 0 ? systemSections.slice(0, personaIndex + 1) : systemSections;
const postPersonaSections = personaIndex >= 0 ? systemSections.slice(personaIndex + 1) : [];

const characterMemorySection = characterMemory
  ? buildMemorySection(characterMemory, effectiveCharacter.name || 'Character')
  : null;

let allPromptSections: PromptSection[] = [
  ...prePersonaSections,
  ...postPersonaSections,                                              // = systemSections (no persona section in current code)
  ...(summarySection ? [summarySection] : []),                        // 'Recuerdos Anteriores' (purple)
  ...(characterMemorySection ? [characterMemorySection] : []),        // 'Memoria de {char}' (violet)
  ...(embeddingsResult.nonMemorySection ? [embeddingsResult.nonMemorySection] : []),
  ...(embeddingsResult.memorySection ? [embeddingsResult.memorySection] : []),
  ...chatHistorySections,                                              // 'Chat History' (gray)
  ...(postHistorySection ? [postHistorySection] : [])                  // 'Post-History Instructions' (orange)
];

// HUD injected per configured position
if (hudContextSection && hudContext) {
  allPromptSections = injectHUDContextIntoSections(allPromptSections, hudContextSection, hudContext.position);
}
```

If the context window gets re-evaluated (reserved tokens > 200), the same sections are rebuilt with `finalChatHistorySections` (lines 757-776).

### A.3 The exact code that builds `allMessages` (stream/route.ts lines 778-794)

```ts
// stream/route.ts lines 783-794
const lastCtxMessage = finalContextWindow.messages[finalContextWindow.messages.length - 1];
const isLastMessageCurrentUser = lastCtxMessage?.role === 'user' &&
  lastCtxMessage?.content === sanitizedMessage;

// Inject summary at the START of chat history if it exists
let allMessages = summaryMessage
  ? [summaryMessage, ...finalContextWindow.messages]
  : [...finalContextWindow.messages];

if (!isLastMessageCurrentUser) {
  allMessages = [...allMessages, createUserMessage(sanitizedMessage)];
}
```

### A.4 The exact `buildChatMessages(...)` call (stream/route.ts lines 896-905 — z-ai case; identical pattern at 1059-1068, 1239-1248, 1395-1404, 1522-1531, 1633-1642)

```ts
// stream/route.ts lines 896-905
let chatMessages = buildChatMessages(
  baseSystemPrompt || finalSystemPrompt,      // 1. systemPrompt
  allMessages,                                // 2. messages
  effectiveCharacter,                         // 3. character
  effectiveUserName,                          // 4. userName
  effectiveCharacter.postHistoryInstructions?.trim(),  // 5. postHistoryInstructions (RAW — NOT resolved here)
  undefined,                                  // 6. authorNote
  true,                                       // 7. useSystemRole
  embeddingsContext,                          // 8. embeddingsContext
  lorebookChatInjections,                     // 9. lorebookChatInjections (positions 1-4)
  exampleMessages                             // 10. exampleMessages (always [] in current code)
);
if (hudContextSection && hudContext) {
  chatMessages = injectHUDContextIntoMessages(chatMessages, hudContextSection, hudContext.position);
}
```

Note: The post-history instructions arg (`effectiveCharacter.postHistoryInstructions?.trim()`) is the RAW, UNRESOLVED character field. The actual `resolveAllKeys` happens inside `buildPostHistorySection()` (called separately at line 605-608 for the prompt viewer) but the value passed to `buildChatMessages` is NOT pre-resolved — it is the raw string. *(Inspecting `buildChatMessages` at prompt-builder.ts lines 943-963 confirms: it just pushes the raw `postHistoryInstructions` string into `systemParts` and joins everything with `'\n\n---\n\n'` into a single system message.)*

### A.5 The actual final prompt sent to the LLM (normal chat)

After `buildChatMessages(...)`, the messages array looks like this (per prompt-builder.ts lines 925-1045):

1. **System message** (role: `'system'` because `useSystemRole=true`) containing, joined by `'\n\n---\n\n'`:
   - `[System Prompt]\n…` + `[Character Description]\n…` + `[Personality]\n…` + `[Estado Emocional]\n…` + `[Scenario]\n…` + `[Character's Note]\n…` + `[EJEMPLOS DE MENSAJES]\n…` + `[World Info...]\n…` (= the full `finalSystemPrompt`)
   - `embeddingsContext` (= character memory content + retrieved non-memory + retrieved memory, joined `\n\n`)
   - `[Author's Note]\n…` (only if `authorNote` arg — always `undefined` in stream route)
   - **`character.postHistoryInstructions` (raw string)** ← POST-HISTORY is part of the SAME system message
2. *(exampleMessages — currently always empty)*
3. **Chat history** (`allMessages` minus deleted/narrator) — merged to enforce user/assistant alternation, with synthetic `'*continúa*'` bridges inserted if needed.
4. The user's current message (`sanitizedMessage`) appended as the final user message (line 793).

**Summary table — Normal chat sections in actual send order:**

| # | Section | Where it lives | Source |
|---|---------|----------------|--------|
| 1 | System Prompt | finalSystemPrompt → system msg | `character.systemPrompt` |
| 2 | Lorebook pos 0 | finalSystemPrompt → system msg | `lorebookPlan.position0Section` |
| 3 | Character Description | finalSystemPrompt → system msg | `character.description` |
| 4 | Personality | finalSystemPrompt → system msg | `character.personality` |
| 5 | Estado Emocional | finalSystemPrompt → system msg | `sessionStats.characterStats[id].emotionalState` (FASE 5) |
| 6 | Scenario | finalSystemPrompt → system msg | `character.scenario` |
| 7 | Character's Note | finalSystemPrompt → system msg | `character.characterNote` |
| 8 | Example Dialogue | finalSystemPrompt → system msg | `character.mesExample` |
| 9 | Lorebook pos 5 / 7 / 6 | finalSystemPrompt → system msg | `lorebookPlan` |
| 10 | Embeddings context | system msg (after systemPrompt) | `embeddingsResult.nonMemoryContextString` + `memoryContextString` + `characterMemorySection.content` (dedup) |
| 11 | Author's Note | system msg (after embeddings) | `character.authorNote` (NOT passed in stream route — always empty) |
| 12 | **Post-History Instructions** | system msg (after authorNote) | `character.postHistoryInstructions` (RAW) |
| 13 | HUD Context | injected per `hudContext.position` | `hudContext.content` |
| 14 | Lorebook chat injections pos 1-4 | injected into specific messages | `lorebookChatInjections` |
| 15 | Chat History | user/assistant messages | `finalContextWindow.messages` |
| 16 | User's current message | final user message | `sanitizedMessage` (with dedup check) |

---

## Part B — Proactive prompt structure (current state after FASE11-IMPL)

`/api/chat/proactive/route.ts` builds the prompt. Sections A.1-A.4 of the proactive route mirror the normal chat route **identically** through line 624 (i.e. systemPrompt, keyContext, lorebook, hud, chatHistory, postHistorySection, summary, memory, embeddings, allPromptSections, HUD injection, context-window re-eval, finalAllPromptSections). All these are byte-equivalent to stream/route.ts except for:
- Line 425: `(contextConfig as any).scanDepth` (vs stream's `contextConfig.scanDepth` — minor typing cast, functionally identical).
- Lines 638-647: `summaryMessage` includes `swipes: [...]` array (extra field that stream route doesn't set — cosmetic).

**The divergence starts at line 734 with the proactive instruction construction.**

### B.1 The `proactivePrefix` + `proactiveMessage` + `proactiveSuffix` assembly (proactive/route.ts lines 831-858)

```ts
// proactive/route.ts lines 831-858
let rawProactiveMessage: string;
if (proactiveAttrEnabled && selectedProactiveCase) {
  // FASE 11: case selected by attribute
  rawProactiveMessage = selectedProactiveCase.content;
} else {
  // Legacy: customPrompt or default/group instruction
  rawProactiveMessage = proactiveConfig.customPrompt?.trim()
    || (isGroupChat ? groupChatInstruction : defaultInstruction);
}

// Resolve keys in each section (prefix, message, suffix)
const rawProactivePrefix = proactiveConfig.proactivePrefix?.trim() ?? '';
const rawProactiveSuffix = proactiveConfig.proactiveSuffix?.trim() ?? '';
const proactivePrefixResolved = resolveAllKeys(rawProactivePrefix, keyContext);
const proactiveSuffixResolved = resolveAllKeys(rawProactiveSuffix, keyContext);
const proactiveMessageResolved = resolveAllKeys(rawProactiveMessage, keyContext);

// Assemble the final instruction: Prefix + Message + Suffix
const proactiveInstructionParts: string[] = [];
if (proactivePrefixResolved) proactiveInstructionParts.push(proactivePrefixResolved);
if (proactiveMessageResolved) proactiveInstructionParts.push(proactiveMessageResolved);
if (proactiveSuffixResolved) proactiveInstructionParts.push(proactiveSuffixResolved);
const proactiveInstruction = proactiveInstructionParts.join('\n\n');

// Build the final system prompt
let finalSystemPrompt = systemPrompt;
finalSystemPrompt += `\n\n[Proactive Message Instruction]\n${proactiveInstruction}`;
```

**KEY OBSERVATION**: `proactivePrefix`, `proactiveMessage`, AND `proactiveSuffix` are all concatenated into a SINGLE string `proactiveInstruction`, which is then appended to `finalSystemPrompt` as ONE block labeled `[Proactive Message Instruction]`. The suffix is NOT treated as post-history — it's baked into the system prompt.

### B.2 FASE 9 context sections appended to `finalSystemPrompt` (lines 860-1033)

Six optional context blocks built conditionally:
1. **`[Estado Emocional Actual]`** — emotional state + FASE 5 config (lines 872-885).
2. **`[Relación con {user}]`** — top 3 relationships filtered to user (lines 888-909).
3. **`[Misiones Activas]`** — top 3 active quests with progress squares (lines 911-930).
4. **`[Contexto reciente de la conversación]`** — last N messages with truncation (lines 932-954).
5. **`[Temas abandonados que puedes retomar]`** — crude substring-based topic extraction (lines 956-1019).
6. **`[Evita repetir estos temas recientes: …]`** — thematic cooldown (lines 1021-1028).

All joined with `\n\n` and appended to `finalSystemPrompt` (line 1032):
```ts
if (contextInSystemPrompt && proactiveContextSections.length > 0) {
  finalSystemPrompt += '\n\n' + proactiveContextSections.join('\n\n');
}
```

### B.3 Tool prompt section appended (lines 1063-1068, only when prompt-based fallback)

Same as stream route.

### B.4 Nudge message construction (lines 1089-1167)

A nudge template is selected from `proactiveConfig.nudgeTemplate` + `proactiveConfig.nudgeTemplates[]` (rotation with `clientUsedNudgeIndices`), default `"[La escena continúa] {{user}} parece distraído así que {{char}} decide hacer o decir algo para que todo continúe."`. Resolved with `resolveAllKeys(rawNudgeMessage, keyContext)`. Optionally appends `contextSnippet` and `cooldownInstruction` IF `contextInSystemPrompt === false` (i.e. they duplicate what was put in the system prompt when the flag is false).

### B.5 Prompt viewer sections extended (lines 1170-1194)

Three extra sections appended **to the END** of `allPromptSections` (AFTER the postHistorySection):
```ts
allPromptSections.push(
  { type: 'instructions', label: '✨ Proactive Message Instruction', content: proactiveInstruction, color: 'amber-100...' },
);
if (proactiveContextSections.length > 0) {
  allPromptSections.push({ type: 'system', label: '🧠 Contexto para Proactividad (FASE 9)', content: proactiveContextSections.join('\n\n'), color: 'teal-100...' });
}
allPromptSections.push(
  { type: 'user', label: '✨ Nudge (Proactive User Message)', content: nudgeContent, color: 'amber-50...' },
);
```

> **Note**: This prompt-viewer ordering is inconsistent with the actual prompt sent to the LLM. The viewer shows: `…systemSections → summary → memory → embeddings → chatHistory → postHistory → proactiveInstruction → FASE 9 context → nudge`. The actual system message (built by `buildChatMessages`) puts `proactiveInstruction + FASE 9 context` BEFORE the post-history (because they were appended to `finalSystemPrompt`, and `buildChatMessages` appends post-history AFTER the system prompt). So the viewer lies about the order.

### B.6 `allMessages` construction (lines 1196-1215)

```ts
let allMessages: ChatMessage[] = summaryMessage
  ? [summaryMessage, ...finalContextWindow.messages]
  : [...finalContextWindow.messages];

// Add nudge as the last user message
allMessages = [...allMessages, {
  id: 'nudge-' + Date.now(),
  role: 'user' as const,
  characterId: effectiveCharacter.id,
  content: nudgeContent,
  isDeleted: false,
  timestamp: new Date().toISOString(),
  swipeId: 'nudge',
  swipeIndex: 0,
  swipes: [nudgeContent],
}];
```

**KEY OBSERVATION**: The nudge is appended as an ADDITIONAL final user message AFTER `finalContextWindow.messages`. There is NO dedup check (unlike stream/route.ts lines 783-785). If the last context-window message is also a user message (rare in idle scenarios), `buildChatMessages` will merge them via its same-role merge logic (prompt-builder.ts lines 996-1002).

### B.7 The `buildChatMessages(...)` call sites (proactive/route.ts — same pattern at lines 1315-1324, 1447-1456, 1568-1577, 1683-1692, 1803-1812, 1917-1926)

```ts
// proactive/route.ts lines 1315-1324 (z-ai case)
let chatMessages = buildChatMessages(
  baseSystemPrompt || finalSystemPrompt,             // 1. systemPrompt (= systemPrompt + [Proactive Message Instruction] + FASE 9 context)
  allMessages,                                       // 2. messages (= contextWindow + nudge as final user msg)
  effectiveCharacter,                                // 3. character
  effectiveUserName,                                 // 4. userName
  effectiveCharacter.postHistoryInstructions?.trim(), // 5. postHistoryInstructions (RAW — NOT merged with proactiveSuffix!)
  undefined, true, embeddingsContext,
  lorebookChatInjections,
  exampleMessages                                    // always []
);
```

**Same call pattern for `buildCompletionPrompt(...)` at lines 1786-1795, 1985-1994, 2001-2010.**

### B.8 Summary table — Proactive chat sections in actual send order

| # | Section | Where it lives | Source |
|---|---------|----------------|--------|
| 1-12 | (same as normal chat) | finalSystemPrompt → system msg | character card + lorebook + FASE 5 emotion |
| 13 | `[Proactive Message Instruction]` block | finalSystemPrompt → system msg | `proactivePrefix + proactiveMessage + proactiveSuffix` joined `\n\n` (the SUFFIX is here, NOT in post-history!) |
| 14 | FASE 9 context (emotional/relationship/quest/recent/abandoned/cooldown) | finalSystemPrompt → system msg | inline-built in route.ts |
| 15 | Tool prompt-based instructions | finalSystemPrompt → system msg (if prompt-based fallback) | `buildPromptBasedToolsSection(...)` |
| 16 | Embeddings context | system msg (after systemPrompt) | `embeddingsResult.*` |
| 17 | Author's Note | system msg (after embeddings) | NOT passed — always empty |
| 18 | **Post-History Instructions** | system msg (after authorNote) | `character.postHistoryInstructions` (RAW) — NOT merged with `proactiveSuffix` |
| 19 | HUD Context | injected per position | `hudContext.content` |
| 20 | Lorebook chat injections pos 1-4 | injected into specific messages | `lorebookChatInjections` |
| 21 | Chat History | user/assistant messages | `finalContextWindow.messages` |
| 22 | **Nudge message** | FINAL user message (appended) | `nudgeContent` (rotated nudge template, resolved with keys) |

---

## Part C — Differences between normal and proactive prompt construction

### C.1 `buildSystemPrompt(...)` usage — **IDENTICAL** ✓
Both routes call `buildSystemPrompt(...)` with the exact same 14 arguments in the exact same order. Same character card sections (description, personality, scenario, character note, example dialogue, emotional state, etc.) are included. Same key resolution applies.

### C.2 Lorebook sections — **IDENTICAL** ✓
Both routes call `buildLorebookSectionForPrompt(messages, lorebooks, options, attributeContext)` with the same parameters (only minor: proactive casts `scanDepth` as `any`). Same constant + scanned + attribute lorebook injection. Same `lorebookAttributeKeys` and `lorebookEntryKeyMap` returned and passed to `buildSystemPrompt` and `buildKeyResolutionContext`.

### C.3 Memory section — **IDENTICAL** ✓
Both routes call `buildMemorySection(characterMemory, effectiveCharacter.name)` (stream: line 641, proactive: line 657). Same `characterMemorySection` included in `allPromptSections`. Same dedup logic vs embeddings (`embeddingsFoundMemory` flag).

### C.4 HUD context — **IDENTICAL** ✓
Both routes call `buildHUDContextSection(hudContext, keyContext)` and `injectHUDContextIntoSections(allPromptSections, hudContextSection, hudContext.position)`. Both call `injectHUDContextIntoMessages(chatMessages, hudContextSection, hudContext.position)` after `buildChatMessages`.

### C.5 Post-history instructions passed to `buildChatMessages` — **DIFFERENT** ✗
- **Normal chat**: `effectiveCharacter.postHistoryInstructions?.trim()` (raw character field).
- **Proactive chat**: `effectiveCharacter.postHistoryInstructions?.trim()` (raw character field — **identical**, BUT this is the bug). The `proactiveSuffix` is NOT flowing into this slot — it's already baked into `finalSystemPrompt` as part of the `[Proactive Message Instruction]` block (lines 850-858). So the proactive route ends up with the character's post-history as the LAST system-parts entry, but the `proactiveSuffix` (which semantically should function as post-history) appears earlier in the system message as part of the proactive instruction block.

### C.6 Nudge message vs user message — **DIFFERENT** ✗
- **Normal chat**: `sanitizedMessage` is the user's actual input, appended with a dedup check (lines 783-794) to avoid duplicating if the user's message is already in the context window.
- **Proactive chat**: `nudgeContent` (selected from `nudgeTemplate` + `nudgeTemplates[]` rotation pool, resolved with keys, optionally extended with `contextSnippet` + `cooldownInstruction`) is appended as the final user message **WITHOUT** a dedup check. The nudge is an ADDITIONAL user message on top of history, NOT a replacement. If the last context-window message is a user message, both will exist; `buildChatMessages` will merge them via the same-role merge logic. The nudge functions as the "trigger" that prompts the character to take initiative.

### C.7 Example dialogue handling — **IDENTICAL** ✓ (effectively)
Both routes receive `exampleMessages = []` from `buildSystemPrompt(...)` (since example dialogue is now inlined as a section in the system prompt, prompt-builder.ts line 701-705). Both pass `exampleMessages` (empty) as the 10th arg to `buildChatMessages`. No difference.

### C.8 Prompt-viewer section ordering — **DIFFERENT** ✗ (cosmetic but misleading)
- **Normal chat** `finalAllPromptSections` order: `systemSections → summary → memory → embeddings → chatHistory → postHistory`. Matches the actual system message order.
- **Proactive chat** `allPromptSections` order: same as normal, THEN APPENDS `proactiveInstruction → FASE 9 context → nudge` AT THE END. This means the viewer shows post-history BEFORE the proactive instruction, while in reality the proactive instruction is appended to `finalSystemPrompt` (i.e. before post-history in the actual system message). The viewer is misleading.

### C.9 FASE 9 context sections (emotional, relationship, quest, recent, abandoned, cooldown) — **NEW IN PROACTIVE** ⚠
These 6 context blocks are UNIQUE to the proactive route (lines 860-1033). The normal chat route does NOT inject them into the system prompt — it only has the FASE 5 emotional state injection inside `buildSystemPrompt` (item A.1.6). The FASE 9 context is proactive-specific and intended to make the character "feel alive" when generating a proactive message.

### C.10 Nudge content extras — **NEW IN PROACTIVE** ⚠
The nudge can be extended with `contextSnippet` (recent messages) and `cooldownInstruction` (recent topics to avoid) when `contextInSystemPrompt === false`. The normal chat route has no equivalent — the user's message is just the user's message.

### C.11 Proactive LLM config — **NEW IN PROACTIVE** ⚠
The proactive route builds `proactiveLLMConfig` (lines 1081-1087) which is `{ ...llmConfig, parameters: { ...llmConfig.parameters, temperature: llmConfig.parameters?.temperature ?? 0.9 } }`. The normal chat route uses `llmConfig` directly. This defaults temperature to 0.9 in proactive (slightly more creative) when not configured.

---

## Part D — Refactor recommendation

The user's goal: make `proactivePrefix` function as a SYSTEM PROMPT addition (added to system prompt, BEFORE the proactive instruction), `proactiveSuffix` function as POST-HISTORY instructions (passed to `buildChatMessages` as the post-history arg, same slot as `character.postHistoryInstructions`), and have the proactive route mirror the normal chat structure as closely as possible.

### D.1 Lines to change in `/home/z/my-project/src/app/api/chat/proactive/route.ts`

**CHANGE 1 — Assemble proactive instruction WITHOUT the suffix (lines 850-858)**

Current:
```ts
const proactiveInstructionParts: string[] = [];
if (proactivePrefixResolved) proactiveInstructionParts.push(proactivePrefixResolved);
if (proactiveMessageResolved) proactiveInstructionParts.push(proactiveMessageResolved);
if (proactiveSuffixResolved) proactiveInstructionParts.push(proactiveSuffixResolved);
const proactiveInstruction = proactiveInstructionParts.join('\n\n');

let finalSystemPrompt = systemPrompt;
finalSystemPrompt += `\n\n[Proactive Message Instruction]\n${proactiveInstruction}`;
```

Refactored:
```ts
// The MESSAGE is the only thing that goes inside [Proactive Message Instruction].
// PREFIX will be prepended to the system prompt BEFORE the instruction block.
// SUFFIX will be passed as post-history instructions (merged with character.postHistoryInstructions).
const proactiveInstruction = proactiveMessageResolved;

let finalSystemPrompt = systemPrompt;
// 1. Proactive prefix → prepend to system prompt (before the proactive instruction block)
if (proactivePrefixResolved) {
  finalSystemPrompt += `\n\n${proactivePrefixResolved}`;
}
// 2. Proactive message → the [Proactive Message Instruction] block
if (proactiveInstruction) {
  finalSystemPrompt += `\n\n[Proactive Message Instruction]\n${proactiveInstruction}`;
}
```

**CHANGE 2 — Build a merged post-history instructions variable (new block, near lines 1274-1278)**

After the existing `postHistoryInstructions` resolve inside the `start()` callback (line 1274-1277), or before it, add a module-level constant computed once:

```ts
// Place this just before the `const stream = new ReadableStream({...})` at line 1217,
// after proactiveSuffixResolved is computed (line 846).
const rawCharacterPostHistory = effectiveCharacter.postHistoryInstructions?.trim() ?? '';
const resolvedCharacterPostHistory = rawCharacterPostHistory
  ? resolveAllKeys(rawCharacterPostHistory, keyContext)
  : '';
// Merge character's post-history + proactiveSuffix (suffix appended AFTER character's instructions).
const mergedPostHistoryInstructions = [
  resolvedCharacterPostHistory,
  proactiveSuffixResolved,
].filter(Boolean).join('\n\n') || undefined;
```

**CHANGE 3 — Update all 6 `buildChatMessages(...)` call sites (lines 1320, 1452, 1573, 1688, 1808, 1922)**

Replace `effectiveCharacter.postHistoryInstructions?.trim()` with `mergedPostHistoryInstructions`.

Example for z-ai case (lines 1315-1324):
```ts
let chatMessages = buildChatMessages(
  baseSystemPrompt || finalSystemPrompt,
  allMessages,
  effectiveCharacter,
  effectiveUserName,
  mergedPostHistoryInstructions,                       // ← CHANGED from effectiveCharacter.postHistoryInstructions?.trim()
  undefined, true, embeddingsContext,
  lorebookChatInjections,
  exampleMessages
);
```

**CHANGE 4 — Update all 3 `buildCompletionPrompt(...)` call sites (lines 1786-1795, 1985-1994, 2001-2010)**

Replace `postHistoryInstructions: effectiveCharacter.postHistoryInstructions?.trim()` with `postHistoryInstructions: mergedPostHistoryInstructions`.

Example for ollama default case (lines 1786-1795):
```ts
const prompt = buildCompletionPrompt({
  systemPrompt: baseSystemPrompt || finalSystemPrompt,
  messages: allMessages,
  character: effectiveCharacter,
  userName: effectiveUserName,
  postHistoryInstructions: mergedPostHistoryInstructions, // ← CHANGED
  embeddingsContext: embeddingsContext,
  exampleMessages: exampleMessages,
  allCharacters: allCharacters
});
```

**CHANGE 5 — Update the prompt-viewer `postHistorySection` (line 620-624)**

Current:
```ts
const postHistorySection = buildPostHistorySection(
  effectiveCharacter.postHistoryInstructions,
  keyContext
);
```

Refactored (so the viewer matches what's actually sent):
```ts
// Build the merged post-history section for the prompt viewer (character + proactiveSuffix)
const postHistorySection = mergedPostHistoryInstructions
  ? {
      type: 'post_history' as const,
      label: 'Post-History Instructions (Character + Proactive Suffix)',
      content: mergedPostHistoryInstructions,
      color: SECTION_COLORS.post_history, // need to import SECTION_COLORS or hardcode the same string
    }
  : null;
```

*(Note: `SECTION_COLORS` is exported from prompt-builder.ts but NOT re-exported via `@/lib/llm` index. Either add it to the import list at the top of proactive/route.ts, or hardcode the same string `'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'` that `buildPostHistorySection` uses internally.)*

**CHANGE 6 — Update prompt-viewer proactive sections (lines 1170-1194)**

Restructure to mirror the actual order in the system message. Replace the three-block append with:

```ts
// Add proactive prefix as a separate visible section (placed near system sections,
// before the proactive instruction).
if (proactivePrefixResolved) {
  allPromptSections.push({
    type: 'instructions',
    label: '✨ Proactive Prefix (System)',
    content: proactivePrefixResolved,
    color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  });
}
// The proactive message (the [Proactive Message Instruction] block)
if (proactiveInstruction) {
  allPromptSections.push({
    type: 'instructions',
    label: '✨ Proactive Message Instruction',
    content: proactiveInstruction,
    color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  });
}
// FASE 9 context (already in finalSystemPrompt)
if (proactiveContextSections.length > 0) {
  allPromptSections.push({
    type: 'system',
    label: '🧠 Contexto para Proactividad (FASE 9)',
    content: proactiveContextSections.join('\n\n'),
    color: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  });
}
// The nudge (final user message) — KEEP at the end
allPromptSections.push({
  type: 'user',
  label: '✨ Nudge (Proactive User Message)',
  content: nudgeContent,
  color: 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-200',
});
```

> Ideally these proactive-specific sections should be INSERTED in their actual position (after `postPersonaSections`, before `summarySection`/`memory`/`chatHistory`/`postHistorySection`) — but the simplest refactor keeps them appended at the end, with the post-history section now reflecting the merged content. A cleaner solution is to rebuild `allPromptSections` from scratch in the new order, mirroring the normal chat structure but inserting proactivePrefix + proactiveInstruction + FASE 9 context between `postPersonaSections` and `summarySection`.

**CHANGE 7 — Nudge message: KEEP as final user message + add dedup check (lines 1196-1215)**

Keep the nudge as the final user message — that's what makes the character "take initiative". Add the same dedup check used in stream/route.ts to avoid duplicate user messages:

```ts
let allMessages: ChatMessage[] = summaryMessage
  ? [summaryMessage, ...finalContextWindow.messages]
  : [...finalContextWindow.messages];

// Add nudge as the last user message (with dedup safety check)
const lastCtxMessage = finalContextWindow.messages[finalContextWindow.messages.length - 1];
const isLastMessageUserNudge = lastCtxMessage?.role === 'user' &&
  lastCtxMessage?.content === nudgeContent;
if (!isLastMessageUserNudge) {
  allMessages = [...allMessages, {
    id: 'nudge-' + Date.now(),
    role: 'user' as const,
    characterId: effectiveCharacter.id,
    content: nudgeContent,
    isDeleted: false,
    timestamp: new Date().toISOString(),
    swipeId: 'nudge',
    swipeIndex: 0,
    swipes: [nudgeContent],
  }];
}
```

**CHANGE 8 — Memory / HUD / example_dialogue / lorebook: NO CHANGES NEEDED** ✓

These already work identically to the normal chat route (see Part C.1-C.4, C.7).

**CHANGE 9 — (Optional, recommended) Prompt-based tool instructions appended to `finalSystemPrompt` (lines 1063-1068)**

Currently the proactive route appends tool instructions to `finalSystemPrompt` BEFORE the proactive prefix/instruction would be added under the refactor. The order should be:
1. systemPrompt (character card)
2. proactivePrefix (NEW under refactor)
3. [Proactive Message Instruction] (proactive message)
4. FASE 9 context
5. Prompt-based tool instructions (if applicable)

Under the refactor (Change 1), proactivePrefix and proactiveInstruction are added at lines ~856-862. FASE 9 context is added at lines 1031-1033. Prompt-based tool section is added at lines 1063-1068. So the order is already correct — NO change needed for the tool section.

### D.2 Should `proactiveSuffix` be MERGED with `character.postHistoryInstructions` or REPLACE it?

**MERGE** (recommended). Rationale:
- The character's `postHistoryInstructions` field is user-configured in the character card and applies to BOTH normal and proactive chats. Replacing it in the proactive route would silently drop the character's configured post-history instructions whenever a proactive message fires, which is unexpected.
- The user explicitly said `proactiveSuffix` should "function as POST-HISTORY instructions (passed to `buildChatMessages` as the post-history arg, same as `character.postHistoryInstructions` in normal chat)". The cleanest interpretation: pass BOTH, with the character's instructions first (so the proactive suffix acts as an additional final instruction appended after the standard post-history).
- This matches the existing convention in the codebase where multiple instruction sources are concatenated with `\n\n` (see how `systemParts` is joined in `buildChatMessages` at prompt-builder.ts line 971).

The merge is implemented in Change 2 above: `[resolvedCharacterPostHistory, proactiveSuffixResolved].filter(Boolean).join('\n\n')`.

### D.3 Should the nudge message still be appended as a final user message?

**YES** (no change). The nudge is the proactive equivalent of the user's input — it's what triggers the character to "take initiative". Without it, the LLM would have no signal that a proactive response is expected. The current code already does this correctly (proactive/route.ts lines 1205-1215).

The only safety improvement is the dedup check from stream/route.ts (Change 7 above), which prevents edge cases where the nudge might already be in the context window (e.g., after a regeneration).

### D.4 Other alignment considerations

- **Author's Note (`character.authorNote`)**: Currently NEITHER route passes an `authorNote` arg to `buildChatMessages` (both pass `undefined`). The `buildAuthorNoteSection` function exists in prompt-builder.ts (lines 775-794) but is NOT called in either route. This is a pre-existing gap, NOT a difference between the two routes. No change needed for the refactor.
- **FASE 9 context sections**: These are proactive-specific and should be KEPT as additions to `finalSystemPrompt` (no change to lines 1031-1033). They are not present in normal chat by design (the user explicitly asked for "make the character feel alive", and these context blocks are part of that).
- **Proactive LLM config**: The temperature default of 0.9 in `proactiveLLMConfig` is fine — it gives proactive messages slightly more creative latitude than normal chat. No change needed.

---

## Part E — Suggestions to make the character feel alive & controllable

The user wants the character to feel truly alive and controllable. Based on the codebase, here are 8 concrete, code-grounded suggestions — each cites the specific file/function that already provides the data.

### E.1 Fire proactive messages on EMOTIONAL STATE CHANGES, not just idle timer

**Current state**: Proactive messages fire only on `intervalSeconds` idle timer (`use-proactive-messages.tsx` lines 838-870) or `user_away`. The character's emotional state is read but only used as a content hint inside the FASE 9 context section (proactive/route.ts lines 872-885).

**Suggestion**: Subscribe to emotional state changes in `use-proactive-messages.tsx`. The `/api/chat/emotion/route.ts` already emits a new emotional state after each turn (see stream/route.ts lines 1853-1871 — the `shouldEvaluateEmotion` flag triggers client-side evaluation). When the new emotional state differs from the previous one AND the new state is "strong" (not 'neutral'), fire a proactive message with `reason: 'emotion_change'`. The proactive route already injects the emotional state into the system prompt (FASE 9, lines 872-885), so the data flow is already wired up — only the trigger condition needs to change.

**Code path**: `use-proactive-messages.tsx` `generateProactiveMessage` (line 217) → subscribe to `useTavernStore` `sessionStats.characterStats[id].emotionalState` changes → fire if the new state is "strong" (configurable list like `['enojado', 'triste', 'feliz', 'sorprendido']`).

### E.2 Scale proactive FREQUENCY by relationship sentiment

**Current state**: `intervalSeconds` is a fixed value (`ProactiveMessagesConfig.intervalSeconds`, types/index.ts:1364). Relationship data (`RelationshipMemory` at types/index.ts:2835) is read by the proactive route (lines 888-909) but only as content context.

**Suggestion**: Add a config field `intervalAttributeOrRelationshipScaling?: { source: 'sentiment' | 'attribute'; threshold: number; multiplier: number }` to `ProactiveMessagesConfig`. In `use-proactive-messages.tsx` `generateProactiveMessage` (line 217), read `characterMemory.relationships.find(r => r.targetId === '__user__')?.sentiment`. If sentiment > 50 (positive), multiply `intervalSeconds` by 0.5 (character "wants to talk" more). If sentiment < -50 (very negative), multiply by 2 (character "doesn't want to talk"). This makes the character feel emotionally invested in the relationship.

**Data source**: `characterMemory.relationships` (already in the request body, types/index.ts:2829) + `RelationshipMemory.sentiment` (number, types/index.ts:2836+).

### E.3 Let ATTRIBUTES drive TIMING, not just message content

**Current state**: `selectProactiveCase(...)` (case-selector.ts:158) reads attribute values via `getAttributeValue(sessionStats, characterId, attributeKey)` (case-selector.ts:84) — but only to pick the message content. The timing (`intervalSeconds`) is static.

**Suggestion**: Add an optional `intervalAttributeKey?: string` and `intervalAttributeMap?: { range: [number, number]; intervalSeconds: number }[]` to `ProactiveMessagesConfig`. In `use-proactive-messages.tsx`, before scheduling the timer, read `sessionStats.characterStats[id].attributeValues[intervalAttributeKey]` and pick the matching range. E.g., `energía > 80` → 60s interval (restless character); `energía < 20` → 900s interval (lethargic character). This makes attributes feel consequential.

**Data source**: `sessionStats.characterStats[id].attributeValues` (types/index.ts:4543), already exposed via `useTavernStore.getState().sessions` (used in `use-proactive-messages.tsx` line 244 for emotional state).

### E.4 Surface UNRESOLVED / high-importance memory events as proactive topics

**Current state**: The proactive route already retrieves embeddings (line 511-519) and has `characterMemory.events` in the request body. The "abandoned topics" feature (lines 957-1018) uses crude substring heuristics — it's brittle.

**Suggestion**: Use the existing embeddings retrieval to find a high-importance, recently-unreferenced memory event. The proactive route already calls `retrieveEmbeddingsContext(enrichedSearchQuery, ...)` (line 511). After retrieval, sort `embeddingsResult.memoryDocuments` (or fall back to `characterMemory.events.filter(e => e.importance >= 4 && Date.now() - e.timestamp > 30min)`) and pick the top match. Inject it into FASE 9 context as `[Tema pendiente de conversación]` with the event content. This makes the character "remember" things and bring them up naturally.

**Data source**: `embeddingsResult.memoryContextString` (already in scope, line 689) + `characterMemory.events` filtered by `importance >= 4` and `type === 'fact' | 'event'` (MemoryEvent at types/index.ts:2812).

### E.5 Trigger proactive messages on QUEST STATE CHANGES

**Current state**: Active quests are read and injected as FASE 9 context (proactive/route.ts lines 911-930), but proactive messages never fire BECAUSE a quest changed.

**Suggestion**: In `use-proactive-messages.tsx`, subscribe to `useTavernStore` `sessionQuests` changes (via `useTavernStore(state => state.sessions[activeSessionId]?.sessionQuests)` selector + shallow equality). Fire a proactive message when:
- A new quest becomes `status: 'active'` (the character "wants to talk about the new quest").
- An objective is completed (the character "wants to celebrate or comment").
- A quest is abandoned or failed.

The proactive route already injects active quests into the FASE 9 context section, so the LLM will naturally reference them.

**Data source**: `sessionQuests: SessionQuestInstance[]` (already in the request body, types/index.ts — already used at proactive/route.ts line 911). The store has `useTavernStore.getState().sessions[id].sessionQuests`.

### E.6 Make the nudge CONTENT-AWARE based on the last assistant message's emotional valence

**Current state**: The nudge is selected by rotation (`nudgePool` rotation, lines 1113-1126) — same pool regardless of what was just said.

**Suggestion**: Categorize `nudgeTemplates` by emotional valence: `nudgeTemplatesByValence?: { sad: string[]; happy: string[]; angry: string[]; neutral: string[] }`. Before picking a nudge, analyze the last assistant message (`lastAssistantMsg`, already extracted at proactive/route.ts line 508) and the character's current `emotionalState`. Pick from the matching category. E.g., if the character is `triste`, the nudge might be `"{{char}} está pensando en lo que pasó. Decide expresar lo que siente."` instead of the generic "scene continues". This makes the nudge feel less mechanical.

**Data source**: `lastAssistantMsg` (line 508) + `character.emotionalConfig.states` (types/index.ts:845) + `sessionStats.characterStats[id].emotionalState` (already used at line 874).

### E.7 Tie proactive triggers to INVENTORY / EQUIPMENT changes

**Current state**: `inventoryData` (InventoryPromptData) is already passed to the proactive route (line 394) and `{{slots}}` + `{{inventory}}` keys resolve via `buildKeyResolutionContext` (line 576-591). But proactive messages never fire BECAUSE the user equipped/used an item.

**Suggestion**: In `use-proactive-messages.tsx`, subscribe to `inventoryData.activeEffects` and `inventoryData.sessionEquipment` changes. Fire a proactive message when:
- A new consumable effect becomes active (the character "reacts" to the effect — e.g., drank a potion → "Siento algo extraño… ¿me diste algo?").
- A new item was equipped (the character "notices" the new gear — e.g., "Veo que llevas esa nueva espada… ¿de dónde la sacaste?").

The proactive route already has `{{slots}}` available in `proactivePrefix` / `proactiveMessage` / `nudgeTemplate`, so the user can configure message templates that reference the inventory state directly.

**Data source**: `inventoryData.activeEffects` and `inventoryData.sessionEquipment` (InventoryPromptData, prompt-builder.ts:463) — already in the request body.

### E.8 Make proactive messages "stick" via memory extraction + reinforcement

**Current state**: The proactive route already emits `shouldExtract` in the `done` SSE event (line 2129) so the client can trigger memory extraction. It also runs memory reinforcement (lines 2072-2103) using `embeddingsResult.searchedNamespaces`.

**Suggestion**: Two extensions:
1. **Force memory extraction after EVERY proactive message** (not just on the turn-count cadence). Currently `shouldExtract = turnCount % extractionFrequency === 0` — for proactive messages where there's no new user turn, `turnCount` doesn't change, so extraction rarely fires. Override: `shouldExtract = shouldExtract || isProactive` in the proactive route.
2. **Extract a `type: 'event'` memory** specifically for the proactive message itself, with metadata `{ proactive: true, conditionId, caseIndex }`. This way the character "remembers" what it said proactively and can reference it later. The `MemoryEvent.type` already supports `'event'` (types/index.ts:2814).

**Data source**: `MemoryEvent` (types/index.ts:2812) + `ProactiveMessageInfo` (types/index.ts:1449) + the existing `/api/embeddings/extract-memory` route.

---

## Stage Summary

**Status:** COMPLETE — research only, no files modified.

**Key findings:**

1. **Normal and proactive routes are 95% identical** in prompt construction through line ~624 of the proactive route. Same `buildSystemPrompt`, same `buildKeyResolutionContext`, same `buildLorebookSectionForPrompt`, same `buildMemorySection`, same `buildHUDContextSection`, same `buildChatHistorySections`, same `buildPostHistorySection`, same `allPromptSections` assembly, same context-window re-evaluation, same HUD injection. This makes the refactor low-risk: only the proactive-specific sections need to be restructured.

2. **The core bug (Part C.5)**: `proactiveSuffix` is currently appended to `finalSystemPrompt` as part of the `[Proactive Message Instruction]` block (proactive/route.ts lines 850-858), NOT passed to `buildChatMessages` as the post-history arg. The `buildChatMessages` call sites all pass `effectiveCharacter.postHistoryInstructions?.trim()` (raw character field) — the `proactiveSuffix` is effectively invisible to the post-history slot. The refactor (Part D, Changes 1-4) decouples the prefix/message/suffix trio: prefix → system prompt (before instruction block), message → instruction block, suffix → merged post-history.

3. **The proactive prefix is also misplaced**: it's INSIDE the `[Proactive Message Instruction]` block, not PREPENDED to the system prompt before the instruction. The refactor (Change 1) splits them.

4. **Nudge handling is correct but lacks a dedup safety check** (Part C.6): the nudge is appended as a final user message without checking if it's already in the context window. The refactor (Change 7) adds the same dedup check used in stream/route.ts lines 783-785.

5. **The prompt-viewer section ordering is misleading** (Part C.8): the proactive instruction + FASE 9 context + nudge are appended AT THE END of `allPromptSections`, AFTER the post-history section — but in the actual prompt sent to the LLM, the proactive instruction and FASE 9 context are inside `finalSystemPrompt` (BEFORE post-history). The refactor (Change 5 + Change 6) aligns the viewer with reality by either rebuilding `postHistorySection` from the merged content and/or inserting the proactive sections in their actual position.

6. **8 concrete "feel alive" suggestions** (Part E) all cite existing data sources already in scope (emotional state, relationships, attributes, memory events, quests, inventory, embeddings) — most require only changes to `use-proactive-messages.tsx` (trigger conditions) and the proactive route (context injection), NOT new data plumbing.

**Refactor scope**: 9 changes in `/home/z/my-project/src/app/api/chat/proactive/route.ts`, all confined to the prompt-construction section (lines 831-1215) and the 9 `buildChatMessages` / `buildCompletionPrompt` call sites (lines 1315-2010). No changes needed in `prompt-builder.ts`, `stream/route.ts`, types, or the case-selector. Backward-compatible: if `proactivePrefix` and `proactiveSuffix` are empty (defaults), the refactored route produces a byte-identical prompt to the current implementation.


---
Task ID: FASE11-REFACTOR
Agent: main (Z.ai Code)
Task: Refactor del prompt proactivo para que estructure IGUAL que un chat normal — prefix=system prompt, suffix=post-history instructions (mergeado con character.postHistoryInstructions), message=instrucción proactiva.

Work Log:
- EXPLORE-2: comparé stream/route.ts (chat normal) vs proactive/route.ts. Encontré que prefix+message+suffix se concatenaban en UN string y se appendeaban al system prompt, por lo que el suffix NO funcionaba como post-history.
- Refactor proactive/route.ts (líneas 842-889):
  * proactivePrefix → se PRE-pend al finalSystemPrompt (antes del bloque [Proactive Message Instruction])
  * proactiveMessage → va dentro del bloque [Proactive Message Instruction]
  * proactiveSuffix → se EXTRAE del system prompt y se mergea con character.postHistoryInstructions en `mergedPostHistoryInstructions`
- 9 call sites actualizados (6 buildChatMessages + 3 buildCompletionPrompt): ahora pasan `mergedPostHistoryInstructions` en lugar del raw `effectiveCharacter.postHistoryInstructions?.trim()`.
- Prompt-viewer actualizado: nuevas secciones "✨ Prefijo Proactivo (System Prompt)" (violeta), "✨ Sufijo Proactivo (Post-History)" (naranja) para reflejar la estructura real.
- postHistorySection (línea 631) refactorizado para claridad.

Verificación end-to-end (POST /api/chat/proactive con prefix+suffix+atributo codicia=80):
- case_selected: conditionId=c1, caseIndex=0 ✓
- prompt_data muestra la estructura correcta:
  1. System Prompt (card)
  2. Character Description / Personality / Scenario
  3. Post-History Instructions ([CHAR POST-HISTORY] del personaje)
  4. ✨ Prefijo Proactivo (System Prompt) — [PREFIX-SYSTEM] Tu codicia actual es Codicia: (80/100)
  5. ✨ Proactive Message Instruction — [MENSAJE-CASO] Quiero más oro, Hero.
  6. ✨ Sufijo Proactivo (Post-History) — [SUFFIX-POSTHISTORY] Sé breve...
  7. ✨ Nudge (Proactive User Message)
- {{codicia}} resuelto a "Codicia: (80/100)" en el prefix ✓
- {{user}} resuelto a "Hero" en el message ✓
- ESLint: LIMPIO

Stage Summary:
- El prompt proactivo ahora estructura IGUAL que un chat normal: mismas secciones de la card (description, personality, scenario, etc.), mismo lorebook (constant+scanned+attribute), misma memory, mismo HUD, mismo post-history handling.
- La ÚNICA diferencia vs chat normal: el "mensaje del usuario" es un nudge proactivo (seleccionado por atributo/caso) en lugar de input real del usuario.
- Backward compatible: si proactivePrefix/proactiveSuffix están vacíos, el prompt es idéntico al anterior.
- El suffix funciona como post-history (mergeado con character.postHistoryInstructions), exactamente como pidió el usuario.

---
Task ID: FASE11-V2
Agent: main (Z.ai Code)
Task: Refactor FASE 11 v2 — el prompt proactivo ahora es IDÉNTICO al chat normal. Renombrar prefix/suffix a systemPromptOverride/postHistoryOverride (semántica REPLACE). Eliminar customPrompt, nudgeTemplate, nudgeTemplates, y todos los campos FASE 9 (context sections). El caso seleccionado por atributo se envía como user message. proactiveAttribute es REQUERIDO.

Work Log:
- Tipos (src/types/index.ts): eliminados customPrompt, nudgeTemplate, nudgeTemplates, contextMessagesCount, thematicCooldownMinutes, includeEmotionalContext, includeRelationshipContext, includeQuestContext, contextMessageMaxChars, contextInSystemPrompt, retomarAbandonedTopics, abandonedTopicThreshold, proactivePrefix, proactiveSuffix. Renombrados a systemPromptOverride, postHistoryOverride. DEFAULT actualizado.
- API route (src/app/api/chat/proactive/route.ts):
  * buildSystemPrompt ahora recibe characterForPrompt (clone con systemPromptOverride si se configuró).
  * Eliminado: defaultInstruction, groupChatInstructions, FASE 11 v1 assembly, FASE 9 context sections (emotional, relationship, quest, recent, abandoned, cooldown), nudge pool, nudge selection, context snippet, cooldown instruction.
  * Si proactiveAttribute deshabilitado → skip (proactive_skipped, reason: proactive_attribute_disabled).
  * Si habilitado pero sin caso → skip (proactive_skipped, reason: no_matching_case).
  * El caso seleccionado se resuelve con resolveAllKeys y se envía como user message (role:'user').
  * effectivePostHistory = postHistoryOverride (si set) o character.postHistoryInstructions.
  * Todos los buildChatMessages/buildCompletionPrompt usan effectivePostHistory.
  * SSE proactive_start ya no envía nudgeIndex; siempre envía conditionId + caseIndex.
  * case_selected siempre se emite (no necesita guard if).
- Hook (src/hooks/use-proactive-messages.tsx): eliminados usedNudgeIndicesRef, recentTopicsRef, addNudgeTemplate/removeNudgeTemplate. Eliminado nudgeIndex tracking y recentTopics tracking del handler SSE. ProactiveMessageInfo ya no setea nudgeIndex.
- UI Panel (src/components/tavern/proactive-messages-panel.tsx): eliminadas cards "Instrucción Personalizada", "Mensaje de Impulso (Nudge) Principal", "Variación de Nudges", "Contexto de Conversación", "Enfriamiento Temático", "FASE 9: Contexto para Proactividad". Renombradas a "Prompt del Sistema" y "Instrucciones Post-Historia" con semántica REPLACE. Actualizado "Cómo funciona" (4 pasos). Status Summary actualizado. Hints de casos actualizados para reflejar que el contenido es el user message.
- Eliminados NUDGE_SUGGESTIONS, newTemplateValue state, addNudgeTemplate/removeNudgeTemplate functions.

Verificación end-to-end (3 escenarios):
1. proactiveAttribute DISABLED → proactive_skipped (reason: proactive_attribute_disabled) ✓
2. proactiveAttribute ENABLED + condition matches + overrides:
   - case_selected (c1, caso 0) + proactive_start ✓
   - System Prompt = [OVERRIDE-SYSTEM] ... (REEMPLAZÓ el de la card) ✓
   - Character Description/Personality/Scenario se mantienen de la card ✓
   - Post-History = [OVERRIDE-POSTHISTORY] ... (REEMPLAZÓ el de la card) ✓
   - User Message = caso seleccionado con {{char}}→Aria, {{user}}→Hero resueltos ✓
   - Tokens stream ✓
3. condition no match + no defaultCases → proactive_skipped (reason: no_matching_case) ✓
- ESLint: LIMPIO

Stage Summary:
- El prompt proactivo ahora es IDÉNTICO al chat normal: mismas secciones de card, mismo lorebook, misma memoria, mismo HUD, mismo context window, mismo post-history handling.
- La ÚNICA diferencia: el "user message" es el caso seleccionado por atributo (no input del usuario).
- systemPromptOverride y postHistoryOverride usan semántica REPLACE (vacío = hereda de la card).
- proactiveAttribute es REQUERIDO para que funcione el proactivo (Decisión 1, opción a).
- ProactiveMessagesConfig pasó de ~20 campos a 8 (enabled, intervalSeconds, minMessagesBeforeStart, maxPerSession, allowedStates, groupChatEnabled, groupChatStrategy, systemPromptOverride, postHistoryOverride, proactiveAttribute).
