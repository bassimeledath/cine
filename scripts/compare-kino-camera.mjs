import {build} from 'esbuild'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {loadCapture} from '../src/capture/artifacts.mjs'
import {compileProject} from '../src/core/project.mjs'
import {kinoFrames} from '../src/core/kino-policy.mjs'
import {SPRING_PRESETS} from '../src/springs.mjs'
const [kinoRoot,manifest,out]=process.argv.slice(2)
if(!kinoRoot||!manifest||!out)throw new Error('Usage: compare-kino-camera.mjs KINO_ROOT CAPTURE_MANIFEST REPORT_JSON')
const engine=resolve(kinoRoot,'src/renderer/engine'),dir=mkdtempSync(join(tmpdir(),'cine-kino-reference-'))
try{
 const entry=`export * from ${JSON.stringify(join(engine,'auto-zoom.ts'))};export * from ${JSON.stringify(join(engine,'spring-camera.ts'))};export * from ${JSON.stringify(join(engine,'composition-geometry.ts'))};`
 const module=join(dir,'reference.mjs')
 await build({stdin:{contents:entry,resolveDir:engine},bundle:true,platform:'node',format:'esm',outfile:module,logLevel:'silent'})
 const upstream=await import(pathToFileURL(module).href),capture=loadCapture(resolve(manifest)),frames=kinoFrames(capture.frames,capture.displayPoints),results=[]
 for(const fps of [30,60]){
  const plan=compileProject({schemaVersion:2,output:{width:1280,height:720,fps},scenes:[{id:'all',kind:'source'}],camera:{policy:'kino'}},capture)
  const ranges=upstream.generateAutoZoomRanges(frames,capture.durationMs),camera=new upstream.SpringCamera()
  assert.deepEqual(plan.camera.kinoRanges.map(({id,...r})=>r),ranges.map(({id,...r})=>r))
  let maxError=0
  for(const s of plan.states){
   const target=upstream.computeCameraTarget(upstream.findActiveZoomRange(ranges,s.sourceMs),frames,s.sourceMs)
   camera.update(target.x,target.y,target.zoom,1/fps,SPRING_PRESETS.screen,SPRING_PRESETS.zoom)
   upstream.clampCameraToZoom(camera)
   maxError=Math.max(maxError,Math.abs(s.zoom-camera.zoom),Math.abs(s.focus.x/capture.displayPoints.w-.5-camera.x),Math.abs(s.focus.y/capture.displayPoints.h-.5-camera.y))
  }
  assert.ok(maxError<1e-10,`Kino drift: ${maxError}`)
  results.push({fps,frames:plan.states.length,ranges:ranges.map(({id,...r})=>r),maxNormalizedError:maxError})
 }
 const sources=['auto-zoom.ts','spring-camera.ts','composition-geometry.ts'].map(file=>({file,sha256:createHash('sha256').update(readFileSync(join(engine,file))).digest('hex')}))
 writeFileSync(out,JSON.stringify({comparison:'Current local Kino source compiled independently; same normalized cursor samples and frame cadence; camera states, not compositor pixels',sources,results},null,2)+'\n')
 console.log(JSON.stringify(results))
}finally{rmSync(dir,{recursive:true,force:true})}
