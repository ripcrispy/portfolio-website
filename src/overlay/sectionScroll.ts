import { damp, easeInOutCubic } from '../util/tween';

/**
 * Smooth, fight-free scrolling for mouse wheels, trackpads and the keyboard.
 *
 * One engine owns every wheel-driven movement: a single target position and a single animation
 * loop. (Letting the browser's own smooth scrolling run alongside our glides made the two fight
 * on aggressive scrolling, which showed up as jitter and wiggle.)
 *
 *  - Section changes: one wheel notch / swipe glides to the next or previous section.
 *  - Sections taller than the screen: the wheel scrolls freely (eased) until their edge,
 *    then the next scroll glides on.
 *  - Trackpad momentum after a glide is absorbed so one swipe never skips two sections.
 *  - Scrollbar drags, arrow keys, find-in-page etc. still work; the engine just re-syncs.
 *  - Jumps (crystal clicks, menu links): a neighbouring section glides; a distant one "warps":
 *    the content fades/slides out in the direction of travel, the page jumps, and the new
 *    section slides in, while the camera takes a direct arc (see onJump) instead of passing
 *    through every section in between.
 * Touch screens keep native scrolling (with CSS proximity snapping).
 */
export function initSectionScroll(reducedMotion: MediaQueryList) {
  const root = document.documentElement;

  // ---- layout cache (re-measured on resize / content changes, never per frame) ----
  let tops: number[] = [];
  let maxScroll = 0;
  const measure = () => {
    const y = scrollY;
    tops = [...document.querySelectorAll<HTMLElement>('[data-station]')].map((s) =>
      Math.round(s.getBoundingClientRect().top + y),
    );
    maxScroll = Math.max(0, root.scrollHeight - innerHeight);
  };
  measure();
  addEventListener('resize', measure);
  new ResizeObserver(measure).observe(document.body);
  const clampY = (y: number) => Math.max(0, Math.min(maxScroll, y));

  // ---- the single animator ----
  let current = scrollY; // where we've put the page
  let target = scrollY; // where the page is heading
  let glide: { from: number; to: number; t0: number; dur: number } | null = null;
  let raf = 0;
  let lastFrame = 0;
  let settleUntil = 0; // swallow momentum wheel events until this time
  let lastWheel = 0;
  let warpUntil = 0; // input is ignored while a warp transition plays
  let onJump: ((from: number, to: number) => void) | null = null;
  const main = document.querySelector('main') as HTMLElement;

  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - lastFrame) / 1000 || 0.016);
    lastFrame = now;
    if (glide) {
      const t = glide.dur ? Math.min(1, (now - glide.t0) / glide.dur) : 1;
      current = glide.from + (glide.to - glide.from) * easeInOutCubic(t);
      if (t >= 1) {
        current = target = glide.to;
        glide = null;
        settleUntil = now + 900;
      }
    } else {
      current = reducedMotion.matches ? target : damp(current, target, 14, dt);
      if (Math.abs(target - current) < 0.5) current = target;
    }
    scrollTo(0, current);
    raf = glide || current !== target ? requestAnimationFrame(tick) : 0;
  };
  const run = () => {
    if (!raf) {
      lastFrame = performance.now();
      raf = requestAnimationFrame(tick);
    }
  };

  const glideTo = (y: number) => {
    measure();
    y = clampY(y);
    if (Math.abs(y - current) < 1) return;
    const dur = reducedMotion.matches ? 0 : Math.min(1100, 650 + Math.abs(y - current) * 0.15);
    glide = { from: current, to: y, t0: performance.now(), dur };
    target = y;
    run();
  };

  // Something other than the engine moved the page (scrollbar drag, arrow keys, find-in-page…):
  // adopt the new position instead of fighting it.
  addEventListener(
    'scroll',
    () => {
      if (Math.abs(scrollY - current) > 2) {
        cancelAnimationFrame(raf);
        raf = 0;
        glide = null;
        current = target = scrollY;
      }
    },
    { passive: true },
  );

  /** Section index containing position y (biased so a section top counts as that section). */
  const sectionAt = (y: number) => {
    let i = 0;
    while (i < tops.length - 1 && y + 2 >= tops[i + 1]) i++;
    return i;
  };

  /** Apply a scroll intent of `delta` px from the current target. */
  /**
   * A section only counts as "tall" (free scrolling inside it) if it overhangs the screen by a
   * meaningful amount; otherwise a few stray pixels would swallow a whole wheel notch.
   */
  const minOverhang = () => innerHeight * 0.15;

  /** Apply a scroll intent of `delta` px from the current target. */
  const scrollIntent = (delta: number) => {
    const i = sectionAt(target);
    const top = tops[i] ?? 0;
    const end = i < tops.length - 1 ? tops[i + 1] : maxScroll + innerHeight; // bottom edge of section i
    const lastScreen = Math.max(top, end - innerHeight); // where the section's last screen starts

    if (delta > 0) {
      if (lastScreen - target > minOverhang()) {
        // free, eased scrolling inside a tall section, stopping exactly at its last screen
        target = Math.min(target + delta, lastScreen);
        run();
      } else if (i < tops.length - 1) glideTo(tops[i + 1]);
      else if (target < lastScreen) glideTo(lastScreen);
    } else {
      if (target - top > minOverhang()) {
        target = Math.max(target + delta, top);
        run();
      } else if (target > top + 1) glideTo(top);
      else if (i > 0) {
        // entering the previous section from below: land on its last screen if it's really tall
        const prevTop = tops[i - 1];
        const prevLast = top - innerHeight;
        glideTo(prevLast - prevTop > minOverhang() ? prevLast : prevTop);
      }
    }
  };

  addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || root.classList.contains('booting') || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault(); // the engine handles every vertical wheel event
      const now = performance.now();
      const gap = now - lastWheel;
      lastWheel = now;

      if (glide || now < warpUntil) {
        settleUntil = now + 900;
        return;
      }
      // Swallow trackpad momentum after a glide while the event stream stays continuous.
      // A fresh gesture (after a short pause) works normally.
      if (now < settleUntil && gap < 180) {
        settleUntil = now + 200;
        return;
      }
      settleUntil = 0;

      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1);
      if (delta) scrollIntent(delta);
    },
    { passive: false },
  );

  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || root.classList.contains('booting')) return;
    const el = e.target as HTMLElement;
    if (el.closest('input, textarea, select, button, [contenteditable]')) return;
    const down = e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey);
    const up = e.key === 'PageUp' || (e.key === ' ' && e.shiftKey);
    if (!down && !up) return;
    e.preventDefault();
    if (!glide && performance.now() >= warpUntil) scrollIntent(down ? innerHeight * 0.85 : -innerHeight * 0.85);
  });

  /**
   * Go to section `to`. Neighbours glide (the content really is right there); distant sections
   * warp so the page never races past unrelated content and the camera never zig-zags.
   */
  const jumpTo = (to: number) => {
    measure();
    const now = performance.now();
    if (to < 0 || to >= tops.length || glide || now < warpUntil) return;
    const from = sectionAt(current);
    const dest = tops[to];
    if (to === from && Math.abs(current - dest) < 2) return;

    onJump?.(from, to);
    if (Math.abs(to - from) <= 1 || reducedMotion.matches) {
      if (reducedMotion.matches) {
        cancelAnimationFrame(raf);
        raf = 0;
        current = target = dest;
        scrollTo(0, dest);
      } else glideTo(dest);
      return;
    }

    // Warp: out (slide against travel) → jump → in (slide from the direction of travel).
    const dir = Math.sign(to - from);
    const OUT_MS = 230;
    const IN_MS = 520;
    warpUntil = now + OUT_MS + IN_MS;
    cancelAnimationFrame(raf);
    raf = 0;
    glide = null;
    root.style.setProperty('--warp-y', `${-dir * 28}px`);
    root.classList.add('warping');
    setTimeout(() => {
      current = target = dest;
      scrollTo(0, dest);
      // place the incoming content on the far side without animating, then let it slide in
      root.classList.add('warp-snap');
      root.style.setProperty('--warp-y', `${dir * 28}px`);
      void main.offsetHeight;
      root.classList.remove('warp-snap');
      root.classList.add('warp-in');
      root.classList.remove('warping');
      setTimeout(() => root.classList.remove('warp-in'), IN_MS);
    }, OUT_MS);
  };

  // In-page links (menu tiles, bottom bar) use the same section transitions.
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
    if (!a || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const el = document.getElementById(a.hash.slice(1));
    if (!el) return;
    e.preventDefault();
    history.replaceState(null, '', a.hash);
    const idx = [...document.querySelectorAll('[data-station]')].indexOf(el);
    if (idx >= 0) jumpTo(idx);
    else glideTo(Math.round(el.getBoundingClientRect().top + scrollY));
  });

  return {
    glideTo,
    jumpTo,
    /** Called at the start of every jump so the 3D camera can take a direct route. */
    setJumpHandler(fn: (from: number, to: number) => void) {
      onJump = fn;
    },
  };
}
