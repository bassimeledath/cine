import { createSceneHost } from './scenes.mjs'
import { createCaptions } from './captions.mjs'
import { createCanvasRenderer } from './canvas.mjs'
import { createOverlays } from './overlays.mjs'

let cfg, video, painter, overlays, captions, customScenes
const stage = document.getElementById('stage'),
  canvas = document.getElementById('c')
const root = document.getElementById('overlays'),
  leaders = document.getElementById('leaders')

async function decodeImage(url) {
  if (!url) return null
  const image = new Image()
  image.src = url
  try {
    await image.decode()
  } catch {
    throw new Error('Image asset could not be decoded')
  }
  return image
}

window.init = async function (config) {
  window.__ready = false
  captions?.dispose()
  await customScenes?.dispose()
  cfg = config
  if (video) {
    video.pause()
    video.removeAttribute('src')
    video.load()
  }
  root.querySelectorAll('.ov').forEach((el) => el.remove())
  leaders.replaceChildren()
  const scene = { width: (cfg.width * 1080) / cfg.height, height: 1080 },
    scale = cfg.height / 1080
  canvas.width = cfg.width
  canvas.height = cfg.height
  canvas.style.width = `${scene.width}px`
  canvas.style.height = `${scene.height}px`
  stage.style.width = `${scene.width}px`
  stage.style.height = '1080px'
  stage.style.transform = `scale(${scale})`
  leaders.setAttribute('viewBox', `0 0 ${scene.width} 1080`)
  for (const [property, key] of Object.entries({
    '--accent': 'accentColor',
    '--brand': 'brandColor',
    '--text': 'textColor',
    '--muted': 'mutedColor',
    '--font-family': 'fontFamily',
  })) {
    stage.style.setProperty(property, cfg.settings[key])
  }
  stage.style.setProperty(
    '--title-background',
    `linear-gradient(${cfg.settings.backgroundGradientAngle}deg, ${cfg.settings.backgroundGradientFrom}, ${cfg.settings.backgroundGradientTo})`,
  )
  const order = new Map(cfg.layers.map((l, i) => [l.id, i + 1]))
  const [background, cursorImage] = await Promise.all([
    decodeImage(cfg.assets.backgroundImage),
    decodeImage(cfg.assets.cursorImage),
  ])
  video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  video.playsInline = true
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Video load timed out')),
      15000,
    )
    video.onloadeddata = () => {
      clearTimeout(timer)
      resolve()
    }
    video.onerror = () => {
      clearTimeout(timer)
      reject(new Error('Video load failed'))
    }
    video.src = cfg.videoUrl
  })
  await document.fonts.ready
  painter = createCanvasRenderer({
    canvas,
    video,
    scene,
    scale,
    settings: cfg.settings,
    displayPoints: cfg.displayPoints,
    background,
    cursorImage,
  })
  overlays = createOverlays({
    overlayRoot: root,
    leaders,
    scene,
    settings: cfg.settings,
    displayPoints: cfg.displayPoints,
    layers: structuredClone(
      cfg.layers
        .filter((l) => l.type !== 'custom')
        .map((l) => ({ ...l, _order: order.get(l.id) ?? 0 })),
    ),
    layout: painter.layout,
    screenToOutput: painter.screenToOutput,
  })
  customScenes = await createSceneHost(
    root,
    (cfg.customScenes ?? []).map((l) => ({
      ...l,
      order: order.get(l.id) ?? 0,
    })),
    {
      width: scene.width,
      height: scene.height,
      fps: cfg.fps,
      theme: cfg.settings,
    },
  )
  captions = createCaptions(
    stage,
    cfg.captions ?? [],
    cfg.captionStyle,
    cfg.settings,
  )
  window.__ready = true
}

async function seekTo(ms) {
  const target = Math.max(0, Math.min(ms / 1000, video.duration - 0.001))
  if (Math.abs(video.currentTime - target) < 0.0001) return
  await new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer)
      video.removeEventListener('seeked', done)
      resolve()
    }
    const timer = setTimeout(() => {
      video.removeEventListener('seeked', done)
      reject(new Error(`Seek timed out at ${ms}`))
    }, 10000)
    video.addEventListener('seeked', done)
    video.currentTime = target
  })
}

window.step = async function (t) {
  if (!Number.isFinite(t) || t < 0 || t >= cfg.durationMs)
    throw new Error('Frame time is outside the timeline')
  const state =
    cfg.states[
      Math.min(cfg.states.length - 1, Math.floor((t * cfg.fps) / 1000 + 1e-7))
    ]
  if (state.active) await seekTo(state.sourceMs)
  painter.draw(state, cfg.clicks)
  let anchors = cfg.anchors
  if (state.active && cfg.anchorTrack.length) {
    const snapshot = cfg.anchorTrack.findLast((s) => s.t <= state.sourceMs)
    if (snapshot) anchors = snapshot.anchors
  }
  overlays.update(state.t, state.zoom, anchors)
  await customScenes.update(state.t)
  captions.update(state.t)
  return state
}
