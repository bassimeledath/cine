// Stage 1b — the driver.
//
// This is what makes cine autonomous: it moves the *real* macOS cursor via
// cliclick (CGEvent-backed), so the cursor logger sees genuine motion and
// clicks, and auto-zoom gets a real signal. Driving the page through CDP
// instead would click inside the browser process without ever moving the OS
// cursor — the recording would show a frozen pointer and produce no zooms.
//
// Motion is eased and paced deliberately; an agent clicking as fast as it can
// produces an unwatchable video.

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileP = promisify(execFile)
const CLICLICK = '/opt/homebrew/bin/cliclick'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** easeInOutCubic — slow départ, quick middle, soft landing. */
function ease(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/**
 * Glide the real cursor from its current point to (x, y) over `durationMs`.
 * Emitted as one cliclick invocation: a chain of m: steps separated by w:
 * waits, which keeps the motion smooth without paying process-spawn cost per
 * step.
 */
export async function glideTo(from, to, durationMs = 600) {
  const steps = Math.max(2, Math.round(durationMs / 12))
  const waitMs = Math.max(1, Math.round(durationMs / steps))
  const cmds = []
  for (let i = 1; i <= steps; i++) {
    const p = ease(i / steps)
    const x = Math.round(from.x + (to.x - from.x) * p)
    const y = Math.round(from.y + (to.y - from.y) * p)
    cmds.push(`m:${x},${y}`, `w:${waitMs}`)
  }
  await execFileP(CLICLICK, cmds)
  return { x: to.x, y: to.y }
}

export async function clickAt(pt) {
  await execFileP(CLICLICK, [`c:${Math.round(pt.x)},${Math.round(pt.y)}`])
}

/**
 * Map a page element to absolute screen points.
 * Derives the viewport origin from the live window geometry rather than
 * assuming kiosk mode puts it at (0,0), so this also works windowed.
 */
export async function screenPointOf(page, selector) {
  const box = await page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return {
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
      screenX: window.screenX,
      screenY: window.screenY,
      outerW: window.outerWidth,
      outerH: window.outerHeight,
      innerW: window.innerWidth,
      innerH: window.innerHeight,
    }
  }, selector)
  if (!box) throw new Error(`driver: selector not found: ${selector}`)
  const originX = box.screenX + (box.outerW - box.innerW) / 2
  const originY = box.screenY + (box.outerH - box.innerH)
  return { x: originX + box.cx, y: originY + box.cy }
}

/** Move to an element and click it, with a beat before and after. */
export async function clickElement(page, cursor, selector, { moveMs = 650, settleMs = 180 } = {}) {
  const target = await screenPointOf(page, selector)
  const at = await glideTo(cursor, target, moveMs)
  await sleep(settleMs)
  await clickAt(at)
  return at
}

export async function hasCliclick() {
  try {
    await execFileP(CLICLICK, ['-V'])
    return true
  } catch {
    return false
  }
}
