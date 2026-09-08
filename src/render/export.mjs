import { saveCover } from './cover.mjs'
import { buildScene } from '../scenes/build.mjs'
import { mixAudioPlan } from '../media/clips.mjs'
import { serializeCaptions } from '../core/captions.mjs'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  existsSync,
  createReadStream,
  readdirSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import puppeteer from 'puppeteer-core'
import { encodeFrames } from '../media/ffmpeg.mjs'
import { mixTrack, writeWav, muxAudio } from '../media/audio.mjs'
import { loadAssets } from './assets.mjs'
export const COMPOSITOR_URL = new URL('./compositor.html', import.meta.url)
const hash = (value) => createHash('sha256').update(value).digest('hex')
async function pictureKey(plan, customScenes, assets, videoPath, runtime) {
  const videoHash = createHash('sha256')
  for await (const bytes of createReadStream(videoPath)) videoHash.update(bytes)
  const source = readdirSync(new URL('.', import.meta.url))
    .filter((n) => /\.(mjs|css|html)$/.test(n))
    .sort()
    .map((n) => readFileSync(new URL(n, import.meta.url), 'utf8'))
    .join('\n')
  const engines = [runtime.chrome, runtime.ffmpeg].map((path) => {
    try {
      const s = statSync(path)
      return { path, size: s.size, mtime: s.mtimeMs }
    } catch {
      return { path }
    }
  })
  const { audioCues, audioClips, sound, cover, outputCaptions, ...visual } =
    plan
  return hash(
    JSON.stringify({
      visual,
      customScenes,
      assets,
      video: videoHash.digest('hex'),
      source: hash(source),
      engines,
    }),
  )
}

/** Own rendering resources; cache only completed silent video and separate cover artifacts. */
export async function exportVideo({
  plan,
  videoPath,
  assetDir,
  outPath,
  runtime,
  inspectionDir,
  media = {},
  audioSourcePlan,
  writeCover = true,
  cacheDir,
  sceneBundles,
  onProgress = () => {},
}) {
  if (!runtime?.chrome || !runtime?.ffmpeg)
    throw new Error('Export requires Chrome and FFmpeg runtime paths')
  const assets = loadAssets(plan.settings, assetDir)
  const customScenes =
    sceneBundles ??
    (await Promise.all(
      plan.layers
        .filter((l) => l.type === 'custom')
        .map((l) => buildScene(l, assetDir)),
    ))
  mkdirSync(dirname(outPath), { recursive: true })
  if (inspectionDir) mkdirSync(inspectionDir, { recursive: true })
  const dir = mkdtempSync(join(tmpdir(), 'cine-render-')),
    silent = join(dir, 'silent.mp4'),
    final = join(dir, 'final.mp4'),
    coverPath = join(dir, 'cover.png')
  let browser,
    cacheHit = false
  try {
    const key = cacheDir
      ? await pictureKey(plan, customScenes, assets, videoPath, runtime)
      : null
    if (cacheDir) mkdirSync(cacheDir, { recursive: true })
    const cached = key ? join(cacheDir, key + '.mp4') : null
    // Custom cover assets/code have their own fingerprint, independent of picture reuse.
    let coverInputs = plan.cover ?? null
    if (plan.cover?.entry)
      coverInputs = await buildScene({ ...plan.cover, id: 'cover' }, assetDir)
    else if (plan.cover?.type === 'image')
      coverInputs = {
        ...plan.cover,
        bytes: hash(readFileSync(resolve(assetDir, plan.cover.file))),
      }
    const cachedCover = key
      ? join(cacheDir, key + '-' + hash(JSON.stringify(coverInputs)) + '.png')
      : null
    cacheHit = !!cached && existsSync(cached) && !inspectionDir
    if (cacheHit) copyFileSync(cached, silent)
    const coverHit =
      writeCover &&
      cachedCover &&
      existsSync(cachedCover) &&
      existsSync(cachedCover + '.json')
    if (coverHit) {
      copyFileSync(cachedCover, coverPath)
      copyFileSync(cachedCover + '.json', coverPath + '.json')
    }
    if (!cacheHit || (writeCover && !coverHit)) {
      browser = await puppeteer.launch({
        executablePath: runtime.chrome,
        headless: true,
        protocolTimeout: 20000,
        args: [
          '--allow-file-access-from-files',
          '--force-color-profile=srgb',
          '--font-render-hinting=none',
        ],
      })
      const page = await browser.newPage()
      page.on('pageerror', (e) => console.error('[compositor]', e.message))
      await page.setViewport({
        width: plan.width,
        height: plan.height,
        deviceScaleFactor: 1,
      })
      await page.goto(COMPOSITOR_URL.href)
      const config = {
        ...plan,
        assets,
        customScenes,
        videoUrl: pathToFileURL(videoPath).href,
      }
      await page.evaluate((c) => window.init(c), config)
      if (!cacheHit) {
        for (let i = 0; i < plan.states.length; i++) {
          await page.evaluate((t) => window.step(t), (i * 1000) / plan.fps)
          const path = join(dir, `f_${String(i).padStart(6, '0')}.png`)
          await page.screenshot({ path })
          if (
            inspectionDir &&
            (i === 0 ||
              i === plan.states.length - 1 ||
              i % Math.round(plan.fps) === 0)
          )
            copyFileSync(path, join(inspectionDir, `${i}.png`))
          if (i % 60 === 0) {
            console.log(`  frame ${i}/${plan.states.length}`)
            onProgress(i, plan.states.length)
          }
        }
      }
      if (writeCover && !coverHit)
        await saveCover(page, plan, assetDir, coverPath, config)
      await browser.close()
      browser = null
    }
    if (!cacheHit) {
      await encodeFrames({
        ffmpeg: runtime.ffmpeg,
        pattern: join(dir, 'f_%06d.png'),
        fps: plan.fps,
        outPath: silent,
      })
      if (cached) copyFileSync(silent, cached)
    }
    if (writeCover && cachedCover && !coverHit) {
      copyFileSync(coverPath, cachedCover)
      copyFileSync(coverPath + '.json', cachedCover + '.json')
    }
    const sourcePlan = audioSourcePlan ?? plan,
      hasAudio = sourcePlan.audioCues.length || sourcePlan.audioClips?.length
    if (hasAudio) {
      let mix =
        sourcePlan.schemaVersion === 2
          ? mixAudioPlan(sourcePlan, media)
          : mixTrack(
              sourcePlan.audioCues,
              (sourcePlan.states.length / sourcePlan.fps) * 1000,
            )
      if (audioSourcePlan) {
        const first = Math.round(plan.preview.fromMs * 48),
          last = first + Math.round(plan.durationMs * 48)
        mix = mix.map((c) => c.slice(first, last))
      }
      const wav = writeWav(join(dir, 'audio.wav'), mix)
      await muxAudio(silent, wav, final, runtime.ffmpeg)
      if (plan.preview) copyFileSync(wav, outPath + '.audio.wav')
    }
    copyFileSync(hasAudio ? final : silent, outPath)
    // A successful export owns its sidecars, including removal of obsolete ones.
    if (!(plan.preview && hasAudio))
      rmSync(outPath + '.audio.wav', { force: true })
    if (!writeCover) {
      rmSync(outPath + '.cover.png', { force: true })
      rmSync(outPath + '.cover.json', { force: true })
    }
    const captions = plan.outputCaptions ?? plan.captions ?? []
    if (!captions.length) {
      rmSync(outPath + '.vtt', { force: true })
      rmSync(outPath + '.srt', { force: true })
    }
    if (captions.length) {
      writeFileSync(outPath + '.vtt', serializeCaptions(captions, 'vtt'))
      writeFileSync(outPath + '.srt', serializeCaptions(captions, 'srt'))
    }
    if (writeCover) {
      copyFileSync(coverPath, outPath + '.cover.png')
      copyFileSync(coverPath + '.json', outPath + '.cover.json')
    }
    writeFileSync(
      outPath + '.artifacts.json',
      JSON.stringify(
        {
          video: outPath,
          ...(writeCover ? { cover: outPath + '.cover.png' } : {}),
          ...(captions.length
            ? { captions: [outPath + '.vtt', outPath + '.srt'] }
            : {}),
          ...(plan.preview && hasAudio
            ? { audioPreview: outPath + '.audio.wav' }
            : {}),
          durationMs: (plan.states.length / plan.fps) * 1000,
          preview: plan.preview,
          pictureCacheHit: cacheHit,
        },
        null,
        2,
      ) + '\n',
    )
    console.log(`done -> ${outPath}${cacheHit ? ' (reused picture)' : ''}`)
    return outPath
  } finally {
    try {
      if (browser) await browser.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}
