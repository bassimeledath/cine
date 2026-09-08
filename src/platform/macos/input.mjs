import { typeText } from '../../actions/typing.mjs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { cliclickPath } from './runtime.mjs'
import { chromiumDriver } from '../../actions/chromium.mjs'

const exec = promisify(execFile)
const absolute = (n) => (n < 0 ? `=${Math.round(n)}` : String(Math.round(n)))

/** DOM targeting is shared; only the physical input transport is macOS-specific. */
export function macosDriver(page, client) {
  const dom = chromiumDriver(page, client),
    bin = cliclickPath()
  const at = (p) => `${absolute(p.x)},${absolute(p.y)}`
  return {
    async resolve(selector, timeout) {
      const target = await dom.resolve(selector, timeout)
      const origin = await page.evaluate(() => ({
        x: screenX + (outerWidth - innerWidth) / 2,
        y: screenY + outerHeight - innerHeight,
      }))
      return { x: origin.x + target.x, y: origin.y + target.y }
    },
    move: (p) => exec(bin, [`m:${at(p)}`]),
    down: (p) => exec(bin, [`dd:${at(p)}`]),
    up: (p) => exec(bin, [`du:${at(p)}`]),
    type: (text, options) =>
      typeText(
        text,
        {
          insert: (text) => exec(bin, [`t:${text}`]),
          press: (text) => exec(bin, [`t:${text}`]),
        },
        options,
      ),
    scroll: (delta) =>
      exec(fileURLToPath(new URL('./cursor-logger', import.meta.url)), [
        '--scroll',
        String(-delta.x),
        String(-delta.y),
      ]),
    waitFor: dom.waitFor,
  }
}
