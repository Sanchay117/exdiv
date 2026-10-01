// The hero scene: a stock as an orb of light. Its cool half is the price, its warm half the dividends; the orb
// parts along a white-hot seam and the dividends peel away from the warm half, spiralling out into an orbit.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const BG_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const BG_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform vec2 uRes;
uniform vec2 uFocus;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  vec2 f = (uFocus - 0.5) * vec2(aspect, 1.0);
  float t = uTime * 0.02;
  vec2 q = vec2(fbm(p * 1.2 + t), fbm(p * 1.2 - t + 4.0));
  float clouds = fbm(p * 1.5 + 1.8 * q);

  vec3 col = vec3(0.012, 0.014, 0.024);
  float d = length(p - f);
  // A faint halo behind the orb: cool on its price side, warm on its dividend side.
  float side = clamp((p.x - f.x) * 2.5, -1.0, 1.0);
  vec3 halo = mix(vec3(0.10, 0.22, 0.55), vec3(0.55, 0.20, 0.06), side * 0.5 + 0.5);
  col += halo * 0.42 * exp(-d * d * 1.8);
  col += mix(vec3(0.05, 0.12, 0.32), vec3(0.30, 0.10, 0.03), side * 0.5 + 0.5) * pow(clouds, 3.0) * 0.9 * exp(-d * 0.9);

  vec2 g = floor(uv * uRes / 2.0);
  float s = step(0.9988, hash(g)) * (0.35 + 0.65 * sin(uTime * 1.3 + hash(g + 3.0) * 50.0));
  col += vec3(0.75, 0.82, 1.0) * s * 0.45;

  col *= 1.0 - 0.6 * smoothstep(0.4, 1.3, length((uv - 0.5) * vec2(1.2, 1.0)));
  col += (hash(uv * uRes + fract(uTime)) - 0.5) * 0.018;
  // Tuned as display colours; the composer works in linear light and converts back at the end.
  gl_FragColor = vec4(pow(max(col, 0.0), vec3(2.2)), 1.0);
}
`;

// Shared by both particle shaders.
const COMMON = /* glsl */ `
uniform float uTime;
uniform float uIntro;
uniform float uGap;
uniform float uPixelRatio;
uniform float uScale;
attribute vec3 aDir;
attribute float aSeed;
varying vec3 vColor;
varying float vAlpha;
vec3 hash3(float n) { return fract(sin(vec3(n, n + 1.0, n + 2.0)) * vec3(43758.5453, 22578.1459, 19642.3490)); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
`;

const CORE_VERT = /* glsl */ `
${COMMON}
// A crisp dotted sphere: bright where it faces you, dim behind, cut in two along x.
void main() {
  float side = aDir.x < 0.0 ? -1.0 : 1.0;
  vec3 pos = aDir;
  pos += aDir * 0.012 * sin(uTime * 1.3 + aSeed * 40.0);
  pos.yz = rot(uTime * 0.08 * side) * pos.yz;                       // the halves turn against each other
  pos.x += side * uGap * 0.5;                                       // and part

  vec3 far = normalize(hash3(aSeed * 91.0) - 0.5) * (3.5 + fract(aSeed * 3.3) * 4.0);
  float k = smoothstep(0.0, 1.0, clamp(uIntro * 1.15 - fract(aSeed * 5.1) * 0.15, 0.0, 1.0));
  pos = mix(far, pos, k);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;

  float facing = (normalMatrix * aDir).z;                          // > 0 faces the camera
  float edge = exp(-pow(aDir.x / 0.05, 2.0));
  vec3 cool = mix(vec3(0.30, 0.55, 1.00), vec3(0.80, 0.88, 1.00), fract(aSeed * 13.1) * 0.6);
  vec3 warm = mix(vec3(1.00, 0.48, 0.16), vec3(1.00, 0.80, 0.50), fract(aSeed * 13.1) * 0.6);
  vColor = mix(side < 0.0 ? cool : warm, vec3(1.0, 0.92, 0.78), edge * 0.7);
  float sparkle = step(0.992, fract(aSeed * 57.0)) * (0.5 + 0.5 * sin(uTime * 2.5 + aSeed * 90.0));
  vAlpha = (mix(0.25, 0.95, smoothstep(-0.1, 0.7, facing)) + 0.6 * edge + sparkle) * (0.35 + 0.65 * k);
  gl_PointSize = (1.6 + fract(aSeed * 31.0) * 0.9 + sparkle * 2.0) * uPixelRatio * uScale * (10.0 / -mv.z);
}
`;

// The dark body of each half (it also hides the dots on the far side), with a coloured rim.
const BODY_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
const BODY_FRAG = /* glsl */ `
uniform vec3 uRim;
uniform float uOpacity;
varying vec3 vN;
varying vec3 vV;
void main() {
  float fres = pow(1.0 - max(dot(vN, vV), 0.0), 3.0);
  vec3 col = vec3(0.012, 0.016, 0.03) + uRim * fres * 0.55;
  gl_FragColor = vec4(pow(col, vec3(2.2)), uOpacity);
}
`;

// Each cut face: a disc of warm light with fine concentric rings, hottest in the middle.
const FACE_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const FACE_FRAG = /* glsl */ `
uniform vec3 uRim;
uniform float uTime;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  vec3 core = vec3(1.0, 0.8, 0.55);
  vec3 col = mix(core, uRim, smoothstep(0.0, 0.95, r));
  float rings = 0.7 + 0.3 * smoothstep(0.32, 0.5, abs(fract(r * 12.0 - uTime * 0.25) - 0.5));
  float glow = (1.0 - smoothstep(0.6, 1.0, r)) * 0.7 + 0.3;
  gl_FragColor = vec4(pow(col * rings * glow * 0.82, vec3(2.2)), uOpacity);
}
`;

// The two cut faces: discs of concentric dots, white-hot in the middle, taking each half's colour at the rim.
const DISC_VERT = /* glsl */ `
${COMMON}
void main() {
  float side = aDir.x;
  vec3 pos = vec3(side * uGap * 0.5 - side * 0.004, aDir.y, aDir.z);
  pos.yz = rot(uTime * 0.08 * side) * pos.yz;
  float k = smoothstep(0.0, 1.0, clamp((uIntro - 0.55) * 2.2, 0.0, 1.0));
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float r = length(aDir.yz);
  vec3 rimColor = side < 0.0 ? vec3(0.35, 0.6, 1.0) : vec3(1.0, 0.5, 0.18);
  vColor = mix(vec3(1.0, 0.93, 0.80), rimColor, smoothstep(0.15, 1.0, r));
  vAlpha = k * smoothstep(0.0, 0.6, uGap) * (0.55 - 0.3 * r) * (0.6 + 0.4 * sin(uTime * 1.7 + r * 14.0 - aSeed * 3.0));
  gl_PointSize = (1.4 + fract(aSeed * 11.0) * 0.8) * uPixelRatio * uScale * (10.0 / -mv.z);
}
`;

const STREAM_VERT = /* glsl */ `
${COMMON}
uniform float uFlow;
void main() {
  // Each dividend leaves a point on the warm half, lifts off, and settles into a tilted orbit.
  // Born on the warm half's cut face (a point in the unit disc), then pulled out and around.
  vec2 disc = normalize(aDir.yz + 1e-4) * sqrt(fract(aSeed * 9.7));
  vec3 start = vec3(uGap * 0.5, disc);
  float speed = 0.035 + fract(aSeed * 4.7) * 0.03;
  float u = fract(uTime * speed + aSeed);
  float ringR = 1.5 + pow(fract(aSeed * 8.3), 1.5) * 0.55;
  float theta = aSeed * 6.2831 + uTime * (0.22 / ringR) + u * 2.6;
  vec3 ring = vec3(cos(theta) * ringR, (fract(aSeed * 21.0) - 0.5) * 0.08, sin(theta) * ringR);
  ring.yz = rot(1.32) * ring.yz;
  ring.xy = rot(-0.22) * ring.xy;
  float lift = smoothstep(0.0, 0.45, u);
  vec3 out1 = start + vec3(-0.15, 0.55, 0.9) * u * 1.4;
  vec3 pos = mix(out1, ring, lift);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  vColor = mix(vec3(1.0, 0.86, 0.6), vec3(1.0, 0.45, 0.14), lift);
  vAlpha = uFlow * smoothstep(0.0, 0.06, u) * (1.0 - smoothstep(0.82, 1.0, u)) * (0.25 + 0.6 * fract(aSeed * 2.9));
  gl_PointSize = (1.4 + fract(aSeed * 17.0) * 2.2) * uPixelRatio * uScale * (9.0 / -mv.z);
}
`;

const POINT_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = (smoothstep(1.0, 0.55, d) + 0.35 * exp(-d * d * 4.0)) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(pow(vColor, vec3(2.2)) * a, a);
}
`;

/** Evenly spread unit vectors (Fibonacci sphere), with a little jitter so it doesn't look gridded. */
function sphereDirs(n: number, jitter = 0.015): Float32Array {
  const out = new Float32Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = golden * i;
    v.set(Math.cos(th) * r, y, Math.sin(th) * r);
    v.x += (Math.random() - 0.5) * jitter;
    v.y += (Math.random() - 0.5) * jitter;
    v.z += (Math.random() - 0.5) * jitter;
    v.normalize().toArray(out, i * 3);
  }
  return out;
}

/** Two unit discs of evenly spread dots (Vogel spiral), tagged with their side in x. */
function discDots(perSide: number): Float32Array {
  const out = new Float32Array(perSide * 2 * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let s = 0; s < 2; s++) {
    for (let i = 0; i < perSide; i++) {
      const r = Math.sqrt((i + 0.5) / perSide) * 0.985;
      const th = i * golden;
      out.set([s === 0 ? -1 : 1, Math.cos(th) * r, Math.sin(th) * r], (s * perSide + i) * 3);
    }
  }
  return out;
}

function points(dirs: Float32Array, vertexShader: string, uniforms: Record<string, THREE.IUniform>) {
  const n = dirs.length / 3;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('aDir', new THREE.BufferAttribute(dirs, 3));
  const seeds = new Float32Array(n);
  for (let i = 0; i < n; i++) seeds[i] = Math.random();
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const p = new THREE.Points(
    geo,
    new THREE.ShaderMaterial({
      vertexShader, fragmentShader: POINT_FRAG, uniforms,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    }),
  );
  p.frustumCulled = false;
  return p;
}

export interface SceneHandle {
  dispose(): void;
}

export function mountTokenScene(canvas: HTMLCanvasElement, reducedMotion: boolean): SceneHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: import.meta.env.DEV });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0, 10);

  const bgUniforms = { uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uFocus: { value: new THREE.Vector2(0.7, 0.5) } };
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ vertexShader: BG_VERT, fragmentShader: BG_FRAG, uniforms: bgUniforms, depthTest: false, depthWrite: false }),
  );
  bg.frustumCulled = false;
  bg.renderOrder = -1;
  scene.add(bg);

  const shared = {
    uTime: { value: 0 },
    uIntro: { value: 0 },
    uGap: { value: 0 },
    uPixelRatio: { value: renderer.getPixelRatio() },
    uScale: { value: 1 },
  };
  const flow = { value: 0 };
  const orb = new THREE.Group();
  // Each half: a dark body (hides the far side's dots) and a glowing cut face.
  const COOL = new THREE.Color(0.35, 0.6, 1.0);
  const WARM = new THREE.Color(1.0, 0.5, 0.18);
  const bodyOpacity = { value: 0 };
  const halves = ([-1, 1] as const).map((side) => {
    const half = new THREE.Group();
    const rim = side < 0 ? COOL : WARM;
    const body = new THREE.Mesh(
      // phi in [-90, 90] degrees gives x <= 0 in three's sphere parametrisation, [90, 270] gives x >= 0.
      new THREE.SphereGeometry(0.985, 96, 64, side < 0 ? -Math.PI / 2 : Math.PI / 2, Math.PI),
      new THREE.ShaderMaterial({ vertexShader: BODY_VERT, fragmentShader: BODY_FRAG, uniforms: { uRim: { value: rim }, uOpacity: bodyOpacity }, side: THREE.DoubleSide, transparent: true }),
    );
    const face = new THREE.Mesh(
      new THREE.CircleGeometry(0.985, 96),
      new THREE.ShaderMaterial({ vertexShader: FACE_VERT, fragmentShader: FACE_FRAG, uniforms: { uRim: { value: rim }, uTime: shared.uTime, uOpacity: bodyOpacity }, side: THREE.DoubleSide, transparent: true }),
    );
    face.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    half.add(body, face);
    orb.add(half);
    return { side, half };
  });
  const dots = [
    points(sphereDirs(14_000, 0.004), CORE_VERT, shared),
    points(discDots(2_600), DISC_VERT, shared),
    points(sphereDirs(7_000, 0.2), STREAM_VERT, { ...shared, uFlow: flow }),
  ];
  for (const d of dots) {
    // Dots sit just above the bodies and are hidden behind them.
    (d.material as THREE.ShaderMaterial).depthTest = true;
    d.renderOrder = 1;
    orb.add(d);
  }
  scene.add(orb);

  // Bloom gives the particles their glow.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.45, 0.3);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let baseY = 0;
  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    bgUniforms.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const halfW = halfH * camera.aspect;
    if (camera.aspect > 1.05) {
      const x = halfW * 0.53;
      baseY = 0;
      orb.position.set(x, baseY, 0);
      shared.uScale.value = THREE.MathUtils.clamp(halfW * 0.22, 0.7, 1.15);
      bgUniforms.uFocus.value.set(0.5 + (x / halfW) * 0.5, 0.5);
    } else {
      baseY = halfH * 0.5;
      orb.position.set(0, baseY, 0);
      shared.uScale.value = THREE.MathUtils.clamp(halfW * 0.36, 0.4, 0.8);
      bgUniforms.uFocus.value.set(0.5, 0.75);
    }
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const onPointer = (e: PointerEvent) => {
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = (e.clientY / window.innerHeight) * 2 - 1;
  };
  window.addEventListener('pointermove', onPointer, { passive: true });

  const clock = new THREE.Clock();
  let raf = 0;
  const ease = (x: number) => {
    const c = Math.min(1, Math.max(0, x));
    return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
  };

  function draw(t: number) {
    pointer.x += (pointer.tx - pointer.x) * 0.04;
    pointer.y += (pointer.ty - pointer.y) * 0.04;
    // Gather (0 to 2.2s), part (2 to 3.8s), then let the dividends flow.
    shared.uIntro.value = ease(t / 2.2);
    const open = ease((t - 2.0) / 1.8);
    shared.uGap.value = open * (1.35 + 0.05 * Math.sin(t * 0.7));
    flow.value = ease((t - 2.6) / 2.5);
    shared.uTime.value = t;
    bgUniforms.uTime.value = t;
    orb.scale.setScalar(shared.uScale.value);
    bodyOpacity.value = ease((t - 0.8) / 1.8);
    for (const { side, half } of halves) {
      half.position.x = side * shared.uGap.value * 0.5;
      half.scale.setScalar(0.4 + 0.6 * shared.uIntro.value);
    }
    // Turned so you look into the cut: the warm half's glowing face shows through the gap.
    orb.rotation.y = 0.3 + Math.sin(t * 0.15) * 0.06 + pointer.x * 0.12;
    orb.rotation.x = 0.12 + Math.sin(t * 0.21) * 0.04 + pointer.y * 0.08;
    orb.position.y = baseY + Math.sin(t * 0.5) * 0.04;
    composer.render();
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    // Skip work once the hero has scrolled away; browsers already pause rAF in background tabs.
    if (canvas.getBoundingClientRect().bottom < 0) return;
    draw(clock.getElapsedTime());
  }
  if (reducedMotion) draw(8);
  else frame();
  if (import.meta.env.DEV) {
    const w = window as unknown as { __exdivDraw: (t: number) => void; __exdivReplay: () => void };
    w.__exdivDraw = draw;
    w.__exdivReplay = () => clock.start(); // replays the opening, for recording the demo
  }

  return {
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', onPointer);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
        mats.forEach((mat) => mat.dispose());
      });
      bloom.dispose();
      composer.dispose();
      renderer.dispose();
    },
  };
}
