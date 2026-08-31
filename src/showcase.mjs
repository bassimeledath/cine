// An example of what the layer timeline looks like once capture is done.
//
// Everything here is data — no rendering code. Note where the numbers come
// from: click timestamps are read out of the captured cursor track and anchor
// points out of the captured element rects, so the overlays are pinned to what
// actually happened rather than to hand-counted stopwatch values. That's the
// part a general-purpose video tool can't do, because it never saw the capture.

import { readFileSync } from 'node:fs'
import { autoCues } from './audio.mjs'

/** Rising-edge click extraction, in video time. */
export function clicksFrom(cursorPath, videoT0) {
  const frames = readFileSync(cursorPath, 'utf8').trim().split('\n').filter(Boolean)
    .map((l) => JSON.parse(l))
  const out = []
  let prev = false
  for (const f of frames) {
    if (f.l && !prev) out.push({ t: f.t - videoT0, x: f.x, y: f.y })
    prev = !!f.l
  }
  return out
}

const TITLE_MS = 3000
const LEAD_IN = 2600   // screen starts here; the title fades out over the overlap
const OUTRO_MS = 2600

export function buildShowcase({ cursorPath, videoT0, durationMs, anchors, zoomRanges }) {
  const clicks = clicksFrom(cursorPath, videoT0)
  if (clicks.length < 4) throw new Error(`showcase expects 4 clicks, got ${clicks.length}`)
  /** video time -> timeline time */
  const T = (vt) => LEAD_IN + vt
  const [sync, deploy, services, incidents] = clicks.map((c) => T(c.t))
  const screenEnd = LEAD_IN + durationMs
  const at = (sel) => anchors[sel] ?? null

  const layers = [
    {
      type: 'screen',
      startMs: LEAD_IN,
      endMs: screenEnd,
      sourceOffsetMs: 0,
    },
    {
      type: 'title',
      startMs: 0,
      endMs: TITLE_MS,
      motion: 'zoom',
      enterMs: 700,
      exitMs: 420,
      kicker: 'Meridian · v2.4',
      head: 'Ship it in four clicks',
      sub: 'Deploy pipeline walkthrough',
    },
    {
      type: 'badge',
      startMs: TITLE_MS + 200,
      endMs: screenEnd - 400,
      text: 'captured headlessly',
    },

    // --- chapter markers, one per beat -------------------------------------
    { type: 'lower', startMs: sync - 800, endMs: sync + 2100, num: '1', text: 'Sync with origin' },
    { type: 'lower', startMs: deploy - 800, endMs: deploy + 2600, num: '2', text: 'Queue a deploy' },
    { type: 'lower', startMs: services - 800, endMs: services + 1900, num: '3', text: 'Browse services' },
    { type: 'lower', startMs: incidents - 800, endMs: incidents + 2200, num: '4', text: 'Open incidents' },

    // --- beat 1: call out the metric the click actually changed ------------
    {
      type: 'callout',
      startMs: sync + 750,
      endMs: sync + 2150,
      anchor: at('#m2'),
      place: 'below',
      text: '99.1%',
      sub: 'up from 98.4%',
    },

    // --- beat 2: two anchored overlays tracking the same camera move -------
    {
      type: 'toast',
      tone: 'good',
      startMs: deploy + 420,
      endMs: deploy + 2500,
      anchor: at('#list .row:first-child'),
      place: 'below',
      icon: '✓',
      title: 'Deploy queued',
      body: 'api-gateway · build #4183',
    },
    {
      type: 'callout',
      startMs: deploy + 700,
      endMs: deploy + 2400,
      anchor: at('#m3'),
      place: 'above',
      text: '7 → 8',
      sub: 'queue depth',
    },

    // --- beat 4: a warning-toned toast on the sidebar ----------------------
    {
      type: 'toast',
      tone: 'warn',
      startMs: incidents + 500,
      endMs: incidents + 2300,
      anchor: at('.item[data-view="Incidents"]'),
      place: 'right',
      icon: '!',
      title: '2 open incidents',
      body: 'worker-pool degraded for 14m',
    },

    {
      type: 'outro',
      startMs: screenEnd - 250,
      endMs: screenEnd + OUTRO_MS,
      motion: 'zoom',
      enterMs: 520,
      exitMs: 700,
      kicker: 'cine',
      head: 'No display. No human.',
      sub: 'One command, start to finish.',
    },
  ].filter((l) => !('anchor' in l) || l.anchor)

  // --- sound ---------------------------------------------------------------
  // Clicks and camera moves are derived from the capture; the rest is authored
  // alongside the layers that need them.
  const cues = [
    { sound: 'pad', atMs: 0, gain: 1 },
    ...autoCues({ clicks, zoomRanges, offsetMs: LEAD_IN }),
  ]
  for (const l of layers) {
    if (l.type === 'toast') cues.push({ sound: 'pop', atMs: l.startMs, gain: 0.85 })
    if (l.type === 'callout') cues.push({ sound: 'pop', atMs: l.startMs, gain: 0.4 })
    if (l.type === 'outro') cues.push({ sound: 'chime', atMs: l.startMs + 260, gain: 0.9 })
  }

  return { layers, audioCues: cues }
}
