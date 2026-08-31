// Stage 1, headless backend — capture a web app with no display and no cursor.
//
// The avfoundation backend records a physical screen and *observes* the OS
// cursor. This one does neither: the page runs in headless Chrome, and the
// cursor is *authored* rather than observed. That inverts the hard problems:
//
//   * Trivial clock sync. The driver and the screencast share one wall clock,
//     so videoT0 is just the first frame's timestamp — no probing or
//     end-anchoring like the avfoundation backend needs.
//   * No sampling jitter. The cursor track is generated from the same easing
//     curve the frames are driven from, rather than sampled off the OS at
//     250Hz and hoped to line up.
//
// Capture runs in real time. Deterministic stepping via virtual time was tried
// and abandoned — see the note on Page.screencast in captureWeb.
//
// It emits the same two artifacts as capture.mjs — raw.mp4 + cursor.jsonl — so
// autozoom (stage 2) and the compositor (stage 3) are reused unchanged.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { ffmpegPath } from './capture.mjs'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/** Cursor sample rate of the synthesized track. Matches the native logger so
 *  autozoom sees an identically-shaped signal from either backend. */
const CURSOR_HZ = 250
/** How long the synthetic button stays down — long enough for the rising edge
 *  to survive resampling, short enough to read as a click. */
const CLICK_HOLD_MS = 90

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/**
 * Turn a beat sheet into an explicit timeline: where the cursor is at every
 * instant, and when the button goes down and up.
 *
 * Returns { keyframes, events, durationMs } in ms from t=0.
 */
export function planTimeline(beats, { start, leadInMs = 1400, tailMs = 1600 }) {
  const keyframes = [] // { t, x, y } — piecewise-eased cursor path
  const events = []    // { t, type, x, y }
  let t = 0
  let pos = { ...start }

  keyframes.push({ t, ...pos })
  t += leadInMs
  keyframes.push({ t, ...pos })

  for (const beat of beats) {
    const moveMs = beat.moveMs ?? 650
    const settleMs = beat.settleMs ?? 180
    const from = { ...pos }
    const to = beat.point
    // Sample the eased path densely enough that resampling stays faithful.
    const steps = Math.max(2, Math.round(moveMs / 8))
    for (let i = 1; i <= steps; i++) {
      const p = ease(i / steps)
      keyframes.push({
        t: t + (moveMs * i) / steps,
        x: from.x + (to.x - from.x) * p,
        y: from.y + (to.y - from.y) * p,
      })
    }
    t += moveMs
    pos = { ...to }

    t += settleMs
    keyframes.push({ t, ...pos })

    events.push({ t, type: 'mousePressed', ...pos })
    events.push({ t: t + CLICK_HOLD_MS, type: 'mouseReleased', ...pos })
    t += CLICK_HOLD_MS

    t += beat.dwellMs ?? 2200
    keyframes.push({ t, ...pos })
  }

  t += tailMs
  keyframes.push({ t, ...pos })
  return { keyframes, events, durationMs: t }
}

/** Cursor position at time t, linearly interpolated between keyframes. */
export function cursorAt(keyframes, t) {
  if (t <= keyframes[0].t) return { x: keyframes[0].x, y: keyframes[0].y }
  const last = keyframes[keyframes.length - 1]
  if (t >= last.t) return { x: last.x, y: last.y }
  let lo = 0
  let hi = keyframes.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (keyframes[mid].t <= t) lo = mid
    else hi = mid
  }
  const a = keyframes[lo]
  const b = keyframes[lo + 1]
  const span = b.t - a.t
  const f = span <= 0 ? 0 : (t - a.t) / span
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
}

/** Render the timeline into the same JSONL shape the native cursor logger
 *  emits. `offsetMs` shifts the track onto whatever clock the frames use. */
export function synthesizeCursorLog({ keyframes, events, durationMs }, offsetMs = 0) {
  const stepMs = 1000 / CURSOR_HZ
  const downSpans = []
  for (const e of events) {
    if (e.type === 'mousePressed') downSpans.push({ from: e.t, to: e.t + CLICK_HOLD_MS })
  }
  const lines = []
  for (let t = 0; t <= durationMs; t += stepMs) {
    const p = cursorAt(keyframes, t)
    const down = downSpans.some((s) => t >= s.from && t < s.to) ? 1 : 0
    lines.push(
      `{"t":${(t + offsetMs).toFixed(3)},"x":${p.x.toFixed(2)},"y":${p.y.toFixed(2)},"l":${down},"r":0}`,
    )
  }
  return lines.join('\n') + '\n'
}

/** Resolve a selector to viewport-centre coordinates (CSS px == display points). */
export async function pointOf(page, selector) {
  const p = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    let r = el.getBoundingClientRect()
    // For an element whose only content is text, measure the text instead of
    // the box. A block-level value like `<div class="val">8</div>` is as wide
    // as its card, so its box centre lands in empty space — which is fine for
    // clicking but wrong for pointing an annotation at.
    if (el.childNodes.length === 1 && el.firstChild.nodeType === 3) {
      const range = document.createRange()
      range.selectNodeContents(el)
      const rr = range.getBoundingClientRect()
      if (rr.width > 0 && rr.height > 0) r = rr
    }
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }
  }, selector)
  if (!p) throw new Error(`capture-web: selector not found: ${selector}`)
  return p
}

/**
 * Capture a page headlessly.
 *
 * `beats` entries are { selector, dwellMs?, moveMs?, settleMs?, label? }.
 * Returns { videoPath, cursorPath, videoT0: 0, durationMs }.
 */
export async function captureWeb({
  url,
  /** CDP endpoint of an already-running Chromium host (e.g. an Electron app
   *  launched with --remote-debugging-port). When set, cine attaches to it
   *  instead of launching its own browser, and never resizes or closes it. */
  connectTo,
  beats,
  /** Extra selectors to resolve to points at capture time. They're recorded
   *  alongside the video so a later render can anchor overlays to real UI
   *  elements without re-running the app. */
  anchorSelectors = [],
  videoPath,
  cursorPath,
  displayPoints = { w: 1470, h: 956 },
  deviceScaleFactor = 2,
  fps = 30,
  leadInMs = 1400,
  tailMs = 1600,
  onProgress = () => {},
}) {
  const frameDir = mkdtempSync(join(tmpdir(), 'cine-web-frames-'))
  const browser = connectTo
    ? await puppeteer.connect({ browserURL: connectTo, defaultViewport: null, protocolTimeout: 30000 })
    : await puppeteer.launch({
      executablePath: CHROME,
      headless: 'shell',
      // Fail fast instead of burning the 180s default on a stalled CDP call.
      protocolTimeout: 30000,
      args: [`--window-size=${displayPoints.w},${displayPoints.h}`, '--hide-scrollbars'],
    })
  try {
    let page
    if (connectTo) {
      // Attach to the host's existing window. Deliberately no setViewport: that
      // issues a device-metrics override, which would resize someone else's app
      // out from under them. Take the window's real size as the display size.
      const pages = await browser.pages()
      page = pages.find((p) => !p.url().startsWith('devtools://')) ?? pages[0]
      if (!page) throw new Error(`no page target at ${connectTo}`)
      const size = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
      displayPoints = size
    } else {
      page = await browser.newPage()
      await page.setViewport({
        width: displayPoints.w,
        height: displayPoints.h,
        deviceScaleFactor,
      })
      await page.goto(url, { waitUntil: 'networkidle0' })
    }
    page.on('pageerror', (e) => console.error('[page]', e.message))

    // Resolve every target before the clock is frozen — layout is stable by now.
    const resolved = []
    for (const b of beats) {
      resolved.push({ ...b, point: await pointOf(page, b.selector) })
    }
    const anchors = {}
    for (const sel of anchorSelectors) {
      anchors[sel] = await pointOf(page, sel).catch(() => null)
    }

    const plan = planTimeline(resolved, {
      start: { x: displayPoints.w * 0.5, y: displayPoints.h * 0.72 },
      leadInMs,
      tailMs,
    })

    const client = await page.createCDPSession()

    // Frames are collected via Page.screencast rather than a per-frame
    // Page.captureScreenshot under paused virtual time. Virtual time is not
    // usable here: Chrome only expires a virtual-time budget reliably at
    // >=100ms granularity, and anything at or below 50ms (i.e. any real frame
    // rate) wedges the renderer on the second frame regardless of dispatch
    // order or maxVirtualTimeTaskStarvationCount. Screencast is push-based and
    // never blocks the renderer, at the cost of running in real time.
    const shots = []
    client.on('Page.screencastFrame', (f) => {
      shots.push({ ts: f.metadata.timestamp * 1000, data: f.data })
      client.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
    })
    await client.send('Page.startScreencast', { format: 'jpeg', quality: 92, everyNthFrame: 1 })

    // --- realtime drive loop ---
    const t0Wall = Date.now()
    let nextEvent = 0
    while (true) {
      const elapsed = Date.now() - t0Wall
      if (elapsed >= plan.durationMs) break
      while (nextEvent < plan.events.length && plan.events[nextEvent].t <= elapsed) {
        const e = plan.events[nextEvent++]
        await client.send('Input.dispatchMouseEvent', {
          type: e.type, x: e.x, y: e.y, button: 'left', clickCount: 1,
        })
      }
      const p = cursorAt(plan.keyframes, elapsed)
      await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y })
      onProgress(elapsed, plan.durationMs)
      await new Promise((r) => setTimeout(r, 8))
    }
    await client.send('Page.stopScreencast')

    if (!shots.length) throw new Error('screencast produced no frames')

    // --- resample the change-driven frames onto a constant grid ---
    // Screencast only emits when the page repaints, so static stretches yield
    // nothing. Holding the most recent frame turns that into exactly the right
    // thing: a still image for as long as the page was still.
    const videoT0 = shots[0].ts
    const frameMs = 1000 / fps
    const durationMs = Math.max(plan.durationMs - (videoT0 - t0Wall), frameMs)
    const totalFrames = Math.ceil(durationMs / frameMs)
    let cursorShot = 0
    for (let i = 0; i < totalFrames; i++) {
      const t = videoT0 + i * frameMs
      while (cursorShot + 1 < shots.length && shots[cursorShot + 1].ts <= t) cursorShot++
      writeFileSync(
        join(frameDir, `f_${String(i).padStart(5, '0')}.jpg`),
        Buffer.from(shots[cursorShot].data, 'base64'),
      )
    }

    // Cursor stamps are absolute wall-clock ms, matching the screencast frame
    // timestamps, so the compositor's videoT0 rebase lines them up exactly.
    writeFileSync(cursorPath, synthesizeCursorLog(plan, t0Wall))

    execFileSync(
      ffmpegPath(),
      ['-y', '-framerate', String(fps), '-i', join(frameDir, 'f_%05d.jpg'),
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', videoPath],
      { stdio: 'pipe' },
    )

    // displayPoints is echoed back because attach mode derives it from the
    // host window rather than taking it from the caller.
    return { videoPath, cursorPath, videoT0, durationMs, displayPoints, anchors }
  } finally {
    // Never close a browser we didn't launch — that would quit the user's app.
    if (connectTo) browser.disconnect()
    else await browser.close()
    rmSync(frameDir, { recursive: true, force: true })
  }
}
