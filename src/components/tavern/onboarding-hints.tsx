'use client';

// ============================================
// Onboarding Hints — first-use contextual tips
// ============================================
//
// Dismissible one-time tips for new features. Each hint shows ONCE
// (localStorage flag), only when its feature is actually available in the
// current context. Renders as a slim bar at the top of the chat scene.

import { useEffect, useState, useRef } from 'react';
import { X, Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';

const STORAGE_PREFIX = 'tavernflow-hint-';

export interface OnboardingHintDef {
  key: string;
  text: string;
}

function isDismissed(key: string): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + key) === '1';
  } catch {
    return true;
  }
}

function dismiss(key: string) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, '1');
  } catch {
    // ignore
  }
}

/**
 * Shows ONE hint at a time (first non-dismissed available hint).
 * Pass only the hints whose features are present in the current context.
 */
export function OnboardingHints({
  hints,
  className,
}: {
  hints: OnboardingHintDef[];
  className?: string;
}) {
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derive the active hint lazily from localStorage on the CLIENT after mount
  // (avoids SSR mismatch), and schedule auto-dismiss without sync setState.
  useEffect(() => {
    const idx = hints.findIndex(h => !isDismissed(h.key));
    if (idx < 0) return;

    // Defer to a microtask so setState never runs synchronously in the effect body
    const raf = setTimeout(() => setActiveIndex(idx), 0);
    autoTimerRef.current = setTimeout(() => {
      dismiss(hints[idx].key);
      setActiveIndex(-1);
    }, 14000);

    return () => {
      clearTimeout(raf);
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    };
  }, [hints]);

  if (activeIndex < 0 || activeIndex >= hints.length) return null;
  const hint = hints[activeIndex];

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 text-amber-200/90 text-xs shadow-sm backdrop-blur-sm max-w-md',
        className
      )}
      role="status"
    >
      <Lightbulb className="w-3.5 h-3.5 flex-shrink-0 text-amber-400" />
      <span className="leading-snug">{hint.text}</span>
      <button
        type="button"
        onClick={() => {
          dismiss(hint.key);
          setActiveIndex(-1);
        }}
        className="ml-1 p-0.5 rounded-full hover:bg-amber-500/20 transition-colors flex-shrink-0"
        aria-label="Descartar consejo"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}
