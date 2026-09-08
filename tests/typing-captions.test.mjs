import test from 'node:test'
import assert from 'node:assert/strict'
import { typeText } from '../src/actions/typing.mjs'
import { runActions } from '../src/actions/runner.mjs'
import {
  parseCaptions,
  mapCaptions,
  serializeCaptions,
} from '../src/core/captions.mjs'

test('animated typing dispatches graphemes separately and reports category without text', async () => {
  const sent = [],
    events = []
  await typeText(
    'A👩‍💻é!',
    {
      insert: async (s) => sent.push(['insert', s]),
      press: async (s) => sent.push(['key', s]),
    },
    { cps: 200, variation: 0, punctuationMs: 0, onKey: (e) => events.push(e) },
  )
  assert.deepEqual(sent, [
    ['key', 'A'],
    ['insert', '👩‍💻'],
    ['insert', 'é'],
    ['key', '!'],
  ])
  assert.equal(events.length, 4)
  assert.ok(events.every((e) => !('text' in e)))
  assert.equal(events[1].inputMethod, 'insert')
  assert.ok(events[3].t >= events[0].t)
})
test('instant insertion and replacement are explicit', async () => {
  const sent = []
  await typeText(
    'Hello',
    {
      clear: async () => sent.push('clear'),
      insert: async (s) => sent.push(s),
    },
    { mode: 'instant', replace: true },
  )
  assert.deepEqual(sent, ['clear', 'Hello'])
  await assert.rejects(typeText('x', {}, { cps: 0 }), /pacing/)
})
test('action IDs/milestones distinguish dispatched and checked outcomes and key events persist', async () => {
  const actions = [],
    events = [],
    driver = { key: async () => {}, waitFor: async () => {} }
  await runActions(
    [
      { id: 'erase', type: 'key', key: 'Backspace', dwellMs: 0 },
      { id: 'check', type: 'verify', selector: '#result', dwellMs: 0 },
    ],
    driver,
    {
      leadInMs: 0,
      tailMs: 0,
      onAction: (a) => actions.push(a),
      onEvent: (e) => events.push(e),
    },
  )
  assert.ok(actions[0].milestones.dispatched)
  assert.equal(actions[0].milestones.verified, undefined)
  assert.ok(actions[1].milestones.verified)
  assert.equal(events[0].actionId, 'erase')
  assert.equal(events[0].category, 'delete')
})
test('caption import/export and audio trim mapping retain phrase and word timing', () => {
  const vtt = 'WEBVTT\n\n00:00.100 --> 00:01.200\nHello world\n'
  const cues = parseCaptions(vtt, 'vtt')
  assert.equal(cues[0].endMs, 1200)
  assert.deepEqual(parseCaptions(serializeCaptions(cues, 'srt'), 'srt'), cues)
  const mapped = mapCaptions(
    [{ id: 'a', startMs: 3000, trimInMs: 500, trimOutMs: 1000 }],
    {
      a: {
        captions: [
          {
            ...cues[0],
            words: [
              { text: 'Hello', startMs: 100, endMs: 700 },
              { text: 'world', startMs: 700, endMs: 1200 },
            ],
          },
        ],
      },
    },
  )
  assert.equal(mapped[0].startMs, 3000)
  assert.equal(mapped[0].endMs, 3500)
  assert.equal(mapped[0].words[1].startMs, 3200)
  assert.throws(
    () => parseCaptions('[{"startMs":10,"endMs":5,"text":"bad"}]', 'json'),
    /positive/,
  )
})
