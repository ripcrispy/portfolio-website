import './overlay/style.css';
import { Boot, pickBootMode, type BootState } from './boot/bootSequence';
import content from './content.json';
import { fetchRepos } from './content';
import { initCopyButtons, initOptions, loadVideo, saveVideo, startClock } from './overlay/hud';
import { initSectionScroll } from './overlay/sectionScroll';
import { esc, repoCards } from './overlay/render';
import { FpsMonitor, MAX_TOWERS, detectTier, loadPref, lowerTier, savePref, type QualityPref, type Tier } from './scene/quality';
import { ScrollTracker } from './overlay/scroll';
import type { Content } from './types';
import { damp } from './util/tween';

const data = content as Content;
const root = document.documentElement;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

startClock();
const sectionScroll = initSectionScroll(reducedMotion);
initCopyButtons();
loadRepos();
initActivity();


start().catch((err) => {
  console.warn('3D scene unavailable, falling back to static background.', err);
  root.classList.add('no-webgl');
  root.classList.remove('booting');
});

async function start() {
  if (!webglAvailable()) throw new Error('WebGL not supported');

  // Three.js is split into its own chunk so the text content paints before it downloads.
  const [{ World }, { Stage }] = await Promise.all([import('./scene/world'), import('./scene/renderer')]);

  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const sections = [...document.querySelectorAll<HTMLElement>('[data-station]')];
  const world = new World(sections.length, MAX_TOWERS);
  const stage = new Stage(canvas, world);
  const scroll = new ScrollTracker(sections);

  // ---- quality ----
  let pref: QualityPref = loadPref();
  let tier: Tier = pref === 'auto' ? detectTier(stage.renderer) : pref;
  const fps = new FpsMonitor();
  const video = loadVideo();
  stage.setVideo(video);
  const setStatus = initOptions({
    pref,
    video,
    onVideo(v) {
      saveVideo(v);
      stage.setVideo(v);
    },
    onQuality(p) {
      pref = p;
      savePref(p);
      applyTier(p === 'auto' ? detectTier(stage.renderer) : p);
    },
    onReplay() {
      boot.start('full');
    },
  });
  const applyTier = (t: Tier) => {
    tier = t;
    fps.reset();
    void stage.setTier(t);
    setStatus(`Running: ${t[0].toUpperCase()}${t.slice(1)}${pref === 'auto' ? ' (auto)' : ''}`);
  };
  applyTier(tier);

  // ---- crystals are clickable shortcuts to sections ----
  canvas.addEventListener('click', (e) => {
    const i = world.pick(e.clientX, e.clientY);
    if (i >= 0) sectionScroll.jumpTo(i);
  });
  // Distant jumps: the camera takes a direct arc and the crystal ring turns straight to the
  // destination, rather than following scroll through every section in between.
  let jumpTarget = -1;
  sectionScroll.setJumpHandler((from, to) => {
    if (Math.abs(to - from) <= 1) return; // neighbours: the normal scroll-driven path is ideal
    jumpTarget = to;
    world.beginJump(to, reducedMotion.matches ? 0.35 : 1.15);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    canvas.style.cursor = world.pick(e.clientX, e.clientY) >= 0 ? 'pointer' : '';
  });

  const hubLabel = initHubLabel(sectionScroll.jumpTo, sections.length);

  let discTheme = false;

  // ---- main loop ----
  const boot = new Boot(pickBootMode(reducedMotion.matches));
  let u = scroll.value();
  let time = 0;
  let last = performance.now();

  // Cap at ~60 fps: on 120/144 Hz monitors this halves GPU work, and the scene is slow-moving
  // enough that the difference isn't visible.
  const MIN_FRAME_MS = (1000 / 60) * 0.8;
  const frame = (now: number) => {
    if (now - last < MIN_FRAME_MS) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const motion = reducedMotion.matches ? 0.2 : 1;
    time += dt * motion;

    const state: BootState = boot.update(dt);
    if (world.jumping) u = jumpTarget;
    else u = damp(u, scroll.value(), reducedMotion.matches ? 20 : 3.2, dt);
    world.update(dt, time, state, u, motion);
    hubLabel?.setActive(world.jumping ? jumpTarget : Math.round(u));
    // Contact section: switch the page to the red "insert disc" palette alongside the 3D
    const disc = world.red > 0.5;
    if (disc !== discTheme) root.classList.toggle('disc-theme', (discTheme = disc));
    stage.render();

    // Step down a tier if the device can't keep up (auto mode only, after the intro).
    // Runs during the intro too: the first seconds are the first impression.
    if (pref === 'auto' && fps.sample(dt)) {
      const next = lowerTier(tier);
      if (next) applyTier(next);
    }
  };

  stage.resize(true);
  // Compile shaders up front so the intro doesn't stutter on its first frames.
  try {
    await stage.renderer.compileAsync(world.scene, world.camera);
  } catch {
    /* older browsers: shaders compile lazily on first render */
  }
  last = performance.now();
  stage.renderer.setAnimationLoop(frame);

  // Pause rendering entirely while the tab is hidden.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stage.renderer.setAnimationLoop(null);
    else {
      last = performance.now();
      fps.reset(1);
      stage.renderer.setAnimationLoop(frame);
    }
  });

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    stage.renderer.setAnimationLoop(null);
    root.classList.add('no-webgl');
    root.classList.remove('booting');
  });
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function loadRepos() {
  const el = document.getElementById('repos');
  // Normally the repos were baked into the page at build time; only fetch if they weren't.
  if (!el || el.hasAttribute('data-baked')) return;
  try {
    const repos = await fetchRepos(data);
    el.innerHTML = repos.length
      ? repoCards(repos)
      : `<p class="loading" style="animation:none">No public repositories to show yet.</p>`;
  } catch {
    const url = `https://github.com/${encodeURIComponent(data.github.user)}`;
    el.innerHTML = `<p class="loading" style="animation:none">My latest repositories live on GitHub.
      <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Browse them at @${esc(data.github.user)} ▸</a></p>`;
  } finally {
    el.setAttribute('aria-busy', 'false');
  }
}

/** Activity graph: open on the most recent weeks (phones scroll sideways) and light up on view. */
function initActivity() {
  const panel = document.querySelector<HTMLElement>('.activity');
  if (!panel) return;
  const scroller = panel.querySelector<HTMLElement>('.activity-scroll');
  if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  if (reducedMotion.matches || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        panel.classList.add('on');
        io.disconnect();
      }
    },
    { threshold: 0.35 },
  );
  io.observe(panel);
}

/**
 * PS2-style text beside the crystal hub: shows the active section (its position is static CSS),
 * and its ▲▼ arrows step between sections.
 */
function initHubLabel(jumpTo: (i: number) => void, count: number) {
  const el = document.getElementById('hub-label');
  if (!el) return null;
  const items = [...el.querySelectorAll<HTMLElement>('.hl-item')];
  const [up, down] = [...el.querySelectorAll<HTMLButtonElement>('.hl-arrow')];
  let active = 0;
  up.disabled = true;
  el.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.hl-arrow');
    if (b && !b.disabled) jumpTo(active + Number(b.dataset.dir));
  });
  return {
    setActive(index: number) {
      const i = Math.max(0, Math.min(count - 1, index));
      if (i === active || !items[i]) return;
      const dir = Math.sign(i - active); // +1 = scrolling down, -1 = up
      const prev = items[active];
      const next = items[i];
      // outgoing text moves away against the scroll (up when scrolling down)
      prev.style.setProperty('--y', `${-dir * 16}px`);
      prev.classList.remove('on');
      // incoming text starts on the scroll side (below when scrolling down) and slides into place
      next.classList.add('snap');
      next.style.setProperty('--y', `${dir * 16}px`);
      void next.offsetHeight;
      next.classList.remove('snap');
      next.classList.add('on');
      active = i;
      up.disabled = i === 0;
      down.disabled = i === count - 1;
    },
  };
}
