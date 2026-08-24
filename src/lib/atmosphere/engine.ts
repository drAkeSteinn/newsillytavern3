// ============================================
// Atmosphere Particle Engine — professional canvas particles
// ============================================
//
// A single requestAnimationFrame loop per canvas layer with:
//   - devicePixelRatio-aware crisp rendering
//   - delta-time physics (frame-rate independent)
//   - depth-based parallax (near = bigger + faster + more opaque, far = smaller
//     + slower + fainter, mimicking depth of field)
//   - gusty wind (low-frequency sin noise, not constant drift)
//   - additive layer compositing where it matters (glow)
//
// Effects:
//   rain    — 3 depth bands of gradient streaks + ground splashes (arcs) +
//             subtle wind-bent streaks via velocity vector
//   snow    — soft round flakes with depth (far = blurred via radial halo),
//             sinusoidal sway per-flake, slow tumble, gusts
//   fireflies — wandering drift with pulsing glow (radial gradient, additive)
//   embers  — upward drift with turbulence + flicker + warm glow
//   leaves  — tumbling ellipses with flutter (speed varies with rotation)
//   dust    — floating motes with soft fade in/out

export type EffectKind = 'rain' | 'snow' | 'fireflies' | 'embers' | 'leaves' | 'dust';

export interface EngineOptions {
  kind: EffectKind;
  /** 0..1 base density multiplier */
  intensity: number;
  /** overall opacity 0..1 */
  opacity: number;
  /** speed multiplier */
  speed: number;
  /** base wind px/s */
  wind: number;
  color?: string;
  colorSecondary?: string;
  /** 'quality' | 'balanced' | 'performance' */
  performanceMode: 'quality' | 'balanced' | 'performance';
}

interface Particle {
  x: number;
  y: number;
  z: number;          // depth 0..1 (0 = far, 1 = near)
  vx: number;
  vy: number;
  size: number;
  life: number;       // normalized 0..1 remaining
  maxLife: number;
  seed: number;       // stable per-particle random for sway/twinkle
  rotation: number;
  rotationSpeed: number;
}

interface Splash {
  x: number;
  y: number;
  age: number;
  duration: number;
  size: number;
}

const PERF_SCALE: Record<EngineOptions['performanceMode'], number> = {
  quality: 1,
  balanced: 0.65,
  performance: 0.38,
};

// Cheap deterministic pseudo-random per particle
function rand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Convert #rrggbb / rgb() / rgba() to rgba() with the given alpha. */
function withAlpha(color: string | undefined, alpha: number, fallback: string): string {
  const fb = fallback.replace('%A', alpha.toFixed(3));
  if (!color) return fb;
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
    if (full.length === 6) {
      const r = parseInt(full.slice(0, 2), 16);
      const g = parseInt(full.slice(2, 4), 16);
      const b = parseInt(full.slice(4, 6), 16);
      return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
    }
  }
  if (color.startsWith('rgba')) {
    return color.replace(/[\d.]+\)$/, `${alpha.toFixed(3)})`);
  }
  if (color.startsWith('rgb')) {
    return color.replace(')', `, ${alpha.toFixed(3)})`).replace('rgb', 'rgba');
  }
  return fb;
}

export class AtmosphereEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private options: EngineOptions;
  private particles: Particle[] = [];
  private splashes: Splash[] = [];
  private raf = 0;
  private lastTime = 0;
  private time = 0;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private resizeObserver: ResizeObserver | null = null;
  private gustPhase = Math.random() * Math.PI * 2;

  constructor(canvas: HTMLCanvasElement, options: EngineOptions) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.options = options;
    this.resize();
  }

  setOptions(options: Partial<EngineOptions>) {
    const kindChanged = options.kind !== undefined && options.kind !== this.options.kind;
    this.options = { ...this.options, ...options };
    if (kindChanged) {
      this.populate();
    } else {
      const target = this.targetCount();
      if (Math.abs(target - this.particles.length) > target * 0.15) {
        this.populate();
      }
    }
  }

  start() {
    if (this.raf) return;
    this.lastTime = performance.now();
    const loop = (t: number) => {
      const dt = Math.min((t - this.lastTime) / 1000, 0.05);
      this.lastTime = t;
      this.time += dt;
      this.step(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  destroy() {
    this.stop();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  /** Observe size changes of the canvas element */
  observeResize() {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min((typeof window !== "undefined" && window.devicePixelRatio) || 1, 2);
    this.w = Math.max(1, Math.round(rect.width));
    this.h = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.populate();
  }

  private targetCount(): number {
    const { kind, intensity, performanceMode } = this.options;
    const areaScale = (this.w * this.h) / (1440 * 900);
    const clamp = (n: number) => Math.max(4, Math.round(n));
    switch (kind) {
      case 'rain':
        return clamp(150 * intensity * PERF_SCALE[performanceMode] * Math.min(1.6, Math.max(0.5, areaScale)));
      case 'snow':
        return clamp(100 * intensity * PERF_SCALE[performanceMode] * Math.min(1.6, Math.max(0.5, areaScale)));
      case 'fireflies':
        return clamp(24 * intensity * PERF_SCALE[performanceMode]);
      case 'embers':
        return clamp(32 * intensity * PERF_SCALE[performanceMode]);
      case 'leaves':
        return clamp(20 * intensity * PERF_SCALE[performanceMode] * Math.min(1.4, Math.max(0.6, areaScale)));
      case 'dust':
        return clamp(60 * intensity * PERF_SCALE[performanceMode]);
      default:
        return clamp(50 * intensity * PERF_SCALE[performanceMode]);
    }
  }

  private populate() {
    const count = this.targetCount();
    this.particles = [];
    for (let i = 0; i < count; i++) {
      this.particles.push(this.createParticle(true));
    }
    this.splashes = [];
  }

  private createParticle(scattered: boolean): Particle {
    const o = this.options;
    const seed = Math.random() * 10000;
    const z = Math.pow(Math.random(), 1.6);
    const scatteredY = scattered ? Math.random() * (this.h + 80) - 40 : -40 - Math.random() * this.h * 0.3;

    switch (o.kind) {
      case 'rain': {
        const speed = (900 + z * 900) * Math.max(0.2, o.speed);
        return {
          x: Math.random() * (this.w + 200) - 100,
          y: scatteredY,
          z,
          vx: o.wind * (0.4 + z * 0.8),
          vy: speed,
          size: 0.7 + z * 1.4,
          life: 1, maxLife: 1, seed,
          rotation: 0, rotationSpeed: 0,
        };
      }
      case 'snow': {
        const speed = (26 + z * 64) * Math.max(0.2, o.speed);
        return {
          x: Math.random() * this.w,
          y: scatteredY,
          z,
          vx: 0,
          vy: speed,
          size: 1.1 + z * 2.6,
          life: 1, maxLife: 1, seed,
          rotation: 0,
          rotationSpeed: (rand(seed) - 0.5) * 1.2,
        };
      }
      case 'fireflies': {
        return {
          x: Math.random() * this.w,
          y: Math.random() * this.h,
          z,
          vx: (rand(seed) - 0.5) * 22,
          vy: (rand(seed + 1) - 0.5) * 16,
          size: 1.2 + z * 1.6,
          life: 1, maxLife: 1, seed,
          rotation: 0, rotationSpeed: 0,
        };
      }
      case 'embers': {
        return {
          x: Math.random() * this.w,
          y: this.h + 10 + Math.random() * 40,
          z,
          vx: (rand(seed) - 0.5) * 18,
          vy: -(18 + z * 46) * Math.max(0.2, o.speed),
          size: 0.8 + z * 1.8,
          life: 1, maxLife: 6 + Math.random() * 5,
          seed,
          rotation: 0, rotationSpeed: 0,
        };
      }
      case 'leaves': {
        return {
          x: Math.random() * this.w,
          y: scatteredY,
          z,
          vx: 0,
          vy: (34 + z * 52) * Math.max(0.2, o.speed),
          size: 3 + z * 4.5,
          life: 1, maxLife: 1, seed,
          rotation: rand(seed) * Math.PI * 2,
          rotationSpeed: (rand(seed + 2) - 0.5) * 2.4,
        };
      }
      case 'dust':
      default: {
        return {
          x: Math.random() * this.w,
          y: Math.random() * this.h,
          z,
          vx: (rand(seed) - 0.5) * 10 + o.wind * 0.2,
          vy: -(2 + rand(seed + 1) * 6),
          size: 0.6 + z * 1.4,
          life: 1, maxLife: 8 + Math.random() * 6,
          seed,
          rotation: 0, rotationSpeed: 0,
        };
      }
    }
  }

  /** Current gust factor (-1..1), low-frequency noise */
  private gust(): number {
    return Math.sin(this.time * 0.23 + this.gustPhase) * 0.5
         + Math.sin(this.time * 0.07 + this.gustPhase * 2) * 0.5;
  }

  private step(dt: number) {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);

    const o = this.options;
    const gust = this.gust();
    const wind = o.wind + gust * Math.max(12, Math.abs(o.wind) * 1.6);

    for (const p of this.particles) {
      switch (o.kind) {
        case 'rain': {
          p.x += (p.vx + wind * (0.3 + p.z)) * dt;
          p.y += p.vy * dt;
          if (p.y > h - 2) {
            if (this.splashes.length < 60 && Math.random() < 0.5) {
              this.splashes.push({
                x: p.x, y: h - 2 - Math.random() * 6,
                age: 0, duration: 0.38 + Math.random() * 0.2,
                size: 2 + p.z * 5,
              });
            }
            this.resetParticle(p, false);
          }
          if (p.x < -60) p.x = w + 50; else if (p.x > w + 60) p.x = -50;
          break;
        }
        case 'snow': {
          const sway = Math.sin(this.time * (0.5 + rand(p.seed) * 0.9) + p.seed) * (8 + p.z * 22);
          p.x += (sway + wind * (0.25 + p.z * 0.5)) * dt;
          p.y += p.vy * dt;
          p.rotation += p.rotationSpeed * dt;
          if (p.y > h + 6) this.resetParticle(p, false);
          break;
        }
        case 'fireflies': {
          const t = this.time + p.seed;
          p.vx += Math.sin(t * 0.7) * 8 * dt + (Math.random() - 0.5) * 6 * dt;
          p.vy += Math.cos(t * 0.9) * 6 * dt + (Math.random() - 0.5) * 6 * dt;
          const maxV = 26;
          p.vx = Math.max(-maxV, Math.min(maxV, p.vx));
          p.vy = Math.max(-maxV, Math.min(maxV, p.vy));
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (p.x < -20) p.x = w + 20; else if (p.x > w + 20) p.x = -20;
          if (p.y < -20) p.y = h + 20; else if (p.y > h + 20) p.y = -20;
          break;
        }
        case 'embers': {
          const t = this.time + p.seed;
          p.x += (p.vx + Math.sin(t * 1.4) * 14 + wind * 0.25) * dt;
          p.y += p.vy * dt;
          p.life -= dt / p.maxLife;
          if (p.life <= 0 || p.y < -12) {
            p.life = 1;
            p.x = Math.random() * w;
            p.y = h + 10 + Math.random() * 30;
          }
          break;
        }
        case 'leaves': {
          const flutter = Math.sin(this.time * 1.3 + p.seed) * (26 + p.z * 40);
          p.x += (flutter + wind * (0.5 + p.z)) * dt;
          p.y += p.vy * (0.7 + 0.5 * Math.abs(Math.sin(p.rotation))) * dt;
          p.rotation += p.rotationSpeed * dt;
          if (p.y > h + 12 || p.x < -30 || p.x > w + 30) this.resetParticle(p, false);
          break;
        }
        case 'dust':
        default: {
          p.x += (p.vx + wind * 0.15) * dt;
          p.y += p.vy * dt;
          p.life -= dt / p.maxLife;
          if (p.life <= 0) {
            p.life = 1;
            p.x = Math.random() * w;
            p.y = Math.random() * h;
          }
          if (p.x < -10) p.x = w + 10; else if (p.x > w + 10) p.x = -10;
          break;
        }
      }
    }

    this.draw(wind);
  }

  private resetParticle(p: Particle, scattered: boolean) {
    Object.assign(p, this.createParticle(scattered));
  }

  private draw(wind: number) {
    const o = this.options;
    const baseAlpha = Math.max(0, Math.min(1, o.opacity));
    switch (o.kind) {
      case 'rain': this.drawRain(baseAlpha, wind); break;
      case 'snow': this.drawSnow(baseAlpha); break;
      case 'fireflies': this.drawFireflies(baseAlpha); break;
      case 'embers': this.drawEmbers(baseAlpha); break;
      case 'leaves': this.drawLeaves(baseAlpha); break;
      default: this.drawDust(baseAlpha); break;
    }
  }

  // ── Rain ─────────────────────────────────────────────
  private drawRain(baseAlpha: number, wind: number) {
    const { ctx } = this;
    const o = this.options;
    const fallback = 'rgba(174,194,224,%A)';

    ctx.lineCap = 'round';
    for (const p of this.particles) {
      const len = (10 + p.z * 26) * Math.max(0.2, o.speed);
      const alpha = (0.14 + p.z * 0.3) * baseAlpha;
      const dx = (p.vx + wind * (0.3 + p.z)) / Math.max(1, p.vy);
      ctx.strokeStyle = withAlpha(o.color, alpha, fallback);
      ctx.lineWidth = p.size;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - dx * len, p.y - len);
      ctx.stroke();
    }

    const alive: Splash[] = [];
    for (const s of this.splashes) {
      s.age += 1 / 60;
      if (s.age >= s.duration) continue;
      alive.push(s);
      const t = s.age / s.duration;
      const alpha = (1 - t) * 0.35 * baseAlpha;
      const r = s.size * (0.4 + t * 1.6);
      ctx.strokeStyle = withAlpha(o.color, alpha, fallback);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, r, r * 0.35, 0, Math.PI, Math.PI * 2);
      ctx.stroke();
    }
    this.splashes = alive;
  }

  // ── Snow ─────────────────────────────────────────────
  private drawSnow(baseAlpha: number) {
    const { ctx } = this;
    const o = this.options;
    const color = o.color || '#ffffff';
    const fb = 'rgba(255,255,255,%A)';

    for (const p of this.particles) {
      const alpha = (0.25 + p.z * 0.65) * baseAlpha;
      const r = p.size;

      if (p.z > 0.55) {
        ctx.fillStyle = withAlpha(color, alpha, fb);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2);
        g.addColorStop(0, withAlpha(color, alpha, fb));
        g.addColorStop(0.6, withAlpha(color, alpha * 0.45, fb));
        g.addColorStop(1, withAlpha(color, 0, fb));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ── Fireflies ────────────────────────────────────────
  private drawFireflies(baseAlpha: number) {
    const { ctx } = this;
    const o = this.options;
    const core = o.color || '#d9f99d';
    const glow = o.colorSecondary || '#a3e635';

    const prevComposite = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';

    for (const p of this.particles) {
      const pulse = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.time * (1.2 + rand(p.seed) * 1.6) + p.seed * 3));
      const alpha = pulse * (0.3 + p.z * 0.7) * baseAlpha;
      const r = p.size;

      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 5);
      g.addColorStop(0, withAlpha(core, alpha, 'rgba(217,249,157,%A)'));
      g.addColorStop(0.25, withAlpha(glow, alpha * 0.5, 'rgba(163,230,53,%A)'));
      g.addColorStop(1, withAlpha(glow, 0, 'rgba(163,230,53,%A)'));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = prevComposite;
  }

  // ── Embers ───────────────────────────────────────────
  private drawEmbers(baseAlpha: number) {
    const { ctx } = this;
    const o = this.options;
    const core = o.colorSecondary || '#fdba74';
    const glow = o.color || '#f97316';

    const prevComposite = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';

    for (const p of this.particles) {
      const fade = Math.max(0, Math.min(1, p.life * 2)) * Math.max(0, Math.min(1, (1 - p.life) * 4 + 0.2));
      const flicker = 0.75 + 0.25 * Math.sin(this.time * 9 + p.seed * 7);
      const alpha = fade * flicker * (0.3 + p.z * 0.6) * baseAlpha;
      const r = p.size;

      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 4);
      g.addColorStop(0, withAlpha(core, alpha, 'rgba(253,186,116,%A)'));
      g.addColorStop(0.4, withAlpha(glow, alpha * 0.55, 'rgba(249,115,22,%A)'));
      g.addColorStop(1, withAlpha(glow, 0, 'rgba(249,115,22,%A)'));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalCompositeOperation = prevComposite;
  }

  // ── Leaves ───────────────────────────────────────────
  private drawLeaves(baseAlpha: number) {
    const { ctx } = this;
    const o = this.options;
    const color = o.color || '#d97706';
    const color2 = o.colorSecondary || '#b45309';

    for (const p of this.particles) {
      const alpha = (0.35 + p.z * 0.55) * baseAlpha;
      const squash = 0.25 + 0.75 * Math.abs(Math.cos(p.rotation));
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.sin(p.rotation) * 0.6);
      ctx.fillStyle = withAlpha(rand(p.seed) > 0.5 ? color : color2, alpha, 'rgba(217,119,6,%A)');
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size * squash, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ── Dust ─────────────────────────────────────────────
  private drawDust(baseAlpha: number) {
    const { ctx } = this;
    const o = this.options;
    const color = o.color || '#e2e8f0';

    for (const p of this.particles) {
      const alpha = Math.sin(Math.min(1, p.life) * Math.PI) * (0.08 + p.z * 0.2) * baseAlpha;
      ctx.fillStyle = withAlpha(color, alpha, 'rgba(226,232,240,%A)');
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
