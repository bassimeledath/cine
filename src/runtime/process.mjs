import { spawn } from 'node:child_process'

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Own the close promise from creation, including spawn errors and early exits. */
export function startProcess(command, args = [], options = {}) {
  const child = spawn(command, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  })
  let result = null
  let stderr = ''
  child.stderr?.on('data', (data) => {
    stderr = (stderr + data).slice(-16384)
  })
  const closed = new Promise((resolve) => {
    const finish = (value) => {
      if (!result) {
        result = value
        resolve(value)
      }
    }
    child.once('error', (error) => finish({ code: null, error }))
    child.once('close', (code, signal) => finish({ code, signal }))
  })
  // A process can exit while its owner is about to write a graceful-stop command.
  child.stdin?.on('error', () => {})
  let stopping
  return {
    child,
    closed,
    get result() {
      return result
    },
    get stderr() {
      return stderr
    },
    stop({ input, signal = 'SIGTERM', timeoutMs = 3000 } = {}) {
      stopping ??= (async () => {
        if (!result) {
          if (input && child.stdin?.writable) child.stdin.write(input)
          else child.kill(signal)
          let timer
          const timedOut = await Promise.race([
            closed.then(() => false),
            new Promise((resolve) => {
              timer = setTimeout(() => resolve(true), timeoutMs)
            }),
          ])
          clearTimeout(timer)
          if (timedOut) child.kill('SIGKILL')
        }
        return closed
      })()
      return stopping
    },
  }
}

export async function runProcess(command, args, options = {}) {
  const process = startProcess(command, args, options)
  const result = await process.closed
  if (result.error || result.code !== 0) {
    throw new Error(
      `${command} failed: ${result.error?.message ?? `exit ${result.code}`}\n${process.stderr}`,
    )
  }
  return result
}

export async function waitForProcess(process, predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate(process.stderr)) {
    if (process.result)
      throw new Error(
        `process ended before ready: ${process.result.error?.message ?? process.stderr}`,
      )
    if (Date.now() >= deadline)
      throw new Error(`process readiness timed out\n${process.stderr}`)
    await sleep(25)
  }
}
