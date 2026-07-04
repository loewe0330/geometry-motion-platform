export const MOTION_DURATIONS = {
  slow: 1600,
  normal: 1000,
  fast: 600,
};

export const defaultMotionSettings = {
  speed: 'normal',
  showPath: true,
  showFrames: true,
};

export function clampProgress(progress) {
  return Math.min(Math.max(progress, 0), 1);
}

export function easeInOut(progress) {
  const t = clampProgress(progress);
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function interpolateNumber(from, to, progress) {
  return from + (to - from) * clampProgress(progress);
}

function rectCenter(rect) {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

function interpolateRect(from, to, progress) {
  return {
    x: interpolateNumber(from.x, to.x, progress),
    y: interpolateNumber(from.y, to.y, progress),
    width: interpolateNumber(from.width, to.width, progress),
    height: interpolateNumber(from.height, to.height, progress),
    rotation: interpolateNumber(from.rotation ?? 0, to.rotation ?? 0, progress),
  };
}

export function buildLineTrace({ id, cardId, from, to, label, progress = 1 }) {
  const visibleProgress = clampProgress(progress);
  const fromCenter = rectCenter(from);
  const toCenter = rectCenter(to);
  const pathEnd = {
    x: interpolateNumber(fromCenter.x, toCenter.x, visibleProgress),
    y: interpolateNumber(fromCenter.y, toCenter.y, visibleProgress),
  };

  return {
    id,
    cardId,
    kind: 'move',
    label,
    from,
    to,
    current: interpolateRect(from, to, visibleProgress),
    path: {
      x1: fromCenter.x,
      y1: fromCenter.y,
      x2: pathEnd.x,
      y2: pathEnd.y,
      fullX2: toCenter.x,
      fullY2: toCenter.y,
    },
    progress: visibleProgress,
  };
}

function polarPoint(center, radius, degrees) {
  const radians = (degrees - 90) * (Math.PI / 180);
  return {
    x: center.x + Math.cos(radians) * radius,
    y: center.y + Math.sin(radians) * radius,
  };
}

export function buildRotationTrace({ id, cardId, from, to, pivot, label, progress = 1 }) {
  const visibleProgress = clampProgress(progress);
  const delta = (to.rotation ?? 0) - (from.rotation ?? 0);
  const currentRotation = interpolateNumber(from.rotation ?? 0, to.rotation ?? 0, visibleProgress);
  const center = {
    x: from.x + pivot.x,
    y: from.y + pivot.y,
  };
  const radius = Math.max(from.width, from.height) / 2 + 28;
  const arcEndDegrees = delta * visibleProgress;
  const arcEnd = polarPoint(center, radius, arcEndDegrees);
  const largeArc = Math.abs(arcEndDegrees) > 180 ? 1 : 0;
  const sweepFlag = delta >= 0 ? 1 : 0;
  const start = polarPoint(center, radius, 0);

  return {
    id,
    cardId,
    kind: 'rotate',
    label,
    from,
    to,
    current: { ...from, rotation: currentRotation },
    center,
    delta,
    direction: delta >= 0 ? 'clockwise' : 'counterclockwise',
    radius,
    arcPath: `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} ${sweepFlag} ${arcEnd.x} ${arcEnd.y}`,
    arcEnd,
    progress: visibleProgress,
  };
}
