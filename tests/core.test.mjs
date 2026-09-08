import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
  readdirSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  compileSegments,
  sourceAt,
  outputAt,
  mapLayers,
  mapCues,
} from '../src/core/timeline.mjs'
import { compileProject } from '../src/core/project.mjs'
import { findClicks } from '../src/core/events.mjs'
import { buildZoomRanges } from '../src/autozoom.mjs'
import { saveCapture, loadCapture } from '../src/capture/artifacts.mjs'
import { authorProject } from '../src/projects.mjs'
import { loadAssets } from '../src/render/assets.mjs'
import { mixTrack } from '../src/media/audio.mjs'

const capture = {
  durationMs: 2000,
  displayPoints: { w: 1000, h: 600 },
  frames: [
    { t: 0, x: 0, y: 100, l: 0 },
    { t: 500, x: 500, y: 100, l: 1 },
    { t: 590, x: 500, y: 100, l: 0 },
    { t: 2000, x: 700, y: 300, l: 0 },
  ],
}
const project = {
  schemaVersion: 1,
  output: { width: 960, height: 540, fps: 30 },
  zoomRanges: [{ start: 300, end: 1700, zoom: 1.5, fx: 500, fy: 100 }],
}

test('source/output mapping respects speed, trim, boundary ownership and lead-in', () => {
  const s = compileSegments(
    [
      { fromMs: 100, toMs: 1100, rate: 2 },
      { fromMs: 1500, toMs: 2000, rate: 0.5 },
    ],
    2000,
    300,
  )
  assert.equal(s.at(-1).endMs, 1800)
  assert.equal(sourceAt(s, 299), null)
  assert.equal(sourceAt(s, 300), 100)
  assert.equal(sourceAt(s, 800), 1500)
  assert.equal(sourceAt(s, 1799), 1999.5)
  assert.equal(sourceAt(s, 1800), null)
  assert.equal(outputAt(s, 1200), null)
  assert.equal(outputAt(s, 1600), 1000)
})
test('reject unordered, out-of-range and unsupported speed segments', () => {
  for (const segments of [
    [],
    [{ fromMs: 0, toMs: 2200 }],
    [{ fromMs: 200, toMs: 100 }],
    [{ fromMs: 0, toMs: 100, rate: 0 }],
    [
      { fromMs: 0, toMs: 1000 },
      { fromMs: 900, toMs: 1500 },
    ],
  ]) {
    assert.throws(() => compileSegments(segments, 2000))
  }
})
test('source overlays split over a cut; source cues disappear in trimmed portions', () => {
  const s = compileSegments(
    [
      { fromMs: 0, toMs: 500, rate: 1 },
      { fromMs: 1000, toMs: 2000, rate: 2 },
    ],
    2000,
  )
  assert.deepEqual(
    mapLayers(
      [{ type: 'lower', timebase: 'source', startMs: 200, endMs: 1300 }],
      s,
    ).map((l) => [l.startMs, l.endMs]),
    [
      [200, 500],
      [500, 650],
    ],
  )
  assert.deepEqual(
    mapCues(
      [
        { sound: 'tick', atMs: 750, timebase: 'source' },
        { sound: 'tick', atMs: 1200, timebase: 'source' },
      ],
      s,
    ).map((c) => c.atMs),
    [600],
  )
  assert.equal(
    mapLayers(
      [{ type: 'outro', timebase: 'screenEnd', startMs: 0, endMs: 500 }],
      s,
    )[0].startMs,
    1000,
  )
})
test('source overlays stay continuous through speed changes without restarting animations', () => {
  const segments = compileSegments(
    [
      { fromMs: 0, toMs: 1000, rate: 1 },
      { fromMs: 1000, toMs: 2000, rate: 2 },
    ],
    2000,
  )
  const layer = { type: 'badge', timebase: 'source', startMs: 200, endMs: 1800 }
  assert.deepEqual(mapLayers([layer], segments), [
    { ...layer, timebase: 'output', startMs: 200, endMs: 1400 },
  ])
})
test('frame evaluation is an immutable lookup and identity compile is repeatable', () => {
  const p = compileProject(project, capture),
    q = compileProject(project, capture)
  assert.deepEqual(p.states, q.states)
  const before = JSON.stringify(p.states)
  assert.ok(p.states[30].zoom > 1.4)
  assert.equal(p.states[0].zoom, 1)
  for (const index of [30, 0, 45, 3, 30])
    assert.deepEqual(p.states[index], q.states[index])
  assert.equal(JSON.stringify(p.states), before)
})
test('trim initializes cursor from retained source and click effects use output time', () => {
  const p = compileProject(
    {
      ...project,
      screen: {
        startMs: 100,
        segments: [{ fromMs: 500, toMs: 1500, rate: 2 }],
      },
    },
    capture,
  )
  assert.equal(p.clicks[0].t, 100)
  assert.equal(p.states[3].cursor.x, 500)
  assert.equal(p.states[0].active, false)
})
test('click edges do not count a held button twice; distant clicks stay separate', () => {
  const f = [
    { t: 0, x: 0, y: 0, l: 0 },
    { t: 500, x: 0, y: 0, l: 1 },
    { t: 550, x: 0, y: 0, l: 1 },
    { t: 600, x: 0, y: 0, l: 0 },
    { t: 1200, x: 900, y: 600, l: 1 },
  ]
  assert.equal(findClicks(f).length, 2)
  const ranges = buildZoomRanges(f)
  assert.equal(ranges.length, 2)
  assert.equal(ranges[0].end, ranges[1].start)
})
test('project rejects invalid dimensions, settings, zooms, layers and cues', () => {
  for (const change of [
    { output: { width: 961 } },
    { settings: { backgroundType: 'image' } },
    { settings: { alwaysKeepZoomedIn: true } },
    { settings: { cursorHotspot: { x: 2, y: 0 } } },
    { zoomRanges: [{ start: 0, end: 1, zoom: 0, fx: 0, fy: 0 }] },
    { layers: [{ type: 'unknown', startMs: 0, endMs: 100 }] },
    { audioCues: [{ sound: 'unknown', atMs: 0 }] },
  ]) {
    assert.throws(() => compileProject({ ...project, ...change }, capture))
  }
})
test('capture artifacts normalize the clock once and author project references are relative', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cine contract '))
  try {
    const videoPath = join(dir, 'raw.mp4'),
      cursorPath = join(dir, 'cursor.jsonl')
    writeFileSync(videoPath, 'fixture')
    writeFileSync(
      cursorPath,
      capture.frames
        .map((f) => JSON.stringify({ ...f, t: f.t + 10000 }))
        .join('\n'),
    )
    const saved = saveCapture({
      videoPath,
      cursorPath,
      videoT0: 10000,
      durationMs: 2000,
      displayPoints: capture.displayPoints,
      fps: 30,
      backend: 'fixture',
    })
    const loaded = loadCapture(saved.manifestPath)
    assert.deepEqual(loaded.frames, capture.frames)
    assert.equal(loaded.clockOriginMs, 10000)
    const path = join(dir, 'edits', 'project.json'),
      p = authorProject(saved.manifestPath, path)
    assert.equal(p.capture, '../meta.json')
    assert.equal(loadCapture(saved.manifestPath).frames[0].t, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
test('capture manifests preserve cursor paths in separate directories and remain relocatable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cine split paths '))
  try {
    mkdirSync(join(dir, 'events'))
    const videoPath = join(dir, 'raw.mp4'),
      cursorPath = join(dir, 'events', 'cursor.jsonl')
    writeFileSync(
      cursorPath,
      capture.frames.map((f) => JSON.stringify(f)).join('\n'),
    )
    const saved = saveCapture({
      videoPath,
      cursorPath,
      videoT0: 0,
      durationMs: 2000,
      displayPoints: capture.displayPoints,
      fps: 30,
      backend: 'fixture',
    })
    assert.equal(saved.cursor, 'events/cursor.jsonl')
    assert.deepEqual(loadCapture(saved.manifestPath).frames, capture.frames)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
test('legacy manifest loads without modifying the original cursor file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cine legacy '))
  try {
    writeFileSync(
      join(dir, 'meta.json'),
      JSON.stringify({
        durationMs: 2000,
        displayPoints: capture.displayPoints,
        videoT0: 10000,
      }),
    )
    const text = capture.frames
      .map((f) => JSON.stringify({ ...f, t: f.t + 10000 }))
      .join('\n')
    writeFileSync(join(dir, 'cursor.jsonl'), text)
    assert.deepEqual(loadCapture(join(dir, 'meta.json')).frames, capture.frames)
    assert.equal(readFileSync(join(dir, 'cursor.jsonl'), 'utf8'), text)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
test('asset loader reports missing/unsupported files and resolves relative paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cine assets '))
  try {
    writeFileSync(
      join(dir, 'cursor.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
    )
    assert.ok(
      loadAssets({ cursorImage: 'cursor.svg' }, dir).cursorImage.startsWith(
        'data:image/svg+xml;base64,',
      ),
    )
    assert.throws(() => loadAssets({ backgroundImage: 'missing.png' }, dir))
    assert.throws(() => loadAssets({ cursorImage: 'cursor.txt' }, dir))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
test('generated audio is deterministic and only contains signal after the cue', () => {
  const cues = [{ sound: 'tick', atMs: 200 }],
    a = mixTrack(cues, 500),
    b = mixTrack(cues, 500)
  assert.deepEqual(a, b)
  assert.ok(a[0].slice(0, 9600).every((x) => x === 0))
  assert.ok(a[0].slice(9600).some((x) => x !== 0))
})
test('portable core/render/media have no dependency on platform adapters or host discovery', () => {
  const visited = new Set()
  function walk(path) {
    path = resolve(path)
    if (visited.has(path)) return
    visited.add(path)
    assert.ok(
      !path.includes('/platform/') && !path.endsWith('/runtime/host.mjs'),
      `platform coupling: ${path}`,
    )
    const source = readFileSync(path, 'utf8')
    for (const match of source.matchAll(
      /(?:from\s*|import\s*)['"]([^'"]+)['"]/g,
    )) {
      if (match[1].startsWith('.')) walk(resolve(path, '..', match[1]))
    }
  }
  for (const dir of ['src/core', 'src/render', 'src/media'])
    for (const file of readdirSync(dir))
      if (file.endsWith('.mjs')) walk(join(dir, file))
})
