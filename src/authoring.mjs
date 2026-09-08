import { validateDocument } from './core/schema.mjs'
import {
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
  existsSync,
  mkdirSync,
} from 'node:fs'
import { resolve, dirname, relative } from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { readJson, loadCapture } from './capture/artifacts.mjs'
import { compileProject } from './core/project.mjs'
import { migrateProject } from './core/sequence.mjs'
import { CineError } from './core/errors.mjs'
import { prepareAudio } from './media/clips.mjs'
import { resolveRuntime } from './runtime/host.mjs'
import { buildScene, sceneAssets, TEMPLATES } from './scenes/build.mjs'
import { loadAssets } from './render/assets.mjs'
export const hashFile = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex')
export const CAPABILITIES = {
  schemaVersions: [1, 2],
  supportedOS: ['darwin'],
  capture: ['headless-chromium', 'hidden-electron', 'native-macos-opt-in'],
  scenes: ['source', 'hold', 'scene'],
  sceneCode: ['module', 'html', 'react-tsx'],
  templates: Object.keys(TEMPLATES),
  audioFiles: ['mp3', 'wav', 'm4a'],
  captions: ['vtt', 'srt', 'json'],
  covers: ['frame', 'image', 'scene', 'grid'],
  timing: ['outputMs', 'scene', 'action', 'sourceMs'],
  schema: 'schemas/project-v2.schema.json',
  commands: [
    'capabilities',
    'validate',
    'inspect',
    'migrate',
    'author',
    'scene init',
    'scene eject',
    'project patch',
    'preview',
    'render',
  ],
}

export async function prepareProject(
  projectPath,
  { runtime, project: override, checkScenes = true } = {},
) {
  const baseDir = dirname(resolve(projectPath)),
    project = override ?? readJson(projectPath)
  if (typeof project.capture !== 'string')
    throw new CineError(
      'CAPTURE_REQUIRED',
      'capture',
      'Provide a capture manifest path',
    )
  validateDocument(project)
  const capture = loadCapture(resolve(baseDir, project.capture))
  runtime ??= await resolveRuntime()
  const { media, warnings } = await prepareAudio(
    project.audioClips ?? [],
    baseDir,
    runtime.ffmpeg,
  )
  const plan = compileProject(project, capture, { media })
  loadAssets(plan.settings, baseDir)
  const sceneBundles = checkScenes
    ? await Promise.all(
        plan.layers
          .filter((l) => l.type === 'custom')
          .map((layer) => buildScene(layer, baseDir)),
      )
    : undefined
  if (plan.cover?.type === 'image')
    sceneAssets({ cover: plan.cover.file }, baseDir)
  if (plan.cover?.type === 'scene' && plan.cover.entry && checkScenes)
    await buildScene({ ...plan.cover, id: 'cover' }, baseDir)
  if (
    plan.cover &&
    !['image', 'scene', 'frame', 'grid'].includes(plan.cover.type)
  )
    throw new CineError('INVALID_COVER', 'cover.type', 'Unknown cover type')
  const times =
    plan.cover?.type === 'frame'
      ? [plan.cover.atMs]
      : plan.cover?.type === 'grid'
        ? plan.cover.frames
        : []
  if (
    !Array.isArray(times) ||
    times.some((t) => !Number.isFinite(t) || t < 0 || t >= plan.durationMs)
  )
    throw new CineError(
      'INVALID_COVER',
      'cover',
      'Selected frames must be inside output duration',
    )
  return {
    project,
    capture,
    plan,
    media,
    warnings,
    runtime,
    baseDir,
    sceneBundles,
  }
}
export function describeProject(prepared) {
  const { project, capture, plan, warnings, baseDir = '.' } = prepared
  const assetDependencies = []
  const add = (owner, file) => {
    if (file)
      assetDependencies.push({ owner, file, path: resolve(baseDir, file) })
  }
  add('capture', project.capture)
  add('capture.video', capture.videoPath)
  add('capture.cursor', capture.cursorPath)
  for (const key of ['backgroundImage', 'cursorImage'])
    add(`settings.${key}`, plan.settings[key])
  for (const layer of plan.layers) {
    add(`layers.${layer.id}.entry`, layer.entry)
    for (const [key, file] of Object.entries(layer.assets ?? {}))
      add(`layers.${layer.id}.assets.${key}`, file)
  }
  for (const clip of project.audioClips ?? []) {
    add(`audioClips.${clip.id}.file`, clip.file)
    add(`audioClips.${clip.id}.captions`, clip.captions?.file)
  }
  add('cover.file', plan.cover?.file)
  add('cover.entry', plan.cover?.entry)
  for (const [key, file] of Object.entries(plan.cover?.assets ?? {}))
    add(`cover.assets.${key}`, file)
  return {
    schemaVersion: project.schemaVersion,
    durationMs: plan.durationMs,
    output: {
      width: plan.width,
      height: plan.height,
      fps: plan.fps,
      frames: plan.states.length,
    },
    scenes: plan.scenes,
    layers: plan.layers,
    assetDependencies,
    actions: capture.actions ?? [],
    eventCount: capture.events?.length ?? 0,
    anchors: Object.keys(capture.anchors ?? {}),
    camera: plan.camera,
    audioClips: plan.audioClips,
    captions: plan.captions,
    cover: plan.cover ?? { type: 'automatic-frame' },
    warnings,
  }
}
function atomicWrite(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const temp = path + '.' + randomUUID() + '.tmp'
  try {
    writeFileSync(temp, JSON.stringify(value, null, 2) + '\n')
    renameSync(temp, path)
  } finally {
    rmSync(temp, { force: true })
  }
}
export async function patchProject(
  path,
  operations,
  { expectedHash, runtime } = {},
) {
  const originalHash = hashFile(path)
  if (expectedHash && originalHash !== expectedHash)
    throw new CineError(
      'PROJECT_CHANGED',
      'project',
      'Project hash differs from expectedHash',
      'Inspect current project before applying the edit',
    )
  const project = readJson(path)
  if (!Array.isArray(operations))
    throw new Error('Patch file must contain an array of operations')
  for (const operation of operations) {
    const { op, id, changes, value, collection } = operation
    if (op === 'set') {
      if (
        ![
          'cover',
          'settings',
          'camera',
          'sound',
          'captions',
          'output',
        ].includes(operation.path)
      )
        throw new Error(
          'set accepts cover, settings, camera, sound, captions, or output',
        )
      project[operation.path] = value
      continue
    }
    if (!['scenes', 'layers', 'audioClips'].includes(collection))
      throw new Error('Patch collection must be scenes, layers, or audioClips')
    const items = (project[collection] ??= []),
      index = items.findIndex((item) => item.id === id)
    if (op === 'add') {
      if (items.some((item) => item.id === value?.id))
        throw new Error('ID already exists')
      items.splice(operation.index ?? items.length, 0, value)
    } else {
      if (index < 0) throw new Error(`Unknown ${collection} ID ${id}`)
      if (op === 'update') {
        if (changes?.id && changes.id !== id)
          throw new Error('Update cannot change an ID')
        items[index] = { ...items[index], ...changes }
      } else if (op === 'remove') items.splice(index, 1)
      else throw new Error(`Unknown patch operation ${op}`)
    }
    project[collection] = items
  }
  const prepared = await prepareProject(path, { runtime, project })
  if (hashFile(path) !== originalHash)
    throw new CineError(
      'PROJECT_CHANGED',
      'project',
      'Project changed during validation; edit was not applied',
    )
  atomicWrite(resolve(path), project)
  return {
    project: resolve(path),
    previousHash: originalHash,
    hash: hashFile(path),
    operations: operations.length,
    ...describeProject(prepared),
  }
}
export async function migrateProjectFile(path, out, { runtime } = {}) {
  if (existsSync(out))
    throw new Error('Migration output exists; choose a new file')
  const source = readJson(path),
    base = dirname(resolve(path)),
    capture = loadCapture(resolve(base, source.capture)),
    project = migrateProject(source, capture)
  if (dirname(resolve(out)) !== base)
    throw new Error(
      'Place migrated project beside the original to preserve relative scene and media paths',
    )
  await prepareProject(path, { runtime, project })
  atomicWrite(resolve(out), project)
  return { project: resolve(out), schemaVersion: 2 }
}
export function authorV2(manifestPath, projectPath, overrides = {}) {
  const capture = loadCapture(manifestPath)
  const project = {
    schemaVersion: 2,
    capture: relative(dirname(resolve(projectPath)), resolve(manifestPath)),
    output: { width: 1920, height: 1080, fps: capture.fps ?? 30 },
    settings: {},
    scenes: [
      { id: 'workflow', kind: 'source', fromMs: 0, toMs: capture.durationMs },
    ],
    layers: [],
    audioClips: [],
    camera: { policy: 'kino' },
    sound: { preset: 'recorded', transitions: false },
    ...overrides,
  }
  compileProject(project, capture)
  atomicWrite(resolve(projectPath), project)
  return project
}
