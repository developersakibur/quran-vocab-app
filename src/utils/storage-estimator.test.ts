import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAudioCacheUrl,
  estimateBucketBytesFromSample,
  selectSampleIndices,
  summarizeAudioCacheKeys,
} from './storage-estimator.ts';

describe('storage-estimator audio cache classification and fast sampling', () => {
  it('classifies surah recitation, word audio, and other URLs accurately', () => {
    assert.deepEqual(
      classifyAudioCacheUrl('https://audio-cdn.tarteel.ai/quran/surah/alafasy/murattal/mp3/001.mp3'),
      { kind: 'surah', surah: 1 },
    );
    assert.deepEqual(
      classifyAudioCacheUrl('https://audio.qurancdn.com/wbw/036_002_004.mp3'),
      { kind: 'word', surah: 36 },
    );
    assert.deepEqual(
      classifyAudioCacheUrl('https://example.com/assets/app.js'),
      { kind: 'other', surah: null },
    );
  });

  it('summarizes thousands of cache keys in a single fast pass', () => {
    const urls = [
      'https://audio-cdn.tarteel.ai/quran/surah/alafasy/murattal/mp3/001.mp3',
      'https://audio-cdn.tarteel.ai/quran/surah/alafasy/murattal/mp3/114.mp3',
      'https://audio.qurancdn.com/wbw/001_001_001.mp3',
      'https://audio.qurancdn.com/wbw/001_001_002.mp3',
      'https://audio.qurancdn.com/wbw/112_001_001.mp3',
    ];
    const summary = summarizeAudioCacheKeys(urls);
    assert.deepEqual(summary.ayahCounts, { 1: 1, 114: 1 });
    assert.deepEqual(summary.wordCounts, { 1: 2, 112: 1 });
    assert.equal(summary.surahUrls.length, 2);
    assert.equal(summary.wordUrls.length, 3);
  });

  it('caps sample indices cleanly for huge word-audio caches (e.g. 77,430 files)', () => {
    const small = selectSampleIndices(10, 32);
    assert.equal(small.length, 10);
    assert.equal(small[0], 0);
    assert.equal(small[9], 9);

    const large = selectSampleIndices(77430, 32);
    assert.equal(large.length, 32);
    assert.equal(large[0], 0);
    assert.equal(large[large.length - 1], 77429);
  });

  it('estimates total bucket bytes accurately from sampled sizes or fallback', () => {
    assert.equal(estimateBucketBytesFromSample(0, [10000]), 0);
    assert.equal(estimateBucketBytesFromSample(1000, [12000, 14000, 16000]), 14_000_000);
    assert.equal(estimateBucketBytesFromSample(500, [], 16384), 8_192_000);
  });
});
