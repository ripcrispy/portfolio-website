import {
  BoxGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector2,
  Vector3,
} from 'three';
import { clamp, easeInOutCubic, easeOutCubic, mulberry32, smoothstep } from '../util/tween';
import { towerTexture } from './textures';

const Z = new Vector3(0, 0, 1);

/**
 * The intro's tower field: one InstancedMesh (a single draw call) of grid-aligned prisms that all
 * point at the camera. Each tower flies in from the depths, then flies off past the camera when the
 * intro hands over to the dashboard.
 *
 * Shading (patched into a Lambert material):
 *  - sides tile the panel texture once per unit of length → "stacked cubes" look
 *  - per-tower brightness and texture rotation, so no two towers look copy-pasted
 *  - sides fade from bright at the front edge to dark down their length
 *  - fog turns from black into blue haze near the glowing centre of the screen
 */
export class Towers {
  readonly group = new Group();
  readonly mesh: InstancedMesh;
  readonly material: MeshLambertMaterial;
  readonly uniforms = {
    uCenter: { value: new Vector2() },
    uAspect: { value: 1 },
    uHaze: { value: 1 },
    uHazeColor: { value: new Color(0.025, 0.06, 0.24) },
  };
  private readonly max: number;
  private fieldPos: Float32Array;
  private fieldLen: Float32Array;
  private awayPos: Float32Array;
  private awayQuat: Float32Array;
  private delay: Float32Array;
  private fieldCount = 0;
  private tierCount = 0;
  private fade: InstancedBufferAttribute;
  private last = { rise: -1, morph: -1, count: -1 };

  private m = new Matrix4();
  private p = new Vector3();
  private s = new Vector3();
  private q = new Quaternion();
  private qa = new Quaternion();
  private qb = new Quaternion();

  constructor(max: number) {
    this.max = max;
    const rnd = mulberry32(1337);
    this.fieldPos = new Float32Array(max * 3);
    this.fieldLen = new Float32Array(max);
    this.awayPos = new Float32Array(max * 3);
    this.awayQuat = new Float32Array(max * 4);
    this.delay = new Float32Array(max);

    // ---- field layout: sparse grid, every front face at its own depth ----
    // Outer towers loom close, inner ones recede, leaving a dark tunnel through the middle.
    const taken = new Set<string>();
    let placed = 0;
    const place = (x: number, y: number, front: number) => {
      const id = `${x},${y}`;
      const dist = Math.hypot(x, y * 1.35);
      if (taken.has(id) || dist < 3.4 || Math.abs(x) > 13 || Math.abs(y) > 9 || placed >= max) return false;
      taken.add(id);
      const len = 9 + rnd() * 12;
      this.fieldPos.set([x, y, front - len / 2], placed * 3);
      this.fieldLen[placed] = len;
      // inner towers arrive first, outer ones last
      this.delay[placed] = Math.min(1, dist / 14) * 0.7 + rnd() * 0.3;
      placed++;
      return true;
    };
    let guard = 0;
    while (placed < max && guard++ < 5000) {
      const x = Math.round((rnd() * 2 - 1) * 13);
      const y = Math.round((rnd() * 2 - 1) * 9);
      const dist = Math.hypot(x, y * 1.35);
      const front = -16 + dist * 1.15 + (rnd() - 0.5) * 5;
      if (!place(x, y, front)) continue;
      // small clusters of adjacent towers, each stepped to a different depth
      const extra = rnd() < 0.75 ? 2 + Math.floor(rnd() * 5) : 0;
      let cx = x, cy = y, cf = front;
      for (let e = 0; e < extra; e++) {
        const side = Math.floor(rnd() * 4);
        cx += side === 0 ? 1 : side === 1 ? -1 : 0;
        cy += side === 2 ? 1 : side === 3 ? -1 : 0;
        cf += (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 1.8);
        place(cx, cy, cf);
      }
    }
    this.fieldCount = placed;

    // ---- exit layout: every tower flies outward past the camera ----
    const d = new Vector3();
    for (let i = 0; i < max; i++) {
      const x = this.fieldPos[i * 3], y = this.fieldPos[i * 3 + 1];
      d.set(x, y, 6 + rnd() * 6).normalize();
      const r = 40 + rnd() * 30;
      this.awayPos.set([d.x * r, d.y * r, d.z * r], i * 3);
      this.q.setFromUnitVectors(Z, d);
      this.awayQuat.set([this.q.x, this.q.y, this.q.z, this.q.w], i * 4);
    }

    this.material = new MeshLambertMaterial({ map: towerTexture() });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          varying float vSide;
          varying float vFromFront;
          varying float vRand;
          varying vec4 vClip;
          attribute float aFade;
          varying float vFade;
          varying vec3 vShade;
          float h11(float n) { return fract(sin(n * 127.1) * 43758.5453); }`,
        )
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
          {
            vFade = aFade;
            float len = length(instanceMatrix[2].xyz);
            float id = float(gl_InstanceID);
            vRand = h11(id);
            // Per-tower shade: nearer front faces are brighter, plus random variation and a
            // cool tint on some towers, so depth reads clearly as they fly at the screen.
            float frontZ = instanceMatrix[3].z + len * 0.5;          // world z of the front face
            float nearT = clamp((frontZ + 13.0) / 15.0, 0.0, 1.0);   // 0 = deep, 1 = closest
            float base = mix(0.45, 1.0, nearT * nearT * (3.0 - 2.0 * nearT));
            // Two populations, like the original: ~1/3 charcoal towers among bright ones.
            float pick = h11(id + 2.9);
            float rnd = pick < 0.34
              ? mix(0.05, 0.15, pick / 0.34)
              : mix(0.8, 1.28, (pick - 0.34) / 0.66);
            float cool = h11(id + 7.7);
            vShade = base * rnd * mix(vec3(1.0), vec3(0.86, 0.92, 1.08), cool);
            vec3 an = abs(normal);
            vSide = an.z > 0.5 ? 0.0 : 1.0;
            vFromFront = (0.5 - position.z) * len;
            vec2 tuv;
            if (an.z > 0.5) {
              // front face: one panel, randomly rotated per tower
              tuv = position.xy + 0.5;
              float r = floor(h11(id + 5.3) * 4.0);
              if (r == 1.0) tuv = vec2(1.0 - tuv.y, tuv.x);
              else if (r == 2.0) tuv = 1.0 - tuv;
              else if (r == 3.0) tuv = vec2(tuv.y, 1.0 - tuv.x);
            } else {
              // sides: one panel per unit of length, seams aligned to the front edge
              float across = an.x > 0.5 ? position.y + 0.5 : position.x + 0.5;
              tuv = vec2(across, vFromFront);
              if (h11(id + 9.1) > 0.5) tuv.x = 1.0 - tuv.x;
            }
            vMapUv = tuv;
          }`,
        )
        .replace('#include <project_vertex>', '#include <project_vertex>\nvClip = gl_Position;');

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform vec2 uCenter;
          uniform float uAspect;
          uniform float uHaze;
          uniform vec3 uHazeColor;
          varying float vSide;
          varying float vFromFront;
          varying float vRand;
          varying vec4 vClip;
          varying float vFade;
          varying vec3 vShade;`,
        )
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          {
            float grad = mix(1.0, mix(0.3, 1.0, exp(-vFromFront * 0.13)), vSide);
            diffuseColor.rgb *= grad * mix(1.0, 0.86, vSide) * vShade;
          }`,
        )
        .replace(
          '#include <fog_fragment>',
          `{
            vec2 ndc = vClip.xy / vClip.w;
            vec2 c = uCenter;
            ndc.x *= uAspect;
            c.x *= uAspect;
            float haze = exp(-dot(ndc - c, ndc - c) * 2.6) * uHaze;
            #ifdef USE_FOG
              float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
              gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(fogColor, uHazeColor, haze), fogFactor);
            #endif
            gl_FragColor.rgb += uHazeColor * haze * 0.25 * (1.0 - vSide * 0.5);
            gl_FragColor.a *= vFade;
          }`,
        );
    };

    const geo = new BoxGeometry(1, 1, 1);
    this.fade = new InstancedBufferAttribute(new Float32Array(max), 1);
    this.fade.setUsage(DynamicDrawUsage);
    geo.setAttribute('aFade', this.fade);
    this.mesh = new InstancedMesh(geo, this.material, max);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }

  setCount(n: number) {
    this.tierCount = Math.max(1, Math.min(n, this.fieldCount || this.max));
    this.mesh.count = this.tierCount;
  }

  /** Screen-space centre of the glow (NDC) so the haze follows the hub. */
  setHaze(cx: number, cy: number, aspect: number, strength: number) {
    this.uniforms.uCenter.value.set(cx, cy);
    this.uniforms.uAspect.value = aspect;
    this.uniforms.uHaze.value = strength;
  }

  /**
   * @param rise  0..1 intro fly-in progress
   * @param morph 0..1 towers fly off as the dashboard takes over
   */
  update(rise: number, morph: number) {
    this.mesh.visible = morph < 1;
    if (!this.mesh.visible) return;
    // alpha blending only while towers are fading in; opaque (cheaper, no sorting) afterwards
    this.material.transparent = rise < 1;
    const count = (this.mesh.count = this.tierCount);
    if (rise === this.last.rise && morph === this.last.morph && count === this.last.count) return;
    this.last = { rise, morph, count };

    const { fieldPos: fp, awayPos: ap, awayQuat: aq } = this;
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const dl = this.delay[i];
      // each tower: fade in at a nearer starting depth first, then glide forward into place
      const tl = clamp(rise * 1.6 - dl * 0.6);
      const fade = smoothstep(0, 0.3, tl);
      const ri = easeOutCubic(clamp((tl - 0.2) / 0.8));
      (this.fade.array as Float32Array)[i] = fade;
      // outer towers leave first so the tunnel opens up toward the camera
      const mi = easeInOutCubic(clamp((morph * 1.6 - (1 - dl) * 0.6) / 1.0));
      const fz = fp[i3 + 2] - (1 - ri) * 32;
      this.p.set(fp[i3] + (ap[i3] - fp[i3]) * mi, fp[i3 + 1] + (ap[i3 + 1] - fp[i3 + 1]) * mi, fz + (ap[i3 + 2] - fz) * mi);
      this.qa.identity();
      this.qb.set(aq[i * 4], aq[i * 4 + 1], aq[i * 4 + 2], aq[i * 4 + 3]);
      this.q.slerpQuaternions(this.qa, this.qb, mi * 0.3);
      const shrink = (1 - mi) * (fade > 0 ? 1 : 0); // not yet visible → zero size (skipped by the GPU)
      this.s.set(0.97 * shrink, 0.97 * shrink, this.fieldLen[i] * shrink + 0.001);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.fade.needsUpdate = true;
  }
}
