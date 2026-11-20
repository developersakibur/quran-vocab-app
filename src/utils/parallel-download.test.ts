import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectOptimalConcurrency,
  runWorkerPool,
  getLowestIncompleteSurah,
  formatParallelWordHeader,
  formatParallelSurahHeader,
  createThrottleGate
} from './parallel-download.ts';

test('detectOptimalConcurrency scales down conservatively on slow networks or saveData', () => {
  assert.deepEqual(
    detectOptimalConcurrency({ hardwareConcurrency: 8, deviceMemory: 8, effectiveType: '2g' }),
    { data: 3, wordAudio: 3, surahAudio: 1 }
  );
  assert.deepEqual(
    detectOptimalConcurrency({ hardwareConcurrency: 8, deviceMemory: 8, effectiveType: '4g', saveData: true }),
    { data: 3, wordAudio: 3, surahAudio: 1 }
  );
});

test('detectOptimalConcurrency balances 3g or low-memory devices safely', () => {
  assert.deepEqual(
    detectOptimalConcurrency({ hardwareConcurrency: 4, deviceMemory: 2, effectiveType: '4g' }),
    { data: 5, wordAudio: 6, surahAudio: 2 }
  );
  assert.deepEqual(
    detectOptimalConcurrency({ hardwareConcurrency: 8, deviceMemory: 4, effectiveType: '3g' }),
    { data: 5, wordAudio: 6, surahAudio: 2 }
  );
});

test('detectOptimalConcurrency maximizes safe parallelism on modern 4g/desktop devices', () => {
  assert.deepEqual(
    detectOptimalConcurrency({ hardwareConcurrency: 8, deviceMemory: 8, effectiveType: '4g' }),
    { data: 8, wordAudio: 10, surahAudio: 4 }
  );
  assert.deepEqual(
    detectOptimalConcurrency({ hardwareConcurrency: 16, deviceMemory: 16, effectiveType: '4g' }),
    { data: 10, wordAudio: 12, surahAudio: 4 }
  );
});

test('runWorkerPool runs tasks concurrently up to the requested limit and reports all completions', async () => {
  const items = Array.from({ length: 12 }, (_, i) => i + 1);
  let active = 0;
  let maxActive = 0;
  const completed: number[] = [];

  const result = await runWorkerPool(
    items,
    4,
    async (item) => {
      active++;
      if (active > maxActive) maxActive = active;
      await new Promise((r) => setTimeout(r, 15));
      active--;
      completed.push(item);
    }
  );

  assert.equal(result.done, 12);
  assert.equal(result.total, 12);
  assert.equal(result.stopped, false);
  assert.equal(maxActive, 4);
  assert.equal(completed.length, 12);
});

test('runWorkerPool halts early when shouldStop turns true', async () => {
  const items = Array.from({ length: 20 }, (_, i) => i + 1);
  let shouldStopFlag = false;

  const result = await runWorkerPool(
    items,
    3,
    async (item) => {
      await new Promise((r) => setTimeout(r, 8));
      if (item >= 5) shouldStopFlag = true;
    },
    { shouldStop: () => shouldStopFlag }
  );

  assert.equal(result.stopped, true);
  assert.ok(result.done < items.length);
});

test('formatParallelWordHeader advances monotonically even when out-of-order workers complete words in later surahs', () => {
  const meta = [
    { surah: 1, total_words: 29, name_bn_script: 'আল-ফাতিহা' },
    { surah: 2, total_words: 100, name_bn_script: 'আল-বাকারা' },
    { surah: 3, total_words: 80, name_bn_script: 'আলে-ইমরান' }
  ];

  // Workers finish words in Surah 2 and Surah 3 while Surah 1 still has 28/29 words
  const h1 = formatParallelWordHeader({
    meta,
    counts: { 1: 28, 2: 40, 3: 15 },
    overallDone: 83,
    totalWords: 209
  });
  assert.equal(h1.primarySurah, 1);
  assert.equal(h1.label, 'শব্দ অডিও • সূরা আল-ফাতিহা (০/৩)');
  assert.equal(h1.percent, 40);

  // Once Surah 1 reaches 29/29, header advances cleanly to Surah 2 (never jumps to 3 then back to 2)
  const h2 = formatParallelWordHeader({
    meta,
    counts: { 1: 29, 2: 40, 3: 80 },
    overallDone: 149,
    totalWords: 209
  });
  assert.equal(h2.primarySurah, 2);
  assert.equal(h2.label, 'শব্দ অডিও • সূরা আল-বাকারা (২/৩)');

  // When all surahs complete
  const hDone = formatParallelWordHeader({
    meta,
    counts: { 1: 29, 2: 100, 3: 80 },
    overallDone: 209,
    totalWords: 209
  });
  assert.equal(hDone.primarySurah, null);
  assert.equal(hDone.percent, 100);
  assert.equal(getLowestIncompleteSurah(meta, { 1: 29, 2: 100, 3: 80 }, 'word'), null);
});

test('formatParallelSurahHeader anchors to lowest active surah regardless of worker array order', () => {
  const meta = [
    { surah: 1, name_bn_script: 'আল-ফাতিহা' },
    { surah: 2, name_bn_script: 'আল-বাকারা' },
    { surah: 3, name_bn_script: 'আলে-ইমরান' }
  ];

  // Even if worker order reports [3, 1, 2], header stays pinned to Surah 1 + 2 more
  const a = formatParallelSurahHeader({
    activeSurahs: [3, 1, 2],
    completedSurahs: 0,
    totalSurahs: 114,
    overallPercent: 12,
    meta
  });
  const b = formatParallelSurahHeader({
    activeSurahs: [2, 3, 1],
    completedSurahs: 0,
    totalSurahs: 114,
    overallPercent: 13,
    meta
  });

  assert.equal(a.primarySurah, 1);
  assert.equal(b.primarySurah, 1);
  assert.equal(a.label, 'সূরা আল-ফাতিহা + আরও ২টি • ০/১১৪');
  assert.equal(b.label, 'সূরা আল-ফাতিহা + আরও ২টি • ০/১১৪');

  // Single active surah omits "+ আরও Nটি"
  const single = formatParallelSurahHeader({
    activeSurahs: [3],
    completedSurahs: 2,
    totalSurahs: 114,
    overallPercent: 99,
    meta
  });
  assert.equal(single.label, 'সূরা আলে-ইমরান • ২/১১৪');
});

test('createThrottleGate suppresses rapid intermediate ticks and permits forced updates', () => {
  const gate = createThrottleGate(300);
  assert.equal(gate.shouldEmit(1000), true);
  assert.equal(gate.shouldEmit(1100), false);
  assert.equal(gate.shouldEmit(1299), false);
  assert.equal(gate.shouldEmit(1300), true);
  assert.equal(gate.shouldEmit(1350, true), true);
  assert.equal(gate.shouldEmit(1500), false);
});

