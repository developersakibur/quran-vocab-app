import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateWordLearningFrequency,
  formatBnDateLabel,
  toBnDigits,
  generateDemo30DayData,
} from './progress-chart-data';

test('toBnDigits converts English digits to Bengali correctly', () => {
  assert.equal(toBnDigits('0123456789'), '০১২৩৪৫৬৭৮৯');
  assert.equal(toBnDigits(25), '২৫');
  assert.equal(toBnDigits('Day 30'), 'Day ৩০');
});

test('formatBnDateLabel converts YYYY-MM-DD to Bengali month and day', () => {
  const label = formatBnDateLabel('2026-11-12');
  assert.equal(label, '১২ নভে');
});

test('aggregateWordLearningFrequency creates exactly 30 points for 30 days', () => {
  const refDate = new Date('2026-11-12T12:00:00Z');
  const summary = aggregateWordLearningFrequency(null, null, {
    days: 30,
    referenceDate: refDate,
  });

  assert.equal(summary.points.length, 30);
  assert.equal(summary.points[29].date, '2026-11-12');
  assert.equal(summary.totalWordsLearned, 0);
  assert.equal(summary.activeDaysCount, 0);
  assert.equal(summary.dailyAverage, 0);
});

test('aggregateWordLearningFrequency correctly sums daily activity data', () => {
  const refDate = new Date('2026-11-12T12:00:00Z');
  const activityData = [
    { date: '2026-11-12', wordsLearnedCount: 15, reviewsCount: 20 },
    { date: '2026-11-11', wordsLearnedCount: 10, reviewsCount: 12 },
    { date: '2026-11-05', wordsLearnedCount: 5, reviewsCount: 5 },
  ];

  const summary = aggregateWordLearningFrequency(null, activityData, {
    days: 30,
    referenceDate: refDate,
  });

  assert.equal(summary.points.length, 30);
  assert.equal(summary.totalWordsLearned, 30);
  assert.equal(summary.activeDaysCount, 3);
  assert.equal(summary.dailyAverage, 1.0);
  assert.equal(summary.peakDay?.date, '2026-11-12');
  assert.equal(summary.peakDay?.count, 15);
});

test('aggregateWordLearningFrequency aggregates Supabase / StorageManager progress-v1 records', () => {
  const refDate = new Date('2026-11-12T12:00:00Z');
  const progressMap = {
    '1:1:1': {
      word_id: '1:1:1',
      lastReviewed: new Date('2026-11-12T08:00:00Z').getTime(),
      repetitions: 2,
    },
    '1:1:2': {
      word_id: '1:1:2',
      lastReviewed: new Date('2026-11-12T09:30:00Z').getTime(),
      repetitions: 1,
    },
    '1:1:3': {
      word_id: '1:1:3',
      lastReviewed: new Date('2026-11-10T14:00:00Z').getTime(),
      repetitions: 3,
    },
  };

  const summary = aggregateWordLearningFrequency(progressMap, [], {
    days: 30,
    referenceDate: refDate,
  });

  const todayPoint = summary.points.find((p) => p.date === '2026-11-12');
  assert.ok(todayPoint);
  assert.equal(todayPoint?.count, 2);

  const prevPoint = summary.points.find((p) => p.date === '2026-11-10');
  assert.ok(prevPoint);
  assert.equal(prevPoint?.count, 1);

  assert.equal(summary.totalWordsLearned, 3);
  assert.equal(summary.activeDaysCount, 2);
});

test('generateDemo30DayData provides a full 30-day realistic dataset', () => {
  const refDate = new Date('2026-11-12T12:00:00Z');
  const demo = generateDemo30DayData(refDate);

  assert.equal(demo.points.length, 30);
  assert.ok(demo.totalWordsLearned > 0);
  assert.ok(demo.activeDaysCount === 30);
  assert.ok(demo.peakDay !== null);
  assert.ok(demo.dailyAverage > 0);
});
