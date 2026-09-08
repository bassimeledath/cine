import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { resolveRuntime } from '../src/runtime/host.mjs'
const root = resolve(process.argv[2] ?? readFileSync('/tmp/cine-round2-root','utf8').trim())
const html = readFileSync(join(root,'index.html'),'utf8')
for (const match of html.matchAll(/(?:src|href|poster)="([^"]+)"/g)) {
  const file = match[1]
  if (!/^(https?:|#|data:)/.test(file)) assert.ok(existsSync(join(root,file)), `Missing gallery asset: ${file}`)
}
const runtime = await resolveRuntime()
const browser = await puppeteer.launch({ executablePath: runtime.chrome, headless: true, args: ['--allow-file-access-from-files'] })
try {
  const page = await browser.newPage(), errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.setViewport({ width: 1400, height: 1000 })
  await page.goto(pathToFileURL(join(root,'index.html')).href)
  await page.evaluate(() => { for (const m of document.querySelectorAll('video,audio')) { m.preload = 'auto'; m.load() } })
  await page.waitForFunction(() => [...document.querySelectorAll('video,audio')].every(m => m.readyState >= 2), { timeout: 30000 })
  const media = await page.evaluate(() => [...document.querySelectorAll('video,audio')].map(m => ({
    type: m.tagName.toLowerCase(), file: m.getAttribute('src'), duration: m.duration, paused: m.paused, autoplay: m.autoplay, error: m.error?.message ?? null,
    ...(m.tagName === 'VIDEO' ? { width: m.videoWidth, height: m.videoHeight } : {}),
  })))
  assert.equal(media.filter(m => m.type === 'video').length, 10)
  assert.equal(media.filter(m => m.type === 'audio').length, 2)
  assert.ok(media.every(m => Number.isFinite(m.duration) && m.duration > 0 && m.paused && !m.autoplay && !m.error))
  assert.deepEqual(errors, [])
  await page.screenshot({ path: join(root,'inspection/gallery.png') })
  writeFileSync(join(root,'inspection/gallery-check.json'), JSON.stringify({ media, errors, checkedAt: new Date().toISOString() }, null, 2)+'\n')
  console.log('Gallery: 10 videos + 2 audio samples load, all paused; links resolve; no page errors.')
} finally { await browser.close() }
