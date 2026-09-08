import { existsSync } from 'node:fs'
import { findFfmpeg } from '../media/ffmpeg.mjs'

/** Composition root. Portable engines receive paths and never import adapters. */
export async function resolveRuntime(overrides = {}) {
  if (process.platform !== 'darwin')
    throw new Error(
      'Cine currently supports macOS. Other native adapters are not implemented yet.',
    )
  const host = await import('../platform/macos/runtime.mjs')
  const chrome =
    overrides.chrome ??
    process.env.CINE_CHROME ??
    host.chromeCandidates.find(existsSync)
  if (!chrome || !existsSync(chrome))
    throw new Error('Chrome not found. Set CINE_CHROME to its executable path.')
  const ffmpeg = findFfmpeg({
    explicit: overrides.ffmpeg ?? process.env.CINE_FFMPEG,
    candidates: host.ffmpegCandidates,
  })
  return { chrome, ffmpeg }
}
