import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { resolveRuntime } from '../src/runtime/host.mjs'
import { probeMedia } from '../src/media/ffmpeg.mjs'
import { prepareProject, describeProject, hashFile } from '../src/authoring.mjs'
import { previewPlan } from '../src/core/preview.mjs'
import { mixAudioPlan } from '../src/media/clips.mjs'
import { mixTrack } from '../src/media/audio.mjs'
const root = resolve(
    process.argv[2] ?? readFileSync('/tmp/cine-round2-root', 'utf8').trim(),
  ),
  runtime = await resolveRuntime()
const jobs = [
  ['01-legacy', 'legacy'],
  ['02-editorial-typing', 'editorial'],
  ['03-narrated-scenes', 'narrated'],
  ['04-speed-narration', 'speed'],
  ['05-portrait', 'portrait'],
  ['06-action-narration', 'milestone'],
  ['07-edited-audio-cover', 'edited'],
  ['08-preview-hold', 'edited', 'saved-result'],
  ['09-custom-code', 'custom-scenes'],
  ['10-typing-and-corrections', 'typing'],
]
const results = []
for (const [name, project, preview] of jobs) {
  const video = join(root, 'videos', name + '.mp4')
  const logFlag = process.argv.indexOf('--wait-log')
  if (logFlag >= 0) {
    const logPath = process.argv[logFlag + 1]
    while (
      !existsSync(logPath) ||
      !readFileSync(logPath, 'utf8').includes(`done -> ${video}`)
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
  if (!existsSync(video)) throw new Error(`Video not ready: ${name}`)
  const prepared = await prepareProject(
      join(root, 'projects', project + '.json'),
      { runtime },
    ),
    sourcePlan = prepared.plan,
    plan = preview ? previewPlan(sourcePlan, { sceneId: preview }) : sourcePlan
  const info = probeMedia(video, runtime.ffmpeg),
    expectedDurationMs = (plan.states.length / plan.fps) * 1000
  if (
    info.width !== plan.width ||
    info.height !== plan.height ||
    Math.abs(info.durationMs - expectedDurationMs) > 1000 / plan.fps
  )
    throw new Error(`Dimensions/duration mismatch: ${name}`)
  const decoded = join(root, 'inspection', name + '-decoded')
  mkdirSync(decoded, { recursive: true })
  execFileSync(
    runtime.ffmpeg,
    [
      '-v',
      'error',
      '-y',
      '-i',
      video,
      '-vf',
      'fps=2,scale=480:-2',
      '-q:v',
      '3',
      join(decoded, '%03d.jpg'),
    ],
    { stdio: 'pipe' },
  )
  const sourceMix =
    sourcePlan.schemaVersion === 2
      ? mixAudioPlan(sourcePlan, prepared.media)
      : mixTrack(
          sourcePlan.audioCues,
          (sourcePlan.states.length / sourcePlan.fps) * 1000,
        )
  let mix = sourceMix
  if (preview) {
    const start = Math.round(plan.preview.fromMs * 48),
      length = Math.round(plan.durationMs * 48)
    mix = mix.map((c) => c.slice(start, start + length))
  }
  let audio = null
  if (info.hasAudio) {
    const raw = execFileSync(
      runtime.ffmpeg,
      [
        '-v',
        'error',
        '-i',
        video,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '48000',
        '-f',
        'f32le',
        '-',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 },
    )
    const actual = new Float32Array(
        raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
      ),
      expected = Float32Array.from(mix[0], (v, i) => (v + mix[1][i]) / 2)
    let best = { correlation: -1, offsetMs: 0 },
      peak = 0,
      power = 0
    for (const v of actual) {
      peak = Math.max(peak, Math.abs(v))
      power += v * v
    }
    for (let lag = -2400; lag <= 2400; lag += 48) {
      let cross = 0,
        aa = 0,
        bb = 0
      for (
        let i = 2400;
        i < Math.min(actual.length, expected.length) - 2400;
        i += 16
      ) {
        const a = expected[i],
          b = actual[i + lag]
        cross += a * b
        aa += a * a
        bb += b * b
      }
      const correlation = cross / Math.sqrt(aa * bb)
      if (correlation > best.correlation)
        best = { correlation, offsetMs: lag / 48 }
    }
    audio = { ...best, peak, rms: Math.sqrt(power / actual.length) }
    if (best.correlation < 0.8 || Math.abs(best.offsetMs) > 25 || peak > 1.01)
      throw new Error(`Audio check failed: ${name}: ${JSON.stringify(audio)}`)
  } else if (sourcePlan.audioClips.length || sourcePlan.audioCues.length)
    throw new Error(`Missing audio: ${name}`)
  const points = [
    ...new Set(
      [...sourcePlan.scenes, ...(sourcePlan.captions ?? [])]
        .flatMap((s) => [s.startMs, s.endMs])
        .filter((t) => t > 0 && t < sourcePlan.durationMs),
    ),
  ]
  points.sort((a, b) => a - b)
  writeFileSync(
    join(root, 'inspection', name + '-boundary-times.json'),
    JSON.stringify(points, null, 2) + '\n',
  )
  if (!preview) {
    const boundaries = join(root, 'inspection', name + '-boundaries')
    mkdirSync(boundaries, { recursive: true })
    for (const [i, t] of points.entries())
      for (const offset of [-100, 0, 100]) {
        const at = Math.min(
          expectedDurationMs - 1000 / plan.fps,
          Math.max(0, t + offset),
        )
        execFileSync(
          runtime.ffmpeg,
          [
            '-v',
            'error',
            '-y',
            '-ss',
            String(at / 1000),
            '-i',
            video,
            '-frames:v',
            '1',
            '-vf',
            'scale=640:-2',
            join(boundaries, `${i}-${offset}.jpg`),
          ],
          { stdio: 'pipe' },
        )
      }
  }
  const result = {
    name,
    project: `projects/${project}.json`,
    ...info,
    expectedDurationMs,
    frames: plan.states.length,
    audio,
    preview: plan.preview,
    hash: hashFile(video),
  }
  results.push(result)
  writeFileSync(
    join(root, 'inspection', 'validation-results.json'),
    JSON.stringify(results, null, 2) + '\n',
  )
  writeFileSync(
    join(root, 'inspection', name + '-resolved.json'),
    JSON.stringify(describeProject(prepared), null, 2) + '\n',
  )
  console.log(JSON.stringify(result))
}
