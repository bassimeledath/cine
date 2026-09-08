export function createScene(root, { props, theme, height }) {
  root.style.cssText = `position:absolute;inset:0;display:flex;align-items:center;gap:40px;padding:8%;box-sizing:border-box;background:${theme.backgroundGradientFrom};font-family:${theme.fontFamily};color:${theme.textColor}`
  const num = document.createElement('b'),
    title = document.createElement('div')
  num.textContent = props.number ?? '01'
  title.textContent = props.title ?? 'The next chapter'
  num.style.cssText = `font-size:${height * 0.18}px;color:${theme.accentColor}`
  title.style.cssText = `font-size:${height * 0.065}px;max-width:70%`
  root.append(num, title)
  return {
    renderFrame({ timeMs }) {
      root.style.opacity = Math.min(1, timeMs / 350)
      num.style.transform = `translateX(${Math.max(0, 1 - timeMs / 500) * -40}px)`
    },
  }
}
