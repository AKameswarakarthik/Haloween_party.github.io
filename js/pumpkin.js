/* ============================================================
   pumpkin.js — shared jack-o'-lantern builder (three.js r128)
   Exposes window.HW.{ makePumpkin, makeGlowSprite, faceTexture }
   ============================================================ */
(function (global) {
  'use strict';

  var HW = global.HW || (global.HW = {});

  /* ---------- procedural carved-face texture ------------------
     Drawn into equirect UV space. A sphere's u=0.25 column faces
     +Z (the camera), so the face is centred there.               */
  var FACE_W = 2048, FACE_H = 1024;
  var FACE_CX = FACE_W * 0.25;   // u = 0.25  ->  +Z
  var FACE_CY = FACE_H * 0.52;

  function poly(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fill();
  }

  function drawFace(ctx, cx, cy, colour) {
    ctx.fillStyle = colour;

    // eyes — angry slanted triangles
    poly(ctx, [[cx - 208, cy - 176], [cx - 62, cy - 88], [cx - 236, cy - 26]]);
    poly(ctx, [[cx + 208, cy - 176], [cx + 62, cy - 88], [cx + 236, cy - 26]]);

    // nose
    poly(ctx, [[cx, cy - 34], [cx - 46, cy + 46], [cx + 46, cy + 46]]);

    // toothy grin
    poly(ctx, [
      [cx - 214, cy + 84], [cx - 148, cy + 84], [cx - 112, cy + 156], [cx - 74, cy + 84],
      [cx + 74, cy + 84], [cx + 112, cy + 156], [cx + 148, cy + 84], [cx + 214, cy + 84],
      [cx + 186, cy + 224], [cx + 108, cy + 224], [cx + 64, cy + 152], [cx + 18, cy + 224],
      [cx - 108, cy + 224], [cx - 152, cy + 152], [cx - 186, cy + 224]
    ]);
  }

  var _faceTex = null;
  HW.faceTexture = function () {
    if (_faceTex) return _faceTex;
    var c = document.createElement('canvas');
    c.width = FACE_W; c.height = FACE_H;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, FACE_W, FACE_H);

    // soft halo so the carved edges bleed light onto the rind
    ctx.filter = 'blur(26px)';
    drawFace(ctx, FACE_CX, FACE_CY, '#5a2a00');
    ctx.filter = 'none';
    drawFace(ctx, FACE_CX, FACE_CY, '#ffffff');

    // seam-safe: the face never crosses u=0/1 so no wrap copy needed
    _faceTex = new THREE.CanvasTexture(c);
    _faceTex.wrapS = THREE.RepeatWrapping;
    _faceTex.anisotropy = 4;
    return _faceTex;
  };

  /* ---------- rind texture: subtle mottled orange ---------- */
  var _rindTex = null;
  function rindTexture() {
    if (_rindTex) return _rindTex;
    var s = 512, c = document.createElement('canvas');
    c.width = c.height = s;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#c1510c';
    ctx.fillRect(0, 0, s, s);
    for (var i = 0; i < 900; i++) {
      var x = Math.random() * s, y = Math.random() * s, r = 4 + Math.random() * 26;
      ctx.fillStyle = 'rgba(' + (150 + Math.random() * 90 | 0) + ',' +
                                (60 + Math.random() * 50 | 0) + ',10,' +
                                (0.05 + Math.random() * 0.12).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    _rindTex = new THREE.CanvasTexture(c);
    _rindTex.wrapS = _rindTex.wrapT = THREE.RepeatWrapping;
    return _rindTex;
  }

  /* ---------- radial glow sprite (cheap fake bloom) ---------- */
  HW.makeGlowSprite = function (colour, opacity, depthTest) {
    var s = 256, c = document.createElement('canvas');
    c.width = c.height = s;
    var ctx = c.getContext('2d');
    var g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0.00, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,190,90,0.85)');
    g.addColorStop(0.45, 'rgba(255,110,20,0.35)');
    g.addColorStop(1.00, 'rgba(255,80,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);

    var mat = new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(c),
      color: colour === undefined ? 0xff8a1e : colour,
      transparent: true,
      opacity: opacity === undefined ? 1 : opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: depthTest === undefined ? true : depthTest
    });
    return new THREE.Sprite(mat);
  };

  /* ---------- the pumpkin itself ----------
     opts: { radius, ribs, glow (0..1 initial), simple }
     returns a Group with .setGlow(v) and .body / .face refs      */
  HW.makePumpkin = function (opts) {
    opts = opts || {};
    var R     = opts.radius || 1;
    var ribs  = opts.ribs   || 9;
    var segs  = opts.simple ? 32 : 72;
    var rings = opts.simple ? 24 : 48;

    var group = new THREE.Group();

    /* --- ribbed body: squash a sphere and modulate its radius --- */
    var geo = new THREE.SphereGeometry(R, segs, rings);
    var pos = geo.attributes.position;
    var v = new THREE.Vector3();
    for (var i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      var azim = Math.atan2(v.z, v.x);
      var lobe = 1 + 0.055 * Math.cos(azim * ribs);
      // pinch top & bottom a touch so it reads as a pumpkin, not a ball
      var ny    = v.y / R;
      var pinch = 1 - 0.16 * Math.pow(Math.abs(ny), 3);
      v.multiplyScalar(lobe * pinch);
      v.y *= 0.80;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();

    var bodyMat = new THREE.MeshStandardMaterial({
      map: rindTexture(),
      color: 0xff8c2a,
      roughness: 0.78,
      metalness: 0.04,
      emissive: new THREE.Color(0xff6a00),
      emissiveMap: HW.faceTexture(),
      emissiveIntensity: 0
    });
    var body = new THREE.Mesh(geo, bodyMat);
    body.castShadow = true;
    group.add(body);

    /* --- stem --- */
    var curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, R * 0.72, 0),
      new THREE.Vector3(0.04 * R, R * 0.94, 0.02 * R),
      new THREE.Vector3(-0.10 * R, R * 1.06, 0.10 * R),
      new THREE.Vector3(0.06 * R, R * 1.16, 0.22 * R)
    ]);
    var stem = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 24, R * 0.085, 10, false),
      new THREE.MeshStandardMaterial({ color: 0x4c6b22, roughness: 0.95 })
    );
    group.add(stem);

    /* --- candle light living inside the shell --- */
    var candle = new THREE.PointLight(0xff7a18, 0, R * 9, 2);
    candle.position.set(0, -R * 0.08, 0);
    group.add(candle);

    /* --- fake bloom halo, parented so it follows the pumpkin --- */
    var haloBase = opts.simple ? 2.3 : 4.4;
    var halo = HW.makeGlowSprite(0xff8a1e, 0, false);
    halo.scale.setScalar(R * haloBase);
    halo.position.z = R * 0.55;
    group.add(halo);

    group.body   = body;
    group.stem   = stem;
    group.candle = candle;
    group.halo   = halo;

    /* glow: 0 = cold dead gourd, 1 = fully lit lantern */
    group.setGlow = function (t) {
      t = Math.max(0, Math.min(1, t));
      var e = t * t;                                  // ease in — stays dark longer
      bodyMat.emissiveIntensity = e * 2.6;
      bodyMat.color.setHex(0xff8c2a).multiplyScalar(0.42 + 0.58 * t);
      candle.intensity = e * 3.4 * R;
      // halo only shows once the face is actually facing us
      halo.material.opacity = e * (opts.simple ? 0.34 : 0.55);
      halo.scale.setScalar(R * (haloBase + e * 1.6));
    };
    group.setGlow(opts.glow || 0);

    return group;
  };

  /* ---------- ghost (used by hero + game) ----------
     A rounded head with a rippling sheet skirt.                 */
  HW.makeGhost = function (opts) {
    opts = opts || {};
    var R = opts.radius || 1;
    var colour = opts.color === undefined ? 0xd8ccff : opts.color;
    var g = new THREE.Group();

    var mat = new THREE.MeshStandardMaterial({
      color: colour,
      emissive: new THREE.Color(colour),
      emissiveIntensity: 0.55,
      roughness: 1,
      transparent: true,
      opacity: opts.opacity === undefined ? 0.86 : opts.opacity,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    // hood: half sphere
    var hood = new THREE.Mesh(new THREE.SphereGeometry(R, 28, 20, 0, Math.PI * 2, 0, Math.PI * 0.62), mat);
    g.add(hood);

    // skirt: cone with a wavy hem
    var skirtGeo = new THREE.CylinderGeometry(R * 0.995, R * 1.16, R * 1.5, 28, 8, true);
    var sp = skirtGeo.attributes.position, sv = new THREE.Vector3();
    for (var i = 0; i < sp.count; i++) {
      sv.fromBufferAttribute(sp, i);
      var t = (sv.y + R * 0.75) / (R * 1.5);         // 0 bottom -> 1 top
      if (t < 0.28) {
        var a = Math.atan2(sv.z, sv.x);
        sv.y += Math.sin(a * 6) * R * 0.20 * (0.28 - t) / 0.28;
      }
      sp.setXYZ(i, sv.x, sv.y, sv.z);
    }
    skirtGeo.computeVertexNormals();
    var skirt = new THREE.Mesh(skirtGeo, mat);
    skirt.position.y = -R * 0.62;
    g.add(skirt);

    // eyes + mouth: black voids that read at any distance
    var voidMat = new THREE.MeshBasicMaterial({
      color: 0x120024, transparent: true,
      opacity: opts.opacity === undefined ? 0.86 : opts.opacity,
      depthWrite: false
    });
    function socket(x, y, z, sx, sy) {
      var m = new THREE.Mesh(new THREE.SphereGeometry(R * 0.19, 14, 12), voidMat);
      m.position.set(x, y, z); m.scale.set(sx, sy, 0.55);
      g.add(m); return m;
    }
    socket(-R * 0.33, R * 0.16, R * 0.83, 1, 1.25);
    socket( R * 0.33, R * 0.16, R * 0.83, 1, 1.25);
    socket( 0,       -R * 0.34, R * 0.82, 0.85, 1.5);

    g.spookMat = mat;
    g.voidMat  = voidMat;
    /* fade the whole apparition, sockets included */
    g.setOpacity = function (o) {
      mat.opacity = o;
      voidMat.opacity = Math.min(1, o * 1.15);
    };
    return g;
  };

})(window);
