import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

test('author CLI creates v2/v1 files, refuses overwrite, honors force and reports missing captures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cine-cli-'))
  try {
    const capture = join(dir, 'meta.json'),
      project = join(dir, 'project.json')
    writeFileSync(
      join(dir, 'cursor.jsonl'),
      '{"t":0,"x":20,"y":20,"l":0}\n{"t":1000,"x":30,"y":30,"l":0}\n',
    )
    writeFileSync(
      capture,
      JSON.stringify({
        schemaVersion: 1,
        durationMs: 1000,
        displayPoints: { w: 640, h: 360 },
        video: 'raw.mp4',
        cursor: 'cursor.jsonl',
        fps: 30,
      }),
    )
    const run = (...args) =>
      spawnSync(
        process.execPath,
        [
          resolve('bin/cine.mjs'),
          'author',
          '--capture',
          capture,
          '--project',
          project,
          '--json',
          ...args,
        ],
        { encoding: 'utf8' },
      )
    const first = run()
    assert.equal(first.status, 0, first.stderr)
    assert.equal(JSON.parse(first.stdout).project, project)
    const authored = JSON.parse(readFileSync(project))
    assert.equal(authored.schemaVersion, 2)
    assert.equal(authored.camera.policy, 'kino')
    assert.equal(authored.sound.preset, 'recorded')
    assert.equal(authored.sound.transitions, false)
    const before = readFileSync(project, 'utf8'),
      denied = run()
    assert.notEqual(denied.status, 0)
    assert.match(denied.stdout, /Project exists/)
    assert.equal(readFileSync(project, 'utf8'), before)
    const forced = run('--force', '--legacy')
    assert.equal(forced.status, 0, forced.stderr)
    assert.equal(JSON.parse(readFileSync(project)).schemaVersion, 1)
    rmSync(project)
    rmSync(capture)
    const missing = run()
    assert.notEqual(missing.status, 0)
    assert.equal(existsSync(project), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
