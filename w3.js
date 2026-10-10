/* ---------------------------------------------------------------- */
  /* 7. project office buildings (smaller, with glass cabins inside)   */
  /* ---------------------------------------------------------------- */
  const HQ = { x: -6.0, z: 18.0 };
  const HQ2 = { x: -15.5, z: 7.5 };
  const HQ3 = { x: 24.0, z: -4.0 };
  const FLOOR = 0.14;
  const companyCfg = (id) => ((config.companies || {})[id]) || {};

  function buildOfficeHQ(o) {
    const H = new THREE.Group(); H.position.set(o.x, 0, o.z); H.scale.setScalar(OFFICE_SCALE); W.add(H);
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

    // glass CABINS: one little room round every desk, each with its own colour frame
    [-0.95, 0.55].forEach((off, k) => {
      const xs = k === 0 ? DESK_X.map((x) => x + off) : [DESK_X[DESK_X.length - 1] + off];
      xs.forEach((x) => {
        const pane = bx(0.03, 0.85, 1.3, x, 0.57, -1.6, '#bfe4ff', { transparent: true, opacity: 0.3, depthWrite: false }); pane.castShadow = false;
        bx(0.05, 0.05, 1.3, x, 1.0, -1.6, o.accent).castShadow = false;
        bx(0.05, 0.85, 0.05, x, 0.57, -0.95, o.accent2).castShadow = false;
        bx(0.05, 0.85, 0.05, x, 0.57, -2.25, o.accent2).castShadow = false;
      });
    });
    DESK_X.forEach((x, i) => {            // cabin number plates
      bx(0.34, 0.1, 0.03, x - 0.2, 0.96, -0.93, '#ffffff', { emissive: o.accent, emissiveIntensity: 0.25 }).castShadow = false;
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
      [-0.85, 0.85].forEach((dx) => bx(0.07, 1.0, 0.07, BX + dx, 0.5, BZ, '#8a5a44'));
      bx(1.98, 1.34, 0.05, BX, 1.2, BZ - 0.04, '#2b2850');
      const board = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.267), new THREE.MeshBasicMaterial({ map: btex, fog: false }));
      board.position.set(BX, 1.2, BZ - 0.01); H.add(board);
    }

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

    // the ROOF group: everything above the ground floor. It lifts off while the office is visited.
    const roof = new THREE.Group(); H.add(roof);
    H.children.slice().forEach((c) => { if (c !== roof && (c.isMesh || c.isSprite) && c.position.y >= 1.3) roof.add(c); });
    return { H, gate, roof, accent: o.accent, id: o.id, team: [] };
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
  const hqGround = (x, z) => (Math.abs(x) < 3.6 && z < 0.5 && z > -3.0 ? FLOOR : 0.045);
  const reversed = (list) => list.slice().reverse();
  const goList = (pts) => pts.map((p) => ({ go: p }));
  function DESK_X0(i) { return [-2.6, -1.1, 0.4, 1.9][i]; }

  await stage(0.8, 'Waking up the villagers', () => {
    const me = makePerson({ shirt: '#ff6b5e', pants: '#2b2850', hair: '#241f4d', backpack: '#e8b23a', skin: '#e9b48d', shoes: '#fff8ec' });
    aboutAgent = makeAgent(me, W, { x: -4.5, z: 7.4, heading: -Math.PI / 3, ground: () => 0, steps: [{ wait: Infinity, pose: 'talk' }] });

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
      x: -2.6, z: 2.4, face: [-1, 0], ground: hqGround, speed: 0.8,
      steps: [
        { go: [-2.6, 1.3] }, { wait: 4, pose: 'water', face: [-1, 0] },
        { go: [-2.6, 2.4] }, { wait: 4, pose: 'water', face: [-1, 0] },
        { go: [2.6, 2.4] }, { wait: 0.3, face: [1, 0] },
        { go: [2.6, 1.3] }, { wait: 4, pose: 'water', face: [1, 0] },
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

    // lighthouse (moved a little inland so the railway can run round the island)
    const lh = new THREE.Group(); lh.position.set(29, 0, 25); W.add(lh);
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
