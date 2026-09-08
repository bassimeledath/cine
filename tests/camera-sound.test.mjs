import test from 'node:test'
import assert from 'node:assert/strict'
import { compileProject } from '../src/core/project.mjs'
import { subtleCues } from '../src/core/sound.mjs'
import { mixAudioPlan } from '../src/media/clips.mjs'
const capture = {
  durationMs: 3000,
  displayPoints: { w: 640, h: 360 },
  frames: [
    { t: 0, x: 100, y: 100, l: 0 },
    { t: 1000, x: 200, y: 100, l: 1 },
    { t: 1100, x: 200, y: 100, l: 0 },
    { t: 3000, x: 300, y: 200, l: 0 },
  ],
}
const project = {
  schemaVersion: 2,
  output: { width: 640, height: 360, fps: 30 },
  scenes: [{ id: 'all', kind: 'source' }],
}
test('explicit framing has an overview, focus and pull-back without changing Kino spring defaults', () => {
  const plan = compileProject(
    {
      ...project,
      camera: {
        shots: [
          {
            id: 'focus',
            mode: 'focus',
            at: { outputMs: 1000 },
            durationMs: 1000,
            target: { x: 200, y: 100 },
            zoom: 1.5,
          },
        ],
      },
    },
    capture,
  )
  assert.equal(plan.states[20].zoom, 1)
  assert.ok(plan.states[55].zoom > 1.45)
  assert.ok(plan.states[85].zoom < 1.05)
  assert.deepEqual(plan.camera.motion.zoom, {
    stiffness: 200,
    damping: 40,
    mass: 2.25,
  })
  assert.throws(
    () =>
      compileProject(
        { ...project, camera: { motion: { zoom: { mass: 0 } } } },
        capture,
      ),
    (e) =>
      e.code === 'SCHEMA_VALIDATION' && e.path === '/camera/motion/zoom/mass',
  )
})
test('pure pans produce no whoosh and sped-up typing is density limited', () => {
  const segments = [{ fromMs: 0, toMs: 1000, rate: 4, startMs: 0, endMs: 250 }]
  const states = Array.from({ length: 10 }, (_, i) => ({
    t: i * 100,
    active: true,
    zoom: 1,
  }))
  const cues = subtleCues({
    clicks: [],
    segments,
    states,
    events: Array.from({ length: 10 }, (_, i) => ({
      type: 'typing',
      t: i * 50,
      category: 'character',
    })),
  })
  assert.ok(cues.every((c) => c.sound === 'keyTap'))
  assert.equal(cues.length, 2)
})
test('speech ducking lowers effects while narration remains unchanged and silence can mute buses', () => {
  const samples = new Float32Array(48000 * 2).fill(0.1),
    clip = {
      id: 'voice',
      startMs: 0,
      endMs: 1000,
      durationMs: 1000,
      trimInMs: 0,
      gainDb: 0,
      fadeInMs: 0,
      fadeOutMs: 0,
      role: 'narration',
    }
  const plan = {
    states: Array(30),
    fps: 30,
    audioCues: [{ sound: 'pad', atMs: 0, gain: 1 }],
    audioClips: [clip],
    sound: { ducking: { gainDb: -20, attackMs: 0 } },
  }
  const withDuck = mixAudioPlan(plan, { voice: { samples } }),
    without = mixAudioPlan(
      { ...plan, sound: { ducking: { enabled: false } } },
      { voice: { samples } },
    )
  let duckDelta = 0,
    fullDelta = 0
  for (let i = 1000; i < 40000; i++) {
    duckDelta += Math.abs(withDuck[0][i] - 0.1)
    fullDelta += Math.abs(without[0][i] - 0.1)
  }
  assert.ok(duckDelta < fullDelta * 0.12)
  const muted = mixAudioPlan(
    {
      ...plan,
      sound: { buses: { narration: { mute: true }, effects: { mute: true } } },
    },
    { voice: { samples } },
  )
  assert.ok(muted[0].every((x) => x === 0))
})

test('a hold after fast footage preserves the last rendered camera and cursor', () => {
  const p = compileProject(
    {
      ...project,
      scenes: [
        { id: 'fast', kind: 'source', fromMs: 0, toMs: 2000, rate: 2 },
        { id: 'freeze', kind: 'hold', sourceMs: 1999, durationMs: 1000 },
      ],
      camera: {
        shots: [
          {
            id: 'focus',
            mode: 'focus',
            at: { outputMs: 0 },
            durationMs: 2000,
            target: { x: 250, y: 180 },
            zoom: 2,
          },
        ],
      },
    },
    capture,
  )
  const before = p.states[29]
  assert.ok(before.zoom > 1.9)
  for (const held of p.states.slice(30)) {
    assert.equal(held.zoom, before.zoom)
    assert.deepEqual(held.focus, before.focus)
    assert.deepEqual(held.cursor, before.cursor)
  }
})

test('muted narration does not duck audible effects', () => {
  const plan = {
    states: Array(30),
    fps: 30,
    audioCues: [{ sound: 'pad', atMs: 0, gain: 1 }],
    audioClips: [
      {
        id: 'voice',
        role: 'narration',
        startMs: 0,
        endMs: 1000,
        durationMs: 1000,
        trimInMs: 0,
        gainDb: 0,
        fadeInMs: 0,
        fadeOutMs: 0,
      },
    ],
    sound: { buses: { narration: { mute: true } } },
  }
  const media = { voice: { samples: new Float32Array(96000).fill(0.1) } }
  assert.deepEqual(
    mixAudioPlan(plan, media),
    mixAudioPlan({ ...plan, audioClips: [] }, {}),
  )
})

test('scene framing overrides and partial springs inherit without leaking to other scenes', () => {
  const plan = compileProject(
    {
      ...project,
      camera: {
        motion: { zoom: { stiffness: 150 } },
        shots: [
          {
            id: 'zoom',
            mode: 'focus',
            at: { outputMs: 0 },
            durationMs: 3000,
            zoom: 2,
            target: { x: 250, y: 180 },
          },
        ],
      },
      scenes: [
        { id: 'focus', kind: 'source', fromMs: 0, toMs: 1000 },
        {
          id: 'context',
          kind: 'source',
          fromMs: 1000,
          toMs: 2000,
          camera: { policy: 'off', motion: { zoom: { damping: 44 } } },
        },
        { id: 'return', kind: 'source', fromMs: 2000, toMs: 3000 },
      ],
    },
    capture,
  )
  assert.ok(plan.states[29].zoom > 1.9)
  assert.ok(plan.states[59].zoom < 1.1)
  assert.ok(plan.states[89].zoom > 1.9)
  assert.equal(plan.camera.sceneMotion.context.zoom.stiffness, 150)
  assert.equal(plan.camera.sceneMotion.context.zoom.damping, 44)
})

test('rectangle shots center and fit the requested region', () => {
  const plan = compileProject(
    {
      ...project,
      camera: {
        shots: [
          {
            id: 'rect',
            mode: 'focus',
            at: { outputMs: 0 },
            durationMs: 3000,
            target: { x: 200, y: 100, w: 200, h: 120 },
          },
        ],
      },
    },
    capture,
  )
  const shot = plan.camera.shots[0]
  assert.deepEqual(shot.target, { x: 300, y: 160 })
  assert.ok(shot.zoom > 2 && shot.zoom < 2.3)
})

test('per-clip mute preserves timing while removing speech, captions, and ducking', () => {
  const p = {
    ...project,
    audioClips: [
      { id: 'voice', file: 'voice.mp3', at: { outputMs: 0 }, mute: true },
    ],
  }
  const media = {
    voice: {
      durationMs: 1000,
      samples: new Float32Array(96000).fill(0.1),
      captions: [{ startMs: 0, endMs: 1000, text: 'Voice' }],
    },
  }
  const plan = compileProject(p, capture, { media })
  assert.equal(plan.audioClips[0].durationMs, 1000)
  assert.equal(plan.captions.length, 0)
  assert.deepEqual(
    mixAudioPlan(plan, media),
    mixAudioPlan({ ...plan, audioClips: [] }, {}),
  )
})
