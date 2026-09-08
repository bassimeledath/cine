// Compatibility entry point for raw footage. Project export is the preferred API.
import { dirname } from 'node:path'
import { readCursor } from './capture/artifacts.mjs'
import { compileProject } from './core/project.mjs'
import { exportVideo } from './render/export.mjs'
import { resolveRuntime } from './runtime/host.mjs'

export async function render({
  video,
  cursor,
  zoomRanges = [],
  durationMs,
  fps = 30,
  displayPoints,
  settings = {},
  outPath,
  width = 1920,
  height = 1080,
  videoT0,
  layers = [],
  audioCues = [],
  runtime,
}) {
  const rows = readCursor(cursor),
    origin = videoT0 ?? rows[0].t
  const screen = layers.find((l) => l.type === 'screen')
  const start = screen?.startMs ?? 0,
    from = screen?.sourceOffsetMs ?? 0
  const to = Math.min(
    durationMs,
    from + (screen ? screen.endMs - start : durationMs),
  )
  const capture = {
    frames: rows.map((f) => ({ ...f, t: f.t - origin })),
    durationMs,
    displayPoints,
  }
  const plan = compileProject(
    {
      schemaVersion: 1,
      output: { width, height, fps },
      settings,
      screen: {
        startMs: start,
        segments: [{ fromMs: from, toMs: to, rate: 1 }],
      },
      zoomRanges: zoomRanges.map((r) => ({
        ...r,
        start: r.start - origin,
        end: r.end - origin,
      })),
      layers: layers.filter((l) => l.type !== 'screen'),
      audioCues,
    },
    capture,
  )
  runtime ??= await resolveRuntime()
  return exportVideo({
    plan,
    videoPath: video,
    outPath,
    runtime,
    assetDir: dirname(video),
  })
}
