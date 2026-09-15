/*
 * audio.js — call sounds.
 *
 * The ringtone is assets/call_sound.mp3. It is fetched and decoded into an
 * AudioBuffer rather than played through an <audio> element, because
 * HTMLAudioElement.play() is a promise that browsers reject or stall on the
 * first call often enough to drop the very first ring. An AudioBufferSourceNode
 * starts sample-accurately the moment the context is running.
 *
 * If the file has not finished decoding when the phone starts ringing, a
 * synthesised bell phrase covers the gap and hands over as soon as the buffer
 * is ready — so the first call always makes a sound.
 */

(function (global) {
  'use strict';

  var RINGTONE = 'assets/call_sound.mp3';

  var ctx = null, master = null, verb = null, dry = null;
  var ringBuffer = null;      // decoded call_sound.mp3
  var pendingBytes = null;    // fetched before the context existed
  var decodeFailed = false;
  var decodePromise = null;
  var ringPeak = 1;           // measured peak of the decoded ringtone
  var ringGain = 1;           // makeup gain applied so a quiet file is audible

  var TARGET_PEAK = 0.7;      // where we want the loudest sample to land
  var MAX_MAKEUP  = 40;       // do not amplify a silent file into pure hiss

  /* call_sound.mp3 as supplied peaks at 0.0166 (-36 dBFS) — correct playback of
     it is inaudible. Rather than hard-coding a fudge factor, measure whatever
     file is present and bring it up to a sane level. */
  function measure(buf) {
    var peak = 0;
    for (var c = 0; c < buf.numberOfChannels; c++) {
      var d = buf.getChannelData(c);
      for (var i = 0; i < d.length; i += 8) {   // stride: plenty accurate, much faster
        var a = d[i] < 0 ? -d[i] : d[i];
        if (a > peak) peak = a;
      }
    }
    ringPeak = peak;
    ringGain = peak > 0.0001 ? Math.min(MAX_MAKEUP, TARGET_PEAK / peak) : 1;
  }

  var source = null;          // current looping ringtone node
  var synthTimer = null;      // fallback phrase scheduler
  var buzzTimer = null;
  var voices = [];
  var ringToken = 0;          // guards async handovers
  var ringing = false;
  var unlocked = false;
  var gestured = false;       // vibrate() is refused (and logged) before a tap

  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
    global.addEventListener(ev, function () { gestured = true; }, { once: true, capture: true });
  });

  function vibrate(pattern) {
    if (!gestured || !navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch (e) {}
  }

  /* ── fetch the ringtone immediately, decode when we have a context ── */

  var fetched = fetch(RINGTONE)
    .then(function (r) {
      if (!r.ok) throw new Error('ringtone ' + r.status);
      return r.arrayBuffer();
    })
    .then(function (buf) { pendingBytes = buf; return buf; })
    .catch(function () { decodeFailed = true; });

  /* Decoding must be idempotent: ensure() kicks it off and prime()/startRing()
     both await it. Handing back a fresh Promise.resolve(ringBuffer) while a
     decode was still in flight is what made the first ring stick on the
     fallback synth and never hand over. */
  function decodeIfNeeded() {
    if (ringBuffer)    return Promise.resolve(ringBuffer);
    if (decodeFailed)  return Promise.resolve(null);
    if (decodePromise) return decodePromise;
    if (!ctx || !pendingBytes) return Promise.resolve(null);

    var bytes = pendingBytes;
    pendingBytes = null;
    decodePromise = new Promise(function (resolve) {
      // callback form: Safari still does not return a promise here
      ctx.decodeAudioData(bytes, function (buf) {
        ringBuffer = buf; measure(buf); resolve(buf);
      }, function () {
        decodeFailed = true; resolve(null);
      });
    });
    return decodePromise;
  }

  /* resolves once the ringtone is playable, or null if it never will be */
  function ringtoneReady() {
    return fetched.then(function () {
      ensure();                 // a context has to exist before we can decode
      return decodeIfNeeded();
    });
  }

  /* ── graph ─────────────────────────────────────────────────────── */

  function impulse(seconds, decay) {
    var n = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return buf;
  }

  function ensure() {
    if (!ctx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();

      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);

      dry = ctx.createGain();
      dry.gain.value = 1;
      dry.connect(master);

      var conv = ctx.createConvolver();
      conv.buffer = impulse(1.9, 3.2);
      verb = ctx.createGain();
      verb.gain.value = 0.3;
      verb.connect(conv);
      conv.connect(master);

      decodeIfNeeded();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function out(node) { node.connect(dry); node.connect(verb); }

  /* ── fallback bell phrase (only until the mp3 is decoded) ──────── */

  function bell(freq, at, dur, vol) {
    if (!ctx) return;
    var t = ctx.currentTime + at + 0.02;
    var car = ctx.createOscillator(), mod = ctx.createOscillator();
    var mg = ctx.createGain(), amp = ctx.createGain(), lp = ctx.createBiquadFilter();

    car.type = 'sine'; car.frequency.value = freq;
    mod.type = 'sine'; mod.frequency.value = freq * 3.5;

    mg.gain.setValueAtTime(freq * 2.4, t);
    mg.gain.exponentialRampToValueAtTime(freq * 0.02, t + Math.min(0.28, dur));
    mod.connect(mg); mg.connect(car.frequency);

    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(5200, t);
    lp.frequency.exponentialRampToValueAtTime(1400, t + dur);

    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    car.connect(lp); lp.connect(amp); out(amp);
    mod.start(t); car.start(t);
    mod.stop(t + dur + 0.05); car.stop(t + dur + 0.05);
    voices.push(car, mod);
    if (voices.length > 48) voices.splice(0, 24);
  }

  var PHRASE = [[440,0,.22],[659.25,.3,.22],[880,.6,.22],[1108.73,.9,.26],
                [880,1.2,.2],[659.25,1.5,.2],[554.37,1.8,.18],[440,2.1,.18]];

  function phrase() {
    for (var i = 0; i < PHRASE.length; i++) bell(PHRASE[i][0], PHRASE[i][1], 1.5, PHRASE[i][2]);
  }

  function startSynth() {
    stopSynth();
    phrase();
    synthTimer = setInterval(phrase, 3900);
  }

  function stopSynth() {
    if (synthTimer) { clearInterval(synthTimer); synthTimer = null; }
    for (var i = 0; i < voices.length; i++) { try { voices[i].stop(); } catch (e) {} }
    voices.length = 0;
  }

  /* ── ringtone playback ─────────────────────────────────────────── */

  function playBuffer() {
    if (!ctx || !ringBuffer) return false;
    stopBuffer();
    source = ctx.createBufferSource();
    source.buffer = ringBuffer;
    source.loop = true;
    var g = ctx.createGain();
    g.gain.value = ringGain;
    source.connect(g);
    g.connect(master);
    try { source.start(ctx.currentTime + 0.01); } catch (e) { return false; }
    return true;
  }

  function stopBuffer() {
    if (source) {
      try { source.stop(); } catch (e) {}
      try { source.disconnect(); } catch (e) {}
      source = null;
    }
  }

  function startBuzz() {
    var fire = function () { vibrate([600, 900, 600, 2200]); };
    fire();
    clearInterval(buzzTimer);
    buzzTimer = setInterval(fire, 4300);
  }

  function stopBuzz() {
    clearInterval(buzzTimer);
    buzzTimer = null;
    vibrate(0);
  }

  /* generic telephony blip, for the end-call tone and UI taps */
  function tone(freq, at, dur, vol, type) {
    if (!ctx) return;
    var t = ctx.currentTime + at + 0.01;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.setValueAtTime(vol, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dry);
    o.start(t); o.stop(t + dur + 0.03);
  }

  /* ── public ────────────────────────────────────────────────────── */

  var Sound = {
    /* Start audio with no gesture. Resolves true if the browser allowed it.
     *
     * Chrome does NOT reject resume() when autoplay is blocked — it leaves the
     * promise pending indefinitely, waiting for a gesture that may never come.
     * Waiting on it alone means the caller never learns it was blocked and
     * never falls back, which is silence with no way out. So race it. */
    tryAuto: function () {
      var c = ensure();
      if (!c) return Promise.resolve(false);
      if (c.state === 'running') { unlocked = true; return Promise.resolve(true); }

      return new Promise(function (resolve) {
        var settled = false;
        var finish = function () {
          if (settled) return;
          settled = true;
          unlocked = (c.state === 'running');
          resolve(unlocked);
        };
        setTimeout(finish, 300);          // treat "still pending" as blocked
        c.resume().then(finish, finish);
      });
    },

    /* Call after a real gesture. resume() is async, so the state has to be
     * read in the callback — reading it synchronously always reports the old
     * 'suspended' and leaves the ringtone permanently gated off. */
    unlock: function () {
      var c = ensure();
      if (!c) return Promise.resolve(false);
      return c.resume().then(function () {
        unlocked = (c.state === 'running');
        return unlocked;
      }, function () {
        unlocked = (c.state === 'running');
        return unlocked;
      });
    },

    get isUnlocked() { return unlocked; },

    /* read-only view of what the ringtone is actually doing, for debugging
       autoplay and decode problems in the wild */
    get status() {
      return {
        unlocked: unlocked,
        ringing: ringing,
        buffered: !!ringBuffer,      // call_sound.mp3 decoded and ready
        playing: !!source,           // the mp3 is the thing you can hear
        synth: !!synthTimer,         // the fallback phrase is covering a gap
        decodeFailed: decodeFailed,
        contextState: ctx ? ctx.state : 'none',
        ringPeak: +ringPeak.toFixed(4),      // how loud the source file actually is
        ringGain: +ringGain.toFixed(2)       // makeup applied to reach a usable level
      };
    },

    /* preload without starting anything, so the first ring is never late */
    prime: function () { return ringtoneReady(); },

    startRing: function () {
      Sound.stopRing();
      if (!unlocked) return;

      ringing = true;
      var token = ++ringToken;
      startBuzz();

      if (ringBuffer) { playBuffer(); return; }

      // Not decoded yet. Give it a short grace period so the common case is
      // the mp3 alone with no audible seam; if it misses that window, the
      // synth covers so the first ring is never silent, and hands over.
      var bridged = false;
      var bridge = setTimeout(function () {
        if (!ringing || token !== ringToken) return;
        bridged = true;
        startSynth();
      }, 350);

      ringtoneReady().then(function (buf) {
        clearTimeout(bridge);
        if (!ringing || token !== ringToken) return;   // stopped, or a newer ring won
        if (!buf) { if (!bridged) startSynth(); return; }   // file unusable: synth it is
        stopSynth();
        playBuffer();
      });
    },

    stopRing: function () {
      ringing = false;
      ringToken++;          // invalidates any in-flight handover
      stopBuffer();
      stopSynth();
      stopBuzz();
    },

    /* iOS "call ended": two quick descending tones */
    hangup: function () {
      if (!unlocked) return;
      tone(680, 0, 0.11, 0.16);
      tone(510, 0.13, 0.16, 0.16);
      vibrate(30);
    },

    /* UI tap */
    tap: function () {
      if (!unlocked) return;
      tone(1500, 0, 0.035, 0.06, 'triangle');
      vibrate(12);
    }
  };

  global.FihSound = Sound;

})(window);
