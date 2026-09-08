import { writeFileSync } from 'node:fs'
import { sceneAssets, buildScene } from '../scenes/build.mjs'
import { CineError } from '../core/errors.mjs'

export async function saveCover(page, plan, assetDir, path, config) {
  const cover = plan.cover ?? {
    type: 'frame',
    atMs: Math.min(
      plan.durationMs - 1000 / plan.fps,
      Math.max(0, plan.durationMs * 0.4),
    ),
  }
  const frame = async (at) => {
    if (!Number.isFinite(at) || at < 0 || at >= plan.durationMs)
      throw new CineError(
        'INVALID_COVER',
        'cover.atMs',
        'Frame must be inside the output video',
      )
    await page.evaluate((t) => window.step(t), at)
    return page.screenshot({ encoding: 'base64' })
  }
  if (cover.type === 'frame') {
    await frame(cover.atMs)
    await page.screenshot({ path })
  } else if (cover.type === 'scene') {
    const at = cover.atMs ?? 1000,
      durationMs = cover.durationMs ?? 3000
    if (
      !Number.isFinite(at) ||
      !Number.isFinite(durationMs) ||
      at < 0 ||
      at >= durationMs
    )
      throw new Error('Cover scene time must fit durationMs')
    const spec = { ...cover, id: 'cover', startMs: 0, endMs: durationMs }
    const customScenes = cover.entry ? [await buildScene(spec, assetDir)] : []
    const layers = cover.entry
      ? []
      : [
          {
            ...cover.props,
            type: cover.template ?? 'title',
            startMs: 0,
            endMs: durationMs,
          },
        ]
    await page.evaluate((c) => window.init(c), {
      ...config,
      durationMs,
      states: [{ ...plan.states[0], t: at, active: false, sourceMs: null }],
      layers,
      customScenes,
      captions: [],
    })
    await page.evaluate((t) => window.step(t), at)
    await page.screenshot({ path })
  } else if (cover.type === 'image' || cover.type === 'grid') {
    let images, columns
    if (cover.type === 'image') {
      images = [sceneAssets({ cover: cover.file }, assetDir).cover]
      columns = 1
    } else {
      if (
        !Array.isArray(cover.frames) ||
        !cover.frames.length ||
        cover.frames.length > 25
      )
        throw new Error('Cover grid needs 1–25 output timestamps')
      columns = cover.columns ?? Math.ceil(Math.sqrt(cover.frames.length))
      if (!Number.isInteger(columns) || columns < 1 || columns > 25)
        throw new Error('Invalid grid column count')
      images = []
      for (const at of cover.frames)
        images.push('data:image/png;base64,' + (await frame(at)))
    }
    await page.evaluate(
      async ({ images, columns, width, height, fit }) => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        document.body.replaceChildren(canvas)
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = '#111c20'
        ctx.fillRect(0, 0, width, height)
        const rows = Math.ceil(images.length / columns),
          w = width / columns,
          h = height / rows
        for (const [i, src] of images.entries()) {
          const img = new Image()
          img.src = src
          await img.decode()
          const scale = (fit === 'cover' ? Math.max : Math.min)(
              w / img.width,
              h / img.height,
            ),
            x = (i % columns) * w,
            y = Math.floor(i / columns) * h
          ctx.save()
          ctx.beginPath()
          ctx.rect(x, y, w, h)
          ctx.clip()
          ctx.drawImage(
            img,
            x + (w - img.width * scale) / 2,
            y + (h - img.height * scale) / 2,
            img.width * scale,
            img.height * scale,
          )
          ctx.restore()
        }
      },
      {
        images,
        columns,
        width: plan.width,
        height: plan.height,
        fit: cover.fit ?? 'contain',
      },
    )
    await page.screenshot({ path })
  } else
    throw new CineError(
      'INVALID_COVER',
      'cover.type',
      'Use frame, image, scene, or grid',
    )
  writeFileSync(
    path + '.json',
    JSON.stringify({ cover, width: plan.width, height: plan.height }, null, 2) +
      '\n',
  )
  return path
}
