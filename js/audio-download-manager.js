/* ============================================================
   PROFESSIONAL OFFLINE AUDIO DOWNLOAD MANAGER
   - 0ms Instant Local Manifest Index (localStorage ~4 KB)
   - Silent Background CacheStorage Reconciliation
   - Unified FIFO Auto-Queue Engine (Single + Bulk Downloads)
   - Per-Surah & Per-Word Start, Immediate Stop (AbortController), Resume
   - Individual & Tab-Scoped Bulk Delete with Confirmation
   - Live Throttled Byte Counter & Zero-Flicker Surgical Row Updates
   ============================================================ */
(function (global) {
  'use strict';

  const AUDIO_CACHE = 'quran-audio-v1';
  const MANIFEST_STORAGE_KEY = 'quran-audio-index-v1';
  const LEGACY_STORAGE_BYTES_KEY = 'quran-app:last-storage-bytes-v1';
  const SURAH_AUDIO_BASE = 'https://audio-cdn.tarteel.ai/quran/surah/alafasy/murattal/mp3';
  const WORD_AUDIO_BASE = 'https://audio.qurancdn.com/wbw';

  const AUDIO_MANIFEST_VERSION = 1;
  const DEFAULT_WORD_AUDIO_BYTES = 16 * 1024;
  const DEFAULT_SURAH_AUDIO_FALLBACK_BYTES = 2400000;
  const MAX_PARALLEL_SURAH_DOWNLOADS = 3;
  const MAX_PARALLEL_WORD_SURAH_TASKS = 3;
  const WORD_AUDIO_CONCURRENCY = 12;
  const RING_CIRCUMFERENCE = 2 * Math.PI * 16; // r=16 => ~100.53

  // Optional registry of permanently missing (HTTP 404/410) CDN files if any arise in the future.
  // Runtime 404/410 responses are also automatically recorded in each Surah's `unavailableUrls`.
  const KNOWN_UNAVAILABLE_WBW_BY_SURAH = {};

  const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

  function toBn(val) {
    return String(val).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
  }

  function makeTaskId(type, surah) {
    return `${type}:${Math.floor(surah)}`;
  }

  function createEmptyAudioManifest() {
    return {
      version: AUDIO_MANIFEST_VERSION,
      surahAudio: {},
      wordAudio: {},
      reconciledAt: 0
    };
  }

  function parseAudioManifest(raw) {
    const base = createEmptyAudioManifest();
    if (!raw || typeof raw !== 'object') return base;

    if (raw.surahAudio && typeof raw.surahAudio === 'object') {
      Object.entries(raw.surahAudio).forEach(([key, val]) => {
        const sNum = parseInt(key, 10);
        if (!Number.isInteger(sNum) || sNum < 1 || sNum > 114) return;
        if (val && typeof val === 'object') {
          const bytes = Number(val.bytes);
          const savedAt = Number(val.savedAt) || 0;
          base.surahAudio[sNum] = {
            bytes: Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes) : 0,
            savedAt: Number.isFinite(savedAt) ? savedAt : 0
          };
        }
      });
    }

    if (raw.wordAudio && typeof raw.wordAudio === 'object') {
      Object.entries(raw.wordAudio).forEach(([key, val]) => {
        const sNum = parseInt(key, 10);
        if (!Number.isInteger(sNum) || sNum < 1 || sNum > 114) return;
        if (val && typeof val === 'object') {
          const count = Math.floor(Number(val.count) || 0);
          const bytes = Number(val.bytes);
          const savedAt = Number(val.savedAt) || 0;
          const unavailableUrls = Array.isArray(val.unavailableUrls)
            ? Array.from(new Set(val.unavailableUrls.filter((u) => typeof u === 'string' && u.length > 0)))
            : [];
          if (count > 0) {
            base.wordAudio[sNum] = {
              count,
              bytes: Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes) : count * DEFAULT_WORD_AUDIO_BYTES,
              savedAt: Number.isFinite(savedAt) ? savedAt : 0,
              ...(unavailableUrls.length > 0 ? { unavailableUrls } : {})
            };
          }
        }
      });
    }

    const reconciledAt = Number(raw.reconciledAt);
    base.reconciledAt = Number.isFinite(reconciledAt) && reconciledAt > 0 ? reconciledAt : 0;
    return base;
  }

  function estimateSurahFallbackBytes(meta) {
    if (meta && typeof meta.total_words === 'number' && meta.total_words > 0) {
      return Math.max(350000, Math.round(meta.total_words * 15500));
    }
    return DEFAULT_SURAH_AUDIO_FALLBACK_BYTES;
  }

  function formatAudioBytesBn(bytes, compact) {
    const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
    if (safe === 0) {
      return compact ? '০ এমবি' : '০.০ মেগাবাইট';
    }
    const kb = safe / 1024;
    if (kb < 1024) {
      const roundedKb = Math.max(1, Math.round(kb));
      return compact ? `${toBn(roundedKb)} কেবি` : `${toBn(roundedKb)} কিলোবাইট`;
    }
    const mb = safe / (1024 * 1024);
    if (mb < 1024) {
      const formatted = mb >= 100 ? mb.toFixed(1) : mb >= 10 ? mb.toFixed(1) : mb.toFixed(2);
      return compact ? `${toBn(formatted)} এমবি` : `${toBn(formatted)} মেগাবাইট`;
    }
    const gb = mb / 1024;
    const formatted = gb.toFixed(2);
    return compact ? `${toBn(formatted)} জিবি` : `${toBn(formatted)} গিগাবাইট`;
  }

  function parseCacheAudioUrl(url) {
    if (!url) return null;
    if (url.includes('audio-cdn.tarteel.ai')) {
      const m = url.match(/\/(\d{3})\.mp3/);
      if (m) {
        const s = parseInt(m[1], 10);
        if (s >= 1 && s <= 114) return { type: 'ayah', surah: s };
      }
    } else if (url.includes('audio.qurancdn.com/wbw') || url.includes('/wbw/')) {
      const m = url.match(/\/(\d{3})_(\d{3})_(\d{3})\.mp3/);
      if (m) {
        const s = parseInt(m[1], 10);
        if (s >= 1 && s <= 114) return { type: 'word', surah: s };
      }
    }
    return null;
  }

  function computeAudioOverviewStats(manifest, metaList, inFlightBytes) {
    const list = Array.isArray(metaList) ? metaList : [];
    const totalSurahs = list.length > 0 ? list.length : 114;
    let totalWords = 0;
    let completedSurahs = 0;
    let completedWordSurahs = 0;
    let partialWordSurahs = 0;
    let totalSavedWords = 0;
    let totalSurahBytes = 0;
    let totalWordBytes = 0;

    if (list.length > 0) {
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        const sNum = s.surah;
        const wTotal = Math.max(0, s.total_words || 0);
        totalWords += wTotal;

        const surahEntry = manifest.surahAudio[sNum];
        if (surahEntry) {
          completedSurahs++;
          totalSurahBytes += Math.max(0, surahEntry.bytes || 0);
        }

        const wordEntry = manifest.wordAudio[sNum];
        if (wordEntry && wordEntry.count > 0) {
          const clamped = wTotal > 0 ? Math.min(wordEntry.count, wTotal) : wordEntry.count;
          totalSavedWords += clamped;
          totalWordBytes += Math.max(0, wordEntry.bytes || 0);
          if (wTotal > 0 && clamped >= wTotal) {
            completedWordSurahs++;
          } else {
            partialWordSurahs++;
          }
        }
      }
    } else {
      totalWords = 77429;
      Object.values(manifest.surahAudio).forEach((entry) => {
        completedSurahs++;
        totalSurahBytes += Math.max(0, entry.bytes || 0);
      });
      Object.values(manifest.wordAudio).forEach((entry) => {
        if (entry.count > 0) {
          totalSavedWords += entry.count;
          totalWordBytes += Math.max(0, entry.bytes || 0);
        }
      });
    }

    const safeInFlight = Number.isFinite(inFlightBytes) && inFlightBytes > 0 ? Math.round(inFlightBytes) : 0;
    return {
      completedSurahs,
      totalSurahs,
      completedWordSurahs,
      partialWordSurahs,
      totalSavedWords,
      totalWords,
      totalSurahBytes,
      totalWordBytes,
      totalAudioBytes: totalSurahBytes + totalWordBytes + safeInFlight,
      hasAnySurahAudio: completedSurahs > 0,
      hasAnyWordAudio: totalSavedWords > 0
    };
  }

  function getParallelTaskLimit(type) {
    return type === 'ayah' ? MAX_PARALLEL_SURAH_DOWNLOADS : MAX_PARALLEL_WORD_SURAH_TASKS;
  }

  function toActiveArray(active) {
    if (!active) return [];
    if (active instanceof Map) return Array.from(active.values());
    return Array.isArray(active) ? active : [active];
  }

  function canStartTaskType(active, type) {
    const list = toActiveArray(active);
    let count = 0;
    for (let i = 0; i < list.length; i++) {
      if (list[i] && list[i].task && list[i].task.type === type) count++;
    }
    return count < getParallelTaskLimit(type);
  }

  function pickNextRunnableTask(queueList, active) {
    const list = Array.isArray(queueList) ? queueList : [];
    for (let i = 0; i < list.length; i++) {
      const candidate = list[i];
      if (canStartTaskType(active, candidate.type)) {
        return {
          task: candidate,
          remainingQueue: list.slice(0, i).concat(list.slice(i + 1))
        };
      }
    }
    return { task: null, remainingQueue: list.slice() };
  }

  function sumInFlightBytes(active) {
    const list = toActiveArray(active);
    let sum = 0;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a && a.task && a.task.type === 'ayah') {
        const b = Number(a.receivedBytes || 0);
        if (Number.isFinite(b) && b > 0) sum += b;
      }
    }
    return sum;
  }

  function computeSurahRowDownloadState(surah, type, manifest, active, queue) {
    const sNum = surah.surah;
    const taskId = makeTaskId(type, sNum);
    const totalUnits = type === 'ayah' ? 1 : Math.max(1, surah.total_words || 1);

    const surahEntry = manifest.surahAudio[sNum];
    const wordEntry = manifest.wordAudio[sNum];

    const savedUnits =
      type === 'ayah'
        ? surahEntry
          ? 1
          : 0
        : Math.min(totalUnits, wordEntry ? Math.max(0, wordEntry.count) : 0);

    const savedBytes =
      type === 'ayah'
        ? surahEntry
          ? surahEntry.bytes
          : 0
        : wordEntry
          ? wordEntry.bytes
          : 0;

    const activeMatch = toActiveArray(active).find((a) => a && a.task && a.task.id === taskId);
    if (activeMatch) {
      const doneUnits = type === 'ayah' ? 0 : Math.max(savedUnits, activeMatch.completedUnits || 0);
      const percent =
        type === 'ayah'
          ? Math.max(0, Math.min(99, Math.round(activeMatch.percent || 0)))
          : Math.max(0, Math.min(99, Math.round((doneUnits / totalUnits) * 100)));
      const bytes = type === 'ayah' ? (activeMatch.receivedBytes || 0) : savedBytes;
      return {
        surah: sNum,
        type,
        status: 'downloading',
        doneUnits,
        totalUnits,
        percent,
        bytes,
        totalBytes: type === 'ayah' ? (activeMatch.totalBytes || 0) : 0,
        queuePosition: 0,
        canDelete: false
      };
    }

    const queueIdx = queue.findIndex((t) => t.id === taskId);
    if (queueIdx !== -1) {
      const percent = Math.round((savedUnits / totalUnits) * 100);
      return {
        surah: sNum,
        type,
        status: 'queued',
        doneUnits: savedUnits,
        totalUnits,
        percent,
        bytes: savedBytes,
        totalBytes: 0,
        queuePosition: queueIdx + 1,
        canDelete: false
      };
    }

    if (savedUnits >= totalUnits) {
      return {
        surah: sNum,
        type,
        status: 'completed',
        doneUnits: totalUnits,
        totalUnits,
        percent: 100,
        bytes: savedBytes,
        totalBytes: 0,
        queuePosition: 0,
        canDelete: true
      };
    }

    if (savedUnits > 0) {
      return {
        surah: sNum,
        type,
        status: 'partial',
        doneUnits: savedUnits,
        totalUnits,
        percent: Math.max(1, Math.min(99, Math.round((savedUnits / totalUnits) * 100))),
        bytes: savedBytes,
        totalBytes: 0,
        queuePosition: 0,
        canDelete: true
      };
    }

    return {
      surah: sNum,
      type,
      status: 'idle',
      doneUnits: 0,
      totalUnits,
      percent: 0,
      bytes: 0,
      totalBytes: 0,
      queuePosition: 0,
      canDelete: false
    };
  }

  function reconcileManifestWithCacheScan(manifest, scan, metaList, nowMs) {
    const ts = nowMs || Date.now();
    const metaBySurah = new Map();
    (metaList || []).forEach((s) => metaBySurah.set(s.surah, s));

    let changed = false;
    const nextSurahAudio = {};
    const nextWordAudio = {};

    Object.entries((scan && scan.surahCounts) || {}).forEach(([k, v]) => {
      const sNum = parseInt(k, 10);
      if (!Number.isInteger(sNum) || sNum < 1 || sNum > 114 || !v) return;
      const prev = manifest.surahAudio[sNum];
      const measuredBytes = scan.surahBytes && scan.surahBytes[sNum];
      const bytes =
        measuredBytes && measuredBytes > 0
          ? Math.round(measuredBytes)
          : prev && prev.bytes > 0
            ? prev.bytes
            : estimateSurahFallbackBytes(metaBySurah.get(sNum));
      nextSurahAudio[sNum] = {
        bytes,
        savedAt: prev ? prev.savedAt : ts
      };
      if (!prev || prev.bytes !== bytes) changed = true;
    });

    Object.keys(manifest.surahAudio).forEach((prevKey) => {
      const sNum = parseInt(prevKey, 10);
      if (!(sNum in nextSurahAudio)) changed = true;
    });

    Object.entries((scan && scan.wordCounts) || {}).forEach(([k, rawCount]) => {
      const sNum = parseInt(k, 10);
      if (!Number.isInteger(sNum) || sNum < 1 || sNum > 114) return;
      const cachedCount = Math.max(0, Math.floor(rawCount));
      if (cachedCount <= 0) return;

      const meta = metaBySurah.get(sNum);
      const maxW = meta && meta.total_words > 0 ? meta.total_words : cachedCount;
      const prev = manifest.wordAudio[sNum];

      // Preserve verified permanent-404 URLs (plus known CDN 404s once all existing files are cached)
      const unavailableSet = new Set(prev && Array.isArray(prev.unavailableUrls) ? prev.unavailableUrls : []);
      const knownForSurah = KNOWN_UNAVAILABLE_WBW_BY_SURAH[sNum];
      if (knownForSurah && knownForSurah.length > 0 && cachedCount + knownForSurah.length >= maxW) {
        for (let j = 0; j < knownForSurah.length; j++) unavailableSet.add(knownForSurah[j]);
      }

      const unavailableUrls = Array.from(unavailableSet);
      const count = Math.min(cachedCount + unavailableUrls.length, maxW);
      if (count <= 0) return;

      const measuredBytes = scan.wordBytes && scan.wordBytes[sNum];
      let bytes;
      if (measuredBytes && measuredBytes > 0) {
        bytes = Math.round(measuredBytes);
      } else if (prev && prev.count === count && prev.bytes > 0) {
        bytes = prev.bytes;
      } else if (prev && prev.count > 0 && prev.bytes > 0) {
        bytes = Math.round((prev.bytes / prev.count) * cachedCount);
      } else {
        bytes = cachedCount * DEFAULT_WORD_AUDIO_BYTES;
      }

      nextWordAudio[sNum] = {
        count,
        bytes,
        savedAt: prev ? prev.savedAt : ts,
        ...(unavailableUrls.length > 0 ? { unavailableUrls } : {})
      };
      const prevUnavailLen = prev && Array.isArray(prev.unavailableUrls) ? prev.unavailableUrls.length : 0;
      if (!prev || prev.count !== count || Math.abs(prev.bytes - bytes) > 1024 || prevUnavailLen !== unavailableUrls.length) {
        changed = true;
      }
    });

    Object.keys(manifest.wordAudio).forEach((prevKey) => {
      const sNum = parseInt(prevKey, 10);
      if (!(sNum in nextWordAudio)) changed = true;
    });

    return {
      manifest: {
        version: AUDIO_MANIFEST_VERSION,
        surahAudio: nextSurahAudio,
        wordAudio: nextWordAudio,
        reconciledAt: ts
      },
      changed
    };
  }

  // ============================================================
  // RUNTIME CONTROLLER STATE
  // ============================================================
  let manifest = loadManifestFromStorage();
  let surahsMeta = [];
  let metaBySurah = new Map();
  let activeTab = 'ayah';
  let queue = [];
  const activeTasks = new Map(); // taskId -> { task, controller, percent, receivedBytes, totalBytes, completedUnits, totalUnits, stopped }
  let persistentStorageRequested = false;
  let isReconciling = false;
  let manifestSaveTimer = null;
  let lastLiveRenderTs = 0;
  let domInitialized = false;

  function loadManifestFromStorage() {
    try {
      const raw = localStorage.getItem(MANIFEST_STORAGE_KEY);
      if (!raw) return createEmptyAudioManifest();
      return parseAudioManifest(JSON.parse(raw));
    } catch (e) {
      return createEmptyAudioManifest();
    }
  }

  function saveManifestToStorage(immediate) {
    const persist = () => {
      manifestSaveTimer = null;
      try {
        localStorage.setItem(MANIFEST_STORAGE_KEY, JSON.stringify(manifest));
        const stats = computeAudioOverviewStats(manifest, surahsMeta, 0);
        localStorage.setItem(LEGACY_STORAGE_BYTES_KEY, String(stats.totalAudioBytes));
      } catch (e) {}
    };
    if (immediate) {
      if (manifestSaveTimer) {
        clearTimeout(manifestSaveTimer);
        manifestSaveTimer = null;
      }
      persist();
      return;
    }
    if (!manifestSaveTimer) {
      manifestSaveTimer = setTimeout(persist, 350);
    }
  }

  function normalizeSurahMeta(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map((item) => ({
        ...item,
        surah: parseInt(item.surah || item.number, 10),
        total_words: Math.max(1, parseInt(item.total_words || 0, 10) || 1),
        name_bn: item.name_bn || item.name_translation_bn || '',
        name_bn_script: item.name_bn_script || item.name_transliteration || item.name_bn || '',
        name_ar: item.name_ar || item.name_arabic || ''
      }))
      .filter((s) => Number.isInteger(s.surah) && s.surah >= 1 && s.surah <= 114)
      .sort((a, b) => a.surah - b.surah);
  }

  function loadInstantSurahsMeta() {
    if (surahsMeta.length > 0) return surahsMeta;
    if (Array.isArray(global.SURAHS_META) && global.SURAHS_META.length > 0) {
      surahsMeta = normalizeSurahMeta(global.SURAHS_META);
      metaBySurah = new Map(surahsMeta.map((s) => [s.surah, s]));
    }
    return surahsMeta;
  }

  function getSurahName(sNum) {
    const s = metaBySurah.get(sNum);
    if (!s) return `সূরা ${toBn(sNum)}`;
    return s.name_bn_script || s.name_bn || s.name_transliteration || `সূরা ${toBn(sNum)}`;
  }

  function getSurahAudioUrl(sNum) {
    return `${SURAH_AUDIO_BASE}/${String(sNum).padStart(3, '0')}.mp3`;
  }

  async function getWordUrlsForSurah(sNum) {
    if (!global.QuranDB || typeof global.QuranDB.loadSurah !== 'function') return [];
    const content = await global.QuranDB.loadSurah(sNum);
    const seen = new Set();
    const urls = [];
    (content && content.ayahs ? content.ayahs : []).forEach((ayah) => {
      (ayah.words || []).forEach((w) => {
        if (!w || !w.key) return;
        const parts = String(w.key).split(':');
        if (parts.length !== 3) return;
        const [ws, wa, wp] = parts.map((n) => String(n).padStart(3, '0'));
        const url = `${WORD_AUDIO_BASE}/${ws}_${wa}_${wp}.mp3`;
        if (!seen.has(url)) {
          seen.add(url);
          urls.push(url);
        }
      });
    });
    return urls;
  }

  function getWordConcurrency() {
    return WORD_AUDIO_CONCURRENCY;
  }

  // Fair round-robin global worker pool capped strictly at 12 concurrent word downloads
  // across all active word-audio Surahs (1 surah => 12, 2 surahs => 6+6, 3 surahs => 4+4+4).
  function createSharedWordDownloadPool(maxConcurrency) {
    const limit = Math.max(1, Math.floor(maxConcurrency || WORD_AUDIO_CONCURRENCY));
    const jobs = [];
    let activeWorkers = 0;
    let rrIndex = 0;
    let pumpScheduled = false;

    function schedulePump() {
      if (pumpScheduled) return;
      pumpScheduled = true;
      queueMicrotask(() => {
        pumpScheduled = false;
        pump();
      });
    }

    function isJobStopped(job) {
      return job.cancelled || job.isStopped();
    }

    function trySettleJob(job) {
      const exhausted = job.cursor >= job.urls.length;
      const stopped = isJobStopped(job);
      if ((exhausted || stopped) && job.inFlight === 0) {
        const idx = jobs.indexOf(job);
        if (idx !== -1) {
          jobs.splice(idx, 1);
          if (rrIndex >= jobs.length) rrIndex = 0;
        }
        job.resolve({ processed: job.processed, stopped: stopped && !exhausted });
      }
    }

    function pickNextWork() {
      for (let i = jobs.length - 1; i >= 0; i--) {
        if (isJobStopped(jobs[i]) && jobs[i].inFlight === 0) {
          trySettleJob(jobs[i]);
        }
      }
      if (jobs.length === 0) return null;

      const count = jobs.length;
      for (let attempt = 0; attempt < count; attempt++) {
        const idx = (rrIndex + attempt) % jobs.length;
        const candidate = jobs[idx];
        if (!isJobStopped(candidate) && candidate.cursor < candidate.urls.length) {
          const url = candidate.urls[candidate.cursor++];
          rrIndex = (idx + 1) % jobs.length;
          return { job: candidate, url };
        }
      }
      return null;
    }

    function pump() {
      while (activeWorkers < limit) {
        const next = pickNextWork();
        if (!next) break;
        activeWorkers++;
        next.job.inFlight++;
        runWorkerLoop(next.job, next.url);
      }
    }

    async function runWorkerLoop(initialJob, initialUrl) {
      let currentJob = initialJob;
      let currentUrl = initialUrl;

      try {
        while (currentJob && currentUrl !== null) {
          try {
            const result = await currentJob.processUrl(currentUrl);
            if (!isJobStopped(currentJob)) {
              currentJob.processed++;
              if (currentJob.onResult) {
                currentJob.onResult(currentUrl, result);
              }
            }
          } finally {
            currentJob.inFlight--;
            trySettleJob(currentJob);
          }

          const next = pickNextWork();
          if (next) {
            currentJob = next.job;
            currentUrl = next.url;
            currentJob.inFlight++;
          } else {
            currentJob = null;
            currentUrl = null;
          }
        }
      } finally {
        activeWorkers--;
        pump();
      }
    }

    return {
      runJob(job) {
        return new Promise((resolve) => {
          const internal = {
            id: job.id,
            urls: job.urls,
            cursor: 0,
            inFlight: 0,
            processed: 0,
            cancelled: false,
            isStopped: job.isStopped || (() => false),
            processUrl: job.processUrl,
            onResult: job.onResult,
            resolve
          };
          if (!internal.urls || internal.urls.length === 0 || isJobStopped(internal)) {
            resolve({ processed: 0, stopped: isJobStopped(internal) });
            return;
          }
          jobs.push(internal);
          schedulePump();
        });
      },
      cancelJob(id) {
        const target = jobs.find((j) => j.id === id);
        if (!target) return;
        target.cancelled = true;
        trySettleJob(target);
        pump();
      },
      getActiveWorkerCount() {
        return activeWorkers;
      }
    };
  }

  const sharedWordPool = createSharedWordDownloadPool(WORD_AUDIO_CONCURRENCY);
  const inFlightWordFetches = new Map(); // url -> Promise<result> (prevents duplicate concurrent fetches)

  function prefetchNextQueuedWordSurahs() {
    if (!global.QuranDB || typeof global.QuranDB.loadSurah !== 'function') return;
    let prefetched = 0;
    for (let i = 0; i < queue.length && prefetched < 2; i++) {
      const t = queue[i];
      if (t && t.type === 'word') {
        global.QuranDB.loadSurah(t.surah).catch(() => {});
        prefetched++;
      }
    }
  }

  function showToastSafe(message, type) {
    if (global.UIOverlay && typeof global.UIOverlay.toast === 'function') {
      global.UIOverlay.toast({ message, type: type || 'info' });
    }
  }

  // ============================================================
  // NETWORK FETCH & CACHE WRITE (WITH ABORT SIGNAL)
  // ============================================================
  async function downloadSurahRecitationFile(cache, sNum, signal, onByteProgress) {
    const url = getSurahAudioUrl(sNum);
    const existing = await cache.match(url).catch(() => null);
    if (existing) {
      let existingBytes = 0;
      if (existing.type !== 'opaque') {
        existingBytes = parseInt(existing.headers.get('content-length') || '0', 10) || 0;
        if (!existingBytes) {
          try {
            const b = await existing.clone().blob();
            existingBytes = b ? b.size : 0;
          } catch (e) {}
        }
      }
      const bytes = existingBytes > 0 ? existingBytes : estimateSurahFallbackBytes(metaBySurah.get(sNum));
      return { ok: true, bytes, alreadyCached: true };
    }

    // Also prefetch segments JSON in parallel (non-blocking)
    if (global.QuranDB && typeof global.QuranDB.getSurahSegments === 'function') {
      global.QuranDB.getSurahSegments(sNum).catch(() => {});
    }

    for (let attempt = 1; attempt <= 2; attempt++) {
      if (signal.aborted) return { ok: false, aborted: true, bytes: 0 };
      const attemptController = new AbortController();
      const onParentAbort = () => attemptController.abort();
      signal.addEventListener('abort', onParentAbort, { once: true });
      let stallTimer = setTimeout(() => attemptController.abort(), 90000);

      try {
        try {
          const res = await fetch(url, { mode: 'cors', signal: attemptController.signal });
          if (res && res.ok && res.body && typeof res.body.getReader === 'function') {
            const totalBytes = parseInt(res.headers.get('content-length') || '0', 10) || 0;
            const reader = res.body.getReader();
            const chunks = [];
            let receivedBytes = 0;
            let lastEmit = 0;

            while (true) {
              if (signal.aborted) {
                try { await reader.cancel(); } catch (e) {}
                clearTimeout(stallTimer);
                signal.removeEventListener('abort', onParentAbort);
                return { ok: false, aborted: true, bytes: 0 };
              }
              const { done, value } = await reader.read();
              if (done) break;
              if (value && value.byteLength) {
                chunks.push(value);
                receivedBytes += value.byteLength;
                clearTimeout(stallTimer);
                stallTimer = setTimeout(() => attemptController.abort(), 30000);

                const now = Date.now();
                const pct = totalBytes > 0 ? Math.min(99, Math.round((receivedBytes / totalBytes) * 100)) : 0;
                if (onByteProgress && now - lastEmit >= 110) {
                  lastEmit = now;
                  onByteProgress({ receivedBytes, totalBytes, percent: pct });
                }
              }
            }

            clearTimeout(stallTimer);
            signal.removeEventListener('abort', onParentAbort);
            if (signal.aborted) return { ok: false, aborted: true, bytes: 0 };

            const blob = new Blob(chunks, { type: res.headers.get('content-type') || 'audio/mpeg' });
            const cachedRes = new Response(blob, {
              status: 200,
              statusText: 'OK',
              headers: {
                'Content-Type': res.headers.get('content-type') || 'audio/mpeg',
                'Content-Length': String(blob.size)
              }
            });
            await cache.put(url, cachedRes);
            if (global.QuranDB && global.QuranDB.invalidateAudioCacheSizeMemo) {
              global.QuranDB.invalidateAudioCacheSizeMemo(url);
            }
            if (onByteProgress) {
              onByteProgress({ receivedBytes: blob.size, totalBytes: blob.size, percent: 100 });
            }
            return { ok: true, bytes: blob.size };
          } else if (res && res.ok) {
            clearTimeout(stallTimer);
            const blob = await res.blob();
            if (signal.aborted) {
              signal.removeEventListener('abort', onParentAbort);
              return { ok: false, aborted: true, bytes: 0 };
            }
            const cachedRes = new Response(blob, {
              status: 200,
              statusText: 'OK',
              headers: {
                'Content-Type': res.headers.get('content-type') || 'audio/mpeg',
                'Content-Length': String(blob.size)
              }
            });
            await cache.put(url, cachedRes);
            if (global.QuranDB && global.QuranDB.invalidateAudioCacheSizeMemo) {
              global.QuranDB.invalidateAudioCacheSizeMemo(url);
            }
            signal.removeEventListener('abort', onParentAbort);
            return { ok: true, bytes: blob.size };
          }
        } catch (corsErr) {
          if (signal.aborted) {
            clearTimeout(stallTimer);
            signal.removeEventListener('abort', onParentAbort);
            return { ok: false, aborted: true, bytes: 0 };
          }
          // Fallback to no-cors opaque response if CORS blocked
          const fallbackRes = await fetch(url, { mode: 'no-cors', signal: attemptController.signal });
          clearTimeout(stallTimer);
          signal.removeEventListener('abort', onParentAbort);
          if (signal.aborted) return { ok: false, aborted: true, bytes: 0 };
          if (fallbackRes && (fallbackRes.ok || fallbackRes.type === 'opaque')) {
            await cache.put(url, fallbackRes.clone());
            if (global.QuranDB && global.QuranDB.invalidateAudioCacheSizeMemo) {
              global.QuranDB.invalidateAudioCacheSizeMemo(url);
            }
            return { ok: true, bytes: estimateSurahFallbackBytes(metaBySurah.get(sNum)) };
          }
        }
      } catch (err) {
        clearTimeout(stallTimer);
        signal.removeEventListener('abort', onParentAbort);
        if (signal.aborted) return { ok: false, aborted: true, bytes: 0 };
        if (attempt === 2) return { ok: false, aborted: false, bytes: 0 };
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    return { ok: false, aborted: false, bytes: 0 };
  }

  async function downloadSingleWordAudio(cache, url, signal) {
    if (signal.aborted) return { ok: false, aborted: true, bytes: 0 };

    // Fast O(1) indexed point-lookup in CacheStorage: prevents duplicate downloads & eliminates O(N) cache.keys() startup lag
    try {
      const existing = await cache.match(url);
      if (existing) {
        let existingBytes = 0;
        if (existing.type !== 'opaque') {
          existingBytes = parseInt(existing.headers.get('content-length') || '0', 10) || 0;
        }
        return {
          ok: true,
          alreadyCached: true,
          bytes: existingBytes > 0 ? existingBytes : DEFAULT_WORD_AUDIO_BYTES
        };
      }
    } catch (e) {}

    if (signal.aborted) return { ok: false, aborted: true, bytes: 0 };

    // Deduplicate identical URL if another worker/task is already fetching it
    if (inFlightWordFetches.has(url)) {
      try {
        return await inFlightWordFetches.get(url);
      } catch (e) {
        return { ok: false, aborted: signal.aborted, bytes: 0 };
      }
    }

    const runFetch = async () => {
      for (let attempt = 1; attempt <= 2; attempt++) {
        if (signal.aborted) return { ok: false, aborted: true, bytes: 0 };
        const attemptController = new AbortController();
        const onParentAbort = () => attemptController.abort();
        signal.addEventListener('abort', onParentAbort, { once: true });
        const timer = setTimeout(() => attemptController.abort(), 14000);

        try {
          try {
            const res = await fetch(url, { mode: 'cors', signal: attemptController.signal });
            clearTimeout(timer);
            if (res && (res.status === 404 || res.status === 410)) {
              signal.removeEventListener('abort', onParentAbort);
              return { ok: false, notFound: true, aborted: false, bytes: 0 };
            }
            if (res && res.ok) {
              const blob = await res.blob();
              if (signal.aborted) {
                signal.removeEventListener('abort', onParentAbort);
                return { ok: false, aborted: true, bytes: 0 };
              }
              const cachedRes = new Response(blob, {
                status: 200,
                statusText: 'OK',
                headers: {
                  'Content-Type': res.headers.get('content-type') || 'audio/mpeg',
                  'Content-Length': String(blob.size)
                }
              });
              await cache.put(url, cachedRes);
              if (global.QuranDB && global.QuranDB.invalidateAudioCacheSizeMemo) {
                global.QuranDB.invalidateAudioCacheSizeMemo(url);
              }
              signal.removeEventListener('abort', onParentAbort);
              return { ok: true, alreadyCached: false, bytes: blob.size || DEFAULT_WORD_AUDIO_BYTES };
            }
            // Transient HTTP error (e.g. 429/5xx): retry on next attempt instead of caching error response
            signal.removeEventListener('abort', onParentAbort);
            if (attempt === 2) return { ok: false, aborted: false, bytes: 0 };
            await new Promise((r) => setTimeout(r, 250));
            continue;
          } catch (corsErr) {
            if (signal.aborted) {
              clearTimeout(timer);
              signal.removeEventListener('abort', onParentAbort);
              return { ok: false, aborted: true, bytes: 0 };
            }
            const fallbackRes = await fetch(url, { mode: 'no-cors', signal: attemptController.signal });
            clearTimeout(timer);
            signal.removeEventListener('abort', onParentAbort);
            if (signal.aborted) return { ok: false, aborted: true, bytes: 0 };
            if (fallbackRes && (fallbackRes.ok || fallbackRes.type === 'opaque')) {
              await cache.put(url, fallbackRes.clone());
              if (global.QuranDB && global.QuranDB.invalidateAudioCacheSizeMemo) {
                global.QuranDB.invalidateAudioCacheSizeMemo(url);
              }
              return { ok: true, alreadyCached: false, bytes: DEFAULT_WORD_AUDIO_BYTES };
            }
          }
        } catch (err) {
          clearTimeout(timer);
          signal.removeEventListener('abort', onParentAbort);
          if (signal.aborted) return { ok: false, aborted: true, bytes: 0 };
          if (attempt === 2) return { ok: false, aborted: false, bytes: 0 };
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      return { ok: false, aborted: false, bytes: 0 };
    };

    const promise = runFetch();
    inFlightWordFetches.set(url, promise);
    try {
      return await promise;
    } finally {
      if (inFlightWordFetches.get(url) === promise) {
        inFlightWordFetches.delete(url);
      }
    }
  }

  // ============================================================
  // PARALLEL QUEUE EXECUTION ENGINE (3 SURAHS + 10 WORDS)
  // ============================================================
  async function requestPersistentStorageQuietly() {
    if (persistentStorageRequested) return;
    persistentStorageRequested = true;
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      try {
        await navigator.storage.persist();
        if (typeof global.updateStoragePersistenceUI === 'function') {
          global.updateStoragePersistenceUI();
        }
      } catch (e) {}
    }
  }

  function pumpQueue() {
    let launchedAny = false;

    while (queue.length > 0) {
      const next = pickNextRunnableTask(queue, activeTasks);
      if (!next.task) break;

      const task = next.task;
      queue = next.remainingQueue;

      if (activeTasks.has(task.id)) continue;

      const surahMeta = metaBySurah.get(task.surah) || { surah: task.surah, total_words: 1 };
      const controller = new AbortController();
      const state = {
        task,
        controller,
        percent: 0,
        receivedBytes: 0,
        totalBytes: 0,
        completedUnits: 0,
        totalUnits: task.type === 'ayah' ? 1 : surahMeta.total_words,
        stopped: false
      };

      activeTasks.set(task.id, state);
      launchedAny = true;

      patchSurahRow(task.type, task.surah);
      executeTask(state);
    }

    if (launchedAny) {
      prefetchNextQueuedWordSurahs();
      patchAllQueuedRows();
      renderOverviewAndActiveBar(true);
      patchTabActionButtons();
    }
  }

  async function executeTask(state) {
    const { task, controller } = state;
    const surahMeta = metaBySurah.get(task.surah) || { surah: task.surah, total_words: 1 };
    let completedOk = false;

    requestPersistentStorageQuietly();

    try {
      const cache = 'caches' in global ? await caches.open(AUDIO_CACHE) : null;
      if (!cache) {
        showToastSafe('এই ব্রাউজারে অফলাইন ক্যাশ সমর্থিত নয়।', 'error');
        queue = [];
        state.stopped = true;
        return;
      }

      if (task.type === 'ayah') {
        const res = await downloadSurahRecitationFile(cache, task.surah, controller.signal, (prog) => {
          if (state.stopped || controller.signal.aborted || activeTasks.get(task.id) !== state) return;
          state.receivedBytes = prog.receivedBytes || 0;
          state.totalBytes = prog.totalBytes || 0;
          state.percent = prog.percent || 0;
          emitLiveProgress(task.type, task.surah, false);
        });

        const wasStopped = state.stopped || controller.signal.aborted;
        if (res.ok && !wasStopped) {
          manifest.surahAudio[task.surah] = {
            bytes: res.bytes || estimateSurahFallbackBytes(surahMeta),
            savedAt: Date.now()
          };
          saveManifestToStorage(true);
          completedOk = true;
        } else if (!wasStopped && !res.ok) {
          showToastSafe(`সূরা ${getSurahName(task.surah)} ডাউনলোডে সমস্যা হয়েছে, ইন্টারনেট যাচাই করুন।`, 'error');
        }
      } else {
        // Word-by-word audio download for this Surah
        // Instant start (zero upfront O(N) cache.keys() scan!) + shared global 12-worker pool across up to 3 active Surahs
        let urls = [];
        try {
          urls = await getWordUrlsForSurah(task.surah);
        } catch (e) {
          urls = [];
        }

        if (controller.signal.aborted || state.stopped) {
          return;
        }

        const totalWords = Math.max(urls.length, surahMeta.total_words || 1);
        state.totalUnits = totalWords;

        const prevEntryAtStart = manifest.wordAudio[task.surah];
        const prevSavedCount = prevEntryAtStart ? Math.min(Math.max(0, prevEntryAtStart.count || 0), totalWords) : 0;
        const prevSavedBytes = prevEntryAtStart && prevEntryAtStart.bytes > 0 ? prevEntryAtStart.bytes : 0;

        const unavailableSet = new Set(
          prevEntryAtStart && Array.isArray(prevEntryAtStart.unavailableUrls)
            ? prevEntryAtStart.unavailableUrls
            : []
        );
        const knownForSurah = KNOWN_UNAVAILABLE_WBW_BY_SURAH[task.surah];
        if (knownForSurah) {
          for (let j = 0; j < knownForSurah.length; j++) {
            unavailableSet.add(knownForSurah[j]);
          }
        }

        const pendingUrls = urls.filter((u) => !unavailableSet.has(u));
        let doneCount = urls.length - pendingUrls.length; // Known permanent-404s already accounted for
        let accumulatedBytes = 0;
        let failedCount = 0;

        // Keep partial progress monotonic (never visually dips to 0% while O(1) cache.match skips saved words)
        state.completedUnits = Math.max(doneCount, prevSavedCount);
        state.percent = totalWords > 0 ? Math.min(99, Math.round((state.completedUnits / totalWords) * 100)) : 0;
        emitLiveProgress('word', task.surah, true);

        if (pendingUrls.length > 0 && !controller.signal.aborted && !state.stopped) {
          await sharedWordPool.runJob({
            id: task.id,
            urls: pendingUrls,
            isStopped: () => controller.signal.aborted || state.stopped,
            processUrl: (url) => downloadSingleWordAudio(cache, url, controller.signal),
            onResult: (url, result) => {
              if (controller.signal.aborted || state.stopped) return;
              if (result && (result.ok || result.notFound)) {
                if (result.notFound) unavailableSet.add(url);
                doneCount++;
                if (result.ok) {
                  accumulatedBytes += result.bytes || DEFAULT_WORD_AUDIO_BYTES;
                }
                const displayDone = Math.min(Math.max(doneCount, prevSavedCount), totalWords);
                const displayBytes = Math.max(accumulatedBytes, prevSavedBytes);
                const unavailList = Array.from(unavailableSet);
                manifest.wordAudio[task.surah] = {
                  count: displayDone,
                  bytes: displayBytes,
                  savedAt: Date.now(),
                  ...(unavailList.length > 0 ? { unavailableUrls: unavailList } : {})
                };
                saveManifestToStorage(false);
                if (activeTasks.get(task.id) === state) {
                  state.completedUnits = displayDone;
                  state.percent = Math.min(99, Math.round((displayDone / totalWords) * 100));
                  emitLiveProgress('word', task.surah, false);
                }
              } else if (!result || !result.aborted) {
                failedCount++;
              }
            }
          });

          const wasStopped = state.stopped || controller.signal.aborted;
          if (!wasStopped && doneCount >= urls.length && urls.length > 0) {
            const unavailList = Array.from(unavailableSet);
            manifest.wordAudio[task.surah] = {
              count: Math.max(urls.length, totalWords),
              bytes: accumulatedBytes > 0 ? accumulatedBytes : prevSavedBytes,
              savedAt: Date.now(),
              ...(unavailList.length > 0 ? { unavailableUrls: unavailList } : {})
            };
            completedOk = true;
          } else if (!wasStopped && failedCount > 0) {
            showToastSafe(`সূরা ${getSurahName(task.surah)}-এর কিছু শব্দ ডাউনলোড হয়নি—আবার ট্যাপ করে বাকিটা সম্পন্ন করুন।`, 'warning');
          }
          saveManifestToStorage(true);
        } else if (!controller.signal.aborted && !state.stopped) {
          if (urls.length > 0) {
            const prev = manifest.wordAudio[task.surah];
            const unavailList = Array.from(unavailableSet);
            manifest.wordAudio[task.surah] = {
              count: Math.max(urls.length, totalWords),
              bytes: prev && prev.bytes > 0 ? prev.bytes : Math.max(1, urls.length - unavailList.length) * DEFAULT_WORD_AUDIO_BYTES,
              savedAt: Date.now(),
              ...(unavailList.length > 0 ? { unavailableUrls: unavailList } : {})
            };
            saveManifestToStorage(true);
            completedOk = true;
          }
        }
      }
    } finally {
      if (activeTasks.get(task.id) === state) {
        activeTasks.delete(task.id);
      }
      saveManifestToStorage(true);

      const wasStopped = state.stopped || controller.signal.aborted;
      if (completedOk && !wasStopped && task.mode === 'single' && activeTasks.size === 0 && queue.length === 0) {
        showToastSafe(
          task.type === 'ayah'
            ? `সূরা ${getSurahName(task.surah)}-এর তিলাওয়াত ডাউনলোড সম্পন্ন`
            : `সূরা ${getSurahName(task.surah)}-এর সব শব্দের অডিও ডাউনলোড সম্পন্ন`,
          'success'
        );
      }

      patchSurahRow(task.type, task.surah);
      pumpQueue();
      patchAllQueuedRows();
      renderOverviewAndActiveBar(true);
      patchTabActionButtons();

      if (activeTasks.size === 0 && queue.length === 0 && typeof global.updateStoragePersistenceUI === 'function') {
        global.updateStoragePersistenceUI();
      }
    }
  }

  function emitLiveProgress(type, surahNum, force) {
    const now = Date.now();
    if (!force && now - lastLiveRenderTs < 120) return;
    lastLiveRenderTs = now;
    patchSurahRow(type, surahNum);
    renderOverviewAndActiveBar(false);
    patchTabActionButtons();
  }

  // ============================================================
  // USER ACTIONS: ENQUEUE, STOP, REMOVE FROM QUEUE, DELETE
  // ============================================================
  function enqueueSurah(type, surahNum, mode) {
    const sNum = parseInt(surahNum, 10);
    if (!Number.isInteger(sNum) || sNum < 1 || sNum > 114) return false;
    const surahMeta = metaBySurah.get(sNum) || { surah: sNum, total_words: 1 };
    const rowState = computeSurahRowDownloadState(surahMeta, type, manifest, activeTasks, queue);

    if (rowState.status === 'completed') {
      showToastSafe(`সূরা ${getSurahName(sNum)}-এর অডিও ইতিমধ্যেই ডাউনলোড করা আছে।`, 'info');
      return false;
    }
    if (rowState.status === 'downloading') {
      stopTask(type, sNum, true);
      return false;
    }
    if (rowState.status === 'queued') {
      removeQueuedTask(type, sNum);
      return false;
    }

    const id = makeTaskId(type, sNum);
    const willWaitInQueue = !canStartTaskType(activeTasks, type);
    queue.push({ id, type, surah: sNum, mode: mode || 'single' });

    if (willWaitInQueue && (mode || 'single') === 'single') {
      showToastSafe(`সূরা ${getSurahName(sNum)} ডাউনলোড কিউতে যুক্ত হয়েছে`, 'info');
    }

    pumpQueue();
    patchSurahRow(type, sNum);
    patchAllQueuedRows();
    renderOverviewAndActiveBar(true);
    patchTabActionButtons();
    return true;
  }

  function removeQueuedTask(type, surahNum) {
    const id = makeTaskId(type, surahNum);
    const beforeLen = queue.length;
    queue = queue.filter((t) => t.id !== id);
    if (queue.length !== beforeLen) {
      patchSurahRow(type, surahNum);
      patchAllQueuedRows();
      renderOverviewAndActiveBar(true);
      patchTabActionButtons();
      showToastSafe(`সূরা ${getSurahName(surahNum)} কিউ থেকে সরানো হয়েছে`, 'info');
      return true;
    }
    return false;
  }

  function stopTask(type, surahNum, showFeedback) {
    const id = makeTaskId(type, surahNum);
    const state = activeTasks.get(id);
    if (!state) return false;

    state.stopped = true;
    activeTasks.delete(id);
    if (type === 'word') {
      sharedWordPool.cancelJob(id);
    }
    try {
      state.controller.abort();
    } catch (e) {}

    const hadWaitingForSameType = queue.some((t) => t.type === type);
    patchSurahRow(type, surahNum);
    pumpQueue();
    patchAllQueuedRows();
    renderOverviewAndActiveBar(true);
    patchTabActionButtons();

    if (showFeedback) {
      const msg = hadWaitingForSameType
        ? `সূরা ${getSurahName(surahNum)} থামানো হয়েছে — পরবর্তী সূরা শুরু হচ্ছে`
        : `সূরা ${getSurahName(surahNum)}-এর ডাউনলোড থামানো হয়েছে`;
      showToastSafe(msg, 'info');
    }
    return true;
  }

  function stopActiveTask(showFeedback) {
    const first = activeTasks.values().next().value;
    if (!first) return false;
    return stopTask(first.task.type, first.task.surah, showFeedback);
  }

  function stopAll(tabTypeOnly) {
    let stoppedSomething = false;
    const rowsToPatch = [];

    if (tabTypeOnly) {
      const removedTasks = queue.filter((t) => t.type === tabTypeOnly);
      queue = queue.filter((t) => t.type !== tabTypeOnly);
      if (removedTasks.length > 0) stoppedSomething = true;
      removedTasks.forEach((t) => rowsToPatch.push(t));

      for (const [id, state] of Array.from(activeTasks.entries())) {
        if (state.task.type === tabTypeOnly) {
          state.stopped = true;
          activeTasks.delete(id);
          if (state.task.type === 'word') sharedWordPool.cancelJob(id);
          try { state.controller.abort(); } catch (e) {}
          rowsToPatch.push(state.task);
          stoppedSomething = true;
        }
      }
    } else {
      const removedTasks = queue.slice();
      queue = [];
      if (removedTasks.length > 0) stoppedSomething = true;
      removedTasks.forEach((t) => rowsToPatch.push(t));

      for (const [id, state] of Array.from(activeTasks.entries())) {
        state.stopped = true;
        activeTasks.delete(id);
        if (state.task.type === 'word') sharedWordPool.cancelJob(id);
        try { state.controller.abort(); } catch (e) {}
        rowsToPatch.push(state.task);
        stoppedSomething = true;
      }
    }

    rowsToPatch.forEach((t) => patchSurahRow(t.type, t.surah));
    patchAllQueuedRows();
    renderOverviewAndActiveBar(true);
    patchTabActionButtons();
    if (stoppedSomething) {
      showToastSafe('ডাউনলোড বিরতি দেওয়া হয়েছে।', 'info');
    }
    return stoppedSomething;
  }

  function toggleBulkDownload(type) {
    const hasActiveForType = Array.from(activeTasks.values()).some((a) => a.task.type === type);
    const isTabBusy = hasActiveForType || queue.some((t) => t.type === type);

    if (isTabBusy) {
      stopAll(type);
      return;
    }

    loadInstantSurahsMeta();
    let added = 0;
    for (let i = 0; i < surahsMeta.length; i++) {
      const s = surahsMeta[i];
      const isDone =
        type === 'ayah'
          ? Boolean(manifest.surahAudio[s.surah])
          : (manifest.wordAudio[s.surah] ? manifest.wordAudio[s.surah].count : 0) >= s.total_words;
      if (isDone) continue;
      const id = makeTaskId(type, s.surah);
      if (activeTasks.has(id)) continue;
      if (queue.some((t) => t.id === id)) continue;
      queue.push({ id, type, surah: s.surah, mode: 'bulk' });
      added++;
    }

    if (added === 0) {
      showToastSafe(
        type === 'ayah'
          ? 'সব সূরার তিলাওয়াত ইতিমধ্যেই ডাউনলোড করা আছে।'
          : 'সব সূরার শব্দ অডিও ইতিমধ্যেই ডাউনলোড করা আছে।',
        'info'
      );
      return;
    }

    pumpQueue();
    patchAllQueuedRows();
    renderOverviewAndActiveBar(true);
    patchTabActionButtons();
  }

  async function deleteSurahAudio(type, surahNum, skipConfirm) {
    const sNum = parseInt(surahNum, 10);
    if (!Number.isInteger(sNum) || sNum < 1 || sNum > 114) return false;

    const surahName = getSurahName(sNum);
    const entry = type === 'ayah' ? manifest.surahAudio[sNum] : manifest.wordAudio[sNum];
    if (!entry) return false;

    const sizeLabel = formatAudioBytesBn(entry.bytes || 0, true);
    if (!skipConfirm && global.UIOverlay && typeof global.UIOverlay.confirm === 'function') {
      const msg =
        type === 'ayah'
          ? `সূরা ${surahName}-এর পূর্ণাঙ্গ তিলাওয়াত (${sizeLabel}) ফোন থেকে মুছে ফেলবেন? পরে যেকোনো সময় আবার ডাউনলোড করা যাবে।`
          : `সূরা ${surahName}-এর ${toBn(entry.count || 0)}টি শব্দের অডিও (${sizeLabel}) ফোন থেকে মুছে ফেলবেন? পরে আবার ডাউনলোড করা যাবে।`;
      const confirmed = await global.UIOverlay.confirm({
        title: 'অডিও মুছে ফেলবেন?',
        message: msg,
        confirmText: 'মুছে ফেলুন',
        cancelText: 'বাতিল',
        destructive: true
      });
      if (!confirmed) return false;
    }

    // Cancel if somehow active or queued
    const taskId = makeTaskId(type, sNum);
    if (activeTasks.has(taskId)) {
      stopTask(type, sNum, false);
    }
    queue = queue.filter((t) => t.id !== taskId);

    // Delete actual CacheStorage entries
    if ('caches' in global) {
      try {
        const cache = await caches.open(AUDIO_CACHE);
        if (type === 'ayah') {
          const url = getSurahAudioUrl(sNum);
          await cache.delete(url);
          if (global.QuranDB && global.QuranDB.invalidateAudioCacheSizeMemo) {
            global.QuranDB.invalidateAudioCacheSizeMemo(url);
          }
        } else {
          const sPad = String(sNum).padStart(3, '0');
          const pattern = new RegExp(`/${sPad}_\\d{3}_\\d{3}\\.mp3`);
          const keys = await cache.keys();
          const targets = keys.filter((req) => pattern.test(req.url));
          const BATCH = 32;
          for (let i = 0; i < targets.length; i += BATCH) {
            await Promise.all(targets.slice(i, i + BATCH).map((req) => cache.delete(req)));
          }
          if (global.QuranDB && global.QuranDB.invalidateAudioCacheSizeMemo) {
            global.QuranDB.invalidateAudioCacheSizeMemo();
          }
        }
      } catch (e) {
        console.warn('[AudioDownloadManager] Delete cache warning:', e);
      }
    }

    if (type === 'ayah') {
      delete manifest.surahAudio[sNum];
    } else {
      delete manifest.wordAudio[sNum];
    }
    saveManifestToStorage(true);

    patchSurahRow(type, sNum);
    renderOverviewAndActiveBar(true);
    patchTabActionButtons();

    showToastSafe(
      type === 'ayah'
        ? `সূরা ${surahName}-এর তিলাওয়াত মুছে ফেলা হয়েছে (${sizeLabel} খালি হয়েছে)`
        : `সূরা ${surahName}-এর শব্দ অডিও মুছে ফেলা হয়েছে (${sizeLabel} খালি হয়েছে)`,
      'success'
    );

    if (typeof global.updateStoragePersistenceUI === 'function') {
      global.updateStoragePersistenceUI();
    }
    return true;
  }

  async function deleteAllForTab(type, skipConfirm) {
    const stats = computeAudioOverviewStats(manifest, surahsMeta, 0);
    const hasData = type === 'ayah' ? stats.hasAnySurahAudio : stats.hasAnyWordAudio;
    if (!hasData) return false;

    const bytesToFree = type === 'ayah' ? stats.totalSurahBytes : stats.totalWordBytes;
    const sizeLabel = formatAudioBytesBn(bytesToFree, true);

    if (!skipConfirm && global.UIOverlay && typeof global.UIOverlay.confirm === 'function') {
      const msg =
        type === 'ayah'
          ? `ডাউনলোড করা সব ${toBn(stats.completedSurahs)}টি সূরার পূর্ণাঙ্গ তিলাওয়াত (${sizeLabel}) মুছে ফেলবেন? শব্দ অডিও এবং আপনার পড়াশোনার অগ্রগতি অক্ষুণ্ণ থাকবে।`
          : `ডাউনলোড করা সব ${toBn(stats.totalSavedWords)}টি শব্দের অডিও (${sizeLabel}) মুছে ফেলবেন? সূরা তিলাওয়াত এবং আপনার পড়াশোনার অগ্রগতি অক্ষুণ্ণ থাকবে।`;
      const confirmed = await global.UIOverlay.confirm({
        title: type === 'ayah' ? 'সব সূরা তিলাওয়াত মুছে ফেলবেন?' : 'সব শব্দ অডিও মুছে ফেলবেন?',
        message: msg,
        confirmText: 'সব মুছুন',
        cancelText: 'বাতিল',
        destructive: true
      });
      if (!confirmed) return false;
    }

    // Stop any running/queued tasks for this tab first
    stopAll(type);

    if ('caches' in global) {
      try {
        const cache = await caches.open(AUDIO_CACHE);
        const keys = await cache.keys();
        const targets = keys.filter((req) => {
          const parsed = parseCacheAudioUrl(req.url);
          return parsed && parsed.type === type;
        });
        const BATCH = 48;
        for (let i = 0; i < targets.length; i += BATCH) {
          await Promise.all(targets.slice(i, i + BATCH).map((req) => cache.delete(req)));
        }
        if (global.QuranDB && global.QuranDB.invalidateAudioCacheSizeMemo) {
          global.QuranDB.invalidateAudioCacheSizeMemo();
        }
      } catch (e) {
        console.warn('[AudioDownloadManager] Bulk delete warning:', e);
      }
    }

    if (type === 'ayah') {
      manifest.surahAudio = {};
    } else {
      manifest.wordAudio = {};
    }
    saveManifestToStorage(true);

    patchAllRowsForTab(type);
    renderOverviewAndActiveBar(true);
    patchTabActionButtons();

    showToastSafe(
      type === 'ayah'
        ? `সব সূরা তিলাওয়াত মুছে ফেলা হয়েছে (${sizeLabel} খালি হয়েছে)`
        : `সব শব্দ অডিও মুছে ফেলা হয়েছে (${sizeLabel} খালি হয়েছে)`,
      'success'
    );

    if (typeof global.updateStoragePersistenceUI === 'function') {
      global.updateStoragePersistenceUI();
    }
    return true;
  }

  // ============================================================
  // SILENT BACKGROUND CACHE RECONCILIATION (NEVER BLOCKS OPEN)
  // ============================================================
  async function reconcileWithCacheStorage() {
    if (isReconciling || !('caches' in global)) return false;
    if (activeTasks.size > 0 || queue.length > 0) return false; // Don't race active downloads
    isReconciling = true;

    try {
      const cache = await caches.open(AUDIO_CACHE);
      const keys = await cache.keys();

      const surahCounts = {};
      const surahReqsToMeasure = [];
      const wordCounts = {};

      for (let i = 0; i < keys.length; i++) {
        const req = keys[i];
        const parsed = parseCacheAudioUrl(req.url);
        if (!parsed) continue;
        if (parsed.type === 'ayah') {
          surahCounts[parsed.surah] = 1;
          if (!manifest.surahAudio[parsed.surah] || !manifest.surahAudio[parsed.surah].bytes) {
            surahReqsToMeasure.push({ surah: parsed.surah, req });
          }
        } else {
          wordCounts[parsed.surah] = (wordCounts[parsed.surah] || 0) + 1;
        }
      }

      // Measure exact Content-Length for any unindexed Surah MP3s (fast: at most 114 files)
      const surahBytes = {};
      if (surahReqsToMeasure.length > 0) {
        const BATCH = 16;
        for (let i = 0; i < surahReqsToMeasure.length; i += BATCH) {
          const slice = surahReqsToMeasure.slice(i, i + BATCH);
          await Promise.all(
            slice.map(async ({ surah, req }) => {
              try {
                const res = await cache.match(req);
                if (!res || res.type === 'opaque') return;
                const cl = parseInt(res.headers.get('content-length') || '0', 10);
                if (cl > 0) {
                  surahBytes[surah] = cl;
                }
              } catch (e) {}
            })
          );
        }
      }

      // If a download started while we were scanning, skip overwriting to avoid race
      if (activeTasks.size > 0 || queue.length > 0) return false;

      const { manifest: nextManifest, changed } = reconcileManifestWithCacheScan(
        manifest,
        { surahCounts, surahBytes, wordCounts },
        surahsMeta,
        Date.now()
      );

      manifest = nextManifest;
      saveManifestToStorage(true);

      if (changed) {
        patchAllRowsForTab('ayah');
        patchAllRowsForTab('word');
        renderOverviewAndActiveBar(true);
        patchTabActionButtons();
      }
      return changed;
    } catch (e) {
      return false;
    } finally {
      isReconciling = false;
    }
  }

  function scheduleIdleReconciliation() {
    const run = () => {
      reconcileWithCacheStorage().catch(() => {});
    };
    if (typeof global.requestIdleCallback === 'function') {
      global.requestIdleCallback(run, { timeout: 600 });
    } else {
      setTimeout(run, 80);
    }
  }

  // ============================================================
  // ZERO-FLICKER DOM RENDERING
  // ============================================================
  function getIcons() {
    return global.Icons || {};
  }

  function renderRingSvg(percent) {
    const clamped = Math.max(0, Math.min(100, percent || 0));
    const offset = RING_CIRCUMFERENCE * (1 - clamped / 100);
    return `
      <svg class="dl-ring-svg" viewBox="0 0 36 36" aria-hidden="true">
        <circle class="dl-ring-track" cx="18" cy="18" r="16"></circle>
        <circle class="dl-ring-fill" cx="18" cy="18" r="16"
          stroke-dasharray="${RING_CIRCUMFERENCE.toFixed(2)}"
          stroke-dashoffset="${offset.toFixed(2)}"></circle>
      </svg>
    `;
  }

  function buildRowMetaHtml(type, rowState, surahMeta) {
    const icons = getIcons();
    const totalWords = surahMeta.total_words || 1;

    if (rowState.status === 'downloading') {
      if (type === 'ayah') {
        const sizePart =
          rowState.totalBytes > 0
            ? ` · ${formatAudioBytesBn(rowState.bytes, true)} / ${formatAudioBytesBn(rowState.totalBytes, true)}`
            : rowState.bytes > 0
              ? ` · ${formatAudioBytesBn(rowState.bytes, true)}`
              : '';
        return `<span class="dl-meta-downloading tabular-nums">ডাউনলোড হচ্ছে · ${toBn(rowState.percent)}%${sizePart}</span>`;
      }
      const sizePart = rowState.bytes > 0 ? ` · ${formatAudioBytesBn(rowState.bytes, true)}` : '';
      return `<span class="dl-meta-downloading tabular-nums">${toBn(rowState.doneUnits)}/${toBn(rowState.totalUnits)} শব্দ · ${toBn(rowState.percent)}%${sizePart}</span>`;
    }

    if (rowState.status === 'queued') {
      const posText = rowState.queuePosition > 0 ? ` (#${toBn(rowState.queuePosition)})` : '';
      return `<span class="dl-meta-queued">অপেক্ষমাণ${posText} · ট্যাপ করলে বাদ যাবে</span>`;
    }

    if (rowState.status === 'completed') {
      const sizeText = rowState.bytes > 0 ? ` · ${formatAudioBytesBn(rowState.bytes, true)}` : '';
      const wordsText = type === 'word' ? ` · ${toBn(totalWords)}/${toBn(totalWords)} শব্দ` : '';
      return `<span class="dl-meta-completed"><span class="dl-check-inline" aria-hidden="true">${icons.checkCircle || ''}</span><span>ডাউনলোড সম্পন্ন${wordsText}${sizeText}</span></span>`;
    }

    if (rowState.status === 'partial') {
      const sizeText = rowState.bytes > 0 ? ` · ${formatAudioBytesBn(rowState.bytes, true)}` : '';
      return `<span class="dl-meta-partial tabular-nums">আংশিক · ${toBn(rowState.doneUnits)}/${toBn(rowState.totalUnits)} শব্দ${sizeText}</span>`;
    }

    // Idle
    if (type === 'ayah') {
      const est = formatAudioBytesBn(estimateSurahFallbackBytes(surahMeta), true);
      return `<span class="dl-meta-idle">ডাউনলোড বাকি · ~${est}</span>`;
    }
    return `<span class="dl-meta-idle tabular-nums">${toBn(totalWords)}টি শব্দ · ডাউনলোড বাকি</span>`;
  }

  function buildSurahRowElement(type, surahMeta) {
    const li = document.createElement('li');
    li.className = 'dl-surah-row';
    li.id = `dl-row-${type}-${surahMeta.surah}`;
    li.dataset.type = type;
    li.dataset.surah = String(surahMeta.surah);

    const numStr = toBn(String(surahMeta.surah).padStart(2, '0'));
    const titleBn = surahMeta.name_bn_script || surahMeta.name_bn || surahMeta.name_transliteration || `সূরা ${toBn(surahMeta.surah)}`;
    const titleAr = surahMeta.name_ar || '';

    li.innerHTML = `
      <div class="dl-row-main">
        <span class="dl-row-num tabular-nums">${numStr}</span>
        <div class="dl-row-info">
          <div class="dl-row-title-line">
            <span class="dl-surah-title">${titleBn}</span>
            ${titleAr ? `<span class="dl-surah-ar" lang="ar" dir="rtl">${titleAr}</span>` : ''}
          </div>
          <div class="dl-row-meta" id="dl-meta-${type}-${surahMeta.surah}"></div>
          <div class="dl-row-bar" id="dl-bar-${type}-${surahMeta.surah}" style="display:none">
            <div class="dl-row-bar-fill" id="dl-bar-fill-${type}-${surahMeta.surah}" style="width:0%"></div>
          </div>
        </div>
      </div>
      <div class="dl-row-actions">
        <button type="button" class="dl-icon-btn dl-action-btn" id="dl-act-${type}-${surahMeta.surah}" aria-label="ডাউনলোড"></button>
        <button type="button" class="dl-icon-btn dl-delete-btn" id="dl-del-${type}-${surahMeta.surah}" aria-label="সূরা ${titleBn}-এর অডিও মুছে ফেলুন" title="মুছে ফেলুন" style="display:none"></button>
      </div>
    `;

    const actionBtn = li.querySelector(`#dl-act-${type}-${surahMeta.surah}`);
    const deleteBtn = li.querySelector(`#dl-del-${type}-${surahMeta.surah}`);

    if (actionBtn) {
      actionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleRowPrimaryAction(type, surahMeta.surah);
      });
    }
    if (deleteBtn) {
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSurahAudio(type, surahMeta.surah, false);
      });
    }

    // Tapping the row itself also triggers start/stop/unqueue for easy mobile thumb reach
    li.addEventListener('click', () => {
      const state = computeSurahRowDownloadState(surahMeta, type, manifest, activeTasks, queue);
      if (state.status !== 'completed') {
        handleRowPrimaryAction(type, surahMeta.surah);
      }
    });

    return li;
  }

  function handleRowPrimaryAction(type, surahNum) {
    const surahMeta = metaBySurah.get(surahNum) || { surah: surahNum, total_words: 1 };
    const state = computeSurahRowDownloadState(surahMeta, type, manifest, activeTasks, queue);
    if (state.status === 'downloading') {
      stopTask(type, surahNum, true);
    } else if (state.status === 'queued') {
      removeQueuedTask(type, surahNum);
    } else if (state.status === 'idle' || state.status === 'partial') {
      enqueueSurah(type, surahNum, 'single');
    } else if (state.status === 'completed') {
      showToastSafe(`সূরা ${getSurahName(surahNum)}-এর অডিও ইতিমধ্যেই ডাউনলোড সম্পন্ন হয়েছে।`, 'info');
    }
  }

  function patchSurahRow(type, surahNum) {
    const surahMeta = metaBySurah.get(surahNum);
    if (!surahMeta) return;
    const rowEl = document.getElementById(`dl-row-${type}-${surahNum}`);
    if (!rowEl) return;

    const state = computeSurahRowDownloadState(surahMeta, type, manifest, activeTasks, queue);
    const icons = getIcons();
    const surahName = getSurahName(surahNum);

    rowEl.classList.remove('is-saved', 'is-partial', 'downloading', 'is-queued');
    if (state.status === 'completed') rowEl.classList.add('is-saved');
    else if (state.status === 'partial') rowEl.classList.add('is-partial');
    else if (state.status === 'downloading') rowEl.classList.add('downloading');
    else if (state.status === 'queued') rowEl.classList.add('is-queued');
    rowEl.dataset.status = state.status;

    const metaEl = document.getElementById(`dl-meta-${type}-${surahNum}`);
    if (metaEl) {
      metaEl.innerHTML = buildRowMetaHtml(type, state, surahMeta);
    }

    const barEl = document.getElementById(`dl-bar-${type}-${surahNum}`);
    const barFillEl = document.getElementById(`dl-bar-fill-${type}-${surahNum}`);
    if (barEl && barFillEl) {
      const showBar = state.status === 'downloading' || state.status === 'partial';
      barEl.style.display = showBar ? 'block' : 'none';
      barFillEl.style.width = `${Math.max(0, Math.min(100, state.percent))}%`;
    }

    const actBtn = document.getElementById(`dl-act-${type}-${surahNum}`);
    if (actBtn) {
      actBtn.classList.remove('is-idle', 'is-queued', 'is-downloading', 'is-completed', 'is-partial');
      if (state.status === 'completed') {
        actBtn.style.display = 'none';
        actBtn.classList.add('is-completed');
      } else {
        actBtn.style.display = 'inline-flex';
        if (state.status === 'downloading') {
          actBtn.classList.add('is-downloading');
          actBtn.setAttribute('aria-label', `সূরা ${surahName}-এর ডাউনলোড থামান`);
          actBtn.setAttribute('title', 'থামান');
          actBtn.innerHTML = `${renderRingSvg(state.percent)}<span class="dl-stop-center">${icons.stop || ''}</span>`;
        } else if (state.status === 'queued') {
          actBtn.classList.add('is-queued');
          actBtn.setAttribute('aria-label', `সূরা ${surahName} কিউ থেকে সরান`);
          actBtn.setAttribute('title', 'কিউ থেকে সরান');
          actBtn.innerHTML = `<span class="icon">${icons.clock || ''}</span>`;
        } else if (state.status === 'partial') {
          actBtn.classList.add('is-partial');
          actBtn.setAttribute('aria-label', `সূরা ${surahName}-এর বাকি অডিও ডাউনলোড করুন`);
          actBtn.setAttribute('title', 'বাকি অংশ ডাউনলোড করুন');
          actBtn.innerHTML = `<span class="icon">${icons.download || ''}</span>`;
        } else {
          actBtn.classList.add('is-idle');
          actBtn.setAttribute('aria-label', `সূরা ${surahName} ডাউনলোড করুন`);
          actBtn.setAttribute('title', 'ডাউনলোড করুন');
          actBtn.innerHTML = `<span class="icon">${icons.download || ''}</span>`;
        }
      }
    }

    const delBtn = document.getElementById(`dl-del-${type}-${surahNum}`);
    if (delBtn) {
      delBtn.style.display = state.canDelete ? 'inline-flex' : 'none';
      if (state.canDelete && !delBtn.dataset.iconReady) {
        delBtn.innerHTML = `<span class="icon">${icons.trash || ''}</span>`;
        delBtn.dataset.iconReady = '1';
      }
    }
  }

  function patchAllQueuedRows() {
    for (let i = 0; i < queue.length; i++) {
      patchSurahRow(queue[i].type, queue[i].surah);
    }
  }

  function patchAllRowsForTab(type) {
    for (let i = 0; i < surahsMeta.length; i++) {
      patchSurahRow(type, surahsMeta[i].surah);
    }
  }

  function ensureRowsBuilt() {
    if (surahsMeta.length === 0) return;
    ['ayah', 'word'].forEach((type) => {
      const listEl = document.getElementById(type === 'ayah' ? 'dl-list-ayah' : 'dl-list-word');
      if (!listEl) return;
      if (listEl.dataset.builtCount === String(surahsMeta.length) && listEl.children.length === surahsMeta.length) {
        return;
      }
      const frag = document.createDocumentFragment();
      for (let i = 0; i < surahsMeta.length; i++) {
        frag.appendChild(buildSurahRowElement(type, surahsMeta[i]));
      }
      listEl.innerHTML = '';
      listEl.appendChild(frag);
      listEl.dataset.builtCount = String(surahsMeta.length);
      patchAllRowsForTab(type);
    });
  }

  function renderOverviewAndActiveBar(force) {
    const activeList = Array.from(activeTasks.values());
    const inFlight = sumInFlightBytes(activeList);
    const stats = computeAudioOverviewStats(manifest, surahsMeta, inFlight);

    const sizeEl = document.getElementById('dl-storage-used-text');
    if (sizeEl) {
      sizeEl.textContent = formatAudioBytesBn(stats.totalAudioBytes, true);
    }

    const surahCountEl = document.getElementById('dl-overview-surah-count');
    if (surahCountEl) {
      surahCountEl.textContent = `${toBn(stats.completedSurahs)} / ${toBn(stats.totalSurahs)}`;
    }

    const wordCountEl = document.getElementById('dl-overview-word-count');
    if (wordCountEl) {
      wordCountEl.textContent = `${toBn(stats.totalSavedWords)} / ${toBn(stats.totalWords)}`;
    }

    // Active Queue / Progress strip inside the overview card
    const wrap = document.getElementById('dl-active-progress-wrap');
    const lbl = document.getElementById('dl-active-progress-label');
    const pct = document.getElementById('dl-active-progress-pct');
    const fill = document.getElementById('dl-active-progress-fill');

    if (wrap) {
      if (activeList.length > 0) {
        wrap.style.display = 'flex';
        const ayahActive = activeList.filter((a) => a.task.type === 'ayah');
        const wordActive = activeList.filter((a) => a.task.type === 'word');
        const queueSuffix = queue.length > 0 ? ` · কিউতে আরও ${toBn(queue.length)}টি` : '';

        let labelText = '';
        if (ayahActive.length > 0 && wordActive.length > 0) {
          labelText = `তিলাওয়াত (${toBn(ayahActive.length)}টি) ও শব্দ অডিও (${toBn(wordActive.length)}টি)${queueSuffix}`;
        } else if (ayahActive.length > 1) {
          const names = ayahActive
            .slice(0, 2)
            .map((a) => getSurahName(a.task.surah))
            .join(', ');
          const extra = ayahActive.length > 2 ? ` +${toBn(ayahActive.length - 2)}` : '';
          labelText = `${toBn(ayahActive.length)}টি সূরা ডাউনলোড হচ্ছে (${names}${extra})${queueSuffix}`;
        } else if (wordActive.length > 1) {
          const names = wordActive
            .slice(0, 2)
            .map((a) => getSurahName(a.task.surah))
            .join(', ');
          const extra = wordActive.length > 2 ? ` +${toBn(wordActive.length - 2)}` : '';
          labelText = `${toBn(wordActive.length)}টি সূরার শব্দ অডিও (${names}${extra})${queueSuffix}`;
        } else {
          const t = activeList[0].task;
          const kindLabel = t.type === 'ayah' ? 'তিলাওয়াত' : 'শব্দ অডিও';
          labelText = `${kindLabel}: সূরা ${getSurahName(t.surah)}${queueSuffix}`;
        }

        if (lbl) lbl.textContent = labelText;

        const sumPct = activeList.reduce((acc, a) => acc + Math.max(0, Math.min(100, a.percent || 0)), 0);
        const pVal = Math.max(0, Math.min(100, Math.round(sumPct / activeList.length)));
        if (pct) pct.textContent = `${toBn(pVal)}%`;
        if (fill) fill.style.width = `${pVal}%`;
      } else {
        wrap.style.display = 'none';
        if (fill) fill.style.width = '0%';
      }
    }
  }

  function patchTabActionButtons() {
    const icons = getIcons();
    const activeList = Array.from(activeTasks.values());
    const stats = computeAudioOverviewStats(manifest, surahsMeta, 0);

    ['ayah', 'word'].forEach((type) => {
      const dlBtn = document.getElementById(type === 'ayah' ? 'dl-all-ayah' : 'dl-all-word');
      const delBtn = document.getElementById(type === 'ayah' ? 'dl-delete-all-ayah' : 'dl-delete-all-word');

      const tabActiveList = activeList.filter((a) => a.task.type === type);
      const isTabBusy = tabActiveList.length > 0 || queue.some((t) => t.type === type);

      if (dlBtn) {
        dlBtn.classList.toggle('btn-active-downloading', isTabBusy);
        if (isTabBusy) {
          let suffix = '';
          if (tabActiveList.length > 1) {
            suffix = ` (${toBn(tabActiveList.length)}টি চলছে)`;
          } else if (tabActiveList.length === 1) {
            suffix = ` (${toBn(Math.round(tabActiveList[0].percent || 0))}%)`;
          }
          const label = `ডাউনলোড থামান${suffix}`;
          if (global.DownloadHeaderHelper) {
            global.DownloadHeaderHelper.setDownloadButtonState(dlBtn, icons.stop || icons.pause, label);
          } else {
            dlBtn.innerHTML = `<span class="icon">${icons.stop || icons.pause || ''}</span><span class="dl-btn-label">${label}</span>`;
          }
        } else {
          const allDone =
            type === 'ayah'
              ? stats.completedSurahs >= stats.totalSurahs
              : stats.totalSavedWords >= stats.totalWords && stats.totalWords > 0;
          const label = allDone
            ? type === 'ayah'
              ? 'সব তিলাওয়াত সম্পন্ন'
              : 'সব শব্দ অডিও সম্পন্ন'
            : type === 'ayah'
              ? 'সব তিলাওয়াত ডাউনলোড'
              : 'সব শব্দ অডিও ডাউনলোড';
          const iconSvg = allDone ? (icons.checkCircle || icons.check) : icons.download;
          if (global.DownloadHeaderHelper) {
            global.DownloadHeaderHelper.setDownloadButtonState(dlBtn, iconSvg, label);
          } else {
            dlBtn.innerHTML = `<span class="icon">${iconSvg || ''}</span><span class="dl-btn-label">${label}</span>`;
          }
        }
      }

      if (delBtn) {
        const hasAny = type === 'ayah' ? stats.hasAnySurahAudio : stats.hasAnyWordAudio;
        delBtn.disabled = !hasAny;
        if (!delBtn.dataset.iconReady) {
          delBtn.innerHTML = `<span class="icon">${icons.trash || ''}</span><span>সব মুছুন</span>`;
          delBtn.dataset.iconReady = '1';
        }
      }
    });
  }

  function bindStaticControlsOnce() {
    if (domInitialized) return;
    domInitialized = true;

    // Tab switcher
    document.querySelectorAll('.dl-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.dl-tab').forEach((t) => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        activeTab = tab.dataset.tab === 'word' ? 'word' : 'ayah';
        const ayahPanel = document.getElementById('dl-panel-ayah');
        const wordPanel = document.getElementById('dl-panel-word');
        if (ayahPanel) ayahPanel.style.display = activeTab === 'ayah' ? 'flex' : 'none';
        if (wordPanel) wordPanel.style.display = activeTab === 'word' ? 'flex' : 'none';
      });
    });

    const dlAllAyah = document.getElementById('dl-all-ayah');
    if (dlAllAyah) dlAllAyah.addEventListener('click', () => toggleBulkDownload('ayah'));

    const dlAllWord = document.getElementById('dl-all-word');
    if (dlAllWord) dlAllWord.addEventListener('click', () => toggleBulkDownload('word'));

    const delAllAyah = document.getElementById('dl-delete-all-ayah');
    if (delAllAyah) delAllAyah.addEventListener('click', () => deleteAllForTab('ayah', false));

    const delAllWord = document.getElementById('dl-delete-all-word');
    if (delAllWord) delAllWord.addEventListener('click', () => deleteAllForTab('word', false));

    const stopAllBtn = document.getElementById('dl-stop-all-btn');
    if (stopAllBtn) stopAllBtn.addEventListener('click', () => stopAll());
  }

  // ============================================================
  // PUBLIC ENTRYPOINT: 0ms INSTANT REFRESH + IDLE RECONCILE
  // ============================================================
  async function refresh() {
    bindStaticControlsOnce();

    // 1. 0ms synchronous render from local manifest + bundled SURAHS_META
    loadInstantSurahsMeta();
    ensureRowsBuilt();
    renderOverviewAndActiveBar(true);
    patchTabActionButtons();

    // 2. If SURAHS_META wasn't bundled yet, load asynchronously from QuranDB
    if (surahsMeta.length === 0 && global.QuranDB && typeof global.QuranDB.getSurahsMeta === 'function') {
      try {
        const fetched = await global.QuranDB.getSurahsMeta();
        surahsMeta = normalizeSurahMeta(fetched);
        metaBySurah = new Map(surahsMeta.map((s) => [s.surah, s]));
        ensureRowsBuilt();
        renderOverviewAndActiveBar(true);
        patchTabActionButtons();
      } catch (e) {}
    }

    // 3. Non-blocking background reconciliation with real CacheStorage
    scheduleIdleReconciliation();
  }

  function getSnapshot() {
    const activeList = Array.from(activeTasks.values());
    const inFlight = sumInFlightBytes(activeList);
    return {
      activeTab,
      manifest: parseAudioManifest(manifest),
      overview: computeAudioOverviewStats(manifest, surahsMeta, inFlight),
      activeTask: activeList[0] ? { ...activeList[0].task, percent: activeList[0].percent } : null,
      activeTasks: activeList.map((a) => ({
        ...a.task,
        percent: a.percent,
        receivedBytes: a.receivedBytes,
        totalBytes: a.totalBytes,
        completedUnits: a.completedUnits,
        totalUnits: a.totalUnits
      })),
      queue: queue.map((t) => ({ ...t })),
      concurrency: {
        surahs: MAX_PARALLEL_SURAH_DOWNLOADS,
        wordSurahs: MAX_PARALLEL_WORD_SURAH_TASKS,
        words: WORD_AUDIO_CONCURRENCY,
        activeWordWorkers: sharedWordPool.getActiveWorkerCount()
      }
    };
  }

  global.AudioDownloadCore = {
    MAX_PARALLEL_SURAH_DOWNLOADS,
    MAX_PARALLEL_WORD_SURAH_TASKS,
    WORD_AUDIO_CONCURRENCY,
    createSharedWordDownloadPool,
    makeTaskId,
    getParallelTaskLimit,
    canStartTaskType,
    pickNextRunnableTask,
    sumInFlightBytes,
    createEmptyAudioManifest,
    parseAudioManifest,
    computeAudioOverviewStats,
    computeSurahRowDownloadState,
    reconcileManifestWithCacheScan,
    formatAudioBytesBn,
    parseCacheAudioUrl
  };

  global.AudioDownloadManager = {
    refresh,
    enqueueSurah,
    removeQueuedTask,
    stopTask,
    stopActiveTask,
    stopAll,
    toggleBulkDownload,
    deleteSurahAudio,
    deleteAllForTab,
    reconcileWithCacheStorage,
    getSnapshot
  };

  // Preserve backward compatibility with existing app.js navigation hook
  global.refreshDownloadPanels = refresh;
})(typeof window !== 'undefined' ? window : globalThis);
