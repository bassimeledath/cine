# Cine

New projects use Kino’s camera policy and recorded keyboard/mouse samples. See [agent authoring](docs/agent-authoring.md) for controls and [sound provenance](assets/sounds/recorded/README.md) for sources.

Cine records scripted app workflows and renders cinematic MP4 demos: smooth camera motion, a clean cursor, click highlights, image backgrounds, titles, anchored callouts, and recorded input sounds.

**macOS is the supported host initially. Web recording is headless. The bundled Electron demo stays hidden.** Neither workflow moves the physical mouse. Native desktop recording is an explicit `--native` opt-in and does control the desktop.

## Agent-authored demos (v2)

Newly authored projects support inserted or held scenes, editable JavaScript/HTML/React scene code, imported MP3/WAV/M4A narration, captions, animated typing with observed key events, independently directed camera shots, and user-selected covers. TTS stays outside Cine: any agent can provide ordinary audio files and optional timing sidecars.

Read [the agent authoring guide](docs/agent-authoring.md) and [project schema](schemas/project-v2.schema.json). `capabilities`, `validate`, `inspect`, `project patch`, `scene init`, `scene eject`, and `preview` support a file-based agent workflow. Add `--json` for machine-readable stdout; progress goes to stderr. The project example later in this README documents the supported **legacy v1** format; `author` now writes v2 and `author --legacy` writes v1.

Rendering v2 exports a selected cover, caption sidecars when present, and an artifact manifest beside the MP4. Audio-only edits can reuse `.cine-cache` picture data. Existing saved project documents remain untouched.

## Start

Requirements: Node 22+, Google Chrome, and FFmpeg with H.264 encoding/decoding. The native backend additionally needs `cliclick`, the compiled helper, and macOS Screen Recording / Accessibility permissions.

```sh
npm install
node bin/cine.mjs doctor
node bin/cine.mjs demo --work ~/Downloads/cine-web --out ~/Downloads/cine-web.mp4
node bin/cine.mjs showcase --work ~/Downloads/cine-showcase --out ~/Downloads/cine-showcase.mp4
```

`CINE_CHROME` and `CINE_FFMPEG` override executable discovery. `CINE_CLICLICK` overrides native input. Only native capture needs `npm run build:native`. An explicitly configured missing executable is an error, not a silent fallback.

## Capture, author, edit, render

```sh
node bin/cine.mjs capture --url http://localhost:3000 \
  --script actions.json --work ~/Downloads/my-capture
node bin/cine.mjs author --capture ~/Downloads/my-capture/meta.json \
  --project ~/Downloads/my-project.json
node bin/cine.mjs render --project ~/Downloads/my-project.json \
  --out ~/Downloads/my-demo.mp4 --inspect ~/Downloads/my-inspection
```

Editing a project changes the export without replaying the app. **Render never writes the project.** `author` requires `--force` to overwrite an existing project. `showcase` creates an example project only if it does not exist; subsequent runs use the saved edits.

Capture produces:

- `raw.mp4`: source video without the composited cursor.
- `cursor.jsonl`: ordered, source-relative samples `{t,x,y,l,r}`; milliseconds and logical display points.
- `meta.json`: versioned manifest with duration, source paths, frame rate, display geometry, original clock origin, observed actions, and timestamped anchor rectangles.

The original wall-clock origin is metadata only. New samples and action times use source time, where zero is the first video frame. Legacy manifests with absolute stamps are normalized on load without modifying their source files.

Use `capture --cdp ENDPOINT` to attach to an existing Chromium/Electron host. If it has multiple pages, specify `--target` with an exact page URL. Cine disconnects from an attached host and never closes it. Recording requires an action producer; uncontrolled external mouse activity is not inferred into a cursor track.

## Action scripts

Voice-driven web apps can receive prerecorded audio through an isolated virtual microphone while their real STT runs. Open Shadow DOM selectors (`host >>> target`) and held-pointer drags support embedded widgets, region selection, and sliders. See the [voice and interaction contract](docs/agent-authoring.md#voice-apps-embedded-widgets-and-dragging); input audio and the exported soundtrack remain separate.

Scripts are JSON arrays. Each action resolves its target against the current page, checks visibility/hit-testing, and records dispatch timing. An action can wait for an expected result before the next action begins.

```json
[
  {"type":"click","selector":"#open","expect":{"selector":"#form"}},
  {"type":"type","selector":"#name","text":"September release"},
  {"type":"click","selector":"#save","expect":{"selector":"#status","text":"Saved"}},
  {"type":"scroll","y":500},
  {"type":"waitFor","selector":"#publish"},
  {"type":"click","selector":"#publish"},
  {"type":"verify","selector":"#status","text":"Published"}
]
```

Supported actions: `move`, `click`, `type`, `key`, `scroll`, `waitFor`, `verify`, `wait` (`ms`), `selectText`, `drag`, and `audioInput`. `click` is the default type. Pacing controls are `moveMs`, `settleMs`, and `dwellMs`. `timeoutMs` controls target/condition waits. `waitFor` and `verify` accept `state: "visible" | "hidden"` and optional text. Typing animates text at the focused field; `typing.replace: true` clears it and `typing.mode: "instant"` inserts the full string. Explicit `key` actions support deletion and shortcuts in Chromium. Scroll x/y are pixel deltas. Explicit `point: {x,y}` is available for known coordinates.

`runActions()` also accepts an async iterable: a future live agent can submit actions through the same executor. No LLM planner or provider integration ships here. `startChromiumRecording()` records independently of the producer; integrations feed observed samples and action events to its `emit` / `onAction` hooks.

## Project format

Paths, including image assets, are relative to the project file, not the shell working directory.

```json
{
  "schemaVersion": 1,
  "capture": "my-capture/meta.json",
  "output": {"width": 1920, "height": 1080, "fps": 30},
  "settings": {
    "backgroundType": "image",
    "backgroundImage": "assets/background.png",
    "backgroundFit": "cover",
    "backgroundPosition": {"x": 0.5, "y": 0.5},
    "backgroundGradientFrom": "#102e3a",
    "backgroundGradientTo": "#215650",
    "brandColor": "#3ca58f",
    "accentColor": "#f0bb87",
    "textColor": "#ffffff",
    "mutedColor": "#a6c9c1",
    "fontFamily": "Arial, sans-serif",
    "cursorType": "image",
    "cursorImage": "assets/cursor.png",
    "cursorHotspot": {"x": 0.0625, "y": 0.0455},
    "cursorSize": 1.3
  },
  "screen": {
    "startMs": 1800,
    "segments": [
      {"fromMs": 0, "toMs": 3000, "rate": 1},
      {"fromMs": 3000, "toMs": 8000, "rate": 2.5},
      {"fromMs": 9000, "toMs": 12000, "rate": 1}
    ]
  },
  "zoomRanges": [{"start": 1000, "end": 3000, "zoom": 1.5, "fx": 400, "fy": 300}],
  "layers": [
    {"type":"title","head":"September release","startMs":0,"endMs":2000},
    {"type":"callout","text":"Saved","anchorSelector":"#save","timebase":"source","startMs":3200,"endMs":4400},
    {"type":"outro","head":"Ready to share","timebase":"screenEnd","startMs":-200,"endMs":1800}
  ],
  "audioCues": [{"sound":"tick","atMs":3400,"timebase":"source"}]
}
```

The example segment bounds must fit the actual capture. Omitting segments retains the whole capture at 1×. Segments must be ordered and non-overlapping, with rates in `(0,16]`. Gaps in source bounds trim footage; output segments join contiguously. Reordering, reverse playback, and continuous speed ramps are not supported.

Time rules:

- Zoom ranges and captured anchors use source time/coordinates.
- Layers and audio default to output time. `timebase: "source"` follows clip edits and speed. Source layers can split across trims; cues in trimmed portions disappear.
- `timebase: "screenEnd"` uses offsets from the edited screen's end, useful for outros.
- Output layers may use `endAt: "screenEnd"` and `endOffsetMs` to follow the screen's duration.
- Camera/cursor springs run on output time. Speed changes accelerate footage and action positions while preserving the smoothing cadence.
- Click ripples and sound samples retain their normal output-time duration. Cue positions move with the edit; their pitch does not change.
- Frame state is compiled once at output FPS. `window.step(t)` selects the corresponding frame; direct and backward seeking are independent of prior calls.

Layers: `title`, `outro`, `lower` (chapter marker), `toast`, `callout`, and `badge`. Anchor selectors must have been included in capture's `anchorSelectors`; moving/hidden anchors are sampled during capture. Static `anchor: {x,y,w,h}` rectangles are also supported. Tracking is sampled at roughly 10 Hz, not per-pixel optical tracking.

Background types: `gradient`, `solid`, `image`; images support `cover`/`contain` with a normalized position. PNG, JPEG, WebP, and SVG assets are loaded before export; malformed/missing files fail clearly. `contain` uses the first background color behind uncovered areas. Title/outro cards use the theme gradient so text remains legible. Cursor types: `arrow`, `dot`, `crosshair`, `image`. Hotspots are normalized image coordinates: `(0,0)` is the top-left, `(0.5,0.5)` is the center. Transparent images are supported. Cursor size is independent of camera zoom.

## Architecture and platform boundary

- `src/platform/macos/`: Apple capture APIs, cursor helper, physical input, macOS executable candidates.
- `src/runtime/host.mjs`: composition root; selects the supported host and passes resolved tool paths to engines.
- `src/runtime/`: subprocess ownership and hidden Electron launch on an ephemeral debugging port.
- `src/capture/`: Chromium recorder and common artifact IO.
- `src/actions/`: action runner and Chromium driver.
- `src/core/`: platform-independent time, project, style, event, and frame-state logic.
- `src/render/`: browser compositor, canvas drawing, DOM overlays, asset loading, export.
- `src/media/`: FFmpeg helpers, recorded sound samples, legacy synth cues, and narration mixing.
- `src/examples/`: demo scripts and showcase template; `demo/` contains the sample applications.

Core/render/media do not import platform adapters or host discovery. Export/capture engines receive a runtime `{chrome,ffmpeg}`. Native code is imported only for `--native`; a headless workflow does not need native permissions or helpers. A dependency test enforces this boundary.

Future OS support requires a host resolver, capture/input adapter as needed, packaging, and real platform validation. It does not require changing branding, project documents, time mapping, or composition. The current CLI deliberately reports macOS-only support; a portable internal design is not a claim of tested Windows/Linux support.

## Validation

```sh
npm test
npm run test:integration
```

Unit tests cover timing, capture/project contracts, dispatch timing, dynamic producers, settings, deterministic audio, platform dependencies, and subprocess failure cleanup. Integration tests use headless Chrome, hidden Electron, and FFmpeg for pixel comparisons, custom React/module scenes, narration/holds/captions, typing, cover selection, cache reuse, previews, and failure cleanup. They never move the physical mouse.

The `tests/fixtures/dynamic.html` workflow exercises a newly-created target, a target moved by a prior action, typing, scrolling, and outcome verification. `--inspect DIR` saves a frame per second plus the endpoints during an export.

## Native recording and practical limits

```sh
npm run build:native
node bin/cine.mjs demo --native --work ~/Downloads/cine-native --out ~/Downloads/cine-native.mp4
```

Native recording is foreground, main-display recording. It records the real screen and controls the real cursor. Do not use it while working in other applications. It cannot be made headless while recording the physical display. The default headless/hidden modes should be used for unattended demos.

Native input uses Accessibility permission and screen capture uses Screen Recording permission. The helper reports primary-display logical geometry; cursor coordinates are normalized to the capture origin. Multi-monitor selection and arbitrary native app targeting are not implemented. Native clocks are anchored at stop time minus recorded video duration; hardware timing accuracy still needs measurement on the target host.

Chromium screencast is change-driven. The encoder holds the last received frame between repaints. Camera/cursor rendering is smooth at output FPS, but this does not restore missing frames from fast source animations. Capture is at CSS-pixel density; zoomed source footage can look soft. Electron capture includes its WebContents, not native menus or system dialogs. Original application audio is not recorded; generated cues and imported audio clips compose the audio track.

Images/fonts and installed Chrome/FFmpeg versions affect visual reproducibility. Use the same environment for strict comparisons. Exports currently spool frames to temporary storage; scratch is removed on failure as well as success, while capture artifacts remain available for editing.
