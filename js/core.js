'use strict';
/* ==========================================================================
   STARCOIL — core: tuning, math, geometry, storage, view
   Classic scripts (no modules) so the game runs straight from index.html.
   ========================================================================== */

const TAU = Math.PI * 2;

const FONT_UI = '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Roboto, sans-serif';
const FONT_TITLE = '"Palatino Linotype", Palatino, "Book Antiqua", "URW Palladio L", Georgia, serif';

/* ---- tuning -------------------------------------------------------------- */

const CFG = {
  worldArea: 1000000,      // logical units² — the arena reshapes to the window's aspect
  minAspect: 0.6,
  maxAspect: 2.4,

  serpent: {
    speed: 255,            // units / second
    turnRate: 5.0,         // radians / second  → turn radius = speed / turnRate
    length: 560,           // body length
    headR: 9,
    seg: 6,                // spacing of recorded path samples
    minLoopArc: 110,       // crossings nearer than this (along the body) are ignored
    minLoopArea: 1200,     // empty loops smaller than this get no visual
    regrow: 80,            // length regained per second after the tail is severed
    dashMult: 2.3,
    dashDur: 0.32,
    dashCd: 2.6,
    hitInvuln: 1.8,
  },

  hearts: 3,
  chainWindow: 4.5,        // seconds before an idle chain fades
  maxChainMult: 12,
};

/* ---- math ---------------------------------------------------------------- */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a = 1, b) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a));
const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const randSign = () => (Math.random() < 0.5 ? -1 : 1);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const chance = (p) => Math.random() < p;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

/** Shortest signed rotation that takes angle `from` onto angle `to`. */
function angleDiff(from, to) {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d < -Math.PI) d += TAU;
  return d;
}

/** Frame-rate independent smoothing factor. */
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const smooth = (t) => t * t * (3 - 2 * t);

const rgba = (rgb, a) => 'rgba(' + rgb + ',' + a + ')';
const fmt = (n) => Math.round(n).toLocaleString('en-US');

function roman(n) {
  const map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = '';
  for (const [v, r] of map) while (n >= v) { s += r; n -= v; }
  return s || '0';
}

/* ---- geometry ------------------------------------------------------------ */

/**
 * Segment AB against segment CD. Returns the crossing point or null.
 * Half-open on AB (t in [0,1)) so a crossing that lands exactly on a frame
 * boundary is never reported twice. Parallel / collinear pairs never cross.
 */
function segIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const rx = bx - ax, ry = by - ay;
  const sx = dx - cx, sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (den > -1e-12 && den < 1e-12) return null;
  const qx = cx - ax, qy = cy - ay;
  const t = (qx * sy - qy * sx) / den;
  if (t < 0 || t >= 1) return null;
  const u = (qx * ry - qy * rx) / den;
  if (u < 0 || u > 1) return null;
  return { x: ax + rx * t, y: ay + ry * t };
}

/**
 * Winding number of a closed polygon around a point. Non-zero means inside.
 * (Non-zero rather than even-odd, so a coil wound twice still counts.)
 */
function windingNumber(px, py, poly) {
  let wn = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[i + 1 === n ? 0 : i + 1];
    if (a.y <= py) {
      if (b.y > py && (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y) > 0) wn++;
    } else if (b.y <= py && (b.x - a.x) * (py - a.y) - (px - a.x) * (b.y - a.y) < 0) {
      wn--;
    }
  }
  return wn;
}

function polyArea(poly) {
  let a = 0;
  for (let i = 0, n = poly.length, j = n - 1; i < n; j = i++) {
    a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return a / 2;
}

/** Vertex average — the body is sampled evenly, so this sits near the visual centre. */
function polyCentroid(poly) {
  let x = 0, y = 0;
  for (let i = 0; i < poly.length; i++) { x += poly[i].x; y += poly[i].y; }
  return { x: x / poly.length, y: y / poly.length };
}

function polyBounds(poly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function distToSegSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px, qy = ay + dy * t - py;
  return qx * qx + qy * qy;
}

function distToPolySq(px, py, poly) {
  let best = Infinity;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[i + 1 === n ? 0 : i + 1];
    const d = distToSegSq(px, py, a.x, a.y, b.x, b.y);
    if (d < best) best = d;
  }
  return best;
}

/* ---- persistence --------------------------------------------------------- */

const Store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('starcoil.' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch (err) {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem('starcoil.' + key, JSON.stringify(value)); } catch (err) { /* private mode */ }
  },
};

/* ---- view: canvas sizing and the logical arena --------------------------- */

const View = {
  canvas: null,
  ctx: null,
  cssW: 0, cssH: 0, dpr: 1,
  W: 1333, H: 750,          // logical arena size
  scale: 1, offX: 0, offY: 0,
  safe: { t: 0, r: 0, b: 0, l: 0 },   // how far a phone's notch / system bars reach into the arena (arena units)

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.resize();
  },

  resize() {
    const cssW = Math.max(240, window.innerWidth);
    const cssH = Math.max(240, window.innerHeight);
    const maxPixels = 2560 * 1440;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (cssW * cssH * dpr * dpr > maxPixels) dpr = Math.sqrt(maxPixels / (cssW * cssH));
    this.cssW = cssW; this.cssH = cssH; this.dpr = dpr;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';

    // Constant arena *area*, so balance holds whatever the window shape.
    const aspect = clamp(cssW / cssH, CFG.minAspect, CFG.maxAspect);
    this.W = Math.round(Math.sqrt(CFG.worldArea * aspect));
    this.H = Math.round(this.W / aspect);
    this.scale = Math.min(cssW / this.W, cssH / this.H);
    this.offX = (cssW - this.W * this.scale) / 2;
    this.offY = (cssH - this.H * this.scale) / 2;

    // The canvas runs edge to edge, so the HUD has to step clear of notches and
    // system bars itself. A hidden element padded with the CSS safe-area insets
    // tells us how big they are; zero on ordinary screens.
    const probe = document.getElementById('safe-probe');
    if (probe) {
      const cs = getComputedStyle(probe);
      const px = (v) => parseFloat(v) || 0;
      this.safe.t = Math.max(0, (px(cs.paddingTop) - this.offY) / this.scale);
      this.safe.b = Math.max(0, (px(cs.paddingBottom) - this.offY) / this.scale);
      this.safe.l = Math.max(0, (px(cs.paddingLeft) - this.offX) / this.scale);
      this.safe.r = Math.max(0, (px(cs.paddingRight) - this.offX) / this.scale);
    }
  },

  toWorldX(clientX) { return (clientX - this.offX) / this.scale; },
  toWorldY(clientY) { return (clientY - this.offY) / this.scale; },

  /** Point the context at arena coordinates (optionally shaken). */
  applyWorld(ctx, shakeX, shakeY) {
    const k = this.scale * this.dpr;
    ctx.setTransform(k, 0, 0, k, (this.offX + (shakeX || 0)) * this.dpr, (this.offY + (shakeY || 0)) * this.dpr);
  },
};
