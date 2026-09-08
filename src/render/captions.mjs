/** Caption DOM is driven by output frame time, including during held footage. */
export function createCaptions(root, cues, settings = {}, theme = {}) {
  const el = document.createElement('div')
  el.className = 'cine-captions'
  Object.assign(el.style, {
    position: 'absolute',
    left: '8%',
    right: '8%',
    bottom: `${settings.bottomPercent ?? 7}%`,
    textAlign: 'center',
    fontFamily: theme.fontFamily ?? 'Arial, sans-serif',
    fontSize: `${settings.fontSize ?? 36}px`,
    lineHeight: '1.35',
    color: settings.color ?? '#ffffff',
    pointerEvents: 'none',
    zIndex: '1000',
  })
  root.append(el)
  return {
    update(t) {
      el.replaceChildren()
      if (settings.enabled === false) return
      for (const cue of cues.filter((c) => t >= c.startMs && t < c.endMs)) {
        const line = document.createElement('div')
        Object.assign(line.style, {
          margin: '4px auto',
          width: 'fit-content',
          maxWidth: '100%',
          padding: '8px 16px',
          background: 'rgba(0,0,0,.72)',
          borderRadius: '10px',
          whiteSpace: 'pre-wrap',
        })
        if (settings.wordHighlight && cue.words?.length) {
          for (const word of cue.words) {
            const span = document.createElement('span')
            span.textContent = word.text + ' '
            span.style.color =
              t >= word.startMs && t < word.endMs
                ? (settings.highlightColor ?? theme.accentColor ?? '#ffd666')
                : 'inherit'
            line.append(span)
          }
        } else line.textContent = cue.text
        el.append(line)
      }
    },
    dispose() {
      el.remove()
    },
  }
}
