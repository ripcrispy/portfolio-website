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

const vertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const fragment = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uAspect;
uniform float uHue;
uniform float uFocus;
uniform float uRed;
uniform vec2 uCenter;
uniform int uOctaves;
varying vec2 vUv;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= uOctaves) break;
    v += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  p.x *= uAspect;
  vec2 c = uCenter;
  c.x *= uAspect;
  vec2 d = p - c;
  float r = length(d);
  float t = uTime * 0.035;

  // slow swirl: rotate the domain more strongly near the centre
  float ang = 0.55 / (0.35 + r) + t * 0.6;
  float ca = cos(ang), sa = sin(ang);
  vec2 sd = mat2(ca, -sa, sa, ca) * d;

  // domain-warped clouds + finer wisps stretched around the centre
  vec2 q = vec2(fbm(sd * 1.3 + vec2(t, -t * 0.6)), fbm(sd * 1.3 - vec2(t * 0.8, -t) + 3.1));
  float n = fbm(sd * 1.7 + q * 1.8 + vec2(t * 0.4, -t * 0.7));
  vec2 tang = vec2(-sd.y, sd.x) / max(r, 0.05);
  float w = fbm(sd * 3.2 + tang * 0.6 - q + 7.0);
  float cloud = smoothstep(0.28, 0.95, n);
  float wisps = smoothstep(0.5, 0.85, w) * cloud;
  float core = exp(-r * r * 1.4);
  float glow = cloud * (0.25 + 1.0 * core) + core * 0.18;

  // faint light shafts radiating from the centre (seamless around the circle)
  float a = atan(d.y, d.x);
  float rayN = noise(vec2(cos(a), sin(a)) * 2.5 + vec2(t * 2.0, 0.0));
  float rays = pow(0.5 + 0.5 * sin(a * 7.0 + rayN * 4.0), 4.0) * exp(-r * 2.2) * 0.06 * cloud;

  vec3 deep = vec3(0.002, 0.003, 0.012);
  vec3 navy = vec3(0.01, 0.03, 0.2);
  vec3 royal = mix(vec3(0.03, 0.1, 0.6), vec3(0.16, 0.05, 0.48), uHue);
  vec3 violet = vec3(0.12, 0.04, 0.32);
  vec3 light = vec3(0.25, 0.42, 1.0);
  vec3 layers = navy * cloud * 0.8
    + royal * glow
    + violet * wisps * (1.0 - core) * 0.6
    + light * pow(cloud * core, 3.0) * 0.9
    + light * rays * (0.4 + uFocus * 0.6);
  // intro: everything but the central glow falls away to black, like the original boot
  float focusMask = mix(1.0, min(1.0, exp(-r * r * 2.2) * 1.4), uFocus);
  vec3 col = deep + layers * focusMask;

  // Contact: the "insert disc" look: dark maroon smoke, near-black edges, a hot pink-red core
  // Billowy smoke concentrated around the core: puffy (high-contrast noise), warm pinkish-grey
  // where it's lit by the core, fading to dark brown, then near-black at the edges.
  vec3 rDeep = vec3(0.007, 0.0035, 0.0035);
  float blob = exp(-r * r * 1.6);                         // where the smoke cloud sits
  float puff = smoothstep(0.32, 0.85, n) * 0.75 + smoothstep(0.45, 0.9, w) * 0.45;
  float smokeAmt = puff * blob;
  // reference smoke near the core ≈ sRGB (61, 28, 28): warm red-brown with green ≈ blue
  vec3 smokeDark = vec3(0.05, 0.012, 0.011);              // brown-maroon outskirts
  vec3 smokeLit = vec3(0.3, 0.085, 0.08);                 // warm red-grey, lit by the core
  vec3 smoke = mix(smokeDark, smokeLit, smoothstep(0.15, 0.85, blob));
  float hotR = exp(-r * r * 16.0);                        // small hot spot
  vec3 redCol = rDeep
    + smoke * smokeAmt * 1.5
    + vec3(0.5, 0.06, 0.1) * pow(blob, 4.0) * 0.28       // soft red halo
    + vec3(0.88, 0.074, 0.15) * hotR * (0.55 + 0.25 * puff); // intense red-pink core (ref ≈ 241,77,108)
  col = mix(col, redCol, uRed);

  float vig = smoothstep(2.1, 0.25, length(p * vec2(0.75, 1.0)));
  gl_FragColor = vec4(col * vig * uIntensity, 1.0);
  #include <colorspace_fragment>
}`;

/** Upscales the low-res nebula to the screen, with dithering to hide banding. */
const display = /* glsl */ `
uniform sampler2D tNebula;
uniform float uDither;
uniform float uSeed;
varying vec2 vUv;
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
void main() {
  // dither in sRGB space (perceptually even), then back to linear for the scene target
  vec3 s = pow(texture2D(tNebula, vUv).rgb, vec3(1.0 / 2.2));
  s += (hash(gl_FragCoord.xy + uSeed) - 0.5) * uDither / 255.0;
  gl_FragColor = vec4(pow(max(s, 0.0), vec3(2.2)), 1.0);
  #include <colorspace_fragment>
}`;

const triangle = () => {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return geo;
};

/**
 * Full-screen animated blue fog. The expensive noise is rendered into a small off-screen image
 * (it's a soft cloud, so ~1/3 resolution is indistinguishable) and then stretched to the screen
 * as the scene's background. That's roughly 10× fewer noise evaluations per frame.
 */
export class Nebula {
  /** The background quad that sits in the main scene. */
  readonly mesh: Mesh;
  readonly uniforms = {
    uTime: { value: 0 },
    uIntensity: { value: 0 },
    uAspect: { value: 1 },
    uHue: { value: 0 },
    uFocus: { value: 1 },
    uRed: { value: 0 },
    uCenter: { value: new Vector2() },
    uOctaves: { value: 5 },
  };
  readonly displayUniforms;
  private target = new WebGLRenderTarget(320, 180, {
    type: UnsignedByteType,
    colorSpace: SRGBColorSpace,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
  });
  private offscreen = new Scene();
  private camera = new Camera();

  constructor() {
    const noise = new Mesh(
      triangle(),
      new ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: this.uniforms, depthTest: false, depthWrite: false }),
    );
    noise.frustumCulled = false;
    this.offscreen.add(noise);

    this.displayUniforms = {
      tNebula: { value: this.target.texture },
      uDither: { value: 1.5 },
      uSeed: { value: 0 },
    };
    this.mesh = new Mesh(
      triangle(),
      new ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: display,
        uniforms: this.displayUniforms,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  setDither(amount: number) {
    this.displayUniforms.uDither.value = amount;
  }

  /** Off-screen resolution: about a third of the screen height, between 180 and 320 lines. */
  setSize(w: number, h: number) {
    const lines = Math.round(Math.min(320, Math.max(180, h / 3)));
    this.target.setSize(Math.max(1, Math.round((lines * w) / h)), lines);
  }

  /** Must run before the main scene is rendered each frame. */
  render(renderer: WebGLRenderer) {
    this.displayUniforms.uSeed.value = (this.displayUniforms.uSeed.value + 0.618) % 1;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(this.offscreen, this.camera);
    renderer.setRenderTarget(prev);
  }
}
