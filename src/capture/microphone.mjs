import { readFile } from 'node:fs/promises'

// This bridge exists only in an explicitly opted-in, disposable capture page.
const key = '__cineVirtualMicrophone'
function install(key) {
  if (globalThis[key]) return
  if (!navigator.mediaDevices) return // about:blank and insecure origins cannot use getUserMedia.
  const devices = navigator.mediaDevices
  const original = devices.getUserMedia
  let context, destination, playing, disposed = false
  const streams = new Set()
  const ready = async () => {
    if (disposed) throw new Error('Virtual microphone is disposed')
    context ??= new AudioContext()
    destination ??= context.createMediaStreamDestination()
    await context.resume()
  }
  const replacement = async (constraints) => {
    if (!constraints?.audio || constraints.video)
      throw new DOMException('Virtual microphone supports audio-only requests', 'NotSupportedError')
    await ready()
    // Consumers may stop their tracks between utterances without killing our bus.
    const stream = destination.stream.clone()
    streams.add(stream)
    return stream
  }
  devices.getUserMedia = replacement
  globalThis[key] = {
    async play(base64) {
      await ready()
      if (playing) throw new Error('Virtual microphone playback is already active')
      if (![...streams].some(s => s.getAudioTracks().some(t => t.readyState === 'live')))
        throw new Error('No active microphone consumer; wait for the app to start listening')
      // Reserve before decoding so concurrent calls cannot interleave.
      playing = {}
      try {
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
        const buffer = await context.decodeAudioData(bytes.buffer)
        if (disposed) throw new Error('Virtual microphone is disposed')
        const source = context.createBufferSource()
        source.buffer = buffer
        source.connect(destination) // Never route injected speech to speakers.
        const done = new Promise((resolve, reject) => {
          source.onended = resolve
          playing = { source, reject }
        })
        const when = context.currentTime + 0.05
        const startMs = Date.now() + (when - context.currentTime) * 1000
        source.start(when)
        await done
        source.disconnect()
        return { startMs, durationMs: buffer.duration * 1000 }
      } finally {
        playing = null
      }
    },
    async dispose() {
      disposed = true
      if (devices.getUserMedia === replacement) devices.getUserMedia = original
      if (playing?.source) {
        playing.reject(new Error('Virtual microphone playback cancelled'))
        playing.source.stop()
      }
      for (const stream of streams) for (const track of stream.getTracks()) track.stop()
      for (const track of destination?.stream.getTracks() ?? []) track.stop()
      if (context) await context.close()
      delete globalThis[key]
    },
  }
}

/** Install before navigation. Caller owns the fresh page; never inject into a user's tab. */
export async function installVirtualMicrophone(page) {
  const script = await page.evaluateOnNewDocument(install, key)
  await page.evaluate(install, key)
  return {
    async play(file) {
      if (typeof file !== 'string' || !file) throw new Error('audioInput requires a local file')
      const audio = (await readFile(file)).toString('base64')
      return page.evaluate(async (key, audio) => {
        if (!globalThis[key]) throw new Error('Virtual microphone needs a secure origin (HTTPS or localhost)')
        return globalThis[key].play(audio)
      }, key, audio)
    },
    async dispose() {
      await page.removeScriptToEvaluateOnNewDocument(script.identifier)
      await page.evaluate(key => globalThis[key]?.dispose(), key)
    },
  }
}
