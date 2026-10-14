'use client';

// ============================================
// Scenario Switcher — ESCENARIO V3.2 (tree view, 3 selectable levels)
// ============================================
// Fullscreen overlay that lets the user move the CURRENT chat's scene across
// the scenario hierarchy (ScenarioDefinition → ScenarioPlace → ScenarioSpot).
//
// TREE VIEW: every scenario renders as a card with its places; each place can
// be expanded to reveal its points of interest. EVERY level is selectable and
// EACH level shows its OWN fondo (each of the 3 levels can pin a background):
//   - scenario header  → parks the scene AT THE SCENARIO LEVEL (its own fondo)
//   - place row        → moves the scene to that place
//   - spot row         → moves the scene to that spot
// The current path (scenario / place / spot) is highlighted with emerald
// badges so the user always knows where the scene is.
//
// SAVE SPRITE POSE (V3.2 — LIGADA AL FONDO, POR PERSONAJE): the header button
// saves the CURRENT sprite position+scale+opacity of the active character
// bound to the ACTIVE BACKGROUND (fondo), stored in the fondo's COLLECTION
// ENTRY (collection.json) with a settings fallback. Whenever that fondo is
// shown again (manual change, switcher, manage_escenario tool calling or
// activation keys) the sprite returns to the saved pose automatically. Nodes
// whose fondo has a saved pose show a Crosshair badge.
//
// Moving the scene writes the SESSION state:
//   - setActiveScenarioCollection(sessionId, def.id)
//   - setActiveScenario(sessionId, def.id | place.id | spot.id)
// and applies the location background (which alone triggers the fondo pose).

import { useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  MapPin,
  X,
  ChevronDown,
  ChevronRight,
  Crosshair,
  CornerDownRight,
  Image as ImageIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useTavernStore } from '@/store/tavern-store';
import {
  getEffectiveScenarioDefinitions,
  resolveActiveScenarioLocation,
} from '@/lib/scenario/library';
import {
  saveSpritePoseToCurrentBackground,
  lookupSpritePoseForBackground,
  resolveBackgroundDisplayName,
  type SpritePoseLookupState,
} from '@/lib/scenario/save-pose';
import type { ScenarioDefinition, ScenarioPlace, ScenarioSpot } from '@/types';

interface ScenarioSwitcherProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Tiny fondo chip: shows WHICH background the node will display — every level
 * (escenario / lugar / punto de interés) can pin its own fondo (V3.2).
 */
function FondoNameChip({ bg }: { bg: string | null | undefined }) {
  if (!bg) return null;
  return (
    <span className="hidden md:inline-flex items-center gap-1 text-[10px] text-muted-foreground/80 shrink-0 max-w-40">
      <ImageIcon className="w-3 h-3 shrink-0" />
      <span className="truncate">{resolveBackgroundDisplayName(bg)}</span>
    </span>
  );
}

/** Tiny Crosshair mark: the node's fondo has a sprite pose saved (V3.2). */
function FondoPoseMark({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      title="Este fondo tiene una pose de sprite guardada — el sprite volverá aquí al mostrarse"
      className="shrink-0 inline-flex"
    >
      <Crosshair className="w-3 h-3 text-emerald-500" />
    </span>
  );
}

export function ScenarioSwitcher({ open, onOpenChange }: ScenarioSwitcherProps) {
  const activeSessionId = useTavernStore((s) => s.activeSessionId);
  const sessions = useTavernStore((s) => s.sessions);
  const activeCharacterId = useTavernStore((s) => s.activeCharacterId);
  const activeGroupId = useTavernStore((s) => s.activeGroupId);
  const characters = useTavernStore((s) => s.characters);
  const groups = useTavernStore((s) => s.groups);
  const scenarios = useTavernStore((s) => s.scenarios);
  // V3.2: poses live in the COLLECTION ENTRIES (collection.json per fondo,
  // per character) with a settings fallback — both subscribed for reactivity.
  const backgroundCollections = useTavernStore((s) => s.backgroundCollections);
  const spriteBackgroundPoses = useTavernStore((s) => s.settings.spriteBackgroundPoses);

  // Collapsed place ids (all places with spots start EXPANDED so the full
  // tree is visible at first glance — the user asked to SEE the tree).
  const [collapsedPlaces, setCollapsedPlaces] = useState<Set<string>>(new Set());

  const session = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) || null,
    [sessions, activeSessionId]
  );

  // Active character: the session's character first, then the global selector
  const character = useMemo(() => {
    const sessionChar = session?.characterId
      ? characters.find((c) => c.id === session.characterId)
      : undefined;
    if (sessionChar) return sessionChar;
    return activeCharacterId ? characters.find((c) => c.id === activeCharacterId) : undefined;
  }, [session, characters, activeCharacterId]);

  // Active group (group mode): the session's group first, then the selector
  const group = useMemo(() => {
    const groupId = session?.groupId || activeGroupId;
    return groupId ? groups.find((g) => g.id === groupId) : undefined;
  }, [session, groups, activeGroupId]);

  const definitions = useMemo(
    () => getEffectiveScenarioDefinitions(character, scenarios, group),
    [character, scenarios, group]
  );

  const activeLocation = useMemo(
    () => resolveActiveScenarioLocation(definitions, session?.sessionStats ?? null),
    [definitions, session]
  );

  // Fondo pose lookup of the ACTIVE character (V3.2) — reactive against both
  // storages (collection entries first, settings fallback).
  const poseLookupState = useMemo<SpritePoseLookupState>(
    () => ({ backgroundCollections, settings: { spriteBackgroundPoses } }),
    [backgroundCollections, spriteBackgroundPoses]
  );
  const poseExists = useCallback(
    (bg: string | null | undefined) =>
      !!bg && !!lookupSpritePoseForBackground(poseLookupState, character?.id, bg),
    [poseLookupState, character?.id]
  );

  const togglePlace = (placeId: string) => {
    setCollapsedPlaces((prev) => {
      const next = new Set(prev);
      if (next.has(placeId)) next.delete(placeId);
      else next.add(placeId);
      return next;
    });
  };

  const moveScene = (def: ScenarioDefinition, place: ScenarioPlace, spot?: ScenarioSpot | null) => {
    const store = useTavernStore.getState();
    const sessionId = store.activeSessionId;
    if (!sessionId) {
      toast.error('No hay sesión activa');
      return;
    }
    store.setActiveScenarioCollection?.(sessionId, def.id);
    store.setActiveScenario?.(sessionId, spot?.id ?? place.id);
    // Apply the location background — this ALONE triggers the sprite pose of
    // that fondo (poses live in the collection entries and CharacterSprite
    // applies them on background change; V3.2).
    const bg = spot?.backgroundUrl || place.backgroundUrl || def.defaultBackgroundUrl || null;
    if (bg) store.setActiveBackground?.(bg);
    const dest = spot ? `${place.name} · ${spot.name}` : place.name;
    toast.success(`📍 Escenario: ${def.name} → ${dest}`);
    onOpenChange(false);
  };

  /**
   * V3.2: move the scene AT THE SCENARIO LEVEL itself — the escenario's OWN
   * fondo (defaultBackgroundUrl) is the one displayed, independently of the
   * places. Works for manual clicks and (via the same session state) for
   * tool calling.
   */
  const moveSceneToScenario = (def: ScenarioDefinition) => {
    const store = useTavernStore.getState();
    const sessionId = store.activeSessionId;
    if (!sessionId) {
      toast.error('No hay sesión activa');
      return;
    }
    store.setActiveScenarioCollection?.(sessionId, def.id);
    store.setActiveScenario?.(sessionId, def.id); // the scenario id ITSELF
    const bg = def.defaultBackgroundUrl || null;
    if (bg) {
      store.setActiveBackground?.(bg);
      toast.success(`📍 Escenario: ${def.name} (nivel escenario · fondo: ${resolveBackgroundDisplayName(bg)})`);
    } else {
      toast.info(`📍 Escenario: ${def.name} — sin fondo propio asignado, se mantiene el fondo actual`);
    }
    onOpenChange(false);
  };

  const handleScenarioClick = (def: ScenarioDefinition) => {
    // V3.2: the escenario header parks the scene AT THE SCENARIO LEVEL (its
    // own fondo). If it has no fondo AND no places, warn.
    if (!def.defaultBackgroundUrl && def.places.length === 0) {
      toast.error('Este escenario no tiene fondo ni lugares todavía');
      return;
    }
    moveSceneToScenario(def);
  };

  // Save the CURRENT sprite transform of the active character LIGADO AL FONDO
  // ACTIVO (reads the live sprite position from localStorage — the
  // CharacterSprite component keeps it in sync on every drag/resize).
  const handleSaveSpritePose = async () => {
    if (!character?.id) {
      toast.error('No hay personaje activo en esta sesión');
      return;
    }
    let raw: unknown = null;
    try {
      raw = JSON.parse(localStorage.getItem(`sprite-${character.id}`) || 'null');
    } catch {
      raw = null;
    }
    if (!raw || typeof raw !== 'object') {
      toast.error('No se encontró la posición actual del sprite — muévelo primero');
      return;
    }
    const result = await saveSpritePoseToCurrentBackground(character.id, raw);
    if (result.ok) {
      toast.success(`🧷 Pose guardada para el fondo "${result.where}" — el sprite volverá aquí al mostrar ese fondo`);
    } else {
      const messages: Record<string, string> = {
        'no-background': 'No hay ningún fondo activo para guardar la pose',
        'invalid-pose': 'No se pudo leer la posición actual del sprite',
        'save-failed': 'No se pudo escribir la pose en el JSON de la colección — inténtalo de nuevo',
      };
      toast.error(messages[result.error ?? 'invalid-pose'] ?? 'No se pudo guardar la pose');
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="scenario-switcher-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="fixed inset-0 z-50 bg-background"
        >
          <div className="h-full flex flex-col">
            {/* Header */}
            <motion.div
              initial={{ y: -8, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.2, delay: 0.05, ease: 'easeOut' }}
              className="h-14 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex items-center justify-between px-4 flex-shrink-0"
            >
              <div className="flex items-center gap-2 min-w-0">
                <MapPin className="w-5 h-5 text-emerald-500 shrink-0" />
                <h2 className="font-semibold text-sm">Escenarios de la escena</h2>
                {activeLocation && (
                  <Badge
                    variant="outline"
                    className="text-[10px] border-emerald-500/40 text-emerald-500 hidden sm:inline-flex shrink-0"
                  >
                    Actual: {activeLocation.locationName}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 text-xs"
                  onClick={handleSaveSpritePose}
                  title="Guarda la posición y escala ACTUALES del sprite ligadas al FONDO activo — el sprite volverá aquí cada vez que se muestre ese fondo"
                >
                  <Crosshair className="w-3.5 h-3.5 mr-1.5" />
                  <span className="hidden md:inline">Guardar pose en el fondo actual</span>
                  <span className="md:hidden">Guardar pose</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => onOpenChange(false)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </motion.div>

            {/* Hint bar */}
            <div className="px-4 py-2 border-b bg-muted/30 text-[11px] text-muted-foreground flex-shrink-0">
              Los <span className="text-foreground/80 font-medium">3 niveles</span> son seleccionables — Escenario (con su propio fondo), Lugar y Punto de
              interés (cada uno muestra su fondo a la derecha). Mueve el sprite donde quieras y pulsa «Guardar pose en el fondo actual»: la posición se
              guarda LIGADA AL FONDO y POR PERSONAJE (en el JSON de la colección) y el sprite vuelve a ella cada vez que ese fondo se muestre, venga el
              cambio de donde venga (manual, por la escena, por tool calling o por clave de activación).
            </div>

            {/* Body */}
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: 0.1, ease: 'easeOut' }}
              className="flex-1 min-h-0"
            >
              <ScrollArea className="h-full">
                <div className="p-4 max-w-3xl mx-auto space-y-3">
                  {definitions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center px-4">
                      <MapPin className="w-10 h-10 text-muted-foreground/40 mb-3" />
                      <p className="text-sm font-medium">
                        Este personaje no tiene escenarios asignados.
                      </p>
                      <p className="text-xs text-muted-foreground mt-1 max-w-md">
                        Selecciona escenarios en el editor del personaje (pestaña Escenario) o crea
                        colecciones en Ajustes → Escenarios.
                      </p>
                    </div>
                  ) : (
                    definitions.map((def) => {
                      const isCurrentScenario = activeLocation?.definition.id === def.id;
                      const totalSpots = def.places.reduce((acc, p) => acc + p.spots.length, 0);
                      return (
                        <div
                          key={def.id}
                          className={cn(
                            'border rounded-lg bg-card overflow-hidden transition-colors',
                            isCurrentScenario && 'border-emerald-500/50 ring-1 ring-emerald-500/20'
                          )}
                        >
                          {/* Card header — parks the scene AT THE SCENARIO LEVEL (own fondo) */}
                          <button
                            type="button"
                            className="w-full text-left p-3 hover:bg-muted/40 transition-colors"
                            onClick={() => handleScenarioClick(def)}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <MapPin className="w-4 h-4 text-emerald-500 shrink-0" />
                              <span className="font-medium text-sm truncate">
                                {def.name || 'Sin nombre'}
                              </span>
                              <FondoPoseMark show={poseExists(def.defaultBackgroundUrl)} />
                              <FondoNameChip bg={def.defaultBackgroundUrl} />
                              {isCurrentScenario && (
                                <Badge className="text-[10px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-0 shrink-0 hover:bg-emerald-500/15">
                                  {activeLocation?.isScenarioLevel ? '← Actual (escenario)' : 'Escenario actual'}
                                </Badge>
                              )}
                              <span className="ml-auto text-[11px] text-muted-foreground shrink-0">
                                {def.places.length} lugar{def.places.length !== 1 ? 'es' : ''}
                                {totalSpots > 0 && ` · ${totalSpots} punto${totalSpots !== 1 ? 's' : ''} de interés`}
                              </span>
                            </div>
                            {def.description && (
                              <p className="text-xs text-muted-foreground mt-1">{def.description}</p>
                            )}
                            <p className="text-[10px] text-muted-foreground/70 mt-1.5">
                              Clic para mover la escena a este ESCENARIO (se muestra su fondo propio{def.defaultBackgroundUrl ? '' : ' — sin fondo asignado aún'}).
                            </p>
                          </button>

                          {/* Tree: places (level 1) → points of interest (level 2) */}
                          {def.places.length > 0 && (
                            <div className="px-3 pb-3 space-y-1">
                              {def.places.map((place) => {
                                const isCurrentPlace =
                                  isCurrentScenario && activeLocation?.place.id === place.id;
                                const isExactCurrentPlace = isCurrentPlace && !activeLocation?.isSpot;
                                const hasSpots = place.spots.length > 0;
                                const collapsed = collapsedPlaces.has(place.id);
                                const placeBg = place.backgroundUrl || def.defaultBackgroundUrl;
                                return (
                                  <div key={place.id}>
                                    {/* Place row */}
                                    <div
                                      className={cn(
                                        'flex items-stretch rounded-md border transition-colors',
                                        isExactCurrentPlace
                                          ? 'border-emerald-500/50 bg-emerald-500/10'
                                          : isCurrentPlace
                                            ? 'border-emerald-500/30 bg-emerald-500/5'
                                            : 'border-transparent hover:bg-muted/40'
                                      )}
                                    >
                                      {hasSpots ? (
                                        <button
                                          type="button"
                                          aria-label={collapsed ? 'Expandir puntos de interés' : 'Colapsar puntos de interés'}
                                          className="px-1.5 flex items-center text-muted-foreground hover:text-foreground transition-colors"
                                          onClick={() => togglePlace(place.id)}
                                        >
                                          {collapsed ? (
                                            <ChevronRight className="w-3.5 h-3.5" />
                                          ) : (
                                            <ChevronDown className="w-3.5 h-3.5" />
                                          )}
                                        </button>
                                      ) : (
                                        <span className="w-6 flex items-center justify-center">
                                          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
                                        </span>
                                      )}
                                      <button
                                        type="button"
                                        className="flex-1 min-w-0 flex items-center gap-2 py-2 pr-2 text-left"
                                        title={place.description || 'Ir a este lugar'}
                                        onClick={() => moveScene(def, place)}
                                      >
                                        <span
                                          className={cn(
                                            'text-sm truncate',
                                            isExactCurrentPlace
                                              ? 'font-medium text-emerald-700 dark:text-emerald-300'
                                              : 'text-foreground/90'
                                          )}
                                        >
                                          {place.name || 'Sin nombre'}
                                        </span>
                                        <FondoPoseMark show={poseExists(placeBg)} />
                                        <FondoNameChip bg={placeBg} />
                                        {hasSpots && (
                                          <span className="text-[10px] text-muted-foreground shrink-0">
                                            {place.spots.length} punto{place.spots.length !== 1 ? 's' : ''}
                                          </span>
                                        )}
                                        {isExactCurrentPlace && (
                                          <Badge className="ml-auto shrink-0 text-[10px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-0 hover:bg-emerald-500/15">
                                            ← Actual
                                          </Badge>
                                        )}
                                        {isCurrentPlace && activeLocation?.isSpot && (
                                          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                                            dentro: {activeLocation.spot?.name}
                                          </span>
                                        )}
                                      </button>
                                    </div>

                                    {/* Spot rows (level 2) */}
                                    {hasSpots && !collapsed && (
                                      <div className="ml-6 border-l border-border/70 pl-1.5 my-1 space-y-0.5">
                                        {place.spots.map((spot) => {
                                          const isCurrentSpot =
                                            isCurrentScenario &&
                                            activeLocation?.isSpot &&
                                            activeLocation?.spot?.id === spot.id;
                                          const spotBg = spot.backgroundUrl || place.backgroundUrl || def.defaultBackgroundUrl;
                                          return (
                                            <button
                                              key={spot.id}
                                              type="button"
                                              title={spot.description || 'Ir a este punto de interés'}
                                              onClick={() => moveScene(def, place, spot)}
                                              className={cn(
                                                'w-full flex items-center gap-1.5 text-left px-2 py-1.5 rounded-md text-xs transition-colors',
                                                isCurrentSpot
                                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                                  : 'text-foreground/75 hover:bg-muted/60'
                                              )}
                                            >
                                              <CornerDownRight className="w-3 h-3 shrink-0 text-muted-foreground/60" />
                                              <span className="truncate">{spot.name || 'Sin nombre'}</span>
                                              <FondoPoseMark show={poseExists(spotBg)} />
                                              <FondoNameChip bg={spotBg} />
                                              {spot.description && (
                                                <span className="truncate text-[10px] text-muted-foreground hidden md:inline">
                                                  · {spot.description}
                                                </span>
                                              )}
                                              {isCurrentSpot && (
                                                <Badge className="ml-auto shrink-0 text-[10px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-0 hover:bg-emerald-500/15">
                                                  ← Actual
                                                </Badge>
                                              )}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default ScenarioSwitcher;
