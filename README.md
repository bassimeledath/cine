# cine

Headless cinematic screen recorder. Records a demo and renders Screen Studio-style
output — zoom-on-click with spring physics, smoothed oversized cursor, click
ripples, gradient background, padding, rounded corners, shadow — with no GUI app
and no human driving it.

```bash
npm install
npm run build:native      # only needed for the --native backend
node bin/cine.mjs demo    # -> ~/Downloads/cine-demo.mp4
```

## Pipeline

Four stages. Stage 1 has two interchangeable backends that emit identical
artifacts (`raw.mp4` + `cursor.jsonl` + `meta.json`), so stages 2-4 are shared.

| Stage | Module | What it does |
|---|---|---|
| 1. Capture | `capture-web.mjs` / `capture.mjs` + `drive.mjs` | Produce raw footage + a cursor track |
| 2. Author | `autozoom.mjs`, `showcase.mjs` | Derive zoom ranges from clicks; build the layer timeline |
| 3. Render | `render.mjs` + `compositor.html` | Composite the cinematic cut in headless Chrome, encode with ffmpeg |
| 4. Sound | `audio.mjs` | Synthesize and mix cues, mux without re-encoding video |

## Overlays and sound

The renderer takes an optional `layers` array — a title card, chapter markers,
toasts, callouts, a corner badge, an outro. Layers are plain data, so retiming
one is a JSON edit and a re-render, never a re-recording.

```bash
node bin/cine.mjs showcase                       # capture + overlay render
node bin/cine.mjs showcase --work /tmp/cine-x    # re-render an existing capture
```

Two things make the overlays worth having over a general-purpose video tool:

- **They're welded to the UI.** `anchorSelectors` resolves elements to rects at
  capture time and stores them in `meta.json`; the compositor pushes those rects
  through the live camera transform, so a callout tracks its button as the
  camera zooms and pans. For an element whose only child is text, the rect comes
  from a `Range` rather than the box — a block-level `<div class="val">8</div>`
  is as wide as its card, so its box centre lands in empty space.
- **Sound writes itself.** `autoCues()` derives click ticks and camera whooshes
  from the captured click track and the authored zoom ranges. Only the toasts
  and the title bed are hand-placed.

Overlays are DOM, not canvas draw calls: `page.screenshot()` captures the
viewport, so a positioned `<div>` composites into the frame for free — web
fonts, flexbox, `backdrop-filter`, SVG leader lines and all. Audio never enters
the browser; it's mixed in Node and muxed with `-c:v copy`.

### Backends

**`capture-web.mjs` (default)** — fully headless. Runs the page in headless
Chrome, drives it over CDP, and captures frames via `Page.screencast`. The
cursor is *authored*, not observed: positions come from the same eased timeline
the input events are dispatched from. No display, no cursor takeover, runs while
you work. Web content only.

**`capture.mjs` + `drive.mjs` (`--native`)** — records the physical screen with
`ffmpeg avfoundation` and moves the real macOS cursor with `cliclick`. Works for
anything on screen (native apps, Terminal), but takes over the machine for the
length of the recording and needs Screen Recording permission.

```bash
node bin/cine.mjs demo --url http://localhost:3000 --out ~/Downloads/my-demo.mp4
node bin/cine.mjs demo --native          # physical screen capture
node bin/cine.mjs autozoom --cursor cursor.jsonl --out cuts.json
node bin/cine.mjs render --video raw.mp4 --cursor cursor.jsonl --cuts cuts.json \
  --display-points 1470x956 --duration-ms 15700 --out out.mp4
```

## Things that are load-bearing

Each of these was a bug that produced silently wrong output, not a crash.

- **Clock epochs.** The native cursor logger stamps `CLOCK_REALTIME`, matching
  `Date.now()` in Node. It must not use `CLOCK_MONOTONIC`: macOS stops that
  clock during sleep and libuv's `hrtime` does not, so the two epochs drift by
  however long the machine has slept (~21s when measured). Mixing them threw
  every zoom that far off its click.
- **`videoT0` is anchored on the stop, not the start.** AVFoundation delivers
  ~500ms of buffered frames before ffmpeg prints its first progress line, so
  stamping the start runs late by a variable amount. `stop()` instead computes
  `t0 = stopInstant - containerDuration`. Verified: cursor-log end and video
  duration then agree to 8ms.
- **Virtual time is unusable for frame stepping.** Chrome only expires a
  virtual-time budget reliably at >=100ms granularity; at or below 50ms (i.e.
  any real frame rate) the renderer wedges on the second frame, regardless of
  input-dispatch order or `maxVirtualTimeTaskStarvationCount`. Hence the
  realtime screencast approach.
- **Merge tolerances are tuned for authored pacing.** kino's 2500ms click-merge
  window assumes a human clicking in bursts; with deliberate ~2.2s dwells it
  collapses an entire script into one shot framing the centroid of everything.
  cine merges only rapid *and* spatially close clicks, then closes sub-1500ms
  gaps so the camera pans between targets instead of blipping out and back in.
- **The card is the video rect, not the padded rect.** Otherwise any source
  whose aspect differs from the output gets pillarboxed and the card's black
  fill shows down the sides.
- **Cursor and click ripples counter-scale by zoom.** They're drawn inside the
  zoom transform so they track the right pixel, but a pointer that grows with
  the zoom reads as broken.
- **Focus is in display points and converted late.** The camera focus comes out
  of the cursor log in points; the card is measured in output pixels. Treating
  them as one space mis-centres every zoom by the ratio between them — invisible
  for a 1x web capture (3% off) and badly wrong for a 2x Electron one (23%).
  Overlay anchoring made it obvious because the ring missed its target.
- **Timeline time is not video time.** With a title card the screen layer starts
  late and carries a `sourceOffsetMs`; total duration comes from the layer list,
  not the capture. Everything camera-related runs on video time, overlays run on
  timeline time.

## Known limitations

- **Headless capture is 1x.** `Page.screencast` composites at CSS-pixel density
  and ignores `deviceScaleFactor`, so the source is 1470x956 rather than
  Retina. Slightly soft under zoom. The `--native` backend captures true 2x.
- **Screencast is change-driven**, delivering ~18fps under motion. Fine here
  because the page is mostly static and all camera motion is generated by the
  compositor at full 30fps, but fast page-side animation would judder.
- **`glideTo` in `drive.mjs` is slower than requested.** It packs ~54
  `m:`/`w:` pairs into one `cliclick` call and per-command overhead stacks on
  top of each wait, so a 650ms glide takes noticeably longer. Only affects
  `--native`.
- Homebrew's ffmpeg is often broken by x265 soname drift; `ffmpegPath()` prefers
  the self-contained `imageio_ffmpeg` binary and falls back through candidates.
