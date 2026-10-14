/*
 * app.js — fih is calling.
 *
 * one screen, two buttons. decline and he calls back. answer and nothing
 * happens at all, for as long as you let it.
 */

(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    phone:      $('phone'),
    incoming:   $('screen-incoming'),
    missed:     $('screen-missed'),
    call:       $('screen-call'),

    clock:      $('clock'),
    lockTime:   $('lock-time'),
    lockDate:   $('lock-date'),
    gateTime:   $('gate-time'),
    gateDate:   $('gate-date'),

    callerName: $('caller-name'),
    callerSub:  $('caller-sub'),
    flavor:     $('flavor'),

    notifTitle: $('notif-title'),
    notifSub:   $('notif-sub'),

    decline:    $('btn-decline'),
    accept:     $('btn-accept'),
    remind:     $('btn-remind'),
    message:    $('btn-message'),
    hangup:     $('btn-hangup'),

    timer:      $('timer'),
    best:       $('best'),
    callName:   $('call-name'),

    replies:    $('replies'),
    repliesCancel: $('replies-cancel'),

    sheet:      $('sheet'),
    statsTab:   $('btn-stats'),
    closeSheet: $('btn-close-sheet'),
    share:      $('btn-share'),

    toast:      $('toast'),
    splash:     $('splash'),
    splashBtn:  $('splash-enter'),
    gate:       $('gate')
  };

  /* Legacy iOS lock screen, superseded by the entry splash — the splash now
   * supplies the gesture browsers require, and does it visibly. Set this true
   * to use the old lock screen instead; the splash is then skipped entirely. */
  var USE_LOCK_GATE = false;

  var state = {
    declines: 0,          // this session
    phase: 'incoming',
    callStart: 0,
    tickTimer: null,
    backTimer: null,
    toastTimer: null,
    variant: null,
    bestSec: 0        // cached so the in-call best can be written synchronously
  };

  /* ── copy ───────────────────────────────────────────────────────── */

  var FLAVOR = [
    '',
    'he called back.',
    'fih is calling again',
    'he knows you are home',
    'pick up. it is fih.',
    'fih has been holding for a while now',
    'you have declined fih five times.\nhe has not stopped.',
    'the phone is warm',
    'fih is calling from a landline\nunderwater',
    'answer him',
    'this is the tenth time',
    'fih does not sleep',
    'somewhere, a phone is ringing.\nit is this one.',
    'fih is calling. fih is calling.\nfih is calling.',
    'you cannot outlast a fih',
    'fih PLS get up',
    'fih?'
  ];

  var LATE_FLAVOR = [
    'fih is still calling',
    'he has nowhere else to be',
    'it is only fih',
    'you and fih. forever.',
    'the calls are the point',
    'fih. fih. fih.',
    'hif'
  ];

  var DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var MONTHS = ['January','February','March','April','May','June','July','August',
                'September','October','November','December'];


  /* ── rare fih ──────────────────────────────────────────────────────
     Each call rolls one. Every variant is the same fih.png under a CSS filter
     or transform -- no extra artwork and nothing more to download.

     Weights are out of 1003, so plain fih lands ~88% of the time and gold is
     about 1 in 1000. Rare enough that meeting one feels like something; the
     Recents sheet tracks which you have met.

     Load with ?fih=<id> to force one (e.g. ?fih=gold) -- rolling for gold a
     thousand times to check a filter is not a good use of anyone's evening. */

  var VARIANTS = [
    { id: 'fih',     name: 'fih',                  cls: '',          weight: 880 },
    { id: 'hif',     name: 'hif',                  cls: 'v-hif',     weight: 35  },
    { id: 'big',     name: 'big fih',              cls: 'v-big',     weight: 25  },
    { id: 'smol',    name: 'smol fih',             cls: 'v-smol',    weight: 25  },
    { id: 'old',     name: 'old fih',              cls: 'v-old',     weight: 15  },
    { id: 'shout',   name: 'FIH',                  cls: 'v-shout',   weight: 10  },
    { id: 'blue',    name: 'blue fih',             cls: 'v-blue',    weight: 5   },
    { id: 'unknown', name: 'fih (unknown number)', cls: 'v-unknown', weight: 4   },
    { id: 'ghost',   name: 'fih?',                 cls: 'v-ghost',   weight: 3   },
    { id: 'gold',    name: 'gold fih',             cls: 'v-gold',    weight: 1   }
  ];

  var FORCED = (function () {
    var m = /[?&]fih=([a-z]+)/.exec(location.search);
    if (!m) return null;
    for (var i = 0; i < VARIANTS.length; i++) if (VARIANTS[i].id === m[1]) return VARIANTS[i];
    return null;
  })();

  function rollVariant() {
    if (FORCED) return FORCED;
    var total = 0, i;
    for (i = 0; i < VARIANTS.length; i++) total += VARIANTS[i].weight;
    var n = Math.random() * total;
    for (i = 0; i < VARIANTS.length; i++) {
      n -= VARIANTS[i].weight;
      if (n <= 0) return VARIANTS[i];
    }
    return VARIANTS[0];
  }

  var VARIANT_CLASSES = VARIANTS.map(function (v) { return v.cls; })
                                .filter(function (c) { return c; });

  function paintVariant(v) {
    Array.prototype.forEach.call(document.querySelectorAll('.fih-art'), function (img) {
      for (var i = 0; i < VARIANT_CLASSES.length; i++) img.classList.remove(VARIANT_CLASSES[i]);
      if (v.cls) img.classList.add(v.cls);
    });
  }

  /* ── helpers ────────────────────────────────────────────────────── */

  var SCREENS = { incoming: el.incoming, missed: el.missed, call: el.call };

  function show(name) {
    [el.incoming, el.missed, el.call].forEach(function (s) { s.classList.remove('is-active'); });
    SCREENS[name].classList.add('is-active');
    state.phase = name;
  }

  function clock(sec) {
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return (h ? h + ':' : '') + pad(m) + ':' + pad(s);
  }

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  /* the real time, iOS status-bar style: h:mm, no leading zero, no meridiem */
  function paintTime() {
    var d = new Date();
    var h = d.getHours() % 12; if (h === 0) h = 12;
    var m = d.getMinutes();
    var t = h + ':' + (m < 10 ? '0' + m : m);
    var date = DAYS[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate();

    el.clock.textContent = t;
    if (el.lockTime) el.lockTime.textContent = t;
    if (el.gateTime) el.gateTime.textContent = t;
    if (el.lockDate) el.lockDate.textContent = date;
    if (el.gateDate) el.gateDate.textContent = date;
  }

  function toast(text) {
    el.toast.textContent = text;
    el.toast.hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () { el.toast.hidden = true; }, 1900);
  }

  /* ── incoming ───────────────────────────────────────────────────── */

  function renderIncoming(announce) {
    var d = state.declines;
    var v = rollVariant();
    state.variant = v;
    paintVariant(v);

    el.callerName.textContent = v.name;
    el.callerSub.textContent =
      d === 0 ? 'calling...' :
      d < 4   ? 'calling...' :
      d < 9   ? 'calling... (' + d + ')' :
                'still calling...';

    el.flavor.textContent = d < FLAVOR.length ? FLAVOR[d] : pick(LATE_FLAVOR);

    // meeting one for the first time earns its own line, in place of the
    // escalation copy -- otherwise a rare slides past unremarked
    if (announce && v.id !== 'fih') {
      window.FihCounter.markSeen(v.id).then(function (isNew) {
        if (isNew && state.variant === v) {
          el.flavor.textContent = 'you have not seen this fih before';
        }
      });
    }

    if (d >= 6) makeSlippery();
  }

  function startIncoming() {
    show('incoming');
    renderIncoming(true);        // a call that actually rings: this one counts
    window.FihSound.startRing();
  }

  function stopIncoming() {
    window.FihSound.stopRing();
  }

  function goMissed(title, sub, wait) {
    el.notifTitle.textContent = title;
    el.notifSub.textContent = sub;
    paintTime();
    show('missed');
    clearTimeout(state.backTimer);
    state.backTimer = setTimeout(startIncoming, wait);
  }

  function onDecline() {
    if (state.phase !== 'incoming') return;
    stopIncoming();

    state.declines += 1;
    window.FihCounter.bump('declines');

    // he calls back faster every time
    var wait = Math.max(900, 2600 - state.declines * 150);
    goMissed('Missed Call', 'fih' + (state.declines > 1 ? ' (' + state.declines + ')' : ''), wait);
  }

  function onRemind() {
    if (state.phase !== 'incoming') return;
    stopIncoming();
    window.FihSound.tap();

    state.declines += 1;
    window.FihCounter.bump('declines');

    toast('Reminder set');
    goMissed('Reminder', 'fih — in 1 hour', 1400);   // it is not going to be an hour
  }

  function onMessage() {
    if (state.phase !== 'incoming') return;
    window.FihSound.tap();
    el.replies.hidden = false;
  }

  function sendReply(text) {
    el.replies.hidden = true;
    if (state.phase !== 'incoming') return;
    stopIncoming();

    state.declines += 1;
    window.FihCounter.bump('declines');

    toast(text === 'Custom…' ? 'you typed fih' : 'sent: ' + text);
    goMissed('Message sent', 'he is calling anyway', 1600);
  }

  /* the decline button gradually loses its nerve. mouse only — on touch there
     is no hover, so dodging would just be unfair. */
  var slippery = false;

  function makeSlippery() {
    if (slippery || !window.matchMedia('(pointer:fine)').matches) return;
    slippery = true;
    el.decline.classList.add('slippery');

    el.phone.addEventListener('mousemove', function (e) {
      if (state.phase !== 'incoming') return;

      var r = el.decline.getBoundingClientRect();
      var dx = (r.left + r.width / 2) - e.clientX;
      var dy = (r.top + r.height / 2) - e.clientY;
      var dist = Math.hypot(dx, dy) || 1;
      var reach = 115;

      if (dist < reach) {
        var push = (reach - dist) / reach;
        var max = Math.min(42, 8 + state.declines * 3);   // capped: still catchable
        el.decline.style.transform =
          'translate(' + (dx / dist * push * max).toFixed(1) + 'px,' +
                         (dy / dist * push * max * 0.5).toFixed(1) + 'px)';
      } else {
        el.decline.style.transform = '';
      }
    });
  }

  /* ── in call ────────────────────────────────────────────────────── */
  /* nothing happens here on purpose: no sound, no text, just the timer. */

  function onAccept() {
    if (state.phase !== 'incoming') return;

    clearTimeout(state.backTimer);
    stopIncoming();
    window.FihCounter.bump('answers');

    el.decline.style.transform = '';
    state.callStart = Date.now();
    el.timer.textContent = '00:00';

    if (state.variant) el.callName.textContent = state.variant.name;

    /* The record to beat, written BEFORE the screen is shown and never touched
       again while the call runs. The call stays as silent and motionless as
       it was -- nothing appears partway through, which is why this is a cached
       value rather than an async read. */
    if (state.bestSec > 0) {
      el.best.textContent = 'longest so far ' + clock(state.bestSec);
      el.best.hidden = false;
    } else {
      el.best.hidden = true;
    }

    show('call');

    clearInterval(state.tickTimer);
    state.tickTimer = setInterval(tick, 250);
  }

  function tick() {
    var text = clock((Date.now() - state.callStart) / 1000);
    if (text !== el.timer.textContent) el.timer.textContent = text;
  }

  function onHangup() {
    if (state.phase !== 'call') return;

    var sec = Math.floor((Date.now() - state.callStart) / 1000);
    clearInterval(state.tickTimer);
    window.FihSound.hangup();

    window.FihCounter.bump('talktime', sec);
    window.FihCounter.best('longest', sec);

    var record = sec > state.bestSec && sec > 0;
    if (sec > state.bestSec) state.bestSec = sec;

    var who = state.variant ? state.variant.name : 'fih';
    goMissed(record ? 'Longest call yet' : 'Call Ended',
             who + ' — ' + clock(sec), 2600);   // he calls back. obviously.
  }

  /* ── call log ───────────────────────────────────────────────────── */

  function openSheet() {
    window.FihSound.tap();
    Promise.all([window.FihCounter.local(), window.FihCounter.global()])
      .then(function (r) {
        var s = r[0], g = r[1];
        $('s-declines').textContent = s.declines;
        $('s-answers').textContent  = s.answers;
        $('s-longest').textContent  = clock(s.longest);
        $('s-total').textContent    = clock(s.talktime);
        $('s-global').textContent   = (g == null) ? '—' : g.toLocaleString();
        el.sheet.hidden = false;
      });
    window.FihCounter.seen().then(function (ids) {
      $('s-seen').textContent = ids.length + ' / ' + (VARIANTS.length - 1);
      });
  }

  function shareStats() {
    window.FihCounter.local().then(function (s) {
      var text =
        'fih called me ' + (s.declines + s.answers) + ' times.\n' +
        'i declined ' + s.declines + '.\n' +
        'longest call: ' + clock(s.longest) + '\n\n' +
        'fih.app';

      var done = function () {
        el.share.textContent = 'Copied';
        setTimeout(function () { el.share.textContent = 'Copy my fih stats'; }, 1600);
      };

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
      } else {
        fallbackCopy(text, done);
      }
    });
  }

  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* oh well */ }
    document.body.removeChild(ta);
  }

  /* ── art: falls back to nothing rather than a broken-image icon ─── */

  Array.prototype.forEach.call(document.querySelectorAll('.fih-art'), function (img) {
    img.addEventListener('error', function () { img.hidden = true; });
    if (img.complete && img.naturalWidth === 0) img.hidden = true;
  });

  /* ── wiring ─────────────────────────────────────────────────────── */

  el.decline.addEventListener('click', onDecline);
  el.accept.addEventListener('click', onAccept);
  el.remind.addEventListener('click', onRemind);
  el.message.addEventListener('click', onMessage);
  el.hangup.addEventListener('click', onHangup);

  el.repliesCancel.addEventListener('click', function () {
    window.FihSound.tap();
    el.replies.hidden = true;
  });
  Array.prototype.forEach.call(document.querySelectorAll('.reply:not(.cancel)'), function (b) {
    b.addEventListener('click', function () { window.FihSound.tap(); sendReply(b.textContent); });
  });

  Array.prototype.forEach.call(document.querySelectorAll('.pad'), function (b) {
    b.addEventListener('click', function () {
      window.FihSound.tap();
      toast(b.getAttribute('data-toast'));
    });
  });

  el.statsTab.addEventListener('click', openSheet);
  el.closeSheet.addEventListener('click', function () {
    window.FihSound.tap();
    el.sheet.hidden = true;
  });
  el.share.addEventListener('click', shareStats);

  /* ── audio: automatic if the browser allows, one tap if it does not ── */

  function begin() {
    el.gate.hidden = true;
    // unlock() is async: starting the ring before it settles rings into a
    // still-suspended context, which is silent
    window.FihSound.unlock().then(function () {
      if (state.phase === 'incoming') startIncoming();
    });
  }

  /* The splash is the gesture. Browsers require one before they will play
   * audio, so instead of hiding that behind an invisible tap-catcher -- which
   * swallowed a tap the visitor had aimed at something else -- the button is
   * the thing they came to press. One deliberate interaction, no dead taps.
   *
   * unlock() is async: the ring has to wait for the AudioContext to actually
   * reach 'running', or it rings into a suspended context and is silent. The
   * fade starts immediately so the UI does not wait on it. */
  function enterFromSplash() {
    if (el.splash.hidden) return;

    window.FihSound.unlock().then(function () {
      if (state.phase === 'incoming') startIncoming();
    });

    el.splash.classList.add('leaving');
    setTimeout(function () { el.splash.hidden = true; }, 300);
  }

  function gateOpen() {
    el.gate.hidden = false;
    var open = function () {
      el.gate.removeEventListener('pointerdown', open);
      document.removeEventListener('keydown', open);
      begin();
    };
    el.gate.addEventListener('pointerdown', open);
    document.addEventListener('keydown', open);
  }

  paintTime();
  setInterval(paintTime, 10000);
  show('incoming');
  renderIncoming(false);         // painted behind the splash; no fih met yet

  window.FihCounter.local().then(function (st) { state.bestSec = st.longest || 0; });

  // Decode the ringtone while the splash is up, so the first ring is instant.
  window.FihSound.prime();

  el.splashBtn.addEventListener('click', enterFromSplash);

  if (USE_LOCK_GATE) {              // legacy alternative, off by default
    el.splash.hidden = true;
    window.FihSound.tryAuto().then(function (ok) { ok ? begin() : gateOpen(); });
  }

  document.addEventListener('pointerdown', function retry() {
    if (!el.splash.hidden) return;                 // the splash button owns the first gesture
    if (window.FihSound.isUnlocked) { document.removeEventListener('pointerdown', retry); return; }
    window.FihSound.unlock().then(function (ok) {
      if (ok && state.phase === 'incoming') startIncoming();
    });
  });

  // do not ring into an empty room
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopIncoming();
    else if (state.phase === 'incoming' && el.gate.hidden && el.splash.hidden) startIncoming();
  });

})();
