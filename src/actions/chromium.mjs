import { typeText } from './typing.mjs'
/** DOM resolution is done at execution time, never frozen for the whole script. */
export async function pointOf(
  page,
  selector,
  { textBounds = false, scroll = false } = {},
) {
  return page.evaluate(
    (sel, useText, shouldScroll) => {
      const el = document.querySelector(sel)
      if (!el) return null
      if (shouldScroll)
        el.scrollIntoView({
          block: 'center',
          inline: 'center',
          behavior: 'instant',
        })
      let r = el.getBoundingClientRect()
      if (
        useText &&
        el.childNodes.length === 1 &&
        el.firstChild.nodeType === 3
      ) {
        const range = document.createRange()
        range.selectNodeContents(el)
        const text = range.getBoundingClientRect()
        if (text.width && text.height) r = text
      }
      if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden')
        return null
      return {
        x: r.x + r.width / 2,
        y: r.y + r.height / 2,
        w: r.width,
        h: r.height,
      }
    },
    selector,
    textBounds,
    scroll,
  )
}

export async function pressKeyChord(keyboard, key) {
  // A literal '+' is a key; modifiers use Puppeteer's canonical key names.
  const parts = key === '+' ? ['+'] : key.split('+')
  const modifiers = parts.slice(0, -1)
  const finalKey = parts.at(-1)
  if (
    !finalKey ||
    modifiers.some((m) => !['Control', 'Meta', 'Alt', 'Shift'].includes(m))
  )
    throw new Error(`Invalid key chord: ${key}; use e.g. Control+A or Meta+A`)
  const held = []
  try {
    for (const modifier of modifiers) {
      await keyboard.down(modifier)
      held.push(modifier)
    }
    const selectAll =
      modifiers.length === 1 &&
      ['Control', 'Meta'].includes(modifiers[0]) &&
      finalKey.toLowerCase() === 'a'
    await keyboard.press(
      finalKey,
      selectAll ? { commands: ['selectAll'] } : undefined,
    )
  } finally {
    // Release every modifier even if a key is invalid or dispatch fails.
    const releases = await Promise.allSettled(
      held.reverse().map((m) => keyboard.up(m)),
    )
    const failed = releases.find((r) => r.status === 'rejected')
    if (failed) throw failed.reason
  }
}

export function chromiumDriver(page, client) {
  return {
    async resolve(selector, timeout = 5000) {
      if (typeof selector !== 'string' || !selector)
        throw new Error('An action needs a selector or point')
      await page.waitForSelector(selector, { visible: true, timeout })
      const point = await pointOf(page, selector, { scroll: true })
      if (!point) throw new Error(`Target is not visible: ${selector}`)
      const usable = await page.evaluate(
        (sel, p) => {
          const el = document.querySelector(sel),
            hit = document.elementFromPoint(p.x, p.y)
          return el && !el.disabled && (el === hit || el.contains(hit))
        },
        selector,
        point,
      )
      if (!usable) throw new Error(`Target is covered or disabled: ${selector}`)
      return point
    },
    move: (p) =>
      client.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: p.x,
        y: p.y,
      }),
    down: (p) =>
      client.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: p.x,
        y: p.y,
        button: 'left',
        clickCount: 1,
      }),
    up: (p) =>
      client.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: p.x,
        y: p.y,
        button: 'left',
        clickCount: 1,
      }),
    type: (text, options) =>
      typeText(
        text,
        {
          insert: (text) => client.send('Input.insertText', { text }),
          press: (text) =>
            text === '\n'
              ? page.keyboard.press('Enter')
              : text === '\t'
                ? page.keyboard.press('Tab')
                : page.keyboard.type(text),
          clear: async () => {
            await page.evaluate(() => {
              const el = document.activeElement
              if (el?.select) el.select()
              else if (el?.isContentEditable) {
                const range = document.createRange()
                range.selectNodeContents(el)
                const selection = getSelection()
                selection.removeAllRanges()
                selection.addRange(range)
              } else throw new Error('Focused element is not editable')
            })
            await page.keyboard.press('Backspace')
          },
        },
        options,
      ),
    key: (key) => pressKeyChord(page.keyboard, key),
    scroll: (delta, p) =>
      client.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: p.x,
        y: p.y,
        deltaX: delta.x,
        deltaY: delta.y,
      }),
    async waitFor({ selector, text, state = 'visible', timeoutMs = 5000 }) {
      if (!selector) throw new Error('waitFor/verify requires a selector')
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
        throw new Error('waitFor timeoutMs must be positive')
      if (!['visible', 'hidden'].includes(state))
        throw new Error('waitFor state must be visible or hidden')
      await page.waitForFunction(
        (sel, expected, state) => {
          const el = document.querySelector(sel)
          const visible =
            el &&
            el.getBoundingClientRect().width > 0 &&
            el.getBoundingClientRect().height > 0 &&
            getComputedStyle(el).visibility !== 'hidden'
          return state === 'hidden'
            ? !visible
            : visible &&
                (expected === undefined || el.textContent.includes(expected))
        },
        { timeout: timeoutMs },
        selector,
        text,
        state,
      )
    },
  }
}
