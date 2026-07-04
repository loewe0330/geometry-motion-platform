import assert from 'node:assert/strict';
import {
  MOTION_DURATIONS,
  buildLineTrace,
  buildRotationTrace,
  defaultMotionSettings,
  interpolateNumber,
} from '../src/motionUtils.js';

assert.deepEqual(MOTION_DURATIONS, {
  slow: 1600,
  normal: 1000,
  fast: 600,
});

assert.deepEqual(defaultMotionSettings, {
  speed: 'normal',
  showPath: true,
  showFrames: true,
});

assert.equal(interpolateNumber(10, 30, 0), 10);
assert.equal(interpolateNumber(10, 30, 0.5), 20);
assert.equal(interpolateNumber(10, 30, 1), 30);

const lineTrace = buildLineTrace({
  id: 'trace-1',
  cardId: 1,
  from: { x: 10, y: 20, width: 80, height: 60, rotation: 0 },
  to: { x: 110, y: 20, width: 80, height: 60, rotation: 0 },
  label: '向右平移1格',
  progress: 0.5,
});
assert.equal(lineTrace.kind, 'move');
assert.equal(lineTrace.current.x, 60);
assert.equal(lineTrace.current.y, 20);
assert.equal(lineTrace.path.x1, 50);
assert.equal(lineTrace.path.y1, 50);
assert.equal(lineTrace.path.x2, 100);
assert.equal(lineTrace.path.y2, 50);
assert.equal('ghosts' in lineTrace, false);
assert.equal(lineTrace.label, '向右平移1格');

const rotationTrace = buildRotationTrace({
  id: 'trace-2',
  cardId: 1,
  from: { x: 40, y: 50, width: 90, height: 70, rotation: 0 },
  to: { x: 40, y: 50, width: 90, height: 70, rotation: 90 },
  pivot: { x: 45, y: 35 },
  label: '顺时针旋转90°',
  progress: 0.5,
});
assert.equal(rotationTrace.kind, 'rotate');
assert.equal(rotationTrace.current.rotation, 45);
assert.equal(rotationTrace.center.x, 85);
assert.equal(rotationTrace.center.y, 85);
assert.equal(rotationTrace.delta, 90);
assert.equal(rotationTrace.direction, 'clockwise');
assert.equal('ghosts' in rotationTrace, false);
assert.match(rotationTrace.arcPath, /^M /);
