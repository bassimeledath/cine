import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { resolveRuntime } from '../../src/runtime/host.mjs'
import { chromiumDriver } from '../../src/actions/chromium.mjs'
import { runActions } from '../../src/actions/runner.mjs'
import { captureChromium } from '../../src/capture/chromium.mjs'
import { installVirtualMicrophone } from '../../src/capture/microphone.mjs'

const fast = { moveMs:0, settleMs:0, dwellMs:0 }
const timing = { leadInMs:0, tailMs:0 }
async function browser() {
  const runtime = await resolveRuntime()
  return puppeteer.launch({executablePath:runtime.chrome,headless:true,args:['--mute-audio','--autoplay-policy=no-user-gesture-required']})
}
test('nested Shadow DOM: real hit testing, replacing input, value waits, and occlusion', async () => {
  const b = await browser()
  try {
    const p = await b.newPage()
    await p.setContent('<div id="host"></div>')
    await p.evaluate(() => {
      const root = document.querySelector('#host').attachShadow({mode:'open'})
      root.innerHTML = '<div id="inner"></div>'
      const nested = root.querySelector('#inner').attachShadow({mode:'open'})
      nested.innerHTML = '<input value="old"><button>Update</button><p>Pending</p>'
      nested.querySelector('button').onclick = () => nested.querySelector('p').textContent = nested.querySelector('input').value
    })
    const driver = chromiumDriver(p, await p.createCDPSession())
    await runActions([
      {...fast,type:'type',selector:'#host >>> input',text:'Updated',typing:{replace:true,mode:'instant'}},
      {type:'verify',selector:'#host >>> input',text:'Updated',dwellMs:0},
      {...fast,selector:'#host >>> button'},
      {type:'verify',selector:'#host >>> p',text:'Updated',dwellMs:0},
      {...fast,type:'selectText',selector:'#host >>> p',text:'Updated',dragMs:200},
      {type:'verify',selector:'#host >>> .absent',state:'hidden',dwellMs:0},
    ],driver,timing)
    await p.evaluate(()=>{
      const cover = document.createElement('div')
      cover.style='position:fixed;inset:0;background:black;z-index:999'
      document.body.append(cover)
    })
    await assert.rejects(driver.resolve('#host >>> button'), /covered/)
  } finally {await b.close()}
})
test('generic pointer drag moves a slider and releases before the next move', async () => {
  const b = await browser()
  try {
    const p = await b.newPage()
    await p.setContent('<input type="range" min="0" max="100" value="0" style="position:absolute;left:100px;top:100px;width:200px;margin:0">')
    const driver=chromiumDriver(p,await p.createCDPSession())
    await runActions([{...fast,type:'drag',from:{point:{x:108,y:108}},to:{point:{x:292,y:108}},dragMs:300}],driver,timing)
    assert.ok(Number(await p.$eval('input',el=>el.value))>90)
    await driver.move({x:120,y:108})
    assert.ok(Number(await p.$eval('input',el=>el.value))>90)
  } finally {await b.close()}
})
// A PCM sine fixture tests what the app actually receives, independently of any STT SDK.
function tone() {
  const rate=16000, samples=rate/2, wav=Buffer.alloc(44+samples*2)
  wav.write('RIFF'); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8)
  wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22)
  wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34)
  wav.write('data',36);wav.writeUInt32LE(samples*2,40)
  for(let i=0;i<samples;i++)wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/rate)*12000),44+i*2)
  return wav
}
test('virtual microphone delivers timed PCM, survives consumer restarts/navigation, and cleans up', async () => {
  const server=createServer((_,res)=>res.end('<title>Generic audio consumer</title>'))
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const dir=await mkdtemp(join(tmpdir(),'cine-mic-test-')), file=join(dir,'tone.wav')
  await writeFile(file,tone())
  const b=await browser()
  let mic
  try {
    const p=await b.newPage()
    mic=await installVirtualMicrophone(p)
    const url=`http://127.0.0.1:${server.address().port}`
    await p.goto(url)
    const consumer=()=>p.evaluate(async()=>{
      window.stream=await navigator.mediaDevices.getUserMedia({audio:true})
      const context=window.consumerContext=new AudioContext()
      await context.resume()
      const source=context.createMediaStreamSource(stream), analyser=context.createAnalyser()
      source.connect(analyser)
      window.received=[]
      const data=new Float32Array(analyser.fftSize)
      window.poll=setInterval(()=>{
        analyser.getFloatTimeDomainData(data)
        received.push({t:Date.now(),peak:Math.max(...data.map(Math.abs))})
      },10)
    })
    await assert.rejects(mic.play(file),/No active microphone consumer/)
    await consumer()
    const observed=[]
    await runActions([{type:'audioInput',file,id:'utterance',dwellMs:0}],chromiumDriver(p,await p.createCDPSession(),{microphone:mic}),{...timing,onAction:a=>observed.push(a)})
    const samples=await p.evaluate(()=>received), first=samples.find(s=>s.peak>.05)
    assert.ok(first,'real audio samples reach the consumer')
    assert.ok(Math.abs(first.t-observed[0].milestones.dispatched)<180,'recorded onset matches received audio')
    assert.equal(observed[0].durationMs,500)
    await p.evaluate(async()=>{clearInterval(poll);stream.getTracks().forEach(t=>t.stop());await consumerContext.close()})
    await consumer()
    await mic.play(file)
    assert.ok(await p.evaluate(()=>received.some(s=>s.peak>.05)))
    await p.reload()
    await consumer()
    const playing=mic.play(file)
    await new Promise(resolve=>setTimeout(resolve,100))
    await assert.rejects(mic.play(file),/already active/)
    await playing
    await assert.rejects(p.evaluate(()=>navigator.mediaDevices.getUserMedia({audio:true,video:true})),/audio-only/)
    await mic.dispose();mic=null
    assert.equal(await p.evaluate(()=>stream.getTracks()[0].readyState),'ended')
    await p.reload()
    assert.equal(await p.evaluate(()=>typeof window.__cineVirtualMicrophone),'undefined')
  } finally {
    await mic?.dispose().catch(()=>{})
    await b.close(); await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true})
  }
})


test('capture automatically enables audio input and records shadow anchors and onset metadata', async () => {
  const server=createServer((_,res)=>res.end(`<div id="host"></div><script>
    const root=document.querySelector('#host').attachShadow({mode:'open'});
    root.innerHTML='<p id="state">Starting</p>';
    (async()=>{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      const ctx=new AudioContext();await ctx.resume();
      const analyser=ctx.createAnalyser();ctx.createMediaStreamSource(stream).connect(analyser);
      root.querySelector('p').textContent='Listening';
      const data=new Float32Array(analyser.fftSize);
      setInterval(()=>{analyser.getFloatTimeDomainData(data);if(data.some(n=>Math.abs(n)>.05))root.querySelector('p').textContent='Heard audio';},10);
    })();
  </script>`))
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const dir=await mkdtemp(join(tmpdir(),'cine-mic-capture-'))
  try {
    const file=join(dir,'tone.wav');await writeFile(file,tone())
    const runtime=await resolveRuntime()
    const result=await captureChromium({
      url:`http://127.0.0.1:${server.address().port}`,runtime,
      actions:[{id:'ready',type:'waitFor',selector:'#host >>> #state',text:'Listening',dwellMs:0},{id:'audio',type:'audioInput',file,dwellMs:0},{id:'heard',type:'verify',selector:'#host >>> #state',text:'Heard audio',dwellMs:0}],
      anchorSelectors:['#host >>> #state'],videoPath:join(dir,'raw.mp4'),cursorPath:join(dir,'cursor.jsonl'),displayPoints:{w:640,h:480},fps:10,leadInMs:0,tailMs:0,
    })
    assert.ok(result.actions[1].milestones.dispatched>=0)
    assert.ok(result.actions[1].milestones.dispatched<result.durationMs)
    assert.equal(result.actions[1].durationMs,500)
    assert.ok(result.actions[2].milestones.verified>result.actions[1].milestones.dispatched)
    assert.ok(result.anchorTrack.some(s=>s.anchors['#host >>> #state']?.w>0))
    await assert.rejects(captureChromium({connectTo:'http://127.0.0.1:1',microphone:true,runtime}),/fresh headless/)
  }finally{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true})}

})
