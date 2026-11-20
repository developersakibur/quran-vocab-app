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


