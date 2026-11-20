/* ============================================================
   APP CONFIG
   Shared constants used across pages.
   ============================================================ */
window.QURAN_APP_CONFIG = {
  SET_SIZE: 20,          // words per set, for surahs too large to quiz in one go
  PASS_THRESHOLD: 0.8,

  // Background Pre-caching System
  // Set to false during development if you want to avoid background network traffic.
  // When true, gently pre-caches remaining Surahs in the background during browser idle time.
  ENABLE_BACKGROUND_PRECACHE: true,
  PRECACHE_IDLE_DELAY_MS: 3000 // gentle 3-second throttle between background surah loads
};
