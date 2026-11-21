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
  const RING_CIRCUMFERENCE = 2 * Math.PI * 16; // r=16 => ~100.53

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
          if (count > 0) {
            base.wordAudio[sNum] = {
              count,
              bytes: Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes) : count * DEFAULT_WORD_AUDIO_BYTES,
              savedAt: Number.isFinite(savedAt) ? savedAt : 0
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
      totalWords = 77430;
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

    if (active && active.task.id === taskId) {
      const doneUnits = type === 'ayah' ? 0 : Math.max(savedUnits, active.completedUnits || 0);
      const percent =
        type === 'ayah'
          ? Math.max(0, Math.min(99, Math.round(active.percent || 0)))
          : Math.max(0, Math.min(99, Math.round((doneUnits / totalUnits) * 100)));
      const bytes = type === 'ayah' ? (active.receivedBytes || 0) : savedBytes;
      return {
        surah: sNum,
        type,
        status: 'downloading',
        doneUnits,
        totalUnits,
        percent,
        bytes,
        totalBytes: type === 'ayah' ? (active.totalBytes || 0) : 0,
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
      const meta = metaBySurah.get(sNum);
      const maxW = meta && meta.total_words > 0 ? meta.total_words : rawCount;
      const count = Math.min(Math.max(0, Math.floor(rawCount)), maxW);
      if (count <= 0) return;

      const prev = manifest.wordAudio[sNum];
      const measuredBytes = scan.wordBytes && scan.wordBytes[sNum];
      let bytes;
      if (measuredBytes && measuredBytes > 0) {
        bytes = Math.round(measuredBytes);
      } else if (prev && prev.count === count && prev.bytes > 0) {
        bytes = prev.bytes;
      } else if (prev && prev.count > 0 && prev.bytes > 0) {
        bytes = Math.round((prev.bytes / prev.count) * count);
      } else {
        bytes = count * DEFAULT_WORD_AUDIO_BYTES;
      }

      nextWordAudio[sNum] = {
        count,
        bytes,
        savedAt: prev ? prev.savedAt : ts
      };
      if (!prev || prev.count !== count || Math.abs(prev.bytes - bytes) > 1024) {
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
  let activeState = null; // { task, controller, percent, receivedBytes, totalBytes, completedUnits, totalUnits, stopped }
  let isProcessingQueue = false;
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
    const urls = [];
    (content && content.ayahs ? content.ayahs : []).forEach((ayah) => {
      (ayah.words || []).forEach((w) => {
        if (!w || !w.key) return;
        const parts = String(w.key).split(':');
        if (parts.length !== 3) return;
        const [ws, wa, wp] = parts.map((n) => String(n).padStart(3, '0'));
        urls.push(`${WORD_AUDIO_BASE}/${ws}_${wa}_${wp}.mp3`);
      });
    });
    return urls;
  }

  function getWordConcurrency() {
    if (global.QuranDB && typeof global.QuranDB.getOptimalDownloadConcurrency === 'function') {
      const limits = global.QuranDB.getOptimalDownloadConcurrency();
      if (limits && limits.wordAudio) return limits.wordAudio;
    }
    return 6;
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
            return { ok: true, bytes: blob.size || DEFAULT_WORD_AUDIO_BYTES };
          }
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
            return { ok: true, bytes: DEFAULT_WORD_AUDIO_BYTES };
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
  }

  // ============================================================
  // QUEUE EXECUTION ENGINE (FIFO AUTO-QUEUE)
  // ============================================================
  async function requestPersistentStorageQuietly() {
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      try {
        await navigator.storage.persist();
        if (typeof global.updateStoragePersistenceUI === 'function') {
          global.updateStoragePersistenceUI();
        }
      } catch (e) {}
    }
  }

  async function runQueueLoop() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    requestPersistentStorageQuietly();

    try {
      const cache = 'caches' in global ? await caches.open(AUDIO_CACHE) : null;
      if (!cache) {
        showToastSafe('এই ব্রাউজারে অফলাইন ক্যাশ সমর্থিত নয়।', 'error');
        queue = [];
        return;
      }

      while (queue.length > 0) {
        const task = queue.shift();
        if (!task) break;

        const surahMeta = metaBySurah.get(task.surah) || { surah: task.surah, total_words: 1 };
        const controller = new AbortController();

        activeState = {
          task,
          controller,
          percent: 0,
          receivedBytes: 0,
          totalBytes: 0,
          completedUnits: 0,
          totalUnits: task.type === 'ayah' ? 1 : surahMeta.total_words,
          stopped: false
        };

        // Re-render queued positions & active row immediately
        renderOverviewAndActiveBar(true);
        patchTabActionButtons();
        patchSurahRow(task.type, task.surah);
        patchAllQueuedRows();

        if (task.type === 'ayah') {
          const res = await downloadSurahRecitationFile(cache, task.surah, controller.signal, (prog) => {
            if (!activeState || activeState.task.id !== task.id) return;
            activeState.receivedBytes = prog.receivedBytes || 0;
            activeState.totalBytes = prog.totalBytes || 0;
            activeState.percent = prog.percent || 0;
            emitLiveProgress(task.type, task.surah, false);
          });

          const wasStopped = !activeState || activeState.stopped || controller.signal.aborted;
          activeState = null;

          if (res.ok && !wasStopped) {
            manifest.surahAudio[task.surah] = {
              bytes: res.bytes || estimateSurahFallbackBytes(surahMeta),
              savedAt: Date.now()
            };
            saveManifestToStorage(true);
            if (task.mode === 'single' && queue.length === 0) {
              showToastSafe(`সূরা ${getSurahName(task.surah)}-এর তিলাওয়াত ডাউনলোড সম্পন্ন`, 'success');
            }
          } else if (!wasStopped && !res.ok) {
            showToastSafe(`সূরা ${getSurahName(task.surah)} ডাউনলোডে সমস্যা হয়েছে, ইন্টারনেট যাচাই করুন।`, 'error');
          }

          patchSurahRow('ayah', task.surah);
          renderOverviewAndActiveBar(true);
          patchTabActionButtons();
        } else {
          // Word-by-word audio download for this Surah (resumable!)
          let urls = [];
          try {
            urls = await getWordUrlsForSurah(task.surah);
          } catch (e) {
            urls = [];
          }

          if (controller.signal.aborted || !activeState || activeState.stopped) {
            activeState = null;
            patchSurahRow('word', task.surah);
            renderOverviewAndActiveBar(true);
            patchTabActionButtons();
            continue;
          }

          const totalWords = Math.max(urls.length, surahMeta.total_words || 1);
          activeState.totalUnits = totalWords;

          // Build set of already-cached URLs for this surah so resuming skips done words cleanly
          const sPad = String(task.surah).padStart(3, '0');
          const prefixRegex = new RegExp(`/${sPad}_\\d{3}_\\d{3}\\.mp3`);
          const cachedSet = new Set();
          try {
            const keys = await cache.keys();
            for (let i = 0; i < keys.length; i++) {
              const u = keys[i].url;
              if (prefixRegex.test(u)) cachedSet.add(u);
            }
          } catch (e) {}

          const pendingUrls = urls.filter((u) => !cachedSet.has(u));
          let doneCount = urls.length - pendingUrls.length;
          activeState.completedUnits = doneCount;
          activeState.percent = totalWords > 0 ? Math.min(99, Math.round((doneCount / totalWords) * 100)) : 0;

          // Sync existing partial count into manifest before downloading remainder
          if (doneCount > 0) {
            const prev = manifest.wordAudio[task.surah];
            const prevBytes = prev && prev.bytes > 0 ? prev.bytes : doneCount * DEFAULT_WORD_AUDIO_BYTES;
            manifest.wordAudio[task.surah] = {
              count: Math.min(doneCount, totalWords),
              bytes: prevBytes,
              savedAt: Date.now()
            };
          }
          emitLiveProgress('word', task.surah, true);

          if (pendingUrls.length > 0 && !controller.signal.aborted) {
            const concurrency = Math.min(getWordConcurrency(), pendingUrls.length);
            let cursor = 0;
            let failedCount = 0;

            const worker = async () => {
              while (cursor < pendingUrls.length) {
                if (controller.signal.aborted || !activeState || activeState.stopped) break;
                const url = pendingUrls[cursor++];
                const result = await downloadSingleWordAudio(cache, url, controller.signal);
                if (controller.signal.aborted || !activeState || activeState.stopped) break;

                if (result.ok) {
                  doneCount++;
                  const prevEntry = manifest.wordAudio[task.surah];
                  const nextBytes = (prevEntry ? prevEntry.bytes : 0) + (result.bytes || DEFAULT_WORD_AUDIO_BYTES);
                  manifest.wordAudio[task.surah] = {
                    count: Math.min(doneCount, totalWords),
                    bytes: nextBytes,
                    savedAt: Date.now()
                  };
                  saveManifestToStorage(false);
                  if (activeState && activeState.task.id === task.id) {
                    activeState.completedUnits = doneCount;
                    activeState.percent = Math.min(99, Math.round((doneCount / totalWords) * 100));
                    emitLiveProgress('word', task.surah, false);
                  }
                } else if (!result.aborted) {
                  failedCount++;
                }
              }
            };

            const workers = [];
            for (let w = 0; w < concurrency; w++) workers.push(worker());
            await Promise.all(workers);

            const wasStopped = !activeState || activeState.stopped || controller.signal.aborted;
            activeState = null;
            saveManifestToStorage(true);

            if (!wasStopped && doneCount >= urls.length && urls.length > 0) {
              if (task.mode === 'single' && queue.length === 0) {
                showToastSafe(`সূরা ${getSurahName(task.surah)}-এর সব শব্দের অডিও ডাউনলোড সম্পন্ন`, 'success');
              }
            } else if (!wasStopped && failedCount > 0) {
              showToastSafe(`সূরা ${getSurahName(task.surah)}-এর কিছু শব্দ ডাউনলোড হয়নি—আবার ট্যাপ করে বাকিটা সম্পন্ন করুন।`, 'warning');
            }
          } else {
            // Already 100% cached
            if (urls.length > 0) {
              const prev = manifest.wordAudio[task.surah];
              manifest.wordAudio[task.surah] = {
                count: urls.length,
                bytes: prev && prev.bytes > 0 ? prev.bytes : urls.length * DEFAULT_WORD_AUDIO_BYTES,
                savedAt: Date.now()
              };
              saveManifestToStorage(true);
            }
            activeState = null;
          }

          patchSurahRow('word', task.surah);
          renderOverviewAndActiveBar(true);
          patchTabActionButtons();
        }
      }
    } finally {
      activeState = null;
      isProcessingQueue = false;
      saveManifestToStorage(true);
      renderOverviewAndActiveBar(true);
      patchTabActionButtons();
      if (typeof global.updateStoragePersistenceUI === 'function') {
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
    const rowState = computeSurahRowDownloadState(surahMeta, type, manifest, activeState, queue);

    if (rowState.status === 'completed') {
      showToastSafe(`সূরা ${getSurahName(sNum)}-এর অডিও ইতিমধ্যেই ডাউনলোড করা আছে।`, 'info');
      return false;
    }
    if (rowState.status === 'downloading') {
      stopActiveTask(true);
      return false;
    }
    if (rowState.status === 'queued') {
      removeQueuedTask(type, sNum);
      return false;
    }

    const id = makeTaskId(type, sNum);
    const hadActive = Boolean(activeState);
    queue.push({ id, type, surah: sNum, mode: mode || 'single' });

    if (hadActive && (mode || 'single') === 'single') {
      showToastSafe(`সূরা ${getSurahName(sNum)} ডাউনলোড কিউতে যুক্ত হয়েছে`, 'info');
    }

    patchSurahRow(type, sNum);
    renderOverviewAndActiveBar(true);
    patchTabActionButtons();
    runQueueLoop();
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

  function stopActiveTask(showFeedback) {
    if (!activeState) return false;
    const { task, controller } = activeState;
    activeState.stopped = true;
    try {
      controller.abort();
    } catch (e) {}
    if (showFeedback) {
      const msg =
        queue.length > 0
          ? `সূরা ${getSurahName(task.surah)} থামানো হয়েছে — পরবর্তী সূরা শুরু হচ্ছে`
          : `সূরা ${getSurahName(task.surah)}-এর ডাউনলোড থামানো হয়েছে`;
      showToastSafe(msg, 'info');
    }
    return true;
  }

  function stopAll(tabTypeOnly) {
    let stoppedSomething = false;
    if (tabTypeOnly) {
      const removedTasks = queue.filter((t) => t.type === tabTypeOnly);
      queue = queue.filter((t) => t.type !== tabTypeOnly);
      if (removedTasks.length > 0) stoppedSomething = true;
      removedTasks.forEach((t) => patchSurahRow(t.type, t.surah));
      if (activeState && activeState.task.type === tabTypeOnly) {
        activeState.stopped = true;
        try { activeState.controller.abort(); } catch (e) {}
        stoppedSomething = true;
      }
    } else {
      const removedTasks = queue.slice();
      queue = [];
      if (removedTasks.length > 0) stoppedSomething = true;
      removedTasks.forEach((t) => patchSurahRow(t.type, t.surah));
      if (activeState) {
        activeState.stopped = true;
        try { activeState.controller.abort(); } catch (e) {}
        stoppedSomething = true;
      }
    }
    patchAllQueuedRows();
    renderOverviewAndActiveBar(true);
    patchTabActionButtons();
    if (stoppedSomething) {
      showToastSafe('ডাউনলোড বিরতি দেওয়া হয়েছে।', 'info');
    }
    return stoppedSomething;
  }

  function toggleBulkDownload(type) {
    const isTabBusy =
      (activeState && activeState.task.type === type) ||
      queue.some((t) => t.type === type);

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
      if (activeState && activeState.task.id === id) continue;
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

    patchAllQueuedRows();
    renderOverviewAndActiveBar(true);
    patchTabActionButtons();
    runQueueLoop();
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
    if (activeState && activeState.task.id === makeTaskId(type, sNum)) {
      stopActiveTask(false);
    }
    queue = queue.filter((t) => t.id !== makeTaskId(type, sNum));

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
    if (activeState || queue.length > 0) return false; // Don't race active downloads
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
      if (activeState || queue.length > 0) return false;

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
      const state = computeSurahRowDownloadState(surahMeta, type, manifest, activeState, queue);
      if (state.status !== 'completed') {
        handleRowPrimaryAction(type, surahMeta.surah);
      }
    });

    return li;
  }

  function handleRowPrimaryAction(type, surahNum) {
    const surahMeta = metaBySurah.get(surahNum) || { surah: surahNum, total_words: 1 };
    const state = computeSurahRowDownloadState(surahMeta, type, manifest, activeState, queue);
    if (state.status === 'downloading') {
      stopActiveTask(true);
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

    const state = computeSurahRowDownloadState(surahMeta, type, manifest, activeState, queue);
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
    const inFlight = activeState && activeState.task.type === 'ayah' ? (activeState.receivedBytes || 0) : 0;
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
      if (activeState) {
        wrap.style.display = 'flex';
        const t = activeState.task;
        const kindLabel = t.type === 'ayah' ? 'তিলাওয়াত' : 'শব্দ অডিও';
        const queueSuffix = queue.length > 0 ? ` · কিউতে আরও ${toBn(queue.length)}টি` : '';
        if (lbl) {
          lbl.textContent = `${kindLabel}: সূরা ${getSurahName(t.surah)}${queueSuffix}`;
        }
        const pVal = Math.max(0, Math.min(100, Math.round(activeState.percent || 0)));
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
    const stats = computeAudioOverviewStats(manifest, surahsMeta, 0);

    ['ayah', 'word'].forEach((type) => {
      const dlBtn = document.getElementById(type === 'ayah' ? 'dl-all-ayah' : 'dl-all-word');
      const delBtn = document.getElementById(type === 'ayah' ? 'dl-delete-all-ayah' : 'dl-delete-all-word');

      const isTabBusy =
        (activeState && activeState.task.type === type) ||
        queue.some((t) => t.type === type);

      if (dlBtn) {
        dlBtn.classList.toggle('btn-active-downloading', isTabBusy);
        if (isTabBusy) {
          const pctText =
            activeState && activeState.task.type === type
              ? ` (${toBn(Math.round(activeState.percent || 0))}%)`
              : '';
          const label = `ডাউনলোড থামান${pctText}`;
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
    const inFlight = activeState && activeState.task.type === 'ayah' ? (activeState.receivedBytes || 0) : 0;
    return {
      activeTab,
      manifest: parseAudioManifest(manifest),
      overview: computeAudioOverviewStats(manifest, surahsMeta, inFlight),
      activeTask: activeState ? { ...activeState.task, percent: activeState.percent } : null,
      queue: queue.map((t) => ({ ...t }))
    };
  }

  global.AudioDownloadCore = {
    makeTaskId,
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
