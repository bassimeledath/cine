import test from 'node:test'
import assert from 'node:assert/strict'
import { runActions } from '../src/actions/runner.mjs'
import { sleep } from '../src/runtime/process.mjs'

test('runner resolves targets after previous actions and accepts an async producer', async () => {
  const resolved = [],
    log = [],
    actions = []
  let generation = 0
  const driver = {
    resolve: async () => {
      resolved.push(generation)
      return { x: 10 + generation * 30, y: 20 }
    },
    move: async () => {},
    down: async () => {
      generation++
    },
    up: async () => {},
    waitFor: async () => {},
  }
  async function* producer() {
    yield { selector: '#next', moveMs: 0, settleMs: 0, dwellMs: 0 }
    yield { selector: '#next', moveMs: 0, settleMs: 0, dwellMs: 0 }
  }
  await runActions(producer(), driver, {
    leadInMs: 0,
    tailMs: 0,
    emit: (f) => log.push(f),
    onAction: (a) => actions.push(a),
  })
  assert.deepEqual(resolved, [0, 0, 1, 1])
  assert.equal(actions[1].point.x, 40)
  assert.equal(log.filter((f) => f.l === 1).length, 2)
})
test('delayed actions record dispatch timing, not an ideal planned click time', async () => {
  const log = []
  let sent
  const driver = {
    resolve: async () => ({ x: 1, y: 1 }),
    move: async () => {
      await sleep(70)
    },
    down: async () => {
      sent = Date.now()
    },
    up: async () => {},
  }
  const start = Date.now()
  await runActions(
    [{ selector: '#go', moveMs: 0, settleMs: 0, dwellMs: 0 }],
    driver,
    { leadInMs: 0, tailMs: 0, emit: (f) => log.push(f) },
  )
  const click = log.find((f) => f.l === 1)
  assert.ok(click.t - start >= 65)
  assert.ok(Math.abs(click.t - sent) < 10)
})
test('runner errors explicitly on unsupported actions and invalid pacing', async () => {
  await assert.rejects(
    runActions([{ type: 'teleport' }], {}, { leadInMs: 0, tailMs: 0 }),
    /Unsupported/,
  )
  await assert.rejects(
    runActions([{ moveMs: -1 }], {}, { leadInMs: 0, tailMs: 0 }),
    /Invalid/,
  )
})
test('runner attempts button release even when a press transport fails', async () => {
  let released = false
  const driver = {
    resolve: async () => ({ x: 1, y: 1 }),
    move: async () => {},
    down: async () => {
      throw new Error('disconnected')
    },
    up: async () => {
      released = true
    },
  }
  await assert.rejects(
    runActions([{ selector: '#go', moveMs: 0, settleMs: 0 }], driver, {
      leadInMs: 0,
      tailMs: 0,
    }),
    /disconnected/,
  )
  assert.equal(released, true)
})

test('shortcut dispatch releases held modifiers after an invalid key', async () => {
  const { pressKeyChord } = await import('../src/actions/chromium.mjs')
  const events = []
  await assert.rejects(
    pressKeyChord(
      {
        down: async (key) => events.push(`down:${key}`),
        press: async () => {
          throw new Error('invalid key')
        },
        up: async (key) => events.push(`up:${key}`),
      },
      'Control+Shift+NoSuchKey',
    ),
    /invalid key/,
  )
  assert.deepEqual(events, [
    'down:Control',
    'down:Shift',
    'up:Shift',
    'up:Control',
  ])
})

test('selection releases the mouse when dragging fails and does not claim verification', async () => {
  let released = false, moves = 0, verified = false
  const driver = {
    resolveSelection: async () => ({start:{x:1,y:1},end:{x:20,y:20}}),
    move: async () => { if (++moves > 1) throw new Error('drag interrupted') },
    down: async () => {},
    up: async () => {released = true},
    verifySelection: async () => {verified = true},
  }
  await assert.rejects(runActions([{type:'selectText',selector:'p',text:'sample',moveMs:0,settleMs:0,dragMs:0}],driver,{leadInMs:0,tailMs:0}), /drag interrupted/)
  assert.equal(released,true)
  assert.equal(verified,false)
})

test('generic drag releases after transport failure and validates endpoints before pressing', async () => {
  let released = false, moves = 0, pressed = false
  const driver = {
    move: async () => {if (++moves > 1) throw new Error('transport lost')},
    down: async () => {pressed = true}, up: async () => {released = true},
  }
  await assert.rejects(runActions([{type:'drag',from:{point:{x:1,y:2}},to:{point:{x:9,y:8}},moveMs:0,settleMs:0,dragMs:0}],driver,{leadInMs:0,tailMs:0}),/transport lost/)
  assert.ok(released)
  pressed=false
  await assert.rejects(runActions([{type:'drag',from:{point:{x:1,y:2}},to:{point:{x:NaN,y:8}}}],driver,{leadInMs:0,tailMs:0}),/endpoints/)
  assert.equal(pressed,false)
  await assert.rejects(runActions([{type:'audioInput',file:'speech.wav'}],driver,{leadInMs:0,tailMs:0}),/enabled virtual microphone/)
})
