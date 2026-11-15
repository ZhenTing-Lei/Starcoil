'use strict';
/* ==========================================================================
   STARCOIL — sound. Every effect and the whole score are synthesised with
   WebAudio at run time; the game ships no audio files.
   ========================================================================== */

const MUSIC_GAIN = 0.5;       // the score sits well under the effects

const Snd = {
  ctx: null,
  master: null,
  sfxBus: null,
  musicBus: null,
  echoBus: null,
  noiseBuf: null,
  muted: Store.get('muted', false),
  ready: false,

  /** Browsers only allow audio after a user gesture, so call this from one. Safe to repeat. */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      const ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 18;
      comp.ratio.value = 5;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      comp.connect(ctx.destination);

      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(comp);

      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = 1.0;
      this.sfxBus.connect(this.master);

      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = MUSIC_GAIN;
      this.musicBus.connect(this.master);

      // a soft feedback echo that chimes and plucks are sent to
      const delay = ctx.createDelay(1);
      delay.delayTime.value = 0.31;
      const fb = ctx.createGain();
      fb.gain.value = 0.34;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      this.echoBus = ctx.createGain();
      this.echoBus.connect(delay);
      delay.connect(lp);
      lp.connect(fb);
      fb.connect(delay);
      lp.connect(this.master);

      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;

      this.ctx = ctx;
      this.ready = true;
      Music.start();
    } catch (err) {
      this.ctx = null;
      this.ready = false;
    }
  },

  /** Effects only sound during a real run — the title-screen demo plays silently. */
  get live() {
    return this.ready && !this.muted && this.ctx.state === 'running' && !G.attract;
  },

  setMuted(m) {
    this.muted = !!m;
    Store.set('muted', this.muted);
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.03);
  },

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  },

  /** Pull the music back while paused or choosing a boon. */
  duck(on) {
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(on ? MUSIC_GAIN * 0.35 : MUSIC_GAIN, this.ctx.currentTime, 0.2);
  },

  /** One enveloped oscillator. { f, f2, type, dur, vol, attack, delay | at, echo, bus } */
  tone(o) {
    const ctx = this.ctx;
    const t0 = o.at !== undefined ? o.at : ctx.currentTime + (o.delay || 0);
    const dur = o.dur || 0.2;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t0);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(o.vol === undefined ? 0.2 : o.vol, t0 + (o.attack || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(o.bus || this.sfxBus);
    if (o.echo) {
      const send = ctx.createGain();
      send.gain.value = o.echo;
      g.connect(send);
      send.connect(this.echoBus);
    }
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  },

  /** Filtered noise burst. { type, f, f2, q, dur, vol, attack, delay | at, bus } */
  noise(o) {
    const ctx = this.ctx;
    const t0 = o.at !== undefined ? o.at : ctx.currentTime + (o.delay || 0);
    const dur = o.dur || 0.2;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const flt = ctx.createBiquadFilter();
    flt.type = o.type || 'lowpass';
    flt.frequency.setValueAtTime(o.f || 1000, t0);
    if (o.f2) flt.frequency.exponentialRampToValueAtTime(o.f2, t0 + dur);
    flt.Q.value = o.q || 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(o.vol === undefined ? 0.2 : o.vol, t0 + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(flt);
    flt.connect(g);
    g.connect(o.bus || this.sfxBus);
    src.start(t0, Math.random() * 0.9);
    src.stop(t0 + dur + 0.05);
  },
};

/* ---- pitch helpers ------------------------------------------------------- */

const PENTA = [0, 3, 5, 7, 10];                               // D minor pentatonic
const noteHz = (i) => 293.66 * Math.pow(2, (PENTA[((i % 5) + 5) % 5] + 12 * Math.floor(i / 5)) / 12);
const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

/* ---- effects ------------------------------------------------------------- */

const Sfx = {};

(function defineSfx() {
  const def = (name, fn) => {
    Sfx[name] = function () {
      if (!Snd.live) return;
      try { fn.apply(null, arguments); } catch (err) { /* never let sound break the game */ }
    };
  };

  // a banished shade: a pluck that climbs the scale through a big catch
  def('pop', (i) => {
    const n = Math.min(i || 0, 14);
    Snd.tone({ f: noteHz(5 + n), type: 'triangle', dur: 0.26, vol: 0.15, echo: 0.35 });
    Snd.tone({ f: noteHz(10 + n), dur: 0.16, vol: 0.05 });
  });

  def('coil', (count, chain) => {
    Snd.tone({ f: 150 + Math.min(chain, 10) * 12, f2: 70, dur: 0.28, vol: 0.26 });
    Snd.noise({ type: 'bandpass', f: 500, f2: 3200, q: 1.2, dur: 0.3, vol: 0.1 });
    if (count >= 3) Snd.tone({ f: noteHz(10), dur: 0.8, vol: 0.07, echo: 0.5, delay: 0.04 });
    if (count >= 5) Snd.tone({ f: noteHz(12), dur: 0.9, vol: 0.06, echo: 0.5, delay: 0.12 });
  });

  def('emptyCoil', () => Snd.tone({ f: 420, f2: 300, dur: 0.09, vol: 0.035 }));

  def('hit', () => {
    Snd.noise({ type: 'lowpass', f: 1400, f2: 200, dur: 0.38, vol: 0.5 });
    Snd.tone({ f: 170, f2: 42, dur: 0.4, vol: 0.5 });
    Snd.tone({ f: 233, type: 'square', dur: 0.12, vol: 0.05 });
  });

  def('dash', () => Snd.noise({ type: 'bandpass', f: 500, f2: 3400, q: 1.6, dur: 0.24, vol: 0.2 }));

  def('cut', () => {
    Snd.noise({ type: 'highpass', f: 2400, dur: 0.14, vol: 0.2 });
    Snd.tone({ f: 880, f2: 200, type: 'square', dur: 0.14, vol: 0.06 });
  });

  def('clang', () => {
    Snd.tone({ f: 1320, dur: 0.3, vol: 0.09, echo: 0.3 });
    Snd.tone({ f: 1980, dur: 0.22, vol: 0.05 });
  });

  def('crack', () => {
    Snd.noise({ type: 'bandpass', f: 1800, f2: 500, q: 0.9, dur: 0.22, vol: 0.3 });
    Snd.tone({ f: 120, f2: 60, dur: 0.2, vol: 0.25 });
  });

  def('shatter', () => {
    Snd.noise({ type: 'highpass', f: 3000, dur: 0.35, vol: 0.25 });
    for (let i = 0; i < 5; i++) Snd.tone({ f: rand(1400, 3200), dur: 0.18, vol: 0.05, delay: i * 0.035 });
    Snd.tone({ f: 200, f2: 70, type: 'sawtooth', dur: 0.3, vol: 0.1 });
  });

  def('rift', () => Snd.tone({ f: 82, f2: 164, dur: 0.4, vol: 0.05 }));
  def('spit', () => Snd.tone({ f: 540, f2: 250, type: 'triangle', dur: 0.14, vol: 0.08 }));
  def('dart', () => Snd.noise({ type: 'bandpass', f: 2200, f2: 500, q: 2, dur: 0.22, vol: 0.13 }));
  def('fang', () => Snd.tone({ f: 660, f2: 990, type: 'triangle', dur: 0.1, vol: 0.1 }));
  def('zap', () => {
    Snd.noise({ type: 'highpass', f: 1800, dur: 0.16, vol: 0.16 });
    Snd.tone({ f: 1500, f2: 300, type: 'sawtooth', dur: 0.14, vol: 0.05 });
  });
  def('nova', () => Snd.tone({ f: 90, f2: 40, dur: 0.45, vol: 0.3 }));

  def('heal', () => {
    Snd.tone({ f: noteHz(7), dur: 0.35, vol: 0.14, echo: 0.4 });
    Snd.tone({ f: noteHz(9), dur: 0.5, vol: 0.14, echo: 0.4, delay: 0.11 });
  });

  def('boon', () => {
    [5, 7, 9, 12].forEach((n, i) => Snd.tone({ f: noteHz(n), type: 'triangle', dur: 0.5, vol: 0.12, echo: 0.45, delay: i * 0.07 }));
  });

  def('ui', () => Snd.tone({ f: 620, dur: 0.06, vol: 0.07 }));

  def('wave', () => {
    Snd.tone({ f: 146.83, dur: 1.8, vol: 0.18, attack: 0.02, echo: 0.3 });
    Snd.tone({ f: 220, dur: 1.5, vol: 0.09, attack: 0.02 });
  });

  def('clear', () => {
    [5, 6, 7, 10].forEach((n, i) => Snd.tone({ f: noteHz(n), type: 'triangle', dur: 0.55, vol: 0.13, echo: 0.5, delay: i * 0.1 }));
  });

  def('over', () => {
    [9, 7, 6, 5, 2].forEach((n, i) => Snd.tone({ f: noteHz(n), type: 'triangle', dur: 0.9, vol: 0.13, echo: 0.5, delay: i * 0.2 }));
    Snd.tone({ f: 73.4, dur: 2.2, vol: 0.25, attack: 0.05 });
  });

  def('revive', () => {
    [0, 2, 5, 7, 10, 12].forEach((n, i) => Snd.tone({ f: noteHz(n), type: 'triangle', dur: 0.6, vol: 0.12, echo: 0.5, delay: i * 0.06 }));
  });

  def('bossRoar', () => {
    Snd.tone({ f: 55, f2: 38, type: 'sawtooth', dur: 1.4, vol: 0.22, attack: 0.08 });
    Snd.noise({ type: 'lowpass', f: 300, f2: 90, dur: 1.3, vol: 0.3, attack: 0.05 });
  });
  def('bossWind', () => Snd.tone({ f: 70, f2: 210, type: 'sawtooth', dur: 0.85, vol: 0.09, attack: 0.3 }));
  def('bossFire', () => {
    Snd.noise({ type: 'bandpass', f: 900, f2: 300, q: 1, dur: 0.3, vol: 0.28 });
    Snd.tone({ f: 300, f2: 120, type: 'triangle', dur: 0.22, vol: 0.12 });
  });
  def('bossCharge', () => Snd.noise({ type: 'bandpass', f: 300, f2: 1600, q: 1.4, dur: 0.6, vol: 0.3 }));
  def('summon', () => Snd.tone({ f: 110, f2: 330, type: 'triangle', dur: 0.5, vol: 0.12, echo: 0.3 }));
  def('bossHit', () => {
    Snd.tone({ f: 110, f2: 45, dur: 0.6, vol: 0.45 });
    Snd.noise({ type: 'lowpass', f: 2000, f2: 200, dur: 0.5, vol: 0.3 });
    [5, 8, 10].forEach((n, i) => Snd.tone({ f: noteHz(n), type: 'triangle', dur: 0.7, vol: 0.1, echo: 0.5, delay: 0.05 + i * 0.05 }));
  });
  def('bossDie', () => {
    Snd.tone({ f: 130, f2: 30, dur: 1.6, vol: 0.5 });
    Snd.noise({ type: 'lowpass', f: 3000, f2: 100, dur: 1.5, vol: 0.4 });
    for (let i = 0; i < 9; i++) Snd.tone({ f: noteHz(5 + i), type: 'triangle', dur: 0.9, vol: 0.1, echo: 0.55, delay: 0.25 + i * 0.09 });
  });
})();

/* ---- generative score ---------------------------------------------------- */

const Music = {
  timer: 0,
  step: 0,
  nextT: 0,
  intensity: 0,                 // 0 title · 1 early nights · 2 later nights · 3 the Eclipse
  BPM: [80, 86, 92, 104],
  ARP: [0, 2, 4, 1, 3, 2, 4, 3],
  PROG: [                       // MIDI notes; two bars each
    { root: 38, pad: [50, 57, 60, 65], arp: [62, 65, 69, 72, 76] },      // Dm9
    { root: 34, pad: [46, 53, 57, 62], arp: [58, 62, 65, 69, 74] },      // B♭maj7
    { root: 41, pad: [53, 57, 60, 64], arp: [60, 64, 65, 69, 72] },      // Fmaj7
    { root: 36, pad: [48, 55, 57, 64], arp: [60, 62, 64, 67, 69] },      // C6/9
  ],

  start() {
    if (this.timer) return;
    this.step = 0;
    this.nextT = Snd.ctx.currentTime + 0.15;
    this.timer = setInterval(() => this.tick(), 50);
  },

  setIntensity(i) { this.intensity = clamp(i, 0, 3); },

  tick() {
    const ctx = Snd.ctx;
    if (!ctx || ctx.state !== 'running') return;
    // after a suspended tab, skip the backlog instead of playing it all at once
    if (this.nextT < ctx.currentTime - 0.3) this.nextT = ctx.currentTime + 0.05;
    while (this.nextT < ctx.currentTime + 0.22) {
      try { this.schedule(this.step, this.nextT); } catch (err) { /* keep the clock running */ }
      this.nextT += 60 / this.BPM[this.intensity] / 2;
      this.step++;
    }
  },

  schedule(step, t) {
    const I = this.intensity;
    const eighth = 60 / this.BPM[I] / 2;
    const s = step % 8;
    const chord = this.PROG[Math.floor(step / 16) % this.PROG.length];
    const bus = Snd.musicBus;

    if (step % 16 === 0) this.pad(chord, t, eighth * 16);

    if (I >= 1 && (s === 0 || s === 5)) {
      const f = midiHz(chord.root);
      Snd.tone({ f, dur: eighth * (s === 0 ? 3.6 : 2.2), vol: 0.22, attack: 0.012, bus, at: t });
      Snd.tone({ f: f * 2, type: 'triangle', dur: eighth * 2, vol: 0.05, bus, at: t });
    }

    let play;
    if (I === 0) play = s === 0 || s === 3 || s === 6;
    else if (I === 1) play = s !== 1 && s !== 7;
    else play = true;
    if (play && (I >= 2 || Math.random() < 0.8)) {
      const idx = this.ARP[(s + Math.floor(step / 8)) % 8];
      const oct = I >= 3 && s % 2 === 1 ? 12 : 0;
      Snd.tone({ f: midiHz(chord.arp[idx] + oct), type: 'triangle', dur: 0.42, vol: I >= 2 ? 0.07 : 0.085, echo: 0.55, bus, at: t });
    }

    if (I >= 2 && (s % 2 === 1 || I >= 3)) {
      Snd.noise({ type: 'highpass', f: 7000, dur: 0.04, vol: s % 2 === 1 ? 0.03 : 0.015, bus, at: t });
    }
    if ((I >= 3 && (s === 0 || s === 4 || s === 7)) || (I === 2 && s === 0)) {
      Snd.tone({ f: 120, f2: 42, dur: 0.2, vol: I >= 3 ? 0.32 : 0.18, bus, at: t });
    }
  },

  /** A slow two-oscillator chord wash under everything. */
  pad(chord, t, dur) {
    const ctx = Snd.ctx;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(1, t + 1.4);
    out.gain.setValueAtTime(1, t + dur - 0.2);
    out.gain.linearRampToValueAtTime(0.0001, t + dur + 1.8);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900 + this.intensity * 250;
    lp.Q.value = 0.4;
    out.connect(lp);
    lp.connect(Snd.musicBus);
    for (let i = 0; i < chord.pad.length; i++) {
      for (let k = 0; k < 2; k++) {
        const o = ctx.createOscillator();
        o.type = k ? 'sine' : 'triangle';
        o.frequency.value = midiHz(chord.pad[i]) * (k ? 1.004 : 0.998);
        const g = ctx.createGain();
        g.gain.value = k ? 0.05 : 0.045;
        o.connect(g);
        g.connect(out);
        o.start(t);
        o.stop(t + dur + 2);
      }
    }
  },
};
