/* ============================================================
   STORAGE MANAGER
   Single entry point for all localStorage access in the app.
   No other file should call localStorage directly — this keeps
   a future migration (e.g. to Firebase / IndexedDB) to one file.
   ============================================================ */
(function (global) {
  const PREFIX = 'quran-app:';

  function get(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false; // storage full or unavailable — caller decides how to handle
    }
  }

  function remove(key) {
    try {
      localStorage.removeItem(PREFIX + key);
      return true;
    } catch (e) {
      return false;
    }
  }

  global.StorageManager = { get, set, remove };
})(window);
