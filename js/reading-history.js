/* ============================================================
   READING & LISTENING HISTORY ENGINE
   Offline-first study tracker for tapped words (Read), word/ayah/
   surah audio playback (Listen), and real active daily study time
   (non-overlapping, idle-capped, visibility-aware).
   Persists to IndexedDB (QuranDB) and triggers debounced Supabase sync.
   ============================================================ */

(function (global) {
  'use strict';

  const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  const BN_MONTHS = [
    'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল',
    'মে', 'জুন', 'জুলাই', 'আগস্ট',
    'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'
  ];

  const IDLE_THRESHOLD_MS = 60_000;
  const FLUSH_INTERVAL_MS = 15_000;

  function toBnDigits(val) {
    return String(val).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
  }

  function getLocalDateKey(ts = Date.now()) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function makeHistoryId(activityDate, surah) {
    const s = Math.max(1, Math.min(114, Math.floor(Number(surah) || 1)));
    return `${activityDate}|${s}`;
  }

  function parseLocalDateKey(dateKey) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || '').trim());
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return new Date(year, month - 1, day);
  }

  function diffDaysBetweenKeys(laterKey, earlierKey) {
    const a = parseLocalDateKey(laterKey);
    const b = parseLocalDateKey(earlierKey);
    if (!a || !b) return Infinity;
    const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
    const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((utcA - utcB) / 86_400_000);
  }

  function formatDurationBn(totalSeconds) {
    const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    if (sec === 0) return '০ মিনিট';
    if (sec < 60) return `${toBnDigits(sec)} সেকেন্ড`;
    if (sec < 3600) {
      return `${toBnDigits(Math.floor(sec / 60))} মিনিট`;
    }
    const hours = Math.floor(sec / 3600);
    const remMins = Math.floor((sec % 3600) / 60);
    if (remMins === 0) return `${toBnDigits(hours)} ঘণ্টা`;
    return `${toBnDigits(hours)} ঘণ্টা ${toBnDigits(remMins)} মি.`;
  }

  function formatCompactDurationBn(totalSeconds) {
    const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    if (sec === 0) return '০ মি.';
    if (sec < 60) return `${toBnDigits(sec)} সে.`;
    if (sec < 3600) return `${toBnDigits(Math.floor(sec / 60))} মি.`;
    const hours = Math.floor(sec / 3600);
    const remMins = Math.floor((sec % 3600) / 60);
    if (remMins === 0) return `${toBnDigits(hours)} ঘণ্টা`;
    return `${toBnDigits(hours)} ঘ. ${toBnDigits(remMins)} মি.`;
  }

  function formatDateHeadingBn(dateKey, todayKey = getLocalDateKey()) {
    const dt = parseLocalDateKey(dateKey);
    const today = parseLocalDateKey(todayKey);
    if (!dt) return String(dateKey || '');

    const dayStr = toBnDigits(dt.getDate());
    const monthStr = BN_MONTHS[dt.getMonth()] || '';
    const baseLabel = `${dayStr} ${monthStr}`;

    if (today) {
      const delta = diffDaysBetweenKeys(todayKey, dateKey);
      if (delta === 0) return `আজ — ${baseLabel}`;
      if (delta === 1) return `গতকাল — ${baseLabel}`;
      if (dt.getFullYear() !== today.getFullYear()) {
        return `${baseLabel}, ${toBnDigits(dt.getFullYear())}`;
      }
    }
    return baseLabel;
  }

  function uniqueStringArray(arr) {
    if (!Array.isArray(arr)) return [];
    const seen = new Set();
    const out = [];
    for (const item of arr) {
      const s = String(item || '').trim();
      if (s && !seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    }
    return out;
  }

  function createEmptyEntry(activityDate, surah, nowMs = Date.now()) {
    const s = Math.max(1, Math.min(114, Math.floor(Number(surah) || 1)));
    return {
      id: makeHistoryId(activityDate, s),
      activity_date: activityDate,
      surah: s,
      read_word_keys: [],
      listen_word_keys: [],
      read_count: 0,
      listen_count: 0,
      surah_listen_count: 0,
      read_seconds: 0,
      listen_seconds: 0,
      total_seconds: 0,
      last_ayah: 1,
      updated_at: nowMs
    };
  }

  function normalizeEntry(raw) {
    const activityDate = String((raw && raw.activity_date) || getLocalDateKey());
    const surah = Math.max(1, Math.min(114, Math.floor(Number(raw && raw.surah) || 1)));
    const readKeys = uniqueStringArray(raw && raw.read_word_keys);
    const listenKeys = uniqueStringArray(raw && raw.listen_word_keys);
    const readCount = Math.max(readKeys.length, Math.floor(Number(raw && raw.read_count) || 0));
    const listenCount = Math.max(listenKeys.length, Math.floor(Number(raw && raw.listen_count) || 0));
    const surahListenCount = Math.max(0, Math.floor(Number(raw && raw.surah_listen_count) || 0));
    const readSeconds = Math.max(0, Math.floor(Number(raw && raw.read_seconds) || 0));
    const listenSeconds = Math.max(0, Math.floor(Number(raw && raw.listen_seconds) || 0));
    const totalSeconds = Math.max(
      Math.floor(Number(raw && raw.total_seconds) || 0),
      readSeconds,
      listenSeconds
    );
    const lastAyah = Math.max(1, Math.floor(Number(raw && raw.last_ayah) || 1));
    const updatedAt = Math.max(0, Math.floor(Number(raw && raw.updated_at) || 0));

    return {
      id: makeHistoryId(activityDate, surah),
      activity_date: activityDate,
      surah,
      read_word_keys: readKeys,
      listen_word_keys: listenKeys,
      read_count: readCount,
      listen_count: listenCount,
      surah_listen_count: surahListenCount,
      read_seconds: readSeconds,
      listen_seconds: listenSeconds,
      total_seconds: totalSeconds,
      last_ayah: lastAyah,
      updated_at: updatedAt
    };
  }

  function mergeEntries(localRaw, cloudRaw) {
    if (!localRaw && !cloudRaw) return createEmptyEntry(getLocalDateKey(), 1);
    if (!localRaw) return normalizeEntry(cloudRaw);
    if (!cloudRaw) return normalizeEntry(localRaw);

    const local = normalizeEntry(localRaw);
    const cloud = normalizeEntry(cloudRaw);
    const readKeys = uniqueStringArray([...local.read_word_keys, ...cloud.read_word_keys]);
    const listenKeys = uniqueStringArray([...local.listen_word_keys, ...cloud.listen_word_keys]);
    const readSeconds = Math.max(local.read_seconds, cloud.read_seconds);
    const listenSeconds = Math.max(local.listen_seconds, cloud.listen_seconds);
    const totalSeconds = Math.max(local.total_seconds, cloud.total_seconds, readSeconds, listenSeconds);
    const cloudIsNewer = cloud.updated_at > local.updated_at;

    return {
      id: local.id,
      activity_date: local.activity_date,
      surah: local.surah,
      read_word_keys: readKeys,
      listen_word_keys: listenKeys,
      read_count: Math.max(local.read_count, cloud.read_count, readKeys.length),
      listen_count: Math.max(local.listen_count, cloud.listen_count, listenKeys.length),
      surah_listen_count: Math.max(local.surah_listen_count, cloud.surah_listen_count),
      read_seconds: readSeconds,
      listen_seconds: listenSeconds,
      total_seconds: totalSeconds,
      last_ayah: cloudIsNewer ? cloud.last_ayah : local.last_ayah,
      updated_at: Math.max(local.updated_at, cloud.updated_at)
    };
  }

  // ---- Runtime Active Session State ----
  const dirtyEntries = new Map(); // id -> normalized entry waiting to persist
  let activeContext = {
    view: 'surahs',
    surah: null,
    ayah: 1,
    isStudyView: false
  };
  let lastInteractionTs = Date.now();
  let audioState = {
    isPlaying: false,
    surah: null,
    ayah: 1,
    lastRecitationTimeSec: null,
    fractionalListenSec: 0
  };
  let heartbeatTimer = null;
  let flushTimer = null;
  let initialized = false;

  async function loadOrGetWorkingEntry(dateKey, surah) {
    const s = Math.max(1, Math.min(114, Math.floor(Number(surah) || 1)));
    const id = makeHistoryId(dateKey, s);
    if (dirtyEntries.has(id)) {
      return dirtyEntries.get(id);
    }
    if (global.QuranDB && typeof global.QuranDB.getReadingHistoryById === 'function') {
      try {
        const existing = await global.QuranDB.getReadingHistoryById(id);
        if (existing) {
          const norm = normalizeEntry(existing);
          dirtyEntries.set(id, norm);
          return norm;
        }
      } catch (e) {}
    }
    const fresh = createEmptyEntry(dateKey, s, Date.now());
    dirtyEntries.set(id, fresh);
    return fresh;
  }

  function markUserInteraction() {
    lastInteractionTs = Date.now();
  }

  function setActiveContext(view, surah = null, ayah = 1) {
    const studyViews = new Set(['ayahs', 'word', 'practice']);
    const prevSurah = activeContext.surah;
    activeContext = {
      view: String(view || 'surahs'),
      surah: surah ? Math.max(1, Math.min(114, parseInt(surah, 10))) : null,
      ayah: ayah && parseInt(ayah, 10) >= 1 ? parseInt(ayah, 10) : 1,
      isStudyView: studyViews.has(String(view || ''))
    };
    markUserInteraction();
    if (prevSurah && prevSurah !== activeContext.surah) {
      flushNow();
    }
  }

  function setAudioPlaying(isPlaying, surah = null, ayah = 1) {
    const playing = Boolean(isPlaying);
    audioState.isPlaying = playing;
    if (surah) {
      audioState.surah = Math.max(1, Math.min(114, parseInt(surah, 10)));
    }
    if (ayah && parseInt(ayah, 10) >= 1) {
      audioState.ayah = parseInt(ayah, 10);
    }
    if (!playing) {
      audioState.lastRecitationTimeSec = null;
      audioState.fractionalListenSec = 0;
      flushNow();
    }
  }

  async function recordWordRead(surah, ayah, wordKey) {
    const s = parseInt(surah, 10);
    const a = parseInt(ayah, 10) || 1;
    const key = String(wordKey || '').trim();
    if (!s || s < 1 || s > 114 || !key) return null;

    markUserInteraction();
    activeContext.surah = s;
    activeContext.ayah = a;

    const today = getLocalDateKey();
    const entry = await loadOrGetWorkingEntry(today, s);
    if (!entry.read_word_keys.includes(key)) {
      entry.read_word_keys = [...entry.read_word_keys, key];
    }
    entry.read_count = Math.max(entry.read_count, entry.read_word_keys.length);
    entry.last_ayah = a;
    entry.updated_at = Date.now();
    dirtyEntries.set(entry.id, entry);

    await flushNow();
    return entry;
  }

  async function recordWordListen(surah, ayah, wordKey, durationSec = 2) {
    const s = parseInt(surah, 10);
    const a = parseInt(ayah, 10) || 1;
    const key = String(wordKey || '').trim();
    if (!s || s < 1 || s > 114 || !key) return null;

    markUserInteraction();
    const today = getLocalDateKey();
    const entry = await loadOrGetWorkingEntry(today, s);
    if (!entry.listen_word_keys.includes(key)) {
      entry.listen_word_keys = [...entry.listen_word_keys, key];
    }
    const addedSec = Math.max(0, Math.min(30, Math.round(Number(durationSec) || 0)));
    entry.listen_count = Math.max(entry.listen_count + 1, entry.listen_word_keys.length);
    entry.listen_seconds += addedSec;
    entry.total_seconds += addedSec;
    entry.last_ayah = a;
    entry.updated_at = Date.now();
    dirtyEntries.set(entry.id, entry);

    await flushNow();
    return entry;
  }

  async function recordAyahListen(surah, ayah, durationSec = 4) {
    const s = parseInt(surah, 10);
    const a = parseInt(ayah, 10) || 1;
    if (!s || s < 1 || s > 114) return null;

    markUserInteraction();
    const today = getLocalDateKey();
    const entry = await loadOrGetWorkingEntry(today, s);
    const addedSec = Math.max(0, Math.min(180, Math.round(Number(durationSec) || 0)));
    entry.listen_count += 1;
    entry.listen_seconds += addedSec;
    entry.total_seconds += addedSec;
    entry.last_ayah = a;
    entry.updated_at = Date.now();
    dirtyEntries.set(entry.id, entry);

    await flushNow();
    return entry;
  }

  async function recordSurahRecitationStart(surah, ayah = 1) {
    const s = parseInt(surah, 10);
    const a = parseInt(ayah, 10) || 1;
    if (!s || s < 1 || s > 114) return null;

    markUserInteraction();
    audioState.isPlaying = true;
    audioState.surah = s;
    audioState.ayah = a;
    audioState.lastRecitationTimeSec = null;
    audioState.fractionalListenSec = 0;

    const today = getLocalDateKey();
    const entry = await loadOrGetWorkingEntry(today, s);
    entry.surah_listen_count += 1;
    entry.last_ayah = a;
    entry.updated_at = Date.now();
    dirtyEntries.set(entry.id, entry);

    await flushNow();
    return entry;
  }

  function recordSurahRecitationTick(surah, ayah, currentTimeSec) {
    const s = parseInt(surah, 10);
    const a = parseInt(ayah, 10) || 1;
    if (!s || s < 1 || s > 114 || !Number.isFinite(currentTimeSec)) return;

    audioState.surah = s;
    audioState.ayah = a;

    if (audioState.lastRecitationTimeSec !== null) {
      const delta = currentTimeSec - audioState.lastRecitationTimeSec;
      if (delta > 0 && delta <= 3.5) {
        audioState.fractionalListenSec += delta;
        if (audioState.fractionalListenSec >= 1) {
          const wholeSec = Math.floor(audioState.fractionalListenSec);
          audioState.fractionalListenSec -= wholeSec;
          addStudyTickSync(s, a, wholeSec, true);
        }
      }
    }
    audioState.lastRecitationTimeSec = currentTimeSec;
  }

  function resetRecitationCursor(currentTimeSec = null) {
    audioState.lastRecitationTimeSec = Number.isFinite(currentTimeSec) ? currentTimeSec : null;
  }

  function addStudyTickSync(surah, ayah, deltaSec, isAudioPlaying) {
    const s = parseInt(surah, 10);
    const sec = Math.max(0, Math.min(15, Math.round(Number(deltaSec) || 0)));
    if (!s || s < 1 || s > 114 || sec <= 0) return;

    const today = getLocalDateKey();
    const id = makeHistoryId(today, s);

    if (dirtyEntries.has(id)) {
      const entry = dirtyEntries.get(id);
      if (isAudioPlaying) {
        entry.listen_seconds += sec;
      } else {
        entry.read_seconds += sec;
      }
      entry.total_seconds += sec;
      if (ayah && ayah >= 1) entry.last_ayah = ayah;
      entry.updated_at = Date.now();
      dirtyEntries.set(id, entry);
      return;
    }

    // Load from DB asynchronously, then merge this tick safely
    loadOrGetWorkingEntry(today, s).then((entry) => {
      if (isAudioPlaying) {
        entry.listen_seconds += sec;
      } else {
        entry.read_seconds += sec;
      }
      entry.total_seconds += sec;
      if (ayah && ayah >= 1) entry.last_ayah = ayah;
      entry.updated_at = Date.now();
      dirtyEntries.set(id, entry);
    }).catch(() => {});
  }

  function onHeartbeatTick() {
    const isVisible = typeof document !== 'undefined' ? document.visibilityState === 'visible' : true;
    const now = Date.now();

    // If recitation audio is actively playing, time ticks come from recordSurahRecitationTick
    // so we never double-count reading + listening simultaneously.
    if (audioState.isPlaying) {
      return;
    }

    if (!isVisible) return;
    if (!activeContext.isStudyView || !activeContext.surah) return;
    if (now - lastInteractionTs > IDLE_THRESHOLD_MS) return;

    addStudyTickSync(activeContext.surah, activeContext.ayah, 1, false);
  }

  async function flushNow() {
    if (dirtyEntries.size === 0) return false;
    if (!global.QuranDB || typeof global.QuranDB.upsertReadingHistoryEntry !== 'function') {
      return false;
    }

    const toPersist = Array.from(dirtyEntries.values()).map((e) => ({
      ...e,
      read_word_keys: [...e.read_word_keys],
      listen_word_keys: [...e.listen_word_keys]
    }));

    try {
      for (const entry of toPersist) {
        await global.QuranDB.upsertReadingHistoryEntry(entry);
      }
      if (typeof global.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        global.dispatchEvent(new CustomEvent('quran-reading-history-updated'));
      }
      if (global.SupabaseSync && typeof global.SupabaseSync.scheduleReadingHistorySync === 'function') {
        global.SupabaseSync.scheduleReadingHistorySync();
      }
      return true;
    } catch (err) {
      console.warn('[ReadingHistory] Flush notice:', err);
      return false;
    }
  }

  async function getAllEntries() {
    await flushNow();
    if (!global.QuranDB || typeof global.QuranDB.getAllReadingHistory !== 'function') {
      return Array.from(dirtyEntries.values());
    }
    try {
      const rows = await global.QuranDB.getAllReadingHistory();
      return (rows || []).map(normalizeEntry);
    } catch (e) {
      return Array.from(dirtyEntries.values());
    }
  }

  function summarizeTotals(entries, todayKey = getLocalDateKey()) {
    let todaySeconds = 0;
    let totalSeconds = 0;
    let todayReadWords = 0;
    let todayListenCount = 0;
    let todaySurahListens = 0;
    let totalReadWords = 0;
    let totalListenCount = 0;
    const activeDates = new Set();

    for (const raw of entries || []) {
      const e = normalizeEntry(raw);
      const hasActivity = e.total_seconds > 0 || e.read_count > 0 || e.listen_count > 0 || e.surah_listen_count > 0;
      if (!hasActivity) continue;

      activeDates.add(e.activity_date);
      totalSeconds += e.total_seconds;
      totalReadWords += e.read_count;
      totalListenCount += e.listen_count + e.surah_listen_count;

      if (e.activity_date === todayKey) {
        todaySeconds += e.total_seconds;
        todayReadWords += e.read_count;
        todayListenCount += e.listen_count + e.surah_listen_count;
        todaySurahListens += e.surah_listen_count;
      }
    }

    return {
      todaySeconds,
      totalSeconds,
      todayReadWords,
      todayListenCount,
      todaySurahListens,
      totalReadWords,
      totalListenCount,
      activeDaysCount: activeDates.size
    };
  }

  function groupByDateAndSurah(entries, opts = {}) {
    const activityFilter = opts.activityFilter || 'all';
    const rangeFilter = opts.rangeFilter || '30d';
    const todayKey = opts.todayKey || getLocalDateKey();
    const maxAgeDays = rangeFilter === '7d' ? 6 : (rangeFilter === '30d' ? 29 : Infinity);

    const grouped = new Map();
    for (const raw of entries || []) {
      const e = normalizeEntry(raw);
      const hasRead = e.read_count > 0 || e.read_word_keys.length > 0 || e.read_seconds > 0;
      const hasListen = e.listen_count > 0 || e.listen_word_keys.length > 0 || e.surah_listen_count > 0 || e.listen_seconds > 0;
      const hasAny = hasRead || hasListen || e.total_seconds > 0;

      if (!hasAny) continue;
      if (activityFilter === 'read' && !hasRead) continue;
      if (activityFilter === 'listen' && !hasListen) continue;

      if (Number.isFinite(maxAgeDays)) {
        const age = diffDaysBetweenKeys(todayKey, e.activity_date);
        if (age < 0 || age > maxAgeDays) continue;
      }

      const list = grouped.get(e.activity_date) || [];
      list.push(e);
      grouped.set(e.activity_date, list);
    }

    const sortedDates = Array.from(grouped.keys()).sort((a, b) => (a < b ? 1 : (a > b ? -1 : 0)));

    return sortedDates.map((dateKey) => {
      const items = (grouped.get(dateKey) || []).sort((a, b) => {
        if (b.updated_at !== a.updated_at) return b.updated_at - a.updated_at;
        return a.surah - b.surah;
      });

      let dayTotalSeconds = 0;
      let dayReadWords = 0;
      let dayListenCount = 0;
      let daySurahListens = 0;
      for (const item of items) {
        if (activityFilter === 'read') dayTotalSeconds += item.read_seconds;
        else if (activityFilter === 'listen') dayTotalSeconds += item.listen_seconds;
        else dayTotalSeconds += item.total_seconds;
        dayReadWords += item.read_count;
        dayListenCount += item.listen_count;
        daySurahListens += item.surah_listen_count;
      }

      return {
        activity_date: dateKey,
        headingBn: formatDateHeadingBn(dateKey, todayKey),
        dayTotalSeconds,
        dayReadWords,
        dayListenCount,
        daySurahListens,
        items
      };
    });
  }

  function paginateHistoryGroups(groups, limit = 10) {
    const safeGroups = Array.isArray(groups) ? groups : [];
    const safeLimit = Math.max(1, Math.floor(Number(limit) || 10));

    let totalItems = 0;
    for (const g of safeGroups) {
      totalItems += Array.isArray(g.items) ? g.items.length : 0;
    }

    const visibleGroups = [];
    let shownItems = 0;

    for (const g of safeGroups) {
      if (shownItems >= safeLimit) break;
      const items = Array.isArray(g.items) ? g.items : [];
      if (items.length === 0) continue;

      const remainingSlot = safeLimit - shownItems;
      const sliced = items.slice(0, remainingSlot);
      if (sliced.length > 0) {
        visibleGroups.push({
          ...g,
          items: sliced
        });
        shownItems += sliced.length;
      }
    }

    const remainingItems = Math.max(0, totalItems - shownItems);
    return {
      visibleGroups,
      totalItems,
      shownItems,
      remainingItems,
      hasMore: remainingItems > 0
    };
  }

  function init() {
    if (initialized) return;
    initialized = true;

    const activityEvents = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    activityEvents.forEach((evtName) => {
      global.addEventListener(evtName, markUserInteraction, { passive: true });
    });

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          flushNow();
        } else {
          markUserInteraction();
        }
      });
    }

    global.addEventListener('pagehide', () => {
      flushNow();
    });

    // Clear dirty cache after cloud merge so fresh merged data is read
    global.addEventListener('quran-cloud-synced', () => {
      dirtyEntries.clear();
    });

    heartbeatTimer = setInterval(onHeartbeatTick, 1000);
    flushTimer = setInterval(() => {
      flushNow();
    }, FLUSH_INTERVAL_MS);
  }

  init();

  global.ReadingHistory = {
    init,
    getLocalDateKey,
    makeHistoryId,
    normalizeEntry,
    mergeEntries,
    formatDurationBn,
    formatCompactDurationBn,
    formatDateHeadingBn,
    setActiveContext,
    setAudioPlaying,
    recordWordRead,
    recordWordListen,
    recordAyahListen,
    recordSurahRecitationStart,
    recordSurahRecitationTick,
    resetRecitationCursor,
    addStudyTickSync,
    flushNow,
    getAllEntries,
    summarizeTotals,
    groupByDateAndSurah,
    paginateHistoryGroups
  };
})(typeof window !== 'undefined' ? window : globalThis);
