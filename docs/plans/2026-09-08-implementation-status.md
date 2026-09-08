# Agent-authored demos: implementation status

Implemented and independently reviewed on `codex/portable-core`. Changes remain uncommitted. The original plan is retained in `2026-09-08-agent-authored-demos.md`; the executable contract is documented in `docs/agent-authoring.md` and `schemas/project-v2.schema.json`.

Validation bundle: `/Users/bassime/Downloads/cine-round2-2026-09-08T07-25-38-346Z/index.html`.

| Planned demonstration | Evidence |
| --- | --- |
| Legacy and editorial framing on identical capture | Videos 01 and 02; Kino numeric defaults regression |
| Template, modified template, original React, inserted card, transparent overlay | Videos 03 and 09; real module/React seek and layering tests |
| External MP3 at output time and observed action milestone | Videos 03 and 06; decoded-duration and caption mapping checks |
| Narration-sized hold and resumed footage/camera/cursor | Videos 03, 04, 08; rate 2/4 hold regressions and reviewer probes |
| Speed/trim edits, natural narration pitch, captions | Video 04; decoded waveform correlation and boundary frames |
| Animated typing, Unicode, deletion, key chords | Videos 02 and 10; actual headless key selection and event persistence checks |
| Frame, generated, image and grid covers | Bundle covers; four-mode browser regression and cover-only rendering |
| Targeted edit, capture reuse, preview equivalence | Videos 07 and 08; unchanged encoded video hash after audio-only edit; exact PNG preview match |
| Actionable errors and cleanup | Unit/process and real headless malformed-code/asset/audio tests |
| Deterministic reference scene seeks, portrait, legacy compatibility | Video 05; direct/sequential/backward/reinitialized frame hashes and v1 migration regression |

Final verification: 43 unit/process tests and 16 integration tests passed. The eight scene/audio integration tests were rerun after the final read-only inspection API addition; all passed. CLI smoke checks cover capabilities, validate, inspect, and template init/eject. The gallery loads all ten videos and two sound samples, stays paused, has no broken local links or page errors, and was inspected headlessly.

All ten MP4s were decoded for inspection. Dimensions and durations match their compiled projects within one frame. All nine audio-bearing exports have a measured correlation offset of 0 ms on the 1 ms search grid; the custom-code montage is intentionally silent. Sampled contacts, insertion/speed/caption boundary sheets, full-size portrait and cover checks are saved in the bundle.

The independent GPT-6 Astra review identified five bugs: CLI author control flow, lost scene adapter/seed, fast-footage hold continuity, shortcut handling, and base/overlay order. All were fixed, given regression coverage, and independently rechecked. The review report preserves the initial reproductions and corrective evidence.

Two deliberate implementation choices simplify the planned architecture: declared local assets and bundled imports use inline/data resources instead of a new scoped HTTP server; built-in overlay renderers remain for v1 visual compatibility while sharing the same explicit frame clock. Custom scenes still use the isolated iframe lifecycle and module/React adapters.

Subjective listening was unavailable because this session could not consume audio input. Audio duration, alignment, ducking, density, bus controls, and signal levels were verified; the gallery preserves legacy/subtle A/B samples for user audition. This does not claim a listening endorsement. All capture was headless Chrome or hidden Electron; no native desktop recording or physical input was used. macOS remains the supported host, and a new OS backend remains outside this round.
