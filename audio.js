/* =====================================================================
   audio.js — optional sound, generated in code (no audio files needed)
   ---------------------------------------------------------------------
   • Nothing plays until the visitor presses the sound button.
     Browsers block audio that starts without a click or tap, so enable()
     is only ever called from inside a button click.
   • Ambient sound = a soft chord pad + a little wind + occasional
     music-box notes. UI sounds = tick, whoosh, open, close.
   • If the browser refuses to play audio, enable() returns false and the
     website carries on silently.
   ===================================================================== */

const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // MIDI note number -> frequency (Hz)

// Four calm chords (MIDI notes) the pad slowly moves between.
const CHORDS = [
  [50, 57, 61, 64],  // D major 7-ish
  [47, 54, 59, 62],  // B minor
  [43, 50, 54, 59],  // G major
  [45, 52, 57, 61],  // A major
];
// Notes used for the random music-box plinks (D major pentatonic).
const SPARKLE = [74, 76, 78, 81, 83, 86];

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.night = false;
    this.master = null;
    this.ambientBus = null;
    this.nightBus = null;
    this.sfxBus = null;
    this.pad = [];
    this.chordIndex = 0;
    this.timers = [];
    this.noiseBuffer = null;
    this._cricketTimer = 0;
    this._onVisibility = () => {
      if (!this.ctx || !this.enabled) return;
      if (document.hidden) this.ctx.suspend().catch(() => {});
      else this.ctx.resume().catch(() => {});
    };
    document.addEventListener('visibilitychange', this._onVisibility);
  }

  /* ---------- turn sound on / off ---------- */
  async enable() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      if (!this.ctx) { this.ctx = new AC(); this._buildGraph(); }
      // resume() must happen inside the user's click. Some browsers never settle the promise, so we time out.
      await Promise.race([this.ctx.resume(), new Promise((r) => setTimeout(r, 1500))]);
      if (this.ctx.state !== 'running') return false;

      this.enabled = true;
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(0.85, now + 1.2);
      this._startAmbient();
      this.setNight(this.night);
      return true;
    } catch (err) {
      console.warn('Audio could not start:', err);
      return false;
    }
  }

  disable() {
    this.enabled = false;
    this._clearTimers();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(0, now + 0.25);
    // Stop the pad after the fade so it does not use CPU while muted.
    setTimeout(() => { if (!this.enabled) this._stopPad(); }, 400);
  }

  setNight(on) {
    this.night = !!on;
    if (!this.ctx || !this.nightBus) return;
    const now = this.ctx.currentTime;
    this.nightBus.gain.cancelScheduledValues(now);
    this.nightBus.gain.setTargetAtTime(this.night && this.enabled ? 0.65 : 0, now, 1.8);
    if (this.padGain) {
      this.padGain.gain.cancelScheduledValues(now);
      this.padGain.gain.setTargetAtTime(this.night ? 0.045 : 0.11, now, 1.8);
    }
    clearTimeout(this._cricketTimer);
    if (this.night && this.enabled) this._scheduleCricket();
  }

  /* ---------- short interface sounds ---------- */
  tick() {
    if (!this.enabled) return;
    this._blip(1046, 1568, 0.07, 0.07, 'sine');
  }
  open() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    this._note(NOTE(76), t, 0.5, 0.09, 'sine', this.sfxBus);
    this._note(NOTE(83), t + 0.09, 0.7, 0.08, 'sine', this.sfxBus);
  }
  close() {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    this._note(NOTE(83), t, 0.35, 0.07, 'sine', this.sfxBus);
    this._note(NOTE(74), t + 0.08, 0.55, 0.07, 'sine', this.sfxBus);
  }
  whoosh() {
    if (!this.enabled) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.9;
    filter.frequency.setValueAtTime(260, t);
    filter.frequency.exponentialRampToValueAtTime(1900, t + 0.45);
    filter.frequency.exponentialRampToValueAtTime(500, t + 1.0);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.05);
    src.connect(filter); filter.connect(g); g.connect(this.sfxBus);
    src.start(t); src.stop(t + 1.1);
  }

  /* ---------- internals ---------- */
  _buildGraph() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();      // keeps loud moments from clipping
    this.master.connect(comp); comp.connect(ctx.destination);

    this.ambientBus = ctx.createGain(); this.ambientBus.gain.value = 0.55;
    this.sfxBus = ctx.createGain();     this.sfxBus.gain.value = 0.9;
    this.nightBus = ctx.createGain();   this.nightBus.gain.value = 0;
    this.ambientBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.nightBus.connect(this.ambientBus);

    // One shared buffer of noise, reused for wind and whooshes.
    const len = ctx.sampleRate * 2;
    this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    let b0 = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.97 * b0 + 0.03 * w; data[i] = (w * 0.3 + b0 * 3.2); }

    // A little echo for the music-box notes.
    this.echo = ctx.createDelay(1.0); this.echo.delayTime.value = 0.34;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const echoOut = ctx.createGain(); echoOut.gain.value = 0.5;
    this.echo.connect(fb); fb.connect(this.echo);
    this.echo.connect(echoOut); echoOut.connect(this.ambientBus);
  }

  _startAmbient() {
    if (this.pad.length) {            // pad still alive (re-enabled right after muting)
      if (!this.timers.length) this.timers.push(setInterval(() => this._nextChord(), 9000));
      this._scheduleSparkle();
      return;
    }
    const ctx = this.ctx, t = ctx.currentTime;

    // Pad: four soft oscillators through a slowly moving low-pass filter.
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 800; filter.Q.value = 0.4;
    const padGain = ctx.createGain(); padGain.gain.value = 0.0001;
    padGain.gain.linearRampToValueAtTime(0.11, t + 3);
    filter.connect(padGain); padGain.connect(this.ambientBus);

    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.08;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 260;
    lfo.connect(lfoGain); lfoGain.connect(filter.frequency); lfo.start(t);

    const chord = CHORDS[this.chordIndex];
    const oscs = chord.map((n, i) => {
      const o = ctx.createOscillator();
      o.type = i % 2 ? 'triangle' : 'sine';
      o.frequency.value = NOTE(n);
      o.detune.value = (i - 1.5) * 4;
      const g = ctx.createGain(); g.gain.value = 0.5;
      o.connect(g); g.connect(filter); o.start(t);
      return o;
    });

    // Wind: filtered noise whose volume drifts slowly.
    const wind = ctx.createBufferSource(); wind.buffer = this.noiseBuffer; wind.loop = true;
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 520; wf.Q.value = 0.5;
    const wg = ctx.createGain(); wg.gain.value = 0.05;
    const wl = ctx.createOscillator(); wl.frequency.value = 0.07;
    const wlg = ctx.createGain(); wlg.gain.value = 0.03;
    wl.connect(wlg); wlg.connect(wg.gain); wl.start(t);
    wind.connect(wf); wf.connect(wg); wg.connect(this.ambientBus); wind.start(t);

    this.pad = [{ stop: () => { oscs.forEach((o) => o.stop()); lfo.stop(); wind.stop(); wl.stop(); } }];
    this.padOscs = oscs;
    this.padGain = padGain;

    this.timers.push(setInterval(() => this._nextChord(), 9000));
    this._scheduleSparkle();
  }

  _nextChord() {
    if (!this.enabled || !this.padOscs) return;
    this.chordIndex = (this.chordIndex + 1) % CHORDS.length;
    const t = this.ctx.currentTime;
    CHORDS[this.chordIndex].forEach((n, i) => this.padOscs[i].frequency.setTargetAtTime(NOTE(n), t, 1.6));
  }

  _scheduleSparkle() {
    const next = () => {
      if (!this.enabled) return;
      if (!document.hidden) {
        const n = SPARKLE[Math.floor(Math.random() * SPARKLE.length)];
        this._note(NOTE(n), this.ctx.currentTime, 1.6, 0.035, 'triangle', this.echo, this.ambientBus);
      }
      this._sparkleTimer = setTimeout(next, 2200 + Math.random() * 3800);
    };
    clearTimeout(this._sparkleTimer);
    this._sparkleTimer = setTimeout(next, 1800);
  }

  _scheduleCricket() {
    const chirp = () => {
      if (!this.enabled || !this.night) return;
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(4800, t);
      o.frequency.exponentialRampToValueAtTime(3400, t + 0.09);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.045, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      o.connect(g); g.connect(this.nightBus); o.start(t); o.stop(t + 0.12);
      this._cricketTimer = setTimeout(chirp, 600 + Math.random() * 1500);
    };
    clearTimeout(this._cricketTimer);
    this._cricketTimer = setTimeout(chirp, 350);
  }

  _stopPad() {
    if (this.pad.length) { try { this.pad[0].stop(); } catch (e) { /* already stopped */ } }
    this.pad = []; this.padOscs = null;
  }

  _clearTimers() {
    this.timers.forEach(clearInterval); this.timers = [];
    clearTimeout(this._sparkleTimer);
    clearTimeout(this._cricketTimer);
  }

  _note(freq, when, dur, vol, type, bus, dry) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g); g.connect(bus);
    if (dry) g.connect(dry);
    o.start(when); o.stop(when + dur + 0.05);
  }

  _blip(f0, f1, dur, vol, type) {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + dur + 0.03);
  }
}
