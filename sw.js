/* ============================================================
   SERVICE WORKER
   - Caches the app shell (HTML/CSS/JS/JSON) on install.
   - Caches audio files (from the external CDNs) the first time
     they're played, OR in bulk when "Download All" is used.
   - Once cached, audio and app files are served from cache first
     so the app works fully offline afterward.
   ============================================================ */

const APP_SHELL_CACHE = 'quran-app-shell-v8';
const AUDIO_CACHE = 'quran-audio-v1';

const APP_SHELL_FILES = [
  'index.html',
  'quiz.html',
  'sets.html',
  'manifest.json',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'css/theme.css',
  'css/style.css',
  'css/fonts.css',
  'assets/fonts/indopak-nastaleeq.woff2',
  'assets/fonts/indopak-khatt.woff2',
  'assets/fonts/Amiri-400-0.woff2',
  'assets/fonts/Amiri-400-1.woff2',
  'assets/fonts/Amiri-400-2.woff2',
  'assets/fonts/Amiri-700-3.woff2',
  'assets/fonts/Amiri-700-4.woff2',
  'assets/fonts/Amiri-700-5.woff2',
  'assets/fonts/Noto-Sans-Bengali-400-6.woff2',
  'assets/fonts/Noto-Sans-Bengali-400-7.woff2',
  'assets/fonts/Noto-Sans-Bengali-400-8.woff2',
  'assets/fonts/Noto-Sans-Bengali-600-9.woff2',
  'assets/fonts/Noto-Sans-Bengali-600-10.woff2',
  'assets/fonts/Noto-Sans-Bengali-600-11.woff2',
  'assets/fonts/Noto-Sans-Bengali-700-12.woff2',
  'assets/fonts/Noto-Sans-Bengali-700-13.woff2',
  'assets/fonts/Noto-Sans-Bengali-700-14.woff2',
  'js/icons.js',
  'js/lib/supabase-bundle.js',
  'js/supabase-config.js',
  'js/supabase-sync.js',
  'js/ui/overlay-manager.js',
  'js/theme.js',
  'js/config.js',
  'js/data/surahs-meta-data.js',
  'js/db/quran-db.js',
  'js/app.js',
  'js/storage/storage-manager.js',
  'js/data/word-repository.js',
  'js/progress-manager.js',
  'js/set-progress-manager.js',
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
  return url.includes('audio.qurancdn.com') || url.includes('everyayah.com') || url.includes('audio-cdn.tarteel.ai') || url.endsWith('.mp3');
}

function isSurahDataRequest(url) {
  return url.includes('/data/surah-content/') || url.includes('/data/segments/') || url.includes('/data/word-summaries/');
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

  // Per-surah JSON data: Cache-first for instant loading and zero network latency
  if (isSurahDataRequest(url)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(APP_SHELL_CACHE).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // App shell files: Network-first with cache fallback.
  // Guarantees code updates (CSS/JS/HTML) are immediately seen when online,
  // while preserving full 100% offline capabilities when disconnected.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(APP_SHELL_CACHE).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
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

    function notifyClient(msg) {
      if (client && typeof client.postMessage === 'function') {
        client.postMessage(msg);
      } else {
        self.clients.matchAll().then((clients) => {
          clients.forEach((c) => c.postMessage(msg));
        });
      }
    }

    caches.open(AUDIO_CACHE).then(async (cache) => {
      let nextIndex = 0;
      let done = 0;

      async function worker() {
        while (nextIndex < urls.length) {
          const myIndex = nextIndex++;
          const url = urls[myIndex];
          await downloadOne(cache, url);
          done++;
          notifyClient({
            type: 'DOWNLOAD_PROGRESS',
            done,
            total: urls.length,
            url: url
          });
        }
      }

      const workerCount = Math.min(MAX_PARALLEL_DOWNLOADS, urls.length);
      const workers = [];
      for (let i = 0; i < workerCount; i++) workers.push(worker());
      await Promise.all(workers);

      notifyClient({ type: 'DOWNLOAD_COMPLETE', total: urls.length });
    });
  }
});
