import { existsSync } from 'node:fs'

export const chromeCandidates = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]
export const ffmpegCandidates = [
  '/opt/homebrew/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
]
export function cliclickPath() {
  const path =
    process.env.CINE_CLICLICK ??
    ['/opt/homebrew/bin/cliclick', '/usr/local/bin/cliclick'].find(existsSync)
  if (!path)
    throw new Error(
      'Native input needs cliclick: brew install cliclick, or set CINE_CLICLICK',
    )
  return path
}
