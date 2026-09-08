from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json,html,math,shutil,sys
root=Path(sys.argv[1]) if len(sys.argv)>1 else Path(Path('/tmp/cine-round2-root').read_text().strip())
results=json.loads((root/'inspection/validation-results.json').read_text())
font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',15)
for r in results:
 name=r['name'];frames=sorted((root/'inspection'/f'{name}-decoded').glob('*.jpg'))
 chosen=[frames[round(i*(len(frames)-1)/15)] for i in range(16)]
 sheet=Image.new('RGB',(1280,4*210),'#10252b');draw=ImageDraw.Draw(sheet)
 for i,file in enumerate(chosen):
  im=Image.open(file);im.thumbnail((306,176));x=(i%4)*320;y=(i//4)*210
  sheet.paste(im,(x+(320-im.width)//2,y+22+(176-im.height)//2));draw.text((x+10,y+3),f'{(int(file.stem)-1)/2:.1f}s',font=font,fill='#d9eddf')
 sheet.save(root/'inspection'/f'{name}-contact.jpg',quality=88)
 boundary=sorted((root/'inspection'/f'{name}-boundaries').glob('*.jpg'),key=lambda p:(int(p.stem.split('-',1)[0]),int(p.stem.split('-',1)[1])))
 if boundary:
  rows=math.ceil(len(boundary)/3);b=Image.new('RGB',(1280,rows*270),'#10252b');d=ImageDraw.Draw(b)
  for i,file in enumerate(boundary):
   im=Image.open(file);im.thumbnail((415,235));x=i%3*426;y=i//3*270;b.paste(im,(x+(426-im.width)//2,y+25));d.text((x+10,y+3),file.stem,font=font,fill='#d9eddf')
  b.save(root/'inspection'/f'{name}-boundaries.jpg',quality=88)
desc={
'01-legacy':('Legacy comparison','Original click-driven framing and effect palette, using the same new capture.'),
'02-editorial-typing':('A quieter, directed demo','Visible typing, verified actions, editorial camera framing, and softer effects.'),
'03-narrated-scenes':('Narration meets scene code','MP3 narration, inserted cards, a held result screen, captions, and an original React outro.'),
'04-speed-narration':('Change the footage, keep the voice','A source trim and 2× section with narration and captions at natural speed. Grid cover chosen explicitly.'),
'05-portrait':('The portrait version','The same editable project in 720 × 1280, with captions and an image cover.'),
'06-action-narration':('Narration attached to an outcome','Speech begins at the observed save verification, followed by an editable React metric card.'),
'07-edited-audio-cover':('A targeted agent edit','One narration clip is quieter and a new original-code cover is selected. Capture is reused.'),
'08-preview-hold':('Preview only the changed scene','A short preview of the narration hold, evaluated using the complete movie timeline.'),
'09-custom-code':('Templates are editable code','A modified title, React metric and split templates, and an original React composition.'),
'10-typing-and-corrections':('Typing, Unicode, corrections','Text input, textarea, and rich text with visible typing, Unicode, and backspace edits.')}
cards=[]
for r in results:
 name=r['name'];title,text=desc[name];poster=f'videos/{name}.mp4.cover.png'
 if not (root/poster).exists():poster=f'inspection/{name}-decoded/003.jpg'
 cards.append(f'<article><h2>{html.escape(title)}</h2><video controls preload="metadata" poster="{poster}" src="videos/{name}.mp4"></video><p>{html.escape(text)}</p><footer>{r["width"]} × {r["height"]} · {r["durationMs"]/1000:.1f}s · <a href="{r["project"]}">Project</a> · <a href="inspection/{name}-contact.jpg">Inspection frames</a></footer></article>')
(root/'index.html').write_text('''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cine — Agent-authored demos</title><style>*{box-sizing:border-box}body{background:#102126;color:#e6f2eb;font:16px/1.55 system-ui;max-width:1450px;margin:auto;padding:40px}header{margin-bottom:30px}h1{font-size:42px;letter-spacing:-1px;margin:0}header p{max-width:900px;color:#adc6b9}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(380px,1fr));gap:24px}article{padding:22px;border:1px solid #345149;border-radius:18px;background:#18332f}h2{font-size:21px;margin:0 0 15px}video{width:100%;height:260px;object-fit:contain;background:#0a171a;border-radius:8px}p{color:#bdd1c6}footer{font-size:13px;color:#9eb7ac}a{color:#b8edcb}aside{margin:24px 0;padding:20px;border-radius:14px;background:#223d37}audio{display:block;margin:10px 0;width:min(100%,500px)}@media(max-width:600px){body{padding:20px}main{grid-template-columns:1fr}}</style><header><h1>Cine / made for an agent to direct.</h1><p>Custom scene code. Provider-independent narration. Captions, typing, and the cover you choose. All recording here ran headlessly; nothing plays automatically.</p><p><a href="README.md">Validation notes</a> · <a href="agent-authoring.md">Agent guide</a> · <a href="post-implementation-review.md">Independent review</a></p></header><aside><strong>Listen to the effect palette</strong><p>Legacy and subtle samples below. Timing, signal levels, and encoded audio alignment are measured; subjective listening was unavailable to this session.</p><label>Legacy effects</label><audio controls preload="metadata" src="audio/legacy-effects.wav"></audio><label>Subtle effects</label><audio controls preload="metadata" src="audio/subtle-effects.wav"></audio></aside><main>'''+''.join(cards)+'</main></html>')
shutil.copyfile('docs/agent-authoring.md',root/'agent-authoring.md')
shutil.copyfile('schemas/project-v2.schema.json',root/'project-v2.schema.json')
for p in (root/'scenes').iterdir():
 if p.is_dir():shutil.copyfile('src/scenes/types.d.ts',p/'types.d.ts')
print(root/'index.html')
