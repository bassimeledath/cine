import { readFileSync } from 'node:fs'
const cache = new Map()
/** Prepared, packaged mono PCM samples; decoding is local and deterministic. */
export function recordedSound(name) {
  if (cache.has(name)) return cache.get(name)
  const file =
    name === 'recordedMouse'
      ? 'mouse.wav'
      : `key-${name.slice('recordedKey'.length)}.wav`
  if (!/^mouse\.wav$|^key-[1-8]\.wav$/.test(file))
    throw new Error(`Unknown recorded sound: ${name}`)
  const bytes = readFileSync(
    new URL(`../../assets/sounds/recorded/${file}`, import.meta.url),
  )
  if (
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WAVE'
  )
    throw new Error(`Invalid packaged sound: ${file}`)
  let data, format
  for (let off = 12; off + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', off, off + 4),
      size = bytes.readUInt32LE(off + 4),
      start = off + 8
    if (start + size > bytes.length)
      throw new Error(`Truncated packaged sound: ${file}`)
    if (id === 'fmt ') format = bytes.subarray(start, start + size)
    if (id === 'data') data = bytes.subarray(start, start + size)
    off = start + size + (size % 2)
  }
  if (
    !format ||
    !data ||
    format.readUInt16LE(0) !== 1 ||
    format.readUInt16LE(2) !== 1 ||
    format.readUInt32LE(4) !== 48000 ||
    format.readUInt16LE(14) !== 16
  )
    throw new Error(`Expected 48k mono PCM16: ${file}`)
  const samples = Float32Array.from(
    { length: data.length / 2 },
    (_, i) => data.readInt16LE(i * 2) / 32768,
  )
  const stereo = [samples, samples]
  cache.set(name, stereo)
  return stereo
}
export const RECORDED_SOUND_NAMES = [
  'recordedMouse',
  ...Array.from({ length: 8 }, (_, i) => `recordedKey${i + 1}`),
]
