export interface WordProgressInput {
  word_id?: string;
  wordId?: string;
  status?: string;
  box?: number;
  repetitions?: number;
  interval?: number;
  intervalDays?: number;
  interval_days?: number;
  easeFactor?: number;
  ease_factor?: number;
  lastReviewed?: number | null;
  last_reviewed?: number | null;
  nextReview?: number | null;
  next_review?: number | null;
  correctCount?: number;
  wrongCount?: number;
}

export interface WeakWordInput {
  mistakeCount?: number;
  consecutiveCorrect?: number;
  lastMistakeAt?: number;
}

export type RememberTier = 'new' | 'weak' | 'learning' | 'strong' | 'mastered';

export interface RememberPointResult {
  score: number;
  tier: RememberTier;
  labelBn: string;
  retention: number;
  baseStrength: number;
}

const MS_PER_DAY = 86400000;
const EBBINGHAUS_DECAY_AT_INTERVAL = 0.10536051565782628; // -ln(0.90) => 90% target retention at scheduled review interval

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function normalizeWordProgress(raw?: WordProgressInput | null): {
  wordId: string;
  repetitions: number;
  intervalDays: number;
  easeFactor: number;
  lastReviewed: number;
  nextReview: number;
  correctCount: number;
  wrongCount: number;
  status: string;
  box: number;
} {
  const src = raw || {};
  const repetitions = Math.max(0, Number(src.repetitions ?? 0) || 0);
  const intervalDays = Math.max(
    1,
    Number(src.intervalDays ?? src.interval_days ?? src.interval ?? 1) || 1
  );
  const rawEase = Number(src.easeFactor ?? src.ease_factor ?? 2.5);
  const easeFactor = clamp(isNaN(rawEase) ? 2.5 : rawEase, 1.3, 3.0);
  const lastReviewed = Math.max(0, Number(src.lastReviewed ?? src.last_reviewed ?? 0) || 0);
  const nextReview = Math.max(0, Number(src.nextReview ?? src.next_review ?? 0) || 0);
  const correctCount = Math.max(0, Number(src.correctCount ?? 0) || 0);
  const wrongCount = Math.max(0, Number(src.wrongCount ?? 0) || 0);
  const status = String(src.status || (repetitions === 0 ? 'new' : 'learning'));
  const box = clamp(Number(src.box ?? Math.min(repetitions + 1, 5)) || 1, 1, 5);

  return {
    wordId: String(src.word_id ?? src.wordId ?? ''),
    repetitions,
    intervalDays,
    easeFactor,
    lastReviewed,
    nextReview,
    correctCount,
    wrongCount,
    status,
    box
  };
}

/**
 * Computes a 0-100 Remember Point using a hybrid scientific model:
 * 1. SuperMemo SM-2 Memory Strength (repetitions, logarithmic interval stability, easeFactor)
 * 2. Bayesian Laplace-smoothed Accuracy (when attempt counts are recorded locally)
 * 3. Ebbinghaus Exponential Forgetting Curve R(t) = exp(-0.10536 * t / stability)
 * 4. Weak-Word Mistake Penalty for words needing rehabilitation
 */
export function computeWordRememberPoint(
  progress?: WordProgressInput | null,
  weakRecord?: WeakWordInput | null,
  nowMs: number = Date.now()
): RememberPointResult {
  const p = normalizeWordProgress(progress);
  const mistakeCount = Math.max(0, Number(weakRecord?.mistakeCount ?? 0) || 0);
  const consecutiveCorrect = Math.max(0, Number(weakRecord?.consecutiveCorrect ?? 0) || 0);

  const hasPracticeHistory =
    p.repetitions > 0 ||
    p.lastReviewed > 0 ||
    p.correctCount > 0 ||
    p.wrongCount > 0;

  if (!hasPracticeHistory) {
    if (mistakeCount > 0) {
      const score = Math.max(5, 22 - mistakeCount * 5);
      return {
        score,
        tier: 'weak',
        labelBn: 'দুর্বল',
        retention: 0.4,
        baseStrength: score
      };
    }
    return {
      score: 0,
      tier: 'new',
      labelBn: 'নতুন',
      retention: 0,
      baseStrength: 0
    };
  }

  // 1. SM-2 Repetition & Stability components
  const repComponent = 1 - Math.exp(-0.55 * p.repetitions);
  const intervalComponent = Math.min(
    1,
    Math.log1p(p.intervalDays) / Math.log1p(60)
  );
  const easeNorm = clamp((p.easeFactor - 1.3) / (2.7 - 1.3), 0, 1);

  const totalAttempts = p.correctCount + p.wrongCount;
  const combinedEase =
    totalAttempts > 0
      ? 0.5 * easeNorm + 0.5 * ((p.correctCount + 1) / (totalAttempts + 2))
      : easeNorm;

  const baseStrength =
    p.repetitions === 0
      ? 18 + 20 * combinedEase
      : 34 +
        66 *
          (0.45 * repComponent +
            0.35 * intervalComponent +
            0.2 * combinedEase);

  // 2. Ebbinghaus Exponential Forgetting Curve Decay
  const elapsedMs =
    p.lastReviewed > 0 ? Math.max(0, nowMs - p.lastReviewed) : 0;
  const daysSince = elapsedMs / MS_PER_DAY;
  const stability = Math.max(1, p.intervalDays);
  const retention = clamp(
    Math.exp(-EBBINGHAUS_DECAY_AT_INTERVAL * (daysSince / stability)),
    0.3,
    1.0
  );

  // 3. Unresolved Weak-Word Penalty
  const effectiveMistakes = Math.max(0, mistakeCount - consecutiveCorrect * 0.5);
  const penalty = Math.min(25, effectiveMistakes * 8);

  const score = Math.round(clamp(baseStrength * retention - penalty, 0, 100));

  let tier: RememberTier = 'learning';
  let labelBn = 'চর্চাধীন';
  if (score === 0) {
    tier = 'new';
    labelBn = 'নতুন';
  } else if (score < 40) {
    tier = 'weak';
    labelBn = 'দুর্বল';
  } else if (score < 70) {
    tier = 'learning';
    labelBn = 'চর্চাধীন';
  } else if (score < 90) {
    tier = 'strong';
    labelBn = 'মজবুত';
  } else {
    tier = 'mastered';
    labelBn = 'আয়ত্ত';
  }

  return {
    score,
    tier,
    labelBn,
    retention: Number(retention.toFixed(3)),
    baseStrength: Number(baseStrength.toFixed(2))
  };
}

export function computeAverageRememberPoint(scores: number[]): number {
  if (!Array.isArray(scores) || scores.length === 0) return 0;
  const sum = scores.reduce((acc, s) => acc + clamp(Number(s) || 0, 0, 100), 0);
  return Math.round(sum / scores.length);
}

/**
 * Deterministically merges local and cloud progress records for the same word,
 * keeping whichever record is fresher (by lastReviewed timestamp) while preserving
 * local-only counters (correctCount/wrongCount) when applicable.
 */
export function mergeWordProgressRecords(
  localRaw?: WordProgressInput | null,
  cloudRaw?: WordProgressInput | null
) {
  if (!localRaw && !cloudRaw) return null;
  if (!localRaw) return normalizeWordProgress(cloudRaw);
  if (!cloudRaw) return normalizeWordProgress(localRaw);

  const localNorm = normalizeWordProgress(localRaw);
  const cloudNorm = normalizeWordProgress(cloudRaw);

  const primary =
    cloudNorm.lastReviewed > localNorm.lastReviewed ||
    (cloudNorm.lastReviewed === localNorm.lastReviewed &&
      cloudNorm.repetitions > localNorm.repetitions)
      ? cloudNorm
      : localNorm;

  return {
    ...primary,
    wordId: localNorm.wordId || cloudNorm.wordId,
    correctCount: Math.max(localNorm.correctCount, cloudNorm.correctCount),
    wrongCount: Math.max(localNorm.wrongCount, cloudNorm.wrongCount)
  };
}
