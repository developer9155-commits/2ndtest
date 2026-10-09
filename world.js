/* =====================================================================
   world.js — the 3D miniature world (Three.js) and its camera (GSAP)
   ---------------------------------------------------------------------
   main.js calls createWorld() and then uses the object it returns:
     start(), playIntro(), flyTo(id), setHover(id), setViewShift(x, y, s),
     setAutoRotate(on), nudge(dx, dy, zoom), dispose()

   File map (search for these headings):
     0. helpers          small math / random / animation helpers
     1. renderer         the WebGL renderer, scene, camera, controls
     2. sky + lights     background gradient, sun, shadows
     3. terrain          island, purple hills, road
     4. nature           pine trees, rocks, flowers, pond
     5. landmarks        camp + camper van, beacon tower, farm, signpost, mailbox, school
     6. people           me, hiker, farmer, cyclist
     7. atmosphere       clouds, floating rocks, sparkles
     8. hotspots         glowing markers + click / hover detection
     9. camera           GSAP flights between places, limits, view shift
    10. loop             the animation loop and clean-up
   ===================================================================== */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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
  scene.fog = new THREE.Fog(0xcfe6ff, 75, 200);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 900);
  const size = { w: 1, h: 1 };
  let fovBoost = 0;                                   // extra field of view, used by the intro flight
  const baseFov = (aspect) => clamp(38 * Math.pow(Math.max(1, 1 / aspect), 0.9), 38, 68); // wider on tall phone screens

  // Where the camera can go (from config.js, with safe defaults).
  const views = {
    home: { position: [17, 8.5, 25], target: [0, 1.8, 0] },
    explore: { position: [13, 13.5, 22], target: [0, 1.2, 0] },
    ...(config.views || {}),
  };
  (config.hotspots || []).forEach((h) => { if (h.camera) views[h.id] = h.camera; });

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
      controls.minDistance = 0.5; controls.maxDistance = 300;
      controls.minPolarAngle = 0; controls.maxPolarAngle = Math.PI;
    } else {
      controls.minDistance = 13; controls.maxDistance = 40;
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
    const sky = new THREE.Mesh(new THREE.SphereGeometry(420, 24, 16), skyMat);
    sky.renderOrder = -10; sky.frustumCulled = false; scene.add(sky);

    scene.add(new THREE.HemisphereLight(0xcfe6ff, 0xa58bd6, 1.2));      // sky colour from above, purple bounce from below

    sunLight = new THREE.DirectionalLight(0xfff0d0, 2.3);
    sunLight.position.set(10, 16, 8);
    if (!simple) {
      sunLight.castShadow = true;
      const ms = small ? 1024 : 2048;
      sunLight.shadow.mapSize.set(ms, ms);
      const c = sunLight.shadow.camera;
      c.left = -18; c.right = 18; c.top = 18; c.bottom = -18; c.near = 1; c.far = 60;
      sunLight.shadow.bias = -0.0005; sunLight.shadow.normalBias = 0.04;
    }
    scene.add(sunLight);

    const fill = new THREE.DirectionalLight(0x9f8cff, 0.55);           // cool purple fill from the opposite side
    fill.position.set(-8, 6, -10); scene.add(fill);

    const sunDir = new THREE.Vector3(10, 16, 8).normalize().multiplyScalar(380);
    glow(scene, 0xfff2c8, 90, 0.7, sunDir.x, sunDir.y, sunDir.z);
  });

  /* ---------------------------------------------------------------- */
  /* 3. terrain: island, hills, road                                   */
  /* ---------------------------------------------------------------- */
  const R = 14;                                       // island radius
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
    const RINGS = simple ? 16 : 24, SEG = simple ? 40 : 60;
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
    scene.add(terrain);

    // Soil band and the jagged purple rock underneath.
    const soil = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.94, 1.3, SEG, 1, true), mat('#b9825f'));
    soil.position.y = -0.65; soil.receiveShadow = true; scene.add(soil);

    const rockGeo = new THREE.ConeGeometry(R * 0.94, 11, simple ? 18 : 28, 5, true);
    const rp = rockGeo.attributes.position, top = 5.5;
    for (let i = 0; i < rp.count; i++) {
      const x = rp.getX(i), y = rp.getY(i), z = rp.getZ(i);
      const amp = clamp((y + top) / 3, 0, 1);       // 0 at the rim (matches the soil band), 1 toward the tip
      rp.setXYZ(i, x + (hash3(x, y, z) - 0.5) * amp * 1.6, y + (hash3(x, y + 1, z) - 0.5) * amp, z + (hash3(x, y, z + 1) - 0.5) * amp * 1.6);
    }
    const rock = new THREE.Mesh(rockGeo, mat('#5a4aa8'));
    rock.rotation.x = Math.PI; rock.position.y = -1.3 - 5.5; rock.castShadow = true; scene.add(rock);
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
      m.receiveShadow = true; scene.add(m);
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
    scene.add(im);
  });

  /* ---------------------------------------------------------------- */
  /* 4. nature: trees, rocks, flowers, pond                            */
  /* ---------------------------------------------------------------- */
  const rng = mulberry32(20260);
  let trees = null;
  const treeData = [];

  await stage(0.36, 'Planting pine trees', () => {
    const paint = (g, hex) => {                       // give every vertex of a part the same colour
      const c = new THREE.Color(hex), arr = new Float32Array(g.attributes.position.count * 3);
      for (let i = 0; i < g.attributes.position.count; i++) c.toArray(arr, i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3)); return g;
    };
    const parts = [];
    parts.push(paint(new THREE.CylinderGeometry(0.07, 0.1, 0.5, 5).translate(0, 0.25, 0), '#8a5a44'));
    parts.push(paint(new THREE.ConeGeometry(0.5, 0.8, 7).translate(0, 0.75, 0), '#2f9e78'));
    parts.push(paint(new THREE.ConeGeometry(0.39, 0.7, 7).translate(0, 1.2, 0), '#38ae84'));
    parts.push(paint(new THREE.ConeGeometry(0.26, 0.6, 7).translate(0, 1.6, 0), '#46c28f'));
    const treeGeo = mergeGeometries(parts);

    const target = simple ? 50 : small ? 85 : 125;
    for (let tries = 0; tries < 2500 && treeData.length < target; tries++) {
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
    scene.add(trees);

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

  await stage(0.46, 'Scattering rocks and flowers', () => {
    const rocks = [];
    for (let tries = 0; tries < 800 && rocks.length < (simple ? 12 : 28); tries++) {
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
    rockMesh.castShadow = true; rockMesh.receiveShadow = true; scene.add(rockMesh);

    const flowers = [];
    for (let tries = 0; tries < 600 && flowers.length < (simple ? 25 : 70); tries++) {
      const rr = Math.sqrt(rng()) * 12.4, a = rng() * TAU, x = rr * Math.cos(a), z = rr * Math.sin(a), h = terrainH(x, z);
      if (h > 0.5 || !isClear(x, z, 0.3)) continue;
      flowers.push({ x, y: h + 0.06, z });
    }
    const fm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.08, 0), new THREE.MeshLambertMaterial({ flatShading: true }), flowers.length);
    const fc = ['#ff6b5e', '#ffe08a', '#ffffff', '#ff9fb8'].map((c) => new THREE.Color(c));
    flowers.forEach((f, i) => { d.position.set(f.x, f.y, f.z); d.rotation.set(0, 0, 0); d.scale.setScalar(1); d.updateMatrix(); fm.setMatrixAt(i, d.matrix); fm.setColorAt(i, fc[i % fc.length]); });
    scene.add(fm);

    // Pond
    const pond = new THREE.Group(); pond.position.set(-5.6, 0, 0.3); scene.add(pond);
    const water = cyl(pond, 1.9, 1.9, 0.04, 18, 0, -0.07, 0, '#5fd0e8', { emissive: '#1f7f9a', emissiveIntensity: 0.35 });
    water.castShadow = false;
    for (let i = 0; i < 9; i++) {                      // reeds and lily pads around the edge
      const a = rng() * TAU, r = 1.85 + rng() * 0.3;
      if (i < 5) cone(pond, 0.05, 0.6 + rng() * 0.3, 4, Math.cos(a) * r, 0.2, Math.sin(a) * r, '#3f9e6a');
      else { const lp = cyl(pond, 0.22, 0.22, 0.02, 8, Math.cos(a) * (r - 0.9), -0.04, Math.sin(a) * (r - 0.9), '#4fae7a'); lp.castShadow = false; }
    }
  });

  /* ---------------------------------------------------------------- */
  /* people (built first so the landmarks can place them)              */
  /* ---------------------------------------------------------------- */
  function makePerson(o) {
    const g = new THREE.Group();
    const upper = new THREE.Group(); upper.position.y = 0.36; g.add(upper);
    box(upper, 0.18, 0.34, 0.28, 0, 0.17, 0, o.shirt);
    ball(upper, 0.15, 0, 0.5, 0, o.skin || '#f2c7a5');
    put(upper, geo('hair', () => new THREE.SphereGeometry(0.165, 10, 6, 0, TAU, 0, Math.PI * 0.55)), mat(o.hair || '#2b2850'), 0, 0.52, 0);
    box(upper, 0.03, 0.035, 0.035, 0.145, 0.52, 0.055, '#241f4d'); box(upper, 0.03, 0.035, 0.035, 0.145, 0.52, -0.055, '#241f4d');
    const armL = new THREE.Group(); armL.position.set(0, 0.31, 0.18); upper.add(armL); box(armL, 0.075, 0.28, 0.075, 0, -0.12, 0, o.shirt);
    const armR = new THREE.Group(); armR.position.set(0, 0.31, -0.18); upper.add(armR); box(armR, 0.075, 0.28, 0.075, 0, -0.12, 0, o.shirt);
    const legL = new THREE.Group(); legL.position.set(0, 0.36, 0.07); g.add(legL); box(legL, 0.1, 0.34, 0.1, 0, -0.17, 0, o.pants || '#2b2850');
    const legR = new THREE.Group(); legR.position.set(0, 0.36, -0.07); g.add(legR); box(legR, 0.1, 0.34, 0.1, 0, -0.17, 0, o.pants || '#2b2850');
    if (o.hat === 'straw') { cyl(upper, 0.26, 0.26, 0.03, 12, 0, 0.62, 0, '#e8c36a'); cyl(upper, 0.13, 0.15, 0.1, 10, 0, 0.67, 0, '#e8c36a'); }
    if (o.backpack) box(upper, 0.12, 0.26, 0.2, -0.15, 0.18, 0, o.backpack);
    return { group: g, upper, armL, armR, legL, legR };
  }
  const faceDir = (obj, dx, dz) => { obj.rotation.y = -Math.atan2(dz, dx); };   // models face +x

  /* ---------------------------------------------------------------- */
  /* 5. landmarks                                                      */
  /* ---------------------------------------------------------------- */
  const van = { group: new THREE.Group(), body: new THREE.Group() };

  await stage(0.56, 'Parking the camper van', () => {
    // --- camp: van, tent, fire, me ---
    van.group.position.set(-6.2, 0, 6.8); van.group.rotation.y = -0.25; scene.add(van.group);
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
    const tent = new THREE.Group(); tent.position.set(-8.8, 0, 8.0); tent.rotation.y = 0.5; scene.add(tent);
    const tc = cone(tent, 1.05, 1.15, 4, 0, 0.58, 0, '#5ac8c8'); tc.rotation.y = Math.PI / 4;
    box(tent, 0.01, 0.6, 0.45, 0.72, 0.32, 0, '#2b2850').rotation.y = 0;
    box(tent, 0.2, 0.2, 0.2, -1.4, 0.1, 0.6, '#e8b23a');

    // campfire
    const fire = new THREE.Group(); fire.position.set(-3.6, 0, 8.0); scene.add(fire);
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
    const me = makePerson({ shirt: '#ff6b5e', pants: '#2b2850', hair: '#241f4d', backpack: '#e8b23a' });
    me.group.position.set(-4.5, 0, 7.4); me.group.rotation.y = -Math.PI / 3; scene.add(me.group);
    me.armR.rotation.x = 0.1;
    animators.push((dt, t) => {
      me.armL.rotation.x = -(2.35 + Math.sin(t * 7) * 0.35);       // waving arm
      me.upper.rotation.z = Math.sin(t * 1.6) * 0.02;
      me.group.position.y = Math.abs(Math.sin(t * 3.2)) * 0.012;
    });
  });

  await stage(0.64, 'Building the Nexora tower', () => {
    const g = new THREE.Group(); g.position.set(-0.5, 0, -3.2); scene.add(g);
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
    const g = new THREE.Group(); g.position.set(9.8, 0, 0.2); scene.add(g);
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
    const farmer = makePerson({ shirt: '#4fae7a', pants: '#6c58cf', hair: '#2b2850', hat: 'straw' });
    farmer.group.position.set(1.7, 0.0, 0.75); faceDir(farmer.group, -1, 0.4); g.add(farmer.group);
    animators.push((dt, t) => {                        // bends down to tend the crops, then straightens up
      const k = (Math.sin(t * 0.9) + 1) / 2;
      farmer.upper.rotation.z = -k * 0.7; farmer.armL.rotation.z = -k * 0.5; farmer.armR.rotation.z = -k * 0.5;
    });
  });

  await stage(0.8, 'Raising the signpost and mailbox', () => {
    // Skills signpost with five arrow boards and orbiting cubes
    const g = new THREE.Group(); g.position.set(2.0, 0, 9.5); scene.add(g);
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
    const mb = new THREE.Group(); mb.position.set(10.8, 0, 6.6); mb.rotation.y = -0.9; scene.add(mb);
    box(mb, 0.12, 1.1, 0.12, 0, 0.55, 0, '#8a5a44');
    box(mb, 0.74, 0.4, 0.46, 0, 1.2, 0, '#ff6b5e'); box(mb, 0.66, 0.1, 0.38, 0, 1.45, 0, '#e8564a');
    box(mb, 0.04, 0.3, 0.04, 0.2, 0, 0, '#e8b23a');
    const flag = new THREE.Group(); flag.position.set(0.2, 1.2, 0.26); mb.add(flag); box(flag, 0.05, 0.32, 0.05, 0, 0.16, 0, '#e8b23a'); box(flag, 0.2, 0.12, 0.04, 0.1, 0.3, 0, '#e8b23a');
    const planeG = new THREE.Group(); scene.add(planeG);
    const plane = new THREE.Mesh(geo('plane', () => new THREE.ConeGeometry(0.14, 0.55, 3)), new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true, emissive: '#cfe6ff', emissiveIntensity: 0.3 }));
    plane.castShadow = true; plane.rotation.z = -Math.PI / 2; plane.scale.set(1, 1, 0.35); planeG.add(plane);   // cone tip points forward (+x)
    animators.push((dt, t) => {
      flag.rotation.x = -0.4 + Math.sin(t * 2) * 0.25;
      const a = t * 0.7;
      planeG.position.set(10.8 + Math.cos(a) * 1.2, 2.2 + Math.sin(t * 1.6) * 0.15, 6.6 + Math.sin(a) * 1.2);
      planeG.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a));       // face the direction of travel
    });

    // Education: the little school
    const s = new THREE.Group(); s.position.set(-9.6, 0, -1.2); s.rotation.y = 0.5; scene.add(s);
    box(s, 1.9, 0.95, 1.25, 0, 0.48, 0, '#fff1dc'); prism(s, 1.1, 1.3, 0, 1.25, 0, '#ff6b5e', 0.55);
    box(s, 0.34, 0.55, 0.04, 0, 0.28, 0.64, '#6c58cf');
    [-0.6, 0.6].forEach((x) => box(s, 0.32, 0.3, 0.04, x, 0.6, 0.64, '#bfe4ff'));
    box(s, 0.4, 0.4, 0.4, 0, 1.85, 0, '#fff1dc'); cone(s, 0.34, 0.35, 4, 0, 2.25, 0, '#6c58cf').rotation.y = Math.PI / 4;
    cyl(s, 0.03, 0.03, 1.6, 5, 1.4, 0.8, 0.7, '#d8d2ff');
    const sflag = box(s, 0.5, 0.28, 0.03, 1.65, 1.5, 0.7, '#ff6b5e');
    animators.push((dt, t) => { sflag.rotation.y = Math.sin(t * 3) * 0.25; });
  });

  /* ---------------------------------------------------------------- */
  /* 6. people on the move: hiker and cyclist                          */
  /* ---------------------------------------------------------------- */
  await stage(0.86, 'Waking up the villagers', () => {
    const hiker = makePerson({ shirt: '#8f7fe6', pants: '#2b2850', hair: '#8a5a44', backpack: '#ff6b5e' });
    scene.add(hiker.group);
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
    });

    // cyclist
    const bike = new THREE.Group(); scene.add(bike);
    const wheelGeo = geo('wheel', () => new THREE.TorusGeometry(0.28, 0.035, 6, 16)), wm = mat('#2b2850');
    const wf = put(bike, wheelGeo, wm, 0.42, 0.3, 0), wr = put(bike, wheelGeo, wm, -0.42, 0.3, 0);
    box(bike, 0.75, 0.04, 0.04, 0, 0.5, 0, '#ff6b5e'); box(bike, 0.04, 0.4, 0.04, -0.18, 0.4, 0, '#ff6b5e');
    box(bike, 0.04, 0.45, 0.04, 0.4, 0.45, 0, '#ff6b5e').rotation.z = -0.25;
    box(bike, 0.04, 0.04, 0.34, 0.43, 0.7, 0, '#2b2850'); box(bike, 0.2, 0.05, 0.12, -0.2, 0.62, 0, '#2b2850');
    const rider = makePerson({ shirt: '#4fae7a', pants: '#2b2850', hair: '#e8b23a' });
    rider.group.position.set(-0.18, 0.28, 0); rider.group.scale.setScalar(0.92); bike.add(rider.group);
    rider.upper.rotation.z = -0.3; rider.armL.rotation.z = -1.0; rider.armR.rotation.z = -1.0;
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
    });
  });

  /* ---------------------------------------------------------------- */
  /* 7. atmosphere: clouds, floating rocks, sparkles                   */
  /* ---------------------------------------------------------------- */
  let cloudsFar;
  await stage(0.92, 'Drifting clouds in', () => {
    cloudsFar = new THREE.Group(); scene.add(cloudsFar);
    const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#a9bce8', emissiveIntensity: 0.35, flatShading: true });
    const count = simple ? 7 : 15;
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
    for (let i = 0; i < (simple ? 4 : 8); i++) {
      const a = rng() * TAU, r = 15.5 + rng() * 4.5;
      const m = new THREE.Mesh(geo('floatrock', () => new THREE.IcosahedronGeometry(1, 0)), mat(i % 2 ? '#5a4aa8' : '#8a84b8'));
      m.position.set(Math.cos(a) * r, -1.5 - rng() * 7, Math.sin(a) * r); m.scale.setScalar(0.35 + rng() * 0.7); m.castShadow = true;
      m.userData = { base: m.position.y, ph: rng() * TAU, sp: 0.4 + rng() * 0.5 };
      scene.add(m); floaters.push(m);
    }
    // sparkles (pollen / fireflies)
    const N = simple ? 50 : small ? 90 : 150, pp = new Float32Array(N * 3), seeds = [];
    for (let i = 0; i < N; i++) {
      const a = rng() * TAU, r = Math.sqrt(rng()) * 15;
      seeds.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, y: rng() * 9, ph: rng() * TAU, sp: 0.4 + rng() * 0.8 });
    }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
    const points = new THREE.Points(pg, new THREE.PointsMaterial({ map: glowTex, size: 0.32, color: 0xfff3b0, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    points.frustumCulled = false; scene.add(points);
    const writeSparkles = (t) => {
      seeds.forEach((s, i) => {
        pp[i * 3] = s.x + Math.sin(t * s.sp + s.ph) * 0.7;
        pp[i * 3 + 1] = 0.5 + ((s.y + t * 0.25 * s.sp) % 9);
        pp[i * 3 + 2] = s.z + Math.cos(t * s.sp * 0.8 + s.ph) * 0.7;
      });
      pg.attributes.position.needsUpdate = true;
    };
    writeSparkles(0);
    animators.push((dt, t) => {
      writeSparkles(t);
      cloudsFar.rotation.y += dt * 0.004;
      cloudsFar.children.forEach((c) => { c.position.y += Math.sin(t * 0.3 + c.userData.bob) * dt * 0.05; });
      floaters.forEach((f) => { f.position.y = f.userData.base + Math.sin(t * f.userData.sp + f.userData.ph) * 0.4; f.rotation.y += dt * 0.2; });
    });
  });

  /* ---------------------------------------------------------------- */
  /* 8. hotspots: glowing markers + click / hover detection            */
  /* ---------------------------------------------------------------- */
  const markers = new THREE.Group(); scene.add(markers);
  const markerList = [], hitProxies = [];
  let pickId = null, domHoverId = null;

  (config.hotspots || []).forEach((h, idx) => {
    const color = new THREE.Color(h.color || '#ffffff');
    const g = new THREE.Group(); g.position.fromArray(h.position); markers.add(g);
    const gem = new THREE.Mesh(geo('markgem', () => new THREE.OctahedronGeometry(0.28, 0)), new THREE.MeshBasicMaterial({ color }));
    gem.scale.y = 1.4; g.add(gem);
    const halo = glow(g, color, 2.0, 0.8);
    const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, color: 0xffffff, transparent: true, depthWrite: false, fog: false }));
    g.add(ring);
    const proxy = new THREE.Mesh(geo('proxy', () => new THREE.SphereGeometry(1.0, 8, 6)), new THREE.MeshBasicMaterial({ visible: false }));
    proxy.userData.id = h.id; g.add(proxy); hitProxies.push(proxy);
    markerList.push({ id: h.id, g, gem, halo, ring, base: h.position[1], ph: idx * 1.3, hover: 0 });
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
        m.g.position.y = m.base + Math.sin(t * 1.8 + m.ph) * 0.12;
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
        m.g.scale.setScalar(1 + m.hover * 0.35); dirty = true;
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
  try {
    if (renderer.compileAsync) await Promise.race([renderer.compileAsync(scene, camera), new Promise((r) => setTimeout(r, 4000))]);
    else renderer.compile(scene, camera);
  } catch (e) { /* not critical: the first frame compiles whatever is missing */ }

  // Start far away so playIntro() can swoop in.
  const homeV = views.home;
  camera.position.set(homeV.position[0] + 22, homeV.position[1] + 24, homeV.position[2] + 34);
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
