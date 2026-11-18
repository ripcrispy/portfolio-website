import { WebGLRenderer } from 'three';
import { OutputPipeline, PS2_LINES } from './output';
import { TIERS, type Tier } from './quality';
import type { World } from './world';

export type VideoMode = 'composite' | 'component';

/** Max output pixels for the composite look (≈1600×900); it's soft, so upscaling is invisible. */
const COMPOSITE_PIXELS = 1600 * 900;

/**
 * WebGL renderer + output pipeline + resize handling.
 *
 * Cost is bounded by a fixed pixel budget rather than the screen: a 4K display renders the same
 * number of pixels as a ~1080p one and the browser upscales the canvas.
 */
export class Stage {
  readonly renderer: WebGLRenderer;
  private output = new OutputPipeline();
  private tier: Tier = 'medium';
  private video: VideoMode = 'composite';
  private w = 0;
  private h = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private world: World,
  ) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false, // the screen only receives one full-screen image; MSAA lives on the scene target
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
      depth: false,
    });
    this.renderer.setClearColor(0x000000, 1);
    addEventListener('resize', () => this.resize());
  }

  setTier(tier: Tier) {
    this.tier = tier;
    this.world.setTier(tier);
    document.documentElement.classList.remove('q-high', 'q-medium', 'q-low');
    document.documentElement.classList.add(`q-${tier}`);
    this.resize(true);
  }

  setVideo(mode: VideoMode) {
    this.video = mode;
    this.resize(true);
  }

  resize(force = false) {
    // The canvas is sized with 100lvh in CSS, so mobile toolbar show/hide doesn't cause resizes.
    const w = this.canvas.clientWidth || innerWidth;
    const h = this.canvas.clientHeight || innerHeight;
    if (!force && w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;

    const composite = this.video === 'composite';
    const tier = TIERS[this.tier];
    const budget = composite ? COMPOSITE_PIXELS : tier.pixels;
    const dpr = Math.min(devicePixelRatio || 1, tier.dprCap, Math.sqrt(budget / (w * h)));
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);

    if (composite) {
      const lines = Math.min(this.tier === 'low' ? 448 : PS2_LINES, h);
      this.output.setSize((lines * w) / h, lines, true, 0);
    } else {
      this.output.setSize(w * dpr, h * dpr, false, this.tier === 'high' ? 4 : 0);
    }
    this.world.resize(w, h);
  }

  render() {
    this.world.renderOffscreen(this.renderer);
    this.output.render(this.renderer, this.world.scene, this.world.camera);
  }
}
