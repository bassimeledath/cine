import { typeText } from './typing.mjs'
import { revealTarget } from './scroll.mjs'
import { withTarget, targetIsUsable } from './targets.mjs'
/** DOM resolution is done at execution time, never frozen for the whole script. */
export async function pointOf(
  page,
  selector,
  { textBounds = false, scroll = false } = {},
) {
  if (scroll) await revealTarget(page, selector)
  return withTarget(page, selector,
    (el, useText) => {
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
    textBounds,
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

export function chromiumDriver(page, client, { microphone } = {}) {
  let buttons = 0
  return {
    audioInput: microphone ? (file) => microphone.play(file) : undefined,
    async resolveSelection(selector, text, timeout = 5000) {
      await revealTarget(page, selector, timeout)
      const selection = await withTarget(page, selector, (el, text) => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        const nodes = []
        let node, content = ''
        while ((node = walker.nextNode())) {
          nodes.push({ node, start: content.length })
          content += node.textContent
        }
        const index = content.indexOf(text)
        if (index < 0) throw new Error('Selection text not found in target')
        const rectAt = (offset) => {
          const item = nodes.find(
            ({ node, start }) => offset >= start && offset < start + node.length,
          )
          const range = document.createRange()
          range.setStart(item.node, offset - item.start)
          range.setEnd(item.node, offset - item.start + 1)
          return range.getBoundingClientRect()
        }
        const first = rectAt(index),
          last = rectAt(index + text.length - 1)
        const start = { x: first.left + 0.1, y: first.top + first.height / 2 }
        const end = { x: last.right - 0.1, y: last.top + last.height / 2 }
        return { start, end }
      }, text)
      for (const point of [selection.start, selection.end])
        if (!await withTarget(page, selector, targetIsUsable, point))
          throw new Error('Selection endpoints must be visible and unobstructed')
      return selection
    },
    async verifySelection(text) {
      const selected = await page.evaluate(() => getSelection().toString())
      if (selected !== text)
        throw new Error(
          `Selection mismatch: expected ${JSON.stringify(text)}, received ${JSON.stringify(selected)}`,
        )
    },
    async resolve(selector, timeout = 5000) {
      if (typeof selector !== 'string' || !selector)
        throw new Error('An action needs a selector or point')
      await revealTarget(page, selector, timeout)
      const point = await pointOf(page, selector)
      if (!point) throw new Error(`Target is not visible: ${selector}`)
      const usable = await withTarget(page, selector, targetIsUsable, point)
      if (!usable) throw new Error(`Target is covered or disabled: ${selector}`)
      return point
    },
    move: (p) =>
      client.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        button: buttons ? 'left' : 'none',
        buttons,
        x: p.x,
        y: p.y,
      }),
    down: (p) => {
      buttons = 1
      return client.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: p.x,
        y: p.y,
        button: 'left',
        clickCount: 1,
        buttons,
      })
    },
    up: (p) => {
      buttons = 0
      return client.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: p.x,
        y: p.y,
        button: 'left',
        clickCount: 1,
        buttons,
      })
    },
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
              let el = document.activeElement
              while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement
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
      const deadline = Date.now() + timeoutMs
      while (true) {
        const matched = await withTarget(page, selector, (el, expected, state) => {
          const rect = el.getBoundingClientRect()
          const visible = rect.width > 0 && rect.height > 0 &&
            getComputedStyle(el).visibility !== 'hidden'
          return state === 'hidden' ? !visible : visible &&
            (expected === undefined || String(el.matches('input, textarea, select') ? el.value : el.textContent).includes(expected))
        }, text, state)
        if (matched || (matched === null && state === 'hidden')) return
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${selector} (${state}${text === undefined ? '' : ': ' + text})`)
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    },
  }
}
