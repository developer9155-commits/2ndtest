/* =====================================================================
   main.js — the "conductor"
   ---------------------------------------------------------------------
   • Applies your settings from config.js to the page (links, text).
   • Runs the loading screen and starts the 3D world (world.js).
   • Opens/closes portfolio panels and tells the camera where to fly.
   • Wires up the menu, sound button, keyboard shortcuts and fallbacks.
   If the 3D engine cannot load, the portfolio still works as a normal page.
   ===================================================================== */

import { CONFIG } from './config.js';
import { SoundEngine } from './audio.js';

window.__portfolioStarted = true; // tells the safety timer in index.html that this file loaded

/* ------------------------------ small helpers ------------------------------ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const body = document.body;
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobileQuery = window.matchMedia('(max-width: 760px)');

const loader = $('#loader');
const hero = $('#hero');
const hint = $('#hint');
const menu = $('#menu');
const btnMenu = $('#btn-menu');
const btnSound = $('#btn-sound');
const toastEl = $('#toast');

const sound = new SoundEngine();
let world = null;
let staticMode = false;
let state = 'home';          // 'home' | 'explore' | 'section'
let current = null;          // id of the open panel
let lastOpener = null;       // element to return focus to after closing a panel
let openToken = 0;           // cancels stale timers when the visitor clicks quickly
let progress = 0;

/* ------------------------------ toast ------------------------------ */
let toastTimer = 0;
function toast(msg, ms = 3400) {
  toastEl.textContent = msg;
  toastEl.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), ms);
}

/* ------------------------------ apply config.js to the page ------------------------------ */
function applyConfig() {
  $$('[data-link]').forEach((el) => {
    const key = el.dataset.link;
    const val = String((CONFIG.links && CONFIG.links[key]) || '').trim();
    if (val) {
      el.setAttribute('href', key === 'email' ? `mailto:${val}` : val);
      if (key !== 'email') { el.target = '_blank'; el.rel = 'noopener noreferrer'; }
      el.classList.remove('is-disabled'); el.removeAttribute('aria-disabled'); el.hidden = false;
      const t = $('[data-link-text]', el);
      if (t) t.textContent = key === 'email' ? val : val.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const note = $(`[data-note-for="${key}"]`); if (note) note.hidden = true;
    } else if (el.hasAttribute('data-hide-if-empty')) {
      el.hidden = true;
    } else {
      el.removeAttribute('href'); el.classList.add('is-disabled'); el.setAttribute('aria-disabled', 'true');
    }
  });
  $$('[data-text]').forEach((el) => {
    const v = String((CONFIG.text && CONFIG.text[el.dataset.text]) || '').trim();
    if (v) { el.textContent = v; el.classList.remove('placeholder'); }
  });
  $$('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a.is-disabled');
  if (a) { e.preventDefault(); toast('This link is not set yet. Add it in config.js.'); }
});

/* ------------------------------ loading screen ------------------------------ */
function setProgress(f, label) {
  progress = Math.max(progress, clamp(f, 0, 1));
  const pct = Math.round(progress * 100);
  $('#loader-fill').style.transform = `scaleX(${progress})`;
  $('#loader-van').style.left = `${pct}%`;
  $('#loader-pct').textContent = `${pct}%`;
  if (label) $('#loader-status').textContent = label;
}
function showLoaderError(message, allowSimple = true) {
  loader.hidden = false; loader.classList.remove('is-done');
  body.classList.add('is-loading');
  $('#loader-error-msg').textContent = message;
  $('#btn-simple').hidden = !allowSimple;
  $('#loader-error').hidden = false;
  $('#loader-status').textContent = 'Something went wrong';
  $('#btn-retry').focus();
}
function finishLoading() {
  setProgress(1, 'Ready');
  loader.classList.add('is-done');
  body.classList.remove('is-loading');
  setTimeout(() => { loader.hidden = true; }, reduced ? 50 : 900);
}
function withTimeout(promise, ms, message) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(message)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}
function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) { return false; }
}

/* ------------------------------ plain-page fallback ------------------------------ */
function goStatic(reason) {
  staticMode = true;
  if (world) { try { world.dispose(); } catch (e) { /* ignore */ } world = null; }
  body.classList.remove('mode-3d', 'is-loading', 'menu-open');
  loader.hidden = true;
  const note = $('#static-note');
  if (note && reason) { note.textContent = reason; note.hidden = false; }
  window.scrollTo(0, 0);
}

/* ------------------------------ camera / layout helpers ------------------------------ */
function homeShift() { return mobileQuery.matches ? { x: 0, y: 0.13 } : { x: -0.12, y: 0 }; }
function panelShift(id) {
  if (mobileQuery.matches) {
    const el = $(`#panel-${id}`);
    const h = Math.min(el ? el.offsetHeight : window.innerHeight * 0.5, window.innerHeight * 0.62);
    return { x: 0, y: clamp(h / 2 / window.innerHeight, 0, 0.32) };
  }
  const w = Math.min(520, window.innerWidth - 40) + 20;
  return { x: (w / 2) / window.innerWidth, y: 0 };
}
function applyShift(s, duration) { if (world) world.setViewShift(s.x, s.y, duration); }

/* ------------------------------ states: home / explore / section ------------------------------ */
function closePanelsNow() { $$('.panel.is-open').forEach((p) => p.classList.remove('is-open')); }

function enterHome() {
  if (!world) return;
  openToken++; closePanelsNow(); current = null; state = 'home'; body.dataset.view = 'home';
  hero.classList.add('is-in');
  world.setAutoRotate(true);
  world.flyTo('home');
  applyShift(homeShift(), 1.4);
  sound.whoosh();
}
function enterExplore() {
  if (!world) return;
  openToken++; closePanelsNow(); current = null; state = 'explore'; body.dataset.view = 'explore';
  hint.classList.add('is-visible');
  world.setAutoRotate(false);
  world.flyTo('explore');
  applyShift({ x: 0, y: 0 }, 1.2);
  sound.whoosh();
}
function openSection(id, opener) {
  const panel = $(`#panel-${id}`);
  if (!panel) return;
  if (staticMode || !world) { panel.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); closeMenu(); return; }
  closeMenu();
  if (id === current) return;
  lastOpener = opener || document.activeElement;
  const token = ++openToken;
  closePanelsNow();
  current = id; state = 'section'; body.dataset.view = 'section';
  hideHint();
  world.setAutoRotate(false);
  world.flyTo(id);                      // camera + target fly together (GSAP timeline in world.js)
  applyShift(panelShift(id), 1.4);
  sound.whoosh(); sound.open();
  setTimeout(() => {
    if (token !== openToken) return;    // visitor already clicked something else
    panel.classList.add('is-open');
    panel.scrollTop = 0;
    setTimeout(() => { if (token === openToken) panel.focus({ preventScroll: true }); }, reduced ? 0 : 450);
  }, reduced ? 0 : 650);
}
function closeSection() {
  if (state !== 'section') return;
  const opener = lastOpener;
  enterExplore();
  sound.close();
  if (opener && document.contains(opener) && opener.offsetParent !== null) opener.focus({ preventScroll: true });
}
function resetView() {
  if (!world) return;
  if (state === 'section') closeSection();
  else { world.flyTo(state === 'home' ? 'home' : 'explore'); sound.tick(); }
}
function hideHint() { hint.classList.remove('is-visible'); }

/* ------------------------------ hotspot labels (HTML on top of the 3D markers) ------------------------------ */
const hotspotEls = {};
function buildHotspots() {
  const wrap = $('#hotspots');
  wrap.textContent = '';
  (CONFIG.hotspots || []).forEach((h) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'hotspot'; b.dataset.id = h.id;
    b.setAttribute('aria-label', `${h.label}. ${h.preview}`);
    const chip = document.createElement('span'); chip.className = 'hotspot-chip'; chip.textContent = h.label;
    const prev = document.createElement('span'); prev.className = 'hotspot-preview'; prev.setAttribute('aria-hidden', 'true'); prev.textContent = h.preview;
    b.append(prev, chip);
    b.addEventListener('click', () => openSection(h.id, b));
    const on = () => { if (world) world.setHover(h.id); };
    const off = () => { if (world) world.setHover(null); };
    b.addEventListener('mouseenter', on); b.addEventListener('mouseleave', off);
    b.addEventListener('focus', on); b.addEventListener('blur', off);
    wrap.appendChild(b); hotspotEls[h.id] = b;
  });
}
function updateHotspotLabels(screens) {
  if (state !== 'explore') return;
  for (const s of screens) {
    const el = hotspotEls[s.id]; if (!el) continue;
    el.classList.toggle('is-offscreen', !s.visible);
    el.style.transform = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0)`;
  }
}
function highlightHotspot(id) {
  Object.keys(hotspotEls).forEach((k) => hotspotEls[k].classList.toggle('is-hover', k === id));
  if (id) sound.tick();
}

/* ------------------------------ menu ------------------------------ */
function openMenu() {
  menu.classList.add('is-open'); body.classList.add('menu-open');
  btnMenu.setAttribute('aria-expanded', 'true');
  const first = $('a', menu); if (first) first.focus({ preventScroll: true });
  sound.tick();
}
function closeMenu() {
  if (!menu.classList.contains('is-open')) return;
  menu.classList.remove('is-open'); body.classList.remove('menu-open');
  btnMenu.setAttribute('aria-expanded', 'false');
}
btnMenu.addEventListener('click', () => (menu.classList.contains('is-open') ? (closeMenu(), btnMenu.focus()) : openMenu()));
$$('[data-go]', menu).forEach((a) => {
  a.addEventListener('click', (e) => {
    if (staticMode || !world) return;            // plain page: let the #anchor scroll normally
    e.preventDefault();
    const id = a.dataset.go;
    if (id === 'home') { closeMenu(); enterHome(); } else openSection(id, btnMenu);
  });
});
document.addEventListener('click', (e) => {
  if (menu.classList.contains('is-open') && !menu.contains(e.target) && !btnMenu.contains(e.target)) closeMenu();
});

/* ------------------------------ buttons ------------------------------ */
$('#brand-btn').addEventListener('click', () => { if (staticMode || !world) { window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }); } else enterHome(); });
$('#btn-explore').addEventListener('click', () => { if (world) enterExplore(); });
$('#btn-reset').addEventListener('click', resetView);
$$('[data-close]').forEach((b) => b.addEventListener('click', closeSection));

function updateSoundButton(on) {
  btnSound.setAttribute('aria-pressed', String(on));
  $('.btn-label', btnSound).textContent = on ? 'Sound on' : 'Sound off';
}
btnSound.addEventListener('click', async () => {
  if (sound.enabled) { sound.disable(); updateSoundButton(false); toast('Sound off'); return; }
  const ok = await sound.enable();          // runs inside the click, so browsers allow it
  updateSoundButton(ok);
  if (ok) { sound.tick(); toast('Sound on. Use the button again to mute.'); }
  else toast('Your browser blocked audio. Tap the sound button once more to allow it.');
});

/* ------------------------------ keyboard ------------------------------ */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (menu.classList.contains('is-open')) { closeMenu(); btnMenu.focus(); }
    else if (state === 'section') closeSection();
    return;
  }
  if (!world || staticMode) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest && e.target.closest('input, textarea, select, .panel, #menu')) return;
  const step = 0.14;
  const map = { ArrowLeft: [-step, 0, 1], ArrowRight: [step, 0, 1], ArrowUp: [0, -0.08, 1], ArrowDown: [0, 0.08, 1], '+': [0, 0, 0.88], '=': [0, 0, 0.88], '-': [0, 0, 1.14], '_': [0, 0, 1.14] };
  const m = map[e.key];
  if (m) { e.preventDefault(); world.nudge(m[0], m[1], m[2]); }
});

/* keep the view shift correct when the window changes size */
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!world) return;
    if (state === 'section' && current) applyShift(panelShift(current), 0.3);
    else if (state === 'home') applyShift(homeShift(), 0.3);
  }, 150);
});

/* ------------------------------ buttons inside the loader error box ------------------------------ */
$('#btn-retry').addEventListener('click', () => location.reload());
$('#btn-simple').addEventListener('click', () => { $('#loader-error').hidden = true; progress = 0; boot('simple'); });
$('#btn-static').addEventListener('click', () => goStatic('You are viewing the text version of this portfolio.'));

/* ------------------------------ boot ------------------------------ */
function freshCanvas() {
  const old = $('#scene');
  const next = old.cloneNode(false);
  old.replaceWith(next);
  return next;
}

async function boot(quality = 'full') {
  $('#loader-error').hidden = true;
  setProgress(0.03, 'Starting up');

  if (!hasWebGL()) {
    goStatic('Your browser or device does not support WebGL, so this is the text version of the portfolio.');
    return;
  }

  try {
    setProgress(0.08, 'Loading the 3D engine');
    const mod = await withTimeout(import('./world.js'), 30000, 'The 3D engine took too long to download. Check your connection.');
    const canvas = quality === 'simple' ? freshCanvas() : $('#scene');
    setProgress(0.2, 'Building the world');

    world = await mod.createWorld({
      canvas, config: CONFIG, quality, reducedMotion: reduced,
      onProgress: (f, label) => setProgress(0.2 + f * 0.78, label),
      onHotspotHover: highlightHotspot,
      onHotspotClick: (id) => openSection(id, null),
      onFrame: updateHotspotLabels,
      onUserInteract: hideHint,
      onWarning: (msg) => toast(msg, 5000),
      onError: (err) => {
        console.error(err);
        showLoaderError('The 3D view stopped working (' + (err && err.message ? err.message : 'unknown error') + '). You can reload or continue with the text version.', quality === 'full');
      },
    });

    buildHotspots();
    state = 'home'; body.dataset.view = 'home';
    applyShift(homeShift(), 0);
    world.setAutoRotate(true);
    world.start();
    finishLoading();
    world.playIntro();
    setTimeout(() => hero.classList.add('is-in'), reduced ? 0 : 1500);
  } catch (err) {
    console.error('3D start-up failed:', err);
    world = null;
    const msg = quality === 'simple'
      ? 'The simplified 3D scene could not start either. You can try again or continue with the text version.'
      : 'The 3D world could not start. A library may be blocked or your device may not support it. You can retry, try a simpler scene, or continue with the text version.';
    showLoaderError(msg, quality === 'full');
  }
}

/* ------------------------------ go! ------------------------------ */
applyConfig();
updateSoundButton(false);
boot('full');
