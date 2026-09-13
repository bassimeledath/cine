import test from 'node:test'
import assert from 'node:assert/strict'
import {scrollGesture} from '../src/actions/scroll.mjs'

test('scroll gesture preserves signed fractional distances and instant opt-out', async () => {
  const steps=[]
  await scrollGesture({x:-23.25,y:80.5},async d=>steps.push(d),{durationMs:160})
  assert.ok(steps.length>3)
  assert.equal(steps.reduce((s,d)=>s+d.x,0),-23.25)
  assert.equal(steps.reduce((s,d)=>s+d.y,0),80.5)
  const instant=[]
  await scrollGesture({x:0,y:500},async d=>instant.push(d),{durationMs:0})
  assert.deepEqual(instant,[{x:0,y:500}])
  await assert.rejects(scrollGesture({x:0,y:1},()=>{},{durationMs:-1}),/Invalid/)
})
