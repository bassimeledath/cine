import { kinoFrames } from './kino-policy.mjs'
import { SpringCamera, clampCameraToZoom } from '../vendor/kino-camera.mjs'
import { shotAt } from './camera.mjs'
import {
  makeSpring,
  stepSpring,
  makeScalar,
  stepScalar,
  SPRING_PRESETS,
} from '../springs.mjs'
import { findClicks, sampleTrack } from './events.mjs'
import { sourceAt, outputAt } from './timeline.mjs'

export function clampFocus(value, size, zoom) {
  const half = size / (2 * zoom)
  return size / zoom >= size
    ? size / 2
    : Math.min(Math.max(value, half), size - half)
}

/** Compile once at output cadence. Reading any resulting frame is history-free.
 * Springs use output time; source pixels/events follow the clip speed map. */
export function compileFrameStates({
  frames,
  zoomRanges,
  segments,
  displayPoints,
  fps,
  durationMs,
  settings,
  camera,
  capture,
}) {
  const first = sampleTrack(
    frames,
    segments.find((s) => s.fromMs !== undefined)?.fromMs ?? 0,
  )
  const zoom = makeScalar(1),
    focus = makeSpring(first.x, first.y),
    cursor = makeSpring(first.x, first.y)
  const squish = makeScalar(1)
  const clicks = findClicks(frames).flatMap((c) => {
    const t = outputAt(segments, c.t)
    return t === null ? [] : [{ ...c, sourceMs: c.t, t }]
  })
  const states = []
  const normalizedFrames = kinoFrames(frames, displayPoints)
  let kinoCamera = new SpringCamera()
  let usedKino = false
  let previousActive = false,
    previousT = -Infinity,
    previousSegment
  for (let i = 0; i < Math.ceil((durationMs * fps) / 1000); i++) {
    const t = (i * 1000) / fps,
      sourceMs = sourceAt(segments, t)
    const active = sourceMs !== null
    const segment = segments.find((s) => t >= s.startMs && t < s.endMs)
    const hold = segment?.kind === 'hold'
    const activeCamera = camera?.sceneCameras?.[segment?.sceneId] ?? camera
    const useKino = activeCamera?.policy === 'kino' && !activeCamera.shots
    if (
      active &&
      hold &&
      (!previousActive ||
        Math.abs((states.at(-1)?.sourceMs ?? sourceMs) - sourceMs) >
          (1000 / fps) * (previousSegment?.rate ?? 1) + 1)
    ) {
      const raw = sampleTrack(frames, sourceMs),
        range =
          activeCamera &&
          (activeCamera.policy !== 'legacy' || activeCamera.shots)
            ? shotAt(
                activeCamera,
                t,
                sourceMs,
                capture,
                { zoom, focus },
                normalizedFrames,
              )
            : zoomRanges.find((r) => sourceMs >= r.start && sourceMs < r.end)
      cursor.x = raw.x
      cursor.y = raw.y
      cursor.vx = 0
      cursor.vy = 0
      zoom.x = range?.zoom ?? 1
      zoom.vx = 0
      focus.x = range?.fx ?? displayPoints.w / 2
      focus.y = range?.fy ?? displayPoints.h / 2
      focus.vx = 0
      focus.vy = 0
      squish.x = 1
      squish.vx = 0
      usedKino = false
    }
    if (active && !hold) {
      const dt = previousActive ? t - previousT : 0
      const range =
        activeCamera && (activeCamera.policy !== 'legacy' || activeCamera.shots)
          ? shotAt(
              activeCamera,
              t,
              sourceMs,
              capture,
              { zoom, focus },
              normalizedFrames,
            )
          : zoomRanges.find((r) => sourceMs >= r.start && sourceMs < r.end)
      const springs =
        camera?.sceneMotion[segment?.sceneId] ??
        activeCamera?.motion ??
        SPRING_PRESETS
      if (useKino) {
        if (!usedKino) {
          kinoCamera = new SpringCamera()
          if (i > 0) {
            kinoCamera.x = focus.x / displayPoints.w - 0.5
            kinoCamera.y = focus.y / displayPoints.h - 0.5
            kinoCamera.zoom = zoom.x
          }
        }
        kinoCamera.update(
          range.fx / displayPoints.w - 0.5,
          range.fy / displayPoints.h - 0.5,
          range.zoom,
          (i === 0 ? 1000 / fps : dt) / 1000,
          springs.screen,
          springs.zoom,
        )
        clampCameraToZoom(kinoCamera)
        focus.x = (kinoCamera.x + 0.5) * displayPoints.w
        focus.y = (kinoCamera.y + 0.5) * displayPoints.h
        zoom.x = kinoCamera.zoom
      }
      usedKino = useKino
      if (!useKino && !range?.holdCamera)
        stepScalar(zoom, range?.zoom ?? 1, springs.zoom, dt)
      const target = range
        ? {
            x: clampFocus(range.fx, displayPoints.w, range.zoom),
            y: clampFocus(range.fy, displayPoints.h, range.zoom),
          }
        : { x: displayPoints.w / 2, y: displayPoints.h / 2 }
      if (!useKino && !range?.holdCamera)
        stepSpring(focus, target.x, target.y, springs.screen, dt)
      const raw = sampleTrack(frames, sourceMs)
      if (settings.cursorSmoothing)
        stepSpring(cursor, raw.x, raw.y, springs.mouse, dt)
      else {
        cursor.x = raw.x
        cursor.y = raw.y
      }
      if (clicks.some((c) => c.t > previousT && c.t <= t)) squish.vx -= 6
      stepScalar(squish, 1, { stiffness: 1200, damping: 34, mass: 1 }, dt)
    }
    states.push({
      t,
      sourceMs,
      active,
      ...(segment?.kind ? { sceneId: segment.sceneId, hold } : {}),
      zoom: zoom.x,
      focus: { x: focus.x, y: focus.y },
      cursor: { x: cursor.x, y: cursor.y },
      squish: squish.x,
    })
    previousT = t
    previousActive = active
    previousSegment = segment
  }
  return { states, clicks }
}
