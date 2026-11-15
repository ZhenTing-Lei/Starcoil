'use strict';
/* ==========================================================================
   STARCOIL — the director: what each night holds, and when it arrives
   ========================================================================== */

/** The roster for night `n`. Every fifth night belongs to the Eclipse. */
function buildWave(n) {
  const q = [];
  const add = (type, k) => { for (let i = 0; i < k; i++) q.push(type); };
  const plan = {
    queue: q,
    sub: '',
    interval: Math.max(1.25, 2.7 - n * 0.09),      // seconds between packs
    maxAlive: Math.min(9 + n * 2, 38),
    packMin: 2,
    packMax: Math.min(3 + Math.floor(n / 3), 6),
    thorns: 0,
    boss: 0,
  };

  if (n % 5 === 0) {
    plan.boss = n / 5;
    plan.sub = plan.boss === 1 ? 'The Eclipse rises — coil around it to break its seals' : 'The Eclipse returns, stronger';
    return plan;
  }

  switch (n) {
    case 1:
      add('wisp', 8);
      plan.packMax = 2;
      plan.sub = 'Cross your own body to close a coil';
      break;
    case 2:
      add('wisp', 9); add('darter', 2);
      plan.sub = 'Darters lunge along the line they show';
      break;
    case 3:
      add('wisp', 9); add('darter', 2); add('gnawer', 2);
      plan.sub = 'Gnawers go for your tail';
      break;
    case 4:
      add('wisp', 10); add('darter', 3); add('gnawer', 2); add('spitter', 2);
      plan.sub = 'Spitters keep their distance';
      break;
    case 6:
      add('wisp', 10); add('swarm', 1); add('darter', 3); add('gnawer', 2); add('spitter', 2); add('brute', 1);
      plan.sub = 'Brutes must be coiled twice';
      break;
    case 7:
      add('wisp', 11); add('swarm', 1); add('darter', 3); add('gnawer', 3); add('spitter', 2); add('brute', 1);
      plan.thorns = 2;
      plan.sub = 'Never encircle a thorn';
      break;
    default: {
      // Later nights grow mostly in wisps and darters; the specialists are capped
      // so no single kind (a wall of gnawers, say) comes to dominate.
      const budget = 14 + n * 4.2;
      const gnawers = Math.min(5, Math.round((budget * 0.13) / 2));
      const spitters = Math.min(6, Math.round((budget * 0.15) / 3));
      const brutes = Math.min(6, Math.round((budget * 0.16) / 4));
      const swarms = Math.min(4, Math.max(1, Math.round(budget * 0.04)));
      const darters = Math.min(12, Math.round((budget * 0.16) / 2));
      const spent = gnawers * 2 + spitters * 3 + brutes * 4 + swarms * 2.5 + darters * 2;
      add('wisp', Math.max(8, Math.round(budget - spent)));
      add('swarm', swarms);
      add('darter', darters);
      add('gnawer', gnawers);
      add('spitter', spitters);
      add('brute', brutes);
      plan.thorns = Math.min(4, 1 + Math.floor(n / 6));
      plan.sub = pick(['The dark thickens', 'They come in numbers', 'Hold the vigil', 'The night deepens']);
    }
  }

  // Each night opens gently with wisps; the rest arrive in a shuffled order.
  const wisps = q.filter((t) => t === 'wisp');
  const rest = q.filter((t) => t !== 'wisp');
  const lead = wisps.splice(0, Math.min(4, wisps.length));
  plan.queue = lead.concat(shuffle(wisps.concat(rest)));
  return plan;
}

/** A point at least `minDist` from the serpent's head (best effort). */
function farPoint(margin, minDist, edgeBias) {
  const S = G.serpent, W = View.W, H = View.H;
  let bx = W / 2, by = H / 2, bd = -1;
  for (let i = 0; i < 14; i++) {
    let x, y;
    if (edgeBias) {
      const side = randInt(0, 3);
      if (side === 0) { x = rand(margin, W - margin); y = rand(margin, margin + 90); }
      else if (side === 1) { x = rand(margin, W - margin); y = rand(H - margin - 90, H - margin); }
      else if (side === 2) { x = rand(margin, margin + 90); y = rand(margin, H - margin); }
      else { x = rand(W - margin - 90, W - margin); y = rand(margin, H - margin); }
    } else {
      x = rand(margin, W - margin);
      y = rand(margin, H - margin);
    }
    const d = Math.hypot(x - S.x, y - S.y);
    if (d >= minDist) return { x, y };
    if (d > bd) { bd = d; bx = x; by = y; }
  }
  return { x: bx, y: by };
}

/** Open a cluster of rifts — packs arrive together so they can be coiled together. */
function spawnPack(types) {
  const p = farPoint(50, 270, true);
  for (let i = 0; i < types.length; i++) {
    const a = rand(TAU), d = types.length > 1 ? rand(14, 48) : 0;
    addRift(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, types[i], i * 0.12);
  }
  Sfx.rift();
}

const Director = {
  state: 'idle',            // idle | attract | intro | spawn | clear
  plan: null,
  queue: [],
  t: 0,
  packT: 0,
  interval: 2.4,
  maxAlive: 10,
  packMin: 2,
  packMax: 3,
  bossTier: 0,
  bossSpawned: false,
  bossDown: false,          // set when the Eclipse falls, so no more wisps trickle in
  trickleT: 0,
  heartT: -1,

  /** Title-screen mode: a handful of wisps for the demo serpent to chase. */
  attract() {
    this.state = 'attract';
    this.queue = [];
    this.bossTier = 0;
    this.packT = 0.8;
  },

  start(n) {
    const plan = buildWave(n);
    this.plan = plan;
    this.queue = plan.queue;
    this.interval = plan.interval;
    this.maxAlive = plan.maxAlive;
    this.packMin = plan.packMin;
    this.packMax = plan.packMax;
    this.bossTier = plan.boss;
    this.bossSpawned = false;
    this.bossDown = false;
    this.trickleT = 5;
    this.state = 'intro';
    this.t = 1.5;
    this.packT = 0;
    this.heartT = G.hearts < G.maxHearts && (n % 2 === 0 || G.hearts === 1) ? rand(6, 12) : -1;
    showBanner('NIGHT ' + roman(n), plan.sub, 3.4);
  },

  /** Shades still to come or still abroad. */
  remaining() {
    let n = countPrey();
    for (let i = 0; i < this.queue.length; i++) n += this.queue[i] === 'swarm' ? SWARM_SIZE : 1;
    for (let i = 0; i < G.rifts.length; i++) {
      const type = G.rifts[i].type;
      if (type !== 'thorn') n += type === 'swarm' ? SWARM_SIZE : 1;
    }
    return n;
  },

  update(dt) {
    switch (this.state) {
      case 'attract':
        this.packT -= dt;
        if (this.packT <= 0 && countPrey() + G.rifts.length < 6) {
          this.packT = 1.7;
          spawnPack(chance(0.4) ? ['wisp', 'wisp', 'wisp'] : ['wisp', 'wisp']);
        }
        break;

      case 'intro':
        this.t -= dt;
        if (this.t > 0) break;
        this.state = 'spawn';
        this.packT = 0;
        for (let i = 0; i < this.plan.thorns; i++) {
          const p = farPoint(140, 230, false);
          addRift(p.x, p.y, 'thorn', i * 0.25);
        }
        if (this.bossTier) {
          const p = farPoint(150, 330, false);
          addRift(p.x, p.y, 'boss', 0.3);
          this.bossSpawned = true;
        }
        break;

      case 'spawn': {
        const alive = countPrey() + G.rifts.length;

        if (this.heartT > 0) {
          this.heartT -= dt;
          if (this.heartT <= 0) {
            const p = farPoint(120, 210, false);
            addPickup('heart', p.x, p.y);
            hintOnce('heart', 'A heart has drifted in. Encircle it to mend yourself.');
          }
        }

        if (this.bossTier) {
          if (alive === 0) { this.cleared(); break; }
          // a trickle of wisps keeps chains alive while the Eclipse stands
          this.trickleT -= dt;
          if (!this.bossDown && this.trickleT <= 0 && countPrey() < 6) {
            this.trickleT = 6.5;
            spawnPack(['wisp', 'wisp']);
          }
          break;
        }

        if (!this.queue.length) {
          if (alive === 0) this.cleared();
          break;
        }
        this.packT -= dt;
        if (alive === 0 && this.packT > 0.5) this.packT = 0.5;      // never leave the arena empty for long
        if (this.packT <= 0 && alive < this.maxAlive) {
          const n = Math.min(randInt(this.packMin, this.packMax), this.queue.length, this.maxAlive - alive);
          spawnPack(this.queue.splice(0, Math.max(1, n)));
          this.packT = this.interval;
        }
        break;
      }

      case 'clear':
        this.t -= dt;
        if (this.t <= 0) {
          this.state = 'idle';
          openBoons();
        }
        break;
    }
  },

  cleared() {
    this.state = 'clear';
    this.t = 2.2;
    onWaveCleared();
  },
};
