/* =====================================================================
   world.js — the 3D miniature world (Three.js) and its camera (GSAP)
   ---------------------------------------------------------------------
   main.js calls createWorld() and then uses the object it returns:
     start(), playIntro(), flyTo(id), setHover(id), setViewShift(x, y, s),
     setAutoRotate(on), nudge(dx, dy, zoom), next(), dispose()

   WHAT IS NEW IN THIS VERSION
     • Circular railway: the track runs all the way round the island and the
       train stops at the station every lap.
     • The aeroplane takes off, flies a lap over the island and lands.
     • The old Nexora tower is gone. Nexora AI now has its own office.
     • Offices are smaller. Clicking an office lifts the roof so you can see
       the glass cabins and the people inside.
     • Double-click (or double-tap) empty space to visit the people one by
       one. Each person introduces themselves in a speech bubble.
     • "About me": the person speaks professionally (see config.about.lines).
     • Every office has a details signboard (config.companies).

   File map (search for these headings):
     0. helpers   1. renderer   2. sky + lights   3. terrain   4. nature
     5. landmarks 6. city       6.5 airport  6.6 railway   7. offices
     8. people    8.5 district / lake / lighthouse   8.6 sky life
     9. atmosphere  10. hotspots  11. camera + tour  12. loop
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
const TRACK_R = 44;          // radius of the circular railway track
const STATION_A = 1.0;       // where the station is on the ring (radians)
const OFFICE_SCALE = 0.72;   // how big the project offices are (1 = original)

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
  const rectMask = (x, z, r, m) => 1 - smoothstep(0, m, Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1)));

  // Hills: [x, z, height, radius].
  const BUMPS = [
    [-8, -8.5, 6.0, 6.5], [-1.5, -10, 8.6, 7.5], [6, -8.8, 6.5, 6.5], [11.5, -5.5, 4.5, 5.5], [-12.5, -5.5, 4.2, 5.2],
    [-21, 9, 3.4, 5.5], [-20, -9, 4.2, 6], [18, -14, 3.8, 5.5], [21, 4, 2.8, 4.5], [-4, -20, 3.6, 6], [10, -21, 3.0, 5],
    // the outer mountain ring
    [28, -24, 4.6, 6.5], [-30, -22, 5.0, 7], [36, -10, 3.6, 5.5], [-8, -33, 4.6, 6.5], [8, -34, 4.0, 6],
    [-18, -30, 3.8, 6], [20, -31, 3.6, 6],
  ];
  // Flat zones: the old Nexora tower zone is gone (open land now).
  const ZONES = [
    { x: -6.2, z: 6.8, r: 2.2, y: 0 },
    { x: -3.6, z: 8.0, r: 2.0, y: 0 },
    { x: -8.8, z: 8.0, r: 1.6, y: 0 },
    { x: 9.8, z: 0.2, r: 3.2, y: 0 },
    { x: 2.0, z: 9.5, r: 1.5, y: 0 },
    { x: 10.8, z: 6.6, r: 1.3, y: 0 },
    { x: -9.6, z: -1.2, r: 2.0, y: 0 },
    { x: -5.6, z: 0.3, r: 2.0, y: -0.18 },
    { x: -1.4, z: 10.8, r: 1.5, y: 0 },
    { x: -15.5, z: 7.5, r: 6.0, y: 0 },
    { x: 24.0, z: -4.0, r: 6.0, y: 0 },
    { x: 31.0, z: 8.0, r: 5.2, y: -0.18 },   // the lake
    { x: 29.0, z: 25.0, r: 2.6, y: 0 },      // the lighthouse (moved inward for the railway)
    { x: Math.cos(STATION_A) * (TRACK_R - 3.4), z: Math.sin(STATION_A) * (TRACK_R - 3.4), r: 3.6, y: 0 },   // the station
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
    h = lerp(h, 0, 1 - smoothstep(1.2, 3.2, Math.abs(r - TRACK_R)));   // flat bed for the circular railway
    return lerp(h, 0, smoothstep(R - 0.8, R, r));
  }
  function inRect(x, z, r, margin) { return x > r.x0 - margin && x < r.x1 + margin && z > r.z0 - margin && z < r.z1 + margin; }
  function isClear(x, z, margin) {
    for (const zn of ZONES) if (Math.hypot(x - zn.x, z - zn.z) < zn.r + margin) return false;
    if (inRect(x, z, CITY, margin + 1) || inRect(x, z, CITY2, margin + 1) || inRect(x, z, AIRPORT, margin + 1)) return false;
    if (Math.abs(Math.hypot(x, z) - TRACK_R) < 1.8 + margin) return false;      // keep the railway free
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
