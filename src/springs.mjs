// Port of kino's engine/spring-camera.ts math.
// Semi-implicit Euler, ~1ms substeps.
// Screen/zoom spring: 200/40/2.25 — cursor spring: 470/70/3.

export const SPRING_PRESETS = {
  screen: { stiffness: 200, damping: 40, mass: 2.25 },
  zoom: { stiffness: 200, damping: 40, mass: 2.25 },
  mouse: { stiffness: 470, damping: 70, mass: 3 },
}

export function makeSpring(x = 0, y = 0) {
  return { x, y, vx: 0, vy: 0 }
}

export function stepSpring(s, tx, ty, preset, dtMs) {
  if (dtMs <= 0) return
  const n = Math.max(1, Math.round(dtMs))
  const dt = dtMs / n / 1000
  for (let i = 0; i < n; i++) {
    s.vx +=
      ((preset.stiffness * (tx - s.x) - preset.damping * s.vx) / preset.mass) *
      dt
    s.vy +=
      ((preset.stiffness * (ty - s.y) - preset.damping * s.vy) / preset.mass) *
      dt
    s.x += s.vx * dt
    s.y += s.vy * dt
  }
}

export function makeScalar(v = 1) {
  return { x: v, vx: 0 }
}

export function stepScalar(
  s,
  target,
  { stiffness = 1200, damping = 34, mass = 1 },
  dtMs,
) {
  if (dtMs <= 0) return
  const n = Math.max(1, Math.round(dtMs))
  const dt = dtMs / n / 1000
  for (let i = 0; i < n; i++) {
    s.vx += ((stiffness * (target - s.x) - damping * s.vx) / mass) * dt
    s.x += s.vx * dt
  }
}
