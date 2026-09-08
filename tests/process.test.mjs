import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  startProcess,
  runProcess,
  waitForProcess,
} from '../src/runtime/process.mjs'
import { startCapture } from '../src/platform/macos/capture.mjs'

test('spawn failure and early exit are remembered; stop is safe repeatedly', async () => {
  const bad = startProcess('/no/such/cine-binary', [])
  assert.ok((await bad.closed).error)
  assert.equal(await bad.stop(), await bad.stop())
  const early = startProcess(process.execPath, ['-e', 'process.exit(0)'])
  await early.closed
  assert.equal((await early.stop()).code, 0)
})
test('managed stop kills a process that ignores graceful termination', async () => {
  const child = startProcess(process.execPath, [
    '-e',
    `process.on('SIGTERM',()=>{});console.error('ready');setInterval(()=>{},1000)`,
  ])
  await waitForProcess(child, (s) => s.includes('ready'))
  const result = await child.stop({ timeoutMs: 50 })
  assert.equal(result.signal, 'SIGKILL')
  assert.equal(await child.stop(), result)
})
test('encoder/process nonzero exits are errors with useful diagnostics', async () => {
  await assert.rejects(
    runProcess(process.execPath, [
      '-e',
      `console.error('fixture encoder error');process.exit(3)`,
    ]),
    /fixture encoder error/,
  )
})
test('native startup failure closes its already-started logger', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cine failure ')),
    children = []
  try {
    await assert.rejects(
      startCapture({
        videoPath: join(dir, 'raw.mp4'),
        cursorPath: join(dir, 'cursor.jsonl'),
        runtime: { ffmpeg: 'fake' },
        loggerPath: process.execPath,
        screenIndex: 0,
        geometry: { x: 0, y: 0, w: 100, h: 100 },
        start: () => {
          const p = startProcess(process.execPath, [
            '-e',
            children.length
              ? `console.error('capture refused');process.exit(2)`
              : 'setInterval(()=>{},1000)',
          ])
          children.push(p)
          return p
        },
      }),
      /capture refused/,
    )
    assert.equal(children.length, 2)
    assert.ok(children.every((p) => p.result))
  } finally {
    for (const child of children) await child.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
test('native readiness timeout cleans up both children', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cine timeout ')),
    children = []
  try {
    await assert.rejects(
      startCapture({
        videoPath: join(dir, 'raw.mp4'),
        cursorPath: join(dir, 'cursor.jsonl'),
        runtime: { ffmpeg: 'fake' },
        loggerPath: process.execPath,
        screenIndex: 0,
        geometry: { x: 0, y: 0, w: 100, h: 100 },
        readinessMs: 60,
        start: () => {
          const p = startProcess(process.execPath, [
            '-e',
            `process.stdin.on('data',()=>process.exit());setInterval(()=>{},1000)`,
          ])
          children.push(p)
          return p
        },
      }),
      /timed out/,
    )
    assert.ok(children.every((p) => p.result))
  } finally {
    for (const child of children) await child.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
test('native stop reports an exit that occurred after readiness without hanging', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cine early exit ')),
    children = []
  try {
    const capture = await startCapture({
      videoPath: join(dir, 'raw.mp4'),
      cursorPath: join(dir, 'cursor.jsonl'),
      runtime: { ffmpeg: 'fake' },
      loggerPath: process.execPath,
      screenIndex: 0,
      geometry: { x: 0, y: 0, w: 100, h: 100 },
      start: () => {
        const p = startProcess(process.execPath, [
          '-e',
          children.length
            ? `console.error('frame= 1');setTimeout(()=>process.exit(),60)`
            : `setInterval(()=>{},1000)`,
        ])
        children.push(p)
        return p
      },
    })
    await children[1].closed
    await assert.rejects(capture.stop(), /unexpectedly/)
    await assert.rejects(capture.stop(), /unexpectedly/)
    assert.ok(children.every((p) => p.result))
  } finally {
    for (const p of children) await p.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
