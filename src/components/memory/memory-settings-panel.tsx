'use client';

import { useTavernStore } from '@/store/tavern-store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Brain,
  MessageSquare,
  Users,
  Settings2,
  RotateCcw,
  ChevronDown,
  FileText,
  Save,
  Sparkles,
  Clock,
  Info,
  Database,
  User,
  Layers,
  Settings,
  Pencil,
  Eye,
  Trash2,
  AlertTriangle,
  History,
  Activity,
  RefreshCw,
  DatabaseZap,
} from 'lucide-react';
import { useState, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { DEFAULT_SUMMARY_SETTINGS } from '@/types';
import { toast } from 'sonner';
import { DEFAULT_EMBEDDINGS_CHAT } from '@/lib/embeddings/constants';
import { SummaryViewer } from '@/components/memory/summary-viewer';

// ============================================
// Preview data for extraction prompts
// ============================================

const NORMAL_PREVIEW = {
  characterName: 'Alvar',
  chatContext: 'Contexto reciente de la conversación:\n  Alex: "Me acabo de mudar a la costa, tengo un gato llamado Milo"\n  Alvar: "¡Qué genial! ¿Y cómo te va adaptando?"\n',
  lastMessage: '"Milo se lleva súper bien con los vecinos."',
};

const GROUP_PREVIEW = {
  characterName: 'Kai',
  chatContext: 'Contexto reciente del grupo:\n  Alex: "¿Qué opinan del plan de Luna?"\n  Luna: "Yo creo que deberíamos ir por la ruta norte, es más segura."\n  Rex: "No me fío, la última vez que fuimos por ahí casi nos atrapan."\n',
  lastMessage: '"Rex tiene razón en desconfiar, pero yo prefiero arriesgarme. Además, Kai tiene contactos en el norte que podrían ayudarnos."',
};

// ============================================
// Sub-tab 1: Resúmenes
// ============================================

function ResumenesTab() {
  const summarySettings = useTavernStore((s) => s.summarySettings);
  const setSummarySettings = useTavernStore((s) => s.setSummarySettings);
  const activeSessionId = useTavernStore((s) => s.activeSessionId);

  const [promptEditorOpen, setPromptEditorOpen] = useState(false);

  // Ensure promptTemplate exists with default fallback
  const promptTemplate = summarySettings.promptTemplate ?? DEFAULT_SUMMARY_SETTINGS.promptTemplate ?? '';
  const [localPrompt, setLocalPrompt] = useState(promptTemplate);

  // Update local prompt when settings change
  const handlePromptSave = useCallback(() => {
    setSummarySettings({ promptTemplate: localPrompt });
    setPromptEditorOpen(false);
  }, [localPrompt, setSummarySettings]);

  // Reset prompt to default
  const handleResetPrompt = useCallback(() => {
    const defaultPrompt = DEFAULT_SUMMARY_SETTINGS.promptTemplate ?? '';
    setLocalPrompt(defaultPrompt);
    setSummarySettings({ promptTemplate: defaultPrompt });
  }, [setSummarySettings]);

  return (
    <div className="space-y-6">
      {/* Summary Viewer */}
      <SummaryViewer sessionId={activeSessionId ?? undefined} />

      {/* Main Enable/Disable */}
      <Card className="border-2">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Brain className="w-5 h-5 text-purple-500" />
            Sistema de Memoria y Resúmenes
          </CardTitle>
          <CardDescription>
            Genera resúmenes automáticos de la conversación para mantener contexto en chats largos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between p-4 rounded-lg bg-muted/50">
            <div className="space-y-0.5">
              <Label className="text-base font-medium">Activar Memoria</Label>
              <p className="text-sm text-muted-foreground">
                Genera resúmenes automáticos cuando la conversación alcance el límite configurado.
              </p>
            </div>
            <Switch
              checked={summarySettings.enabled}
              onCheckedChange={(enabled) => setSummarySettings({ enabled })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Message Interval Settings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="w-4 h-4 text-blue-500" />
            Intervalo de Resúmenes
          </CardTitle>
          <CardDescription>
            Define cada cuántos mensajes se generarán resúmenes automáticamente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Normal Chat Interval */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-muted-foreground" />
                <Label className="font-medium">Chat Normal</Label>
              </div>
              <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">
                {summarySettings.normalChatInterval} mensajes
              </span>
            </div>
            <Slider
              value={[summarySettings.normalChatInterval]}
              min={5}
              max={50}
              step={5}
              disabled={!summarySettings.enabled}
              onValueChange={([normalChatInterval]) =>
                setSummarySettings({ normalChatInterval })
              }
            />
            <p className="text-xs text-muted-foreground">
              Se generará un resumen cada {summarySettings.normalChatInterval} mensajes en chats individuales.
            </p>
          </div>

          {/* Group Chat Interval */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                <Label className="font-medium">Chat Grupal</Label>
              </div>
              <span className="text-sm font-mono bg-muted px-2 py-0.5 rounded">
                {summarySettings.groupChatInterval} mensajes
              </span>
            </div>
            <Slider
              value={[summarySettings.groupChatInterval]}
              min={5}
              max={40}
              step={5}
              disabled={!summarySettings.enabled}
              onValueChange={([groupChatInterval]) =>
                setSummarySettings({ groupChatInterval })
              }
            />
            <p className="text-xs text-muted-foreground">
              Se generará un resumen cada {summarySettings.groupChatInterval} mensajes en chats grupales.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Summary Settings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings2 className="w-4 h-4 text-green-500" />
            Configuración de Resumen
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Messages to keep */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm">Mensajes recientes a conservar</Label>
              <Input
                type="number"
                value={summarySettings.keepRecentMessages}
                onChange={(e) =>
                  setSummarySettings({ keepRecentMessages: parseInt(e.target.value) || 10 })
                }
                disabled={!summarySettings.enabled}
                min={5}
                max={50}
                className="h-9"
              />
              <p className="text-xs text-muted-foreground">
                Estos mensajes no se incluirán en el resumen.
              </p>
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Tokens máx. del resumen</Label>
              <Input
                type="number"
                value={summarySettings.maxSummaryTokens}
                onChange={(e) =>
                  setSummarySettings({ maxSummaryTokens: parseInt(e.target.value) || 500 })
                }
                disabled={!summarySettings.enabled}
                min={100}
                max={2000}
                step={100}
                className="h-9"
              />
              <p className="text-xs text-muted-foreground">
                Límite de tokens para el resumen generado.
              </p>
            </div>
          </div>

          {/* Behavior toggles */}
          <div className="space-y-3 pt-2">
            <label className="flex items-center justify-between p-3 rounded-lg border cursor-pointer hover:bg-muted/50">
              <div className="space-y-0.5">
                <Label className="text-sm">Resumir al fin de turno</Label>
                <p className="text-xs text-muted-foreground">
                  Generar resumen después de que todos los personajes respondan (grupos).
                </p>
              </div>
              <Switch
                checked={summarySettings.summarizeOnTurnEnd}
                onCheckedChange={(summarizeOnTurnEnd) =>
                  setSummarySettings({ summarizeOnTurnEnd })
                }
                disabled={!summarySettings.enabled}
              />
            </label>

            <label className="flex items-center justify-between p-3 rounded-lg border cursor-pointer hover:bg-muted/50">
              <div className="space-y-0.5">
                <Label className="text-sm">Incluir pensamientos internos</Label>
                <p className="text-xs text-muted-foreground">
                  Incluir pensamientos y reflexiones de los personajes en el resumen.
                </p>
              </div>
              <Switch
                checked={summarySettings.includeCharacterThoughts}
                onCheckedChange={(includeCharacterThoughts) =>
                  setSummarySettings({ includeCharacterThoughts })
                }
                disabled={!summarySettings.enabled}
              />
            </label>

            <label className="flex items-center justify-between p-3 rounded-lg border cursor-pointer hover:bg-muted/50">
              <div className="space-y-0.5">
                <Label className="text-sm">Preservar momentos emocionales</Label>
                <p className="text-xs text-muted-foreground">
                  Destacar momentos emocionales importantes en el resumen.
                </p>
              </div>
              <Switch
                checked={summarySettings.preserveEmotionalMoments}
                onCheckedChange={(preserveEmotionalMoments) =>
                  setSummarySettings({ preserveEmotionalMoments })
                }
                disabled={!summarySettings.enabled}
              />
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Prompt Template Editor */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="w-4 h-4 text-orange-500" />
            Prompt de Resumen
          </CardTitle>
          <CardDescription>
            Personaliza el prompt que se envía al LLM para generar resúmenes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Collapsible open={promptEditorOpen} onOpenChange={setPromptEditorOpen}>
            <CollapsibleTrigger asChild>
              <Button
                variant="outline"
                className="w-full justify-between"
                disabled={!summarySettings.enabled}
              >
                <span className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  Editar Prompt Personalizado
                </span>
                <ChevronDown className={cn(
                  "w-4 h-4 transition-transform",
                  promptEditorOpen && "rotate-180"
                )} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-4 space-y-4">
              <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-sm">
                <div className="flex items-start gap-2">
                  <Info className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-blue-600 dark:text-blue-400 space-y-1">
                    <p><strong>Variables disponibles:</strong></p>
                    <ul className="list-disc list-inside space-y-0.5">
                      <li><code className="bg-blue-500/20 px-1 rounded">{'{{conversation}}'}</code> - Se reemplaza con la conversación a resumir</li>
                    </ul>
                  </div>
                </div>
              </div>

              <Textarea
                value={localPrompt}
                onChange={(e) => setLocalPrompt(e.target.value)}
                disabled={!summarySettings.enabled}
                placeholder="Escribe tu prompt personalizado..."
                className="min-h-[200px] font-mono text-sm"
              />

              <div className="flex items-center justify-between">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!summarySettings.enabled}
                    >
                      <RotateCcw className="w-4 h-4 mr-2" />
                      Restaurar Default
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Restaurar prompt por defecto?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Esto reemplazará tu prompt personalizado con el prompt por defecto. Esta acción no se puede deshacer.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={handleResetPrompt}>
                        Restaurar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                <Button
                  size="sm"
                  onClick={handlePromptSave}
                  disabled={!summarySettings.enabled || localPrompt === promptTemplate}
                >
                  <Save className="w-4 h-4 mr-2" />
                  Guardar Cambios
                </Button>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Prompt Preview */}
          {!promptEditorOpen && (
            <div className="mt-3">
              <Label className="text-xs text-muted-foreground mb-2 block">Vista previa del prompt:</Label>
              <div className="p-3 rounded-lg bg-muted/50 text-xs font-mono max-h-[100px] overflow-y-auto text-muted-foreground">
                {promptTemplate.length > 300
                  ? `${promptTemplate.slice(0, 300)}...`
                  : promptTemplate
                }
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Sub-tab 2: Extracción
// ============================================

function ExtraccionTab() {
  const settings = useTavernStore((s) => s.settings);
  const embeddingsChat = settings.embeddingsChat ?? DEFAULT_EMBEDDINGS_CHAT;
  const updateSettings = useTavernStore((state) => state.updateSettings);

  // Context settings with defaults
  const contextSettings = settings.context ?? {
    maxMessages: 50,
    maxTokens: 4096,
    keepFirstN: 1,
    keepLastN: 20,
  };

  // Update context settings helper
  const updateContextSettings = useCallback((updates: Partial<typeof contextSettings>) => {
    updateSettings({
      context: { ...contextSettings, ...updates }
    });
  }, [contextSettings, updateSettings]);

  return (
    <div className="space-y-6">
      {/* Note about needing Embeddings enabled */}
      <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-4">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-amber-600 dark:text-amber-400">Requiere Embeddings</p>
            <p className="text-xs text-muted-foreground">
              Estos ajustes requieren la infraestructura de embeddings (Ollama + LanceDB). Configúralo en <strong>Ajustes → Conocimiento</strong>.
            </p>
          </div>
        </div>
      </div>

      {/* Memory Extraction Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="w-4 h-4 text-violet-500" />
            Extracción Automática (Memoria V2)
          </CardTitle>
          <CardDescription>
            Memoria V2: tras cada N turnos, una única pasada LLM analiza el intercambio completo (usuario + personaje) y guarda hechos, eventos y emociones en la tienda unificada
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm">Activar Extracción</Label>
              <p className="text-[10px] text-muted-foreground">
                Extrae automáticamente recuerdos (ops ADD/UPDATE/DELETE) del intercambio completo
              </p>
            </div>
            <Switch
              checked={!!embeddingsChat.memoryExtractionEnabled}
              onCheckedChange={(enabled) => {
                updateSettings({
                  embeddingsChat: { ...embeddingsChat, memoryExtractionEnabled: enabled },
                });
              }}
            />
          </div>

          {embeddingsChat.memoryExtractionEnabled && (
            <div className="space-y-3 pl-1 border-l-2 border-violet-300/30">
              <div className="space-y-2">
                <Label className="text-xs">Frecuencia: cada {embeddingsChat.memoryExtractionFrequency || 5} turnos</Label>
                <Slider
                  value={[embeddingsChat.memoryExtractionFrequency || 5]}
                  min={1}
                  max={20}
                  step={1}
                  onValueChange={([v]) => {
                    updateSettings({
                      embeddingsChat: { ...embeddingsChat, memoryExtractionFrequency: v },
                    });
                  }}
                />
                <p className="text-[10px] text-muted-foreground">
                  Un turno = 1 mensaje del usuario + respuesta(s). Más frecuente = más contexto, pero más uso del LLM.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Importancia mínima: {embeddingsChat.memoryExtractionMinImportance || 2}/5</Label>
                <Slider
                  value={[embeddingsChat.memoryExtractionMinImportance || 2]}
                  min={1}
                  max={5}
                  step={1}
                  onValueChange={([v]) => {
                    updateSettings({
                      embeddingsChat: { ...embeddingsChat, memoryExtractionMinImportance: v },
                    });
                  }}
                />
                <p className="text-[10px] text-muted-foreground">
                  Solo se guardan hechos con importancia igual o mayor. Más alto = solo lo más relevante.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs">Profundidad de contexto: {embeddingsChat.memoryExtractionContextDepth ?? 2} mensajes</Label>
                <Slider
                  value={[embeddingsChat.memoryExtractionContextDepth ?? 2]}
                  min={0}
                  max={5}
                  step={1}
                  onValueChange={([v]) => {
                    updateSettings({
                      embeddingsChat: { ...embeddingsChat, memoryExtractionContextDepth: v },
                    });
                  }}
                />
                <p className="text-[10px] text-muted-foreground">
                  Cuántos mensajes recientes incluir como contexto para el LLM. 0 = solo la respuesta del personaje. Más contexto = mejor comprensión de referencias, pero más tokens.
                </p>
              </div>

              <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <Brain className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-amber-600 dark:text-amber-400">Memoria con Contexto</p>
                    <ul className="text-[10px] text-muted-foreground space-y-0.5 list-disc list-inside">
                      <li>Se incluyen los últimos N mensajes como contexto para que el LLM entienda referencias implícitas</li>
                      <li>En grupo, cada personaje ve las respuestas de los demás para capturar dinámicas de conversación</li>
                      <li>La extracción es asíncrona — no afecta la velocidad de respuesta</li>
                    </ul>
                  </div>
                </div>
              </div>

            </div>
          )}
        </CardContent>
      </Card>

      {/* Separate Extraction Model Section */}
      {embeddingsChat.memoryExtractionEnabled && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings className="w-4 h-4 text-teal-500" />
              Modelo de Extracción Separado
            </CardTitle>
            <CardDescription>
              Usa un modelo diferente (más rápido/barato) para extracción y consolidación de memoria
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm">Usar modelo separado</Label>
                <p className="text-[10px] text-muted-foreground">
                  Desvía la carga de extracción a un modelo más eficiente
                </p>
              </div>
              <Switch
                checked={!!embeddingsChat.extractionModelEnabled}
                onCheckedChange={(enabled) => {
                  updateSettings({
                    embeddingsChat: { ...embeddingsChat, extractionModelEnabled: enabled },
                  });
                }}
              />
            </div>

            {embeddingsChat.extractionModelEnabled && (
              <div className="space-y-3 pl-1 border-l-2 border-teal-300/30">
                <div className="space-y-2">
                  <Label className="text-xs">Proveedor</Label>
                  <Select
                    value={embeddingsChat.extractionModelProvider || 'ollama'}
                    onValueChange={(v) => {
                      updateSettings({
                        embeddingsChat: { ...embeddingsChat, extractionModelProvider: v },
                      });
                    }}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ollama">Ollama (Local)</SelectItem>
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="grok">Grok (xAI)</SelectItem>
                      <SelectItem value="anthropic">Anthropic</SelectItem>
                      <SelectItem value="z-ai">Z-AI</SelectItem>
                      <SelectItem value="lm-studio">LM Studio</SelectItem>
                      <SelectItem value="text-generation-webui">Text Generation WebUI</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Endpoint (for providers that need it) */}
                {!['z-ai'].includes(embeddingsChat.extractionModelProvider || 'ollama') && (
                  <div className="space-y-2">
                    <Label className="text-xs">Endpoint</Label>
                    <Input
                      type="text"
                      value={embeddingsChat.extractionModelEndpoint || 'http://localhost:11434'}
                      onChange={(e) => {
                        updateSettings({
                          embeddingsChat: { ...embeddingsChat, extractionModelEndpoint: e.target.value },
                        });
                      }}
                      className="h-8 text-sm"
                      placeholder="http://localhost:11434"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      URL del servidor del modelo de extracción
                    </p>
                  </div>
                )}

                {/* API Key (for providers that need it) */}
                {['openai', 'grok', 'anthropic', 'custom'].includes(embeddingsChat.extractionModelProvider || 'ollama') && (
                  <div className="space-y-2">
                    <Label className="text-xs">API Key</Label>
                    <Input
                      type="password"
                      value={embeddingsChat.extractionModelApiKey || ''}
                      onChange={(e) => {
                        updateSettings({
                          embeddingsChat: { ...embeddingsChat, extractionModelApiKey: e.target.value },
                        });
                      }}
                      className="h-8 text-sm"
                      placeholder="sk-..."
                    />
                    <p className="text-[10px] text-muted-foreground">
                      Clave API para el proveedor seleccionado
                    </p>
                  </div>
                )}

                {/* Model name */}
                <div className="space-y-2">
                  <Label className="text-xs">Modelo</Label>
                  <Input
                    type="text"
                    value={embeddingsChat.extractionModelName || 'llama3.1:8b'}
                    onChange={(e) => {
                      updateSettings({
                        embeddingsChat: { ...embeddingsChat, extractionModelName: e.target.value },
                      });
                    }}
                    className="h-8 text-sm"
                    placeholder="llama3.1:8b"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Nombre del modelo para extracción. Se recomienda un modelo rápido y barato (ej: llama3.1:8b, gpt-4o-mini)
                  </p>
                </div>

                <div className="bg-teal-500/5 border border-teal-500/20 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <Settings className="w-4 h-4 text-teal-500 mt-0.5 shrink-0" />
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-teal-600 dark:text-teal-400">Modelo Separado</p>
                      <ul className="text-[10px] text-muted-foreground space-y-0.5 list-disc list-inside">
                        <li>La extracción y consolidación de memoria usan este modelo en lugar del modelo de chat</li>
                        <li>Ideal para usar un modelo local (Ollama) o barato (gpt-4o-mini) para tareas de fondo</li>
                        <li>Ahorra tokens y costo al no usar el modelo principal de chat para extracción</li>
                        <li>El modelo de extracción solo necesita entender texto y generar JSON</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Search Context Depth */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="w-4 h-4 text-cyan-500" />
            Contexto de Búsqueda
          </CardTitle>
          <CardDescription>
            Configura cuánto contexto se usa al buscar embeddings relevantes
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs">Contexto de búsqueda: {embeddingsChat.searchContextDepth ?? 1} mensajes</Label>
            <Slider
              value={[embeddingsChat.searchContextDepth ?? 1]}
              min={0}
              max={5}
              step={1}
              onValueChange={([v]) => {
                updateSettings({
                  embeddingsChat: { ...embeddingsChat, searchContextDepth: v },
                });
              }}
            />
            <p className="text-[10px] text-muted-foreground">
              Mensajes recientes que se agregan a tu pregunta para enriquecer la búsqueda de embeddings. 0 = solo tu mensaje. Valores altos = mejores resultados con referencias implícitas ("¿recuerdas eso?").
            </p>
          </div>
        </CardContent>
      </Card>

      {/* How it works info box */}
      <div className="bg-violet-500/5 border border-violet-500/20 rounded-lg p-3">
        <div className="flex items-start gap-2">
          <Brain className="w-4 h-4 text-violet-500 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="text-xs font-medium text-violet-600 dark:text-violet-400">Cómo funciona</p>
            <ul className="text-[10px] text-muted-foreground space-y-0.5 list-disc list-inside">
              <li>Cuando envías un mensaje, el sistema genera un vector embedding de tu texto</li>
              <li>Si hay contexto de búsqueda, se concatena con tu mensaje para encontrar resultados más relevantes</li>
              <li>Busca en los namespaces seleccionados embeddings similares</li>
              <li>Los mejores resultados se inyectan en el prompt de la IA como contexto</li>
              <li>La IA usa este contexto para generar respuestas más informadas</li>
            </ul>
          </div>
        </div>
      </div>

      {/* NOTE (Memory V2): los prompts de extracción legacy fueron eliminados. La extracción V2 usa un prompt interno optimizado (merged pass, ops ADD/UPDATE/DELETE). */}
    </div>
  );
}

// ============================================
// Main Panel Component
// ============================================

export function MemorySettingsPanel() {
  return (
    <div className="space-y-4">
      <Tabs defaultValue="resumenes" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="resumenes" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <FileText className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Resúmenes</span>
            <span className="sm:hidden">Resum.</span>
          </TabsTrigger>
          <TabsTrigger value="extraccion" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <Brain className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Extracción y Contexto</span>
            <span className="sm:hidden">Ext. Ctx.</span>
          </TabsTrigger>
          <TabsTrigger value="v2" className="flex items-center gap-1.5 text-xs sm:text-sm">
            <DatabaseZap className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Memoria V2</span>
            <span className="sm:hidden">V2</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="resumenes" className="mt-4">
          <ResumenesTab />
        </TabsContent>

        <TabsContent value="extraccion" className="mt-4">
          <ExtraccionTab />
        </TabsContent>

        <TabsContent value="v2" className="mt-4">
          <MemoryV2Tab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================
// Memory V2 Tab — unified memory system status
// ============================================
// Health (backend/model/dim/counts), manual legacy→V2 migration and reinit
// after model changes. Records browser for the active character.

interface V2HealthData {
  backend: 'lancedb' | 'json';
  lancedbNative: boolean;
  model: string;
  dimension: number;
  meta: { model: string; dimension: number; needsReembed: boolean } | null;
  counts: { total: number; active: number; superseded: number; byType: Record<string, number> };
  ollama?: { reachable: boolean; model: string; dimension: number; contextLength?: number };
  error?: string;
}

interface V2RecordLite {
  id: string;
  type: string;
  content: string;
  source: 'auto' | 'curada';
  importance: number;
  eventDate: string;
  supersededBy: string;
}

const V2_TYPE_LABELS: Record<string, string> = {
  evento: 'Eventos',
  hecho: 'Hechos',
  preferencia: 'Preferencias',
  relacion: 'Relación',
  nota: 'Notas',
  resumen_escena: 'Resúmenes de escena',
};

function MemoryV2Tab() {
  const settings = useTavernStore((s) => (s.settings as any)?.embeddingsChat) || DEFAULT_EMBEDDINGS_CHAT;
  const updateSettings = useTavernStore((s) => s.updateSettings);
  const activeCharacterId = useTavernStore((s) => s.activeCharacterId);
  const activeCharacter = useTavernStore((s) => s.characters)?.find((c: any) => c.id === activeCharacterId);

  const [health, setHealth] = useState<V2HealthData | null>(null);
  const [records, setRecords] = useState<V2RecordLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [reiniting, setReiniting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<V2RecordLite[] | null>(null);

  const updateEmbeddingsChat = (updates: Record<string, unknown>) => {
    updateSettings({
      embeddingsChat: { ...settings, ...updates },
    } as any);
  };

  const loadHealth = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/memory/v2?action=health');
      const data = await res.json();
      if (data.success) setHealth(data.health);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRecords = useCallback(async () => {
    if (!activeCharacterId) return;
    try {
      const res = await fetch(`/api/memory/v2?action=records&charId=${encodeURIComponent(activeCharacterId)}&limit=200`);
      const data = await res.json();
      if (data.success) setRecords(data.records || []);
    } catch {
      /* silent */
    }
  }, [activeCharacterId]);

  // Initial load
  useEffect(() => {
    loadHealth();
    loadRecords();
  }, [loadHealth, loadRecords]);

  const runMigration = async () => {
    setMigrating(true);
    try {
      const res = await fetch('/api/memory/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'migrate', charId: activeCharacterId || undefined }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Migración completada: ${data.migrated} nuevos, ${data.skipped} ya existentes`);
        loadHealth();
        loadRecords();
      } else {
        toast.error(data.error || 'Migración fallida');
      }
    } catch {
      toast.error('Error de red durante la migración');
    } finally {
      setMigrating(false);
    }
  };

  const runReinit = async () => {
    setReiniting(true);
    try {
      const res = await fetch('/api/memory/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reinit' }),
      });
      const data = await res.json();
      if (data.success) {
        setHealth(data.health);
        toast.success(`Store reinicializado (backend: ${data.health?.backend || '?'})`);
        loadRecords();
      }
    } catch {
      toast.error('Error reinicializando el store');
    } finally {
      setReiniting(false);
    }
  };

  const runSearch = async () => {
    if (!activeCharacterId || !searchQuery.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/memory/v2?action=search&charId=${encodeURIComponent(activeCharacterId)}&query=${encodeURIComponent(searchQuery)}&limit=8`);
      const data = await res.json();
      if (data.success) {
        setSearchResults(data.results || []);
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  };

  const v2On = settings.memoryV2Enabled !== false;

  return (
    <div className="space-y-4">
      {/* Toggle */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <DatabaseZap className="w-4 h-4" />
            Memoria V2 (Sistema Unificado)
          </CardTitle>
          <CardDescription>
            Un solo almacén con extracción unificada (ADD/UPDATE/DELETE), fechas absolutas, eventos first-class e
            inyección particionada [HECHOS]/[EVENTOS]/[RELACIÓN]. Reemplaza la doble capa Memoria del Personaje + embeddings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Memoria V2 activada</Label>
              <p className="text-xs text-muted-foreground">
                Interruptor maestro único del sistema de memoria (hechos, eventos, emociones):
                controla la inyección en el prompt, la extracción automática y las tools del LLM.
                No depende de ningún otro ajuste. El Conocimiento (archivos indexados) y los
                Resúmenes (compresión de contexto) siguen funcionando por separado aunque la desactives.
              </p>
            </div>
            <Switch
              checked={v2On}
              onCheckedChange={(checked) => updateEmbeddingsChat({ memoryV2Enabled: checked })}
            />
          </div>

          <div className="flex items-center justify-between border-t border-border/40 pt-3">
            <div>
              <Label className="text-sm font-medium">Memoria entre sesiones</Label>
              <p className="text-xs text-muted-foreground">
                Al buscar recuerdos que inyectar, incluye también los guardados en sesiones
                anteriores de este personaje (y de este grupo). Desactívalo para que cada sesión
                tenga una memoria aislada — útil para roles independientes con el mismo personaje.
              </p>
            </div>
            <Switch
              checked={settings.crossSessionMemory !== false}
              onCheckedChange={(checked) => updateEmbeddingsChat({ crossSessionMemory: checked })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Health */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Estado del Store
            </span>
            <div className="flex gap-1.5">
              <Button variant="outline" size="sm" onClick={loadHealth} disabled={loading}>
                <RefreshCw className={cn('w-3.5 h-3.5 mr-1', loading && 'animate-spin')} />
                Actualizar
              </Button>
              <Button variant="outline" size="sm" onClick={runReinit} disabled={reiniting}>
                <RotateCcw className={cn('w-3.5 h-3.5 mr-1', reiniting && 'animate-spin')} />
                Reinit
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {health ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Backend activo</p>
                  <p className={cn('font-medium', health.backend === 'lancedb' ? 'text-green-600' : 'text-amber-600')}>
                    {health.backend === 'lancedb' ? 'LanceDB (vectores)' : 'JSON (fallback léxico)'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Módulo nativo</p>
                  <p className={cn('font-medium', health.lancedbNative ? 'text-green-600' : 'text-red-600')}>
                    {health.lancedbNative ? 'Disponible' : 'No disponible'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Modelo / Dim</p>
                  <p className="font-medium truncate">{health.model} · {health.dimension}d</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Ollama</p>
                  <p className={cn('font-medium', health.ollama?.reachable ? 'text-green-600' : 'text-red-600')}>
                    {health.ollama?.reachable ? 'Conectado' : 'Sin conexión'}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Registros activos</p>
                  <p className="font-medium">{health.counts.active} <span className="text-muted-foreground text-xs">({health.counts.total} totales, {health.counts.superseded} archivados)</span></p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Por tipo</p>
                  <p className="font-medium text-xs leading-4">
                    {Object.entries(health.counts.byType).map(([t, n]) => `${V2_TYPE_LABELS[t] || t}: ${n}`).join(' · ') || '—'}
                  </p>
                </div>
              </div>
              {health.meta?.needsReembed && (
                <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-xs">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
                  <span>
                    Cambio de modelo pendiente de re-embed (Ollama no estaba disponible). Pulsa <b>Reinit</b> cuando Ollama
                    esté activo para regenerar los vectores.
                  </span>
                </div>
              )}
              {health.error && (
                <p className="text-xs text-muted-foreground">Aviso de init: {health.error}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Cargando estado…</p>
          )}
        </CardContent>
      </Card>

      {/* Migration */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="w-4 h-4" />
            Migración Legacy → V2
          </CardTitle>
          <CardDescription>
            Importa la Memoria del Personaje (data/memory.json) y los embeddings legacy (namespaces) al store unificado.
            Es idempotente: los registros ya migrados se omiten.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="sm" onClick={runMigration} disabled={migrating}>
            <DatabaseZap className={cn('w-3.5 h-3.5 mr-1.5', migrating && 'animate-pulse')} />
            {migrating ? 'Migrando…' : 'Migrar datos legacy'}
          </Button>
        </CardContent>
      </Card>

      {/* Records browser + debug search */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Registros V2 de {activeCharacter?.name || '…'}</CardTitle>
          <CardDescription>Lo que el personaje realmente recuerda (store unificado, activeOnly).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="Buscar en la memoria (debug: prueba el reranking)…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              className="text-sm"
            />
            <Button size="sm" variant="outline" onClick={runSearch} disabled={!searchQuery.trim() || loading}>
              Buscar
            </Button>
          </div>

          {searchResults && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Resultados de búsqueda ({searchResults.length})</p>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {searchResults.length === 0 && <p className="text-xs text-muted-foreground">Sin resultados.</p>}
                {searchResults.map((r) => (
                  <div key={r.id} className="text-xs p-2 rounded bg-muted/50">
                    <span className="font-medium">{r.type}</span> · score {(r as any).score?.toFixed(2) || '?'}
                    <p>{r.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Separator />

          <div className="max-h-96 overflow-y-auto space-y-3 custom-scrollbar">
            {records.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Sin registros V2 todavía. Se crean automáticamente con la extracción de memoria, o migra los datos legacy.
              </p>
            ) : (
              Object.entries(
                records.reduce<Record<string, V2RecordLite[]>>((acc, r) => {
                  (acc[r.type] ||= []).push(r);
                  return acc;
                }, {})
              ).map(([type, recs]) => (
                <div key={type} className="space-y-1">
                  <p className="text-xs font-semibold">{V2_TYPE_LABELS[type] || type} ({recs.length})</p>
                  {recs.map((r) => (
                    <div key={r.id} className="text-xs p-2 rounded border bg-background">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        {r.source === 'curada' && (
                          <span className="px-1 py-0.5 rounded bg-violet-500/15 text-violet-600 dark:text-violet-300 text-[10px] font-medium">
                            fijado
                          </span>
                        )}
                        <span className="text-muted-foreground">
                          {r.eventDate ? new Date(r.eventDate).toLocaleDateString('es-MX') : '—'}
                        </span>
                      </div>
                      <p>{r.content}</p>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

