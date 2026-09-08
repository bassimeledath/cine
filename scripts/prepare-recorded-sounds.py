"""Prepare short, varied physical key/mouse samples from the documented CC0 recordings.
Input: sources directory containing decoded 48 kHz mono WAVs and sources.json.
No network access or playback. Intervals are explicit and provenance is retained.
"""
import sys,wave,json,hashlib,math
from pathlib import Path
import numpy as np
source=Path(sys.argv[1]);dest=Path(sys.argv[2]);dest.mkdir(parents=True,exist_ok=True)
# Isolated key transients in the source, preserving their natural timbre/decay.
intervals=[(1.55,1.66),(1.855,1.95),(2.09,2.20),(2.80,2.92),(4.31,4.42),(5.235,5.34),(5.83,5.94),(6.005,6.115)]
entries=[]
for name,spans,peak in [('keyboard',intervals,.12),('mouse',[(.377,.535)],.15)]:
 with wave.open(str(source/(name+'.wav'))) as f:
  assert f.getframerate()==48000 and f.getnchannels()==1 and f.getsampwidth()==2
  data=np.frombuffer(f.readframes(f.getnframes()),dtype='<i2').astype(np.float64)/32768
 for i,(start,end) in enumerate(spans):
  a=data[round(start*48000):round(end*48000)].copy();a-=np.mean(a)
  # Gentle lowpass removes brittle HF content; 2 ms / 12 ms fades avoid cut clicks.
  alpha=1-math.exp(-2*math.pi*6500/48000);state=0
  for j in range(len(a)):state+=alpha*(a[j]-state);a[j]=state
  a[:96]*=np.linspace(0,1,96);a[-576:]*=np.linspace(1,0,576)
  a*=peak/np.max(np.abs(a))
  filename=f'key-{i+1}.wav' if name=='keyboard' else 'mouse.wav'
  with wave.open(str(dest/filename),'wb') as w:
   w.setnchannels(1);w.setsampwidth(2);w.setframerate(48000);w.writeframes((a*32767).astype('<i2').tobytes())
  entries.append({'file':filename,'source':name,'fromSeconds':start,'toSeconds':end,'sha256':hashlib.sha256((dest/filename).read_bytes()).hexdigest()})
metadata=json.loads((source/'sources.json').read_text())
for s in metadata:s.pop('file',None);s['sourceSHA256']=hashlib.sha256((source/(s['name']+'.mp3')).read_bytes()).hexdigest()
(dest/'provenance.json').write_text(json.dumps({'sources':metadata,'processing':'48k mono PCM; fixed intervals; DC removal; 6.5kHz lowpass; 2/12ms fades; fixed peak normalization. No synthesized audio.','samples':entries},indent=2)+'\n')
