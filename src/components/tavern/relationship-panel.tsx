'use client';

// ============================================
// Relationship Panel — visual bond graph + MANUAL EDITING
// ============================================
//
// Shows the relationships of the active session as a radial SVG graph:
// the user (persona) at the center, characters around it, and edges
// labeled with bond points (0-100) and stage. Includes character↔character
// bonds (group chats) and a legend.
//
// EDITING (manual): every bond in the list can be edited (slider 0-100,
// quick ±, reason) or deleted via statsSlice.updateRelationship /
// removeRelationship. New bonds can be created manually between the user
// and/or session characters. Changes mirror `relacion`/`relacion_etapa`
// into both parties' attributeValues and log an event, so lorebooks,
// sprites, skills and proactive keep working.

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Pencil, Trash2, X, Check, Plus, Undo2 } from 'lucide-react';
import { useTavernStore } from '@/store';
import type { ChatSession, SessionStats } from '@/types';
import {
  RELATIONSHIP_STAGES,
  getRelationship,
  computeRelationshipStage,
  DEFAULT_RELATIONSHIP_POINTS,
  type RelationshipStage,
} from '@/lib/relationships';

interface RelationshipPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeSession: ChatSession | null | undefined;
}

const STAGE_COLORS: Record<string, { stroke: string; text: string; badge: string }> = {
  extranos: { stroke: '#9ca3af', text: 'text-gray-400', badge: 'bg-gray-500/15 text-gray-400 border-gray-500/30' },
  conocidos: { stroke: '#38bdf8', text: 'text-sky-400', badge: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  amigos: { stroke: '#34d399', text: 'text-emerald-400', badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  intimos: { stroke: '#e879f9', text: 'text-fuchsia-400', badge: 'bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30' },
  pareja: { stroke: '#fb7185', text: 'text-rose-400', badge: 'bg-rose-500/15 text-rose-400 border-rose-500/30' },
};

function stageColor(stageKey: string) {
  return STAGE_COLORS[stageKey] || STAGE_COLORS.extranos;
}

function initialsOf(name: string): string {
  return name.split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
}

// Local import helper to avoid circular import concerns in getRelationship key building
function getRelationshipKey(aId: string, bId: string): string {
  return [aId, bId].sort().join('|');
}

/** Editable bond card: view mode ↔ edit mode */
function BondCard({
  aId,
  aName,
  bId,
  bName,
  points,
  stage,
  reason,
  sessionId,
}: {
  aId: string;
  aName: string;
  bId: string;
  bName: string;
  points: number;
  stage: RelationshipStage;
  reason?: string;
  sessionId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(points);
  const [draftReason, setDraftReason] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const color = stageColor(stage.key);

  const startEdit = () => {
    setDraft(points);
    setDraftReason('');
    setEditing(true);
  };

  const save = () => {
    const clamped = Math.min(100, Math.max(0, Math.round(draft)));
    if (clamped === points) {
      setEditing(false);
      return;
    }
    useTavernStore.getState().updateRelationship(sessionId, aId, bId, {
      set: clamped,
      reason: draftReason.trim() || 'Ajuste manual desde el panel de relaciones',
    }, { aName, bName });
    toast.success(`Relación ${aName} ↔ ${bName}: ${points} → ${clamped}`);
    setEditing(false);
  };

  const quickAdjust = (delta: number) => {
    setDraft(v => Math.min(100, Math.max(0, v + delta)));
  };

  const remove = () => {
    useTavernStore.getState().removeRelationship(sessionId, aId, bId);
    toast.success(`Vínculo ${aName} ↔ ${bName} eliminado`);
    setConfirmDelete(false);
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="p-2 rounded-lg border bg-muted/20 group">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs font-medium truncate">
              {aName}
              <span className="text-muted-foreground"> ↔ </span>
              {bName}
            </span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Badge variant="outline" className={`text-[10px] ${color.badge}`}>
              {stage.label}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={startEdit}
              aria-label={`Editar relación ${aName} ↔ ${bName}`}
            >
              <Pencil className="h-3 w-3" />
            </Button>
          </div>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${points}%`, backgroundColor: color.stroke }}
            />
          </div>
          <span className={`text-[10px] tabular-nums ${color.text}`}>{points}/100</span>
        </div>
        {reason && (
          <p className="text-[10px] text-muted-foreground mt-1 truncate">Último cambio: {reason}</p>
        )}
      </div>
    );
  }

  // ── Edit mode ──
  const draftStage = computeRelationshipStage(draft);
  const draftColor = stageColor(draftStage.key);

  return (
    <div className="p-2.5 rounded-lg border-2 border-primary/40 bg-muted/30 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold truncate">
          {aName}
          <span className="text-muted-foreground"> ↔ </span>
          {bName}
        </span>
        <Badge variant="outline" className={`text-[10px] ${draftColor.badge}`}>
          {draftStage.label}
        </Badge>
      </div>

      {/* Slider + numeric input */}
      <div className="flex items-center gap-2">
        <Slider
          value={[draft]}
          min={0}
          max={100}
          step={1}
          onValueChange={(vals) => setDraft(vals[0] ?? 0)}
          className="flex-1 [&_[data-slot=slider-range]]:bg-current"
          style={{ color: draftColor.stroke }}
          aria-label={`Nivel de relación ${aName} ↔ ${bName}`}
        />
        <Input
          type="number"
          min={0}
          max={100}
          value={draft}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!Number.isNaN(v)) setDraft(Math.min(100, Math.max(0, v)));
          }}
          className="w-16 h-7 text-xs tabular-nums text-center"
          aria-label="Puntos de relación (0-100)"
        />
      </div>

      {/* Quick adjust */}
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-muted-foreground mr-1">Ajuste:</span>
        {[-10, -5, +5, +10].map(d => (
          <Button
            key={d}
            variant="outline"
            size="sm"
            className="h-6 px-1.5 text-[10px] tabular-nums"
            onClick={() => quickAdjust(d)}
          >
            {d > 0 ? `+${d}` : d}
          </Button>
        ))}
        <span className="text-[10px] text-muted-foreground ml-auto">
          {points} → <strong style={{ color: draftColor.stroke }}>{draft}</strong>
        </span>
      </div>

      {/* Reason */}
      <Input
        value={draftReason}
        onChange={(e) => setDraftReason(e.target.value)}
        placeholder="Motivo (opcional)…"
        className="h-7 text-xs"
      />

      {/* Actions */}
      <div className="flex items-center justify-between gap-1.5">
        {confirmDelete ? (
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-destructive">¿Eliminar vínculo?</span>
            <Button variant="destructive" size="sm" className="h-6 px-2 text-[10px]" onClick={remove}>
              Sí, eliminar
            </Button>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => setConfirmDelete(false)}>
              No
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px] text-destructive hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="h-3 w-3 mr-1" /> Eliminar
          </Button>
        )}
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => setEditing(false)}>
            <X className="h-3 w-3 mr-1" /> Cancelar
          </Button>
          <Button size="sm" className="h-6 px-2 text-[10px]" onClick={save} disabled={draft === points}>
            <Check className="h-3 w-3 mr-1" /> Guardar
          </Button>
        </div>
      </div>
    </div>
  );
}

export function RelationshipPanel({ open, onOpenChange, activeSession }: RelationshipPanelProps) {
  const characters = useTavernStore((state) => state.characters);
  const personas = useTavernStore((state) => state.personas);
  const activePersonaId = useTavernStore((state) => state.activePersonaId);

  // ── Create-bond form state ──
  const [showCreate, setShowCreate] = useState(false);
  const [newA, setNewA] = useState<string>('');
  const [newB, setNewB] = useState<string>('');
  const [newPoints, setNewPoints] = useState<number>(DEFAULT_RELATIONSHIP_POINTS);

  const userName = personas.find(p => p.id === activePersonaId)?.name || 'Usuario';
  const sessionId = activeSession?.id || '';

  const graph = useMemo(() => {
    if (!activeSession) return null;
    const stats = (activeSession as { sessionStats?: SessionStats }).sessionStats;
    if (!stats) return null;

    // Nodes: user + session characters (group members or single character)
    let charIds: string[] = [];
    if (activeSession.groupId) {
      const group = useTavernStore.getState().getGroupById?.(activeSession.groupId);
      charIds = (group?.members || []).filter(m => !m.isNarrator).map(m => m.characterId);
    } else if (activeSession.characterId) {
      charIds = [activeSession.characterId];
    }
    // Include any character with stats or bonds in this session
    for (const cid of Object.keys(stats.characterStats || {})) {
      if (cid !== '__user__' && !charIds.includes(cid)) charIds.push(cid);
    }
    const nodes = charIds
      .map(id => characters.find(c => c.id === id))
      .filter((c): c is NonNullable<typeof c> => !!c);

    // Edges: user↔char and char↔char
    interface Edge {
      key: string;
      aId: string; aName: string;
      bId: string; bName: string;
      points: number;
      stage: RelationshipStage;
      reason?: string;
    }
    const edges: Edge[] = [];
    const rels = stats.relationships as Record<string, { points?: number; lastReason?: string }> | undefined;

    for (const char of nodes) {
      const bond = getRelationship(rels, char.id, '__user__');
      const mirror = stats.characterStats?.[char.id]?.attributeValues?.['relacion'];
      const mirrorNum = typeof mirror === 'number' ? mirror : parseFloat(String(mirror ?? '')) || null;
      const points = bond?.points ?? (Number.isFinite(mirrorNum) ? (mirrorNum as number) : null);
      if (points !== null) {
        const stage = bond?.stage ?? RELATIONSHIP_STAGES.find(s => points >= s.min && points <= s.max)!;
        edges.push({
          key: `u-${char.id}`, aId: '__user__', aName: userName,
          bId: char.id, bName: char.name, points,
          stage, reason: rels?.[getRelationshipKey(char.id, '__user__')]?.lastReason,
        });
      }
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const bond = getRelationship(rels, nodes[i].id, nodes[j].id);
        if (bond) {
          edges.push({
            key: `${nodes[i].id}-${nodes[j].id}`,
            aId: nodes[i].id, aName: nodes[i].name,
            bId: nodes[j].id, bName: nodes[j].name,
            points: bond.points, stage: bond.stage,
            reason: rels?.[getRelationshipKey(nodes[i].id, nodes[j].id)]?.lastReason,
          });
        }
      }
    }

    return { nodes, edges, userName, stats };
  }, [activeSession, characters, userName]);

  // Radial layout
  const layout = useMemo(() => {
    if (!graph) return null;
    const W = 360, H = 380, cx = W / 2, cy = H / 2, r = 130;
    const positions = new Map<string, { x: number; y: number }>();
    positions.set('__user__', { x: cx, y: cy });
    graph.nodes.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / Math.max(1, graph.nodes.length) - Math.PI / 2;
      positions.set(node.id, {
        x: cx + r * Math.cos(angle),
        y: cy + r * 0.82 * Math.sin(angle),
      });
    });
    return { W, H, cx, cy, positions };
  }, [graph]);

  const userAvatar = personas.find(p => p.id === activePersonaId)?.avatar;

  // ── Create bond: entity options + available pairs ──
  const entityOptions = useMemo(() => {
    const opts: { id: string; name: string; isUser: boolean }[] = [
      { id: '__user__', name: userName, isUser: true },
    ];
    for (const node of graph?.nodes || []) {
      opts.push({ id: node.id, name: node.name, isUser: false });
    }
    return opts;
  }, [graph, userName]);

  const existingPairKeys = useMemo(
    () => new Set((graph?.edges || []).map(e => getRelationshipKey(e.aId, e.bId))),
    [graph]
  );

  const availablePairs = useMemo(() => {
    const pairs: { a: string; b: string; label: string }[] = [];
    for (let i = 0; i < entityOptions.length; i++) {
      for (let j = i + 1; j < entityOptions.length; j++) {
        const a = entityOptions[i];
        const b = entityOptions[j];
        const key = getRelationshipKey(a.id, b.id);
        if (!existingPairKeys.has(key)) {
          pairs.push({ a: a.id, b: b.id, label: `${a.name} ↔ ${b.name}` });
        }
      }
    }
    return pairs;
  }, [entityOptions, existingPairKeys]);

  const createBond = () => {
    if (!newA || !newB || newA === newB || !sessionId) return;
    const aName = newA === '__user__' ? userName : entityOptions.find(e => e.id === newA)?.name || newA;
    const bName = newB === '__user__' ? userName : entityOptions.find(e => e.id === newB)?.name || newB;
    useTavernStore.getState().updateRelationship(sessionId, newA, newB, {
      set: Math.min(100, Math.max(0, Math.round(newPoints))),
      reason: 'Vínculo creado manualmente',
    }, { aName, bName });
    toast.success(`Vínculo creado: ${aName} ↔ ${bName} (${Math.round(newPoints)}/100)`);
    setShowCreate(false);
    setNewA('');
    setNewB('');
    setNewPoints(DEFAULT_RELATIONSHIP_POINTS);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            💜 Relaciones
            {graph && (
              <span className="text-xs font-normal text-muted-foreground">
                {graph.edges.length} vínculo{graph.edges.length !== 1 ? 's' : ''}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {(!graph || graph.nodes.length === 0) ? (
          <div className="py-6 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              Aún no hay vínculos en esta sesión.
            </p>
            <p className="text-xs text-muted-foreground">
              Se crean con la tool <code>manage_relationship</code>, el token <code>[rel:+10 motivo]</code>,
              al interactuar… o créalos manualmente aquí.
            </p>
            {sessionId && (
              <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Crear vínculo manualmente
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Radial graph */}
            {layout && (
              <svg viewBox={`0 0 ${layout.W} ${layout.H}`} className="w-full select-none" role="img" aria-label="Grafo de relaciones">
                {/* Edges */}
                {graph.edges.map(edge => {
                  const pa = layout.positions.get(edge.aId);
                  const pb = layout.positions.get(edge.bId);
                  if (!pa || !pb) return null;
                  const color = stageColor(edge.stage.key);
                  const midX = (pa.x + pb.x) / 2;
                  const midY = (pa.y + pb.y) / 2;
                  const isUserEdge = edge.aId === '__user__' || edge.bId === '__user__';
                  return (
                    <g key={edge.key}>
                      <line
                        x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                        stroke={color.stroke}
                        strokeWidth={isUserEdge ? 2 + (edge.points / 100) * 3 : 1.5}
                        strokeOpacity={0.75}
                        strokeLinecap="round"
                      />
                      <rect
                        x={midX - 21} y={midY - 9} width={42} height={18} rx={9}
                        fill="hsl(var(--card))" stroke={color.stroke} strokeOpacity={0.5}
                      />
                      <text
                        x={midX} y={midY + 4}
                        textAnchor="middle" fontSize={11}
                        fill={color.stroke} fontWeight={600}
                      >
                        {edge.points}
                      </text>
                    </g>
                  );
                })}

                {/* Character nodes */}
                {graph.nodes.map(node => {
                  const pos = layout.positions.get(node.id);
                  if (!pos) return null;
                  return (
                    <g key={node.id}>
                      <circle cx={pos.x} cy={pos.y} r={22} fill="hsl(var(--card))" stroke="hsl(var(--border))" />
                      {node.avatar ? (
                        <image x={pos.x - 16} y={pos.y - 16} width={32} height={32} href={node.avatar} clipPath="circle()" style={{ clipPath: 'circle(16px)' }} />
                      ) : (
                        <text x={pos.x} y={pos.y + 5} textAnchor="middle" fontSize={14} fill="hsl(var(--muted-foreground))">
                          {initialsOf(node.name)}
                        </text>
                      )}
                      <text x={pos.x} y={pos.y + 36} textAnchor="middle" fontSize={11} fill="hsl(var(--foreground))">
                        {node.name.length > 14 ? node.name.slice(0, 13) + '…' : node.name}
                      </text>
                    </g>
                  );
                })}

                {/* User node (center) */}
                <g>
                  <circle cx={layout.cx} cy={layout.cy} r={26} fill="hsl(var(--primary) / 0.15)" stroke="hsl(var(--primary))" strokeWidth={2} />
                  <text x={layout.cx} y={layout.cy + 6} textAnchor="middle" fontSize={16} fill="hsl(var(--primary))" fontWeight={700}>
                    {initialsOf(graph.userName)}
                  </text>
                  <text x={layout.cx} y={layout.cy + 44} textAnchor="middle" fontSize={11} fontWeight={600} fill="hsl(var(--primary))">
                    {graph.userName}
                  </text>
                </g>
              </svg>
            )}

            {/* Bond list — EDITABLE */}
            <div className="space-y-2 mt-2">
              <div className="flex items-center justify-between">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Vínculos (clic en ✏️ para editar)
                </Label>
                {!showCreate && (
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => setShowCreate(true)}>
                    <Plus className="h-3 w-3 mr-0.5" /> Nuevo
                  </Button>
                )}
              </div>

              {graph.edges
                .slice()
                .sort((a, b) => b.points - a.points)
                .map(edge => (
                  <BondCard
                    key={edge.key}
                    aId={edge.aId}
                    aName={edge.aName}
                    bId={edge.bId}
                    bName={edge.bName}
                    points={edge.points}
                    stage={edge.stage}
                    reason={edge.reason}
                    sessionId={sessionId}
                  />
                ))}
            </div>

            {/* Create bond form */}
            {showCreate && (
              <div className="mt-3 p-3 rounded-lg border-2 border-dashed border-primary/40 space-y-2.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">Nuevo vínculo</Label>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => { setShowCreate(false); setNewA(''); setNewB(''); }}
                    aria-label="Cancelar creación"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>

                {availablePairs.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground py-2 text-center">
                    No quedan pares disponibles: {entityOptions.length < 2
                      ? 'se necesita al menos 1 personaje en la sesión.'
                      : 'todas las combinaciones ya tienen vínculo.'}
                  </p>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <Select value={newA} onValueChange={(v) => { setNewA(v); if (v === newB) setNewB(''); }}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Entidad A…" />
                        </SelectTrigger>
                        <SelectContent>
                          {entityOptions.map(e => (
                            <SelectItem key={e.id} value={e.id} disabled={e.id === newB}>
                              {e.isUser ? `👤 ${e.name}` : e.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex items-center justify-center">
                        <span className="text-[10px] text-muted-foreground">↕</span>
                      </div>
                      <Select value={newB} onValueChange={(v) => { setNewB(v); if (v === newA) setNewA(''); }}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Entidad B…" />
                        </SelectTrigger>
                        <SelectContent>
                          {entityOptions.map(e => (
                            <SelectItem key={e.id} value={e.id} disabled={e.id === newA}>
                              {e.isUser ? `👤 ${e.name}` : e.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Initial points */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-[10px] text-muted-foreground">Nivel inicial</Label>
                        <span className="text-[10px] tabular-nums" style={{ color: stageColor(computeRelationshipStage(newPoints).key).stroke }}>
                          {Math.round(newPoints)} — {computeRelationshipStage(newPoints).label}
                        </span>
                      </div>
                      <Slider
                        value={[newPoints]}
                        min={0}
                        max={100}
                        step={1}
                        onValueChange={(vals) => setNewPoints(vals[0] ?? DEFAULT_RELATIONSHIP_POINTS)}
                        aria-label="Nivel inicial del vínculo"
                      />
                      <p className="text-[9px] text-muted-foreground">
                        Por defecto {DEFAULT_RELATIONSHIP_POINTS}/100 (Conocidos).
                      </p>
                    </div>

                    <Button
                      size="sm"
                      className="w-full h-8 text-xs"
                      disabled={!newA || !newB || newA === newB}
                      onClick={createBond}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" /> Crear vínculo
                    </Button>
                  </>
                )}
              </div>
            )}

            <Separator className="mt-3" />

            {/* Legend */}
            <div className="flex flex-wrap gap-1.5 pt-1 pb-1">
              {RELATIONSHIP_STAGES.map(stage => {
                const color = stageColor(stage.key);
                return (
                  <Badge key={stage.key} variant="outline" className={`text-[9px] ${color.badge}`}>
                    {stage.min}-{stage.max} {stage.label}
                  </Badge>
                );
              })}
              <Badge variant="outline" className="text-[9px] bg-muted/30 text-muted-foreground border-border">
                <Undo2 className="h-2.5 w-2.5 mr-0.5" /> Nuevos: {DEFAULT_RELATIONSHIP_POINTS}/100
              </Badge>
            </div>
          </>
        )}

        {userAvatar && !graph && (
          <span className="sr-only">{userAvatar}</span>
        )}
      </DialogContent>
    </Dialog>
  );
}
