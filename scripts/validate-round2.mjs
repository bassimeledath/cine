import {
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  rmSync,
} from 'node:fs'
import { resolve, join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { captureChromium } from '../src/capture/chromium.mjs'
import { loadCapture, writeJson } from '../src/capture/artifacts.mjs'
import { resolveRuntime } from '../src/runtime/host.mjs'
import { runProcess } from '../src/runtime/process.mjs'
import {
  authorProject,
  authorLegacyProject,
  renderProject,
} from '../src/projects.mjs'
import { scaffoldScene } from '../src/scenes/build.mjs'
import {
  prepareProject,
  describeProject,
  patchProject,
  hashFile,
} from '../src/authoring.mjs'
import { prepareAudio } from '../src/media/clips.mjs'
import { writeWav, mixTrack } from '../src/media/audio.mjs'
import { serializeCaptions } from '../src/core/captions.mjs'
const root = resolve(
  process.argv[2] ??
    join(
      homedir(),
      'Downloads',
      `cine-round2-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`,
    ),
)
for (const dir of [
  'videos',
  'captures',
  'projects',
  'scenes',
  'assets',
  'audio',
  'inspection',
  'logs',
])
  mkdirSync(join(root, dir), { recursive: true })
writeFileSync('/tmp/cine-round2-root', root)
const runtime = await resolveRuntime(),
  captureDir = join(root, 'captures', 'workflow'),
  manifest = join(captureDir, 'meta.json')
copyFileSync(
  'tests/fixtures/dynamic.html',
  join(root, 'assets', 'workflow.html'),
)
const actions = [
  {
    id: 'open',
    selector: '#open',
    moveMs: 450,
    dwellMs: 500,
    expect: { selector: '#composer' },
  },
  {
    id: 'name',
    type: 'type',
    selector: '#name',
    text: 'A smoother release 🚀',
    typing: { cps: 15, replace: true },
    moveMs: 450,
    dwellMs: 600,
  },
  {
    id: 'save',
    selector: '#save',
    moveMs: 450,
    dwellMs: 1800,
    expect: { selector: '#status', text: 'Saved: A smoother release' },
  },
  {
    id: 'revisit',
    selector: '#save',
    moveMs: 450,
    dwellMs: 600,
    expect: { selector: '#status', text: 'Saved:' },
  },
  { id: 'scroll', type: 'scroll', y: 650, dwellMs: 600 },
  {
    id: 'publish',
    selector: '#finish',
    moveMs: 500,
    dwellMs: 1200,
    expect: { selector: '#done', text: 'Published to the team' },
  },
]
writeJson(join(root, 'assets', 'actions.json'), actions)
if (!existsSync(manifest))
  await captureChromium({
    url: pathToFileURL(join(root, 'assets', 'workflow.html')).href,
    actions,
    videoPath: join(captureDir, 'raw.mp4'),
    cursorPath: join(captureDir, 'cursor.jsonl'),
    runtime,
    fps: 30,
    displayPoints: { w: 1280, h: 800 },
    anchorSelectors: ['#save', '#name', '#status', '#finish', '#done'],
    leadInMs: 1400,
    tailMs: 1600,
  })
const capture = loadCapture(manifest)
for (const template of ['title', 'chapter', 'metric', 'split'])
  if (!existsSync(join(root, 'scenes', template)))
    scaffoldScene(template, join(root, 'scenes', template))
// A changed template remains ordinary editable code, not an engine modification.
const titleCode = readFileSync(
  join(root, 'scenes', 'title', 'title.mjs'),
  'utf8',
)
writeFileSync(
  join(root, 'scenes', 'title', 'modified.mjs'),
  titleCode
    .replace("letterSpacing:'.18em'", "letterSpacing:'.28em'")
    .replace(
      'root.append(kicker,head,sub)',
      "root.append(kicker,head,sub);root.style.borderLeft='14px solid '+theme.accentColor;root.style.textAlign='left'",
    ),
)
writeFileSync(
  join(root, 'scenes', 'original.tsx'),
  `import React from 'react';export default function Scene({timeMs,theme,height,props}){const p=Math.min(1,timeMs/1000);return <div style={{position:'absolute',inset:0,background:'#10252b',color:'#e8f4ec',padding:'9%',fontFamily:'Arial',display:'flex',flexDirection:'column',justifyContent:'center'}}><div style={{color:'#9edbbb',letterSpacing:5,fontSize:height*.023}}>MERIDIAN / RELEASE COMPLETE</div><h1 style={{fontSize:height*.083,lineHeight:1.04,margin:'30px 0'}}>A small workflow.<br/>A complete story.</h1><div style={{display:'flex',gap:30,marginTop:25}}>{['Write','Save','Publish'].map((word,i)=><div key={word} style={{flex:1,borderTop:'3px solid #9edbbb',paddingTop:20,fontSize:height*.035,opacity:Math.max(0,Math.min(1,(timeMs-i*180)/500)),transform:'translateY('+((1-p)*20)+'px)'}}><span style={{color:'#91a99e',fontSize:height*.018}}>0{i+1}</span><br/>{word}</div>)}</div></div>}`,
)
writeFileSync(
  join(root, 'scenes', 'overlay.mjs'),
  `export function createScene(root,{props}){const el=document.createElement('div');el.textContent=props.text??'Saved and ready';el.style.cssText='position:absolute;right:6%;top:7%;border-radius:999px;background:#c5f4d7;color:#123d2a;padding:18px 30px;font:600 26px Arial;box-shadow:0 8px 24px #0003';root.append(el);return{renderFrame({timeMs,durationMs}){el.style.opacity=Math.min(1,timeMs/250,(durationMs-timeMs)/250)}}}`,
)
writeFileSync(
  join(root, 'assets', 'cover.svg'),
  '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#193c47"/><circle cx="1060" cy="180" r="300" fill="#305f60"/><text x="90" y="270" font-size="26" font-family="Arial" fill="#a4e8c3">MERIDIAN / A PRODUCT DEMO</text><text x="90" y="390" font-size="84" font-family="Arial" font-weight="bold" fill="#f1f5eb">From idea to shipped.</text></svg>',
)
const speech = [
  [
    'intro',
    'A smoother release, from the first idea to the final announcement.',
  ],
  ['saved', 'Your release is saved. Review the result before moving on.'],
  ['publish', 'The announcement is now published to the team.'],
]
for (const [id, text] of speech) {
  const mp3 = join(root, 'audio', id + '.mp3')
  if (!existsSync(mp3)) {
    await runProcess('/usr/bin/say', [
      '-v',
      'Samantha',
      '-r',
      '165',
      '-o',
      join(root, 'audio', id + '.aiff'),
      text,
    ])
    await runProcess(runtime.ffmpeg, [
      '-v',
      'error',
      '-y',
      '-i',
      join(root, 'audio', id + '.aiff'),
      '-ar',
      '48000',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '160k',
      mp3,
    ])
  }
}
const descriptors = speech.map(([id]) => ({ id, file: `audio/${id}.mp3` }))
const { media } = await prepareAudio(descriptors, root, runtime.ffmpeg)
for (const [id, text] of speech) {
  writeFileSync(
    join(root, 'audio', id + '.vtt'),
    serializeCaptions([{ startMs: 0, endMs: media[id].durationMs, text }]),
  )
  writeJson(join(root, 'audio', id + '.transcript.json'), {
    text,
    timing: 'single phrase spanning decoded speech; no word alignment inferred',
    durationMs: media[id].durationMs,
  })
}
const save =
  capture.actions.find((a) => a.id === 'save').milestones.verified + 450
const duration = capture.durationMs
const common = {
  output: { width: 1280, height: 720, fps: 30 },
  settings: {
    backgroundGradientFrom: '#10252b',
    backgroundGradientTo: '#244d4e',
    brandColor: '#438b6b',
    accentColor: '#b8edcb',
  },
  capture: '../captures/workflow/meta.json',
}
const base = authorProject(
  manifest,
  join(root, 'projects', 'editorial.json'),
  common,
)
const legacy = authorLegacyProject(
  manifest,
  join(root, 'projects', 'legacy.json'),
  common,
)
writeJson(join(root, 'projects', 'legacy.json'), legacy)
const narrated = {
  ...base,
  scenes: [
    {
      id: 'intro',
      kind: 'scene',
      entry: '../scenes/title/title.mjs',
      duration: { audio: 'intro' },
      props: {
        head: 'Release with confidence.',
        kicker: 'MERIDIAN',
        sub: 'A workflow, told clearly.',
      },
    },
    { id: 'write-and-save', kind: 'source', fromMs: 0, toMs: save },
    {
      id: 'saved-result',
      kind: 'hold',
      sourceMs: save - 1,
      duration: { audio: 'saved' },
    },
    {
      id: 'chapter',
      kind: 'scene',
      entry: '../scenes/chapter/chapter.mjs',
      durationMs: 1800,
      props: { number: '02', title: 'Share it with your team.' },
    },
    { id: 'publish-flow', kind: 'source', fromMs: save, toMs: duration },
    {
      id: 'outro',
      kind: 'scene',
      entry: '../scenes/original.tsx',
      duration: { audio: 'publish' },
    },
  ],
  audioClips: [
    {
      id: 'intro',
      file: '../audio/intro.mp3',
      at: { outputMs: 0 },
      captions: { file: '../audio/intro.vtt' },
    },
    {
      id: 'saved',
      file: '../audio/saved.mp3',
      at: { scene: 'saved-result' },
      captions: { file: '../audio/saved.vtt' },
    },
    {
      id: 'publish',
      file: '../audio/publish.mp3',
      at: { scene: 'outro' },
      captions: { file: '../audio/publish.vtt' },
    },
  ],
  layers: [
    {
      id: 'saved-badge',
      type: 'custom',
      entry: '../scenes/overlay.mjs',
      at: { scene: 'saved-result' },
      durationMs: media.saved.durationMs,
      props: { text: 'Saved · ready for review' },
    },
  ],
  cover: {
    type: 'scene',
    entry: '../scenes/title/modified.mjs',
    atMs: 1000,
    durationMs: 3000,
    props: { head: 'Release with confidence.', kicker: 'MERIDIAN' },
  },
}
writeJson(join(root, 'projects', 'narrated.json'), narrated)
const speed = structuredClone(narrated)
speed.scenes.find((s) => s.id === 'publish-flow').rate = 2
speed.scenes.find((s) => s.id === 'publish-flow').fromMs += 350
speed.cover = { type: 'grid', frames: [1000, 5000, 10000, 15000] }
writeJson(join(root, 'projects', 'speed.json'), speed)
const portrait = structuredClone(narrated)
portrait.output = { width: 720, height: 1280, fps: 30 }
portrait.cover = { type: 'image', file: '../assets/cover.svg', fit: 'contain' }
writeJson(join(root, 'projects', 'portrait.json'), portrait)
// Separate template/React example plus narration attached to an observed action during live footage.
const milestone = structuredClone(base)
milestone.scenes = [
  { id: 'workflow', kind: 'source' },
  {
    id: 'metric',
    kind: 'scene',
    entry: '../scenes/metric/metric.tsx',
    props: {
      value: 100,
      label: 'WORKFLOW COMPLETED',
      caption: 'An editable React template.',
    },
    durationMs: 3200,
  },
]
milestone.audioClips = [
  {
    id: 'saved',
    file: '../audio/saved.mp3',
    at: { action: 'save', event: 'verified' },
    captions: { file: '../audio/saved.vtt' },
  },
]
milestone.cover = { type: 'frame', atMs: duration + 1800 }
writeJson(join(root, 'projects', 'milestone.json'), milestone)
const examples = [
  ['01-legacy', 'legacy'],
  ['02-editorial-typing', 'editorial'],
  ['03-narrated-scenes', 'narrated'],
  ['04-speed-narration', 'speed'],
  ['05-portrait', 'portrait'],
  ['06-action-narration', 'milestone'],
]
for (const [name, project] of examples) {
  const projectPath = join(root, 'projects', project + '.json'),
    prepared = await prepareProject(projectPath, { runtime })
  writeJson(join(root, 'inspection', name + '.json'), describeProject(prepared))
  await renderProject(projectPath, {
    outPath: join(root, 'videos', name + '.mp4'),
    runtime,
    inspectionDir: join(root, 'inspection', name),
  })
}
const edited = join(root, 'projects', 'edited.json')
copyFileSync(join(root, 'projects', 'narrated.json'), edited)
await patchProject(
  edited,
  [
    {
      op: 'update',
      collection: 'audioClips',
      id: 'saved',
      changes: { gainDb: -4 },
    },
    {
      op: 'set',
      path: 'cover',
      value: {
        type: 'scene',
        entry: '../scenes/original.tsx',
        atMs: 1500,
        durationMs: 3000,
      },
    },
  ],
  { runtime, expectedHash: hashFile(edited) },
)
await renderProject(edited, {
  outPath: join(root, 'videos', '07-edited-audio-cover.mp4'),
  runtime,
})
await renderProject(edited, {
  outPath: join(root, 'videos', '08-preview-hold.mp4'),
  runtime,
  preview: { sceneId: 'saved-result' },
  inspectionDir: join(root, 'inspection', 'preview'),
})
for (const [name, cues] of [
  [
    'legacy',
    [
      { sound: 'tick', atMs: 300 },
      { sound: 'whoosh', atMs: 900 },
      { sound: 'whooshOut', atMs: 1500 },
    ],
  ],
  [
    'subtle',
    [
      { sound: 'softClick', atMs: 300, gain: 0.55 },
      { sound: 'keyTap', atMs: 600, gain: 0.32 },
      { sound: 'keyTap', atMs: 750, gain: 0.32 },
      { sound: 'softWhoosh', atMs: 1200, gain: 0.22 },
    ],
  ],
])
  writeWav(join(root, 'audio', name + '-effects.wav'), mixTrack(cues, 2400))
writeJson(join(root, 'inspection', 'capture-hashes.json'), {
  video: hashFile(join(captureDir, 'raw.mp4')),
  cursor: hashFile(join(captureDir, 'cursor.jsonl')),
  manifest: hashFile(manifest),
})
writeJson(join(root, 'inspection', 'run.json'), {
  root,
  createdAt: new Date().toISOString(),
  captures: 'headless Chromium only',
  speech:
    'Offline macOS say used only to make fixture files; Cine imports MP3 without a provider',
  videos: examples.map(([name, project]) => ({ name, project })),
  runtime,
})
console.log(root)
