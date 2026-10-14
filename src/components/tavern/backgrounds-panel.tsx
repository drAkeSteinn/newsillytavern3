'use client';

// ============================================
// Backgrounds Panel — Ajustes → Fondos (Task 16-c)
// ============================================
// Panel integrado (no modal) con 4 pestañas internas:
//   - Galería:      explorar y aplicar fondos por colección (+ ajuste de encaje)
//   - Subir:        selector de colección destino + dropzone + cola de subida
//   - Colecciones:  CRUD de colecciones, metadatos y claves por archivo
//   - Activación:   packs de triggers en runtime (BackgroundTriggersSettings)
//
// APIs usadas (NO modificar):
//   GET    /api/backgrounds/collections
//   POST   /api/backgrounds/collections  { action:'create', name, description }
//   PUT    /api/backgrounds/collections  { folderName, name/newName, description, entries, transitionDuration, newFolderName }
//   DELETE /api/backgrounds/collections?folderName=X[&filename=Y]
//   POST   /api/upload  FormData { file, type:'background', collection:<folder> }
//
// Nota: `name` es el nombre visible; la CARPETA = path.split('/').pop()
// (las APIs de subir/borrar esperan el nombre de la carpeta).

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  Key,
  Loader2,
  Maximize,
  Move,
  Plus,
  RefreshCw,
  Search,
  Shrink,
  Tag,
  Trash2,
  Upload,
  Video,
  X,
  Zap,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTavernStore } from '@/store/tavern-store';
import type {
  BackgroundCollection,
  BackgroundCollectionEntry,
  BackgroundFile,
  BackgroundFit,
} from '@/types';
import { BackgroundTriggersSettings } from './background-triggers-settings';

// ============================================
// Helpers
// ============================================

const VIDEO_URL_RE = /\.(mp4|webm|mov|avi|mkv|ogv)$/i;
const NEW_COLLECTION_VALUE = '__nueva_coleccion__';

/** Nombre de la carpeta física de una colección (lo que esperan las APIs). */
function folderOf(collection: BackgroundCollection): string {
  return collection.path.split('/').pop() || collection.name;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function genId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // fallback manual
  }
  return `bg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Copia la colección garantizando una entry por archivo (patrón syncEntriesWithFiles). */
function withSyncedEntries(collection: BackgroundCollection): BackgroundCollection {
  const entries: BackgroundCollectionEntry[] = [...collection.entries];
  const known = new Set(entries.map((e) => e.url));
  for (const file of collection.files) {
    if (!known.has(file.url)) {
      entries.push({
        id: genId(),
        name: file.name.replace(/\.[^.]+$/, ''),
        url: file.url,
        triggerKeys: [],
        contextKeys: [],
        tags: file.type === 'video' ? ['video'] : [],
      });
    }
  }
  return { ...collection, entries };
}

/** Ejecuta `worker` sobre `items` con un máximo de `limit` tareas en paralelo. */
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let index = 0;
  const count = Math.min(limit, items.length);
  const runners: Promise<void>[] = [];
  for (let i = 0; i < count; i += 1) {
    runners.push(
      (async () => {
        while (index < items.length) {
          const item = items[index];
          index += 1;
          if (item !== undefined) await worker(item);
        }
      })()
    );
  }
  await Promise.all(runners);
}

// ============================================
// Tipos locales
// ============================================

interface UploadQueueItem {
  id: string;
  file: File;
  name: string;
  size: number;
  status: 'pending' | 'uploading' | 'success' | 'error';
  url?: string;
  error?: string;
}

interface SharedDataProps {
  collections: BackgroundCollection[];
  isLoading: boolean;
  loadError: string | null;
  onReload: () => Promise<BackgroundCollection[]>;
}

const fitModes: { value: BackgroundFit; label: string; icon: typeof Maximize; description: string }[] = [
  { value: 'cover', label: 'Cover', icon: Maximize, description: 'Rellenar área, puede recortar' },
  { value: 'contain', label: 'Ajustar', icon: Shrink, description: 'Mostrar imagen completa' },
  { value: 'stretch', label: 'Estirar', icon: Move, description: 'Estirar para rellenar' },
];

// ============================================
// Componente raíz del panel
// ============================================

export function BackgroundsPanel() {
  const [collections, setCollections] = useState<BackgroundCollection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Estado de la pestaña Colecciones, elevado aquí para que los cambios
  // sin guardar sobrevivan al cambio de pestaña.
  const [mgmtFolder, setMgmtFolder] = useState<string | null>(null);
  const [mgmtDraft, setMgmtDraft] = useState<BackgroundCollection | null>(null);
  const [mgmtDirty, setMgmtDirty] = useState(false);
  const mgmtFolderRef = useRef<string | null>(null);
  const mgmtDirtyRef = useRef(false);

  const fetchCollections = useCallback(async (): Promise<BackgroundCollection[]> => {
    // Sin setState síncrono antes del primer await (react-hooks/set-state-in-effect)
    try {
      const response = await fetch('/api/backgrounds/collections');
      if (!response.ok) {
        throw new Error(`Error HTTP ${response.status}`);
      }
      const data = await response.json();
      const list: BackgroundCollection[] = Array.isArray(data?.collections) ? data.collections : [];
      setCollections(list);
      setLoadError(null);
      return list;
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'No se pudieron cargar las colecciones');
      return [];
    }
  }, []);

  // Carga inicial: todos los setState ocurren tras el primer await
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await fetchCollections();
      if (!cancelled) setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchCollections]);

  // Recarga manual / tras mutaciones (siempre desde handlers de eventos)
  const refresh = useCallback(async (): Promise<BackgroundCollection[]> => {
    setIsLoading(true);
    try {
      const list = await fetchCollections();
      // Si el borrador de Colecciones está limpio, sincronízalo con los datos frescos
      setMgmtDraft((prev) => {
        if (!prev || mgmtDirtyRef.current) return prev;
        const fresh = mgmtFolderRef.current
          ? list.find((c) => folderOf(c) === mgmtFolderRef.current)
          : undefined;
        return fresh ? withSyncedEntries(fresh) : prev;
      });
      return list;
    } finally {
      setIsLoading(false);
    }
  }, [fetchCollections]);

  const selectMgmtFolder = useCallback((folder: string | null) => {
    mgmtFolderRef.current = folder;
    setMgmtFolder(folder);
  }, []);

  /** Edita el borrador marcándolo como sucio (requiere "Guardar cambios"). */
  const updateMgmtDraft = useCallback(
    (updater: (prev: BackgroundCollection) => BackgroundCollection) => {
      mgmtDirtyRef.current = true;
      setMgmtDirty(true);
      setMgmtDraft((prev) => (prev ? updater(prev) : prev));
    },
    []
  );

  /** Parchea el borrador SIN marcarlo sucio (p. ej. borrados ya persistidos). */
  const patchMgmtDraft = useCallback(
    (updater: (prev: BackgroundCollection) => BackgroundCollection) => {
      setMgmtDraft((prev) => (prev ? updater(prev) : prev));
    },
    []
  );

  /** Reinicia el borrador con datos del servidor (o lo limpia). */
  const resetMgmtDraft = useCallback((collection: BackgroundCollection | null) => {
    mgmtDirtyRef.current = false;
    setMgmtDirty(false);
    setMgmtDraft(collection ? withSyncedEntries(collection) : null);
  }, []);

  return (
    <Tabs defaultValue="galeria" className="h-full min-h-0 flex flex-col gap-3">
      {/* Encabezado de pestañas */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <TabsList className="h-10 max-w-full flex-nowrap overflow-x-auto">
          <TabsTrigger value="galeria" className="gap-1.5 px-3">
            <ImageIcon className="w-4 h-4" />
            Galería
          </TabsTrigger>
          <TabsTrigger value="subir" className="gap-1.5 px-3">
            <Upload className="w-4 h-4" />
            Subir
          </TabsTrigger>
          <TabsTrigger value="colecciones" className="gap-1.5 px-3">
            <FolderOpen className="w-4 h-4" />
            Colecciones
          </TabsTrigger>
          <TabsTrigger value="activacion" className="gap-1.5 px-3">
            <Zap className="w-4 h-4" />
            Activación
          </TabsTrigger>
        </TabsList>
        <TooltipProvider delayDuration={400}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 ml-auto text-muted-foreground hover:text-foreground"
                onClick={() => void refresh()}
                disabled={isLoading}
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Recargar colecciones</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <TabsContent value="galeria" className="flex-1 min-h-0 m-0 data-[state=inactive]:hidden">
        <GalleryTab collections={collections} isLoading={isLoading} loadError={loadError} onReload={refresh} />
      </TabsContent>

      <TabsContent value="subir" className="flex-1 min-h-0 m-0 data-[state=inactive]:hidden">
        <UploadTab collections={collections} isLoading={isLoading} loadError={loadError} onReload={refresh} />
      </TabsContent>

      <TabsContent value="colecciones" className="flex-1 min-h-0 m-0 data-[state=inactive]:hidden">
        <CollectionsTab
          collections={collections}
          isLoading={isLoading}
          loadError={loadError}
          onReload={refresh}
          selectedFolder={mgmtFolder}
          onSelectFolder={selectMgmtFolder}
          draft={mgmtDraft}
          onDraftChange={updateMgmtDraft}
          onDraftPatch={patchMgmtDraft}
          onDraftReset={resetMgmtDraft}
          dirty={mgmtDirty}
        />
      </TabsContent>

      <TabsContent value="activacion" className="flex-1 min-h-0 m-0 data-[state=inactive]:hidden">
        <ActivationTab />
      </TabsContent>
    </Tabs>
  );
}

// ============================================
// Pestaña Galería
// ============================================

function GalleryTab({ collections, isLoading, loadError }: SharedDataProps) {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const activeBackground = useTavernStore((state) => state.activeBackground);
  const setActiveBackground = useTavernStore((state) => state.setActiveBackground);
  const backgroundFit = useTavernStore((state) => state.settings.backgroundFit);
  const updateSettings = useTavernStore((state) => state.updateSettings);

  const term = search.trim().toLowerCase();

  const visibleFiles: { file: BackgroundFile; collectionName: string }[] = [];
  for (const collection of collections) {
    if (selectedName && collection.name !== selectedName) continue;
    const nameMatches = term.length > 0 && collection.name.toLowerCase().includes(term);
    for (const file of collection.files) {
      if (term && !nameMatches && !file.name.toLowerCase().includes(term)) continue;
      visibleFiles.push({ file, collectionName: collection.name });
    }
  }
  const totalFiles = collections.reduce((sum, c) => sum + c.files.length, 0);

  const handleApply = (file: BackgroundFile) => {
    setActiveBackground(file.url);
    toast.success('Fondo aplicado', { description: file.name });
  };

  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      {/* Búsqueda + ajuste de encaje */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-shrink-0">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar fondos o colecciones..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <TooltipProvider delayDuration={400}>
          <div className="flex items-center gap-0.5 border rounded-md p-0.5 w-fit">
            {fitModes.map((mode) => {
              const Icon = mode.icon;
              return (
                <Tooltip key={mode.value}>
                  <TooltipTrigger asChild>
                    <Button
                      variant={backgroundFit === mode.value ? 'default' : 'ghost'}
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => updateSettings({ backgroundFit: mode.value })}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="font-medium">{mode.label}</p>
                    <p className="text-xs text-muted-foreground">{mode.description}</p>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>
      </div>

      {/* Selector de colecciones (chips con scroll horizontal) */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 flex-shrink-0">
        <button
          type="button"
          onClick={() => setSelectedName(null)}
          className={cn(
            'h-9 shrink-0 rounded-full border px-3 text-xs font-medium inline-flex items-center gap-1.5 transition-colors',
            selectedName === null
              ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground'
          )}
        >
          <FolderOpen className="w-3.5 h-3.5" />
          Todos
          <span className="opacity-70">{totalFiles}</span>
        </button>
        {collections.map((collection) => (
          <button
            key={collection.path}
            type="button"
            onClick={() => setSelectedName(collection.name)}
            className={cn(
              'h-9 shrink-0 rounded-full border px-3 text-xs font-medium inline-flex items-center gap-1.5 transition-colors max-w-56',
              selectedName === collection.name
                ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground'
            )}
          >
            <span className="truncate min-w-0">{collection.name}</span>
            <span className="opacity-70">{collection.files.length}</span>
          </button>
        ))}
      </div>

      {/* Conteo */}
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground flex-shrink-0">
        <span>
          {visibleFiles.length} fondo{visibleFiles.length !== 1 ? 's' : ''}
          {selectedName ? ` en «${selectedName}»` : ` · ${collections.length} colección${collections.length !== 1 ? 'es' : ''}`}
        </span>
        {selectedName && (
          <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={() => setSelectedName(null)}>
            Ver todas
          </Button>
        )}
      </div>

      {/* Grid de fondos */}
      <ScrollArea className="flex-1 min-h-0">
        {loadError ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-2">
            <AlertTriangle className="w-10 h-10 text-destructive/60" />
            <p className="text-sm text-destructive">Error al cargar las colecciones</p>
            <p className="text-xs">{loadError}</p>
          </div>
        ) : isLoading && collections.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        ) : visibleFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <ImageIcon className="w-12 h-12 mb-2 opacity-50" />
            {collections.length === 0 || totalFiles === 0 ? (
              <>
                <p className="text-sm">Aún no hay fondos{collections.length === 0 ? ' ni colecciones' : ''}</p>
                <p className="text-xs mt-1">Crea una colección y sube fondos en la pestaña «Subir»</p>
              </>
            ) : (
              <>
                <p className="text-sm">Sin resultados{term ? ` para «${search.trim()}»` : ''}</p>
                <p className="text-xs mt-1">Prueba con otro término o revisa otra colección</p>
              </>
            )}
          </div>
        ) : (
          <div className="p-1 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-3 auto-rows-min">
            {visibleFiles.map(({ file, collectionName }, index) => (
              <GalleryCard
                key={`${file.url}-${index}`}
                file={file}
                collectionName={collectionName}
                isActive={activeBackground === file.url}
                onSelect={() => handleApply(file)}
                onPreview={() => setPreviewUrl(file.url)}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Vista previa a pantalla completa */}
      <AnimatePresence>
        {previewUrl && (
          <motion.div
            key="bg-panel-preview"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4"
            onClick={() => setPreviewUrl(null)}
          >
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-4 right-4 text-white hover:bg-white/20 z-10"
              onClick={() => setPreviewUrl(null)}
            >
              <X className="w-6 h-6" />
            </Button>
            {VIDEO_URL_RE.test(previewUrl) ? (
              <video
                src={previewUrl}
                className="max-w-full max-h-full object-contain"
                autoPlay
                loop
                muted
              />
            ) : (
              <img
                src={previewUrl}
                alt="Vista previa"
                className="max-w-full max-h-full object-contain"
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Tarjeta de fondo (adaptada de background-gallery.tsx, acentos esmeralda) ---

function GalleryCard({
  file,
  collectionName,
  isActive,
  onSelect,
  onPreview,
}: {
  file: BackgroundFile;
  collectionName: string;
  isActive: boolean;
  onSelect: () => void;
  onPreview: () => void;
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const isVideo = file.type === 'video';

  return (
    <div
      className={cn(
        'group relative aspect-video rounded-lg overflow-hidden border-2 cursor-pointer transition-all hover:scale-[1.02] min-h-[44px]',
        isActive
          ? 'border-emerald-500 ring-2 ring-emerald-500/30'
          : 'border-transparent hover:border-emerald-500/40'
      )}
      onClick={onSelect}
    >
      {isLoading && !hasError && (
        <div className="absolute inset-0 bg-muted flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {hasError && (
        <div className="absolute inset-0 bg-muted flex flex-col items-center justify-center">
          <ImageIcon className="w-6 h-6 text-muted-foreground mb-1" />
          <span className="text-xs text-muted-foreground truncate px-1">Error</span>
        </div>
      )}

      {!hasError &&
        (isVideo ? (
          <div className="w-full h-full bg-muted flex items-center justify-center">
            <video
              src={file.url}
              className="w-full h-full object-cover"
              muted
              playsInline
              onMouseEnter={(e) => {
                (e.target as HTMLVideoElement).play();
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLVideoElement).pause();
                (e.target as HTMLVideoElement).currentTime = 0;
              }}
              onError={() => setHasError(true)}
              onLoadedData={() => setIsLoading(false)}
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <Video className="w-8 h-8 text-white drop-shadow-lg opacity-70" />
            </div>
          </div>
        ) : (
          <img
            src={file.url}
            alt={file.name}
            className={cn('w-full h-full object-cover transition-opacity', isLoading && 'opacity-0')}
            onLoad={() => setIsLoading(false)}
            onError={() => {
              setIsLoading(false);
              setHasError(true);
            }}
          />
        ))}

      {isActive && (
        <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center shadow-md">
          <Check className="w-3 h-3 text-white" />
        </div>
      )}

      {isVideo && !hasError && (
        <div className="absolute top-1.5 left-1.5 bg-black/60 rounded px-1 py-0.5">
          <Video className="w-3 h-3 text-white" />
        </div>
      )}

      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-end justify-center pb-2 opacity-0 group-hover:opacity-100">
        <Button
          variant="secondary"
          size="sm"
          className="h-7 text-xs shadow-md"
          onClick={(e) => {
            e.stopPropagation();
            onPreview();
          }}
        >
          Vista previa
        </Button>
      </div>

      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-1.5 pt-5 pointer-events-none">
        <p className="text-[10px] text-white truncate leading-tight">{file.name}</p>
        <p className="text-[9px] text-white/60 truncate leading-tight">{collectionName}</p>
      </div>
    </div>
  );
}

// ============================================
// Pestaña Subir
// ============================================

function UploadTab({ collections, onReload }: SharedDataProps) {
  const [targetFolder, setTargetFolder] = useState<string | null>(null);
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const uploadingRef = useRef(false);

  const selectedCollection = collections.find((c) => folderOf(c) === targetFolder) ?? null;

  const patchItem = (id: string, patch: Partial<UploadQueueItem>) => {
    setQueue((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  };

  // --- Crear colección inline ---
  const handleCreateCollection = async () => {
    const name = newName.trim();
    if (!name || isCreating) return;
    setIsCreating(true);
    try {
      const response = await fetch('/api/backgrounds/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', name, description: newDescription.trim() }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || `Error HTTP ${response.status}`);
      }
      toast.success(`Colección «${name}» creada`);
      setShowCreate(false);
      setNewName('');
      setNewDescription('');
      const list = await onReload();
      const created = data.collection as BackgroundCollection | undefined;
      const folder = created ? folderOf(created) : null;
      if (folder && list.some((c) => folderOf(c) === folder)) {
        setTargetFolder(folder);
      }
    } catch (error) {
      toast.error('No se pudo crear la colección', {
        description: error instanceof Error ? error.message : 'Error desconocido',
      });
    } finally {
      setIsCreating(false);
    }
  };

  // --- Subida con concurrencia limitada (≤3) ---
  const runBatch = async (batch: UploadQueueItem[]) => {
    if (!targetFolder || uploadingRef.current) return;
    uploadingRef.current = true;
    setIsUploading(true);

    let ok = 0;
    let fail = 0;
    let firstError: string | null = null;

    await runPool(batch, 3, async (item) => {
      patchItem(item.id, { status: 'uploading', error: undefined });
      try {
        const formData = new FormData();
        formData.append('file', item.file);
        formData.append('type', 'background');
        formData.append('collection', targetFolder);

        const response = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.success) {
          throw new Error(data?.error || `Error HTTP ${response.status}`);
        }
        patchItem(item.id, { status: 'success', url: String(data.url) });
        ok += 1;
        // Refresca para que la Galería y Colecciones lo vean de inmediato
        await onReload();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Error al subir el archivo';
        patchItem(item.id, { status: 'error', error: message });
        fail += 1;
        if (!firstError) firstError = message;
      }
    });

    uploadingRef.current = false;
    setIsUploading(false);

    const colName = selectedCollection?.name ?? targetFolder;
    if (fail === 0) {
      toast.success(`${ok} fondo${ok === 1 ? '' : 's'} subido${ok === 1 ? '' : 's'} a «${colName}»`);
    } else if (ok > 0) {
      toast.warning(`${ok} subido${ok === 1 ? '' : 's'} · ${fail} fallido${fail === 1 ? '' : 's'}`, {
        description: firstError ?? undefined,
      });
    } else {
      toast.error('No se pudo subir ningún fondo', { description: firstError ?? undefined });
    }
  };

  const addFiles = (fileList: FileList | File[] | null) => {
    if (!fileList) return;
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;
    if (!targetFolder) {
      toast.error('Selecciona primero una colección de destino');
      return;
    }
    if (uploadingRef.current) {
      toast.warning('Espera a que termine la subida actual');
      return;
    }
    const items: UploadQueueItem[] = incoming.map((file) => ({
      id: genId(),
      file,
      name: file.name,
      size: file.size,
      status: 'pending',
    }));
    setQueue((prev) => [...prev, ...items]);
    void runBatch(items);
  };

  const retryFailed = () => {
    if (uploadingRef.current) return;
    const failed = queue.filter((q) => q.status === 'error');
    if (failed.length === 0) return;
    void runBatch(failed);
  };

  const clearQueue = () => {
    if (uploadingRef.current) return;
    setQueue([]);
  };

  const failedCount = queue.filter((q) => q.status === 'error').length;

  return (
    <div className="h-full flex flex-col gap-4 min-h-0 overflow-y-auto lg:overflow-visible pr-1">
      {/* Colección de destino */}
      <div className="space-y-1.5 flex-shrink-0">
        <Label className="text-sm font-medium">Colección de destino</Label>
        <Select
          value={targetFolder ?? undefined}
          onValueChange={(value) => {
            if (value === NEW_COLLECTION_VALUE) {
              setShowCreate(true);
              return;
            }
            setTargetFolder(value);
          }}
        >
          <SelectTrigger className="w-full max-w-md h-10">
            <SelectValue placeholder={collections.length === 0 ? 'No hay colecciones todavía' : 'Selecciona una colección'} />
          </SelectTrigger>
          <SelectContent>
            {collections.map((collection) => (
              <SelectItem key={collection.path} value={folderOf(collection)}>
                {collection.name} · {collection.files.length} archivo{collection.files.length !== 1 ? 's' : ''}
              </SelectItem>
            ))}
            {collections.length > 0 && (
              <SelectItem value={NEW_COLLECTION_VALUE} className="text-emerald-600 dark:text-emerald-400">
                <Plus className="w-4 h-4 mr-1 inline" />
                Nueva colección…
              </SelectItem>
            )}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Los archivos se guardarán en la carpeta de la colección y quedarán disponibles en la Galería.
        </p>
      </div>

      {/* Formulario inline de nueva colección */}
      {(showCreate || collections.length === 0) && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3 flex-shrink-0">
          <div>
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Nueva colección</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Se creará una carpeta en el directorio de fondos con su collection.json.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Nombre</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ej: Bosque, Castillo, Playa"
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Descripción (opcional)</Label>
              <Input
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Describe esta colección…"
                className="h-9"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => void handleCreateCollection()}
              disabled={!newName.trim() || isCreating}
            >
              {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderPlus className="w-4 h-4" />}
              Crear colección
            </Button>
            {showCreate && (
              <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
                Cancelar
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Dropzone */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setIsDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          addFiles(e.dataTransfer?.files ?? null);
        }}
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition-colors min-h-[160px] flex-shrink-0 outline-none',
          isDragging
            ? 'border-emerald-500 bg-emerald-500/10'
            : 'border-border hover:border-emerald-500/50 hover:bg-muted/40'
        )}
      >
        {isUploading ? (
          <>
            <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
            <p className="text-sm font-medium">Subiendo fondos…</p>
            <p className="text-xs text-muted-foreground">Puedes dejar esta pestaña, la subida continúa.</p>
          </>
        ) : (
          <>
            <Upload className={cn('w-8 h-8', isDragging ? 'text-emerald-500' : 'text-muted-foreground')} />
            <p className="text-sm font-medium">
              {isDragging ? 'Suelta los archivos aquí' : 'Arrastra imágenes o videos aquí'}
            </p>
            <p className="text-xs text-muted-foreground">o haz clic para explorar tus archivos</p>
            <p className="text-[11px] text-muted-foreground/80 mt-1">
              PNG, JPG, WEBP, GIF, MP4, WEBM… máx 50MB por archivo
            </p>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        disabled={isUploading}
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Cola de subida */}
      {queue.length > 0 && (
        <div className="space-y-2 flex-shrink-0">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">
              Cola de subida{' '}
              <span className="text-xs text-muted-foreground">({queue.length} archivo{queue.length !== 1 ? 's' : ''})</span>
            </p>
            <div className="flex items-center gap-1.5">
              {failedCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={retryFailed}
                  disabled={isUploading}
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1" />
                  Reintentar fallidos ({failedCount})
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-foreground hover:text-foreground"
                onClick={clearQueue}
                disabled={isUploading}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" />
                Limpiar
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            {queue.map((item) => (
              <div
                key={item.id}
                className={cn(
                  'flex items-center gap-3 rounded-md border p-2.5 text-sm',
                  item.status === 'error' && 'border-destructive/40 bg-destructive/5',
                  item.status === 'success' && 'border-emerald-500/40 bg-emerald-500/5'
                )}
              >
                <div className="w-6 h-6 flex items-center justify-center shrink-0">
                  {item.status === 'uploading' && <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />}
                  {item.status === 'success' && <Check className="w-4 h-4 text-emerald-500" />}
                  {item.status === 'error' && <AlertTriangle className="w-4 h-4 text-destructive" />}
                  {(item.status === 'pending' || !item.status) && (
                    <ImageIcon className="w-4 h-4 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.status === 'pending' && `En espera · ${formatBytes(item.size)}`}
                    {item.status === 'uploading' && `Subiendo… · ${formatBytes(item.size)}`}
                    {item.status === 'success' && item.url && (
                      <span className="text-emerald-600 dark:text-emerald-400">{item.url}</span>
                    )}
                    {item.status === 'error' && (
                      <span className="text-destructive">{item.error || 'Error desconocido'}</span>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// Pestaña Colecciones
// ============================================

interface CollectionsTabProps extends SharedDataProps {
  selectedFolder: string | null;
  onSelectFolder: (folder: string | null) => void;
  draft: BackgroundCollection | null;
  onDraftChange: (updater: (prev: BackgroundCollection) => BackgroundCollection) => void;
  onDraftPatch: (updater: (prev: BackgroundCollection) => BackgroundCollection) => void;
  onDraftReset: (collection: BackgroundCollection | null) => void;
  dirty: boolean;
}

function CollectionsTab({
  collections,
  isLoading,
  onReload,
  selectedFolder,
  onSelectFolder,
  draft,
  onDraftChange,
  onDraftPatch,
  onDraftReset,
  dirty,
}: CollectionsTabProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const [deleteCollectionOpen, setDeleteCollectionOpen] = useState(false);
  const [isDeletingCollection, setIsDeletingCollection] = useState(false);
  const [fileDeleteTarget, setFileDeleteTarget] = useState<BackgroundFile | null>(null);
  const [isDeletingFile, setIsDeletingFile] = useState(false);

  const selected = collections.find((c) => folderOf(c) === selectedFolder) ?? null;

  const handleSelect = (collection: BackgroundCollection) => {
    onSelectFolder(folderOf(collection));
    onDraftReset(collection);
    setRenameValue('');
  };

  const updateEntry = (entryId: string, updates: Partial<BackgroundCollectionEntry>) => {
    onDraftChange((prev) => ({
      ...prev,
      entries: prev.entries.map((e) => (e.id === entryId ? { ...e, ...updates } : e)),
    }));
  };

  // --- Guardar metadatos (nombre visible, descripción, entries, transición) ---
  const handleSave = async () => {
    if (!draft || !selectedFolder || isSaving || !dirty) return;
    setIsSaving(true);
    try {
      const response = await fetch('/api/backgrounds/collections', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderName: selectedFolder,
          name: draft.name,
          // La API lee `newName`; se envía también `name` por compatibilidad
          newName: draft.name,
          description: draft.description,
          entries: draft.entries,
          transitionDuration: draft.transitionDuration,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || `Error HTTP ${response.status}`);
      }
      toast.success('Cambios guardados');
      const list = await onReload();
      const fresh = list.find((c) => folderOf(c) === selectedFolder);
      onDraftReset(fresh ?? null);
    } catch (error) {
      toast.error('No se pudieron guardar los cambios', {
        description: error instanceof Error ? error.message : 'Error desconocido',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // --- Renombrar carpeta (las URLs se actualizan solas en el servidor) ---
  const handleRename = async () => {
    const next = renameValue.trim();
    if (!selectedFolder || !next || next === selectedFolder || isRenaming) return;
    setIsRenaming(true);
    try {
      const response = await fetch('/api/backgrounds/collections', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderName: selectedFolder, newFolderName: next }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || `Error HTTP ${response.status}`);
      }
      const newFolder = typeof data.newPath === 'string' ? data.newPath : next;
      toast.success(`Carpeta renombrada a «${newFolder}»`, {
        description: 'Las URLs de los fondos se actualizaron automáticamente.',
      });
      const list = await onReload();
      onSelectFolder(newFolder);
      const fresh = list.find((c) => folderOf(c) === newFolder);
      onDraftReset(fresh ?? null);
      setRenameValue('');
    } catch (error) {
      toast.error('No se pudo renombrar la carpeta', {
        description: error instanceof Error ? error.message : 'Error desconocido',
      });
    } finally {
      setIsRenaming(false);
    }
  };

  // --- Crear colección (Dialog) ---
  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || isCreating) return;
    setIsCreating(true);
    try {
      const response = await fetch('/api/backgrounds/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', name, description: newDescription.trim() }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || `Error HTTP ${response.status}`);
      }
      toast.success(`Colección «${name}» creada`);
      setShowCreateDialog(false);
      setNewName('');
      setNewDescription('');
      const list = await onReload();
      const created = data.collection as BackgroundCollection | undefined;
      const folder = created ? folderOf(created) : null;
      const fresh = folder ? list.find((c) => folderOf(c) === folder) : undefined;
      if (fresh) {
        onSelectFolder(folderOf(fresh));
        onDraftReset(fresh);
      }
    } catch (error) {
      toast.error('No se pudo crear la colección', {
        description: error instanceof Error ? error.message : 'Error desconocido',
      });
    } finally {
      setIsCreating(false);
    }
  };

  // --- Eliminar colección completa ---
  const handleDeleteCollection = async () => {
    if (!selectedFolder || isDeletingCollection) return;
    setIsDeletingCollection(true);
    try {
      const response = await fetch(
        `/api/backgrounds/collections?folderName=${encodeURIComponent(selectedFolder)}`,
        { method: 'DELETE' }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || `Error HTTP ${response.status}`);
      }
      toast.success(`Colección «${selected?.name ?? selectedFolder}» eliminada`);
      onSelectFolder(null);
      onDraftReset(null);
      await onReload();
    } catch (error) {
      toast.error('No se pudo eliminar la colección', {
        description: error instanceof Error ? error.message : 'Error desconocido',
      });
    } finally {
      setIsDeletingCollection(false);
      setDeleteCollectionOpen(false);
    }
  };

  // --- Eliminar un archivo de la colección ---
  const handleDeleteFile = async () => {
    if (!fileDeleteTarget || !selectedFolder || isDeletingFile) return;
    setIsDeletingFile(true);
    const target = fileDeleteTarget;
    try {
      const response = await fetch(
        `/api/backgrounds/collections?folderName=${encodeURIComponent(selectedFolder)}&filename=${encodeURIComponent(target.name)}`,
        { method: 'DELETE' }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || `Error HTTP ${response.status}`);
      }
      toast.success(`Archivo «${target.name}» eliminado`);
      setFileDeleteTarget(null);
      const list = await onReload();
      const fresh = list.find((c) => folderOf(c) === selectedFolder);
      if (dirty) {
        // Respeta los cambios sin guardar: solo retira el archivo borrado del borrador
        onDraftPatch((prev) => ({
          ...prev,
          files: prev.files.filter((f) => f.url !== target.url),
          entries: prev.entries.filter((e) => e.url !== target.url),
        }));
        if (!fresh) onDraftReset(null);
      } else {
        onDraftReset(fresh ?? null);
      }
    } catch (error) {
      toast.error('No se pudo eliminar el archivo', {
        description: error instanceof Error ? error.message : 'Error desconocido',
      });
    } finally {
      setIsDeletingFile(false);
    }
  };

  return (
    <div className="h-full flex flex-col lg:flex-row gap-4 min-h-0 overflow-y-auto lg:overflow-visible pr-1">
      {/* ===== Lista maestra ===== */}
      <div className="w-full lg:w-64 xl:w-72 flex flex-col gap-2 flex-shrink-0">
        <Button
          variant="outline"
          className="w-full border-emerald-500/50 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400 min-h-[44px]"
          onClick={() => setShowCreateDialog(true)}
        >
          <FolderPlus className="w-4 h-4 mr-1.5" />
          Nueva Colección
        </Button>
        <ScrollArea className="max-h-56 lg:max-h-none lg:flex-1 lg:min-h-0">
          <div className="space-y-1 pr-2">
            {collections.length === 0 && !isLoading && (
              <div className="text-center text-muted-foreground py-6 px-2">
                <FolderOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-xs">No hay colecciones todavía. Crea la primera con el botón de arriba.</p>
              </div>
            )}
            {collections.map((collection) => {
              const isSelected = folderOf(collection) === selectedFolder;
              return (
                <button
                  key={collection.path}
                  type="button"
                  onClick={() => handleSelect(collection)}
                  className={cn(
                    'w-full text-left rounded-lg border p-3 transition-colors min-h-[44px]',
                    isSelected
                      ? 'border-emerald-500 bg-emerald-500/10'
                      : 'border-border hover:bg-muted/50'
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn('text-sm font-medium truncate', isSelected && 'text-emerald-600 dark:text-emerald-400')}>
                      {collection.name}
                    </p>
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      {collection.files.length}
                    </Badge>
                  </div>
                  {collection.description && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{collection.description}</p>
                  )}
                  <p className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">/{folderOf(collection)}</p>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* ===== Detalle ===== */}
      {!draft || !selected ? (
        <div className="flex-1 flex items-center justify-center min-h-[220px]">
          <div className="text-center text-muted-foreground">
            <FolderOpen className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Selecciona una colección para gestionarla</p>
            <p className="text-xs mt-1">Podrás editar su nombre, descripción, claves de activación y archivos</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col gap-3 min-h-0">
          {/* Encabezado */}
          <div className="flex items-center justify-between gap-2 flex-wrap flex-shrink-0">
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{selected.name}</p>
              <p className="text-xs text-muted-foreground">
                /{folderOf(selected)} · {selected.files.length} archivo{selected.files.length !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {dirty && (
                <Badge variant="outline" className="text-emerald-600 border-emerald-500/50 dark:text-emerald-400 text-xs">
                  Sin guardar
                </Badge>
              )}
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white min-h-[36px]"
                onClick={() => void handleSave()}
                disabled={!dirty || isSaving}
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Guardar cambios
              </Button>
            </div>
          </div>

          {/* Metadatos editables */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 flex-shrink-0">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Nombre visible</Label>
              <Input
                value={draft.name}
                onChange={(e) => onDraftChange((prev) => ({ ...prev, name: e.target.value }))}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Descripción</Label>
              <Input
                value={draft.description ?? ''}
                onChange={(e) => onDraftChange((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Describe esta colección…"
                className="h-9"
              />
            </div>
          </div>

          {/* Avanzado: renombrar carpeta */}
          <Collapsible className="flex-shrink-0">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground -ml-2">
                <ChevronDown className="w-3.5 h-3.5 mr-1" />
                Avanzado (renombrar carpeta)
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-1 rounded-lg border p-3 space-y-2 bg-muted/20">
                <div>
                  <p className="text-xs font-medium flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 text-amber-500" />
                    Renombrar carpeta de la colección
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Las URLs de los fondos se actualizan automáticamente. Si un personaje o escenario apuntaba a esta carpeta, vuelve a seleccionar el fondo.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    placeholder={folderOf(selected)}
                    className="h-8 flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => void handleRename()}
                    disabled={!renameValue.trim() || renameValue.trim() === selectedFolder || isRenaming}
                  >
                    {isRenaming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    Aplicar
                  </Button>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Zona de archivos */}
          <div className="flex-1 flex flex-col gap-2 min-h-0">
            <Label className="text-xs text-muted-foreground flex-shrink-0">
              Archivos y claves de activación por fondo
            </Label>
            {selected.files.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground flex-shrink-0">
                <ImageIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Esta colección está vacía</p>
                <p className="text-xs mt-1">Sube fondos desde la pestaña «Subir» seleccionándola como destino</p>
              </div>
            ) : (
              <ScrollArea className="flex-1 min-h-0 max-h-[420px] lg:max-h-none">
                <Accordion type="multiple" className="pr-2">
                  {selected.files.map((file) => {
                    const entry = draft.entries.find((e) => e.url === file.url);
                    return (
                      <FileEditorRow
                        key={file.url}
                        file={file}
                        entry={entry}
                        onEntryChange={updateEntry}
                        onRequestDelete={() => setFileDeleteTarget(file)}
                      />
                    );
                  })}
                </Accordion>
              </ScrollArea>
            )}
          </div>

          {/* Zona de peligro */}
          <div className="flex-shrink-0 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="h-9 text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setDeleteCollectionOpen(true)}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              Eliminar colección
            </Button>
          </div>
        </div>
      )}

      {/* Dialog: Nueva colección */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Crear Nueva Colección</DialogTitle>
            <DialogDescription>
              Crea una nueva colección de fondos. Se creará una carpeta en el directorio de fondos.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Nombre de la colección</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ej: Bosque, Castillo, Playa"
              />
            </div>
            <div className="space-y-2">
              <Label>Descripción (opcional)</Label>
              <Textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Describe esta colección…"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancelar
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => void handleCreate()}
              disabled={!newName.trim() || isCreating}
            >
              {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderPlus className="w-4 h-4" />}
              Crear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AlertDialog: eliminar archivo */}
      <AlertDialog open={fileDeleteTarget !== null} onOpenChange={(open) => !open && setFileDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Eliminar archivo
            </AlertDialogTitle>
            <AlertDialogDescription>
              ¿Seguro que quieres eliminar <strong>{fileDeleteTarget?.name}</strong> de esta colección?
              El archivo se borrará del disco y su entrada en collection.json se limpiará. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteFile();
              }}
              disabled={isDeletingFile}
            >
              {isDeletingFile ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1" />}
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AlertDialog: eliminar colección completa */}
      <AlertDialog open={deleteCollectionOpen} onOpenChange={setDeleteCollectionOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Eliminar colección
            </AlertDialogTitle>
            <AlertDialogDescription>
              ¿Seguro que quieres eliminar la colección <strong>{selected?.name}</strong>?
              Se borrarán <strong>permanentemente</strong> todos sus archivos ({selected?.files.length ?? 0}) del disco.
              Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteCollection();
              }}
              disabled={isDeletingCollection}
            >
              {isDeletingCollection ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1" />}
              Eliminar todo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// --- Fila editor de archivo (acordeón, adaptado de background-collection-manager) ---

function FileEditorRow({
  file,
  entry,
  onEntryChange,
  onRequestDelete,
}: {
  file: BackgroundFile;
  entry: BackgroundCollectionEntry | undefined;
  onEntryChange: (entryId: string, updates: Partial<BackgroundCollectionEntry>) => void;
  onRequestDelete: () => void;
}) {
  if (!entry) {
    // No debería ocurrir: el GET y withSyncedEntries garantizan una entry por archivo
    return null;
  }
  const triggerCount = entry.triggerKeys?.length ?? 0;

  return (
    <AccordionItem
      value={file.url}
      className="border rounded-lg mb-2 bg-muted/20 overflow-hidden last:border"
    >
      <div className="flex items-center">
        <AccordionTrigger className="flex-1 px-3 py-2.5 hover:no-underline min-h-[44px]">
          <span className="flex items-center gap-3 min-w-0 text-left">
            <FileThumb file={file} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium truncate">{entry.name || file.name.replace(/\.[^.]+$/, '')}</span>
              <span className="block text-xs text-muted-foreground truncate">
                {file.name}
                {triggerCount > 0 && ` · ${triggerCount} trigger${triggerCount !== 1 ? 's' : ''}`}
              </span>
            </span>
          </span>
        </AccordionTrigger>
        <TooltipProvider delayDuration={400}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="h-9 w-9 mr-2 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  onRequestDelete();
                }}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Eliminar archivo</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <AccordionContent className="px-3 pb-3">
        <div className="space-y-3 pt-1">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Nombre visible del fondo</Label>
            <Input
              value={entry.name}
              onChange={(e) => onEntryChange(entry.id, { name: e.target.value })}
              className="h-8"
            />
          </div>

          <KeyBadgeEditor
            label="Claves de Activación"
            icon={Key}
            keys={entry.triggerKeys}
            badgeVariant="secondary"
            onChange={(keys) => onEntryChange(entry.id, { triggerKeys: keys })}
          />

          <KeyBadgeEditor
            label="Claves de Contexto"
            icon={Tag}
            keys={entry.contextKeys}
            badgeVariant="outline"
            onChange={(keys) => onEntryChange(entry.id, { contextKeys: keys })}
          />

          <KeyBadgeEditor
            label="Etiquetas"
            icon={Tag}
            keys={entry.tags ?? []}
            badgeVariant="default"
            onChange={(keys) => onEntryChange(entry.id, { tags: keys })}
          />
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

// --- Editor de claves por badges (añadir con Enter, quitar con clic) ---

function KeyBadgeEditor({
  label,
  icon: Icon,
  keys,
  badgeVariant,
  onChange,
}: {
  label: string;
  icon: typeof Key;
  keys: string[];
  badgeVariant: 'default' | 'secondary' | 'outline';
  onChange: (keys: string[]) => void;
}) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground flex items-center gap-1">
        <Icon className="w-3 h-3" />
        {label}
      </Label>
      <div className="flex flex-wrap gap-1 mt-1">
        {keys.map((key, i) => (
          <Badge
            key={`${key}-${i}`}
            variant={badgeVariant}
            className="cursor-pointer hover:bg-destructive hover:text-destructive-foreground text-xs"
            onClick={() => onChange(keys.filter((_, idx) => idx !== i))}
          >
            {key}
            <X className="w-2.5 h-2.5 ml-0.5" />
          </Badge>
        ))}
        <Input
          placeholder="Agregar…"
          className="h-7 w-24 text-xs px-2"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.currentTarget.value.trim()) {
              onChange([...keys, e.currentTarget.value.trim().toLowerCase()]);
              e.currentTarget.value = '';
            }
          }}
        />
      </div>
    </div>
  );
}

// --- Miniatura de archivo (video con primer frame, imagen con lazy load) ---

function FileThumb({ file }: { file: BackgroundFile }) {
  const [failed, setFailed] = useState(false);

  return (
    <span className="relative w-14 h-8 rounded overflow-hidden bg-muted shrink-0 inline-flex items-center justify-center">
      {failed ? (
        <ImageIcon className="w-4 h-4 text-muted-foreground" />
      ) : file.type === 'video' ? (
        <>
          <video
            src={file.url}
            muted
            preload="metadata"
            className="w-full h-full object-cover"
            onError={() => setFailed(true)}
          />
          <Video className="absolute bottom-0.5 right-0.5 w-3 h-3 text-white drop-shadow" />
        </>
      ) : (
        <img
          src={file.url}
          alt={file.name}
          loading="lazy"
          className="w-full h-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

// ============================================
// Pestaña Activación
// ============================================

function ActivationTab() {
  return (
    <div className="h-full flex flex-col gap-4 min-h-0 overflow-y-auto lg:overflow-visible pr-1">
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 flex-shrink-0">
        <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Activación de fondos</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Aquí gestionas los packs de activación en tiempo de ejecución (claves globales y modos de coincidencia).
          Las claves de activación <strong>por fondo individual</strong> (primarias y de contexto por imagen) se editan
          en la pestaña «Colecciones», dentro de cada archivo.
        </p>
      </div>
      <div className="flex-1 min-h-0">
        <BackgroundTriggersSettings />
      </div>
    </div>
  );
}

export default BackgroundsPanel;
