'use client';

// ============================================
// Scenario Editor — ESCENARIO V2
// ============================================
// Editor for the character's scenario (locations).
// Each location has: name + description (free text).
// One location can be flagged as default (scene starts there).
//
// The {{escenario}} key resolves to the ACTIVE location's description,
// read from the session state (activeScenarioId — session-level).
// The manage_escenario tool lets the character decide where the scene is:
// list / go / get_info.

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  MapPin,
  Plus,
  Trash2,
  HelpCircle,
  Copy,
  Star,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { normalizeScenarioConfig } from '@/lib/scenario';
import type { ScenarioConfig, ScenarioLocation } from '@/types';

interface ScenarioEditorProps {
  config: ScenarioConfig | undefined;
  onChange: (config: ScenarioConfig | undefined) => void;
}

export function ScenarioEditor({ config, onChange }: ScenarioEditorProps) {
  // Normalize the incoming config: guards against malformed shapes
  // (missing `locations` array, invalid items) coming from stale
  // localStorage / imported data. Without this the editor could crash
  // with "Cannot read properties of undefined (reading 'length')".
  const scenarioConfig: ScenarioConfig = normalizeScenarioConfig(config) || {
    enabled: false,
    locations: [],
  };

  const updateConfig = (updates: Partial<ScenarioConfig>) => {
    onChange({ ...scenarioConfig, ...updates });
  };

  const addLocation = () => {
    const isFirst = scenarioConfig.locations.length === 0;
    const newLocation: ScenarioLocation = {
      id: `location-${Date.now()}`,
      name: '',
      description: '',
      // The first location automatically becomes the default one
      isDefault: isFirst || !scenarioConfig.locations.some(l => l.isDefault),
    };
    updateConfig({ locations: [...scenarioConfig.locations, newLocation] });
  };

  const updateLocation = (index: number, updates: Partial<ScenarioLocation>) => {
    const newLocations = [...scenarioConfig.locations];
    newLocations[index] = { ...newLocations[index], ...updates };
    updateConfig({ locations: newLocations });
  };

  const deleteLocation = (index: number) => {
    const removed = scenarioConfig.locations[index];
    const remaining = scenarioConfig.locations.filter((_, i) => i !== index);
    // If the removed location was the default, promote the first remaining one
    if (removed?.isDefault && remaining.length > 0 && !remaining.some(l => l.isDefault)) {
      remaining[0] = { ...remaining[0], isDefault: true };
    }
    updateConfig({ locations: remaining });
  };

  const duplicateLocation = (index: number) => {
    const source = scenarioConfig.locations[index];
    const clone: ScenarioLocation = {
      ...source,
      id: `location-${Date.now()}`,
      name: `${source.name || 'Ubicación'} (copia)`,
      isDefault: false,
    };
    const newLocations = [...scenarioConfig.locations];
    newLocations.splice(index + 1, 0, clone);
    updateConfig({ locations: newLocations });
  };

  const setDefault = (index: number) => {
    const newLocations = scenarioConfig.locations.map((l, i) => ({
      ...l,
      isDefault: i === index,
    }));
    updateConfig({ locations: newLocations });
  };

  const hasLocations = scenarioConfig.locations.length > 0;
  const hasDefault = scenarioConfig.locations.some(l => l.isDefault);

  return (
    <div className="space-y-4">
      {/* Header with enable switch */}
      <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-emerald-500" />
          <span className="font-medium text-sm">Escenario</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="max-w-sm">
              <p className="font-medium">¿Qué es el escenario?</p>
              <p className="text-xs text-muted-foreground mt-1">
                Crea varias ubicaciones para la escena (cama, sofá, escritorio, departamento...)
                con nombre y descripción. El personaje decide dónde estáis usando la
                herramienta <code>manage_escenario</code>. La ubicación actual se inyecta
                vía la key <code>{'{escenario}'}</code> y queda guardada en la sesión.
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
        <Switch
          checked={scenarioConfig.enabled}
          onCheckedChange={(enabled) => updateConfig({ enabled })}
        />
      </div>

      {/* Warnings */}
      {scenarioConfig.enabled && !hasLocations && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-xs">
          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-500">El escenario está vacío</p>
            <p className="text-muted-foreground mt-0.5">
              Agrega al menos una ubicación para que el personaje pueda usarla.
            </p>
          </div>
        </div>
      )}
      {scenarioConfig.enabled && hasLocations && !hasDefault && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-xs">
          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-500">Sin ubicación predeterminada</p>
            <p className="text-muted-foreground mt-0.5">
              Marca una ubicación con la estrella ⭐: será donde empiece la escena al iniciar
              la sesión (si el saludo no fija otra). (Si no hay, se usa la primera de la lista).
            </p>
          </div>
        </div>
      )}

      {/* Block header setting */}
      {scenarioConfig.enabled && (
        <div className="flex items-center gap-3 p-2 rounded-md border text-xs">
          <Label className="text-xs shrink-0">Header del bloque</Label>
          <Input
            value={scenarioConfig.blockHeader || ''}
            onChange={(e) => updateConfig({ blockHeader: e.target.value })}
            placeholder="[ESCENARIO]"
            className="h-7 text-xs font-mono flex-1"
          />
          <span className="text-muted-foreground/70 shrink-0">default: [ESCENARIO]</span>
        </div>
      )}

      {/* Locations */}
      {scenarioConfig.enabled && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">
              Ubicaciones <span className="text-muted-foreground font-normal">({scenarioConfig.locations.length})</span>
            </Label>
            <Button size="sm" variant="outline" onClick={addLocation}>
              <Plus className="w-3.5 h-3.5 mr-1" />
              Agregar ubicación
            </Button>
          </div>

          {!hasLocations && (
            <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-lg">
              <MapPin className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>No hay ubicaciones en el escenario.</p>
              <p className="text-xs mt-1">Agrega ubicaciones con nombre y descripción para la escena.</p>
            </div>
          )}

          {scenarioConfig.locations.map((location, index) => (
            <ScenarioLocationEditor
              key={location.id}
              location={location}
              index={index}
              total={scenarioConfig.locations.length}
              onChange={(updates) => updateLocation(index, updates)}
              onDelete={() => deleteLocation(index)}
              onDuplicate={() => duplicateLocation(index)}
              onSetDefault={() => setDefault(index)}
            />
          ))}

          {/* Help text */}
          {hasLocations && (
            <div className="text-xs text-muted-foreground/70 p-2 rounded-md bg-muted/20">
              <p className="font-medium mb-1">Cómo funciona:</p>
              <ul className="space-y-0.5 list-disc list-inside">
                <li>Cada ubicación tiene <strong>nombre</strong> y <strong>descripción</strong> (libre).</li>
                <li>La ubicación con ⭐ es la <strong>predeterminada</strong>: la escena empieza ahí (salvo que el saludo fije otra).</li>
                <li>El personaje mueve la escena con la herramienta <code>manage_escenario</code> (list / go / get_info).</li>
                <li>La ubicación actual se guarda en la <strong>sesión</strong> y se inyecta con la key <code>{'{escenario}'}</code>.</li>
                <li>Coloca <code>{'{escenario}'}</code> en cualquier sección de la card (characterNote, description, scenario...).</li>
                <li>En la pestaña <strong>Diálogo</strong> puedes fijar la ubicación estándar de cada Primer Mensaje / Saludo Alternativo.</li>
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// Single Scenario Location Editor
// ============================================

interface ScenarioLocationEditorProps {
  location: ScenarioLocation;
  index: number;
  total: number;
  onChange: (updates: Partial<ScenarioLocation>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onSetDefault: () => void;
}

function ScenarioLocationEditor({
  location,
  index,
  total,
  onChange,
  onDelete,
  onDuplicate,
  onSetDefault,
}: ScenarioLocationEditorProps) {
  const [expanded, setExpanded] = useState(total <= 1);

  const namePlaceholder = `Ubicación #${index + 1}`;

  return (
    <div className={cn(
      'border rounded-lg bg-muted/30',
      location.isDefault && 'border-emerald-500/40 bg-emerald-500/5'
    )}>
      {/* Header */}
      <div
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 min-w-0">
          {location.isDefault ? (
            <Star className="w-4 h-4 text-emerald-500 fill-emerald-500 shrink-0" />
          ) : (
            <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
          <span className="font-medium text-sm truncate">
            {location.name || namePlaceholder}
          </span>
          {location.isDefault && (
            <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-500 shrink-0">
              Predeterminado
            </Badge>
          )}
          {!expanded && location.description && (
            <span className="text-xs text-muted-foreground truncate hidden sm:inline">
              — {location.description.slice(0, 60)}{location.description.length > 60 ? '...' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-7 w-7', location.isDefault && 'text-emerald-500')}
                onClick={(e) => { e.stopPropagation(); onSetDefault(); }}
                disabled={location.isDefault}
              >
                <Star className={cn('w-3.5 h-3.5', location.isDefault && 'fill-emerald-500')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="text-xs">
              Establecer como predeterminado
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
              >
                <Copy className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="text-xs">Duplicar</TooltipContent>
          </Tooltip>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            <Trash2 className="w-3.5 h-3.5 text-destructive" />
          </Button>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t">
          <div className="pt-3">
            <Label className="text-xs">Nombre de la ubicación *</Label>
            <Input
              value={location.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="Ej: Cama, Sofá, Escritorio, Departamento..."
              className="h-8"
            />
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Label className="text-xs">Descripción *</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="w-3 h-3 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>Describe la ubicación con detalle. Este texto se inyecta en el prompt mientras la escena esté aquí.</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Ej: Un departamento pequeño en el quinto piso, con ventanas grandes, un sofá gris y luz cálida.
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Textarea
              value={location.description}
              onChange={(e) => onChange({ description: e.target.value })}
              placeholder="Ej: Un departamento pequeño en el quinto piso, con ventanas grandes, un sofá gris, un escritorio junto a la ventana y luz cálida."
              className="min-h-[80px] text-sm"
            />
          </div>
        </div>
      )}
    </div>
  );
}
