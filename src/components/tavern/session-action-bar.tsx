'use client';

// ============================================
// Session Action Bar (compact header actions)
// ============================================
//
// Unified, compact action cluster for the NovelChatBox header. Replaces the
// old floating chips (Relaciones/Director/Proactivo) that overlapped the
// chat input on mobile.
//
// The clock chip now reflects the REAL system time (updated every minute)
// instead of a fictional world clock. The popover exposes the "Atmósfera
// automática" toggle (which makes the scene lighting follow the real time
// of day) plus a read-only display of the current real time and moment.
//
// Props are wired from chat-panel through NovelChatBox.

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Heart, Clapperboard, Clock, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isAutoAtmosphereEnabled, setAutoAtmosphereEnabled } from '@/hooks/use-auto-atmosphere';

interface SessionActionBarProps {
  /** Open the relationship graph panel */
  onOpenRelationships: () => void;
  /** Run the Director now */
  onRunDirector: () => void;
  /** Compact mode for mobile (icons only, no clock text) */
  compact?: boolean;
}

const MOMENT_ICONS: Record<string, string> = {
  madrugada: '🌙',
  mañana: '🌅',
  tarde: '☀️',
  noche: '🌆',
};

const MOMENT_LABELS: Record<string, string> = {
  madrugada: 'Madrugada',
  mañana: 'Mañana',
  tarde: 'Tarde',
  noche: 'Noche',
};

function momentFromHour(hour: number): string {
  if (hour < 6) return 'madrugada';
  if (hour < 12) return 'mañana';
  if (hour < 19) return 'tarde';
  return 'noche';
}

function formatRealClock(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const moment = momentFromHour(d.getHours());
  return `${h}:${m} (${MOMENT_LABELS[moment].toLowerCase()})`;
}

export function SessionActionBar({
  onOpenRelationships,
  onRunDirector,
  compact = false,
}: SessionActionBarProps) {
  const [showClock, setShowClock] = useState(false);
  const [directorBusy, setDirectorBusy] = useState(false);
  const [autoAtmo, setAutoAtmo] = useState(false);
  const [now, setNow] = useState<Date>(() => new Date());

  // Sync from storage on first render (client-only component)
  useEffect(() => {
    setAutoAtmo(isAutoAtmosphereEnabled());
  }, []);

  // Tick the real clock every minute so the chip and popover stay fresh.
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const moment = momentFromHour(now.getHours());
  const clockLabel = formatRealClock(now);

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

        {/* Real-time clock chip + popover */}
        <Popover open={showClock} onOpenChange={setShowClock}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                'flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium',
                'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 transition-colors'
              )}
              aria-label="Hora del sistema"
              title={`Hora del sistema: ${clockLabel}`}
            >
              <Clock className="w-3.5 h-3.5" />
              {!compact && (
                <span className="tabular-nums whitespace-nowrap">
                  {String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}
                </span>
              )}
              <span aria-hidden>{MOMENT_ICONS[moment]}</span>
            </button>
          </PopoverTrigger>

          <PopoverContent className="w-64" align="end">
            <div className="space-y-3">
              <h4 className="font-medium text-sm flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-400" />
                Hora del sistema
              </h4>

              <div className="text-center py-1.5 px-2 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 font-medium">
                {clockLabel}
              </div>

              <p className="text-[10px] text-muted-foreground leading-relaxed">
                La escena usa la hora real del sistema para definir el momento del día
                (madrugada / mañana / tarde / noche). No hay reloj ficticio ni saltos
                temporales por turno.
              </p>

              {/* Auto atmosphere by real day moment */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1" title="Cambia la atmósfera de la escena (lluvia, noche, niebla…) según el momento del día real">
                  <Sparkles className="w-3 h-3 text-violet-400" />
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

              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Al activarse, la atmósfera se actualiza automáticamente según la hora
                real, cada vez que el personaje responde.
              </p>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </TooltipProvider>
  );
}
