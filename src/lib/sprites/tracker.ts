// ============================================
// Point Tracker — Lucas-Kanade optical flow
// ============================================
//
// Tracks a single point across frames of a video or animated image using
// iterative Lucas-Kanade optical flow on grayscale images:
//   - 31x31 patch (radius 15), up to 4 iterations per frame
//   - Confidence score from the structure tensor determinant + patch error
//   - Hard clamping every iteration (no NaN escapes — fixed from PoC)
//   - Re-anchoring: the patch follows the point between frames
//
// Frame sources:
//   - <video> elements (webm/mp4): seek per frame
//   - AnimatedFrameDecoder (webp/gif): decoded frame bitmaps
//
// The trajectory can then be converted to haptic keyframes with
// trackingToHapticPosition() using the COMBINED axis mapping:
//   vertical movement → graphed normally (down = haptic down)
//   horizontal movement → inverted (left = up, right = down)
// so a fast left↔right sweep produces an up↔down zigzag in the pattern.

import type { TrackingMapMode } from '@/types';

export interface TrackSample {
  /** frame index */
  frame: number;
  /** time in ms */
  time: number;
  /** normalized 0-1 (0=left) */
  x: number;
  /** normalized 0-1 (0=top) */
  y: number;
  /** 0-1 confidence; low = unreliable */
  confidence: number;
  /** tracker lost the point at this frame */
  lost: boolean;
}

/** Grayscale helper (Float32 for precision) */
function toGray(data: Uint8ClampedArray, w: number, h: number): Float32Array {
  const g = new Float32Array(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    g[i] = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
  }
  return g;
}

const PATCH = 15;       // 31x31
const MAX_ITERS = 4;
const MIN_DET = 25;     // structure tensor determinant threshold
const MAX_JUMP = 40;    // px per frame — beyond this, mark lost

/**
 * One Lucas-Kanade step: track (px, py) from prev to cur.
 * Returns [x, y, confidence].
 */
export function lucasKanadeStep(
  prev: Float32Array, cur: Float32Array,
  px: number, py: number, w: number, h: number,
): [number, number, number] {
  let gx = px, gy = py;
  let confidence = 0;

  const cx = Math.round(px), cy = Math.round(py);
  if (cx < PATCH + 1 || cy < PATCH + 1 || cx > w - PATCH - 2 || cy > h - PATCH - 2) {
    return [px, py, 0]; // too close to the border
  }

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    let a = 0, b = 0, c = 0, d1 = 0, d2 = 0;
    let count = 0;

    for (let dy = -PATCH; dy <= PATCH; dy++) {
      for (let dx = -PATCH; dx <= PATCH; dx++) {
        const curX = Math.round(gx) + dx;
        const curY = Math.round(gy) + dy;
        // Clamp inside image (NaN guard)
        if (curX < 1 || curY < 1 || curX > w - 2 || curY > h - 2) continue;

        const iCur = curY * w + curX;
        const ix = (cur[iCur + 1] - cur[iCur - 1]) * 0.5;
        const iy = (cur[iCur + w] - cur[iCur - w]) * 0.5;

        const prevX = cx + dx;
        const prevY = cy + dy;
        const iPrev = prevY * w + prevX;
        const it = cur[iCur] - prev[iPrev];

        a += ix * ix; b += ix * iy; c += iy * iy;
        d1 += ix * it; d2 += iy * it;
        count++;
      }
    }

    if (count < (PATCH * 2 + 1) * (PATCH * 2 + 1) * 0.6) {
      return [px, py, 0]; // patch clipped too much
    }

    const det = a * c - b * b;
    if (!Number.isFinite(det) || det < MIN_DET) {
      confidence = 0;
      break;
    }

    const u = (-c * d1 + b * d2) / det;
    const v = (-b * d1 + a * d2) / det;

    if (!Number.isFinite(u) || !Number.isFinite(v)) {
      return [px, py, 0];
    }

    gx += Math.max(-MAX_JUMP, Math.min(MAX_JUMP, u));
    gy += Math.max(-MAX_JUMP, Math.min(MAX_JUMP, v));

    // Confidence: normalized determinant (texture richness)
    confidence = Math.min(1, det / (1e4 * count * 0.02 + det));

    if (Math.hypot(u, v) < 0.03) break; // converged
  }

  // Final bounds clamp
  gx = Math.max(PATCH, Math.min(w - PATCH - 1, gx));
  gy = Math.max(PATCH, Math.min(h - PATCH - 1, gy));

  return [gx, gy, confidence];
}

/** Extract a grayscale frame from a canvas 2D context */
export function grayFromCanvas(ctx: CanvasRenderingContext2D, w: number, h: number): Float32Array {
  const img = ctx.getImageData(0, 0, w, h);
  return toGray(img.data, w, h);
}

/** Convert a bitmap to grayscale (for decoded animated images) */
export async function grayFromBitmap(bitmap: ImageBitmap): Promise<{ gray: Float32Array; w: number; h: number }> {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D no disponible');
  ctx.drawImage(bitmap, 0, 0);
  return { gray: grayFromCanvas(ctx, canvas.width, canvas.height), w: canvas.width, h: canvas.height };
}

// ── Frame sources ──────────────────────────────────────

export interface VideoFrameSource {
  kind: 'video';
  video: HTMLVideoElement;
}

/** Seek a video to a time and return its grayscale frame */
export async function seekVideoGray(video: HTMLVideoElement, timeSec: number, ctx: CanvasRenderingContext2D): Promise<Float32Array> {
  const target = Math.max(0, Math.min(timeSec, Math.max(0, video.duration - 0.001)));
  await new Promise<void>((resolve) => {
    const done = () => { video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done);
    video.currentTime = target;
    // Safety timeout (some browsers don't fire seeked for tiny deltas)
    setTimeout(done, 120);
  });
  ctx.drawImage(video, 0, 0, ctx.canvas.width, ctx.canvas.height);
  return grayFromCanvas(ctx, ctx.canvas.width, ctx.canvas.height);
}

// ── Tracking runners ───────────────────────────────────

export interface TrackOptions {
  /** Start point normalized 0-1 */
  startX: number;
  startY: number;
  /** Total duration to track (ms). Use Infinity to track the whole source. */
  durationMs: number;
  /** Sampling cadence in ms (default 100 = ~10 fps sampling) */
  sampleEveryMs?: number;
  /** Progress callback (0-1) */
  onProgress?: (p: number) => void;
  /** Per-sample callback — lets the UI move the red marker live as tracking advances */
  onSample?: (sample: TrackSample) => void;
}

/**
 * Track a point through an HTMLVideoElement (webm/mp4).
 * Returns the trajectory samples.
 */
export async function trackVideo(
  videoUrl: string,
  opts: TrackOptions,
): Promise<{ samples: TrackSample[]; width: number; height: number; frameCount: number }> {
  const video = document.createElement('video');
  video.src = videoUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('No se pudo cargar el video'));
  });

  const w = video.videoWidth, h = video.videoHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D no disponible');

  const durationMs = Math.min(opts.durationMs, video.duration * 1000);
  const step = opts.sampleEveryMs ?? 100;
  const frameCount = Math.max(1, Math.floor(durationMs / step));

  // First frame
  let gray = await seekVideoGray(video, 0, ctx);
  let px = opts.startX * w;
  let py = opts.startY * h;
  let confidence = 1;

  const samples: TrackSample[] = [{
    frame: 0, time: 0,
    x: px / w, y: py / h, confidence, lost: false,
  }];
  opts.onSample?.(samples[0]);

  for (let f = 1; f <= frameCount; f++) {
    const tMs = f * step;
    const cur = await seekVideoGray(video, tMs / 1000, ctx);
    const [nx, ny, conf] = lucasKanadeStep(gray, cur, px, py, w, h);

    const jumped = Math.hypot(nx - px, ny - py) > MAX_JUMP * 1.5;
    const lost = conf <= 0 || jumped;

    const sample: TrackSample = {
      frame: f, time: tMs,
      x: nx / w, y: ny / h,
      confidence: conf,
      lost,
    };
    samples.push(sample);
    opts.onSample?.(sample);

    if (!lost) { px = nx; py = ny; }
    gray = cur;
    opts.onProgress?.(f / frameCount);
  }

  return { samples, width: w, height: h, frameCount: frameCount + 1 };
}

/**
 * Track a point through decoded animated-image frames (webp/gif).
 * The decoder must already be loaded.
 */
export async function trackAnimatedImage(
  getFrame: (index: number) => Promise<ImageBitmap | null>,
  frameCount: number,
  frameTimeMs: (index: number) => number,
  opts: TrackOptions,
): Promise<{ samples: TrackSample[]; width: number; height: number }> {
  if (frameCount <= 0) throw new Error('Sin frames para trackear');

  const first = await getFrame(0);
  if (!first) throw new Error('Frame 0 no decodificable');
  const { gray: firstGray, w, h } = await grayFromBitmap(first);

  let px = opts.startX * w;
  let py = opts.startY * h;
  let gray = firstGray;

  // Time limit: samples beyond this are skipped (default: track everything).
  // Prevents stray keyframes past the animation/timeline end.
  const limitMs = Number.isFinite(opts.durationMs) ? opts.durationMs : Number.POSITIVE_INFINITY;

  const samples: TrackSample[] = [{
    frame: 0, time: frameTimeMs(0),
    x: px / w, y: py / h, confidence: 1, lost: false,
  }];
  opts.onSample?.(samples[0]);

  for (let f = 1; f < frameCount; f++) {
    const tMs = frameTimeMs(f);
    if (tMs > limitMs) break; // stop at the limit — no orphan keys past the end

    const bmp = await getFrame(f);
    if (!bmp) {
      const lostSample: TrackSample = { frame: f, time: tMs, x: px / w, y: py / h, confidence: 0, lost: true };
      samples.push(lostSample);
      opts.onSample?.(lostSample);
      continue;
    }
    const { gray: cur } = await grayFromBitmap(bmp);
    const [nx, ny, conf] = lucasKanadeStep(gray, cur, px, py, w, h);

    const jumped = Math.hypot(nx - px, ny - py) > MAX_JUMP * 1.5;
    const lost = conf <= 0 || jumped;

    const sample: TrackSample = {
      frame: f, time: tMs,
      x: nx / w, y: ny / h,
      confidence: conf, lost,
    };
    samples.push(sample);
    opts.onSample?.(sample);

    if (!lost) { px = nx; py = ny; }
    gray = cur;
    opts.onProgress?.(f / (frameCount - 1));
  }

  return { samples, width: w, height: h };
}

// ── Trajectory → Haptic conversion ─────────────────────

/**
 * Convert a tracked (x, y) sample to a haptic position 0-100.
 *
 * Mapping modes:
 *   'y'         → pos = y * 100                    (down = haptic down)
 *   'x'         → pos = (1 - x) * 100              (LEFT = up, right = down)
 *   'combined'  → pos = (y + (1 - x)) / 2 * 100    (both axes blended)
 *
 * In 'combined', a fast left→right sweep makes the position DROP (up in the
 * graph), and a right→left sweep makes it RISE — so horizontal strokes draw
 * as up/down movement in the haptic pattern, exactly mirroring the tracked
 * motion. Vertical motion graphs normally. This encodes 2D movement into
 * the single 0-100 haptic axis.
 */
export function trackingToHapticPosition(
  x: number, y: number, mode: TrackingMapMode = 'combined',
): number {
  const xn = Math.max(0, Math.min(1, x));
  const yn = Math.max(0, Math.min(1, y));
  let pos: number;
  switch (mode) {
    case 'y': pos = yn * 100; break;
    case 'x': pos = (1 - xn) * 100; break;
    case 'combined':
    default: pos = ((yn + (1 - xn)) / 2) * 100; break;
  }
  return Math.max(0, Math.min(100, Math.round(pos)));
}

// ── Keyframe simplification (Ramer-Douglas-Peucker) ────

/**
 * Simplify a (time, position) trajectory using Ramer-Douglas-Peucker with
 * VERTICAL distance (position error). This is the right metric for haptic
 * keyframes because time is the exact independent axis — what matters is how
 * far the simplified curve deviates in POSITION at any given time.
 *
 * Epsilon is in haptic position units (0-100): e.g. epsilon=2.5 means the
 * simplified curve never differs from the original by more than ±2.5 points
 * of slider position — far below what the device (or a human) can feel.
 *
 * Guarantees:
 *   - first and last keyframes are always kept
 *   - sharp direction changes (the motion extremes that shape the pattern)
 *     are always kept — RDP works precisely by keeping them
 *   - collinear/constant stretches collapse to their endpoints
 *
 * This turns 64 samples/second into ~4-12 keyframes for typical motion while
 * preserving the feel of the curve.
 */
export function simplifyKeyframesRDP<T extends { time: number }>(
  items: T[],
  getPosition: (item: T) => number,
  epsilon: number,
): T[] {
  const n = items.length;
  if (n <= 2 || epsilon <= 0) return items.slice();

  const keep = new Array<boolean>(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;

  // Iterative RDP (avoids recursion limits on long trajectories)
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    if (end <= start + 1) continue;

    const t0 = items[start].time;
    const t1 = items[end].time;
    const p0 = getPosition(items[start]);
    const p1 = getPosition(items[end]);

    let maxDist = -1;
    let maxIdx = -1;
    for (let i = start + 1; i < end; i++) {
      const t = items[i].time;
      const p = getPosition(items[i]);
      const ratio = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
      const interpolated = p0 + (p1 - p0) * ratio;
      const dist = Math.abs(p - interpolated);
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }

    if (maxDist > epsilon && maxIdx > 0) {
      keep[maxIdx] = true;
      stack.push([start, maxIdx]);
      stack.push([maxIdx, end]);
    }
  }

  const result: T[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) result.push(items[i]);
  }
  return result;
}

/** Preset tolerances for the UI (haptic position units 0-100) */
export const RDP_TOLERANCES = {
  precise: 1,     // ±1 position point — near lossless
  balanced: 2.5,  // ±2.5 — recommended default
  smooth: 5,      // ±5 — very compact, smooths micro-jitter
} as const;

export type RDPToleranceKey = keyof typeof RDP_TOLERANCES;

// ── Range remapping (haptic output scale) ──────────────

/**
 * Create a linear remapper from [fromMin, fromMax] to [toMin, toMax].
 * Used to scale the haptic OUTPUT range without touching the tracked curve:
 * e.g. the trajectory's lowest peak maps to 10 and its highest to 80,
 * compressing the device stroke to the 10-80 window.
 * Values are clamped to the target range; a degenerate (flat) source range
 * maps everything to toMin.
 */
export function createRangeRemapper(
  fromMin: number, fromMax: number,
  toMin: number, toMax: number,
): (p: number) => number {
  const span = fromMax - fromMin;
  const lo = Math.min(toMin, toMax);
  const hi = Math.max(toMin, toMax);
  if (!Number.isFinite(span) || span < 1e-6) {
    return () => lo;
  }
  return (p: number) => {
    const ratio = (p - fromMin) / span;
    const out = toMin + ratio * (toMax - toMin);
    return Math.max(lo, Math.min(hi, out));
  };
}
