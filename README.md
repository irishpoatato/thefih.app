# fih.app

**fih is calling.**

A pixel-chasing recreation of the iOS incoming-call screen, with a fih on it.
Decline and he calls back — faster every time, and the decline button starts
edging away from your cursor. Answer and the screen goes completely still: no
sound, no text, no movement, just a fih and a timer counting how long you stayed
on the line.

The fih never moves. There are no animations on him anywhere in the app.

## run it

No build, no dependencies:

```bash
python -m http.server 8000 --directory public
```

Then visit http://localhost:8000

## deploy

**Netlify** — `netlify.toml` already sets `publish = "public"`. Connect the repo
and it is correct by default.

**Cloudflare Pages** — set the build output directory to `public`. It reads the
same `public/_headers` file, same syntax. Two Cloudflare-specific gotchas:
turn **Rocket Loader off** (it injects an inline script that `script-src 'self'`
blocks, breaking all three scripts), and set HSTS in the dashboard rather than
in both places.

**GitHub Pages — don't.** It supports no custom response headers at all, and
`frame-ancestors` is ignored in `<meta>` form, so the clickjacking protection
below is undeliverable there.

### security headers

`public/_headers` ships a strict CSP (`default-src 'none'`) verified in a
browser against the running app, plus `frame-ancestors 'none'` / `X-Frame-Options:
DENY`. Framing is denied deliberately: the risk is not to a fih.app visitor —
there is nothing here to steal — but that a full-viewport phone UI with a big
green Accept button at a predictable position is close to an ideal clickjacking
decoy to overlay on someone else's "Confirm payment". Sharing happens by link
and screenshot, neither of which needs an iframe.

Two traps worth knowing before anyone edits that file:

- **Do not add `autoplay=()` to `Permissions-Policy`.** A generic deny-all
  includes it, and Chrome's autoplay policy gates `AudioContext`, not just
  `<audio>` — it silently kills the ringtone, which is the entire point of the
  site. It is set to `autoplay=(self)`.
- **`connect-src`, not `media-src`.** The ringtone is loaded with `fetch()`, not
  an `<audio>` element. A CSP that carefully allows `media-src` and omits
  `connect-src` breaks it.

Cache headers deliberately revalidate rather than using long `immutable` times,
because the filenames are **not** content-hashed — a long cache would strand
visitors on a version you cannot patch.

## layout

```
public/                   <- the ONLY thing that gets deployed
  index.html              status bar + three screens: incoming / in-call / missed
  css/style.css           the iOS call screen, rebuilt from measurements
  js/app.js               call logic, escalation, copy
  js/audio.js             ringtone playback + call tones
  js/counter.js           every persistent number, behind one swappable interface
  assets/fih.png          the fih, cut out of the reference screenshot
  assets/call_sound.mp3   the ringtone
  _headers                CSP + security headers (Netlify AND Cloudflare Pages)
  robots.txt

netlify.toml              publishes public/ only
docs/assets.md            asset notes (not deployed)
dev/fih.png               the original meme screenshot (reference only, not deployed)
README.md                 this file (not deployed)
```

Everything outside `public/` stays off the live site deliberately. `dev/fih.png`
is a third party's screenshot, and the docs are written for whoever maintains
this, not for visitors.

## how close is the UI

Geometry and colour were measured off `dev/fih.png` rather than eyeballed:

| | reference | built |
|---|---|---|
| background | `rgb(20,20,22)` | `#141416` |
| decline red | `rgb(252,48,51)` | `#fc3033` |
| accept green | `rgb(78,222,98)` | `#4fd861` |
| button diameter | 72px | 72px |
| button centres | 190px apart | 50% of the control column (188px @ 375) |
| fih width | 4.10 × button diameter | 4.07 × |

Accept/decline, the Remind Me / Message row above them, and the in-call keypad
grid all sit on the same 25% / 50% / 75% columns iOS uses, at every width.
Status-bar clock is the real time; signal, wifi and battery are inline SVG. The
status bar sits on the same 430px column as the controls, so the clock and
indicators keep their phone-edge insets instead of drifting to the far corners
of a wide window — while the black background still fills the whole screen.

**It is not locked to portrait.** The black screen fills the window at any
aspect ratio — the same wide black field the reference screenshot is — while the
controls stay on a 430px column in the middle so they never stretch apart on a
desktop monitor. Short and landscape windows compress the stack progressively
(560px and 420px height breakpoints). Verified at 375×812, 390×640, 845×390,
1280×720 and 1280×800: no overflow, no overlap.

## sound

The ringtone is `assets/call_sound.mp3` (9.9s, looped). It is fetched and
decoded into an `AudioBuffer` and played through an `AudioBufferSourceNode`
rather than an `<audio>` element, because `HTMLAudioElement.play()` returns a
promise that browsers reject or stall on often enough to drop the *first* ring —
which was the "sometimes it does not play" bug.

### the file is very quiet — the app compensates

`call_sound.mp3` as supplied peaks at **0.0166 (-36 dBFS)**, RMS -51 dBFS, flat
across all 9.8 seconds. Playing it correctly at unity gain is inaudible at any
normal system volume. On decode the app measures the buffer's true peak and
applies makeup gain to bring it to 0.7 (`TARGET_PEAK`), capped at 40x
(`MAX_MAKEUP`) so a genuinely silent file is not amplified into hiss. For this
file that works out to ~37.5x, landing the output at -5.7 dBFS peak.

This is measured per file, so replacing the mp3 with a normally-mastered one
needs no code change — the gain drops to ~1x on its own. `FihSound.status`
reports `ringPeak` and `ringGain`. **Re-exporting the source louder would still
sound better than 37x of digital makeup**, which also lifts the recording's
noise floor.

Two more guards on top of that:

- **One shared decode promise.** `ensure()` starts the decode and `prime()` /
  `startRing()` both await the same promise. Handing back a fresh
  `Promise.resolve(ringBuffer)` while a decode was still in flight was a second
  way the first ring could come up silent.
- **A 350ms grace period.** If the buffer is not ready when the phone starts
  ringing, a synthesised bell phrase covers the gap and hands over the moment
  the mp3 is decoded — so the first ring is never silent, and in the normal case
  there is no audible seam because the mp3 wins the race.

### autoplay detection

Chrome does **not** reject `AudioContext.resume()` when autoplay is blocked — it
leaves the promise pending indefinitely. Awaiting it alone means the caller
never learns it was blocked, never falls back to the lock-screen gate, and the
page sits there silent with no way to unlock it. `tryAuto()` therefore races
`resume()` against a 300ms timer and treats "still pending" as blocked.

Relatedly, `unlock()` has to read `ctx.state` *inside* the resume callback.
Reading it synchronously right after calling `resume()` always sees the stale
`suspended` and gates the ringtone off permanently.

`FihSound.status` reports `{unlocked, ringing, buffered, playing, synth,
decodeFailed, contextState, ringPeak, ringGain}` for debugging this in the wild.

Answering the call plays **nothing** — the in-call screen is deliberately silent.
The only other sounds are the end-call tone and UI taps, both user-initiated.
`navigator.vibrate` is held back until the first real gesture, because Chrome
logs a console error for every call made before one.

### getting the one gesture browsers demand

Audio starts on its own where the browser permits it, and on those browsers
nothing at all is added — you land on a ringing call and your first tap does
exactly what you aimed it at.

Where autoplay is blocked (most phones) an **invisible first-tap catcher**
covers the live call screen: a transparent full-bleed layer that takes one tap
wherever it lands, starts the ringtone, and removes itself. No lock screen, no
prompt, no visible change.

The subtlety is that it has to swallow the **click** as well as the
`pointerdown`. Both come from the same tap, and if the click gets through, a tap
aimed at Accept would start the ringtone *and* immediately answer the call. So
the pointerdown starts audio at once and the layer lingers 400ms to absorb the
click behind it. Verified: a tap on Accept's centre while blocked leaves you on
the ringing call with `btn-accept`'s handler never firing, and the next tap
answers normally.

The old iOS lock screen is still in the codebase behind `USE_LOCK_GATE` at the
top of [js/app.js](js/app.js) — set it to `true` to use that instead of the
catcher. The `pointerdown` retry near the bottom of the file stays underneath
both as a safety net.

### reproducing the phone on a desktop

Autoplay defects here are invisible on a machine that allows autoplay, which is
how two of them shipped. Load **`?blocked=1`** to force the blocked path and see
what a phone sees:

```
http://localhost:8000/?blocked=1
```

## the global counter

`js/counter.js` is currently `LocalStore` — `localStorage`, single browser. It
exposes four methods (`bump`, `local`, `global`, `best`). A commented
`RemoteStore` sketch in that file implements the same four against HTTP; fill in
the endpoint and change the last line. Nothing else touches storage. Until then
"Declined worldwide" renders `—`.

⚠️ Before shipping a real one: `/bump` would be an unauthenticated public
increment endpoint. Rate-limit per IP and cap the amount, or the worldwide
counter becomes whatever one person with `curl` decides it is.

## credit

Based on the "fih" meme (2025) — "fish" with the AAVE `-ih` clipping, popularised
by Papyrus-font image macros and the "Fih is Calling" shirt, itself a riff on
"John Pork is Calling". The fih artwork is cut from the user-supplied reference
in `dev/`. All code, layout and audio here is original.
