import React from 'react'
export default function Metric({ timeMs, props, theme, height }) {
  const p = Math.min(1, timeMs / 900),
    value = Math.round((props.value ?? 98) * p)
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeContent: 'center',
        textAlign: 'center',
        background: theme.backgroundGradientFrom,
        color: theme.textColor,
        fontFamily: theme.fontFamily,
      }}
    >
      <div style={{ fontSize: height * 0.025, color: theme.mutedColor }}>
        {props.label ?? 'SUCCESS RATE'}
      </div>
      <strong style={{ fontSize: height * 0.22, color: theme.accentColor }}>
        {value}
        {props.unit ?? '%'}
      </strong>
      <div style={{ fontSize: height * 0.035 }}>
        {props.caption ?? 'Ready for what comes next.'}
      </div>
    </div>
  )
}
