import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { runElectronDemo } from '../../src/demo.mjs'
import { loadCapture } from '../../src/capture/artifacts.mjs'
import { resolveRuntime } from '../../src/runtime/host.mjs'

const runtime = await resolveRuntime()
for (const attached of [false, true]) {
  await test(`custom Electron demo script executes on ${attached ? 'attached headless Chromium' : 'bundled hidden Electron'}`, async () => {
    const work = mkdtempSync(join(tmpdir(), 'cine custom electron '))
    let browser
    try {
      if (attached) {
        browser = await puppeteer.launch({
          executablePath: runtime.chrome,
          headless: true,
        })
        const page = (await browser.pages())[0]
        await page.setContent(
          '<button id="custom" onclick="this.textContent=\'Done\'">Custom</button>',
        )
      }
      const selector = attached ? '#custom' : '.item[data-view="Incidents"]'
      const beats = [
        {
          selector,
          label: 'Custom script regression',
          moveMs: 0,
          settleMs: 0,
          dwellMs: 0,
          ...(attached ? { expect: { selector, text: 'Done' } } : {}),
        },
      ]
      await runElectronDemo({
        workDir: work,
        outPath: join(work, 'result.mp4'),
        runtime,
        fps: 2,
        beats,
        leadInMs: 100,
        tailMs: 100,
        connectTo: browser?.wsEndpoint(),
      })
      const capture = loadCapture(join(work, 'meta.json'))
      assert.deepEqual(
        capture.actions.map((a) => a.label),
        ['Custom script regression'],
      )
      assert.equal(capture.actions[0].selector, selector)
      if (browser)
        assert.equal(
          await (
            await browser.pages()
          )[0].$eval('#custom', (el) => el.textContent),
          'Done',
        )
    } finally {
      if (browser) await browser.close()
      rmSync(work, { recursive: true, force: true })
    }
  })
}
