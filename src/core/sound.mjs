import { requireValue as check } from './errors.mjs'
import { outputAt } from './timeline.mjs'
export function validateSound(sound = {}) {
  check(
    ['recorded', 'subtle', 'silent', 'custom', 'legacy'].includes(
      sound.preset ?? 'subtle',
    ),
    'INVALID_SOUND',
    'sound.preset',
    'Unknown sound preset',
  )
  for (const [role, bus] of Object.entries(sound.buses ?? {})) {
    check(
      ['narration', 'effects', 'music'].includes(role),
      'INVALID_SOUND',
      'sound.buses',
      `Unknown bus ${role}`,
    )
    check(
      bus.gainDb === undefined ||
        (Number.isFinite(bus.gainDb) && bus.gainDb >= -96 && bus.gainDb <= 24),
      'INVALID_SOUND',
      `sound.buses.${role}`,
      'gainDb must be in [-96,24]',
    )
    check(
      bus.mute === undefined || typeof bus.mute === 'boolean',
      'INVALID_SOUND',
      `sound.buses.${role}`,
      'mute must be boolean',
    )
  }
  for (const key of ['attackMs', 'releaseMs'])
    check(
      sound.ducking?.[key] === undefined ||
        (Number.isFinite(sound.ducking[key]) &&
          sound.ducking[key] >= 0 &&
          sound.ducking[key] <= 5000),
      'INVALID_SOUND',
      `sound.ducking.${key}`,
      'Expected 0–5000 ms',
    )
  check(
    sound.ducking?.gainDb === undefined ||
      (Number.isFinite(sound.ducking.gainDb) &&
        sound.ducking.gainDb >= -96 &&
        sound.ducking.gainDb <= 0),
    'INVALID_SOUND',
    'sound.ducking.gainDb',
    'Expected attenuation in [-96,0] dB',
  )
  return sound
}
export function subtleCues({
  clicks,
  events = [],
  segments,
  states,
  sound = {},
}) {
  if (['silent', 'custom', 'legacy'].includes(sound.preset)) return []
  const recorded = sound.preset === 'recorded'
  const cues = clicks.map((c) => ({
    sound: recorded ? 'recordedMouse' : 'softClick',
    atMs: c.t,
    gain: recorded ? 0.35 : 0.55,
  }))
  let last = -Infinity,
    previousSample = -1
  for (const e of events) {
    if (e.type !== 'typing' || e.instant) continue
    const t = outputAt(segments, e.t)
    if (t === null || t - last < (recorded ? 115 : 65)) continue
    let hash = Math.round(e.t * 1000) >>> 0
    hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d)
    hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b)
    hash = (hash ^ (hash >>> 16)) >>> 0
    let sample = hash % 8
    if (sample === previousSample) sample = (sample + 1) % 8
    previousSample = sample
    cues.push({
      sound: recorded
        ? `recordedKey${sample + 1}`
        : e.category === 'delete'
          ? 'keyDelete'
          : 'keyTap',
      atMs: t,
      gain: recorded ? 0.13 + ((hash >>> 8) % 100) / 1000 : 0.32,
    })
    last = t
  }
  if (recorded ? sound.transitions === true : sound.transitions !== false) {
    // Detect material changes in the actual smoothed zoom; panning alone is silent.
    let baseline = 1,
      lastCue = -Infinity
    for (const state of states) {
      if (!state.active || state.hold) continue
      if (Math.abs(state.zoom - baseline) >= 0.18 && state.t - lastCue >= 900) {
        cues.push({
          sound: 'softWhoosh',
          atMs: Math.max(0, state.t - 60),
          gain: 0.22,
        })
        lastCue = state.t
        baseline = state.zoom
      }
      if (state.t - lastCue < 900) baseline = state.zoom
    }
  }
  return cues.sort((a, b) => a.atMs - b.atMs)
}
