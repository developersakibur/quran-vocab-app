import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMonthCalendarGrid,
  computeStreakMetrics,
  DailyPracticeActivity
} from './streak-calendar';

test('buildMonthCalendarGrid highlights days when the user performed at least one practice drill', () => {
  const activityMap: Record<string, DailyPracticeActivity> = {
    '2026-11-10': { date: '2026-11-10', reviewsCount: 5, wordsLearnedCount: 2 },
    '2026-11-11': { date: '2026-11-11', reviewsCount: 3, wordsLearnedCount: 0 },
    '2026-11-12': { date: '2026-11-12', reviewsCount: 8, wordsLearnedCount: 4 }
  };

  // November 2026 (monthIndex = 10)
  const grid = buildMonthCalendarGrid(2026, 10, activityMap, '2026-11-12');

  assert.equal(grid.monthTitleBn, 'নভেম্বর ২০২৬');
  assert.equal(grid.days.length, 30);
  assert.equal(grid.practicedDaysInMonth, 3);
  assert.equal(grid.totalDrillsInMonth, 16);

  const nov10 = grid.days.find((d) => d.dateYmd === '2026-11-10');
  const nov09 = grid.days.find((d) => d.dateYmd === '2026-11-09');
  const nov12 = grid.days.find((d) => d.dateYmd === '2026-11-12');

  assert.equal(nov10?.isPracticed, true);
  assert.equal(nov10?.drillsCount, 5);
  assert.equal(nov09?.isPracticed, false);
  assert.equal(nov12?.isToday, true);
  assert.equal(nov12?.isPracticed, true);
});

test('computeStreakMetrics calculates current and longest streak days accurately', () => {
  const activityMap: Record<string, DailyPracticeActivity> = {
    '2026-11-01': { date: '2026-11-01', reviewsCount: 2, wordsLearnedCount: 1 },
    '2026-11-02': { date: '2026-11-02', reviewsCount: 4, wordsLearnedCount: 1 },
    '2026-11-03': { date: '2026-11-03', reviewsCount: 3, wordsLearnedCount: 1 },
    '2026-11-04': { date: '2026-11-04', reviewsCount: 1, wordsLearnedCount: 0 },
    // gap
    '2026-11-10': { date: '2026-11-10', reviewsCount: 5, wordsLearnedCount: 2 },
    '2026-11-11': { date: '2026-11-11', reviewsCount: 3, wordsLearnedCount: 1 },
    '2026-11-12': { date: '2026-11-12', reviewsCount: 6, wordsLearnedCount: 3 }
  };

  const metrics = computeStreakMetrics(activityMap, '2026-11-12');
  assert.equal(metrics.currentStreakDays, 3);
  assert.equal(metrics.longestStreakDays, 4);
  assert.equal(metrics.totalPracticedDays, 7);
});
