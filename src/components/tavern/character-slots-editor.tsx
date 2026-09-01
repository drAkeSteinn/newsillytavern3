'use client';

// ============================================
// Character Slots Editor (FASE 19)
// ============================================
// Per-character equipment slots + slot definitions (effects).
// Allows each character/persona to define their own equipment layout
// and what effects equipping items in each slot has.

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Plus,
  Trash2,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Shield,
  Settings2,
  Check,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  EquipmentSlotDefinition,
  CharacterSlotDefinition,
  ItemAttributeEffect,
  AttributeDefinition,
  CostOperator,
} from '@/types';

interface CharacterSlotsEditorProps {
  equipmentSlots?: EquipmentSlotDefinition[];
  slotDefinitions?: CharacterSlotDefinition[];
  attributes: AttributeDefinition[];
  onChange: (updates: { equipmentSlots?: EquipmentSlotDefinition[]; slotDefinitions?: CharacterSlotDefinition[] }) => void;
  /** Available items for restriction selection (optional) */
  availableItems?: Array<{ id: string; name: string; category: string }>;
}

export function CharacterSlotsEditor({
  equipmentSlots,
  slotDefinitions,
  attributes,
  onChange,
  availableItems,
}: CharacterSlotsEditorProps) {
  const slots = equipmentSlots || [];
  const defs = slotDefinitions || [];
  const [expandedSlot, setExpandedSlot] = useState<string | null>(null);

  const updateSlots = (newSlots: EquipmentSlotDefinition[]) => {
    onChange({ equipmentSlots: newSlots });
  };

  const updateDefs = (newDefs: CharacterSlotDefinition[]) => {
    onChange({ slotDefinitions: newDefs });
  };

  const addSlot = () => {
    const newSlot: EquipmentSlotDefinition = {
      id: `slot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: 'Nuevo Slot',
      key: `slot${slots.length + 1}`,
      icon: '📦',
    };
    updateSlots([...slots, newSlot]);
  };

  const updateSlot = (index: number, updates: Partial<EquipmentSlotDefinition>) => {
    const newSlots = [...slots];
    newSlots[index] = { ...newSlots[index], ...updates };
    updateSlots(newSlots);
  };

  const deleteSlot = (index: number) => {
    const slotId = slots[index].id;
    updateSlots(slots.filter((_, i) => i !== index));
    // Also remove any slot definitions for this slot
    updateDefs(defs.filter(d => d.slotId !== slotId));
  };

  const getOrCreateDef = (slotId: string): CharacterSlotDefinition => {
    let def = defs.find(d => d.slotId === slotId);
    if (!def) {
      def = {
        slotId,
        effectMode: 'static',
        effects: [],
        allowedItemCategories: [],
        allowedItemIds: [],
        effectText: '',
      };
    }
    return def;
  };

  const updateDef = (slotId: string, updates: Partial<CharacterSlotDefinition>) => {
    const existing = defs.find(d => d.slotId === slotId);
    if (existing) {
      updateDefs(defs.map(d => d.slotId === slotId ? { ...d, ...updates } : d));
    } else {
      updateDefs([...defs, { ...getOrCreateDef(slotId), ...updates }]);
    }
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-violet-500" />
          <Label className="text-sm font-medium">Slots de Equipamiento</Label>
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="w-3.5 h-3.5 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p>Slots personalizados para este personaje. Cada personaje puede tener su propio layout de equipamiento. Si no defines slots, se usan los globales.</p>
            </TooltipContent>
          </Tooltip>
        </div>
        <Button size="sm" variant="outline" onClick={addSlot}>
          <Plus className="w-3.5 h-3.5 mr-1" />
          Añadir Slot
        </Button>
      </div>

      {slots.length === 0 && (
        <div className="text-center py-6 text-sm text-muted-foreground border border-dashed rounded-lg">
          <Shield className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p>No hay slots personalizados.</p>
          <p className="text-xs mt-1">Se usarán los slots globales por defecto.</p>
        </div>
      )}

      {/* Slots list */}
      {slots.map((slot, index) => {
        const def = getOrCreateDef(slot.id);
        const isExpanded = expandedSlot === slot.id;
        return (
          <div key={slot.id} className="border rounded-lg bg-muted/30">
            {/* Slot header */}
            <div
              className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => setExpandedSlot(isExpanded ? null : slot.id)}
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">{slot.icon || '📦'}</span>
                <span className="font-medium text-sm">{slot.name}</span>
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                  {'{{' + slot.key + '}}'}
                </code>
                {def.effects && def.effects.length > 0 && (
                  <Badge variant="outline" className="text-[10px] border-violet-500/30 text-violet-500">
                    {def.effects.length} efectos
                  </Badge>
                )}
                {def.effectMode === 'dynamic' && (
                  <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-500">
                    Por turno
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={(e) => { e.stopPropagation(); deleteSlot(index); }}
                >
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </Button>
                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </div>
            </div>

            {/* Expanded content */}
            {isExpanded && (
              <div className="px-4 pb-4 space-y-3 border-t">
                {/* Slot basic info */}
                <div className="pt-3 grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs">Nombre</Label>
                    <Input
                      value={slot.name}
                      onChange={(e) => updateSlot(index, { name: e.target.value })}
                      className="h-8"
                      placeholder="Cabeza, Mano..."
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Key (template)</Label>
                    <Input
                      value={slot.key}
                      onChange={(e) => updateSlot(index, { key: e.target.value })}
                      className="h-8"
                      placeholder="cabeza, mano_izq..."
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Icono</Label>
                    <Input
                      value={slot.icon || ''}
                      onChange={(e) => updateSlot(index, { icon: e.target.value })}
                      className="h-8"
                      placeholder="🪖"
                    />
                  </div>
                </div>

                {/* Effect mode */}
                <div className="flex items-center gap-2">
                  <Label className="text-xs whitespace-nowrap">Modo de efecto:</Label>
                  <div className="flex gap-1">
                    <Button
                      variant={def.effectMode === 'static' ? 'default' : 'outline'}
                      size="sm"
                      className="h-6 text-[10px]"
                      onClick={() => updateDef(slot.id, { effectMode: 'static' })}
                    >
                      Estático (una vez)
                    </Button>
                    <Button
                      variant={def.effectMode === 'dynamic' ? 'default' : 'outline'}
                      size="sm"
                      className="h-6 text-[10px]"
                      onClick={() => updateDef(slot.id, { effectMode: 'dynamic' })}
                    >
                      Dinámico (por turno)
                    </Button>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <HelpCircle className="w-3 h-3 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p>Estático: aplica el efecto una vez al equipar.</p>
                      <p>Dinámico: aplica el efecto cada turno mientras esté equipado.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>

                {/* Effect text (for prompt) */}
                <div>
                  <Label className="text-xs">Texto de efecto (para el prompt)</Label>
                  <Textarea
                    value={def.effectText || ''}
                    onChange={(e) => updateDef(slot.id, { effectText: e.target.value })}
                    placeholder="Ej: Cuando lleva equipado el casco, su defensa aumenta. Descripción narrativa del efecto."
                    className="min-h-[50px] text-xs"
                  />
                </div>

                {/* Attribute effects */}
                {attributes.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <Label className="text-xs">Efectos en atributos</Label>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-[10px]"
                        onClick={() => {
                          const newEffect: ItemAttributeEffect = {
                            targetId: '__self__',
                            targetName: 'Self',
                            attributeKey: attributes[0].key,
                            attributeName: attributes[0].name,
                            operator: '+',
                            value: 1,
                            mode: def.effectMode === 'dynamic' ? 'dynamic' : 'static',
                          };
                          updateDef(slot.id, { effects: [...(def.effects || []), newEffect] });
                        }}
                      >
                        <Plus className="w-2.5 h-2.5 mr-0.5" />
                        Añadir efecto
                      </Button>
                    </div>
                    {(def.effects || []).map((eff, effIdx) => (
                      <div key={effIdx} className="flex items-center gap-1.5 p-1.5 rounded-md border bg-background text-xs">
                        {/* Target */}
                        <Select
                          value={eff.targetId}
                          onChange={(e) => {
                            const newEffects = [...(def.effects || [])];
                            newEffects[effIdx] = { ...eff, targetId: e.target.value };
                            updateDef(slot.id, { effects: newEffects });
                          }}
                          className="h-6 text-[10px] w-24"
                        >
                          <option value="__self__">Self</option>
                          <option value="__user__">Usuario</option>
                        </Select>
                        {/* Attribute */}
                        <Select
                          value={eff.attributeKey}
                          onChange={(e) => {
                            const attr = attributes.find(a => a.key === e.target.value);
                            const newEffects = [...(def.effects || [])];
                            newEffects[effIdx] = { ...eff, attributeKey: e.target.value, attributeName: attr?.name || e.target.value };
                            updateDef(slot.id, { effects: newEffects });
                          }}
                          className="h-6 text-[10px] flex-1"
                        >
                          {attributes.map(attr => (
                            <option key={attr.key} value={attr.key}>{attr.name}</option>
                          ))}
                        </Select>
                        {/* Operator */}
                        <Select
                          value={eff.operator}
                          onChange={(e) => {
                            const newEffects = [...(def.effects || [])];
                            newEffects[effIdx] = { ...eff, operator: e.target.value as CostOperator };
                            updateDef(slot.id, { effects: newEffects });
                          }}
                          className="h-6 text-[10px] w-16"
                        >
                          <option value="+">+ (sumar)</option>
                          <option value="-">- (restar)</option>
                          <option value="=">= (fijar)</option>
                          <option value="*">× (mult)</option>
                          <option value="/">÷ (div)</option>
                        </Select>
                        {/* Value */}
                        <Input
                          type="number"
                          value={eff.value as number}
                          onChange={(e) => {
                            const newEffects = [...(def.effects || [])];
                            newEffects[effIdx] = { ...eff, value: parseFloat(e.target.value) || 0 };
                            updateDef(slot.id, { effects: newEffects });
                          }}
                          className="h-6 text-[10px] w-16"
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5"
                          onClick={() => {
                            updateDef(slot.id, { effects: (def.effects || []).filter((_, i) => i !== effIdx) });
                          }}
                        >
                          <Trash2 className="w-3 h-3 text-destructive" />
                        </Button>
                      </div>
                    ))}
                    {(!def.effects || def.effects.length === 0) && (
                      <p className="text-[10px] text-muted-foreground italic pl-1">
                        Sin efectos. Añade uno para modificar atributos al equipar items en este slot.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Help */}
      {slots.length > 0 && (
        <div className="flex items-start gap-2 p-2 rounded-md bg-blue-500/5 border border-blue-500/20 text-xs">
          <HelpCircle className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
          <div className="text-muted-foreground">
            <p className="font-medium text-blue-500">¿Cómo funcionan?</p>
            <ul className="mt-1 space-y-0.5 list-disc list-inside">
              <li>Cada personaje puede tener sus propios slots personalizados</li>
              <li>Los efectos estáticos se aplican una vez al equipar</li>
              <li>Los efectos dinámicos se aplican cada turno mientras esté equipado</li>
              <li>Si no defines slots, se usan los globales (Ajustes → Inventario)</li>
              <li>El texto de efecto se inyecta en el prompt cuando el slot está ocupado</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// Simple Select wrapper (inline to avoid import issues)
function Select({ value, onChange, className, children }: {
  value: string;
  onChange: (e: { target: { value: string } }) => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={onChange}
      className={cn('rounded-md border border-input bg-background px-2 py-1 text-xs', className)}
    >
      {children}
    </select>
  );
}
