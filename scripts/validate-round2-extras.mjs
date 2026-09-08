import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveRuntime } from '../src/runtime/host.mjs'
import { captureChromium } from '../src/capture/chromium.mjs'
import { authorProject, renderProject } from '../src/projects.mjs'
import { writeJson } from '../src/capture/artifacts.mjs'
const root = resolve(
    process.argv[2] ?? readFileSync('/tmp/cine-round2-root', 'utf8').trim(),
  ),
  runtime = await resolveRuntime()
const scenes = {
  schemaVersion: 2,
  capture: '../captures/workflow/meta.json',
  output: { width: 1280, height: 720, fps: 30 },
  settings: {
    backgroundGradientFrom: '#10252b',
    backgroundGradientTo: '#244d4e',
    accentColor: '#b8edcb',
  },
  sound: { preset: 'subtle' },
  scenes: [
    {
      id: 'modified-title',
      kind: 'scene',
      entry: '../scenes/title/modified.mjs',
      props: {
        kicker: 'A TEMPLATE, MADE YOUR OWN',
        head: 'Code is the creative surface.',
        sub: 'Modify the template. Or start from a blank file.',
      },
      durationMs: 2600,
    },
    {
      id: 'metric',
      kind: 'scene',
      entry: '../scenes/metric/metric.tsx',
      props: {
        label: 'EDITABLE REACT COMPONENT',
        value: 100,
        caption: 'Your data. Your design.',
      },
      durationMs: 2200,
    },
    {
      id: 'split',
      kind: 'scene',
      entry: '../scenes/split/split.tsx',
      props: { left: 'Use a template.', right: 'Create something new.' },
      durationMs: 2400,
    },
    {
      id: 'original',
      kind: 'scene',
      entry: '../scenes/original.tsx',
      durationMs: 2800,
    },
  ],
  cover: {
    type: 'scene',
    entry: '../scenes/title/modified.mjs',
    props: {
      head: 'Scenes authored in code.',
      kicker: 'CINE / CREATIVE CONTROL',
    },
    atMs: 1000,
    durationMs: 3000,
  },
}
writeJson(join(root, 'projects', 'custom-scenes.json'), scenes)
await renderProject(join(root, 'projects', 'custom-scenes.json'), {
  outPath: join(root, 'videos', '09-custom-code.mp4'),
  runtime,
  inspectionDir: join(root, 'inspection', '09-custom-code'),
})
const dir = join(root, 'captures', 'typing')
mkdirSync(dir, { recursive: true })
const html = join(root, 'assets', 'typing.html')
writeFileSync(
  html,
  `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#ecf1ef;color:#18372d;font:22px Arial;padding:55px 110px}h1{font-size:46px;margin:0 0 12px}p{color:#678176}main{background:white;padding:30px;border-radius:20px;margin-top:30px;box-shadow:0 14px 70px #1033280b}label{display:block;font-size:15px;margin:12px 0;color:#56766a}input,textarea,[contenteditable]{display:block;border:1px solid #c6d8cf;border-radius:9px;width:100%;padding:16px;font:23px Arial;min-height:60px;outline-color:#377e5a}textarea{height:92px}#result{font-size:16px;min-height:25px;color:#377e5a}</style><h1>Words, at a human pace.</h1><p>Text fields, notes, and rich text. With actual typing.</p><main><label>RELEASE TITLE</label><input id="name"><label>RELEASE NOTES</label><textarea id="note"></textarea><label>ANNOUNCEMENT</label><div id="editor" contenteditable="true"></div><p id="result">Ready when you are.</p></main><script>document.addEventListener('input',e=>result.textContent=e.target.value??e.target.textContent)</script>`,
)
const actions = [
  {
    id: 'title',
    type: 'type',
    selector: '#name',
    text: 'A calmer release',
    typing: { cps: 16 },
    moveMs: 400,
    dwellMs: 450,
  },
  {
    id: 'notes',
    type: 'type',
    selector: '#note',
    text: 'Ready to share 🚀!',
    typing: { cps: 16 },
    moveMs: 400,
    dwellMs: 450,
  },
  {
    id: 'correct-note',
    type: 'key',
    key: 'Backspace',
    dwellMs: 550,
    expect: { selector: '#result', text: 'Ready to share 🚀' },
  },
  {
    id: 'announcement',
    type: 'type',
    selector: '#editor',
    text: 'Published to the team.',
    typing: { cps: 16 },
    moveMs: 400,
    dwellMs: 650,
    expect: { selector: '#editor', text: 'Published to the team.' },
  },
  {
    id: 'correct-announcement',
    type: 'key',
    key: 'Backspace',
    dwellMs: 700,
    expect: { selector: '#editor', text: 'Published to the team' },
  },
]
writeJson(join(root, 'assets', 'typing-actions.json'), actions)
if (!existsSync(join(dir, 'meta.json')))
  await captureChromium({
    url: pathToFileURL(html).href,
    actions,
    videoPath: join(dir, 'raw.mp4'),
    cursorPath: join(dir, 'cursor.jsonl'),
    runtime,
    fps: 30,
    displayPoints: { w: 1280, h: 800 },
    leadInMs: 1300,
    tailMs: 1300,
  })
const projectPath = join(root, 'projects', 'typing.json')
authorProject(join(dir, 'meta.json'), projectPath, {
  output: { width: 1280, height: 720, fps: 30 },
  camera: { policy: 'off' },
  settings: {
    backgroundGradientFrom: '#10252b',
    backgroundGradientTo: '#244d4e',
  },
})
await renderProject(projectPath, {
  outPath: join(root, 'videos', '10-typing-and-corrections.mp4'),
  runtime,
  inspectionDir: join(root, 'inspection', '10-typing-and-corrections'),
})
console.log(root)
