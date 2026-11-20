import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FONT_SCALE_BOUNDS,
  clampFontScale,
  stepFontScale,
  formatFontScalePercentBn,
  isDefaultFontScales,
} from './font-settings';

test('clampFontScale enforces min/max bounds and handles invalid input', () => {
  assert.equal(clampFontScale(NaN), 1.0);
  assert.equal(clampFontScale(null), 1.0);
  assert.equal(clampFontScale('invalid'), 1.0);
  assert.equal(clampFontScale(0.4), FONT_SCALE_BOUNDS.min);
  assert.equal(clampFontScale(2.5), FONT_SCALE_BOUNDS.max);
  assert.equal(clampFontScale('1.25'), 1.25);
});

test('clampFontScale snaps cleanly to step increments without float drift', () => {
  assert.equal(clampFontScale(0.95 + 0.05), 1.0);
  assert.equal(clampFontScale(1.1499999), 1.15);
  assert.equal(clampFontScale(0.82), 0.8);
});

test('stepFontScale increments and decrements cleanly inside bounds', () => {
  assert.equal(stepFontScale(1.0, 1), 1.05);
  assert.equal(stepFontScale(1.0, -1), 0.95);
  assert.equal(stepFontScale(0.95, 1), 1.0);
  assert.equal(stepFontScale(FONT_SCALE_BOUNDS.max, 1), FONT_SCALE_BOUNDS.max);
  assert.equal(stepFontScale(FONT_SCALE_BOUNDS.min, -1), FONT_SCALE_BOUNDS.min);
});

test('formatFontScalePercentBn formats scales in Bengali digits', () => {
  assert.equal(formatFontScalePercentBn(1.0), '১০০%');
  assert.equal(formatFontScalePercentBn(0.75), '৭৫%');
  assert.equal(formatFontScalePercentBn(1.6), '১৬০%');
  assert.equal(formatFontScalePercentBn(1.25), '১২৫%');
});

test('isDefaultFontScales accurately detects default state', () => {
  assert.equal(isDefaultFontScales({ arabic: 1.0, bangla: 1.0 }), true);
  assert.equal(isDefaultFontScales({ arabic: 1.15, bangla: 1.0 }), false);
  assert.equal(isDefaultFontScales({ arabic: 1.0, bangla: 0.9 }), false);
});
