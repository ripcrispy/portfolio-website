import type { WebGLRenderer } from 'three';

export type Tier = 'high' | 'medium' | 'low';
export type QualityPref = 'auto' | Tier;

export interface TierSettings {
  dprCap: number;
  /** Max rendered pixels in component mode, regardless of screen size or DPR. */
  pixels: number;
  towers: number;
  octaves: number;
}

export const TIERS: Record<Tier, TierSettings> = {
  high: { dprCap: 1.75, pixels: 1920 * 1200, towers: 110, octaves: 5 },
  medium: { dprCap: 1.25, pixels: 1600 * 900, towers: 85, octaves: 4 },
  low: { dprCap: 1, pixels: 1280 * 720, towers: 65, octaves: 3 },
};
export const MAX_TOWERS = TIERS.high.towers;

const ORDER: Tier[] = ['high', 'medium', 'low'];
export const lowerTier = (t: Tier): Tier | null => ORDER[ORDER.indexOf(t) + 1] ?? null;

const KEY = 'ps2p:quality';
export function loadPref(): QualityPref {
  const url = new URLSearchParams(location.search).get('q');
  if (url === 'auto' || url === 'high' || url === 'medium' || url === 'low') return url;
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'high' || v === 'medium' || v === 'low') return v;
  } catch {
    /* storage unavailable */
  }
  return 'auto';
}
export function savePref(p: QualityPref) {
  try {
    localStorage.setItem(KEY, p);
  } catch {
    /* storage unavailable */
  }
}

/** Cheap first guess at device capability; the FPS monitor corrects it at runtime. */
export function detectTier(renderer: WebGLRenderer): Tier {
  const gl = renderer.getContext();
  let gpu = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
  } catch {
    /* ignore */
  }
  if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpu)) return 'low';

  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency || 4;
  const mem = nav.deviceMemory ?? 8;
  const mobile = matchMedia('(pointer: coarse)').matches || /Mobi|Android/i.test(navigator.userAgent);

  if (mobile) return cores >= 8 && mem >= 6 ? 'medium' : 'low';
  if (cores <= 4 || mem <= 4) return 'medium';
  return 'high';
}

/** Averages frame time over ~1.25s windows and reports when the device is struggling. */
export class FpsMonitor {
  private acc = 0;
  private frames = 0;
  private grace = 1.5;
  lastFps = 60;

  reset(grace = 1.5) {
    this.acc = 0;
    this.frames = 0;
    this.grace = grace;
  }

  /** Returns true when the average FPS over the last window is too low. */
  sample(dt: number): boolean {
    if (dt > 0.25) return false; // tab switch / hitch: ignore
    if (this.grace > 0) {
      this.grace -= dt;
      return false;
    }
    this.acc += dt;
    this.frames++;
    if (this.acc < 1.25) return false;
    this.lastFps = this.frames / this.acc;
    this.acc = 0;
    this.frames = 0;
    return this.lastFps < 45;
  }
}
