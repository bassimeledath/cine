import { requireValue as check } from './errors.mjs'
const timestamp = (text) => {
  const values = text.replace(',', '.').split(':').map(Number)
  if (
    values.some((v) => !Number.isFinite(v)) ||
    values.length < 2 ||
    values.length > 3
  )
    return NaN
  return values.reduce((n, v) => n * 60 + v, 0) * 1000
}
export function parseCaptions(text, format, path = 'captions') {
  let cues
  if (format === 'json') {
    const data = JSON.parse(text)
    cues = Array.isArray(data) ? data : data.cues
  } else if (['vtt', 'srt'].includes(format)) {
    cues = text
      .replace(/^\uFEFF/, '')
      .replace(/\r/g, '')
      .split(/\n\s*\n/)
      .flatMap((block) => {
        const lines = block.split('\n'),
          i = lines.findIndex((l) => l.includes('-->'))
        if (i < 0) return []
        const [from, to] = lines[i]
          .split('-->')
          .map((s) => s.trim().split(/\s+/)[0])
        return [
          {
            startMs: timestamp(from),
            endMs: timestamp(to),
            text: lines
              .slice(i + 1)
              .join('\n')
              .replace(/<[^>]*>/g, '')
              .trim(),
          },
        ]
      })
  } else throw new Error(`${path}: captions must be JSON, VTT, or SRT`)
  check(Array.isArray(cues), 'INVALID_CAPTIONS', path, 'Expected caption cues')
  let previous = -Infinity
  for (const [i, c] of cues.entries()) {
    check(
      Number.isFinite(c.startMs) &&
        Number.isFinite(c.endMs) &&
        c.startMs >= 0 &&
        c.endMs > c.startMs &&
        c.startMs >= previous &&
        typeof c.text === 'string' &&
        c.text.trim(),
      'INVALID_CAPTIONS',
      `${path}[${i}]`,
      'Expected ordered, positive caption intervals and text',
    )
    previous = c.endMs
    let last = c.startMs
    for (const w of c.words ?? []) {
      check(
        Number.isFinite(w.startMs) &&
          Number.isFinite(w.endMs) &&
          w.startMs >= last &&
          w.endMs > w.startMs &&
          w.endMs <= c.endMs &&
          typeof w.text === 'string',
        'INVALID_CAPTIONS',
        `${path}[${i}].words`,
        'Word intervals must be ordered and fit the cue',
      )
      last = w.endMs
    }
  }
  return cues
}
export function mapCaptions(clips, media) {
  return clips
    .filter((clip) => !clip.mute)
    .flatMap((clip) =>
      (media[clip.id]?.captions ?? []).flatMap((cue, i) => {
        const from = Math.max(cue.startMs, clip.trimInMs),
          to = Math.min(cue.endMs, clip.trimOutMs)
        if (to <= from) return []
        const shift = (t) => clip.startMs + t - clip.trimInMs
        return [
          {
            ...cue,
            id: `${clip.id}-caption-${i + 1}`,
            audioId: clip.id,
            startMs: shift(from),
            endMs: shift(to),
            ...(cue.words
              ? {
                  words: cue.words
                    .filter((w) => w.endMs > from && w.startMs < to)
                    .map((w) => ({
                      ...w,
                      startMs: shift(Math.max(from, w.startMs)),
                      endMs: shift(Math.min(to, w.endMs)),
                    })),
                }
              : {}),
          },
        ]
      }),
    )
    .sort((a, b) => a.startMs - b.startMs)
}
function stamp(ms, comma = false) {
  const n = Math.round(ms)
  return `${String(Math.floor(n / 3600000)).padStart(2, '0')}:${String(Math.floor(n / 60000) % 60).padStart(2, '0')}:${String(Math.floor(n / 1000) % 60).padStart(2, '0')}${comma ? ',' : '.'}${String(n % 1000).padStart(3, '0')}`
}
export function serializeCaptions(cues, format = 'vtt') {
  return (
    (format === 'vtt' ? 'WEBVTT\n\n' : '') +
    cues
      .map(
        (c, i) =>
          `${format === 'srt' ? i + 1 + '\n' : ''}${stamp(c.startMs, format === 'srt')} --> ${stamp(c.endMs, format === 'srt')}\n${c.text.replace(/-->/g, '→')}\n`,
      )
      .join('\n')
  )
}
