import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { compileProject } from '../src/core/project.mjs'
import { kinoFrames } from '../src/core/kino-policy.mjs'
import {
  generateAutoZoomRanges,
  computeCameraTarget,
  findActiveZoomRange,
  SpringCamera,
  clampCameraToZoom,
} from '../src/vendor/kino-camera.mjs'
import { SPRING_PRESETS } from '../src/springs.mjs'
import { subtleCues } from '../src/core/sound.mjs'
import { mixTrack } from '../src/media/audio.mjs'
import {
  recordedSound,
  RECORDED_SOUND_NAMES,
} from '../src/media/recorded-sounds.mjs'
const capture = {
  durationMs: 14000,
  displayPoints: { w: 1200, h: 800 },
  frames: [],
}
for (let t = 0; t <= 14000; t += 100)
  capture.frames.push({
    t,
    x: t < 6000 ? 200 + t / 40 : 1000 - (t - 6000) / 40,
    y: t < 8000 ? 220 : 600,
    l: [1000, 4000, 8500].includes(t) ? 1 : 0,
  })
const project = {
  schemaVersion: 2,
  output: { width: 640, height: 360, fps: 30 },
  scenes: [{ id: 'all', kind: 'source' }],
  camera: { policy: 'kino' },
}
test('Kino default merges nearby activity into one sustained shot', () => {
  const p = compileProject(project, capture)
  assert.equal(p.camera.kinoRanges.length, 1)
  assert.equal(p.camera.kinoRanges[0].startMs, 700)
  assert.equal(p.camera.kinoRanges[0].endMs, 11000)
  assert.ok(
    p.states
      .filter((s) => s.t > 1800 && s.t < 11000)
      .every((s) => s.zoom > 1.49),
  )
  assert.ok(p.states.at(-1).zoom < 1.001)
  assert.deepEqual(
    compileProject(project, capture).camera.kinoRanges,
    p.camera.kinoRanges,
  )
})
test('Cine Kino camera matches upstream target, integration and post-spring clamp at every frame', () => {
  const frames = kinoFrames(capture.frames, capture.displayPoints),
    ranges = generateAutoZoomRanges(frames, capture.durationMs),
    reference = new SpringCamera(),
    plan = compileProject(project, capture)
  for (const state of plan.states) {
    const target = computeCameraTarget(
      findActiveZoomRange(ranges, state.sourceMs),
      frames,
      state.sourceMs,
    )
    reference.update(
      target.x,
      target.y,
      target.zoom,
      1 / 30,
      SPRING_PRESETS.screen,
      SPRING_PRESETS.zoom,
    )
    clampCameraToZoom(reference)
    assert.ok(Math.abs(state.zoom - reference.zoom) < 1e-12)
    assert.ok(Math.abs(state.focus.x / 1200 - 0.5 - reference.x) < 1e-12)
    assert.ok(Math.abs(state.focus.y / 800 - 0.5 - reference.y) < 1e-12)
  }
})
test('Kino keeps camera unchanged during narration holds after speed edits', () => {
  const p = compileProject(
    {
      ...project,
      scenes: [
        { id: 'fast', kind: 'source', fromMs: 0, toMs: 5000, rate: 2 },
        { id: 'hold', kind: 'hold', sourceMs: 4999, durationMs: 1000 },
        { id: 'end', kind: 'source', fromMs: 5000, toMs: 14000 },
      ],
    },
    capture,
  )
  for (const s of p.states.filter((s) => s.hold)) {
    assert.equal(s.zoom, p.states[74].zoom)
    assert.deepEqual(s.focus, p.states[74].focus)
  }
})
test('recorded preset varies real samples and level, limits density and has no default whoosh', () => {
  const plan = compileProject(project, capture),
    events = Array.from({ length: 100 }, (_, i) => ({
      type: 'typing',
      category: 'character',
      t: 1000 + i * 43.7,
    }))
  const cues = subtleCues({ ...plan, events, sound: { preset: 'recorded' } }),
    keys = cues.filter((c) => c.sound.startsWith('recordedKey'))
  assert.ok(new Set(keys.map((c) => c.sound)).size >= 6)
  assert.ok(new Set(keys.map((c) => c.gain)).size >= 6)
  assert.ok(keys.every((c, i) => !i || c.atMs - keys[i - 1].atMs >= 115))
  assert.ok(cues.every((c) => c.sound.startsWith('recorded')))
  assert.deepEqual(mixTrack(cues, 6000), mixTrack(cues, 6000))
})
test('packaged recorded samples are distinct, bounded, and contain physical audio', () => {
  const hashes = new Set()
  for (const name of RECORDED_SOUND_NAMES) {
    const [s] = recordedSound(name)
    assert.ok(s.length > 3000 && s.length < 12000)
    assert.ok(s.every(Number.isFinite))
    assert.ok(Math.max(...s.map(Math.abs)) <= 0.151)
    assert.ok(s.some((v) => Math.abs(v) > 0.05))
    hashes.add(createHash('sha256').update(Buffer.from(s.buffer)).digest('hex'))
  }
  assert.equal(hashes.size, 9)
})
