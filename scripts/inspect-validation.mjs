// Inspect completed validation exports without opening a desktop player.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { resolveRuntime } from '../src/runtime/host.mjs'
import { probeMedia } from '../src/media/ffmpeg.mjs'
import { loadCapture } from '../src/capture/artifacts.mjs'
import { compileProject } from '../src/core/project.mjs'
import { mixTrack } from '../src/media/audio.mjs'
import { resolve, dirname } from 'node:path'
const root = resolve(process.argv[2]),
  runtime = await resolveRuntime()
const jobs = [
  ['01-web-default', 'captures/web/project.json'],
  ['02-electron-showcase', 'captures/electron/project.json'],
  ['04-dynamic-workflow', 'projects/dynamic.json'],
  ['05-custom-branding', 'projects/branded.json'],
  ['06-custom-cursor', 'projects/custom-cursor.json'],
  ['07-mixed-speed', 'projects/mixed-speed.json'],
  ['08-portrait', 'projects/portrait.json'],
  ['09-edited-project', 'projects/edited-project.json'],
]
const results = []
for (const [name, relativeProject] of jobs) {
  const video = join(root, 'videos', name + '.mp4')
  if (!existsSync(video))
    throw new Error(`Expected validation video missing: ${name}`)
  const projectPath = join(root, relativeProject),
    project = JSON.parse(readFileSync(projectPath)),
    capture = loadCapture(resolve(dirname(projectPath), project.capture)),
    plan = compileProject(project, capture)
  const info = probeMedia(video, runtime.ffmpeg)
  const expectedMs = (plan.states.length / plan.fps) * 1000
  if (
    info.width !== plan.width ||
    info.height !== plan.height ||
    Math.abs(info.durationMs - expectedMs) > 1000 / plan.fps + 25
  )
    throw new Error(`Video dimensions/duration failed: ${name}`)
  const frames = join(root, 'inspection', name + '-decoded')
  mkdirSync(frames, { recursive: true })
  execFileSync(
    runtime.ffmpeg,
    [
      '-y',
      '-i',
      video,
      '-vf',
      'fps=2,scale=480:-2',
      '-q:v',
      '3',
      join(frames, '%03d.jpg'),
    ],
    { stdio: 'pipe' },
  )
  let audio = null
  if (plan.audioCues.length) {
    if (!info.hasAudio) throw new Error(`Audio missing: ${name}`)
    const raw = execFileSync(
      runtime.ffmpeg,
      ['-i', video, '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'],
      { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 },
    )
    const [l, r] = mixTrack(plan.audioCues, expectedMs)
    const actual = new Float32Array(
      raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
    )
    const expected = Float32Array.from(l, (v, i) => (v + r[i]) / 2)
    let best = { correlation: -1, offsetMs: 0 }
    for (let lag = -2400; lag <= 2400; lag += 48) {
      let cross = 0,
        aa = 0,
        bb = 0
      for (
        let i = 2400;
        i < Math.min(actual.length, expected.length) - 2400;
        i += 48
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
    audio = best
    if (best.correlation < 0.8 || Math.abs(best.offsetMs) > 25)
      throw new Error(
        `Audio alignment failed: ${name}: ${JSON.stringify(best)}`,
      )
  }
  const result = {
    name,
    ...info,
    expectedDurationMs: expectedMs,
    frames: plan.states.length,
    audio,
    project: relativeProject,
  }
  results.push(result)
  console.log(JSON.stringify(result))
}
writeFileSync(
  join(root, 'inspection', 'validation-results.json'),
  JSON.stringify(results, null, 2) + '\n',
)
