import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  JUZ_DIRECTORY,
  parseSurahAyahJump,
  normalizeArabicForSearch,
  searchGlobalQuranWords,
  computeQuranCoverageStats,
  computeDailyGoalState,
  buildRootFamiliesIndex,
  filterRootFamilies,
  evaluateAyahLoopTransition,
  computeScrubberAyahFromRatio,
  computeScrubberRatioFromAyah,
  type FrequencyTuple
} from './quran-study-features';

const SAMPLE_ENTRIES: FrequencyTuple[] = [
  ['1:1:2', 'ٱللَّهِ', 'আল্লাহ (র)', 828, 1, 'اله'],
  ['1:1:3', 'ٱلرَّحۡمَٰنِ', 'পরম করুণাময়', 57, 1, 'رحم'],
  ['1:1:4', 'ٱلرَّحِيمِ', 'অসীম দয়ালু', 114, 1, 'رحم'],
  ['2:178:15', 'رَحۡمَةٌ', 'অনুগ্রহ ও রহমত', 79, 2, 'رحم'],
  ['2:255:1', 'ٱللَّهُ', 'আল্লাহ', 733, 3, 'اله'],
  ['1:2:3', 'رَبِّ', 'রব ও প্রতিপালক', 250, 1, 'ربب'],
  ['2:199:9', 'غَفُورٌ', 'অত্যন্ত ক্ষমাশীল', 91, 2, 'غفر']
];

describe('quran-study-features: 30-Juz directory & quick-jump parser', () => {
  it('contains all 30 classical Juz entries in strict ascending order ending at 114:6', () => {
    assert.equal(JUZ_DIRECTORY.length, 30);
    assert.equal(JUZ_DIRECTORY[0].juz, 1);
    assert.equal(JUZ_DIRECTORY[0].startSurah, 1);
    assert.equal(JUZ_DIRECTORY[0].startAyah, 1);
    assert.equal(JUZ_DIRECTORY[29].juz, 30);
    assert.equal(JUZ_DIRECTORY[29].startSurah, 78);
    assert.equal(JUZ_DIRECTORY[29].endSurah, 114);
    assert.equal(JUZ_DIRECTORY[29].endAyah, 6);
  });

  it('parses Bengali and ASCII Surah:Ayah quick-jump inputs and validates ayah bounds', () => {
    const totals = new Map<number, number>([
      [1, 7],
      [2, 286],
      [114, 6]
    ]);

    assert.deepEqual(parseSurahAyahJump('2:255', totals), { surah: 2, ayah: 255 });
    assert.deepEqual(parseSurahAyahJump('২:২৫৫', totals), { surah: 2, ayah: 255 });
    assert.deepEqual(parseSurahAyahJump('2 286', totals), { surah: 2, ayah: 286 });
    assert.deepEqual(parseSurahAyahJump('১.৭', totals), { surah: 1, ayah: 7 });

    // Out of bounds rejected
    assert.equal(parseSurahAyahJump('2:287', totals), null);
    assert.equal(parseSurahAyahJump('115:1', totals), null);
    assert.equal(parseSurahAyahJump('আল-বাকারা', totals), null);
  });
});

describe('quran-study-features: global Arabic + Bangla + Root search', () => {
  it('normalizes Arabic diacritics and Alef Wasla cleanly', () => {
    assert.equal(normalizeArabicForSearch('ٱلرَّحِيمِ'), 'الرحيم');
    assert.equal(normalizeArabicForSearch('رَحۡمَةٌ'), 'رحمه');
  });

  it('searches across Bangla meanings, Arabic words, and spaced/unspaced roots ranked by precision & frequency', () => {
    const bnRes = searchGlobalQuranWords(SAMPLE_ENTRIES, 'ক্ষমাশীল', 'bangla');
    assert.equal(bnRes.length, 1);
    assert.equal(bnRes[0].key, '2:199:9');

    const arRes = searchGlobalQuranWords(SAMPLE_ENTRIES, 'الرحيم', 'arabic');
    assert.equal(arRes.length, 1);
    assert.equal(arRes[0].key, '1:1:4');

    // Spaced Arabic root "ر ح م" matches all 3 words in رحم root sorted by frequency descending
    const rootRes = searchGlobalQuranWords(SAMPLE_ENTRIES, 'ر ح م', 'root');
    assert.equal(rootRes.length, 3);
    assert.deepEqual(
      rootRes.map((r) => r.key),
      ['1:1:4', '2:178:15', '1:1:3']
    );
  });
});

describe('quran-study-features: live Quran coverage % & daily goal', () => {
  it('computes exact Quran token coverage percentage from learned words and ignores metadata pass keys', () => {
    const progress = {
      '1:1:2': { word_id: '1:1:2', arabic: 'ٱللَّهِ', status: 'mastered', correctCount: 2 },
      '2:255:1': { word_id: '2:255:1', arabic: 'ٱللَّهُ', status: 'learning', correctCount: 1 },
      'mcq_pass:g1:1': { status: 'mastered', correctCount: 10 },
      'ayah_pass:1:1': { status: 'mastered', correctCount: 4 }
    };

    const stats = computeQuranCoverageStats(progress, SAMPLE_ENTRIES, 77429);
    assert.equal(stats.learnedUniqueCount, 2);
    assert.equal(stats.coveredTokens, 828 + 733);
    assert.equal(stats.coveragePercent, 2.0);
    assert.equal(stats.nextMilestonePercent, 5);
  });

  it('calculates daily goal progress, remaining words, and achievement state accurately', () => {
    assert.deepEqual(computeDailyGoalState(4, 10), {
      todayCount: 4,
      target: 10,
      percent: 40,
      remaining: 6,
      achieved: false
    });
    assert.deepEqual(computeDailyGoalState(12, 10), {
      todayCount: 12,
      target: 10,
      percent: 100,
      remaining: 0,
      achieved: true
    });
  });
});

describe('quran-study-features: Root Family Explorer', () => {
  it('builds frequency-sorted root families and filters by Arabic root or Bangla meaning', () => {
    const families = buildRootFamiliesIndex(SAMPLE_ENTRIES, {
      اله: new Array(2851).fill('1:1:2'),
      رحم: new Array(339).fill('1:1:3')
    });

    assert.equal(families[0].root, 'اله');
    assert.equal(families[0].totalOccurrences, 2851);
    assert.equal(families[0].spacedRoot, 'ا ل ه');
    assert.equal(families[1].root, 'رحم');
    assert.equal(families[1].uniqueWordCount, 3);

    const byRoot = filterRootFamilies(families, 'ر ح م');
    assert.equal(byRoot.length, 1);
    assert.equal(byRoot[0].root, 'رحم');

    const byBn = filterRootFamilies(families, 'ক্ষমাশীল');
    assert.equal(byBn.length, 1);
    assert.equal(byBn[0].root, 'غفر');
  });
});

describe('quran-study-features: Ayah repeat / range loop & side scrubber math', () => {
  const segs = {
    '1': { timestamp_from: 0, timestamp_to: 4000 },
    '2': { timestamp_from: 4000, timestamp_to: 8500 },
    '3': { timestamp_from: 8500, timestamp_to: 12000 }
  };

  it('loops a single ayah 3 times then completes cleanly', () => {
    const t0 = evaluateAyahLoopTransition(2500, segs, {
      enabled: true,
      mode: 'single',
      repeatLimit: 3,
      completedLoops: 0,
      startAyah: 1,
      endAyah: 1
    });
    assert.deepEqual(t0, { action: 'none' });

    const t1 = evaluateAyahLoopTransition(3980, segs, {
      enabled: true,
      mode: 'single',
      repeatLimit: 3,
      completedLoops: 0,
      startAyah: 1,
      endAyah: 1
    });
    assert.deepEqual(t1, { action: 'seek', targetMs: 0, nextCompletedLoops: 1 });

    const t3 = evaluateAyahLoopTransition(3990, segs, {
      enabled: true,
      mode: 'single',
      repeatLimit: 3,
      completedLoops: 2,
      startAyah: 1,
      endAyah: 1
    });
    assert.deepEqual(t3, { action: 'complete', nextCompletedLoops: 3 });
  });

  it('loops an ayah range infinitely when repeatLimit is 0', () => {
    const tr = evaluateAyahLoopTransition(11980, segs, {
      enabled: true,
      mode: 'range',
      repeatLimit: 0,
      completedLoops: 9,
      startAyah: 2,
      endAyah: 3
    });
    assert.deepEqual(tr, { action: 'seek', targetMs: 4000, nextCompletedLoops: 10 });
  });

  it('maps custom side scrubber drag ratios cleanly to ayah 1..286 and back', () => {
    assert.equal(computeScrubberAyahFromRatio(0, 286), 1);
    assert.equal(computeScrubberAyahFromRatio(0.5, 286), 144);
    assert.equal(computeScrubberAyahFromRatio(1, 286), 286);
    assert.equal(computeScrubberRatioFromAyah(1, 286), 0);
    assert.equal(computeScrubberRatioFromAyah(286, 286), 1);
  });
});
