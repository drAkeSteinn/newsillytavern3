# Propuesta: Guardarropa V2 (Wardrobe Sets) — Selección de vestuario por el personaje

> Análisis del sistema actual (FASE 12) + diseño propuesto para un guardarropa dinámico
> donde **el personaje elige qué ponerse**, con tool calling, estado de sesión y UI reestructurada.
> Caso de estudio: **Ximena la Cogelona**.

---

## 1. Cómo funciona hoy el sistema de vestuario (FASE 12)

### 1.1 Modelo de datos

```ts
// src/types/index.ts (L4737-4756)
interface WardrobeLevel  { id: string; name: string; threshold: number; content: string; }
interface WardrobeConfig { enabled: boolean; levels: WardrobeLevel[]; blockHeader?: string; }

// En el personaje
CharacterCard.wardrobeConfig?: WardrobeConfig;

// En la sesión
CharacterSessionStats.wardrobeOffset?: number; // desplazamiento ±N del nivel base
```

**Ximena** tiene 5 niveles atados al atributo principal `adiccion` (👑 isMain):

| # | Nivel | Threshold | Contenido |
|---|-------|-----------|-----------|
| 1 | Ropa vieja | 20 | crop top negro, shorts rotos, tenis |
| 2 | Ropa vieja suelta | 40 | crop subido al pecho, shorts abiertos |
| 3 | Crop y tanga | 60 | solo crop + tanga |
| 4 | Tanga de lado | 80 | solo tanga a un lado |
| 5 | desnuda | 100 | completamente desnuda |

### 1.2 Flujo completo por turno

```
┌─ ATRIBUTO ──────────────────────────────────────────────┐
│ baseIndex = mayor threshold <= valor(adicion)           │  src/lib/wardrobe/index.ts
│ effectiveIndex = clamp(baseIndex + offset, 0, len-1)    │  getBaseLevelIndex + resolveWardrobeLevel
└──────────────────────────────────────────────────────────┘
        ↓
{{wardrobe}} → "[VESTUARIO]\n<content del nivel efectivo>"     src/lib/key-resolver.ts (fase 6.2, L818-832)
        ↓
buildSystemPrompt inyecta sección [SISTEMA DE VESTUARIO]       src/lib/llm/prompt-builder.ts (L715-756)
  (nivel actual, superior, inferior + instrucciones de la tool)
        ↓
LLM llama tool manage_wardrobe { action, reason }              src/lib/tools/tools/manage-wardrobe.ts
  get_info | escalate (+1) | regress (-1) | reset (offset=0)
        ↓
Executor devuelve wardrobeActivation payload                   stream/route.ts (L322-338)
        ↓
SSE event 'wardrobe_activation' → cliente                      chat-panel.tsx (L1196-1208)
        ↓
store.updateWardrobeOffset() → autosave → data/sessions.json   statsSlice.ts (L2083-2120)
```

### 1.3 Cómo se llama la tool (tool calling del repo)

- Registro central: `src/lib/tools/tool-registry.ts` — 16 tools registradas (`modify_stat`, `manage_wardrobe`, `manage_memory`, `manage_time`, `manage_relationship`, `manage_quest`, `roll_dice`, `skill_check`...).
- Formato nativo OpenAI `tools: [{ type: 'function', function: {...} }]` (`toOpenAITools`, L145-154) + fallback prompt-based con bloques ` ```tool_call ` para modelos sin tool calling nativo (`buildPromptBasedToolsSection`, L157-243).
- Settings globales (`data/settings.json` → `tools`): `maxToolCallsPerTurn: 2`, `disabledTools[]`, `characterConfigs[]`.
- Las descripciones de las tools pasan por `resolveAllKeys` → pueden usar placeholders.
- `manage_wardrobe` se filtra automáticamente si `!isWardrobeAvailable(character)` (`stream/route.ts` L805-812).
- Resultado → `summarizeToolResult()` genera tooltip legible ("Vestuario Escalado: → Crop y tanga").

### 1.4 Limitaciones (por qué "no se siente" un guardarropa)

1. **No es un guardarropa, es una escalera**: los 5 niveles son una progresión lineal atada a un solo stat. El personaje no puede *elegir* "me pongo el pijama" o "me pongo el vestido rojo" — solo subir/bajar un escalón.
2. **Solo movimiento adyacente ±1** por llamada de tool: imposible saltar de "desnuda" a "Ropa vieja" de un movimiento.
3. **Sin default explícito**: el nivel base lo dicta el atributo; no existe el concepto "outfit inicial".
4. **Sin identidad por outfit**: no hay tags, ni sprite/avatar asociado, ni requisitos narrativos (ej: "este vestido solo lo tiene si lo compró en la quest X").
5. **El offset nunca decae** y si el atributo sube, el personaje queda "adelantado" a su curva hasta que el LLM decida `regress`.
6. **Fallo silencioso**: `updateWardrobeOffset` (statsSlice L2091-2095) solo hace `console.warn` si `characterStats[id]` no existe → el cambio se pierde.
7. **Sin override manual del usuario** en el chat (solo toast informativo).
8. **`blockHeader` huérfano**: existe en el tipo pero no se puede editar desde la UI.
9. **Duplicación en grupos**: la sección se inyecta completa por cada personaje respondiente.
10. **Sin "quitarse la ropa" como estado**: desnudez es solo el último umbral; no hay acción explícita de desvestirse/vestirse con ida y vuelta limpia.

---

## 2. Diseño propuesto: Guardarropa V2

### 2.1 Nuevo modelo de datos (compatibilidad con el actual)

```ts
// ============ WARDROBE V2 — GUARDARROPA ============

export interface WardrobeOutfit {
  id: string;                  // 'outfit-1787723198163'
  name: string;                // "Ropa vieja", "Pijama", "Vestido de fiesta"
  description: string;         // ← LA CAJA DE TEXTO: se inyecta como {{wardrobe}}
  isDefault?: boolean;         // outfit inicial de la sesión (uno solo)
  tags?: string[];             // ["dormir","casual"] — ayuda al LLM a contextualizar
  requirements?: StatRequirement[];  // opcional: condiciones para poder ponérselo
                                     // (reutiliza src/lib/sprites/condition-evaluator.ts)
  spritePackId?: string;       // opcional: SpritePackV2 que se activa con este outfit
  avatarUrl?: string;          // opcional: cambio de avatar al ponérselo
  enabled?: boolean;
}

export interface WardrobeConfigV2 {
  enabled: boolean;
  mode: 'sets' | 'thresholds';   // 'thresholds' = legacy FASE 12 intacto
  outfits: WardrobeOutfit[];     // modo sets
  levels: WardrobeLevel[];       // legacy
  blockHeader?: string;          // default '[VESTUARIO]' — ahora editable en UI
  autoChange?: boolean;          // si el personaje puede cambiarse por iniciativa propia
}

// En la sesión (CharacterSessionStats)
activeOutfitId?: string | null;  // outfit actual; null → isDefault
outfitHistory?: string[];        // últimos ~5 ids para continuidad narrativa
```

### 2.2 Resolución de `{{wardrobe}}` (una sola función, 3 modos)

```ts
// src/lib/wardrobe/index.ts (ampliar)
function resolveActiveOutfit(character, sessionStats, characterId): WardrobeOutfit | null {
  const cfg = character.wardrobeConfig;
  if (cfg?.mode === 'thresholds') return /* lógica legacy actual */;

  const stats = sessionStats?.characterStats?.[characterId];
  const outfits = (cfg?.outfits ?? []).filter(o => o.enabled !== false);

  // 1) outfit activo de la sesión (elegido por el LLM vía tool o por el usuario)
  const active = outfits.find(o => o.id === stats?.activeOutfitId);
  if (active) return active;

  // 2) default → 3) primero habilitado
  return outfits.find(o => o.isDefault) ?? outfits[0] ?? null;
}
```

`{{wardrobe}}` se resuelve a `[VESTUARIO]\n<description>` **del outfit activo**, igual que hoy,
pero ahora el nivel lo decide **quién se lo pone**, no un umbral.

### 2.3 Tool V2: `manage_wardrobe` (reescritura)

Reemplazar las acciones adyacentes por selección real. Schema de la tool:

```jsonc
{
  "name": "manage_wardrobe",
  "description": "Gestiona el guardarropa de {{char}}. Permite ver el guardarropa completo, ponerse un outfit concreto (por nombre o id) y quitarse el outfit actual (vuelve al predeterminado). Usa 'list' para ver las opciones, luego 'wear' para ponerte algo. Elige según la escena: hora, lugar, actividad, estado de ánimo.",
  "parameters": {
    "action":   { "enum": ["list", "wear", "remove", "get_info"] },
    "outfit":   { "type": "string", "required": false, "description": "Nombre o id del outfit (para 'wear' y 'get_info')" },
    "reason":   { "type": "string", "required": false, "description": "Razón narrativa del cambio" }
  }
}
```

Comportamiento del executor:

| Acción | Qué hace | Validaciones |
|--------|----------|--------------|
| `list` | Devuelve todos los outfits: nombre, tags, requisitos evaluados (✅/❌), cuál es el activo y el default | — |
| `wear` | Se pone ese outfit → `activeOutfitId = outfit.id` | match por id o nombre (normalizado, fuzzy con `includes`); evalúa `requirements` con el condition-evaluator existente; si falla devuelve mensaje narrativo ("no tengo esa ropa aquí") |
| `remove` | `activeOutfitId = null` → vuelve al outfit `isDefault` | — |
| `get_info` | Detalle del outfit actual + del solicitado | — |

Payload SSE extendido (retrocompatible: se conservan los campos actuales y se agregan):

```ts
wardrobeActivation: {
  characterId, action, reason,
  type: 'outfit_change' | 'get_info',
  outfitId, outfitName, previousOutfitId,
  newOffset: 0, previousOffset: 0,   // legacy, se mantienen en modo thresholds
  newLevelName: outfit.name,         // reutilizado por el summarizer/toast
  newLevelContent: outfit.description,
  changed: boolean,
}
```

### 2.4 Sección de prompt V2: `[GUARDARROPA]`

Reemplaza `[SISTEMA DE VESTUARIO]` (prompt-builder L715-756):

```
[GUARDARROPA]
Tienes un guardarropa con varios outfits. El outfit que llevas puesto se describe
en [VESTUARIO] del prompt.

Outfits disponibles:
1. "Ropa vieja" (predeterminado) — casual
2. "Pijama" — dormir
3. "Vestido de fiesta" — salir, elegante
4. "Toalla" — bañarse

REGLAS:
- Cuando la escena lo justifique (llegar a casa, dormir, salir, bañarse...), CÁMBIATE de
  ropa usando la herramienta "manage_wardrobe" con action "wear" y el nombre del outfit.
- No necesitas permiso del usuario para cambiarte: decídelo tú según la escena.
- Para quitarte la ropa usa "remove" (volverás a tu outfit predeterminado).
- Mantén coherencia: si te acabas de duchar, llevas toalla; si te vas a dormir, pijama.
```

- La lista se genera dinámicamente desde `character.wardrobeConfig.outfits` (nombre + tags + marca de default).
- **Ahorro de tokens**: la descripción completa del outfit NO va en la sección de reglas (solo `{{wardrobe}}` la lleva, y solo la del activo). En grupos, la sección se comprime a una línea por personaje.

### 2.5 UI V2: reestructurar la pestaña "Vestuario" (`wardrobe-editor.tsx`)

Pasar de "lista de niveles con umbral" a un **guardarropa visual**:

```
┌──────────────────────────────────────────────────────────────┐
│ [Switch] Guardarropa activo      Modo: (Sets | Umbrales)     │
│ Header del bloque: [VESTUARIO]   ☑ Cambios autónomos         │
├──────────────────────────────────────────────────────────────┤
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐             │
│  │ ⭐ DEFAULT  │ │             │ │             │             │
│  │ Ropa vieja  │ │   Pijama    │ │  Vestido    │  ← grid de  │
│  │ [tags: ...] │ │ [dormir]    │ │  de fiesta  │    tarjetas │
│  │ ┌─────────┐ │ │ ┌─────────┐ │ │ ┌─────────┐ │    (drag &  │
│  │ │descrip. │ │ │ │descrip. │ │ │ │descrip. │ │    drop     │
│  │ └─────────┘ │ │ └─────────┘ │ │ └─────────┘ │    orden)   │
│  │ [+ Condic.] │ │ [+ Condic.] │ │ [+ Condic.] │             │
│  │ ✎ 🗑 ⭐ 👕  │ │ ✎ 🗑 ⭐ 👕  │ │ ✎ 🗑 ⭐ 👕  │             │
│  └─────────────┘ └─────────────┘ └─────────────┘             │
│   [+ Añadir outfit]                                           │
├──────────────────────────────────────────────────────────────┤
│ ⚙ Requisitos por outfit (opcional): reutilizar el editor de  │
│   condiciones de sprites (StatRequirement)                    │
│ ⚙ Visual (opcional): spritePackId / avatarUrl por outfit     │
│ ⇅ Migrar: convertir niveles (umbrales) → outfits con          │
│   condición adiccion >= threshold (botón si detecta legacy)   │
└──────────────────────────────────────────────────────────────┘
```

Detalles clave de la UI:

- **Tarjeta de outfit**: nombre editable, descripción (textarea, la "caja de texto" que pidió el usuario), tags (input de chips), badge `⭐ PREDETERMINADO`, badge `REQUISITOS (2)`.
- **Acciones por tarjeta**: editar (expandir), duplicar, borrar, **establecer como default** (radio implícito: solo una), y requisitos.
- **Modo híbrido**: si el personaje aún tiene `levels` (como Ximena), la pestaña muestra el editor legacy + banner "Migrar a guardarropa" que hace la conversión automática.
- **Header editable** y switch de cambios autónomos (si `autoChange=false`, el prompt le dice al LLM que solo se cambie cuando el usuario lo sugiera).

### 2.6 Override manual en el chat (opcional pero recomendado)

- Chip/indicador sobre el HUD: `👗 Ropa vieja ▾` con dropdown del guardarropa → `setActiveOutfit()` directo en el store (sin pasar por el LLM).
- El cambio manual emite el mismo flujo de persistencia (`sessions.json`) y se registra en `eventLog` (`{{eventos}}`) como `[VESTUARIO] Ximena se puso "Pijama"` — así el LLM lo sabe al siguiente turno sin necesidad de tool call.

### 2.7 Integración con sprites (bono)

- Si el outfit tiene `spritePackId`, al emitir `wardrobe_activation { type: 'outfit_change' }` el cliente llama `spriteSlice.applyTriggerForCharacter()` (ya existe) o setea la StateCollection → el avatar del personaje **cambia de ropa visualmente**.
- Esto conecta el guardarropa con el sistema `SpritePackV2` + `condition-evaluator` que ya está en el repo (hoy Ximena lo tiene vacío, pero Rick lo usa).

---

## 3. Plan de implementación por archivo

| # | Archivo | Cambio |
|---|---------|--------|
| 1 | `src/types/index.ts` | `WardrobeOutfit`, `WardrobeConfigV2` (o extender `WardrobeConfig` con `mode` + `outfits`), `activeOutfitId`/`outfitHistory` en `CharacterSessionStats`, extender `WardrobeActivation` |
| 2 | `src/lib/wardrobe/index.ts` | `resolveActiveOutfit()`, `listOutfits()`, `evaluateOutfitRequirements()` (reusar `condition-evaluator`), mantener legacy intacto |
| 3 | `src/lib/key-resolver.ts` | fase 6.2 → usar `resolveActiveOutfit()`; fallback a legacy si `mode==='thresholds'` |
| 4 | `src/lib/tools/tools/manage-wardrobe.ts` | reescritura: `list/wear/remove/get_info` + validación de requisitos + payload extendido |
| 5 | `src/lib/tools/tool-registry.ts` | actualizar `summarizeToolResult()` ("Ximena se puso: Pijama") |
| 6 | `src/lib/llm/prompt-builder.ts` | sección `[GUARDARROPA]` (1-a-1 y grupos, versión compacta para grupos) |
| 7 | `src/app/api/chat/stream/route.ts` + `group-stream/route.ts` | pasar outfits en ToolContext, SSE extendido |
| 8 | `src/store/slices/statsSlice.ts` | `setActiveOutfit()` + arreglar el fallo silencioso (inicializar `characterStats[id]` si no existe) |
| 9 | `src/components/tavern/wardrobe-editor.tsx` | reestructuración completa (grid de tarjetas, default, requisitos, migración) |
| 10 | `src/components/tavern/character-editor.tsx` | pestaña Vestuario → nueva UI |
| 11 | `src/components/tavern/chat-panel.tsx` | handler SSE v2 + indicador de outfit con override manual |
| 12 | `src/lib/character-card.ts` | import/export v2 en tarjeta PNG (`extensions.wardrobeConfig` ya viaja, agregar `outfits`) |
| 13 | (data) | migrar a Ximena: 5 niveles → 5 outfits con `isDefault` en el primero y `requirements: [{key:'adiccion', op:'>=', value: threshold}]` en el resto — su comportamiento actual queda reproducido exactamente, pero ahora el LLM puede elegir libremente |

## 4. Matriz de decisiones

| Pregunta | Decisión recomendada | Motivo |
|----------|---------------------|--------|
| ¿Nuevo tool o extender `manage_wardrobe`? | Extender el mismo (v2) | El LLM ya lo conoce, el filtro por disponibilidad ya existe, el summarizer/toast ya está cableado |
| ¿Umbral o sets? | Ambos (`mode`) | Backward-compat con Ximena y cualquier personaje creado; migración opcional en 1 clic |
| ¿Dónde vive el outfit activo? | `sessionStats.characterStats[charId].activeOutfitId` | El personaje puede tener distinta ropa en cada sesión/chat, igual que `wardrobeOffset` hoy |
| ¿Default? | `isDefault` en el outfit + fallback al primero | "Habría uno por defecto para iniciar" — exactamente lo pedido |
| ¿Requisitos? | Reusar `StatRequirement` + `condition-evaluator` | Misma semántica que sprites/inventario, cero código nuevo de evaluación |
| ¿Quién decide el cambio? | El LLM (tool) con override manual del usuario | Autonomía del personaje + control del usuario |

## 5. Ejemplo de ejecución end-to-end (Ximena)

1. Sesión nueva → `activeOutfitId: null` → `{{wardrobe}}` = "Ropa vieja" (default, threshold 20 reproducido).
2. Usuario: "vamos a dormir, ya es tarde". Ximena responde en personaje y llama:
   `manage_wardrobe { action: "wear", outfit: "Pijama", reason: "Se va a dormir" }`
3. Executor valida (sin requisitos → ok) → `wardrobeActivation { outfitId, changed: true }` → SSE → toast "👗 Ximena se puso: Pijama" → `sessions.json` actualiza `activeOutfitId`.
4. Turno siguiente: `{{wardrobe}}` inyecta la descripción del pijama; la sección `[GUARDARROPA]` marca el activo; el sprite cambia si hay `spritePackId`.
5. Usuario: "quítate todo" → Ximena llama `wear { outfit: "Toalla" }` o `remove` según lo que exista en su guardarropa; si hay requisito `lujuria >= 60` y está en 30, la tool responde "no se siente con confianza todavía" y el LLM lo narra en personaje.
