// ============================================
// Animated Frame Decoder — frame-exact scrubbing for webp/gif
// ============================================
//
// Uses the WebCodecs ImageDecoder API to decode animated WEBP/GIF files
// frame by frame (the browser's <img> cannot seek). This gives the sprite
// timeline editor a frame-accurate preview: given a time in ms, we find the
// matching frame index and render exactly that frame.
//
// Fallback: when ImageDecoder is unavailable (older Safari), the caller
// should keep using the legacy animated-preview behavior.

export interface FrameInfo {
  index: number;
  /** presentation timestamp in microseconds */
  timestamp: number;
  /** duration in microseconds */
  duration: number;
}

export class AnimatedFrameDecoder {
  private decoder: ImageDecoder | null = null;
  private frames: FrameInfo[] = [];
  private cache = new Map<number, ImageBitmap>();
  private w = 0;
  private h = 0;

  /** Feature detection */
  static isSupported(): boolean {
    return typeof window !== 'undefined' && typeof (window as unknown as { ImageDecoder?: unknown }).ImageDecoder !== 'undefined';
  }

  /** Load and index an animated image from a URL */
  async load(url: string): Promise<{
    frameCount: number;
    width: number;
    height: number;
    animated: boolean;
  }> {
    this.dispose();

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`No se pudo cargar ${url} (${resp.status})`);
    const data = await resp.arrayBuffer();

    const type = url.toLowerCase().endsWith('.gif') ? 'image/gif' : 'image/webp';
    this.decoder = new ImageDecoder({ data, type });
    await this.decoder.tracks.ready;

    const track = this.decoder.tracks.selectedTrack;
    if (!track) throw new Error('Pista de imagen no disponible');

    if (!track.animated || (track.frameCount ?? 0) <= 1) {
      this.w = 0; this.h = 0;
      return { frameCount: track.frameCount ?? 1, width: 0, height: 0, animated: false };
    }

    // Index all frames (timestamps + durations) — decoding is lazy afterwards
    this.frames = [];
    const count = track.frameCount ?? 0;
    for (let i = 0; i < count; i++) {
      // decode() is required to read timestamps; frames are usually cheap
      const result = await this.decoder.decode({ frameIndex: i });
      this.frames.push({
        index: i,
        timestamp: result.image.timestamp,
        duration: result.image.duration || 0,
      });
      result.image.close();
    }

    this.w = this.frames.length ? 1 : 0; // width/height read on first render
    return {
      frameCount: this.frames.length,
      width: this.w,
      height: this.h,
      animated: true,
    };
  }

  get frameCount(): number {
    return this.frames.length;
  }

  get animated(): boolean {
    return this.frames.length > 1;
  }

  /** Total duration in milliseconds */
  get durationMs(): number {
    if (this.frames.length === 0) return 0;
    const last = this.frames[this.frames.length - 1];
    return (last.timestamp + (last.duration || 0)) / 1000;
  }

  /** Find the frame index visible at a given time (ms) */
  frameIndexAtTime(timeMs: number): number {
    if (this.frames.length === 0) return 0;
    const tUs = timeMs * 1000;
    // Binary search over cumulative timestamps
    let lo = 0, hi = this.frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.frames[mid].timestamp + (this.frames[mid].duration || 0) <= tUs) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Timestamp (ms) of a frame index */
  frameTimeMs(index: number): number {
    if (index < 0 || index >= this.frames.length) return 0;
    return this.frames[index].timestamp / 1000;
  }

  /**
   * Render the frame at `timeMs` into a 2D canvas context.
   * Returns the rendered frame index (or -1 when not decodable).
   */
  async renderAt(ctx: CanvasRenderingContext2D, timeMs: number, canvasW: number, canvasH: number): Promise<number> {
    if (!this.decoder || this.frames.length === 0) return -1;
    const index = this.frameIndexAtTime(timeMs);

    let bitmap = this.cache.get(index);
    if (!bitmap) {
      const result = await this.decoder.decode({ frameIndex: index });
      bitmap = await createImageBitmap(result.image);
      result.image.close();
      // Simple cache policy: keep at most 30 frames
      if (this.cache.size >= 30) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey !== undefined) {
          this.cache.get(firstKey)?.close();
          this.cache.delete(firstKey);
        }
      }
      this.cache.set(index, bitmap);
    }

    // Fit into destination (object-contain)
    const scale = Math.min(canvasW / bitmap.width, canvasH / bitmap.height);
    const dw = bitmap.width * scale;
    const dh = bitmap.height * scale;
    const dx = (canvasW - dw) / 2;
    const dy = (canvasH - dh) / 2;
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.drawImage(bitmap, dx, dy, dw, dh);
    return index;
  }

  /**
   * Get an ImageBitmap of a frame (for trackers that need raw pixels).
   * NOTE: the caller must NOT close the returned bitmap (it's cached).
   */
  async getFrameBitmap(index: number): Promise<ImageBitmap | null> {
    if (!this.decoder || index < 0 || index >= this.frames.length) return null;
    let bitmap = this.cache.get(index);
    if (!bitmap) {
      const result = await this.decoder.decode({ frameIndex: index });
      bitmap = await createImageBitmap(result.image);
      result.image.close();
      this.cache.set(index, bitmap);
    }
    return bitmap;
  }

  dispose() {
    for (const bmp of this.cache.values()) bmp.close();
    this.cache.clear();
    this.frames = [];
    try { this.decoder?.close(); } catch { /* already closed */ }
    this.decoder = null;
  }
}
