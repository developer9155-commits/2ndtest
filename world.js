/* =====================================================================
   world.js — the 3D miniature world (Three.js) and its camera (GSAP)
   ---------------------------------------------------------------------
   main.js calls createWorld() and then uses the object it returns:
     start(), playIntro(), flyTo(id), setHover(id), setViewShift(x, y, s),
     setAutoRotate(on), nudge(dx, dy, zoom), dispose()

   THIS VERSION
     • Bigger island (ISLAND_RADIUS 46, WORLD_SCALE 1.5) with a mountain ring.
     • NEW west district (towers, avenue, fountain, cars), a lake with a pier
       and rowboat, a lighthouse with a sweeping beam.
     • NEW sky life: rainbow, hot-air balloon, floating islets, more clouds.
     • Fixes: each office now animates only its own screens, and every office
       pulses in its own brand colour. Camera framing re-tuned for the size.

   File map (search for these headings):
     0. helpers   1. renderer   2. sky + lights   3. terrain   4. nature
     5. landmarks 6. city       6.5 airport  6.6 railway   7. offices
     8. people    8.5 district / lake / lighthouse   8.6 sky life
     9. atmosphere  10. hotspots  11. camera  12. loop
   ===================================================================== */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ------------------------------------------------------------------ */
/* SIZE SETTINGS — change these to make the world bigger or smaller    */
/* ------------------------------------------------------------------ */
const WORLD_SCALE = 1.5;     // how much bigger everything is (1 = original size)
const CAMERA_SCALE = 1.35;   // how far back the HOME camera sits
const EXPLORE_SCALE = 2.1;   // how far back the EXPLORE camera sits (sees the whole island)
const ISLAND_RADIUS = 46;    // centre-to-edge size of the island

/* ------------------------------------------------------------------ */
/* 0. helpers                                                          */
/* ------------------------------------------------------------------ */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const easeOut = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash3(x, y, z) {
  let h = Math.imul(Math.round(x * 1000) | 0, 374761393) ^ Math.imul(Math.round(y * 1000) | 0, 668265263) ^ Math.imul(Math.round(z * 1000) | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash3(ix, 0.5, iz), b = hash3(ix + 1, 0.5, iz), c = hash3(ix, 0.5, iz + 1), d = hash3(ix + 1, 0.5, iz + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
function paintGeo(g, hex) {
  const c = new THREE.Color(hex), arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < g.attributes.position.count; i++) c.toArray(arr, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/* ---- tiny animation layer (GSAP when loaded, built-in fallback otherwise) ---- */
const fallbackTweens = new Set();

function easeByName(name) {
  const m = /^(power|sine)(\d)?\.(in|out|inOut)$/.exec(name || '') || [];
  const kind = m[1] || 'power', n = Number(m[2] || 2), dir = m[3] || 'inOut';
  const f = kind === 'sine' ? (t) => 1 - Math.cos((t * Math.PI) / 2) : (t) => Math.pow(t, n + 1);
  if (dir === 'in') return f;
  if (dir === 'out') return (t) => 1 - f(1 - t);
  return (t) => (t < 0.5 ? f(t * 2) / 2 : 1 - f((1 - t) * 2) / 2);
}

class FallbackTween {
  constructor(target, props, duration, ease, delay, onUpdate, onDone) {
    this.target = target; this.props = props; this.duration = Math.max(0.0001, duration);
    this.ease = easeByName(ease); this.time = -delay; this.onUpdate = onUpdate; this.onDone = onDone;
    this.from = null; this.dead = false;
  }
  step(dt) {
    this.time += dt;
    if (this.time < 0) return false;
    if (!this.from) { this.from = {}; for (const k in this.props) this.from[k] = this.target[k]; }
    const p = clamp(this.time / this.duration, 0, 1), e = this.ease(p);
    for (const k in this.props) this.target[k] = lerp(this.from[k], this.props[k], e);
    if (this.onUpdate) this.onUpdate();
    if (p >= 1) { if (this.onDone) this.onDone(); return true; }
    return false;
  }
}
function stepFallbackTweens(dt) {
  for (const tw of Array.from(fallbackTweens)) {
    if (tw.dead) { fallbackTweens.delete(tw); continue; }
    if (tw.step(dt)) fallbackTweens.delete(tw);
  }
}

class Timeline {
  constructor(onComplete) {
    this.onComplete = onComplete; this.killed = false; this.pending = 0; this.tweens = [];
    const g = window.gsap;
    this.tl = g && g.timeline ? g.timeline({ onComplete: () => { if (!this.killed && this.onComplete) this.onComplete(); } }) : null;
  }
  to(target, props, { duration = 1, ease = 'power2.inOut', at = 0, onUpdate } = {}) {
    if (this.tl) {
      this.tl.to(target, Object.assign({}, props, { duration, ease, onUpdate }), at);
    } else {
      this.pending++;
      const tw = new FallbackTween(target, props, duration, ease, at, onUpdate, () => {
        if (--this.pending === 0 && !this.killed && this.onComplete) this.onComplete();
      });
      this.tweens.push(tw); fallbackTweens.add(tw);
    }
    return this;
  }
  kill() {
    this.killed = true;
    if (this.tl) this.tl.kill();
    this.tweens.forEach((t) => { t.dead = true; });
  }
}

/* ------------------------------------------------------------------ */
/* createWorld                                                         */
/* ------------------------------------------------------------------ */
export async function createWorld(opts) {
  const {
    canvas, config, quality = 'full', reducedMotion = false,
    onProgress = () => {}, onHotspotHover = () => {}, onHotspotClick = () => {},
    onFrame = () => {}, onUserInteract = () => {}, onWarning = () => {}, onError = () => {},
  } = opts;

  const S = WORLD_SCALE;
  const R = ISLAND_RADIUS;
  const simple = quality === 'simple';
  const small = window.matchMedia('(max-width: 760px)').matches;
  const animate = !reducedMotion;
  const cleanups = [];
  const listen = (target, type, fn, o) => { target.addEventListener(type, fn, o); cleanups.push(() => target.removeEventListener(type, fn, o)); };
  const pause = () => new Promise((r) => setTimeout(r, 16));
  async function stage(fraction, label, fn) { onProgress(fraction, label); await pause(); fn(); }

  let disposed = false, failed = false, dirty = true, rafId = 0;
  function fail(err) { if (failed) return; failed = true; stop(); onError(err); }

  /* ---------------------------------------------------------------- */
  /* 1. renderer, scene, camera, controls                              */
  /* ---------------------------------------------------------------- */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !simple, powerPreference: 'high-performance' });
  const pixelCap = simple ? 1 : small ? 1.5 : 1.75;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelCap));
  renderer.setClearColor(0xcfe6ff, 1);
  renderer.shadowMap.enabled = !simple;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xcfe6ff, 190, 480);

  const W = new THREE.Group();
  W.scale.setScalar(S);
  scene.add(W);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 1400);
  const size = { w: 1, h: 1 };
  let fovBoost = 0;
  const baseFov = (aspect) => clamp(38 * Math.pow(Math.max(1, 1 / aspect), 0.9), 38, 68);

  const rawViews = {
    home: { position: [20, 9, 30], target: [0, 2, 6] },
    explore: { position: [22, 26, 38], target: [0, 1, 9] },
    ...(config.views || {}),
  };
  (config.hotspots || []).forEach((h) => { if (h.camera) rawViews[h.id] = h.camera; });
  const views = {};
  Object.keys(rawViews).forEach((id) => {
    const v = rawViews[id];
    const k = id === 'explore' ? EXPLORE_SCALE : id === 'home' ? CAMERA_SCALE : S;   // close-ups scale with the world so framing stays the same
    views[id] = { position: v.position.map((n) => n * k), target: v.target.map((n) => n * S) };
  });

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enablePan = false;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.7;
  controls.autoRotateSpeed = 0.45;
  controls.target.fromArray(views.home.target);

  function setLimits(m) {
    if (m === 'section') {
      controls.minDistance = 0.5; controls.maxDistance = 600;
      controls.minPolarAngle = 0; controls.maxPolarAngle = Math.PI;
    } else {
      controls.minDistance = 13 * CAMERA_SCALE; controls.maxDistance = Math.max(58, R * 2.0) * S;
      controls.minPolarAngle = 0.3; controls.maxPolarAngle = 1.5;
    }
  }
  setLimits('home');

  const shift = { x: 0, y: 0 };
  const par = { x: 0, y: 0, tx: 0, ty: 0 };
  let lastOx = NaN, lastOy = NaN;
  function applyView(force) {
    const ox = (shift.x + par.x * 0.012) * size.w;
    const oy = (shift.y + par.y * 0.01) * size.h;
    if (!force && Math.abs(ox - lastOx) < 0.05 && Math.abs(oy - lastOy) < 0.05) return;
    lastOx = ox; lastOy = oy;
    camera.setViewOffset(size.w, size.h, ox, oy, size.w, size.h);
    dirty = true;
  }
  function refreshFov() { camera.fov = baseFov(camera.aspect) + fovBoost; applyView(true); }
  function resize() {
    size.w = Math.max(1, canvas.clientWidth || window.innerWidth);
    size.h = Math.max(1, canvas.clientHeight || window.innerHeight);
    renderer.setSize(size.w, size.h, false);
    camera.aspect = size.w / size.h;
    refreshFov();
  }
  listen(window, 'resize', resize);
  resize();

  listen(canvas, 'webglcontextlost', (e) => { e.preventDefault(); fail(new Error('the graphics context was lost')); });

  /* ---------------------------------------------------------------- */
  /* shared building helpers                                           */
  /* ---------------------------------------------------------------- */
  const animators = [];
  const always = [];
  const matCache = new Map(), geoCache = new Map();
  const mat = (color, o = {}) => {
    const key = color + JSON.stringify(o);
    let m = matCache.get(key);
    if (!m) { m = new THREE.MeshLambertMaterial({ color, flatShading: true, ...o }); matCache.set(key, m); }
    return m;
  };
  const geo = (key, make) => { let g = geoCache.get(key); if (!g) { g = make(); geoCache.set(key, g); } return g; };
  function put(parent, g, material, x = 0, y = 0, z = 0, shadow = true) {
    const m = new THREE.Mesh(g, material);
    m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true;
    parent.add(m); return m;
  }
  const box = (p, sx, sy, sz, x, y, z, color, o) => { const m = put(p, geo('box', () => new THREE.BoxGeometry(1, 1, 1)), mat(color, o), x, y, z); m.scale.set(sx, sy, sz); return m; };
  const cyl = (p, rt, rb, h, seg, x, y, z, color, o) => put(p, geo(`cyl${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg)), mat(color, o), x, y, z);
  const cone = (p, r, h, seg, x, y, z, color, o) => put(p, geo(`cone${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg)), mat(color, o), x, y, z);
  const ball = (p, r, x, y, z, color, o) => put(p, geo(`ball${r}`, () => new THREE.SphereGeometry(r, 10, 8)), mat(color, o), x, y, z);
  const prism = (p, r, len, x, y, z, color, hScale = 1) => { const m = put(p, geo(`prism${r},${len}`, () => new THREE.CylinderGeometry(r, r, len, 3)), mat(color), x, y, z); m.rotation.x = -Math.PI / 2; m.scale.z = hScale; return m; };
  const slab = (p, cx, cz, sx, sz, color, y = 0.03, h = 0.05) => { const m = box(p, sx, h, sz, cx, y, cz, color); m.castShadow = false; return m; };

  function canvasTextureWH(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (ctx) draw(ctx, w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return t;
  }
  const canvasTexture = (draw, s = 128) => canvasTextureWH(s, s, draw);
  const glowTex = canvasTexture((g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  });
  const ringTex = canvasTexture((g, s) => {
    g.strokeStyle = '#fff'; g.lineWidth = s * 0.05; g.beginPath(); g.arc(s / 2, s / 2, s * 0.4, 0, TAU); g.stroke();
  });
  function glow(parent, color, scale, opacity = 0.8, x = 0, y = 0, z = 0) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    s.scale.setScalar(scale); s.position.set(x, y, z); parent.add(s); return s;
  }

  /* ---------------------------------------------------------------- */
  /* 2. sky and lights                                                 */
  /* ---------------------------------------------------------------- */
  let sunLight;
  await stage(0.03, 'Painting the sky', () => {
    const uniforms = {
      top: { value: new THREE.Color('#2f78e6') }, mid: { value: new THREE.Color('#68b4ff') },
      horizon: { value: new THREE.Color('#d6edff') }, bottom: { value: new THREE.Color('#e3dcff') },
    };
    const skyMat = new THREE.ShaderMaterial({
      uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vDir;
        void main(){
          float y = vDir.y; vec3 c;
          if (y > 0.0) { c = mix(horizon, mid, smoothstep(0.0, 0.35, y)); c = mix(c, top, smoothstep(0.3, 0.95, y)); }
          else { c = mix(horizon, bottom, smoothstep(0.0, 0.4, -y)); }
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 16), skyMat);
    sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);

    scene.add(new THREE.HemisphereLight(0xcfe6ff, 0xa58bd6, 1.25));

    sunLight = new THREE.DirectionalLight(0xfff0d0, 2.4);
    sunLight.position.set(30, 48, 24);
    if (!simple) {
      sunLight.castShadow = true;
      const ms = small ? 2048 : 4096;
      sunLight.shadow.mapSize.set(ms, ms);
      const c = sunLight.shadow.camera;
      const e = R * S + 4;
      c.left = -e; c.right = e; c.top = e; c.bottom = -e; c.near = 1; c.far = 260;
      sunLight.shadow.bias = -0.0003; sunLight.shadow.normalBias = 0.05;
      sunLight.shadow.radius = 2.5;
    }
    scene.add(sunLight);

    const fill = new THREE.DirectionalLight(0x9f8cff, 0.6);
    fill.position.set(-8, 6, -10); scene.add(fill);

    const sunDir = new THREE.Vector3(10, 16, 8).normalize().multiplyScalar(800);
    glow(scene, 0xfff2c8, 190, 0.7, sunDir.x, sunDir.y, sunDir.z);
  });

  /* ---------------------------------------------------------------- */
  /* 3. terrain: island, hills, roads                                  */
  /* ---------------------------------------------------------------- */
  const CITY = { x0: -11.5, x1: 11.5, z0: 14.5, z1: 25.8 };
  const CITY2 = { x0: -30.5, x1: -13.0, z0: 15.0, z1: 28.0 };       // the west district
  const AVENUE_Z = 22.6;
  const AIRPORT = { x0: -34.5, x1: -20.5, z0: -9.5, z1: 2.5 };
  const RAIL = { x0: 14.0, x1: 27.0, z0: 16.5, z1: 24.0 };
  const rectMask = (x, z, r, m) => 1 - smoothstep(0, m, Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1)));

  // Hills: [x, z, height, radius].
  const BUMPS = [
    [-8, -8.5, 6.0, 6.5], [-1.5, -10, 8.6, 7.5], [6, -8.8, 6.5, 6.5], [11.5, -5.5, 4.5, 5.5], [-12.5, -5.5, 4.2, 5.2],
    [-21, 9, 3.4, 5.5], [-20, -9, 4.2, 6], [18, -14, 3.8, 5.5], [21, 4, 2.8, 4.5], [-4, -20, 3.6, 6], [10, -21, 3.0, 5],
    // the outer mountain ring
    [28, -24, 4.6, 6.5], [-30, -22, 5.0, 7], [36, -10, 3.6, 5.5], [-8, -33, 4.6, 6.5], [8, -34, 4.0, 6],
    [-18, -30, 3.8, 6], [20, -31, 3.6, 6],
  ];
  const ZONES = [
    { x: -6.2, z: 6.8, r: 2.2, y: 0 },
    { x: -3.6, z: 8.0, r: 2.0, y: 0 },
    { x: -8.8, z: 8.0, r: 1.6, y: 0 },
    { x: -0.5, z: -3.2, r: 2.0, y: 0 },
    { x: 9.8, z: 0.2, r: 3.2, y: 0 },
    { x: 2.0, z: 9.5, r: 1.5, y: 0 },
    { x: 10.8, z: 6.6, r: 1.3, y: 0 },
    { x: -9.6, z: -1.2, r: 2.0, y: 0 },
    { x: -5.6, z: 0.3, r: 2.0, y: -0.18 },
    { x: -1.4, z: 10.8, r: 1.5, y: 0 },
    { x: -15.5, z: 7.5, r: 6.0, y: 0 },
    { x: 24.0, z: -4.0, r: 6.0, y: 0 },
    { x: 31.0, z: 8.0, r: 5.2, y: -0.18 },   // the lake
    { x: 33.0, z: 27.0, r: 2.6, y: 0 },      // the lighthouse
  ];
  const roadPts = [
    [-21, 1.2], [-17, 2.2], [-13.4, 3.0], [-10, 5.5], [-6, 4.2], [-2.5, 5.8], [1.5, 4.5], [4.5, 2.5], [7.5, 4.0], [8.6, 7.4],
    [7.8, 10.2], [6.9, 13.4], [7.5, 16.5], [7.8, 19.4], [7.7, AVENUE_Z],
  ];
  const roadCurve = new THREE.CatmullRomCurve3(roadPts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const roadSamples = roadCurve.getSpacedPoints(180);
  function roadDist(x, z) {
    let m = 1e9;
    for (const p of roadSamples) { const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z); if (d < m) m = d; }
    return Math.sqrt(m);
  }

  const HILL_SOFTEN = 0.62;
  function terrainH(x, z) {
    const r = Math.hypot(x, z);
    let h = 0;
    for (const b of BUMPS) { const d = Math.hypot(x - b[0], z - b[1]); if (d < b[3]) h += b[2] * HILL_SOFTEN * Math.pow(1 - d / b[3], 1.6); }
    if (h > 0.3) h += (vnoise(x * 0.9, z * 0.9) - 0.5) * 0.55 * Math.min(1, h / 3);
    h *= 1 - smoothstep(R - 4, R - 0.6, r);
    h += (vnoise(x * 0.35 + 10, z * 0.35) - 0.5) * 0.35 * (1 - Math.min(1, h / 1.2));
    h = lerp(h, 0, 1 - smoothstep(2.2, 4.4, roadDist(x, z)));
    for (const zn of ZONES) { const d = Math.hypot(x - zn.x, z - zn.z); h = lerp(h, zn.y, 1 - smoothstep(zn.r, zn.r * 1.8, d)); }
    h = lerp(h, 0, rectMask(x, z, CITY, 2.4));
    h = lerp(h, 0, rectMask(x, z, CITY2, 2.4));
    h = lerp(h, 0, rectMask(x, z, AIRPORT, 3.0));
    h = lerp(h, 0, rectMask(x, z, RAIL, 2.4));
    return lerp(h, 0, smoothstep(R - 0.8, R, r));
  }
  function inRect(x, z, r, margin) { return x > r.x0 - margin && x < r.x1 + margin && z > r.z0 - margin && z < r.z1 + margin; }
  function isClear(x, z, margin) {
    for (const zn of ZONES) if (Math.hypot(x - zn.x, z - zn.z) < zn.r + margin) return false;
    if (inRect(x, z, CITY, margin + 1) || inRect(x, z, CITY2, margin + 1) || inRect(x, z, AIRPORT, margin + 1) || inRect(x, z, RAIL, margin + 1)) return false;
    return roadDist(x, z) > 1.5 + margin;
  }

  const STOPS = [[0, '#7bd88f'], [0.7, '#62c4a0'], [1.5, '#7d74d8'], [3, '#6a55c8'], [4.8, '#4b3fa6'], [6.2, '#7c6be0'], [7.6, '#c9bfff'], [9.5, '#f0ecff']]
    .map(([h, c]) => [h, new THREE.Color(c)]);
  function terrainColor(h, rnd, out) {
    let i = 0;
    while (i < STOPS.length - 2 && h > STOPS[i + 1][0]) i++;
    const [h0, c0] = STOPS[i], [h1, c1] = STOPS[i + 1];
    out.copy(c0).lerp(c1, clamp((h - h0) / (h1 - h0), 0, 1));
    out.offsetHSL(0, 0, (Math.floor(h / 0.9) % 2 ? 0.035 : 0) + (rnd - 0.5) * 0.07);
    return out;
  }

  let terrain;
  await stage(0.08, 'Raising the island', () => {
    const RINGS = simple ? 30 : 58, SEG = simple ? 72 : 144;
    const grid = [];
    for (let i = 0; i <= RINGS; i++) {
      const row = [], r = (R * i) / RINGS;
      for (let j = 0; j < SEG; j++) {
        const a = (TAU * j) / SEG;
        let x = r * Math.cos(a), z = r * Math.sin(a);
        if (i > 0 && i < RINGS) {
          const ox = x, oz = z, jit = (R / RINGS) * 0.26;
          x += (hash3(ox * 10, 1, oz * 10) - 0.5) * jit * 2; z += (hash3(ox * 10, 2, oz * 10) - 0.5) * jit * 2;
        }
        row.push([x, terrainH(x, z), z]);
      }
      grid.push(row);
    }
    const tris = [];
    for (let i = 0; i < RINGS; i++) {
      for (let j = 0; j < SEG; j++) {
        const j1 = (j + 1) % SEG;
        const A = grid[i][j], B = grid[i][j1], C = grid[i + 1][j], D = grid[i + 1][j1];
        if (i > 0) tris.push([A, B, C]);
        tris.push([B, D, C]);
      }
    }
    const pos = new Float32Array(tris.length * 9), col = new Float32Array(tris.length * 9), c = new THREE.Color();
    tris.forEach((t, n) => {
      const avg = (t[0][1] + t[1][1] + t[2][1]) / 3;
      terrainColor(avg, hash3(t[0][0] * 7, avg * 5, t[0][2] * 7), c);
      for (let k = 0; k < 3; k++) { pos.set(t[k], n * 9 + k * 3); c.toArray(col, n * 9 + k * 3); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    terrain = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    terrain.castShadow = true; terrain.receiveShadow = true;
    W.add(terrain);

    const soil = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.94, 1.4, SEG, 1, true), mat('#b9825f'));
    soil.position.y = -0.7; soil.receiveShadow = true; W.add(soil);

    const lip = new THREE.Mesh(new THREE.TorusGeometry(R - 0.02, 0.1, 6, SEG), mat('#6fd08a'));
    lip.rotation.x = Math.PI / 2; lip.position.y = 0.01; W.add(lip);

    const rockH = 22, top = rockH / 2;
    const rockGeo = new THREE.ConeGeometry(R * 0.94, rockH, simple ? 22 : 40, 6, true);
    const rp = rockGeo.attributes.position;
    for (let i = 0; i < rp.count; i++) {
      const x = rp.getX(i), y = rp.getY(i), z = rp.getZ(i);
      const amp = clamp((y + top) / 3, 0, 1);
      rp.setXYZ(i, x + (hash3(x, y, z) - 0.5) * amp * 2.6, y + (hash3(x, y + 1, z) - 0.5) * amp, z + (hash3(x, y, z + 1) - 0.5) * amp * 2.6);
    }
    const rock = new THREE.Mesh(rockGeo, mat('#5a4aa8'));
    rock.rotation.x = Math.PI; rock.position.y = -1.4 - top; rock.castShadow = true; W.add(rock);
  });

  await stage(0.14, 'Paving the roads', () => {
    const N = 260;
    const pts = roadCurve.getSpacedPoints(N);
    const side = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N, i + 1)];
      const t = new THREE.Vector3().subVectors(b, a).setY(0).normalize();
      return new THREE.Vector3(-t.z, 0, t.x);
    });
    function ribbon(o1, o2, y, color, offset) {
      const verts = [];
      const lim = (p, s, o) => [p.x + s.x * o, y, p.z + s.z * o];
      for (let i = 0; i < N; i++) {
        const L0 = lim(pts[i], side[i], o1), R0 = lim(pts[i], side[i], o2), L1 = lim(pts[i + 1], side[i + 1], o1), R1 = lim(pts[i + 1], side[i + 1], o2);
        if (Math.hypot(pts[i].x, pts[i].z) > R - 0.4) continue;
        verts.push(...L0, ...R0, ...L1, ...R0, ...R1, ...L1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: offset, polygonOffsetUnits: offset }));
      m.receiveShadow = true; W.add(m);
    }
    ribbon(-0.78, 0.78, 0.05, '#3f3d66', -1);
    ribbon(-0.93, -0.78, 0.06, '#f5e6c8', -2);
    ribbon(0.78, 0.93, 0.06, '#f5e6c8', -2);

    const dashes = 56, im = new THREE.InstancedMesh(geo('box', () => new THREE.BoxGeometry(1, 1, 1)), new THREE.MeshLambertMaterial({ color: '#fff1dc' }), dashes);
    const d = new THREE.Object3D();
    for (let i = 0; i < dashes; i++) {
      const u = 0.01 + (i / dashes) * 0.97, p = roadCurve.getPointAt(u), t = roadCurve.getTangentAt(u);
      if (Math.hypot(p.x, p.z) > R - 0.9 || u > 0.985) { d.scale.set(0, 0, 0); } else { d.scale.set(0.42, 0.012, 0.07); }
      d.position.set(p.x, 0.07, p.z); d.rotation.set(0, -Math.atan2(t.z, t.x), 0); d.updateMatrix(); im.setMatrixAt(i, d.matrix);
    }
    W.add(im);
  });

  /* ---------------------------------------------------------------- */
  /* 4. nature: trees, bushes, rocks, flowers, pond                    */
  /* ---------------------------------------------------------------- */
  const rng = mulberry32(20260);
  let trees = null;
  const treeData = [];

  await stage(0.2, 'Planting pine trees', () => {
    const parts = [];
    parts.push(paintGeo(new THREE.CylinderGeometry(0.07, 0.1, 0.5, 5).translate(0, 0.25, 0), '#8a5a44'));
    parts.push(paintGeo(new THREE.ConeGeometry(0.5, 0.8, 7).translate(0, 0.75, 0), '#2f9e78'));
    parts.push(paintGeo(new THREE.ConeGeometry(0.39, 0.7, 7).translate(0, 1.2, 0), '#38ae84'));
    parts.push(paintGeo(new THREE.ConeGeometry(0.26, 0.6, 7).translate(0, 1.6, 0), '#46c28f'));
    const treeGeo = mergeGeometries(parts);

    const target = simple ? 130 : small ? 240 : 420;
    for (let tries = 0; tries < 16000 && treeData.length < target; tries++) {
      const rr = Math.sqrt(rng()) * (R - 2.2), a = rng() * TAU, x = rr * Math.cos(a), z = rr * Math.sin(a);
      if (vnoise(x * 0.28 + 3, z * 0.28) < 0.38 && rng() < 0.85) continue;
      const h = terrainH(x, z);
      if (h > 5.3 || !isClear(x, z, 0.9)) continue;
      if (treeData.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < 1.2)) continue;
      treeData.push({ x, y: h - 0.05, z, s: (0.7 + rng() * 0.7) * (1 - h / 16), ry: rng() * TAU, ph: rng() * TAU });
    }
    trees = new THREE.InstancedMesh(treeGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), treeData.length);
    const tints = ['#ffffff', '#f0ecff', '#e3fff1', '#ffffff'].map((c) => new THREE.Color(c));
    treeData.forEach((t, i) => trees.setColorAt(i, tints[i % tints.length]));
    trees.castShadow = true; trees.receiveShadow = true; trees.frustumCulled = false;
    W.add(trees);

    const dummy = new THREE.Object3D();
    let swayFrame = 0;
    const place = (t, time) => {
      dummy.position.set(t.x, t.y, t.z);
      dummy.rotation.set(Math.sin(time * 1.3 + t.ph) * 0.03, t.ry, Math.cos(time * 1.1 + t.ph) * 0.03);
      dummy.scale.setScalar(t.s); dummy.updateMatrix();
    };
    treeData.forEach((t, i) => { place(t, 0); trees.setMatrixAt(i, dummy.matrix); });
    animators.push((dt, time) => {
      if ((swayFrame++ & 1) || small) return;
      treeData.forEach((t, i) => { place(t, time); trees.setMatrixAt(i, dummy.matrix); });
      trees.instanceMatrix.needsUpdate = true;
    });
  });

  await stage(0.26, 'Blooming blossom trees and bushes', () => {
    const parts = [paintGeo(new THREE.CylinderGeometry(0.06, 0.1, 0.7, 6).toNonIndexed().translate(0, 0.35, 0), '#8a5a44')];
    [[0, 1.0, 0, 0.5], [0.3, 0.85, 0.12, 0.34], [-0.28, 0.9, -0.1, 0.36], [0.05, 1.32, 0.05, 0.34]].forEach(([x, y, z, r]) => {
      parts.push(paintGeo(new THREE.IcosahedronGeometry(r, 1).translate(x, y, z), '#ffffff'));
    });
    const bGeo = mergeGeometries(parts);
    const blossoms = [];
    const want = simple ? 12 : 46;
    for (let tries = 0; tries < 5000 && blossoms.length < want; tries++) {
      const rr = Math.sqrt(rng()) * (R - 3), a = rng() * TAU, x = rr * Math.cos(a), z = rr * Math.sin(a), h = terrainH(x, z);
      if (h > 1.2 || !isClear(x, z, 1.3)) continue;
      if (treeData.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < 2.2)) continue;
      if (blossoms.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < 4)) continue;
      blossoms.push({ x, y: h - 0.03, z, s: 0.95 + rng() * 0.6, ry: rng() * TAU });
    }
    const bMesh = new THREE.InstancedMesh(bGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), blossoms.length);
    const bc = ['#ffb3c7', '#ffc9a8', '#ffd98a', '#ffa0bd', '#f6b8ff'].map((c) => new THREE.Color(c)), d = new THREE.Object3D();
    blossoms.forEach((t, i) => {
      d.position.set(t.x, t.y, t.z); d.rotation.set(0, t.ry, 0); d.scale.setScalar(t.s); d.updateMatrix();
      bMesh.setMatrixAt(i, d.matrix); bMesh.setColorAt(i, bc[i % bc.length]);
    });
    bMesh.castShadow = true; bMesh.receiveShadow = true; bMesh.frustumCulled = false; W.add(bMesh);

    const bushes = [];
    for (let tries = 0; tries < 5000 && bushes.length < (simple ? 45 : 160); tries++) {
      const rr = Math.sqrt(rng()) * (R - 2), a = rng() * TAU, x = rr * Math.cos(a), z = rr * Math.sin(a), h = terrainH(x, z);
      if (h > 2.6 || !isClear(x, z, 0.5)) continue;
      bushes.push({ x, y: h, z, s: 0.5 + rng() * 0.6 });
    }
    const bushMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.4, 1), new THREE.MeshLambertMaterial({ flatShading: true }), bushes.length);
    const gc = ['#3fae7a', '#55c28a', '#2f9e78', '#6fd08a'].map((c) => new THREE.Color(c));
    bushes.forEach((b, i) => {
      d.position.set(b.x, b.y + b.s * 0.16, b.z); d.rotation.set(0, i, 0); d.scale.set(b.s * 1.3, b.s, b.s * 1.1); d.updateMatrix();
      bushMesh.setMatrixAt(i, d.matrix); bushMesh.setColorAt(i, gc[i % gc.length]);
    });
    bushMesh.castShadow = true; bushMesh.receiveShadow = true; W.add(bushMesh);
  });

  await stage(0.32, 'Scattering rocks and flowers', () => {
    const rocks = [];
    for (let tries = 0; tries < 2500 && rocks.length < (simple ? 26 : 70); tries++) {
      const rr = Math.sqrt(rng()) * (R - 1.5), a = rng() * TAU, x = rr * Math.cos(a), z = rr * Math.sin(a), h = terrainH(x, z);
      if (h > 6.5 || !isClear(x, z, 0.7)) continue;
      rocks.push({ x, y: h, z, s: 0.25 + rng() * 0.45, ry: rng() * TAU });
    }
    const rockMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshLambertMaterial({ flatShading: true }), rocks.length);
    const rc = ['#8a84b8', '#a79fd6', '#6f6aa0'].map((c) => new THREE.Color(c)), d = new THREE.Object3D();
    rocks.forEach((r, i) => {
      d.position.set(r.x, r.y + r.s * 0.15, r.z); d.rotation.set(rng(), r.ry, rng()); d.scale.set(r.s * 1.3, r.s, r.s * 1.1); d.updateMatrix();
      rockMesh.setMatrixAt(i, d.matrix); rockMesh.setColorAt(i, rc[i % 3]);
    });
    rockMesh.castShadow = true; rockMesh.receiveShadow = true; W.add(rockMesh);

    const flowers = [];
    for (let tries = 0; tries < 5000 && flowers.length < (simple ? 90 : 360); tries++) {
      const rr = Math.sqrt(rng()) * (R - 1.5), a = rng() * TAU, x = rr * Math.cos(a), z = rr * Math.sin(a), h = terrainH(x, z);
      if (h > 0.6 || !isClear(x, z, 0.3)) continue;
      flowers.push({ x, y: h, z, s: 0.8 + rng() * 0.6 });
    }
    const fm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.075, 0), new THREE.MeshLambertMaterial({ flatShading: true }), flowers.length);
    const stems = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.01, 0.012, 0.18, 4), new THREE.MeshLambertMaterial({ color: '#3f9e6a' }), flowers.length);
    const fc = ['#ff6b5e', '#ffe08a', '#ffffff', '#ff9fb8', '#c9a7ff', '#7ee8ff'].map((c) => new THREE.Color(c));
    flowers.forEach((f, i) => {
      d.position.set(f.x, f.y + 0.09 * f.s, f.z); d.rotation.set(0, 0, 0); d.scale.setScalar(f.s); d.updateMatrix(); stems.setMatrixAt(i, d.matrix);
      d.position.set(f.x, f.y + 0.2 * f.s, f.z); d.updateMatrix(); fm.setMatrixAt(i, d.matrix); fm.setColorAt(i, fc[i % fc.length]);
    });
    W.add(stems); W.add(fm);

    const pond = new THREE.Group(); pond.position.set(-5.6, 0, 0.3); W.add(pond);
    const bank = cyl(pond, 2.1, 2.2, 0.06, 20, 0, -0.11, 0, '#c9b28a'); bank.castShadow = false;
    const water = cyl(pond, 1.9, 1.9, 0.04, 20, 0, -0.07, 0, '#5fd0e8', { emissive: '#1f7f9a', emissiveIntensity: 0.35 });
    water.castShadow = false;
    for (let i = 0; i < 9; i++) {
      const a = rng() * TAU, r = 1.85 + rng() * 0.3;
      if (i < 5) cone(pond, 0.05, 0.6 + rng() * 0.3, 4, Math.cos(a) * r, 0.2, Math.sin(a) * r, '#3f9e6a');
      else {
        const lp = cyl(pond, 0.22, 0.22, 0.02, 8, Math.cos(a) * (r - 0.9), -0.04, Math.sin(a) * (r - 0.9), '#4fae7a'); lp.castShadow = false;
        ball(pond, 0.05, Math.cos(a) * (r - 0.9), -0.01, Math.sin(a) * (r - 0.9), '#ffb3c7').castShadow = false;
      }
    }
    const ripples = [0, 1, 2].map((i) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 0.96, 28), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(0.6, -0.04, -0.2); pond.add(m); return { m, off: i / 3 };
    });
    animators.push((dt, t) => {
      water.material.emissiveIntensity = 0.3 + Math.sin(t * 1.4) * 0.08;
      ripples.forEach((r) => { const k = (t * 0.28 + r.off) % 1; r.m.scale.setScalar(0.15 + k * 0.95); r.m.material.opacity = (1 - k) * 0.5; });
    });
  });

  /* ---------------------------------------------------------------- */
  /* makePerson: a small, friendly person with a face                  */
  /* ---------------------------------------------------------------- */
  function makePerson(o = {}) {
    const skin = o.skin || '#f2c7a5', shirt = o.shirt || '#ff6b5e', pants = o.pants || '#2b2850';
    const hairC = o.hair || '#241f4d', shoeC = o.shoes || '#fff8ec', HIP = 0.4;
    const soft = (c, x) => mat(c, { flatShading: false, ...x });
    const sphere = (p, r, x, y, z, color, shadow = true) => put(p, geo(`sball${r}`, () => new THREE.SphereGeometry(r, 16, 12)), soft(color), x, y, z, shadow);
    const smallPart = (p, g, m, x = 0, y = 0, z = 0) => { const me = new THREE.Mesh(g, m); me.position.set(x, y, z); me.castShadow = false; me.receiveShadow = false; p.add(me); return me; };

    const g = new THREE.Group();
    const upper = new THREE.Group(); upper.position.y = HIP; g.add(upper);

    const torso = cyl(upper, 0.12, 0.105, 0.38, 14, 0, 0.19, 0, shirt, { flatShading: false }); torso.scale.set(0.8, 1, 1.3);
    const sh = put(upper, geo('shoulder', () => new THREE.SphereGeometry(0.1, 14, 10)), soft(shirt), 0, 0.345, 0); sh.scale.set(0.82, 0.55, 1.75);
    const belt = cyl(upper, 0.108, 0.108, 0.045, 14, 0, 0.03, 0, o.belt || '#3a2f5b', { flatShading: false }); belt.scale.set(0.8, 1, 1.3); belt.castShadow = false;
    box(upper, 0.03, 0.04, 0.05, 0.088, 0.03, 0, '#e8b23a').castShadow = false;
    cyl(upper, 0.042, 0.048, 0.08, 10, 0, 0.41, 0, skin, { flatShading: false });

    const head = new THREE.Group(); head.position.set(0.01, 0.56, 0); upper.add(head);
    const skull = sphere(head, 0.135, 0, 0, 0, skin); skull.scale.set(0.95, 1.08, 0.92);
    sphere(head, 0.03, 0, -0.01, 0.126, skin, false).scale.set(0.5, 1, 0.8);
    sphere(head, 0.03, 0, -0.01, -0.126, skin, false).scale.set(0.5, 1, 0.8);
    [0.05, -0.05].forEach((z) => {
      const white = smallPart(head, geo('eyeW', () => new THREE.SphereGeometry(0.026, 12, 8)), soft('#ffffff'), 0.109, 0.014, z); white.scale.set(0.7, 1, 0.95);
      smallPart(head, geo('eyeP', () => new THREE.SphereGeometry(0.0145, 10, 8)), soft('#241f4d'), 0.124, 0.012, z);
      smallPart(head, geo('eyeS', () => new THREE.SphereGeometry(0.005, 6, 5)), soft('#ffffff'), 0.134, 0.02, z + 0.004);
      const brow = smallPart(head, geo('brow', () => new THREE.BoxGeometry(0.012, 0.011, 0.05)), soft(hairC), 0.108, 0.058, z); brow.rotation.x = z > 0 ? 0.12 : -0.12;
      smallPart(head, geo('cheek', () => new THREE.SphereGeometry(0.02, 8, 6)), soft('#f7a090'), 0.1, -0.03, z * 1.55).scale.set(0.5, 0.7, 1);
    });
    const nose = smallPart(head, geo('nose', () => new THREE.SphereGeometry(0.02, 10, 8)), soft(skin), 0.126, -0.012, 0); nose.scale.set(0.9, 1.1, 0.85);
    const smileHolder = new THREE.Group(); smileHolder.position.set(0.115, -0.047, 0); smileHolder.rotation.y = Math.PI / 2; head.add(smileHolder);
    const smile = smallPart(smileHolder, geo('smile', () => new THREE.TorusGeometry(0.028, 0.0065, 6, 12, Math.PI)), soft('#a8453f'));
    smile.rotation.z = Math.PI;

    const hairMat = soft(hairC);
    const style = o.hairStyle || 'short';
    if (style !== 'none' && o.hat !== 'beanie') {
      const cap = put(head, geo('haircap', () => new THREE.SphereGeometry(0.149, 18, 10, 0, TAU, 0, Math.PI * 0.56)), hairMat, -0.006, 0.01, 0, false);
      cap.scale.set(1.0, 1.07, 0.98); cap.rotation.z = 0.32; cap.castShadow = true;
      const fringe = smallPart(head, geo('fringe', () => new THREE.BoxGeometry(0.05, 0.035, 0.2)), hairMat, 0.097, 0.092, 0); fringe.rotation.z = -0.5;
      smallPart(head, geo('sidehair', () => new THREE.BoxGeometry(0.05, 0.08, 0.02)), hairMat, 0.02, 0.01, 0.12);
      smallPart(head, geo('sidehair', () => new THREE.BoxGeometry(0.05, 0.08, 0.02)), hairMat, 0.02, 0.01, -0.12);
      if (style === 'long' || style === 'pony') {
        const back = smallPart(head, geo('hairback', () => new THREE.SphereGeometry(0.14, 14, 10)), hairMat, -0.05, -0.06, 0); back.scale.set(0.72, 1.25, 1.0); back.castShadow = true;
      }
      if (style === 'pony') {
        const tail = smallPart(head, geo('pony', () => new THREE.CylinderGeometry(0.035, 0.012, 0.26, 8)), hairMat, -0.18, -0.07, 0); tail.rotation.z = 0.5; tail.castShadow = true;
        smallPart(head, geo('tie', () => new THREE.SphereGeometry(0.028, 8, 6)), soft('#ff6b5e'), -0.14, 0.04, 0);
      }
    }
    if (o.hat === 'straw') {
      const brim = cyl(head, 0.27, 0.27, 0.025, 20, 0, 0.1, 0, '#e8c36a', { flatShading: false });
      const crown = cyl(head, 0.115, 0.135, 0.11, 16, 0, 0.16, 0, '#e8c36a', { flatShading: false });
      cyl(head, 0.138, 0.138, 0.03, 16, 0, 0.125, 0, o.hatColor || '#e8564a', { flatShading: false }).castShadow = false;
      brim.rotation.z = 0.05; crown.castShadow = true;
    }
    if (o.hat === 'beanie') {
      const dome = put(head, geo('beanie', () => new THREE.SphereGeometry(0.152, 16, 10, 0, TAU, 0, Math.PI * 0.55)), soft(o.hatColor || '#ff6b5e'), -0.005, 0.015, 0, true);
      dome.scale.set(1, 1.05, 1); dome.rotation.z = 0.15;
      cyl(head, 0.152, 0.152, 0.05, 16, 0, 0.045, 0, '#fff1dc', { flatShading: false });
      sphere(head, 0.045, -0.01, 0.17, 0, '#fff1dc');
    }

    function makeArm(zSide) {
      const arm = new THREE.Group(); arm.position.set(0, 0.34, zSide * 0.19); upper.add(arm);
      sphere(arm, 0.052, 0, 0, 0, shirt);
      cyl(arm, 0.047, 0.04, 0.2, 10, 0, -0.1, 0, shirt, { flatShading: false });
      const elbow = new THREE.Group(); elbow.position.y = -0.2; elbow.rotation.z = 0.12; arm.add(elbow);
      cyl(elbow, 0.036, 0.029, 0.17, 10, 0, -0.085, 0, o.longSleeve ? shirt : skin, { flatShading: false });
      sphere(elbow, 0.035, 0, -0.185, 0, skin);
      return { arm, elbow };
    }
    const aL = makeArm(1), aR = makeArm(-1);

    function makeLeg(zSide) {
      const leg = new THREE.Group(); leg.position.set(0, HIP, zSide * 0.075); g.add(leg);
      cyl(leg, 0.062, 0.049, 0.2, 10, 0, -0.1, 0, pants, { flatShading: false });
      const shin = new THREE.Group(); shin.position.y = -0.2; leg.add(shin);
      cyl(shin, 0.049, 0.037, 0.19, 10, 0, -0.095, 0, o.shorts ? skin : pants, { flatShading: false });
      sphere(shin, 0.05, 0, 0, 0, o.shorts ? skin : pants, false);
      box(shin, 0.17, 0.065, 0.09, 0.035, -0.172, 0, shoeC);
      box(shin, 0.175, 0.02, 0.095, 0.035, -0.2, 0, '#2b2850').castShadow = false;
      return { leg, shin };
    }
    const lL = makeLeg(1), lR = makeLeg(-1);

    if (o.backpack) {
      box(upper, 0.13, 0.28, 0.22, -0.17, 0.2, 0, o.backpack);
      box(upper, 0.11, 0.1, 0.19, -0.2, 0.32, 0, o.backpack);
      [0.1, -0.1].forEach((z) => box(upper, 0.02, 0.26, 0.035, 0.1, 0.2, z, '#2b2850').castShadow = false);
    }
    return { group: g, upper, head, armL: aL.arm, armR: aR.arm, elbowL: aL.elbow, elbowR: aR.elbow, legL: lL.leg, legR: lR.leg, shinL: lL.shin, shinR: lR.shin };
  }

  /* ---------------------------------------------------------------- */
  /* AGENTS: people with a job                                         */
  /*   { go: [x, z] } walk | { wait, pose, face } stand | { do: fn } act */
  /*   POSES: idle walk type draw phone talk point farm water give sit wave fish */
  /* ---------------------------------------------------------------- */
  const JOINTS = ['up', 'hy', 'hz', 'alx', 'alz', 'arx', 'arz', 'elz', 'erz', 'elx', 'erx', 'll', 'lr', 'sl', 'sr'];
  function poseTarget(a, pose, t) {
    const ph = a.ph, wp = a.wp;
    const T = { up: 0, hy: 0, hz: 0, alx: 0, alz: 0.03, arx: 0, arz: 0.03, elz: 0.12, erz: 0.12, elx: 0, erx: 0, ll: 0, lr: 0, sl: 0, sr: 0 };
    const seated = () => { T.ll = T.lr = 1.5; T.sl = T.sr = -1.5; };
    switch (pose) {
      case 'walk': {
        const sw = Math.sin(wp) * 0.6;
        T.ll = sw; T.lr = -sw;
        T.sl = -(0.5 + 0.5 * Math.sin(wp + 1.6)) * 0.55; T.sr = -(0.5 + 0.5 * Math.sin(wp + 1.6 + Math.PI)) * 0.55;
        if (a.carry) { T.alz = 0.9; T.arz = 0.9; T.elz = 0.9; T.erz = 0.9; }
        else { T.alz = -sw * 0.8; T.arz = sw * 0.8; T.elz = 0.35 + Math.max(0, sw) * 0.3; T.erz = 0.35 + Math.max(0, -sw) * 0.3; }
        T.up = -0.06; T.hy = Math.sin(t * 0.8 + ph) * 0.15; break;
      }
      case 'type':
        seated(); T.alz = 1.15 + Math.sin(t * 13 + ph) * 0.03; T.arz = 1.15 + Math.sin(t * 11 + ph) * 0.03;
        T.elz = 0.55 + Math.sin(t * 17 + ph) * 0.12; T.erz = 0.55 + Math.sin(t * 15 + ph + 1) * 0.12;
        T.hz = 0.1; T.hy = Math.sin(t * 0.6 + ph) * 0.15; T.up = -0.04; break;
      case 'draw':
        seated(); T.alz = 1.1; T.elz = 0.5; T.arz = 1.0 + Math.sin(t * 2.5 + ph) * 0.18;
        T.erz = 0.5 + Math.sin(t * 5 + ph) * 0.3; T.erx = Math.sin(t * 3.2 + ph) * 0.25;
        T.hz = 0.15; T.hy = Math.sin(t * 0.7 + ph) * 0.2; T.up = -0.05; break;
      case 'phone':
        seated(); T.alz = 0.5; T.elz = 2.3; T.arz = 1.15 + Math.sin(t * 11 + ph) * 0.03; T.erz = 0.55 + Math.sin(t * 15 + ph) * 0.12;
        T.hz = -0.05; T.hy = Math.sin(t * 1.2 + ph) * 0.2; T.up = -0.03; break;
      case 'talk':
        T.alx = -0.35 + Math.sin(t * 2.3 + ph) * 0.25; T.alz = 0.9 + Math.sin(t * 3.1 + ph) * 0.25;
        T.arx = 0.35 - Math.sin(t * 2.3 + ph + 1) * 0.25; T.arz = 0.9 + Math.sin(t * 2.7 + ph + 0.8) * 0.25;
        T.elz = 0.9 + Math.sin(t * 4.1 + ph) * 0.35; T.erz = 0.9 + Math.sin(t * 3.7 + ph + 1) * 0.35;
        T.hy = Math.sin(t * 1.1 + ph) * 0.35; T.hz = Math.sin(t * 2 + ph) * 0.06; T.up = Math.sin(t * 1.3 + ph) * 0.03; break;
      case 'point':
        T.arz = 1.45; T.erz = 0.05; T.alz = 0.08; T.hy = 0.1; break;
      case 'farm': {
        const s = Math.sin(t * 3 + ph);
        T.up = -0.5 - 0.1 * s; T.hz = 0.45; T.alz = 0.9 + s * 0.5; T.arz = 0.95 + s * 0.5; T.elz = 0.3; T.erz = 0.3;
        T.ll = T.lr = 0.15; T.sl = T.sr = -0.1; break;
      }
      case 'water':
        T.up = -0.1; T.arz = 1.1; T.erz = 0.2; T.alz = 0.5; T.elz = 0.5; T.hz = 0.1; T.hy = Math.sin(t * 0.8 + ph) * 0.2; break;
      case 'give':
        T.alz = 1.2 + Math.sin(t * 3 + ph) * 0.05; T.arz = 1.2; T.elz = 0.25; T.erz = 0.25; T.hz = 0.05; break;
      case 'sit':
        seated(); T.alz = 0.45; T.arz = 0.45; T.elz = 0.9; T.erz = 0.9; T.hy = Math.sin(t * 0.7 + ph) * 0.3; T.up = -0.03; break;
      case 'wave':
        T.arx = 2.2 + Math.sin(t * 1.8 + ph) * 0.12; T.erx = -Math.sin(t * 8.5 + ph) * 0.55;
        T.up = Math.sin(t * 1.4 + ph) * 0.025; T.hy = Math.sin(t * 0.8 + ph) * 0.3; break;
      case 'fish':
        T.alz = 1.15; T.arz = 0.95; T.elz = 0.3; T.erz = 0.3; T.hz = 0.18; T.up = Math.sin(t * 0.8) * 0.02 - 0.03; T.hy = Math.sin(t * 0.5) * 0.12; break;
      default:
        T.up = Math.sin(t * 1.5 + ph) * 0.015; T.hy = Math.sin(t * 0.5 + ph) * 0.25;
    }
    return T;
  }
  function applyPose(a, dt, t, snap) {
    const T = poseTarget(a, a.pose, t), k = snap ? 1 : 1 - Math.exp(-dt * 9), c = a.cur, p = a.p;
    for (const j of JOINTS) c[j] += (T[j] - c[j]) * k;
    p.upper.rotation.z = c.up; p.head.rotation.y = c.hy; p.head.rotation.z = c.hz;
    p.armL.rotation.x = c.alx; p.armL.rotation.z = c.alz; p.armR.rotation.x = c.arx; p.armR.rotation.z = c.arz;
    p.elbowL.rotation.z = c.elz; p.elbowL.rotation.x = c.elx; p.elbowR.rotation.z = c.erz; p.elbowR.rotation.x = c.erx;
    p.legL.rotation.z = c.ll; p.legR.rotation.z = c.lr; p.shinL.rotation.z = c.sl; p.shinR.rotation.z = c.sr;
  }

  const agents = [];
  function makeAgent(person, parent, o) {
    parent.add(person.group);
    const h0 = o.face ? -Math.atan2(o.face[1], o.face[0]) : (o.heading || 0);
    const a = {
      p: person, ground: o.ground || (() => 0), steps: o.steps, i: 0, timer: 0, speed: o.speed || 0.9,
      x: o.x || 0, z: o.z || 0, heading: h0, want: h0, wp: 0, ph: (agents.length * 1.7) % TAU, pose: 'idle',
      hidden: false, carry: false, tick: o.tick || null, cur: {},
    };
    JOINTS.forEach((j) => { a.cur[j] = 0; });
    agents.push(a);
    advanceAgent(a, 0.0001, 0);
    applyPose(a, 1, 0, true);
    placeAgent(a, 0);
    animators.push((dt, t) => { advanceAgent(a, dt, t); applyPose(a, dt, t, false); placeAgent(a, dt); });
    return a;
  }
  function advanceAgent(a, dt, t) {
    const n = a.steps.length;
    let guard = 0;
    while (guard++ < 10) {
      const s = a.steps[a.i];
      if (s.do) { s.do(a); a.i = (a.i + 1) % n; continue; }
      if (s.go) {
        const dx = s.go[0] - a.x, dz = s.go[1] - a.z, d = Math.hypot(dx, dz), sp = (s.speed || a.speed) * dt;
        if (d <= sp + 0.001) { a.x = s.go[0]; a.z = s.go[1]; a.i = (a.i + 1) % n; a.pose = 'idle'; continue; }
        a.x += (dx / d) * sp; a.z += (dz / d) * sp; a.wp += sp * 7.5; a.want = -Math.atan2(dz, dx); a.pose = s.pose || 'walk';
        break;
      }
      a.pose = s.pose || 'idle';
      if (s.face) a.want = -Math.atan2(s.face[1], s.face[0]);
      a.timer += dt;
      if (a.timer >= s.wait) { a.timer = 0; a.i = (a.i + 1) % n; continue; }
      break;
    }
    if (a.tick) a.tick(a, dt, t);
  }
  function placeAgent(a, dt) {
    let dA = a.want - a.heading; dA = Math.atan2(Math.sin(dA), Math.cos(dA));
    a.heading += dA * (dt ? Math.min(1, dt * 6) : 1);
    const bounce = a.pose === 'walk' ? Math.abs(Math.sin(a.wp)) * 0.02 : 0;
    a.p.group.position.set(a.x, a.ground(a.x, a.z) + bounce, a.z);
    a.p.group.rotation.y = a.heading;
    a.p.group.visible = !a.hidden;
  }

  function roadPath(ax, az, bx, bz, sideOffset = 0.35, stride = 3) {
    const nearest = (x, z) => { let bi = 0, bd = 1e9; roadSamples.forEach((p, i) => { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; bi = i; } }); return bi; };
    const ia = nearest(ax, az), ib = nearest(bx, bz), dir = ib >= ia ? 1 : -1, out = [];
    const at = (i) => {
      const p = roadSamples[i], q = roadSamples[Math.max(0, i - 1)], r = roadSamples[Math.min(roadSamples.length - 1, i + 1)];
      const tx = r.x - q.x, tz = r.z - q.z, len = Math.hypot(tx, tz) || 1;
      return [p.x + (tz / len) * sideOffset, p.z - (tx / len) * sideOffset];
    };
    for (let i = ia; dir > 0 ? i < ib : i > ib; i += dir * stride) out.push(at(i));
    out.push(at(ib));
    return out;
  }

  const doors = [];
  const monitorMats = [];
  let hqGroup = null;
  let hq2Group = null;
  let hq3Group = null;

  function makeHouse(x, z, face, wall, roof) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = face; W.add(g);
    box(g, 1.8, 0.95, 1.5, 0, 0.475, 0, wall);
    prism(g, 1.05, 1.65, 0, 1.22, 0, roof, 0.55);
    box(g, 0.4, 0.62, 0.02, 0, 0.31, 0.752, '#241f4d');
    const pivot = new THREE.Group(); pivot.position.set(-0.17, 0, 0.77); g.add(pivot);
    box(pivot, 0.34, 0.58, 0.04, 0.17, 0.3, 0, '#6c58cf');
    [-0.58, 0.58].forEach((wx) => box(g, 0.3, 0.28, 0.04, wx, 0.58, 0.76, '#bfe4ff', { emissive: '#9fd8ff', emissiveIntensity: 0.3 }));
    box(g, 0.22, 0.45, 0.22, 0.55, 1.45, -0.2, '#8a5a44');
    const d = { pivot, open: 0, target: 0 }; doors.push(d);
    const dx = Math.sin(face), dz = Math.cos(face);
    return { g, door: d, doorPt: [x + dx * 0.62, z + dz * 0.62], frontPt: [x + dx * 1.5, z + dz * 1.5] };
  }

  /* ---------------------------------------------------------------- */
  /* 5. landmarks                                                      */
  /* ---------------------------------------------------------------- */
  const van = { group: new THREE.Group(), body: new THREE.Group() };

  await stage(0.38, 'Parking the camper van', () => {
    van.group.position.set(-6.2, 0, 6.8); van.group.rotation.y = -0.25; W.add(van.group);
    const g = van.body; van.group.add(g);
    const CORAL = '#ff6b5e', CREAM = '#fff1dc', GLASS = '#bfe4ff', DARK = '#2b2850';
    box(g, 2.3, 0.12, 0.95, 0, 0.34, 0, DARK);
    box(g, 1.9, 1.15, 1.0, -0.2, 0.98, 0, CORAL);
    box(g, 0.5, 0.55, 1.0, 0.95, 0.68, 0, CORAL);
    box(g, 1.92, 0.16, 1.02, -0.2, 0.78, 0, CREAM);
    box(g, 1.5, 0.28, 0.9, -0.3, 1.7, 0, CREAM);
    const ws = box(g, 0.05, 0.5, 0.82, 0.8, 1.3, 0, GLASS); ws.rotation.z = -0.35;
    box(g, 0.42, 0.34, 1.03, 0.3, 1.25, 0, GLASS); box(g, 0.5, 0.34, 1.03, -0.5, 1.25, 0, GLASS);
    box(g, 0.06, 0.14, 0.2, 1.21, 0.78, 0.3, '#ffe08a', { emissive: '#ffcf55', emissiveIntensity: 0.6 });
    box(g, 0.06, 0.14, 0.2, 1.21, 0.78, -0.3, '#ffe08a', { emissive: '#ffcf55', emissiveIntensity: 0.6 });
    box(g, 0.08, 0.1, 1.0, 1.2, 0.5, 0, CREAM);
    box(g, 0.05, 0.12, 0.16, -1.16, 0.85, 0.35, '#e8564a'); box(g, 0.05, 0.12, 0.16, -1.16, 0.85, -0.35, '#e8564a');
    const rack = box(g, 1.3, 0.04, 0.7, -0.3, 1.88, 0, DARK);
    const board = box(g, 1.5, 0.05, 0.26, -0.3, 1.95, 0.12, '#5ac8c8'); board.rotation.y = 0.05; rack.castShadow = false;
    box(g, 0.4, 0.2, 0.3, -0.6, 2.0, -0.18, '#e8b23a');
    [[-0.7, 0.52], [-0.7, -0.52], [0.75, 0.52], [0.75, -0.52]].forEach(([x, z]) => {
      const w = cyl(g, 0.3, 0.3, 0.22, 12, x, 0.3, z, DARK); w.rotation.x = Math.PI / 2;
      const hub = cyl(g, 0.14, 0.14, 0.24, 8, x, 0.3, z, CREAM); hub.rotation.x = Math.PI / 2; hub.castShadow = false;
    });
    animators.push((dt, t) => { g.position.y = Math.sin(t * 2.2) * 0.012; g.rotation.z = Math.sin(t * 1.1) * 0.004; });

    const tent = new THREE.Group(); tent.position.set(-8.8, 0, 8.0); tent.rotation.y = 0.5; W.add(tent);
    const tc = cone(tent, 1.05, 1.15, 4, 0, 0.58, 0, '#5ac8c8'); tc.rotation.y = Math.PI / 4;
    box(tent, 0.01, 0.6, 0.45, 0.72, 0.32, 0, '#2b2850').rotation.y = 0;
    box(tent, 0.2, 0.2, 0.2, -1.4, 0.1, 0.6, '#e8b23a');

    const fire = new THREE.Group(); fire.position.set(-3.6, 0, 8.0); W.add(fire);
    for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU; put(fire, geo('stone', () => new THREE.IcosahedronGeometry(0.14, 0)), mat('#8a84b8'), Math.cos(a) * 0.4, 0.07, Math.sin(a) * 0.4); }
    box(fire, 0.6, 0.09, 0.09, 0, 0.12, 0, '#8a5a44').rotation.y = 0.6;
    box(fire, 0.6, 0.09, 0.09, 0, 0.12, 0, '#8a5a44').rotation.y = -0.6;
    const flameA = cone(fire, 0.2, 0.55, 5, 0, 0.42, 0, '#ff9a3c', { emissive: '#ff7a1c', emissiveIntensity: 0.9 }); flameA.castShadow = false;
    const flameB = cone(fire, 0.12, 0.38, 5, 0, 0.4, 0, '#ffd36e', { emissive: '#ffc94a', emissiveIntensity: 1 }); flameB.castShadow = false;
    const fglow = glow(fire, 0xff9a3c, 2.4, 0.55, 0, 0.5, 0);
    const smoke = [];
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(geo('smoke', () => new THREE.IcosahedronGeometry(0.14, 0)), new THREE.MeshLambertMaterial({ color: '#efeaff', transparent: true, opacity: 0.5, flatShading: true }));
      fire.add(m); smoke.push({ m, off: i / 5 });
    }
    [[-0.3, 1.0, 0.4], [1.9, 1.0, -0.5]].forEach(([a, r, ry]) => {
      const seat = cyl(fire, 0.17, 0.17, 0.55, 8, Math.cos(a) * r * 1.2, 0.17, Math.sin(a) * r * 1.2, '#a9714f'); seat.rotation.z = Math.PI / 2; seat.rotation.y = ry;
    });
    animators.push((dt, t) => {
      const f = 0.85 + Math.sin(t * 13) * 0.1 + Math.sin(t * 7.3) * 0.08;
      flameA.scale.set(1, f, 1); flameB.scale.set(1, 1.1 - (f - 0.85), 1); fglow.material.opacity = 0.45 + (f - 0.85) * 1.2;
      smoke.forEach((s) => {
        const k = (t * 0.22 + s.off) % 1;
        s.m.position.set(Math.sin(k * 6 + s.off * 9) * 0.12 + k * 0.3, 0.8 + k * 1.8, 0);
        s.m.scale.setScalar(0.5 + k * 1.4); s.m.material.opacity = 0.45 * (1 - k);
      });
    });
  });

  await stage(0.42, 'Building the Nexora tower', () => {
    const g = new THREE.Group(); g.position.set(-0.5, 0, -3.2); W.add(g);
    cyl(g, 2.0, 2.2, 0.2, 10, 0, 0.1, 0, '#d8d2ff');
    cyl(g, 0.55, 0.78, 1.6, 6, 0, 1.0, 0, '#4b3fa6');
    cyl(g, 0.8, 0.8, 0.1, 6, 0, 0.8, 0, '#5ac8c8');
    cyl(g, 0.95, 0.72, 0.28, 6, 0, 1.92, 0, '#6c58cf');
    put(g, geo('dome', () => new THREE.SphereGeometry(0.62, 10, 6, 0, TAU, 0, Math.PI / 2)), mat('#8f7fe6'), 0, 2.05, 0);
    cyl(g, 0.03, 0.03, 1.0, 5, 0, 2.7, 0, '#d8d2ff');
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU + 0.3, y = 0.7 + (i % 2) * 0.5;
      const w = box(g, 0.05, 0.24, 0.34, Math.cos(a) * 0.72, y, Math.sin(a) * 0.72, '#9ff3ff', { emissive: '#4fd1e0', emissiveIntensity: 0.8 });
      w.rotation.y = -a; w.castShadow = false;
    }
    box(g, 0.9, 0.05, 0.5, 1.5, 0.45, 0.5, '#2b2850').rotation.z = 0.3;
    cyl(g, 0.03, 0.03, 0.4, 4, 1.5, 0.25, 0.5, '#d8d2ff');

    const crystal = new THREE.Group(); crystal.position.set(0, 3.45, 0); g.add(crystal);
    const gem = put(crystal, geo('gem', () => new THREE.OctahedronGeometry(0.4, 0)), new THREE.MeshLambertMaterial({ color: '#7ee8ff', emissive: '#4fd1e0', emissiveIntensity: 0.9, flatShading: true }), 0, 0, 0, false);
    gem.scale.y = 1.4;
    const halo = new THREE.Mesh(geo('halo', () => new THREE.TorusGeometry(0.72, 0.02, 6, 28)), new THREE.MeshBasicMaterial({ color: '#b6f3ff' }));
    halo.rotation.x = Math.PI / 2.4; crystal.add(halo);
    const cg = glow(crystal, 0x4fd1e0, 3.2, 0.7);
    animators.push((dt, t) => {
      crystal.position.y = 3.45 + Math.sin(t * 1.5) * 0.12;
      gem.rotation.y += dt * 1.2; halo.rotation.z += dt * 0.9;
      cg.material.opacity = 0.55 + Math.sin(t * 2.4) * 0.15;
    });
  });

  await stage(0.47, 'Planting the farm', () => {
    const g = new THREE.Group(); g.position.set(9.8, 0, 0.2); W.add(g);
    const cropCount = 3 * 9, crops = new THREE.InstancedMesh(geo('crop', () => new THREE.ConeGeometry(0.17, 0.42, 5)), new THREE.MeshLambertMaterial({ flatShading: true }), cropCount);
    const dummy = new THREE.Object3D(), green = new THREE.Color('#7ed957'), gold = new THREE.Color('#f2c14e');
    [-1.45, 0, 1.45].forEach((z, bi) => {
      box(g, 3.4, 0.14 + bi * 0.07, 1.1, 0.4, (0.14 + bi * 0.07) / 2, z, '#9c6b4e');
      for (let k = 0; k < 9; k++) {
        const cx = 0.4 - 1.4 + (k % 9) * 0.35, cy = 0.14 + bi * 0.07 + 0.2;
        dummy.position.set(cx, cy, z + ((k % 2) - 0.5) * 0.3); dummy.rotation.set(0, k, 0); dummy.scale.setScalar(1); dummy.updateMatrix();
        crops.setMatrixAt(bi * 9 + k, dummy.matrix); crops.setColorAt(bi * 9 + k, (k + bi) % 3 === 0 ? gold : green);
      }
    });
    crops.castShadow = true; g.add(crops);
    for (let i = 0; i < 9; i++) box(g, 0.07, 0.42, 0.07, -1.5 + i * 0.5, 0.21, 2.95, '#b9825f');
    box(g, 4.1, 0.05, 0.05, 0.5, 0.33, 2.95, '#c9966f'); box(g, 4.1, 0.05, 0.05, 0.5, 0.16, 2.95, '#c9966f');

    const mill = new THREE.Group(); mill.position.set(-2.6, 0, 0.3); g.add(mill);
    cyl(mill, 0.34, 0.55, 1.7, 8, 0, 0.85, 0, '#fff1dc');
    cone(mill, 0.5, 0.5, 8, 0, 1.95, 0, '#e8564a');
    const blades = new THREE.Group(); blades.position.set(0, 1.6, 0.5); mill.add(blades);
    for (let i = 0; i < 4; i++) { const b = box(blades, 0.14, 1.0, 0.03, 0, 0.5, 0, '#fff8ec'); const pivot = new THREE.Group(); blades.remove(b); pivot.add(b); pivot.rotation.z = (i * Math.PI) / 2; blades.add(pivot); }
    box(blades, 0.14, 0.14, 0.14, 0, 0, 0, '#2b2850');
    animators.push((dt) => { blades.rotation.z -= dt * 0.9; });

    const barn = new THREE.Group(); barn.position.set(2.7, 0, -1.9); barn.rotation.y = -0.3; g.add(barn);
    box(barn, 1.3, 0.8, 1.05, 0, 0.4, 0, '#e8564a'); prism(barn, 0.76, 1.1, 0, 1.07, 0, '#8a5a44', 0.7);
    box(barn, 0.36, 0.5, 0.04, 0, 0.25, 0.54, '#fff1dc');
  });

  await stage(0.52, 'Raising the signpost, mailbox and school', () => {
    const g = new THREE.Group(); g.position.set(2.0, 0, 9.5); W.add(g);
    cyl(g, 0.7, 0.9, 0.15, 8, 0, 0.07, 0, '#4fae7a');
    cyl(g, 0.07, 0.09, 2.5, 6, 0, 1.25, 0, '#8a5a44');
    const arrow = new THREE.Shape();
    arrow.moveTo(0, -0.14); arrow.lineTo(0.9, -0.14); arrow.lineTo(1.12, 0); arrow.lineTo(0.9, 0.14); arrow.lineTo(0, 0.14); arrow.closePath();
    const arrowGeo = new THREE.ExtrudeGeometry(arrow, { depth: 0.06, bevelEnabled: false });
    ['#ff6b5e', '#5ac8c8', '#8f7fe6', '#e8b23a', '#4fae7a'].forEach((c, i) => {
      const m = put(g, arrowGeo, mat(c), 0.04, 0.55 + i * 0.36, -0.03);
      m.rotation.y = [-0.5, 0.35, -0.2, 0.55, -0.7][i];
    });
    const cubes = new THREE.Group(); cubes.position.y = 2.75; g.add(cubes);
    ['#ff6b5e', '#5ac8c8', '#8f7fe6', '#e8b23a', '#4fae7a', '#ff9fb8'].forEach((c, i) => {
      const a = (i / 6) * TAU; box(cubes, 0.17, 0.17, 0.17, Math.cos(a) * 0.9, Math.sin(i * 2) * 0.12, Math.sin(a) * 0.9, c);
    });
    animators.push((dt, t) => { cubes.rotation.y = t * 0.6; cubes.position.y = 2.75 + Math.sin(t * 1.4) * 0.08; });

    const mb = new THREE.Group(); mb.position.set(10.8, 0, 6.6); mb.rotation.y = -0.9; W.add(mb);
    box(mb, 0.12, 1.1, 0.12, 0, 0.55, 0, '#8a5a44');
    box(mb, 0.74, 0.4, 0.46, 0, 1.2, 0, '#ff6b5e'); box(mb, 0.66, 0.1, 0.38, 0, 1.45, 0, '#e8564a');
    box(mb, 0.04, 0.3, 0.04, 0.2, 0, 0, '#e8b23a');
    const flag = new THREE.Group(); flag.position.set(0.2, 1.2, 0.26); mb.add(flag); box(flag, 0.05, 0.32, 0.05, 0, 0.16, 0, '#e8b23a'); box(flag, 0.2, 0.12, 0.04, 0.1, 0.3, 0, '#e8b23a');
    const planeG = new THREE.Group(); W.add(planeG);
    const plane = new THREE.Mesh(geo('plane', () => new THREE.ConeGeometry(0.14, 0.55, 3)), new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true, emissive: '#cfe6ff', emissiveIntensity: 0.3 }));
    plane.castShadow = true; plane.rotation.z = -Math.PI / 2; plane.scale.set(1, 1, 0.35); planeG.add(plane);
    animators.push((dt, t) => {
      flag.rotation.x = -0.4 + Math.sin(t * 2) * 0.25;
      const a = t * 0.7;
      planeG.position.set(10.8 + Math.cos(a) * 1.2, 2.2 + Math.sin(t * 1.6) * 0.15, 6.6 + Math.sin(a) * 1.2);
      planeG.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a));
    });

    const s = new THREE.Group(); s.position.set(-9.6, 0, -1.2); s.rotation.y = 0.5; W.add(s);
    box(s, 1.9, 0.95, 1.25, 0, 0.48, 0, '#fff1dc'); prism(s, 1.1, 1.3, 0, 1.25, 0, '#ff6b5e', 0.55);
    box(s, 0.34, 0.55, 0.04, 0, 0.28, 0.64, '#6c58cf');
    [-0.6, 0.6].forEach((x) => box(s, 0.32, 0.3, 0.04, x, 0.6, 0.64, '#bfe4ff'));
    box(s, 0.4, 0.4, 0.4, 0, 1.85, 0, '#fff1dc'); cone(s, 0.34, 0.35, 4, 0, 2.25, 0, '#6c58cf').rotation.y = Math.PI / 4;
    cyl(s, 0.03, 0.03, 1.6, 5, 1.4, 0.8, 0.7, '#d8d2ff');
    const sflag = box(s, 0.5, 0.28, 0.03, 1.65, 1.5, 0.7, '#ff6b5e');
    animators.push((dt, t) => { sflag.rotation.y = Math.sin(t * 3) * 0.25; });
  });

  /* ---------------------------------------------------------------- */
  /* 6. the city                                                       */
  /* ---------------------------------------------------------------- */
  const bulbGlows = [];
  function addLamp(x, z) {
    const lamp = new THREE.Group(); lamp.position.set(x, terrainH(x, z), z); W.add(lamp);
    cyl(lamp, 0.03, 0.045, 1.05, 6, 0, 0.52, 0, '#2b2850');
    box(lamp, 0.22, 0.04, 0.04, 0.08, 1.04, 0, '#2b2850');
    ball(lamp, 0.09, 0.16, 0.98, 0, '#fff3b0', { emissive: '#ffd36e', emissiveIntensity: 1 }).castShadow = false;
    bulbGlows.push(glow(lamp, 0xffd36e, 1.1, 0.45, 0.16, 0.98, 0));
  }
  const houseV1 = { value: null }, houseC1 = { value: null }, houseC2 = { value: null };

  await stage(0.6, 'Raising the city', () => {
    slab(W, 0, AVENUE_Z, 25, 1.7, '#3f3d66', 0.04, 0.06);
    slab(W, 0, AVENUE_Z - 1.2, 25, 0.7, '#e4def7', 0.05, 0.06);
    slab(W, 0, AVENUE_Z + 1.2, 25, 0.7, '#e4def7', 0.05, 0.06);
    slab(W, 0, 24.9, 25, 1.7, '#7bd88f', 0.03, 0.06);
    const dash = new THREE.InstancedMesh(geo('box', () => new THREE.BoxGeometry(1, 1, 1)), new THREE.MeshLambertMaterial({ color: '#fff1dc' }), 24);
    const d0 = new THREE.Object3D();
    for (let i = 0; i < 24; i++) { d0.position.set(-11 + i * 0.96, 0.08, AVENUE_Z); d0.scale.set(0.45, 0.012, 0.07); d0.updateMatrix(); dash.setMatrixAt(i, d0.matrix); }
    W.add(dash);

    houseV1.value = makeHouse(-1.4, 10.8, Math.PI, '#ffe08a', '#e8564a');
    houseC1.value = makeHouse(1.5, 19.3, 0, '#ffb3c7', '#6c58cf');
    houseC2.value = makeHouse(4.2, 19.3, 0, '#9ff3ff', '#ff6b5e');

    const winTex = canvasTexture((g, s) => {
      g.fillStyle = '#dcd6f5'; g.fillRect(0, 0, s, s);
      g.fillStyle = '#6ad0ff'; g.fillRect(34, 30, 60, 68);
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(34, 30, 60, 14);
    }, 128);
    winTex.wrapS = winTex.wrapT = THREE.RepeatWrapping;
    function makeTower(x, z, w, dd, h, tint, roofColor) {
      const sideMat = (len) => {
        const t = winTex.clone(); t.needsUpdate = true; t.repeat.set(Math.max(1, Math.round(len * 1.1)), Math.max(1, Math.round(h * 1.1)));
        return new THREE.MeshLambertMaterial({ color: tint, map: t });
      };
      const roof = new THREE.MeshLambertMaterial({ color: roofColor });
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), [sideMat(dd), sideMat(dd), roof, roof, sideMat(w), sideMat(w)]);
      m.position.set(x, h / 2, z); m.castShadow = true; m.receiveShadow = true; W.add(m);
      box(W, w * 0.5, 0.3, dd * 0.5, x, h + 0.15, z, '#8a84b8');
      return m;
    }
    makeTower(1.0, 16.2, 2.0, 2.0, 6.4, '#cdbff5', '#4b3fa6');
    makeTower(3.9, 16.5, 2.2, 2.0, 4.6, '#bff0ee', '#2b2850');
    makeTower(10.2, 16.8, 2.6, 2.4, 3.8, '#ffd0de', '#6c58cf');
    cyl(W, 0.03, 0.04, 1.2, 5, 1.0, 7.3, 16.2, '#d8d2ff');
    ball(W, 0.08, 1.0, 7.95, 16.2, '#ff6b5e', { emissive: '#ff6b5e', emissiveIntensity: 1 });

    const cafe = new THREE.Group(); cafe.position.set(10.2, 0, 20.1); W.add(cafe);
    box(cafe, 2.2, 1.3, 1.6, 0, 0.65, 0, '#ffe08a');
    box(cafe, 2.4, 0.12, 1.8, 0, 1.36, 0, '#8a5a44');
    box(cafe, 2.2, 0.1, 0.55, 0, 1.0, 1.05, '#ff6b5e').rotation.x = 0.35;
    box(cafe, 0.5, 0.8, 0.04, 0.5, 0.4, 0.82, '#6c58cf');
    box(cafe, 0.8, 0.5, 0.04, -0.55, 0.65, 0.82, '#bfe4ff', { emissive: '#9fd8ff', emissiveIntensity: 0.35 });
    box(cafe, 0.9, 0.22, 0.04, 0, 1.2, 0.83, '#241f4d');

    function makeCar(color) {
      const c = new THREE.Group();
      box(c, 0.95, 0.24, 0.46, 0, 0.24, 0, color);
      box(c, 0.5, 0.22, 0.42, -0.05, 0.46, 0, '#fff1dc');
      box(c, 0.44, 0.14, 0.44, -0.05, 0.47, 0, '#bfe4ff', { emissive: '#9fd8ff', emissiveIntensity: 0.2 });
      [[-0.3, 0.24], [-0.3, -0.24], [0.3, 0.24], [0.3, -0.24]].forEach(([x, z]) => { const w = cyl(c, 0.1, 0.1, 0.08, 10, x, 0.1, z, '#2b2850'); w.rotation.x = Math.PI / 2; });
      box(c, 0.04, 0.07, 0.1, 0.48, 0.26, 0.14, '#fff3b0', { emissive: '#ffd36e', emissiveIntensity: 1 });
      box(c, 0.04, 0.07, 0.1, 0.48, 0.26, -0.14, '#fff3b0', { emissive: '#ffd36e', emissiveIntensity: 1 });
      W.add(c); return c;
    }
    const cars = [
      { g: makeCar('#ff6b5e'), x: -8, dir: 1, z: AVENUE_Z + 0.4, sp: 1.6 },
      { g: makeCar('#5ac8c8'), x: 5, dir: 1, z: AVENUE_Z + 0.4, sp: 1.3 },
      { g: makeCar('#e8b23a'), x: 3, dir: -1, z: AVENUE_Z - 0.4, sp: 1.5 },
      { g: makeCar('#8f7fe6'), x: -6, dir: -1, z: AVENUE_Z - 0.4, sp: 1.2 },
    ];
    cars.forEach((c) => { c.g.rotation.y = c.dir > 0 ? 0 : Math.PI; c.g.position.set(c.x, 0.05, c.z); });
    animators.push((dt) => cars.forEach((c) => {
      c.x += c.dir * c.sp * dt;
      if (c.x > 12) c.x = -12; else if (c.x < -12) c.x = 12;
      c.g.position.x = c.x;
      c.g.scale.setScalar(Math.max(0.001, Math.min(1, (12 - Math.abs(c.x)) / 1.5)));
    }));

    [-9.5, -6.5, -2.8, 0.3, 7.0, 9.8].forEach((x, i) => {
      const t = new THREE.Group(); t.position.set(x, 0, 25.0); W.add(t);
      cyl(t, 0.07, 0.1, 0.7, 6, 0, 0.35, 0, '#8a5a44');
      ball(t, 0.5, 0, 1.0, 0, ['#55c28a', '#ffb3c7', '#6fd08a'][i % 3]);
      ball(t, 0.32, 0.25, 0.85, 0.1, ['#3fae7a', '#ffa0bd', '#4fae7a'][i % 3]);
    });
    [[4.2, 24.72], [-3.8, 24.72]].forEach(([x, z]) => {
      box(W, 0.95, 0.06, 0.34, x, 0.36, z, '#c9966f'); box(W, 0.95, 0.3, 0.05, x, 0.55, z + 0.19, '#c9966f');
      box(W, 0.06, 0.34, 0.3, x - 0.4, 0.17, z, '#2b2850'); box(W, 0.06, 0.34, 0.3, x + 0.4, 0.17, z, '#2b2850');
    });
    [[-1.4, 24.6], [1.9, 25.2]].forEach(([x, z], i) => {
      box(W, 1.1, 0.14, 0.5, x, 0.1, z, '#a9714f');
      for (let k = 0; k < 6; k++) ball(W, 0.07, x - 0.4 + k * 0.16, 0.22, z + ((k % 2) - 0.5) * 0.14, ['#ff6b5e', '#ffe08a', '#ff9fb8'][(k + i) % 3]);
    });

    [-9, -3.5, 2.5, 9].forEach((x) => addLamp(x, AVENUE_Z + 1.35));
    [0.12, 0.24, 0.36, 0.48, 0.6, 0.72, 0.84].forEach((u, i) => {
      const p = roadCurve.getPointAt(u), tg = roadCurve.getTangentAt(u), sd = i % 2 ? 1.5 : -1.5;
      const x = p.x + tg.z * sd, z = p.z - tg.x * sd;
      if (Math.hypot(x, z) < R - 2.5 && z < CITY.z0 - 0.5) addLamp(x, z);
    });
    animators.push((dt, t) => bulbGlows.forEach((b, i) => { b.material.opacity = 0.4 + Math.sin(t * 2 + i) * 0.08; }));
    animators.push((dt) => doors.forEach((d) => { d.open += (d.target - d.open) * Math.min(1, dt * 4); d.pivot.rotation.y = -1.4 * d.open; }));
  });

  /* ---------------------------------------------------------------- */
  /* 6.5 the airport                                                   */
  /* ---------------------------------------------------------------- */
  await stage(0.63, 'Building the airport', () => {
    const RUNWAY_Z = AIRPORT.z1 - 6.0;
    const RX0 = AIRPORT.x0 + 1.2, RX1 = AIRPORT.x1 - 5.0;

    slab(W, (RX0 + RX1) / 2, RUNWAY_Z, RX1 - RX0 + 2.6, 4.3, '#5fda8a', 0.02, 0.04);
    slab(W, (RX0 + RX1) / 2, RUNWAY_Z, RX1 - RX0 + 2, 3.6, '#4a4766', 0.035, 0.06);
    const dashN = 14, rd = new THREE.InstancedMesh(geo('box', () => new THREE.BoxGeometry(1, 1, 1)), new THREE.MeshLambertMaterial({ color: '#fff1dc' }), dashN);
    const dd = new THREE.Object3D();
    for (let i = 0; i < dashN; i++) {
      dd.position.set(RX0 + 0.5 + i * ((RX1 - RX0 - 1) / (dashN - 1)), 0.07, RUNWAY_Z);
      dd.scale.set(0.5, 0.012, 0.1); dd.updateMatrix(); rd.setMatrixAt(i, dd.matrix);
    }
    W.add(rd);
    slab(W, RX1 + 2.0, AIRPORT.z1 - 2.0, 4.2, 3.6, '#8a84b8', 0.03, 0.06);

    const term = new THREE.Group(); term.position.set(RX1 + 2.2, 0, AIRPORT.z1 + 0.2); W.add(term);
    box(term, 4.4, 1.3, 2.0, 0, 0.65, 0, '#eae6ff');
    box(term, 4.6, 0.12, 2.2, 0, 1.36, 0, '#4b3fa6');
    box(term, 4.0, 0.9, 0.04, 0, 0.75, -1.0, '#bfe4ff', { transparent: true, opacity: 0.35, depthWrite: false }).castShadow = false;
    box(term, 0.9, 0.22, 0.04, 0, 1.15, -1.02, '#241f4d');
    const ctrl = new THREE.Group(); ctrl.position.set(1.6, 0, 0.6); term.add(ctrl);
    cyl(ctrl, 0.3, 0.42, 2.6, 8, 0, 1.3, 0, '#8a84b8');
    cyl(ctrl, 0.55, 0.55, 0.6, 8, 0, 2.9, 0, '#4fd1e0', { emissive: '#2a9aa8', emissiveIntensity: 0.3 });
    const beacon = ball(ctrl, 0.1, 0, 3.3, 0, '#ff4d4d', { emissive: '#ff2d2d', emissiveIntensity: 1 }); beacon.castShadow = false;
    const beaconGlow = glow(ctrl, 0xff4d4d, 1.3, 0.6, 0, 3.3, 0);

    const sock = new THREE.Group(); sock.position.set(RX0 - 0.6, 0, RUNWAY_Z + 2.4); W.add(sock);
    cyl(sock, 0.03, 0.03, 1.6, 6, 0, 0.8, 0, '#8a84b8');
    const cloth = cone(sock, 0.16, 0.6, 8, 0, 1.55, 0, '#ff6b5e'); cloth.rotation.z = Math.PI / 2;

    const plane = new THREE.Group(); W.add(plane);
    const fuse = cyl(plane, 0.16, 0.2, 2.0, 10, 0, 0.5, 0, '#fff8ec'); fuse.rotation.z = Math.PI / 2;
    cone(plane, 0.16, 0.5, 10, 1.2, 0.5, 0, '#fff8ec').rotation.z = -Math.PI / 2;
    box(plane, 0.04, 0.18, 1.9, -0.1, 0.72, 0, '#8f7fe6');
    box(plane, 0.04, 0.5, 0.5, -0.85, 0.72, 0, '#8f7fe6');
    box(plane, 1.9, 0.05, 0.3, 0.1, 0.46, 0, '#8f7fe6');
    [0.55, -0.55].forEach((wz) => { cyl(plane, 0.06, 0.06, 0.3, 8, 0.3, 0.3, wz, '#2b2850').rotation.x = Math.PI / 2; });
    box(plane, 0.5, 0.1, 0.16, 0.9, 0.56, 0, '#bfe4ff', { emissive: '#9fd8ff', emissiveIntensity: 0.3 });
    const taxi = { d: 0.2, dir: 1 };
    animators.push((dt, t) => {
      taxi.d += taxi.dir * 0.9 * dt;
      if (taxi.d > 0.92) taxi.dir = -1; else if (taxi.d < 0.08) taxi.dir = 1;
      const x = lerp(RX0 + 0.6, RX1 - 0.6, taxi.d);
      plane.position.set(x, 0.05, RUNWAY_Z);
      plane.rotation.y = taxi.dir > 0 ? 0 : Math.PI;
      beaconGlow.material.opacity = 0.4 + (Math.sin(t * 6) > 0.6 ? 0.5 : 0);
      beacon.visible = Math.sin(t * 6) > 0;
    });
  });

  /* ---------------------------------------------------------------- */
  /* 6.6 the railway                                                   */
  /* ---------------------------------------------------------------- */
  const RAIL_Z = [RAIL.z0 + 1.6, RAIL.z0 + 2.6];
  let trainGroup = null, trainRun = null;
  await stage(0.65, 'Laying the railway', () => {
    slab(W, (RAIL.x0 + RAIL.x1) / 2, (RAIL.z0 + RAIL.z1) / 2, RAIL.x1 - RAIL.x0 + 1, RAIL.z1 - RAIL.z0 + 1, '#9c966f', 0.02, 0.05);

    RAIL_Z.forEach((tz) => {
      slab(W, (RAIL.x0 + RAIL.x1) / 2, tz, RAIL.x1 - RAIL.x0 - 1, 0.5, '#6a644a', 0.03, 0.05);
      [-0.19, 0.19].forEach((ro) => slab(W, (RAIL.x0 + RAIL.x1) / 2, tz + ro, RAIL.x1 - RAIL.x0 - 1, 0.045, '#8a84b8', 0.05, 0.04));
      const nSleep = 18;
      for (let i = 0; i < nSleep; i++) {
        const x = RAIL.x0 + 0.8 + i * ((RAIL.x1 - RAIL.x0 - 1.6) / (nSleep - 1));
        box(W, 0.14, 0.03, 0.5, x, 0.03, tz, '#8a5a44').castShadow = false;
      }
    });

    const platZ = RAIL_Z[0] - 1.1;
    slab(W, (RAIL.x0 + RAIL.x1) / 2 - 1, platZ, RAIL.x1 - RAIL.x0 - 3, 1.5, '#e4def7', 0.08, 0.16);

    const st = new THREE.Group(); st.position.set(RAIL.x0 + 2.6, 0, platZ - 1.1); W.add(st);
    box(st, 2.6, 1.0, 1.4, 0, 0.5, 0, '#fff1dc');
    box(st, 2.9, 0.1, 1.9, 0, 1.05, 0.1, '#4fae7a');
    box(st, 0.5, 0.7, 0.03, -0.6, 0.35, 0.72, '#6c58cf');
    box(st, 0.8, 0.5, 0.04, 0.5, 0.65, 0.72, '#bfe4ff', { emissive: '#9fd8ff', emissiveIntensity: 0.3 });
    box(st, 1.1, 0.26, 0.05, 0, 1.12, 0.6, '#241f4d');
    [-0.1, 2.1].forEach((x) => cyl(st, 0.04, 0.04, 1.2, 6, x, 0.6, 0.95, '#8a84b8'));
    [[1.8, 0.4], [1.8, -0.35]].forEach(([x, z]) => {
      box(st, 0.7, 0.05, 0.28, x, 0.3, z, '#c9966f'); box(st, 0.7, 0.3, 0.04, x, 0.46, z - 0.13, '#2b2850');
    });

    const tg = new THREE.Group(); W.add(tg); trainGroup = tg;
    function carriage(x, color, loco) {
      const c = new THREE.Group(); c.position.x = x; tg.add(c);
      box(c, 1.6, 0.55, 0.78, 0, 0.5, 0, color);
      box(c, 1.6, 0.14, 0.82, 0, 0.82, 0, '#241f4d');
      if (loco) { box(c, 0.3, 0.3, 0.86, 0.8, 0.95, 0, '#241f4d'); box(c, 0.1, 0.12, 0.3, 0.95, 1.0, 0, '#ffe08a', { emissive: '#ffd36e', emissiveIntensity: 1 }); }
      for (let i = -1; i <= 1; i += 2) box(c, 0.3, 0.2, 0.03, i * 0.5, 0.6, 0.4, '#bfe4ff', { emissive: '#9fd8ff', emissiveIntensity: 0.25 });
      [[-0.5, 0.41], [0.5, 0.41], [-0.5, -0.41], [0.5, -0.41]].forEach(([wx, wz]) => { const w = cyl(c, 0.14, 0.14, 0.08, 10, wx, 0.14, wz, '#2b2850'); w.rotation.x = Math.PI / 2; });
      return c;
    }
    carriage(0.9, '#ff6b5e', true); carriage(-0.9, '#5ac8c8', false); carriage(-2.6, '#8f7fe6', false);
    trainRun = { x: RAIL.x0 + 3, dir: 1 };
    const trackZ = RAIL_Z[1];
    animators.push((dt) => {
      trainRun.x += trainRun.dir * 2.0 * dt;
      if (trainRun.x > RAIL.x1 - 3) trainRun.dir = -1; else if (trainRun.x < RAIL.x0 + 3) trainRun.dir = 1;
      tg.position.set(trainRun.x, 0.05, trackZ); tg.rotation.y = trainRun.dir > 0 ? 0 : Math.PI;
    });

    const passenger = makePerson({ shirt: '#e8b23a', pants: '#2b2850', hair: '#7a4a32', skin: '#f6d2b4', hairStyle: 'pony', shoes: '#8a5a44' });
    makeAgent(passenger, W, { x: RAIL.x0 + 4.5, z: platZ - 1.1 + 0.4, face: [0, -1], ground: () => 0, steps: [{ wait: Infinity, pose: 'sit' }] });
  });

  /* ---------------------------------------------------------------- */
  /* 7. project office buildings                                       */
  /* ---------------------------------------------------------------- */
  const HQ = { x: -6.0, z: 18.0 };
  const HQ2 = { x: -15.5, z: 7.5 };
  const HQ3 = { x: 24.0, z: -4.0 };
  const FLOOR = 0.14;

  function buildOfficeHQ(o) {
    const H = new THREE.Group(); H.position.set(o.x, 0, o.z); W.add(H);
    const gate = { pos: 0, target: 0 };
    const myMonitors = [];                              // only THIS office's screens
    const bx = (sx, sy, sz, x, y, z, c, opt) => box(H, sx, sy, sz, x, y, z, c, opt);
    const glass = (sx, sy, sz, x, y, z) => { const m = bx(sx, sy, sz, x, y, z, '#bfe4ff', { transparent: true, opacity: 0.2, depthWrite: false }); m.castShadow = false; return m; };

    const signTex = canvasTextureWH(1024, 176, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#241f4d'); gr.addColorStop(1, o.tower);
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = o.accent; g.beginPath(); g.arc(88, h / 2, 54, 0, TAU); g.fill();
      g.strokeStyle = '#ffffff'; g.lineWidth = 8; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath();
      [[52, 90], [72, 90], [82, 52], [96, 124], [106, 90], [124, 90]].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.stroke();
      let fs = 86; g.textBaseline = 'middle'; g.font = `800 ${fs}px system-ui, "Segoe UI", Arial, sans-serif`;
      const full = () => g.measureText(o.nameA + ' ' + o.nameB).width;
      while (full() > w - 210 && fs > 40) { fs -= 4; g.font = `800 ${fs}px system-ui, "Segoe UI", Arial, sans-serif`; }
      g.fillStyle = '#ffffff'; g.fillText(o.nameA, 170, h / 2 + 2);
      const wA = g.measureText(o.nameA + ' ').width;
      g.fillStyle = o.accentLight; g.fillText(o.nameB, 170 + wA, h / 2 + 2);
      g.strokeStyle = o.accent2; g.lineWidth = 4; g.beginPath(); g.moveTo(170, h - 14); g.lineTo(w - 30, h - 14); g.stroke();
    });
    const signMat = new THREE.MeshBasicMaterial({ map: signTex, fog: false });

    slab(H, 0, 0.1, 9.8, 6.8, '#e4def7', 0.02, 0.04);
    slab(H, -3.3, 1.9, 2.2, 1.9, '#7bd88f', 0.05, 0.04); slab(H, 3.3, 1.9, 2.2, 1.9, '#7bd88f', 0.05, 0.04);
    slab(H, 0, 2.0, 1.5, 3.0, '#c9c2ea', 0.05, 0.04);

    const fence = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 0.75)), ang = -Math.atan2(z1 - z0, x1 - x0);
      for (let i = 0; i <= n; i++) { const f = i / n; bx(0.07, 0.5, 0.07, x0 + (x1 - x0) * f, 0.27, z0 + (z1 - z0) * f, '#fff1dc'); }
      [0.22, 0.42].forEach((y) => { const m = bx(len, 0.04, 0.04, (x0 + x1) / 2, y, (z0 + z1) / 2, o.accent); m.rotation.y = ang; });
    };
    fence(-4.8, -3.2, -4.8, 3.2); fence(4.8, -3.2, 4.8, 3.2); fence(-4.8, 3.2, -1.2, 3.2); fence(1.2, 3.2, 4.8, 3.2);

    bx(7.6, 0.12, 3.9, 0, 0.06, -1.2, o.wallTint);
    bx(7.2, 0.02, 3.4, 0, 0.13, -1.2, o.wallTint).castShadow = false;
    bx(7.4, 1.3, 0.12, 0, 0.8, -3.0, o.wallTint);
    glass(7.3, 1.1, 0.03, 0, 0.75, 0.58);
    glass(0.03, 1.1, 3.5, -3.7, 0.75, -1.2); glass(0.03, 1.1, 3.5, 3.7, 0.75, -1.2);
    bx(0.9, 1.05, 0.05, 0, 0.7, 0.6, o.accent, { transparent: true, opacity: 0.35, depthWrite: false }).castShadow = false;
    for (let i = 0; i < 5; i++) bx(0.16, 1.3, 0.16, -3.65 + i * 1.825, 0.79, 0.58, '#fff8ec');
    bx(7.8, 0.14, 4.0, 0, 1.38, -1.2, '#fff8ec');
    bx(1.4, 0.08, 0.6, 0, 0.04, 0.95, '#d8d2ff');
    [-2.4, 0, 2.4].forEach((x) => bx(1.2, 0.04, 0.2, x, 1.34, -1.2, '#fffbe8', { emissive: '#fff3b0', emissiveIntensity: 0.9 }).castShadow = false);

    bx(7.4, 0.9, 3.5, 0, 1.9, -1.25, o.wallTint);
    bx(7.5, 0.06, 3.6, 0, 2.37, -1.25, o.accent);
    [-2.7, -1.35, 0, 1.35, 2.7].forEach((x) => bx(0.9, 0.5, 0.03, x, 1.9, 0.52, '#9ff3ff', { emissive: o.accent2, emissiveIntensity: 0.45 }));
    [-2.2, -0.9].forEach((z) => { bx(0.03, 0.5, 0.9, -3.71, 1.9, z, '#9ff3ff', { emissive: o.accent2, emissiveIntensity: 0.45 }); bx(0.03, 0.5, 0.9, 3.71, 1.9, z, '#9ff3ff', { emissive: o.accent2, emissiveIntensity: 0.45 }); });
    bx(6.0, 0.8, 3.1, 0, 2.78, -1.45, '#2b2850');
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 0.534), signMat); sign.position.set(0, 2.78, 0.14); H.add(sign);
    bx(6.2, 0.1, 3.3, 0, 3.22, -1.45, '#3a2f5b');
    bx(2.6, 2.0, 2.4, 0, 4.27, -1.7, o.tower);
    [3.7, 4.3, 4.9].forEach((y) => [-0.85, 0, 0.85].forEach((x) => bx(0.4, 0.34, 0.03, x, y, -0.48, '#9ff3ff', { emissive: o.accent2, emissiveIntensity: 0.7 })));
    bx(2.8, 0.12, 2.6, 0, 5.33, -1.7, '#241f4d');
    cyl(H, 0.04, 0.05, 1.0, 6, 0, 5.9, -1.7, '#d8d2ff');
    const orb = ball(H, 0.2, 0, 6.5, -1.7, o.accent, { emissive: o.accent, emissiveIntensity: 1 }); orb.castShadow = false;
    const orbGlow = glow(H, new THREE.Color(o.accent), 3.4, 0.7, 0, 6.5, -1.7);        // brand colour, not always pink
    const pulses = [0, 1].map((i) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, color: new THREE.Color(o.accentLight), transparent: true, depthWrite: false, fog: false }));
      s.position.set(0, 6.5, -1.7); H.add(s); return { s, off: i / 2 };
    });

    [[-2.6, o.accent], [-1.4, o.accent2], [-0.2, '#ffe08a']].forEach(([x, c]) => bx(0.55, 0.38, 0.02, x, 1.0, -2.93, c, { emissive: c, emissiveIntensity: 0.25 }));
    bx(1.5, 0.8, 0.04, 3.0, 0.9, -2.93, '#ffffff');
    [[o.accent, 0.5, 1.12], [o.accent2, 0.9, 1.0], ['#8f7fe6', 0.7, 0.88]].forEach(([c, w, y]) => bx(w, 0.04, 0.02, 2.8, y, -2.9, c));
    bx(0.5, 0.6, 0.4, 3.35, 0.44, -0.55, '#2b2850'); bx(0.4, 0.2, 0.3, 3.35, 0.84, -0.55, o.accent);

    const DESK_X = [-2.6, -1.1, 0.4, 1.9], screenColors = o.deskColors;
    DESK_X.forEach((x, i) => {
      const z = -1.55;
      bx(0.5, 0.04, 1.0, x - 0.62, FLOOR + 0.64, z, '#fff8ec');
      bx(0.05, 0.62, 0.05, x - 0.4, FLOOR + 0.32, z + 0.42, '#8a84b8'); bx(0.05, 0.62, 0.05, x - 0.4, FLOOR + 0.32, z - 0.42, '#8a84b8');
      bx(0.05, 0.62, 0.05, x - 0.84, FLOOR + 0.32, z + 0.42, '#8a84b8'); bx(0.05, 0.62, 0.05, x - 0.84, FLOOR + 0.32, z - 0.42, '#8a84b8');
      bx(0.05, 0.3, 0.46, x - 0.8, FLOOR + 0.83, z, '#241f4d');
      const sm = new THREE.MeshLambertMaterial({ color: screenColors[i], emissive: screenColors[i], emissiveIntensity: 0.8 });
      myMonitors.push(sm); monitorMats.push(sm);
      const scr = new THREE.Mesh(geo('box', () => new THREE.BoxGeometry(1, 1, 1)), sm); scr.scale.set(0.012, 0.24, 0.4); scr.position.set(x - 0.77, FLOOR + 0.84, z); H.add(scr);
      bx(0.18, 0.02, 0.34, x - 0.45, FLOOR + 0.67, z, '#2b2850');
      bx(0.34, 0.05, 0.34, x + 0.06, FLOOR + 0.36, z, '#2b2850');
      bx(0.05, 0.42, 0.34, x + 0.22, FLOOR + 0.58, z, '#2b2850');
    });

    [-1.05, 1.05].forEach((x) => bx(0.2, 1.0, 0.2, x, 0.52, 3.2, '#fff1dc'));
    bx(2.3, 0.1, 0.12, 0, 1.05, 3.2, '#3a2f5b');
    const gateSign = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.275), signMat); gateSign.position.set(0, 1.28, 3.28); H.add(gateSign);
    const gateSign2 = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.275), signMat); gateSign2.position.set(0, 1.28, 3.12); gateSign2.rotation.y = Math.PI; H.add(gateSign2);
    const makePanel = () => {
      const p = new THREE.Group(); H.add(p);
      box(p, 0.95, 0.5, 0.05, 0, 0.32, 0, '#3a2f5b');
      for (let k = -2; k <= 2; k++) box(p, 0.05, 0.5, 0.07, k * 0.19, 0.32, 0, o.accent);
      return p;
    };
    const gateL = makePanel(), gateR = makePanel();
    const lampRed = ball(H, 0.08, -1.05, 1.2, 3.3, '#ff4d4d', { emissive: '#ff2d2d', emissiveIntensity: 1 }); lampRed.castShadow = false;
    const lampGreen = ball(H, 0.08, -1.05, 1.2, 3.3, '#5dff9a', { emissive: '#2dff7a', emissiveIntensity: 1 }); lampGreen.castShadow = false;
    const lampGlow = glow(H, 0xff4d4d, 0.9, 0.6, -1.05, 1.2, 3.3);

    bx(0.9, 0.95, 0.85, 2.45, 0.48, 2.65, '#fff1dc');
    bx(1.1, 0.08, 1.05, 2.45, 1.0, 2.65, o.accent);
    glass(0.03, 0.5, 0.6, 2.0, 0.62, 2.65);
    [[-3.4, 1.25], [-3.4, 2.45], [3.4, 1.25]].forEach(([x, z], i) => {
      bx(0.9, 0.22, 0.5, x, 0.15, z, '#a9714f');
      ball(H, 0.3, x, 0.45, z, '#3fae7a'); ball(H, 0.1, x + 0.2, 0.7, z, ['#ff6b5e', '#ffe08a', '#ff9fb8'][i]);
    });

    animators.push((dt, t) => {
      gate.pos += (gate.target - gate.pos) * Math.min(1, dt * 2.2);
      gateL.position.set(-0.5 - 0.95 * gate.pos, 0, 3.32); gateR.position.set(0.5 + 0.95 * gate.pos, 0, 3.32);
      const open = gate.target > 0.5;
      lampRed.visible = !open; lampGreen.visible = open;
      lampGlow.material.color.set(open ? 0x5dff9a : 0xff4d4d);
      myMonitors.forEach((m, i) => { m.emissiveIntensity = 0.7 + Math.sin(t * 5 + i * 2) * 0.1 + (Math.sin(t * 17 + i) > 0.92 ? 0.25 : 0); });
      orbGlow.material.opacity = 0.55 + Math.sin(t * 3) * 0.2;
      pulses.forEach((p) => { const k = (t * 0.55 + p.off) % 1; p.s.scale.setScalar(0.6 + k * 3.4); p.s.material.opacity = (1 - k) * 0.8; });
    });
    return { H, gate };
  }

  let astropulseHQ, healthgisHQ, nexoraHQ;
  await stage(0.68, 'Building the project offices', () => {
    astropulseHQ = buildOfficeHQ({
      x: HQ.x, z: HQ.z, nameA: 'ASTROPULSE', nameB: 'SMM', accent: '#ff4fa3', accentLight: '#ff6fb5',
      accent2: '#4fd1e0', tower: '#4b3fa6', wallTint: '#eae6ff',
      deskColors: ['#9ff3ff', '#ffb3c7', '#ffe08a', '#b6ffcf'],
    });
    hqGroup = astropulseHQ.H;

    healthgisHQ = buildOfficeHQ({
      x: HQ2.x, z: HQ2.z, nameA: 'HEALTHGIS', nameB: '.SITE.JE', accent: '#1fbf8f', accentLight: '#5be0b8',
      accent2: '#2e8bff', tower: '#0f6b52', wallTint: '#e6f7f1',
      deskColors: ['#bfe3ff', '#b7ffe6', '#fff0b3', '#d8ffcf'],
    });
    hq2Group = healthgisHQ.H;

    nexoraHQ = buildOfficeHQ({
      x: HQ3.x, z: HQ3.z, nameA: 'NEXORA', nameB: 'AI', accent: '#8f7fe6', accentLight: '#b3a4ff',
      accent2: '#5ac8c8', tower: '#4b3fa6', wallTint: '#ece9ff',
      deskColors: ['#c9bfff', '#9ff3ff', '#ffe08a', '#ff9fb8'],
    });
    hq3Group = nexoraHQ.H;
  });

  /* ---------------------------------------------------------------- */
  /* 8. people: everybody gets a job                                   */
  /* ---------------------------------------------------------------- */
  const walkGround = (x, z) => terrainH(x, z) + 0.03;
  const cityGround = () => 0.06;
  const hqGround = (x, z) => (Math.abs(x) < 3.6 && z < 0.5 && z > -3.0 ? FLOOR : 0.045);
  const reversed = (list) => list.slice().reverse();
  const goList = (pts) => pts.map((p) => ({ go: p }));
  function DESK_X0(i) { return [-2.6, -1.1, 0.4, 1.9][i]; }

  await stage(0.8, 'Waking up the villagers', () => {
    const me = makePerson({ shirt: '#ff6b5e', pants: '#2b2850', hair: '#241f4d', backpack: '#e8b23a', skin: '#e9b48d', shoes: '#fff8ec' });
    makeAgent(me, W, { x: -4.5, z: 7.4, heading: -Math.PI / 3, ground: () => 0, steps: [{ wait: Infinity, pose: 'talk' }] });

    const v1 = houseV1.value, mailStand = [9.7, 7.0];
    const outward = [v1.frontPt, ...roadPath(v1.frontPt[0], v1.frontPt[1], 8.6, 7.4, 0.35, 3), mailStand];
    const villager = makePerson({ shirt: '#8f7fe6', pants: '#3a3568', hair: '#7a4a32', backpack: '#ff6b5e', skin: '#f6d2b4', hairStyle: 'pony', shoes: '#8a5a44' });
    makeAgent(villager, W, {
      x: v1.frontPt[0], z: v1.frontPt[1], ground: walkGround, speed: 1.0,
      steps: [
        { do: (a) => { a.hidden = false; a.x = v1.doorPt[0]; a.z = v1.doorPt[1]; v1.door.target = 1; } },
        { wait: 0.9, pose: 'idle' },
        ...goList(outward),
        { do: () => { v1.door.target = 0; } },
        { wait: 3, pose: 'give', face: [1, -0.4] },
        ...goList(reversed(outward).slice(1)),
        { do: () => { v1.door.target = 1; } },
        { wait: 0.8, pose: 'idle' },
        { go: v1.doorPt },
        { do: (a) => { a.hidden = true; v1.door.target = 0; } },
        { wait: 5 },
      ],
    });

    const farmer = makePerson({ shirt: '#4fae7a', pants: '#6c58cf', hair: '#5a3b2a', hat: 'straw', skin: '#d9a07a', shoes: '#8a5a44' });
    const hoe = new THREE.Group(); farmer.elbowR.add(hoe); hoe.rotation.z = -0.3;
    cyl(hoe, 0.015, 0.015, 0.8, 5, 0.04, -0.34, 0, '#8a5a44'); box(hoe, 0.05, 0.05, 0.2, 0.04, -0.74, 0, '#9a9ab8');
    makeAgent(farmer, W, {
      x: 8.1, z: 2.4, ground: () => 0, speed: 0.8,
      steps: [
        { go: [9.5, 2.65] }, { wait: 6, pose: 'farm', face: [0, -1] },
        { go: [11.0, 2.65] }, { wait: 6, pose: 'farm', face: [0, -1] },
        { go: [8.1, 2.4] }, { go: [8.1, -2.4] },
        { go: [9.5, -2.45] }, { wait: 6, pose: 'farm', face: [0, 1] },
        { go: [11.0, -2.45] }, { wait: 6, pose: 'farm', face: [0, 1] },
        { go: [8.1, -2.4] }, { go: [8.1, 2.4] },
      ],
    });

    const fisher = makePerson({ shirt: '#4fd1e0', pants: '#6a5a45', hair: '#2b2850', hat: 'straw', hatColor: '#4b3fa6', skin: '#e0a98a', longSleeve: true, shoes: '#8a5a44' });
    const rod = cyl(fisher.group, 0.012, 0.02, 1.6, 6, 0.65, 0.95, 0.05, '#8a5a44'); rod.rotation.z = -1.0; rod.castShadow = false;
    cyl(fisher.group, 0.004, 0.004, 0.95, 4, 1.38, 0.6, 0.05, '#ffffff').castShadow = false;
    const bobber = ball(fisher.group, 0.035, 1.38, 0.62, 0.05, '#ff6b5e'); bobber.castShadow = false;
    makeAgent(fisher, W, { x: -3.35, z: 0.5, face: [-1, -0.05], ground: terrainH, steps: [{ wait: Infinity, pose: 'fish' }] });
    animators.push((dt, t) => { bobber.position.y = 0.62 + Math.sin(t * 2.2) * 0.012; rod.rotation.z = -1.0 + Math.sin(t * 0.7) * 0.02; });

    const student = makePerson({ shirt: '#ffe08a', pants: '#4b3fa6', hair: '#241f4d', hairStyle: 'pony', backpack: '#5ac8c8', skin: '#e9b48d', shorts: true, shoes: '#ff6b5e' });
    student.group.scale.setScalar(0.9);
    makeAgent(student, W, { x: -8.3, z: -2.6, face: [0.5, 1], ground: terrainH, steps: [{ wait: Infinity, pose: 'wave' }] });

    /* --- the cyclist: rides, FALLS DOWN, gets up, dusts off, rides on --- */
    const bikeRoot = new THREE.Group(), tilt = new THREE.Group(); W.add(bikeRoot); bikeRoot.add(tilt);
    const wheelGeo = geo('wheel', () => new THREE.TorusGeometry(0.28, 0.035, 6, 16)), wm = mat('#2b2850');
    const wf = put(tilt, wheelGeo, wm, 0.42, 0.3, 0), wr = put(tilt, wheelGeo, wm, -0.42, 0.3, 0);
    box(tilt, 0.75, 0.04, 0.04, 0, 0.5, 0, '#ff6b5e'); box(tilt, 0.04, 0.4, 0.04, -0.18, 0.4, 0, '#ff6b5e');
    box(tilt, 0.04, 0.45, 0.04, 0.4, 0.45, 0, '#ff6b5e').rotation.z = -0.25;
    box(tilt, 0.04, 0.04, 0.34, 0.43, 0.7, 0, '#2b2850'); box(tilt, 0.2, 0.05, 0.12, -0.2, 0.62, 0, '#2b2850');
    const rider = makePerson({ shirt: '#4fae7a', pants: '#2b2850', hair: '#e8b23a', skin: '#c98e68', hairStyle: 'long', shoes: '#ff6b5e' });
    const SEAT = [-0.18, 0.25, 0];
    rider.group.position.set(...SEAT); rider.group.scale.setScalar(0.92); tilt.add(rider.group);
    const L = roadCurve.getLength();
    const ride = { d: L * 0.15, dir: 1, v: 1.7, heading: 0, phase: 'ride', t: 0, timer: 0 };
    const pt = new THREE.Vector3(), tg = new THREE.Vector3();
    const setJ = (p, o) => {
      const v = (k) => o[k] || 0;
      p.upper.rotation.z = v('up'); p.head.rotation.y = v('hy'); p.head.rotation.z = v('hz');
      p.armL.rotation.set(0, 0, v('alz')); p.armR.rotation.set(0, 0, v('arz'));
      p.elbowL.rotation.set(0, 0, v('elz')); p.elbowR.rotation.set(0, 0, v('erz'));
      p.legL.rotation.z = v('ll'); p.legR.rotation.z = v('lr'); p.shinL.rotation.z = v('sl'); p.shinR.rotation.z = v('sr');
    };
    animators.push((dt, t) => {
      const moving = ride.phase === 'ride' || ride.phase === 'fall';
      if (moving) {
        ride.d += ride.dir * (ride.phase === 'ride' ? 1.7 : ride.v) * dt;
        if (ride.d > L * 0.93) { ride.d = L * 0.93; ride.dir = -1; } else if (ride.d < L * 0.04) { ride.d = L * 0.04; ride.dir = 1; }
        const u = ride.d / L; roadCurve.getPointAt(u, pt); roadCurve.getTangentAt(u, tg);
        let dA = -Math.atan2(tg.z * ride.dir, tg.x * ride.dir) - ride.heading; dA = Math.atan2(Math.sin(dA), Math.cos(dA));
        ride.heading += dA * Math.min(1, dt * 3);
        bikeRoot.position.set(pt.x - tg.z * 0.3, 0.05, pt.z + tg.x * 0.3); bikeRoot.rotation.y = ride.heading;
        wf.rotation.z -= dt * 6 * (ride.phase === 'ride' ? 1 : ride.v / 1.7); wr.rotation.z = wf.rotation.z;
      }
      ride.t += dt;
      const Rg = rider.group;
      switch (ride.phase) {
        case 'ride': {
          ride.timer += dt;
          const pedal = t * 6;
          setJ(rider, { up: -0.3, alz: 1.0, arz: 1.0, elz: 0.1, erz: 0.1, ll: 0.5 + Math.sin(pedal) * 0.6, lr: 0.5 + Math.sin(pedal + Math.PI) * 0.6,
            sl: -(0.5 + 0.5 * Math.sin(pedal)), sr: -(0.5 + 0.5 * Math.sin(pedal + Math.PI)), hy: Math.sin(t * 0.7) * 0.15 });
          tilt.rotation.x = Math.sin(t * 2) * 0.01;
          if (ride.timer > 11) {
            ride.phase = 'fall'; ride.t = 0; ride.v = 1.7;
            tilt.remove(Rg); bikeRoot.add(Rg); Rg.position.set(...SEAT);
          }
          break;
        }
        case 'fall': {
          const p = clamp(ride.t / 0.9, 0, 1), e = easeOut(p);
          ride.v = 1.7 * (1 - p);
          tilt.rotation.x = 1.3 * e;
          Rg.position.set(lerp(SEAT[0], 0.45, e), lerp(SEAT[1], 0.14, e), 0); Rg.rotation.z = -1.5 * e;
          setJ(rider, { alz: 2.2 * e, arz: 2.2 * e, elz: 0.3, erz: 0.3, ll: 0.3, lr: -0.2 });
          if (ride.t >= 0.9) { ride.phase = 'lie'; ride.t = 0; }
          break;
        }
        case 'lie':
          setJ(rider, { alz: 2.2, arz: 2.2, elz: 0.3, erz: 0.3, ll: 0.3 + Math.sin(t * 9) * 0.05, lr: -0.2 });
          if (ride.t >= 1.8) { ride.phase = 'getup'; ride.t = 0; }
          break;
        case 'getup': {
          const p = clamp(ride.t / 1.2, 0, 1), e = easeOut(p);
          Rg.rotation.z = -1.5 * (1 - e); Rg.position.set(lerp(0.45, 0.5, e), lerp(0.14, 0, e), lerp(0, -0.62, e));
          setJ(rider, { alz: 2.2 * (1 - e), arz: 2.2 * (1 - e), up: -0.2 * Math.sin(p * Math.PI), hz: 0.2 });
          if (ride.t >= 1.2) { ride.phase = 'dust'; ride.t = 0; }
          break;
        }
        case 'dust':
          setJ(rider, { hy: Math.sin(t * 10) * 0.5, alz: 0.4 + Math.sin(t * 14) * 0.4, arz: 0.4 - Math.sin(t * 14) * 0.4, elz: 0.9, erz: 0.9 });
          if (ride.t >= 1.4) { ride.phase = 'remount'; ride.t = 0; }
          break;
        case 'remount': {
          const p = clamp(ride.t / 1.0, 0, 1), e = p * p * (3 - 2 * p);
          tilt.rotation.x = 1.3 * (1 - e);
          Rg.position.set(lerp(0.5, SEAT[0], e), lerp(0, SEAT[1], e), lerp(-0.62, 0, e));
          setJ(rider, { alz: 0.3, arz: 0.3 });
          if (ride.t >= 1.0) {
            bikeRoot.remove(Rg); tilt.add(Rg); Rg.position.set(...SEAT); Rg.rotation.z = 0;
            ride.phase = 'ride'; ride.timer = 0; tilt.rotation.x = 0;
          }
          break;
        }
        default: break;
      }
    });
    bikeRoot.position.set(-12, 0.05, 3);

    const c1 = houseC1.value, c2 = houseC2.value;
    const res1 = makePerson({ shirt: '#ff9f43', pants: '#2b2850', hair: '#241f4d', skin: '#e9b48d', hairStyle: 'short', shoes: '#fff8ec' });
    makeAgent(res1, W, {
      x: c1.frontPt[0], z: c1.frontPt[1], ground: cityGround, speed: 1.0,
      steps: [
        { do: (a) => { a.hidden = false; a.x = c1.doorPt[0]; a.z = c1.doorPt[1]; c1.door.target = 1; } },
        { wait: 0.9 }, { go: c1.frontPt }, { do: () => { c1.door.target = 0; } },
        { go: [1.5, AVENUE_Z - 1.05] }, { go: [9.0, AVENUE_Z - 1.05] },
        { wait: 3, pose: 'wave', face: [0, -1] },
        { go: [1.5, AVENUE_Z - 1.05] }, { go: c1.frontPt },
        { do: () => { c1.door.target = 1; } }, { wait: 0.8 }, { go: c1.doorPt },
        { do: (a) => { a.hidden = true; c1.door.target = 0; } }, { wait: 5 },
      ],
    });
    const res2 = makePerson({ shirt: '#c9a7ff', pants: '#3a3568', hair: '#8a5a44', skin: '#f2c7a5', hairStyle: 'long', shoes: '#2b2850' });
    makeAgent(res2, W, {
      x: c2.frontPt[0], z: c2.frontPt[1], ground: cityGround, speed: 1.0,
      steps: [
        { wait: 5, pose: 'idle' },
        { do: (a) => { a.hidden = false; a.x = c2.doorPt[0]; a.z = c2.doorPt[1]; c2.door.target = 1; } },
        { wait: 0.9 }, { go: c2.frontPt }, { do: () => { c2.door.target = 0; } },
        { go: [4.2, AVENUE_Z - 1.05] }, { go: [4.2, AVENUE_Z + 1.05] }, { go: [4.2, 24.5] },
        { wait: 8, pose: 'sit', face: [0, -1] },
        { go: [4.2, AVENUE_Z + 1.05] }, { go: [4.2, AVENUE_Z - 1.05] }, { go: c2.frontPt },
        { do: () => { c2.door.target = 1; } }, { wait: 0.8 }, { go: c2.doorPt },
        { do: (a) => { a.hidden = true; c2.door.target = 0; } }, { wait: 4 },
      ],
    });

    /* --- shared helpers for the three offices --- */
    const seatedSteps = (pose) => [{ wait: Infinity, pose, face: [-1, 0] }];
    const addHeadset = (p) => {
      const hs = new THREE.Group(); p.head.add(hs);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.012, 6, 16, Math.PI), mat('#2b2850')); band.rotation.y = Math.PI / 2; hs.add(band);
      ball(hs, 0.04, 0, -0.005, 0.15, '#2b2850').castShadow = false; ball(hs, 0.04, 0, -0.005, -0.15, '#2b2850').castShadow = false;
      cyl(hs, 0.008, 0.008, 0.18, 4, 0.08, -0.05, 0.1, '#2b2850').rotation.z = 1.3;
      ball(hs, 0.018, 0.14, -0.065, 0.06, '#ff4fa3').castShadow = false;
    };
    const deskWorker = (grp, i, pose, look) => { const p = makePerson(look); makeAgent(p, grp, { x: DESK_X0(i), z: -1.55, face: [-1, 0], ground: hqGround, steps: seatedSteps(pose) }); return p; };
    const presenter = (grp, look) => makeAgent(makePerson(look), grp, { x: 3.0, z: -2.25, face: [0, 1], ground: hqGround, steps: [{ wait: Infinity, pose: 'talk' }] });
    const inspector = (grp, look, deskIdx) => {
      const p = makePerson(look);
      box(p.elbowL, 0.03, 0.22, 0.16, 0.05, -0.17, 0, '#c9966f');
      const st = [];
      deskIdx.forEach((i) => { const sx = DESK_X0(i) - 0.75; st.push({ go: [sx, 0.05] }, { go: [sx, -0.7] }, { wait: 2.4, pose: 'point', face: [0, -1] }, { go: [sx, 0.05] }); });
      st.push({ go: [-3.2, 0.05] });
      makeAgent(p, grp, { x: -3.2, z: 0.05, ground: hqGround, speed: 0.8, steps: st });
    };
    const gateGuard = (grp, hq, look) => makeAgent(makePerson(look), grp, {
      x: 1.55, z: 2.15, face: [0, 1], ground: hqGround,
      steps: [{ wait: 6, pose: 'idle', face: [0, 1] }, { go: [1.55, 1.5] }, { wait: 4, face: [0, 1] }, { go: [1.55, 2.15] }],
      tick: (a) => { if (hq.gate.target > 0.5 && hq.gate.pos < 0.98) { a.pose = 'wave'; a.want = -Math.atan2(1, 0.3); } },
    });
    const courierRun = (grp, hq, look, parcelColor) => {
      const c = makePerson(look);
      const parcel = box(c.upper, 0.2, 0.16, 0.26, 0.3, 0.2, 0, parcelColor);
      const parcelDoor = box(grp, 0.3, 0.22, 0.3, 0.9, 0.12, 1.05, parcelColor); parcelDoor.visible = false;
      makeAgent(c, grp, {
        x: -4.9, z: 3.55, face: [1, 0], ground: hqGround, speed: 1.0,
        steps: [
          { do: (a) => { a.hidden = false; a.x = -4.9; a.z = 3.55; a.carry = true; parcel.visible = true; parcelDoor.visible = false; } },
          { go: [0, 3.55] },
          { do: () => { hq.gate.target = 1; } }, { wait: 1.9, pose: 'idle', face: [0, -1] },
          { go: [0, 2.3] }, { go: [0, 1.3] },
          { wait: 2.2, pose: 'give', face: [0, -1] },
          { do: (a) => { a.carry = false; parcel.visible = false; parcelDoor.visible = true; } },
          { wait: 0.7 },
          { go: [0, 2.3] }, { go: [0, 3.55] },
          { do: () => { hq.gate.target = 0; } },
          { go: [5.2, 3.55] },
          { do: (a) => { a.hidden = true; } }, { wait: 7 },
        ],
      });
    };

    /* --- Astropulse SMM: 9 employees --- */
    const H = hqGroup;
    deskWorker(H, 0, 'type', { shirt: '#4b3fa6', pants: '#2b2850', hair: '#241f4d', skin: '#e9b48d', hairStyle: 'short', shoes: '#2b2850' });
    deskWorker(H, 1, 'type', { shirt: '#ff4fa3', pants: '#2b2850', hair: '#7a4a32', skin: '#f6d2b4', hairStyle: 'pony', shoes: '#fff8ec' });
    deskWorker(H, 2, 'draw', { shirt: '#ffe08a', pants: '#3a3568', hair: '#2b2850', skin: '#c98e68', hairStyle: 'long', shoes: '#ff6b5e' });
    addHeadset(deskWorker(H, 3, 'phone', { shirt: '#5ac8c8', pants: '#2b2850', hair: '#8a5a44', skin: '#e0a98a', hairStyle: 'pony', shoes: '#fff8ec' }));
    inspector(H, { shirt: '#fff8ec', pants: '#2b2850', hair: '#241f4d', skin: '#e9b48d', hairStyle: 'short', longSleeve: true, shoes: '#2b2850' }, [0, 1, 2, 3]);
    presenter(H, { shirt: '#8f7fe6', pants: '#2b2850', hair: '#5a3b2a', skin: '#f2c7a5', hairStyle: 'short', longSleeve: true, shoes: '#2b2850' });
    gateGuard(H, astropulseHQ, { shirt: '#2b2850', pants: '#2b2850', hair: '#241f4d', skin: '#d9a07a', hat: 'beanie', hatColor: '#1f1a45', shoes: '#241f4d', longSleeve: true, belt: '#e8b23a' });
    courierRun(H, astropulseHQ, { shirt: '#ff9f43', pants: '#2b2850', hair: '#241f4d', skin: '#e0a98a', hat: 'beanie', hatColor: '#ff9f43', shorts: true, shoes: '#fff8ec' }, '#c9966f');
    const gardener = makePerson({ shirt: '#4fae7a', pants: '#6a5a45', hair: '#241f4d', skin: '#d9a07a', hat: 'straw', shoes: '#8a5a44' });
    cyl(gardener.elbowR, 0.07, 0.07, 0.12, 10, 0.06, -0.2, 0, '#5ac8c8'); cyl(gardener.elbowR, 0.012, 0.02, 0.2, 6, 0.17, -0.16, 0, '#5ac8c8').rotation.z = -1.0;
    makeAgent(gardener, H, {
      x: -2.6, z: 2.4, face: [-1, 0], ground: hqGround, speed: 0.8,
      steps: [
        { go: [-2.6, 1.3] }, { wait: 4, pose: 'water', face: [-1, 0] },
        { go: [-2.6, 2.4] }, { wait: 4, pose: 'water', face: [-1, 0] },
        { go: [2.6, 2.4] }, { wait: 0.3, face: [1, 0] },
        { go: [2.6, 1.3] }, { wait: 4, pose: 'water', face: [1, 0] },
      ],
    });

    /* --- HealthGIS --- */
    const H2 = hq2Group;
    deskWorker(H2, 0, 'type', { shirt: '#0f6b52', pants: '#2b2850', hair: '#241f4d', skin: '#e9b48d', hairStyle: 'short', shoes: '#2b2850' });
    deskWorker(H2, 1, 'draw', { shirt: '#2e8bff', pants: '#2b2850', hair: '#7a4a32', skin: '#f6d2b4', hairStyle: 'pony', shoes: '#fff8ec' });
    addHeadset(deskWorker(H2, 2, 'phone', { shirt: '#1fbf8f', pants: '#2b2850', hair: '#8a5a44', skin: '#e0a98a', hairStyle: 'pony', shoes: '#fff8ec' }));
    presenter(H2, { shirt: '#0f6b52', pants: '#2b2850', hair: '#5a3b2a', skin: '#f2c7a5', hairStyle: 'short', longSleeve: true, shoes: '#2b2850' });
    inspector(H2, { shirt: '#fff8ec', pants: '#2b2850', hair: '#241f4d', skin: '#e9b48d', hairStyle: 'short', longSleeve: true, shoes: '#2b2850' }, [0, 1]);
    gateGuard(H2, healthgisHQ, { shirt: '#0f3f30', pants: '#2b2850', hair: '#241f4d', skin: '#d9a07a', hat: 'beanie', hatColor: '#0f3f30', shoes: '#241f4d', longSleeve: true, belt: '#1fbf8f' });
    courierRun(H2, healthgisHQ, { shirt: '#2e8bff', pants: '#2b2850', hair: '#241f4d', skin: '#e0a98a', hat: 'beanie', hatColor: '#2e8bff', shorts: true, shoes: '#fff8ec' }, '#e6f7f1');

    /* --- Nexora AI --- */
    const H3 = hq3Group;
    deskWorker(H3, 0, 'type', { shirt: '#4b3fa6', pants: '#2b2850', hair: '#241f4d', skin: '#e9b48d', hairStyle: 'short', shoes: '#2b2850' });
    deskWorker(H3, 1, 'draw', { shirt: '#ff9fb8', pants: '#3a3568', hair: '#2b2850', skin: '#c98e68', hairStyle: 'long', shoes: '#ff6b5e' });
    addHeadset(deskWorker(H3, 2, 'phone', { shirt: '#5ac8c8', pants: '#2b2850', hair: '#8a5a44', skin: '#e0a98a', hairStyle: 'pony', shoes: '#fff8ec' }));
    presenter(H3, { shirt: '#8f7fe6', pants: '#2b2850', hair: '#5a3b2a', skin: '#f2c7a5', hairStyle: 'short', longSleeve: true, shoes: '#2b2850' });
    inspector(H3, { shirt: '#fff8ec', pants: '#2b2850', hair: '#241f4d', skin: '#e9b48d', hairStyle: 'short', longSleeve: true, shoes: '#2b2850' }, [0, 1]);
    gateGuard(H3, nexoraHQ, { shirt: '#2b2850', pants: '#2b2850', hair: '#241f4d', skin: '#d9a07a', hat: 'beanie', hatColor: '#4b3fa6', shoes: '#241f4d', longSleeve: true, belt: '#8f7fe6' });
    courierRun(H3, nexoraHQ, { shirt: '#ff9f43', pants: '#2b2850', hair: '#241f4d', skin: '#e0a98a', hat: 'beanie', hatColor: '#ff9f43', shorts: true, shoes: '#fff8ec' }, '#c9bfff');
  });

  /* ---------------------------------------------------------------- */
  /* 8.5 the west district, the lake and the lighthouse                */
  /* ---------------------------------------------------------------- */
  await stage(0.84, 'Growing the west district', () => {
    const cx = (CITY2.x0 + CITY2.x1) / 2, cz = (CITY2.z0 + CITY2.z1) / 2, STREET_Z = 21.5;
    slab(W, cx, cz, CITY2.x1 - CITY2.x0, CITY2.z1 - CITY2.z0, '#e4def7', 0.02, 0.04);
    slab(W, cx, STREET_Z, CITY2.x1 - CITY2.x0, 1.8, '#3f3d66', 0.04, 0.06);
    slab(W, cx, STREET_Z - 1.15, CITY2.x1 - CITY2.x0, 0.6, '#f4f0ff', 0.05, 0.06);
    slab(W, cx, STREET_Z + 1.15, CITY2.x1 - CITY2.x0, 0.6, '#f4f0ff', 0.05, 0.06);
    for (let i = 0; i < 17; i++) box(W, 0.45, 0.012, 0.07, CITY2.x0 + 0.8 + i * 1.0, 0.08, STREET_Z, '#fff1dc').castShadow = false;

    const winTex2 = canvasTexture((g, s) => {
      g.fillStyle = '#e6e0fa'; g.fillRect(0, 0, s, s);
      g.fillStyle = '#6ad0ff'; g.fillRect(34, 30, 60, 68);
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(34, 30, 60, 14);
    }, 128);
    winTex2.wrapS = winTex2.wrapT = THREE.RepeatWrapping;
    const tower = (x, z, w, d, h, tint, roofC) => {
      const side = (len) => {
        const t = winTex2.clone(); t.needsUpdate = true; t.repeat.set(Math.max(1, Math.round(len * 1.1)), Math.max(1, Math.round(h * 1.1)));
        return new THREE.MeshLambertMaterial({ color: tint, map: t });
      };
      const roof = new THREE.MeshLambertMaterial({ color: roofC });
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side(d), side(d), roof, roof, side(w), side(w)]);
      m.position.set(x, h / 2 + 0.05, z); m.castShadow = true; m.receiveShadow = true; W.add(m);
      box(W, w * 0.55, 0.3, d * 0.55, x, h + 0.2, z, '#8a84b8');
      if (h > 6) {
        cyl(W, 0.03, 0.04, 1.0, 5, x, h + 0.85, z, '#d8d2ff');
        ball(W, 0.08, x, h + 1.4, z, '#ff6b5e', { emissive: '#ff6b5e', emissiveIntensity: 1 }).castShadow = false;
      }
    };
    const NORTH = [[-28.2, 7.5, '#cdbff5', '#4b3fa6'], [-24.6, 5.2, '#bff0ee', '#2b2850'], [-21.0, 9.0, '#ffd0de', '#6c58cf'], [-17.4, 4.4, '#d8f5c8', '#3a2f5b']];
    const SOUTH = [[-28.2, 4.2, '#ffe6b8', '#8a5a44'], [-24.4, 6.6, '#cfe0ff', '#4b3fa6'], [-20.6, 5.0, '#f5ccff', '#6c58cf'], [-16.8, 8.2, '#bff0ee', '#2b2850']];
    NORTH.forEach(([x, h, tint, rf]) => tower(x, 17.6, 2.4, 2.4, h, tint, rf));
    SOUTH.forEach(([x, h, tint, rf]) => tower(x, 25.4, 2.4, 2.4, h, tint, rf));

    // fountain plaza
    const fo = new THREE.Group(); fo.position.set(-14.4, 0, 26.2); W.add(fo);
    cyl(fo, 0.9, 1.0, 0.18, 14, 0, 0.1, 0, '#d8d2ff');
    cyl(fo, 0.75, 0.75, 0.06, 14, 0, 0.2, 0, '#5fd0e8', { emissive: '#1f7f9a', emissiveIntensity: 0.4 }).castShadow = false;
    cyl(fo, 0.1, 0.14, 0.7, 8, 0, 0.5, 0, '#d8d2ff');
    const jet = ball(fo, 0.16, 0, 0.9, 0, '#bff3ff', { emissive: '#7ee8ff', emissiveIntensity: 0.8 }); jet.castShadow = false;
    const drops = [0, 1, 2, 3, 4, 5].map((i) => { const m = ball(fo, 0.05, 0, 0.9, 0, '#e8fbff', { emissive: '#9ff3ff', emissiveIntensity: 0.6 }); m.castShadow = false; return { m, a: (i / 6) * TAU }; });
    animators.push((dt, t) => {
      jet.scale.y = 1 + Math.sin(t * 5) * 0.2;
      drops.forEach((d, i) => { const k = (t * 0.9 + i / 6) % 1; d.m.position.set(Math.cos(d.a) * k * 0.7, 0.9 + Math.sin(k * Math.PI) * 0.55, Math.sin(d.a) * k * 0.7); d.m.scale.setScalar(1 - k * 0.5); });
    });

    // street lamps, round trees, benches
    [-27, -22.5, -18, -14.5].forEach((x) => addLamp(x, STREET_Z + 1.5));
    [-29.6, -26.6, -23.4, -20.2, -17.0].forEach((x, i) => {
      const t = new THREE.Group(); t.position.set(x, 0, 27.4); W.add(t);
      cyl(t, 0.07, 0.1, 0.7, 6, 0, 0.35, 0, '#8a5a44');
      ball(t, 0.5, 0, 1.0, 0, ['#55c28a', '#ffb3c7', '#6fd08a', '#ffc9a8', '#55c28a'][i]);
      ball(t, 0.32, 0.25, 0.85, 0.1, ['#3fae7a', '#ffa0bd', '#4fae7a', '#ffb07a', '#3fae7a'][i]);
    });
    [-26.2, -19.2].forEach((x) => {
      box(W, 0.95, 0.06, 0.34, x, 0.36, 19.9, '#c9966f'); box(W, 0.95, 0.3, 0.05, x, 0.55, 19.72, '#c9966f');
      box(W, 0.06, 0.34, 0.3, x - 0.4, 0.17, 19.9, '#2b2850'); box(W, 0.06, 0.34, 0.3, x + 0.4, 0.17, 19.9, '#2b2850');
    });

    // cars along the west street
    const car2 = (color) => {
      const c = new THREE.Group();
      box(c, 0.95, 0.24, 0.46, 0, 0.24, 0, color);
      box(c, 0.5, 0.22, 0.42, -0.05, 0.46, 0, '#fff1dc');
      box(c, 0.44, 0.14, 0.44, -0.05, 0.47, 0, '#bfe4ff', { emissive: '#9fd8ff', emissiveIntensity: 0.2 });
      [[-0.3, 0.24], [-0.3, -0.24], [0.3, 0.24], [0.3, -0.24]].forEach(([x, z]) => { cyl(c, 0.1, 0.1, 0.08, 10, x, 0.1, z, '#2b2850').rotation.x = Math.PI / 2; });
      box(c, 0.04, 0.07, 0.1, 0.48, 0.26, 0.14, '#fff3b0', { emissive: '#ffd36e', emissiveIntensity: 1 });
      box(c, 0.04, 0.07, 0.1, 0.48, 0.26, -0.14, '#fff3b0', { emissive: '#ffd36e', emissiveIntensity: 1 });
      W.add(c); return c;
    };
    const wc = [
      { g: car2('#ff9f43'), x: -27, dir: 1, z: STREET_Z + 0.42, sp: 1.5 },
      { g: car2('#5ac8c8'), x: -20, dir: -1, z: STREET_Z - 0.42, sp: 1.3 },
      { g: car2('#ff4fa3'), x: -16, dir: 1, z: STREET_Z + 0.42, sp: 1.1 },
    ];
    wc.forEach((c) => { c.g.rotation.y = c.dir > 0 ? 0 : Math.PI; c.g.position.set(c.x, 0.05, c.z); });
    animators.push((dt) => wc.forEach((c) => {
      c.x += c.dir * c.sp * dt;
      if (c.x > CITY2.x1 - 0.5) c.x = CITY2.x0 + 0.5; else if (c.x < CITY2.x0 + 0.5) c.x = CITY2.x1 - 0.5;
      c.g.position.x = c.x;
      c.g.scale.setScalar(Math.max(0.001, Math.min(1, Math.min(c.x - CITY2.x0, CITY2.x1 - c.x) / 1.5)));
    }));

    // a pedestrian walking the west pavement
    const walker = makePerson({ shirt: '#5ac8c8', pants: '#3a3568', hair: '#8a5a44', skin: '#e0a98a', hairStyle: 'long', shoes: '#fff8ec' });
    makeAgent(walker, W, {
      x: -28, z: STREET_Z - 1.15, ground: cityGround, speed: 0.9,
      steps: [{ go: [-16, STREET_Z - 1.15] }, { wait: 2, pose: 'wave', face: [0, 1] }, { go: [-28, STREET_Z - 1.15] }, { wait: 2 }],
    });
  });

  await stage(0.87, 'Filling the lake and lighting the lighthouse', () => {
    // lake with a pier and a rowing boat
    const lake = new THREE.Group(); lake.position.set(31, 0, 8); W.add(lake);
    cyl(lake, 4.7, 4.9, 0.06, 28, 0, -0.11, 0, '#c9b28a').castShadow = false;
    const lw = cyl(lake, 4.3, 4.3, 0.04, 28, 0, -0.07, 0, '#5fd0e8', { emissive: '#1f7f9a', emissiveIntensity: 0.35 }); lw.castShadow = false;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + rng() * 0.3, r = 4.4 + rng() * 0.35;
      cone(lake, 0.05, 0.6 + rng() * 0.4, 4, Math.cos(a) * r, 0.2, Math.sin(a) * r, '#3f9e6a');
    }
    for (let i = 0; i < 6; i++) {
      const a = rng() * TAU, r = 1.2 + rng() * 2.4;
      cyl(lake, 0.25, 0.25, 0.02, 8, Math.cos(a) * r, -0.04, Math.sin(a) * r, '#4fae7a').castShadow = false;
      ball(lake, 0.05, Math.cos(a) * r, -0.01, Math.sin(a) * r, '#ffb3c7').castShadow = false;
    }
    for (let i = 0; i < 9; i++) box(lake, 0.34, 0.06, 1.0, -4.3 + i * 0.42, 0.12, -0.0, '#c9966f');   // pier planks
    [-4.3, -2.6, -0.9].forEach((x) => { box(lake, 0.08, 0.5, 0.08, x, 0.0, 0.55, '#8a5a44'); box(lake, 0.08, 0.5, 0.08, x, 0.0, -0.55, '#8a5a44'); });
    const boat = new THREE.Group(); boat.position.set(1.0, 0, 1.6); lake.add(boat);
    box(boat, 1.1, 0.14, 0.45, 0, 0.0, 0, '#e8564a'); box(boat, 0.9, 0.05, 0.3, 0, 0.09, 0, '#fff1dc');
    box(boat, 0.05, 0.05, 1.0, 0.1, 0.2, 0, '#8a5a44');
    const ripL = [0, 1, 2].map((i) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 0.96, 28), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(-1.0, -0.04, -1.4); lake.add(m); return { m, off: i / 3 };
    });
    animators.push((dt, t) => {
      lw.material.emissiveIntensity = 0.3 + Math.sin(t * 1.2) * 0.08;
      boat.position.y = Math.sin(t * 1.6) * 0.03; boat.rotation.z = Math.sin(t * 1.3) * 0.05; boat.rotation.y = 0.3 + Math.sin(t * 0.4) * 0.1;
      ripL.forEach((r) => { const k = (t * 0.25 + r.off) % 1; r.m.scale.setScalar(0.3 + k * 2.2); r.m.material.opacity = (1 - k) * 0.45; });
    });
    const angler = makePerson({ shirt: '#ff9f43', pants: '#6a5a45', hair: '#241f4d', hat: 'straw', skin: '#e0a98a', shoes: '#8a5a44' });
    makeAgent(angler, lake, { x: -4.0, z: 0.0, face: [1, 0], ground: () => 0.2, steps: [{ wait: Infinity, pose: 'sit' }] });

    // lighthouse
    const lh = new THREE.Group(); lh.position.set(33, 0, 27); W.add(lh);
    cyl(lh, 2.3, 2.5, 0.25, 12, 0, 0.12, 0, '#8a84b8');
    for (let i = 0; i < 5; i++) cyl(lh, 0.8 - i * 0.08, 0.9 - i * 0.08, 0.9, 12, 0, 0.7 + i * 0.9, 0, i % 2 ? '#e8564a' : '#fff8ec');
    cyl(lh, 0.78, 0.7, 0.14, 12, 0, 5.3, 0, '#2b2850');
    cyl(lh, 0.46, 0.46, 0.6, 10, 0, 5.7, 0, '#fff3b0', { emissive: '#ffd36e', emissiveIntensity: 1 }).castShadow = false;
    cone(lh, 0.62, 0.55, 10, 0, 6.28, 0, '#e8564a');
    ball(lh, 0.08, 0, 6.65, 0, '#ffd36e', { emissive: '#ffd36e', emissiveIntensity: 1 }).castShadow = false;
    box(lh, 0.3, 0.55, 0.04, 0, 0.45, 0.8, '#6c58cf');
    const lhGlow = glow(lh, 0xffe08a, 4.2, 0.6, 0, 5.7, 0);
    const beam = new THREE.Group(); beam.position.set(0, 5.7, 0); lh.add(beam);
    const bm = new THREE.Mesh(new THREE.ConeGeometry(1.1, 9, 16, 1, true), new THREE.MeshBasicMaterial({ color: '#fff3b0', transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    bm.rotation.z = Math.PI / 2; bm.position.x = 4.5; beam.add(bm);
    const bm2 = bm.clone(); bm2.rotation.z = -Math.PI / 2; bm2.position.x = -4.5; beam.add(bm2);
    animators.push((dt, t) => { beam.rotation.y += dt * 0.9; lhGlow.material.opacity = 0.5 + Math.sin(t * 3) * 0.12; });
  });

  /* ---------------------------------------------------------------- */
  /* 8.6 sky life: rainbow, hot-air balloon, floating islets           */
  /* ---------------------------------------------------------------- */
  await stage(0.9, 'Painting a rainbow and floating islets', () => {
    // rainbow behind the northern mountains
    const rb = new THREE.Group(); rb.position.set(6, -6, -(R + 46)); W.add(rb);
    ['#ff5e5e', '#ff9f43', '#ffe08a', '#7ed957', '#4fd1e0', '#5a7bff', '#b36bff'].forEach((c, i) => {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(50 - i * 1.5, 0.8, 6, 64, Math.PI), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.38, depthWrite: false, fog: false }));
      rb.add(arc);
    });

    // hot-air balloon circling the island
    const bal = new THREE.Group(); W.add(bal);
    const envGeo = new THREE.SphereGeometry(1.5, 18, 14), ep = envGeo.attributes.position, ec = new Float32Array(ep.count * 3), pal = ['#ff6b5e', '#ffe08a', '#5ac8c8', '#8f7fe6'].map((c) => new THREE.Color(c));
    for (let i = 0; i < ep.count; i++) pal[Math.floor(((Math.atan2(ep.getX(i), ep.getZ(i)) + Math.PI) / TAU) * 8) % 4].toArray(ec, i * 3);
    envGeo.setAttribute('color', new THREE.BufferAttribute(ec, 3));
    const env = new THREE.Mesh(envGeo, new THREE.MeshLambertMaterial({ vertexColors: true })); env.scale.set(1, 1.2, 1); env.position.y = 3.2; env.castShadow = true; bal.add(env);
    box(bal, 0.7, 0.45, 0.7, 0, 0.9, 0, '#a9714f');
    [[0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]].forEach(([x, z]) => { const r = cyl(bal, 0.012, 0.012, 1.7, 4, x * 1.2, 1.9, z * 1.2, '#2b2850'); r.castShadow = false; });
    glow(bal, 0xffa040, 1.2, 0.8, 0, 1.4, 0);
    animators.push((dt, t) => {
      const a = t * 0.05 + 1.0, rad = R * 0.55;
      bal.position.set(Math.cos(a) * rad, 16 + Math.sin(t * 0.5) * 0.8, Math.sin(a) * rad);
      bal.rotation.y = t * 0.1; bal.rotation.z = Math.sin(t * 0.6) * 0.03;
    });

    // floating islets around the main island
    const islets = [];
    for (let i = 0; i < (simple ? 3 : 7); i++) {
      const a = (i / 7) * TAU + 0.4, r = R + 9 + (i % 3) * 5, g = new THREE.Group();
      const rk = cone(g, 1.8, 2.6, 8, 0, -1.3, 0, '#5a4aa8'); rk.rotation.x = Math.PI;
      cyl(g, 1.8, 1.8, 0.3, 10, 0, 0.1, 0, '#7bd88f');
      cone(g, 0.45, 1.0, 6, -0.3, 0.8, 0.1, '#2f9e78'); cone(g, 0.32, 0.8, 6, 0.5, 0.7, -0.3, '#38ae84');
      if (i % 2) ball(g, 0.45, 0.4, 0.55, 0.5, '#ffb3c7');
      g.position.set(Math.cos(a) * r, 3 + (i % 4) * 2.5, Math.sin(a) * r); g.rotation.y = i;
      W.add(g); islets.push({ g, base: g.position.y, ph: i * 1.7 });
    }
    animators.push((dt, t) => islets.forEach((o) => { o.g.position.y = o.base + Math.sin(t * 0.6 + o.ph) * 0.5; o.g.rotation.y += dt * 0.05; }));
  });

  /* ---------------------------------------------------------------- */
  /* 9. atmosphere: clouds, floating rocks, sparkles, birds, butterflies */
  /* ---------------------------------------------------------------- */
  let cloudsFar;
  await stage(0.93, 'Drifting clouds in', () => {
    cloudsFar = new THREE.Group(); W.add(cloudsFar);
    const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#a9bce8', emissiveIntensity: 0.35, flatShading: true });
    const count = simple ? 10 : 26;
    for (let i = 0; i < count; i++) {
      const parts = [], blobs = 4 + Math.floor(rng() * 3);
      for (let b = 0; b < blobs; b++) {
        const g = new THREE.IcosahedronGeometry(1, 1);
        const sc = 1.4 + rng() * 1.6;
        g.scale(sc * 1.3, sc * 0.75, sc); g.translate((b - blobs / 2) * 1.8 + rng(), rng() * 0.6, (rng() - 0.5) * 1.6);
        parts.push(g);
      }
      const cloud = new THREE.Mesh(mergeGeometries(parts), cloudMat);
      const low = i % 2 === 0, ang = rng() * TAU, rad = R + 22 + rng() * 60;
      cloud.position.set(Math.cos(ang) * rad, low ? -18 - rng() * 12 : 12 + rng() * 22, Math.sin(ang) * rad);
      cloud.scale.setScalar(low ? 2.2 + rng() : 1.3 + rng() * 1.0);
      cloud.rotation.y = rng() * TAU; cloud.userData.bob = rng() * TAU;
      cloudsFar.add(cloud);
    }
    const floaters = [];
    for (let i = 0; i < (simple ? 5 : 14); i++) {
      const a = rng() * TAU, r = R + 2 + rng() * 7;
      const m = new THREE.Mesh(geo('floatrock', () => new THREE.IcosahedronGeometry(1, 0)), mat(i % 2 ? '#5a4aa8' : '#8a84b8'));
      m.position.set(Math.cos(a) * r, -1.5 - rng() * 9, Math.sin(a) * r); m.scale.setScalar(0.35 + rng() * 0.9); m.castShadow = true;
      m.userData = { base: m.position.y, ph: rng() * TAU, sp: 0.4 + rng() * 0.5 };
      W.add(m); floaters.push(m);
    }
    const N = simple ? 80 : small ? 140 : 340, pp = new Float32Array(N * 3), seeds = [];
    for (let i = 0; i < N; i++) {
      const a = rng() * TAU, r = Math.sqrt(rng()) * (R - 1);
      seeds.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, y: rng() * 9, ph: rng() * TAU, sp: 0.4 + rng() * 0.8 });
    }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
    const points = new THREE.Points(pg, new THREE.PointsMaterial({ map: glowTex, size: 0.34, color: 0xfff3b0, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    points.frustumCulled = false; W.add(points);
    const writeSparkles = (t) => {
      seeds.forEach((s, i) => {
        pp[i * 3] = s.x + Math.sin(t * s.sp + s.ph) * 0.7;
        pp[i * 3 + 1] = 0.5 + ((s.y + t * 0.25 * s.sp) % 9);
        pp[i * 3 + 2] = s.z + Math.cos(t * s.sp * 0.8 + s.ph) * 0.7;
      });
      pg.attributes.position.needsUpdate = true;
    };
    writeSparkles(0);

    const birds = [];
    for (let i = 0; i < (simple ? 3 : 9); i++) {
      const b = new THREE.Group();
      const body = put(b, geo('birdbody', () => new THREE.ConeGeometry(0.08, 0.42, 5)), mat(i % 2 ? '#ffffff' : '#fff1dc'), 0, 0, 0, false); body.rotation.z = -Math.PI / 2;
      const wl = new THREE.Group(), wr = new THREE.Group(); b.add(wl, wr);
      put(wl, geo('wing', () => new THREE.BoxGeometry(0.2, 0.015, 0.4)), mat('#ffffff'), 0, 0, 0.2, false);
      put(wr, geo('wing', () => new THREE.BoxGeometry(0.2, 0.015, 0.4)), mat('#ffffff'), 0, 0, -0.2, false);
      W.add(b); birds.push({ b, wl, wr, rad: 16 + i * 4.4, h: 12 + (i % 3) * 1.8, sp: 0.15 + i * 0.01, off: i * 1.3 });
    }
    const flies = [];
    for (let i = 0; i < (simple ? 3 : 14); i++) {
      let cx = 0, cz = 0;
      for (let k = 0; k < 60; k++) {
        const rr = Math.sqrt(rng()) * (R - 4), a = rng() * TAU; cx = rr * Math.cos(a); cz = rr * Math.sin(a);
        if (terrainH(cx, cz) < 0.5 && isClear(cx, cz, 0.5)) break;
      }
      const f = new THREE.Group(), col = ['#ff9fb8', '#ffe08a', '#7ee8ff', '#c9a7ff'][i % 4];
      const wl = new THREE.Group(), wr = new THREE.Group(); f.add(wl, wr);
      put(wl, geo('bwing', () => new THREE.BoxGeometry(0.1, 0.008, 0.11)), mat(col), 0, 0, 0.055, false);
      put(wr, geo('bwing', () => new THREE.BoxGeometry(0.1, 0.008, 0.11)), mat(col), 0, 0, -0.055, false);
      put(f, geo('bbody', () => new THREE.BoxGeometry(0.1, 0.02, 0.02)), mat('#2b2850'), 0, 0, 0, false);
      W.add(f); flies.push({ f, wl, wr, cx, cz, base: terrainH(cx, cz), ph: rng() * TAU, r: 0.8 + rng() * 1.1, sp: 0.4 + rng() * 0.4 });
    }

    animators.push((dt, t) => {
      writeSparkles(t);
      cloudsFar.rotation.y += dt * 0.004;
      cloudsFar.children.forEach((c) => { c.position.y += Math.sin(t * 0.3 + c.userData.bob) * dt * 0.05; });
      floaters.forEach((f) => { f.position.y = f.userData.base + Math.sin(t * f.userData.sp + f.userData.ph) * 0.4; f.rotation.y += dt * 0.2; });
      birds.forEach((o) => {
        const a = t * o.sp + o.off, flap = Math.sin(t * 9 + o.off * 3) * 0.7;
        o.b.position.set(Math.cos(a) * o.rad, o.h + Math.sin(t * 0.7 + o.off) * 0.4, Math.sin(a) * o.rad);
        o.b.rotation.y = -Math.atan2(Math.cos(a), -Math.sin(a)); o.b.rotation.x = -0.15;
        o.wl.rotation.x = flap; o.wr.rotation.x = -flap;
      });
      flies.forEach((o) => {
        const a = t * o.sp + o.ph, flap = 0.2 + Math.abs(Math.sin(t * 14 + o.ph)) * 1.1;
        o.f.position.set(o.cx + Math.cos(a) * o.r, o.base + 0.7 + Math.sin(a * 2.1) * 0.35, o.cz + Math.sin(a * 1.3) * o.r);
        o.f.rotation.y = -Math.atan2(Math.cos(a * 1.3) * 1.3, -Math.sin(a));
        o.wl.rotation.x = flap; o.wr.rotation.x = -flap;
      });
    });
  });

  /* ---------------------------------------------------------------- */
  /* 10. hotspots: glowing markers + click / hover detection           */
  /* ---------------------------------------------------------------- */
  const markers = new THREE.Group(); scene.add(markers);
  const markerList = [], hitProxies = [];
  let pickId = null, domHoverId = null;
  const MARK = 1.3;

  (config.hotspots || []).forEach((h, idx) => {
    const color = new THREE.Color(h.color || '#ffffff');
    const pos = h.position.map((n) => n * S);
    const g = new THREE.Group(); g.position.fromArray(pos); g.scale.setScalar(MARK); markers.add(g);
    const gem = new THREE.Mesh(geo('markgem', () => new THREE.OctahedronGeometry(0.28, 0)), new THREE.MeshBasicMaterial({ color }));
    gem.scale.y = 1.4; g.add(gem);
    const halo = glow(g, color, 2.0, 0.8);
    const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, color: 0xffffff, transparent: true, depthWrite: false, fog: false }));
    g.add(ring);
    const proxy = new THREE.Mesh(geo('proxy', () => new THREE.SphereGeometry(1.0, 8, 6)), new THREE.MeshBasicMaterial({ visible: false }));
    proxy.userData.id = h.id; g.add(proxy); hitProxies.push(proxy);
    markerList.push({ id: h.id, g, gem, halo, ring, base: pos[1], ph: idx * 1.3, hover: 0 });
  });

  const tmpV = new THREE.Vector3();
  const rayPick = new THREE.Raycaster(), rayOcc = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function markerHidden(m) {
    if (!m || !m.g || !terrain) return false;
    tmpV.copy(m.g.position).sub(camera.position);
    const dist = tmpV.length();
    if (dist < 1e-4) return false;
    rayOcc.set(camera.position, tmpV.normalize()); rayOcc.far = dist - 0.5;
    return rayOcc.intersectObject(terrain, false).length > 0;
  }
  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    rayPick.setFromCamera(ndc, camera);
    const hit = rayPick.intersectObjects(hitProxies, false)[0];
    if (!hit || !hit.object || !hit.object.userData) return null;
    const ground = terrain ? rayPick.intersectObject(terrain, false)[0] : null;
    if (ground && ground.distance < hit.distance - 0.4) return null;
    return hit.object.userData.id || null;
  }
  always.push((dt, t) => {
    const hot = pickId || domHoverId;
    markerList.forEach((m) => {
      if (animate) {
        m.g.position.y = m.base + Math.sin(t * 1.8 + m.ph) * 0.14;
        m.gem.rotation.y += dt * 1.6;
        m.halo.material.opacity = 0.65 + Math.sin(t * 2.6 + m.ph) * 0.18;
        const k = (t * 0.5 + m.ph) % 1;
        m.ring.scale.setScalar(0.5 + k * 2.2); m.ring.material.opacity = (1 - k) * 0.85;
      } else {
        m.ring.material.opacity = 0; m.halo.material.opacity = 0.75;
      }
      const want = hot === m.id ? 1 : 0;
      if (Math.abs(m.hover - want) > 0.002) {
        m.hover = lerp(m.hover, want, Math.min(1, dt * 10));
        m.g.scale.setScalar(MARK + m.hover * 0.35); dirty = true;
      }
    });
  });

  function setPick(id) {
    if (id === pickId) return;
    pickId = id; canvas.style.cursor = id ? 'pointer' : ''; dirty = true;
    onHotspotHover(id);
  }

  /* ---------------------------------------------------------------- */
  /* 11. camera: GSAP flights, limits, auto-rotate                     */
  /* ---------------------------------------------------------------- */
  let mode = 'home', flight = null, shiftTl = null, wantAuto = false, userHold = false, holdTimer = 0;
  const refreshAuto = () => { controls.autoRotate = animate && wantAuto && mode === 'home' && !flight && !userHold; };

  function flyTo(id, o = {}) {
    const v = views[id];
    if (!v || disposed) return;
    mode = id === 'home' || id === 'explore' ? id : 'section';
    markers.visible = mode !== 'section';
    setPick(null);
    if (flight) { flight.kill(); flight = null; }
    controls.enabled = false;

    const p0 = camera.position.clone(), t0 = controls.target.clone();
    const p1 = new THREE.Vector3().fromArray(v.position), t1 = new THREE.Vector3().fromArray(v.target);
    const dist = p0.distanceTo(p1);
    const dur = animate ? (o.duration || clamp(1.25 + dist * 0.03, 1.6, 3.2)) : 0.01;
    const lift = animate ? clamp(dist * 0.12, 0.4, 5) : 0;
    const k = { p: 0, t: 0 }, boost = { v: fovBoost }, pos = new THREE.Vector3(), tgt = new THREE.Vector3();

    const apply = () => {
      pos.lerpVectors(p0, p1, k.p); pos.y += Math.sin(Math.PI * clamp(k.p, 0, 1)) * lift;
      tgt.lerpVectors(t0, t1, k.t);
      camera.position.copy(pos); controls.target.copy(tgt); camera.lookAt(tgt);
      if (boost.v !== fovBoost) { fovBoost = boost.v; refreshFov(); }
      dirty = true;
    };
    const done = () => {
      flight = null;
      camera.position.copy(p1); controls.target.copy(t1); camera.lookAt(t1);
      fovBoost = 0; refreshFov();
      setLimits(mode); controls.enabled = mode !== 'section'; controls.update();
      refreshAuto(); dirty = true;
    };
    flight = new Timeline(done);
    flight.to(k, { p: 1 }, { duration: dur, ease: 'power3.inOut', onUpdate: apply });
    flight.to(k, { t: 1 }, { duration: dur * 0.82, at: dur * 0.14, ease: 'power2.inOut', onUpdate: apply });
    if (fovBoost !== 0) flight.to(boost, { v: 0 }, { duration: dur, ease: 'power2.out', onUpdate: apply });
    refreshAuto();
  }

  function setViewShift(x = 0, y = 0, duration = 1) {
    if (shiftTl) { shiftTl.kill(); shiftTl = null; }
    if (!animate || duration <= 0.01) { shift.x = x; shift.y = y; applyView(true); return; }
    shiftTl = new Timeline(() => { shiftTl = null; });
    shiftTl.to(shift, { x, y }, { duration, ease: 'power3.inOut', onUpdate: () => applyView(true) });
  }

  function nudge(dx, dy, zoom) {
    if (flight || mode === 'section') return;
    onUserInteract();
    const off = camera.position.clone().sub(controls.target), s = new THREE.Spherical().setFromVector3(off);
    s.theta += dx; s.phi = clamp(s.phi + dy, controls.minPolarAngle + 0.01, controls.maxPolarAngle - 0.01);
    s.radius = clamp(s.radius * zoom, controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s));
    controls.update(); dirty = true;
  }

  const holdFor = (ms) => { userHold = true; refreshAuto(); clearTimeout(holdTimer); holdTimer = setTimeout(() => { userHold = false; refreshAuto(); }, ms); };
  let down = null, hoverRaf = 0, lastMove = null;
  listen(canvas, 'pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; onUserInteract(); userHold = true; refreshAuto(); });
  listen(canvas, 'pointerup', (e) => {
    holdFor(3500);
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 7 && performance.now() - down.t < 700 && !flight && (mode === 'home' || mode === 'explore')) {
      const id = pick(e.clientX, e.clientY);
      if (id) onHotspotClick(id);
    }
    down = null;
  });
  listen(canvas, 'pointercancel', () => { down = null; holdFor(1500); });
  listen(canvas, 'wheel', () => { onUserInteract(); holdFor(3500); }, { passive: true });
  listen(canvas, 'pointerleave', () => setPick(null));
  listen(canvas, 'pointermove', (e) => {
    if (e.pointerType !== 'mouse' || e.buttons || flight || (mode !== 'home' && mode !== 'explore')) return;
    lastMove = e;
    if (!hoverRaf) hoverRaf = requestAnimationFrame(() => { hoverRaf = 0; if (lastMove) setPick(pick(lastMove.clientX, lastMove.clientY)); });
  });
  listen(window, 'pointermove', (e) => {
    if (e.pointerType !== 'mouse' || !animate) return;
    par.tx = (e.clientX / size.w - 0.5) * 2; par.ty = (e.clientY / size.h - 0.5) * 2;
  });
  controls.addEventListener('change', () => { dirty = true; });

  /* ---------------------------------------------------------------- */
  /* optional real model (config.models.camper)                        */
  /* ---------------------------------------------------------------- */
  const modelCfg = config.models || {};
  async function loadOptionalModels() {
    if (!modelCfg.camper) return;
    onProgress(0.94, 'Loading the camper model');
    try {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const loading = new Promise((resolve, reject) => {
        new GLTFLoader().load(modelCfg.camper, resolve, (e) => { if (e.total) onProgress(0.94 + 0.04 * (e.loaded / e.total), 'Loading the camper model'); }, reject);
      });
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), 15000));
      const gltf = await Promise.race([loading, timeout]);
      const model = gltf.scene;
      model.scale.setScalar(modelCfg.camperScale || 1);
      model.rotation.y = modelCfg.camperRotationY || 0;
      if (modelCfg.camperOffset) model.position.fromArray(modelCfg.camperOffset);
      model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      van.body.visible = false; van.group.add(model);
    } catch (err) {
      console.warn('Camper model failed, using the built-in van:', err);
      onWarning('The 3D camper model could not load, so the built-in van is shown.');
    }
  }
  await loadOptionalModels();

  /* ---------------------------------------------------------------- */
  /* get everything ready to draw                                      */
  /* ---------------------------------------------------------------- */
  onProgress(0.97, 'Warming up the graphics');
  await pause();
  scene.updateMatrixWorld(true);
  try {
    if (renderer.compileAsync) await Promise.race([renderer.compileAsync(scene, camera), new Promise((r) => setTimeout(r, 4000))]);
    else renderer.compile(scene, camera);
  } catch (e) { /* not critical */ }

  const homeV = views.home;
  camera.position.set(homeV.position[0] + 22 * CAMERA_SCALE, homeV.position[1] + 24 * CAMERA_SCALE, homeV.position[2] + 34 * CAMERA_SCALE);
  controls.target.fromArray(homeV.target);
  camera.lookAt(controls.target);
  if (!animate) { camera.position.fromArray(homeV.position); camera.lookAt(controls.target); }
  setLimits('section');
  controls.enabled = false;
  controls.update();

  /* ---------------------------------------------------------------- */
  /* 12. the loop                                                      */
  /* ---------------------------------------------------------------- */
  let last = 0, t = 0, occIndex = 0;
  const perf = { warm: 0, n: 0, sum: 0, done: false };
  const screens = (config.hotspots || []).map((h) => ({ id: h.id, x: 0, y: 0, visible: false }));
  const hiddenBy = {};

  function downgrade() {
    renderer.setPixelRatio(1); resize();
    if (sunLight && sunLight.castShadow) sunLight.castShadow = false;
    onWarning('Switched to lighter graphics so the scene stays smooth.');
  }

  function update(dt) {
    stepFallbackTweens(dt);
    if (animate) {
      for (let i = 0; i < animators.length; i++) {
        try { animators[i](dt, t); } catch (err) { console.warn('An animator skipped a frame:', err); }
      }
    }
    for (let i = 0; i < always.length; i++) {
      try { always[i](dt, t); } catch (err) { console.warn('A state update skipped a frame:', err); }
    }

    par.x += (par.tx - par.x) * Math.min(1, dt * 2.5); par.y += (par.ty - par.y) * Math.min(1, dt * 2.5);
    if (animate && cloudsFar) { cloudsFar.position.x = -par.x * 1.5; cloudsFar.position.y = -par.y * 0.8; }
    applyView(false);

    if (!flight && (controls.enabled || controls.autoRotate) && controls.update()) dirty = true;

    if (mode === 'explore') {
      try {
        if (markerList.length) {
          const m = markerList[occIndex++ % markerList.length];
          if (m) hiddenBy[m.id] = markerHidden(m);
        }
        markerList.forEach((m, i) => {
          if (!m || !m.g) return;
          tmpV.copy(m.g.position).project(camera);
          const s = screens[i];
          if (!s) return;
          s.x = (tmpV.x * 0.5 + 0.5) * size.w; s.y = (-tmpV.y * 0.5 + 0.5) * size.h;
          s.visible = tmpV.z < 1 && Math.abs(tmpV.x) < 1.08 && Math.abs(tmpV.y) < 1.08 && !hiddenBy[m.id];
        });
        onFrame(screens);
      } catch (err) {
        console.warn('Hotspot label update skipped a frame:', err);
      }
    }

    if (animate || dirty) { renderer.render(scene, camera); dirty = false; }

    if (animate && !perf.done && ++perf.warm > 90) {
      perf.sum += dt;
      if (++perf.n >= 120) { perf.done = true; if (perf.sum / perf.n > 0.034) downgrade(); }
    }
  }

  function loop(now) {
    rafId = requestAnimationFrame(loop);
    if (document.hidden) { last = now; return; }
    const dt = clamp((now - last) / 1000, 0, 0.05); last = now; t += dt;
    try { update(dt); } catch (err) { fail(err); }
  }
  function start() {
    if (rafId || disposed) return;
    last = performance.now(); rafId = requestAnimationFrame(loop);
  }
  function stop() { cancelAnimationFrame(rafId); rafId = 0; }

  function dispose() {
    if (disposed) return;
    disposed = true; stop();
    if (flight) flight.kill();
    if (shiftTl) shiftTl.kill();
    clearTimeout(holdTimer); cancelAnimationFrame(hoverRaf);
    cleanups.forEach((fn) => fn());
    controls.dispose();
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach((m) => { if (m) { if (m.map) m.map.dispose(); m.dispose(); } });
    });
    renderer.dispose();
    try { renderer.forceContextLoss(); } catch (e) { /* ignore */ }
    canvas.style.cursor = '';
  }

  return {
    start,
    dispose,
    flyTo: (id) => flyTo(id),
    setViewShift,
    nudge,
    setHover: (id) => { domHoverId = id; dirty = true; },
    setAutoRotate: (on) => { wantAuto = !!on; refreshAuto(); },
    playIntro() {
      if (!animate) { flyTo('home'); return; }
      fovBoost = 16; refreshFov();
      flyTo('home', { duration: 4.2 });
    },
  };
}
