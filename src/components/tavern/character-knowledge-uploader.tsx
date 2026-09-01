'use client';

// ============================================
// Character Knowledge Uploader (FASE 16)
// ============================================
// Allows uploading knowledge/backhistory files directly to a character.
// Files are chunked, embedded, and stored in the character's namespace
// (character-{charId}) so they're automatically searched during chat.
//
// This is DIFFERENT from memory:
// - Knowledge (uploaded files): static background, lore, world-building
//   → injected as [CONTEXTO RELEVANTE] via source_type='file'
// - Memory (auto-extracted): dynamic facts from the conversation
//   → injected as [MEMORIA RELEVANTE] via source_type='memory'

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Slider } from '@/components/ui/slider';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle,
  XCircle,
  HelpCircle,
  Database,
  Trash2,
  Eye,
  BookOpen,
  AlertTriangle,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { getSafeChunkSize, getChunkSizeRecommendation, CHARS_PER_TOKEN } from '@/lib/embeddings/types';

interface CharacterKnowledgeUploaderProps {
  characterId: string;
  characterName: string;
}

interface UploadedFile {
  fileName: string;
  fileSize: number;
  content: string;
  characterCount: number;
}

interface NamespaceInfo {
  count: number;
  embeddings: Array<{
    id?: string;
    source_id?: string;
    source_type?: string;
    count?: number;
    firstChunk?: string;
    content?: string;
    created_at?: string;
    ids?: string[];
  }>;
}

const SPLITTER_OPTIONS = [
  { value: 'markdown', label: 'Markdown', defaultChunkSize: 1500, defaultOverlap: 100 },
  { value: 'recursive', label: 'Recursive', defaultChunkSize: 500, defaultOverlap: 50 },
  { value: 'token', label: 'Token', defaultChunkSize: 500, defaultOverlap: 50 },
  { value: 'character', label: 'Character', defaultChunkSize: 1000, defaultOverlap: 100 },
  { value: 'line', label: 'Line', defaultChunkSize: 2000, defaultOverlap: 0 },
] as const;

export function CharacterKnowledgeUploader({ characterId, characterName }: CharacterKnowledgeUploaderProps) {
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [splitterType, setSplitterType] = useState<string>('markdown');
  const [chunkSize, setChunkSize] = useState(500);
  const [chunkOverlap, setChunkOverlap] = useState(50);
  const [existingKnowledge, setExistingKnowledge] = useState<NamespaceInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [embeddingModel, setEmbeddingModel] = useState<string>('');
  const [modelContextLength, setModelContextLength] = useState<number | undefined>(undefined);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // The character's knowledge namespace
  const knowledgeNamespace = `character-${characterId}`;

  // FASE 16: Load embedding model config to calculate safe chunk size
  useEffect(() => {
    const loadEmbeddingConfig = async () => {
      try {
        const res = await fetch('/api/embeddings/config');
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.data) {
            const config = data.data;
            setEmbeddingModel(config.model || 'bge-m3:567m');
            setModelContextLength(config.modelContextLength);

            // Auto-recommend chunk size based on detected context length
            const safeChunkSize = getSafeChunkSize(config.model || 'bge-m3:567m', config.modelContextLength);
            // Only set if user hasn't changed it yet (initial load)
            if (chunkSize === 500) {
              setChunkSize(safeChunkSize);
              setChunkOverlap(Math.floor(safeChunkSize * 0.1)); // 10% overlap
              console.log(`[KnowledgeUploader] Auto-set chunkSize=${safeChunkSize} based on model ${config.model} (context: ${config.modelContextLength || 'default'})`);
            }
          }
        }
      } catch (err) {
        console.warn('[KnowledgeUploader] Error loading embedding config:', err);
      }
    };
    loadEmbeddingConfig();
  }, [chunkSize]);

  // Calculate chunk size recommendation
  const chunkRecommendation = embeddingModel
    ? getChunkSizeRecommendation(embeddingModel, modelContextLength, chunkSize)
    : null;

  // Load existing knowledge for this character
  const loadExistingKnowledge = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/embeddings/namespaces/${encodeURIComponent(knowledgeNamespace)}/documents`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          // The API returns documents grouped by source_id, each with:
          // { source_id, source_type, count, firstChunk, created_at, ids }
          const documents = data.data?.documents || [];
          // Filter to only file-type embeddings (knowledge, not memory)
          const fileEmbeddings = documents.filter(
            (doc: any) => doc.source_type === 'file' || doc.source_type === 'character'
          );
          setExistingKnowledge({
            count: fileEmbeddings.length,
            embeddings: fileEmbeddings,
          });
        }
      }
    } catch (err) {
      console.warn('[KnowledgeUploader] Error loading existing:', err);
    }
    setLoading(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/embeddings/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (data.success) {
        setUploadedFile({
          fileName: data.data.fileName,
          fileSize: data.data.fileSize,
          content: data.data.content,
          characterCount: data.data.characterCount,
        });
        toast({ title: 'Archivo cargado', description: `${data.data.fileName} (${data.data.characterCount.toLocaleString()} caracteres)` });
      } else {
        toast({ title: 'Error al subir', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Error al subir archivo.', variant: 'destructive' });
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleCreateEmbeddings = async () => {
    if (!uploadedFile?.content) return;
    setCreating(true);
    try {
      const res = await fetch('/api/embeddings/create-from-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: uploadedFile.content,
          namespace: knowledgeNamespace,
          splitterType,
          chunkSize,
          chunkOverlap,
          source_type: 'file',
          source_id: uploadedFile.fileName,
          metadata: {
            character_id: characterId,
            character_name: characterName,
            uploaded_at: new Date().toISOString(),
            file_name: uploadedFile.fileName,
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast({
          title: 'Conocimiento agregado',
          description: `${data.data.createdCount} fragmentos de conocimiento para ${characterName}`,
        });
        setUploadedFile(null);
        loadExistingKnowledge();
      } else {
        toast({ title: 'Fallido', description: data.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Error al crear embeddings.', variant: 'destructive' });
    }
    setCreating(false);
  };

  const handleDeleteKnowledge = async (sourceId: string) => {
    try {
      // Delete by source_id — removes all chunks belonging to this file
      const res = await fetch(`/api/embeddings/namespaces/${encodeURIComponent(knowledgeNamespace)}/documents`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_id: sourceId }),
      });
      if (res.ok) {
        toast({ title: 'Conocimiento eliminado' });
        loadExistingKnowledge();
      }
    } catch {
      toast({ title: 'Error al eliminar', variant: 'destructive' });
    }
  };

  const handleSplitterChange = (value: string) => {
    setSplitterType(value);
    // When changing splitter, use the safe chunk size if available
    const safeSize = embeddingModel
      ? getSafeChunkSize(embeddingModel, modelContextLength)
      : null;
    const opt = SPLITTER_OPTIONS.find(o => o.value === value);
    if (opt) {
      // Use safe size if it's smaller than the splitter's default (prevent truncation)
      const useSize = safeSize && safeSize < opt.defaultChunkSize ? safeSize : opt.defaultChunkSize;
      setChunkSize(useSize);
      setChunkOverlap(Math.floor(useSize * 0.1));
    }
  };

  // Load existing knowledge on mount
  if (existingKnowledge === null && !loading) {
    loadExistingKnowledge();
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 p-3 bg-gradient-to-r from-violet-500/10 to-purple-500/10 border border-violet-500/20 rounded-lg">
        <BookOpen className="w-4 h-4 text-violet-500 shrink-0" />
        <div className="flex-1">
          <p className="text-xs text-muted-foreground">
            Sube archivos de <strong>conocimiento</strong> o <strong>backhistory</strong> para {characterName}.
            Este contenido se inyecta automáticamente como <code>[CONTEXTO RELEVANTE]</code> durante el chat.
          </p>
          <p className="text-[10px] text-muted-foreground/70 mt-0.5">
            Diferente de la memoria: el conocimiento es estático (subido por ti), la memoria es dinámica (extraída del chat).
          </p>
        </div>
      </div>

      {/* Namespace info */}
      <div className="flex items-center gap-2 p-2 rounded-md border border-violet-500/20 bg-violet-500/5 text-xs">
        <Database className="w-3 h-3 text-violet-500" />
        <span className="text-muted-foreground">Namespace:</span>
        <code className="text-violet-500 text-[10px]">{knowledgeNamespace}</code>
        {existingKnowledge && (
          <Badge variant="outline" className="text-[10px] h-4 border-violet-500/30 text-violet-500">
            {existingKnowledge.count} fragmentos
          </Badge>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-5 text-[10px] px-1.5 ml-auto"
          onClick={loadExistingKnowledge}
          disabled={loading}
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3 mr-0.5" />}
          Actualizar
        </Button>
      </div>

      {/* File upload */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Subir archivo de conocimiento</Label>
        <div className="flex items-center gap-2">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept=".txt,.md,.markdown,.json,.csv,.tsv,.log,.xml,.yaml,.yml,.html,.htm,.rtf,.text"
            onChange={handleFileUpload}
            disabled={uploading}
          />
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Subiendo...</>
            ) : (
              <><Upload className="w-3.5 h-3.5 mr-1.5" /> Seleccionar archivo</>
            )}
          </Button>
          {uploadedFile && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => setUploadedFile(null)}
            >
              Cancelar
            </Button>
          )}
        </div>

        {/* Uploaded file preview */}
        {uploadedFile && (
          <div className="p-3 rounded-md border bg-muted/30 space-y-2">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-violet-500" />
              <span className="text-sm font-medium">{uploadedFile.fileName}</span>
              <Badge variant="outline" className="text-[10px]">
                {uploadedFile.characterCount.toLocaleString()} chars
              </Badge>
            </div>

            {/* Preview content (truncated) */}
            <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2 max-h-32 overflow-y-auto">
              {uploadedFile.content.slice(0, 500)}
              {uploadedFile.content.length > 500 && '...'}
            </div>

            {/* Advanced settings */}
            <div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px]"
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                {showAdvanced ? 'Ocultar' : 'Mostrar'} configuración avanzada
              </Button>
            </div>

            {showAdvanced && (
              <div className="space-y-3 p-2 border rounded-md bg-background">
                {/* FASE 16: Model context info */}
                {embeddingModel && (
                  <div className="flex items-center gap-2 p-1.5 rounded bg-muted/30 text-[10px]">
                    <Database className="w-3 h-3 text-violet-500 shrink-0" />
                    <span className="text-muted-foreground">Modelo:</span>
                    <code className="text-violet-500">{embeddingModel}</code>
                    {chunkRecommendation && (
                      <Badge variant="outline" className="text-[9px] h-3 ml-auto">
                        ctx: {chunkRecommendation.contextLength} tokens
                      </Badge>
                    )}
                  </div>
                )}

                <div className="space-y-1">
                  <Label className="text-[10px]">Método de división</Label>
                  <div className="flex gap-1">
                    {SPLITTER_OPTIONS.map(opt => (
                      <Button
                        key={opt.value}
                        variant={splitterType === opt.value ? 'default' : 'outline'}
                        size="sm"
                        className="h-6 text-[10px] flex-1"
                        onClick={() => handleSplitterChange(opt.value)}
                      >
                        {opt.label}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex justify-between items-center">
                      <Label className="text-[10px]">Tamaño de fragmento</Label>
                      <div className="flex items-center gap-1">
                        {chunkRecommendation && !chunkRecommendation.isSafe && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <AlertTriangle className="w-3 h-3 text-amber-500" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <p className="text-[10px]">{chunkRecommendation.warning}</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                        <span className="text-[10px] text-muted-foreground font-mono">{chunkSize}</span>
                      </div>
                    </div>
                    <Slider
                      value={[chunkSize]}
                      min={100}
                      max={2000}
                      step={50}
                      onValueChange={(v) => setChunkSize(v[0])}
                    />
                    {/* FASE 16: Recommended chunk size + auto-apply button */}
                    {chunkRecommendation && (
                      <div className="flex items-center gap-1 mt-1">
                        <span className="text-[9px] text-muted-foreground">
                          Recomendado: {chunkRecommendation.recommended}
                        </span>
                        {chunkSize !== chunkRecommendation.recommended && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-4 text-[9px] px-1"
                            onClick={() => {
                              setChunkSize(chunkRecommendation.recommended);
                              setChunkOverlap(Math.floor(chunkRecommendation.recommended * 0.1));
                            }}
                          >
                            <Zap className="w-2.5 h-2.5 mr-0.5" />
                            Auto
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="flex justify-between">
                      <Label className="text-[10px]">Superposición</Label>
                      <span className="text-[10px] text-muted-foreground font-mono">{chunkOverlap}</span>
                    </div>
                    <Slider
                      value={[chunkOverlap]}
                      min={0}
                      max={200}
                      step={10}
                      onValueChange={(v) => setChunkOverlap(v[0])}
                    />
                  </div>
                </div>

                {/* FASE 16: Warning when chunk size exceeds safe budget */}
                {chunkRecommendation && !chunkRecommendation.isSafe && (
                  <div className="flex items-start gap-1.5 p-1.5 rounded-md bg-amber-500/5 border border-amber-500/20 text-[10px]">
                    <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-amber-500/90">{chunkRecommendation.warning}</p>
                  </div>
                )}
              </div>
            )}

            {/* Create embeddings button */}
            <Button
              size="sm"
              className="w-full"
              onClick={handleCreateEmbeddings}
              disabled={creating}
            >
              {creating ? (
                <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Creando embeddings...</>
              ) : (
                <><Database className="w-3.5 h-3.5 mr-1.5" /> Agregar como conocimiento de {characterName}</>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* Existing knowledge list */}
      {existingKnowledge && existingKnowledge.count > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Conocimiento existente</Label>
            <Badge variant="outline" className="text-[10px]">
              {existingKnowledge.count} fragmentos
            </Badge>
          </div>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {existingKnowledge.embeddings.slice(0, 20).map((emb, idx) => {
              // Use firstChunk (from API) or content (fallback) — both may be undefined
              const previewContent = emb.firstChunk || emb.content || '';
              const displayName = emb.source_id || `Fragmento ${idx + 1}`;
              const chunkCount = emb.count || (emb.ids?.length ?? 1);
              return (
                <div
                  key={emb.id || emb.source_id || idx}
                  className="flex items-start gap-2 p-2 rounded-md border bg-muted/20 text-xs"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {displayName}
                      {chunkCount > 1 && (
                        <Badge variant="outline" className="text-[9px] h-3 ml-1 px-1">
                          {chunkCount} fragmentos
                        </Badge>
                      )}
                    </p>
                    {previewContent && (
                      <p className="text-muted-foreground text-[10px] line-clamp-2 mt-0.5">
                        {previewContent.slice(0, 150)}{previewContent.length > 150 ? '...' : ''}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 shrink-0"
                    onClick={() => {
                      // Delete by source_id if available (deletes all chunks of this file)
                      if (emb.source_id) {
                        handleDeleteKnowledge(emb.source_id);
                      } else if (emb.id) {
                        handleDeleteKnowledge(emb.id);
                      }
                    }}
                  >
                    <Trash2 className="w-3 h-3 text-destructive" />
                  </Button>
                </div>
              );
            })}
            {existingKnowledge.count > 20 && (
              <p className="text-[10px] text-muted-foreground text-center py-1">
                Y {existingKnowledge.count - 20} más...
              </p>
            )}
          </div>
        </div>
      )}

      {/* Help text */}
      <div className="flex items-start gap-2 p-2 rounded-md bg-blue-500/5 border border-blue-500/20 text-xs">
        <HelpCircle className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
        <div className="text-muted-foreground">
          <p className="font-medium text-blue-500">¿Cómo funciona?</p>
          <ul className="mt-1 space-y-0.5 list-disc list-inside">
            <li>El archivo se divide en fragmentos y se vectoriza</li>
            <li>Se guarda en el namespace <code>character-{characterId.slice(0, 8)}...</code></li>
            <li>Durante el chat, se busca automáticamente y se inyecta como <code>[CONTEXTO RELEVANTE]</code></li>
            <li>Es diferente de la memoria: el conocimiento es estático, la memoria es dinámica</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
