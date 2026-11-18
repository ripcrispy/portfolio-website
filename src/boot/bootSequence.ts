import { clamp, smoothstep } from '../util/tween';

export type BootMode = 'full' | 'short' | 'none';

/** Everything the scene needs to know about intro progress (all 0..1). */
export interface BootState {
  nebula: number;
  rise: number;
  drift: number;
  morph: number;
  cam: number;
  name: number;
  ui: number;
}

const DURATION: Record<BootMode, number> = { full: 7.4, short: 1.4, none: 0 };
const SEEN_KEY = 'ps2p:booted';

export function pickBootMode(reducedMotion: boolean): BootMode {
  const params = new URLSearchParams(location.search);
  if (params.has('boot')) return 'full';
  if (reducedMotion) return 'none';
  try {
    if (localStorage.getItem(SEEN_KEY)) return 'short';
  } catch {
    /* storage unavailable */
  }
  // Deep links (e.g. /#projects) shouldn't sit through the long intro.
  return location.hash ? 'short' : 'full';
}

function stateAt(mode: BootMode, t: number): BootState {
  if (mode === 'full') {
    return {
      nebula: smoothstep(0.3, 2.4, t),
      rise: clamp((t - 1.5) / 2.6),
      drift: smoothstep(1.2, 6, t),
      name: smoothstep(3.3, 4.2, t) * (1 - smoothstep(5.5, 6.1, t)),
      morph: smoothstep(5.5, 7.2, t),
      cam: smoothstep(5.4, 7.3, t),
      ui: smoothstep(6.5, 7.4, t),
    };
  }
  if (mode === 'short') {
    return { nebula: smoothstep(0, 0.9, t), rise: 1, drift: 1, name: 0, morph: 1, cam: 1, ui: smoothstep(0.3, 1.4, t) };
  }
  return { nebula: 1, rise: 1, drift: 1, name: 0, morph: 1, cam: 1, ui: 1 };
}

/**
 * Time-based intro controller. State is a pure function of time, so skipping just
 * fast-forwards the clock and the transition stays smooth.
 */
export class Boot {
  private t = 0;
  private speed = 1;
  private mode: BootMode;
  private revealed = false;
  done = false;
  private root = document.documentElement;
  private el = document.getElementById('boot')!;
  private title = this.el.querySelector<HTMLElement>('.boot-title')!;
  private onSkip = (e: Event) => {
    if (e instanceof KeyboardEvent && ['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;
    this.skip();
  };

  constructor(mode: BootMode) {
    this.mode = mode;
    this.start(mode);
  }

  start(mode: BootMode) {
    this.mode = mode;
    this.t = 0;
    this.speed = 1;
    this.done = false;
    this.revealed = false;
    if (mode === 'none') {
      this.finish();
      return;
    }
    this.root.classList.add('booting');
    this.root.classList.remove('show-skip');
    scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    for (const ev of ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const)
      addEventListener(ev, this.onSkip, { passive: true });
  }

  skip() {
    if (this.done) return;
    this.speed = this.mode === 'full' ? 7 : 3;
  }

  update(dt: number): BootState {
    if (this.done) return stateAt('none', 0);
    this.t += dt * this.speed;
    const s = stateAt(this.mode, this.t);

    if (this.mode === 'full' && this.t > 0.6) this.root.classList.add('show-skip');
    this.title.style.opacity = String(s.name);
    this.title.style.transform = `scale(${0.96 + s.name * 0.04})`;

    // Reveal the page content while the camera is still settling.
    if (!this.revealed && s.ui > 0) {
      this.revealed = true;
      this.root.classList.remove('booting');
    }
    if (this.t >= DURATION[this.mode]) this.finish();
    return s;
  }

  private finish() {
    this.done = true;
    this.root.classList.remove('booting', 'show-skip');
    for (const ev of ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const)
      removeEventListener(ev, this.onSkip);
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* storage unavailable */
    }
  }
}
