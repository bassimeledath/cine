import { sleep } from '../runtime/process.mjs'
import { ease } from '../core/events.mjs'

/** Emit cumulative pixel differences so rounding cannot change the total distance. */
export async function scrollGesture(delta, dispatch, { durationMs = 900, onStep = () => {} } = {}) {
  if (!Number.isFinite(durationMs) || durationMs < 0)
    throw new Error('Invalid scrollMs')
  const started = performance.now()
  let sent = { x: 0, y: 0 }
  while (true) {
    const progress = durationMs ? Math.min(1, (performance.now() - started) / durationMs) : 1
    const fraction = ease(progress)
    const next = {
      x: progress === 1 ? delta.x : Math.round(delta.x * fraction),
      y: progress === 1 ? delta.y : Math.round(delta.y * fraction),
    }
    const step = { x: next.x - sent.x, y: next.y - sent.y }
    if (step.x || step.y) {
      await dispatch(step)
      sent = next
      onStep()
    }
    if (progress === 1) break
    await sleep(16)
  }
}

/** The browser handles nested scrollers; await their observed motion before aiming. */
export async function revealTarget(page, selector, timeoutMs = 5000) {
  await page.waitForSelector(selector, { visible: true, timeout: timeoutMs })
  await page.evaluate(async (selector, timeoutMs) => {
    const el = document.querySelector(selector)
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    const started = performance.now()
    let last, stableSince = started
    await new Promise((resolve, reject) => {
      const frame = (now) => {
        if (!el.isConnected) return reject(new Error('Scroll target detached: ' + selector))
        const r = el.getBoundingClientRect()
        const position = [r.x, r.y, r.width, r.height]
        if (!last || position.some((v, i) => Math.abs(v - last[i]) > 0.1)) stableSince = now
        last = position
        if (now - started >= 180 && now - stableSince >= 120) return resolve()
        if (now - started > timeoutMs) return reject(new Error('Scroll did not settle: ' + selector))
        requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
  }, selector, timeoutMs)
}
