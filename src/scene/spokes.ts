import {
  AdditiveBlending,
  BoxGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';

const COUNT = 12;

const vertex = /* glsl */ `
varying float vAlong;
varying float vPhase;
varying vec3 vN;
varying vec3 vV;
void main() {
  vAlong = position.z + 0.5;           // 0 at the hub end, 1 at the outer tip
  vPhase = fract(sin(float(gl_InstanceID) * 91.7) * 43758.5);
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const fragment = /* glsl */ `
uniform float uReveal;
uniform float uTime;
varying float vAlong;
varying float vPhase;
varying vec3 vN;
varying vec3 vV;
void main() {
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float rim = pow(1.0 - facing, 1.6);
  float inner = pow(1.0 - vAlong, 1.3);            // bright at the hub end, fading outward
  vec3 deep = vec3(0.05, 0.2, 0.85);
  vec3 bright = vec3(0.42, 0.62, 1.0);
  vec3 col = mix(deep, bright, inner * 0.8);
  float body = 0.07 + inner * 0.24 + rim * 0.22 * (0.4 + inner);
  // slow pulse of light travelling outward along each spoke
  float p = fract(vAlong - uTime * 0.12 + vPhase) - 0.5;
  float pulse = exp(-p * p * 60.0) * 0.14 * (1.0 - vAlong * 0.5);
  float tip = smoothstep(0.92, 1.0, vAlong) * 0.08; // soft frosted end cap
  gl_FragColor = vec4(col * (body + pulse + tip) * uReveal, 1.0);
  #include <colorspace_fragment>
}`;

/**
 * The dashboard's 12 translucent spokes around the crystal hub: frosted cyan glass,
 * brightest at the hub and fading outward. Additive, so overlapping spokes glow.
 */
export class Spokes {
  readonly group = new Group();
  private material: ShaderMaterial;
  private spin = 0;

  constructor() {
    this.material = new ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { uReveal: { value: 0 }, uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), this.material, COUNT);
    const m = new Matrix4();
    const q = new Quaternion();
    const d = new Vector3();
    const Z = new Vector3(0, 0, 1);
    for (let i = 0; i < COUNT; i++) {
      const a = (i / COUNT) * Math.PI * 2;
      d.set(Math.cos(a), Math.sin(a), 0);
      const r = 2.3;
      const len = i % 2 ? 1.9 : 2.4;
      q.setFromUnitVectors(Z, d);
      m.compose(d.clone().multiplyScalar(r + len / 2), q, new Vector3(0.24, 0.24, len));
      mesh.setMatrixAt(i, m);
    }
    mesh.frustumCulled = false;
    this.group.add(mesh);
    // tilt the spoke disc to match the crystal ring
    this.group.rotation.x = -0.32;
  }

  update(dt: number, time: number, reveal: number, motion: number) {
    // (reveal also carries the fade-out for the Contact "insert disc" theme)
    this.spin += dt * 0.035 * motion;
    this.group.rotation.z = this.spin;
    // grow outward from the hub as they appear
    this.group.scale.setScalar(0.6 + 0.4 * reveal);
    this.group.visible = reveal > 0.001;
    this.material.uniforms.uReveal.value = reveal;
    this.material.uniforms.uTime.value = time;
  }
}
