import { execFileSync } from 'node:child_process'
import { runProcess } from '../runtime/process.mjs'

/** Discovery has no OS paths. Hosts supply their additional candidates. */
export function findFfmpeg({ explicit, candidates = [] } = {}) {
  if (explicit) candidates = [explicit]
  else {
    try {
      const bundled = execFileSync(
        'python3',
        ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim()
      candidates = [bundled, ...candidates]
    } catch {
      /* Optional self-contained FFmpeg installation. */
    }
    candidates = [...candidates, 'ffmpeg']
  }
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['-version'], { stdio: 'ignore' })
      return candidate
    } catch {
      /* next */
    }
  }
  throw new Error(
    `No working FFmpeg found. Set CINE_FFMPEG to its executable path.`,
  )
}

export function probeMedia(path, ffmpeg) {
  let stderr = ''
  try {
    execFileSync(ffmpeg, ['-hide_banner', '-i', path], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    stderr = e.stderr?.toString() ?? ''
  }
  const duration = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/)
  const video = stderr.match(/Video:.*?\b(\d{2,5})x(\d{2,5})\b/)
  if (!duration || !video)
    throw new Error(`Cannot probe video: ${path}\n${stderr}`)
  return {
    durationMs:
      (Number(duration[1]) * 3600 +
        Number(duration[2]) * 60 +
        Number(duration[3])) *
      1000,
    width: Number(video[1]),
    height: Number(video[2]),
    hasAudio: /Audio:/.test(stderr),
  }
}

export async function encodeFrames({
  ffmpeg,
  pattern,
  fps,
  outPath,
  quality = 20,
}) {
  await runProcess(ffmpeg, [
    '-y',
    '-framerate',
    String(fps),
    '-i',
    pattern,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    String(quality),
    '-movflags',
    '+faststart',
    outPath,
  ])
}
