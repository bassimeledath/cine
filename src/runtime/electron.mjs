import { createRequire } from 'node:module'
import { startProcess, waitForProcess } from './process.mjs'

/** Ask Chromium for an ephemeral port and consume this child's own endpoint. */
export async function launchElectron(appPath) {
  const binary = createRequire(import.meta.url)('electron')
  const proc = startProcess(binary, [appPath], {
    env: { ...process.env, CINE_CDP_PORT: '0', CINE_SHOW_DEMO: '0' },
  })
  try {
    await waitForProcess(
      proc,
      (s) => /DevTools listening on ws:\/\/[^\s]+/.test(s),
      20000,
    )
    const endpoint = proc.stderr.match(
      /DevTools listening on (ws:\/\/[^\s]+)/,
    )[1]
    return { endpoint, stop: () => proc.stop() }
  } catch (error) {
    await proc.stop()
    throw error
  }
}
