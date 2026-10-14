'use client';

/**
 * UbicacionRewardEditor — shared editor for the 'ubicacion' reward type
 * (ESCENARIO V3).
 *
 * Two cascading selects over the App-level scenario library
 * (Ajustes → Escenarios):
 *   1. Escenario (colección ScenarioDefinition)
 *   2. Ubicación — ANY of the 3 levels: the scenario itself (its own fondo),
 *      a Lugar (place) or a Punto de interés (spot).
 *
 * Used by: StatsEditor (acciones "Recompensas por Activación" + umbrales de
 * atributos) and the quest RewardEditor. When the reward fires, the shared
 * session scene moves (collection + location), the location's background is
 * applied and the character sprite re-positions using the pose saved for that
 * background × character.
 */

import { Fragment } from 'react';
import { useTavernStore } from '@/store/tavern-store';
import type { QuestReward } from '@/types';
import { describeScenarioLocationId } from '@/lib/scenario/library';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MapPin } from 'lucide-react';

interface UbicacionRewardEditorProps {
  /** Reward (already normalized to type 'ubicacion') */
  reward: QuestReward;
  onChange: (reward: QuestReward) => void;
  /** Compact paddings for tight sections (skill rewards) */
  compact?: boolean;
}

export function UbicacionRewardEditor({ reward, onChange, compact }: UbicacionRewardEditorProps) {
  const scenarios = useTavernStore((s) => s.scenarios) || [];
  const cfg = reward.ubicacion;

  const selectedDef = (() => {
    if (cfg?.collectionId) {
      return scenarios.find(d => d.id === cfg.collectionId) || null;
    }
    // No explicit collection (e.g. legacy reward): infer it from locationId
    if (cfg?.locationId) {
      return scenarios.find(d => {
        if (d.id === cfg.locationId) return true;
        return d.places.some(
          p => p.id === cfg.locationId || p.spots.some(s => s.id === cfg.locationId)
        );
      }) || null;
    }
    return null;
  })();

  const updateUbicacion = (updates: Partial<NonNullable<QuestReward['ubicacion']>>) => {
    onChange({
      ...reward,
      type: 'ubicacion',
      ubicacion: {
        locationId: '',
        ...cfg,
        ...updates,
      },
    });
  };

  if (scenarios.length === 0) {
    return (
      <p className="text-[10px] text-muted-foreground flex items-center gap-1">
        <MapPin className="w-3 h-3 text-emerald-400" />
        No hay escenarios en la biblioteca — créalos en <strong className="mx-0.5">Ajustes → Escenarios</strong> y asígnalos al personaje.
      </p>
    );
  }

  const heightClass = compact ? 'h-6' : 'h-7';

  return (
    <div className="space-y-1.5">
      <div className={compact ? 'grid grid-cols-2 gap-1.5' : 'grid grid-cols-2 gap-2'}>
        {/* 1) Escenario (colección) */}
        <div className="space-y-0.5">
          <Label className="text-[10px] text-muted-foreground">Escenario</Label>
          <Select
            value={selectedDef?.id || ''}
            onValueChange={(v) => {
              const def = scenarios.find(d => d.id === v);
              // Default destination = the scenario itself (its own fondo)
              updateUbicacion({ collectionId: v, locationId: v, locationLabel: def?.name });
            }}
          >
            <SelectTrigger className={`bg-background ${heightClass} text-xs`}>
              <SelectValue placeholder="Seleccionar escenario..." />
            </SelectTrigger>
            <SelectContent>
              {scenarios.map(d => (
                <SelectItem key={d.id} value={d.id}>
                  <span className="text-xs">🏛️ {d.name}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 2) Ubicación: escenario / lugar / punto de interés */}
        <div className="space-y-0.5">
          <Label className="text-[10px] text-muted-foreground">Ubicación (3 niveles)</Label>
          <Select
            value={cfg?.locationId || ''}
            disabled={!selectedDef}
            onValueChange={(v) => {
              const label = selectedDef ? describeScenarioLocationId([selectedDef], v) : undefined;
              updateUbicacion({ locationId: v, locationLabel: label });
            }}
          >
            <SelectTrigger className={`bg-background ${heightClass} text-xs`}>
              <SelectValue placeholder={selectedDef ? 'Seleccionar ubicación...' : 'Elige escenario...'} />
            </SelectTrigger>
            <SelectContent>
              {selectedDef && (
                <>
                  <SelectItem value={selectedDef.id}>
                    <span className="text-xs">🏛️ {selectedDef.name} — Escenario completo</span>
                  </SelectItem>
                  {selectedDef.places.map(p => (
                    <Fragment key={p.id}>
                      <SelectItem value={p.id}>
                        <span className="text-xs">📍 {p.name}</span>
                      </SelectItem>
                      {p.spots.map(s => (
                        <SelectItem key={s.id} value={s.id}>
                          <span className="text-xs text-muted-foreground pl-4">↳ {s.name}</span>
                        </SelectItem>
                      ))}
                    </Fragment>
                  ))}
                </>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        📍 Al activarse, la escena se mueve a esa ubicación: cambia el fondo y el sprite del personaje se
        recoloca con la pose guardada para ese fondo. Un reward sin ubicación concreta usa el fondo del escenario.
      </p>
    </div>
  );
}
