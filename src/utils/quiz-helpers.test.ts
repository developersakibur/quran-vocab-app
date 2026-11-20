import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeArabicLookupKey,
  getExactWordOccurrenceCount,
  buildGlobalFrequencyQueue,
  selectMcqDistractors
} from './quiz-helpers';

test('normalizeArabicLookupKey strips Quranic stop marks and whitespace', () => {
  assert.equal(normalizeArabicLookupKey('  ٱللَّهِۖ  '), 'ٱللَّهِ');
  assert.equal(normalizeArabicLookupKey(null), '');
  assert.equal(normalizeArabicLookupKey('فِي'), 'فِي');
});

test('getExactWordOccurrenceCount returns exact count or 1 for singleton forms', () => {
  const sampleMap = {
    'فِي': Array.from({ length: 1098 }, (_, i) => `2:${i + 1}:1`),
    'ٱللَّهِ': ['1:1:2', '2:7:2']
  };

  assert.equal(getExactWordOccurrenceCount('فِي', sampleMap), 1098);
  assert.equal(getExactWordOccurrenceCount('ٱللَّهِۖ', sampleMap), 2);
  // Singleton word omitted from exact-word.json occurs once in Quran
  assert.equal(getExactWordOccurrenceCount('مَٰلِكِ', sampleMap), 1);
  assert.equal(getExactWordOccurrenceCount('', sampleMap), 0);
});

test('buildGlobalFrequencyQueue orders unlearned words strictly by highest frequency first', () => {
  const sampleMap = {
    'بِسۡمِ': ['1:1:1', '11:41:4', '27:30:5'],
    'فِي': Array.from({ length: 1098 }, (_, i) => `2:${i + 1}:1`),
    'مِن': Array.from({ length: 728 }, (_, i) => `2:${i + 1}:2`),
    'ٱللَّهِ': Array.from({ length: 828 }, (_, i) => `1:1:2-${i}`)
  };

  const freshQueue = buildGlobalFrequencyQueue(sampleMap, {}, 10);
  assert.equal(freshQueue.length, 4);
  assert.equal(freshQueue[0].arabic, 'فِي');
  assert.equal(freshQueue[0].occurrenceCount, 1098);
  assert.equal(freshQueue[1].arabic, 'ٱللَّهِ');
  assert.equal(freshQueue[1].occurrenceCount, 828);
  assert.equal(freshQueue[2].arabic, 'مِن');
  assert.equal(freshQueue[2].occurrenceCount, 728);
  assert.equal(freshQueue[3].arabic, 'بِسۡمِ');
  assert.equal(freshQueue[3].occurrenceCount, 3);
});

test('buildGlobalFrequencyQueue advances past already-learned words and falls back gracefully', () => {
  const sampleMap = {
    'فِي': ['2:10:1', '2:11:1'],
    'ٱللَّهِ': ['1:1:2', '2:7:2', '2:8:2'],
    'مِن': ['2:4:8', '2:5:8', '2:6:8', '2:7:8']
  };
  const progressMap = {
    '2:4:8': { repetitions: 1, correctCount: 1 } // learned highest word 'مِن'
  };

  const nextQueue = buildGlobalFrequencyQueue(sampleMap, progressMap, 2);
  assert.equal(nextQueue.length, 2);
  // 'ٱللَّهِ' (3) and 'فِي' (2) come before learned 'مِن' (4)
  assert.equal(nextQueue[0].arabic, 'ٱللَّهِ');
  assert.equal(nextQueue[1].arabic, 'فِي');

  // If limit exceeds unlearned count, learned words backfill in frequency order
  const fullQueue = buildGlobalFrequencyQueue(sampleMap, progressMap, 3);
  assert.equal(fullQueue.length, 3);
  assert.equal(fullQueue[2].arabic, 'مِن');
});

test('selectMcqDistractors chooses unique meanings and avoids same-root collisions when alternatives exist', () => {
  const correct = { key: '1:1:2', arabic: 'ٱللَّهِ', meaning_bn: 'আল্লাহ (র)', root: 'اله' };
  const pool = [
    correct,
    { key: '2:7:2', arabic: 'ٱللَّهُ', meaning_bn: 'আল্লাহ', root: 'اله' },
    { key: '2:9:2', arabic: 'ٱللَّهَ', meaning_bn: 'আল্লাহকে', root: 'اله' },
    { key: '2:10:1', arabic: 'فِي', meaning_bn: 'মধ্যে আছে', root: null },
    { key: '2:4:8', arabic: 'مِن', meaning_bn: 'থেকে', root: null },
    { key: '1:7:8', arabic: 'وَلَا', meaning_bn: 'এবং না', root: null }
  ];

  const picked = selectMcqDistractors(correct, pool, 3, () => 0.5);
  assert.equal(picked.length, 3);
  const pickedRoots = picked.map((p) => p.root);
  assert.equal(pickedRoots.includes('اله'), false);
  assert.deepEqual(
    new Set(picked.map((p) => p.meaning_bn)).size,
    3
  );
});
