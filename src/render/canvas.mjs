import { clampFocus } from '../core/frame-state.mjs'

export function createCanvasRenderer({
  canvas,
  video,
  settings,
  displayPoints,
  scene,
  scale,
  background,
  cursorImage,
}) {
  const cfg = { settings, displayPoints }
  const ctx = canvas.getContext('2d')
  let camZoom, camFocus, cursorSpr, squish, curT, clicks
  function roundRectPath(c, x, y, w, h, r) {
    c.beginPath()
    c.moveTo(x + r, y)
    c.arcTo(x + w, y, x + w, y + h, r)
    c.arcTo(x + w, y + h, x, y + h, r)
    c.arcTo(x, y + h, x, y, r)
    c.arcTo(x, y, x + w, y, r)
    c.closePath()
  }

  function hexToRgb(hex) {
    const h = hex.replace('#', '')
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ]
  }

  function drawBackground(c) {
    if (cfg.settings.backgroundType === 'image' && background) {
      c.fillStyle = cfg.settings.backgroundGradientFrom
      c.fillRect(0, 0, scene.width, scene.height)
      const fit = cfg.settings.backgroundFit === 'cover' ? Math.max : Math.min
      const ratio = fit(
        scene.width / background.width,
        scene.height / background.height,
      )
      const w = background.width * ratio,
        h = background.height * ratio
      c.drawImage(
        background,
        (scene.width - w) * cfg.settings.backgroundPosition.x,
        (scene.height - h) * cfg.settings.backgroundPosition.y,
        w,
        h,
      )
      return
    }
    if (cfg.settings.backgroundType === 'solid') {
      c.fillStyle = cfg.settings.backgroundGradientFrom
      c.fillRect(0, 0, scene.width, scene.height)
      return
    }
    const a = ((cfg.settings.backgroundGradientAngle ?? 135) * Math.PI) / 180
    const cx = scene.width / 2,
      cy = scene.height / 2
    const len =
      Math.abs(scene.width * Math.cos(a)) + Math.abs(scene.height * Math.sin(a))
    const g = c.createLinearGradient(
      cx - (Math.cos(a) * len) / 2,
      cy - (Math.sin(a) * len) / 2,
      cx + (Math.cos(a) * len) / 2,
      cy + (Math.sin(a) * len) / 2,
    )
    const [r1, g1, b1] = hexToRgb(cfg.settings.backgroundGradientFrom)
    const [r2, g2, b2] = hexToRgb(cfg.settings.backgroundGradientTo)
    g.addColorStop(0, `rgb(${r1},${g1},${b1})`)
    g.addColorStop(1, `rgb(${r2},${g2},${b2})`)
    c.fillStyle = g
    c.fillRect(0, 0, scene.width, scene.height)
  }

  function layout() {
    const s = cfg.settings
    const pad = s.padding * (scene.height / 1080)
    const availW = scene.width - pad * 2
    const availH = scene.height - pad * 2
    const vw = video.videoWidth || cfg.displayPoints.w
    const vh = video.videoHeight || cfg.displayPoints.h
    const scale = Math.min(availW / vw, availH / vh)
    const fw = vw * scale,
      fh = vh * scale
    // The card *is* the video rect, centred — not the whole padded area. Using
    // the padded rect pillarboxes any source whose aspect differs from the
    // output, leaving the card's black fill visible down the sides.
    const ix = (scene.width - fw) / 2
    const iy = (scene.height - fh) / 2
    return {
      ix,
      iy,
      iw: fw,
      ih: fh,
      fx: fw,
      fy: fh,
      cx: ix + fw / 2,
      cy: iy + fh / 2,
    }
  }

  /** Clamp a focus point (in *display points*) so the zoom window stays on-card. */

  function toFitted(L, px, py) {
    return {
      x: (px / cfg.displayPoints.w) * L.fx,
      y: (py / cfg.displayPoints.h) * L.fy,
    }
  }

  /** Where a point in capture space lands in the 1920x1080 output, *after* the
   *  camera transform. This is what lets an overlay stick to a UI element while
   *  the camera zooms and pans past it. */
  function screenToOutput(px, py) {
    const L = layout()
    const p = toFitted(L, px, py)
    const z = camZoom.x
    const f = toFitted(
      L,
      clampFocus(camFocus.x, cfg.displayPoints.w, z),
      clampFocus(camFocus.y, cfg.displayPoints.h, z),
    )
    return { x: L.cx + (p.x - f.x) * z, y: L.cy + (p.y - f.y) * z }
  }

  function drawFrame(hasVideo) {
    const s = cfg.settings
    const L = layout()
    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    ctx.clearRect(0, 0, scene.width, scene.height)
    drawBackground(ctx)
    if (!hasVideo) return

    if (s.shadowEnabled) {
      const rad = ((s.shadowAngle ?? 90) * Math.PI) / 180
      ctx.save()
      ctx.shadowColor = `rgba(0,0,0,${s.shadowIntensity ?? 0.5})`
      ctx.shadowBlur = s.shadowBlur ?? 40
      ctx.shadowOffsetX = Math.cos(rad) * (s.shadowDistance ?? 8)
      ctx.shadowOffsetY = Math.sin(rad) * (s.shadowDistance ?? 8)
      ctx.fillStyle = '#000'
      roundRectPath(ctx, L.ix, L.iy, L.iw, L.ih, s.cornerRadius)
      ctx.fill()
      ctx.restore()
    }

    const z = camZoom.x
    // Focus lives in display points and is converted here. Converting late
    // matters: the card's fitted size and the capture's point size are different
    // for any source whose scale factor isn't 1 (a 2560x1600 retina Electron
    // capture is 1280x800 points), and mixing them silently mis-centres the zoom.
    const f = toFitted(
      L,
      clampFocus(camFocus.x, cfg.displayPoints.w, z),
      clampFocus(camFocus.y, cfg.displayPoints.h, z),
    )

    ctx.save()
    roundRectPath(ctx, L.ix, L.iy, L.iw, L.ih, s.cornerRadius)
    ctx.clip()
    ctx.translate(L.cx, L.cy)
    ctx.scale(z, z)
    ctx.translate(-f.x, -f.y)
    ctx.drawImage(video, 0, 0, L.fx, L.fy)
    drawClickRipples(L)
    drawCursor(L)
    ctx.restore()
  }

  function drawCursor(L) {
    const s = cfg.settings
    const p = toFitted(L, cursorSpr.x, cursorSpr.y)
    const base = 36 * (s.cursorSize ?? 1) * (scene.height / 1080)
    const sq = squish.x
    ctx.save()
    ctx.translate(p.x, p.y)
    // Counter-scale by the camera zoom. The cursor is drawn inside the zoom
    // transform (so it tracks the right pixel), but a pointer that grows with
    // the zoom reads as broken — real ones stay a fixed size on screen.
    const inv = 1 / camZoom.x
    ctx.scale(sq * inv, sq * inv)
    if (s.cursorType === 'image') {
      const w = base * 1.55,
        h = (w * cursorImage.height) / cursorImage.width
      ctx.drawImage(
        cursorImage,
        -w * s.cursorHotspot.x,
        -h * s.cursorHotspot.y,
        w,
        h,
      )
      ctx.restore()
      return
    }
    if (s.cursorType === 'dot' || s.cursorType === 'crosshair') {
      ctx.strokeStyle = s.cursorColor
      ctx.fillStyle = s.cursorColor
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(0, 0, base * 0.23, 0, Math.PI * 2)
      if (s.cursorType === 'dot') ctx.fill()
      else {
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(-base * 0.4, 0)
        ctx.lineTo(base * 0.4, 0)
        ctx.moveTo(0, -base * 0.4)
        ctx.lineTo(0, base * 0.4)
        ctx.stroke()
      }
      ctx.restore()
      return
    }
    const hgt = base * 1.55
    ctx.beginPath()
    ctx.moveTo(0, 0)
    ctx.lineTo(0, hgt * 0.78)
    ctx.lineTo(hgt * 0.2, hgt * 0.6)
    ctx.lineTo(hgt * 0.32, hgt * 0.88)
    ctx.lineTo(hgt * 0.44, hgt * 0.83)
    ctx.lineTo(hgt * 0.32, hgt * 0.55)
    ctx.lineTo(hgt * 0.52, hgt * 0.55)
    ctx.closePath()
    ctx.fillStyle = s.cursorColor
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'
    ctx.lineWidth = base * 0.075
    ctx.lineJoin = 'round'
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }

  function drawClickRipples(L) {
    if (!cfg.settings.clickHighlight) return
    for (const c of clicks) {
      const age = curT - c.t
      if (age < 0 || age > 450) continue
      const p = toFitted(L, c.x, c.y)
      const prog = age / 450
      const inv = 1 / camZoom.x
      const r = (14 + 42 * prog) * (L.fy / cfg.displayPoints.h) * inv
      ctx.save()
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255,255,255,${0.35 * (1 - prog)})`
      ctx.fill()
      ctx.beginPath()
      ctx.arc(p.x, p.y, r * 0.62, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(255,214,102,${0.6 * (1 - prog)})`
      ctx.lineWidth = 3 * (L.fy / cfg.displayPoints.h) * inv
      ctx.stroke()
      ctx.restore()
    }
  }

  return {
    layout,
    screenToOutput,
    draw(state, clickTrack) {
      camZoom = { x: state.zoom }
      camFocus = state.focus
      cursorSpr = state.cursor
      squish = { x: state.squish }
      curT = state.t
      clicks = clickTrack
      drawFrame(state.active)
    },
  }
}
