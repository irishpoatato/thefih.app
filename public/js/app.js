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

    replies:    $('replies'),
    repliesCancel: $('replies-cancel'),

    sheet:      $('sheet'),
    statsTab:   $('btn-stats'),
    closeSheet: $('btn-close-sheet'),
    share:      $('btn-share'),

    toast:      $('toast'),
    catcher:    $('tap-catcher'),
    gate:       $('gate')
  };

  /* The iOS lock screen shown when the browser blocks autoplay: it turns the
   * tap the browser demands into a ringing phone.
   *
   * Currently OFF — we land straight on the call, which is the joke. The cost
   * is that a first-time visitor on a browser that blocks autoplay (most
   * phones) probably misses ring one: the pointerdown retry at the bottom of
   * this file unlocks audio on their first tap, and fih calls back within
   * ~2.6s regardless.
   *
   * Set to true to bring the lock screen back. Nothing else needs to change. */
  var USE_LOCK_GATE = false;

  /* Autoplay bugs in this app are invisible on a desktop that allows autoplay,
   * which is how two of them shipped. Load with ?blocked=1 to force the
   * autoplay-blocked path and see what a phone sees. */
  var FORCE_BLOCKED = /[?&]blocked=1/.test(location.search);

  var state = {
    declines: 0,          // this session
    phase: 'incoming',
    callStart: 0,
    tickTimer: null,
    backTimer: null,
    toastTimer: null
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

  function renderIncoming() {
    var d = state.declines;

    el.callerName.textContent = 'fih';
    el.callerSub.textContent =
      d === 0 ? 'calling...' :
      d < 4   ? 'calling...' :
      d < 9   ? 'calling... (' + d + ')' :
                'still calling...';

    el.flavor.textContent = d < FLAVOR.length ? FLAVOR[d] : pick(LATE_FLAVOR);

    if (d >= 6) makeSlippery();
  }

  function startIncoming() {
    show('incoming');
    renderIncoming();
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

    goMissed('Call Ended', 'fih — ' + clock(sec), 2600);   // he calls back. obviously.
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

  /* Browsers will not make a sound until the user has interacted. Rather than
   * asking for that interaction with a lock screen, put an invisible sheet over
   * the live call screen and take the first tap wherever it lands.
   *
   * It must swallow the click as well as the pointerdown: they come from the
   * same tap, and if the click gets through, a tap aimed at Accept both starts
   * the ringtone and immediately answers the call. Hence the linger before it
   * hides — the pointerdown starts the audio at once, and the sheet stays put
   * just long enough to absorb the click that follows it. */
  function catcherOpen() {
    el.catcher.hidden = false;

    var done = false;
    var swallow = function (e) { e.preventDefault(); e.stopPropagation(); };

    var fire = function (e) {
      if (done) return;
      done = true;
      swallow(e);
      begin();                       // unlock, then ring
      setTimeout(function () { el.catcher.hidden = true; }, 400);
    };

    el.catcher.addEventListener('pointerdown', fire);
    el.catcher.addEventListener('click', swallow);
    document.addEventListener('keydown', function onKey(e) {
      document.removeEventListener('keydown', onKey);
      fire(e);
    });
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
  renderIncoming();

  window.FihSound.prime();          // fetch + decode the ringtone up front

  window.FihSound.tryAuto().then(function (ok) {
    if (ok && !FORCE_BLOCKED) { begin(); return; }   // autoplay allowed: it just rings
    if (USE_LOCK_GATE) { gateOpen(); return; } // blocked: one tap on a lock screen
    catcherOpen();                             // blocked: take the first tap invisibly
  });

  document.addEventListener('pointerdown', function retry() {
    if (window.FihSound.isUnlocked) { document.removeEventListener('pointerdown', retry); return; }
    window.FihSound.unlock().then(function (ok) {
      if (ok && state.phase === 'incoming') startIncoming();
    });
  });

  // do not ring into an empty room
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopIncoming();
    else if (state.phase === 'incoming' && el.gate.hidden) startIncoming();
  });

})();
