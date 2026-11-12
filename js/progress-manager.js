/* ============================================================
   PROGRESS MANAGER
   Tracks per-surah quiz progress. Storage goes through
   StorageManager only — never touches localStorage directly.
   ============================================================ */
(function (global) {
  const KEY = 'progress-v1'; // StorageManager adds its own namespacing prefix

  function readAll() {
    return StorageManager.get(KEY, {});
  }

  function writeAll(data) {
    StorageManager.set(KEY, data);
  }

  function getSurahProgress(surahNum) {
    const all = readAll();
    return all[String(surahNum)] || { bestPercent: 0, attempts: 0, passed: false };
  }

  function recordAttempt(surahNum, percent, passThreshold) {
    const all = readAll();
    const key = String(surahNum);
    const existing = all[key] || { bestPercent: 0, attempts: 0, passed: false };
    existing.attempts += 1;
    existing.bestPercent = Math.max(existing.bestPercent, percent);
    existing.lastPercent = percent;
    if (percent / 100 >= passThreshold) existing.passed = true;
    all[key] = existing;
    writeAll(all);
    return existing;
  }

  function overallStats(totalSurahs) {
    const all = readAll();
    let completed = 0;
    Object.values(all).forEach(v => { if (v.passed) completed++; });
    return { completed, total: totalSurahs };
  }

  global.ProgressManager = { getSurahProgress, recordAttempt, overallStats };
})(window);
