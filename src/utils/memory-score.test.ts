import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeWordRememberPoint,
  computeAverageRememberPoint,
  mergeWordProgressRecords
} from './memory-score.ts';

const DAY = 86400000;

describe('computeWordRememberPoint', () => {
  const NOW = Date.UTC(2026, 10, 15, 12, 0, 0);

  it('returns 0 and new tier for untouched words', () => {
    const res = computeWordRememberPoint(null, null, NOW);
    assert.equal(res.score, 0);
    assert.equal(res.tier, 'new');
    assert.equal(res.labelBn, 'নতুন');
  });

  it('returns low weak score for words with mistakes and 0 repetitions', () => {
    const res = computeWordRememberPoint(
      { repetitions: 0, interval: 1, easeFactor: 2.1, lastReviewed: NOW },
      { mistakeCount: 2, consecutiveCorrect: 0 },
      NOW
    );
    assert.equal(res.tier, 'weak');
    assert.ok(res.score > 0 && res.score < 40, `Expected weak score, got ${res.score}`);
  });

  it('increases monotonically with SM-2 repetitions and interval when freshly reviewed', () => {
    const rep1 = computeWordRememberPoint(
      { repetitions: 1, intervalDays: 1, easeFactor: 2.5, lastReviewed: NOW },
      null,
      NOW
    );
    const rep2 = computeWordRememberPoint(
      { repetitions: 2, intervalDays: 6, easeFactor: 2.5, lastReviewed: NOW },
      null,
      NOW
    );
    const rep3 = computeWordRememberPoint(
      { repetitions: 3, intervalDays: 15, easeFactor: 2.6, lastReviewed: NOW },
      null,
      NOW
    );
    const rep5 = computeWordRememberPoint(
      { repetitions: 5, intervalDays: 60, easeFactor: 2.7, lastReviewed: NOW },
      null,
      NOW
    );

    assert.ok(rep1.score >= 55 && rep1.score < 75, `rep1=${rep1.score}`);
    assert.ok(rep2.score > rep1.score, `rep2 (${rep2.score}) > rep1 (${rep1.score})`);
    assert.ok(rep3.score > rep2.score, `rep3 (${rep3.score}) > rep2 (${rep2.score})`);
    assert.ok(rep5.score >= 92, `rep5=${rep5.score}`);
    assert.equal(rep5.tier, 'mastered');
  });

  it('applies Ebbinghaus exponential forgetting decay over elapsed days', () => {
    const fresh = computeWordRememberPoint(
      { repetitions: 2, intervalDays: 6, easeFactor: 2.5, lastReviewed: NOW },
      null,
      NOW
    );
    const dueAtInterval = computeWordRememberPoint(
      { repetitions: 2, intervalDays: 6, easeFactor: 2.5, lastReviewed: NOW - 6 * DAY },
      null,
      NOW
    );
    const veryOverdue = computeWordRememberPoint(
      { repetitions: 2, intervalDays: 6, easeFactor: 2.5, lastReviewed: NOW - 30 * DAY },
      null,
      NOW
    );

    assert.ok(dueAtInterval.score < fresh.score, 'due should decay slightly below fresh');
    assert.ok(dueAtInterval.retention >= 0.89 && dueAtInterval.retention <= 0.91);
    assert.ok(veryOverdue.score < dueAtInterval.score, 'overdue should decay more');
    assert.ok(veryOverdue.score >= 20, 'should retain familiarity floor');
  });

  it('works identically with Supabase snake_case columns', () => {
    const camel = computeWordRememberPoint(
      { repetitions: 3, intervalDays: 15, easeFactor: 2.6, lastReviewed: NOW - 2 * DAY },
      null,
      NOW
    );
    const snake = computeWordRememberPoint(
      { repetitions: 3, interval_days: 15, ease_factor: 2.6, last_reviewed: NOW - 2 * DAY },
      null,
      NOW
    );
    assert.deepEqual(camel, snake);
  });
});

describe('computeAverageRememberPoint & mergeWordProgressRecords', () => {
  it('computes rounded average across scores', () => {
    assert.equal(computeAverageRememberPoint([]), 0);
    assert.equal(computeAverageRememberPoint([80, 90, 50]), 73);
  });

  it('keeps fresher lastReviewed record while preserving local attempt counters', () => {
    const merged = mergeWordProgressRecords(
      { word_id: '1:1:1', repetitions: 2, intervalDays: 6, lastReviewed: 1000, correctCount: 3, wrongCount: 1 },
      { word_id: '1:1:1', repetitions: 3, interval_days: 15, last_reviewed: 2000 }
    );
    assert.ok(merged);
    assert.equal(merged.repetitions, 3);
    assert.equal(merged.intervalDays, 15);
    assert.equal(merged.lastReviewed, 2000);
    assert.equal(merged.correctCount, 3);
    assert.equal(merged.wrongCount, 1);
  });
});
