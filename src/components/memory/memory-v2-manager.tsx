'use client';

/**
 * MemoryV2Manager — gestión completa de la Memoria V2 de un personaje.
 *
 * Permite:
 *   - Ver todos los registros (agrupados por tipo, con filtros)
 *   - Crear recuerdos manuales (source=curada → SIEMPRE entran al prompt)
 *   - Editar recuerdos existentes (re-embed automático)
 *   - Archivar (historial conservado) o eliminar definitivamente
 *   - Buscar (simula la recuperación real con reranking)
 *   - Ver el estado del backend (LanceDB / JSON fallback / Ollama)
 *
 * Incluye documentación integrada para que el usuario entienda cómo
 * funciona la memoria y qué verá el LLM de cada tipo de registro.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  DatabaseZap,
  HelpCircle,
  Loader2,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Archive,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

// ============ Tipos (solo tipos — seguro en cliente) ============

type V2Type = 'evento' | 'hecho' | 'preferencia' | 'relacion' | 'nota' | 'resumen_escena';

interface V2Record {
  id: string;
  type: V2Type;
  content: string;
  subject: string;
  charId: string;
  groupId: string;
  sessionId: string;
  source: 'auto' | 'curada';
  importance: number;
  heat: number;
  eventDate: string;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
  accessCount: number;
  linkedIds: string[];
  supersededBy: string;
}

interface V2HealthData {
  backend: 'lancedb' | 'json';
  model: string;
  dimension: number;
  counts: { total: number; active: number; superseded: number; byType: Record<string, number> };
  ollama?: { reachable: boolean; model: string; contextLength?: number };
  error?: string;
}

// ============ Metadatos de tipos ============

const TYPE_META: Record<V2Type, { label: string; plural: string; dot: string; block: string; help: string }> = {
  evento: {
    label: 'Evento', plural: 'Eventos', dot: 'bg-purple-500',
    block: '[EVENTOS ANTERIORES]',
    help: 'Algo que PASÓ en la historia (una cita, una promesa, una pelea, la primera vez que…). Se inyecta con su fecha absoluta.',
  },
  hecho: {
    label: 'Hecho', plural: 'Hechos', dot: 'bg-emerald-500',
    block: '[HECHOS SOBRE {user}]',
    help: 'Dato estable sobre el usuario o el mundo (trabajo, nombre, familia, límites duros). El LLM lo da por sabido.',
  },
  preferencia: {
    label: 'Preferencia', plural: 'Preferencias', dot: 'bg-amber-500',
    block: '[HECHOS SOBRE {user}]',
    help: 'Gustos, límites o deseos del usuario respecto al rol (ej: "prefiere roles lentos con tensión").',
  },
  relacion: {
    label: 'Relación', plural: 'Relación', dot: 'bg-rose-500',
    block: '[ESTADO DE LA RELACIÓN]',
    help: 'Cómo se siente el personaje hacia el usuario y la dinámica entre ambos (confianza, deseo, celos, tensión).',
  },
  nota: {
    label: 'Nota', plural: 'Notas', dot: 'bg-slate-400',
    block: '[HECHOS SOBRE {user}]',
    help: 'Nota libre curada. Úsala para fijar cualquier detalle que quieras que el personaje siempre sepa.',
  },
  resumen_escena: {
    label: 'Resumen de escena', plural: 'Resúmenes de escena', dot: 'bg-cyan-500',
    block: '[EVENTOS ANTERIORES]',
    help: 'Compresión episódica de una escena completa (lo genera la consolidación). Se inyecta como evento con fecha.',
  },
};

const ALL_TYPES: V2Type[] = ['evento', 'hecho', 'preferencia', 'relacion', 'nota', 'resumen_escena'];

function fmtDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ============ Componente ============

export interface MemoryV2ManagerProps {
  /** Personaje propietario de los recuerdos. Opcional en modo grupo. */
  charId?: string;
  /** Grupo: lista TODOS los recuerdos extraídos en ese chat grupal (todos los miembros)
   *  y permite crear recuerdos group-wide (visibles para todos los personajes del grupo). */
  groupId?: string;
  charName: string;
  userName?: string;
  /** Modo compacto (chatbox): sin documentación ni panel de búsqueda */
  compact?: boolean;
  /** Cambia → recarga los registros (ej: tras una extracción) */
  refreshSignal?: number;
  /** Notifica el nº de registros activos (para badges externos) */
  onCountChange?: (n: number) => void;
  className?: string;
}

interface RecordFormState {
  id: string;              // '' = crear
  type: V2Type;
  content: string;
  importance: number;
  eventDate: string;       // YYYY-MM-DD
  subject: string;
}

const EMPTY_FORM: RecordFormState = {
  id: '',
  type: 'evento',
  content: '',
  importance: 0.6,
  eventDate: '',
  subject: 'pareja',
};

export function MemoryV2Manager({
  charId,
  groupId,
  charName,
  userName = 'el usuario',
  compact = false,
  refreshSignal,
  onCountChange,
  className,
}: MemoryV2ManagerProps) {
  const { toast } = useToast();
  const isGroupScope = !charId && !!groupId;

  const [records, setRecords] = useState<V2Record[]>([]);
  const [health, setHealth] = useState<V2HealthData | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Filtros
  const [typeFilter, setTypeFilter] = useState<'todos' | V2Type>('todos');
  const [sourceFilter, setSourceFilter] = useState<'todas' | 'curada' | 'auto'>('todas');
  const [showArchived, setShowArchived] = useState(false);
  const [expandedTypes, setExpandedTypes] = useState<Record<string, boolean>>({});

  // Diálogos
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<RecordFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [pendingHardDelete, setPendingHardDelete] = useState<V2Record | null>(null);

  // Búsqueda debug
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [searching, setSearching] = useState(false);
  // Error de carga (null = OK) — distinto de "store vacío"
  const [loadError, setLoadError] = useState<string | null>(null);

  // ============ Data ============

  const load = useCallback(async () => {
    if (!charId && !groupId) return;
    const scopeQuery = charId
      ? `charId=${encodeURIComponent(charId)}`
      : `groupId=${encodeURIComponent(groupId!)}`;
    setLoading(true);
    try {
      const [recRes, healthRes] = await Promise.all([
        fetch(`/api/memory/v2?action=records&${scopeQuery}&limit=300&includeArchived=${showArchived ? 1 : 0}`),
        fetch('/api/memory/v2?action=health'),
      ]);
      const recData = await recRes.json();
      const healthData = await healthRes.json();
      if (recData.success) {
        setRecords(recData.records || []);
        onCountChange?.(recData.total ?? recData.records?.length ?? 0);
        setLoadError(null);
      } else {
        // Distinguish a failed fetch from a genuinely empty store — showing
        // the "sin recuerdos" hint on an error looks like data loss.
        setLoadError(recData.error || 'No se pudieron cargar los recuerdos');
      }
      if (healthData.success) setHealth(healthData.health);
    } catch (err: any) {
      setLoadError(err?.message || 'Error de red al cargar los recuerdos');
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  }, [charId, groupId, showArchived, onCountChange]);

  useEffect(() => { load(); }, [load]);

  // Reload only when the parent bumps the signal (not on every load identity change)
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (refreshSignal !== undefined && refreshSignal > 0) loadRef.current();
  }, [refreshSignal]);

  // ============ Filtros (cliente) ============

  const filtered = useMemo(() => {
    return records.filter(r => {
      if (typeFilter !== 'todos' && r.type !== typeFilter) return false;
      if (sourceFilter !== 'todas' && r.source !== sourceFilter) return false;
      return true;
    });
  }, [records, typeFilter, sourceFilter]);

  const grouped = useMemo(() => {
    const g: Record<string, V2Record[]> = {};
    for (const r of filtered) (g[r.type] ||= []).push(r);
    // ordenar dentro de cada grupo: curada primero, luego fecha desc
    for (const t of Object.keys(g)) {
      g[t].sort((a, b) => {
        if (a.source !== b.source) return a.source === 'curada' ? -1 : 1;
        return (b.eventDate || b.createdAt || '').localeCompare(a.eventDate || a.createdAt || '');
      });
    }
    return g;
  }, [filtered]);

  const activeCount = records.filter(r => !r.supersededBy).length;
  const archivedCount = records.length - activeCount;

  // ============ Acciones ============

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, eventDate: new Date().toISOString().slice(0, 10) });
    setFormOpen(true);
  };

  const openEdit = (r: V2Record) => {
    setForm({
      id: r.id,
      type: r.type,
      content: r.content,
      importance: r.importance,
      eventDate: (r.eventDate || '').slice(0, 10),
      subject: r.subject || 'pareja',
    });
    setFormOpen(true);
  };

  const saveForm = async () => {
    if (!form.content.trim()) {
      toast({ title: 'Falta el contenido', description: 'Escribe el texto del recuerdo.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const url = '/api/memory/v2';
      const payload = form.id
        ? { action: 'edit', id: form.id, content: form.content, type: form.type, importance: form.importance, eventDate: form.eventDate, subject: form.subject }
        : isGroupScope
          ? { action: 'add', groupId, type: form.type, content: form.content, importance: form.importance, eventDate: form.eventDate, subject: form.subject }
          : { action: 'add', charId, type: form.type, content: form.content, importance: form.importance, eventDate: form.eventDate, subject: form.subject };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Error al guardar');
      toast({
        title: form.id ? 'Recuerdo actualizado' : 'Recuerdo creado',
        description: form.id
          ? 'El vector se regeneró con el nuevo texto.'
          : 'Se guardó como recuerdo fijado: SIEMPRE entrará en el prompt.',
      });
      setFormOpen(false);
      load();
    } catch (err: any) {
      toast({ title: 'Error al guardar', description: err?.message || String(err), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const archiveRecord = async (r: V2Record) => {
    try {
      const res = await fetch('/api/memory/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'supersede', id: r.id }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Error');
      toast({ title: 'Recuerdo archivado', description: 'Ya no se inyecta. Queda en el historial (activa "Ver archivados").' });
      load();
    } catch (err: any) {
      toast({ title: 'Error al archivar', description: err?.message || String(err), variant: 'destructive' });
    }
  };

  const hardDelete = async (r: V2Record) => {
    try {
      const res = await fetch('/api/memory/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'hard-delete', id: r.id }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Error');
      toast({ title: 'Recuerdo eliminado', description: 'Eliminado definitivamente del almacén.' });
      setPendingHardDelete(null);
      load();
    } catch (err: any) {
      toast({ title: 'Error al eliminar', description: err?.message || String(err), variant: 'destructive' });
    }
  };

  const runSearch = async () => {
    if (!searchQuery.trim() || (!charId && !groupId)) return;
    setSearching(true);
    setSearchResults(null);
    try {
      const scopeQuery = charId
        ? `charId=${encodeURIComponent(charId)}`
        : `groupId=${encodeURIComponent(groupId!)}`;
      const res = await fetch(`/api/memory/v2?action=search&${scopeQuery}&query=${encodeURIComponent(searchQuery)}&limit=10`);
      const data = await res.json();
      if (data.success) setSearchResults(data.results || []);
      else throw new Error(data.error);
    } catch (err: any) {
      toast({ title: 'Error en la búsqueda', description: err?.message || String(err), variant: 'destructive' });
    } finally {
      setSearching(false);
    }
  };

  // ============ Render helpers ============

  const backendBadge = () => {
    if (!health) return null;
    if (health.backend === 'lancedb') {
      return <Badge variant="outline" className="text-[9px] font-normal">LanceDB · {health.dimension}d</Badge>;
    }
    return (
      <Badge variant="outline" className="text-[9px] font-normal text-amber-600 dark:text-amber-400">
        JSON fallback{health.ollama?.reachable === false ? ' · sin Ollama' : ''}
      </Badge>
    );
  };

  const renderRecord = (r: V2Record) => {
    const meta = TYPE_META[r.type];
    return (
      <div key={r.id} className={cn('group rounded-md bg-white/5 p-2', r.supersededBy && 'opacity-50')}>
        <div className="flex items-center gap-1.5 mb-0.5">
          {r.source === 'curada' ? (
            <Badge variant="secondary" className="text-[9px] px-1 py-0 gap-0.5">
              <Pin className="w-2 h-2" /> fijado
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[9px] px-1 py-0 font-normal">auto</Badge>
          )}
          {r.supersededBy && (
            <Badge variant="outline" className="text-[9px] px-1 py-0 font-normal">
              {r.supersededBy === '__deleted__' ? 'eliminado' : 'reemplazado'}
            </Badge>
          )}
          <span className="text-[9px] text-muted-foreground inline-flex items-center gap-0.5">
            <CalendarDays className="w-2.5 h-2.5" /> {fmtDate(r.eventDate || r.createdAt)}
          </span>
          <span className="text-[9px] text-muted-foreground" title="Importancia">★ {(r.importance ?? 0).toFixed(1)}</span>
          <span className="text-[9px] text-muted-foreground" title="Accesos / calor">🔥 {r.heat?.toFixed?.(0) ?? r.heat}</span>
          <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {!r.supersededBy && (
              <>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Editar" onClick={() => openEdit(r)}>
                  <Pencil className="w-3 h-3" />
                </Button>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="Archivar (deja de inyectarse, se conserva en historial)" onClick={() => archiveRecord(r)}>
                  <Archive className="w-3 h-3" />
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-500 hover:text-red-600" title="Eliminar definitivamente" onClick={() => setPendingHardDelete(r)}>
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>
        <p className={cn('text-xs text-foreground/90', r.supersededBy && 'line-through decoration-muted-foreground/50')}>{r.content}</p>
        {r.supersededBy && r.supersededBy !== '__deleted__' && (
          <p className="text-[9px] text-muted-foreground mt-0.5">→ reemplazado por {r.supersededBy}</p>
        )}
        {!compact && meta && (
          <p className="text-[9px] text-muted-foreground/70 mt-1">{meta.block}</p>
        )}
      </div>
    );
  };

  const recordsList = (
    <div className="space-y-2">
      {loading && !initialized ? (
        <div className="flex items-center justify-center py-4 text-muted-foreground text-xs">
          <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Cargando recuerdos…
        </div>
      ) : loadError ? (
        <div className="flex flex-col items-start gap-1.5 py-1">
          <p className="text-xs text-destructive flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" /> Error al cargar recuerdos: {loadError}
          </p>
          <button
            className="text-[10px] underline text-muted-foreground hover:text-foreground"
            onClick={() => load()}
          >
            Reintentar
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {records.length === 0
            ? 'Sin recuerdos todavía. Se crean automáticamente al chatear (extracción) o manualmente con "+ Agregar".'
            : 'Ningún recuerdo coincide con los filtros actuales.'}
        </p>
      ) : (
        <div className={cn('space-y-2 overflow-y-auto custom-scrollbar', compact ? 'max-h-96' : 'max-h-[420px]')}>
          {ALL_TYPES.filter(t => grouped[t]?.length).map(t => {
            const meta = TYPE_META[t];
            const isExpanded = expandedTypes[t] !== false; // default open
            return (
              <div key={t} className="space-y-1">
                <button
                  className="flex items-center gap-1.5 px-1 py-0.5 w-full text-left hover:opacity-80"
                  onClick={() => setExpandedTypes(prev => ({ ...prev, [t]: !isExpanded }))}
                >
                  {isExpanded ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                  <div className={cn('w-1.5 h-1.5 rounded-full', meta.dot)} />
                  <span className="text-xs font-medium">{meta.plural}</span>
                  <span className="text-xs text-muted-foreground">({grouped[t].length})</span>
                </button>
                {isExpanded && grouped[t].map(renderRecord)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const searchPanel = !compact && (
    <div className="space-y-1.5 pt-1 border-t border-border/40">
      <Label className="text-xs text-muted-foreground">Simular recuperación (con reranking real)</Label>
      <div className="flex gap-1.5">
        <Input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') runSearch(); }}
          placeholder={`Ej: ¿qué sientes hacia ${userName}? · ¿recuerdas aquella noche?`}
          className="h-8 text-xs"
        />
        <Button size="sm" variant="outline" className="h-8 px-2.5" onClick={runSearch} disabled={searching || !searchQuery.trim()}>
          {searching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
        </Button>
      </div>
      {searchResults && (
        <div className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar pt-1">
          {searchResults.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sin resultados relevantes (el LLM admitiría no recordar).</p>
          ) : (
            searchResults.map((r: any) => (
              <div key={r.id} className="rounded bg-white/5 p-1.5 flex items-start gap-2">
                <Badge variant="outline" className="text-[9px] px-1 py-0 font-mono shrink-0">{(r.score ?? 0).toFixed(2)}</Badge>
                <div className="min-w-0">
                  <p className="text-xs text-foreground/90">{r.content}</p>
                  <p className="text-[9px] text-muted-foreground">{TYPE_META[r.type as V2Type]?.label} · cos {r.cosine?.toFixed?.(2)}</p>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );

  const docsSection = !compact && (
    <Accordion type="single" collapsible className="pt-1 border-t border-border/40">
      <AccordionItem value="docs" className="border-0">
        <AccordionTrigger className="text-xs py-2 hover:no-underline">
          <span className="inline-flex items-center gap-1.5">
            <HelpCircle className="w-3.5 h-3.5 text-violet-400" />
            ¿Cómo funciona la Memoria V2?
          </span>
        </AccordionTrigger>
        <AccordionContent className="text-xs text-muted-foreground space-y-3 pt-1">
          <div>
            <p className="font-medium text-foreground">Qué es</p>
            <p>
              Una única memoria a largo plazo por personaje. Cada recuerdo es un registro con tipo, fecha absoluta,
              importancia y origen. Al chatear, el sistema inyecta al LLM tres bloques organizados:
            </p>
            <ul className="list-disc ml-4 mt-1 space-y-0.5">
              <li><span className="font-mono text-[10px] text-foreground">[HECHOS SOBRE {userName}]</span> — hechos, preferencias y notas.</li>
              <li><span className="font-mono text-[10px] text-foreground">[EVENTOS ANTERIORES]</span> — eventos y resúmenes de escena, con su fecha.</li>
              <li><span className="font-mono text-[10px] text-foreground">[ESTADO DE LA RELACIÓN]</span> — el vínculo emocional actual.</li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-foreground">Recuerdos fijados vs automáticos</p>
            <p>
              <span className="text-foreground">Fijados (curada)</span>: los que creas/editas aquí. Siempre entran al prompt,
              nunca decaen ni se suprimen. <span className="text-foreground">Automáticos</span>: los extrae el LLM mientras
              chateas (eventos, hechos, cambios de relación) y se recuperan por relevancia cuando algo del mensaje
              del usuario los conecta (búsqueda vectorial + reranking con fecha, importancia y calor).
            </p>
          </div>
          <div>
            <p className="font-medium text-foreground">Cómo escribir un buen recuerdo</p>
            <ul className="list-disc ml-4 mt-1 space-y-0.5">
              <li>En 3ª persona y con los nombres reales: «Aitana besó a Marcos…», nunca «el usuario».</li>
              <li>Autocontenido: alguien que no lea el chat debe entenderlo.</li>
              <li>Con fecha real del evento (hoy por defecto). El LLM la usa para situarse en el tiempo.</li>
              <li>Importancia: 0.9-1 promesas/límites/confesiones · 0.6-0.8 eventos significativos · 0.3-0.5 detalles.</li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-foreground">Archivar vs eliminar</p>
            <p>
              <span className="text-foreground">Archivar</span> quita el recuerdo del prompt pero conserva el historial
              (puedes verlo con «Archivados»). <span className="text-foreground">Eliminar</span> lo borra para siempre.
              La extracción automática también archiva cuando el personaje «actualiza» un recuerdo, dejando trazabilidad.
            </p>
          </div>
          <div>
            <p className="font-medium text-foreground">¿Y los Resúmenes y el Conocimiento?</p>
            <p>
              Los <span className="text-foreground">Resúmenes</span> comprimen mensajes antiguos para que el contexto no
              crezca (ahorro de tokens): son independientes de la memoria semántica. El{' '}
              <span className="text-foreground">Conocimiento</span> (archivos que subes para RAG) se indexa en la misma
              base vectorial y entra al prompt como [CONTEXTO RELEVANTE]. Esta tienda (Memoria V2) es el ÚNICO
              sistema de recuerdos del personaje: no existe memoria clásica paralela.
            </p>
          </div>
          {health?.error && (
            <div className="rounded bg-amber-500/10 border border-amber-500/30 p-2">
              <p className="text-amber-600 dark:text-amber-400 text-[11px]">
                Estado: {health.error}. Los recuerdos se guardan en JSON y la búsqueda usa coincidencia léxica;
                al conectar Ollama se migran a vectores automáticamente.
              </p>
            </div>
          )}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );

  const body = (
    <div className="space-y-2">
      {/* Toolbar: filtros */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Select value={typeFilter} onValueChange={v => setTypeFilter(v as 'todos' | V2Type)}>
          <SelectTrigger className="h-7 w-[150px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los tipos</SelectItem>
            {ALL_TYPES.map(t => <SelectItem key={t} value={t}>{TYPE_META[t].plural}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={v => setSourceFilter(v as 'todas' | 'curada' | 'auto')}>
          <SelectTrigger className="h-7 w-[130px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Fijados + auto</SelectItem>
            <SelectItem value="curada">Solo fijados</SelectItem>
            <SelectItem value="auto">Solo automáticos</SelectItem>
          </SelectContent>
        </Select>
        {!compact && (
          <div className="flex items-center gap-1.5">
            <Switch id={`arch-${charId || groupId || 'mgr'}`} checked={showArchived} onCheckedChange={setShowArchived} className="scale-90" />
            <Label htmlFor={`arch-${charId || groupId || 'mgr'}`} className="text-xs text-muted-foreground cursor-pointer">
              Archivados{archivedCount > 0 ? ` (${archivedCount})` : ''}
            </Label>
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Recargar" onClick={load} disabled={loading}>
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          </Button>
          <Button size="sm" className="h-7 gap-1 text-xs" onClick={openCreate}>
            <Plus className="w-3.5 h-3.5" /> Agregar
          </Button>
        </div>
      </div>

      {recordsList}
      {searchPanel}
      {docsSection}
    </div>
  );

  return (
    <div className={className}>
      {!compact ? (
        <Card className="border-violet-500/20">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <DatabaseZap className="w-4 h-4 text-violet-500" />
              <CardTitle className="text-sm">{isGroupScope ? `Memoria del grupo · ${charName}` : `Memoria de ${charName}`}</CardTitle>
              <Badge variant="secondary" className="text-xs">{activeCount} activos</Badge>
              {backendBadge()}
              {health?.model && (
                <span className="text-[9px] text-muted-foreground">{health.model}</span>
              )}
            </div>
          </CardHeader>
          <CardContent>{body}</CardContent>
        </Card>
      ) : (
        body
      )}

      {/* Dialogo crear/editar */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">{form.id ? 'Editar recuerdo' : 'Nuevo recuerdo'}</DialogTitle>
            <DialogDescription className="text-xs">
              {form.id
                ? 'El cambio se guarda en el mismo registro y el vector se regenera.'
                : 'Se creará como recuerdo FIJADO: siempre se inyecta en el prompt y nunca decae.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Tipo</Label>
                <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v as V2Type }))}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ALL_TYPES.map(t => <SelectItem key={t} value={t}>{TYPE_META[t].label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Fecha del evento</Label>
                <Input
                  type="date"
                  value={form.eventDate}
                  onChange={e => setForm(f => ({ ...f, eventDate: e.target.value }))}
                  className="h-8 text-xs"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Recuerdo</Label>
              <Textarea
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
                placeholder={isGroupScope
                  ? `Ej: El grupo acordó viajar a la capital al amanecer`
                  : `Ej: ${charName} prometió a ${userName} no volver a mentirle después de lo del bar`}
                className="text-xs min-h-[80px] resize-y"
                maxLength={480}
              />
              <p className="text-[10px] text-muted-foreground">
                {isGroupScope ? 'Recuerdo GRUPAL: lo verán todos los personajes del grupo. ' : ''}
                {TYPE_META[form.type]?.help} · {form.content.length}/480
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Importancia</Label>
                <span className="text-xs text-muted-foreground">{form.importance.toFixed(1)}</span>
              </div>
              <Slider
                value={[form.importance]}
                onValueChange={([v]) => setForm(f => ({ ...f, importance: v }))}
                min={0}
                max={1}
                step={0.1}
              />
              <div className="flex justify-between text-[9px] text-muted-foreground">
                <span>detalle menor</span><span>evento normal</span><span>crítico</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setFormOpen(false)} disabled={saving}>Cancelar</Button>
            <Button size="sm" onClick={saveForm} disabled={saving || !form.content.trim()}>
              {saving && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
              {form.id ? 'Guardar cambios' : 'Crear recuerdo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmación de borrado definitivo */}
      <AlertDialog open={!!pendingHardDelete} onOpenChange={o => !o && setPendingHardDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base">¿Eliminar definitivamente?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              Este recuerdo se borrará del almacén sin dejar historial:
              «{pendingHardDelete?.content?.slice(0, 120)}».
              Si prefieres conservarlo fuera del prompt, usa Archivar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-xs">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white text-xs"
              onClick={() => pendingHardDelete && hardDelete(pendingHardDelete)}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default MemoryV2Manager;
