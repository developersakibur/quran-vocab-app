/* ============================================================
   SUPABASE SYNC & AUTH MANAGER
   Handles cloud user authentication and bi-directional sync
   between local IndexedDB / LocalStorage and Supabase.
   ============================================================ */
(function (global) {
  let client = null;
  let currentUser = null;
  let authListeners = [];
  let readingHistorySyncTimer = null;

  function getAuthRedirectUrl() {
    try {
      if (!global.location || !global.location.origin) return undefined;
      if (global.location.origin === 'null' || global.location.origin.startsWith('file:')) {
        return undefined;
      }
      return `${global.location.origin}${global.location.pathname || '/'}`;
    } catch (e) {
      return undefined;
    }
  }

  function detectAuthRedirectIntent() {
    try {
      const hash = (global.location && global.location.hash) || '';
      const search = (global.location && global.location.search) || '';
      const combined = `${search}&${hash}`;
      const isAuthCallback =
        combined.includes('access_token=') ||
        combined.includes('refresh_token=') ||
        combined.includes('type=signup') ||
        combined.includes('type=email') ||
        combined.includes('type=recovery') ||
        combined.includes('code=');
      const hasError = combined.includes('error=') || combined.includes('error_description=');
      if (!isAuthCallback && !hasError) return null;

      let errorDescription = '';
      if (hasError) {
        const params = new URLSearchParams(
          hash.startsWith('#') ? hash.slice(1) : (search.startsWith('?') ? search.slice(1) : '')
        );
        errorDescription = params.get('error_description') || params.get('error') || 'Verification link invalid or expired';
      }
      return { isAuthCallback, hasError, errorDescription };
    } catch (e) {
      return null;
    }
  }

  let pendingAuthCallback = null;

  function init() {
    if (client) return client;
    if (!global.supabase || !global.supabase.createClient) {
      console.warn('[Supabase] SDK bundle not loaded yet.');
      return null;
    }
    const config = global.SUPABASE_CONFIG;
    if (!config || !config.url || !config.anonKey) {
      console.warn('[Supabase] Missing configuration.');
      return null;
    }

    pendingAuthCallback = detectAuthRedirectIntent();

    try {
      client = global.supabase.createClient(config.url, config.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });

      if (pendingAuthCallback && pendingAuthCallback.hasError) {
        setTimeout(() => {
          if (typeof global.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
            global.dispatchEvent(new CustomEvent('quran-auth-redirect', {
              detail: { status: 'error', message: pendingAuthCallback.errorDescription }
            }));
          }
        }, 150);
      }

      // Listen for auth state changes
      client.auth.onAuthStateChange(async (event, session) => {
        currentUser = session ? session.user : null;
        console.log('[Supabase Auth]', event, currentUser ? currentUser.email : 'Signed Out');
        notifyAuthListeners(event, currentUser);
        if (currentUser && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
          if (pendingAuthCallback && pendingAuthCallback.isAuthCallback && !pendingAuthCallback.hasError) {
            pendingAuthCallback = null;
            if (typeof global.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
              global.dispatchEvent(new CustomEvent('quran-auth-redirect', {
                detail: { status: 'verified', user: currentUser }
              }));
            }
          }
          await syncFromCloud();
        }
      });

      // Check current session
      client.auth.getSession().then(({ data }) => {
        if (data && data.session) {
          currentUser = data.session.user;
          notifyAuthListeners('INITIAL_SESSION', currentUser);
        }
      }).catch((e) => console.warn('[Supabase] Session check warning:', e));

      return client;
    } catch (err) {
      console.error('[Supabase] Initialization failed:', err);
      return null;
    }
  }

  function getClient() {
    if (!client) init();
    return client;
  }

  function getUser() {
    return currentUser;
  }

  function onAuthState(callback) {
    if (typeof callback === 'function') {
      authListeners.push(callback);
      if (currentUser !== undefined) {
        callback(currentUser ? 'SIGNED_IN' : 'SIGNED_OUT', currentUser);
      }
    }
  }

  function notifyAuthListeners(event, user) {
    authListeners.forEach((fn) => {
      try {
        fn(event, user);
      } catch (e) {
        console.error(e);
      }
    });
  }

  // --- Auth Methods ---
  async function signUp(email, password, fullName = '') {
    const sb = getClient();
    if (!sb) throw new Error('Supabase client unavailable');
    const emailRedirectTo = getAuthRedirectUrl();
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        ...(emailRedirectTo ? { emailRedirectTo } : {}),
        data: {
          full_name: fullName.trim(),
          name: fullName.trim()
        }
      }
    });
    if (error) throw error;

    if (data && data.user) {
      try {
        await sb.from('profiles').upsert({
          id: data.user.id,
          email: email,
          display_name: fullName.trim(),
          updated_at: new Date().toISOString()
        });
      } catch (profileErr) {
        console.warn('[Supabase Profile Upsert notice]:', profileErr.message);
      }
    }
    return data;
  }

  async function resendVerification(email) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase client unavailable');
    const emailRedirectTo = getAuthRedirectUrl();
    const { data, error } = await sb.auth.resend({
      type: 'signup',
      email: email,
      ...(emailRedirectTo ? { options: { emailRedirectTo } } : {})
    });
    if (error) throw error;
    return data;
  }

  async function signIn(email, password) {
    const sb = getClient();
    if (!sb) throw new Error('Supabase client unavailable');
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    const sb = getClient();
    if (!sb) return;
    const { error } = await sb.auth.signOut();
    if (error) throw error;
    currentUser = null;
    notifyAuthListeners('SIGNED_OUT', null);
  }

  async function deleteCloudBookmark(wordId) {
    if (!currentUser || !wordId) return false;
    const sb = getClient();
    if (!sb) return false;
    try {
      await sb
        .from('user_bookmarks')
        .delete()
        .eq('user_id', currentUser.id)
        .eq('word_id', wordId);
      return true;
    } catch (err) {
      console.warn('[Supabase Sync] Bookmark delete notice:', err.message);
      return false;
    }
  }

  // --- Data Synchronization ---
  async function syncToCloud() {
    if (!currentUser) return false;
    const sb = getClient();
    if (!sb) return false;

    try {
      // 1. Sync Bookmarks
      if (global.QuranDB && global.QuranDB.getBookmarksList) {
        const localBookmarks = await global.QuranDB.getBookmarksList();
        if (localBookmarks && localBookmarks.length > 0) {
          const rows = localBookmarks.map((b) => ({
            user_id: currentUser.id,
            word_id: b.word_id,
            arabic: b.arabic || '',
            meaning_bn: b.meaning_bn || '',
            root: b.root || '',
            verse_key: b.verse_key || '',
            added_at: b.addedAt || Date.now()
          }));
          await sb.from('user_bookmarks').upsert(rows, { onConflict: 'user_id,word_id' });
        }
      }

      // 2. Sync Word Progress (unified from IndexedDB word_progress + StorageManager progress-v1)
      let progressMap = {};
      if (global.QuranDB && typeof global.QuranDB.getAllWordProgressMap === 'function') {
        progressMap = await global.QuranDB.getAllWordProgressMap();
      } else if (global.StorageManager) {
        progressMap = global.StorageManager.get('progress-v1', {});
      }

      const wordKeys = Object.keys(progressMap).filter((k) => k.includes(':'));
      if (wordKeys.length > 0) {
        // Keep StorageManager mirrored cleanly for fast access
        if (global.StorageManager) {
          const localP = global.StorageManager.get('progress-v1', {});
          wordKeys.forEach((k) => {
            const item = progressMap[k];
            if (!item) return;
            localP[k] = {
              word_id: k,
              box: item.box || 1,
              repetitions: item.repetitions || 0,
              intervalDays: item.intervalDays || item.interval || 1,
              easeFactor: item.easeFactor || 2.5,
              nextReview: item.nextReview || 0,
              lastReviewed: item.lastReviewed || 0,
              status: item.status || 'learning',
              correctCount: item.correctCount || 0,
              wrongCount: item.wrongCount || 0
            };
          });
          global.StorageManager.set('progress-v1', localP);
        }

        const rows = wordKeys.map((k) => {
          const item = progressMap[k];
          return {
            user_id: currentUser.id,
            word_id: k,
            box: item.box || 1,
            repetitions: item.repetitions || 0,
            interval_days: item.intervalDays || item.interval || 1,
            ease_factor: item.easeFactor || 2.5,
            next_review: item.nextReview || 0,
            last_reviewed: item.lastReviewed || 0,
            status: item.status || 'learning'
          };
        });
        await sb.from('user_progress').upsert(rows, { onConflict: 'user_id,word_id' });
      }

      // 3. Sync Reading & Listening History (isolated so missing table never blocks bookmarks/progress)
      await syncReadingHistoryToCloud();

      console.log('[Supabase Sync] Successfully pushed local data to cloud.');
      return true;
    } catch (err) {
      console.warn('[Supabase Sync] Sync to cloud notice (check if tables created):', err.message);
      return false;
    }
  }

  async function syncReadingHistoryToCloud() {
    if (!currentUser) return false;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    const sb = getClient();
    if (!sb) return false;
    if (!global.QuranDB || typeof global.QuranDB.getAllReadingHistory !== 'function') return false;

    try {
      const localHistory = await global.QuranDB.getAllReadingHistory();
      if (!Array.isArray(localHistory) || localHistory.length === 0) return true;

      const rows = localHistory
        .filter((h) => h && h.activity_date && h.surah)
        .map((h) => ({
          user_id: currentUser.id,
          activity_date: String(h.activity_date).slice(0, 10),
          surah: Math.max(1, Math.min(114, Math.floor(Number(h.surah)))),
          read_word_keys: Array.isArray(h.read_word_keys) ? h.read_word_keys : [],
          listen_word_keys: Array.isArray(h.listen_word_keys) ? h.listen_word_keys : [],
          read_count: Math.max(0, Math.floor(Number(h.read_count || 0))),
          listen_count: Math.max(0, Math.floor(Number(h.listen_count || 0))),
          surah_listen_count: Math.max(0, Math.floor(Number(h.surah_listen_count || 0))),
          read_seconds: Math.max(0, Math.floor(Number(h.read_seconds || 0))),
          listen_seconds: Math.max(0, Math.floor(Number(h.listen_seconds || 0))),
          total_seconds: Math.max(0, Math.floor(Number(h.total_seconds || 0))),
          last_ayah: Math.max(1, Math.floor(Number(h.last_ayah || 1))),
          updated_at: Math.max(0, Math.floor(Number(h.updated_at || Date.now())))
        }));

      if (rows.length === 0) return true;

      const { error } = await sb
        .from('user_reading_history')
        .upsert(rows, { onConflict: 'user_id,activity_date,surah' });
      if (error) {
        console.warn('[Supabase Sync] Reading history push notice:', error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('[Supabase Sync] Reading history push notice:', err && err.message ? err.message : err);
      return false;
    }
  }

  function scheduleReadingHistorySync(delayMs = 30_000) {
    if (!currentUser) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    clearTimeout(readingHistorySyncTimer);
    readingHistorySyncTimer = setTimeout(() => {
      syncReadingHistoryToCloud();
    }, delayMs);
  }

  async function syncFromCloud() {
    if (!currentUser) return false;
    const sb = getClient();
    if (!sb) return false;

    try {
      // 1. Fetch Cloud Bookmarks & merge into IndexedDB (skip re-upload loop)
      const { data: cloudBookmarks, error: bmErr } = await sb
        .from('user_bookmarks')
        .select('*')
        .eq('user_id', currentUser.id);

      if (!bmErr && Array.isArray(cloudBookmarks) && cloudBookmarks.length > 0) {
        if (global.QuranDB && global.QuranDB.toggleBookmark) {
          for (const cb of cloudBookmarks) {
            const isAlready = await global.QuranDB.isBookmarked(cb.word_id);
            if (!isAlready) {
              await global.QuranDB.toggleBookmark(
                cb.word_id,
                {
                  arabic: cb.arabic,
                  meaning_bn: cb.meaning_bn,
                  root: cb.root,
                  verse_key: cb.verse_key,
                  addedAt: cb.added_at
                },
                true
              );
            }
          }
        }
      }

      // 2. Fetch Cloud Progress & merge into both StorageManager & IndexedDB word_progress
      const { data: cloudProgress, error: prgErr } = await sb
        .from('user_progress')
        .select('*')
        .eq('user_id', currentUser.id);

      if (!prgErr && Array.isArray(cloudProgress) && cloudProgress.length > 0) {
        if (global.StorageManager) {
          const localProgress = global.StorageManager.get('progress-v1', {});
          cloudProgress.forEach((cp) => {
            if (!cp || !cp.word_id) return;
            const prev = localProgress[cp.word_id];
            const prevLast = prev ? Number(prev.lastReviewed || 0) : -1;
            const cloudLast = Number(cp.last_reviewed || 0);
            if (!prev || cloudLast > prevLast || (cloudLast === prevLast && Number(cp.repetitions || 0) >= Number(prev.repetitions || 0))) {
              localProgress[cp.word_id] = {
                word_id: cp.word_id,
                box: cp.box || 1,
                repetitions: cp.repetitions || 0,
                intervalDays: cp.interval_days || 1,
                easeFactor: cp.ease_factor || 2.5,
                nextReview: cp.next_review || 0,
                lastReviewed: cloudLast,
                status: cp.status || 'learning',
                correctCount: prev ? Number(prev.correctCount || 0) : 0,
                wrongCount: prev ? Number(prev.wrongCount || 0) : 0
              };
            }
          });
          global.StorageManager.set('progress-v1', localProgress);
        }

        if (global.QuranDB && typeof global.QuranDB.mergeCloudWordProgress === 'function') {
          await global.QuranDB.mergeCloudWordProgress(cloudProgress);
        }
      }

      // 3. Fetch Cloud Reading & Listening History & merge conflict-free into IndexedDB
      try {
        const { data: cloudHistory, error: histErr } = await sb
          .from('user_reading_history')
          .select('*')
          .eq('user_id', currentUser.id);

        if (!histErr && Array.isArray(cloudHistory) && cloudHistory.length > 0) {
          if (global.QuranDB && typeof global.QuranDB.mergeCloudReadingHistory === 'function') {
            await global.QuranDB.mergeCloudReadingHistory(cloudHistory);
          }
        }
        // Push any local-only offline history back up after pull
        await syncReadingHistoryToCloud();
      } catch (histSyncErr) {
        console.warn('[Supabase Sync] Reading history pull notice:', histSyncErr && histSyncErr.message ? histSyncErr.message : histSyncErr);
      }

      if (typeof global.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
        global.dispatchEvent(new CustomEvent('quran-cloud-synced', { detail: { userId: currentUser.id } }));
      }

      console.log('[Supabase Sync] Cloud data merged to local storage.');
      return true;
    } catch (err) {
      console.warn('[Supabase Sync] Sync from cloud notice:', err.message);
      return false;
    }
  }

  global.SupabaseSync = {
    init,
    getClient,
    getUser,
    signUp,
    signIn,
    signOut,
    resendVerification,
    syncToCloud,
    syncFromCloud,
    syncReadingHistoryToCloud,
    scheduleReadingHistorySync,
    deleteCloudBookmark,
    onAuthState
  };
})(window);
