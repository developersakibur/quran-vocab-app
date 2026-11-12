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
