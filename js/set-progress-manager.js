/* ============================================================
   SET PROGRESS MANAGER
   For surahs too large to quiz in one sitting, words are split
   into fixed-size sets (see QURAN_APP_CONFIG.SET_SIZE). This
   tracks progress per (surah, set) pair, separately from the
   whole-surah ProgressManager used for short surahs.
   Storage goes through StorageManager only.
   ============================================================ */
(function (global) {
  const KEY = 'set-progress-v1';

  function setKey(surahNum, setIndex) {
    return `${surahNum}:${setIndex}`;
  }

  function readAll() {
    return StorageManager.get(KEY, {});
  }

  function writeAll(data) {
    StorageManager.set(KEY, data);
  }

  function getSetProgress(surahNum, setIndex) {
    const all = readAll();
    return all[setKey(surahNum, setIndex)] || { bestPercent: 0, attempts: 0, passed: false };
  }

  function recordSetAttempt(surahNum, setIndex, percent, passThreshold) {
    const all = readAll();
    const key = setKey(surahNum, setIndex);
    const existing = all[key] || { bestPercent: 0, attempts: 0, passed: false };
    existing.attempts += 1;
    existing.bestPercent = Math.max(existing.bestPercent, percent);
    existing.lastPercent = percent;
    if (percent / 100 >= passThreshold) existing.passed = true;
    all[key] = existing;
    writeAll(all);
    return existing;
  }

  /** How many of a surah's sets are passed, out of totalSets. */
  function getSurahSetStats(surahNum, totalSets) {
    const all = readAll();
    let completed = 0;
    for (let i = 1; i <= totalSets; i++) {
      const p = all[setKey(surahNum, i)];
      if (p && p.passed) completed++;
    }
    return { completed, total: totalSets };
  }

  global.SetProgressManager = { getSetProgress, recordSetAttempt, getSurahSetStats };
})(window);
