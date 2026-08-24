'use client';

import { useEffect, useState } from 'react';
import type { AtmosphereLayer } from '@/types';

// ============================================
// Overlay Atmosphere Layer
// Renders overlay effects like fog, night filter, light rays
// ============================================

interface OverlayAtmosphereLayerProps {
  layer: AtmosphereLayer;
  globalIntensity: number;
}

export function OverlayAtmosphereLayer({ layer, globalIntensity }: OverlayAtmosphereLayerProps) {
  const [flashOpacity, setFlashOpacity] = useState(0);
  
  // Handle lightning flash effect
  useEffect(() => {
    if (layer.id.includes('lightning') && layer.active) {
      // Random lightning flashes
      const flashInterval = setInterval(() => {
        if (Math.random() < 0.3) { // 30% chance every interval
          setFlashOpacity(1);
          setTimeout(() => setFlashOpacity(0.7), 50);
          setTimeout(() => setFlashOpacity(0.3), 100);
          setTimeout(() => setFlashOpacity(0), 200);
        }
      }, 2000 + Math.random() * 3000);
      
      return () => clearInterval(flashInterval);
    }
  }, [layer.id, layer.active]);
  
  // Get overlay styles based on layer type
  const getOverlayStyles = (): React.CSSProperties => {
    const baseStyle: React.CSSProperties = {
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none',
    };
    
    const opacity = layer.opacity * globalIntensity;
    
    switch (layer.id) {
      case 'fog-light':
      case 'fog-heavy':
        // Layered drifting fog: two blurred pseudo-banks at different speeds
        // (CSS keyframes fog-bank-a / fog-bank-b in globals.css)
        return {
          ...baseStyle,
          opacity,
        };

      case 'night-filter':
        return {
          ...baseStyle,
          background: layer.color,
          opacity,
          mixBlendMode: 'multiply',
        };
      
      case 'dust-overlay':
        return {
          ...baseStyle,
          background: layer.color,
          opacity,
        };
      
      case 'light-rays':
        return {
          ...baseStyle,
          background: `linear-gradient(135deg, transparent 0%, ${layer.color} 50%, transparent 100%)`,
          opacity,
          animation: 'light-rays-shimmer 8s ease-in-out infinite',
        };
      
      case 'lightning':
        return {
          ...baseStyle,
          background: layer.color,
          opacity: flashOpacity,
          transition: 'opacity 0.05s ease-out',
        };
      
      default:
        return {
          ...baseStyle,
          background: layer.color,
          opacity,
        };
    }
  };
  
  // Don't render if no color defined
  if (!layer.color) return null;

  // Fog renders its own drifting banks (not the single-gradient overlay)
  if (layer.id === 'fog-light' || layer.id === 'fog-heavy') {
    const heavy = layer.id === 'fog-heavy';
    const durA = heavy ? 46 : 68;
    const durB = heavy ? 34 : 52;
    return (
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', opacity: layer.opacity * globalIntensity }} aria-hidden="true">
        {/* Bank A: wide slow bottom fog */}
        <div
          className="fog-bank"
          style={{
            background: `radial-gradient(120% 55% at 30% 110%, ${layer.color} 0%, transparent 65%), radial-gradient(110% 45% at 80% 108%, ${layer.color} 0%, transparent 60%)`,
            filter: 'blur(14px)',
            animation: `fog-bank-a ${durA}s ease-in-out infinite alternate`,
            opacity: heavy ? 0.85 : 0.6,
          }}
        />
        {/* Bank B: faster mid-height wisps */}
        <div
          className="fog-bank"
          style={{
            background: `radial-gradient(90% 40% at 60% 65%, ${layer.color} 0%, transparent 70%), radial-gradient(70% 35% at 15% 55%, ${layer.color} 0%, transparent 70%)`,
            filter: 'blur(22px)',
            animation: `fog-bank-b ${durB}s ease-in-out infinite alternate`,
            opacity: heavy ? 0.6 : 0.4,
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="atmosphere-overlay"
      style={getOverlayStyles()}
      aria-hidden="true"
    />
  );
}

export default OverlayAtmosphereLayer;
