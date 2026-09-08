import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import puppeteer from 'puppeteer-core'
import { resolveRuntime } from '../../src/runtime/host.mjs'
import { runProcess } from '../../src/runtime/process.mjs'
import { buildScene, scaffoldScene } from '../../src/scenes/build.mjs'
import { compileProject } from '../../src/core/project.mjs'
import { prepareAudio, mixAudioPlan } from '../../src/media/clips.mjs'
import { COMPOSITOR_URL, exportVideo } from '../../src/render/export.mjs'
import { saveCover } from '../../src/render/cover.mjs'
import { chromiumDriver } from '../../src/actions/chromium.mjs'
import { captureChromium } from '../../src/capture/chromium.mjs'
import { renderProject } from '../../src/projects.mjs'
import {
  prepareProject,
  patchProject,
  hashFile,
  describeProject,
} from '../../src/authoring.mjs'
import { loadCapture } from '../../src/capture/artifacts.mjs'
const runtime = await resolveRuntime(),
  dir = mkdtempSync(join(tmpdir(), 'cine authored media ')),
  video = join(dir, 'raw.mp4')
await runProcess(runtime.ffmpeg, [
  '-v',
  'error',
  '-y',
  '-f',
  'lavfi',
  '-i',
  'color=c=navy:size=640x360:rate=10',
  '-t',
  '2',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  video,
])
const audio = join(dir, 'voice.mp3')
await runProcess(runtime.ffmpeg, [
  '-v',
  'error',
  '-y',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=330:sample_rate=48000',
  '-t',
  '1',
  '-c:a',
  'libmp3lame',
  audio,
])
writeFileSync(
  join(dir, 'voice.vtt'),
  'WEBVTT\n\n00:00.100 --> 00:00.900\nNarration fixture\n',
)
const capture = {
  durationMs: 2000,
  displayPoints: { w: 640, h: 360 },
  frames: [
    { t: 0, x: 300, y: 180, l: 0 },
    { t: 2000, x: 300, y: 180, l: 0 },
  ],
}
let browser
try {
  browser = await puppeteer.launch({
    executablePath: runtime.chrome,
    headless: true,
    args: ['--allow-file-access-from-files'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 640, height: 360 })
  await test('ejected module and React scenes render deterministically and isolate CSS', async () => {
    for (const template of ['title', 'metric']) {
      const { entry } = scaffoldScene(template, join(dir, template)),
        project = {
          schemaVersion: 2,
          output: { width: 640, height: 360, fps: 10 },
          scenes: [{ id: template, kind: 'scene', entry, durationMs: 2000 }],
        }
      const plan = compileProject(project, capture),
        customScenes = [await buildScene(plan.layers[0], dir)],
        config = {
          ...plan,
          customScenes,
          assets: {},
          videoUrl: pathToFileURL(video).href,
        }
      await page.goto(COMPOSITOR_URL)
      await page.evaluate((c) => window.init(c), config)
      const hash = async (t) => {
        await page.evaluate((t) => window.step(t), t)
        return createHash('sha256')
          .update(await page.screenshot())
          .digest('hex')
      }
      const direct = await hash(1000)
      await page.evaluate((c) => window.init(c), config)
      for (let t = 0; t < 1000; t += 100) await hash(t)
      assert.equal(await hash(1000), direct)
      await hash(1500)
      await hash(0)
      assert.equal(await hash(1000), direct)
      assert.equal(
        await page.evaluate(() => getComputedStyle(document.body).margin),
        '0px',
      )
    }
  })
  await test('explicit React adapter and seed survive compilation; generated bases stay below overlays', async () => {
    const entry = join(dir, 'react-scene.mjs'),
      overlay = join(dir, 'overlay.html')
    writeFileSync(
      entry,
      `import React from 'react';export default function Scene({seed}){return React.createElement('div',{style:{position:'absolute',inset:0,background:'red'}},'Seed '+seed)}`,
    )
    writeFileSync(
      overlay,
      '<div style="position:absolute;inset:40px;background:blue">Overlay</div>',
    )
    const plan = compileProject(
      {
        schemaVersion: 2,
        output: { width: 640, height: 360, fps: 10 },
        scenes: [
          {
            id: 'base',
            kind: 'scene',
            entry,
            adapter: 'react',
            seed: 42,
            durationMs: 1000,
          },
        ],
        layers: [
          {
            id: 'overlay',
            type: 'custom',
            entry: overlay,
            at: { scene: 'base' },
            durationMs: 1000,
          },
          {
            id: 'badge',
            type: 'badge',
            text: 'Above the scene',
            at: { scene: 'base' },
            durationMs: 1000,
          },
        ],
      },
      capture,
    )
    const customScenes = await Promise.all(
      plan.layers
        .filter((l) => l.type === 'custom')
        .map((l) => buildScene(l, dir)),
    )
    await page.goto(COMPOSITOR_URL)
    await page.evaluate((c) => window.init(c), {
      ...plan,
      customScenes,
      assets: {},
      videoUrl: pathToFileURL(video).href,
    })
    await page.evaluate(() => window.step(500))
    const base = page
      .frames()
      .find((f) => f !== page.mainFrame() && f.name() !== 'unused')
    assert.match(
      await base.evaluate(() => document.body.textContent),
      /Seed 42/,
    )
    const full = createHash('sha256')
      .update(await page.screenshot())
      .digest('hex')
    await page.evaluate(
      () =>
        (document.querySelector('iframe[title="overlay"]').style.visibility =
          'hidden'),
    )
    assert.notEqual(
      createHash('sha256')
        .update(await page.screenshot())
        .digest('hex'),
      full,
    )
    const badgeVisible = createHash('sha256')
      .update(await page.screenshot())
      .digest('hex')
    await page.evaluate(
      () => (document.querySelector('.ov-badge').style.visibility = 'hidden'),
    )
    assert.notEqual(
      createHash('sha256')
        .update(await page.screenshot())
        .digest('hex'),
      badgeVisible,
    )
  })
  await test('headless keyboard shortcuts dispatch modifiers and leave later input unmodified', async () => {
    await page.goto('about:blank')
    await page.setContent('<input id="field" value="old">')
    await page.focus('#field')
    const driver = chromiumDriver(page, await page.createCDPSession())
    // Shift+Home is an editing chord on all supported Chromium hosts.
    await driver.key('End')
    await driver.key('Shift+Home')
    await driver.key('Backspace')
    await page.keyboard.type('replacement')
    assert.equal(await page.$eval('#field', (el) => el.value), 'replacement')
    for (const chord of ['Control+A', 'Meta+A']) {
      await driver.key(chord)
      assert.deepEqual(
        await page.$eval('#field', (el) => [
          el.selectionStart,
          el.selectionEnd,
        ]),
        [0, 11],
      )
      await driver.key('End')
    }
  })
  await test('broken custom code and missing runtime assets report the scene instead of exporting blank frames', async () => {
    for (const [name, code] of [
      ['syntax.mjs', 'export function createScene( {'],
      [
        'crash.tsx',
        'import React from "react";export default function Scene(){throw new Error("deliberate scene failure")}',
      ],
      [
        'image.mjs',
        'export function createScene(root){const i=document.createElement("img");i.src="data:image/png;base64,bm90YW5pbWFnZQ==";root.append(i);return{renderFrame(){}}}',
      ],
    ]) {
      const entry = join(dir, name)
      writeFileSync(entry, code)
      const project = {
          schemaVersion: 2,
          output: { width: 640, height: 360, fps: 10 },
          scenes: [{ id: 'broken', kind: 'scene', entry, durationMs: 100 }],
        },
        plan = compileProject(project, capture)
      await assert.rejects(
        exportVideo({
          plan,
          videoPath: video,
          assetDir: dir,
          outPath: join(dir, 'broken.mp4'),
          runtime,
        }),
        /broken|deliberate|decode|loaded|build|Expected/,
      )
    }
    writeFileSync(join(dir, 'bad.mp3'), 'not audio')
    await assert.rejects(
      prepareAudio([{ id: 'bad', file: 'bad.mp3' }], dir, runtime.ffmpeg),
      (e) => e.code === 'AUDIO_ASSET' && e.path === 'audioClips.bad',
    )
  })
  await test('MP3 audio measures decoded samples, trims captions, ducks effects and exports all tracks', async () => {
    const project = {
      schemaVersion: 2,
      output: { width: 640, height: 360, fps: 10 },
      scenes: [
        { id: 'first', kind: 'source', fromMs: 0, toMs: 500 },
        {
          id: 'explain',
          kind: 'hold',
          sourceMs: 499,
          duration: { audio: 'voice' },
        },
        { id: 'last', kind: 'source', fromMs: 500, toMs: 2000, rate: 2 },
      ],
      audioClips: [
        {
          id: 'voice',
          file: 'voice.mp3',
          at: { scene: 'explain' },
          captions: { file: 'voice.vtt' },
        },
      ],
    }
    const { media } = await prepareAudio(
      project.audioClips,
      dir,
      runtime.ffmpeg,
    )
    assert.ok(Math.abs(media.voice.durationMs - 1000) < 1)
    const plan = compileProject(project, capture, { media })
    assert.equal(plan.captions[0].startMs, 600)
    const mixed = mixAudioPlan(plan, media)
    assert.ok(mixed[0].slice(0, 24000).every((v) => v === 0))
    assert.ok(mixed[0].slice(24000).some((v) => v !== 0))
    await exportVideo({
      plan,
      videoPath: video,
      assetDir: dir,
      outPath: join(dir, 'narrated.mp4'),
      runtime,
      media,
    })
    assert.match(
      readFileSync(join(dir, 'narrated.mp4.vtt'), 'utf8'),
      /00:00:00.600/,
    )
  })
  await test('all cover modes save the chosen picture independently of the timeline', async () => {
    const plan = compileProject(
      {
        schemaVersion: 2,
        output: { width: 640, height: 360, fps: 10 },
        scenes: [{ id: 'all', kind: 'source' }],
      },
      capture,
    )
    writeFileSync(
      join(dir, 'cover.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="red"/></svg>',
    )
    for (const cover of [
      { type: 'frame', atMs: 500 },
      { type: 'image', file: 'cover.svg' },
      { type: 'grid', frames: [100, 500, 1000, 1500] },
      { type: 'scene', template: 'title', props: { head: 'Cover only' } },
    ]) {
      await page.goto(COMPOSITOR_URL)
      const config = {
        ...plan,
        assets: {},
        videoUrl: pathToFileURL(video).href,
      }
      await page.evaluate((c) => window.init(c), config)
      const path = join(dir, cover.type + '.png')
      await saveCover(page, { ...plan, cover }, dir, path, config)
      const bytes = readFileSync(path)
      assert.equal(bytes.readUInt32BE(16), 640)
    }
  })
  await test('agent edits reuse picture, reject stale hashes and preview the same frame as final output', async () => {
    writeFileSync(
      join(dir, 'cursor.jsonl'),
      capture.frames.map((f) => JSON.stringify(f)).join('\n'),
    )
    writeFileSync(
      join(dir, 'meta.json'),
      JSON.stringify({
        ...capture,
        frames: undefined,
        schemaVersion: 1,
        video: 'raw.mp4',
        cursor: 'cursor.jsonl',
        fps: 10,
      }),
    )
    const path = join(dir, 'project.json'),
      project = {
        schemaVersion: 2,
        capture: 'meta.json',
        output: { width: 640, height: 360, fps: 10 },
        scenes: [{ id: 'all', kind: 'source' }],
        layers: [
          {
            id: 'title',
            type: 'title',
            head: 'Precise preview',
            at: { outputMs: 0 },
            durationMs: 2000,
          },
        ],
        audioClips: [{ id: 'voice', file: 'voice.mp3', at: { outputMs: 500 } }],
      }
    writeFileSync(path, JSON.stringify(project))
    await renderProject(path, {
      outPath: join(dir, 'first.mp4'),
      runtime,
      inspectionDir: join(dir, 'full-inspect'),
    })
    const before = hashFile(path)
    await patchProject(
      path,
      [
        {
          op: 'update',
          collection: 'audioClips',
          id: 'voice',
          changes: { gainDb: -6 },
        },
      ],
      { expectedHash: before, runtime },
    )
    await assert.rejects(
      patchProject(path, [], { expectedHash: before, runtime }),
      (e) => e.code === 'PROJECT_CHANGED',
    )
    await renderProject(path, { outPath: join(dir, 'second.mp4'), runtime })
    assert.equal(
      JSON.parse(readFileSync(join(dir, 'second.mp4.artifacts.json'), 'utf8'))
        .pictureCacheHit,
      true,
    )
    for (const name of ['first', 'second'])
      await runProcess(runtime.ffmpeg, [
        '-v',
        'error',
        '-y',
        '-i',
        join(dir, name + '.mp4'),
        '-map',
        '0:v:0',
        '-c:v',
        'copy',
        '-an',
        '-f',
        'h264',
        join(dir, name + '.h264'),
      ])
    assert.equal(
      hashFile(join(dir, 'first.h264')),
      hashFile(join(dir, 'second.h264')),
    )
    await renderProject(path, {
      outPath: join(dir, 'preview.mp4'),
      runtime,
      preview: { fromMs: 1000, toMs: 1500 },
      inspectionDir: join(dir, 'preview-inspect'),
    })
    assert.equal(
      hashFile(join(dir, 'full-inspect', '10.png')),
      hashFile(join(dir, 'preview-inspect', '0.png')),
    )
    assert.ok(readFileSync(join(dir, 'preview.mp4.audio.wav')).length > 44)
    // Reusing an export path must remove sidecars that the new output no longer owns.
    const previewPath = join(dir, 'preview.mp4')
    writeFileSync(path, JSON.stringify({ ...project, audioClips: [] }))
    for (const suffix of ['.vtt', '.srt', '.cover.png', '.cover.json'])
      writeFileSync(previewPath + suffix, 'obsolete')
    await renderProject(path, {
      outPath: previewPath,
      runtime,
      preview: { fromMs: 1000, toMs: 1500 },
    })
    for (const suffix of [
      '.vtt',
      '.srt',
      '.cover.png',
      '.cover.json',
      '.audio.wav',
    ])
      assert.equal(existsSync(previewPath + suffix), false, suffix)
    writeFileSync(
      path,
      JSON.stringify({
        ...project,
        audioClips: [{ ...project.audioClips[0], gainDb: -6 }],
      }),
    )
    const inspected = await prepareProject(path, { runtime })
    assert.equal(inspected.plan.audioClips[0].gainDb, -6)
    const description = describeProject(inspected)
    assert.equal(description.layers[0].id, 'title')
    assert.ok(
      description.assetDependencies.some(
        (a) =>
          a.owner === 'audioClips.voice.file' &&
          a.path === join(dir, 'voice.mp3'),
      ),
    )
  })
  await test('headless capture persists per-character typing events, clear, deletion, and verified action IDs', async () => {
    const html = join(dir, 'typing.html')
    writeFileSync(
      html,
      '<input id="field" value="old"><div id="result"></div><script>field.oninput=()=>result.textContent=field.value</script>',
    )
    await captureChromium({
      url: pathToFileURL(html).href,
      videoPath: join(dir, 'typing', 'raw.mp4'),
      cursorPath: join(dir, 'typing', 'events', 'cursor.jsonl'),
      fps: 10,
      runtime,
      leadInMs: 0,
      tailMs: 50,
      beats: [
        {
          id: 'name',
          type: 'type',
          selector: '#field',
          text: 'Hi👋!',
          typing: { replace: true, cps: 100 },
          moveMs: 0,
          settleMs: 0,
          dwellMs: 0,
          expect: { selector: '#result', text: 'Hi👋!' },
        },
        {
          id: 'delete',
          type: 'key',
          key: 'Backspace',
          dwellMs: 0,
          expect: { selector: '#result', text: 'Hi👋' },
        },
      ],
    })
    const saved = loadCapture(join(dir, 'typing', 'meta.json'))
    assert.equal(saved.actions[0].id, 'name')
    assert.ok(saved.actions[0].milestones.verified > 0)
    assert.equal(
      saved.events.filter((e) => e.category === 'character').length,
      4,
    )
    assert.equal(saved.events.filter((e) => e.category === 'delete').length, 2)
  })
} finally {
  await browser?.close()
  rmSync(dir, { recursive: true, force: true })
}
