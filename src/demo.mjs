// End-to-end autonomous demo: launch the page, record the screen while a
// scripted driver operates it with the real cursor, then author zooms and
// render the cinematic cut. No human in the loop.

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readFileSync, writeFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

import { startCapture } from './capture.mjs'
import { captureWeb } from './capture-web.mjs'
import { buildZoomRanges } from './autozoom.mjs'
import { render } from './render.mjs'
import { clickElement, glideTo, sleep, hasCliclick } from './drive.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DEMO_PAGE = join(HERE, '..', 'demo', 'index.html')
const ELECTRON_APP = join(HERE, '..', 'demo', 'electron-app')

/** The demo beat sheet. Pacing is the whole game — each click needs room to
 *  land before the next move starts, or the viewer can't follow it. */
const SCRIPT = [
  { selector: '#refresh', dwellMs: 2200, label: 'Refresh data' },
  { selector: '#deploy', dwellMs: 2600, label: 'Deploy to production' },
  { selector: '.tab[data-tab="Reports"]', dwellMs: 2000, label: 'Reports tab' },
  { selector: '.tab[data-tab="Alerts"]', dwellMs: 2200, label: 'Alerts tab' },
]

/**
 * Fully headless demo. No display, no cursor takeover, deterministic.
 * Reuses stages 2 and 3 untouched — only the capture backend differs.
 */
export async function runWebDemo({
  outPath = join(homedir(), 'Downloads', 'cine-demo.mp4'),
  displayPoints = { w: 1470, h: 956 },
  fps = 30,
  url = pathToFileURL(DEMO_PAGE).href,
  connectTo,
  beats = SCRIPT,
} = {}) {
  const work = mkdtempSync(join(tmpdir(), 'cine-web-'))
  const videoPath = join(work, 'raw.mp4')
  const cursorPath = join(work, 'cursor.jsonl')

  console.log(connectTo ? `attaching to ${connectTo}...` : 'capturing headlessly...')
  const { videoT0, durationMs, displayPoints: actualPoints } = await captureWeb({
    url,
    connectTo,
    beats,
    videoPath,
    cursorPath,
    displayPoints,
    fps,
    onProgress: (ms, total) => {
      const step = 2000
      if (Math.floor(ms / step) !== Math.floor((ms - 10) / step)) {
        console.log(`  capture ${(ms / 1000).toFixed(0)}s / ${(total / 1000).toFixed(0)}s`)
      }
    },
  })
  console.log(`captured ${(durationMs / 1000).toFixed(1)}s`)

  const frames = readFileSync(cursorPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const zoomRanges = buildZoomRanges(frames)
  console.log(`authored ${zoomRanges.length} zoom range(s) from ${frames.length} cursor samples`)
  if (!zoomRanges.length) console.warn('WARNING: no clicks in the cursor track — output will not zoom')

  console.log('rendering...')
  await render({
    video: videoPath,
    cursor: cursorPath,
    zoomRanges,
    durationMs,
    fps,
    displayPoints: actualPoints ?? displayPoints,
    videoT0,
    settings: {},
    outPath,
  })
  return outPath
}

/** Beat sheet for the bundled Electron demo app. */
export const ELECTRON_SCRIPT = [
  { selector: '#sync', dwellMs: 2000, label: 'Sync' },
  { selector: '#deploy', dwellMs: 2600, label: 'Deploy' },
  { selector: '.item[data-view="Services"]', dwellMs: 2000, label: 'Services' },
  { selector: '.item[data-view="Incidents"]', dwellMs: 2200, label: 'Incidents' },
]

/** UI elements worth being able to point at later. Resolved at capture time
 *  and saved with the artifacts, so an overlay pass can anchor to them without
 *  the app still being alive. */
export const ELECTRON_ANCHORS = [
  '#sync', '#deploy', '#m1', '#m2', '#m3',
  '#list .row:first-child', '.item[data-view="Incidents"]',
]

/**
 * Capture only — launch the app, drive it, and leave raw.mp4 + cursor.jsonl +
 * meta.json in `workDir`. Splitting this out is what makes an edit cheap: the
 * render is a pure function of these artifacts, so retiming an overlay or
 * changing a sound is a re-render, not a re-recording.
 */
export async function captureElectron({ workDir, fps = 30, port = 9223 }) {
  const electronBin = createRequire(import.meta.url)('electron')
  console.log('launching bundled Electron demo app...')
  const proc = spawn(electronBin, [ELECTRON_APP], {
    env: { ...process.env, CINE_CDP_PORT: String(port) },
    stdio: 'ignore',
  })
  try {
    await waitForCdp(`http://localhost:${port}`)
    await sleep(600)
    const videoPath = join(workDir, 'raw.mp4')
    const cursorPath = join(workDir, 'cursor.jsonl')
    console.log(`attaching to http://localhost:${port}...`)
    const meta = await captureWeb({
      connectTo: `http://localhost:${port}`,
      beats: ELECTRON_SCRIPT,
      anchorSelectors: ELECTRON_ANCHORS,
      videoPath,
      cursorPath,
      fps,
    })
    const { videoT0, durationMs, displayPoints, anchors } = meta
    writeFileSync(
      join(workDir, 'meta.json'),
      JSON.stringify({ videoT0, durationMs, displayPoints, anchors, fps }, null, 2),
    )
    console.log(`captured ${(durationMs / 1000).toFixed(1)}s -> ${workDir}`)
    return { videoPath, cursorPath, videoT0, durationMs, displayPoints, anchors, fps }
  } finally {
    proc.kill()
  }
}

/** Poll a CDP endpoint until the host is accepting connections. */
async function waitForCdp(base, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/json/version`)
      if (res.ok) return
    } catch { /* not up yet */ }
    await sleep(200)
  }
  throw new Error(`no CDP endpoint at ${base} after ${timeoutMs}ms`)
}

/**
 * Record an Electron app. Attaches over CDP exactly like the web backend —
 * Electron *is* Chromium — so capture, cursor authoring, auto-zoom and the
 * compositor are all unchanged.
 *
 * Caveat worth knowing: Page.screencast captures the WebContents, not the
 * window. Native title bars, menus, dialogs, and any additional BrowserWindow
 * are not in the frame.
 */
export async function runElectronDemo({
  outPath = join(homedir(), 'Downloads', 'cine-electron-demo.mp4'),
  fps = 30,
  connectTo,
  port = 9223,
} = {}) {
  // Attach to someone else's already-running app and leave it alone.
  if (connectTo) {
    return runWebDemo({ outPath, fps, connectTo, beats: ELECTRON_SCRIPT })
  }

  const electronBin = createRequire(import.meta.url)('electron')
  console.log('launching bundled Electron demo app...')
  const proc = spawn(electronBin, [ELECTRON_APP], {
    env: { ...process.env, CINE_CDP_PORT: String(port) },
    stdio: 'ignore',
  })
  try {
    await waitForCdp(`http://localhost:${port}`)
    await sleep(600) // let first paint settle
    return await runWebDemo({
      outPath,
      fps,
      connectTo: `http://localhost:${port}`,
      beats: ELECTRON_SCRIPT,
    })
  } finally {
    proc.kill()
  }
}

export async function runDemo({
  outPath = join(homedir(), 'Downloads', 'cine-demo.mp4'),
  displayPoints = { w: 1470, h: 956 },
  fps = 30,
  leadInMs = 1400,
  tailMs = 1600,
} = {}) {
  if (!(await hasCliclick())) {
    throw new Error('cliclick not found — install with: brew install cliclick')
  }

  const work = mkdtempSync(join(tmpdir(), 'cine-demo-'))
  const videoPath = join(work, 'raw.mp4')
  const cursorPath = join(work, 'cursor.jsonl')

  console.log('launching demo page...')
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--kiosk', '--no-default-browser-check', '--disable-infobars', '--hide-crash-restore-bubble'],
  })

  let capture = null
  try {
    const page = (await browser.pages())[0] ?? (await browser.newPage())
    await page.goto(pathToFileURL(DEMO_PAGE).href, { waitUntil: 'load' })
    await sleep(800) // let the bar animation settle before we start recording

    console.log('starting capture...')
    capture = await startCapture({ videoPath, cursorPath, fps })
    console.log(`  video t0 locked`)

    // Park the cursor somewhere neutral, then hold for a beat so the video
    // opens on a calm, un-zoomed frame.
    let cursor = { x: displayPoints.w * 0.5, y: displayPoints.h * 0.72 }
    await glideTo({ x: cursor.x, y: cursor.y + 60 }, cursor, 200)
    await sleep(leadInMs)

    for (const beat of SCRIPT) {
      console.log(`  → ${beat.label}`)
      cursor = await clickElement(page, cursor, beat.selector)
      await sleep(beat.dwellMs)
    }

    await sleep(tailMs)

    const { videoT0, durationMs } = await capture.stop()
    capture = null
    console.log(`captured ${(durationMs / 1000).toFixed(1)}s`)

    await browser.close()

    // --- author zooms from the real cursor track ---
    const frames = readFileSync(cursorPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    const zoomRanges = buildZoomRanges(frames)
    console.log(`authored ${zoomRanges.length} zoom range(s) from ${frames.length} cursor samples`)
    if (!zoomRanges.length) {
      console.warn('WARNING: no clicks detected in the cursor log — output will not zoom')
    }

    console.log('rendering...')
    await render({
      video: videoPath,
      cursor: cursorPath,
      zoomRanges,
      durationMs,
      fps,
      displayPoints,
      videoT0,
      settings: {},
      outPath,
    })
    return outPath
  } finally {
    if (capture) await capture.stop().catch(() => {})
    if (browser.connected) await browser.close().catch(() => {})
  }
}
