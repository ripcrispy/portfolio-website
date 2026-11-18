import {
  BufferAttribute,
  BufferGeometry,
  Camera,
  LinearFilter,
  Mesh,
  Scene,
  SRGBColorSpace,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';

const triangleGeo = () => {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return geo;
};

/**
 * Internal render height. The PS2's native 448 lines looked too rough on modern screens,
 * so this sits a little higher: still soft and low-res, but not blocky.
 */
export const PS2_LINES = 576;

const vertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const fragment = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tGlow;
uniform vec2 uTexel;      // 1 / internal resolution
uniform float uScan;      // scanline strength
uniform float uComposite; // 1 = composite TV look, 0 = sharp component output
varying vec2 vUv;

vec3 toSRGB(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
const mat3 RGB2YIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
const mat3 YIQ2RGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);

float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

vec3 tap(vec2 o) { return texture2D(tScene, vUv + o * uTexel).rgb; }

void main() {
  vec3 c0 = tap(vec2(0.0));
  // framebuffer "glow" the way PS2 games faked bloom: a tiny blurred copy of the bright parts
  vec3 glow = texture2D(tGlow, vUv).rgb * 0.9;

  if (uComposite < 0.5) {
    // component: sharp 1:1 output + glow, with fine dithering
    vec3 s = toSRGB(c0 + glow * 0.75);
    s += (bayer4(gl_FragCoord.xy) - 0.5) / 255.0;
    gl_FragColor = vec4(s, 1.0);
    return;
  }

  vec3 l1 = tap(vec2(-1.0, 0.0)), r1 = tap(vec2(1.0, 0.0));
  vec3 l2 = tap(vec2(-2.0, 0.0)), r2 = tap(vec2(2.0, 0.0));
  vec3 up = tap(vec2(0.0, 1.0)), dn = tap(vec2(0.0, -1.0));

  // luma: slight horizontal softness + the PS2 flicker filter (vertical blend)
  vec3 luma = c0 * 0.7 + (l1 + r1) * 0.15;
  luma = mix(luma, (luma * 2.0 + up + dn) * 0.25, 0.3);
  // chroma: wider horizontal bleed, like a composite signal
  vec3 chroma = c0 * 0.4 + (l1 + r1) * 0.2 + (l2 + r2) * 0.1;

  vec3 yiq = RGB2YIQ * toSRGB(luma + glow);
  vec3 yiqC = RGB2YIQ * toSRGB(chroma + glow);
  yiq.yz = yiqC.yz * 1.06;                 // bled + slightly richer chroma
  vec3 s = clamp(YIQ2RGB * yiq, 0.0, 1.0);

  // CRT-ish grade: deeper blacks, gentle S-curve, a touch more blue
  s = clamp((s - 0.008) / 0.992, 0.0, 1.0);
  s = mix(s, s * s * (3.0 - 2.0 * s), 0.12);
  s.b = min(1.0, s.b * 1.02);

  // faint scanlines on the 448-line grid
  float row = fract(vUv.y / uTexel.y);
  s *= 1.0 - uScan * smoothstep(0.25, 0.5, abs(row - 0.5));

  // ordered dithering at internal resolution + mild colour-depth reduction
  float b = bayer4(floor(vUv / uTexel)) - 0.5;
  s = floor(s * 127.0 + 0.5 + b) / 127.0;

  gl_FragColor = vec4(s, 1.0);
}`;

/** Downsample + threshold + blur in one pass into a 1/8-size target (bilinear taps cover 2×2 each). */
const glowFragment = /* glsl */ `
uniform sampler2D tScene;
uniform vec2 uTexel;  // texel of the glow target
varying vec2 vUv;
void main() {
  vec3 acc = vec3(0.0);
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec3 c = texture2D(tScene, vUv + vec2(float(x), float(y)) * uTexel * 0.75).rgb;
      acc += max(c - 0.3, 0.0);
    }
  gl_FragColor = vec4(acc / 9.0, 1.0);
}`;

/**
 * The final image pipeline (used for every frame):
 *   scene → off-screen target → 1/8-size glow pass → output pass to the screen.
 *
 * "composite": the scene renders at a low PS2-like resolution, then is upscaled with composite-signal
 *   softness, chroma bleed, flicker filter, faint scanlines, a CRT grade and ordered dithering.
 * "component": the scene renders at the (budgeted) screen resolution and is output sharp.
 *
 * Both share the same cheap glow, replacing a heavyweight bloom post-process.
 */
export class OutputPipeline {
  private target: WebGLRenderTarget;
  private glowTarget: WebGLRenderTarget;
  private glowMaterial: ShaderMaterial;
  private glowScene = new Scene();
  private scene = new Scene();
  private camera = new Camera();
  private material: ShaderMaterial;

  constructor() {
    this.target = new WebGLRenderTarget(640, PS2_LINES, {
      // 8-bit sRGB storage: fast everywhere, and sRGB encoding keeps precision in the darks
      // (the GPU decodes back to linear when sampling).
      type: UnsignedByteType,
      colorSpace: SRGBColorSpace,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: true,
    });
    this.glowTarget = new WebGLRenderTarget(128, 72, {
      type: UnsignedByteType,
      colorSpace: SRGBColorSpace,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
    });
    this.glowMaterial = new ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: glowFragment,
      uniforms: { tScene: { value: this.target.texture }, uTexel: { value: new Vector2(1 / 128, 1 / 72) } },
      depthTest: false,
      depthWrite: false,
    });
    const glowQuad = new Mesh(triangleGeo(), this.glowMaterial);
    glowQuad.frustumCulled = false;
    this.glowScene.add(glowQuad);
    this.material = new ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        tScene: { value: this.target.texture },
        tGlow: { value: this.glowTarget.texture },
        uTexel: { value: new Vector2(1 / 640, 1 / PS2_LINES) },
        uScan: { value: 0.06 },
        uComposite: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new Mesh(triangleGeo(), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /**
   * @param width/height internal scene resolution in pixels
   * @param composite    TV look on/off
   * @param samples      MSAA samples for the scene target (0 = none)
   */
  setSize(width: number, height: number, composite: boolean, samples: number) {
    width = Math.max(1, Math.round(width));
    height = Math.max(1, Math.round(height));
    if (this.target.samples !== samples) {
      this.target.samples = samples;
      this.target.dispose(); // re-created with the new sample count on next render
    }
    this.target.setSize(width, height);
    this.material.uniforms.uTexel.value.set(1 / width, 1 / height);
    this.material.uniforms.uComposite.value = composite ? 1 : 0;
    // glow buffer stays roughly 120–240 px wide whatever the internal resolution
    const div = composite ? 8 : 8 * Math.max(1, Math.round(width / 1280));
    const gw = Math.max(1, Math.round(width / div)), gh = Math.max(1, Math.round(height / div));
    this.glowTarget.setSize(gw, gh);
    this.glowMaterial.uniforms.uTexel.value.set(1 / gw, 1 / gh);
  }

  render(renderer: WebGLRenderer, scene: Scene, camera: Camera) {
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(this.glowTarget);
    renderer.render(this.glowScene, this.camera);
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }
}
