import { smoothstep } from '../util/tween';

/** Maps window scroll to a continuous section index, used to drive the camera. */
export class ScrollTracker {
  private tops: number[] = [];
  private maxScroll = 0;
  private sections: HTMLElement[];

  constructor(sections: HTMLElement[]) {
    this.sections = sections;
    this.measure();
    const ro = new ResizeObserver(() => this.measure());
    ro.observe(document.body);
    addEventListener('resize', () => this.measure());
  }

  measure() {
    const y = scrollY;
    this.tops = this.sections.map((s) => s.getBoundingClientRect().top + y);
    this.maxScroll = document.documentElement.scrollHeight - innerHeight;
  }

  /**
   * Continuous section position: exactly i when section i is snapped to the top of the screen,
   * and it blends to i+1 over the final screen-height of scrolling before the next section.
   */
  value(): number {
    const n = this.tops.length;
    if (!n) return 0;
    // (layout values are cached in measure(), so this never forces a layout per frame)
    if (scrollY >= this.maxScroll - 2) return n - 1;
    const y = scrollY + 1;
    let i = 0;
    while (i < n - 1 && y >= this.tops[i + 1]) i++;
    if (i === n - 1) return i;
    const span = Math.min(innerHeight, this.tops[i + 1] - this.tops[i]);
    const frac = (y - (this.tops[i + 1] - span)) / Math.max(1, span);
    return i + smoothstep(0, 1, frac);
  }
}
