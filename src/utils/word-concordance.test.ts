import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeExactArabicKey,
  parseWordKey,
  formatWordLocationBn,
  lookupExactWordKeys,
  splitConcordanceKeys,
  groupKeysBySurah,
  computeWordDetailCounters
} from './word-concordance.ts';

test('normalizeExactArabicKey strips waqf and pause marks but preserves harakat', () => {
  assert.equal(normalizeExactArabicKey('رَّبِّهِمۡۖ'), 'رَّبِّهِمۡ');
  assert.equal(normalizeExactArabicKey('ٱلۡمَوۡتِۚ'), 'ٱلۡمَوۡتِ');
  assert.equal(normalizeExactArabicKey('۞إِنَّ'), 'إِنَّ');
  assert.equal(normalizeExactArabicKey('ٱلرَّحۡمَٰنِ'), 'ٱلرَّحۡمَٰنِ');
});

test('lookupExactWordKeys resolves direct, normalized, and hapax fallback cases', () => {
  const dict = {
    'ٱلرَّحۡمَٰنِ': ['1:1:3', '1:3:1', '2:163:8'],
    'رَّبِّهِمۡ': ['2:5:5', '6:4:10']
  };

  assert.deepEqual(
    lookupExactWordKeys(dict, 'ٱلرَّحۡمَٰنِ', '1:1:3'),
    ['1:1:3', '1:3:1', '2:163:8']
  );

  // Word carrying waqf mark in ayah text falls back to stripped key in exact-word.json
  assert.deepEqual(
    lookupExactWordKeys(dict, 'رَّبِّهِمۡۖ', '2:5:5'),
    ['2:5:5', '6:4:10']
  );

  // Unique word occurring only once in Quran falls back to [currentWordKey]
  assert.deepEqual(
    lookupExactWordKeys(dict, 'مَٰلِكِ_ফ্রি', '99:99:1'),
    ['99:99:1']
  );
});

test('splitConcordanceKeys separates exact matches from same-root different words without overlap', () => {
  const exact = ['1:1:3', '1:3:1', '2:163:8', '1:3:1'];
  const root = ['1:1:3', '1:1:4', '1:3:1', '1:3:2', '2:163:8', '2:163:9', '1:1:4'];

  const { exactKeys, rootDifferentKeys } = splitConcordanceKeys('1:1:3', exact, root);

  assert.deepEqual(exactKeys, ['1:1:3', '1:3:1', '2:163:8']);
  assert.deepEqual(rootDifferentKeys, ['1:1:4', '1:3:2', '2:163:9']);

  const exactSet = new Set(exactKeys);
  for (const rk of rootDifferentKeys) {
    assert.equal(exactSet.has(rk), false, `Key ${rk} should not appear in both sections`);
  }
});

test('groupKeysBySurah groups occurrences cleanly per surah', () => {
  const groups = groupKeysBySurah(['1:1:3', '2:163:8', '1:3:1', 'invalid', '19:45:8']);
  assert.deepEqual(groups, [
    { surah: 1, keys: ['1:1:3', '1:3:1'] },
    { surah: 2, keys: ['2:163:8'] },
    { surah: 19, keys: ['19:45:8'] }
  ]);
});

test('parseWordKey and formatWordLocationBn format surah:ayah:word in Bengali digits', () => {
  assert.deepEqual(parseWordKey('1:1:3'), { key: '1:1:3', surah: 1, ayah: 1, position: 3 });
  assert.equal(parseWordKey('bad-key'), null);
  assert.equal(formatWordLocationBn('1:1:3'), '১:১:৩');
  assert.equal(formatWordLocationBn('114:6:3'), '১১৪:৬:৩');
});

test('computeWordDetailCounters deduplicates exact and same-root occurrences accurately', () => {
  const res = computeWordDetailCounters(
    ['1:1:2', '1:2:2', '1:1:2'],
    ['1:1:2', '1:2:2', '2:7:2', '2:9:2', '2:7:2'],
    '1:1:2',
    'أ ل ه'
  );
  assert.deepEqual(res, {
    exactCount: 2,
    rootTotalCount: 4,
    rootDifferentCount: 2,
    hasRoot: true
  });

  // Ensures currentWordKey is always counted even if missing from raw arrays
  const fallbackRes = computeWordDetailCounters([], ['2:1:1'], '1:1:3', 'ر ح م');
  assert.deepEqual(fallbackRes, {
    exactCount: 1,
    rootTotalCount: 2,
    rootDifferentCount: 1,
    hasRoot: true
  });

  // Rootless particles report hasRoot: false and 0 root counts
  const rootless = computeWordDetailCounters(['1:1:1', '2:1:1'], ['9:9:9'], '1:1:1', '');
  assert.deepEqual(rootless, {
    exactCount: 2,
    rootTotalCount: 0,
    rootDifferentCount: 0,
    hasRoot: false
  });
});
