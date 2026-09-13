import test from 'node:test'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import {resolveRuntime} from '../../src/runtime/host.mjs'
import {chromiumDriver} from '../../src/actions/chromium.mjs'
import {runActions} from '../../src/actions/runner.mjs'

test('headless text selection drags across inline elements and wrapped lines, verifies and releases', async () => {
  const runtime = await resolveRuntime()
  const browser = await puppeteer.launch({executablePath:runtime.chrome,headless:true})
  try {
    const page = await browser.newPage()
    await page.setViewport({width:800,height:600})
    await page.setContent('<p id="text" style="margin:80px;width:220px;font:24px Arial">Before: <strong>Agents need</strong> good tools and useful feedback. After.</p>')
    const driver = chromiumDriver(page, await page.createCDPSession()), actions=[], samples=[]
    await runActions([{id:'selection',type:'selectText',selector:'#text',text:'Agents need good tools and useful feedback.',moveMs:0,settleMs:0,dragMs:200,dwellMs:0}],driver,{leadInMs:0,tailMs:0,onAction:a=>actions.push(a),emit:s=>samples.push(s)})
    assert.equal(await page.evaluate(()=>getSelection().toString()), 'Agents need good tools and useful feedback.')
    assert.ok(actions[0].milestones.verified >= actions[0].milestones.dispatched)
    assert.ok(samples.some(s=>s.l===1))
    assert.equal(samples.at(-1).l,0)
    await assert.rejects(driver.resolveSelection('#text','missing words'), /not found/)
    await assert.rejects(driver.verifySelection('incorrect'), /mismatch/)
    await driver.move({x:700,y:500})
    assert.equal(await page.evaluate(()=>getSelection().toString()), 'Agents need good tools and useful feedback.')
  } finally {await browser.close()}
})
