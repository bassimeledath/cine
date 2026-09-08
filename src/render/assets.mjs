import { readFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'

export function loadAssets(settings, baseDir) {
  const assets = {}
  const types = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  }
  for (const key of ['backgroundImage', 'cursorImage']) {
    if (!settings[key]) continue
    const path = resolve(baseDir, settings[key])
    const mime = types[extname(path).toLowerCase()]
    if (!mime) throw new Error(`${key}: use PNG, JPEG, WebP, or SVG`)
    const data = readFileSync(path)
    if (data.length > 32 * 1024 * 1024) throw new Error(`${key} exceeds 32 MiB`)
    assets[key] = `data:${mime};base64,${data.toString('base64')}`
  }
  return assets
}
