'use client';

// ============================================
// Relationship Panel — visual bond graph
// ============================================
//
// Shows the relationships of the active session as a radial SVG graph:
// the user (persona) at the center, characters around it, and edges
// labeled with bond points (0-100) and stage. Includes character↔character
// bonds (group chats) and a legend. Read-only view of the live data in
// SessionStats.relationships (updated by tools, text tokens or rules).

import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useTavernStore } from '@/store';
import type { ChatSession, SessionStats } from '@/types';
import {
  RELATIONSHIP_STAGES,
  getRelationship,
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

export function RelationshipPanel({ open, onOpenChange, activeSession }: RelationshipPanelProps) {
  const characters = useTavernStore((state) => state.characters);
  const personas = useTavernStore((state) => state.personas);
  const activePersonaId = useTavernStore((state) => state.activePersonaId);

  const graph = useMemo(() => {
    if (!activeSession) return null;
    const stats = (activeSession as { sessionStats?: SessionStats }).sessionStats;
    if (!stats) return null;

    const userName = personas.find(p => p.id === activePersonaId)?.name || 'Usuario';

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
  }, [activeSession, characters, personas, activePersonaId]);

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

        {!graph || graph.nodes.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            Aún no hay vínculos en esta sesión.
            <br />
            <span className="text-xs">
              Se crean con la tool <code>manage_relationship</code>, el token <code>[rel:+10 motivo]</code> o al interactuar.
            </span>
          </p>
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

            {/* Bond list */}
            <div className="space-y-2 mt-2">
              {graph.edges
                .slice()
                .sort((a, b) => b.points - a.points)
                .map(edge => {
                  const color = stageColor(edge.stage.key);
                  const progress = edge.points;
                  return (
                    <div key={edge.key} className="p-2 rounded-lg border bg-muted/20">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-xs font-medium truncate">
                            {edge.aId === '__user__' ? graph.userName : edge.aName}
                            <span className="text-muted-foreground"> ↔ </span>
                            {edge.bId === '__user__' ? graph.userName : edge.bName}
                          </span>
                        </div>
                        <Badge variant="outline" className={`text-[10px] shrink-0 ${color.badge}`}>
                          {edge.stage.label}
                        </Badge>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${progress}%`, backgroundColor: color.stroke }}
                          />
                        </div>
                        <span className={`text-[10px] tabular-nums ${color.text}`}>{progress}/100</span>
                      </div>
                      {edge.reason && (
                        <p className="text-[10px] text-muted-foreground mt-1 truncate">Último cambio: {edge.reason}</p>
                      )}
                    </div>
                  );
                })}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {RELATIONSHIP_STAGES.map(stage => {
                const color = stageColor(stage.key);
                return (
                  <Badge key={stage.key} variant="outline" className={`text-[9px] ${color.badge}`}>
                    {stage.min}-{stage.max} {stage.label}
                  </Badge>
                );
              })}
              <Badge variant="outline" className="text-[9px] bg-muted/30 text-muted-foreground border-border">
                Nuevos: {DEFAULT_RELATIONSHIP_POINTS}/100
              </Badge>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Local import helper to avoid circular import concerns in getRelationship key building
function getRelationshipKey(aId: string, bId: string): string {
  return [aId, bId].sort().join('|');
}
