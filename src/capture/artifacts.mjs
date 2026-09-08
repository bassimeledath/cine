import { readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, relative, resolve } from 'node:path'

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}
export function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
}
export function readCursor(path) {
  const rows = readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((line) => JSON.parse(line))
  if (!rows.length) throw new Error(`Empty cursor track: ${path}`)
  for (let i = 0; i < rows.length; i++) {
    const f = rows[i]
    if (
      !['t', 'x', 'y'].every((k) => Number.isFinite(f[k])) ||
      (i && f.t < rows[i - 1].t)
    )
      throw new Error('Cursor track must contain ordered finite samples')
  }
  return rows
}

/** Normalize at the capture boundary; consumers only use source-relative time. */
export function saveCapture({
  videoPath,
  cursorPath,
  videoT0,
  durationMs,
  displayPoints,
  fps,
  backend,
  anchors = {},
  anchorTrack = [],
  actions = [],
  events = [],
  geometry = { x: 0, y: 0, ...displayPoints },
}) {
  const frames = readCursor(cursorPath).map((f) => ({ ...f, t: f.t - videoT0 }))
  writeFileSync(
    cursorPath,
    frames.map((f) => JSON.stringify(f)).join('\n') + '\n',
  )
  const meta = {
    schemaVersion: 1,
    backend,
    video: basename(videoPath),
    cursor: relative(resolve(dirname(videoPath)), resolve(cursorPath)),
    clockOriginMs: videoT0,
    videoT0: 0,
    durationMs,
    displayPoints,
    geometry,
    fps,
    anchors,
    anchorTrack: anchorTrack.map((s) => ({ ...s, t: s.t - videoT0 })),
    actions: actions.map((a) => ({
      ...a,
      startMs: a.startMs - videoT0,
      endMs: a.endMs - videoT0,
      ...(a.milestones
        ? {
            milestones: Object.fromEntries(
              Object.entries(a.milestones).map(([k, t]) => [k, t - videoT0]),
            ),
          }
        : {}),
    })),
    eventSchemaVersion: 1,
    events: events.map((e) => ({ ...e, t: e.t - videoT0 })),
  }
  const manifestPath = resolve(dirname(videoPath), 'meta.json')
  writeJson(manifestPath, meta)
  return { ...meta, videoPath, cursorPath, manifestPath }
}

export function loadCapture(manifestPath) {
  const meta = readJson(manifestPath)
  if (meta.schemaVersion !== undefined && meta.schemaVersion !== 1)
    throw new Error('Unsupported capture schemaVersion')
  if (
    !Number.isFinite(meta.durationMs) ||
    meta.durationMs <= 0 ||
    !meta.displayPoints ||
    !['w', 'h'].every(
      (k) =>
        Number.isFinite(meta.displayPoints[k]) && meta.displayPoints[k] > 0,
    )
  )
    throw new Error('Invalid capture metadata')
  const origin = meta.videoT0 ?? 0
  const videoPath = resolve(dirname(manifestPath), meta.video ?? 'raw.mp4')
  const cursorPath = resolve(
    dirname(manifestPath),
    meta.cursor ?? 'cursor.jsonl',
  )
  const frames = readCursor(cursorPath).map((f) => ({ ...f, t: f.t - origin }))
  return {
    ...meta,
    videoPath,
    cursorPath,
    frames,
    videoT0: 0,
    actions: (meta.actions ?? []).map((a) => ({
      ...a,
      startMs: a.startMs - origin,
      endMs: a.endMs - origin,
      ...(a.milestones
        ? {
            milestones: Object.fromEntries(
              Object.entries(a.milestones).map(([k, t]) => [k, t - origin]),
            ),
          }
        : {}),
    })),
    events: (meta.events ?? []).map((e) => ({ ...e, t: e.t - origin })),
    anchorTrack: (meta.anchorTrack ?? []).map((s) => ({
      ...s,
      t: s.t - origin,
    })),
  }
}
