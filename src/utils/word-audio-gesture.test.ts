import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWordAudioUrl,
  buildAyahAudioUrl,
  WordGestureController,
  SurahMemoryCache
} from './word-audio-gesture';

test('buildWordAudioUrl correctly formats word CDN url with zero padding', () => {
  assert.equal(
    buildWordAudioUrl('1:1:1'),
    'https://audio.qurancdn.com/wbw/001_001_001.mp3'
  );
  assert.equal(
    buildWordAudioUrl('2:255:12'),
    'https://audio.qurancdn.com/wbw/002_255_012.mp3'
  );
  assert.equal(
    buildWordAudioUrl('114:6:3'),
    'https://audio.qurancdn.com/wbw/114_006_003.mp3'
  );
});

test('buildWordAudioUrl handles empty or invalid keys gracefully', () => {
  assert.equal(buildWordAudioUrl(''), '');
  assert.equal(buildWordAudioUrl('invalid'), '');
});

test('buildAyahAudioUrl correctly formats ayah audio url', () => {
  assert.equal(
    buildAyahAudioUrl(1, 1),
    'https://everyayah.com/data/Alafasy_128kbps/001001.mp3'
  );
  assert.equal(
    buildAyahAudioUrl(2, 255),
    'https://everyayah.com/data/Alafasy_128kbps/002255.mp3'
  );
  assert.equal(
    buildAyahAudioUrl('114', '6'),
    'https://everyayah.com/data/Alafasy_128kbps/114006.mp3'
  );
});

test('WordGestureController tracks long-press threshold and movement cancel', () => {
  const controller = new WordGestureController({ holdThresholdMs: 380, moveThresholdPx: 10 });
  const t0 = 1000;
  const gesture = controller.initGesture(50, 50, t0);

  // Before threshold
  assert.equal(controller.isLongPressThresholdMet(gesture, t0 + 200), false);
  // After threshold
  assert.equal(controller.isLongPressThresholdMet(gesture, t0 + 400), true);

  // Tiny movement should not cancel
  assert.equal(controller.shouldCancelOnMove(gesture, 53, 52), false);
  // Large movement (e.g. scroll) should cancel
  assert.equal(controller.shouldCancelOnMove(gesture, 70, 50), true);
});

test('SurahMemoryCache deduplicates in-flight requests and caches result', async () => {
  const cache = new SurahMemoryCache<string>();
  let fetchCount = 0;

  const mockFetcher = async (num: number) => {
    fetchCount++;
    await new Promise((r) => setTimeout(r, 20));
    return `Surah_${num}_data`;
  };

  // Two simultaneous requests for surah 1
  const [res1, res2] = await Promise.all([
    cache.getOrFetch(1, mockFetcher),
    cache.getOrFetch(1, mockFetcher)
  ]);

  assert.equal(res1, 'Surah_1_data');
  assert.equal(res2, 'Surah_1_data');
  assert.equal(fetchCount, 1, 'In-flight fetcher should only be called once');

  // Third request should be synchronous from cache
  const res3 = await cache.getOrFetch(1, mockFetcher);
  assert.equal(res3, 'Surah_1_data');
  assert.equal(fetchCount, 1, 'Cached data should not call fetcher again');
});
