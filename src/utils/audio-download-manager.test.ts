import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_PARALLEL_SURAH_DOWNLOADS,
  MAX_PARALLEL_WORD_SURAH_TASKS,
  WORD_AUDIO_CONCURRENCY,
  canStartTaskType,
  clearDownloadQueueForType,
  clearTabFromManifest,
  computeAudioOverviewStats,
  computeSurahRowDownloadState,
  createEmptyAudioManifest,
  createSharedWordDownloadPool,
  dedupeWordUrls,
  dequeueDownloadTask,
  doesCacheUrlMatchSurahRecitation,
  doesCacheUrlMatchSurahWord,
  enqueueBulkDownloadTasks,
  enqueueDownloadTask,
  formatAudioBytesBn,
  makeTaskId,
  parseAudioManifest,
  parseCacheAudioUrl,
  pickNextRunnableTask,
  reconcileManifestWithCacheScan,
  recordSurahAudioSaved,
  recordWordAudioProgress,
  removeSurahAudioFromManifest,
  removeSurahWordAudioFromManifest,
  removeTaskFromQueue,
  sumInFlightBytes,
  type ActiveDownloadState,
  type DownloadTask,
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

describe('audio-download-manager parallel concurrency (3 surahs + 3 word surahs sharing global pool of 12)', () => {
  it('enforces 3 parallel surah slots, 3 parallel word-surah slots, and global pool limit of 12', () => {
    assert.equal(MAX_PARALLEL_SURAH_DOWNLOADS, 3);
    assert.equal(MAX_PARALLEL_WORD_SURAH_TASKS, 3);
    assert.equal(WORD_AUDIO_CONCURRENCY, 12);

    const makeActive = (type: 'ayah' | 'word', surah: number, bytes: number): ActiveDownloadState => ({
      task: { id: makeTaskId(type, surah), type, surah, mode: 'single' },
      percent: 50,
      receivedBytes: bytes,
      totalBytes: bytes * 2,
      completedUnits: 0,
      totalUnits: type === 'ayah' ? 1 : 20
    });

    let queue: DownloadTask[] = [
      { id: 'ayah:1', type: 'ayah', surah: 1, mode: 'single' },
      { id: 'ayah:2', type: 'ayah', surah: 2, mode: 'single' },
      { id: 'ayah:112', type: 'ayah', surah: 112, mode: 'single' },
      { id: 'ayah:114', type: 'ayah', surah: 114, mode: 'single' },
      { id: 'word:1', type: 'word', surah: 1, mode: 'single' },
      { id: 'word:2', type: 'word', surah: 2, mode: 'single' },
      { id: 'word:112', type: 'word', surah: 112, mode: 'single' },
      { id: 'word:114', type: 'word', surah: 114, mode: 'single' }
    ];

    const active: ActiveDownloadState[] = [];

    // Pick 3 parallel Surahs (ayah recitation)
    for (let i = 0; i < 3; i++) {
      const picked = pickNextRunnableTask(queue, active);
      assert.ok(picked.task);
      assert.equal(picked.task.type, 'ayah');
      queue = picked.queue;
      active.push(makeActive('ayah', picked.task.surah, (i + 1) * 100_000));
    }

    // 4th Surah cannot start yet because 3 Surah slots are full
    assert.equal(canStartTaskType(active, 'ayah'), false);

    // 3 Word Surah tasks CAN start concurrently on the word origin
    for (let i = 0; i < 3; i++) {
      assert.equal(canStartTaskType(active, 'word'), true);
      const wordPick = pickNextRunnableTask(queue, active);
      assert.ok(wordPick.task);
      assert.equal(wordPick.task.type, 'word');
      queue = wordPick.queue;
      active.push(makeActive('word', wordPick.task.surah, 0));
    }

    // 4th Word Surah stays queued until one of the 3 Word Surah slots finishes
    assert.equal(canStartTaskType(active, 'word'), false);
    assert.deepEqual(queue.map((t) => t.id), ['ayah:114', 'word:114']);
    assert.equal(sumInFlightBytes(active), 600_000);

    // Row states show 3 ayah + 3 word as downloading and both 4ths as queued
    const manifest = createEmptyAudioManifest();
    assert.equal(computeSurahRowDownloadState(SAMPLE_META[0], 'word', manifest, active, queue).status, 'downloading');
    assert.equal(computeSurahRowDownloadState(SAMPLE_META[1], 'word', manifest, active, queue).status, 'downloading');
    assert.equal(computeSurahRowDownloadState(SAMPLE_META[2], 'word', manifest, active, queue).status, 'downloading');
    const wordRow4 = computeSurahRowDownloadState(SAMPLE_META[3], 'word', manifest, active, queue);
    assert.equal(wordRow4.status, 'queued');
    assert.equal(wordRow4.queuePosition, 2);

    // Free word slot 2 -> 4th Word Surah immediately becomes runnable
    const remainingActive = active.filter((a) => a.task.id !== 'word:2');
    const nextPick = pickNextRunnableTask(queue, remainingActive);
    assert.equal(nextPick.task?.id, 'word:114');
    assert.deepEqual(nextPick.queue.map((t) => t.id), ['ayah:114']);
  });

  it('deduplicates word URLs while preserving order and omitting unavailable URLs', () => {
    const raw = [
      'https://audio.qurancdn.com/wbw/001_001_001.mp3',
      'https://audio.qurancdn.com/wbw/001_001_002.mp3',
      'https://audio.qurancdn.com/wbw/001_001_001.mp3',
      'https://audio.qurancdn.com/wbw/001_001_003.mp3'
    ];
    const unavail = new Set(['https://audio.qurancdn.com/wbw/001_001_002.mp3']);
    assert.deepEqual(dedupeWordUrls(raw, unavail), [
      'https://audio.qurancdn.com/wbw/001_001_001.mp3',
      'https://audio.qurancdn.com/wbw/001_001_003.mp3'
    ]);
  });

  it('shares a strict global cap of 12 workers fairly across 3 simultaneous word surahs and isolates cancellation', async () => {
    const pool = createSharedWordDownloadPool(12);
    let inFlight = 0;
    let peakInFlight = 0;
    const startedOrder: string[] = [];

    const makeUrls = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, i) => `${prefix}:${i + 1}`);

    const processUrl = async (url: string) => {
      inFlight++;
      if (inFlight > peakInFlight) peakInFlight = inFlight;
      startedOrder.push(url);
      await new Promise((r) => setTimeout(r, 12));
      inFlight--;
      return { ok: true };
    };

    const [r1, r2, r3] = await Promise.all([
      pool.runJob({ id: 'word:1', urls: makeUrls('s1', 16), processUrl }),
      pool.runJob({ id: 'word:2', urls: makeUrls('s2', 16), processUrl }),
      pool.runJob({ id: 'word:3', urls: makeUrls('s3', 16), processUrl })
    ]);

    assert.equal(r1.processed, 16);
    assert.equal(r2.processed, 16);
    assert.equal(r3.processed, 16);
    // Strict global cap: NEVER exceeds 12 even with 3 surahs running simultaneously!
    assert.equal(peakInFlight, 12);

    // First 12 dispatches must be fairly balanced 4 / 4 / 4 across the 3 surahs
    const firstBatch = startedOrder.slice(0, 12);
    assert.equal(firstBatch.filter((u) => u.startsWith('s1:')).length, 4);
    assert.equal(firstBatch.filter((u) => u.startsWith('s2:')).length, 4);
    assert.equal(firstBatch.filter((u) => u.startsWith('s3:')).length, 4);

    // Cancelling one surah stops only that surah while the remaining surah completes cleanly
    let cancelS2 = false;
    const pA = pool.runJob({
      id: 'word:10',
      urls: makeUrls('a', 15),
      processUrl: async () => {
        await new Promise((r) => setTimeout(r, 8));
        return { ok: true };
      }
    });
    const pB = pool.runJob({
      id: 'word:11',
      urls: makeUrls('b', 30),
      isStopped: () => cancelS2,
      processUrl: async (u) => {
        await new Promise((r) => setTimeout(r, 8));
        if (u === 'b:3') {
          cancelS2 = true;
          pool.cancelJob('word:11');
        }
        return { ok: true };
      }
    });
    const [resA, resB] = await Promise.all([pA, pB]);
    assert.equal(resA.processed, 15);
    assert.equal(resA.stopped, false);
    assert.equal(resB.stopped, true);
    assert.ok(resB.processed < 30);
    assert.equal(pool.getActiveWorkerCount(), 0);
    assert.equal(pool.getActiveJobCount(), 0);
  });

  it('completes Surah Al-Baqarah at 6116/6116 and also handles generic runtime 404 unavailableUrls cleanly', () => {
    const baqarahMeta: SurahMetaLite[] = [
      { surah: 2, total_words: 6116, name_bn_script: 'আল-বাকারা' }
    ];
    const initial = createEmptyAudioManifest();

    // All 6,116 words of Surah Al-Baqarah exist on QuranCDN after fixing 2:181 compound word alignment
    const { manifest: reconciled, changed } = reconcileManifestWithCacheScan(
      initial,
      { surahCounts: {}, wordCounts: { 2: 6116 } },
      baqarahMeta,
      1000
    );

    assert.equal(changed, true);
    assert.equal(reconciled.wordAudio[2]?.count, 6116);
    const row = computeSurahRowDownloadState(baqarahMeta[0], 'word', reconciled, null, []);
    assert.equal(row.status, 'completed');
    assert.equal(row.doneUnits, 6116);
    assert.equal(row.totalUnits, 6116);
    assert.equal(row.percent, 100);

    // Defensive safety net: if any Surah ever encounters a runtime HTTP 404, unavailableUrls persists and resolves cleanly
    const withRuntime404 = createEmptyAudioManifest();
    withRuntime404.wordAudio[112] = {
      count: 15,
      bytes: 14 * 16384,
      savedAt: 1000,
      unavailableUrls: ['https://audio.qurancdn.com/wbw/112_004_005.mp3']
    };
    const ikhlasMeta: SurahMetaLite[] = [{ surah: 112, total_words: 15, name_bn_script: 'আল-ইখলাস' }];
    const parsed = parseAudioManifest(JSON.parse(JSON.stringify(withRuntime404)));
    assert.deepEqual(parsed.wordAudio[112]?.unavailableUrls, [
      'https://audio.qurancdn.com/wbw/112_004_005.mp3'
    ]);

    const { manifest: rec112 } = reconcileManifestWithCacheScan(
      parsed,
      { surahCounts: {}, wordCounts: { 112: 14 } },
      ikhlasMeta,
      1500
    );
    assert.equal(rec112.wordAudio[112]?.count, 15);
    assert.equal(computeSurahRowDownloadState(ikhlasMeta[0], 'word', rec112, null, []).status, 'completed');

    // Deleting all cached files clears the entry completely (never stuck at 1/15)
    const { manifest: afterDelete } = reconcileManifestWithCacheScan(
      rec112,
      { surahCounts: {}, wordCounts: {} },
      ikhlasMeta,
      2000
    );
    assert.equal(afterDelete.wordAudio[112], undefined);
  });
});
