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
  const DB_VERSION = 2;
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
      };

      request.onsuccess = (event) => resolve(event.target.result);
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

    // 1. Instant synchronous fallback from window.SURAHS_META
    if (typeof window !== 'undefined' && Array.isArray(window.SURAHS_META) && window.SURAHS_META.length > 0) {
      metaList = window.SURAHS_META;
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
  // ROOT LOOKUP & DISTRACTOR API
  // ============================================================

  let sameRootCache = null;

  async function getSameRootConcordance() {
    if (sameRootCache) return sameRootCache;

    const db = await openDatabase();
    const req = db.transaction('lookup', 'readonly').objectStore('lookup').get('same-root');
    const cached = await wrapRequest(req);
    if (cached && cached.data) {
      sameRootCache = cached.data;
      return sameRootCache;
    }

    try {
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
    }
    return {};
  }

  async function getWordsByRoot(root) {
    if (!root) return [];
    const concordance = await getSameRootConcordance();
    const wordKeys = concordance[root] || [];
    return wordKeys;
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
    const isSuccess = grade >= 3;

    if (isSuccess) {
      if (repetitions === 0) {
        interval = 1;
      } else if (repetitions === 1) {
        interval = 6;
      } else {
        interval = Math.round(interval * easeFactor);
      }
      repetitions += 1;
    } else {
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
    progStore.put({
      word_id: wordKey,
      status: newStatus,
      repetitions,
      interval,
      easeFactor,
      lastReviewed: nowMs,
      nextReviewDate: nextDate.toISOString().slice(0, 10)
    });

    if (global.StorageManager) {
      try {
        const localP = global.StorageManager.get('progress-v1', {});
        localP[wordKey] = {
          word_id: wordKey,
          box: newStatus === 'mastered' ? 5 : Math.min(repetitions + 1, 5),
          repetitions,
          intervalDays: interval,
          easeFactor,
          nextReview: nextDate.getTime(),
          lastReviewed: nowMs,
          status: newStatus
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

    return { repetitions, interval, easeFactor, status: newStatus };
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

  async function toggleBookmark(wordKey, wordData = {}) {
    const db = await openDatabase();
    const tx = db.transaction('bookmarks', 'readwrite');
    const store = tx.objectStore('bookmarks');
    const existing = await wrapRequest(store.get(wordKey));

    if (existing) {
      store.delete(wordKey);
    } else {
      store.put({
        word_id: wordKey,
        addedAt: Date.now(),
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

  async function getSurahSegments(surahNumber) {
    const num = parseInt(surahNumber, 10);
    if (!num) return null;
    if (surahSegmentsMemoryCache.has(num)) {
      return surahSegmentsMemoryCache.get(num);
    }
    const padded = String(num).padStart(3, '0');
    try {
      const res = await fetch(`data/segments/${padded}.json`);
      if (!res.ok) return null;
      const data = await res.json();
      surahSegmentsMemoryCache.set(num, data);
      return data;
    } catch (err) {
      console.warn(`[QuranDB] Failed to load segments for surah ${num}:`, err);
      return null;
    }
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
    getWordsByRoot,
    getSurahSegments,
    recordSpacedRepetition,
    getWeakWordsList,
    toggleBookmark,
    isBookmarked,
    getBookmarksList,
    saveNote,
    getAppStats,
    startIdlePrecache
  };

})(typeof window !== 'undefined' ? window : globalThis);
