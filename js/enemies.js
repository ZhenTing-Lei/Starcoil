'use strict';
/* ==========================================================================
   STARCOIL — the shades: kinds, behaviour, drawing; plus their bolts,
   the rifts they arrive through, and pickups
   ========================================================================== */

const ETYPE = {
  wisp:    { r: 11, hp: 1, value: 10,  speed: 78,  rgb: '255,92,147',  small: true },
  mote:    { r: 6,  hp: 1, value: 4,   speed: 126, rgb: '255,160,215', small: true },
  darter:  { r: 12, hp: 1, value: 25,  speed: 62,  rgb: '255,165,60' },
  gnawer:  { r: 12, hp: 1, value: 30,  speed: 110, rgb: '200,255,74' },
  spitter: { r: 14, hp: 1, value: 40,  speed: 66,  rgb: '183,139,255' },
  brute:   { r: 25, hp: 2, value: 70,  speed: 46,  rgb: '255,110,80' },
  thorn:   { r: 15, hp: 1, value: 0,   speed: 0,   rgb: '255,50,80', hazard: true },
  boss:    { r: 40, hp: 3, value: 600, speed: 29,  rgb: '255,180,70', boss: true },
};

const SWARM_SIZE = 7;       // motes released by one swarm rift

function makeEnemy(type, x, y) {
  const d = ETYPE[type];
  const e = {
    type, x, y, vx: 0, vy: 0, kx: 0, ky: 0,
    r: d.r, hp: d.hp, maxHp: d.hp, value: d.value, hitValue: 0,
    speed: d.speed * G.diff, rgb: d.rgb,
    t: 0, st: 0, state: '', seed: rand(TAU), ang: rand(TAU), aim: 0,
    spawnT: 0.4, dying: -1, popIdx: 0, star: null, silent: false, dead: false,
    immune: 0, flash: 0, slow: 1, intangible: false, fade: 1,
    hazard: !!d.hazard, boss: !!d.boss, small: !!d.small,
  };
  const ai = AI[type];
  if (ai.init) ai.init(e);
  return e;
}

function spawnEnemy(type, x, y) {
  const e = makeEnemy(type, x, y);
  G.enemies.push(e);
  return e;
}

/** Ease velocity toward a heading and move. */
function seek(e, nx, ny, sp, rate, dt) {
  const k = damp(rate, dt);
  e.vx += (nx * sp - e.vx) * k;
  e.vy += (ny * sp - e.vy) * k;
  e.x += e.vx * dt;
  e.y += e.vy * dt;
}

function coast(e, rate, dt) {
  const k = Math.exp(-rate * dt);
  e.vx *= k; e.vy *= k;
  e.x += e.vx * dt;
  e.y += e.vy * dt;
}

function bounceWalls(e) {
  if (e.x < e.r && e.vx < 0) e.vx = -e.vx;
  else if (e.x > View.W - e.r && e.vx > 0) e.vx = -e.vx;
  if (e.y < e.r && e.vy < 0) e.vy = -e.vy;
  else if (e.y > View.H - e.r && e.vy > 0) e.vy = -e.vy;
}

/* ---- behaviour ----------------------------------------------------------- */

const AI = {
  /* Wisp — the common shade. Drifts straight at the serpent's head. */
  wisp: {
    update(e, dt, sm) {
      const S = G.serpent;
      let dx = S.x - e.x, dy = S.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d; dy /= d;
      const w = Math.sin(e.t * 2.6 + e.seed) * 0.55;
      const ax = dx - dy * w, ay = dy + dx * w;
      const al = Math.hypot(ax, ay) || 1;
      seek(e, ax / al, ay / al, e.speed * sm, 3.2, dt);
    },
  },

  /* Mote — tiny, quick, arrives in swarms. */
  mote: {
    update(e, dt, sm) {
      const S = G.serpent;
      let dx = S.x - e.x, dy = S.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d; dy /= d;
      const w = Math.sin(e.t * 5 + e.seed) * 1.0;
      const ax = dx - dy * w, ay = dy + dx * w;
      const al = Math.hypot(ax, ay) || 1;
      seek(e, ax / al, ay / al, e.speed * sm, 4.5, dt);
    },
  },

  /* Darter — stalks, takes aim along a visible line, then lunges. */
  darter: {
    init(e) { e.state = 'stalk'; },
    update(e, dt, sm) {
      const S = G.serpent;
      const dx = S.x - e.x, dy = S.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      e.st += dt;
      if (e.state === 'stalk') {
        seek(e, dx / d, dy / d, e.speed * sm, 3, dt);
        e.ang = Math.atan2(e.vy, e.vx);
        if ((d < 430 && e.st > 0.9) || e.st > 3.4) {
          e.state = 'aim'; e.st = 0;
          e.aim = Math.atan2(dy, dx);
        }
      } else if (e.state === 'aim') {
        coast(e, 8, dt);
        if (e.st < 0.5) e.aim += angleDiff(e.aim, Math.atan2(dy, dx)) * damp(10, dt);
        e.ang = e.aim;
        if (e.st >= 0.8) {
          e.state = 'dash'; e.st = 0;
          const sp = Math.min(520 + G.wave * 10, 760);
          e.vx = Math.cos(e.aim) * sp;
          e.vy = Math.sin(e.aim) * sp;
          Sfx.dart();
        }
      } else if (e.state === 'dash') {
        e.x += e.vx * sm * dt;
        e.y += e.vy * sm * dt;
        bounceWalls(e);
        e.ang = Math.atan2(e.vy, e.vx);
        if (chance(dt * 45)) FX.spark(e.x, e.y, 0, 0, 0.28, 5, e.rgb, 1, 0);
        if (e.st >= 0.55) { e.state = 'rest'; e.st = 0; }
      } else {
        coast(e, 4, dt);
        if (e.st >= 1.0) { e.state = 'stalk'; e.st = 0; }
      }
    },
  },

  /* Gnawer — ignores the head and goes for the body, biting the tail off. */
  gnawer: {
    init(e) { e.state = 'hunt'; },
    update(e, dt, sm) {
      const S = G.serpent;
      e.st += dt;
      if (e.state === 'stun') {
        e.ang += dt * 2.5;
        coast(e, 5, dt);
        if (e.st > 2.3) { e.state = 'hunt'; e.st = 0; }
        return;
      }
      e.ang += dt * 9;
      // It can only bite off tail beyond the length the serpent needs to close a coil.
      // With no such tail to chew, it settles for chasing the head, a little slower.
      let tx = S.x, ty = S.y, bite = null;
      if (S.alive) {
        bite = S.nearestBody(e.x, e.y, S.safeLen());
        if (bite) { tx = bite.x; ty = bite.y; }
      }
      const dx = tx - e.x, dy = ty - e.y;
      const d = Math.hypot(dx, dy) || 1;
      seek(e, dx / d, dy / d, e.speed * sm * (bite ? 1 : 0.8), 4, dt);
      if (bite && d < e.r + 5 && e.spawnT <= 0) gnawBite(e, bite);
    },
  },

  /* Spitter — keeps its distance and lobs slow bolts. */
  spitter: {
    init(e) { e.state = 'roam'; e.cd = rand(1.4, 2.4); e.strafe = randSign(); },
    update(e, dt, sm) {
      const S = G.serpent;
      const dx = S.x - e.x, dy = S.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const nx = dx / d, ny = dy / d;
      e.st += dt;
      e.ang = Math.atan2(dy, dx);

      let mx = 0, my = 0;
      if (d > 360) { mx = nx; my = ny; }
      else if (d < 250) { mx = -nx; my = -ny; }
      mx += -ny * e.strafe * 0.6;
      my += nx * e.strafe * 0.6;
      // stay out of the corners
      if (e.x < 70) mx += 1; else if (e.x > View.W - 70) mx -= 1;
      if (e.y < 70) my += 1; else if (e.y > View.H - 70) my -= 1;
      if (chance(dt * 0.25)) e.strafe = -e.strafe;
      const ml = Math.hypot(mx, my) || 1;
      seek(e, mx / ml, my / ml, e.speed * sm * (e.state === 'charge' ? 0.25 : 1), 3, dt);

      if (e.state === 'roam') {
        e.cd -= dt * sm;
        if (e.cd <= 0 && S.alive && e.spawnT <= 0) { e.state = 'charge'; e.st = 0; }
      } else if (e.st >= 0.6) {
        fireShot(e.x + nx * e.r, e.y + ny * e.r, e.ang, 160 + G.wave * 4);
        Sfx.spit();
        e.state = 'roam';
        e.cd = Math.max(1.7, 3.0 - G.wave * 0.06) + rand(0.5);
      }
    },
  },

  /* Brute — armoured. The first coil only cracks its shell (and enrages it). */
  brute: {
    init(e) { e.hitValue = 30; },
    update(e, dt, sm) {
      e.st += dt;
      if (e.state === 'stun') {
        coast(e, 5, dt);
        if (e.st > 0.9) e.state = '';
        return;
      }
      const S = G.serpent;
      const dx = S.x - e.x, dy = S.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      seek(e, dx / d, dy / d, e.speed * sm * (e.hp < e.maxHp ? 2.0 : 1), 2.2, dt);
    },
    wound(e, ox, oy) {
      e.state = 'stun'; e.st = 0;
      e.immune = 0.7;               // one coil cannot take both lives at once
      e.r = 19;
      const dx = e.x - ox, dy = e.y - oy;
      const d = Math.hypot(dx, dy) || 1;
      e.kx = (dx / d) * 200; e.ky = (dy / d) * 200;
      FX.burst(e.x, e.y, '190,170,175', 16, 240, 0.6, 5, 0);
      FX.ring(e.x, e.y, 10, 60, 0.35, '255,140,110', 3);
      Sfx.crack();
    },
  },

  /* Thorn — a hazard, not prey. Any coil that encloses one shatters. */
  thorn: {
    init(e) { e.spawnT = 0.6; },
    update(e, dt) { e.ang += dt * 0.5; },
  },

  /* The Eclipse — the boss. Each coil around it breaks one seal. */
  boss: {
    init(e) {
      const tier = (G.dir && G.dir.bossTier) || 1;
      e.tier = tier;
      e.hp = e.maxHp = 2 + tier;
      e.value = 600 * tier;
      e.hitValue = 150 * tier;
      e.speed = 24 + tier * 5;
      e.state = 'enter'; e.st = 0;
      e.spawnT = 0;
      e.intangible = true;
      e.immune = 1.4;
      e.fade = 0;
      e.lastAtk = '';
      e.fired = false;
      e.ring2 = 0;
      e.ringBase = 0;
      e.driftDur = 2;
      e.spin = 1; e.spiralA = 0; e.spiralT = 0;
      e.moved = false;
    },

    update(e, dt, sm) {
      const S = G.serpent;
      const dx = S.x - e.x, dy = S.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      e.st += dt;
      e.ang += dt * 0.5;

      switch (e.state) {
        case 'enter':
          e.fade = Math.min(1, e.st / 1.3);
          if (e.st >= 1.4) { e.intangible = false; bossSet(e, 'drift'); }
          break;

        case 'drift':
          seek(e, dx / d, dy / d, e.speed * sm, 1.5, dt);
          if (e.st >= e.driftDur && S.alive) bossAttack(e);
          break;

        case 'burst':
          coast(e, 4, dt);
          if (!e.fired && e.st >= 0.9) {
            e.fired = true;
            e.ringBase = rand(TAU);
            bossRing(e, 0);
            if (e.tier >= 2) e.ring2 = 0.45;
          }
          if (e.ring2 > 0) {
            e.ring2 -= dt;
            if (e.ring2 <= 0) bossRing(e, 0.5);
          }
          if (e.st >= 1.7) bossSet(e, 'drift');
          break;

        case 'summon':
          coast(e, 4, dt);
          if (!e.fired && e.st >= 0.8) {
            e.fired = true;
            const n = 2 + e.tier;
            const base = rand(TAU);
            for (let i = 0; i < n; i++) {
              const a = base + (i / n) * TAU;
              addRift(e.x + Math.cos(a) * 120, e.y + Math.sin(a) * 120, e.tier >= 3 && i === 0 ? 'darter' : 'wisp', i * 0.1);
            }
            Sfx.summon();
          }
          if (e.st >= 1.3) bossSet(e, 'drift');
          break;

        case 'aim':
          coast(e, 6, dt);
          if (e.st < 0.7) e.aim += angleDiff(e.aim, Math.atan2(dy, dx)) * damp(8, dt);
          if (e.st >= 1.0) {
            bossSet(e, 'charge');
            const sp = 470 + e.tier * 30;
            e.vx = Math.cos(e.aim) * sp;
            e.vy = Math.sin(e.aim) * sp;
            Sfx.bossCharge();
          }
          break;

        case 'charge':
          e.x += e.vx * dt;
          e.y += e.vy * dt;
          bounceWalls(e);
          if (chance(dt * 60)) FX.spark(e.x + rand(-20, 20), e.y + rand(-20, 20), 0, 0, 0.4, 12, '255,140,70', 1, 0);
          if (e.st >= 0.85) bossSet(e, 'drift');
          break;

        case 'spiral':
          seek(e, dx / d, dy / d, e.speed * 0.5 * sm, 1.5, dt);
          if (e.st >= 0.5 && e.st < 2.7) {
            e.spiralT -= dt;
            while (e.spiralT <= 0) {
              e.spiralT += 0.085;
              e.spiralA += 0.42 * e.spin;
              fireShot(e.x + Math.cos(e.spiralA) * e.r * 0.8, e.y + Math.sin(e.spiralA) * e.r * 0.8, e.spiralA, 130 + e.tier * 8);
            }
          }
          if (e.st >= 3.1) bossSet(e, 'drift');
          break;

        case 'reel':      // a seal just broke: fade out, reappear somewhere else
          if (e.st < 0.5) {
            e.fade = 1 - e.st / 0.5;
          } else if (!e.moved) {
            e.moved = true;
            let bx = e.x, by = e.y, bd = -1;
            for (let i = 0; i < 12; i++) {
              const x = rand(120, View.W - 120), y = rand(110, View.H - 110);
              const dd = Math.hypot(x - S.x, y - S.y);
              if (dd > bd) { bd = dd; bx = x; by = y; }
            }
            e.x = bx; e.y = by;
            e.vx = e.vy = e.kx = e.ky = 0;
            e.fade = 0;
            FX.ring(e.x, e.y, 120, 30, 0.7, '255,200,120', 3);
          } else if (e.st < 1.35) {
            e.fade = (e.st - 0.5) / 0.85;
          } else {
            e.fade = 1;
            e.intangible = false;
            bossSet(e, 'drift');
          }
          break;
      }
    },

    wound(e) {
      e.state = 'reel'; e.st = 0;
      e.moved = false;
      e.intangible = true;
      e.immune = 1.6;
      e.vx = e.vy = 0;
      onBossWound(e);
    },
  },
};

function bossSet(e, state) {
  e.state = state;
  e.st = 0;
  e.fired = false;
  e.ring2 = 0;
  if (state === 'drift') e.driftDur = (1.6 + 1.4 * (e.hp / e.maxHp)) * rand(0.85, 1.15);
  else if (state === 'aim') e.aim = Math.atan2(G.serpent.y - e.y, G.serpent.x - e.x);
  else if (state === 'spiral') { e.spin = randSign(); e.spiralA = rand(TAU); e.spiralT = 0; }
  if (state === 'burst' || state === 'spiral') Sfx.bossWind();
}

function bossAttack(e) {
  const opts = ['burst', 'aim'];
  if (countPrey() < 7) opts.push('summon');
  if (e.tier >= 2) opts.push('spiral');
  let a = pick(opts);
  for (let i = 0; i < 6 && a === e.lastAtk; i++) a = pick(opts);
  e.lastAtk = a;
  bossSet(e, a);
}

function bossRing(e, halfStep) {
  const n = 10 + e.tier * 2;
  for (let i = 0; i < n; i++) {
    const a = e.ringBase + ((i + halfStep) / n) * TAU;
    fireShot(e.x + Math.cos(a) * e.r * 0.8, e.y + Math.sin(a) * e.r * 0.8, a, 140 + e.tier * 10);
  }
  FX.ring(e.x, e.y, e.r, e.r * 2.4, 0.35, '255,150,90', 4);
  Sfx.bossFire();
}

/** Shades that still have to be banished (hazards don't count). */
function countPrey() {
  let n = 0;
  for (let i = 0; i < G.enemies.length; i++) {
    const e = G.enemies[i];
    if (!e.dead && !e.hazard) n++;
  }
  return n;
}

function gnawBite(e, bite) {
  const S = G.serpent;
  e.state = 'stun'; e.st = 0;
  const dx = e.x - bite.x, dy = e.y - bite.y;
  const d = Math.hypot(dx, dy) || 1;
  e.kx = (dx / d) * 240; e.ky = (dy / d) * 240;
  e.vx = e.vy = 0;

  if (boonLevel('scales') > 0) {
    FX.burst(bite.x, bite.y, '220,240,255', 10, 220, 0.35, 3, 2);
    FX.text(bite.x, bite.y - 18, 'CLANG', 15, '200,225,255', 0.7);
    Sfx.clang();
    e.st = -1.2;                    // a broken tooth keeps it dazed longer
    return;
  }
  const lost = S.cutAt(bite.idx);
  for (let i = 0; i < lost.length; i += 2) {
    FX.spark(lost[i].x, lost[i].y, rand(-30, 30), rand(-30, 30), rand(0.4, 0.9), 3.5, '130,170,255', 0);
  }
  FX.burst(bite.x, bite.y, '200,255,74', 12, 200, 0.4, 3, 2);
  FX.text(bite.x, bite.y - 18, 'SEVERED', 16, '200,255,120', 0.9);
  FX.addShake(5);
  Sfx.cut();
  hintOnce('gnaw', 'A Gnawer bit through your tail. It grows back — but coil them before they reach you.');
}

/* ---- update -------------------------------------------------------------- */

const GAZE_R = 175;
const GAZE_MULT = [1, 0.7, 0.55, 0.42];

function updateEnemies(dt) {
  const S = G.serpent, list = G.enemies;
  const gaze = S.alive ? boonLevel('gaze') : 0;
  const gazeMult = GAZE_MULT[gaze];

  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    e.t += dt;
    if (e.flash > 0) e.flash -= dt;
    if (e.immune > 0) e.immune -= dt;
    if (e.dying >= 0) {
      e.dying -= dt;
      if (e.dying <= 0) destroyEnemy(e);
      continue;
    }
    if (e.spawnT > 0) e.spawnT -= dt;

    let sm = 1;
    if (gaze) {
      const dx = e.x - S.x, dy = e.y - S.y;
      if (dx * dx + dy * dy < GAZE_R * GAZE_R) sm = e.boss ? lerp(1, gazeMult, 0.4) : gazeMult;
    }
    e.slow = sm;
    AI[e.type].update(e, dt, sm);

    if (e.kx !== 0 || e.ky !== 0) {
      e.x += e.kx * dt;
      e.y += e.ky * dt;
      const k = Math.exp(-5 * dt);
      e.kx *= k; e.ky *= k;
      if (Math.abs(e.kx) + Math.abs(e.ky) < 2) e.kx = e.ky = 0;
    }
    e.x = clamp(e.x, e.r, View.W - e.r);
    e.y = clamp(e.y, e.r, View.H - e.r);
  }

  // keep shades from stacking into a single point
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.dead || a.dying >= 0 || a.hazard || a.boss) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (b.dead || b.dying >= 0 || b.hazard || b.boss) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const rr = a.r + b.r;
      const d2 = dx * dx + dy * dy;
      if (d2 < rr * rr && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const push = (rr - d) * 0.3;
        const nx = dx / d, ny = dy / d;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
      }
    }
  }

  for (let i = list.length - 1; i >= 0; i--) if (list[i].dead) list.splice(i, 1);
}

/**
 * One coil's worth of harm. Lethal blows are deferred by `delay` so a big
 * catch pops one shade after another. Returns the points it is worth.
 */
function strikeEnemy(e, delay, ox, oy, idx) {
  e.hp -= 1;
  e.flash = 0.3;
  if (e.hp <= 0) {
    e.dying = Math.max(0.001, delay);
    e.popIdx = idx || 0;
    e.star = Sky.addStar(e.x, e.y, delay);
    return e.value;
  }
  const ai = AI[e.type];
  if (ai.wound) ai.wound(e, ox, oy);
  return e.hitValue || Math.round(e.value * 0.4);
}

function destroyEnemy(e) {
  e.dead = true;
  e.dying = -1;
  if (e.silent) {
    FX.burst(e.x, e.y, e.rgb, 8, 120, 0.4, 3, 0);
    return;
  }
  const big = e.boss ? 3 : e.type === 'brute' ? 1.8 : e.type === 'mote' ? 0.6 : 1;
  FX.burst(e.x, e.y, e.rgb, Math.round(10 * big), 230 * Math.sqrt(big), 0.6, 4, 2);
  FX.burst(e.x, e.y, '255,236,190', Math.round(6 * big), 150, 0.8, 3, 0);
  FX.spark(e.x, e.y, 0, 0, 0.35, 16 * big, '255,240,210', 1, 0);
  FX.ring(e.x, e.y, e.r * 0.6, e.r * 2.6, 0.3, e.rgb, 2);
  Sfx.pop(e.popIdx);
  G.stats.banished++;
  if (e.boss) onBossDeath(e);
}

/* ---- bolts --------------------------------------------------------------- */

function fireShot(x, y, ang, speed) {
  if (G.shots.length > 170) return;
  G.shots.push({ x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, r: 6, life: 7, dead: false });
}

function popShot(s) {
  if (s.dead) return;
  s.dead = true;
  FX.burst(s.x, s.y, '255,150,110', 5, 120, 0.3, 2.5, 0);
}

function updateShots(dt) {
  const list = G.shots;
  for (let i = list.length - 1; i >= 0; i--) {
    const s = list[i];
    s.life -= dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    if (s.dead || s.life <= 0 || s.x < -30 || s.x > View.W + 30 || s.y < -30 || s.y > View.H + 30) {
      list[i] = list[list.length - 1];
      list.pop();
    }
  }
}

/* ---- rifts --------------------------------------------------------------- */

function addRift(x, y, type, delay) {
  G.rifts.push({
    x: clamp(x, 34, View.W - 34), y: clamp(y, 34, View.H - 34),
    type, t: -(delay || 0), dur: type === 'boss' ? 1.6 : 0.95, seed: rand(TAU),
  });
}

function updateRifts(dt) {
  const list = G.rifts;
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i];
    r.t += dt;
    if (r.t < r.dur) continue;
    list.splice(i, 1);
    if (r.type === 'swarm') {
      for (let j = 0; j < SWARM_SIZE; j++) {
        const a = rand(TAU), d = rand(4, 26);
        spawnEnemy('mote', r.x + Math.cos(a) * d, r.y + Math.sin(a) * d);
      }
    } else {
      spawnEnemy(r.type, r.x, r.y);
    }
    FX.burst(r.x, r.y, '170,110,255', 10, 160, 0.4, 3, 0);
    if (r.type === 'boss') {
      FX.ring(r.x, r.y, 20, 220, 0.8, '255,190,110', 5);
      FX.addShake(10);
      Sfx.bossRoar();
    }
  }
}

/* ---- pickups ------------------------------------------------------------- */

function addPickup(kind, x, y) {
  G.pickups.push({ kind, x, y, bx: x, by: y, t: 0, life: 26, seed: rand(TAU), dead: false });
}

function updatePickups(dt) {
  const list = G.pickups;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.t += dt;
    p.life -= dt;
    p.x = p.bx + Math.sin(p.t * 0.7 + p.seed) * 16;
    p.y = p.by + Math.cos(p.t * 0.9 + p.seed) * 12;
    if (p.dead || p.life <= 0) list.splice(i, 1);
  }
}

/* ---- drawing ------------------------------------------------------------- */

function heartPath(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.9);
  ctx.bezierCurveTo(x - s * 1.5, y - s * 0.1, x - s * 0.8, y - s * 1.15, x, y - s * 0.35);
  ctx.bezierCurveTo(x + s * 0.8, y - s * 1.15, x + s * 1.5, y - s * 0.1, x, y + s * 0.9);
  ctx.closePath();
}

function spikyPath(ctx, points, rOuter, rInner) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = (i / (points * 2)) * TAU;
    const rr = i % 2 === 0 ? rOuter : rInner;
    if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
}

function ngonPath(ctx, sides, r, rot) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * TAU + rot;
    if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
}

/* Each draws around the origin; the caller has already translated. */
const DRAW = {
  wisp(ctx, e, t) {
    const r = e.r;
    ctx.rotate(Math.atan2(e.vy, e.vx));
    const w = Math.sin(t * 10 + e.seed);
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.bezierCurveTo(r, -r * 1.15, -r * 0.7, -r * 1.05, -r * (2.0 + 0.25 * w), r * 0.35 * w);
    ctx.bezierCurveTo(-r * 0.7, r * 1.05, r, r * 1.15, r, 0);
    ctx.closePath();
    ctx.fillStyle = '#2a0b33';
    ctx.fill();
    ctx.strokeStyle = 'rgb(' + e.rgb + ')';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = rgba(e.rgb, 0.9);
    ctx.beginPath();
    ctx.arc(-r * 0.2, 0, r * 0.3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff3c4';
    ctx.beginPath();
    ctx.arc(r * 0.42, -r * 0.34, 1.7, 0, TAU);
    ctx.moveTo(r * 0.42 + 1.7, r * 0.34);
    ctx.arc(r * 0.42, r * 0.34, 1.7, 0, TAU);
    ctx.fill();
  },

  mote(ctx, e) {
    const r = e.r;
    ctx.rotate(Math.atan2(e.vy, e.vx));
    ctx.beginPath();
    ctx.moveTo(r * 1.3, 0);
    ctx.lineTo(0, -r * 0.8);
    ctx.lineTo(-r * 1.6, 0);
    ctx.lineTo(0, r * 0.8);
    ctx.closePath();
    ctx.fillStyle = '#3b1140';
    ctx.fill();
    ctx.strokeStyle = 'rgb(' + e.rgb + ')';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillRect(-1, -1, 2, 2);
  },

  darter(ctx, e) {
    const r = e.r;
    ctx.rotate(e.ang);
    const sq = e.state === 'aim' ? 1 - 0.22 * Math.min(1, e.st / 0.8) : e.state === 'dash' ? 1.28 : 1;
    ctx.scale(sq, 1 / sq);
    ctx.beginPath();
    ctx.moveTo(r * 1.5, 0);
    ctx.lineTo(-r * 0.9, -r * 0.85);
    ctx.lineTo(-r * 0.35, 0);
    ctx.lineTo(-r * 0.9, r * 0.85);
    ctx.closePath();
    ctx.fillStyle = '#331a05';
    ctx.fill();
    ctx.strokeStyle = 'rgb(' + e.rgb + ')';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.fillStyle = e.state === 'aim' ? '#ffffff' : 'rgb(' + e.rgb + ')';
    ctx.beginPath();
    ctx.arc(r * 0.35, 0, 2.3, 0, TAU);
    ctx.fill();
  },

  gnawer(ctx, e) {
    const r = e.r, stun = e.state === 'stun';
    ctx.rotate(e.ang);
    spikyPath(ctx, 8, r * 1.25, r * 0.78);
    ctx.fillStyle = '#1c2a08';
    ctx.fill();
    ctx.strokeStyle = rgba(e.rgb, stun ? 0.45 : 1);
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.fillStyle = rgba(e.rgb, stun ? 0.3 : 0.9);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.3, 0, TAU);
    ctx.fill();
  },

  spitter(ctx, e) {
    const r = e.r;
    const charge = e.state === 'charge' ? Math.min(1, e.st / 0.6) : 0;
    ngonPath(ctx, 6, r * 1.1, Math.PI / 6);
    ctx.fillStyle = '#1d1038';
    ctx.fill();
    ctx.strokeStyle = 'rgb(' + e.rgb + ')';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
    const px = Math.cos(e.ang) * r * 0.38, py = Math.sin(e.ang) * r * 0.38;
    ctx.fillStyle = charge > 0 ? 'rgb(255,205,175)' : 'rgb(' + e.rgb + ')';
    ctx.beginPath();
    ctx.arc(px, py, r * (0.3 + 0.22 * charge), 0, TAU);
    ctx.fill();
    if (charge > 0) {
      ctx.strokeStyle = rgba('255,170,130', charge);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r * (2.3 - 1.1 * charge), 0, TAU);
      ctx.stroke();
    }
  },

  brute(ctx, e, t) {
    const r = e.r, shelled = e.hp >= e.maxHp;
    ctx.rotate(Math.sin(t * 1.3 + e.seed) * 0.12);
    ngonPath(ctx, 8, r * 1.08, Math.PI / 8);
    ctx.lineJoin = 'round';
    if (shelled) {
      ctx.fillStyle = '#3a2c36';
      ctx.fill();
      ctx.strokeStyle = '#c9b3b8';
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(201,179,184,0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + Math.PI / 8;
        ctx.moveTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5);
        ctx.lineTo(Math.cos(a) * r * 1.05, Math.sin(a) * r * 1.05);
      }
      ctx.stroke();
    } else {
      ctx.fillStyle = '#3d0f0a';
      ctx.fill();
      ctx.strokeStyle = 'rgb(' + e.rgb + ')';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    const pulse = 0.75 + 0.25 * Math.sin(t * (shelled ? 3 : 9) + e.seed);
    ctx.fillStyle = rgba(e.rgb, pulse);
    ctx.beginPath();
    ctx.arc(0, 0, r * (shelled ? 0.34 : 0.5), 0, TAU);
    ctx.fill();
  },

  thorn(ctx, e, t) {
    const r = e.r;
    ctx.save();
    ctx.rotate(-t * 0.6);
    ctx.setLineDash([5, 7]);
    ctx.strokeStyle = rgba(e.rgb, 0.4 + 0.2 * Math.sin(t * 4));
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.3, 0, TAU);
    ctx.stroke();
    ctx.restore();
    ctx.rotate(e.ang);
    spikyPath(ctx, 7, r * 1.5, r * 0.55);
    ctx.fillStyle = '#14060a';
    ctx.fill();
    ctx.strokeStyle = 'rgb(' + e.rgb + ')';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = rgba(e.rgb, 0.9);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.22, 0, TAU);
    ctx.fill();
  },

  boss(ctx, e, t) {
    const r = e.r;
    const hot = e.state === 'burst' || e.state === 'aim' || e.state === 'spiral' || e.state === 'summon' || e.state === 'charge';
    // corona
    ctx.save();
    ctx.rotate(e.ang);
    ctx.beginPath();
    const flares = 14;
    for (let i = 0; i < flares * 2; i++) {
      const a = (i / (flares * 2)) * TAU;
      const rr = i % 2 === 0 ? r * (1.42 + Math.sin(t * 3 + i * 1.7) * 0.09) : r * 1.08;
      if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = hot ? 'rgba(255,110,70,0.92)' : rgba(e.rgb, 0.85);
    ctx.fill();
    ctx.restore();
    // the dark disc
    ctx.fillStyle = '#05020a';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,230,170,0.9)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // an eye that follows the serpent
    const look = Math.atan2(G.serpent.y - e.y, G.serpent.x - e.x);
    ctx.save();
    ctx.translate(Math.cos(look) * r * 0.25, Math.sin(look) * r * 0.25);
    ctx.rotate(look);
    ctx.fillStyle = 'rgba(255,200,90,0.95)';
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.2, r * 0.42, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#05020a';
    ctx.beginPath();
    ctx.ellipse(r * 0.04, 0, r * 0.06, r * 0.3, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    // seals
    for (let i = 0; i < e.maxHp; i++) {
      const a = -t * 0.9 + (i / e.maxHp) * TAU;
      const on = i < e.hp;
      ctx.save();
      ctx.translate(Math.cos(a) * r * 1.85, Math.sin(a) * r * 1.85);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = on ? '#ffe7a8' : 'rgba(255,231,168,0.14)';
      ctx.fillRect(-4.5, -4.5, 9, 9);
      if (on) {
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 1;
        ctx.strokeRect(-4.5, -4.5, 9, 9);
      }
      ctx.restore();
    }
  },
};

function drawEnemies(ctx, t) {
  const list = G.enemies;
  if (!list.length) return;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.dead) continue;
    Glow.draw(ctx, e.x, e.y, e.r * (e.boss ? 3.2 : 2.6), e.rgb, 0.42 * e.fade);
  }
  ctx.restore();

  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.dead || e.fade <= 0.01) continue;
    let sc = 1;
    if (e.spawnT > 0) sc = clamp(easeOutBack(1 - e.spawnT / 0.6), 0.05, 1.3);
    if (e.dying >= 0) sc *= 1.18;

    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.scale(sc, sc);
    ctx.globalAlpha = e.fade;
    ctx.save();
    DRAW[e.type](ctx, e, t);
    ctx.restore();
    if (e.dying >= 0 || e.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = e.dying >= 0 ? 0.85 : Math.min(1, e.flash / 0.3) * 0.8;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, e.r * 1.05, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    if (e.slow < 1 && e.dying < 0) {            // held by the Basilisk Gaze
      ctx.strokeStyle = 'rgba(190,255,170,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r + 5, t * 3, t * 3 + Math.PI * 1.2);
      ctx.stroke();
    }
  }
}

/** Warnings drawn under the shades: aim lines and wind-up rings. */
function drawTelegraphs(ctx) {
  const list = G.enemies;
  ctx.save();
  ctx.lineCap = 'round';
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.dead || e.dying >= 0) continue;
    if (e.type === 'darter' && e.state === 'aim') {
      const locked = e.st >= 0.5;
      ctx.strokeStyle = rgba(e.rgb, locked ? 0.8 : 0.2 + 0.3 * (e.st / 0.5));
      ctx.lineWidth = locked ? 2.5 : 1.5;
      ctx.setLineDash(locked ? [] : [8, 8]);
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.x + Math.cos(e.aim) * 520, e.y + Math.sin(e.aim) * 520);
      ctx.stroke();
    } else if (e.boss) {
      ctx.setLineDash([]);
      if (e.state === 'aim') {
        const k = Math.min(1, e.st / 1.0);
        const ex = e.x + Math.cos(e.aim) * 900, ey = e.y + Math.sin(e.aim) * 900;
        ctx.strokeStyle = rgba('255,90,60', 0.1 + 0.12 * k);
        ctx.lineWidth = e.r * 2 * k;
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.strokeStyle = rgba('255,150,110', e.st >= 0.7 ? 0.9 : 0.4);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(ex, ey); ctx.stroke();
      } else if ((e.state === 'burst' && !e.fired) || (e.state === 'spiral' && e.st < 0.5)) {
        const k = Math.min(1, e.st / (e.state === 'burst' ? 0.9 : 0.5));
        ctx.strokeStyle = rgba('255,150,90', k);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * (3.2 - 1.9 * k), 0, TAU);
        ctx.stroke();
      } else if (e.state === 'summon' && !e.fired) {
        const k = Math.min(1, e.st / 0.8);
        ctx.strokeStyle = rgba('190,130,255', k);
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 8]);
        ctx.beginPath();
        ctx.arc(e.x, e.y, 120, 0, TAU);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

function drawRifts(ctx, t) {
  const list = G.rifts;
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (r.t < 0) continue;
    const k = Math.min(1, r.t / r.dur);
    const big = r.type === 'boss' ? 3.2 : r.type === 'brute' ? 1.7 : r.type === 'swarm' ? 1.4 : 1;
    const rad = (7 + 12 * easeOutCubic(k)) * big;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    Glow.draw(ctx, r.x, r.y, rad * 2.6, '150,90,255', 0.4 * k);
    ctx.restore();

    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.fillStyle = rgba('8,2,20', 0.8 * k);
    ctx.beginPath();
    ctx.arc(0, 0, rad, 0, TAU);
    ctx.fill();
    ctx.lineCap = 'round';
    ctx.rotate(t * 5 + r.seed);
    ctx.strokeStyle = rgba('180,120,255', 0.35 + 0.55 * k);
    ctx.lineWidth = 2;
    for (let j = 0; j < 3; j++) {
      ctx.beginPath();
      ctx.arc(0, 0, rad + 2, (j / 3) * TAU, (j / 3) * TAU + 1.3);
      ctx.stroke();
    }
    ctx.rotate(-t * 9);
    ctx.strokeStyle = rgba('255,150,220', 0.3 + 0.4 * k);
    ctx.lineWidth = 1.2;
    for (let j = 0; j < 2; j++) {
      ctx.beginPath();
      ctx.arc(0, 0, rad * 0.55, j * Math.PI, j * Math.PI + 1.6);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function drawShots(ctx) {
  const list = G.shots;
  if (!list.length) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < list.length; i++) Glow.draw(ctx, list[i].x, list[i].y, 17, '255,120,80', 0.75);
  ctx.restore();
  ctx.fillStyle = '#fff1dc';
  ctx.beginPath();
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    ctx.moveTo(s.x + 3.2, s.y);
    ctx.arc(s.x, s.y, 3.2, 0, TAU);
  }
  ctx.fill();
}

function drawPickups(ctx, t) {
  const list = G.pickups;
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const blink = p.life < 5 ? (Math.sin(p.life * 12) > 0 ? 1 : 0.35) : 1;
    const pulse = 1 + 0.1 * Math.sin(t * 5 + p.seed);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    Glow.draw(ctx, p.x, p.y, 36, '255,110,160', 0.6 * blink);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = blink;
    ctx.translate(p.x, p.y);
    ctx.save();                                   // the "encircle me" ring
    ctx.rotate(t * 0.8);
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = 'rgba(255,180,205,0.65)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 25, 0, TAU);
    ctx.stroke();
    ctx.restore();
    heartPath(ctx, 0, 0, 10 * pulse);
    ctx.fillStyle = '#ff6f9c';
    ctx.fill();
    ctx.strokeStyle = '#ffd3e0';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
}
