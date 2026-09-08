import { prepareProject, authorV2 } from './authoring.mjs'
import { previewPlan } from './core/preview.mjs'
import { prepareAudio } from './media/clips.mjs'
import { dirname, resolve, relative } from 'node:path'
import { mkdirSync } from 'node:fs'
import { loadCapture, readJson, writeJson } from './capture/artifacts.mjs'
import { buildZoomRanges } from './autozoom.mjs'
import { autoCues } from './media/audio.mjs'
import { findClicks } from './core/events.mjs'
import { compileProject } from './core/project.mjs'
import { resolveRuntime } from './runtime/host.mjs'
import { exportVideo } from './render/export.mjs'

export function authorLegacyProject(manifestPath, projectPath, overrides = {}) {
  const capture = loadCapture(manifestPath)
  const zoomRanges = buildZoomRanges(capture.frames)
  const audioCues = autoCues({
    clicks: findClicks(capture.frames),
    zoomRanges,
  }).map((c) => ({ ...c, timebase: 'source' }))
  const project = {
    schemaVersion: 1,
    capture: relative(dirname(resolve(projectPath)), resolve(manifestPath)),
    output: { width: 1920, height: 1080, fps: capture.fps ?? 30 },
    settings: {},
    screen: { startMs: 0 },
    zoomRanges,
    layers: [],
    audioCues,
    ...overrides,
  }
  compileProject(project, capture)
  mkdirSync(dirname(resolve(projectPath)), { recursive: true })
  writeJson(projectPath, project)
  return project
}

export function authorProject(manifestPath, projectPath, overrides = {}) {
  return overrides.schemaVersion === 1
    ? authorLegacyProject(manifestPath, projectPath, overrides)
    : authorV2(manifestPath, projectPath, overrides)
}

export async function renderProject(
  projectPath,
  { outPath, runtime, inspectionDir, preview } = {},
) {
  const prepared = await prepareProject(projectPath, { runtime })
  const { capture, media, warnings, baseDir } = prepared
  for (const warning of warnings) console.error(JSON.stringify(warning))
  const plan = preview ? previewPlan(prepared.plan, preview) : prepared.plan
  return exportVideo({
    plan,
    videoPath: capture.videoPath,
    assetDir: baseDir,
    outPath: resolve(outPath ?? resolve(baseDir, 'output.mp4')),
    runtime: prepared.runtime,
    inspectionDir,
    media,
    audioSourcePlan: preview ? prepared.plan : undefined,
    writeCover: !preview,
    sceneBundles: prepared.sceneBundles,
    cacheDir:
      !preview && plan.schemaVersion === 2
        ? resolve(baseDir, '.cine-cache')
        : undefined,
  })
}
