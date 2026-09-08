/** Keep original frame times so custom scenes, springs and captions match the final render. */
export function previewPlan(
  plan,
  { fromMs = 0, toMs = plan.durationMs, sceneId } = {},
) {
  if (sceneId) {
    const scene = plan.scenes.find((s) => s.id === sceneId)
    if (!scene) throw new Error(`Unknown preview scene ${sceneId}`)
    fromMs = scene.startMs
    toMs = scene.endMs
  }
  if (
    !Number.isFinite(fromMs) ||
    !Number.isFinite(toMs) ||
    fromMs < 0 ||
    toMs <= fromMs ||
    toMs > plan.durationMs
  )
    throw new Error('Preview bounds must fit the output timeline')
  const first = Math.floor((fromMs * plan.fps) / 1000),
    last = Math.min(plan.states.length, Math.ceil((toMs * plan.fps) / 1000)),
    offsetMs = (first * 1000) / plan.fps,
    durationMs = ((last - first) * 1000) / plan.fps
  const outputCaptions = plan.captions
    .filter((c) => c.endMs > offsetMs && c.startMs < offsetMs + durationMs)
    .map((c) => ({
      ...c,
      startMs: Math.max(0, c.startMs - offsetMs),
      endMs: Math.min(durationMs, c.endMs - offsetMs),
    }))
  return {
    ...plan,
    states: plan.states.slice(first, last),
    durationMs,
    preview: { fromMs: offsetMs, toMs: offsetMs + durationMs },
    outputCaptions,
  }
}
