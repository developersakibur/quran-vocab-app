/* ============================================================
   SUPABASE SYNC & AUTH MANAGER
   Handles cloud user authentication and bi-directional sync
   between local IndexedDB / LocalStorage and Supabase.
   ============================================================ */
(function (global) {
  let client = null;
  let currentUser = null;
  let authListeners = [];

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

    try {
      client = global.supabase.createClient(config.url, config.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });

      // Listen for auth state changes
      client.auth.onAuthStateChange(async (event, session) => {
        currentUser = session ? session.user : null;
        console.log('[Supabase Auth]', event, currentUser ? currentUser.email : 'Signed Out');
        notifyAuthListeners(event, currentUser);
        if (currentUser && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
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
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
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
    const { data, error } = await sb.auth.resend({
      type: 'signup',
      email: email
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

      // 2. Sync Progress
      if (global.StorageManager) {
        const progress = global.StorageManager.get('progress-v1', {});
        const keys = Object.keys(progress);
        if (keys.length > 0) {
          const rows = keys.map((k) => {
            const item = progress[k];
            return {
              user_id: currentUser.id,
              word_id: k,
              box: item.box || 1,
              repetitions: item.repetitions || 0,
              interval_days: item.intervalDays || 1,
              ease_factor: item.easeFactor || 2.5,
              next_review: item.nextReview || 0,
              last_reviewed: item.lastReviewed || 0,
              status: item.status || 'learning'
            };
          });
          await sb.from('user_progress').upsert(rows, { onConflict: 'user_id,word_id' });
        }
      }

      console.log('[Supabase Sync] Successfully pushed local data to cloud.');
      return true;
    } catch (err) {
      console.warn('[Supabase Sync] Sync to cloud notice (check if tables created):', err.message);
      return false;
    }
  }

  async function syncFromCloud() {
    if (!currentUser) return false;
    const sb = getClient();
    if (!sb) return false;

    try {
      // 1. Fetch Cloud Bookmarks & merge into IndexedDB
      const { data: cloudBookmarks, error: bmErr } = await sb
        .from('user_bookmarks')
        .select('*')
        .eq('user_id', currentUser.id);

      if (!bmErr && Array.isArray(cloudBookmarks) && cloudBookmarks.length > 0) {
        if (global.QuranDB && global.QuranDB.toggleBookmark) {
          for (const cb of cloudBookmarks) {
            const isAlready = await global.QuranDB.isBookmarked(cb.word_id);
            if (!isAlready) {
              await global.QuranDB.toggleBookmark(cb.word_id, {
                arabic: cb.arabic,
                meaning_bn: cb.meaning_bn,
                root: cb.root,
                verse_key: cb.verse_key
              });
            }
          }
        }
      }

      // 2. Fetch Cloud Progress & merge into StorageManager
      const { data: cloudProgress, error: prgErr } = await sb
        .from('user_progress')
        .select('*')
        .eq('user_id', currentUser.id);

      if (!prgErr && Array.isArray(cloudProgress) && cloudProgress.length > 0) {
        if (global.StorageManager) {
          const localProgress = global.StorageManager.get('progress-v1', {});
          cloudProgress.forEach((cp) => {
            localProgress[cp.word_id] = {
              box: cp.box,
              repetitions: cp.repetitions,
              intervalDays: cp.interval_days,
              easeFactor: cp.ease_factor,
              nextReview: cp.next_review,
              lastReviewed: cp.last_reviewed,
              status: cp.status
            };
          });
          global.StorageManager.set('progress-v1', localProgress);
        }
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
    onAuthState
  };
})(window);
