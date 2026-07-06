import assert from 'node:assert/strict';
import {
  createDefaultDemoStep,
  describeDemoStep,
  normalizeDemoConfig,
  serializeDemoConfig,
  stepToMotion,
} from '../src/presentationUtils.js';

const defaultStep = createDefaultDemoStep(3);
assert.equal(defaultStep.cardId, 3);
assert.equal(defaultStep.action, 'move');
assert.equal(defaultStep.moveDirection, 'right');
assert.equal(defaultStep.moveDistance, 1);
assert.equal(describeDemoStep(defaultStep), '卡片3：向右平移1格');

const halfMove = {
  ...defaultStep,
  cardId: 1,
  moveDirection: 'up',
  moveDistance: 0.5,
};
assert.equal(describeDemoStep(halfMove), '卡片1：向上平移0.5格');
assert.deepEqual(stepToMotion(halfMove, { cellWidth: 100, cellHeight: 80 }), {
  kind: 'move',
  values: { tx: 0, ty: -40 },
  label: '向上平移0.5格',
});

const customMove = {
  ...defaultStep,
  moveDirection: 'left',
  moveDistanceMode: 'custom',
  customPixels: 42,
};
assert.equal(describeDemoStep(customMove), '卡片3：向左平移42像素');
assert.deepEqual(stepToMotion(customMove, { cellWidth: 100, cellHeight: 80 }), {
  kind: 'move',
  values: { tx: -42, ty: 0 },
  label: '向左平移42像素',
});

const rotateStep = {
  ...defaultStep,
  cardId: 2,
  action: 'rotate',
  rotateDirection: 'clockwise',
  rotateAngle: 90,
  rotationCenter: 'bottomLeft',
};
assert.equal(describeDemoStep(rotateStep), '卡片2：绕左下角顺时针旋转90°');
assert.deepEqual(stepToMotion(rotateStep, { cellWidth: 100, cellHeight: 80 }), {
  kind: 'rotate',
  values: { rotation: 90, rotationCenter: 'bottomLeft' },
  label: '绕左下角顺时针旋转90°',
});

const serialized = serializeDemoConfig({
  rows: 2,
  cols: 5,
  targetCellIndices: [3, 4, 8, 9],
  cardCellIndices: [0, 1, 5, 6],
  motionSettings: { speed: 'fast', showPath: true, showFrames: true },
  demoSteps: [halfMove, rotateStep],
});
assert.equal(serialized.version, 2);
assert.equal(serialized.demoSteps.length, 2);
assert.equal(serialized.motionSettings.speed, 'fast');

const normalized = normalizeDemoConfig({
  rows: 3,
  cols: 4,
  demoSteps: [{ cardId: 4, action: 'rotate', rotateDirection: 'counterclockwise' }],
});
assert.equal(normalized.rows, 3);
assert.equal(normalized.cols, 4);
assert.equal(normalized.demoSteps[0].rotationCenter, 'center');
assert.equal(normalized.demoSteps[0].rotateAngle, 90);
