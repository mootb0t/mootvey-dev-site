/* Rocket Comet Run — single-file canvas arcade
   - Collect tiny gold comets for points
   - Avoid large meteors and fast meteorites
   - Simple boost + fuel
*/

(() => {
  'use strict';

  // --- DOM
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const healthEl = document.getElementById('health');
  const msgEl = document.getElementById('msg');

  // --- HiDPI
  function fixDPI() {
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
    // keep logical size consistent with initial attributes (960x540) by scaling
    const targetW = Math.round(cssW * dpr);
    const targetH = Math.round(cssH * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', fixDPI);

  // --- Util
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  };

  function setMsg(html) {
    msgEl.innerHTML = html || '';
  }

  // --- Sound (WebAudio; starts on first user gesture)
  const MUTE_KEY = 'rocket-comet-run:muted';
  const sfx = {
    ctx: null,
    master: null,
    muted: localStorage.getItem(MUTE_KEY) === '1',
    _boostLatch: false,

    init() {
      if (this.ctx) return;
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.45;
      this.master.connect(this.ctx.destination);
    },

    resume() {
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    },

    setMuted(m) {
      this.muted = !!m;
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
      if (this.master) this.master.gain.value = this.muted ? 0 : 0.45;
    },

    tone({ freq = 440, dur = 0.08, type = 'sine', gain = 0.14, slideTo = null }) {
      if (!this.ctx || !this.master || this.muted) return;
      const t0 = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo != null) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(this.master);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    },

    noiseBurst({ dur = 0.12, gain = 0.22 }) {
      if (!this.ctx || !this.master || this.muted) return;
      const t0 = this.ctx.currentTime;
      const sr = this.ctx.sampleRate;
      const len = Math.floor(sr * dur);
      const buf = this.ctx.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(g);
      g.connect(this.master);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    },

    collect() {
      this.tone({ freq: 760, dur: 0.06, type: 'triangle', gain: 0.12, slideTo: 980 });
      this.tone({ freq: 520, dur: 0.07, type: 'sine', gain: 0.08, slideTo: 720 });
    },

    hit() {
      this.noiseBurst({ dur: 0.14, gain: 0.20 });
      this.tone({ freq: 180, dur: 0.10, type: 'sawtooth', gain: 0.10, slideTo: 90 });
    },

    levelUp() {
      this.tone({ freq: 440, dur: 0.08, type: 'square', gain: 0.06, slideTo: 660 });
      this.tone({ freq: 660, dur: 0.10, type: 'square', gain: 0.06, slideTo: 990 });
    },

    boostStart() {
      this.tone({ freq: 220, dur: 0.08, type: 'sawtooth', gain: 0.06, slideTo: 520 });
    },

    // --- Background track (procedural, looping)
    musicGain: null,
    _musicStarted: false,
    _musicTimer: null,
    _musicNext: 0,
    _musicStep: 0,

    _mtof(midi) {
      return 440 * Math.pow(2, (midi - 69) / 12);
    },

    _playNote({ time, midi, dur = 0.12, type = 'sine', gain = 0.05, detune = 0 }) {
      if (!this.ctx || !this.musicGain || this.muted) return;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.detune.value = detune;
      o.frequency.setValueAtTime(this._mtof(midi), time);

      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(gain, time + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);

      o.connect(g);
      g.connect(this.musicGain);
      o.start(time);
      o.stop(time + dur + 0.03);
    },

    _hat({ time, dur = 0.04, gain = 0.02 }) {
      if (!this.ctx || !this.musicGain || this.muted) return;
      const sr = this.ctx.sampleRate;
      const len = Math.floor(sr * dur);
      const buf = this.ctx.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1);

      const src = this.ctx.createBufferSource();
      src.buffer = buf;

      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(5000, time);

      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(gain, time + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);

      src.connect(hp);
      hp.connect(g);
      g.connect(this.musicGain);
      src.start(time);
      src.stop(time + dur + 0.02);
    },

    startMusic() {
      if (!this.ctx || !this.master) return;
      if (this._musicStarted) return;

      // bus for music (so we can balance against SFX)
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.28; // overall music loudness

      // subtle glue
      let node = this.musicGain;
      if (this.ctx.createDynamicsCompressor) {
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -26;
        comp.knee.value = 18;
        comp.ratio.value = 3.5;
        comp.attack.value = 0.01;
        comp.release.value = 0.15;
        node.connect(comp);
        node = comp;
      }
      node.connect(this.master);

      this._musicStarted = true;
      this._musicStep = 0;
      this._musicNext = this.ctx.currentTime + 0.08;

      const tick = () => this._scheduleMusic();
      this._musicTimer = setInterval(tick, 60);
      tick();
    },

    stopMusic() {
      if (this._musicTimer) {
        clearInterval(this._musicTimer);
        this._musicTimer = null;
      }
      this._musicStarted = false;
      this._musicStep = 0;
      this._musicNext = 0;
      if (this.musicGain) {
        try { this.musicGain.disconnect(); } catch {}
      }
      this.musicGain = null;
    },

    _scheduleMusic() {
      if (!this.ctx || !this._musicStarted) return;
      const lookAhead = 0.25;
      const now = this.ctx.currentTime;

      // tempo + 16-step grid
      const bpm = 112;
      const stepDur = (60 / bpm) / 4;

      // D minor-ish space arpeggio
      const bass = [38, 38, 38, 38, 41, 41, 41, 41, 43, 43, 43, 43, 41, 41, 36, 36];
      const lead = [62, 65, 69, 65, 62, 65, 70, 65, 62, 65, 69, 72, 74, 72, 69, 65];
      const hatMask = [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0];

      while (this._musicNext < now + lookAhead) {
        const s = this._musicStep % 16;
        const t = this._musicNext;

        // bass pulse
        if (s % 4 === 0) {
          this._playNote({ time: t, midi: bass[s], dur: stepDur * 1.9, type: 'triangle', gain: 0.040 });
          this._playNote({ time: t, midi: bass[s], dur: stepDur * 1.9, type: 'sine', gain: 0.020, detune: -6 });
        }

        // lead arp
        this._playNote({ time: t, midi: lead[s], dur: stepDur * 0.95, type: 'square', gain: 0.020, detune: 4 });
        if (s % 2 === 0) this._playNote({ time: t, midi: lead[s] + 12, dur: stepDur * 0.6, type: 'sine', gain: 0.010 });

        // hats
        if (hatMask[s]) this._hat({ time: t, dur: 0.03, gain: 0.012 });

        // advance
        this._musicStep += 1;
        this._musicNext += stepDur;
      }
    }
  };

  // --- Input
  const keys = new Set();
  window.addEventListener('keydown', (e) => {
    // ensure audio is allowed
    sfx.init();
    sfx.resume();
    sfx.startMusic();

    const k = e.key;
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(k)) e.preventDefault();
    keys.add(k.toLowerCase());

    if (k.toLowerCase() === 'p') state.paused = !state.paused;
    if (k.toLowerCase() === 'r') restart();
    if (k.toLowerCase() === 'm') {
      sfx.setMuted(!sfx.muted);
      setMsg(sfx.muted ? 'Sound: <b>muted</b> (press M to unmute)' : 'Sound: <b>on</b> (press M to mute)');
    }
  }, { passive: false });

  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

  // stop scheduling when tab is hidden (optional, saves CPU)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) sfx.stopMusic();
  });

  // --- Game state
  const BEST_KEY = 'rocket-comet-run:best';
  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  bestEl.textContent = String(best);

  const W = () => canvas.clientWidth;
  const H = () => canvas.clientHeight;

  const state = {
    t: 0,
    dt: 0,
    last: 0,
    paused: false,
    over: false,
    score: 0,
    health: 3,
    shake: 0,

    // difficulty ramp
    level: 1,
    nextLevelAt: 250,

    // entities
    stars: [],
    comets: [],
    meteors: [],
    meteorites: [],

    // player
    player: {
      x: 160,
      y: 270,
      vx: 0,
      vy: 0,
      r: 16,
      invuln: 0,
      fuel: 1,
      fuelRegen: 0.18, // per sec
      fuelBurn: 0.55,  // per sec while boosting
    },
  };

  // --- Spawners
  function spawnStars() {
    state.stars.length = 0;
    const n = 140;
    for (let i = 0; i < n; i++) {
      state.stars.push({
        x: Math.random() * W(),
        y: Math.random() * H(),
        z: rand(0.2, 1.0),
        tw: rand(0, Math.PI * 2)
      });
    }
  }

  function spawnComet() {
    // tiny gold comet drifting leftwards
    const y = rand(30, H() - 30);
    state.comets.push({
      x: W() + 40,
      y,
      vx: -rand(150, 260) * (0.9 + state.level * 0.08),
      vy: rand(-25, 25),
      r: rand(6, 9),
      tail: rand(18, 30),
      value: randInt(15, 35),
    });
  }

  function spawnMeteor() {
    // large meteor, slower, big hitbox
    const y = rand(60, H() - 60);
    state.meteors.push({
      x: W() + 80,
      y,
      vx: -rand(95, 155) * (0.9 + state.level * 0.06),
      vy: rand(-18, 18),
      r: rand(34, 52),
      rot: rand(0, Math.PI * 2),
      w: rand(-1.4, 1.4),
    });
  }

  function spawnMeteorite() {
    // smaller but faster projectile-like meteorite
    const y = rand(30, H() - 30);
    state.meteorites.push({
      x: W() + 40,
      y,
      vx: -rand(260, 420) * (0.9 + state.level * 0.07),
      vy: rand(-70, 70),
      r: rand(12, 18),
      rot: rand(0, Math.PI * 2),
      w: rand(-3.0, 3.0),
    });
  }

  // --- Collision
  function collideCircle(a, b, pad = 0) {
    const rr = (a.r + b.r + pad);
    return dist2(a.x, a.y, b.x, b.y) <= rr * rr;
  }

  // --- Restart
  function restart() {
    state.t = 0;
    state.last = 0;
    state.paused = false;
    state.over = false;
    state.score = 0;
    state.health = 3;
    state.shake = 0;
    state.level = 1;
    state.nextLevelAt = 250;

    state.comets.length = 0;
    state.meteors.length = 0;
    state.meteorites.length = 0;

    state.player.x = 160;
    state.player.y = H() * 0.5;
    state.player.vx = 0;
    state.player.vy = 0;
    state.player.invuln = 0;
    state.player.fuel = 1;

    scoreEl.textContent = '0';
    healthEl.textContent = '3';
    setMsg('Collect <b>gold comets</b>. Avoid <b>meteors</b>.');
  }

  // --- Update
  function update(dt) {
    state.t += dt;

    // difficulty
    if (state.score >= state.nextLevelAt) {
      state.level += 1;
      state.nextLevelAt = Math.floor(state.nextLevelAt * 1.55);
      state.health = Math.min(5, state.health + 1);
      healthEl.textContent = String(state.health);
      setMsg(`Level <b>${state.level}</b> — more debris incoming.`);
      sfx.levelUp();
    }

    // spawn rates (per second)
    const cometRate = 1.1 + state.level * 0.18;
    const meteorRate = 0.35 + state.level * 0.10;
    const meteoriteRate = 0.45 + state.level * 0.14;

    // poisson spawns
    if (Math.random() < cometRate * dt) spawnComet();
    if (Math.random() < meteorRate * dt) spawnMeteor();
    if (Math.random() < meteoriteRate * dt) spawnMeteorite();

    // player control
    const p = state.player;
    const accel = 720;
    const maxV = 330;
    const drag = 0.88;

    const up = keys.has('arrowup') || keys.has('w');
    const down = keys.has('arrowdown') || keys.has('s');
    const left = keys.has('arrowleft') || keys.has('a');
    const right = keys.has('arrowright') || keys.has('d');
    const boost = keys.has('shift');

    let ax = 0, ay = 0;
    if (up) ay -= 1;
    if (down) ay += 1;
    if (left) ax -= 1;
    if (right) ax += 1;

    // normalize
    const m = Math.hypot(ax, ay) || 1;
    ax /= m; ay /= m;

    let boostMul = 1;
    if (boost && p.fuel > 0.05) {
      if (!sfx._boostLatch) sfx.boostStart();
      sfx._boostLatch = true;
      boostMul = 1.75;
      p.fuel = clamp(p.fuel - p.fuelBurn * dt, 0, 1);
    } else {
      sfx._boostLatch = false;
      p.fuel = clamp(p.fuel + p.fuelRegen * dt, 0, 1);
    }

    p.vx += ax * accel * boostMul * dt;
    p.vy += ay * accel * boostMul * dt;

    // drag and clamp
    p.vx *= Math.pow(drag, dt * 60);
    p.vy *= Math.pow(drag, dt * 60);
    p.vx = clamp(p.vx, -maxV, maxV);
    p.vy = clamp(p.vy, -maxV, maxV);

    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // keep in bounds
    p.x = clamp(p.x, 24, W() - 24);
    p.y = clamp(p.y, 24, H() - 24);

    if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - dt);

    // stars parallax
    for (const s of state.stars) {
      s.tw += dt * (0.8 + s.z * 1.3);
      s.x -= (55 + 210 * s.z) * dt;
      if (s.x < -10) {
        s.x = W() + 10;
        s.y = Math.random() * H();
        s.z = rand(0.2, 1.0);
      }
    }

    // move entities
    const moveEntity = (e) => {
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      if (e.rot != null) e.rot += e.w * dt;
    };

    for (const c of state.comets) moveEntity(c);
    for (const mtr of state.meteors) moveEntity(mtr);
    for (const mt of state.meteorites) moveEntity(mt);

    // cleanup
    const offLeft = (e) => e.x < -120 || e.y < -160 || e.y > H() + 160;
    state.comets = state.comets.filter(e => !offLeft(e));
    state.meteors = state.meteors.filter(e => !offLeft(e));
    state.meteorites = state.meteorites.filter(e => !offLeft(e));

    // collisions: comets (collect)
    for (let i = state.comets.length - 1; i >= 0; i--) {
      const c = state.comets[i];
      if (collideCircle(p, c, -2)) {
        state.comets.splice(i, 1);
        // score
        const gain = c.value;
        state.score += gain;
        scoreEl.textContent = String(state.score);
        state.shake = Math.min(8, state.shake + 1.6);
        sfx.collect();
      }
    }

    // collisions: hazards
    if (p.invuln <= 0) {
      let hit = false;
      for (const mtr of state.meteors) {
        if (collideCircle(p, mtr, -2)) { hit = true; break; }
      }
      if (!hit) {
        for (const mt of state.meteorites) {
          if (collideCircle(p, mt, -2)) { hit = true; break; }
        }
      }

      if (hit) {
        state.health -= 1;
        healthEl.textContent = String(state.health);
        p.invuln = 1.05;
        state.shake = 16;
        sfx.hit();
        // knockback
        p.vx -= 140;
        p.vy += rand(-120, 120);

        if (state.health <= 0) {
          gameOver();
        }
      }
    }

    // tiny score trickle so survival matters a bit
    state.score += dt * (2 + state.level * 0.8);
    scoreEl.textContent = String(Math.floor(state.score));

    // decay shake
    state.shake = Math.max(0, state.shake - dt * 24);
  }

  function gameOver() {
    state.over = true;
    state.paused = false;
    const finalScore = Math.floor(state.score);
    if (finalScore > best) {
      best = finalScore;
      localStorage.setItem(BEST_KEY, String(best));
      bestEl.textContent = String(best);
      setMsg(`Game over. New best: <b>${best}</b>. Press <b>R</b> to restart.`);
    } else {
      setMsg(`Game over. Score: <b>${finalScore}</b>. Press <b>R</b> to restart.`);
    }
  }

  // --- Draw
  function draw() {
    const w = W(), h = H();

    // screen shake
    const sx = state.shake ? rand(-state.shake, state.shake) : 0;
    const sy = state.shake ? rand(-state.shake, state.shake) : 0;

    ctx.save();
    ctx.translate(sx, sy);

    // background
    ctx.clearRect(-50, -50, w + 100, h + 100);

    // nebula haze
    ctx.globalAlpha = 0.22;
    const g = ctx.createRadialGradient(w*0.55, h*0.35, 20, w*0.55, h*0.35, h);
    g.addColorStop(0, 'rgba(90,150,255,0.25)');
    g.addColorStop(0.6, 'rgba(120,70,210,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;

    // stars
    for (const s of state.stars) {
      const tw = 0.55 + 0.45 * Math.sin(s.tw);
      ctx.globalAlpha = tw * (0.35 + s.z * 0.65);
      const r = 0.8 + s.z * 1.7;
      ctx.fillStyle = '#dbe6ff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // comets
    for (const c of state.comets) {
      // tail
      ctx.save();
      const ang = Math.atan2(c.vy, c.vx);
      ctx.translate(c.x, c.y);
      ctx.rotate(ang);
      const tailG = ctx.createLinearGradient(0, 0, -c.tail, 0);
      tailG.addColorStop(0, 'rgba(255,210,74,0.0)');
      tailG.addColorStop(1, 'rgba(255,210,74,0.55)');
      ctx.fillStyle = tailG;
      ctx.beginPath();
      ctx.ellipse(-c.tail*0.5, 0, c.tail*0.55, c.r*0.55, 0, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();

      // core
      ctx.fillStyle = '#ffd24a';
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#fff2b5';
      ctx.beginPath();
      ctx.arc(c.x - 2, c.y - 2, c.r * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // meteors
    for (const m of state.meteors) {
      drawRock(m.x, m.y, m.r, m.rot, '#6b738b', '#3d4256');
    }

    // meteorites
    for (const mt of state.meteorites) {
      drawRock(mt.x, mt.y, mt.r, mt.rot, '#8b5a4a', '#3a2220');
      // heat trail
      const tg = ctx.createLinearGradient(mt.x, mt.y, mt.x + 28, mt.y);
      tg.addColorStop(0, 'rgba(255,84,112,0.0)');
      tg.addColorStop(1, 'rgba(255,84,112,0.35)');
      ctx.strokeStyle = tg;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(mt.x + 2, mt.y);
      ctx.lineTo(mt.x + 26, mt.y);
      ctx.stroke();
    }

    // player
    drawRocket(state.player);

    // overlay UI inside canvas (fuel/boost)
    drawFuel(state.player);

    // pause / over
    if (state.paused) overlayText('PAUSED', 'Press P to resume');
    if (state.over) overlayText('GAME OVER', 'Press R to restart');

    ctx.restore();
  }

  function drawFuel(p) {
    const w = W(), h = H();
    const x = 18, y = h - 18;
    const bw = 180, bh = 10;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    roundRect(x, y - bh, bw, bh, 6);
    ctx.fill();
    ctx.fillStyle = 'rgba(120,200,255,0.85)';
    roundRect(x, y - bh, bw * p.fuel, bh, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('BOOST', x, y - 14);
    ctx.restore();
  }

  function overlayText(title, sub) {
    const w = W(), h = H();
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.textAlign = 'center';
    ctx.font = '700 48px system-ui, sans-serif';
    ctx.fillText(title, w/2, h/2 - 8);
    ctx.globalAlpha = 0.75;
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillText(sub, w/2, h/2 + 24);
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawRocket(p) {
    ctx.save();

    // blink when invulnerable
    if (p.invuln > 0 && Math.floor(p.invuln * 18) % 2 === 0) {
      ctx.globalAlpha = 0.35;
    }

    // direction (points in direction of velocity, otherwise right)
    const ang = Math.atan2(p.vy, p.vx || 1e-6);
    const useAng = (Math.hypot(p.vx, p.vy) > 12) ? ang : 0;

    ctx.translate(p.x, p.y);
    ctx.rotate(useAng);

    // exhaust
    const speed = Math.hypot(p.vx, p.vy);
    const flame = clamp(0.2 + speed / 320, 0.2, 1.0);
    const flameLen = 18 + flame * 18;

    const fg = ctx.createLinearGradient(-p.r - flameLen, 0, -p.r, 0);
    fg.addColorStop(0, 'rgba(255,84,112,0.00)');
    fg.addColorStop(0.4, 'rgba(255,84,112,0.30)');
    fg.addColorStop(1, 'rgba(255,210,74,0.85)');

    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.ellipse(-p.r - flameLen*0.55, 0, flameLen*0.75, 8, 0, 0, Math.PI*2);
    ctx.fill();

    // body
    ctx.fillStyle = '#e9eefc';
    ctx.beginPath();
    ctx.moveTo(p.r + 8, 0);
    ctx.quadraticCurveTo(p.r - 2, -12, -p.r + 2, -10);
    ctx.lineTo(-p.r - 2, 0);
    ctx.lineTo(-p.r + 2, 10);
    ctx.quadraticCurveTo(p.r - 2, 12, p.r + 8, 0);
    ctx.closePath();
    ctx.fill();

    // window
    ctx.fillStyle = '#5ad1ff';
    ctx.globalAlpha *= 0.9;
    ctx.beginPath();
    ctx.arc(6, -2, 5.5, 0, Math.PI*2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // fin
    ctx.fillStyle = '#c8d3ff';
    ctx.beginPath();
    ctx.moveTo(-4, 10);
    ctx.lineTo(-16, 18);
    ctx.lineTo(-8, 6);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawRock(x, y, r, rot, c1, c2) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot || 0);

    // blob polygon
    const pts = 10;
    ctx.beginPath();
    for (let i = 0; i < pts; i++) {
      const a = (i / pts) * Math.PI * 2;
      const rr = r * (0.78 + 0.28 * Math.sin(a*2.3 + r*0.03) + 0.10 * Math.cos(a*3.7));
      const px = Math.cos(a) * rr;
      const py = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();

    const g = ctx.createRadialGradient(-r*0.25, -r*0.25, r*0.2, 0, 0, r*1.2);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    ctx.fillStyle = g;
    ctx.fill();

    // crater specks
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = 'black';
    for (let i = 0; i < 6; i++) {
      const cx = rand(-r*0.55, r*0.55);
      const cy = rand(-r*0.55, r*0.55);
      const cr = rand(2, Math.max(3, r*0.12));
      ctx.beginPath();
      ctx.arc(cx, cy, cr, 0, Math.PI*2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  // --- Loop
  function loop(ts) {
    fixDPI();

    if (!state.last) state.last = ts;
    const dt = Math.min(0.033, (ts - state.last) / 1000);
    state.last = ts;

    if (!state.over && !state.paused) update(dt);
    draw();

    requestAnimationFrame(loop);
  }

  // --- Boot
  spawnStars();
  restart();
  requestAnimationFrame(loop);
})();
