import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySwRequest, resolveNavigationFallbackPath } from './pwa-routing.ts';

const ORIGIN = 'https://developersakibur.github.io';

test('classifySwRequest routes root and index navigations to offline-first handler', () => {
  assert.equal(
    classifySwRequest({ method: 'GET', url: `${ORIGIN}/quran-vocab-app/`, mode: 'navigate', origin: ORIGIN }),
    'navigate-offline-first'
  );
  assert.equal(
    classifySwRequest({ method: 'GET', url: `${ORIGIN}/quran-vocab-app/index.html?source=pwa`, mode: 'navigate', origin: ORIGIN }),
    'navigate-offline-first'
  );
});

test('classifySwRequest bypasses non-GET requests and cross-origin APIs like Supabase', () => {
  assert.equal(
    classifySwRequest({ method: 'POST', url: `${ORIGIN}/quran-vocab-app/api/sync`, mode: 'cors', origin: ORIGIN }),
    'bypass'
  );
  assert.equal(
    classifySwRequest({ method: 'GET', url: 'https://xyz.supabase.co/rest/v1/user_progress', mode: 'cors', origin: ORIGIN }),
    'bypass'
  );
  assert.equal(
    classifySwRequest({ method: 'GET', url: 'chrome-extension://abcd/script.js', mode: 'no-cors', origin: ORIGIN }),
    'bypass'
  );
});

test('classifySwRequest routes audio CDNs, sound effects, surah JSON, and app shell assets accurately', () => {
  assert.equal(
    classifySwRequest({ method: 'GET', url: 'https://audio-cdn.tarteel.ai/quran/surah/alafasy/murattal/mp3/001.mp3', mode: 'cors', origin: ORIGIN }),
    'audio-cache-first'
  );
  assert.equal(
    classifySwRequest({ method: 'GET', url: 'https://audio.qurancdn.com/wbw/001_001_001.mp3', mode: 'cors', origin: ORIGIN }),
    'audio-cache-first'
  );
  assert.equal(
    classifySwRequest({ method: 'GET', url: `${ORIGIN}/quran-vocab-app/assets/sounds/correct.wav`, mode: 'cors', origin: ORIGIN }),
    'sound-cache-first'
  );
  assert.equal(
    classifySwRequest({ method: 'GET', url: `${ORIGIN}/quran-vocab-app/data/surah-content/001.json`, mode: 'cors', origin: ORIGIN }),
    'surah-data-cache-first'
  );
  assert.equal(
    classifySwRequest({ method: 'GET', url: `${ORIGIN}/quran-vocab-app/css/style.css?v=30`, mode: 'no-cors', origin: ORIGIN }),
    'shell-swr'
  );
});

test('resolveNavigationFallbackPath maps subpaths cleanly to cached HTML documents', () => {
  assert.equal(resolveNavigationFallbackPath('/'), './index.html');
  assert.equal(resolveNavigationFallbackPath('/quran-vocab-app/'), './index.html');
  assert.equal(resolveNavigationFallbackPath('/quran-vocab-app/index.html'), './index.html');
  assert.equal(resolveNavigationFallbackPath('/quran-vocab-app/quiz.html'), './quiz.html');
  assert.equal(resolveNavigationFallbackPath('/quran-vocab-app/sets.html'), './sets.html');
});
