/** Pure helpers for frame-driven scenes. Values depend only on supplied time. */
export const clamp = (x, min = 0, max = 1) => Math.max(min, Math.min(max, x))
export const easeOut = (x) => 1 - (1 - clamp(x)) ** 3
export const interpolate = (value, [a, b], [x, y]) =>
  x + (y - x) * clamp((value - a) / (b - a))
export function random(seed = 1) {
  let x = seed >>> 0
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0
    return x / 0xffffffff
  }
}
