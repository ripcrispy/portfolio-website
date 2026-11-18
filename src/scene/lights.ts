import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Line,
  LineBasicMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Texture,
} from 'three';
import { lerp } from '../util/tween';

const TRAIL = 48;

interface Orb {
  color: Color;
  sprite: Sprite;
  line: Line;
  pos: Float32Array;
  phase: number;
  speed: number;
  tilt: number;
}

/** Three coloured light motes that orbit the hub, each dragging a fading trail. */
export class Lights {
  /** Index of the red light, which becomes the Contact core. */
  private static CORE = 1;
  /** Measured from the reference: an intense red-pink, ≈ sRGB (241, 77, 108). */
  private static CORE_COLOR = new Color().setRGB(0.88, 0.074, 0.15);
  readonly core = new Vector3();
  readonly group = new Group();
  private orbs: Orb[] = [];
  private v = new Vector3();
  private primed = false;

  constructor(glowTex: Texture) {
    const colors = [0x4dff7a, 0xff3b3b, 0x9b6bff];
    colors.forEach((hex, k) => {
      const color = new Color(hex);
      const sprite = new Sprite(
        new SpriteMaterial({ map: glowTex, color, blending: AdditiveBlending, depthWrite: false, transparent: true }),
      );
      sprite.scale.setScalar(0.55);

      const pos = new Float32Array(TRAIL * 3);
      const col = new Float32Array(TRAIL * 3);
      for (let i = 0; i < TRAIL; i++) {
        const f = Math.pow(1 - i / TRAIL, 1.6) * 0.9;
        col.set([color.r * f, color.g * f, color.b * f], i * 3);
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(pos, 3));
      geo.setAttribute('color', new BufferAttribute(col, 3));
      const line = new Line(
        geo,
        new LineBasicMaterial({ vertexColors: true, blending: AdditiveBlending, transparent: true, depthWrite: false }),
      );
      line.frustumCulled = false;
      this.group.add(sprite, line);
      this.orbs.push({ color, sprite, line, pos, phase: k * 2.1, speed: 0.55 + k * 0.13, tilt: (k - 1) * 0.6 });
    });
  }

  /** @param spread 1 = wide intro orbit, 0 = tight orbit around the hub */
  /**
   * @param red 0..1 Contact "insert disc" theme: the red light flies into the middle of the two
   *            cubes and becomes the scene's intense red core; the other lights fade away.
   */
  update(time: number, spread: number, opacity: number, motion: number, red = 0) {
    const R = lerp(2.7, 6.5, spread);
    this.orbs.forEach((o, k) => {
      const t = time * o.speed * (0.4 + 0.6 * motion) + o.phase;
      this.v.set(
        Math.cos(t) * R,
        Math.sin(t * 1.27 + o.tilt) * R * 0.62,
        Math.sin(t * 0.73 + o.tilt) * R * 0.45 + spread * 2,
      );
      const isCore = k === Lights.CORE;
      if (isCore && red > 0) {
        // settle between the cubes with a slow, gentle wobble
        const e = red * red * (3 - 2 * red);
        this.core.set(Math.sin(time * 0.6) * 0.08, -0.12 + Math.cos(time * 0.45) * 0.06, -0.25);
        this.v.lerp(this.core, e);
        const pulse = 1 + Math.sin(time * 1.7) * 0.05 * motion;
        o.sprite.scale.setScalar((0.55 + 2.6 * e) * pulse);
        o.sprite.material.color.lerpColors(o.color, Lights.CORE_COLOR, e);
        o.sprite.material.opacity = Math.max(opacity * (1 - red), 0.95 * e);
      } else {
        o.sprite.scale.setScalar(0.55);
        if (isCore) o.sprite.material.color.copy(o.color);
        o.sprite.material.opacity = opacity * (1 - red);
      }
      o.sprite.position.copy(this.v);

      const p = o.pos;
      if (!this.primed) for (let i = 0; i < TRAIL; i++) p.set([this.v.x, this.v.y, this.v.z], i * 3);
      p.copyWithin(3, 0, (TRAIL - 1) * 3);
      p[0] = this.v.x;
      p[1] = this.v.y;
      p[2] = this.v.z;
      (o.line.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
      (o.line.material as LineBasicMaterial).opacity = opacity * (1 - red);
    });
    this.primed = true;
  }
}
