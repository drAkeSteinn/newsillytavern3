'use client';

// ============================================
// Session Action Bar (compact header actions)
// ============================================
//
// Unified, compact action cluster for the NovelChatBox header. Replaces the
// old floating chips (Relaciones/Director/Proactivo) that overlapped the
// chat input on mobile. Everything is a small ghost icon button with
// tooltips; the world clock doubles as a status chip + config popover.
//
// Props are wired from chat-panel through NovelChatBox.

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Heart, Clapperboard, Clock, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorldClock } from '@/lib/world/time';
import { formatWorldClock } from '@/lib/world/time';
import { isAutoAtmosphereEnabled, setAutoAtmosphereEnabled } from '@/hooks/use-auto-atmosphere';

interface SessionActionBarProps {
  /** Open the relationship graph panel */
  onOpenRelationships: () => void;
  /** Run the Director now */
  onRunDirector: () => void;
  /** World clock state (from session stats) */
  worldClock?: WorldClock | null;
  /** Update world clock */
  onSetWorldTime: (updates: { hour?: number; minute?: number; minutes?: number; season?: string; realTimeSync?: boolean; minutesPerTurn?: number; enabled?: boolean }) => void;
  /** Compact mode for mobile (icons only, no clock text) */
  compact?: boolean;
}

const SEASONS = ['primavera', 'verano', 'otoño', 'invierno'] as const;

const MOMENT_ICONS: Record<string, string> = {
  madrugada: '🌙',
  mañana: '🌅',
  tarde: '☀️',
  noche: '🌆',
};

export function SessionActionBar({
  onOpenRelationships,
  onRunDirector,
  worldClock,
  onSetWorldTime,
  compact = false,
}: SessionActionBarProps) {
  const [showClock, setShowClock] = useState(false);
  const [directorBusy, setDirectorBusy] = useState(false);
  const [autoAtmo, setAutoAtmo] = useState(false);

  // Sync from storage on first render (client-only component)
  useEffect(() => {
    setAutoAtmo(isAutoAtmosphereEnabled());
  }, []);

  const clock = worldClock || null;
  const momentLabel = clock ? formatWorldClock(clock) : 'Día 1 — 20:00';
  // Extract moment from the formatted string is fragile; recompute from lib
  const moment = clock
    ? (['madrugada', 'mañana', 'tarde', 'noche'] as const).find(m => momentLabel.includes(m)) || 'noche'
    : 'noche';

  const handleDirector = async () => {
    setDirectorBusy(true);
    try {
      await onRunDirector();
    } finally {
      setTimeout(() => setDirectorBusy(false), 1200);
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-0.5">
        {/* Relationships */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-fuchsia-400 hover:text-fuchsia-300 hover:bg-fuchsia-500/10"
              onClick={onOpenRelationships}
              aria-label="Relaciones"
            >
              <Heart className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            <p className="font-medium">Relaciones</p>
            <p className="text-muted-foreground">Grafo de vínculos y etapas</p>
          </TooltipContent>
        </Tooltip>

        {/* Director */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-violet-400 hover:text-violet-300 hover:bg-violet-500/10"
              onClick={handleDirector}
              disabled={directorBusy}
              aria-label="Director"
            >
              {directorBusy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Clapperboard className="w-4 h-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            <p className="font-medium">Director</p>
            <p className="text-muted-foreground">Eventos del mundo y ritmo de la sesión</p>
          </TooltipContent>
        </Tooltip>

        {/* World clock (chip + popover config) */}
        <Popover open={showClock} onOpenChange={setShowClock}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                'flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium',
                'bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 border border-teal-500/20 transition-colors',
                clock?.enabled === false && 'opacity-50'
              )}
              aria-label="Tiempo del mundo"
              title={clock ? `Tiempo del mundo: ${momentLabel}` : 'Tiempo del mundo — inicia al chatear'}
            >
              <Clock className="w-3.5 h-3.5" />
              {!compact && (
                <span className="tabular-nums whitespace-nowrap">
                  {clock ? momentLabel.replace(/ \(.*\)/, '') : '20:00'}
                </span>
              )}
              <span aria-hidden>{MOMENT_ICONS[moment] || '🌆'}</span>
            </button>
          </PopoverTrigger>

          <PopoverContent className="w-64" align="end">
            <div className="space-y-3">
              <h4 className="font-medium text-sm flex items-center gap-2">
                <Clock className="w-4 h-4 text-teal-400" />
                Tiempo del mundo
              </h4>

              {clock && (
                <div className="text-center py-1.5 px-2 rounded-md bg-teal-500/10 border border-teal-500/20 text-xs text-teal-300 font-medium">
                  {momentLabel}
                </div>
              )}

              {/* Quick jumps */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Saltar a…</Label>
                <div className="grid grid-cols-4 gap-1">
                  {[0, 6, 12, 20].map(h => (
                    <Button
                      key={h}
                      variant="outline"
                      size="sm"
                      className="h-7 px-1 text-[11px]"
                      onClick={() => onSetWorldTime({ hour: h, minute: 0 })}
                    >
                      {String(h).padStart(2, '0')}:00
                    </Button>
                  ))}
                </div>
              </div>

              {/* Season */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Estación</Label>
                <div className="grid grid-cols-4 gap-1">
                  {SEASONS.map(s => (
                    <Button
                      key={s}
                      variant={clock?.season === s ? 'default' : 'outline'}
                      size="sm"
                      className="h-7 px-1 text-[10px] capitalize"
                      onClick={() => onSetWorldTime({ season: s })}
                    >
                      {s.slice(0, 3)}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Minutes per turn */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Minutos por turno</Label>
                <div className="grid grid-cols-4 gap-1">
                  {[10, 20, 30, 60].map(m => (
                    <Button
                      key={m}
                      variant={(clock?.minutesPerTurn ?? 20) === m ? 'default' : 'outline'}
                      size="sm"
                      className="h-7 px-1 text-[11px]"
                      onClick={() => onSetWorldTime({ minutesPerTurn: m })}
                    >
                      {m}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Real-time sync */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <Label className="text-xs">Sincronizar con tiempo real</Label>
                </div>
                <Switch
                  checked={!!clock?.realTimeSync}
                  onCheckedChange={(checked) => onSetWorldTime({ realTimeSync: checked })}
                />
              </div>

              {/* Auto atmosphere by day moment */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1" title="Cambia la atmósfera de la escena (lluvia, noche, niebla…) según el momento del día del reloj">
                  <Sparkles className="w-3 h-3 text-sky-400" />
                  <Label className="text-xs">Atmósfera automática</Label>
                </div>
                <Switch
                  checked={autoAtmo}
                  onCheckedChange={(checked) => {
                    setAutoAtmo(checked);
                    setAutoAtmosphereEnabled(checked);
                  }}
                />
              </div>

              {/* Enabled */}
              <div className="flex items-center justify-between">
                <Label className="text-xs">Reloj activo</Label>
                <Switch
                  checked={clock?.enabled !== false}
                  onCheckedChange={(checked) => onSetWorldTime({ enabled: checked })}
                />
              </div>

              <p className="text-[10px] text-muted-foreground leading-relaxed">
                El tiempo avanza {clock?.minutesPerTurn ?? 20} min por turno automáticamente.
                El LLM también puede saltarlo con [tiempo:+2h] o la tool manage_time.
              </p>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </TooltipProvider>
  );
}
