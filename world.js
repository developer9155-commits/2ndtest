/* =====================================================================
   world.js — the 3D miniature world (Three.js) and its camera (GSAP)
   ---------------------------------------------------------------------
   main.js calls createWorld() and then uses the object it returns:
     start(), playIntro(), flyTo(id), setHover(id), setViewShift(x, y, s),
     setAutoRotate(on), nudge(dx, dy, zoom), dispose()

   What is new in this version
     • The whole world is bigger (WORLD_SCALE below).
     • People are rebuilt: faces, hair, hands, knees, shoes, clothes.
       Two new villagers: a fisher at the pond and a student at the school.
     • More beauty: blossom trees, bushes, lamp posts, birds, butterflies,
       pond ripples, softer shadows.

   File map (search for these headings):
     0. helpers          small math / random / animation helpers
     1. renderer         the WebGL renderer, scene, camera, controls
     2. sky + lights     background gradient, sun, shadows
     3. terrain          island, purple hills, road
     4. nature           pine + blossom trees, bushes, rocks, flowers, pond
     5. landmarks        camp + camper van, beacon tower, farm, signpost, mailbox, school
     6. people           me, hiker, farmer, cyclist, fisher, student
     7. atmosphere       clouds, floating rocks, sparkles, birds, butterflies
     8. hotspots         glowing markers + click / hover detection
     9. camera           GSAP flights between places, limits, view shift
    10. loop             the animation loop and clean-up
   ===================================================================== */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ------------------------------------------------------------------ */
/* SIZE SETTINGS — change these to make the world bigger or smaller    */
/* ------------------------------------------------------------------ */
const WORLD_SCALE = 1.35;   // how much bigger the island and everything on it is (1 = old size)
const CAMERA_SCALE = 1.2;   // how far back the home / explore camera sits (keep a bit below WORLD_SCALE)

/* ------------------------------------------------------------------ */
/* 0. helpers                                                          */
/* ------------------------------------------------------------------ */
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

// A seeded random generator: the world looks the same every time it loads.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// A repeatable pseudo-random number for any (x, y, z): used for terrain jitter and noise.
function hash3(x, y, z) {
  let h = Math.imul(Math.round(x * 1000) | 0, 374761393) ^ Math.imul(Math.round(y * 1000) | 0, 668265263) ^ Math.imul(Math.round(z * 1000) | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, z) {                           // smooth 2D value noise, result 0..1
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash3(ix, 0.5, iz), b = hash3(ix + 1, 0.5, iz), c = hash3(ix, 0.5, iz + 1), d = hash3(ix + 1, 0.5, iz + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
// Give every vertex of a geometry one colour (so several parts can be merged into one mesh).
function paintGeo(g, hex) {
  const c = new THREE.Color(hex), arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < g.attributes.position.count; i++) c.toArray(arr, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/* ---- tiny animation layer -------------------------------------------
   Uses GSAP when it loaded. If the GSAP file was blocked, a built-in
   fallback tween does the same job, so camera moves still work.        */
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

// A timeline: several tweens that run together. kill() stops them all.
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
  const simple = quality === 'simple';
  const small = window.matchMedia('(max-width: 760px)').matches;
  const animate = !reducedMotion;
  const cleanups = [];
  const listen = (target, type, fn, o) => { target.addEventListener(type, fn, o); cleanups.push(() => target.removeEventListener(type, fn, o)); };
  const pause = () => new Promise((r) => setTimeout(r, 16));       // lets the loading bar repaint between steps
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
  scene.fog = new THREE.Fog(0xcfe6ff, 95, 250);

  // Everything that belongs to the island lives inside W, which is scaled up.
  const W = new THREE.Group();
  W.scale.setScalar(S);
  scene.add(W);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 900);
  const size = { w: 1, h: 1 };
  let fovBoost = 0;                                   // extra field of view, used by the intro flight
  const baseFov = (aspect) => clamp(38 * Math.pow(Math.max(1, 1 / aspect), 0.9), 38, 68); // wider on tall phone screens

  // Where the camera can go (from config.js, with safe defaults). Values here are in the
  // old, un-scaled units; they are converted to the bigger world just below.
  const rawViews = {
    home: { position: [17, 8.5, 25], target: [0, 1.8, 0] },
    explore: { position: [13, 13.5, 22], target: [0, 1.2, 0] },
    ...(config.views || {}),
  };
  (config.hotspots || []).forEach((h) => { if (h.camera) rawViews[h.id] = h.camera; });
  const views = {};
  Object.keys(rawViews).forEach((id) => {
    const v = rawViews[id];
    const wide = id === 'home' || id === 'explore';
    const k = wide ? CAMERA_SCALE : S;                // close-up views scale with the world so framing stays the same
    views[id] = { position: v.position.map((n) => n * k), target: v.target.map((n) => n * S) };
  });

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enablePan = false;                          // visitors can rotate and zoom, but not slide away from the island
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.7;
  controls.autoRotateSpeed = 0.45;
  controls.target.fromArray(views.home.target);

  // Camera limits keep the visitor from zooming inside the island or flying into space.
  function setLimits(m) {
    if (m === 'section') {                             // panels fly the camera close: relax the limits (controls are off here)
      controls.minDistance = 0.5; controls.maxDistance = 400;
      controls.minPolarAngle = 0; controls.maxPolarAngle = Math.PI;
    } else {
      controls.minDistance = 13 * CAMERA_SCALE; controls.maxDistance = 40 * S;
      controls.minPolarAngle = 0.3; controls.maxPolarAngle = 1.5;   // never below the island's horizon
    }
  }
  setLimits('home');

  /* "View shift" slides the whole picture sideways or up, so the island stays visible
     beside a panel. It also adds a tiny pointer-based parallax. */
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
  const animators = [];                                // decorative motion, skipped when the visitor prefers reduced motion
  const always = [];                                   // state changes that must always run (hover feedback)
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
  // A triangular prism (roof shape), lying along the z axis.
  const prism = (p, r, len, x, y, z, color, hScale = 1) => { const m = put(p, geo(`prism${r},${len}`, () => new THREE.CylinderGeometry(r, r, len, 3)), mat(color), x, y, z); m.rotation.x = -Math.PI / 2; m.scale.z = hScale; return m; };

  function canvasTexture(draw, s = 128) {
    const c = document.createElement('canvas'); c.width = c.height = s;
    draw(c.getContext('2d'), s);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
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
  await stage(0.04, 'Painting the sky', () => {
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
    const sky = new THREE.Mesh(new THREE.SphereGeometry(520, 24, 16), skyMat);
    sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);

    scene.add(new THREE.HemisphereLight(0xcfe6ff, 0xa58bd6, 1.25));    // sky colour from above, purple bounce from below

    sunLight = new THREE.DirectionalLight(0xfff0d0, 2.4);
    sunLight.position.set(14, 22, 11);
    if (!simple) {
      sunLight.castShadow = true;
      const ms = small ? 1536 : 3072;
      sunLight.shadow.mapSize.set(ms, ms);
      const c = sunLight.shadow.camera;
      const e = 18 * S + 2;
      c.left = -e; c.right = e; c.top = e; c.bottom = -e; c.near = 1; c.far = 100;
      sunLight.shadow.bias = -0.0004; sunLight.shadow.normalBias = 0.05;
      sunLight.shadow.radius = 2.5;
    }
    scene.add(sunLight);

    const fill = new THREE.DirectionalLight(0x9f8cff, 0.6);           // cool purple fill from the opposite side
    fill.position.set(-8, 6, -10); scene.add(fill);

    const sunDir = new THREE.Vector3(10, 16, 8).normalize().multiplyScalar(480);
    glow(scene, 0xfff2c8, 110, 0.7, sunDir.x, sunDir.y, sunDir.z);
  });

  /* ---------------------------------------------------------------- */
  /* 3. terrain: island, hills, road                                   */
  /* ---------------------------------------------------------------- */
  const R = 14;                                       // island radius (before WORLD_SCALE)
  // Hills: [x, z, height, radius]. Edit these to move the mountains.
  const BUMPS = [[-8, -8.5, 6.0, 6.5], [-1.5, -10, 8.6, 7.5], [6, -8.8, 6.5, 6.5], [11.5, -5.5, 4.5, 5.5], [-12.5, -5.5, 4.2, 5.2]];
  // Flat building areas: [x, z, radius, height]. Everything that sits on the ground has one.
  const ZONES = [
    { x: -6.2, z: 6.8, r: 2.2, y: 0 },    // camper van
    { x: -3.6, z: 8.0, r: 2.0, y: 0 },    // campfire
    { x: -8.8, z: 8.0, r: 1.6, y: 0 },    // tent
    { x: -0.5, z: -3.2, r: 2.0, y: 0 },   // Nexora tower
    { x: 9.8, z: 0.2, r: 3.2, y: 0 },     // farm
    { x: 2.0, z: 9.5, r: 1.5, y: 0 },     // skills signpost
    { x: 10.8, z: 6.6, r: 1.3, y: 0 },    // mailbox
    { x: -9.6, z: -1.2, r: 2.0, y: 0 },   // school
    { x: -5.6, z: 0.3, r: 2.0, y: -0.18 }, // pond
  ];
  const roadPts = [[-13.4, 3.0], [-10, 5.5], [-6, 4.2], [-2.5, 5.8], [1.5, 4.5], [4.5, 2.5], [7.5, 4.0], [8.6, 7.4], [7.8, 10.2], [6.6, 12.0]];
  const roadCurve = new THREE.CatmullRomCurve3(roadPts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const roadSamples = roadCurve.getSpacedPoints(140);
  function roadDist(x, z) {
    let m = 1e9;
    for (const p of roadSamples) { const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z); if (d < m) m = d; }
    return Math.sqrt(m);
  }

  // Height of the ground at any (x, z). Used to build the island AND to place objects on it.
  function terrainH(x, z) {
    const r = Math.hypot(x, z);
    let h = 0;
    for (const b of BUMPS) { const d = Math.hypot(x - b[0], z - b[1]); if (d < b[3]) h += b[2] * Math.pow(1 - d / b[3], 1.6); }
    if (h > 0.3) h += (vnoise(x * 0.9, z * 0.9) - 0.5) * 0.55 * Math.min(1, h / 3);
    h *= 1 - smoothstep(10.5, 13.8, r);
    h += (vnoise(x * 0.35 + 10, z * 0.35) - 0.5) * 0.35 * (1 - Math.min(1, h / 1.2));
    h = lerp(h, 0, 1 - smoothstep(2.2, 4.4, roadDist(x, z)));
    for (const zn of ZONES) { const d = Math.hypot(x - zn.x, z - zn.z); h = lerp(h, zn.y, 1 - smoothstep(zn.r, zn.r * 1.8, d)); }
    return lerp(h, 0, smoothstep(13.2, 14, r));
  }
  function isClear(x, z, margin) {
    for (const zn of ZONES) if (Math.hypot(x - zn.x, z - zn.z) < zn.r + margin) return false;
    return roadDist(x, z) > 1.5 + margin;
  }

  const STOPS = [[0, '#7bd88f'], [0.7, '#62c4a0'], [1.5, '#7d74d8'], [3, '#6a55c8'], [4.8, '#4b3fa6'], [6.2, '#7c6be0'], [7.6, '#c9bfff'], [9.5, '#f0ecff']]
    .map(([h, c]) => [h, new THREE.Color(c)]);
  function terrainColor(h, rnd, out) {                // green meadow -> violet -> indigo -> pale peaks
    let i = 0;
    while (i < STOPS.length - 2 && h > STOPS[i + 1][0]) i++;
    const [h0, c0] = STOPS[i], [h1, c1] = STOPS[i + 1];
    out.copy(c0).lerp(c1, clamp((h - h0) / (h1 - h0), 0, 1));
    out.offsetHSL(0, 0, (Math.floor(h / 0.9) % 2 ? 0.035 : 0) + (rnd - 0.5) * 0.07);   // faint layers + faceted variation
    return out;
  }

  let terrain;
  await stage(0.12, 'Raising the island', () => {
    const RINGS = simple ? 18 : 30, SEG = simple ? 44 : 72;
    const grid = [];
    for (let i = 0; i <= RINGS; i++) {
      const row = [], r = (R * i) / RINGS;
      for (let j = 0; j < SEG; j++) {
        const a = (TAU * j) / SEG;
        let x = r * Math.cos(a), z = r * Math.sin(a);
        if (i > 0 && i < RINGS) {                      // wobble inner points a little so triangles look hand-made
          const ox = x, oz = z, jit = (R / RINGS) * 0.28;
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
    g.computeVertexNormals();                          // not indexed, so every triangle gets its own flat normal
    terrain = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    terrain.castShadow = true; terrain.receiveShadow = true;
    W.add(terrain);

    // Soil band and the jagged purple rock underneath.
    const soil = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.94, 1.3, SEG, 1, true), mat('#b9825f'));
    soil.position.y = -0.65; soil.receiveShadow = true; W.add(soil);

    // a thin grassy lip so the island edge looks finished
    const lip = new THREE.Mesh(new THREE.TorusGeometry(R - 0.02, 0.08, 6, SEG), mat('#6fd08a'));
    lip.rotation.x = Math.PI / 2; lip.position.y = 0.01; W.add(lip);

    const rockGeo = new THREE.ConeGeometry(R * 0.94, 11, simple ? 18 : 28, 5, true);
    const rp = rockGeo.attributes.position, top = 5.5;
    for (let i = 0; i < rp.count; i++) {
      const x = rp.getX(i), y = rp.getY(i), z = rp.getZ(i);
      const amp = clamp((y + top) / 3, 0, 1);       // 0 at the rim (matches the soil band), 1 toward the tip
      rp.setXYZ(i, x + (hash3(x, y, z) - 0.5) * amp * 1.6, y + (hash3(x, y + 1, z) - 0.5) * amp, z + (hash3(x, y, z + 1) - 0.5) * amp * 1.6);
    }
    const rock = new THREE.Mesh(rockGeo, mat('#5a4aa8'));
    rock.rotation.x = Math.PI; rock.position.y = -1.3 - 5.5; rock.castShadow = true; W.add(rock);
  });

  await stage(0.24, 'Paving the road', () => {
    const N = 150;
    const pts = roadCurve.getSpacedPoints(N);
    const side = pts.map((p, i) => {                  // sideways direction at each point
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N, i + 1)];
      const t = new THREE.Vector3().subVectors(b, a).setY(0).normalize();
      return new THREE.Vector3(-t.z, 0, t.x);
    });
    function ribbon(o1, o2, y, color, offset) {
      const verts = [];
      const lim = (p, s, o) => [p.x + s.x * o, y, p.z + s.z * o];
      for (let i = 0; i < N; i++) {
        const L0 = lim(pts[i], side[i], o1), R0 = lim(pts[i], side[i], o2), L1 = lim(pts[i + 1], side[i + 1], o1), R1 = lim(pts[i + 1], side[i + 1], o2);
        if (Math.hypot(pts[i].x, pts[i].z) > 13.7) continue;            // stop before the island's edge
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

    // Dashed centre line, drawn with one instanced mesh.
    const dashes = 34, im = new THREE.InstancedMesh(geo('box', () => new THREE.BoxGeometry(1, 1, 1)), new THREE.MeshLambertMaterial({ color: '#fff1dc' }), dashes);
    const d = new THREE.Object3D();
    for (let i = 0; i < dashes; i++) {
      const u = 0.02 + (i / dashes) * 0.96, p = roadCurve.getPointAt(u), t = roadCurve.getTangentAt(u);
      if (Math.hypot(p.x, p.z) > 13.2) { d.scale.set(0, 0, 0); } else { d.scale.set(0.42, 0.012, 0.07); }
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

  await stage(0.34, 'Planting pine trees', () => {
    const parts = [];
    parts.push(paintGeo(new THREE.CylinderGeometry(0.07, 0.1, 0.5, 5).translate(0, 0.25, 0), '#8a5a44'));
    parts.push(paintGeo(new THREE.ConeGeometry(0.5, 0.8, 7).translate(0, 0.75, 0), '#2f9e78'));
    parts.push(paintGeo(new THREE.ConeGeometry(0.39, 0.7, 7).translate(0, 1.2, 0), '#38ae84'));
    parts.push(paintGeo(new THREE.ConeGeometry(0.26, 0.6, 7).translate(0, 1.6, 0), '#46c28f'));
    const treeGeo = mergeGeometries(parts);

    const target = simple ? 55 : small ? 95 : 150;
    for (let tries = 0; tries < 3000 && treeData.length < target; tries++) {
      const rr = Math.sqrt(rng()) * 12.4, a = rng() * TAU, x = rr * Math.cos(a), z = rr * Math.sin(a);
      if (vnoise(x * 0.28 + 3, z * 0.28) < 0.38 && rng() < 0.85) continue;          // trees grow in clusters
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
    animators.push((dt, time) => {                    // trees sway gently (every other frame to save work)
      if ((swayFrame++ & 1) || small) return;
      treeData.forEach((t, i) => { place(t, time); trees.setMatrixAt(i, dummy.matrix); });
      trees.instanceMatrix.needsUpdate = true;
    });
  });

  await stage(0.4, 'Blooming blossom trees and bushes', () => {
    // Round blossom trees: a trunk with a cluster of coloured leaf blobs.
    const parts = [paintGeo(new THREE.CylinderGeometry(0.06, 0.1, 0.7, 6).translate(0, 0.35, 0), '#8a5a44')];
    [[0, 1.0, 0, 0.5], [0.3, 0.85, 0.12, 0.34], [-0.28, 0.9, -0.1, 0.36], [0.05, 1.32, 0.05, 0.34]].forEach(([x, y, z, r]) => {
      parts.push(paintGeo(new THREE.IcosahedronGeometry(r, 1).translate(x, y, z), '#ffffff'));
    });
    const bGeo = mergeGeometries(parts);
    // The trunk keeps its brown; the canopy is tinted per tree through instance colours (white = pink below).
    const blossoms = [];
    const want = simple ? 6 : 18;
    for (let tries = 0; tries < 1500 && blossoms.length < want; tries++) {
      const rr = Math.sqrt(rng()) * 12, a = rng() * TAU, x = rr * Math.cos(a), z = rr * Math.sin(a), h = terrainH(x, z);
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

    // Bushes
    const bushes = [];
    for (let tries = 0; tries < 1200 && bushes.length < (simple ? 18 : 55); tries++) {
      const rr = Math.sqrt(rng()) * 12.6, a = rng() * TAU, x = rr * Math.cos(a), z = rr * Math.sin(a), h = terrainH(x, z);
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

  await stage(0.47, 'Scattering rocks and flowers', () => {
    const rocks = [];
    for (let tries = 0; tries < 800 && rocks.length < (simple ? 12 : 30); tries++) {
      const rr = Math.sqrt(rng()) * 12.6, a = rng() * TAU, x = rr * Math.cos(a), z = rr * Math.sin(a), h = terrainH(x, z);
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

    // Flowers: a tiny green stem plus a coloured head, in many colours.
    const flowers = [];
    for (let tries = 0; tries < 1200 && flowers.length < (simple ? 40 : 130); tries++) {
      const rr = Math.sqrt(rng()) * 12.4, a = rng() * TAU, x = rr * Math.cos(a), z = rr * Math.sin(a), h = terrainH(x, z);
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

    // Pond
    const pond = new THREE.Group(); pond.position.set(-5.6, 0, 0.3); W.add(pond);
    const bank = cyl(pond, 2.1, 2.2, 0.06, 20, 0, -0.11, 0, '#c9b28a'); bank.castShadow = false;          // sandy rim
    const water = cyl(pond, 1.9, 1.9, 0.04, 20, 0, -0.07, 0, '#5fd0e8', { emissive: '#1f7f9a', emissiveIntensity: 0.35 });
    water.castShadow = false;
    for (let i = 0; i < 9; i++) {                      // reeds and lily pads around the edge
      const a = rng() * TAU, r = 1.85 + rng() * 0.3;
      if (i < 5) cone(pond, 0.05, 0.6 + rng() * 0.3, 4, Math.cos(a) * r, 0.2, Math.sin(a) * r, '#3f9e6a');
      else {
        const lp = cyl(pond, 0.22, 0.22, 0.02, 8, Math.cos(a) * (r - 0.9), -0.04, Math.sin(a) * (r - 0.9), '#4fae7a'); lp.castShadow = false;
        ball(pond, 0.05, Math.cos(a) * (r - 0.9), -0.01, Math.sin(a) * (r - 0.9), '#ffb3c7').castShadow = false;   // lotus bud
      }
    }
    // rippling water rings
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
  /* people (built first so the landmarks can place them)              */
  /* ----------------------------------------------------------------
     makePerson() builds a small, friendly, realistic-proportion person
     that faces +x. Options:
       skin, shirt, pants, hair, shoes, hairStyle ('short' | 'long' | 'pony' | 'none'),
       hat ('straw' | 'beanie'), hatColor, backpack (colour), shorts (true/false)
     It returns the group plus the moving parts:
       upper (torso+head), head, armL, armR, elbowL, elbowR, legL, legR, shinL, shinR  */
  function makePerson(o = {}) {
    const skin = o.skin || '#f2c7a5', shirt = o.shirt || '#ff6b5e', pants = o.pants || '#2b2850';
    const hairC = o.hair || '#241f4d', shoeC = o.shoes || '#fff8ec', HIP = 0.4;
    const soft = (c, x) => mat(c, { flatShading: false, ...x });
    const sphere = (p, r, x, y, z, color, shadow = true) => put(p, geo(`sball${r}`, () => new THREE.SphereGeometry(r, 16, 12)), soft(color), x, y, z, shadow);
    const smallPart = (p, g, m, x = 0, y = 0, z = 0) => { const me = new THREE.Mesh(g, m); me.position.set(x, y, z); parent_add(p, me); return me; };
    const parent_add = (p, me) => { me.castShadow = false; me.receiveShadow = false; p.add(me); };

    const g = new THREE.Group();
    const upper = new THREE.Group(); upper.position.y = HIP; g.add(upper);

    /* --- torso: tapered body, shoulders, belt, neck --- */
    const torso = cyl(upper, 0.12, 0.105, 0.38, 14, 0, 0.19, 0, shirt, { flatShading: false }); torso.scale.set(0.8, 1, 1.3);
    const sh = put(upper, geo('shoulder', () => new THREE.SphereGeometry(0.1, 14, 10)), soft(shirt), 0, 0.345, 0); sh.scale.set(0.82, 0.55, 1.75);
    const belt = cyl(upper, 0.108, 0.108, 0.045, 14, 0, 0.03, 0, o.belt || '#3a2f5b', { flatShading: false }); belt.scale.set(0.8, 1, 1.3); belt.castShadow = false;
    box(upper, 0.03, 0.04, 0.05, 0.088, 0.03, 0, '#e8b23a').castShadow = false;       // belt buckle
    cyl(upper, 0.042, 0.048, 0.08, 10, 0, 0.41, 0, skin, { flatShading: false });      // neck

    /* --- head --- */
    const head = new THREE.Group(); head.position.set(0.01, 0.56, 0); upper.add(head);
    const skull = sphere(head, 0.135, 0, 0, 0, skin); skull.scale.set(0.95, 1.08, 0.92);
    sphere(head, 0.03, 0, -0.01, 0.126, skin, false).scale.set(0.5, 1, 0.8);            // ears
    sphere(head, 0.03, 0, -0.01, -0.126, skin, false).scale.set(0.5, 1, 0.8);
    [0.05, -0.05].forEach((z) => {
      const white = smallPart(head, geo('eyeW', () => new THREE.SphereGeometry(0.026, 12, 8)), soft('#ffffff'), 0.109, 0.014, z); white.scale.set(0.7, 1, 0.95);
      smallPart(head, geo('eyeP', () => new THREE.SphereGeometry(0.0145, 10, 8)), soft('#241f4d'), 0.124, 0.012, z);
      smallPart(head, geo('eyeS', () => new THREE.SphereGeometry(0.005, 6, 5)), soft('#ffffff'), 0.134, 0.02, z + 0.004);   // eye sparkle
      const brow = smallPart(head, geo('brow', () => new THREE.BoxGeometry(0.012, 0.011, 0.05)), soft(hairC), 0.108, 0.058, z); brow.rotation.x = z > 0 ? 0.12 : -0.12;
      smallPart(head, geo('cheek', () => new THREE.SphereGeometry(0.02, 8, 6)), soft('#f7a090'), 0.1, -0.03, z * 1.55).scale.set(0.5, 0.7, 1);
    });
    const nose = smallPart(head, geo('nose', () => new THREE.SphereGeometry(0.02, 10, 8)), soft(skin), 0.126, -0.012, 0); nose.scale.set(0.9, 1.1, 0.85);
    const smileHolder = new THREE.Group(); smileHolder.position.set(0.115, -0.047, 0); smileHolder.rotation.y = Math.PI / 2; head.add(smileHolder);
    const smile = smallPart(smileHolder, geo('smile', () => new THREE.TorusGeometry(0.028, 0.0065, 6, 12, Math.PI)), soft('#a8453f'));
    smile.rotation.z = Math.PI;

    /* --- hair --- */
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
      cyl(head, 0.138, 0.138, 0.03, 16, 0, 0.125, 0, o.hatColor || '#e8564a', { flatShading: false }).castShadow = false;   // hat band
      brim.rotation.z = 0.05; crown.castShadow = true;
    }
    if (o.hat === 'beanie') {
      const dome = put(head, geo('beanie', () => new THREE.SphereGeometry(0.152, 16, 10, 0, TAU, 0, Math.PI * 0.55)), soft(o.hatColor || '#ff6b5e'), -0.005, 0.015, 0, true);
      dome.scale.set(1, 1.05, 1); dome.rotation.z = 0.15;
      cyl(head, 0.152, 0.152, 0.05, 16, 0, 0.045, 0, '#fff1dc', { flatShading: false });
      sphere(head, 0.045, -0.01, 0.17, 0, '#fff1dc');
    }

    /* --- arms: shoulder, sleeve, elbow, forearm, hand --- */
    function makeArm(zSide) {
      const arm = new THREE.Group(); arm.position.set(0, 0.34, zSide * 0.19); upper.add(arm);
      sphere(arm, 0.052, 0, 0, 0, shirt);
      cyl(arm, 0.047, 0.04, 0.2, 10, 0, -0.1, 0, shirt, { flatShading: false });
      const elbow = new THREE.Group(); elbow.position.y = -0.2; elbow.rotation.z = 0.12; arm.add(elbow);
      cyl(elbow, 0.036, 0.029, 0.17, 10, 0, -0.085, 0, o.longSleeve ? shirt : skin, { flatShading: false });
      sphere(elbow, 0.035, 0, -0.185, 0, skin);                                          // hand
      return { arm, elbow };
    }
    const aL = makeArm(1), aR = makeArm(-1);

    /* --- legs: thigh, knee, shin, shoe --- */
    function makeLeg(zSide) {
      const leg = new THREE.Group(); leg.position.set(0, HIP, zSide * 0.075); g.add(leg);
      cyl(leg, 0.062, 0.049, 0.2, 10, 0, -0.1, 0, pants, { flatShading: false });
      const shin = new THREE.Group(); shin.position.y = -0.2; leg.add(shin);
      cyl(shin, 0.049, 0.037, 0.19, 10, 0, -0.095, 0, o.shorts ? skin : pants, { flatShading: false });
      sphere(shin, 0.05, 0, 0, 0, o.shorts ? skin : pants, false);                      // knee
      const shoe = box(shin, 0.17, 0.065, 0.09, 0.035, -0.172, 0, shoeC);
      box(shin, 0.175, 0.02, 0.095, 0.035, -0.2, 0, '#2b2850').castShadow = false;       // sole
      return { leg, shin };
    }
    const lL = makeLeg(1), lR = makeLeg(-1);

    if (o.backpack) {
      box(upper, 0.13, 0.28, 0.22, -0.17, 0.2, 0, o.backpack);
      box(upper, 0.11, 0.1, 0.19, -0.2, 0.32, 0, o.backpack);
      [0.1, -0.1].forEach((z) => box(upper, 0.02, 0.26, 0.035, 0.1, 0.2, z, '#2b2850').castShadow = false);   // straps
    }
    return { group: g, upper, head, armL: aL.arm, armR: aR.arm, elbowL: aL.elbow, elbowR: aR.elbow, legL: lL.leg, legR: lR.leg, shinL: lL.shin, shinR: lR.shin };
  }
  const faceDir = (obj, dx, dz) => { obj.rotation.y = -Math.atan2(dz, dx); };   // models face +x

  /* ---------------------------------------------------------------- */
  /* 5. landmarks                                                      */
  /* ---------------------------------------------------------------- */
  const van = { group: new THREE.Group(), body: new THREE.Group() };

  await stage(0.56, 'Parking the camper van', () => {
    // --- camp: van, tent, fire, me ---
    van.group.position.set(-6.2, 0, 6.8); van.group.rotation.y = -0.25; W.add(van.group);
    const g = van.body; van.group.add(g);
    const CORAL = '#ff6b5e', CREAM = '#fff1dc', GLASS = '#bfe4ff', DARK = '#2b2850';
    box(g, 2.3, 0.12, 0.95, 0, 0.34, 0, DARK);                           // chassis
    box(g, 1.9, 1.15, 1.0, -0.2, 0.98, 0, CORAL);                        // main body
    box(g, 0.5, 0.55, 1.0, 0.95, 0.68, 0, CORAL);                        // bonnet
    box(g, 1.92, 0.16, 1.02, -0.2, 0.78, 0, CREAM);                      // cream stripe
    box(g, 1.5, 0.28, 0.9, -0.3, 1.7, 0, CREAM);                         // pop-top roof
    const ws = box(g, 0.05, 0.5, 0.82, 0.8, 1.3, 0, GLASS); ws.rotation.z = -0.35;   // windscreen
    box(g, 0.42, 0.34, 1.03, 0.3, 1.25, 0, GLASS); box(g, 0.5, 0.34, 1.03, -0.5, 1.25, 0, GLASS);   // side windows
    box(g, 0.06, 0.14, 0.2, 1.21, 0.78, 0.3, '#ffe08a', { emissive: '#ffcf55', emissiveIntensity: 0.6 });
    box(g, 0.06, 0.14, 0.2, 1.21, 0.78, -0.3, '#ffe08a', { emissive: '#ffcf55', emissiveIntensity: 0.6 });
    box(g, 0.08, 0.1, 1.0, 1.2, 0.5, 0, CREAM);                          // bumper
    box(g, 0.05, 0.12, 0.16, -1.16, 0.85, 0.35, '#e8564a'); box(g, 0.05, 0.12, 0.16, -1.16, 0.85, -0.35, '#e8564a');
    const rack = box(g, 1.3, 0.04, 0.7, -0.3, 1.88, 0, DARK);            // roof rack with a surfboard and a bag
    const board = box(g, 1.5, 0.05, 0.26, -0.3, 1.95, 0.12, '#5ac8c8'); board.rotation.y = 0.05; rack.castShadow = false;
    box(g, 0.4, 0.2, 0.3, -0.6, 2.0, -0.18, '#e8b23a');
    const wheels = [];
    [[-0.7, 0.52], [-0.7, -0.52], [0.75, 0.52], [0.75, -0.52]].forEach(([x, z]) => {
      const w = cyl(g, 0.3, 0.3, 0.22, 12, x, 0.3, z, DARK); w.rotation.x = Math.PI / 2;
      const hub = cyl(g, 0.14, 0.14, 0.24, 8, x, 0.3, z, CREAM); hub.rotation.x = Math.PI / 2; hub.castShadow = false;
      wheels.push(w);
    });
    animators.push((dt, t) => {                       // the van idles with a tiny suspension bounce
      g.position.y = Math.sin(t * 2.2) * 0.012;
      g.rotation.z = Math.sin(t * 1.1) * 0.004;
    });

    // tent
    const tent = new THREE.Group(); tent.position.set(-8.8, 0, 8.0); tent.rotation.y = 0.5; W.add(tent);
    const tc = cone(tent, 1.05, 1.15, 4, 0, 0.58, 0, '#5ac8c8'); tc.rotation.y = Math.PI / 4;
    box(tent, 0.01, 0.6, 0.45, 0.72, 0.32, 0, '#2b2850').rotation.y = 0;
    box(tent, 0.2, 0.2, 0.2, -1.4, 0.1, 0.6, '#e8b23a');

    // campfire
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
    // little log seats around the fire
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

    // me: waving beside the fire
    const me = makePerson({ shirt: '#ff6b5e', pants: '#2b2850', hair: '#241f4d', backpack: '#e8b23a', skin: '#e9b48d', hairStyle: 'short', shoes: '#fff8ec' });
    me.group.position.set(-4.5, 0, 7.4); me.group.rotation.y = -Math.PI / 3; W.add(me.group);
    me.armR.rotation.z = 0.05;
    animators.push((dt, t) => {
      me.armL.rotation.x = -(2.3 + Math.sin(t * 2) * 0.12);        // waving arm raised
      me.elbowL.rotation.x = Math.sin(t * 8) * 0.55;               // hand waves side to side
      me.upper.rotation.z = Math.sin(t * 1.6) * 0.02;
      me.head.rotation.y = Math.sin(t * 0.9) * 0.25;
      me.head.rotation.z = Math.sin(t * 1.3) * 0.04;
      me.group.position.y = Math.abs(Math.sin(t * 3.2)) * 0.012;
    });
  });

  await stage(0.64, 'Building the Nexora tower', () => {
    const g = new THREE.Group(); g.position.set(-0.5, 0, -3.2); W.add(g);
    cyl(g, 2.0, 2.2, 0.2, 10, 0, 0.1, 0, '#d8d2ff');
    cyl(g, 0.55, 0.78, 1.6, 6, 0, 1.0, 0, '#4b3fa6');
    cyl(g, 0.8, 0.8, 0.1, 6, 0, 0.8, 0, '#5ac8c8');
    cyl(g, 0.95, 0.72, 0.28, 6, 0, 1.92, 0, '#6c58cf');
    put(g, geo('dome', () => new THREE.SphereGeometry(0.62, 10, 6, 0, TAU, 0, Math.PI / 2)), mat('#8f7fe6'), 0, 2.05, 0);
    cyl(g, 0.03, 0.03, 1.0, 5, 0, 2.7, 0, '#d8d2ff');
    for (let i = 0; i < 5; i++) {                       // glowing "code window" panels around the tower
      const a = (i / 5) * TAU + 0.3, y = 0.7 + (i % 2) * 0.5;
      const w = box(g, 0.05, 0.24, 0.34, Math.cos(a) * 0.72, y, Math.sin(a) * 0.72, '#9ff3ff', { emissive: '#4fd1e0', emissiveIntensity: 0.8 });
      w.rotation.y = -a; w.castShadow = false;
    }
    box(g, 0.9, 0.05, 0.5, 1.5, 0.45, 0.5, '#2b2850').rotation.z = 0.3;   // solar panel
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

  await stage(0.72, 'Planting the farm', () => {
    const g = new THREE.Group(); g.position.set(9.8, 0, 0.2); W.add(g);
    // three terraced crop beds
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

    // wooden fence in front of the farm
    for (let i = 0; i < 9; i++) box(g, 0.07, 0.42, 0.07, -1.5 + i * 0.5, 0.21, 2.45, '#b9825f');
    box(g, 4.1, 0.05, 0.05, 0.5, 0.33, 2.45, '#c9966f'); box(g, 4.1, 0.05, 0.05, 0.5, 0.16, 2.45, '#c9966f');

    // windmill
    const mill = new THREE.Group(); mill.position.set(-2.6, 0, 0.3); g.add(mill);
    cyl(mill, 0.34, 0.55, 1.7, 8, 0, 0.85, 0, '#fff1dc');
    cone(mill, 0.5, 0.5, 8, 0, 1.95, 0, '#e8564a');
    const blades = new THREE.Group(); blades.position.set(0, 1.6, 0.5); mill.add(blades);
    for (let i = 0; i < 4; i++) { const b = box(blades, 0.14, 1.0, 0.03, 0, 0.5, 0, '#fff8ec'); const pivot = new THREE.Group(); blades.remove(b); pivot.add(b); pivot.rotation.z = (i * Math.PI) / 2; blades.add(pivot); }
    box(blades, 0.14, 0.14, 0.14, 0, 0, 0, '#2b2850');
    animators.push((dt) => { blades.rotation.z -= dt * 0.9; });

    // barn
    const barn = new THREE.Group(); barn.position.set(2.7, 0, -1.9); barn.rotation.y = -0.3; g.add(barn);
    box(barn, 1.3, 0.8, 1.05, 0, 0.4, 0, '#e8564a'); prism(barn, 0.76, 1.1, 0, 1.07, 0, '#8a5a44', 0.7);
    box(barn, 0.36, 0.5, 0.04, 0, 0.25, 0.54, '#fff1dc');

    // farmer
    const farmer = makePerson({ shirt: '#4fae7a', pants: '#6c58cf', hair: '#5a3b2a', hat: 'straw', skin: '#d9a07a', longSleeve: false, shoes: '#8a5a44' });
    farmer.group.position.set(1.7, 0.0, 0.75); faceDir(farmer.group, -1, 0.4); g.add(farmer.group);
    animators.push((dt, t) => {                        // bends down to tend the crops, then straightens up
      const k = (Math.sin(t * 0.9) + 1) / 2;
      farmer.upper.rotation.z = -k * 0.7;
      farmer.armL.rotation.z = k * 0.95; farmer.armR.rotation.z = k * 0.95;
      farmer.head.rotation.z = k * 0.5;                // keeps looking forward while bending
      farmer.legL.rotation.z = k * 0.12; farmer.legR.rotation.z = k * 0.12;
    });
  });

  await stage(0.8, 'Raising the signpost and mailbox', () => {
    // Skills signpost with five arrow boards and orbiting cubes
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

    // Contact mailbox with a paper plane
    const mb = new THREE.Group(); mb.position.set(10.8, 0, 6.6); mb.rotation.y = -0.9; W.add(mb);
    box(mb, 0.12, 1.1, 0.12, 0, 0.55, 0, '#8a5a44');
    box(mb, 0.74, 0.4, 0.46, 0, 1.2, 0, '#ff6b5e'); box(mb, 0.66, 0.1, 0.38, 0, 1.45, 0, '#e8564a');
    box(mb, 0.04, 0.3, 0.04, 0.2, 0, 0, '#e8b23a');
    const flag = new THREE.Group(); flag.position.set(0.2, 1.2, 0.26); mb.add(flag); box(flag, 0.05, 0.32, 0.05, 0, 0.16, 0, '#e8b23a'); box(flag, 0.2, 0.12, 0.04, 0.1, 0.3, 0, '#e8b23a');
    const planeG = new THREE.Group(); W.add(planeG);
    const plane = new THREE.Mesh(geo('plane', () => new THREE.ConeGeometry(0.14, 0.55, 3)), new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true, emissive: '#cfe6ff', emissiveIntensity: 0.3 }));
    plane.castShadow = true; plane.rotation.z = -Math.PI / 2; plane.scale.set(1, 1, 0.35); planeG.add(plane);   // cone tip points forward (+x)
    animators.push((dt, t) => {
      flag.rotation.x = -0.4 + Math.sin(t * 2) * 0.25;
      const a = t * 0.7;
      planeG.position.set(10.8 + Math.cos(a) * 1.2, 2.2 + Math.sin(t * 1.6) * 0.15, 6.6 + Math.sin(a) * 1.2);
      planeG.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a));       // face the direction of travel
    });

    // Education: the little school
    const s = new THREE.Group(); s.position.set(-9.6, 0, -1.2); s.rotation.y = 0.5; W.add(s);
    box(s, 1.9, 0.95, 1.25, 0, 0.48, 0, '#fff1dc'); prism(s, 1.1, 1.3, 0, 1.25, 0, '#ff6b5e', 0.55);
    box(s, 0.34, 0.55, 0.04, 0, 0.28, 0.64, '#6c58cf');
    [-0.6, 0.6].forEach((x) => box(s, 0.32, 0.3, 0.04, x, 0.6, 0.64, '#bfe4ff'));
    box(s, 0.4, 0.4, 0.4, 0, 1.85, 0, '#fff1dc'); cone(s, 0.34, 0.35, 4, 0, 2.25, 0, '#6c58cf').rotation.y = Math.PI / 4;
    cyl(s, 0.03, 0.03, 1.6, 5, 1.4, 0.8, 0.7, '#d8d2ff');
    const sflag = box(s, 0.5, 0.28, 0.03, 1.65, 1.5, 0.7, '#ff6b5e');
    animators.push((dt, t) => { sflag.rotation.y = Math.sin(t * 3) * 0.25; });

    // Lamp posts along the road: warm glowing bulbs
    const bulbs = [];
    [0.1, 0.24, 0.38, 0.52, 0.66, 0.8, 0.93].forEach((u, i) => {
      const p = roadCurve.getPointAt(u), tg = roadCurve.getTangentAt(u), side = i % 2 ? 1.5 : -1.5;
      const x = p.x + tg.z * side, z = p.z - tg.x * side;
      if (Math.hypot(x, z) > 12.5) return;
      const lamp = new THREE.Group(); lamp.position.set(x, terrainH(x, z), z); W.add(lamp);
      cyl(lamp, 0.03, 0.045, 1.05, 6, 0, 0.52, 0, '#2b2850');
      box(lamp, 0.22, 0.04, 0.04, 0.08, 1.04, 0, '#2b2850');
      const bulb = ball(lamp, 0.09, 0.16, 0.98, 0, '#fff3b0', { emissive: '#ffd36e', emissiveIntensity: 1 }); bulb.castShadow = false;
      bulbs.push(glow(lamp, 0xffd36e, 1.1, 0.45, 0.16, 0.98, 0));
    });
    animators.push((dt, t) => bulbs.forEach((b, i) => { b.material.opacity = 0.4 + Math.sin(t * 2 + i) * 0.08; }));
  });

  /* ---------------------------------------------------------------- */
  /* 6. people on the move: hiker, cyclist, fisher, student            */
  /* ---------------------------------------------------------------- */
  await stage(0.86, 'Waking up the villagers', () => {
    const hiker = makePerson({ shirt: '#8f7fe6', pants: '#3a3568', hair: '#7a4a32', backpack: '#ff6b5e', skin: '#f6d2b4', hairStyle: 'pony', hat: undefined, shoes: '#8a5a44' });
    W.add(hiker.group);
    const walker = { u: 0.62, dir: 1, heading: 0 };
    const pt = new THREE.Vector3(), tg = new THREE.Vector3();
    animators.push((dt, t) => {
      walker.u += walker.dir * dt * 0.012;
      if (walker.u > 0.88) { walker.u = 0.88; walker.dir = -1; } else if (walker.u < 0.5) { walker.u = 0.5; walker.dir = 1; }
      roadCurve.getPointAt(walker.u, pt); roadCurve.getTangentAt(walker.u, tg);
      const target = -Math.atan2(tg.z * walker.dir, tg.x * walker.dir);
      let dA = target - walker.heading; dA = Math.atan2(Math.sin(dA), Math.cos(dA));
      walker.heading += dA * Math.min(1, dt * 4);
      hiker.group.position.set(pt.x + tg.z * 0.35, 0.05 + Math.abs(Math.sin(t * 6)) * 0.02, pt.z - tg.x * 0.35);
      hiker.group.rotation.y = walker.heading;
      const sw = Math.sin(t * 6) * 0.6;
      hiker.legL.rotation.z = sw; hiker.legR.rotation.z = -sw; hiker.armL.rotation.z = -sw * 0.8; hiker.armR.rotation.z = sw * 0.8;
      hiker.shinL.rotation.z = -(0.5 + 0.5 * Math.sin(t * 6 + 1.6)) * 0.55;       // knees bend while walking
      hiker.shinR.rotation.z = -(0.5 + 0.5 * Math.sin(t * 6 + 1.6 + Math.PI)) * 0.55;
      hiker.elbowL.rotation.z = 0.35 + Math.max(0, sw) * 0.3; hiker.elbowR.rotation.z = 0.35 + Math.max(0, -sw) * 0.3;
      hiker.upper.rotation.z = -0.06;
      hiker.head.rotation.y = Math.sin(t * 0.8) * 0.2;
    });

    // cyclist
    const bike = new THREE.Group(); W.add(bike);
    const wheelGeo = geo('wheel', () => new THREE.TorusGeometry(0.28, 0.035, 6, 16)), wm = mat('#2b2850');
    const wf = put(bike, wheelGeo, wm, 0.42, 0.3, 0), wr = put(bike, wheelGeo, wm, -0.42, 0.3, 0);
    box(bike, 0.75, 0.04, 0.04, 0, 0.5, 0, '#ff6b5e'); box(bike, 0.04, 0.4, 0.04, -0.18, 0.4, 0, '#ff6b5e');
    box(bike, 0.04, 0.45, 0.04, 0.4, 0.45, 0, '#ff6b5e').rotation.z = -0.25;
    box(bike, 0.04, 0.04, 0.34, 0.43, 0.7, 0, '#2b2850'); box(bike, 0.2, 0.05, 0.12, -0.2, 0.62, 0, '#2b2850');
    const rider = makePerson({ shirt: '#4fae7a', pants: '#2b2850', hair: '#e8b23a', skin: '#c98e68', hairStyle: 'long', shorts: false, shoes: '#ff6b5e' });
    rider.group.position.set(-0.18, 0.25, 0); rider.group.scale.setScalar(0.92); bike.add(rider.group);
    rider.upper.rotation.z = -0.3; rider.armL.rotation.z = 1.0; rider.armR.rotation.z = 1.0;
    rider.elbowL.rotation.z = 0.1; rider.elbowR.rotation.z = 0.1;
    const ride = { u: 0.1, dir: 1, heading: 0 };
    animators.push((dt, t) => {
      ride.u += ride.dir * dt * 0.016;
      if (ride.u > 0.93) { ride.u = 0.93; ride.dir = -1; } else if (ride.u < 0.07) { ride.u = 0.07; ride.dir = 1; }
      roadCurve.getPointAt(ride.u, pt); roadCurve.getTangentAt(ride.u, tg);
      const target = -Math.atan2(tg.z * ride.dir, tg.x * ride.dir);
      let dA = target - ride.heading; dA = Math.atan2(Math.sin(dA), Math.cos(dA));
      ride.heading += dA * Math.min(1, dt * 3);
      bike.position.set(pt.x - tg.z * 0.3, 0.05, pt.z + tg.x * 0.3);
      bike.rotation.y = ride.heading;
      bike.rotation.x = Math.sin(t * 2) * 0.01;
      wf.rotation.z -= dt * 6; wr.rotation.z -= dt * 6;
      const pedal = t * 6;
      rider.legL.rotation.z = 0.5 + Math.sin(pedal) * 0.6; rider.legR.rotation.z = 0.5 + Math.sin(pedal + Math.PI) * 0.6;
      rider.shinL.rotation.z = -(0.5 + 0.5 * Math.sin(pedal)) * 1.0;                     // knees pump as she pedals
      rider.shinR.rotation.z = -(0.5 + 0.5 * Math.sin(pedal + Math.PI)) * 1.0;
      rider.head.rotation.y = Math.sin(t * 0.7) * 0.15;
    });

    // fisher at the pond
    const fx = -3.35, fz = 0.5;
    const fisher = makePerson({ shirt: '#4fd1e0', pants: '#6a5a45', hair: '#2b2850', hat: 'straw', hatColor: '#4b3fa6', skin: '#e0a98a', longSleeve: true, shoes: '#8a5a44' });
    fisher.group.position.set(fx, terrainH(fx, fz), fz); faceDir(fisher.group, -1, -0.05); W.add(fisher.group);
    fisher.armL.rotation.z = 1.15; fisher.armR.rotation.z = 0.95;
    fisher.elbowL.rotation.z = 0.3; fisher.elbowR.rotation.z = 0.3;
    const rod = cyl(fisher.group, 0.012, 0.02, 1.6, 6, 0.65, 0.95, 0.05, '#8a5a44'); rod.rotation.z = -1.0; rod.castShadow = false;
    const lineLen = 0.95;
    const line = cyl(fisher.group, 0.004, 0.004, lineLen, 4, 1.38, 1.58 - lineLen / 2 - 0.02, 0.05, '#ffffff'); line.castShadow = false;
    const bobber = ball(fisher.group, 0.035, 1.38, 0.62, 0.05, '#ff6b5e'); bobber.castShadow = false;
    animators.push((dt, t) => {
      fisher.upper.rotation.z = Math.sin(t * 0.8) * 0.02 - 0.03;
      fisher.head.rotation.y = Math.sin(t * 0.5) * 0.12;
      fisher.head.rotation.z = 0.18;
      bobber.position.y = 0.62 + Math.sin(t * 2.2) * 0.012;
      rod.rotation.z = -1.0 + Math.sin(t * 0.7) * 0.02;
    });

    // student waving by the school door
    const sx = -8.3, sz = -2.6;
    const student = makePerson({ shirt: '#ffe08a', pants: '#4b3fa6', hair: '#241f4d', hairStyle: 'pony', backpack: '#5ac8c8', skin: '#e9b48d', shorts: true, shoes: '#ff6b5e' });
    student.group.position.set(sx, terrainH(sx, sz), sz); faceDir(student.group, 0.5, 1); student.group.scale.setScalar(0.9); W.add(student.group);
    animators.push((dt, t) => {
      student.armR.rotation.x = 2.2 + Math.sin(t * 1.8) * 0.12;
      student.elbowR.rotation.x = -Math.sin(t * 8.5) * 0.55;
      student.upper.rotation.z = Math.sin(t * 1.4) * 0.025;
      student.head.rotation.y = Math.sin(t * 0.8) * 0.3;
      student.group.position.y = terrainH(sx, sz) + Math.abs(Math.sin(t * 2.6)) * 0.02;
    });
  });

  /* ---------------------------------------------------------------- */
  /* 7. atmosphere: clouds, floating rocks, sparkles, birds, butterflies */
  /* ---------------------------------------------------------------- */
  let cloudsFar;
  await stage(0.92, 'Drifting clouds in', () => {
    cloudsFar = new THREE.Group(); W.add(cloudsFar);
    const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#a9bce8', emissiveIntensity: 0.35, flatShading: true });
    const count = simple ? 7 : 16;
    for (let i = 0; i < count; i++) {
      const parts = [], blobs = 4 + Math.floor(rng() * 3);
      for (let b = 0; b < blobs; b++) {
        const g = new THREE.IcosahedronGeometry(1, 1);
        const sc = 1.4 + rng() * 1.6;
        g.scale(sc * 1.3, sc * 0.75, sc); g.translate((b - blobs / 2) * 1.8 + rng(), rng() * 0.6, (rng() - 0.5) * 1.6);
        parts.push(g);
      }
      const cloud = new THREE.Mesh(mergeGeometries(parts), cloudMat);
      const low = i % 2 === 0, ang = rng() * TAU, rad = 24 + rng() * 34;
      cloud.position.set(Math.cos(ang) * rad, low ? -13 - rng() * 9 : 7 + rng() * 12, Math.sin(ang) * rad);
      cloud.scale.setScalar(low ? 1.7 + rng() : 1.0 + rng() * 0.8);
      cloud.rotation.y = rng() * TAU; cloud.userData.bob = rng() * TAU;
      cloudsFar.add(cloud);
    }
    // small rocks floating around the island
    const floaters = [];
    for (let i = 0; i < (simple ? 4 : 9); i++) {
      const a = rng() * TAU, r = 15.5 + rng() * 4.5;
      const m = new THREE.Mesh(geo('floatrock', () => new THREE.IcosahedronGeometry(1, 0)), mat(i % 2 ? '#5a4aa8' : '#8a84b8'));
      m.position.set(Math.cos(a) * r, -1.5 - rng() * 7, Math.sin(a) * r); m.scale.setScalar(0.35 + rng() * 0.7); m.castShadow = true;
      m.userData = { base: m.position.y, ph: rng() * TAU, sp: 0.4 + rng() * 0.5 };
      W.add(m); floaters.push(m);
    }
    // sparkles (pollen / fireflies)
    const N = simple ? 50 : small ? 90 : 170, pp = new Float32Array(N * 3), seeds = [];
    for (let i = 0; i < N; i++) {
      const a = rng() * TAU, r = Math.sqrt(rng()) * 15;
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

    // birds circling high above the island
    const birds = [];
    for (let i = 0; i < (simple ? 2 : 5); i++) {
      const b = new THREE.Group();
      const body = put(b, geo('birdbody', () => new THREE.ConeGeometry(0.08, 0.42, 5)), mat(i % 2 ? '#ffffff' : '#fff1dc'), 0, 0, 0, false); body.rotation.z = -Math.PI / 2;
      const wl = new THREE.Group(), wr = new THREE.Group(); b.add(wl, wr);
      put(wl, geo('wing', () => new THREE.BoxGeometry(0.2, 0.015, 0.4)), mat('#ffffff'), 0, 0, 0.2, false);
      put(wr, geo('wing', () => new THREE.BoxGeometry(0.2, 0.015, 0.4)), mat('#ffffff'), 0, 0, -0.2, false);
      W.add(b); birds.push({ b, wl, wr, rad: 9 + i * 1.6, h: 10.5 + (i % 3) * 1.4, sp: 0.18 + i * 0.012, off: i * 1.3 });
    }
    // butterflies fluttering over the meadow
    const flies = [];
    for (let i = 0; i < (simple ? 3 : 9); i++) {
      let cx = 0, cz = 0;
      for (let k = 0; k < 40; k++) {
        const rr = Math.sqrt(rng()) * 11, a = rng() * TAU; cx = rr * Math.cos(a); cz = rr * Math.sin(a);
        if (terrainH(cx, cz) < 0.5) break;
      }
      const f = new THREE.Group(), col = ['#ff9fb8', '#ffe08a', '#7ee8ff', '#c9a7ff'][i % 4];
      const wl = new THREE.Group(), wr = new THREE.Group(); f.add(wl, wr);
      put(wl, geo('bwing', () => new THREE.BoxGeometry(0.1, 0.008, 0.11)), mat(col), 0, 0, 0.055, false);
      put(wr, geo('bwing', () => new THREE.BoxGeometry(0.1, 0.008, 0.11)), mat(col), 0, 0, -0.055, false);
      put(f, geo('bbody', () => new THREE.BoxGeometry(0.1, 0.02, 0.02)), mat('#2b2850'), 0, 0, 0, false);
      W.add(f); flies.push({ f, wl, wr, cx, cz, ph: rng() * TAU, r: 0.8 + rng() * 1.1, sp: 0.4 + rng() * 0.4 });
    }

    animators.push((dt, t) => {
      writeSparkles(t);
      cloudsFar.rotation.y += dt * 0.004;
      cloudsFar.children.forEach((c) => { c.position.y += Math.sin(t * 0.3 + c.userData.bob) * dt * 0.05; });
      floaters.forEach((f) => { f.position.y = f.userData.base + Math.sin(t * f.userData.sp + f.userData.ph) * 0.4; f.rotation.y += dt * 0.2; });
      birds.forEach((o) => {
        const a = t * o.sp + o.off, flap = Math.sin(t * 9 + o.off * 3) * 0.7;
        o.b.position.set(Math.cos(a) * o.rad, o.h + Math.sin(t * 0.7 + o.off) * 0.4, Math.sin(a) * o.rad);
        o.b.rotation.y = -Math.atan2(Math.cos(a), -Math.sin(a));
        o.b.rotation.x = -0.15;
        o.wl.rotation.x = flap; o.wr.rotation.x = -flap;
      });
      flies.forEach((o) => {
        const a = t * o.sp + o.ph, flap = 0.2 + Math.abs(Math.sin(t * 14 + o.ph)) * 1.1;
        const x = o.cx + Math.cos(a) * o.r, z = o.cz + Math.sin(a * 1.3) * o.r;
        o.f.position.set(x, terrainH(o.cx, o.cz) + 0.7 + Math.sin(a * 2.1) * 0.35, z);
        o.f.rotation.y = -Math.atan2(Math.cos(a * 1.3) * 1.3, -Math.sin(a));
        o.wl.rotation.x = flap; o.wr.rotation.x = -flap;
      });
    });
  });

  /* ---------------------------------------------------------------- */
  /* 8. hotspots: glowing markers + click / hover detection            */
  /* ---------------------------------------------------------------- */
  const markers = new THREE.Group(); scene.add(markers);   // markers live outside W so their size stays constant
  const markerList = [], hitProxies = [];
  let pickId = null, domHoverId = null;
  const MARK = 1.15;                                       // base size of the glowing markers

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
  function markerHidden(m) {                           // is the marker behind a hill?
    tmpV.copy(m.g.position).sub(camera.position);
    const dist = tmpV.length();
    rayOcc.set(camera.position, tmpV.normalize()); rayOcc.far = dist - 0.5;
    return rayOcc.intersectObject(terrain, false).length > 0;
  }
  function pick(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    rayPick.setFromCamera(ndc, camera);
    const hit = rayPick.intersectObjects(hitProxies, false)[0];
    if (!hit) return null;
    const ground = rayPick.intersectObject(terrain, false)[0];
    if (ground && ground.distance < hit.distance - 0.4) return null;   // a hill is in the way
    return hit.object.userData.id;
  }
  always.push((dt, t) => {                             // markers float, pulse and swell when hovered
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
  /* 9. camera: GSAP flights, limits, auto-rotate                      */
  /* ---------------------------------------------------------------- */
  let mode = 'home', flight = null, shiftTl = null, wantAuto = false, userHold = false, holdTimer = 0;
  const refreshAuto = () => { controls.autoRotate = animate && wantAuto && mode === 'home' && !flight && !userHold; };

  function flyTo(id, o = {}) {
    const v = views[id];
    if (!v || disposed) return;
    mode = id === 'home' || id === 'explore' ? id : 'section';
    markers.visible = mode !== 'section';
    setPick(null);
    if (flight) { flight.kill(); flight = null; }      // never let two flights fight over the camera
    controls.enabled = false;

    const p0 = camera.position.clone(), t0 = controls.target.clone();
    const p1 = new THREE.Vector3().fromArray(v.position), t1 = new THREE.Vector3().fromArray(v.target);
    const dist = p0.distanceTo(p1);
    const dur = animate ? (o.duration || clamp(1.25 + dist * 0.04, 1.6, 2.9)) : 0.01;
    const lift = animate ? clamp(dist * 0.12, 0.4, 3.5) : 0;      // the camera arcs up a little mid-flight
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
    // The camera and the point it looks at move together, with the target starting slightly later.
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

  // Keyboard helper (arrow keys / + / -) called from main.js.
  function nudge(dx, dy, zoom) {
    if (flight || mode === 'section') return;
    onUserInteract();
    const off = camera.position.clone().sub(controls.target), s = new THREE.Spherical().setFromVector3(off);
    s.theta += dx; s.phi = clamp(s.phi + dy, controls.minPolarAngle + 0.01, controls.maxPolarAngle - 0.01);
    s.radius = clamp(s.radius * zoom, controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s));
    controls.update(); dirty = true;
  }

  // Pointer: click on a marker to open it, hover to preview, move to get a little parallax.
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
  scene.updateMatrixWorld(true);                       // so raycasts against the scaled world are correct from frame one
  try {
    if (renderer.compileAsync) await Promise.race([renderer.compileAsync(scene, camera), new Promise((r) => setTimeout(r, 4000))]);
    else renderer.compile(scene, camera);
  } catch (e) { /* not critical: the first frame compiles whatever is missing */ }

  // Start far away so playIntro() can swoop in.
  const homeV = views.home;
  camera.position.set(homeV.position[0] + 22 * CAMERA_SCALE, homeV.position[1] + 24 * CAMERA_SCALE, homeV.position[2] + 34 * CAMERA_SCALE);
  controls.target.fromArray(homeV.target);
  camera.lookAt(controls.target);
  if (!animate) { camera.position.fromArray(homeV.position); camera.lookAt(controls.target); }
  setLimits('section');                                // wide limits until the intro flight finishes
  controls.enabled = false;
  controls.update();

  /* ---------------------------------------------------------------- */
  /* 10. the loop                                                      */
  /* ---------------------------------------------------------------- */
  let last = 0, t = 0, occIndex = 0;
  const perf = { warm: 0, n: 0, sum: 0, done: false };
  const screens = (config.hotspots || []).map((h) => ({ id: h.id, x: 0, y: 0, visible: false }));
  const hiddenBy = {};

  function downgrade() {                               // if the device is struggling, trade looks for smoothness
    renderer.setPixelRatio(1); resize();
    if (sunLight && sunLight.castShadow) sunLight.castShadow = false;
    onWarning('Switched to lighter graphics so the scene stays smooth.');
  }

  function update(dt) {
    stepFallbackTweens(dt);
    if (animate) for (let i = 0; i < animators.length; i++) animators[i](dt, t);
    for (let i = 0; i < always.length; i++) always[i](dt, t);

    par.x += (par.tx - par.x) * Math.min(1, dt * 2.5); par.y += (par.ty - par.y) * Math.min(1, dt * 2.5);
    if (animate && cloudsFar) { cloudsFar.position.x = -par.x * 1.5; cloudsFar.position.y = -par.y * 0.8; }
    applyView(false);

    if (!flight && (controls.enabled || controls.autoRotate) && controls.update()) dirty = true;

    if (mode === 'explore') {                          // keep the HTML labels glued to the 3D markers
      if (markerList.length) {
        const m = markerList[occIndex++ % markerList.length];
        hiddenBy[m.id] = markerHidden(m);              // check one marker per frame to keep it cheap
      }
      markerList.forEach((m, i) => {
        tmpV.copy(m.g.position).project(camera);
        const s = screens[i];
        s.x = (tmpV.x * 0.5 + 0.5) * size.w; s.y = (-tmpV.y * 0.5 + 0.5) * size.h;
        s.visible = tmpV.z < 1 && Math.abs(tmpV.x) < 1.08 && Math.abs(tmpV.y) < 1.08 && !hiddenBy[m.id];
      });
      onFrame(screens);
    }

    if (animate || dirty) { renderer.render(scene, camera); dirty = false; }

    if (animate && !perf.done && ++perf.warm > 90) {   // measure the frame rate once, after warm-up
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
    if (flight) flight.kill(); if (shiftTl) shiftTl.kill();
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
      flyTo('home', { duration: 3.8 });                // a long, slow swoop down to the island
    },
  };
}
