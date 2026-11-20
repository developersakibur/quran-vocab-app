import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AYAH_PASS_PREFIX,
  isAyahPassKey,
  makeAyahPassKey,
  parseAyahPassKey,
  didPassAyahQuiz,
  computeSurahAyahStates,
  computeSurahAyahSummary,
  buildAyahQuizSurahRows,
  computeGlobalAyahQuizOverview,
  findRecommendedResumeAyah,
  filterAyahQuizSurahs,
  buildAyahMiniSteps,
  type AyahRecordLike,
  type SurahMetaLike
} from './ayah-quiz-roadmap';

const SAMPLE_FATIHAH_AYAHS: AyahRecordLike[] = [
  {
    surah: 1,
    ayah: 1,
    verse_key: '1:1',
    arabic: 'بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ',
    words: [
      { key: '1:1:1', position: 1, arabic: 'بِسۡمِ', meaning_bn: 'নামে' },
      { key: '1:1:2', position: 2, arabic: 'ٱللَّهِ', meaning_bn: 'আল্লাহ (র)' },
      { key: '1:1:3', position: 3, arabic: 'ٱلرَّحۡمَٰنِ', meaning_bn: 'পরম করুণাময়' },
      { key: '1:1:4', position: 4, arabic: 'ٱلرَّحِيمِ', meaning_bn: 'অসীম দয়ালু' }
    ]
  },
  {
    surah: 1,
    ayah: 2,
    verse_key: '1:2',
    arabic: 'ٱلۡحَمۡدُ لِلَّهِ رَبِّ ٱلۡعَٰلَمِينَ',
    words: [
      { key: '1:2:1', position: 1, arabic: 'ٱلۡحَمۡدُ', meaning_bn: 'সকল প্রশংসা' },
      { key: '1:2:2', position: 2, arabic: 'لِلَّهِ', meaning_bn: 'আল্লাহর জন্য' },
      { key: '1:2:3', position: 3, arabic: 'رَبِّ', meaning_bn: 'রব' },
      { key: '1:2:4', position: 4, arabic: 'ٱلۡعَٰلَمِينَ', meaning_bn: 'সারা জগতের' }
    ]
  },
  {
    surah: 1,
    ayah: 3,
    verse_key: '1:3',
    arabic: 'ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ',
    words: [
      { key: '1:3:1', position: 1, arabic: 'ٱلرَّحۡمَٰنِ', meaning_bn: 'অশেষ করুণাময়' },
      { key: '1:3:2', position: 2, arabic: 'ٱلرَّحِيمِ', meaning_bn: 'পরম দয়ালু' }
    ]
  }
];

const SAMPLE_SURAHS_META: SurahMetaLike[] = [
  {
    surah: 1,
    name_arabic: 'الفاتحة',
    name_transliteration: 'Al-Fatihah',
    name_bn: 'সূচনা',
    name_bn_script: 'আল-ফাতিহা',
    type: 'meccan',
    total_ayahs: 7,
    total_words: 29
  },
  {
    surah: 2,
    name_arabic: 'البقرة',
    name_transliteration: 'Al-Baqarah',
    name_bn: 'বকনা-বাছুর',
    name_bn_script: 'আল-বাকারা',
    type: 'medinan',
    total_ayahs: 286,
    total_words: 6117
  },
  {
    surah: 112,
    name_arabic: 'الإخلاص',
    name_transliteration: 'Al-Ikhlas',
    name_bn: 'একত্ববাদ',
    name_bn_script: 'আল-ইখলাস',
    type: 'meccan',
    total_ayahs: 4,
    total_words: 15
  }
];

test('ayah pass key helpers build, detect, and parse canonical keys', () => {
  const key = makeAyahPassKey(1, 3);
  assert.equal(key, `${AYAH_PASS_PREFIX}1:3`);
  assert.equal(isAyahPassKey(key), true);
  assert.equal(isAyahPassKey('mcq_pass:g1:main:1'), false);
  assert.equal(isAyahPassKey('1:1:1'), false);

  assert.deepEqual(parseAyahPassKey(key), { surah: 1, ayah: 3, verseKey: '1:3' });
  assert.equal(parseAyahPassKey('ayah_pass:0:1'), null);
  assert.equal(parseAyahPassKey('ayah_pass:115:1'), null);
  assert.equal(parseAyahPassKey('ayah_pass:invalid'), null);
});

test('didPassAyahQuiz enforces strict 100% score threshold', () => {
  assert.equal(didPassAyahQuiz(4, 4), true);
  assert.equal(didPassAyahQuiz(1, 1), true);
  assert.equal(didPassAyahQuiz(3, 4), false);
  assert.equal(didPassAyahQuiz(0, 4), false);
  assert.equal(didPassAyahQuiz(0, 0), false);
});

test('Ayah 1 of every surah starts unlocked while subsequent ayahs remain locked until previous ayah passes', () => {
  const freshStates = computeSurahAyahStates(1, SAMPLE_FATIHAH_AYAHS, {}, {});
  assert.equal(freshStates.length, 3);
  assert.equal(freshStates[0].isUnlocked, true);
  assert.equal(freshStates[0].isActive, true);
  assert.equal(freshStates[0].status, 'active');
  assert.equal(freshStates[0].learnedCount, 0);
  assert.equal(freshStates[0].totalWords, 4);

  assert.equal(freshStates[1].isUnlocked, false);
  assert.equal(freshStates[1].status, 'locked');
  assert.equal(freshStates[2].isUnlocked, false);
  assert.equal(freshStates[2].status, 'locked');
});

test('partial learned words update ayah learnedCount but do NOT unlock the next ayah', () => {
  const progressMap = {
    '1:1:1': { repetitions: 1, correctCount: 1 },
    '1:1:2': { repetitions: 1, correctCount: 1 },
    '1:1:3': { repetitions: 1, correctCount: 1 }
  };
  const states = computeSurahAyahStates(1, SAMPLE_FATIHAH_AYAHS, progressMap, {});
  assert.equal(states[0].learnedCount, 3);
  assert.equal(states[0].totalWords, 4);
  assert.equal(states[0].pct, 75);
  assert.equal(states[0].isPassed, false);
  assert.equal(states[1].isUnlocked, false);
  assert.equal(states[1].status, 'locked');
});

test('passing Ayah 1 unlocks Ayah 2 while keeping Ayah 3 locked', () => {
  const passedMap = {
    '1:1': { verseKey: '1:1', surah: 1, ayah: 1, passed: true, score: 4, total: 4, passedAt: 1000 }
  };
  const summary = computeSurahAyahSummary(1, SAMPLE_FATIHAH_AYAHS, {}, passedMap);

  assert.equal(summary.completedAyahs, 1);
  assert.equal(summary.totalAyahs, 3);
  assert.equal(summary.learnedWords, 4);
  assert.equal(summary.totalWords, 10);
  assert.equal(summary.activeAyahNumber, 2);

  assert.equal(summary.states[0].isPassed, true);
  assert.equal(summary.states[0].status, 'passed');
  assert.equal(summary.states[0].learnedCount, 4);

  assert.equal(summary.states[1].isUnlocked, true);
  assert.equal(summary.states[1].isActive, true);
  assert.equal(summary.states[1].status, 'active');

  assert.equal(summary.states[2].isUnlocked, false);
  assert.equal(summary.states[2].status, 'locked');
});

test('surah rows, global overview, and resume recommendation track multi-surah completion accurately', () => {
  const passedMap = {
    '112:1': { verseKey: '112:1', surah: 112, ayah: 1, passed: true, passedAt: 2000 },
    '112:2': { verseKey: '112:2', surah: 112, ayah: 2, passed: true, passedAt: 2100 },
    '112:3': { verseKey: '112:3', surah: 112, ayah: 3, passed: true, passedAt: 2200 },
    '112:4': { verseKey: '112:4', surah: 112, ayah: 4, passed: true, passedAt: 2300 },
    '1:1': { verseKey: '1:1', surah: 1, ayah: 1, passed: true, passedAt: 3000 },
    '1:2': { verseKey: '1:2', surah: 1, ayah: 2, passed: true, passedAt: 3100 }
  };

  const rows = buildAyahQuizSurahRows(SAMPLE_SURAHS_META, passedMap);
  const fatihah = rows.find((r) => r.surah === 1)!;
  const baqarah = rows.find((r) => r.surah === 2)!;
  const ikhlas = rows.find((r) => r.surah === 112)!;

  assert.equal(fatihah.completedAyahs, 2);
  assert.equal(fatihah.isStarted, true);
  assert.equal(fatihah.isComplete, false);
  assert.equal(fatihah.nextAyahNumber, 3);

  assert.equal(baqarah.completedAyahs, 0);
  assert.equal(baqarah.nextAyahNumber, 1);

  assert.equal(ikhlas.completedAyahs, 4);
  assert.equal(ikhlas.isComplete, true);
  assert.equal(ikhlas.pct, 100);

  const overview = computeGlobalAyahQuizOverview(rows);
  assert.equal(overview.completedAyahs, 6);
  assert.equal(overview.totalAyahs, 297);
  assert.equal(overview.completedSurahs, 1);
  assert.equal(overview.startedSurahs, 1);

  const resume = findRecommendedResumeAyah(rows);
  assert.deepEqual(resume, {
    surah: 1,
    surahNameBn: 'আল-ফাতিহা',
    ayah: 3,
    completedAyahs: 2,
    totalAyahs: 7,
    isSurahStarted: true
  });
});

test('filterAyahQuizSurahs supports Bengali digits, Arabic/Bangla/English search, and status tabs', () => {
  const passedMap = {
    '112:1': true,
    '112:2': true,
    '112:3': true,
    '112:4': true,
    '1:1': true
  };
  const rows = buildAyahQuizSurahRows(SAMPLE_SURAHS_META, passedMap);

  assert.equal(filterAyahQuizSurahs(rows, '', 'all').length, 3);
  assert.equal(filterAyahQuizSurahs(rows, '', 'in-progress').map((r) => r.surah).join(','), '1');
  assert.equal(filterAyahQuizSurahs(rows, '', 'completed').map((r) => r.surah).join(','), '112');
  assert.equal(filterAyahQuizSurahs(rows, '১১২', 'all')[0].surah, 112);
  assert.equal(filterAyahQuizSurahs(rows, 'ইখলাস', 'all')[0].surah, 112);
  assert.equal(filterAyahQuizSurahs(rows, 'baqarah', 'all')[0].surah, 2);
  assert.equal(filterAyahQuizSurahs(rows, 'الفاتحة', 'all')[0].surah, 1);
});

test('buildAyahMiniSteps keeps short surahs flat and chunks long surahs into 20-ayah steps', () => {
  const shortStates = computeSurahAyahStates(1, SAMPLE_FATIHAH_AYAHS, {}, {});
  const shortSteps = buildAyahMiniSteps(shortStates, 20);
  assert.equal(shortSteps.length, 1);
  assert.equal(shortSteps[0].items.length, 3);

  const longAyahs: AyahRecordLike[] = Array.from({ length: 45 }, (_, idx) => ({
    surah: 2,
    ayah: idx + 1,
    verse_key: `2:${idx + 1}`,
    arabic: 'الٓمٓ',
    words: [{ key: `2:${idx + 1}:1`, position: 1, arabic: 'الٓمٓ', meaning_bn: 'আলিফ-লাম-মীম' }]
  }));
  const passed: Record<string, boolean> = {};
  for (let i = 1; i <= 22; i++) passed[`2:${i}`] = true;

  const longStates = computeSurahAyahStates(2, longAyahs, {}, passed);
  const longSteps = buildAyahMiniSteps(longStates, 20);
  assert.equal(longSteps.length, 3);
  assert.equal(longSteps[0].startAyah, 1);
  assert.equal(longSteps[0].endAyah, 20);
  assert.equal(longSteps[0].passedCount, 20);
  assert.equal(longSteps[0].hasActive, false);

  assert.equal(longSteps[1].startAyah, 21);
  assert.equal(longSteps[1].endAyah, 40);
  assert.equal(longSteps[1].passedCount, 2);
  assert.equal(longSteps[1].hasActive, true);

  assert.equal(longSteps[2].startAyah, 41);
  assert.equal(longSteps[2].endAyah, 45);
  assert.equal(longSteps[2].items.length, 5);
});
