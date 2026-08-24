// ============================================
// Point Tracker — NCC template matching (multi-scale pyramid)
// ============================================
//
// Tracks a single point across frames of a video or animated image using
// Normalized Cross-Correlation (NCC) template matching:
//   - 3-scale pyramid: quarter-res (big jumps) → half-res → full-res refine
//   - Template re-extracted from the tracked position each frame (zero drift)
//   - Confidence = correlation value 0-1 (intuitive; flat areas still work)
//   - MovementRange preset (small/medium/large) scales search radius & max jump
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

/**
 * Movement range preset — controls how far the tracker is willing to look
 * for the point between frames. Bigger ranges catch large/fast motion but
 * cost more CPU and may pick a wrong similar-looking patch.
 *
 *   - small:  ~25 px/frame jump max — fast, for slow / subtle motion (eyes)
 *   - medium: ~50 px/frame jump max — default, balances speed & reach
 *   - large:  ~120 px/frame jump max — for fast / wide motion (mouth full stroke)
 *
 * Implementation: 3-scale pyramid (quarter / half / full res). The coarsest
 * scale (quarter-res) covers the BIGGEST jumps because a search of ±N px at
 * 1/4 scale = ±4N px at full scale. So 'large' (24 px @ quarter-res) covers
 * ±96 px at full scale per frame — enough for almost any animated sprite.
 */
export type MovementRange = 'small' | 'medium' | 'large';

export interface MovementRangeConfig {
  templateRadius: number;       // pr — template is (2pr+1) x (2pr+1)
  coarseSearchRadius: number;   // quarter-res search radius (big jumps)
  midSearchRadius: number;      // half-res search radius (medium jumps)
  fineSearchRadius: number;     // full-res search radius (fine refinement)
  maxJump: number;              // px per frame — beyond this → lost
  minConfidence: number;        // threshold below which to mark as lost
}

export const MOVEMENT_RANGES: Record<MovementRange, MovementRangeConfig> = {
  small:  {
    templateRadius: 10,
    coarseSearchRadius: 8,
    midSearchRadius: 12,
    fineSearchRadius: 8,
    maxJump: 25,
    minConfidence: 0.4,
  },
  medium: {
    templateRadius: 10,
    coarseSearchRadius: 14,
    midSearchRadius: 18,
    fineSearchRadius: 12,
    maxJump: 50,
    minConfidence: 0.3,
  },
  large:  {
    templateRadius: 10,
    coarseSearchRadius: 40,   // ±40 at quarter-res = ±160 at full-res
    midSearchRadius: 32,      // ±32 at half-res   = ±64  at full-res
    fineSearchRadius: 16,     // ±16 at full-res
    maxJump: 240,             // total reach: 160 + 64 + 16 = 240 px per frame
    minConfidence: 0.22,
  },
};

/**
 * Normalized Cross-Correlation (NCC) template matching — the robust
 * replacement for Lucas-Kanade in sprite tracking.
 *
 * Why NCC over LK for animated sprites:
 *   - Works on flat/low-texture areas (eyes, mouth) — LK needs gradient richness
 *   - Handles discrete frame jumps (NCC searches a full window, not small deltas)
 *   - Confidence = correlation value (0=no match, 1=perfect) — intuitive
 *   - No drift: each frame re-extracts the template from the tracked position
 *
 * Runs a 3-scale pyramid (configurable via MovementRange):
 *   1. quarter-res coarse search  — covers the BIGGEST jumps
 *   2. half-res mid search          — covers medium jumps
 *   3. full-res fine refinement     — sub-pixel-ish precision
 *
 * Each finer scale searches around the previous scale's result, so the
 * effective search window at full-res is approximately:
 *   (coarseSearchRadius*4 + midSearchRadius*2 + fineSearchRadius) px
 * which for 'large' = (96 + 56 + 16) = up to ~168 px of motion per frame.
 */
export function nccSearch(
  prev: Float32Array, cur: Float32Array,
  px: number, py: number, w: number, h: number,
  cfg: MovementRangeConfig = MOVEMENT_RANGES.medium,
): [number, number, number] {
  // ── 1. Coarse pyramid pass (quarter resolution) — handles big jumps ──
  // Template is always extracted from prev at the ORIGINAL (px, py) position
  // (scaled to the current pyramid level). Only the SEARCH start in cur
  // propagates between scales — otherwise the template drifts away from the
  // feature we're tracking, and confidence stays high at wrong positions.
  let qSearchX = px, qSearchY = py;
  if (w >= 8 && h >= 8) {
    const prevQ = downsample2(downsample2(prev, w, h), Math.floor(w / 2), Math.floor(h / 2));
    const curQ = downsample2(downsample2(cur, w, h), Math.floor(w / 2), Math.floor(h / 2));
    const wQ = Math.floor(Math.floor(w / 2) / 2);
    const hQ = Math.floor(Math.floor(h / 2) / 2);
    if (wQ >= 4 && hQ >= 4) {
      const [cx, cy, cc] = nccSearchSingleScale(
        prevQ, curQ,
        Math.round(px / 4), Math.round(py / 4),    // template: original position
        Math.round(px / 4), Math.round(py / 4),    // search: start at original (no prior)
        wQ, hQ,
        Math.max(4, Math.ceil(cfg.templateRadius / 4)),
        cfg.coarseSearchRadius,
      );
      if (cc > 0.22) {
        qSearchX = cx * 4;
        qSearchY = cy * 4;
      }
    }
  }

  // ── 2. Mid pyramid pass (half resolution) — refines around quarter-res ──
  let hSearchX = qSearchX, hSearchY = qSearchY;
  if (w >= 4 && h >= 4) {
    const [cx, cy, cc] = nccSearchSingleScale(
      downsample2(prev, w, h), downsample2(cur, w, h),
      Math.round(px / 2), Math.round(py / 2),       // template: original position
      Math.round(qSearchX / 2), Math.round(qSearchY / 2),  // search: propagate coarse
      Math.floor(w / 2), Math.floor(h / 2),
      Math.max(4, Math.ceil(cfg.templateRadius / 2)),
      cfg.midSearchRadius,
    );
    if (cc > 0.25) {
      hSearchX = cx * 2;
      hSearchY = cy * 2;
    }
  }

  // ── 3. Fine pass at full resolution (search near mid result) ──
  return nccSearchSingleScale(
    prev, cur,
    px, py,                                          // template: original position
    Math.round(hSearchX), Math.round(hSearchY),     // search: propagate mid
    w, h,
    cfg.templateRadius, cfg.fineSearchRadius,
  );
}

/** Single-scale NCC search.
 *  - Template extracted from `prev` at (tplX, tplY) — the ORIGINAL position
 *    (where the feature was in the previous frame).
 *  - Search in `cur` around (srchX, srchY) — the propagated candidate
 *    (from the coarser scale's result, or just (tplX, tplY) for the coarsest).
 *  Returns [bestX, bestY, confidence] in this scale's coordinates.
 */
function nccSearchSingleScale(
  prev: Float32Array, cur: Float32Array,
  tplX: number, tplY: number,
  srchX: number, srchY: number,
  w: number, h: number,
  pr: number, sr: number,
): [number, number, number] {
  const tplW = pr * 2 + 1;
  const tplSize = tplW * tplW;

  // Extract template from prev at (tplX, tplY) with bounds clamping.
  // The template is the feature we're tracking — it must stay anchored to
  // where the feature WAS in the previous frame, regardless of where the
  // search starts.
  const tpl = new Float32Array(tplSize);
  let tplSum = 0;
  for (let dy = -pr; dy <= pr; dy++) {
    for (let dx = -pr; dx <= pr; dx++) {
      const x = tplX + dx < 0 ? 0 : (tplX + dx >= w ? w - 1 : tplX + dx);
      const y = tplY + dy < 0 ? 0 : (tplY + dy >= h ? h - 1 : tplY + dy);
      const v = prev[y * w + x];
      tpl[(dy + pr) * tplW + (dx + pr)] = v;
      tplSum += v;
    }
  }
  const tplMean = tplSum / tplSize;

  let tplNorm = 0;
  for (let i = 0; i < tplSize; i++) {
    const d = tpl[i] - tplMean;
    tplNorm += d * d;
  }
  tplNorm = Math.sqrt(tplNorm);
  if (tplNorm < 1e-4) return [srchX, srchY, 0]; // flat template

  // Search in cur around (srchX, srchY)
  let bestX = srchX, bestY = srchY, bestNcc = -2;
  for (let sy = -sr; sy <= sr; sy++) {
    for (let sx = -sr; sx <= sr; sx++) {
      const cx = srchX + sx;
      const cy = srchY + sy;
      if (cx < pr || cy < pr || cx >= w - pr || cy >= h - pr) continue;

      let curSum = 0;
      for (let dy = -pr; dy <= pr; dy++) {
        const rowBase = (cy + dy) * w + (cx - pr);
        for (let dx = 0; dx < tplW; dx++) {
          curSum += cur[rowBase + dx];
        }
      }
      const curMean = curSum / tplSize;

      let dot = 0, curNorm = 0;
      for (let dy = -pr; dy <= pr; dy++) {
        const rowBase = (cy + dy) * w + (cx - pr);
        const tplBase = (dy + pr) * tplW;
        for (let dx = 0; dx < tplW; dx++) {
          const cv = cur[rowBase + dx] - curMean;
          const tv = tpl[tplBase + dx] - tplMean;
          dot += cv * tv;
          curNorm += cv * cv;
        }
      }
      curNorm = Math.sqrt(curNorm);
      if (curNorm < 1e-4) continue;

      const ncc = dot / (tplNorm * curNorm);
      if (ncc > bestNcc) {
        bestNcc = ncc;
        bestX = cx;
        bestY = cy;
      }
    }
  }

  const confidence = Math.max(0, Math.min(1, bestNcc));
  return [bestX, bestY, confidence];
}

/** Downsample a grayscale image by 2x (average pooling) */
function downsample2(img: Float32Array, w: number, h: number): Float32Array {
  const w2 = Math.floor(w / 2);
  const h2 = Math.floor(h / 2);
  const out = new Float32Array(w2 * h2);
  for (let y = 0; y < h2; y++) {
    for (let x = 0; x < w2; x++) {
      const i = (y * 2) * w + (x * 2);
      out[y * w2 + x] = (img[i] + img[i + 1] + img[i + w] + img[i + w + 1]) * 0.25;
    }
  }
  return out;
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
  /** Movement range preset: bigger = catches larger motion but is slower.
   *  Default 'medium'. Use 'large' for fast/wide motion (full strokes). */
  movementRange?: MovementRange;
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
  const cfg = MOVEMENT_RANGES[opts.movementRange ?? 'medium'];

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
    const [nx, ny, conf] = nccSearch(gray, cur, px, py, w, h, cfg);

    const jumped = Math.hypot(nx - px, ny - py) > cfg.maxJump * 1.5;
    const lost = conf <= cfg.minConfidence || jumped;

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

  const cfg = MOVEMENT_RANGES[opts.movementRange ?? 'medium'];

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
    const [nx, ny, conf] = nccSearch(gray, cur, px, py, w, h, cfg);

    const jumped = Math.hypot(nx - px, ny - py) > cfg.maxJump * 1.5;
    const lost = conf <= cfg.minConfidence || jumped;

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
 * Reference guides placed on the sprite preview to define the active region
 * for tracking conversion. Instead of auto-normalizing the trajectory to its
 * own min/max, the user marks the absolute "top / bottom / left / right"
 * bounds of the motion of interest on the sprite. The tracked point's
 * position relative to these guides becomes the absolute haptic position.
 *
 * All four values are normalized 0-1 in sprite coordinates:
 *   topY    < bottomY  (top is HIGHER on screen, i.e. smaller y)
 *   leftX   < rightX   (left is at smaller x)
 *
 * When `enabled` is false, the guides are ignored and conversion falls back
 * to auto-normalization (curve min→effMin, curve max→effMax).
 */
export interface TrackingGuides {
  enabled: boolean;
  topY: number;     // 0-1, top of the active vertical region (smaller y)
  bottomY: number; // 0-1, bottom of the active vertical region (larger y)
  leftX: number;    // 0-1, left edge of the active horizontal region
  rightX: number;   // 0-1, right edge of the active horizontal region
}

export const DEFAULT_GUIDES: TrackingGuides = {
  enabled: false,
  topY: 0.1,
  bottomY: 0.9,
  leftX: 0.1,
  rightX: 0.9,
};

/**
 * Vertical haptic position from a tracked y-coordinate (0-1 normalized,
 * 0 = top of sprite, 1 = bottom of sprite).
 *
 * Returns 0-100 where 100 = "UP" (top of the guide region or top of sprite)
 * and 0 = "DOWN" (bottom of the guide region or bottom of sprite).
 *
 * This is the FIX for the vertical inversion bug: previously y=0 (top of
 * sprite) mapped to position 0 (= down), which is backwards for the Handy
 * device convention (top of screen = top of stroke = position 100). Now
 * y=0 → 100 (up) and y=1 → 0 (down), matching the user's expectation that
 * "cuando deberia de subir parece que baja" is corrected.
 *
 * With guides enabled, the position is computed relative to the guide
 * limits (topY → 100, bottomY → 0); values outside the guides are clamped.
 */
export function computeVerticalPosition(y: number, guides?: TrackingGuides): number {
  const yn = Math.max(0, Math.min(1, y));
  if (guides?.enabled) {
    const span = guides.bottomY - guides.topY;
    if (!Number.isFinite(span) || Math.abs(span) < 1e-6) return 50; // degenerate guide
    const t = (yn - guides.topY) / span;       // 0 at topY, 1 at bottomY
    return Math.max(0, Math.min(100, (1 - t) * 100)); // topY → 100 (up), bottomY → 0 (down)
  }
  return (1 - yn) * 100; // top of sprite → 100 (up), bottom → 0 (down)
}

/**
 * Horizontal haptic position from a tracked x-coordinate (0-1 normalized,
 * 0 = left, 1 = right).
 *
 * Returns 0-100 where 0 = left edge and 100 = right edge. This is the
 * "horizontal raw position" used by the combined-mode delta-sum: a positive
 * delta (motion toward the right) contributes a NEGATIVE position change
 * (down) via the "right = down, left = up" convention.
 *
 * With guides enabled, position is relative to the guide limits
 * (leftX → 0, rightX → 100); values outside the guides are clamped.
 */
export function computeHorizontalPosition(x: number, guides?: TrackingGuides): number {
  const xn = Math.max(0, Math.min(1, x));
  if (guides?.enabled) {
    const span = guides.rightX - guides.leftX;
    if (!Number.isFinite(span) || Math.abs(span) < 1e-6) return 50;
    const t = (xn - guides.leftX) / span; // 0 at leftX, 1 at rightX
    return Math.max(0, Math.min(100, t * 100));
  }
  return xn * 100;
}

/**
 * Convert a tracked (x, y) sample to a haptic position 0-100. SINGLE-POINT
 * mapping — used for the live preview marker, the mini-waveform, and the
 * 'y' / 'x' conversion modes (each keyframe is independent).
 *
 * Mapping modes:
 *   'y'         → pos = computeVerticalPosition(y, guides)
 *                 (top of sprite = 100 = up; FIX for the inversion bug)
 *   'x'         → pos = (1 - x) * 100   (LEFT = up, right = down — no guides)
 *                 pos = computeHorizontalPosition(x, guides)   (with guides)
 *   'combined'  → SINGLE-POINT FALLBACK: vertical only (the full delta-sum
 *                 combined mapping needs the whole trajectory, which is
 *                 handled by trackingToHapticPositionsCombined() below).
 *
 * For 'combined' conversion of a full trajectory, call
 * trackingToHapticPositionsCombined() instead — it implements the new
 * "horizontal delta SUMS to the vertical axis" rule (item 3): a 5-pt
 * rightward shift while going 40 down vertically becomes a 45-pt downward
 * motion (right = down adds to the vertical delta).
 */
export function trackingToHapticPosition(
  x: number, y: number, mode: TrackingMapMode = 'combined', guides?: TrackingGuides,
): number {
  const xn = Math.max(0, Math.min(1, x));
  const yn = Math.max(0, Math.min(1, y));
  let pos: number;
  switch (mode) {
    case 'y':
      // Vertical only — top of sprite/guide = 100 (up), bottom = 0 (down).
      pos = computeVerticalPosition(yn, guides);
      break;
    case 'x':
      // Horizontal only — keep "left = up (100), right = down (0)" without
      // guides; with guides, use the guide-normalized raw x.
      pos = guides?.enabled
        ? (100 - computeHorizontalPosition(xn, guides))
        : (1 - xn) * 100;
      break;
    case 'combined':
    default:
      // Single-point fallback: vertical only (real combined mapping is in
      // trackingToHapticPositionsCombined — needs the whole trajectory).
      pos = computeVerticalPosition(yn, guides);
      break;
  }
  return Math.max(0, Math.min(100, Math.round(pos)));
}

/**
 * COMBINED-mode trajectory mapping using the new DELTA-SUM rule (item 3):
 * the first keyframe establishes the baseline (its vertical position),
 * then each subsequent keyframe adds (deltaV - deltaH) to the previous
 * position, clamped to [0, 100].
 *
 * Why this formula:
 *   - deltaV is the change in vertical haptic position. deltaV < 0 means
 *     the point moved DOWN on screen (since top=100, bottom=0). So a
 *     negative deltaV is "going down" — and we want the haptic position to
 *     go down too (decrease). deltaV is added directly.
 *   - deltaH is the change in horizontal raw position (0=left, 100=right).
 *     deltaH > 0 means the point moved RIGHT. With "right = down", rightward
 *     motion should DECREASE the haptic position. So we SUBTRACT deltaH:
 *     a positive deltaH (rightward) → negative contribution → down.
 *     A negative deltaH (leftward) → positive contribution → up.
 *
 * Special cases (item 4):
 *   - Pure vertical (deltaH = 0): pos = prev + deltaV   ← reduces to vertical-only
 *   - Pure horizontal (deltaV = 0): pos = prev - deltaH  ← "left = up, right = down"
 *   - Both moving in the same "down" direction (deltaV<0, deltaH>0):
 *     |total down| = |deltaV| + |deltaH|  ← the magnitudes SUM (item 3 example)
 *   - Both moving in opposite directions: they partially cancel.
 *
 * All positions are clamped to [0, 100] (item 3: "sin pasar de 100").
 *
 * NOTE: this is a stateful, incremental computation — the position at frame
 * N depends on the cumulative deltas from frame 0. A single tracking error
 * (e.g. a lost frame producing a wild position) can therefore drift the
 * whole subsequent curve. The caller is expected to filter out `lost`
 * samples before passing them in (handleTrackingToHaptic already does this).
 */
export function trackingToHapticPositionsCombined(
  points: Array<{ x: number; y: number; time: number }>,
  guides?: TrackingGuides,
): number[] {
  if (!Array.isArray(points) || points.length === 0) return [];
  const positions: number[] = new Array(points.length);
  let prevV: number | null = null;
  let prevH: number | null = null;
  let prevPos = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const v = computeVerticalPosition(p.y, guides);
    const h = computeHorizontalPosition(p.x, guides);
    if (i === 0 || prevV === null || prevH === null) {
      // First valid point: baseline = vertical position only.
      // (Horizontal has no "previous" to compute a delta from.)
      prevPos = v;
    } else {
      const deltaV = v - prevV;
      const deltaH = h - prevH;
      let next = prevPos + deltaV - deltaH;
      // Clamp to device range — "sin pasar de 100".
      if (!Number.isFinite(next)) next = prevPos;
      next = Math.max(0, Math.min(100, next));
      prevPos = next;
    }
    prevV = v;
    prevH = h;
    positions[i] = Math.round(prevPos);
  }
  return positions;
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

// ── Sparse-trajectory densification (Catmull-Rom) ──────

/**
 * Densify a sparse trajectory by inserting Catmull-Rom spline samples between
 * consecutive points. Used when the source has very few keyframes (e.g. manual
 * tracking) so the resulting haptic curve is smooth instead of being a few
 * straight segments. The spline passes EXACTLY through every input point —
 * manual points are preserved as anchors; the inserted samples just smooth the
 * curve between them.
 *
 * Behavior:
 *   - 0/1 points  → returned as-is (nothing to densify)
 *   - 2 points    → returned as-is (linear is the only option)
 *   - 3+ points   → Catmull-Rom samples inserted between every pair, with the
 *                   tangent at the endpoints extrapolated from the first/last
 *                   segment (so the curve stays smooth at the boundaries)
 *
 * `maxGapMs` controls how many samples to insert between two consecutive
 * keyframes: enough that consecutive samples are no more than `maxGapMs` apart
 * (default 50ms — matches the HSP generator's POINT_INTERVAL_MS so the device
 * gets one sample per output point and the linear interpolation looks smooth).
 */
export function densifyTrajectoryCatmullRom<T extends { time: number }>(
  items: T[],
  getPosition: (item: T) => number,
  maxGapMs: number = 50,
): T[] {
  const n = items.length;
  if (n <= 2) return items.slice();

  // Sort defensively by time (callers usually already sort, but cheap to ensure).
  const sorted = items.slice().sort((a, b) => a.time - b.time);
  const out: T[] = [];

  for (let i = 0; i < n; i++) {
    const cur = sorted[i];
    out.push(cur);

    if (i === n - 1) break;

    const next = sorted[i + 1];
    const dt = next.time - cur.time;
    if (dt <= 0) continue; // duplicate time — skip insertion

    // Number of samples to insert between cur and next.
    // - At least 1 if dt > maxGapMs (to keep the device's linear interpolation
    //   from looking angular on long manual segments).
    // - Capped at 32 per segment to bound CPU on extremely long gaps.
    const steps = Math.min(32, Math.max(1, Math.ceil(dt / maxGapMs) - 1));
    if (steps <= 0) continue;

    // Catmull-Rom needs the previous (P0) and next-next (P3) control points.
    // For endpoints, mirror the segment vector (extrapolate the tangent).
    const p0 = i > 0 ? sorted[i - 1] : cur;
    const p1 = cur;
    const p2 = next;
    const p3 = i < n - 2 ? sorted[i + 2] : next;

    const t1 = p1.time, t2 = p2.time;
    const y0 = getPosition(p0), y1 = getPosition(p1), y2 = getPosition(p2), y3 = getPosition(p3);

    for (let s = 1; s <= steps; s++) {
      const u = s / (steps + 1); // 0 < u < 1 between p1 and p2
      const t = t1 + u * (t2 - t1);

      // Catmull-Rom (centripetal would be nicer, but uniform is fine for
      // haptic position values which are bounded 0-100). Standard formula:
      //   q(t) = 0.5 * (
      //     (2*P1) +
      //     (-P0 + P2) * u +
      //     (2*P0 - 5*P1 + 4*P2 - P3) * u^2 +
      //     (-P0 + 3*P1 - 3*P2 + P3) * u^3
      //   )
      // We compute the POSITION via spline; TIME is linear-interpolated
      // because time is the independent axis and should remain uniform.
      const pos = 0.5 * (
        2 * y1 +
        (-y0 + y2) * u +
        (2 * y0 - 5 * y1 + 4 * y2 - y3) * u * u +
        (-y0 + 3 * y1 - 3 * y2 + y3) * u * u * u
      );

      // Build a synthetic item of the same shape. We spread the original
      // item's enumerable fields so callers that carry metadata (e.g.
      // confidence, frame index) get sensible defaults on inserted points.
      const synthetic = {
        ...cur,
        time: Math.round(t),
        position: Math.max(0, Math.min(100, Math.round(pos))),
      } as unknown as T;

      // If T carries a `position` field, the spread above already set it;
      // if T is a {kf, position} pair (the shape used in handleTrackingToHaptic),
      // the position field overrides correctly. Either way, we leave the
      // synthetic kf as the previous one — haptic keyframe generation only
      // uses the inserted sample's time/position, not the source kf.
      out.push(synthetic);
    }
  }

  // Final defensive sort (inserted samples are already in order, but cheap)
  out.sort((a, b) => a.time - b.time);
  return out;
}

// ── SVG path helpers (mini-waveform display) ───────────

/**
 * Build an SVG path 'd' string that draws a smooth curve through the given
 * points using Catmull-Rom-to-Bezier conversion. Used for the mini-waveform
 * preview in tracking/haptic track headers so sparse manual data doesn't look
 * like a few straight segments.
 *
 * `points` are in SVG user coordinates (already scaled to viewBox).
 * Returns a path string starting with 'M x,y' followed by C bezier commands.
 *
 * For 0 points → ''; 1 point → 'M x,y'; 2+ points → smooth Catmull-Rom path
 * through all of them with endpoint tangent extrapolation.
 */
export function catmullRomPathD(points: Array<{ x: number; y: number }>): string {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M ${points[0].x},${points[0].y}`;
  if (n === 2) {
    return `M ${points[0].x},${points[0].y} L ${points[1].x},${points[1].y}`;
  }

  // Catmull-Rom spline → cubic Bezier conversion.
  // For each segment (i, i+1), the Bezier control points are:
  //   c1 = P_i + (P_{i+1} - P_{i-1}) / 6
  //   c2 = P_{i+1} - (P_{i+2} - P_i) / 6
  // Endpoints use P_0 and P_{n-1} as their "phantom" neighbors (tangent
  // extrapolation), which keeps the curve smooth at the boundaries without
  // overshooting.
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(n - 1, i + 2)];

    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
  }
  return d;
}

