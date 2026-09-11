/* ============================================================
   game.js — "PUMPKIN RUN": a 3-lane endless runner
   window.HW.game.{ init, start, stop, restart, isRunning }
   ============================================================ */
(function (global) {
  'use strict';
  var HW = global.HW || (global.HW = {});

  /* ---------------- tuning ---------------- */
  var LANES        = [-2.15, 0, 2.15];
  var TRACK_LEN    = 200;      // world units of recycled scenery
  var SPAWN_Z      = -92;      // where obstacles are born
  var DESPAWN_Z    = 14;
  var SPEED_START  = 13.5;
  var SPEED_MAX    = 33;
  var SPEED_RAMP   = 0.34;     // units/sec added per second
  var GRAVITY      = -26;
  var JUMP_V       = 9.6;
  var SLIDE_TIME   = 0.62;
  var LANE_SNAP    = 11;       // lane change responsiveness
  var GAP_START    = 8.0;
  var GAP_MIN      = 1.15;     // below this the ghost has you
  var GAP_DRAIN    = 0.16;     // per second
  var GAP_HIT      = 2.6;      // cost of eating an obstacle
  var GAP_CANDY    = 0.85;
  var WARN_LEAD_Z  = -40;      // ghost reveals itself here
  var CHASE_Y      = 3.5;     // it hunts from above and behind
  var CHASE_NEAR   = 2.0;      // right on your shoulders
  var CHASE_FAR    = 3.8;      // never drawn closer to the lens than this
  var CAM_Z        = 9.2;
  var CAM_Y        = 3.2;

  /* ---------------- state ---------------- */
  var renderer, scene, camera, canvas, clock;
  var player, head, torso, coat, legL, legR, armL, armR, chaser, track, trackMat;
  var scenery = [], items = [], shards = [], flash, ring;
  var raf = 0, running = false, dead = false, booted = false;

  var speed, dist, candy, gap, laneIdx, laneX, vy, y, sliding, slideT, stumble;
  var nextSpawnIn, deadT, headHidden;
  var warnLane = -1, warnText = null;

  var dom = {};
  var onDead = null;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.random() * arr.length | 0]; }

  /* =========================================================
     build
     ========================================================= */
  function build() {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0418);
    scene.fog = new THREE.Fog(0x160a2c, 26, 78);

    camera = new THREE.PerspectiveCamera(52, 1, 0.1, 260);
    camera.position.set(0, CAM_Y, CAM_Z);

    scene.add(new THREE.AmbientLight(0x3b2470, 1.05));
    var key = new THREE.DirectionalLight(0x9db4ff, 0.7);
    key.position.set(-5, 9, 4);
    scene.add(key);
    var warm = new THREE.PointLight(0xff7a18, 1.5, 22, 2);
    warm.position.set(0, 3, 2);
    scene.add(warm);

    buildTrack();
    buildScenery();
    buildPlayer();
    buildChaser();
    buildFx();

    clock = new THREE.Clock();
    resize();
    global.addEventListener('resize', resize);
    bindInput();
  }

  function trackTexture() {
    var s = 256, c = document.createElement('canvas');
    c.width = c.height = s;
    var g = c.getContext('2d');
    g.fillStyle = '#2a1640'; g.fillRect(0, 0, s, s);
    for (var i = 0; i < 260; i++) {
      g.fillStyle = 'rgba(' + (40 + Math.random() * 60 | 0) + ',' +
                              (24 + Math.random() * 40 | 0) + ',' +
                              (70 + Math.random() * 60 | 0) + ',' + rnd(.25, .7).toFixed(2) + ')';
      var w = rnd(6, 34), h = rnd(4, 16);
      g.fillRect(Math.random() * s, Math.random() * s, w, h);
    }
    // faint plank seams
    g.strokeStyle = 'rgba(12,4,24,.75)'; g.lineWidth = 3;
    for (var k = 0; k < 5; k++) {
      var yy = k * s / 5;
      g.beginPath(); g.moveTo(0, yy); g.lineTo(s, yy); g.stroke();
    }
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2, 26);
    return t;
  }

  function buildTrack() {
    trackMat = new THREE.MeshStandardMaterial({ map: trackTexture(), roughness: 1 });
    track = new THREE.Mesh(new THREE.PlaneGeometry(9.4, 260), trackMat);
    track.rotation.x = -Math.PI / 2;
    track.position.z = -110;
    scene.add(track);

    // glowing lane rails so the three lanes always read
    var railMat = new THREE.MeshBasicMaterial({ color: 0xff7a18, transparent: true, opacity: 0.55 });
    [-3.4, 3.4].forEach(function (x) {
      var r = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 260), railMat);
      r.position.set(x, 0.03, -110);
      scene.add(r);
    });
    var dashMat = new THREE.MeshBasicMaterial({ color: 0x8a4dff, transparent: true, opacity: 0.28 });
    [-1.07, 1.07].forEach(function (x) {
      var r = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 260), dashMat);
      r.position.set(x, 0.02, -110);
      scene.add(r);
    });

    // outer void floor
    var vf = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 260),
      new THREE.MeshStandardMaterial({ color: 0x100722, roughness: 1 })
    );
    vf.rotation.x = -Math.PI / 2;
    vf.position.set(0, -0.06, -110);
    scene.add(vf);
  }

  function buildScenery() {
    var trunkMat = new THREE.MeshStandardMaterial({ color: 0x241338, roughness: 1 });
    var stoneMat = new THREE.MeshStandardMaterial({ color: 0x4a4160, roughness: 0.9 });
    var lampMat  = new THREE.MeshBasicMaterial({ color: 0xff9a3c });

    for (var i = 0; i < 46; i++) {
      var side = i % 2 ? 1 : -1;
      var x = side * rnd(5.2, 11);
      var z = -(i / 46) * TRACK_LEN - rnd(0, 4);
      var o;

      var kind = Math.random();
      if (kind < 0.45) {                       // dead tree
        o = new THREE.Group();
        var h = rnd(4, 8.5);
        var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.3, h, 6), trunkMat);
        trunk.position.y = h / 2;
        o.add(trunk);
        for (var b = 0; b < 3; b++) {
          var bl = rnd(1, 2.4);
          var br = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.11, bl, 5), trunkMat);
          br.position.set(0, h * rnd(0.55, 0.9), 0);
          br.rotation.z = rnd(-1.1, 1.1);
          br.rotation.x = rnd(-0.6, 0.6);
          br.translateY(bl / 2);
          o.add(br);
        }
      } else if (kind < 0.8) {                 // gravestone
        o = new THREE.Group();
        var gh = rnd(1, 1.9);
        var slab = new THREE.Mesh(new THREE.BoxGeometry(rnd(0.7, 1.2), gh, 0.22), stoneMat);
        slab.position.y = gh / 2;
        o.add(slab);
        var cap = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.22, 12, 1, false, 0, Math.PI), stoneMat);
        cap.rotation.z = -Math.PI / 2;
        cap.rotation.y = Math.PI / 2;
        cap.position.y = gh;
        o.add(cap);
        o.rotation.y = rnd(-0.5, 0.5);
      } else {                                  // lantern post
        o = new THREE.Group();
        var post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3.4, 6), trunkMat);
        post.position.y = 1.7; o.add(post);
        var bulb = new THREE.Mesh(new THREE.OctahedronGeometry(0.24), lampMat);
        bulb.position.y = 3.5; o.add(bulb);
        var gl = HW.makeGlowSprite(0xffa040, 0.75);
        gl.scale.setScalar(3.2); gl.position.y = 3.5;
        o.add(gl);
      }

      o.position.x = x;
      o.position.z = z;
      scene.add(o);
      scenery.push(o);
    }
  }

  function buildPlayer() {
    player = new THREE.Group();

    var clothMat = new THREE.MeshStandardMaterial({
      color: 0x6b3fb8, roughness: 0.8,
      emissive: new THREE.Color(0x24104a), emissiveIntensity: 1
    });
    var limbMat = new THREE.MeshStandardMaterial({
      color: 0x3d2470, roughness: 0.9,
      emissive: new THREE.Color(0x1a0a38), emissiveIntensity: 1
    });

    var torsoGeo = THREE.CapsuleGeometry
      ? new THREE.CapsuleGeometry(0.3, 0.55, 6, 12)
      : new THREE.CylinderGeometry(0.3, 0.34, 0.9, 10);
    torso = new THREE.Mesh(torsoGeo, clothMat);
    torso.position.y = 1.02;
    player.add(torso);

    // ragged coat tails
    coat = new THREE.Mesh(new THREE.ConeGeometry(0.52, 0.72, 10, 1, true), clothMat);
    coat.position.y = 0.78;
    coat.rotation.x = Math.PI;
    player.add(coat);

    head = HW.makePumpkin({ radius: 0.42, ribs: 8, simple: true, glow: 1 });
    head.position.y = 1.72;
    head.rotation.y = 0;               // twisted back so we see the face
    player.add(head);

    function limb(w, h, x, y) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), limbMat);
      m.geometry.translate(0, -h / 2, 0);   // pivot at the top
      m.position.set(x, y, 0);
      player.add(m);
      return m;
    }
    legL = limb(0.17, 0.72, -0.15, 0.72);
    legR = limb(0.17, 0.72,  0.15, 0.72);
    armL = limb(0.13, 0.58, -0.36, 1.32);
    armR = limb(0.13, 0.58,  0.36, 1.32);

    // the head is a lantern: let it actually light the road
    var lamp = new THREE.PointLight(0xff9a3c, 2.1, 11, 2);
    lamp.position.set(0, 1.7, 0.3);
    player.add(lamp);

    player.position.set(0, 0, 0);
    scene.add(player);
  }

  function buildChaser() {
    chaser = HW.makeGhost({ radius: 0.78, color: 0xcbb6ff, opacity: 0.9 });
    chaser.position.set(0, CHASE_Y, CHASE_FAR);
    var gl = HW.makeGlowSprite(0x9d6bff, 0.3, true);
    gl.scale.setScalar(2.2);
    chaser.add(gl);
    scene.add(chaser);
  }

  function buildFx() {
    flash = HW.makeGlowSprite(0xffd08a, 0, false);
    flash.scale.setScalar(1);
    scene.add(flash);

    ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.62, 40),
      new THREE.MeshBasicMaterial({
        color: 0xff8a1e, transparent: true, opacity: 0,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    scene.add(ring);

    var shardGeo = new THREE.TetrahedronGeometry(0.11);
    for (var i = 0; i < 110; i++) {
      var m = new THREE.Mesh(shardGeo, new THREE.MeshStandardMaterial({
        color: i % 4 === 0 ? 0x5a2a00 : 0xff7a18,
        emissive: new THREE.Color(0xff5a00), emissiveIntensity: i % 4 === 0 ? 0.2 : 1.1,
        roughness: 0.7
      }));
      m.visible = false;
      m.userData.v = new THREE.Vector3();
      m.userData.spin = new THREE.Vector3();
      scene.add(m);
      shards.push(m);
    }
  }

  /* =========================================================
     obstacles & pickups
     ========================================================= */
  var _webTex = null;
  function webTexture() {
    if (_webTex) return _webTex;
    var n = 256, c = document.createElement('canvas');
    c.width = c.height = n;
    var g = c.getContext('2d');
    var cx = n / 2, cy = n / 2, R = n * 0.47, spokes = 12, rings = 6;
    g.strokeStyle = '#ffffff';
    g.lineCap = 'round';
    g.lineJoin = 'round';

    // radial spokes
    g.lineWidth = 6;
    for (var i = 0; i < spokes; i++) {
      var a = (i / spokes) * Math.PI * 2;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      g.stroke();
    }

    // concentric strands, sagging between the spokes
    g.lineWidth = 4.5;
    for (var r = 1; r <= rings; r++) {
      var rad = (r / rings) * R;
      g.beginPath();
      for (var k = 0; k <= spokes; k++) {
        var aa = (k / spokes) * Math.PI * 2;
        var x = cx + Math.cos(aa) * rad, y = cy + Math.sin(aa) * rad;
        k ? g.lineTo(x, y) : g.moveTo(x, y);
        // pull the midpoint of each segment inward for the classic sag
        if (k < spokes) {
          var mid = ((k + 0.5) / spokes) * Math.PI * 2;
          g.lineTo(cx + Math.cos(mid) * rad * 0.87, cy + Math.sin(mid) * rad * 0.87);
        }
      }
      g.stroke();
    }

    // anchor strands out to the corners
    g.lineWidth = 5;
    [[0, 0], [n, 0], [0, n], [n, n]].forEach(function (pt) {
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(pt[0], pt[1]); g.stroke();
    });

    _webTex = new THREE.CanvasTexture(c);
    return _webTex;
  }

  var _candyTex = null;
  function candyTexture() {
    if (_candyTex) return _candyTex;
    var w = 8, h = 64, c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d');
    g.fillStyle = '#fff8e6'; g.fillRect(0, 0, w, h * 0.34);
    g.fillStyle = '#ff8a1e'; g.fillRect(0, h * 0.34, w, h * 0.36);
    g.fillStyle = '#ffd93c'; g.fillRect(0, h * 0.70, w, h * 0.30);
    _candyTex = new THREE.CanvasTexture(c);
    return _candyTex;
  }

  function makeFire() {
    var g = new THREE.Group();
    var tiers = [
      { c: 0xff2a00, r: 0.62, h: 2.0, n: 3 },   // deep red base
      { c: 0xff7a18, r: 0.44, h: 1.6, n: 3 },   // orange body
      { c: 0xffd54a, r: 0.24, h: 1.0, n: 2 }    // yellow heart
    ];
    for (var t = 0; t < tiers.length; t++) {
      for (var i = 0; i < tiers[t].n; i++) {
        var geo = new THREE.ConeGeometry(tiers[t].r * rnd(0.8, 1.15), tiers[t].h * rnd(0.8, 1.2), 8);
        geo.translate(0, geo.parameters.height / 2, 0);
        var f = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          color: tiers[t].c, transparent: true, opacity: 0.55,
          blending: THREE.AdditiveBlending, depthWrite: false
        }));
        f.position.set(rnd(-0.3, 0.3), 0, rnd(-0.22, 0.22));
        f.userData.ph = Math.random() * 6.3;
        g.add(f);
      }
    }
    var coals = new THREE.Mesh(
      new THREE.CircleGeometry(0.85, 18),
      new THREE.MeshBasicMaterial({
        color: 0xff4400, transparent: true, opacity: 0.7,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    coals.rotation.x = -Math.PI / 2;
    coals.position.y = 0.03;
    g.add(coals);
    var gl = HW.makeGlowSprite(0xff7a18, 0.95, false);
    gl.scale.setScalar(4.6); gl.position.y = 0.95;
    g.add(gl);
    g.userData.flames = true;
    return g;
  }

  function makeWeb() {
    var g = new THREE.Group();

    // the web itself — hangs from above, you go under it
    var web = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 2.4),
      new THREE.MeshBasicMaterial({
        map: webTexture(), color: 0xdfe6ff, transparent: true, opacity: 0.85,
        side: THREE.DoubleSide, depthWrite: false
      })
    );
    web.position.y = 2.75;
    g.add(web);

    // a solid rail along the bottom edge so the hitbox reads
    var rail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 2.3, 8),
      new THREE.MeshStandardMaterial({
        color: 0xf2ecff, emissive: new THREE.Color(0xbba6ff), emissiveIntensity: 0.7, roughness: 1
      })
    );
    rail.rotation.z = Math.PI / 2;
    rail.position.y = 1.68;
    g.add(rail);

    var spider = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 10, 8),
      new THREE.MeshStandardMaterial({
        color: 0x1a0026, emissive: new THREE.Color(0xff2e57), emissiveIntensity: 1.1, roughness: 0.6
      })
    );
    spider.position.set(rnd(-0.55, 0.55), 1.9, 0.06);
    g.add(spider);

    var gl = HW.makeGlowSprite(0xb9a6ff, 0.35, false);
    gl.scale.setScalar(3.6); gl.position.y = 2.3;
    g.add(gl);
    return g;
  }

  function makeSpook() {
    var g = HW.makeGhost({ radius: 0.85, color: 0xff9ecb, opacity: 0 });
    g.position.y = 1.35;
    var gl = HW.makeGlowSprite(0xff4d7d, 0);
    gl.scale.setScalar(5);
    g.add(gl);
    g.userData.halo = gl;
    return g;
  }

  function makeCandy() {
    var g = new THREE.Group();
    var m = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.55, 12),
      new THREE.MeshStandardMaterial({
        map: candyTexture(), emissive: new THREE.Color(0xff8a00), emissiveIntensity: 0.55, roughness: 0.4
      })
    );
    g.add(m);
    var gl = HW.makeGlowSprite(0xffd166, 0.7);
    gl.scale.setScalar(1.6);
    g.add(gl);
    g.position.y = 1.15;
    return g;
  }

  var pool = { fire: [], web: [], spook: [], candy: [] };
  function acquire(type) {
    var p = pool[type];
    var o = p.pop();
    if (!o) {
      o = type === 'fire' ? makeFire() : type === 'web' ? makeWeb()
        : type === 'spook' ? makeSpook() : makeCandy();
      scene.add(o);
    }
    o.visible = true;
    return o;
  }
  function release(it) {
    it.obj.visible = false;
    pool[it.type].push(it.obj);
  }

  function spawn() {
    var roll = Math.random();
    var type = roll < 0.34 ? 'fire' : roll < 0.58 ? 'web' : roll < 0.80 ? 'spook' : 'candy';
    var lane = Math.random() * 3 | 0;

    if (type === 'candy') {
      // a little trail of candy corn down one lane
      var n = 3 + (Math.random() * 3 | 0);
      for (var i = 0; i < n; i++) addItem('candy', lane, SPAWN_Z - i * 2.4);
      nextSpawnIn = rnd(26, 38);
      return;
    }

    addItem(type, lane, SPAWN_Z);

    // sometimes a second obstacle in a different lane, never blocking all three
    if (Math.random() < 0.3 && speed > 17) {
      var other = (lane + 1 + (Math.random() * 2 | 0)) % 3;
      if (other !== lane) addItem(Math.random() < 0.5 ? 'fire' : 'web', other, SPAWN_Z - rnd(0, 1.5));
    }
    nextSpawnIn = clamp(rnd(30, 48) - (speed - SPEED_START) * 0.3, 24, 48);
  }

  function addItem(type, lane, z) {
    var o = acquire(type);
    o.position.x = LANES[lane];
    o.position.z = z;
    if (type === 'spook') {
      o.spookMat.opacity = 0;
      o.userData.halo.material.opacity = 0;
      o.userData.revealed = false;
      o.position.y = 1.35;
      o.scale.setScalar(0.6);
    }
    items.push({ type: type, lane: lane, obj: o, taken: false });
  }

  /* =========================================================
     input
     ========================================================= */
  function moveLane(d) {
    if (dead) return;
    laneIdx = clamp(laneIdx + d, 0, 2);
  }
  function jump() {
    if (dead) return;
    if (y <= 0.001) { vy = JUMP_V; sliding = false; }
  }
  function slide() {
    if (dead) return;
    if (y > 0.001) { vy = Math.min(vy, -6); }   // slam down
    sliding = true; slideT = SLIDE_TIME;
  }

  function bindInput() {
    global.addEventListener('keydown', function (e) {
      if (!running) return;
      var k = e.key;
      if (k === 'ArrowLeft'  || k === 'a' || k === 'A') { moveLane(-1); e.preventDefault(); }
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') { moveLane(1); e.preventDefault(); }
      else if (k === 'ArrowUp'    || k === 'w' || k === 'W' || k === ' ') { jump(); e.preventDefault(); }
      else if (k === 'ArrowDown'  || k === 's' || k === 'S') { slide(); e.preventDefault(); }
    }, { passive: false });

    var sx = 0, sy = 0, st = 0;
    canvas.addEventListener('touchstart', function (e) {
      var t = e.changedTouches[0];
      sx = t.clientX; sy = t.clientY; st = Date.now();
    }, { passive: true });

    canvas.addEventListener('touchend', function (e) {
      if (!running) return;
      var t = e.changedTouches[0];
      var dx = t.clientX - sx, dy = t.clientY - sy;
      if (Date.now() - st > 700) return;
      if (Math.abs(dx) < 28 && Math.abs(dy) < 28) { jump(); return; }
      if (Math.abs(dx) > Math.abs(dy)) moveLane(dx > 0 ? 1 : -1);
      else if (dy < 0) jump();
      else slide();
    }, { passive: true });
  }

  /* =========================================================
     lifecycle
     ========================================================= */
  function resetState() {
    speed = SPEED_START; dist = 0; candy = 0; gap = GAP_START;
    laneIdx = 1; laneX = 0; vy = 0; y = 0;
    sliding = false; slideT = 0; stumble = 0;
    nextSpawnIn = 34; deadT = 0; dead = false; headHidden = false;
    warnLane = -1;

    while (items.length) release(items.pop());

    player.position.set(0, 0, 0);
    player.rotation.z = 0;
    coat.scale.set(1, 1, 1);
    coat.position.y = 0.78;
    head.visible = true;
    head.position.set(0, 1.72, 0);
    head.scale.setScalar(1);
    chaser.position.set(0, CHASE_Y, CHASE_FAR);
    chaser.scale.setScalar(0.85);
    chaser.visible = false;
    chaser.setOpacity(0);

    for (var i = 0; i < shards.length; i++) shards[i].visible = false;
    flash.material.opacity = 0;
    ring.material.opacity = 0;

    setWarn(false);
    updateHud();
  }

  function setWarn(on, lane) {
    if (!dom.warn) return;
    dom.warn.classList.toggle('is-on', !!on);
    if (on) {
      var v = new THREE.Vector3(LANES[lane], 2.6, -16).project(camera);
      dom.warn.style.left = ((v.x * 0.5 + 0.5) * 100).toFixed(1) + '%';
      var dir = lane === 0 ? 'DODGE RIGHT →' : lane === 2 ? '← DODGE LEFT' : '← SPLIT →';
      if (!warnText) warnText = dom.warn.querySelector('.warn__text');
      if (warnText.textContent !== dir) warnText.textContent = dir;
    }
  }

  function updateHud() {
    if (!dom.score) return;
    dom.score.textContent = Math.floor(dist * 2 + candy * 25);
    dom.candy.textContent = candy;
    var close = gap < 4;
    dom.ghostPill.classList.toggle('is-close', close);
    dom.ghost.textContent = gap < 2.4 ? 'ON YOU!' : close ? 'CLOSE' : 'SAFE';
  }

  function die() {
    dead = true; deadT = 0;
    setWarn(false);
    updateHud();
    // ghost lunges the last of the way in
    chaser.visible = true;
    chaser.setOpacity(0.95);
  }

  function burstHead() {
    headHidden = true;
    head.visible = false;
    var origin = new THREE.Vector3(0, 1.72, 0).add(player.position);
    for (var i = 0; i < shards.length; i++) {
      var s = shards[i];
      s.visible = true;
      s.position.copy(origin);
      var dir = new THREE.Vector3(rnd(-1, 1), rnd(-0.35, 1), rnd(-1, 1)).normalize();
      s.userData.v.copy(dir).multiplyScalar(rnd(3.5, 11));
      s.userData.spin.set(rnd(-9, 9), rnd(-9, 9), rnd(-9, 9));
      s.scale.setScalar(rnd(0.6, 1.6));
    }
    flash.position.copy(origin);
    flash.scale.setScalar(5);
    flash.material.opacity = 1;
    ring.position.copy(origin);
    ring.scale.setScalar(0.6);
    ring.material.opacity = 0.95;
    ring.lookAt(camera.position);
  }

  /* =========================================================
     frame
     ========================================================= */
  function frame() {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    var dt = Math.min(clock.getDelta(), 0.05);
    var t = clock.elapsedTime;

    if (!dead) step(dt);
    else stepDeath(dt);

    animateFlames(t);
    renderer.render(scene, camera);
  }

  function step(dt) {
    /* --- speed & distance --- */
    if (stumble > 0) { stumble -= dt; }
    var v = speed * (stumble > 0 ? 0.55 : 1);
    speed = Math.min(SPEED_MAX, speed + SPEED_RAMP * dt);
    dist += v * dt;

    /* --- the ghost never stops --- */
    gap -= GAP_DRAIN * dt;
    if (gap <= GAP_MIN) { die(); return; }

    /* --- player: lane, jump, slide --- */
    laneX += (LANES[laneIdx] - laneX) * Math.min(1, LANE_SNAP * dt);
    vy += GRAVITY * dt;
    y += vy * dt;
    if (y < 0) { y = 0; vy = 0; }
    if (sliding) { slideT -= dt; if (slideT <= 0) sliding = false; }

    player.position.x = laneX;
    player.position.y = y;
    player.rotation.z = (LANES[laneIdx] - laneX) * -0.16;

    var squash = sliding ? 0.45 : 1;
    torso.scale.set(1 / (0.55 + 0.45 * squash), squash, 1);
    torso.position.y = 1.02 * squash;
    coat.scale.set(1, squash, 1);
    coat.position.y = 0.78 * squash;
    head.position.y = (1.72 - (1 - squash) * 0.62);
    head.rotation.z = Math.sin(dist * 1.4) * 0.05;

    // run cycle (freezes mid-air, folds up in a slide)
    var cyc = dist * 1.35;
    var swing = y > 0.02 ? 0.5 : Math.sin(cyc) * (sliding ? 0.25 : 1.05);
    legL.rotation.x =  swing;
    legR.rotation.x = -swing;
    armL.rotation.x = -swing * 0.75;
    armR.rotation.x =  swing * 0.75;
    if (sliding) { legL.rotation.x = legR.rotation.x = -1.15; }

    /* --- scenery & track scroll --- */
    trackMat.map.offset.y -= (v * dt) / 10;
    for (var i = 0; i < scenery.length; i++) {
      var s = scenery[i];
      s.position.z += v * dt;
      if (s.position.z > DESPAWN_Z) s.position.z -= TRACK_LEN;
    }

    /* --- obstacles --- */
    nextSpawnIn -= v * dt;
    if (nextSpawnIn <= 0) spawn();

    var showWarn = false;
    for (var j = items.length - 1; j >= 0; j--) {
      var it = items[j];
      var o = it.obj;
      o.position.z += v * dt;

      if (it.type === 'candy') {
        o.rotation.y += dt * 3.4;
        o.position.y = 1.15 + Math.sin(dist * 0.9 + j) * 0.12;
      }

      if (it.type === 'spook') {
        // it lurks unseen, then snaps into view with a warning
        if (!it.taken && o.position.z > WARN_LEAD_Z) {
          if (!o.userData.revealed) o.userData.revealed = true;
          var f = clamp((o.position.z - WARN_LEAD_Z) / 16, 0, 1);
          o.spookMat.opacity = f * 0.95;
          o.userData.halo.material.opacity = f * 0.8;
          o.position.y = 1.35 + Math.sin(dist * 2 + j) * 0.18;
          o.scale.setScalar(0.6 + f * 0.55);
          if (o.position.z < -8) { showWarn = true; warnLane = it.lane; }
        }
      }

      // --- collision: everything lives at player z = 0 ---
      if (!it.taken && Math.abs(o.position.z) < 0.95 && it.lane === laneIdx) {
        if (it.type === 'candy') {
          it.taken = true;
          o.visible = false;
          candy++;
          gap = Math.min(GAP_START, gap + GAP_CANDY);
        } else {
          var cleared =
            (it.type === 'fire'  && y > 1.05) ||
            (it.type === 'web'   && sliding)  ||
            (it.type === 'spook' && false);      // a ghost can only be side-stepped
          if (!cleared) {
            it.taken = true;
            gap -= GAP_HIT;
            stumble = 0.45;
            speed = Math.max(SPEED_START, speed - 2.2);
            kick();
            if (gap <= GAP_MIN) { die(); return; }
          }
        }
      }

      if (o.position.z > DESPAWN_Z) { release(it); items.splice(j, 1); }
    }
    setWarn(showWarn, warnLane);

    /* --- chaser --- */
    var d      = clamp((gap - GAP_MIN) / (GAP_START - GAP_MIN), 0, 1);
    // it really is `gap` units behind you — just never closer to the
    // lens than CHASE_FAR, or it swallows the whole frame
    var wantZ  = Math.min(gap, CHASE_FAR);
    var near   = 1 - d;
    chaser.position.z += (wantZ - chaser.position.z) * Math.min(1, 3.5 * dt);
    var sway = laneX * 0.62 + Math.sin(clock.elapsedTime * 0.85) * 0.55;
    chaser.position.x += (sway - chaser.position.x) * Math.min(1, 2.2 * dt);
    chaser.position.y = CHASE_Y + Math.sin(clock.elapsedTime * 2.1) * 0.24;
    chaser.rotation.z = Math.sin(clock.elapsedTime * 1.3) * 0.09;
    // it only materialises once it is genuinely a threat
    chaser.setOpacity(clamp(1.15 - d * 1.5, 0, 0.95));
    chaser.visible = chaser.spookMat.opacity > 0.02;
    chaser.scale.setScalar(0.85 + near * 0.25);

    /* --- camera --- */
    camera.position.x += (laneX * 0.42 - camera.position.x) * Math.min(1, 4 * dt);
    camera.position.y += ((CAM_Y + y * 0.28) - camera.position.y) * Math.min(1, 5 * dt);
    camera.position.z = CAM_Z + near * 0.5 + (stumble > 0 ? rnd(-0.12, 0.12) : 0);
    camera.lookAt(laneX * 0.5, 1.35 + y * 0.3, -9);

    scene.fog.far = 78 + (speed - SPEED_START) * 0.6;

    updateHud();
  }

  function kick() {
    // screen-shake substitute: nudge the camera and flash the rails
    camera.position.y += 0.25;
    flash.position.set(laneX, 1.4, 0.2);
    flash.scale.setScalar(3);
    flash.material.opacity = 0.6;
  }

  function stepDeath(dt) {
    deadT += dt;
    if (!headHidden && deadT > 0.30) burstHead();

    // ghost swells over the camera
    chaser.visible = true;
    var lungeZ = deadT < 0.38 ? 1.4 : CAM_Z + 5;
    chaser.position.z += (lungeZ - chaser.position.z) * Math.min(1, 5 * dt);
    chaser.position.x += (player.position.x - chaser.position.x) * Math.min(1, 4 * dt);
    chaser.position.y += (2.15 - chaser.position.y) * Math.min(1, 4 * dt);
    chaser.scale.setScalar(1 + Math.min(deadT, 0.38) * 0.5);
    chaser.setOpacity(deadT < 0.38 ? 0.95
      : Math.max(0, 0.95 - (deadT - 0.38) * 1.8));

    if (headHidden) {
      for (var i = 0; i < shards.length; i++) {
        var s = shards[i];
        if (!s.visible) continue;
        s.userData.v.y += GRAVITY * dt * 0.55;
        s.position.addScaledVector(s.userData.v, dt);
        s.rotation.x += s.userData.spin.x * dt;
        s.rotation.y += s.userData.spin.y * dt;
        s.rotation.z += s.userData.spin.z * dt;
        if (s.position.y < 0.05) { s.position.y = 0.05; s.userData.v.multiplyScalar(0.35); s.userData.v.y = Math.abs(s.userData.v.y) * 0.4; }
      }
      // headless body crumples, then stays down
      player.rotation.z = Math.min(Math.PI / 2, player.rotation.z + dt * 1.6);
      player.position.y = Math.max(0, player.position.y - dt * 1.2);
    }

    if (flash.material.opacity > 0) {
      flash.material.opacity = Math.max(0, flash.material.opacity - dt * 2.2);
      flash.scale.setScalar(flash.scale.x + dt * 14);
    }
    if (ring.material.opacity > 0) {
      ring.material.opacity = Math.max(0, ring.material.opacity - dt * 1.4);
      ring.scale.setScalar(ring.scale.x + dt * 16);
    }

    camera.position.y += ((CAM_Y - 0.3) - camera.position.y) * Math.min(1, 2 * dt);
    camera.lookAt(player.position.x, 1.5, 0);

    if (deadT > 1.5 && onDead) { var cb = onDead; onDead = null; cb(finalScore(), candy); }
  }

  function animateFlames(t) {
    for (var i = 0; i < items.length; i++) {
      var o = items[i].obj;
      if (!o.userData.flames || !o.visible) continue;
      for (var c = 0; c < o.children.length; c++) {
        var f = o.children[c];
        if (f.userData.ph === undefined) continue;
        var s = 0.78 + Math.sin(t * 9 + f.userData.ph) * 0.22;
        f.scale.set(1, s, 1);
        f.rotation.y = t * 1.6 + f.userData.ph;
      }
    }
  }

  function finalScore() { return Math.floor(dist * 2 + candy * 25); }

  function resize() {
    if (!renderer) return;
    var w = global.innerWidth, h = global.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 0.8 ? 66 : 52;
    camera.updateProjectionMatrix();
  }

  /* =========================================================
     public api
     ========================================================= */
  HW.game = {
    init: function (el, els) {
      canvas = el;
      dom = els || {};
      if (!booted) { build(); booted = true; }
      resetState();
      return this;
    },

    /* renders the scene without accepting input — used as a
       standing "attract mode" behind the start overlay        */
    prime: function () {
      if (!booted) return;
      resetState();
      if (!running) { running = true; clock.getDelta(); frame(); }
    },

    start: function (cb) {
      if (!booted) return;
      onDead = cb || null;
      resetState();
      if (!running) { running = true; clock.getDelta(); frame(); }
    },

    stop: function () {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      setWarn(false);
    },

    resume: function () {
      if (!booted || running) return;
      running = true; clock.getDelta(); frame();
    },

    isRunning: function () { return running && !dead; },
    isDead:    function () { return dead; }
  };

})(window);
