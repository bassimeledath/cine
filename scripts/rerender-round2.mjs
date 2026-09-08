import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { renderProject } from '../src/projects.mjs'
import { resolveRuntime } from '../src/runtime/host.mjs'
const root = resolve(
  process.argv[2] ?? readFileSync('/tmp/cine-round2-root', 'utf8').trim(),
)
const runtime = await resolveRuntime()
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
for (const [name, project, sceneId] of jobs) {
  await renderProject(join(root, 'projects', project + '.json'), {
    runtime,
    outPath: join(root, 'videos', name + '.mp4'),
    inspectionDir: join(root, 'inspection', name),
    ...(sceneId ? { preview: { sceneId } } : {}),
  })
}
