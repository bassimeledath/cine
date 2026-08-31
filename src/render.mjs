import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import puppeteer from 'puppeteer-core'
import { ffmpegPath } from './capture.mjs'
import { mixTrack, writeWav, muxAudio } from './audio.mjs'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const COMPOSITOR = new URL('./compositor.html', import.meta.url)

/** Total timeline length. With overlay layers the timeline is no longer the
 *  same length as the capture — a title card and an outro extend past it. */
function timelineDuration(layers, durationMs) {
  if (!layers || !layers.length) return durationMs
  return Math.max(...layers.map((l) => l.endMs ?? 0))
}

export async function render({ video, cursor, zoomRanges = [], durationMs, fps = 30,
  displayPoints, settings = {}, outPath, width = 1920, height = 1080, videoT0,
  layers = [], audioCues = [] }) {
  const dir = mkdtempSync(join(tmpdir(), 'cine-render-'))
  const total = Math.ceil((timelineDuration(layers, durationMs) / 1000) * fps)
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'shell',
    // Overlay layers lean on backdrop-filter and blur; software compositing in
    // headless renders them, but only with the GPU-blocklist workarounds on.
    args: ['--force-color-profile=srgb', '--font-render-hinting=none',
      '--enable-blink-features=CSSBackdropFilter'],
  })
  try {
    const page = await browser.newPage()
    // Surface compositor errors instead of failing as an opaque timeout.
    page.on('pageerror', (e) => console.error('[compositor]', e.message))
    await page.setViewport({ width, height, deviceScaleFactor: 1 })
    await page.goto(pathToFileURL(COMPOSITOR.pathname).href)
    const frames = readFileSync(cursor, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    if (!frames.length) throw new Error('cursor log is empty — was the logger running?')
    await page.evaluate(async (cfg) => window.init(cfg), {
      videoUrl: pathToFileURL(video).href,
      frames,
      zoomRanges,
      durationMs,
      fps,
      displayPoints,
      settings,
      videoT0,
      layers,
    })
    await page.waitForFunction('window.__ready === true', { timeout: 15000 })
    for (let i = 0; i < total; i++) {
      const t = (i * 1000) / fps
      await page.evaluate((tt) => window.step(tt), t)
      // Screenshots the *viewport*, not the canvas — which is exactly why DOM
      // overlays composite for free.
      await page.screenshot({ path: join(dir, `f_${String(i).padStart(5, '0')}.png`) })
      if (i % 60 === 0) console.log(`  frame ${i}/${total}`)
    }
  } finally {
    await browser.close()
  }

  const silent = audioCues.length ? join(dir, 'silent.mp4') : outPath
  execFileSync(ffmpegPath(), ['-y', '-framerate', String(fps), '-i', join(dir, 'f_%05d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', silent], { stdio: 'pipe' })

  if (audioCues.length) {
    console.log(`  mixing ${audioCues.length} audio cue(s)`)
    const wav = writeWav(join(dir, 'mix.wav'), mixTrack(audioCues, (total / fps) * 1000))
    muxAudio(silent, wav, outPath)
  }

  rmSync(dir, { recursive: true, force: true })
  console.log(`done -> ${outPath}`)
  return outPath
}
