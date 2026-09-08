import { compileSegments, mapLayers } from './timeline.mjs'
import { requireValue as check } from './errors.mjs'
import { uniqueIds } from './errors.mjs'

/** All references are resolved here. Rendering never interprets authoring references. */
export function compileSequence(project, capture, media = {}) {
  const clips = project.audioClips ?? [],
    input = project.scenes ?? []
  uniqueIds(input, 'scenes')
  uniqueIds(clips, 'audioClips')
  uniqueIds(project.layers ?? [], 'layers')
  check(
    input.length > 0,
    'EMPTY_SEQUENCE',
    'scenes',
    'At least one scene is required',
  )
  const sourceTime = (ref, path) => {
    if (Number.isFinite(ref)) return ref
    check(
      ref && typeof ref.action === 'string',
      'INVALID_REFERENCE',
      path,
      'Use a source timestamp or action milestone',
    )
    const matches = (capture.actions ?? []).filter((a) => a.id === ref.action)
    check(
      matches.length === 1,
      'UNKNOWN_ACTION',
      path,
      `Expected one action ${ref.action}`,
      'Inspect the capture for saved action IDs',
    )
    const action = matches[0],
      event = ref.event ?? 'end'
    const t =
      event === 'start'
        ? action.startMs
        : event === 'end'
          ? action.endMs
          : action.milestones?.[event]
    check(
      Number.isFinite(t),
      'UNKNOWN_MILESTONE',
      path,
      `Action ${ref.action} has no ${event} milestone`,
      'Only checked outcomes have a verified milestone',
    )
    check(
      ref.offsetMs === undefined || Number.isFinite(ref.offsetMs),
      'INVALID_OFFSET',
      path,
      'offsetMs must be finite',
    )
    return t + (ref.offsetMs ?? 0)
  }
  const clipLengths = new Map(
    clips.map((c) => {
      const info = media[c.id]
      check(
        info && Number.isFinite(info.durationMs) && info.durationMs > 0,
        'AUDIO_NOT_PROBED',
        `audioClips.${c.id}`,
        'Audio must be decoded before timing is compiled',
      )
      const from = c.trimInMs ?? 0,
        to = c.trimOutMs ?? info.durationMs
      check(
        Number.isFinite(from) &&
          Number.isFinite(to) &&
          from >= 0 &&
          to > from &&
          to <= info.durationMs + 0.01,
        'INVALID_AUDIO_TRIM',
        `audioClips.${c.id}`,
        'Trim bounds must fit the decoded audio',
      )
      return [c.id, { durationMs: to - from, trimInMs: from, trimOutMs: to }]
    }),
  )
  const scenes = [],
    segments = []
  let end = 0,
    lastSourceEnd = 0
  for (const s of input) {
    const path = `scenes.${s.id}`,
      startMs = end
    check(
      ['source', 'hold', 'scene'].includes(s.kind),
      'INVALID_SCENE',
      path,
      'kind must be source, hold, or scene',
    )
    let durationMs, fromMs, toMs, rate
    if (s.kind === 'source') {
      fromMs = sourceTime(s.fromMs ?? 0, `${path}.fromMs`)
      toMs = sourceTime(s.toMs ?? capture.durationMs, `${path}.toMs`)
      rate = s.rate ?? 1
      check(
        Number.isFinite(rate) &&
          rate > 0 &&
          rate <= 16 &&
          fromMs >= lastSourceEnd &&
          toMs > fromMs &&
          toMs <= capture.durationMs,
        'INVALID_SOURCE_RANGE',
        path,
        'Source scenes must be ordered, within the capture, with rate in (0,16]',
      )
      durationMs = (toMs - fromMs) / rate
      lastSourceEnd = toMs
    } else {
      if (s.duration?.audio !== undefined) {
        check(
          clipLengths.has(s.duration.audio),
          'UNKNOWN_AUDIO',
          path,
          `Unknown duration audio ${s.duration.audio}`,
        )
        durationMs = clipLengths.get(s.duration.audio).durationMs
      } else durationMs = s.durationMs
      check(
        Number.isFinite(durationMs) && durationMs > 0,
        'INVALID_DURATION',
        path,
        'Provide a positive durationMs or duration.audio; scene-duration cycles are unsupported',
      )
      if (s.kind === 'hold') {
        fromMs = sourceTime(s.sourceMs, `${path}.sourceMs`)
        check(
          fromMs >= 0 && fromMs < capture.durationMs,
          'INVALID_HOLD',
          path,
          'Hold frame must be inside the source capture',
        )
        toMs = fromMs
        rate = 0
      } else
        check(
          typeof s.entry === 'string' ||
            [
              'background',
              'title',
              'outro',
              'lower',
              'badge',
              'toast',
              'callout',
            ].includes(s.template),
          'INVALID_SCENE',
          path,
          'Generated scenes need entry or template',
        )
    }
    end += durationMs
    const resolved = { ...s, startMs, endMs: end, durationMs }
    scenes.push(resolved)
    segments.push({
      sceneId: s.id,
      kind: s.kind,
      fromMs,
      toMs,
      rate,
      startMs,
      endMs: end,
    })
  }
  const at = (ref, path) => {
    check(
      ref && typeof ref === 'object',
      'INVALID_REFERENCE',
      path,
      'Expected outputMs, scene, sourceMs, or action placement',
    )
    check(
      ['outputMs', 'scene', 'sourceMs', 'action'].filter(
        (k) => ref[k] !== undefined,
      ).length === 1,
      'INVALID_REFERENCE',
      path,
      'Specify exactly one placement reference',
    )
    const offset = ref.offsetMs ?? 0
    check(
      Number.isFinite(offset),
      'INVALID_OFFSET',
      path,
      'offsetMs must be finite',
    )
    let t
    if (ref.outputMs !== undefined) t = ref.outputMs
    else if (ref.scene !== undefined) {
      const scene = scenes.find((s) => s.id === ref.scene)
      check(scene, 'UNKNOWN_SCENE', path, `Unknown scene ${ref.scene}`)
      check(
        ref.edge === undefined || ['start', 'end'].includes(ref.edge),
        'INVALID_REFERENCE',
        path,
        'Scene edge must be start or end',
      )
      t = ref.edge === 'end' ? scene.endMs : scene.startMs
    } else {
      const sourceMs =
        ref.action !== undefined
          ? sourceTime({ ...ref, offsetMs: 0 }, path)
          : ref.sourceMs
      check(
        Number.isFinite(sourceMs),
        'INVALID_REFERENCE',
        path,
        'Source time must be finite',
      )
      const segment = segments.find(
        (s) => s.kind === 'source' && sourceMs >= s.fromMs && sourceMs < s.toMs,
      )
      check(
        segment,
        'TRIMMED_REFERENCE',
        path,
        `Source reference ${sourceMs} ms is outside retained footage`,
        'Retain this footage or attach to a scene/output time',
      )
      t = segment.startMs + (sourceMs - segment.fromMs) / segment.rate
    }
    check(
      Number.isFinite(t) && t + offset >= 0,
      'INVALID_REFERENCE',
      path,
      'Resolved output time must be nonnegative',
    )
    return t + offset
  }
  const overlays = (project.layers ?? []).map((l) => {
    if (!l.at) return l
    const startMs = at(l.at, `layers.${l.id}.at`)
    check(
      Number.isFinite(l.durationMs) && l.durationMs > 0,
      'INVALID_DURATION',
      `layers.${l.id}`,
      'Placed layers need positive durationMs',
    )
    return { ...l, startMs, endMs: startMs + l.durationMs, timebase: 'output' }
  })
  const layers = scenes
    .filter((s) => s.kind === 'scene' && s.template !== 'background')
    .map((s) => ({
      ...s.props,
      id: s.id,
      type: s.entry ? 'custom' : s.template,
      entry: s.entry,
      adapter: s.adapter,
      seed: s.seed,
      props: s.props ?? {},
      assets: s.assets ?? {},
      startMs: s.startMs,
      endMs: s.endMs,
      timebase: 'output',
    }))
  layers.push(...overlays)
  const audioClips = clips.map((c) => {
    const path = `audioClips.${c.id}`,
      length = clipLengths.get(c.id),
      startMs = at(c.at, `${path}.at`)
    const gainDb = c.gainDb ?? 0,
      fadeInMs = c.fadeInMs ?? 0,
      fadeOutMs = c.fadeOutMs ?? 0
    check(
      Number.isFinite(gainDb) && gainDb >= -96 && gainDb <= 24,
      'INVALID_GAIN',
      path,
      'gainDb must be in [-96,24]',
    )
    check(
      [fadeInMs, fadeOutMs].every(
        (v) => Number.isFinite(v) && v >= 0 && v <= length.durationMs,
      ),
      'INVALID_FADE',
      path,
      'Fades must fit the clip',
    )
    check(
      ['narration', 'effects', 'music'].includes(c.role ?? 'narration'),
      'INVALID_AUDIO_ROLE',
      path,
      'role must be narration, effects, or music',
    )
    check(
      startMs + length.durationMs <= end + 0.01,
      'AUDIO_OVERFLOW',
      path,
      'Audio exceeds the sequence',
      'Insert a hold/scene, extend footage, trim audio, or move the clip',
    )
    return {
      ...c,
      ...length,
      startMs,
      endMs: startMs + length.durationMs,
      gainDb,
      fadeInMs,
      fadeOutMs,
      role: c.role ?? 'narration',
    }
  })
  const speech = audioClips
    .filter((c) => c.role === 'narration' && !c.mute)
    .sort((a, b) => a.startMs - b.startMs)
  for (let i = 0; i < speech.length; i++)
    for (
      let j = i + 1;
      j < speech.length && speech[j].startMs < speech[i].endMs;
      j++
    ) {
      check(
        speech[i].allowOverlap === true && speech[j].allowOverlap === true,
        'NARRATION_OVERLAP',
        `audioClips.${speech[j].id}`,
        `Overlaps narration ${speech[i].id}`,
        'Reposition speech or explicitly allowOverlap on both clips',
      )
    }
  return {
    scenes,
    segments,
    layers,
    audioClips,
    durationMs: end,
    resolveAt: at,
    sourceTime,
  }
}

/** Explicit migration copies IDs deterministically and leaves input untouched. */
export function migrateProject(project, capture) {
  if (project.schemaVersion === 2) return structuredClone(project)
  check(
    project.schemaVersion === 1,
    'SCHEMA_VERSION',
    'schemaVersion',
    'Expected version 1 or 2',
  )
  const segments = project.screen?.segments ?? [
    { fromMs: 0, toMs: capture.durationMs, rate: 1 },
  ]
  // New authoring uses scenes; migration expands the screen while retaining output-bound overlays.
  const lead = project.screen?.startMs ?? 0
  const scenes = []
  if (lead)
    scenes.push({
      id: 'legacy-lead',
      kind: 'scene',
      template: 'background',
      durationMs: lead,
    })
  segments.forEach((s, i) =>
    scenes.push({ id: `source-${i + 1}`, kind: 'source', ...s }),
  )
  const screenEnd =
    lead + segments.reduce((n, s) => n + (s.toMs - s.fromMs) / (s.rate ?? 1), 0)
  const oldSegments = compileSegments(
    project.screen?.segments,
    capture.durationMs,
    lead,
  )
  const tail =
    Math.max(
      screenEnd,
      ...mapLayers(project.layers ?? [], oldSegments).map((l) => l.endMs),
    ) - screenEnd
  if (tail > 0)
    scenes.push({
      id: 'legacy-tail',
      kind: 'scene',
      template: 'background',
      durationMs: tail,
    })
  return {
    ...structuredClone(project),
    schemaVersion: 2,
    scenes,
    layers: (project.layers ?? []).map((l, i) => ({
      ...l,
      id: l.id ?? `layer-${i + 1}`,
    })),
    audioClips: [],
    sound: { preset: 'legacy' },
    camera: { policy: 'legacy' },
  }
}
