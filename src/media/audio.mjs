import { recordedSound, RECORDED_SOUND_NAMES } from './recorded-sounds.mjs'
// Stage 4 — the audio track.
//
// Audio never touches the canvas. The compositor renders silent frames; this
// module mixes a stereo bed in Node and muxes it in at the end. That split is
// deliberate: sound does not affect frame evaluation, and changing cues
// requires only mixing and muxing after the picture is rendered.
//
// Legacy synth cues remain reproducible; recorded input samples are packaged locally.

import { runProcess } from '../runtime/process.mjs'
import { writeFileSync } from 'node:fs'

const SR = 48000

// --- tiny synth toolkit ---------------------------------------------------

/** Deterministic noise. Math.random() would make renders non-reproducible. */
function makeNoise(seed = 1) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return (s / 0xffffffff) * 2 - 1
  }
}

/** One-pole lowpass. `cut` is 0..1 (fraction of Nyquist, roughly). */
function lowpass(cut) {
  let y = 0
  return (x) => (y += cut * (x - y))
}

function highpass(cut) {
  const lp = lowpass(cut)
  return (x) => x - lp(x)
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Attack/decay envelope with exponential tail — the shape almost every UI
 *  sound wants. */
function env(t, dur, { attack = 0.004, curve = 4 } = {}) {
  if (t < 0 || t > dur) return 0
  const a = t < attack ? t / attack : 1
  const d = Math.exp((-curve * t) / dur)
  return a * d
}

/** Build a stereo buffer of `durSec` from a per-sample function. */
function synth(durSec, fn) {
  const n = Math.ceil(durSec * SR)
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const [l, r] = fn(i / SR, i)
    L[i] = l
    R[i] = r
  }
  return [L, R]
}

// --- the sound set --------------------------------------------------------

/** Cursor click. Short, dry, high — reads as "something was pressed" without
 *  competing with speech if narration is added later. */
function tick() {
  const noise = makeNoise(7)
  const hp = highpass(0.55)
  const lp = lowpass(0.42)
  return synth(0.05, (t) => {
    const e = env(t, 0.05, { attack: 0.0008, curve: 9 })
    const body =
      lp(hp(noise())) * 0.85 + Math.sin(2 * Math.PI * 2100 * t) * 0.25
    const v = body * e * 0.8
    return [v, v]
  })
}

/** Toast / notification. Rising two-partial blip with a soft attack so it
 *  doesn't read as an error. */
function pop() {
  return synth(0.26, (t) => {
    const f = 520 * Math.pow(900 / 520, clamp01(t / 0.09))
    const e = env(t, 0.26, { attack: 0.008, curve: 5 })
    const v =
      (Math.sin(2 * Math.PI * f * t) * 0.7 +
        Math.sin(2 * Math.PI * f * 2 * t) * 0.18) *
      e *
      0.5
    return [v, v * 0.96]
  })
}

/** Camera move. Band-passed noise swept in the direction of the zoom, wide in
 *  the stereo field so it sits under the picture rather than on top of it. */
function whoosh(dir = 1) {
  const nL = makeNoise(11)
  const nR = makeNoise(29)
  const dur = 0.5
  let lpL = 0
  let lpR = 0
  return synth(dur, (t) => {
    const p = t / dur
    // Bell-shaped amplitude: fades in, peaks mid-move, fades out.
    const e = Math.sin(Math.PI * clamp01(p)) ** 1.6
    // Sweep the cutoff up for a zoom-in, down for a zoom-out.
    const k = dir > 0 ? 0.02 + 0.2 * p : 0.22 - 0.2 * p
    lpL += k * (nL() - lpL)
    lpR += k * (nR() - lpR)
    return [lpL * e * 0.3, lpR * e * 0.3]
  })
}

/** Success chime for the outro. Perfect fifth, long tail. */
function chime() {
  return synth(1.1, (t) => {
    const e = env(t, 1.1, { attack: 0.006, curve: 3.2 })
    const a = Math.sin(2 * Math.PI * 880 * t) * 0.5
    const b = Math.sin(2 * Math.PI * 1320 * t) * 0.32
    const c = Math.sin(2 * Math.PI * 1760 * t) * 0.12
    return [(a + b) * e * 0.32, (a + c) * e * 0.32]
  })
}

/** Title bed. Detuned low sines with a slow swell — gives the opening card
 *  weight so the cut into the demo lands. */
function pad(durSec = 3.2) {
  return synth(durSec, (t) => {
    const swell = Math.sin(Math.PI * clamp01(t / durSec)) ** 1.2
    const l =
      Math.sin(2 * Math.PI * 110 * t) * 0.5 +
      Math.sin(2 * Math.PI * 164.8 * t) * 0.3 +
      Math.sin(2 * Math.PI * 220.4 * t) * 0.2
    const r =
      Math.sin(2 * Math.PI * 110.6 * t) * 0.5 +
      Math.sin(2 * Math.PI * 165.4 * t) * 0.3 +
      Math.sin(2 * Math.PI * 219.6 * t) * 0.2
    return [l * swell * 0.1, r * swell * 0.1]
  })
}

function softClick(frequency = 620, seed = 42) {
  const noise = makeNoise(seed),
    lp = lowpass(0.12)
  return synth(0.065, (t) => {
    const e = env(t, 0.065, { attack: 0.0015, curve: 6 }),
      v =
        (lp(noise()) * 0.5 + Math.sin(2 * Math.PI * frequency * t) * 0.3) *
        e *
        0.35
    return [v, v]
  })
}
function softWhoosh() {
  const noise = makeNoise(31),
    lp = lowpass(0.035)
  return synth(0.26, (t) => {
    const v = lp(noise()) * Math.sin((Math.PI * t) / 0.26) ** 2 * 0.12
    return [v, v]
  })
}

export const SOUNDS = {
  ...Object.fromEntries(
    RECORDED_SOUND_NAMES.map((name) => [name, () => recordedSound(name)]),
  ),
  softClick,
  keyTap: () => softClick(420, 81),
  keyDelete: () => softClick(320, 91),
  softWhoosh,
  tick,
  pop,
  whoosh: () => whoosh(1),
  whooshOut: () => whoosh(-1),
  chime,
  pad,
}

// --- mixing ---------------------------------------------------------------

/**
 * Mix cues onto a silent bed.
 *
 * `cues` are { sound, atMs, gain? }. `sound` is a key of SOUNDS.
 * Sources are rendered once and reused, so 40 clicks cost one synth pass.
 */
export function mixTrack(cues, durationMs) {
  const n = Math.ceil((durationMs / 1000) * SR) + SR // +1s tail for long decays
  const L = new Float32Array(n)
  const R = new Float32Array(n)
  const cache = new Map()

  for (const cue of cues) {
    const make = SOUNDS[cue.sound]
    if (!make) throw new Error(`audio: unknown sound "${cue.sound}"`)
    if (!cache.has(cue.sound)) cache.set(cue.sound, make())
    const [sl, sr] = cache.get(cue.sound)
    const g = cue.gain ?? 1
    const off = Math.round((cue.atMs / 1000) * SR)
    for (let i = 0; i < sl.length; i++) {
      const j = off + i
      if (j < 0 || j >= n) continue
      L[j] += sl[i] * g
      R[j] += sr[i] * g
    }
  }

  // Soft clip rather than hard clip — overlapping cues shouldn't crackle.
  for (let i = 0; i < n; i++) {
    L[i] = Math.tanh(L[i])
    R[i] = Math.tanh(R[i])
  }
  return [L, R]
}

export function writeWav(path, [L, R]) {
  const n = L.length
  const bytes = n * 4 // 2ch * 16-bit
  const buf = Buffer.alloc(44 + bytes)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + bytes, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(2, 22) // stereo
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(SR * 4, 28)
  buf.writeUInt16LE(4, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(bytes, 40)
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(
      Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))),
      44 + i * 4,
    )
    buf.writeInt16LE(
      Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))),
      46 + i * 4,
    )
  }
  writeFileSync(path, buf)
  return path
}

/** Mux a wav onto a rendered mp4 without re-encoding the video. */
export async function muxAudio(videoPath, wavPath, outPath, ffmpeg) {
  await runProcess(
    ffmpeg,
    [
      '-y',
      '-i',
      videoPath,
      '-i',
      wavPath,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-shortest',
      outPath,
    ],
    { stdio: 'pipe' },
  )
  return outPath
}

/**
 * Derive sound cues from signals cine already has.
 *
 * This is the part a general-purpose video framework structurally can't do:
 * the click track and the zoom ranges come out of the capture, so the sound
 * design writes itself. Authored cues get layered on top.
 */
export function autoCues({ clicks = [], zoomRanges = [], offsetMs = 0 }) {
  const cues = []
  for (const c of clicks)
    cues.push({ sound: 'tick', atMs: c.t + offsetMs, gain: 0.9 })
  for (const r of zoomRanges) {
    cues.push({ sound: 'whoosh', atMs: r.start + offsetMs - 60, gain: 0.8 })
    cues.push({ sound: 'whooshOut', atMs: r.end + offsetMs - 120, gain: 0.55 })
  }
  return cues
}
