import { kinoRanges, kinoTarget } from './kino-policy.mjs'
import { requireValue as check, uniqueIds } from './errors.mjs'
import { outputAt } from './timeline.mjs'
import { SPRING_PRESETS } from '../springs.mjs'
export function validateMotion(motion = {}, path = 'camera.motion') {
  for (const [kind, params] of Object.entries(motion)) {
    check(
      ['screen', 'zoom', 'mouse'].includes(kind),
      'INVALID_MOTION',
      path,
      `Unknown spring ${kind}`,
    )
    for (const [key, value] of Object.entries(params))
      check(
        ['stiffness', 'damping', 'mass'].includes(key) &&
          Number.isFinite(value) &&
          value > 0 &&
          value <= 10000,
        'INVALID_MOTION',
        `${path}.${kind}.${key}`,
        'Spring parameters must be positive finite values up to 10000',
      )
  }
  return Object.fromEntries(
    Object.entries(SPRING_PRESETS).map(([key, p]) => [
      key,
      { ...p, ...motion[key] },
    ]),
  )
}
export function planCamera(project, capture, sequence) {
  const camera = project.camera ?? {},
    policy =
      camera.policy ?? (project.schemaVersion === 2 ? 'editorial' : 'legacy')
  check(
    ['kino', 'legacy', 'editorial', 'off'].includes(policy),
    'INVALID_CAMERA',
    'camera.policy',
    'Use kino, legacy, editorial, or off',
  )
  const motion = validateMotion(camera.motion),
    sceneMotion = {}
  const sceneCameras = {}
  for (const scene of sequence?.scenes ?? []) {
    if (!scene.camera) continue
    const localMotion = Object.fromEntries(
      Object.entries(motion).map(([key, values]) => [
        key,
        { ...values, ...scene.camera.motion?.[key] },
      ]),
    )
    sceneMotion[scene.id] = validateMotion(
      localMotion,
      `scenes.${scene.id}.camera.motion`,
    )
    if (scene.camera.policy !== undefined || scene.camera.shots !== undefined) {
      const override = { ...camera, ...scene.camera, motion: localMotion }
      // A scene policy override selects that policy unless it also supplies shots.
      if (scene.camera.policy !== undefined && scene.camera.shots === undefined)
        delete override.shots
      sceneCameras[scene.id] = planCamera(
        { ...project, camera: override },
        capture,
        { ...sequence, scenes: [] },
      )
    }
  }
  let shots = camera.shots
  if (shots !== undefined) {
    check(
      sequence,
      'INVALID_CAMERA',
      'camera.shots',
      'Authored shots require project version 2',
    )
    uniqueIds(shots, 'camera.shots')
    shots = shots
      .map((shot) => {
        const path = `camera.shots.${shot.id}`,
          startMs = sequence.resolveAt(shot.at, `${path}.at`),
          endMs = startMs + shot.durationMs
        check(
          ['overview', 'focus', 'hold', 'pull-back'].includes(shot.mode),
          'INVALID_SHOT',
          path,
          'Unknown shot mode',
        )
        check(
          Number.isFinite(shot.durationMs) &&
            shot.durationMs > 0 &&
            endMs <= sequence.durationMs,
          'INVALID_SHOT',
          path,
          'Shot must fit the timeline',
        )
        const rect = shot.target?.w && shot.target?.h ? shot.target : null
        const fittedZoom = rect
          ? Math.min(
              8,
              Math.max(
                1,
                Math.min(
                  capture.displayPoints.w / (rect.w * 1.35),
                  capture.displayPoints.h / (rect.h * 1.35),
                ),
              ),
            )
          : 1.5
        const zoom = ['overview', 'pull-back'].includes(shot.mode)
          ? 1
          : (shot.zoom ?? fittedZoom)
        check(
          Number.isFinite(zoom) && zoom >= 1 && zoom <= 8,
          'INVALID_SHOT',
          path,
          'Zoom must be in [1,8]',
        )
        const target = (rect
          ? { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }
          : shot.target) ?? {
          x: capture.displayPoints.w / 2,
          y: capture.displayPoints.h / 2,
        }
        if (target.selector) {
          check(
            capture.anchors?.[target.selector] ||
              (capture.anchorTrack ?? []).some(
                (s) => s.anchors[target.selector],
              ),
            'UNKNOWN_ANCHOR',
            path,
            `Selector ${target.selector} was not captured`,
          )
        } else
          check(
            ['x', 'y'].every((k) => Number.isFinite(target[k])),
            'INVALID_SHOT',
            path,
            'Target needs finite x/y or a captured selector',
          )
        return { ...shot, startMs, endMs, zoom, target }
      })
      .sort((a, b) => a.startMs - b.startMs)
    for (let i = 1; i < shots.length; i++)
      check(
        shots[i].startMs >= shots[i - 1].endMs,
        'OVERLAPPING_SHOTS',
        'camera.shots',
        'Shots cannot overlap',
      )
  } else if (policy === 'editorial') {
    // Semantic results are available only when the producer verified them.
    shots = (capture.actions ?? [])
      .filter(
        (a) =>
          ['click', 'type'].includes(a.type ?? 'click') &&
          a.camera?.mode !== 'overview',
      )
      .flatMap((a) => {
        const at = outputAt(
          sequence.segments,
          a.milestones?.dispatched ?? a.startMs,
        )
        if (at === null) return []
        const verified = outputAt(
          sequence.segments,
          a.milestones?.verified ?? a.endMs,
        )
        const endMs = Math.min(sequence.durationMs, (verified ?? at) + 900)
        return [
          {
            id: `auto-${a.id ?? a.startMs}`,
            startMs: Math.max(700, at - 200),
            endMs,
            zoom: a.camera?.zoom ?? 1.5,
            target: a.point ?? {
              x: capture.displayPoints.w / 2,
              y: capture.displayPoints.h / 2,
            },
            mode: 'focus',
          },
        ]
      })
      .filter((s) => s.endMs > s.startMs)
      .sort((a, b) => a.startMs - b.startMs)
    for (let i = 0; i < shots.length - 1; i++)
      shots[i].endMs = Math.min(shots[i].endMs, shots[i + 1].startMs)
    shots = shots.filter((s) => s.endMs > s.startMs)
  }
  return {
    policy,
    motion,
    sceneMotion,
    sceneCameras,
    shots: shots ?? null,
    ...(policy === 'kino'
      ? { kinoRanges: kinoRanges(capture, camera.kino) }
      : {}),
  }
}
export function shotAt(
  camera,
  t,
  sourceMs,
  capture,
  previous,
  normalizedFrames,
) {
  if (camera.policy === 'kino' && !camera.shots)
    return kinoTarget(camera, normalizedFrames, sourceMs, capture.displayPoints)
  const shot = camera.shots?.find((s) => t >= s.startMs && t < s.endMs)
  if (!shot) return null
  if (shot.mode === 'hold')
    return {
      holdCamera: true,
      zoom: previous.zoom.x,
      fx: previous.focus.x,
      fy: previous.focus.y,
    }
  let target = shot.target
  if (target.selector)
    target =
      capture.anchorTrack?.findLast((s) => s.t <= sourceMs)?.anchors?.[
        target.selector
      ] ?? capture.anchors?.[target.selector]
  if (!target) return null
  return { zoom: shot.zoom, fx: target.x, fy: target.y }
}
