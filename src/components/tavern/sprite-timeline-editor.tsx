'use client';

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type {
  SpriteTimelineCollection,
  TimelineSprite,
  TimelineTrack,
  TimelineKeyframe,
  SoundKeyframeValue,
  HapticKeyframeValue,
  HapticVelocityMode,
  SpriteAnimationFormat,
  SoundTrigger,
  SpriteTimelineData,
  TimelineData,
} from '@/types';
import {
  DEFAULT_SOUND_KEYFRAME_VALUE,
  DEFAULT_HAPTIC_KEYFRAME_VALUE,
  createDefaultTimelineData,
} from '@/types';
import {
  Play,
  Pause,
  Square,
  Trash2,
  Upload,
  RefreshCw,
  Volume2,
  VolumeX,
  Image as ImageIcon,
  Film,
  Music,
  Clock,
  Layers,
  ZoomIn,
  ZoomOut,
  Magnet,
  FileVideo,
  Sparkles,
  Loader2,
  FolderOpen,
  GripVertical,
  Save,
  Move,
  Vibrate,
  Waves,
  Download,
  Activity,
  ChevronDown,
  Wifi,
  WifiOff,
  Power,
  Plus,
  Crosshair,
  X,
  Ruler,
} from 'lucide-react';
import { useTavernStore } from '@/store/tavern-store';
import { useToast } from '@/hooks/use-toast';
import { useHapticPlayback } from '@/hooks/use-haptic-playback';
import type { HspPoint } from '@/hooks/use-haptic-playback';
import { generateHspPattern } from '@/lib/haptic/hsp-pattern-generator';
import { AnimatedFrameDecoder } from '@/lib/sprites/frame-decoder';
import {
  trackVideo,
  trackAnimatedImage,
  trackingToHapticPosition,
  trackingToHapticPositionsCombined,
  computeVerticalPosition,
  computeHorizontalPosition,
  simplifyKeyframesRDP,
  RDP_TOLERANCES,
  createRangeRemapper,
  densifyTrajectoryCatmullRom,
  catmullRomPathD,
  DEFAULT_GUIDES,
} from '@/lib/sprites/tracker';
import type { RDPToleranceKey, MovementRange, TrackingGuides } from '@/lib/sprites/tracker';
import type { TrackingMapMode, TrackingKeyframeValue, TimelineKeyframe } from '@/types';

// Audio cache for preloading sounds
const audioCache = new Map<string, HTMLAudioElement>();

// Format time in MM:SS.mmm format
const formatTime = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const milliseconds = ms % 1000;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
};

// Parse time from MM:SS.mmm format
const parseTime = (str: string): number => {
  const match = str.match(/^(\d+):(\d+)\.?(\d*)$/);
  if (!match) return 0;
  const minutes = parseInt(match[1], 10);
  const seconds = parseInt(match[2], 10);
  const milliseconds = parseInt((match[3] || '0').padEnd(3, '0'), 10);
  return minutes * 60 * 1000 + seconds * 1000 + milliseconds;
};

// Get format icon
const getFormatIcon = (format: string) => {
  switch (format) {
    case 'webm':
    case 'mp4':
      return <FileVideo className="w-4 h-4 text-blue-400" />;
    case 'gif':
      return <Film className="w-4 h-4 text-purple-400" />;
    case 'webp':
      return <ImageIcon className="w-4 h-4 text-green-400" />;
    default:
      return <ImageIcon className="w-4 h-4 text-muted-foreground" />;
  }
};

// Get format from filename
const getFormatFromFilename = (filename: string): SpriteAnimationFormat => {
  const ext = filename.split('.').pop()?.toLowerCase() || 'png';
  if (ext === 'webm') return 'webm';
  if (ext === 'mp4') return 'mp4';
  if (ext === 'gif') return 'gif';
  if (ext === 'webp') return 'webp';
  if (ext === 'jpg' || ext === 'jpeg') return 'jpg';
  return 'png';
};

// Sprite collection file from API (now includes metadata)
interface SpriteCollectionFile {
  name: string;
  url: string;
  type: 'image' | 'animation';
  // Timeline data from metadata
  label?: string;
  duration?: number;
  timeline?: TimelineData;
}

interface SpriteCollectionFromAPI {
  id: string;
  name: string;
  path: string;
  files: SpriteCollectionFile[];
}

// ============================================
// Main Component
// ============================================

// Haptic playback now uses HSP (Handy Server Pattern) instead of HDSP streaming.
// HSP preloads all pattern points into the device buffer, then the device handles
// timing, interpolation, and looping natively — eliminating network latency and
// loop wraparound issues.
// See: /src/lib/haptic/hsp-pattern-generator.ts and /src/hooks/use-haptic-playback.ts

// ============================================
// Main Component
// ============================================

export function SpriteTimelineEditor() {
  const {
    editorState,
    selectCollection,
    selectSprite,
    selectKeyframe,
    selectKeyframes,
    toggleKeyframeSelection,
    addToKeyframeSelection,
    clearKeyframeSelection,
    setZoom,
    toggleSnap,
    soundTriggers,
    soundCollections,
  } = useTavernStore();

  const { toast } = useToast();
  
  // Local state for collections loaded from filesystem
  const [spriteCollections, setSpriteCollections] = useState<SpriteCollectionFromAPI[]>([]);
  const [timelineCollections, setTimelineCollections] = useState<SpriteTimelineCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // UI state
  const [playbackTime, setPlaybackTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const animationRef = useRef<number | null>(null);
  // Ref to track isPlaying without causing dependency issues in callbacks
  const isPlayingRef = useRef(false);
  // Keep isPlayingRef in sync
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map());
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  
  // Playhead dragging state
  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
  
  // Keyframe dragging state
  const [draggingKeyframe, setDraggingKeyframe] = useState<{
    trackId: string;
    keyframeId: string;
    isHaptic?: boolean;
  } | null>(null);

  // Live drag position for haptic tooltip
  const [hapticDragInfo, setHapticDragInfo] = useState<{position: number; x: number; y: number} | null>(null);

  // Sound drag-and-drop state (track hover feedback)
  const [dragOverTrackId, setDragOverTrackId] = useState<string | null>(null);

  // Ref to the haptic track content element being dragged (for fresh rect on scroll)
  const hapticDragTrackElRef = useRef<HTMLElement | null>(null);
  
  // Marquee selection state
  const [isMarqueeSelecting, setIsMarqueeSelecting] = useState(false);
  const [marqueeStart, setMarqueeStart] = useState<{x: number; y: number; time: number} | null>(null);
  const [marqueeEnd, setMarqueeEnd] = useState<{x: number; y: number; time: number} | null>(null);
  const [marqueeTrackId, setMarqueeTrackId] = useState<string | null>(null);

  // Multi-keyframes drag state - stores initial positions when drag starts
  const [multiDragInitialPositions, setMultiDragInitialPositions] = useState<Map<string, {time: number; position?: number}>>(new Map());
  const [multiDragStartTime, setMultiDragStartTime] = useState<number | null>(null);
  const multiDragInitialPositionsRef = useRef<Map<string, {time: number; position?: number}>>(new Map());
  const multiDragStartTimeRef = useRef<number | null>(null);

  // Track which keyframes have been triggered during playback
  const triggeredKeyframesRef = useRef<Set<string>>(new Set());
  
  // Audio context for playing sounds
  const audioContextRef = useRef<AudioContext | null>(null);

  // Haptic CSV file input ref
  const hapticCsvInputRef = useRef<HTMLInputElement>(null);
  // Track which haptic track is target for CSV import
  const [csvImportTargetTrackId, setCsvImportTargetTrackId] = useState<string | null>(null);

  // Haptic playback state
  const [hapticEnabled, setHapticEnabled] = useState(false);
  const [hapticConnecting, setHapticConnecting] = useState(false);
  const haptic = useHapticPlayback({
    isEnabled: hapticEnabled,
    onLog: (msg) => console.log('[HapticPlayback]', msg),
  });

  // Static frame capture for animated images (webp, gif) - show when paused
  const [staticFrameUrl, setStaticFrameUrl] = useState<string | null>(null);
  const staticFrameCaptureRef = useRef<boolean>(false);

  // Seek preview for animated images: when seeking while paused,
  // briefly show the animated WEBP/GIF for ~2 seconds so the user can
  // preview what happens at that timeline position.
  const [seekPreview, setSeekPreview] = useState(false);
  const seekPreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── FRAME-EXACT PREVIEW (webp/gif via WebCodecs ImageDecoder) ──
  // Replaces the "2s animated flash" workaround when the API is available:
  // the preview canvas renders the exact frame at the playhead position.
  const frameDecoderRef = useRef<AnimatedFrameDecoder | null>(null);
  const [decoderInfo, setDecoderInfo] = useState<{ frameCount: number; supported: boolean; loading: boolean }>({ frameCount: 0, supported: false, loading: false });
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const [previewFrameIndex, setPreviewFrameIndex] = useState(-1);

  // ── TRACKING (point + trajectory) ──
  // Marker placed by clicking the preview (normalized 0-1 coords)
  const [trackPoint, setTrackPoint] = useState<{ x: number; y: number } | null>(null);
  const [trackingBusy, setTrackingBusy] = useState(false);
  const [trackingProgress, setTrackingProgress] = useState(0);
  const [trackingMapMode, setTrackingMapMode] = useState<TrackingMapMode>('combined');
  // Keyframe optimization tolerance applied when converting tracking → haptic
  const [rdpTolerance, setRdpTolerance] = useState<RDPToleranceKey>('balanced');
  // Movement range: how far the tracker is willing to look between frames.
  // 'small' = precise/slow motion; 'medium' default; 'large' = fast/wide strokes.
  const [movementRange, setMovementRange] = useState<MovementRange>('medium');

  // Haptic output range: the tracked curve's lowest/highest peaks remap to
  // these positions (0-100). Scales the device stroke without editing the curve.
  const [hapticRangeMin, setHapticRangeMin] = useState(0);
  const [hapticRangeMax, setHapticRangeMax] = useState(100);

  // Reference guides on the sprite preview: define the active region for
  // tracking conversion. With guides ENABLED, the trajectory's position is
  // computed relative to the guide limits (topY → 100 = up, bottomY → 0 =
  // down, leftX → 0, rightX → 100) — no auto-normalization, the curve lands
  // where the motion actually took it inside the guides. With guides
  // DISABLED, conversion auto-normalizes (curve min → effMin, max → effMax).
  const [guides, setGuides] = useState<TrackingGuides>(DEFAULT_GUIDES);

  // Scrub-follow: after tracking, the red marker walks the stored trajectory
  // as the user moves the playhead (for fine inspection before →HSP).
  const [followTrackId, setFollowTrackId] = useState<string | null>(null);

  // "Latest ref" for handleAddTrackingPoint — used by the red-point drag
  // handler's `onMouseUp` callback. The drag handler is created inside the
  // onMouseDown event (a fresh closure each time), but it captures state at
  // mousedown time. By the time the user releases the mouse, the React state
  // has been updated by every mousemove (setTrackPoint), but the onUp closure
  // still references the OLD handleAddTrackingPoint. This ref always points
  // to the latest version so onUp applies the FINAL drag position to the
  // currently-selected tracking keyframe (requirement: "mueve en el preview
  // → crea o actualiza el keyframe").
  const handleAddTrackingPointRef = useRef<(trackId: string) => void>(() => {});


  // Dispose decoder on unmount
  useEffect(() => () => frameDecoderRef.current?.dispose(), []);



  // Get selected items
  const selectedCollection = timelineCollections.find(c => c.id === editorState.selectedCollectionId);
  const selectedSprite = selectedCollection?.sprites.find(s => s.id === editorState.selectedSpriteId);
  const selectedTrack = selectedSprite?.timeline.tracks.find(t => t.id === editorState.selectedTrackId);

  // Load/reload the frame decoder when the selected animated image changes
  useEffect(() => {
    const isAnimatedImage = selectedSprite?.format === 'webp' || selectedSprite?.format === 'gif';
    if (!selectedSprite?.url || !isAnimatedImage || !AnimatedFrameDecoder.isSupported()) {
      frameDecoderRef.current?.dispose();
      frameDecoderRef.current = null;
      setDecoderInfo({ frameCount: 0, supported: false, loading: false });
      setPreviewFrameIndex(-1);
      return;
    }

    let cancelled = false;
    setDecoderInfo({ frameCount: 0, supported: true, loading: true });

    (async () => {
      try {
        const decoder = new AnimatedFrameDecoder();
        const info = await decoder.load(selectedSprite.url);
        if (cancelled) { decoder.dispose(); return; }
        if (info.animated) {
          frameDecoderRef.current = decoder;
          setDecoderInfo({ frameCount: info.frameCount, supported: true, loading: false });
        } else {
          decoder.dispose();
          setDecoderInfo({ frameCount: 0, supported: false, loading: false });
        }
      } catch (e) {
        console.warn('[TimelineEditor] FrameDecoder failed, fallback to <img>:', e);
        if (!cancelled) setDecoderInfo({ frameCount: 0, supported: false, loading: false });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedSprite?.url, selectedSprite?.format]);

  // ── SCRUB-FOLLOW + PLAYBACK-FOLLOW: red marker walks the tracked trajectory ──
  // When a tracking track is "active" the red marker walks its trajectory:
  //   - On manual scrub (playhead drag): live inspection of the tracked path.
  //   - DURING PLAYBACK: the marker follows the tracked point as the sprite
  //     animates — the user sees the tracking point move in lockstep with the
  //     animation, which is exactly what the user asked for ("al reproducir
  //     el sprite con el boton de Play deberia verse como se mueve el track
  //     point segun la pista de tracking").
  // The marker is rendered non-interactive during playback so the user can't
  // drag it while it's auto-following (see the preview marker JSX below).
  //
  // Active track resolution (in priority order):
  //   1. followTrackId — set after auto-tracking OR after a manual-point drag
  //      (the latter is re-enabled in the drag's onMouseUp). User clears it
  //      by double-clicking the red point ("remove marker + exit follow").
  //   2. The selected track, if it's a tracking track with keyframes — lets
  //      playback follow the tracking track the user is currently editing
  //      even if no auto-run has happened (e.g. all-manual trajectories).
  //   3. The first tracking track with keyframes — last-resort fallback so
  //      Play ALWAYS moves the marker if any tracking data exists.
  useEffect(() => {
    if (!selectedSprite || trackingBusy) return;

    // Pick the active tracking track (priority order — see comment above).
    let track: TimelineTrack | undefined;
    if (followTrackId) {
      track = selectedSprite.timeline.tracks.find(t => t.id === followTrackId && t.type === 'tracking');
    }
    if (!track && selectedTrack?.type === 'tracking' && selectedTrack.keyframes.length > 0) {
      track = selectedTrack;
    }
    if (!track) {
      track = selectedSprite.timeline.tracks.find(t => t.type === 'tracking' && t.keyframes.length > 0);
    }
    if (!track || track.keyframes.length === 0) return;

    const kfs = track.keyframes.slice().sort((a, b) => a.time - b.time);

    // Before the first keyframe → snap to it; after the last → snap to it
    if (playbackTime <= kfs[0].time) {
      const tv = kfs[0].value as TrackingKeyframeValue;
      setTrackPoint({ x: tv.x, y: tv.y });
      return;
    }
    const lastKf = kfs[kfs.length - 1];
    if (playbackTime >= lastKf.time) {
      const tv = lastKf.value as TrackingKeyframeValue;
      setTrackPoint({ x: tv.x, y: tv.y });
      return;
    }

    // Find surrounding keyframes and interpolate
    let i = 0;
    while (i < kfs.length - 1 && kfs[i + 1].time < playbackTime) i++;
    const a = kfs[i];
    const b = kfs[i + 1];
    const ta = a.value as TrackingKeyframeValue;
    const tb = b.value as TrackingKeyframeValue;
    const ratio = b.time === a.time ? 0 : (playbackTime - a.time) / (b.time - a.time);
    setTrackPoint({
      x: ta.x + (tb.x - ta.x) * ratio,
      y: ta.y + (tb.y - ta.y) * ratio,
    });
  }, [playbackTime, followTrackId, trackingBusy, selectedSprite, selectedTrack]);


  // Find selected keyframe across ALL tracks (not just selectedTrack),
  // since selectedTrackId may not be set when a keyframe is clicked.
  const selectedKeyframe = (() => {
    if (!selectedSprite || !editorState.selectedKeyframeId) return undefined;
    for (const track of selectedSprite.timeline.tracks) {
      const kf = track.keyframes.find(k => k.id === editorState.selectedKeyframeId);
      if (kf) return kf;
    }
    return undefined;
  })();

  // Find the track that contains the selected keyframe
  const selectedKeyframeTrack = (() => {
    if (!selectedSprite || !editorState.selectedKeyframeId) return undefined;
    for (const track of selectedSprite.timeline.tracks) {
      if (track.keyframes.some(k => k.id === editorState.selectedKeyframeId)) {
        return track;
      }
    }
    return undefined;
  })();

  // Capture first frame of animated image (webp, gif) when sprite is selected
  useEffect(() => {
    if (!selectedSprite || !selectedSprite.url) {
      setStaticFrameUrl(null);
      return;
    }

    const isAnimatedImage = selectedSprite.format === 'webp' || selectedSprite.format === 'gif';
    if (!isAnimatedImage) {
      setStaticFrameUrl(null);
      return;
    }

    // Capture the first frame using an offscreen canvas
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          // Try WebP first, fallback to PNG
          const dataUrl = canvas.toDataURL('image/webp') || canvas.toDataURL('image/png');
          setStaticFrameUrl(dataUrl);
          staticFrameCaptureRef.current = true;
        }
      } catch (e) {
        console.warn('[TimelineEditor] Failed to capture first frame:', e);
        setStaticFrameUrl(null);
        staticFrameCaptureRef.current = false;
      }
    };
    img.onerror = () => {
      setStaticFrameUrl(null);
      staticFrameCaptureRef.current = false;
    };
    img.src = selectedSprite.url;

    return () => {
      setStaticFrameUrl(null);
      staticFrameCaptureRef.current = false;
    };
  }, [selectedSprite?.url, selectedSprite?.format]);

  // Fetch sprite collections from filesystem (now includes metadata)
  const fetchCollections = useCallback(async () => {
    try {
      const response = await fetch('/api/sprites/collections');
      const data = await response.json();
      const apiCollections: SpriteCollectionFromAPI[] = data.collections || [];
      
      setSpriteCollections(apiCollections);
      
      // Convert to timeline collections - USE METADATA IF AVAILABLE
      const timelineCols: SpriteTimelineCollection[] = apiCollections.map(col => {
        const sprites: TimelineSprite[] = col.files.map(file => {
          const format = getFormatFromFilename(file.name);
          
          // Use metadata if available, otherwise use defaults
          const timeline = file.timeline || createDefaultTimelineData();
          const duration = file.duration || (format === 'webm' || format === 'mp4' || format === 'gif' || format === 'webp' ? 3000 : 0);
          const label = file.label || file.name.replace(/\.[^/.]+$/, '');
          
          return {
            id: `${col.id}_${file.name}`,
            label,
            url: file.url,
            format,
            duration,
            timeline: {
              ...timeline,
              duration: duration, // Sync duration
            },
            triggerKeys: [],
            triggerRequirePipes: false,
            triggerCaseSensitive: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        });
        
        return {
          id: col.id,
          name: col.name,
          sprites,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      });
      
      setTimelineCollections(timelineCols);
      
      return timelineCols;
    } catch (error) {
      console.error('Failed to fetch sprite collections:', error);
      toast({
        title: 'Error',
        description: 'No se pudieron cargar las colecciones de sprites',
        variant: 'destructive',
      });
      return [];
    }
  }, [toast]);

  // Initialize on mount
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await fetchCollections();
      
      // Also load sound collections if not loaded
      if (soundCollections.length === 0) {
        try {
          const response = await fetch('/api/sounds/collections');
          const data = await response.json();
          if (data.collections && Array.isArray(data.collections)) {
            useTavernStore.getState().setSoundCollections(data.collections);
            console.log('[TimelineEditor] Loaded sound collections:', data.collections.length);
          }
        } catch (error) {
          console.error('[TimelineEditor] Failed to load sound collections:', error);
        }
      }
      
      setLoading(false);
    };
    init();
  }, [fetchCollections, soundCollections.length]);

  // Handle refresh
  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchCollections();
    setRefreshing(false);
  };

  // Handle collection selection
  const handleSelectCollection = (collectionId: string) => {
    selectCollection(collectionId);
  };

  // Handle sprite selection
  const handleSelectSprite = (spriteId: string) => {
    selectSprite(spriteId);
    setPlaybackTime(0);
    setIsPlaying(false);
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  };

  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !selectedCollection) return;

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('type', 'sprite');
        formData.append('collection', selectedCollection.name);

        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });

        const data = await response.json();
        
        if (data.success) {
          const format = getFormatFromFilename(file.name);
          const newSprite: TimelineSprite = {
            id: `${selectedCollection.id}_${file.name}`,
            label: file.name.replace(/\.[^/.]+$/, ''),
            url: data.url,
            format,
            duration: format === 'webm' || format === 'mp4' || format === 'gif' || format === 'webp' ? 3000 : 0,
            timeline: createDefaultTimelineData(),
            triggerKeys: [],
            triggerRequirePipes: false,
            triggerCaseSensitive: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          
          setTimelineCollections(prev => prev.map(col => 
            col.id === selectedCollection.id
              ? { ...col, sprites: [...col.sprites, newSprite] }
              : col
          ));
        }
      }
      
      toast({
        title: 'Sprites subidos',
        description: `${files.length} sprite(s) subido(s) correctamente`,
      });
    } catch (error) {
      console.error('Failed to upload sprite:', error);
      toast({
        title: 'Error',
        description: 'No se pudo subir el sprite',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Handle sprite deletion
  const handleDeleteSprite = async (spriteId: string) => {
    if (!selectedCollection) return;
    
    const sprite = selectedCollection.sprites.find(s => s.id === spriteId);
    if (!sprite) return;
    
    if (!confirm(`¿Eliminar el sprite "${sprite.label}"?`)) return;
    
    try {
      setTimelineCollections(prev => prev.map(col =>
        col.id === selectedCollection.id
          ? { ...col, sprites: col.sprites.filter(s => s.id !== spriteId) }
          : col
      ));
      
      if (editorState.selectedSpriteId === spriteId) {
        selectSprite(null);
      }
      
      toast({
        title: 'Sprite eliminado',
        description: `El sprite "${sprite.label}" ha sido eliminado`,
      });
    } catch (error) {
      console.error('Failed to delete sprite:', error);
      toast({
        title: 'Error',
        description: 'No se pudo eliminar el sprite',
        variant: 'destructive',
      });
    }
  };

  // Handle sprite update
  const handleUpdateSprite = (spriteId: string, updates: Partial<TimelineSprite>) => {
    if (!selectedCollection) return;
    
    setTimelineCollections(prev => prev.map(col =>
      col.id === selectedCollection.id
        ? {
            ...col,
            sprites: col.sprites.map(s =>
              s.id === spriteId ? { ...s, ...updates, updatedAt: new Date().toISOString() } : s
            ),
            updatedAt: new Date().toISOString(),
          }
        : col
    ));
  };

  // Save sprite configuration to JSON - AUTOSAVE
  const handleSaveConfiguration = useCallback(async () => {
    if (!selectedCollection || !selectedSprite) return;
    
    setSaving(true);
    try {
      // Extract filename from sprite id
      const filename = selectedSprite.id.replace(`${selectedCollection.id}_`, '');
      
      const spriteData = {
        filename,
        label: selectedSprite.label,
        duration: selectedSprite.duration,
        timeline: selectedSprite.timeline,
      };
      
      const response = await fetch('/api/sprites/collections', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collectionName: selectedCollection.name,
          spriteData,
        }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        toast({
          title: 'Guardado',
          description: `Configuración de "${selectedSprite.label}" guardada correctamente`,
        });
      } else {
        throw new Error(result.error || 'Error al guardar');
      }
    } catch (error) {
      console.error('Failed to save sprite configuration:', error);
      toast({
        title: 'Error',
        description: 'No se pudo guardar la configuración',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }, [selectedCollection, selectedSprite, toast]);

  // Update preview media position
  const updatePreviewPosition = useCallback((time: number) => {
    if (!selectedSprite) return;

    const video = previewVideoRef.current;
    if (video && (selectedSprite.format === 'webm' || selectedSprite.format === 'mp4')) {
      const videoTime = (time / 1000);
      if (video.duration > 0) {
        video.currentTime = videoTime % video.duration;
      }
      return;
    }

    // Animated images (WEBP/GIF): frame-exact rendering via ImageDecoder
    if ((selectedSprite.format === 'webp' || selectedSprite.format === 'gif')) {
      const decoder = frameDecoderRef.current;
      const canvas = previewCanvasRef.current;
      if (decoder && decoder.animated && canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Canvas is sized to the container by CSS; use its box for fitting
          const rect = canvas.getBoundingClientRect();
          const w = Math.max(1, Math.round(rect.width));
          const h = Math.max(1, Math.round(rect.height));
          if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
          decoder.renderAt(ctx, time, w, h).then((idx) => {
            if (idx >= 0) setPreviewFrameIndex(idx);
          }).catch(() => { /* fallback below */ });
          return; // frame-exact path — no seek preview flash needed
        }
      }

      // Fallback (no ImageDecoder): brief animated seek preview
      if (!isPlayingRef.current) {
        if (seekPreviewTimerRef.current) {
          clearTimeout(seekPreviewTimerRef.current);
        }
        setSeekPreview(true);
        seekPreviewTimerRef.current = setTimeout(() => {
          setSeekPreview(false);
          seekPreviewTimerRef.current = null;
        }, 2000);
      }
    }
  }, [selectedSprite]);

  // Render the current frame whenever the decoder becomes available,
  // the sprite changes, or the playhead moves while paused (frame-exact).
  useEffect(() => {
    if (!decoderInfo.supported || decoderInfo.loading || !frameDecoderRef.current) return;
    if (!selectedSprite || isPlaying) return;
    if (selectedSprite.format !== 'webp' && selectedSprite.format !== 'gif') return;
    // updatePreviewPosition renders the frame at playbackTime
    updatePreviewPosition(playbackTime);
  }, [decoderInfo.supported, decoderInfo.loading, selectedSprite?.id, selectedSprite?.format, playbackTime, isPlaying, updatePreviewPosition]);

  // Play sound from sound trigger
  const playSoundFromTrigger = useCallback(async (trigger: SoundTrigger, volume: number = 1) => {
    try {
      console.log('[TimelineEditor] 🎵 Attempting to play trigger:', trigger.name, 'collection:', trigger.collection);
      
      // Get the collection for this trigger
      const collection = soundCollections.find(c => c.name === trigger.collection);
      if (!collection) {
        console.warn('[TimelineEditor] ⚠️ Collection NOT found:', trigger.collection, 'Available:', soundCollections.map(c => c.name));
        return;
      }
      
      if (!collection.files || collection.files.length === 0) {
        console.warn('[TimelineEditor] ⚠️ Collection has no files:', trigger.collection);
        return;
      }
      
      // Pick a sound based on play mode
      let soundFile: string;
      if (trigger.playMode === 'random') {
        soundFile = collection.files[Math.floor(Math.random() * collection.files.length)];
      } else {
        // Cyclic mode - use currentIndex
        const index = trigger.currentIndex || 0;
        soundFile = collection.files[index % collection.files.length];
      }
      
      // The soundFile already contains the full path like "/sounds/glohg/glohg1.wav"
      // So we use it directly
      const soundUrl = soundFile;
      console.log('[TimelineEditor] 🔊 Playing sound:', soundUrl, 'volume:', volume);
      
      // Get or create audio element from cache
      let audio = audioCache.get(soundUrl);
      if (!audio) {
        audio = new Audio(soundUrl);
        audio.load();
        audioCache.set(soundUrl, audio);
      }
      
      // Clone and play (allows overlapping sounds)
      const audioClone = audio.cloneNode() as HTMLAudioElement;
      audioClone.volume = volume * (trigger.volume || 1);
      audioClone.currentTime = 0;
      
      await audioClone.play().catch(e => {
        console.warn('[TimelineEditor] ❌ Audio play failed:', e);
      });
      
      console.log('[TimelineEditor] ✅ Sound playing successfully');
      
      // Clean up after playback
      audioClone.onended = () => {
        audioClone.remove();
      };
    } catch (error) {
      console.error('[TimelineEditor] ❌ Failed to play sound:', error);
    }
  }, [soundCollections]);
  
  // Check and play sounds at current time
  const checkAndPlaySounds = useCallback((currentTime: number) => {
    if (!selectedSprite) return;
    
    // Reset triggered keyframes if we've looped back
    if (currentTime < 100) {
      triggeredKeyframesRef.current.clear();
    }
    
    // Check each track for keyframes to trigger
    selectedSprite.timeline.tracks.forEach((track, trackIndex) => {
      if (track.muted) {
        console.log(`[TimelineEditor] 🔇 Track ${trackIndex} (${track.name}) is muted, skipping`);
        return;
      }
      
      track.keyframes.forEach(keyframe => {
        const keyframeId = keyframe.id;
        const keyframeTime = keyframe.time;
        
        // Check if playhead is crossing this keyframe (within 100ms tolerance for smoother detection)
        const isCrossing = currentTime >= keyframeTime && currentTime < keyframeTime + 100;
        
        if (isCrossing && !triggeredKeyframesRef.current.has(keyframeId)) {
          triggeredKeyframesRef.current.add(keyframeId);
          
          // Get sound trigger info
          const soundValue = keyframe.value as SoundKeyframeValue & { 
            soundTriggerId?: string; 
            soundTriggerName?: string;
          };
          
          console.log(`[TimelineEditor] 🎯 Keyframe triggered at ${keyframeTime}ms (current: ${currentTime}ms)`, {
            soundTriggerId: soundValue.soundTriggerId,
            soundTriggerName: soundValue.soundTriggerName,
            play: soundValue.play,
            volume: soundValue.volume
          });
          
          if (soundValue.soundTriggerId && soundValue.play) {
            // Find the sound trigger
            const trigger = soundTriggers?.find((t: SoundTrigger) => t.id === soundValue.soundTriggerId);
            if (trigger) {
              console.log(`[TimelineEditor] 🎵 Found trigger:`, trigger.name, 'collection:', trigger.collection);
              playSoundFromTrigger(trigger, soundValue.volume || 1);
            } else {
              console.warn(`[TimelineEditor] ⚠️ Trigger not found with ID:`, soundValue.soundTriggerId);
              console.log(`[TimelineEditor] Available triggers:`, soundTriggers?.map(t => ({ id: t.id, name: t.name })));
            }
          } else {
            console.log(`[TimelineEditor] ⏭️ Keyframe has no sound trigger or play=false`);
          }
        }
      });
    });
  }, [selectedSprite, soundTriggers, playSoundFromTrigger]);

  // Handle playback controls
  const handlePlay = useCallback(() => {
    if (!selectedSprite) return;
    
    const duration = selectedSprite.timeline.duration;
    if (!duration || duration <= 0) {
      toast({ description: 'La duración del sprite es 0. Configura una duración mayor.', variant: 'destructive' });
      return;
    }
    
    // Reset triggered keyframes when starting playback
    if (playbackTime === 0) {
      triggeredKeyframesRef.current.clear();
    }
    
    // Start haptic playback using HSP pattern if enabled
    if (hapticEnabled && haptic.isConnected) {
      const hapticTracks = selectedSprite.timeline.tracks.filter(t => t.type === 'haptic' && !t.muted);
      if (hapticTracks.length > 0 && hapticTracks[0].keyframes.length > 0) {
        // Generate HSP pattern from haptic keyframes
        const track = hapticTracks[0];
        const hspKeyframes = track.keyframes.map((kf) => ({
          time: kf.time,
          value: kf.value as HapticKeyframeValue,
          interpolation: kf.interpolation,
        }));
        const hspPoints = generateHspPattern(
          hspKeyframes,
          selectedSprite.timeline.duration,
          selectedSprite.timeline.loop,
        );
        if (hspPoints.length > 0) {
          haptic.playHspPattern(hspPoints, selectedSprite.timeline.loop).then(success => {
            if (success) {
              console.log('[TimelineEditor] 🎮 HSP pattern started');
            } else {
              console.warn('[TimelineEditor] ⚠️ HSP pattern failed');
            }
          });
        }
      }
    }
    
    setIsPlaying(true);
    // Cancel any active seek preview (full playback takes over)
    if (seekPreviewTimerRef.current) {
      clearTimeout(seekPreviewTimerRef.current);
      seekPreviewTimerRef.current = null;
      setSeekPreview(false);
    }
    const startTime = Date.now() - playbackTime;
    
    const animate = () => {
      try {
        const elapsed = Date.now() - startTime;
        const currentTime = elapsed % duration;
        setPlaybackTime(currentTime);
        updatePreviewPosition(currentTime);
        
        // Check and play sounds at current position
        checkAndPlaySounds(currentTime);
        
        // Haptic playback is now handled by HSP pattern (device-native).
        // No need to send per-frame haptic commands — the device handles
        // timing, interpolation, and looping natively.
      } catch (err) {
        console.error('[TimelineEditor] Animation frame error:', err);
      }
      
      // Always schedule next frame (even if there was an error)
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
    
    // Also play the video if it's a video sprite
    const video = previewVideoRef.current;
    if (video && (selectedSprite.format === 'webm' || selectedSprite.format === 'mp4')) {
      video.play().catch(() => {});
    }
  }, [selectedSprite, playbackTime, updatePreviewPosition, checkAndPlaySounds, hapticEnabled, haptic, toast]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    
    // Clear triggered keyframes on pause so they can be replayed when seeking back
    triggeredKeyframesRef.current.clear();
    
    // Stop haptic playback (HSP or HDSP)
    if (hapticEnabled && (haptic.isPlaying || haptic.isHspPlaying)) {
      haptic.stopHapticPlayback();
    }
    
    const video = previewVideoRef.current;
    if (video) {
      video.pause();
    }
  }, [hapticEnabled, haptic]);

  const handleStop = useCallback(() => {
    setIsPlaying(false);
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    setPlaybackTime(0);
    triggeredKeyframesRef.current.clear(); // Clear triggered keyframes
    
    // Stop haptic playback (HSP or HDSP)
    if (hapticEnabled && (haptic.isPlaying || haptic.isHspPlaying)) {
      haptic.stopHapticPlayback();
    }
    
    const video = previewVideoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
  }, [hapticEnabled, haptic]);

  // Handle seek to specific time
  const handleSeek = useCallback((time: number) => {
    if (!selectedSprite) return;
    
    const duration = selectedSprite.timeline.duration;
    const clampedTime = Math.max(0, Math.min(time, duration));
    
    setPlaybackTime(clampedTime);
    updatePreviewPosition(clampedTime);
    
    // Clear triggered keyframes when seeking to allow sounds to play again
    // We need to clear all keyframes that are AFTER the new position
    // so they can be triggered again when the playhead crosses them
    triggeredKeyframesRef.current.clear();
    
    // Update video position
    const video = previewVideoRef.current;
    if (video && (selectedSprite.format === 'webm' || selectedSprite.format === 'mp4')) {
      if (video.duration > 0) {
        video.currentTime = (clampedTime / 1000) % video.duration;
      }
    }
  }, [selectedSprite, updatePreviewPosition]);

  // Track if there are unsaved changes
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const lastSavedSpriteRef = useRef<TimelineSprite | null>(null);

  // Cleanup animation frame on unmount only
  // NOTE: Do NOT depend on `haptic` here — it's a new object ref every render,
  // which would cancel the running requestAnimationFrame on each re-render,
  // killing the playback animation. Haptic cleanup is handled by useHapticPlayback itself.
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (seekPreviewTimerRef.current) {
        clearTimeout(seekPreviewTimerRef.current);
      }
    };
  }, []);

  // Auto-save when sprite changes are detected
  useEffect(() => {
    if (!selectedSprite || !selectedCollection) return;
    
    // Skip if this is the initial load or no changes detected
    if (!hasUnsavedChanges) return;
    
    // Debounce auto-save
    const saveTimeout = setTimeout(() => {
      handleSaveConfiguration();
      setHasUnsavedChanges(false);
    }, 1000); // Save after 1 second of inactivity
    
    return () => clearTimeout(saveTimeout);
  }, [selectedSprite?.timeline, selectedSprite?.duration, selectedSprite?.label, hasUnsavedChanges]);

  // Mark changes when timeline data changes
  useEffect(() => {
    if (selectedSprite && selectedCollection) {
      // Check if sprite data actually changed
      if (lastSavedSpriteRef.current) {
        const hasChanges = 
          JSON.stringify(selectedSprite.timeline) !== JSON.stringify(lastSavedSpriteRef.current.timeline) ||
          selectedSprite.duration !== lastSavedSpriteRef.current.duration ||
          selectedSprite.label !== lastSavedSpriteRef.current.label;
        
        if (hasChanges) {
          setHasUnsavedChanges(true);
        }
      }
    }
  }, [selectedSprite?.timeline, selectedSprite?.duration, selectedSprite?.label, selectedSprite, selectedCollection]);

  // Save when switching sprites or collections
  useEffect(() => {
    // Save previous sprite before switching
    if (lastSavedSpriteRef.current && hasUnsavedChanges) {
      handleSaveConfiguration();
    }
    
    // Update ref to current sprite
    if (selectedSprite) {
      lastSavedSpriteRef.current = { ...selectedSprite };
    } else {
      lastSavedSpriteRef.current = null;
    }
    
    setHasUnsavedChanges(false);
  }, [editorState.selectedSpriteId, editorState.selectedCollectionId]);

  // ============================================
  // HAPTIC PATTERN GENERATORS
  // ============================================
  type HapticPattern = 'sine' | 'ramp' | 'pulse' | 'sawtooth' | 'fast01' | 'slow01' | 'speedup' | 'slowdown' | 'zigzag' | 'topfast' | 'bottomfast';

  const generateHapticPattern = useCallback((pattern: HapticPattern, durationMs: number): Array<{ time: number; position: number }> => {
    const points: Array<{ time: number; position: number }> = [];
    const step = 100; // 100ms intervals

    for (let t = 0; t <= durationMs; t += step) {
      let pos = 50;
      switch (pattern) {
        case 'sine': {
          // Smooth oscillation between 5 and 95, ~2s period
          pos = 50 + 45 * Math.sin((2 * Math.PI * t) / 2000);
          break;
        }
        case 'ramp': {
          // Triangle wave between 5 and 95, ~2s period
          const phase = ((t % 2000) / 2000);
          pos = phase < 0.5 ? 5 + 90 * (phase * 2) : 95 - 90 * ((phase - 0.5) * 2);
          break;
        }
        case 'pulse': {
          // Quick up, hold, quick down, hold, ~3s period
          const phase = (t % 3000) / 3000;
          if (phase < 0.05) pos = 5 + 85 * (phase / 0.05);
          else if (phase < 0.3) pos = 90;
          else if (phase < 0.35) pos = 90 - 85 * ((phase - 0.3) / 0.05);
          else pos = 5;
          break;
        }
        case 'sawtooth': {
          // Slow up, fast down, ~2s period
          const phase = (t % 2000) / 2000;
          if (phase < 0.9) pos = 5 + 90 * (phase / 0.9);
          else pos = 95 - 90 * ((phase - 0.9) / 0.1);
          break;
        }
        case 'fast01': {
          // Quick full strokes, 200ms per stroke
          const phase = (t % 200) / 200;
          pos = phase < 0.5 ? 5 + 85 * (phase * 2) : 90 - 85 * ((phase - 0.5) * 2);
          break;
        }
        case 'slow01': {
          // Slow full strokes, 2s per stroke
          const phase = (t % 2000) / 2000;
          pos = phase < 0.5 ? 5 + 85 * (phase * 2) : 90 - 85 * ((phase - 0.5) * 2);
          break;
        }
        case 'speedup': {
          // Accelerating strokes
          const cycleCount = 1 + (t / durationMs) * 8;
          const phase = (t * cycleCount * 2 * Math.PI) / durationMs;
          pos = 50 + 40 * Math.sin(phase);
          break;
        }
        case 'slowdown': {
          // Decelerating strokes
          const cycleCount = 8 - (t / durationMs) * 6;
          const phase = (t * Math.max(cycleCount, 0.5) * 2 * Math.PI) / durationMs;
          pos = 50 + 40 * Math.sin(phase);
          break;
        }
        case 'zigzag': {
          // Ascending zigzag pattern
          const zigPeriod = 400;
          const zigPhase = (t % zigPeriod) / zigPeriod;
          const baseOffset = Math.min((t / durationMs) * 60, 60);
          pos = baseOffset + (zigPhase < 0.5 ? 20 * (zigPhase * 2) : 20 - 20 * ((zigPhase - 0.5) * 2));
          break;
        }
        case 'topfast': {
          // Oscillation in 50-100 range
          pos = 75 + 20 * Math.sin((2 * Math.PI * t) / 400);
          break;
        }
        case 'bottomfast': {
          // Oscillation in 0-50 range
          pos = 25 + 20 * Math.sin((2 * Math.PI * t) / 400);
          break;
        }
      }
      pos = Math.max(0, Math.min(100, Math.round(pos)));
      points.push({ time: t, position: pos });
    }
    return points;
  }, []);

  const patternNames: Record<HapticPattern, string> = {
    sine: 'Onda Seno',
    ramp: 'Triángulo',
    pulse: 'Pulso',
    sawtooth: 'Diente de Sierra',
    fast01: 'Rápido 0-100',
    slow01: 'Lento 0-100',
    speedup: 'Acelerar',
    slowdown: 'Desacelerar',
    zigzag: 'ZigZag',
    topfast: 'Rápido Arriba',
    bottomfast: 'Rápido Abajo',
  };

  const handleFillPattern = useCallback((trackId: string, pattern: HapticPattern) => {
    if (!selectedSprite) return;
    const track = selectedSprite.timeline.tracks.find(t => t.id === trackId);
    if (!track || track.type !== 'haptic') return;

    const duration = selectedSprite.timeline.duration;
    const points = generateHapticPattern(pattern, duration);

    const newKeyframes: TimelineKeyframe[] = points.map((p, i) => ({
      id: crypto.randomUUID ? crypto.randomUUID() : `kf_${Date.now()}_${i}`,
      time: p.time,
      value: {
        type: 'haptic' as const,
        position: p.position,
        velocity: 1.0,
        velocityMode: 'auto' as const,
        stopOnTarget: false,
      } as HapticKeyframeValue,
      interpolation: 'linear' as const,
    }));

    setTimelineCollections(prev => prev.map(col => ({
      ...col,
      sprites: col.sprites.map(s =>
        s.id === selectedSprite.id
          ? {
              ...s,
              timeline: {
                ...s.timeline,
                tracks: s.timeline.tracks.map(t =>
                  t.id === trackId
                    ? { ...t, keyframes: newKeyframes }
                    : t
                ),
              },
            }
          : s
      ),
    })));

    toast({
      title: 'Patrón aplicado',
      description: `"${patternNames[pattern]}" aplicado con ${newKeyframes.length} keyframes`,
    });
  }, [selectedSprite, generateHapticPattern, toast]);

  // ============================================
  // HAPTIC CSV IMPORT/EXPORT
  // ============================================

  const handleExportHapticCsv = useCallback((trackId: string) => {
    if (!selectedSprite) return;
    const track = selectedSprite.timeline.tracks.find(t => t.id === trackId);
    if (!track || track.type !== 'haptic') return;

    const lines = track.keyframes.map(kf => {
      const hv = kf.value as HapticKeyframeValue;
      return `${Math.round(kf.time)},${Math.round(hv.position)}`;
    });

    const csvContent = lines.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedSprite.label.replace(/[^a-zA-Z0-9]/g, '_')}_haptic.csv`;
    a.click();
    URL.revokeObjectURL(url);

    toast({
      title: 'CSV Exportado',
      description: `${track.keyframes.length} keyframes exportados`,
    });
  }, [selectedSprite, toast]);

  const handleImportHapticCsv = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedSprite || !csvImportTargetTrackId) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target?.result as string;
        const lines = text.trim().split('\n');
        const newKeyframes: TimelineKeyframe[] = [];

        for (const line of lines) {
          const parts = line.trim().split(',');
          if (parts.length < 2) continue;
          const time = parseInt(parts[0], 10);
          const position = parseInt(parts[1], 10);
          if (isNaN(time) || isNaN(position)) continue;

          newKeyframes.push({
            id: crypto.randomUUID ? crypto.randomUUID() : `kf_${Date.now()}_${Math.random()}`,
            time: Math.max(0, time),
            value: {
              type: 'haptic' as const,
              position: Math.max(0, Math.min(100, position)),
              velocity: 1.0,
              velocityMode: 'auto' as const,
              stopOnTarget: false,
            } as HapticKeyframeValue,
            interpolation: 'linear' as const,
          });
        }

        // Sort by time
        newKeyframes.sort((a, b) => a.time - b.time);

        setTimelineCollections(prev => prev.map(col => ({
          ...col,
          sprites: col.sprites.map(s =>
            s.id === selectedSprite.id
              ? {
                  ...s,
                  timeline: {
                    ...s.timeline,
                    tracks: s.timeline.tracks.map(t =>
                      t.id === csvImportTargetTrackId
                        ? { ...t, keyframes: [...t.keyframes, ...newKeyframes] }
                        : t
                    ),
                  },
                }
              : s
          ),
        })));

        toast({
          title: 'CSV Importado',
          description: `${newKeyframes.length} keyframes importados`,
        });
      } catch (error) {
        console.error('Failed to import CSV:', error);
        toast({
          title: 'Error',
          description: 'No se pudo importar el archivo CSV',
          variant: 'destructive',
        });
      }
    };
    reader.readAsText(file);
    setCsvImportTargetTrackId(null);
    if (hapticCsvInputRef.current) hapticCsvInputRef.current.value = '';
  }, [selectedSprite, csvImportTargetTrackId, toast]);

  // ============================================
  // TIMELINE EXPORT / IMPORT
  // ============================================

  const timelineImportInputRef = useRef<HTMLInputElement>(null);

  /** Export the current sprite's timeline data as a standalone .timeline.json file */
  const handleExportTimeline = useCallback(() => {
    if (!selectedSprite) return;

    const exportData = {
      _format: 'tavernflow-timeline-v1',
      _exportedAt: new Date().toISOString(),
      _sourceSprite: selectedSprite.label,
      _sourceDuration: selectedSprite.duration,
      timeline: selectedSprite.timeline,
    };

    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedSprite.label.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ_\-]/g, '_')}.timeline.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({
      title: 'Timeline Exportada',
      description: `Timeline de "${selectedSprite.label}" exportada correctamente`,
    });
  }, [selectedSprite, toast]);

  /** Import a timeline from a .timeline.json file and apply to the current sprite */
  const handleImportTimeline = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedSprite) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const raw = JSON.parse(evt.target?.result as string);

        // Support both wrapped format ({timeline: ...}) and raw SpriteTimelineData
        let timelineData = null;
        if (raw._format === 'tavernflow-timeline-v1' && raw.timeline) {
          timelineData = raw.timeline;
        } else if (raw.tracks && Array.isArray(raw.tracks)) {
          // Raw SpriteTimelineData (has tracks array)
          timelineData = raw;
        }

        if (!timelineData) {
          toast({
            title: 'Error',
            description: 'Formato de archivo no reconocido. Se espera un archivo .timeline.json exportado desde TavernFlow.',
            variant: 'destructive',
          });
          return;
        }

        // Validate required fields
        if (typeof timelineData.duration !== 'number' || timelineData.duration < 0) {
          timelineData.duration = timelineData.duration || 3000;
        }
        if (!Array.isArray(timelineData.tracks)) {
          timelineData.tracks = [];
        }

        // Regenerate IDs for tracks and keyframes to avoid collisions
        const importedTracks = timelineData.tracks.map((track: TimelineTrack) => ({
          ...track,
          id: crypto.randomUUID ? crypto.randomUUID() : `track_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          keyframes: (track.keyframes || []).map((kf: TimelineKeyframe) => ({
            ...kf,
            id: crypto.randomUUID ? crypto.randomUUID() : `kf_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
          })),
        }));

        const importedTimeline: SpriteTimelineData = {
          duration: timelineData.duration,
          tracks: importedTracks,
          markers: timelineData.markers || [],
          loop: timelineData.loop ?? true,
          autoPlaySounds: timelineData.autoPlaySounds ?? true,
          globalVolume: timelineData.globalVolume ?? 1,
        };

        handleUpdateSprite(selectedSprite.id, {
          timeline: importedTimeline,
          duration: importedTimeline.duration,
        });

        toast({
          title: 'Timeline Importada',
          description: `Timeline aplicada a "${selectedSprite.label}" (${importedTracks.length} tracks, ${importedTracks.reduce((acc: number, t: TimelineTrack) => acc + t.keyframes.length, 0)} keyframes)`,
        });
      } catch (error) {
        console.error('Failed to import timeline:', error);
        toast({
          title: 'Error',
          description: 'No se pudo importar la timeline. Verifica que el archivo sea JSON válido.',
          variant: 'destructive',
        });
      }
    };
    reader.readAsText(file);
    // Reset file input
    if (timelineImportInputRef.current) timelineImportInputRef.current.value = '';
  }, [selectedSprite, handleUpdateSprite, toast]);

  // Handle add track
  // ── TRACKING: run optical-flow analysis and create a tracking track ──
  const handleRunTracking = async () => {
    if (!selectedSprite || !trackPoint || trackingBusy) return;
    if (!['webm', 'mp4', 'webp', 'gif'].includes(selectedSprite.format)) {
      toast({ title: 'Formato no trackeable', description: 'Usa un video (webm/mp4) o imagen animada (webp/gif).', variant: 'destructive' });
      return;
    }

    setTrackingBusy(true);
    setTrackingProgress(0);

    try {
      let samples: import('@/lib/sprites/tracker').TrackSample[] = [];

      // Live marker: move the red dot as the tracker advances so the user
      // SEES the tracking following the motion in real time.
      const moveMarker = (s: import('@/lib/sprites/tracker').TrackSample) => {
        if (!s.lost) setTrackPoint({ x: s.x, y: s.y });
      };

      if (selectedSprite.format === 'webm' || selectedSprite.format === 'mp4') {
        const result = await trackVideo(selectedSprite.url, {
          startX: trackPoint.x,
          startY: trackPoint.y,
          // Track the WHOLE video — the timeline duration is extended below
          // so no orphan keyframes are left past the end.
          durationMs: Number.POSITIVE_INFINITY,
          sampleEveryMs: 100,
          movementRange,
          onProgress: setTrackingProgress,
          onSample: moveMarker,
        });
        samples = result.samples;
      } else {
        const decoder = frameDecoderRef.current;
        if (!decoder || !decoder.animated) {
          throw new Error('Decodificador de frames no disponible para este archivo');
        }
        const result = await trackAnimatedImage(
          (idx) => decoder.getFrameBitmap(idx),
          decoder.frameCount,
          (idx) => decoder.frameTimeMs(idx),
          {
            startX: trackPoint.x,
            startY: trackPoint.y,
            // No duration limit: track every frame, then extend the timeline
            // to cover the animation (fixes "keys sueltos" beyond the end).
            durationMs: Number.POSITIVE_INFINITY,
            movementRange,
            onProgress: setTrackingProgress,
            onSample: moveMarker,
          },
        );
        samples = result.samples;
      }

      if (samples.length < 2) {
        throw new Error('No se pudieron trackear suficientes frames');
      }

      // Extend the timeline when the tracked content outlasts the current
      // duration (e.g. default 3000ms vs a 9.7s webp) — keeps every key
      // inside the visible timeline instead of leaving orphans.
      const lastSampleTime = samples[samples.length - 1].time;
      const newDuration = Math.max(
        selectedSprite.timeline.duration,
        Math.ceil(lastSampleTime) + 1,
      );

      // Create the tracking track with keyframes
      const trackId = crypto.randomUUID ? crypto.randomUUID() : `track_${Date.now()}`;
      const keyframes: TimelineKeyframe[] = samples.map((s) => ({
        id: crypto.randomUUID ? crypto.randomUUID() : `kf_${Date.now()}_${s.frame}`,
        time: Math.round(s.time),
        value: {
          type: 'tracking' as const,
          x: s.x,
          y: s.y,
          confidence: s.confidence,
          lost: s.lost,
        } as TrackingKeyframeValue,
        interpolation: 'linear' as const,
      }));

      const trackCount = selectedSprite.timeline.tracks.filter(t => t.type === 'tracking').length;
      const newTrack: import('@/types').TimelineTrack = {
        id: trackId,
        type: 'tracking',
        name: `Tracking ${trackCount + 1}`,
        keyframes,
        enabled: true,
        locked: false,
        muted: false,
        volume: 1,
        color: '#ef4444',
      };

      setTimelineCollections(prev => prev.map(col => ({
        ...col,
        sprites: col.sprites.map(s =>
          s.id === selectedSprite.id
            ? {
                ...s,
                ...(newDuration !== s.timeline.duration ? { duration: newDuration } : {}),
                timeline: { ...s.timeline, duration: newDuration, tracks: [...s.timeline.tracks, newTrack] },
              }
            : s
        ),
      })));

      // Scrub-follow ON: moving the playhead now walks the marker through
      // the tracked trajectory (fine inspection before converting to HSP).
      setFollowTrackId(trackId);

      const okCount = samples.filter(s => !s.lost).length;
      toast({
        title: '🎯 Tracking completado',
        description: `${okCount}/${samples.length} frames trackeados · ${newDuration !== selectedSprite.timeline.duration ? `timeline extendido a ${formatTime(newDuration)} · ` : ''}mueve el playhead para ver el punto recorrer la trayectoria. Usa "→ HSP" en la pista para el patrón haptic.`,
      });
    } catch (e) {
      toast({
        title: 'Tracking falló',
        description: e instanceof Error ? e.message : 'Error desconocido',
        variant: 'destructive',
      });
    } finally {
      setTrackingBusy(false);
      setTrackingProgress(0);
    }
  };

  // ── TRACKING → HAPTIC: convert a tracking track to haptic keyframes ──
  //
  // Two regimes, handled automatically based on the source trajectory's
  // density:
  //
  //   DENSE  (auto-tracking, ≥ SPARSE_THRESHOLD samples): apply Ramer-Douglas-
  //   Peucker simplification with the selected tolerance. RDP keeps every
  //   extreme and direction change, collapses only collinear/redundant points
  //   → a minimal set whose curve stays within ±epsilon of the original.
  //
  //   SPARSE (manual tracking, < SPARSE_THRESHOLD samples): the user placed
  //   every point by hand — none are redundant. RDP would still keep them all
  //   (they all deviate from any line), but the device's linear interpolation
  //   between so few points looks angular. We instead DENSIFY the trajectory
  //   with Catmull-Rom spline samples inserted between every pair of manual
  //   points so the device receives a smooth curve that passes exactly through
  //   every manual anchor.
  //
  // Both regimes apply the same output-scale remap (effMin–effMax) BEFORE
  // the regime-specific step so the curve shape is preserved through scaling.
  // The remap ALWAYS runs: the trajectory's lowest peak → effMin and highest
  // peak → effMax, regardless of the scale values (this means the default
  // 0-100 scale fully normalizes the curve to fill the device range).
  const SPARSE_THRESHOLD = 12;

  const handleTrackingToHaptic = (sourceTrackId: string) => {
    if (!selectedSprite) return;
    const source = selectedSprite.timeline.tracks.find(t => t.id === sourceTrackId);
    if (!source || source.type !== 'tracking' || source.keyframes.length === 0) return;

    // Convert each tracked sample to a haptic position. Two paths:
    //   - 'combined' mode: use trackingToHapticPositionsCombined — the new
    //     delta-sum rule (item 3): baseline = first keyframe's vertical
    //     position; each subsequent keyframe adds (deltaV - deltaH) so the
    //     horizontal delta SUMS to the vertical axis (right=down → negative
    //     contribution; left=up → positive contribution). Naturally reduces
    //     to vertical-only when deltaH=0, and to "left=up/right=down" when
    //     deltaV=0 (item 4).
    //   - 'y' / 'x' modes: single-point mapping (each keyframe independent).
    // In both paths, guides (if enabled) define the absolute reference
    // (topY→100=up, bottomY→0=down) instead of using the full sprite range.
    const validKfs = source.keyframes
      .filter(kf => !(kf.value as TrackingKeyframeValue).lost)
      .sort((a, b) => a.time - b.time);

    if (validKfs.length === 0) {
      toast({ title: 'Pocos puntos', description: 'El tracking no tiene frames confiables (todos lost).', variant: 'destructive' });
      return;
    }

    let mappedAll: Array<{ kf: typeof validKfs[number]; time: number; position: number }>;
    if (trackingMapMode === 'combined') {
      // Delta-sum: needs the whole trajectory at once. Map points →
      // positions array, then zip with keyframes.
      const points = validKfs.map(kf => {
        const tv = kf.value as TrackingKeyframeValue;
        return { x: tv.x, y: tv.y, time: kf.time };
      });
      const positions = trackingToHapticPositionsCombined(points, guides);
      mappedAll = validKfs.map((kf, i) => ({
        kf,
        time: kf.time,
        position: positions[i] ?? 0,
      }));
    } else {
      // Single-point mapping (y or x mode).
      mappedAll = validKfs.map(kf => {
        const tv = kf.value as TrackingKeyframeValue;
        return {
          kf,
          time: kf.time,
          position: trackingToHapticPosition(tv.x, tv.y, trackingMapMode, guides),
        };
      });
    }

    // OUTPUT SCALE (range remap): the trajectory's peaks map to [effMin, effMax].
    //   - With GUIDES enabled (item 2): the positions are already absolute
    //     (relative to the guide limits), so the source range is [0, 100].
    //     The curve lands where the motion actually took it inside the
    //     guides — NOT auto-normalized to fill the device range.
    //   - Without guides: auto-normalize so the curve's lowest peak → effMin
    //     and highest peak → effMax (the curve fills the configured range).
    // The remap is applied BEFORE the regime-specific step (sparse densify /
    // dense simplify) so the curve shape is preserved through scaling.
    const rMin = Math.max(0, Math.min(100, Number.isFinite(hapticRangeMin) ? hapticRangeMin : 0));
    const rMax = Math.max(0, Math.min(100, Number.isFinite(hapticRangeMax) ? hapticRangeMax : 100));
    const effMin = Math.min(rMin, rMax);
    const effMax = Math.max(rMin, rMax);

    let srcMin: number, srcMax: number;
    if (guides.enabled) {
      // Absolute reference: guides define where 0% and 100% of the device
      // stroke are on the sprite. Positions are in [0, 100] already.
      srcMin = 0;
      srcMax = 100;
    } else {
      // Auto-normalize: lowest peak → effMin, highest → effMax.
      srcMin = Infinity;
      srcMax = -Infinity;
      for (const m of mappedAll) {
        if (m.position < srcMin) srcMin = m.position;
        if (m.position > srcMax) srcMax = m.position;
      }
    }
    const remap = createRangeRemapper(srcMin, srcMax, effMin, effMax);
    const scaledAll = mappedAll.map(m => ({ ...m, position: Math.round(remap(m.position)) }));

    // REGIME DETECTION: sparse (manual) vs dense (auto).
    const isSparse = scaledAll.length < SPARSE_THRESHOLD;

    // REGIME-SPECIFIC PROCESSING
    let processed: typeof scaledAll;
    let regimeLabel: string;
    if (isSparse) {
      // SPARSE: densify via Catmull-Rom spline. Every original manual point
      // is preserved; intermediate samples are inserted between pairs so the
      // device's linear interpolation looks like a smooth curve through the
      // manual anchors (instead of N-1 straight segments).
      processed = densifyTrajectoryCatmullRom(scaledAll, (m) => m.position, 50);
      regimeLabel = `denso Catmull-Rom (${scaledAll.length}→${processed.length})`;
    } else {
      // DENSE: Ramer-Douglas-Peucker simplification. Collapse redundant
      // collinear samples (e.g. 1 kf/frame) into the minimal set whose
      // curve stays within ±epsilon of the original. Extremes and direction
      // changes are always preserved.
      const epsilon = RDP_TOLERANCES[rdpTolerance];
      processed = simplifyKeyframesRDP(scaledAll, (m) => m.position, epsilon);
      regimeLabel = `RDP ±${epsilon} (${scaledAll.length}→${processed.length})`;
    }

    const hapticKeyframes: TimelineKeyframe[] = processed.map((m, idx) => ({
      id: crypto.randomUUID ? crypto.randomUUID() : `kf_${Date.now()}_${idx}_${m.time}`,
      // Use the (possibly inserted) item time, not m.kf.time — for inserted
      // samples, m.kf is the previous anchor and its time is wrong.
      time: m.time,
      value: {
        type: 'haptic' as const,
        position: m.position,
        velocity: 1.0,
        velocityMode: 'auto' as const,
        stopOnTarget: false,
      },
      interpolation: 'linear' as const,
    }));

    if (hapticKeyframes.length < 2) {
      toast({ title: 'Pocos puntos', description: 'El tracking no tiene suficientes frames confiables para convertir.', variant: 'destructive' });
      return;
    }

    // Add (or reuse) a haptic track
    const existingHaptic = selectedSprite.timeline.tracks.find(t => t.type === 'haptic' && t.name === `HSP ${source.name}`);
    if (existingHaptic) {
      setTimelineCollections(prev => prev.map(col => ({
        ...col,
        sprites: col.sprites.map(s =>
          s.id === selectedSprite.id
            ? {
                ...s,
                timeline: {
                  ...s.timeline,
                  tracks: s.timeline.tracks.map(t =>
                    t.id === existingHaptic.id ? { ...t, keyframes: hapticKeyframes } : t
                  ),
                },
              }
            : s
        ),
      })));
    } else {
      const newTrack: import('@/types').TimelineTrack = {
        id: crypto.randomUUID ? crypto.randomUUID() : `track_${Date.now()}`,
        type: 'haptic',
        name: `HSP ${source.name}`,
        keyframes: hapticKeyframes,
        enabled: true,
        locked: false,
        muted: false,
        volume: 1,
      };
      setTimelineCollections(prev => prev.map(col => ({
        ...col,
        sprites: col.sprites.map(s =>
          s.id === selectedSprite.id
            ? { ...s, timeline: { ...s.timeline, tracks: [...s.timeline.tracks, newTrack] } }
            : s
        ),
      })));
    }

    const change = processed.length - scaledAll.length;
    const changePct = scaledAll.length > 0
      ? Math.round((change / scaledAll.length) * 100)
      : 0;
    const changeLabel = isSparse
      ? `+${change} samples (${changePct}%) densificados`
      : `−${scaledAll.length - processed.length} puntos (${Math.abs(changePct)}%) simplificados`;
    toast({
      title: '💜 Patrón HSP generado',
      description: `${hapticKeyframes.length} keyframes · ${regimeLabel} · mapeo "${trackingMapMode === 'combined' ? 'combinado (ΔV − ΔH: derecha=baja)' : trackingMapMode === 'x' ? 'horizontal invertido' : 'vertical'}" · ${changeLabel} · escala ${effMin}–${effMax}${guides.enabled ? ' · guías ON (absoluto)' : ' · auto-normalizado'}`,
    });
  };

  const handleAddTrack = (type: 'sound' | 'haptic' | 'tracking' = 'sound') => {
    if (!selectedSprite) return;

    const trackId = crypto.randomUUID ? crypto.randomUUID() : `track_${Date.now()}`;
    const hapticCount = selectedSprite.timeline.tracks.filter(t => t.type === 'haptic').length;
    const soundCount = selectedSprite.timeline.tracks.filter(t => t.type === 'sound').length;
    const trackingCount = selectedSprite.timeline.tracks.filter(t => t.type === 'tracking').length;
    const newTrack: TimelineTrack = {
      id: trackId,
      type,
      name: type === 'haptic'
        ? `Haptic Track ${hapticCount + 1}`
        : type === 'tracking'
        ? `Tracking ${trackingCount + 1}`
        : `Sound Track ${soundCount + 1}`,
      keyframes: [],
      enabled: true,
      locked: false,
      muted: false,
      volume: 1,
      color: type === 'tracking' ? '#ef4444' : type === 'haptic' ? '#d946ef' : undefined,
    };

    setTimelineCollections(prev => prev.map(col => ({
      ...col,
      sprites: col.sprites.map(s =>
        s.id === selectedSprite.id
          ? { ...s, timeline: { ...s.timeline, tracks: [...s.timeline.tracks, newTrack] } }
          : s
      ),
    })));
  };

  // ── TRACKING: manual keyframe add/remove ──
  // The user can place a tracking keyframe at the current red-marker position
  // + current playhead time — manual tracking for cases where the optical-flow
  // tracker loses the point. The manually-placed points then feed →HSP just
  // like the auto-tracked samples.
  const handleAddTrackingPoint = (trackId: string) => {
    if (!selectedSprite) return;
    if (!trackPoint) {
      toast({
        title: 'Coloca el punto rojo',
        description: 'Haz clic en el preview y arrastra el punto rojo al lugar a trackear, luego pulsa "+".',
        variant: 'destructive',
      });
      return;
    }
    const targetTrack = selectedSprite.timeline.tracks.find(t => t.id === trackId);
    if (!targetTrack || targetTrack.type !== 'tracking') return;

    const t = Math.max(0, Math.round(playbackTime));
    // If a keyframe already exists at ~the same time, UPDATE it (no duplicates).
    const MERGE_MS = 60;
    const existingIdx = targetTrack.keyframes.findIndex(
      kf => Math.abs(kf.time - t) <= MERGE_MS,
    );

    const newValue: TrackingKeyframeValue = {
      type: 'tracking',
      x: trackPoint.x,
      y: trackPoint.y,
      confidence: 1,
      lost: false,
    };

    setTimelineCollections(prev => prev.map(col => ({
      ...col,
      sprites: col.sprites.map(s =>
        s.id === selectedSprite.id
          ? {
              ...s,
              timeline: {
                ...s.timeline,
                tracks: s.timeline.tracks.map(tk => {
                  if (tk.id !== trackId) return tk;
                  if (existingIdx >= 0) {
                    const updated = [...tk.keyframes];
                    updated[existingIdx] = {
                      ...updated[existingIdx],
                      value: newValue,
                      // Snap the time to the exact current playhead for clarity
                      time: t,
                    };
                    return { ...tk, keyframes: updated.sort((a, b) => a.time - b.time) };
                  }
                  const newKf: TimelineKeyframe = {
                    id: crypto.randomUUID ? crypto.randomUUID() : `kf_${Date.now()}`,
                    time: t,
                    value: newValue,
                    interpolation: 'linear',
                  };
                  return { ...tk, keyframes: [...tk.keyframes, newKf].sort((a, b) => a.time - b.time) };
                }),
              },
            }
          : s
      ),
    })));

    // Select the (new or updated) keyframe so the user sees feedback
    if (existingIdx >= 0) {
      selectKeyframe(targetTrack.keyframes[existingIdx].id);
    }
  };

  // Keep handleAddTrackingPointRef in sync with the latest closure so the
  // red-point drag's onMouseUp (which is a stale closure captured at
  // mousedown time) can call the latest version. useEffect with no deps
  // array runs after every render — the ref always holds the freshest
  // closure (which reads the latest trackPoint, selectedSprite, etc.).
  useEffect(() => {
    handleAddTrackingPointRef.current = handleAddTrackingPoint;
  });

  // Remove the SELECTED tracking keyframe, or — if none — the one closest to
  // the current playhead. Falls back to the last keyframe.
  const handleRemoveTrackingPoint = (trackId: string) => {
    if (!selectedSprite) return;
    const targetTrack = selectedSprite.timeline.tracks.find(t => t.id === trackId);
    if (!targetTrack || targetTrack.type !== 'tracking' || targetTrack.keyframes.length === 0) return;

    let targetId: string | null = null;
    // 1) editorState.selectedKeyframeId (if it belongs to this track)
    if (editorState.selectedKeyframeId) {
      const sel = targetTrack.keyframes.find(kf => kf.id === editorState.selectedKeyframeId);
      if (sel) targetId = sel.id;
    }
    // 2) closest to playhead
    if (!targetId) {
      let best = targetTrack.keyframes[0];
      let bestDelta = Math.abs(best.time - playbackTime);
      for (const kf of targetTrack.keyframes) {
        const d = Math.abs(kf.time - playbackTime);
        if (d < bestDelta) { bestDelta = d; best = kf; }
      }
      targetId = best.id;
    }

    handleDeleteKeyframe(trackId, targetId);
  };

  // Handle track update
  const handleUpdateTrack = (trackId: string, updates: Partial<TimelineTrack>) => {
    if (!selectedSprite) return;
    
    setTimelineCollections(prev => prev.map(col => ({
      ...col,
      sprites: col.sprites.map(s =>
        s.id === selectedSprite.id
          ? { ...s, timeline: { ...s.timeline, tracks: s.timeline.tracks.map(t => t.id === trackId ? { ...t, ...updates } : t) } }
          : s
      ),
    })));
  };

  // Handle track delete
  const handleDeleteTrack = (trackId: string) => {
    if (!selectedSprite) return;
    
    setTimelineCollections(prev => prev.map(col => ({
      ...col,
      sprites: col.sprites.map(s =>
        s.id === selectedSprite.id
          ? { ...s, timeline: { ...s.timeline, tracks: s.timeline.tracks.filter(t => t.id !== trackId) } }
          : s
      ),
    })));
  };

  // Handle keyframe update
  const handleUpdateKeyframe = (trackId: string, keyframeId: string, updates: Partial<TimelineKeyframe>) => {
    if (!selectedSprite) return;
    
    setTimelineCollections(prev => prev.map(col => ({
      ...col,
      sprites: col.sprites.map(s =>
        s.id === selectedSprite.id
          ? {
              ...s,
              timeline: {
                ...s.timeline,
                tracks: s.timeline.tracks.map(t =>
                  t.id === trackId
                    ? { ...t, keyframes: t.keyframes.map(k => k.id === keyframeId ? { ...k, ...updates } : k) }
                    : t
                ),
              },
            }
          : s
      ),
    })));
  };

  // Handle keyframe delete
  const handleDeleteKeyframe = (trackId: string, keyframeId: string) => {
    if (!selectedSprite) return;
    
    setTimelineCollections(prev => prev.map(col => ({
      ...col,
      sprites: col.sprites.map(s =>
        s.id === selectedSprite.id
          ? {
              ...s,
              timeline: {
                ...s.timeline,
                tracks: s.timeline.tracks.map(t =>
                  t.id === trackId
                    ? { ...t, keyframes: t.keyframes.filter(k => k.id !== keyframeId) }
                    : t
                ),
              },
            }
          : s
      ),
    })));
    
    if (editorState.selectedKeyframeId === keyframeId) {
      selectKeyframe(null);
    }
  };

  // Handle keyframe move (supports optional position for haptic tracks)
  const handleMoveKeyframe = (trackId: string, keyframeId: string, newTime: number, newPosition?: number) => {
    if (!selectedSprite) return;
    
    let time = newTime;
    if (editorState.snapEnabled && editorState.snapInterval > 0) {
      time = Math.round(newTime / editorState.snapInterval) * editorState.snapInterval;
    }
    time = Math.max(0, time);
    
    setTimelineCollections(prev => prev.map(col => ({
      ...col,
      sprites: col.sprites.map(s =>
        s.id === selectedSprite.id
          ? {
              ...s,
              timeline: {
                ...s.timeline,
                tracks: s.timeline.tracks.map(t =>
                  t.id === trackId
                    ? {
                        ...t,
                        keyframes: t.keyframes.map(k => {
                          if (k.id !== keyframeId) return k;
                          const updated = { ...k, time };
                          if (newPosition !== undefined && (k.value as HapticKeyframeValue)?.type === 'haptic') {
                            updated.value = { ...k.value, position: Math.round(newPosition) } as HapticKeyframeValue;
                          }
                          return updated;
                        }).sort((a, b) => a.time - b.time),
                      }
                    : t
                ),
              },
            }
          : s
      ),
    })));
  };

  // Handle drag start for sound trigger
  const handleDragStart = (e: React.DragEvent, trigger: SoundTrigger) => {
    e.dataTransfer.setData('soundTrigger', JSON.stringify(trigger));
    e.dataTransfer.effectAllowed = 'copy';
  };

  // Handle drop on timeline track
  const handleTrackDrop = (e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    setDragOverTrackId(null);

    const triggerData = e.dataTransfer.getData('soundTrigger');
    if (!triggerData || !selectedSprite) return;
    
    try {
      const trigger: SoundTrigger = JSON.parse(triggerData);
      
      // Calculate time from drop position
      // rect is the viewport position of the track content div (which starts after the header)
      // e.clientX - rect.left gives position within the content div in viewport space
      // Adding scrollLeft converts to absolute position in the timeline
      const rect = e.currentTarget.getBoundingClientRect();
      const scrollLeft = timelineScrollRef.current?.scrollLeft || 0;
      const mouseX = e.clientX - rect.left + scrollLeft;
      const time = mouseX / editorState.zoom;
      
      // Create keyframe with sound trigger reference
      const keyframeId = crypto.randomUUID ? crypto.randomUUID() : `kf_${Date.now()}`;
      let keyframeTime = Math.max(0, time);
      
      // Apply snap
      if (editorState.snapEnabled && editorState.snapInterval > 0) {
        keyframeTime = Math.round(keyframeTime / editorState.snapInterval) * editorState.snapInterval;
      }
      
      const newKeyframe: TimelineKeyframe = {
        id: keyframeId,
        time: keyframeTime,
        value: {
          type: 'sound',
          soundUrl: '',
          soundTriggerId: trigger.id,
          soundTriggerName: trigger.name,
          volume: trigger.volume,
          pan: 0,
          play: true,
          stop: false,
        } as SoundKeyframeValue & { soundTriggerId?: string; soundTriggerName?: string },
        interpolation: 'hold',
      };
      
      setTimelineCollections(prev => prev.map(col => ({
        ...col,
        sprites: col.sprites.map(s =>
          s.id === selectedSprite.id
            ? {
                ...s,
                timeline: {
                  ...s.timeline,
                  tracks: s.timeline.tracks.map(t =>
                    t.id === trackId
                      ? { ...t, keyframes: [...t.keyframes, newKeyframe].sort((a, b) => a.time - b.time) }
                      : t
                  ),
                },
              }
            : s
        ),
      })));
      
      toast({
        title: 'Sonido agregado',
        description: `Trigger "${trigger.name}" agregado al timeline`,
      });
    } catch (error) {
      console.error('Failed to drop sound trigger:', error);
    }
  };

  // Add sound trigger at current playhead position (click-based alternative to drag-and-drop)
  const handleAddSoundAtPlayhead = useCallback((trigger: SoundTrigger) => {
    if (!selectedSprite) {
      toast({ description: 'Selecciona un sprite primero', variant: 'destructive' });
      return;
    }

    // Find the first non-muted sound track, or the first sound track
    const soundTracks = selectedSprite.timeline.tracks.filter(t => t.type !== 'haptic');
    const targetTrack = soundTracks.find(t => !t.muted) || soundTracks[0];

    if (!targetTrack) {
      toast({ description: 'Crea un track de sonido primero (Añadir Track → Track de Sonido)', variant: 'destructive' });
      return;
    }

    const time = Math.max(0, Math.min(playbackTime, selectedSprite.timeline.duration));

    // Apply snap
    let keyframeTime = time;
    if (editorState.snapEnabled && editorState.snapInterval > 0) {
      keyframeTime = Math.round(keyframeTime / editorState.snapInterval) * editorState.snapInterval;
    }

    const keyframeId = crypto.randomUUID ? crypto.randomUUID() : `kf_${Date.now()}`;
    const newKeyframe: TimelineKeyframe = {
      id: keyframeId,
      time: keyframeTime,
      value: {
        type: 'sound',
        soundUrl: '',
        soundTriggerId: trigger.id,
        soundTriggerName: trigger.name,
        volume: trigger.volume,
        pan: 0,
        play: true,
        stop: false,
      } as SoundKeyframeValue & { soundTriggerId?: string; soundTriggerName?: string },
      interpolation: 'hold',
    };

    setTimelineCollections(prev => prev.map(col => ({
      ...col,
      sprites: col.sprites.map(s =>
        s.id === selectedSprite.id
          ? {
              ...s,
              timeline: {
                ...s.timeline,
                tracks: s.timeline.tracks.map(t =>
                  t.id === targetTrack.id
                    ? { ...t, keyframes: [...t.keyframes, newKeyframe].sort((a, b) => a.time - b.time) }
                    : t
                ),
              },
            }
          : s
      ),
    })));

    toast({
      title: 'Sonido agregado',
      description: `"${trigger.name}" en ${formatTime(keyframeTime)} → ${targetTrack.name}`,
    });
  }, [selectedSprite, playbackTime, editorState.snapEnabled, editorState.snapInterval, toast]);

  // Handle drag over
  const handleDragOver = (e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOverTrackId(trackId);
  };

  // Handle drag leave
  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear if leaving the track entirely (not entering a child element)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverTrackId(null);
    }
  };

  // Safe video play handler for thumbnails
  const handleVideoHover = (spriteId: string, isEntering: boolean) => {
    const video = videoRefs.current.get(spriteId);
    if (!video) return;
    
    try {
      if (isEntering) {
        video.currentTime = 0;
        const playPromise = video.play();
        if (playPromise !== undefined) {
          playPromise.catch(() => {});
        }
      } else {
        video.pause();
        video.currentTime = 0;
      }
    } catch {}
  };

  // ===== PLAYHEAD DRAG HANDLERS =====
  const handlePlayheadMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingPlayhead(true);
    if (isPlaying) {
      handlePause();
    }
  }, [isPlaying, handlePause]);

  const handlePlayheadMouseMove = useCallback((e: MouseEvent) => {
    if (!isDraggingPlayhead || !selectedSprite || !timelineScrollRef.current || !rulerRef.current) return;
    
    const container = timelineScrollRef.current;
    const rect = container.getBoundingClientRect();
    const scrollLeft = container.scrollLeft;
    const trackHeaderWidth = 180;
    
    // Calculate position relative to track content
    const mouseX = e.clientX - rect.left + scrollLeft - trackHeaderWidth;
    const time = mouseX / editorState.zoom;
    
    handleSeek(time);
  }, [isDraggingPlayhead, selectedSprite, editorState.zoom, handleSeek]);

  const handlePlayheadMouseUp = useCallback(() => {
    setIsDraggingPlayhead(false);
  }, []);

  // Add/remove mouse event listeners for playhead dragging
  useEffect(() => {
    if (isDraggingPlayhead) {
      window.addEventListener('mousemove', handlePlayheadMouseMove);
      window.addEventListener('mouseup', handlePlayheadMouseUp);
      return () => {
        window.removeEventListener('mousemove', handlePlayheadMouseMove);
        window.removeEventListener('mouseup', handlePlayheadMouseUp);
      };
    }
  }, [isDraggingPlayhead, handlePlayheadMouseMove, handlePlayheadMouseUp]);

  // ===== KEYFRAME DRAG HANDLERS =====
  const handleKeyframeMouseMove = useCallback((e: MouseEvent) => {
    if (!draggingKeyframe || !selectedSprite || !timelineScrollRef.current) return;
    
    const container = timelineScrollRef.current;
    const rect = container.getBoundingClientRect();
    const scrollLeft = container.scrollLeft;
    const trackHeaderWidth = 180;
    
    // Calculate position relative to track content
    const mouseX = e.clientX - rect.left + scrollLeft - trackHeaderWidth;
    let newTime = mouseX / editorState.zoom;
    
    // Apply snap
    if (editorState.snapEnabled && editorState.snapInterval > 0) {
      newTime = Math.round(newTime / editorState.snapInterval) * editorState.snapInterval;
    }
    
    // Clamp to valid range
    newTime = Math.max(0, Math.min(newTime, selectedSprite.timeline.duration));
    
    // For haptic tracks, also calculate Y position
    let newPosition: number | undefined;
    if (draggingKeyframe.isHaptic && hapticDragTrackElRef.current) {
      // Re-query fresh rect on each move to handle vertical scroll
      const trackRect = hapticDragTrackElRef.current.getBoundingClientRect();
      const mouseY = e.clientY - trackRect.top;
      // Convert Y pixel to position: top = 100, bottom = 0
      const rawPosition = 100 - (mouseY / 120 * 100);
      newPosition = Math.max(0, Math.min(100, Math.round(rawPosition)));
      // Update live drag tooltip
      setHapticDragInfo({ position: newPosition, x: e.clientX, y: e.clientY });
    }
    
    // Multi-keyframe drag: if multiple keyframes are selected, move them all together
    const currentSelectedIds = useTavernStore.getState().editorState.selectedKeyframeIds;
    if (currentSelectedIds.length > 1 && multiDragInitialPositionsRef.current.size > 0 && multiDragStartTimeRef.current !== null) {
      // Calculate delta from the primary dragged keyframe's initial position
      const primaryInitial = multiDragInitialPositionsRef.current.get(draggingKeyframe.keyframeId);
      if (primaryInitial) {
        const timeDelta = newTime - primaryInitial.time;
        const positionDelta = (newPosition !== undefined && primaryInitial.position !== undefined)
          ? newPosition - primaryInitial.position
          : undefined;
        
        // Move all selected keyframes by the same delta
        setTimelineCollections(prev => prev.map(col => ({
          ...col,
          sprites: col.sprites.map(s =>
            s.id === selectedSprite.id
              ? {
                  ...s,
                  timeline: {
                    ...s.timeline,
                    tracks: s.timeline.tracks.map(t => ({
                      ...t,
                      keyframes: t.keyframes.map(k => {
                        const initial = multiDragInitialPositionsRef.current.get(k.id);
                        if (!initial) return k;
                        
                        let movedTime = initial.time + timeDelta;
                        // Apply snap
                        if (editorState.snapEnabled && editorState.snapInterval > 0) {
                          movedTime = Math.round(movedTime / editorState.snapInterval) * editorState.snapInterval;
                        }
                        movedTime = Math.max(0, Math.min(movedTime, selectedSprite.timeline.duration));
                        
                        const updated = { ...k, time: movedTime };
                        // For haptic keyframes, also move position
                        if (positionDelta !== undefined && initial.position !== undefined) {
                          const hv = k.value as HapticKeyframeValue;
                          if (hv.type === 'haptic') {
                            const movedPosition = Math.max(0, Math.min(100, Math.round(initial.position + positionDelta)));
                            updated.value = { ...k.value, position: movedPosition } as HapticKeyframeValue;
                          }
                        }
                        return updated;
                      }).sort((a, b) => a.time - b.time),
                    })),
                  },
                }
              : s
          ),
        })));
        return; // Skip single keyframe move below
      }
    }
    
    // Single keyframe move (original behavior)
    handleMoveKeyframe(draggingKeyframe.trackId, draggingKeyframe.keyframeId, newTime, newPosition);
  }, [draggingKeyframe, selectedSprite, editorState.zoom, editorState.snapEnabled, editorState.snapInterval, handleMoveKeyframe]);

  const handleKeyframeMouseUp = useCallback(() => {
    setDraggingKeyframe(null);
    setHapticDragInfo(null);
    hapticDragTrackElRef.current = null;
    // Clear multi-drag state
    setMultiDragInitialPositions(new Map());
    multiDragInitialPositionsRef.current = new Map();
    setMultiDragStartTime(null);
    multiDragStartTimeRef.current = null;
  }, []);

  // Add/remove mouse event listeners for keyframe dragging
  useEffect(() => {
    if (draggingKeyframe) {
      window.addEventListener('mousemove', handleKeyframeMouseMove);
      window.addEventListener('mouseup', handleKeyframeMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleKeyframeMouseMove);
        window.removeEventListener('mouseup', handleKeyframeMouseUp);
      };
    }
  }, [draggingKeyframe, handleKeyframeMouseMove, handleKeyframeMouseUp]);

  // ===== MARQUEE SELECTION HANDLERS =====
  const handleMarqueeMouseMove = useCallback((e: MouseEvent) => {
    if (!isMarqueeSelecting || !marqueeStart) return;
    
    const scrollLeft = timelineScrollRef.current?.scrollLeft || 0;
    // Find the track content element for marqueeTrackId
    const trackContentEl = document.querySelector(`[data-track-id="${marqueeTrackId}"] [data-track-content]`);
    let time = marqueeStart.time;
    if (trackContentEl) {
      const rect = trackContentEl.getBoundingClientRect();
      const mouseX = e.clientX - rect.left + scrollLeft;
      time = mouseX / editorState.zoom;
    }
    
    setMarqueeEnd({ x: e.clientX, y: e.clientY, time });
  }, [isMarqueeSelecting, marqueeStart, marqueeTrackId, editorState.zoom]);

  const handleMarqueeMouseUp = useCallback(() => {
    if (!isMarqueeSelecting || !marqueeStart || !marqueeEnd || !selectedSprite || !marqueeTrackId) {
      setIsMarqueeSelecting(false);
      setMarqueeStart(null);
      setMarqueeEnd(null);
      setMarqueeTrackId(null);
      return;
    }
    
    // Find the track
    const track = selectedSprite.timeline.tracks.find(t => t.id === marqueeTrackId);
    if (track) {
      const isHapticTrack = track.type === 'haptic';
      
      // Calculate time range from marquee
      const minTime = Math.min(marqueeStart.time, marqueeEnd.time);
      const maxTime = Math.max(marqueeStart.time, marqueeEnd.time);
      
      // Find keyframes within the marquee selection
      const selectedIds: string[] = [];
      const trackContentEl = document.querySelector(`[data-track-id="${marqueeTrackId}"] [data-track-content]`);
      const trackRect = trackContentEl?.getBoundingClientRect();
      
      for (const kf of track.keyframes) {
        // Check time range
        if (kf.time >= minTime && kf.time <= maxTime) {
          if (isHapticTrack && trackRect) {
            // For haptic, also check Y range
            const hv = kf.value as HapticKeyframeValue;
            const kfY = trackRect.top + ((100 - hv.position) / 100) * trackRect.height;
            if (kfY >= Math.min(marqueeStart.y, marqueeEnd.y) && kfY <= Math.max(marqueeStart.y, marqueeEnd.y)) {
              selectedIds.push(kf.id);
            }
          } else {
            selectedIds.push(kf.id);
          }
        }
      }
      
      if (selectedIds.length > 0) {
        selectKeyframes(selectedIds);
      } else {
        clearKeyframeSelection();
      }
    }
    
    setIsMarqueeSelecting(false);
    setMarqueeStart(null);
    setMarqueeEnd(null);
    setMarqueeTrackId(null);
  }, [isMarqueeSelecting, marqueeStart, marqueeEnd, selectedSprite, marqueeTrackId, selectKeyframes, clearKeyframeSelection]);

  // Add/remove marquee event listeners
  useEffect(() => {
    if (isMarqueeSelecting) {
      window.addEventListener('mousemove', handleMarqueeMouseMove);
      window.addEventListener('mouseup', handleMarqueeMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMarqueeMouseMove);
        window.removeEventListener('mouseup', handleMarqueeMouseUp);
      };
    }
  }, [isMarqueeSelecting, handleMarqueeMouseMove, handleMarqueeMouseUp]);

  // Handle Delete key to remove selected keyframes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedSprite) return;
      
      // Delete or Backspace key
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Don't delete if focused on an input element
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
        
        const selectedIds = editorState.selectedKeyframeIds;
        if (selectedIds.length === 0) return;
        
        e.preventDefault();
        
        // Delete all selected keyframes
        setTimelineCollections(prev => prev.map(col => ({
          ...col,
          sprites: col.sprites.map(s =>
            s.id === selectedSprite.id
              ? {
                  ...s,
                  timeline: {
                    ...s.timeline,
                    tracks: s.timeline.tracks.map(t => ({
                      ...t,
                      keyframes: t.keyframes.filter(k => !selectedIds.includes(k.id)),
                    })),
                  },
                }
              : s
          ),
        })));
        
        clearKeyframeSelection();
        toast({
          title: 'Keyframes eliminados',
          description: `${selectedIds.length} keyframe(s) eliminado(s)`,
        });
      }
      
      // Escape key to clear selection
      if (e.key === 'Escape') {
        clearKeyframeSelection();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedSprite, editorState.selectedKeyframeIds, clearKeyframeSelection, toast]);

  // Handle timeline ruler click for seeking
  const handleRulerClick = (e: React.MouseEvent) => {
    if (!selectedSprite || !timelineScrollRef.current || !rulerRef.current) return;
    
    const rect = rulerRef.current.getBoundingClientRect();
    const scrollLeft = timelineScrollRef.current.scrollLeft;
    const trackHeaderWidth = 180;
    const clickX = e.clientX - rect.left + scrollLeft - trackHeaderWidth;
    const time = clickX / editorState.zoom;
    
    handleSeek(time);
  };

  // Calculate pixels per millisecond based on zoom
  const pixelsPerMs = editorState.zoom;
  const timelineWidth = selectedSprite ? Math.max(selectedSprite.timeline.duration * pixelsPerMs, 800) : 800;
  
  // Generate ruler marks with subdivisions (5 per second = 200ms intervals)
  const generateRulerMarks = () => {
    if (!selectedSprite) return null;
    
    const duration = selectedSprite.timeline.duration;
    const marks: React.JSX.Element[] = [];
    const subdivisionMs = 200; // 5 divisions per second
    
    // Calculate how many seconds we can fit
    const totalSeconds = Math.ceil(duration / 1000);
    
    for (let second = 0; second <= totalSeconds; second++) {
      // Add subdivision marks
      for (let sub = 0; sub < 5; sub++) {
        const subMs = second * 1000 + sub * subdivisionMs;
        if (subMs > duration) break;

        const position = subMs * pixelsPerMs;
        const isMainMark = sub === 0;

        marks.push(
          <div
            key={`mark-${subMs}`}
            className="absolute top-0 flex flex-col items-center pointer-events-none"
            style={{ left: `${position}px` }}
          >
            <div
              className={cn(
                "w-px",
                isMainMark
                  ? "h-3 bg-foreground/60"
                  : "h-1.5 bg-muted-foreground/40"
              )}
            />
            {isMainMark && (
              <span className="text-[10px] font-mono tabular-nums text-muted-foreground mt-0.5 -translate-x-1/2 ml-[0px] left-0 relative">
                {second < 60 ? `${second}s` : `${Math.floor(second / 60)}:${String(second % 60).padStart(2, '0')}`}
              </span>
            )}
          </div>
        );
      }
    }
    
    return marks;
  };

  // Loading state
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Cargando colecciones...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-4 overflow-hidden">
      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="image/*,video/*"
        multiple
        onChange={handleFileUpload}
      />
      {/* Hidden haptic CSV file input */}
      <input
        type="file"
        ref={hapticCsvInputRef}
        className="hidden"
        accept=".csv"
        onChange={handleImportHapticCsv}
      />
      
      {/* Hidden file input for timeline import */}
      <input
        type="file"
        ref={timelineImportInputRef}
        className="hidden"
        accept=".json,.timeline.json"
        onChange={handleImportTimeline}
      />
      
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-amber-500" />
          <h3 className="font-semibold">Editor de Sprite Timeline</h3>
          <Badge variant="outline" className="text-xs">
            {spriteCollections.length} colecciones
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSaveConfiguration}
            disabled={saving || !selectedSprite}
            title="Guardar configuración"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            title="Recargar colecciones"
          >
            {refreshing ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => toggleSnap(!editorState.snapEnabled)}
            className={cn(editorState.snapEnabled && "bg-primary/10")}
            title="Activar/Desactivar Snap"
          >
            <Magnet className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setZoom(Math.max(editorState.zoom / 1.5, 0.1))}
            disabled={editorState.zoom <= 0.1}
            title="Alejar (ver más timeline)"
          >
            <ZoomOut className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setZoom(Math.min(editorState.zoom * 1.5, 2))}
            disabled={editorState.zoom >= 2}
            title="Acercar (ver más detalle)"
          >
            <ZoomIn className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 min-h-0 flex gap-4 overflow-hidden">
        {/* Left Panel - Collections & Sprites */}
        <div className="w-56 flex-shrink-0 flex flex-col gap-3 overflow-hidden border rounded-lg bg-muted/20 p-3">
          {/* Collections */}
          <div className="space-y-2">
            <Label className="text-xs font-medium flex items-center gap-2">
              <Layers className="w-4 h-4" />
              Colecciones
            </Label>
            <ScrollArea className="h-32">
              <div className="space-y-1 pr-2">
                {spriteCollections.map((collection) => (
                  <div
                    key={collection.id}
                    className={cn(
                      "flex items-center justify-between p-2 rounded cursor-pointer transition-colors",
                      editorState.selectedCollectionId === collection.id
                        ? "bg-primary/20 border border-primary/30"
                        : "bg-muted/30 hover:bg-muted/50"
                    )}
                    onClick={() => handleSelectCollection(collection.id)}
                  >
                    <div className="flex items-center gap-2">
                      <FolderOpen className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm truncate">{collection.name}</span>
                      <Badge variant="secondary" className="text-xs">
                        {collection.files.length}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Sprites */}
          <div className="flex-1 min-h-0 space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-medium flex items-center gap-2">
                <ImageIcon className="w-4 h-4" />
                Sprites
              </Label>
              {selectedCollection && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  {uploading ? (
                    <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    <Upload className="w-3 h-3 mr-1" />
                  )}
                  Subir
                </Button>
              )}
            </div>
            <ScrollArea className="h-full">
              {selectedCollection ? (
                selectedCollection.sprites.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    <ImageIcon className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>No hay sprites</p>
                    <p className="text-xs mt-1">Sube imágenes o videos</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 pr-2">
                    {selectedCollection.sprites.map((sprite) => (
                      <div
                        key={sprite.id}
                        className={cn(
                          "relative group rounded border overflow-hidden cursor-pointer transition-all",
                          editorState.selectedSpriteId === sprite.id
                            ? "ring-2 ring-primary"
                            : "hover:ring-1 hover:ring-primary/50"
                        )}
                        onClick={() => handleSelectSprite(sprite.id)}
                      >
                        <div className="aspect-square bg-muted/30 flex items-center justify-center">
                          {sprite.format === 'webm' || sprite.format === 'mp4' ? (
                            <video
                              ref={(el) => {
                                if (el) videoRefs.current.set(sprite.id, el);
                                else videoRefs.current.delete(sprite.id);
                              }}
                              src={sprite.url}
                              className="w-full h-full object-cover"
                              muted
                              playsInline
                              preload="metadata"
                              onMouseEnter={() => handleVideoHover(sprite.id, true)}
                              onMouseLeave={() => handleVideoHover(sprite.id, false)}
                            />
                          ) : (
                            <img
                              src={sprite.thumbnail || sprite.url}
                              alt={sprite.label}
                              className="w-full h-full object-cover"
                            />
                          )}
                        </div>
                        <div className="p-1 bg-background/80">
                          <div className="flex items-center gap-1">
                            {getFormatIcon(sprite.format)}
                            <span className="text-xs truncate flex-1">{sprite.label}</span>
                          </div>
                        </div>
                        <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            variant="destructive"
                            size="icon"
                            className="h-5 w-5"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSprite(sprite.id);
                            }}
                          >
                            <Trash2 className="w-2.5 h-2.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <p>Selecciona una colección</p>
                </div>
              )}
            </ScrollArea>
          </div>
        </div>

        {/* Center - Preview & Timeline */}
        <div className="flex-1 flex flex-col overflow-hidden border rounded-lg bg-muted/20">
          {selectedSprite ? (
            <>
              {/* Preview Area - Stacked layout for large preview */}
              <div className="p-3 border-b bg-muted/30 flex-shrink-0 space-y-3">
                {/* Sprite Preview - Large */}
                <div className="flex justify-center">
                  <div
                    className="relative w-full max-w-xl h-72 rounded-xl overflow-hidden flex items-center justify-center ring-1 ring-white/10 shadow-inner bg-[repeating-conic-gradient(hsl(var(--muted)/0.4)_0%_25%,transparent_0%_50%)] bg-[length:20px_20px]"
                    onClick={(e) => {
                      // Click on preview (empty area) → place/move the tracking point
                      // Only for trackable formats, and not while playing
                      if (!selectedSprite || isPlaying) return;
                      if (!['webm', 'mp4', 'webp', 'gif'].includes(selectedSprite.format)) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const x = (e.clientX - rect.left) / rect.width;
                      const y = (e.clientY - rect.top) / rect.height;
                      if (x < 0 || x > 1 || y < 0 || y > 1) return;
                      setTrackPoint({ x, y });
                    }}
                    title={selectedSprite && ['webm', 'mp4', 'webp', 'gif'].includes(selectedSprite.format)
                      ? 'Clic para colocar el punto de tracking 🎯'
                      : undefined}
                  >
                    {selectedSprite.format === 'webm' || selectedSprite.format === 'mp4' ? (
                      <video
                        ref={previewVideoRef}
                        src={selectedSprite.url}
                        className="max-w-full max-h-full object-contain"
                        muted
                        playsInline
                        loop
                      />
                    ) : selectedSprite.format === 'gif' || selectedSprite.format === 'webp' ? (
                      /* Animated image (GIF/WebP):
                         - Frame-exact canvas when ImageDecoder is available (paused scrubbing!)
                         - Playing: show animated image
                         - Fallback paused: static first frame */
                      (frameDecoderRef.current && decoderInfo.supported && decoderInfo.frameCount > 0) ? (
                        <canvas
                          ref={previewCanvasRef}
                          className="max-w-full max-h-full w-full h-full"
                        />
                      ) : (isPlaying || seekPreview) ? (
                        <img
                          key={`anim-${selectedSprite.id}-${seekPreview ? `seek-${playbackTime}` : (playbackTime === 0 ? 'start' : 'play')}`}
                          src={selectedSprite.url}
                          alt={selectedSprite.label}
                          className="max-w-full max-h-full object-contain"
                        />
                      ) : (
                        <img
                          src={staticFrameUrl || selectedSprite.url}
                          alt={selectedSprite.label}
                          className="max-w-full max-h-full object-contain"
                        />
                      )
                    ) : (
                      <img
                        src={selectedSprite.url}
                        alt={selectedSprite.label}
                        className="max-w-full max-h-full object-contain"
                      />
                    )}

                    {/* Tracking point marker (draggable red dot).
                        Visible during playback too so the user sees the
                        tracked point move with the animation (the scrub-follow
                        effect updates trackPoint on every playhead change).
                        During playback we set pointer-events-none so the user
                        can't drag while it's auto-following. */}
                    {trackPoint && (
                      <div
                        className={cn(
                          "absolute w-5 h-5 -ml-2.5 -mt-2.5 rounded-full bg-red-500 border-2 border-white shadow-lg z-10 group",
                          isPlaying
                            ? "pointer-events-none opacity-90"
                            : "cursor-grab active:cursor-grabbing",
                        )}
                        style={{
                          left: `${trackPoint.x * 100}%`,
                          top: `${trackPoint.y * 100}%`,
                        }}
                        title={isPlaying
                          ? 'Punto de tracking (siguiendo la pista durante la reproducción)'
                          : 'Punto de tracking — arrastra para mover, doble clic para quitar'}
                        onDoubleClick={(e) => {
                          if (isPlaying) return;
                          e.stopPropagation();
                          setTrackPoint(null);
                          setFollowTrackId(null); // exit scrub-follow mode
                        }}
                        onMouseDown={(e) => {
                          if (isPlaying) return;
                          e.stopPropagation();
                          e.preventDefault();
                          setFollowTrackId(null); // manual override: user takes control
                          const container = (e.currentTarget.parentElement as HTMLElement);
                          if (!container) return;
                          const rect = container.getBoundingClientRect();

                          // Track whether the user actually dragged (vs a
                          // simple click). Only real drags apply the red
                          // point's final position to the selected tracking
                          // keyframe — pure clicks just place the marker.
                          let didDrag = false;

                          const onMove = (ev: MouseEvent) => {
                            const x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
                            const y = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
                            setTrackPoint({ x, y });
                            didDrag = true;
                          };
                          const onUp = () => {
                            window.removeEventListener('mousemove', onMove);
                            window.removeEventListener('mouseup', onUp);
                            // If the user dragged (not just clicked) AND a
                            // tracking keyframe is currently selected, apply
                            // the red point's final position to that keyframe:
                            //   - if a keyframe exists at the current playhead
                            //     time (±60ms) → UPDATE its coords
                            //   - else → CREATE a new keyframe at the playhead
                            //     time with the red point's coords
                            // (handleAddTrackingPoint does both). The ref
                            // holds the LATEST version so we read the up-to-
                            // date trackPoint, not the stale closure value.
                            if (didDrag) {
                              const selKfId = editorState.selectedKeyframeId;
                              if (selKfId && selectedSprite) {
                                const tk = selectedSprite.timeline.tracks.find(
                                  t => t.type === 'tracking' &&
                                       t.keyframes.some(k => k.id === selKfId),
                                );
                                if (tk) {
                                  handleAddTrackingPointRef.current(tk.id);
                                  // Re-enable scrub-follow for this track so
                                  // the marker keeps walking the (now-updated)
                                  // trajectory on subsequent playhead moves /
                                  // playback. The drag had set followTrackId
                                  // to null (manual override) — restore it.
                                  setFollowTrackId(tk.id);
                                }
                              }
                            }
                          };
                          window.addEventListener('mousemove', onMove);
                          window.addEventListener('mouseup', onUp);
                        }}
                      >
                        <div className="absolute inset-0 rounded-full bg-red-500/40 animate-ping" />
                        <Crosshair className="absolute inset-0 m-auto w-3 h-3 text-white pointer-events-none" />
                      </div>
                    )}

                    {/* Reference guides (4 draggable lines defining the
                        active region for tracking conversion).
                          - 2 horizontal cyan lines (topY, bottomY): handle
                            on the LEFT edge, drag up/down
                          - 2 vertical magenta lines (leftX, rightX): handle
                            on the BOTTOM edge, drag left/right
                        Each guide is pointer-events-none except its handle,
                        so clicks on empty preview area still place the red
                        tracking point. With guides ENABLED the curve is
                        absolute (relative to these limits); DISABLED auto-
                        normalizes to the trajectory's own min/max. */}
                    {guides.enabled && (
                      <>
                        {/* Top horizontal guide (topY → position 100 = UP) */}
                        <div
                          className="absolute left-0 right-0 z-20 pointer-events-none"
                          style={{ top: `${guides.topY * 100}%` }}
                        >
                          <div className="h-0 border-t-2 border-dashed border-cyan-400/80" />
                          <div
                            className="absolute -left-1.5 -top-2.5 w-5 h-5 rounded-full bg-cyan-500 border-2 border-white shadow-lg cursor-ns-resize pointer-events-auto flex items-center justify-center hover:scale-110 transition-transform"
                            title="Guía superior (posición 100 = arriba) — arrastra ↑/↓"
                            onMouseDown={(e) => {
                              if (isPlaying) return;
                              e.stopPropagation();
                              e.preventDefault();
                              const container = e.currentTarget.parentElement?.parentElement as HTMLElement;
                              if (!container) return;
                              const rect = container.getBoundingClientRect();
                              const onMove = (ev: MouseEvent) => {
                                const y = Math.max(0, Math.min(guides.bottomY - 0.02, (ev.clientY - rect.top) / rect.height));
                                setGuides(g => ({ ...g, topY: y }));
                              };
                              const onUp = () => {
                                window.removeEventListener('mousemove', onMove);
                                window.removeEventListener('mouseup', onUp);
                              };
                              window.addEventListener('mousemove', onMove);
                              window.addEventListener('mouseup', onUp);
                            }}
                          >
                            <span className="text-[10px] text-white font-bold leading-none">↑</span>
                          </div>
                          <div className="absolute left-1/2 -translate-x-1/2 -top-5 px-1.5 py-0.5 rounded bg-cyan-500/90 text-white text-[10px] font-mono pointer-events-none whitespace-nowrap shadow">
                            Max {(guides.topY * 100).toFixed(0)}%
                          </div>
                        </div>

                        {/* Bottom horizontal guide (bottomY → position 0 = DOWN) */}
                        <div
                          className="absolute left-0 right-0 z-20 pointer-events-none"
                          style={{ top: `${guides.bottomY * 100}%` }}
                        >
                          <div className="h-0 border-t-2 border-dashed border-cyan-400/80" />
                          <div
                            className="absolute -left-1.5 -top-2.5 w-5 h-5 rounded-full bg-cyan-600 border-2 border-white shadow-lg cursor-ns-resize pointer-events-auto flex items-center justify-center hover:scale-110 transition-transform"
                            title="Guía inferior (posición 0 = abajo) — arrastra ↑/↓"
                            onMouseDown={(e) => {
                              if (isPlaying) return;
                              e.stopPropagation();
                              e.preventDefault();
                              const container = e.currentTarget.parentElement?.parentElement as HTMLElement;
                              if (!container) return;
                              const rect = container.getBoundingClientRect();
                              const onMove = (ev: MouseEvent) => {
                                const y = Math.max(guides.topY + 0.02, Math.min(1, (ev.clientY - rect.top) / rect.height));
                                setGuides(g => ({ ...g, bottomY: y }));
                              };
                              const onUp = () => {
                                window.removeEventListener('mousemove', onMove);
                                window.removeEventListener('mouseup', onUp);
                              };
                              window.addEventListener('mousemove', onMove);
                              window.addEventListener('mouseup', onUp);
                            }}
                          >
                            <span className="text-[10px] text-white font-bold leading-none">↓</span>
                          </div>
                          <div className="absolute left-1/2 -translate-x-1/2 top-1.5 px-1.5 py-0.5 rounded bg-cyan-600/90 text-white text-[10px] font-mono pointer-events-none whitespace-nowrap shadow">
                            Min {(guides.bottomY * 100).toFixed(0)}%
                          </div>
                        </div>

                        {/* Left vertical guide (leftX → 0) — handle on the BOTTOM edge */}
                        <div
                          className="absolute top-0 bottom-0 z-20 pointer-events-none"
                          style={{ left: `${guides.leftX * 100}%` }}
                        >
                          <div className="w-0 h-full border-l-2 border-dashed border-fuchsia-400/80" />
                          <div
                            className="absolute -left-2.5 w-5 h-5 rounded-full bg-fuchsia-500 border-2 border-white shadow-lg cursor-ew-resize pointer-events-auto flex items-center justify-center hover:scale-110 transition-transform"
                            style={{ bottom: -10 }}
                            title="Guía izquierda — arrastra ←/→"
                            onMouseDown={(e) => {
                              if (isPlaying) return;
                              e.stopPropagation();
                              e.preventDefault();
                              const container = e.currentTarget.parentElement?.parentElement as HTMLElement;
                              if (!container) return;
                              const rect = container.getBoundingClientRect();
                              const onMove = (ev: MouseEvent) => {
                                const x = Math.max(0, Math.min(guides.rightX - 0.02, (ev.clientX - rect.left) / rect.width));
                                setGuides(g => ({ ...g, leftX: x }));
                              };
                              const onUp = () => {
                                window.removeEventListener('mousemove', onMove);
                                window.removeEventListener('mouseup', onUp);
                              };
                              window.addEventListener('mousemove', onMove);
                              window.addEventListener('mouseup', onUp);
                            }}
                          >
                            <span className="text-[10px] text-white font-bold leading-none">←</span>
                          </div>
                        </div>

                        {/* Right vertical guide (rightX → 100) — handle on the BOTTOM edge */}
                        <div
                          className="absolute top-0 bottom-0 z-20 pointer-events-none"
                          style={{ left: `${guides.rightX * 100}%` }}
                        >
                          <div className="w-0 h-full border-l-2 border-dashed border-fuchsia-400/80" />
                          <div
                            className="absolute -left-2.5 w-5 h-5 rounded-full bg-fuchsia-600 border-2 border-white shadow-lg cursor-ew-resize pointer-events-auto flex items-center justify-center hover:scale-110 transition-transform"
                            style={{ bottom: -10 }}
                            title="Guía derecha — arrastra ←/→"
                            onMouseDown={(e) => {
                              if (isPlaying) return;
                              e.stopPropagation();
                              e.preventDefault();
                              const container = e.currentTarget.parentElement?.parentElement as HTMLElement;
                              if (!container) return;
                              const rect = container.getBoundingClientRect();
                              const onMove = (ev: MouseEvent) => {
                                const x = Math.max(guides.leftX + 0.02, Math.min(1, (ev.clientX - rect.left) / rect.width));
                                setGuides(g => ({ ...g, rightX: x }));
                              };
                              const onUp = () => {
                                window.removeEventListener('mousemove', onMove);
                                window.removeEventListener('mouseup', onUp);
                              };
                              window.addEventListener('mousemove', onMove);
                              window.addEventListener('mouseup', onUp);
                            }}
                          >
                            <span className="text-[10px] text-white font-bold leading-none">→</span>
                          </div>
                        </div>
                      </>
                    )}

                    {/* Format badge */}
                    <div className={cn(
                      "absolute top-2 left-2 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider backdrop-blur-sm border",
                      selectedSprite.format === 'webm' || selectedSprite.format === 'mp4'
                        ? "bg-violet-500/20 border-violet-400/30 text-violet-300"
                        : selectedSprite.format === 'webp' || selectedSprite.format === 'gif'
                          ? "bg-teal-500/20 border-teal-400/30 text-teal-300"
                          : "bg-white/10 border-white/20 text-white/70"
                    )}>
                      {selectedSprite.format}
                    </div>

                    {/* Time overlay */}
                    <div className="absolute bottom-2 right-2 bg-black/70 backdrop-blur-sm px-3 py-1 rounded-md text-sm font-mono text-white tabular-nums shadow-lg">
                      {formatTime(playbackTime)}
                      {decoderInfo.supported && decoderInfo.frameCount > 0 && previewFrameIndex >= 0 && (
                        <span className="ml-2 text-teal-300">
                          Frame {previewFrameIndex + 1}/{decoderInfo.frameCount}
                        </span>
                      )}
                      {decoderInfo.loading && (
                        <span className="ml-2 text-muted-foreground">decodificando…</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Controls - Horizontal row */}
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={isPlaying ? handlePause : handlePlay}
                    >
                      {isPlaying ? (
                        <Pause className="w-4 h-4" />
                      ) : (
                        <Play className="w-4 h-4" />
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8"
                      onClick={handleStop}
                    >
                      <Square className="w-4 h-4" />
                    </Button>
                  </div>

                  {/* Tracking Controls: place point on preview, then analyze */}
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "h-8 gap-1.5 text-xs",
                        trackPoint
                          ? "bg-red-500/10 border-red-500/40 text-red-400 hover:bg-red-500/20 hover:text-red-300"
                          : "text-muted-foreground",
                      )}
                      onClick={handleRunTracking}
                      disabled={trackingBusy || !trackPoint || isPlaying || !selectedSprite || !['webm', 'mp4', 'webp', 'gif'].includes(selectedSprite.format)}
                      title={trackPoint ? 'Analiza el movimiento del punto rojo frame a frame (NCC template matching, pirámide multi-escala)' : 'Primero haz clic en el preview para colocar el punto rojo'}
                    >
                      {trackingBusy ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Crosshair className="w-3.5 h-3.5" />
                      )}
                      {trackingBusy ? `Trackeando ${Math.round(trackingProgress * 100)}%` : 'Tracking'}
                    </Button>
                    {trackPoint && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs text-muted-foreground"
                        onClick={() => setTrackPoint(null)}
                        title="Quitar punto rojo del preview"
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    {/* Reference guides toggle: enables 4 draggable guides
                        on the sprite preview (top/bottom/left/right) that
                        define the active region for the conversion. With
                        guides ON, the curve is absolute (relative to the
                        limits); with guides OFF, the curve auto-normalizes
                        to its own min/max. */}
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "h-8 gap-1.5 text-xs",
                        guides.enabled
                          ? "bg-cyan-600/15 border-cyan-500/40 text-cyan-400 hover:bg-cyan-600/25 hover:text-cyan-300"
                          : "text-muted-foreground",
                      )}
                      onClick={() => setGuides(g => ({ ...g, enabled: !g.enabled }))}
                      title={guides.enabled
                        ? 'Guías activadas: top/bottom (cyan) definen altura máxima/mínima, left/right (magenta) definen ancho. Arrastra los círculos en los bordes lateral e inferior. La curva se calcula relativa a estas guías (sin auto-normalizar).'
                        : 'Activar guías de referencia en el sprite para definir los límites de altura y ancho del tracking'}
                    >
                      <Ruler className="w-3.5 h-3.5" />
                      {guides.enabled ? 'Guías ON' : 'Guías'}
                    </Button>
                    {/* Movement range: how far the tracker looks between frames.
                        Larger = catches big/fast motion (full strokes) but slower
                        and more prone to false matches on similar-looking patches. */}
                    <Select
                      value={movementRange}
                      onValueChange={(v) => setMovementRange(v as MovementRange)}
                    >
                      <SelectTrigger
                        className="h-8 w-[170px] text-xs"
                        title="Cuánto se desplaza el tracker entre frames: Pequeño=lento/sutil, Mediano=normal, Grande=movimiento rápido/amplio. Pirámide multi-escala (1/4, 1/2, 1): el nivel más grueso cubre los saltos grandes."
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="small" className="text-xs">Movimiento: Pequeño (~25px/f)</SelectItem>
                        <SelectItem value="medium" className="text-xs">Movimiento: Mediano (~100px/f)</SelectItem>
                        <SelectItem value="large" className="text-xs">Movimiento: Grande (~240px/f)</SelectItem>
                      </SelectContent>
                    </Select>
                    {/* Mapping mode for Tracking → HSP conversion */}
                    <Select
                      value={trackingMapMode}
                      onValueChange={(v) => setTrackingMapMode(v as TrackingMapMode)}
                    >
                      <SelectTrigger className="h-8 w-[150px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="combined" className="text-xs">Mapeo: Combinado (Y+X)</SelectItem>
                        <SelectItem value="y" className="text-xs">Mapeo: Solo vertical</SelectItem>
                        <SelectItem value="x" className="text-xs">Mapeo: Solo horizontal</SelectItem>
                      </SelectContent>
                    </Select>
                    {/* Keyframe optimization tolerance (RDP) */}
                    <Select
                      value={rdpTolerance}
                      onValueChange={(v) => setRdpTolerance(v as RDPToleranceKey)}
                    >
                      <SelectTrigger className="h-8 w-[170px] text-xs" title="Optimización Ramer-Douglas-Peucker: colapsa los puntos densos del tracking en los mínimos keyframes que mantienen la curva dentro de la tolerancia">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="precise" className="text-xs">Optimizar: Preciso (±1)</SelectItem>
                        <SelectItem value="balanced" className="text-xs">Optimizar: Equilibrado (±2.5)</SelectItem>
                        <SelectItem value="smooth" className="text-xs">Optimizar: Suave (±5)</SelectItem>
                      </SelectContent>
                    </Select>
                    {/* Haptic output scale (range remap).
                        ALWAYS normalizes the tracking curve to this range:
                        - the LOWEST peak of the tracking maps to the FIRST value
                        - the HIGHEST peak of the tracking maps to the SECOND value
                        With 0-100 (default): min peak → 0, max peak → 100 (full range).
                        With 30-80: min peak → 30, max peak → 80 (compressed stroke).
                        With 80-90: min peak → 80, max peak → 90 (narrow window). */}
                    <div
                      className="flex items-center gap-1"
                      title="Escala de salida: el pico MÁS BAJO del tracking se mapea al primer valor y el pico MÁS ALTO al segundo. Con 0-100 (default) la curva se normaliza para llenar todo el rango del device. Con 30-80, los picos se comprimen a ese rango (mín→30, máx→80). Con 80-90, mín→80, máx→90."
                    >
                      <Label className="text-xs whitespace-nowrap">Escala</Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={hapticRangeMin}
                        onChange={(e) => {
                          const n = parseInt(e.target.value, 10);
                          if (Number.isFinite(n)) setHapticRangeMin(Math.max(0, Math.min(100, n)));
                        }}
                        onBlur={(e) => {
                          const n = parseInt(e.target.value, 10);
                          setHapticRangeMin(Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                        className="w-16 h-8 text-xs"
                        aria-label="Posición mínima del rango haptic"
                      />
                      <span className="text-xs text-muted-foreground">→</span>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={hapticRangeMax}
                        onChange={(e) => {
                          const n = parseInt(e.target.value, 10);
                          if (Number.isFinite(n)) setHapticRangeMax(Math.max(0, Math.min(100, n)));
                        }}
                        onBlur={(e) => {
                          const n = parseInt(e.target.value, 10);
                          setHapticRangeMax(Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 100);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                        className="w-16 h-8 text-xs"
                        aria-label="Posición máxima del rango haptic"
                      />
                    </div>
                  </div>

                  {/* Haptic Playback Controls */}
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn(
                        "h-8 gap-1.5 text-xs",
                        hapticEnabled
                          ? "bg-fuchsia-600/15 border-fuchsia-500/40 text-fuchsia-400 hover:bg-fuchsia-600/25 hover:text-fuchsia-300"
                          : "text-muted-foreground",
                        haptic.isConnected && "border-fuchsia-500/30",
                      )}
                      onClick={async () => {
                        if (!hapticEnabled) {
                          // First enable, then try to connect
                          setHapticEnabled(true);
                          setHapticConnecting(true);
                          const connected = await haptic.connect();
                          setHapticConnecting(false);
                          if (!connected) {
                            toast({
                              title: 'Handy no conectado',
                              description: 'Verifica la configuración en el panel de Handy',
                              variant: 'destructive',
                            });
                            setHapticEnabled(false);
                          }
                        } else {
                          haptic.disconnect();
                          setHapticEnabled(false);
                        }
                      }}
                      disabled={hapticConnecting}
                    >
                      {hapticConnecting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : hapticEnabled ? (
                        <Vibrate className="w-3.5 h-3.5" />
                      ) : (
                        <Vibrate className="w-3.5 h-3.5" />
                      )}
                      {hapticConnecting ? 'Conectando...' : hapticEnabled ? 'Haptic ON' : 'Haptic'}
                    </Button>
                    {/* Connection status indicator */}
                    <div className={cn(
                      "flex items-center gap-1 px-2 py-1 rounded-md text-[10px] border transition-all",
                      haptic.isConnected
                        ? "border-green-300/50 bg-green-50/80 dark:bg-green-950/30 dark:border-green-800/50"
                        : "border-muted bg-muted/40",
                    )}>
                      <div className={cn(
                        "w-2 h-2 rounded-full transition-all",
                        haptic.isConnected
                          ? "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]"
                          : "bg-muted-foreground/30"
                      )} />
                      <span className={cn(
                        "font-medium",
                        haptic.isConnected
                          ? "text-green-700 dark:text-green-400"
                          : "text-muted-foreground"
                      )}>
                        {haptic.isConnected ? 'Conectado' : 'OFF'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-mono">{formatTime(playbackTime)}</span>
                    <span className="text-xs text-muted-foreground">/ {formatTime(selectedSprite.timeline.duration)}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Label className="text-xs">Duración:</Label>
                    <Input
                      type="text"
                      value={formatTime(selectedSprite.timeline.duration)}
                      onChange={(e) => {
                        const newDuration = parseTime(e.target.value);
                        if (newDuration > 0) {
                          handleUpdateSprite(selectedSprite.id, {
                            duration: newDuration,
                            timeline: { ...selectedSprite.timeline, duration: newDuration },
                          });
                        }
                      }}
                      className="w-24 h-7 text-xs font-mono"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Label className="text-xs">Loop:</Label>
                    <Switch
                      checked={selectedSprite.timeline.loop}
                      onCheckedChange={(checked) => handleUpdateSprite(selectedSprite.id, {
                        timeline: { ...selectedSprite.timeline, loop: checked },
                      })}
                    />
                  </div>

                  {/* Save button */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7"
                    onClick={handleSaveConfiguration}
                    disabled={saving}
                  >
                    {saving ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <Save className="w-3 h-3 mr-1" />
                    )}
                    Guardar
                  </Button>

                  {/* Export Timeline */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1"
                    onClick={handleExportTimeline}
                    title="Exportar timeline como archivo .timeline.json"
                  >
                    <Download className="w-3 h-3" />
                    <span className="hidden sm:inline">Exportar</span>
                  </Button>

                  {/* Import Timeline */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1"
                    onClick={() => timelineImportInputRef.current?.click()}
                    title="Importar timeline desde un archivo .timeline.json"
                  >
                    <Upload className="w-3 h-3" />
                    <span className="hidden sm:inline">Importar</span>
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 ml-auto">
                        <Music className="w-3 h-3 mr-1" />
                        Añadir Track
                        <ChevronDown className="w-3 h-3 ml-1" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel> Tipo de Track </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => handleAddTrack('sound')}>
                        <Music className="w-3 h-3 mr-2 text-blue-400" />
                        Sound Track
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleAddTrack('haptic')}>
                        <Vibrate className="w-3 h-3 mr-2 text-fuchsia-500" />
                        Haptic Track
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleAddTrack('tracking')}>
                        <Crosshair className="w-3 h-3 mr-2 text-red-400" />
                        Tracking Track
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {/* Sprite info */}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      {getFormatIcon(selectedSprite.format)}
                      {selectedSprite.format.toUpperCase()}
                    </span>
                    <span>Tracks: {selectedSprite.timeline.tracks.length}</span>
                    <span>KF: {selectedSprite.timeline.tracks.reduce((acc, t) => acc + t.keyframes.length, 0)}</span>
                    <span>Zoom: {(editorState.zoom * 100).toFixed(0)}%</span>
                  </div>
                </div>
              </div>

              {/* Timeline Area with horizontal scroll */}
              <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                {/* Timeline Container with horizontal scrollbar */}
                <div 
                  ref={timelineScrollRef}
                  className={cn("flex-1 overflow-x-auto overflow-y-auto", draggingKeyframe && "select-none")}
                  style={{ scrollbarWidth: 'thin' }}
                >
                  <div 
                    ref={timelineContainerRef}
                    className="relative"
                    style={{ width: `${timelineWidth + 180}px`, minWidth: '100%' }}
                  >
                    {/* Timeline Ruler - Clickable for seeking */}
                    <div 
                      ref={rulerRef}
                      className="timeline-ruler h-6 border-b bg-muted/60 sticky top-0 z-10 cursor-crosshair backdrop-blur-[2px]"
                      onClick={handleRulerClick}
                    >
                      <div className="relative h-full" style={{ width: `${timelineWidth}px`, marginLeft: '180px' }}>
                        {/* Ruler marks with subdivisions */}
                        {generateRulerMarks()}
                        
                        {/* Playhead on ruler - DRAGGABLE with larger hit area */}
                        <div
                          className={cn(
                            "absolute top-0 bottom-0 z-30 select-none",
                            isDraggingPlayhead ? "cursor-grabbing" : "cursor-grab"
                          )}
                          style={{ 
                            left: `${playbackTime * pixelsPerMs}px`,
                            width: '20px',
                            marginLeft: '-10px',
                            display: 'flex',
                            justifyContent: 'center'
                          }}
                          onMouseDown={handlePlayheadMouseDown}
                        >
                          {/* Invisible larger hit area for easier grabbing */}
                          <div className="absolute inset-0 z-40" />
                          
                          {/* Playhead line - visible part */}
                          <div className={cn(
                            "timeline-playhead-line w-0.5 h-full transition-all",
                            isDraggingPlayhead ? "w-1" : "hover:w-1"
                          )} />

                          {/* Playhead handle — red knob with pulse + time badge while dragging */}
                          <div
                            className={cn(
                              "timeline-playhead-handle absolute top-0 left-1/2 -translate-x-1/2 w-5 h-5 rounded-full",
                              "flex items-center justify-center z-50",
                              "border-2 border-white/90",
                              "hover:scale-110 active:scale-95 transition-transform",
                              isDraggingPlayhead && "scale-125"
                            )}
                            style={{ cursor: isDraggingPlayhead ? 'grabbing' : 'grab' }}
                          >
                            <div className="w-2 h-2 bg-white rounded-full" />
                          </div>
                          {isDraggingPlayhead && (
                            <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 px-1.5 py-0.5 rounded bg-red-500 text-white text-[10px] font-mono tabular-nums shadow-lg pointer-events-none whitespace-nowrap">
                              {formatTime(playbackTime)}
                            </div>
                          )}
                          {/* Playhead line extending through tracks */}
                          <div className="timeline-playhead-line absolute top-6 left-1/2 -translate-x-1/2 w-0.5 h-[2000px] pointer-events-none" />
                        </div>
                      </div>
                    </div>

                    {/* Track rows */}
                    {selectedSprite.timeline.tracks.map((track) => {
                      const isHaptic = track.type === 'haptic';
                      const trackHeight = isHaptic ? 120 : 50;

                      return (
                      <div key={track.id} data-track-id={track.id} className="flex border-b" style={{ minHeight: `${trackHeight}px` }}>
                        {/* Track header - Fixed width */}
                        <div
                          className={cn(
                            "timeline-track-header w-44 flex-shrink-0 p-2 border-r flex flex-col gap-1 sticky left-0 z-10",
                            isHaptic ? "bg-fuchsia-950/25 backdrop-blur-[2px]" : "bg-muted/40 backdrop-blur-[2px]"
                          )}
                          style={{ '--track-accent': track.type === 'tracking' ? 'rgb(239 68 68)' : isHaptic ? 'rgb(217 70 239)' : 'rgb(96 165 250)' } as React.CSSProperties}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className={cn(
                              "flex items-center justify-center w-5 h-5 rounded-md flex-shrink-0",
                              track.type === 'tracking' ? "bg-red-500/15 text-red-400" : isHaptic ? "bg-fuchsia-500/15 text-fuchsia-400" : "bg-blue-500/15 text-blue-400"
                            )}>
                              {track.type === 'tracking' ? (
                                <Crosshair className="w-3 h-3" />
                              ) : isHaptic ? (
                                <Waves className="w-3 h-3" />
                              ) : (
                                <Music className="w-3 h-3" />
                              )}
                            </span>
                            <span className={cn(
                              "text-xs font-medium truncate flex-1",
                              track.type === 'tracking' && "text-red-400",
                              isHaptic && "text-fuchsia-400"
                            )}>{track.name}</span>
                            <span className={cn(
                              "text-[9px] font-mono px-1 py-0.5 rounded-sm flex-shrink-0",
                              track.type === 'tracking' ? "bg-red-500/10 text-red-400/80" : isHaptic ? "bg-fuchsia-500/10 text-fuchsia-400/80" : "bg-blue-500/10 text-blue-400/80"
                            )}>
                              {track.keyframes.length}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            {isHaptic ? (
                              <>
                                {/* Pattern Fill Popover */}
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-5 w-5 text-fuchsia-500 hover:text-fuchsia-400 hover:bg-fuchsia-500/10" title="Rellenar Patrón">
                                      <Activity className="w-2.5 h-2.5" />
                                    </Button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-52 p-1" align="start">
                                    <div className="px-2 py-1.5 text-xs font-medium text-fuchsia-400">Patrones Hápticos</div>
                                    <DropdownMenuSeparator className="mb-1" />
                                    <div className="max-h-64 overflow-y-auto">
                                      {(Object.keys(patternNames) as HapticPattern[]).map((pat) => (
                                        <button
                                          key={pat}
                                          className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-fuchsia-500/10 text-foreground transition-colors"
                                          onClick={() => handleFillPattern(track.id, pat)}
                                        >
                                          {patternNames[pat]}
                                        </button>
                                      ))}
                                    </div>
                                  </PopoverContent>
                                </Popover>
                                {/* Import CSV */}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5 text-muted-foreground hover:text-fuchsia-400 hover:bg-fuchsia-500/10"
                                  title="Importar CSV"
                                  onClick={() => {
                                    setCsvImportTargetTrackId(track.id);
                                    setTimeout(() => hapticCsvInputRef.current?.click(), 0);
                                  }}
                                >
                                  <Upload className="w-2.5 h-2.5" />
                                </Button>
                                {/* Export CSV */}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5 text-muted-foreground hover:text-fuchsia-400 hover:bg-fuchsia-500/10"
                                  title="Exportar CSV"
                                  onClick={() => handleExportHapticCsv(track.id)}
                                >
                                  <Download className="w-2.5 h-2.5" />
                                </Button>
                              </>
                            ) : track.type === 'tracking' ? (
                              <>
                                {/* Manual tracking: add a keyframe at the
                                    current red-marker position + playhead time. */}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className={cn(
                                    "h-5 w-5",
                                    trackPoint
                                      ? "text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                                      : "text-muted-foreground opacity-60",
                                  )}
                                  title={trackPoint
                                    ? `Agregar punto en ${formatTime(playbackTime)} · usa el punto rojo del preview`
                                    : 'Coloca el punto rojo en el preview antes de agregar'}
                                  onClick={() => handleAddTrackingPoint(track.id)}
                                >
                                  <Plus className="w-3 h-3" />
                                </Button>
                                {/* Remove the selected / closest-to-playhead point */}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                  title="Quitar punto (seleccionado o más cercano al playhead)"
                                  disabled={track.keyframes.length === 0}
                                  onClick={() => handleRemoveTrackingPoint(track.id)}
                                >
                                  <X className="w-3 h-3" />
                                </Button>
                              </>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5"
                                onClick={() => handleUpdateTrack(track.id, { muted: !track.muted })}
                              >
                                {track.muted ? (
                                  <VolumeX className="w-2.5 h-2.5 text-muted-foreground" />
                                ) : (
                                  <Volume2 className="w-2.5 h-2.5" />
                                )}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 text-muted-foreground hover:text-destructive"
                              onClick={() => handleDeleteTrack(track.id)}
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                            </Button>
                          </div>
                          {(isHaptic || track.type === 'tracking') && track.keyframes.length > 0 && (
                            <div className="mt-1">
                              {/* Mini waveform preview with gradient fill under the curve.
                                  Uses Catmull-Rom-to-Bezier conversion for a smooth
                                  curve through the keyframes — straight `polyline`
                                  would look angular for sparse manual tracking data. */}
                              <svg viewBox="0 0 160 20" className="w-full h-4" preserveAspectRatio="none">
                                <defs>
                                  <linearGradient id={`wf-${track.id}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor={track.type === 'tracking' ? 'rgb(239 68 68)' : 'rgb(217 70 239)'} stopOpacity="0.35" />
                                    <stop offset="100%" stopColor={track.type === 'tracking' ? 'rgb(239 68 68)' : 'rgb(217 70 239)'} stopOpacity="0" />
                                  </linearGradient>
                                </defs>
                                {(() => {
                                  const sortedKfs = track.keyframes
                                    .slice()
                                    .sort((a, b) => a.time - b.time);
                                  const pts = sortedKfs.map((kf) => {
                                    const v = kf.value as HapticKeyframeValue | TrackingKeyframeValue;
                                    const pos = 'position' in v ? v.position : (v as TrackingKeyframeValue).y * 100;
                                    const x = (kf.time / selectedSprite.timeline.duration) * 160;
                                    const y = 20 - (pos / 100) * 20;
                                    return { x, y };
                                  });
                                  const polylinePts = pts.map(p => `${p.x},${p.y}`).join(' ');
                                  // Smooth path through the points (Catmull-Rom →
                                  // cubic Bezier). For ≤2 points, catmullRomPathD
                                  // falls back to a polyline-style M+L path.
                                  const smoothD = catmullRomPathD(pts);
                                  // Build a smooth filled area: start at left
                                  // baseline, go up to the first curve point,
                                  // trace the smooth curve through all points,
                                  // then drop down to the right baseline and
                                  // close. The "C ..." part is extracted from
                                  // smoothD by stripping the leading "M x,y".
                                  const curveRest = smoothD.replace(/^M [^ ]+ /, '');
                                  const fillD = pts.length > 0
                                    ? `M 0,20 L ${pts[0].x},${pts[0].y} ${curveRest} L ${pts[pts.length - 1].x},20 L 0,20 Z`
                                    : '';
                                  const useSmooth = pts.length > 2;
                                  return (
                                    <>
                                      {useSmooth ? (
                                        <path d={fillD} fill={`url(#wf-${track.id})`} stroke="none" />
                                      ) : (
                                        <polygon fill={`url(#wf-${track.id})`} points={`0,20 ${polylinePts} 160,20`} />
                                      )}
                                      {useSmooth ? (
                                        <path
                                          d={smoothD}
                                          fill="none"
                                          stroke={track.type === 'tracking' ? 'rgb(239 68 68)' : 'rgb(217 70 239)'}
                                          strokeWidth="1.5"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        />
                                      ) : (
                                        <polyline
                                          fill="none"
                                          stroke={track.type === 'tracking' ? 'rgb(239 68 68)' : 'rgb(217 70 239)'}
                                          strokeWidth="1.5"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          points={polylinePts}
                                        />
                                      )}
                                    </>
                                  );
                                })()}
                              </svg>
                            </div>
                          )}
                        </div>

                        {/* Track content - Keyframes area / Drop zone for sounds */}
                        <div
                          className={cn(
                            "flex-1 relative bg-muted/10 transition-colors duration-150",
                            isHaptic && "timeline-haptic-lane bg-fuchsia-950/5",
                            track.type === 'tracking' && "bg-red-950/5",
                            !isHaptic && track.type !== 'tracking' && dragOverTrackId === track.id && "bg-blue-100 dark:bg-blue-950/40 ring-1 ring-blue-400 dark:ring-blue-600 ring-inset"
                          )}
                          data-track-content
                          style={{ width: `${timelineWidth}px`, minHeight: `${trackHeight}px` }}
                          onDragOver={!isHaptic ? (e) => handleDragOver(e, track.id) : undefined}
                          onDragLeave={!isHaptic ? handleDragLeave : undefined}
                          onDrop={!isHaptic ? (e) => handleTrackDrop(e, track.id) : undefined}
                          onMouseDown={(e) => {
                            // Only start marquee if clicking on empty space (not on a keyframe)
                            // and only for left mouse button
                            if (e.button !== 0) return;
                            const target = e.target as HTMLElement;
                            // If clicking on a keyframe element, don't start marquee
                            if (target.closest('[data-keyframe]')) return;
                            
                            const rect = e.currentTarget.getBoundingClientRect();
                            const scrollLeft = timelineScrollRef.current?.scrollLeft || 0;
                            const mouseX = e.clientX - rect.left + scrollLeft;
                            const time = mouseX / editorState.zoom;
                            
                            setIsMarqueeSelecting(true);
                            setMarqueeStart({ x: e.clientX, y: e.clientY, time });
                            setMarqueeEnd({ x: e.clientX, y: e.clientY, time });
                            setMarqueeTrackId(track.id);
                          }}
                          onClick={(e) => {
                            // Clear selection when clicking on empty space without modifiers
                            const target = e.target as HTMLElement;
                            if (!target.closest('[data-keyframe]') && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                              clearKeyframeSelection();
                            }
                            if (!isHaptic) return;
                            // Create haptic keyframe on click
                            const rect = e.currentTarget.getBoundingClientRect();
                            const scrollLeft = timelineScrollRef.current?.scrollLeft || 0;
                            const trackHeaderWidth = 180;
                            const mouseX = e.clientX - rect.left + scrollLeft - trackHeaderWidth;
                            let time = mouseX / editorState.zoom;
                            if (editorState.snapEnabled && editorState.snapInterval > 0) {
                              time = Math.round(time / editorState.snapInterval) * editorState.snapInterval;
                            }
                            time = Math.max(0, Math.min(time, selectedSprite.timeline.duration));

                            // Check if clicking near an existing keyframe (within 8px)
                            const nearKeyframe = track.keyframes.find(kf => Math.abs(kf.time * pixelsPerMs - mouseX) < 8);
                            if (nearKeyframe) return;

                            // Calculate Y position from click location (top=100, bottom=0)
                            const mouseY = e.clientY - rect.top;
                            const rawPosition = 100 - (mouseY / 120 * 100);
                            const position = Math.max(0, Math.min(100, Math.round(rawPosition)));

                            const kfId = crypto.randomUUID ? crypto.randomUUID() : `kf_${Date.now()}`;
                            const newKf: TimelineKeyframe = {
                              id: kfId,
                              time,
                              value: {
                                type: 'haptic',
                                position,
                                velocity: 1.0,
                                velocityMode: 'auto',
                                stopOnTarget: false,
                              } as HapticKeyframeValue,
                              interpolation: 'linear',
                            };
                            setTimelineCollections(prev => prev.map(col => ({
                              ...col,
                              sprites: col.sprites.map(s =>
                                s.id === selectedSprite.id
                                  ? {
                                      ...s,
                                      timeline: {
                                        ...s.timeline,
                                        tracks: s.timeline.tracks.map(t =>
                                          t.id === track.id
                                            ? { ...t, keyframes: [...t.keyframes, newKf].sort((a, b) => a.time - b.time) }
                                            : t
                                        ),
                                      },
                                    }
                                  : s
                              ),
                            })));
                            selectKeyframe(kfId);
                          }}
                        >
                          {isHaptic ? (
                            <>
                              {/* Haptic track: Grid lines for position reference */}
                              {[0, 25, 50, 75, 100].map((pos) => (
                                <div
                                  key={`grid-${pos}`}
                                  className="absolute left-0 right-0 border-t border-dashed pointer-events-none"
                                  style={{
                                    top: `${100 - pos}%`,
                                    borderColor: pos === 50 ? 'rgb(217 70 239 / 0.3)' : 'rgb(217 70 239 / 0.1)',
                                  }}
                                >
                                  <span className="absolute right-1 -top-2.5 text-[8px] text-fuchsia-400/40 font-mono">{pos}</span>
                                </div>
                              ))}

                              {/* Wave line SVG connecting haptic keyframes */}
                              {track.keyframes.length > 1 && (
                                <svg
                                  className="absolute inset-0 w-full h-full pointer-events-none"
                                  preserveAspectRatio="none"
                                >
                                  <polyline
                                    fill="none"
                                    stroke="rgb(217 70 239)"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    opacity="0.6"
                                    points={
                                      track.keyframes
                                        .sort((a, b) => a.time - b.time)
                                        .map((kf) => {
                                          const hv = kf.value as HapticKeyframeValue;
                                          const x = kf.time * pixelsPerMs;
                                          const y = ((100 - hv.position) / 100) * trackHeight;
                                          return `${x},${y}`;
                                        })
                                        .join(' ')
                                    }
                                  />
                                </svg>
                              )}

                              {/* Haptic keyframes as diamond shapes */}
                              {track.keyframes.map((keyframe) => {
                                const hv = keyframe.value as HapticKeyframeValue;
                                const kfX = keyframe.time * pixelsPerMs;
                                const kfY = ((100 - hv.position) / 100) * trackHeight;
                                const isSelected = editorState.selectedKeyframeId === keyframe.id;
                                const isInMultiSelection = editorState.selectedKeyframeIds.includes(keyframe.id);
                                const isDragging = draggingKeyframe?.keyframeId === keyframe.id;

                                return (
                                  <Fragment key={keyframe.id}>
                                    {/* Position line from bottom to keyframe */}
                                    <div
                                      className="absolute bottom-0 w-px pointer-events-none"
                                      style={{
                                        left: `${kfX}px`,
                                        height: `${kfY}px`,
                                        backgroundColor: isSelected || isInMultiSelection ? 'rgb(217 70 239 / 0.5)' : 'rgb(217 70 239 / 0.15)',
                                      }}
                                    />
                                    {/* Diamond keyframe */}
                                    <div
                                      data-keyframe
                                      className={cn(
                                        "timeline-keyframe text-fuchsia-500 absolute w-4 h-4 cursor-grab active:cursor-grabbing group z-20",
                                        "transition-transform",
                                        isDragging && "scale-125"
                                      )}
                                      style={{
                                        left: `${kfX - 8}px`,
                                        top: `${kfY - 8}px`,
                                      }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (e.shiftKey || e.ctrlKey || e.metaKey) {
                                          // Toggle in multi-selection
                                          toggleKeyframeSelection(keyframe.id);
                                        } else {
                                          // Single selection (replaces any existing selection)
                                          selectKeyframe(keyframe.id);
                                        }
                                      }}
                                      onMouseDown={(e) => {
                                        e.stopPropagation();
                                        // Handle selection
                                        if (e.shiftKey || e.ctrlKey || e.metaKey) {
                                          toggleKeyframeSelection(keyframe.id);
                                        } else if (!editorState.selectedKeyframeIds.includes(keyframe.id)) {
                                          // If not already in selection, replace selection with this one
                                          selectKeyframe(keyframe.id);
                                        }

                                        // Store initial positions for all selected keyframes for multi-drag
                                        const currentSelectedIds = useTavernStore.getState().editorState.selectedKeyframeIds;
                                        if (currentSelectedIds.includes(keyframe.id) && selectedSprite) {
                                          const initialPositions = new Map<string, {time: number; position?: number}>();
                                          for (const trk of selectedSprite.timeline.tracks) {
                                            for (const kf of trk.keyframes) {
                                              if (currentSelectedIds.includes(kf.id)) {
                                                const hv = kf.value as HapticKeyframeValue;
                                                initialPositions.set(kf.id, {
                                                  time: kf.time,
                                                  position: hv.type === 'haptic' ? hv.position : undefined,
                                                });
                                              }
                                            }
                                          }
                                          setMultiDragInitialPositions(initialPositions);
                                          multiDragInitialPositionsRef.current = initialPositions;
                                          setMultiDragStartTime(keyframe.time);
                                          multiDragStartTimeRef.current = keyframe.time;
                                        }

                                        // Keep as primary selected
                                        selectKeyframe(keyframe.id);
                                        // Capture track content element for haptic Y-axis dragging
                                        const trackContentEl = (e.currentTarget as HTMLElement).closest('[data-track-content]') as HTMLElement | null;
                                        hapticDragTrackElRef.current = trackContentEl;
                                        setDraggingKeyframe({
                                          trackId: track.id,
                                          keyframeId: keyframe.id,
                                          isHaptic: true,
                                        });
                                      }}
                                    >
                                      <div
                                        className={cn(
                                          "w-full h-full rotate-45 rounded-sm border-2 transition-colors",
                                          isSelected
                                            ? "bg-fuchsia-500 border-fuchsia-300 shadow-lg shadow-fuchsia-500/30"
                                            : isInMultiSelection
                                            ? "bg-fuchsia-400 border-fuchsia-200 shadow-md shadow-fuchsia-400/20"
                                            : "bg-fuchsia-600 border-fuchsia-400 group-hover:bg-fuchsia-400",
                                          isDragging && "bg-fuchsia-300 border-fuchsia-200"
                                        )}
                                      />
                                      {/* Tooltip - shows live position during drag */}
                                      <div className={cn(
                                        "absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-black/80 text-white text-[10px] rounded whitespace-nowrap pointer-events-none z-30",
                                        isDragging ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                      )}>
                                        {isDragging && hapticDragInfo
                                          ? `Pos: ${hapticDragInfo.position}`
                                          : `${formatTime(keyframe.time)} · Pos: ${hv.position}`
                                        }
                                      </div>
                                      {/* Delete button */}
                                      <button
                                        className="absolute -top-2 -right-2 w-3 h-3 bg-destructive rounded-full opacity-0 group-hover:opacity-100 flex items-center justify-center z-40"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeleteKeyframe(track.id, keyframe.id);
                                        }}
                                      >
                                        <span className="text-[8px] text-white">×</span>
                                      </button>
                                    </div>
                                  </Fragment>
                                );
                              })}
                            </>
                          ) : track.type === 'tracking' ? (
                            <>
                              {/* Tracking track: red keypoints + trajectory mini-curve + →HSP button */}
                              {track.keyframes.length > 1 && (
                                <svg
                                  className="absolute inset-0 w-full h-full pointer-events-none"
                                  preserveAspectRatio="none"
                                >
                                  {/* Trajectory mini-curve: X-position over time (top=left, bottom=right) */}
                                  <polyline
                                    fill="none"
                                    stroke="rgb(239 68 68)"
                                    strokeWidth="1.5"
                                    strokeLinecap="round"
                                    strokeOpacity="0.55"
                                    points={
                                      track.keyframes
                                        .slice()
                                        .sort((a, b) => a.time - b.time)
                                        .map((kf) => {
                                          const tv = kf.value as TrackingKeyframeValue;
                                          const x = kf.time * pixelsPerMs;
                                          const y = (1 - tv.x) * trackHeight; // inverted X: left = top
                                          return `${x},${y}`;
                                        })
                                        .join(' ')
                                    }
                                  />
                                  {/* Y-position curve (dotted, secondary) */}
                                  <polyline
                                    fill="none"
                                    stroke="rgb(56 189 248)"
                                    strokeWidth="1"
                                    strokeDasharray="2,2"
                                    strokeOpacity="0.4"
                                    points={
                                      track.keyframes
                                        .slice()
                                        .sort((a, b) => a.time - b.time)
                                        .map((kf) => {
                                          const tv = kf.value as TrackingKeyframeValue;
                                          const x = kf.time * pixelsPerMs;
                                          const y = tv.y * trackHeight;
                                          return `${x},${y}`;
                                        })
                                        .join(' ')
                                    }
                                  />
                                </svg>
                              )}
                              {track.keyframes.map((keyframe) => {
                                const tv = keyframe.value as TrackingKeyframeValue;
                                const kfX = keyframe.time * pixelsPerMs;
                                const kfY = (1 - tv.x) * trackHeight;
                                const isSelected = editorState.selectedKeyframeId === keyframe.id;
                                const lowConf = tv.confidence < 0.3 || tv.lost;
                                return (
                                  <div
                                    key={keyframe.id}
                                    data-keyframe
                                    className={cn(
                                      "absolute w-3 h-3 rounded-full cursor-pointer group z-20 transition-transform",
                                      lowConf ? "bg-red-900 border border-red-500/50" : "bg-red-500 border-2 border-white",
                                      isSelected && "scale-150 ring-2 ring-red-300",
                                    )}
                                    style={{ left: `${kfX - 6}px`, top: `${kfY - 6}px` }}
                                    title={`Frame t=${formatTime(keyframe.time)} · x=${tv.x.toFixed(2)} y=${tv.y.toFixed(2)} · conf=${tv.confidence.toFixed(2)}${tv.lost ? ' · PERDIDO' : ''}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      selectKeyframe(keyframe.id);
                                      // Jump the playhead to this keyframe so the
                                      // scrub-follow marker shows the tracked point here
                                      setPlaybackTime(keyframe.time);
                                    }}
                                  />
                                );
                              })}
                              {/* Convert to HSP button (top-right of the lane) */}
                              <button
                                type="button"
                                className="absolute right-2 top-1/2 -translate-y-1/2 z-30 flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-fuchsia-600/20 border border-fuchsia-500/40 text-fuchsia-300 hover:bg-fuchsia-600/30 transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleTrackingToHaptic(track.id);
                                }}
                                title={`Generar keyframes haptic con mapeo ${trackingMapMode}`}
                              >
                                → HSP
                              </button>
                            </>
                          ) : (
                            <>
                              {/* Sound keyframes (original rendering) */}
                              {track.keyframes.map((keyframe) => {
                                const isInMultiSelection = editorState.selectedKeyframeIds.includes(keyframe.id);
                                return (
                                <div
                                  key={keyframe.id}
                                  data-keyframe
                                  className={cn(
                                    "timeline-keyframe text-amber-500 absolute top-1/2 -translate-y-1/2 w-5 h-7 rounded cursor-grab active:cursor-grabbing group",
                                    editorState.selectedKeyframeId === keyframe.id
                                      ? "bg-amber-500 hover:bg-amber-400 border-2 border-amber-300 shadow-md shadow-amber-500/30"
                                      : isInMultiSelection
                                      ? "bg-amber-400 hover:bg-amber-300 border-2 border-amber-200"
                                      : "bg-blue-500 hover:bg-blue-400 border border-blue-300",
                                    draggingKeyframe?.keyframeId === keyframe.id && "scale-110 bg-amber-500 border-2 border-white"
                                  )}
                                  style={{ left: `${keyframe.time * pixelsPerMs - 10}px` }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (e.shiftKey || e.ctrlKey || e.metaKey) {
                                      toggleKeyframeSelection(keyframe.id);
                                    } else {
                                      selectKeyframe(keyframe.id);
                                    }
                                  }}
                                  onMouseDown={(e) => {
                                    e.stopPropagation();
                                    // Handle selection
                                    if (e.shiftKey || e.ctrlKey || e.metaKey) {
                                      toggleKeyframeSelection(keyframe.id);
                                    } else if (!editorState.selectedKeyframeIds.includes(keyframe.id)) {
                                      selectKeyframe(keyframe.id);
                                    }

                                    // Store initial positions for all selected keyframes for multi-drag
                                    const currentSelectedIds = useTavernStore.getState().editorState.selectedKeyframeIds;
                                    if (currentSelectedIds.includes(keyframe.id) && selectedSprite) {
                                      const initialPositions = new Map<string, {time: number; position?: number}>();
                                      for (const trk of selectedSprite.timeline.tracks) {
                                        for (const kf of trk.keyframes) {
                                          if (currentSelectedIds.includes(kf.id)) {
                                            const hv = kf.value as HapticKeyframeValue;
                                            initialPositions.set(kf.id, {
                                              time: kf.time,
                                              position: hv.type === 'haptic' ? hv.position : undefined,
                                            });
                                          }
                                        }
                                      }
                                      setMultiDragInitialPositions(initialPositions);
                                      multiDragInitialPositionsRef.current = initialPositions;
                                      setMultiDragStartTime(keyframe.time);
                                      multiDragStartTimeRef.current = keyframe.time;
                                    }

                                    selectKeyframe(keyframe.id);
                                    setDraggingKeyframe({ trackId: track.id, keyframeId: keyframe.id });
                                  }}
                                >
                                  <Move className="w-3 h-3 text-white m-auto opacity-70 group-hover:opacity-100" />
                                  {/* Keyframe info tooltip */}
                                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-black/80 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none z-30">
                                    {formatTime(keyframe.time)}
                                    {(keyframe.value as SoundKeyframeValue & { soundTriggerName?: string })?.soundTriggerName && (
                                      <span className="block text-blue-300">
                                        {(keyframe.value as SoundKeyframeValue & { soundTriggerName?: string }).soundTriggerName}
                                      </span>
                                    )}
                                  </div>
                                  {/* Delete button */}
                                  <button
                                    className="absolute -top-1 -right-1 w-3 h-3 bg-destructive rounded-full opacity-0 group-hover:opacity-100 flex items-center justify-center"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDeleteKeyframe(track.id, keyframe.id);
                                    }}
                                  >
                                    <span className="text-[8px] text-white">×</span>
                                  </button>
                                </div>
                                );
                              })}
                            </>
                          )}

                          {/* Marquee selection rectangle */}
                          {isMarqueeSelecting && marqueeStart && marqueeEnd && marqueeTrackId === track.id && (() => {
                            const trackContentEl = document.querySelector(`[data-track-id="${marqueeTrackId}"] [data-track-content]`) as HTMLElement;
                            if (!trackContentEl) return null;
                            const trackRect = trackContentEl.getBoundingClientRect();
                            
                            const x1 = Math.min(marqueeStart.x, marqueeEnd.x) - trackRect.left;
                            const x2 = Math.max(marqueeStart.x, marqueeEnd.x) - trackRect.left;
                            const y1 = isHaptic ? Math.min(marqueeStart.y, marqueeEnd.y) - trackRect.top : 0;
                            const y2 = isHaptic ? Math.max(marqueeStart.y, marqueeEnd.y) - trackRect.top : trackRect.height;
                            
                            return (
                              <div
                                className="absolute border border-blue-400 bg-blue-400/15 pointer-events-none z-30 rounded-sm"
                                style={{
                                  left: `${x1}px`,
                                  width: `${x2 - x1}px`,
                                  top: `${y1}px`,
                                  height: `${y2 - y1}px`,
                                }}
                              />
                            );
                          })()}

                          {/* Playhead indicator for this track */}
                          <div
                            className="timeline-playhead-line absolute top-0 bottom-0 w-0.5 pointer-events-none"
                            style={{ left: `${playbackTime * pixelsPerMs}px` }}
                          />
                        </div>
                      </div>
                      );
                    })}

                    {/* Empty state for tracks */}
                    {selectedSprite.timeline.tracks.length === 0 && (
                      <div className="flex border-b min-h-[100px]">
                        <div className="w-44 flex-shrink-0 p-2 border-r bg-muted/40 flex items-center justify-center sticky left-0 z-10">
                          <span className="text-xs text-muted-foreground">Sin pistas</span>
                        </div>
                        <div
                          className="timeline-empty-gradient flex-1 flex items-center justify-center text-muted-foreground text-sm"
                          style={{ width: `${timelineWidth}px` }}
                        >
                          <span className="flex items-center gap-2">
                            <Plus className="w-4 h-4 opacity-50" />
                            Añade una pista de sonido o haptic para sincronizar
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="timeline-empty-gradient text-center rounded-2xl border border-dashed border-muted-foreground/20 px-12 py-10">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-muted/50 flex items-center justify-center">
                  <ImageIcon className="w-8 h-8 opacity-40" />
                </div>
                <p className="text-sm font-medium">Selecciona un sprite</p>
                <p className="text-xs mt-1 opacity-60">para editar su timeline con sonidos y haptic</p>
              </div>
            </div>
          )}
        </div>

        {/* Right Panel - Properties & Resources */}
        <div className="w-64 flex-shrink-0 flex flex-col overflow-hidden border rounded-lg bg-muted/20">
          <Tabs defaultValue="properties" className="flex-1 flex flex-col">
            <TabsList className="grid w-full grid-cols-2 flex-shrink-0">
              <TabsTrigger value="properties" className="text-xs">Propiedades</TabsTrigger>
              <TabsTrigger value="resources" className="text-xs">Recursos</TabsTrigger>
            </TabsList>
            
            <TabsContent value="properties" className="flex-1 overflow-hidden m-0">
              <ScrollArea className="h-full p-3">
                {editorState.selectedKeyframeIds.length > 1 ? (
                  <div className="space-y-3">
                    <div className="p-2 bg-fuchsia-500/10 rounded border border-fuchsia-500/30 flex items-center gap-2">
                      <Vibrate className="w-3 h-3 text-fuchsia-400" />
                      <span className="text-xs font-medium text-fuchsia-400">
                        {editorState.selectedKeyframeIds.length} Keyframes Seleccionados
                      </span>
                    </div>
                    
                    <Button
                      variant="destructive"
                      size="sm"
                      className="w-full h-7 text-xs"
                      onClick={() => {
                        if (!selectedSprite) return;
                        const selectedIds = editorState.selectedKeyframeIds;
                        setTimelineCollections(prev => prev.map(col => ({
                          ...col,
                          sprites: col.sprites.map(s =>
                            s.id === selectedSprite.id
                              ? {
                                  ...s,
                                  timeline: {
                                    ...s.timeline,
                                    tracks: s.timeline.tracks.map(t => ({
                                      ...t,
                                      keyframes: t.keyframes.filter(k => !selectedIds.includes(k.id)),
                                    })),
                                  },
                                }
                              : s
                          ),
                        })));
                        clearKeyframeSelection();
                        toast({
                          title: 'Keyframes eliminados',
                          description: `${selectedIds.length} keyframe(s) eliminado(s)`,
                        });
                      }}
                    >
                      <Trash2 className="w-3 h-3 mr-1" />
                      Eliminar Keyframes ({editorState.selectedKeyframeIds.length})
                    </Button>
                    
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full h-7 text-xs"
                      onClick={clearKeyframeSelection}
                    >
                      Deseleccionar Todo
                    </Button>
                  </div>
                ) : selectedKeyframe ? (
                  <div className="space-y-3">
                    <Label className="text-xs font-medium">Keyframe Seleccionado</Label>
                    
                    <div className="space-y-2">
                      <Label className="text-xs">Tiempo</Label>
                      <Input
                        type="text"
                        value={formatTime(selectedKeyframe.time)}
                        onChange={(e) => {
                          const newTime = parseTime(e.target.value);
                          if (newTime >= 0) {
                            handleMoveKeyframe(selectedKeyframeTrack!.id, selectedKeyframe.id, newTime);
                          }
                        }}
                        className="w-full h-7 text-xs font-mono"
                      />
                    </div>
                    
                    {(selectedKeyframe.value as SoundKeyframeValue).type === 'sound' && (
                      <>
                        <div className="space-y-2">
                          <Label className="text-xs">Volumen</Label>
                          <Input
                            type="number"
                            min="0"
                            max="2"
                            step="0.1"
                            value={(selectedKeyframe.value as SoundKeyframeValue).volume || 1}
                            onChange={(e) => handleUpdateKeyframe(selectedKeyframeTrack!.id, selectedKeyframe.id, {
                              value: { ...selectedKeyframe.value, volume: parseFloat(e.target.value) || 1 }
                            })}
                            className="w-full h-7 text-xs"
                          />
                        </div>
                        
                        {(selectedKeyframe.value as SoundKeyframeValue & { soundTriggerName?: string }).soundTriggerName && (
                          <div className="p-2 bg-blue-500/10 rounded border border-blue-500/30">
                            <span className="text-xs text-blue-400">Trigger: </span>
                            <span className="text-xs font-medium">
                              {(selectedKeyframe.value as SoundKeyframeValue & { soundTriggerName?: string }).soundTriggerName}
                            </span>
                          </div>
                        )}
                      </>
                    )}

                    {(selectedKeyframe.value as HapticKeyframeValue).type === 'haptic' && (
                      <>
                        <div className="p-2 bg-fuchsia-500/10 rounded border border-fuchsia-500/30 flex items-center gap-2">
                          <Vibrate className="w-3 h-3 text-fuchsia-400" />
                          <span className="text-xs font-medium text-fuchsia-400">Keyframe Háptico</span>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs">Posición</Label>
                            <span className="text-xs font-mono text-fuchsia-400">{(selectedKeyframe.value as HapticKeyframeValue).position}</span>
                          </div>
                          <Slider
                            min={0}
                            max={100}
                            step={1}
                            value={[(selectedKeyframe.value as HapticKeyframeValue).position]}
                            onValueChange={([val]) => handleUpdateKeyframe(selectedKeyframeTrack!.id, selectedKeyframe.id, {
                              value: { ...selectedKeyframe.value, position: val }
                            })}
                            className="w-full"
                          />
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            step="1"
                            value={(selectedKeyframe.value as HapticKeyframeValue).position}
                            onChange={(e) => {
                              const pos = Math.max(0, Math.min(100, parseInt(e.target.value) || 50));
                              handleUpdateKeyframe(selectedKeyframeTrack!.id, selectedKeyframe.id, {
                                value: { ...selectedKeyframe.value, position: pos }
                              });
                            }}
                            className="w-full h-7 text-xs font-mono"
                          />
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs font-semibold">⚡ Modo HSP</Label>
                            <div className="flex items-center gap-1.5 bg-fuchsia-500/10 rounded-md px-2 py-1">
                              <span className="text-[10px] text-fuchsia-300 font-medium">HSP Pattern</span>
                            </div>
                          </div>
                          <div className="p-2 bg-fuchsia-500/5 rounded border border-fuchsia-500/20">
                            <p className="text-xs text-fuchsia-300/70 leading-relaxed">
                              🎮 Este keyframe se convierte en un punto del patrón HSP. El dispositivo maneja la interpolación, velocidad y loop nativamente.
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <Switch
                            checked={(selectedKeyframe.value as HapticKeyframeValue).stopOnTarget ?? false}
                            onCheckedChange={(checked) => handleUpdateKeyframe(selectedKeyframeTrack!.id, selectedKeyframe.id, {
                              value: { ...selectedKeyframe.value, stopOnTarget: checked }
                            })}
                          />
                          <Label className="text-xs">Parar en Objetivo</Label>
                        </div>

                        <div className="space-y-2">
                          <Label className="text-xs font-semibold">🔄 Interpolación</Label>
                          <Select
                            value={selectedKeyframe.interpolation}
                            onValueChange={(val) => handleUpdateKeyframe(selectedKeyframeTrack!.id, selectedKeyframe.id, {
                              interpolation: val as TimelineKeyframe['interpolation']
                            })}
                          >
                            <SelectTrigger size="sm" className="w-full h-7 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="linear">Lineal</SelectItem>
                              <SelectItem value="ease-in">Ease In</SelectItem>
                              <SelectItem value="ease-out">Ease Out</SelectItem>
                              <SelectItem value="ease-in-out">Ease In-Out</SelectItem>
                              <SelectItem value="hold">Mantener (Hold)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </>
                    )}
                    
                    <Button
                      variant="destructive"
                      size="sm"
                      className="w-full h-7 text-xs"
                      onClick={() => handleDeleteKeyframe(selectedKeyframeTrack!.id, selectedKeyframe.id)}
                    >
                      <Trash2 className="w-3 h-3 mr-1" />
                      Eliminar Keyframe
                    </Button>
                  </div>
                ) : selectedSprite ? (
                  <div className="space-y-3">
                    <div className="p-2 bg-muted/50 rounded border border-muted-foreground/20">
                      <p className="text-[10px] text-muted-foreground leading-relaxed">
                        💡 Haz clic en un keyframe en la línea de tiempo para ver y editar sus propiedades (posición, velocidad, interpolación).
                      </p>
                    </div>
                    <Label className="text-xs font-medium">Sprite: {selectedSprite.label}</Label>
                    
                    <div className="space-y-2">
                      <Label className="text-xs">Nombre</Label>
                      <Input
                        type="text"
                        value={selectedSprite.label}
                        onChange={(e) => handleUpdateSprite(selectedSprite.id, { label: e.target.value })}
                        className="w-full h-7 text-xs"
                      />
                    </div>
                    
                    <div className="space-y-2">
                      <Label className="text-xs">Duración (ms)</Label>
                      <Input
                        type="number"
                        min="100"
                        step="100"
                        value={selectedSprite.timeline.duration}
                        onChange={(e) => handleUpdateSprite(selectedSprite.id, {
                          duration: parseInt(e.target.value) || 3000,
                          timeline: { ...selectedSprite.timeline, duration: parseInt(e.target.value) || 3000 }
                        })}
                        className="w-full h-7 text-xs"
                      />
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={selectedSprite.timeline.loop}
                        onCheckedChange={(checked) => handleUpdateSprite(selectedSprite.id, {
                          timeline: { ...selectedSprite.timeline, loop: checked }
                        })}
                      />
                      <Label className="text-xs">Loop</Label>
                    </div>
                    
                    <div className="pt-2 border-t">
                      <p className="text-xs text-muted-foreground">
                        Tracks: {selectedSprite.timeline.tracks.length}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Keyframes: {selectedSprite.timeline.tracks.reduce((acc, t) => acc + t.keyframes.length, 0)}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    <p>Selecciona un sprite</p>
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
            
            <TabsContent value="resources" className="flex-1 overflow-hidden m-0">
              <ScrollArea className="h-full p-3">
                <div className="space-y-2">
                  <Label className="text-xs font-medium flex items-center gap-2">
                    <Music className="w-3 h-3" />
                    Sound Triggers
                  </Label>
                  <p className="text-[10px] text-muted-foreground">
                    Arrastra al timeline o usa el botón + para agregar donde está el cabezal ({formatTime(playbackTime)})
                  </p>
                  
                  {soundTriggers && soundTriggers.length > 0 ? (
                    <div className="space-y-1">
                      {soundTriggers.map((trigger: SoundTrigger) => (
                        <div
                          key={trigger.id}
                          className="flex items-center gap-1.5 p-1.5 bg-muted/30 rounded hover:bg-muted/50 transition-colors"
                        >
                          <div
                            className="flex-1 flex items-center gap-2 min-w-0 cursor-grab active:cursor-grabbing"
                            draggable
                            onDragStart={(e) => handleDragStart(e, trigger)}
                          >
                            <Volume2 className="w-3 h-3 text-blue-400 shrink-0" />
                            <span className="text-xs truncate">{trigger.name}</span>
                            <Badge variant="secondary" className="text-[9px] shrink-0">
                              {trigger.sounds?.length || 0}
                            </Badge>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0 text-blue-500 hover:text-blue-400 hover:bg-blue-500/10"
                            title={`Agregar "${trigger.name}" en ${formatTime(playbackTime)}`}
                            disabled={!selectedSprite}
                            onClick={() => handleAddSoundAtPlayhead(trigger)}
                          >
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-4 text-muted-foreground text-xs">
                      <p>No hay sound triggers</p>
                      <p className="mt-1">Crea triggers en Settings → Sounds</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
