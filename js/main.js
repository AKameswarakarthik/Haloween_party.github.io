/* ============================================================
   main.js — scroll orchestration + handing over to the game
   ============================================================ */
(function (global) {
  'use strict';
  var HW = global.HW;

  var doc = document;
  var $ = function (id) { return doc.getElementById(id); };

  var el = {
    hero:     $('hero-canvas'),
    gameCv:   $('game-canvas'),
    layer:    $('game-layer'),
    coming:   $('coming'),
    tagline:  $('tagline'),
    eyebrow:  $('eyebrow'),
    hint:     $('scroll-hint'),
    copy:     $('stage-copy'),
    start:    $('game-start'),
    over:     $('game-over'),
    warn:     $('warn'),
    score:    $('hud-score'),
    candy:    $('hud-candy'),
    ghost:    $('hud-ghost'),
    ghostPill:doc.querySelector('.hud-pill--danger'),
    play:     $('btn-play'),
    retry:    $('btn-retry'),
    exit:     $('btn-exit'),
    fScore:   $('final-score'),
    fCandy:   $('final-candy'),
    fBest:    $('final-best')
  };

  if (!global.THREE) {
    el.tagline.textContent = 'the lantern could not be lit (3D failed to load)';
    return;
  }

  /* ---------------- scroll progress ---------------- */
  var GATE = 0.965;          // past this the game takes over
  var handedOver = false;

  function maxScroll() {
    return Math.max(1, doc.documentElement.scrollHeight - global.innerHeight);
  }
  function progress() {
    return Math.min(1, global.scrollY / maxScroll());
  }

  /* ---------------- copy that changes with the scroll ------- */
  var beats = [
    { at: 0.00, eyebrow: 'Oct 31 · Dusk till Dawn', head: 'COMING SOON', tag: 'the lantern is still asleep…' },
    { at: 0.22, eyebrow: 'Oct 31 · Dusk till Dawn', head: 'COMING SOON', tag: 'something is warming up inside' },
    { at: 0.46, eyebrow: 'Oct 31 · Dusk till Dawn', head: 'COMING SOON', tag: 'don’t let it turn around…' },
    { at: 0.70, eyebrow: 'it turned around anyway', head: 'COMING SOON', tag: 'now something is running' },
    { at: 0.88, eyebrow: 'keep scrolling if you dare', head: 'PUMPKIN RUN', tag: 'the chase is about to begin' }
  ];
  var beatIdx = -1;

  function applyBeats(p) {
    var idx = 0;
    for (var i = 0; i < beats.length; i++) if (p >= beats[i].at) idx = i;
    if (idx === beatIdx) return;
    beatIdx = idx;
    var b = beats[idx];
    el.eyebrow.textContent = b.eyebrow;
    el.coming.textContent  = b.head;
    el.tagline.style.opacity = 0;
    global.setTimeout(function () {
      el.tagline.textContent = b.tag;
      el.tagline.style.opacity = 1;
    }, 220);
  }

  /* ---------------- boot ---------------- */
  HW.hero.init(el.hero).start();
  HW.game.init(el.gameCv, {
    warn: el.warn, score: el.score, candy: el.candy,
    ghost: el.ghost, ghostPill: el.ghostPill
  });

  function onScroll() {
    var p = progress();
    HW.hero.setProgress(p);
    applyBeats(p);

    el.hint.style.opacity = p > 0.05 ? 0 : 1;
    el.copy.style.opacity = p > GATE ? 0 : 1;

    if (p >= GATE && !handedOver) enterGame();
  }

  global.addEventListener('scroll', onScroll, { passive: true });
  global.addEventListener('resize', onScroll);
  // browsers restore the previous scroll position asynchronously, so the
  // boot-time reading can be stale — re-check once everything has settled
  global.addEventListener('load', onScroll);
  onScroll();

  /* ---------------- the handover ---------------- */
  function blockScroll(e) { e.preventDefault(); }

  function enterGame() {
    handedOver = true;
    doc.body.classList.add('game-live');
    // freeze the page underneath without losing our scroll position
    global.addEventListener('wheel', blockScroll, { passive: false });
    global.addEventListener('touchmove', blockScroll, { passive: false });

    HW.hero.stop();
    show(el.start); hide(el.over);
    HW.game.prime();                 // idle scene behind the start card
  }

  function leaveGame() {
    handedOver = false;
    doc.body.classList.remove('game-live');
    global.removeEventListener('wheel', blockScroll);
    global.removeEventListener('touchmove', blockScroll);

    HW.game.stop();
    HW.hero.start();
    global.scrollTo({ top: maxScroll() * 0.55, behavior: 'smooth' });
  }

  function show(node) { node.classList.remove('is-hidden'); }
  function hide(node) { node.classList.add('is-hidden'); }

  /* ---------------- best score ---------------- */
  function readBest() {
    try { return parseInt(global.localStorage.getItem('hw_best') || '0', 10) || 0; }
    catch (err) { return 0; }
  }
  function writeBest(v) {
    try { global.localStorage.setItem('hw_best', String(v)); } catch (err) {}
  }

  function play() {
    hide(el.start); hide(el.over);
    HW.game.start(function (score, candyCount) {
      var best = Math.max(readBest(), score);
      writeBest(best);
      el.fScore.textContent = score;
      el.fCandy.textContent = candyCount;
      el.fBest.textContent  = best;
      show(el.over);
    });
  }

  el.play.addEventListener('click', play);
  el.retry.addEventListener('click', play);
  el.exit.addEventListener('click', leaveGame);

  // space/enter on the start card starts the run
  global.addEventListener('keydown', function (e) {
    if (!doc.body.classList.contains('game-live')) return;
    if (e.key === 'Escape') { leaveGame(); return; }
    var startVisible = !el.start.classList.contains('is-hidden');
    var overVisible  = !el.over.classList.contains('is-hidden');
    if ((startVisible || overVisible) && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      play();
    }
  });

  // pause the loops when the tab is hidden
  doc.addEventListener('visibilitychange', function () {
    if (doc.hidden) { HW.hero.stop(); HW.game.stop(); }
    else if (doc.body.classList.contains('game-live')) { HW.game.resume(); }
    else { HW.hero.start(); }
  });

})(window);
