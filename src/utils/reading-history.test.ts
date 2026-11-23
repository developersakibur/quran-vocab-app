import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAyahListen,
  applyStudyTimeTick,
  applySurahListenStart,
  applyWordListen,
  applyWordRead,
  clampRecitationDeltaSec,
  createEmptyHistoryEntry,
  formatCompactDurationBn,
  formatDurationBn,
  formatHistoryDateHeadingBn,
  getLocalDateKey,
  groupHistoryByDateAndSurah,
  isUserActiveForReading,
  mergeHistoryEntries,
  paginateHistoryGroups,
  summarizeHistoryTotals,
} from './reading-history.ts';

describe('reading-history formatting & date keys', () => {
  it('formats zero, seconds, minutes, and hours cleanly in Bengali', () => {
    assert.equal(formatDurationBn(0), '০ মিনিট');
    assert.equal(formatDurationBn(45), '৪৫ সেকেন্ড');
    assert.equal(formatDurationBn(60), '১ মিনিট');
    assert.equal(formatDurationBn(750), '১২ মিনিট');
    assert.equal(formatDurationBn(3600), '১ ঘণ্টা');
    assert.equal(formatDurationBn(5100), '১ ঘণ্টা ২৫ মি.');
    assert.equal(formatCompactDurationBn(45), '৪৫ সে.');
    assert.equal(formatCompactDurationBn(1320), '২২ মি.');
    assert.equal(formatCompactDurationBn(5100), '১ ঘ. ২৫ মি.');
  });

  it('formats Today, Yesterday, same-year, and cross-year Bengali headings', () => {
    assert.equal(formatHistoryDateHeadingBn('2026-11-19', '2026-11-19'), 'আজ — ১৯ নভেম্বর');
    assert.equal(formatHistoryDateHeadingBn('2026-11-18', '2026-11-19'), 'গতকাল — ১৮ নভেম্বর');
    assert.equal(formatHistoryDateHeadingBn('2026-11-15', '2026-11-19'), '১৫ নভেম্বর');
    assert.equal(formatHistoryDateHeadingBn('2025-12-30', '2026-11-19'), '৩০ ডিসেম্বর, ২০২৫');
  });

  it('returns YYYY-MM-DD local date keys', () => {
    const key = getLocalDateKey(new Date(2026, 4, 7, 14, 30, 0).getTime());
    assert.equal(key, '2026-05-07');
  });
});

describe('reading-history word read & listen recording', () => {
  it('adds unique tapped words without double counting duplicate taps on the same day', () => {
    let entry = createEmptyHistoryEntry('2026-11-19', 1, 1000);
    entry = applyWordRead(entry, '1:1:1', 1, 2000);
    entry = applyWordRead(entry, '1:1:2', 1, 3000);
    entry = applyWordRead(entry, '1:1:1', 1, 4000); // duplicate tap

    assert.deepEqual(entry.read_word_keys, ['1:1:1', '1:1:2']);
    assert.equal(entry.read_count, 2);
    assert.equal(entry.last_ayah, 1);
    assert.equal(entry.updated_at, 4000);
  });

  it('records word listen events, unique listen keys, and listen duration', () => {
    let entry = createEmptyHistoryEntry('2026-11-19', 1, 1000);
    entry = applyWordListen(entry, '1:2:1', 2, 2, 5000);
    entry = applyWordListen(entry, '1:2:1', 2, 2, 6000); // re-listened same word

    assert.deepEqual(entry.listen_word_keys, ['1:2:1']);
    assert.equal(entry.listen_count, 2);
    assert.equal(entry.listen_seconds, 4);
    assert.equal(entry.total_seconds, 4);
    assert.equal(entry.last_ayah, 2);
  });

  it('records ayah clip listens and full surah recitation starts', () => {
    let entry = createEmptyHistoryEntry('2026-11-19', 36, 1000);
    entry = applyAyahListen(entry, 12, 8, 2000);
    entry = applySurahListenStart(entry, 12, 3000);

    assert.equal(entry.listen_count, 1);
    assert.equal(entry.surah_listen_count, 1);
    assert.equal(entry.listen_seconds, 8);
    assert.equal(entry.total_seconds, 8);
    assert.equal(entry.last_ayah, 12);
  });
});

describe('reading-history non-overlapping active study timer & recitation delta clamp', () => {
  it('increments read_seconds + total_seconds when reading silently', () => {
    const base = createEmptyHistoryEntry('2026-11-19', 2, 1000);
    const next = applyStudyTimeTick(base, {
      isReadingActive: true,
      isAudioPlaying: false,
      deltaSec: 5,
      ayah: 255,
      nowMs: 6000,
    });
    assert.equal(next.read_seconds, 5);
    assert.equal(next.listen_seconds, 0);
    assert.equal(next.total_seconds, 5);
    assert.equal(next.last_ayah, 255);
  });

  it('never double-counts total_seconds when user reads while audio is simultaneously playing', () => {
    const base = createEmptyHistoryEntry('2026-11-19', 2, 1000);
    const next = applyStudyTimeTick(base, {
      isReadingActive: true,
      isAudioPlaying: true,
      deltaSec: 4,
      ayah: 10,
      nowMs: 5000,
    });
    assert.equal(next.read_seconds, 0);
    assert.equal(next.listen_seconds, 4);
    assert.equal(next.total_seconds, 4);
  });

  it('does not count time when idle or tab hidden', () => {
    assert.equal(
      isUserActiveForReading({ isVisible: false, lastInteractionTs: 1000, nowMs: 2000 }),
      false,
    );
    assert.equal(
      isUserActiveForReading({ isVisible: true, lastInteractionTs: 1000, nowMs: 65_000 }),
      false,
    );
    assert.equal(
      isUserActiveForReading({ isVisible: true, lastInteractionTs: 1000, nowMs: 45_000 }),
      true,
    );
  });

  it('clamps normal playback ticks and ignores manual seek jumps or backward scrubs', () => {
    assert.equal(clampRecitationDeltaSec(null, 1.0), 0);
    assert.equal(clampRecitationDeltaSec(10.0, 10.5), 0.5);
    assert.equal(clampRecitationDeltaSec(10.0, 12.0), 2.0);
    assert.equal(clampRecitationDeltaSec(10.0, 45.0), 0); // scrubbed forward
    assert.equal(clampRecitationDeltaSec(45.0, 12.0), 0); // scrubbed backward
  });
});

describe('reading-history conflict-free cloud merge', () => {
  it('unions read & listen keys, takes monotonic max counts/seconds, and keeps latest last_ayah', () => {
    const local = {
      ...createEmptyHistoryEntry('2026-11-19', 1, 5000),
      read_word_keys: ['1:1:1', '1:1:2'],
      listen_word_keys: ['1:1:1'],
      read_count: 2,
      listen_count: 2,
      surah_listen_count: 1,
      read_seconds: 120,
      listen_seconds: 60,
      total_seconds: 180,
      last_ayah: 3,
      updated_at: 5000,
    };

    const cloud = {
      ...createEmptyHistoryEntry('2026-11-19', 1, 9000),
      read_word_keys: ['1:1:2', '1:1:3', '1:1:4'],
      listen_word_keys: ['1:1:3'],
      read_count: 3,
      listen_count: 1,
      surah_listen_count: 2,
      read_seconds: 90,
      listen_seconds: 150,
      total_seconds: 210,
      last_ayah: 6,
      updated_at: 9000,
    };

    const merged = mergeHistoryEntries(local, cloud);
    assert.deepEqual(merged.read_word_keys, ['1:1:1', '1:1:2', '1:1:3', '1:1:4']);
    assert.deepEqual(merged.listen_word_keys, ['1:1:1', '1:1:3']);
    assert.equal(merged.read_count, 4);
    assert.equal(merged.listen_count, 2);
    assert.equal(merged.surah_listen_count, 2);
    assert.equal(merged.read_seconds, 120);
    assert.equal(merged.listen_seconds, 150);
    assert.equal(merged.total_seconds, 210);
    assert.equal(merged.last_ayah, 6);
    assert.equal(merged.updated_at, 9000);
  });
});

describe('reading-history summary & date/surah grouping with filters', () => {
  const sampleEntries = [
    {
      ...createEmptyHistoryEntry('2026-11-19', 1, 8000),
      read_word_keys: ['1:1:1', '1:1:2'],
      read_count: 2,
      read_seconds: 180,
      total_seconds: 180,
      last_ayah: 4,
    },
    {
      ...createEmptyHistoryEntry('2026-11-19', 36, 9500),
      listen_word_keys: ['36:1:1'],
      listen_count: 1,
      surah_listen_count: 1,
      listen_seconds: 420,
      total_seconds: 420,
      last_ayah: 12,
    },
    {
      ...createEmptyHistoryEntry('2026-11-18', 112, 4000),
      read_word_keys: ['112:1:1'],
      read_count: 1,
      listen_count: 1,
      read_seconds: 60,
      listen_seconds: 60,
      total_seconds: 120,
      last_ayah: 2,
    },
    {
      ...createEmptyHistoryEntry('2026-10-01', 2, 1000),
      read_word_keys: ['2:1:1'],
      read_count: 1,
      read_seconds: 600,
      total_seconds: 600,
      last_ayah: 5,
    },
  ];

  it('summarizes today and all-time totals accurately', () => {
    const summary = summarizeHistoryTotals(sampleEntries, '2026-11-19');
    assert.equal(summary.todaySeconds, 600);
    assert.equal(summary.totalSeconds, 1320);
    assert.equal(summary.todayReadWords, 2);
    assert.equal(summary.todayListenCount, 2); // 1 listen_count + 1 surah_listen_count
    assert.equal(summary.totalReadWords, 4);
    assert.equal(summary.activeDaysCount, 3);
  });

  it('groups by date descending and sorts surahs by most recent activity', () => {
    const groups = groupHistoryByDateAndSurah(sampleEntries, {
      activityFilter: 'all',
      rangeFilter: '7d',
      todayKey: '2026-11-19',
    });
    assert.equal(groups.length, 2);
    assert.equal(groups[0].activity_date, '2026-11-19');
    assert.equal(groups[0].headingBn, 'আজ — ১৯ নভেম্বর');
    assert.equal(groups[0].dayTotalSeconds, 600);
    assert.deepEqual(groups[0].items.map((i) => i.surah), [36, 1]);
    assert.equal(groups[1].activity_date, '2026-11-18');
    assert.equal(groups[1].headingBn, 'গতকাল — ১৮ নভেম্বর');
  });

  it('filters by read-only and listen-only activities and range windows', () => {
    const readOnly = groupHistoryByDateAndSurah(sampleEntries, {
      activityFilter: 'read',
      rangeFilter: 'all',
      todayKey: '2026-11-19',
    });
    assert.equal(readOnly.length, 3);
    assert.deepEqual(readOnly[0].items.map((i) => i.surah), [1]); // surah 36 had only listen
    assert.equal(readOnly[0].dayTotalSeconds, 180);

    const listenOnly = groupHistoryByDateAndSurah(sampleEntries, {
      activityFilter: 'listen',
      rangeFilter: '7d',
      todayKey: '2026-11-19',
    });
    assert.equal(listenOnly.length, 2);
    assert.deepEqual(listenOnly[0].items.map((i) => i.surah), [36]);
    assert.equal(listenOnly[0].dayTotalSeconds, 420);
  });

  it('paginates date-grouped history to latest 10 items initially and expands on load more', () => {
    const manyEntries = Array.from({ length: 15 }, (_, idx) => {
      const day = idx < 6 ? '2026-11-19' : idx < 12 ? '2026-11-18' : '2026-11-17';
      return {
        ...createEmptyHistoryEntry(day, idx + 1, 20000 - idx * 100),
        read_word_keys: [`${idx + 1}:1:1`],
        read_count: 1,
        read_seconds: 60,
        total_seconds: 60,
      };
    });

    const groups = groupHistoryByDateAndSurah(manyEntries, {
      activityFilter: 'all',
      rangeFilter: '30d',
      todayKey: '2026-11-19',
    });

    const page1 = paginateHistoryGroups(groups, 10);
    assert.equal(page1.totalItems, 15);
    assert.equal(page1.shownItems, 10);
    assert.equal(page1.remainingItems, 5);
    assert.equal(page1.hasMore, true);
    assert.equal(page1.visibleGroups.length, 2); // 6 from Nov 19 + 4 from Nov 18
    assert.equal(page1.visibleGroups[0].items.length, 6);
    assert.equal(page1.visibleGroups[1].items.length, 4);

    const page2 = paginateHistoryGroups(groups, 20);
    assert.equal(page2.totalItems, 15);
    assert.equal(page2.shownItems, 15);
    assert.equal(page2.remainingItems, 0);
    assert.equal(page2.hasMore, false);
    assert.equal(page2.visibleGroups.length, 3);
  });
});
