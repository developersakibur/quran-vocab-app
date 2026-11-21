import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  clearDownloadQueueForType,
  clearTabFromManifest,
  computeAudioOverviewStats,
  computeSurahRowDownloadState,
  createEmptyAudioManifest,
  dequeueDownloadTask,
  doesCacheUrlMatchSurahRecitation,
  doesCacheUrlMatchSurahWord,
  enqueueBulkDownloadTasks,
  enqueueDownloadTask,
  formatAudioBytesBn,
  makeTaskId,
  parseAudioManifest,
  parseCacheAudioUrl,
  reconcileManifestWithCacheScan,
  recordSurahAudioSaved,
  recordWordAudioProgress,
  removeSurahAudioFromManifest,
  removeSurahWordAudioFromManifest,
  removeTaskFromQueue,
  type ActiveDownloadState,
  type SurahMetaLite
} from './audio-download-manager.ts';

const SAMPLE_META: SurahMetaLite[] = [
  { surah: 1, total_words: 29, name_bn_script: 'আল-ফাতিহা' },
  { surah: 2, total_words: 6121, name_bn_script: 'আল-বাকারা' },
  { surah: 112, total_words: 15, name_bn_script: 'আল-ইখলাস' },
  { surah: 114, total_words: 20, name_bn_script: 'আন-নাস' }
];

describe('audio-download-manager manifest & instant overview', () => {
  it('parses valid manifest safely and ignores corrupt or out-of-range keys', () => {
    const parsed = parseAudioManifest({
      version: 1,
      surahAudio: {
        1: { bytes: 1_200_000, savedAt: 1000 },
        999: { bytes: 500, savedAt: 1000 }
      },
      wordAudio: {
        1: { count: 29, bytes: 460_000, savedAt: 2000 },
        2: { count: 0, bytes: 100, savedAt: 2000 }
      },
      reconciledAt: 5000
    });

    assert.equal(parsed.surahAudio[1].bytes, 1_200_000);
    assert.equal(parsed.surahAudio[999], undefined);
    assert.equal(parsed.wordAudio[1].count, 29);
    assert.equal(parsed.wordAudio[2], undefined);
    assert.equal(parsed.reconciledAt, 5000);
  });

  it('computes overview totals instantaneously including live in-flight bytes', () => {
    let m = createEmptyAudioManifest();
    m = recordSurahAudioSaved(m, 1, 1_048_576, 100);
    m = recordWordAudioProgress(m, 1, 29, 464_000, 29, 200);
    m = recordWordAudioProgress(m, 112, 7, 112_000, 15, 300);

    const overview = computeAudioOverviewStats(m, SAMPLE_META, 250_000);
    assert.equal(overview.completedSurahs, 1);
    assert.equal(overview.totalSurahs, 4);
    assert.equal(overview.completedWordSurahs, 1);
    assert.equal(overview.partialWordSurahs, 1);
    assert.equal(overview.totalSavedWords, 36);
    assert.equal(overview.totalWords, 29 + 6121 + 15 + 20);
    assert.equal(overview.totalSurahBytes, 1_048_576);
    assert.equal(overview.totalWordBytes, 576_000);
    assert.equal(overview.totalAudioBytes, 1_048_576 + 576_000 + 250_000);
    assert.equal(overview.hasAnySurahAudio, true);
    assert.equal(overview.hasAnyWordAudio, true);
  });

  it('deletes individual surah or clears a single tab without affecting the other tab', () => {
    let m = createEmptyAudioManifest();
    m = recordSurahAudioSaved(m, 1, 1_000_000);
    m = recordSurahAudioSaved(m, 112, 500_000);
    m = recordWordAudioProgress(m, 1, 29, 460_000, 29);

    m = removeSurahAudioFromManifest(m, 1);
    assert.equal(m.surahAudio[1], undefined);
    assert.equal(m.surahAudio[112].bytes, 500_000);
    assert.equal(m.wordAudio[1].count, 29);

    m = clearTabFromManifest(m, 'ayah');
    assert.deepEqual(m.surahAudio, {});
    assert.equal(m.wordAudio[1].count, 29);

    m = removeSurahWordAudioFromManifest(m, 1);
    assert.deepEqual(m.wordAudio, {});
  });
});

describe('audio-download-manager FIFO auto-queue & row state machine', () => {
  it('enqueues multiple surahs in FIFO order without duplicates and supports removal', () => {
    const active: ActiveDownloadState = {
      task: { id: makeTaskId('ayah', 1), type: 'ayah', surah: 1, mode: 'single' },
      percent: 42,
      receivedBytes: 500_000,
      totalBytes: 1_200_000,
      completedUnits: 0,
      totalUnits: 1
    };

    let q = enqueueDownloadTask([], active, { type: 'ayah', surah: 1, mode: 'single' });
    assert.equal(q.added, false);

    q = enqueueDownloadTask(q.queue, active, { type: 'ayah', surah: 2, mode: 'single' });
    assert.equal(q.added, true);
    q = enqueueDownloadTask(q.queue, active, { type: 'ayah', surah: 112, mode: 'single' });
    assert.equal(q.added, true);
    q = enqueueDownloadTask(q.queue, active, { type: 'ayah', surah: 2, mode: 'single' });
    assert.equal(q.added, false);

    assert.deepEqual(
      q.queue.map((t) => t.surah),
      [2, 112]
    );

    const removed = removeTaskFromQueue(q.queue, 'ayah', 2);
    assert.equal(removed.removed, true);
    assert.deepEqual(
      removed.queue.map((t) => t.surah),
      [112]
    );

    const popped = dequeueDownloadTask(removed.queue);
    assert.equal(popped.task?.surah, 112);
    assert.equal(popped.queue.length, 0);
  });

  it('bulk enqueue skips already completed surahs and clearQueueForType isolates tabs', () => {
    let m = createEmptyAudioManifest();
    m = recordSurahAudioSaved(m, 1, 900_000);

    const bulk = enqueueBulkDownloadTasks([], null, 'ayah', SAMPLE_META, m);
    assert.equal(bulk.addedCount, 3);
    assert.deepEqual(
      bulk.queue.map((t) => t.surah),
      [2, 112, 114]
    );

    const withWord = enqueueDownloadTask(bulk.queue, null, { type: 'word', surah: 1, mode: 'single' }).queue;
    const afterClearAyah = clearDownloadQueueForType(withWord, 'ayah');
    assert.deepEqual(
      afterClearAyah.map((t) => t.id),
      ['word:1']
    );
  });

  it('derives all 5 row states accurately (idle, queued, downloading, partial, completed)', () => {
    let m = createEmptyAudioManifest();
    m = recordWordAudioProgress(m, 1, 29, 464_000, 29);
    m = recordWordAudioProgress(m, 112, 6, 96_000, 15);

    const active: ActiveDownloadState = {
      task: { id: 'word:2', type: 'word', surah: 2, mode: 'single' },
      percent: 10,
      receivedBytes: 0,
      totalBytes: 0,
      completedUnits: 612,
      totalUnits: 6121
    };
    const queue = [{ id: 'word:114', type: 'word' as const, surah: 114, mode: 'single' as const }];

    const completedRow = computeSurahRowDownloadState(SAMPLE_META[0], 'word', m, active, queue);
    assert.equal(completedRow.status, 'completed');
    assert.equal(completedRow.canDelete, true);

    const downloadingRow = computeSurahRowDownloadState(SAMPLE_META[1], 'word', m, active, queue);
    assert.equal(downloadingRow.status, 'downloading');
    assert.equal(downloadingRow.percent, 10);
    assert.equal(downloadingRow.canDelete, false);

    const partialRow = computeSurahRowDownloadState(SAMPLE_META[2], 'word', m, active, queue);
    assert.equal(partialRow.status, 'partial');
    assert.equal(partialRow.doneUnits, 6);
    assert.equal(partialRow.canDelete, true);

    const queuedRow = computeSurahRowDownloadState(SAMPLE_META[3], 'word', m, active, queue);
    assert.equal(queuedRow.status, 'queued');
    assert.equal(queuedRow.queuePosition, 1);
    assert.equal(queuedRow.canDelete, false);

    const idleRow = computeSurahRowDownloadState(SAMPLE_META[0], 'ayah', m, active, queue);
    assert.equal(idleRow.status, 'idle');
    assert.equal(idleRow.canDelete, false);
  });
});

describe('audio-download-manager cache reconciliation & URL matching', () => {
  it('reconciles manifest with real cache entries (adds reader-cached words & drops evicted surahs)', () => {
    let m = createEmptyAudioManifest();
    m = recordSurahAudioSaved(m, 1, 1_100_000, 100);
    m = recordSurahAudioSaved(m, 2, 42_000_000, 100);

    const { manifest: synced, changed } = reconcileManifestWithCacheScan(
      m,
      {
        surahCounts: { 1: 1 }, // Surah 2 was evicted externally
        wordCounts: { 112: 5 } // 5 words were played & cached in reader
      },
      SAMPLE_META,
      9000
    );

    assert.equal(changed, true);
    assert.equal(synced.surahAudio[1].bytes, 1_100_000);
    assert.equal(synced.surahAudio[2], undefined);
    assert.equal(synced.wordAudio[112].count, 5);
    assert.ok(synced.wordAudio[112].bytes > 0);
  });

  it('matches Tarteel surah URLs and QuranCDN word URLs precisely', () => {
    const surahUrl = 'https://audio-cdn.tarteel.ai/quran/surah/alafasy/murattal/mp3/001.mp3';
    const wordUrl = 'https://audio.qurancdn.com/wbw/001_001_003.mp3';

    assert.deepEqual(parseCacheAudioUrl(surahUrl), { type: 'ayah', surah: 1 });
    assert.deepEqual(parseCacheAudioUrl(wordUrl), { type: 'word', surah: 1 });
    assert.equal(doesCacheUrlMatchSurahRecitation(surahUrl, 1), true);
    assert.equal(doesCacheUrlMatchSurahRecitation(surahUrl, 2), false);
    assert.equal(doesCacheUrlMatchSurahWord(wordUrl, 1), true);
    assert.equal(doesCacheUrlMatchSurahWord(wordUrl, 2), false);
    assert.equal(doesCacheUrlMatchSurahWord(surahUrl, 1), false);
  });

  it('formats storage bytes cleanly in Bengali units', () => {
    assert.equal(formatAudioBytesBn(0, true), '০ এমবি');
    assert.equal(formatAudioBytesBn(512 * 1024, true), '৫১২ কেবি');
    assert.equal(formatAudioBytesBn(2.5 * 1024 * 1024, true), '২.৫০ এমবি');
    assert.equal(formatAudioBytesBn(125.4 * 1024 * 1024, true), '১২৫.৪ এমবি');
    assert.equal(formatAudioBytesBn(1.5 * 1024 * 1024 * 1024, true), '১.৫০ জিবি');
  });
});
