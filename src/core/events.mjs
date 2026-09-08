export function findClicks(frames) {
  const clicks = []
  let down = false
  for (const f of frames) {
    if (f.l && !down) clicks.push({ t: f.t, x: f.x, y: f.y })
    down = !!f.l
  }
  return clicks
}

export function sampleTrack(frames, t) {
  let lo = 0,
    hi = frames.length - 1
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (frames[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  return frames[lo]
}

export const ease = (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)
