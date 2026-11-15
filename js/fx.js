'use strict';
/* ==========================================================================
   STARCOIL — effects: glow sprites, particles, rings, lightning, floating
   text, and the night sky that fills with the stars you return to it
   ========================================================================== */

/* ---- cached radial glow sprites ----------------------------------------- */

const Glow = {
  cache: new Map(),

  get(rgb) {
    let c = this.cache.get(rgb);
    if (!c) {
      c = document.createElement('canvas');
      c.width = c.height = 128;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, rgba(rgb, 1));
      grad.addColorStop(0.18, rgba(rgb, 0.62));
      grad.addColorStop(0.45, rgba(rgb, 0.2));
      grad.addColorStop(1, rgba(rgb, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      this.cache.set(rgb, c);
    }
    return c;
  },

  /** Draws at the given alpha and leaves globalAlpha at 1. */
  draw(ctx, x, y, r, rgb, alpha) {
    if (alpha <= 0.004 || r <= 0) return;
    ctx.globalAlpha = alpha > 1 ? 1 : alpha;
    ctx.drawImage(this.get(rgb), x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  },
};

/* ---- transient effects --------------------------------------------------- */

const REDUCED_MOTION = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

const FX = {
  parts: [],
  rings: [],
  bolts: [],
  floaters: [],
  shake: 0,
  flashA: 0,
  flashCol: '255,60,90',
  MAX_PARTS: 1100,

  clear() {
    this.parts.length = 0;
    this.rings.length = 0;
    this.bolts.length = 0;
    this.floaters.length = 0;
    this.shake = 0;
    this.flashA = 0;
  },

  /** kind: 0 = square mote, 1 = soft glow, 2 = streak along its velocity */
  spark(x, y, vx, vy, life, size, rgb, kind, drag) {
    if (this.parts.length >= this.MAX_PARTS) return;
    this.parts.push({ x, y, vx, vy, life, max: life, size, rgb, kind: kind || 0, drag: drag === undefined ? 2.2 : drag });
  },

  burst(x, y, rgb, n, speed, life, size, kind) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = speed * (0.25 + Math.random() * 0.75);
      this.spark(x, y, Math.cos(a) * v, Math.sin(a) * v,
        life * (0.5 + Math.random() * 0.5), size * (0.6 + Math.random() * 0.8), rgb, kind);
    }
  },

  ring(x, y, r0, r1, dur, rgb, width) {
    this.rings.push({ x, y, r0, r1, t: 0, dur, rgb, width: width || 3 });
  },

  bolt(x1, y1, x2, y2, rgb) {
    const d = Math.hypot(x2 - x1, y2 - y1) || 1;
    const n = Math.max(3, Math.floor(d / 26));
    const nx = -(y2 - y1) / d, ny = (x2 - x1) / d;
    const pts = [{ x: x1, y: y1 }];
    for (let i = 1; i < n; i++) {
      const k = i / n;
      const j = (Math.random() * 2 - 1) * 18 * Math.sin(k * Math.PI);
      pts.push({ x: lerp(x1, x2, k) + nx * j, y: lerp(y1, y2, k) + ny * j });
    }
    pts.push({ x: x2, y: y2 });
    this.bolts.push({ pts, t: 0, dur: 0.3, rgb: rgb || '190,225,255' });
  },

  text(x, y, str, size, rgb, dur, rise) {
    this.floaters.push({
      x: clamp(x, 70, View.W - 70), y: clamp(y, 40, View.H - 30),
      str, size, rgb: rgb || '255,255,255', t: 0, dur: dur || 1.1, rise: rise === undefined ? 34 : rise,
    });
  },

  // Screen shake and full-screen flashes are toned right down for people who ask for less motion.
  addShake(v) { this.shake = Math.min(22, Math.max(this.shake, REDUCED_MOTION ? v * 0.25 : v)); },
  flash(rgb, a) { this.flashCol = rgb; this.flashA = Math.max(this.flashA, REDUCED_MOTION ? a * 0.4 : a); },

  update(dt) {
    const ps = this.parts;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) { ps[i] = ps[ps.length - 1]; ps.pop(); continue; }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy *= k;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      if (r.t >= r.dur) this.rings.splice(i, 1);
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      if (b.t >= b.dur) this.bolts.splice(i, 1);
    }
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      if (f.t >= f.dur) this.floaters.splice(i, 1);
    }
  },

  drawParticles(ctx) {
    const ps = this.parts;
    if (!ps.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    let lastRgb = '';
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const k = p.life / p.max;
      if (p.kind === 1) {
        Glow.draw(ctx, p.x, p.y, p.size * (1.4 + 1.6 * k), p.rgb, k);
        continue;
      }
      if (p.rgb !== lastRgb) {
        lastRgb = p.rgb;
        ctx.fillStyle = ctx.strokeStyle = 'rgb(' + p.rgb + ')';
      }
      ctx.globalAlpha = k > 0.5 ? 1 : k * 2;
      const s = p.size * (0.4 + 0.6 * k);
      if (p.kind === 2) {
        ctx.lineWidth = s;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045);
        ctx.stroke();
      } else {
        ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
    }
    ctx.restore();
  },

  drawRings(ctx) {
    if (!this.rings.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      const k = r.t / r.dur;
      ctx.strokeStyle = rgba(r.rgb, (1 - k) * 0.9);
      ctx.lineWidth = r.width * (1 - k * 0.6);
      ctx.beginPath();
      ctx.arc(r.x, r.y, lerp(r.r0, r.r1, easeOutCubic(k)), 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  },

  drawBolts(ctx) {
    if (!this.bolts.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let i = 0; i < this.bolts.length; i++) {
      const b = this.bolts[i];
      const a = 1 - b.t / b.dur;
      ctx.beginPath();
      ctx.moveTo(b.pts[0].x, b.pts[0].y);
      for (let j = 1; j < b.pts.length; j++) ctx.lineTo(b.pts[j].x, b.pts[j].y);
      ctx.strokeStyle = rgba(b.rgb, a * 0.35);
      ctx.lineWidth = 9;
      ctx.stroke();
      ctx.strokeStyle = rgba('255,255,255', a);
      ctx.lineWidth = 2.2;
      ctx.stroke();
    }
    ctx.restore();
  },

  drawFloaters(ctx) {
    if (!this.floaters.length) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (let i = 0; i < this.floaters.length; i++) {
      const f = this.floaters[i];
      const k = f.t / f.dur;
      const a = k < 0.12 ? k / 0.12 : k > 0.65 ? (1 - k) / 0.35 : 1;
      const sc = k < 0.12 ? lerp(0.6, 1.14, k / 0.12) : k < 0.26 ? lerp(1.14, 1, (k - 0.12) / 0.14) : 1;
      const y = f.y - f.rise * easeOutCubic(k);
      ctx.font = '700 ' + (f.size * sc).toFixed(1) + 'px ' + FONT_UI;
      ctx.globalAlpha = a;
      ctx.lineWidth = Math.max(3, f.size * 0.2);
      ctx.strokeStyle = 'rgba(6,8,28,0.85)';
      ctx.strokeText(f.str, f.x, y);
      ctx.fillStyle = 'rgb(' + f.rgb + ')';
      ctx.fillText(f.str, f.x, y);
    }
    ctx.restore();
  },
};

/* ---- the sky ------------------------------------------------------------- */

const Sky = {
  REALMS: [
    { top: '#070a24', mid: '#0f1140', bot: '#1c1248', neb: [[232, 0.16], [268, 0.14], [200, 0.10]] },   // indigo vigil
    { top: '#031520', mid: '#06283a', bot: '#0b3344', neb: [[178, 0.15], [205, 0.13], [150, 0.09]] },   // tidal deep
    { top: '#160818', mid: '#2c0d26', bot: '#3d1424', neb: [[338, 0.15], [18, 0.12], [290, 0.10]] },    // ember dusk
    { top: '#04161a', mid: '#082a2a', bot: '#0d2440', neb: [[150, 0.14], [185, 0.12], [255, 0.11]] },   // aurora reach
  ],
  realm: 0,
  bg: null,
  prev: null,
  fade: 1,
  stars: [],        // ambient
  earned: [],       // one for every shade banished
  lines: [],        // constellations left by big coils
  blobs: [],

  init() {
    for (let i = 0; i < 150; i++) {
      this.stars.push({
        x: Math.random(), y: Math.random(),
        s: 0.7 + Math.pow(Math.random(), 3) * 1.9,
        ph: rand(TAU), sp: 0.4 + Math.random() * 1.6,
        a: 0.25 + Math.random() * 0.55,
      });
    }
    for (let i = 0; i < 9; i++) {
      this.blobs.push({ x: Math.random(), y: Math.random(), r: 0.22 + Math.random() * 0.3, h: i % 3 });
    }
    this.render();
  },

  reset() {
    this.earned.length = 0;
    this.lines.length = 0;
    this.setRealm(0);
  },

  setRealm(i) {
    const n = this.REALMS.length;
    i = ((i % n) + n) % n;
    if (i === this.realm) return;
    this.prev = this.bg;
    this.realm = i;
    this.render();
    this.fade = 0;
  },

  /** Paint the gradient + nebulae once, at half resolution (it is all soft anyway). */
  render() {
    const c = document.createElement('canvas');
    c.width = Math.max(2, Math.ceil(View.canvas.width / 2));
    c.height = Math.max(2, Math.ceil(View.canvas.height / 2));
    const g = c.getContext('2d');
    const R = this.REALMS[this.realm];
    const grad = g.createLinearGradient(0, 0, 0, c.height);
    grad.addColorStop(0, R.top);
    grad.addColorStop(0.55, R.mid);
    grad.addColorStop(1, R.bot);
    g.fillStyle = grad;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'lighter';
    const m = Math.max(c.width, c.height);
    for (const b of this.blobs) {
      const h = R.neb[b.h][0], a = R.neb[b.h][1];
      const x = b.x * c.width, y = b.y * c.height, r = b.r * m;
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, 'hsla(' + h + ',75%,55%,' + a + ')');
      rg.addColorStop(0.5, 'hsla(' + h + ',75%,45%,' + a * 0.4 + ')');
      rg.addColorStop(1, 'hsla(' + h + ',75%,40%,0)');
      g.fillStyle = rg;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    this.bg = c;
  },

  /** A new star where a shade was banished. `delay` lets it appear as the shade pops. */
  addStar(x, y, delay) {
    const s = {
      x: x / View.W, y: y / View.H,
      s: 1.5 + Math.random() * 1.3,
      ph: rand(TAU), sp: 0.8 + Math.random() * 1.8,
      born: G.time + (delay || 0),
    };
    this.earned.push(s);
    if (this.earned.length > 700) this.earned.shift();
    return s;
  },

  addConstellation(stars) {
    if (stars.length < 3) return;
    let born = 0;
    for (const s of stars) born = Math.max(born, s.born);
    this.lines.push({ stars, born });
    if (this.lines.length > 70) this.lines.shift();
  },

  draw(ctx, t, dtReal) {
    const cw = View.canvas.width, ch = View.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (this.fade < 1 && this.prev) {
      this.fade = Math.min(1, this.fade + dtReal / 2.4);
      ctx.drawImage(this.prev, 0, 0, cw, ch);
      ctx.globalAlpha = smooth(this.fade);
      ctx.drawImage(this.bg, 0, 0, cw, ch);
      ctx.globalAlpha = 1;
      if (this.fade >= 1) this.prev = null;
    } else {
      ctx.drawImage(this.bg, 0, 0, cw, ch);
    }

    View.applyWorld(ctx);
    const W = View.W, H = View.H;

    ctx.fillStyle = '#dfe8ff';
    for (let i = 0; i < this.stars.length; i++) {
      const s = this.stars[i];
      ctx.globalAlpha = s.a * (0.55 + 0.45 * Math.sin(t * s.sp + s.ph));
      ctx.fillRect(s.x * W - s.s / 2, s.y * H - s.s / 2, s.s, s.s);
    }

    // constellations
    if (this.lines.length) {
      ctx.strokeStyle = '#ffe7b0';
      ctx.lineWidth = 1;
      ctx.lineJoin = 'round';
      for (let i = 0; i < this.lines.length; i++) {
        const L = this.lines[i];
        const age = G.time - L.born;
        if (age < 0) continue;
        ctx.globalAlpha = 0.2 * Math.min(1, age / 1.2);
        ctx.beginPath();
        ctx.moveTo(L.stars[0].x * W, L.stars[0].y * H);
        for (let j = 1; j < L.stars.length; j++) ctx.lineTo(L.stars[j].x * W, L.stars[j].y * H);
        ctx.stroke();
      }
    }

    // earned stars: little four-point glints
    ctx.fillStyle = '#fff1cf';
    for (let i = 0; i < this.earned.length; i++) {
      const e = this.earned[i];
      const age = G.time - e.born;
      if (age < 0) continue;
      const pop = age < 0.45 ? easeOutBack(age / 0.45) : 1;
      const s = e.s * pop * (1 + (age < 1 ? (1 - age) * 1.2 : 0));
      const x = e.x * W, y = e.y * H;
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * e.sp + e.ph);
      ctx.beginPath();
      ctx.moveTo(x, y - s * 1.5);
      ctx.lineTo(x + s * 0.5, y);
      ctx.lineTo(x, y + s * 1.5);
      ctx.lineTo(x - s * 0.5, y);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(x - s * 1.3, y - 0.4, s * 2.6, 0.8);
    }
    ctx.globalAlpha = 1;
  },
};
