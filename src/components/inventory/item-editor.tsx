'use client';

import { useState, useMemo, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type {
  Item,
  ItemRarity,
  InventoryItemType,
} from '@/types';
import {
  getRarityColor,
  createConsumableItem,
  createEquipmentItem,
} from '@/store/slices/inventorySlice';

// ============================================
// Constants
// ============================================

const RARITIES: ItemRarity[] = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
  'unique',
  'cursed',
];

const RARITY_LABELS: Record<ItemRarity, string> = {
  common: 'Común',
  uncommon: 'Poco común',
  rare: 'Raro',
  epic: 'Épico',
  legendary: 'Legendario',
  unique: 'Único',
  cursed: 'Maldito',
};

const ITEM_TYPES: { value: InventoryItemType; label: string }[] = [
  { value: 'consumable', label: 'Consumible' },
  { value: 'equipment', label: 'Equipo' },
];

// Common emojis for the emoji picker
const COMMON_EMOJIS = [
  '⚔️', '🛡️', '🧪', '📜', '🗡️', '🏹', '💎', '🔥', '❄️', '⚡',
  '💊', '🧲', '🎯', '🎪', '🪄', '🧬', '💰', '🗝️', '🛡️', '👑',
  '🧥', '🥾', '🧤', '💍', '📿', '🎸', '🔮', '🍷', '🍖', '🍞',
];

// ============================================
// Get initial state from item
// ============================================

interface EditorState {
  name: string;
  description: string;
  type: InventoryItemType;
  rarity: ItemRarity;
  icon: string;
  price: string;
  duration: string;
  slot: string; // Slot ID (references EquipmentSlotDefinition.id or legacy ItemSlot)
  stackable: boolean;
  maxStack: string;
  triggerKeywords: string;
  contextKeys: string;
  tags: string;
}

function getInitialState(item: Item | null | undefined): EditorState {
  return {
    name: item?.name ?? '',
    description: item?.description ?? '',
    type: item?.type ?? 'consumable',
    rarity: item?.rarity ?? 'common',
    icon: item?.icon ?? (item?.type === 'equipment' ? '⚔️' : '🧪'),
    price: item?.price?.toString() ?? '',
    duration: item?.duration?.toString() ?? '1',
    slot: item?.slot ?? 'main_hand',
    stackable: item?.stackable ?? (item?.type === 'consumable'),
    maxStack: item?.maxStack?.toString() ?? (item?.type === 'consumable' ? '99' : '1'),
    triggerKeywords: item?.triggerKeywords?.join(', ') ?? '',
    contextKeys: item?.contextKeys?.join(', ') ?? '',
    tags: item?.tags?.join(', ') ?? '',
  };
}

// ============================================
// Item Editor Component
// ============================================

interface ItemEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: Item | null;
  onSave: (item: Item) => void;
  onDelete?: () => void;
}

export function ItemEditor({ open, onOpenChange, item, onSave, onDelete }: ItemEditorProps) {
  const initialState = useMemo(() => getInitialState(item), [item]);
  const [state, setState] = useState<EditorState>(initialState);

  // Handle dialog open/close changes from user interactions
  const handleOpenChange = useCallback((isOpen: boolean) => {
    onOpenChange(isOpen);
  }, [onOpenChange]);

  const update = <K extends keyof EditorState>(key: K, value: EditorState[K]) => {
    setState(prev => ({ ...prev, [key]: value }));
  };

  const handleTypeChange = (newType: InventoryItemType) => {
    setState(prev => ({
      ...prev,
      type: newType,
      icon: newType === 'consumable' ? '🧪' : '⚔️',
      stackable: newType === 'consumable',
      maxStack: newType === 'consumable' ? '99' : '1',
      duration: newType === 'consumable' ? '1' : '',
    }));
  };

  // Save handler - use factory functions
  const handleSave = () => {
    if (!state.name.trim()) return;

    const triggerKeywordsList = state.triggerKeywords.trim()
      ? state.triggerKeywords.split(',').map(k => k.trim()).filter(Boolean)
      : undefined;

    const contextKeysList = state.contextKeys.trim()
      ? state.contextKeys.split(',').map(k => k.trim()).filter(Boolean)
      : undefined;

    const tagsList = state.tags.trim()
      ? state.tags.split(',').map(t => t.trim()).filter(Boolean)
      : undefined;

    const price = state.price ? parseInt(state.price) : undefined;

    if (state.type === 'consumable') {
      const newItem = createConsumableItem(state.name.trim(), {
        description: state.description.trim(),
        rarity: state.rarity,
        icon: state.icon || undefined,
        duration: parseInt(state.duration) || 1,
        price,
        triggerKeywords: triggerKeywordsList,
        contextKeys: contextKeysList,
        tags: tagsList,
        stackable: state.stackable,
        maxStack: parseInt(state.maxStack) || 99,
      });
      // If editing, preserve the id, timestamps and legacy fields no longer
      // editable in this UI (effects/messages) so they are not wiped on save
      if (item) {
        onSave({
          ...newItem,
          attributeEffects: item.attributeEffects,
          slotEffects: item.slotEffects,
          consumableEffect: item.consumableEffect,
          useMessage: item.useMessage,
          expireMessage: item.expireMessage,
          id: item.id,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        });
      } else {
        onSave(newItem);
      }
    } else {
      const newItem = createEquipmentItem(state.name.trim(), {
        description: state.description.trim(),
        rarity: state.rarity,
        icon: state.icon || undefined,
        slot: state.slot || undefined,
        price,
        triggerKeywords: triggerKeywordsList,
        contextKeys: contextKeysList,
        tags: tagsList,
      });
      if (item) {
        onSave({
          ...newItem,
          attributeEffects: item.attributeEffects,
          slotEffects: item.slotEffects,
          consumableEffect: item.consumableEffect,
          useMessage: item.useMessage,
          expireMessage: item.expireMessage,
          unequipMessage: item.unequipMessage,
          id: item.id,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        });
      } else {
        onSave(newItem);
      }
    }

    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {item ? 'Editar Item' : 'Crear Nuevo Item'}
          </DialogTitle>
          <DialogDescription>
            Define las propiedades del item para el sistema de inventario.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="basic" className="w-full flex-1 flex flex-col overflow-hidden">
          <TabsList className="grid grid-cols-2 w-full shrink-0">
            <TabsTrigger value="basic">Básico</TabsTrigger>
            <TabsTrigger value="config">Config</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto mt-4">
            {/* ===== Basic Tab ===== */}
            <TabsContent value="basic" className="space-y-4 mt-0">
              {/* Name */}
              <div className="space-y-2">
                <Label htmlFor="item-name">Nombre *</Label>
                <Input
                  id="item-name"
                  value={state.name}
                  onChange={(e) => update('name', e.target.value)}
                  placeholder="Espada del Destino"
                />
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="item-description">Descripción</Label>
                <Textarea
                  id="item-description"
                  value={state.description}
                  onChange={(e) => update('description', e.target.value)}
                  placeholder="Una espada legendaria forjada en los fuegos del monte destino..."
                  rows={3}
                />
              </div>

              {/* Type & Rarity */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select value={state.type} onValueChange={(v) => handleTypeChange(v as InventoryItemType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ITEM_TYPES.map(t => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.value === 'consumable' ? '🧪' : '⚔️'} {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Rareza</Label>
                  <Select value={state.rarity} onValueChange={(v) => update('rarity', v as ItemRarity)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RARITIES.map(r => (
                        <SelectItem key={r} value={r}>
                          <span className={getRarityColor(r)}>{RARITY_LABELS[r]}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Icon & Price */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Icono (emoji)</Label>
                  <div className="flex gap-2 items-center">
                    <Input
                      value={state.icon}
                      onChange={(e) => update('icon', e.target.value)}
                      placeholder="⚔️"
                      className="w-16 text-center text-xl"
                      maxLength={4}
                    />
                    <div className="flex flex-wrap gap-1">
                      {COMMON_EMOJIS.slice(0, 8).map(emoji => (
                        <Button
                          key={emoji}
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-base"
                          onClick={() => update('icon', emoji)}
                        >
                          {emoji}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="item-price">Precio (tienda)</Label>
                  <Input
                    id="item-price"
                    type="number"
                    value={state.price}
                    onChange={(e) => update('price', e.target.value)}
                    placeholder="0 = no vendible"
                    min="0"
                  />
                </div>
              </div>
            </TabsContent>

            {/* ===== Config Tab ===== */}
            <TabsContent value="config" className="space-y-4 mt-0">
              {state.type === 'consumable' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="duration">Duración (turnos)</Label>
                    <p className="text-xs text-muted-foreground">
                      Cuántos turnos dura el efecto del consumible
                    </p>
                    <Input
                      id="duration"
                      type="number"
                      value={state.duration}
                      onChange={(e) => update('duration', e.target.value)}
                      min="1"
                      className="w-32"
                    />
                  </div>

                  <Separator />

                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={state.stackable}
                        onCheckedChange={(v) => update('stackable', v)}
                      />
                      <Label>Apilable</Label>
                    </div>

                    {state.stackable && (
                      <div className="flex items-center gap-2 ml-6">
                        <Label className="text-muted-foreground text-sm">Máximo:</Label>
                        <Input
                          type="number"
                          value={state.maxStack}
                          onChange={(e) => update('maxStack', e.target.value)}
                          className="w-20"
                          min="1"
                        />
                      </div>
                    )}
                  </div>
                </>
              )}

              <Separator />

              {/* Trigger Keywords */}
              <div className="space-y-2">
                <Label>Keywords de Trigger</Label>
                <p className="text-xs text-muted-foreground">
                  Palabras clave que detectan este item en los mensajes (separadas por coma)
                </p>
                <Input
                  value={state.triggerKeywords}
                  onChange={(e) => update('triggerKeywords', e.target.value)}
                  placeholder="espada del destino, legendary sword"
                />
              </div>

              <div className="space-y-2">
                <Label>Keywords de Contexto</Label>
                <p className="text-xs text-muted-foreground">
                  Keywords adicionales que TAMBIÉN deben estar presentes (separadas por coma)
                </p>
                <Input
                  value={state.contextKeys}
                  onChange={(e) => update('contextKeys', e.target.value)}
                  placeholder="encuentras, obtienes"
                />
              </div>

              <div className="space-y-2">
                <Label>Tags</Label>
                <p className="text-xs text-muted-foreground">
                  Tags para organización y búsqueda (separados por coma)
                </p>
                <Input
                  value={state.tags}
                  onChange={(e) => update('tags', e.target.value)}
                  placeholder="arma, legendario, fuego"
                />
              </div>
            </TabsContent>
          </div>
        </Tabs>

        <DialogFooter className="gap-2 mt-auto pt-4 border-t shrink-0">
          {item && onDelete && (
            <Button variant="destructive" onClick={onDelete}>
              Eliminar
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={!state.name.trim()}>
            {item ? 'Guardar' : 'Crear'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ItemEditor;
