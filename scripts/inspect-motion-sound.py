import json,subprocess,wave,math,html,shutil
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFont
root=Path('/Users/bassime/Downloads/cine-motion-sound-2026-09-08')
ffmpeg=json.loads(Path('/tmp/cine-sound-runtime.json').read_text())['ffmpeg']
results=json.loads((root/'inspection/render-results.json').read_text())
assert len(results)==3
font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',15)
checks=[]
for row in results:
 name=row['name'];video=root/'videos'/f'{name}.mp4';frames=root/'inspection'/f'{name}-decoded';frames.mkdir(exist_ok=True)
 subprocess.run([ffmpeg,'-v','error','-y','-i',str(video),'-vf','fps=2,scale=640:-2','-q:v','3',str(frames/'%03d.jpg')],check=True)
 actual=np.frombuffer(subprocess.check_output([ffmpeg,'-v','error','-i',str(video),'-vn','-ac','1','-ar','48000','-f','f32le','-']),dtype='<f4')
 expected=np.frombuffer(subprocess.check_output([ffmpeg,'-v','error','-i',str(root/'audio'/f'{name}-recorded.wav'),'-ac','1','-ar','48000','-f','f32le','-']),dtype='<f4')
 length=min(len(actual),len(expected));best=(-1,None)
 for lag in range(-1200,1201,48):
  x=expected[1200:length-1200:8];y=actual[1200+lag:length-1200+lag:8];corr=float(np.dot(x,y)/math.sqrt(np.dot(x,x)*np.dot(y,y)))
  if corr>best[0]:best=(corr,lag/48)
 assert best[0]>.9 and abs(best[1])<=1
 peak=float(np.max(abs(actual)));assert peak<1
 checks.append({'name':name,'audioCorrelation':best[0],'offsetMs':best[1],'peak':peak})
 files=sorted(frames.glob('*.jpg'));sheet=Image.new('RGB',(1280,840),'#10252b');d=ImageDraw.Draw(sheet)
 for i in range(16):
  f=files[round(i*(len(files)-1)/15)];im=Image.open(f);im.thumbnail((306,176));x=i%4*320;y=i//4*210;sheet.paste(im,(x+(320-im.width)//2,y+24));d.text((x+8,y+3),f'{(int(f.stem)-1)/2:.1f}s',font=font,fill='white')
 sheet.save(root/'inspection'/f'{name}-contact.jpg',quality=90)
subprocess.run([ffmpeg,'-v','error','-y','-i',str(root/'videos/before-typing.mp4'),'-vn',str(root/'audio/before-typing.wav')],check=True)
(root/'inspection/media-checks.json').write_text(json.dumps(checks,indent=2)+'\n')
cards=[]
for name,title in [('before-workflow','Before: repeated editorial zooms'),('workflow','After: Kino camera + recorded input'),('before-typing','Before: synthesized typing'),('typing','After: varied recorded key presses'),('narrated','Narrated example with the Kino camera')]:
 poster=root/'videos'/f'{name}.mp4.cover.png'
 if not poster.exists():
  subprocess.run([ffmpeg,'-v','error','-y','-ss','3.5','-i',str(root/'videos'/f'{name}.mp4'),'-frames:v','1',str(poster)],check=True)
 cards.append(f'<article><h2>{title}</h2><video controls preload="metadata" poster="videos/{name}.mp4.cover.png" src="videos/{name}.mp4"></video></article>')
(root/'index.html').write_text('''<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Cine — Kino motion and recorded sound</title><style>*{box-sizing:border-box}body{margin:40px auto;max-width:1300px;padding:0 24px;background:#102126;color:#e4f0e8;font:16px/1.6 system-ui}h1{font-size:36px;letter-spacing:-1px}h2{font-size:19px}p{max-width:950px;color:#b8ccc1}main{display:grid;grid-template-columns:1fr 1fr;gap:24px}article,aside{padding:20px;border:1px solid #36564c;border-radius:14px;background:#19342e;margin-bottom:24px}video{width:100%;background:#071715}audio{display:block;width:min(100%,500px);margin:8px 0 18px}a{color:#b8edcb}@media(max-width:700px){main{grid-template-columns:1fr}}</style><h1>Kino motion. Recorded input sounds.</h1><p>The same captures, rerendered. The workflow now has one sustained zoom range, from 1.785s to 13.133s. Camera ranges, targets, spring updates and clamping match the current local Kino source at 30 and 60 FPS. Cine still has its own compositor and scene timeline.</p><p>Eight physical MacBook key samples, recorded mouse input, varied levels, lower sound density, and no automatic whooshes. No autoplay. <a href="README.md">Notes and provenance</a> · <a href="inspection/kino-parity.json">Kino comparison</a></p><aside><h2>Hear the typing change</h2><label>Before — synthesized</label><audio controls preload="metadata" src="audio/before-typing.wav"></audio><label>After — physical recorded keys</label><audio controls preload="metadata" src="audio/typing-recorded.wav"></audio><p>Audio timing and signal levels were checked; this session cannot audition audio subjectively.</p></aside><main>'''+''.join(cards)+'</main></html>')
print(json.dumps(checks,indent=2))
