// The hero scene: one metallic stock token splitting into its price half (cool silver) and its dividend half
// (copper), with dividends drifting off the cut as sparks, over a slow nebula in the two brand colours.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

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
  for (int i = 0; i < 6; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = vUv;
  vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float t = uTime * 0.025;

  // Domain-warped clouds, drifting slowly.
  vec2 q = vec2(fbm(p * 1.4 + t), fbm(p * 1.4 - t + 3.1));
  vec2 r = vec2(fbm(p * 1.8 + 2.0 * q + vec2(1.7, 9.2) + t * 1.5), fbm(p * 1.8 + 2.0 * q + vec2(8.3, 2.8) - t));
  float clouds = fbm(p * 1.6 + 2.2 * r);

  vec3 col = vec3(0.016, 0.02, 0.035);
  vec2 f = (uFocus - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float dFocus = length(p - f);

  // Cool light from the upper left, warm ember around the token.
  float cool = smoothstep(1.6, 0.0, length(p - vec2(-0.9, 0.55)));
  float warm = smoothstep(1.1, 0.0, dFocus);
  vec3 blue = vec3(0.11, 0.33, 0.78);
  vec3 ember = vec3(0.95, 0.38, 0.13);
  col += blue * pow(clouds, 2.2) * (0.25 + 0.9 * cool);
  col += ember * pow(clouds, 2.6) * (0.08 + 1.1 * warm);
  col += ember * 0.10 * smoothstep(0.75, 0.0, dFocus);
  col += vec3(0.6, 0.7, 1.0) * 0.035 * smoothstep(0.55, 0.9, clouds);

  // Sparse stars.
  vec2 g = floor(uv * uRes / 3.0);
  float s = step(0.9985, hash(g)) * (0.4 + 0.6 * sin(uTime * 1.5 + hash(g + 4.0) * 40.0));
  col += vec3(0.8, 0.85, 1.0) * s * 0.5;

  // Vignette and grain.
  col *= 1.0 - 0.55 * smoothstep(0.35, 1.25, length((uv - 0.5) * vec2(1.25, 1.0)));
  col += (hash(uv * uRes + fract(uTime)) - 0.5) * 0.025;
  gl_FragColor = vec4(col, 1.0);
}
`;

const SPARK_VERT = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform float uGap;
uniform float uRadius;
uniform float uPixelRatio;
uniform float uOpen;
varying float vAlpha;
varying float vHeat;
void main() {
  float life = 6.0 + fract(aSeed * 7.13) * 5.0;
  float age = mod(uTime + aSeed * 37.0, life) / life;
  // Born along the cut, then carried up and away to the right: the dividend leaving the stock.
  float y0 = (fract(aSeed * 13.37) * 2.0 - 1.0) * uRadius * 0.92;
  float z0 = (fract(aSeed * 3.91) - 0.5) * 0.25;
  float spread = 0.6 + fract(aSeed * 5.7) * 2.6;
  vec3 pos = vec3(uGap * 0.5, y0, z0);
  pos.x += age * spread * 1.6 + sin(age * 6.0 + aSeed * 20.0) * 0.06;
  pos.y += age * (0.9 + fract(aSeed * 9.1) * 1.4) + sin(age * 4.0 + aSeed * 11.0) * 0.08;
  pos.z += age * (fract(aSeed * 2.3) - 0.3) * 1.5;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = (1.0 + fract(aSeed * 17.0) * 2.4) * (1.0 - age * 0.6);
  gl_PointSize = size * uPixelRatio * (18.0 / -mv.z);
  vAlpha = uOpen * smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.55, 1.0, age));
  vHeat = 1.0 - age;
}
`;

const SPARK_FRAG = /* glsl */ `
varying float vAlpha;
varying float vHeat;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  vec3 col = mix(vec3(1.0, 0.45, 0.16), vec3(1.0, 0.86, 0.6), vHeat * vHeat);
  gl_FragColor = vec4(col * a * vAlpha * 1.6, a * vAlpha);
}
`;

/** Coin face artwork: engraved rings, edge ticks and the two halves' letters. */
function faceTexture(): THREE.CanvasTexture {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const mid = size / 2;
  g.fillStyle = '#d9d9d9';
  g.fillRect(0, 0, size, size);
  const grad = g.createRadialGradient(mid, mid, 0, mid, mid, mid);
  grad.addColorStop(0, '#f2f2f2');
  grad.addColorStop(1, '#bdbdbd');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(mid, mid, mid, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#8d8d8d';
  for (const [r, w] of [[0.94, 10], [0.86, 3], [0.62, 2]] as const) {
    g.lineWidth = w;
    g.beginPath();
    g.arc(mid, mid, mid * r, 0, Math.PI * 2);
    g.stroke();
  }
  g.lineWidth = 3;
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2;
    g.beginPath();
    g.moveTo(mid + Math.cos(a) * mid * 0.87, mid + Math.sin(a) * mid * 0.87);
    g.lineTo(mid + Math.cos(a) * mid * 0.93, mid + Math.sin(a) * mid * 0.93);
    g.stroke();
  }
  g.fillStyle = '#7a7a7a';
  g.font = '600 300px "Instrument Serif", Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('P', mid * 0.6, mid * 1.02);
  g.fillText('D', mid * 1.4, mid * 1.02);
  const tex = new THREE.CanvasTexture(c);
  // Cap UVs come out a quarter-turn off once the coin is turned to face the camera.
  tex.center.set(0.5, 0.5);
  tex.rotation = Math.PI / 2;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function glowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 128, 0, 32, 128, 128);
  grad.addColorStop(0, 'rgba(255,170,110,1)');
  grad.addColorStop(0.25, 'rgba(255,110,50,0.55)');
  grad.addColorStop(1, 'rgba(255,90,30,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 256);
  return new THREE.CanvasTexture(c);
}

export interface SceneHandle {
  dispose(): void;
}

export function mountTokenScene(canvas: HTMLCanvasElement, reducedMotion: boolean): SceneHandle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: import.meta.env.DEV });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0, 10);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.035).texture;
  scene.environment = env;

  // Background nebula on a full-screen quad.
  const bgUniforms = {
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uFocus: { value: new THREE.Vector2(0.7, 0.5) },
  };
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ vertexShader: BG_VERT, fragmentShader: BG_FRAG, uniforms: bgUniforms, depthTest: false, depthWrite: false }),
  );
  bg.frustumCulled = false;
  bg.renderOrder = -1;
  scene.add(bg);

  // The token: two half-cylinders whose cut faces glow.
  const R = 1.55;
  const T = 0.3;
  const face = faceTexture();
  const token = new THREE.Group();
  const spin = new THREE.Group();
  token.add(spin);
  scene.add(token);

  const edge = (color: number) =>
    new THREE.MeshPhysicalMaterial({ color, metalness: 1, roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  const faceMat = (color: number) =>
    new THREE.MeshPhysicalMaterial({ color, map: face, bumpMap: face, bumpScale: 1.6, metalness: 1, roughness: 0.3, clearcoat: 0.4 });
  const cutMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.42, 0.16).multiplyScalar(1.6), toneMapped: false });

  const halves: THREE.Group[] = [];
  for (const side of [-1, 1] as const) {
    const half = new THREE.Group();
    const silver = 0xc9d6ee;
    const copper = 0xf0a271;
    const color = side < 0 ? silver : copper;
    const geo = new THREE.CylinderGeometry(R, R, T, 128, 1, false, side < 0 ? Math.PI : 0, Math.PI);
    const body = new THREE.Mesh(geo, [edge(color), faceMat(color), faceMat(color)]);
    half.add(body);
    const cut = new THREE.Mesh(new THREE.PlaneGeometry(2 * R, T), cutMat);
    cut.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    cut.position.x = side * 0.0005;
    half.add(cut);
    spin.add(half);
    halves.push(half);
  }
  spin.rotation.x = Math.PI / 2; // face the camera

  // Light in the gap between the halves.
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  glow.scale.set(0.9, R * 2.3, 1);
  token.add(glow);

  // Dividends leaving the stock.
  const COUNT = 520;
  const seeds = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) seeds[i] = Math.random();
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
  sparkGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const sparkUniforms = {
    uTime: { value: 0 },
    uGap: { value: 0 },
    uRadius: { value: R },
    uPixelRatio: { value: renderer.getPixelRatio() },
    uOpen: { value: 0 },
  };
  const sparks = new THREE.Points(
    sparkGeo,
    new THREE.ShaderMaterial({
      vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG, uniforms: sparkUniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  sparks.frustumCulled = false;
  token.add(sparks);

  scene.add(new THREE.HemisphereLight(0x9fb8ff, 0x1a0d08, 0.6));
  const key = new THREE.DirectionalLight(0xffd2b0, 2.2);
  key.position.set(4, 3, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6f9bff, 2.4);
  rim.position.set(-5, 2, -3);
  scene.add(rim);
  const ember = new THREE.PointLight(0xff6a2a, 4, 5, 1.8);
  ember.position.set(0.1, 0, 0.35);
  token.add(ember);

  // Layout: token on the right on wide screens, above the copy on narrow ones.
  let baseY = 0;
  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    bgUniforms.uRes.value.set(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
    const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const halfW = halfH * camera.aspect;
    if (camera.aspect > 1.05) {
      baseY = -0.05;
      const x = halfW * 0.56;
      token.position.set(x, baseY, 0);
      token.scale.setScalar(THREE.MathUtils.clamp(halfW * 0.19, 0.5, 0.95));
      bgUniforms.uFocus.value.set(0.5 + (x / halfW) * 0.5, 0.5);
    } else {
      // About 55% of the screen width, in the band above the copy.
      baseY = halfH * 0.5;
      token.position.set(0, baseY, 0);
      token.scale.setScalar(THREE.MathUtils.clamp(halfW * 0.34, 0.3, 0.62));
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
  const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

  function draw(t: number) {
    pointer.x += (pointer.tx - pointer.x) * 0.04;
    pointer.y += (pointer.ty - pointer.y) * 0.04;

    // The two halves part after a beat, then breathe.
    const open = ease((t - 0.6) / 2.2);
    const gap = open * (0.34 + 0.05 * Math.sin(t * 0.8));
    halves[0].position.x = -gap / 2;
    halves[1].position.x = gap / 2;
    halves[0].rotation.z = -open * 0.04;
    halves[1].rotation.z = open * 0.05;
    glow.scale.x = 0.25 + gap * 2.4;
    glow.material.opacity = 0.2 + open * 0.8;
    ember.intensity = 1.5 + open * 3.5;
    sparkUniforms.uTime.value = t;
    sparkUniforms.uGap.value = gap;
    sparkUniforms.uOpen.value = open;

    token.rotation.y = -0.38 + Math.sin(t * 0.25) * 0.18 + pointer.x * 0.22;
    token.rotation.x = 0.1 + Math.sin(t * 0.33) * 0.05 + pointer.y * 0.12;
    token.position.y = baseY + Math.sin(t * 0.6) * 0.05;
    bgUniforms.uTime.value = t;
    renderer.render(scene, camera);
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    // Skip work once the hero has scrolled away; browsers already pause rAF in background tabs.
    if (canvas.getBoundingClientRect().bottom < 0) return;
    draw(clock.getElapsedTime());
  }
  if (reducedMotion) draw(4);
  else frame();
  // Dev only: render a given moment on demand (for screenshots from a backgrounded tab).
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
      face.dispose();
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}
