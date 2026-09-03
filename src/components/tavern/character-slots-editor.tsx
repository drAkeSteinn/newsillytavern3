'use client';

// ============================================
// Character Slots Editor (FASE 20 — Slot Item Rules)
// ============================================
// Per-character/persona equipment slots with lorebook-style item rules.
//
// Each slot keeps its basic identity (name / key / icon) and now defines a
// LIST OF ITEMS (from the inventory). Each item rule:
//   1. Picks an attribute of the slot OWNER to evaluate
//   2. Comparison mode: Static (once) or Dynamic (every turn)
//   3. Conditions (priority + comparator + value) — like attribute lorebooks
//      - activation message  → sent to chat as user message on equip/use
//      - end message         → sent to chat as user message on unequip/expire
//      - effects             → attribute changes or sprite changes, each with
//                              an optional fallback for deactivation
//
// The old slot effects system (attributeEffects/effectText/effectMode) was
// removed from this UI; legacy data is preserved untouched.

import { useMemo, useState } from 'react';
import { useTavernStore } from '@/store/tavern-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Plus,
  Trash2,
  HelpCircle,
  ChevronDown,
  ChevronRight,
  Shield,
  Zap,
  Image as ImageIcon,
  Package,
  RotateCcw,
  MessageSquare,
  MessageSquareOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  COMPARATOR_LABELS,
  NUMERIC_COMPARATORS,
  TEXT_COMPARATORS,
} from '@/lib/attributes/condition-evaluator';
import {
  createDefaultSlotItemRule,
  createDefaultSlotItemCondition,
  createDefaultAttributeEffect,
  createDefaultSpriteEffect,
  getCharacterSprites,
} from '@/lib/inventory/slot-item-rules';
import type {
  AttributeComparator,
  AttributeDefinition,
  AttributeType,
  CharacterSlotDefinition,
  CostOperator,
  EquipmentSlotDefinition,
  Item,
  SlotAttributeEffect,
  SlotConditionEffect,
  SlotItemCondition,
  SlotItemRule,
  SlotSpriteEffect,
} from '@/types';

// ============================================
// Main Component
// ============================================

interface CharacterSlotsEditorProps {
  equipmentSlots?: EquipmentSlotDefinition[];
  slotDefinitions?: CharacterSlotDefinition[];
  /** Attributes of the slot OWNER (character or persona being edited). */
  attributes: AttributeDefinition[];
  onChange: (updates: { equipmentSlots?: EquipmentSlotDefinition[]; slotDefinitions?: CharacterSlotDefinition[] }) => void;
}

export function CharacterSlotsEditor({
  equipmentSlots,
  slotDefinitions,
  attributes,
  onChange,
}: CharacterSlotsEditorProps) {
  const slots = equipmentSlots || [];
  const defs = slotDefinitions || [];
  const [expandedSlot, setExpandedSlot] = useState<string | null>(null);

  // Inventory items + characters (for rule targets & sprites)
  const items = useTavernStore((s) => s.items);
  const characters = useTavernStore((s) => s.characters);

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
    setExpandedSlot(newSlot.id);
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
    if (expandedSlot === slotId) setExpandedSlot(null);
  };

  const getDef = (slotId: string): CharacterSlotDefinition => {
    return defs.find(d => d.slotId === slotId) || { slotId, itemRules: [] };
  };

  const updateDef = (slotId: string, updates: Partial<CharacterSlotDefinition>) => {
    const existing = defs.find(d => d.slotId === slotId);
    if (existing) {
      updateDefs(defs.map(d => d.slotId === slotId ? { ...d, ...updates } : d));
    } else {
      updateDefs([...defs, { slotId, itemRules: [], ...updates }]);
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
              <p>Slots personalizados para este personaje o persona. Cada slot define su lista de items con condiciones estilo lorebook.</p>
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
          <p>No hay slots definidos.</p>
          <p className="text-xs mt-1">Añade un slot para configurar items con condiciones.</p>
        </div>
      )}

      {/* Slots list */}
      {slots.map((slot, index) => {
        const def = getDef(slot.id);
        const rules = def.itemRules || [];
        const isExpanded = expandedSlot === slot.id;
        return (
          <div key={slot.id} className="border rounded-lg bg-muted/30">
            {/* Slot header */}
            <div
              className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => setExpandedSlot(isExpanded ? null : slot.id)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-lg shrink-0">{slot.icon || '📦'}</span>
                <span className="font-medium text-sm truncate">{slot.name}</span>
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground shrink-0 hidden sm:inline">
                  {'{{' + slot.key + '}}'}
                </code>
                {rules.length > 0 && (
                  <Badge variant="outline" className="text-[10px] border-violet-500/30 text-violet-500 shrink-0">
                    {rules.length} {rules.length === 1 ? 'item' : 'items'}
                  </Badge>
                )}
                {rules.some(r => r.comparisonMode === 'dynamic') && (
                  <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-500 shrink-0">
                    Por turno
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={(e) => { e.stopPropagation(); deleteSlot(index); }}
                >
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </Button>
                {isExpanded
                  ? <ChevronDown className="w-4 h-4" />
                  : <ChevronRight className="w-4 h-4" />}
              </div>
            </div>

            {/* Expanded content */}
            {isExpanded && (
              <div className="px-4 pb-4 space-y-4 border-t">
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

                {/* Item rules */}
                <ItemRulesSection
                  slotId={slot.id}
                  rules={rules}
                  items={items}
                  characters={characters}
                  ownerAttributes={attributes}
                  onRulesChange={(itemRules) => updateDef(slot.id, { itemRules })}
                />
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
            <p className="font-medium text-blue-500">¿Cómo funcionan los items del slot?</p>
            <ul className="mt-1 space-y-0.5 list-disc list-inside">
              <li>Agrega items del inventario y define condiciones sobre un atributo del dueño del slot</li>
              <li>Estático: se evalúa una vez al equipar/usar · Dinámico: se re-evalúa cada turno</li>
              <li>Las condiciones que coinciden aplican sus efectos y envían su mensaje de activación al chat</li>
              <li>El mensaje de finalización se envía al desequipar (o al expirar un consumible)</li>
              <li>Los efectos pueden modificar atributos o cambiar sprites de personajes</li>
              <li>El fallback revierte atributos/sprites a un estado deseado al desactivar</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// Item Rules Section
// ============================================

interface ItemRulesSectionProps {
  slotId: string;
  rules: SlotItemRule[];
  items: Item[];
  characters: Array<{
    id: string;
    name: string;
    statsConfig?: { attributes?: AttributeDefinition[] };
    spritePacksV2?: Array<{ id: string; name: string; sprites: Array<{ id: string; label: string; url: string }> }>;
  }>;
  ownerAttributes: AttributeDefinition[];
  onRulesChange: (rules: SlotItemRule[]) => void;
}

function ItemRulesSection({ rules, items, characters, ownerAttributes, onRulesChange }: ItemRulesSectionProps) {
  const [selectedItemId, setSelectedItemId] = useState<string>('');

  const availableItems = useMemo(
    () => items.filter(it => !rules.some(r => r.itemId === it.id)),
    [items, rules]
  );

  const updateRule = (itemId: string, updates: Partial<SlotItemRule>) => {
    onRulesChange(rules.map(r => r.itemId === itemId ? { ...r, ...updates } : r));
  };

  const removeRule = (itemId: string) => {
    onRulesChange(rules.filter(r => r.itemId !== itemId));
  };

  const addRule = () => {
    const item = items.find(it => it.id === selectedItemId);
    if (!item) return;
    if (rules.some(r => r.itemId === item.id)) return;
    const newRule = createDefaultSlotItemRule(item.id, item.name, ownerAttributes);
    onRulesChange([...rules, newRule]);
    setSelectedItemId('');
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Package className="w-3.5 h-3.5 text-violet-500" />
          <Label className="text-xs font-medium">Lista de items</Label>
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="w-3 h-3 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p>Items del inventario con condiciones estilo lorebook. Al equipar (o usar si es consumible) se evalúa el atributo y aplican las condiciones que coinciden.</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Add item selector */}
      <div className="flex gap-2">
        <Select value={selectedItemId || '__none__'} onValueChange={setSelectedItemId}>
          <SelectTrigger className="h-8 text-xs flex-1">
            <SelectValue placeholder="Seleccionar item del inventario..." />
          </SelectTrigger>
          <SelectContent>
            {availableItems.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground italic">
                No hay items disponibles
              </div>
            )}
            {availableItems.map(item => (
              <SelectItem key={item.id} value={item.id} className="text-xs">
                {item.icon ? `${item.icon} ` : ''}{item.name}
                <Badge variant="outline" className="ml-1.5 text-[8px] px-1 h-3">
                  {item.type === 'consumable' ? 'consumible' : 'equipo'}
                </Badge>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={!selectedItemId}
          onClick={addRule}
        >
          <Plus className="w-3 h-3 mr-1" />
          Agregar
        </Button>
      </div>

      {/* Rules list */}
      {rules.length === 0 && (
        <p className="text-[10px] text-muted-foreground italic pl-1">
          Sin items. Agrega uno del inventario para configurar sus condiciones.
        </p>
      )}
      {rules.map(rule => {
        const item = items.find(it => it.id === rule.itemId);
        return (
          <SlotItemRuleEditor
            key={rule.itemId}
            rule={rule}
            item={item}
            characters={characters}
            ownerAttributes={ownerAttributes}
            onUpdate={(updates) => updateRule(rule.itemId, updates)}
            onRemove={() => removeRule(rule.itemId)}
          />
        );
      })}
    </div>
  );
}

// ============================================
// Slot Item Rule Editor
// ============================================

interface SlotItemRuleEditorProps {
  rule: SlotItemRule;
  item?: Item;
  characters: Array<{
    id: string;
    name: string;
    statsConfig?: { attributes?: AttributeDefinition[] };
    spritePacksV2?: Array<{ id: string; name: string; sprites: Array<{ id: string; label: string; url: string }> }>;
  }>;
  ownerAttributes: AttributeDefinition[];
  onUpdate: (updates: Partial<SlotItemRule>) => void;
  onRemove: () => void;
}

function SlotItemRuleEditor({ rule, item, characters, ownerAttributes, onUpdate, onRemove }: SlotItemRuleEditorProps) {
  const [expanded, setExpanded] = useState(true);

  const selectedAttribute = ownerAttributes.find(a => a.key === rule.attributeKey);
  const attrType: AttributeType = (rule.attributeType || selectedAttribute?.type || 'number') as AttributeType;
  const comparators = attrType === 'number' ? NUMERIC_COMPARATORS : TEXT_COMPARATORS;

  const conditions = rule.conditions || [];

  const updateCondition = (condId: string, updates: Partial<SlotItemCondition>) => {
    onUpdate({ conditions: conditions.map(c => c.id === condId ? { ...c, ...updates } : c) });
  };

  const removeCondition = (condId: string) => {
    const remaining = conditions.filter(c => c.id !== condId);
    onUpdate({ conditions: remaining.length > 0 ? remaining : [createDefaultSlotItemCondition()] });
  };

  const addCondition = () => {
    onUpdate({ conditions: [...conditions, createDefaultSlotItemCondition()] });
  };

  const handleAttributeChange = (attrKey: string) => {
    const attr = ownerAttributes.find(a => a.key === attrKey);
    const newType = (attr?.type || 'number') as AttributeType;
    const newComparators = newType === 'number' ? NUMERIC_COMPARATORS : TEXT_COMPARATORS;
    // Fix comparators that don't apply to the new attribute type
    const fixedConditions = conditions.map(c => ({
      ...c,
      comparator: (newComparators.includes(c.comparator as AttributeComparator)
        ? c.comparator
        : newComparators[0]) as AttributeComparator,
    }));
    onUpdate({
      attributeKey: attrKey,
      attributeName: attr?.name,
      attributeType: newType,
      conditions: fixedConditions,
    });
  };

  return (
    <div className="border rounded-lg overflow-hidden bg-background">
      {/* Rule header */}
      <div
        className="flex items-center gap-2 px-2.5 py-2 bg-muted/50 cursor-pointer hover:bg-muted/80 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded
          ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
        <span className="text-sm">{item?.icon || '📦'}</span>
        <span className="text-xs font-medium truncate flex-1">
          {item?.name || rule.itemName || rule.itemId}
        </span>
        {rule.comparisonMode === 'dynamic' && (
          <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-500 shrink-0">
            Dinámico
          </Badge>
        )}
        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 shrink-0">
          {conditions.length} {conditions.length === 1 ? 'cond' : 'conds'}
        </Badge>
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5 text-destructive hover:text-destructive shrink-0"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>

      {/* Rule content */}
      {expanded && (
        <div className="p-2.5 space-y-3">
          {/* Attribute + comparison mode */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Atributo a evaluar (del dueño del slot)</Label>
              <Select
                value={rule.attributeKey || '__none__'}
                onValueChange={(v) => v !== '__none__' && handleAttributeChange(v)}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="Seleccionar..." />
                </SelectTrigger>
                <SelectContent>
                  {ownerAttributes.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground italic">
                      Sin atributos definidos
                    </div>
                  )}
                  {ownerAttributes.map(attr => (
                    <SelectItem key={attr.key} value={attr.key} className="text-xs">
                      {attr.name || attr.key}
                      <Badge variant="outline" className="ml-1 text-[8px] px-0.5 h-3">
                        {attr.type}
                      </Badge>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Modo de comparación</Label>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={rule.comparisonMode === 'static' ? 'default' : 'outline'}
                  className="h-7 text-[10px] flex-1"
                  onClick={() => onUpdate({ comparisonMode: 'static' })}
                >
                  Estático (una vez)
                </Button>
                <Button
                  size="sm"
                  variant={rule.comparisonMode === 'dynamic' ? 'default' : 'outline'}
                  className="h-7 text-[10px] flex-1"
                  onClick={() => onUpdate({ comparisonMode: 'dynamic' })}
                >
                  Dinámico (por turno)
                </Button>
              </div>
            </div>
          </div>

          {/* Resolution mode */}
          <div className="flex items-center gap-2 p-2 border rounded-md bg-muted/20">
            <Label className="text-[10px] whitespace-nowrap">Resolución:</Label>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={(!rule.resolution || rule.resolution === 'concat-all') ? 'default' : 'outline'}
                className="h-6 text-[10px] px-2"
                onClick={() => onUpdate({ resolution: 'concat-all' })}
              >
                Aplicar todas
              </Button>
              <Button
                size="sm"
                variant={rule.resolution === 'first-match' ? 'default' : 'outline'}
                className="h-6 text-[10px] px-2"
                onClick={() => onUpdate({ resolution: 'first-match' })}
              >
                Solo mayor prioridad
              </Button>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="w-3 h-3 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p>Aplicar todas: coinciden varias condiciones y todas aplican (por prioridad).</p>
                <p>Solo mayor prioridad: únicamente gana la condición con mayor prioridad que coincida.</p>
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Conditions */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium">Condiciones</Label>
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[10px]"
                onClick={addCondition}
              >
                <Plus className="w-3 h-3 mr-1" />
                Agregar condición
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground -mt-1">
              Se evalúan contra el valor actual del atributo. Mayor prioridad gana.
            </p>
            {conditions.map((cond, idx) => (
              <SlotConditionEditor
                key={cond.id}
                condition={cond}
                index={idx}
                attrType={attrType}
                comparators={comparators}
                characters={characters}
                ownerAttributes={ownerAttributes}
                onUpdate={(updates) => updateCondition(cond.id, updates)}
                onRemove={() => removeCondition(cond.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// Slot Condition Editor
// ============================================

interface SlotConditionEditorProps {
  condition: SlotItemCondition;
  index: number;
  attrType: AttributeType;
  comparators: AttributeComparator[];
  characters: Array<{
    id: string;
    name: string;
    statsConfig?: { attributes?: AttributeDefinition[] };
    spritePacksV2?: Array<{ id: string; name: string; sprites: Array<{ id: string; label: string; url: string }> }>;
  }>;
  ownerAttributes: AttributeDefinition[];
  onUpdate: (updates: Partial<SlotItemCondition>) => void;
  onRemove: () => void;
}

function SlotConditionEditor({
  condition,
  index,
  attrType,
  comparators,
  characters,
  ownerAttributes,
  onUpdate,
  onRemove,
}: SlotConditionEditorProps) {
  const [expanded, setExpanded] = useState(index === 0);

  const effects = condition.effects || [];

  const updateEffect = (effId: string, updates: Partial<SlotConditionEffect>) => {
    onUpdate({ effects: effects.map(e => e.id === effId ? { ...e, ...updates } as SlotConditionEffect : e) });
  };

  const removeEffect = (effId: string) => {
    onUpdate({ effects: effects.filter(e => e.id !== effId) });
  };

  const addAttributeEffect = () => {
    onUpdate({ effects: [...effects, createDefaultAttributeEffect()] });
  };

  const addSpriteEffect = () => {
    onUpdate({ effects: [...effects, createDefaultSpriteEffect()] });
  };

  const comparatorLabel = COMPARATOR_LABELS[condition.comparator as AttributeComparator] || condition.comparator;

  return (
    <div className="border rounded-md overflow-hidden">
      {/* Condition header */}
      <div
        className="flex items-center gap-2 px-2.5 py-1.5 bg-muted/40 cursor-pointer hover:bg-muted/70 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded
          ? <ChevronDown className="w-3 h-3 text-muted-foreground" />
          : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 shrink-0">
          #{index + 1}
        </Badge>
        <span className="text-[11px] text-muted-foreground truncate flex-1">
          P:{condition.priority ?? 0} · {comparatorLabel} {String(condition.value)}
        </span>
        {effects.length > 0 && (
          <Badge variant="outline" className="text-[9px] border-violet-500/30 text-violet-500 shrink-0">
            {effects.length} efectos
          </Badge>
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5 text-destructive hover:text-destructive shrink-0"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>

      {/* Condition content */}
      {expanded && (
        <div className="p-2.5 space-y-2.5 border-t">
          {/* Priority + comparator + value */}
          <div className="grid grid-cols-[70px_1fr_1fr] gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Prioridad</Label>
              <Input
                type="number"
                value={condition.priority ?? 0}
                onChange={(e) => onUpdate({ priority: parseInt(e.target.value) || 0 })}
                className="h-7 text-xs"
                min={0}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">
                Comparador
                <span className="ml-1 text-muted-foreground">
                  ({attrType === 'number' ? 'numérico' : 'texto'})
                </span>
              </Label>
              <Select
                value={condition.comparator}
                onValueChange={(v) => onUpdate({ comparator: v as AttributeComparator })}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {comparators.map(comp => (
                    <SelectItem key={comp} value={comp} className="text-xs">
                      {COMPARATOR_LABELS[comp]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Valor</Label>
              <Input
                type={attrType === 'number' ? 'number' : 'text'}
                value={String(condition.value)}
                onChange={(e) => {
                  const raw = e.target.value;
                  const num = parseFloat(raw);
                  onUpdate({ value: attrType === 'number' && !isNaN(num) ? num : raw });
                }}
                className="h-7 text-xs"
                placeholder="0"
              />
            </div>
          </div>

          {/* Activation message */}
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <MessageSquare className="w-3 h-3 text-emerald-500" />
              <Label className="text-[10px] font-medium">Mensaje de activación / equipo</Label>
            </div>
            <Textarea
              value={condition.activationMessage || ''}
              onChange={(e) => onUpdate({ activationMessage: e.target.value })}
              placeholder="Se envía al chat como mensaje tuyo al equipar el item o activar el consumible... (ej: *Se pone el collar y siente un escalofrío*)"
              className="min-h-[45px] text-xs"
              rows={2}
            />
          </div>

          {/* End message */}
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <MessageSquareOff className="w-3 h-3 text-rose-500" />
              <Label className="text-[10px] font-medium">Mensaje de finalización / desequipar</Label>
            </div>
            <Textarea
              value={condition.endMessage || ''}
              onChange={(e) => onUpdate({ endMessage: e.target.value })}
              placeholder="Se envía al chat como mensaje tuyo al desequipar o al expirar el efecto... (ej: *Se quita el collar, aliviada*)"
              className="min-h-[45px] text-xs"
              rows={2}
            />
          </div>

          {/* Effects */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] font-medium">Efectos</Label>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px]"
                  onClick={addAttributeEffect}
                >
                  <Zap className="w-2.5 h-2.5 mr-0.5" />
                  Atributo
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px]"
                  onClick={addSpriteEffect}
                >
                  <ImageIcon className="w-2.5 h-2.5 mr-0.5" />
                  Sprite
                </Button>
              </div>
            </div>

            {effects.length === 0 && (
              <p className="text-[10px] text-muted-foreground italic">
                Sin efectos. Agrega uno de atributo (modifica un stat) o de sprite (cambia el sprite de un personaje).
              </p>
            )}

            {effects.map(effect => {
              if (effect.type === 'attribute') {
                return (
                  <AttributeEffectEditor
                    key={effect.id}
                    effect={effect}
                    characters={characters}
                    ownerAttributes={ownerAttributes}
                    onUpdate={(updates) => updateEffect(effect.id, updates)}
                    onRemove={() => removeEffect(effect.id)}
                  />
                );
              }
              return (
                <SpriteEffectEditor
                  key={effect.id}
                  effect={effect}
                  characters={characters}
                  onUpdate={(updates) => updateEffect(effect.id, updates)}
                  onRemove={() => removeEffect(effect.id)}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// Attribute Effect Editor
// ============================================

interface AttributeEffectEditorProps {
  effect: SlotAttributeEffect;
  characters: Array<{
    id: string;
    name: string;
    statsConfig?: { attributes?: AttributeDefinition[] };
  }>;
  ownerAttributes: AttributeDefinition[];
  onUpdate: (updates: Partial<SlotAttributeEffect>) => void;
  onRemove: () => void;
}

const OPERATOR_LABELS: Record<CostOperator, string> = {
  '+': '+ (sumar)',
  '-': '- (restar)',
  '=': '= (fijar)',
  '*': '× (multiplicar)',
  '/': '÷ (dividir)',
  'set_min': 'mín (limitar a)',
  'set_max': 'máx (limitar a)',
};

function AttributeEffectEditor({ effect, characters, ownerAttributes, onUpdate, onRemove }: AttributeEffectEditorProps) {
  // Target attributes: '__self__' & '__user__' → owner attributes; character → its own
  const targetAttributes = useMemo(() => {
    if (effect.targetId === '__self__' || effect.targetId === '__user__') return ownerAttributes;
    const char = characters.find(c => c.id === effect.targetId);
    return char?.statsConfig?.attributes || [];
  }, [effect.targetId, characters, ownerAttributes]);

  const targetAttrType = useMemo(() => {
    const attr = targetAttributes.find(a => a.key === effect.attributeKey);
    return (attr?.type || 'number') as AttributeType;
  }, [targetAttributes, effect.attributeKey]);

  const handleTargetChange = (targetId: string) => {
    const targetName = targetId === '__self__'
      ? 'Dueño del slot'
      : targetId === '__user__'
        ? 'Persona (usuario)'
        : characters.find(c => c.id === targetId)?.name || targetId;
    onUpdate({
      targetId,
      targetName,
      attributeKey: '',
      attributeName: '',
    });
  };

  const handleAttributeKeyChange = (attrKey: string) => {
    const attr = targetAttributes.find(a => a.key === attrKey);
    onUpdate({ attributeKey: attrKey, attributeName: attr?.name });
  };

  return (
    <div className="p-2 border rounded-md bg-muted/10 space-y-2">
      {/* Header */}
      <div className="flex items-center gap-1.5">
        <div className="p-1 rounded bg-violet-500/10">
          <Zap className="w-3 h-3 text-violet-500" />
        </div>
        <span className="text-[10px] font-medium text-violet-600 dark:text-violet-400">Efecto de atributo</span>
        <div className="flex-1" />
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5 text-destructive hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>

      {/* Target + attribute */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Objetivo</Label>
          <Select
            value={effect.targetId || '__none__'}
            onValueChange={(v) => v !== '__none__' && handleTargetChange(v)}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Seleccionar..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__self__" className="text-xs">Dueño del slot</SelectItem>
              <SelectItem value="__user__" className="text-xs">Persona (usuario)</SelectItem>
              {characters.length > 0 && (
                <div className="px-2 py-1 text-[10px] text-muted-foreground font-medium mt-1">Personajes</div>
              )}
              {characters.map(c => (
                <SelectItem key={c.id} value={c.id} className="text-xs">
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Atributo</Label>
          <Select
            value={effect.attributeKey || '__none__'}
            onValueChange={(v) => v !== '__none__' && handleAttributeKeyChange(v)}
            disabled={!effect.targetId}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Seleccionar..." />
            </SelectTrigger>
            <SelectContent>
              {targetAttributes.length === 0 && (
                <div className="px-2 py-1.5 text-[10px] text-muted-foreground italic">
                  Sin atributos definidos
                </div>
              )}
              {targetAttributes.map(attr => (
                <SelectItem key={attr.key} value={attr.key} className="text-xs">
                  {attr.name || attr.key}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Operator + value */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Operador</Label>
          <Select
            value={effect.operator}
            onValueChange={(v) => onUpdate({ operator: v as CostOperator })}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(OPERATOR_LABELS) as CostOperator[]).map(op => (
                <SelectItem key={op} value={op} className="text-xs">
                  {OPERATOR_LABELS[op]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Valor</Label>
          <Input
            type={targetAttrType === 'number' ? 'number' : 'text'}
            value={String(effect.value)}
            onChange={(e) => {
              const raw = e.target.value;
              const num = parseFloat(raw);
              onUpdate({ value: targetAttrType === 'number' && !isNaN(num) ? num : raw });
            }}
            className="h-7 text-xs"
            placeholder="0"
          />
        </div>
      </div>

      {/* Fallback */}
      <div className="p-2 border rounded-md bg-amber-500/5 border-amber-500/20 space-y-2">
        <div className="flex items-center gap-2">
          <RotateCcw className="w-3 h-3 text-amber-500" />
          <label className="flex items-center gap-1.5 text-[10px] cursor-pointer">
            <Switch
              checked={Boolean(effect.fallbackEnabled)}
              onCheckedChange={(checked) => onUpdate({ fallbackEnabled: checked })}
            />
            <span className="font-medium">Fallback</span>
          </label>
          <span className="text-[9px] text-muted-foreground">
            Al desactivar, el atributo regresa a este valor
          </span>
        </div>
        {effect.fallbackEnabled && (
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Valor de retorno</Label>
            <Input
              type={targetAttrType === 'number' ? 'number' : 'text'}
              value={String(effect.fallbackValue ?? '')}
              onChange={(e) => {
                const raw = e.target.value;
                const num = parseFloat(raw);
                onUpdate({ fallbackValue: targetAttrType === 'number' && !isNaN(num) ? num : raw });
              }}
              className="h-7 text-xs"
              placeholder="Valor al que regresa el atributo"
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================
// Sprite Effect Editor
// ============================================

interface SpriteEffectEditorProps {
  effect: SlotSpriteEffect;
  characters: Array<{
    id: string;
    name: string;
    spritePacksV2?: Array<{ id: string; name: string; sprites: Array<{ id: string; label: string; url: string }> }>;
  }>;
  onUpdate: (updates: Partial<SlotSpriteEffect>) => void;
  onRemove: () => void;
}

function SpriteEffectEditor({ effect, characters, onUpdate, onRemove }: SpriteEffectEditorProps) {
  const targetCharacter = characters.find(c => c.id === effect.targetId);
  const sprites = useMemo(
    () => getCharacterSprites(targetCharacter as never),
    [targetCharacter]
  );

  // Only offer fallback sprites other than the main one
  const fallbackSprites = sprites.filter(s => s.spriteId !== effect.spriteId);

  const handleTargetChange = (targetId: string) => {
    const char = characters.find(c => c.id === targetId);
    onUpdate({
      targetId,
      targetName: char?.name || targetId,
      spriteId: '',
      spriteLabel: '',
      fallbackSpriteId: undefined,
      fallbackSpriteLabel: undefined,
    });
  };

  const handleSpriteChange = (spriteId: string) => {
    const sprite = sprites.find(s => s.spriteId === spriteId);
    onUpdate({
      spriteId,
      spriteLabel: sprite?.label || '',
      // Reset fallback if it references the same sprite
      fallbackSpriteId: effect.fallbackSpriteId === spriteId ? undefined : effect.fallbackSpriteId,
    });
  };

  const handleFallbackSpriteChange = (spriteId: string) => {
    const sprite = sprites.find(s => s.spriteId === spriteId);
    onUpdate({ fallbackSpriteId: spriteId, fallbackSpriteLabel: sprite?.label || '' });
  };

  const characterOptions = characters;

  return (
    <div className="p-2 border rounded-md bg-muted/10 space-y-2">
      {/* Header */}
      <div className="flex items-center gap-1.5">
        <div className="p-1 rounded bg-sky-500/10">
          <ImageIcon className="w-3 h-3 text-sky-500" />
        </div>
        <span className="text-[10px] font-medium text-sky-600 dark:text-sky-400">Efecto de sprite</span>
        <div className="flex-1" />
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5 text-destructive hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>

      {/* Character target + sprite */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Personaje</Label>
          <Select
            value={effect.targetId || '__none__'}
            onValueChange={(v) => v !== '__none__' && handleTargetChange(v)}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Seleccionar..." />
            </SelectTrigger>
            <SelectContent>
              {characterOptions.length === 0 && (
                <div className="px-2 py-1.5 text-[10px] text-muted-foreground italic">
                  Sin personajes
                </div>
              )}
              {characterOptions.map(c => {
                const count = getCharacterSprites(c as never).length;
                return (
                  <SelectItem key={c.id} value={c.id} className="text-xs">
                    {c.name}
                    {count > 0 && (
                      <Badge variant="outline" className="ml-1.5 text-[8px] px-0.5 h-3">
                        {count} sprites
                      </Badge>
                    )}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Sprite</Label>
          <Select
            value={effect.spriteId || '__none__'}
            onValueChange={(v) => v !== '__none__' && handleSpriteChange(v)}
            disabled={!effect.targetId}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder={sprites.length === 0 ? 'Sin sprites' : 'Seleccionar...'} />
            </SelectTrigger>
            <SelectContent>
              {sprites.length === 0 && (
                <div className="px-2 py-1.5 text-[10px] text-muted-foreground italic">
                  {effect.targetId ? 'Este personaje no tiene sprites configurados' : 'Selecciona un personaje primero'}
                </div>
              )}
              {sprites.map(sprite => (
                <SelectItem key={sprite.spriteId} value={sprite.spriteId} className="text-xs">
                  {sprite.label}
                  <span className="ml-1 text-[9px] text-muted-foreground">({sprite.packName})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Fallback */}
      <div className="p-2 border rounded-md bg-amber-500/5 border-amber-500/20 space-y-2">
        <div className="flex items-center gap-2">
          <RotateCcw className="w-3 h-3 text-amber-500" />
          <label className="flex items-center gap-1.5 text-[10px] cursor-pointer">
            <Switch
              checked={Boolean(effect.fallbackEnabled)}
              onCheckedChange={(checked) => onUpdate({ fallbackEnabled: checked })}
            />
            <span className="font-medium">Fallback</span>
          </label>
          <span className="text-[9px] text-muted-foreground">
            Al desactivar, el personaje regresa a este sprite (o al normal si no se elige)
          </span>
        </div>
        {effect.fallbackEnabled && (
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Sprite de retorno</Label>
            <Select
              value={effect.fallbackSpriteId || '__none__'}
              onValueChange={(v) => v !== '__none__' ? handleFallbackSpriteChange(v) : onUpdate({ fallbackSpriteId: undefined, fallbackSpriteLabel: undefined })}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue placeholder="Volver al sprite normal" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" className="text-xs">
                  Volver al sprite normal (limpiar)
                </SelectItem>
                {fallbackSprites.map(sprite => (
                  <SelectItem key={sprite.spriteId} value={sprite.spriteId} className="text-xs">
                    {sprite.label}
                    <span className="ml-1 text-[9px] text-muted-foreground">({sprite.packName})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </div>
  );
}
