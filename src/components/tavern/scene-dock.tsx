'use client';

// ============================================
// Scene Dock — desktop utility rail
// ============================================
//
// Slim vertical dock on the right edge of the chat scene (desktop only).
// Hosts scene-level utilities that don't belong to the reading flow:
//   - Atmosphere preset quick-switch (uses atmosphereSlice presets)
//   - Global sound mute (audio-mute-store)
//   - HUD show/hide (hudSlice activeTemplateId)
//   - Scene mode shortcut (collapses the chatbox to see the full sprite)
// Mounted by chat-panel next to the chatbox.

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CloudSun, Volume2, VolumeX, LayoutDashboard, Maximize2, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTavernStore } from '@/store';
import { isGlobalMuted, setGlobalMuted, onGlobalMuteChange } from '@/lib/audio/audio-mute-store';

interface SceneDockProps {
  /** Collapse/expand the chatbox (scene mode) */
  onToggleSceneMode?: () => void;
  isSceneMode?: boolean;
}

export function SceneDock({ onToggleSceneMode, isSceneMode }: SceneDockProps) {
  const [muted, setMuted] = useState(isGlobalMuted());
  const [showAtmo, setShowAtmo] = useState(false);

  // Keep the dock icon in sync when other components toggle mute
  useEffect(() => onGlobalMuteChange(setMuted), []);

  const atmospherePresets = useTavernStore((state) => state.atmospherePresets);
  const activeAtmospherePresetId = useTavernStore((state) => state.activeAtmospherePresetId);
  const activateAtmospherePreset = useTavernStore((state) => state.activateAtmospherePreset);
  const hudSessionState = useTavernStore((state) => state.hudSessionState);
  const hudTemplates = useTavernStore((state) => state.hudTemplates);
  const setActiveHUD = useTavernStore((state) => state.setActiveHUD);

  const hudVisible = !!hudSessionState.activeTemplateId;
  const lastHudId = hudVisible ? hudSessionState.activeTemplateId : (hudTemplates[0]?.id ?? null);

  const toggleMute = () => {
    const next = !muted;
    setGlobalMuted(next);
    setMuted(next);
  };

  const toggleHud = () => {
    if (hudVisible) {
      setActiveHUD(null);
    } else if (lastHudId) {
      setActiveHUD(lastHudId);
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="hidden lg:flex flex-col items-center gap-1.5 p-1.5 rounded-2xl border border-border/60 bg-background/60 backdrop-blur-md shadow-lg pointer-events-auto">
        {/* Atmosphere quick presets */}
        <Popover open={showAtmo} onOpenChange={setShowAtmo}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    'h-9 w-9 rounded-xl',
                    activeAtmospherePresetId && activeAtmospherePresetId !== 'clear'
                      ? 'text-sky-400 hover:text-sky-300 hover:bg-sky-500/10'
                      : 'text-muted-foreground'
                  )}
                  aria-label="Atmósfera"
                >
                  <CloudSun className="w-4 h-4" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="left" className="text-xs">
              <p className="font-medium">Atmósfera</p>
              <p className="text-muted-foreground">Presets de clima y ambiente</p>
            </TooltipContent>
          </Tooltip>
          <PopoverContent side="left" className="w-52">
            <div className="space-y-1.5">
              <h4 className="font-medium text-sm flex items-center gap-2">
                <CloudSun className="w-4 h-4 text-sky-400" />
                Atmósfera
              </h4>
              <div className="grid grid-cols-1 gap-1">
                {atmospherePresets.map(preset => (
                  <Button
                    key={preset.id}
                    variant={activeAtmospherePresetId === preset.id ? 'default' : 'ghost'}
                    size="sm"
                    className="h-7 justify-start text-xs"
                    onClick={() => activateAtmospherePreset(preset.id)}
                  >
                    {preset.name}
                  </Button>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Sound mute */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-9 w-9 rounded-xl',
                muted ? 'text-muted-foreground' : 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10'
              )}
              onClick={toggleMute}
              aria-label={muted ? 'Activar sonido' : 'Silenciar'}
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs">
            <p className="font-medium">{muted ? 'Sonido silenciado' : 'Sonido activo'}</p>
            <p className="text-muted-foreground">Efectos y TTS</p>
          </TooltipContent>
        </Tooltip>

        {/* HUD toggle */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                'h-9 w-9 rounded-xl',
                hudVisible ? 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10' : 'text-muted-foreground'
              )}
              onClick={toggleHud}
              disabled={!lastHudId}
              aria-label="Mostrar/ocultar HUD"
            >
              <LayoutDashboard className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs">
            <p className="font-medium">{hudVisible ? 'Ocultar HUD' : 'Mostrar HUD'}</p>
            <p className="text-muted-foreground">Panel de stats</p>
          </TooltipContent>
        </Tooltip>

        {/* Scene mode (collapse chatbox) */}
        {onToggleSceneMode && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'h-9 w-9 rounded-xl',
                  isSceneMode ? 'text-fuchsia-400 hover:text-fuchsia-300 hover:bg-fuchsia-500/10' : 'text-muted-foreground'
                )}
                onClick={onToggleSceneMode}
                aria-label="Modo escena"
              >
                {isSceneMode ? <Eye className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left" className="text-xs">
              <p className="font-medium">Modo escena</p>
              <p className="text-muted-foreground">
                {isSceneMode ? 'Chat minimizado — clic para volver' : 'Minimiza el chat para ver la escena completa'}
              </p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}
