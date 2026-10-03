// ============================================
// Quick Replies Panel - Character-specific quick replies
// Each quick reply can optionally modify character attributes
// AND support visibility conditions (requirements with AND/OR logic)
// ============================================

'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  MessageSquare,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Zap,
  Settings2,
  X,
  Check,
  ImageIcon,
  Timer,
  GripVertical,
  Filter,
  Shirt,
  MapPin,
  GitBranch,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type {
  CharacterQuickReply,
  QuickReplyAttributeModifier,
  QuickReplyModifierOperation,
  QuickReplySpriteActivation,
  QuickReplySpriteFallbackMode,
  QuickReplyUmbral,
  QuickReplyWardrobeAction,
  QuickReplyScenarioAction,
  AttributeDefinition,
  CharacterStatsConfig,
  SpritePackV2,
  TriggerCollection,
  StatRequirement,
  RequirementOperator,
  GroupQuickReply,
  WardrobeConfig,
  ScenarioConfig,
} from '@/types';

// ============================================
// Numeric and Text operator options (same as stats-editor)
// ============================================

const NUMERIC_OPERATOR_OPTIONS: { value: RequirementOperator; label: string; description: string }[] = [
  { value: '>=', label: '≥', description: 'Mayor o igual que' },
  { value: '>', label: '>', description: 'Mayor que' },
  { value: '<=', label: '≤', description: 'Menor o igual que' },
  { value: '<', label: '<', description: 'Menor que' },
  { value: '==', label: '=', description: 'Exactamente igual' },
  { value: '!=', label: '≠', description: 'Diferente de' },
  { value: 'between', label: '∈', description: 'Entre (rango)' },
];

const TEXT_OPERATOR_OPTIONS: { value: RequirementOperator; label: string; description: string }[] = [
  { value: '==', label: '=', description: 'Exactamente igual' },
  { value: '!=', label: '≠', description: 'Diferente de' },
  { value: 'contains', label: '⊂', description: 'Contiene' },
  { value: 'not_contains', label: '⊄', description: 'No contiene' },
];

// ============================================
// Requirement Operator Toggle (AND/OR) - same as stats-editor
// ============================================

interface RequirementOperatorToggleProps {
  operator: 'AND' | 'OR' | undefined;
  onChange: (operator: 'AND' | 'OR') => void;
  requirementCount: number;
}

function RequirementOperatorToggle({ operator, onChange, requirementCount }: RequirementOperatorToggleProps) {
  if (requirementCount < 2) return null;

  const currentOperator = operator || 'AND';

  return (
    <div className="flex items-center gap-2 py-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={cn(
            'px-2 py-0.5 text-xs rounded border transition-colors',
            currentOperator === 'AND'
              ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
              : 'bg-muted/30 text-muted-foreground border-transparent'
          )}
          onClick={() => onChange('AND')}
        >
          Y (AND)
        </button>
        <button
          type="button"
          className={cn(
            'px-2 py-0.5 text-xs rounded border transition-colors',
            currentOperator === 'OR'
              ? 'bg-purple-500/20 text-purple-400 border-purple-500/30'
              : 'bg-muted/30 text-muted-foreground border-transparent'
          )}
          onClick={() => onChange('OR')}
        >
          O (OR)
        </button>
      </div>
      <span className="text-[10px] text-muted-foreground">
        {currentOperator === 'AND' ? 'Todas deben cumplirse' : 'Al menos una debe cumplirse'}
      </span>
    </div>
  );
}

// ============================================
// Requirement Editor Component (same pattern as stats-editor)
// ============================================

interface RequirementEditorProps {
  requirement: StatRequirement;
  availableAttributes: AttributeDefinition[];
  availableTargets?: { id: string; name: string; attributes: AttributeDefinition[] }[];
  onChange: (updates: Partial<StatRequirement>) => void;
  onDelete: () => void;
}

function RequirementEditor({ requirement, availableAttributes, availableTargets = [], onChange, onDelete }: RequirementEditorProps) {
  const isTargetMode = requirement.targetCharacterId !== undefined;
  const selectedTarget = isTargetMode && requirement.targetCharacterId
    ? availableTargets.find(t => t.id === requirement.targetCharacterId)
    : undefined;
  const targetAttrs = selectedTarget?.attributes || [];

  // Determine the selected attribute and its type
  const selectedSelfAttr = !isTargetMode ? availableAttributes.find(a => a.key === requirement.attributeKey) : undefined;
  const selectedTargetAttr = isTargetMode ? targetAttrs.find(a => a.key === requirement.attributeKey) : undefined;
  const selectedAttr = selectedSelfAttr || selectedTargetAttr;
  const attrType = selectedAttr?.type || 'number';
  const isTextType = attrType === 'text' || attrType === 'keyword';

  const operatorOptions = isTextType ? TEXT_OPERATOR_OPTIONS : NUMERIC_OPERATOR_OPTIONS;
  const selectedOperator = operatorOptions.find(op => op.value === requirement.operator);

  const hasTargets = availableTargets.length > 0;

  return (
    <div className="flex items-center gap-2 bg-muted/50 rounded p-2 flex-wrap">
      {/* Target/Mode indicator - only show Target option when availableTargets is provided */}
      <Select
        value={isTargetMode ? 'target' : 'self'}
        onValueChange={(value) => {
          if (value === 'target') {
            onChange({ attributeKey: '', targetCharacterId: '', targetAttributeName: '', operator: '==', value: '' });
          } else {
            onChange({ attributeKey: '', targetCharacterId: undefined, targetAttributeName: undefined, operator: '>=', value: 0 });
          }
        }}
      >
        <SelectTrigger className="h-7 w-16 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="self">
            <span className="flex items-center gap-1">🎭 Yo</span>
          </SelectItem>
          {hasTargets && (
            <SelectItem value="target">
              <span className="flex items-center gap-1">🎯 Target</span>
            </SelectItem>
          )}
        </SelectContent>
      </Select>

      {isTargetMode ? (
        <>
          {/* Target selector */}
          <Select
            value={requirement.targetCharacterId || ''}
            onValueChange={(value) => {
              const target = availableTargets.find(t => t.id === value);
              onChange({ targetCharacterId: value, attributeKey: '', targetAttributeName: target?.name || '' });
            }}
          >
            <SelectTrigger className="h-7 w-28 text-xs">
              <SelectValue placeholder="Target..." />
            </SelectTrigger>
            <SelectContent>
              {availableTargets.map(t => (
                <SelectItem key={t.id} value={t.id}>
                  {t.id === '__user__' ? '👤 ' : '🎭 '}{t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Target attribute selector */}
          <Select
            value={requirement.attributeKey}
            onValueChange={(value) => {
              const attr = targetAttrs.find(a => a.key === value);
              const isText = attr?.type === 'text' || attr?.type === 'keyword';
              onChange({
                attributeKey: value,
                targetAttributeName: attr?.name || '',
                operator: isText ? '==' : '>=',
                value: isText ? '' : 0,
              });
            }}
            disabled={!requirement.targetCharacterId}
          >
            <SelectTrigger className="h-7 w-28 text-xs">
              <SelectValue placeholder="Atributo..." />
            </SelectTrigger>
            <SelectContent>
              {targetAttrs.map((attr, i) => (
                <SelectItem key={attr.key || `attr-${i}`} value={attr.key}>
                  <span className="flex items-center gap-1">
                    <span className={attr.type === 'text' || attr.type === 'keyword' ? 'text-blue-400' : 'text-green-400'}>
                      {attr.type === 'text' ? '📝' : attr.type === 'keyword' ? '🏷️' : '🔢'}
                    </span>
                    {attr.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      ) : (
        /* Self attribute selector */
        <Select
          value={requirement.attributeKey}
          onValueChange={(value) => {
            const attr = availableAttributes.find(a => a.key === value);
            const isText = attr?.type === 'text' || attr?.type === 'keyword';
            onChange({
              attributeKey: value,
              operator: isText ? '==' : '>=',
              value: isText ? '' : 0,
            });
          }}
        >
          <SelectTrigger className="h-7 w-24 text-xs">
            <SelectValue placeholder="Atributo" />
          </SelectTrigger>
          <SelectContent>
            {availableAttributes.map(attr => (
              <SelectItem key={attr.id} value={attr.key}>
                <span className="flex items-center gap-1">
                  <span className={attr.type === 'text' || attr.type === 'keyword' ? 'text-blue-400' : 'text-green-400'}>
                    {attr.type === 'text' ? '📝' : attr.type === 'keyword' ? '🏷️' : '🔢'}
                  </span>
                  {attr.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Operator selector with descriptions */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Select
            value={operatorOptions.some(op => op.value === requirement.operator) ? requirement.operator : operatorOptions[0].value}
            onValueChange={(value: RequirementOperator) => onChange({ operator: value })}
          >
            <SelectTrigger className="h-7 w-16 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {operatorOptions.map(op => (
                <SelectItem key={op.value} value={op.value}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono w-4">{op.label}</span>
                    <span className="text-muted-foreground text-xs">{op.description}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="font-medium">{selectedOperator?.description}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {requirement.operator === 'between'
              ? `El valor debe estar entre ${requirement.value} y ${requirement.valueMax || '?'}`
              : `El valor debe ser ${selectedOperator?.description} ${requirement.value}`
            }
          </p>
        </TooltipContent>
      </Tooltip>

      {/* Value input - text or number based on attribute type */}
      {isTextType ? (
        <Input
          type="text"
          value={typeof requirement.value === 'string' ? requirement.value : String(requirement.value)}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder="Texto..."
          className="h-7 w-24 text-xs"
        />
      ) : (
        <Input
          type="number"
          value={requirement.value}
          onChange={(e) => onChange({ value: parseFloat(e.target.value) || 0 })}
          className="h-7 w-16 text-xs"
        />
      )}

      {/* Max value for between operator (only for numeric) */}
      {!isTextType && requirement.operator === 'between' && (
        <>
          <span className="text-xs text-muted-foreground">y</span>
          <Input
            type="number"
            value={requirement.valueMax ?? ''}
            onChange={(e) => {
              const parsed = parseFloat(e.target.value);
              onChange({ valueMax: isNaN(parsed) ? undefined : parsed });
            }}
            placeholder="max"
            className="h-7 w-16 text-xs"
          />
        </>
      )}

      {/* Delete button */}
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDelete}>
        <Trash2 className="w-3 h-3 text-muted-foreground" />
      </Button>
    </div>
  );
}

// ============================================
// Main Quick Replies Panel Component
// ============================================

interface QuickRepliesPanelProps {
  quickReplies: CharacterQuickReply[] | undefined;
  statsConfig: CharacterStatsConfig | undefined;
  /** Available sprite packs for sprite activation */
  spritePacksV2?: SpritePackV2[];
  /** Available trigger collections for sprite activation */
  triggerCollections?: TriggerCollection[];
  /** Character's wardrobe (Guardarropa V2) for the wardrobe-change effect */
  wardrobeConfig?: WardrobeConfig;
  /** Character's scenario (ESCENARIO V2) for the location-change effect */
  scenarioConfig?: ScenarioConfig;
  /** Available target characters for cross-character conditions (group mode) */
  availableTargets?: { id: string; name: string; attributes: AttributeDefinition[] }[];
  onChange: (quickReplies: CharacterQuickReply[]) => void;
}

// Operation labels for display
const OPERATION_LABELS: Record<QuickReplyModifierOperation, { label: string; symbol: string; description: string }> = {
  set: { label: 'Establecer', symbol: '=', description: 'Reemplaza el valor actual' },
  add: { label: 'Sumar', symbol: '+', description: 'Agrega al valor actual' },
  subtract: { label: 'Restar', symbol: '-', description: 'Reduce del valor actual' },
  multiply: { label: 'Multiplicar', symbol: '×', description: 'Multiplica el valor actual' },
  divide: { label: 'Dividir', symbol: '÷', description: 'Divide el valor actual' },
};

function generateId(): string {
  return `qr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export function QuickRepliesPanel({
  quickReplies,
  statsConfig,
  spritePacksV2,
  triggerCollections,
  wardrobeConfig,
  scenarioConfig,
  availableTargets,
  onChange,
}: QuickRepliesPanelProps) {
  const replies = quickReplies || [];
  const attributes = statsConfig?.attributes || [];

  // State for new reply form
  const [newLabel, setNewLabel] = useState('');
  const [newResponse, setNewResponse] = useState('');
  const [newModifiers, setNewModifiers] = useState<QuickReplyAttributeModifier[]>([]);
  const [newRequirements, setNewRequirements] = useState<StatRequirement[]>([]);
  const [newRequirementOperator, setNewRequirementOperator] = useState<'AND' | 'OR'>('AND');

  // State for editing existing reply
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editResponse, setEditResponse] = useState('');
  const [editModifiers, setEditModifiers] = useState<QuickReplyAttributeModifier[]>([]);
  const [editRequirements, setEditRequirements] = useState<StatRequirement[]>([]);
  const [editRequirementOperator, setEditRequirementOperator] = useState<'AND' | 'OR'>('AND');

  // State for expanded modifiers section
  const [expandedModifiers, setExpandedModifiers] = useState<string | null>(null);

  // State for expanded conditions section
  const [expandedConditions, setExpandedConditions] = useState<string | null>(null);

  // State for sprite activation in new reply
  const [newSpriteActivation, setNewSpriteActivation] = useState<QuickReplySpriteActivation | undefined>(undefined);

  // State for sprite activation in editing reply
  const [editSpriteActivation, setEditSpriteActivation] = useState<QuickReplySpriteActivation | undefined>(undefined);

  // Umbral (conditional messages) state for new/editing reply
  const [newUmbrales, setNewUmbrales] = useState<QuickReplyUmbral[]>([]);
  const [editUmbrales, setEditUmbrales] = useState<QuickReplyUmbral[]>([]);

  // Wardrobe action state for new/editing reply
  const [newWardrobeAction, setNewWardrobeAction] = useState<QuickReplyWardrobeAction | undefined>(undefined);
  const [editWardrobeAction, setEditWardrobeAction] = useState<QuickReplyWardrobeAction | undefined>(undefined);

  // Scenario action state for new/editing reply (ESCENARIO V2)
  const [newScenarioAction, setNewScenarioAction] = useState<QuickReplyScenarioAction | undefined>(undefined);
  const [editScenarioAction, setEditScenarioAction] = useState<QuickReplyScenarioAction | undefined>(undefined);

  // State for expanded umbral / wardrobe / scenario sections
  const [expandedUmbral, setExpandedUmbral] = useState<string | null>(null);
  const [expandedWardrobe, setExpandedWardrobe] = useState<string | null>(null);
  const [expandedScenario, setExpandedScenario] = useState<string | null>(null);

  // State for expanded sprite activation section
  const [expandedSpriteActivation, setExpandedSpriteActivation] = useState<string | null>(null);

  // Whether sprite activation is available (has packs or collections)
  const hasSpriteOptions = !!((spritePacksV2 && spritePacksV2.length > 0) || (triggerCollections && triggerCollections.length > 0));

  // Whether the wardrobe effect is available (wardrobe enabled with at least 1 outfit)
  const hasWardrobeOptions = !!(wardrobeConfig?.enabled && wardrobeConfig.outfits && wardrobeConfig.outfits.length > 0);

  // Whether the scenario effect is available (scenario enabled with at least 1 location)
  const hasScenarioOptions = !!(scenarioConfig?.enabled && scenarioConfig.locations && scenarioConfig.locations.length > 0);

  const isAdding = newLabel.trim() && newResponse.trim();

  const handleAdd = () => {
    if (!isAdding) return;
    // Only keep umbrales that can actually fire (conditions + message)
    const validNewUmbrales = newUmbrales.filter(u => u.conditions.length > 0 && u.message.trim());
    // Only keep a wardrobe action that is fully configured
    const validNewWardrobe = newWardrobeAction && (newWardrobeAction.action === 'remove' || newWardrobeAction.outfitId)
      ? newWardrobeAction
      : undefined;
    // Only keep a scenario action that is fully configured (ESCENARIO V2)
    const validNewScenario = newScenarioAction && newScenarioAction.locationId
      ? newScenarioAction
      : undefined;
    const newReply: CharacterQuickReply = {
      id: generateId(),
      label: newLabel.trim(),
      response: newResponse.trim(),
      modifiers: newModifiers.length > 0 ? newModifiers : undefined,
      spriteActivation: newSpriteActivation,
      wardrobeAction: validNewWardrobe,
      scenarioAction: validNewScenario,
      requirements: newRequirements.length > 0 ? newRequirements : undefined,
      requirementOperator: newRequirements.length > 1 ? newRequirementOperator : undefined,
      umbrales: validNewUmbrales.length > 0 ? validNewUmbrales : undefined,
    };
    onChange([...replies, newReply]);
    setNewLabel('');
    setNewResponse('');
    setNewModifiers([]);
    setNewSpriteActivation(undefined);
    setNewWardrobeAction(undefined);
    setNewScenarioAction(undefined);
    setNewRequirements([]);
    setNewRequirementOperator('AND');
    setNewUmbrales([]);
  };

  const handleDelete = (id: string) => {
    onChange(replies.filter((r) => r.id !== id));
  };

  const handleStartEdit = (reply: CharacterQuickReply) => {
    setEditingId(reply.id);
    setEditLabel(reply.label);
    setEditResponse(reply.response);
    setEditModifiers(reply.modifiers ? [...reply.modifiers] : []);
    setEditSpriteActivation(reply.spriteActivation ? { ...reply.spriteActivation } : undefined);
    setEditWardrobeAction(reply.wardrobeAction ? { ...reply.wardrobeAction } : undefined);
    setEditScenarioAction(reply.scenarioAction ? { ...reply.scenarioAction } : undefined);
    setEditRequirements(reply.requirements ? reply.requirements.map(r => ({ ...r })) : []);
    setEditRequirementOperator(reply.requirementOperator || 'AND');
    setEditUmbrales(reply.umbrales ? reply.umbrales.map(u => ({ ...u, conditions: u.conditions.map(c => ({ ...c })) })) : []);
  };

  const handleSaveEdit = () => {
    if (!editingId || !editLabel.trim() || !editResponse.trim()) return;
    const validEditUmbrales = editUmbrales.filter(u => u.conditions.length > 0 && u.message.trim());
    const validEditWardrobe = editWardrobeAction && (editWardrobeAction.action === 'remove' || editWardrobeAction.outfitId)
      ? editWardrobeAction
      : undefined;
    const validEditScenario = editScenarioAction && editScenarioAction.locationId
      ? editScenarioAction
      : undefined;
    onChange(
      replies.map((r) =>
        r.id === editingId
          ? {
              ...r,
              label: editLabel.trim(),
              response: editResponse.trim(),
              modifiers: editModifiers.length > 0 ? editModifiers : undefined,
              spriteActivation: editSpriteActivation,
              wardrobeAction: validEditWardrobe,
              scenarioAction: validEditScenario,
              requirements: editRequirements.length > 0 ? editRequirements : undefined,
              requirementOperator: editRequirements.length > 1 ? editRequirementOperator : undefined,
              umbrales: validEditUmbrales.length > 0 ? validEditUmbrales : undefined,
            }
          : r
      )
    );
    setEditingId(null);
    setEditLabel('');
    setEditResponse('');
    setEditModifiers([]);
    setEditSpriteActivation(undefined);
    setEditWardrobeAction(undefined);
    setEditScenarioAction(undefined);
    setEditRequirements([]);
    setEditRequirementOperator('AND');
    setEditUmbrales([]);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditLabel('');
    setEditResponse('');
    setEditModifiers([]);
    setEditSpriteActivation(undefined);
    setEditWardrobeAction(undefined);
    setEditScenarioAction(undefined);
    setEditRequirements([]);
    setEditRequirementOperator('AND');
    setEditUmbrales([]);
  };

  // Add a modifier to the new reply form
  const addModifierToNew = () => {
    if (attributes.length === 0) return;
    setNewModifiers([
      ...newModifiers,
      { attributeKey: attributes[0].key, operation: 'add', value: 1 },
    ]);
  };

  const updateNewModifier = (index: number, field: keyof QuickReplyAttributeModifier, value: string | number) => {
    const updated = [...newModifiers];
    updated[index] = { ...updated[index], [field]: value };
    setNewModifiers(updated);
  };

  const removeNewModifier = (index: number) => {
    setNewModifiers(newModifiers.filter((_, i) => i !== index));
  };

  // Add a modifier to the editing reply form
  const addModifierToEdit = () => {
    if (attributes.length === 0) return;
    setEditModifiers([
      ...editModifiers,
      { attributeKey: attributes[0].key, operation: 'add', value: 1 },
    ]);
  };

  const updateEditModifier = (index: number, field: keyof QuickReplyAttributeModifier, value: string | number) => {
    const updated = [...editModifiers];
    updated[index] = { ...updated[index], [field]: value };
    setEditModifiers(updated);
  };

  const removeEditModifier = (index: number) => {
    setEditModifiers(editModifiers.filter((_, i) => i !== index));
  };

  // Render modifier row
  const renderModifierRow = (
    modifier: QuickReplyAttributeModifier,
    index: number,
    onUpdate: (index: number, field: keyof QuickReplyAttributeModifier, value: string | number) => void,
    onRemove: (index: number) => void
  ) => {
    const attr = attributes.find((a) => a.key === modifier.attributeKey);
    const isTextAttr = attr?.type === 'text' || attr?.type === 'keyword';
    const availableOps: QuickReplyModifierOperation[] = isTextAttr
      ? ['set']
      : ['set', 'add', 'subtract', 'multiply', 'divide'];

    return (
      <div key={index} className="flex items-center gap-1.5">
        {/* Attribute selector */}
        <Select
          value={modifier.attributeKey}
          onValueChange={(val) => onUpdate(index, 'attributeKey', val)}
        >
          <SelectTrigger className="h-7 text-xs flex-1 min-w-[80px]">
            <SelectValue placeholder="Atributo" />
          </SelectTrigger>
          <SelectContent>
            {attributes.map((attr) => (
              <SelectItem key={attr.key} value={attr.key}>
                <span className="text-xs">{attr.icon ? `${attr.icon} ` : ''}{attr.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Operation selector */}
        <Select
          value={modifier.operation}
          onValueChange={(val) => onUpdate(index, 'operation', val as QuickReplyModifierOperation)}
        >
          <SelectTrigger className="h-7 text-xs w-[90px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {availableOps.map((op) => (
              <SelectItem key={op} value={op}>
                <span className="text-xs">
                  {OPERATION_LABELS[op].symbol} {OPERATION_LABELS[op].label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Value input */}
        <Input
          type={isTextAttr ? 'text' : 'number'}
          value={String(modifier.value)}
          onChange={(e) => {
            const val = isTextAttr ? e.target.value : (parseFloat(e.target.value) || 0);
            onUpdate(index, 'value', val);
          }}
          className="h-7 text-xs w-[70px]"
          placeholder="Valor"
        />

        {/* Remove button */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-red-400 flex-shrink-0"
          onClick={() => onRemove(index)}
        >
          <X className="w-3 h-3" />
        </Button>
      </div>
    );
  };

  // Render sprite activation section
  const renderSpriteActivation = (
    activation: QuickReplySpriteActivation | undefined,
    setActivation: (a: QuickReplySpriteActivation | undefined) => void,
    sectionKey: string,
  ) => {
    const isExpanded = expandedSpriteActivation === sectionKey;
    const isActive = !!activation;

    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => {
            setExpandedSpriteActivation(isExpanded ? null : sectionKey);
            if (!isActive && !isExpanded) {
              // Pre-populate with defaults
              setActivation({
                mode: 'sprite_pack',
                targetId: '',
                fallbackMode: 'idle_collection',
                fallbackDelayMs: 3000,
              });
            }
          }}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ImageIcon className="w-3.5 h-3.5 text-emerald-400" />
          <span>Activación de Sprite</span>
          {isActive && (
            <Badge variant="secondary" className="h-4 text-[10px] px-1 bg-emerald-500/20 text-emerald-400">
              {activation?.mode === 'trigger_collection' ? 'Trigger' : 'Pack'}
            </Badge>
          )}
          {isExpanded ? (
            <ChevronUp className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
        </button>

        {(isExpanded || isActive) && (
          <div className="ml-5 space-y-2 border-l-2 border-emerald-500/20 pl-3">
            {/* Enable/Disable toggle */}
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-muted-foreground">Activar sprite:</label>
              <button
                type="button"
                onClick={() => {
                  if (isActive) {
                    setActivation(undefined);
                  } else {
                    setActivation({
                      mode: 'sprite_pack',
                      targetId: '',
                      fallbackMode: 'idle_collection',
                      fallbackDelayMs: 3000,
                    });
                  }
                }}
                className={cn(
                  "text-[10px] px-2 py-0.5 rounded-full transition-colors",
                  isActive ? "bg-emerald-500/20 text-emerald-400" : "bg-muted text-muted-foreground"
                )}
              >
                {isActive ? 'Activado' : 'Desactivado'}
              </button>
            </div>

            {isActive && activation && (
              <>
                {/* Mode selector */}
                <div className="flex items-center gap-2">
                  <Label className="text-[10px] text-muted-foreground w-16 flex-shrink-0">Modo</Label>
                  <Select
                    value={activation.mode}
                    onValueChange={(val) => setActivation({ ...activation, mode: val as 'trigger_collection' | 'sprite_pack', targetId: '' })}
                  >
                    <SelectTrigger className="h-7 text-xs flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sprite_pack">
                        <span className="text-xs">📦 Sprite Pack (condicional)</span>
                      </SelectItem>
                      <SelectItem value="trigger_collection">
                        <span className="text-xs">🎯 Colección de Triggers</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Target selector */}
                <div className="flex items-center gap-2">
                  <Label className="text-[10px] text-muted-foreground w-16 flex-shrink-0">Objetivo</Label>
                  <Select
                    value={activation.targetId}
                    onValueChange={(val) => setActivation({ ...activation, targetId: val })}
                  >
                    <SelectTrigger className="h-7 text-xs flex-1">
                      <SelectValue placeholder={activation.mode === 'trigger_collection' ? 'Seleccionar trigger...' : 'Seleccionar pack...'} />
                    </SelectTrigger>
                    <SelectContent>
                      {activation.mode === 'trigger_collection' ? (
                        (triggerCollections || []).map((tc) => (
                          <SelectItem key={tc.id} value={tc.id}>
                            <span className="text-xs">🎯 {tc.name} (Prioridad: {tc.priority})</span>
                          </SelectItem>
                        ))
                      ) : (
                        (spritePacksV2 || []).map((pack) => (
                          <SelectItem key={pack.id} value={pack.id}>
                            <span className="text-xs">📦 {pack.name} {pack.conditionalMode ? '(condicional)' : ''}</span>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>

                {/* Fallback mode */}
                <div className="flex items-center gap-2">
                  <Label className="text-[10px] text-muted-foreground w-16 flex-shrink-0">Al terminar</Label>
                  <Select
                    value={activation.fallbackMode}
                    onValueChange={(val) => setActivation({ ...activation, fallbackMode: val as QuickReplySpriteFallbackMode })}
                  >
                    <SelectTrigger className="h-7 text-xs flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="idle_collection">
                        <span className="text-xs">🔄 Volver al estado normal</span>
                      </SelectItem>
                      <SelectItem value="collection_default">
                        <span className="text-xs">🖼️ Sprite principal del pack</span>
                      </SelectItem>
                      <SelectItem value="custom_sprite">
                        <span className="text-xs">✨ Sprite personalizado</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Fallback delay */}
                <div className="flex items-center gap-2">
                  <Label className="text-[10px] text-muted-foreground w-16 flex-shrink-0">
                    <Timer className="w-3 h-3 inline mr-1" />
                    Duración
                  </Label>
                  <Input
                    type="number"
                    value={activation.fallbackDelayMs}
                    onChange={(e) => setActivation({ ...activation, fallbackDelayMs: parseInt(e.target.value) || 0 })}
                    className="h-7 text-xs w-[80px]"
                    min={0}
                    step={500}
                  />
                  <span className="text-[10px] text-muted-foreground">ms (0 = persistir)</span>
                </div>

                {/* Custom sprite for fallback (only when mode is custom_sprite) */}
                {activation.fallbackMode === 'custom_sprite' && (
                  <div className="flex items-center gap-2">
                    <Label className="text-[10px] text-muted-foreground w-16 flex-shrink-0">Sprite fall.</Label>
                    <Select
                      value={activation.fallbackSpriteId || ''}
                      onValueChange={(val) => setActivation({ ...activation, fallbackSpriteId: val })}
                    >
                      <SelectTrigger className="h-7 text-xs flex-1">
                        <SelectValue placeholder="Seleccionar sprite..." />
                      </SelectTrigger>
                      <SelectContent>
                        {(spritePacksV2 || []).flatMap((pack) =>
                          pack.sprites.map((sprite) => (
                            <SelectItem key={sprite.id} value={sprite.id}>
                              <span className="text-xs">{pack.name} / {sprite.label}</span>
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  // Render condition section for a quick reply (new or editing)
  const renderConditionSection = (
    requirements: StatRequirement[],
    requirementOperator: 'AND' | 'OR',
    setRequirements: (r: StatRequirement[]) => void,
    setRequirementOperator: (op: 'AND' | 'OR') => void,
    sectionKey: string,
  ) => {
    const isExpanded = expandedConditions === sectionKey;
    const hasRequirements = requirements.length > 0;

    return (
      <TooltipProvider>
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setExpandedConditions(isExpanded ? null : sectionKey)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Filter className="w-3.5 h-3.5 text-orange-400" />
            <span>Condiciones de visibilidad</span>
            {hasRequirements && (
              <Badge variant="secondary" className="h-4 text-[10px] px-1 bg-orange-500/20 text-orange-400">
                {requirements.length}
              </Badge>
            )}
            {isExpanded ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
          </button>

          {(isExpanded || hasRequirements) && (
            <div className="ml-5 space-y-2 border-l-2 border-orange-500/20 pl-3">
              {/* Existing requirements */}
              {requirements.map((req, idx) => (
                <RequirementEditor
                  key={idx}
                  requirement={req}
                  availableAttributes={attributes}
                  availableTargets={availableTargets}
                  onChange={(updates) => {
                    const updated = [...requirements];
                    updated[idx] = { ...updated[idx], ...updates };
                    setRequirements(updated);
                  }}
                  onDelete={() => {
                    const updated = requirements.filter((_, i) => i !== idx);
                    setRequirements(updated);
                  }}
                />
              ))}

              {/* AND/OR toggle */}
              <RequirementOperatorToggle
                operator={requirementOperator}
                onChange={setRequirementOperator}
                requirementCount={requirements.length}
              />

              {/* Add condition button */}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-orange-600 hover:text-orange-700 hover:bg-orange-500/10"
                onClick={() => {
                  const newReq: StatRequirement = { attributeKey: '', operator: '>=', value: 0 };
                  setRequirements([...requirements, newReq]);
                }}
              >
                <Plus className="w-3 h-3 mr-1" />
                Agregar Condición
              </Button>
            </div>
          )}
        </div>
      </TooltipProvider>
    );
  };

  // Render umbral (conditional message) section for a quick reply (new or editing)
  const renderUmbralSection = (
    umbrales: QuickReplyUmbral[],
    setUmbrales: (u: QuickReplyUmbral[]) => void,
    sectionKey: string,
  ) => {
    const isExpanded = expandedUmbral === sectionKey;
    const hasUmbrales = umbrales.length > 0;

    const updateUmbral = (id: string, updates: Partial<QuickReplyUmbral>) => {
      setUmbrales(umbrales.map(u => u.id === id ? { ...u, ...updates } : u));
    };

    const moveUmbral = (index: number, dir: -1 | 1) => {
      const target = index + dir;
      if (target < 0 || target >= umbrales.length) return;
      const updated = [...umbrales];
      const [moved] = updated.splice(index, 1);
      updated.splice(target, 0, moved);
      setUmbrales(updated);
    };

    return (
      <TooltipProvider>
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setExpandedUmbral(isExpanded ? null : sectionKey)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <GitBranch className="w-3.5 h-3.5 text-cyan-400" />
            <span>Umbral (respuesta condicional)</span>
            {hasUmbrales && (
              <Badge variant="secondary" className="h-4 text-[10px] px-1 bg-cyan-500/20 text-cyan-400">
                {umbrales.length}
              </Badge>
            )}
            {isExpanded ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
          </button>
          <p className="text-[10px] text-muted-foreground ml-5">
            Si se cumplen las condiciones se envía el texto del umbral <strong>en lugar de</strong> la Respuesta.
            Se evalúan de arriba hacia abajo: gana el primero que cumpla (como los lorebooks por atributo).
          </p>

          {(isExpanded || hasUmbrales) && (
            <div className="ml-5 space-y-2 border-l-2 border-cyan-500/20 pl-3">
              {umbrales.map((umbral, idx) => (
                <div key={umbral.id} className="rounded-md border bg-muted/20 p-2 space-y-2">
                  {/* Header: name + enabled + reorder + delete */}
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={umbral.name}
                      onChange={(e) => updateUmbral(umbral.id, { name: e.target.value })}
                      placeholder={`Nombre del umbral ${idx + 1} (ej: Golpe salvaje)`}
                      className="h-7 text-xs flex-1"
                      maxLength={40}
                    />
                    <button
                      type="button"
                      title={umbral.enabled ? 'Desactivar umbral' : 'Activar umbral'}
                      onClick={() => updateUmbral(umbral.id, { enabled: !umbral.enabled })}
                      className={cn(
                        'text-[10px] px-2 py-0.5 rounded-full transition-colors flex-shrink-0',
                        umbral.enabled ? 'bg-cyan-500/20 text-cyan-400' : 'bg-muted text-muted-foreground'
                      )}
                    >
                      {umbral.enabled ? 'On' : 'Off'}
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 flex-shrink-0"
                      disabled={idx === 0}
                      title="Subir prioridad"
                      onClick={() => moveUmbral(idx, -1)}
                    >
                      <ArrowUp className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 flex-shrink-0"
                      disabled={idx === umbrales.length - 1}
                      title="Bajar prioridad"
                      onClick={() => moveUmbral(idx, 1)}
                    >
                      <ArrowDown className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-red-400 hover:text-red-500 flex-shrink-0"
                      onClick={() => setUmbrales(umbrales.filter(u => u.id !== umbral.id))}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>

                  {/* Conditions */}
                  <div className="space-y-1.5">
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Filter className="w-3 h-3 text-orange-400" />
                      Condiciones (atributos del personaje):
                    </p>
                    {umbral.conditions.map((req, cIdx) => (
                      <RequirementEditor
                        key={cIdx}
                        requirement={req}
                        availableAttributes={attributes}
                        availableTargets={availableTargets}
                        onChange={(updates) => {
                          const updated = [...umbral.conditions];
                          updated[cIdx] = { ...updated[cIdx], ...updates };
                          updateUmbral(umbral.id, { conditions: updated });
                        }}
                        onDelete={() => {
                          updateUmbral(umbral.id, { conditions: umbral.conditions.filter((_, i) => i !== cIdx) });
                        }}
                      />
                    ))}
                    <RequirementOperatorToggle
                      operator={umbral.conditionOperator}
                      requirementCount={umbral.conditions.length}
                      onChange={(op) => updateUmbral(umbral.id, { conditionOperator: op })}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs text-orange-600 hover:text-orange-700 hover:bg-orange-500/10"
                      onClick={() => updateUmbral(umbral.id, { conditions: [...umbral.conditions, { attributeKey: '', operator: '>=', value: 0 }] })}
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      Agregar Condición
                    </Button>
                  </div>

                  {/* Message */}
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">
                      Mensaje a enviar cuando se cumplen las condiciones (reemplaza la Respuesta):
                    </Label>
                    <Textarea
                      value={umbral.message}
                      onChange={(e) => updateUmbral(umbral.id, { message: e.target.value })}
                      placeholder="Ej: Ella te ataca con rabia mientras jadea tu nombre... (usa {{char}}, {{user}})"
                      className="min-h-[60px] text-xs"
                      maxLength={2000}
                    />
                  </div>
                </div>
              ))}

              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-cyan-600 hover:text-cyan-700 hover:bg-cyan-500/10"
                onClick={() =>
                  setUmbrales([
                    ...umbrales,
                    {
                      id: `umbral_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                      name: '',
                      enabled: true,
                      conditions: [{ attributeKey: '', operator: '>=', value: 0 }],
                      conditionOperator: 'AND',
                      message: '',
                    },
                  ])
                }
              >
                <Plus className="w-3 h-3 mr-1" />
                Agregar umbral
              </Button>
            </div>
          )}
        </div>
      </TooltipProvider>
    );
  };

  // Render wardrobe action section (Guardarropa V2) for a quick reply (new or editing)
  const renderWardrobeSection = (
    action: QuickReplyWardrobeAction | undefined,
    setAction: (a: QuickReplyWardrobeAction | undefined) => void,
    sectionKey: string,
  ) => {
    if (!hasWardrobeOptions) return null;
    const isExpanded = expandedWardrobe === sectionKey;
    const isActive = !!action;
    const outfits = wardrobeConfig?.outfits || [];
    const selectedOutfit = action?.outfitId ? outfits.find(o => o.id === action.outfitId) : undefined;

    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setExpandedWardrobe(isExpanded ? null : sectionKey)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Shirt className="w-3.5 h-3.5 text-rose-400" />
          <span>Cambiar Guardarropa</span>
          {isActive && (
            <Badge variant="secondary" className="h-4 text-[10px] px-1 bg-rose-500/20 text-rose-400 max-w-[140px]">
              <span className="truncate">{action?.action === 'remove' ? '→ predeterminado' : (selectedOutfit?.name || 'Outfit...')}</span>
            </Badge>
          )}
          {isExpanded ? (
            <ChevronUp className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
        </button>

        {(isExpanded || isActive) && (
          <div className="ml-5 space-y-2 border-l-2 border-rose-500/20 pl-3">
            {/* Enable/Disable toggle */}
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-muted-foreground">Cambiar vestuario:</label>
              <button
                type="button"
                onClick={() => {
                  if (isActive) {
                    setAction(undefined);
                  } else {
                    setAction({ action: 'wear', outfitId: outfits[0]?.id });
                  }
                }}
                className={cn(
                  'text-[10px] px-2 py-0.5 rounded-full transition-colors',
                  isActive ? 'bg-rose-500/20 text-rose-400' : 'bg-muted text-muted-foreground'
                )}
              >
                {isActive ? 'Activado' : 'Desactivado'}
              </button>
            </div>

            {isActive && action && (
              <>
                {/* Action selector */}
                <div className="flex items-center gap-2">
                  <Label className="text-[10px] text-muted-foreground w-16 flex-shrink-0">Acción</Label>
                  <Select
                    value={action.action}
                    onValueChange={(val) =>
                      setAction(val === 'wear' ? { action: 'wear', outfitId: action.outfitId || outfits[0]?.id } : { action: 'remove' })
                    }
                  >
                    <SelectTrigger className="h-7 text-xs flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="wear">
                        <span className="text-xs">👗 Poner un outfit</span>
                      </SelectItem>
                      <SelectItem value="remove">
                        <span className="text-xs">🧺 Quitarse el vestuario (volver al predeterminado)</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Outfit selector (only for 'wear') */}
                {action.action === 'wear' && (
                  <div className="flex items-center gap-2">
                    <Label className="text-[10px] text-muted-foreground w-16 flex-shrink-0">Outfit</Label>
                    <Select
                      value={action.outfitId || ''}
                      onValueChange={(val) => setAction({ action: 'wear', outfitId: val })}
                    >
                      <SelectTrigger className="h-7 text-xs flex-1">
                        <SelectValue placeholder="Seleccionar outfit..." />
                      </SelectTrigger>
                      <SelectContent>
                        {outfits.map((o) => (
                          <SelectItem key={o.id} value={o.id}>
                            <span className="text-xs">{o.isDefault ? '⭐ ' : ''}{o.name}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  // Render scenario action section (ESCENARIO V2) for a quick reply (new or editing)
  const renderScenarioSection = (
    action: QuickReplyScenarioAction | undefined,
    setAction: (a: QuickReplyScenarioAction | undefined) => void,
    sectionKey: string,
  ) => {
    if (!hasScenarioOptions) return null;
    const isExpanded = expandedScenario === sectionKey;
    const isActive = !!action;
    const locations = scenarioConfig?.locations || [];
    const selectedLocation = action?.locationId ? locations.find(l => l.id === action.locationId) : undefined;

    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setExpandedScenario(isExpanded ? null : sectionKey)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <MapPin className="w-3.5 h-3.5 text-emerald-400" />
          <span>Cambiar Escenario</span>
          {isActive && (
            <Badge variant="secondary" className="h-4 text-[10px] px-1 bg-emerald-500/20 text-emerald-400 max-w-[140px]">
              <span className="truncate">→ {selectedLocation?.name || 'Ubicación...'}</span>
            </Badge>
          )}
          {isExpanded ? (
            <ChevronUp className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
        </button>

        {(isExpanded || isActive) && (
          <div className="ml-5 space-y-2 border-l-2 border-emerald-500/20 pl-3">
            {/* Enable/Disable toggle */}
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-muted-foreground">Mover la escena:</label>
              <button
                type="button"
                onClick={() => {
                  if (isActive) {
                    setAction(undefined);
                  } else {
                    setAction({ action: 'go', locationId: locations[0]?.id });
                  }
                }}
                className={cn(
                  'text-[10px] px-2 py-0.5 rounded-full transition-colors',
                  isActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-muted text-muted-foreground'
                )}
              >
                {isActive ? 'Activado' : 'Desactivado'}
              </button>
            </div>

            {isActive && action && (
              <div className="flex items-center gap-2">
                <Label className="text-[10px] text-muted-foreground w-16 flex-shrink-0">Ubicación</Label>
                <Select
                  value={action.locationId || ''}
                  onValueChange={(val) => setAction({ action: 'go', locationId: val })}
                >
                  <SelectTrigger className="h-7 text-xs flex-1">
                    <SelectValue placeholder="Seleccionar ubicación..." />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        <span className="text-xs">{l.isDefault ? '⭐ ' : ''}{l.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = replies.findIndex((r) => r.id === active.id);
      const newIndex = replies.findIndex((r) => r.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        onChange(arrayMove(replies, oldIndex, newIndex));
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-violet-500/10 to-purple-500/10 border border-violet-500/20 rounded-lg p-3">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-violet-500/20 rounded-lg">
            <MessageSquare className="w-5 h-5 text-violet-500" />
          </div>
          <div className="flex-1">
            <h4 className="text-sm font-medium text-violet-600">Respuestas Rápidas</h4>
            <p className="text-xs text-muted-foreground mt-1">
              Botones de acceso rápido personalizados para este personaje.{' '}
              <strong>Etiqueta</strong> es lo que se ve, <strong>Respuesta</strong> es lo que se envía.{' '}
              Puedes usar <code className="text-[10px] bg-muted px-1 rounded">{'{{char}}'}</code> y{' '}
              <code className="text-[10px] bg-muted px-1 rounded">{'{{user}}'}</code> para insertar nombres.
            </p>
            {attributes.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                Opcionalmente puedes agregar <Zap className="w-3 h-3 inline text-amber-400" /> modificadores de atributos que se aplican al usar la respuesta,{' '}
                <Filter className="w-3 h-3 inline text-orange-400" /> condiciones de visibilidad para controlar cuándo se muestra,{' '}
                <GitBranch className="w-3 h-3 inline text-cyan-400" /> umbrales con mensajes condicionales que reemplazan la Respuesta según los atributos,{' '}
                <Shirt className="w-3 h-3 inline text-rose-400" /> cambio de guardarropa,{' '}
                <MapPin className="w-3 h-3 inline text-emerald-400" /> cambio de escenario, y{' '}
                <ImageIcon className="w-3 h-3 inline text-emerald-400" /> activación de sprites al usar la respuesta.
              </p>
            )}
            {attributes.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                Puedes agregar <Filter className="w-3 h-3 inline text-orange-400" /> condiciones de visibilidad para controlar cuándo se muestra cada respuesta.
              </p>
            )}
            {hasSpriteOptions && (
              <p className="text-xs text-muted-foreground mt-1">
                También puedes activar <ImageIcon className="w-3 h-3 inline text-emerald-400" /> sprites al usar la respuesta.
              </p>
            )}
            {hasWardrobeOptions && (
              <p className="text-xs text-muted-foreground mt-1">
                Una respuesta puede cambiar varias cosas a la vez: modificar atributos, activar un sprite, cambiar el vestuario, mover la escena a otra ubicación y enviar el mensaje según el umbral configurado (si no hay umbral, se envía la Respuesta).
              </p>
            )}
            {replies.length > 1 && (
              <p className="text-xs text-muted-foreground mt-1">
                <GripVertical className="w-3 h-3 inline text-muted-foreground" /> Arrastra para reordenar las respuestas.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Existing replies */}
      {replies.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={replies.map((r) => r.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {replies.map((reply) => (
                <SortableQuickReplyItem
                  key={reply.id}
                  reply={reply}
                  editingId={editingId}
                  editLabel={editLabel}
                  editResponse={editResponse}
                  editModifiers={editModifiers}
                  editRequirements={editRequirements}
                  editRequirementOperator={editRequirementOperator}
                  editSpriteActivation={editSpriteActivation}
                  editUmbrales={editUmbrales}
                  setEditUmbrales={setEditUmbrales}
                  editWardrobeAction={editWardrobeAction}
                  setEditWardrobeAction={setEditWardrobeAction}
                  editScenarioAction={editScenarioAction}
                  setEditScenarioAction={setEditScenarioAction}
                  expandedUmbral={expandedUmbral}
                  setExpandedUmbral={setExpandedUmbral}
                  expandedWardrobe={expandedWardrobe}
                  setExpandedWardrobe={setExpandedWardrobe}
                  expandedScenario={expandedScenario}
                  setExpandedScenario={setExpandedScenario}
                  expandedModifiers={expandedModifiers}
                  expandedConditions={expandedConditions}
                  expandedSpriteActivation={expandedSpriteActivation}
                  attributes={attributes}
                  hasSpriteOptions={hasSpriteOptions}
                  hasWardrobeOptions={hasWardrobeOptions}
                  hasScenarioOptions={hasScenarioOptions}
                  spritePacksV2={spritePacksV2}
                  triggerCollections={triggerCollections}
                  wardrobeConfig={wardrobeConfig}
                  scenarioConfig={scenarioConfig}
                  availableTargets={availableTargets}
                  onStartEdit={handleStartEdit}
                  onSaveEdit={handleSaveEdit}
                  onCancelEdit={handleCancelEdit}
                  onDelete={handleDelete}
                  setEditLabel={setEditLabel}
                  setEditResponse={setEditResponse}
                  setEditModifiers={setEditModifiers}
                  setEditRequirements={setEditRequirements}
                  setEditRequirementOperator={setEditRequirementOperator}
                  setEditSpriteActivation={setEditSpriteActivation}
                  setExpandedModifiers={setExpandedModifiers}
                  setExpandedConditions={setExpandedConditions}
                  setExpandedSpriteActivation={setExpandedSpriteActivation}
                  addModifierToEdit={addModifierToEdit}
                  updateEditModifier={updateEditModifier}
                  removeEditModifier={removeEditModifier}
                  renderModifierRow={renderModifierRow}
                  renderSpriteActivation={renderSpriteActivation}
                  renderConditionSection={renderConditionSection}
                  renderUmbralSection={renderUmbralSection}
                  renderWardrobeSection={renderWardrobeSection}
                  renderScenarioSection={renderScenarioSection}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Add new reply form */}
      {replies.length < 12 && (
        <div className="p-3 rounded-lg border border-dashed space-y-3">
          <p className="text-xs text-muted-foreground font-medium">Agregar nueva respuesta rápida</p>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground w-20 flex-shrink-0">Etiqueta</Label>
            <Input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="h-8 text-sm flex-1"
              placeholder="Ej: Atacar..."
              maxLength={20}
            />
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground w-20 flex-shrink-0">Respuesta</Label>
            <Input
              value={newResponse}
              onChange={(e) => setNewResponse(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newLabel.trim() && newResponse.trim()) {
                  handleAdd();
                }
              }}
              className="h-8 text-sm flex-1"
              placeholder="Mensaje que se envía (usa {{char}}, {{user}})"
              maxLength={200}
            />
          </div>

          {/* Modifiers for new reply */}
          {attributes.length > 0 && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() =>
                  setExpandedModifiers(expandedModifiers === '__new__' ? null : '__new__')
                }
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>Modificadores de atributos</span>
                {newModifiers.length > 0 && (
                  <Badge variant="secondary" className="h-4 text-[10px] px-1">
                    {newModifiers.length}
                  </Badge>
                )}
                {expandedModifiers === '__new__' ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
              </button>

              {(expandedModifiers === '__new__' || newModifiers.length > 0) && (
                <div className="ml-5 space-y-1.5">
                  {newModifiers.map((mod, idx) =>
                    renderModifierRow(mod, idx, updateNewModifier, removeNewModifier)
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-violet-600 hover:text-violet-700 hover:bg-violet-500/10"
                    onClick={addModifierToNew}
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    Agregar modificador
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Sprite activation for new reply */}
          {hasSpriteOptions && (
            <div>
              {renderSpriteActivation(newSpriteActivation, setNewSpriteActivation, '__new__')}
            </div>
          )}

          {/* Wardrobe action for new reply */}
          {hasWardrobeOptions && (
            <div>
              {renderWardrobeSection(newWardrobeAction, setNewWardrobeAction, '__new__')}
            </div>
          )}

          {/* Scenario action for new reply (ESCENARIO V2) */}
          {hasScenarioOptions && (
            <div>
              {renderScenarioSection(newScenarioAction, setNewScenarioAction, '__new__')}
            </div>
          )}

          {/* Umbral (conditional messages) for new reply */}
          {(attributes.length > 0 || (availableTargets && availableTargets.length > 0)) && (
            <div>
              {renderUmbralSection(newUmbrales, setNewUmbrales, '__new__')}
            </div>
          )}

          {/* Conditions for new reply */}
          {(attributes.length > 0 || (availableTargets && availableTargets.length > 0)) && (
            <div>
              {renderConditionSection(newRequirements, newRequirementOperator, setNewRequirements, setNewRequirementOperator, '__new__')}
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            className="h-8 w-full"
            disabled={!isAdding}
            onClick={handleAdd}
          >
            <Plus className="w-4 h-4 mr-1" />
            Agregar
          </Button>
        </div>
      )}

      {replies.length >= 12 && (
        <p className="text-xs text-muted-foreground text-center">
          Máximo 12 respuestas rápidas permitidas.
        </p>
      )}

      {replies.length === 0 && (
        <div className="text-center py-6 text-muted-foreground">
          <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-xs">No hay respuestas rápidas configuradas</p>
          <p className="text-xs opacity-60">Agrega respuestas rápidas para acceso directo en el chat</p>
        </div>
      )}
    </div>
  );
}

// ============================================
// Sortable Quick Reply Item - DnD wrapper
// ============================================

interface SortableQuickReplyItemProps {
  reply: CharacterQuickReply;
  editingId: string | null;
  editLabel: string;
  editResponse: string;
  editModifiers: QuickReplyAttributeModifier[];
  editRequirements: StatRequirement[];
  editRequirementOperator: 'AND' | 'OR';
  editSpriteActivation: QuickReplySpriteActivation | undefined;
  expandedModifiers: string | null;
  expandedConditions: string | null;
  expandedSpriteActivation: string | null;
  attributes: AttributeDefinition[];
  hasSpriteOptions: boolean;
  hasWardrobeOptions: boolean;
  hasScenarioOptions: boolean;
  spritePacksV2?: SpritePackV2[];
  triggerCollections?: TriggerCollection[];
  wardrobeConfig?: WardrobeConfig;
  scenarioConfig?: ScenarioConfig;
  availableTargets?: { id: string; name: string; attributes: AttributeDefinition[] }[];
  onStartEdit: (reply: CharacterQuickReply) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: (id: string) => void;
  setEditLabel: (v: string) => void;
  setEditResponse: (v: string) => void;
  setEditModifiers: (v: QuickReplyAttributeModifier[]) => void;
  setEditRequirements: (v: StatRequirement[]) => void;
  setEditRequirementOperator: (v: 'AND' | 'OR') => void;
  setEditSpriteActivation: (v: QuickReplySpriteActivation | undefined) => void;
  // Umbral (conditional messages) props
  editUmbrales: QuickReplyUmbral[];
  setEditUmbrales: (v: QuickReplyUmbral[]) => void;
  expandedUmbral: string | null;
  setExpandedUmbral: (v: string | null) => void;
  // Wardrobe action props
  editWardrobeAction: QuickReplyWardrobeAction | undefined;
  setEditWardrobeAction: (v: QuickReplyWardrobeAction | undefined) => void;
  expandedWardrobe: string | null;
  setExpandedWardrobe: (v: string | null) => void;
  // Scenario action props (ESCENARIO V2)
  editScenarioAction: QuickReplyScenarioAction | undefined;
  setEditScenarioAction: (v: QuickReplyScenarioAction | undefined) => void;
  expandedScenario: string | null;
  setExpandedScenario: (v: string | null) => void;
  setExpandedModifiers: (v: string | null) => void;
  setExpandedConditions: (v: string | null) => void;
  setExpandedSpriteActivation: (v: string | null) => void;
  addModifierToEdit: () => void;
  updateEditModifier: (index: number, field: keyof QuickReplyAttributeModifier, value: string | number) => void;
  removeEditModifier: (index: number) => void;
  renderModifierRow: (
    modifier: QuickReplyAttributeModifier,
    index: number,
    onUpdate: (index: number, field: keyof QuickReplyAttributeModifier, value: string | number) => void,
    onRemove: (index: number) => void
  ) => React.ReactNode;
  renderSpriteActivation: (
    activation: QuickReplySpriteActivation | undefined,
    setActivation: (a: QuickReplySpriteActivation | undefined) => void,
    sectionKey: string,
  ) => React.ReactNode;
  renderConditionSection: (
    requirements: StatRequirement[],
    requirementOperator: 'AND' | 'OR',
    setRequirements: (r: StatRequirement[]) => void,
    setRequirementOperator: (op: 'AND' | 'OR') => void,
    sectionKey: string,
  ) => React.ReactNode;
  renderUmbralSection: (
    umbrales: QuickReplyUmbral[],
    setUmbrales: (u: QuickReplyUmbral[]) => void,
    sectionKey: string,
  ) => React.ReactNode;
  renderWardrobeSection: (
    action: QuickReplyWardrobeAction | undefined,
    setAction: (a: QuickReplyWardrobeAction | undefined) => void,
    sectionKey: string,
  ) => React.ReactNode;
  renderScenarioSection: (
    action: QuickReplyScenarioAction | undefined,
    setAction: (a: QuickReplyScenarioAction | undefined) => void,
    sectionKey: string,
  ) => React.ReactNode;
}

function SortableQuickReplyItem({
  reply,
  editingId,
  editLabel,
  editResponse,
  editModifiers,
  editRequirements,
  editRequirementOperator,
  editSpriteActivation,
  expandedModifiers,
  expandedConditions,
  expandedSpriteActivation,
  attributes,
  hasSpriteOptions,
  hasWardrobeOptions,
  hasScenarioOptions,
  spritePacksV2,
  triggerCollections,
  wardrobeConfig,
  scenarioConfig,
  availableTargets,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
  setEditLabel,
  setEditResponse,
  setEditModifiers,
  setEditRequirements,
  setEditRequirementOperator,
  setEditSpriteActivation,
  // Umbral (conditional messages)
  editUmbrales,
  setEditUmbrales,
  expandedUmbral,
  setExpandedUmbral,
  // Wardrobe action
  editWardrobeAction,
  setEditWardrobeAction,
  expandedWardrobe,
  setExpandedWardrobe,
  // Scenario action (ESCENARIO V2)
  editScenarioAction,
  setEditScenarioAction,
  expandedScenario,
  setExpandedScenario,
  setExpandedModifiers,
  setExpandedConditions,
  setExpandedSpriteActivation,
  addModifierToEdit,
  updateEditModifier,
  removeEditModifier,
  renderModifierRow,
  renderSpriteActivation,
  renderConditionSection,
  renderUmbralSection,
  renderWardrobeSection,
  renderScenarioSection,
}: SortableQuickReplyItemProps) {
  const {
    attributes: dndAttributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: reply.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isEditing = editingId === reply.id;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-lg border group",
        isDragging && "z-50 shadow-lg shadow-violet-500/10 border-violet-500/50 opacity-90"
      )}
    >
      {isEditing ? (
        /* Edit mode */
        <div className="p-3 space-y-3">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground w-20 flex-shrink-0">Etiqueta</Label>
            <Input
              value={editLabel}
              onChange={(e) => setEditLabel(e.target.value)}
              className="h-8 text-sm flex-1"
              placeholder="Texto del botón..."
              maxLength={20}
            />
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground w-20 flex-shrink-0">Respuesta</Label>
            <Input
              value={editResponse}
              onChange={(e) => setEditResponse(e.target.value)}
              className="h-8 text-sm flex-1"
              placeholder="Mensaje que se envía..."
              maxLength={200}
            />
          </div>

          {/* Modifiers section */}
          {attributes.length > 0 && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() =>
                  setExpandedModifiers(
                    expandedModifiers === reply.id ? null : reply.id
                  )
                }
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>Modificadores de atributos</span>
                {editModifiers.length > 0 && (
                  <Badge variant="secondary" className="h-4 text-[10px] px-1">
                    {editModifiers.length}
                  </Badge>
                )}
                {expandedModifiers === reply.id ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
              </button>

              {(expandedModifiers === reply.id || editModifiers.length > 0) && (
                <div className="ml-5 space-y-1.5">
                  {editModifiers.map((mod, idx) =>
                    renderModifierRow(mod, idx, updateEditModifier, removeEditModifier)
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-violet-600 hover:text-violet-700 hover:bg-violet-500/10"
                    onClick={addModifierToEdit}
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    Agregar modificador
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Sprite activation section for editing */}
          {hasSpriteOptions && (
            <div className="mt-2">
              {renderSpriteActivation(editSpriteActivation, setEditSpriteActivation, `edit-${reply.id}`)}
            </div>
          )}

          {/* Wardrobe action section for editing */}
          {hasWardrobeOptions && (
            <div className="mt-2">
              {renderWardrobeSection(editWardrobeAction, setEditWardrobeAction, `edit-${reply.id}`)}
            </div>
          )}

          {/* Scenario action section for editing (ESCENARIO V2) */}
          {hasScenarioOptions && (
            <div className="mt-2">
              {renderScenarioSection(editScenarioAction, setEditScenarioAction, `edit-${reply.id}`)}
            </div>
          )}

          {/* Umbral (conditional messages) section for editing */}
          {(attributes.length > 0 || (availableTargets && availableTargets.length > 0)) && (
            <div className="mt-2">
              {renderUmbralSection(editUmbrales, setEditUmbrales, `edit-${reply.id}`)}
            </div>
          )}

          {/* Conditions section for editing */}
          {(attributes.length > 0 || (availableTargets && availableTargets.length > 0)) && (
            <div className="mt-2">
              {renderConditionSection(editRequirements, editRequirementOperator, setEditRequirements, setEditRequirementOperator, `edit-${reply.id}`)}
            </div>
          )}

          {/* Save / Cancel */}
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-violet-600 hover:text-violet-700 hover:bg-violet-500/10"
              disabled={!editLabel.trim() || !editResponse.trim()}
              onClick={onSaveEdit}
            >
              <Check className="w-3.5 h-3.5 mr-1" />
              Guardar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={onCancelEdit}
            >
              <X className="w-3.5 h-3.5 mr-1" />
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        /* Display mode */
        <div className="flex items-center gap-2 p-2">
          {/* Drag handle */}
          <button
            type="button"
            className={cn(
              "p-1 rounded cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/50 transition-colors flex-shrink-0",
              isDragging && "cursor-grabbing"
            )}
            {...dndAttributes}
            {...listeners}
          >
            <GripVertical className="w-4 h-4" />
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium">{reply.label}</span>
              {reply.modifiers && reply.modifiers.length > 0 && (
                <Badge variant="secondary" className="h-4 text-[10px] px-1.5 gap-0.5">
                  <Zap className="w-2.5 h-2.5 text-amber-400" />
                  {reply.modifiers.length}
                </Badge>
              )}
              {reply.spriteActivation && (
                <Badge variant="secondary" className="h-4 text-[10px] px-1.5 gap-0.5 bg-emerald-500/20 text-emerald-400">
                  <ImageIcon className="w-2.5 h-2.5" />
                  {reply.spriteActivation.mode === 'trigger_collection' ? 'Trigger' : 'Sprite'}
                </Badge>
              )}
              {reply.wardrobeAction && (
                <Badge variant="secondary" className="h-4 text-[10px] px-1.5 gap-0.5 bg-rose-500/20 text-rose-400 max-w-[130px]">
                  <Shirt className="w-2.5 h-2.5 flex-shrink-0" />
                  <span className="truncate">
                    {reply.wardrobeAction.action === 'remove'
                      ? '→ predeterminado'
                      : (wardrobeConfig?.outfits?.find(o => o.id === reply.wardrobeAction?.outfitId)?.name || 'Outfit')}
                  </span>
                </Badge>
              )}
              {reply.scenarioAction && (
                <Badge variant="secondary" className="h-4 text-[10px] px-1.5 gap-0.5 bg-emerald-500/20 text-emerald-400 max-w-[130px]">
                  <MapPin className="w-2.5 h-2.5 flex-shrink-0" />
                  <span className="truncate">
                    {scenarioConfig?.locations?.find(l => l.id === reply.scenarioAction?.locationId)?.name || 'Ubicación'}
                  </span>
                </Badge>
              )}
              {reply.umbrales && reply.umbrales.length > 0 && (
                <Badge variant="secondary" className="h-4 text-[10px] px-1.5 gap-0.5 bg-cyan-500/20 text-cyan-400">
                  <GitBranch className="w-2.5 h-2.5" />
                  {reply.umbrales.length}
                </Badge>
              )}
              {reply.requirements && reply.requirements.length > 0 && (
                <Badge variant="secondary" className="h-4 text-[10px] px-1.5 gap-0.5 bg-orange-500/20 text-orange-400">
                  <Filter className="w-2.5 h-2.5" />
                  {reply.requirements.length}
                </Badge>
              )}
            </div>
            {reply.response !== reply.label && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {reply.response}
              </p>
            )}
            {reply.modifiers && reply.modifiers.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {reply.modifiers.map((mod, idx) => {
                  const attr = attributes.find((a) => a.key === mod.attributeKey);
                  const op = OPERATION_LABELS[mod.operation];
                  return (
                    <span
                      key={idx}
                      className="text-[10px] bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded"
                    >
                      {attr?.icon ? `${attr.icon} ` : ''}{attr?.name || mod.attributeKey} {op.symbol} {mod.value}
                    </span>
                  );
                })}
              </div>
            )}
            {reply.requirements && reply.requirements.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {reply.requirements.map((req, idx) => {
                  const attr = attributes.find((a) => a.key === req.attributeKey);
                  const isTarget = !!req.targetCharacterId;
                  const operatorSymbol = (() => {
                    const allOps = [...NUMERIC_OPERATOR_OPTIONS, ...TEXT_OPERATOR_OPTIONS];
                    return allOps.find(o => o.value === req.operator)?.label || req.operator;
                  })();
                  return (
                    <span
                      key={idx}
                      className="text-[10px] bg-orange-500/10 text-orange-600 px-1.5 py-0.5 rounded"
                    >
                      {isTarget ? '🎯 ' : ''}{attr?.icon ? `${attr.icon} ` : ''}{attr?.name || req.attributeKey} {operatorSymbol} {req.value}{req.operator === 'between' && req.valueMax != null ? `─${req.valueMax}` : ''}
                    </span>
                  );
                })}
                {reply.requirements.length > 1 && (
                  <span className="text-[10px] text-muted-foreground px-1">
                    ({reply.requirementOperator === 'OR' ? 'O' : 'Y'})
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => onStartEdit(reply)}
            >
              <Settings2 className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-red-400 hover:text-red-500 hover:bg-red-500/10"
              onClick={() => onDelete(reply.id)}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
