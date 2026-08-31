// Stage 1 — capture.
//
// Runs two processes side by side:
//   * ffmpeg avfoundation, recording the screen with the system cursor excluded
//     (`-capture_cursor 0`) so the compositor can draw its own smoothed one.
//   * native/cursor-logger, sampling cursor position + button state at 250Hz,
//     stamped with wall-clock ms (see nowMs below for why not monotonic).
//
// The two clocks have to be reconciled or the zoom lands off the click. ffmpeg
// takes ~0.5-1.5s to negotiate an AVFoundation session, so we stamp the clock
// the moment ffmpeg reports its first encoded frame and treat that as video
// t=0. See VIDEO_T0 note below for the accuracy this buys.

import { spawn, execFileSync } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const CURSOR_LOGGER = join(HERE, '..', 'native', 'cursor-logger')

/** Wall-clock ms at sub-ms resolution — the same epoch the C logger stamps with.
 *  Do not swap this for hrtime: macOS CLOCK_MONOTONIC pauses during sleep and
 *  libuv's hrtime does not, so those two epochs are ~seconds apart. */
export function nowMs() {
  return performance.timeOrigin + performance.now()
}

let _ffCache = null
/** Resolve a *working* ffmpeg. Homebrew's is frequently broken by x265 soname
 *  drift, so prefer the self-contained imageio_ffmpeg binary when present. */
export function ffmpegPath() {
  if (_ffCache) return _ffCache
  const candidates = []
  try {
    candidates.push(
      execFileSync('python3', ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'])
        .toString()
        .trim(),
    )
  } catch { /* imageio_ffmpeg not installed */ }
  candidates.push('/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg')
  for (const bin of candidates) {
    try {
      execFileSync(bin, ['-hide_banner', '-version'], { stdio: 'pipe' })
      _ffCache = bin
      return _ffCache
    } catch { /* broken or absent — try the next */ }
  }
  throw new Error('no working ffmpeg found (tried imageio_ffmpeg, homebrew, PATH)')
}

/**
 * Start screen capture + cursor logging.
 * Resolves once ffmpeg is confirmed recording, returning a handle whose
 * `stop()` finalizes the MP4 and returns `{ videoPath, cursorPath, videoT0 }`.
 */
export async function startCapture({ videoPath, cursorPath, screenIndex = 1, fps = 30 }) {
  if (!existsSync(CURSOR_LOGGER)) {
    throw new Error(`cursor-logger not built — run: npm run build:native`)
  }

  // --- cursor logger ---------------------------------------------------
  const cursorOut = createWriteStream(cursorPath)
  const logger = spawn(CURSOR_LOGGER, ['250'], { stdio: ['ignore', 'pipe', 'pipe'] })
  logger.stdout.pipe(cursorOut)
  logger.on('error', (e) => console.error('[cursor-logger]', e.message))

  // --- ffmpeg ----------------------------------------------------------
  const ff = ffmpegPath()
  const args = [
    '-hide_banner',
    '-f', 'avfoundation',
    '-capture_cursor', '0',
    '-framerate', String(fps),
    '-i', `${screenIndex}:none`,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-y', videoPath,
  ]
  const proc = spawn(ff, args, { stdio: ['pipe', 'pipe', 'pipe'] })

  let videoT0 = null
  let stderrTail = ''

  const recording = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`ffmpeg did not start capturing within 15s:\n${stderrTail.slice(-800)}`)),
      15000,
    )
    proc.stderr.on('data', (buf) => {
      const s = buf.toString()
      stderrTail += s
      // The first "frame=" progress line means AVFoundation has delivered real
      // frames, which is all we need to know capture is live. It is NOT an
      // accurate t=0 (measured ~500ms late) — stop() re-anchors the timeline.
      if (videoT0 === null && /frame=\s*\d+/.test(stderrTail)) {
        videoT0 = nowMs()
        clearTimeout(timer)
        resolve()
      }
    })
    proc.on('error', (e) => { clearTimeout(timer); reject(e) })
    proc.on('exit', (code) => {
      if (videoT0 === null) {
        clearTimeout(timer)
        reject(new Error(`ffmpeg exited (${code}) before capturing:\n${stderrTail.slice(-800)}`))
      }
    })
  })

  await recording

  return {
    /** Provisional only — `stop()` returns the accurate value. */
    videoT0,
    async stop() {
      // 'q' on stdin makes ffmpeg finalize the moov atom; killing it outright
      // leaves an unplayable MP4.
      const ended = new Promise((resolve) => proc.on('exit', resolve))
      const qSentAt = nowMs()
      try { proc.stdin.write('q') } catch { proc.kill('SIGINT') }
      const bailout = setTimeout(() => proc.kill('SIGINT'), 5000)
      await ended
      clearTimeout(bailout)
      logger.kill('SIGTERM')
      await new Promise((resolve) => cursorOut.end(resolve))

      // Anchor the timeline on the END, not the start. AVFoundation delivers
      // ~0.5s of buffered frames before ffmpeg prints its first progress line,
      // so the start-stamp runs late by a variable amount — enough to visibly
      // slide zooms off their clicks. The stop instant is ours to choose and
      // the container duration is exact, so t0 = stop - duration is far
      // tighter (residual error is just ffmpeg's post-'q' drain, ~tens of ms).
      const durationMs = probeDurationMs(videoPath)
      const anchoredT0 = durationMs > 0 ? qSentAt - durationMs : videoT0
      return { videoPath, cursorPath, videoT0: anchoredT0, durationMs }
    },
  }
}

/** Exact container duration in ms, or 0 if it can't be read. */
export function probeDurationMs(path) {
  let stderr = ''
  try {
    execFileSync(ffmpegPath(), ['-hide_banner', '-i', path], { stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (e) {
    // ffmpeg always exits non-zero when given no output file; the probe data
    // we want is on stderr either way.
    stderr = e.stderr?.toString() ?? ''
  }
  const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/)
  if (!m) return 0
  return (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000
}
