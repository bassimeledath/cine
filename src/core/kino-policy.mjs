import {
  generateAutoZoomRanges,
  fillGapsWithSystemRanges,
  computeCameraTarget,
  findActiveZoomRange,
} from '../vendor/kino-camera.mjs'
import { requireValue as check } from './errors.mjs'
export function kinoFrames(frames, display) {
  let down = false
  return frames.map((f) => {
    const type = f.l && !down ? 'click-down' : 'move'
    down = !!f.l
    return { t: f.t, x: f.x / display.w, y: f.y / display.h, type }
  })
}
export function kinoRanges(capture, options = {}) {
  const {
    zoom = 1.5,
    snapToEdgesRatio = 0.25,
    alwaysKeepZoomedIn = false,
    systemZoom = 1.2,
  } = options
  check(
    Number.isFinite(zoom) &&
      zoom >= 1 &&
      zoom <= 8 &&
      Number.isFinite(systemZoom) &&
      systemZoom >= 1 &&
      systemZoom <= 8,
    'INVALID_CAMERA',
    'camera.kino',
    'Zoom must be in [1,8]',
  )
  check(
    Number.isFinite(snapToEdgesRatio) &&
      snapToEdgesRatio >= 0 &&
      snapToEdgesRatio < 0.5 &&
      typeof alwaysKeepZoomedIn === 'boolean',
    'INVALID_CAMERA',
    'camera.kino',
    'Edge ratio must be in [0,0.5); alwaysKeepZoomedIn must be boolean',
  )
  let ranges = generateAutoZoomRanges(
    kinoFrames(capture.frames, capture.displayPoints),
    capture.durationMs,
    zoom,
    snapToEdgesRatio,
  )
  if (alwaysKeepZoomedIn)
    ranges = fillGapsWithSystemRanges(
      ranges,
      capture.durationMs,
      systemZoom,
      snapToEdgesRatio,
    )
  return ranges.map((r, i) => ({ ...r, id: `kino-${i + 1}` }))
}
export function kinoTarget(camera, frames, sourceMs, display) {
  const target = computeCameraTarget(
    findActiveZoomRange(camera.kinoRanges, sourceMs),
    frames,
    sourceMs,
  )
  return {
    zoom: target.zoom,
    fx: (target.x + 0.5) * display.w,
    fy: (target.y + 0.5) * display.h,
  }
}
