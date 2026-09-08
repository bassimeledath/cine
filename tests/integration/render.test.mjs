import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import puppeteer from 'puppeteer-core'
import { resolveRuntime } from '../../src/runtime/host.mjs'
import { runProcess } from '../../src/runtime/process.mjs'
import { compileProject } from '../../src/core/project.mjs'
import { exportVideo, COMPOSITOR_URL } from '../../src/render/export.mjs'

const runtime = await resolveRuntime()
const dir = mkdtempSync(join(tmpdir(), 'cine integration path with spaces '))
const video = join(dir, 'source video.mp4')
await runProcess(runtime.ffmpeg, [
  '-y',
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=640x360:rate=10',
  '-t',
  '2',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  video,
])
const capture = {
  durationMs: 2000,
  displayPoints: { w: 640, h: 360 },
  frames: [
    { t: 0, x: 160, y: 200, l: 0 },
    { t: 500, x: 450, y: 160, l: 1 },
    { t: 590, x: 450, y: 160, l: 0 },
    { t: 2000, x: 450, y: 160, l: 0 },
  ],
}
const project = {
  schemaVersion: 1,
  output: { width: 640, height: 360, fps: 10 },
  zoomRanges: [{ start: 200, end: 1800, zoom: 1.5, fx: 450, fy: 160 }],
  layers: [{ type: 'badge', text: 'Fixture', startMs: 0, endMs: 2000 }],
}
let browser
try {
  browser = await puppeteer.launch({
    executablePath: runtime.chrome,
    headless: true,
    args: ['--allow-file-access-from-files'],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 640, height: 360, deviceScaleFactor: 1 })
  await page.goto(COMPOSITOR_URL)
  const init = async (p = project) => {
    const plan = compileProject(p, capture)
    await page.evaluate((c) => window.init(c), {
      ...plan,
      assets: {},
      videoUrl: pathToFileURL(video).href,
    })
    return plan
  }
  await test('real compositor produces identical pixels for direct, sequential, backward and reinitialized evaluation', async () => {
    const hash = async (t) => {
      await page.evaluate((t) => window.step(t), t)
      return createHash('sha256')
        .update(await page.screenshot())
        .digest('hex')
    }
    await init()
    const direct = await hash(1000)
    await init()
    for (let t = 0; t < 1000; t += 100)
      await page.evaluate((t) => window.step(t), t)
    assert.equal(await hash(1000), direct)
    const first = await hash(0)
    await hash(1500)
    assert.equal(await hash(0), first)
    await init()
    assert.equal(
      await page.evaluate(() => document.querySelectorAll('.ov').length),
      1,
    )
    assert.equal(await hash(1000), direct)
  })
  await test('a source overlay stays visible at a contiguous speed boundary', async () => {
    await init({
      ...project,
      screen: {
        segments: [
          { fromMs: 0, toMs: 1000, rate: 1 },
          { fromMs: 1000, toMs: 2000, rate: 2 },
        ],
      },
      layers: [
        {
          type: 'badge',
          text: 'Continuous',
          timebase: 'source',
          startMs: 0,
          endMs: 2000,
        },
      ],
    })
    await page.evaluate(() => window.step(1000))
    const opacity = await page.evaluate(
      () => getComputedStyle(document.querySelector('.ov')).opacity,
    )
    assert.equal(Number(opacity), 1)
  })
  await test('alternate and portrait dimensions cover the viewport and center overlays', async () => {
    for (const [width, height] of [
      [960, 540],
      [540, 960],
    ]) {
      await page.setViewport({ width, height, deviceScaleFactor: 1 })
      await init({
        ...project,
        output: { width, height, fps: 10 },
        layers: [
          { type: 'title', head: 'Release ready', startMs: 0, endMs: 2000 },
        ],
      })
      await page.evaluate(() => window.step(1000))
      const png = await page.screenshot()
      assert.equal(png.readUInt32BE(16), width)
      assert.equal(png.readUInt32BE(20), height)
      const bounds = await page.evaluate(() => {
        const r = document.querySelector('.ov-title').getBoundingClientRect()
        return { width: r.width, height: r.height }
      })
      assert.ok(Math.abs(bounds.width - width) < 1)
      assert.ok(Math.abs(bounds.height - height) < 1)
    }
  })
  await test('image backgrounds honor contain and custom cursor hotspots retain size under zoom', async () => {
    await page.setViewport({ width: 640, height: 360, deviceScaleFactor: 1 })
    const data = (svg) =>
      'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
    const background = data(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><path fill="#00ff00" d="M0 0h100v100H0z"/></svg>',
    )
    const cursor = data(
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="#ff00ff" d="M0 0h32v32H0z"/></svg>',
    )
    for (const zoom of [1, 2]) {
      const source = {
        ...capture,
        frames: [
          { t: 0, x: 320, y: 180, l: 0 },
          { t: 2000, x: 320, y: 180, l: 0 },
        ],
      }
      const plan = compileProject(
        {
          ...project,
          layers: [],
          settings: {
            shadowEnabled: false,
            backgroundType: 'image',
            backgroundImage: 'fixture.svg',
            backgroundFit: 'contain',
            backgroundGradientFrom: '#123456',
            cursorType: 'image',
            cursorImage: 'cursor.svg',
            cursorHotspot: { x: 0.25, y: 0.75 },
            cursorSmoothing: false,
          },
          zoomRanges: [{ start: 0, end: 2000, zoom, fx: 320, fy: 180 }],
        },
        source,
      )
      await page.evaluate((c) => window.init(c), {
        ...plan,
        assets: { backgroundImage: background, cursorImage: cursor },
        videoUrl: pathToFileURL(video).href,
      })
      await page.evaluate(() => window.step(1000))
      const pixels = await page.evaluate(() => {
        const c = document.querySelector('canvas').getContext('2d'),
          get = (x, y) =>
            Array.from(c.getImageData(x, y, 1, 1).data).slice(0, 3)
        // Cursor width is 36*1.5*1.55*(360/1080)=27.9 output pixels.
        return {
          center: get(320, 180),
          insideLeft: get(315, 170),
          outsideLeft: get(310, 170),
          insideBottom: get(320, 184),
          outsideBottom: get(320, 190),
          letterbox: get(5, 5),
          image: get(320, 5),
        }
      })
      assert.deepEqual(pixels.center, [255, 0, 255])
      assert.deepEqual(pixels.insideLeft, [255, 0, 255])
      assert.deepEqual(pixels.insideBottom, [255, 0, 255])
      assert.notDeepEqual(pixels.outsideLeft, [255, 0, 255])
      assert.notDeepEqual(pixels.outsideBottom, [255, 0, 255])
      assert.deepEqual(pixels.letterbox, [18, 52, 86])
      assert.deepEqual(pixels.image, [0, 255, 0])
    }
  })
  await test('invalid image decode cleans up browser and render scratch', async () => {
    writeFileSync(join(dir, 'bad.png'), 'not an image')
    const before = new Set(
      readdirSync(tmpdir()).filter((n) => n.startsWith('cine-render-')),
    )
    const plan = compileProject(
      {
        ...project,
        settings: { backgroundType: 'image', backgroundImage: 'bad.png' },
      },
      capture,
    )
    await assert.rejects(
      exportVideo({
        plan,
        videoPath: video,
        assetDir: dir,
        outPath: join(dir, 'bad.mp4'),
        runtime,
      }),
      /decoded/,
    )
    assert.deepEqual(
      readdirSync(tmpdir()).filter(
        (n) => n.startsWith('cine-render-') && !before.has(n),
      ),
      [],
    )
  })
  await test('failed encoder cleans its frame files', async () => {
    const before = new Set(
      readdirSync(tmpdir()).filter((n) => n.startsWith('cine-render-')),
    )
    const plan = compileProject(
      { ...project, screen: { segments: [{ fromMs: 0, toMs: 100, rate: 1 }] } },
      capture,
    )
    await assert.rejects(
      exportVideo({
        plan,
        videoPath: video,
        assetDir: dir,
        outPath: join(dir, 'bad-encoder.mp4'),
        runtime: { ...runtime, ffmpeg: '/not/a/real/encoder' },
      }),
      /failed/,
    )
    assert.deepEqual(
      readdirSync(tmpdir()).filter(
        (n) => n.startsWith('cine-render-') && !before.has(n),
      ),
      [],
    )
  })
} finally {
  if (browser) await browser.close()
  rmSync(dir, { recursive: true, force: true })
}
