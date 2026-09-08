export function createOverlays({
  overlayRoot,
  leaders,
  scene,
  layout,
  screenToOutput,
  settings,
  displayPoints,
  layers,
}) {
  const cfg = { displayPoints }
  let camZoom = { x: 1 },
    latestAnchors = {}
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
  const easeOut = (t) => 1 - Math.pow(1 - t, 3)
  const easeBack = (t) => {
    const c = 1.70158 + 1
    return 1 + c * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2)
  }

  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c],
    )

  function buildNode(l) {
    const el = document.createElement('div')
    el.style.zIndex = String(l._order ?? 0)
    el.className = `ov ov-${l.type}${l.tone ? ' ' + l.tone : ''}`
    if (l.type === 'title' || l.type === 'outro') {
      el.className = 'ov ov-title'
      el.innerHTML =
        (l.kicker ? `<div class="kicker">${esc(l.kicker)}</div>` : '') +
        `<div class="head">${esc(l.head)}</div>` +
        `<div class="rule"></div>` +
        (l.sub ? `<div class="sub">${esc(l.sub)}</div>` : '')
    } else if (l.type === 'lower') {
      el.innerHTML = `<div class="num">${esc(l.num)}</div><div class="txt">${esc(l.text)}</div>`
    } else if (l.type === 'toast') {
      el.innerHTML =
        `<div class="icon">${esc(l.icon ?? '✓')}</div>` +
        `<div><div class="t">${esc(l.title)}</div>` +
        (l.body ? `<div class="b">${esc(l.body)}</div>` : '') +
        `</div>`
    } else if (l.type === 'callout') {
      el.innerHTML = `${esc(l.text)}${l.sub ? `<span class="sub">${esc(l.sub)}</span>` : ''}`
      // Anchored callouts get a ring on the target plus a leader line to the label.
      const ring = document.createElement('div')
      ring.className = 'ov ov-ring'
      ring.style.zIndex = String(l._order ?? 0)
      overlayRoot.appendChild(ring)
      const line = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'line',
      )
      line.setAttribute('stroke', settings.accentColor)
      line.setAttribute('stroke-width', '2.5')
      line.setAttribute('stroke-linecap', 'round')
      leaders.appendChild(line)
      l._ring = ring
      l._line = line
    } else if (l.type === 'badge') {
      el.innerHTML = `<span class="live"></span>${esc(l.text)}`
    }
    overlayRoot.appendChild(el)
    return el
  }

  /** Place an anchored node so it clears its target's *box* rather than its
   *  centre point, flipping to whichever side has room. */
  function place(el, at, l) {
    const w = el.offsetWidth
    const h = el.offsetHeight
    const gap = l.gap ?? 20
    let side = l.place ?? 'auto'
    if (side === 'auto') side = at.y < scene.height * 0.46 ? 'below' : 'above'
    let x = at.x - w / 2
    let y = side === 'below' ? at.y + at.h / 2 + gap : at.y - at.h / 2 - gap - h
    if (side === 'left') {
      x = at.x - at.w / 2 - gap - w
      y = at.y - h / 2
    }
    if (side === 'right') {
      x = at.x + at.w / 2 + gap
      y = at.y - h / 2
    }
    x += l.dx ?? 0
    y += l.dy ?? 0
    const m = 44
    x = Math.max(m, Math.min(scene.width - m - w, x))
    y = Math.max(m, Math.min(scene.height - m - h, y))
    return { x, y, w, h }
  }

  function updateOverlays(t) {
    for (const l of layers) {
      if (l.type === 'screen') continue
      const el = l._el
      const inMs = l.enterMs ?? 380
      const outMs = l.exitMs ?? 320
      if (t < l.startMs - 1 || t > l.endMs + 1) {
        el.style.opacity = '0'
        if (l._ring) {
          l._ring.style.opacity = '0'
          l._line.setAttribute('stroke-opacity', '0')
        }
        continue
      }
      const a = inMs === 0 ? 1 : clamp01((t - l.startMs) / inMs)
      const b = outMs === 0 ? 1 : clamp01((l.endMs - t) / outMs)
      const op = Math.min(easeOut(a), easeOut(b))
      const motion = l.motion ?? (l.type === 'toast' ? 'pop' : 'rise')

      let tf = ''
      if (motion === 'rise')
        tf = `translateY(${(1 - easeOut(a)) * 26 - (1 - easeOut(b)) * 10}px)`
      else if (motion === 'pop') tf = `scale(${0.9 + 0.1 * easeBack(a)})`
      else if (motion === 'zoom') tf = `scale(${1 + (1 - easeOut(a)) * 0.06})`

      const tracked = l.anchorSelector
        ? latestAnchors[l.anchorSelector]
        : undefined
      const anchor = l.anchorSelector ? tracked : l.anchor
      if (l.anchorSelector && !anchor) {
        el.style.opacity = '0'
        if (l._ring) {
          l._ring.style.opacity = '0'
          l._line.setAttribute('stroke-opacity', '0')
        }
        continue
      }
      if (anchor) {
        // The anchor is a rect in capture space, so it follows the camera: it
        // scales with the zoom and pans with the focus, staying welded to the UI
        // element it was resolved from.
        const L = layout()
        const s = (L.fx / cfg.displayPoints.w) * camZoom.x
        const pad = l.ringPad ?? 10
        const at = screenToOutput(anchor.x, anchor.y)
        at.w = (anchor.w ?? 0) * s + pad * 2
        at.h = (anchor.h ?? 0) * s + pad * 2
        el.style.opacity = String(op)
        el.style.transform = tf
        const box = place(el, at, l)
        el.style.left = `${box.x}px`
        el.style.top = `${box.y}px`
        if (l._ring) {
          const grow = 0.6 + 0.4 * easeBack(a)
          const rw = at.w * grow
          const rh = at.h * grow
          l._ring.style.opacity = String(op)
          l._ring.style.width = `${rw}px`
          l._ring.style.height = `${rh}px`
          l._ring.style.left = `${at.x - rw / 2}px`
          l._ring.style.top = `${at.y - rh / 2}px`
          // Leader runs from the ring's edge to the nearest edge of the label.
          const ex = Math.max(
            at.x - at.w / 2,
            Math.min(at.x + at.w / 2, box.x + box.w / 2),
          )
          const ey = Math.max(
            at.y - at.h / 2,
            Math.min(at.y + at.h / 2, box.y + box.h / 2),
          )
          const lx = Math.max(box.x, Math.min(box.x + box.w, at.x))
          const ly = Math.max(box.y, Math.min(box.y + box.h, at.y))
          l._line.setAttribute('x1', ex)
          l._line.setAttribute('y1', ey)
          l._line.setAttribute('x2', lx)
          l._line.setAttribute('y2', ly)
          l._line.setAttribute('stroke-opacity', String(op * 0.8))
        }
      } else {
        el.style.opacity = String(op)
        el.style.transform = tf
      }
    }
  }

  for (const layer of layers) layer._el = buildNode(layer)
  return {
    update(t, zoom, anchors) {
      camZoom.x = zoom
      latestAnchors = anchors
      updateOverlays(t)
    },
  }
}
