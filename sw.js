/* ============================================================
   SERVICE WORKER
   - Precaches critical app shell (including './' & './index.html')
     resiliently so installed PWA always opens instantaneously offline.
   - Serves navigation & static shell assets Cache-First with background
     revalidation (Stale-While-Revalidate) and guaranteed offline fallback.
   - Caches sound effects, surah JSON data, and audio files Cache-First.
   - Bypasses non-GET and cross-origin APIs (e.g., Supabase sync).
   ============================================================ */

const APP_SHELL_CACHE = 'quran-app-shell-v36';
const AUDIO_CACHE = 'quran-audio-v1';
const SOUND_CACHE = 'quran-sound-effects-v1';

const CORE_SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/sounds/correct.wav',
  './assets/sounds/wrong.wav',
  './css/theme.css',
  './css/style.css',
  './css/fonts.css',
  './js/icons.js',
  './js/ui/overlay-manager.js',
  './js/theme.js',
  './js/font-settings.js',
  './js/sound-effects.js',
  './js/download-header-helper.js',
  './js/pwa-install.js',
  './js/config.js',
  './js/data/surahs-meta-data.js',
  './js/db/quran-db.js',
  './js/storage/storage-manager.js',
  './js/reading-history.js',
  './js/progress-chart.js',
  './js/mcq-frequency-groups.js',
  './js/ayah-quiz-roadmap.js',
  './js/app.js'
];

const OPTIONAL_SHELL_FILES = [
  './quiz.html',
  './sets.html',
  './assets/fonts/indopak-nastaleeq.woff2',
  './assets/fonts/indopak-khatt.woff2',
  './assets/fonts/Amiri-400-0.woff2',
  './assets/fonts/Amiri-400-1.woff2',
  './assets/fonts/Amiri-400-2.woff2',
  './assets/fonts/Amiri-700-3.woff2',
  './assets/fonts/Amiri-700-4.woff2',
  './assets/fonts/Amiri-700-5.woff2',
  './assets/fonts/Noto-Sans-Bengali-400-6.woff2',
  './assets/fonts/Noto-Sans-Bengali-400-7.woff2',
  './assets/fonts/Noto-Sans-Bengali-400-8.woff2',
  './assets/fonts/Noto-Sans-Bengali-600-9.woff2',
  './assets/fonts/Noto-Sans-Bengali-600-10.woff2',
  './assets/fonts/Noto-Sans-Bengali-600-11.woff2',
  './assets/fonts/Noto-Sans-Bengali-700-12.woff2',
  './assets/fonts/Noto-Sans-Bengali-700-13.woff2',
  './assets/fonts/Noto-Sans-Bengali-700-14.woff2',
  './js/lib/d3.min.js',
  './js/lib/supabase-bundle.js',
  './js/supabase-config.js',
  './js/supabase-sync.js',
  './js/data/word-repository.js',
  './js/progress-manager.js',
  './js/set-progress-manager.js',
  './js/distractor-generator.js',
  './data/surahs-meta.json',
  './data/lookup/frequency-index.json'
];

function buildPrecacheHeaders(relPath) {
  const lower = String(relPath || '').toLowerCase();
  if (lower.endsWith('.css')) {
    return { Accept: 'text/css,*/*;q=0.1' };
  }
  if (lower === './' || lower.endsWith('.html')) {
    return { Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
  }
  return {};
}

function isValidResponseForUrl(url, res) {
  if (!res || !res.ok) return false;
  const lower = String(url || '').toLowerCase().split('?')[0];
  const ct = (res.headers && res.headers.get('content-type') || '').toLowerCase();
  if (lower.endsWith('.css') && ct && !ct.includes('text/css')) {
    return false;
  }
  return true;
}

async function precacheResilient(cache, urls) {
  await Promise.allSettled(
    urls.map(async (relPath) => {
      const headers = buildPrecacheHeaders(relPath);
      try {
        const req = new Request(relPath, { cache: 'reload', headers });
        const res = await fetch(req);
        if (isValidResponseForUrl(relPath, res)) {
          await cache.put(relPath, res.clone());
          return;
        }
      } catch (e) {}
      try {
        const fallbackReq = new Request(relPath, { headers });
        const res = await fetch(fallbackReq);
        if (isValidResponseForUrl(relPath, res)) {
          await cache.put(relPath, res.clone());
        }
      } catch (err) {}
    })
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then(async (cache) => {
      await precacheResilient(cache, CORE_SHELL_FILES);
      await precacheResilient(cache, OPTIONAL_SHELL_FILES);
      // Mirror index.html under './' if './' didn't cache cleanly
      const rootCached = await cache.match('./', { ignoreSearch: true, ignoreVary: true });
      const indexCached = await cache.match('./index.html', { ignoreSearch: true, ignoreVary: true });
      if (!rootCached && indexCached) {
        await cache.put('./', indexCached.clone());
      } else if (rootCached && !indexCached) {
        await cache.put('./index.html', rootCached.clone());
      }
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== APP_SHELL_CACHE && k !== AUDIO_CACHE && k !== SOUND_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

function isAudioRequest(url) {
  return url.includes('audio.qurancdn.com') || url.includes('audio-cdn.tarteel.ai') || /\.mp3(\?.*)?$/i.test(url);
}

function isSoundEffectRequest(url) {
  return url.includes('/assets/sounds/');
}

function isSurahDataRequest(url) {
  return url.includes('/data/surah-content/') || url.includes('/data/segments/') || url.includes('/data/word-summaries/') || url.includes('/data/lookup/');
}

function resolveNavFallback(pathname) {
  const lower = (pathname || '').toLowerCase();
  if (lower.endsWith('/quiz.html')) return './quiz.html';
  if (lower.endsWith('/sets.html')) return './sets.html';
  return './index.html';
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (!req || req.method !== 'GET') return;

  let parsedUrl;
  try {
    parsedUrl = new URL(req.url);
  } catch (e) {
    return;
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return;
  }

  const url = parsedUrl.href;

  // 1. Quiz UI Sound Effects: Cache-first in SOUND_CACHE for instant zero-network feedback
  if (isSoundEffectRequest(url)) {
    event.respondWith(
      caches.open(SOUND_CACHE).then(async (cache) => {
        const cached =
          (await cache.match(req, { ignoreSearch: true, ignoreVary: true })) ||
          (await caches.match(req, { ignoreSearch: true, ignoreVary: true }));
        if (cached) return cached;
        try {
          const response = await fetch(req);
          if (response && response.status === 200) {
            cache.put(req, response.clone());
          }
          return response;
        } catch (e) {
          return new Response('', { status: 503, statusText: 'Offline' });
        }
      })
    );
    return;
  }

  // 2. Audio CDN: Cache-first by URL (once downloaded, never re-fetch from network)
  if (isAudioRequest(url)) {
    event.respondWith(
      caches.open(AUDIO_CACHE).then(async (cache) => {
        const cached = await cache.match(url, { ignoreVary: true });
        if (cached) return cached;
        try {
          const response = await fetch(req);
          if (response && (response.ok || response.type === 'opaque')) {
            cache.put(url, response.clone());
          }
          return response;
        } catch (e) {
          return new Response('', { status: 503, statusText: 'Audio Offline' });
        }
      })
    );
    return;
  }

  // 3. Bypass cross-origin non-audio requests (e.g., Supabase auth/sync APIs)
  if (parsedUrl.origin !== self.location.origin) {
    return;
  }

  // 4. Navigation requests (opening PWA at './', '/', '/index.html', '/quiz.html', etc.):
  //    Serve cached shell immediately for 0ms offline launch + revalidate in background when online.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.open(APP_SHELL_CACHE).then(async (cache) => {
        const fallbackKey = resolveNavFallback(parsedUrl.pathname);
        const matchOpts = { ignoreSearch: true, ignoreVary: true };
        const cached =
          (await cache.match(req, matchOpts)) ||
          (await cache.match(fallbackKey, matchOpts)) ||
          (await cache.match('./index.html', matchOpts)) ||
          (await cache.match('./', matchOpts));

        const networkFetch = fetch(req)
          .then((response) => {
            if (response && response.status === 200) {
              cache.put(req, response.clone());
              if (fallbackKey === './index.html') {
                cache.put('./index.html', response.clone());
                cache.put('./', response.clone());
              } else {
                cache.put(fallbackKey, response.clone());
              }
            }
            return response;
          })
          .catch(() => null);

        if (cached) {
          event.waitUntil(networkFetch);
          return cached;
        }

        const fresh = await networkFetch;
        if (fresh) return fresh;

        return new Response('Offline — please reconnect once to finish caching.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      })
    );
    return;
  }

  // 5. Per-surah & lookup JSON data: Cache-first for instant loading and zero network latency
  if (isSurahDataRequest(url)) {
    event.respondWith(
      caches.open(APP_SHELL_CACHE).then(async (cache) => {
        const cached = await cache.match(req, { ignoreSearch: true, ignoreVary: true });
        if (cached) return cached;
        try {
          const response = await fetch(req);
          if (response && response.status === 200) {
            cache.put(req, response.clone());
          }
          return response;
        } catch (e) {
          return new Response('{}', {
            status: 503,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          });
        }
      })
    );
    return;
  }

  // 6. Same-origin app shell assets (CSS, JS, fonts, icons, manifest):
  //    Cache-first with background revalidation (Stale-While-Revalidate) so offline
  //    never stalls on network timeouts, while online automatically refreshes cached assets.
  event.respondWith(
    caches.open(APP_SHELL_CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true, ignoreVary: true });
      const networkFetch = fetch(req)
        .then((response) => {
          if (response && response.status === 200 && isValidResponseForUrl(url, response)) {
            cache.put(req, response.clone());
          }
          return response;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(networkFetch);
        return cached;
      }

      const fresh = await networkFetch;
      if (fresh) return fresh;

      return new Response('', { status: 503, statusText: 'Offline' });
    })
  );
});

/* ---- Bulk "Download All" support ---- */
const MAX_PARALLEL_DOWNLOADS = 5;

async function downloadOne(cache, url) {
  try {
    const existing = await cache.match(url);
    if (existing) return;
    try {
      const response = await fetch(url, { mode: 'cors' });
      if (response && response.ok) {
        await cache.put(url, response.clone());
        return;
      }
    } catch (corsErr) {}
    const fallback = await fetch(url, { mode: 'no-cors' });
    if (fallback && (fallback.ok || fallback.type === 'opaque')) {
      await cache.put(url, fallback.clone());
    }
  } catch (e) {}
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
