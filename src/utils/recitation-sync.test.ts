import test from 'node:test';
import assert from 'node:assert/strict';
import {
  padSurahNumber,
  toBnDigits,
  formatDurationEn,
  formatDurationBn,
  findActiveSegment,
  getAyahSeekSeconds,
  getWordSeekSeconds,
  SurahSegmentsData,
} from './recitation-sync.ts';

const mockSurah1Segments: SurahSegmentsData = {
  surah_number: 1,
  audio_url: 'https://audio-cdn.tarteel.ai/quran/surah/alafasy/murattal/mp3/001.mp3',
  duration: 46,
  ayah_count: 7,
  ayahs: {
    '1': {
      segments: [
        [1, 0, 750],
        [2, 800, 1550],
        [3, 1600, 2710],
        [4, 2760, 5484],
      ],
      duration_sec: 5,
      duration_ms: 5484,
      timestamp_from: 0,
      timestamp_to: 5484,
    },
    '2': {
      segments: [
        [1, 5684, 7230],
        [2, 7280, 8110],
        [3, 8160, 8750],
        [4, 8800, 11259],
      ],
      duration_sec: 5,
      duration_ms: 5575,
      timestamp_from: 5684,
      timestamp_to: 11259,
    },
  },
};

test('padSurahNumber correctly zero pads surah number to 3 digits', () => {
  assert.equal(padSurahNumber(1), '001');
  assert.equal(padSurahNumber('1'), '001');
  assert.equal(padSurahNumber(18), '018');
  assert.equal(padSurahNumber(114), '114');
  assert.equal(padSurahNumber('0'), '001');
});

test('duration formatters convert seconds to English and Bengali MM:SS format', () => {
  assert.equal(formatDurationEn(46), '00:46');
  assert.equal(formatDurationEn(75), '01:15');
  assert.equal(formatDurationBn(46), '০০:৪৬');
  assert.equal(formatDurationBn(75), '০১:১৫');
});

test('findActiveSegment correctly identifies active ayah and word at given millisecond', () => {
  // At 500ms -> Ayah 1, Word 1
  const seg1 = findActiveSegment(mockSurah1Segments, 500);
  assert.equal(seg1.surahNumber, 1);
  assert.equal(seg1.ayahNumber, 1);
  assert.equal(seg1.verseKey, '1:1');
  assert.equal(seg1.wordPosition, 1);
  assert.equal(seg1.wordKey, '1:1:1');

  // At 2000ms -> Ayah 1, Word 3
  const seg2 = findActiveSegment(mockSurah1Segments, 2000);
  assert.equal(seg2.ayahNumber, 1);
  assert.equal(seg2.wordPosition, 3);
  assert.equal(seg2.wordKey, '1:1:3');

  // At 8500ms -> Ayah 2, Word 3
  const seg3 = findActiveSegment(mockSurah1Segments, 8500);
  assert.equal(seg3.ayahNumber, 2);
  assert.equal(seg3.verseKey, '1:2');
  assert.equal(seg3.wordPosition, 3);
  assert.equal(seg3.wordKey, '1:2:3');
});

test('getAyahSeekSeconds and getWordSeekSeconds compute accurate seek targets', () => {
  // Ayah 1 starts at 0ms = 0.0s
  assert.equal(getAyahSeekSeconds(mockSurah1Segments, 1), 0);
  // Ayah 2 starts at 5684ms = 5.684s
  assert.equal(getAyahSeekSeconds(mockSurah1Segments, 2), 5.684);

  // Word 1:1:3 starts at 1600ms = 1.6s
  assert.equal(getWordSeekSeconds(mockSurah1Segments, 1, 3), 1.6);
  // Word 1:2:4 starts at 8800ms = 8.8s
  assert.equal(getWordSeekSeconds(mockSurah1Segments, 2, 4), 8.8);

  // Missing ayah or word returns null
  assert.equal(getAyahSeekSeconds(mockSurah1Segments, 99), null);
  assert.equal(getWordSeekSeconds(mockSurah1Segments, 1, 99), null);
});

import { computeRecitationWordStates } from './recitation-sync.ts';

test('computeRecitationWordStates separates active word, recited green words, and unrecited normal words', () => {
  // At 1000ms (Ayah 1, Word 2 is active [800..1550]; Word 1 [0..750] is already recited; Words 3 & 4 are normal)
  const st1 = computeRecitationWordStates(mockSurah1Segments, 1000, 1);
  assert.equal(st1.activeAyahNumber, 1);
  assert.equal(st1.activeWordKey, '1:1:2');
  assert.deepEqual(st1.recitedWordKeys, ['1:1:1']);

  // At 3000ms (Ayah 1, Word 4 is active [2760..5484]; Words 1, 2, 3 are recited)
  const st2 = computeRecitationWordStates(mockSurah1Segments, 3000, 1);
  assert.equal(st2.activeAyahNumber, 1);
  assert.equal(st2.activeWordKey, '1:1:4');
  assert.deepEqual(st2.recitedWordKeys, ['1:1:1', '1:1:2', '1:1:3']);

  // At 7500ms (Ayah 2, Word 2 is active [7280..8110]; all 4 words of Ayah 1 + Word 1 of Ayah 2 are recited)
  const st3 = computeRecitationWordStates(mockSurah1Segments, 7500, 1);
  assert.equal(st3.activeAyahNumber, 2);
  assert.equal(st3.activeWordKey, '1:2:2');
  assert.deepEqual(st3.recitedWordKeys, ['1:1:1', '1:1:2', '1:1:3', '1:1:4', '1:2:1']);
});

import {
  computeAutoScrollTargetTop,
  estimateLegacyOpaqueAudioBytes,
  computeAyahClipBounds,
} from './recitation-sync.ts';

test('computeAutoScrollTargetTop scrolls immediately when forced after toggle-on or off-screen', () => {
  // Viewport 900px, topbar ends at 64px, floating player bar starts at 750px
  // safeTop = 80, safeBottom = 734, desiredViewportY = 80 + 96 = 176
  // User scrolled down so active word is off-screen above (elementTopInViewport = -600)
  const target = computeAutoScrollTargetTop({
    scrollY: 1200,
    viewportHeight: 900,
    topbarBottom: 64,
    playerTop: 750,
    elementTopInViewport: -600,
    elementHeight: 60,
    force: true,
  });
  // Expected: 1200 + (-600 - 176) = 424
  assert.equal(target, 424);

  // Word slipped underneath floating player bar (elementTopInViewport = 760, height = 56) -> even with force:false, must scroll!
  const targetBelowBar = computeAutoScrollTargetTop({
    scrollY: 300,
    viewportHeight: 900,
    topbarBottom: 64,
    playerTop: 750,
    elementTopInViewport: 760,
    elementHeight: 56,
    force: false,
  });
  assert.equal(targetBelowBar, 300 + (760 - 176));

  // Word already comfortably in safe zone (elementTopInViewport = 200) -> force:false does not jitter
  const noScroll = computeAutoScrollTargetTop({
    scrollY: 500,
    viewportHeight: 900,
    topbarBottom: 64,
    playerTop: 750,
    elementTopInViewport: 200,
    elementHeight: 56,
    force: false,
  });
  assert.equal(noScroll, null);
});

test('estimateLegacyOpaqueAudioBytes avoids 7MB Chrome opaque padding for word and surah audio', () => {
  // 3300 word files must be ~52 MB total, NOT 23,201 MB!
  const oneWord = estimateLegacyOpaqueAudioBytes('https://audio.qurancdn.com/wbw/001_001_001.mp3');
  assert.equal(oneWord, 16 * 1024);
  assert.ok(oneWord * 3300 < 60 * 1024 * 1024);

  // Tarteel Surah 1 (46s) at 128kbps ~ 736 KB
  const surah1 = estimateLegacyOpaqueAudioBytes(
    'https://audio-cdn.tarteel.ai/quran/surah/alafasy/murattal/mp3/001.mp3',
    46,
    29
  );
  assert.equal(surah1, 46 * 16000);
});

test('computeAyahClipBounds stops cleanly in inter-ayah silence without bleeding into next ayah', () => {
  const baqarahSample: SurahSegmentsData = {
    surah_number: 2,
    audio_url: 'https://audio-cdn.tarteel.ai/quran/surah/alafasy/murattal/mp3/002.mp3',
    duration: 7264,
    ayah_count: 286,
    ayahs: {
      '2': {
        timestamp_from: 7650,
        timestamp_to: 16640,
        duration_sec: 8.99,
        duration_ms: 8990,
        segments: [
          [1, 7595, 8495],
          [7, 12905, 16500],
        ],
      },
      '3': {
        timestamp_from: 16640,
        timestamp_to: 28060,
        duration_sec: 11.42,
        duration_ms: 11420,
        segments: [
          [1, 16555, 17595],
          [8, 24545, 27920],
        ],
      },
      '255': {
        timestamp_from: 6153050,
        timestamp_to: 6205010,
        duration_sec: 51.96,
        duration_ms: 51960,
        segments: [
          [1, 6152975, 6154085],
          [50, 6202628, 6204868],
        ],
      },
      '256': {
        timestamp_from: 6205010,
        timestamp_to: 6230190,
        duration_sec: 25.18,
        duration_ms: 25180,
        segments: [
          [1, 6204955, 6207075],
          [24, 6227905, 6230070],
        ],
      },
    },
  };

  // Normal ayah (2:2): stops at last word end (16500ms), strictly before next ayah's first word (16555ms)
  const b2 = computeAyahClipBounds(baqarahSample, 2);
  assert.ok(b2);
  assert.equal(b2.startMs, 7650);
  assert.equal(b2.stopMs, 16500);
  assert.ok(b2.stopMs < 16555);

  // Long surah Ayah 2:255: stops at 6204868ms (strictly before 2:256's first word at 6204955ms)
  const b255 = computeAyahClipBounds(baqarahSample, 255);
  assert.ok(b255);
  assert.equal(b255.stopMs, 6204868);
  assert.ok(b255.stopMs < 6204955);

  // Incomplete word segments (like 35:1 where segments ended early at 14815 vs timestamp_to 28160):
  // Must NOT cut off at 14815, and must still pull back slightly before next ayah's timestamp_from
  const incompleteSample: SurahSegmentsData = {
    surah_number: 35,
    audio_url: 'https://audio-cdn.tarteel.ai/quran/surah/alafasy/murattal/mp3/035.mp3',
    duration: 965,
    ayah_count: 45,
    ayahs: {
      '1': {
        timestamp_from: 0,
        timestamp_to: 28160,
        duration_sec: 28.16,
        duration_ms: 28160,
        segments: [[1, 0, 840], [13, 13160, 14815]],
      },
      '2': {
        timestamp_from: 28160,
        timestamp_to: 45740,
        duration_sec: 17.58,
        duration_ms: 17580,
        segments: [[1, 14815, 15325]],
      },
    },
  };
  const b35 = computeAyahClipBounds(incompleteSample, 1);
  assert.ok(b35);
  assert.equal(b35.stopMs, 28090); // 28160 - 70ms safety margin, never truncated to 14815

  // Corrupted backward next-ayah segment (like 29:10 -> 29:11): ignores outlier and stops at 29:10's last word end
  const outlierSample: SurahSegmentsData = {
    surah_number: 29,
    audio_url: 'https://audio-cdn.tarteel.ai/quran/surah/alafasy/murattal/mp3/029.mp3',
    duration: 1357,
    ayah_count: 69,
    ayahs: {
      '10': {
        timestamp_from: 144530,
        timestamp_to: 194890,
        duration_sec: 50.36,
        duration_ms: 50360,
        segments: [[1, 144530, 145995], [31, 192029, 194558]],
      },
      '11': {
        timestamp_from: 194890,
        timestamp_to: 205680,
        duration_sec: 10.79,
        duration_ms: 10790,
        segments: [[1, 144495, 197183]],
      },
    },
  };
  const b29 = computeAyahClipBounds(outlierSample, 10);
  assert.ok(b29);
  assert.equal(b29.stopMs, 194558);
});


