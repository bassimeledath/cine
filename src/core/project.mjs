import { validateDocument } from './schema.mjs'
import { planCamera } from './camera.mjs'
import { validateSound, subtleCues } from './sound.mjs'
import { mapCaptions } from './captions.mjs'
import { compileSequence } from './sequence.mjs'
import { validateSettings } from './style.mjs'
import { compileSegments, mapLayers, mapCues } from './timeline.mjs'
import { compileFrameStates } from './frame-state.mjs'

export function compileProject(project, capture, { media = {} } = {}) {
  validateDocument(project, { requireCapture: false })
  if (![1, 2].includes(project.schemaVersion))
    throw new Error('Unsupported project schemaVersion')
  const { width = 1920, height = 1080, fps = 30 } = project.output ?? {}
  if (
    ![width, height].every(
      (n) => Number.isInteger(n) && n >= 16 && n <= 7680 && n % 2 === 0,
    )
  )
    throw new Error('Output width/height must be even integers in [16,7680]')
  if (!Number.isFinite(fps) || fps < 1 || fps > 120)
    throw new Error('Output fps must be in [1,120]')
  const settings = validateSettings(project.settings)
  const sound = validateSound(project.sound)
  const sequence =
    project.schemaVersion === 2
      ? compileSequence(project, capture, media)
      : null
  const inputLayers = sequence?.layers ?? project.layers ?? []
  const segments =
    sequence?.segments ??
    compileSegments(
      project.screen?.segments,
      capture.durationMs,
      project.screen?.startMs ?? 0,
    )
  const zoomRanges = project.zoomRanges ?? []
  for (const r of zoomRanges) {
    if (
      !['start', 'end', 'fx', 'fy', 'zoom'].every((k) =>
        Number.isFinite(r[k]),
      ) ||
      r.end <= r.start ||
      r.zoom < 1 ||
      r.zoom > 8
    )
      throw new Error('Invalid zoom range')
  }
  if (project.captions) {
    const c = project.captions
    for (const key of ['enabled', 'wordHighlight'])
      if (c[key] !== undefined && typeof c[key] !== 'boolean')
        throw new Error(`captions.${key} must be boolean`)
    if (
      c.fontSize !== undefined &&
      (!Number.isFinite(c.fontSize) || c.fontSize < 8 || c.fontSize > 150)
    )
      throw new Error('Caption fontSize must be 8–150 scene pixels')
    if (
      c.bottomPercent !== undefined &&
      (!Number.isFinite(c.bottomPercent) ||
        c.bottomPercent < 0 ||
        c.bottomPercent > 90)
    )
      throw new Error('Caption bottomPercent must be 0–90')
    for (const key of ['color', 'highlightColor'])
      if (c[key] !== undefined && !/^#[0-9a-f]{6}$/i.test(c[key]))
        throw new Error(`captions.${key} must be a six-digit hex color`)
  }
  const layerTypes = [
    ...(sequence ? ['custom'] : []),
    'title',
    'outro',
    'lower',
    'badge',
    'toast',
    'callout',
  ]
  const bases = [undefined, 'source', 'output', 'screenEnd']
  for (const l of inputLayers) {
    if (
      !layerTypes.includes(l.type) ||
      !bases.includes(l.timebase) ||
      !Number.isFinite(l.startMs) ||
      !Number.isFinite(l.endMs) ||
      l.endMs <= l.startMs
    )
      throw new Error('Invalid overlay layer')
    for (const key of ['enterMs', 'exitMs'])
      if (l[key] !== undefined && (!Number.isFinite(l[key]) || l[key] < 0))
        throw new Error(`Invalid layer ${key}`)
    if (l.type === 'custom' && (typeof l.entry !== 'string' || !l.entry))
      throw new Error('Custom layer requires entry')
    if (
      l.anchor &&
      !['x', 'y', 'w', 'h'].every((k) => Number.isFinite(l.anchor[k]))
    )
      throw new Error('Invalid anchor rectangle')
    if (l.endOffsetMs !== undefined && !Number.isFinite(l.endOffsetMs))
      throw new Error('Invalid endOffsetMs')
  }
  for (const cue of project.audioCues ?? []) {
    if (
      !bases.includes(cue.timebase) ||
      !Number.isFinite(cue.atMs) ||
      ![
        'tick',
        'pop',
        'whoosh',
        'whooshOut',
        'chime',
        'pad',
        'softClick',
        'keyTap',
        'keyDelete',
        'softWhoosh',
        'recordedMouse',
        ...Array.from({ length: 8 }, (_, i) => `recordedKey${i + 1}`),
      ].includes(cue.sound) ||
      (cue.gain !== undefined &&
        (!Number.isFinite(cue.gain) || cue.gain < 0 || cue.gain > 4))
    )
      throw new Error('Invalid audio cue')
  }
  const layers = mapLayers(inputLayers, segments).filter(
    (l) => l.endMs > l.startMs && l.endMs > 0,
  )
  let audioCues = mapCues(project.audioCues ?? [], segments)
  const durationMs =
    sequence?.durationMs ??
    Math.max(segments.at(-1).endMs, ...layers.map((l) => l.endMs))
  if (sequence && layers.some((l) => l.endMs > durationMs))
    throw new Error('Overlay extends past the scene sequence')
  const camera = planCamera(project, capture, sequence)
  const { states, clicks } = compileFrameStates({
    frames: capture.frames,
    zoomRanges,
    segments,
    displayPoints: capture.displayPoints,
    fps,
    durationMs,
    settings,
    camera,
    capture,
  })
  if (sequence && !project.audioCues?.length)
    audioCues = subtleCues({
      clicks,
      events: capture.events,
      segments,
      states,
      sound,
    })
  return {
    camera,
    schemaVersion: project.schemaVersion,
    scenes: sequence?.scenes ?? [],
    audioClips: sequence?.audioClips ?? [],
    captions: mapCaptions(sequence?.audioClips ?? [], media),
    captionStyle: project.captions ?? {},
    cover: project.cover,
    sound,
    width,
    height,
    fps,
    durationMs,
    settings,
    segments,
    layers,
    audioCues,
    states,
    clicks,
    displayPoints: capture.displayPoints,
    anchors: capture.anchors ?? {},
    anchorTrack: capture.anchorTrack ?? [],
  }
}
