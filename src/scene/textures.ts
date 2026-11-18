import { CanvasTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace } from 'three';
import { mulberry32 } from '../util/tween';

const canvas = (size: number) => {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!] as const;
};

/** Soft radial glow used by sprites and points. */
export function glowTexture() {
  const [c, g] = canvas(64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.8)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/**
 * Grainy, static-like panel texture for the towers (procedural, no image download):
 * bright blue-white noise with a faint bevel and a subtle cross of panel lines.
 */
export function towerTexture() {
  // Smooth, softly-lit panel with only a very fine, low-contrast grain (it should read as
  // dithering, not as a rough surface), plus a faint seam where stacked cubes meet.
  const size = 128;
  const [c, g] = canvas(size);
  const img = g.createImageData(size, size);
  const rnd = mulberry32(7);
  for (let i = 0; i < size * size; i++) {
    const x = i % size;
    const y = (i / size) | 0;
    const grain = (rnd() - 0.5) * 11; // fine, faint
    // very gentle falloff toward the panel edges, like soft Gouraud shading
    const ex = Math.min(x, size - 1 - x) / (size / 2);
    const ey = Math.min(y, size - 1 - y) / (size / 2);
    const soft = (Math.min(ex, ey) - 1) * 6;
    const v = 214 + grain + soft;
    img.data[i * 4] = v - 6;
    img.data[i * 4 + 1] = v - 1;
    img.data[i * 4 + 2] = v + 9;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // faint seams: soft highlight on top/left, soft shadow on bottom/right
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.fillRect(0, 0, size, 2);
  g.fillRect(0, 0, 2, size);
  g.fillStyle = 'rgba(30,38,60,0.28)';
  g.fillRect(0, size - 2, size, 2);
  g.fillRect(size - 2, 0, 2, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 4; // keeps the long, grazing-angle sides smooth instead of shimmering
  return t;
}
