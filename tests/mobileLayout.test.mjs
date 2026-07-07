import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/App.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

for (const componentName of [
  'MobileTopBar',
  'MobileBottomTabs',
  'MobileTeachingControls',
  'MobileStepControls',
  'MobileGridControls',
]) {
  assert.match(app, new RegExp(`function ${componentName}\\b`), `${componentName} component should exist`);
}

assert.match(css, /@media\s*\(min-width:\s*900px\)/, 'desktop breakpoint should start at 900px');
assert.match(
  css,
  /@media\s*\(min-width:\s*600px\)\s*and\s*\(max-width:\s*899px\)/,
  'tablet portrait breakpoint should cover 600px-899px',
);
assert.match(css, /@media\s*\(max-width:\s*599px\)/, 'mobile breakpoint should cover widths below 600px');

assert.match(css, /\.mobile-top-bar\s*{[^}]*position:\s*fixed/s, 'mobile top bar should be fixed');
assert.match(css, /\.mobile-bottom-drawer\s*{[^}]*position:\s*fixed/s, 'mobile bottom drawer should be fixed');
assert.match(
  css,
  /\.mobile-layout-active\s+\.control-panel\s*{[^}]*display:\s*none/s,
  'mobile layout should hide the desktop control panel',
);
assert.match(
  css,
  /\.mobile-layout-active\s+\.stage-panel\s*{[^}]*height:\s*calc\(100dvh - var\(--mobile-top-height\) - var\(--mobile-bottom-height\)\)/s,
  'mobile stage should be sized between fixed top and bottom bars',
);
assert.match(
  css,
  /\.mobile-layout-active\s+\.teaching-stage\s*{[^}]*touch-action:\s*none/s,
  'mobile canvas should disable page scrolling during direct manipulation',
);
assert.match(css, /\.mobile-tab-button\.active/, 'mobile tabs should expose an active visual state');
assert.match(
  css,
  /\.mobile-grid-drawer\s+\.mobile-template-row,\s*\.mobile-grid-drawer\s+\.mobile-stepper-row\s*{[^}]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/s,
  'mobile grid drawer controls should fit all five buttons without horizontal clipping',
);
assert.match(
  app,
  /preserveAspectRatio=\{isCompactViewport\s*\?\s*'xMidYMid slice'\s*:\s*'xMidYMid meet'\}/,
  'mobile teaching canvas should zoom into the work area instead of leaving large grid margins',
);
