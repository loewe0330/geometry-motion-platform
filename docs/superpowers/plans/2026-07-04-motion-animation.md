# Motion Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make teaching-mode translation and rotation animations show clear, configurable, persistent motion paths with shadows, start/end frames, arrows, drag traces, and clearing controls.

**Architecture:** Extract deterministic motion helpers into `src/motionUtils.js` and cover them with dependency-free Node tests. Keep rendering in `src/App.jsx`, using requestAnimationFrame state for live progress and a persisted trace list for completed paths.

**Tech Stack:** React 19, SVG, requestAnimationFrame, Node assert tests.

---

### Task 1: Motion Helper Tests

**Files:**
- Create: `src/motionUtils.js`
- Create: `tests/motionUtils.test.mjs`
- Modify: `package.json`

- [ ] Write failing tests for animation durations, default toggles, line shadows, rotation shadows, and SVG arc metadata.
- [ ] Run `npm test` and verify it fails because `src/motionUtils.js` does not exist.
- [ ] Implement the minimal helper exports in `src/motionUtils.js`.
- [ ] Run `npm test` and verify the helper tests pass.

### Task 2: Teaching Animation State

**Files:**
- Modify: `src/App.jsx`

- [ ] Add animation speed state with `slow`, `normal`, and `fast`.
- [ ] Add `showMotionPath`, `showMotionGhosts`, `showMotionFrames`, and `showMotionArrows` toggles, all defaulting to true.
- [ ] Add `motionTraces` state for completed and drag traces.
- [ ] Update reset-current and reset-all flows to clear matching traces.

### Task 3: Translation and Rotation Rendering

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/App.css`

- [ ] Render start and target dashed frames when enabled.
- [ ] Render live and persisted path lines with arrow markers when enabled.
- [ ] Render 3 to 5 ghost cards when enabled.
- [ ] Render rotation center, start/end frames, arc path, arrow, and current angle while rotating.
- [ ] Keep single-card focus mode limited to the selected card, target reference, traces, frames, ghosts, and center.

### Task 4: Drag Traces and Controls

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/App.css`

- [ ] During pointer drag, show a live line from drag start to current card position.
- [ ] On pointer release, persist the drag trace and write `卡片N：拖动平移到新位置`.
- [ ] Add `清除当前轨迹` and `清除全部轨迹` buttons.
- [ ] Ensure clearing traces does not change card positions.

### Task 5: Verification

**Files:**
- Modify: none unless verification reveals a bug.

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] In the in-app browser, enter teaching mode from the sample.
- [ ] Verify right-move animation shows progressive path, start/end frames, arrow, ghosts, and persisted trace.
- [ ] Verify clockwise rotation shows center, arc arrow, current angle, start/end frames, ghosts, and persisted trace.
- [ ] Verify focus mode hides other cards.
- [ ] Verify clearing traces removes paths while preserving card position.
