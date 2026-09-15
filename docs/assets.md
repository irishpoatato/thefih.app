# assets

## fih.png

**Provenance: cut from `dev/fih.png`, a screenshot supplied by the site owner.**
That screenshot is itself a third party's web recreation of the meme (its Remind
Me / Message icons are the ⏰ and 💬 emoji, not iOS SF Symbols), and the
underlying photo of the bass is most likely commercial stock. The owner has
chosen to ship it as-is. Consequences of that choice, deliberately accepted:
keep him at the current small size, and **do not add an `og:image`** — a preview
image multiplies the scraping surface that automated image-matching services
crawl. If a notice ever arrives, swapping to a USFWS or NOAA public-domain
largemouth bass is a ~20 minute job using the recipe below.

The fih, cut out of `dev/fih.png` (the original meme screenshot) with a flood-fill
alpha matte and exported at 2x — 598×172, displayed at ~300 CSS px. He keeps a
faint dark fringe from the screenshot's background; it is invisible because the
page background is the exact colour sampled from that screenshot (`#141416`).

To regenerate from a different source: flood fill from the border with tolerance
14, feather the alpha 0.6px, then resize 2x with LANCZOS.

He is deliberately static. There are no animations on him anywhere in the app.

## call_sound.mp3

The ringtone. 9.86s, looped seamlessly through the Web Audio graph.

**Provenance: supplied by the site owner, who confirms it is theirs or licensed.**
Its ID3 tag carries only an FFmpeg encoder string (`Lavf61.7.100`) and no title,
artist or copyright frame, so the file itself documents nothing — record the
actual source here so it can be produced on demand if anyone ever asks.

It is very quietly recorded (peak -36 dBFS); the app measures it on decode and
applies makeup gain automatically, so it is audible without you re-exporting it.
Re-exporting louder would still sound cleaner.

Swapping it is a one-line change — `RINGTONE` at the top of
[js/audio.js](../js/audio.js). Anything the browser can decode works. Keep it
loopable; it restarts from zero on every new call.

If the file ever fails to fetch or decode, the app falls back to a synthesised
bell phrase so the phone still rings. `FihSound.status.decodeFailed` tells you
that happened.
