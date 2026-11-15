'use strict';
/* ==========================================================================
   STARCOIL — interface: the DOM screens (title, boons, pause, game over),
   toasts, and the HUD + banners drawn on the canvas
   ========================================================================== */

const UI = {
  el: {},
  current: 'title',
  boonChoices: null,
  boonCb: null,
  boonOpenAt: 0,
  toastTimer: 0,
  touch: false,              // true on touch screens, where hints mention fingers instead of the mouse

  init() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      title: $('screen-title'), boon: $('screen-boon'), pause: $('screen-pause'), over: $('screen-over'),
      cards: $('boon-cards'), boonKicker: $('boon-kicker'),
      toast: $('toast'), titleBest: $('title-best'),
      overKicker: $('over-kicker'), overTitle: $('over-title'), overScore: $('over-score'),
      overBest: $('over-best'), overStats: $('over-stats'),
      pauseBoons: $('pause-boons'), mute: $('btn-mute'),
    };

    $('btn-start').addEventListener('click', () => { Snd.init(); newRun(); });
    $('btn-resume').addEventListener('click', () => resumeGame());
    $('btn-restart').addEventListener('click', () => newRun());
    $('btn-quit').addEventListener('click', () => toTitle());
    $('btn-again').addEventListener('click', () => { Snd.init(); newRun(); });
    $('btn-title').addEventListener('click', () => toTitle());
    $('btn-mute').addEventListener('click', (ev) => {
      Snd.init();
      Snd.toggleMute();
      this.syncMute();
      ev.currentTarget.blur();
    });
    $('btn-full').addEventListener('click', (ev) => { toggleFullscreen(); ev.currentTarget.blur(); });
    $('btn-pause').addEventListener('click', (ev) => { togglePause(); ev.currentTarget.blur(); });
    this.el.cards.addEventListener('click', (ev) => {
      const card = ev.target.closest('.card');
      if (card) this.pickBoon(+card.dataset.i);
    });
    this.syncMute();

    // On a touch screen the dash is a second finger, so say so.
    this.touch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    if (this.touch) {
      $('howto-dash').textContent = 'Tap with a second finger for a burst of speed. Nothing can hurt you mid-dash.';
    }
  },

  /** Show one screen, or none (null) while playing. */
  show(name) {
    this.current = name;
    for (const key of ['title', 'boon', 'pause', 'over']) {
      this.el[key].classList.toggle('show', key === name);
    }
    document.body.classList.toggle('playing', !name);
    document.body.dataset.screen = name || 'play';      // lets the stylesheet show/hide the corner buttons
  },

  showTitle() {
    this.el.titleBest.textContent = G.best > 0
      ? 'Best  ' + fmt(G.best) + '  ·  reached Night ' + roman(Math.max(1, G.bestWave))
      : '';
    this.show('title');
  },

  showBoons(choices, kicker, cb) {
    this.boonChoices = choices;
    this.boonCb = cb;
    this.boonOpenAt = performance.now();
    this.el.boonKicker.textContent = kicker;
    this.el.cards.innerHTML = choices.map((b, i) => {
      const lvl = boonLevel(b.id);
      let pips;
      if (b.max === 1) pips = '<div class="pips word">Unique</div>';
      else if (b.max > 10) pips = '<div class="pips word">Restores</div>';
      else {
        pips = '<div class="pips">';
        for (let k = 0; k < b.max; k++) pips += '<i class="' + (k < lvl ? 'on' : k === lvl ? 'next' : '') + '"></i>';
        pips += '</div>';
      }
      return '<button class="card" data-i="' + i + '" style="animation-delay:' + i * 80 + 'ms">' +
        '<span class="key">' + (i + 1) + '</span>' + boonIcon(b) +
        '<h3>' + b.name + '</h3>' + pips + '<p>' + b.desc + '</p></button>';
    }).join('');
    this.show('boon');
  },

  pickBoon(i, force) {
    if (this.current !== 'boon' || !this.boonCb) return;
    // a click meant as a dash should not choose a boon the instant the screen opens
    if (!force && performance.now() - this.boonOpenAt < 450) return;
    const b = this.boonChoices[i];
    if (!b) return;
    const cb = this.boonCb;
    this.boonCb = null;
    cb(b);
  },

  showPause() {
    const have = BOONS.filter((b) => boonLevel(b.id) > 0);
    this.el.pauseBoons.innerHTML = have.length
      ? have.map((b) => '<span class="chip">' + boonIcon(b) + b.name +
          (b.max > 1 && b.max < 10 ? ' <b>' + roman(boonLevel(b.id)) + '</b>' : '') + '</span>').join('')
      : '<span class="chip dim">No boons yet — survive a night to earn one</span>';
    this.show('pause');
  },

  showOver(info) {
    this.el.overKicker.textContent = info.newBest ? 'A new best — the coil unwinds' : 'The coil unwinds';
    this.el.overTitle.textContent = 'Night ' + roman(info.wave);
    this.el.overScore.textContent = fmt(info.score);
    this.el.overBest.textContent = info.newBest ? 'New best score' : 'Best  ' + fmt(info.best);
    this.el.overBest.classList.toggle('gold', info.newBest);
    const mins = Math.floor(info.time / 60), secs = Math.floor(info.time % 60);
    const rows = [
      ['Stars returned to the sky', fmt(info.banished)],
      ['Coils closed', fmt(info.coils)],
      ['Largest coil', info.bestCoil ? info.bestCoil + (info.bestCoil === 1 ? ' shade' : ' shades') : '—'],
      ['Longest chain', info.bestChain ? '×' + info.bestChain : '—'],
      ['Time', mins + ':' + (secs < 10 ? '0' : '') + secs],
    ];
    this.el.overStats.innerHTML = rows.map((r) => '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>').join('');
    this.show('over');
  },

  toast(text, seconds) {
    const el = this.el.toast;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), (seconds || 5) * 1000);
  },

  hideToast() {
    clearTimeout(this.toastTimer);
    this.el.toast.classList.remove('show');
  },

  syncMute() {
    this.el.mute.classList.toggle('off', Snd.muted);
    this.el.mute.setAttribute('aria-pressed', Snd.muted ? 'true' : 'false');
  },
};

/* ---- canvas text helpers ------------------------------------------------- */

function setSpacing(ctx, px) {
  if ('letterSpacing' in ctx) ctx.letterSpacing = px + 'px';
}

function showBanner(title, sub, dur) {
  G.banner = { title, sub: sub || '', t: 0, dur: dur || 3 };
}

function drawBanner(ctx, dt) {
  const b = G.banner;
  if (!b) return;
  if (G.state === 'playing' || G.state === 'over') b.t += dt;
  if (b.t >= b.dur) { G.banner = null; return; }
  const a = b.t < 0.4 ? b.t / 0.4 : b.t > b.dur - 0.7 ? (b.dur - b.t) / 0.7 : 1;
  const k = Math.min(1, View.W / 1150);
  const rise = (1 - easeOutCubic(Math.min(1, b.t / 0.6))) * 14;
  const y = View.H * 0.3 + rise;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.globalAlpha = clamp(a, 0, 1);
  ctx.font = '400 ' + Math.round(60 * k) + 'px ' + FONT_TITLE;
  setSpacing(ctx, 12 * k);
  ctx.shadowColor = 'rgba(140,190,255,0.85)';
  ctx.shadowBlur = 26;
  ctx.fillStyle = '#fff6dc';
  ctx.fillText(b.title, View.W / 2, y);
  ctx.shadowBlur = 0;
  if (b.sub) {
    ctx.font = '400 ' + Math.round(17 * k + 3) + 'px ' + FONT_UI;
    setSpacing(ctx, 1.5);
    ctx.fillStyle = 'rgba(214,226,255,0.92)';
    ctx.fillText(b.sub, View.W / 2, y + 36 * k + 8);
  }
  ctx.restore();
}

function findBoss() {
  for (let i = 0; i < G.enemies.length; i++) {
    const e = G.enemies[i];
    if (e.boss && !e.dead) return e;
  }
  return null;
}

/* ---- HUD ----------------------------------------------------------------- */

const HUD = {
  scoreShown: 0,
  heartShake: 0,
  chainPop: 0,
  lastChain: 0,

  reset() {
    this.scoreShown = 0;
    this.heartShake = 0;
    this.chainPop = 0;
    this.lastChain = 0;
  },

  draw(ctx, t, dt) {
    if (G.attract) return;
    const W = View.W, H = View.H;
    const sf = View.safe;               // keep clear of notches and system bars
    const top = sf.t;

    this.scoreShown += (G.score - this.scoreShown) * Math.min(1, dt * 10);
    if (Math.abs(G.score - this.scoreShown) < 1) this.scoreShown = G.score;
    if (this.heartShake > 0) this.heartShake -= dt;
    if (G.chain !== this.lastChain) {
      if (G.chain > this.lastChain) this.chainPop = 1;
      this.lastChain = G.chain;
    }
    if (this.chainPop > 0) this.chainPop = Math.max(0, this.chainPop - dt * 4);

    ctx.save();
    ctx.textBaseline = 'alphabetic';

    // hearts
    const shake = this.heartShake > 0 ? this.heartShake * 6 : 0;
    for (let i = 0; i < G.maxHearts; i++) {
      const full = i < G.hearts;
      const x = 36 + sf.l + i * 30 + (shake ? rand(-shake, shake) : 0);
      const y = 38 + top + (shake ? rand(-shake, shake) : 0);
      const beat = G.hearts === 1 && full ? 1 + 0.14 * Math.sin(t * 9) : 1;
      heartPath(ctx, x, y, 11 * beat);
      if (full) {
        ctx.fillStyle = '#ff6f9c';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,220,232,0.9)';
      } else {
        ctx.fillStyle = 'rgba(255,111,156,0.1)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,170,195,0.4)';
      }
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // score
    ctx.textAlign = 'right';
    ctx.fillStyle = '#f4f8ff';
    ctx.font = '600 30px ' + FONT_UI;
    setSpacing(ctx, 0.5);
    ctx.fillText(fmt(this.scoreShown), W - 28 - sf.r, 46 + top);
    ctx.font = '500 12px ' + FONT_UI;
    setSpacing(ctx, 1.5);
    ctx.fillStyle = 'rgba(210,222,255,0.6)';
    ctx.fillText('BEST ' + fmt(Math.max(G.best, G.score)), W - 28 - sf.r, 66 + top);

    // which night, and what is left of it
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,240,205,0.95)';
    ctx.font = '400 19px ' + FONT_TITLE;
    setSpacing(ctx, 5);
    ctx.fillText('NIGHT ' + roman(G.wave), W / 2, 40 + top);

    const boss = findBoss();
    if (boss) {
      ctx.font = '500 12px ' + FONT_UI;
      setSpacing(ctx, 3);
      ctx.fillStyle = 'rgba(255,200,150,0.9)';
      ctx.fillText('THE ECLIPSE', W / 2, 60 + top);
      const gap = 22, x0 = W / 2 - ((boss.maxHp - 1) * gap) / 2;
      for (let i = 0; i < boss.maxHp; i++) {
        ctx.save();
        ctx.translate(x0 + i * gap, 78 + top);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = i < boss.hp ? '#ffe7a8' : 'rgba(255,231,168,0.14)';
        ctx.fillRect(-5.5, -5.5, 11, 11);
        ctx.strokeStyle = 'rgba(255,231,168,0.6)';
        ctx.lineWidth = 1;
        ctx.strokeRect(-5.5, -5.5, 11, 11);
        ctx.restore();
      }
    } else if (Director.state === 'spawn' || Director.state === 'intro') {
      const left = Director.remaining();
      ctx.font = '500 12px ' + FONT_UI;
      setSpacing(ctx, 1.5);
      ctx.fillStyle = 'rgba(210,222,255,0.6)';
      ctx.fillText(left + (left === 1 ? ' SHADE REMAINS' : ' SHADES REMAIN'), W / 2, 60 + top);
    }

    // chain
    if (G.chain >= 1) {
      const m = Math.min(G.chain, CFG.maxChainMult);
      const k = clamp(G.chainT / chainWindow(), 0, 1);
      const hot = Math.min(1, (m - 1) / 8);
      const col = '255,' + Math.round(lerp(236, 170, hot)) + ',' + Math.round(lerp(190, 90, hot));
      const y = H - 44 - sf.b;
      ctx.textAlign = 'center';
      ctx.font = '700 ' + (20 * (1 + this.chainPop * 0.35)).toFixed(1) + 'px ' + FONT_UI;
      setSpacing(ctx, 2);
      ctx.fillStyle = 'rgb(' + col + ')';
      ctx.fillText('CHAIN ×' + m, W / 2, y);
      const bw = 150;
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(W / 2 - bw / 2, y + 10, bw, 3);
      ctx.fillStyle = 'rgb(' + col + ')';
      ctx.fillRect(W / 2 - (bw * k) / 2, y + 10, bw * k, 3);
    }

    ctx.restore();
  },
};
