/* =====================================================================
   main.js — connects the page (index.html) to the 3D world (world.js)
   ---------------------------------------------------------------------
   This file was missing from the upload, which is why the loading screen
   never finished. It does five jobs:
     1. fills links / text from config.js
     2. shows loading progress and starts the 3D world
     3. builds the glowing hotspot labels and keeps them on the markers
     4. opens / closes the content panels and moves the camera
     5. runs the sound button
   ===================================================================== */

window.__portfolioStarted = true;

import { CONFIG } from './config.js';
import { SoundEngine } from './audio.js';
import { createWorld } from './world.js';

const $ = (id) => document.getElementById(id);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const body = document.body;

/* ------------------------------------------------------------------ */
/* 1. links and text from config.js                                    */
/* ------------------------------------------------------------------ */
function fillFromConfig() {
  const links = CONFIG.links || {};

  $$('[data-link]').forEach((el) => {
    const key = el.dataset.link;
    const raw = (links[key] || '').trim();
    const hrefValue = key === 'email' && raw ? 'mailto:' + raw : raw;
    const shown = raw.replace(/^mailto:/, '').replace(/^https?:\/\//, '').replace(/\/$/, '');

    if (raw) {
      el.setAttribute('href', hrefValue);
      if (key !== 'email') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
      el.classList.remove('is-disabled');
      el.removeAttribute('aria-disabled');
      el.removeAttribute('tabindex');
      el.hidden = false;
      const txt = el.querySelector('[data-link-text]');
      if (txt) { txt.textContent = shown; txt.classList.remove('placeholder'); }
    } else {
      el.removeAttribute('href');
      el.classList.add('is-disabled');
      el.setAttribute('aria-disabled', 'true');
      el.setAttribute('tabindex', '-1');
      if (el.hasAttribute('data-hide-if-empty')) el.hidden = true;
      const txt = el.querySelector('[data-link-text]');
      if (txt) txt.textContent = 'Not added yet';
    }
  });

  // notes such as "The source code link isn't set yet" disappear once the link exists
  $$('[data-note-for]').forEach((el) => { el.hidden = !!(links[el.dataset.noteFor] || '').trim(); });

  $$('[data-text]').forEach((el) => {
    const v = CONFIG.text && CONFIG.text[el.dataset.text];
    if (v) { el.textContent = v; el.classList.remove('placeholder'); }
  });
  $$('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });
}
fillFromConfig();

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */
const params = new URLSearchParams(location.search);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isNarrow = () => window.matchMedia('(max-width: 760px)').matches;

let toastTimer = 0;
function toast(msg, ms = 4200) {
  const t = $('toast'); if (!t) return;
  t.textContent = msg; t.classList.add('is-visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('is-visible'), ms);
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch (e) { return false; }
}

function goStatic(note) {
  body.classList.remove('mode-3d', 'is-loading');
  body.removeAttribute('data-view');
  $('loader').hidden = true;
  const n = $('static-note');
  if (n && note) { n.textContent = note; n.hidden = false; }
  $$('.hero').forEach((h) => h.classList.add('is-in'));
}

function showLoadError(message) {
  $('loader-status').textContent = 'Something went wrong';
  $('loader-error-msg').textContent = message;
  $('loader-error').hidden = false;
  $('btn-retry').onclick = () => location.reload();
  $('btn-simple').onclick = () => { params.set('quality', 'simple'); location.search = params.toString(); };
  $('btn-static').onclick = () => goStatic('Showing the text version of this portfolio.');
}

/* ------------------------------------------------------------------ */
/* 2. start                                                            */
/* ------------------------------------------------------------------ */
const sound = new SoundEngine();
let world = null;
let currentView = 'home';          // home | explore | <section id>
let lastBase = 'home';             // where "close" returns to

function setProgress(fraction, label) {
  const f = Math.max(0, Math.min(1, fraction));
  const fill = $('loader-fill'), van = $('loader-van');
  if (fill) fill.style.transform = `scaleX(${f})`;
  if (van) van.style.left = `${f * 100}%`;
  $('loader-pct').textContent = Math.round(f * 100) + '%';
  if (label) $('loader-status').textContent = label;
}

async function boot() {
  if (!webglAvailable()) {
    goStatic('Your browser could not start 3D graphics, so this is the text version of the portfolio.');
    return;
  }
  if (!window.gsap) console.info('GSAP did not load. The built-in camera tween is used instead.');

  const quality = params.get('quality') === 'simple' ? 'simple' : 'full';

  try {
    world = await createWorld({
      canvas: $('scene'),
      config: CONFIG,
      quality,
      reducedMotion,
      onProgress: setProgress,
      onHotspotHover: (id) => { setLabelHover(id); if (id) sound.tick(); },
      onHotspotClick: (id) => openSection(id),
      onFrame: updateLabels,
      onUserInteract: () => hideHint(),
      onWarning: (msg) => toast(msg),
      onError: (err) => {
        console.error(err);
        if (world) { try { world.dispose(); } catch (e) { /* ignore */ } }
        body.classList.add('is-loading');
        $('loader').classList.remove('is-done');
        showLoadError('The 3D world stopped working: ' + (err && err.message ? err.message : 'unknown error') + '.');
      },
    });
  } catch (err) {
    console.error(err);
    showLoadError('The 3D world could not start: ' + (err && err.message ? err.message : 'unknown error') + '.');
    return;
  }

  buildLabels();
  setProgress(1, 'Ready');
  world.start();

  // Reveal: loader fades, camera swoops in, hero text appears.
  setTimeout(() => {
    $('loader').classList.add('is-done');
    body.classList.remove('is-loading');
    world.playIntro();
    world.setAutoRotate(true);
    world.setViewShift(...homeShift(), reducedMotion ? 0 : 3);
    setTimeout(() => $$('.hero').forEach((h) => h.classList.add('is-in')), reducedMotion ? 0 : 900);
  }, 250);
}

/* ------------------------------------------------------------------ */
/* 3. hotspot labels (HTML) that follow the glowing markers (3D)       */
/* ------------------------------------------------------------------ */
const labels = new Map();

function buildLabels() {
  const host = $('hotspots'); host.innerHTML = '';
  (CONFIG.hotspots || []).forEach((h) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'hotspot is-offscreen'; b.dataset.id = h.id;
    b.style.setProperty('--c', h.color || '#ff6b5e');
    b.setAttribute('aria-label', `${h.label}. ${h.preview || ''}`);
    b.innerHTML = '<span class="hotspot-chip"></span><span class="hotspot-preview"></span>';
    b.querySelector('.hotspot-chip').append(document.createTextNode(h.label));
    b.querySelector('.hotspot-preview').textContent = h.preview || '';
    b.addEventListener('click', () => openSection(h.id));
    b.addEventListener('pointerenter', () => { if (world) world.setHover(h.id); });
    b.addEventListener('pointerleave', () => { if (world) world.setHover(null); });
    b.addEventListener('focus', () => { if (world) world.setHover(h.id); });
    b.addEventListener('blur', () => { if (world) world.setHover(null); });
    host.appendChild(b);
    labels.set(h.id, b);
  });
}

function updateLabels(screens) {
  const placed = [];
  const list = screens.filter((s) => s.visible).sort((a, b) => a.y - b.y);
  for (const s of screens) {
    const el = labels.get(s.id); if (!el) continue;
    el.classList.toggle('is-offscreen', !s.visible);
  }
  for (const s of list) {
    const el = labels.get(s.id); if (!el) continue;
    const w = (el.firstChild ? el.firstChild.offsetWidth : 120) || 120;
    let dy = 0;
    // push a label's text chip down until it no longer covers a neighbour
    for (let tries = 0; tries < 6; tries++) {
      const hit = placed.find((p) => Math.abs(p.x - s.x) < (p.w + w) / 2 + 4 && Math.abs(p.y - (s.y + dy)) < 36);
      if (!hit) break;
      dy = hit.y + 38 - s.y;
    }
    placed.push({ x: s.x, y: s.y + dy, w });
    el.style.setProperty('--dy', dy.toFixed(0) + 'px');
    el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
    el.style.zIndex = String(Math.round(s.y));
  }
}

function setLabelHover(id) {
  labels.forEach((el, key) => { el.classList.toggle('is-hover', key === id); if (key === id) el.style.zIndex = '9999'; });
}

/* ------------------------------------------------------------------ */
/* 4. views, panels, menu                                              */
/* ------------------------------------------------------------------ */
const hint = $('hint');
let hintTimer = 0;
function showHint() {
  if (!hint) return;
  hint.classList.add('is-visible');
  clearTimeout(hintTimer); hintTimer = setTimeout(hideHint, 7000);
}
function hideHint() { if (hint) hint.classList.remove('is-visible'); clearTimeout(hintTimer); }

function setView(view) {
  currentView = view;
  const mode = view === 'home' ? 'home' : view === 'explore' ? 'explore' : 'section';
  body.dataset.view = mode;
}

function closePanels() {
  $$('.panel.is-open').forEach((p) => p.classList.remove('is-open'));
  if (world) world.setViewShift(0, 0, 0.9);
}

// On the home screen the text sits on the left (desktop) or bottom (phone), so slide the world the other way.
const homeShift = () => (isNarrow() ? [0, 0.1] : [-0.11, 0]);

function goHome() {
  closeMenu(); closePanels(); hideHint();
  setView('home'); lastBase = 'home';
  if (world) { world.flyTo('home'); world.setAutoRotate(true); world.setViewShift(...homeShift(), 1.2); }
  sound.whoosh();
}

function goExplore() {
  closeMenu(); closePanels();
  setView('explore'); lastBase = 'explore';
  if (world) { world.flyTo('explore'); world.setAutoRotate(false); }
  showHint();
}

const TOUR_TIPS = {
  about: 'Double-click empty space to hear the next sentence.',
  astropulse: 'Double-click empty space to meet the team, one by one.',
  nexora: 'Double-click empty space to meet the team, one by one.',
  healthgis: 'Double-click empty space to meet the team, one by one.',
};
const tipsShown = new Set();

function openSection(id) {
  if (!world) return;
  const panel = $('panel-' + id);
  closeMenu(); hideHint();
  if (currentView === 'home' || currentView === 'explore') lastBase = currentView;
  setView(id);
  world.setAutoRotate(false);
  world.flyTo(id);
  $$('.panel.is-open').forEach((p) => { if (p !== panel) p.classList.remove('is-open'); });
  if (panel) {
    panel.classList.add('is-open');
    panel.scrollTop = 0;
    setTimeout(() => { try { panel.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 450);
    // keep the scene visible beside (desktop) or above (phone) the panel
    world.setViewShift(isNarrow() ? 0 : 0.13, isNarrow() ? 0.17 : 0, 1.2);
  }
  sound.whoosh(); sound.open();
  if (TOUR_TIPS[id] && !tipsShown.has(id)) { tipsShown.add(id); setTimeout(() => toast(TOUR_TIPS[id], 5200), 2200); }
}

function closeSection() {
  sound.close();
  closePanels();
  if (lastBase === 'home') goHome(); else goExplore();
}

/* menu */
const menu = $('menu'), menuBtn = $('btn-menu');
function openMenu() { menu.classList.add('is-open'); menuBtn.setAttribute('aria-expanded', 'true'); }
function closeMenu() { menu.classList.remove('is-open'); menuBtn.setAttribute('aria-expanded', 'false'); }
menuBtn.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.contains('is-open') ? closeMenu() : openMenu(); });
document.addEventListener('click', (e) => { if (!menu.contains(e.target) && e.target !== menuBtn) closeMenu(); });

$$('#menu a[data-go]').forEach((a) => {
  a.addEventListener('click', (e) => {
    if (!body.classList.contains('mode-3d')) return;      // plain page: normal anchor scrolling
    e.preventDefault();
    const go = a.dataset.go;
    if (go === 'home') goHome(); else openSection(go);
  });
});

/* buttons */
$('btn-explore').addEventListener('click', () => { sound.whoosh(); goExplore(); });
$('brand-btn').addEventListener('click', () => { if (body.classList.contains('mode-3d')) goHome(); else window.scrollTo({ top: 0, behavior: 'smooth' }); });
$('btn-reset').addEventListener('click', () => { if (currentView === 'home') goHome(); else if (lastBase === 'home' && currentView === 'explore') goHome(); else goExplore(); });
$$('[data-close]').forEach((b) => b.addEventListener('click', closeSection));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (menu.classList.contains('is-open')) { closeMenu(); menuBtn.focus(); return; }
    if (currentView !== 'home' && currentView !== 'explore') closeSection();
    else if (currentView === 'explore') goHome();
  }
  if ((e.key === 'ArrowRight' || e.key === ' ') && world && body.dataset.view === 'section' && document.activeElement === document.body) {
    if (e.key === ' ') e.preventDefault();
    world.next();
  }
});

/* ------------------------------------------------------------------ */
/* 5. sound                                                            */
/* ------------------------------------------------------------------ */
const soundBtn = $('btn-sound');
soundBtn.addEventListener('click', async () => {
  const on = soundBtn.getAttribute('aria-pressed') === 'true';
  if (on) {
    sound.disable();
    soundBtn.setAttribute('aria-pressed', 'false');
    soundBtn.querySelector('.btn-label').textContent = 'Sound off';
  } else {
    const ok = await sound.enable();            // must run inside this click
    if (ok) {
      soundBtn.setAttribute('aria-pressed', 'true');
      soundBtn.querySelector('.btn-label').textContent = 'Sound on';
      sound.open();
    } else {
      toast('Your browser did not allow sound. The site works silently.');
    }
  }
});

/* ------------------------------------------------------------------ */
boot();
