import { easeOut } from '../sdk.mjs'
export function createScene(root, { props, theme, width, height }) {
  Object.assign(root.style, {
    position: 'absolute',
    inset: 0,
    display: 'grid',
    placeContent: 'center',
    textAlign: 'center',
    padding: '8%',
    boxSizing: 'border-box',
    fontFamily: theme.fontFamily,
    color: theme.textColor,
    background: `linear-gradient(135deg,${theme.backgroundGradientFrom},${theme.backgroundGradientTo})`,
  })
  const kicker = document.createElement('div'),
    head = document.createElement('div'),
    sub = document.createElement('div')
  kicker.textContent = props.kicker ?? 'CINE'
  head.textContent = props.head ?? 'Your next release'
  sub.textContent = props.sub ?? 'A closer look at what matters.'
  Object.assign(kicker.style, {
    fontSize: `${height * 0.025}px`,
    letterSpacing: '.18em',
    color: theme.accentColor,
  })
  Object.assign(head.style, {
    fontSize: `${Math.min(width * 0.065, height * 0.085)}px`,
    fontWeight: 750,
    lineHeight: 1.05,
    margin: '22px 0',
    overflowWrap: 'anywhere',
  })
  Object.assign(sub.style, {
    fontSize: `${height * 0.032}px`,
    color: theme.mutedColor,
  })
  root.append(kicker, head, sub)
  return {
    renderFrame({ timeMs, durationMs }) {
      const a = easeOut(timeMs / 600),
        b = easeOut((durationMs - timeMs) / 400)
      root.style.opacity = Math.min(a, b)
      head.style.transform = `translateY(${(1 - a) * 30}px)`
    },
    dispose() {
      root.replaceChildren()
    },
  }
}
