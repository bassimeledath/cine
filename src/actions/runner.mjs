import { randomUUID } from 'node:crypto'
import { sleep } from '../runtime/process.mjs'
import { ease } from '../core/events.mjs'
import { scrollGesture } from './scroll.mjs'

/** The producer can be an array or an async iterable supplied by a live agent. */
export async function runActions(
  actions,
  driver,
  {
    start = { x: 0, y: 0 },
    emit = () => {},
    onAction = () => {},
    onEvent = () => {},
    leadInMs = 1400,
    tailMs = 1600,
  } = {},
) {
  let cursor = { ...start },
    left = 0
  const sample = () => emit({ t: Date.now(), ...cursor, l: left, r: 0 })
  const move = async (target, durationMs) => {
    const from = { ...cursor },
      startMs = Date.now()
    while (true) {
      const progress = durationMs
        ? Math.min(1, (Date.now() - startMs) / durationMs)
        : 1
      const p = ease(progress)
      cursor = {
        x: from.x + (target.x - from.x) * p,
        y: from.y + (target.y - from.y) * p,
      }
      const sentAt = Date.now()
      await driver.move(cursor)
      emit({ t: sentAt, ...cursor, l: left, r: 0 })
      if (progress === 1) break
      await sleep(8)
    }
  }
  sample()
  await sleep(leadInMs)
  const ids = new Set()
  for await (const entry of actions) {
    const action = { type: 'click', ...entry, id: entry.id ?? randomUUID() }
    if (
      typeof action.id !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(action.id) ||
      ids.has(action.id)
    )
      throw new Error('Actions require unique stable IDs')
    ids.add(action.id)
    const milestones = {}
    if (
      ![
        'click',
        'move',
        'type',
        'scroll',
        'waitFor',
        'verify',
        'wait',
        'key',
        'selectText',
        'drag',
        'audioInput',
      ].includes(action.type)
    )
      throw new Error(`Unsupported action: ${action.type}`)
    for (const key of ['moveMs', 'settleMs', 'dwellMs', 'ms', 'dragMs', 'scrollMs']) {
      if (
        action[key] !== undefined &&
        (!Number.isFinite(action[key]) || action[key] < 0)
      )
        throw new Error(`Invalid action ${key}`)
    }
    if (
      action.timeoutMs !== undefined &&
      (!Number.isFinite(action.timeoutMs) || action.timeoutMs <= 0)
    )
      throw new Error('Invalid action timeoutMs')
    if (action.type === 'type' && typeof action.text !== 'string')
      throw new Error('type requires text')
    if (
      action.point &&
      !['x', 'y'].every((k) => Number.isFinite(action.point[k]))
    )
      throw new Error('Invalid action point')
    if (
      action.type === 'scroll' &&
      ![action.x ?? 0, action.y ?? 0].every(Number.isFinite)
    )
      throw new Error('Invalid scroll delta')
    const startMs = Date.now()
    if (['click', 'move', 'type'].includes(action.type)) {
      const target =
        action.point ??
        (await driver.resolve(action.selector, action.timeoutMs))
      await move(target, action.moveMs ?? 650)
      await sleep(action.settleMs ?? 180)
      if (action.type !== 'move') {
        // Resolve again after motion in case layout changed while moving.
        if (action.selector) {
          const current = await driver.resolve(
            action.selector,
            action.timeoutMs,
          )
          if (Math.hypot(current.x - cursor.x, current.y - cursor.y) > 1)
            await move(current, 120)
        }
        const atMs = Date.now()
        milestones.dispatched = atMs
        left = 1
        try {
          await driver.down(cursor)
          emit({ t: atMs, ...cursor, l: 1, r: 0 })
          await sleep(90)
        } finally {
          const upMs = Date.now()
          try {
            await driver.up(cursor)
          } finally {
            left = 0
            emit({ t: upMs, ...cursor, l: 0, r: 0 })
          }
        }
        if (action.type === 'type') {
          await driver.type(action.text, {
            ...(action.typing ?? {}),
            onKey: (event) =>
              onEvent({ ...event, actionId: action.id, type: 'typing' }),
          })
        }
      }
    } else if (action.type === 'drag') {
      const endpoint = async (target) => {
        if (target?.point && ['x', 'y'].every(k => Number.isFinite(target.point[k]))) return target.point
        if (typeof target?.selector === 'string') return driver.resolve(target.selector, action.timeoutMs)
        throw new Error('drag requires from/to endpoints with a selector or finite point')
      }
      // Resolve both before pressing; a malformed destination must not leave a button held.
      const from = await endpoint(action.from), to = await endpoint(action.to)
      await move(from, action.moveMs ?? 650)
      await sleep(action.settleMs ?? 180)
      milestones.dispatched = Date.now()
      left = 1
      try {
        await driver.down(cursor)
        sample()
        await move(to, action.dragMs ?? 1100)
      } finally {
        try { await driver.up(cursor) }
        finally { left = 0; sample() }
      }
    } else if (action.type === 'audioInput') {
      if (typeof action.file !== 'string' || !action.file || !driver.audioInput)
        throw new Error('audioInput requires a local file and an enabled virtual microphone')
      const playback = await driver.audioInput(action.file)
      milestones.dispatched = playback.startMs
      action.durationMs = playback.durationMs
    } else if (action.type === 'selectText') {
      if (
        typeof action.selector !== 'string' || !action.selector ||
        typeof action.text !== 'string' || !action.text ||
        !driver.resolveSelection || !driver.verifySelection
      )
        throw new Error(
          'selectText requires selector, nonempty text, and a supported browser driver',
        )
      const selection = await driver.resolveSelection(
        action.selector, action.text, action.timeoutMs,
      )
      await move(selection.start, action.moveMs ?? 650)
      await sleep(action.settleMs ?? 180)
      milestones.dispatched = Date.now()
      left = 1
      try {
        await driver.down(cursor)
        sample()
        await move(selection.end, action.dragMs ?? 1100)
      } finally {
        try {
          await driver.up(cursor)
        } finally {
          left = 0
          sample()
        }
      }
      await driver.verifySelection(action.text)
      milestones.verified = Date.now()
    } else if (action.type === 'key') {
      if (typeof action.key !== 'string' || !action.key || !driver.key)
        throw new Error('key requires a supported key combination')
      milestones.dispatched = Date.now()
      await driver.key(action.key)
      await onEvent({
        t: milestones.dispatched,
        actionId: action.id,
        type: 'typing',
        category:
          action.key.includes('Backspace') || action.key.includes('Delete')
            ? 'delete'
            : 'key',
      })
    } else if (action.type === 'scroll') {
      if (action.selector || action.point) {
        const target = action.point ?? await driver.resolve(action.selector, action.timeoutMs)
        await move(target, action.moveMs ?? 650)
      }
      milestones.dispatched = Date.now()
      await scrollGesture(
        { x: action.x ?? 0, y: action.y ?? 0 },
        (delta) => driver.scroll(delta, cursor),
        { durationMs: action.scrollMs ?? 900, onStep: sample },
      )
    } else if (action.type === 'wait') {
      await sleep(action.ms ?? 0)
    } else {
      await driver.waitFor(action)
      milestones.verified = Date.now()
    }
    if (action.expect) {
      await driver.waitFor(action.expect)
      milestones.verified = Date.now()
    }
    await onAction({
      ...action,
      milestones,
      startMs,
      endMs: Date.now(),
      point: { ...cursor },
    })
    await sleep(action.dwellMs ?? (action.type === 'click' ? 2200 : 200))
    sample()
  }
  await sleep(tailMs)
  sample()
}
