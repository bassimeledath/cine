import { sleep } from '../runtime/process.mjs'

/** Pacing is repeatable; timestamps report real input dispatch, not the schedule. */
export async function typeText(
  text,
  { insert, press, clear },
  {
    mode = 'animated',
    cps = 16,
    variation = 0.15,
    punctuationMs = 100,
    seed = 1,
    replace = false,
    onKey = () => {},
  } = {},
) {
  if (!['animated', 'instant'].includes(mode))
    throw new Error('typing.mode must be animated or instant')
  if (
    !Number.isFinite(cps) ||
    cps <= 0 ||
    cps > 200 ||
    !Number.isFinite(variation) ||
    variation < 0 ||
    variation > 1 ||
    !Number.isFinite(punctuationMs) ||
    punctuationMs < 0 ||
    !Number.isInteger(seed) ||
    typeof replace !== 'boolean'
  )
    throw new Error('Invalid typing pacing')
  if (replace) {
    if (!clear) throw new Error('This driver cannot clear the focused field')
    await clear()
    await onKey({ t: Date.now(), category: 'delete' })
  }
  if (mode === 'instant') {
    const t = Date.now()
    await insert(text)
    await onKey({ t, category: 'insert', instant: true })
    return
  }
  let state = seed >>> 0
  const parts = [
    ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
  ].map((s) => s.segment)
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i],
      t = Date.now()
    // ASCII receives browser key events; complex graphemes use the input-method insertion path.
    const insertion = !/^[\x20-\x7e\n]$/.test(part)
    if (insertion) await insert(part)
    else await press(part)
    await onKey({
      t,
      category:
        part === '\n' ? 'enter' : /\s/.test(part) ? 'space' : 'character',
      ...(insertion ? { inputMethod: 'insert' } : {}),
    })
    if (i < parts.length - 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      await sleep(
        (1000 / cps) * (1 + variation * ((state / 0xffffffff) * 2 - 1)) +
          (/[.,!?;:]$/.test(part) ? punctuationMs : 0),
      )
    }
  }
}
