'use strict';
/* ==========================================================================
   STARCOIL — the serpent: steering, body path, coil detection, drawing
   ========================================================================== */

class Serpent {
  constructor(x, y, heading) {
    const c = CFG.serpent;
    this.x = x; this.y = y;
    this.px = x; this.py = y;            // head position on the previous step
    this.heading = heading;
    this.speed = c.speed;
    this.turnRate = c.turnRate;
    this.maxLen = c.length;
    this.curLen = c.length;
    this.regrowMult = 1;

    // The body is simply the path the head has travelled: samples oldest → newest.
    this.pts = [{ x, y }];
    this.storedLen = 0;                  // length of the sampled polyline
    this.travel = 0;                     // total distance ever travelled

    this.dashT = 0;
    this.dashCd = 0;
    this.dashCdMax = c.dashCd;
    this.justDashed = false;
    this.readyFlash = 0;
    this.invuln = 0;                     // after being hurt (visible flicker)
    this.grace = 0;                      // after a dash ends (invisible)
    this.alive = true;

    this.turn = 0;                       // smoothed steering, for the head lean
    this.tongue = 0;
    this.tongueWait = rand(1.5, 3.5);
    this.ghosts = [];
    this._nb = { idx: 0, x: 0, y: 0, d2: 0 };
  }

  get dashing() { return this.dashT > 0; }
  get vulnerable() { return this.invuln <= 0 && this.dashT <= 0 && this.grace <= 0; }

  totalLen() {
    const l = this.pts[this.pts.length - 1];
    return this.storedLen + Math.hypot(this.x - l.x, this.y - l.y);
  }

  /**
   * Advance one step. `ctrl` is { mode:'pointer', tx, ty } or { mode:'keys', hasDir, dir },
   * plus `dash`. Returns a closed coil { poly, area } on the step the head crosses the body.
   */
  update(dt, ctrl) {
    const c = CFG.serpent;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.grace > 0) this.grace -= dt;
    if (this.readyFlash > 0) this.readyFlash -= dt;
    if (this.dashCd > 0) {
      this.dashCd -= dt;
      if (this.dashCd <= 0) this.readyFlash = 0.35;
    }
    this.justDashed = false;
    if (ctrl.dash && this.dashCd <= 0 && this.dashT <= 0) {
      this.dashT = c.dashDur;
      this.dashCd = this.dashCdMax;
      this.justDashed = true;
    }

    // --- steering: turn toward the goal, limited by the turn rate
    let want = 0;
    if (ctrl.mode === 'keys') {
      if (ctrl.hasDir) want = clamp(angleDiff(this.heading, ctrl.dir) * 14, -this.turnRate, this.turnRate);
    } else {
      const dx = ctrl.tx - this.x, dy = ctrl.ty - this.y;
      if (dx * dx + dy * dy > 144) {
        want = clamp(angleDiff(this.heading, Math.atan2(dy, dx)) * 14, -this.turnRate, this.turnRate);
      }
    }
    this.heading += want * dt;
    if (this.heading > Math.PI) this.heading -= TAU;
    else if (this.heading < -Math.PI) this.heading += TAU;
    this.turn += (want / this.turnRate - this.turn) * damp(10, dt);

    // --- move
    const dashing = this.dashT > 0;
    const sp = this.speed * (dashing ? c.dashMult : 1);
    this.px = this.x; this.py = this.y;
    this.x += Math.cos(this.heading) * sp * dt;
    this.y += Math.sin(this.heading) * sp * dt;
    this.collideWalls();
    this.travel += Math.hypot(this.x - this.px, this.y - this.py);

    if (dashing) {
      this.dashT -= dt;
      this.ghosts.push({ x: this.x, y: this.y, a: this.heading, life: 0.26 });
      if (this.dashT <= 0) this.grace = 0.22;
    }
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      this.ghosts[i].life -= dt;
      if (this.ghosts[i].life <= 0) this.ghosts.splice(i, 1);
    }

    if (this.tongue > 0) this.tongue -= dt;
    else {
      this.tongueWait -= dt;
      if (this.tongueWait <= 0) { this.tongue = 0.3; this.tongueWait = rand(2, 4.5); }
    }

    const loop = this.detectLoop();

    // --- lay down the path, then let the tail catch up
    const last = this.pts[this.pts.length - 1];
    const d = Math.hypot(this.x - last.x, this.y - last.y);
    if (d >= c.seg) {
      this.pts.push({ x: this.x, y: this.y });
      this.storedLen += d;
    }
    if (this.curLen < this.maxLen) {
      this.curLen = Math.min(this.maxLen, this.curLen + c.regrow * this.regrowMult * dt);
    }
    this.trim();
    return loop;
  }

  /** Slide along the arena edge instead of leaving it. */
  collideWalls() {
    const m = 10, W = View.W, H = View.H;
    const cos = Math.cos(this.heading), sin = Math.sin(this.heading);
    if (this.x < m) {
      this.x = m;
      if (cos < 0) this.heading = sin >= 0 ? Math.PI / 2 : -Math.PI / 2;
    } else if (this.x > W - m) {
      this.x = W - m;
      if (cos > 0) this.heading = sin >= 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    if (this.y < m) {
      this.y = m;
      if (Math.sin(this.heading) < 0) this.heading = Math.cos(this.heading) >= 0 ? 0 : Math.PI;
    } else if (this.y > H - m) {
      this.y = H - m;
      if (Math.sin(this.heading) > 0) this.heading = Math.cos(this.heading) >= 0 ? 0 : Math.PI;
    }
  }

  /**
   * Did this step's head movement cross the body? If so the body between the
   * crossing and the head is a closed coil. When several strands are crossed
   * at once the oldest wins — its coil contains the others.
   */
  detectLoop() {
    const pts = this.pts, n = pts.length;
    if (n < 6) return null;
    const ax = this.px, ay = this.py, bx = this.x, by = this.y;
    if (ax === bx && ay === by) return null;
    const minArc = CFG.serpent.minLoopArc;

    let arc = Math.hypot(ax - pts[n - 1].x, ay - pts[n - 1].y);
    let hit = null, hitIdx = -1;
    for (let i = n - 2; i >= 0; i--) {
      const p = pts[i], q = pts[i + 1];
      if (arc >= minArc) {
        const h = segIntersect(ax, ay, bx, by, p.x, p.y, q.x, q.y);
        if (h) { hit = h; hitIdx = i; }
      }
      arc += Math.hypot(q.x - p.x, q.y - p.y);
    }
    if (!hit) return null;

    const poly = [hit];
    for (let i = hitIdx + 1; i < n; i++) poly.push({ x: pts[i].x, y: pts[i].y });
    poly.push({ x: ax, y: ay });
    return { poly, area: Math.abs(polyArea(poly)) };
  }

  /** Drop path older than the current body length (the last segment shrinks smoothly). */
  trim() {
    const pts = this.pts;
    const last = pts[pts.length - 1];
    let excess = this.storedLen + Math.hypot(this.x - last.x, this.y - last.y) - this.curLen;
    while (excess > 0.01 && pts.length > 1) {
      const a = pts[0], b = pts[1];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d <= excess) {
        pts.shift();
        this.storedLen -= d;
        excess -= d;
      } else {
        const k = excess / d;
        a.x += (b.x - a.x) * k;
        a.y += (b.y - a.y) * k;
        this.storedLen -= excess;
        excess = 0;
      }
    }
  }

  recalcLen() {
    let s = 0;
    const pts = this.pts;
    for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    this.storedLen = s;
  }

  /** Nearest body sample at least `minArc` behind the head (shared result object). */
  nearestBody(x, y, minArc) {
    const pts = this.pts;
    let lx = this.x, ly = this.y, arc = 0, best = -1, bd = Infinity;
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      arc += Math.hypot(p.x - lx, p.y - ly);
      lx = p.x; ly = p.y;
      if (arc < minArc) continue;
      const dx = p.x - x, dy = p.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = i; }
    }
    if (best < 0) return null;
    const r = this._nb;
    r.idx = best; r.x = pts[best].x; r.y = pts[best].y; r.d2 = bd;
    return r;
  }

  /** Sever the tail: everything older than sample `idx` falls away. Returns the lost points. */
  cutAt(idx) {
    idx = Math.min(idx, this.pts.length - 2);
    if (idx <= 0) return [];
    const lost = this.pts.splice(0, idx);
    this.recalcLen();
    this.curLen = Math.max(40, this.totalLen());
    return lost;
  }

  /**
   * The least body that can still close a coil (a full turn at the tightest
   * radius, with some slack). The tail is never severed shorter than this,
   * so losing it can hurt but can never leave the serpent unable to fight.
   */
  safeLen() {
    return TAU * (this.speed / this.turnRate) * 1.35;
  }

  /** Index of the first sample, walking back from the head, at least `arc` along the body (or -1). */
  indexAtArc(arc) {
    const pts = this.pts;
    let lx = this.x, ly = this.y, s = 0;
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      s += Math.hypot(p.x - lx, p.y - ly);
      lx = p.x; ly = p.y;
      if (s >= arc) return i;
    }
    return -1;
  }

  /** Sever the tail so about `len` of body remains — but never less than the safe length. */
  cutToLength(len) {
    const idx = this.indexAtArc(Math.max(len, this.safeLen()));
    return idx > 0 ? this.cutAt(idx) : [];
  }

  /* ---- drawing ----------------------------------------------------------- */

  /** Gather the body head → tail with arc lengths, plus a gentle slither offset. */
  buildChain(time) {
    const B = Serpent.buf, pts = this.pts;
    let k = 1, s = 0, lx = this.x, ly = this.y;
    B.x[0] = lx; B.y[0] = ly; B.s[0] = 0;
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      const d = Math.hypot(p.x - lx, p.y - ly);
      if (d < 0.5) continue;
      s += d;
      B.x[k] = p.x; B.y[k] = p.y; B.s[k] = s;
      k++; lx = p.x; ly = p.y;
    }
    B.n = k; B.total = s;
    for (let j = 0; j < k; j++) {
      const a = j > 0 ? j - 1 : j, b = j < k - 1 ? j + 1 : j;
      let tx = B.x[a] - B.x[b], ty = B.y[a] - B.y[b];
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;
      // The wave is pinned to the ground (as a real snake's is) and drifts only slowly.
      const off = Math.min(1, B.s[j] / 70) * 2.2 * Math.sin((this.travel - B.s[j]) * 0.05 + time * 2);
      B.ox[j] = B.x[j] - ty * off;
      B.oy[j] = B.y[j] + tx * off;
    }
    return B;
  }

  drawBody(ctx, time) {
    const B = this.buildChain(time);
    const n = B.n;
    if (n < 2) return;
    const total = B.total || 1;
    const dash = this.dashT > 0;
    const alpha = this.invuln > 0 && this.alive ? 0.55 + 0.35 * Math.sin(time * 34) : 1;

    // soft glow: one path, so overlaps never double up
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(B.ox[0], B.oy[0]);
    for (let j = 1; j < n; j++) ctx.lineTo(B.ox[j], B.oy[j]);
    ctx.strokeStyle = rgba(dash ? '150,220,255' : '70,130,255', (dash ? 0.2 : 0.13) * alpha);
    ctx.lineWidth = 30;
    ctx.stroke();
    ctx.strokeStyle = rgba('90,170,255', 0.2 * alpha);
    ctx.lineWidth = 18;
    ctx.stroke();
    ctx.restore();

    // tapered core, tail first so the head end sits on top
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    for (let j = n - 1; j >= 1; j--) {
      const u = B.s[j] / total;                                   // 0 at the head, 1 at the tail
      const band = 0.84 + 0.16 * Math.cos(B.s[j] * 0.2);          // scale banding
      let r, g, b;
      if (u < 0.5) {
        const k = u * 2;
        r = lerp(150, 86, k); g = lerp(246, 150, k); b = 255;
      } else {
        const k = (u - 0.5) * 2;
        r = lerp(86, 176, k); g = lerp(150, 98, k); b = lerp(255, 250, k);
      }
      ctx.strokeStyle = 'rgb(' + ((r * band) | 0) + ',' + ((g * band) | 0) + ',' + ((b * band) | 0) + ')';
      ctx.lineWidth = 2 * (2.1 + 5.9 * Math.pow(1 - u, 0.75));
      ctx.beginPath();
      ctx.moveTo(B.ox[j], B.oy[j]);
      ctx.lineTo(B.ox[j - 1], B.oy[j - 1]);
      ctx.stroke();
    }
    // spine highlight
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(B.ox[0], B.oy[0]);
    for (let j = 1; j < n; j++) ctx.lineTo(B.ox[j], B.oy[j]);
    ctx.strokeStyle = 'rgba(235,250,255,0.5)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.restore();
  }

  drawHead(ctx, time) {
    if (!this.alive) return;
    const dash = this.dashT > 0;
    const alpha = this.invuln > 0 ? 0.55 + 0.35 * Math.sin(time * 34) : 1;

    // dash afterimages
    for (let i = 0; i < this.ghosts.length; i++) {
      const g = this.ghosts[i];
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(g.a);
      ctx.globalAlpha = (g.life / 0.26) * 0.3;
      Serpent.skullPath(ctx);
      ctx.fillStyle = '#9fe6ff';
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    Glow.draw(ctx, this.x, this.y, dash ? 50 : 34, '120,220,255', (dash ? 0.9 : 0.55) * alpha);
    ctx.restore();

    // dash recharge ring
    if (this.dashCd > 0) {
      const k = 1 - this.dashCd / this.dashCdMax;
      ctx.save();
      ctx.strokeStyle = 'rgba(160,220,255,0.55)';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(this.x, this.y, 21, -Math.PI / 2, -Math.PI / 2 + TAU * k);
      ctx.stroke();
      ctx.restore();
    } else if (this.readyFlash > 0) {
      const k = this.readyFlash / 0.35;
      ctx.save();
      ctx.strokeStyle = rgba('200,240,255', k * 0.8);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 21 + (1 - k) * 10, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.heading + this.turn * 0.22);
    ctx.globalAlpha = alpha;

    // swept-back horns
    ctx.strokeStyle = '#bdefff';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-3, -6.5);
    ctx.quadraticCurveTo(-12, -10.5, -18, -7 - this.turn * 3);
    ctx.moveTo(-3, 6.5);
    ctx.quadraticCurveTo(-12, 10.5, -18, 7 - this.turn * 3);
    ctx.stroke();

    // forked tongue
    if (this.tongue > 0) {
      const k = Math.sin((this.tongue / 0.3) * Math.PI);
      ctx.strokeStyle = '#ff7aa8';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(13, 0);
      ctx.lineTo(13 + 9 * k, 0);
      ctx.lineTo(13 + 13 * k, -3 * k);
      ctx.moveTo(13 + 9 * k, 0);
      ctx.lineTo(13 + 13 * k, 3 * k);
      ctx.stroke();
    }

    Serpent.skullPath(ctx);
    ctx.fillStyle = dash ? '#ffffff' : '#e9fbff';
    ctx.fill();
    ctx.strokeStyle = '#7fd8ff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // eyes
    for (let side = -1; side <= 1; side += 2) {
      ctx.fillStyle = '#0b1640';
      ctx.beginPath();
      ctx.ellipse(4.2, side * 4.6, 2.9, 1.8, side * 0.4, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#ffe9a8';
      ctx.beginPath();
      ctx.arc(5.1, side * 4.4, 0.8, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  static skullPath(ctx) {
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.bezierCurveTo(11, -8, 0, -10.5, -8, -7.5);
    ctx.quadraticCurveTo(-11.5, 0, -8, 7.5);
    ctx.bezierCurveTo(0, 10.5, 11, 8, 15, 0);
    ctx.closePath();
  }
}

Serpent.buf = { x: [], y: [], s: [], ox: [], oy: [], n: 0, total: 0 };
