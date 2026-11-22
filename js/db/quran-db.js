/* ============================================================
   QURAN VOCABULARY APPLICATION - INDEXEDDB DATA LAYER
   Database: QuranVocabDB (v1)
   Supports:
   - 100% Offline Caching for 114 Surahs, 6,236 Ayahs, 77,000+ Words
   - Corpus Quran Morphology Summaries
   - Word Progress (SM-2 Spaced Repetition)
   - Weak Words / Mistake Tracking Deck
   - Word Bookmarks & Custom Notes
   - Daily Activity & Streak Tracking
   ============================================================ */

(function (global) {
  'use strict';

  const DB_NAME = 'QuranVocabDB';
  const DB_VERSION = 4;
  let dbPromise = null;

  // Ultra-fast In-Memory Caches
  const surahMemoryCache = new Map();
  const inFlightSurahPromises = new Map();
  const wordDetailMemoryCache = new Map();
  const surahSegmentsMemoryCache = new Map();
  let surahsMetaCache = null;

  function openDatabase() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // 1. Surahs metadata store (keyed by surah number e.g. 1, 2, ... 114)
        if (db.objectStoreNames.contains('surahs')) {
          db.deleteObjectStore('surahs');
        }
        db.createObjectStore('surahs', { keyPath: 'surah' });

        // 2. Ayahs store
        if (!db.objectStoreNames.contains('ayahs')) {
          const ayahStore = db.createObjectStore('ayahs', { keyPath: 'verse_key' });
          ayahStore.createIndex('surah', 'surah', { unique: false });
        }

        // 3. Words store
        if (!db.objectStoreNames.contains('words')) {
          const wordStore = db.createObjectStore('words', { keyPath: 'key' });
          wordStore.createIndex('surah', 'surah', { unique: false });
          wordStore.createIndex('verse_key', 'verse_key', { unique: false });
          wordStore.createIndex('root', 'root', { unique: false });
          wordStore.createIndex('arabic', 'arabic', { unique: false });
        }

        // 4. Word Morphology Summaries (from Quranic Arabic Corpus)
        if (!db.objectStoreNames.contains('word_summaries')) {
          db.createObjectStore('word_summaries', { keyPath: 'key' });
        }

        // 5. Spaced Repetition Progress (SM-2)
        if (!db.objectStoreNames.contains('word_progress')) {
          const progressStore = db.createObjectStore('word_progress', { keyPath: 'word_id' });
          progressStore.createIndex('status', 'status', { unique: false });
          progressStore.createIndex('nextReviewDate', 'nextReviewDate', { unique: false });
        }

        // 6. Weak Words / Mistake Deck
        if (!db.objectStoreNames.contains('weak_words')) {
          const weakStore = db.createObjectStore('weak_words', { keyPath: 'word_id' });
          weakStore.createIndex('mistakeCount', 'mistakeCount', { unique: false });
          weakStore.createIndex('lastMistakeAt', 'lastMistakeAt', { unique: false });
        }

        // 7. Bookmarks
        if (!db.objectStoreNames.contains('bookmarks')) {
          const bmStore = db.createObjectStore('bookmarks', { keyPath: 'word_id' });
          bmStore.createIndex('addedAt', 'addedAt', { unique: false });
        }

        // 8. Custom Notes
        if (!db.objectStoreNames.contains('notes')) {
          db.createObjectStore('notes', { keyPath: 'word_id' });
        }

        // 9. Daily Activity & Streaks
        if (!db.objectStoreNames.contains('activity')) {
          db.createObjectStore('activity', { keyPath: 'date' });
        }

        // 10. Generic Lookup Cache (e.g. same-root.json)
        if (!db.objectStoreNames.contains('lookup')) {
          db.createObjectStore('lookup', { keyPath: 'id' });
        }

        // 11. Reading & Listening History (per local date + surah)
        if (!db.objectStoreNames.contains('reading_history')) {
          const histStore = db.createObjectStore('reading_history', { keyPath: 'id' });
          histStore.createIndex('activity_date', 'activity_date', { unique: false });
          histStore.createIndex('surah', 'surah', { unique: false });
        }

        // v4 migration: repair the 4 ayahs where a compound Quranic token (e.g. بَعۡدَ مَا / إِلۡ يَاسِينَ)
        // was split into 2 Arabic tokens while meanings/roots/summaries/audio stayed at the true token count.
        if (event.oldVersion > 0 && event.oldVersion < 4 && db.objectStoreNames.contains('words')) {
          try {
            const tx = event.target.transaction;
            const wordStore = tx.objectStore('words');
            const verseIdx = wordStore.index('verse_key');
            const repairs = [
              { verseKey: '2:181', mergePos: 3, oldLen: 14 },
              { verseKey: '8:6', mergePos: 4, oldLen: 12 },
              { verseKey: '13:37', mergePos: 8, oldLen: 20 },
              { verseKey: '37:130', mergePos: 3, oldLen: 4 }
            ];
            for (const r of repairs) {
              const req = verseIdx.getAll(IDBKeyRange.only(r.verseKey));
              req.onsuccess = () => {
                const list = (req.result || []).sort((a, b) => a.position - b.position);
                if (list.length !== r.oldLen) return;
                const tail = list[list.length - 1];
                if (tail && tail.meaning_bn) return;
                const mIdx = r.mergePos - 1;
                list[mIdx].arabic = `${list[mIdx].arabic} ${list[mIdx + 1].arabic}`;
                for (let i = mIdx + 1; i < list.length - 1; i++) {
                  list[i].arabic = list[i + 1].arabic;
                }
                for (let i = mIdx; i < list.length - 1; i++) {
                  wordStore.put(list[i]);
                }
                if (tail && tail.key) {
                  wordStore.delete(tail.key);
                }
              };
            }
          } catch (migErr) {
            console.warn('[QuranDB] v4 compound-word repair warning:', migErr);
          }
        }
      };

      request.onsuccess = (event) => {
        const db = event.target.result;
        db.onversionchange = () => {
          try { db.close(); } catch (e) {}
          dbPromise = null;
        };
        resolve(db);
      };
      request.onblocked = () => {
        console.warn('[QuranDB] Database upgrade waiting for another tab to close.');
      };
      request.onerror = (event) => reject(event.target.error);
    });

    return dbPromise;
  }

  // Helper for generic transaction execution
  async function withStore(storeName, mode, callback) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;

      try {
        result = callback(store, tx);
      } catch (err) {
        reject(err);
        return;
      }

      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  // Promisify IndexedDB Request
  function wrapRequest(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // ============================================================
  // SURAH METADATA API
  // ============================================================

  function normalizeSurahRecord(item) {
    if (!item) return null;
    const surahNum = parseInt(item.surah || item.number, 10);
    const rawType = String(item.type || item.revelation_type || item.revelation_place || '').toLowerCase();
    const isMeccan = rawType === 'meccan' || rawType === 'makkah' || rawType === 'makki';
    const revelationType = isMeccan ? 'makki' : 'madani';
    const revelation_bn = isMeccan ? 'মাক্কী' : 'মাদানী';

    return {
      ...item,
      surah: surahNum,
      revelationType: revelationType,
      revelation_place: isMeccan ? 'makkah' : 'madinah',
      revelation_bn: revelation_bn,
      name_bn: item.name_bn || item.name_translation_bn || '',
      name_bn_script: item.name_bn_script || item.name_transliteration || ''
    };
  }

  async function getSurahsMeta() {
    if (surahsMetaCache && surahsMetaCache.length > 0) {
      return surahsMetaCache;
    }

    let metaList = null;

    // 1. Instant synchronous return from window.SURAHS_META (seed IndexedDB in background without blocking UI)
    if (typeof window !== 'undefined' && Array.isArray(window.SURAHS_META) && window.SURAHS_META.length > 0) {
      const normalizedList = window.SURAHS_META.map(normalizeSurahRecord);
      surahsMetaCache = normalizedList;
      openDatabase()
        .then(async (db) => {
          const count = await wrapRequest(db.transaction('surahs', 'readonly').objectStore('surahs').count());
          if (count < normalizedList.length) {
            const tx = db.transaction('surahs', 'readwrite');
            const store = tx.objectStore('surahs');
            for (const item of normalizedList) {
              store.put(item);
            }
          }
        })
        .catch(() => {});
      return normalizedList;
    }

    // 2. If not preloaded, fetch data/surahs-meta.json
    if (!metaList) {
      try {
        const res = await fetch('data/surahs-meta.json');
        if (res.ok) {
          metaList = await res.json();
        }
      } catch (err) {
        console.warn('[QuranDB] Failed to fetch surahs-meta.json:', err);
      }
    }

    // 3. Try to read from or seed to IndexedDB
    try {
      const db = await openDatabase();
      const countReq = db.transaction('surahs', 'readonly').objectStore('surahs').count();
      const count = await wrapRequest(countReq);

      if (metaList && metaList.length > 0) {
        const normalizedList = metaList.map(normalizeSurahRecord);
        surahsMetaCache = normalizedList;
        if (count < normalizedList.length) {
          const tx = db.transaction('surahs', 'readwrite');
          const store = tx.objectStore('surahs');
          for (const item of normalizedList) {
            store.put(item);
          }
          await new Promise((resolve) => {
            tx.oncomplete = resolve;
            tx.onerror = () => resolve();
          });
        }
        return normalizedList;
      }

      if (count > 0) {
        const getAllReq = db.transaction('surahs', 'readonly').objectStore('surahs').getAll();
        const list = await wrapRequest(getAllReq);
        const sorted = list.sort((a, b) => (a.surah || a.number) - (b.surah || b.number));
        surahsMetaCache = sorted.map(normalizeSurahRecord);
        return surahsMetaCache;
      }
    } catch (dbErr) {
      console.warn('[QuranDB] IndexedDB error in getSurahsMeta:', dbErr);
      if (metaList) {
        surahsMetaCache = metaList.map(normalizeSurahRecord);
        return surahsMetaCache;
      }
    }

    surahsMetaCache = (metaList || []).map(normalizeSurahRecord);
    return surahsMetaCache;
  }

  async function getSurahMeta(surahNumber) {
    const num = parseInt(surahNumber, 10);
    if (!num) return null;

    if (surahsMetaCache && surahsMetaCache.length > 0) {
      const found = surahsMetaCache.find((s) => s.surah === num || s.number === num);
      if (found) return found;
    }

    const list = await getSurahsMeta();
    const found = list.find((s) => s.surah === num || s.number === num);
    return normalizeSurahRecord(found);
  }

  // ============================================================
  // SURAH CONTENT & WORDS API
  // ============================================================

  async function isSurahLoaded(surahNumber) {
    const num = parseInt(surahNumber, 10);
    const db = await openDatabase();
    const tx = db.transaction('words', 'readonly');
    const index = tx.objectStore('words').index('surah');
    const countReq = index.count(IDBKeyRange.only(num));
    const count = await wrapRequest(countReq);
    return count > 0;
  }

  async function getSurahFromIndexedDB(num, db) {
    const tx = db.transaction(['ayahs', 'words'], 'readonly');
    const ayahIndex = tx.objectStore('ayahs').index('surah');
    const ayahsReq = ayahIndex.getAll(IDBKeyRange.only(num));
    const ayahs = await wrapRequest(ayahsReq);

    const wordIndex = tx.objectStore('words').index('surah');
    const wordsReq = wordIndex.getAll(IDBKeyRange.only(num));
    const words = await wrapRequest(wordsReq);

    // Group words into ayahs
    const wordsByVerse = new Map();
    for (const w of words) {
      if (!wordsByVerse.has(w.verse_key)) wordsByVerse.set(w.verse_key, []);
      wordsByVerse.get(w.verse_key).push(w);
    }

    for (const a of ayahs) {
      const verseWords = wordsByVerse.get(a.verse_key) || [];
      verseWords.sort((w1, w2) => w1.position - w2.position);
      a.words = verseWords;
    }

    ayahs.sort((a1, a2) => a1.ayah - a2.ayah);

    return {
      surah: num,
      total_ayahs: ayahs.length,
      ayahs: ayahs
    };
  }

  async function saveSurahToIndexedDB(num, contentData, db) {
    let summariesData = null;
    try {
      const sumRes = await fetch(`data/word-summaries/${num}.json`);
      if (sumRes.ok) {
        const json = await sumRes.json();
        summariesData = json.data || json;
      }
    } catch (e) {
      // Optional morphology fallback
    }

    const tx = db.transaction(['ayahs', 'words', 'word_summaries'], 'readwrite');
    const ayahStore = tx.objectStore('ayahs');
    const wordStore = tx.objectStore('words');
    const summaryStore = tx.objectStore('word_summaries');

    for (const a of contentData.ayahs || []) {
      ayahStore.put({
        verse_key: a.verse_key,
        surah: a.surah,
        ayah: a.ayah,
        arabic: a.arabic,
        translation_bn: a.translation_bn
      });

      for (const w of a.words || []) {
        wordStore.put({
          key: w.key,
          surah: a.surah,
          ayah: a.ayah,
          verse_key: a.verse_key,
          position: w.position,
          arabic: w.arabic,
          meaning_bn: w.meaning_bn,
          root: w.root || null,
          word_type: w.word_type || (w.is_verb ? 'VERB' : 'NOUN'),
          is_verb: Boolean(w.is_verb)
        });
      }
    }

    if (summariesData) {
      for (const [key, text] of Object.entries(summariesData)) {
        summaryStore.put({ key, summary: text });
      }
    }

    return new Promise((resolve) => {
      tx.oncomplete = resolve;
      tx.onerror = () => resolve();
    });
  }

  async function loadSurah(surahNumber) {
    const num = parseInt(surahNumber, 10);
    if (!num) return null;

    // 1. Instant RAM Cache hit (0 ms)
    if (surahMemoryCache.has(num)) {
      return surahMemoryCache.get(num);
    }

    // 2. In-flight Promise deduplication (prevents parallel identical fetches)
    if (inFlightSurahPromises.has(num)) {
      return inFlightSurahPromises.get(num);
    }

    const loadPromise = (async () => {
      try {
        const db = await openDatabase();

        // 3. Fast IndexedDB check (if previously stored, load instantly from disk)
        const loaded = await isSurahLoaded(num);
        if (loaded) {
          try {
            const idbData = await getSurahFromIndexedDB(num, db);
            if (idbData && Array.isArray(idbData.ayahs) && idbData.ayahs.length > 0) {
              surahMemoryCache.set(num, idbData);
              return idbData;
            }
          } catch (idbErr) {
            console.warn('[QuranDB] Error reading surah from IndexedDB, falling back to fetch:', idbErr);
          }
        }

        // 4. Network fetch when not yet cached in IndexedDB
        const contentRes = await fetch(`data/surah-content/${num}.json`);
        if (!contentRes.ok) throw new Error(`Surah ${num} content not found`);
        const contentData = await contentRes.json();
        surahMemoryCache.set(num, contentData);

        // Update IndexedDB asynchronously in background without blocking the UI
        if (!loaded) {
          saveSurahToIndexedDB(num, contentData, db).catch((err) => {
            console.warn('[QuranDB] Background cache error:', err);
          });
        }

        return contentData;
      } catch (err) {
        console.error(`[QuranDB] Failed to load Surah ${num}:`, err);
        throw err;
      } finally {
        inFlightSurahPromises.delete(num);
      }
    })();

    inFlightSurahPromises.set(num, loadPromise);
    return loadPromise;
  }

  // ============================================================
  // BACKGROUND IDLE PRE-CACHE SYSTEM
  // ============================================================
  let isPrecacheRunning = false;

  async function startIdlePrecache() {
    if (isPrecacheRunning) return;
    if (typeof window === 'undefined') return;
    if (!window.QURAN_APP_CONFIG?.ENABLE_BACKGROUND_PRECACHE) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    isPrecacheRunning = true;
    const delay = window.QURAN_APP_CONFIG?.PRECACHE_IDLE_DELAY_MS || 3000;

    const runIdleTask = async () => {
      try {
        const meta = await getSurahsMeta();
        for (let i = 0; i < meta.length; i++) {
          if (!window.QURAN_APP_CONFIG?.ENABLE_BACKGROUND_PRECACHE) break;
          if (typeof navigator !== 'undefined' && !navigator.onLine) break;

          const sNum = meta[i].surah;
          const loaded = await isSurahLoaded(sNum);
          if (!loaded) {
            try {
              // Load single surah and save into IndexedDB
              const res = await fetch(`data/surah-content/${sNum}.json`);
              if (res.ok) {
                const data = await res.json();
                const db = await openDatabase();
                await saveSurahToIndexedDB(sNum, data, db);
              }
            } catch (err) {
              // Ignore background errors
            }
            // Gentle delay between background pre-cache requests
            await new Promise((r) => setTimeout(r, delay));
          }
        }
      } catch (err) {
        console.warn('[QuranDB] Background pre-cache notice:', err);
      } finally {
        isPrecacheRunning = false;
      }
    };

    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => runIdleTask(), { timeout: 6000 });
    } else {
      setTimeout(runIdleTask, 4000);
    }
  }

  // Auto-schedule background precache after initial app load
  if (typeof window !== 'undefined') {
    if (document.readyState === 'complete') {
      setTimeout(startIdlePrecache, 4000);
    } else {
      window.addEventListener('load', () => setTimeout(startIdlePrecache, 4000));
    }
  }

  // Get full details of a single word including its ayah context and morphology summary
  async function getWordDetail(wordKey) {
    if (!wordKey) return null;

    if (wordDetailMemoryCache.has(wordKey)) {
      return wordDetailMemoryCache.get(wordKey);
    }

    const parts = wordKey.split(':');
    const surahNum = parseInt(parts[0], 10);
    const ayahNum = parseInt(parts[1], 10);
    const pos = parseInt(parts[2], 10);
    const verseKey = `${parts[0]}:${parts[1]}`;

    // Fast resolution: Ensure Surah is in memory cache
    const surahData = await loadSurah(surahNum);
    let memoryWord = null;
    let memoryAyah = null;

    if (surahData && Array.isArray(surahData.ayahs)) {
      memoryAyah = surahData.ayahs.find((a) => a.ayah === ayahNum);
      if (memoryAyah && Array.isArray(memoryAyah.words)) {
        memoryWord = memoryAyah.words.find((w) => w.key === wordKey || w.position === pos);
      }
    }

    const db = await openDatabase();
    const tx = db.transaction(['word_summaries', 'bookmarks', 'notes', 'word_progress', 'weak_words'], 'readonly');

    const sumReq = tx.objectStore('word_summaries').get(wordKey);
    const bmReq = tx.objectStore('bookmarks').get(wordKey);
    const noteReq = tx.objectStore('notes').get(wordKey);
    const progReq = tx.objectStore('word_progress').get(wordKey);
    const weakReq = tx.objectStore('weak_words').get(wordKey);

    const [sumRecord, bmRecord, noteRecord, progRecord, weakRecord] = await Promise.all([
      wrapRequest(sumReq),
      wrapRequest(bmReq),
      wrapRequest(noteReq),
      wrapRequest(progReq),
      wrapRequest(weakReq)
    ]);

    let resolvedWord = memoryWord;
    if (!resolvedWord) {
      try {
        const wtx = db.transaction('words', 'readonly');
        resolvedWord = await wrapRequest(wtx.objectStore('words').get(wordKey));
      } catch (e) {}
    }

    if (!resolvedWord) return null;

    const detail = {
      ...resolvedWord,
      surah: resolvedWord.surah || surahNum,
      ayah: resolvedWord.ayah || ayahNum,
      position: resolvedWord.position || pos,
      ayah_arabic: memoryAyah ? memoryAyah.arabic : '',
      ayah_translation_bn: memoryAyah ? memoryAyah.translation_bn : '',
      morphology_summary: sumRecord ? sumRecord.summary : null,
      is_bookmarked: Boolean(bmRecord),
      user_note: noteRecord ? noteRecord.note : '',
      progress: progRecord || { status: 'new', repetitions: 0, interval: 1, easeFactor: 2.5 },
      is_weak: Boolean(weakRecord),
      mistake_count: weakRecord ? weakRecord.mistakeCount : 0
    };

    wordDetailMemoryCache.set(wordKey, detail);
    return detail;
  }

  // ============================================================
  // ROOT & EXACT-WORD CONCORDANCE LOOKUP API
  // ============================================================

  let sameRootCache = null;
  let sameRootPromise = null;
  let exactWordCache = null;
  let exactWordPromise = null;

  function normalizeExactArabicKey(arabic) {
    if (!arabic) return '';
    return String(arabic)
      .replace(/[\u06D6-\u06DC\u06DE\u06E9]/g, '')
      .trim();
  }

  async function getSameRootConcordance() {
    if (sameRootCache) return sameRootCache;
    if (sameRootPromise) return sameRootPromise;

    sameRootPromise = (async () => {
      try {
        const db = await openDatabase();
        const req = db.transaction('lookup', 'readonly').objectStore('lookup').get('same-root');
        const cached = await wrapRequest(req);
        if (cached && cached.data) {
          sameRootCache = cached.data;
          return sameRootCache;
        }

        const res = await fetch('data/lookup/same-root.json');
        if (res.ok) {
          const data = await res.json();
          sameRootCache = data;
          const tx = db.transaction('lookup', 'readwrite');
          tx.objectStore('lookup').put({ id: 'same-root', data });
          return data;
        }
      } catch (e) {
        console.warn('[QuranDB] Could not load same-root.json:', e);
      } finally {
        sameRootPromise = null;
      }
      return {};
    })();

    return sameRootPromise;
  }

  async function getExactWordConcordance() {
    if (exactWordCache) return exactWordCache;
    if (exactWordPromise) return exactWordPromise;

    exactWordPromise = (async () => {
      try {
        const db = await openDatabase();
        const req = db.transaction('lookup', 'readonly').objectStore('lookup').get('exact-word');
        const cached = await wrapRequest(req);
        if (cached && cached.data) {
          exactWordCache = cached.data;
          return exactWordCache;
        }

        const res = await fetch('data/lookup/exact-word.json');
        if (res.ok) {
          const data = await res.json();
          exactWordCache = data;
          const tx = db.transaction('lookup', 'readwrite');
          tx.objectStore('lookup').put({ id: 'exact-word', data });
          return data;
        }
      } catch (e) {
        console.warn('[QuranDB] Could not load exact-word.json:', e);
      } finally {
        exactWordPromise = null;
      }
      return {};
    })();

    return exactWordPromise;
  }

  async function getWordsByRoot(root) {
    if (!root) return [];
    const concordance = await getSameRootConcordance();
    const wordKeys = concordance[root] || [];
    return wordKeys;
  }

  function getExactWordOccurrenceCountSync(arabic, concordance) {
    if (!arabic || typeof arabic !== 'string') return 0;
    const trimmed = arabic.trim();
    if (!trimmed) return 0;
    if (!concordance || typeof concordance !== 'object') return 1;

    const normalized = normalizeExactArabicKey(trimmed);
    if (Array.isArray(concordance[trimmed]) && concordance[trimmed].length > 0) {
      return concordance[trimmed].length;
    }
    if (normalized && Array.isArray(concordance[normalized]) && concordance[normalized].length > 0) {
      return concordance[normalized].length;
    }
    return 1;
  }

  async function getExactWordOccurrenceCount(arabic) {
    if (!arabic) return 0;
    const concordance = await getExactWordConcordance();
    return getExactWordOccurrenceCountSync(arabic, concordance);
  }

  async function getGlobalFrequentQuizWords(limit = 10) {
    const [concordance, progressMap] = await Promise.all([
      getExactWordConcordance(),
      getAllWordProgressMap()
    ]);

    if (!concordance || typeof concordance !== 'object') {
      return { words: [], distractorPool: [] };
    }

    const ranked = [];
    for (const [arabic, keys] of Object.entries(concordance)) {
      if (!arabic || !Array.isArray(keys) || keys.length === 0) continue;
      const firstKey = keys[0];
      const parts = typeof firstKey === 'string' ? firstKey.split(':').map((n) => parseInt(n, 10)) : [];
      if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) continue;

      let isLearned = false;
      if (progressMap) {
        for (const k of keys) {
          const rec = progressMap[k];
          if (rec && Number(rec.repetitions || 0) >= 1 && Number(rec.correctCount || 0) >= 1) {
            isLearned = true;
            break;
          }
        }
      }

      ranked.push({
        arabic,
        firstKey,
        occurrenceCount: keys.length,
        surah: parts[0],
        ayah: parts[1],
        position: parts[2],
        isLearned
      });
    }

    ranked.sort((a, b) => {
      if (b.occurrenceCount !== a.occurrenceCount) {
        return b.occurrenceCount - a.occurrenceCount;
      }
      if (a.surah !== b.surah) return a.surah - b.surah;
      if (a.ayah !== b.ayah) return a.ayah - b.ayah;
      return a.position - b.position;
    });

    const unlearned = ranked.filter((item) => !item.isLearned);
    const learned = ranked.filter((item) => item.isLearned);
    const candidateTarget = Math.max(limit * 2 + 12, 32);
    const candidates = [...unlearned, ...learned].slice(0, candidateTarget);

    const surahsToLoad = new Set([1, 2]);
    for (const cand of candidates) {
      surahsToLoad.add(cand.surah);
    }

    const surahDataMap = new Map();
    const surahList = Array.from(surahsToLoad);
    const CONCURRENCY = 6;
    for (let i = 0; i < surahList.length; i += CONCURRENCY) {
      const chunk = surahList.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map(async (sNum) => {
          try {
            const sData = await loadSurah(sNum);
            if (sData) surahDataMap.set(sNum, sData);
          } catch (e) {}
        })
      );
    }

    const ayahLookup = new Map();
    const distractorPool = [];
    for (const [sNum, sData] of surahDataMap.entries()) {
      const aMap = new Map();
      for (const ayahObj of (sData.ayahs || [])) {
        aMap.set(parseInt(ayahObj.ayah, 10), ayahObj);
        for (const w of (ayahObj.words || [])) {
          if (w.meaning_bn && w.meaning_bn.trim()) {
            distractorPool.push({
              ...w,
              surah: sNum,
              ayah: ayahObj.ayah
            });
          }
        }
      }
      ayahLookup.set(sNum, aMap);
    }

    const words = [];
    for (const cand of candidates) {
      if (words.length >= limit) break;
      const aMap = ayahLookup.get(cand.surah);
      const ayahObj = aMap ? aMap.get(cand.ayah) : null;
      const wordObj = ayahObj && Array.isArray(ayahObj.words)
        ? ayahObj.words.find((w) => w.key === cand.firstKey || w.position === cand.position)
        : null;

      if (!wordObj || !wordObj.meaning_bn || !wordObj.meaning_bn.trim()) continue;

      words.push({
        ...wordObj,
        key: wordObj.key || cand.firstKey,
        surah: cand.surah,
        ayah: cand.ayah,
        position: cand.position,
        verse_key: ayahObj.verse_key || `${cand.surah}:${cand.ayah}`,
        ayah_arabic: ayahObj.arabic || '',
        ayah_translation_bn: ayahObj.translation_bn || '',
        occurrenceCount: cand.occurrenceCount,
        isLearned: cand.isLearned
      });
    }

    return { words, distractorPool };
  }

  async function getWordsByExactArabic(arabic, currentWordKey) {
    if (!arabic && !currentWordKey) return [];
    const concordance = await getExactWordConcordance();
    const trimmed = (arabic || '').trim();
    const normalized = normalizeExactArabicKey(trimmed);

    let raw = [];
    if (trimmed && Array.isArray(concordance[trimmed])) {
      raw = concordance[trimmed];
    } else if (normalized && Array.isArray(concordance[normalized])) {
      raw = concordance[normalized];
    }

    const seen = new Set();
    const deduped = [];
    for (const k of raw) {
      if (k && !seen.has(k)) {
        seen.add(k);
        deduped.push(k);
      }
    }

    if (deduped.length === 0 && currentWordKey) {
      return [currentWordKey];
    }
    if (currentWordKey && !seen.has(currentWordKey)) {
      deduped.unshift(currentWordKey);
    }
    return deduped;
  }

  /**
   * Batch-resolves an array of wordKeys ("surah:ayah:word") into
   * { key, surah, ayah, position, arabic, meaning_bn, root } objects
   * by grouping requests per unique surah and leveraging surahMemoryCache / IndexedDB.
   */
  async function getOccurrencesDetails(wordKeys) {
    if (!Array.isArray(wordKeys) || wordKeys.length === 0) return [];

    const resultsMap = new Map();
    const surahNeededMap = new Map();

    for (const key of wordKeys) {
      if (!key || typeof key !== 'string') continue;
      const parts = key.split(':');
      if (parts.length !== 3) continue;
      const sNum = parseInt(parts[0], 10);
      const aNum = parseInt(parts[1], 10);
      const wNum = parseInt(parts[2], 10);
      if (!sNum || !aNum || !wNum) continue;

      if (wordDetailMemoryCache.has(key)) {
        const cached = wordDetailMemoryCache.get(key);
        resultsMap.set(key, {
          key,
          surah: sNum,
          ayah: aNum,
          position: wNum,
          arabic: cached.arabic || '',
          meaning_bn: cached.meaning_bn || '',
          root: cached.root || null
        });
        continue;
      }

      if (!surahNeededMap.has(sNum)) {
        surahNeededMap.set(sNum, []);
      }
      surahNeededMap.get(sNum).push({ key, surah: sNum, ayah: aNum, position: wNum });
    }

    const surahEntries = Array.from(surahNeededMap.entries());
    const CONCURRENCY = 6;
    for (let i = 0; i < surahEntries.length; i += CONCURRENCY) {
      const chunk = surahEntries.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map(async ([sNum, items]) => {
          try {
            const surahData = await loadSurah(sNum);
            if (!surahData || !Array.isArray(surahData.ayahs)) return;

            const ayahMap = new Map();
            for (const a of surahData.ayahs) {
              ayahMap.set(a.ayah, a);
            }

            for (const item of items) {
              const ayahObj = ayahMap.get(item.ayah);
              const wordObj = ayahObj && Array.isArray(ayahObj.words)
                ? ayahObj.words.find((w) => w.key === item.key || w.position === item.position)
                : null;
              if (wordObj) {
                resultsMap.set(item.key, {
                  key: item.key,
                  surah: item.surah,
                  ayah: item.ayah,
                  position: item.position,
                  arabic: wordObj.arabic || '',
                  meaning_bn: wordObj.meaning_bn || '',
                  root: wordObj.root || null
                });
              }
            }
          } catch (e) {
            console.warn(`[QuranDB] Failed to resolve occurrences in surah ${sNum}:`, e);
          }
        })
      );
    }

    return wordKeys
      .map((k) => resultsMap.get(k))
      .filter(Boolean);
  }

  // ============================================================
  // PRACTICE & SPACED REPETITION (SM-2) API
  // ============================================================

  /**
   * SuperMemo SM-2 Spaced Repetition Algorithm
   * grade: 0-5 (0-2: Fail/Hard, 3: Pass with effort, 4: Good, 5: Perfect/Easy)
   */
  async function recordSpacedRepetition(wordKey, grade, wordMeta = {}) {
    const db = await openDatabase();
    const today = new Date().toISOString().slice(0, 10);

    const tx = db.transaction(['word_progress', 'weak_words', 'activity'], 'readwrite');
    const progStore = tx.objectStore('word_progress');
    const weakStore = tx.objectStore('weak_words');
    const actStore = tx.objectStore('activity');

    const curProgReq = progStore.get(wordKey);
    const curProg = (await wrapRequest(curProgReq)) || {
      word_id: wordKey,
      status: 'new',
      repetitions: 0,
      interval: 1,
      easeFactor: 2.5,
      lastReviewed: null,
      nextReviewDate: null
    };

    let { repetitions, interval, easeFactor } = curProg;
    let correctCount = Math.max(0, Number(curProg.correctCount || 0));
    let wrongCount = Math.max(0, Number(curProg.wrongCount || 0));
    const isSuccess = grade >= 3;

    if (isSuccess) {
      correctCount += 1;
      if (repetitions === 0) {
        interval = 1;
      } else if (repetitions === 1) {
        interval = 6;
      } else {
        interval = Math.round(interval * easeFactor);
      }
      repetitions += 1;
    } else {
      wrongCount += 1;
      repetitions = 0;
      interval = 1;
    }

    // Update ease factor: EF' = EF + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02))
    easeFactor = easeFactor + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02));
    if (easeFactor < 1.3) easeFactor = 1.3;

    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + interval);

    const newStatus = repetitions >= 5 ? 'mastered' : repetitions >= 2 ? 'review' : 'learning';
    const nowMs = Date.now();
    const boxVal = newStatus === 'mastered' ? 5 : Math.min(repetitions + 1, 5);

    const updatedProgressRec = {
      word_id: wordKey,
      status: newStatus,
      box: boxVal,
      repetitions,
      interval,
      intervalDays: interval,
      easeFactor,
      correctCount,
      wrongCount,
      lastGrade: grade,
      lastReviewed: nowMs,
      nextReview: nextDate.getTime(),
      nextReviewDate: nextDate.toISOString().slice(0, 10)
    };

    const rememberResult = computeRememberPoint(updatedProgressRec, null, nowMs);
    updatedProgressRec.rememberScore = rememberResult.score;

    progStore.put(updatedProgressRec);

    if (global.StorageManager) {
      try {
        const localP = global.StorageManager.get('progress-v1', {});
        localP[wordKey] = {
          word_id: wordKey,
          box: boxVal,
          repetitions,
          intervalDays: interval,
          easeFactor,
          nextReview: nextDate.getTime(),
          lastReviewed: nowMs,
          status: newStatus,
          correctCount,
          wrongCount,
          lastGrade: grade,
          rememberScore: rememberResult.score
        };
        global.StorageManager.set('progress-v1', localP);
      } catch (e) {
        console.warn('[QuranDB] StorageManager sync warning:', e);
      }
    }

    // Update Weak Words Deck
    const curWeakReq = weakStore.get(wordKey);
    const curWeak = await wrapRequest(curWeakReq);

    if (!isSuccess) {
      const mistakeCount = curWeak ? curWeak.mistakeCount + 1 : 1;
      weakStore.put({
        word_id: wordKey,
        mistakeCount,
        consecutiveCorrect: 0,
        lastMistakeAt: Date.now(),
        arabic: wordMeta.arabic || (curWeak && curWeak.arabic) || '',
        meaning_bn: wordMeta.meaning_bn || (curWeak && curWeak.meaning_bn) || '',
        root: wordMeta.root || (curWeak && curWeak.root) || '',
        verse_key: wordMeta.verse_key || (curWeak && curWeak.verse_key) || ''
      });
    } else if (curWeak) {
      const consecutive = (curWeak.consecutiveCorrect || 0) + 1;
      if (consecutive >= 2) {
        // Successfully rehabilitated! Remove from weak words
        weakStore.delete(wordKey);
      } else {
        weakStore.put({
          ...curWeak,
          consecutiveCorrect: consecutive
        });
      }
    }

    // Update Activity & Streak
    const actReq = actStore.get(today);
    const curAct = (await wrapRequest(actReq)) || {
      date: today,
      wordsLearnedCount: 0,
      reviewsCount: 0,
      lastActiveAt: Date.now()
    };

    curAct.reviewsCount += 1;
    if (isSuccess && curProg.repetitions === 0) {
      curAct.wordsLearnedCount += 1;
    }
    curAct.lastActiveAt = Date.now();
    actStore.put(curAct);

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });

    if (wordDetailMemoryCache.has(wordKey)) {
      wordDetailMemoryCache.delete(wordKey);
    }

    scheduleCloudAccountSync();

    return {
      repetitions,
      interval,
      easeFactor,
      status: newStatus,
      rememberScore: rememberResult.score,
      correctCount,
      wrongCount
    };
  }

  let cloudSyncTimer = null;
  function scheduleCloudAccountSync() {
    if (!global.SupabaseSync || typeof global.SupabaseSync.getUser !== 'function') return;
    if (!global.SupabaseSync.getUser()) return;
    clearTimeout(cloudSyncTimer);
    cloudSyncTimer = setTimeout(() => {
      try {
        if (typeof global.SupabaseSync.syncToCloud === 'function') {
          global.SupabaseSync.syncToCloud();
        }
      } catch (e) {}
    }, 600);
  }

  function clampNum(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function computeRememberPoint(progressRec, weakRec, nowMs = Date.now()) {
    const src = progressRec || {};
    const repetitions = Math.max(0, Number(src.repetitions ?? 0) || 0);
    const intervalDays = Math.max(
      1,
      Number(src.intervalDays ?? src.interval_days ?? src.interval ?? 1) || 1
    );
    const rawEase = Number(src.easeFactor ?? src.ease_factor ?? 2.5);
    const easeFactor = clampNum(isNaN(rawEase) ? 2.5 : rawEase, 1.3, 3.0);
    const lastReviewed = Math.max(0, Number(src.lastReviewed ?? src.last_reviewed ?? 0) || 0);
    const correctCount = Math.max(0, Number(src.correctCount ?? 0) || 0);
    const wrongCount = Math.max(0, Number(src.wrongCount ?? 0) || 0);

    const mistakeCount = Math.max(0, Number(weakRec?.mistakeCount ?? 0) || 0);
    const consecutiveCorrect = Math.max(0, Number(weakRec?.consecutiveCorrect ?? 0) || 0);

    const hasHistory =
      repetitions > 0 || lastReviewed > 0 || correctCount > 0 || wrongCount > 0;

    if (!hasHistory) {
      if (mistakeCount > 0) {
        const weakScore = Math.max(5, 22 - mistakeCount * 5);
        return { score: weakScore, tier: 'weak', labelBn: 'দুর্বল', retention: 0.4, baseStrength: weakScore };
      }
      return { score: 0, tier: 'new', labelBn: 'নতুন', retention: 0, baseStrength: 0 };
    }

    const repComponent = 1 - Math.exp(-0.55 * repetitions);
    const intervalComponent = Math.min(1, Math.log1p(intervalDays) / Math.log1p(60));
    const easeNorm = clampNum((easeFactor - 1.3) / (2.7 - 1.3), 0, 1);

    const totalAttempts = correctCount + wrongCount;
    const combinedEase =
      totalAttempts > 0
        ? 0.5 * easeNorm + 0.5 * ((correctCount + 1) / (totalAttempts + 2))
        : easeNorm;

    const baseStrength =
      repetitions === 0
        ? 18 + 20 * combinedEase
        : 34 + 66 * (0.45 * repComponent + 0.35 * intervalComponent + 0.2 * combinedEase);

    const elapsedMs = lastReviewed > 0 ? Math.max(0, nowMs - lastReviewed) : 0;
    const daysSince = elapsedMs / 86400000;
    const stability = Math.max(1, intervalDays);
    const retention = clampNum(Math.exp(-0.10536051565782628 * (daysSince / stability)), 0.3, 1.0);

    const effectiveMistakes = Math.max(0, mistakeCount - consecutiveCorrect * 0.5);
    const penalty = Math.min(25, effectiveMistakes * 8);
    const score = Math.round(clampNum(baseStrength * retention - penalty, 0, 100));

    let tier = 'learning';
    let labelBn = 'চর্চাধীন';
    if (score === 0) {
      tier = 'new';
      labelBn = 'নতুন';
    } else if (score < 40) {
      tier = 'weak';
      labelBn = 'দুর্বল';
    } else if (score < 70) {
      tier = 'learning';
      labelBn = 'চর্চাধীন';
    } else if (score < 90) {
      tier = 'strong';
      labelBn = 'মজবুত';
    } else {
      tier = 'mastered';
      labelBn = 'আয়ত্ত';
    }

    return {
      score,
      tier,
      labelBn,
      retention: Number(retention.toFixed(3)),
      baseStrength: Number(baseStrength.toFixed(2))
    };
  }

  async function getAllWordProgressMap() {
    const map = {};
    try {
      const db = await openDatabase();
      const tx = db.transaction('word_progress', 'readonly');
      const list = await wrapRequest(tx.objectStore('word_progress').getAll());
      for (const item of (list || [])) {
        if (item && item.word_id) {
          map[item.word_id] = {
            ...item,
            intervalDays: item.intervalDays || item.interval || 1,
            box: item.box || (item.status === 'mastered' ? 5 : Math.min((item.repetitions || 0) + 1, 5))
          };
        }
      }
    } catch (e) {}

    if (global.StorageManager) {
      try {
        const localP = global.StorageManager.get('progress-v1', {});
        for (const [key, item] of Object.entries(localP || {})) {
          if (!key.includes(':') || !item) continue;
          const existing = map[key];
          const itemLast = Number(item.lastReviewed || item.last_reviewed || 0);
          const existingLast = existing ? Number(existing.lastReviewed || existing.last_reviewed || 0) : -1;
          if (!existing || itemLast > existingLast || (itemLast === existingLast && (item.repetitions || 0) > (existing.repetitions || 0))) {
            map[key] = {
              word_id: key,
              status: item.status || 'learning',
              box: item.box || 1,
              repetitions: item.repetitions || 0,
              interval: item.intervalDays || item.interval || 1,
              intervalDays: item.intervalDays || item.interval || 1,
              easeFactor: item.easeFactor || 2.5,
              lastReviewed: itemLast,
              nextReview: Number(item.nextReview || 0),
              correctCount: Math.max(Number(item.correctCount || 0), Number(existing?.correctCount || 0)),
              wrongCount: Math.max(Number(item.wrongCount || 0), Number(existing?.wrongCount || 0))
            };
          } else if (existing) {
            existing.correctCount = Math.max(Number(existing.correctCount || 0), Number(item.correctCount || 0));
            existing.wrongCount = Math.max(Number(existing.wrongCount || 0), Number(item.wrongCount || 0));
          }
        }
      } catch (e) {}
    }

    return map;
  }

  async function mergeCloudWordProgress(cloudRows) {
    if (!Array.isArray(cloudRows) || cloudRows.length === 0) return;
    try {
      const db = await openDatabase();
      const tx = db.transaction('word_progress', 'readwrite');
      const store = tx.objectStore('word_progress');

      for (const cp of cloudRows) {
        if (!cp || !cp.word_id || !String(cp.word_id).includes(':')) continue;
        const cur = await wrapRequest(store.get(cp.word_id));
        const cloudLast = Number(cp.last_reviewed || 0);
        const cloudReps = Number(cp.repetitions || 0);
        const localLast = cur ? Number(cur.lastReviewed || 0) : -1;
        const localReps = cur ? Number(cur.repetitions || 0) : -1;

        if (!cur || cloudLast > localLast || (cloudLast === localLast && cloudReps >= localReps)) {
          const nextMs = Number(cp.next_review || 0);
          store.put({
            word_id: cp.word_id,
            status: cp.status || 'learning',
            box: Number(cp.box || 1),
            repetitions: cloudReps,
            interval: Number(cp.interval_days || 1),
            intervalDays: Number(cp.interval_days || 1),
            easeFactor: Number(cp.ease_factor || 2.5),
            lastReviewed: cloudLast,
            nextReview: nextMs,
            nextReviewDate: nextMs > 0 ? new Date(nextMs).toISOString().slice(0, 10) : null,
            correctCount: Number(cur?.correctCount || 0),
            wrongCount: Number(cur?.wrongCount || 0)
          });
        }
      }

      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.warn('[QuranDB] Cloud progress merge warning:', e);
    }
  }

  const MCQ_PASS_KEY_PREFIX = 'mcq_pass:';
  const AYAH_PASS_KEY_PREFIX = 'ayah_pass:';

  function isMcqPassKey(key) {
    return typeof key === 'string' && key.startsWith(MCQ_PASS_KEY_PREFIX);
  }

  function isAyahPassKey(key) {
    return typeof key === 'string' && key.startsWith(AYAH_PASS_KEY_PREFIX);
  }

  function isNonWordProgressKey(key) {
    return isMcqPassKey(key) || isAyahPassKey(key);
  }

  async function getMcqPassedListsMap() {
    const progressMap = await getAllWordProgressMap();
    const passedMap = {};
    for (const [storageKey, item] of Object.entries(progressMap || {})) {
      if (!isMcqPassKey(storageKey) || !item) continue;
      const listKey = storageKey.slice(MCQ_PASS_KEY_PREFIX.length);
      if (!listKey) continue;
      const isPassed = item.status === 'mastered' || Number(item.repetitions || 0) > 0 || Number(item.box || 0) >= 5;
      if (isPassed) {
        passedMap[listKey] = {
          passed: true,
          score: Number(item.correctCount || item.intervalDays || item.interval || 10),
          total: Number(item.intervalDays || item.interval || item.correctCount || 10),
          passedAt: Number(item.lastReviewed || item.last_reviewed || Date.now())
        };
      }
    }
    return passedMap;
  }

  async function markMcqListPassed(listKey, score, total) {
    if (!listKey) return false;
    const cleanListKey = String(listKey).startsWith(MCQ_PASS_KEY_PREFIX)
      ? String(listKey).slice(MCQ_PASS_KEY_PREFIX.length)
      : String(listKey);
    const storageKey = `${MCQ_PASS_KEY_PREFIX}${cleanListKey}`;
    const nowMs = Date.now();
    const safeTotal = Math.max(1, Math.floor(Number(total || score || 10)));
    const safeScore = Math.max(1, Math.floor(Number(score || safeTotal)));

    const record = {
      word_id: storageKey,
      status: 'mastered',
      box: 5,
      repetitions: 1,
      interval: safeTotal,
      intervalDays: safeTotal,
      easeFactor: 2.5,
      lastReviewed: nowMs,
      nextReview: 0,
      nextReviewDate: null,
      correctCount: safeScore,
      wrongCount: 0
    };

    try {
      const db = await openDatabase();
      const tx = db.transaction('word_progress', 'readwrite');
      tx.objectStore('word_progress').put(record);
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.warn('[QuranDB] Failed to save MCQ list pass in IndexedDB:', e);
    }

    if (global.StorageManager) {
      try {
        const localP = global.StorageManager.get('progress-v1', {});
        localP[storageKey] = { ...record };
        global.StorageManager.set('progress-v1', localP);
      } catch (e) {}
    }

    scheduleCloudAccountSync();
    return true;
  }

  async function getAyahQuizPassedMap() {
    const progressMap = await getAllWordProgressMap();
    const passedMap = {};
    for (const [storageKey, item] of Object.entries(progressMap || {})) {
      if (!isAyahPassKey(storageKey) || !item) continue;
      const verseKey = storageKey.slice(AYAH_PASS_KEY_PREFIX.length);
      if (!verseKey || !verseKey.includes(':')) continue;
      const parts = verseKey.split(':');
      const surahNum = parseInt(parts[0], 10);
      const ayahNum = parseInt(parts[1], 10);
      if (!surahNum || !ayahNum) continue;

      const isPassed = item.status === 'mastered' || Number(item.repetitions || 0) > 0 || Number(item.box || 0) >= 5;
      if (isPassed) {
        passedMap[verseKey] = {
          verseKey,
          surah: surahNum,
          ayah: ayahNum,
          passed: true,
          score: Number(item.correctCount || item.intervalDays || item.interval || 1),
          total: Number(item.intervalDays || item.interval || item.correctCount || 1),
          passedAt: Number(item.lastReviewed || item.last_reviewed || Date.now())
        };
      }
    }
    return passedMap;
  }

  async function markAyahQuizPassed(surahNumber, ayahNumber, score, total) {
    const sNum = Math.floor(Number(surahNumber));
    const aNum = Math.floor(Number(ayahNumber));
    if (!sNum || !aNum || sNum < 1 || sNum > 114 || aNum < 1) return false;

    const verseKey = `${sNum}:${aNum}`;
    const storageKey = `${AYAH_PASS_KEY_PREFIX}${verseKey}`;
    const nowMs = Date.now();
    const safeTotal = Math.max(1, Math.floor(Number(total || score || 1)));
    const safeScore = Math.max(1, Math.floor(Number(score || safeTotal)));

    const record = {
      word_id: storageKey,
      status: 'mastered',
      box: 5,
      repetitions: 1,
      interval: safeTotal,
      intervalDays: safeTotal,
      easeFactor: 2.5,
      lastReviewed: nowMs,
      nextReview: 0,
      nextReviewDate: null,
      correctCount: safeScore,
      wrongCount: 0
    };

    try {
      const db = await openDatabase();
      const tx = db.transaction('word_progress', 'readwrite');
      tx.objectStore('word_progress').put(record);
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.warn('[QuranDB] Failed to save Ayah quiz pass in IndexedDB:', e);
    }

    if (global.StorageManager) {
      try {
        const localP = global.StorageManager.get('progress-v1', {});
        localP[storageKey] = { ...record };
        global.StorageManager.set('progress-v1', localP);
      } catch (e) {}
    }

    scheduleCloudAccountSync();
    return true;
  }

  async function getWeakWordsList() {
    const db = await openDatabase();
    const req = db.transaction('weak_words', 'readonly').objectStore('weak_words').getAll();
    const list = await wrapRequest(req);
    return list.sort((a, b) => b.lastMistakeAt - a.lastMistakeAt);
  }

  // ============================================================
  // BOOKMARKS & NOTES API
  // ============================================================

  async function toggleBookmark(wordKey, wordData = {}, skipCloudSync = false) {
    const db = await openDatabase();
    const tx = db.transaction('bookmarks', 'readwrite');
    const store = tx.objectStore('bookmarks');
    const existing = await wrapRequest(store.get(wordKey));

    if (existing) {
      store.delete(wordKey);
    } else {
      store.put({
        word_id: wordKey,
        addedAt: Number(wordData.addedAt || Date.now()),
        arabic: wordData.arabic || '',
        meaning_bn: wordData.meaning_bn || '',
        root: wordData.root || '',
        verse_key: wordData.verse_key || ''
      });
    }

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });

    if (wordDetailMemoryCache.has(wordKey)) {
      const cached = wordDetailMemoryCache.get(wordKey);
      cached.is_bookmarked = !existing;
    }

    if (!skipCloudSync && global.SupabaseSync && typeof global.SupabaseSync.getUser === 'function' && global.SupabaseSync.getUser()) {
      try {
        if (existing && typeof global.SupabaseSync.deleteCloudBookmark === 'function') {
          global.SupabaseSync.deleteCloudBookmark(wordKey);
        } else if (!existing) {
          scheduleCloudAccountSync();
        }
      } catch (e) {}
    }

    return !existing;
  }

  async function isBookmarked(wordKey) {
    if (wordDetailMemoryCache.has(wordKey)) {
      return Boolean(wordDetailMemoryCache.get(wordKey).is_bookmarked);
    }
    const db = await openDatabase();
    const req = db.transaction('bookmarks', 'readonly').objectStore('bookmarks').get(wordKey);
    const rec = await wrapRequest(req);
    return Boolean(rec);
  }

  async function getBookmarksList() {
    const db = await openDatabase();
    const req = db.transaction('bookmarks', 'readonly').objectStore('bookmarks').getAll();
    const list = await wrapRequest(req);
    return list.sort((a, b) => b.addedAt - a.addedAt);
  }

  async function saveNote(wordKey, noteText) {
    const db = await openDatabase();
    const tx = db.transaction('notes', 'readwrite');
    const store = tx.objectStore('notes');
    const cleanNote = (noteText || '').trim();
    if (!cleanNote) {
      store.delete(wordKey);
    } else {
      store.put({
        word_id: wordKey,
        note: cleanNote,
        updatedAt: Date.now()
      });
    }

    if (wordDetailMemoryCache.has(wordKey)) {
      const cached = wordDetailMemoryCache.get(wordKey);
      cached.user_note = cleanNote;
    }
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  // ============================================================
  // STREAK & STATS API
  // ============================================================

  async function getAppStats() {
    const db = await openDatabase();
    const tx = db.transaction(['word_progress', 'weak_words', 'bookmarks', 'activity'], 'readonly');

    const progReq = tx.objectStore('word_progress').getAll();
    const weakReq = tx.objectStore('weak_words').count();
    const bmReq = tx.objectStore('bookmarks').count();
    const actReq = tx.objectStore('activity').getAll();

    const [progList, weakCount, bookmarkCount, actList] = await Promise.all([
      wrapRequest(progReq),
      wrapRequest(weakReq),
      wrapRequest(bmReq),
      wrapRequest(actReq)
    ]);

    let learned = 0;
    let mastered = 0;
    for (const p of progList) {
      if (!p || isNonWordProgressKey(p.word_id)) continue;
      if (p.status === 'mastered') mastered++;
      if (p.repetitions > 0) learned++;
    }

    // Calculate daily streak
    actList.sort((a, b) => b.date.localeCompare(a.date));
    let streak = 0;
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    const hasToday = actList.some((a) => a.date === todayStr);
    const hasYesterday = actList.some((a) => a.date === yesterday);

    if (hasToday || hasYesterday) {
      let checkDate = hasToday ? today : new Date(Date.now() - 86400000);
      while (true) {
        const ds = checkDate.toISOString().slice(0, 10);
        const entry = actList.find((a) => a.date === ds);
        if (entry && (entry.reviewsCount > 0 || entry.wordsLearnedCount > 0)) {
          streak++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else {
          break;
        }
      }
    }

    return {
      totalWordsLearned: learned,
      totalWordsMastered: mastered,
      totalWeakWords: weakCount,
      totalBookmarks: bookmarkCount,
      currentStreakDays: streak
    };
  }

  /**
   * Returns a dictionary of daily practice activity keyed by YYYY-MM-DD:
   * { '2026-11-12': { date: '2026-11-12', reviewsCount: 5, wordsLearnedCount: 3 } }
   * Merges IndexedDB 'activity', IndexedDB 'word_progress', and StorageManager 'progress-v1'
   * so any practice drill performed by the user is guaranteed to be reflected on the Daily Streak Calendar.
   */
  async function getDailyPracticeHistory() {
    const historyMap = {};

    const toDateKey = (ts) => {
      if (!ts) return null;
      const d = new Date(ts);
      if (isNaN(d.getTime())) return null;
      return d.toISOString().slice(0, 10);
    };

    try {
      const db = await openDatabase();
      const tx = db.transaction(['activity', 'word_progress'], 'readonly');
      const [actList, progList] = await Promise.all([
        wrapRequest(tx.objectStore('activity').getAll()),
        wrapRequest(tx.objectStore('word_progress').getAll())
      ]);

      for (const act of (actList || [])) {
        if (!act || !act.date) continue;
        const reviewsCount = Number(act.reviewsCount || 0);
        const wordsLearnedCount = Number(act.wordsLearnedCount || 0);
        if (reviewsCount > 0 || wordsLearnedCount > 0) {
          historyMap[act.date] = {
            date: act.date,
            reviewsCount,
            wordsLearnedCount
          };
        }
      }

      // Ensure any word reviewed in word_progress also marks its review date
      for (const wp of (progList || [])) {
        if (!wp || !wp.lastReviewed || isNonWordProgressKey(wp.word_id)) continue;
        const dk = toDateKey(wp.lastReviewed);
        if (!dk) continue;
        if (!historyMap[dk]) {
          historyMap[dk] = { date: dk, reviewsCount: 1, wordsLearnedCount: wp.repetitions === 1 ? 1 : 0 };
        } else if (historyMap[dk].reviewsCount === 0 && historyMap[dk].wordsLearnedCount === 0) {
          historyMap[dk].reviewsCount = 1;
        }
      }
    } catch (e) {}

    // Also merge from localStorage StorageManager ('progress-v1')
    try {
      if (global.StorageManager && typeof global.StorageManager.get === 'function') {
        const localProg = global.StorageManager.get('progress-v1', {});
        for (const [k, entry] of Object.entries(localProg || {})) {
          if (isNonWordProgressKey(k) || !entry || !entry.lastReviewed || isNonWordProgressKey(entry.word_id)) continue;
          const dk = toDateKey(entry.lastReviewed);
          if (!dk) continue;
          if (!historyMap[dk]) {
            historyMap[dk] = { date: dk, reviewsCount: 1, wordsLearnedCount: 1 };
          }
        }
      }
    } catch (e) {}

    return historyMap;
  }

  async function getSurahSegments(surahNumber) {
    const num = parseInt(surahNumber, 10);
    if (!num) return null;
    if (surahSegmentsMemoryCache.has(num)) {
      return surahSegmentsMemoryCache.get(num);
    }
    const padded = String(num).padStart(3, '0');
    const segCacheKey = `seg-v2-${num}`;
    try {
      const db = await openDatabase();
      const cachedSeg = await wrapRequest(db.transaction('lookup', 'readonly').objectStore('lookup').get(segCacheKey));
      if (cachedSeg && cachedSeg.data) {
        surahSegmentsMemoryCache.set(num, cachedSeg.data);
        return cachedSeg.data;
      }
    } catch (e) {}

    try {
      const res = await fetch(`data/segments/${padded}.json?v=23`);
      if (!res.ok) return null;
      const data = await res.json();
      surahSegmentsMemoryCache.set(num, data);
      try {
        const db = await openDatabase();
        const tx = db.transaction('lookup', 'readwrite');
        tx.objectStore('lookup').put({ id: segCacheKey, data });
      } catch (e) {}
      return data;
    } catch (err) {
      try {
        const db = await openDatabase();
        const legacySeg = await wrapRequest(db.transaction('lookup', 'readonly').objectStore('lookup').get(`seg-${num}`));
        if (legacySeg && legacySeg.data) {
          surahSegmentsMemoryCache.set(num, legacySeg.data);
          return legacySeg.data;
        }
      } catch (e) {}
      console.warn(`[QuranDB] Failed to load segments for surah ${num}:`, err);
      return null;
    }
  }

  // ============================================================
  // ONE-CLICK FULL OFFLINE DATA DOWNLOADER (114 SURAHS + MORPHOLOGY + SEGMENTS)
  // ============================================================
  async function getOfflineDataStatus() {
    try {
      const db = await openDatabase();
      const meta = await getSurahsMeta();
      const total = meta.length || 114;
      let loadedCount = 0;

      const flagRec = await wrapRequest(db.transaction('lookup', 'readonly').objectStore('lookup').get('offline-all-complete'));
      if (flagRec && flagRec.done) {
        return { loadedSurahsCount: total, totalSurahs: total, isComplete: true };
      }

      for (let s = 1; s <= total; s++) {
        const loaded = await isSurahLoaded(s);
        if (loaded) loadedCount++;
      }

      return {
        loadedSurahsCount: loadedCount,
        totalSurahs: total,
        isComplete: loadedCount >= total
      };
    } catch (err) {
      return { loadedSurahsCount: 0, totalSurahs: 114, isComplete: false };
    }
  }

  let bulkDownloadActive = false;

  /**
   * Computes optimal browser/device-aware parallel concurrency limits.
   */
  function getOptimalDownloadConcurrency() {
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    const cores = typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0
      ? Math.floor(nav.hardwareConcurrency)
      : 4;
    const mem = typeof nav.deviceMemory === 'number' && nav.deviceMemory > 0
      ? nav.deviceMemory
      : 4;
    const conn = nav.connection || nav.mozConnection || nav.webkitConnection || {};
    const netType = String(conn.effectiveType || '').toLowerCase();
    const saveData = Boolean(conn.saveData);

    if (saveData || netType === 'slow-2g' || netType === '2g') {
      return { data: 3, wordAudio: 3, surahAudio: 1 };
    }
    if (netType === '3g' || mem <= 2 || cores <= 2) {
      return { data: 5, wordAudio: 6, surahAudio: 2 };
    }
    return {
      data: Math.min(10, Math.max(6, cores)),
      wordAudio: Math.min(12, Math.max(8, cores + 2)),
      surahAudio: Math.min(4, Math.max(2, Math.floor(cores / 2)))
    };
  }

  async function downloadAllOfflineData(onProgress) {
    if (bulkDownloadActive) return false;
    bulkDownloadActive = true;

    try {
      if (navigator.storage && navigator.storage.persist) {
        try { await navigator.storage.persist(); } catch (e) {}
      }

      const db = await openDatabase();
      const meta = await getSurahsMeta();
      const total = meta.length || 114;

      // Also cache JSON files in CacheStorage in parallel so service worker / fetch works offline
      let dataCache = null;
      if ('caches' in window) {
        try {
          dataCache = await caches.open('quran-vocab-data-v1');
          await Promise.all([
            dataCache.add('data/surahs-meta.json').catch(() => {}),
            dataCache.add('data/lookup/same-root.json').catch(() => {}),
            dataCache.add('data/lookup/exact-word.json').catch(() => {})
          ]);
        } catch (e) {}
      }

      // Preload same-root & exact-word concordances into IndexedDB in parallel
      await Promise.all([
        getSameRootConcordance().catch(() => {}),
        getExactWordConcordance().catch(() => {})
      ]);

      if (typeof onProgress === 'function') {
        onProgress({
          done: 0,
          total,
          percent: 0,
          surahNumber: 1,
          surahName: 'শুরু হচ্ছে…'
        });
      }

      const concurrency = Math.min(getOptimalDownloadConcurrency().data, total);
      let nextIdx = 0;
      let completedCount = 0;

      async function downloadOneSurahOffline(sObj, fallbackNum) {
        const sNum = sObj.surah || fallbackNum;
        const sName = sObj.name_bn_script || sObj.name_bn || `সূরা ${sNum}`;
        const padded = String(sNum).padStart(3, '0');
        const contentUrl = `data/surah-content/${sNum}.json`;
        const segUrl = `data/segments/${padded}.json?v=23`;
        const segKey = `seg-v2-${sNum}`;

        const [alreadyLoaded, cachedSeg] = await Promise.all([
          isSurahLoaded(sNum).catch(() => false),
          wrapRequest(db.transaction('lookup', 'readonly').objectStore('lookup').get(segKey)).catch(() => null)
        ]);

        const needContent = !alreadyLoaded;
        const needSeg = !cachedSeg || !cachedSeg.data;

        const tasks = [];

        if (needContent) {
          tasks.push((async () => {
            const res = await fetch(contentUrl);
            if (res.ok) {
              if (dataCache) {
                try { await dataCache.put(contentUrl, res.clone()); } catch (e) {}
              }
              const contentData = await res.json();
              surahMemoryCache.set(sNum, contentData);
              await saveSurahToIndexedDB(sNum, contentData, db);
            }
          })());
        }

        if (needSeg) {
          tasks.push((async () => {
            try {
              const segRes = await fetch(segUrl);
              if (segRes.ok) {
                if (dataCache) {
                  try { await dataCache.put(`data/segments/${padded}.json`, segRes.clone()); } catch (e) {}
                }
                const segData = await segRes.json();
                surahSegmentsMemoryCache.set(sNum, segData);
                const tx = db.transaction('lookup', 'readwrite');
                tx.objectStore('lookup').put({ id: segKey, data: segData });
              }
            } catch (e) {}
          })());
        }

        if (tasks.length > 0) {
          await Promise.all(tasks);
        }

        completedCount++;
        if (typeof onProgress === 'function') {
          onProgress({
            done: completedCount,
            total,
            percent: Math.round((completedCount / total) * 100),
            surahNumber: sNum,
            surahName: sName
          });
        }
      }

      async function surahWorker() {
        while (nextIdx < total) {
          const i = nextIdx++;
          const sObj = meta[i] || { surah: i + 1, name_bn: `সূরা ${i + 1}` };
          await downloadOneSurahOffline(sObj, i + 1);
        }
      }

      const workers = [];
      for (let w = 0; w < concurrency; w++) {
        workers.push(surahWorker());
      }
      await Promise.all(workers);

      try {
        const tx = db.transaction('lookup', 'readwrite');
        tx.objectStore('lookup').put({ id: 'offline-all-complete', done: true, updatedAt: Date.now() });
      } catch (e) {}

      if (typeof onProgress === 'function') {
        onProgress({
          done: total,
          total,
          percent: 100,
          surahNumber: total,
          surahName: 'সম্পূর্ণ কুরআন'
        });
      }

      return true;
    } catch (err) {
      console.error('[QuranDB] Bulk offline download error:', err);
      throw err;
    } finally {
      bulkDownloadActive = false;
    }
  }

  // ============================================================
  // APP-ONLY REAL STORAGE USAGE CALCULATOR (IMMUNE TO CHROME QUOTA PADDING)
  // ============================================================
  const cacheEntryBytesMemo = new Map();

  function invalidateAudioCacheSizeMemo(url) {
    if (url) {
      cacheEntryBytesMemo.delete(`quran-audio-v1|${url}`);
      return;
    }
    for (const k of Array.from(cacheEntryBytesMemo.keys())) {
      if (k.startsWith('quran-audio-v1|')) {
        cacheEntryBytesMemo.delete(k);
      }
    }
  }

  function estimateLegacyOpaqueAudioBytes(url, metaBySurah) {
    if (!url) return 0;
    if (url.includes('audio.qurancdn.com/wbw') || url.includes('/wbw/')) {
      return 16 * 1024;
    }
    if (url.includes('audio-cdn.tarteel.ai')) {
      const m = url.match(/\/(\d{3})\.mp3/);
      if (m) {
        const sNum = parseInt(m[1], 10);
        const seg = surahSegmentsMemoryCache.get(sNum);
        if (seg && typeof seg.duration === 'number' && seg.duration > 0) {
          return Math.round(seg.duration * 16000);
        }
        const sMeta = metaBySurah ? metaBySurah.get(sNum) : null;
        if (sMeta && typeof sMeta.total_words === 'number' && sMeta.total_words > 0) {
          return Math.max(400000, Math.round(sMeta.total_words * 16000));
        }
      }
      return 3500000;
    }
    return 32 * 1024;
  }

  async function measureSingleCachedEntryBytes(cache, req, memoKey, metaBySurah) {
    if (cacheEntryBytesMemo.has(memoKey)) {
      return cacheEntryBytesMemo.get(memoKey);
    }
    try {
      const res = await cache.match(req);
      if (!res) return 0;
      let size = 0;
      if (res.type === 'opaque') {
        size = estimateLegacyOpaqueAudioBytes(req.url, metaBySurah);
      } else {
        const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
        if (contentLength > 0) {
          size = contentLength;
        } else {
          const blob = await res.blob();
          size = blob ? blob.size : 0;
        }
      }
      cacheEntryBytesMemo.set(memoKey, size);
      return size;
    } catch (e) {
      return 0;
    }
  }

  async function measureRequestsBatched(cache, cacheName, reqList, metaBySurah) {
    let sum = 0;
    const BATCH_SIZE = 24;
    for (let i = 0; i < reqList.length; i += BATCH_SIZE) {
      const batch = reqList.slice(i, i + BATCH_SIZE);
      const sizes = await Promise.all(
        batch.map((req) => measureSingleCachedEntryBytes(cache, req, `${cacheName}|${req.url}`, metaBySurah))
      );
      for (const s of sizes) sum += s;
    }
    return sum;
  }

  function pickEvenlySpacedIndices(totalCount, maxSamples) {
    if (totalCount <= 0) return [];
    if (totalCount <= maxSamples) {
      return Array.from({ length: totalCount }, (_, i) => i);
    }
    const indices = [];
    const step = (totalCount - 1) / (maxSamples - 1);
    const seen = new Set();
    for (let i = 0; i < maxSamples; i++) {
      const idx = Math.min(totalCount - 1, Math.round(i * step));
      if (!seen.has(idx)) {
        seen.add(idx);
        indices.push(idx);
      }
    }
    return indices;
  }

  async function measurePwaCachesBytes(metaBySurah) {
    if (typeof caches === 'undefined') return 0;
    let totalBytes = 0;
    try {
      const cacheNames = await caches.keys();
      const appCaches = cacheNames.filter((name) =>
        name === 'quran-audio-v1' ||
        name === 'quran-sound-effects-v1' ||
        name === 'quran-vocab-data-v1' ||
        name.startsWith('quran-app-shell-')
      );

      for (const cacheName of appCaches) {
        const cache = await caches.open(cacheName);
        const requests = await cache.keys();
        if (!requests || requests.length === 0) continue;

        if (cacheName === 'quran-audio-v1') {
          const wordReqs = [];
          const surahAndOtherReqs = [];
          for (const req of requests) {
            const url = req.url || '';
            if (url.includes('audio.qurancdn.com/wbw') || url.includes('/wbw/')) {
              wordReqs.push(req);
            } else {
              surahAndOtherReqs.push(req);
            }
          }

          // Surah MP3s (at most 114 files) — fast exact measurement
          totalBytes += await measureRequestsBatched(cache, cacheName, surahAndOtherReqs, metaBySurah);

          // Word MP3s (up to 77,430 files) — exact for <= 64, fast bounded 32-file sample above 64
          if (wordReqs.length <= 64) {
            totalBytes += await measureRequestsBatched(cache, cacheName, wordReqs, metaBySurah);
          } else {
            const sampleIndices = pickEvenlySpacedIndices(wordReqs.length, 32);
            const sampleSizes = await Promise.all(
              sampleIndices.map((idx) => {
                const req = wordReqs[idx];
                return measureSingleCachedEntryBytes(cache, req, `${cacheName}|${req.url}`, metaBySurah);
              })
            );
            const validSizes = sampleSizes.filter((s) => Number.isFinite(s) && s > 0);
            const avgBytes = validSizes.length > 0
              ? validSizes.reduce((acc, v) => acc + v, 0) / validSizes.length
              : 16 * 1024;
            totalBytes += Math.round(avgBytes * wordReqs.length);
          }
        } else {
          // App shell / sound effects / data caches (bounded small sets)
          if (requests.length <= 120) {
            totalBytes += await measureRequestsBatched(cache, cacheName, requests, metaBySurah);
          } else {
            const sampleIndices = pickEvenlySpacedIndices(requests.length, 32);
            const sampleSizes = await Promise.all(
              sampleIndices.map((idx) => {
                const req = requests[idx];
                return measureSingleCachedEntryBytes(cache, req, `${cacheName}|${req.url}`, metaBySurah);
              })
            );
            const validSizes = sampleSizes.filter((s) => Number.isFinite(s) && s > 0);
            const avgBytes = validSizes.length > 0
              ? validSizes.reduce((acc, v) => acc + v, 0) / validSizes.length
              : 32 * 1024;
            totalBytes += Math.round(avgBytes * requests.length);
          }
        }
      }
    } catch (e) {}
    return totalBytes;
  }

  async function measurePwaIndexedDbBytes() {
    let totalBytes = 0;
    try {
      const db = await openDatabase();
      const storeNames = ['surahs', 'ayahs', 'words', 'word_summaries', 'word_progress', 'weak_words', 'bookmarks', 'notes', 'activity', 'lookup', 'reading_history'];
      const availableStores = storeNames.filter((s) => db.objectStoreNames.contains(s));
      if (availableStores.length === 0) return 0;

      const tx = db.transaction(availableStores, 'readonly');
      const counts = await Promise.all(
        availableStores.map(async (name) => {
          if (name === 'lookup') {
            const keys = await wrapRequest(tx.objectStore('lookup').getAllKeys());
            return { name, keys: keys || [] };
          }
          const count = await wrapRequest(tx.objectStore(name).count());
          return { name, count: count || 0 };
        })
      );

      const perRecordBytes = {
        surahs: 320,
        ayahs: 400,
        words: 165,
        word_summaries: 300,
        word_progress: 160,
        weak_words: 140,
        bookmarks: 160,
        notes: 220,
        activity: 120,
        reading_history: 280
      };

      for (const entry of counts) {
        if (entry.name === 'lookup') {
          for (const k of entry.keys) {
            const ks = String(k || '');
            if (ks === 'same-root') {
              totalBytes += 9670000;
            } else if (ks === 'exact-word') {
              totalBytes += 810000;
            } else if (ks.startsWith('seg-v2-') || ks.startsWith('seg-')) {
              totalBytes += 19000;
            } else {
              totalBytes += 128;
            }
          }
        } else {
          totalBytes += (entry.count || 0) * (perRecordBytes[entry.name] || 200);
        }
      }
    } catch (e) {}
    return totalBytes;
  }

  function measurePwaLocalStorageBytes() {
    let totalBytes = 0;
    try {
      if (typeof localStorage === 'undefined') return 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('quran-app:')) {
          const val = localStorage.getItem(key) || '';
          totalBytes += (key.length + val.length) * 2;
        }
      }
    } catch (e) {}
    return totalBytes;
  }

  async function getAppStorageUsageBytes() {
    let metaBySurah = null;
    if (surahsMetaCache && surahsMetaCache.length > 0) {
      metaBySurah = new Map(surahsMetaCache.map((s) => [s.surah, s]));
    } else if (typeof window !== 'undefined' && Array.isArray(window.SURAHS_META)) {
      metaBySurah = new Map(window.SURAHS_META.map((s) => [parseInt(s.surah || s.number, 10), s]));
    }
    const [cacheBytes, idbBytes] = await Promise.all([
      measurePwaCachesBytes(metaBySurah),
      measurePwaIndexedDbBytes()
    ]);
    const lsBytes = measurePwaLocalStorageBytes();
    const total = cacheBytes + idbBytes + lsBytes;
    try {
      if (typeof localStorage !== 'undefined' && total > 0) {
        localStorage.setItem('quran-app:last-storage-bytes-v1', String(Math.round(total)));
      }
    } catch (e) {}
    return total;
  }

  // ============================================================
  // READING & LISTENING HISTORY STORE API
  // ============================================================

  function mergeHistoryRecordPair(localRec, incomingRec) {
    if (global.ReadingHistory && typeof global.ReadingHistory.mergeEntries === 'function') {
      return global.ReadingHistory.mergeEntries(localRec, incomingRec);
    }
    const base = localRec || incomingRec || {};
    const inc = incomingRec || localRec || {};
    const union = (a, b) => Array.from(new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])].filter(Boolean)));
    const readKeys = union(base.read_word_keys, inc.read_word_keys);
    const listenKeys = union(base.listen_word_keys, inc.listen_word_keys);
    const readSec = Math.max(Number(base.read_seconds || 0), Number(inc.read_seconds || 0));
    const listenSec = Math.max(Number(base.listen_seconds || 0), Number(inc.listen_seconds || 0));
    const totalSec = Math.max(Number(base.total_seconds || 0), Number(inc.total_seconds || 0), readSec, listenSec);
    const incNewer = Number(inc.updated_at || 0) > Number(base.updated_at || 0);
    const activityDate = String(base.activity_date || inc.activity_date || '');
    const surah = Math.max(1, Math.min(114, Math.floor(Number(base.surah || inc.surah || 1))));
    return {
      id: `${activityDate}|${surah}`,
      activity_date: activityDate,
      surah,
      read_word_keys: readKeys,
      listen_word_keys: listenKeys,
      read_count: Math.max(Number(base.read_count || 0), Number(inc.read_count || 0), readKeys.length),
      listen_count: Math.max(Number(base.listen_count || 0), Number(inc.listen_count || 0), listenKeys.length),
      surah_listen_count: Math.max(Number(base.surah_listen_count || 0), Number(inc.surah_listen_count || 0)),
      read_seconds: readSec,
      listen_seconds: listenSec,
      total_seconds: totalSec,
      last_ayah: incNewer ? Number(inc.last_ayah || 1) : Number(base.last_ayah || 1),
      updated_at: Math.max(Number(base.updated_at || 0), Number(inc.updated_at || 0))
    };
  }

  async function getAllReadingHistory() {
    try {
      const db = await openDatabase();
      if (!db.objectStoreNames.contains('reading_history')) return [];
      const tx = db.transaction('reading_history', 'readonly');
      const all = await wrapRequest(tx.objectStore('reading_history').getAll());
      return Array.isArray(all) ? all : [];
    } catch (e) {
      return [];
    }
  }

  async function getReadingHistoryById(id) {
    if (!id) return null;
    try {
      const db = await openDatabase();
      if (!db.objectStoreNames.contains('reading_history')) return null;
      const tx = db.transaction('reading_history', 'readonly');
      const rec = await wrapRequest(tx.objectStore('reading_history').get(String(id)));
      return rec || null;
    } catch (e) {
      return null;
    }
  }

  async function upsertReadingHistoryEntry(entry) {
    if (!entry || !entry.activity_date || !entry.surah) return null;
    const db = await openDatabase();
    if (!db.objectStoreNames.contains('reading_history')) return null;

    const id = entry.id || `${entry.activity_date}|${Math.max(1, Math.min(114, Math.floor(Number(entry.surah))))}`;
    const existing = await getReadingHistoryById(id);
    const merged = existing ? mergeHistoryRecordPair(existing, entry) : mergeHistoryRecordPair(null, { ...entry, id });

    await withStore('reading_history', 'readwrite', (store) => {
      store.put(merged);
    });
    return merged;
  }

  async function mergeCloudReadingHistory(cloudRows) {
    if (!Array.isArray(cloudRows) || cloudRows.length === 0) return 0;
    const db = await openDatabase();
    if (!db.objectStoreNames.contains('reading_history')) return 0;

    let mergedCount = 0;
    for (const row of cloudRows) {
      if (!row || !row.activity_date || !row.surah) continue;
      const dateStr = String(row.activity_date).slice(0, 10);
      const surahNum = Math.max(1, Math.min(114, Math.floor(Number(row.surah))));
      const normalizedCloud = {
        id: `${dateStr}|${surahNum}`,
        activity_date: dateStr,
        surah: surahNum,
        read_word_keys: Array.isArray(row.read_word_keys) ? row.read_word_keys : [],
        listen_word_keys: Array.isArray(row.listen_word_keys) ? row.listen_word_keys : [],
        read_count: Number(row.read_count || 0),
        listen_count: Number(row.listen_count || 0),
        surah_listen_count: Number(row.surah_listen_count || 0),
        read_seconds: Number(row.read_seconds || 0),
        listen_seconds: Number(row.listen_seconds || 0),
        total_seconds: Number(row.total_seconds || 0),
        last_ayah: Number(row.last_ayah || 1),
        updated_at: Number(row.updated_at || 0)
      };
      await upsertReadingHistoryEntry(normalizedCloud);
      mergedCount++;
    }
    return mergedCount;
  }

  // Expose API
  global.QuranDB = {
    openDatabase,
    getSurahsMeta,
    getSurahMeta,
    loadSurah,
    isSurahLoaded,
    getWordDetail,
    getSameRootConcordance,
    getExactWordConcordance,
    getExactWordOccurrenceCountSync,
    getExactWordOccurrenceCount,
    getGlobalFrequentQuizWords,
    getWordsByRoot,
    getWordsByExactArabic,
    getOccurrencesDetails,
    getSurahSegments,
    getOfflineDataStatus,
    getOptimalDownloadConcurrency,
    downloadAllOfflineData,
    recordSpacedRepetition,
    computeRememberPoint,
    getAllWordProgressMap,
    mergeCloudWordProgress,
    isMcqPassKey,
    getMcqPassedListsMap,
    markMcqListPassed,
    isAyahPassKey,
    getAyahQuizPassedMap,
    markAyahQuizPassed,
    getWeakWordsList,
    toggleBookmark,
    isBookmarked,
    getBookmarksList,
    saveNote,
    getAppStats,
    getDailyPracticeHistory,
    getAllReadingHistory,
    getReadingHistoryById,
    upsertReadingHistoryEntry,
    mergeCloudReadingHistory,
    startIdlePrecache,
    getAppStorageUsageBytes,
    invalidateAudioCacheSizeMemo
  };

})(typeof window !== 'undefined' ? window : globalThis);

