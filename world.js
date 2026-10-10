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
     8. people    8.5 district and lake   8.6 sky life
     9. atmosphere  10. hotspots  11. camera + tour  12. loop
   ===================================================================== */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ------------------------------------------------------------------ */
/* SIZE SETTINGS — change these to make the world bigger or smaller    */
/* ------------------------------------------------------------------ */
const WORLD_SCALE = 1.5;     // how much bigger everything is (1 = original size)
const CAMERA_SCALE = 1.6;    // how far back the HOME camera sits
const EXPLORE_SCALE = 2.75;   // how far back the EXPLORE camera sits (sees the whole island)
const ISLAND_RADIUS = 66;    // centre-to-edge size of the island (was 46: the new outer ring is the forest)
const OLD_RADIUS = 46;       // the original island: old scenery is still scattered inside this circle
const TRACK_R = 44;          // radius of the circular railway track
const STATION_A = 1.0;       // where the station is on the ring (radians)
const OFFICE_SCALE = 1.25;
const DAY_SECONDS = 300;     // daytime before the first night and between later nights
const NIGHT_FADE_SECONDS = 20; // duration of each day/night fade
const NIGHT_SECONDS = 180;    // length of each night

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
    onSpeak = () => {}, onSpeakEnd = () => {}, onInput = () => {}, onVisitState = () => {}, onNightChange = () => {},
    onWalkArrive = () => {},
  } = opts;

  const S = WORLD_SCALE;
  const R = ISLAND_RADIUS;
  const R0 = OLD_RADIUS;
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
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;   // richer colours, softer highlights
  renderer.toneMappingExposure = 1.05;

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
  let nightAmount = 0, worldSeconds = 0;
  const nightGlows = [];
  const houseWindowMats = [];
  let skyUniforms = null, hemiLight = null, fillLight = null, stars = null, moon = null, sunGlow = null;
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
    skyUniforms = uniforms;
    const skyMat = new THREE.ShaderMaterial({
      uniforms, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
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

    hemiLight = new THREE.HemisphereLight(0xcfe6ff, 0x9a86d0, 1.1);
    scene.add(hemiLight);

    sunLight = new THREE.DirectionalLight(0xffe9c4, 2.6);
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

    fillLight = new THREE.DirectionalLight(0x9f8cff, 0.6);
    fillLight.position.set(-8, 6, -10); scene.add(fillLight);

    const sunDir = new THREE.Vector3(10, 16, 8).normalize().multiplyScalar(800);
    sunGlow = glow(scene, 0xfff2c8, 190, 0.7, sunDir.x, sunDir.y, sunDir.z);
    const starPositions = new Float32Array(720);
    for (let i = 0; i < starPositions.length; i += 3) {
      const y = 1 - 2 * (i / 3) / (starPositions.length / 3);
      const a = Math.sqrt(1 - y * y) * 780, theta = i * 2.399963;
      starPositions[i] = Math.cos(theta) * a;
      starPositions[i + 1] = y * 780;
      starPositions[i + 2] = Math.sin(theta) * a;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#dce8ff', size: 2.5, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    stars.frustumCulled = false; scene.add(stars);
    moon = new THREE.Mesh(new THREE.SphereGeometry(20, 20, 16), new THREE.MeshBasicMaterial({ color: '#e8edff', transparent: true, opacity: 0 }));
    moon.position.set(-270, 235, -520); scene.add(moon);
  });
  const nightColors = {
    top: new THREE.Color('#080f2b'), mid: new THREE.Color('#172c56'),
    horizon: new THREE.Color('#493f68'), bottom: new THREE.Color('#101a36'),
    clear: new THREE.Color('#101a36'), fog: new THREE.Color('#17213e'),
    sun: new THREE.Color('#8793c5'), hemiSky: new THREE.Color('#46557e'),
    hemiGround: new THREE.Color('#24243f'), fill: new THREE.Color('#626aab'),
  };
  const dayColors = {
    top: new THREE.Color('#2f78e6'), mid: new THREE.Color('#68b4ff'),
    horizon: new THREE.Color('#d6edff'), bottom: new THREE.Color('#e3dcff'),
    clear: new THREE.Color('#cfe6ff'), fog: new THREE.Color('#cfe6ff'),
    sun: new THREE.Color('#ffe9c4'), hemiSky: new THREE.Color('#cfe6ff'),
    hemiGround: new THREE.Color('#9a86d0'), fill: new THREE.Color('#9f8cff'),
  };
  const blended = new THREE.Color();
  let nightState = false;
  always.push((dt) => {
    worldSeconds += dt;
    const cycle = DAY_SECONDS + NIGHT_FADE_SECONDS * 2 + NIGHT_SECONDS;
    const phase = worldSeconds % cycle;
    let nextNight = 0;
    if (phase >= DAY_SECONDS && phase < DAY_SECONDS + NIGHT_FADE_SECONDS) {
      nextNight = smoothstep(0, 1, (phase - DAY_SECONDS) / NIGHT_FADE_SECONDS);
    } else if (phase >= DAY_SECONDS + NIGHT_FADE_SECONDS && phase < DAY_SECONDS + NIGHT_FADE_SECONDS + NIGHT_SECONDS) {
      nextNight = 1;
    } else if (phase >= DAY_SECONDS + NIGHT_FADE_SECONDS + NIGHT_SECONDS) {
      nextNight = 1 - smoothstep(0, 1, (phase - DAY_SECONDS - NIGHT_FADE_SECONDS - NIGHT_SECONDS) / NIGHT_FADE_SECONDS);
    }
    nightAmount = nextNight;
    if ((nightAmount >= 0.5) !== nightState) {
      nightState = nightAmount >= 0.5;
      onNightChange(nightState);
    }
    ['top', 'mid', 'horizon', 'bottom'].forEach((key) => skyUniforms[key].value.copy(dayColors[key]).lerp(nightColors[key], nightAmount));
    renderer.setClearColor(blended.copy(dayColors.clear).lerp(nightColors.clear, nightAmount), 1);
    scene.fog.color.copy(dayColors.fog).lerp(nightColors.fog, nightAmount);
    hemiLight.color.copy(dayColors.hemiSky).lerp(nightColors.hemiSky, nightAmount);
    hemiLight.groundColor.copy(dayColors.hemiGround).lerp(nightColors.hemiGround, nightAmount);
    hemiLight.intensity = lerp(1.1, 0.28, nightAmount);
    sunLight.color.copy(dayColors.sun).lerp(nightColors.sun, nightAmount);
    sunLight.intensity = lerp(2.6, 0.12, nightAmount);
    fillLight.color.copy(dayColors.fill).lerp(nightColors.fill, nightAmount);
    fillLight.intensity = lerp(0.6, 0.18, nightAmount);
    renderer.toneMappingExposure = lerp(1.05, 0.62, nightAmount);
    houseWindowMats.forEach((m) => { m.emissiveIntensity = lerp(0.08, 1.25, nightAmount); });
    stars.material.opacity = nightAmount;
    moon.material.opacity = nightAmount;
    sunGlow.material.opacity = 0.7 * (1 - nightAmount);
    nightGlows.forEach((item) => { item.material.opacity = item.dayOpacity + (item.nightOpacity - item.dayOpacity) * nightAmount; });
  });

  /* ---------------------------------------------------------------- */
  /* 3. terrain: island, hills, roads                                  */
  /* ---------------------------------------------------------------- */
  const CITY = { x0: -11.5, x1: 11.5, z0: 14.5, z1: 25.8 };
  const CITY2 = { x0: -30.5, x1: -13.0, z0: 15.0, z1: 28.0 };       // the west district
  const AVENUE_Z = 22.6;
  const AIRPORT = { x0: -39.0, x1: -17.0, z0: -13.0, z1: 6.0 };
  const rectMask = (x, z, r, m) => 1 - smoothstep(0, m, Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1)));

  // Hills: [x, z, height, radius].
  const BUMPS = [
    [-8, -8.5, 6.0, 6.5], [-1.5, -10, 8.6, 7.5], [6, -8.8, 6.5, 6.5], [11.5, -5.5, 4.5, 5.5], [-12.5, -5.5, 4.2, 5.2],
    [-21, 9, 3.4, 5.5], [-20, -9, 4.2, 6], [18, -14, 3.8, 5.5], [21, 4, 2.8, 4.5], [-4, -20, 3.6, 6], [10, -21, 3.0, 5],
    // the outer mountain ring
    [28, -24, 4.6, 6.5], [-30, -22, 5.0, 7], [36, -10, 3.6, 5.5], [-8, -33, 4.6, 6.5], [8, -34, 4.0, 6],
    [-18, -30, 3.8, 6], [20, -31, 3.6, 6],
    // rolling forest hills in the new outer ring
    [55, 12, 3.2, 8], [-54, 14, 3.0, 8], [50, -32, 3.6, 8], [-50, -34, 3.4, 8], [12, 58, 3.0, 8], [-30, 55, 2.8, 8], [38, 46, 3.2, 8], [-52, -8, 3.4, 7], [30, -52, 3.4, 8], [-10, -55, 3.0, 8],
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
    { x: -15.5, z: 9.0, r: 6.0, y: 0 },
    { x: 24.0, z: -4.0, r: 6.0, y: 0 },
    { x: 31.0, z: 8.0, r: 5.2, y: -0.18 },   // the lake
    { x: Math.cos(STATION_A) * (TRACK_R - 3.4), z: Math.sin(STATION_A) * (TRACK_R - 3.4), r: 9.0, y: 0 },   // the station
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

  const FOREST_FLOOR = new THREE.Color('#3f8f5e');
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
    const RINGS = simple ? 40 : 84, SEG = simple ? 90 : 176;
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
      const crad = Math.hypot((t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][2] + t[1][2] + t[2][2]) / 3);
      c.lerp(FOREST_FLOOR, 0.78 * smoothstep(TRACK_R + 1.5, TRACK_R + 7, crad) * (avg < 3.6 ? 1 : 0.35));   // darker, mossy ground under the forest
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

    const rockH = 22 * (R / 46), top = rockH / 2;
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
      const rr = Math.sqrt(rng()) * (R0 - 2.2), a = rng() * TAU, x = rr * Math.cos(a), z = rr * Math.sin(a);
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
      const rr = Math.sqrt(rng()) * (R0 - 3), a = rng() * TAU, x = rr * Math.cos(a), z = rr * Math.sin(a), h = terrainH(x, z);
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
      const rr = Math.sqrt(rng()) * (R0 - 2), a = rng() * TAU, x = rr * Math.cos(a), z = rr * Math.sin(a), h = terrainH(x, z);
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
      const rr = Math.sqrt(rng()) * (R0 - 1.5), a = rng() * TAU, x = rr * Math.cos(a), z = rr * Math.sin(a), h = terrainH(x, z);
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
      const rr = Math.sqrt(rng()) * (R0 - 1.5), a = rng() * TAU, x = rr * Math.cos(a), z = rr * Math.sin(a), h = terrainH(x, z);
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
  /* 4.5 the forest: the new outer ring of the island                  */
  /*     pine, fir, oak, birch, cherry and maple trees, grass tufts,   */
  /*     ferns, bushes, mushrooms, logs, stumps and mossy boulders.     */
  /* ---------------------------------------------------------------- */
  await stage(0.34, 'Growing the forest', () => {
    const FR0 = TRACK_R + 2.8, FR1 = R - 1.8;                  // the forest ring (beyond the railway)
    const frand = mulberry32(777001);
    const part = (g, hex) => paintGeo(g.index ? g.toNonIndexed() : g, hex);
    const blob = (r, x, y, z, hex, det = 0) => part(new THREE.IcosahedronGeometry(r, det).translate(x, y, z), hex);
    const trunk = (rt, rb, h, hex) => part(new THREE.CylinderGeometry(rt, rb, h, 6).translate(0, h / 2, 0), hex);
    const tier = (r, h, y, hex) => part(new THREE.ConeGeometry(r, h, 7).translate(0, y, 0), hex);

    const TYPES = {
      pine: mergeGeometries([trunk(0.07, 0.1, 0.6, '#7a5238'), tier(0.62, 0.95, 1.0, '#2b8a6a'), tier(0.5, 0.9, 1.5, '#33a07a'), tier(0.38, 0.85, 1.95, '#3cb287'), tier(0.25, 0.7, 2.38, '#49c795')]),
      fir: mergeGeometries([trunk(0.06, 0.09, 0.5, '#6a4630'), tier(0.55, 0.9, 0.9, '#1f7a5c'), tier(0.46, 0.85, 1.38, '#278a68'), tier(0.37, 0.8, 1.84, '#2f9c76'), tier(0.28, 0.75, 2.26, '#38ae85'), tier(0.17, 0.6, 2.64, '#46c093')]),
      oak: mergeGeometries([trunk(0.09, 0.14, 0.95, '#80583c'), blob(0.66, 0, 1.4, 0, '#3f9e5a', 1), blob(0.46, 0.42, 1.18, 0.16, '#4fae6a'), blob(0.48, -0.4, 1.22, -0.12, '#2f8a52'), blob(0.4, 0.04, 1.85, 0.06, '#5cc47c')]),
      birch: mergeGeometries([trunk(0.045, 0.065, 1.5, '#efe9dc'), blob(0.4, 0, 1.55, 0, '#a6d86a', 1), blob(0.3, 0.22, 1.32, 0.1, '#8cc95a'), blob(0.28, -0.2, 1.8, -0.06, '#b9e37a')]),
      cherry: mergeGeometries([trunk(0.07, 0.11, 0.8, '#7a5238'), blob(0.58, 0, 1.2, 0, '#ffb3c7', 1), blob(0.4, 0.38, 1.0, 0.14, '#ff9fbd'), blob(0.4, -0.34, 1.05, -0.1, '#ffc9d8'), blob(0.32, 0.02, 1.62, 0.04, '#ffa6c4')]),
      maple: mergeGeometries([trunk(0.08, 0.12, 0.85, '#7a5238'), blob(0.6, 0, 1.3, 0, '#f08a3c', 1), blob(0.42, 0.4, 1.1, 0.15, '#e8b23a'), blob(0.44, -0.38, 1.15, -0.1, '#d9573a'), blob(0.34, 0.04, 1.72, 0.05, '#f5a64d')]),
    };
    const bucket = {}; Object.keys(TYPES).forEach((k) => { bucket[k] = []; });
    const cell = 1.7, grid = new Map();
    const taken = (x, z) => {
      const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const list = grid.get((cx + i) + ',' + (cz + j)); if (!list) continue;
        for (const p of list) if ((p[0] - x) ** 2 + (p[1] - z) ** 2 < cell * cell * 0.62) return true;
      }
      return false;
    };
    const mark = (x, z) => { const k = Math.floor(x / cell) + ',' + Math.floor(z / cell); (grid.get(k) || grid.set(k, []).get(k)).push([x, z]); };

    const want = simple ? 260 : small ? 620 : 1250;
    for (let tries = 0; tries < 40000 && Object.values(bucket).reduce((n, b) => n + b.length, 0) < want; tries++) {
      const rr = Math.sqrt(FR0 * FR0 + frand() * (FR1 * FR1 - FR0 * FR0)), a = frand() * TAU, x = rr * Math.cos(a), z = rr * Math.sin(a);
      const meadow = vnoise(x * 0.07 + 40, z * 0.07 + 7);
      if (meadow < 0.2) continue;                                              // open clearings
      const h = terrainH(x, z);
      if (h > 5.2 || taken(x, z)) continue;
      const g = vnoise(x * 0.06, z * 0.06 + 90);                               // which kind of woodland is here
      const pick = frand();
      let type;
      if (g < 0.3) type = pick < 0.55 ? 'fir' : 'pine';
      else if (g < 0.55) type = pick < 0.5 ? 'oak' : pick < 0.8 ? 'pine' : 'birch';
      else if (g < 0.75) type = pick < 0.45 ? 'birch' : pick < 0.75 ? 'oak' : 'cherry';
      else type = pick < 0.5 ? 'maple' : pick < 0.8 ? 'cherry' : 'oak';
      bucket[type].push({ x, y: h - 0.04, z, s: (0.85 + frand() * 0.9) * (1 - h / 20), ry: frand() * TAU });
      mark(x, z);
    }
    const dummy = new THREE.Object3D(), tint = new THREE.Color();
    const forestMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    Object.keys(bucket).forEach((k) => {
      const list = bucket[k]; if (!list.length) return;
      const im = new THREE.InstancedMesh(TYPES[k], forestMat, list.length);
      list.forEach((t, i) => {
        dummy.position.set(t.x, t.y, t.z); dummy.rotation.set(0, t.ry, 0); dummy.scale.set(t.s, t.s * (0.9 + (i % 5) * 0.06), t.s); dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
        const b = 0.82 + frand() * 0.34; im.setColorAt(i, tint.setRGB(b, b * (0.96 + frand() * 0.08), b));
      });
      im.castShadow = true; im.receiveShadow = true; im.frustumCulled = false; W.add(im);
    });

    // bushes, boulders, logs, stumps, mushrooms, ferns
    const scatter = (count, tries, hMax, margin, fn) => {
      const out = [];
      for (let i = 0; i < tries && out.length < count; i++) {
        const rr = Math.sqrt(FR0 * FR0 + frand() * (FR1 * FR1 - FR0 * FR0)), a = frand() * TAU, x = rr * Math.cos(a), z = rr * Math.sin(a), h = terrainH(x, z);
        if (h > hMax) continue;
        out.push(fn(x, h, z));
      }
      return out;
    };
    const place = (mesh, items, setup) => {
      items.forEach((it, i) => { dummy.position.set(it.x, it.y, it.z); dummy.rotation.set(it.rx || 0, it.ry || 0, it.rz || 0); dummy.scale.set(it.sx || it.s, it.sy || it.s, it.sz || it.s); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); if (setup) setup(mesh, i, it); });
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; W.add(mesh);
    };

    const bushes = scatter(simple ? 60 : 320, 3000, 4, 0, (x, h, z) => ({ x, y: h + 0.1, z, s: 0.5 + frand() * 0.7, ry: frand() * TAU }));
    const bushCols = ['#2f8a52', '#3f9e5a', '#4fae6a', '#2b7a4c'].map((c) => new THREE.Color(c));
    place(new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.42, 1), new THREE.MeshLambertMaterial({ flatShading: true }), bushes.length), bushes, (m, i) => m.setColorAt(i, bushCols[i % 4]));

    const boulders = scatter(simple ? 24 : 110, 1500, 5, 0, (x, h, z) => ({ x, y: h + 0.05, z, sx: 0.5 + frand() * 0.8, sy: 0.4 + frand() * 0.5, sz: 0.5 + frand() * 0.8, ry: frand() * TAU, rx: frand() * 0.5 }));
    const rockCols = ['#7f8f84', '#8fa093', '#6a7a70', '#9aa89c'].map((c) => new THREE.Color(c));
    place(new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.6, 0), new THREE.MeshLambertMaterial({ flatShading: true }), boulders.length), boulders, (m, i) => m.setColorAt(i, rockCols[i % 4]));

    const logs = scatter(simple ? 8 : 34, 800, 4, 0, (x, h, z) => ({ x, y: h + 0.14, z, s: 0.8 + frand() * 0.5, ry: frand() * TAU, rz: Math.PI / 2 }));
    place(new THREE.InstancedMesh(new THREE.CylinderGeometry(0.13, 0.15, 1.5, 7), new THREE.MeshLambertMaterial({ color: '#7a5238', flatShading: true }), logs.length), logs);
    const stumps = scatter(simple ? 8 : 30, 800, 4, 0, (x, h, z) => ({ x, y: h + 0.13, z, s: 0.7 + frand() * 0.6 }));
    place(new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.2, 0.28, 8), new THREE.MeshLambertMaterial({ color: '#9a6e4a', flatShading: true }), stumps.length), stumps);

    const shrooms = scatter(simple ? 24 : 150, 2000, 3.5, 0, (x, h, z) => ({ x, y: h, z, s: 0.7 + frand() * 0.8, ry: frand() * TAU }));
    const shroomGeo = mergeGeometries([part(new THREE.CylinderGeometry(0.025, 0.035, 0.14, 6).translate(0, 0.07, 0), '#f5ecd9'), part(new THREE.SphereGeometry(0.1, 8, 5, 0, TAU, 0, Math.PI / 2).translate(0, 0.13, 0), '#e8453c')]);
    place(new THREE.InstancedMesh(shroomGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), shrooms.length), shrooms);

    // ferns: flat fans of leaves
    const ferns = scatter(simple ? 80 : 520, 4000, 4, 0, (x, h, z) => ({ x, y: h + 0.02, z, s: 0.6 + frand() * 0.8, ry: frand() * TAU }));
    const fernParts = [];
    for (let k = 0; k < 6; k++) {
      const leaf = new THREE.ConeGeometry(0.05, 0.5, 3).translate(0, 0.25, 0); leaf.rotateZ(1.05); leaf.rotateY((k / 6) * TAU); fernParts.push(part(leaf, k % 2 ? '#3fae6a' : '#55c27a'));
    }
    place(new THREE.InstancedMesh(mergeGeometries(fernParts), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }), ferns.length), ferns);

    // grass tufts: thin blades, dark at the root and bright at the tip
    const blades = [];
    const root = new THREE.Color('#2f8a4c'), tip = new THREE.Color('#9be36a'), cc = new THREE.Color();
    for (let k = 0; k < 7; k++) {
      const h = 0.26 + (k % 3) * 0.1, a = (k / 7) * TAU, bg = new THREE.ConeGeometry(0.035, h, 3).translate(0, h / 2, 0);
      bg.rotateZ((k % 2 ? 1 : -1) * (0.12 + (k % 3) * 0.08)); bg.rotateY(a); bg.translate(Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05);
      const ng = bg.toNonIndexed(), pos = ng.attributes.position, col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) { cc.copy(root).lerp(tip, clamp(pos.getY(i) / (h * 0.95), 0, 1)); cc.toArray(col, i * 3); }
      ng.setAttribute('color', new THREE.BufferAttribute(col, 3)); blades.push(ng);
    }
    const grassN = simple ? 700 : small ? 2200 : 6500;
    const tufts = scatter(grassN, grassN * 3, 4.5, 0, (x, h, z) => ({ x, y: h, z, s: 0.8 + frand() * 1.1, ry: frand() * TAU }));
    const grass = new THREE.InstancedMesh(mergeGeometries(blades), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), tufts.length);
    place(grass, tufts, (m, i) => { const b = 0.85 + frand() * 0.3; m.setColorAt(i, tint.setRGB(b, b, b * 0.95)); });
    grass.castShadow = false;

    // wildflowers in the clearings
    const flw = scatter(simple ? 80 : 520, 6000, 3, 0, (x, h, z) => ({ x, y: h + 0.22, z, s: 0.7 + frand() * 0.7 }));
    const flwCols = ['#ffe08a', '#ffffff', '#ff9fb8', '#c9a7ff', '#7ee8ff', '#ff6b5e'].map((c) => new THREE.Color(c));
    place(new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.07, 0), new THREE.MeshLambertMaterial({ flatShading: true }), flw.length), flw, (m, i) => m.setColorAt(i, flwCols[i % 6]));
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
    const pupils = [];
    [0.05, -0.05].forEach((z) => {
      const white = smallPart(head, geo('eyeW', () => new THREE.SphereGeometry(0.026, 12, 8)), soft('#ffffff'), 0.109, 0.014, z); white.scale.set(0.7, 1, 0.95);
      const pupil = smallPart(head, geo('eyeP', () => new THREE.SphereGeometry(0.0145, 10, 8)), soft('#241f4d'), 0.124, 0.012, z);
      pupils.push({ mesh: pupil, y: pupil.position.y, z: pupil.position.z });
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
    return { group: g, upper, head, pupils, armL: aL.arm, armR: aR.arm, elbowL: aL.elbow, elbowR: aR.elbow, legL: lL.leg, legR: lR.leg, shinL: lL.shin, shinR: lR.shin };
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
  let playerAgent = null, playerGoal = null, walkingEnabled = false, homeResident = null, homeScheduledVisible = false;
  let homeVisitActive = false;
  let teamSink = null;       // while set, every new agent is also added to this office's team list
  let aboutAgent = null;     // the "About me" person
  function makeAgent(person, parent, o) {
    parent.add(person.group);
    const h0 = o.face ? -Math.atan2(o.face[1], o.face[0]) : (o.heading || 0);
    const a = {
      p: person, ground: o.ground || (() => 0), steps: o.steps, i: 0, timer: 0, speed: o.speed || 0.9,
      x: o.x || 0, z: o.z || 0, heading: h0, want: h0, wp: 0, ph: (agents.length * 1.7) % TAU, pose: 'idle',
      hidden: !!o.hidden, carry: false, tick: o.tick || null, shift: o.shift || null,
      nightHome: o.nightHome || (o.shift === 'day' && parent !== W ? [0, 5.5] : null),
      offShift: false, daySchedule: null, cur: {},
    };
    JOINTS.forEach((j) => { a.cur[j] = 0; });
    agents.push(a);
    if (teamSink) teamSink.push(a);
    advanceAgent(a, 0.0001, 0);
    applyPose(a, 1, 0, true);
    placeAgent(a, 0);
    animators.push((dt, t) => {
      const asleep = (a.shift === 'day' && nightAmount >= 0.5) || (a.shift === 'night' && nightAmount < 0.5);
      if (a.shift === 'day' && asleep && !a.offShift) {
        a.offShift = true;
        if (a.nightHome) {
          a.daySchedule = { steps: a.steps, i: a.i, timer: a.timer, pose: a.pose };
          a.steps = [{ go: a.nightHome }, { do: (agent) => { agent.hidden = true; } }, { wait: Infinity }];
          a.i = 0; a.timer = 0; a.hidden = false;
        } else {
          a.hidden = true;
        }
      } else if (a.shift === 'day' && !asleep && a.offShift) {
        if (a.daySchedule) {
          a.steps = a.daySchedule.steps; a.i = a.daySchedule.i;
          a.timer = a.daySchedule.timer; a.pose = a.daySchedule.pose;
          a.daySchedule = null;
        }
        a.hidden = false;
        a.offShift = false;
      }
      if (asleep) {
        if (a.shift === 'day' && a.nightHome && !a.hidden) {
          advanceAgent(a, dt, t);
          applyPose(a, dt, t, false);
        } else {
          a.hidden = true;
        }
        placeAgent(a, dt);
        return;
      }
      advanceAgent(a, dt, t); applyPose(a, dt, t, false); placeAgent(a, dt);
    });
    return a;
  }
  function drive(a, steps) { a.steps = steps.concat([{ wait: Infinity, pose: 'idle' }]); a.i = 0; a.timer = 0; }
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
    [-0.58, 0.58].forEach((wx) => {
      const win = box(g, 0.3, 0.28, 0.04, wx, 0.58, 0.76, '#bfe4ff', { emissive: '#9fd8ff', emissiveIntensity: 0.08 });
      houseWindowMats.push(win.material);
    });
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

  // (The old Nexora tower used to stand here. Nexora AI now has its own office, built below.)

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
    for (let i = 0; i < 9; i++) {
      const x = -1.5 + i * 0.5;
      if (x > 0 && x < 1) continue;
      box(g, 0.07, 0.42, 0.07, x, 0.21, 2.95, '#b9825f');
    }
    [-0.2, 1.8].forEach((x) => {
      box(g, 1.6, 0.05, 0.05, x, 0.33, 2.95, '#c9966f');
      box(g, 1.6, 0.05, 0.05, x, 0.16, 2.95, '#c9966f');
    });
    [-0.02, 1.02].forEach((x) => box(g, 0.12, 1.35, 0.12, x, 0.68, 2.95, '#8a5a44'));
    box(g, 1.12, 0.12, 0.16, 0.5, 1.38, 2.95, '#e8b23a');
    box(g, 0.9, 0.05, 0.12, 0.5, 1.46, 2.95, '#fff1dc');

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
    let planeOrbit = 0;
    animators.push((dt, t) => {
      flag.rotation.x = -0.4 + Math.sin(t * 2) * 0.25;
      if (nightAmount < 0.5) planeOrbit += dt * 0.7;
      const a = planeOrbit;
      planeG.position.set(10.8 + Math.cos(a) * 1.2, 2.2 + Math.sin(t * 1.6) * 0.15, 6.6 + Math.sin(a) * 1.2);
      planeG.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a));
    });

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
    const lampGlow = glow(lamp, 0xffd36e, 1.1, 0.08, 0.16, 0.98, 0);
    bulbGlows.push(lampGlow);
    nightGlows.push({ material: lampGlow.material, dayOpacity: 0.08, nightOpacity: 0.9 });
  }
  const houseV1 = { value: null };

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
      if (nightAmount >= 0.5) return;
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
    animators.push((dt, t) => bulbGlows.forEach((b, i) => { b.material.opacity = nightAmount >= 0.5 ? 0.82 + Math.sin(t * 2 + i) * 0.08 : 0.08; }));
    animators.push((dt) => doors.forEach((d) => { d.open += (d.target - d.open) * Math.min(1, dt * 4); d.pivot.rotation.y = -1.4 * d.open; }));
  });

  /* ---------------------------------------------------------------- */
  /* 6.5 the airport: the plane takes off, flies a lap and lands       */
  /* ---------------------------------------------------------------- */
  await stage(0.63, 'Building the airport', () => {
    const RUNWAY_Z = AIRPORT.z0 + 5.5;
    const RX0 = AIRPORT.x0 + 1.2, RX1 = AIRPORT.x1 - 4.0;

    slab(W, (RX0 + RX1) / 2, RUNWAY_Z, RX1 - RX0 + 2.6, 5.2, '#5fda8a', 0.02, 0.04);
    slab(W, (RX0 + RX1) / 2, RUNWAY_Z, RX1 - RX0 + 2, 4.3, '#4a4766', 0.035, 0.06);
    const dashN = 14, rd = new THREE.InstancedMesh(geo('box', () => new THREE.BoxGeometry(1, 1, 1)), new THREE.MeshLambertMaterial({ color: '#fff1dc' }), dashN);
    const dd = new THREE.Object3D();
    for (let i = 0; i < dashN; i++) {
      dd.position.set(RX0 + 0.5 + i * ((RX1 - RX0 - 1) / (dashN - 1)), 0.07, RUNWAY_Z);
      dd.scale.set(0.38, 0.012, 0.12); dd.updateMatrix(); rd.setMatrixAt(i, dd.matrix);
    }
    W.add(rd);
    for (let end = 0; end < 2; end++) {
      const x = end ? RX1 - 0.25 : RX0 + 0.25;
      for (let i = 0; i < 6; i++) slab(W, x, RUNWAY_Z - 1.65 + i * 0.66, 0.32, 0.34, '#fff1dc', 0.07, 0.025);
    }
    const runwayLamps = [];
    [RUNWAY_Z - 2.35, RUNWAY_Z + 2.35].forEach((z) => {
      for (let i = 0; i < 17; i++) {
        const x = RX0 + i * ((RX1 - RX0) / 16);
        const lamp = ball(W, 0.07, x, 0.14, z, '#bfe4ff', { emissive: '#9fd8ff', emissiveIntensity: 0.8 });
        lamp.castShadow = false; runwayLamps.push(glow(W, '#9fd8ff', 0.45, 0.12, x, 0.18, z));
      }
    });
    runwayLamps.forEach((g) => nightGlows.push({ material: g.material, dayOpacity: 0.03, nightOpacity: 0.9 }));

    // Taxiway, apron, and terminal-side parking.
    slab(W, RX1 - 1.0, RUNWAY_Z + 2.9, 2.2, 6.1, '#87839a', 0.035, 0.055);
    slab(W, RX1 - 4.7, RUNWAY_Z + 5.6, 8.3, 5.1, '#77758a', 0.035, 0.06);
    for (let i = 0; i < 8; i++) {
      slab(W, RX1 - 8.2 + i * 1.0, RUNWAY_Z + 5.55, 0.55, 0.08, '#ffe08a', 0.075, 0.018);
    }
    slab(W, AIRPORT.x1 - 1.9, AIRPORT.z1 - 2.1, 4.8, 3.2, '#625f73', 0.035, 0.055);
    for (let i = 0; i < 5; i++) {
      slab(W, AIRPORT.x1 - 3.6 + i * 0.8, AIRPORT.z1 - 2.1, 0.045, 2.6, '#fff1dc', 0.07, 0.015);
    }
    // Low perimeter fencing, with a broad vehicle entrance along the south side.
    const fenceRail = (x0, z0, x1, z1) => {
      const length = Math.hypot(x1 - x0, z1 - z0), count = Math.ceil(length / 1.2);
      const angle = -Math.atan2(z1 - z0, x1 - x0);
      for (let i = 0; i <= count; i++) {
        const f = i / count;
        box(W, 0.08, 0.72, 0.08, lerp(x0, x1, f), 0.36, lerp(z0, z1, f), '#8a84b8');
      }
      [0.2, 0.55].forEach((y) => {
        const rail = box(W, length, 0.035, 0.035, (x0 + x1) / 2, y, (z0 + z1) / 2, '#b8b4c9');
        rail.rotation.y = angle;
      });
    };
    fenceRail(AIRPORT.x0, AIRPORT.z0, AIRPORT.x1, AIRPORT.z0);
    fenceRail(AIRPORT.x0, AIRPORT.z0, AIRPORT.x0, AIRPORT.z1);
    fenceRail(AIRPORT.x1, AIRPORT.z0, AIRPORT.x1, AIRPORT.z1);
    fenceRail(AIRPORT.x0, AIRPORT.z1, AIRPORT.x1 - 7.0, AIRPORT.z1);
    fenceRail(AIRPORT.x1 - 3.0, AIRPORT.z1, AIRPORT.x1, AIRPORT.z1);

    const term = new THREE.Group(); term.position.set(RX1 - 1.6, 0, AIRPORT.z1 - 1.8); W.add(term);
    box(term, 4.6, 1.7, 2.0, 0, 0.85, 0, '#eae6ff');
    box(term, 4.9, 0.14, 2.4, 0, 1.75, 0, '#4b3fa6');
    box(term, 4.2, 1.15, 0.045, 0, 0.92, 1.02, '#bfe4ff', { transparent: true, opacity: 0.48, depthWrite: false, emissive: '#2d5368', emissiveIntensity: 0.4 }).castShadow = false;
    [-1.4, -0.7, 0, 0.7, 1.4].forEach((x) => box(term, 0.045, 1.15, 0.07, x, 0.92, 1.05, '#fff1dc'));
    box(term, 5.35, 0.12, 1.0, 0, 1.88, 1.25, '#4b3fa6');
    [-2.3, 2.3].forEach((x) => box(term, 0.08, 0.48, 0.1, x, 1.61, 1.6, '#8a84b8'));
    box(term, 0.85, 0.2, 0.04, 0, 1.55, 1.08, '#241f4d');
    box(term, 5.2, 0.12, 3.2, 0, 1.95, -0.25, '#fff1dc');
    box(term, 1.65, 0.54, 0.08, 0, 1.38, 1.14, '#241f4d');
    box(term, 1.47, 0.07, 0.03, 0, 1.53, 1.19, '#ffe08a');
    [-0.45, 0.45].forEach((x) => box(term, 0.025, 0.25, 0.025, x, 1.31, 1.19, '#bfe4ff'));
    const airportSignTex = canvasTextureWH(512, 128, (g, w, h) => {
      g.fillStyle = '#241f4d'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffe08a'; g.font = '800 72px system-ui, "Segoe UI", Arial, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('AIRPORT', w / 2, h / 2);
    });
    const airportSign = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.62), new THREE.MeshBasicMaterial({ map: airportSignTex, fog: false }));
    airportSign.position.set(0, 1.35, 1.08); term.add(airportSign);
    const terminalGlow = glow(term, 0xffd36e, 2.8, 0.05, 0, 1.0, 1.4);
    nightGlows.push({ material: terminalGlow.material, dayOpacity: 0.04, nightOpacity: 0.85 });

    // Two parked aircraft with telescoping-looking passenger bridges.
    const parkedPlane = (x, z, color) => {
      const p = new THREE.Group(); p.position.set(x, 0.08, z); W.add(p);
      const fus = cyl(p, 0.13, 0.16, 1.65, 10, 0, 0.4, 0, '#fff8ec'); fus.rotation.z = Math.PI / 2;
      cone(p, 0.13, 0.42, 10, 0.98, 0.4, 0, '#fff8ec').rotation.z = -Math.PI / 2;
      box(p, 1.45, 0.045, 0.28, 0.04, 0.32, 0, color);
      box(p, 0.045, 0.12, 1.45, -0.12, 0.57, 0, color);
      box(p, 0.045, 0.32, 0.4, -0.7, 0.55, 0, color);
      box(p, 0.36, 0.08, 0.13, 0.7, 0.46, 0, '#bfe4ff', { emissive: '#9fd8ff', emissiveIntensity: 0.45 });
      return p;
    };
    parkedPlane(RX1 - 7.6, RUNWAY_Z + 4.8, '#8f7fe6');
    parkedPlane(RX1 - 4.2, RUNWAY_Z + 4.8, '#4fd1e0');
    [-5.4, -2.0].forEach((x) => {
      box(term, 0.42, 0.18, 5.1, x, 1.15, -0.45, '#b7b3c8');
      box(term, 0.055, 0.52, 5.1, x - 0.2, 1.46, -0.45, '#bfe4ff', { transparent: true, opacity: 0.45, depthWrite: false });
      box(term, 0.055, 0.52, 5.1, x + 0.2, 1.46, -0.45, '#bfe4ff', { transparent: true, opacity: 0.45, depthWrite: false });
      cyl(term, 0.045, 0.045, 0.95, 6, x, 0.55, -0.45, '#8a84b8');
    });

    const ctrl = new THREE.Group(); ctrl.position.set(1.55, 0, -0.1); term.add(ctrl);
    cyl(ctrl, 0.34, 0.52, 3.2, 8, 0, 1.6, 0, '#8a84b8');
    box(ctrl, 1.05, 0.72, 0.95, 0, 3.55, 0, '#4fd1e0', { transparent: true, opacity: 0.45, depthWrite: false });
    box(ctrl, 1.2, 0.12, 1.1, 0, 3.98, 0, '#4b3fa6');
    const beacon = ball(ctrl, 0.1, 0, 4.14, 0, '#ff4d4d', { emissive: '#ff2d2d', emissiveIntensity: 1 }); beacon.castShadow = false;
    const beaconGlow = glow(ctrl, 0xff4d4d, 1.3, 0.08, 0, 4.14, 0);
    nightGlows.push({ material: beaconGlow.material, dayOpacity: 0.08, nightOpacity: 0.95 });
    const beaconRotor = new THREE.Group(); beaconRotor.position.y = 4.14; ctrl.add(beaconRotor);
    box(beaconRotor, 0.75, 0.025, 0.04, 0.38, 0, 0, '#ff4d4d', { emissive: '#ff2d2d', emissiveIntensity: 0.9 });
    // Fuel service and luggage carts parked beside the apron.
    const truck = new THREE.Group(); truck.position.set(RX1 - 0.2, 0, RUNWAY_Z + 5.3); W.add(truck);
    box(truck, 1.05, 0.42, 0.48, 0, 0.32, 0, '#ff6b5e');
    box(truck, 0.42, 0.34, 0.44, 0.22, 0.67, 0, '#bfe4ff');
    box(truck, 0.9, 0.08, 0.4, -0.62, 0.46, 0, '#fff1dc');
    [[-0.34, -0.25], [-0.34, 0.25], [0.32, -0.25], [0.32, 0.25]].forEach(([x, z]) => {
      const wheel = cyl(truck, 0.12, 0.12, 0.09, 8, x, 0.12, z, '#2b2850'); wheel.rotation.x = Math.PI / 2;
    });
    for (let i = 0; i < 2; i++) {
      const cart = new THREE.Group(); cart.position.set(RX1 - 1.5 - i * 1.1, 0.04, RUNWAY_Z + 3.9); W.add(cart);
      box(cart, 0.62, 0.08, 0.38, 0, 0.36, 0, '#e8b23a');
      box(cart, 0.06, 0.38, 0.06, -0.27, 0.54, 0, '#8a5a44');
      box(cart, 0.06, 0.38, 0.06, 0.27, 0.54, 0, '#8a5a44');
      box(cart, 0.5, 0.28, 0.3, 0, 0.52, 0, i ? '#ff9f43' : '#8f7fe6');
      [-0.2, 0.2].forEach((x) => {
        const wheel = cyl(cart, 0.07, 0.07, 0.06, 8, x, 0.1, 0.2, '#2b2850'); wheel.rotation.x = Math.PI / 2;
      });
    }

    const sock = new THREE.Group(); sock.position.set(RX0 - 0.6, 0, RUNWAY_Z + 3.1); W.add(sock);
    cyl(sock, 0.03, 0.03, 1.6, 6, 0, 0.8, 0, '#8a84b8');
    const cloth = cone(sock, 0.16, 0.6, 8, 0, 1.55, 0, '#ff6b5e'); cloth.rotation.z = Math.PI / 2;

    // the aeroplane: planeRoot turns (yaw), plane tilts (pitch/bank)
    const planeRoot = new THREE.Group(); W.add(planeRoot);
    const plane = new THREE.Group(); planeRoot.add(plane);
    const fuse = cyl(plane, 0.16, 0.2, 2.0, 10, 0, 0.5, 0, '#fff8ec'); fuse.rotation.z = Math.PI / 2;
    cone(plane, 0.16, 0.5, 10, 1.2, 0.5, 0, '#fff8ec').rotation.z = -Math.PI / 2;
    box(plane, 0.04, 0.18, 1.9, -0.1, 0.72, 0, '#8f7fe6');
    box(plane, 0.04, 0.5, 0.5, -0.85, 0.72, 0, '#8f7fe6');
    box(plane, 1.9, 0.05, 0.3, 0.1, 0.46, 0, '#8f7fe6');
    [0.55, -0.55].forEach((wz) => { cyl(plane, 0.06, 0.06, 0.3, 8, 0.3, 0.3, wz, '#2b2850').rotation.x = Math.PI / 2; });
    box(plane, 0.5, 0.1, 0.16, 0.9, 0.56, 0, '#bfe4ff', { emissive: '#9fd8ff', emissiveIntensity: 0.3 });

    // flight path: lift off at the east end, one big lap over the island, final approach from the west
    const flyPts = [
      [RX1 - 0.7, 0.07, RUNWAY_Z], [RX1 + 3.5, 2.2, RUNWAY_Z], [-14, 5.5, -4], [0, 9, -2], [14, 11.5, 6], [22, 13, 20],
      [12, 13.5, 34], [-8, 13.5, 39], [-27, 13, 33], [-41, 12, 17], [-46, 9.5, 2], [-42, 6, -6], [-38, 3.2, RUNWAY_Z],
      [RX0 - 1.2, 0.9, RUNWAY_Z], [RX0 + 0.4, 0.09, RUNWAY_Z],
    ];
    const flyCurve = new THREE.CatmullRomCurve3(flyPts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
    const flyLen = flyCurve.getLength();
    const fp = new THREE.Vector3(), ft = new THREE.Vector3();
    const AP = { ph: 'wait', t: 0, x: RX0 + 0.6, v: 0, u: 0, yaw: 0, pitch: 0, bank: 0, lastYaw: 0 };
    const place = (y = 0.05) => { planeRoot.position.set(AP.x, y, RUNWAY_Z); planeRoot.rotation.y = AP.yaw; plane.rotation.set(AP.bank, 0, AP.pitch); };
    place();

    animators.push((dt, t) => {
      if (nightAmount >= 0.5) {
        AP.ph = 'wait'; AP.t = 0; AP.v = 0; AP.x = RX0 + 0.6; AP.yaw = 0; AP.pitch = 0; AP.bank = 0; place();
        beaconRotor.rotation.y += dt * 0.8;
        beaconGlow.material.opacity = 0.75 + (Math.sin(t * 6) > 0.6 ? 0.2 : 0);
        beacon.visible = Math.sin(t * 6) > 0;
        return;
      }
      AP.t += dt;
      const sm = Math.min(1, dt * 5);
      switch (AP.ph) {
        case 'wait':
          AP.yaw = 0; AP.pitch += (0 - AP.pitch) * sm; AP.bank += (0 - AP.bank) * sm; place();
          if (AP.t > 5) { AP.ph = 'roll'; AP.t = 0; AP.v = 0; }
          break;
        case 'roll': {                                         // take-off run
          AP.v += 1.2 * dt; AP.x += AP.v * dt;
          const lift = clamp((AP.x - (RX1 - 2.4)) / 1.7, 0, 1);
          AP.pitch += (0.22 * lift - AP.pitch) * sm; place(0.05 + lift * 0.08);
          if (AP.x >= RX1 - 0.7) { AP.ph = 'fly'; AP.u = 0; AP.t = 0; AP.lastYaw = 0; }
          break;
        }
        case 'fly': {                                          // the lap
          AP.u = Math.min(1, AP.u + (Math.max(4.4, AP.v) * dt) / flyLen);
          flyCurve.getPointAt(AP.u, fp); flyCurve.getTangentAt(AP.u, ft);
          const yaw = -Math.atan2(ft.z, ft.x), pitch = Math.atan2(ft.y, Math.hypot(ft.x, ft.z));
          let dy = Math.atan2(Math.sin(yaw - AP.lastYaw), Math.cos(yaw - AP.lastYaw)); AP.lastYaw = yaw;
          const bankT = clamp((dy / Math.max(dt, 0.001)) * 0.9, -0.5, 0.5);
          AP.yaw = yaw; AP.pitch += (pitch - AP.pitch) * sm; AP.bank += (bankT - AP.bank) * Math.min(1, dt * 3);
          AP.x = fp.x; planeRoot.position.set(fp.x, Math.max(0.05, fp.y), fp.z); planeRoot.rotation.y = AP.yaw; plane.rotation.set(AP.bank, 0, AP.pitch);
          if (AP.u >= 1) { AP.ph = 'land'; AP.t = 0; AP.v = 3.6; AP.x = RX0 + 0.4; AP.yaw = 0; }
          break;
        }
        case 'land':                                           // touch-down and braking
          AP.v = Math.max(0, AP.v - 1.0 * dt); AP.x += AP.v * dt;
          AP.pitch += (0 - AP.pitch) * sm; AP.bank += (0 - AP.bank) * sm; place();
          if (AP.v <= 0.05) { AP.ph = 'park'; AP.t = 0; }
          break;
        case 'park':
          if (AP.t > 2.5) { AP.ph = 'turnA'; AP.t = 0; }
          break;
        case 'turnA': {                                        // turn round
          const k = smoothstep(0, 1.6, AP.t); AP.yaw = Math.PI * k; place();
          if (AP.t >= 1.6) { AP.ph = 'taxi'; AP.t = 0; }
          break;
        }
        case 'taxi':                                           // roll back to the start
          AP.x -= 1.3 * dt; AP.yaw = Math.PI; place();
          if (AP.x <= RX0 + 0.6) { AP.x = RX0 + 0.6; AP.ph = 'turnB'; AP.t = 0; }
          break;
        case 'turnB': {
          const k = smoothstep(0, 1.6, AP.t); AP.yaw = Math.PI * (1 - k); place();
          if (AP.t >= 1.6) { AP.yaw = 0; AP.ph = 'wait'; AP.t = 0; }
          break;
        }
        default: break;
      }
      beaconGlow.material.opacity = 0.4 + (Math.sin(t * 6) > 0.6 ? 0.5 : 0);
      beacon.visible = Math.sin(t * 6) > 0;
      sock.rotation.y = Math.sin(t * 0.6) * 0.3;
    });
  });

  /* ---------------------------------------------------------------- */
  /* 6.6 the circular railway: a track right round the island          */
  /* ---------------------------------------------------------------- */
  await stage(0.65, 'Laying the circular railway', () => {
    const SLEEPERS = simple ? 180 : 360;
    const flat = (r0, r1, y, color) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 192, 1), new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.position.y = y; m.receiveShadow = true; W.add(m); return m;
    };
    flat(TRACK_R - 0.78, TRACK_R + 0.78, 0.03, '#9c966f');           // gravel bed
    flat(TRACK_R - 0.22, TRACK_R - 0.15, 0.075, '#b8b2e0');           // rails
    flat(TRACK_R + 0.15, TRACK_R + 0.22, 0.075, '#b8b2e0');

    const sl = new THREE.InstancedMesh(geo('box', () => new THREE.BoxGeometry(1, 1, 1)), new THREE.MeshLambertMaterial({ color: '#8a5a44' }), SLEEPERS);
    const d = new THREE.Object3D();
    for (let i = 0; i < SLEEPERS; i++) {
      const a = (i / SLEEPERS) * TAU;
      d.position.set(Math.cos(a) * TRACK_R, 0.055, Math.sin(a) * TRACK_R); d.rotation.set(0, -(a + Math.PI / 2), 0);
      d.scale.set(0.14, 0.03, 0.62); d.updateMatrix(); sl.setMatrixAt(i, d.matrix);
    }
    W.add(sl);

    // station: group origin sits on the track centre line; local +z points to the island centre
    const sx = Math.cos(STATION_A) * TRACK_R, sz = Math.sin(STATION_A) * TRACK_R;
    const st = new THREE.Group(); st.position.set(sx, 0, sz); st.rotation.y = -(STATION_A + Math.PI / 2); W.add(st);
    box(st, 16.0, 0.18, 2.5, 0, 0.09, 1.75, '#e4def7');
    box(st, 15.4, 0.035, 0.24, 0, 0.205, 0.62, '#e8b23a');
    for (let i = 0; i < 62; i++) box(st, 0.12, 0.04, 0.12, -7.2 + i * 0.235, 0.21, 0.9, '#fff1dc').castShadow = false;
    box(st, 16.0, 0.02, 0.12, 0, 0.19, 0.53, '#e8b23a').castShadow = false;
    box(st, 5.4, 2.0, 2.2, -0.8, 1.0, 4.0, '#fff1dc');
    box(st, 5.8, 0.16, 2.6, -0.8, 2.08, 3.8, '#4fae7a');
    box(st, 4.7, 1.25, 0.05, -0.8, 1.05, 5.12, '#bfe4ff', { transparent: true, opacity: 0.46, depthWrite: false });
    box(st, 0.12, 1.25, 0.06, -0.8, 1.05, 5.16, '#fff1dc');
    box(st, 0.9, 1.15, 0.06, -2.7, 0.65, 5.16, '#6c58cf');
    box(st, 14.0, 0.12, 3.8, 0, 2.65, 1.85, '#4b3fa6');
    [-6.5, -3.3, 0, 3.3, 6.5].forEach((x) => cyl(st, 0.06, 0.08, 2.45, 6, x, 1.3, 1.85, '#8a84b8'));
    const nameTex = canvasTextureWH(512, 128, (g, w, h) => {
      g.fillStyle = '#241f4d'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffe08a'; g.fillRect(0, h - 10, w, 10);
      g.fillStyle = '#ffffff'; g.font = '800 54px system-ui, "Segoe UI", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('KANHWA STATION', w / 2, h / 2 - 4);
    });
    const makeStationSign = (width, height, x, y, z) => {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: nameTex, fog: false, side: THREE.DoubleSide }));
      sign.position.set(x, y, z); st.add(sign); return sign;
    };
    makeStationSign(3.2, 0.8, -0.8, 2.75, 5.34);
    makeStationSign(2.6, 0.65, -6.0, 2.55, 1.6);
    makeStationSign(2.6, 0.65, 6.0, 2.55, 1.6);
    box(st, 2.6, 0.9, 0.12, 5.8, 2.0, 4.95, '#241f4d');
    box(st, 2.28, 0.07, 0.03, 5.8, 2.27, 5.03, '#ffe08a');
    [-0.24, 0.03, 0.30].forEach((y) => box(st, 1.55, 0.035, 0.03, 5.75, 1.93 + y, 5.03, '#bfe4ff'));
    [-2.4, 0.9, 2.5].forEach((x) => cyl(st, 0.04, 0.04, 1.2, 6, x, 0.76, 1.1, '#8a84b8'));
    [[-4.8, 1.4], [-2.8, 1.4], [2.8, 1.4], [4.8, 1.4]].forEach(([x, z]) => {
      box(st, 1.0, 0.05, 0.3, x, 0.34, z, '#c9966f'); box(st, 1.0, 0.3, 0.04, x, 0.5, z + 0.15, '#2b2850');
    });
    // Platform clock and a pedestrian footbridge crossing the railway.
    cyl(st, 0.35, 0.35, 0.08, 16, 2.4, 2.25, 4.95, '#fff1dc').rotation.x = Math.PI / 2;
    box(st, 0.08, 0.52, 0.05, 2.4, 2.25, 5.0, '#241f4d');
    box(st, 0.42, 0.06, 0.05, 2.5, 2.4, 5.0, '#241f4d');
    box(st, 0.8, 0.14, 7.8, -7.2, 3.2, -0.1, '#c9c2ea');
    box(st, 0.08, 0.72, 7.8, -7.2, 3.63, -0.1, '#8a84b8');
    [-7.65, -6.75].forEach((x) => box(st, 0.05, 0.7, 7.8, x, 3.6, -0.1, '#8a84b8'));
    box(st, 1.1, 0.12, 2.8, -7.2, 1.55, 4.0, '#c9c2ea').rotation.x = -0.52;
    box(st, 1.1, 0.12, 2.8, -7.2, 1.55, -4.2, '#c9c2ea').rotation.x = 0.52;
    const signalPost = cyl(st, 0.035, 0.04, 1.55, 6, 8.2, 0.78, -0.4, '#2b2850');
    ball(st, 0.1, 8.2, 1.48, -0.4, '#ff4d4d', { emissive: '#ff2d2d', emissiveIntensity: 1 });
    ball(st, 0.1, 8.2, 1.2, -0.4, '#5dff9a', { emissive: '#2dff7a', emissiveIntensity: 1 });
    const signalGlow = glow(st, 0xff4d4d, 0.8, 0.08, 8.2, 1.48, -0.4);
    nightGlows.push({ material: signalGlow.material, dayOpacity: 0.03, nightOpacity: 0.95 });
    const stGlow = glow(st, 0xffd36e, 1.0, 0.5, 0.1, 1.25, 1.5);

    // a passenger waits on the platform and watches the track
    const px = sx * (TRACK_R - 1.75) / TRACK_R, pz = sz * (TRACK_R - 1.75) / TRACK_R;
    const tgx = -Math.sin(STATION_A), tgz = Math.cos(STATION_A);
    const passengers = [
      { x: px + tgx * 2.2, z: pz + tgz * 2.2, shirt: '#e8b23a' },
      { x: px - tgx * 2.4, z: pz - tgz * 2.4, shirt: '#5ac8c8' },
      { x: px + tgx * 4.5, z: pz + tgz * 4.5, shirt: '#ff6b5e' },
    ];
    passengers.forEach((p, i) => {
      const passenger = makePerson({ shirt: p.shirt, pants: '#2b2850', hair: i % 2 ? '#241f4d' : '#7a4a32', skin: '#f6d2b4', hairStyle: i % 2 ? 'short' : 'pony', shoes: '#8a5a44' });
      makeAgent(passenger, W, { x: p.x, z: p.z, face: [Math.cos(STATION_A), Math.sin(STATION_A)], ground: () => 0.16, shift: 'day', steps: [{ wait: Infinity, pose: 'idle' }] });
    });

    // the train: four carriages that follow the ring and stop at the station
    const GAP = 1.78 / TRACK_R, cars = [];
    function carriage(color, loco) {
      const c = new THREE.Group(); W.add(c);
      box(c, 1.6, 0.55, 0.78, 0, 0.5, 0, color);
      box(c, 1.6, 0.14, 0.82, 0, 0.82, 0, '#241f4d');
      if (loco) { box(c, 0.3, 0.3, 0.86, 0.8, 0.95, 0, '#241f4d'); box(c, 0.1, 0.12, 0.3, 0.95, 1.0, 0, '#ffe08a', { emissive: '#ffd36e', emissiveIntensity: 1 }); }
      for (let i = -1; i <= 1; i += 2) { box(c, 0.3, 0.2, 0.03, i * 0.5, 0.6, 0.4, '#bfe4ff', { emissive: '#9fd8ff', emissiveIntensity: 0.25 }); box(c, 0.3, 0.2, 0.03, i * 0.5, 0.6, -0.4, '#bfe4ff', { emissive: '#9fd8ff', emissiveIntensity: 0.25 }); }
      [[-0.5, 0.41], [0.5, 0.41], [-0.5, -0.41], [0.5, -0.41]].forEach(([wx, wz]) => { const w = cyl(c, 0.14, 0.14, 0.08, 10, wx, 0.14, wz, '#2b2850'); w.rotation.x = Math.PI / 2; });
      cars.push(c);
    }
    carriage('#ff6b5e', true); carriage('#5ac8c8'); carriage('#8f7fe6'); carriage('#e8b23a');
    const TR = { th: STATION_A - 0.5, dwell: 0, passed: false };
    animators.push((dt, t) => {
      if (nightAmount >= 0.5) {
        TR.th = STATION_A + GAP * 1.5; TR.dwell = 4.5; TR.passed = true;
        cars.forEach((c, i) => {
          const a = TR.th - i * GAP;
          c.position.set(Math.cos(a) * TRACK_R, 0.06, Math.sin(a) * TRACK_R);
          c.rotation.y = -(a + Math.PI / 2);
        });
        stGlow.material.opacity = 0.9;
        return;
      }
      const mid = TR.th - GAP * 1.5;                                    // middle of the train
      const dAng = Math.atan2(Math.sin(mid - STATION_A), Math.cos(mid - STATION_A));
      let sp = 3.4 / TRACK_R;
      if (TR.dwell > 0) { TR.dwell -= dt; sp = 0; }
      else {
        const ad = Math.abs(dAng);
        sp *= clamp(0.1 + ad / 0.2, 0.1, 1);                            // slow down into the station, speed up again after
        if (ad < 0.004 && !TR.passed) { TR.dwell = 4.5; TR.passed = true; }
        if (ad > 0.3) TR.passed = false;
      }
      TR.th += sp * dt;
      cars.forEach((c, i) => {
        const a = TR.th - i * GAP;
        c.position.set(Math.cos(a) * TRACK_R, 0.06, Math.sin(a) * TRACK_R);
        c.rotation.y = -(a + Math.PI / 2);
      });
      stGlow.material.opacity = nightAmount >= 0.5 ? 0.9 : 0.12 + Math.sin(t * 2) * 0.04;
    });
  });
/* ---------------------------------------------------------------- */
  /* 7. project office buildings (smaller, with glass cabins inside)   */
  /* ---------------------------------------------------------------- */
  const HQ = { x: -6.0, z: 18.0 };
  const HQ2 = { x: -15.5, z: 9.0 };
  const HQ3 = { x: 24.0, z: -4.0 };
  const FLOOR = 0.14;
  const companyCfg = (id) => ((config.companies || {})[id]) || {};

  function buildOfficeHQ(o) {
    const H = new THREE.Group(); H.position.set(o.x, 0, o.z); H.scale.setScalar(OFFICE_SCALE); W.add(H);
    const gate = { pos: 0, target: 0 };
    const visitOccluders = [];
    const myMonitors = [];                              // only THIS office's screens
    const windowMaterials = [];
    const cabinGlows = [];
    const officeLights = [];
    [[-3.1, 2.0], [-0.7, -0.6], [2.0, -0.6]].forEach(([x, z]) => {
      const light = new THREE.PointLight('#fff8ed', 0, 8.5, 1.4);
      light.position.set(x, 2.15, z);
      H.add(light);
      officeLights.push(light);
    });
    const founderDoor = new THREE.Group();
    founderDoor.position.set(-1.6, 0, 2.45);
    H.add(founderDoor);
    box(founderDoor, 0.04, 0.98, 0.9, 0, 0.55, -0.45, '#bfe4ff', { transparent: true, opacity: 0.35, depthWrite: false });
    box(founderDoor, 0.07, 0.06, 0.06, -0.05, 0.58, -0.78, o.accent);
    let founderDoorAngle = 0;
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
    const mainDoor = bx(0.9, 1.05, 0.05, 0, 0.7, 0.6, o.accent, { transparent: true, opacity: 0.35, depthWrite: false }); mainDoor.castShadow = false;
    let doorPos = 0;
    for (let i = 0; i < 5; i++) bx(0.16, 1.3, 0.16, -3.65 + i * 1.825, 0.79, 0.58, '#fff8ec');
    bx(7.8, 0.14, 4.0, 0, 1.38, -1.2, '#fff8ec');
    bx(1.4, 0.08, 0.6, 0, 0.04, 0.95, '#d8d2ff');
    [-2.4, 0, 2.4].forEach((x) => bx(1.2, 0.04, 0.2, x, 1.34, -1.2, '#fffbe8', { emissive: '#fff3b0', emissiveIntensity: 0.9 }).castShadow = false);

    bx(7.4, 0.9, 3.5, 0, 1.9, -1.25, o.wallTint);
    bx(7.5, 0.06, 3.6, 0, 2.37, -1.25, o.accent);
    [-2.7, -1.35, 0, 1.35, 2.7].forEach((x) => windowMaterials.push(bx(0.9, 0.5, 0.03, x, 1.9, 0.52, '#9ff3ff', { emissive: o.accent2, emissiveIntensity: 0.08 }).material));
    [-2.2, -0.9].forEach((z) => { bx(0.03, 0.5, 0.9, -3.71, 1.9, z, '#9ff3ff', { emissive: o.accent2, emissiveIntensity: 0.45 }); bx(0.03, 0.5, 0.9, 3.71, 1.9, z, '#9ff3ff', { emissive: o.accent2, emissiveIntensity: 0.45 }); });
    bx(6.0, 0.8, 3.1, 0, 2.78, -1.45, '#2b2850');
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 0.534), signMat); sign.position.set(0, 2.78, 0.14); H.add(sign);
    bx(6.2, 0.1, 3.3, 0, 3.22, -1.45, '#3a2f5b');
    bx(2.9, 3.2, 2.7, 0, 4.95, -1.7, o.tower);
    [4.0, 4.75, 5.5, 6.25].forEach((y) => [-0.85, 0, 0.85].forEach((x) => bx(0.4, 0.38, 0.03, x, y, -0.3, '#9ff3ff', { emissive: o.accent2, emissiveIntensity: 0.7 })));
    bx(3.1, 0.16, 2.9, 0, 6.63, -1.7, '#241f4d');
    cyl(H, 0.04, 0.05, 0.8, 6, 0, 7.1, -1.7, '#d8d2ff');
    const orb = ball(H, 0.2, 0, 7.75, -1.7, o.accent, { emissive: o.accent, emissiveIntensity: 1 }); orb.castShadow = false;
    const orbGlow = glow(H, new THREE.Color(o.accent), 3.4, 0.7, 0, 7.75, -1.7);        // brand colour, not always pink
    const pulses = [0, 1].map((i) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, color: new THREE.Color(o.accentLight), transparent: true, depthWrite: false, fog: false }));
      s.position.set(0, 7.75, -1.7); H.add(s); return { s, off: i / 2 };
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

    // glass CABINS: one little room round every desk, each with its own colour frame
    [-0.95, 0.55].forEach((off, k) => {
      const xs = k === 0 ? DESK_X.map((x) => x + off) : [DESK_X[DESK_X.length - 1] + off];
      xs.forEach((x) => {
        const pane = bx(0.03, 0.85, 1.3, x, 0.57, -1.6, '#bfe4ff', { transparent: true, opacity: 0.3, depthWrite: false }); pane.castShadow = false;
        bx(0.05, 0.05, 1.3, x, 1.0, -1.6, o.accent).castShadow = false;
        bx(0.05, 0.85, 0.05, x, 0.57, -0.95, o.accent2).castShadow = false;
        bx(0.05, 0.85, 0.05, x, 0.57, -2.25, o.accent2).castShadow = false;
        cabinGlows.push(glow(H, o.accentLight, 0.62, 0.02, x, 1.05, -1.6));
      });
    });
    DESK_X.forEach((x, i) => {            // cabin number plates
      bx(0.34, 0.1, 0.03, x - 0.2, 0.96, -0.93, '#ffffff', { emissive: o.accent, emissiveIntensity: 0.25 }).castShadow = false;
    });

    [-0.9, 0.9].forEach((x) => {
      bx(0.2, 1.25, 0.2, x, 0.64, 3.2, '#fff1dc');
      bx(0.28, 0.1, 0.28, x, 1.28, 3.2, o.accent);
    });
    bx(2.0, 0.12, 0.16, 0, 1.38, 3.2, '#3a2f5b');
    const gateSign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.32), signMat); gateSign.position.set(0, 1.12, 3.33); H.add(gateSign);
    const gateSign2 = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.32), signMat); gateSign2.position.set(0, 1.12, 3.07); gateSign2.rotation.y = Math.PI; H.add(gateSign2);
    visitOccluders.push(gateSign, gateSign2);
    const makePanel = () => {
      const p = new THREE.Group(); H.add(p);
      box(p, 0.96, 0.54, 0.05, 0, 0.3, 0, '#3a2f5b');
      for (let k = -2; k <= 2; k++) box(p, 0.05, 0.54, 0.06, k * 0.19, 0.3, 0, o.accent);
      return p;
    };
    const gateL = makePanel(), gateR = makePanel();
    const lampRed = ball(H, 0.08, -1.05, 1.2, 3.3, '#ff4d4d', { emissive: '#ff2d2d', emissiveIntensity: 1 }); lampRed.castShadow = false;
    const lampGreen = ball(H, 0.08, -1.05, 1.2, 3.3, '#5dff9a', { emissive: '#2dff7a', emissiveIntensity: 1 }); lampGreen.castShadow = false;
    const lampGlow = glow(H, 0xff4d4d, 0.9, 0.6, -1.05, 1.2, 3.3);

    bx(0.9, 0.95, 0.85, 2.45, 0.48, 2.65, '#fff1dc');
    bx(1.1, 0.08, 1.05, 2.45, 1.0, 2.65, o.accent);
    glass(0.03, 0.5, 0.6, 2.0, 0.62, 2.65);
    [[3.9, 2.4], [3.4, 1.25]].forEach(([x, z], i) => {
      bx(0.9, 0.22, 0.5, x, 0.15, z, '#a9714f');
      ball(H, 0.3, x, 0.45, z, '#3fae7a'); ball(H, 0.1, x + 0.2, 0.7, z, ['#ff6b5e', '#ffe08a', '#ff9fb8'][i]);
    });

    // details signboard in front of the office (text comes from config.companies)
    const det = companyCfg(o.id).details;
    if (det && det.length) {
      const btex = canvasTextureWH(768, 512, (g, w, h) => {
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
        g.fillStyle = o.tower; g.fillRect(0, 0, w, 112);
        g.fillStyle = o.accent; g.fillRect(0, 108, w, 8);
        g.textBaseline = 'middle';
        let fs = 54; g.font = `800 ${fs}px system-ui, "Segoe UI", Arial, sans-serif`;
        const title = o.nameA + ' ' + o.nameB;
        while (g.measureText(title).width > w - 60 && fs > 28) { fs -= 2; g.font = `800 ${fs}px system-ui, "Segoe UI", Arial, sans-serif`; }
        g.fillStyle = '#ffffff'; g.fillText(title, 30, 58);
        det.slice(0, 6).forEach((line, i) => {
          const y = 172 + i * 62; let f = 36;
          g.font = `600 ${f}px system-ui, "Segoe UI", Arial, sans-serif`;
          while (g.measureText(line).width > w - 110 && f > 20) { f -= 2; g.font = `600 ${f}px system-ui, "Segoe UI", Arial, sans-serif`; }
          g.fillStyle = o.accent; g.beginPath(); g.arc(46, y, 9, 0, TAU); g.fill();
          g.fillStyle = '#241f4d'; g.fillText(line, 72, y);
        });
      });
      const BX = -3.4, BZ = 3.75;
      [-0.85, 0.85].forEach((dx) => visitOccluders.push(bx(0.07, 1.0, 0.07, BX + dx, 0.5, BZ, '#8a5a44')));
      visitOccluders.push(bx(1.98, 1.34, 0.05, BX, 1.2, BZ - 0.04, '#2b2850'));
      const board = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.267), new THREE.MeshBasicMaterial({ map: btex, fog: false }));
      board.position.set(BX, 1.2, BZ - 0.01); H.add(board); visitOccluders.push(board);
    }

    animators.push((dt, t) => {
      const gateWant = gate.hold ? 1 : gate.target;
      gate.pos += (gateWant - gate.pos) * Math.min(1, dt * 2.2);
      doorPos += ((gate.hold ? 1 : 0) - doorPos) * Math.min(1, dt * 2.6);
      mainDoor.position.x = doorPos * 0.95; mainDoor.material.opacity = 0.35 * (1 - doorPos * 0.5);
      const ownerConversation = visit.active && visit.id === o.id && visit.ownerChat;
      founderDoor.visible = !ownerConversation;
      const founderDoorTarget = visit.active && visit.id === o.id && visit.atOwner ? Math.PI / 2 : 0;
      founderDoorAngle += (founderDoorTarget - founderDoorAngle) * Math.min(1, dt * 2.6);
      founderDoor.rotation.y = founderDoorAngle;
      gateL.position.set(-0.6 - 1.25 * gate.pos, 0, 3.32); gateR.position.set(0.6 + 1.25 * gate.pos, 0, 3.32);
      const open = gateWant > 0.5;
      lampRed.visible = !open; lampGreen.visible = open;
      lampGlow.material.color.set(open ? 0x5dff9a : 0xff4d4d);
      myMonitors.forEach((m, i) => { m.emissiveIntensity = 0.7 + Math.sin(t * 5 + i * 2) * 0.1 + (Math.sin(t * 17 + i) > 0.92 ? 0.25 : 0); });
      windowMaterials.forEach((m) => { m.emissiveIntensity = 0.08 + nightAmount * 1.2; });
      cabinGlows.forEach((g) => { g.material.opacity = 0.02 + nightAmount * 0.78; });
      officeLights.forEach((light) => { light.intensity = nightAmount * 6; });
      orbGlow.material.opacity = 0.55 + Math.sin(t * 3) * 0.2;
      orb.material.emissiveIntensity = 0.25 + nightAmount * 1.2;
      const windowIntensity = 0.35 + nightAmount * 0.8;
      pulses.forEach((p) => { const k = (t * 0.55 + p.off) % 1; p.s.scale.setScalar(0.6 + k * 3.4); p.s.material.opacity = (1 - k) * 0.8; });
    });

    // the ROOF group: everything above the ground floor. It lifts off while the office is visited.
    const roof = new THREE.Group(); H.add(roof);
    H.children.slice().forEach((c) => { if (c !== roof && (c.isMesh || c.isSprite) && c.position.y >= 1.3) roof.add(c); });
    cabinGlows.forEach((g) => roof.add(g));

    // ---- the FOUNDER'S OFFICE: a glass room in the front-left of the courtyard (Murari's own office)
    const fglass = (sx, sy, sz, x, z) => { const m = bx(sx, sy, sz, x, 0.58, z, '#bfe4ff', { transparent: true, opacity: 0.58, depthWrite: false }); m.castShadow = false; return m; };
    bx(3.0, 0.03, 2.05, -3.1, 0.05, 2.0, '#f3ecff').castShadow = false;
    fglass(0.04, 1.0, 2.05, -4.6, 2.0); fglass(3.0, 1.0, 0.04, -3.1, 0.98); fglass(3.0, 1.0, 0.04, -3.1, 3.02);
    fglass(0.04, 1.0, 0.55, -1.6, 1.27); fglass(0.04, 1.0, 0.55, -1.6, 2.73);
    [[-4.6, 0.98], [-4.6, 3.02], [-1.6, 0.98], [-1.6, 3.02], [-1.6, 1.55], [-1.6, 2.45]].forEach(([x, z]) => bx(0.07, 1.1, 0.07, x, 0.6, z, o.accent).castShadow = false);
    bx(0.07, 0.1, 0.97, -1.6, 1.12, 2.0, o.accent).castShadow = false;
    const founderTex = canvasTextureWH(768, 150, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#241f4d'); gr.addColorStop(1, o.tower);
      g.fillStyle = gr; g.fillRect(0, 0, w, h); g.fillStyle = o.accent; g.fillRect(0, h - 12, w, 12);
      g.fillStyle = '#ffffff'; g.textBaseline = 'middle'; g.font = '800 54px system-ui, "Segoe UI", Arial, sans-serif'; g.fillText("FOUNDER'S OFFICE", 28, 54);
      g.fillStyle = o.accentLight; g.font = '700 38px system-ui, "Segoe UI", Arial, sans-serif'; g.fillText('Murari Kumar', 30, 108);
    });
    const founderSign = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 0.283), new THREE.MeshBasicMaterial({ map: founderTex, side: THREE.DoubleSide, fog: false }));
    founderSign.position.set(-1.57, 1.3, 2.0); founderSign.rotation.y = Math.PI / 2; H.add(founderSign); visitOccluders.push(founderSign);
    bx(0.5, 0.05, 1.5, -4.35, 0.4, 2.0, '#a9714f');                                        // desk against the west wall
    [[-4.55, 1.3], [-4.55, 2.7], [-4.15, 1.3], [-4.15, 2.7]].forEach(([x, z]) => bx(0.04, 0.36, 0.04, x, 0.2, z, '#8a84b8'));
    bx(0.04, 0.3, 0.55, -4.45, 0.62, 2.0, '#241f4d'); bx(0.012, 0.24, 0.46, -4.42, 0.63, 2.0, '#9ff3ff', { emissive: o.accent2, emissiveIntensity: 0.7 });
    bx(0.5, 0.05, 0.5, -3.88, 0.26, 2.0, '#2b2850');
    bx(0.08, 0.55, 0.5, -4.04, 0.52, 2.0, '#2b2850');
    bx(1.1, 0.5, 0.18, -3.0, 0.32, 1.1, '#c9966f');                                                          // bookshelf on the north wall
    [-3.35, -3.15, -2.95, -2.75, -2.6].forEach((x, k) => bx(0.12, 0.2, 0.1, x, 0.5, 1.1, ['#ff6b5e', '#ffe08a', '#8f7fe6', '#4fae7a', o.accent][k]));
    ball(H, 0.22, -4.3, 0.35, 0.28 + 0.98, '#3fae7a'); bx(0.3, 0.2, 0.3, -4.3, 0.15, 1.26, '#a9714f');
    bx(0.5, 0.04, 0.01, -3.2, 0.9, 3.0, '#ffffff').castShadow = false;


    const cabinCeiling = bx(3.2, 0.05, 2.2, -3.1, 1.2, 2.0, '#fff8ec'); roof.add(cabinCeiling);
    const cabinGlow = glow(H, 0xfff3b0, 1.6, 0.08, -3.1, 1.05, 2.0); roof.add(cabinGlow);
    nightGlows.push({ material: cabinGlow.material, dayOpacity: 0.08, nightOpacity: 0.9 });
    return { H, gate, roof, visitOccluders, accent: o.accent, id: o.id, team: [] };
  }

  const offices = {};
  let astropulseHQ, healthgisHQ, nexoraHQ;
  await stage(0.68, 'Building the project offices', () => {
    astropulseHQ = buildOfficeHQ({
      id: 'astropulse', x: HQ.x, z: HQ.z, nameA: 'ASTROPULSE', nameB: 'SMM', accent: '#ff4fa3', accentLight: '#ff6fb5',
      accent2: '#4fd1e0', tower: '#4b3fa6', wallTint: '#eae6ff',
      deskColors: ['#9ff3ff', '#ffb3c7', '#ffe08a', '#b6ffcf'],
    });
    hqGroup = astropulseHQ.H;

    healthgisHQ = buildOfficeHQ({
      id: 'healthgis', x: HQ2.x, z: HQ2.z, nameA: 'HEALTHGIS', nameB: '.SITE.JE', accent: '#1fbf8f', accentLight: '#5be0b8',
      accent2: '#2e8bff', tower: '#0f6b52', wallTint: '#e6f7f1',
      deskColors: ['#bfe3ff', '#b7ffe6', '#fff0b3', '#d8ffcf'],
    });
    hq2Group = healthgisHQ.H;

    nexoraHQ = buildOfficeHQ({
      id: 'nexora', x: HQ3.x, z: HQ3.z, nameA: 'NEXORA', nameB: 'AI', accent: '#8f7fe6', accentLight: '#b3a4ff',
      accent2: '#5ac8c8', tower: '#4b3fa6', wallTint: '#ece9ff',
      deskColors: ['#c9bfff', '#9ff3ff', '#ffe08a', '#ff9fb8'],
    });
    hq3Group = nexoraHQ.H;
    offices.astropulse = astropulseHQ; offices.healthgis = healthgisHQ; offices.nexora = nexoraHQ;
  });

  /* ---------------------------------------------------------------- */
  /* 8. people: everybody gets a job                                   */
  /* ---------------------------------------------------------------- */
  const walkGround = (x, z) => terrainH(x, z) + 0.03;
  const cityGround = () => 0.06;
  const hqGround = (x, z) => (Math.abs(x) < 3.6 && z < 0.5 && z > -3.0 ? FLOOR : (x > -4.6 && x < -1.6 && z > 0.98 && z < 3.02 ? 0.06 : 0.045));
  const reversed = (list) => list.slice().reverse();
  const goList = (pts) => pts.map((p) => ({ go: p }));
  function DESK_X0(i) { return [-2.6, -1.1, 0.4, 1.9][i]; }

  await stage(0.8, 'Waking up the villagers', () => {
    const me = makePerson({ shirt: '#ff6b5e', pants: '#2b2850', hair: '#241f4d', backpack: '#e8b23a', skin: '#e9b48d', shoes: '#fff8ec' });
    aboutAgent = makeAgent(me, W, { x: -4.5, z: 7.4, heading: -Math.PI / 3, ground: () => 0, steps: [{ wait: Infinity, pose: 'talk' }] });

    const v1 = houseV1.value, mailStand = [9.7, 7.0];
    const homeLook = { shirt: '#ff6b5e', pants: '#2b2850', hair: '#241f4d', backpack: '#e8b23a', skin: '#e9b48d', shoes: '#fff8ec' };
    const homeStart = v1.frontPt;
    homeResident = makeAgent(makePerson(homeLook), W, {
      x: homeStart[0], z: homeStart[1], ground: cityGround, hidden: true,
      steps: [{ wait: Infinity, pose: 'talk', face: [0, 1] }],
    });
    const roadStart = roadSamples[Math.floor(roadSamples.length / 2)];
    playerAgent = makeAgent(makePerson({ ...homeLook, shirt: '#4fd1e0', backpack: '#8f7fe6' }), W, {
      x: roadStart.x, z: roadStart.z, ground: walkGround, speed: 2.0, hidden: true,
      steps: [{ wait: Infinity, pose: 'idle' }],
      tick: (agent) => {
        if (!playerGoal || Math.hypot(agent.x - playerGoal.x, agent.z - playerGoal.z) > 0.7) return;
        const arrived = playerGoal.id;
        playerGoal = null;
        if (arrived !== 'manual') onWalkArrive(arrived);
      },
    });
    playerAgent.p.group.scale.setScalar(2.15);
    const playerHalo = new THREE.Mesh(
      new THREE.RingGeometry(0.38, 0.48, 28),
      new THREE.MeshBasicMaterial({ color: '#4fd1e0', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
    );
    playerHalo.rotation.x = -Math.PI / 2;
    playerHalo.position.y = 0.025;
    playerAgent.p.group.add(playerHalo);

    const officeResident = makeAgent(makePerson(homeLook), astropulseHQ.H, {
      x: -4.3, z: 2.0, ground: hqGround, hidden: true,
      steps: [{ wait: Infinity, pose: 'talk', face: [1, 0] }],
    });
    const schedule = config.schedule || {};
    let lastScheduleMinute = -1;
    const scheduleClock = new Intl.DateTimeFormat('en-US', {
      timeZone: schedule.timeZone || 'Asia/Kolkata',
      hour: 'numeric',
      hourCycle: 'h23',
    });
    always.push(() => {
      const now = new Date();
      const minuteKey = Math.floor(now.getTime() / 60_000);
      if (minuteKey === lastScheduleMinute) return;
      const parts = scheduleClock.formatToParts(now);
      const hour = Number(parts.find((part) => part.type === 'hour')?.value);
      lastScheduleMinute = minuteKey;
      const officeStart = schedule.officeStart ?? 12;
      const officeEnd = schedule.officeEnd ?? 24;
      const homeStartHour = schedule.homeStart ?? 10;
      const atOffice = hour >= officeStart && hour < officeEnd;
      const atHome = hour >= homeStartHour && hour < officeStart;
      homeScheduledVisible = atHome;
      homeResident.hidden = !homeScheduledVisible && !homeVisitActive;
      officeResident.hidden = !atOffice;
    });

    const outward = [v1.frontPt, ...roadPath(v1.frontPt[0], v1.frontPt[1], 8.6, 7.4, 0.35, 3), mailStand];
    const villager = makePerson({ shirt: '#8f7fe6', pants: '#3a3568', hair: '#7a4a32', backpack: '#ff6b5e', skin: '#f6d2b4', hairStyle: 'pony', shoes: '#8a5a44' });
    makeAgent(villager, W, {
      x: v1.frontPt[0], z: v1.frontPt[1], ground: walkGround, speed: 1.0, shift: 'day', nightHome: v1.doorPt,
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
      x: 8.1, z: 2.4, ground: () => 0, speed: 0.8, shift: 'day', nightHome: houseV1.value.doorPt,
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
    makeAgent(fisher, W, { x: -3.35, z: 0.5, face: [-1, -0.05], ground: terrainH, shift: 'day', nightHome: [-9.6, -1.2], steps: [{ wait: Infinity, pose: 'fish' }] });
    animators.push((dt, t) => { bobber.position.y = 0.62 + Math.sin(t * 2.2) * 0.012; rod.rotation.z = -1.0 + Math.sin(t * 0.7) * 0.02; });

    const student = makePerson({ shirt: '#ffe08a', pants: '#4b3fa6', hair: '#241f4d', hairStyle: 'pony', backpack: '#5ac8c8', skin: '#e9b48d', shorts: true, shoes: '#ff6b5e' });
    student.group.scale.setScalar(0.9);
    makeAgent(student, W, { x: -8.3, z: -2.6, face: [0.5, 1], ground: terrainH, shift: 'day', nightHome: houseV1.value.doorPt, steps: [{ wait: Infinity, pose: 'wave' }] });

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
      if (nightAmount >= 0.5) return;
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

    /* --- shared helpers for the three offices --- */
    const seatedSteps = (pose) => [{ wait: Infinity, pose, face: [-1, 0] }];
    const addHeadset = (p) => {
      const hs = new THREE.Group(); p.head.add(hs);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.012, 6, 16, Math.PI), mat('#2b2850')); band.rotation.y = Math.PI / 2; hs.add(band);
      ball(hs, 0.04, 0, -0.005, 0.15, '#2b2850').castShadow = false; ball(hs, 0.04, 0, -0.005, -0.15, '#2b2850').castShadow = false;
      cyl(hs, 0.008, 0.008, 0.18, 4, 0.08, -0.05, 0.1, '#2b2850').rotation.z = 1.3;
      ball(hs, 0.018, 0.14, -0.065, 0.06, '#ff4fa3').castShadow = false;
    };
    const deskWorker = (grp, i, pose, look) => { const p = makePerson(look); makeAgent(p, grp, { x: DESK_X0(i), z: -1.55, face: [-1, 0], ground: hqGround, shift: 'day', steps: seatedSteps(pose) }); return p; };
    const presenter = (grp, look) => makeAgent(makePerson(look), grp, { x: 3.0, z: -2.25, face: [0, 1], ground: hqGround, shift: 'day', steps: [{ wait: Infinity, pose: 'talk' }] });
    const inspector = (grp, look, deskIdx) => {
      const p = makePerson(look);
      box(p.elbowL, 0.03, 0.22, 0.16, 0.05, -0.17, 0, '#c9966f');
      const st = [];
      deskIdx.forEach((i) => { const sx = DESK_X0(i) - 0.75; st.push({ go: [sx, 0.05] }, { go: [sx, -0.7] }, { wait: 2.4, pose: 'point', face: [0, -1] }, { go: [sx, 0.05] }); });
      st.push({ go: [-3.2, 0.05] });
      makeAgent(p, grp, { x: -3.2, z: 0.05, ground: hqGround, speed: 0.8, shift: 'day', steps: st });
    };
    const gateGuard = (grp, hq, look) => makeAgent(makePerson(look), grp, {
      x: 1.55, z: 2.15, face: [0, 1], ground: hqGround, shift: 'day',
      steps: [{ wait: 6, pose: 'idle', face: [0, 1] }, { go: [1.55, 1.5] }, { wait: 4, face: [0, 1] }, { go: [1.55, 2.15] }],
      tick: (a) => { if (hq.gate.target > 0.5 && hq.gate.pos < 0.98) { a.pose = 'wave'; a.want = -Math.atan2(1, 0.3); } },
    });
    const courierRun = (grp, hq, look, parcelColor) => {
      const c = makePerson(look);
      const parcel = box(c.upper, 0.2, 0.16, 0.26, 0.3, 0.2, 0, parcelColor);
      const parcelDoor = box(grp, 0.3, 0.22, 0.3, 0.9, 0.12, 1.05, parcelColor); parcelDoor.visible = false;
      makeAgent(c, grp, {
        x: -4.9, z: 3.55, face: [1, 0], ground: hqGround, speed: 1.0, shift: 'day',
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
    const addNightCrew = (grp, accent) => {
      const common = { shirt: '#263452', pants: '#171d36', hair: '#241f4d', skin: '#d9a07a', shoes: '#241f4d', longSleeve: true };
      const nightWorker = (x, pose, shirt) => makeAgent(makePerson({ ...common, shirt }), grp, {
        x, z: -1.55, face: [-1, 0], ground: hqGround, hidden: true, shift: 'night',
        steps: [{ wait: Infinity, pose }],
      });
      nightWorker(-1.1, 'type', accent);
      nightWorker(0.4, 'phone', '#5ac8c8');
      const guard = makePerson({ ...common, shirt: '#1c2540', hat: 'beanie', hatColor: '#241f4d', belt: accent });
      ball(guard.elbowR, 0.05, 0.06, -0.13, 0, '#ffe08a', { emissive: '#ffe08a', emissiveIntensity: 1 }).castShadow = false;
      const torchGlow = glow(guard.group, '#ffe08a', 0.65, 0.04, 0.3, 1.0, 2.0);
      nightGlows.push({ material: torchGlow.material, dayOpacity: 0.02, nightOpacity: 0.8 });
      makeAgent(guard, grp, {
        x: 0, z: 3.65, face: [0, 1], ground: hqGround, hidden: true, shift: 'night',
        steps: [{ wait: 5, pose: 'idle', face: [0, 1] }, { go: [-1.4, 2.7] }, { wait: 4, face: [-1, 0] }, { go: [0, 3.65] }],
      });
      const cleaner = makePerson({ ...common, shirt: '#4b3fa6', hat: 'cap', hatColor: '#4fd1e0' });
      const brush = cyl(cleaner.elbowR, 0.018, 0.018, 0.65, 5, 0.05, -0.34, 0, '#8a5a44');
      brush.rotation.z = -0.9;
      makeAgent(cleaner, grp, {
        x: 2.8, z: 1.5, face: [-1, 0], ground: hqGround, speed: 0.55, hidden: true, shift: 'night',
        steps: [{ go: [-2.8, 1.5] }, { wait: 1.5, pose: 'idle' }, { go: [-2.8, -0.4] }, { go: [2.8, -0.4] }, { go: [2.8, 1.5] }],
      });
    };
    const insp = { shirt: '#fff8ec', pants: '#2b2850', hair: '#241f4d', skin: '#e9b48d', hairStyle: 'short', longSleeve: true, shoes: '#2b2850' };

    /* Team order (matches config.companies[id].team):
       desk 1, desk 2, desk 3, desk 4, team lead, presenter, gate guard, courier, [gardener] */

    /* --- Astropulse SMM: 9 employees --- */
    teamSink = astropulseHQ.team;
    const H = hqGroup;
    deskWorker(H, 0, 'type', { shirt: '#4b3fa6', pants: '#2b2850', hair: '#241f4d', skin: '#e9b48d', hairStyle: 'short', shoes: '#2b2850' });
    deskWorker(H, 1, 'type', { shirt: '#ff4fa3', pants: '#2b2850', hair: '#7a4a32', skin: '#f6d2b4', hairStyle: 'pony', shoes: '#fff8ec' });
    deskWorker(H, 2, 'draw', { shirt: '#ffe08a', pants: '#3a3568', hair: '#2b2850', skin: '#c98e68', hairStyle: 'long', shoes: '#ff6b5e' });
    addHeadset(deskWorker(H, 3, 'phone', { shirt: '#5ac8c8', pants: '#2b2850', hair: '#8a5a44', skin: '#e0a98a', hairStyle: 'pony', shoes: '#fff8ec' }));
    inspector(H, insp, [0, 1, 2, 3]);
    presenter(H, { shirt: '#8f7fe6', pants: '#2b2850', hair: '#5a3b2a', skin: '#f2c7a5', hairStyle: 'short', longSleeve: true, shoes: '#2b2850' });
    gateGuard(H, astropulseHQ, { shirt: '#2b2850', pants: '#2b2850', hair: '#241f4d', skin: '#d9a07a', hat: 'beanie', hatColor: '#1f1a45', shoes: '#241f4d', longSleeve: true, belt: '#e8b23a' });
    courierRun(H, astropulseHQ, { shirt: '#ff9f43', pants: '#2b2850', hair: '#241f4d', skin: '#e0a98a', hat: 'beanie', hatColor: '#ff9f43', shorts: true, shoes: '#fff8ec' }, '#c9966f');
    const gardener = makePerson({ shirt: '#4fae7a', pants: '#6a5a45', hair: '#241f4d', skin: '#d9a07a', hat: 'straw', shoes: '#8a5a44' });
    cyl(gardener.elbowR, 0.07, 0.07, 0.12, 10, 0.06, -0.2, 0, '#5ac8c8'); cyl(gardener.elbowR, 0.012, 0.02, 0.2, 6, 0.17, -0.16, 0, '#5ac8c8').rotation.z = -1.0;
    makeAgent(gardener, H, {
      x: 1.6, z: 2.4, face: [-1, 0], ground: hqGround, speed: 0.8, shift: 'day',
      steps: [
        { go: [1.6, 1.3] }, { wait: 4, pose: 'water', face: [-1, 0] },
        { go: [1.6, 2.0] }, { wait: 4, pose: 'water', face: [-1, 0] },
        { go: [3.0, 1.0] }, { wait: 4, pose: 'water', face: [1, 0.3] },
        { go: [3.2, 2.0] }, { wait: 0.3, face: [1, 0] },
      ],
    });

    /* --- HealthGIS --- */
    teamSink = healthgisHQ.team;
    const H2 = hq2Group;
    deskWorker(H2, 0, 'type', { shirt: '#0f6b52', pants: '#2b2850', hair: '#241f4d', skin: '#e9b48d', hairStyle: 'short', shoes: '#2b2850' });
    deskWorker(H2, 1, 'draw', { shirt: '#2e8bff', pants: '#2b2850', hair: '#7a4a32', skin: '#f6d2b4', hairStyle: 'pony', shoes: '#fff8ec' });
    addHeadset(deskWorker(H2, 2, 'phone', { shirt: '#1fbf8f', pants: '#2b2850', hair: '#8a5a44', skin: '#e0a98a', hairStyle: 'pony', shoes: '#fff8ec' }));
    deskWorker(H2, 3, 'type', { shirt: '#fff0b3', pants: '#3a3568', hair: '#2b2850', skin: '#c98e68', hairStyle: 'long', shoes: '#ff6b5e' });
    inspector(H2, insp, [0, 1, 2, 3]);
    presenter(H2, { shirt: '#0f6b52', pants: '#2b2850', hair: '#5a3b2a', skin: '#f2c7a5', hairStyle: 'short', longSleeve: true, shoes: '#2b2850' });
    gateGuard(H2, healthgisHQ, { shirt: '#0f3f30', pants: '#2b2850', hair: '#241f4d', skin: '#d9a07a', hat: 'beanie', hatColor: '#0f3f30', shoes: '#241f4d', longSleeve: true, belt: '#1fbf8f' });
    courierRun(H2, healthgisHQ, { shirt: '#2e8bff', pants: '#2b2850', hair: '#241f4d', skin: '#e0a98a', hat: 'beanie', hatColor: '#2e8bff', shorts: true, shoes: '#fff8ec' }, '#e6f7f1');

    /* --- Nexora AI --- */
    teamSink = nexoraHQ.team;
    const H3 = hq3Group;
    deskWorker(H3, 0, 'type', { shirt: '#4b3fa6', pants: '#2b2850', hair: '#241f4d', skin: '#e9b48d', hairStyle: 'short', shoes: '#2b2850' });
    deskWorker(H3, 1, 'draw', { shirt: '#ff9fb8', pants: '#3a3568', hair: '#2b2850', skin: '#c98e68', hairStyle: 'long', shoes: '#ff6b5e' });
    addHeadset(deskWorker(H3, 2, 'phone', { shirt: '#5ac8c8', pants: '#2b2850', hair: '#8a5a44', skin: '#e0a98a', hairStyle: 'pony', shoes: '#fff8ec' }));
    deskWorker(H3, 3, 'type', { shirt: '#c9bfff', pants: '#2b2850', hair: '#7a4a32', skin: '#f6d2b4', hairStyle: 'short', shoes: '#fff8ec' });
    inspector(H3, insp, [0, 1, 2, 3]);
    presenter(H3, { shirt: '#8f7fe6', pants: '#2b2850', hair: '#5a3b2a', skin: '#f2c7a5', hairStyle: 'short', longSleeve: true, shoes: '#2b2850' });
    gateGuard(H3, nexoraHQ, { shirt: '#2b2850', pants: '#2b2850', hair: '#241f4d', skin: '#d9a07a', hat: 'beanie', hatColor: '#4b3fa6', shoes: '#241f4d', longSleeve: true, belt: '#8f7fe6' });
    courierRun(H3, nexoraHQ, { shirt: '#ff9f43', pants: '#2b2850', hair: '#241f4d', skin: '#e0a98a', hat: 'beanie', hatColor: '#ff9f43', shorts: true, shoes: '#fff8ec' }, '#c9bfff');
    teamSink = null;
    addNightCrew(H, '#ff4fa3');
    addNightCrew(H2, '#1fbf8f');
    addNightCrew(H3, '#8f7fe6');
  });

  /* ---------------------------------------------------------------- */
  /* 8.2 the visitor walk-through (starts when you open an office)     */
  /*   gate + door open -> a visitor walks in -> reception asks the     */
  /*   name -> the receptionist leads him past every cabin -> to the    */
  /*   FOUNDER'S OFFICE, where he can chat with Murari (AI).            */
  /* ---------------------------------------------------------------- */
  const KK = OFFICE_SCALE / 0.72;                 // camera framing grows with the offices
  const visit = { active: false, id: null, token: 0, pending: null, cast: null, cam: [], focus: null, name: '', teamHidden: null, atOwner: false, ownerChat: false };
  const visitCast = {};
  const CANCEL = { cancelled: true };
  const delay = (sec) => new Promise((r) => setTimeout(r, sec * 1000));
  const GUIDE_POST = [4.1, 1.95], VISITOR_START = [0, 6.2], ME_POST = [-3.9, 2.0];

  await stage(0.82, 'Hiring receptionists', () => {
    const meLook = { shirt: '#ff6b5e', pants: '#2b2850', hair: '#241f4d', backpack: '#e8b23a', skin: '#e9b48d', shoes: '#fff8ec' };
    const visitorLook = { shirt: '#2e8bff', pants: '#2b2850', hair: '#2b2850', backpack: '#4fae7a', skin: '#d9a07a', shoes: '#ffffff', hairStyle: 'short' };
    const guideLooks = {
      astropulse: { shirt: '#ff4fa3', pants: '#2b2850', hair: '#5a3b2a', skin: '#f2c7a5', hairStyle: 'long', shoes: '#fff8ec', longSleeve: true },
      healthgis: { shirt: '#1fbf8f', pants: '#2b2850', hair: '#241f4d', skin: '#e0a98a', hairStyle: 'pony', shoes: '#fff8ec', longSleeve: true },
      nexora: { shirt: '#8f7fe6', pants: '#2b2850', hair: '#7a4a32', skin: '#f6d2b4', hairStyle: 'long', shoes: '#fff8ec', longSleeve: true },
    };
    Object.keys(offices).forEach((id) => {
      const off = offices[id], grp = off.H;
      const guide = makeAgent(makePerson(guideLooks[id]), grp, { x: GUIDE_POST[0], z: GUIDE_POST[1], face: [0, 1], ground: hqGround, speed: 1.05, steps: [{ wait: Infinity, pose: 'talk', face: [0, 1] }] });
      const me = makeAgent(makePerson(meLook), grp, { x: ME_POST[0], z: ME_POST[1], face: [1, 0], ground: hqGround, speed: 1.0, steps: [{ wait: Infinity, pose: 'sit', face: [1, 0] }] });
      const visitor = makeAgent(makePerson(visitorLook), grp, { x: VISITOR_START[0], z: VISITOR_START[1], face: [0, -1], ground: hqGround, speed: 1.05, steps: [{ wait: Infinity, pose: 'idle', face: [0, -1] }] });
      visitor.hidden = true;
      visitCast[id] = { guide, me, visitor };
      animators.push((dt) => {
        const following = visit.active && visit.id === id;
        const dx = visitor.x - me.x, dz = visitor.z - me.z;
        const c = Math.cos(me.heading), s = Math.sin(me.heading);
        const localX = dx * c - dz * s, localZ = dx * s + dz * c;
        const gaze = following ? clamp(localZ / Math.max(Math.abs(localX), 0.45), -0.75, 0.75) : 0;
        me.p.pupils.forEach((eye) => {
          const k = Math.min(1, dt * 7);
          eye.mesh.position.z += (eye.z + gaze * 0.018 - eye.mesh.position.z) * k;
          eye.mesh.position.y += (eye.y - eye.mesh.position.y) * k;
        });
      });
    });
  });

  function speak(title, text, accent) { onSpeak({ title, text, accent: accent || '#ff6b5e' }); }
  function goThen(a, pts, o = {}) {              // walk an agent along points; resolves when it arrives
    return new Promise((resolve) => {
      const steps = pts.map((p) => ({ go: p }));
      steps.push({ do: () => resolve() });
      steps.push({ wait: Infinity, pose: o.pose || 'idle', face: o.face || [0, 1] });
      a.steps = steps; a.i = 0; a.timer = 0;
    });
  }
  function askName() { return new Promise((res) => { visit.pending = res; onInput({ mode: 'name', placeholder: 'Type your name and press Enter…', who: 'visitor' }); }); }
  function submitName(text) {
    const r = visit.pending; if (!r) return false;
    visit.pending = null; r(String(text || '').trim().slice(0, 40) || 'Guest'); return true;
  }

  async function runVisit(id) {
    const off = offices[id], cast = visitCast[id]; if (!off || !cast) return;
    const cfg = companyCfg(id), team = cfg.team || [], accent = off.accent, my = ++visit.token;
    const company = ({ astropulse: 'Astropulse SMM', healthgis: 'HealthGIS', nexora: 'Nexora AI' })[id] || 'our office';
    const chk = () => { if (visit.token !== my) throw CANCEL; };
    const step = async (p) => { const r = await p; chk(); return r; };
    const say = (agent, title, text) => { bubbleHead = agent; speak(title, text, accent); };
    try {
      visit.active = true; visit.id = id; visit.cast = cast; visit.name = ''; visit.focus = null; visit.following = false; visit.atOwner = false; visit.ownerChat = false;
      visit.teamHidden = off.team.map((agent) => agent.hidden);
      onVisitState('walking'); onInput({ mode: 'off' });
      off.gate.hold = true;                                              // gate and glass door open
      const { guide, me, visitor } = cast;
      drive(me, [{ wait: Infinity, pose: 'sit', face: [1, 0] }]);
      guide.hidden = false;
      guide.x = 0; guide.z = 2.55; drive(guide, [{ wait: Infinity, pose: 'talk', face: [0, 1] }]);
      off.team.forEach((agent) => { agent.hidden = false; });
      visitor.x = VISITOR_START[0]; visitor.z = VISITOR_START[1]; visitor.hidden = true;
      visit.cam = [visitor];
      say(guide, 'Reception', 'The gate and the door are open. A visitor is arriving…');
      await step(goThen(visitor, [[0, 5.4], [0, 4.8], [0.55, 4.2]], { face: [0, -1] }));

      visit.cam = [visitor];
      say(guide, 'Receptionist · ' + company, 'Good day, and welcome to ' + company + '! May I have your name, please?');
      const name = await step(askName());
      visit.name = name; onInput({ mode: 'off' });
      say(guide, 'Receptionist · ' + company, 'Welcome, ' + name + '! Sir, please come with me. I will show you our cabins and drop you at the founder\'s office.');
      await step(delay(3.6));
      visit.cam = [visitor];

      const stops = [0, 1, 2, 3].map((i) => DESK_X0(i) - 0.75);
      for (let i = 0; i < stops.length; i++) {
        guide.hidden = false;
        const gp = i === 0 ? [[0, 1.7], [0, 0.9], [0, 0.2], [stops[0] + 0.55, 1.0]] : [[stops[i] + 0.55, 1.0]];
        const vp = i === 0 ? [[0, 2.5], [0, 1.4], [0, 0.55], [DESK_X0(0), -0.5]] : [[DESK_X0(i), -0.5]];
        await step(Promise.all([goThen(guide, gp, { pose: 'point', face: [0, -1] }), goThen(visitor, vp, { face: [0, -1] })]));
        guide.hidden = true;
        const info = team[i] || {};
        visit.cam = [visitor];
        visit.focus = [DESK_X0(i) - 0.77, FLOOR + 1.05, -1.55];
        say(guide, 'Cabin ' + (i + 1) + ' · ' + (info.role || 'Team member'), info.say || '');
        await step(delay(3.2 + (info.say || '').length * 0.035));
      }

      off.team.forEach((agent, index) => { agent.hidden = visit.teamHidden[index]; });
      visit.teamHidden = null;
      visit.cam = [visitor];
      visit.focus = null;
      guide.hidden = false;
      say(guide, 'Receptionist · ' + company, 'And now, sir, the founder\'s office. Please follow me.');
      visit.atOwner = true;
      const gOut = [[stops[3] - 0.2, 1.0], [0.3, 0.12], [0, 0.4], [0, 1.2], [0, 1.9], [-0.6, 2.0], [-1.15, 1.45]];
      const vOut = [[stops[3] - 0.9, -0.5], [0.3, 0.2], [0, 0.55], [0, 1.4], [0, 2.1], [-0.9, 2.0], [-1.6, 2.0], [-2.55, 2.0], [-3.3, 2.0]];
      await step(Promise.all([goThen(guide, gOut, { pose: 'point', face: [-1, 0.2] }), goThen(visitor, vOut, { face: [-1, 0] })]));

      visit.cam = [visitor, me];
      say(guide, 'Receptionist · ' + company, name + ', this is Murari Kumar\'s office. Please go ahead, he is expecting you.');
      await step(delay(2.8));
      goThen(guide, [[-0.6, 2.0], [0, 1.9], GUIDE_POST], { pose: 'talk', face: [0, 1] });
      say(me, 'Murari Kumar · Founder', 'Welcome, ' + name + '! Please ask me anything: my projects, skills, studies or this company.');
      visitor.hidden = true;
      visit.cam = [visitor, me];
      visit.focus = null;
      visit.ownerChat = true;
      onVisitState('chat');
      onInput({ mode: 'chat', who: 'murari', name, placeholder: 'Ask Murari anything…' });
    } catch (err) {
      if (visit.teamHidden) {
        off.team.forEach((agent, index) => { agent.hidden = visit.teamHidden[index]; });
        visit.teamHidden = null;
      }
      if (err !== CANCEL) console.warn('Visit stopped:', err);
    }
  }

  function cancelVisit() {
    if (!visit.active) return;
    visit.token++; visit.active = false; visit.pending = null; visit.cam = []; visit.focus = null; visit.atOwner = false; visit.ownerChat = false;
    const cast = visit.cast, id = visit.id;
    if (cast) {
      cast.visitor.hidden = true; cast.visitor.x = VISITOR_START[0]; cast.visitor.z = VISITOR_START[1];
      cast.guide.hidden = false;
      cast.guide.x = GUIDE_POST[0]; cast.guide.z = GUIDE_POST[1]; drive(cast.guide, [{ wait: Infinity, pose: 'talk', face: [0, 1] }]);
    }
    if (id && offices[id] && visit.teamHidden) {
      offices[id].team.forEach((agent, index) => { agent.hidden = visit.teamHidden[index]; });
      visit.teamHidden = null;
    }
    if (id && offices[id]) offices[id].gate.hold = false;
    onVisitState('ended');
  }
  function startVisit(id) { cancelVisit(); runVisit(id).catch(() => {}); }
  function endVisit() {
    const id = visit.id; cancelVisit(); onInput({ mode: 'off' }); hideBubble();
    if (id && mode === 'section') flyTo(id, { noVisit: true });
  }

  /* ---------------------------------------------------------------- */
  /* 8.5 the west district and lake                                    */
  /* ---------------------------------------------------------------- */
  await stage(0.84, 'Growing the west district', () => {
    const cx = (CITY2.x0 + CITY2.x1) / 2, cz = (CITY2.z0 + CITY2.z1) / 2, STREET_Z = 21.5;
    slab(W, cx, cz, CITY2.x1 - CITY2.x0, CITY2.z1 - CITY2.z0, '#e4def7', 0.02, 0.04);
    slab(W, cx, STREET_Z, CITY2.x1 - CITY2.x0, 1.8, '#3f3d66', 0.04, 0.06);
    slab(W, cx, STREET_Z - 1.15, CITY2.x1 - CITY2.x0, 0.6, '#f4f0ff', 0.05, 0.06);
    slab(W, cx, STREET_Z + 1.15, CITY2.x1 - CITY2.x0, 0.6, '#f4f0ff', 0.05, 0.06);
    for (let i = 0; i < 17; i++) box(W, 0.45, 0.012, 0.07, CITY2.x0 + 0.8 + i * 1.0, 0.08, STREET_Z, '#fff1dc').castShadow = false;

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

  await stage(0.87, 'Filling the lake', () => {
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

  /* ---------------------------------------------------------------- */
  /* visiting people: speech bubble, "About me" talk, office tour      */
  /*   • Clicking an office lifts its roof (you see the glass cabins). */
  /*   • Double-click / double-tap empty space = go to the next person.*/
  /* ---------------------------------------------------------------- */
  let sectionId = null, lastTap = null, aboutIdx = 0, aboutTimer = 0, bubbleHead = null, aboutPaused = false;
  const tour = { active: false, i: -1, pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
  const vHead = new THREE.Vector3(), vA = new THREE.Vector3(), vB = new THREE.Vector3();
  const FALLBACK_ABOUT = [
    'Hello, I am Murari Kumar, a Diploma Computer Science and Engineering student.',
    'I build for the web, Android and AI.',
    'Please explore the world and contact me by email or GitHub.',
  ];
  const aboutLines = ((config.about && config.about.lines) || FALLBACK_ABOUT).filter(Boolean);

  const BW = 640, BH = 300;
  const bubbleCanvas = document.createElement('canvas'); bubbleCanvas.width = BW; bubbleCanvas.height = BH;
  const bubbleTex = new THREE.CanvasTexture(bubbleCanvas); bubbleTex.colorSpace = THREE.SRGBColorSpace;
  const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false, fog: false }));
  bubble.center.set(0.5, 0); bubble.renderOrder = 50; bubble.visible = false; scene.add(bubble);

  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
  }
  function wrapLines(g, text, maxW) {
    const words = String(text).split(/\s+/), lines = []; let cur = '';
    words.forEach((w) => {
      const test = cur ? cur + ' ' + w : w;
      if (g.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
    });
    if (cur) lines.push(cur);
    return lines;
  }
  function drawBubble(title, text, accent) {
    const g = bubbleCanvas.getContext('2d'), tail = 36, bh = BH - tail, FONT = 'system-ui, "Segoe UI", Arial, sans-serif';
    g.clearRect(0, 0, BW, BH);
    g.fillStyle = 'rgba(255,255,255,0.98)'; g.strokeStyle = accent; g.lineWidth = 7;
    roundRect(g, 8, 8, BW - 16, bh - 8, 30); g.fill(); g.stroke();
    g.fillStyle = 'rgba(255,255,255,1)'; g.beginPath(); g.moveTo(BW / 2 - 26, bh - 6); g.lineTo(BW / 2, BH - 6); g.lineTo(BW / 2 + 26, bh - 6); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(BW / 2 - 26, bh - 3); g.lineTo(BW / 2, BH - 6); g.lineTo(BW / 2 + 26, bh - 3); g.stroke();
    g.fillStyle = '#ffffff'; g.fillRect(BW / 2 - 24, bh - 9, 48, 8);
    g.textBaseline = 'alphabetic';
    g.fillStyle = accent; g.font = `800 34px ${FONT}`;
    let tt = title || ''; while (g.measureText(tt).width > BW - 70 && tt.length > 4) tt = tt.slice(0, -2);
    g.fillText(tt, 34, 62);
    g.fillStyle = accent; g.globalAlpha = 0.35; g.fillRect(34, 76, BW - 68, 3); g.globalAlpha = 1;
    let fs = 30, lines = [];
    for (; fs >= 20; fs -= 2) {
      g.font = `600 ${fs}px ${FONT}`; lines = wrapLines(g, text, BW - 72);
      if (lines.length * (fs + 9) <= bh - 118) break;
    }
    g.fillStyle = '#241f4d';
    lines.forEach((ln, i) => g.fillText(ln, 34, 118 + i * (fs + 9)));
    bubbleTex.needsUpdate = true;
  }
  // The words now appear in a FIXED caption card in the page (never over the people). A small gem above the speaker's head shows who is talking.
  const speakMark = glow(scene, 0xffe08a, 0.9, 0.95); speakMark.visible = false; speakMark.renderOrder = 40;
  function showBubble(agent, title, text, accent) { bubbleHead = agent; speak(title, text, accent || '#ff6b5e'); speakMark.visible = true; dirty = true; }
  function hideBubble() { bubbleHead = null; speakMark.visible = false; onSpeakEnd(); dirty = true; }
  function endTour() { tour.active = false; tour.i = -1; aboutTimer = 0; hideBubble(); }
  function setCutaway(activeId) {
    Object.keys(offices).forEach((k) => {
      const office = offices[k];
      if (office.roof) office.roof.visible = k !== activeId;
      (office.visitOccluders || []).forEach((object) => { object.visible = k !== activeId; });
    });
    dirty = true;
  }

  function aboutShow() {
    if (!aboutAgent || !aboutLines.length) return;
    showBubble(aboutAgent, config.name || 'About me', aboutLines[aboutIdx % aboutLines.length], '#ff6b5e');
    aboutTimer = 0;
  }
  function startAbout() {
    aboutIdx = 0; aboutPaused = false; aboutShow();
    setTimeout(() => { if (sectionId === 'about') onInput({ mode: 'chat', who: 'about', placeholder: 'Ask me anything about Murari…' }); }, 1400);   // the typing box appears after the greeting
  }

  function advance() {                         // double-click / double-tap / next()
    if (flight || disposed || mode !== 'section' || !sectionId || visit.active) return;
    if (sectionId === 'about') { aboutIdx++; aboutShow(); return; }
    const off = offices[sectionId];
    if (!off || !off.team.length) return;
    const n = off.team.length;
    let k = tour.i + 1;
    while (k < n && off.team[k].hidden) k++;                 // skip anybody who is out of sight for a moment
    if (k >= n) { const id = sectionId; endTour(); flyTo(id); return; }   // everyone met: back to the whole office
    if (!tour.active) { tour.active = true; tour.pos.copy(camera.position); tour.tgt.copy(controls.target); }
    tour.i = k;
    const info = (companyCfg(sectionId).team || [])[k] || {};
    showBubble(off.team[k], info.role || 'Team member', info.say || '', off.accent);
    aboutTimer = 0;
  }

  function updateTourAndBubble(dt) {
    if (visit.active && visit.cam.length && mode === 'section' && !flight) {
      const visitor = visit.cast && visit.cast.visitor;
      const firstPerson = visit.cam[0] === visitor;
      if (firstPerson) {
        visitor.p.head.getWorldPosition(vA);
        const forward = vB.set(Math.cos(visitor.heading), 0, -Math.sin(visitor.heading));
        const cameraOffset = visit.cam[1] ? 0.65 : 2.6;
        const cameraPosition = vHead.set(vA.x - forward.x * cameraOffset, vA.y + 0.55, vA.z - forward.z * cameraOffset);
        let target;
        if (visit.focus) {
          const office = offices[visit.id];
          target = vB.set(...visit.focus);
          if (office) office.H.localToWorld(target);
        } else if (visit.cam[1]) {
          visit.cam[1].p.head.getWorldPosition(vB);
          target = vB;
        } else {
          target = vB.set(vA.x + forward.x * 3.5, vA.y - 0.08, vA.z + forward.z * 3.5);
        }
        if (!visit.following) { tour.pos.copy(camera.position); tour.tgt.copy(controls.target); visit.following = true; }
        const k = 1 - Math.exp(-dt * 3.2);
        tour.pos.lerp(cameraPosition, k); tour.tgt.lerp(target, k);
        camera.position.copy(tour.pos); controls.target.copy(tour.tgt); camera.lookAt(tour.tgt); dirty = true;
      } else {
        vA.set(0, 0, 0);
        visit.cam.forEach((ag) => { ag.p.head.getWorldPosition(vHead); vA.add(vHead); });
        vA.multiplyScalar(1 / visit.cam.length);
        let span = 0;
        if (visit.cam.length > 1) { visit.cam[0].p.head.getWorldPosition(vHead); visit.cam[1].p.head.getWorldPosition(vB); span = vHead.distanceTo(vB); }
        if (!tour.pos.lengthSq() || !visit.following) { tour.pos.copy(camera.position); tour.tgt.copy(controls.target); visit.following = true; }
        const k = 1 - Math.exp(-dt * 2.6);
        const dist = (3.4 + span * 0.95) * KK;
        tour.pos.lerp(vB.set(vA.x + 0.9 * KK, vA.y + 0.35 * KK, vA.z + dist), k);
        tour.tgt.lerp(vHead.set(vA.x, vA.y - 0.25, vA.z), k);
        camera.position.copy(tour.pos); controls.target.copy(tour.tgt); camera.lookAt(tour.tgt); dirty = true;
      }
    } else visit.following = false;
    if (mode === 'section' && !flight) {
      if (sectionId === 'about' && bubbleHead && aboutLines.length > 1 && !aboutPaused) {
        aboutTimer += dt;
        const cur = aboutLines[aboutIdx % aboutLines.length] || '';
        if (aboutTimer > 3.4 + cur.length * 0.05) { aboutIdx++; aboutShow(); }
      }
      if (tour.active) {
        const off = offices[sectionId], ag = off && off.team[tour.i];
        if (ag) {
          ag.p.head.getWorldPosition(vHead);
          const k = 1 - Math.exp(-dt * 3.2);
          tour.pos.lerp(vA.set(vHead.x + 0.9 * KK, vHead.y + 0.15, vHead.z + 2.6 * KK), k);
          tour.tgt.lerp(vB.set(vHead.x, vHead.y - 0.1, vHead.z), k);
          camera.position.copy(tour.pos); controls.target.copy(tour.tgt); camera.lookAt(tour.tgt); dirty = true;
        }
      }
    }
    if (bubbleHead) {
      bubbleHead.p.head.getWorldPosition(vHead);
      speakMark.visible = !bubbleHead.hidden;
      speakMark.position.set(vHead.x, vHead.y + 0.42 + Math.sin(t * 4) * 0.04, vHead.z);
      dirty = true;
    }
  }

  function flyTo(id, o = {}) {
    const v = views[id];
    if (!v || disposed) return;
    mode = id === 'home' || id === 'explore' ? id : 'section';
    if (playerAgent) playerAgent.hidden = mode !== 'explore' || !walkingEnabled;
    markers.visible = mode !== 'section';
    setPick(null);
    cancelVisit(); onInput({ mode: 'off' });
    sectionId = null; endTour();
    setCutaway(offices[id] ? id : null);               // lift the roof of the office that is being visited
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
      sectionId = mode === 'section' ? id : null;
      if (sectionId === 'about') startAbout();         // the person introduces themselves
      if (mode === 'section' && offices[id] && !o.noVisit) startVisit(id);   // the door opens and a visitor walks in
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

  function routePlayerTo(x, z, id) {
    if (!playerAgent || !walkingEnabled || mode !== 'explore') return false;
    const route = id === 'manual' ? [[x, z]] : roadPath(playerAgent.x, playerAgent.z, x, z, 0.42, 4);
    const last = route[route.length - 1];
    if (!last || Math.hypot(last[0] - x, last[1] - z) > 0.5) route.push([x, z]);
    playerGoal = { id, x, z };
    playerAgent.hidden = false;
    drive(playerAgent, route.map((point) => ({ go: point })));
    return true;
  }

  function moveByScreenDirection(horizontal, vertical) {
    if (!playerAgent || !walkingEnabled || mode !== 'explore') return false;
    const forward = controls.target.clone().sub(camera.position);
    forward.y = 0;
    if (forward.lengthSq() < 0.001) return false;
    forward.normalize();
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const direction = right.multiplyScalar(horizontal).addScaledVector(forward, -vertical);
    if (direction.lengthSq() < 0.001) return false;
    direction.normalize();
    const origin = playerGoal && playerGoal.id === 'manual'
      ? { x: playerGoal.x, z: playerGoal.z }
      : playerAgent;
    const x = origin.x + direction.x * 1.15, z = origin.z + direction.z * 1.15;
    if (Math.hypot(x, z) > R - 2.5) return false;
    return routePlayerTo(x, z, 'manual');
  }

  function routePlayerFromScreen(clientX, clientY) {
    if (!playerAgent || !walkingEnabled || mode !== 'explore') return false;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    rayPick.setFromCamera(ndc, camera);
    const hit = terrain && rayPick.intersectObject(terrain, false)[0];
    if (!hit) return false;
    const destination = W.worldToLocal(hit.point.clone());
    if (Math.hypot(destination.x, destination.z) > R - 2) return false;
    const nearest = Object.entries(config.walkLocations || {}).find(([, point]) =>
      Math.hypot(destination.x - point[0], destination.z - point[1]) < 2.5);
    return routePlayerTo(destination.x, destination.z, nearest ? nearest[0] : 'road');
  }

  const holdFor = (ms) => { userHold = true; refreshAuto(); clearTimeout(holdTimer); holdTimer = setTimeout(() => { userHold = false; refreshAuto(); }, ms); };
  let down = null, hoverRaf = 0, lastMove = null;
  listen(canvas, 'pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; onUserInteract(); userHold = true; refreshAuto(); });
  listen(canvas, 'pointerup', (e) => {
    holdFor(3500);
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 7 && performance.now() - down.t < 700 && !flight && mode === 'explore') {
      const id = pick(e.clientX, e.clientY);
      if (id && walkingEnabled) {
        const point = (config.walkLocations || {})[id];
        if (point) routePlayerTo(point[0], point[1], id);
        else onHotspotClick(id);
      } else if (id) onHotspotClick(id);
      else if (walkingEnabled) routePlayerFromScreen(e.clientX, e.clientY);
    }
    // double-click / double-tap on empty canvas inside a visit = next person
    if (down && mode === 'section' && !flight && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 9 && performance.now() - down.t < 500) {
      const nowT = performance.now();
      if (lastTap && nowT - lastTap.t < 420 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 32) { lastTap = null; advance(); }
      else lastTap = { t: nowT, x: e.clientX, y: e.clientY };
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

    try { updateTourAndBubble(dt); } catch (err) { console.warn('Tour update skipped a frame:', err); }

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
    next: advance,                      // same as a double-click: next person / next sentence
    submitName,                         // the visitor's name typed at reception
    endVisit,                           // leave the founder's office
    startVisit: () => { if (sectionId && offices[sectionId]) startVisit(sectionId); },
    setAboutPaused: (on) => { aboutPaused = !!on; },
    setViewShift,
    nudge,
    setHover: (id) => { domHoverId = id; dirty = true; },
    setAutoRotate: (on) => { wantAuto = !!on; refreshAuto(); },
    setWalkerEnabled(on) {
      walkingEnabled = !!on;
      if (playerAgent) playerAgent.hidden = !walkingEnabled || mode !== 'explore';
      if (!walkingEnabled) playerGoal = null;
      dirty = true;
    },
    walkTo(id) {
      const point = (config.walkLocations || {})[id];
      if (!point) return false;
      walkingEnabled = true;
      if (mode !== 'explore') flyTo('explore');
      return routePlayerTo(point[0], point[1], id);
    },
    moveByScreenDirection,
    setHomeVisitVisible(on) {
      homeVisitActive = !!on;
      if (homeResident) homeResident.hidden = !homeVisitActive && !homeScheduledVisible;
    },
    playIntro() {
      if (!animate) { flyTo('home'); return; }
      fovBoost = 16; refreshFov();
      flyTo('home', { duration: 4.2 });
    },
  };
}
