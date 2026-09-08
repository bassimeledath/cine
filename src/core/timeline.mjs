/** Positive, ordered, non-overlapping source segments. Output is contiguous. */
export function compileSegments(segments, sourceDurationMs, startMs = 0) {
  if (!Number.isFinite(sourceDurationMs) || sourceDurationMs <= 0)
    throw new Error('Capture duration must be positive')
  if (!Number.isFinite(startMs) || startMs < 0)
    throw new Error('Screen start must be nonnegative')
  const input = segments ?? [{ fromMs: 0, toMs: sourceDurationMs, rate: 1 }]
  if (!input.length) throw new Error('Timeline needs at least one segment')
  let end = startMs,
    previous = 0
  return input.map(({ fromMs, toMs, rate = 1 }) => {
    if (
      ![fromMs, toMs, rate].every(Number.isFinite) ||
      fromMs < previous ||
      toMs <= fromMs ||
      toMs > sourceDurationMs ||
      rate <= 0 ||
      rate > 16
    ) {
      throw new Error(
        'Segments need ordered source bounds within the capture and a rate in (0,16]',
      )
    }
    const out = {
      fromMs,
      toMs,
      rate,
      startMs: end,
      endMs: end + (toMs - fromMs) / rate,
    }
    end = out.endMs
    previous = toMs
    return out
  })
}

export function sourceAt(segments, t) {
  const s = segments.find(
    (s) => s.kind !== 'scene' && t >= s.startMs && t < s.endMs,
  )
  return s ? s.fromMs + (t - s.startMs) * s.rate : null
}

export function outputAt(segments, t) {
  const s = segments.find(
    (s) =>
      s.kind !== 'hold' && s.kind !== 'scene' && t >= s.fromMs && t < s.toMs,
  )
  return s ? s.startMs + (t - s.fromMs) / s.rate : null
}

/** A source-bound interval can split across trims. Output-bound layers stay put. */
export function mapLayers(layers, segments) {
  return layers.flatMap((layer) => {
    const screenEnd = screenEndAt(segments)
    if (layer.timebase === 'screenEnd')
      return [
        {
          ...layer,
          startMs: screenEnd + layer.startMs,
          endMs: screenEnd + layer.endMs,
        },
      ]
    if (layer.timebase !== 'source')
      return [
        {
          ...layer,
          endMs:
            layer.endAt === 'screenEnd'
              ? screenEnd + (layer.endOffsetMs ?? 0)
              : layer.endMs,
        },
      ]
    const spans = []
    let previousSourceEnd = null
    for (const s of segments.filter(
      (s) => s.kind !== 'hold' && s.kind !== 'scene',
    )) {
      const from = Math.max(layer.startMs, s.fromMs),
        to = Math.min(layer.endMs, s.toMs)
      if (to <= from) continue
      const endMs = s.startMs + (to - s.fromMs) / s.rate
      // A speed change preserves the interval; only a source cut restarts it.
      if (from === previousSourceEnd) spans.at(-1).endMs = endMs
      else
        spans.push({
          ...layer,
          startMs: s.startMs + (from - s.fromMs) / s.rate,
          endMs,
          timebase: 'output',
        })
      previousSourceEnd = to
    }
    return spans
  })
}

export function mapCues(cues, segments) {
  return cues.flatMap((cue) => {
    const atMs =
      cue.timebase === 'source'
        ? outputAt(segments, cue.atMs)
        : cue.timebase === 'screenEnd'
          ? screenEndAt(segments) + cue.atMs
          : cue.atMs
    return atMs === null ? [] : [{ ...cue, atMs, timebase: 'output' }]
  })
}

export function screenEndAt(segments) {
  return (segments.findLast((s) => s.kind !== 'scene') ?? segments.at(-1)).endMs
}
