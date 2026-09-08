# Cine: agent-authored scenes, narration, and editorial controls

Draft implementation plan • 2026-09-08 • source inspection only; this document does not implement the features.

## Product direction

The user's agent directs the demo. Cine supplies capture, timing, composition, media mixing, validation, and export. Users can choose a template, let their agent modify its code, or supply a completely original scene. Covers are equally open. Narration enters as ordinary audio files from any provider; Cine does not need a TTS account, model SDK, or provider registry.

Preserve macOS as the supported host, keep new work in the portable core/render/media layers, and run every recording validation headlessly or in hidden Electron. Do not repeat native desktop interaction.

## Verified Kino comparison

Compared the current local source checkouts, not a running Kino app's saved settings.

| Behavior | Kino source default | Cine current implementation |
| --- | --- | --- |
| Camera position spring, stiffness/damping/mass | 200 / 40 / 2.25 | Same |
| Camera zoom spring | 200 / 40 / 2.25 | Same |
| Cursor spring | 470 / 70 / 3 | Same |
| Automatic zoom level | 1.5× | Same |
| Click lead-in / hold / minimum duration | 300 / 2500 / 1000 ms | Same |
| Merge gap for click ranges | 2500 ms | 200 ms, plus a 320 px proximity condition |
| Short gaps between separate shots | Covered by broad merge where applicable | Bridges gaps up to 1500 ms, preserving zoom while panning |
| Automatic focus | Time-varying clusters of all cursor events | Fixed mean of clicks within each range |
| Edge handling | Normalized edge remapping (default ratio 0.25), then clamp | Clamp without that remapping |
| Keep zoomed in between ranges | Optional system ranges; default setting is false | Unsupported |
| Output cadence | Default recording setting is 60 FPS | Demo CLI defaults to 30 FPS |

The motion constants are inherited, but shot selection and target selection are not equivalent. Even numerical integration differs slightly: Kino uses substeps of at most 1 ms; Cine divides each frame delta into rounded-count near-1-ms steps. Equal parameters do not imply pixel-identical motion. No full effects parity claim should be made.

Kino's preset labels also need care: the recording defaults specify cursor values 470/70/3, which its preset table names “medium”, despite an initial “smooth” label. Compare numeric values, not labels. Do not change Kino as part of this work.

Evidence:

- [Kino defaults](/Users/bassime/Desktop/fullstack/kino/src/renderer/store/recording.ts:11)
- [Kino auto zoom and cursor clustering](/Users/bassime/Desktop/fullstack/kino/src/renderer/engine/auto-zoom.ts:18)
- [Kino target geometry](/Users/bassime/Desktop/fullstack/kino/src/renderer/engine/composition-geometry.ts:115)
- [Kino springs](/Users/bassime/Desktop/fullstack/kino/src/renderer/engine/spring-camera.ts:1)
- [Cine springs](/Users/bassime/Desktop/fullstack/cine/src/springs.mjs:1)
- [Cine auto zoom](/Users/bassime/Desktop/fullstack/cine/src/autozoom.mjs:9)
- [Cine frame state](/Users/bassime/Desktop/fullstack/cine/src/core/frame-state.mjs:12)

## 1. Establish the authoring and timing contracts

Introduce project schema v2 for the new scene sequence, custom code, audio clips, captions, and cover specification. Continue reading v1 through a pure normalization layer. Rendering must not rewrite either version. Provide an explicit migration command that writes a new file and preserves the original.

Use stable IDs for actions, scenes, overlays, and audio clips. User-supplied action IDs persist into the capture manifest; generated IDs must be assigned and saved once, rather than regenerated on each render. Record useful action milestones: start, input dispatch, successful outcome verification when requested, and end. A label is display text, not an identifier. Never manufacture an outcome-verification event for an unchecked action.

Support placement at an output timestamp, a scene-relative offset, or a captured action milestone plus offset. Keep source-time placement for source-bound camera ranges and effects. The compiler resolves every reference into one final output timeline.

Use an ordered scene sequence with three base scene kinds: source footage, a held source frame, and a generated scene. Overlays and audio are separate timed layers. Source scenes retain ordered trims and constant-rate segments. A full-screen overlay can cover running footage; an inserted generated scene or hold occupies actual timeline duration and pushes later scenes forward. Make this distinction explicit in commands and schema.

Resolve in this order: load/validate documents → probe local assets and audio duration → resolve source milestones → resolve explicit scene durations/holds → assign output times → resolve overlays/audio/captions/camera → compile frame states. Reject missing references, circular duration dependencies, anchors in trimmed-away footage, and unintended narration overlaps with structured errors. Do not silently relocate them.

For holds, freeze the selected footage frame, cursor, and camera by default; overlays/captions continue on output time. Resume footage without redispatching input or duplicating click/typing sounds. Source events at a split have one owner using half-open intervals. Expose resolved timings and origin references in the inspection output.

## 2. Open custom scene authoring, including React

Provide three equally supported authoring paths:

1. Use a bundled template with properties.
2. Eject a template into project-local editable source files.
3. Create a scene from scratch using browser JavaScript/HTML/CSS, SVG/canvas, or React/TSX.

Templates are starting points, not a fixed menu of all possible visuals. Include examples for a title, a chapter interstitial, a metric/result card, and an annotated split layout. Convert built-in cards to use the same lifecycle where practical; avoid maintaining two different frame clocks.

The scene host loads a local entry module and gives it width/height, theme, props, declared assets, a seeded random helper, and explicit local/output frame time. The browser-module contract is createScene(root, context) returning renderFrame(frameContext) and dispose(); creation and frame rendering may be awaited. The React adapter renders a component from the same context and waits for its DOM commit. Export a small helper SDK and types; agents do not write lifecycle glue themselves.

Scene instances can serve as full-screen inserts, transparent overlays, or cover-only compositions. They are composited in declared order. Assets and fonts must signal readiness before capture. CSS animations, canvas/WebGL animation, and component transitions must be driven from supplied frame time, not elapsed wall time. Validate direct, sequential, backward, and reinitialized rendering for reference scenes. Custom code that uses nondeterministic APIs may still be nondeterministic; report that limit rather than promising arbitrary code is reproducible.

Use a project-local build step for JS/TSX and styles with pinned React/build dependencies. No framework migration of the existing renderer. Resolve installed browser-compatible dependencies without installing packages during a render. Bundle and serve only declared project resources through a scoped asset host; isolate scene DOM/styles in a separate browser frame with a narrow frame-render protocol. Custom scene errors, missing assets, and frame timeouts fail with scene ID and source location. Do not evaluate scene modules inside the CLI process or give them Node APIs. This is a local authoring feature, not a claim of secure multi-tenant execution of hostile code.

## 3. Accept narration as media files

Cine needs an external audio-clip abstraction, not a TTS-provider abstraction. The agent invokes whichever provider or local tool the user prefers and supplies MP3/WAV/M4A files. The same abstraction can accept recorded narration, music, and custom sound effects.

Illustrative v2 fragment (proposed syntax):

```json
{
  "audioClips": [
    {
      "id": "deploy-narration",
      "file": "audio/deploy.mp3",
      "at": { "action": "deploy", "event": "verified", "offsetMs": 250 },
      "role": "narration",
      "gainDb": 0,
      "captions": { "file": "audio/deploy.vtt" }
    }
  ]
}
```

The optional VTT times are relative to that audio clip, not the whole video. Captions are not required to insert audio. Output timestamps are also valid placement, e.g. at: {outputMs: 8000}. Resolve trim-in/out, fades, gain, and clip duration at decoded sample precision; do not rely only on rounded MP3 container duration. Preserve narration playback rate/pitch when footage speed changes; only its attachment point follows the source edit.

Start with playback over continuing footage. Support explicit narration-sized holds and generated scenes using duration: {audio: "deploy-narration"}; attach the audio to that scene's start so timing is acyclic. An agent command can split source footage at an event and insert this hold without manually recalculating all later times. If speech extends past the project end, report it; the agent/user must choose to extend, hold, trim, or reposition. Do not silently accelerate speech, crop the tail, or hide the conflict.

Mix narration, effects, and optional music on separate buses. Offer per-clip and per-bus volume/mute, plus configurable ducking of effects/music beneath narration. Prevent clipping and validate the exported duration. A change affecting audio alone should remux an unchanged video where its content hash permits; a duration/hold/caption change invalidates the affected picture output. Start with cached silent-video reuse, not a distributed render cache.

## 4. Captions without a provider dependency

Accept SRT/VTT for phrase timings and a small JSON format for word timings. Caption offsets follow audio placement and trims; words keep their natural duration when footage is accelerated. Support legible phrase captions initially, plus word highlighting when word timing exists. Export caption sidecars and optional burned-in captions through the same scene/caption renderer used in preview.

An MP3 alone does not provide its transcript or word timings. With only a transcript, allow a simple caption spanning the clip as an explicit basic mode, or accept timings produced by an external agent/alignment tool. Warn on unreadably long captions. Do not label guessed word positions as synchronized captions. Automated transcription/forced alignment can be added later behind a file interface without changing the media contract.

## 5. Preserve the motion feel and expose editorial camera choices

Keep current Kino-derived numeric spring defaults. Separate motion response (springs) from framing policy (when/where/how far to zoom). Make both visible in the schema and inspect output, with optional per-scene overrides.

Retain the current click-based algorithm as a documented legacy policy. Add an agent-directed path that accepts overview, focus, hold, and pull-back instructions attached to scenes/actions. Agents can supply a target rectangle, captured selector, point, or explicit wide shot; a simple automatic policy uses those annotations and falls back to click timing. Cine should not claim to infer the semantic meaning of arbitrary UI changes by itself.

For newly authored projects, provide an editorial policy with an initial overview, focus during an annotated interaction, and a context shot at an annotated result or chapter boundary. Retain a quiet camera through nearby steps unless a framing change is justified. Do not force a zoom-out after every click or replace a saved camera edit when regenerating unrelated content.

Add comparison fixtures using identical cursor input to show which Kino parameters are shared and where policies differ. No promise of complete Kino feature parity and no runtime import from the Kino repository. Fix the stale Cine header comment that still mentions a 2500 ms merge gap.

## 6. Animated typing and better effects

Make new captures type visibly by default. Preserve instant insertion as an explicit mode. Add configurable characters-per-second, deterministic variation/punctuation pauses, clear-versus-append behavior, and explicit key actions for deletion/shortcuts. Use grapheme-aware text handling; retain an insertion fallback for text that cannot map to physical keyboard events and report its behavior. Test input, textarea, contenteditable, emoji/Unicode, and outcome verification on headless fixtures.

Emit observed typing/key timestamps into a versioned capture event track. Record event timing and category, not a second copy of entered text solely for audio. Generate typing sounds from these events; source speed edits move the events, while a density cap avoids excessive overlap. Remove sounds for trimmed events and do not repeat events over holds.

Create a quieter sound palette: softer/lower clicks, subdued keyboard taps, optional transitions. Generate transition sounds from actual significant camera/scene transitions, not from each range boundary. Adjacent focus ranges at identical zoom must not produce a fictitious zoom-out/zoom-in pair. Add sound presets (subtle, silent, custom), bus controls, and imported effects through the same audio-clip abstraction. Retain an explicit legacy palette for reproduction. Existing saved project files remain unchanged; version the cue-generation/sound profile rather than silently changing every older export.

## 7. User- and agent-selected covers

Cover specification supports: an output frame, an image asset, a generated scene at a chosen local time, or a grid of selected frames. A title slide is a valid cover even if it never appears inside the video. A grid remains a valid user choice; contact sheets are not mandatory covers.

Export a separate cover.png/jpg plus its metadata, and use it as the gallery poster. Record the user's/agent's selection in the project so rerenders preserve it. When omitted, generate a reasonable single-frame fallback or emit candidates for the agent to select. Do not pretend a separate cover controls every external video player's thumbnail behavior.

## 8. Agent experience

Publish machine-readable schemas and a small cross-agent authoring guide with copyable project/scene/audio examples. Core operations must be usable from any local coding agent through the CLI and ordinary files, with no model-specific runtime dependency.

Proposed command surface (one underlying JS API per operation):

- capabilities --json: installed features, schema versions, supported media and scene types.
- validate --project ... --json: structural/media/asset checks, exact error paths and stable codes.
- inspect --project ... --json: actions/milestones, scene IDs, resolved timing, audio durations, asset dependencies, available anchors.
- scene init/eject: write runnable template or custom scene scaffolding into the project.
- project patch --file operations.json: targeted updates by stable ID with optional expected project hash; write atomically and return a change summary. Reuse schema and compiler validation.
- preview --project ... --scene ... or --from-ms ... --to-ms ...: a short headless MP4, PNG candidates, and optional WAV preview.
- render --project ...: final video, selected cover, captions, and structured artifact manifest.

New --json modes reserve stdout for structured output; progress goes to stderr. Failures identify the owning scene/audio/action, requested reference, and a concrete repair suggestion. Operations support read-only validation before expensive renders and avoid overwriting existing user-authored source files implicitly.

The normal loop is: inspect capture → author/patch project and local scene files → obtain narration files externally → validate timing/assets → preview affected range → inspect → render. Reuse captures throughout. Keep the guide and schema generated examples consistent with executable fixture tests. Do not build a second conversational agent into Cine.

## Architecture and implementation order

Extend the existing modules; add a module only where it owns a clear boundary:

| Owner | Responsibility |
| --- | --- |
| core/project + core/timeline | Version normalization, ID/reference validation, source/scene/output timing, frame planning |
| actions + capture/artifacts | Typed input, action milestones, capture event persistence |
| core camera planning + autozoom | Editorial shot policy and Kino-derived motion defaults |
| render scene host/adapters | Built-in/custom browser/React scenes, frame lifecycle, captions, cover rendering |
| media | Audio-file probe/decode, effects, clip mixing, ducking, muxing |
| runtime | Browser/build/process lifecycle and scoped asset serving |
| projects + CLI | Shared authoring/inspect/patch/preview/export entry points |
| examples + docs | Ejectable templates, narrated demo fixture, agent guide |

Order:

1. Lock the v2 examples, normalization, stable milestones, and timing contracts; establish v1 regression fixtures.
2. Implement file-based audio mixing, captions, and explicit holds/generated scene timing on the existing renderer.
3. Add custom scene lifecycle, editable templates, browser module/React adapters, and all cover modes.
4. Add editorial camera controls, quieter effect policy, and timestamped animated typing.
5. Finish agent CLI/docs and previews against the shared APIs; assemble the complete validation bundle and request an independent post-change review.

The main architectural work is the time/reference model and deterministic custom scene host. Audio-file placement itself is comparatively small. A rough planning allowance is 2–3 engineer-weeks for this entire round including meaningful headless validation and review; this is an estimate, not a measured runtime or commitment. Reduce initial scope by omitting advanced word highlighting and cross-render caching if necessary, without cutting MP3 insertion, custom scene code, basic captions, or agent interfaces.

## Validation and completion criteria

All desktop capture remains headless Chrome or hidden Electron. No native recording/physical input tests. Unit checks cover references, boundaries, audio trims, duration dependencies, caption offsets, event mapping, camera/sound selection, and legacy migration. Browser/media checks exercise real code and export, not only schema snapshots.

Save a fresh timestamped folder under Downloads with original projects, local scene source/assets, reusable captures, narration fixtures, caption files, exported MP4s, covers, audio previews, logs, and inspection results. Use licensed or locally generated speech fixtures with a known transcript; no paid TTS calls or provider credentials are needed for this validation.

Required demonstrations:

1. Current-look baseline plus an editorial camera variant from the same capture.
2. A provided template, a code-modified template, and an original React/TSX scene; at least one inserted mid-video and one transparent overlay.
3. MP3 narration at an action milestone and at an absolute time; multiple clips, gain/fades, and ducked effects.
4. Narration-sized hold with captions, followed by correctly resumed footage/camera/cursor.
5. Speed/trim edits with intact narration pitch, correctly mapped effects, and aligned captions.
6. Visible typing with keyboard sounds, including Unicode and deletion, captured headlessly.
7. Frame, title-scene, external-image, and grid covers; selecting a cover must not change video frames.
8. An agent-style targeted project edit changing narration or one scene without replaying capture; short preview and full export agree.
9. Broken code, missing assets, unreadable audio, invalid captions, unresolved/trimmed anchors, and timing-cycle failures produce actionable errors and clean up child processes/scratch.
10. Direct/sequential/backward rendering of reference custom scenes matches; portrait captions/overlays stay legible; v1 projects still load and render under their legacy behavior.

Decode final MP4s for visual inspection, including frames around every insertion/speed/caption boundary. Check actual output duration/dimensions and audio offset/levels, and audition the click, typing, transition, and narrated mixes. Distinguish measured alignment, sampled visual checks, and listening judgments in the notes. Keep subjective sound comparisons available for the user's review. Run an independent code review after implementation/tests and resolve its actionable findings before completion.

## Deliberate scope boundaries

No hosted TTS integration, LLM runtime, multi-tenant code-execution service, full graphical editor, new OS backend, native camera revalidation, arbitrary media-track editor, or automatic word alignment is required in this round. The abstractions should permit later additions without coupling providers or macOS APIs into the renderer.

## Primary technical references

React exposes a synchronous DOM flush API useful at a renderer integration boundary; the adapter should own that integration, not require every custom scene to implement it: [React DOM APIs](https://react.dev/reference/react-dom).

FFmpeg provides trim, delay, mix, and sidechain compression filters for composing external audio: [FFmpeg filters](https://ffmpeg.org/ffmpeg-filters.html).

Puppeteer supports character typing and delayed input, providing a starting point for the headless typing driver: [Keyboard API](https://pptr.dev/next/api/puppeteer.keyboard).
