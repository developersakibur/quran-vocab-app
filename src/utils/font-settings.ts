export interface FontScaleBounds {
  min: number;
  max: number;
  step: number;
  defaultScale: number;
}

export interface FontScales {
  arabic: number;
  bangla: number;
}

export const FONT_SCALE_BOUNDS: FontScaleBounds = {
  min: 0.75,
  max: 1.6,
  step: 0.05,
  defaultScale: 1.0,
};

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export function toBnDigits(input: number | string): string {
  return String(input).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

/**
 * Clamp and snap font scale safely to two decimal places within [min, max].
 */
export function clampFontScale(
  raw: number | string | null | undefined,
  bounds: FontScaleBounds = FONT_SCALE_BOUNDS
): number {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return bounds.defaultScale;
  }
  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(num)) {
    return bounds.defaultScale;
  }
  const clamped = Math.min(bounds.max, Math.max(bounds.min, num));
  const snappedSteps = Math.round((clamped - bounds.min) / bounds.step);
  const rounded = bounds.min + snappedSteps * bounds.step;
  return Math.round(Math.min(bounds.max, Math.max(bounds.min, rounded)) * 100) / 100;
}

/**
 * Step a font scale up or down by one step increment (positive or negative delta).
 */
export function stepFontScale(
  current: number,
  direction: -1 | 1 | number,
  bounds: FontScaleBounds = FONT_SCALE_BOUNDS
): number {
  const base = clampFontScale(current, bounds);
  const delta = direction > 0 ? bounds.step : direction < 0 ? -bounds.step : 0;
  return clampFontScale(base + delta, bounds);
}

/**
 * Format a numeric scale multiplier (e.g. 1.2) into Bengali percentage text (e.g. "১২০%").
 */
export function formatFontScalePercentBn(
  scale: number,
  bounds: FontScaleBounds = FONT_SCALE_BOUNDS
): string {
  const clamped = clampFontScale(scale, bounds);
  const pct = Math.round(clamped * 100);
  return `${toBnDigits(pct)}%`;
}

/**
 * Check whether both Arabic and Bangla scales are at the default 1.00 multiplier.
 */
export function isDefaultFontScales(
  scales: FontScales,
  bounds: FontScaleBounds = FONT_SCALE_BOUNDS
): boolean {
  return (
    clampFontScale(scales.arabic, bounds) === bounds.defaultScale &&
    clampFontScale(scales.bangla, bounds) === bounds.defaultScale
  );
}
