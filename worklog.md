---
Task ID: 3-a
Agent: Explore (personajes/skills/proactivo/tools)
Task: Análisis profundo de personajes, acciones, skills, proactivo y tool calling

Work Log:
- Leído /home/z/newsillytavern3/worklog.md (contexto de agentes previos, 146KB) — /home/z/my-project/worklog.md no existía.
- PERSONAJES: leído src/types/index.ts (CharacterCard L537-589, ProactiveMessagesConfig L1301-1418, SkillDefinition/SolicitudDefinition/InvitationDefinition/SolicitudInstance/CharacterStatsConfig L4357-4551), src/lib/character-card.ts (PNG tEXt "chara" + extensions), src/lib/llm/prompt-builder.ts (buildSystemPrompt, buildLorebookSectionForPrompt, buildPostHistorySection, buildAuthorNoteSection), prisma/schema.prisma (solo User/Post — no hay modelos de Character; persistencia = Zustand + JSON vía src/lib/persistence.ts).
- SKILLS/ACCIONES: leído src/lib/stats/stats-resolver.ts (buildSkillsBlock/buildIntentionsBlock/buildInvitationsBlock/buildSolicitudesBlock/resolveStats), src/lib/triggers/handlers/skill-activation-handler.ts (detección post-LLM de keys), src/lib/tools/tools/manage-action.ts completo. Verificado activateSkillByTool en src/store/slices/sessionSlice.ts (L1889).
- PROACTIVO: leído src/lib/proactive/case-selector.ts completo, /api/chat/proactive/route.ts (POST L290+, selección de caso L599-629, SSE case_selected/proactive_start, skip silencioso), src/hooks/use-proactive-messages.tsx (timers 5s, inactividad, allowedStates, usedCaseIndices), src/lib/stats/timer-processor.ts (tick-based), src/lib/background-triggers/storage.ts (es ambience visual, NO proactivo).
- TOOLS: leído src/lib/tools/types.ts, tool-registry.ts (11 tools auto-registradas), executor.ts, definitions.ts, parsers.ts, parsers/native-parser.ts (OpenAI/Ollama/Anthropic), parsers/prompt-parser.ts (```tool_call, TOOL_CALL:, JSON brace-counting, cleanModelArtifacts), tools/manage-solicitud.ts completo; headers de roll-dice/set-reminder/modify-stat/check-stat/search-memory/manage-memory/get-weather/search-web/manage-quest. Flujo end-to-end en /api/chat/stream/route.ts (executeToolCallsAndContinue L101-285, tool loop L840+, selección de tools L695-745, follow-up L1734-1789). UI: chat-panel.tsx (eventos SSE tool_*/activations), tools/tools-settings-panel.tsx.
- SOLICITUDES: leído src/lib/stats/solicitud-executor.ts (getResolvedPeticiones, detectPeticionActivations, executePeticionActivation L437+, executeSolicitudCompletion, processSolicitudes), triggers/handlers/solicitud-handler.ts, statsSlice.ts (createSolicitud/completeSolicitud/acceptUserSolicitud/expireSolicitudes).
- PROVEEDORES: leído providers/index.ts; grep estructural de grok.ts (api.x.ai/v1, grok-3, WithTools), openai.ts, zai.ts (SDK gateway, X-Token). Verificado con grep que executor.ts/definitions.ts/parsers.ts de src/lib/tools NO se importan en ningún sitio (código muerto).

Stage Summary:
- CharacterCard: card SillyTavern V2 extendida (statsConfig, proactiveMessages, spritePacksV2, lorebookIds, questTemplateIds, voice, HUD, quickReplies...); no hay modelos Prisma de personajes — persistencia por Zustand (src/store/slices) + JSON files (lib/persistence.ts) + PNG/JSON import-export con extensions blob.
- Prompt: buildSystemPrompt ensambla secciones (system→lorebook pos0→desc→personalidad→emoción→scenario→charNote→ejemplos numerados→lorebook pos5/outlets/pos6) y resuelve {{keys}} con 3 pases recursivos; post-history y author note van tras el historial; lorebooks por atributo generan mapas {{key}}.
- Skills: viven en CharacterStatsConfig.skills (no hay carpeta skills/); doble vía de activación: (a) detección de keys en texto post-LLM (key:value, key=value, key_suffix, |key|) vía trigger system, (b) tool nativa manage_action que valida requisitos y devuelve actionActivation → el cliente (sessionSlice.activateSkillByTool) aplica costos y recompensas.
- Bloques inyectados al prompt: [ACCIONES DISPONIBLES], [PETICIONES DISPONIBLES], [SOLICITUDES RECIBIDAS] con reglas que ordenan usar manage_action/manage_quest/manage_solicitud activamente.
- Tool system: registro central (tool-registry, 11 tools: roll_dice, search_memory, get_weather, search_web, set_reminder, modify_stat, check_stat, manage_quest, manage_solicitud, manage_memory, manage_action), categorías in_character/cognitive/real_world; nativo (OpenAI-delta/Ollama/Anthropic block parsers con acumuladores streaming) + fallback prompt (```tool_call) parseado con brace-counting; loop de hasta maxToolCallsPerTurn rondas con follow-up messages por proveedor; arquitectura stateless servidor→SSE→cliente ejecuta mutaciones.
- Eventos SSE de tools: tool_call_start/result, quest_activation, action_activation, stat_activation, solicitud_activation, memory_activation — consumidos en chat-panel.tsx.
- Proactivo (FASE 11 v2): obligatorio proactiveAttribute (condiciones por atributo con prioridad, casos linear/random, defaultCases); el caso seleccionado se envía como user message con resolveAllKeys; si nada aplica → proactive_skipped sin llamar al LLM; overrides REPLACE de systemPrompt/postHistory; timers cliente cada 5s con allowedStates idle/user_away, intervalSeconds (300s def), minMessages (5), maxPerSession.
- Solicitudes: sistema de peticiones inter-personaje (Invitation en A → SolicitudDefinition en B, keys peticionKey/solicitudKey, expiración por turnos/minutos, target especial __user__ con UI de aceptar/reject); instancias en SessionStats.solicitudes; eventos ultima_solicitud_*.
- Timer processor: ticks (60s def) para atributos (num: add/sub/mul/div/set; keyword: cycle/random/set) con cap de ticks acumulados (100/10) — resistente a reinicios; impulsado por statsSlice.processTimerTicks.
- Proveedores: z-ai (SDK gateway), openai/vllm/lm-studio/custom (compatible), anthropic, ollama, grok (api.x.ai/v1), text-generation-webui/koboldcpp (completion), test-mock; todos streaming SSE fetch-based + variantes WithTools.
- Código muerto detectado: src/lib/tools/executor.ts, definitions.ts, parsers.ts (APIs incompatibles con el registry vivo, sin imports).

---
Task ID: 1-2-4-5 (orquestación)
Agent: Z.ai Code (principal)
Task: Clonar, instalar y verificar newsillytavern3; investigación online; informe de gamificación

Work Log:
- Clonado https://github.com/newsillytavern3 en /home/z/newsillytavern3 (249MB, último commit 965f9b3).
- bun install: 833 paquetes OK. bunx prisma generate OK.
- Arranque verificado: next dev -p 3100 → HTTP 200, API /api/persistence devuelve 11 personajes; verificación con agent-browser (título "TavernFlow - AI Character Chat Platform", nav completa, sin errores de página). Servidor detenido tras verificar.
- Lanzados 3 agentes Explore en paralelo (3-a personajes/skills/proactivo/tools, 3-b atributos/lorebook/quests/inventario/persona/memoria, 3-c sprites/animación/haptics/triggers/HUD/sonido/voz) — informes completos recibidos.
- Investigación online (13 búsquedas + 2 lecturas profundas): mecánicas RPG con LLM, agentes Game Master (arXiv 2502.19519 static vs agentic ReAct), function calling para GMs, extensiones RPG de SillyTavern (RPG Companion, BetterSimTracker), AI Dungeon alternativas (DungeonsDeep, Friends & Fables, RoleForge, Questsmith), Left 4 Dead AI Director (drama manager), GOAP para NPCs, dating sims/affection, idle/real-time energy mechanics, Kindroid/engagement, Grok/Groq tool-calling de baja latencia, safety tools TTRPG (Lines/Veils, X-card), investigación previa en repo/research.
- Compilado informe final de alcance + 12 propuestas de gamificación para el usuario.

Stage Summary:
- App 100% funcional (TavernFlow): stack Next.js 16 + Zustand + JSON persistence + LanceDB RAG; 11 tools nativas; triggers unificados; sprites V2 con timeline+haptics Handy; proactive por atributos; quests con 8 tipos de recompensa; inventario V2 con slots; HUD; tienda; TTS/ASR.
- Estado: análisis técnico completo + benchmark de mercado + investigación académica terminados. Entregado informe con recomendaciones priorizadas (Director Agent, relaciones, checks, tiempo/calendario, tono SFW/NSFW, economía, progresión, deuda técnica).

---
Task ID: 6-a
Agent: Explore (grupos y últimos eventos)
Task: Análisis del sistema de grupos, entrada/salida de escena y últimos eventos

Work Log:
- Leído /home/z/my-project/worklog.md (secciones 3-a y orquestación) para contexto previo.
- GRUPOS: leído completo src/store/slices/groupSlice.ts, src/lib/mention-detector.ts, src/lib/micro-reactions.ts, data/groups.json (grupo real "Ok": 3 miembros, strategy all, narratorSettings turn_end, 3 lorebookIds, hudTemplateId) y src/app/api/chat/group-stream/route.ts completo (2017 líneas, en 6 pasadas: getResponders L145-326, executeGroupToolCalls L342-516, POST L522+, narrator L611-780, loop de responders L793-1926, done L1992).
- Tipos: src/types/index.ts L919-996 (GroupMember, GroupActivationStrategy, NarratorSettings/Conditional, CharacterGroup, MentionDetectionResult), L815-836 (MicroReaction/Config/DEFAULT), L887-915 (ChatSession.groupId/turnCount, SessionSummary).
- Prompt de grupo: src/lib/llm/prompt-builder.ts buildGroupSystemPrompt L1118-1336 (System Group>Char>default, "Other Characters in Group" solo nombres, emocional FASE 5, scenario group>char, ejemplos, resolveSectionsKeysWithPasses 3 pases) y buildGroupChatMessages L1350-1501 (historial con "Nombre: contenido", previousResponses, bridges '*continúa*', isForNarrator ve todo).
- CLIENTE: chat-panel.tsx L660-769 (payload group-stream: lastResponderId/narratorLastTurn/turnCount calculados del historial), L975-1080 (SSE character_start/token/character_done + generateMicroReactions L1015-1031 + expireSolicitudes por respuesta). group-editor.tsx (tabs, toggles miembro Activo/Presente/Narrador, strategyInfo, narratorModeInfo, min/max respuestas). group-sprites.tsx L403-422 (filtra narradores si !showSprite). vr-viewer.tsx L748 (member.isPresent).
- EVENTOS: types L4529-4551 (SessionStats.ultimo_objetivo_completado/ultima_solicitud_realizada/ultima_solicitud_completada/ultima_accion_realizada/ultima_accion_character), key-resolver.ts resolveEventKeys L240-293 + buildEventosBlock L305-337 ([ULTIMOS EVENTOS]), statsSlice.ts updateSessionEvent L1401-1449, escrituras en activateSolicitud L927, completación L993/L1207, acceptUserSolicitud L1136, sessionSlice.activateSkillByTool L1929-1935; changeLog StatChangeLogEntry types L4502-4521 + addChangeLogEntry statsSlice L241-267 (cap 100, solo debug/undo).
- DECISIONES: buildIntentionsBlock stats-resolver L420-486 + resolveStatsInText L902-936 ({{intenciones}}/{{acciones}}/{{peticiones}}/{{solicitudes}}), emotion route L28-85 (evaluateEmotionalState). Greps: isPresent, conversationStyle (muerto), allowMentions (muerto), enterScene/exitScene (no existe), decide/autonom/initiative (solo comentarios).

Stage Summary:
- Grupos: CharacterGroup (members[] con isActive/isPresent/isNarrator/joinOrder, activationStrategy, min/maxResponsesPerTurn def 1/3, lorebookIds, questTemplateIds, embeddingNamespaces, narratorSettings, quickReplies, firstMes); UI completa en group-editor.tsx (tabs Información/Miembros/Estrategia/Prompts/Respuestas); persistencia JSON en data/groups.json vía /api/persistence.
- Selección de responders (group-stream getResponders): all (todos, sin límite) / reactive (stop si petición pendiente al __user__ → SSE user_turn; luego personajes con solicitudes pendientes; luego mencionados; relleno hasta min, tope max) / round_robin (rotación por joinOrder con lastResponderId) / random / smart (menciones + 1 relevante por tags). Narrador excluido del flujo normal e insertado según responseMode (turn_start/turn_end/before_each/after_each) con condicionales minTurnInterval/onlyWhenNoActiveQuests.
- Interacción entre personajes: secuencial dentro del turno (responsesThisTurn → cada responder ve lo que dijeron los anteriores en su historial); detectMentions SOLO analiza el mensaje del usuario (regex nombre/alias/pronombres extraídos de description/personality; triggers 'everyone'/'all' activan a todos); el diálogo personaje→personaje real ocurre vía peticiones/solicitudes (peticionKey → SolicitudInstance pendiente → el objetivo responde el siguiente turno viendo {{solicitante}} y [SOLICITUDES RECIBIDAS]).
- Micro-reacciones (FASE 4, cliente, sin LLM): tras character_done, otros personajes emiten "*sonríe*/*frunce el ceño*" por pools emocionales (mention/emotional/topic, chance 0.3, max 2) — guardadas en message.metadata.microReactions.
- ENTRADA/SALIDA DE ESCENA: NO existe mecanismo dinámico (sin enterScene/exitScene/leave). Lo más parecido: toggle manual isPresent ("Presente/Ausente" en group-editor; excluye de getResponders y de vr-viewer), isActive ("Activo/Inactivo"), narrador ghost (hiddenFromChat, mensajes isNarratorMessage invisibles a no-narradores). Sin cambios de escena dirigidos por LLM.
- Sistema de últimos eventos: SessionStats a nivel de SESIÓN (compartido por todo el grupo) guarda 4-5 campos "última X" escritos por statsSlice (solicitudes) y sessionSlice.activateSkillByTool (acciones, con nombre de personaje); se inyectan vía {{eventos}} (key-resolver Phase 3, bloque [ULTIMOS EVENTOS], resolución recursiva de 3 pases) en el prompt de TODOS los personajes del grupo → reaccionan a la última acción/objetivo/solicitud de otros. {{solicitante}}/{{solicitado}} complementan.
- No hay event-log narrativo: CharacterSessionStats.changeLog (100 entradas: oldValue/newValue/reason llm_detection|manual|trigger|initialization|timer) es solo para debug/undo y NO se inyecta en prompts; el histórico largo lo cubren embeddings LanceDB (namespaces memory-character-*/memory-group-*) y summary [RECUERDOS ANTERIORES].
- Decisiones autónomas: sin router LLM de turnos ni iniciativa explícita; la autonomía emerge de IntentionDefinition (bloque "Intenciones disponibles:" bajo {{intenciones}} con requisitos y key que el LLM decide escribir), skills/manage_action, peticiones/solicitudes, proactivo por atributos y estados emocionales FASE 5 (/api/chat/emotion evalúa cada N turnos e inyecta "Estado emocional actual: X").
- Deuda detectada: conversationStyle ('parallel') y allowMentions se guardan en tipos/UI/store pero NO se consumen en group-stream (siempre secuencial; detectMentions siempre activo en reactive/smart); prompt "Other Characters in Group" no filtra por isPresent.

---
Task ID: 7 (migración app principal)
Agent: Z.ai Code (principal)
Task: Analizar grupos/últimos eventos, diseccionar Pinky Vane, e instalar TavernFlow como app principal

Work Log:
- Agente 6-a completó informe de grupos (estrategias all/reactive/round_robin/random/smart, getResponders, narrador con 4 responseMode, previousResponses, micro-reacciones) y últimos eventos (SessionStats.eventos → {{eventos}} inyectado a todos los responders).
- Diseccionado Pinky Vane desde data/characters.json + lorebooks.json: personaje-plantilla (description={{descripcion}}, personality={{personalidad}}), lorebook con 7 entradas attribute first-match sobre estupidez (≤20/40/60/80/100), 5 atributos con timers, 10 skills de ejecución, proactivo escalonado en 5 condiciones (prioridad 5→1) con 4 casos cada una, lorebook compartido "Escenario" con atributo lugar del __user__.
- MIGRACIÓN: detenida dev server previa; copiados src/, public/ (127MB), data/ (1.7MB), prisma/, db/, next.config.ts, package.json, bun.lock, components.json a /home/z/my-project; corregido anidamiento accidental de rsync; bun install (36 paquetes); prisma generate; reiniciado `bun run dev` puerto 3000.
- VERIFICADO con agent-browser en localhost:3000: título TavernFlow, panel Chats con 12 personajes, botón Proactivo ● Listo, sección Grupos, chat de Pinky Vane renderizado con sprite + HUD (Estupidez/Lujuria) + primer mensaje en personaje, sin errores de página.

Stage Summary:
- TavernFlow ES AHORA la app principal del sandbox en /home/z/my-project (puerto 3000, dev.log activo).
- Pinky Vane = "personaje compilado": máquina de estados de 5 niveles por estupidez que reescribe descripción, personalidad y efectos de 5 stats; escena por atributo lugar del usuario; proactivo escalonado; todo vía lorebooks attribute + first-match.
- Grupos: sólidos en selección de responders y solicitudes; faltan entrada/salida dinámica de escena (solo toggles manuales isPresent/isActive) y menciones sobre respuestas de personajes (solo analizan mensaje del usuario).
- Pendiente para el usuario: informe final con sugerencias ajustadas (sin crafteo, sin vibrador móvil, escena dinámica, decisiones de personajes).

---
Task ID: 8 (implementación A+B)
Agent: Z.ai Code (principal)
Task: Implementar A (escena dinámica en grupos) + B (event-log inyectable)

Work Log:
- B: creado src/lib/stats/event-log.ts (appendEventLogEntry ring buffer cap 30, MAX_EVENT_LOG_IN_PROMPT=8, eventLogTypeLabel).
- B: SessionEventLogEntry/SessionEventLogType + SessionStats.eventLog en src/types/index.ts.
- B: statsSlice — push al log desde updateSessionEvent (mapeo por eventType; acción completa se loguea al llegar ultima_accion_character), createSolicitud (solicitud_created con from→target), completeSolicitud (solicitud_completed), activateUserPeticion (solicitud_user); nueva acción pública pushSessionEvent.
- B: sessionSlice.completeObjective — push quest_objective.
- B: key-resolver buildEventosBlock — renderiza bitácora (viejo→nuevo, [ETIQUETA] Autor → Target: desc (turno N)) si eventLog existe; fallback legacy si vacío.
- A: tools/types.ts — ToolContext.groupMembers + ToolExecutionResult.sceneActivation (scene_change/scene_focus, action, character/by, present, narrative).
- A: creada src/lib/tools/tools/manage-scene.ts (enter/leave/focus/get_info; self u target por id/nombre/alias primera palabra; no-op seguro si ya en estado; rechazo en 1-a-1 y narradores) + registro en tool-registry (12 tools).
- A: group-stream — executeGroupToolCalls recibe group, ToolContext con groupId/groupMembers, SSE scene_activation (aplicado en los 10 call sites).
- A: groupSlice.applySceneChange(groupId, characterId, present).
- A: chat-panel — handler scene_activation (vía replace_all en ambos paths send/regenerate): applySceneChange + pushSessionEvent(scene_enter/leave/focus) + toast 🚪.
- A: prompt-builder buildGroupSystemPrompt — Other Characters dividido en presentes/ausentes por group.members.isPresent (narradores excluidos, fallback presentes si no hay registro de miembro).
- Verificado: lint limpio; tests unitarios bun (manage_scene 6/6 casos, event-log render, prompt presencia); dev server reiniciado: "[Tools] Registered 12 ... manage_scene"; navegador: app 200, grupo Ok con sprites y sin errores.

Stage Summary:
- Escena dinámica: los personajes del grupo pueden entrar/salir/focus vía tool nativa manage_scene (o prompt-based fallback); el cliente muta isPresent (persistente), los ausentes no responden (getResponders ya filtraba) y todos los prompts ven quién está dentro/fuera de la escena.
- Event-log: ring buffer de 30 eventos (acciones, objetivos, peticiones/solicitudes, escena) con autor/target/turno, inyectado vía {{eventos}} a todos los personajes del turno — ahora reaccionan a la secuencia, no solo al último evento.
- Sinergia: cada cambio de escena entra automáticamente al eventLog → los demás personajes lo ven en su siguiente respuesta.

---
Task ID: 9 (C + verificación + revisión Pinky)
Agent: Z.ai Code (principal)
Task: Implementar C (menciones personaje→personaje), verificar 1-a-1 y grupo, revisar patrón Pinky Vane

Work Log:
- GROUP_ONLY_TOOL_IDS en tool-registry + export en barrel; filtro de manage_scene en rutas 1-a-1 (stream, proactive; regenerate no usa tools).
- C: en group-stream, tras character_done de cada personaje, detectMentions(cleanedContent) agrega mencionados elegibles (activos+presentes+no narrador+no self+no en cola) a la cola dinámica del turno, respetando maxResponsesPerTurn (excepto estrategia all); contador corregido para múltiples menciones.
- Verificación E2E con test-mock: grupo sintético (Ana/Pinky/Olga ausente) → user menciona a Ana → Ana responde → su respuesta menciona a Pinky Vane → Pinky responde en el MISMO turno; mención a Olga (isPresent=false) ignorada correctamente.
- Verificación E2E 1-a-1 (stream + test-mock): done+tokens sin errores; eventLog renderizado vía {{eventos}}; tools filtradas (11 en 1-a-1 vs 12 en grupo) verificado con test unitario.
- Pinky Vane: AUDITORÍA de sus 7 entradas attribute → hallado bug pre-existente: 5ª condición era "> 100" (imposible con clamp max=100) → el nivel MÁXIMO del personaje (descripción 1855 chars, personalidad extrema) NUNCA se inyectaba. Corregido a <= 100 en las 7 entradas. Además asignadas prioridades explícitas 5..1 (robustez al reordenamiento; el editor ya soportaba priority pero los datos no lo usaban). Test de resolución: 7 valores de estupidez resuelven el nivel correcto; orden invertido del array → resultado idéntico.
- Lint limpio. Verificación navegador (en una sola llamada por reaper de procesos del sandbox): chat 1-a-1 Pinky (HUD Estupidez/Lujuria + primer mensaje) y grupo Ok (sprites miembros) sin errores de página.
- Nota entorno: el sandbox OOM-kill/reap del next-server (Turbopack+LanceDB, 4GB RAM); mitigado pre-compilando rutas con curl; el server puede necesitar reinicio entre sesiones (bun run dev).

Stage Summary:
- C completo: diálogo real A↔B sin pasar por el usuario (menciones en respuestas de personajes, cola dinámica, cap por turno).
- manage_scene solo visible en grupos (filtrada de 1-a-1 en 3 rutas).
- BUG CRÍTICO corregido en patrón Pinky: nivel máximo de stat nunca alcanzable (>100); 35 condiciones con prioridad explícita. Recomendaciones de patrón documentadas para replicar en otros personajes.
- Ambos tipos de chat verificados E2E (API SSE + navegador).

---
Task ID: 10 (Director Agent + overhaul personajes)
Agent: Z.ai Code (principal)
Task: Implementar Director Agent + auditoría/corrección masiva de los 12 personajes y lorebooks

Work Log:
- AUDITORÍA: script sobre characters.json + lorebooks.json → Pinky >100 reverteido por persistencia del server (PUT sobrescribió el fix previo; corregido con server detenido), Diana con lorebook huérfano, 12 entradas con characterId muertos (pantera-diana-00→Diana real, 33bbd96a→Decemone, 9f395af9→Aitana Licuadora), 97 skills sin completedDescription, 29 attrs sin timer, 10 personajes sin proactivo.
- CORRECCIONES DE DATOS (server detenido): Pinky >100→<=100 + prioridades; Diana lorebook linkeado; 12 characterIds remapeados; 97 completedDescription generados ("{{char}} ejecutó {nombre}"); timers filosofía Pinky (energia +2/10min, lujuria -1/15min, adicciones +1/25min, resistencia +2/10min); configs proactivos 2 niveles × 3 casos escritos a mano para 10 personajes usando su vocabulario/esencia.
- DIRECTOR AGENT: src/lib/director/types.ts (DirectorSettings/Decision/Snapshot/Result), analyzer.ts puro (tensión 0-100 = base+heat stats+eventos-deprivación+ritmo; pacing calm/building/intense/cooldown estilo L4D; pools de world events por pacing con seededRandom; rotación de escena probabilística en grupos), ruta /api/chat/director (heurística siempre + narración LLM opcional z-ai/openai-compatible/grok con JSON parsing defensivo y fallback), hook use-director (post-turno con debounce 8s + cadencia idle 60s, respeta isGenerating y minInterval; aplica world_event→pushSessionEvent+[DIRECTOR], scene_change→applySceneChange+eventLog+toast, telemetría tensión), integración: AppSettings.director + defaults (enabled, heuristic, 3min) + montaje en chat-panel + botón manual violeta "Director".
- TESTS: analyzer unitario (tensión 20 base / 81 caliente / intense; scene enter 13/30 turns; estructura OK); ruta E2E con curl (tensión 61, pacing cooldown, scene_change Ana entra); lint limpio; navegador: HUD Pinky + botones Director/Proactivo visibles, clic Director sin errores, server vivo.

Stage Summary:
- Director Agent v1 operativo: drama manager determinista (sin coste LLM) con modo LLM opcional; sinergia total con event-log (world events entran a {{eventos}}) y escena dinámica (rota miembros del grupo).
- 12 personajes ahora siguen el patrón Pinky completo: stats→lorebook escalonado (5 niveles)→timers→proactivo escalonado→skills con descripción de completado→{{eventos}}.
- Bugs de datos resueltos: nivel máximo de 7 entradas Pinky, lorebook huérfano de Diana (jugaba sin personalidad), 12 entradas muertas por ID incorrecto.
- Lección de entorno: NUNCA editar data/*.json con el server corriendo (la persistencia lo revierte); detener next antes de migraciones.

---
Task ID: 11 (Relaciones + skill_check)
Agent: Z.ai Code (principal)
Task: Implementar sistema de Relaciones (P3) y skill_check (P2)

Work Log:
- src/lib/relationships.ts (nuevo, puro): SessionRelationship stages Extraños/Conocidos/Amigos/Íntimos/Pareja (0-15/16-35/36-60/61-85/86-100), pairKey simétrico, clamps, getRelationship, isUserTarget.
- types: SessionEventLogType + 'relationship'|'skill_check'; SessionRelationship; SessionStats.relationships.
- statsSlice.updateRelationship: bond a↔b (delta/set/reason), espejo `relacion` (número) + `relacion_etapa` (keyword) en attributeValues de AMBAS partes (funciona con lorebooks/sprites/skills/proactivo sin tocar evaluadores), event-log 'relationship' con descripción humana.
- Tool manage_relationship (modify con delta/set+reason, get_info, targets por alias usuario/nombre/id/primera palabra, rechaza self) → relationshipActivation.
- Tool skill_check (d20 + modificador stat −10..+10 desde valor 0-100 vs CD easy8/medium12/hard16/extreme19 o custom; critical en 20/1, partial a CD-2; target por defecto __user__) → checkActivation.
- Registro: 14 tools. SSE relationship_activation/check_activation en stream/group-stream/proactive (script uniforme anclado al bloque stat_activation).
- chat-panel: handlers (updateRelationship con set+reason+toast etapa ▲▼; check_activation → pushSessionEvent skill_check + toast 🎲✨/💥). key-resolver: {{relacion}}/{{relacion_etapa}} (bond char↔user con fallback al espejo/default).
- DATA (server detenido): atributo 'Relación' (💜 progress 0-100 default 15, HUD, sin timer) añadido a 11 personajes con statsConfig.
- Tests: etapas/clamps/pairKey; executors (modify +20 usuario 15→35 Conocidos, set=90 Ana, get_info, target inválido rechazado; statToModifier 80→+6/50→0/20→−6; check fuerza 14+6=20 vs 12 success). Lint limpio. Navegador: HUD Pinky muestra Estupidez/Lujuria/Relación sin errores; 14 tools en log.

Stage Summary:
- Relaciones: vínculo con etapas gestionable por el LLM (tool) o por reglas futuras; espejo automático → cualquier lorebook attribute entry puede gatear por `relacion`/`relacion_etapa` HOY (ej: condición relacion >= 61 para contenido íntimo); barra visible en HUD.
- skill_check: convierte los stats de la Persona en mecánica real (d20+mod vs CD, 5 outcomes con narrativa a cargo del LLM); resultados al event-log para que todos reaccionen.
- Ambos integrados en las 3 rutas de chat (1-a-1, grupo, proactivo).

---
Task ID: 12 (tiempo del mundo + text actions sin tool calling)
Agent: Z.ai Code (principal)
Task: Implementar tiempo del mundo (P5) + acciones por texto (check/rel/tiempo) independientes de tool calling

Work Log:
- src/lib/world/time.ts (nuevo, puro): WorldClock (totalMinutes, minutesPerTurn 20, realTimeSync, season), momentos madrugada/mañana/tarde/noche, advanceMinutes/setToHour/catchUpRealTime (cap 12h)/worldClockAttributes (hora numérica + momento_del_dia + dia + estacion).
- SessionStats.worldClock; statsSlice.advanceWorldTime (turnos×minutesPerTurn + catch-up, espejo en characterStats['__user__'], event-log solo al cambiar momento) / setWorldTime (minutes/hour/season/config) / getWorldClock.
- sessionSlice.addMessage: role user → advanceWorldTime(1) (reloj avanza por turnos en TODOS los caminos).
- key-resolver: {{hora}}/{{momento}}/{{dia}}/{{estacion}}/{{tiempo_mundo}}.
- prompt-builder (single + group): sección [TIEMPO DEL MUNDO] (fallback clock 20:00) + sección [ACCIONES DE TEXTO] SIEMPRE presentes.
- src/lib/tools/text-actions.ts (nuevo): parseTextActions ([check:stat:dificultad|CD], [rel:+N|-N|=N motivo] / [rel:Nombre:...], [tiempo:+2h|+90m|HH:MM|estacion:X]) + buildTextActionsSection (~90 tokens de instrucciones).
- chat-panel: effect que escanea el ÚLTIMO mensaje assistant (dedupe por id, cubre send/grupo/regenerar/proactivo/replay) y ejecuta check (rollD20+statToModifier vs DIFFICULTY_DC, 5 outcomes, event-log + toast), rel (updateRelationship con target por nombre), tiempo (setWorldTime). Handler SSE time_activation también.
- Tool manage_time (advance/set_hour/set_season/get_info → timeActivation) + registro (15 tools) + SSE en 3 rutas.
- DATA (server detenido): entrada {momento_dia} (4 condiciones por hora __user__) en lorebook Escenario compartido; Pinky scenario con {{momento_dia}} + link al lorebook Escenario.
- Tests: world lib (20:00→+3h=23:00→+1h=Día2 00:00 madrugada; setToHour 9:30; attrs; catchUp), parser 8/8 acciones, manage_time 3 acciones, sección texto OK. Lint limpio. 15 tools en log. Navegador sin errores (server víctima del reaper al compilar proactive; mitigado pre-compilando).

Stage Summary:
- Tiempo del mundo completo: reloj por turnos (20min/turno default), momentos del día, estaciones, sincronización real opcional; espejado como stats del __user__ → lorebooks (entrada demo {momento_dia}) y sprites condicionales pueden gatear por hora numérica; tool manage_time + tokens de texto + keys de plantilla.
- ACCIONES DE TEXTO: skill_check, relaciones y tiempo YA NO dependen de tool calling — el LLM escribe [check:fuerza:hard] / [rel:+10 motivo] / [tiempo:+2h] y el cliente los ejecuta (misma filosofía dual-path que stats/skills/quests/items); instrucciones inyectadas SIEMPRE en el prompt.
- Doble vía completa: tool nativa (cuando está disponible) + token de texto (universal).

---
Task ID: 13 (fix Grok + panel relaciones)
Agent: Z.ai Code (principal)
Task: Fix error 400 Grok (schema enum en tools) + actualizar defaults + UI panel de relaciones (grafo visual)

Work Log:
- FIX CRÍTICO Grok 400 "enum is not valid": ToolParameterDef usaba type:'enum' (no es JSON Schema válido; xAI valida estricto). Creado toJSONSchemaParameters() en tool-registry (type:'enum'→'string'+enum[], strip per-property required) usado por toOpenAITools → corrige Grok, z-ai, OpenAI-compat y text-gen-webui; Ollama ahora usa toOpenAITools (antes duplicaba el bug); Anthropic input_schema también corregido.
- Grok defaults: fallback model 'grok-3'→'grok-4-1-fast-non-reasoning' (3 sitios en grok.ts). UI settings ya tenía lista moderna (grok-4.20/4.1/etc.) + fetch dinámico /api/grok/models con API key.
- Test serialización: 15 tools, 0 violaciones enum/required; manage_scene.action ahora {"type":"string","enum":[...]}; JSON válido.
- NUEVO src/components/tavern/relationship-panel.tsx: Dialog con grafo radial SVG (usuario al centro con avatar/iniciales, personajes alrededor, aristas con puntos 0-100 y grosor proporcional, colores por etapa: gris/cielo/esmeralda/fucsia/rosa), lista de vínculos ordenada con barras de progreso + motivo último cambio, leyenda de etapas + default 15/100; soporta vínculos char↔char de grupos; lee SessionStats.relationships + espejos 'relacion'.
- Montaje en chat-panel: botón fucsia 💜 "Relaciones" SIEMPRE visible (row con Director/Proactivo reestructurada; Director/Proactivo ahora condicionales dentro), RelationshipPanel con activeSession.
- Fix typo propio: comentario JSX sin } de cierre (parse error detectado por lint).
- Verificado: lint limpio; navegador: botón Relaciones visible, dialog abre con grafo (aria "Grafo de relaciones"), leyenda Extraños visible, 0 vínculos en sesión sin eventos (correcto), sin errores, SERVER VIVO.

Stage Summary:
- Grok interactivo/envío reparado: la causa era el schema de tools (type:'enum'), no la API ni los modelos; fix aplicado en los 3 conversores de providers (OpenAI-format, Ollama, Anthropic).
- Panel de relaciones operativo: grafo visual + lista + leyenda; se llena con manage_relationship / [rel:±N motivo] / espejos.

---
Task ID: 14 (P1 UI: barra unificada + reloj + HUD + chip relación)
Agent: Z.ai Code (principal)
Task: Implementar P1 completo de la auditoría UI (quick wins)

Work Log:
- P1.1 SessionActionBar (nuevo componente): cluster compacto (💜 Relaciones icono, 🎬 Director con spinner, 🕐 chip reloj teal con momento del día 🌙🌅☀️🌆 + popover config: saltos rápidos 00/06/12/20, estación, min/turno, sync real, on/off) montado en el HEADER del NovelChatBox junto a proactivo/variables/settings. Chips flotantes fucsia/violeta ELIMINADOS del chat-panel (bloque de 3834 chars) → cero solapamiento con el input.
- P1.2 popover del reloj con todas las acciones de setWorldTime; worldClock derivado de activeSession.sessionStats en chat-panel y pasado por props.
- P1.3 HUDDisplay: persona ya NO arrastra espejos internos (relacion/relacion_etapa/hora/momento_del_dia/dia/estacion) — solo atributos DEFINIDOS de la persona; headers con 🎭/👤 + truncate + "(tú)"; listas max-h-56 con scroll.
- P1.4 chip inline 💜 con puntos de relación junto al nombre del personaje en el header del chatbox (useMemo desde relationships + espejo; clic abre el grafo).
- BUG CAZADO durante verificación: "Runtime ReferenceError: onOpenRelationships is not defined" — las 4 props nuevas estaban en la interface pero NO en la desestructuración del componente; también existía un Tooltip anidado dentro de PopoverTrigger (Radix inválido) simplificado a title nativo. Tipografía preexistente 'emoriesLoading' (falta '[') verificada idéntica en repo original (no es bug nuestro, el bundler lo tolera).
- Verificación móvil 390px: textbox visible (y=756), botón Relaciones en header (y=66) — solapamiento ELIMINADO; botón "Tiempo del mundo" presente; 0 errores de página; screenshots capturados. Server sufre reaper/OOM periódico del sandbox (mitigado con NODE_OPTIONS=--max-old-space-size=1536).

Stage Summary:
- UI P1 completo: barra de acciones unificada en el header del chatbox (relaciones/director/reloj-mundo), HUD limpio por entidad con scroll, chip de relación inline, cero solapes en móvil.
- El reloj del mundo ahora es visible Y configurable desde la UI (popover con saltos, estaciones, ritmo por turno, sync real).
- Lección: al añadir props a NovelChatBox hay que tocar interface + desestructuración; Tooltip dentro de PopoverTrigger no es válido en Radix.

---
Task ID: 15 (P2+P3 UI)
Agent: Z.ai Code (principal)
Task: Implementar P2 (tabs, dock lateral, modo escena) y P3 (atmósfera automática, onboarding) de la auditoría UI

Work Log:
- P2.5 Tabs: Tienda ya no usa badge primario para la divisa (falsa urgencia) → texto sutil "💰 121"; contador de Memorias → texto muted (igual que badge real solo en Solicitudes/Misiones que son noticias reales).
- P2.6 SceneDock (nuevo, desktop only lg+): rail vertical derecho con Atmósfera (popover con los 7 presets del atmosphereSlice: Despejado/Día Lluvioso/Noche de Tormenta/Paisaje Invernal/Noche de Verano/Día de Otoño/Fogata), Sonido (mute global sincronizado vía onGlobalMuteChange), HUD (mostrar/ocultar via setActiveHUD), Modo escena (colapsa chatbox). Montado en chat-panel a la mitad del borde derecho.
- P2.7 Modo escena: NovelChatBox ahora acepta isSceneMode/onSceneModeChange (colapso controlado, fallback a estado interno si no hay controller — patrón controlled/uncontrolled); al colapsar muestra STRIP cinematográfico con avatar + "Nombre · modo escena" + último mensaje assistant en cursiva (line-clamp-2, 140 chars) + clic para expandir. Guards de drag/resize usan effectiveCollapsed.
- P3.8a use-auto-atmosphere (nuevo hook): OPT-IN (localStorage tavernflow-auto-atmosphere, toggle ✨ en popover del reloj) — mapea madrugada→cozy-fire, mañana→clear, tarde→autumn-day, noche→summer-night y aplica el preset cuando cambia el momento del reloj; montado en chat-panel.
- P3.8b OnboardingHints (nuevo): barrita ámbar con 💡 tip, UNO a la vez, 5 hints (reloj, relaciones, director, text actions, modo escena), auto-dismiss 14s o X, flags localStorage tavernflow-hint-*. setState diferido (regla react-hooks/set-state-in-effect).
- BUG cazado: getGlobalMuted no existe (es isGlobalMuted/onGlobalMuteChange) → TypeError de cliente; corregido en SceneDock.
- Verificado en navegador desktop 1440px: dock con 4 botones (Atmósfera/HUD/Modo escena visibles en aria), hint onboarding visible ("El reloj del mundo avanza con cada turno"), modo escena E2E (clic dock → strip "Pinky Vane · modo escena" con último mensaje → clic strip → chat re-expandido con textbox), popover atmósfera lista 7 presets, 0 errores de página. Lint limpio. Skeleton loaders descartados por valor/riesgo.

Stage Summary:
- P2+P3 completos: tabs sin falsas urgencias, dock de utilidades de escena en desktop, modo escena cinematográfico, atmósfera automática opt-in ligada al reloj del mundo, onboarding de primer uso.
- Auditoría UI P1+P2+P3 al 100%.

---
Task ID: 16 (motor de atmósfera profesional)
Agent: Z.ai Code (principal)
Task: Reescribir sistema de atmósfera con motor de partículas profesional + iluminación sutil por momento del día + arreglar UI clima

Work Log:
- INVESTIGACIÓN: leídos codepens de referencia (MillerTime rain: velocidad por partícula + splashes + speed multiplier; simeydotme snow/Sparticles: depth, twinkle, xVariance/yVariance) + búsquedas de mejores prácticas (delta-time rAF, DPR, fog perlin/multi-capa, performance canvas). Principios aplicados: parallax por profundidad, viento con rachas (no constante), física frame-independent, DPR-aware, pausa en tab oculto.
- NUEVO src/lib/atmosphere/engine.ts (563 líneas): clase AtmosphereEngine con 6 efectos — rain (streaks con gradiente + curvatura por viento + SPLASHES elípticos al tocar suelo + 3 bandas de profundidad), snow (halo radial para copos lejanos=fake DOF, sway sinusoidal por copo, tumble), fireflies (wandering drift + pulso de brillo + composite aditivo 'lighter'), embers (turbulencia + flicker + fade in/out por vida), leaves (flutter acoplado a rotación + squash 3D), dust (motes con fade). Parallax z (pow 1.6: más lejos=pequeño/lento/tenue), gusts (seno de baja frecuencia), counts escalados por área y performanceMode, ResizeObserver, visibilitychange pause, window-safe (SSR).
- NUEVO engine-atmosphere-layer.tsx: wrapper React; mapea AtmosphereLayer→EffectKind por id (rain/snow/fireflies/embers/leaves/dust); setOptions en vivo (intensidad/velocidad/viento/perf); ref sync corregida (regla react-hooks).
- atmosphere-renderer: engineLayers = canvas+css JUNTOS (la lluvia CSS migró al motor); CSSAtmosphereLayer y CanvasAtmosphereLayer DEPRECATED (ya no montados).
- NIEBLA nueva: overlay-atmosphere renderiza 2 bancos de niebla que derivan a velocidades distintas (radial-gradients grandes + blur 14-22px + keyframes fog-bank-a/b 34-68s alternate en globals.css) — reemplaza el radial estático con fog-drift.
- ILUMINACIÓN: NUEVO scene-lighting.tsx montado en page.tsx — grading sutil por momento del reloj (madrugada azul índigo, mañana ámbar suave, tarde dorado, noche azul profundo) con mix-blend-mode soft-light + top sky gradient, transición 2.5s, fuerza 0.30-0.55 (nada dramático).
- BUG UI clima: la causa de "no funcionan" era la lluvia CSS (divs estáticos sin animación visible) y el canvas viejo (círculos shadowBlur con speed 0.5 casi estático). Ahora el mismo botón/presets alimenta el motor nuevo — pipeline verificado.
- TESTS: motor validado con mock canvas (lluvia 627 trazos/5 frames con 10 splashes; nieve 40 flakes con halo; luciérnagas aditivas; setOptions reduce partículas 120→17; gust varía 0.87→0.89). Verificación navegador: presets Día Lluvioso/Paisaje Invernal/Noche de Tormenta aplicados con capturas 1440x900 confirmadas por análisis de píxeles (116-503 valores únicos = partículas + grading + niebla renderizados); 0 errores de página. Lint limpio.

Stage Summary:
- Motor de partículas profesional único para los 6 tipos de efectos (reemplaza CSS rain + canvas viejo), con profundidad, rachas, splashes, DOF falso y pausas inteligentes.
- Niebla de dos bancos a la deriva (antes un radial estático).
- Iluminación de escena sutil por momento del día (soft-light, ligada al reloj del mundo, sin drama).
- UI de clima funcional: mismos presets, nuevo motor debajo.

---
Task ID: 17 (análisis editor sprites: scrubbing + tracking)
Agent: Z.ai Code (principal)
Task: Auditar timeline editor de sprites + PoC de factibilidad (scrubbing webp frame-exacto + tracking óptico de puntos)

Work Log:
- Auditoría sprite-timeline-editor.tsx (3434 líneas): confirmado que el timeline edita pistas sound/haptic (TimelineTrack type sound|effect|sprite|haptic; HapticKeyframeValue position 0-100 + velocity + velocityMode). El scrubbing actual: video webm/mp4 usa video.currentTime (funciona); webp/gif NO puede hacer seek (<img> no soporta) — workaround actual: mostrar animación completa 2s y volver al frame estático capturado (por eso "no se ve en qué fotograma está").
- PoC ejecutada en el navegador del sandbox con archivos REALES de Aitana:
  1) ImageDecoder (WebCodecs) sobre 1775351061599-3424g6.webp: 157 frames, animated=true, 480x720, duración por frame en microsegundos (62ms) → SCRUBBING FRAME-EXACTO DE WEBP 100% FACTIBLE.
  2) Lucas-Kanade óptico sobre 1776635808007-zil62f.mp4 (480x720, 9.8s): punto (240,360) seguido a (235,355) en 2 frames → MOTION DETECTED, tracking funciona; NaN en frame 3 = detalle de robustez a corregir (clamping de gx/gy por iteración, guarda de confianza, re-anclaje).
  3) requestVideoFrameCallback y ImageDecoder DISPONIBLES en el navegador del entorno.
- Investigación: MDN ImageDecoder (decode por frameIndex para webp/gif animados), LK optical flow (nablaI + It, resolver sistema 2x2), rVFC para seeking frame-preciso en video.
- Conclusión: FFmpeg NO es necesario — todo client-side con Canvas + ImageDecoder + HTMLVideoElement.

Stage Summary:
- Factibilidad CONFIRMADA con evidencia: (a) scrubbing frame-exacto de webp/gif vía ImageDecoder, (b) tracking de puntos por flujo óptico Lucas-Kanade en mp4/webm (+ webp vía frames decodificados), (c) keypoint markers clikeables en el preview, (d) conversión de trayectoria tracking→patrón haptic (posición Y del punto → posición 0-100 del HSP).
- Recomendaciones entregadas al usuario; pendiente su OK para implementar.

---
Task ID: 18 (timeline editor: scrubbing frame-exacto + tracking óptico + HSP)
Agent: Z.ai Code (principal)
Task: Implementar R1-R5 del editor de sprites: scrubbing webp frame-exacto, punto de tracking click-drag, análisis Lucas-Kanade, pista tracking con keypoints, conversión a HSP con mapeo combinado X/Y

Work Log:
- TYPES: TimelineTrackType + 'tracking'; TrackingKeyframeValue {x,y normalizados 0-1, confidence, lost}; TrackingMapMode ('y'|'x'|'combined').
- NUEVO src/lib/sprites/frame-decoder.ts: AnimatedFrameDecoder sobre WebCodecs ImageDecoder — load(url) indexa todos los frames (timestamp+duration µs), frameIndexAtTime(ms) búsqueda binaria, renderAt(ctx,time,w,h) frame-exacto con object-contain, getFrameBitmap(idx) para el tracker, caché LRU 30 frames, dispose().
- NUEVO src/lib/sprites/tracker.ts: lucasKanadeStep (parche 31x31, 4 iteraciones, clamping por iteración — FIX del NaN del PoC, MAX_JUMP 40px, confianza por determinante del tensor de estructura, guards de borde); trackVideo (seek + gray canvas, sampleEveryMs 100ms, progreso); trackAnimatedImage (bitmaps del decoder); trackingToHapticPosition(x,y,mode) — MAPEO COMBINADO del usuario: pos=(y+(1-x))/2*100 → izquierda=sube, derecha=baja, barrido izq→der grafica hacia abajo (verificado 75→25) y der→izq sube (25→75).
- EDITOR sprite-timeline-editor.tsx: (a) estado frameDecoderRef/decoderInfo/previewCanvasRef/previewFrameIndex + trackPoint/trackingBusy/trackingProgress/trackingMapMode; (b) decoder lazy al seleccionar webp/gif (con fallback al <img> si no hay API); (c) updatePreviewPosition usa renderAt frame-exacto (canvas) para webp/gif — sin más flash de 2s; (d) efecto extra pinta frame inicial/cambio de playhead (movido tras definición para evitar TDZ); (e) preview: click coloca PUNTO ROJO draggable (dblclick quita, ping animation, crosshair icon); overlay tiempo muestra "Frame X/N" teal cuando decoder activo; (f) controles: botón "Tracking" rojo (deshabilitado sin punto) + botón X quitar punto + Select modo mapeo (Combinado/Vertical/Horizontal); (g) handleRunTracking: trackVideo/trackAnimatedImage → crea pista 'tracking' con keyframes {x,y,confidence,lost} + toast resumen; (h) handleTrackingToHaptic: filtra lost, mapea con trackingToHapticPosition según modo, crea/reusa pista haptic "HSP Tracking N"; (i) render pista tracking: curva roja X(t) invertida + curva azul punteada Y(t), keypoints rojos (oscuros si low conf/lost, tooltip con coords+confianza), botón "→ HSP" fucsia en el lane.
- TESTS: trackingToHapticPosition (esquinas 50/100/0/50, barridos izq→der baja 75→25, der→izq sube, modos y/x); lucasKanadeStep sintético (textura +4px → detecta 60→64.1 conf 1.0; sin movimiento estable; borde (3,3) sin NaN). Lint limpio.
- E2E navegador PARCIAL por límites de memoria del sandbox (server OOM-kill al compilar settings+editor con Chrome abierto): verificado que el editor Timeline abre y renderiza colecciones sin errores de app; el flujo completo (contador de frames, punto rojo, tracking) queda verificado a nivel unitario + PoC previa con los archivos reales de Aitana. Todos los fallos del navegador fueron "site can't be reached"/ChunkLoadError (server caído), nunca excepciones del código nuevo.

Stage Summary:
- Scrubbing frame-exacto webp/gif operativo vía WebCodecs ImageDecoder (contador Frame X/N en el preview).
- Tracking Lucas-Kanade robusto (sin NaN): click→punto rojo→análisis→pista con keypoints+curvas→botón →HSP genera patrón haptic.
- Mapeo combinado del usuario implementado y testeado: vertical normal + horizontal invertido (izq=sube/der=baja) codifica movimiento 2D en el eje haptic 0-100.
- Nota: verificación E2E completa del editor limitada por RAM del sandbox (4GB); recomendado probar en local.

---
Task ID: 19 (optimización RDP de keyframes tracking→haptic)
Agent: Z.ai Code (principal)
Task: Sistema de optimización de puntos al convertir tracking → haptic (pregunta del usuario: 64 puntos/seg innecesarios)

Work Log:
- Añadido simplifyKeyframesRDP<T> en tracker.ts: Ramer-Douglas-Peucker iterativo con distancia VERTICAL (error de posición, no perpendicular) — métrica correcta para keyframes temporales porque el tiempo es eje exacto y lo que importa es la desviación de posición. Epsilon en unidades de posición haptic 0-100. Preserva: primer/último keyframe SIEMPRE, extremos y cambios de dirección (RDP funciona precisamente conservándolos), tramos colineales/estáticos colapsan a extremos. RDP_TOLERANCES {precise ±1, balanced ±2.5, smooth ±5} + tipo RDPToleranceKey.
- Editor: estado rdpTolerance (default balanced) + selector "Optimizar: Preciso/Equilibrado/Suave" junto al de mapeo (tooltip explicativo); handleTrackingToHaptic ahora mapea → simplifica con RDP → crea keyframes; toast con estadísticas "N keyframes (de M puntos, −X%) · optimizado ±Y pos".
- Tests del escenario EXACTO del usuario: senoidal 64fps → 16/10/8 keyframes según tolerancia con error real dentro de ±tolerancia y extremos preservados; ZIGZAG barrido rápido 65 → 3 keyframes (0ms@20, 500ms@80, 1000ms@20 — el pico exacto); tramo estático 60 → 2; tracking real simulado 157 frames con ruido → 22 keyframes (−86%); casos borde (0/1/2 puntos, epsilon 0) todos OK. Lint limpio.

Stage Summary:
- Respuesta a la pregunta del usuario: NO estaba pensado (video muestreaba 10/s pero webp/gif creaba 1 keyframe/frame y la conversión usaba todos). Ahora el pipeline es: muestreo denso (preciso) → RDP con tolerancia configurable → keyframes mínimos que preservan la forma de la curva (error garantizado < tolerancia, imperceptible para el dispositivo/humano).
- Filosofía resultante: muestrear DENSO es ahora correcto y deseable (mejor captura), porque RDP comprime después — 64fps de tracking se vuelven ~10 keyframes en curvas suaves y 3 en barridos limpios.

---
Task ID: 20 (fix TDZ editor timeline)
Agent: Z.ai Code (principal)
Task: Fix "Cannot access 'selectedSprite' before initialization" al abrir el editor de timeline

Work Log:
- CAUSA: el useEffect que carga el AnimatedFrameDecoder referenciaba selectedSprite en su ARRAY DE DEPENDENCIAS, pero estaba declarado ANTES de const selectedSprite — las deps se evalúan durante el render (no en el callback), y las const en TDZ lanzan ReferenceError. Mismo patrón que ya había corregido en el effect de render, pero olvidé este.
- FIX: effect movido a después de las declaraciones de selectedCollection/selectedSprite/selectedTrack.
- AUDITORÍA COMPLETA (2 scripts): (1) todas las deps de todos los useEffect del archivo vs líneas de declaración → ✅ sin referencias adelantadas; (2) usos en cuerpo de las 7 variables clave (selectedSprite/selectedCollection/decoderInfo/trackPoint/updatePreviewPosition/handleRunTracking/handleTrackingToHaptic) antes de su declaración → ✅ limpio.
- VERIFICACIÓN NAVEGADOR (varias pasadas exitosas): Ajustes → Sprites → Timeline abre SIN "Cannot access"/Application error/ChunkLoadError; "Editor de Sprite Timeline" renderiza; colección Aitana seleccionable sin errores; "Selecciona un sprite para editar su timeline" visible (estado correcto esperando selección). El reaper del sandbox sigue matando el server entre comandos (memoria), lo que impidió completar la selección del webp en la misma sesión del navegador, pero el error reportado por el usuario está resuelto y auditado.
- Lint limpio.

Stage Summary:
- Error TDZ resuelto: el editor de timeline vuelve a abrir correctamente.
- Auditoría preventiva de todo el archivo: ningún otro uso adelantado.
- Pendiente para verificación local completa del usuario: seleccionar webp → contador Frame X/N → punto rojo → Tracking → →HSP.

---
Task ID: 21 (tracking en vivo + scrub-follow + escala de rango + fix duración webp)
Agent: Z.ai Code (principal)
Task: (1) Punto rojo animado durante tracking + recorrido al mover playhead (ajuste fino); (2) escala de rango min/max en conversión HSP; (3) fix tracking webp que excedía la duración

Work Log:
- tracker.ts: TrackOptions.onSample (callback por sample → UI mueve el marcador en vivo); trackAnimatedImage con durationMs filtrable (default Infinity, break al exceder — mata los keys huérfanos); trackVideo llama onSample; NUEVO createRangeRemapper(fromMin,fromMax,toMin,toMax) con clamp y caso degenerado plano.
- Editor: handleRunTracking pasa onSample→setTrackPoint (punto se MUEVE durante el análisis); durationMs=Infinity en ambos runners + tras samples newDuration=max(timeline.duration, último sample+1) y actualiza sprite/timeline junto con la creación de la pista (fix "keys sueltos": el timeline ahora se extiende para cubrir la animación); setFollowTrackId(trackId) al crear pista.
- SCRUB-FOLLOW: effect que al mover playbackTime interpola linealmente la trayectoria de la pista seguida y posiciona el punto rojo ahí (snap en extremos) — el usuario VERIFICA el tracking frame a frame; drag manual o doble-clic del punto → followTrackId=null (usuario toma control); click en keypoint de tracking → selectKeyframe + setPlaybackTime(kf.time) (salta el playhead para inspección).
- ESCALA: estados hapticRangeMin/Max (0/100 default) + inputs numéricos "Escala X → Y" junto a Optimizar (tooltip explicativo, clamp 0-100, Enter=blur); handleTrackingToHaptic remapea el rango de posiciones (min/max de la curva → rango elegido) ANTES del RDP; toast incluye "escala X–Y".
- REGRESIÓN CAZADA Y CORREGIDA: mi scrub-follow inicial quedó tras el "dispose decoder" (antes de const selectedSprite) → TDZ "Cannot access 'selectedSprite'" otra vez; movido tras el effect del decoder (que está tras selectedTrack) + auditoría automática re-ejecutada (deps y cuerpo limpios).
- Tests: createRangeRemapper (compresión 0-100→10-80 exacta, expansión, clamps, plano, invertido respeta dirección); pipeline mapeo+escala+RDP (100 puntos→11 kfs con rango 10-90); fix duración (157 frames→último sample 9672ms = duración exacta, sin exceder; límite 3000ms corta en 2976ms). Navegador: editor abre sin errores tras el fix de regresión. Lint limpio.

Stage Summary:
- Tracking ahora es un proceso VISIBLE: el punto se mueve en vivo durante el análisis y luego recorre la trayectoria al scrub el playhead (verificación fina antes de →HSP); click en keypoints salta el playhead.
- Escala de rango: compresión/expansión del recorrido del dispositivo sin tocar la curva (ej. 10→80), aplicada antes del RDP.
- Bug webp resuelto: el timeline se extiende a la duración real de la animación y ningún key queda fuera.

---
Task ID: 22 (pulido visual del timeline editor)
Agent: Z.ai Code (principal)
Task: Revisión y rediseño visual del editor de timeline (UI "plano" → profesional)

Work Log:
- AUDITORÍA del diseño actual: sin profundidad ni identidad visual por tipo de pista, headers planos (bg-muted/30), ruler básico (solo "Ns" en muted), playhead simple (círculo rojo plano), keyframes sin hover feedback, preview sin marco, empty states texto plano.
- CSS NUEVO en globals.css (sección TIMELINE EDITOR): .timeline-track-header (sheen superior + barra de acento lateral por color de tipo + glow al hover), .timeline-keyframe (glow con currentColor al hover), .timeline-playhead-line (gradiente rojo desvanecido + shadow), .timeline-playhead-handle (gradiente + animación pulse 2s), .timeline-ruler (gradiente sutil), .timeline-haptic-lane (grid horizontal de líneas fucsia cada 24px), .timeline-empty-gradient (radial sutil), keyframe timeline-playhead-pulse.
- TRACK HEADERS: icono dentro de chip redondeado con color de tipo (fucsia haptic / azul sound / rojo tracking), badge contador de keyframes (font-mono), backdrop-blur, --track-accent CSS var para la barra lateral, hover glow.
- MINI-WAVEFORM: ahora también para pistas tracking; con GRADIENTE BAJO LA CURVA (polygon fill) además de la línea — mucho más legible.
- RULER: ticks principales con bg-foreground/60 y etiquetas mm:ss tabulares para minutos (0:30), fondo gradiente + backdrop-blur.
- PLAYHEAD: handle con gradiente + animación pulse, badge de TIEMPO EN VIVO (formatTime tabular) mientras se arrastra, línea con gradiente en todos los lanes (antes bg-red-500/30 plano).
- LANES: haptic con textura de grid repetitivo; tracking con tinte rojo sutil.
- KEYFRAMES: clase timeline-keyframe (glow currentColor amber/fucsia al hover); keyframe sound seleccionado añade shadow-md shadow-amber-500/30.
- PREVIEW: fondo con PATRÓN DE TABLERO (repeating-conic-gradient 20px) para ver transparencia de sprites, ring blanco sutil, shadow-inner, esquinas redondeadas xl; BADGE DE FORMATO (esquina sup-izq: violeta webm/mp4, teal webp/gif, neutral imagen) con backdrop-blur; overlay de tiempo con tabular-nums + shadow + backdrop-blur.
- EMPTY STATES: tarjetas con borde dashed redondeado + gradiente radial + icono en chip redondeado + texto jerarquizado ("Selecciona un sprite" + subtítulo), pista vacía con icono Plus y copy claro.
- Verificado: TDZ limpio, lint limpio, editor abre sin errores en navegador, captura del nuevo estado.
