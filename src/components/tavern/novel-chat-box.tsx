'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useTavernStore } from '@/store/tavern-store';
import { ChatMessageBubble } from './chat-message';
import { MemoryV2Manager } from '@/components/memory/memory-v2-manager';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmojiPicker } from './emoji-picker';
import { StreamingText } from './streaming-text';
import { evaluateStatConditions } from '@/lib/sprites/condition-evaluator';
import { eventLogTypeLabel } from '@/lib/stats/event-log';
import { toast } from 'sonner';
import { useHotkeys, formatHotkey } from '@/hooks/use-hotkeys';
import {
  Send,
  Loader2,
  GripVertical,
  Settings,
  ChevronUp,
  ChevronDown,
  RotateCcw,
  Eraser,
  Users,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Database,
  DatabaseZap,
  ScrollText,
  Check,
  Circle,
  Target,
  Inbox,
  MessageSquare,
  Clock,
  User,
  Gift,
  Star,
  Lock,
  Play,
  Pause,
  Zap,
  List,
  Shuffle,
  Mic,
  Square,
  Ear,
  Radio,
  Volume2,
  VolumeX,
  Brain,
  Trash2,
  Plus,
  ShoppingCart,
  Heart,
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useIsMobile } from '@/hooks/use-mobile';
import type { ChatLayoutSettings, CharacterCard, CharacterGroup, Persona, ChatboxAppearanceSettings } from '@/types';
import { DEFAULT_CHATBOX_APPEARANCE, THEME_COLOR_PRESETS } from '@/types';
import { t } from '@/lib/i18n';
import { getItemTypeLabel, getRarityColor, getRarityBgColor } from '@/store/slices/inventorySlice';
import { QuickPetitions } from './user-solicitudes';
import { ThemeEffects, getThemeColors as getThemeColorsUtil } from './theme-effects';
import { useAudioRecorder, useAudioTranscription } from '@/hooks/use-audio-recorder';
import { useWakeWordDetection } from '@/hooks/use-wake-word-detection';
import { isGlobalMuted, setGlobalMuted } from '@/lib/audio/audio-mute-store';
import { pauseAllTimelines, resumeAllTimelines } from '@/hooks/use-timeline-sprite-sounds';
import { stopAllSoundTriggers } from '@/hooks/use-sound-triggers';
import { ttsService } from '@/lib/tts';
import { resolveTemplateVariables } from '@/lib/key-resolver';
import type { CharacterQuickReply, GroupQuickReply, QuickReplyAttributeModifier, QuickReplySpriteActivation, QuickReplyWardrobeAction, QuickReplyScenarioAction, SpritePackV2, TriggerCollection } from '@/types';
import { evaluatePackConditionalSprites, evaluateConditionalEntries } from '@/lib/sprites/condition-evaluator';
import { evaluateRequirements } from '@/store/slices/statsSlice';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { SessionActionBar } from './session-action-bar';

// Tab type for the chatbox
type ChatboxTab = 'chat' | 'solicitudes' | 'misiones' | 'memorias' | 'tienda';

interface NovelChatBoxProps {
  onSendMessage: (message: string) => void;
  isGenerating: boolean;
  /** Whether a proactive message is being generated (separate from isGenerating) */
  isGeneratingProactive?: boolean;
  /** FASE 11 v2: Force a proactive message now (manual trigger, bypasses timer). */
  onForceProactive?: () => void;
  /** FASE 11 v2: Whether proactive is enabled for the active character (for the toggle switch). */
  proactiveEnabled?: boolean;
  /** FASE 11 v2: Toggle proactive on/off for the active character without editing the card. */
  onToggleProactive?: (enabled: boolean) => void;
  /** FASE 11 v2: Whether proactive is available (character has proactiveAttribute configured). */
  proactiveAvailable?: boolean;
  /** Seconds until the next proactive message fires (null when inactive/not configured). */
  proactiveNextIn?: number | null;
  /** Why proactive is not active (null when active). */
  proactiveInactiveReason?: 'no_character' | 'not_configured' | 'group_chat' | 'no_session' | 'no_llm' | null;
  /** How many proactive messages have been sent this session. */
  proactiveSessionCount?: number;
  onStopGeneration?: () => void;
  onResetChat?: () => void;
  onClearChat?: () => void;
  onRegenerate?: (messageId: string) => void;
  onEdit?: (messageId: string, newContent: string) => void;
  onReplay?: (messageId: string, content: string, characterId?: string) => void;
  onSpeak?: (messageId: string, content: string, characterId?: string) => void;
  streamingContent?: string;
  streamingCharacter?: CharacterCard | null;
  streamingProgress?: { current: number; total: number } | null;
  isGroupMode?: boolean;
  activeGroup?: CharacterGroup | null;
  activeCharacter?: CharacterCard | null;
  characters?: CharacterCard[];
  activePersona?: Persona | null;
  /** Whether TTS is currently playing audio (used to pause KWS during TTS) */
  ttsPlaying?: boolean;
  /** Whether memory extraction is currently running (triggers auto-refresh of memories tab) */
  memoryExtracting?: boolean;
  /** Current session ID for session-scoped memory namespaces */
  sessionId?: string;
  /** Session action bar: open relationship graph */
  onOpenRelationships?: () => void;
  /** Session action bar: run the Director now */
  onRunDirector?: () => void;
  /** Session action bar: world clock state */
  worldClock?: import('@/lib/world/time').WorldClock | null;
  /** Session action bar: update world clock */
  onSetWorldTime?: (updates: { hour?: number; minute?: number; minutes?: number; season?: string; realTimeSync?: boolean; minutesPerTurn?: number; enabled?: boolean }) => void;
  /** Scene mode (controlled collapse): when provided, collapse is controlled from outside */
  isSceneMode?: boolean;
  /** Scene mode (controlled collapse): notify toggle requests */
  onSceneModeChange?: (collapsed: boolean) => void;
}

// Format memory date to relative time
function formatMemoryDate(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Ahora';
  if (minutes < 60) return `Hace ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Hace ${days}d`;
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

export function NovelChatBox({
  onSendMessage,
  isGenerating,
  isGeneratingProactive = false,
  onForceProactive,
  proactiveEnabled = false,
  onToggleProactive,
  proactiveAvailable = false,
  proactiveNextIn = null,
  proactiveInactiveReason = null,
  proactiveSessionCount = 0,
  onStopGeneration,
  onResetChat,
  onClearChat,
  onRegenerate,
  onEdit,
  onReplay,
  onSpeak,
  streamingContent = '',
  streamingCharacter = null,
  streamingProgress = null,
  isGroupMode = false,
  activeGroup = null,
  activeCharacter = null,
  characters = [],
  activePersona = null,
  ttsPlaying = false,
  memoryExtracting = false,
  sessionId,
  onOpenRelationships,
  onRunDirector,
  worldClock = null,
  onSetWorldTime,
  isSceneMode,
  onSceneModeChange,
}: NovelChatBoxProps) {
  const [input, setInput] = useState('');
  // Global audio mute state
  const [globalMuted, setGlobalMutedState] = useState(false);

  // Combined generation state: either regular or proactive generation is active
  const isAnyGenerating = isGenerating || isGeneratingProactive;

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const isMobile = useIsMobile();
  const [showSettings, setShowSettings] = useState(false);
  const [showVariables, setShowVariables] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  // Scene mode: collapse can be controlled from outside (SceneDock). The internal
  // state remains the source of truth when no controller is provided.
  const effectiveCollapsed = onSceneModeChange ? !!isSceneMode : isCollapsed;
  const toggleCollapsed = () => {
    if (onSceneModeChange) onSceneModeChange(!isSceneMode);
    else setIsCollapsed(!isCollapsed);
  };
  const [activeTab, setActiveTab] = useState<ChatboxTab>('chat');
  const [showAvailableQuests, setShowAvailableQuests] = useState(false);
  const [showAutoQuestConfig, setShowAutoQuestConfig] = useState(false);
  const [expandedQuestId, setExpandedQuestId] = useState<string | null>(null);
  
  // Unified Memorias tab state
  // (Memory V2: the legacy semantic-memories browser and the CharacterMemory
  //  mirror were removed. The tab shows: Memoria V2, Resúmenes and
  //  Resúmenes indexados.)
  const [localSummaries, setLocalSummaries] = useState<Array<{id: string; content: string; createdAt: string; tokens: number; messageRange: {start: number; end: number}}>>([]);
  const [embeddingsStatus, setEmbeddingsStatus] = useState<'unknown' | 'connected' | 'disconnected'>('unknown');
  const [summaryEmbeddings, setSummaryEmbeddings] = useState<Array<{id: string; content: string; namespace: string; metadata: Record<string, any>; created_at: string}>>([]);
  const [expandedMemSections, setExpandedMemSections] = useState<Record<string, boolean>>({ resumenes: true, v2: true });
  const [expandedSummaryId, setExpandedSummaryId] = useState<string | null>(null);
  // Memory V2 — unified store records (shown when the V2 pipeline is active)
  const [v2Count, setV2Count] = useState(0);
  const [v2RefreshTick, setV2RefreshTick] = useState(0);
  const [v2Backend, setV2Backend] = useState<string>('');
  
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0, left: 0, top: 0 });
  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 });

  const {
    activeSessionId,
    getActiveSession,
    settings,
    updateSettings,
    deleteMessage,
    swipeMessage,
    getSwipeCount,
    characters: allCharacters,
    questTemplates,
    questSettings,
    activateUserPeticion,
    getPendingUserSolicitudes,
    acceptUserSolicitud,
    rejectUserSolicitud,
    activateQuest,
    deactivateQuest,
    setQuestSettings,
    items,
    purchaseItem,
    getShopItems,
    batchUpdateCharacterStats,
    getAttributeValue,
    // Memory slice selectors
    summaries: storeSummaries,
    getSessionSummaries,
    summarySettings,
    deleteSummary,
  } = useTavernStore();

  // ASR config state (loaded from API)
  const [asrConfig, setAsrConfig] = useState<{
    model: string;
    language: string;
    enabled: boolean;
  }>({
    model: 'whisper-small',
    language: 'es',
    enabled: true,
  });

  // KWS config state
  const [kwsConfig, setKwsConfig] = useState<{
    enabled: boolean;
    language: string;
    sensitivity: 'low' | 'medium' | 'high';
    cooldownMs: number;
    silenceDurationMs: number;
    wakeWords: string[];
  }>({
    enabled: false,
    language: 'es-ES',
    sensitivity: 'medium',
    cooldownMs: 2000,
    silenceDurationMs: 1500,
    wakeWords: [],
  });

  // Get wake words from active character OR group members + global config.
  // Also builds a wake-word → character map so voice messages can be routed to
  // the right character: each character's full name (highest priority) and its
  // custom KWS keywords ("palabras clave") map to the character's canonical name.
  const { characterWakeWords, wakeWordOwnerMap } = useMemo(() => {
    const words: string[] = [];
    const ownerMap = new Map<string, string>(); // lowercase word -> canonical character name

    const registerWord = (word: string, ownerName?: string) => {
      const key = word.toLowerCase().trim();
      if (!key) return;
      if (ownerName && !ownerMap.has(key)) ownerMap.set(key, ownerName);
      words.push(word);
    };

    // Collect relevant characters: group members or the active character
    const relevantChars: CharacterCard[] = [];
    if (isGroupMode && activeGroup && characters.length > 0) {
      // GROUP MODE: all group members can be addressed by voice
      const groupCharacterIds = activeGroup.members?.map(m => m.characterId) || activeGroup.characterIds || [];

      for (const charId of groupCharacterIds) {
        const char = characters.find(c => c.id === charId);
        if (char?.name) {
          relevantChars.push(char);
        }
      }

      console.log('[KWS] Group mode - characters:', relevantChars.map(c => c.name));
    } else if (activeCharacter?.name) {
      // SINGLE CHARACTER MODE: only the active character
      relevantChars.push(activeCharacter);
      console.log('[KWS] Single mode - character:', activeCharacter.name);
    }

    // First pass: register each character's full name (highest priority)
    for (const char of relevantChars) {
      registerWord(char.name, char.name);
    }

    // Second pass: register per-character KWS keywords ("palabras clave")
    // e.g. Aitana la Licuadora → ["Aitana", "licuadora"]
    for (const char of relevantChars) {
      for (const keyword of char.kwsKeywords ?? []) {
        registerWord(keyword, char.name);
      }
    }

    // Add global wake words from config (no specific owner - routed as before)
    if (kwsConfig.wakeWords && kwsConfig.wakeWords.length > 0) {
      for (const word of kwsConfig.wakeWords) {
        registerWord(word);
      }
    }

    // Remove duplicates
    return { characterWakeWords: [...new Set(words)], wakeWordOwnerMap: ownerMap };
  }, [isGroupMode, activeGroup, activeCharacter, characters, kwsConfig.wakeWords]);

  // Wake Word Detection hook - Uses only Web Speech API (no Whisper needed)
  const {
    isListening: kwsListening,
    isCapturing: kwsCapturing,
    isPausedByTTS: kwsPausedByTTS,
    transcript: kwsTranscript,
    capturedMessage: kwsCapturedMessage,
    lastDetectedWord: kwsLastDetectedWord,
    error: kwsError,
    startListening: startKWS,
    stopListening: stopKWS,
  } = useWakeWordDetection({
    wakeWords: characterWakeWords,
    language: kwsConfig.language,
    silenceDurationMs: kwsConfig.silenceDurationMs,
    cooldownMs: kwsConfig.cooldownMs,
    ttsPlaying,
    onTranscriptUpdate: (transcript, isCapturing) => {
      console.log('[KWS] Transcript:', transcript, 'Capturing:', isCapturing);
    },
    onWakeWordDetected: (word) => {
      console.log('[KWS] Wake word detected:', word);
    },
    onMessageReady: (message, detectedWakeWord) => {
      // Message captured and silence detected - send automatically!
      console.log('[KWS] ✅ Message ready to send:', message, 'wake word:', detectedWakeWord);
      if (message.trim()) {
        // In group mode, prepend the detected wake word so the backend
        // can detect which character was mentioned
        if (isGroupMode && detectedWakeWord) {
          // If the wake word is a KWS keyword (or the name) of a character,
          // prepend the character's CANONICAL name so the server-side mention
          // detection routes the message to them: the mentioned character
          // responds first according to the group's activation strategy.
          const ownerName = wakeWordOwnerMap.get(detectedWakeWord.toLowerCase().trim());
          const prefix = ownerName || detectedWakeWord;
          const messageWithWakeWord = `${prefix} ${message.trim()}`;
          console.log('[KWS] Group mode - sending with wake word:', messageWithWakeWord, '→ owner:', ownerName || '(none)');
          onSendMessage(messageWithWakeWord);
        } else {
          // Single mode - send message as-is
          onSendMessage(message.trim());
        }
      }
    },
  });

  // Derive KWS active state: true when listening or paused by TTS
  const kwsActive = kwsListening || kwsPausedByTTS;

  // Load ASR/KWS config on mount
  useEffect(() => {
    const loadAsrConfig = async () => {
      try {
        const response = await fetch('/api/tts/config');
        if (response.ok) {
          const data = await response.json();
          if (data.config?.asr) {
            setAsrConfig({
              model: data.config.asr.model || 'whisper-small',
              language: data.config.asr.language || 'es',
              enabled: data.config.asr.enabled ?? true,
            });
          }
          // Load KWS config
          if (data.config?.kws) {
            setKwsConfig(prev => ({
              ...prev,
              enabled: data.config.kws.enabled ?? false,
              language: data.config.kws.language || 'es-ES',
              sensitivity: data.config.kws.sensitivity || 'medium',
              cooldownMs: data.config.kws.cooldownMs || 2000,
              silenceDurationMs: data.config.vad?.silenceDurationMs || 1500,
              wakeWords: data.config.kws.wakeWords || [],
            }));
          }
        }
      } catch (error) {
        console.error('[NovelChatBox] Failed to load ASR config:', error);
      }
    };
    loadAsrConfig();
  }, []);

  // Handle KWS toggle
  const handleKWSToggle = useCallback(async () => {
    if (kwsActive) {
      stopKWS();
    } else {
      await startKWS();
    }
  }, [kwsActive, startKWS, stopKWS]);

  // Audio recording hooks
  const { transcribe, isTranscribing } = useAudioTranscription();
  
  const {
    isRecording,
    duration: recordingDuration,
    startRecording,
    stopRecording,
    audioBase64,
    reset: resetRecording,
    error: recordingError,
    permissionStatus,
    requestPermission,
    resetError,
  } = useAudioRecorder({
    maxDuration: 60000, // 60 seconds max
    onError: (error) => {
      console.error('[NovelChatBox] Recording error:', error);
    },
  });

  // Handle recording button click
  const handleRecordingClick = useCallback(async () => {
    if (isRecording) {
      stopRecording();
    } else if (permissionStatus === 'denied') {
      // Try to request permission again
      resetError();
      const granted = await requestPermission();
      if (!granted) {
        console.error('[NovelChatBox] Permission still denied');
      }
    } else {
      const success = await startRecording();
      if (!success) {
        console.error('[NovelChatBox] Failed to start recording');
      }
    }
  }, [isRecording, startRecording, stopRecording, permissionStatus, requestPermission, resetError]);

  // Show recording error feedback
  useEffect(() => {
    if (recordingError) {
      // Could show toast here if available
      console.error('[NovelChatBox] Recording error:', recordingError);
    }
  }, [recordingError]);

  const activeSession = getActiveSession();
  const layout = settings.chatLayout;
  const hotkeys = settings.hotkeys;

  // Get appearance settings
  const appearance = settings.chatboxAppearance || DEFAULT_CHATBOX_APPEARANCE;
  const safeAppearance = useMemo(() => ({
    ...DEFAULT_CHATBOX_APPEARANCE,
    ...appearance,
    enableAnimations: appearance?.enableAnimations ?? DEFAULT_CHATBOX_APPEARANCE.enableAnimations,
    enableParticles: appearance?.enableParticles ?? DEFAULT_CHATBOX_APPEARANCE.enableParticles,
    animationIntensity: appearance?.animationIntensity ?? DEFAULT_CHATBOX_APPEARANCE.animationIntensity,
    background: { ...DEFAULT_CHATBOX_APPEARANCE.background, ...appearance?.background },
    font: { ...DEFAULT_CHATBOX_APPEARANCE.font, ...appearance?.font },
    textFormatting: { ...DEFAULT_CHATBOX_APPEARANCE.textFormatting, ...appearance?.textFormatting },
    textColors: { ...DEFAULT_CHATBOX_APPEARANCE.textColors, ...appearance?.textColors },
    bubbles: { ...DEFAULT_CHATBOX_APPEARANCE.bubbles, ...appearance?.bubbles },
    avatars: { ...DEFAULT_CHATBOX_APPEARANCE.avatars, ...appearance?.avatars },
    streaming: { ...DEFAULT_CHATBOX_APPEARANCE.streaming, ...appearance?.streaming },
    input: { ...DEFAULT_CHATBOX_APPEARANCE.input, ...appearance?.input },
  }), [appearance]);

  // Helper function to convert hex color to rgba with transparency
  const hexToRgba = useCallback((hex: string, alpha: number): string => {
    const cleanHex = hex.replace('#', '');
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }, []);

  // Get session stats for the variables panel
  const sessionStats = activeSession?.sessionStats;

  // Inline relationship chip label: bond between the active character and the user
  const relationshipLabel = useMemo(() => {
    if (!sessionStats || !activeCharacter) return '15';
    const rels = sessionStats.relationships as Record<string, { points?: number }> | undefined;
    const pairKey = [activeCharacter.id, '__user__'].sort().join('|');
    const mirror = sessionStats.characterStats?.[activeCharacter.id]?.attributeValues?.['relacion'];
    const points = rels?.[pairKey]?.points
      ?? (typeof mirror === 'number' ? mirror : 15);
    return String(points);
  }, [sessionStats, activeCharacter]);
  
  // Get session quests for the quests panel
  const sessionQuests = activeSession?.sessionQuests || [];

  // Determine display name for header
  const headerName = isGroupMode 
    ? activeGroup?.name || t('chat.groupTitle')
    : activeCharacter?.name || t('chat.title');

  // Auto-scroll to bottom when new messages arrive or during streaming
  useEffect(() => {
    if (settings.autoScroll && messagesEndRef.current && activeTab === 'chat') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [activeSession?.messages, settings.autoScroll, isAnyGenerating, streamingContent, activeTab]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [input]);

  // Handle transcription when audio is ready
  useEffect(() => {
    if (!audioBase64 || isTranscribing) return;

    const processTranscription = async () => {
      console.log('[NovelChatBox] Processing transcription with model:', asrConfig.model);
      const result = await transcribe(audioBase64, {
        model: asrConfig.model,
        language: asrConfig.language,
      });

      if (result?.text) {
        // Set the transcribed text as input
        setInput(result.text);
        // Focus the textarea so user can edit if needed
        textareaRef.current?.focus();
      }

      // Reset recording state
      resetRecording();
    };

    processTranscription();
  }, [audioBase64, isTranscribing, transcribe, resetRecording, asrConfig]);

  // Handle recording error
  useEffect(() => {
    if (recordingError) {
      console.error('[NovelChatBox] Recording error:', recordingError);
    }
  }, [recordingError]);

  const updateLayout = useCallback((updates: Partial<ChatLayoutSettings>) => {
    updateSettings({
      chatLayout: {
        ...layout,
        ...updates
      }
    });
  }, [layout, updateSettings]);

  // Drag handlers
  const handleDragStart = (e: React.MouseEvent) => {
    if (effectiveCollapsed || isMobile) return;
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      left: layout.chatX,
      top: layout.chatY
    };
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleDragMove = (e: MouseEvent) => {
      const container = containerRef.current?.parentElement;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const deltaX = ((e.clientX - dragStartRef.current.x) / rect.width) * 100;
      const deltaY = ((e.clientY - dragStartRef.current.y) / rect.height) * 100;

      let newX = dragStartRef.current.left + deltaX;
      let newY = dragStartRef.current.top + deltaY;

      // Constrain to container bounds
      const halfWidth = layout.chatWidth / 2;
      const halfHeight = layout.chatHeight / 2;
      newX = Math.max(halfWidth, Math.min(100 - halfWidth, newX));
      newY = Math.max(halfHeight, Math.min(100 - halfHeight, newY));

      updateLayout({ chatX: newX, chatY: newY });
    };

    const handleDragEnd = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleDragMove);
    document.addEventListener('mouseup', handleDragEnd);

    return () => {
      document.removeEventListener('mousemove', handleDragMove);
      document.removeEventListener('mouseup', handleDragEnd);
    };
  }, [isDragging, layout.chatWidth, layout.chatHeight, updateLayout]);

  // Resize handlers
  const handleResizeStart = (e: React.MouseEvent) => {
    if (effectiveCollapsed || isMobile) return;
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(true);
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: layout.chatWidth,
      height: layout.chatHeight
    };
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleResizeMove = (e: MouseEvent) => {
      const container = containerRef.current?.parentElement;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const deltaX = ((e.clientX - resizeStartRef.current.x) / rect.width) * 100;
      const deltaY = ((e.clientY - resizeStartRef.current.y) / rect.height) * 100;

      let newWidth = Math.max(25, Math.min(90, resizeStartRef.current.width + deltaX * 2));
      let newHeight = Math.max(30, Math.min(90, resizeStartRef.current.height + deltaY * 2));

      updateLayout({ chatWidth: newWidth, chatHeight: newHeight });
    };

    const handleResizeEnd = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);

    return () => {
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
    };
  }, [isResizing, updateLayout]);

  // Toggle global audio mute
  const handleGlobalMuteToggle = useCallback(() => {
    const newMuted = !globalMuted;
    setGlobalMutedState(newMuted);
    setGlobalMuted(newMuted);
    if (newMuted) {
      // Stop any currently playing TTS when muting
      try { ttsService.stop(); } catch { /* ignore */ }
      // Pause ALL sprite timeline sounds and haptic tracks (can be resumed on unmute)
      pauseAllTimelines();
      // Stop ALL keyword-triggered sound queue playback
      stopAllSoundTriggers();
    } else {
      // Resume sprite timeline sounds and haptic tracks when unmuting
      resumeAllTimelines();
    }
  }, [globalMuted]);

  const handleSend = () => {
    if (!input.trim() || isAnyGenerating) return;
    onSendMessage(input.trim());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const sendKey = hotkeys.send || 'Enter';
    const newLineKey = hotkeys.newLine || 'Shift+Enter';
    
    // Check if this is the send hotkey
    const isSendKey = sendKey.toLowerCase() === 'enter' && e.key === 'Enter' && !e.shiftKey;
    const isNewLineKey = newLineKey.toLowerCase() === 'shift+enter' && e.key === 'Enter' && e.shiftKey;
    
    if (isSendKey) {
      e.preventDefault();
      handleSend();
    } else if (isNewLineKey) {
      // Let the default behavior (new line) happen
      return;
    }
  };

  // Hotkeys for regenerate and swipe (global)
  useHotkeys(hotkeys, {
    onRegenerate: () => {
      if (!isAnyGenerating && activeSession && activeSession.messages.length > 0) {
        // Get last assistant message
        const lastAssistantMsg = [...activeSession.messages].reverse().find(m => m.role === 'assistant' && !m.isDeleted);
        if (lastAssistantMsg) {
          // Trigger regenerate by deleting and resending
          deleteMessage(activeSessionId!, lastAssistantMsg.id);
          setInput('');
        }
      }
    },
    onSwipeLeft: () => {
      // Could be used for message swiping in future
    },
    onSwipeRight: () => {
      // Could be used for message swiping in future
    }
  }, !isAnyGenerating);

  // Apply attribute modifiers from a quick reply
  const applyQuickReplyModifiers = (modifiers: QuickReplyAttributeModifier[]) => {
    if (!activeSessionId || !activeCharacter?.id || modifiers.length === 0) return;
    const attributes = activeCharacter.statsConfig?.attributes || [];
    
    const updates: Array<{ attributeKey: string; value: number | string }> = [];
    
    for (const mod of modifiers) {
      const attr = attributes.find((a) => a.key === mod.attributeKey);
      if (!attr) continue;
      
      const currentValue = getAttributeValue(activeSessionId, activeCharacter.id, mod.attributeKey);
      const isNumeric = attr.type === 'number';
      
      if (isNumeric) {
        const current = typeof currentValue === 'number' ? currentValue : parseFloat(String(currentValue)) || 0;
        const modValue = typeof mod.value === 'number' ? mod.value : parseFloat(String(mod.value)) || 0;
        let newValue: number;
        
        switch (mod.operation) {
          case 'set': newValue = modValue; break;
          case 'add': newValue = current + modValue; break;
          case 'subtract': newValue = current - modValue; break;
          case 'multiply': newValue = current * modValue; break;
          case 'divide': newValue = modValue !== 0 ? current / modValue : current; break;
          default: newValue = current;
        }
        
        // Clamp to min/max
        if (attr.min !== undefined && newValue < attr.min) newValue = attr.min;
        if (attr.max !== undefined && newValue > attr.max) newValue = attr.max;
        
        updates.push({ attributeKey: mod.attributeKey, value: newValue });
      } else {
        // Text/keyword: only 'set' operation makes sense
        updates.push({ attributeKey: mod.attributeKey, value: String(mod.value) });
      }
    }
    
    if (updates.length > 0) {
      batchUpdateCharacterStats(activeSessionId, activeCharacter.id, updates, 'manual');
    }
  };

  // Activate sprite from a quick reply
  const activateQuickReplySprite = (activation: QuickReplySpriteActivation) => {
    if (!activeCharacter?.id || !activeSessionId) return;

    const characterId = activeCharacter.id;

    // Get current session stats (AFTER modifiers have been applied)
    const session = getActiveSession();
    const sessionStats = session?.sessionStats || null;

    if (activation.mode === 'trigger_collection') {
      // Find the trigger collection
      const collections = activeCharacter.triggerCollections || [];
      const collection = collections.find((c: TriggerCollection) => c.id === activation.targetId);
      if (!collection) {
        console.warn('[QuickReply] TriggerCollection not found:', activation.targetId);
        return;
      }

      // Find the pack referenced by the collection
      const packs = activeCharacter.spritePacksV2 || [];
      const pack = packs.find((p: SpritePackV2) => p.id === collection.packId);
      if (!pack) {
        console.warn('[QuickReply] SpritePackV2 not found for collection:', collection.packId);
        return;
      }

      // Determine which sprite to show
      let spriteUrl: string | null = null;
      let spriteLabel: string | null = null;

      // If collection has conditional mode, evaluate conditions
      if (collection.conditionalMode && collection.conditionalEntries && collection.conditionalEntries.length > 0) {
        const winner = evaluateConditionalEntries(collection.conditionalEntries, sessionStats, characterId);
        if (winner) {
          const sprite = pack.sprites.find((s: any) => s.id === winner.spriteId);
          if (sprite) {
            spriteUrl = sprite.url;
            spriteLabel = sprite.label;
          }
        }
      }

      // If pack has conditional mode and no sprite from collection conditions
      if (!spriteUrl && pack.conditionalMode) {
        const winner = evaluatePackConditionalSprites(pack.sprites, sessionStats, characterId);
        if (winner) {
          spriteUrl = winner.url;
          spriteLabel = winner.label;
        }
      }

      // Fallback: use principal sprite or first sprite
      if (!spriteUrl) {
        const principalId = collection.principalSpriteId;
        if (principalId) {
          const sprite = pack.sprites.find((s: any) => s.id === principalId);
          if (sprite) {
            spriteUrl = sprite.url;
            spriteLabel = sprite.label;
          }
        }
        if (!spriteUrl && pack.sprites.length > 0) {
          spriteUrl = pack.sprites[0].url;
          spriteLabel = pack.sprites[0].label;
        }
      }

      if (!spriteUrl) return;

      // Apply the trigger sprite
      const store = useTavernStore.getState();
      store.applyTriggerForCharacter(characterId, {
        packId: pack.id,
        collectionId: collection.id,
        spriteUrl,
        spriteLabel,
        returnToIdleMs: activation.fallbackDelayMs,
        useTimelineSounds: collection.useTimelineSounds,
      });

      // Schedule fallback
      if (activation.fallbackDelayMs > 0) {
        // Resolve fallback sprite URL
        let returnSpriteUrl = '';
        let returnSpriteLabel: string | null = null;

        if (activation.fallbackMode === 'idle_collection') {
          // Return to idle state (clear trigger, let state logic take over)
          returnSpriteUrl = '';
        } else if (activation.fallbackMode === 'custom_sprite' && activation.fallbackSpriteId) {
          const sprite = pack.sprites.find((s: any) => s.id === activation.fallbackSpriteId);
          if (sprite) {
            returnSpriteUrl = sprite.url;
            returnSpriteLabel = sprite.label;
          }
        } else if (activation.fallbackMode === 'collection_default') {
          const principalId = collection.principalSpriteId;
          if (principalId) {
            const sprite = pack.sprites.find((s: any) => s.id === principalId);
            if (sprite) {
              returnSpriteUrl = sprite.url;
              returnSpriteLabel = sprite.label;
            }
          }
        }

        const returnToMode = activation.fallbackMode === 'idle_collection' ? 'clear' : 'idle';
        store.scheduleReturnToIdleForCharacter(
          characterId,
          spriteUrl,
          returnToMode,
          returnSpriteUrl,
          returnSpriteLabel,
          activation.fallbackDelayMs
        );
      }

    } else if (activation.mode === 'sprite_pack') {
      // Find the sprite pack directly
      const packs = activeCharacter.spritePacksV2 || [];
      const pack = packs.find((p: SpritePackV2) => p.id === activation.targetId);
      if (!pack) {
        console.warn('[QuickReply] SpritePackV2 not found:', activation.targetId);
        return;
      }

      // Evaluate conditional sprites in the pack
      let spriteUrl: string | null = null;
      let spriteLabel: string | null = null;

      if (pack.conditionalMode) {
        const winner = evaluatePackConditionalSprites(pack.sprites, sessionStats, characterId);
        if (winner) {
          spriteUrl = winner.url;
          spriteLabel = winner.label;
        }
      }

      // Fallback to default sprite
      if (!spriteUrl && pack.defaultSpriteId) {
        const sprite = pack.sprites.find((s: any) => s.id === pack.defaultSpriteId);
        if (sprite) {
          spriteUrl = sprite.url;
          spriteLabel = sprite.label;
        }
      }

      // Fallback to isDefault sprite
      if (!spriteUrl) {
        const defaultSprite = pack.sprites.find((s: any) => s.isDefault);
        if (defaultSprite) {
          spriteUrl = defaultSprite.url;
          spriteLabel = defaultSprite.label;
        }
      }

      // Fallback to first sprite
      if (!spriteUrl && pack.sprites.length > 0) {
        spriteUrl = pack.sprites[0].url;
        spriteLabel = pack.sprites[0].label;
      }

      if (!spriteUrl) return;

      // Apply the trigger sprite
      const store = useTavernStore.getState();
      store.applyTriggerForCharacter(characterId, {
        packId: pack.id,
        spriteUrl,
        spriteLabel,
        returnToIdleMs: activation.fallbackDelayMs,
      });

      // Schedule fallback
      if (activation.fallbackDelayMs > 0) {
        let returnSpriteUrl = '';
        let returnSpriteLabel: string | null = null;

        if (activation.fallbackMode === 'custom_sprite' && activation.fallbackSpriteId) {
          const sprite = pack.sprites.find((s: any) => s.id === activation.fallbackSpriteId);
          if (sprite) {
            returnSpriteUrl = sprite.url;
            returnSpriteLabel = sprite.label;
          }
        }
        // For idle_collection and collection_default, clear the trigger

        const returnToMode = activation.fallbackMode === 'custom_sprite' ? 'idle' : 'clear';
        store.scheduleReturnToIdleForCharacter(
          characterId,
          spriteUrl,
          returnToMode,
          returnSpriteUrl,
          returnSpriteLabel,
          activation.fallbackDelayMs
        );
      }
    }
  };

  // Apply wardrobe action from a quick reply (Guardarropa V2)
  const applyQuickReplyWardrobe = (action: QuickReplyWardrobeAction) => {
    if (!activeSessionId || !activeCharacter?.id) return;
    const wardrobe = activeCharacter.wardrobeConfig;
    if (!wardrobe?.enabled || !wardrobe.outfits || wardrobe.outfits.length === 0) {
      console.warn('[QuickReply] Wardrobe not available for character:', activeCharacter.name);
      return;
    }

    if (action.action === 'remove') {
      useTavernStore.getState().setActiveOutfit(activeSessionId, activeCharacter.id, null);
      const defaultOutfit = wardrobe.outfits.find((o) => o.isDefault) || wardrobe.outfits[0];
      toast.info(`👕 ${activeCharacter.name} se quita el vestuario → ${defaultOutfit?.name || 'predeterminado'}`);
      return;
    }

    if (!action.outfitId) return;
    const outfit = wardrobe.outfits.find((o) => o.id === action.outfitId);
    if (!outfit) {
      console.warn('[QuickReply] Outfit not found:', action.outfitId);
      return;
    }
    useTavernStore.getState().setActiveOutfit(activeSessionId, activeCharacter.id, outfit.id);
    toast.info(`👕 ${activeCharacter.name} ahora lleva: ${outfit.name}`);
  };

  // Apply scenario action from a quick reply (ESCENARIO V2)
  // GROUP PRIORITY: in group chats the GROUP's scenarioConfig (when usable)
  // replaces the character's — quick replies move the shared group scene.
  const applyQuickReplyScenario = (action: QuickReplyScenarioAction) => {
    if (!activeSessionId) return;
    const groupScenario = isGroupMode ? activeGroup?.scenarioConfig : undefined;
    const scenario = (groupScenario?.enabled && groupScenario.locations?.length) ? groupScenario : activeCharacter?.scenarioConfig;
    if (!scenario?.enabled || !scenario.locations || scenario.locations.length === 0) {
      console.warn('[QuickReply] Scenario not available for:', isGroupMode ? (activeGroup?.name || 'group') : activeCharacter?.name);
      return;
    }

    if (!action.locationId) return;
    const location = scenario.locations.find((l) => l.id === action.locationId);
    if (!location) {
      console.warn('[QuickReply] Scenario location not found:', action.locationId);
      return;
    }
    useTavernStore.getState().setActiveScenario(activeSessionId, location.id);
    toast.info(`📍 La escena se mueve a: ${location.name}`);
  };

  const handleQuickReply = (item: CharacterQuickReply | GroupQuickReply) => {
    if (isAnyGenerating) return;
    // Resolve template variables like {{char}} and {{user}} in quick replies
    const resolutionContext = {
      user: activePersona?.name || 'User',
      char: activeCharacter?.name || 'Character',
    };

    // 1. Resolve the message to send: a matching umbral REPLACES the base response.
    //    Conditions are evaluated against the character's attributes BEFORE modifiers apply.
    let messageToSend = item.response.trim();
    if (item.umbrales && item.umbrales.length > 0 && activeSessionId && activeCharacter?.id) {
      const session = getActiveSession();
      const sessionStats = session?.sessionStats || null;
      const matchedUmbral = item.umbrales.find(
        (u) =>
          u.enabled &&
          u.message.trim() &&
          u.conditions.length > 0 &&
          evaluateStatConditions(u.conditions, sessionStats, activeCharacter.id, u.conditionOperator || 'AND')
      );
      if (matchedUmbral) {
        messageToSend = matchedUmbral.message.trim();
        toast.info(`🔀 Umbral: ${matchedUmbral.name || 'condición cumplida'}`);
      }
    }

    // Nothing to send (empty base response and no umbral matched)
    if (!messageToSend) return;
    const resolvedResponse = resolveTemplateVariables(messageToSend, resolutionContext);

    // 2. Apply attribute modifiers if any (BEFORE sprite activation so conditional sprites evaluate with new stats)
    if (item.modifiers && item.modifiers.length > 0) {
      applyQuickReplyModifiers(item.modifiers);
    }
    // 3. Activate sprite if configured
    if (item.spriteActivation) {
      activateQuickReplySprite(item.spriteActivation);
    }
    // 4. Apply wardrobe effect if configured
    if (item.wardrobeAction) {
      applyQuickReplyWardrobe(item.wardrobeAction);
    }
    // 4.5 Apply scenario effect if configured (ESCENARIO V2)
    if (item.scenarioAction) {
      applyQuickReplyScenario(item.scenarioAction);
    }

    // 5. Send the message (umbral text or base response)
    onSendMessage(resolvedResponse);
    setInput('');
  };

  // Get pending user solicitudes
  const pendingUserSolicitudes = activeSessionId 
    ? getPendingUserSolicitudes(activeSessionId)
    : [];

  // Handle user activating a peticion
  const handleActivatePeticion = (
    targetCharacterId: string,
    solicitudKey: string,
    description: string
  ) => {
    if (!activeSessionId) return;
    
    activateUserPeticion(
      activeSessionId,
      targetCharacterId,
      solicitudKey,
      description,
      activePersona?.name || 'Usuario'
    );
  };

  // Format relative time
  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Ahora';
    if (minutes < 60) return `Hace ${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Hace ${hours}h`;
    return `Hace ${Math.floor(hours / 24)}d`;
  };

  // Quest handlers
  const handleQuestToggle = (templateId: string, currentStatus: string) => {
    if (!activeSessionId) return;
    
    if (currentStatus === 'available') {
      activateQuest(activeSessionId, templateId);
    } else if (currentStatus === 'active') {
      deactivateQuest(activeSessionId, templateId);
    }
  };

  const handleAutoQuestChange = (updates: Partial<typeof questSettings>) => {
    setQuestSettings(updates);
  };

  // Priority colors for quests
  const priorityColors: Record<string, { bg: string; text: string; border: string; progress: string }> = {
    main: {
      bg: 'bg-amber-500/20',
      text: 'text-amber-400',
      border: 'border-amber-500/40',
      progress: 'bg-amber-500',
    },
    side: {
      bg: 'bg-blue-500/20',
      text: 'text-blue-400',
      border: 'border-blue-500/40',
      progress: 'bg-blue-500',
    },
    hidden: {
      bg: 'bg-slate-500/20',
      text: 'text-slate-400',
      border: 'border-slate-500/40',
      progress: 'bg-slate-500',
    },
  };

  // Get theme colors for tabs
  const getThemeColors = useCallback(() => {
    const theme = safeAppearance.theme;
    
    // Check special themes first
    if (theme in THEME_COLOR_PRESETS) {
      const preset = THEME_COLOR_PRESETS[theme];
      return { primary: preset.primary, secondary: preset.secondary };
    }
    
    const presets: Record<string, { primary: string; secondary: string }> = {
      default: { primary: '#3b82f6', secondary: '#6366f1' },
      midnight: { primary: '#6366f1', secondary: '#8b5cf6' },
      forest: { primary: '#22c55e', secondary: '#16a34a' },
      sunset: { primary: '#f97316', secondary: '#ef4444' },
      ocean: { primary: '#0ea5e9', secondary: '#06b6d4' },
      lavender: { primary: '#a855f7', secondary: '#d946ef' },
      cherry: { primary: '#ec4899', secondary: '#f43f5e' },
      custom: safeAppearance.customThemeColors || { primary: '#3b82f6', secondary: '#6366f1' },
    };
    return presets[theme] || presets.default;
  }, [safeAppearance.theme, safeAppearance.customThemeColors]);

  const themeColors = getThemeColors();

  // Load summaries from Zustand store
  const loadSummaries = useCallback(() => {
    if (!sessionId) {
      // No session filter — show all
      setLocalSummaries(storeSummaries.map(s => ({
        id: s.id,
        content: s.content,
        createdAt: s.createdAt,
        tokens: s.tokens,
        messageRange: s.messageRange,
      })));
      return;
    }
    const sessionSummaries = getSessionSummaries(sessionId);
    setLocalSummaries(sessionSummaries.map(s => ({
      id: s.id,
      content: s.content,
      createdAt: s.createdAt,
      tokens: s.tokens,
      messageRange: s.messageRange,
    })));
  }, [sessionId, storeSummaries, getSessionSummaries]);

  // Check embeddings / Ollama status
  const checkEmbeddingsStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/embeddings/stats');
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.data?.dbAvailable) {
          setEmbeddingsStatus('connected');
        } else {
          setEmbeddingsStatus('disconnected');
        }
      } else {
        setEmbeddingsStatus('disconnected');
      }
    } catch {
      setEmbeddingsStatus('disconnected');
    }
  }, []);

  // Load summary embeddings from LanceDB (source_type='summary')
  const loadSummaryEmbeddings = useCallback(async () => {
    try {
      const sessionSuffix = sessionId ? `-${sessionId}` : '';
      let namespacesToFetch: string[] = [];
      if (isGroupMode && activeGroup) {
        const memberIds = activeGroup.members?.map(m => m.characterId) || activeGroup.characterIds || [];
        namespacesToFetch = [
          `memory-group-${activeGroup.id}${sessionSuffix}`,
          ...memberIds.map(id => `memory-character-${id}${sessionSuffix}`),
        ];
        if (sessionSuffix) {
          namespacesToFetch.push(`memory-group-${activeGroup.id}`);
          namespacesToFetch.push(...memberIds.map(id => `memory-character-${id}`));
        }
      } else if (activeCharacter) {
        namespacesToFetch = [`memory-character-${activeCharacter.id}${sessionSuffix}`];
        if (sessionSuffix) {
          namespacesToFetch.push(`memory-character-${activeCharacter.id}`);
        }
      }
      if (namespacesToFetch.length === 0) {
        setSummaryEmbeddings([]);
        return;
      }
      const uniqueNamespaces = [...new Set(namespacesToFetch)];
      const results = await Promise.all(
        uniqueNamespaces.map(ns =>
          fetch(`/api/embeddings?namespace=${encodeURIComponent(ns)}&source_type=summary&limit=50`)
            .then(r => r.json())
            .then(data => (data.success ? data.data.embeddings : []))
            .catch(() => [])
        )
      );
      const seenIds = new Set<string>();
      const allSummaryEmb = results
        .flat()
        .filter((m: any) => {
          if (seenIds.has(m.id)) return false;
          seenIds.add(m.id);
          return true;
        })
        .sort((a: any, b: any) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      setSummaryEmbeddings(allSummaryEmb);
    } catch (error) {
      console.error('[NovelChatBox] Failed to load summary embeddings:', error);
      setSummaryEmbeddings([]);
    }
  }, [isGroupMode, activeGroup, activeCharacter, sessionId]);

  const deleteMemory = useCallback(async (memoryId: string) => {
    try {
      const response = await fetch(`/api/embeddings/${memoryId}`, { method: 'DELETE' });
      if (response.ok) {
        setSummaryEmbeddings(prev => prev.filter(m => m.id !== memoryId));
      }
    } catch (error) {
      console.error('[NovelChatBox] Failed to delete summary embedding:', error);
    }
  }, []);

  // Reset memory counts when character/group/session changes
  useEffect(() => {
    setV2Count(0);
  }, [activeCharacter?.id, activeGroup?.id, isGroupMode, sessionId]);

  // Memory V2 — signal the compact manager (inside the Memorias tab) to reload.
  // Also refresh the backend badge for the section header.
  const loadV2Records = useCallback(async () => {
    const hasScope = isGroupMode ? !!activeGroup?.id : !!activeCharacter?.id;
    if (!hasScope) return;
    setV2RefreshTick(t => t + 1);
    try {
      const res = await fetch('/api/memory/v2?action=health');
      const data = await res.json();
      if (data.success && data.health) setV2Backend(data.health.backend || '');
    } catch {
      /* silent — V2 records are informational */
    }
  }, [isGroupMode, activeCharacter?.id, activeGroup?.id]);

  // Load memories when tab is selected
  useEffect(() => {
    if (activeTab === 'memorias') {
      loadSummaries();
      checkEmbeddingsStatus();
      loadSummaryEmbeddings();
      loadV2Records();
    }
  }, [activeTab, loadSummaries, checkEmbeddingsStatus, loadSummaryEmbeddings, loadV2Records]);

  // Auto-refresh Memoria V2 after extraction completes
  // When memoryExtracting goes from true → false, wait a few seconds then refresh
  const prevExtractingRef = useRef(memoryExtracting);
  useEffect(() => {
    if (prevExtractingRef.current && !memoryExtracting) {
      // Extraction just finished — refresh after a delay
      const timer = setTimeout(() => {
        loadV2Records();
        loadSummaryEmbeddings();
      }, 3000);
      return () => clearTimeout(timer);
    }
    prevExtractingRef.current = memoryExtracting;
  }, [memoryExtracting, loadV2Records, loadSummaryEmbeddings]);


  if (!activeSession) return null;

  return (
    <div
      ref={containerRef}
      className={cn(
        "z-20 flex flex-col overflow-hidden transition-colors",
        // Desktop: floating, draggable, resizable chat box
        !isMobile && "absolute rounded-lg shadow-2xl",
        isMobile && "relative h-full w-full",
        !isMobile && isDragging && "cursor-grabbing",
        !isMobile && isResizing && "cursor-nwse-resize"
      )}
      style={{
        // Positioning & sizing: desktop uses percentage-based floating layout
        // Mobile uses full-width/height via CSS classes (relative h-full w-full)
        ...(isMobile ? {} : {
          left: `${layout.chatX}%`,
          top: `${layout.chatY}%`,
          transform: 'translate(-50%, -50%)',
          width: `${layout.chatWidth}%`,
          height: effectiveCollapsed ? 'auto' : `${layout.chatHeight}%`,
          minWidth: '280px',
          minHeight: effectiveCollapsed ? 'auto' : '180px',
          maxHeight: effectiveCollapsed ? 'auto' : '95vh',
        }),
        backgroundColor: safeAppearance.background.customBackgroundColor || `hsl(var(--background) / ${layout.chatOpacity})`,
        backdropFilter: safeAppearance.background.useGlassEffect ? `blur(${safeAppearance.background.blur}px)` : layout.blurBackground ? 'blur(12px)' : undefined,
        opacity: safeAppearance.background.transparency,
      }}
    >
      {/* Theme Effects Layer */}
      <ThemeEffects
        theme={safeAppearance.theme}
        enableAnimations={safeAppearance.enableAnimations}
        enableParticles={safeAppearance.enableParticles}
        intensity={safeAppearance.animationIntensity}
        className="z-0"
      />
      
      {/* Drag Handle / Header with Tabs */}
      <div
        className={cn(
          "flex flex-col bg-background/50 border-b select-none flex-shrink-0",
          !isMobile && "cursor-grab active:cursor-grabbing"
        )}
        onMouseDown={handleDragStart}
      >
        {/* Header Row */}
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2">
            <GripVertical className="w-4 h-4 text-muted-foreground" />
            
            {/* Avatar in header */}
            <div className="w-6 h-6 rounded-full overflow-hidden flex-shrink-0">
              {isGroupMode ? (
                <div className="w-full h-full bg-gradient-to-br from-violet-400 to-purple-600 flex items-center justify-center">
                  <Users className="w-3 h-3 text-white" />
                </div>
              ) : activeCharacter?.avatar ? (
                <img 
                  src={activeCharacter.avatar} 
                  alt={activeCharacter.name}
                  className="w-full h-full object-cover" 
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center">
                  <span className="text-white font-bold text-xs">
                    {activeCharacter?.name?.[0]?.toUpperCase() || '?'}
                  </span>
                </div>
              )}
            </div>
            
            <span className="text-sm font-medium truncate max-w-[100px]">
              {headerName}
            </span>

            {/* Inline relationship chip (💜 stage with the user) — opens graph on click */}
            {onOpenRelationships && (
              <button
                type="button"
                onClick={onOpenRelationships}
                className="flex items-center gap-1 px-1.5 h-5 rounded-full bg-fuchsia-500/10 border border-fuchsia-500/20 text-[10px] text-fuchsia-300 hover:bg-fuchsia-500/20 transition-colors whitespace-nowrap"
                title="Ver grafo de relaciones"
              >
                <Heart className="w-2.5 h-2.5" />
                <span className="tabular-nums">{relationshipLabel}</span>
              </button>
            )}
            
            {/* Turn count - only show on chat tab (1 turn = 1 user message) */}
            {activeTab === 'chat' && (
              <span className="text-xs text-muted-foreground">
                {activeSession.messages.filter(m => !m.isDeleted && m.role === 'user').length}{t('chat.turnsCount')}
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-1">
            {/* FASE 11 v2: Proactivo toggle + force button */}
            {onToggleProactive && (
              <TooltipProvider>
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-amber-500/20 bg-amber-500/5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1">
                        <Sparkles className={cn(
                          "w-3.5 h-3.5",
                          proactiveEnabled ? "text-amber-500" : "text-muted-foreground/50"
                        )} />
                        <Switch
                          checked={proactiveEnabled}
                          onCheckedChange={onToggleProactive}
                          disabled={!proactiveAvailable}
                          className="scale-75 origin-center"
                        />
                        {/* Discreet countdown indicator — shows time remaining until next proactive message */}
                        {proactiveEnabled && proactiveAvailable && !isGeneratingProactive && proactiveNextIn !== null && (
                          <span className={cn(
                            "text-[10px] font-mono tabular-nums select-none",
                            proactiveNextIn === 0
                              ? "text-amber-500 animate-pulse"
                              : "text-amber-400/70"
                          )}>
                            {proactiveNextIn === 0
                              ? '● Listo'
                              : `⏱ ${Math.floor(proactiveNextIn / 60)}:${String(proactiveNextIn % 60).padStart(2, '0')}`}
                          </span>
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      <p className="font-medium">Proactivo</p>
                      <p className="text-muted-foreground">
                        {!proactiveAvailable
                          ? 'Configura "Proactivo Condicional por Atributo" en el editor del personaje'
                          : proactiveEnabled
                            ? isGeneratingProactive
                              ? 'Generando mensaje proactivo...'
                              : (proactiveNextIn !== null && proactiveNextIn > 0
                                  ? `Próximo mensaje en ~${Math.floor(proactiveNextIn / 60)}:${String(proactiveNextIn % 60).padStart(2, '0')}`
                                  : proactiveNextIn === 0
                                    ? 'Listo para lanzar — esperando próxima verificación del timer'
                                    : 'Activado — el personaje tomará la iniciativa según el timer')
                            : 'Desactivado — el personaje no enviará mensajes automáticos'}
                      </p>
                      {proactiveEnabled && proactiveAvailable && proactiveSessionCount !== undefined && proactiveSessionCount > 0 && (
                        <p className="text-muted-foreground/70 mt-1">
                          {proactiveSessionCount} mensaje{proactiveSessionCount !== 1 ? 's' : ''} proactivo{proactiveSessionCount !== 1 ? 's' : ''} enviado{proactiveSessionCount !== 1 ? 's' : ''} esta sesión
                        </p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                  {/* Force proactive button */}
                  {proactiveEnabled && onForceProactive && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 p-0 hover:bg-amber-500/10"
                          onClick={onForceProactive}
                          disabled={isAnyGenerating}
                          title="Forzar mensaje proactivo ahora"
                        >
                          {isGeneratingProactive ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" />
                          ) : (
                            <Zap className="w-3.5 h-3.5 text-amber-500" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-xs">
                        <p className="font-medium">Forzar proactivo</p>
                        <p className="text-muted-foreground">
                          {isGeneratingProactive
                            ? 'Generando mensaje proactivo...'
                            : 'Envía un mensaje proactivo ahora (sin esperar el timer)'}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </TooltipProvider>
            )}

            {/* Session Action Bar: relationships / director / world clock */}
            {(onOpenRelationships || onRunDirector || onSetWorldTime) && (
              <SessionActionBar
                onOpenRelationships={() => onOpenRelationships?.()}
                onRunDirector={() => onRunDirector?.()}
                worldClock={worldClock}
                onSetWorldTime={(u) => onSetWorldTime?.(u)}
                compact
              />
            )}

            {/* Session Variables Popover */}
            <Popover open={showVariables} onOpenChange={setShowVariables}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <Database className="w-4 h-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 max-h-96 overflow-y-auto" align="end">
                <div className="space-y-3">
                  <h4 className="font-medium text-sm flex items-center gap-2">
                    <Database className="w-4 h-4" />
                    {t('chatbox.sessionVariables')}
                  </h4>
                  
                  {!sessionStats?.initialized && !sessionStats?.eventLog?.length ? (
                    <div className="text-center py-4 text-muted-foreground text-xs">
                      <Database className="w-6 h-6 mx-auto mb-2 opacity-50" />
                      {t('chatbox.noVariables')}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* For each character with stats */}
                      {Object.entries(sessionStats.characterStats).map(([charId, charStats]) => {
                        const character = allCharacters.find(c => c.id === charId);
                        if (!character) return null;
                        
                        const attributeValues = charStats.attributeValues;
                        const attributeDefs = character.statsConfig?.attributes || [];
                        
                        if (Object.keys(attributeValues).length === 0) return null;
                        
                        return (
                          <div key={charId} className="space-y-2">
                            {/* Character Header */}
                            <div className="flex items-center gap-2 pb-1 border-b">
                              <div className="w-5 h-5 rounded-full overflow-hidden">
                                {character.avatar ? (
                                  <img src={character.avatar} alt={character.name} className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center">
                                    <span className="text-white font-bold text-[10px]">{character.name?.[0]?.toUpperCase()}</span>
                                  </div>
                                )}
                              </div>
                              <span className="text-xs font-medium">{character.name}</span>
                            </div>
                            
                            {/* Attributes Grid */}
                            <div className="grid grid-cols-2 gap-1.5">
                              {Object.entries(attributeValues).map(([key, value]) => {
                                const attrDef = attributeDefs.find(a => a.key === key);
                                const icon = attrDef?.icon;
                                const color = attrDef?.color || 'default';
                                
                                const colorClasses: Record<string, string> = {
                                  red: 'bg-red-500/20 border-red-500/30 text-red-400',
                                  green: 'bg-green-500/20 border-green-500/30 text-green-400',
                                  blue: 'bg-blue-500/20 border-blue-500/30 text-blue-400',
                                  yellow: 'bg-yellow-500/20 border-yellow-500/30 text-yellow-400',
                                  purple: 'bg-purple-500/20 border-purple-500/30 text-purple-400',
                                  orange: 'bg-orange-500/20 border-orange-500/30 text-orange-400',
                                  cyan: 'bg-cyan-500/20 border-cyan-500/30 text-cyan-400',
                                  default: 'bg-white/10 border-white/20 text-white/80',
                                };
                                
                                return (
                                  <div
                                    key={key}
                                    className={cn(
                                      'flex items-center gap-1.5 px-2 py-1 rounded border text-xs',
                                      colorClasses[color] || colorClasses.default
                                    )}
                                  >
                                    {icon && <span className="text-xs">{icon}</span>}
                                    <span className="text-muted-foreground truncate">{attrDef?.name || key}:</span>
                                    <span className="font-medium">{String(value)}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                      
                      {/* Session Events Section — ring buffer ({{last_events}} + memoria) */}
                      <div className="space-y-2 pt-2 border-t">
                        <div className="flex items-center gap-2 pb-1">
                          <span className="text-xs font-medium text-amber-400">Eventos de Sesión</span>
                          <span className="text-[10px] text-muted-foreground ml-auto font-mono">{'{{last_events}}'}</span>
                        </div>
                        {(sessionStats.eventLog?.length ?? 0) === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            Sin eventos todavía. Se registran acciones, peticiones, objetivos, escenas y cambios de relación — y se guardan en la memoria del personaje.
                          </p>
                        ) : (
                          <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                            {[...(sessionStats.eventLog || [])].reverse().slice(0, 12).map(e => {
                              const d = new Date(e.timestamp);
                              const clock = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                              return (
                                <div key={e.id} className="px-2 py-1.5 rounded border bg-amber-500/5 border-amber-500/15 text-xs">
                                  <div className="flex items-center gap-1.5">
                                    <Badge variant="outline" className="h-4 px-1 text-[9px] border-amber-500/30 text-amber-400 font-normal">
                                      {eventLogTypeLabel(e.type)}
                                    </Badge>
                                    <span className="text-[10px] text-muted-foreground">
                                      {clock}{typeof e.turn === 'number' ? ` · turno ${e.turn}` : ''}
                                    </span>
                                  </div>
                                  <div className="mt-0.5 leading-snug">
                                    {e.characterName && (
                                      <span className="font-medium">
                                        {e.characterName}{e.targetName ? ` → ${e.targetName}` : ''}:{' '}
                                      </span>
                                    )}
                                    {e.description}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <p className="text-[10px] text-muted-foreground/70">
                          Los eventos se inyectan con <code className="font-mono">{'{{last_events}}'}</code> y se guardan en la memoria persistente del personaje.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>

            {/* Settings Popover */}
            <Popover open={showSettings} onOpenChange={setShowSettings}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <Settings className="w-4 h-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64" align="end">
                <div className="space-y-4">
                  <h4 className="font-medium text-sm">{t('chatbox.settings')}</h4>
                  
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">{t('chatbox.width')} {Math.round(layout.chatWidth)}%</label>
                    <Slider
                      value={[layout.chatWidth]}
                      onValueChange={([value]) => updateLayout({ chatWidth: value })}
                      min={25}
                      max={90}
                      step={1}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">{t('chatbox.height')} {Math.round(layout.chatHeight)}%</label>
                    <Slider
                      value={[layout.chatHeight]}
                      onValueChange={([value]) => updateLayout({ chatHeight: value })}
                      min={20}
                      max={90}
                      step={1}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">{t('chatbox.opacity')} {Math.round(layout.chatOpacity * 100)}%</label>
                    <Slider
                      value={[layout.chatOpacity * 100]}
                      onValueChange={([value]) => updateLayout({ chatOpacity: value / 100 })}
                      min={50}
                      max={100}
                      step={1}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <label className="text-xs text-muted-foreground">{t('chatbox.blurBackground')}</label>
                    <Button
                      variant={layout.blurBackground ? "default" : "outline"}
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => updateLayout({ blurBackground: !layout.blurBackground })}
                    >
                      {layout.blurBackground ? t('common.on') : t('common.off')}
                    </Button>
                  </div>

                  {/* Chat Actions */}
                  <div className="pt-2 border-t space-y-2">
                    <label className="text-xs text-muted-foreground">{t('chatbox.actions')}</label>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 h-7 text-xs"
                        onClick={() => {
                          setShowSettings(false);
                          onResetChat?.();
                        }}
                      >
                        <RotateCcw className="w-3 h-3 mr-1" />
                        {t('common.reset')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 h-7 text-xs text-destructive hover:text-destructive"
                        onClick={() => {
                          setShowSettings(false);
                          onClearChat?.();
                        }}
                      >
                        <Eraser className="w-3 h-3 mr-1" />
                        {t('common.clear')}
                      </Button>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      updateLayout({
                        chatWidth: 60,
                        chatHeight: 70,
                        chatX: 50,
                        chatY: 50,
                        chatOpacity: 0.95
                      });
                    }}
                  >
                    {t('chat.resetPosition')}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>

            {/* Collapse Button */}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={toggleCollapsed}
            >
              {effectiveCollapsed ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
        
        {/* Tab Bar */}
        {!effectiveCollapsed && (
          <div 
            className="flex items-center gap-0.5 px-2 pb-1.5 border-b border-border/50"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Chat Tab */}
            <button
              onClick={() => setActiveTab('chat')}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                activeTab === 'chat' 
                  ? "text-white shadow-sm" 
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
              style={activeTab === 'chat' ? {
                backgroundColor: themeColors.primary,
              } : undefined}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Chat</span>
            </button>
            
            {/* Solicitudes Tab */}
            <button
              onClick={() => setActiveTab('solicitudes')}
              className={cn(
                "relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                activeTab === 'solicitudes' 
                  ? "text-white shadow-sm" 
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
              style={activeTab === 'solicitudes' ? {
                backgroundColor: themeColors.primary,
              } : undefined}
            >
              <Inbox className="w-3.5 h-3.5" />
              <span>Solicitudes</span>
              {pendingUserSolicitudes.length > 0 && (
                <Badge 
                  className="ml-0.5 h-4 min-w-4 px-1 text-[9px] font-bold"
                  style={{ 
                    backgroundColor: activeTab === 'solicitudes' ? 'rgba(255,255,255,0.3)' : themeColors.primary,
                    color: 'white'
                  }}
                >
                  {pendingUserSolicitudes.length}
                </Badge>
              )}
            </button>
            
            {/* Misiones Tab */}
            <button
              onClick={() => setActiveTab('misiones')}
              className={cn(
                "relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                activeTab === 'misiones' 
                  ? "text-white shadow-sm" 
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
              style={activeTab === 'misiones' ? {
                backgroundColor: themeColors.primary,
              } : undefined}
            >
              <ScrollText className="w-3.5 h-3.5" />
              <span>Misiones</span>
              {sessionQuests.filter(q => q.status === 'active').length > 0 && (
                <Badge 
                  className="ml-0.5 h-4 min-w-4 px-1 text-[9px] font-bold"
                  style={{ 
                    backgroundColor: activeTab === 'misiones' ? 'rgba(255,255,255,0.3)' : themeColors.primary,
                    color: 'white'
                  }}
                >
                  {sessionQuests.filter(q => q.status === 'active').length}
                </Badge>
              )}
            </button>
            
            {/* Memorias Tab */}
            <button
              onClick={() => setActiveTab('memorias')}
              className={cn(
                "relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                activeTab === 'memorias' 
                  ? "text-white shadow-sm" 
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
              style={activeTab === 'memorias' ? {
                backgroundColor: themeColors.primary,
              } : undefined}
            >
              <Brain className="w-3.5 h-3.5" />
              <span>Memorias</span>
              {v2Count > 0 && (
                <span className="ml-0.5 text-[9px] tabular-nums text-muted-foreground/70">
                  {v2Count}
                </span>
              )}
            </button>
            
            {/* Tienda Tab */}
            <button
              onClick={() => setActiveTab('tienda')}
              className={cn(
                "relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                activeTab === 'tienda' 
                  ? "text-white shadow-sm" 
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
              style={activeTab === 'tienda' ? {
                backgroundColor: themeColors.primary,
              } : undefined}
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              <span>Tienda</span>
              {/* Currency as subtle text — NOT a notification badge (avoids false urgency) */}
              {(activePersona?.currency || 0) > 0 && (
                <span className="ml-0.5 text-[9px] tabular-nums text-amber-500/90">
                  💰 {activePersona?.currency}
                </span>
              )}
            </button>
          </div>
        )}
      </div>

      {/* SCENE MODE strip: when collapsed, show the last message as a
          cinematic subtitle so the sprite/background stays the protagonist */}
      {effectiveCollapsed && (() => {
        const lastMsg = [...(activeSession?.messages || [])]
          .filter(m => !m.isDeleted)
          .reverse()
          .find(m => m.role === 'assistant' && m.content?.trim());
        if (!lastMsg) return null;
        const speakerChar = lastMsg.characterId
          ? (characters || []).find(c => c.id === lastMsg.characterId)
          : activeCharacter || undefined;
        const speakerName = isGroupMode && lastMsg.characterId
          ? speakerChar?.name || headerName
          : headerName;
        return (
          <button
            type="button"
            onClick={() => (onSceneModeChange ? onSceneModeChange(false) : setIsCollapsed(false))}
            className="w-full flex items-start gap-2 px-3 py-2 text-left border-t border-border/40 hover:bg-muted/30 transition-colors group"
            title="Clic para expandir el chat"
          >
            <div className="w-5 h-5 rounded-full overflow-hidden flex-shrink-0 mt-0.5">
              {speakerChar?.avatar ? (
                <img src={speakerChar.avatar} alt={speakerName} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center">
                  <span className="text-white font-bold text-[9px]">{speakerName?.[0]?.toUpperCase() || '?'}</span>
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <span className="text-[10px] font-medium text-muted-foreground">
                {speakerName} · modo escena
              </span>
              <p className="text-xs leading-snug text-foreground/80 line-clamp-2 italic">
                "{lastMsg.content.trim().slice(0, 140)}{(lastMsg.content.trim().length || 0) > 140 ? '…' : ''}"
              </p>
            </div>
            <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/50 mt-1 group-hover:text-muted-foreground transition-colors flex-shrink-0" />
          </button>
        );
      })()}

      {/* Content Area */}
      {!effectiveCollapsed && (
        <>
          {/* Chat Tab Content */}
          {activeTab === 'chat' && (
            <>
              <ScrollArea className="flex-1 min-h-0" ref={scrollRef}>
                <div className="p-2 space-y-2">
                  {activeSession.messages.filter(m => {
                    // Filter deleted messages
                    if (m.isDeleted) return false;

                    // Check if this is a narrator message and if narrator is hidden from chat
                    if (isGroupMode && activeGroup?.narratorSettings?.hiddenFromChat && m.role === 'assistant') {
                      // Find if this character is a narrator
                      const memberInfo = activeGroup.members?.find(mem => mem.characterId === m.characterId);
                      if (memberInfo?.isNarrator) {
                        return false; // Hide narrator messages from chat display
                      }
                    }

                    return true;
                  }).map((message) => {
                    // Determine character for this message
                    let messageCharacter: CharacterCard | undefined;
                    let displayName: string | undefined;
                    let displayAvatar: string | undefined;
                    let isNarratorMessage = false;

                    if (message.role === 'user') {
                      displayName = activePersona?.name || t('message.you');
                      displayAvatar = activePersona?.avatar || undefined;
                    } else if (isGroupMode) {
                      // Use allCharacters from store if characters prop is empty
                      const characterList = characters.length > 0 ? characters : allCharacters;
                      messageCharacter = characterList.find(c => c.id === message.characterId);
                      displayName = messageCharacter?.name;
                      displayAvatar = messageCharacter?.avatar;

                      // Check if this character is a narrator in the group
                      if (activeGroup?.members) {
                        const memberInfo = activeGroup.members.find(m => m.characterId === message.characterId);
                        isNarratorMessage = memberInfo?.isNarrator || false;
                      }

                      // Debug: log if character not found
                      if (!messageCharacter && message.characterId) {
                        console.warn('[NovelChatBox] Character not found:', message.characterId, 'Available:', characterList.map(c => c.id));
                      }
                    } else {
                      messageCharacter = activeCharacter || undefined;
                      displayName = activeCharacter?.name;
                      displayAvatar = activeCharacter?.avatar;
                    }

                    return (
                      <ChatMessageBubble
                        key={message.id}
                        message={message}
                        characterName={displayName}
                        characterAvatar={displayAvatar}
                        userName={activePersona?.name || t('message.you')}
                        userAvatar={activePersona?.avatar || undefined}
                        showTimestamp={settings.showTimestamps}
                        showTokens={settings.showTokens}
                        onDelete={() => deleteMessage(activeSessionId!, message.id)}
                        displayMode={settings.messageDisplay}
                        onSwipe={(direction) => swipeMessage(activeSessionId!, message.id, direction)}
                        hasAlternatives={(message.swipes?.length || 1) > 1}
                        currentIndex={message.swipeIndex || 0}
                        totalAlternatives={message.swipes?.length || 1}
                        onRegenerate={() => onRegenerate?.(message.id)}
                        onEdit={onEdit}
                        onReplay={onReplay}
                        onSpeak={() => onSpeak?.(message.id, message.content, message.characterId)}
                        isNarrator={isNarratorMessage}
                        emotionalState={messageCharacter?.emotionalConfig?.enabled ? (sessionStats?.characterStats?.[messageCharacter.id]?.emotionalState || messageCharacter.emotionalConfig.initialState) : undefined}
                      />
                    );
                  })}

                  {/* Streaming Message or Typing Indicator */}
                  {isAnyGenerating && (
                    <div className="flex gap-2 py-2 animate-in fade-in-0 slide-in-from-bottom-2 duration-200">
                      {/* Avatar */}
                      <div 
                        className={cn(
                          'overflow-hidden flex-shrink-0 flex items-center justify-center',
                          safeAppearance.avatars.size === 'sm' ? 'w-8 h-8' : 
                          safeAppearance.avatars.size === 'md' ? 'w-10 h-10' :
                          safeAppearance.avatars.size === 'lg' ? 'w-12 h-12' : 'w-14 h-14',
                          safeAppearance.avatars.shape === 'circle' ? 'rounded-full' :
                          safeAppearance.avatars.shape === 'square' ? 'rounded-none' :
                          safeAppearance.avatars.shape === 'rounded' ? 'rounded-lg' : 'rounded-sm'
                        )}
                        style={{
                          borderWidth: safeAppearance.avatars.showBorder ? safeAppearance.avatars.borderWidth : 0,
                          borderColor: safeAppearance.avatars.borderColor,
                          borderStyle: 'solid',
                        }}
                      >
                        {isGroupMode ? (
                          // In group mode, only show avatar when we know which character is responding
                          streamingCharacter ? (
                            streamingCharacter.avatar ? (
                              <img 
                                src={streamingCharacter.avatar} 
                                alt={streamingCharacter.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center">
                                <span className="text-white font-bold text-xs">
                                  {streamingCharacter.name?.[0]?.toUpperCase() || '?'}
                                </span>
                              </div>
                            )
                          ) : (
                            // Waiting for character_start event - show loading indicator
                            <div className="w-full h-full bg-gradient-to-br from-violet-400 to-purple-600 flex items-center justify-center">
                              <span className="text-white font-bold text-xs animate-pulse">?</span>
                            </div>
                          )
                        ) : activeCharacter?.avatar ? (
                          <img 
                            src={activeCharacter.avatar} 
                            alt={activeCharacter.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-amber-400 to-orange-600 flex items-center justify-center">
                            <span className="text-white font-bold text-xs">
                              {activeCharacter?.name?.[0]?.toUpperCase() || '?'}
                            </span>
                          </div>
                        )}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        {/* Name above bubble */}
                        <div className="flex items-center gap-1 mb-1">
                          <span className="text-xs font-medium">
                            {isGroupMode 
                              ? (streamingCharacter?.name || 'Preparando...')
                              : activeCharacter?.name || 'Assistant'}
                          </span>
                          {isGeneratingProactive && (
                            <Badge variant="outline" className="text-[9px] py-0 h-3.5 px-1 gap-0.5 border-amber-500/30 text-amber-400/70 bg-amber-500/5">
                              <Sparkles className="w-2 h-2" />
                              Proactivo
                            </Badge>
                          )}
                          {streamingProgress && (
                            <span className="text-[10px] text-muted-foreground">
                              ({streamingProgress.current}/{streamingProgress.total})
                            </span>
                          )}
                        </div>
                        
                        {/* Content bubble */}
                        <div 
                          className="px-3 py-2"
                          style={{
                            backgroundColor: hexToRgba(safeAppearance.bubbles.characterBubbleColor, safeAppearance.bubbles.transparency),
                            borderRadius: safeAppearance.bubbles.borderRadius,
                            borderTopLeftRadius: 4,
                            maxWidth: `${safeAppearance.bubbles.maxWidth}%`,
                            boxShadow: safeAppearance.bubbles.shadowEnabled 
                              ? safeAppearance.bubbles.shadowIntensity === 'soft' ? '0 1px 3px rgba(0,0,0,0.1)' :
                                safeAppearance.bubbles.shadowIntensity === 'medium' ? '0 4px 6px rgba(0,0,0,0.15)' :
                                '0 10px 15px rgba(0,0,0,0.2)' : undefined,
                          }}
                        >
                          {streamingContent ? (
                            <StreamingText
                              content={streamingContent}
                              isStreaming={true}
                              isUser={false}
                              className="text-xs"
                              style={{ color: safeAppearance.bubbles.characterBubbleTextColor }}
                            />
                          ) : (
                            <div className="flex items-center gap-1">
                              <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                              <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                              <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Auto-scroll anchor */}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              {/* Quick Replies - From character card (single mode) or group (group mode) */}
              {(() => {
                // In group mode, use group quick replies instead of character quick replies
                const quickReplies = isGroupMode && activeGroup?.quickReplies
                  ? activeGroup.quickReplies
                  : (activeCharacter?.quickReplies || []);

                if (quickReplies.length === 0) return <></>;

                // Determine which character's attributes to use for condition evaluation
                const primaryCharacterId = activeCharacter?.id;
                const characterAttributeValues = primaryCharacterId && sessionStats?.characterStats?.[primaryCharacterId]
                  ? sessionStats.characterStats[primaryCharacterId].attributeValues
                  : {};

                const qrContext = {
                  user: activePersona?.name || 'User',
                  char: activeCharacter?.name || (isGroupMode ? activeGroup?.name : 'Character') || 'Character',
                };

                // Filter quick replies by conditions
                const visibleReplies = quickReplies.filter((item) => {
                  if (!item.requirements || item.requirements.length === 0) return true;
                  return evaluateRequirements(
                    item.requirements,
                    characterAttributeValues,
                    sessionStats || null,
                    item.requirementOperator
                  );
                });

                if (visibleReplies.length === 0) return <></>;

                return (
                <div className="px-2 py-1 flex gap-1 overflow-x-auto border-t bg-background/30 flex-shrink-0">
                  {visibleReplies.map((item) => {
                    const resolvedLabel = resolveTemplateVariables(item.label, qrContext);
                    const resolvedResponse = resolveTemplateVariables(item.response, qrContext);
                    const hasUnresolved = item.response !== resolvedResponse || item.label !== resolvedLabel;
                    const hasModifiers = item.modifiers && item.modifiers.length > 0;
                    return (
                    <Button
                      key={item.id}
                      variant="outline"
                      size="sm"
                      className={cn(
                        "h-6 px-2 text-xs flex-shrink-0 disabled:opacity-50 max-w-[150px]",
                        hasModifiers && "border-amber-500/30 hover:border-amber-500/50"
                      )}
                      disabled={isAnyGenerating}
                      onClick={() => handleQuickReply(item)}
                      title={hasUnresolved ? resolvedResponse : (item.response !== item.label ? item.response : undefined)}
                    >
                      {hasModifiers && <Zap className="w-3 h-3 mr-1 text-amber-400 flex-shrink-0" />}
                      <span className="truncate">{resolvedLabel}</span>
                    </Button>
                    );
                  })}
                </div>
                );
              })()}

              {/* User Peticiones - Quick Tags */}
              <QuickPetitions
                activePersona={activePersona}
                activeCharacter={activeCharacter}
                characters={isGroupMode ? (characters.length > 0 ? characters : allCharacters) : (activeCharacter ? [activeCharacter] : [])}
                onActivatePeticion={handleActivatePeticion}
              />

              {/* Input Area - Always visible */}
              <div 
                className="p-2 border-t flex-shrink-0"
                style={{
                  backgroundColor: safeAppearance.input.backgroundColor,
                  borderColor: safeAppearance.input.borderColor,
                }}
              >
                <div className="flex gap-2 items-end">
                  <EmojiPicker onEmojiSelect={(emoji) => setInput(prev => prev + emoji)} />
                  <Textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={t('chat.messagePlaceholder')}
                    className="min-h-[32px] max-h-[80px] resize-none flex-1 placeholder:text-muted-foreground"
                    style={{
                      color: safeAppearance.input.textColor,
                      borderColor: safeAppearance.input.borderColor,
                      borderRadius: safeAppearance.input.borderRadius,
                      fontSize: safeAppearance.input.fontSize === 'sm' ? '0.75rem' : 
                               safeAppearance.input.fontSize === 'lg' ? '1.125rem' : '1rem',
                    }}
                    disabled={isAnyGenerating || isTranscribing}
                    rows={1}
                  />
                  {/* Voice Recording Button */}
                  <Button
                    type="button"
                    size="icon"
                    variant={isRecording ? "destructive" : recordingError ? "destructive" : "outline"}
                    className={cn(
                      "h-8 w-8 flex-shrink-0 transition-all",
                      isRecording && "animate-pulse bg-red-600 hover:bg-red-700",
                      permissionStatus === 'denied' && "border-amber-500 hover:bg-amber-500/10"
                    )}
                    onClick={handleRecordingClick}
                    disabled={isAnyGenerating || isTranscribing}
                    title={
                      permissionStatus === 'denied' 
                        ? 'Clic para solicitar permiso de micrófono'
                        : recordingError 
                          ? recordingError 
                          : isRecording 
                            ? 'Detener grabación' 
                            : 'Grabar mensaje de voz'
                    }
                  >
                    {isTranscribing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : permissionStatus === 'denied' ? (
                      <Mic className="w-4 h-4 text-amber-500" />
                    ) : isRecording ? (
                      <Square className="w-4 h-4" />
                    ) : (
                      <Mic className="w-4 h-4" />
                    )}
                  </Button>
                  {/* KWS Toggle Button */}
                  <Button
                    type="button"
                    size="icon"
                    variant={kwsActive ? "default" : "outline"}
                    className={cn(
                      "h-8 w-8 flex-shrink-0 transition-all",
                      kwsActive && kwsPausedByTTS && "animate-pulse bg-amber-600 hover:bg-amber-700",
                      kwsActive && !kwsPausedByTTS && "animate-pulse bg-green-600 hover:bg-green-700"
                    )}
                    onClick={handleKWSToggle}
                    disabled={isAnyGenerating || isTranscribing}
                    title={
                      kwsPausedByTTS
                        ? 'KWS en pausa (TTS reproduciendo)'
                        : kwsActive
                          ? 'Desactivar escucha por voz'
                          : `Activar escucha por voz (${activeCharacter?.name || 'KWS'})`
                    }
                  >
                    {kwsPausedByTTS ? (
                      <VolumeX className="w-4 h-4" />
                    ) : kwsActive ? (
                      <Radio className="w-4 h-4" />
                    ) : (
                      <Ear className="w-4 h-4" />
                    )}
                  </Button>
                  {/* Recording Duration Indicator */}
                  {isRecording && (
                    <span className="text-xs text-red-500 font-mono min-w-[40px] animate-pulse">
                      {Math.floor(recordingDuration / 60000)}:{String(Math.floor((recordingDuration % 60000) / 1000)).padStart(2, '0')}
                    </span>
                  )}
                  {/* KWS Status Indicator */}
                  {kwsActive && !kwsCapturing && (
                    <span className={cn(
                      "text-xs font-mono min-w-[50px]",
                      kwsPausedByTTS
                        ? "text-amber-400 animate-pulse"
                        : "text-green-500 animate-pulse"
                    )}>
                      {kwsPausedByTTS ? '🔇 EN PAUSA' : '🎧 ESCUCHANDO'}
                    </span>
                  )}
                  {/* KWS Capturing Indicator - After wake word detected */}
                  {kwsCapturing && (
                    <span className={cn(
                      "text-xs font-mono min-w-[50px]",
                      "text-amber-400 animate-pulse"
                    )}>
                      🎤 CAPTURANDO...
                    </span>
                  )}
                  {/* KWS Transcript Preview - Shows what KWS is detecting in real-time */}
                  {kwsActive && kwsTranscript && (
                    <div className={cn(
                      "flex items-center gap-1 px-2 py-0.5 rounded-full border max-w-[200px] overflow-hidden",
                      kwsCapturing
                        ? "bg-amber-500/10 border-amber-500/30"
                        : "bg-green-500/10 border-green-500/20"
                    )}>
                      <span className={cn(
                        "w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0",
                        kwsCapturing ? "bg-amber-500" : "bg-green-500"
                      )} />
                      <div className="flex-1 min-w-0 overflow-hidden">
                        <div className="flex justify-end">
                          <span className={cn(
                            "text-[10px] italic whitespace-nowrap",
                            kwsCapturing ? "text-amber-300" : "text-green-400"
                          )}>
                            &quot;{kwsTranscript.length > 35 ? '...' + kwsTranscript.slice(-35) : kwsTranscript}&quot;
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Wake Word Detected Indicator */}
                  {kwsLastDetectedWord && kwsCapturing && (
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/30">
                      <Zap className="w-3 h-3 text-amber-400" />
                      <span className="text-[10px] text-amber-400 font-medium">
                        {kwsLastDetectedWord} →
                      </span>
                    </div>
                  )}
                  {/* Message being captured - will be sent on silence */}
                  {kwsCapturing && kwsCapturedMessage && (
                    <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-blue-500/10 border border-blue-500/30 max-w-[200px] overflow-hidden">
                      <Send className="w-3 h-3 text-blue-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0 overflow-hidden">
                        <div className="flex justify-end">
                          <span className="text-[10px] text-blue-300 whitespace-nowrap">
                            {kwsCapturedMessage.length > 35 ? '...' + kwsCapturedMessage.slice(-35) : kwsCapturedMessage}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Global Audio Mute Button */}
                  <Button
                    type="button"
                    size="icon"
                    variant={globalMuted ? "destructive" : "outline"}
                    className={cn(
                      "h-8 w-8 flex-shrink-0 transition-all",
                      globalMuted && "bg-red-600/80 hover:bg-red-700 border-red-500"
                    )}
                    onClick={handleGlobalMuteToggle}
                    title={globalMuted ? 'Desactivar silencio global' : 'Silenciar todo el audio'}
                  >
                    {globalMuted ? (
                      <VolumeX className="w-4 h-4" />
                    ) : (
                      <Volume2 className="w-4 h-4" />
                    )}
                  </Button>
                  {/* Permission denied warning - now clickable */}
                  {permissionStatus === 'denied' && !isRecording && !isTranscribing && (
                    <button
                      onClick={handleRecordingClick}
                      className="text-xs text-amber-500 hover:text-amber-400 transition-colors cursor-pointer"
                    >
                      <span className="opacity-70">🔓 Solicitar permiso</span>
                    </button>
                  )}
                  {/* FASE 11 v2: Force proactive message button */}
                  {onForceProactive && proactiveEnabled && (
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className={cn(
                        "h-8 w-8 flex-shrink-0 transition-all border-amber-500/30 hover:bg-amber-500/10 hover:border-amber-500/50",
                        isGeneratingProactive && "bg-amber-500/20 border-amber-500/50"
                      )}
                      onClick={onForceProactive}
                      disabled={isAnyGenerating}
                      title={
                        isGeneratingProactive
                          ? 'Generando mensaje proactivo...'
                          : 'Forzar mensaje proactivo ahora (sin esperar el timer)'
                      }
                    >
                      {isGeneratingProactive ? (
                        <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                      ) : (
                        <Sparkles className="w-4 h-4 text-amber-500" />
                      )}
                    </Button>
                  )}
                  <Button
                    size="icon"
                    className="h-8 w-8 flex-shrink-0"
                    onClick={isAnyGenerating ? onStopGeneration : handleSend}
                    disabled={!isAnyGenerating && (!input.trim() || isTranscribing)}
                  >
                    {isAnyGenerating ? (
                      <Square className="w-4 h-4 fill-current" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* Solicitudes Tab Content */}
          {activeTab === 'solicitudes' && (
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-3 space-y-3">
                <div className="flex items-center gap-2 mb-3">
                  <Inbox className="w-4 h-4 text-amber-500" />
                  <h4 className="font-medium text-sm">Solicitudes Recibidas</h4>
                  {pendingUserSolicitudes.length > 0 && (
                    <Badge className="bg-amber-500/20 text-amber-400 text-[10px]">
                      {pendingUserSolicitudes.length} pendientes
                    </Badge>
                  )}
                </div>
                
                {pendingUserSolicitudes.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Inbox className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">No tienes solicitudes pendientes</p>
                    <p className="text-xs mt-1 opacity-70">Los personajes pueden enviarte solicitudes durante la conversación</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Group by character */}
                    {Array.from(new Map(pendingUserSolicitudes.map(s => [s.fromCharacterName, s])).values()).reduce((acc, s) => {
                      const existing = acc.find(g => g.characterName === s.fromCharacterName);
                      if (existing) {
                        existing.solicitudes.push(s);
                      } else {
                        acc.push({ characterName: s.fromCharacterName, solicitudes: [s] });
                      }
                      return acc;
                    }, [] as { characterName: string; solicitudes: typeof pendingUserSolicitudes }).map((group) => (
                      <div key={group.characterName} className="space-y-2">
                        {/* Character Header */}
                        <div className="flex items-center gap-2 px-2 py-1.5 bg-muted/50 rounded-lg">
                          <User className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-xs font-medium">{group.characterName}</span>
                          <Badge variant="outline" className="text-[10px] h-4 px-1 ml-auto">
                            {group.solicitudes.length}
                          </Badge>
                        </div>
                        
                        {/* Solicitudes for this character */}
                        {group.solicitudes.map((solicitud) => (
                          <div
                            key={solicitud.id}
                            className="p-3 rounded-lg border bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/10 transition-colors"
                          >
                            {/* Key and time */}
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <code className="text-[10px] bg-black/30 px-1.5 py-0.5 rounded font-mono text-amber-300">
                                {solicitud.key}
                              </code>
                              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {formatTime(solicitud.createdAt)}
                              </span>
                            </div>
                            
                            {/* Description */}
                            <p className="text-xs text-foreground/80 mb-3 leading-relaxed">
                              {solicitud.description}
                            </p>
                            
                            {/* Action Buttons */}
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-3 text-xs flex-1 bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20 hover:text-green-300"
                                onClick={() => {
                                  if (activeSessionId) {
                                    acceptUserSolicitud(activeSessionId, solicitud.id);
                                  }
                                }}
                              >
                                <Check className="w-3.5 h-3.5 mr-1" />
                                Aceptar
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-3 text-xs flex-1 bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20 hover:text-red-300"
                                onClick={() => {
                                  if (activeSessionId) {
                                    rejectUserSolicitud(activeSessionId, solicitud.id);
                                  }
                                }}
                              >
                                <Circle className="w-3.5 h-3.5 mr-1" />
                                Rechazar
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          )}

          {/* Misiones Tab Content */}
          {activeTab === 'misiones' && (
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-3 space-y-3">
                {/* Header with quest counts */}
                <div className="flex items-center gap-2 mb-3">
                  <ScrollText className="w-4 h-4 text-amber-500" />
                  <h4 className="font-medium text-sm">{t('chatbox.quests')}</h4>
                  {sessionQuests.filter(q => q.status === 'active').length > 0 && (
                    <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px]">
                      {sessionQuests.filter(q => q.status === 'active').length} activas
                    </Badge>
                  )}
                  {sessionQuests.filter(q => q.status === 'available').length > 0 && (
                    <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px]">
                      +{sessionQuests.filter(q => q.status === 'available').length} disp.
                    </Badge>
                  )}
                </div>
                
                {!questSettings.enabled ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <ScrollText className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">{t('chatbox.questsDisabled')}</p>
                  </div>
                ) : sessionQuests.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <ScrollText className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">{t('chatbox.noQuests')}</p>
                    <p className="text-xs mt-1 opacity-70">Las misiones aparecerán según avances en la conversación</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Active Quests */}
                    {sessionQuests.filter(q => q.status === 'active').length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium px-1">
                          Activas
                        </div>
                        {sessionQuests.filter(q => q.status === 'active').map(quest => {
                          const template = questTemplates.find(t => t.id === quest.templateId);
                          if (!template) return null;
                          
                          const colors = priorityColors[template.priority] || priorityColors.main;
                          const completedObjectives = quest.objectives.filter(o => o.isCompleted).length;
                          const totalObjectives = quest.objectives.length;
                          const isExpanded = expandedQuestId === quest.templateId;
                          
                          // Get objectives with template data
                          const objectives = template.objectives.map(obj => {
                            const instanceObj = quest.objectives.find(o => o.templateId === obj.id);
                            return {
                              ...obj,
                              currentCount: instanceObj?.currentCount ?? 0,
                              isCompleted: instanceObj?.isCompleted ?? false,
                            };
                          });
                          
                          return (
                            <div
                              key={quest.templateId}
                              className={cn(
                                'rounded-lg border transition-all',
                                colors.bg,
                                colors.border,
                                'hover:bg-white/5'
                              )}
                            >
                              {/* Quest Header */}
                              <div className="flex items-start gap-2 p-2">
                                {/* Icon */}
                                <div className={cn(
                                  'flex items-center justify-center rounded-lg shrink-0 w-10 h-10',
                                  colors.bg,
                                  'border',
                                  colors.border
                                )}>
                                  <span className="text-xl">{template.icon || '📜'}</span>
                                </div>
                                
                                {/* Quest Info */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <span 
                                      className={cn(
                                        'font-medium truncate cursor-pointer hover:underline text-sm',
                                        colors.text
                                      )}
                                      onClick={() => setExpandedQuestId(isExpanded ? null : quest.templateId)}
                                    >
                                      {template.name}
                                    </span>
                                    {template.priority === 'main' && (
                                      <Star className="w-3 h-3 text-amber-400 shrink-0" />
                                    )}
                                  </div>
                                  
                                  {/* Progress Bar */}
                                  <div className="mt-1.5 flex items-center gap-2">
                                    <div className="flex-1 h-1.5 bg-black/30 rounded-full overflow-hidden">
                                      <div
                                        className={cn('h-full rounded-full transition-all', colors.progress)}
                                        style={{ width: `${quest.progress}%` }}
                                      />
                                    </div>
                                    <span className={cn('text-[10px] font-medium', colors.text)}>
                                      {Math.round(quest.progress)}%
                                    </span>
                                  </div>
                                  
                                  {/* Objective Count */}
                                  <div className="mt-1 flex items-center gap-1 text-[10px] text-white/50">
                                    <Target className="w-3 h-3" />
                                    <span>{completedObjectives}/{totalObjectives} objetivos</span>
                                    {template.rewards.length > 0 && (
                                      <>
                                        <span className="mx-1">•</span>
                                        <Gift className="w-3 h-3" />
                                        <span>{template.rewards.length} recompensas</span>
                                      </>
                                    )}
                                  </div>
                                </div>
                                
                                {/* Deactivate Button */}
                                <button
                                  onClick={() => handleQuestToggle(template.id, 'active')}
                                  className={cn(
                                    'p-1.5 rounded-lg transition-colors shrink-0',
                                    'hover:bg-red-500/20 text-red-400/60 hover:text-red-400'
                                  )}
                                  title="Desactivar misión"
                                >
                                  <Pause className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              
                              {/* Objectives (Expanded) */}
                              {isExpanded && objectives.length > 0 && (
                                <div className="border-t border-white/10 p-2 pt-2">
                                  <div className="space-y-1">
                                    {objectives.map((obj) => {
                                      const objProgress = obj.targetCount > 0 
                                        ? Math.min(100, (obj.currentCount / obj.targetCount) * 100)
                                        : (obj.isCompleted ? 100 : 0);
                                      
                                      return (
                                        <div 
                                          key={obj.id}
                                          className={cn(
                                            'flex items-center gap-2 rounded px-1.5 py-1',
                                            obj.isCompleted 
                                              ? 'bg-green-500/10 text-green-400' 
                                              : 'bg-white/5 text-white/70',
                                            'transition-colors'
                                          )}
                                        >
                                          {/* Checkbox */}
                                          <div className={cn(
                                            'flex items-center justify-center rounded-full shrink-0 transition-all w-5 h-5',
                                            obj.isCompleted 
                                              ? 'bg-green-500 text-white' 
                                              : 'border border-white/30'
                                          )}>
                                            {obj.isCompleted && <Check className="w-3 h-3" />}
                                          </div>
                                          
                                          {/* Description */}
                                          <span className={cn(
                                            'flex-1 truncate text-xs',
                                            obj.isCompleted && 'line-through opacity-70'
                                          )}>
                                            {obj.description}
                                          </span>
                                          
                                          {/* Counter (if multi-target) */}
                                          {obj.targetCount > 1 && (
                                            <span className={cn(
                                              'text-[10px] font-medium px-1.5 py-0.5 rounded',
                                              obj.isCompleted 
                                                ? 'bg-green-500/20 text-green-400'
                                                : 'bg-white/10 text-white/50'
                                            )}>
                                              {obj.currentCount}/{obj.targetCount}
                                            </span>
                                          )}
                                          
                                          {/* Optional badge */}
                                          {obj.isOptional && !obj.isCompleted && (
                                            <span className="text-[8px] text-white/30 uppercase tracking-wider">
                                              opt
                                            </span>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                              
                              {/* Description (if expanded) */}
                              {isExpanded && template.description && (
                                <div className="px-2 pb-2">
                                  <p className="text-[10px] text-white/40 line-clamp-2">
                                    {template.description}
                                  </p>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    
                    {/* Available Quests */}
                    {sessionQuests.filter(q => q.status === 'available').length > 0 && (
                      <div className="space-y-2">
                        <button
                          onClick={() => setShowAvailableQuests(!showAvailableQuests)}
                          className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-blue-400 hover:bg-white/5 rounded transition-colors"
                        >
                          <Circle className="w-3 h-3" />
                          <span className="flex-1 text-left">{t('chatbox.availableQuests')} ({sessionQuests.filter(q => q.status === 'available').length})</span>
                          {showAvailableQuests ? (
                            <ChevronUp className="w-3 h-3" />
                          ) : (
                            <ChevronDown className="w-3 h-3" />
                          )}
                        </button>
                        
                        {showAvailableQuests && (
                          <div className="space-y-1">
                            {sessionQuests.filter(q => q.status === 'available').map(quest => {
                              const template = questTemplates.find(t => t.id === quest.templateId);
                              if (!template) return null;
                              
                              const colors = priorityColors[template.priority] || priorityColors.main;
                              
                              return (
                                <button
                                  key={quest.templateId}
                                  onClick={() => handleQuestToggle(template.id, 'available')}
                                  className={cn(
                                    'w-full flex items-center gap-2 p-2 rounded-lg border transition-all',
                                    'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20',
                                    'group'
                                  )}
                                >
                                  {/* Icon */}
                                  <div className={cn(
                                    'flex items-center justify-center rounded-lg w-8 h-8 shrink-0',
                                    colors.bg,
                                    'border',
                                    colors.border,
                                    'group-hover:border-white/30'
                                  )}>
                                    <span className="text-lg">{template.icon || '📜'}</span>
                                  </div>
                                  
                                  {/* Info */}
                                  <div className="flex-1 min-w-0 text-left">
                                    <div className="flex items-center gap-1">
                                      <span className={cn('font-medium truncate text-xs', colors.text)}>
                                        {template.name}
                                      </span>
                                      {template.priority === 'main' && (
                                        <Star className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                                      )}
                                    </div>
                                    {template.description && (
                                      <p className="text-[10px] text-white/40 truncate mt-0.5">
                                        {template.description}
                                      </p>
                                    )}
                                  </div>
                                  
                                  {/* Activate Button */}
                                  <div className={cn(
                                    'p-1.5 rounded-lg transition-all',
                                    'bg-green-500/10 text-green-400 group-hover:bg-green-500/20'
                                  )}>
                                    <Play className="w-3.5 h-3.5" />
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* Completed Quests */}
                    {sessionQuests.filter(q => q.status === 'completed').length > 0 && (
                      <div className="space-y-2">
                        <div className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium px-1 mt-4 pt-3 border-t">
                          {t('chatbox.completedQuests')}
                        </div>
                        {sessionQuests.filter(q => q.status === 'completed').slice(0, 5).map(quest => {
                          const template = questTemplates.find(t => t.id === quest.templateId);
                          if (!template) return null;
                          
                          return (
                            <div
                              key={quest.templateId}
                              className="p-3 rounded-lg border bg-green-500/10 border-green-500/30"
                            >
                              <div className="flex items-center gap-3">
                                <span className="text-lg">{template.icon || '📜'}</span>
                                <span className="text-sm truncate flex-1 line-through opacity-70">{template.name}</span>
                                <Check className="w-4 h-4 text-green-500" />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    
                    {/* Auto Quest Configuration */}
                    <div className="pt-3 border-t border-white/10">
                      <button
                        onClick={() => setShowAutoQuestConfig(!showAutoQuestConfig)}
                        className={cn(
                          'w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded transition-colors',
                          questSettings.autoQuestEnabled
                            ? 'text-violet-400 hover:bg-violet-500/10'
                            : 'text-white/50 hover:bg-white/5'
                        )}
                      >
                        <Zap className={cn(
                          'w-3 h-3',
                          questSettings.autoQuestEnabled && 'animate-pulse'
                        )} />
                        <span className="flex-1 text-left">Auto Quest</span>
                        {questSettings.autoQuestEnabled && (
                          <Badge className="bg-violet-500/20 text-violet-400 border-violet-500/30 text-[10px]">
                            ON
                          </Badge>
                        )}
                        {showAutoQuestConfig ? (
                          <ChevronUp className="w-3 h-3" />
                        ) : (
                          <ChevronDown className="w-3 h-3" />
                        )}
                      </button>
                      
                      {showAutoQuestConfig && (
                        <div className="mt-2 p-2 rounded-lg bg-violet-500/10 border border-violet-500/20 space-y-3">
                          {/* Enable Switch */}
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-white/70">Activar automáticamente</span>
                            <button
                              onClick={() => handleAutoQuestChange({ autoQuestEnabled: !questSettings.autoQuestEnabled })}
                              className={cn(
                                'relative w-10 h-5 rounded-full transition-colors',
                                questSettings.autoQuestEnabled ? 'bg-violet-500' : 'bg-white/20'
                              )}
                            >
                              <div className={cn(
                                'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                                questSettings.autoQuestEnabled ? 'translate-x-5' : 'translate-x-0.5'
                              )} />
                            </button>
                          </div>
                          
                          {/* Interval Setting */}
                          <div className="space-y-1">
                            <label className="text-xs text-white/50">
                              Cada X turnos/mensajes:
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={100}
                              value={questSettings.autoQuestInterval}
                              onChange={(e) => handleAutoQuestChange({ 
                                autoQuestInterval: Math.max(1, parseInt(e.target.value) || 5) 
                              })}
                              className="w-full px-2 py-1 text-xs bg-black/30 border border-white/10 rounded text-white/80 focus:outline-none focus:border-violet-500/50"
                              disabled={!questSettings.autoQuestEnabled}
                            />
                          </div>
                          
                          {/* Mode Selection */}
                          <div className="space-y-1">
                            <label className="text-xs text-white/50">Modo de selección:</label>
                            <div className="flex gap-1">
                              <button
                                onClick={() => handleAutoQuestChange({ autoQuestMode: 'random' })}
                                disabled={!questSettings.autoQuestEnabled}
                                className={cn(
                                  'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded transition-colors',
                                  questSettings.autoQuestMode === 'random'
                                    ? 'bg-violet-500/30 text-violet-300 border border-violet-500/50'
                                    : 'bg-white/5 text-white/50 border border-white/10',
                                  !questSettings.autoQuestEnabled && 'opacity-50 cursor-not-allowed'
                                )}
                              >
                                <Shuffle className="w-3 h-3" />
                                Random
                              </button>
                              <button
                                onClick={() => handleAutoQuestChange({ autoQuestMode: 'list' })}
                                disabled={!questSettings.autoQuestEnabled}
                                className={cn(
                                  'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded transition-colors',
                                  questSettings.autoQuestMode === 'list'
                                    ? 'bg-violet-500/30 text-violet-300 border border-violet-500/50'
                                    : 'bg-white/5 text-white/50 border border-white/10',
                                  !questSettings.autoQuestEnabled && 'opacity-50 cursor-not-allowed'
                                )}
                              >
                                <List className="w-3 h-3" />
                                Lista
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}

          {/* Memorias Tab Content */}
          {activeTab === 'memorias' && (
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-3 space-y-3">
                {/* System Status Indicator */}
                <div className="flex items-center gap-2 text-xs">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${embeddingsStatus === 'connected' ? 'bg-green-500' : embeddingsStatus === 'disconnected' ? 'bg-red-500' : 'bg-gray-400'}`} />
                  <span className="text-muted-foreground">
                    {embeddingsStatus === 'connected' ? 'Ollama + LanceDB conectados' : 
                     embeddingsStatus === 'disconnected' ? 'Sin conexión a Ollama/LanceDB' : 
                     'Verificando conexión...'}
                  </span>
                  {embeddingsStatus === 'disconnected' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 text-[10px] ml-auto px-1.5"
                      onClick={checkEmbeddingsStatus}
                    >
                      Reintentar
                    </Button>
                  )}
                </div>

                {/* ============================================ */}
                {/* Section 0: Memoria V2 (unified store)       */}
                {/* En grupo muestra los recuerdos de TODOS los */}
                {/* miembros extraídos en este chat grupal.     */}
                {/* ============================================ */}
                <Collapsible
                  open={expandedMemSections.v2}
                  onOpenChange={(open) => setExpandedMemSections(prev => ({ ...prev, v2: open }))}
                >
                    <div className="flex items-center justify-between">
                      <CollapsibleTrigger asChild>
                        <button className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                          {expandedMemSections.v2 ? (
                            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                          )}
                          <DatabaseZap className="w-4 h-4 text-violet-500" />
                          <h4 className="font-medium text-sm">Memoria V2{isGroupMode ? ' (grupo)' : ''}</h4>
                          {v2Count > 0 && (
                            <Badge variant="secondary" className="text-xs">{v2Count}</Badge>
                          )}
                          {v2Backend && (
                            <Badge variant="outline" className="text-[9px] font-normal">
                              {v2Backend === 'lancedb' ? 'LanceDB' : 'JSON fallback'}
                            </Badge>
                          )}
                        </button>
                      </CollapsibleTrigger>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={loadV2Records}
                        title="Recargar memoria V2"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                    <CollapsibleContent>
                      <div className="pl-9 pt-2">
                        {isGroupMode ? (
                          <MemoryV2Manager
                            compact
                            groupId={activeGroup?.id || ''}
                            charName={activeGroup?.name || 'Grupo'}
                            userName={activePersona?.name || undefined}
                            refreshSignal={v2RefreshTick}
                            onCountChange={setV2Count}
                          />
                        ) : (
                          <MemoryV2Manager
                            compact
                            charId={activeCharacter?.id || ''}
                            charName={activeCharacter?.name || 'Personaje'}
                            userName={activePersona?.name || undefined}
                            refreshSignal={v2RefreshTick}
                            onCountChange={setV2Count}
                          />
                        )}
                      </div>
                    </CollapsibleContent>
                </Collapsible>

                {/* ============================================ */}
                {/* Section 1: Resúmenes (Summaries from Zustand) */}
                {/* ============================================ */}
                <Collapsible
                  open={expandedMemSections.resumenes}
                  onOpenChange={(open) => setExpandedMemSections(prev => ({ ...prev, resumenes: open }))}
                >
                  <div className="flex items-center gap-2">
                    <CollapsibleTrigger asChild>
                      <button className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                        {expandedMemSections.resumenes ? (
                          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                        )}
                        <ScrollText className="w-4 h-4 text-purple-500" />
                        <h4 className="font-medium text-sm">Resúmenes</h4>
                        {localSummaries.length > 0 && (
                          <Badge variant="secondary" className="text-xs">{localSummaries.length}</Badge>
                        )}
                      </button>
                    </CollapsibleTrigger>
                  </div>
                  <CollapsibleContent>
                    {localSummaries.length === 0 ? (
                      <p className="text-xs text-muted-foreground pl-9 pt-2">Sin resúmenes generados</p>
                    ) : (
                      <div className="space-y-1.5 pl-9 pt-2">
                        {localSummaries.map(s => {
                          const isExpanded = expandedSummaryId === s.id;
                          return (
                            <div key={s.id} className="group rounded-md bg-white/5 hover:bg-white/10 transition-colors overflow-hidden">
                              <button
                                className="w-full flex items-center gap-2 p-2 text-left"
                                onClick={() => setExpandedSummaryId(isExpanded ? null : s.id)}
                              >
                                <ScrollText className="w-3 h-3 text-purple-400 flex-shrink-0" />
                                <span className="text-xs font-medium text-foreground/90 truncate flex-1">
                                  Mensajes {s.messageRange.start + 1}–{s.messageRange.end + 1}
                                </span>
                                <Badge variant="secondary" className="text-[10px] flex-shrink-0">
                                  {s.tokens} tok
                                </Badge>
                                <span className="text-[9px] text-muted-foreground flex-shrink-0">
                                  {formatMemoryDate(new Date(s.createdAt))}
                                </span>
                                {isExpanded ? (
                                  <ChevronUp className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                                ) : (
                                  <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                                )}
                              </button>
                              {isExpanded && (
                                <div className="px-2 pb-2 pl-7">
                                  <div className="rounded bg-white/5 p-2 max-h-40 overflow-y-auto text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed">
                                    {s.content}
                                  </div>
                                  <div className="flex items-center justify-end mt-1.5">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 text-[10px] text-destructive hover:text-destructive px-1.5"
                                      onClick={() => { deleteSummary(s.id); loadSummaries(); }}
                                    >
                                      <Trash2 className="w-3 h-3 mr-1" />
                                      Eliminar
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {/* Summary Embeddings Sub-section */}
                    {summaryEmbeddings.length > 0 && (
                      <div className="mt-3 space-y-1.5">
                        <div className="flex items-center gap-1.5 px-1 py-0.5">
                          <ScrollText className="w-3 h-3 text-cyan-400" />
                          <span className="text-xs font-medium text-cyan-400">
                            Resúmenes indexados (búsqueda semántica)
                          </span>
                          <span className="text-xs text-muted-foreground">
                            ({summaryEmbeddings.length})
                          </span>
                        </div>
                        {summaryEmbeddings.map(emb => (
                          <div key={emb.id} className="group flex items-start gap-2 p-2 rounded-md bg-cyan-500/5 hover:bg-cyan-500/10 transition-colors">
                            <div className="w-1 h-full min-h-[1.5rem] rounded-full flex-shrink-0 mt-0.5 bg-cyan-500/40" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="text-[10px] text-cyan-400 bg-cyan-500/20 px-1.5 py-0.5 rounded">Resumen</span>
                                <span className="text-[9px] text-muted-foreground">
                                  {formatMemoryDate(new Date(emb.created_at))}
                                </span>
                              </div>
                              <p className="text-xs leading-relaxed text-foreground/80 line-clamp-2">
                                {emb.content}
                              </p>
                            </div>
                            <button
                              onClick={() => deleteMemory(emb.id)}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 flex-shrink-0"
                              title="Eliminar resumen indexado"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                  </CollapsibleContent>
                </Collapsible>

                {/* Bottom hint */}
                <p className="text-[10px] text-muted-foreground text-center pt-1">
                  💡 Crea o edita recuerdos en Memoria V2; los Resúmenes comprimen automáticamente el contexto
                </p>
              </div>
            </ScrollArea>
          )}

          {/* Tienda Tab Content */}
          {activeTab === 'tienda' && (
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-3 space-y-3">
                {/* Header with currency */}
                <div className="flex items-center gap-2 mb-3">
                  <ShoppingCart className="w-4 h-4 text-amber-500" />
                  <h4 className="font-medium text-sm">Tienda</h4>
                  <div className="ml-auto flex items-center gap-1.5 bg-amber-500/10 rounded-full px-2.5 py-1">
                    <span className="text-sm">{activePersona?.currencyIcon || '💰'}</span>
                    <span className="text-xs font-medium text-amber-400">{activePersona?.currencyName || 'Divisa'}:</span>
                    <span className="text-xs font-bold text-amber-300">{activePersona?.currency || 0}</span>
                  </div>
                </div>

                {/* Shop Items */}
                {(() => {
                  const shopItems = getShopItems();
                  if (shopItems.length === 0) {
                    return (
                      <div className="text-center py-8 text-muted-foreground">
                        <ShoppingCart className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p className="text-xs">No hay items disponibles en la tienda.</p>
                        <p className="text-xs mt-1 opacity-70">Configura precios en el registro de items.</p>
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-2">
                      {shopItems.map(item => {
                        const canAfford = (activePersona?.currency || 0) >= (item.price || 0);
                        return (
                          <div
                            key={item.id}
                            className={cn(
                              "group flex items-start gap-2.5 p-2.5 rounded-lg border transition-colors",
                              getRarityBgColor(item.rarity),
                              canAfford ? "hover:bg-white/5" : "opacity-60"
                            )}
                          >
                            {/* Rarity color indicator bar */}
                            <div className={cn("w-1 h-full min-h-[2.5rem] rounded-full flex-shrink-0 mt-0.5", getRarityBgColor(item.rarity).replace('/10', '/40'))} />

                            {/* Item info */}
                            <div className="flex-1 min-w-0">
                              {/* Top row: name + type badge */}
                              <div className="flex items-center gap-1.5 mb-1">
                                <span className="text-xs">{item.icon}</span>
                                <span className={cn("text-xs font-medium", getRarityColor(item.rarity))}>
                                  {item.name}
                                </span>
                                <span className={cn(
                                  "text-[9px] font-medium px-1.5 py-0.5 rounded",
                                  item.type === 'consumable' ? 'bg-blue-500/20 text-blue-400' : 'bg-orange-500/20 text-orange-400'
                                )}>
                                  {getItemTypeLabel(item.type)}
                                </span>
                              </div>

                              {/* Description snippet */}
                              {item.description && (
                                <p className="text-[10px] text-muted-foreground line-clamp-2 mb-1.5">
                                  {item.description}
                                </p>
                              )}

                              {/* Price */}
                              <div className="flex items-center gap-1 text-[10px]">
                                <span className="text-amber-400 font-medium">
                                  {activePersona?.currencyIcon || '💰'} {item.price} {activePersona?.currencyName || 'Divisa'}
                                </span>
                              </div>
                            </div>

                            {/* Buy button */}
                            <Button
                              size="sm"
                              variant={canAfford ? "default" : "ghost"}
                              className={cn(
                                "h-7 text-xs px-2.5 flex-shrink-0",
                                canAfford ? "bg-amber-600 hover:bg-amber-700 text-white" : "text-muted-foreground"
                              )}
                              disabled={!canAfford || !activePersona?.id}
                              onClick={() => {
                                if (activePersona?.id) {
                                  purchaseItem(activePersona.id, item.id);
                                }
                              }}
                            >
                              Comprar
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </ScrollArea>
          )}


          {/* Resize Handles - hidden on mobile since chat is full-screen */}
          {!isMobile && (
            <div
              className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
              onMouseDown={handleResizeStart}
            >
              <div className="absolute bottom-1 right-1 w-2 h-2 border-r-2 border-b-2 border-muted-foreground/30" />
            </div>
          )}
        </>
      )}
    </div>
  );
}
