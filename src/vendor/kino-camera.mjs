// Snapshot of the local Kino camera algorithms. See kino-camera-provenance.json.
// Generated with esbuild; no runtime dependency on the Kino checkout.

// ../kino/src/renderer/engine/auto-zoom.ts
function generateAutoZoomRanges(cursorFrames, duration, defaultZoom = 1.5, defaultSnapToEdgesRatio = 0.25) {
  const clicks = cursorFrames.filter((f) => f.type === "click-down").map((f) => ({ t: f.t, x: f.x, y: f.y }));
  if (clicks.length === 0) return [];
  const LEAD_IN_MS = 300;
  const HOLD_AFTER_MS = 2500;
  const MERGE_GAP_MS = 2500;
  const MIN_DURATION_MS = 1e3;
  const rawRanges = clicks.map((click) => ({
    startMs: Math.max(0, click.t - LEAD_IN_MS),
    endMs: Math.min(duration, click.t + HOLD_AFTER_MS)
  }));
  rawRanges.sort((a, b) => a.startMs - b.startMs);
  const merged = [];
  for (const range of rawRanges) {
    const last = merged[merged.length - 1];
    if (last && range.startMs <= last.endMs + MERGE_GAP_MS) {
      last.endMs = Math.max(last.endMs, range.endMs);
    } else {
      merged.push({ ...range });
    }
  }
  return merged.map((range) => {
    const dur = range.endMs - range.startMs;
    if (dur < MIN_DURATION_MS) {
      range.endMs = Math.min(duration, range.startMs + MIN_DURATION_MS);
    }
    return {
      id: crypto.randomUUID(),
      startMs: range.startMs,
      endMs: range.endMs,
      zoom: defaultZoom,
      type: "auto",
      snapToEdgesRatio: defaultSnapToEdgesRatio,
      disabled: false
    };
  });
}
function fillGapsWithSystemRanges(ranges, duration, zoomLevel = 1.2, snapToEdgesRatio = 0.25) {
  const enabled = ranges.filter((r) => !r.disabled);
  if (enabled.length === 0) return ranges;
  const sorted = [...enabled].sort((a, b) => a.startMs - b.startMs);
  const systemRanges = [];
  if (sorted[0].startMs > 1) {
    systemRanges.push({
      id: crypto.randomUUID(),
      startMs: 0,
      endMs: sorted[0].startMs - 1,
      zoom: zoomLevel,
      type: "auto",
      snapToEdgesRatio,
      disabled: false,
      isSystem: true
    });
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const gapStart = sorted[i].endMs + 1;
    const gapEnd = sorted[i + 1].startMs - 1;
    if (gapEnd > gapStart) {
      systemRanges.push({
        id: crypto.randomUUID(),
        startMs: gapStart,
        endMs: gapEnd,
        zoom: zoomLevel,
        type: "auto",
        snapToEdgesRatio,
        disabled: false,
        isSystem: true
      });
    }
  }
  const lastEnd = sorted[sorted.length - 1].endMs;
  if (lastEnd < duration - 1) {
    systemRanges.push({
      id: crypto.randomUUID(),
      startMs: lastEnd + 1,
      endMs: duration,
      zoom: zoomLevel,
      type: "auto",
      snapToEdgesRatio,
      disabled: false,
      isSystem: true
    });
  }
  return [...ranges, ...systemRanges].sort((a, b) => a.startMs - b.startMs);
}
function clusterCursorTarget(cursorFrames, zoomRange, atMs, zoom = 1) {
  const rangeFrames = cursorFrames.filter(
    (f) => f.t >= zoomRange.startMs && f.t <= zoomRange.endMs
  );
  if (rangeFrames.length === 0) {
    return { x: 0.5, y: 0.5 };
  }
  const frames = rangeFrames;
  if (zoomRange.manualTarget) {
    return zoomRange.manualTarget;
  }
  const areaW = 1 / zoom * 0.5;
  const areaH = 1 / zoom * 0.7;
  const clusters = [];
  for (const frame of frames) {
    const current = clusters[clusters.length - 1];
    if (current) {
      const newMinX = Math.min(current.minX, frame.x);
      const newMaxX = Math.max(current.maxX, frame.x);
      const newMinY = Math.min(current.minY, frame.y);
      const newMaxY = Math.max(current.maxY, frame.y);
      if (newMaxX - newMinX <= areaW && newMaxY - newMinY <= areaH) {
        current.minX = newMinX;
        current.maxX = newMaxX;
        current.minY = newMinY;
        current.maxY = newMaxY;
        current.lastT = frame.t;
      } else {
        clusters.push({
          firstT: frame.t,
          lastT: frame.t,
          minX: frame.x,
          maxX: frame.x,
          minY: frame.y,
          maxY: frame.y
        });
      }
    } else {
      clusters.push({
        firstT: frame.t,
        lastT: frame.t,
        minX: frame.x,
        maxX: frame.x,
        minY: frame.y,
        maxY: frame.y
      });
    }
  }
  let bestCluster = clusters[0];
  for (const cluster of clusters) {
    if (cluster.firstT <= atMs) {
      bestCluster = cluster;
    }
  }
  const cx = (bestCluster.maxX + bestCluster.minX) / 2;
  const cy = (bestCluster.maxY + bestCluster.minY) / 2;
  return { x: cx, y: cy };
}

// ../kino/src/renderer/engine/spring-camera.ts
var SpringCamera = class _SpringCamera {
  vx = 0;
  vy = 0;
  vZoom = 0;
  x = 0;
  y = 0;
  zoom = 1;
  /** Maximum substep size in seconds (1ms) */
  static MAX_SUBSTEP = 1e-3;
  update(tx, ty, tz, dt, positionSpring, zoomSpring) {
    let remaining = dt;
    while (remaining > 0) {
      const step = Math.min(remaining, _SpringCamera.MAX_SUBSTEP);
      remaining -= step;
      const ax = (positionSpring.stiffness * (tx - this.x) - positionSpring.damping * this.vx) / positionSpring.mass;
      const ay = (positionSpring.stiffness * (ty - this.y) - positionSpring.damping * this.vy) / positionSpring.mass;
      this.vx += ax * step;
      this.vy += ay * step;
      this.x += this.vx * step;
      this.y += this.vy * step;
      const az = (zoomSpring.stiffness * (tz - this.zoom) - zoomSpring.damping * this.vZoom) / zoomSpring.mass;
      this.vZoom += az * step;
      this.zoom += this.vZoom * step;
    }
  }
  reset() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.vx = 0;
    this.vy = 0;
    this.vZoom = 0;
  }
};
function snapToEdges(value, ratio) {
  if (ratio <= 0) return value;
  return Math.max(0, Math.min(1, (value - ratio) / (1 - 2 * ratio)));
}

// ../kino/src/renderer/engine/composition-geometry.ts
function findActiveZoomRange(ranges, timeMs) {
  for (const range of ranges) {
    if (!range.disabled && timeMs >= range.startMs && timeMs <= range.endMs) {
      return range;
    }
  }
  return null;
}
function computeCameraTarget(activeRange, cursorFrames, timeMs) {
  if (!activeRange) return { x: 0, y: 0, zoom: 1 };
  const target = clusterCursorTarget(cursorFrames, activeRange, timeMs, activeRange.zoom);
  const ratio = activeRange.snapToEdgesRatio;
  const snappedX = snapToEdges(target.x, ratio);
  const snappedY = snapToEdges(target.y, ratio);
  let x = snappedX - 0.5;
  let y = snappedY - 0.5;
  const zoom = activeRange.zoom;
  if (zoom > 1.01) {
    const maxPan = 0.5 * (1 - 1 / zoom);
    x = Math.max(-maxPan, Math.min(maxPan, x));
    y = Math.max(-maxPan, Math.min(maxPan, y));
  }
  return { x, y, zoom };
}
function clampCameraToZoom(camera) {
  if (camera.zoom > 1.001) {
    const maxPan = 0.5 * (1 - 1 / camera.zoom);
    camera.x = Math.max(-maxPan, Math.min(maxPan, camera.x));
    camera.y = Math.max(-maxPan, Math.min(maxPan, camera.y));
  } else {
    camera.x = 0;
    camera.y = 0;
  }
}
export {
  SpringCamera,
  clampCameraToZoom,
  computeCameraTarget,
  fillGapsWithSystemRanges,
  findActiveZoomRange,
  generateAutoZoomRanges
};
