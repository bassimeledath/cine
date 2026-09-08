/** Isolated styles/DOM and a bounded frame protocol; no Node access in scene code. */
export async function createSceneHost(root, specs, context) {
  const instances = []
  try {
    for (const spec of specs) {
      const frame = document.createElement('iframe')
      frame.setAttribute('sandbox', 'allow-scripts')
      frame.setAttribute('title', spec.id)
      frame.style.cssText =
        'position:absolute;inset:0;width:100%;height:100%;border:0;pointer-events:none;background:transparent;visibility:hidden'
      frame.style.zIndex = String(spec.order ?? 0)
      const pending = new Map()
      let serial = 0
      const receive = (event) => {
        if (event.source !== frame.contentWindow) return
        const p = pending.get(event.data?.id)
        if (!p) return
        pending.delete(event.data.id)
        clearTimeout(p.timer)
        event.data.error
          ? p.reject(
              new Error(
                `Scene ${spec.id} (${spec.entry}): ${event.data.error}`,
              ),
            )
          : p.resolve()
      }
      window.addEventListener('message', receive)
      const call = (type, data) =>
        new Promise((resolve, reject) => {
          const id = ++serial,
            timer = setTimeout(() => {
              pending.delete(id)
              reject(
                new Error(
                  `Scene ${spec.id} (${spec.entry}): ${type} timed out`,
                ),
              )
            }, 10000)
          pending.set(id, { resolve, reject, timer })
          frame.contentWindow.postMessage({ cine: true, id, type, data }, '*')
        })
      const escape = (code) => code.replace(/<\/script/gi, '<\\/script')
      const runtime = `let instance,context;function random(seed=1){let n=seed>>>0;return()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967295}};addEventListener('message',async event=>{const m=event.data;if(!m?.cine||event.source!==parent)return;try{if(m.type==='init'){context=m.data;context.random=random(context.seed??1);const factory=globalThis.CineSceneModule?.createScene??globalThis.createScene;if(!factory&&${!spec.html})throw new Error('Module did not export createScene');instance=await (factory??(()=>({})))(document.getElementById('scene-root'),context);await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()))}else if(m.type==='frame'){await instance.renderFrame?.(m.data);await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()))}else if(m.type==='dispose')await instance.dispose?.();parent.postMessage({id:m.id},'*')}catch(e){parent.postMessage({id:m.id,error:e.stack??String(e)},'*')}});`
      // Static HTML can opt into animation by defining window.createScene.
      const markup = spec.html ?? '<div id="scene-root"></div>'
      const html = markup.includes('id="scene-root"')
        ? markup
        : `<div id="scene-root">${markup}</div>`
      const loaded = new Promise((resolve) => (frame.onload = resolve))
      frame.srcdoc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}*{box-sizing:border-box}${spec.css ?? ''}</style>${html}<script>${escape(spec.code ?? '')}</script><script>${escape(runtime)}</script>`
      root.append(frame)
      const instance = {
        frame,
        call,
        spec,
        dispose() {
          window.removeEventListener('message', receive)
          for (const p of pending.values()) {
            clearTimeout(p.timer)
            p.reject(new Error(`Scene ${spec.id} disposed`))
          }
          pending.clear()
          frame.remove()
        },
      }
      instances.push(instance)
      await loaded
      await call('init', {
        ...context,
        props: spec.props ?? {},
        assets: spec.assets ?? {},
        seed: spec.seed ?? 1,
      })
    }
    return {
      async update(t) {
        for (const { frame, call, spec } of instances) {
          const visible = t >= spec.startMs && t < spec.endMs
          frame.style.visibility = visible ? 'visible' : 'hidden'
          if (visible)
            await call('frame', {
              timeMs: t - spec.startMs,
              outputTimeMs: t,
              durationMs: spec.endMs - spec.startMs,
              frame: Math.floor(((t - spec.startMs) * context.fps) / 1000),
            })
        }
      },
      async dispose() {
        await Promise.allSettled(instances.map((i) => i.call('dispose')))
        for (const instance of instances) instance.dispose()
      },
    }
  } catch (error) {
    for (const instance of instances) instance.dispose()
    throw error
  }
}
