import type { QualityPref } from '../scene/quality';

const pad = (n: number) => String(n).padStart(2, '0');

/** Top corner date + clock, like a console dashboard. */
export function startClock() {
  const date = document.getElementById('hud-date')!;
  const time = document.getElementById('hud-time')!;
  const glyph = document.getElementById('hud-glyph')!;
  const tick = () => {
    const d = new Date();
    const h = d.getHours();
    date.textContent = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
    time.textContent = `${h % 12 || 12}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${h < 12 ? 'AM' : 'PM'}`;
    glyph.textContent = h >= 6 && h < 18 ? '☀' : '☾';
    setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
  };
  tick();
}

import type { VideoMode } from '../scene/renderer';
export type { VideoMode };

interface OptionsHooks {
  pref: QualityPref;
  video: VideoMode;
  onQuality(pref: QualityPref): void;
  onVideo(mode: VideoMode): void;
  onReplay(): void;
}

/** △ Options popover: graphics quality + replay intro. Returns a status setter. */
export function initOptions(hooks: OptionsHooks) {
  const btn = document.getElementById('opt-btn') as HTMLButtonElement;
  const panel = document.getElementById('options')!;
  const status = document.getElementById('opt-status')!;
  const radios = panel.querySelectorAll<HTMLInputElement>('input[name="quality"]');
  radios.forEach((r) => {
    r.checked = r.value === hooks.pref;
    r.addEventListener('change', () => r.checked && hooks.onQuality(r.value as QualityPref));
  });

  panel.querySelectorAll<HTMLInputElement>('input[name="video"]').forEach((r) => {
    r.checked = r.value === hooks.video;
    r.addEventListener('change', () => r.checked && hooks.onVideo(r.value as VideoMode));
  });

  const toggle = (open: boolean) => {
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) panel.querySelector<HTMLInputElement>('input:checked')?.focus();
  };
  btn.addEventListener('click', () => toggle(panel.hidden));
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) {
      toggle(false);
      btn.focus();
    }
  });
  addEventListener('pointerdown', (e) => {
    if (!panel.hidden && !panel.contains(e.target as Node) && !btn.contains(e.target as Node)) toggle(false);
  });
  document.getElementById('opt-replay')!.addEventListener('click', () => {
    toggle(false);
    hooks.onReplay();
  });

  return (text: string) => {
    status.textContent = text;
  };
}

/** "Copy" buttons next to the email address. */
export function initCopyButtons() {
  document.querySelectorAll<HTMLButtonElement>('button[data-copy]').forEach((b) => {
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copy!);
        b.textContent = 'Copied ✓';
      } catch {
        b.textContent = 'Copy failed';
      }
      setTimeout(() => (b.textContent = 'Copy'), 1800);
    });
  });
}

const VIDEO_KEY = 'ps2p:video';
export function loadVideo(): VideoMode {
  const url = new URLSearchParams(location.search).get('video');
  if (url === 'composite' || url === 'component') return url;
  try {
    if (localStorage.getItem(VIDEO_KEY) === 'component') return 'component';
  } catch {
    /* storage unavailable */
  }
  return 'composite';
}
export function saveVideo(v: VideoMode) {
  try {
    localStorage.setItem(VIDEO_KEY, v);
  } catch {
    /* storage unavailable */
  }
}
