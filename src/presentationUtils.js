export const MOVE_DIRECTIONS = {
  up: { label: '向上', dx: 0, dy: -1 },
  down: { label: '向下', dx: 0, dy: 1 },
  left: { label: '向左', dx: -1, dy: 0 },
  right: { label: '向右', dx: 1, dy: 0 },
};

export const ROTATE_DIRECTIONS = {
  clockwise: { label: '顺时针', sign: 1 },
  counterclockwise: { label: '逆时针', sign: -1 },
};

export const CENTER_LABELS = {
  center: '中心',
  topLeft: '左上角',
  topRight: '右上角',
  bottomLeft: '左下角',
  bottomRight: '右下角',
};

const DEFAULT_STEP = {
  cardId: 1,
  action: 'move',
  moveDirection: 'right',
  moveDistanceMode: 'grid',
  moveDistance: 1,
  customPixels: 80,
  rotateDirection: 'clockwise',
  rotateAngle: 90,
  rotationCenter: 'center',
  note: '',
};

export function createDefaultDemoStep(cardId = 1) {
  return {
    ...DEFAULT_STEP,
    id: `step-${Date.now()}-${Math.round(Math.random() * 10000)}`,
    cardId,
  };
}

function formatDistance(step) {
  if (step.moveDistanceMode === 'custom') return `${Number(step.customPixels) || 0}像素`;
  return `${Number(step.moveDistance) || 1}格`;
}

export function describeDemoStep(step) {
  if (step.note?.trim()) return step.note.trim();
  if (step.action === 'rotate') {
    const direction = ROTATE_DIRECTIONS[step.rotateDirection] ?? ROTATE_DIRECTIONS.clockwise;
    const center = CENTER_LABELS[step.rotationCenter] ?? CENTER_LABELS.center;
    return `卡片${step.cardId}：绕${center}${direction.label}旋转${Number(step.rotateAngle) || 90}°`;
  }
  const direction = MOVE_DIRECTIONS[step.moveDirection] ?? MOVE_DIRECTIONS.right;
  return `卡片${step.cardId}：${direction.label}平移${formatDistance(step)}`;
}

export function stepToMotion(step, { cellWidth, cellHeight }) {
  if (step.action === 'rotate') {
    const direction = ROTATE_DIRECTIONS[step.rotateDirection] ?? ROTATE_DIRECTIONS.clockwise;
    const angle = (Number(step.rotateAngle) || 90) * direction.sign;
    const center = CENTER_LABELS[step.rotationCenter] ?? CENTER_LABELS.center;
    return {
      kind: 'rotate',
      values: { rotation: angle, rotationCenter: step.rotationCenter ?? 'center' },
      label: `绕${center}${direction.label}旋转${Math.abs(angle)}°`,
    };
  }

  const direction = MOVE_DIRECTIONS[step.moveDirection] ?? MOVE_DIRECTIONS.right;
  const distance =
    step.moveDistanceMode === 'custom'
      ? Number(step.customPixels) || 0
      : Number(step.moveDistance) || 1;
  const dx = direction.dx * (step.moveDistanceMode === 'custom' ? distance : distance * cellWidth);
  const dy = direction.dy * (step.moveDistanceMode === 'custom' ? distance : distance * cellHeight);
  return {
    kind: 'move',
    values: { tx: dx, ty: dy },
    label: `${direction.label}平移${formatDistance(step)}`,
  };
}

function normalizeStep(step, index = 0) {
  return {
    ...DEFAULT_STEP,
    ...step,
    id: step.id ?? `step-imported-${index + 1}`,
    cardId: Number(step.cardId) || 1,
    moveDistance: Number(step.moveDistance) || 1,
    customPixels: Number(step.customPixels) || 80,
    rotateAngle: Number(step.rotateAngle) || 90,
    note: step.note ?? '',
  };
}

export function serializeDemoConfig(config) {
  return {
    version: 2,
    rows: config.rows,
    cols: config.cols,
    targetCellIndices: config.targetCellIndices ?? [],
    cardCellIndices: config.cardCellIndices ?? [],
    gridBox: config.gridBox ?? null,
    manualBlocks: config.manualBlocks ?? [],
    cellRoles: config.cellRoles ?? [],
    targetOpacity: config.targetOpacity,
    motionSettings: config.motionSettings,
    demoSteps: (config.demoSteps ?? []).map((step, index) => normalizeStep(step, index)),
  };
}

export function normalizeDemoConfig(config) {
  return {
    version: 2,
    rows: Number(config.rows) || 2,
    cols: Number(config.cols) || 5,
    targetCellIndices: Array.isArray(config.targetCellIndices) ? config.targetCellIndices : [],
    cardCellIndices: Array.isArray(config.cardCellIndices) ? config.cardCellIndices : [],
    gridBox: config.gridBox ?? null,
    manualBlocks: Array.isArray(config.manualBlocks) ? config.manualBlocks : [],
    cellRoles: Array.isArray(config.cellRoles) ? config.cellRoles : [],
    targetOpacity: Number(config.targetOpacity) || 35,
    motionSettings: config.motionSettings ?? {},
    demoSteps: Array.isArray(config.demoSteps)
      ? config.demoSteps.map((step, index) => normalizeStep(step, index))
      : [],
  };
}
