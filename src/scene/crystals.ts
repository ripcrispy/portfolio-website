import {
  Vector3,
  AdditiveBlending,
  BoxGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  type Texture,
} from 'three';
import { clamp, damp } from '../util/tween';

const vertex = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vLocal;   // object-space position (the cube spans -0.5..0.5)
varying vec3 vLocalN;  // object-space normal (which face we're on)
varying vec3 vViewPos;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  vLocal = position;
  vLocalN = normal;
  gl_Position = projectionMatrix * mv;
}`;

const fragment = /* glsl */ `
uniform float uActive;
uniform float uOpacity;
uniform vec3 uTint;
uniform float uRed;   // 0 = blue menu glass, 1 = dark-red "insert disc" glass
uniform vec3 uCoreView; // the glowing red core, in view space
varying vec3 vN;
varying vec3 vV;
varying vec3 vLocal;
varying vec3 vLocalN;
varying vec3 vViewPos;

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(vV);
  float facing = abs(dot(N, V));
  float f = pow(1.0 - facing, 1.6);

  // ---- blue menu glass: reflective, like polished crystal ----
  vec3 anB = abs(vLocalN);
  vec2 uvB = anB.x > 0.5 ? vLocal.yz : anB.y > 0.5 ? vLocal.xz : vLocal.xy;
  float edgeB = 0.5 - max(abs(uvB.x), abs(uvB.y));
  float borderB = smoothstep(0.08, 0.0, edgeB) * 0.5 + smoothstep(0.012, 0.0, edgeB) * 0.5;
  vec3 RB = reflect(-V, N);
  // reflected environment: bright cyan-white "sky" above, the deep blue nebula below
  // a crisp horizon makes the reflection read as a mirror: dark nebula below, a bright band
  // at the horizon, and a softer glow above, all sliding across the faces as the cube turns
  float hz = RB.y + (RB.x * 0.25);
  vec3 envB = mix(vec3(0.004, 0.01, 0.045), vec3(0.16, 0.26, 0.6), smoothstep(-0.04, 0.06, hz))
    + vec3(0.6, 0.78, 1.0) * exp(-hz * hz * 60.0) * 0.9
    + vec3(0.25, 0.35, 0.7) * smoothstep(0.4, 1.0, hz);
  // two soft lights (key above-left, fill right) give highlights that slide as the cubes spin
  float nh1 = max(dot(N, normalize(normalize(vec3(-0.4, 0.8, 0.45)) + V)), 0.0);
  float nh2 = max(dot(N, normalize(normalize(vec3(0.7, -0.1, 0.7)) + V)), 0.0);
  float specB = pow(nh1, 80.0) * 1.4 + pow(nh1, 12.0) * 0.15 + pow(nh2, 50.0) * 0.5;
  // diagonal sheen streak across each face, moving with the viewing angle
  float streak = smoothstep(0.18, 0.0, abs(RB.x * 0.7 + RB.y * 0.7 + (uvB.x - uvB.y) * 0.6 - 0.15));

  vec3 base = mix(vec3(0.05, 0.07, 0.14), uTint, 0.2 + 0.4 * uActive);
  vec3 col = base * (0.18 + facing * 0.18)
    + envB * mix(0.35, 0.95, f)                         // reflection, stronger at grazing angles
    + vec3(0.55, 0.72, 1.0) * f * (0.25 + uActive * 0.3) // fresnel rim
    + vec3(0.5, 0.65, 1.0) * borderB * (0.28 + uActive * 0.2)
    + vec3(0.7, 0.82, 1.0) * streak * 0.1
    + vec3(1.0) * specB;
  float envL = dot(envB, vec3(0.3, 0.5, 0.2));
  float a = clamp(0.3 + f * 0.4 + uActive * 0.1 + envL * 0.5 + specB * 0.6 + borderB * 0.15 + streak * 0.08, 0.0, 0.95);

  // ---- red "insert disc" glass block ----
  if (uRed > 0.001) {
    // where on the face are we? distance to the face's border (0 at the edge, 0.5 at the centre)
    vec3 an = abs(vLocalN);
    vec2 uv = an.x > 0.5 ? vLocal.yz : an.y > 0.5 ? vLocal.xz : vLocal.xy;
    float edgeDist = 0.5 - max(abs(uv.x), abs(uv.y));
    // light caught in the glass's thickness: a soft bright border plus a crisp inner line
    float border = smoothstep(0.1, 0.0, edgeDist) * 0.6 + smoothstep(0.015, 0.0, edgeDist) * 0.4;

    // reflection of the smoky room: lit, pinkish-grey above; dark maroon below
    vec3 R = reflect(-V, N);
    // (all colours below are linear and derived from the reference frames: the cubes are a dark
    //  brownish red, roughly sRGB (60, 31, 29), with green ≈ blue, never pink)
    vec3 env = mix(vec3(0.004, 0.0011, 0.001), vec3(0.06, 0.015, 0.013), smoothstep(-0.35, 0.85, R.y));

    // glossy sheen from a soft key light above-left, sliding across faces as the cubes tumble
    vec3 L = normalize(vec3(-0.35, 0.8, 0.5));
    float nh = max(dot(N, normalize(L + V)), 0.0);
    float spec = pow(nh, 40.0) * 0.6 + pow(nh, 8.0) * 0.18;

    // the red core: faces turned toward it catch its light, and glossy faces reflect it
    vec3 toCore = uCoreView - vViewPos;
    float dCore = length(toCore);
    vec3 Lc = toCore / dCore;
    float atten = 1.0 / (1.0 + dCore * dCore * 0.35);
    float coreDiffuse = max(dot(N, Lc), 0.0) * atten;
    float coreSpec = pow(max(dot(N, normalize(Lc + V)), 0.0), 18.0) * atten;
    float coreRim = pow(1.0 - facing, 2.5) * smoothstep(-0.2, 0.6, dot(-N, Lc)) * atten; // backlit edges

    // a soft reflective gradient across each face (reflected smoke), shifting with the view
    float sweep = smoothstep(-0.9, 0.9, R.x * 0.6 + R.y * 0.8 + (uv.x - uv.y) * 0.5);

    float top = max(N.y, 0.0);
    // smoky maroon body with soft vertical shading across each face
    float vgrad = 0.75 + 0.5 * clamp(uv.y * (an.y > 0.5 ? 0.0 : 1.0), -0.5, 0.5);
    vec3 body = vec3(0.03, 0.0075, 0.0065) * (0.6 + facing * 0.4) * vgrad + vec3(0.016, 0.0045, 0.004) * top;
    vec3 coreCol = vec3(0.88, 0.074, 0.15);
    vec3 redCol = body
      + env * mix(0.3, 0.9, f)                    // reflected room, stronger at grazing angles
      + vec3(0.045, 0.013, 0.012) * sweep * (0.4 + f) // glossy gradient across the face
      + vec3(0.06, 0.022, 0.02) * border           // faint light in the glass's thickness
      + coreCol * (coreDiffuse * 0.025 + coreSpec * 0.22 + coreRim * 0.12)
      + vec3(0.3, 0.15, 0.14) * spec;              // soft key-light sheen
    // dense smoked glass: the bright core behind must only glimmer through, not wash the faces out
    redCol *= 0.72; // overall level matched to the reference frames (cube faces ≈ sRGB 60, 31, 29)
    float redA = clamp(0.86 + f * 0.08 + border * 0.04 + spec * 0.1 + coreSpec * 0.1, 0.0, 0.97);

    col = mix(col, redCol, uRed);
    a = mix(a, redA, uRed);
  }

  gl_FragColor = vec4(col, a * uOpacity);
  #include <colorspace_fragment>
}`;

interface Crystal {
  root: Group;
  shell: ShaderMaterial;
  edges: LineBasicMaterial;
  core: MeshBasicMaterial;
  active: number;
  spinX: number;
  spinY: number;
}

/**
 * The hub: a ring of glassy cubes (one per page section) around a circle of glowing dots.
 * Cheap fake-glass shader (fresnel), so it works on every GPU tier.
 */
export class Crystals {
  readonly group = new Group();
  readonly hitTargets: Mesh[] = [];
  private ring = new Group();
  private static DOTS = 8;
  private dotRing = new Group();
  private dots: { halo: Sprite; core: Sprite }[] = [];
  private lastU = 0;
  private burst = 0;
  private dotSpin = 0;
  private glow: Sprite;
  private items: Crystal[] = [];
  private angle = 0;
  private readonly n: number;
  private static R = 1.9;
  /** Red core light position in view space (set by World each frame). */
  readonly coreView = new Vector3();
  /** Red theme layout for the two remaining cubes: [x, y, z, scale] (ring-local units). */
  private static DISC: [number, number, number, number][] = [
    [-0.8, 0.6, 0.4, 1.85],
    [0.75, -0.85, -1.0, 1.45],
  ];

  constructor(count: number, glowTex: Texture) {
    this.n = count;
    this.group.add(this.ring);
    this.ring.rotation.x = -0.32;

    const box = new BoxGeometry(1, 1, 1);
    const edgesGeo = new EdgesGeometry(box);
    const tint = new Color(0.32, 0.55, 1.0);

    for (let i = 0; i < count; i++) {
      const root = new Group();
      const shell = new ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        uniforms: { uActive: { value: 0 }, uOpacity: { value: 1 }, uTint: { value: tint }, uRed: { value: 0 }, uCoreView: { value: this.coreView } },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      });
      const mesh = new Mesh(box, shell);
      mesh.userData.index = i;
      const edges = new LineBasicMaterial({
        color: 0xdfe9ff,
        transparent: true,
        opacity: 0.4,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const core = new MeshBasicMaterial({
        color: tint,
        transparent: true,
        opacity: 0.2,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const coreMesh = new Mesh(box, core);
      coreMesh.scale.setScalar(0.42);
      root.add(mesh, new LineSegments(edgesGeo, edges), coreMesh);
      root.rotation.set(i * 0.7, i * 1.3, 0);
      this.ring.add(root);
      this.hitTargets.push(mesh);
      this.items.push({ root, shell, edges, core, active: 0, spinX: 0.3 + (i % 3) * 0.12, spinY: 0.45 + (i % 2) * 0.15 });
    }

    // ring of glowing orbs at the centre (individual sprites so each can pulse on its own)
    for (let i = 0; i < Crystals.DOTS; i++) {
      const halo = new Sprite(
        new SpriteMaterial({ map: glowTex, color: 0x6f95ff, transparent: true, blending: AdditiveBlending, depthWrite: false }),
      );
      const core = new Sprite(
        new SpriteMaterial({ map: glowTex, color: 0xeef4ff, transparent: true, blending: AdditiveBlending, depthWrite: false }),
      );
      this.dotRing.add(halo, core);
      this.dots.push({ halo, core });
    }
    this.group.add(this.dotRing);
    this.glow = new Sprite(
      new SpriteMaterial({ map: glowTex, color: 0x4a74ff, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false }),
    );
    this.glow.scale.setScalar(3.2);
    this.group.add(this.glow);
  }

  /**
   * @param u      continuous section position (0..n-1), drives which crystal is "selected"
   * @param reveal 0..1 fade/scale in after the intro
   */
  private edgeBlue = new Color(0xdfe9ff);
  private edgeRed = new Color(0.55, 0.16, 0.2);
  private coreBlue = new Color(0.32, 0.55, 1.0);
  private coreRed = new Color(0.5, 0.05, 0.1);
  private glowBlue = new Color(0x4a74ff);
  private glowRed = new Color(0xff2a55);

  /** @param red 0..1 blend toward the dark-red "insert disc" look (Contact section) */
  update(dt: number, time: number, u: number, reveal: number, motion: number, red = 0) {
    const step = (Math.PI * 2) / this.n;
    // selected crystal sits on the left of the hub (toward the content column);
    // always turn the shortest way round the ring (e.g. first → last is one step, not four)
    const desired = Math.PI - u * step;
    const diff = ((((desired - this.angle) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.angle = damp(this.angle, this.angle + diff, 6, dt);

    this.items.forEach((c, i) => {
      const target = 1 - clamp(Math.abs(u - i));
      c.active = damp(c.active, target, 8, dt);
      const a = this.angle + i * step;
      // Red "insert disc" theme: only two large cubes remain (the last two crystals), drifting
      // as an overlapping pair beside the glowing core; the others fade away.
      const slot = i === this.n - 1 ? 0 : i === this.n - 2 ? 1 : -1;
      const ringX = Math.cos(a) * Crystals.R;
      const ringY = Math.sin(a) * Crystals.R;
      const fade = slot < 0 ? 1 - red : 1;
      let scale = (0.5 + c.active * 0.2 * (1 - red)) * reveal;
      if (slot >= 0) {
        const [dx, dy, dz, ds] = Crystals.DISC[slot];
        const drift = Math.sin(time * 0.25 + slot * 2) * 0.12;
        c.root.position.set(
          ringX + (dx + drift - ringX) * red,
          ringY + (dy - drift * 0.6 - ringY) * red,
          dz * red,
        );
        scale = scale + (ds * reveal - scale) * red;
      } else {
        c.root.position.set(ringX, ringY, 0);
        scale *= 1 - 0.4 * red;
      }
      const speed = (1 + c.active * 2.5 * (1 - red)) * motion * (1 - 0.85 * red);
      c.root.rotation.x += dt * c.spinX * speed;
      c.root.rotation.y += dt * c.spinY * speed;
      c.root.scale.setScalar(scale);
      c.shell.uniforms.uActive.value = c.active;
      c.shell.uniforms.uOpacity.value = reveal * fade;
      c.shell.uniforms.uRed.value = red;
      c.edges.color.lerpColors(this.edgeBlue, this.edgeRed, red);
      c.edges.opacity = (0.3 + c.active * 0.45) * reveal * fade * (1 - red);
      c.core.color.lerpColors(this.coreBlue, this.coreRed, red);
      c.core.opacity = (0.08 + c.active * 0.18) * reveal * fade * (1 - red);
    });

    // Orb ring: travelling brightness wave, gentle breathing, and an outward burst while scrolling
    const speed = Math.abs(u - this.lastU) / Math.max(dt, 1e-3);
    this.lastU = u;
    this.burst = damp(this.burst, clamp(speed * 0.6), speed > 0.05 ? 10 : 2.5, dt);
    this.dotSpin += dt * (0.35 + this.burst * 2.2) * motion;
    this.dotRing.rotation.z = -this.dotSpin;
    const breathe = Math.sin(time * 1.1) * 0.04 * motion;
    const radius = (0.58 + breathe + this.burst * 0.35) * (0.6 + 0.4 * reveal);
    this.dots.forEach((d, i) => {
      const a = (i / Crystals.DOTS) * Math.PI * 2;
      // wave of light running around the ring, plus a little per-orb flicker
      const wave = 0.5 + 0.5 * Math.sin(a * 1 - time * 3.2 * motion);
      const flicker = 0.9 + 0.1 * Math.sin(time * 7.3 + i * 2.1);
      const z = Math.sin(time * 1.6 + i) * 0.05;
      d.halo.position.set(Math.cos(a) * radius, Math.sin(a) * radius, z);
      d.core.position.copy(d.halo.position);
      d.halo.scale.setScalar(0.32 + wave * 0.28 + this.burst * 0.2);
      d.core.scale.setScalar((0.1 + wave * 0.09) * flicker);
      d.halo.material.opacity = (0.35 + wave * 0.5) * reveal * (1 - red);
      d.core.material.opacity = (0.6 + wave * 0.4) * flicker * reveal * (1 - red);
    });
    this.glow.material.color.lerpColors(this.glowBlue, this.glowRed, red);
    this.glow.material.opacity = (0.35 + 0.2 * reveal + Math.sin(time * 1.3) * 0.05) * (1 + this.burst * 0.6) * (1 - 0.95 * red);
  }
}
