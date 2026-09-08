import {readFileSync,writeFileSync,copyFileSync} from 'node:fs'
import {join} from 'node:path'
import {renderProject} from '../src/projects.mjs'
import {prepareProject,describeProject} from '../src/authoring.mjs'
import {resolveRuntime} from '../src/runtime/host.mjs'
import {mixAudioPlan} from '../src/media/clips.mjs'
import {writeWav} from '../src/media/audio.mjs'
const root=process.argv[2]??'/Users/bassime/Downloads/cine-motion-sound-2026-09-08',runtime=await resolveRuntime()
const results=[]
for(const name of ['workflow','typing','narrated']){
 const path=join(root,'projects',name+'.json'),prepared=await prepareProject(path,{runtime})
 await renderProject(path,{runtime,outPath:join(root,'videos',name+'.mp4'),inspectionDir:join(root,'inspection',name)})
 const mix=mixAudioPlan(prepared.plan,prepared.media)
 writeWav(join(root,'audio',name+'-recorded.wav'),mix)
 writeFileSync(join(root,'inspection',name+'-resolved.json'),JSON.stringify(describeProject(prepared),null,2)+'\n')
 results.push({name,frames:prepared.plan.states.length,durationMs:prepared.plan.states.length/prepared.plan.fps*1000,ranges:prepared.plan.camera.kinoRanges?.map(r=>({startMs:r.startMs,endMs:r.endMs})),keySamples:[...new Set(prepared.plan.audioCues.filter(c=>c.sound.startsWith('recordedKey')).map(c=>c.sound))],transitionCues:prepared.plan.audioCues.filter(c=>c.sound.includes('Whoosh')).length})
 writeFileSync(join(root,'inspection/render-results.json'),JSON.stringify(results,null,2)+'\n')
}
