import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import puppeteer from 'puppeteer-core'
import { runActions } from '../actions/runner.mjs'
import { chromiumDriver } from '../actions/chromium.mjs'
import { sleep } from '../runtime/process.mjs'
import { encodeFrames } from '../media/ffmpeg.mjs'
import { saveCapture } from './artifacts.mjs'

async function readAnchors(page, selectors) {
  return page.evaluate(
    (selectors) =>
      Object.fromEntries(
        selectors.map((selector) => {
          const el = document.querySelector(selector)
          if (!el) return [selector, null]
          let r = el.getBoundingClientRect()
          if (el.childNodes.length === 1 && el.firstChild.nodeType === 3) {
            const range = document.createRange()
            range.selectNodeContents(el)
            const text = range.getBoundingClientRect()
            if (text.width && text.height) r = text
          }
          const visible =
            r.width &&
            r.height &&
            r.bottom > 0 &&
            r.top < innerHeight &&
            r.right > 0 &&
            r.left < innerWidth &&
            getComputedStyle(el).visibility !== 'hidden'
          return [
            selector,
            visible
              ? {
                  x: r.x + r.width / 2,
                  y: r.y + r.height / 2,
                  w: r.width,
                  h: r.height,
                }
              : null,
          ]
        }),
      ),
    selectors,
  )
}

/** Recording session is independent of the action producer and executor. */
export async function startChromiumRecording(
  page,
  { videoPath, cursorPath, fps, runtime, displayPoints, anchorSelectors = [] },
) {
  mkdirSync(dirname(videoPath), { recursive: true })
  mkdirSync(dirname(cursorPath), { recursive: true })
  const dir = mkdtempSync(join(tmpdir(), 'cine-capture-'))
  let client
  try {
    client = await page.createCDPSession()
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw error
  }
  const shots = [],
    frames = [],
    actions = [],
    events = [],
    anchorTrack = []
  let recording = true,
    monitor,
    stopping,
    finalizing = false,
    recordingError
  client.on('Page.screencastFrame', (f) => {
    if (finalizing) return
    try {
      const file = join(dir, `shot_${shots.length}.jpg`)
      writeFileSync(file, Buffer.from(f.data, 'base64'))
      shots.push({ t: f.metadata.timestamp * 1000, file })
    } catch (error) {
      recordingError = error
    }
    client
      .send('Page.screencastFrameAck', { sessionId: f.sessionId })
      .catch(() => {})
  })
  const cleanup = async () => {
    recording = false
    if (monitor) await monitor
    try {
      await client.send('Page.stopScreencast')
    } catch {
      /* Host may have closed. */
    }
    finalizing = true
    await client.detach().catch(() => {})
  }
  try {
    await client.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 92,
      everyNthFrame: 1,
    })
    const deadline = Date.now() + 5000
    while (!shots.length) {
      if (recordingError) throw recordingError
      if (Date.now() > deadline)
        throw new Error('Screencast produced no initial frame')
      await sleep(20)
    }
    monitor = (async () => {
      while (recording) {
        if (anchorSelectors.length) {
          try {
            anchorTrack.push({
              t: Date.now(),
              anchors: await readAnchors(page, anchorSelectors),
            })
          } catch {
            /* Navigations can briefly destroy the execution context. */
          }
        }
        await sleep(100)
      }
    })()
  } catch (error) {
    await cleanup()
    rmSync(dir, { recursive: true, force: true })
    throw error
  }
  return {
    client,
    emit: (sample) => frames.push(sample),
    onAction: (action) => actions.push(action),
    onEvent: (event) => events.push(event),
    stop() {
      stopping ??= (async () => {
        const stopAt = Date.now()
        try {
          await cleanup()
          if (recordingError) throw recordingError
          if (!frames.length)
            throw new Error('Recording needs observed cursor samples')
          shots.sort((a, b) => a.t - b.t)
          frames.sort((a, b) => a.t - b.t)
          const videoT0 = shots[0].t,
            durationMs = stopAt - videoT0
          const count = Math.ceil((durationMs * fps) / 1000)
          let index = 0
          for (let i = 0; i < count; i++) {
            const t = videoT0 + (i * 1000) / fps
            while (index + 1 < shots.length && shots[index + 1].t <= t) index++
            copyFileSync(
              shots[index].file,
              join(dir, `f_${String(i).padStart(6, '0')}.jpg`),
            )
          }
          writeFileSync(
            cursorPath,
            frames.map((f) => JSON.stringify(f)).join('\n') + '\n',
          )
          await encodeFrames({
            ffmpeg: runtime.ffmpeg,
            pattern: join(dir, 'f_%06d.jpg'),
            fps,
            outPath: videoPath,
            quality: 18,
          })
          return saveCapture({
            videoPath,
            cursorPath,
            videoT0,
            durationMs: (count * 1000) / fps,
            displayPoints,
            fps,
            backend: 'chromium',
            actions,
            events,
            anchorTrack,
            anchors: anchorTrack[0]?.anchors ?? {},
          })
        } finally {
          rmSync(dir, { recursive: true, force: true })
        }
      })()
      return stopping
    },
    async abort() {
      await cleanup()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

export async function captureChromium({
  url,
  connectTo,
  targetUrl,
  beats,
  actions = beats,
  videoPath,
  cursorPath,
  displayPoints = { w: 1470, h: 956 },
  fps = 30,
  runtime,
  anchorSelectors = [],
  leadInMs = 1400,
  tailMs = 1600,
}) {
  if (!runtime?.chrome || !runtime?.ffmpeg)
    throw new Error('Capture requires runtime executable paths')
  if (!Number.isFinite(fps) || fps < 1 || fps > 120)
    throw new Error('Invalid capture fps')
  let browser, recording
  try {
    browser = connectTo
      ? await puppeteer.connect({
          ...(connectTo.startsWith('ws')
            ? { browserWSEndpoint: connectTo }
            : { browserURL: connectTo }),
          defaultViewport: null,
          protocolTimeout: 15000,
        })
      : await puppeteer.launch({
          executablePath: runtime.chrome,
          headless: true,
          protocolTimeout: 15000,
        })
    let page
    if (connectTo) {
      const pages = (await browser.pages()).filter(
        (p) => !p.url().startsWith('devtools:'),
      )
      const targets = targetUrl
        ? pages.filter((p) => p.url() === targetUrl)
        : pages
      if (targets.length !== 1)
        throw new Error(
          'Select exactly one capture page with --target <exact URL>',
        )
      page = targets[0]
      displayPoints = await page.evaluate(() => ({
        w: innerWidth,
        h: innerHeight,
      }))
    } else {
      page = await browser.newPage()
      await page.setViewport({
        width: displayPoints.w,
        height: displayPoints.h,
        deviceScaleFactor: 1,
      })
      await page.goto(url, { waitUntil: 'networkidle0' })
    }
    recording = await startChromiumRecording(page, {
      videoPath,
      cursorPath,
      fps,
      runtime,
      displayPoints,
      anchorSelectors,
    })
    await runActions(actions, chromiumDriver(page, recording.client), {
      start: { x: displayPoints.w / 2, y: displayPoints.h * 0.72 },
      emit: recording.emit,
      onAction: recording.onAction,
      onEvent: recording.onEvent,
      leadInMs,
      tailMs,
    })
    const result = await recording.stop()
    recording = null
    return result
  } finally {
    try {
      if (recording) await recording.abort()
    } finally {
      if (browser) {
        if (connectTo) browser.disconnect()
        else await browser.close()
      }
    }
  }
}
