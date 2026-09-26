/* ============================================================
   SERVICE WORKER
   - Caches the app shell (HTML/CSS/JS/JSON) on install.
   - Caches audio files (from the external CDNs) the first time
     they're played, OR in bulk when "Download All" is used.
   - Once cached, audio and app files are served from cache first
     so the app works fully offline afterward.
   ============================================================ */

const APP_SHELL_CACHE = 'quran-app-shell-v1';
const AUDIO_CACHE = 'quran-audio-v1';

const APP_SHELL_FILES = [
  'index.html',
  'quiz.html',
  'manifest.json',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'css/theme.css',
  'css/style.css',
  'js/theme.js',
  'js/storage/storage-manager.js',
  'js/data/word-repository.js',
  'js/progress-manager.js',
  'js/distractor-generator.js',
  'data/surahs-meta.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== APP_SHELL_CACHE && k !== AUDIO_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

function isAudioRequest(url) {
  return url.includes('audio.qurancdn.com') || url.includes('everyayah.com');
}

function isSurahDataRequest(url) {
  return url.includes('/data/surah-content/');
}

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Audio: cache-first (once downloaded, never re-fetch from network)
  if (isAudioRequest(url)) {
    event.respondWith(
      caches.open(AUDIO_CACHE).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((response) => {
            // Cross-origin audio requests come back as opaque responses
            // (status unreadable) unless the CDN sends CORS headers —
            // cache them anyway since a valid opaque response is still playable.
            if (response && (response.ok || response.type === 'opaque')) {
              cache.put(event.request, response.clone());
            }
            return response;
          });
        })
      )
    );
    return;
  }

  // Per-surah JSON data: cache-first, so once visited it works offline
  if (isSurahDataRequest(url)) {
    event.respondWith(
      caches.open(APP_SHELL_CACHE).then((cache) =>
        cache.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((response) => {
            if (response && response.status === 200) {
              cache.put(event.request, response.clone());
            }
            return response;
          });
        })
      )
    );
    return;
  }

  // App shell files: cache-first with network fallback.
  // ignoreSearch is essential here — quiz.html?surah=2 must match the
  // cached "quiz.html" entry (saved without a query string at install
  // time), otherwise it's treated as a different URL and offline
  // navigation to any surah's quiz page fails.
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((cached) => cached || fetch(event.request))
  );
});

/* ---- Bulk "Download All" support ----
   The page posts a list of audio URLs; we fetch and cache them
   using a small pool of parallel workers (instead of one-at-a-time)
   so the per-request setup/teardown overhead doesn't add up across
   thousands of small audio files. Progress is still reported after
   every completed file, in the order files finish (not the order
   they were queued). */
const MAX_PARALLEL_DOWNLOADS = 5;

async function downloadOne(cache, url) {
  try {
    const existing = await cache.match(url);
    if (existing) return; // already cached — nothing to do
    const response = await fetch(url, { mode: 'no-cors' });
    if (response && (response.ok || response.type === 'opaque')) {
      await cache.put(url, response.clone());
    }
  } catch (e) {
    // skip this file, the rest of the batch continues
  }
}

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'DOWNLOAD_AUDIO_BATCH') {
    const urls = event.data.urls;
    const client = event.source;
    caches.open(AUDIO_CACHE).then(async (cache) => {
      let nextIndex = 0;
      let done = 0;

      async function worker() {
        while (nextIndex < urls.length) {
          const myIndex = nextIndex++;
          await downloadOne(cache, urls[myIndex]);
          done++;
          client.postMessage({ type: 'DOWNLOAD_PROGRESS', done, total: urls.length });
        }
      }

      const workerCount = Math.min(MAX_PARALLEL_DOWNLOADS, urls.length);
      const workers = [];
      for (let i = 0; i < workerCount; i++) workers.push(worker());
      await Promise.all(workers);

      client.postMessage({ type: 'DOWNLOAD_COMPLETE', total: urls.length });
    });
  }
});
