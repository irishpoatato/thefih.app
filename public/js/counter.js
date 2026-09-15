/*
 * counter.js — all persistent numbers live behind this one interface.
 *
 * Today it's LocalStore (browser-only, no server).
 * To go global later: implement the same 4 methods against your backend and
 * swap the line at the bottom. Nothing else in the app needs to change.
 *
 *   async bump(event, amount)  -> void      // record something happening
 *   async local()              -> stats     // this visitor's numbers
 *   async global()             -> n | null  // worldwide declines, null if unknown
 *   async best(key, value)     -> void      // keep a high-water mark
 *
 * EVENTS: 'declines' | 'answers' | 'talktime' (seconds)  — these match the stat keys
 */

(function (global) {
  'use strict';

  var KEY = 'fih.stats.v1';

  var EMPTY = {
    declines: 0,
    answers: 0,
    talktime: 0,   // total seconds spent on the phone with fih
    longest: 0     // longest single call, seconds
  };

  var KEYS = ['declines', 'answers', 'talktime', 'longest'];
  var MAX  = 1e9;   // ~31 years of seconds; anything past this is junk data

  /* Anything stored is attacker- or accident-controllable (shared machine,
     devtools, a future bug). Coerce every stat back to a sane non-negative
     integer on the way in: without this, one non-number wedges bump()'s
     `typeof === 'number'` guard and that counter silently never moves again. */
  function sane(s) {
    for (var i = 0; i < KEYS.length; i++) {
      var n = +s[KEYS[i]];
      s[KEYS[i]] = (isFinite(n) && n >= 0) ? Math.min(Math.floor(n), MAX) : 0;
    }
    return s;
  }

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return Object.assign({}, EMPTY);
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return Object.assign({}, EMPTY);
      return sane(Object.assign({}, EMPTY, parsed));
    } catch (e) {
      return Object.assign({}, EMPTY);
    }
  }

  function write(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* private mode, whatever */ }
  }

  var LocalStore = {
    bump: function (event, amount) {
      if (KEYS.indexOf(event) === -1) return Promise.resolve();
      var n = (amount == null) ? 1 : +amount;
      if (!isFinite(n) || n < 0) return Promise.resolve();
      var s = read();
      s[event] = Math.min(s[event] + Math.floor(n), MAX);
      write(s);
      return Promise.resolve();
    },

    local: function () {
      return Promise.resolve(read());
    },

    global: function () {
      // no backend yet. the UI renders an em-dash for null.
      return Promise.resolve(null);
    },

    best: function (key, value) {
      if (KEYS.indexOf(key) === -1) return Promise.resolve();
      var n = +value;
      if (!isFinite(n) || n < 0) return Promise.resolve();
      var s = read();
      if (n > s[key]) { s[key] = Math.min(Math.floor(n), MAX); write(s); }
      return Promise.resolve();
    }
  };

  /*
   * ── DROP-IN REPLACEMENT SKETCH ──────────────────────────────────────
   * Wraps LocalStore so the app still works offline, and additionally
   * reports to / reads from a server. Fill in ENDPOINT and uncomment the
   * swap on the last line of this file.
   *
   * var ENDPOINT = 'https://api.fih.app';
   *
   * var RemoteStore = {
   *   bump: function (event, amount) {
   *     LocalStore.bump(event, amount);
   *     return fetch(ENDPOINT + '/bump', {
   *       method: 'POST',
   *       headers: { 'content-type': 'application/json' },
   *       body: JSON.stringify({ event: event, amount: amount == null ? 1 : amount })
   *     }).catch(function () {});           // never let the network break the bit
   *   },
   *   local:  LocalStore.local,
   *   best:   LocalStore.best,
   *   global: function () {
   *     return fetch(ENDPOINT + '/global')
   *       .then(function (r) { return r.json(); })
   *       .then(function (j) { return j.declines; })
   *       .catch(function () { return null; });
   *   }
   * };
   *
   * BEFORE SHIPPING THAT — /bump would be a naked public increment endpoint:
   *
   *  1. Allowlist `event` SERVER-SIDE to exactly declines|answers|talktime.
   *     It is sent verbatim from the client; unvalidated it is an arbitrary
   *     key-write, i.e. unbounded key creation and a memory-exhaustion path.
   *  2. Ignore the client's `amount` for declines/answers — always +1 on the
   *     server. Only talktime needs a value; clamp it to a plausible range.
   *     A hostile client otherwise sends -1e9 and runs the counter backwards.
   *  3. Access-Control-Allow-Origin: https://fih.app — never `*`. That will
   *     not stop curl (nothing does), but it stops other sites farming the
   *     counter through their visitors' browsers. Keep the JSON content-type:
   *     it forces a CORS preflight. Downgrading it to text/plain to "simplify"
   *     turns this into a simple request any origin can fire blind.
   *  4. Add `connect-src 'self' https://api.fih.app` to the CSP in
   *     public/_headers, or the fetch is blocked and the .catch() below
   *     swallows it — the counter just quietly never works.
   *
   * Also worth a deliberate decision, not just a code swap: this converts a
   * site with genuinely zero telemetry into one that transmits an IP, UA and
   * timestamp on every decline. Rate-limiting by IP means logging IPs.
   * ────────────────────────────────────────────────────────────────────
   */

  global.FihCounter = LocalStore;   // <- swap to RemoteStore when the backend exists

})(window);
