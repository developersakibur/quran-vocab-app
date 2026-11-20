/* ============================================================
   PWA INSTALL PROMPT & OFFLINE CONNECTIVITY INDICATOR
   - Captures beforeinstallprompt for one-tap install in sidebar.
   - Auto-hides when already running in standalone mode.
   - Provides guided instructions modal for iOS Safari users.
   - Displays a subtle non-intrusive banner when offline.
   ============================================================ */
(function () {
  let deferredPrompt = null;
  let isInstalled = false;
  let isIOS = false;

  function detectEnvironment() {
    isInstalled =
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;

    const ua = (window.navigator.userAgent || '').toLowerCase();
    isIOS = /iphone|ipad|ipod/.test(ua);
  }

  function updateInstallButtonUI() {
    const btn = document.getElementById('sidebar-install-btn');
    if (!btn) return;

    const labelEl = document.getElementById('sidebar-install-label');
    const subEl = document.getElementById('sidebar-install-sub');
    const badgeEl = document.getElementById('sidebar-install-badge');

    if (isInstalled) {
      btn.style.display = 'none';
      return;
    }

    if (deferredPrompt) {
      btn.style.display = 'flex';
      if (labelEl) labelEl.textContent = 'অ্যাপ ইনস্টল করুন';
      if (subEl) subEl.textContent = 'অফলাইনে দ্রুত ওপেন করতে হোম স্ক্রিনে রাখুন';
      if (badgeEl) badgeEl.textContent = 'ইনস্টল';
      return;
    }

    if (isIOS) {
      btn.style.display = 'flex';
      if (labelEl) labelEl.textContent = 'হোম স্ক্রিনে যোগ করুন';
      if (subEl) subEl.textContent = 'iPhone/iPad-এ অ্যাপ হিসেবে ব্যবহার করুন';
      if (badgeEl) badgeEl.textContent = 'iOS';
      return;
    }

    btn.style.display = 'none';
  }

  function updateOfflineBanner() {
    const banner = document.getElementById('pwa-offline-banner');
    if (!banner) return;
    const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
    banner.classList.toggle('visible', !online);
    banner.setAttribute('aria-hidden', online ? 'true' : 'false');
  }

  async function triggerInstall() {
    if (isInstalled) return false;

    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice && choice.outcome === 'accepted') {
          isInstalled = true;
          deferredPrompt = null;
          updateInstallButtonUI();
          if (window.UIOverlay && typeof window.UIOverlay.toast === 'function') {
            window.UIOverlay.toast({ message: 'অ্যাপটি সফলভাবে ইনস্টল হচ্ছে', type: 'success' });
          }
          return true;
        }
      } catch (e) {}
      return false;
    }

    if (isIOS) {
      if (window.UIOverlay && typeof window.UIOverlay.alert === 'function') {
        window.UIOverlay.alert({
          title: 'iPhone / iPad-এ ইনস্টল করুন',
          message: '১. Safari ব্রাউজারের নিচের Share বাটনে ট্যাপ করুন।\n২. নিচে স্ক্রল করে "Add to Home Screen" বাছাই করুন।\n৩. উপরে "Add" বাটনে ট্যাপ করুন।',
          type: 'info'
        });
      }
      return false;
    }

    return false;
  }

  function init() {
    detectEnvironment();
    updateInstallButtonUI();
    updateOfflineBanner();

    const btn = document.getElementById('sidebar-install-btn');
    if (btn && !btn.dataset.pwaBound) {
      btn.dataset.pwaBound = '1';
      btn.addEventListener('click', () => {
        triggerInstall();
      });
    }
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    updateInstallButtonUI();
  });

  window.addEventListener('appinstalled', () => {
    isInstalled = true;
    deferredPrompt = null;
    updateInstallButtonUI();
  });

  window.addEventListener('online', updateOfflineBanner);
  window.addEventListener('offline', updateOfflineBanner);

  window.PWAInstall = {
    init,
    triggerInstall,
    syncUI: () => {
      detectEnvironment();
      updateInstallButtonUI();
      updateOfflineBanner();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
