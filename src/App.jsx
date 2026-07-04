import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Crop,
  ImagePlus,
  RefreshCcw,
  RotateCcw,
  RotateCw,
  ScanSearch,
  Trash2,
} from 'lucide-react';
import {
  MOTION_DURATIONS,
  buildLineTrace,
  buildRotationTrace,
  defaultMotionSettings,
  easeInOut,
} from './motionUtils.js';

const DEFAULT_ROWS = 2;
const DEFAULT_COLS = 5;
const STAGE_WIDTH = 980;
const STAGE_HEIGHT = 680;
const FIT_PADDING = 34;
const REGION_MIN_SIZE = 42;
const TEACH_SIDE_PADDING_CELLS = 2;
const ROLE_CARD = 'card';
const ROLE_TARGET = 'target';
const ROLE_IGNORE = 'ignore';
const TARGET_OPACITY_DEFAULT = 35;

const wizardSteps = [
  { key: 'upload', label: '上传图片' },
  { key: 'grid', label: '设置网格' },
  { key: 'target', label: '选择目标参考图' },
  { key: 'cards', label: '选择移动卡片' },
  { key: 'teach', label: '教学演示' },
];

const roleLabels = {
  [ROLE_CARD]: '可移动卡片',
  [ROLE_TARGET]: '目标参考图',
  [ROLE_IGNORE]: '忽略区域',
};

const centers = {
  center: { label: '卡片中心', x: 0.5, y: 0.5 },
  topLeft: { label: '左上角', x: 0, y: 0 },
  topRight: { label: '右上角', x: 1, y: 0 },
  bottomLeft: { label: '左下角', x: 0, y: 1 },
  bottomRight: { label: '右下角', x: 1, y: 1 },
};

const moveMeta = {
  up: { label: '向上平移 1 格', short: '上移一格', dx: 0, dy: -1 },
  down: { label: '向下平移 1 格', short: '下移一格', dx: 0, dy: 1 },
  left: { label: '向左平移 1 格', short: '左移一格', dx: -1, dy: 0 },
  right: { label: '向右平移 1 格', short: '右移一格', dx: 1, dy: 0 },
};

function makeCards(rows, cols) {
  return Array.from({ length: rows * cols }, (_, index) => ({
    id: index + 1,
    row: Math.floor(index / cols),
    col: index % cols,
    tx: 0,
    ty: 0,
    rotation: 0,
    rotationCenter: 'center',
  }));
}

function makeDefaultCellRoles(rows, cols) {
  return Array.from({ length: rows * cols }, (_, index) => {
    const col = index % cols;
    if (rows === 2 && cols >= 5) {
      if (col <= 1) return ROLE_CARD;
      if (col === 2) return ROLE_IGNORE;
      return ROLE_TARGET;
    }
    return ROLE_CARD;
  });
}

function makeTeachingCards(rows, cols, roles) {
  let cardId = 1;
  return roles
    .map((role, index) => ({ role, index }))
    .filter((item) => item.role === ROLE_CARD)
    .map((item) => ({
      id: cardId++,
      sourceIndex: item.index,
      row: Math.floor(item.index / cols),
      col: item.index % cols,
      sourceRect: null,
      tx: 0,
      ty: 0,
      rotation: 0,
      rotationCenter: 'center',
    }));
}

function makeManualTeachingCards(blocks) {
  let cardId = 1;
  return blocks
    .filter((block) => block.role === ROLE_CARD)
    .map((block) => ({
      id: cardId++,
      blockId: block.id,
      name: block.name,
      sourceRect: {
        x: block.x,
        y: block.y,
        width: block.width,
        height: block.height,
      },
      row: 0,
      col: 0,
      tx: 0,
      ty: 0,
      rotation: 0,
      rotationCenter: 'center',
    }));
}

function rectFromBlocks(blocks, role) {
  const rects = blocks.filter((block) => block.role === role);
  if (!rects.length) return null;
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function makeBlockName(role, count) {
  if (role === ROLE_CARD) return `卡片${count}`;
  if (role === ROLE_TARGET) return `目标图${count}`;
  return `忽略区${count}`;
}

function cellRectFromIndex(region, index) {
  if (!region) return null;
  const normalized = withGridDefaults(region);
  const row = Math.floor(index / normalized.cols);
  const col = index % normalized.cols;
  if (row >= normalized.rows) return null;
  const x = normalized.x + normalized.colLines[col];
  const y = normalized.y + normalized.rowLines[row];
  return {
    x,
    y,
    width: normalized.colLines[col + 1] - normalized.colLines[col],
    height: normalized.rowLines[row + 1] - normalized.rowLines[row],
    row,
    col,
  };
}

function rectFromRoleCells(region, roles, role) {
  if (!region || !roles?.length) return null;
  const rects = roles
    .map((itemRole, index) => (itemRole === role ? cellRectFromIndex(region, index) : null))
    .filter(Boolean);
  if (!rects.length) return null;
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function rectFromCellIndices(region, indices) {
  if (!region || !indices?.length) return null;
  const rects = indices.map((index) => cellRectFromIndex(region, index)).filter(Boolean);
  if (!rects.length) return null;
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function makeDefaultGridBox(photo, rows = DEFAULT_ROWS, cols = DEFAULT_COLS) {
  if (!photo) return null;
  const horizontalPadding = photo.naturalWidth * 0.12;
  const maxWidth = photo.naturalWidth - horizontalPadding * 2;
  const maxHeight = photo.naturalHeight * 0.46;
  let width = Math.min(maxWidth, photo.naturalWidth * 0.72);
  let height = width * (rows / cols);

  if (height > maxHeight) {
    height = maxHeight;
    width = height * (cols / rows);
  }

  return {
    x: Math.max(0, (photo.naturalWidth - width) / 2),
    y: Math.max(0, (photo.naturalHeight - height) / 2),
    width,
    height,
  };
}

function makeGridRegion(gridBox, rows, cols) {
  if (!gridBox) return null;
  const nextRows = clampGridSize(rows);
  const nextCols = clampGridSize(cols);
  return {
    id: 'guided-grid',
    label: '课堂网格',
    x: gridBox.x,
    y: gridBox.y,
    width: gridBox.width,
    height: gridBox.height,
    rows: nextRows,
    cols: nextCols,
    type: 'grid',
    ...makeEvenGridLines(gridBox.width, gridBox.height, nextRows, nextCols),
  };
}

function expandTeachingRegion(region, sidePaddingCells = TEACH_SIDE_PADDING_CELLS) {
  if (!region) return null;
  const normalized = withGridDefaults(region);
  const cellWidth = normalized.width / normalized.cols;
  const paddingWidth = cellWidth * sidePaddingCells;
  const nextCols = normalized.cols + sidePaddingCells * 2;
  return {
    ...normalized,
    id: `${normalized.id}-teaching-space`,
    label: `${normalized.label} · 教学留白`,
    x: normalized.x - paddingWidth,
    width: normalized.width + paddingWidth * 2,
    cols: nextCols,
    ...makeEvenGridLines(normalized.width + paddingWidth * 2, normalized.height, normalized.rows, nextCols),
  };
}

function clampGridBox(box, photo) {
  if (!box || !photo) return box;
  const width = Math.max(REGION_MIN_SIZE, Math.min(box.width, photo.naturalWidth));
  const height = Math.max(REGION_MIN_SIZE, Math.min(box.height, photo.naturalHeight));
  return {
    x: Math.max(0, Math.min(box.x, photo.naturalWidth - width)),
    y: Math.max(0, Math.min(box.y, photo.naturalHeight - height)),
    width,
    height,
  };
}

function cellIndexAtPoint(region, point) {
  if (!region) return null;
  if (
    point.x < region.x ||
    point.y < region.y ||
    point.x > region.x + region.width ||
    point.y > region.y + region.height
  ) {
    return null;
  }
  const col = Math.min(region.cols - 1, Math.max(0, Math.floor(((point.x - region.x) / region.width) * region.cols)));
  const row = Math.min(region.rows - 1, Math.max(0, Math.floor(((point.y - region.y) / region.height) * region.rows)));
  return row * region.cols + col;
}

function cellIndicesInRect(region, rect) {
  if (!region || !rect) return [];
  const normalizedRect = normalizeRect(rect, {
    width: region.x + region.width,
    height: region.y + region.height,
  });
  const selected = [];
  for (let row = 0; row < region.rows; row += 1) {
    for (let col = 0; col < region.cols; col += 1) {
      const index = row * region.cols + col;
      const cell = cellRectFromIndex(region, index);
      const overlaps =
        normalizedRect.x < cell.x + cell.width &&
        normalizedRect.x + normalizedRect.width > cell.x &&
        normalizedRect.y < cell.y + cell.height &&
        normalizedRect.y + normalizedRect.height > cell.y;
      if (overlaps) selected.push(index);
    }
  }
  return selected;
}

function toggleIndex(list, index) {
  if (index === null || index === undefined) return list;
  return list.includes(index) ? list.filter((item) => item !== index) : [...list, index].sort((a, b) => a - b);
}

function addIndices(list, indices) {
  return [...new Set([...list, ...indices])].sort((a, b) => a - b);
}

function makeGridTeachingCards(region, indices) {
  let cardId = 1;
  return indices
    .map((index) => ({ index, rect: cellRectFromIndex(region, index) }))
    .filter((item) => item.rect)
    .map((item) => ({
      id: cardId++,
      sourceIndex: item.index,
      row: Math.floor(item.index / region.cols),
      col: item.index % region.cols,
      sourceRect: item.rect,
      tx: 0,
      ty: 0,
      rotation: 0,
      rotationCenter: 'center',
    }));
}

function normalizeRect(rect, bounds) {
  const width = bounds.width ?? bounds.naturalWidth;
  const height = bounds.height ?? bounds.naturalHeight;
  const x1 = Math.max(0, Math.min(width, Math.min(rect.x, rect.x + rect.width)));
  const y1 = Math.max(0, Math.min(height, Math.min(rect.y, rect.y + rect.height)));
  const x2 = Math.max(0, Math.min(width, Math.max(rect.x, rect.x + rect.width)));
  const y2 = Math.max(0, Math.min(height, Math.max(rect.y, rect.y + rect.height)));
  return {
    x: x1,
    y: y1,
    width: Math.max(8, x2 - x1),
    height: Math.max(8, y2 - y1),
  };
}

function fitImage(naturalWidth, naturalHeight) {
  if (!naturalWidth || !naturalHeight) {
    return {
      x: FIT_PADDING,
      y: FIT_PADDING,
      width: STAGE_WIDTH - FIT_PADDING * 2,
      height: STAGE_HEIGHT - FIT_PADDING * 2,
    };
  }

  const maxWidth = STAGE_WIDTH - FIT_PADDING * 2;
  const maxHeight = STAGE_HEIGHT - FIT_PADDING * 2;
  const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;

  return {
    x: (STAGE_WIDTH - width) / 2,
    y: (STAGE_HEIGHT - height) / 2,
    width,
    height,
  };
}

function normalizeAngle(angle) {
  const normalized = angle % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function clampGridSize(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(Math.max(Math.round(numeric), 1), 8);
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function makeFallbackCandidates(width, height) {
  const wholeWidth = width * 0.74;
  const wholeHeight = height * 0.24;
  const candidateWidth = width * 0.28;
  const candidateHeight = height * 0.24;
  const y = height * 0.38;
  return [
    {
      id: 'candidate-a',
      label: '整块候选 A',
      x: width * 0.13,
      y,
      width: wholeWidth,
      height: wholeHeight,
      rows: 2,
      cols: 5,
      type: 'wholeGrid',
      score: 4,
    },
    {
      id: 'candidate-b',
      label: '候选区域 B',
      x: width * 0.14,
      y,
      width: candidateWidth,
      height: candidateHeight,
      rows: 2,
      cols: 2,
      type: 'source',
      score: 1,
    },
    {
      id: 'candidate-c',
      label: '候选区域 C',
      x: width * 0.58,
      y,
      width: candidateWidth,
      height: candidateHeight,
      rows: 2,
      cols: 2,
      type: 'target',
      score: 1,
    },
  ];
}

function makeEvenGridLines(width, height, rows, cols) {
  return {
    rowLines: Array.from({ length: rows + 1 }, (_, index) => (height / rows) * index),
    colLines: Array.from({ length: cols + 1 }, (_, index) => (width / cols) * index),
  };
}

function withGridDefaults(region) {
  const rows = clampGridSize(region.rows || DEFAULT_ROWS);
  const cols = clampGridSize(region.cols || DEFAULT_COLS);
  const hasLines =
    region.rowLines?.length === rows + 1 && region.colLines?.length === cols + 1;
  return {
    ...region,
    rows,
    cols,
    ...(hasLines ? {} : makeEvenGridLines(region.width, region.height, rows, cols)),
  };
}

function sliceRegionByGrid(region, rowStart, rowEnd, colStart, colEnd, type) {
  const normalized = withGridDefaults(region);
  const safeRowStart = Math.max(0, Math.min(rowStart, normalized.rows - 1));
  const safeRowEnd = Math.max(safeRowStart + 1, Math.min(rowEnd, normalized.rows));
  const safeColStart = Math.max(0, Math.min(colStart, normalized.cols - 1));
  const safeColEnd = Math.max(safeColStart + 1, Math.min(colEnd, normalized.cols));
  const x1 = normalized.colLines[safeColStart];
  const x2 = normalized.colLines[safeColEnd];
  const y1 = normalized.rowLines[safeRowStart];
  const y2 = normalized.rowLines[safeRowEnd];
  return {
    ...normalized,
    id: `${normalized.id}-${type}`,
    label: `${normalized.label}${type === 'source' ? ' · 源图' : ' · 目标'}`,
    x: normalized.x + x1,
    y: normalized.y + y1,
    width: x2 - x1,
    height: y2 - y1,
    rows: safeRowEnd - safeRowStart,
    cols: safeColEnd - safeColStart,
    type,
    ...makeEvenGridLines(x2 - x1, y2 - y1, safeRowEnd - safeRowStart, safeColEnd - safeColStart),
  };
}

function getSourceOperationRegion(region) {
  if (!region) return null;
  if (region.type !== 'wholeGrid') return withGridDefaults(region);
  const startCol = Math.max(0, Math.min(region.sourceColStart ?? 0, region.cols - 2));
  return sliceRegionByGrid(region, 0, region.rows, startCol, startCol + 2, 'source');
}

function getArrowHintRegion(region) {
  if (!region || region.type !== 'wholeGrid' || region.cols < 5) return null;
  const arrowCol = Math.max(0, Math.min(region.arrowColStart ?? 2, region.cols - 1));
  return sliceRegionByGrid(region, 0, region.rows, arrowCol, arrowCol + 1, 'arrow');
}

function getTargetReferenceRegion(region) {
  if (!region) return null;
  if (region.type !== 'wholeGrid') return withGridDefaults(region);
  const startCol = Math.max(0, Math.min(region.targetColStart ?? region.cols - 2, region.cols - 2));
  return sliceRegionByGrid(region, 0, region.rows, startCol, region.cols, 'target');
}

function clusterLinePositions(values, threshold, scale) {
  const clusters = [];
  let start = null;
  let total = 0;
  let weight = 0;

  values.forEach((value, index) => {
    if (value >= threshold) {
      if (start === null) start = index;
      total += index * value;
      weight += value;
    } else if (start !== null) {
      if (index - start >= 2) {
        clusters.push({
          start: start / scale,
          end: (index - 1) / scale,
          center: (weight ? total / weight : (start + index - 1) / 2) / scale,
          strength: weight,
        });
      }
      start = null;
      total = 0;
      weight = 0;
    }
  });

  if (start !== null && values.length - start >= 2) {
    clusters.push({
      start: start / scale,
      end: (values.length - 1) / scale,
      center: (weight ? total / weight : (start + values.length - 1) / 2) / scale,
      strength: weight,
    });
  }

  return clusters;
}

function spacingScore(lines) {
  const gaps = [];
  for (let index = 1; index < lines.length; index += 1) {
    gaps.push(lines[index].center - lines[index - 1].center);
  }
  const average = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
  if (!average) return 0;
  const variance =
    gaps.reduce((sum, value) => sum + Math.abs(value - average), 0) / gaps.length / average;
  return Math.max(0, 1 - variance);
}

function lineContinuityScore(darkPixels, imageWidth, imageHeight, box, rowLines, colLines) {
  const rowScores = rowLines.map((lineY) => {
    const y = Math.max(0, Math.min(imageHeight - 1, Math.round(box.y + lineY)));
    let hits = 0;
    const startX = Math.max(0, Math.round(box.x));
    const endX = Math.min(imageWidth - 1, Math.round(box.x + box.width));
    for (let x = startX; x <= endX; x += 1) {
      let found = false;
      for (let dy = -2; dy <= 2; dy += 1) {
        const yy = y + dy;
        if (yy >= 0 && yy < imageHeight && darkPixels[yy * imageWidth + x]) {
          found = true;
          break;
        }
      }
      if (found) hits += 1;
    }
    return hits / Math.max(1, endX - startX + 1);
  });

  const colScores = colLines.map((lineX) => {
    const x = Math.max(0, Math.min(imageWidth - 1, Math.round(box.x + lineX)));
    let hits = 0;
    const startY = Math.max(0, Math.round(box.y));
    const endY = Math.min(imageHeight - 1, Math.round(box.y + box.height));
    for (let y = startY; y <= endY; y += 1) {
      let found = false;
      for (let dx = -2; dx <= 2; dx += 1) {
        const xx = x + dx;
        if (xx >= 0 && xx < imageWidth && darkPixels[y * imageWidth + xx]) {
          found = true;
          break;
        }
      }
      if (found) hits += 1;
    }
    return hits / Math.max(1, endY - startY + 1);
  });

  const scores = [...rowScores, ...colScores];
  return scores.reduce((sum, value) => sum + value, 0) / Math.max(1, scores.length);
}

function overlapRatio(box, target) {
  if (!target) return 0;
  const x1 = Math.max(box.x, target.x);
  const y1 = Math.max(box.y, target.y);
  const x2 = Math.min(box.x + box.width, target.x + target.width);
  const y2 = Math.min(box.y + box.height, target.y + target.height);
  const overlap = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return overlap / Math.max(1, target.width * target.height);
}

async function detectGridCandidates(photo) {
  if (!photo?.url) return [];
  const img = await loadImage(photo.url);
  const scale = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const columns = new Array(width).fill(0);
  const rows = new Array(height).fill(0);
  const darkPixels = new Uint8Array(width * height);
  const colorPixels = new Uint8Array(width * height);
  let colorMinX = width;
  let colorMinY = height;
  let colorMaxX = 0;
  let colorMaxY = 0;
  let colorPixelCount = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const brightness = (r + g + b) / 3;
      const dark = brightness < 105 && !(r > 150 && g < 95 && b < 95);
      if (dark) {
        darkPixels[y * width + x] = 1;
        columns[x] += 1;
        rows[y] += 1;
      }
      const bearLike =
        r > 135 &&
        r > g * 1.08 &&
        r > b * 1.08 &&
        g > 70 &&
        b > 55 &&
        !(r > 185 && g < 80 && b < 80);
      if (bearLike) {
        colorPixels[y * width + x] = 1;
        colorMinX = Math.min(colorMinX, x);
        colorMinY = Math.min(colorMinY, y);
        colorMaxX = Math.max(colorMaxX, x);
        colorMaxY = Math.max(colorMaxY, y);
        colorPixelCount += 1;
      }
    }
  }

  const verticalLines = clusterLinePositions(columns, height * 0.1, scale);
  const horizontalLines = clusterLinePositions(rows, width * 0.1, scale);
  const candidates = [];
  const originalWidth = img.naturalWidth;
  const originalHeight = img.naturalHeight;
  const visited = new Uint8Array(width * height);
  const queue = [];
  const colorBox =
    colorPixelCount > 200
      ? {
          x: colorMinX / scale,
          y: colorMinY / scale,
          width: (colorMaxX - colorMinX + 1) / scale,
          height: (colorMaxY - colorMinY + 1) / scale,
        }
      : null;
  const wholePhotoAspect = originalWidth / originalHeight;

  if (wholePhotoAspect >= 2.15 && wholePhotoAspect <= 3.05) {
    candidates.push(
      withGridDefaults({
        id: `whole-photo-grid-${candidates.length + 1}`,
        label: '',
        x: 0,
        y: 0,
        width: originalWidth,
        height: originalHeight,
        rows: 2,
        cols: 5,
        type: 'wholeGrid',
        score: 140 + Math.min(colorPixelCount / 400, 30),
      }),
    );
  }

  if (colorPixelCount > 200) {
    const colorCenterX = (colorMinX + colorMaxX) / 2 / scale;
    const colorCenterY = (colorMinY + colorMaxY) / 2 / scale;
    const colorWidth = (colorMaxX - colorMinX + 1) / scale;
    const colorHeight = (colorMaxY - colorMinY + 1) / scale;
    const estimatedWidth = Math.min(originalWidth * 0.82, Math.max(colorWidth * 1.65, colorHeight * 2.45));
    const estimatedHeight = Math.min(originalHeight * 0.42, Math.max(colorHeight * 1.35, estimatedWidth / 2.5));
    candidates.push(
      withGridDefaults({
        id: `color-grid-${candidates.length + 1}`,
        label: '',
        x: Math.max(0, Math.min(originalWidth - estimatedWidth, colorCenterX - estimatedWidth / 2)),
        y: Math.max(0, Math.min(originalHeight - estimatedHeight, colorCenterY - estimatedHeight / 2)),
        width: estimatedWidth,
        height: estimatedHeight,
        rows: 2,
        cols: 5,
        type: 'wholeGrid',
        score: 80 + Math.min(colorPixelCount / 500, 20),
      }),
    );
  }

  for (let start = 0; start < darkPixels.length; start += 1) {
    if (!darkPixels[start] || visited[start]) continue;
    let head = 0;
    let pixelCount = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    queue.length = 0;
    queue.push(start);
    visited[start] = 1;

    while (head < queue.length) {
      const current = queue[head];
      head += 1;
      const x = current % width;
      const y = Math.floor(current / width);
      pixelCount += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      for (let ny = y - 1; ny <= y + 1; ny += 1) {
        if (ny < 0 || ny >= height) continue;
        for (let nx = x - 1; nx <= x + 1; nx += 1) {
          if (nx < 0 || nx >= width) continue;
          const next = ny * width + nx;
          if (!darkPixels[next] || visited[next]) continue;
          visited[next] = 1;
          queue.push(next);
        }
      }
    }

    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    const aspect = boxWidth / boxHeight;
    const density = pixelCount / (boxWidth * boxHeight);
    const areaRatio = (boxWidth * boxHeight) / (width * height);
    if (
      boxWidth < width * 0.08 ||
      boxHeight < height * 0.08 ||
      areaRatio < 0.01 ||
      areaRatio > 0.28 ||
      aspect < 0.45 ||
      aspect > 3.6 ||
      density < 0.03 ||
      density > 0.45
    ) {
      continue;
    }

    const localColumns = new Array(boxWidth).fill(0);
    const localRows = new Array(boxHeight).fill(0);
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (darkPixels[y * width + x]) {
          localColumns[x - minX] += 1;
          localRows[y - minY] += 1;
        }
      }
    }
    const localV = clusterLinePositions(localColumns, boxHeight * 0.35, 1);
    const localH = clusterLinePositions(localRows, boxWidth * 0.35, 1);
    const estimatedRows = Math.min(Math.max(localH.length - 1, 2), 4);
    const estimatedCols = Math.min(Math.max(localV.length - 1, 2), 5);
    const originalBoxWidth = (boxWidth + 6) / scale;
    const originalBoxHeight = (boxHeight + 6) / scale;
    const rowLines =
      localH.length === estimatedRows + 1
        ? localH.map((line) => (line.center - localH[0].center) / scale)
        : makeEvenGridLines(originalBoxWidth, originalBoxHeight, estimatedRows, estimatedCols)
            .rowLines;
    const colLines =
      localV.length === estimatedCols + 1
        ? localV.map((line) => (line.center - localV[0].center) / scale)
        : makeEvenGridLines(originalBoxWidth, originalBoxHeight, estimatedRows, estimatedCols)
            .colLines;
    const continuity = lineContinuityScore(
      darkPixels,
      width,
      height,
      { x: minX - 3, y: minY - 3, width: boxWidth + 6, height: boxHeight + 6 },
      rowLines.map((line) => line * scale),
      colLines.map((line) => line * scale),
    );
    if (estimatedRows === 2 && estimatedCols >= 5 && continuity < 0.24) continue;
    const componentBox = {
      x: Math.max(0, (minX - 3) / scale),
      y: Math.max(0, (minY - 3) / scale),
      width: Math.min(originalWidth, originalBoxWidth),
      height: Math.min(originalHeight, originalBoxHeight),
    };
    const colorOverlap = overlapRatio(componentBox, colorBox);
    if (estimatedRows === 2 && estimatedCols >= 5 && colorBox && colorOverlap < 0.18) continue;

    candidates.push({
      id: `component-${candidates.length + 1}`,
      label: '',
      ...componentBox,
      rows: estimatedRows,
      cols: estimatedCols,
      type: estimatedRows === 2 && estimatedCols >= 5 ? 'wholeGrid' : 'grid',
      rowLines,
      colLines,
      score:
        20 +
        areaRatio * 20 +
        spacingScore(localH) +
        spacingScore(localV) +
        continuity * 12 +
        colorOverlap * 24 +
        (estimatedRows === 2 && estimatedCols === 5 ? 12 : 0),
    });
  }

  for (const rowCount of [2, 3, 4]) {
    const neededH = rowCount + 1;
    for (let h = 0; h <= horizontalLines.length - neededH; h += 1) {
      const hLines = horizontalLines.slice(h, h + neededH);
      const y = hLines[0].center;
      const bottom = hLines[hLines.length - 1].center;
      if (bottom - y < originalHeight * 0.08) continue;

      for (const colCount of [2, 3, 4, 5]) {
        const neededV = colCount + 1;
        for (let v = 0; v <= verticalLines.length - neededV; v += 1) {
          const vLines = verticalLines.slice(v, v + neededV);
          const x = vLines[0].center;
          const right = vLines[vLines.length - 1].center;
          const boxWidth = right - x;
          const boxHeight = bottom - y;
          const areaRatio = (boxWidth * boxHeight) / (originalWidth * originalHeight);
          const aspect = boxWidth / boxHeight;
          if (boxWidth < 80 || boxHeight < 80 || areaRatio < 0.012 || areaRatio > 0.55) continue;
          if (rowCount === 2 && colCount === 5 && (aspect < 1.8 || aspect > 3.5)) continue;
          if (rowCount === 2 && colCount === 5 && boxHeight < originalHeight * 0.12) continue;

          const rowLines = hLines.map((line) => line.center - y);
          const colLines = vLines.map((line) => line.center - x);
          const continuity = lineContinuityScore(
            darkPixels,
            width,
            height,
            { x: x * scale, y: y * scale, width: boxWidth * scale, height: boxHeight * scale },
            rowLines.map((line) => line * scale),
            colLines.map((line) => line * scale),
          );
          if (rowCount === 2 && colCount === 5 && continuity < 0.28) continue;
          const projectionBox = {
            x: Math.max(0, x),
            y: Math.max(0, y),
            width: Math.min(originalWidth - x, boxWidth),
            height: Math.min(originalHeight - y, boxHeight),
          };
          const colorOverlap = overlapRatio(projectionBox, colorBox);
          if (rowCount === 2 && colCount === 5 && colorBox && colorOverlap < 0.18) continue;

          const score =
            spacingScore(hLines) * 2 +
            spacingScore(vLines) * 2 +
            Math.min(areaRatio * 8, 2) +
            rowCount +
            colCount +
            continuity * 12 +
            colorOverlap * 24 +
            (rowCount === 2 && colCount === 5 ? 14 : 0) +
            (boxWidth > boxHeight * 1.8 ? 4 : 0);

          candidates.push({
            id: `candidate-${candidates.length + 1}`,
            label: '',
            ...projectionBox,
            rows: rowCount,
            cols: colCount,
            type: rowCount === 2 && colCount === 5 ? 'wholeGrid' : 'grid',
            rowLines,
            colLines,
            score,
          });
        }
      }
    }
  }

  const deduped = [];
  [...candidates, ...makeFallbackCandidates(originalWidth, originalHeight)]
    .sort((a, b) => b.score - a.score)
    .forEach((candidate) => {
      const duplicate = deduped.some((item) => {
        const dx = Math.abs(item.x - candidate.x);
        const dy = Math.abs(item.y - candidate.y);
        const dw = Math.abs(item.width - candidate.width);
        const dh = Math.abs(item.height - candidate.height);
        return dx + dy + dw + dh < 70;
      });
      if (!duplicate) deduped.push(candidate);
    });

  const pool = deduped.length ? deduped : makeFallbackCandidates(originalWidth, originalHeight);
  function enrichZones(candidate) {
    const normalized = withGridDefaults(candidate);
    if (normalized.type !== 'wholeGrid' || normalized.cols < 5) return normalized;
    const counts = Array.from({ length: normalized.cols }, () => 0);
    const x0 = Math.round(normalized.x * scale);
    const y0 = Math.round(normalized.y * scale);
    const w = Math.round(normalized.width * scale);
    const h = Math.round(normalized.height * scale);
    for (let y = Math.max(0, y0); y < Math.min(height, y0 + h); y += 1) {
      for (let x = Math.max(0, x0); x < Math.min(width, x0 + w); x += 1) {
        if (!colorPixels[y * width + x]) continue;
        const localX = (x - x0) / Math.max(1, w);
        const col = Math.max(0, Math.min(normalized.cols - 1, Math.floor(localX * normalized.cols)));
        counts[col] += 1;
      }
    }
    const sourceStarts = [0].filter((start) => start + 1 < normalized.cols);
    const targetStarts = [Math.max(0, normalized.cols - 2), Math.max(0, normalized.cols - 3)].filter(
      (start, index, list) => start + 1 < normalized.cols && list.indexOf(start) === index,
    );
    const bestStart = (starts, fallback) =>
      starts.reduce(
        (best, start) => {
          const score = counts[start] + counts[start + 1];
          return score > best.score ? { start, score } : best;
        },
        { start: fallback, score: -1 },
      ).start;
    const sourceColStart = bestStart(sourceStarts, 0);
    const targetColStart = bestStart(targetStarts, normalized.cols - 2);
    return {
      ...normalized,
      sourceColStart,
      targetColStart,
      arrowColStart: Math.max(0, Math.min(sourceColStart + 2, targetColStart - 1, normalized.cols - 1)),
    };
  }
  const midpoint = originalWidth / 2;
  const leftPool = pool
    .filter((candidate) => candidate.x < midpoint)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  const rightPool = pool
    .filter((candidate) => candidate.x >= midpoint)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  const result = [...leftPool, ...rightPool]
    .sort((a, b) => a.x - b.x)
    .map((candidate, index) => ({
      ...enrichZones(candidate),
      id: candidate.id || `candidate-${index + 1}`,
      label:
        candidate.type === 'wholeGrid'
          ? `整块方格 ${String.fromCharCode(65 + index)}`
          : `候选区域 ${String.fromCharCode(65 + index)}`,
    }));

  return result;
}

async function rotatePhoto(photo, degrees) {
  const img = await loadImage(photo.url);
  const normalized = normalizeAngle(degrees);
  const swaps = normalized === 90 || normalized === 270;
  const canvas = document.createElement('canvas');
  canvas.width = swaps ? img.naturalHeight : img.naturalWidth;
  canvas.height = swaps ? img.naturalWidth : img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  return {
    url: canvas.toDataURL('image/png'),
    name: photo.name,
    naturalWidth: canvas.width,
    naturalHeight: canvas.height,
    generated: true,
  };
}

function makeDefaultQuad(photo) {
  if (!photo) return null;
  const width = photo.naturalWidth * 0.68;
  const height = photo.naturalHeight * 0.28;
  const x = (photo.naturalWidth - width) / 2;
  const y = (photo.naturalHeight - height) / 2;
  return {
    tl: { x, y },
    tr: { x: x + width, y },
    br: { x: x + width, y: y + height },
    bl: { x, y: y + height },
  };
}

function regionToQuad(region) {
  if (!region) return null;
  return {
    tl: { x: region.x, y: region.y },
    tr: { x: region.x + region.width, y: region.y },
    br: { x: region.x + region.width, y: region.y + region.height },
    bl: { x: region.x, y: region.y + region.height },
  };
}

function quadBounds(quad) {
  const points = [quad.tl, quad.tr, quad.br, quad.bl];
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function clampPoint(point, photo) {
  return {
    x: Math.max(0, Math.min(photo.naturalWidth, point.x)),
    y: Math.max(0, Math.min(photo.naturalHeight, point.y)),
  };
}

function interpolateQuad(quad, u, v) {
  const topX = quad.tl.x + (quad.tr.x - quad.tl.x) * u;
  const topY = quad.tl.y + (quad.tr.y - quad.tl.y) * u;
  const bottomX = quad.bl.x + (quad.br.x - quad.bl.x) * u;
  const bottomY = quad.bl.y + (quad.br.y - quad.bl.y) * u;
  return {
    x: topX + (bottomX - topX) * v,
    y: topY + (bottomY - topY) * v,
  };
}

async function rectifyQuadToGrid(photo, quad, rows, cols) {
  const img = await loadImage(photo.url);
  const outputWidth = Math.max(600, cols * 220);
  const outputHeight = Math.round((outputWidth * rows) / cols);
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = img.naturalWidth;
  sourceCanvas.height = img.naturalHeight;
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  sourceCtx.drawImage(img, 0, 0);
  const source = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);

  const targetCanvas = document.createElement('canvas');
  targetCanvas.width = outputWidth;
  targetCanvas.height = outputHeight;
  const targetCtx = targetCanvas.getContext('2d');
  const target = targetCtx.createImageData(outputWidth, outputHeight);

  for (let y = 0; y < outputHeight; y += 1) {
    const v = outputHeight === 1 ? 0 : y / (outputHeight - 1);
    for (let x = 0; x < outputWidth; x += 1) {
      const u = outputWidth === 1 ? 0 : x / (outputWidth - 1);
      const sourcePoint = interpolateQuad(quad, u, v);
      const sx = Math.max(0, Math.min(sourceCanvas.width - 1, Math.round(sourcePoint.x)));
      const sy = Math.max(0, Math.min(sourceCanvas.height - 1, Math.round(sourcePoint.y)));
      const sourceOffset = (sy * sourceCanvas.width + sx) * 4;
      const targetOffset = (y * outputWidth + x) * 4;
      target.data[targetOffset] = source.data[sourceOffset];
      target.data[targetOffset + 1] = source.data[sourceOffset + 1];
      target.data[targetOffset + 2] = source.data[sourceOffset + 2];
      target.data[targetOffset + 3] = 255;
    }
  }

  targetCtx.putImageData(target, 0, 0);
  return {
    url: targetCanvas.toDataURL('image/png'),
    name: `${photo.name || '作业照片'} · 校正网格`,
    naturalWidth: outputWidth,
    naturalHeight: outputHeight,
    rows,
    cols,
    generated: true,
  };
}

function createSampleHomeworkPhoto() {
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 700;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fbfaf5';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#1f2937';
  ctx.font = '34px Arial, sans-serif';
  ctx.fillText('图形运动练习：把左边卡片还原成右边图形', 110, 90);
  ctx.fillStyle = '#6b7280';
  ctx.font = '24px Arial, sans-serif';
  ctx.fillText('这里模拟题干文字、手写痕迹和批改线，识别时应优先找方格。', 110, 140);

  function drawWholeGrid(x, y) {
    const cell = 120;
    const gridWidth = cell * 5;
    const gridHeight = cell * 2;
    ctx.fillStyle = '#fff7cc';
    ctx.fillRect(x, y, gridWidth, gridHeight);
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 8;
    ctx.strokeRect(x, y, gridWidth, gridHeight);
    ctx.beginPath();
    for (let col = 1; col < 5; col += 1) {
      ctx.moveTo(x + col * cell, y);
      ctx.lineTo(x + col * cell, y + gridHeight);
    }
    ctx.moveTo(x, y + cell);
    ctx.lineTo(x + gridWidth, y + cell);
    ctx.stroke();

    const sourceCells = [
      [0, 0, '#f8d7a8', '①'],
      [1, 0, '#b7e4c7', '②'],
      [0, 1, '#a9def9', '③'],
      [1, 1, '#ffc8dd', '④'],
    ];
    const targetCells = [
      [3, 0, '#b7e4c7'],
      [4, 0, '#f8d7a8'],
      [3, 1, '#ffc8dd'],
      [4, 1, '#a9def9'],
    ];
    [...sourceCells, ...targetCells].forEach(([col, row, color, label]) => {
      const cellX = x + col * cell + 12;
      const cellY = y + row * cell + 12;
      ctx.fillStyle = color;
      ctx.fillRect(cellX, cellY, 96, 96);
      if (label) {
        ctx.fillStyle = '#111827';
        ctx.font = '38px Arial, sans-serif';
        ctx.fillText(label, cellX + 28, cellY + 62);
      }
    });
    ctx.fillStyle = '#ef4444';
    ctx.font = '58px Arial, sans-serif';
    ctx.fillText('→', x + cell * 2 + 34, y + cell + 18);
  }

  drawWholeGrid(200, 230);
  ctx.strokeStyle = '#e11d48';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(90, 585);
  ctx.lineTo(260, 625);
  ctx.stroke();

  return {
    url: canvas.toDataURL('image/png'),
    name: '示例作业照片.png',
    naturalWidth: canvas.width,
    naturalHeight: canvas.height,
    generated: true,
  };
}

export default function App() {
  const [photo, setPhoto] = useState(null);
  const [mode, setMode] = useState('recognize');
  const [rows, setRows] = useState(DEFAULT_ROWS);
  const [cols, setCols] = useState(DEFAULT_COLS);
  const [cards, setCards] = useState(() => makeCards(DEFAULT_ROWS, DEFAULT_COLS));
  const [selectedId, setSelectedId] = useState(1);
  const [centerKey, setCenterKey] = useState('center');
  const [history, setHistory] = useState([]);
  const [activity, setActivity] = useState('第1步：上传图片');
  const [animatingId, setAnimatingId] = useState(null);
  const [animationEffect, setAnimationEffect] = useState(null);
  const [animationTrace, setAnimationTrace] = useState(null);
  const [motionTraces, setMotionTraces] = useState([]);
  const [motionSettings, setMotionSettings] = useState(defaultMotionSettings);
  const [drag, setDrag] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [selectedRegionId, setSelectedRegionId] = useState(null);
  const [sourceRegionId, setSourceRegionId] = useState(null);
  const [targetRegionId, setTargetRegionId] = useState(null);
  const [regionDrag, setRegionDrag] = useState(null);
  const [calibrationQuad, setCalibrationQuad] = useState(null);
  const [calibrationDrag, setCalibrationDrag] = useState(null);
  const [extractedGrid, setExtractedGrid] = useState(null);
  const [cellRoles, setCellRoles] = useState(() => makeDefaultCellRoles(DEFAULT_ROWS, DEFAULT_COLS));
  const [manualTargetRect, setManualTargetRect] = useState(null);
  const [targetDraftRect, setTargetDraftRect] = useState(null);
  const [targetDrawMode, setTargetDrawMode] = useState(false);
  const [targetRectDrag, setTargetRectDrag] = useState(null);
  const [focusSelectedOnly, setFocusSelectedOnly] = useState(true);
  const [showTargetReference, setShowTargetReference] = useState(true);
  const [targetOpacity, setTargetOpacity] = useState(TARGET_OPACITY_DEFAULT);
  const [manualBlocks, setManualBlocks] = useState([]);
  const [manualDraftBlock, setManualDraftBlock] = useState(null);
  const [manualDrawRole, setManualDrawRole] = useState(null);
  const [manualBlockDrag, setManualBlockDrag] = useState(null);
  const [selectedBlockId, setSelectedBlockId] = useState(null);
  const [wizardStep, setWizardStep] = useState('upload');
  const [gridBox, setGridBox] = useState(null);
  const [gridBoxDrag, setGridBoxDrag] = useState(null);
  const [targetCellIndices, setTargetCellIndices] = useState([]);
  const [cardCellIndices, setCardCellIndices] = useState([]);
  const [cellSelectionDrag, setCellSelectionDrag] = useState(null);
  const [hoverCellIndex, setHoverCellIndex] = useState(null);
  const svgRef = useRef(null);
  const recognizeSvgRef = useRef(null);
  const previewSvgRef = useRef(null);
  const animationTimerRef = useRef(null);
  const animationFrameRef = useRef(null);

  const selectedSourceRegion = candidates.find((candidate) => candidate.id === sourceRegionId);
  const explicitTargetRegion = candidates.find((candidate) => candidate.id === targetRegionId);
  const calibratedWholeRegion = extractedGrid
    ? {
        id: 'calibrated-grid',
        label: '校正后的整块网格',
        x: 0,
        y: 0,
        width: extractedGrid.naturalWidth,
        height: extractedGrid.naturalHeight,
        rows: extractedGrid.rows,
        cols: extractedGrid.cols,
        type: 'wholeGrid',
        ...makeEvenGridLines(extractedGrid.naturalWidth, extractedGrid.naturalHeight, extractedGrid.rows, extractedGrid.cols),
      }
    : null;
  const guidedGridRegion = makeGridRegion(gridBox, rows, cols);
  const guidedTeachingRegion = expandTeachingRegion(guidedGridRegion);
  const guidedTargetRect = rectFromCellIndices(guidedGridRegion, targetCellIndices);
  const guidedTargetCells = useMemo(
    () => targetCellIndices.map((index) => cellRectFromIndex(guidedGridRegion, index)).filter(Boolean),
    [guidedGridRegion, targetCellIndices],
  );
  const selectedWholeRegion = calibratedWholeRegion ?? (selectedSourceRegion ? withGridDefaults(selectedSourceRegion) : null);
  const sourceRegion = selectedWholeRegion ? getSourceOperationRegion(selectedWholeRegion) : null;
  const arrowRegion = getArrowHintRegion(selectedWholeRegion);
  const targetRegion =
    extractedGrid
      ? getTargetReferenceRegion(calibratedWholeRegion)
      : explicitTargetRegion && explicitTargetRegion.id !== selectedSourceRegion?.id
      ? getTargetReferenceRegion(explicitTargetRegion)
      : getTargetReferenceRegion(selectedSourceRegion);
  const roleTargetRect = rectFromRoleCells(selectedWholeRegion, cellRoles, ROLE_TARGET);
  const manualTargetRectFromBlocks = rectFromBlocks(manualBlocks, ROLE_TARGET);
  const hasManualBlocks = manualBlocks.length > 0;
  const activeTargetRect = guidedTargetRect ?? targetDraftRect ?? manualTargetRect ?? manualTargetRectFromBlocks ?? roleTargetRect ?? targetRegion;
  const movableCellCount = cellRoles.filter((role) => role === ROLE_CARD).length;
  const hasGuidedSelection = Boolean(guidedGridRegion && (targetCellIndices.length || cardCellIndices.length));
  const demoPhoto = hasGuidedSelection || hasManualBlocks ? photo : extractedGrid ?? photo;
  const manualTeachingRegion =
    hasManualBlocks && photo
      ? { x: 0, y: 0, width: photo.naturalWidth, height: photo.naturalHeight, rows: 1, cols: 1 }
      : null;
  const teachingRegion =
    (hasGuidedSelection ? guidedTeachingRegion : null) ??
    manualTeachingRegion ??
    selectedWholeRegion ??
    (demoPhoto
      ? { x: 0, y: 0, width: demoPhoto.naturalWidth, height: demoPhoto.naturalHeight, rows, cols }
      : null);
  const recognitionLayout = useMemo(
    () => fitImage(photo?.naturalWidth, photo?.naturalHeight),
    [photo],
  );
  const teachingLayout = useMemo(
    () => fitImage(teachingRegion?.width, teachingRegion?.height),
    [teachingRegion?.height, teachingRegion?.width],
  );
  const activeRows = mode === 'teach' && teachingRegion ? teachingRegion.rows : rows;
  const activeCols = mode === 'teach' && teachingRegion ? teachingRegion.cols : cols;
  const cellWidth = teachingLayout.width / activeCols;
  const cellHeight = teachingLayout.height / activeRows;
  const selectedCard = cards.find((card) => card.id === selectedId) ?? cards[0];
  const targetCells = useMemo(
    () =>
      guidedTargetCells.length
        ? guidedTargetCells
        : cellRoles
        .map((role, index) => (role === ROLE_TARGET ? cellRectFromIndex(selectedWholeRegion, index) : null))
        .filter(Boolean),
    [cellRoles, guidedTargetCells, selectedWholeRegion],
  );
  const canEnterTeaching =
    guidedGridRegion
      ? targetCellIndices.length > 0 && cardCellIndices.length > 0
      : hasManualBlocks
      ? manualBlocks.some((block) => block.role === ROLE_CARD) &&
        manualBlocks.some((block) => block.role === ROLE_TARGET)
      : Boolean(sourceRegion);

  useEffect(() => {
    return () => {
      if (photo?.url?.startsWith('blob:')) URL.revokeObjectURL(photo.url);
      window.clearTimeout(animationTimerRef.current);
      window.cancelAnimationFrame(animationFrameRef.current);
    };
  }, [photo?.url]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('sample') === '1') {
      applyNewPhoto(createSampleHomeworkPhoto(), 2, 5);
      setActivity('示例题已载入，请确认方向后进入下一步');
    }
  }, []);

  function resetCards(nextRows = rows, nextCols = cols) {
    setCards(makeCards(nextRows, nextCols));
    setSelectedId(1);
    setCenterKey('center');
    setHistory([]);
    setMotionTraces([]);
    setActivity('已重新切分卡片');
  }

  function handleRowsChange(value) {
    const nextRows = clampGridSize(value);
    setRows(nextRows);
    setCellRoles(makeDefaultCellRoles(nextRows, cols));
    setTargetCellIndices([]);
    setCardCellIndices([]);
    setManualTargetRect(null);
    setTargetDraftRect(null);
    setCandidates((items) =>
      items.map((item) =>
        item.id === (selectedRegionId ?? sourceRegionId)
          ? { ...item, rows: nextRows, ...makeEvenGridLines(item.width, item.height, nextRows, item.cols) }
          : item,
      ),
    );
  }

  function handleColsChange(value) {
    const nextCols = clampGridSize(value);
    setCols(nextCols);
    setCellRoles(makeDefaultCellRoles(rows, nextCols));
    setTargetCellIndices([]);
    setCardCellIndices([]);
    setManualTargetRect(null);
    setTargetDraftRect(null);
    setCandidates((items) =>
      items.map((item) =>
        item.id === (selectedRegionId ?? sourceRegionId)
          ? { ...item, cols: nextCols, ...makeEvenGridLines(item.width, item.height, item.rows, nextCols) }
          : item,
      ),
    );
  }

  function updateSelectedCard(updater) {
    setCards((currentCards) =>
      currentCards.map((card) =>
        card.id === selectedId ? { ...card, ...updater(card) } : card,
      ),
    );
  }

  function makeTraceId(kind, cardId) {
    return `${kind}-${cardId}-${Date.now()}-${Math.round(Math.random() * 10000)}`;
  }

  function animateCard(cardId, fromValues, toValues, makeMessage, doneMessage, effect = 'move', traceOptions = {}) {
    window.cancelAnimationFrame(animationFrameRef.current);
    const startedAt = performance.now();
    const duration = MOTION_DURATIONS[motionSettings.speed] ?? MOTION_DURATIONS.normal;
    const traceId = traceOptions.id ?? makeTraceId(effect, cardId);
    setAnimatingId(cardId);
    setAnimationEffect(effect);
    setAnimationTrace({ id: traceId, cardId, kind: effect, effect, fromValues, toValues, progress: 0, ...traceOptions });

    function frame(now) {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = easeInOut(progress);
      const nextValues = {};

      Object.keys(toValues).forEach((key) => {
        nextValues[key] = fromValues[key] + (toValues[key] - fromValues[key]) * eased;
      });

      setCards((currentCards) =>
        currentCards.map((card) => (card.id === cardId ? { ...card, ...nextValues } : card)),
      );
      setAnimationTrace({
        id: traceId,
        cardId,
        kind: effect,
        effect,
        fromValues,
        toValues,
        progress: eased,
        ...traceOptions,
      });
      setActivity(makeMessage(progress, nextValues));

      if (progress < 1) {
        animationFrameRef.current = window.requestAnimationFrame(frame);
        return;
      }

      setCards((currentCards) =>
        currentCards.map((card) => (card.id === cardId ? { ...card, ...toValues } : card)),
      );
      setAnimatingId(null);
      setAnimationEffect(null);
      setAnimationTrace(null);
      setMotionTraces((items) => [
        {
          id: traceId,
          cardId,
          kind: effect,
          effect,
          fromValues,
          toValues,
          progress: 1,
          ...traceOptions,
        },
        ...items,
      ]);
      if (traceOptions.historyText) {
        setHistory((items) => [traceOptions.historyText, ...items]);
      }
      setActivity(doneMessage);
    }

    animationFrameRef.current = window.requestAnimationFrame(frame);
  }

  async function handleImageUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    const img = await loadImage(url);
    applyNewPhoto({
      url,
      name: file.name,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
    });
  }

  function applyNewPhoto(nextPhoto, nextRows = DEFAULT_ROWS, nextCols = DEFAULT_COLS) {
    setPhoto((previous) => {
      if (previous?.url?.startsWith('blob:')) URL.revokeObjectURL(previous.url);
      return nextPhoto;
    });
    setMode('recognize');
    setCandidates([]);
    setSelectedRegionId(null);
    setSourceRegionId(null);
    setTargetRegionId(null);
    setExtractedGrid(null);
    setCalibrationQuad(makeDefaultQuad(nextPhoto));
    setCellRoles(makeDefaultCellRoles(nextRows, nextCols));
    setManualTargetRect(null);
    setTargetDraftRect(null);
    setTargetDrawMode(false);
    setTargetRectDrag(null);
    setManualBlocks([]);
    setManualDraftBlock(null);
    setManualDrawRole(null);
    setManualBlockDrag(null);
    setSelectedBlockId(null);
    setWizardStep('upload');
    setGridBox(makeDefaultGridBox(nextPhoto, nextRows, nextCols));
    setGridBoxDrag(null);
    setTargetCellIndices([]);
    setCardCellIndices([]);
    setCellSelectionDrag(null);
    setHoverCellIndex(null);
    setRows(nextRows);
    setCols(nextCols);
    resetCards(nextRows, nextCols);
    setActivity('第1步：上传图片并确认方向');
  }

  function loadSamplePhoto() {
    applyNewPhoto(createSampleHomeworkPhoto(), 2, 5);
    setActivity('示例题已载入，请确认方向后进入下一步');
  }

  async function rotateCurrentPhoto(degrees) {
    if (!photo) return;
    setActivity('正在旋正照片');
    const rotated = await rotatePhoto(photo, degrees);
    setPhoto((previous) => {
      if (previous?.url?.startsWith('blob:')) URL.revokeObjectURL(previous.url);
      return rotated;
    });
    setCandidates([]);
    setSelectedRegionId(null);
    setSourceRegionId(null);
    setTargetRegionId(null);
    setExtractedGrid(null);
    setCalibrationQuad(makeDefaultQuad(rotated));
    setCellRoles(makeDefaultCellRoles(rows, cols));
    setManualTargetRect(null);
    setTargetDraftRect(null);
    setTargetDrawMode(false);
    setManualBlocks([]);
    setManualDraftBlock(null);
    setManualDrawRole(null);
    setManualBlockDrag(null);
    setSelectedBlockId(null);
    setGridBox(makeDefaultGridBox(rotated, rows, cols));
    setGridBoxDrag(null);
    setTargetCellIndices([]);
    setCardCellIndices([]);
    setCellSelectionDrag(null);
    setHoverCellIndex(null);
    setActivity('照片已旋正，请继续确认方向或设置网格');
  }

  async function autoStraightenPhoto() {
    if (!photo) return;
    if (photo.naturalHeight > photo.naturalWidth * 1.15) {
      await rotateCurrentPhoto(-90);
      setActivity('已自动按页面方向旋正，可继续识别');
      return;
    }
    setActivity('照片方向看起来已可识别，如有需要可手动旋转');
  }

  function goToGridStep() {
    if (!photo) return;
    setMode('recognize');
    setWizardStep('grid');
    setGridBox((current) => current ?? makeDefaultGridBox(photo, rows, cols));
    setActivity('第2步：设置网格行列，并拖动网格框覆盖题目方格');
  }

  function confirmGridStep() {
    if (!photo || !guidedGridRegion) {
      setActivity('请先上传图片并设置网格框');
      return;
    }
    setWizardStep('target');
    setTargetCellIndices([]);
    setCardCellIndices([]);
    setActivity('第3步：点击或拖拽选择目标参考图格子');
  }

  function confirmTargetStep() {
    if (!targetCellIndices.length) {
      setActivity('请先选择目标参考图格子');
      return;
    }
    setWizardStep('cards');
    setCardCellIndices((indices) => indices.filter((index) => !targetCellIndices.includes(index)));
    setActivity('第4步：点击选择需要移动的卡片格子');
  }

  function startGridBoxDrag(event, action = 'move') {
    if (!photo || !gridBox || wizardStep !== 'grid') return;
    event.preventDefault();
    event.stopPropagation();
    const point = recognitionPoint(event);
    setGridBoxDrag({
      action,
      start: point,
      original: gridBox,
    });
  }

  function continueGridBoxDrag(event) {
    if (!photo || !gridBoxDrag) return;
    const point = recognitionPoint(event);
    const dx = point.x - gridBoxDrag.start.x;
    const dy = point.y - gridBoxDrag.start.y;
    const original = gridBoxDrag.original;
    const next =
      gridBoxDrag.action === 'resize'
        ? { ...original, width: original.width + dx, height: original.height + dy }
        : { ...original, x: original.x + dx, y: original.y + dy };
    setGridBox(clampGridBox(next, photo));
  }

  function endGridBoxDrag() {
    if (gridBoxDrag) setActivity('网格框已调整');
    setGridBoxDrag(null);
  }

  function startCellSelection(event, index) {
    if (!guidedGridRegion || !['target', 'cards'].includes(wizardStep)) return;
    event.preventDefault();
    event.stopPropagation();
    setCellSelectionDrag({
      start: recognitionPoint(event),
      startIndex: index,
      currentIndices: [index],
      moved: false,
    });
  }

  function continueCellSelection(event) {
    if (!guidedGridRegion) return;
    const point = recognitionPoint(event);
    setHoverCellIndex(cellIndexAtPoint(guidedGridRegion, point));
    if (!cellSelectionDrag) return;
    const rect = {
      x: cellSelectionDrag.start.x,
      y: cellSelectionDrag.start.y,
      width: point.x - cellSelectionDrag.start.x,
      height: point.y - cellSelectionDrag.start.y,
    };
    const nextIndices = cellIndicesInRect(guidedGridRegion, rect);
    setCellSelectionDrag({
      ...cellSelectionDrag,
      currentIndices: nextIndices.length ? nextIndices : [cellSelectionDrag.startIndex],
      moved:
        cellSelectionDrag.moved ||
        Math.abs(point.x - cellSelectionDrag.start.x) > 6 ||
        Math.abs(point.y - cellSelectionDrag.start.y) > 6,
    });
  }

  function endCellSelection() {
    if (!cellSelectionDrag || !['target', 'cards'].includes(wizardStep)) {
      setCellSelectionDrag(null);
      return;
    }
    const selectedIndices = cellSelectionDrag.currentIndices.length
      ? cellSelectionDrag.currentIndices
      : [cellSelectionDrag.startIndex];

    if (wizardStep === 'target') {
      setTargetCellIndices((current) =>
        cellSelectionDrag.moved ? addIndices(current, selectedIndices) : toggleIndex(current, cellSelectionDrag.startIndex),
      );
      setCardCellIndices((current) => current.filter((index) => !selectedIndices.includes(index)));
      setActivity('目标参考图格子已更新');
    } else {
      const allowed = selectedIndices.filter((index) => !targetCellIndices.includes(index));
      setCardCellIndices((current) =>
        cellSelectionDrag.moved ? addIndices(current, allowed) : toggleIndex(current, allowed[0]),
      );
      setActivity(allowed.length ? '移动卡片格子已更新' : '目标参考图格子不能选为移动卡片');
    }

    setCellSelectionDrag(null);
  }

  function clearTargetCells() {
    setTargetCellIndices([]);
    setCardCellIndices([]);
    setActivity('目标参考图已清除');
  }

  function clearCardCells() {
    setCardCellIndices([]);
    setActivity('移动卡片已全部取消');
  }

  async function runAutoDetect() {
    if (!photo) return;
    setActivity('正在识别深色方格线和矩形候选区域');
    const detected = await detectGridCandidates(photo);
    const preferredWholeGrid =
      detected.find((item) => item.type === 'wholeGrid' && item.rows === 2 && item.cols === 5) ??
      detected.find((item) => item.type === 'wholeGrid') ??
      detected[0];
    setCandidates(detected);
    setSelectedRegionId(preferredWholeGrid?.id ?? null);
    setSourceRegionId(preferredWholeGrid?.id ?? null);
    setTargetRegionId(null);
    setExtractedGrid(null);
    setCalibrationQuad(regionToQuad(preferredWholeGrid) ?? makeDefaultQuad(photo));
    setManualTargetRect(null);
    setTargetDraftRect(null);
    setTargetDrawMode(false);
    if (preferredWholeGrid) {
      setRows(preferredWholeGrid.rows);
      setCols(preferredWholeGrid.cols);
      setCellRoles(makeDefaultCellRoles(preferredWholeGrid.rows, preferredWholeGrid.cols));
      setActivity(
        preferredWholeGrid.type === 'wholeGrid'
          ? `已识别整块方格 ${preferredWholeGrid.rows}×${preferredWholeGrid.cols}，请微调校准框后提取`
          : `识别到 ${detected.length} 个候选区域，请指定整块网格`,
      );
    } else {
      setActivity('未识别到候选区域，请手动画框');
    }
  }

  function addManualRegion() {
    if (!photo) return;
    const manual = {
      id: `manual-${Date.now()}`,
      label: `手动画框 ${candidates.filter((item) => item.id.startsWith('manual')).length + 1}`,
      x: photo.naturalWidth * 0.24,
      y: photo.naturalHeight * 0.32,
      width: photo.naturalWidth * 0.56,
      height: photo.naturalHeight * 0.24,
      rows,
      cols,
      type: rows === 2 && cols >= 5 ? 'wholeGrid' : 'grid',
      ...makeEvenGridLines(photo.naturalWidth * 0.56, photo.naturalHeight * 0.24, rows, cols),
      score: 0,
      manual: true,
    };
    setCandidates((items) => [...items, manual]);
    setSelectedRegionId(manual.id);
    setCalibrationQuad(regionToQuad(manual));
    setActivity('已添加手动画框，可拖动或拉右下角缩放');
  }

  function setSelectedAsSource() {
    const selected = candidates.find((item) => item.id === selectedRegionId);
    if (!selected) return;
    setSourceRegionId(selected.id);
    setRows(selected.rows);
    setCols(selected.cols);
    setCellRoles(makeDefaultCellRoles(selected.rows, selected.cols));
    setActivity(`${selected.label} 已设为整块演示网格`);
  }

  function setSelectedAsTarget() {
    const selected = candidates.find((item) => item.id === selectedRegionId);
    if (!selected) return;
    setTargetRegionId(selected.id);
    setActivity(`${selected.label} 已设为目标参考图区域`);
  }

  function startManualBlockMode(role) {
    if (!photo) return;
    setManualDrawRole(role);
    setManualDraftBlock(null);
    setActivity(`请在照片上拖拽新增${roleLabels[role]}`);
  }

  function startManualBlockDraw(event) {
    if (!photo || !manualDrawRole) return;
    event.preventDefault();
    const point = recognitionPoint(event);
    const roleCount = manualBlocks.filter((block) => block.role === manualDrawRole).length + 1;
    const draft = {
      id: `draft-${Date.now()}`,
      name: makeBlockName(manualDrawRole, roleCount),
      role: manualDrawRole,
      x: point.x,
      y: point.y,
      width: 0,
      height: 0,
    };
    setManualDraftBlock(draft);
    setManualBlockDrag({
      id: draft.id,
      action: 'draw',
      start: point,
      original: draft,
    });
  }

  function startManualBlockDrag(event, block, action = 'move') {
    if (!photo) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedBlockId(block.id);
    const point = recognitionPoint(event);
    setManualBlockDrag({
      id: block.id,
      action,
      start: point,
      original: block,
    });
  }

  function continueManualBlockDrag(event) {
    if (!photo || !manualBlockDrag) return;
    const point = recognitionPoint(event);
    const dx = point.x - manualBlockDrag.start.x;
    const dy = point.y - manualBlockDrag.start.y;
    const original = manualBlockDrag.original;
    let next = original;

    if (manualBlockDrag.action === 'draw') {
      next = { ...original, width: dx, height: dy };
    } else if (manualBlockDrag.action === 'move') {
      next = { ...original, x: original.x + dx, y: original.y + dy };
    } else if (manualBlockDrag.action === 'resize') {
      next = { ...original, width: original.width + dx, height: original.height + dy };
    }

    const normalized = {
      ...next,
      ...normalizeRect(next, { width: photo.naturalWidth, height: photo.naturalHeight }),
    };

    if (manualBlockDrag.action === 'draw') {
      setManualDraftBlock(normalized);
      return;
    }

    setManualBlocks((blocks) =>
      blocks.map((block) => (block.id === manualBlockDrag.id ? normalized : block)),
    );
  }

  function endManualBlockDrag() {
    if (manualBlockDrag?.action === 'draw' && manualDraftBlock && manualDraftBlock.width > 12 && manualDraftBlock.height > 12) {
      const nextBlock = {
        ...manualDraftBlock,
        id: `block-${Date.now()}`,
      };
      setManualBlocks((blocks) => [...blocks, nextBlock]);
      setSelectedBlockId(nextBlock.id);
      setManualDrawRole(null);
      setActivity(`${nextBlock.name} 已添加`);
    } else if (manualBlockDrag) {
      setActivity('图片块已调整');
    }
    setManualDraftBlock(null);
    setManualBlockDrag(null);
  }

  function updateManualBlock(blockId, updates) {
    setManualBlocks((blocks) =>
      blocks.map((block) => (block.id === blockId ? { ...block, ...updates } : block)),
    );
  }

  function deleteManualBlock(blockId) {
    setManualBlocks((blocks) => blocks.filter((block) => block.id !== blockId));
    if (selectedBlockId === blockId) setSelectedBlockId(null);
    setActivity('图片块已删除');
  }

  function startTeaching() {
    if (guidedGridRegion && targetCellIndices.length && cardCellIndices.length) {
      const nextCards = makeGridTeachingCards(guidedGridRegion, cardCellIndices);
      const nextTargetRect = rectFromCellIndices(guidedGridRegion, targetCellIndices);
      if (!nextCards.length || !nextTargetRect) {
        setActivity('请先选择目标参考图和移动卡片');
        return;
      }
      setManualTargetRect(nextTargetRect);
      setTargetDraftRect(null);
      setExtractedGrid(null);
      setCards(nextCards);
      setSelectedId(nextCards[0].id);
      setCenterKey(nextCards[0].rotationCenter);
      setHistory([]);
      setFocusSelectedOnly(true);
      setShowTargetReference(true);
      setTargetOpacity(TARGET_OPACITY_DEFAULT);
      setMode('teach');
      setWizardStep('teach');
      setActivity(`已进入教学演示：${nextCards.length} 张移动卡片，目标参考图固定显示`);
      return;
    }

    if (hasManualBlocks) {
      const nextCards = makeManualTeachingCards(manualBlocks);
      const nextTargetRect = rectFromBlocks(manualBlocks, ROLE_TARGET);
      if (!nextCards.length) {
        setActivity('请至少新增一个可移动卡片框');
        return;
      }
      if (!nextTargetRect) {
        setActivity('请至少新增一个目标参考图框');
        return;
      }
      setExtractedGrid(null);
      setManualTargetRect(nextTargetRect);
      setTargetDraftRect(null);
      setCards(nextCards);
      setSelectedId(nextCards[0].id);
      setCenterKey(nextCards[0].rotationCenter);
      setHistory([]);
      setFocusSelectedOnly(true);
      setShowTargetReference(true);
      setMode('teach');
      setActivity(`已进入教学演示：${nextCards.length} 张手工卡片，目标参考图固定显示`);
      return;
    }

    const fallbackWholeRegion =
      selectedSourceRegion ?? candidates.find((item) => item.id === selectedRegionId);
    const wholeRegion = calibratedWholeRegion ?? (fallbackWholeRegion ? withGridDefaults(fallbackWholeRegion) : null);
    if (!wholeRegion) {
      setActivity('请按步骤设置网格、目标参考图和移动卡片');
      return;
    }
    const nextRoles =
      cellRoles.length === wholeRegion.rows * wholeRegion.cols
        ? cellRoles
        : makeDefaultCellRoles(wholeRegion.rows, wholeRegion.cols);
    const nextCards = makeTeachingCards(wholeRegion.rows, wholeRegion.cols, nextRoles).map((card) => ({
      ...card,
      sourceRect: cellRectFromIndex(wholeRegion, card.sourceIndex),
    }));
    if (!nextCards.length) {
      setActivity('请至少将一个格子设为可移动卡片');
      return;
    }
    const nextTargetRect = manualTargetRect ?? rectFromRoleCells(wholeRegion, nextRoles, ROLE_TARGET);
    if (!nextTargetRect) {
      setActivity('请先设置目标参考图，或手动画目标参考图');
      return;
    }
    if (!sourceRegionId && fallbackWholeRegion) setSourceRegionId(fallbackWholeRegion.id);
    setCellRoles(nextRoles);
    setCards(nextCards);
    setSelectedId(nextCards[0].id);
    setCenterKey(nextCards[0].rotationCenter);
    setHistory([]);
    setFocusSelectedOnly(true);
    setShowTargetReference(true);
    setMode('teach');
    setActivity(
      `已进入教学演示：${nextCards.length} 张可移动卡片，目标参考图固定显示`,
    );
  }

  function recognitionPoint(event) {
    const svg = recognizeSvgRef.current;
    if (!svg || !photo) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const converted = point.matrixTransform(svg.getScreenCTM().inverse());
    const scale = recognitionLayout.width / photo.naturalWidth;
    return {
      x: (converted.x - recognitionLayout.x) / scale,
      y: (converted.y - recognitionLayout.y) / scale,
    };
  }

  function updateRegion(id, updater) {
    if (!photo) return;
    setCandidates((items) =>
      items.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, ...updater(item) };
        next.width = Math.max(REGION_MIN_SIZE, Math.min(next.width, photo.naturalWidth - next.x));
        next.height = Math.max(REGION_MIN_SIZE, Math.min(next.height, photo.naturalHeight - next.y));
        next.x = Math.max(0, Math.min(next.x, photo.naturalWidth - next.width));
        next.y = Math.max(0, Math.min(next.y, photo.naturalHeight - next.height));
        return {
          ...next,
          type: next.rows === 2 && next.cols >= 5 ? 'wholeGrid' : next.type,
          ...makeEvenGridLines(next.width, next.height, next.rows, next.cols),
        };
      }),
    );
  }

  function startCalibrationDrag(event, action) {
    if (!photo || !calibrationQuad) return;
    event.preventDefault();
    event.stopPropagation();
    const point = recognitionPoint(event);
    setCalibrationDrag({
      action,
      start: point,
      original: calibrationQuad,
    });
  }

  function continueCalibrationDrag(event) {
    if (!photo || !calibrationDrag) return;
    const point = recognitionPoint(event);
    const dx = point.x - calibrationDrag.start.x;
    const dy = point.y - calibrationDrag.start.y;
    const original = calibrationDrag.original;
    const movePoint = (corner) => clampPoint({ x: original[corner].x + dx, y: original[corner].y + dy }, photo);
    const next = { ...original };

    if (calibrationDrag.action === 'move') {
      Object.keys(next).forEach((corner) => {
        next[corner] = movePoint(corner);
      });
    } else if (['tl', 'tr', 'br', 'bl'].includes(calibrationDrag.action)) {
      next[calibrationDrag.action] = movePoint(calibrationDrag.action);
    } else if (calibrationDrag.action === 'top') {
      next.tl = clampPoint({ x: original.tl.x, y: original.tl.y + dy }, photo);
      next.tr = clampPoint({ x: original.tr.x, y: original.tr.y + dy }, photo);
    } else if (calibrationDrag.action === 'right') {
      next.tr = clampPoint({ x: original.tr.x + dx, y: original.tr.y }, photo);
      next.br = clampPoint({ x: original.br.x + dx, y: original.br.y }, photo);
    } else if (calibrationDrag.action === 'bottom') {
      next.br = clampPoint({ x: original.br.x, y: original.br.y + dy }, photo);
      next.bl = clampPoint({ x: original.bl.x, y: original.bl.y + dy }, photo);
    } else if (calibrationDrag.action === 'left') {
      next.tl = clampPoint({ x: original.tl.x + dx, y: original.tl.y }, photo);
      next.bl = clampPoint({ x: original.bl.x + dx, y: original.bl.y }, photo);
    }

    setCalibrationQuad(next);
  }

  function endCalibrationDrag() {
    if (calibrationDrag) setActivity('网格校准框已调整');
    setCalibrationDrag(null);
  }

  async function extractCalibratedGrid() {
    if (!photo || !calibrationQuad) {
      setActivity('请先上传照片并调整网格校准框');
      return;
    }
    const nextRows = clampGridSize(rows);
    const nextCols = clampGridSize(cols);
    setActivity('正在校正并提取整块网格');
    const extracted = await rectifyQuadToGrid(photo, calibrationQuad, nextRows, nextCols);
    const nextRoles = makeDefaultCellRoles(nextRows, nextCols);
    setExtractedGrid(extracted);
    setRows(nextRows);
    setCols(nextCols);
    setCellRoles(nextRoles);
    setManualTargetRect(null);
    setTargetDraftRect(null);
    setTargetDrawMode(false);
    setTargetRectDrag(null);
    setCandidates([
      {
        id: 'calibrated-preview',
        label: '校正后的整块网格',
        x: 0,
        y: 0,
        width: extracted.naturalWidth,
        height: extracted.naturalHeight,
        rows: nextRows,
        cols: nextCols,
        type: 'wholeGrid',
        ...makeEvenGridLines(extracted.naturalWidth, extracted.naturalHeight, nextRows, nextCols),
      },
    ]);
    setSourceRegionId('calibrated-preview');
    setSelectedRegionId('calibrated-preview');
    setActivity(`已校正并提取 ${nextRows}×${nextCols} 网格，可预览后进入教学`);
  }

  function updateCellRole(index, role) {
    const expectedLength = rows * cols;
    setCellRoles((currentRoles) => {
      const nextRoles =
        currentRoles.length === expectedLength
          ? [...currentRoles]
          : makeDefaultCellRoles(rows, cols);
      nextRoles[index] = role;
      return nextRoles;
    });
    if (role !== ROLE_TARGET) {
      setTargetDraftRect(null);
    }
    setActivity(`第${Math.floor(index / cols) + 1}行第${(index % cols) + 1}列已设为${roleLabels[role]}`);
  }

  function cycleCellRole(index) {
    const role = cellRoles[index] ?? ROLE_IGNORE;
    const nextRole =
      role === ROLE_CARD ? ROLE_TARGET : role === ROLE_TARGET ? ROLE_IGNORE : ROLE_CARD;
    updateCellRole(index, nextRole);
  }

  function previewPoint(event) {
    const svg = previewSvgRef.current;
    if (!svg || !extractedGrid) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(svg.getScreenCTM().inverse());
  }

  function startTargetRectDrag(event, action) {
    if (!extractedGrid || !activeTargetRect) return;
    event.preventDefault();
    event.stopPropagation();
    setTargetRectDrag({
      action,
      start: previewPoint(event),
      original: activeTargetRect,
    });
  }

  function startTargetDraw(event) {
    if (!targetDrawMode || !extractedGrid) return;
    event.preventDefault();
    const point = previewPoint(event);
    const original = { x: point.x, y: point.y, width: 0, height: 0 };
    setTargetDraftRect(normalizeRect(original, extractedGrid));
    setTargetRectDrag({
      action: 'draw',
      start: point,
      original,
    });
  }

  function continueTargetRectDrag(event) {
    if (!targetRectDrag || !extractedGrid) return;
    const point = previewPoint(event);
    const dx = point.x - targetRectDrag.start.x;
    const dy = point.y - targetRectDrag.start.y;
    const original = targetRectDrag.original;
    let next = original;

    if (targetRectDrag.action === 'move') {
      next = { ...original, x: original.x + dx, y: original.y + dy };
    } else if (targetRectDrag.action === 'draw') {
      next = { ...original, width: dx, height: dy };
    } else if (targetRectDrag.action === 'tl') {
      next = {
        x: original.x + dx,
        y: original.y + dy,
        width: original.width - dx,
        height: original.height - dy,
      };
    } else if (targetRectDrag.action === 'tr') {
      next = {
        x: original.x,
        y: original.y + dy,
        width: original.width + dx,
        height: original.height - dy,
      };
    } else if (targetRectDrag.action === 'br') {
      next = { ...original, width: original.width + dx, height: original.height + dy };
    } else if (targetRectDrag.action === 'bl') {
      next = {
        x: original.x + dx,
        y: original.y,
        width: original.width - dx,
        height: original.height + dy,
      };
    }

    setTargetDraftRect(normalizeRect(next, extractedGrid));
  }

  function endTargetRectDrag() {
    if (targetRectDrag) setActivity('目标参考图框已调整');
    setTargetRectDrag(null);
  }

  function beginTargetDrawMode() {
    const fallback = activeTargetRect ?? rectFromRoleCells(calibratedWholeRegion, cellRoles, ROLE_TARGET);
    setTargetDraftRect(fallback);
    setTargetDrawMode(true);
    setActivity('请在预览图上拖拽画出目标参考图');
  }

  function confirmTargetReference() {
    if (!targetDraftRect) {
      setActivity('请先画出目标参考图框');
      return;
    }
    setManualTargetRect(targetDraftRect);
    setTargetDrawMode(false);
    setTargetRectDrag(null);
    setActivity('目标参考图已确认，进入教学后将固定半透明显示');
  }

  function resetTeachingCards() {
    if (guidedGridRegion && cardCellIndices.length) {
      const nextCards = makeGridTeachingCards(guidedGridRegion, cardCellIndices);
      setCards(nextCards);
      setSelectedId(nextCards[0]?.id ?? 1);
      setCenterKey('center');
      setHistory([]);
      setMotionTraces([]);
      setActivity('已重置全部移动卡片');
      return;
    }
    if (hasManualBlocks) {
      const nextCards = makeManualTeachingCards(manualBlocks);
      setCards(nextCards);
      setSelectedId(nextCards[0]?.id ?? 1);
      setCenterKey('center');
      setHistory([]);
      setMotionTraces([]);
      setActivity('已重置全部手工卡片');
      return;
    }
    if (!selectedWholeRegion) return;
    const nextRoles =
      cellRoles.length === selectedWholeRegion.rows * selectedWholeRegion.cols
        ? cellRoles
        : makeDefaultCellRoles(selectedWholeRegion.rows, selectedWholeRegion.cols);
    const nextCards = makeTeachingCards(selectedWholeRegion.rows, selectedWholeRegion.cols, nextRoles);
    setCards(nextCards);
    setSelectedId(nextCards[0]?.id ?? 1);
    setCenterKey('center');
    setHistory([]);
    setMotionTraces([]);
    setActivity('已重置全部可移动卡片');
  }

  function resetCurrentCard() {
    if (!selectedCard) return;
    setCards((currentCards) =>
      currentCards.map((card) =>
        card.id === selectedId
          ? { ...card, tx: 0, ty: 0, rotation: 0, rotationCenter: 'center' }
          : card,
      ),
    );
    setCenterKey('center');
    setMotionTraces((items) => items.filter((trace) => trace.cardId !== selectedId));
    setActivity(`卡片 ${selectedId} 已重置`);
  }

  function clearCurrentMotionTraces() {
    if (!selectedCard) return;
    setMotionTraces((items) => items.filter((trace) => trace.cardId !== selectedId));
    if (animationTrace?.cardId === selectedId) setAnimationTrace(null);
    setActivity(`卡片 ${selectedId} 的轨迹已清除`);
  }

  function clearAllMotionTraces() {
    setMotionTraces([]);
    setAnimationTrace(null);
    setActivity('全部运动轨迹已清除');
  }

  function selectAdjacentCard(direction) {
    if (!cards.length) return;
    const currentIndex = Math.max(0, cards.findIndex((card) => card.id === selectedId));
    const nextIndex = (currentIndex + direction + cards.length) % cards.length;
    selectCard(cards[nextIndex].id);
  }

  function startRegionDrag(event, candidate, action = 'move') {
    event.preventDefault();
    event.stopPropagation();
    const point = recognitionPoint(event);
    setSelectedRegionId(candidate.id);
    setRows(candidate.rows);
    setCols(candidate.cols);
    setCellRoles(makeDefaultCellRoles(candidate.rows, candidate.cols));
    setManualTargetRect(null);
    setTargetDraftRect(null);
    setRegionDrag({
      id: candidate.id,
      action,
      startX: point.x,
      startY: point.y,
      original: candidate,
    });
  }

  function continueRegionDrag(event) {
    if (!regionDrag) return;
    const point = recognitionPoint(event);
    const dx = point.x - regionDrag.startX;
    const dy = point.y - regionDrag.startY;
    updateRegion(regionDrag.id, () => {
      if (regionDrag.action === 'resize') {
        return {
          width: regionDrag.original.width + dx,
          height: regionDrag.original.height + dy,
        };
      }
      return {
        x: regionDrag.original.x + dx,
        y: regionDrag.original.y + dy,
      };
    });
  }

  function endRegionDrag() {
    if (regionDrag) setActivity('识别框已校正');
    setRegionDrag(null);
  }

  function svgPoint(event) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(svg.getScreenCTM().inverse());
  }

  function getCardDisplayFrame(card, overrides = {}) {
    if (!teachingRegion) return null;
    const sourceRect =
      card.sourceRect ?? {
        x: teachingRegion.x + card.col * (teachingRegion.width / activeCols),
        y: teachingRegion.y + card.row * (teachingRegion.height / activeRows),
        width: teachingRegion.width / activeCols,
        height: teachingRegion.height / activeRows,
      };
    const tx = overrides.tx ?? card.tx;
    const ty = overrides.ty ?? card.ty;
    const rotation = overrides.rotation ?? card.rotation;
    const width = sourceRect.width * sourceScale;
    const height = sourceRect.height * sourceScale;
    return {
      x: teachingLayout.x + (sourceRect.x - teachingRegion.x) * sourceScale + tx,
      y: teachingLayout.y + (sourceRect.y - teachingRegion.y) * sourceScale + ty,
      width,
      height,
      rotation,
      sourceRect,
      pivot: {
        x: centers[overrides.rotationCenter ?? card.rotationCenter].x * width,
        y: centers[overrides.rotationCenter ?? card.rotationCenter].y * height,
      },
    };
  }

  function moveCard(direction) {
    if (!selectedCard) return;
    const meta = moveMeta[direction];
    const selectedStepWidth = selectedCard.sourceRect ? selectedCard.sourceRect.width * sourceScale : cellWidth;
    const selectedStepHeight = selectedCard.sourceRect ? selectedCard.sourceRect.height * sourceScale : cellHeight;
    const from = { tx: selectedCard.tx, ty: selectedCard.ty };
    const to = {
      tx: selectedCard.tx + meta.dx * selectedStepWidth,
      ty: selectedCard.ty + meta.dy * selectedStepHeight,
    };
    const fromFrame = getCardDisplayFrame(selectedCard, from);
    const toFrame = getCardDisplayFrame(selectedCard, to);
    animateCard(
      selectedId,
      from,
      to,
      (progress) => `卡片 ${selectedId} 正在${meta.label}：${Math.round(progress * 100)}%`,
      `卡片 ${selectedId} ${meta.short}完成`,
      'move',
      {
        label: meta.label.replace(/\s/g, ''),
        fromFrame,
        toFrame,
        historyText: `卡片 ${selectedId}：${meta.label}`,
      },
    );
  }

  function rotateCard(degrees, label) {
    if (!selectedCard) return;
    const centerLabel = centers[centerKey].label;
    const from = { rotation: selectedCard.rotation };
    const to = { rotation: selectedCard.rotation + degrees };
    const fromFrame = getCardDisplayFrame(selectedCard, { rotation: from.rotation, rotationCenter: centerKey });
    const toFrame = getCardDisplayFrame(selectedCard, { rotation: to.rotation, rotationCenter: centerKey });
    updateSelectedCard(() => ({ rotationCenter: centerKey }));
    animateCard(
      selectedId,
      from,
      to,
      (_progress, values) =>
        `卡片 ${selectedId} 正在绕${centerLabel}${label}：当前旋转 ${Math.round(Math.abs(values.rotation - from.rotation))}°`,
      `卡片 ${selectedId} 绕${centerLabel}${label}完成`,
      'rotate',
      {
        label: `${centerLabel}${label}`,
        fromFrame,
        toFrame,
        pivot: fromFrame?.pivot,
        historyText: `卡片 ${selectedId}：绕${centerLabel}${label}`,
      },
    );
  }

  function selectCard(cardId) {
    setSelectedId(cardId);
    const card = cards.find((item) => item.id === cardId);
    setCenterKey(card?.rotationCenter ?? 'center');
    setActivity(`当前选中卡片 ${cardId}`);
  }

  function startDrag(event, card) {
    event.preventDefault();
    selectCard(card.id);
    const point = svgPoint(event);
    const startFrame = getCardDisplayFrame(card);
    const traceId = makeTraceId('drag', card.id);
    setDrag({
      cardId: card.id,
      startX: point.x,
      startY: point.y,
      originalTx: card.tx,
      originalTy: card.ty,
      startFrame,
      traceId,
      moved: false,
    });
    window.cancelAnimationFrame(animationFrameRef.current);
    setAnimatingId(null);
    setAnimationEffect(null);
    setAnimationTrace({
      id: traceId,
      cardId: card.id,
      kind: 'move',
      effect: 'move',
      label: '拖动平移',
      fromValues: { tx: card.tx, ty: card.ty },
      toValues: { tx: card.tx, ty: card.ty },
      fromFrame: startFrame,
      toFrame: startFrame,
      progress: 0,
    });
    setActivity(`拖动卡片 ${card.id} 进行平移`);
  }

  function continueDrag(event) {
    if (!drag) return;
    const point = svgPoint(event);
    const nextTx = drag.originalTx + point.x - drag.startX;
    const nextTy = drag.originalTy + point.y - drag.startY;
    setCards((currentCards) =>
      currentCards.map((card) =>
        card.id === drag.cardId ? { ...card, tx: nextTx, ty: nextTy } : card,
      ),
    );
    const draggedCard = cards.find((card) => card.id === drag.cardId);
    const toFrame = draggedCard ? getCardDisplayFrame(draggedCard, { tx: nextTx, ty: nextTy }) : drag.startFrame;
    setAnimationTrace({
      id: drag.traceId,
      cardId: drag.cardId,
      kind: 'move',
      effect: 'move',
      label: '拖动平移',
      fromValues: { tx: drag.originalTx, ty: drag.originalTy },
      toValues: { tx: nextTx, ty: nextTy },
      fromFrame: drag.startFrame,
      toFrame,
      progress: 1,
    });
    setDrag((current) => (current ? { ...current, moved: true } : current));
  }

  function endDrag() {
    if (!drag) return;
    if (drag.moved) {
      setMotionTraces((items) =>
        animationTrace
          ? [{ ...animationTrace, id: drag.traceId, progress: 1 }, ...items]
          : items,
      );
      setHistory((items) => [`卡片 ${drag.cardId}：拖动平移到新位置`, ...items]);
      setActivity(`卡片 ${drag.cardId} 拖动平移到新位置`);
    }
    setAnimationTrace(null);
    setDrag(null);
  }

  function changeCenter(nextCenterKey) {
    setCenterKey(nextCenterKey);
    updateSelectedCard(() => ({ rotationCenter: nextCenterKey }));
    setActivity(`旋转中心：${centers[nextCenterKey].label}`);
  }

  function replayCurrentMoveTrace() {
    if (!selectedCard) return;
    const trace = motionTraces.find(
      (item) => item.cardId === selectedId && item.kind === 'move' && item.fromValues && item.toValues,
    );
    if (!trace) return;
    setCards((currentCards) =>
      currentCards.map((card) =>
        card.id === selectedId ? { ...card, ...trace.fromValues } : card,
      ),
    );
    animateCard(
      selectedId,
      trace.fromValues,
      trace.toValues,
      (progress) => `卡片 ${selectedId} 正在演示移动：${Math.round(progress * 100)}%`,
      `卡片 ${selectedId} 演示移动完成`,
      'move',
      {
        label: trace.label ?? '演示移动',
        fromFrame: trace.fromFrame,
        toFrame: trace.toFrame,
        historyText: `卡片 ${selectedId}：演示移动`,
      },
    );
  }

  const photoScale = photo ? recognitionLayout.width / photo.naturalWidth : 1;
  const sourceScale = teachingRegion ? teachingLayout.width / teachingRegion.width : 1;
  const targetDisplayRect =
    activeTargetRect && teachingRegion
      ? {
          x: teachingLayout.x + (activeTargetRect.x - teachingRegion.x) * sourceScale,
          y: teachingLayout.y + (activeTargetRect.y - teachingRegion.y) * sourceScale,
          width: activeTargetRect.width * sourceScale,
          height: activeTargetRect.height * sourceScale,
        }
      : null;
  const targetImageX = teachingRegion ? teachingLayout.x - teachingRegion.x * sourceScale : 0;
  const targetImageY = teachingRegion ? teachingLayout.y - teachingRegion.y * sourceScale : 0;
  const targetImageWidth = demoPhoto ? demoPhoto.naturalWidth * sourceScale : 0;
  const targetImageHeight = demoPhoto ? demoPhoto.naturalHeight * sourceScale : 0;
  const visibleGridRegion = hasGuidedSelection && guidedGridRegion ? guidedGridRegion : teachingRegion;
  const visibleGridDisplayRect =
    visibleGridRegion && teachingRegion
      ? {
          x: teachingLayout.x + (visibleGridRegion.x - teachingRegion.x) * sourceScale,
          y: teachingLayout.y + (visibleGridRegion.y - teachingRegion.y) * sourceScale,
          width: visibleGridRegion.width * sourceScale,
          height: visibleGridRegion.height * sourceScale,
          rows: visibleGridRegion.rows,
          cols: visibleGridRegion.cols,
        }
      : null;

  function getCardAlignment(card) {
    if (!teachingRegion) return { className: 'off-target', message: '' };
    const cardIndex = Math.max(0, cards.findIndex((item) => item.id === card.id));
    const cardSourceRect =
      card.sourceRect ?? {
        x: teachingRegion.x + card.col * (teachingRegion.width / activeCols),
        y: teachingRegion.y + card.row * (teachingRegion.height / activeRows),
        width: teachingRegion.width / activeCols,
        height: teachingRegion.height / activeRows,
      };
    const targetCell =
      targetCells[cardIndex % targetCells.length] ??
      activeTargetRect;
    if (!targetCell) return { className: 'off-target', message: '' };
    const currentX = teachingLayout.x + (cardSourceRect.x - teachingRegion.x) * sourceScale + card.tx;
    const currentY = teachingLayout.y + (cardSourceRect.y - teachingRegion.y) * sourceScale + card.ty;
    const targetX = teachingLayout.x + (targetCell.x - teachingRegion.x) * sourceScale;
    const targetY = teachingLayout.y + (targetCell.y - teachingRegion.y) * sourceScale;
    const distance = Math.hypot(currentX - targetX, currentY - targetY);
    const angle = normalizeAngle(card.rotation);
    const angleDistance = Math.min(angle, 360 - angle);
    if (distance <= 16 && angleDistance <= 8) {
      return { className: 'aligned', message: '已基本重合' };
    }
    if (distance <= 55) {
      return { className: 'near-target', message: '接近目标位置' };
    }
    return { className: 'off-target', message: '' };
  }

  const selectedAlignment = selectedCard ? getCardAlignment(selectedCard) : { message: '' };
  const activeWizardStep = mode === 'teach' ? 'teach' : wizardStep;
  const selectionPreviewIndices = cellSelectionDrag?.currentIndices ?? [];
  const canReplayCurrentMove = motionTraces.some(
    (trace) => trace.cardId === selectedId && trace.kind === 'move' && trace.fromValues && trace.toValues,
  );

  const cardNodes = teachingRegion
    ? cards
        .filter((card) => !focusSelectedOnly || card.id === selectedId)
        .map((card) => {
    const sourceRect =
      card.sourceRect ?? {
        x: teachingRegion.x + card.col * (teachingRegion.width / activeCols),
        y: teachingRegion.y + card.row * (teachingRegion.height / activeRows),
        width: teachingRegion.width / activeCols,
        height: teachingRegion.height / activeRows,
      };
    const displayWidth = sourceRect.width * sourceScale;
    const displayHeight = sourceRect.height * sourceScale;
    const originalX = teachingLayout.x + (sourceRect.x - teachingRegion.x) * sourceScale;
    const originalY = teachingLayout.y + (sourceRect.y - teachingRegion.y) * sourceScale;
    const center = centers[card.rotationCenter];
    const pivotX = center.x * displayWidth;
    const pivotY = center.y * displayHeight;
    const selected = card.id === selectedId;
    const isAnimating = card.id === animatingId;
    const imageX = demoPhoto && teachingRegion ? -sourceRect.x * sourceScale : 0;
    const imageY = demoPhoto && teachingRegion ? -sourceRect.y * sourceScale : 0;
    const alignment = getCardAlignment(card);
    const traceRecords = [
      ...motionTraces.filter((trace) => trace.cardId === card.id),
      ...(animationTrace?.cardId === card.id ? [animationTrace] : []),
    ];
    const traceShapes = traceRecords
      .filter((trace) => trace.fromFrame && trace.toFrame)
      .map((trace) =>
        trace.kind === 'rotate'
          ? buildRotationTrace({
              id: trace.id,
              cardId: trace.cardId,
              from: trace.fromFrame,
              to: trace.toFrame,
              pivot: trace.pivot ?? { x: pivotX, y: pivotY },
              label: trace.label,
              progress: trace.progress,
            })
          : buildLineTrace({
              id: trace.id,
              cardId: trace.cardId,
              from: trace.fromFrame,
              to: trace.toFrame,
              label: trace.label,
              progress: trace.progress,
            }),
      );

    function renderFrame(rect, className) {
      return (
        <g transform={`translate(${rect.x} ${rect.y}) rotate(${rect.rotation ?? 0} ${pivotX} ${pivotY})`}>
          <rect x="0" y="0" width={rect.width} height={rect.height} rx="6" className={className} />
        </g>
      );
    }

    return (
      <g key={card.id}>
        <defs>
          <clipPath id={`clip-card-${card.id}`}>
            <rect x="0" y="0" width={displayWidth} height={displayHeight} rx="4" />
          </clipPath>
        </defs>
        {motionSettings.showFrames && (
          <rect
            x={originalX}
            y={originalY}
            width={displayWidth}
            height={displayHeight}
            className="original-frame"
          />
        )}
        {traceShapes.map((shape) => (
          <g key={shape.id} className={`motion-trace ${shape.kind}-trace`} pointerEvents="none">
            {motionSettings.showFrames && renderFrame(shape.from, 'motion-start-frame')}
            {motionSettings.showFrames && renderFrame(shape.to, 'motion-target-frame')}
            {motionSettings.showPath && shape.kind === 'move' && (
              <>
                <line
                  x1={shape.path.x1}
                  y1={shape.path.y1}
                  x2={shape.path.x2}
                  y2={shape.path.y2}
                  className="motion-path-line"
                />
                <circle cx={shape.path.x1} cy={shape.path.y1} r="7" className="motion-path-start" />
                <circle cx={shape.path.fullX2} cy={shape.path.fullY2} r="8" className="motion-path-end" />
                <text x={shape.path.x2 + 12} y={shape.path.y2 - 12} className="motion-label">
                  {shape.label}
                </text>
              </>
            )}
            {motionSettings.showPath && shape.kind === 'rotate' && (
              <>
                <path
                  d={shape.arcPath}
                  className="rotation-path-arc"
                />
                <circle cx={shape.center.x} cy={shape.center.y} r="8" className="rotation-path-center" />
                <circle cx={shape.arcEnd.x} cy={shape.arcEnd.y} r="8" className="rotation-path-end" />
                <text x={shape.center.x + 14} y={shape.center.y - shape.radius - 12} className="motion-label rotate-label">
                  当前旋转：{Math.round(Math.abs(shape.current.rotation - shape.from.rotation))}°
                </text>
              </>
            )}
          </g>
        ))}
        <g
          className={[
            'card-motion',
            selected ? 'selected-card-motion' : '',
            isAnimating ? 'is-animating' : '',
            isAnimating && animationEffect ? `effect-${animationEffect}` : '',
            alignment.className,
          ].join(' ')}
          transform={`translate(${originalX + card.tx} ${originalY + card.ty}) rotate(${card.rotation} ${pivotX} ${pivotY})`}
          onPointerDown={(event) => startDrag(event, card)}
          onClick={() => selectCard(card.id)}
        >
          {isAnimating && (
            <rect
              x="-8"
              y="-8"
              width={displayWidth + 16}
              height={displayHeight + 16}
              rx="10"
              className={`animation-aura effect-${animationEffect}`}
            />
          )}
          {demoPhoto?.url ? (
            <image
              href={demoPhoto.url}
              x={imageX}
              y={imageY}
              width={demoPhoto.naturalWidth * sourceScale}
              height={demoPhoto.naturalHeight * sourceScale}
              preserveAspectRatio="none"
              clipPath={`url(#clip-card-${card.id})`}
            />
          ) : (
            <rect x="0" y="0" width={cellWidth} height={cellHeight} className="placeholder-tile" />
          )}
          <rect
            x="0"
            y="0"
            width={displayWidth}
            height={displayHeight}
            className={selected ? `card-frame selected ${alignment.className}` : 'card-frame'}
          />
          {isAnimating && animationEffect === 'rotate' && (
            <g className="rotation-effect" pointerEvents="none">
              <ellipse
                cx={pivotX}
                cy={pivotY}
                rx={displayWidth / 2 + 16}
                ry={displayHeight / 2 + 16}
                className="rotation-ring"
              />
              <circle cx={pivotX + displayWidth / 2 + 16} cy={pivotY} r="8" className="rotation-spark" />
            </g>
          )}
          <circle cx={pivotX} cy={pivotY} r={selected ? 9 : 6} className="pivot-dot" />
        </g>
      </g>
    );
        })
    : [];

  return (
    <main className="app-shell">
      <section className="stage-panel" aria-label="图形运动演示画布">
        <div className="stage-heading">
          <div>
            <p className="eyebrow">小学数学课堂演示</p>
            <h1>图形运动教学工具 V1.5</h1>
          </div>
          <div className="status-pill">{activity}</div>
        </div>

        {mode === 'recognize' ? (
          <svg
            ref={recognizeSvgRef}
            className="teaching-stage recognition-stage"
            viewBox={`0 0 ${STAGE_WIDTH} ${STAGE_HEIGHT}`}
            role="img"
            aria-label="作业照片识别区域"
            onPointerMove={(event) => {
              continueGridBoxDrag(event);
              continueCellSelection(event);
              continueCalibrationDrag(event);
              continueRegionDrag(event);
              continueManualBlockDrag(event);
            }}
            onPointerUp={() => {
              endGridBoxDrag();
              endCellSelection();
              endCalibrationDrag();
              endRegionDrag();
              endManualBlockDrag();
            }}
            onPointerLeave={() => {
              setHoverCellIndex(null);
              endGridBoxDrag();
              endCellSelection();
              endCalibrationDrag();
              endRegionDrag();
              endManualBlockDrag();
            }}
          >
            <defs>
              <pattern id="paper-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                <path d="M 32 0 L 0 0 0 32" className="paper-grid-line" />
              </pattern>
            </defs>
            <rect width={STAGE_WIDTH} height={STAGE_HEIGHT} className="stage-bg" />
            <rect width={STAGE_WIDTH} height={STAGE_HEIGHT} fill="url(#paper-grid)" />
            {photo?.url ? (
              <image
                href={photo.url}
                x={recognitionLayout.x}
                y={recognitionLayout.y}
                width={recognitionLayout.width}
                height={recognitionLayout.height}
                preserveAspectRatio="none"
              />
            ) : (
              <g className="upload-empty">
                <rect x="210" y="215" width="560" height="230" rx="8" />
                <text x="490" y="305">上传图片</text>
                <text x="490" y="360">按步骤设置网格、目标图和移动卡片</text>
              </g>
            )}
            {photo?.url && guidedGridRegion && ['grid', 'target', 'cards'].includes(wizardStep) && (() => {
              const gridX = recognitionLayout.x + guidedGridRegion.x * photoScale;
              const gridY = recognitionLayout.y + guidedGridRegion.y * photoScale;
              const gridW = guidedGridRegion.width * photoScale;
              const gridH = guidedGridRegion.height * photoScale;
              const displayColLines = guidedGridRegion.colLines.map((line) => gridX + line * photoScale);
              const displayRowLines = guidedGridRegion.rowLines.map((line) => gridY + line * photoScale);
              return (
                <g className={`guided-grid-layer step-${wizardStep}`}>
                  {Array.from({ length: guidedGridRegion.rows }, (_, rowIndex) =>
                    Array.from({ length: guidedGridRegion.cols }, (_, colIndex) => {
                      const index = rowIndex * guidedGridRegion.cols + colIndex;
                      const x = displayColLines[colIndex];
                      const y = displayRowLines[rowIndex];
                      const width = displayColLines[colIndex + 1] - x;
                      const height = displayRowLines[rowIndex + 1] - y;
                      const isTarget = targetCellIndices.includes(index);
                      const isCard = cardCellIndices.includes(index);
                      const isPreview = selectionPreviewIndices.includes(index);
                      const isHover = hoverCellIndex === index;
                      return (
                        <g key={`guided-cell-${index}`}>
                          <rect
                            x={x}
                            y={y}
                            width={width}
                            height={height}
                            className={[
                              'guided-cell',
                              isTarget ? 'is-target' : '',
                              isCard ? 'is-card' : '',
                              isPreview ? 'is-preview' : '',
                              isHover ? 'is-hover' : '',
                            ].join(' ')}
                            onPointerDown={(event) => startCellSelection(event, index)}
                            onPointerEnter={() => setHoverCellIndex(index)}
                          />
                          <text x={x + width / 2} y={y + height / 2} className="guided-cell-label">
                            {rowIndex + 1}-{colIndex + 1}
                          </text>
                        </g>
                      );
                    }),
                  )}
                  <rect
                    x={gridX}
                    y={gridY}
                    width={gridW}
                    height={gridH}
                    className="guided-grid-frame"
                    pointerEvents={wizardStep === 'grid' ? 'all' : 'none'}
                    onPointerDown={(event) => startGridBoxDrag(event, 'move')}
                  />
                  {displayColLines.map((lineX, index) => (
                    <line
                      key={`guided-col-${index}`}
                      x1={lineX}
                      y1={gridY}
                      x2={lineX}
                      y2={gridY + gridH}
                      className="guided-grid-line"
                    />
                  ))}
                  {displayRowLines.map((lineY, index) => (
                    <line
                      key={`guided-row-${index}`}
                      x1={gridX}
                      y1={lineY}
                      x2={gridX + gridW}
                      y2={lineY}
                      className="guided-grid-line"
                    />
                  ))}
                  {wizardStep === 'grid' && (
                    <rect
                      x={gridX + gridW - 22}
                      y={gridY + gridH - 22}
                      width="22"
                      height="22"
                      className="guided-grid-resize"
                      onPointerDown={(event) => startGridBoxDrag(event, 'resize')}
                    />
                  )}
                </g>
              );
            })()}
            {false && photo &&
              [...manualBlocks, ...(manualDraftBlock ? [manualDraftBlock] : [])].map((block) => {
                const x = recognitionLayout.x + block.x * photoScale;
                const y = recognitionLayout.y + block.y * photoScale;
                const width = block.width * photoScale;
                const height = block.height * photoScale;
                return (
                  <g key={block.id} className={`manual-block role-${block.role}`}>
                    <rect
                      x={x}
                      y={y}
                      width={width}
                      height={height}
                      className={block.id === selectedBlockId ? 'manual-block-box selected' : 'manual-block-box'}
                      onPointerDown={(event) => startManualBlockDrag(event, block, 'move')}
                    />
                    <rect
                      x={x + width - 18}
                      y={y + height - 18}
                      width="18"
                      height="18"
                      className="manual-block-resize"
                      onPointerDown={(event) => startManualBlockDrag(event, block, 'resize')}
                    />
                    <text x={x + 10} y={y - 10} className="manual-block-label">
                      {block.name} · {roleLabels[block.role]}
                    </text>
                  </g>
                );
              })}
            {false && photo?.url && calibrationQuad && !manualDrawRole && !hasManualBlocks && (() => {
              const point = (corner) => ({
                x: recognitionLayout.x + calibrationQuad[corner].x * photoScale,
                y: recognitionLayout.y + calibrationQuad[corner].y * photoScale,
              });
              const tl = point('tl');
              const tr = point('tr');
              const br = point('br');
              const bl = point('bl');
              const polygon = `${tl.x},${tl.y} ${tr.x},${tr.y} ${br.x},${br.y} ${bl.x},${bl.y}`;
              const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
              return (
                <g className="calibration-layer">
                  <path
                    className="calibration-mask"
                    fillRule="evenodd"
                    d={`M 0 0 H ${STAGE_WIDTH} V ${STAGE_HEIGHT} H 0 Z M ${tl.x} ${tl.y} L ${tr.x} ${tr.y} L ${br.x} ${br.y} L ${bl.x} ${bl.y} Z`}
                  />
                  <polygon
                    points={polygon}
                    className="calibration-polygon"
                    onPointerDown={(event) => startCalibrationDrag(event, 'move')}
                  />
                  {[
                    ['tl', tl],
                    ['tr', tr],
                    ['br', br],
                    ['bl', bl],
                  ].map(([name, item]) => (
                    <circle
                      key={name}
                      cx={item.x}
                      cy={item.y}
                      r="10"
                      className="corner-handle"
                      onPointerDown={(event) => startCalibrationDrag(event, name)}
                    />
                  ))}
                  {[
                    ['top', mid(tl, tr)],
                    ['right', mid(tr, br)],
                    ['bottom', mid(br, bl)],
                    ['left', mid(bl, tl)],
                  ].map(([name, item]) => (
                    <rect
                      key={name}
                      x={item.x - 8}
                      y={item.y - 8}
                      width="16"
                      height="16"
                      className="edge-handle"
                      onPointerDown={(event) => startCalibrationDrag(event, name)}
                    />
                  ))}
                  <text x={tl.x + 12} y={tl.y - 14} className="calibration-label">
                    网格校准框
                  </text>
                </g>
              );
            })()}
            {false && photo &&
              candidates.map((candidate) => {
                const normalized = withGridDefaults(candidate);
                const x = recognitionLayout.x + candidate.x * photoScale;
                const y = recognitionLayout.y + candidate.y * photoScale;
                const width = candidate.width * photoScale;
                const height = candidate.height * photoScale;
                const selected = candidate.id === selectedRegionId;
                const isSource = candidate.id === sourceRegionId;
                const isTarget = candidate.id === targetRegionId;
                const isWholeGrid = normalized.type === 'wholeGrid';
                const displayColLines = normalized.colLines.map((line) => x + line * photoScale);
                const displayRowLines = normalized.rowLines.map((line) => y + line * photoScale);
                const sourceStartCol = Math.max(0, Math.min(normalized.sourceColStart ?? 0, normalized.cols - 2));
                const targetStartCol = Math.max(
                  0,
                  Math.min(normalized.targetColStart ?? normalized.cols - 2, normalized.cols - 2),
                );
                const arrowStartCol = Math.max(
                  0,
                  Math.min(normalized.arrowColStart ?? 2, normalized.cols - 1),
                );
                return (
                  <g key={candidate.id} className="candidate-region">
                    {isWholeGrid && (
                      <g className="grid-zone-overlay">
                        <rect
                          x={displayColLines[sourceStartCol]}
                          y={displayRowLines[0]}
                          width={displayColLines[sourceStartCol + 2] - displayColLines[sourceStartCol]}
                          height={displayRowLines[normalized.rows] - displayRowLines[0]}
                          className="zone-source"
                        />
                        {normalized.cols >= 5 && (
                          <rect
                            x={displayColLines[arrowStartCol]}
                            y={displayRowLines[0]}
                            width={displayColLines[arrowStartCol + 1] - displayColLines[arrowStartCol]}
                            height={displayRowLines[normalized.rows] - displayRowLines[0]}
                            className="zone-arrow"
                          />
                        )}
                        <rect
                          x={displayColLines[targetStartCol]}
                          y={displayRowLines[0]}
                          width={displayColLines[targetStartCol + 2] - displayColLines[targetStartCol]}
                          height={displayRowLines[normalized.rows] - displayRowLines[0]}
                          className="zone-target"
                        />
                      </g>
                    )}
                    <rect
                      x={x}
                      y={y}
                      width={width}
                      height={height}
                      className={[
                        'candidate-box',
                        selected ? 'selected' : '',
                        isSource ? 'source' : '',
                        isTarget ? 'target' : '',
                      ].join(' ')}
                      onPointerDown={(event) => startRegionDrag(event, candidate, 'move')}
                    />
                    <rect
                      x={x + width - 17}
                      y={y + height - 17}
                      width="17"
                      height="17"
                      className="resize-handle"
                      onPointerDown={(event) => startRegionDrag(event, candidate, 'resize')}
                    />
                    {isWholeGrid && (
                      <g className="whole-grid-lines">
                        {displayColLines.map((lineX, index) => (
                          <line
                            key={`candidate-${candidate.id}-col-${index}`}
                            x1={lineX}
                            y1={displayRowLines[0]}
                            x2={lineX}
                            y2={displayRowLines[normalized.rows]}
                          />
                        ))}
                        {displayRowLines.map((lineY, index) => (
                          <line
                            key={`candidate-${candidate.id}-row-${index}`}
                            x1={displayColLines[0]}
                            y1={lineY}
                            x2={displayColLines[normalized.cols]}
                            y2={lineY}
                          />
                        ))}
                        {Array.from({ length: normalized.rows }, (_, rowIndex) =>
                          Array.from({ length: normalized.cols }, (_, colIndex) => (
                            <text
                              key={`candidate-${candidate.id}-cell-${rowIndex}-${colIndex}`}
                              x={(displayColLines[colIndex] + displayColLines[colIndex + 1]) / 2}
                              y={(displayRowLines[rowIndex] + displayRowLines[rowIndex + 1]) / 2}
                              className="cell-label"
                            >
                              第{rowIndex + 1}行第{colIndex + 1}列
                            </text>
                          )),
                        )}
                      </g>
                    )}
                    <text x={x + 10} y={y - 10} className="candidate-label">
                      {candidate.label}
                      {isWholeGrid ? ` · ${normalized.rows}×${normalized.cols}` : ''}
                      {isSource ? ' · 整块演示' : ''}
                      {isTarget ? ' · 目标' : ''}
                    </text>
                  </g>
                );
              })}
          </svg>
        ) : (
          <div className="teach-workspace">
            <svg
              ref={svgRef}
              className="teaching-stage"
              viewBox={`0 0 ${STAGE_WIDTH} ${STAGE_HEIGHT}`}
              role="img"
              aria-label="图片卡片平移和旋转演示区域"
              onPointerMove={continueDrag}
              onPointerUp={endDrag}
              onPointerLeave={endDrag}
            >
              <defs>
                <pattern id="paper-grid-teach" width="32" height="32" patternUnits="userSpaceOnUse">
                  <path d="M 32 0 L 0 0 0 32" className="paper-grid-line" />
                </pattern>
              </defs>
              <rect width={STAGE_WIDTH} height={STAGE_HEIGHT} className="stage-bg" />
              <rect width={STAGE_WIDTH} height={STAGE_HEIGHT} fill="url(#paper-grid-teach)" />
              {showTargetReference && targetDisplayRect && demoPhoto?.url && (
                <g className="target-layer" pointerEvents="none">
                  <clipPath id="target-reference-clip">
                    <rect
                      x={targetDisplayRect.x}
                      y={targetDisplayRect.y}
                      width={targetDisplayRect.width}
                      height={targetDisplayRect.height}
                    />
                  </clipPath>
                  <image
                    href={demoPhoto.url}
                    x={targetImageX}
                    y={targetImageY}
                    width={targetImageWidth}
                    height={targetImageHeight}
                    preserveAspectRatio="none"
                    opacity={targetOpacity / 100}
                    clipPath="url(#target-reference-clip)"
                  />
                  <rect
                    x={targetDisplayRect.x}
                    y={targetDisplayRect.y}
                    width={targetDisplayRect.width}
                    height={targetDisplayRect.height}
                    className="target-reference-frame"
                  />
                  <text
                    x={targetDisplayRect.x + 14}
                    y={Math.max(28, targetDisplayRect.y - 12)}
                    className="target-reference-label"
                  >
                    半透明目标参考图
                  </text>
                </g>
              )}
              {cardNodes}
              {visibleGridDisplayRect && (
              <g className="grid-lines">
                {Array.from({ length: visibleGridDisplayRect.cols + 1 }, (_, index) => (
                  <line
                    key={`col-${index}`}
                    x1={visibleGridDisplayRect.x + index * (visibleGridDisplayRect.width / visibleGridDisplayRect.cols)}
                    y1={visibleGridDisplayRect.y}
                    x2={visibleGridDisplayRect.x + index * (visibleGridDisplayRect.width / visibleGridDisplayRect.cols)}
                    y2={visibleGridDisplayRect.y + visibleGridDisplayRect.height}
                  />
                ))}
                {Array.from({ length: visibleGridDisplayRect.rows + 1 }, (_, index) => (
                  <line
                    key={`row-${index}`}
                    x1={visibleGridDisplayRect.x}
                    y1={visibleGridDisplayRect.y + index * (visibleGridDisplayRect.height / visibleGridDisplayRect.rows)}
                    x2={visibleGridDisplayRect.x + visibleGridDisplayRect.width}
                    y2={visibleGridDisplayRect.y + index * (visibleGridDisplayRect.height / visibleGridDisplayRect.rows)}
                  />
                ))}
              </g>
              )}
              {selectedAlignment.message && (
                <text x="490" y="48" className={`alignment-message ${selectedAlignment.className}`}>
                  {selectedAlignment.message}
                </text>
              )}
            </svg>
          </div>
        )}
      </section>

      <aside className="control-panel" aria-label="控制面板">
        <section className="panel-section">
          <h2>当前步骤</h2>
          <ol className="flow-list wizard-flow">
            {wizardSteps.map((step, index) => (
              <li
                key={step.key}
                className={[
                  activeWizardStep === step.key ? 'active' : '',
                  wizardSteps.findIndex((item) => item.key === activeWizardStep) > index ? 'done' : '',
                ].join(' ')}
              >
                {step.label}
              </li>
            ))}
          </ol>
        </section>

        {mode !== 'teach' && wizardStep === 'upload' && (
          <section className="panel-section">
            <h2>上传图片</h2>
            <label className="upload-button">
              <ImagePlus size={24} />
              <span>上传图片</span>
              <input type="file" accept="image/*" onChange={handleImageUpload} />
            </label>
            {photo?.name && <p className="file-name">{photo.name}</p>}
            {photo && (
              <>
                <div className="rotation-buttons">
                  <button type="button" onClick={() => rotateCurrentPhoto(-90)}>
                    <RotateCcw size={22} />
                    逆时针 90°
                  </button>
                  <button type="button" onClick={() => rotateCurrentPhoto(90)}>
                    <RotateCw size={22} />
                    顺时针 90°
                  </button>
                  <button type="button" onClick={() => rotateCurrentPhoto(180)}>
                    <RotateCw size={22} />
                    旋转 180°
                  </button>
                </div>
                <button className="wide-button primary-action" type="button" onClick={goToGridStep}>
                  下一步
                </button>
              </>
            )}
          </section>
        )}

        {mode !== 'teach' && wizardStep === 'grid' && (
          <section className="panel-section">
            <h2>设置网格</h2>
            <div className="number-grid">
              <label>
                行数
                <input
                  type="number"
                  min="1"
                  max="8"
                  value={rows}
                  onChange={(event) => handleRowsChange(event.target.value)}
                />
              </label>
              <label>
                列数
                <input
                  type="number"
                  min="1"
                  max="8"
                  value={cols}
                  onChange={(event) => handleColsChange(event.target.value)}
                />
              </label>
            </div>
            <button className="wide-button primary-action" type="button" onClick={confirmGridStep} disabled={!guidedGridRegion}>
              确认网格
            </button>
            <button className="text-button" type="button" onClick={() => setWizardStep('upload')}>
              返回上传
            </button>
          </section>
        )}

        {mode !== 'teach' && wizardStep === 'target' && (
          <section className="panel-section">
            <h2>选择目标参考图</h2>
            <p className="step-note">已选择 {targetCellIndices.length} 个目标格</p>
            <button className="wide-button" type="button" onClick={clearTargetCells}>
              清除目标参考图
            </button>
            <button className="wide-button primary-action" type="button" onClick={confirmTargetStep} disabled={!targetCellIndices.length}>
              确认目标参考图
            </button>
            <button className="text-button" type="button" onClick={() => setWizardStep('grid')}>
              返回设置网格
            </button>
          </section>
        )}

        {mode !== 'teach' && wizardStep === 'cards' && (
          <section className="panel-section">
            <h2>选择移动卡片</h2>
            <p className="step-note">已选择 {cardCellIndices.length} 张移动卡片</p>
            <button className="wide-button" type="button" onClick={clearCardCells}>
              全部取消
            </button>
            <button className="wide-button primary-action" type="button" onClick={startTeaching} disabled={!canEnterTeaching}>
              进入教学模式
            </button>
            <button className="text-button" type="button" onClick={() => setWizardStep('target')}>
              返回目标参考图
            </button>
          </section>
        )}

        {mode === 'teach' && (
          <>
            <section className="panel-section">
              <h2>当前选中卡片</h2>
              <div className="selected-card-display">卡片 {selectedCard?.id ?? '-'}</div>
              <div className="card-nav-buttons">
                <button type="button" onClick={() => selectAdjacentCard(-1)} disabled={cards.length < 2}>
                  上一张
                </button>
                <button type="button" onClick={() => selectAdjacentCard(1)} disabled={cards.length < 2}>
                  下一张
                </button>
              </div>
              <div className="card-picker">
                {cards.map((card) => (
                  <button
                    type="button"
                    key={card.id}
                    className={card.id === selectedId ? 'mini-card active' : 'mini-card'}
                    onClick={() => selectCard(card.id)}
                  >
                    {card.id}
                  </button>
                ))}
              </div>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={focusSelectedOnly}
                  onChange={(event) => setFocusSelectedOnly(event.target.checked)}
                />
                只显示当前卡片
              </label>
              <label className="range-control">
                目标参考图透明度：{targetOpacity}%
                <input
                  type="range"
                  min="20"
                  max="70"
                  step="5"
                  value={targetOpacity}
                  onChange={(event) => setTargetOpacity(Number(event.target.value))}
                />
              </label>
            </section>

            <section className="panel-section">
              <h2>动画效果</h2>
              <div className="segmented-control">
                {[
                  ['slow', '慢速'],
                  ['normal', '正常'],
                  ['fast', '快速'],
                ].map(([speed, label]) => (
                  <button
                    type="button"
                    key={speed}
                    className={motionSettings.speed === speed ? 'active' : ''}
                    onClick={() => setMotionSettings((settings) => ({ ...settings, speed }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={motionSettings.showPath}
                  onChange={(event) => setMotionSettings((settings) => ({ ...settings, showPath: event.target.checked }))}
                />
                显示运动轨迹
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={motionSettings.showFrames}
                  onChange={(event) => setMotionSettings((settings) => ({ ...settings, showFrames: event.target.checked }))}
                />
                显示起点终点框
              </label>
              <div className="trace-actions">
                <button type="button" onClick={clearCurrentMotionTraces} disabled={!selectedCard}>
                  清除当前轨迹
                </button>
                <button type="button" onClick={clearAllMotionTraces} disabled={!motionTraces.length && !animationTrace}>
                  清除全部轨迹
                </button>
              </div>
            </section>

            <section className="panel-section">
              <h2>平移</h2>
              <div className="move-pad">
                <button type="button" className="move-up" onClick={() => moveCard('up')} title="上移一格">
                  <ArrowUp size={28} />
                </button>
                <button type="button" className="move-left" onClick={() => moveCard('left')} title="左移一格">
                  <ArrowLeft size={28} />
                </button>
                <button type="button" className="move-center" disabled>
                  1 格
                </button>
                <button type="button" className="move-right" onClick={() => moveCard('right')} title="右移一格">
                  <ArrowRight size={28} />
                </button>
                <button type="button" className="move-down" onClick={() => moveCard('down')} title="下移一格">
                  <ArrowDown size={28} />
                </button>
              </div>
              <button type="button" className="wide-button" onClick={replayCurrentMoveTrace} disabled={!canReplayCurrentMove}>
                演示移动
              </button>
            </section>

            <section className="panel-section">
              <h2>旋转中心</h2>
              <select value={centerKey} onChange={(event) => changeCenter(event.target.value)}>
                {Object.entries(centers).map(([key, center]) => (
                  <option value={key} key={key}>
                    {center.label}
                  </option>
                ))}
              </select>
              <div className="rotation-buttons">
                <button type="button" onClick={() => rotateCard(-90, '逆时针旋转 90°')}>
                  <RotateCcw size={24} />
                  逆时针 90°
                </button>
                <button type="button" onClick={() => rotateCard(90, '顺时针旋转 90°')}>
                  <RotateCw size={24} />
                  顺时针 90°
                </button>
                <button type="button" onClick={() => rotateCard(180, '旋转 180°')}>
                  <RotateCw size={24} />
                  旋转 180°
                </button>
              </div>
              <p className="angle-readout">
                当前角度：{selectedCard ? normalizeAngle(selectedCard.rotation) : 0}°
              </p>
              <button className="wide-button" type="button" onClick={resetCurrentCard} disabled={!selectedCard}>
                <RefreshCcw size={22} />
                重置当前卡片
              </button>
            </section>

            <section className="panel-section record-section">
              <div className="record-heading">
                <h2>操作记录</h2>
                <button type="button" className="text-button" onClick={() => setHistory([])}>
                  <Trash2 size={20} />
                  清空记录
                </button>
              </div>
              <ol className="history-list">
                {history.length === 0 ? (
                  <li className="empty-history">还没有操作记录</li>
                ) : (
                  history.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)
                )}
              </ol>
            </section>

            <button className="reset-button" type="button" onClick={resetTeachingCards}>
              <RefreshCcw size={24} />
              重置全部卡片
            </button>
          </>
        )}
      </aside>
    </main>
  );
}
