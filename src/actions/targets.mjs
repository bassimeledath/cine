/** Use Puppeteer's native selectors, including `host >>> .child` for open shadow roots. */
export async function withTarget(page, selector, evaluate, ...args) {
  if (typeof selector !== 'string' || !selector.trim())
    throw new Error('An action needs a selector or point')
  const handle = await page.$(selector)
  if (!handle) return null
  try {
    return await handle.evaluate(evaluate, ...args)
  } finally {
    await handle.dispose()
  }
}

/** Hit testing must enter the same open shadow roots as selector resolution. */
export function targetIsUsable(el, p) {
  let hit = el.ownerDocument.elementFromPoint(p.x, p.y)
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(p.x, p.y)
    if (!inner || inner === hit) break
    hit = inner
  }
  for (let node = hit; node; node = node.parentNode ?? node.host) {
    if (node === el) return !el.disabled
  }
  return false
}
