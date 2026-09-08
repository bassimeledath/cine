import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, extname } from 'node:path'
import { runProcess } from '../runtime/process.mjs'
import { CineError } from '../core/errors.mjs'
import { parseCaptions } from '../core/captions.mjs'
import { mixTrack } from './audio.mjs'
export const SAMPLE_RATE = 48000

/** Decode once to measure actual samples and reuse them in the final mix. */
export async function prepareAudio(clips, baseDir, ffmpeg) {
  const scratch = mkdtempSync(join(tmpdir(), 'cine-audio-')),
    media = {},
    warnings = []
  try {
    for (const [i, clip] of clips.entries()) {
      const path = `audioClips.${clip.id}`
      try {
        if (typeof clip.file !== 'string')
          throw new Error('Provide a local audio file')
        const file = resolve(baseDir, clip.file),
          pcm = join(scratch, `${i}.f32`)
        await runProcess(ffmpeg, [
          '-v',
          'error',
          '-y',
          '-i',
          file,
          '-map',
          '0:a:0',
          '-vn',
          '-ac',
          '2',
          '-ar',
          String(SAMPLE_RATE),
          '-f',
          'f32le',
          pcm,
        ])
        if (statSync(pcm).size > 512 * 1024 * 1024)
          throw new Error(
            'Decoded clip exceeds 512 MiB; split it into shorter clips',
          )
        const bytes = readFileSync(pcm),
          samples = new Float32Array(
            bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            ),
          )
        if (!samples.length || samples.length % 2)
          throw new Error('Audio contains no complete stereo frames')
        const durationMs = (samples.length / 2 / SAMPLE_RATE) * 1000
        let captions = []
        if (clip.captions?.file) {
          const captionFile = resolve(baseDir, clip.captions.file)
          captions = parseCaptions(
            readFileSync(captionFile, 'utf8'),
            extname(captionFile).slice(1),
            `${path}.captions`,
          )
        } else if (clip.captions?.text) {
          captions = [
            { startMs: 0, endMs: durationMs, text: clip.captions.text },
          ]
          warnings.push({
            code: 'BASIC_CAPTIONS',
            path,
            message:
              'Transcript spans the whole audio clip; no word alignment was inferred',
          })
        }
        if (captions.some((c) => c.endMs > durationMs + 1))
          throw new Error('Caption timing extends past the decoded audio')
        if (captions.some((c) => c.text.length > 120))
          warnings.push({
            code: 'LONG_CAPTION',
            path,
            message:
              'Long caption: provide shorter timed phrases for readability',
          })
        media[clip.id] = { durationMs, samples, captions, file }
      } catch (error) {
        if (error instanceof CineError) throw error
        throw new CineError(
          'AUDIO_ASSET',
          path,
          error.message,
          'Check the local file and caption timings',
        )
      }
    }
    return { media, warnings }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** Mix sample-aligned clips with independently controlled buses and speech ducking. */
export function mixAudioPlan(plan, media) {
  const durationMs = (plan.states.length / plan.fps) * 1000,
    n = Math.ceil((durationMs / 1000) * SAMPLE_RATE)
  const buses = Object.fromEntries(
    ['narration', 'effects', 'music'].map((k) => [
      k,
      [new Float32Array(n), new Float32Array(n)],
    ]),
  )
  const generated = mixTrack(plan.audioCues, durationMs)
  for (let ch = 0; ch < 2; ch++)
    buses.effects[ch].set(generated[ch].subarray(0, n))
  for (const clip of plan.audioClips ?? []) {
    if (clip.mute) continue
    const source = media[clip.id].samples,
      start = Math.round((clip.startMs * SAMPLE_RATE) / 1000),
      from = Math.round((clip.trimInMs * SAMPLE_RATE) / 1000),
      length = Math.round((clip.durationMs * SAMPLE_RATE) / 1000)
    const fadeIn = (clip.fadeInMs * SAMPLE_RATE) / 1000,
      fadeOut = (clip.fadeOutMs * SAMPLE_RATE) / 1000,
      gain = 10 ** (clip.gainDb / 20)
    for (let i = 0; i < length && start + i < n; i++) {
      const g =
        gain *
        (fadeIn ? Math.min(1, i / fadeIn) : 1) *
        (fadeOut ? Math.min(1, (length - 1 - i) / fadeOut) : 1)
      for (let ch = 0; ch < 2; ch++)
        buses[clip.role][ch][start + i] +=
          (source[(from + i) * 2 + ch] ?? 0) * g
    }
  }
  const settings = plan.sound ?? {},
    duck = settings.ducking ?? {},
    duckGain = 10 ** ((duck.gainDb ?? -12) / 20),
    attack = Math.max(1, ((duck.attackMs ?? 40) * SAMPLE_RATE) / 1000),
    release = Math.max(1, ((duck.releaseMs ?? 250) * SAMPLE_RATE) / 1000)
  const voiceClips = (plan.audioClips ?? []).filter(
      (c) =>
        c.role === 'narration' && !c.mute && !settings.buses?.narration?.mute,
    ),
    output = [new Float32Array(n), new Float32Array(n)]
  let envelope = 1,
    peak = 0
  for (let i = 0; i < n; i++) {
    const t = (i / SAMPLE_RATE) * 1000,
      speech = voiceClips.some((c) => t >= c.startMs && t < c.endMs)
    const target = duck.enabled === false ? 1 : speech ? duckGain : 1
    envelope += (target - envelope) / (target < envelope ? attack : release)
    for (let ch = 0; ch < 2; ch++) {
      let value = 0
      for (const role of Object.keys(buses)) {
        const bus = settings.buses?.[role] ?? {},
          gain = bus.mute ? 0 : 10 ** ((bus.gainDb ?? 0) / 20)
        value +=
          buses[role][ch][i] * gain * (role === 'narration' ? 1 : envelope)
      }
      output[ch][i] = value
      peak = Math.max(peak, Math.abs(value))
    }
  }
  // One fixed attenuation preserves envelopes; no per-sample clipping distortion.
  if (peak > 0.98)
    for (const channel of output)
      for (let i = 0; i < n; i++) channel[i] *= 0.98 / peak
  return output
}
