export const DEFAULTS = {
  cursorSmoothing: true,
  cursorSize: 1.5,
  cursorType: 'arrow',
  cursorColor: '#ffffff',
  cursorHotspot: { x: 0, y: 0 },
  clickHighlight: true,
  padding: 48,
  cornerRadius: 12,
  backgroundType: 'gradient',
  backgroundGradientFrom: '#0e1720',
  backgroundGradientTo: '#234156',
  backgroundGradientAngle: 135,
  backgroundFit: 'cover',
  backgroundPosition: { x: 0.5, y: 0.5 },
  shadowEnabled: true,
  shadowBlur: 40,
  shadowIntensity: 0.5,
  shadowAngle: 90,
  shadowDistance: 8,
  accentColor: '#ffd666',
  brandColor: '#1d64f2',
  textColor: '#ffffff',
  mutedColor: '#9fb6cc',
  fontFamily: 'Arial, sans-serif',
}

export function validateSettings(settings = {}) {
  const supported = new Set([
    ...Object.keys(DEFAULTS),
    'backgroundImage',
    'cursorImage',
  ])
  for (const key of Object.keys(settings))
    if (!supported.has(key)) throw new Error(`Unknown setting: ${key}`)
  const s = { ...DEFAULTS, ...settings }
  if (!['gradient', 'solid', 'image'].includes(s.backgroundType))
    throw new Error('Invalid backgroundType')
  if (!['arrow', 'dot', 'crosshair', 'image'].includes(s.cursorType))
    throw new Error('Invalid cursorType')
  if (!['cover', 'contain'].includes(s.backgroundFit))
    throw new Error('Invalid backgroundFit')
  if (s.backgroundType === 'image' && !s.backgroundImage)
    throw new Error('Image background requires backgroundImage')
  if (s.cursorType === 'image' && !s.cursorImage)
    throw new Error('Image cursor requires cursorImage')
  for (const key of [
    'backgroundGradientFrom',
    'backgroundGradientTo',
    'cursorColor',
    'accentColor',
    'brandColor',
    'textColor',
    'mutedColor',
  ]) {
    if (!/^#[\da-f]{6}$/i.test(s[key]))
      throw new Error(`${key} must be a six-digit hex color`)
  }
  for (const key of [
    'padding',
    'cornerRadius',
    'shadowBlur',
    'shadowDistance',
  ]) {
    if (!Number.isFinite(s[key]) || s[key] < 0)
      throw new Error(`Invalid ${key}`)
  }
  if (!Number.isFinite(s.cursorSize) || s.cursorSize <= 0 || s.cursorSize > 10)
    throw new Error('cursorSize must be in (0,10]')
  for (const key of ['shadowIntensity'])
    if (!Number.isFinite(s[key]) || s[key] < 0 || s[key] > 1)
      throw new Error(`Invalid ${key}`)
  for (const key of ['backgroundGradientAngle', 'shadowAngle'])
    if (!Number.isFinite(s[key])) throw new Error(`Invalid ${key}`)
  for (const key of ['cursorSmoothing', 'clickHighlight', 'shadowEnabled'])
    if (typeof s[key] !== 'boolean') throw new Error(`Invalid ${key}`)
  for (const key of ['cursorHotspot', 'backgroundPosition']) {
    if (
      !s[key] ||
      !['x', 'y'].every(
        (axis) =>
          Number.isFinite(s[key][axis]) &&
          s[key][axis] >= 0 &&
          s[key][axis] <= 1,
      )
    ) {
      throw new Error(`${key} uses normalized x/y coordinates in [0,1]`)
    }
  }
  if (typeof s.fontFamily !== 'string' || !s.fontFamily.trim())
    throw new Error('fontFamily must be a nonempty CSS font family')
  return s
}
