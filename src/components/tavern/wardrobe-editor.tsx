'use client';

// ============================================
// Wardrobe Editor — FASE 12
// ============================================
// Simple editor for the character's wardrobe levels.
// Each level has: threshold (main attribute value), name, content.
// Levels are sorted by threshold ascending at runtime.
//
// The {{wardrobe}} key resolves to the current level's content.
// The manage_wardrobe tool can shift the level ±1.

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
  ChevronUp,
  ChevronDown,
  Crown,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WardrobeConfig, WardrobeLevel, AttributeDefinition, CharacterCard } from '@/types';

interface WardrobeEditorProps {
  config: WardrobeConfig | undefined;
  onChange: (config: WardrobeConfig | undefined) => void;
  /** The character's attributes (to show which is the main one) */
  attributes: AttributeDefinition[];
}

export function WardrobeEditor({ config, onChange, attributes }: WardrobeEditorProps) {
  const mainAttr = attributes.find(a => a.isMain === true);

  // Initialize config if undefined
  const wardrobeConfig: WardrobeConfig = config || {
    enabled: false,
    levels: [],
  };

  const updateConfig = (updates: Partial<WardrobeConfig>) => {
    onChange({ ...wardrobeConfig, ...updates });
  };

  const addLevel = () => {
    const newLevel: WardrobeLevel = {
      id: `wardrobe-${Date.now()}`,
      name: '',
      threshold: 0,
      content: '',
    };
    updateConfig({ levels: [...wardrobeConfig.levels, newLevel] });
  };

  const updateLevel = (index: number, updates: Partial<WardrobeLevel>) => {
    const newLevels = [...wardrobeConfig.levels];
    newLevels[index] = { ...newLevels[index], ...updates };
    updateConfig({ levels: newLevels });
  };

  const deleteLevel = (index: number) => {
    updateConfig({ levels: wardrobeConfig.levels.filter((_, i) => i !== index) });
  };

  const moveLevel = (index: number, direction: 'up' | 'down') => {
    const newLevels = [...wardrobeConfig.levels];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newLevels.length) return;
    [newLevels[index], newLevels[targetIndex]] = [newLevels[targetIndex], newLevels[index]];
    updateConfig({ levels: newLevels });
  };

  // Check if wardrobe is available (needs main attribute + at least 2 levels)
  const hasMainAttr = !!mainAttr;
  const hasEnoughLevels = wardrobeConfig.levels.length >= 2;
  const isAvailable = hasMainAttr && hasEnoughLevels;

  return (
    <div className="space-y-4">
      {/* Header with enable switch */}
      <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
        <div className="flex items-center gap-2">
          <Shirt className="w-4 h-4 text-amber-500" />
          <span className="font-medium text-sm">Sistema de Vestuario</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="max-w-sm">
              <p className="font-medium">¿Qué es el vestuario?</p>
              <p className="text-xs text-muted-foreground mt-1">
                Sistema de ropa que cambia según el atributo principal del personaje.
                Se inyecta vía la key <code>{'{{wardrobe}}'}</code> en el prompt.
                La herramienta <code>manage_wardrobe</code> permite al LLM escalar o regresar el nivel.
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
      {!hasMainAttr && wardrobeConfig.enabled && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-xs">
          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-500">No hay atributo principal</p>
            <p className="text-muted-foreground mt-0.5">
              El vestuario requiere un atributo marcado como principal (👑). Ve a la pestaña Stats y marca uno con la corona.
            </p>
          </div>
        </div>
      )}
      {hasMainAttr && !hasEnoughLevels && wardrobeConfig.enabled && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-xs">
          <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-amber-500">Se necesitan al menos 2 niveles</p>
            <p className="text-muted-foreground mt-0.5">
              El vestuario necesita mínimo 2 niveles para que la herramienta pueda escalar/regresar.
            </p>
          </div>
        </div>
      )}

      {/* Main attribute info */}
      {hasMainAttr && (
        <div className="flex items-center gap-2 p-2 rounded-md border border-amber-500/20 bg-amber-500/5 text-xs">
          <Crown className="w-3 h-3 text-amber-500" />
          <span className="text-muted-foreground">Atributo principal:</span>
          <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-500">
            {mainAttr.name} ({'{{' + mainAttr.key + '}}'})
          </Badge>
          <span className="text-muted-foreground/70">min: {mainAttr.min ?? 0}, max: {mainAttr.max ?? 100}</span>
        </div>
      )}

      {/* Levels */}
      {wardrobeConfig.enabled && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Niveles de Vestuario</Label>
            <Button size="sm" variant="outline" onClick={addLevel}>
              <Plus className="w-3.5 h-3.5 mr-1" />
              Añadir Nivel
            </Button>
          </div>

          {wardrobeConfig.levels.length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-lg">
              <Shirt className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>No hay niveles de vestuario.</p>
              <p className="text-xs mt-1">Añade niveles para definir el vestuario del personaje.</p>
            </div>
          )}

          {/* Levels list — sorted by threshold ascending (shown in display order) */}
          {[...wardrobeConfig.levels]
            .map((level, originalIndex) => ({ level, originalIndex }))
            .sort((a, b) => a.level.threshold - b.level.threshold)
            .map(({ level, originalIndex }, sortedPosition) => (
              <WardrobeLevelEditor
                key={level.id}
                level={level}
                index={originalIndex}
                position={sortedPosition}
                total={wardrobeConfig.levels.length}
                mainAttrKey={mainAttr?.key}
                onChange={(updates) => updateLevel(originalIndex, updates)}
                onDelete={() => deleteLevel(originalIndex)}
                onMoveUp={() => moveLevel(originalIndex, 'up')}
                onMoveDown={() => moveLevel(originalIndex, 'down')}
              />
            ))}

          {/* Help text */}
          {wardrobeConfig.levels.length > 0 && (
            <div className="text-xs text-muted-foreground/70 p-2 rounded-md bg-muted/20">
              <p className="font-medium mb-1">Cómo funciona:</p>
              <ul className="space-y-0.5 list-disc list-inside">
                <li>Los niveles se ordenan por <strong>umbral</strong> (threshold) de menor a mayor.</li>
                <li>El nivel base es el de mayor umbral que sea <strong>≤</strong> al valor actual del atributo principal.</li>
                <li>La key <code>{'{{wardrobe}}'}</code> se reemplaza por el contenido del nivel actual.</li>
                <li>La herramienta <code>manage_wardrobe</code> puede subir/bajar un nivel (persiste entre turnos).</li>
                <li>Coloca <code>{'{{wardrobe}}'}</code> donde quieras que aparezca (description, characterNote, scenario, etc.).</li>
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// Single Wardrobe Level Editor
// ============================================

interface WardrobeLevelEditorProps {
  level: WardrobeLevel;
  index: number;
  position: number;
  total: number;
  mainAttrKey?: string;
  onChange: (updates: Partial<WardrobeLevel>) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function WardrobeLevelEditor({
  level,
  index,
  position,
  total,
  mainAttrKey,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
}: WardrobeLevelEditorProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-lg bg-muted/30">
      {/* Header */}
      <div
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono w-6">#{position + 1}</span>
          <span className="font-medium text-sm">
            {level.name || `Nivel #${position + 1}`}
          </span>
          <Badge variant="outline" className="text-xs border-blue-500/30 text-blue-500">
            ≥ {level.threshold}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
            disabled={position === 0}
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
            disabled={position === total - 1}
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </Button>
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
          <div className="pt-3 grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Nombre del nivel *</Label>
              <Input
                value={level.name}
                onChange={(e) => onChange({ name: e.target.value })}
                placeholder="Ej: Ropa casual, Ropa interior, Desnuda..."
                className="h-8"
              />
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <Label className="text-xs">Umbral (atributo principal)</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-3 h-3 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p>El valor del atributo principal a partir del cual este nivel se vuelve activo.</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Ej: si el atributo es "Lujuria" y pones umbral 50, este nivel se activa cuando Lujuria ≥ 50.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <Input
                type="number"
                value={level.threshold}
                onChange={(e) => onChange({ threshold: parseFloat(e.target.value) || 0 })}
                placeholder="0"
                className="h-8"
              />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Label className="text-xs">Contenido a inyectar *</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="w-3 h-3 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p>El texto que se inyectará cuando este nivel esté activo.</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Describe el vestuario actual del personaje. Se inyecta vía <code>{'{{wardrobe}}'}</code>.
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Textarea
              value={level.content}
              onChange={(e) => onChange({ content: e.target.value })}
              placeholder="Ej: Lleva una blusa transparente que deja ver su sujetador de encaje negro, una falda corta que apenas cubre sus caderas, y tacones altos."
              className="min-h-[80px] text-sm"
            />
          </div>
        </div>
      )}
    </div>
  );
}
