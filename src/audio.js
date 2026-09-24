// Every sound in the game is synthesised here with Web Audio: engines, effects, and a
// generative synthwave score whose intensity follows the match.

const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.volume = { master: 0.8, music: 0.55, sfx: 0.9 };
    this.intensity = 0;
    this.engines = [];
    this.grindLevel = 0;
    this.song = { bpm: 112, roots: [45, 41, 48, 43], chords: [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]], theme: 'grid' };
  }

  // Each arena has its own track: tempo, key/progression and a little timbre.
  setMusic(music, theme) {
    this.song = { ...music, theme };
    if (this.ready) this.delay.delayTime.setTargetAtTime((60 / music.bpm) * 0.75, this.now(), 0.1);
  }

  // Must run from a user gesture.
  // The engine's notion of "now": the audio clock live, or the game's virtual clock when
  // rendering offline for video capture.
  now() {
    return this.clock ? this.clock() : this.ctx.currentTime;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended' && !this.offline) this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.build(new Ctx({ latencyHint: 'interactive' }));
  }

  // Re-create the whole graph on an OfflineAudioContext driven by `clock` (seconds).
  startOffline(seconds, clock) {
    if (this.timer) clearInterval(this.timer);
    if (this.ctx && !this.offline) this.ctx.suspend();
    this.offline = true;
    this.clock = clock;
    this.engines = [];
    this.ready = false;
    this.build(new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(48000 * seconds), sampleRate: 48000 }));
  }

  async renderOffline() {
    return this.ctx.startRendering();
  }

  build(ctx) {
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume.master;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.comp = comp;

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.volume.music;
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.volume.sfx;
    this.engineBus = ctx.createGain();
    this.engineBus.gain.value = 0;
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.engineBus.connect(this.master);

    // music filter (opens up with intensity, closes while paused)
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 2400;
    this.musicFilter.Q.value = 0.7;
    this.musicIn = ctx.createGain();
    this.musicIn.connect(this.musicFilter).connect(this.musicBus);

    // generated reverb
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.6, 2.4);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.9;
    this.reverbSend.connect(this.reverb).connect(this.master);

    // tempo-synced delay for the arp
    this.delay = ctx.createDelay(1.0);
    this.delay.delayTime.value = (60 / 112) * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 2600;
    this.delay.connect(dlp).connect(fb).connect(this.delay);
    this.delayIn = ctx.createGain();
    this.delayIn.gain.value = 0.5;
    this.delayIn.connect(this.delay);
    dlp.connect(this.musicIn);

    this.noise = this.noiseBuffer(2);

    for (let i = 0; i < 4; i++) this.engines.push(this.makeEngine(i === 0));
    this.makeGrind();
    this.makeLaser();
    this.startMusic();
    this.ready = true;
  }

  impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  noiseBuffer(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume.master, this.now(), 0.05);
  }

  setVolume(kind, v) {
    this.volume[kind] = v;
    if (!this.ctx) return;
    const t = this.now();
    if (kind === 'master' && !this.muted) this.master.gain.setTargetAtTime(v, t, 0.05);
    if (kind === 'music') this.musicBus.gain.setTargetAtTime(v, t, 0.05);
    if (kind === 'sfx') {
      this.sfxBus.gain.setTargetAtTime(v, t, 0.05);
      this.engineBusLevel = v;
    }
  }

  // --- engines -------------------------------------------------------------

  makeEngine(isPlayer) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    const pan = ctx.createStereoPanner();
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 500;
    filt.Q.value = isPlayer ? 5 : 3;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.detune.value = 7;
    const o3 = ctx.createOscillator(); o3.type = 'sine';
    const whine = ctx.createOscillator(); whine.type = 'triangle';
    const g1 = ctx.createGain(); g1.gain.value = 0.35;
    const g2 = ctx.createGain(); g2.gain.value = 0.18;
    const g3 = ctx.createGain(); g3.gain.value = 0.5;
    const gw = ctx.createGain(); gw.gain.value = 0;
    o1.connect(g1).connect(filt);
    o2.connect(g2).connect(filt);
    o3.connect(g3).connect(filt);
    whine.connect(gw).connect(pan);
    filt.connect(pan).connect(out).connect(this.engineBus);
    // wobble for a living hum
    const lfo = ctx.createOscillator();
    lfo.frequency.value = isPlayer ? 7.3 : 6.1 + Math.random();
    const lfoG = ctx.createGain();
    lfoG.gain.value = 3;
    lfo.connect(lfoG);
    lfoG.connect(o1.frequency);
    lfoG.connect(o2.frequency);
    for (const o of [o1, o2, o3, whine, lfo]) o.start();
    return { isPlayer, out, pan, filt, o1, o2, o3, whine, gw, last: 0 };
  }

  // riders: [{ alive, speed, boosting, x, z, vx, vz, grind }], listener: { x, z, yaw }
  updateEngines(riders, listener, active) {
    if (!this.ready) return;
    const t = this.now();
    this.engineBus.gain.setTargetAtTime(active ? this.volume.sfx : 0, t, 0.15);
    const fx = -Math.sin(listener.yaw), fz = -Math.cos(listener.yaw);
    const rx = -fz, rz = fx;
    for (let i = 0; i < riders.length; i++) {
      const r = riders[i], e = this.engines[i];
      let gain = 0, f = 40, pan = 0, cut = 400, whine = 0;
      if (r.alive) {
        const sp = r.speed;
        f = 34 + sp * 1.45 + (r.boosting ? 14 : 0);
        cut = 300 + sp * 26 + (r.boosting ? 1400 : 0);
        whine = r.boosting ? 0.035 : 0.008;
        if (e.isPlayer) {
          gain = 0.2;
        } else {
          const dx = r.x - listener.x, dz = r.z - listener.z;
          const d = Math.hypot(dx, dz) + 0.001;
          gain = 0.24 / (1 + (d / 9) * (d / 9));
          pan = Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d));
          // doppler: pitch rises as a bike closes in
          const closing = -((r.vx - listener.vx) * dx + (r.vz - listener.vz) * dz) / d;
          f *= Math.max(0.7, Math.min(1.4, 1 + closing / 160));
        }
      }
      e.out.gain.setTargetAtTime(gain, t, 0.05);
      e.pan.pan.setTargetAtTime(pan, t, 0.05);
      e.o1.frequency.setTargetAtTime(f, t, 0.04);
      e.o2.frequency.setTargetAtTime(f * 0.5, t, 0.04);
      e.o3.frequency.setTargetAtTime(f * 0.5, t, 0.04);
      e.whine.frequency.setTargetAtTime(f * 9, t, 0.05);
      e.gw.gain.setTargetAtTime(e.isPlayer ? whine : whine * gain * 2, t, 0.06);
      e.filt.frequency.setTargetAtTime(cut, t, 0.05);
    }
  }

  makeGrind() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3200;
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    g.gain.value = 0;
    // crackle: noise amplitude-modulated by a fast square
    const am = ctx.createGain();
    am.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 37;
    const lg = ctx.createGain();
    lg.gain.value = 0.5;
    lfo.connect(lg).connect(am.gain);
    src.connect(bp).connect(am).connect(g).connect(this.sfxBus);
    src.start();
    lfo.start();
    this.grind = { g, bp, lfo };
  }

  setGrind(level, side) {
    if (!this.ready) return;
    const t = this.now();
    this.grind.g.gain.setTargetAtTime(Math.min(1, level) * 0.22, t, 0.04);
    this.grind.bp.frequency.setTargetAtTime(2400 + level * 2600, t, 0.05);
    this.grind.lfo.frequency.setTargetAtTime(25 + Math.random() * 30, t, 0.02);
  }

  // A buzzing reactor-laser drone whose level follows how close the arms are.
  makeLaser() {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 96;
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 193;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 2;
    const trem = ctx.createGain(); trem.gain.value = 0.6;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 23;
    const lg = ctx.createGain(); lg.gain.value = 0.4;
    lfo.connect(lg).connect(trem.gain);
    const g = ctx.createGain(); g.gain.value = 0;
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    o.connect(bp); o2.connect(g2).connect(bp);
    bp.connect(trem).connect(g).connect(this.sfxBus);
    for (const x of [o, o2, lfo]) x.start();
    this.laser = { g, bp };
  }

  setLaser(level) {
    if (!this.ready) return;
    const t = this.now();
    this.laser.g.gain.setTargetAtTime(Math.min(1, level) * 0.16, t, 0.08);
    this.laser.bp.frequency.setTargetAtTime(700 + level * 900, t, 0.1);
  }

  pad() {
    this.noiseHit(0.55, 0.22, { type: 'bandpass', f0: 400, f1: 6000, q: 2.5, verb: 0.2 });
    this.tone('sawtooth', 160, 640, 0.4, 0.09);
    this.tone('sine', 440, 1320, 0.3, 0.06, { at: 0.05 });
  }

  portal() {
    this.tone('sine', 1400, 90, 0.5, 0.2, { verb: 0.6 });
    this.tone('triangle', 200, 2200, 0.45, 0.12, { at: 0.12, verb: 0.6 });
    this.noiseHit(0.6, 0.12, { type: 'bandpass', f0: 3000, f1: 300, q: 3, verb: 0.5 });
    for (let i = 0; i < 5; i++) this.tone('sine', 2400 + i * 300, 2400 + i * 300, 0.12, 0.03, { at: 0.2 + i * 0.04, verb: 0.6 });
  }

  pickup(type) {
    const seq = { boost: [0, 7, 12, 19], jump: [0, 5, 12, 17], ghost: [0, 3, 10, 15] }[type] || [0, 7, 12];
    const base = { boost: 76, jump: 79, ghost: 71 }[type] || 76;
    seq.forEach((st, i) => this.tone(type === 'ghost' ? 'sine' : 'triangle', midi(base + st), midi(base + st), 0.16, 0.08, { at: i * 0.045, verb: 0.45 }));
  }

  bigAir(air) {
    this.noiseHit(0.5, 0.12, { type: 'bandpass', f0: 1200, f1: 5000, q: 1.2, verb: 0.3 });
    [0, 4, 7, 12].forEach((st, i) => this.tone('square', midi(72 + st + Math.min(5, Math.floor(air * 3))), midi(72 + st), 0.12, 0.045, { at: i * 0.05, verb: 0.4 }));
  }

  nearMiss() {
    this.noiseHit(0.22, 0.14, { type: 'bandpass', f0: 5000, f1: 900, q: 2 });
    this.tone('sine', 1760, 2640, 0.1, 0.04, { at: 0.03 });
  }

  streak(n) {
    [0, 4, 7, 12, 16].slice(0, 2 + n).forEach((st, i) => this.tone('sawtooth', midi(69 + st), midi(69 + st), 0.14, 0.06, { at: i * 0.06, verb: 0.4 }));
  }

  // --- one-shots -----------------------------------------------------------

  env(gainNode, t, a, peak, d, end = 0.0001) {
    const g = gainNode.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.exponentialRampToValueAtTime(peak, t + a);
    g.exponentialRampToValueAtTime(end, t + a + d);
  }

  tone(type, f0, f1, dur, vol, { at = 0, dest = this.sfxBus, attack = 0.005, verb = 0, pan = 0 } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = this.now() + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, attack, vol, dur);
    let node = o.connect(g);
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node = node.connect(p);
    }
    node.connect(dest);
    if (verb) {
      const s = ctx.createGain();
      s.gain.value = verb;
      node.connect(s).connect(this.reverbSend);
    }
    o.start(t);
    o.stop(t + attack + dur + 0.05);
  }

  noiseHit(dur, vol, { type = 'lowpass', f0 = 4000, f1 = 200, q = 0.8, at = 0, verb = 0, pan = 0 } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = this.now() + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.004, vol, dur);
    let node = src.connect(f).connect(g);
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node = node.connect(p);
    }
    node.connect(this.sfxBus);
    if (verb) {
      const s = ctx.createGain();
      s.gain.value = verb;
      node.connect(s).connect(this.reverbSend);
    }
    src.start(t, Math.random() * 1.2);
    src.stop(t + dur + 0.1);
  }

  turn() {
    const v = 0.9 + Math.random() * 0.2;
    this.tone('square', 900 * v, 520 * v, 0.05, 0.05);
    this.noiseHit(0.06, 0.05, { type: 'highpass', f0: 5000, f1: 2500 });
  }

  boost() {
    this.noiseHit(0.5, 0.2, { type: 'bandpass', f0: 500, f1: 5200, q: 2, verb: 0.2 });
    this.tone('sawtooth', 110, 330, 0.35, 0.07);
  }

  jump() {
    this.tone('sine', 180, 900, 0.3, 0.2, { verb: 0.25 });
    this.tone('triangle', 360, 1500, 0.25, 0.07);
    this.noiseHit(0.3, 0.12, { type: 'bandpass', f0: 800, f1: 4000, q: 1.5 });
  }

  land() {
    this.tone('sine', 120, 40, 0.25, 0.4);
    this.noiseHit(0.18, 0.15, { f0: 1800, f1: 120 });
  }

  jumpReady() {
    this.tone('sine', 1320, 1320, 0.12, 0.06, { verb: 0.3 });
    this.tone('sine', 1760, 1760, 0.16, 0.05, { at: 0.07, verb: 0.3 });
  }

  // distance-attenuated derez explosion
  crash(dist, pan = 0, isPlayer = false) {
    const k = isPlayer ? 1 : Math.max(0.12, 1 / (1 + (dist / 30) ** 2));
    this.noiseHit(1.1, 0.7 * k, { f0: 6000, f1: 90, verb: 0.5 * k, pan });
    this.tone('sine', 140, 28, 0.8, 0.8 * k, { pan });
    this.tone('sawtooth', 70, 30, 0.5, 0.25 * k, { pan });
    // glassy shards
    for (let i = 0; i < 7; i++) {
      const f = 1800 + Math.random() * 3800;
      this.tone('sine', f, f * 0.97, 0.25 + Math.random() * 0.4, 0.05 * k, { at: 0.02 + Math.random() * 0.25, verb: 0.6, pan });
    }
    // digital derez arpeggio falling away
    const base = 72 + Math.floor(Math.random() * 3);
    [0, -5, -8, -12, -17].forEach((s, i) => this.tone('square', midi(base + s), midi(base + s), 0.08, 0.05 * k, { at: 0.05 + i * 0.055, verb: 0.3, pan }));
  }

  kill() {
    // stinger when the player's wall claims someone
    [0, 4, 7, 12].forEach((s, i) => this.tone('square', midi(76 + s), midi(76 + s), 0.12, 0.06, { at: i * 0.05, verb: 0.35 }));
  }

  countdown(n) {
    if (n > 0) this.tone('sine', 660, 660, 0.22, 0.25, { verb: 0.3 });
    else {
      this.tone('sawtooth', 880, 880, 0.5, 0.12, { verb: 0.4 });
      this.tone('sawtooth', 1320, 1320, 0.5, 0.08, { verb: 0.4 });
      this.tone('sine', 220, 220, 0.6, 0.25);
    }
  }

  sudden() {
    for (let i = 0; i < 4; i++) {
      this.tone('sawtooth', 520, 380, 0.22, 0.09, { at: i * 0.5 });
      this.tone('sawtooth', 780, 560, 0.22, 0.06, { at: i * 0.5 + 0.25 });
    }
  }

  roundWin() {
    [0, 4, 7, 11, 14].forEach((s, i) => this.tone('triangle', midi(69 + s), midi(69 + s), 0.5, 0.12, { at: i * 0.09, verb: 0.5 }));
  }

  roundLose() {
    [7, 3, 0, -5].forEach((s, i) => this.tone('triangle', midi(64 + s), midi(64 + s), 0.45, 0.1, { at: i * 0.14, verb: 0.5 }));
  }

  uiHover() { this.tone('sine', 1500, 1700, 0.04, 0.025); }
  uiClick() {
    this.tone('square', 700, 1100, 0.06, 0.05);
    this.tone('sine', 1400, 1400, 0.1, 0.04, { at: 0.03, verb: 0.2 });
  }

  // --- music ---------------------------------------------------------------

  startMusic() {
    this.step = 0;
    this.nextTime = this.now() + 0.1;
    if (!this.offline) this.timer = setInterval(() => this.schedule(), 25); // offline: driven per frame
  }

  setIntensity(level) {
    this.intensity = level;
    if (!this.ready) return;
    const t = this.now();
    const cut = [900, 2600, 5200, 9000][level] ?? 2600;
    this.musicFilter.frequency.setTargetAtTime(cut, t, 0.6);
  }

  setPausedMusic(p) {
    if (!this.ready) return;
    const t = this.now();
    this.musicFilter.frequency.setTargetAtTime(p ? 500 : [900, 2600, 5200, 9000][this.intensity], t, 0.2);
  }

  schedule() {
    const ctx = this.ctx;
    if (!this.offline && ctx.state !== 'running') { this.nextTime = this.now() + 0.05; return; }
    const sixteenth = 60 / this.song.bpm / 4;
    if (this.nextTime < this.now() - 0.2) this.nextTime = this.now() + 0.05; // tab was asleep
    while (this.nextTime < this.now() + 0.15) {
      this.playStep(this.step, this.nextTime);
      this.nextTime += sixteenth;
      this.step = (this.step + 1) % 64;
    }
  }

  playStep(step, t) {
    const lvl = this.intensity;
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const song = this.song;
    const root = song.roots[bar];
    const chord = song.chords[bar];

    if (s === 0) this.padChord(chord, t, (60 / song.bpm) * 4);

    // arpeggio: the mesa rides lazy eighths, the station runs hot sixteenths
    const arpNotes = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[1] + 24];
    const eighths = lvl === 0 || song.theme === 'mesa';
    if (eighths ? s % 2 === 0 : true) {
      const n = arpNotes[(step >> (eighths ? 1 : 0)) % 4];
      const wave = song.theme === 'mesa' ? 'sawtooth' : 'square';
      const cut = song.theme === 'orbital' ? 3200 : song.theme === 'mesa' ? 1500 : 2200;
      this.voice(wave, midi(n), t, eighths ? 0.18 : 0.11, lvl === 0 ? 0.018 : 0.026, cut, true);
    }

    if (lvl >= 1) {
      // bass
      const pat = [1, 0, 1, 2, 0, 0, 1, 0, 1, 0, 1, 2, 0, 1, 1, 0];
      if (pat[s]) this.bass(midi(root - 12 + (pat[s] === 2 ? 12 : 0)), t);
      // drums
      if (s % 4 === 0) this.kick(t);
      if (lvl >= 2 && (s === 4 || s === 12)) this.snare(t);
      if ((lvl >= 3 && s % 1 === 0) || s % 2 === 1 || (lvl >= 2 && s % 4 === 2)) this.hat(t, s % 4 === 2 ? 0.05 : 0.03);
    } else if (s === 0) {
      this.bass(midi(root - 12), t, 1.4, 0.07);
    }
  }

  voice(type, f, t, dur, vol, cutoff, delay = false) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const fl = ctx.createBiquadFilter();
    fl.type = 'lowpass';
    fl.frequency.setValueAtTime(cutoff, t);
    fl.frequency.exponentialRampToValueAtTime(cutoff * 0.3, t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.004, vol, dur);
    o.connect(fl).connect(g).connect(this.musicIn);
    if (delay) g.connect(this.delayIn);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  bass(f, t, dur = 0.12, vol = 0.14) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.value = f * 0.5;
    const fl = ctx.createBiquadFilter();
    fl.type = 'lowpass';
    fl.Q.value = 6;
    fl.frequency.setValueAtTime(1400, t);
    fl.frequency.exponentialRampToValueAtTime(160, t + dur);
    const g = ctx.createGain();
    this.env(g, t, 0.004, vol, dur);
    const g2 = ctx.createGain();
    g2.gain.value = 0.5;
    o.connect(fl);
    o2.connect(g2).connect(fl);
    fl.connect(g).connect(this.musicIn);
    o.start(t); o2.start(t);
    o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }

  kick(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    const g = ctx.createGain();
    this.env(g, t, 0.002, 0.55, 0.26);
    o.connect(g).connect(this.musicBus);
    o.start(t);
    o.stop(t + 0.35);
  }

  snare(t) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1900;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    this.env(g, t, 0.002, 0.16, 0.18);
    src.connect(f).connect(g).connect(this.musicIn);
    const s = ctx.createGain();
    s.gain.value = 0.35;
    g.connect(s).connect(this.reverbSend);
    src.start(t, Math.random());
    src.stop(t + 0.25);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.08);
    const g2 = ctx.createGain();
    this.env(g2, t, 0.002, 0.12, 0.09);
    o.connect(g2).connect(this.musicIn);
    o.start(t);
    o.stop(t + 0.15);
  }

  hat(t, vol) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7500;
    const g = ctx.createGain();
    this.env(g, t, 0.001, vol, 0.045);
    src.connect(f).connect(g).connect(this.musicIn);
    src.start(t, Math.random());
    src.stop(t + 0.08);
  }

  padChord(chord, t, dur) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.6);
    g.gain.setValueAtTime(0.05, t + dur - 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.4);
    const fl = ctx.createBiquadFilter();
    fl.type = 'lowpass';
    fl.frequency.value = 1100;
    fl.connect(g).connect(this.musicIn);
    const s = ctx.createGain();
    s.gain.value = 0.5;
    g.connect(s).connect(this.reverbSend);
    for (const n of chord) {
      for (const det of [-9, 8]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(n);
        o.detune.value = det;
        o.connect(fl);
        o.start(t);
        o.stop(t + dur + 0.5);
      }
    }
  }
}
