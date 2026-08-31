// Port of kino's engine/auto-zoom.ts range builder.
// 1. per click -> raw range [click-300ms, click+2500ms]
// 2. merge overlapping ranges (gap tolerance 2500ms)
// 3. enforce minimum duration 1000ms

export function findClicks(frames) {
  const clicks = []
  let prev = false
  for (const f of frames) {
    if (f.l && !prev) clicks.push({ t: f.t, x: f.x, y: f.y })
    prev = !!f.l
  }
  return clicks
}

export function buildZoomRanges(frames, opts = {}) {
  const {
    padBeforeMs = 300,
    padAfterMs = 2500,
    // kino uses 2500ms here, tuned for a human clicking in bursts. Authored
    // pacing is the opposite: every beat is a deliberate ~2.2s dwell, so a
    // wide tolerance swallows the whole script into one shot framing the
    // centroid of everything. Merge only genuinely rapid clicks.
    mergeGapMs = 200,
    // Ranges left with a short gap between them would zoom out and straight
    // back in — a visible blip. Below this threshold, hold the zoom and let
    // the camera pan from one target to the next instead.
    closeGapMs = 1500,
    minDurationMs = 1000,
    zoomLevel = 1.5,
    // Clicks only merge into one shot if they are also spatially close.
    // Time alone is the wrong test: kino's tolerance assumes a human
    // burst-clicking in one region, but an agent dwelling ~2.2s between
    // targets on opposite sides of the screen also falls inside it — and the
    // merged shot then frames the midpoint between them, i.e. nothing.
    mergeMaxDistPx = 320,
  } = opts
  const clicks = findClicks(frames)
  if (!clicks.length) return []
  const raw = clicks.map((c) => ({ start: c.t - padBeforeMs, end: c.t + padAfterMs, clicks: [c] }))
  const merged = []
  for (const r of raw) {
    const last = merged[merged.length - 1]
    const prev = last?.clicks[last.clicks.length - 1]
    const near = prev && Math.hypot(r.clicks[0].x - prev.x, r.clicks[0].y - prev.y) <= mergeMaxDistPx
    if (last && near && r.start <= last.end + mergeGapMs) {
      last.end = Math.max(last.end, r.end)
      last.clicks.push(...r.clicks)
    } else {
      merged.push(r)
    }
  }
  const ranges = merged.map((r) => {
    if (r.end - r.start < minDurationMs) r.end = r.start + minDurationMs
    // Frame the clicks, not the cursor path. Averaging every sample in the
    // range drags focus toward wherever the cursor travelled in from.
    const cx = r.clicks.reduce((s, c) => s + c.x, 0) / r.clicks.length
    const cy = r.clicks.reduce((s, c) => s + c.y, 0) / r.clicks.length
    return { start: r.start, end: r.end, zoom: zoomLevel, fx: cx, fy: cy }
  })

  // Hand the timeline over cleanly between consecutive shots. Overlaps must be
  // trimmed because the compositor takes the *first* range matching a
  // timestamp, so an overlapped successor would be ignored until its
  // predecessor expired — holding focus on the old target past the new click.
  // Short gaps get closed for the cinematography reason above.
  for (let i = 0; i < ranges.length - 1; i++) {
    if (ranges[i + 1].start - ranges[i].end <= closeGapMs) {
      ranges[i].end = ranges[i + 1].start
    }
  }
  return ranges.filter((r) => r.end > r.start)
}
