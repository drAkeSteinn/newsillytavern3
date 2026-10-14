'use client';

// ============================================
// Scenario Library Panel — ESCENARIO V3.1
// ============================================
// App-level scenario library manager (Ajustes → Escenarios).
// Hierarchy: ScenarioDefinition ("Departamento") → places ("Cuarto", "Cocina")
// → spots ("Cama", "Escritorio"). Every level can pin an optional background;
// the sprite pose is bound to the FONDO (background), per character, from the
// chat (sprite popover / ScenarioSwitcher) — nodes with a fondo that has a
// saved pose show a Crosshair badge here. Characters and groups reference
// this library by id (scenarioIds) from their editors.

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from 'sonner';
import {
  MapPin,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Star,
  X,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  FolderOpen,
  Video,
  Crosshair,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTavernStore } from '@/store/tavern-store';
import { clearSpritePoseForAllCharacters, countCharactersWithPoseForBackground } from '@/lib/scenario/save-pose';
import type { ScenarioDefinition, ScenarioPlace, ScenarioSpot } from '@/types';

function genId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the manual generator
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================
// BackgroundPicker — small lazy background chooser
// ============================================
// Fetches /api/backgrounds/collections only when the popover opens and shows
// the files grouped by collection as a thumbnail grid inside a ScrollArea.

interface BgFile {
  name: string;
  url: string;
  type: 'image' | 'video';
}

interface BgCollection {
  name: string;
  path: string;
  files: BgFile[];
}

interface BackgroundPickerProps {
  value?: string;
  onChange: (url: string | undefined) => void;
}

export function BackgroundPicker({ value, onChange }: BackgroundPickerProps) {
  const [open, setOpen] = useState(false);
  const [collections, setCollections] = useState<BgCollection[]>([]);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Lazy fetch: only request collections while the popover is open.
  // NOTE: `loading` is flipped in the open/reload handlers (not synchronously
  // inside this effect) to keep the React hooks lint rules happy.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch('/api/backgrounds/collections')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => {
        if (cancelled) return;
        setCollections(Array.isArray(data?.collections) ? data.collections : []);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setCollections([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, reloadKey]);

  const handlePickerOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setLoading(true);
  };

  const handleReload = () => {
    setLoading(true);
    setReloadKey((k) => k + 1);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {value && (
        <div className="relative">
          <img
            src={value}
            alt="Fondo seleccionado"
            className="h-10 w-16 object-cover rounded border"
          />
          <button
            type="button"
            title="Quitar fondo"
            className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow"
            onClick={() => onChange(undefined)}
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </div>
      )}
      <Popover open={open} onOpenChange={handlePickerOpenChange}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs">
            <ImageIcon className="w-3.5 h-3.5 mr-1.5" />
            {value ? 'Cambiar fondo' : 'Elegir fondo'}
          </Button>
        </PopoverTrigger>
        <PopoverContent side="left" align="start" className="w-80 p-0">
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <span className="text-xs font-medium flex items-center gap-1.5">
              <FolderOpen className="w-3.5 h-3.5 text-muted-foreground" />
              Fondos disponibles
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleReload}
              disabled={loading}
              title="Recargar"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
            </Button>
          </div>
          <ScrollArea className="max-h-64">
            <div className="p-2 space-y-2.5">
              {!loading && collections.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6">
                  No hay colecciones de fondos. Agrega imágenes en Ajustes → Fondos.
                </p>
              )}
              {collections.map((collection) => (
                <div key={collection.path || collection.name}>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground px-1 pb-1 flex items-center gap-1">
                    <FolderOpen className="w-3 h-3" />
                    {collection.name}
                  </p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {collection.files.map((file) => (
                      <button
                        key={file.url}
                        type="button"
                        title={file.name}
                        onClick={() => {
                          onChange(file.url);
                          setOpen(false);
                        }}
                        className={cn(
                          'relative h-12 rounded overflow-hidden border transition-all hover:scale-[1.03]',
                          value === file.url
                            ? 'border-emerald-500 ring-1 ring-emerald-500/40'
                            : 'border-border/60 hover:border-emerald-500/50'
                        )}
                      >
                        {file.type === 'video' ? (
                          <video
                            src={file.url}
                            muted
                            preload="metadata"
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                        ) : (
                          <img
                            src={file.url}
                            alt={file.name}
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                        )}
                        {file.type === 'video' && (
                          <span className="absolute top-0.5 left-0.5 bg-black/60 rounded px-0.5 flex items-center justify-center">
                            <Video className="w-2.5 h-2.5 text-white" />
                          </span>
                        )}
                        {value === file.url && (
                          <span className="absolute inset-0 ring-2 ring-emerald-500 ring-inset" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ============================================
// Place editor (with nested spots)
// ============================================

interface PlaceEditorProps {
  place: ScenarioPlace;
  isDefault: boolean;
  /** Scenario-level default fondo — fallback for nodes without their own. */
  scenarioDefaultBg?: string;
  onUpdate: (updates: Partial<ScenarioPlace>) => void;
  onDelete: () => void;
  onSetDefault: () => void;
  onAddSpot: () => void;
  onUpdateSpot: (spotId: string, updates: Partial<ScenarioSpot>) => void;
  onDeleteSpot: (spotId: string) => void;
}

function PlaceEditor({
  place,
  isDefault,
  scenarioDefaultBg,
  onUpdate,
  onDelete,
  onSetDefault,
  onAddSpot,
  onUpdateSpot,
  onDeleteSpot,
}: PlaceEditorProps) {
  // V3.2: the sprite pose is bound to the FONDO (per character), stored in the
  // fondo's COLLECTION ENTRY (collection.json) with a settings fallback, saved
  // from the chat. Show how many characters have a pose for this node's fondo.
  // Subscribed to both storages ONLY for reactivity; the count reads the live
  // store imperatively (countCharactersWithPoseForBackground).
  useTavernStore((s) => s.backgroundCollections);
  useTavernStore((s) => s.settings.spriteBackgroundPoses);
  const countFondoPoses = (bg?: string) =>
    bg ? countCharactersWithPoseForBackground(bg) : 0;
  const removeFondoPose = async (bg: string) => {
    const removed = await clearSpritePoseForAllCharacters(bg);
    if (removed > 0) {
      toast.success(`Pose eliminada del fondo (${removed} personaje${removed !== 1 ? 's' : ''})`);
    } else {
      toast.info('Este fondo no tenía pose guardada');
    }
  };

  const placeBg = place.backgroundUrl || scenarioDefaultBg;
  const placePoseCount = countFondoPoses(placeBg);

  return (
    <div className={cn('border rounded-lg bg-muted/20', isDefault && 'border-emerald-500/40 bg-emerald-500/5')}>
      {/* Place header */}
      <div className="flex items-center gap-2 p-2.5 flex-wrap">
        {isDefault ? (
          <Star className="w-4 h-4 text-emerald-500 fill-emerald-500 shrink-0" />
        ) : (
          <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
        <span className="text-xs font-medium text-muted-foreground shrink-0">Lugar</span>
        {placePoseCount > 0 && (
          <Badge
            variant="outline"
            className="text-[10px] border-emerald-500/40 text-emerald-600 dark:text-emerald-400 shrink-0 gap-0.5"
          >
            <Crosshair className="w-3 h-3" />
            Pose en fondo ({placePoseCount})
          </Badge>
        )}
        <div className="flex items-center gap-1 ml-auto shrink-0">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn('h-7 w-7', isDefault && 'text-emerald-500')}
            onClick={onSetDefault}
            title={isDefault ? 'Quitar como predeterminado' : 'Establecer como predeterminado'}
          >
            <Star className={cn('w-3.5 h-3.5', isDefault && 'fill-emerald-500')} />
          </Button>
          {placePoseCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-emerald-500"
              onClick={() => placeBg && removeFondoPose(placeBg)}
              title="Quitar la pose guardada de este fondo (todos los personajes)"
            >
              <Crosshair className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onDelete}
            title="Eliminar lugar"
          >
            <Trash2 className="w-3.5 h-3.5 text-destructive" />
          </Button>
        </div>
      </div>

      <div className="px-2.5 pb-2.5 space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <Label className="text-xs">Nombre *</Label>
            <Input
              value={place.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              placeholder="Ej: Cuarto, Cocina, Baño..."
              className="h-8"
            />
          </div>
          <div>
            <Label className="text-xs">Descripción</Label>
            <Textarea
              value={place.description ?? ''}
              onChange={(e) => onUpdate({ description: e.target.value })}
              placeholder="Describe el lugar con detalle (se inyecta en el prompt)..."
              className="min-h-[38px] h-[58px] text-xs resize-none"
            />
          </div>
        </div>

        <div>
          <Label className="text-xs mb-1.5 block">Fondo del lugar</Label>
          <BackgroundPicker value={place.backgroundUrl} onChange={(url) => onUpdate({ backgroundUrl: url })} />
        </div>

        {/* Spots (puntos de interés) */}
        <div className="pl-2 sm:pl-4 border-l space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              Puntos de interés ({place.spots.length})
            </span>
            <Button type="button" size="sm" variant="ghost" className="h-6 text-[11px] px-2" onClick={onAddSpot}>
              <Plus className="w-3 h-3 mr-0.5" />
              Agregar punto de interés
            </Button>
          </div>
          {place.spots.map((spot) => {
            const spotBg = spot.backgroundUrl || place.backgroundUrl || scenarioDefaultBg;
            const spotPoseCount = countFondoPoses(spotBg);
            return (
            <div key={spot.id} className="rounded-md border bg-background/60 p-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <Input
                  value={spot.name}
                  onChange={(e) => onUpdateSpot(spot.id, { name: e.target.value })}
                  placeholder="Nombre del punto (Ej: Cama, Escritorio)"
                  className="h-7 text-xs flex-1"
                />
                {spotPoseCount > 0 && (
                  <Badge
                    variant="outline"
                    className="text-[10px] border-emerald-500/40 text-emerald-600 dark:text-emerald-400 shrink-0 gap-0.5"
                  >
                    <Crosshair className="w-3 h-3" />
                    Pose en fondo ({spotPoseCount})
                  </Badge>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => onDeleteSpot(spot.id)}
                  title="Eliminar punto"
                >
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </Button>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Input
                  value={spot.description ?? ''}
                  onChange={(e) => onUpdateSpot(spot.id, { description: e.target.value })}
                  placeholder="Descripción corta (opcional)"
                  className="h-7 text-xs flex-1 min-w-[140px]"
                />
                <BackgroundPicker
                  value={spot.backgroundUrl}
                  onChange={(url) => onUpdateSpot(spot.id, { backgroundUrl: url })}
                />
              </div>
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Scenario card (collapsed row + expanded editor)
// ============================================

interface ScenarioCardProps {
  scenario: ScenarioDefinition;
  expanded: boolean;
  onToggleExpand: () => void;
  onDelete: () => void;
}

function ScenarioCard({ scenario, expanded, onToggleExpand, onDelete }: ScenarioCardProps) {
  const updateScenario = useTavernStore((s) => s.updateScenario);

  const patch = (updates: Partial<ScenarioDefinition>) => updateScenario(scenario.id, updates);

  const updatePlace = (placeId: string, updates: Partial<ScenarioPlace>) => {
    patch({ places: scenario.places.map((p) => (p.id === placeId ? { ...p, ...updates } : p)) });
  };

  const addPlace = () => {
    const place: ScenarioPlace = {
      id: genId(),
      name: `Lugar ${scenario.places.length + 1}`,
      spots: [],
    };
    patch({
      places: [...scenario.places, place],
      ...(scenario.places.length === 0 ? { defaultPlaceId: place.id } : {}),
    });
  };

  const deletePlace = (placeId: string) => {
    const place = scenario.places.find((p) => p.id === placeId);
    if (!window.confirm(`¿Eliminar el lugar "${place?.name || 'sin nombre'}" y todos sus puntos de interés?`)) return;
    const remaining = scenario.places.filter((p) => p.id !== placeId);
    patch({
      places: remaining,
      ...(scenario.defaultPlaceId === placeId ? { defaultPlaceId: remaining[0]?.id ?? null } : {}),
    });
  };

  const setDefaultPlace = (placeId: string) => {
    patch({ defaultPlaceId: scenario.defaultPlaceId === placeId ? null : placeId });
  };

  const addSpot = (placeId: string) => {
    const place = scenario.places.find((p) => p.id === placeId);
    if (!place) return;
    const spot: ScenarioSpot = { id: genId(), name: `Punto ${place.spots.length + 1}` };
    updatePlace(placeId, { spots: [...place.spots, spot] });
  };

  const updateSpot = (placeId: string, spotId: string, updates: Partial<ScenarioSpot>) => {
    const place = scenario.places.find((p) => p.id === placeId);
    if (!place) return;
    updatePlace(placeId, {
      spots: place.spots.map((s) => (s.id === spotId ? { ...s, ...updates } : s)),
    });
  };

  const deleteSpot = (placeId: string, spotId: string) => {
    const place = scenario.places.find((p) => p.id === placeId);
    if (!place) return;
    updatePlace(placeId, { spots: place.spots.filter((s) => s.id !== spotId) });
  };

  const descriptionPreview = (scenario.description ?? '').trim();

  return (
    <div className={cn('border rounded-lg bg-card', expanded && 'border-emerald-500/40')}>
      {/* Collapsed header */}
      <div
        className="flex items-center gap-2 p-3 cursor-pointer hover:bg-muted/40 transition-colors select-none"
        onClick={onToggleExpand}
      >
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
        <MapPin className="w-4 h-4 text-emerald-500 shrink-0" />
        <span className="font-medium text-sm truncate">
          {scenario.name || 'Escenario sin nombre'}
        </span>
        <Badge variant="outline" className="text-[10px] shrink-0">
          {scenario.places.length} lugar{scenario.places.length !== 1 ? 'es' : ''}
        </Badge>
        {!expanded && descriptionPreview && (
          <span className="text-xs text-muted-foreground truncate hidden sm:inline">
            — {descriptionPreview.slice(0, 60)}
            {descriptionPreview.length > 60 ? '...' : ''}
          </span>
        )}
        <div
          className="ml-auto flex items-center gap-2 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {scenario.enabled ? 'Activo' : 'Inactivo'}
          </span>
          <Switch
            checked={scenario.enabled}
            onCheckedChange={(enabled) => patch({ enabled })}
          />
        </div>
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div className="px-4 pb-4 pt-3 border-t space-y-4">
          {/* Basic fields */}
          <div className="space-y-2.5">
            <div>
              <Label className="text-xs">Nombre del escenario *</Label>
              <Input
                value={scenario.name}
                onChange={(e) => patch({ name: e.target.value })}
                placeholder="Ej: Departamento, Bar, Oficina..."
                className="h-8"
              />
            </div>
            <div>
              <Label className="text-xs">Descripción</Label>
              <Textarea
                value={scenario.description ?? ''}
                onChange={(e) => patch({ description: e.target.value })}
                placeholder="Describe el escenario en general (se muestra cuando el LLM considera moverse aquí)..."
                className="min-h-[60px] text-sm"
              />
            </div>
            <div className="flex items-center justify-between p-2 rounded-md border bg-muted/20">
              <span className="text-xs font-medium">Escenario activo</span>
              <Switch checked={scenario.enabled} onCheckedChange={(enabled) => patch({ enabled })} />
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Fondo predeterminado</Label>
              <BackgroundPicker
                value={scenario.defaultBackgroundUrl}
                onChange={(url) => patch({ defaultBackgroundUrl: url })}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Se usa cuando el lugar o punto de interés actual no define un fondo propio.
              </p>
            </div>
          </div>

          {/* Places */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">
                Lugares <span className="text-muted-foreground font-normal">({scenario.places.length})</span>
              </Label>
              <Button type="button" size="sm" variant="outline" onClick={addPlace}>
                <Plus className="w-3.5 h-3.5 mr-1" />
                Agregar lugar
              </Button>
            </div>

            {scenario.places.length === 0 && (
              <div className="text-center py-6 text-xs text-muted-foreground border border-dashed rounded-lg">
                <MapPin className="w-6 h-6 mx-auto mb-1.5 opacity-30" />
                <p>Sin lugares. Agrega al menos uno (Ej: Cuarto, Cocina).</p>
              </div>
            )}

            {scenario.places.map((place) => (
              <PlaceEditor
                key={place.id}
                place={place}
                isDefault={scenario.defaultPlaceId === place.id}
                scenarioDefaultBg={scenario.defaultBackgroundUrl}
                onUpdate={(updates) => updatePlace(place.id, updates)}
                onDelete={() => deletePlace(place.id)}
                onSetDefault={() => setDefaultPlace(place.id)}
                onAddSpot={() => addSpot(place.id)}
                onUpdateSpot={(spotId, updates) => updateSpot(place.id, spotId, updates)}
                onDeleteSpot={(spotId) => deleteSpot(place.id, spotId)}
              />
            ))}

            <p className="text-[10px] text-muted-foreground">
              La estrella ★ marca el lugar predeterminado: la escena entra ahí al cambiar a este escenario
              (salvo que se elija otro lugar concreto).
              La POSICIÓN y ESCALA del sprite se guarda LIGADA AL FONDO: muévelo en el chat, abre
              «Escenarios de la escena» (botón 📍 del header) o el engranaje del sprite y pulsa
              «Guardar pose en el fondo actual». El badge ✛ indica cuántos personajes tienen pose
              guardada para el fondo de ese lugar/punto; el sprite volverá a esa posición cada vez
              que ese fondo se muestre.
            </p>
          </div>

          {/* Delete scenario */}
          <div className="flex justify-end pt-1 border-t">
            <Button variant="destructive" size="sm" className="mt-3" onClick={onDelete}>
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              Eliminar escenario
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// Main panel
// ============================================

export function ScenarioLibraryPanel() {
  const scenarios = useTavernStore((s) => s.scenarios);
  const addScenario = useTavernStore((s) => s.addScenario);
  const removeScenario = useTavernStore((s) => s.removeScenario);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleCreate = () => {
    const now = new Date().toISOString();
    const scenario: ScenarioDefinition = {
      id: genId(),
      name: 'Nuevo escenario',
      enabled: true,
      places: [],
      defaultPlaceId: null,
      createdAt: now,
      updatedAt: now,
    };
    addScenario(scenario);
    setExpandedId(scenario.id);
    toast.success('Escenario creado');
  };

  const handleDelete = (scenario: ScenarioDefinition) => {
    if (
      !window.confirm(
        `¿Eliminar el escenario "${scenario.name || 'sin nombre'}"? Los personajes y grupos que lo tengan asignado dejarán de usarlo.`
      )
    ) {
      return;
    }
    removeScenario(scenario.id);
    setExpandedId((current) => (current === scenario.id ? null : current));
    toast.success(`Escenario "${scenario.name}" eliminado`);
  };

  return (
    <div className="max-w-3xl mx-auto h-full flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 shrink-0">
        <div className="flex items-start gap-3 min-w-0">
          <div className="p-2 bg-emerald-500/15 rounded-lg shrink-0">
            <MapPin className="w-5 h-5 text-emerald-500" />
          </div>
          <div className="min-w-0">
            <h3 className="font-medium text-sm">Escenarios</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Biblioteca global con jerarquía Escenario → Lugar → Punto de interés. Asigna escenarios a
              personajes o grupos y el LLM podrá mover la escena con la herramienta{' '}
              <code className="bg-muted px-1 rounded">manage_escenario</code>.
            </p>
          </div>
        </div>
        <Button size="sm" onClick={handleCreate} className="shrink-0">
          <Plus className="w-4 h-4 mr-1" />
          Nuevo Escenario
        </Button>
      </div>

      {/* List */}
      {scenarios.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center justify-center text-center border border-dashed rounded-lg p-10 max-w-lg">
            <MapPin className="w-10 h-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-medium">Aún no hay escenarios</p>
            <p className="text-xs text-muted-foreground mt-1">
              Crea tu primer escenario (por ejemplo &quot;Departamento&quot;), agrega lugares como
              &quot;Cuarto&quot; o &quot;Cocina&quot; y asígnalo a un personaje desde su editor
              (pestaña Escenario). El LLM podrá mover la escena entre sus lugares con la
              herramienta manage_escenario.
            </p>
            <Button size="sm" className="mt-4" onClick={handleCreate}>
              <Plus className="w-4 h-4 mr-1" />
              Crear el primer escenario
            </Button>
          </div>
        </div>
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-3 pb-4 pr-1">
            {scenarios.map((scenario) => (
              <ScenarioCard
                key={scenario.id}
                scenario={scenario}
                expanded={expandedId === scenario.id}
                onToggleExpand={() =>
                  setExpandedId((current) => (current === scenario.id ? null : scenario.id))
                }
                onDelete={() => handleDelete(scenario)}
              />
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

export default ScenarioLibraryPanel;
