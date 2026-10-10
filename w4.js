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
  let sectionId = null, lastTap = null, aboutIdx = 0, aboutTimer = 0, bubbleHead = null;
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
  function showBubble(agent, title, text, accent) { bubbleHead = agent; drawBubble(title, text, accent || '#ff6b5e'); bubble.visible = true; dirty = true; }
  function hideBubble() { bubbleHead = null; bubble.visible = false; dirty = true; }
  function endTour() { tour.active = false; tour.i = -1; aboutTimer = 0; hideBubble(); }
  function setCutaway(activeId) {
    Object.keys(offices).forEach((k) => { const r = offices[k].roof; if (r) r.visible = k !== activeId; });
    dirty = true;
  }

  function aboutShow() {
    if (!aboutAgent || !aboutLines.length) return;
    showBubble(aboutAgent, config.name || 'About me', aboutLines[aboutIdx % aboutLines.length], '#ff6b5e');
    aboutTimer = 0;
  }
  function startAbout() { aboutIdx = 0; aboutShow(); }

  function advance() {                         // double-click / double-tap / next()
    if (flight || disposed || mode !== 'section' || !sectionId) return;
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
    if (mode === 'section' && !flight) {
      if (sectionId === 'about' && bubbleHead && aboutLines.length > 1) {
        aboutTimer += dt;
        const cur = aboutLines[aboutIdx % aboutLines.length] || '';
        if (aboutTimer > 3.4 + cur.length * 0.05) { aboutIdx++; aboutShow(); }
      }
      if (tour.active) {
        const off = offices[sectionId], ag = off && off.team[tour.i];
        if (ag) {
          ag.p.head.getWorldPosition(vHead);
          const k = 1 - Math.exp(-dt * 3.2);
          tour.pos.lerp(vA.set(vHead.x + 0.9, vHead.y + 0.15, vHead.z + 2.6), k);
          tour.tgt.lerp(vB.set(vHead.x, vHead.y - 0.1, vHead.z), k);
          camera.position.copy(tour.pos); controls.target.copy(tour.tgt); camera.lookAt(tour.tgt); dirty = true;
        }
      }
    }
    if (bubbleHead && bubble.visible) {
      bubbleHead.p.head.getWorldPosition(vHead);
      bubble.position.set(vHead.x, vHead.y + 0.2, vHead.z);
      const hv = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), asp = camera.aspect;
      const wf = asp > 1.2 ? 0.34 : Math.min(0.86, 0.34 + (1.2 - asp) * 0.9);
      const sx = wf * hv * asp;
      bubble.scale.set(sx, sx * (BH / BW), 1);
      dirty = true;
    }
  }

  function flyTo(id, o = {}) {
    const v = views[id];
    if (!v || disposed) return;
    mode = id === 'home' || id === 'explore' ? id : 'section';
    markers.visible = mode !== 'section';
    setPick(null);
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
