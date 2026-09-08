import test from 'node:test'
import assert from 'node:assert/strict'
import { compileProject } from '../src/core/project.mjs'
import { migrateProject } from '../src/core/sequence.mjs'
const capture = {
  durationMs: 3000,
  displayPoints: { w: 640, h: 360 },
  frames: [
    { t: 0, x: 100, y: 100, l: 0 },
    { t: 700, x: 200, y: 100, l: 1 },
    { t: 800, x: 200, y: 100, l: 0 },
    { t: 3000, x: 300, y: 200, l: 0 },
  ],
  actions: [
    {
      id: 'save',
      startMs: 600,
      endMs: 900,
      milestones: { dispatched: 700, verified: 900 },
    },
  ],
}
const project = {
  schemaVersion: 2,
  output: { width: 640, height: 360, fps: 10 },
  scenes: [
    { id: 'first', kind: 'source', fromMs: 0, toMs: 1000 },
    {
      id: 'explain',
      kind: 'hold',
      sourceMs: 999,
      duration: { audio: 'voice' },
    },
    { id: 'rest', kind: 'source', fromMs: 1000, toMs: 3000, rate: 2 },
  ],
  audioClips: [{ id: 'voice', file: 'voice.mp3', at: { scene: 'explain' } }],
}
const media = { voice: { durationMs: 1500 } }
test('audio-sized hold shifts footage and freezes cursor/camera without repeated clicks', () => {
  const p = compileProject(project, capture, { media })
  assert.equal(p.durationMs, 3500)
  assert.equal(p.audioClips[0].startMs, 1000)
  assert.equal(p.states[25].sourceMs, 1000)
  assert.equal(p.clicks.length, 1)
  for (const state of p.states.slice(11, 25)) {
    assert.deepEqual(state.cursor, p.states[10].cursor)
    assert.equal(state.zoom, p.states[10].zoom)
  }
  assert.equal(p.states[24].sourceMs, 999)
})
test('placements map observed milestones through footage rate changes', () => {
  const p = compileProject(
    {
      ...project,
      audioClips: [],
      scenes: [{ id: 'all', kind: 'source', rate: 2 }],
      layers: [
        {
          id: 'label',
          type: 'badge',
          text: 'Saved',
          at: { action: 'save', event: 'verified', offsetMs: 50 },
          durationMs: 200,
        },
      ],
    },
    capture,
  )
  assert.equal(p.layers[0].startMs, 500)
  assert.throws(
    () =>
      compileProject(
        {
          ...project,
          audioClips: [
            {
              ...project.audioClips[0],
              at: { action: 'save', event: 'verified' },
            },
          ],
        },
        { ...capture, actions: [{ ...capture.actions[0], milestones: {} }] },
        { media },
      ),
    /no verified milestone/,
  )
})
test('reject trimmed milestones, duplicate IDs, narration overflow, overlapping speech and cyclic duration references', () => {
  const base = {
    schemaVersion: 2,
    scenes: [{ id: 'trim', kind: 'source', fromMs: 1000, toMs: 3000 }],
    audioClips: [
      { id: 'voice', file: 'x.mp3', at: { action: 'save', event: 'verified' } },
    ],
  }
  assert.throws(
    () => compileProject(base, capture, { media }),
    /outside retained/,
  )
  assert.throws(
    () =>
      compileProject(
        { ...project, scenes: [project.scenes[0], project.scenes[0]] },
        capture,
        { media },
      ),
    /Duplicate/,
  )
  assert.throws(
    () =>
      compileProject(
        {
          ...project,
          audioClips: [{ ...project.audioClips[0], at: { outputMs: 3000 } }],
        },
        capture,
        { media },
      ),
    /exceeds/,
  )
  assert.throws(
    () =>
      compileProject(
        {
          ...project,
          audioClips: [
            ...project.audioClips,
            { id: 'other', file: 'x', at: { outputMs: 1000 } },
          ],
        },
        capture,
        { media: { ...media, other: { durationMs: 1000 } } },
      ),
    /Overlaps/,
  )
  assert.throws(
    () =>
      compileProject(
        {
          ...project,
          scenes: [
            {
              id: 'cycle',
              kind: 'hold',
              sourceMs: 0,
              duration: { scene: 'cycle' },
            },
          ],
        },
        capture,
        { media },
      ),
    (e) => e.code === 'SCHEMA_VALIDATION' && e.path.includes('/duration'),
  )
})
test('v1 migration retains frame state, source timing, overlays and audio without modifying input', () => {
  const v1 = {
    schemaVersion: 1,
    output: { width: 640, height: 360, fps: 10 },
    screen: { startMs: 500 },
    layers: [
      { type: 'title', head: 'Hello', startMs: 0, endMs: 600 },
      {
        type: 'outro',
        head: 'Bye',
        timebase: 'screenEnd',
        startMs: 0,
        endMs: 1000,
      },
    ],
    audioCues: [{ sound: 'tick', timebase: 'source', atMs: 700 }],
  }
  const before = JSON.stringify(v1),
    p = compileProject(v1, capture),
    q = compileProject(migrateProject(v1, capture), capture)
  assert.equal(JSON.stringify(v1), before)
  assert.equal(q.durationMs, p.durationMs)
  assert.deepEqual(
    q.states.map(({ sceneId, hold, ...s }) => s),
    p.states,
  )
  assert.deepEqual(
    q.layers.map(({ id, ...l }) => l),
    p.layers,
  )
  assert.deepEqual(q.audioCues, p.audioCues)
})

test('generated scenes keep their adapter and seed below authored overlays', () => {
  const p = compileProject(
    {
      schemaVersion: 2,
      scenes: [
        {
          id: 'base',
          kind: 'scene',
          entry: 'scene.mjs',
          adapter: 'react',
          seed: 42,
          durationMs: 1000,
        },
      ],
      layers: [
        {
          id: 'annotation',
          type: 'badge',
          text: 'Visible',
          at: { scene: 'base' },
          durationMs: 1000,
        },
      ],
    },
    capture,
  )
  assert.deepEqual(
    p.layers.map((l) => l.id),
    ['base', 'annotation'],
  )
  assert.equal(p.layers[0].adapter, 'react')
  assert.equal(p.layers[0].seed, 42)
})
