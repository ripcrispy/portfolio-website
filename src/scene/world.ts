import {
  AmbientLight,
  DirectionalLight,
  FogExp2,
  PerspectiveCamera,
  PointLight,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three';
import type { BootState } from '../boot/bootSequence';
import { damp, lerp, smoothstep } from '../util/tween';
import { CameraPath, STATION_HUE } from './cameraPath';
import { Crystals } from './crystals';
import { Lights } from './lights';
import { Nebula } from './nebula';
import { TIERS, type Tier } from './quality';
import { glowTexture } from './textures';
import { Spokes } from './spokes';
import { Towers } from './towers';

const HUB = new Vector3(0, 0, 0);

/** Owns every 3D object and turns (intro state, scroll position) into a frame. */
export class World {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(50, 1, 0.1, 240);
  private nebula = new Nebula();
  private towers: Towers;
  private spokes = new Spokes();
  private crystals: Crystals;
  private lights: Lights;
  private path: CameraPath;
  private hubLight = new PointLight(0x4f7bff, 0, 40, 2);
  private sun = new DirectionalLight(0xffffff, 1.7);
  private ambient = new AmbientLight(0x56608a, 0.9);
  private fog = new FogExp2(0x000004, 0.018);
  private width = 1;
  private height = 1;
  private raycaster = new Raycaster();

  private camPos = new Vector3();
  /** 0..1 blend toward the Contact section's red "insert disc" theme. */
  red = 0;
  /** Direct camera move for jumps between distant sections (instead of following the path). */
  private jump: { from: Vector3; to: Vector3; t: number; dur: number } | null = null;
  private jumpTmp = new Vector3();
  private bootPos = new Vector3();
  private look = new Vector3();
  private ndc = new Vector3();

  constructor(sections: number, maxTowers: number) {
    const glow = glowTexture();
    this.towers = new Towers(maxTowers);
    this.crystals = new Crystals(sections, glow);
    this.lights = new Lights(glow);
    this.path = new CameraPath(sections);

    this.scene.fog = this.fog;
    this.sun.position.set(4, 6, 10);
    this.scene.add(
      this.nebula.mesh,
      this.ambient,
      this.sun,
      this.hubLight,
      this.towers.group,
      this.spokes.group,
      this.crystals.group,
      this.lights.group,
    );
  }

  setTier(tier: Tier) {
    const s = TIERS[tier];
    this.towers.setCount(s.towers);
    this.nebula.uniforms.uOctaves.value = s.octaves;
  }

  resize(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.camera.aspect = w / h;
    this.nebula.uniforms.uAspect.value = w / h;
    this.nebula.setSize(w, h);
    // Narrow (portrait) screens need a wider vertical FOV so the ring still fits.
    this.camera.fov = w / h < 0.8 ? 68 : 50;
    this.camera.updateProjectionMatrix();
  }

  get jumping() {
    return this.jump !== null;
  }

  /**
   * Start a direct camera move from the current viewpoint to section `to`'s viewpoint:
   * an arc around the hub with a slight pull-back, instead of passing every station between.
   */
  beginJump(to: number, duration = 1.15) {
    const from = this.jump ? this.jumpPos(this.jump, new Vector3()) : this.path.at(this.lastU, new Vector3());
    this.jump = { from, to: this.path.at(to, new Vector3()), t: 0, dur: duration };
  }

  private lastU = 0;

  private jumpPos(j: { from: Vector3; to: Vector3; t: number; dur: number }, out: Vector3) {
    const k = Math.min(1, j.t / j.dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; // easeInOutCubic
    const a = this.jumpTmp.copy(j.from).normalize();
    const b = out.copy(j.to).normalize();
    const angle = a.angleTo(b);
    if (angle > 1e-3) {
      const s = Math.sin(angle);
      const wa = Math.sin((1 - e) * angle) / s;
      const wb = Math.sin(e * angle) / s;
      out.set(a.x * wa + b.x * wb, a.y * wa + b.y * wb, a.z * wa + b.z * wb);
    }
    const dist = lerp(j.from.length(), j.to.length(), e) * (1 + 0.14 * Math.sin(Math.PI * e));
    return out.normalize().multiplyScalar(dist);
  }

  update(dt: number, time: number, boot: BootState, u: number, motion: number) {
    const cam = this.camera;

    // --- camera: intro dolly → scroll-driven path (or a direct arc while jumping) ---
    this.bootPos.set(0, 0, lerp(21, 14, boot.drift));
    this.lastU = u;
    if (this.jump) {
      this.jump.t += dt;
      this.jumpPos(this.jump, this.camPos);
      if (this.jump.t >= this.jump.dur) this.jump = null;
    } else {
      this.path.at(u, this.camPos);
    }
    const sway = motion * 0.25;
    this.camPos.x += Math.sin(time * 0.21) * sway;
    this.camPos.y += Math.sin(time * 0.17 + 1) * sway;
    cam.position.lerpVectors(this.bootPos, this.camPos, boot.cam);
    this.look.set(0, 0, lerp(-4, 0, boot.cam));
    cam.lookAt(this.look);

    // Shift the projection so the hub sits to the right of the content column on wide screens.
    // On phones, lift it into the space above the hero card instead.
    const wide = this.width > 900;
    const phone = this.width <= 600;
    const shiftX = wide ? -this.width * 0.2 * boot.cam : 0;
    const shiftY = phone ? this.height * 0.3 * boot.cam : 0;
    cam.setViewOffset(this.width, this.height, shiftX, shiftY, this.width, this.height);

    // --- nebula follows the hub on screen ---
    this.ndc.copy(HUB).project(cam);
    const n = this.nebula.uniforms;
    n.uTime.value = time;
    n.uIntensity.value = boot.nebula;
    n.uFocus.value = 1 - boot.morph;
    n.uCenter.value.set(this.ndc.x, this.ndc.y);
    const i = Math.min(STATION_HUE.length - 2, Math.floor(u));
    n.uHue.value = lerp(STATION_HUE[i], STATION_HUE[i + 1] ?? 0, u - i);

    this.towers.setHaze(this.ndc.x, this.ndc.y, this.width / this.height, 1 - boot.morph * 0.6);
    this.towers.update(boot.rise, boot.morph);
    // Contact theme: fades in over the last stretch toward the final section
    const last = this.path.count - 1;
    this.red = damp(this.red, smoothstep(last - 0.6, last, u), 3, dt);
    this.spokes.update(dt, time, smoothstep(0.45, 1, boot.morph) * (1 - this.red), motion);
    this.nebula.uniforms.uRed.value = this.red;
    this.lights.update(time, 1 - boot.morph, boot.nebula, motion, this.red);
    // the cubes reflect the red core light (Contact theme)
    cam.updateMatrixWorld();
    this.crystals.coreView.copy(this.lights.core).applyMatrix4(cam.matrixWorldInverse);
    this.crystals.update(dt, time, u, smoothstep(0.55, 1, boot.morph), motion, this.red);
    // Intro: dark scene lit from the glowing centre so towers fade into black at the edges.
    // Dashboard: brighter, flatter lighting for the spokes.
    const m = boot.morph;
    this.hubLight.color.setRGB(lerp(0.75, 0.31, m), lerp(0.8, 0.48, m), 1);
    this.hubLight.position.set(0, 0, lerp(-7, 0, m));
    this.hubLight.intensity = lerp(45, 28, m) * boot.nebula;
    // intro key light comes from just above the camera so tower faces read bright, sides darker
    this.sun.position.set(lerp(1.5, 4, m), lerp(2.5, 6, m), 10);
    // tuned so the brightest towers just reach white: per-tower shading must not clip
    this.sun.intensity = lerp(2.7, 1.7, m);
    this.ambient.intensity = lerp(0.45, 0.9, m);
    this.fog.density = lerp(0.036, 0.018, m);
  }

  /** Off-screen passes that must run before the main render. */
  renderOffscreen(renderer: WebGLRenderer) {
    this.nebula.render(renderer);
  }

  /** Returns the section index of the crystal under the pointer, or -1. */
  pick(clientX: number, clientY: number): number {
    const p = new Vector2((clientX / this.width) * 2 - 1, -(clientY / this.height) * 2 + 1);
    this.raycaster.setFromCamera(p, this.camera);
    const hit = this.raycaster.intersectObjects(this.crystals.hitTargets, false)[0];
    return hit ? (hit.object.userData.index as number) : -1;
  }
}
