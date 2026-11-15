'use strict';
/* ==========================================================================
   STARCOIL — the game: state, the rules of the coil, input, the main loop
   ========================================================================== */

const G = {
  state: 'title',            // title | playing | boon | paused | over
  attract: true,             // title-screen demo: a self-steering serpent, no HUD, no harm
  time: 0,                   // game clock (stops while paused)
  realTime: 0,               // wall clock (drives the sky and the HUD)

  wave: 0,
  diff: 1,                   // shade speed multiplier, rises each night
  score: 0,
  best: Store.get('best', 0),
  bestWave: Store.get('bestWave', 0),
  hearts: CFG.hearts,
  maxHearts: CFG.hearts,
  chain: 0,
  chainT: 0,
  waveHurt: false,

  serpent: null,
  enemies: [],
  shots: [],
  rifts: [],
  pickups: [],
  seals: [],                 // closed coils, kept briefly for their flash (or longer, with Echo)
  boons: {},
  secondUsed: false,
  stats: null,
  dir: Director,
  banner: null,
  hints: {},

  freeze: 0,                 // hit-stop
  slowmo: 0,
  emptyCd: 0,                // rate-limits the outline of coils that caught nothing…
  emptySndCd: 0,             // …and, more strictly, their sound
  deathT: -1,
  deathRate: 0,

  god: false,                // debug: take no damage
  bot: false,                // debug: let the demo AI play a real run
};

function freshStats() {
  return { banished: 0, coils: 0, bestCoil: 0, bestChain: 0, time: 0 };
}

function resetWorld() {
  G.enemies.length = 0;
  G.shots.length = 0;
  G.rifts.length = 0;
  G.pickups.length = 0;
  G.seals.length = 0;
  FX.clear();
  G.serpent = new Serpent(View.W / 2, View.H * 0.62, -Math.PI / 2);
  G.time = 0;
  G.chain = 0;
  G.chainT = 0;
  G.freeze = 0;
  G.slowmo = 0;
  G.emptyCd = 0;
  G.emptySndCd = 0;
  G.deathT = -1;
  G.banner = null;
}

/* ---- flow ---------------------------------------------------------------- */

function toTitle() {
  G.attract = true;
  G.state = 'title';
  G.boons = {};
  G.wave = 0;
  G.diff = 1;
  G.hearts = G.maxHearts = CFG.hearts;
  G.stats = freshStats();
  Sky.reset();
  resetWorld();
  Director.attract();
  Music.setIntensity(0);
  Snd.duck(false);
  UI.hideToast();
  UI.showTitle();
}

/** Begin a run. `resume` (from snapshotRun) picks an interrupted run back up instead. */
function newRun(resume) {
  G.attract = false;
  G.state = 'playing';
  G.boons = {};
  G.secondUsed = false;
  G.wave = 0;
  G.diff = 1;
  G.score = 0;
  G.hearts = G.maxHearts = CFG.hearts;
  G.stats = freshStats();
  Sky.reset();
  resetWorld();
  HUD.reset();
  Snd.duck(false);
  UI.hideToast();
  UI.show(null);
  if (resume && resume.wave >= 1) {
    resumeRun(resume);
    return;
  }
  nextWave();
  hintOnce('move', 'Guide the serpent with your ' + (UI.touch ? 'finger' : 'mouse') + '. Loop around the shades and cross your own body to banish them.');
}

/* A host that can swap in a new version of the page while it is open (see the boot
   code at the end of this file) is handed the essentials of a run in progress, so the
   player picks up at the start of the night they were on instead of losing the run. */

function snapshotRun() {
  const S = G.serpent;
  if (G.attract || !S || !S.alive) return null;
  if (G.state !== 'playing' && G.state !== 'paused' && G.state !== 'boon') return null;
  return {
    wave: G.wave, atBoon: G.state === 'boon',
    score: G.score, hearts: G.hearts, maxHearts: G.maxHearts,
    boons: Object.assign({}, G.boons), secondUsed: G.secondUsed,
    stats: Object.assign({}, G.stats), realm: Sky.realm,
  };
}

function resumeRun(run) {
  for (const id in run.boons) {
    if (!BOON_BY_ID[id]) continue;
    for (let i = 0; i < run.boons[id]; i++) applyBoon(id);
  }
  G.maxHearts = clamp(run.maxHearts | 0, 1, 12);
  G.hearts = clamp(run.hearts | 0, 1, G.maxHearts);
  G.score = Math.max(0, +run.score || 0);
  G.secondUsed = !!run.secondUsed;
  if (run.stats) Object.assign(G.stats, run.stats);
  HUD.scoreShown = G.score;
  Sky.setRealm(run.realm | 0);
  if (run.atBoon) {                 // they had cleared the night and were choosing
    G.wave = run.wave;
    Director.state = 'idle';
    openBoons();
  } else {
    G.wave = run.wave - 1;
    nextWave();
  }
}

function nextWave() {
  G.wave++;
  G.diff = Math.min(1.7, 1 + 0.035 * (G.wave - 1));
  G.waveHurt = false;
  Director.start(G.wave);
  Music.setIntensity(G.wave % 5 === 0 ? 3 : G.wave >= 3 ? 2 : 1);
  Sfx.wave();
}

function onWaveCleared() {
  const bonus = Math.round(100 * G.wave * (G.waveHurt ? 1 : 1.5));
  addScore(bonus);
  showBanner('NIGHT ' + roman(G.wave) + ' CLEARED', (G.waveHurt ? '' : 'Untouched  ·  ') + '+' + fmt(bonus), 2.4);
  // thorns and stray bolts fade with the night
  for (let i = 0; i < G.enemies.length; i++) {
    const e = G.enemies[i];
    if (e.hazard && !e.dead && e.dying < 0) { e.silent = true; e.dying = 0.2 + i * 0.05; }
  }
  for (let i = 0; i < G.shots.length; i++) popShot(G.shots[i]);
  Sfx.clear();
}

function openBoons() {
  const choices = rollBoons(3);
  if (!choices.length) { nextWave(); return; }
  const take = (b) => {
    applyBoon(b.id);
    Sfx.boon();
    G.state = 'playing';
    UI.show(null);
    Snd.duck(false);
    FX.text(G.serpent.x, G.serpent.y - 34, b.name, 17, '255,231,170', 1.6, 26);
    FX.ring(G.serpent.x, G.serpent.y, 10, 90, 0.6, '255,231,170', 3);
    nextWave();
  };
  if (G.bot) { take(pick(choices)); return; }
  G.state = 'boon';
  Snd.duck(true);
  UI.showBoons(choices, 'Night ' + roman(G.wave) + ' survived', take);
}

function pauseGame() {
  if (G.state !== 'playing' || G.attract) return;
  G.state = 'paused';
  Snd.duck(true);
  UI.showPause();
}

function resumeGame() {
  if (G.state !== 'paused') return;
  G.state = 'playing';
  Snd.duck(false);
  UI.show(null);
}

function togglePause() {
  if (G.state === 'playing') pauseGame();
  else if (G.state === 'paused') resumeGame();
}

function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      const p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
      if (p && p.catch) p.catch(() => {});
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  } catch (err) { /* not allowed here */ }
}

function hintOnce(key, text) {
  if (G.attract || G.bot || G.hints[key]) return;
  G.hints[key] = true;
  UI.toast(text, 6.5);
}

function addScore(n) {
  if (G.attract) return;
  G.score += Math.round(n);
}

/* ---- the coil ------------------------------------------------------------ */

const COIL_NAMES = ['', '', 'DOUBLE', 'TRIPLE', 'QUADRUPLE'];

/**
 * The head has crossed the body, closing `poly`. Everything inside is caught:
 * shades are struck, bolts dissolve, hearts are collected — unless a thorn is
 * inside, which shatters the coil instead.
 */
function resolveLoop(poly, area) {
  const b = polyBounds(poly);
  const reach = coilReach();
  const reach2 = reach * reach;
  const inside = (x, y) => {
    if (x < b.minX - reach || x > b.maxX + reach || y < b.minY - reach || y > b.maxY + reach) return false;
    if (windingNumber(x, y, poly) !== 0) return true;
    return reach > 0 && distToPolySq(x, y, poly) <= reach2;
  };

  for (let i = 0; i < G.enemies.length; i++) {
    const e = G.enemies[i];
    if (e.type !== 'thorn' || e.dead || e.dying >= 0 || e.spawnT > 0) continue;
    if (e.x < b.minX || e.x > b.maxX || e.y < b.minY || e.y > b.maxY) continue;
    if (windingNumber(e.x, e.y, poly) !== 0) { shatterCoil(poly, e); return; }
  }

  const caught = [];
  for (let i = 0; i < G.enemies.length; i++) {
    const e = G.enemies[i];
    if (e.dead || e.dying >= 0 || e.hazard || e.immune > 0) continue;
    if (inside(e.x, e.y)) caught.push(e);
  }
  let bolts = 0;
  for (let i = 0; i < G.shots.length; i++) {
    const s = G.shots[i];
    if (!s.dead && inside(s.x, s.y)) { popShot(s); bolts++; }
  }
  const picks = [];
  for (let i = 0; i < G.pickups.length; i++) {
    const p = G.pickups[i];
    if (!p.dead && inside(p.x, p.y)) picks.push(p);
  }

  const c = polyCentroid(poly);

  if (!caught.length && !picks.length) {
    if (bolts) {
      addScore(bolts * 2);
      addSeal(poly, c, 'faint');
    } else if (area >= CFG.serpent.minLoopArea && G.emptyCd <= 0) {
      // An empty coil still gets a faint outline, so a near miss is visible. Circling in
      // place closes one every frame, hence the cooldowns: a slow pulse, and a rarer tick.
      addSeal(poly, c, 'faint');
      G.emptyCd = 0.7;
      if (G.emptySndCd <= 0) { Sfx.emptyCoil(); G.emptySndCd = 1.8; }
    }
    return;
  }

  for (let i = 0; i < picks.length; i++) collectPickup(picks[i]);
  if (!caught.length) { addSeal(poly, c, 'gold'); return; }

  // --- a catch: the chain grows, and the shades pop one after another around the coil
  G.chain++;
  G.chainT = chainWindow();
  const mult = Math.min(G.chain, CFG.maxChainMult);
  const n = caught.length;

  caught.sort((p, q) => Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(q.y - c.y, q.x - c.x));
  let sum = 0;
  const stars = [];
  for (let i = 0; i < n; i++) {
    const e = caught[i];
    sum += strikeEnemy(e, 0.06 + i * 0.05, c.x, c.y, i + Math.min(G.chain - 1, 6));
    if (e.star) stars.push(e.star);
  }
  const pts = sum * n * mult + bolts * 2;
  addScore(pts);
  Sky.addConstellation(stars);

  if (!G.attract) {
    G.stats.coils++;
    if (n > G.stats.bestCoil) G.stats.bestCoil = n;
    if (G.chain > G.stats.bestChain) G.stats.bestChain = G.chain;
  }

  // --- feedback scales with the size of the catch
  const radius = Math.sqrt(area / Math.PI);
  addSeal(poly, c, 'gold');
  FX.ring(c.x, c.y, 12, radius * 1.25 + 20, 0.5, '255,225,150', 3);
  FX.addShake(Math.min(3 + n * 1.3, 13));
  G.freeze = Math.max(G.freeze, Math.min(0.03 + n * 0.012, 0.11));
  Sfx.coil(n, G.chain);
  if (!G.attract) {
    FX.text(c.x, c.y, '+' + fmt(pts), 19 + Math.min(n, 8) * 2.5, '255,231,170', 1.2);
    const name = n >= 8 ? 'CONSTELLATION ×' + n : n >= 5 ? 'GRAND COIL ×' + n : COIL_NAMES[n];
    if (name) FX.text(c.x, c.y - 30 - Math.min(n, 8) * 1.5, name, 15, '255,255,255', 1.2);
    if (n >= 2) hintOnce('multi', 'The more shades in one coil, the more each is worth. Herd them, then close the loop.');
  }

  // --- boons that answer a catch
  const nova = novaRadius();
  if (nova) {
    shockwave(c.x, c.y, radius + nova, 430, true);
    Sfx.nova();
  }
  const storm = boonLevel('storm');
  if (storm && n >= 2) strikeLightning(c, storm, mult);
}

/** A thorn was inside: nothing is caught, the chain breaks, and half the body is lost. */
function shatterCoil(poly, thorn) {
  const S = G.serpent;
  const c = polyCentroid(poly);
  addSeal(poly, c, 'shatter');
  thorn.silent = true;
  thorn.dying = 0.05;
  FX.burst(thorn.x, thorn.y, '255,60,90', 26, 340, 0.7, 4, 2);
  FX.ring(thorn.x, thorn.y, 10, 150, 0.5, '255,60,90', 4);
  FX.text(c.x, c.y, 'COIL SHATTERED', 20, '255,110,130', 1.3);
  FX.addShake(11);
  FX.flash('255,40,70', 0.16);
  G.chain = 0;
  if (!boonLevel('scales')) {
    const lost = S.cutToLength(S.totalLen() * 0.5);
    for (let i = 0; i < lost.length; i += 2) {
      FX.spark(lost[i].x, lost[i].y, rand(-30, 30), rand(-30, 30), rand(0.4, 0.9), 3.5, '130,170,255', 0);
    }
  }
  Sfx.shatter();
  hintOnce('thorn', 'A thorn shatters any coil that encloses it. Lure the shades away from thorns first.');
}

function addSeal(poly, c, kind) {
  G.seals.push({
    poly, cx: c.x, cy: c.y, kind,
    t: 0,
    dur: kind === 'faint' ? 0.4 : 0.8,
    echo: kind === 'gold' && !G.attract ? echoTime() : 0,
    bounds: null,
  });
  if (G.seals.length > 40) G.seals.shift();
}

function updateSeals(dt) {
  for (let i = G.seals.length - 1; i >= 0; i--) {
    const s = G.seals[i];
    s.t += dt;
    if (s.echo > 0) {
      // Ouroboros Echo: the seal keeps catching for a while
      s.echo -= dt;
      const b = s.bounds || (s.bounds = polyBounds(s.poly));
      let got = 0;
      for (let j = 0; j < G.enemies.length; j++) {
        const e = G.enemies[j];
        if (e.dead || e.dying >= 0 || e.hazard || e.immune > 0) continue;
        if (e.x < b.minX || e.x > b.maxX || e.y < b.minY || e.y > b.maxY) continue;
        if (windingNumber(e.x, e.y, s.poly) === 0) continue;
        const mult = clamp(G.chain, 1, CFG.maxChainMult);
        const v = strikeEnemy(e, 0.05 + got * 0.04, s.cx, s.cy, 3 + got) * mult;
        addScore(v);
        FX.text(e.x, e.y - 16, '+' + fmt(v), 14, '255,225,150', 0.8);
        got++;
      }
      for (let j = 0; j < G.shots.length; j++) {
        const sh = G.shots[j];
        if (!sh.dead && sh.x >= b.minX && sh.x <= b.maxX && sh.y >= b.minY && sh.y <= b.maxY &&
            windingNumber(sh.x, sh.y, s.poly) !== 0) popShot(sh);
      }
      if (got) {
        if (G.chain > 0) G.chainT = chainWindow();
        Sfx.coil(1, G.chain);
      }
      if (s.echo <= 0) { s.t = 0; s.dur = 0.5; }       // begin the fade
    } else if (s.t >= s.dur) {
      G.seals.splice(i, 1);
    }
  }
}

function drawSeals(ctx, t) {
  if (!G.seals.length) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = 'round';
  for (let i = 0; i < G.seals.length; i++) {
    const s = G.seals[i];
    const k = Math.min(1, s.t / s.dur);
    let a, rgb;
    if (s.kind === 'faint') { a = (1 - k) * 0.4; rgb = '150,200,255'; }
    else if (s.kind === 'shatter') { a = 1 - k; rgb = '255,70,90'; }
    else if (s.echo > 0) { a = 0.55 + 0.15 * Math.sin(t * 9); rgb = '255,215,140'; }
    else { a = 1 - k; rgb = '255,225,150'; }

    const p = s.poly;
    ctx.beginPath();
    ctx.moveTo(p[0].x, p[0].y);
    for (let j = 1; j < p.length; j++) ctx.lineTo(p[j].x, p[j].y);
    ctx.closePath();
    if (s.kind !== 'faint') {
      ctx.fillStyle = rgba(rgb, (a * (s.echo > 0 ? 0.16 : 0.3)).toFixed(3));
      ctx.fill();
    }
    ctx.strokeStyle = rgba(rgb, (a * 0.9).toFixed(3));
    ctx.lineWidth = s.kind === 'faint' ? 2 : 3 + 5 * (1 - k);
    ctx.stroke();

    if (s.kind === 'gold') {              // star glints strung along the coil
      ctx.fillStyle = rgba('255,255,255', a.toFixed(3));
      const count = 8, size = 3 + 5 * (1 - k);
      for (let g = 0; g < count; g++) {
        const v = p[Math.floor((g / count) * p.length)];
        ctx.beginPath();
        ctx.moveTo(v.x, v.y - size * 1.6);
        ctx.lineTo(v.x + size * 0.45, v.y);
        ctx.lineTo(v.x, v.y + size * 1.6);
        ctx.lineTo(v.x - size * 0.45, v.y);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(v.x - size * 1.4, v.y - 0.6, size * 2.8, 1.2);
      }
    }
  }
  ctx.restore();
}

/** Push shades away from a point; optionally erase bolts in range. */
function shockwave(x, y, radius, force, killShots) {
  for (let i = 0; i < G.enemies.length; i++) {
    const e = G.enemies[i];
    if (e.dead || e.dying >= 0 || e.hazard) continue;
    const dx = e.x - x, dy = e.y - y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > radius) continue;
    const k = force * (1 - (0.5 * d) / radius) * (e.boss ? 0.25 : e.type === 'brute' ? 0.6 : 1);
    e.kx += (dx / d) * k;
    e.ky += (dy / d) * k;
  }
  if (killShots) {
    for (let i = 0; i < G.shots.length; i++) {
      const s = G.shots[i];
      if (!s.dead && Math.hypot(s.x - x, s.y - y) < radius) popShot(s);
    }
  }
  FX.ring(x, y, 20, radius, 0.45, '170,220,255', 4);
}

/** Storm Coil: lightning leaps from the coil to the nearest shades outside it. */
function strikeLightning(c, count, mult) {
  const near = [];
  for (let i = 0; i < G.enemies.length; i++) {
    const e = G.enemies[i];
    if (e.dead || e.dying >= 0 || e.hazard || e.immune > 0) continue;
    const d = Math.hypot(e.x - c.x, e.y - c.y);
    if (d < 560) near.push({ e, d });
  }
  if (!near.length) return;
  near.sort((p, q) => p.d - q.d);
  let fx = c.x, fy = c.y;
  for (let i = 0; i < Math.min(count, near.length); i++) {
    const e = near[i].e;
    FX.bolt(fx, fy, e.x, e.y);
    const v = strikeEnemy(e, 0.12 + i * 0.08, c.x, c.y, 8 + i) * mult;
    addScore(v);
    if (!G.attract) FX.text(e.x, e.y - 16, '+' + fmt(v), 14, '190,225,255', 0.8);
    fx = e.x; fy = e.y;
  }
  Sfx.zap();
}

function collectPickup(p) {
  p.dead = true;
  FX.burst(p.x, p.y, '255,130,170', 18, 220, 0.7, 4, 2);
  FX.ring(p.x, p.y, 8, 70, 0.5, '255,150,185', 3);
  if (G.hearts < G.maxHearts) {
    G.hearts++;
    FX.text(p.x, p.y - 20, 'MENDED', 17, '255,170,195', 1.2);
  } else {
    addScore(150);
    FX.text(p.x, p.y - 20, '+150', 17, '255,170,195', 1.2);
  }
  Sfx.heal();
}

/* ---- harm ---------------------------------------------------------------- */

function collideHead() {
  const S = G.serpent;
  if (!S.alive) return;
  const fang = S.dashing && boonLevel('fang') > 0;
  const open = S.vulnerable && !G.god && !G.attract;
  if (!fang && !open) return;
  const hr = CFG.serpent.headR;

  for (let i = 0; i < G.enemies.length; i++) {
    const e = G.enemies[i];
    if (e.dead || e.dying >= 0 || e.spawnT > 0 || e.intangible) continue;
    const rr = e.r * 0.85 + hr * 0.8;
    const dx = e.x - S.x, dy = e.y - S.y;
    if (dx * dx + dy * dy > rr * rr) continue;
    if (fang) {
      if (e.small) {                       // Venom Fangs: the dash bites straight through
        addScore(strikeEnemy(e, 0.001, S.x, S.y, 4));
        Sfx.fang();
      }
      continue;
    }
    hurtPlayer();
    return;
  }

  for (let i = 0; i < G.shots.length; i++) {
    const s = G.shots[i];
    if (s.dead) continue;
    const rr = s.r + hr * 0.7;
    const dx = s.x - S.x, dy = s.y - S.y;
    if (dx * dx + dy * dy > rr * rr) continue;
    if (fang) { popShot(s); continue; }
    popShot(s);
    hurtPlayer();
    return;
  }
}

function hurtPlayer() {
  const S = G.serpent;
  G.hearts--;
  G.waveHurt = true;
  G.chain = 0;
  S.invuln = CFG.serpent.hitInvuln;
  HUD.heartShake = 0.5;
  FX.addShake(14);
  FX.flash('255,40,70', 0.32);
  FX.burst(S.x, S.y, '255,90,120', 22, 320, 0.6, 4, 2);
  G.freeze = Math.max(G.freeze, 0.09);
  shockwave(S.x, S.y, 250, 460, true);       // a moment's breathing room
  Sfx.hit();

  if (G.hearts > 0) {
    hintOnce('dash', (UI.touch ? 'Tap with a second finger' : 'Click or press Space') + ' to dash. Nothing can hurt you mid-dash.');
    return;
  }
  if (boonLevel('second') && !G.secondUsed) {
    G.secondUsed = true;
    G.hearts = Math.min(2, G.maxHearts);
    S.invuln = 2.8;
    shockwave(S.x, S.y, 440, 760, true);
    FX.ring(S.x, S.y, 20, 440, 0.9, '255,231,170', 6);
    FX.flash('255,240,210', 0.4);
    showBanner('SECOND HEAD', 'You rise again', 2.4);
    Sfx.revive();
    return;
  }
  die();
}

function die() {
  const S = G.serpent;
  G.hearts = 0;
  S.alive = false;
  G.deathT = 0;
  G.deathRate = S.pts.length / 1.0;
  G.slowmo = 1.3;
  FX.burst(S.x, S.y, '170,230,255', 40, 380, 1.0, 5, 2);
  FX.ring(S.x, S.y, 10, 260, 0.8, '170,230,255', 5);
  FX.addShake(20);
  Music.setIntensity(0);
  Sfx.over();
}

/** The body unravels into motes from the head back, then the run ends. */
function updateDeath(dt) {
  const S = G.serpent;
  G.deathT += dt;
  const n = Math.ceil(G.deathRate * dt);
  for (let i = 0; i < n && S.pts.length > 1; i++) {
    const p = S.pts.pop();
    S.x = p.x; S.y = p.y;
    FX.spark(p.x, p.y, rand(-40, 40), rand(-40, 40), rand(0.5, 1.1), 3.5, '150,200,255', 0);
  }
  S.recalcLen();
  if (G.deathT > 1.5 && G.state === 'playing') gameOver();
}

function gameOver() {
  G.state = 'over';
  const newBest = G.score > G.best;
  if (newBest) { G.best = G.score; Store.set('best', G.best); }
  if (G.wave > G.bestWave) { G.bestWave = G.wave; Store.set('bestWave', G.bestWave); }
  UI.hideToast();
  UI.showOver({
    wave: G.wave, score: G.score, best: G.best, newBest,
    banished: G.stats.banished, coils: G.stats.coils,
    bestCoil: G.stats.bestCoil, bestChain: G.stats.bestChain, time: G.stats.time,
  });
}

/* ---- the Eclipse --------------------------------------------------------- */

function onBossWound(e) {
  FX.ring(e.x, e.y, e.r, 320, 0.6, '255,215,140', 6);
  FX.burst(e.x, e.y, '255,200,120', 34, 420, 0.8, 5, 2);
  FX.text(e.x, e.y - 74, e.hp === 1 ? 'ONE SEAL LEFT' : 'SEAL BROKEN', 22, '255,231,170', 1.4);
  FX.addShake(14);
  G.freeze = Math.max(G.freeze, 0.12);
  for (let i = 0; i < G.shots.length; i++) popShot(G.shots[i]);
  Sfx.bossHit();
}

function onBossDeath(e) {
  Director.bossDown = true;
  G.freeze = Math.max(G.freeze, 0.16);
  G.slowmo = 1.0;
  FX.flash('255,240,210', 0.55);
  FX.addShake(22);
  for (let i = 0; i < 5; i++) FX.ring(e.x, e.y, 20, 180 + i * 110, 0.6 + i * 0.15, '255,215,140', 6);
  FX.burst(e.x, e.y, '255,200,120', 60, 520, 1.2, 6, 2);
  Sfx.bossDie();

  // its fall sweeps every other shade from the sky
  let k = 0;
  for (let i = 0; i < G.enemies.length; i++) {
    const o = G.enemies[i];
    if (o === e || o.dead || o.dying >= 0 || o.hazard) continue;
    o.hp = 1;
    addScore(strikeEnemy(o, 0.3 + k * 0.07, e.x, e.y, k));
    k++;
  }
  for (let i = 0; i < G.shots.length; i++) popShot(G.shots[i]);
  G.rifts.length = 0;

  if (G.hearts < G.maxHearts) {
    addPickup('heart', clamp(e.x, 80, View.W - 80), clamp(e.y, 80, View.H - 80));
  }
  showBanner('THE ECLIPSE FALLS', 'The sky turns', 3);
  Sky.setRealm(Sky.realm + 1);
  Music.setIntensity(2);
}

/* ---- input --------------------------------------------------------------- */

const Input = {
  mode: 'pointer',
  cx: 0, cy: 0,              // pointer, in client pixels
  keys: { left: false, right: false, up: false, down: false },
  dashQ: false,
  steerId: null,             // the touch that is steering; a second finger dashes
  ctrl: { mode: 'pointer', tx: 0, ty: 0, hasDir: false, dir: 0, dash: false },

  init() {
    const canvas = View.canvas;
    this.cx = window.innerWidth / 2;
    this.cy = window.innerHeight * 0.3;

    window.addEventListener('pointermove', (ev) => {
      if (ev.pointerType === 'touch' && this.steerId !== null && ev.pointerId !== this.steerId) return;
      // while steering by keyboard, ignore a nudged mouse
      if (this.mode === 'keys' && Math.abs(ev.clientX - this.cx) + Math.abs(ev.clientY - this.cy) < 8) return;
      this.cx = ev.clientX;
      this.cy = ev.clientY;
      this.mode = 'pointer';
    });

    canvas.addEventListener('pointerdown', (ev) => {
      Snd.init();
      if (ev.pointerType === 'touch') {
        if (this.steerId === null) {
          this.steerId = ev.pointerId;
          this.cx = ev.clientX;
          this.cy = ev.clientY;
          this.mode = 'pointer';
        } else {
          this.dashQ = true;
        }
      } else if (ev.button === 0) {
        this.cx = ev.clientX;
        this.cy = ev.clientY;
        this.mode = 'pointer';
        this.dashQ = true;
      }
      ev.preventDefault();
    });

    const release = (ev) => { if (ev.pointerId === this.steerId) this.steerId = null; };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

    window.addEventListener('keydown', (ev) => this.onKey(ev, true));
    window.addEventListener('keyup', (ev) => this.onKey(ev, false));
    window.addEventListener('blur', () => {
      this.keys.left = this.keys.right = this.keys.up = this.keys.down = false;
    });
  },

  onKey(ev, down) {
    if (!ev.key || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
    const onButton = ev.target && ev.target.tagName === 'BUTTON';

    switch (k) {
      case 'ArrowLeft': case 'a': this.keys.left = down; if (down) this.mode = 'keys'; break;
      case 'ArrowRight': case 'd': this.keys.right = down; if (down) this.mode = 'keys'; break;
      case 'ArrowUp': case 'w': this.keys.up = down; if (down) this.mode = 'keys'; break;
      case 'ArrowDown': case 's': this.keys.down = down; if (down) this.mode = 'keys'; break;

      case ' ':
        if (onButton) return;                    // let a focused button take its own Space
        if (down && !ev.repeat) {
          Snd.init();
          if (G.state === 'playing') this.dashQ = true;
          else if (G.state === 'title' || G.state === 'over') newRun();
          else if (G.state === 'paused') resumeGame();
        }
        break;
      case 'Shift':
        if (down && !ev.repeat && G.state === 'playing') this.dashQ = true;
        break;
      case 'Enter':
        if (onButton) return;
        if (down && !ev.repeat) {
          Snd.init();
          if (G.state === 'title' || G.state === 'over') newRun();
          else if (G.state === 'paused') resumeGame();
        }
        break;
      case 'Escape': case 'p':
        if (down && !ev.repeat) togglePause();
        break;
      case 'm':
        if (down && !ev.repeat) { Snd.init(); Snd.toggleMute(); UI.syncMute(); }
        break;
      case 'f':
        if (down && !ev.repeat) toggleFullscreen();
        break;
      case '1': case '2': case '3':
        if (down && !ev.repeat && G.state === 'boon') UI.pickBoon(+k - 1);
        break;
      default:
        return;
    }
    if (k === ' ' || k.indexOf('Arrow') === 0) ev.preventDefault();
  },

  control() {
    const c = this.ctrl;
    c.dash = this.dashQ;
    this.dashQ = false;
    c.mode = this.mode;
    if (this.mode === 'keys') {
      const x = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
      const y = (this.keys.down ? 1 : 0) - (this.keys.up ? 1 : 0);
      c.hasDir = x !== 0 || y !== 0;
      if (c.hasDir) c.dir = Math.atan2(y, x);
    } else {
      c.tx = View.toWorldX(this.cx);
      c.ty = View.toWorldY(this.cy);
    }
    return c;
  },
};

/* ---- the demo serpent ---------------------------------------------------- */

/** Steers itself: finds the nearest cluster of shades and circles it. Used on the title screen. */
const Bot = {
  ctrl: { mode: 'pointer', tx: 0, ty: 0, hasDir: false, dir: 0, dash: false },
  dir: 1,
  hold: 0,
  wander: rand(TAU),

  control(dt) {
    const S = G.serpent, c = this.ctrl, W = View.W, H = View.H;
    c.dash = false;
    this.hold -= dt;

    let best = null, bd = Infinity;
    for (let i = 0; i < G.enemies.length; i++) {
      const e = G.enemies[i];
      if (e.dead || e.dying >= 0 || e.hazard || e.intangible) continue;
      const d = Math.hypot(e.x - S.x, e.y - S.y);
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) {                                   // nothing about: drift in a lazy figure of eight
      this.wander += dt * 0.6;
      c.tx = W / 2 + Math.cos(this.wander) * W * 0.3;
      c.ty = H / 2 + Math.sin(this.wander * 2) * H * 0.24;
      return c;
    }

    let cx = 0, cy = 0, k = 0;
    for (let i = 0; i < G.enemies.length; i++) {
      const e = G.enemies[i];
      if (e.dead || e.dying >= 0 || e.hazard) continue;
      if (Math.hypot(e.x - best.x, e.y - best.y) < 110) { cx += e.x; cy += e.y; k++; }
    }
    cx /= k; cy /= k;
    let cr = 0;
    for (let i = 0; i < G.enemies.length; i++) {
      const e = G.enemies[i];
      if (e.dead || e.dying >= 0 || e.hazard) continue;
      if (Math.hypot(e.x - best.x, e.y - best.y) < 110) cr = Math.max(cr, Math.hypot(e.x - cx, e.y - cy) + e.r);
    }

    const minR = (S.speed / S.turnRate) * 1.12;
    const maxR = Math.max(minR, (S.curLen / TAU) * 0.82);
    const R = clamp(cr + 42, minR, maxR);
    const dx = S.x - cx, dy = S.y - cy;
    const d = Math.hypot(dx, dy) || 1;
    if (this.hold <= 0) {
      // circle the way we are already leaning
      this.dir = Math.cos(S.heading) * (cy - S.y) - Math.sin(S.heading) * (cx - S.x) >= 0 ? 1 : -1;
      this.hold = 1.2;
    }
    const a = Math.atan2(dy, dx) + this.dir * (d > R * 1.7 ? 1.25 : 0.8);
    c.tx = clamp(cx + Math.cos(a) * R, 24, W - 24);
    c.ty = clamp(cy + Math.sin(a) * R, 24, H - 24);
    if (!G.attract && bd < 46 && S.dashCd <= 0) c.dash = true;
    return c;
  },
};

/* ---- update -------------------------------------------------------------- */

function update(dt) {
  G.time += dt;
  const S = G.serpent;
  if (G.emptyCd > 0) G.emptyCd -= dt;
  if (G.emptySndCd > 0) G.emptySndCd -= dt;

  if (S.alive) {
    const ctrl = G.attract || G.bot ? Bot.control(dt) : Input.control();
    const loop = S.update(dt, ctrl);
    if (S.justDashed) {
      Sfx.dash();
      FX.ring(S.x, S.y, 8, 46, 0.25, '170,230,255', 3);
    }
    if (S.dashing && chance(dt * 80)) {
      FX.spark(S.x + rand(-6, 6), S.y + rand(-6, 6), -Math.cos(S.heading) * 70, -Math.sin(S.heading) * 70, 0.3, 3, '170,230,255', 2, 1);
    }
    if (loop) resolveLoop(loop.poly, loop.area);
    if (!G.attract) G.stats.time += dt;
  } else if (G.deathT >= 0) {
    updateDeath(dt);
  }

  if (S.alive) Director.update(dt);
  updateRifts(dt);
  updateEnemies(dt);
  updateShots(dt);
  updatePickups(dt);
  updateSeals(dt);
  collideHead();

  // a chain only runs down while there is something to catch
  if (G.chain > 0 && countPrey() > 0) {
    G.chainT -= dt;
    if (G.chainT <= 0) G.chain = 0;
  }
  FX.update(dt);
}

/* ---- render -------------------------------------------------------------- */

function drawArena(ctx) {
  ctx.strokeStyle = 'rgba(150,180,255,0.1)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, View.W - 2, View.H - 2);
}

function drawGaze(ctx, t) {
  const S = G.serpent;
  if (!S.alive || !boonLevel('gaze')) return;
  ctx.save();
  ctx.translate(S.x, S.y);
  ctx.rotate(t * 0.5);
  ctx.setLineDash([3, 9]);
  ctx.strokeStyle = 'rgba(190,255,170,0.22)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, GAZE_R, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

function drawReticle(ctx) {
  if (G.state !== 'playing' || G.attract || G.bot || Input.mode !== 'pointer' || !G.serpent.alive) return;
  const x = View.toWorldX(Input.cx), y = View.toWorldY(Input.cy);
  ctx.save();
  ctx.strokeStyle = 'rgba(200,235,255,0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = 'rgba(200,235,255,0.8)';
  ctx.fillRect(x - 1, y - 1, 2, 2);
  ctx.restore();
}

function render(dt) {
  const ctx = View.ctx, S = G.serpent;
  const t = G.realTime, gt = G.time;

  Sky.draw(ctx, t, dt);

  let sx = 0, sy = 0;
  if (FX.shake > 0.3) {
    sx = rand(-1, 1) * FX.shake;
    sy = rand(-1, 1) * FX.shake;
  }
  View.applyWorld(ctx, sx, sy);

  drawArena(ctx);
  drawSeals(ctx, gt);
  drawRifts(ctx, gt);
  drawTelegraphs(ctx);
  drawPickups(ctx, gt);
  drawGaze(ctx, gt);
  S.drawBody(ctx, gt);
  drawEnemies(ctx, gt);
  drawShots(ctx);
  S.drawHead(ctx, gt);
  FX.drawParticles(ctx);
  FX.drawRings(ctx);
  FX.drawBolts(ctx);
  FX.drawFloaters(ctx);

  View.applyWorld(ctx);
  drawReticle(ctx);
  HUD.draw(ctx, t, dt);
  drawBanner(ctx, dt);

  if (FX.flashA > 0.01) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = rgba(FX.flashCol, FX.flashA.toFixed(3));
    ctx.fillRect(0, 0, View.canvas.width, View.canvas.height);
  }
}

/* ---- main loop ----------------------------------------------------------- */

let lastNow = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const raw = clamp((now - lastNow) / 1000, 0, 0.1);
  lastNow = now;
  G.realTime += raw;
  FX.shake *= Math.exp(-9 * raw);
  FX.flashA *= Math.exp(-5 * raw);

  if (G.state === 'playing' || G.state === 'title' || G.state === 'over') {
    let dt = Math.min(raw, 1 / 30);
    if (G.freeze > 0) { G.freeze -= raw; dt = 0; }
    else if (G.slowmo > 0) { G.slowmo -= raw; dt *= 0.35; }
    if (dt > 0) update(dt);
  }
  render(raw);
}

/* ---- debug / test hooks (harmless in normal play) ------------------------ */

window.STARCOIL = {
  G, CFG, View, Director, Sky, FX,
  autoPause: true,
  start: newRun,
  title: toTitle,
  render: () => render(0),
  bot(on) { G.bot = !!on; },
  god(on) { G.god = !!on; },
  boon(id) { applyBoon(id); },
  pickBoon(i) { UI.pickBoon(i, true); },
  /** Run the simulation forward without drawing. */
  step(seconds, dt) {
    dt = dt || 1 / 60;
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) {
      if (G.state === 'playing' || G.state === 'title' || G.state === 'over') {
        G.freeze = 0;
        update(dt);
      }
    }
    return {
      state: G.state, wave: G.wave, score: G.score, hearts: G.hearts,
      enemies: G.enemies.length, banished: G.stats.banished, coils: G.stats.coils,
    };
  },
};

/* ---- boot ---------------------------------------------------------------- */

function boot(carried) {
  View.init(document.getElementById('game'));
  Sky.init();
  UI.init();
  Input.init();

  window.addEventListener('resize', () => {
    View.resize();
    Sky.render();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
  window.addEventListener('blur', () => { if (window.STARCOIL.autoPause) pauseGame(); });

  toTitle();
  if (carried && carried.run) {
    try { newRun(carried.run); } catch (err) { toTitle(); }
  }
  requestAnimationFrame((now) => {
    lastNow = now;
    requestAnimationFrame(frame);
  });
}

/* Opened as a plain file there is no host, and the game simply boots. When a host
   offers a live-update hook, register what to carry across an update and let it
   hand back whatever the previous version saved. Every step is optional and
   guarded: nothing here may ever stop the game from starting. */
(function start() {
  const hot = window.claude && window.claude.hot;
  let started = false;
  const go = (data) => {
    if (started) return;
    started = true;
    boot(data);
  };
  if (!hot) { go(null); return; }
  try {
    if (typeof hot.snapshot === 'function') hot.snapshot(() => ({ run: snapshotRun() }));
  } catch (err) { /* carrying a run across is a nicety, not a requirement */ }
  if (typeof hot.ready === 'function') {
    try { hot.ready(go); } catch (err) { go(hot.data); }
    setTimeout(() => go(hot.data), 1500);
  } else {
    go(hot.data);
  }
})();
