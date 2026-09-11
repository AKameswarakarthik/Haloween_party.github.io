/* ============================================================
   hero.js — scroll-driven 3D lantern scene
   window.HW.hero.{ init, setProgress, start, stop }
   ============================================================ */
(function (global) {
  'use strict';
  var HW = global.HW || (global.HW = {});

  var renderer, scene, camera, canvas;
  var pumpkin, embers, mistPlane, moon, moonGlow;
  var raf = 0, running = false, clock;
  var target = 0, eased = 0;

  /* how far back the camera must sit for the lantern to fit the frame:
     on a narrow screen the width, not the height, is the constraint */
  function fitDistance() {
    var aspect = global.innerWidth / global.innerHeight;
    return Math.max(7.0, 5.0 / aspect + 0.6);
  }

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function range(v, a, b) { return clamp01((v - a) / (b - a)); }
  function smooth(t) { return t * t * (3 - 2 * t); }

  HW.hero = {
    init: function (el) {
      canvas = el;
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0);

      scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x120626, 0.055);

      camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
      camera.position.set(0, 0.9, 7.6);

      /* ---- lighting: cold moonlight + a warm rim ---- */
      scene.add(new THREE.AmbientLight(0x2a1a4d, 0.9));
      var moonLight = new THREE.DirectionalLight(0x8fa8ff, 0.85);
      moonLight.position.set(-4, 6, 3);
      scene.add(moonLight);
      var rim = new THREE.DirectionalLight(0x9d4dff, 0.5);
      rim.position.set(5, -1, -4);
      scene.add(rim);

      /* ---- the moon ---- */
      moon = new THREE.Mesh(
        new THREE.SphereGeometry(2.6, 32, 24),
        new THREE.MeshBasicMaterial({ color: 0xe9e6ff })
      );
      moon.position.set(10.5, 7.2, -26);
      scene.add(moon);
      moonGlow = HW.makeGlowSprite(0xbcd0ff, 0.4, false);
      moonGlow.scale.setScalar(16);
      moonGlow.position.copy(moon.position);
      moonGlow.position.z += 0.2;
      scene.add(moonGlow);

      /* ---- distant dead trees (silhouettes) ---- */
      var treeMat = new THREE.MeshBasicMaterial({ color: 0x0d0518 });
      for (var t = 0; t < 14; t++) {
        var h = 3 + Math.random() * 5;
        var tr = new THREE.Mesh(new THREE.ConeGeometry(0.28 + Math.random() * 0.3, h, 5), treeMat);
        tr.position.set((Math.random() - 0.5) * 46, -3.2 + h / 2, -14 - Math.random() * 16);
        tr.rotation.z = (Math.random() - 0.5) * 0.2;
        scene.add(tr);
      }

      /* ---- ground + mist ---- */
      var ground = new THREE.Mesh(
        new THREE.PlaneGeometry(90, 90),
        new THREE.MeshStandardMaterial({ color: 0x1a0d2e, roughness: 1 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -3.2;
      scene.add(ground);

      mistPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 14),
        new THREE.MeshBasicMaterial({
          map: mistTexture(), transparent: true, opacity: 0.28,
          depthWrite: false, blending: THREE.AdditiveBlending
        })
      );
      mistPlane.position.set(0, -2.5, -6);
      scene.add(mistPlane);

      /* ---- the star of the show ---- */
      pumpkin = HW.makePumpkin({ radius: 1.5, ribs: 9 });
      pumpkin.position.y = 0.55;
      scene.add(pumpkin);

      /* ---- embers drifting up ---- */
      embers = makeEmbers(240);
      scene.add(embers);

      clock = new THREE.Clock();
      resize();
      global.addEventListener('resize', resize);
      return this;
    },

    setProgress: function (p) { target = clamp01(p); },
    progress:    function ()  { return eased; },

    start: function () {
      if (running) return;
      running = true;
      clock.getDelta();
      loop();
    },
    stop: function () {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  /* ---------------- helpers ---------------- */

  function mistTexture() {
    var w = 512, h = 128, c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
    for (var i = 0; i < 60; i++) {
      var x = Math.random() * w, y = h * (0.35 + Math.random() * 0.5);
      var r = 30 + Math.random() * 70;
      var g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(150,120,220,0.30)');
      g.addColorStop(1, 'rgba(90,60,160,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    return tex;
  }

  function makeEmbers(count) {
    var g = new THREE.BufferGeometry();
    var pos = new Float32Array(count * 3);
    var seed = new Float32Array(count);
    for (var i = 0; i < count; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * 22;
      pos[i * 3 + 1] = -3 + Math.random() * 12;
      pos[i * 3 + 2] = -10 + Math.random() * 13;
      seed[i] = Math.random();
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.userData.seed = seed;

    var s = 64, c = document.createElement('canvas');
    c.width = c.height = s;
    var ctx = c.getContext('2d');
    var grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,220,150,1)');
    grad.addColorStop(0.4, 'rgba(255,140,30,0.55)');
    grad.addColorStop(1, 'rgba(255,90,0,0)');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, s, s);

    var m = new THREE.PointsMaterial({
      size: 0.16, map: new THREE.CanvasTexture(c), transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9
    });
    return new THREE.Points(g, m);
  }

  function resize() {
    if (!renderer) return;
    var w = global.innerWidth, h = global.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // pull back on narrow screens so the lantern always fits
    camera.position.z = fitDistance();
    camera.updateProjectionMatrix();
  }

  /* ---------------- frame ---------------- */
  function loop() {
    if (!running) return;
    raf = requestAnimationFrame(loop);

    var dt = Math.min(clock.getDelta(), 0.05);
    var t  = clock.elapsedTime;
    eased  = lerp(eased, target, 1 - Math.pow(0.0016, dt));   // frame-rate independent

    var p = eased;

    /* --- phase 1: wake up --- */
    var glow = smooth(range(p, 0.04, 0.40));
    pumpkin.setGlow(glow);

    /* --- phase 2: turn its back on you --- */
    var spin = smooth(range(p, 0.38, 0.76));
    pumpkin.rotation.y = spin * Math.PI + Math.sin(t * 0.5) * 0.05 * (1 - spin);
    pumpkin.rotation.z = Math.sin(t * 0.42) * 0.035;
    pumpkin.position.y = 0.55 + Math.sin(t * 0.9) * 0.09;

    /* --- phase 3: hand over to the chase --- */
    var exit = smooth(range(p, 0.76, 1.0));
    pumpkin.position.y += exit * 3.4;
    pumpkin.position.z  = -exit * 6.5;
    pumpkin.scale.setScalar(1 - exit * 0.35);

    /* camera creeps in as the light comes up, then lifts away */
    var baseZ = fitDistance();
    camera.position.z = baseZ - glow * 1.5 + exit * 2.2;
    camera.position.x = Math.sin(t * 0.23) * 0.28;
    camera.position.y = 0.9 + exit * 1.4;
    camera.lookAt(0, 0.5 + exit * 2.0, 0);

    /* embers rise, and burn brighter once the candle is lit */
    var ep = embers.geometry.attributes.position;
    var seed = embers.geometry.userData.seed;
    for (var i = 0; i < ep.count; i++) {
      var y = ep.getY(i) + dt * (0.35 + seed[i] * 0.9) * (0.3 + glow);
      if (y > 9) { y = -3.2; }
      ep.setY(i, y);
      ep.setX(i, ep.getX(i) + Math.sin(t * 0.7 + seed[i] * 12) * dt * 0.25);
    }
    ep.needsUpdate = true;
    embers.material.opacity = 0.25 + glow * 0.65;

    mistPlane.material.map.offset.x = t * 0.012;
    moonGlow.material.opacity = 0.32 + Math.sin(t * 0.8) * 0.03;

    scene.fog.density = 0.055 - glow * 0.018;

    renderer.render(scene, camera);
  }

})(window);
