'use client';

// ============================================
// Wardrobe Editor — GUARDARROPA V2
// ============================================
// Editor for the character's wardrobe (outfits).
// Each outfit has: name + description (free text).
// One outfit can be flagged as default (worn at session start).
//
// The {{vestuario}} key resolves to the WORN outfit's description,
// read from the session state (activeOutfitId).
// The manage_wardrobe tool lets the character decide what to wear:
// list / wear / remove / get_info.

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
  Shirt,
  Plus,
  Trash2,
  HelpCircle,
  Copy,
  Star,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { normalizeWardrobeConfig } from '@/lib/wardrobe';
import type { WardrobeConfig, WardrobeOutfit } from '@/types';

interface WardrobeEditorProps {
  config: WardrobeConfig | undefined;
  onChange: (config: WardrobeConfig | undefined) => void;
}

export function WardrobeEditor({ config, onChange }: WardrobeEditorProps) {
  // Normalize the incoming config: guards against legacy formats
  // ({enabled, levels}), missing `outfits` arrays, or malformed outfit
  // items coming from stale localStorage / imported cards. Without this
  // the editor crashed with "Cannot read properties of undefined
  // (reading 'length')" when opening the Guardarropa tab.
  const wardrobeConfig: WardrobeConfig = normalizeWardrobeConfig(config) || {
    enabled: false,
    outfits: [],
  };

  const updateConfig = (updates: Partial<WardrobeConfig>) => {
    onChange({ ...wardrobeConfig, ...updates });
  };

  const addOutfit = () => {
    const isFirst = wardrobeConfig.outfits.length === 0;
    const newOutfit: WardrobeOutfit = {
      id: `outfit-${Date.now()}`,
      name: '',
      description: '',
      // The first outfit automatically becomes the default one
      isDefault: isFirst || !wardrobeConfig.outfits.some(o => o.isDefault),
    };
    updateConfig({ outfits: [...wardrobeConfig.outfits, newOutfit] });
  };

  const updateOutfit = (index: number, updates: Partial<WardrobeOutfit>) => {
    const newOutfits = [...wardrobeConfig.outfits];
    newOutfits[index] = { ...newOutfits[index], ...updates };
    updateConfig({ outfits: newOutfits });
  };

  const deleteOutfit = (index: number) => {
    const removed = wardrobeConfig.outfits[index];
    const remaining = wardrobeConfig.outfits.filter((_, i) => i !== index);
    // If the removed outfit was the default, promote the first remaining one
    if (removed?.isDefault && remaining.length > 0 && !remaining.some(o => o.isDefault)) {
      remaining[0] = { ...remaining[0], isDefault: true };
    }
    updateConfig({ outfits: remaining });
  };

  const duplicateOutfit = (index: number) => {
    const source = wardrobeConfig.outfits[index];
    const clone: WardrobeOutfit = {
      ...source,
      id: `outfit-${Date.now()}`,
      name: `${source.name || 'Outfit'} (copia)`,
      isDefault: false,
    };
    const newOutfits = [...wardrobeConfig.outfits];
    newOutfits.splice(index + 1, 0, clone);
    updateConfig({ outfits: newOutfits });
  };

  const setDefault = (index: number) => {
    const newOutfits = wardrobeConfig.outfits.map((o, i) => ({
      ...o,
      isDefault: i === index,
    }));
    updateConfig({ outfits: newOutfits });
  };

  const hasOutfits = wardrobeConfig.outfits.length > 0;
  const hasDefault = wardrobeConfig.outfits.some(o => o.isDefault);

  return (
    <div className="space-y-4">
      {/* Header with enable switch */}
      <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
        <div className="flex items-center gap-2">
          <Shirt className="w-4 h-4 text-amber-500" />
          <span className="font-medium text-sm">Guardarropa</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="max-w-sm">
              <p className="font-medium">¿Qué es el guardarropa?</p>
              <p className="text-xs text-muted-foreground mt-1">
                Crea varios vestuarios (outfits) con nombre y descripción. El personaje elige
                cuál ponerse según la escena usando la herramienta <code>manage_wardrobe</code>.
                Lo que lleva puesto se inyecta vía la key <code>{'{vestuario}'}</code> y queda
                guardado en la sesión.
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
        <Switch
          checked={wardrobeConfig.enabled}
          onCheckedChange={(enabled) => updateConfig({ enabled })}
        />
      </div>

      {/* Warnings */}
      {wardrobeConfig.enabled && !hasOutfits && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-xs">
          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-500">El guardarropa está vacío</p>
            <p className="text-muted-foreground mt-0.5">
              Agrega al menos un vestuario (outfit) para que el personaje pueda usarlo.
            </p>
          </div>
        </div>
      )}
      {wardrobeConfig.enabled && hasOutfits && !hasDefault && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-xs">
          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-500">Sin outfit predeterminado</p>
            <p className="text-muted-foreground mt-0.5">
              Marca un outfit con la estrella ⭐: será el que el personaje lleve puesto al iniciar la sesión
              y al quitarse la ropa. (Si no hay, se usa el primero de la lista).
            </p>
          </div>
        </div>
      )}

      {/* Block header setting */}
      {wardrobeConfig.enabled && (
        <div className="flex items-center gap-3 p-2 rounded-md border text-xs">
          <Label className="text-xs shrink-0">Header del bloque</Label>
          <Input
            value={wardrobeConfig.blockHeader || ''}
            onChange={(e) => updateConfig({ blockHeader: e.target.value })}
            placeholder="[VESTUARIO]"
            className="h-7 text-xs font-mono flex-1"
          />
          <span className="text-muted-foreground/70 shrink-0">default: [VESTUARIO]</span>
        </div>
      )}

      {/* Outfits */}
      {wardrobeConfig.enabled && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">
              Vestuarios <span className="text-muted-foreground font-normal">({wardrobeConfig.outfits.length})</span>
            </Label>
            <Button size="sm" variant="outline" onClick={addOutfit}>
              <Plus className="w-3.5 h-3.5 mr-1" />
              Agregar vestuario
            </Button>
          </div>

          {!hasOutfits && (
            <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-lg">
              <Shirt className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>No hay vestuarios en el guardarropa.</p>
              <p className="text-xs mt-1">Agrega vestuarios con nombre y descripción para el personaje.</p>
            </div>
          )}

          {wardrobeConfig.outfits.map((outfit, index) => (
            <WardrobeOutfitEditor
              key={outfit.id}
              outfit={outfit}
              index={index}
              total={wardrobeConfig.outfits.length}
              onChange={(updates) => updateOutfit(index, updates)}
              onDelete={() => deleteOutfit(index)}
              onDuplicate={() => duplicateOutfit(index)}
              onSetDefault={() => setDefault(index)}
            />
          ))}

          {/* Help text */}
          {hasOutfits && (
            <div className="text-xs text-muted-foreground/70 p-2 rounded-md bg-muted/20">
              <p className="font-medium mb-1">Cómo funciona:</p>
              <ul className="space-y-0.5 list-disc list-inside">
                <li>Cada vestuario tiene <strong>nombre</strong> y <strong>descripción</strong> (libre).</li>
                <li>El outfit con ⭐ es el <strong>predeterminado</strong>: se usa al iniciar la sesión y al quitarse la ropa.</li>
                <li>El personaje decide qué ponerse con la herramienta <code>manage_wardrobe</code> (list / wear / remove / get_info).</li>
                <li>La ropa puesta se guarda en la <strong>sesión</strong> y se inyecta con la key <code>{'{vestuario}'}</code>.</li>
                <li>Coloca <code>{'{vestuario}'}</code> en cualquier sección de la card (characterNote, description, scenario...).</li>
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// Single Wardrobe Outfit Editor
// ============================================

interface WardrobeOutfitEditorProps {
  outfit: WardrobeOutfit;
  index: number;
  total: number;
  onChange: (updates: Partial<WardrobeOutfit>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onSetDefault: () => void;
}

function WardrobeOutfitEditor({
  outfit,
  index,
  total,
  onChange,
  onDelete,
  onDuplicate,
  onSetDefault,
}: WardrobeOutfitEditorProps) {
  const [expanded, setExpanded] = useState(total <= 1);

  const namePlaceholder = `Vestuario #${index + 1}`;

  return (
    <div className={cn(
      'border rounded-lg bg-muted/30',
      outfit.isDefault && 'border-amber-500/40 bg-amber-500/5'
    )}>
      {/* Header */}
      <div
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 min-w-0">
          {outfit.isDefault ? (
            <Star className="w-4 h-4 text-amber-500 fill-amber-500 shrink-0" />
          ) : (
            <Shirt className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
          <span className="font-medium text-sm truncate">
            {outfit.name || namePlaceholder}
          </span>
          {outfit.isDefault && (
            <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-500 shrink-0">
              Predeterminado
            </Badge>
          )}
          {!expanded && outfit.description && (
            <span className="text-xs text-muted-foreground truncate hidden sm:inline">
              — {outfit.description.slice(0, 60)}{outfit.description.length > 60 ? '...' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-7 w-7', outfit.isDefault && 'text-amber-500')}
                onClick={(e) => { e.stopPropagation(); onSetDefault(); }}
                disabled={outfit.isDefault}
              >
                <Star className={cn('w-3.5 h-3.5', outfit.isDefault && 'fill-amber-500')} />
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
            <Label className="text-xs">Nombre del vestuario *</Label>
            <Input
              value={outfit.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="Ej: Vestido de gala, Pijama, Ropa vieja..."
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
                  <p>Describe el outfit con detalle. Este texto se inyecta en el prompt mientras el personaje lo lleve puesto.</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Ej: Vestido negro de satén, con un collar de plata y zapatillas altas color rojo.
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Textarea
              value={outfit.description}
              onChange={(e) => onChange({ description: e.target.value })}
              placeholder="Ej: Vestido negro de satén, con un collar de plata, zapatillas altas color rojo y un bolso pequeño de mano."
              className="min-h-[80px] text-sm"
            />
          </div>
        </div>
      )}
    </div>
  );
}
