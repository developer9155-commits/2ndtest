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
  let teamSink = null;       // while set, every new agent is also added to this office's team list
  let aboutAgent = null;     // the "About me" person
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
    if (teamSink) teamSink.push(a);
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
  /* 6.5 the airport: the plane takes off, flies a lap and lands       */
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
    box(st, 8.5, 0.16, 1.5, 0, 0.08, 1.75, '#e4def7');
    box(st, 8.5, 0.02, 0.12, 0, 0.17, 1.08, '#e8b23a').castShadow = false;
    box(st, 3.2, 1.1, 1.5, -0.8, 0.55, 3.5, '#fff1dc');
    box(st, 3.6, 0.1, 2.2, -0.8, 1.15, 3.3, '#4fae7a');
    box(st, 0.5, 0.75, 0.03, -1.6, 0.4, 2.76, '#6c58cf');
    box(st, 1.0, 0.5, 0.04, -0.2, 0.65, 2.76, '#bfe4ff', { emissive: '#9fd8ff', emissiveIntensity: 0.3 });
    const nameTex = canvasTextureWH(512, 128, (g, w, h) => {
      g.fillStyle = '#241f4d'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffe08a'; g.fillRect(0, h - 10, w, 10);
      g.fillStyle = '#ffffff'; g.font = '800 54px system-ui, "Segoe UI", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ISLAND STATION', w / 2, h / 2 - 4);
    });
    const nameSign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.45), new THREE.MeshBasicMaterial({ map: nameTex, fog: false }));
    nameSign.position.set(-0.8, 1.5, 2.2); nameSign.rotation.y = Math.PI; st.add(nameSign);
    [-2.4, 0.9, 2.5].forEach((x) => cyl(st, 0.04, 0.04, 1.2, 6, x, 0.76, 1.1, '#8a84b8'));
    box(st, 6.0, 0.08, 1.5, 0.1, 1.38, 1.65, '#4fae7a');
    [[1.6, 2.15], [3.0, 2.15]].forEach(([x, z]) => {
      box(st, 0.8, 0.05, 0.3, x, 0.34, z, '#c9966f'); box(st, 0.8, 0.3, 0.04, x, 0.5, z + 0.15, '#2b2850');
    });
    box(st, 0.5, 0.25, 0.04, 2.3, 1.22, 1.1, '#241f4d').castShadow = false;
    const stGlow = glow(st, 0xffd36e, 1.0, 0.5, 0.1, 1.25, 1.5);

    // a passenger waits on the platform and watches the track
    const px = sx * (TRACK_R - 1.75) / TRACK_R, pz = sz * (TRACK_R - 1.75) / TRACK_R;
    const tgx = -Math.sin(STATION_A), tgz = Math.cos(STATION_A);
    const passenger = makePerson({ shirt: '#e8b23a', pants: '#2b2850', hair: '#7a4a32', skin: '#f6d2b4', hairStyle: 'pony', shoes: '#8a5a44' });
    makeAgent(passenger, W, { x: px + tgx * 1.5, z: pz + tgz * 1.5, face: [Math.cos(STATION_A), Math.sin(STATION_A)], ground: () => 0.16, steps: [{ wait: Infinity, pose: 'idle' }] });

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
      stGlow.material.opacity = 0.45 + Math.sin(t * 2) * 0.08;
    });
  });
