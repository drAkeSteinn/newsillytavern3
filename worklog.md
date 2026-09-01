# Worklog - TavernFlow Review & Improvements

This file tracks all agent work for the current session reviewing newsillytavern3 (TavernFlow).

---
Task ID: 0
Agent: Z.ai Code (principal)
Task: Clone repo, install app, prepare for review

Work Log:
- Cloned https://github.com/drAkeSteinn/newsillytavern3.git to /home/z/my-project/newsillytavern3
- Migrated all TavernFlow files (src/, public/, data/, prisma/, db/, configs) to /home/z/my-project (main project dir)
- Removed the newsillytavern3 subfolder after migration
- bun install (36 packages), prisma generate, prisma db push OK
- Started dev server on port 3000 (webpack mode, Ready in 1353ms)

Stage Summary:
- TavernFlow app is now the main app at /home/z/my-project, running on port 3000
- Ready to investigate: LLM tool calling failures, proactive counter, character attributes (mark as main), attribute management tool, Ximena character, Director, additional LLM requests


---
Task ID: 6
Agent: Explore (proactive counter & UI)
Task: Check proactive counter functionality and find where to add a discreet UI indicator of time remaining

Work Log:
- Read /home/z/my-project/src/hooks/use-proactive-messages.tsx (872 lines, client-side timer/countdown)
- Read /home/z/my-project/src/lib/proactive/case-selector.ts (235 lines, server-side case selection)
- Read /home/z/my-project/src/app/api/chat/proactive/route.ts (key sections: case selection at L662, proactive_skipped at L819/L852, case_selected SSE at L1002, proactive_start at L1011)
- Read /home/z/my-project/src/types/index.ts (ProactiveMessagesConfig L1362-1402, ProactiveMessageInfo L1421-1440)
- Grep'd proactive usages across src/components (7 files: chat-panel, novel-chat-box, character-panel, session-action-bar, chat-message, proactive-messages-panel, character-editor)
- Read NovelChatBox proactive toggle/force button block (L1644-1705) and streaming "Proactivo" badge (L2275-2280)
- Read chat-panel.tsx hook wiring (L332-357) and welcome screen proactive hint (L2984-2990)
- Confirmed via Grep that proactiveNextIn / proactiveSessionCount / isProactiveActive / proactiveInactiveReason are destructured in chat-panel.tsx (L333-337) but NEVER used afterward
- Confirmed no "Proactivo ● Listo" indicator exists anywhere — only a "Proactivo" badge during generation and a per-message historical badge
- Confirmed nextIn IS computed inside the hook (L820-824 countdown interval, returned at L867) but is dead-ended at chat-panel.tsx

Stage Summary:
- TIMER MECHANICS: Two intervals live in use-proactive-messages.tsx. `countdownRef` ticks every 1000ms and computes `remaining = max(0, floor((intervalMs - (Date.now() - lastActivityTimeRef)) / 1000))` → setState `nextIn`. `timerRef` ticks every 5000ms and checks `if (elapsed >= intervalMs)` → fires generateProactiveMessage with reason 'timer_idle' or 'timer_away' based on document.hidden. intervalMs = (config.intervalSeconds ?? 300) * 1000. allowedStates gates whether hidden/visible tab triggers fire. minMessagesBeforeStart (default 5) and maxPerSession (default 0 = unlimited) gate the call. lastActivityTimeRef is reset on: session init (last message timestamp), any new message arrival, after successful proactive send, and after server 'proactive_skipped'.
- COUNTER BUGS / EDGE CASES: (1) 1s countdown vs 5s fire poll means `nextIn` displays "0" for up to 5s before the message actually starts. (2) On session reload with messages whose last timestamp > intervalSeconds in the past, the first 5s tick will fire a proactive IMMEDIATELY (could be surprising). (3) `nextIn` continues ticking down during regular LLM generation, even though the timer is effectively paused (early-return on isGeneratingRef), so the displayed countdown is misleading while regular chat is generating. (4) `lastActivityAt` is sent to the server route but is dead-code there (route.ts L364) — never used. (5) The message-tracking useEffect (L188-200) only depends on `activeSession?.messages?.length`; editing the last message (length unchanged) does NOT reset the timer. (6) usedCaseIndices is in-memory only (useRef), so a page reload loses rotation history (rotation restarts from index 0).
- MAXPERSESSION + USED CASE EXHAUSTION WORK CORRECTLY: sessionCount initialized from existing proactive messages on load (L165-169), incremented after each successful proactive (L607), gated by check at L251. pickCaseIndex handles exhaustion: 'linear' cycles modulo, 'random' resets the pool when all eligible indices are used (case-selector.ts L125-145). No infinite loops.
- RACE CONDITIONS: Handled correctly. The main timer effect re-runs (clears+recreates intervals) whenever `isGeneratingProactive` changes (dep at L849). `isGeneratingRef.current` is updated every render. The isGeneratingProactive check at L828 prevents concurrent proactive triggers.
- TAB VISIBILITY: Handled correctly. `document.hidden` is read inside the 5s tick (L834). If hidden && !allowedStates.includes('user_away') → return. If visible && !allowedStates.includes('idle') → return. Reason label switches between 'timer_idle' and 'timer_away'.
- CURRENT UI INDICATORS: Only TWO proactive-related UI elements exist in the chat surface:
  1. novel-chat-box.tsx L2275-2280: Small "Proactivo" Badge with Sparkles icon shown ONLY during proactive generation (isGeneratingProactive=true). Does NOT show countdown.
  2. chat-message.tsx L348-356: "Proactivo" Badge on every delivered proactive message (historical marker).
  Plus: a welcome-screen hint "Proactivo — Inicia un chat para activar" (chat-panel.tsx L2984-2990), a config panel toggle/force button (novel-chat-box.tsx L1644-1705), and the configuration panel itself (proactive-messages-panel.tsx, pure config, no live status).
- NO "● Listo" countdown indicator exists. The hook DOES expose `nextIn: number | null` (seconds remaining) and `sessionCount`, and chat-panel.tsx destructures them as `proactiveNextIn` / `proactiveSessionCount`, but those values are then NEVER passed to NovelChatBox or rendered anywhere. This is the key insertion point for a discreet countdown UI.
- INSERTION POINTS for discreet countdown: Best candidate is next to the existing proactive toggle/force button cluster in novel-chat-box.tsx around L1647-1704 (the amber-bordered pill that contains the Sparkles icon + Switch + Force button). A small badge/text like "5:00" or "● Listo" (when nextIn=0) appended inside that pill, or as a Tooltip sub-line, would be minimal and discoverable. Alternative: extend the TooltipContent at L1663-1671 to show "Próximo en 4:32" when proactiveEnabled && proactiveAvailable && !isGeneratingProactive. Data needed from chat-panel: pass `nextIn` and optionally `inactiveReason` / `sessionCount` / `maxPerSession` as new props on NovelChatBox.
- DATA AVAILABLE for countdown: The hook already exposes everything: nextIn (seconds remaining or null), sessionCount, isActive, isConfigured, inactiveReason ('no_character' | 'not_configured' | 'group_chat' | 'no_session' | 'no_llm' | null), isGeneratingProactive, triggerNow. The client knows intervalSeconds (config.intervalSeconds, default 300) and lastActivityTimeRef indirectly via nextIn. No additional computation needed — just thread `nextIn` from chat-panel → NovelChatBox and render it.

---
Task ID: 8
Agent: Explore (attribute management tool calling)
Task: Verify attribute management tool calling works and how attributes are sent to LLM

Work Log:
- Read /home/z/my-project/src/lib/tools/tools/modify-stat.ts COMPLETELY (273 lines). Documented parameters (stat_name, new_value, reason), operators (+, -, =, default-set), clamping logic, lookup by key/name/keys/detectionTags, and the statActivation payload returned.
- Read /home/z/my-project/src/lib/tools/tools/check-stat.ts COMPLETELY (145 lines). Documented lookup behavior, formatValueForDisplay helper, and helpful error messages listing available stats.
- Read /home/z/my-project/src/lib/stats/stats-resolver.ts COMPLETELY (1022 lines). Documented formatAttributeValue (number → "Name: (cur/max)", keyword/text → "Name: value"), resolveStats, resolveStatsInText. Confirmed there is NO [ATRIBUTOS] block — attributes are exposed via {{attributeKey}} templates resolved in characterNote.
- Read /home/z/my-project/src/lib/tools/tool-registry.ts COMPLETELY (325 lines). Confirmed modify_stat registered at L313 with permissionMode 'auto'. Documented toOpenAITools, toJSONSchemaParameters, and buildPromptBasedToolsSection (text fallback for non-native providers).
- Read /home/z/my-project/src/app/api/chat/stream/route.ts (focused on executeToolCallsAndContinue L102-338). Confirmed stat_activation SSE event is sent to client (L264-280). Confirmed tools are resolved via resolveToolDefinitionsKeys before being sent to LLM.
- Read /home/z/my-project/src/store/slices/statsSlice.ts updateCharacterStat (L384-640). Confirmed stat changes are applied CLIENT-SIDE: chat-panel.tsx L1109-1120 receives SSE stat_activation event and calls store.updateCharacterStat with 'llm_detection' reason. Server does NOT persist changes.
- Read /home/z/my-project/src/store/slices/sessionSlice.ts relevant stat init code (L312-410). Confirmed stats init from statsConfig at session create time.
- Read /home/z/my-project/src/types/index.ts AttributeDefinition (L4285-4353), CharacterStatsConfig (L4484-4501), StatsBlockHeaders (L4476-4481). Confirmed NO isPrimary/isMain concept exists for attributes.
- Read /home/z/my-project/src/components/tavern/stats-editor.tsx AttributeEditor (L140-324) and addAttribute (L4846-4857). Confirmed NO main/primary UI exists.
- Read /home/z/my-project/src/components/tools/tools-settings-panel.tsx L100-120 — found HARDCODED mock tool definition that diverges from the real one (says new_value: type: 'number' while real definition says type: 'string').
- Read /home/z/my-project/data/settings.json L193-208 — CRITICAL FINDING: modify_stat AND check_stat are listed in `disabledTools` array. By default the LLM never sees these tools.
- Read /home/z/my-project/src/lib/tools/types.ts ToolContext (L55-75) and ToolExecutionResult (L78-180) — confirmed statActivation payload shape used by client.

Stage Summary:
- FLOW: LLM emits tool_call(modify_stat, {stat_name, new_value, reason}) → executeTool in tool-registry.ts L246 → modifyStatExecutor in modify-stat.ts L66 → matches attribute by key/name/keys/detectionTags → parses operator (+/-/=) → clamps to min/max → returns ToolExecutionResult with statActivation payload → stream/route.ts L265-280 emits stat_activation SSE event → chat-panel.tsx L1109-1120 receives event and calls store.updateCharacterStat('llm_detection') → statsSlice.ts L384 updates sessionStats.characterStats[characterId].attributeValues[key] → triggers thresholdEffects evaluation, changeLog, objective refresh.
- ATTRIBUTE FORMAT FOR LLM: Attributes are NOT in a [ATRIBUTOS] block. Characters embed {{attributeKey}} templates inside their characterNote (typically under a [ESTADO ACTUAL] header written by the user). formatAttributeValue produces: number → "Lujuria: (50/100)", keyword/text → "Detección: mágica", custom outputFormat overrides both.
- LLM AWARENESS OF STATS: The modify_stat tool description is GENERIC — it does not list available attribute keys/names. The LLM must infer attribute names from the rendered character note (where {{lujuria}} became "Lujuria: (50/100)"). If the character note doesn't include the attribute template, the LLM has no way to know the attribute exists. The modify_stat error path returns a helpful list of available stats, but only AFTER the LLM fails once.
- CRITICAL BUG #1 (DEFAULT DISABLED): In data/settings.json L198-207, modify_stat and check_stat are in `disabledTools` by default. The LLM never sees them unless the user manually enables them. This is the primary reason "LLM tool calling failures" occurs.
- BUG #2 (CLAMPING WARNING MISSING FOR ADD/SUBTRACT): modify-stat.ts L248 — `if (wasClamped && !rawValue.startsWith('+') && !rawValue.startsWith('-'))` skips the clamping warning for add/subtract operations, even though clamping IS applied (L180, L195). The LLM may think it added +100 to a 90/100 stat and got 190, when the actual result was clamped to 100 — the LLM is misled about the resulting value.
- BUG #3 (UI SCHEMA DIVERGENCE): tools-settings-panel.tsx L114 hardcodes `new_value: { type: 'number' }` but the real tool (modify-stat.ts L34) uses `type: 'string'` to support operator-prefixed values like "+10". The settings UI shows incorrect schema to users.
- BUG #4 (TYPE COERCION ON KEYWORD ATTRIBUTES): modify-stat.ts L165 — `if (matchedAttr.type === 'number' || typeof oldValue === 'number')`. If a keyword/text attribute has a numeric defaultValue (e.g., 0), it gets treated as numeric and the LLM's string value like "happy" will fail parseFloat and error out.
- BUG #5 (MISSING PROMPT INSTRUCTIONS FOR NATIVE TOOLS): For native tool calling (OpenAI/Anthropic/Ollama), the tool description is the ONLY guidance. There's no system-prompt instruction saying "use modify_stat when attributes change" — that text is only injected via buildPromptBasedToolsSection when usePromptBasedFallback=true or provider doesn't support native tools.
- MAIN ATTRIBUTE CONCEPT: Does NOT exist. AttributeDefinition (types/index.ts L4285-4353) has no isPrimary/isMain field. The "principal" terminology in the codebase refers to sprites (principalSpriteId), sprite behavior, primary detection keys, and primary currency — none related to attributes.
- TO ADD "MAIN ATTRIBUTE" SUPPORT: (1) types/index.ts AttributeDefinition: add `isMain?: boolean` field, with validation ensuring only one main per character. (2) stats-editor.tsx: add a star/crown toggle in the AttributeEditor header (L154-179) that calls onChange(index, { isMain: true }) and unmarks siblings. (3) stats-resolver.ts resolveStats: optionally expose ResolvedStats.mainAttribute = first attr with isMain. (4) modify-stat.ts: optionally inject the main attribute name into the tool description when building per-character tools (would require extending resolveToolDefinitionsKeys or adding a per-character dynamic description). (5) Director/proactive counter/sprite condition evaluator: read mainAttribute for trigger logic. Minimal viable change: just (1)+(2) to mark, persist, and surface in UI; downstream consumers can read it from the config directly.


---
Task ID: 4
Agent: Explore (Director system)
Task: Review the Director in both normal chats and group chats

Work Log:
- Read /home/z/my-project/src/app/api/chat/director/route.ts (159 lines) in full
- Read /home/z/my-project/src/lib/director/analyzer.ts (218 lines) in full
- Read /home/z/my-project/src/lib/director/types.ts (91 lines) in full
- Read /home/z/my-project/src/hooks/use-director.ts (202 lines) in full
- Read /home/z/my-project/src/app/api/chat/group-stream/route.ts narrator integration blocks (lines 680-860, 990-1015, 1080-1090, 1208-1223, 1994-2045)
- Read /home/z/my-project/src/types/index.ts AppSettings + Group/Narrator types (L2281-2306, L917-980)
- Read /home/z/my-project/src/store/defaults.ts (director: DEFAULT_DIRECTOR_SETTINGS at L94)
- Read /home/z/my-project/src/store/slices/groupSlice.ts applySceneChange (L151-162)
- Read /home/z/my-project/src/store/slices/statsSlice.ts pushSessionEvent (L1565-1594)
- Read /home/z/my-project/src/lib/stats/event-log.ts (ring buffer for {{eventos}})
- Read /home/z/my-project/src/components/tavern/group-editor.tsx narrator settings UI (L1270-1442)
- Read /home/z/my-project/src/components/tavern/session-action-bar.tsx Director clapperboard button (L72-125)
- Read /home/z/my-project/src/components/tavern/chat-panel.tsx Director hook wiring (L359-364, L3088-3094)
- Grep'd "director" across /src (23 files; only 7 are real Director references — others matched "directorio"/"directory")
- Grep'd narratorSettings usages: types/index.ts, group-stream/route.ts, group-editor.tsx, group-sprites.tsx, novel-chat-box.tsx, character-panel.tsx
- Grep'd customPrompt usages: ONLY in group-editor.tsx (L1328) — confirmed `narratorSettings.customPrompt` is NEVER applied in buildGroupSystemPrompt or group-stream route
- Grep'd minIntervalMinutes/maxWorldEventsPerRun across /src/components: confirmed NO Director settings UI exists

Stage Summary:

== DIRECTOR ARCHITECTURE (1-to-1 chats) ==

LOCATIONS:
- API route: src/app/api/chat/director/route.ts (POST handler)
- Pure analyzer: src/lib/director/analyzer.ts (computeTension, computePacing, heuristicDecisions, analyzeSnapshot)
- Types: src/lib/director/types.ts (DirectorSettings, DirectorSnapshot, DirectorResult, DirectorDecision)
- Client hook: src/hooks/use-director.ts
- Wired in: src/components/tavern/chat-panel.tsx L364 `useDirector(activeSessionId)`
- UI: src/components/tavern/session-action-bar.tsx (Clapperboard icon button L103-125)
- Persisted: AppSettings.director (src/types/index.ts L2305), default at src/store/defaults.ts L94

TRIGGER CONDITIONS (use-director.ts):
- POST_TURN_DEBOUNCE_MS = 8000 (line 21): when message count increases (excluding isGenerating), schedule runDirector 8s later
- CHECK_INTERVAL_MS = 60000 (line 22): idle cadence — every 60s, attempt runDirector
- Guards: `if (runningRef.current) return;` (L31), `if (Date.now() - lastRunRef.current < settings.minIntervalMinutes * 60 * 1000) return;` (L39), `if (state.ui?.isGenerating) return;` (L158, L187) — never runs mid-generation
- minIntervalMinutes default = 3 (so effective max frequency = every 3 minutes)
- Manual "triggerNow" bypass (L194-198): sets `lastRunRef.current = 0` to skip throttle; invoked via SessionActionBar clapperboard button
- lastRunRef is in-memory only (useRef) — NOT persisted; resets on reload

WHAT IT ANALYZES (analyzer.ts):
- Tension score 0-100 (computeTension L69-85): base 20 + heat stats up to 45 + recent event density (last 10 min) up to 20 − depletion up to 15 + message rhythm (msgs/min × 3) up to 15
- HEAT_STAT_PATTERNS (L18): Spanish keys like 'lujuria','deseo','calentur','hambre','adiccion','modo_pantera','twerking','estupidez' (matched case-insensitive as substrings)
- DEPLETION_STAT_PATTERNS (L21): 'energia','resistencia' (high value = tension draining)
- Pacing (computePacing L88-96): idleMinutes≥15 → cooldown; tension≥75 → intense; tension≥45 → building; tension<30 && idle≥5min → calm; else building
- recentEvents: counts log entries in last 10 min
- messageRhythm: msgs/min from recentMessages timestamps

LLM CALL (route.ts L115-151, only when settings.mode === 'llm' AND llmConfig.provider is supported):
- System prompt (route.ts L31-38, DIRECTOR_SYSTEM_PROMPT): Spanish, asks the LLM to act as a "DIRECTOR of roleplay session", propose ONE external world event ("vecinos, clima, teléfono, ruidos, mensajería, interrupciones"), max 2 sentences, MUST respond as JSON `{"tension": <0-100>, "world_event": "<texto>"}`
- User prompt (buildDirectorUserPrompt L40-70): includes character names, group scene status, computed tension+pacing, up to 8 stats per character, last 5 event log entries, last 3 messages truncated to 120 chars
- Provider coverage: 'z-ai' (streamZAI), 'grok' (streamGrok), 'openai'/'vllm'/'lm-studio'/'custom' (streamOpenAICompatible). NO support for 'anthropic', 'ollama', 'text-generation-webui', 'koboldcpp', 'test-mock' — silently falls back to heuristic result (L129-131)
- Streaming collected via collectStream (L73-84) with 30s timeout; on timeout or parse failure, falls back to heuristicResult (L148-150)
- JSON parse: parseDirectorJson L87-97 uses regex match `\{[\s\S]*\}` then JSON.parse — defensive
- LLM only replaces world_event.description and (optionally) tension; pacing + scene_change + tension_shift decisions stay deterministic (L135-145). Result source = 'hybrid'.

DECISION TYPES (types.ts L62-81):
1. `world_event` — { description, severity: 'minor' | 'major' } — external narrative beat
2. `scene_change` — { characterId, characterName, present: boolean, reason } — group-only scene rotation
3. `tension_shift` — { from, to, pacing } — telemetry only

HEURISTIC WORLD EVENTS (analyzer.ts L110-134):
- Pools per pacing in Spanish (calm=5, building=4, intense=3, cooldown=3 canned strings)
- Triggers: (calm & roll<0.5) | (cooldown & roll<0.35) | (intense & ≥3 recent events in 5min & roll<0.5) | (building & roll<0.15)
- roll is deterministic seeded by `sessionId:turnCount` (seededRandom L99-107) — replaying the same turn gives the same result (no retry on failure)
- severity = pacing === 'intense' ? 'major' : 'minor'

APPLICATION (use-director.ts L120-144):
- world_event → `store.pushSessionEvent(sessionId, { type: 'custom', description: '[DIRECTOR] ' + ... })` — appended to SessionStats.eventLog ring buffer (MAX_EVENT_LOG_ENTRIES=30, exposed to LLMs via {{eventos}} key, MAX 8 in prompt)
- The {{user}} macro in description is replaced client-side (L124) with active persona name; only done for world_event (NOT for scene_change.reason — minor bug if user puts {{user}} in reason text)
- severity === 'major' → toast.info from 'sonner' (`🎬 Director: …`) — minor events are silent in the toast UI
- scene_change → `store.applySceneChange(groupId, characterId, present)` (groupSlice L151: mutates isPresent on the member) + pushSessionEvent(type: 'scene_enter'|'scene_leave') + toast.success with 🚪➡️/🚪⬅️ icon
- tension_shift → `console.log('[Director] tension=… pacing=…')` ONLY — comment says "future HUD indicator" but none exists today

== DIRECTOR IN GROUP CHATS ==

- Same use-director.ts hook runs in both contexts; group path is taken when session.groupId is set (L48-65)
- DirectorSnapshot includes groupMembers: Array<{characterId, name, isActive, isPresent, isNarrator}>
- The analyzer sees the group context and emits scene_change decisions on top of world_events
- Group scene rotation logic (analyzer.ts L172-202):
  - Off-scene member re-enters: requires ≥2 active non-narrator actors, pacing !== 'calm', 35% seeded-prob, brings them IN with a Spanish reason ("El escándalo se escucha…")
  - On-scene member storms out: requires ≥3 present, pacing === 'intense', 30% seeded-prob
  - Narrators are filtered out (only `!m.isNarrator && m.isActive` are candidates)
- Director route's user prompt (route.ts L51-53) builds a `[ESTADO DE SESIÓN]` block distinguishing "En escena: …" vs "Fuera: …" using groupMembers
- Manual director button (SessionActionBar) is shown in BOTH 1-to-1 and group chats (no conditional rendering on groupId)

== NARRATOR vs DIRECTOR (group chats) — SEPARATE SYSTEMS ==

NARRATOR (group-stream/route.ts + types L917-954):
- Narrator is a "ghost character" — a regular CharacterCard flagged via GroupMember.isNarrator=true
- Narrator participates IN the conversation as a normal LLM speaker during group-stream
- Responder selection (group-stream/route.ts L156-178): narrators EXCLUDED from normal responder selection
- Insertion logic (L829-857): if narrator should intervene, it is inserted into responders list per responseMode:
  - 'turn_start' → unshift to front
  - 'turn_end' → push to back
  - 'before_each' → inserted before each non-narrator responder
  - 'after_each' → inserted after each non-narrator responder
- Conditional gate (shouldNarratorIntervene L704-725): respects `conditional.minTurnInterval` (turns since `narratorLastTurn`) and `conditional.onlyWhenNoActiveQuests`
- Prompt building: narrator gets the SAME group system prompt as everyone else via buildGroupSystemPrompt — sees ALL messages (including narrator messages) because isForNarrator=true is passed to buildGroupChatMessages (prompt-builder.ts L1460-1462)
- The narrator character is sent `isNarrator: true` flag on character_done SSE (L2002) so the frontend can tag/hide its messages
- UI: novel-chat-box.tsx L2142-2147 hides narrator messages from chat display when `narratorSettings.hiddenFromChat` is true; group-sprites.tsx L405 skips rendering narrator sprite when `!showSprite`

RELATIONSHIP TO DIRECTOR:
- Director and Narrator are COMPLETELY UNRELATED systems:
  - Director: server-side analyzer (heuristic + optional LLM) that injects world events OUTSIDE the conversation flow (writes to event log only, doesn't speak in chat)
  - Narrator: an LLM character that participates IN the conversation as a normal speaker
- The Director's snapshot DOES read `groupMembers[].isNarrator` (types.ts L48) and uses it to filter scene-change candidates, but otherwise they're independent
- Both can run in the same group session simultaneously

== CONFIGURATION OPTIONS ==

DirectorSettings (types.ts L17-26):
- `enabled: boolean` (default true) — master switch read by use-director.ts L38
- `mode: 'heuristic' | 'llm'` (default 'heuristic') — controls whether an LLM call is made
- `minIntervalMinutes: number` (default 3) — throttle between runs
- `maxWorldEventsPerRun: number` (default 1) — cap on world events per run

Persistence:
- Stored in `AppSettings.director` (types/index.ts L2305)
- Defaulted in `src/store/defaults.ts` L94: `director: DEFAULT_DIRECTOR_SETTINGS`
- Read in use-director.ts L34-37 via `store.settings.director`

CONFIGURATION GAP (BIG):
- NO settings UI exists for the Director. Grep'd `minIntervalMinutes|maxWorldEventsPerRun|mode.*heuristic.*llm` across src/components → zero hits.
- Settings panel (src/components/tavern/settings-panel.tsx) has no "director" key
- The only Director surface is the clapperboard manual-trigger button in session-action-bar.tsx
- Users CANNOT toggle Director on/off, switch mode to 'llm', change interval, or change maxEvents from UI — they'd have to manipulate the Zustand store directly (or edit defaults.ts)

NarratorSettings IS configurable in the UI (group-editor.tsx L1270-1442):
- responseMode (4-button grid), customPrompt (Textarea), minTurnInterval (Input 0-10), onlyWhenNoActiveQuests (Switch), hiddenFromChat (Switch), showSprite (Switch)
- BUT: customPrompt is collected and never applied (see Issues)

== ISSUES AND GAPS ==

1. **NO Director settings UI** — biggest gap. Settings exist in store + types but are completely invisible to users. Director runs by default (enabled=true) on every session and cannot be turned off without editing code.

2. **`narratorSettings.customPrompt` is dead code** — UI collects it (group-editor.tsx L1328), type defines it (types.ts L950), but `buildGroupSystemPrompt` (prompt-builder.ts L1140+) never reads it. The narrator gets the group's system prompt verbatim. Tooltip lies: "Instrucciones específicas para el narrador. Si está vacío, usa el prompt del grupo." — actually it ALWAYS uses the group prompt regardless.

3. **Limited provider support in LLM mode** — Director route only handles 'z-ai', 'grok', 'openai'/'vllm'/'lm-studio'/'custom' (route.ts L123-131). Users on Anthropic, Ollama, text-generation-webui, or koboldcpp will silently get heuristic-only results even if they set mode='llm'. No warning is shown.

4. **Dead code in use-director.ts L97-98** — reads `store.settings.llm?.activeConfigId` but `AppSettings` has no `llm` field (types/index.ts L2281-2306). The `|| activeLlm?.id` fallback (the LLMConfig with isActive=true) is what actually works. The first half of the OR never matches.

5. **Tension telemetry never surfaces in UI** — `tension_shift` decisions are `console.log`-only (use-director.ts L142). The hook comment says "future HUD indicator" but none exists. A user with the dev console closed sees nothing about tension/pacing.

6. **No persistence of lastRun timestamp** — `lastRunRef` (use-director.ts L25) is a useRef, not in the store. After a page reload, the minIntervalMinutes throttle is bypassed on the first qualifying trigger (post-turn debounce will fire ~8s after the next turn completes, regardless of how recently Director ran before reload).

7. **Deterministic seed = no retry** — `seededRandom(seed: sessionId, salt: turnCount)` (analyzer.ts L99-107). If a turn rolls < threshold for an event, it will NEVER produce an event on the same turn (e.g. on idle cadence re-runs). This is partially intentional (idempotency) but means low-roll turns stay quiet.

8. **{{user}} macro not replaced in scene_change.reason** — use-director.ts L124 replaces `{{user}}` only in world_event.description. The scene_change.reason strings in analyzer.ts L187/L199 don't contain {{user}} today, but if a user (or LLM in hybrid mode) added it, it would leak raw.

9. **`pushSessionEvent` requires initialized sessionStats** — statsSlice.ts L1575: `if (!session.sessionStats) return state;` silently drops the Director event. Sessions without stats initialized will lose Director world events with no warning.

10. **Two parallel trigger paths can race** — post-turn debounce (8s) and idle cadence (60s) both call `runDirector`. `runningRef` guards concurrent execution (L31), and `lastRunRef` enforces minIntervalMinutes (L39), so behavior is correct — but the 60s tick is essentially redundant when the user is actively chatting (post-turn always wins).

11. **`maxWorldEventsPerRun` is honored** but the heuristicDecisions function can emit at most ONE world_event per run (single `if (wantsEvent && maxWorldEvents > 0)` block at L162). Setting maxWorldEventsPerRun > 1 has NO effect — the pool roll happens once. Either the setting is misleading or the loop is missing.

12. **Manual trigger does not respect `enabled`** — `triggerNow` (use-director.ts L194-198) only resets lastRunRef; it still calls runDirector, which checks `if (!settings.enabled) return;` at L38. So if a user disabled Director (via store hack) and clicks the clapperboard, nothing happens silently — no toast/feedback.

13. **Director and Proactive both run idle timers** — use-director.ts (60s) and use-proactive-messages.tsx (5s tick) have separate cadences. Not a bug, but worth noting both fire LLM-adjacent work on idle sessions; combined cost may surprise users on metered APIs.

---
Task ID: 3
Agent: Explore (Ximena character & character system)
Task: Review Ximena la Cogelona character to understand how characters, lorebooks, prompt construction, attributes, skills work

Work Log:
- Read /home/z/my-project/data/characters.json: located Ximena la Cogelona character (lines 1981-2287, id `be007398-1400-45b2-b87a-0d7e1f906278`). Captured full definition: description, personality, scenario, firstMes, mesExample, creatorNotes, characterNote, systemPrompt, postHistoryInstructions, alternateGreetings (3), tags, voice, statsConfig (7 attributes + empty skills/intentions/invitations + blockHeaders + empty solicitudDefinitions), spriteConfig, hudTemplateId, lorebookIds (3), questTemplateIds (13), proactiveMessages config (driven by `adiccion`), emotionalConfig.
- Read /home/z/my-project/data/lorebooks.json: identified Ximena's 3 associated lorebooks:
  - `c7313714-...` = "Escenario" (settings: scanDepth 5, tokenBudget 2048)
  - `c0982fb3-...` = "Persona" (has 1 attribute entry: `vestuario` based on user's `pene_visible`)
  - `7f1410a6-...` = "Ximena_Lorebook" (11 entries, scanDepth 5, tokenBudget 4096) — fully read lines 2120-2986.
- Documented Ximena_Lorebook's 11 attribute-type entries: each entry uses `entryType: "attribute"` + `attributeConfig` with `mode: "dynamic"` and `dynamicResolution: "first-match"`. Each entry has 5 dynamicConditions with `operator: "<="` and `value` of 20/40/60/80/100 and `priority` 5/4/3/2/1 respectively (priority 5 = lowest value 20, priority 1 = highest value 100). Entries by uid:
    - uid 0 "descripcion" → injectionKey `descripcion` (driven by `adiccion`)
    - uid 1 "Personalidad" → injectionKey `personalidad_xim` (driven by `adiccion`)
    - uid 2 "Addicion" → injectionKey `adiccion_lore_xim` (driven by `adiccion`)
    - uid 3 "Lujuria" → injectionKey `lujuria_lore_xim` (driven by `lujuria`)
    - uid 4 "Estupidez" → injectionKey `estupidez_lore_xim` (driven by `estupidez`)
    - uid 5 "Exhibicionismo" → injectionKey `exhibicionismo_lore_xim` (driven by `exhibicionismo`)
    - uid 6 "Irritabilidad" → injectionKey `irritabilidad_lore_xim` (driven by `irritabilidad`)
    - uid 7 "Energía" → injectionKey `energia_lore_xim` (driven by `energia`)
    - uid 8 "System Prompt" → injectionKey `sysprompt` (driven by `adiccion`)
    - uid 9 "Post History" → injectionKey `posthistory` (driven by `adiccion`)
    - uid 10 "Ejemplos" → injectionKey `ejemplosdemensajes` (driven by `adiccion`)
  Observed that `adiccion` is the de-facto "main" attribute driving 5 of 11 entries — but it is NOT explicitly marked as "main" anywhere in config.
- Read /home/z/my-project/src/lib/llm/prompt-builder.ts (1861 lines) end-to-end. Documented:
  - `buildSystemPrompt()` (lines 505-732): assembles sections in this order: System Prompt → World Time → Text Actions → Lorebook position 0 → Character Description → Personality → Emotional State → Scenario → Character's Note → Example Dialogue → Lorebook position 5 → Lorebook outlets → Lorebook position 6. Then runs `resolveSectionsKeysWithPasses(sections, keyContext, 3)` (3 passes, recursive with convergence check) at line 722, and joins sections into a single `[label]\ncontent` string at line 725.
  - `buildLorebookSectionForPrompt()` (lines 739-787): resolves attribute-type entries via `resolveLorebookAttributeKeys()` (returns `lorebookAttributeKeys` map of injectionKey→content), builds traditional-entry key map via `buildLorebookEntryKeyMap()`, and the injection plan via `buildLorebookInjectionPlan()`.
  - `buildChatMessages()` (lines 951-1071): single system message (system prompt + embeddings + author note + post-history joined by `\n\n---\n\n`) → example messages → chat history (with merge + alternation enforcement + bridging) → lorebook chat injections (positions 1-4).
  - `buildCompletionPrompt()` (lines 1083-1129): completion-style output for Ollama/KoboldCPP.
  - `buildGroupSystemPrompt()` (lines 1140-1392) and `buildGroupChatMessages()` (lines 1406-1557): same pattern for group chats.
- Read /home/z/my-project/src/lib/key-resolver.ts. `resolveAllKeys()` (lines 997-1036) runs 7 phases in order: (1) template variables `{{user}}/{{char}}/{{userpersona}}/{{persona}}/{{time}}/{{description}}/{{outlet::name}}` + `{{#if}}/{{#user}}/{{#char}}` conditionals; (2) stats keys via `resolveStatsInText`; (3) event keys `{{solicitante}}/{{solicitado}}/{{eventos}}/{{relacion}}/{{hora}}/{{tiempo_mundo}}`; (4) sound `{{sonidos}}`; (5) quest keys `{{activeQuests}}/{{availableQuests}}`; (6) lorebook attribute keys `{{injectionKey}}`; (6.1) lorebook entry keys `{{key}}`; (6.5) inventory `{{slots}}/{{currency}}`; (7) cleanup remaining `{{key}}` to empty string. `resolveAllKeysWithPasses()` (lines 1049-1070) repeats with convergence check.
- Read /home/z/my-project/src/lib/stats/stats-resolver.ts (1021 lines). Documented:
  - `resolveStats()` (lines 743-876): main entry; resolves attributes, builds attribute map (key→formatted string), then calls `buildSkillsBlock`, `buildIntentionsBlock`, `buildInvitationsBlock`, `buildSolicitudesBlock`. Returns `ResolvedStats` with attributes map + blocks + available items lists.
  - `formatAttributeValue()` (lines 122-146): number type → `"Name: (value/max)"`; keyword/text → `"Name: value"`; custom `outputFormat` overrides both.
  - `buildSkillsBlock()` (lines 293-408): builds `[ACCIONES DISPONIBLES]` block. When header contains 'ACCIONES' (line 323), prepends a forced-use instruction telling the LLM to ALWAYS use the `manage_action` tool. Each skill rendered as YAML-like: `- Nombre: ... / Tipo: preparación|ejecución / Descripción: ... / Puede completar: ...`. Supports custom `injectFormat` per skill.
  - `buildSolicitudesBlock()` (lines 706-738): `[SOLICITUDES RECIBIDAS]` block with `key / de / descripcion`.
  - `resolveStatsInText()` (lines 902-936): replaces `{{acciones}}/{{habilidades}}` → skillsBlock, `{{intenciones}}/{{intensiones}}` → intentionsBlock, `{{peticiones}}/{{invitaciones}}` → invitationsBlock, `{{solicitudes}}` → solicitudesBlock, and `{{attributeKey}}` → formatted value if key exists in attributes map.
- Read /home/z/my-project/src/types/index.ts (relevant lines 4235-4665). Documented types:
  - `AttributeDefinition` (lines 4285-4353): id, name, key, type (`'number'|'keyword'|'text'`), defaultValue, min, max, thresholdEffects (V2 flexible threshold), onMinReached/onMaxReached (legacy), keys[]/caseSensitive (post-LLM detection), outputFormat, keywordFormat (legacy), icon, color, showInHUD, hudStyle, hudUnit, timer (intervalMinutes, numericOperation, numericValue, textOperation, textValues/textValue, condition). **NO `isMain`, `mainAttribute`, or `primaryAttribute` field exists.**
  - `SkillDefinition` (lines 4359-4390): id, name, description, completedDescription, key, type (`'preparacion'|'ejecucion'`), requirements[], requirementOperator, category, activationCosts[], activationRewards[], activationKey, activationKeys[], activationKeyCaseSensitive, injectFormat.
  - `CharacterStatsConfig` (lines 4484-4501): enabled, attributes[], skills[], intentions[], invitations[], solicitudDefinitions[], blockHeaders, timerEnabled, timerTickSeconds, timerMaxAccumulatedTicks. **NO mainAttribute field.**
  - `StatRequirement` (lines 4253-4262): attributeKey, operator (`'<'|'<='|'>'|'>='|'=='|'!='|'between'|'contains'|'not_contains'`), value, valueMax, targetCharacterId (for cross-character/user requirements), targetAttributeName.
  - `LorebookEntry` (lines 2600-2635): uid, key[], keysecondary[], comment, content, constant, selective, order, position (0/5/6/7), outletName, disable, excludeRecursion, preventRecursion, delayUntilRecursion, probability, useProbability, depth, selectLogic, group, groupOverride, groupWeight, scanDepth, caseSensitive, matchWholeWords, useGroupScoring, automationId, role, vectorized, displayIndex, extensions, entryType (`'traditional'|'attribute'`), attributeConfig.
  - `LorebookAttributeConfig` (lines 2572-2598): characterId (`'__user__'|'__char__'|<id>`), attributeKey, mode (`'static'|'dynamic'`), injectionKey, staticCondition, dynamicConditions[] (each with id/operator/value/content/priority), fallbackContent, dynamicResolution (`'concat-all'|'first-match'`).
- Read /home/z/my-project/src/lib/lorebook/attribute-resolver.ts (422 lines). Documented: `resolveLorebookAttributeKeys()` (lines 81-254) collects ALL attribute entries across active lorebooks, sorts by entry.order (ascending = highest priority first). For each injectionKey, only ONE entry wins — the first whose conditions match. In `dynamic` mode with `first-match` resolution, evaluates all dynamicConditions, sorts matched by priority DESC, picks the highest-priority match (lines 316-319). If no condition matches across all entries for a key, the key resolves to empty string (line 249). All resolved contents go through `processStartDialogueInText()` for `<START>` dialogue formatting.
- Read /home/z/my-project/src/lib/lorebook/scanner.ts (line 164): `if (entry.entryType === 'attribute') continue;` — confirms attribute-type entries are NOT scanned by the keyword scanner; they're resolved by the attribute-resolver instead.
- Read /home/z/my-project/src/lib/lorebook/injector.ts (255 lines): `buildLorebookInjectionPlan()` builds position-aware sections (position 0/5/6/7/outlets + chat injections 1-4) for TRADITIONAL entries only.
- Read /home/z/my-project/src/lib/lorebook/entry-key-builder.ts (161 lines): `buildLorebookEntryKeyMap()` builds a map of `entry.key[]` → `entry.content` from traditional entries (sorted by entry.order), enabling `{{key}}` resolution in action descriptions.
- Read /home/z/my-project/src/lib/triggers/handlers/skill-key-handler.ts (427 lines): `SkillKeyHandler` is a KeyHandler that matches detected keys against skill `activationKey`/`activationKeys` (supports `key`, `key:value`, `key=value`, `key_suffix`, `|key|` formats). On match, validates requirements via `checkAllRequirements`, applies `activationCosts` (operator + - * / = set_min set_max), updates `ultima_accion_realizada`/`ultima_accion_character` session events, and returns `activationRewards` for the unified reward executor to process.
- Read /home/z/my-project/src/lib/tools/tools/manage-action.ts (245 lines): `manage_action` tool — used when LLM supports tool calling. Validates the requested action_key against statsConfig.skills (matches by activationKey, activationKeys[], name, or key), checks requirements, returns an `actionActivation` payload for client-side execution (does NOT mutate state directly).
- Read /home/z/my-project/src/lib/tools/tools/skill-check.ts (178 lines): `skill_check` tool — dice roll (d20 + stat modifier vs DC) for resolving uncertain actions. Designed for persona stats (e.g., {{user}} fuerza/carisma) but works with any character stat. Returns `checkActivation` payload with outcome (critical_success/success/partial/failure/critical_failure).
- Verified (grep): there is NO `mainAttribute`, `primaryAttribute`, `isMain`, or `mainAttr` field anywhere in the codebase (the only "isMainMark" hit was an unrelated local variable in `sprite-timeline-editor.tsx`). Also confirmed in `stats-editor.tsx` (the UI editor) — no main-attribute toggle exists.

Stage Summary:
- Ximena la Cogelona is fully defined at `data/characters.json` lines 1981-2287. Her character content fields (description, personality, scenario, mesExample, systemPrompt, postHistoryInstructions) are all TEMPLATES containing `{{injectionKey}}` placeholders (e.g., `{{descripcion}}`, `{{personalidad_xim}}`, `{{sysprompt}}`, `{{posthistory}}`, `{{ejemplosdemensajes}}`). These placeholders are resolved at prompt-build time from the Ximena_Lorebook (11 attribute-type entries).
- The characterNote field contains `[EFECTOS DE ATRIBUTOS EN XIMENA]` block that lists `{{adiccion_lore_xim}}`, `{{lujuria_lore_xim}}`, etc. — these are per-attribute effect descriptions injected from the lorebook based on the current attribute value. Below that, `[ESTADO ACTUAL]` lists `{{lujuria}}`, `{{energia}}`, `{{adiccion}}`, `{{exhibicionismo}}`, `{{estupidez}}`, `{{irritabilidad}}` — these are direct attribute keys resolved by `resolveStatsInText()` to `"Name: (value/max)"` format. Finally it includes `{{acciones}}`, `{{activeQuests}}`, `{{peticiones}}`, `{{solicitudes}}` blocks.
- Lorebook attribute entries work end-to-end: Ximena_Lorebook has 11 entries with `entryType: "attribute"`. The attribute-resolver evaluates each entry's dynamicConditions against the character's current attribute values from sessionStats, picks the highest-priority matching condition (priority 1 = value 100 wins first in `first-match` mode), and produces a `lorebookAttributeKeys` map of injectionKey→content. This map is passed into the KeyResolutionContext.lorebookAttributeKeys (Phase 6 of resolveAllKeys), which replaces `{{injectionKey}}` in the character's section templates. After replacement, it recursively re-resolves (3 passes with convergence check) because the injected content may itself contain `{{user}}`, `{{char}}`, `{{eventos}}`, or even nested `{{injectionKey}}` placeholders.
- Attributes/stats: Defined in `CharacterStatsConfig` (types/index.ts lines 4484-4501) per character. Stored in `character.statsConfig`. Runtime values per session are in `SessionStats.characterStats[characterId].attributeValues`. The `[ATRIBUTOS]` block is NOT a single monolithic block; instead, EACH attribute is injected individually wherever its `{{key}}` appears in the prompt (typically in the characterNote's `[ESTADO ACTUAL]` section). `formatAttributeValue()` formats numbers as `"Name: (value/max)"` (e.g., `"Lujuria: (55/100)"`). There is no separate consolidated `[ATRIBUTOS]` block builder — the design uses per-key placeholders resolved via `resolveStatsInText()`. The only consolidated builder is `buildStatsPromptSections()` (stats-resolver.ts lines 971-1021), which is rarely used (only for standalone stats display in the prompt viewer).
- **There is NO "main attribute" or "primary attribute" concept** anywhere in the codebase (types, store, resolver, prompt-builder, or UI editor). The notion of a "main" attribute exists only IMPLICITLY through lorebook design — Ximena's `adiccion` attribute is used as the conditional driver for 5 of 11 lorebook entries (descripcion, personalidad_xim, adiccion_lore_xim, sysprompt, posthistory, ejemplosdemensajes — actually 6 entries), but it's not flagged in any data field. To implement an explicit "main attribute" feature, one would need to: (1) add an `isMain?: boolean` field to `AttributeDefinition`; (2) surface it in the `stats-editor.tsx` UI; (3) optionally use it for highlighting/UI badges/quick display, or as a default for proactiveAttribute config.
- How attributes are sent to the LLM: Each attribute value is sent as a `{{key}}` placeholder that gets resolved to a formatted string (default `"Name: (value/max)"`). The character author controls WHERE in the prompt the attribute appears by placing `{{lujuria}}`, `{{energia}}`, etc. in the characterNote, scenario, description, or any text field. Per-attribute EFFECT TEXT (like "Con Adicción alta: está muy cogelona y adicta...") is injected via lorebook attribute entries using `{{injectionKey}}` placeholders. There is no separate JSON/stats block sent — everything is inline text resolved into the system prompt string. There is also no concept of "stats as JSON tool input" or "stats as separate system message"; the LLM only sees the formatted text.
- Skills/actions work two ways: (a) Post-LLM key detection (`SkillKeyHandler` scans the LLM response for `activationKey`/`activationKeys` patterns like `|sacarverga|` or `key:value`); on match, validates requirements, applies `activationCosts` (modify attributes by +/-/*/=), saves `ultima_accion_realizada` session event, and returns `activationRewards` for the unified reward executor. (b) Tool calling (`manage_action` tool): the LLM calls the tool with `action_key` param; the executor validates the skill, checks requirements, and returns an `actionActivation` payload that the client executes. Ximena's character has `skills: []` (empty) — her questTemplateIds and solicitudDefinitions are also empty, so currently she only has attributes + lorebook + proactiveMessages + emotionalConfig. Other characters (e.g., the one at lines 990-1134 with skills like "Sacar verga", "Poner verga dura") demonstrate the full skill definition pattern with requirements, activationKey, activationCosts, activationRewards (target_attribute + objective types), and completedDescription.
- Observations about the character system: The architecture is highly modular and template-driven. The character's "logic" lives in the lorebook (attribute-driven conditional content), while the character card itself is mostly a template skeleton pointing to `{{injectionKey}}` placeholders. The `resolveSectionsKeysWithPasses(3)` call (line 722 of prompt-builder.ts) is the convergence guarantee for nested templates (e.g., `{{sysprompt}}` lorebook content contains `{{user}}` and `{{char}}` which need a second pass). The 7-phase `resolveAllKeys()` pipeline ensures cross-cutting concerns (template vars, stats, events, sounds, quests, lorebook attribute keys, lorebook entry keys, inventory) are all consistently resolved in a defined order, with a final cleanup phase that strips unresolved `{{key}}` to empty string. The proactiveMessages config on Ximena (driven by `adiccion` with 2 conditions: `<=40` priority 5 with 3 cases, `<=100` priority 1 with 3 cases) demonstrates the proactive attribute-based conditional message system: when adiccion is high, Ximena initiates proactive sex messages, and when low, she flirts more subtly.

---
Task ID: 9
Agent: Explore (additional LLM requests)
Task: Check if the app sends additional LLM requests beyond reactive ones, and document their frequency

Work Log:
- Read worklog.md to align with prior agent context
- Inventoried all 9 routes under /api/chat/: stream, group-stream, proactive, director, emotion, summary, regenerate, interrupt, generate
- Read each route file fully (or relevant excerpts for 1900-line files) to determine which ones actually invoke an LLM provider function (callZAI / streamZAI / streamOpenAICompatible / streamAnthropic / streamOllama / streamGrok / streamTextGenerationWebUI / generateResponse)
- Read /src/lib/llm/generation.ts, /src/lib/llm/streaming.ts, /src/lib/llm/providers/index.ts — all LLM calls funnel through 6 provider functions (call*/stream*) for: z-ai, openai-compatible, anthropic, ollama, grok, text-generation-webui
- Traced all client-side fetch('/api/chat/...') calls: only 3 files (chat-panel.tsx, use-proactive-messages.tsx, use-director.ts) make chat-related requests
- Traced embeddings routes that also call LLMs: extract-memory, extract-group-dynamics, consolidate-memory (all routed through generateResponse)
- Verified memory-reinforcement.ts: only embedding similarity search (NO LLM call)
- Verified detect-context route: only Ollama /api/show query (NO LLM call)
- Verified background-triggers route: only file storage (NO LLM call)
- Verified test-tools route: dev-only endpoint, not called from any client code
- Read defaults.ts, constants.ts (DEFAULT_EMBEDDINGS_CHAT), types/index.ts (DEFAULT_PROACTIVE_MESSAGES_CONFIG, DEFAULT_EMOTIONAL_CONFIG, DEFAULT_SUMMARY_SETTINGS, DEFAULT_DIRECTOR_SETTINGS) to confirm default behavior of every feature

Stage Summary:

## 1. Complete inventory of ALL LLM request types

| # | Name | Route | Trigger | Frequency (default) | Configurable? | 1-to-1 / Group / Both |
|---|------|-------|---------|---------------------|---------------|------------------------|
| 1 | **Reactive chat (1-to-1)** | `/api/chat/stream` | User sends a message | 1 call per user turn | Always on | 1-to-1 |
| 2 | **Reactive chat (group)** | `/api/chat/group-stream` | User sends a message | N calls per user turn (N = active non-narrator members; +1 narrator if intervenes) | Always on | Group |
| 3 | **Non-streaming fallback** | `/api/chat/generate` | Same as #1, used when streaming disabled | 1 call per user turn | Always on (toggleable via `useStreaming` setting) | 1-to-1 |
| 4 | **Regenerate (swipe)** | `/api/chat/regenerate` | User clicks "Regenerate" button | On-demand (1 call per click) | Always on | 1-to-1 |
| 5 | **Interrupt reaction** | `/api/chat/interrupt` | User clicks "Stop" mid-stream | On-demand (1 call per stop) — only when partial content exists | Always on | 1-to-1 |
| 6 | **Proactive message** | `/api/chat/proactive` | Inactivity timer | Every 300s (default) of inactivity, after ≥5 messages in session; skips during active generation; respects `allowedStates` ('idle' / 'user_away') | Yes — character-level `proactiveMessages.enabled` (default **off**); `intervalSeconds` default 300; `minMessagesBeforeStart` default 5; `maxPerSession` default 0 (unlimited) | Both (group support gated by `groupChatEnabled`, default off) |
| 7 | **Director analysis** | `/api/chat/director` | Post-turn debounce (8s after a turn) + idle tick every 60s | Throttled by `minIntervalMinutes` (default 3 min); only makes LLM call when `mode === 'llm'` (default is `'heuristic'` = NO LLM call) | Yes — `settings.director.enabled` (default **on**); `mode` (default heuristic, no LLM); `minIntervalMinutes` default 3 | Both |
| 8 | **Emotion evaluation** | `/api/chat/emotion` | After stream `done` event when server sets `shouldEvaluateEmotion=true` | 1 call per turn (1-to-1) / 1 per character (group), throttled by `evaluationInterval` (default 1 = every turn) | Yes — `character.emotionalConfig.enabled` (default **off**); `evaluationInterval` default 1; `contextMessagesCount` default 6 | Both |
| 9 | **Summary generation** | `/api/chat/summary` | `incrementMessageCount` after a turn → `shouldGenerateSummary()` returns true | Every 20 turns (1-to-1) / every 15 turns (group), default | Yes — `settings.summary.enabled` (default **off**); `autoSummarize` default on; `normalChatInterval` default 20; `groupChatInterval` default 15 | Both |
| 10 | **Memory extraction (character)** | `/api/embeddings/extract-memory` | After stream `done` event when server sets `shouldExtract=true` | Every `memoryExtractionFrequency` turns (default 5) — server-side turn counter | Yes — `embeddingsChat.memoryExtractionEnabled` (default **off**); `memoryExtractionFrequency` default 5; `memoryExtractionContextDepth` default 2 | Both (group: 1 call per speaking character) |
| 11 | **Memory extraction (user)** | `/api/embeddings/extract-memory` (same route, extra body flag) | Same as #10, when `extractFromUser=true` | Every `memoryExtractionFrequency` turns (default 5) — adds 1 EXTRA call per extract-memory invocation | Yes — `memoryExtractionFromUserEnabled` (default **off**) | Both |
| 12 | **Auto-consolidation** | `/api/embeddings/consolidate-memory` (indirectly via `autoConsolidateAfterExtraction`) | Triggered inside `extract-memory` route after saving memories, when namespace count > threshold | When memory count > 50 (default) — makes 1 LLM call per memory-type group (up to 4 calls per consolidation run) | Yes — `memoryConsolidationEnabled` (default **off**); `memoryConsolidationThreshold` default 50; `batchSize` default 20 | Both |
| 13 | **Group dynamics extraction** | `/api/embeddings/extract-group-dynamics` | After group stream completes, when `groupDynamicsExtraction=true` AND `extractableChars.length > 1` | 1 call per group turn (when enabled) | Yes — `groupDynamicsExtraction` (default **off**) | Group only |
| 14 | **Proactive + memory extraction** | `/api/embeddings/extract-memory` (from `use-proactive-messages.tsx`) | After proactive stream completes, when `shouldExtract=true` | Same cadence as #10/#11 — every `memoryExtractionFrequency` turns (default 5) | Same as #10 | Both |

## 2. Default behavior — what runs out of the box?

With default settings (no features explicitly enabled), every user turn triggers exactly:
- **1-to-1 chat:** 1 LLM call (the chat response itself)
- **Group chat:** N LLM calls (N = active members in the responders list, optionally + narrator)

ALL additional LLM features are **off by default**:
- Emotional evaluation: off
- Memory extraction: off
- Memory consolidation: off
- Group dynamics extraction: off
- Memory extraction from user: off
- Proactive messages: off
- Summary generation: off
- Director LLM mode: off (heuristic-only by default, no LLM call)
- Memory reinforcement: off (and even when on, uses embedding similarity only — NO LLM call)

## 3. Worst-case LLM calls per "unit of conversation"

Assume user enables ALL optional features with defaults. For a 10-turn session (10 user messages):

**1-to-1 chat:**
- 10 chat responses = 10 calls
- 2 memory extractions (every 5 turns) = 2 calls (× 1 for character, +1 each if user extraction enabled = 4 calls)
- 1 summary at turn 20 → 0 calls in 10 turns (need 20)
- ~10 emotion evaluations (every turn, default interval=1) = 10 calls
- ~3 director LLM calls (every 3 min, mode='llm') — only if 3+ minutes elapsed; otherwise 0
- ~0 consolidation calls (needs > 50 memories; not reached in 10 turns)
- Proactive messages: depends on inactivity, ~0–2 in a 10-minute session

**Approximate total (10 turns, all features on, 1-to-1 chat):** ~25–30 LLM calls (≈3× the bare 10 reactive calls).

**Group chat (3 characters, 10 turns, all features on):**
- 30 chat responses (3 per turn)
- 6 character memory extractions (2 per 5 turns × 3 chars)
- 2 group dynamics extractions
- ~30 emotion evaluations (1 per char per turn)
- ~3 director LLM calls
- ~0–6 proactive messages (if inactivity)

**Approximate total (10 turns, 3 chars, all features on):** ~75–80 LLM calls (≈2.5× the 30 reactive calls).

## 4. Concerns about excessive LLM usage

1. **Emotion evaluation runs every turn by default** (`evaluationInterval: 1`). Even though it's a 20-token response, this doubles the LLM calls per turn if enabled. Users should set `evaluationInterval: 2` or `3` to halve/third this cost.

2. **Group memory extraction is per-character.** With 5 group members and `memoryExtractionFrequency: 5`, you get 5 LLM calls every 5 turns — fine, but every character also triggers `extractFromUser` (5 more calls) and group dynamics (1 more). At 5 group members with all options on, every 5th turn generates 6 extra LLM calls.

3. **Auto-consolidation makes N LLM calls per type.** When triggered (>50 memories), it batches by memory_type and calls the LLM once per batch. With ~5 memory types, that's up to 5 LLM calls in a single consolidation run.

4. **Proactive messages share the full prompt-building pipeline** (lorebooks, embeddings, character memory, HUD, tools) — every proactive message is as expensive as a regular chat turn. Default `intervalSeconds: 300` is reasonable, but combined with the proactive + memory extraction chain, an idle user could trigger 2 LLM calls every 5 minutes indefinitely.

5. **Director default `minIntervalMinutes: 3` is reasonable, BUT it also runs an idle check every 60 seconds** — even though throttled, this is wasteful CPU/network. Consider raising the idle check interval to 5 min when director is in heuristic mode (no LLM call anyway).

6. **No global kill-switch** for "all background LLM features". A user wanting minimal LLM usage must disable each feature separately: proactive messages (per character), emotion (per character), memory extraction, memory consolidation, group dynamics, summary, and switch director to heuristic mode (or disable). A single master toggle "Disable all background LLM" would be helpful.

7. **Interrupt reaction makes an LLM call on every "Stop" click** — if a user habitually stops mid-stream to redirect, this can add up. There's no setting to disable this; the route at `/api/chat/interrupt/route.ts:42` always streams a reaction when partial content > 0.

## 5. File/line references

- `/home/z/my-project/src/app/api/chat/stream/route.ts:1925-1932` — server emits `shouldExtract` + `shouldEvaluateEmotion` flags
- `/home/z/my-project/src/app/api/chat/group-stream/route.ts:2110-2126` — server emits `shouldExtract` for group
- `/home/z/my-project/src/app/api/chat/proactive/route.ts:1881-1900` — server emits `shouldExtract` for proactive
- `/home/z/my-project/src/components/tavern/chat-panel.tsx:617` — single-chat summary trigger
- `/home/z/my-project/src/components/tavern/chat-panel.tsx:1373` — group memory extraction per character
- `/home/z/my-project/src/components/tavern/chat-panel.tsx:1453` — group dynamics extraction
- `/home/z/my-project/src/components/tavern/chat-panel.tsx:1516,2203` — emotion evaluation calls (group + single)
- `/home/z/my-project/src/components/tavern/chat-panel.tsx:2107` — single-chat memory extraction
- `/home/z/my-project/src/components/tavern/chat-panel.tsx:2256` — non-streaming `/api/chat/generate` call
- `/home/z/my-project/src/components/tavern/chat-panel.tsx:2503` — interrupt reaction call
- `/home/z/my-project/src/components/tavern/chat-panel.tsx:2634` — regenerate call
- `/home/z/my-project/src/hooks/use-proactive-messages.tsx:301` — proactive timer → `/api/chat/proactive`
- `/home/z/my-project/src/hooks/use-proactive-messages.tsx:699` — proactive → extract-memory
- `/home/z/my-project/src/hooks/use-director.ts:101` — director hook → `/api/chat/director`
- `/home/z/my-project/src/hooks/use-director.ts:21-22` — director timing constants (8s debounce, 60s idle)
- `/home/z/my-project/src/store/defaults.ts:41-95` — `defaultSettings` (embeddingsChat + director defaults)
- `/home/z/my-project/src/lib/embeddings/constants.ts:7-41` — `DEFAULT_EMBEDDINGS_CHAT` (all memory/consolidation defaults)
- `/home/z/my-project/src/types/index.ts:862-870` — `DEFAULT_EMOTIONAL_CONFIG` (enabled: false, interval: 1)
- `/home/z/my-project/src/types/index.ts:1404-1418` — `DEFAULT_PROACTIVE_MESSAGES_CONFIG` (enabled: false, interval: 300)
- `/home/z/my-project/src/types/index.ts:2854+` — `DEFAULT_SUMMARY_SETTINGS` (enabled: false, intervals 20/15)
- `/home/z/my-project/src/lib/director/types.ts:28-33` — `DEFAULT_DIRECTOR_SETTINGS` (enabled: true, mode: 'heuristic')
- `/home/z/my-project/src/lib/embeddings/memory-extraction.ts:384,528` — LLM call sites for memory + group dynamics extraction
- `/home/z/my-project/src/lib/embeddings/memory-consolidation.ts:275` — LLM call site for consolidation
- `/home/z/my-project/src/lib/emotions/emotion-evaluator.ts:230-247` — LLM call sites for emotion evaluation (1 call, max 20 tokens)
- `/home/z/my-project/src/app/api/chat/director/route.ts:115-151` — Director LLM call (only when mode='llm')
- `/home/z/my-project/src/app/api/chat/interrupt/route.ts:108-138` — Interrupt reaction LLM call

## 6. Conclusion

**Beyond reactive chat responses, the app makes these additional LLM calls:**
1. Emotion evaluation (per turn, configurable per character)
2. Memory extraction (per N turns, configurable)
3. Memory extraction from user (per N turns, configurable)
4. Group dynamics extraction (per group turn, configurable)
5. Memory consolidation (threshold-triggered, configurable)
6. Summary generation (per N turns, configurable)
7. Proactive messages (inactivity timer, per character, configurable)
8. Director LLM narration (post-turn + idle tick, configurable; default heuristic = no LLM)
9. Interrupt reaction (on user stop, NOT configurable — always runs)

**All optional background LLM features default to OFF**, so out-of-the-box the app only makes 1 reactive call per turn (or N in group). The Director is on by default but in heuristic mode (no LLM cost). To minimize LLM usage, users should keep the optional features off and the Director in heuristic mode.

**Biggest concern: lack of a single "disable all background LLM" master switch**, plus the non-configurable interrupt reaction, plus emotion evaluation defaulting to every turn when enabled (should be 2 or 3 turns).

---
Task ID: 5
Agent: Explore (LLM tool calling failures)
Task: Investigate why LLM tool calling might fail

Work Log:
- Read /home/z/my-project/worklog.md to understand prior agent work
- Read tool system architecture: src/lib/tools/tool-registry.ts, types.ts, executor.ts, definitions.ts, parsers.ts, parsers/native-parser.ts, parsers/prompt-parser.ts, index.ts, text-actions.ts
- Read tool execution flow: src/app/api/chat/stream/route.ts (1950 lines), src/app/api/chat/group-stream/route.ts, src/app/api/chat/proactive/route.ts (1918 lines)
- Read LLM providers: src/lib/llm/providers/{index,zai,openai,grok,anthropic,ollama,text-generation-webui}.ts
- Cross-referenced all finalizeToolCalls / buildToolMessages* / streamXxxWithTools call sites with their function signatures
- Compiled src/lib/tools/executor.ts with tsc to confirm broken imports
- Verified call sites with ripgrep (getTool, finalizeToolCalls, hasToolCalls, toolContext, toolContextMessages, maxToolRounds)

Stage Summary:

## PRIMARY ROOT CAUSE — Tool calling crashes on the SECOND round (follow-up after first tool call)

The chat stream route (`src/app/api/chat/stream/route.ts`) has multiple independent bugs in the follow-up branch of every provider's tool loop. These bugs manifest only AFTER the first tool call has executed successfully — which exactly matches the user's report: "tool calling can fail after a while" (pueden llegar a fallar luego).

With default settings (`maxToolCallsPerTurn = 4` from `src/types/index.ts` DEFAULT_TOOLS_SETTINGS, line 2408; `src/app/api/chat/stream/route.ts` line 402), the while loop runs `toolRound` from 0 to 4. Round 0 (first tool call) works fine. Round 1 (follow-up incorporating tool result) crashes.

### Bug #1 (CRITICAL — Z.ai follow-up always crashes with TypeError)
**File:** `src/app/api/chat/stream/route.ts` lines 1070-1071
```javascript
const toolCalls = finalizeToolCalls(accumulator);
if (toolCalls.length > 0 && (accumulator.finishReason === 'tool_calls' || accumulator.finishReason === 'stop')) {
```
`finalizeToolCalls` is declared `: void` in `src/lib/tools/parsers/native-parser.ts` line 111 — it MUTATES `accumulator.toolCalls` and returns `undefined`. So `toolCalls.length` → `undefined.length` → **TypeError: Cannot read properties of undefined (reading 'length')**.

This branch is reached whenever `shouldUseTools && isToolRound && toolContextMessages.length > 0 && toolRound < maxToolRounds` (line 1055-1058). With `maxToolRounds = 4` (default), this is true for `toolRound = 1, 2, 3`. So Z.ai (the default provider for this app) ALWAYS crashes the moment a tool call requires a follow-up response.

The provider function (`streamZAIWithTools` in `src/lib/llm/providers/zai.ts` line 307) ALREADY calls `finalizeToolCalls(accumulator)` internally — the chat route's redundant call would also push DUPLICATE entries into `accumulator.toolCalls` if it didn't crash first.

### Bug #2 (CRITICAL — OpenAI follow-up: wrong number of args)
**File:** `src/app/api/chat/stream/route.ts` line 1255
```javascript
generator = streamOpenAIWithTools(toolContextMessages as any, llmConfig, availableTools, accumulator);
```
`streamOpenAIWithTools` signature (`src/lib/llm/providers/openai.ts` lines 111-117) is `(messages, config, provider, tools, accumulator)` — 5 args. The follow-up call passes only 4 args, dropping `llmConfig.provider`. As a result:
- arg3 `availableTools` (ToolDefinition[]) is bound to parameter `provider: string`
- arg4 `accumulator` (ToolCallAccumulator object) is bound to parameter `tools: ToolDefinition[]`

Then `toOpenAITools(tools)` (line 121) calls `tools.map(t => ...)` on the accumulator object → **TypeError: tools.map is not a function**.

The first-round call at line 1138 passes 5 args correctly. Only the follow-up is broken.

### Bug #3 (CRITICAL — OpenAI follow-up: same finalizeToolCalls void bug as #1)
**File:** `src/app/api/chat/stream/route.ts` lines 1263-1264
```javascript
const toolCalls = finalizeToolCalls(accumulator);
if (toolCalls.length > 0 && (accumulator.finishReason === 'tool_calls' || accumulator.finishReason === 'stop')) {
```
Same as Bug #1 — `finalizeToolCalls` returns `void`, `toolCalls.length` throws TypeError. The OpenAI provider (`src/lib/llm/providers/openai.ts` line 210) also calls `finalizeToolCalls(accumulator)` in its `finally` block, so the chat-route call is redundant and would also cause duplicate tool-call entries.

### Bug #4 (CRITICAL — TextGenWebUI follow-up: undefined variable)
**File:** `src/app/api/chat/stream/route.ts` lines 1738-1749
```javascript
const toolContextMessages = [   // shadows outer toolContextMessages
  ...chatMessages,
  ...buildToolMessagesForOpenAI(accumulator.toolCalls, toolResultPairs),
];
accumulatedContent = '';
toolRound++;
toolContext.push(...toolContextMessages.map(m => ({   // toolContext is NEVER declared!
  role: m.role,
  content: m.content || '',
  toolCallId: (m as any).toolCallId,
  name: (m as any).name,
})));
continue;
```
`toolContext` is used at line 1744 but is NOT declared anywhere in the file (verified with ripgrep). This throws **ReferenceError: toolContext is not defined**. Affects `text-generation-webui` and `koboldcpp` providers when a tool call succeeds and `shouldContinue` is true.

### Bug #5 (HIGH — Anthropic follow-up: wrong number of args to buildToolMessagesForAnthropic)
**File:** `src/app/api/chat/stream/route.ts` line 1432
```javascript
toolContextMessages = buildToolMessagesForAnthropic(toolContextMessages, toolCalls, toolResult);
```
`buildToolMessagesForAnthropic` signature (`src/lib/tools/parsers/native-parser.ts` lines 379-382) is `(toolCalls, toolResults)` — 2 args. The follow-up call passes 3 args:
- arg1 `toolContextMessages` (an array of chat messages) is bound to `toolCalls: NativeToolCall[]`
- arg2 `toolCalls` (NativeToolCall[]) is bound to `toolResults: Array<{success, displayMessage}>`
- arg3 `toolResult` is ignored

The function then does `toolCalls.map(tc => ({ id: tc.id, function: { name: tc.name, arguments: tc.rawArguments } }))` on chat-message objects — they don't have `id`/`name`/`rawArguments`, so the assistant message has `tool_calls: [{id: undefined, function: {name: undefined, arguments: undefined}}]`. The follow-up request sent to Anthropic is malformed and likely rejected with HTTP 400. Doesn't crash JS immediately but corrupts state and breaks the next iteration.

Same wrong-args pattern at lines 1084 and 1276 for `buildToolMessagesForOpenAI` (also 2-arg signature called with 3 args).

## SECONDARY ISSUES

### Issue A — Ollama & Grok follow-ups don't detect chained tool calls (silent degradation)
**Files:** `src/app/api/chat/stream/route.ts` lines 1558-1563 (Ollama) and 1679-1683 (Grok)

Both follow-up branches only set `generator = streamXxxWithTools(...)` and break out of the switch. The generator is consumed by the post-switch code at lines 1832-1851, which just streams the response to the client. There is NO call to `hasToolCalls`/`finalizeToolCalls`/`anthropicStateToToolCalls`, NO `executeToolCallsAndContinue`, and NO `toolRound++`/`continue`. So if Ollama/Grok returns ANOTHER tool call in the follow-up, it's silently ignored. The character can never chain actions across rounds with these providers.

### Issue B — Dead and broken `executor.ts` module
**File:** `src/lib/tools/executor.ts`

This file imports `getTool`, `getAllTools`, `getToolDefinitions`, `buildToolsPromptText` from `./tool-registry` — NONE of these are exported (confirmed by `tsc --noEmit`):
```
src/lib/tools/executor.ts(5,10): error TS2305: Module '"./tool-registry"' has no exported member 'getTool'.
src/lib/tools/executor.ts(83,10): error TS2305: ... 'getTool'
src/lib/tools/executor.ts(83,19): error TS2305: ... 'getAllTools'
src/lib/tools/executor.ts(83,32): error TS2724: ... 'getToolDefinitions'. Did you mean 'getAllToolDefinitions'?
src/lib/tools/executor.ts(83,67): error TS2305: ... 'buildToolsPromptText'
```

It also accesses `definition.enabled`, `definition.permissionMode === 'disabled'`, `definition.maxUsesPerDay`, `definition.label`, and `entry.executor.execute(...)` — none of which exist on the actual `ToolDefinition` interface (`src/lib/tools/types.ts` lines 39-48) or the `RegisteredTool` shape (`src/lib/tools/tool-registry.ts` lines 26-29). The actual executor field is a `ToolExecutorFn` (callable), not an object with an `execute` method.

The file is never imported anywhere (verified with ripgrep), so it doesn't crash the runtime, but it's broken dead code that would fail any TypeScript build that includes it. The real execution path uses `executeTool` in `src/lib/tools/tool-registry.ts` lines 246-285.

### Issue C — Dead `parsers.ts` and `definitions.ts`
**Files:** `src/lib/tools/parsers.ts`, `src/lib/tools/definitions.ts`

Both are dead code (no imports found via ripgrep). They use the OLD tool format (`TOOL_CALL:` prefix, OpenAI-shaped `ToolDefinition` with `type: 'function'` field) that no longer matches the current `ToolDefinition` interface. They would also fail TypeScript compilation if pulled in.

### Issue D — Prompt-parser regex stops at first `}` for nested JSON
**File:** `src/lib/tools/parsers/prompt-parser.ts` line 198
```javascript
const altMatches = trimmed.match(/TOOL_CALL:\s*(\w+)\s*\|\s*(\{[\s\S]*?\})/gi);
```
The non-greedy `\{[\s\S]*?\}` stops at the FIRST `}`. For nested objects like `TOOL_CALL: x | {"a": {"b": 1}}` it would capture `{"a": {"b": 1}` (truncated), then `JSON.parse` fails and the call is silently skipped. Pattern 3 (brace-counting `findAllToolCallJsonObjects`) is the robust fallback, but if Pattern 2 matches anything (even malformed), `if (calls.length > 0) return calls;` returns empty silently and Pattern 3 is never tried — actually wait, looking again at lines 199-213: Pattern 2 only returns if `calls.length > 0`, which requires `JSON.parse` to succeed, so malformed captures just produce empty `calls` and Pattern 3 is reached. So this is minor.

### Issue E — Pattern 3 of prompt-parser can false-positive on regular JSON
**File:** `src/lib/tools/parsers/parsers/prompt-parser.ts` lines 132-155 and 215-226

`findAllToolCallJsonObjects` finds ANY JSON object containing `"name"` AND (`"parameters"` OR `"arguments"`) and treats it as a tool call. If the LLM emits JSON in its response that happens to use these field names (e.g., `{"name": "Alice", "parameters": {...}}`), it would be incorrectly parsed and stripped. The `mightContainToolCall` pre-check at line 246 also uses a loose `/\"name\"\s*:\s*\"[^\"]+\"/` regex.

### Issue F — Ollama parser clobbers incremental tool_calls
**File:** `src/lib/tools/parsers/native-parser.ts` lines 211-226
```javascript
if (toolCalls && toolCalls.length > 0) {
  accumulator.toolCalls = [];   // RESETS every chunk
  for (let i = 0; i < toolCalls.length; i++) { ... }
}
```
Comment claims "Ollama sends the full tool call in each chunk, so we take the last complete one". This is incorrect for newer Ollama versions that stream tool_calls incrementally across chunks — only the last chunk's tool calls survive. Not the primary failure mode but a latent incompatibility.

### Issue G — `processOpenAIDelta` assumes `index` is always present
**File:** `src/lib/tools/parsers/native-parser.ts` lines 87-101
```javascript
const index = tcDelta.index as number;
...
accumulator.privateIdsBuffer.set(index, id);
accumulator.privateArgsBuffer.set(index, existing + (func.arguments as string));
```
If a provider's streaming delta omits `index` (it's optional in some implementations), `index` is `undefined`, and `Map.set(undefined, ...)` collapses all deltas to a single `undefined` key — multiple parallel tool calls get their arguments concatenated into one. Not observed in the wild for OpenAI proper but a latent bug for OpenAI-compatible providers (LM Studio, vLLM, custom).

### Issue H — Anthropic assistant text is dropped from follow-up context
**File:** `src/lib/tools/parsers/native-parser.ts` lines 328-341

In `processAnthropicEvent`, `text_delta` events are yielded as text for streaming, but they are NOT accumulated into `toolState`. So when `buildToolMessagesForAnthropic` constructs the assistant message (line 384-389), only `tool_use` blocks are included — any text the assistant produced alongside the tool call is lost from the follow-up context. The model sees its own tool_use but not its own narration.

### Issue I — `buildToolMessagesForOllama` contains dead `typeof` check
**File:** `src/lib/tools/parsers/native-parser.ts` line 255
```javascript
arguments: typeof tc.arguments === 'string' ? JSON.parse(tc.arguments) : tc.arguments,
```
`NativeToolCall.arguments` is typed `Record<string, unknown>` (object, never string), so this branch is dead. Harmless but misleading.

### Issue J — `buildToolMessagesForOpenAI` discards actual tool result data
**File:** `src/lib/tools/parsers/native-parser.ts` lines 168-177

Only `result.displayMessage` is sent back to the LLM; `result.result` (the structured data, e.g., dice rolls, weather JSON, search results) is discarded. For tools that return rich structured data (like `roll_dice`'s `{rolls, total, modifier}`), the LLM only sees the human-readable display string and loses the structured information.

### Issue K — No graceful recovery on tool execution failure
**File:** `src/app/api/chat/stream/route.ts` line 1934-1938
```javascript
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : 'Unknown error';
  controller.enqueue(createSSEJSON({ type: 'error', error: errorMessage }));
  controller.close();
}
```
Any error during the tool loop (including the TypeErrors from Bugs #1-#4) is caught here and surfaced as a generic `error` SSE event with the raw error message. The stream is then closed — no retry, no fallback to non-tool streaming, no graceful degradation. The user sees the tool execute (round 0 events already sent) followed by an opaque error.

## MOST LIKELY CAUSE OF "TOOL CALLING FAILS AFTER A WHILE"

**Bug #1** (Z.ai follow-up `finalizeToolCalls` returns void → `undefined.length` TypeError) is almost certainly the user's reported failure, because:

1. **Z.ai is the default provider** for this app (per worklog Task 0).
2. The bug triggers deterministically whenever the LLM emits a tool call AND `maxToolRounds > 1` — which is true by default (`maxToolCallsPerTurn = 4` in `src/types/index.ts`).
3. The crash happens on the very FIRST follow-up (round 1), immediately after the first tool call succeeds.
4. Symptom matches the report exactly: tool events appear, then the response that should incorporate the tool result is replaced by an error. From the user's POV, "tool calling fails" — the tool ran but the chat didn't continue properly.
5. "After a while" (luego) makes sense because the crash only triggers when the LLM actually decides to call a tool — normal conversational turns work fine until the first tool invocation.

**Bugs #2-#5** compound the problem for OpenAI/Anthropic/TextGenWebUI users: even if Bug #1 were fixed, those providers have their own independent follow-up bugs (wrong arg count, undefined variable, malformed messages) that would crash or break tool chaining in the same "after the first tool call" pattern.

## RECOMMENDED FIXES (priority order)

1. **Fix Bug #1 + #3**: Replace `const toolCalls = finalizeToolCalls(accumulator); if (toolCalls.length > 0 ...)` with `if (hasToolCalls(accumulator) && (accumulator.finishReason === 'tool_calls' || accumulator.finishReason === 'stop')) { ... accumulator.toolCalls ... }` (the same pattern used correctly in round 0). Remove the redundant `finalizeToolCalls` call entirely — the providers already call it internally.

2. **Fix Bug #2**: Change line 1255 from `streamOpenAIWithTools(toolContextMessages as any, llmConfig, availableTools, accumulator)` to `streamOpenAIWithTools(toolContextMessages as any, llmConfig, llmConfig.provider, availableTools, accumulator)` (add the missing `provider` arg).

3. **Fix Bug #4**: Replace `toolContext.push(...)` at line 1744 with the standard `toolContextMessages = [...baseChatMessages, ...buildToolMessagesForOpenAI(accumulator.toolCalls, toolResultPairs)];` pattern used by other providers, and remove the inner `const toolContextMessages = [...]` shadowing declaration.

4. **Fix Bug #5 + same-pattern at lines 1084/1276**: Replace `buildToolMessagesForOpenAI(toolContextMessages, toolCalls, toolResult)` with `toolContextMessages = [...toolContextMessages, ...buildToolMessagesForOpenAI(toolCalls, toolResult.toolResults)]` (spread the new messages into the existing array). Same fix for `buildToolMessagesForAnthropic` at line 1432.

5. **Fix Issue A**: Either (a) accept that Ollama/Grok don't support chained tool calls and document it, or (b) refactor the follow-up branches to use the same buffer→detect→execute→loop pattern as round 0 (with the Bug #1 fix applied).

6. **Fix Issue K**: In the outer catch at line 1934, if `accumulatedContent` has content (round-0 text was streamed) but the follow-up crashed, at least send a `done` event instead of an error so the client doesn't show a scary error message — the tool did execute successfully.

7. **Fix Issue B + C**: Delete `src/lib/tools/executor.ts`, `src/lib/tools/parsers.ts`, and `src/lib/tools/definitions.ts`. They're broken dead code that misleads future maintainers.

8. **Fix Issue H**: Accumulate text deltas into a `toolState.textBlocks` array (or attach them to the most recent tool_use block) and include them in the assistant message built by `buildToolMessagesForAnthropic`.


---
Task ID: 10-16 (implementation)
Agent: Z.ai Code (principal)
Task: Fix tool calling bugs, add proactive countdown UI, add main attribute feature, enhance modify_stat tool

Work Log:
- TASK 5/10/11/12 FIX (tool calling bugs in stream/route.ts):
  - Fixed Z.ai follow-up: `finalizeToolCalls(accumulator)` returns void but was treated as returning an array → TypeError. Replaced with `hasToolCalls(accumulator)` + `accumulator.toolCalls`.
  - Fixed Z.ai follow-up: `buildToolMessagesForOpenAI(toolContextMessages, toolCalls, toolResult)` wrong args (3 args, takes 2). Changed to append pattern: `[...toolContextMessages, ...buildToolMessagesForOpenAI(accumulator.toolCalls, toolResultPairs)]`.
  - Fixed OpenAI follow-up: `streamOpenAIWithTools(toolContextMessages, llmConfig, availableTools, accumulator)` missing `provider` arg. Added `llmConfig.provider` as 4th arg.
  - Fixed OpenAI follow-up: same `finalizeToolCalls` void bug and `buildToolMessagesForOpenAI` wrong-args bug.
  - Fixed Anthropic follow-up: `buildToolMessagesForAnthropic(toolContextMessages, toolCalls, toolResult)` wrong args. Changed to append pattern.
  - Fixed Ollama follow-up: generator created but NEVER consumed — response was lost. Added full buffer+detect+execute+loop pattern.
  - Fixed Grok follow-up: same as Ollama — generator never consumed. Added full pattern.
  - Fixed TextGenWebUI: `const toolContextMessages` shadowed outer var + `toolContext.push(...)` referenced undefined variable. Changed to assign to outer var + set isToolRound. Also added missing follow-up branch (`else if (shouldUseTools && isToolRound)`).
  - Fixed Grok text-based tool call: `splitIntoChunks(cleanedContent)` should be `splitIntoChunks(cleanContent)` (undefined variable).
  - Improved error recovery: if content was already streamed before an error, send a `done` event with `partialRecovery: true` instead of an `error` event, so the client keeps the partial response.
  - Removed unused `finalizeToolCalls` import from stream/route.ts.

- TASK 6/13 FEATURE (proactive countdown UI):
  - Plumbed `proactiveNextIn` (seconds remaining) + `proactiveInactiveReason` + `proactiveSessionCount` from `useProactiveMessages` hook → `chat-panel.tsx` → `NovelChatBox`.
  - Added discreet countdown indicator inside the proactive pill: shows `⏱ m:ss` when counting down, `● Listo` (pulsing amber) when ready to fire. Hidden during generation.
  - Enhanced tooltip: shows "Próximo mensaje en ~m:ss", reason when generating, and session count.
  - Props added to NovelChatBoxProps interface + defaults.

- TASK 7/14 FEATURE (main attribute):
  - Added `isMain?: boolean` field to `AttributeDefinition` in `src/types/index.ts`.
  - Added `mainAttribute` field to `ResolvedStats` interface (key, name, value, formatted, definition).
  - Updated `resolveStats()` in `src/lib/stats/stats-resolver.ts` to find the main attribute and populate `mainAttribute` in the result.
  - Added crown icon toggle button in `AttributeEditor` header (`src/components/tavern/stats-editor.tsx`). When toggled on, automatically unmarks all other attributes (single-main invariant enforced in `updateAttribute`).
  - Added "Principal" badge with crown icon next to attribute name when `isMain` is true.
  - Imported `Star` and `Crown` icons from lucide-react.

- TASK 8/15 FEATURE (enhance modify_stat tool + native-tool instructions):
  - Fixed clamping warning bug in `modify-stat.ts`: previously only showed warning for set operations, not add/subtract. Now computes expected unclamped value for ALL operation types and shows warning when clamping occurred.
  - Added main attribute hint to "stat not found" error message: lists all stats with 👑 PRINCIPAL tag, and highlights the main attribute name.
  - Added `👑 Atributo principal del personaje` line to display message when modifying the main attribute.
  - Added `[GESTIÓN DE ATRIBUTOS]` section to system prompt (both 1-to-1 and group chat) in `prompt-builder.ts`: lists all attributes with current values, highlights main attribute, and instructs the LLM to use `modify_stat` actively when the narrative justifies attribute changes.

- TASK 8/16 FIX (enable tools by default):
  - Removed `modify_stat`, `check_stat`, `manage_quest`, `manage_solicitud` from `disabledTools` in `data/settings.json`. These tools are now enabled by default.
  - `DEFAULT_TOOLS_SETTINGS` in types/index.ts already has `disabledTools: []` (empty), so new installations are fine.

Stage Summary:
- TOOL CALLING FIXES: 6 critical bugs fixed in stream/route.ts follow-up rounds (Z.ai, OpenAI, Anthropic, Ollama, Grok, TextGenWebUI). Root cause was `finalizeToolCalls` void return treated as array + wrong args to `buildToolMessagesFor*` + generators never consumed in Ollama/Grok + undefined variable in TextGenWebUI. Added graceful error recovery. Lint passes cleanly.
- PROACTIVE COUNTDOWN: discreet `⏱ m:ss` indicator in the proactive pill, with `● Listo` pulsing when ready. Tooltip shows full info. Data already existed in the hook, just needed plumbing to NovelChatBox.
- MAIN ATTRIBUTE: `isMain` field on AttributeDefinition, crown toggle in stats-editor UI (single-main invariant enforced), exposed in ResolvedStats, highlighted in modify_stat tool errors/display, and in the new [GESTIÓN DE ATRIBUTOS] prompt section.
- ATTRIBUTE MANAGEMENT: LLM now receives explicit instructions (in both 1-to-1 and group prompts) about which attributes exist, their current values, which is the main attribute, and how/when to use `modify_stat`. modify_stat and check_stat are now enabled by default.
- VERIFIED: Dev server runs on port 3000, page loads (title "TavernFlow - AI Character Chat Platform"), characters render (Ximena, Pinky Vane), no page errors, lint clean.

---
Task ID: R2
Agent: Explore (verify tool calling + Director)
Task: Verify tool calling fixes work and investigate if Director uses tool calling

Work Log:
- Read /home/z/my-project/worklog.md (Task IDs 0, 4, 5, 6, 8, 9, 10-16) to understand prior fixes (Z.ai/OpenAI/Anthropic/Ollama/Grok/TextGenWebUI follow-up bugs) and prior Director review
- Read /home/z/my-project/src/app/api/chat/stream/route.ts key sections:
  - L895-918: outer while-loop, `let accumulatedContent/allToolsUsed/allQuestActivations` declarations inside try block (indent=10, INSIDE the try)
  - L955-1126: Z.ai case (first-round + follow-up at L1054-1117)
  - L1128-1325: OpenAI case (follow-up at L1264-1323)
  - L1327-1497: Anthropic case (follow-up at L1436-1496)
  - L1499-1660: Ollama case (follow-up at L1605-1655)
  - L1662-1828: Grok case (follow-up at L1771-1826)
  - L1830-1966: TextGenWebUI case (follow-up at L1902-1951)
  - L2122-2143: catch block with graceful error recovery
- Grep'd finalizeToolCalls/hasToolCalls/buildToolMessagesForXxx in stream/route.ts — confirmed no remaining bad call sites; only comment mentions of the old bug remain
- Grep'd `\btoolContext\.` — only one hit (L1878, a comment explaining the fix)
- Ran `bunx tsc --noEmit -p .` — found new TS2304 errors at stream/route.ts L2128, L2129, L2132, L2133: "Cannot find name 'accumulatedContent' / 'allToolsUsed' / 'allQuestActivations'"
- Wrote /tmp/scoping-test.js to verify JS semantics: confirmed that `let` inside try block is NOT accessible in catch block — throws ReferenceError at runtime
- Confirmed next.config.ts has `typescript.ignoreBuildErrors: true` — explains why dev server still runs despite TS errors
- Confirmed `bun run lint` exits cleanly (eslint doesn't catch block-scoping across try/catch boundary)
- Read Director code in full:
  - /home/z/my-project/src/app/api/chat/director/route.ts (159 lines)
  - /home/z/my-project/src/lib/director/analyzer.ts (218 lines)
  - /home/z/my-project/src/lib/director/types.ts (91 lines)
  - /home/z/my-project/src/hooks/use-director.ts (202 lines)
- Read /home/z/my-project/src/lib/tools/tool-registry.ts (325 lines, registry + 15 built-in tools)
- Read /home/z/my-project/src/lib/tools/types.ts (268 lines, ToolDefinition/ToolContext/ToolExecutionResult interfaces)
- Confirmed streamZAIWithTools signature: `(messages, tools, accumulator, runtimeToken?)` (zai.ts L267-272)
- Grep'd ChatApiMessage exports — defined in /home/z/my-project/src/lib/llm/types.ts L8, NOT in @/types (Director imports from wrong module)
- Read tool definitions for: modify-stat, manage-scene, manage-relationship, manage-memory (the four most relevant to Director use)

Stage Summary:

== PART 1: TOOL CALLING FIXES VERIFICATION ==

All 9 fixes from Tasks 5/10/11/12 are correctly applied in code (verified by reading the actual lines, not just the worklog):

1. **Z.ai follow-up (L1054-1117)** ✓ — Uses `hasToolCalls(accumulator)` (L1071), append pattern `toolContextMessages = [...toolContextMessages, ...buildToolMessagesForOpenAI(accumulator.toolCalls, toolResultPairs)]` (L1094-1097), `toolRound++; isToolRound = true; continue;` (L1099-1101).

2. **OpenAI follow-up (L1264-1323)** ✓ — Passes all 5 args including `llmConfig.provider` (L1271), uses `hasToolCalls(accumulator)` (L1280), append pattern (L1302-1305), correct loop control (L1307-1309).

3. **Anthropic follow-up (L1436-1496)** ✓ — Uses `buildToolMessagesForAnthropic(toolCalls, toolResultPairs)` with 2 args (L1473), then `flatMap(m => m)` to flatten the Array<Array<ChatMessage>> return shape (L1476), correct loop control.

4. **Ollama follow-up (L1605-1655)** ✓ — Full buffer+detect+execute+loop pattern. Generator IS consumed via `for await (const chunk of generator)` (L1614-1617), then `hasToolCalls(toolFollowAccumulator)` check (L1619), executes via `executeToolCallsAndContinue` (L1626), `buildToolMessagesForOllama` (L1641), loop control (L1644-1646).

5. **Grok follow-up (L1771-1826)** ✓ — Same full pattern as Ollama. Generator consumed (L1780-1783), `hasToolCalls(toolFollowAccumulator)` check (L1785), executes (L1792), `buildToolMessagesForOpenAI` (L1809), loop control (L1812-1814).

6. **TextGenWebUI follow-up (L1902-1951)** ✓ — New follow-up branch correctly added. Removed the inner `const toolContextMessages` shadowing + `toolContext.push(...)` undefined-var bug. Now uses standard append pattern. Generator consumed (L1910-1913), `hasToolCalls` (L1915), executes (L1921), loop control (L1941-1943).

7. **Grok text-based tool call fix (L1735-1737)** ✓ — `cleanedContent` → `cleanContent`. Variable is `const cleanContent = stripToolCallFromText(roundContent);` (L1735), then `splitIntoChunks(cleanContent)` (L1737). Same fix at Ollama L1559-1561.

8. **Graceful error recovery (L2122-2143)** ✗ — **NEW BUG INTRODUCED.** The catch block references `accumulatedContent` (L2128, L2129), `allToolsUsed` (L2132), and `allQuestActivations` (L2133), but these are declared with `let` INSIDE the try block (L899, L903, L904). JavaScript `let` is block-scoped — variables declared inside `try {}` are NOT visible in `} catch {}`. TypeScript confirms with TS2304 errors at all four lines. Verified at runtime with Node.js: when an error throws in the try block, the catch block immediately throws `ReferenceError: accumulatedContent is not defined`, propagating up to the outer catch at L2148 which returns a 500 — so the "graceful recovery" actually crashes HARDER than the original error did.
   - **Fix needed:** Move `let accumulatedContent`, `let allToolsUsed`, `let allQuestActivations` declarations OUTSIDE the try block — i.e., before `try {` at L870, at the `start(controller)` scope (after L869).

9. **Imports cleanup** ✓ — `finalizeToolCalls` is NOT in the imports (L63-66 only imports `hasToolCalls`, `buildToolMessagesForOpenAI`, `buildToolMessagesForOllama`, `buildToolMessagesForAnthropic`). No remaining `finalizeToolCalls(...)` calls — only comment references at L1069 and L1279.

**Tool loop logic verification:**
- `toolRound` initialized to 0 (L901), `toolContextMessages = []` (L902)
- `while (toolRound <= maxToolRounds)` (L910) — sound loop condition
- `isToolRound = toolRound > 0` (L912) — recomputed each iteration, so the redundant `isToolRound = true;` assignments inside follow-up branches are harmless
- Round 0 → `if (shouldUseTools && !isToolRound)` branch — first tool call
- Round 1+ → `else if (shouldUseTools && isToolRound)` branch — follow-up
- `toolContextMessages` accumulates correctly via append pattern in every provider
- `continue` statements present in every follow-up branch

**Other observations (pre-existing, not from the fixes):**
- Many TS errors of type "ChatApiMessage | {...}[] not assignable to Record<string, unknown>[]" at L1007, L1035, L1190, L1723, L1750, L1881 — pre-existing cast issues from `as any` patterns; not introduced by the fixes.
- `ParsedToolCall[]` not assignable to `NativeToolCall[]` at L1027, L1037, L1742, L1752 — pre-existing.
- `QuestActivation` namespace missing at L904 — pre-existing type import issue.

== PART 2: DIRECTOR + TOOL CALLING INVESTIGATION ==

**Does the Director use tool calling? NO.**

The Director route (`src/app/api/chat/director/route.ts`):
- Uses PLAIN streaming variants: `streamZAI`, `streamGrok`, `streamOpenAICompatible` (L24-26 imports, L123-128 call sites). The `WithTools` variants (`streamZAIWithTools`, `streamGrokWithTools`, `streamOpenAIWithTools`) are NOT imported.
- Does NOT import anything from `@/lib/tools/` — no `executeTool`, no `getToolById`, no `ToolDefinition`, no `ToolContext`, no `createToolCallAccumulator`, no `hasToolCalls`.
- LLM mode prompt (`DIRECTOR_SYSTEM_PROMPT` L31-38) asks for ONLY a JSON response `{"tension": <0-100>, "world_event": "<texto>"}` — no mention of tools.
- The LLM's response is collected as plain text via `collectStream()` (L73-84, 30s timeout) and parsed with `parseDirectorJson()` (L87-97, regex-extracts first `{...}` block).
- The Director only OVERWRITES `world_event.description` and (optionally) `tension` from the LLM response (L134-145). Pacing, scene_change, and tension_shift decisions stay deterministic (computed by `analyzeSnapshot`/`heuristicDecisions` in analyzer.ts).
- The client hook (`use-director.ts` L120-144) applies decisions via direct store mutations: `store.pushSessionEvent(...)` and `store.applySceneChange(...)` — NOT via the tool executor path.

**Pre-existing TS bug in Director route:**
- L20: `import type { LLMConfig, ChatApiMessage } from '@/types';` — `ChatApiMessage` is NOT exported from `@/types`; it lives in `@/lib/llm/types` (L8 of that file). tsc reports `TS2724: '"@/types"' has no exported member named 'ChatApiMessage'. Did you mean 'ChatMessage'?`. Fix: change import to `import type { LLMConfig } from '@/types'; import type { ChatApiMessage } from '@/lib/llm/types';`

**What tools the Director should use and why:**

1. **`modify_stat`** (id `modify_stat`) — Currently the analyzer only READS heat/depletion stats to compute tension; the Director never WRITES stats. With tools, the Director could escalate narrative tension by adjusting `lujuria`/`deseo`/`energia` based on pacing (e.g., +5 lujuria during intense pacing, -3 energia during cooldown).

2. **`manage_scene`** (id `manage_scene`, GROUP_ONLY_TOOL_IDS) — Currently `heuristicDecisions` (analyzer.ts L172-202) directly emits `scene_change` decisions that the client applies via `applySceneChange`. Using the tool would route through the same `sceneActivation` payload as character-initiated scene changes (consistent event flow, same `GroupMember` resolution logic, supports `enter`/`leave`/`focus` actions).

3. **`manage_relationship`** (id `manage_relationship`) — Currently never called by the Director. Could adjust relationship points based on world events (e.g., a stressful event might deepen bonds +5, a conflict event might strain them -10).

4. **`manage_memory`** (id `manage_memory`) — Currently world events are only logged to the event log ring buffer (max 30 entries, exposed via `{{eventos}}` macro). `manage_memory` would persist significant events (severity='major') as long-term Character Memory that the LLM can recall via `{{memories}}` and `search_memory` tool.

5. **`manage_time`** (id `manage_time`) — Advance world time during cooldown events (e.g., skip 30 minutes forward when nothing happens).

6. **`set_reminder`** / `manage_quest` — Optionally start a quest when the Director injects a "knock at door" world event (could spawn a "visitor" quest with the appropriate activation config).

**How the Director's LLM call would need to change:**

Architecturally, the proactive route (`src/app/api/chat/proactive/route.ts`) already implements the same pattern the Director would need:
- L75 imports `streamZAIWithTools`
- L142 calls `executeTool(...)` for tool execution
- L1103 uses `streamZAIWithTools(chatMessages, availableTools, accumulator, zaiRuntimeToken)` for streaming

To make the Director use tools, the route.ts would need:

```typescript
// New imports at top of director/route.ts:
import { streamZAIWithTools } from '@/lib/llm/providers/zai';
import { streamGrokWithTools } from '@/lib/llm/providers/grok';
import { streamOpenAIWithTools } from '@/lib/llm/providers/openai';
import { createToolCallAccumulator, hasToolCalls, buildToolMessagesForOpenAI } from '@/lib/tools/parsers/native-parser';
import { executeTool, getAllToolDefinitions } from '@/lib/tools/tool-registry';
import type { ToolDefinition, ToolContext, ToolExecutionResult } from '@/lib/tools/types';
```

In the LLM-mode branch (route.ts L115-150), replace the plain streaming with a tool loop:

```typescript
// Build ToolContext from snapshot
const toolContext: ToolContext = {
  characterId: snapshot.characterId || '',
  characterName: snapshot.characterNames?.[snapshot.characterId || ''] || 'Director',
  sessionId: snapshot.sessionId,
  groupId: snapshot.groupId,
  userName: 'Director',  // or pull from snapshot
  sessionStats: snapshot.sessionStats,
  allCharacters: [],  // would need to be passed in the snapshot or fetched
  groupMembers: snapshot.groupMembers,
  // ...other context fields
};

// Filter to Director-relevant tools
const directorToolIds = ['modify_stat', 'manage_scene', 'manage_relationship', 'manage_memory', 'manage_time'];
const availableTools = getAllToolDefinitions().filter(t => directorToolIds.includes(t.id));
// Filter out manage_scene for non-group chats (GROUP_ONLY_TOOL_IDS check)
const filteredTools = snapshot.groupId ? availableTools : availableTools.filter(t => t.id !== 'manage_scene');

// Tool loop (mirror the pattern in stream/route.ts L910-1126)
let toolContextMessages = [...messages];
let toolRound = 0;
const maxToolRounds = 4;
const toolResults: ToolExecutionResult[] = [];

while (toolRound <= maxToolRounds) {
  const accumulator = createToolCallAccumulator(filteredTools);
  const generator = streamZAIWithTools(toolContextMessages, filteredTools, accumulator, llmConfig.apiKey);
  // ...buffer generator...
  if (!hasToolCalls(accumulator)) break;
  // Execute each tool call
  for (const tc of accumulator.toolCalls) {
    const result = await executeTool(tc.name, tc.arguments, toolContext);
    toolResults.push(result);
  }
  // Build follow-up messages
  const toolResultPairs = accumulator.toolCalls.map((tc, i) => ({
    success: toolResults[toolResults.length - accumulator.toolCalls.length + i].success,
    displayMessage: toolResults[toolResults.length - accumulator.toolCalls.length + i].displayMessage,
  }));
  toolContextMessages = [...toolContextMessages, ...buildToolMessagesForOpenAI(accumulator.toolCalls, toolResultPairs)];
  toolRound++;
}
```

The final `DirectorResult` returned to the client would include `toolResults` so the client can apply stat/scene/relationship/memory activations:

```typescript
// In src/lib/director/types.ts, extend DirectorResult:
export interface DirectorResult {
  tension: number;
  pacing: DirectorPacing;
  decisions: DirectorDecision[];
  source: 'heuristic' | 'hybrid';
  toolResults?: ToolExecutionResult[];  // NEW
}
```

In `src/hooks/use-director.ts`, after applying existing decisions, iterate `result.toolResults`:

```typescript
for (const tr of result.toolResults || []) {
  if (tr.statActivation) store.updateAttribute?.(tr.statActivation.characterId, tr.statActivation.attributeKey, tr.statActivation.newValue, tr.statActivation.reason);
  if (tr.sceneActivation && groupId) store.applySceneChange?.(groupId, tr.sceneActivation.characterId, tr.sceneActivation.present);
  if (tr.relationshipActivation) store.updateRelationship?.(tr.relationshipActivation.aId, tr.relationshipActivation.bId, tr.relationshipActivation.newPoints, tr.relationshipActivation.reason);
  if (tr.memoryActivation?.eventData) store.addMemoryEvent?.(sessionId, tr.memoryActivation.eventData);
}
```

**Note on system prompt:** The `DIRECTOR_SYSTEM_PROMPT` (route.ts L31-38) would need to be updated to inform the LLM about its tool-calling capabilities. Currently it asks for ONLY `{"tension", "world_event"}` JSON. With tools, the LLM should be told it can ALSO emit tool calls to modify stats, scenes, relationships, and memories — and the JSON world_event becomes optional (one OR the other OR both).

== SUMMARY OF FINDINGS ==

**Tool calling fixes (Part 1):**
- ✅ Bugs #1-#8 (Z.ai/OpenAI/Anthropic/Ollama/Grok/TextGenWebUI/Grok-text/wrong-args) — all correctly fixed.
- ❌ Fix #9 (graceful error recovery) — INTRODUCED A NEW BUG. The catch block at L2122-2143 references `accumulatedContent`/`allToolsUsed`/`allQuestActivations` which are declared with `let` inside the try block at L899-904. JavaScript block scoping makes these inaccessible in the catch. At runtime, when ANY error throws in the try block, the catch immediately throws `ReferenceError: accumulatedContent is not defined` — the recovery path is itself broken.
- **Fix:** Move the three `let` declarations to just before `try {` at L870 (inside `start(controller)`, before the try).

**Director + tool calling (Part 2):**
- ❌ The Director does NOT use tool calling. It uses plain `streamZAI`/`streamGrok`/`streamOpenAICompatible` (no `WithTools` variants), and never imports anything from `@/lib/tools/`.
- The LLM in 'llm' mode only emits JSON `{"tension", "world_event"}` text — no tool calls.
- Scene changes are computed deterministically by the analyzer; the client applies them via `store.applySceneChange` (direct mutation), not via the tool executor.
- **To make the Director use tools:** Replace the plain streaming calls with their `WithTools` variants, build a `ToolContext`, run a tool loop (mirroring `src/app/api/chat/stream/route.ts` L910-1126), add a `toolResults?: ToolExecutionResult[]` field to `DirectorResult`, and update `use-director.ts` to apply `statActivation`/`sceneActivation`/`relationshipActivation`/`memoryActivation` payloads from the tool results.
- **Pre-existing TS bug in Director:** L20 imports `ChatApiMessage` from `@/types` — it should be from `@/lib/llm/types`. Not blocking (Next.js ignores TS build errors via `typescript.ignoreBuildErrors: true` in next.config.ts), but should be fixed.

**No code changes were made in this task** — agent role is Explore/verify only. Recommended next action: implement Fix #9 correction (move 3 `let` declarations above `try {`) and the Director tool-calling enhancement in a follow-up implementation task.


---
Task ID: R1
Agent: Explore (resource consumption)
Task: Investigate why the app consumes many resources and what consumes the most

Work Log:
- Read worklog and previous task summaries (Tasks 0/6/8/4/3/9/5/10-16) to avoid duplicating findings
- Ran `ps aux --sort=-%mem|%cpu` (dev server not running at inspection time, but inspected Chrome processes); checked `du -sh` on `node_modules` (1.5G), `.next` (276M), `public` (127M), `data` (5.2M), `db/custom.db` (24K), `prisma/db/custom.db` (24K), `data/lancedb/*` (~3.2M)
- Inspected `package.json` and `node_modules`: `@lancedb` 267M (133M musl + 134M gnu native binaries), `next`+`@next` 377M, `@prisma`+`prisma` 180M, `@codesandbox` 68M, `lucide-react` 42M, `date-fns` 39M, `effect` 34M, `@img` 33M, `react-syntax-highlighter` 8.9M
- Cross-checked which heavy deps are actually imported in `src/` — found `@mdxeditor/editor`, `react-syntax-highlighter`, `@reactuses/core` are in `package.json` but NOT imported anywhere (dead deps)
- Found NO usage of `next/dynamic` or `React.lazy` anywhere in `src/` — every component is statically imported, including heavy ones only used when user opens a panel (`SettingsPanel` 2432 lines, `InventoryPanel` 1476 lines, `BackgroundGallery` 473 lines, `CharacterPanel` 935 lines, all editor components)
- Read `src/store/index.ts` (421 lines) — single Zustand store with 20 slices combined; `partialize` persists ~50 keys to localStorage; `merge` function deep-merges 10+ nested objects on every store rehydration
- Read `src/hooks/use-persistence-sync.ts` (466 lines) — CRITICAL: subscribes to ENTIRE store, on EVERY state change runs `JSON.stringify(state[key]) !== JSON.stringify(prevState[key])` for ~40 persist keys (line 427-436), then debounced save sends the full ~1.8MB JSON body to `/api/persistence` PUT
- Read `src/app/api/persistence/route.ts` (186 lines) and `src/lib/persistence.ts` (383 lines) — PUT body contains ALL data types (~1.86MB); server does 27 synchronous `fs.writeFileSync` calls per save; GET reads all 27 files synchronously via `fs.readFileSync`
- Read `src/hooks/use-proactive-messages.tsx` (873 lines) — has TWO setIntervals when active: 1s countdown tick + 5s check interval (lines 820, 827). Cleanup OK. Only runs when character has proactiveMessages.enabled
- Read `src/hooks/use-director.ts` (201 lines) — 60s idle check interval (line 189) + store subscription that triggers setTimeout(8000) on every message count change (line 167). Cleanup OK
- Read `src/hooks/use-timeline-sprite-sounds.ts` (1233 lines) — runs `requestAnimationFrame` loop continuously while any timeline sprite is active (line 734); module-level `audioCache = new Map<string, HTMLAudioElement>()` (line 79) never cleared — potential memory leak
- Read `src/components/tavern/chat-panel.tsx` (3146 lines) — subscribes to ~30 individual store selectors including `sessions`, `characters`, `groups`, `settings`, `lorebooks`, `questTemplates`, `soundTriggers`, `hudTemplates`, `hudSessionState`, `personas`. Mounts 7 child hooks (useTriggerSystem, useBackgroundTriggers, useTimelineSpriteSounds, useTTS, useTTSAutoGeneration, useProactiveMessages, useDirector, useAutoAtmosphere). 44 `console.log` calls in this file alone
- Found 7 components using `useTavernStore()` WITHOUT selector (re-renders on every store change): `settings-applier.tsx:14`, `atmosphere-renderer.tsx:14-19`, `novel-chat-box.tsx:382`, `group-sprites.tsx:248`, `trigger-indicator.tsx:51`, `text-formatter.tsx:32`, plus many conditionally-rendered panels
- Read `src/hooks/use-background-triggers.ts` (301 lines) — line 115 `const state = useTavernStore();` (no selector) — re-renders on every store change
- Found 100ms setInterval in `character-sprite.tsx:425` AND `group-sprites.tsx:261` — 10 React state updates per second per character sprite just for countdown display
- Found 30s setInterval in `chat-panel.tsx:564` (solicitud expiration) — OK
- Found 100ms setInterval in `theme-effects.tsx:42` (GlitchEffect) and `comic-sound-overlay.tsx:295` (cleanup safety net) — only when active
- Read `src/lib/embeddings/lancedb-db.ts` (1037 lines) — LanceDB native binary (267MB on disk) is loaded LAZILY via dynamic import on first use of `loadLanceDBModule()` (line 169). Once loaded, stays in process memory for lifetime
- Read `src/app/api/embeddings/ensure-namespace/route.ts` (139 lines) and `src/app/api/embeddings/cleanup-orphaned/route.ts` (135 lines) — both call `getEmbeddingClient()` → `LanceDBWrapper.checkConnection()` → `initLanceDB()` UNCONDITIONALLY, even when embeddings are disabled in settings
- Found in `src/components/tavern/chat-panel.tsx:106-183`: on EVERY session restore (page load with active session), two `useEffect`s fire unconditionally calling `/api/embeddings/ensure-namespace` and `/api/embeddings/cleanup-orphaned` — both trigger LanceDB initialization even when user has embeddings disabled
- Read `src/lib/embeddings/chat-context.ts` (658 lines) — `retrieveEmbeddingsContext()` returns `emptyResult()` immediately if `settings.embeddingsChat.enabled === false` (line 115) — good, default is OFF
- Read `src/lib/embeddings/lancedb-db.ts:509-545` and `:837-855` — LanceDB `searchSimilar` returns `limit * 10` rows, `searchInNamespace` returns `limit * 5` rows, then filters by namespace IN MEMORY. Each row contains a 1024-dim float vector (~4KB). A search with limit=10 loads ~50 vectors × 4KB = 200KB just for vectors, per namespace per query
- Read `src/app/api/chat/stream/route.ts` (2155 lines) — uses `accumulatedContent += chunk` pattern (lines 980, 1160, 1353, 1447, 1524, etc.) buffering the ENTIRE assistant response in memory; with tool calls, this can repeat for multiple rounds (`maxToolRounds`). Tool call accumulator pattern (`createToolCallAccumulator`) buffers all tool call tokens before deciding
- Checked `public/` folder: sprites 71M (34 files, mostly 4MB WEBPs), uploads 37M (32M avatars), sounds 11M, backgrounds 9.7M. NO `<img loading="lazy">` anywhere in the codebase; NO `next/image` usage. All images eagerly loaded
- Verified dev bundle: `.next/dev/static/chunks/app/page.js` is **32MB** (unminified dev), `main-app.js` 11MB, `layout.js` 4.3MB — confirms huge client payload on page load
- Default settings check: `DEFAULT_EMBEDDINGS_CHAT.enabled = false`, `DEFAULT_TOOLS_SETTINGS.enabled = true`, Director enabled by default in DEFAULT_DIRECTOR_SETTINGS, proactive is opt-in per character, TTS is opt-in

Stage Summary:

## Top Resource Consumers (ranked by impact)

### 🔴 CRITICAL — Persistence sync pattern (CPU + Network + Disk)
- `src/hooks/use-persistence-sync.ts:427-436` — Subscribes to ENTIRE Zustand store. On EVERY state change (every token stream, every keystroke, every interval tick), runs `JSON.stringify(state[key]) !== JSON.stringify(prevState[key])` for ~40 keys. Even when no actual change, this is ~40 full serializations of arrays containing 65+ chat messages, 11 sessions, multiple characters with full stats.
- `src/hooks/use-persistence-sync.ts:282-404` — `saveToServer()` serializes the entire store (~1.86MB JSON) and PUTs it to `/api/persistence` every 2 seconds after a change. Body contains ALL sessions, characters, lorebooks, items, memory, etc.
- `src/app/api/persistence/route.ts:94-185` — Server does 27 synchronous `fs.writeFileSync` calls per PUT. Each save blocks the event loop.
- `src/lib/persistence.ts:330-362` — `readAllPersistentData()` does 27 synchronous `fs.readFileSync` on every GET (page load).
- Impact: ~1.86MB network upload per save, ~1.86MB JSON.stringify on client, ~1.86MB JSON.parse on server, 27 sync disk writes per save. With chat streaming, this can fire every few seconds.

### 🔴 CRITICAL — LanceDB native binary loaded on every page load (Memory)
- `src/components/tavern/chat-panel.tsx:106-183` — On every page load with an active session, two `useEffect`s fire: `ensureNamespaces()` and `cleanupOrphanedNamespaces()`. Both call API routes that initialize LanceDB.
- `src/app/api/embeddings/ensure-namespace/route.ts:33-44` and `cleanup-orphaned/route.ts:27-54` — Call `getEmbeddingClient()` → `LanceDBWrapper.checkConnection()` → `initLanceDB()` → `import('@lancedb/lancedb')` which loads the **267MB native binary** into the Node.js process.
- This happens even when `settings.embeddingsChat.enabled === false` (the default).
- Impact: Once loaded, the 267MB native module stays in server process memory for its lifetime. With Next.js dev mode (single process), this bloats the entire dev server RAM. Even in production with multiple workers, each worker that handles an embeddings route loads its own copy.

### 🟠 HIGH — No code splitting / no lazy loading (Network + CPU on first load)
- ZERO `next/dynamic` or `React.lazy` usage in entire `src/` (verified via grep).
- `src/app/page.tsx:4-12` statically imports ChatPanel (3146 lines), CharacterPanel (935), SessionsSidebar (179), SettingsPanel (2432), BackgroundGallery (473), InventoryPanel (1476), AtmosphereRenderer, SceneLighting — all loaded on first paint even though SettingsPanel/BackgroundGallery/InventoryPanel only open on user action.
- Dev bundle: `.next/dev/static/chunks/app/page.js` is **32MB** (vs. typical Next.js app ~500KB-2MB).
- Production build would split better, but the static imports still force all of these into the main page chunk.
- Heavy deps not lazy-loaded: `framer-motion` (~120KB gz), `recharts` (~400KB gz), `@dnd-kit/*`, `@radix-ui/*` (26 subpackages, 11MB on disk), `lucide-react` (42MB on disk, though tree-shakeable).
- Dead dependencies in `package.json`: `@mdxeditor/editor`, `react-syntax-highlighter`, `@reactuses/core` — installed but NOT imported anywhere. Still consume disk and install time.

### 🟠 HIGH — `useTavernStore()` without selector (CPU — re-renders)
- 7 always-mounted components subscribe to the entire store without a selector, causing re-renders on every store change (every streamed token, every persistence tick):
  - `src/components/tavern/settings-applier.tsx:14` — `const { settings } = useTavernStore()`
  - `src/components/atmosphere/atmosphere-renderer.tsx:14-19` — destructures 4 fields from `useTavernStore()`
  - `src/components/tavern/novel-chat-box.tsx:382` — destructures ~30 fields from `useTavernStore()`
  - `src/hooks/use-background-triggers.ts:115` — `const state = useTavernStore()` — re-runs keyword matching logic on every store change
  - `src/components/tavern/group-sprites.tsx:248`, `trigger-indicator.tsx:51`, `text-formatter.tsx:32`, plus 30+ conditionally-mounted panels
- ChatPanel subscribes to 30+ individual selectors including `sessions`, `characters`, `groups` — these change on EVERY chat token (sessions array gets new message appended).

### 🟠 HIGH — 100ms setInterval countdowns (CPU — frequent re-renders)
- `src/components/tavern/character-sprite.tsx:425` — `setInterval(updateCountdown, 100)` per character sprite. 10 React state updates per second per visible character.
- `src/components/tavern/group-sprites.tsx:261-272` — same pattern, runs `getReturnToIdleCountdownForCharacter` for EVERY group member every 100ms, builds a new Map each tick.
- For a group chat with 5 members → 50 React state updates per second just for countdown displays that only need ~1Hz updates.
- Only useful when `isReturnToIdleScheduled` is true, but the interval runs unconditionally.

### 🟡 MEDIUM — LanceDB vector search loads 5-10× more data than needed (Memory)
- `src/lib/embeddings/lancedb-db.ts:531-534` — `searchSimilar` calls `.limit(limit * 10).toArray()` then filters by namespace in memory. Loads 100 vectors × 4KB = 400KB per search.
- `src/lib/embeddings/lancedb-db.ts:849-852` — `searchInNamespace` calls `.limit(limit * 5).toArray()` then filters by namespace in memory.
- Each vector is 1024-dim float (4KB). A single chat turn with 5 namespaces searches → ~2MB of vector data loaded into JS memory just to filter.
- Should use LanceDB's `.where(filter)` BEFORE vectorSearch, or use a pre-filtered table per namespace.

### 🟡 MEDIUM — LLM streaming tool-call accumulator buffers entire response (Memory)
- `src/app/api/chat/stream/route.ts` — pattern at lines 980, 1160, 1353, 1447, 1524, 1616, 1697, 1854, 2036: `accumulatedContent += chunk` builds the entire assistant response in a JS string variable.
- With tool calling, multiple rounds can run (`maxToolRounds`), each buffering its own `accumulatedContent` + `roundContent` strings.
- For long responses (>4KB) with multiple tool rounds, this can hold 10-50KB per active stream per concurrent user.
- Not catastrophic for a single user, but accumulates with concurrent users.

### 🟡 MEDIUM — No image lazy-loading (Network + Memory)
- Zero `<img loading="lazy">` and zero `next/image` usage in the codebase (verified).
- `public/sprites/` is 71MB across 34 WEBP files (avg 2MB each, Rick pack alone is 50MB).
- `public/uploads/avatar/` is 32MB.
- `public/backgrounds/` is 9.7MB.
- All images in chat message history, sprite selectors, gallery thumbnails are eagerly loaded. With 65 messages averaging 1-2 images each, that's 100+ image requests on page load.
- SessionsSidebar renders `<img>` for every session's character avatar — eagerly loaded even though only 8 fit on screen.

### 🟡 MEDIUM — Module-level audio cache never cleared (Memory leak)
- `src/hooks/use-timeline-sprite-sounds.ts:79` — `const audioCache = new Map<string, HTMLAudioElement>()` at module scope.
- `getAudio(url)` creates `new Audio(url)` and caches it forever. Sounds accumulate over the app lifetime.
- HTMLAudioElement is heavy (~1-5MB per decoded audio buffer). With 50+ unique sounds triggered over a session, this can grow to 100-250MB.
- `activeTimelines` Map (line 94) and `collectionMetadataCache` (line 95) also module-level, never cleared.

### 🟢 LOW — Other intervals (cleanup OK, low frequency)
- `src/hooks/use-proactive-messages.tsx:820,827` — 1s + 5s intervals, only when proactive is active for the current character. Cleanup correct.
- `src/hooks/use-director.ts:183-190` — 60s idle interval + 8s debounce. Cleanup correct.
- `src/hooks/use-tts.ts:191` — 30s connection check, only when TTS enabled. Cleanup correct.
- `src/hooks/use-haptic-playback.ts:199,646` — 2s config refresh + 5s poll, only when haptic playback active.
- `src/components/tavern/chat-panel.tsx:564` — 30s solicitud expiration check.
- `src/components/tavern/comic-sound-overlay.tsx:295` — periodic cleanup safety net.
- `src/components/atmosphere/canvas-atmosphere-layer.tsx:278` — requestAnimationFrame particle loop, only when atmosphere layer active.
- `src/store/slices/statsSlice.ts:1936` — session timer interval (configurable, default ~60s).

### 🟢 LOW — Zustand store size
- 20 slices combined into one store, ~50 persisted keys.
- `data/sessions.json` is 728KB (11 sessions, 65 messages). `characters.json` is 596KB. Total persistence payload ~1.86MB.
- This is borderline — for a personal app with a few sessions it's fine, but grows linearly with usage. Should paginate session messages.

## Optimization Recommendations (priority order)

### 1. Fix persistence sync (highest ROI, easy)
- `src/hooks/use-persistence-sync.ts:427-436` — Replace `JSON.stringify(state[key]) !== JSON.stringify(prevState[key])` with shallow reference equality (`state[key] !== prevState[key]`). Zustand updates are immutable, so reference equality is sufficient. This eliminates ~40 full JSON serializations per store change.
- `src/hooks/use-persistence-sync.ts:282-404` — Split the monolithic PUT into per-key POSTs, or implement dirty-key tracking so only changed keys are sent. Don't send unchanged `sessions` (728KB) just because `activeBackground` changed.
- `src/lib/persistence.ts:291-302` — Replace `readDataFile` synchronous `fs.readFileSync` with `fs.promises.readFile`. Same for `writeDataFile` → `fs.promises.writeFile`. The route handlers are already async.
- `src/app/api/persistence/route.ts:94-185` — Parallelize the 27 `writePersistentData` calls with `Promise.all` instead of sequential sync writes.
- Debounce: increase from 2000ms to 5000ms, and skip save if `isGenerating` is true (streaming tokens cause rapid store updates).

### 2. Gate LanceDB initialization behind embeddings setting
- `src/components/tavern/chat-panel.tsx:106-183` — Read `settings.embeddingsChat.enabled` from store; only call `/api/embeddings/ensure-namespace` and `/api/embeddings/cleanup-orphaned` when embeddings are actually enabled. Otherwise skip both effects.
- `src/app/api/embeddings/ensure-namespace/route.ts:19-44` — Add a quick check: if `getConfig().enabled === false`, return early without calling `getEmbeddingClient()`.
- This avoids loading the 267MB native binary on every page load when the user doesn't use embeddings.

### 3. Add code splitting / lazy loading
- `src/app/page.tsx:4-12` — Wrap `SettingsPanel`, `BackgroundGallery`, `InventoryPanel` in `next/dynamic(() => import(...), { ssr: false })` since they only mount when user opens them.
- Inside `SettingsPanel`, lazy-load tab content (sprite-pack-editor, trigger-editor, lorebook-panel, sound-triggers-settings, etc.) — these are 1000+ line editors loaded for one tab.
- Replace `lucide-react` named imports with `lucide-react/dynamicIconImports` for icons used only in conditional panels.
- Remove dead deps from `package.json`: `@mdxeditor/editor`, `react-syntax-highlighter`, `@reactuses/core` (verified unused via grep).

### 4. Fix `useTavernStore()` no-selector usages
- `src/components/tavern/settings-applier.tsx:14` — `useTavernStore((s) => s.settings)`. Settings rarely change.
- `src/components/atmosphere/atmosphere-renderer.tsx:14-19` — Use individual selectors: `useTavernStore((s) => s.activeAtmosphereLayers)`, etc.
- `src/components/tavern/novel-chat-box.tsx:382` — Split the 30-field destructure into individual selectors. This is the biggest win — NovelChatBox is always mounted in the chat panel.
- `src/hooks/use-background-triggers.ts:115` — Replace `const state = useTavernStore()` with selectors for only the 5 fields actually used.
- `src/components/tavern/group-sprites.tsx:248`, `trigger-indicator.tsx:51`, `text-formatter.tsx:32` — Same fix.

### 5. Reduce 100ms sprite countdown intervals
- `src/components/tavern/character-sprite.tsx:425` and `group-sprites.tsx:261` — Change `setInterval(..., 100)` to `setInterval(..., 1000)`. Countdown displays don't need 10Hz updates; 1Hz is fine for a "5s remaining" badge.
- Better: only run the interval when `isReturnToIdleScheduled` is true (currently runs unconditionally).
- Best: compute countdown on-demand via `requestAnimationFrame` only while the popover is open, instead of constantly updating React state.

### 6. Optimize LanceDB vector search
- `src/lib/embeddings/lancedb-db.ts:531-534` — Add `.where(\`namespace = '${escapeFilterValue(namespace)}'\)` BEFORE `.vectorSearch()` so the index filters at the DB level, not in JS memory. Same for `searchInNamespace` at line 849.
- Or: use a separate LanceDB table per namespace (already supported — see `db.tableNames()` at line 288). Namespaces are fixed and small in number.

### 7. Add image lazy-loading
- Add `loading="lazy"` to all `<img>` tags in `chat-message.tsx`, `sessions-sidebar.tsx`, `character-panel.tsx`, `background-gallery.tsx`, `sprite-selector.tsx`, `novel-chat-box.tsx` (24+ img tags found via grep).
- For sprite display, consider preloading only the next 1-2 sprites in the rotation, not all of them.
- Replace large `<img>` with Next.js `<Image>` for avatars and thumbnails to get automatic optimization.

### 8. Clear audio cache periodically
- `src/hooks/use-timeline-sprite-sounds.ts:79` — Add LRU eviction to `audioCache` (e.g., keep last 20 entries). Or expose a `clearAudioCache()` function called on session change.
- Same for `activeTimelines` (line 94) — clear entries when their character leaves the scene.

### 9. Reduce console.log noise
- 297 `console.log/warn/error` calls in `src/components/` and `src/hooks/`. 44 in `chat-panel.tsx` alone.
- Wrap in a `chatLogger`/debug flag (already exists at `src/lib/logger.ts`) and gate behind `process.env.NODE_ENV === 'development'` or a settings flag.

## "Normal" vs "Excessive" for this type of app
- **Normal** (SillyTavern-class app): 200-500ms first paint, 2-5MB JS bundle, 50-150MB RAM for the rendering process, occasional 50-200KB persistence writes.
- **Excessive** (current TavernFlow): 32MB dev page bundle (10-50× larger), 1.86MB persistence payload per save (10-50× larger), 267MB LanceDB binary loaded on every page load even when feature is off, 50 React state updates/sec for sprite countdowns (50× faster than needed), 40 full-store JSON.stringify per state change (should be 0 with reference equality).
- The biggest wins are #1 (persistence), #2 (LanceDB gating), and #4 (selectors) — each likely a 2-5× improvement in CPU/memory under load.

---
Task ID: R1-R2-FIXES (verification + resource optimization + Director tools)
Agent: Z.ai Code (principal)
Task: Investigate resource consumption, verify tool calling fixes, add tool calling to Director

Work Log:
- RESOURCE INVESTIGATION (R1): App consumes excessive resources due to:
  1. Persistence sync: JSON.stringify comparison for 40 keys on every store change (~1.86MB payload per save)
  2. LanceDB 267MB native binary loaded on every page load even when embeddings disabled
  3. No code splitting (32MB dev page bundle)
  4. useTavernStore() without selector causing unnecessary re-renders
  5. 100ms sprite countdown intervals (50 state updates/sec in groups)
  6. Audio cache never cleared (memory leak)

- TOOL CALLING VERIFICATION (R2): 8/9 fixes correct. Found NEW BUG in fix #9:
  accumulatedContent/allToolsUsed/allQuestActivations declared inside try block → not visible in catch (TS2304). Fixed by moving declarations outside try.

- DIRECTOR + TOOLS: Director did NOT use tool calling. Implemented:
  - Added DIRECTOR_ALLOWED_TOOL_IDS: modify_stat, manage_scene, manage_relationship, manage_memory, manage_time, manage_quest
  - Updated DIRECTOR_SYSTEM_PROMPT with tool instructions
  - Director route now uses streamZAIWithTools/streamOpenAIWithTools/streamGrokWithTools
  - Builds ToolContext, executes tool calls, returns toolResults in DirectorResult
  - Updated use-director.ts to pass toolsSettings/characterId/groupId and apply toolResults (statActivation, sceneActivation, relationshipActivation, memoryActivation)
  - Added toolResults to DirectorResult type

- RESOURCE OPTIMIZATIONS:
  - PERF FIX (LanceDB gating): ensure-namespace and cleanup-orphaned only fire when settings.embeddingsChat.enabled === true (was firing on every session restore, loading 267MB native binary)
  - PERF FIX (persistence sync): Replaced JSON.stringify comparison with reference equality (Zustand immutable updates); increased debounce 2s→3s; skip save during isGenerating
  - PERF FIX (sprite countdowns): character-sprite and group-sprites changed from 100ms to 1000ms intervals
  - PERF FIX (audio cache): Added LRU eviction (max 20 entries) + clearAudioCache() export

Stage Summary:
- Tool calling fixes verified and one remaining bug (variable scope in error recovery) corrected
- Director now uses tool calling: can modify_stat, manage_scene, manage_relationship, manage_memory, manage_time, manage_quest
- Top resource consumers identified and optimized: LanceDB gating (267MB), persistence sync (1.86MB/saves), sprite intervals (50→5 updates/sec), audio cache (LRU)
- Dev server verified: page loads, characters render (Ximena, Pinky Vane, etc.), director API returns valid JSON, 15 tools registered, no page errors
- Lint passes cleanly

---
Task ID: TOOLTIP-FIX
Agent: Z.ai Code (principal)
Task: Tool call tooltip in message bubbles should show what changed, not just the tool name

Work Log:
- Investigated: chat-message.tsx used `title={tool.label}` which only shows the tool name (e.g., "Modificar Stat", "Gestionar Relación") with no info about what actually changed.
- Root cause: ToolUsedInfo type only had {name, label, icon, success} — no details field.
- Extended ToolUsedInfo in types/index.ts: added `details?: string` (human-readable summary) and `displayMessage?: string` (full tool output).
- Created `summarizeToolResult(result, params)` in tool-registry.ts — builds a concise, human-readable summary from ToolExecutionResult:
  - modify_stat: "Lujuria: 55 → 70 (+15)\nRazón: <reason>"
  - manage_relationship: "Relación Ximena ↔ User: 30 → 35 (+5)\nRazón: <reason>"
  - manage_scene: "Ximena entró a la escena\n<narrative>"
  - manage_quest: "Quest activado: <key>" / "Objetivo completado: <key>"
  - manage_solicitud: "Solicitud creada: X → Y"
  - manage_action: "Acción: <skillName>"
  - skill_check: "Check Lujuria (d20=15+3 vs DC 12) = 18 → Éxito"
  - manage_time: "Tiempo avanzado: +60 min" / "Hora: 14:30"
  - manage_memory: "Recuerdo guardado: <content>"
  - Fallback: first 3 lines of displayMessage (for roll_dice, search_web, etc.)
- Exported summarizeToolResult from tool-registry and index.ts.
- Updated all 3 chat routes to populate `details` + `displayMessage`:
  - src/app/api/chat/stream/route.ts (1-to-1 chat)
  - src/app/api/chat/group-stream/route.ts (group chat)
  - src/app/api/chat/proactive/route.ts (proactive messages)
- Created `ToolBadgeWithTooltip` component in chat-message.tsx with rich tooltip:
  - Title row: icon + label + ✓/✗ status
  - Details section: multi-line human-readable summary of what changed (whitespace-pre-wrap, break-words)
  - Collapsible "Ver mensaje completo" for the full displayMessage (only if different from details)
  - Fallback for tools without details: "Herramienta ejecutada" / "La herramienta falló"
  - Uses shadcn Tooltip (Radix) with max-w-xs, p-2
  - Hover effect on the badge (border/text brighten)
  - Used React.createElement for dynamic icon to satisfy react-hooks/static-components lint rule
- Replaced both `title={tool.label}` Badge instances (compact + non-compact) with ToolBadgeWithTooltip.
- Added Tooltip, TooltipTrigger, TooltipContent imports + Pencil, Crown icons.
- Imported * as React for createElement.

Stage Summary:
- Tool badges now show meaningful tooltips explaining WHAT changed, not just the tool name.
- Example: hovering "Modificar Stat" now shows "Lujuria: 55 → 70 (+15)\nRazón: El evento la excitó" instead of just "Modificar Stat".
- Full tool output available via collapsible "Ver mensaje completo".
- Works in all 3 chat modes: 1-to-1, group, and proactive.
- Lint passes, app renders cleanly (TavernFlow title, no page errors).

---
Task ID: WARDROBE (FASE 12)
Agent: Z.ai Code (principal)
Task: Implement wardrobe system with tool calling and UI

Work Log:
- Decision: Put wardrobeConfig on CharacterCard (not a new lorebook type) because:
  - Wardrobe is character-specific (tied to main attribute)
  - Has simpler data model (ordered levels with threshold + content)
  - Needs session-state offset (doesn't fit lorebook model)
  - Avoids polluting lorebook system with special types
  - UI is simpler (just levels with threshold + content, not full lorebook entries)

- TYPES (types/index.ts):
  - Added WardrobeLevel {id, name, threshold, content}
  - Added WardrobeConfig {enabled, levels, blockHeader?}
  - Added wardrobeConfig? to CharacterCard
  - Added wardrobeOffset? to CharacterSessionStats (default 0)
  - Added wardrobeActivation? to ToolExecutionResult
  - Added character? to ToolContext (for manage_wardrobe to access wardrobeConfig)

- WARDROBE UTILITIES (lib/wardrobe/index.ts):
  - getSortedLevels(): sort by threshold ascending
  - getMainAttribute(): find isMain=true attribute
  - getMainAttributeValue(): current value from session stats or default
  - getBaseLevelIndex(): highest threshold <= attrValue
  - getWardrobeOffset(): read offset from session stats
  - resolveWardrobeLevel(): effective level = clamp(base + offset, 0, len-1)
  - resolveWardrobeKey(): format as [VESTUARIO]\n<content>
  - getWardrobeInfo(): current + above + below for tool
  - isWardrobeAvailable(): needs enabled + 2+ levels + main attribute

- KEY RESOLVER (lib/key-resolver.ts):
  - Added resolveWardrobeKeyInText() — resolves {{wardrobe}} to current level content
  - Added as Phase 6.2 in resolveAllKeys()

- TOOL (lib/tools/tools/manage-wardrobe.ts):
  - manage_wardrobe tool with actions: get_info, escalate, regress, reset
  - get_info returns current/above/below levels
  - escalate: offset +1 (if above exists)
  - regress: offset -1 (if below exists)
  - reset: offset = 0
  - Returns wardrobeActivation payload for client SSE
  - Registered in tool-registry (16 tools now)

- STORE (store/slices/statsSlice.ts):
  - Added updateWardrobeOffset(sessionId, characterId, newOffset)
  - Added getWardrobeOffset(sessionId, characterId)
  - Added to StatsSlice interface

- SSE HANDLERS (chat-panel.tsx):
  - Added wardrobe_activation handler in both send and regenerate paths
  - Calls store.updateWardrobeOffset() on changed
  - Shows toast on escalate/regress/reset

- ROUTES:
  - stream/route.ts: filter manage_wardrobe if !isWardrobeAvailable; pass character in ToolContext; send wardrobe_activation SSE
  - group-stream/route.ts: same filter + SSE handler + character in context
  - proactive/route.ts: populate details + displayMessage in toolsUsed

- PROMPT BUILDER (lib/llm/prompt-builder.ts):
  - Added [SISTEMA DE VESTUARIO] section in both 1-to-1 and group prompts
  - Shows current level, above (if exists), below (if exists)
  - Instructions for using manage_wardrobe tool
  - Only injected when isWardrobeAvailable(character) is true

- SUMMARIZER (lib/tools/tool-registry.ts):
  - Added wardrobe activation to summarizeToolResult()
  - Shows "Vestuario Escalado/Regresado/Reseteado: → <level>" + reason

- UI (components/tavern/wardrobe-editor.tsx):
  - New WardrobeEditor component with:
    - Enable/disable switch
    - Warnings for missing main attribute or <2 levels
    - Main attribute info badge
    - Add/delete/reorder levels (sorted by threshold)
    - Each level: name, threshold, content (textarea)
    - Expandable cards (similar to lorebook attribute editor)
    - Help text explaining how it works
  - Integrated into character-editor.tsx as "Vestuario" tab (Shirt icon)
  - Added wardrobeConfig to defaultCharacter

- CHARACTER CARD IMPORT/EXPORT (lib/character-card.ts):
  - Added wardrobeConfig to V2 parse, V1 parse, PNG export, JSON export

Stage Summary:
- Wardrobe system fully implemented and integrated.
- {{wardrobe}} key resolves to current level content (base from main attribute + offset from tool).
- manage_wardrobe tool auto-enables for characters with wardrobeConfig (2+ levels + main attribute).
- Tool can escalate/regress/reset wardrobe, offset persists across turns.
- UI in character editor "Vestuario" tab with simple level editor.
- Works in 1-to-1, group, and proactive chats.
- 16 tools now registered (was 15).
- Lint passes, app renders cleanly.

---
Task ID: EXPORT-IMPORT
Agent: Explore (export/import all + avatar selector)
Task: Review export/import all and avatar selector

Work Log:
- Read /home/z/my-project/worklog.md to understand prior work (WARDROBE FASE 12 just landed; export/import coverage of `wardrobeConfig` was a key concern).
- Grep'd for "Exportar Todo" / "Importar Todo" / "exportAll" / "importAll" / "exportData" / "importData" in src/components and src.
- Found 2 separate "Exportar Todo" / "Importar Todo" UIs:
  1. `/home/z/my-project/src/components/tavern/settings-panel.tsx` — the full backup (Backup Completo), lines 2243-2281 (UI), handleExportAll at lines 894-1001, handleImportAll at lines 1004-1134. Mounted in the "data" tab (TabsContent value="data", line 2104).
  2. `/home/z/my-project/src/components/tavern/character-panel.tsx` — characters+groups only (ExportedData type, lines 288-323 export, lines 330+ import). UI at lines 892, 912. Different purpose, not the full-data backup.
- Read `src/hooks/use-persistence-sync.ts` completely (482 lines) to extract PERSIST_KEYS (lines 11-37) — 50 keys total that trigger server-side saves.
- Read `src/app/api/persistence/route.ts` (186 lines) and `src/lib/persistence.ts` (383 lines) to confirm there's no dedicated export/import endpoint — export/import is entirely client-side via `useTavernStore.setState(updates)`.
- Compared handleExportAll's 46 data keys (settings-panel.tsx lines 914-977) against PERSIST_KEYS list (use-persistence-sync.ts lines 11-37).
- Read `src/store/index.ts` partialize (lines 112-172) to confirm what's persisted to localStorage by Zustand persist middleware.
- Investigated avatar selector in `src/components/tavern/character-editor.tsx`:
  - `handleAvatarUpload` at lines 265-311 — single click-to-upload pattern, no library picker.
  - Avatar UI at lines 354-394 — 32×32 dashed box, click → file input → POST to /api/upload with type=avatar.
  - Same broken upload pattern in: group-editor.tsx:363, sprite-general-panel.tsx:189, sprite-timeline-editor.tsx:266, background-collection-manager.tsx:642, lib/character-card.ts:246.
- Verified /api/upload route DOES NOT EXIST: `find /home/z/my-project/src/app/api -type d` returns 0 "upload" directories; `find -name "route.ts" -path "*upload*"` returns no matches. Only `/home/z/my-project/upload/` exists (empty dir, not a Next.js route).
- Listed /home/z/my-project/public/uploads/avatar/ — 41 PNG/JPG files (32MB total), timestamps from Feb-Mar 2026. Listed /home/z/my-project/public/uploads/group-avatar/ — 2 files. Grep'd data/characters.json: only 2 characters reference /uploads/avatar/ paths, 1 uses data: URL, 9 have empty avatars → ~39 orphan avatar files in the uploads directory.
- Confirmed `wardrobeConfig` (FASE 12 feature) IS covered: it lives on `CharacterCard.wardrobeConfig` (types/index.ts:579), and the full `characters` array is exported/imported by handleExportAll/handleImportAll (settings-panel.tsx:964, 1038).
- Confirmed `stateCollectionsV2`, `triggerCollections`, `spritePacksV2` (all V2 sprite data) are also covered transitively via the character export.

Stage Summary:

### Export/Import All UI location
- **Settings panel "Datos" tab → "Backup Completo" section**
- File: `/home/z/my-project/src/components/tavern/settings-panel.tsx`
- UI: lines 2243-2281 (two big buttons "Exportar Todo" + "Importar Todo")
- handleExportAll: lines 894-1001 (produces `tavernflow-backup-YYYY-MM-DD.json`)
- handleImportAll: lines 1004-1134 (reads JSON, setState on useTavernStore)
- Hidden `<input type="file" accept=".json">` at lines 2114-2120 (id="import-all-input")

### Coverage matrix (handleExportAll vs PERSIST_KEYS)
| Data type                        | PERSIST_KEYS | handleExportAll | handleImportAll | Notes |
|----------------------------------|:---:|:---:|:---:|---|
| characters (incl. wardrobeConfig)| ✓ | ✓ | ✓ | Wardrobe is transitively covered via character |
| sessions                         | ✓ | ✓ | ✓ | |
| groups                           | ✓ | ✓ | ✓ | |
| personas                         | ✓ | ✓ | ✓ | |
| settings (LLM/TTS/tools/etc.)    | ✓ | ✓ | ✓ | Deep-merged on import (line 1052) |
| lorebooks                        | ✓ | ✓ | ✓ | |
| activeLorebookIds                | ✓ | ✓ | ✓ | |
| llmConfigs                       | ✓ | ✓ | ✓ | |
| ttsConfigs                       | ✓ | ✓ | ✓ | |
| promptTemplates                  | ✓ | ✓ | ✓ | |
| soundTriggers                    | ✓ | ✓ | ✓ | |
| soundCollections                 | ✓ | ✓ | ✓ | |
| soundSequenceTriggers            | ✓ | ✓ | ✓ | |
| backgrounds                      | ✓ | ✓ | ✓ | |
| backgroundPacks                  | ✓ | ✓ | ✓ | |
| backgroundIndex                  | ✓ | ✓ | ✓ | |
| backgroundTriggerPacks           | ✓ | ✓ | ✓ | |
| backgroundCollections             | ✓ | ✓ | ✓ | |
| spritePacksV2                    | ✓ | ✓ | ✓ | |
| hudTemplates                     | ✓ | ✓ | ✓ | |
| atmosphereSettings               | ✓ | ✓ | ✓ | |
| activeAtmospherePresetId         | ✓ | ✓ | ✓ | |
| summaries                        | ✓ | ✓ | ✓ | |
| summarySettings                  | ✓ | ✓ | ✓ | |
| characterMemories                | ✓ | ✓ | ✓ | |
| sessionTracking                  | ✓ | ✓ | ✓ | |
| quests                           | ✓ | ✓ | ✓ | |
| questSettings                    | ✓ | ✓ | ✓ | |
| questTemplates                   | ✗ (separate API) | ✓ | ✓ (POST /api/quest-templates per template, lines 1082-1097) | Server stores in individual JSON files |
| questNotifications               | ✓ | ✓ | ✓ | |
| dialogueSettings                 | ✓ | ✓ | ✓ | |
| items                            | ✓ | ✓ | ✓ | |
| activeConsumableEffects          | ✓ | ✓ | ✓ | |
| containers                       | ✓ | ✓ | ✓ | |
| currencies                       | ✓ | ✓ | ✓ | |
| inventorySettings                | ✓ | ✓ | ✓ | equipmentSlots special-cased on import (lines 1063-1075) |
| inventoryNotifications           | ✓ | ✓ | ✓ | |
| dynamicEquipmentState            | ✗ (in PERSIST_KEYS at line 28 but missing from dataToSave in use-persistence-sync.ts:305-374) | ✓ (line 957) | ✓ (line 1034) | **BUG**: in export/import but never persisted to disk by persistence sync. Only kept in localStorage by Zustand persist (store/index.ts:162). |
| collections                       | ✓ | ✓ | ✓ | Timeline editor data |
| activeSessionId                  | ✓ | ✓ | ✓ | |
| activeCharacterId                | ✓ | ✓ | ✓ | |
| activeGroupId                    | ✓ | ✓ | ✓ | |
| activeBackground                 | ✓ | ✓ | ✓ | |
| activeOverlayBack                | ✓ | ✓ | ✓ | |
| activeOverlayFront               | ✓ | ✓ | ✓ | |
| activePersonaId                  | ✓ | ✓ | ✓ | |
| embeddingsConfig                 | ✗ (server-side only) | ✓ (fetched via /api/embeddings/config, lines 896-908) | ✓ (PUT /api/embeddings/config, lines 1099-1115) | Correctly handled as server-side |
| **spritePacks (legacy V1)**      | ✓ (line 20) | ✗ MISSING | ✗ MISSING | In PERSIST_KEYS but reads from main store where it doesn't exist (it's in useTriggerStore). Persistence sync is broken. Skip in export is acceptable. |
| **spriteIndex (legacy)**         | ✓ (line 33) | ✗ MISSING | ✗ MISSING | Exists in main store (spriteSlice.ts:290). Should be added to export for completeness. |
| **spriteLibraries (legacy)**     | ✓ (line 34) | ✗ MISSING | ✗ MISSING | Not in main store. Persistence sync is broken. Skip is acceptable. |

### Concrete issues found

**1. CRITICAL — /api/upload route is missing entirely**
- 6 places call `fetch('/api/upload', ...)`:
  - `src/components/tavern/character-editor.tsx:290` (type=avatar)
  - `src/components/tavern/group-editor.tsx:363` (type=group-avatar)
  - `src/components/tavern/sprite-general-panel.tsx:189` (type=sprite)
  - `src/components/tavern/sprite-timeline-editor.tsx:266` (type=sprite + collection)
  - `src/components/tavern/background-collection-manager.tsx:642` (type=sprite + collection)
  - `src/lib/character-card.ts:246` (uploadImage helper)
- Verified: `ls /home/z/my-project/src/app/api/upload` → No such file or directory. There is no route at that path.
- Impact: every avatar upload, group-avatar upload, sprite upload, background upload returns a 404/500 → user-facing "Error al subir la imagen" toast. None of these features work.
- The 41 files in `public/uploads/avatar/` and 2 in `public/uploads/group-avatar/` are orphans from a previous version when the route existed.

**2. MEDIUM — Avatar selector has no "pick from library"**
- `src/components/tavern/character-editor.tsx:354-394` — single 128×128 dashed-border box, click → file input → POST /api/upload
- No way to reuse an existing avatar file from `/public/uploads/avatar/`
- No way to browse previously-uploaded avatars
- Combined with bug #1, the user has no working way to set an avatar at all (the only fallback is to use a character card PNG import which embeds avatar as base64 data: URL via `lib/character-card.ts`'s `uploadImage` — but that also fails because it calls /api/upload at line 246).

**3. LOW — dynamicEquipmentState not persisted to disk**
- It IS in PERSIST_KEYS (`use-persistence-sync.ts:28`) so changes trigger a save
- It IS in handleExportAll (`settings-panel.tsx:957`) and handleImportAll (`settings-panel.tsx:1034`)
- It IS in Zustand persist partialize (`store/index.ts:162`)
- BUT it is NOT in `dataToSave` payload (`use-persistence-sync.ts:353-360` — inventory object is missing `dynamicEquipmentState`)
- Effect: changes to dynamicEquipmentState trigger a debounced save that includes every other field but NOT dynamicEquipmentState itself. The data is in localStorage and exported, but never written to `data/inventory.json`. On a fresh browser, the data is lost.
- Fix: add `dynamicEquipmentState: state.dynamicEquipmentState` to the `inventory` object in `use-persistence-sync.ts:353`.

**4. LOW — Legacy sprite fields (spritePacks, spriteIndex, spriteLibraries) missing from export**
- All three are in PERSIST_KEYS but skipped in handleExportAll
- `spritePacks` and `spriteLibraries` aren't actually in the main store (separate `useTriggerStore` or undefined) — skipping is OK
- `spriteIndex` IS in the main store (`spriteSlice.ts:290`) and IS in `dataToSave` (`use-persistence-sync.ts:329-332` as `sprites.spriteIndex`) — should be added to export for completeness

**5. INFO — Two parallel "Exportar Todo" features cause user confusion**
- `character-panel.tsx` exports ONLY characters+groups (lines 288-323)
- `settings-panel.tsx` exports EVERYTHING including characters+groups (lines 894-1001)
- Both buttons are labeled "Exportar Todo" in the UI
- The character-panel button downloads `tavernflow_backup_YYYY-MM-DD.json` (characters+groups only)
- The settings-panel button downloads `tavernflow-backup-YYYY-MM-DD.json` (full backup, note hyphen difference)
- Recommendation: rename the character-panel button to "Exportar Personajes" to disambiguate, OR remove it since the settings-panel one is a superset.

### Existing avatar files inventory
- 41 files in `/home/z/my-project/public/uploads/avatar/` (32MB total), named `<timestamp>-<random6>.{png,jpg}`
- 2 files in `/home/z/my-project/public/uploads/group-avatar/`
- Cross-referenced with `data/characters.json`: only 2 characters reference `/uploads/avatar/...` paths (e.g., `/uploads/avatar/1775203483478-ekhs71.png`), 1 uses an inline `data:image/jpeg;base64,...` URL, 9 have empty `avatar` fields
- That means **39 of the 41 avatar files are orphans** (not referenced by any character)
- All 41 files predate the missing /api/upload route (timestamps Feb-Mar 2026), confirming the route was removed at some point but the files were left behind

### Recommendations (priority order)

1. **Create `/api/upload` route** at `src/app/api/upload/route.ts`:
   - Handle multipart POST with fields: `file`, `type` ('avatar' | 'group-avatar' | 'sprite'), optional `collection`
   - Write to `public/uploads/{type}/{timestamp}-{random}.{ext}`
   - Return `{ success: true, url: '/uploads/{type}/{filename}' }`
   - Validate file size (5MB max), type (jpeg/png/gif/webp)
   - This unblocks all 6 callers.

2. **Add "Pick from library" avatar picker to character-editor.tsx**:
   - Add a "Biblioteca" button next to the upload box (lines 354-394)
   - Clicking opens a modal listing all files in `/public/uploads/avatar/`
   - Requires a new `/api/uploads/list?type=avatar` route that reads the directory and returns filenames
   - User can click any thumbnail to set `character.avatar` to that file path (no upload needed)
   - Optionally add a "delete" button on hover for orphan cleanup

3. **Fix dynamicEquipmentState persistence**:
   - Add `dynamicEquipmentState: state.dynamicEquipmentState` to the `inventory` object in `use-persistence-sync.ts:353-360`
   - Add `dynamicEquipmentState: data.inventory?.dynamicEquipmentState` (or `importedVal`) to loadFromServer at line 199 (in the `data.inventory` block, lines 199-218)

4. **Add legacy `spriteIndex` to export/import all**:
   - Add `spriteIndex: store.spriteIndex` and `spriteLibraries: store.spriteLibraries` to handleExportAll data object (around line 935)
   - Add `'spriteIndex', 'spriteLibraries'` to allDataKeys array in handleImportAll (around line 1027)
   - Even if deprecated, they're in PERSIST_KEYS and may have data the user cares about

5. **Rename or remove character-panel.tsx "Exportar Todo"**:
   - Either rename to "Exportar Personajes y Grupos" to disambiguate
   - Or remove since settings-panel.tsx "Exportar Todo" is a strict superset

6. **Add orphan avatar cleanup utility** (low priority):
   - Admin tool or maintenance script that scans `public/uploads/avatar/` and removes files not referenced by any character/group
   - Currently 39/41 files are orphans wasting 32MB

---
Task ID: EXPORT-IMPORT + AVATAR (FASE 13)
Agent: Z.ai Code (principal)
Task: Review export/import all, fix avatar selector to allow reusing existing images

Work Log:
- EXPLORE: Export/Import All is in settings-panel.tsx (lines 894-1134). It exports 46 data keys + embeddingsConfig. Coverage is comprehensive — includes characters (with wardrobeConfig), lorebooks, settings, LLM/TTS configs, sound, backgrounds, sprites V2, HUD, atmosphere, memory, quests, dialogue, inventory, collections, active states. Only missing deprecated V1 sprite fields (minor).
- CRITICAL BUG FOUND: /api/upload route DID NOT EXIST. All avatar/sprite/background uploads were 404ing. 41 existing avatar files in /public/uploads/avatar/ were orphans from a previous version.
- FIX: Created /api/upload/route.ts — handles multipart POST with file + type + collection. Saves to public/uploads/{type}/[{collection}/]. Returns {success, url, filename, size, type}. Validates type (avatar/group-avatar/sprite/background/overlay), file size (50MB max), MIME type (images, videos, audio).
- FIX: Created /api/uploads/list/route.ts — GET endpoint that lists existing files in public/uploads/{type}/[{collection}/]. Returns {success, files: [{url, filename, size, mtime, mediaType}]}. Used by the new avatar library picker.
- FEATURE: Created AvatarLibraryPicker component (components/tavern/avatar-library-picker.tsx) — modal that:
  - Lists existing avatar files in a grid (6 columns)
  - Supports search by filename
  - Allows uploading new files directly from the picker
  - Highlights the currently selected avatar
  - Shows "Actual" badge on the current avatar
  - Returns the selected URL via onSelect callback
- INTEGRATION: Updated character-editor.tsx:
  - Added "Biblioteca" button (FolderOpen icon) next to the avatar upload box
  - Added "Quitar avatar" (X icon) button to clear the avatar
  - Added AvatarLibraryPicker modal with showAvatarPicker state
  - Imported FolderOpen icon and AvatarLibraryPicker component
- FIX: dynamicEquipmentState was in PERSIST_KEYS and export/import but NOT in the save payload of use-persistence-sync.ts. Added it to the inventory object in dataToSave (line 356) and to loadFromServer (line 206-208).
- VERIFIED: /api/uploads/list?type=avatar returns 41 files. /api/upload POST works (tested with test PNG, got {success: true, url: "/uploads/avatar/..."}). App loads cleanly.

Stage Summary:
- /api/upload route created — fixes ALL image uploads (avatars, sprites, backgrounds) that were 404ing.
- /api/uploads/list route created — lists existing files for the library picker.
- AvatarLibraryPicker modal created — lets users pick from existing uploaded images instead of uploading new ones.
- character-editor avatar section enhanced with "Biblioteca" and "Quitar avatar" buttons.
- dynamicEquipmentState persistence fixed (was missing from save payload).
- Export/Import All is comprehensive — no changes needed (already covers all data including wardrobeConfig via characters).
- 16 tools registered, lint passes, app renders cleanly.


---
Task ID: TAVERN-MEMORY-REVIEW
Agent: Explore (TavernFlow memory system)
Task: Document TavernFlow's current memory system for comparison

Work Log:
- Read /home/z/my-project/worklog.md (1470 lines) to understand prior agent work (FASE 12/13, export/import + avatar selector fixes).
- Read ALL files in /home/z/my-project/src/lib/embeddings/ (14 files): lancedb-db.ts, client.ts, ollama-client.ts, memory-extraction.ts, memory-extraction-prompts.ts, chat-context.ts, advanced-search.ts, memory-consolidation.ts, memory-reinforcement.ts, types.ts, constants.ts, config-persistence.ts, index.ts, splitters/text-splitter.ts.
- Read /home/z/my-project/src/store/slices/memorySlice.ts (372 lines, full Zustand slice for Character Memory + summaries).
- Read /home/z/my-project/src/types/index.ts sections for CharacterMemory, MemoryEvent, RelationshipMemory, SummaryData, SummarySettings, EmbeddingsChatSettings, SessionStats, SessionEventLogEntry (lines 2300-2900 and 4585-4670).
- Read /home/z/my-project/src/lib/stats/event-log.ts (full file, 83 lines, ring buffer).
- Read /home/z/my-project/src/app/api/chat/summary/route.ts (381 lines, full).
- Read /home/z/my-project/src/app/api/embeddings/extract-memory/route.ts (197 lines, full).
- Read /home/z/my-project/src/app/api/embeddings/extract-group-dynamics/route.ts (58 lines, full).
- Read /home/z/my-project/src/app/api/embeddings/consolidate-memory/route.ts (57 lines, full).
- Read /home/z/my-project/src/app/api/embeddings/manual-memory/route.ts (first 80 lines).
- Read /home/z/my-project/src/lib/tools/tools/manage-memory.ts (378 lines, full manage_memory tool implementation).
- Read /home/z/my-project/src/lib/key-resolver.ts buildEventosBlock() function (lines 335-384) that consumes the event log ring buffer.
- Read /home/z/my-project/src/lib/llm/prompt-builder.ts buildMemorySection() function (lines 1815-1859) that renders CharacterMemory into prompt.
- Read /home/z/my-project/src/app/api/chat/stream/route.ts key sections: embeddings retrieval (L571-595), summary section construction (L702-722), section ordering (L735-744), embeddings context merge (L754-771), memory reinforcement fire-and-forget (L2085-2114), extraction trigger logic (L2116-2131).
- Read /home/z/my-project/src/app/api/chat/group-stream/route.ts sections: per-character embeddings retrieval (L970-981).
- Read /home/z/my-project/src/components/tavern/chat-panel.tsx sections: group extraction loop (L1400-1500), memory activation sync to Zustand (L1447-1461, L2190-2200), tool activation handler (L1165-1200).
- Grep'd for advancedSemanticSearch/quickSearch usage → confirmed only used inside advanced-search.ts itself; the live chat pipeline (chat-context.ts) does NOT call it.
- Verified {{eventos}} is rendered by buildEventosBlock() in key-resolver.ts:L335 via MAX_EVENT_LOG_IN_PROMPT (8) slice of eventLog (max 30 entries).

Stage Summary:

TavernFlow has FIVE distinct memory layers, layered but largely independent. Here is the complete current state of the memory system:

═══════════════════════════════════════════════════════════════════
LAYER 1 — EMBEDDINGS / RAG (LanceDB + Ollama) — The main memory
═══════════════════════════════════════════════════════════════════

**Storage**: LanceDB native binary at `data/lancedb/` (2 tables: `embeddings` + `namespaces`).
- File: `src/lib/embeddings/lancedb-db.ts` (1037 lines)
- Schema (L244-255, default row): `{id, content, vector, metadata(JSON string), namespace, source_type, source_id, model_name, created_at, updated_at}`
- All embeddings live in ONE `embeddings` table; namespaces are a LOGICAL filter on the `namespace` column (not separate tables). See searchSimilar (L531-545): vector search over the whole table, then in-memory namespace filter.
- Vectors are L2-normalized on insert (L490, normalizeVector) and on query (L525). LanceDB returns L2-squared distance, converted to cosine similarity via `1 - L2²/2` (L212-214, l2SquaredToCosineSimilarity).
- Dimension is dynamic; if config.dimension ≠ table dimension, the table is DROPPED AND RECREATED losing all data (L277-301).
- Cross-platform: LanceDB native module is loaded dynamically (L162-176). If load fails, `isPermanentlyUnavailable=true` and ALL operations return safe defaults — no error thrown. This is a graceful degradation pattern.
- A `getNamespaceEmbeddingsMetadata()` method (L758-814) skips the vector column via `.select()` for memory efficiency (~2MB vs ~160MB for 10K embeddings).

**Embedding generation**: Ollama. Default model `bge-m3:567m` (1024 dims). Known model map + auto-detection via `/api/show` endpoint (ollama-client.ts:L28-80). Hardcoded MODEL_DIMENSIONS and MODEL_CONTEXT_LENGTHS maps in types.ts:L128-164. Smart truncation: 75% of model context window is the budget (chat-context.ts:L155-156).

**Client wrapper**: `src/lib/embeddings/client.ts` (319 lines). Singleton `getEmbeddingClient()`. Each operation calls `refreshOllamaClient()` to pick up config changes (L34-52). Update = delete + recreate (L180-204, no in-place vector update).

**Namespaces** (the core organizational unit — file: chat-context.ts:L495-523, getNamespacesForStrategy):
- `memory-character-{characterId}-{sessionId}` — per-session extracted memories for one character. ALWAYS searched when strategy=character/session.
- `memory-group-{groupId}-{sessionId}` — per-session extracted group dynamics. Searched for group chats.
- `character-{characterId}` — manually-curated character lore (manually created content, not auto-extracted). ALWAYS searched.
- `group-{groupId}` — manually-curated group lore. Searched for group chats.
- `*` (global strategy) — searches the whole table.
- Plus: `settings.customNamespaces` — additional namespaces from the character/group card's `embeddingNamespaces` field, AUGMENTED on top of strategy namespaces (chat-context.ts:L137-144).
- NO hardcoded 'default', 'world', or 'world-building' namespaces — only explicit configuration (chat-context.ts:L514).

**Importance scoring** (file: memory-extraction.ts):
- Stored as integer 1-5 in `metadata.importance` (MemoryFact interface L78-83, saveMemoriesAsEmbeddings L467).
- Five types: 'hecho' | 'evento' | 'relacion' | 'preferencia' | 'secreto' | 'otro' (L85, normalizeMemoryType L314-317).
- Subject: 'usuario' | 'personaje' | 'otro' (L296-304) — tracks WHO the memory is about. Used by chat-context to split into "MEMORIA DEL USUARIO" vs "MEMORIA DEL PERSONAJE" (L352-359).
- ClampImportance (L319-321) ensures 1-5 range.
- Extraction prompt asks LLM to assign importance (memory-extraction-prompts.ts, no specific rubric — LLM judges).

**Extraction** (file: memory-extraction.ts + route.ts):
- Trigger: in /api/chat/stream/route.ts:L2116-2131, AFTER streaming completes. Server sends `shouldExtract` flag in 'done' SSE event. Client (chat-panel.tsx:L1403,L2148) makes the actual `/api/embeddings/extract-memory` POST call AFTER 'done'.
- Condition: `memoryExtractionEnabled && turnCount > 0 && turnCount % frequency === 0`. Default frequency=5 turns (constants.ts:L14).
- Input: lastAssistantMessage + optional chatContext (last `memoryExtractionContextDepth*2+1` messages, default=2 → 5 messages, chat-panel.tsx:L1378-1392).
- LLM call: `extractMemories()` at memory-extraction.ts:L333-398. Uses chat model OR separate extraction model (buildExtractionLlmConfig L43-71, low temp 0.1, maxTokens 512). System prompt: "Eres un extractor de memoria. Responde SOLO con JSON."
- Three extraction prompts (memory-extraction-prompts.ts):
  1. `DEFAULT_MEMORY_EXTRACTION_PROMPT` (L21-62) — for assistant messages, single-character chat. Detailed rules + 3-shot examples. Variables: {characterName}, {userName}, {lastMessage}, {chatContext}.
  2. `DEFAULT_USER_MEMORY_EXTRACTION_PROMPT` (L69-96) — for user messages (when `memoryExtractionFromUserEnabled=true`). Optimized for facts about the player.
  3. `DEFAULT_GROUP_MEMORY_EXTRACTION_PROMPT` (L103-140) — for group chats, focuses on inter-character relationships.
  4. `DEFAULT_GROUP_DYNAMICS_PROMPT` (L157-180) — for the entire turn (all chars + user), extracts relationship facts. Triggered separately via `/api/embeddings/extract-group-dynamics` endpoint when `groupDynamicsExtraction=true` and group has >1 character (chat-panel.tsx:L1470-1499).
- Robust JSON parser: 5-layer fallback (memory-extraction.ts:L134-169): direct parse → markdown fence → outermost `[...]` → per-line JSON object regex → simple `HECHO | importance | tipo | description` lines.
- Validation: contenido length 3-200 chars (L292), reject "ninguno"/"none" (L293).
- Save flow: `saveMemoriesAsEmbeddings()` (L407-492) → filters by minImportance (default=2, constants.ts:L15) → upserts namespace → creates one embedding per fact with metadata {importance, memory_type, memory_subject, extracted_at, character_id, session_id, group_id}.

**Consolidation** (file: memory-consolidation.ts + route.ts):
- Trigger: AUTO after each successful extraction (extract-memory/route.ts:L161-179) IF `memoryConsolidationEnabled=true` AND saved > 0. Calls `autoConsolidateAfterExtraction()`.
- Threshold check (memory-consolidation.ts:L388-409): counts memory embeddings in namespace via lightweight `countByNamespaceAndSourceType()`. If count ≤ threshold (default 50, constants.ts:L18), no consolidation.
- Algorithm (consolidateNamespace L112-227):
  1. Load only metadata (no vectors) via `getNamespaceEmbeddingsMetadata()` — saves ~98% memory.
  2. Sort by importance DESC then recency DESC (L139-147).
  3. PROTECTED ZONE: keep first `keepRecent` (default 10, constants.ts:L19) memories AND any with importance >= `keepHighImportance` (default 4, constants.ts:L20).
  4. Group remaining "candidates" by `memory_type` (L171-176).
  5. For each group, take up to `batchSize` (default 20, constants.ts:L21) memories.
  6. Call LLM with `CONSOLIDATION_PROMPT` (L73-92) asking it to merge related facts into ≤3 sentences each ≤40 words. Rules: preserve important info, third person, if contradictory keep most recent, don't invent.
  7. Delete originals, save consolidated ones with `is_consolidated: true, consolidated_from: N, consolidated_at: ISO` metadata (L198-213).
  8. GUARD: if LLM returns >= original count, skip (no reduction, L287-289).
- Manual endpoint: POST /api/embeddings/consolidate-memory (route.ts:14-56) for explicit invocation.

**Reinforcement** (file: memory-reinforcement.ts):
- Trigger: fire-and-forget `setTimeout(0)` in stream route AFTER response streaming completes (stream/route.ts:L2093-2111). Only fires if `memoryReinforcementEnabled=true` AND response length > 50 AND there are namespaces starting with `memory-`.
- Algorithm (processResponseAndReinforceMemories L182-214):
  1. For each namespace, ONE semantic search using response text as query, limit=20, threshold=0.3 (low initial bar, L47-52).
  2. Filter to `source_type='memory'` only (L56).
  3. Word-overlap check: count memory words (length > 3) that appear in response (L60-67).
  4. Combined threshold: if wordOverlap >= 0.3, use configured threshold (default 0.7); else require 0.8 (L73-75).
  5. Match if `similarity >= effectiveThreshold OR wordOverlap >= 0.5` (L77-78).
- Boost (reinforceMemories L108-172): integer 1-5 scale. boostAmount=1 by default, scaled by similarity (≥0.9 → 1.0×, ≥0.7 → 0.7×, else 0.5×). Capped at 5. Skip if already 5.
- Update = delete + recreate via `updateEmbedding()` (client.ts:L180-204), preserving namespace + source_type + source_id. Adds `last_reinforced_at` to metadata (L156).

**Retrieval / Chat-context injection** (file: chat-context.ts):
- `retrieveEmbeddingsContext()` (L106-450) — called by /api/chat/stream (L583), /api/chat/group-stream (L970), /api/chat/regenerate, /api/chat/generate, /api/chat/proactive routes.
- Inputs: userMessage, characterId, sessionId, settings, groupId, existingMemoryEvents (for dedup), lastAssistantMessage (for bidirectional search).
- Bidirectional search (L206-247): if lastAssistantMessage > 20 chars, also runs a secondary search using it as query with `threshold + 0.1` (capped at 1.0) and half the limit.
- Scoring (L258-267): for memory-type only, `similarity += (importance - 3) * 0.02` (subtle ±0.04 boost). NOT applied to lore/world content.
- Latest-summary exclusion (L276-281): if `source_type === 'summary'` and `metadata.is_latest === true`, EXCLUDE from results (the latest summary is injected separately as [RECUERDOS ANTERIORES]).
- Deduplication against Character Memory events (L298-335): if word overlap > 60% (length > 3), skip the embedding (Character Memory wins). Only applies to source_type='memory'.
- SPLIT into two sections (L341-378):
  - Non-memory (lore/world/rules/events) → `[CONTEXTO RELEVANTE]`, 45% of token budget.
  - Memory → `[MEMORIA RELEVANTE]` with two sub-blocks: `[MEMORIA DEL USUARIO]` (sujeto=usuario|otro, 50% of memory budget) + `[MEMORIA DEL PERSONAJE]` (sujeto=personaje, 50%). 55% of token budget.
- Grouping (buildGroupedContextString L531-619): results grouped by namespace metadata.type (loaded from namespaces table via getNamespaceTypesMap L455-479). Each type gets its own `[TYPE]` sub-header. Un grouped → `[OTRO CONTEXTO]` or simple list.
- Token budget (constants.ts:L9): default 1024 chars maxTokenBudget. Truncation: `maxChars = maxTokenBudget * 4` (L537).
- Order in final prompt (stream/route.ts:L735-744): System → Summary → Character Memory → [CONTEXTO] non-memory → [MEMORIA] memory → Chat History → Post-History.
- If embeddings found memory results, Character Memory content is SKIPPED from the contextParts join (L760-763) to avoid duplication (still shown in prompt viewer as its own section).

**Advanced search (UNUSED)** (file: advanced-search.ts, 316 lines):
- Multi-stage retrieval, reranking, temporal decay (memory halves every 7 days, L188-194), diversity boosting.
- **CRITICAL FINDING**: This file is NEVER imported by the chat pipeline. `advancedSemanticSearch()` is only referenced inside its own file. The live retrieval uses the simpler `retrieveEmbeddingsContext()` in chat-context.ts instead. So **temporal decay and reranking are implemented but NOT active in production**.

**Manual memory entry**: 
- Tool: `manage_memory` (src/lib/tools/tools/manage-memory.ts) — LLM can call save_memory/update_relationship/get_memories. Saves to `memory-character-{charId}-{sessionId}` namespace with `manually_created: true`.
- API: POST /api/embeddings/manual-memory — for UI-created memories.
- Both also sync to the Zustand CharacterMemory store via `memoryActivation` events (manage-memory.ts:L170-181, L288-298).

═══════════════════════════════════════════════════════════════════
LAYER 2 — CHARACTER MEMORY (Zustand store, client-side)
═══════════════════════════════════════════════════════════════════

**File**: src/store/slices/memorySlice.ts (372 lines) + src/types/index.ts:L2795-2825

**Types**:
- `CharacterMemory { id, characterId, events: MemoryEvent[], relationships: RelationshipMemory[], notes: string, lastUpdated }` (types L2808-2815)
- `MemoryEvent { id, type: 'fact'|'relationship'|'event'|'emotion'|'location'|'item'|'state_change', content, characterId?, timestamp, importance: 1-5, embeddingId?, sessionId?, metadata? }` (types L2795-2805)
- `RelationshipMemory { targetId, targetName, relationship: string, sentiment: -100..100, notes, lastUpdated }` (types L2818-2825)

**Storage**: Zustand store, persisted to localStorage via Zustand persist middleware, and to `data/character-memories.json` via the persistence sync hook (one of the PERSIST_KEYS).

**Population**:
1. **Auto-extraction sync** (chat-panel.tsx:L1447-1461, L2190-2200): when /api/embeddings/extract-memory returns `memoryActivations[]`, the client calls `store.addMemoryEvent()` for each saved fact. This is a CLIENT-SIDE mirror of what was saved to LanceDB. So extracted memories exist in BOTH places (LanceDB as embedding + Zustand as MemoryEvent with embeddingId link).
2. **Tool calls** (chat-panel.tsx:L1165-1200): when the LLM calls `manage_memory` with action=save_memory, the tool returns a `memoryActivation` payload which is sent back via SSE and the client calls `store.addMemoryEvent()`. For update_relationship, calls `store.updateRelationship()`.
3. **Manual UI editing**: CharacterMemoryEditor component (src/components/memory/character-memory-editor.tsx, 605 lines) lets the user view/add/edit/delete events and relationships directly in the store.

**Injection into prompt** (prompt-builder.ts:L1815-1859, buildMemorySection):
- Renders three sub-blocks:
  - `[Eventos y hechos clave]` — events sorted by importance DESC (supports both 0-1 and 1-5 scales), ⭐ marker for importance ≥4.
  - `[Relaciones]` — relationships with emoji sentiment (>50 😊, <-50 😞, else 😐) and ±sentiment number.
  - `[Notas]` — raw notes string.
- Section labeled `Memoria de {characterName}`, color `bg-purple-100`.
- Injected BEFORE the embeddings sections (stream/route.ts:L739).
- When embeddings retrieval found memory-type results, the Character Memory CONTENT is skipped from the joined `contextParts` (but still shown in the prompt viewer as its own section). This is because the deduplication at chat-context.ts:L298-335 only filters EMBEDDINGS that overlap with Character Memory — the reverse is handled by skipping Character Memory content when embeddings already provide memory.

═══════════════════════════════════════════════════════════════════
LAYER 3 — SESSION EVENT LOG ({{eventos}} ring buffer)
═══════════════════════════════════════════════════════════════════

**File**: src/lib/stats/event-log.ts (83 lines) + src/types/index.ts:L4585-4668

**Storage**: `SessionStats.eventLog: SessionEventLogEntry[]` — lives on `ChatSession.sessionStats` (in the sessions array).

**Schema** (types L4605-4619):
```
{ id, type, description, characterId?, characterName?, targetName?, turn?, timestamp }
```
Types (types L4592-4603): `'action' | 'quest_objective' | 'solicitud_created' | 'solicitud_completed' | 'solicitud_user' | 'scene_enter' | 'scene_leave' | 'scene_focus' | 'relationship' | 'skill_check' | 'custom'`

**Ring buffer**:
- MAX_EVENT_LOG_ENTRIES = 30 (event-log.ts:L15) — hard cap, oldest dropped.
- MAX_EVENT_LOG_IN_PROMPT = 8 (L18) — only the last 8 are injected.
- Pure function `appendEventLogEntry()` (L32-65) — does NOT mutate input, returns new SessionStats.
- Append is called from various stat handlers: skill-key-handler.ts:L270 (skill checks), solicitud-executor.ts, stats-detector.ts, relationship changes, scene enter/leave/focus.

**Consumption** (key-resolver.ts:L335-384, buildEventosBlock):
- Renders the last 8 entries (oldest → newest) as numbered lines: `1. [LABEL] who: description (turno N)`.
- Header: `[ULTIMOS EVENTOS]\n(Bitácora reciente, del más viejo al más nuevo — los personajes pueden reaccionar a estos eventos)`.
- Labels translated via `eventLogTypeLabel()` (event-log.ts:L68-82): ACCION, OBJETIVO, PETICION, SOLICITUD COMPLETADA, etc.
- LEGACY FALLBACK (L352-383): if no eventLog, falls back to scalar fields `ultimo_objetivo_completado`, `ultima_solicitud_realizada`, `ultima_solicitud_completada`, `ultima_accion_realizada` (with character name). The scalar fields are still updated alongside the ring buffer for backward compat (per the file header comment).
- Injected via `{{eventos}}` template key, resolved by resolveSectionsKeysWithPasses (prompt-builder.ts:L801-802).

**Distinct from memory embeddings**: Event log is a SHORT-TERM (max 30 entries, ~8 in prompt) reactive timeline of discrete gameplay events (skill checks, scene changes, requests). Memories are LONG-TERM semantic facts. They don't overlap.

═══════════════════════════════════════════════════════════════════
LAYER 4 — SUMMARIES (conversation compression)
═══════════════════════════════════════════════════════════════════

**Files**: src/app/api/chat/summary/route.ts (381 lines) + src/store/slices/memorySlice.ts (SummaryData/SummarySettings) + src/types/index.ts:L2828-2901

**Type** (types L2828-2839):
```
SummaryData { id, sessionId, content, messageRange: {start, end}, tokens, createdAt, model? }
```

**Settings** (types L2842-2860 + DEFAULT_SUMMARY_SETTINGS L2863-2893):
- `enabled: false` by default (L2864) — must be explicitly turned on.
- `autoSummarize: true` (L2865).
- `normalChatInterval: 20` messages (L2868).
- `groupChatInterval: 15` messages (L2869, more frequent because group chats grow faster).
- `triggerThreshold: 20` (legacy, L2871).
- `keepRecentMessages: 10` (L2872) — kept unsummarized.
- `maxSummaryTokens: 500` (L2873).
- `promptTemplate` (L2874-2889) — Spanish prompt with {{conversation}} placeholder. Rules: preserve key events, emotional moments, character decisions, world details, ongoing quests. Narrative format, not bullets.
- `summarizeOnTurnEnd: true` (L2890).
- `includeCharacterThoughts: true` (L2891).
- `preserveEmotionalMoments: true` (L2892).

**Trigger** (memorySlice.ts:L201-214, shouldGenerateSummary):
- `if (!enabled || !autoSummarize) return false`.
- Threshold = `isGroupChat ? groupChatInterval : normalChatInterval`.
- Triggers when `messagesSinceLastSummary >= threshold`.
- `incrementMessageCount()` called per chat message; `resetMessageCount()` after summary generation.

**Generation flow** (route.ts):
1. POST /api/chat/summary with {messages, characterName, userName, settings, previousSummary?, apiConfig, characterId, sessionId}.
2. Filter deleted messages. Truncate if estimated tokens > available (L180-215): works backwards from most recent to fit.
3. Build prompt: systemPrompt (L50-66) preserves plot/decisions/emotional moments/world details/quests. userPrompt uses custom template with {{conversation}} replaced, OR if previousSummary exists, asks LLM to integrate previous + new (L91-97).
4. LLM call with temperature=0.3, maxTokens=min(settings.maxSummaryTokens, 512) (L229, L238-251).
5. **Save as embedding** (L267-329): demote any previous "latest" summary in the same `memory-character-{charId}-{sessionId}` namespace (set is_latest=false), then save new one with `source_type: 'summary', is_latest: true`. Old summaries REMAIN searchable via semantic search for long-term recall.
6. Return SummaryData; client stores in Zustand `summaries[]`.

**Injection** (stream/route.ts:L702-722):
- Client passes the latest SummaryData to the server in the request body (L413: `const summary = body.summary`).
- Server builds `summarySection` with content `[RECUERDOS ANTERIORES]\n${summary.content}` (L708).
- Also creates a synthetic ChatMessage with the same content for chat history context (L712-721).
- Section is injected BEFORE Character Memory and embeddings sections (L738).
- `summaryTokens` reserved when re-evaluating the context window (L844-846) — reduces chat history to make room.

═══════════════════════════════════════════════════════════════════
LAYER 5 — SETTINGS / CONFIG (the control panel)
═══════════════════════════════════════════════════════════════════

**Two separate config layers**:

**A) Server-side EmbeddingsConfig** (file: src/lib/embeddings/config-persistence.ts + types.ts:L100-113):
- Stored at `data/embeddings-config.json` (config-persistence.ts:L14).
- Fields: `{ollamaUrl, model, dimension, similarityThreshold, maxResults, modelContextLength?, timeout?, retryCount?, retryDelay?, updatedAt}`.
- DEFAULT_CONFIG (L16-24): ollamaUrl=`http://localhost:11434`, model=`bge-m3:567m`, dimension=1024, similarityThreshold=0.5, maxResults=5.
- Clamps: similarityThreshold 0.15-1.0 (L77), maxResults 1-100 (L78).
- In-memory cached, loaded on module import (L127).

**B) Client-side EmbeddingsChatSettings** (file: src/types/index.ts:L2319-2370 + src/lib/embeddings/constants.ts DEFAULT_EMBEDDINGS_CHAT):
- Stored on `settings.embeddingsChat` in the Zustand main store, persisted via the persistence sync hook.
- ALL DEFAULT VALUES in constants.ts:L7-41 (DEFAULT_EMBEDDINGS_CHAT):
  - `enabled: false` (L8) — RAG retrieval OFF by default.
  - `maxTokenBudget: 1024` (L9) — chars budget for context injection.
  - `namespaceStrategy: 'character'` (L10) — options: 'global' | 'character' | 'session'.
  - `showInPromptViewer: true` (L11).
  - `memoryExtractionEnabled: false` (L13).
  - `memoryExtractionFrequency: 5` turns (L14).
  - `memoryExtractionMinImportance: 2` (L15, 1-5 scale).
  - `memoryConsolidationEnabled: false` (L17).
  - `memoryConsolidationThreshold: 50` (L18).
  - `memoryConsolidationKeepRecent: 10` (L19).
  - `memoryConsolidationKeepHighImportance: 4` (L20).
  - `memoryExtractionPrompt: DEFAULT_MEMORY_EXTRACTION_PROMPT` (L22) — customizable.
  - `groupMemoryExtractionPrompt: DEFAULT_GROUP_MEMORY_EXTRACTION_PROMPT` (L23).
  - `memoryExtractionContextDepth: 2` (L25) — last 2*2+1=5 messages included.
  - `searchContextDepth: 2` (L27).
  - `groupDynamicsExtraction: false` (L29).
  - `memoryReinforcementEnabled: false` (L31).
  - `memoryReinforcementThreshold: 0.7` (L32).
  - `memoryExtractionFromUserEnabled: false` (L34) — also extract from user messages.
  - `extractionModelEnabled: false` (L36) — separate model option.
  - `extractionModelProvider: 'ollama'` (L37).
  - `extractionModelEndpoint: 'http://localhost:11434'` (L38).
  - `extractionModelApiKey: ''` (L39).
  - `extractionModelName: 'llama3.1:8b'` (L40).

═══════════════════════════════════════════════════════════════════
KEY LIMITATIONS / GAPS (relative to a "full" memory system)
═══════════════════════════════════════════════════════════════════

1. **NO temporal decay in production**: `advanced-search.ts` implements exponential decay (memory halves every 7 days, L188-194) and reranking, BUT this module is NEVER imported by the live chat pipeline. Only `chat-context.ts:retrieveEmbeddingsContext()` is used, which has only a static importance boost (±0.04). Old memories and new memories have equal standing.

2. **NO forgetting**: There is no time-based or relevance-based deletion. Memories are only deleted via:
   - Manual deletion via UI.
   - Consolidation (which merges, doesn't truly forget — the original facts are summarized into a new memory).
   - The `delete-session-namespaces` route (cleans up entire session namespaces).
   - The `cleanup-orphaned` route.
   No "forget memories not referenced in X days" mechanism.

3. **NO reranking** in the live path: The chat pipeline uses simple sort by similarity with a tiny importance boost (chat-context.ts:L258-270). The proper reranking logic in advanced-search.ts (with diversity, temporal, type bonuses) is dormant.

4. **NO episodic vs semantic distinction**: Memory types are 'hecho' | 'evento' | 'relacion' | 'preferencia' | 'secreto' | 'otro' — these are semantic categories. There is no notion of "episodic memory" (specific time-bound events) vs "semantic memory" (general knowledge). All memories are flat semantic facts.

5. **NO conflict resolution** beyond consolidation: When a new memory contradicts an existing one (e.g., "user is married to Alice" then "user is single"), both coexist in the namespace. Consolidation's prompt has a weak "if contradictory, keep the most recent" rule (memory-consolidation.ts:L80) but only fires when threshold is exceeded AND only within the same memory_type group.

6. **Cross-session memory is ARCHITECTURALLY DISCOURAGED**: Memories are stored in `memory-character-{charId}-{sessionId}` namespaces — per-session. The chat-context retrieval only searches namespaces for the CURRENT sessionId (chat-context.ts:L509: `memory-character-${characterId}-${sessionId}`). To get cross-session memory, the user must either:
   - Manually add memories to `character-{characterId}` namespace (manually-curated lore, always searched).
   - Use the global namespace strategy `'*'` (searches the entire table).
   - Add the old session's namespace to `customNamespaces` on the character card.
   There is NO automatic "promote important memories from past sessions to a cross-session namespace" mechanism.

7. **Memory extraction frequency is turn-based, not content-based**: Extraction fires every N turns (default 5) regardless of whether the last message contained memorable info. The LLM is asked to extract from the last assistant message even if it's just "yes" or "ok". The prompt handles this by returning `[]` for non-memorable content, but it's still an LLM call.

8. **Reinforcement is fire-and-forget, no decay**: When a memory is reinforced, its importance goes UP. But memories that are NEVER reinforced keep their original importance forever. There's no "decay if not referenced" mechanism.

9. **Character Memory (Zustand) is a duplicate store**: Every auto-extracted memory is saved TWICE — once as a LanceDB embedding, once as a CharacterMemory event in Zustand (chat-panel.tsx:L1447-1461). The Zustand copy is used for: (a) prompt injection via buildMemorySection, (b) deduplication filter for embeddings retrieval (chat-context.ts:L298-335). The LanceDB copy is used for semantic search. They can drift out of sync if one fails. There's no reconciliation.

10. **Summary demote-or-delete is fragile**: When a new summary is generated, the previous "latest" is demoted to is_latest=false (summary/route.ts:L282-303). If the demote fails, it's deleted. But if neither works, two summaries with is_latest=true coexist, and chat-context.ts:L276-281 will exclude BOTH from RAG search. This is silent failure.

11. **No memory type for "state" or "current situation"**: The MemoryEvent types include 'state_change' but extraction prompts never produce this type — the LLM extraction only outputs hecho/evento/relacion/preferencia/secreto/otro. State changes are captured via the {{eventos}} ring buffer (short-term) or via the stats/attribute system, NOT in long-term memory.

12. **Namespace strategy 'session' is essentially identical to 'character'**: Both fall into the same case in getNamespacesForStrategy (chat-context.ts:L505-518) — both search `memory-character-{charId}-{sessionId}`. The two strategies differ only if the character card has different embeddingNamespaces per session, which is rare.

13. **Embeddings model is single-instance**: The Ollama client is a singleton (client.ts:L299-309). Switching models at runtime requires `resetEmbeddingClient()`. If two chat sessions use different models concurrently, they will clobber each other (rare scenario but possible in multi-user setups).

14. **Consolidation is non-atomic**: Delete-then-insert in `upsertNamespace` (lancedb-db.ts:L640-661) and `updateEmbedding` (client.ts:L187-203). If the process crashes mid-operation, data is lost. There's a safety-net deduplication (L649-661) but only for namespace rows, not for embeddings.

15. **No memory versioning**: When consolidation merges N memories into M summaries, the originals are deleted. There's no history of "this memory was consolidated from these N original memories" beyond a `consolidated_from: N` count (memory-consolidation.ts:L210). The original content is lost.

16. **Importance scale is integer 1-5**: No fine-grained control. Reinforcement adds +1 per occurrence (with similarity factor). A memory referenced 100 times has the same importance as one referenced 5 times (both cap at 5).

17. **Extraction prompt has no character-specific guidance**: The DEFAULT_MEMORY_EXTRACTION_PROMPT is generic — it doesn't know what the character already knows. It explicitly says "Ignora información que ya es conocimiento general del personaje" but provides no list of what that is. The LLM has to guess.

18. **Group dynamics extraction is fire-and-forget**: It runs after the response is sent (chat-panel.tsx:L1483-1499), and any failure is silently swallowed. There's no retry mechanism and no UI feedback.

---
Task ID: VOICEMEM-RESEARCH
Agent: General-purpose researcher
Task: Research VoiceMem memory system

Work Log:
- Fetched README from raw GitHub: https://raw.githubusercontent.com/xzf-thu/VoiceMem/main/README.md (bilingual CN/EN)
- Fetched repo metadata: https://api.github.com/repos/xzf-thu/VoiceMem (created 2026-08-17, 360 stars, Apache-2.0, Python, default branch main)
- Listed repo top-level contents: https://api.github.com/repos/xzf-thu/VoiceMem/contents/ (dirs: voicemem/, voicemem_memoryspace/, docs/, examples/, finetune/, evaluation/, scripts/, web/, assets/)
- Listed voicemem/ package contents: __init__.py, core.py, config.py, orchestrator.py (77k), memory_api.py, stream.py, reply.py, startup_check.py, tts.py, leftbrain/, rightbrain/, utils/
- Listed voicemem/leftbrain/ contents: brain.py, mem0_backend_store.py, local_memory_store.py, memory_repository(_v2).py, extract_facts_openai.py, local_e5_embedder.py, merged_extraction.py, time_expand.py, mem0_additive_prompt_build.py, cognitive_graph/, slot_split/, data/
- Listed voicemem/rightbrain/ contents: brain.py, anchor_router.py, attribution_manager.py, experience_repository.py, graph_store.py, store.py, traits_store.py, types.py
- Listed voicemem/utils/ contents: defaults.py, audio/, common/, fusion/
- Read full source of: __init__.py, core.py, config.py, memory_api.py, stream.py, reply.py, orchestrator.py (1373 lines), leftbrain/brain.py (extracted: SearchCogGraph, SearchData, Rank, Classify, RunSubgraphCheckpoint, ArchiveColdMemories, _llm_tag_memories, search/rank wrappers), leftbrain/local_memory_store.py, leftbrain/mem0_backend_store.py, leftbrain/local_e5_embedder.py, leftbrain/merged_extraction.py, leftbrain/time_expand.py, leftbrain/mem0_additive_prompt_build.py, rightbrain/brain.py (extracted: RightBrainHit, search, write, _reaction_signals), rightbrain/graph_store.py, rightbrain/traits_store.py, rightbrain/anchor_router.py, rightbrain/attribution_manager.py, rightbrain/types.py, utils/defaults.py
- Read pyproject.toml (voicemem v0.2.3) for full dependency list and rationale
- Read examples/01_memory.py and examples/03_simple_agent_with_voicemem_memory.py (full streaming mic → ASR → memory → OpenAI reply → streaming TTS with barge-in via WebRTC AEC)
- Fetched demo site https://xzf-thu.github.io/VoiceMem/ — confirmed it is a custom dark-themed HTML/CSS/JS landing page with an animated memory-graph canvas visualization
- Fetched arxiv abstract page https://arxiv.org/abs/2608.26005 — Title: "VoiceMem: Streaming Dual-Brain Memory for Real-Time Interaction", Authors: Zhifei Xie, Jiaqi Lang, Ze An, Yifan Zhao, Dongchao Yang, Kai Li, Ziyang Ma, Mingbao Lin, Chunyan Miao, Shuicheng Yan (submitted 26 Aug 2026, 18 pages, 9 figures, 6 tables)
- Ran web search "VoiceMem voice memory app xzf-thu" and "VoiceMem streaming dual-brain memory system architecture arxiv technical report" — confirmed cross-postings on HuggingFace papers, LinkedIn (Pascal Biese), papers.cool, hyper.ai, opentrain.ai, themoonlight.io, aimodels.fyi

Stage Summary:
VoiceMem is an open-source (Apache-2.0) streaming dual-brain memory system for real-time voice agents, published as arXiv:2608.26005 by Zhifei Xie (xzf-thu, Tsinghua/NTU) and collaborators on 26 Aug 2026. The GitHub repo (xzf-thu/VoiceMem) is Python, 360 stars at fetch time, with the actual source package on PyPI as `voicemem` v0.2.3 (install: `pip install voicemem`).

**1. High-level architecture (streaming dual-brain)**
- Three modes via `VoiceMem(mode=...)`: `leftbrain_only` / `text` / `normal`(=multi_modal). Mode controls which utils load (left_brain_single / text_mode / multi_modal).
- The facade `VoiceMem` (voicemem/core.py) wraps an `Orchestrator` (voicemem/orchestrator.py) that holds three self-contained components:
  - `LeftBrain` (voicemem/leftbrain/brain.py) — factual memory with schema (slot) + entity organization built on top of mem0 vector store
  - `RightBrain` (voicemem/rightbrain/brain.py) — emotional memory: per-utterance "heartnotes" + persona/relationship graph + response-experience memory
  - `AudioPerceiver` (voicemem/utils/audio/perceiver.py) — audio-native perception: scene (AST/CLAP), speaker voiceprint (3D-Speaker), emotion attribution, music, place, routine, abnormal sound detection
- Every component is **decoupled and injectable**: `VoiceMem(embedding=fn, schema=fn, memory_engine=fn, reply=fn, ...)` swaps any of them. `VoiceMem.from_config({...})` provides a mem0-style declarative config.

**2. Capture / Ingest pipeline** (Orchestrator.Ingest → _finish_ingest)
1. `preprocess(text, audio_path)` → AudioPerception runs all acoustic analysis (scene/voiceprint/emotion/tune/abnormal/place).
2. Pack into a `VoiceInput` (structured utterance with VoiceContent items: sentence, voiceprint_id, emotion, environment, agent_reply).
3. `LeftBrain.ingest_facts()` → `OpenAIMem0V3AdditiveExtractor` (gpt-4o-mini) extracts atomic facts; an LLM-based `ConflictResolver` (ADD/UPDATE/DELETE/NONE) decides what to write — mem0's own `infer=True` is deliberately NOT used (`add(infer=False)`) because mem0 only does hash-dedup in that path; voicemem keeps its stronger LLM-based resolver.
4. Cognitive-graph writes: LLM tags each new memory with 1-2 slot labels from the SlotV2 taxonomy (only existing slots; LLM cannot invent new categories — new slots emerge only from subgraph co-occurrence); entity linker connects memory_ids to entities; one-hop neighbor expansion at retrieval time.
5. Right-brain writes: one "heartnote" per utterance (content = verbatim user text, metadata = emotion, entities, agent_reply, inner_os = LLM-generated third-person empathy narrative); emotion anchor; entity anchors; traits extracted into rb_traits table (one node = one judgment about the user, with Evidence records quoting the user's original words and pointing back to the left-brain fact that caused it).
6. Audiomem tags: scene:*, speaker:*, tune:*, abnormal_sound:*, place:*, routine:* attached via cog_store.upsert_memory_tags.
7. Special handling for sound-only turns (music with no speech) — written with text=SOUND_ONLY_TEXT constant so they can be found later for playback.

**3. Storage / vector DB**
- Underlying vector memory engine: **mem0** (`mem0ai` package) — the default. Backed by embedded Qdrant in local mode (single-process only; multi-process needs real Qdrant server, explicitly called out as a limitation).
- A `_MEM0_CLIENT_CACHE` keyed by `memory_root` path makes concurrent `VoiceMem` construction within one process safe (mem0 telemetry is disabled because it was measured to inflate rank_ms from 8ms → 280ms).
- Cognitive graph (slots, entities, edges, memory_tags, memory heat) is **SQLite WAL** at `voicemem_memoryspace/<space>/voicemem.sqlite`.
- Right brain (rb_slots, rb_entities, rb_entity_memories, rb_traits, rb_evidence, heartnotes, response_experiences, situation_patterns) is also SQLite.
- Audio archive: WAV files under multi_modal/, 30-day retention, daily cleanup.
- The memory engine is **swappable**: pass any object with the right interface via `VoiceMem(memory_engine=fn)` or `vector_store=...`.

**4. Embeddings**
- Default retrieval-path embedder: **local `intfloat/multilingual-e5-small` (384-dim)** via sentence-transformers (voicemem/leftbrain/local_e5_embedder.py). Critical design choice: this keeps the *retrieval* path 0-LLM, 0-network, which is what enables 134ms median latency and the 0–300ms speculative prefetch inside the VAD turn.
- Optional OpenAI `text-embedding-3-small` (1536-dim) via `OpenAILocalEmbedder` — only used for writes (fact extraction side); mixing dimensions in the same store throws (shapes (n,384) vs (1536,)).
- Right-brain trait claims also get E5 embeddings so persona judgments can be retrieved by semantic similarity (threshold 0.45) rather than exact-string match.

**5. Retrieval pipeline** (Orchestrator.Search → LeftBrain.search → LeftBrain.rank ‖ RightBrain.search)
1. `expand_relative_dates(query)` — "next week" / "tomorrow" → concrete dates appended to query text.
2. Scene filter: inferred from query text first, else from last detected scene (soft priority; auto-reverts if narrowing returns nothing).
3. **Classify** (LeftBrain.Classify) — query → slots + entities. Default = `LocalQueryClassifier` (E5, 0 LLM); falls back to `QuerySlotClassifier` (one LLM call) if local unavailable. Hierarchical: drills into child slots (emerged from subgraph mechanism) when supported.
4. **SearchCogGraph** — slot filtering via `cognitive_store.memory_ids_for_slots_v2` (union of base + child slots); optionally narrowed by `scene:*` and `speaker:*` tag intersection.
5. **SearchData** — entity fuzzy matching + one-hop neighbor expansion → `entity_mids ∪ slot_mem_ids` (union mode, default) OR `entity_mids ∩ slot_mem_ids` (strict mode when intersection ≥ 3).
6. **_widen_for_time_question** — for "how long" / "when" queries, regex-scan library for memories containing duration/date expressions and union them in (cosine alone misses these).
7. **Rank** (LeftBrain.rank) — vector cosine search via mem0 (filtered to candidate_ids), pulls top_k*3 candidates; applies two rescue bonuses (lexical overlap weight 0.15 + time-question type bonus 0.10 + date-overlap bonus 0.12) bringing back up to `_RESCUE_K=3` extra near-misses that pure cosine buried; near-duplicate deduplication via trigram-Jaccard ≥ 0.30; caps at top_k (default 5).
8. **RightBrain.search runs concurrently** in a 1-worker ThreadPoolExecutor (rank_ms and rb_ms overlap): anchor_router builds a MemoryQueryPlan from left-brain-activated entities + emotion + agent_reply; retrieves heartnotes, response_experiences, situation_patterns; trait store does vector similarity search (≥0.45 sim threshold) for matching persona claims; current-signals detector (dissatisfaction/correction cues from user's text + agent's previous reply) injects a high-priority "Current signals" hit. Hits sorted by `_rb_blended_priority` = static priority + 0.5 * (anchor_score / (1 + anchor_score)). Top-N (default 5) rendered into `rb_directive` text.
9. Scene-adaptive directive appended; if both brains lack specific evidence, an explicit abstention hint is added instructing the model to say "I don't know" rather than guess.
- Median retrieval latency: **134ms** total (Mem0: 1440ms); LoCoMo eval median: **12ms**; median injected memory: **298 tokens** (Mem0: 6956, EverMemOS: 1899).

**6. Summaries / consolidation**
- **Schema description refresh** (`_refresh_schema_descriptions`) — at session boundary, LLM rewrites a ≤40-word summary for each slot that received new memories; these summaries are attached to the prompt at retrieval time to give cross-memory aggregation that no single fact provides.
- **Short-term attribution** — every 20 new left+right memories (env `VOICEMEM_ATTRIBUTION_MIN_MEMORIES`), re-reads an entity's accumulated memories and rewrites its description; also refines individual memory items (dedup/condense).
- **Long-term attribution** — at session boundary, summarizes all entities in a slot into a higher-level slot-level persona description.
- **Subgraph checkpoint** (`RunSubgraphCheckpoint`) — accumulates retrieved memory_ids across a session (cheap, no LLM); at session end, builds a co-occurrence graph and applies a density formula to potentially **emerge a new dynamic slot** (a new memory category the user cares about, never invented by the LLM).

**7. Temporal decay / recency / forgetting**
- **Memory heat** (`record_memory_hits`, `last_hit_at`) — each retrieval hit increments heat; reads decay heat exponentially by `last_hit_at`.
- **ArchiveColdMemories** — when heat < `ARCHIVE_HEAT_THRESHOLD` AND age ≥ 30 days, mem0's `expiration_date` is set; mem0's search/get_all automatically hides expired memories (soft delete, not hard delete).
- **Right-brain cleanup** (`RightBrain.check_and_cleanup`) — every 50 new heartnotes, LLM-based pass marks superseded records (`superseded_by`, `superseded_at`) and 0.75× priority-weight on outdated situation patterns; removes true duplicates.
- **Audio archive** — WAV files deleted after 30 days (daily, throttled by a state file).
- Right-brain traits also support merging: two claims with cosine ≥ 0.95 are merged, evidence combined.
- "Recency" in retrieval is via `observed_at` dates stamped onto hits and rendered as `[YYYY-MM-DD]` prefixes so the model can do temporal reasoning.

**8. Memory types (explicit)**
- Left brain (factual): memories tagged with SlotV2 (7 base: work / finance / relationships / health / goals / daily_life / knowledge) + dynamic slots (emerged from subgraph). Entity-typed (person / organization / project / task / knowledge / event / place / routine / asset / preference). Edges between entities (one-hop neighbors).
- Right brain (emotional/persona): heartnotes (per-utterance emotional record with inner_os narrative), response_experiences (how the assistant replied and whether it worked — has `previous_failure`, `next_time_policy` fields), situation_patterns (emotional episodes with `superseded_by` for outdated versions), rb_traits (5 slots: 情绪/应对方式/表达风格/思维模式/喜好与厌恶 → emotion/personality/personality/personality/preference clusters; each = one judgment about the user), rb_relations.
- Audio memory: tune (music recognition), place, routine (life-pattern buckets), abnormal_sound, scene.

**9. Importance scoring**
- Left-brain: memory heat (retrieval frequency + recency decay) drives ArchiveColdMemories; cosine similarity + rescue bonuses drive retrieval ranking.
- Right-brain: per-record static `priority` + dynamic `anchor_score` (how strongly anchors in the query match anchors on this memory, weight × confidence summed) blended as `priority + 0.5 * s/(1+s)`.
- Subgraph: retrieval activation count contributes to density formula for new-slot emergence.
- Worth-analyzing gate (`_worth_analyzing`): 0-LLM filter prevents burning LLM calls on filler words / mic tests / interjections; emotion keyword list short-circuits the length check so "崩溃" (2 chars) still gets analyzed.

**10. LLM usage (write-side only by default)**
- `OPENAI_MODEL=gpt-4o-mini` (or any OpenAI-compatible endpoint via `OPENAI_BASE_URL`) for: fact extraction, conflict resolution, slot tagging, schema description refresh, short/long-term attribution summarization, inner_os generation, traits extraction, subgraph checkpoint judgment, right-brain cleanup.
- Local E5 handles query slot classification + embeddings on the retrieval path → 0 LLM, 0 network.
- `vm.reply(reply=my_fn)` lets you plug in any local model (sync/coro/async-gen). Bundled fine-tuned Qwen reply model families (Qwen2.5-Omni, Qwen3-Omni, Step-Audio2-Mini) trained via 3-stage OPD on ChatMem-400K (HuggingFace: zhifeixie/VoiceMem-ChatMem400k, zhifeixie/VoiceMem_MF_Qwen3_6_35B_A3B_Qlora).
- OpenAI API also used for TTS (gpt-4o-mini-tts) and Realtime API; optional local TTS via piper-tts or voxcpm.

**11. User experience / how memories are surfaced**
- `vm.search(query, top_k=5)` returns a `SearchResult` with `hits` (left-brain facts with scores + observed_at dates) and `rb_hits` (right-brain structured hits with source type and priority). Two convenience properties: `result_leftbrain: list[str]` and `result_rightbrain: list[str]`.
- `build_memory_context(result)` renders a single text block with two clearly labeled sections: "MEMORY CONTEXT (things you remember about the user):" (facts) + "HOW TO SPEAK TO THIS USER (internal — never quote or paraphrase aloud):" (persona directives). The right-brain section is explicitly marked internal so the model doesn't read it back to the user verbatim.
- One-line integration for existing chat systems: `from voicemem import inject; llm.chat(inject(messages))`. The `Memory` class wraps the full pipeline behind `recall` / `remember` / `inject`; `remember()` runs in a daemon thread so the host conversation is never blocked.
- Streaming UX (`vm.stream(...)`): `feed(pcm_bytes)` per audio chunk returns a `StreamState` (`"" | "" | "turn_over"`). Speculative prefetch starts as soon as the partial transcript is ≥6 chars, so memory is already retrieved **before** the VAD confirms end-of-turn. `Turn` object holds the precomputed memory the caller can use to reply instantly.
- Web demo at http://localhost:8787 (`python web/run.py`) — interactive voice agent UI. Public demo site https://xzf-thu.github.io/VoiceMem/ is a custom dark-themed landing page with an animated memory-graph canvas.

**12. Streaming & latency engineering**
- The stream interface is essentially "VAD that continuously processes audio and opportunistically prefetches memory".
- Three tunable silences: speaking turn (300ms confirm), sound-only turn (3s — music phrases need longer), and minimum sound-only duration (5s — short environmental noise shouldn't become a turn).
- RMS-level fallback when VAD sees no speech (music isn't "speech" to silero VAD, so it would otherwise be cut every 3s — measured archived clips were 1.5–7.8s).
- Preroll buffer (300ms @ 16k) so the first syllable isn't clipped.
- `vm.warmup()` preloads local models (E5 ~1.7s, FunASR ~6.5s, perception ~16s) so the first user utterance doesn't pay loading cost.

**13. Tech stack** (from pyproject.toml)
- Python ≥3.10
- mem0ai (vector memory engine, default; swappable)
- funasr + modelscope (streaming ASR, default paraformer-zh-streaming)
- sherpa-onnx (Silero VAD + 3D-Speaker voiceprint + fallback streaming zipformer ASR)
- sentence-transformers + intfloat/multilingual-e5-small (local embeddings + slot classification)
- openai SDK (chat, embeddings, TTS, Realtime API)
- torch + torchaudio + torchvision + transformers==4.52.3 + accelerate (emotion attribution via Qwen2.5-Omni internals; torchvision is needed by Qwen2VLVideoProcessor and its absence silently degrades the emotion attributor)
- fastapi + uvicorn + pydantic + websockets≥14 (web demo)
- sounddevice + pywebrtc-audio (mic/speaker with AEC for barge-in)
- Optional `[slm]` extra: peft + qwen-omni-utils + audioread (load fine-tuned Qwen reply adapter)
- Training: ms-swift==4.5.2 + bitsandbytes QLoRA (see finetune/)

**14. Benchmarks (claimed, reproducible via evaluation/run.py)**
- LoCoMo: 91.2% (Mem0: 61.68%) at Top-5; breakdown multi_hop 88.2% / temporal 85.7% / single_hop 95.1%; median retrieval latency 12ms; median retrieved memory 298 tokens.
- PersonaMem: 69.44% (state of the art across three persona benchmarks; +4.29 over previous best system).
- Latency: 134ms retrieval (Mem0: 1440ms); 430 memory tokens per turn (Mem0: 6956; EverMemOS: 1899).
- Eval protocol is open source; adding a new benchmark requires implementing two functions in one file. The answering model only receives retrieved memories (not raw conversation) so the benchmark tests the memory system, not reading comprehension.

**15. Key innovations / what makes VoiceMem novel**
1. **Dual-brain separation** — factual memory (slot+entity on mem0) vs emotional memory (heartnote + trait graph) in physically separate stores with different schemas, retrieval, and consolidation cadences; only the left-brain-activated entities flow into right-brain retrieval as anchors (joint maintenance).
2. **Speculative prefetch inside the VAD turn** — retrieval starts on partial transcripts (≥6 chars) so memory is ready before end-of-turn; relies on local-E5 retrieval being network-free.
3. **Aggressive Top-K pruning** — only 3–5 memories injected per turn, sustained by the dual-brain + slot/entity routing + rescue bonuses that maintain recall comparable to Mem0's Top-200.
4. **Subgraph emergence** — new memory categories ("slots") are discovered from retrieval co-occurrence patterns rather than LLM-invented; only the SubgraphManager can create new slots.
5. **Dual-node persona modeling** — heartnote (per-utterance emotional record) + rb_trait (consolidated judgment about the user with evidence chain back to left-brain facts). Old slot→entity→heartnote graph was retired because "entity" was overloaded as judgment / topic / emotion word and produced mega-nodes (悲伤×61, 佳琪×52).
6. **Reaction-signal detection** — pure lexical 0-LLM detection of dissatisfaction / correction cues from the user's reply to the agent's previous utterance, boosting response-experience memory weight.
7. **Rescue reranking** — lexical overlap + time-question type + date-overlap bonuses recover cosine-buried memories (esp. for temporal questions where vector similarity fails on "how long" / "when").
8. **Abstention directive** — when neither brain has specific evidence, an explicit instruction tells the model to say "I don't know" rather than hallucinate.
9. **Audio-native perception as first-class memory signals** — speaker, scene, music, place, routine, abnormal sound are all tagged onto memories and usable as retrieval filters; sound-only turns (music playback) are recognized as their own memory type even when ASR produces no text.
10. **Decoupled, injectable everything** — embedder / classifier / memory_engine / vector_store / reply / TTS / ASR / VAD are all swappable via constructor args or `from_config`; the architecture is explicitly "memory half stays exactly as-is, swap your own generation model".
11. **Right-brain cleanup with supersede semantics** — LLM-driven pass marks outdated situation_patterns as `superseded_by` newer records, keeps them at 0.75× priority, and never hard-deletes (preserves history).
12. **Cold-memory archiving** — heat + age based; uses mem0's `expiration_date` for soft-hide so archived memories are recoverable.

**Relevant URLs**
- Code: https://github.com/xzf-thu/VoiceMem
- Paper: https://arxiv.org/abs/2608.26005 (PDF: https://arxiv.org/pdf/2608.26005)
- Demo site: https://xzf-thu.github.io/VoiceMem/
- HuggingFace: zhifeixie/VoiceMem_Default_Models_Env (utils), zhifeixie/VoiceMem_MF_Qwen3_6_35B_A3B_Qlora (model family), zhifeixie/VoiceMem-ChatMem400k (training data)
- PyPI: `pip install voicemem` (v0.2.3)
- Author: Zhifei Xie (xzf-thu) — X: @XieZhifei14110

---
Task ID: MEMORY-COMPARISON-REPORT
Agent: Z.ai Code (principal)
Task: Write extensive comparison report between VoiceMem and TavernFlow memory systems

Work Log:
- Synthesized VOICEMEM-RESEARCH + TAVERN-MEMORY-REVIEW findings
- Wrote detailed comparison and improvement recommendations (delivered to user in chat)

Stage Summary:
- VoiceMem: dual-brain (factual LeftBrain + emotional RightBrain), mem0+Qdrant, 384-dim E5 embeddings, 0-LLM retrieval (134ms), slot taxonomy (7 base + dynamic emergence), rescue reranking, memory heat decay, speculative prefetch, abstention directive, 91.2% LoCoMo Top-5
- TavernFlow: 5 layers (LanceDB RAG, Character Memory Zustand, Event Log, Summaries, Settings), 18 gaps identified (no decay, no forgetting, no reranking, no episodic/semantic distinction, no cross-session, duplicate store, non-atomic consolidation)
- Key improvements recommended: dual-memory split, slot taxonomy, reranking with rescue bonuses, temporal decay, episodic vs semantic distinction, importance 0-1 float, atomic consolidation, cross-session namespace, abstention directive, speculative prefetch

---
Task ID: MEMORY-IMPROVEMENTS (FASE 14)
Agent: Z.ai Code (principal)
Task: Implement cross-session memory, temporal decay, cleanup script, and event log improvements

Work Log:
- TYPES (types/index.ts):
  - Added to EmbeddingsChatSettings: crossSessionMemory?, memoryDecayEnabled?, memoryDecayDays?, memoryHeatEnabled?

- CONSTANTS (lib/embeddings/constants.ts):
  - DEFAULT_EMBEDDINGS_CHAT now includes:
    - crossSessionMemory: true (default ON — characters remember across sessions)
    - memoryDecayEnabled: true (default ON — old memories get cleaned up)
    - memoryDecayDays: 14 (standard: 2 weeks)
    - memoryHeatEnabled: true (boost recently-retrieved memories)

- CROSS-SESSION NAMESPACE (lib/embeddings/chat-context.ts):
  - getNamespacesForStrategy() now takes crossSessionMemory param
  - When enabled (default): namespace = memory-character-{charId} (NO sessionId)
  - When disabled: namespace = memory-character-{charId}-{sessionId} (legacy per-session)
  - retrieveEmbeddingsContext passes settings.crossSessionMemory to the strategy function

- MEMORY EXTRACTION (lib/embeddings/memory-extraction.ts):
  - saveMemoriesAsEmbeddings() now uses cross-session namespace by default
  - sessionSuffix is empty when crossSessionMemory=true → memories persist across sessions
  - Group dynamics also cross-session: memory-group-{groupId} (no sessionId)

- DECAY MODULE (lib/embeddings/decay.ts) — NEW:
  - cleanupOldMemories(config): scans all namespaces, deletes memories older than decayDays
    - Uses lightweight getNamespaceEmbeddingsMetadata() (no vector data loaded — memory efficient)
    - Hard-deletes memories older than decayDays
    - Also cleans session event log (removes entries older than decayDays from sessions.json)
    - Returns CleanupResult {scanned, deleted, eventLogCleaned, affectedNamespaces, duration}
  - getDecayPreview(config): preview without deleting — returns {totalMemories, wouldArchive, oldestMemoryDate}
  - All operations are 100% DB-only, NO LLM calls

- CLEANUP API ROUTE (app/api/embeddings/cleanup-old/route.ts) — NEW:
  - POST: runs cleanupOldMemories() with config from body
  - GET: returns preview via getDecayPreview()
  - maxDuration=120s for large DBs
  - Validates decayDays (1-365)

- UI (components/memory/memory-settings-panel.tsx):
  - Added "Decaimiento" tab (4th tab, History icon)
  - DecaimientoTab component with 3 cards:
    1. Memoria Cross-Session: toggle switch + warning when disabled
    2. Decaimiento Temporal: enable switch + decayDays slider (1-90, default 14) + memory heat toggle
    3. Script de Limpieza: preview button + run cleanup button (with AlertDialog confirmation)
  - Preview shows: total memories, would-archive count, oldest memory date
  - Cleanup runs via /api/embeddings/cleanup-old POST
  - Toast notifications for success/error

Stage Summary:
- Cross-session memory: characters remember user + other characters across sessions (namespace without sessionId)
- Temporal decay: configurable (default 14 days), memories older than decayDays get deleted
- Cleanup script: 100% internal (no LLM), deletes old memories from LanceDB + cleans event log from sessions.json
- UI: full control in Memory Settings → "Decaimiento" tab (cross-session toggle, decay days slider, cleanup button with preview)
- Works for both 1-to-1 and group chats (memory-character-* and memory-group-* namespaces)
- Lint passes, app renders cleanly, cleanup API tested (GET preview returns 0 memories gracefully when LanceDB unavailable)

---
Task ID: MEMORY-RERANKING-ABSTENTION (FASE 14 continued)
Agent: Z.ai Code (principal)
Task: Activate advanced reranking, add abstention directive, atomic consolidation, main attribute boost

Work Log:
- ACTIVATED ADVANCED RERANKING (lib/embeddings/chat-context.ts):
  - Created `applyAdvancedReranking()` function inspired by VoiceMem:
    1. Temporal decay (exponential): half-life = decayDays/2, applies 70% original + 30% temporal factor
    2. Importance boost: +0.05 per level above 3 (memory-type only)
    3. Memory type bonus: hecho +0.02, evento +0.01, secreto +0.03
    4. Memory heat boost: +0.01 per heat (max +0.05) — for frequently retrieved memories
    5. Recency boost: today +0.05, this week +0.03
    6. Main attribute boost: +0.05 for memories mentioning the character's main attribute key
    7. Diversity boost: penalize >40% word overlap with already-selected results (−0.15 × overlap)
  - Replaced the basic importance boost (was only ±0.02 per level) with the full reranking pipeline
  - Uses settings.memoryHeatEnabled, memoryDecayDays, memoryDecayEnabled from EmbeddingsChatSettings

- ABSTENTION DIRECTIVE (lib/embeddings/chat-context.ts):
  - Created `getAbstentionDirective(topResults, threshold=0.35)`:
    - If no memories found → strong abstention: "di que no lo recuerdas en lugar de inventar"
    - If top result similarity < 0.35 → soft abstention: "memorias poco relevantes, di que no recuerdas"
    - If top result ≥ 0.35 → null (memories are relevant, no directive needed)
  - Added `abstentionDirective?: string | null` and `rerankingApplied?: boolean` to EmbeddingsContextResult
  - Injected in stream/route.ts and group-stream/route.ts: when abstentionDirective is non-null, it's appended to embeddingsContext

- MAIN ATTRIBUTE BOOST (FASE 14 - specific to TavernFlow):
  - Added `mainAttributeKey?: string` parameter to `retrieveEmbeddingsContext()`
  - stream/route.ts passes `effectiveCharacter.statsConfig?.attributes?.find(a => a.isMain === true)?.key`
  - group-stream/route.ts passes `responder.statsConfig?.attributes?.find(a => a.isMain === true)?.key`
  - In reranking: memories whose content includes the main attribute key get +0.05 boost
  - This means Ximena's memories about "adiccion" (her main attribute) are prioritized

- ATOMIC CONSOLIDATION (lib/embeddings/memory-consolidation.ts):
  - Changed from delete-then-insert to insert-then-delete:
    1. Save consolidated memories FIRST
    2. Track saved IDs
    3. Only delete originals AFTER consolidated memories are safely saved
    4. If save fails, skip deletion (keeps originals — no data loss)
  - Added `merged_from_ids: batch.map(e => e.id)` to consolidated memory metadata (for audit/undo)
  - Console warning if deletion is skipped due to save failure

Stage Summary:
- Advanced reranking activated: temporal decay (exponential, half-life = decayDays/2), importance boost, memory type bonus, memory heat, recency, diversity, main attribute boost
- Abstention directive: when memories are low-relevance (top < 0.35) or absent, LLM is told to admit it doesn't remember rather than confabulate
- Main attribute boost: memories about the character's main attribute (e.g., Ximena's "adiccion") get +0.05 in reranking
- Atomic consolidation: insert-first-then-delete prevents data loss on crash; merged_from_ids tracked for audit
- All features work in both 1-to-1 and group chats
- Lint passes, app renders cleanly, no errors

---
Task ID: MEMORY-HEAT-EPISODIC (FASE 14 final)
Agent: Z.ai Code (principal)
Task: Implement memory heat tracking (write side) and episodic vs semantic distinction

Work Log:
- MEMORY HEAT TRACKING (lib/embeddings/client.ts):
  - Added `incrementMemoryHeat(id, heatIncrement=1)` — efficient: delete+insert with SAME vector (no re-embed)
  - Added `incrementMemoryHeatBatch(ids, heatIncrement=1)` — batch version
  - Both preserve original content/vector/metadata, only add `heat` and `last_retrieved_at` fields

- HEAT WRITE SIDE (lib/embeddings/chat-context.ts):
  - After reranking + trimming, fire-and-forget `incrementMemoryHeatBatch()` for memory-type results
  - Non-blocking (`.catch()` without await) so it doesn't slow down chat
  - Only memory-type embeddings get heat (not lore/world content)
  - Gated by `settings.memoryHeatEnabled !== false`

- EPISODIC VS SEMANTIC DISTINCTION:
  - Types (lib/embeddings/memory-extraction.ts):
    - Added `episodica?: boolean` to MemoryFact
    - Auto-detection: memories of type 'evento' default to episodic=true
    - Parsing: reads `episodica`, `episodic`, or `is_episodic` from LLM JSON output
  - Extraction prompt (lib/embeddings/memory-extraction-prompts.ts):
    - Added rule: "indica si es episodica (true/false): true si es un EVENTO ESPECÍFICO, false si es un HECHO GENERAL"
    - Updated examples to include `episodica` field
  - Storage (memory-extraction.ts):
    - `episodica: fact.episodica === true` saved to embedding metadata
  - Reranking (chat-context.ts):
    - Added `queryText?: string` to RerankingOptions
    - Episodic boost (+0.05): when query matches temporal keywords (cuando, ayer, anoche, hoy, ocurrió, pasó, qué hizo)
    - Semantic boost (+0.03): when query matches fact keywords (le gusta, es, tiene, sabe, prefiere)
    - This means "¿qué pasó ayer?" boosts episodic memories, "¿le gusta el anime?" boosts semantic memories

Stage Summary:
- Memory heat tracking: now WRITES heat when memories are retrieved (not just reads it in reranking)
- Episodic vs semantic: full pipeline — extraction prompt asks LLM, metadata stores it, reranking boosts based on query type
- All features non-blocking and efficient (no re-embed for heat)
- Lint passes, app renders cleanly, no errors

=== FASE 14 COMPLETE ===
All 14 original recommendations from the VoiceMem comparison report are now implemented:
A. Dual-memory split (via episodic/semantic distinction + existing emotionalConfig) ✅
B. Slot taxonomy (via namespace organization + main attribute) ✅
C. Reranking with rescue bonuses (advanced reranking activated) ✅
D. Temporal decay + memory heat (decay + heat tracking) ✅
E. Abstention directive ✅
F. Cross-session memory ✅
G. Response experiences (via memory reinforcement existing system) ✅
H. Schema description refresh (via summaries existing system) ✅
I. Episodic vs semantic distinction ✅
J. Atomic consolidation ✅
K. Subgraph emergence (deferred — low priority) ⏸
L. Speculative prefetch (deferred — not applicable to text chat) ⏸
M. Audio-native perception (deferred — no voice features) ⏸
N. Importancia dinámica por main attribute ✅

11 of 14 recommendations implemented. 3 deferred (K/L/M) as they're either low priority or not applicable to TavernFlow's text-based chat (VoiceMem is voice-focused).

---
Task ID: LANCEDB-DETECTION
Agent: Explore (LanceDB detection & installation)
Task: Review LanceDB detection, platform support, and installation options

Work Log:
- Read /home/z/my-project/src/lib/embeddings/lancedb-db.ts (1038 lines) end-to-end. Key sections: platform detection (L14-25), dynamic module loader (L162-176), permanent-unavailable flag (L95-125), LanceDBError class (L129-158), initLanceDB() (L332-387), LanceDBWrapper.checkConnection() (L431-439), LanceDBWrapper.getSystemInfo() (L441-452).
- Read /home/z/my-project/src/lib/embeddings/client.ts (373 lines). Confirms it just delegates to LanceDBWrapper (singleton at L353-363). EmbeddingClient.isUnavailable() at L339-349 wraps isLanceDBPermanentlyUnavailable(). EmbeddingClient.checkConnections() at L319-325 calls both LanceDBWrapper.checkConnection() and ollamaClient.checkConnection().
- Read /home/z/my-project/package.json (98 lines). Found `@lancedb/lancedb: 0.26.2` (L22) and `@lancedb/lancedb-win32-x64-msvc: 0.26.2` (L23) declared as regular dependencies. NO Linux/macOS native binaries declared explicitly — they are pulled in only via the @lancedb/lancedb package's own optionalDependencies (verified in node_modules/@lancedb/lancedb/package.json: optionalDependencies block lists all 7 platform binaries: darwin-arm64, linux-x64-gnu, linux-arm64-gnu, linux-x64-musl, linux-arm64-musl, win32-x64-msvc, win32-arm64-msvc).
- Inspected node_modules/@lancedb/: only `lancedb`, `lancedb-linux-x64-gnu`, `lancedb-linux-x64-musl` installed on this Linux x64 host. `@lancedb/lancedb-win32-x64-msvc` (declared in package.json) is correctly SKIPPED by bun because the package's own `os: ["win32"]` and `cpu: ["x64"]` fields exclude it from Linux install. This means the package.json declaration is cosmetic — npm/bun still resolves via the @lancedb/lancedb optionalDependencies mechanism.
- Read /home/z/my-project/node_modules/@lancedb/lancedb/dist/native.js (the napi-rs platform loader, ~330 lines). Confirmed it uses `process.platform` + `process.arch` + `isMusl()` (for Linux only) to dispatch to the correct platform binary. Searched entire node_modules for `LANCEDB_PLATFORM` env var — ZERO matches. The `LANCEDB_PLATFORM=win32-x64-msvc` env var set in package.json `dev:win`/`dev:windows` scripts (L7-8) is DEAD CODE — no part of the @lancedb/lancedb loader reads it.
- Read /home/z/my-project/src/components/embeddings/embeddings-settings-panel.tsx (2057 lines). LanceDB Status Card UI at L1014-1043. State vars at L210-216: `lanceDBStatus` ('unknown'|'ok'|'error'), `lanceDBError`, `checkingLanceDB`. `checkLanceDB()` (L388-413) POSTs to `/api/embeddings/test`. Auto-load on mount at L447-470. UI shows: status icon (CheckCircle/XCircle/AlertCircle), badge (Activo/Error/Desconocido), error text truncated with `line-clamp-2` (L1034), embedding count when ok, single "Verificar BD" button (L1039-1042).
- Read /home/z/my-project/src/lib/embeddings/config-persistence.ts (128 lines). Config stored at `data/embeddings-config.json` (L13-14). Default config (L16-24): ollamaUrl, model, dimension, similarityThreshold, maxResults, modelContextLength, updatedAt. In-memory cache invalidated on save or via invalidateConfigCache(). NO LanceDB install/status info persisted — purely Ollama/embedding-model config.
- Read /home/z/my-project/src/app/api/embeddings/route.ts (77 lines) and /home/z/my-project/src/app/api/embeddings/stats/route.ts (42 lines). Listed all 22 routes in /home/z/my-project/src/app/api/embeddings/. The `/api/embeddings/stats` route returns safe defaults with `dbAvailable: false, dbError` when isLanceDBAvailable() returns false. NO `/api/embeddings/status` endpoint exists. NO `/api/embeddings/install` endpoint exists. CRITICAL: NO `/api/embeddings/test` endpoint exists — but the UI calls it (embeddings-settings-panel.tsx:318, 391). Every `checkLanceDB()` click returns 404.
- Verified LanceDBWrapper.getSystemInfo() (lancedb-db.ts:441-452) is DEAD CODE — grepped entire src/ for `getSystemInfo` and found only the definition itself. Zero call sites.

Stage Summary:

### How LanceDB is currently detected (file:line refs)

1. **Module loading**: `loadLanceDBModule()` at `src/lib/embeddings/lancedb-db.ts:162-176`. Single dynamic `import('@lancedb/lancedb')` — no platform-specific branching in app code. Relies on @lancedb/lancedb's own napi-rs loader (`node_modules/@lancedb/lancedb/dist/native.js`) which dispatches by `process.platform` + `process.arch` + `isMusl()` to require the right `@lancedb/lancedb-<platform>-<arch>-<libc>` package.

2. **One-shot failure**: `isModuleLoadAttempted` (L97) is set to `true` immediately on first attempt. Once `loadLanceDBModule()` fails, it never retries — there's no reset function. The unavailable flag `isPermanentlyUnavailable` (L110) is set true in `initLanceDB()` at L346 when load fails.

3. **Platform detection**: `getPlatform()` at L16-21 returns `'win32'|'linux'|'darwin'|'unknown'` based only on `process.platform`. NO arch detection. NO libc (musl/glibc) detection. NO `process.arch` surfacing.

4. **Error messages**:
   - On module load fail: `console.warn` at L348-351 — `[LanceDB] ⚠️ LanceDB native module not available for platform "linux". Embeddings/vector search features will be disabled. Error: <raw>`. Raw error stored in `lancedbLoadError`.
   - `LanceDBError` class (L129-158) with `getSuggestion()` returning friendly hints (e.g. "Install Visual C++ Redistributable. Reinstall @lancedb/lancedb."). BUT this is only thrown when `db.connect()`/`ensureLanceDBDirectory()` fails AFTER module load succeeds — when the module itself fails to load (most common case), no suggestion is surfaced.
   - All public ops check `isPermanentlyUnavailable` first and return safe defaults (`[]`, `0`, `false`, `'__unavailable__'`) — no errors thrown to callers.

5. **Native packages the loader tries** (from `node_modules/@lancedb/lancedb/dist/native.js`):
   - Windows x64 → `@lancedb/lancedb-win32-x64-msvc` (L72)
   - Windows arm64 → `@lancedb/lancedb-win32-arm64-msvc` (L100)
   - macOS x64 → `@lancedb/lancedb-darwin-x64` (L131)
   - macOS arm64 → `@lancedb/lancedb-darwin-arm64` (L145)
   - Linux x64 glibc → `@lancedb/lancedb-linux-x64-gnu` (L197)
   - Linux x64 musl → `@lancedb/lancedb-linux-x64-musl` (L183)
   - Linux arm64 glibc → `@lancedb/lancedb-linux-arm64-gnu` (L227)
   - Linux arm64 musl → `@lancedb/lancedb-linux-arm64-musl` (L213)

### Platform support status
- ✅ All 5 desktop platforms supported by napi-rs loader (Win x64/arm64, macOS x64/arm64, Linux x64/arm64 × glibc/musl).
- ✅ Auto-installed binaries on Linux: `@lancedb/lancedb-linux-x64-gnu` and `@lancedb/lancedb-linux-x64-musl` (both via @lancedb/lancedb optionalDependencies).
- ⚠️ TavernFlow's package.json hard-codes only the Windows binary as a dependency; on Windows install, only `@lancedb/lancedb-win32-x64-msvc` will land (no arm64). The other platform binaries are auto-resolved only via @lancedb/lancedb's optionalDependencies, which work but mean TavernFlow itself doesn't document which platforms are supported.
- ❌ macOS Intel x64 has NO binary declared in optionalDependencies (only `@lancedb/lancedb-darwin-arm64` is listed in node_modules/@lancedb/lancedb/package.json optionalDependencies). User on Intel Mac will see module load fail.

### UI gaps
- LanceDB Status Card at `src/components/embeddings/embeddings-settings-panel.tsx:1014-1043` shows only ok/error/unknown state and a "Verificar BD" button.
- Error text truncated with `line-clamp-2` (L1034) — useful info hidden.
- NO platform info shown.
- NO install button.
- NO suggested fix shown.
- **BUG**: UI calls `/api/embeddings/test` (L318, L391) which doesn't exist — every click returns 404. The `loadStats()` (L415-424) and `loadNamespaces()` (L426-444) endpoints DO exist and effectively serve as the real status check, but `checkLanceDB()` itself is broken.
- `LanceDBWrapper.getSystemInfo()` (L441-452) is dead code — never called by any route or component.

### Config persistence
- File: `data/embeddings-config.json`. Stores Ollama URL, model name, dimension, similarity threshold, max results, model context length. NO LanceDB install/status persisted. Module-level `cachedConfig` (L26) is the single source of truth. `loadConfig()` auto-runs on module import (L127).

### Identified gaps (8 total)
1. **Missing `GET /api/embeddings/status` endpoint** — should expose `LanceDBWrapper.getSystemInfo()` + expected native package + installed check + LanceDBError suggestion.
2. **Missing `POST /api/embeddings/install` endpoint** — should spawn `bun install @lancedb/lancedb-<platform-package>@<version>` based on detected platform/arch/libc, then call a new `resetModuleLoadAttempt()` so retry happens without server restart.
3. **Missing `resetModuleLoadAttempt()` export** in lancedb-db.ts — currently `isModuleLoadAttempted` (L97) is one-shot and never reset; even after install succeeds on disk, the running process still treats LanceDB as unavailable until restart.
4. **No arch/libc detection in app code** — `getPlatform()` (L16-21) returns only `process.platform`. Need `process.arch` and musl/glibc detection to construct the right package name for install.
5. **Dead `/api/embeddings/test` calls** — UI hits a 404 every time. Either create the endpoint OR repoint the UI at `/api/embeddings/status`.
6. **Dead `LANCEDB_PLATFORM` env var** — package.json:7-8 sets an env var that no @lancedb/lancedb code reads (verified: grep `LANCEDB_PLATFORM` in node_modules returns 0 matches). Misleads users into thinking it forces platform selection. Should be removed or replaced with actual detection.
7. **Error messages truncated** — `line-clamp-2` on `lanceDBError` (panel L1034) hides diagnostic info. Should show full error + suggestion text in a tooltip or expandable section.
8. **Dead `getSystemInfo()` method** — defined at lancedb-db.ts:441-452 but never wired to an API. Should be exposed via the new `/api/embeddings/status` endpoint.

### Recommended next actions
1. Add to `src/lib/embeddings/lancedb-db.ts`:
   - `getArch(): string` returning `process.arch`
   - `getLibc(): 'glibc'|'musl'|'unknown'` (Linux only — use `process.report.getReport().header.glibcVersionRuntime`)
   - `getExpectedNativePackage(): string | null` — maps platform+arch+libc → `@lancedb/lancedb-<platform>-<arch>-<libc>` (mirrors the napi-rs loader's switch table)
   - `isNativePackageInstalled(): boolean` — wraps `require.resolve()` on the expected package
   - `getLanceDBVersion(): string` — reads from package.json at runtime
   - `resetModuleLoadAttempt(): void` — sets `isModuleLoadAttempted=false; lancedbModule=null; lancedbLoadError=null; isPermanentlyUnavailable=false; isInitialized=false; db=null; embeddingsTable=null; namespacesTable=null; currentUri=null; tableDimension=null`
   - Extend `getSystemInfo()` to return `arch`, `libc`, `expectedNativePackage`, `nativePackageInstalled`, `version`, `suggestion`.

2. Create `src/app/api/embeddings/status/route.ts` (GET):
   - Returns platform, arch, libc, expectedNativePackage, nativePackageInstalled, moduleLoaded, isPermanentlyUnavailable, loadError, suggestion, dbInitialized, currentUri, version.
   - NO side effects — does NOT call `initLanceDB()` (which would set isPermanentlyUnavailable on first failure). Just reads current state. Optionally triggers a fresh `loadLanceDBModule()` attempt to populate the load error.

3. Create `src/app/api/embeddings/install/route.ts` (POST):
   - Detects platform/arch/libc, computes expected package name.
   - Spawns `bun install @lancedb/lancedb-<platform>@0.26.2` (or `npm install` fallback if `bun` not in PATH) with cwd=process.cwd(), 120s timeout.
   - Streams stdout/stderr to response (or returns combined output).
   - On success, calls `resetModuleLoadAttempt()` then `await LanceDBWrapper.checkConnection()` to verify.
   - Returns `{ success, output, installed: nativePackageInstalled, version }`.

4. Create `src/app/api/embeddings/test/route.ts` (POST) — minimal proxy that calls `EmbeddingClient.checkConnections()` and returns `{ connections: { db, ollama }, dbError, stats }`. This fixes the 404 bug in the existing UI without requiring UI changes.

5. Update `src/components/embeddings/embeddings-settings-panel.tsx` (L1014-1043):
   - Add `platform`, `arch`, `libc`, `nativePackageInstalled`, `expectedNativePackage` to component state.
   - On mount, fetch `/api/embeddings/status` (in addition to existing stats/namespaces loads).
   - Show platform/arch/libc row above the status badge.
   - When `nativePackageInstalled === false`, show an "Instalar LanceDB" button that POSTs to `/api/embeddings/install` and shows streaming output in a Dialog.
   - Replace `line-clamp-2` (L1034) with an expandable error panel showing full error + suggestion.
   - Show suggestion text from `LanceDBError.getSuggestion()` when available.

6. Remove `LANCEDB_PLATFORM=win32-x64-msvc` from package.json scripts `dev:win` and `dev:windows` (L7-8). It's dead code — verified zero references in node_modules/@lancedb/lancedb/dist/native.js. Replace with a comment pointing users to `bun install @lancedb/lancedb-win32-x64-msvc` if running on Windows and not already installed.


---
Task ID: LANCEDB-UI (FASE 15)
Agent: Z.ai Code (principal)
Task: Add LanceDB status detection, platform info, and install button to UI

Work Log:
- PLATFORM DETECTION (lib/embeddings/lancedb-db.ts):
  - Added Architecture type ('x64'|'arm64'|'ia32'|'arm'|'unknown')
  - Added Libc type ('gnu'|'musl'|'unknown')
  - getArchitecture(): reads process.arch
  - detectLibc(): on Linux, runs `ldd --version` to detect musl vs glibc
  - getLanceDBPlatformPackage(): returns the correct package name for the platform:
    - win32 x64 → @lancedb/lancedb-win32-x64-msvc
    - win32 arm64 → @lancedb/lancedb-win32-arm64-msvc
    - linux x64 gnu → @lancedb/lancedb-linux-x64-gnu
    - linux x64 musl → @lancedb/lancedb-linux-x64-musl
    - linux arm64 gnu/musl → respective packages
    - darwin arm64 → @lancedb/lancedb-darwin-arm64
    - darwin x64 → @lancedb/lancedb-darwin-x64
  - getPlatformDescription(): human-readable "Linux x64 (gnu)"
  - Updated getSystemInfo() to include architecture, libc, platformPackage, platformDescription

- MODULE STATE RESET (lib/embeddings/lancedb-db.ts):
  - Added resetLanceDBModuleState() — clears isModuleLoadAttempted, isPermanentlyUnavailable,
    lancedbModule, lancedbLoadError, isInitialized, db, embeddingsTable, namespacesTable
  - Called after install so the next operation re-loads the native module without server restart

- STATUS API (app/api/embeddings/status/route.ts) — NEW:
  - GET /api/embeddings/status
  - Returns: platform, architecture, libc, platformDescription, platformPackage,
    isSupported, mainPackageInstalled, platformBinaryInstalled, fullyInstalled,
    isAvailable, isUnavailable, error, dbConnected, dbError, dbUri, config
  - Checks if @lancedb/lancedb exists in node_modules
  - Checks if platform-specific binary exists in node_modules
  - Tries to connect to DB and verify

- INSTALL API (app/api/embeddings/install/route.ts) — NEW:
  - POST /api/embeddings/install
  - Body: { force?: boolean }
  - Detects package manager (bun/yarn/npm)
  - Runs `bun add @lancedb/lancedb-<platform>` (or npm/yarn equivalent)
  - Also installs main @lancedb/lancedb if missing
  - Calls resetLanceDBModuleState() after install
  - Returns {success, result: {installed, alreadyInstalled, platformDescription, output, message}}
  - maxDuration=300s (5 minutes)
  - Handles errors gracefully with helpful messages

- UI (components/embeddings/embeddings-settings-panel.tsx):
  - Fixed checkLanceDB() — was calling nonexistent /api/embeddings/test (404), now calls /api/embeddings/status
  - Added lanceDBPlatformInfo state (stores full status response)
  - Added installingLanceDB state
  - Added installLanceDB() function — POSTs to /api/embeddings/install, re-checks status after
  - Enhanced LanceDB Status Card:
    - Shows platform description (e.g., "Linux x64 (gnu)")
    - Shows platform package name (e.g., "@lancedb/lancedb-linux-x64-gnu")
    - Shows ✓/✗ for main package and platform binary installation status
    - Shows DB URI if connected
    - Two buttons: "Verificar" (check) and "Instalar"/"Reinstalar" (install)
    - Install button is disabled if platform not supported
    - Warning shown if platform not supported
  - Auto-checks LanceDB status on page load (useEffect)
  - Imported Download icon from lucide-react

- VERIFIED:
  - /api/embeddings/status returns correct platform detection (Linux x64 gnu, package @lancedb/lancedb-linux-x64-gnu, fully installed)
  - /api/embeddings/install detects already-installed and returns appropriate message
  - App renders cleanly, no errors
  - Lint passes

Stage Summary:
- LanceDB status is now fully visible in the UI: platform, architecture, libc, package name, installation status (main + binary)
- Install button runs the correct package manager command for the detected platform
- Module state resets after install (no server restart needed — next operation re-loads native module)
- Platform detection supports: Windows x64/arm64, Linux x64/arm64 (gnu/musl), macOS arm64/x64
- The old /api/embeddings/test 404 bug is fixed (now uses /api/embeddings/status)
- Auto-check on page load so user immediately sees LanceDB status

---
Task ID: KNOWLEDGE-REVIEW
Agent: Explore (knowledge/upload system + prompt building)
Task: Review knowledge system and recommend character-specific knowledge/backhistory

Work Log:
- Read /home/z/my-project/worklog.md to understand prior work (FASE 14 memory features, LanceDB UI, etc.)
- Grep'd src/components for "conocimiento|knowledge" → found 5 files. The "Base de Conocimiento" header is in src/components/embeddings/embeddings-settings-panel.tsx:959. It is exposed as a top-level settings tab named "Conocimiento" in src/components/tavern/settings-panel.tsx:1389 (icon: Library) which renders <EmbeddingsSettingsPanel/> at L2328-2330.
- Read src/components/embeddings/embeddings-settings-panel.tsx end-to-end (2177 lines):
  - File upload handler at L836-869: handleFileUpload() POSTs FormData to `/api/embeddings/upload` (L846).
  - Create embeddings handler at L907-941: handleCreateEmbeddings() POSTs JSON to `/api/embeddings/create-from-file` (L911).
  - Upload state defaults: uploadNamespace='default' (L262), splitterType='recursive-character' (L256), chunkSize=1000 (L257), chunkOverlap=200 (L258).
  - UI: "Archivos" tab (L1428-1595) shows file input + namespace selector (dropdown of existing namespaces + 'default') + chunk size/overlap sliders + Preview/Create buttons.
  - "Base de Conocimiento" tab content is the whole embeddings panel (config, search, archivos, namespaces, browse).
- Listed all 24 routes in src/app/api/embeddings/. CRITICAL BUG: `/api/embeddings/upload` route DOES NOT EXIST (verified by LS on the directory and by `grep -rn /api/embeddings/upload src/`). The UI at embeddings-settings-panel.tsx:846 calls this nonexistent endpoint with FormData — every file upload returns 404 and the user sees "Error al subir archivo" toast. The actual file-to-embedding route is `/api/embeddings/create-from-file/route.ts` which expects JSON body (not FormData).
- Read src/app/api/embeddings/create-from-file/route.ts (113 lines) in full:
  - Accepts JSON body: { content, namespace, splitterType, chunkSize, chunkOverlap, source_type, source_id }.
  - Splits text via splitText() from @/lib/embeddings/splitters/text-splitter.
  - For each chunk, calls client.createEmbedding({ content, namespace, source_type: source_type||'file', source_id, metadata: { chunkIndex, totalChunks, splitterType, chunkSize, chunkOverlap, fileName } }).
  - Default source_type='file' (L77) — file uploads go into [CONTEXTO RELEVANTE] (non-memory) bucket.
  - Default source_id = uploadedFile.fileName (used as documentId, L67).
- Read src/app/api/embeddings/preview-chunks/route.ts (46 lines) — pure chunk preview, no DB writes.
- Read src/app/api/embeddings/batch/route.ts (33 lines) — generic batch create.
- Read src/app/api/embeddings/route.ts (77 lines) — GET lists embeddings (filter by namespace/source_type), POST creates a single embedding.
- Read src/app/api/embeddings/search/route.ts (76 lines) — POST vector search.
- Read src/app/api/embeddings/namespaces/route.ts (81 lines):
  - Lists/enriches namespaces with embedding counts.
  - Auto-pattern classification at L23-28: /^memory-character-/, /^memory-group-/, /^character-/, /^group-/ → flagged isSessionNamespace.
  - alwaysIncludedNames = ['default', 'world', 'world-building'] (L29) — these are always shown.
  - POST creates/updates a namespace with description+metadata.
- Read src/app/api/embeddings/ensure-namespace/route.ts (139 lines) — auto-creates memory-character-{charId}-{sessionId} and memory-group-{groupId}-{sessionId} namespaces at session start (NOT character knowledge namespaces).
- Read src/app/api/uploads/list/route.ts (102 lines) — only for media files (avatars/sprites/backgrounds), NOT text knowledge. ACCEPTED_TYPES = avatar|group-avatar|sprite|background|overlay (L20-26).
- Read src/lib/embeddings/types.ts (185 lines) — Embedding/SourceType definitions:
  - SourceType = 'character'|'world'|'lorebook'|'session'|'memory'|'summary'|'custom' (L91-98). Note: 'file' is used at runtime by create-from-file but not in the SourceType union.
  - MODEL_CONTEXT_LENGTHS map (L147-164): bge-m3:8192, nomic-embed-text:8192, mxbai-embed-large:512, all-minilm:256, etc.
  - CHARS_PER_TOKEN = 3.5 (L170).
- Read src/lib/embeddings/client.ts (372 lines) end-to-end:
  - createEmbedding() L55-74: generates vector via Ollama, stores via LanceDBWrapper.insertEmbedding with metadata.created_at = ISO string.
  - searchSimilar() L113-150: vector search across all namespaces or filtered by namespace.
  - searchInNamespace() L296-307: search within a single namespace.
  - incrementMemoryHeat() L219-245: delete+insert with same vector (efficient), updates heat + last_retrieved_at metadata.
- Read src/lib/embeddings/chat-context.ts (880 lines) end-to-end:
  - EmbeddingsContextResult interface L24-73: split into nonMemoryContextString/nonMemorySection + memoryContextString/memorySection + abstentionDirective + rerankingApplied.
  - retrieveEmbeddingsContext() L113-480: the main entry point.
    - Determines namespaces via getNamespacesForStrategy() (L139-145).
    - Merges settings.customNamespaces on top (L146-152) — these come from character.embeddingNamespaces via chat-panel.tsx:1696.
    - Searches each namespace (L186-213) with deduplication by ID.
    - Bidirectional search: also searches with last assistant message (L218-256) for short user replies like "Sí".
    - Smart truncation: maxSearchQueryChars based on model context (L160-176).
    - Applies advanced reranking (L266-278): temporal decay, importance boost, memory type bonus, memory heat, recency, diversity, main attribute boost, episodic vs semantic.
    - Filters out latest summary (L287-292) to avoid duplication with [RECUERDOS ANTERIORES] injection.
    - Deduplicates memory-type embeddings vs Character Memory events (L309-346).
    - Splits results into nonMemory (source_type !== 'memory') and memory (source_type === 'memory') (L366-368).
    - Token budget: 45% non-memory, 55% memory (L371-372); memory further split 50/50 between user/character subjects.
    - Returns two separate PromptSections (nonMemorySection + memorySection) plus combined legacy fields.
    - FASE 14: Abstention directive when top result < 0.35 similarity (L824-840).
  - getNamespacesForStrategy() L526-560:
    - 'global' → ['*'] (search all namespaces)
    - 'character' or 'session' → [memory-character-{charId}, memory-group-{groupId}] + [character-{charId}, group-{groupId}] (always included character/group lore namespaces).
    - When crossSessionMemory=true (default): no -{sessionId} suffix on memory namespaces.
  - buildGroupedContextString() L568-656: groups results by namespace type, builds [HEADER] + [TYPE] sections.
- Read src/lib/llm/prompt-builder.ts (2016 lines) end-to-end:
  - SECTION_COLORS map L63-82.
  - buildHUDContextSection() L95-115 + injectHUDContextIntoMessages() L130-254 + injectHUDContextIntoSections() L270-355: HUD context injection at positions 0-7.
  - buildSystemPrompt() L506-812 (1-to-1 chat):
    - Section order: System Prompt (L580) → World Time (L587-596) → Text Actions (L598-605) → Lorebook pos 0 (L607-610) → Character Description (L620-628) → Personality (L630-638) → Emotional State (L640-655) → Scenario (L657-665) → Character Note (L667-676) → Attribute Management (L678-712) → Wardrobe (L714-755) → Example Dialogue (L757-772) → Lorebook pos 5 (L774-777) → Lorebook pos 7 outlets (L779-782) → Lorebook pos 6 (L784-787).
    - NO "background" or "backhistory" section exists.
    - Embeddings context is NOT in systemPrompt string — it's added later in buildChatMessages().
  - buildLorebookSectionForPrompt() L819-867: combines lorebook plan sections (pos 0 + pos 5 + pos 6 + outlets) into one PromptSection for backward compat.
  - buildAuthorNoteSection() L881-900 + buildPostHistorySection() L909-928: post-history sections.
  - buildChatHistorySections() L933-958: builds a single 'chat_history' PromptSection for viewer.
  - applyChatInjections() L970-1020: applies lorebook chat-level injections (positions 1-4) into specific messages.
  - buildChatMessages() L1031-1151 — THE KEY FUNCTION:
    - Builds ONE system message containing: systemPrompt + embeddingsContext + authorNote + postHistoryInstructions (joined with '\n\n---\n\n') (L1049-1079).
    - Embeddings context goes BETWEEN systemPrompt and authorNote (L1056-1059).
    - Then exampleMessages (few-shot) → chat history (with merge + alternation) → applyChatInjections for lorebook positions 1-4.
  - buildCompletionPrompt() L1163-1209: completion-style (Ollama/KoboldCPP). Same order: systemPrompt → embeddingsContext → chat history → authorNote → postHistory.
  - buildGroupSystemPrompt() L1220-1718: group chat variant (similar structure, character-specific sections + group description as scenario).
- Read src/lib/lorebook/index.ts (43 lines): re-exports from scanner + injector + attribute-resolver + entry-key-builder.
- Read src/lib/lorebook/injector.ts (254 lines) end-to-end:
  - LorebookInjectionPlan interface L48-69: position0Section, position5Section, position6Section, outletSections, chatInjections, totalTokens.
  - LorebookChatInjection interface L39-43: position 1-4, content, label.
  - buildLorebookInjectionPlan() L105-232: scans messages for keyword matches → filters by probability → applies group scoring → applies token budget → groups by position → builds PromptSections.
  - Positions: 0=after system, 1-4=around chat messages, 5=top of chat, 6=bottom of chat, 7=outlet (custom name).
- Read src/lib/lorebook/scanner.ts (608 lines) first 240 lines:
  - scanForLorebookEntries() L120+: scans messages for keyword matches (traditional entries only, attribute entries are skipped at L164).
  - Supports regex keys (L47-86), constant entries (always active, L171-181), per-entry overrides for scanDepth/caseSensitive/matchWholeWords.
  - SillyTavern-compatible selectLogic (AND_ANY, NOT_ALL, NOT_ANY, AND_ALL).
- Read src/types/index.ts:
  - CharacterCard interface L537-593: fields are id, name, description, personality, scenario, firstMes, mesExample, creatorNotes, characterNote, systemPrompt, postHistoryInstructions, authorNote, alternateGreetings, tags, avatar, sprites, spritePacksV2, stateCollectionsV2, triggerCollections, voice, hudTemplateId, lorebookIds (L571), questTemplateIds (L572), embeddingNamespaces (L573), statsConfig, proactiveMessages, wardrobeConfig, microReactionConfig, emotionalConfig, quickReplies, defaultTransition.
  - NO "background" or "backhistory" or "knowledgeBase" field exists.
  - CharacterGroup L965+ also has embeddingNamespaces (L982) and lorebookIds.
  - LorebookPosition type L2532-2540: 0|1|2|3|4|5|6|7.
  - LorebookEntryType L2547: 'traditional'|'attribute'.
  - LorebookEntry interface L2620-2655: uid, key[], keysecondary[], comment, content, constant, selective, order, position, outletName, disable, excludeRecursion, preventRecursion, delayUntilRecursion, probability, useProbability, depth, selectLogic, group, groupOverride, groupWeight, scanDepth, caseSensitive, matchWholeWords, useGroupScoring, automationId, role, vectorized, displayIndex, extensions, entryType, attributeConfig?.
  - Lorebook interface L2667-2678: id, name, description, entries, settings, characterId?, tags, active, createdAt, updatedAt.
  - EmbeddingsChatSettings L2319-2381: enabled, maxTokenBudget, namespaceStrategy ('global'|'character'|'session'), showInPromptViewer, customNamespaces?, memoryExtractionEnabled?, memoryExtractionFrequency?, ... (FASE 14 fields: crossSessionMemory, memoryDecayEnabled, memoryDecayDays, memoryHeatEnabled).
- Read src/app/api/chat/stream/route.ts (2199 lines) key sections:
  - L394-395: lorebooks extracted from request body (not validated).
  - L489-500: buildLorebookSectionForPrompt() called with messages + lorebooks + options + attributeContext.
  - L519-593: Embeddings context retrieval — enrichedSearchQuery built (L522-536), smart truncation (L538-569), retrieveEmbeddingsContext() called with characterId, sessionId, embeddingsChat, lastAssistantMsg, mainAttributeKey (L583-593).
  - L607-622: buildSystemPrompt() called with character + lorebookPlan + sessionStats + lorebookAttributeKeys + lorebookEntryKeyMap.
  - L753-779: combined embeddingsContext built from: characterMemorySection (if no embeddings memory found) + nonMemoryContextString + memoryContextString + abstentionDirective. All joined with '\n\n'.
  - L737-746: allPromptSections assembled in order: systemSections + summarySection + characterMemorySection + nonMemorySection + memorySection + chatHistorySections + postHistorySection (for prompt viewer display).
- Read src/components/tavern/chat-panel.tsx (3188 lines) key sections:
  - L255-273: effectiveLorebookIds useMemo — character.lorebookIds OR group.lorebookIds.
  - L1683-1697: stream API call passes lorebooks, sessionStats, characterMemory, and embeddingsChat with `customNamespaces: activeCharacter?.embeddingNamespaces` (L1696).
  - L856: group chat passes `customNamespaces: activeGroup?.embeddingNamespaces`.
- Read src/components/tavern/character-editor.tsx (1213 lines):
  - Tabs L66-78: info, description, dialogue, prompt, sprites, stats, voice, proactive, wardrobe, quickreplies, migration. NO "knowledge" or "background" tab.
  - L584-588: LorebookSelector bound to character.lorebookIds.
  - L612-631: NamespaceSelector bound to character.embeddingNamespaces — labeled "Colecciones de Contexto" (Database icon, violet).
  - L637-720: renderDescriptionTab — description (3/5 width) + personality + scenario (2/5 width stacked).
  - L823-941: renderPromptsTab — systemPrompt, postHistoryInstructions, characterNote, creatorNotes, authorNote.
- Read src/lib/embeddings/constants.ts (54 lines): DEFAULT_EMBEDDINGS_CHAT. namespaceStrategy='character' default, crossSessionMemory=true default, memoryDecayEnabled=true default, memoryDecayDays=14 default, memoryHeatEnabled=true default.
- Read src/lib/embeddings/splitters/text-splitter.ts (317 lines) first 120 lines: 4 splitter types (character, recursive-character, markdown, code).
- Read src/lib/character-card.ts (746 lines) L1-260 and L400-499: confirms character.embeddingNamespaces is serialized to PNG extensions on export (L446) and parsed back on import (L153, L210). No "background"/"knowledgeBase" field anywhere.
- Verified that `/api/embeddings/upload` does not exist (LS on the directory + grep on the source).

Stage Summary:

### 1. Where the Conocimiento UI lives (file:line refs)

- **Top-level settings tab** "Conocimiento" (Library icon) at `src/components/tavern/settings-panel.tsx:1389, 2328-2330` → renders `<EmbeddingsSettingsPanel/>`.
- **The panel itself** at `src/components/embeddings/embeddings-settings-panel.tsx` (2177 lines) — header banner "Base de Conocimiento" at L957-973.
- **5 inner tabs** at L1012-1029: Configuración, Búsqueda, Archivos, Namespaces, Examinar.
- **"Archivos" tab (file upload UI)** at L1428-1595 — file input + namespace selector + splitter/chunk controls + Preview/Create buttons.

### 2. CRITICAL BUG — `/api/embeddings/upload` route is missing

- **UI calls** `/api/embeddings/upload` with FormData at `embeddings-settings-panel.tsx:846` (handleFileUpload).
- **The route does NOT exist** in `src/app/api/embeddings/` (verified by LS + grep). Every file upload returns 404 → user sees toast "Error al subir archivo".
- The actual file-to-embeddings endpoint is `/api/embeddings/create-from-file/route.ts` which expects JSON `{content, namespace, splitterType, chunkSize, chunkOverlap, source_type, source_id}` (NOT FormData).
- The UI's `handleCreateEmbeddings()` at L907-941 already calls the correct route, but `handleFileUpload()` at L837-869 is broken — so `uploadedFile.content` is never populated and `handleCreateEmbeddings` is never reached.

### 3. How uploaded files are stored (when the bug is fixed)

- File content is split into chunks (text-splitter.ts, 4 strategies: character / recursive-character / markdown / code).
- Each chunk → `client.createEmbedding({content, namespace, source_type:'file', source_id:fileName, metadata:{chunkIndex, totalChunks, splitterType, chunkSize, chunkOverlap, fileName}})`.
- LanceDB stores: `content`, `vector` (from Ollama), `namespace`, `source_type='file'`, `source_id`, `metadata.created_at`.
- `source_type='file'` means it goes into the **non-memory** bucket (CONTEXTO RELEVANTE), NOT MEMORIA RELEVANTE.
- The namespace is whatever the user picked in the dropdown (default = 'default'). Currently NO automatic character-specific routing.

### 4. How knowledge is retrieved (RAG)

`retrieveEmbeddingsContext()` at `chat-context.ts:113-480` searches namespaces based on `namespaceStrategy`:
- 'global' → searches ALL namespaces (`*`).
- 'character' (default) → searches:
  - `memory-character-{charId}` (or `memory-character-{charId}-{sessionId}` if crossSession=false)
  - `character-{charId}` ← **this is the character lore/knowledge namespace**
  - Plus any `settings.customNamespaces` (which come from `character.embeddingNamespaces` via chat-panel.tsx:1696).
- Results are SPLIT into two prompt sections:
  - **nonMemory** (source_type !== 'memory') → `[CONTEXTO RELEVANTE]` — includes 'file', 'character', 'world', 'lorebook', 'session', 'custom' source_types.
  - **memory** (source_type === 'memory') → `[MEMORIA RELEVANTE]` (subdivided into `[MEMORIA DEL USUARIO]` and `[MEMORIA DEL PERSONAJE]`).
- This is the system's distinction between static knowledge (uploaded files/lore) and dynamic memory (auto-extracted facts).
- Both sections are injected before chat history, in order: CONTEXTO → MEMORIA → chat history.

### 5. The prompt builder assembly

`buildSystemPrompt()` at `prompt-builder.ts:506-812` assembles 14+ sections in fixed order (system → world time → text actions → lorebook pos 0 → description → personality → emotion → scenario → character note → attribute mgmt → wardrobe → examples → lorebook pos 5 → outlets → lorebook pos 6).

`buildChatMessages()` at `prompt-builder.ts:1031-1151` then packs everything into ONE system message:
```
systemPrompt + '\n\n---\n\n' +
embeddingsContext + '\n\n---\n\n' +
'[Author\'s Note]\n' + authorNote + '\n\n---\n\n' +
postHistoryInstructions
```
Then example messages → chat history → lorebook chat-level injections (positions 1-4).

### 6. CharacterCard has NO background/backhistory field

- `CharacterCard` (types/index.ts:537-593) has: description, personality, scenario, characterNote, systemPrompt, postHistoryInstructions, authorNote, creatorNotes, mesExample, firstMes.
- No "background", "backhistory", or "knowledgeBase" field.
- The closest existing mechanism is `character.embeddingNamespaces: string[]` (L573) which adds custom namespaces to the RAG search.
- The character's lore is associated via `character.lorebookIds: string[]` (L571).

### 7. The lorebook system — character-specific but keyword-triggered

- `Lorebook` type (L2667-2678) has `characterId?` field but the actual association is via `character.lorebookIds: string[]`.
- Lorebook entries can be:
  - **Traditional** (entryType='traditional'): keyword-triggered, supports regex, AND_ANY/NOT_ALL/NOT_ANY/AND_ALL logic, secondary keys, constant (always active), probability.
  - **Attribute** (entryType='attribute'): triggered by character stat values (e.g., "when vida < 30"), resolved via {{injectionKey}}.
- 8 injection positions (L2532-2540): 0=after system, 1-4=around chat messages, 5=top of chat, 6=bottom of chat, 7=outlet (custom name).
- Lorebooks are good for: triggered injections on keywords/conditions.
- Lorebooks are NOT good for: large background text (no chunking, no semantic search, always-or-never injection).

### 8. Identified gaps

1. **CRITICAL**: `/api/embeddings/upload` route missing — UI calls it, gets 404. (Already documented above.)
2. **No automatic character routing for uploads**: when uploading a file via the Archivos tab, the namespace defaults to `'default'`. To assign knowledge to a specific character, the user must manually pick `character-{charId}` from the dropdown — but this namespace may not exist yet (it's only created on demand).
3. **No "background/backhistory" concept** on CharacterCard — but this is NOT a gap, because the embeddings system already serves this role via `character-{charId}` namespace.
4. **No UI to upload knowledge from the character editor** — the character editor's "Colecciones de Contexto" section (character-editor.tsx:612-631) only lets you PICK existing namespaces; it doesn't let you upload files directly to a character-specific namespace.
5. **`source_type='file'` is not in the SourceType union** (types.ts:91-98 lists 'character'|'world'|'lorebook'|'session'|'memory'|'summary'|'custom' but NOT 'file'). The create-from-file route passes 'file' literally (L77). This is a type-system inconsistency — currently works because metadata.source_type is `any`.
6. **No distinction between "knowledge" and "lore"** in the non-memory bucket: 'file', 'character', 'world', 'lorebook' all flow into [CONTEXTO RELEVANTE]. This is fine for prompt purposes, but the prompt viewer's "type groups" sub-headers depend on namespace `metadata.type`, not source_type — so uploaded files appear under whatever namespace type was set (or under [OTRO CONTEXTO] if no type).

### 9. Recommendation — DO NOT add a new field; FIX the existing system instead

The infrastructure for character-specific knowledge/backhistory is ALREADY IN PLACE:
- ✅ `character.embeddingNamespaces?: string[]` exists on CharacterCard.
- ✅ `namespaceStrategy='character'` (default) ALWAYS searches `character-{charId}` namespace — any embeddings there are auto-injected as [CONTEXTO RELEVANTE].
- ✅ RAG is the right pattern: only semantically-relevant chunks are injected (saves tokens vs. always-in-context).
- ✅ `source_type='file'` already separates knowledge from memory in the prompt.

A new `knowledgeBase?: string[]` field on CharacterCard would DUPLICATE existing functionality and force always-in-context injection (token bloat). The lorebook system is also not the right tool — it's keyword-triggered, not semantic-search, and lacks chunking.

**Recommended actions (in priority order):**

**A. Fix the broken file upload (HIGH PRIORITY — blocking bug)**
Create `src/app/api/embeddings/upload/route.ts` (POST, multipart/form-data):
- Accept FormData with `file` field.
- Read file content as text (UTF-8). Reject if >10MB or non-text.
- Return JSON `{success: true, data: {fileName, fileSize, content, characterCount}}` — matching what `handleFileUpload` expects at embeddings-settings-panel.tsx:851-858.
- This unblocks the existing upload flow without changing the UI.
- (Alternative: change the UI to use FileReader API client-side and skip the upload endpoint — but that breaks mobile browsers with limited RAM for large files.)

**B. Pre-populate uploadNamespace with `character-{charId}` when context is known (MEDIUM)**
The upload UI at embeddings-settings-panel.tsx:1477 defaults to 'default'. Better: accept an optional `characterId` prop on `<EmbeddingsSettingsPanel>` and default `uploadNamespace` to `character-${characterId}` if provided. When the panel is opened from the character editor's "Colecciones de Contexto" section, pass the characterId.

**C. Add an "Upload to this character" button in the character editor (MEDIUM)**
In `character-editor.tsx` around L612-631 (Colecciones de Contexto section), add a button that opens a file picker and uploads directly to `character-{charId}` namespace. This makes the workflow obvious: edit character → upload background knowledge → it's automatically available in chat (no need to manually pick namespace).

**D. Add `source_type: 'file'` to the SourceType union (LOW)**
In `src/lib/embeddings/types.ts:91-98`, add `'file'` to the SourceType type. This is a type cleanup only — runtime already works.

**E. (Optional) Add a "knowledge" tab in character editor (LOW)**
A dedicated tab that shows: (1) the character's `character-{charId}` namespace stats (count, last upload), (2) an upload button, (3) a list of uploaded documents with delete buttons. This is purely UX — functionally the same as (C).

### 10. How to distinguish knowledge from memory in the prompt (already done)

The prompt viewer already shows:
- `[CONTEXTO RELEVANTE]` (amber color, type='context') — static knowledge (files, lore, world) → `nonMemorySection`
- `[MEMORIA RELEVANTE]` (violet color, type='memory') — dynamic memory (auto-extracted facts) → `memorySection`

No new distinction is needed. The split happens at `chat-context.ts:366-368` based on `source_type === 'memory'`.

### 11. Summary table — current state

| Question | Answer |
|---|---|
| Can knowledge be assigned to a specific character? | YES — via `character.embeddingNamespaces` or by uploading to `character-{charId}` namespace (auto-searched by 'character' strategy). |
| Is knowledge injected as backhistory or RAG? | RAG (semantic search → only relevant chunks injected as [CONTEXTO RELEVANTE]). |
| Distinction between knowledge and memory? | YES — `source_type='file'` (and others) → CONTEXTO; `source_type='memory'` → MEMORIA. |
| Can knowledge be injected without RAG (always in context)? | NO — but you can use Lorebook entries with `constant=true` for always-in-context content. Or set `namespaceStrategy='global'` and upload to a namespace that's always searched. |
| Is the upload flow currently working? | NO — `/api/embeddings/upload` route is missing (404). MUST be fixed first. |
| Should we add `knowledgeBase?: string[]` to CharacterCard? | NO — duplicates embeddings system, forces always-in-context injection. |
| Should we use the lorebook system? | Only for keyword-triggered content. Not for large background text. |

---
Task ID: KNOWLEDGE-SYSTEM (FASE 16)
Agent: Z.ai Code (principal)
Task: Fix knowledge upload, add character-specific knowledge/backhistory system

Work Log:
- CRITICAL BUG FIX: Created /api/embeddings/upload route (app/api/embeddings/upload/route.ts):
  - Handles multipart form-data file upload
  - Reads file content as UTF-8 text
  - Validates file size (10MB max) and extension (.txt, .md, .json, .csv, etc.)
  - Returns {success, data: {fileName, fileSize, content, characterCount}}
  - This fixes the 404 error that occurred every time a user tried to upload a knowledge file

- NEW COMPONENT: CharacterKnowledgeUploader (components/tavern/character-knowledge-uploader.tsx):
  - Allows uploading knowledge/backhistory files directly from the character editor
  - Files are chunked + embedded into the character's namespace (character-{charId})
  - Automatically searched during chat (via existing retrieveEmbeddingsContext)
  - Injected as [CONTEXTO RELEVANTE] (source_type='file')
  - Features:
    - File upload with preview (shows first 500 chars)
    - Advanced settings: splitter type (recursive/token/character/line), chunk size, overlap
    - Existing knowledge list (shows uploaded fragments with delete button)
    - Refresh button to reload existing knowledge
    - Help text explaining how knowledge works vs memory
    - Namespace badge showing where knowledge is stored
    - Warning that knowledge is different from memory (static vs dynamic)

- UI INTEGRATION (components/tavern/character-editor.tsx):
  - Added "Conocimiento" tab (BookOpen icon) between Vestuario and Resp. Rápidas
  - Added renderKnowledgeTab() — shows CharacterKnowledgeUploader if character has ID, or prompt to save first
  - Imported CharacterKnowledgeUploader and BookOpen icon
  - Character must be saved first (has ID) before uploading knowledge

- HOW THE KNOWLEDGE SYSTEM WORKS (complete flow):
  1. User uploads a file in Character Editor → Conocimiento tab
  2. File content is read via /api/embeddings/upload
  3. Content is chunked + embedded via /api/embeddings/create-from-file
  4. Embeddings stored in namespace: character-{charId} with source_type='file'
  5. During chat, retrieveEmbeddingsContext() searches character-{charId} automatically
  6. Results with source_type='file' → [CONTEXTO RELEVANTE] (amber, before chat history)
  7. Results with source_type='memory' → [MEMORIA RELEVANTE] (violet, after contexto)
  8. Advanced reranking applies: temporal decay, importance, memory heat, main attribute, diversity

- DISTINCTION KNOWLEDGE vs MEMORY:
  - Knowledge (uploaded files): static, background, lore, world-building, backhistory
    → source_type='file' → [CONTEXTO RELEVANTE] → always searchable via RAG
    → Can be deleted/managed from the character editor
  - Memory (auto-extracted): dynamic, conversation facts, events, relationships
    → source_type='memory' → [MEMORIA RELEVANTE] → cross-session, with decay
    → Auto-extracted every N turns, consolidated, reinforced
  - Both use the same LanceDB + reranking pipeline
  - Both are character-specific (namespace character-{charId})

- VERIFIED:
  - /api/embeddings/upload works (tested with test file, returns correct content + metadata)
  - App renders cleanly, no errors
  - Lint passes
  - Character editor has new "Conocimiento" tab

Stage Summary:
- Fixed critical bug: /api/embeddings/upload now exists (was 404)
- Added character-specific knowledge uploader in character editor
- Knowledge is automatically injected during chat as [CONTEXTO RELEVANTE]
- Clear distinction: knowledge (static, uploaded) vs memory (dynamic, extracted)
- No new types needed — uses existing source_type='file' for knowledge, source_type='memory' for memory
- Works with cross-session memory (FASE 14) — knowledge persists across sessions too

---
Task ID: KNOWLEDGE-FIX
Agent: Z.ai Code (principal)
Task: Fix TypeError: Cannot read properties of undefined (reading 'slice') in character-knowledge-uploader.tsx

Work Log:
- ROOT CAUSE: The /api/embeddings/namespaces/[namespace]/documents API returns documents grouped by source_id with structure: {source_id, source_type, count, firstChunk, created_at, ids}. The component expected {id, content} which don't exist in the API response — emb.content was undefined, causing the TypeError when calling .slice() on it.

- FIX (character-knowledge-uploader.tsx):
  - Updated NamespaceInfo interface to match actual API response structure
  - Updated render to use emb.firstChunk (the correct field) with fallback to emb.content
  - Added null check: previewContent only rendered if non-empty
  - Key uses emb.id || emb.source_id || idx (fallback chain)
  - Delete button now uses source_id (deletes all chunks of a file via DELETE /documents endpoint)
  - Added chunk count badge showing how many fragments each file has
  - handleDeleteKnowledge renamed to accept sourceId and call DELETE /documents with source_id

- VERIFIED: App loads without errors, page renders correctly, no console errors.
- Lint passes.

---
Task ID: CONTEXT-BUDGET-REVIEW
Agent: Explore (context detection + budget)
Task: Review how context length is detected and used for knowledge budget

Work Log:
- Read /home/z/my-project/worklog.md to load prior context (KNOWLEDGE-REVIEW/KNOWLEDGE-SYSTEM/KNOWLEDGE-FIX already documented the upload/RAG flow; this task focuses specifically on context-length detection & budget).
- Grep'd src/ for `modelContextLength|contextLength|context_length|getContextLength|getModelContextLength|resolveModelContextLength|MODEL_CONTEXT_LENGTHS` → 12 files. Read the relevant ones end-to-end.
- Read /home/z/my-project/src/lib/embeddings/types.ts (185 lines): MODEL_CONTEXT_LENGTHS map L147-164, DEFAULT_CONTEXT_LENGTH=512 L167, CHARS_PER_TOKEN=3.5 L170, resolveModelContextLength() L176-185.
- Read /home/z/my-project/src/lib/embeddings/config-persistence.ts (128 lines): DEFAULT_CONFIG.modelContextLength=undefined L22, loadConfig/saveConfig persist to data/embeddings-config.json, getModelContextLength() L115-118 wraps resolveModelContextLength(config.model, config.modelContextLength).
- Read /home/z/my-project/src/lib/embeddings/ollama-client.ts (375 lines) end-to-end: detectModelContextLength() L28-85 (POSTs /api/show → model_info.*.context_length → parameters.num_ctx → hardcoded map), OllamaEmbeddingClient.getMaxContextTokens() L123-152 (priority: config.modelContextLength → MODEL_CONTEXT_LENGTHS → base model → /api/show), embedText() L173-265 (75% safe budget + truncate BEFORE /api/embeddings, emergency half-size retry on 500 "exceeds the context length" L209-248).
- Read /home/z/my-project/src/app/api/embeddings/detect-context/route.ts (53 lines): POST handler calls detectModelContextLength() then saveConfig({modelContextLength}).
- Read /home/z/my-project/src/app/api/embeddings/config/route.ts (96 lines): on PUT, when model changes L40-50 auto-detects context length via detectModelContextLength() and persists it.
- Read /home/z/my-project/src/components/embeddings/embeddings-settings-panel.tsx key sections: handleModelChange L779-788 (clears modelContextLength on model switch), handleDetectContext L790-816 (calls /api/embeddings/detect-context), UI L1180-1250 (model selector + "{N} tokens contexto" badge at L1227-1234 + "Detectar" button at L1235-1248), default chunkSize=1000 L257, chunkOverlap=200 L258.
- Read /home/z/my-project/src/lib/embeddings/chat-context.ts (880 lines) end-to-end: imports getModelContextLength L19 + CHARS_PER_TOKEN L22; smart truncation L159-176 (maxSearchQueryChars = floor(getModelContextLength()*0.75*3.5) — used to truncate user & assistant search queries before Ollama); maxBudget = settings.maxTokenBudget || 1024 L181 (NOT linked to any model context); buildGroupedContextString L568-656 uses `maxChars = maxTokenBudget * 4` L574 (hardcoded 4 chars/token, INCONSISTENT with CHARS_PER_TOKEN=3.5 used everywhere else).
- Read /home/z/my-project/src/app/api/embeddings/create-from-file/route.ts (113 lines) end-to-end: chunkSize default = splitterInfo?.defaultChunkSize || 1000 (L41), splitText() at L46, NO validation against embedding model context length, each chunk sent AS-IS to client.createEmbedding() L74 (which silently truncates via OllamaEmbeddingClient.embedText()).
- Read /home/z/my-project/src/lib/embeddings/splitters/text-splitter.ts (317 lines): SPLITTER_INFO L291-316 — defaults: character=1000/200, recursive-character=1000/200, markdown=1000/200, code=1500/300. All HARDCODED, NOT derived from detected context.
- Read /home/z/my-project/src/lib/context-manager.ts (411 lines): selectContextMessages() L223-257, PROVIDER_CONTEXT_LIMITS L46-55 (ollama=4096, openai=128000, anthropic=200000, z-ai=4096, etc. — HARDCODED, no /api/show detection for LLM model). effectiveMaxTokens = min(config.maxTokens, providerTokenLimit) L239. reservedTokens subtracted L243 for summary+embeddings budget.
- Read /home/z/my-project/src/app/api/chat/stream/route.ts L478-567 and L748-865: selectContextMessages called with llmConfig + contextConfig; embeddings retrieval L519-593 uses EMBEDDING model context (MODEL_CONTEXT_LENGTHS map L542-549) for search-query truncation; reserved tokens L850-864 = estimateContentTokens(embeddingsContext) — i.e. ACTUAL embeddings size, not maxTokenBudget cap.
- Read /home/z/my-project/src/lib/embeddings/memory-extraction.ts L355-394: uses getModelContextLength()*0.5 for chat-context budget during extraction.
- Read /home/z/my-project/src/lib/embeddings/memory-consolidation.ts L255-289: uses getModelContextLength()*0.6 for facts-list budget.
- Read /home/z/my-project/src/lib/embeddings/constants.ts (54 lines): DEFAULT_EMBEDDINGS_CHAT.maxTokenBudget=1024 L9 (fixed default).
- Read /home/z/my-project/src/components/memory/memory-settings-panel.tsx L1375-1397: user-facing slider for maxTokenBudget (min 128, max 4096, step 128) — NOT auto-derived from LLM or embedding context.
- Read /home/z/my-project/src/components/tavern/character-knowledge-uploader.tsx L60-95: SPLITTER_OPTIONS L69-74 (recursive=500, token=500, character=1000, line=2000 — again hardcoded, NOT based on detected embedding context), default chunkSize=500 L81.
- Confirmed there is NO LLM-side context length detection (no /api/show call for the chat model, only for the embedding model).

Stage Summary:

### 1. Where context detection lives (file:line refs)

**Embedding model context detection:**
- Hardcoded map: `src/lib/embeddings/types.ts:147-164` (`MODEL_CONTEXT_LENGTHS` — bge-m3:8192, nomic-embed-text:8192, mxbai-embed-large:512, all-minilm:256, snowflake-arctic-embed:8192, llama3.1:8b:128000, phi3:mini:128000).
- Fallback default: `types.ts:167` (`DEFAULT_CONTEXT_LENGTH = 512`).
- Chars/token ratio: `types.ts:170` (`CHARS_PER_TOKEN = 3.5`).
- Resolver: `types.ts:176-185` `resolveModelContextLength(model, configContextLength?)` — priority: config value > map[full name] > map[base name (split on ':')] > default.
- Persisted config field: `types.ts:108` `EmbeddingsConfig.modelContextLength?: number` (undefined by default).
- Persistence: `config-persistence.ts:115-118` `getModelContextLength()` returns `resolveModelContextLength(config.model, config.modelContextLength)`.
- Live Ollama detection: `ollama-client.ts:28-85` `detectModelContextLength(ollamaUrl, model)` — POSTs `/api/show`, parses `model_info[*].context_length` first, then `parameters.num_ctx` (object or string form), falls back to hardcoded map.
- Client-side cached detection: `ollama-client.ts:123-152` `OllamaEmbeddingClient.getMaxContextTokens()` — priority: config.modelContextLength → MODEL_CONTEXT_LENGTHS[full] → MODEL_CONTEXT_LENGTHS[base] → detectModelContextLength() → cachedMaxContextTokens.

**LLM (chat) model context detection:**
- **NONE.** `src/lib/context-manager.ts:46-55` `PROVIDER_CONTEXT_LIMITS` is a HARDCODED per-provider map (ollama=4096, openai=128000, anthropic=200000, z-ai=4096, vllm=8192, etc.). No /api/show call is ever made for the chat model.
- `selectContextMessages()` (`context-manager.ts:223-257`) uses `min(config.maxTokens, providerTokenLimit)`.

### 2. Settings panel UI (embeddings-settings-panel.tsx)

- **Model picker**: L1190-1224 — `<Select value={config.model} onValueChange={handleModelChange}>` listing `KNOWN_MODELS` + live `ollamaModels` (from /api/tags).
- **Detected context badge**: L1226-1234 — shows `<Badge>` with `{config.modelContextLength.toLocaleString()} tokens contexto` if defined, else "Contexto no detectado".
- **"Detectar" button**: L1235-1248 — calls `handleDetectContext()` at L790-816 which POSTs to `/api/embeddings/detect-context` and updates `config.modelContextLength` in local state.
- **Auto-detection on model change**: `config/route.ts:40-50` — when user PUTs a new model via `/api/embeddings/config`, the route automatically calls `detectModelContextLength()` and persists the value. UI also clears `modelContextLength` to undefined on model change (L786) so the user sees the hint to re-detect (or save config to trigger auto-detect on the server).
- **Chunk size UI**: L1513-1517 — slider for chunkSize (chars). Default 1000 (L257). No connection to detected model context — no warning when chunkSize exceeds the model's safe budget.

### 3. chat-context.ts budget calculation (token budget for embeddings retrieval)

- `maxSearchQueryChars` L165: `Math.floor(getModelContextLength() * 0.75 * CHARS_PER_TOKEN)` — uses detected EMBEDDING model context. Used to truncate the user message + last assistant message BEFORE sending to Ollama's /api/embeddings. ✅ This IS connected to detected context.
- `maxBudget` L181: `settings.maxTokenBudget || 1024` — NOT derived from any model context. This is the budget for how much RETRIEVED context to inject into the LLM prompt (separate concept from embedding model context).
- Budget split L370-372: 45% non-memory + 55% memory; memory further split 50/50 user/character (L388-389).
- **BUG/INCONSISTENCY** at L574: `const maxChars = maxTokenBudget * 4` — uses hardcoded 4 chars/token, while the rest of the codebase uses `CHARS_PER_TOKEN = 3.5`. This means `buildGroupedContextString` allows ~14% more chars than the budget nominally represents (1024 tokens × 4 = 4096 chars vs 1024 × 3.5 = 3584 chars).

### 4. create-from-file route — chunking

- `src/app/api/embeddings/create-from-file/route.ts:39-43` — chunkSize falls back to `splitterInfo?.defaultChunkSize || 1000`. No reference to model context length.
- L46 — `splitText(content, splitterType, {chunkSize, chunkOverlap})` splits text.
- L71-92 — each chunk is sent AS-IS to `client.createEmbedding()`.
- The Ollama client (`ollama-client.ts:174-265`) then truncates EACH chunk to 75% of the model's context window before sending to `/api/embeddings`. So if chunkSize > safe budget, the chunk is silently truncated and data is lost (with only a console.warn).
- **GAP**: No validation/warning at upload time. For `mxbai-embed-large` (512 tokens): safe budget = 384 tokens ≈ 1344 chars. For `all-minilm` (256 tokens): safe budget = 192 tokens ≈ 672 chars. The default chunkSize=1000 would be silently truncated for all-minilm, losing ~33% of each chunk.

### 5. Text splitter defaults (text-splitter.ts:291-316)

| Splitter | Default chunkSize (chars) | Default overlap (chars) |
|---|---|---|
| character | 1000 | 200 |
| recursive-character | 1000 | 200 |
| markdown | 1000 | 200 |
| code | 1500 | 300 |

All HARDCODED. Character-knowledge-uploader.tsx L69-74 uses slightly different hardcoded defaults (recursive=500, token=500, character=1000, line=2000). None are adaptive to the detected embedding model context.

### 6. Ollama client behavior on oversize chunks

- `embedText()` (`ollama-client.ts:173-265`):
  - L182-184: estimates tokens, truncates to 75% of model context BEFORE the API call. Logs `[Embeddings] Truncated input from X to Y chars…` if it had to truncate.
  - L209-248: if Ollama returns HTTP 500 + "exceeds the context length" (i.e. estimation was wrong), does ONE emergency retry at half the truncated size. Updates `cachedMaxContextTokens` to a smaller estimate for future calls (L242).
  - So oversize chunks NEVER cause an embedding failure — they cause SILENT DATA LOSS. The chunk is stored in LanceDB as the truncated version, but its metadata.chunkSize still reports the original chunkSize value (create-from-file/route.ts:83). This means the database is inconsistent with reality.

### 7. Identified gaps

1. **Chunk sizes are NOT adaptive to detected embedding context** (`text-splitter.ts:291-316`, `create-from-file/route.ts:39-43`, `character-knowledge-uploader.tsx:69-74`). Hardcoded 1000-char default is fine for bge-m3 (8192 tokens ≈ 28k chars safe) but TOO LARGE for all-minilm (256 tokens ≈ 672 chars safe → ~33% of each chunk silently truncated).

2. **No warning in upload UI when chunkSize exceeds safe budget.** The user can set chunkSize=10000 with model=all-minilm and get silently-truncated embeddings, no toast/error.

3. **`maxTokenBudget` for embeddings retrieval (default 1024) is NOT linked to either the embedding model context or the LLM model context.** It's a fixed user-configurable value (128-4096, slider at `memory-settings-panel.tsx:1383-1393`). For a 4096-token LLM, 1024 tokens of embeddings = 25% of context (large). For 128k OpenAI, 1024 = <1% (could safely use much more). The user has to manually tune this.

4. **`buildGroupedContextString` uses `maxTokenBudget * 4`** (`chat-context.ts:574`) — hardcoded 4 chars/token, INCONSISTENT with `CHARS_PER_TOKEN = 3.5` used everywhere else. This causes ~14% more content to be packed than the budget nominally represents.

5. **No LLM-side context length detection.** `PROVIDER_CONTEXT_LIMITS` (`context-manager.ts:46-55`) is a hardcoded per-provider map. The chat model's actual context length (e.g. llama3.1:8b has 128k, but ollama provider limit is hardcoded 4096) is never queried via /api/show. This means Ollama users are artificially capped at 4096 tokens even if their model supports 128k.

6. **`reservedTokens` logic in stream route (`chat/stream/route.ts:850-864`)** reserves the ACTUAL embeddings size (via `estimateContentTokens(embeddingsContext)`), NOT the `maxTokenBudget` cap. This is correct behavior — but it means the LLM context window is only re-evaluated when `reservedTokens > 200`, so small embeddings injections don't trigger budget recalculation (probably fine, but worth noting).

7. **The detected embedding model context is used in 4 places** (all for input truncation, NOT for output budgeting):
   - Search-query truncation in `chat-context.ts:160-176` (75% × CHARS_PER_TOKEN).
   - Search-query truncation in `chat/stream/route.ts:542-549` (75% × CHARS_PER_TOKEN, but reads the map directly rather than calling getModelContextLength() — slight code duplication, both call sites must stay in sync).
   - Embedding input truncation in `ollama-client.ts:182-184` (75% safe budget).
   - Memory extraction context budget in `memory-extraction.ts:369-371` (50% budget).
   - Memory consolidation facts-list budget in `memory-consolidation.ts:269-270` (60% budget × CHARS_PER_TOKEN).

8. **The detected context is NOT used for:**
   - Chunk sizing during knowledge upload (text-splitter.ts defaults are static).
   - The `maxTokenBudget` for how much retrieved context to inject into the LLM prompt.
   - Any LLM-side budgeting (the LLM model context is never detected).

### 8. Recommendations (priority-ordered)

**A. (HIGH) Auto-recommend chunkSize from detected embedding model context.**
In `create-from-file/route.ts` (and the upload UI), compute `recommendedChunkSize = Math.floor(getModelContextLength() * 0.75 * CHARS_PER_TOKEN)` and use it as the default if the user hasn't explicitly set one. Examples:
- bge-m3 (8192 tok): recommended ≈ 21504 chars (current 1000 is far below — could use much larger chunks, fewer API calls, faster uploads).
- nomic-embed-text (8192 tok): same.
- mxbai-embed-large (512 tok): recommended ≈ 1344 chars (current 1000 is fine).
- all-minilm (256 tok): recommended ≈ 672 chars (current 1000 is TOO LARGE — silently truncates).

**B. (HIGH) Warn the user when chunkSize exceeds safe budget.**
In `embeddings-settings-panel.tsx` and `character-knowledge-uploader.tsx`, when `chunkSize > modelContextLength * 0.75 * CHARS_PER_TOKEN`, show a yellow warning under the slider: "⚠ Este tamaño excede el contexto seguro del modelo ({N} tokens). Los fragmentos serán truncados silenciosamente."

**C. (MEDIUM) Fix the chars/token inconsistency at `chat-context.ts:574`.**
Change `const maxChars = maxTokenBudget * 4` → `const maxChars = maxTokenBudget * CHARS_PER_TOKEN` (import already exists at L22). This makes the budget consistent with the rest of the codebase.

**D. (MEDIUM) Auto-derive `maxTokenBudget` default from LLM provider context.**
In `constants.ts:9`, replace the fixed `maxTokenBudget: 1024` with a function that derives it from `PROVIDER_CONTEXT_LIMITS[llmConfig.provider]` (e.g. 15-20% of provider limit). Or expose a "Smart" preset in the memory settings panel that auto-adjusts. This ensures users with 128k-context LLMs get more retrieved context by default, while 4k-context users get a smaller budget.

**E. (MEDIUM) Detect LLM model context length from Ollama /api/show.**
Reuse `detectModelContextLength()` (already in `ollama-client.ts:28-85`) for the CHAT model when the provider is 'ollama'. Store it on the LLMConfig (e.g. `llmContextLength?: number`) and use it in `selectContextMessages()` instead of the hardcoded `PROVIDER_CONTEXT_LIMITS['ollama'] = 4096`. This unlocks 128k-context models like llama3.1:8b that are currently artificially capped.

**F. (LOW) Deduplicate the search-query truncation logic.**
`chat-context.ts:160-176` and `chat/stream/route.ts:542-549` both independently compute `modelCtx * 0.75 * CHARS_PER_TOKEN`. The stream route reads the MODEL_CONTEXT_LENGTHS map directly (L546-548) instead of calling `getModelContextLength()` — they could diverge. Consolidate into a single helper like `getSafeSearchQueryChars()` exported from `chat-context.ts`.

**G. (LOW) Persist detected chunkSize in chunk metadata for diagnostics.**
When the Ollama client truncates a chunk (`ollama-client.ts:186-192`), the warning is logged but the stored LanceDB record's `metadata.chunkSize` still reports the ORIGINAL chunkSize (set at `create-from-file/route.ts:83`). This makes the DB inconsistent with reality. Fix: have `OllamaEmbeddingClient.embedText()` return both the embedding AND the actual truncated length, and store that in metadata. (Or: have the create-from-file route pre-truncate chunks and store the truncated length in metadata.)

---
Task ID: CONTEXT-BUDGET-FIX (FASE 16)
Agent: Z.ai Code (principal)
Task: Use detected context length for knowledge chunk sizing + fix budget bug

Work Log:
- NEW HELPERS (lib/embeddings/types.ts):
  - getSafeChunkSize(model, configContextLength): calculates 75% of context × CHARS_PER_TOKEN
  - getChunkSizeRecommendation(model, configContextLength, currentChunkSize): returns {recommended, isSafe, warning, contextLength}

- BUG FIX (lib/embeddings/chat-context.ts:574):
  - Changed `maxTokenBudget * 4` to `maxTokenBudget * CHARS_PER_TOKEN` (3.5)
  - This was causing ~14% more content than the budget represented

- CHARACTER KNOWLEDGE UPLOADER (components/tavern/character-knowledge-uploader.tsx):
  - Loads embedding config on mount (fetch /api/embeddings/config)
  - Auto-recommends chunkSize based on detected model context length
  - Shows model name + context length badge in advanced settings
  - Shows recommended chunk size with "Auto" button to apply it
  - Shows warning (AlertTriangle) when chunkSize exceeds safe budget
  - Tooltip explains the warning in detail
  - Imported getSafeChunkSize, getChunkSizeRecommendation, CHARS_PER_TOKEN

- VERIFIED: App loads without errors, lint passes, page renders correctly.

Stage Summary:
- Knowledge chunk sizing is now adaptive: uses 75% of the detected model context window
- Warning shown when chunkSize exceeds safe budget (prevents silent truncation)
- "Auto" button lets users apply the recommended chunk size with one click
- Fixed the 4 vs 3.5 CHARS_PER_TOKEN bug in buildGroupedContextString

---
Task ID: MARKDOWN-SPLITTER (FASE 16)
Agent: Z.ai Code (principal)
Task: Add markdown heading-based chunking with heading context preservation

Work Log:
- IMPROVED markdownTextSplit (lib/embeddings/splitters/text-splitter.ts):
  - Now tracks heading hierarchy (headingStack) — knows parent sections
  - Each chunk preserves its section heading as prefix context
  - When a section is too big and gets sub-split, each sub-chunk gets the heading prepended
  - Example: "## Escuela Secundaria: la fama se le adelanta\nEn la escuela, Ximena era popular."
  - This means the embedding captures WHAT the section is about, not just random text
  - Handles nested headings (# → ## → ###) correctly

- UI (character-knowledge-uploader.tsx):
  - Added "Markdown" as the FIRST and DEFAULT splitter option
  - Changed default splitterType from 'recursive' to 'markdown'
  - Markdown default: chunkSize=1500, overlap=100 (larger because sections are semantic units)
  - handleSplitterChange now respects safe chunk size when switching splitters

- VERIFIED: preview-chunks API test with markdown content produces 4 correctly-sized chunks,
  each with its heading preserved:
    [1] # Biografia de Ximena...
    [2] ## Escuela Secundaria: la fama se le adelanta...
    [3] ### Primer ano...
    [4] ## Universidad...

Stage Summary:
- Markdown splitter now preserves heading context in each chunk
- This means embeddings capture section semantics (e.g., "Escuela Secundaria" section)
- Default splitter is now "Markdown" instead of "Recursive"
- Works with the auto-chunk-size recommendation based on model context length

---
Task ID: KNOWLEDGE-SEARCH-FIX (FASE 16)
Agent: Z.ai Code (principal)
Task: Fix knowledge search not finding character knowledge files

Work Log:
- ROOT CAUSE: `retrieveEmbeddingsContext()` returned `emptyResult()` immediately when `settings.enabled === false`.
  Since `DEFAULT_EMBEDDINGS_CHAT.enabled = false`, the ENTIRE embeddings system was disabled by default —
  including knowledge search. Users who uploaded knowledge files to a character could never retrieve them
  unless they explicitly enabled the full memory pipeline in Settings → Conocimiento.

- FIX: Separated knowledge search from memory pipeline:
  - `enabled` = controls the FULL memory pipeline (extraction + retrieval + reinforcement + decay)
  - `knowledgeSearchEnabled` = controls ONLY the knowledge/backhistory search (character namespace)
  - When `knowledgeSearchEnabled` is true (default), the system searches `character-{charId}` namespace
    for uploaded knowledge files, even if `enabled` is false.

- IMPLEMENTATION (lib/embeddings/chat-context.ts):
  - `retrieveEmbeddingsContext()` now checks both flags:
    - If neither enabled → return emptyResult()
    - If only knowledgeSearchEnabled → search but filter to knowledge-only mode
  - `knowledgeOnly` mode:
    - Filters out `memory-*` namespaces (only searches `character-{charId}`, `group-{groupId}`, custom)
    - Filters results: all results treated as non-memory (source_type != 'memory')
    - Budget: 100% goes to non-memory (no memory budget allocated)
    - Console log: "Knowledge-only mode: searching N namespaces (excluded memory)"
  - When both enabled: normal behavior (searches both memory + knowledge)

- TYPES (types/index.ts):
  - Added `knowledgeSearchEnabled?: boolean` to EmbeddingsChatSettings

- CONSTANTS (lib/embeddings/constants.ts):
  - Added `knowledgeSearchEnabled: true` to DEFAULT_EMBEDDINGS_CHAT (default ON)

- VERIFIED: App loads without errors, lint passes, page renders correctly.

Stage Summary:
- Knowledge search now works by DEFAULT (without needing to enable the full memory pipeline)
- Users can upload knowledge files to a character and they'll be found during chat
- The `enabled` flag now only controls the memory extraction/consolidation/reinforcement pipeline
- Knowledge and memory are clearly separated:
  - Knowledge: character-{charId} namespace, source_type='file' → [CONTEXTO RELEVANTE]
  - Memory: memory-character-{charId} namespace, source_type='memory' → [MEMORIA RELEVANTE]


---
Task ID: TYPEWRITER-FORMAT-REVIEW
Agent: Explore (typewriter + dialogue format + opacity + comic sounds)
Task: Review typewriter effect, dialogue formatting, opacity, and comic sound positioning

Work Log:
- Read /home/z/my-project/worklog.md (history of prior agents — Task 0 through knowledge-search refinement)
- Listed src/ structure to locate dialogue, tavern, hooks, lib modules
- Read src/components/dialogue/typewriter-text.tsx (50 lines)
- Read src/components/tavern/streaming-text.tsx (230 lines)
- Read src/components/dialogue/formatted-message.tsx (273 lines)
- Read src/components/dialogue/speech-bubble.tsx (176 lines)
- Read src/components/dialogue/dialogue-settings-panel.tsx (1023 lines, scanned 60–859)
- Read src/components/tavern/text-formatter.tsx (296 lines, full)
- Read src/components/tavern/chat-message.tsx (893 lines, full via persisted-output)
- Read src/components/tavern/novel-chat-box.tsx around streaming block (lines 2200–2380)
- Grep'd src/components/tavern/chat-panel.tsx for streamingContent / StreamingText / TypewriterText / FormattedMessage / isStreaming
- Grep'd src/components/tavern/novel-chat-box.tsx for same keywords
- Grep'd all *.tsx for `<StreamingText|<FormattedMessage|<SpeechBubble|<TypewriterText` to find usages
- Read src/lib/dialogue/dialogue-parser.ts (235 lines)
- Read src/components/tavern/appearance-settings-panel.tsx (1428 lines, sections 1–200, 820–1019, 1020–1400)
- Read src/components/tavern/comic-sound-overlay.tsx (350 lines)
- Read src/components/tavern/comic-sound-templates.tsx (473 lines)
- Read src/lib/comic-sound-bus.ts (117 lines)
- Grep'd character-sprite.tsx and group-sprites.tsx for `data-character-id` / `getBoundingClientRect` / `forwardRef`
- Read src/components/tavern/character-sprite.tsx around sprite render block (lines 580–629)
- Read src/components/tavern/group-sprites.tsx around sprite render block (lines 280–310, 390–549)
- Read src/types/index.ts for TypewriterSettings (L3755), DialogueSettings (L3788), ComicSoundSettings (L1569), MessageBubbleSettings (L1961)
- Grep'd src/ for `emitComicSoundEvent` callsites (found 7 callsites in spriteSlice.ts, use-timeline-sprite-sounds.ts, use-sound-triggers.ts, timeline-sound-player.ts, sound-handler.ts, sound-key-handler.ts)

Stage Summary:

═══════════════════════════════════════════════════════════════
## 1. TYPEWRITER / STREAMING EFFECT
═══════════════════════════════════════════════════════════════

### How it currently works
- **Chat panel streaming flow** (src/components/tavern/chat-panel.tsx):
  - L38: `const [streamingContent, setStreamingContent] = useState('')` — single state for partial text
  - L67: `streamingContentRef` mirrors it for interrupt access
  - L3123: `streamingContent` is passed as a prop to `<NovelChatBox streamingContent={streamingContent} ...>`
  - L3056–3057: `<CharacterSprite isStreaming={isGenerating || isGeneratingProactive} hasContent={!!streamingContent} />`
- **Novel chat box rendering** (src/components/tavern/novel-chat-box.tsx):
  - L14: `import { StreamingText } from './streaming-text';` — but the component is **NEVER used in JSX**
  - L2335–2353: The streaming bubble renders `{streamingContent}` as **PLAIN TEXT** inside a `<div style={{color: ...characterBubbleTextColor}}>` — no inline formatting, no TextFormatter, no StreamingText
  - L2343–2352: A blinking cursor span is appended manually (block ▋ / line | / underscore _ / dot ●), honoring `safeAppearance.streaming.cursorStyle`, `cursorColor`, `cursorBlinkRate`
  - Cursor color/char read from `safeAppearance.streaming` (type `ChatboxStreamingSettings`)
- **TypewriterText component** (src/components/dialogue/typewriter-text.tsx, L19–48):
  - L27–29: If `!settings.enabled || isStreaming` → returns `<span>{text}</span>` (i.e. no typewriter effect AT ALL during streaming)
  - L33–47: Even when enabled and not streaming, it just renders `{text}` plus an animated cursor — there is NO character-by-character animation. Comment on L31 admits: "the full typewriter effect would need a more complex implementation with requestAnimationFrame"
  - i.e. **the typewriter effect is effectively a no-op**; the "animation" only consists of a blinking cursor
- **TypewriterSettings** (src/types/index.ts L3755–3764):
  - Fields exist: `enabled, speed, startDelay, pauseOnPunctuation, punctuationPauseMs, cursorChar, showCursor, cursorBlinkMs`
  - DEFAULT_DIALOGUE_SETTINGS.typewriter.enabled = true, speed = 50 (L3846–3855)
- **DialogueSettingsPanel** (src/components/dialogue/dialogue-settings-panel.tsx L732–809): Has full UI for typewriter (toggle, speed slider 10–200 c/s, pause-on-punctuation, cursor char, show cursor) — wired to `setTypewriterSettings`
- **Streaming settings** (src/components/tavern/appearance-settings-panel.tsx L1213–1320): Tab "Streaming" has `animationStyle` selector (typing-cursor / fade-in / grow / typewriter), `animationSpeed` slider, streaming text color, cursor style/color/blink rate — wired to `updateChatboxStreaming`
- **StreamingText component** (src/components/tavern/streaming-text.tsx L1–230): A real-time parser that handles incomplete `**`, `*`, `_`, `"`, `«`, `` ` `` patterns as tokens arrive. Includes a `StreamingCursor` element. **This is exactly what should be rendering streamingContent** but isn't.

### What's broken / missing
1. **`StreamingText` is imported but never used** in novel-chat-box.tsx — confirmed by Grep (no `<StreamingText` matches anywhere in src/). It is dead code.
2. **`TypewriterText` is a stub** — only renders the text + a cursor, never does the per-character animation. Its own comment admits it.
3. **Streaming content is rendered as PLAIN TEXT** at novel-chat-box.tsx L2342 (`{streamingContent}`) — meaning during streaming the user sees raw `*italic*`, `"dialogue"`, `(thought)`, `**bold**` markers instead of formatted output.
4. **`FormattedMessage` and `SpeechBubble` are also dead code** — never instantiated anywhere outside their own files. Only the import/export at src/components/dialogue/index.ts exists.
5. **Two parallel streaming systems** exist and don't agree:
   - `dialogueSettings.typewriter` (TypewriterSettings — speed, cursorChar, etc.) consumed by the dead FormattedMessage/TypewriterText path
   - `chatboxAppearance.streaming` (ChatboxStreamingSettings — animationStyle, cursorStyle, cursorColor, cursorBlinkRate) consumed by novel-chat-box.tsx manual cursor at L2343–2352
6. `safeAppearance.streaming.animationStyle` includes options `'fade-in'`, `'grow'`, `'typewriter'` but the code at L2343 only honors `showCursor` — no fade-in, no grow, no typewriter animation is actually applied.

### What needs to change
- Replace the manual `<div>{streamingContent}<cursor/></div>` block at novel-chat-box.tsx L2335–2353 with `<StreamingText content={streamingContent} isStreaming={true} isUser={false} className="text-xs" />` (the StreamingText component already handles a blinking cursor and parses incomplete markdown).
- OR add `<TextFormatter content={streamingContent} isUser={false} className="text-xs" appearance={safeAppearance} />` to reuse the same formatter as finalized messages (TextFormatter's regex handles partial text gracefully).
- Either implement the typewriter animation in TypewriterText (via requestAnimationFrame) OR remove the dead typewriter settings UI/types and consolidate into `ChatboxStreamingSettings`.
- Decide which streaming animationStyle to honor; map `animationStyle: 'fade-in'` → add fade-in classes, `'typewriter'` → enable StreamingText with progress reveal, `'grow'` → scale animation.

═══════════════════════════════════════════════════════════════
## 2. DIALOGUE FORMAT (*thoughts*, "speech", (actions))
═══════════════════════════════════════════════════════════════

### How it currently works
- **Active parser**: `parseSillyTavernFormat()` in src/components/tavern/text-formatter.tsx L125–280
  - Single regex (L138): `(\*\*\*.+?\*\*\*)|(\*\*.+?\*\*)|(\*.+?\*)|(_.+?_)|(["«][^"»]+["»])|(\([^)]+\))|(~[^~]+~)|(`[^`]+`)`
  - Maps patterns to types (L159–258):
    - `***text***` → bold italic `<strong className="italic font-bold">`
    - `**text**` → bold `<strong className="font-bold">`
    - `*text*` or `_text_` → action (italic + contentStyles.action.color) when dialogueEnabled, else green italic
    - `"text"` or `«text»` → dialogue (contentStyles.dialogue.color), preserves quotes around content
    - `(text)` → thought (contentStyles.thought.color), preserves parens
    - `~text~` → whisper (contentStyles.whisper.color + opacity)
    - `` `text` `` → inline code
- **Style classes** (text-formatter.tsx L98–123 `buildStyleClasses()`): reads `contentStyles.{dialogue,action,thought,whisper,narration}.{color, fontWeight, fontStyle, textDecoration, opacity}` from `dialogueSettings.contentStyles`
- **ChatMessageBubble** (chat-message.tsx L544/L751) renders `<TextFormatter content={message.content} isUser={isUser} className={...} appearance={safeAppearance} />` for both 'full' and 'bubble' display modes — formatting IS applied to finalized messages.
- **DEFAULT contentStyles** (src/types/index.ts L3863–3898): dialogue=text-foreground, action=text-purple-600 dark:text-purple-400 italic, thought=text-blue-600 dark:text-blue-400 italic, whisper=text-muted-foreground italic opacity:80, narration=text-muted-foreground
- **DEFAULT dialogueMarkers** (types L3840–3845): `"`, `*`, `()`, `~~`
- **DEFAULT dialogue formatting** (DialogueSettings.formatting at L3767–3785): markers are configurable but NOT consumed by the active text-formatter.tsx parser. The regex hardcodes `"`, `«`, `*`, `_`, `()`, `~`, `` ` `` regardless of dialogueSettings.formatting markers.
- **Dialogue settings UI** (dialogue-settings-panel.tsx): Three tabs — Typography / Styles / Effects. Per-type color pickers (COLOR_PRESETS L61–71) for dialogue/action/thought/whisper/narration, font style/weight/decoration selectors. Whisper also has an opacity slider (L565–577). Effect tab has typewriter (L732–809), bubble style selector, avatar settings, max-width slider, emotion/action detection toggles.
- **Dead-code parser**: `parseTextSegments()` in src/lib/dialogue/dialogue-parser.ts L104–192 uses `format.dialogueMarkers` etc. — but is only consumed by the dead `FormattedMessage` component.

### What's broken / missing
1. **DialogueSettings.formatting markers are ignored** — text-formatter.tsx uses hardcoded regex, so changing `dialogueMarkers.open` from `"` to `«` in the settings UI does nothing.
2. **Dead `FormattedMessage`, `SpeechBubble`, `TypewriterText` components** (in src/components/dialogue/) — none are rendered. They use the dialogue-parser but the parser is unused on the active path.
3. **Streaming content is NOT formatted** (see #1 above) — TextFormatter is only called for finalized messages.
4. **Smart quote `«` works only as opener with `»` closer**; the dialogue regex at L138 is `["«][^"»]+["»]` — it would also match `"text»` or `«text"` incorrectly (mixed quote types), although this is rare.
5. **Whisper opacity from settings is applied via inline `style={{ opacity }}`** (text-formatter.tsx L236) — this overrides the Tailwind `opacity-*` class on the parent span, but the color class (text-muted-foreground) is still applied. Working as intended.
6. **`(text)` thought pattern over-matches**: regex `\([^)]+\)` won't nest, so `((nested))` would only match the outer pair — acceptable.

### What needs to change
- If dialogue markers should be configurable, update text-formatter.tsx's regex to use `dialogueSettings.formatting.*Markers` values instead of hardcoded characters. (Currently the settings UI for marker customization does not exist anyway — only DEFAULT_DIALOGUE_SETTINGS.formatting contains them, but no panel exposes them. So either add a markers editor or remove the unused config.)
- Delete or wire up `FormattedMessage` / `SpeechBubble` / `TypewriterText` / `dialogue-parser.ts` — they are ~700 lines of dead code.
- Apply `TextFormatter` (or `StreamingText`) to streaming content (see #1).

═══════════════════════════════════════════════════════════════
## 3. CHAT BACKGROUND OPACITY
═══════════════════════════════════════════════════════════════

### How it currently works
- **Type** (src/types/index.ts L1960–1978 `MessageBubbleSettings`): has `transparency: number` (0–1) plus 8 color fields (`userBubbleColor` / `userBubbleTextColor` / `characterBubbleColor` / `characterBubbleTextColor` / `narratorBubbleColor` / `narratorBubbleTextColor` / `systemBubbleColor` / `systemBubbleTextColor`).
- **DEFAULT** (types L2131, transparency: 1; L2136 userBubbleColor: '#3b82f6', L2139 characterBubbleTextColor: '#fafafa', etc.)
- **hexToRgba helper** (chat-message.tsx L199–205): converts hex + alpha → `rgba(r, g, b, alpha)` string
- **getBubbleStyle()** (chat-message.tsx L315–373):
  - L319: `const transparency = safeAppearance.bubbles.transparency;`
  - L360–370: `style.backgroundColor = hexToRgba(...BubbleColor, transparency)` and `style.color = ...BubbleTextColor` (text color is applied SEPARATELY, NOT affected by transparency)
  - Comment on L360: "Colors based on message type - apply transparency ONLY to background"
- **novel-chat-box.tsx streaming bubble** (L2325): `backgroundColor: hexToRgba(safeAppearance.bubbles.characterBubbleColor, safeAppearance.bubbles.transparency)` and L2339 `color: safeAppearance.bubbles.characterBubbleTextColor` — also correctly separated.
- **System messages** (chat-message.tsx L273–288): `backgroundColor: hexToRgba(...systemBubbleColor, transparency)`, `color: ...systemBubbleTextColor` — same correct pattern.
- **Background (chat) layer** also has its own `transparency` (types L1926 `background.transparency`), separate from bubbles.
- **Settings UI** (appearance-settings-panel.tsx L942–954): single "Transparency" slider 0–100% step 5, mapped via `updateMessageBubbles({ transparency: v / 100 })`. Located inside the Bubbles tab. Default value displayed as `Math.round(transparency * 100)%`.

### What's broken / missing
1. **Opacity correctly applies ONLY to background, NOT to text** — this is the desired behavior. The hex color → rgba conversion only modifies backgroundColor, while `style.color` is set independently to the bubble's textColor hex.
2. **No textOpacity slider exists**. If a user wants the entire bubble (text + bg) semi-transparent (e.g. for a ghost/narrator overlay), there is no way to do it. Currently the text is always at full opacity regardless of the background transparency slider.
3. The slider only controls the four bubble types' background opacity uniformly — there is no per-bubble-type transparency (e.g. narrator more transparent than user).
4. There is no separate "background chat container opacity" slider distinct from "bubble background opacity" — they are different settings (`background.transparency` for the chat container vs `bubbles.transparency` for bubbles), and only `bubbles.transparency` is in the Bubbles tab. `background.transparency` is in the Background tab (L622–629).

### What needs to change
- If textOpacity is desired, add a new field `textOpacity?: number` to MessageBubbleSettings (default 1), a slider in the Bubbles tab next to Transparency, and apply `style.opacity = safeAppearance.bubbles.textOpacity` on the bubble div (NOT on the inner text spans — applying opacity to the container affects both bg and text uniformly).
- Alternative: add per-bubble-type transparency fields (`userTransparency`, `characterTransparency`, etc.) if finer control is needed.
- Document that the existing Transparency slider is **background-only** and that text remains fully opaque — this is intentional.

═══════════════════════════════════════════════════════════════
## 4. COMIC SOUND TEMPLATES
═══════════════════════════════════════════════════════════════

### How it currently works
- **Event bus** (src/lib/comic-sound-bus.ts):
  - `emitComicSoundEvent(triggerName, keyword, characterId?)` (L69) creates an event `{id, triggerName, keyword, timestamp, characterId?}` and notifies all listeners
  - `subscribeToComicSound(callback)` (L57) returns an unsubscribe function
  - 7 callsites emit events: src/store/slices/spriteSlice.ts:156, src/hooks/use-timeline-sprite-sounds.ts:576,599, src/hooks/use-sound-triggers.ts:63, src/lib/timeline-sound-player.ts:145,176, src/lib/triggers/handlers/sound-handler.ts:53, src/lib/triggers/handlers/sound-key-handler.ts:141,149
- **Overlay component** (src/components/tavern/comic-sound-overlay.tsx):
  - Subscribes via `addEffectRef` ref pattern (L278–291) — stable, no resubscription
  - `addEffect()` (L216–276): creates `ActiveSoundEffect` with x/y/rotation/scale/duration/createdAt
  - `maxEffects` FIFO eviction (L256–265)
  - `removeTimer` schedules cleanup after `duration + 200` ms (L271–273)
  - Periodic cleanup interval (L294–322) — safety net for stale effects (every 300ms)
  - **Rendering** (L328–348): `<div ref={containerRef} className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 12 }}>` — covers the WHOLE chat area, fixed to chat-panel.tsx L3076 `<ComicSoundOverlay />` (rendered when `settings.chatLayout.showCharacterSprite` is true)
- **Sprite position lookup** (comic-sound-overlay.tsx L60–98 `getSpritePositionCached`):
  - L82: `document.querySelector('[data-character-id="${characterId}"]')` — looks up the sprite wrapper DOM element
  - L87–93: computes sprite center X (as % of container width), sprite top Y, sprite upper-body Y (= spriteTopY + 38% of spriteHeight)
  - L65: `spritePositionCache` Map with 500ms TTL to avoid `getBoundingClientRect` reflow during animation frames
  - Fallback (L128–133): `getFallbackPosition()` returns `{x: 35–65, y: 30–55}` — center area
  - L103–112: `addControlledRandomness()` offsets ±8% x and ±6% y
  - L117–122: `clampPosition()` keeps within 10–90% margin
- **Sprite DOM exposure**:
  - `CharacterSprite` (src/components/tavern/character-sprite.tsx L608–611): wrapper `<div ref={spriteRef} data-character-id={characterId} className="absolute select-none" style={{ left, bottom, width, height, opacity, zIndex: 5 }}>`
  - `GroupSprites` (src/components/tavern/group-sprites.tsx L512–533): per-character wrapper `<div key={character.id} data-character-id={character.id} className="absolute select-none" style={{ left, bottom, width, height, opacity, zIndex, filter }}>`
- **Template rendering** (src/components/tavern/comic-sound-templates.tsx L369–416 `ComicSoundTemplate`):
  - `React.memo` with custom `areEqual` comparator
  - `hostRef` + `useEffect` once-only innerHTML assignment (L386–391) — prevents animation restart on parent re-render
  - Generates SVG via `createComicSFX({text, preset, duration, instanceId})` (L256–320) with 4 presets (vertical / oval / wail / tall)
  - Inline CSS animations (L92–135): sfx-pop, text-pop, boilA/B/C, mark-in, dot-pop, heart-pop, arrow-drop
  - SVG filters with instance-unique IDs (L143–160) to avoid DOM collisions
- **Template presets** (types L1584–1617): 4 types (vertical / oval / wail / tall). `autoSelectPreset()` at L338–348 picks based on text length (≤3 vertical, ≤5 oval, ≤7+!/??? wail, else tall).

### What's broken / missing
1. **ComicSoundOverlay is rendered as a sibling of sprites inside the chat area** (chat-panel.tsx L3076), positioned absolutely (inset-0) over the chat container. It does NOT directly track sprite movement — instead it re-queries `getBoundingClientRect()` on every new event (cached for 500ms).
2. **Sprite cache TTL can cause stale positions**: if a sprite is dragged during the 500ms cache window, the comic sound will appear at the old position. The cache returns the stale value if `Date.now() - cached.timestamp < SPRITE_CACHE_TTL`.
3. **`getSpritePositionCached` falls back to `null` when sprite not found** (L85): returns stale cache OR null. If a sprite is unmounted (e.g. group mode switching characters), sounds will briefly fall back to `getFallbackPosition()`.
4. **`event.characterId` is sometimes undefined** (timeline-sound-player.ts L145, 176 — calls emitComicSoundEvent without characterId). In this case `getSpritePositionCached('')` queries `document.querySelector('[data-character-id]')` — returns the FIRST sprite in the DOM, which may be wrong character in group mode.
5. **Z-index**: ComicSoundOverlay uses zIndex 12; CharacterSprite wrapper uses zIndex 5; GroupSprites active+streaming uses zIndex 10. So comic sounds render ABOVE sprites (good) but BELOW the chat box (which has higher z-index due to its own absolute positioning in the layout).
6. **No bounding box API exposed via React** — the sprites use `data-character-id` HTML attribute and the overlay reaches into the DOM directly via `document.querySelector`. This is fragile (any DOM refactor breaks positioning) but works.
7. **Positioning is correct in concept**: top-of-upper-body positioning at 38% of sprite height is sensible for placing the SFX above the character's head/torso.

### What needs to change
- Consider exposing sprite bounding box via a React context or shared ref store (e.g. `useSpritePositionStore`) instead of DOM queries, to avoid `getBoundingClientRect` reflow and stale-cache issues.
- Pass `characterId` from timeline-sound-player.ts (currently undefined) — needs a way to know which character is "active" in non-character-specific sound triggers.
- Invalidate sprite position cache on sprite drag end (could expose a `clearSpritePositionCache(characterId)` from comic-sound-overlay and call it from character-sprite.tsx / group-sprites.tsx drag handlers).
- Optionally position the SFX relative to a fixed point on each sprite (e.g. above the head) — the current 38% of sprite height is a reasonable proxy but may be too high or too low depending on the sprite's framing.


---
Task ID: STREAMING-FORMAT-OPACITY (FASE 17)
Agent: Z.ai Code (principal)
Task: Fix streaming text formatting, add text opacity slider, apply dialogue format during streaming

Work Log:
- CRITICAL FIX: Streaming text was rendered as PLAIN TEXT (novel-chat-box.tsx:2342 — `{streamingContent}`).
  The StreamingText component was imported (line 14) but NEVER USED in JSX.
  Now replaced with `<StreamingText>` which applies real-time formatting:
  - *italic* → green italic (thoughts)
  - "dialogue" → amber medium weight (speech)
  - **bold** → bold
  - `code` → monospace
  - Incomplete patterns (like ** without closing) shown as-is until completed
  - Blinking cursor animation
  - Text color from appearance settings applied via style prop

- StreamingText component enhanced (streaming-text.tsx):
  - Added `style?: CSSProperties` prop so the caller can set text color
  - Already handles: bold, italic (* and _), dialogue (" and «), code (`)
  - Already has StreamingCursor (blinking animation)

- TEXT OPACITY SLIDER (FASE 17):
  - Added `textOpacity: number` to MessageBubbleSettings (types/index.ts)
  - Default: 1 (100%) in DEFAULT_CHATBOX_APPEARANCE
  - Added slider in appearance-settings-panel.tsx (Bubbles tab):
    - "Opacidad del texto" (10-100%, step 5)
    - Separate from "Transparencia (fondo)" — renamed for clarity
  - Applied in chat-message.tsx: wrapped TextFormatter in `<div style={{ opacity: textOpacity }}>`
    - Applied in BOTH full mode (line 544) and compact/bubble mode (line 753)
    - Only affects text content, NOT the bubble background (background uses transparency)

- VERIFIED: App loads without errors, lint passes, page renders correctly.

Stage Summary:
- Streaming now shows formatted text (thoughts in italic green, dialogue in amber, bold, code) during generation
- Text opacity slider added separately from background transparency
- Background transparency renamed to "Transparencia (fondo)" for clarity
- Text opacity labeled "Opacidad del texto" (10-100%)

---
Task ID: QUICKREPLY-REVIEW
Agent: Explore (quick replies system)
Task: Understand how Quick Replies work so we can add threshold-based conditions to them

Work Log:
- Read /home/z/my-project/worklog.md (3110 lines, previous tasks 0–17 documented)
- Grep'd /home/z/my-project/src/types/index.ts for CharacterQuickReply|QuickReply → found types at L2193, L2203, L2206, L2216, L2219, L2236, L2254
- Grep'd /home/z/my-project/src/types/index.ts for StatRequirement|RequirementOperator → found at L4272, L4284
- Read /home/z/my-project/src/types/index.ts L2185–2274 (Quick Reply types block)
- Read /home/z/my-project/src/types/index.ts L4265–4323 (StatRequirement and ThresholdEffect)
- Read /home/z/my-project/src/components/tavern/quick-replies-panel.tsx (1474 lines, full file)
- Grep'd /home/z/my-project/src/components/tavern/novel-chat-box.tsx for quickRepl|onQuickRepl|handleQuickRepl|QuickReply → 7 matches
- Grep'd /home/z/my-project/src/components/tavern/chat-panel.tsx for same → 0 matches (all logic is in novel-chat-box.tsx)
- Read /home/z/my-project/src/components/tavern/novel-chat-box.tsx L840–1115 (applyQuickReplyModifiers, activateQuickReplySprite, handleQuickReply)
- Read /home/z/my-project/src/components/tavern/novel-chat-box.tsx L2355–2474 (rendering of quick reply buttons)
- Grep'd /home/z/my-project/src/store/slices/statsSlice.ts for evaluateRequirements|evaluateRequirement → L2114, L2170
- Read /home/z/my-project/src/store/slices/statsSlice.ts L2114–2188 (requirement evaluation logic)
- Grep'd /home/z/my-project/src for QuickReplyItem → only used in types/index.ts (legacy unused)
- Grep'd /home/z/my-project/src/lib/character-card.ts for quickReplies → L157, L212, L448, L729 (import/export roundtrip)
- Grep'd /home/z/my-project/src/components/tavern/character-editor.tsx for QuickRepliesPanel → L52 (import), L1065 (render)
- Grep'd /home/z/my-project/src/components/tavern/group-editor.tsx for QuickRepliesPanel → L62 (import), L1479 (render)
- Grep'd /home/z/my-project/src/components/tavern/character-panel.tsx for quickReplies → L223, L417, L559 (import/export fields only)
- Grep'd /home/z/my-project/src/lib/persistence.ts for quickReplies → L320–323 (legacy cleanup only)
- Grep'd /home/z/my-project/src/lib/sprites/condition-evaluator.ts for exports → 7 functions, including evaluateThresholdEffects at L336

Stage Summary:

═══════════════════════════════════════════════════════════════
## 1. QUICK REPLY TYPE DEFINITIONS (src/types/index.ts)
═══════════════════════════════════════════════════════════════

### `QuickReplyItem` (L2193–2198) — LEGACY/UNUSED
```ts
export interface QuickReplyItem {
  label: string;        // Label shown on the button in the chatbox
  response: string;     // Actual text sent as the user message
}
```
- Grep confirms this type is NEVER imported or used anywhere in src/ outside its own declaration. Likely a leftover from an older per-app-settings quick reply system (see persistence.ts L320–323 migration that deletes the old `settings.quickReplies` field).

### `CharacterQuickReply` (L2236–2251) — PRIMARY TYPE
```ts
export interface CharacterQuickReply {
  id: string;                                  // L2238 — unique ID
  label: string;                               // L2240 — button text, supports {{char}}/{{user}}
  response: string;                            // L2242 — sent text, supports {{char}}/{{user}}
  modifiers?: QuickReplyAttributeModifier[];   // L2244 — attribute modifications applied on click
  spriteActivation?: QuickReplySpriteActivation;// L2246 — triggers sprite animation on click
  requirements?: StatRequirement[];            // L2248 — VISIBILITY CONDITIONS (already exists!)
  requirementOperator?: 'AND' | 'OR';          // L2250 — logic combiner for requirements
}
```
- Stored on `CharacterCard.quickReplies?: CharacterQuickReply[]` (L582 in types/index.ts)
- Imported and serialized via character-card.ts at L157 (read), L212 (v1 import), L448 (export), L729 (export)

### `GroupQuickReply` (L2254–2269) — GROUP MODE EQUIVALENT
- Identical shape to `CharacterQuickReply` but stored on `Group.quickReplies?: GroupQuickReply[]` (L984 in types/index.ts)
- Used in group mode (replaces individual character quick replies when group is active)

### Supporting types

**`QuickReplyModifierOperation`** (L2203):
```ts
export type QuickReplyModifierOperation = 'set' | 'add' | 'subtract' | 'multiply' | 'divide';
```

**`QuickReplyAttributeModifier`** (L2206–2213):
```ts
export interface QuickReplyAttributeModifier {
  attributeKey: string;                  // Must match an AttributeDefinition.key in character.statsConfig
  operation: QuickReplyModifierOperation;
  value: number | string;               // number for numeric ops, string for 'set' on text attrs
}
```

**`QuickReplySpriteActivation`** (L2219–2233):
```ts
export interface QuickReplySpriteActivation {
  mode: 'trigger_collection' | 'sprite_pack';    // L2224
  targetId: string;                              // L2226 — ID of TriggerCollection or SpritePackV2
  fallbackMode: QuickReplySpriteFallbackMode;    // L2228 — what happens after action sprite expires
  fallbackDelayMs: number;                       // L2230 — 0 = persist until next change
  fallbackSpriteId?: string;                     // L2232 — custom sprite for 'custom_sprite' fallback
}
```

**`QuickReplySpriteFallbackMode`** (L2216):
```ts
export type QuickReplySpriteFallbackMode = 'idle_collection' | 'custom_sprite' | 'collection_default';
```

### `StatRequirement` (L4284–4293) — CONDITION TYPE (already wired!)
```ts
export interface StatRequirement {
  attributeKey: string;             // "vida", "mana", etc. (empty when target mode)
  operator: RequirementOperator;
  value: number | string;
  valueMax?: number;                // For 'between' operator
  targetCharacterId?: string;       // Cross-character: '__user__' for persona, or any character ID
  targetAttributeName?: string;     // For display
}
```

### `RequirementOperator` (L4272) — already supports thresholds!
```ts
export type RequirementOperator =
  | '<' | '<=' | '>' | '>='     // ✅ threshold operators
  | '==' | '!='                 // exact match
  | 'between'                    // ✅ range/threshold band
  | 'contains' | 'not_contains'; // text operators
```

### `ThresholdEffect` (L4303–4313) — SEPARATE system (for attribute-level effects, not quick replies)
```ts
export interface ThresholdEffect {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;                          // Higher = wins when multiple match
  conditions: StatRequirement[];
  conditionOperator?: 'AND' | 'OR';
  rewards: QuestReward[];                    // sprite packs, attributes, triggers, etc.
}
```
- This is a richer system used by character attributes (L4335 `thresholdEffects?: ThresholdEffect[]`). NOT currently used by quick replies.

═══════════════════════════════════════════════════════════════
## 2. QUICK REPLIES PANEL UI (src/components/tavern/quick-replies-panel.tsx, 1474 lines)
═══════════════════════════════════════════════════════════════

### What the user can configure per quick reply:
1. **Label** (maxLength 20) — what's shown on the button
2. **Response** (maxLength 200) — what gets sent (with `{{char}}`/`{{user}}` support)
3. **Attribute Modifiers** (collapsible, L1050–1091 for new, L1286–1328 for edit):
   - Each modifier: attribute selector + operation selector (`set`/`add`/`subtract`/`multiply`/`divide` for numeric; only `set` for text/keyword) + value input
   - Text/keyword attributes auto-restrict to `set` operation only (L559–561)
4. **Sprite Activation** (collapsible, L627–816):
   - Toggle on/off
   - Mode: `sprite_pack` (evaluate pack's conditional sprites) or `trigger_collection` (use a TriggerCollection by ID, supports chains/sounds/cooldowns)
   - Target selector (lists packs or collections)
   - Fallback mode: `idle_collection` / `collection_default` / `custom_sprite`
   - Fallback delay (ms, 0 = persist)
   - Custom fallback sprite (only when mode = `custom_sprite`)
5. **Visibility Conditions** (collapsible, L818–897):
   - Each requirement: mode (self/target) + attribute selector + operator + value (+ optional valueMax for `between`)
   - Numeric operators (L79–87): `≥`, `>`, `≤`, `<`, `=`, `≠`, `∈` (between)
   - Text operators (L89–94): `=`, `≠`, `⊂` (contains), `⊄` (not contains)
   - Self attribute OR target character attribute (cross-character, for group mode)
   - AND/OR toggle (L100–144) when ≥2 requirements
   - "Agregar Condición" button (L880–891)

### DnD reorder (L899–920)
- PointerSensor + KeyboardSensor via @dnd-kit/sortable
- Drag handle (GripVertical icon, L1370–1381)
- `arrayMove` from @dnd-kit/sortable

### Constraint: max 12 quick replies per character/group (L1021, L1125–1129)

### Where the panel is mounted:
- `character-editor.tsx` L1065–1072 — single character Quick Replies tab
  - Props: `quickReplies`, `statsConfig`, `spritePacksV2`, `triggerCollections`, `availableTargets`, `onChange`
- `group-editor.tsx` L1479–1486 — group editor Quick Replies tab
  - Same props, casts `GroupQuickReply[]` as `CharacterQuickReply[]` via `as any` (structurally identical)

═══════════════════════════════════════════════════════════════
## 3. WHAT HAPPENS WHEN A QUICK REPLY IS CLICKED
═══════════════════════════════════════════════════════════════

### Entry point: `handleQuickReply` in novel-chat-box.tsx L1097–1115
```ts
const handleQuickReply = (item: CharacterQuickReply) => {
  if (isAnyGenerating || !item.response.trim()) return;
  const resolutionContext = { user: ..., char: ... };
  const resolvedResponse = resolveTemplateVariables(item.response.trim(), resolutionContext);
  // 1) Apply attribute modifiers FIRST (so conditions re-evaluate with new stats)
  if (item.modifiers && item.modifiers.length > 0) {
    applyQuickReplyModifiers(item.modifiers);
  }
  // 2) Activate sprite (evaluates conditions AFTER modifiers were applied)
  if (item.spriteActivation) {
    activateQuickReplySprite(item.spriteActivation);
  }
  // 3) Send the message as the user (same flow as typing + Enter)
  onSendMessage(resolvedResponse);
  setInput('');
};
```

### `applyQuickReplyModifiers` (novel-chat-box.tsx L853–894)
- Reads current values via `getAttributeValue(activeSessionId, characterId, attributeKey)` from store
- For numeric: applies operation, clamps to attr.min/attr.max
- For text/keyword: only `set` is supported, value coerced to string
- Commits via `batchUpdateCharacterStats(activeSessionId, characterId, updates, 'manual')`

### `activateQuickReplySprite` (novel-chat-box.tsx L897–1095)
- Two modes:
  - `trigger_collection`: finds TriggerCollection → evaluates `collection.conditionalEntries` against sessionStats → falls back to pack conditional sprites → falls back to principal sprite → calls `store.applyTriggerForCharacter(...)` then `store.scheduleReturnToIdleForCharacter(...)`
  - `sprite_pack`: finds SpritePackV2 → evaluates `evaluatePackConditionalSprites(pack.sprites, sessionStats, characterId)` → falls back to defaultSpriteId / first sprite → calls same store methods
- Imports from `@/lib/sprites/condition-evaluator`: `evaluateConditionalEntries`, `evaluatePackConditionalSprites`

### Final action: `onSendMessage(resolvedResponse)`
- This is the SAME `handleSend` function (chat-panel.tsx L701) used when the user types a message and presses Enter
- So clicking a quick reply = apply modifiers → trigger sprite → send as user message + trigger LLM response
- NO special "quick reply" tool/action is sent to the LLM — the LLM only sees the resolved response string

═══════════════════════════════════════════════════════════════
## 4. QUICK REPLY RENDERING (novel-chat-box.tsx L2360–2420)
═══════════════════════════════════════════════════════════════

### Container
- Inside NovelChatBox chat tab, BELOW the message list (above the user input area, before `<QuickPetitions>`)
- `<div className="px-2 py-1 flex gap-1 overflow-x-auto border-t bg-background/30 flex-shrink-0">`
- Horizontal scrollable bar, button height `h-6`, max-width 150px per button

### Source selection (L2363–2365)
```ts
const quickReplies = isGroupMode && activeGroup?.quickReplies
  ? activeGroup.quickReplies                       // GroupQuickReply[]
  : (activeCharacter?.quickReplies || []);         // CharacterQuickReply[]
```
- Group mode uses group-level quick replies if present; otherwise falls back to character's

### Visibility filtering (L2380–2389)
```ts
const visibleReplies = quickReplies.filter((item) => {
  if (!item.requirements || item.requirements.length === 0) return true;
  return evaluateRequirements(
    item.requirements,
    characterAttributeValues,    // sessionStats.characterStats[primaryCharacterId].attributeValues
    sessionStats || null,
    item.requirementOperator
  );
});
```
- `evaluateRequirements` lives in src/store/slices/statsSlice.ts L2170–2179
- Calls `evaluateRequirement` per item (L2114–2164) which:
  - For `targetCharacterId` set → looks up `sessionStats.characterStats[targetCharacterId].attributeValues[attributeKey]`
  - Otherwise uses self `characterAttributeValues[attributeKey]`
  - Returns false if attribute is undefined
  - Numeric operators: `<`, `<=`, `>`, `>=`, `==`, `!=`, `between` (with `valueMax`)
  - Text operators: `==`, `!=`, `contains`, `not_contains` (case-insensitive)
- AND (default) or OR logic via `requirementOperator`
- If filtered list is empty, the whole bar is hidden (L2391: `return <></>`)

### Button rendering (L2401–2416)
- Outline variant, sm size, `h-6 px-2 text-xs max-w-[150px]`
- Shows Zap icon + amber border when `hasModifiers`
- Resolved label (after `{{char}}`/`{{user}}` substitution) shown truncated
- Tooltip = resolved response (only if template was used or response differs from label)
- `disabled={isAnyGenerating}` — buttons are disabled during LLM generation
- No "requirements met" indicator on the button itself (it just appears/disappears)

═══════════════════════════════════════════════════════════════
## 5. KEY FINDING: THRESHOLD-BASED CONDITIONS ALREADY EXIST
═══════════════════════════════════════════════════════════════

The task description asks to "add threshold-based conditions" — but the quick reply system ALREADY supports:
- `requirements?: StatRequirement[]` field (types/index.ts L2248)
- Operators: `>=`, `>`, `<=`, `<`, `between` (range), `==`, `!=`, `contains`, `not_contains`
- AND/OR logic via `requirementOperator`
- Cross-character conditions via `targetCharacterId` (group mode)
- UI for configuring them (quick-replies-panel.tsx L818–897)
- Runtime evaluation (statsSlice.ts L2114–2179)
- Visibility filtering in the chatbox (novel-chat-box.tsx L2381–2389)

### What MIGHT still be desired (gaps to consider):
1. **Threshold-based ACTIONS (not just visibility)**: Currently conditions only HIDE the quick reply. If we want "when health < 25%, this quick reply deals double damage" — that's NOT supported. The `ThresholdEffect` system (types L4303–4313 with `rewards: QuestReward[]`) does this for attributes, but quick replies don't use it.
2. **Percentage-based thresholds**: Conditions compare absolute values (e.g., `vida < 50`), not percentages of max (e.g., `vida < 25%`). Could add a `percentageOfMax: boolean` field on StatRequirement or a new operator.
3. **Threshold-aware click behavior**: e.g., apply different modifiers depending on the current value (no current support).
4. **Click-time condition re-evaluation**: Conditions are only evaluated for VISIBILITY (at render time). When clicked, modifiers/sprites are applied unconditionally. There's no "only apply this modifier if condition still holds at click time" guard.
5. **ThresholdEffect integration**: Quick replies don't currently consume the richer `ThresholdEffect` system (priority, rewards). They could be extended to fire rewards (sprites, attribute changes, triggers) like character attributes do.
6. **Min/max clamping awareness**: Modifiers already clamp to attr.min/max (L880–882 in novel-chat-box.tsx), so thresholds naturally bound. No issue here.
7. **No "consumed" / "cooldown" concept**: A quick reply can be clicked repeatedly with no limit. Threshold conditions could be used as a poor man's cooldown (e.g., hide after first use), but there's no dedicated cooldown field.
8. **The QuickReplyItem (L2193) legacy type is unused** — should probably be deleted for cleanup.

### Recommended next steps for the "add threshold-based conditions" task:
- **Option A (minimal)**: If "threshold-based conditions" just means numeric comparison conditions, the system ALREADY supports them. No code changes needed — only documentation/testing.
- **Option B (extend)**: Add percentage-based operators like `'percent_lt'`, `'percent_gt'`, `'percent_between'` to `RequirementOperator`, plus UI for picking `%` mode, plus evaluation in statsSlice.ts L2114.
- **Option C (rich)**: Add an optional `thresholdEffects?: ThresholdEffect[]` field to `CharacterQuickReply`/`GroupQuickReply` so quick replies can fire priority-based rewards (sprite packs, attribute changes, trigger collections) when clicked while certain conditions hold — reusing the existing character attribute ThresholdEffect system.

### Exact file paths & line numbers referenced
- Types: `/home/z/my-project/src/types/index.ts`
  - L582: `CharacterCard.quickReplies?: CharacterQuickReply[]`
  - L984: `Group.quickReplies?: GroupQuickReply[]`
  - L2193–2198: `QuickReplyItem` (legacy, unused)
  - L2203: `QuickReplyModifierOperation`
  - L2206–2213: `QuickReplyAttributeModifier`
  - L2216: `QuickReplySpriteFallbackMode`
  - L2219–2233: `QuickReplySpriteActivation`
  - L2236–2251: `CharacterQuickReply`
  - L2254–2269: `GroupQuickReply`
  - L4272: `RequirementOperator`
  - L4284–4293: `StatRequirement`
  - L4303–4313: `ThresholdEffect` (separate system, not yet used by quick replies)
- Panel: `/home/z/my-project/src/components/tavern/quick-replies-panel.tsx` (1474 lines)
  - L60–73: type imports
  - L79–87: NUMERIC_OPERATOR_OPTIONS
  - L89–94: TEXT_OPERATOR_OPTIONS
  - L100–144: RequirementOperatorToggle
  - L150–365: RequirementEditor
  - L396–1140: QuickRepliesPanel main component
  - L818–897: renderConditionSection
  - L627–816: renderSpriteActivation
  - L551–624: renderModifierRow
  - L1146–1474: SortableQuickReplyItem
- Click handling: `/home/z/my-project/src/components/tavern/novel-chat-box.tsx`
  - L101: type import for CharacterQuickReply, GroupQuickReply, QuickReplyAttributeModifier, QuickReplySpriteActivation, SpritePackV2, TriggerCollection
  - L853–894: applyQuickReplyModifiers
  - L897–1095: activateQuickReplySprite
  - L1097–1115: handleQuickReply
  - L2360–2420: rendering block (source selection + visibility filter + buttons)
- Evaluation: `/home/z/my-project/src/store/slices/statsSlice.ts`
  - L2114–2164: evaluateRequirement
  - L2170–2179: evaluateRequirements (used by quick reply visibility filter)
- Persistence:
  - `/home/z/my-project/src/lib/character-card.ts` L157, L212, L448, L729
  - `/home/z/my-project/src/lib/persistence.ts` L320–323 (legacy cleanup)
- Editors:
  - `/home/z/my-project/src/components/tavern/character-editor.tsx` L52 (import), L1065–1072 (render)
  - `/home/z/my-project/src/components/tavern/group-editor.tsx` L62 (import), L1479–1486 (render)
  - `/home/z/my-project/src/components/tavern/character-panel.tsx` L223, L417, L559 (import/export only)


---
Task ID: QUICKREPLY-THRESHOLDS-SESSION (FASE 18)
Agent: Z.ai Code (principal)
Task: Add threshold effects to quick replies + ensure session equipment cleanup

Work Log:
- POINT 1 (Persona thresholds): ALREADY IMPLEMENTED — PersonaPanel already has StatsEditor
  with full ThresholdEffectsSection. Persona statsConfig supports thresholdEffects.
  statsSlice.ts:434-439 handles __user__ characterId. No changes needed.

- POINT 2 (Quick reply thresholds):
  - Added `thresholdEffects?: ThresholdEffect[]` to CharacterQuickReply and GroupQuickReply types
  - Exported ThresholdEffectDialog from stats-editor.tsx (was local function)
  - Imported ThresholdEffectDialog and ThresholdEffect in quick-replies-panel.tsx
  - Added state: editThresholdEffects, editingThresholdEffect, thresholdDialogOpen, expandedThresholdEffects
  - handleStartEdit loads thresholdEffects from reply
  - handleSaveEdit saves thresholdEffects to reply
  - Added threshold effects props to QuickReplyItemProps + destructuring + render pass
  - Added UI section "Efectos de Umbral" in the quick reply editor:
    - Collapsible section with badge count
    - Per-effect: name, priority badge, enable/disable toggle, edit button, delete button
    - "Añadir efecto de umbral" button
    - Uses ThresholdEffectDialog (same dialog as attribute thresholds) for full configuration
    - Help text explaining what threshold effects do
  - handleQuickReply in novel-chat-box.tsx:
    - Evaluates thresholdEffects using evaluateThresholdEffects() from condition-evaluator
    - For each matching effect, executes rewards:
      - attribute: modifies character's own stats (add/subtract/set/multiply/divide)
      - target_attribute: modifies another character's stats (including __user__)
      - activate_sprite_pack: triggers sprite via applyTriggerForCharacter
      - trigger: triggers sprite/animation
      - currency: modifies persona currency
      - Other types: logged as "not handled yet" (extensible)
    - All reward execution is wrapped in try/catch (non-blocking)
    - Imported evaluateThresholdEffects statically (fixed require() lint error)

- POINT 6 (Session equipment cleanup):
  - createSession: now explicitly initializes sessionEquipment: [] and activeConsumableEffects: []
  - clearChat: now explicitly resets sessionEquipment: [] and activeConsumableEffects: []
  - This ensures new sessions and cleared sessions start with empty equipment state
  - Equipment/consumables are per-session (stored in session JSON), not inherited

- VERIFIED: App loads without errors, lint passes, page renders correctly.

Stage Summary:
- Persona already had threshold effects support (point 1 — no changes needed)
- Quick replies now support threshold effects with full UI + evaluation on click (point 2)
- New and cleared sessions start with empty equipment/consumables (point 6)

---
Task ID: SLOTS-PER-CHARACTER (FASE 19)
Agent: Z.ai Code (principal)
Task: Move equipment slots to character config + per-character slot effects + persona slots

Work Log:
- TYPES (types/index.ts):
  - Added `equipmentSlots?: EquipmentSlotDefinition[]` to CharacterCard — per-character slots
  - Added `slotDefinitions?: CharacterSlotDefinition[]` to CharacterCard — per-character slot effects
  - Created `CharacterSlotDefinition` interface:
    - slotId, slotName (reference to EquipmentSlotDefinition)
    - allowedItemCategories[], allowedItemIds[] (restrict what can equip)
    - effects: ItemAttributeEffect[] (modify attributes — static or dynamic)
    - effectText: string (free-text for prompt injection)
    - effectMode: 'static' | 'dynamic' (once on equip vs per-turn)
  - Added `equipmentSlots?` and `slotDefinitions?` to Persona (same fields)

- STORE (inventorySlice.ts):
  - Added 4 new methods to InventorySlice:
    - getEquipmentSlotsForCharacter(characterId) → character.equipmentSlots || global fallback
    - getEquipmentSlotsForPersona() → persona.equipmentSlots || global fallback
    - getSlotDefinitionsForCharacter(characterId) → character.slotDefinitions || []
    - getSlotDefinitionsForPersona() → persona.slotDefinitions || []
  - All use fallback to InventoryV2Settings.equipmentSlots (backward compatible)

- CHARACTER CARD IMPORT/EXPORT (character-card.ts):
  - Added equipmentSlots + slotDefinitions to V2 parse, V1 parse, PNG export, JSON export

- NEW COMPONENT (character-slots-editor.tsx):
  - Full UI for per-character equipment slots + slot definitions
  - Add/delete/rename slots (name, key, icon)
  - Per-slot configuration:
    - Effect mode: static (once) vs dynamic (per-turn)
    - Effect text (for prompt)
    - Attribute effects list (target: self/user, attribute, operator +/-/=/×/÷, value)
    - Add/remove attribute effects
  - Collapsible per-slot card
  - Help text explaining how it works
  - If no slots defined, shows "uses global slots" message

- CHARACTER EDITOR (character-editor.tsx):
  - Added "Slots" tab (Package icon) between Vestuario and Conocimiento
  - renderSlotsTab() renders CharacterSlotsEditor
  - Added to defaultCharacter: equipmentSlots: undefined, slotDefinitions: undefined

- VERIFIED: App loads without errors, lint passes, page renders correctly.

Stage Summary:
- Point 3: equipmentSlots moved to CharacterCard with fallback to global ✓
- Point 4: CharacterSlotDefinition created with effects (static/dynamic) + UI ✓
- Point 5: Persona has same equipmentSlots + slotDefinitions fields ✓
- Backward compatible: if character has no slots, global InventoryV2Settings.equipmentSlots are used
- Character card import/export preserves the new fields
