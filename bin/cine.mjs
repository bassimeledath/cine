#!/usr/bin/env node
// cine — headless cinematic screen recorder (kino-parity subset)
//
// Commands:
//   cine demo [--out out.mp4] [--url URL] [--native]
//       Autonomous end-to-end: drives the page, captures, authors zooms,
//       renders. Headless by default; --native records the physical screen
//       instead (works for any app, but takes over the machine).
//       Default out: ~/Downloads/cine-demo.mp4
//
//   cine autozoom --cursor cursor.jsonl [--out cuts.json]
//       Derive zoom ranges from a cursor log.
//
//   cine render --video raw.mp4 --cursor cursor.jsonl [--cuts cuts.json]
//       [--video-t0 <ms>] --display-points 1470x956 --duration-ms 18000 --out out.mp4

import { writeFileSync, readFileSync, existsSync, mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildZoomRanges } from '../src/autozoom.mjs'
import { render } from '../src/render.mjs'
import { runDemo, runWebDemo, runElectronDemo, captureElectron } from '../src/demo.mjs'
import { buildShowcase } from '../src/showcase.mjs'

const args = process.argv.slice(2)
function arg(name, fallback) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}

function readFrames(path) {
  if (!path) throw new Error('--cursor is required')
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

async function main() {
  const cmd = args[0]

  if (cmd === 'demo') {
    const opts = {
      outPath: arg('--out', join(homedir(), 'Downloads', 'cine-demo.mp4')),
      fps: Number(arg('--fps', 30)),
    }
    // Headless by default. --native records the physical screen instead, which
    // is the only way to demo anything that isn't a web page — at the cost of
    // taking over the machine for the length of the recording.
    let out
    if (args.includes('--native')) {
      out = await runDemo(opts)
    } else if (args.includes('--electron')) {
      out = await runElectronDemo({ ...opts, connectTo: arg('--cdp') })
    } else {
      out = await runWebDemo({ ...opts, url: arg('--url'), connectTo: arg('--cdp') })
    }
    console.log(`\n${out}`)
    return
  }

  // Overlay + sound showcase. Capture and render are separate stages: with
  // --work pointing at an existing capture, this re-renders the timeline
  // without touching the app again.
  if (cmd === 'showcase') {
    const work = arg('--work') ?? mkdtempSync(join(tmpdir(), 'cine-showcase-'))
    const metaPath = join(work, 'meta.json')
    if (!existsSync(metaPath)) {
      await captureElectron({ workDir: work, fps: Number(arg('--fps', 30)) })
    } else {
      console.log(`reusing capture in ${work}`)
    }
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
    const cursorPath = join(work, 'cursor.jsonl')
    const zoomRanges = buildZoomRanges(readFrames(cursorPath))
    console.log(`authored ${zoomRanges.length} zoom range(s)`)

    const { layers, audioCues } = buildShowcase({
      cursorPath,
      videoT0: meta.videoT0,
      durationMs: meta.durationMs,
      anchors: meta.anchors,
      // autoCues works in video time; the compositor rebases separately.
      zoomRanges: zoomRanges.map((r) => ({ ...r, start: r.start - meta.videoT0, end: r.end - meta.videoT0 })),
    })
    writeFileSync(join(work, 'timeline.json'), JSON.stringify({ layers, audioCues }, null, 2))
    console.log(`timeline: ${layers.length} layers, ${audioCues.length} audio cues`)

    const out = arg('--out', join(homedir(), 'Downloads', 'cine-showcase.mp4'))
    console.log('rendering...')
    await render({
      video: join(work, 'raw.mp4'),
      cursor: cursorPath,
      zoomRanges,
      durationMs: meta.durationMs,
      fps: meta.fps ?? 30,
      displayPoints: meta.displayPoints,
      videoT0: meta.videoT0,
      settings: {},
      layers,
      audioCues,
      outPath: out,
    })
    console.log(`\n${out}`)
    return
  }

  if (cmd === 'autozoom') {
    const frames = readFrames(arg('--cursor'))
    const t0 = frames[0].t
    const ranges = buildZoomRanges(frames)
    const out = ranges.map((r) => ({ ...r, start: r.start - t0, end: r.end - t0 }))
    console.log(JSON.stringify(out, null, 2))
    if (arg('--out')) writeFileSync(arg('--out'), JSON.stringify(out, null, 2))
    return
  }

  if (cmd === 'render') {
    const cursorPath = arg('--cursor')
    // Ranges are stored relative to the cursor log's first sample; the
    // compositor works in absolute stamps, so rebase them back.
    const t0 = readFrames(cursorPath)[0].t
    let zoomRanges = []
    const cutsPath = arg('--cuts')
    if (cutsPath && existsSync(cutsPath)) {
      zoomRanges = JSON.parse(readFileSync(cutsPath, 'utf8'))
        .map((r) => ({ ...r, start: r.start + t0, end: r.end + t0 }))
    }
    const [dw, dh] = arg('--display-points', '1470x956').split('x').map(Number)
    const videoT0 = arg('--video-t0')
    await render({
      video: arg('--video'),
      cursor: cursorPath,
      zoomRanges,
      durationMs: Number(arg('--duration-ms')),
      fps: Number(arg('--fps', 30)),
      displayPoints: { w: dw, h: dh },
      videoT0: videoT0 === undefined ? undefined : Number(videoT0),
      settings: {},
      outPath: arg('--out'),
    })
    return
  }

  console.error(`unknown command: ${cmd ?? '(none)'}\n`)
  console.error('usage: cine demo|autozoom|render [options]')
  process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
