#!/usr/bin/env node
import { existsSync, mkdirSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { homedir } from 'node:os'
import {
  runDemo,
  runWebDemo,
  runElectronDemo,
  captureElectron,
} from '../src/demo.mjs'
import {
  authorProject,
  authorLegacyProject,
  renderProject,
} from '../src/projects.mjs'
import { captureChromium } from '../src/capture/chromium.mjs'
import { resolveRuntime } from '../src/runtime/host.mjs'
import {
  readJson,
  readCursor,
  writeJson,
  loadCapture,
} from '../src/capture/artifacts.mjs'
import { buildZoomRanges } from '../src/autozoom.mjs'
import { buildShowcase } from '../src/examples/showcase.mjs'
import { migrateProject } from '../src/core/sequence.mjs'
import { render } from '../src/render.mjs'

import {
  CAPABILITIES,
  prepareProject,
  describeProject,
  patchProject,
  migrateProjectFile,
  authorV2,
  hashFile,
} from '../src/authoring.mjs'
import { scaffoldScene } from '../src/scenes/build.mjs'

const [command, ...args] = process.argv.slice(2)
const subcommand = ['scene', 'project'].includes(command)
  ? args.shift()
  : undefined
const json = process.argv.includes('--json')
if (json) console.log = (...args) => console.error(...args)
const output = (value) =>
  process.stdout.write(
    (json
      ? JSON.stringify(value)
      : typeof value === 'string'
        ? value
        : JSON.stringify(value, null, 2)) + '\n',
  )
const values = new Map(),
  flags = new Set([
    '--native',
    '--electron',
    '--force',
    '--help',
    '--json',
    '--legacy',
  ])
const known = new Set([
  '--out',
  '--url',
  '--fps',
  '--cdp',
  '--target',
  '--work',
  '--script',
  '--project',
  '--capture',
  '--cursor',
  '--video',
  '--cuts',
  '--display-points',
  '--duration-ms',
  '--video-t0',
  '--inspect',
  '--dir',
  '--template',
  '--file',
  '--expected-hash',
  '--scene',
  '--from-ms',
  '--to-ms',
])
function parseOptions() {
  for (let i = 0; i < args.length; i++) {
    const key = args[i]
    if (flags.has(key)) values.set(key, true)
    else {
      if (!known.has(key) || !args[i + 1] || args[i + 1].startsWith('--'))
        throw new Error(`Unknown option or missing value: ${key}`)
      values.set(key, args[++i])
    }
  }
}
const arg = (key, fallback) => values.get(key) ?? fallback
const required = (key) => {
  if (!arg(key)) throw new Error(`${key} is required`)
  return arg(key)
}
const fps = () => {
  const n = Number(arg('--fps', 30))
  if (!Number.isFinite(n) || n < 1 || n > 120)
    throw new Error('fps must be in [1,120]')
  return n
}
const out = (name) => resolve(arg('--out', join(homedir(), 'Downloads', name)))
const script = () => {
  if (!arg('--script')) return undefined
  const actions = readJson(arg('--script'))
  if (!Array.isArray(actions))
    throw new Error('Action script must be a JSON array')
  return actions.map(action => action.type === 'audioInput' && typeof action.file === 'string'
    ? { ...action, file: resolve(dirname(resolve(arg('--script'))), action.file) } : action)
}
const help = `cine — cinematic demos (macOS supported initially)
  demo [--electron|--native] [--url URL --script actions.json] [--work DIR] [--out MP4]
  capture --url URL|--cdp ENDPOINT --script actions.json --work DIR [--target exactURL]
  author --capture DIR/meta.json --project project.json [--force]
  showcase --work DIR [--project project.json] [--out MP4]
  render --project project.json --out MP4 [--inspect DIR]
  autozoom --cursor cursor.jsonl [--out cuts.json]
  render --video raw.mp4 --cursor cursor.jsonl --cuts cuts.json --duration-ms MS
         --display-points WxH [--video-t0 MS] --out MP4
  capabilities [--json]
  validate|inspect --project FILE [--json]
  migrate --project FILE --out NEW_FILE
  scene init|eject --template title|chapter|metric|split --dir DIR
  project patch --project FILE --file operations.json [--expected-hash SHA256]
  preview --project FILE [--scene ID | --from-ms MS --to-ms MS] --out MP4
  doctor

Environment: CINE_CHROME, CINE_FFMPEG; native only: CINE_CLICLICK.
Project paths are resolved relative to the project file. Rendering never rewrites it.`

async function main() {
  parseOptions()
  if (command === 'capabilities') {
    output(CAPABILITIES)
    return
  }
  if (command === 'inspect' || command === 'validate') {
    const prepared = await prepareProject(required('--project'))
    output({
      ok: true,
      ...describeProject(prepared),
      hash: hashFile(arg('--project')),
    })
    return
  }
  if (command === 'migrate') {
    output(await migrateProjectFile(required('--project'), required('--out')))
    return
  }
  if (command === 'scene' && ['init', 'eject'].includes(subcommand)) {
    output(scaffoldScene(arg('--template', 'title'), required('--dir')))
    return
  }
  if (command === 'project' && subcommand === 'patch') {
    output(
      await patchProject(required('--project'), readJson(required('--file')), {
        expectedHash: arg('--expected-hash'),
      }),
    )
    return
  }
  if (command === 'preview') {
    const path = await renderProject(required('--project'), {
      outPath: out('cine-preview.mp4'),
      inspectionDir: arg('--inspect'),
      preview: {
        sceneId: arg('--scene'),
        fromMs:
          arg('--from-ms') === undefined ? undefined : Number(arg('--from-ms')),
        toMs: arg('--to-ms') === undefined ? undefined : Number(arg('--to-ms')),
      },
    })
    output({ video: path, artifacts: readJson(path + '.artifacts.json') })
    return
  }
  if (!command || command === 'help' || arg('--help')) {
    output(help)
    return
  }
  if (command === 'doctor') {
    output({
      supportedOS: 'macOS',
      platform: process.platform,
      ...(await resolveRuntime()),
    })
    return
  }
  if (command === 'demo') {
    if (arg('--native') && arg('--electron'))
      throw new Error('Choose one capture backend')
    if (arg('--native') && (arg('--cdp') || arg('--target')))
      throw new Error('Native demo does not support --cdp or --target')
    if (arg('--electron') && arg('--url'))
      throw new Error(
        'Electron demo uses the bundled app; use --cdp to attach to another app',
      )
    if (arg('--url') && !arg('--script'))
      throw new Error('Custom URLs need --script actions.json')
    const options = {
      outPath: out('cine-demo.mp4'),
      workDir: arg('--work'),
      fps: fps(),
      beats: script(),
      url: arg('--url'),
      connectTo: arg('--cdp'),
      targetUrl: arg('--target'),
      inspectionDir: arg('--inspect'),
    }
    const run = arg('--native')
      ? runDemo
      : arg('--electron')
        ? runElectronDemo
        : runWebDemo
    output(await run(options))
    return
  }
  if (command === 'capture') {
    const work = resolve(required('--work'))
    required('--script')
    if (!arg('--url') && !arg('--cdp'))
      throw new Error('capture needs --url or --cdp')
    const result = await captureChromium({
      url: arg('--url'),
      connectTo: arg('--cdp'),
      targetUrl: arg('--target'),
      actions: script(),
      videoPath: join(work, 'raw.mp4'),
      cursorPath: join(work, 'cursor.jsonl'),
      fps: fps(),
      runtime: await resolveRuntime(),
    })
    output({ capture: result.manifestPath })
    return
  }
  if (command === 'author') {
    const project = resolve(required('--project'))
    if (existsSync(project) && !arg('--force')) {
      throw new Error('Project exists; use --force to regenerate it')
    }
    const author = arg('--legacy') ? authorLegacyProject : authorV2
    author(resolve(required('--capture')), project)
    output({ project })
    return
  }
  if (command === 'showcase') {
    const work = resolve(
      arg(
        '--work',
        join(homedir(), 'Downloads', `cine-showcase-${Date.now()}`),
      ),
    )
    mkdirSync(work, { recursive: true })
    const manifest = join(work, 'meta.json'),
      projectPath = resolve(arg('--project', join(work, 'project.json')))
    if (!existsSync(projectPath)) {
      if (!existsSync(manifest))
        await captureElectron({ workDir: work, fps: fps() })
      const capture = loadCapture(manifest),
        zoomRanges = buildZoomRanges(capture.frames)
      const original = readJson(manifest)
      const { layers, audioCues } = buildShowcase({
        cursorPath: capture.cursorPath,
        videoT0: original.videoT0 ?? 0,
        durationMs: capture.durationMs,
        anchors: capture.anchors,
        zoomRanges,
      })
      const lead = layers.find((l) => l.type === 'screen').startMs,
        screenEnd = lead + capture.durationMs
      const overlays = layers
        .filter((l) => l.type !== 'screen')
        .map((layer) => {
          const l = { ...layer }
          if (['lower', 'toast', 'callout'].includes(l.type)) {
            l.timebase = 'source'
            l.startMs -= lead
            l.endMs -= lead
          }
          if (l.type === 'outro') {
            l.timebase = 'screenEnd'
            l.startMs -= screenEnd
            l.endMs -= screenEnd
          }
          if (l.type === 'badge') {
            l.endAt = 'screenEnd'
            l.endOffsetMs = -400
          }
          if (l.anchor)
            l.anchorSelector = Object.keys(capture.anchors).find(
              (key) =>
                JSON.stringify(capture.anchors[key]) ===
                JSON.stringify(l.anchor),
            )
          return l
        })
      const cues = audioCues.map((c) =>
        c.sound === 'pad'
          ? c
          : c.sound === 'chime'
            ? { ...c, atMs: c.atMs - screenEnd, timebase: 'screenEnd' }
            : { ...c, atMs: c.atMs - lead, timebase: 'source' },
      )
      authorLegacyProject(manifest, projectPath, {
        screen: { startMs: lead },
        zoomRanges,
        layers: overlays,
        audioCues: cues,
      })
      const authored = migrateProject(readJson(projectPath), capture)
      authored.camera = { policy: 'kino' }
      authored.sound = { preset: 'recorded', transitions: false }
      authored.audioCues = []
      writeJson(projectPath, authored)
    }
    output(
      await renderProject(projectPath, {
        outPath: out('cine-showcase.mp4'),
        inspectionDir: arg('--inspect'),
      }),
    )
    return
  }
  if (command === 'autozoom') {
    const frames = readCursor(required('--cursor')),
      origin = frames[0].t
    const ranges = buildZoomRanges(frames).map((r) => ({
      ...r,
      start: r.start - origin,
      end: r.end - origin,
    }))
    if (arg('--out')) writeJson(arg('--out'), ranges)
    output(ranges)
    return
  }
  if (command === 'render') {
    if (arg('--project')) {
      output(
        await renderProject(arg('--project'), {
          outPath: out('cine-render.mp4'),
          inspectionDir: arg('--inspect'),
        }),
      )
      return
    }
    const cursor = required('--cursor'),
      origin = readCursor(cursor)[0].t
    const zoomRanges = arg('--cuts')
      ? readJson(arg('--cuts')).map((r) => ({
          ...r,
          start: r.start + origin,
          end: r.end + origin,
        }))
      : []
    const [w, h] = required('--display-points').split('x').map(Number)
    await render({
      video: resolve(required('--video')),
      cursor: resolve(cursor),
      zoomRanges,
      durationMs: Number(required('--duration-ms')),
      displayPoints: { w, h },
      fps: fps(),
      videoT0:
        arg('--video-t0') === undefined ? undefined : Number(arg('--video-t0')),
      outPath: out('cine-render.mp4'),
    })
    return
  }
  throw new Error(`Unknown command: ${command}\n${help}`)
}
main().catch((error) => {
  if (json)
    output({
      ok: false,
      error:
        typeof error.toJSON === 'function'
          ? error.toJSON()
          : { code: 'CINE_ERROR', message: error.message },
    })
  else console.error(error.message)
  process.exitCode = 1
})
