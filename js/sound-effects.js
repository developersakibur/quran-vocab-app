/* ============================================================
   CACHEABLE QUIZ SOUND EFFECTS (Positive & Error Feedback)
   - Pre-loads local WAV assets into both browser Cache Storage
     ('quran-sound-effects-v1') and in-memory AudioBuffer / Blob URL
     caches so repeated quiz answers play instantaneously & offline.
   ============================================================ */
(function (global) {
  const SOUND_CACHE_NAME = 'quran-sound-effects-v1';
  const SOUND_PATHS = {
    correct: 'assets/sounds/correct.wav',
    wrong: 'assets/sounds/wrong.wav'
  };

  let audioCtx = null;
  let preloadPromise = null;

  const rawBufferCache = {};    // { correct?: ArrayBuffer, wrong?: ArrayBuffer }
  const decodedBufferCache = {}; // { correct?: AudioBuffer, wrong?: AudioBuffer }
  const blobUrlCache = {};       // { correct?: string, wrong?: string }

  const status = {
    preloaded: false,
    cachedInCacheStorage: { correct: false, wrong: false },
    cachedInMemory: { correct: false, wrong: false },
    lastPlayed: null,
    playCount: 0
  };

  function getAudioContext() {
    if (audioCtx) return audioCtx;
    const Ctor = global.AudioContext || global.webkitAudioContext;
    if (!Ctor) return null;
    try {
      audioCtx = new Ctor();
    } catch (e) {
      audioCtx = null;
    }
    return audioCtx;
  }

  async function fetchAndCacheSound(key) {
    const path = SOUND_PATHS[key];
    if (!path) return null;
    if (rawBufferCache[key]) return rawBufferCache[key];

    let response = null;
    let cache = null;

    if ('caches' in global) {
      try {
        cache = await global.caches.open(SOUND_CACHE_NAME);
        const cached = await cache.match(path);
        if (cached && cached.ok) {
          response = cached;
          status.cachedInCacheStorage[key] = true;
        }
      } catch (e) {}
    }

    if (!response) {
      try {
        const fetched = await fetch(path, { cache: 'force-cache' });
        if (fetched && fetched.ok) {
          if (cache) {
            try {
              await cache.put(path, fetched.clone());
              status.cachedInCacheStorage[key] = true;
            } catch (e) {}
          }
          response = fetched;
        }
      } catch (e) {}
    }

    if (!response) return null;

    try {
      const arrayBuf = await response.arrayBuffer();
      rawBufferCache[key] = arrayBuf;
      status.cachedInMemory[key] = true;
      if (!blobUrlCache[key] && typeof URL !== 'undefined' && typeof Blob !== 'undefined') {
        blobUrlCache[key] = URL.createObjectURL(new Blob([arrayBuf], { type: 'audio/wav' }));
      }
      return arrayBuf;
    } catch (e) {
      return null;
    }
  }

  function preload() {
    if (preloadPromise) return preloadPromise;
    preloadPromise = Promise.all([
      fetchAndCacheSound('correct'),
      fetchAndCacheSound('wrong')
    ]).then(() => {
      status.preloaded = true;
      return status;
    }).catch(() => status);
    return preloadPromise;
  }

  async function playWithWebAudio(key) {
    const ctx = getAudioContext();
    if (!ctx) return false;

    try {
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        await ctx.resume();
      }
      if (!decodedBufferCache[key]) {
        const raw = rawBufferCache[key] || (await fetchAndCacheSound(key));
        if (!raw) return false;
        // Slice a fresh copy because decodeAudioData detaches the passed ArrayBuffer
        decodedBufferCache[key] = await ctx.decodeAudioData(raw.slice(0));
      }
      const source = ctx.createBufferSource();
      source.buffer = decodedBufferCache[key];
      const gain = ctx.createGain();
      gain.gain.value = 0.72;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start(0);
      return true;
    } catch (e) {
      return false;
    }
  }

  function playWithHtmlAudio(key) {
    const src = blobUrlCache[key] || SOUND_PATHS[key];
    if (!src || typeof Audio === 'undefined') return;
    try {
      const el = new Audio(src);
      el.volume = 0.7;
      const p = el.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {});
      }
    } catch (e) {}
  }

  function play(type) {
    const key = type === 'correct' ? 'correct' : 'wrong';
    status.lastPlayed = key;
    status.playCount += 1;

    // Trigger preload lazily if not yet done
    if (!status.preloaded) {
      preload();
    }

    // Play immediately via cached WebAudio buffer if already ready; otherwise fallback smoothly
    playWithWebAudio(key).then((ok) => {
      if (!ok) {
        playWithHtmlAudio(key);
      }
    }).catch(() => {
      playWithHtmlAudio(key);
    });
  }

  function playCorrect() {
    play('correct');
  }

  function playWrong() {
    play('wrong');
  }

  function getStatus() {
    return {
      preloaded: status.preloaded,
      cachedInCacheStorage: { ...status.cachedInCacheStorage },
      cachedInMemory: { ...status.cachedInMemory },
      lastPlayed: status.lastPlayed,
      playCount: status.playCount
    };
  }

  global.QuizSoundEffects = {
    SOUND_CACHE_NAME,
    SOUND_PATHS,
    preload,
    playCorrect,
    playWrong,
    getStatus
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => { preload(); }, { once: true });
    } else {
      preload();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
