'use client';

// ============================================
// Engine Atmosphere Layer
// ============================================
//
// React wrapper for the AtmosphereEngine (professional particle canvas).
// Replaces BOTH the old CSS rain layer and the old canvas layer — every
// particle effect (rain, snow, fireflies, embers, leaves, dust) now runs on
// the same engine with depth parallax, gusts and DPR-aware rendering.

import { useEffect, useRef } from 'react';
import type { AtmosphereLayer } from '@/types';
import { AtmosphereEngine, type EffectKind, type EngineOptions } from '@/lib/atmosphere/engine';

interface EngineAtmosphereLayerProps {
  layer: AtmosphereLayer;
  globalIntensity: number;
  performanceMode: 'quality' | 'balanced' | 'performance';
}

/** Map an AtmosphereLayer to an engine effect kind */
function effectKindFor(layer: AtmosphereLayer): EffectKind | null {
  const id = layer.id.toLowerCase();
  if (id.includes('rain')) return 'rain';
  if (id.includes('snow')) return 'snow';
  if (id.includes('firefly') || id.includes('luciernaga')) return 'fireflies';
  if (id.includes('ember') || id.includes('brasa') || id.includes('ascua')) return 'embers';
  if (id.includes('leaf') || id.includes('leaves') || id.includes('hoja')) return 'leaves';
  if (id.includes('dust') || id.includes('polvo')) return 'dust';
  return null;
}

export function EngineAtmosphereLayer({ layer, globalIntensity, performanceMode }: EngineAtmosphereLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<AtmosphereEngine | null>(null);
  const layerRef = useRef(layer);

  // Keep the ref in sync inside an effect (never during render)
  useEffect(() => {
    layerRef.current = layer;
  }, [layer]);

  const kind = effectKindFor(layer);

  useEffect(() => {
    if (!kind || !canvasRef.current) return;

    const current = layerRef.current;
    const options: EngineOptions = {
      kind,
      intensity: current.intensity * globalIntensity,
      opacity: current.opacity,
      speed: current.speed || 1,
      wind: (current.windSpeed || 0) * 26,
      color: current.color,
      colorSecondary: current.colorSecondary,
      performanceMode,
    };

    let engine: AtmosphereEngine;
    try {
      engine = new AtmosphereEngine(canvasRef.current, options);
    } catch {
      return; // canvas unavailable
    }
    engineRef.current = engine;
    engine.observeResize();
    engine.start();

    // Pause when the tab is hidden (battery-friendly)
    const onVisibility = () => {
      if (document.hidden) engine.stop();
      else engine.start();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      engine.destroy();
      engineRef.current = null;
    };
  }, [kind]);

  // Live option updates (intensity/opacity/speed/wind/perf mode)
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !kind) return;
    engine.setOptions({
      intensity: layer.intensity * globalIntensity,
      opacity: layer.opacity,
      speed: layer.speed || 1,
      wind: (layer.windSpeed || 0) * 26,
      color: layer.color,
      colorSecondary: layer.colorSecondary,
      performanceMode,
    });
  }, [layer.intensity, layer.opacity, layer.speed, layer.windSpeed, layer.color, layer.colorSecondary, globalIntensity, performanceMode, kind]);

  if (!kind) return null;

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    />
  );
}

export default EngineAtmosphereLayer;
