import React from 'react'
export default function Split({ props, theme, timeMs, height }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        fontFamily: theme.fontFamily,
        color: theme.textColor,
      }}
    >
      {[props.left ?? 'Before', props.right ?? 'After'].map((text, i) => (
        <section
          key={i}
          style={{
            display: 'grid',
            placeContent: 'center',
            padding: '10%',
            fontSize: height * 0.07,
            background: i
              ? theme.backgroundGradientTo
              : theme.backgroundGradientFrom,
            opacity: Math.min(1, Math.max(0, (timeMs - i * 150) / 400)),
          }}
        >
          {text}
        </section>
      ))}
    </div>
  )
}
