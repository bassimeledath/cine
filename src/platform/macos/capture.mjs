import { existsSync, createWriteStream, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { finished } from 'node:stream/promises'
import { startProcess, waitForProcess } from '../../runtime/process.mjs'
import { probeMedia } from '../../media/ffmpeg.mjs'
import { saveCapture, readCursor } from '../../capture/artifacts.mjs'

const LOGGER = fileURLToPath(new URL('./cursor-logger', import.meta.url))
export const nowMs = () => performance.timeOrigin + performance.now()

export function mainDisplay(logger = LOGGER) {
  if (!existsSync(logger))
    throw new Error('Run npm run build:native before native capture')
  return JSON.parse(execFileSync(logger, ['--display'], { encoding: 'utf8' }))
}

function screenDevice(ffmpeg) {
  let text = ''
  try {
    execFileSync(
      ffmpeg,
      ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
  } catch (e) {
    text = e.stderr?.toString() ?? ''
  }
  const index = text.match(/\[(\d+)\] Capture screen 0/)
  if (!index)
    throw new Error(`Primary screen capture device not found\n${text}`)
  return Number(index[1])
}

/** Own every process from acquisition. The handle's stop is idempotent. */
export async function startCapture({
  videoPath,
  cursorPath,
  fps = 30,
  runtime,
  loggerPath = LOGGER,
  screenIndex,
  geometry = mainDisplay(loggerPath),
  start = startProcess,
  readinessMs = 15000,
}) {
  if (!runtime?.ffmpeg)
    throw new Error('Native capture requires an FFmpeg runtime')
  if (!existsSync(loggerPath))
    throw new Error('Run npm run build:native before native capture')
  const device = screenIndex ?? screenDevice(runtime.ffmpeg)
  const output = createWriteStream(cursorPath)
  const drained = finished(output).then(
    () => null,
    (e) => e,
  )
  let logger, video
  const actions = [],
    events = []
  const cleanup = async () => {
    if (video) await video.stop({ input: 'q', signal: 'SIGINT' })
    if (logger) await logger.stop()
    if (!output.writableEnded) output.end()
    const error = await drained
    if (error) throw error
  }
  try {
    logger = start(loggerPath, ['250'])
    logger.child.stdout.pipe(output)
    video = start(runtime.ffmpeg, [
      '-hide_banner',
      '-f',
      'avfoundation',
      '-capture_cursor',
      '0',
      '-framerate',
      String(fps),
      '-i',
      `${device}:none`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-y',
      videoPath,
    ])
    await Promise.race([
      waitForProcess(video, (s) => /frame=\s*\d+/.test(s), readinessMs),
      logger.closed.then((r) => {
        throw new Error(
          `Cursor logger ended: ${r.error?.message ?? logger.stderr}`,
        )
      }),
      drained.then((error) => {
        if (error) throw error
        return new Promise(() => {})
      }),
    ])
  } catch (error) {
    await cleanup().catch(() => {})
    throw error
  }
  let stopping
  return {
    geometry,
    onAction: (action) => actions.push(action),
    onEvent: (event) => events.push(event),
    stop() {
      stopping ??= (async () => {
        const stopAt = nowMs()
        const unexpectedlyExited = !!video.result || !!logger.result
        await cleanup()
        if (
          unexpectedlyExited ||
          video.result?.error ||
          video.result?.code !== 0
        )
          throw new Error(
            `Native capture ended unexpectedly\n${video.stderr}\n${logger.stderr}`,
          )
        const media = probeMedia(videoPath, runtime.ffmpeg)
        const frames = readCursor(cursorPath).map((f) => ({
          ...f,
          x: f.x - geometry.x,
          y: f.y - geometry.y,
        }))
        writeFileSync(
          cursorPath,
          frames.map((f) => JSON.stringify(f)).join('\n') + '\n',
        )
        return saveCapture({
          videoPath,
          cursorPath,
          videoT0: stopAt - media.durationMs,
          durationMs: media.durationMs,
          displayPoints: { w: geometry.w, h: geometry.h },
          geometry,
          actions,
          events,
          fps,
          backend: 'macos',
        })
      })()
      return stopping
    },
    async abort() {
      await cleanup()
    },
  }
}
