import test from 'node:test'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import { resolveRuntime } from '../../src/runtime/host.mjs'
import { chromiumDriver } from '../../src/actions/chromium.mjs'
import { runActions } from '../../src/actions/runner.mjs'

test('headless wheel gestures and nested target reveals produce intermediate frames and settle before interaction', async () => {
  const runtime = await resolveRuntime()
  const browser = await puppeteer.launch({ executablePath: runtime.chrome, headless: true })
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 800, height: 600 })
    await page.setContent(`<style>body{margin:0}#space{height:1300px}#box{height:200px;overflow:auto}#inside{height:700px}button{height:50px}</style>
      <div id="space">Top</div><button id="target">Target</button>
      <div id="box"><div id="inside"></div><button id="nested">Nested</button></div><div style="height:1200px"></div>`)
    const driver = chromiumDriver(page, await page.createCDPSession())
    const begin = () => page.evaluate(() => {
      window.positions = []
      window.tracking = true
      const tick = () => {
        window.positions.push({y:scrollY,nested:document.querySelector('#box').scrollTop})
        if (window.tracking) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    const finish = () => page.evaluate(() => {window.tracking=false;return window.positions})
    await begin()
    await runActions([{ type:'scroll', y:480, scrollMs:900, dwellMs:200 }], driver, {
      start:{x:400,y:300},leadInMs:0,tailMs:0,
    })
    let positions = await finish()
    assert.ok(new Set(positions.map(p=>p.y)).size > 12)
    assert.equal(positions.at(-1).y,480)
    assert.ok(Math.max(...positions.slice(1).map((p,i)=>Math.abs(p.y-positions[i].y))) < 150)
    await begin()
    await driver.resolve('#target')
    positions = await finish()
    assert.ok(new Set(positions.map(p=>p.y)).size > 8)
    assert.ok(positions.slice(-4).every(p=>p.y===positions.at(-1).y))
    const before = await page.evaluate(()=>scrollY)
    await driver.resolve('#target')
    assert.equal(await page.evaluate(()=>scrollY),before,'visible targets should not be recentered')
    await begin()
    await runActions([{selector:'#nested',moveMs:0,settleMs:0,dwellMs:0}],driver,{leadInMs:0,tailMs:0})
    positions = await finish()
    assert.ok(new Set(positions.map(p=>p.nested)).size > 8)
    assert.equal(await page.evaluate(()=>document.activeElement.id),'nested')
  } finally { await browser.close() }
})
