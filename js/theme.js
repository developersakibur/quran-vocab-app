(function () {
  const STORAGE_KEY = 'quran-app-theme';
  const root = document.documentElement;

  function apply(theme) {
    const normalized = theme === 'dark' ? 'dark' : 'light';
    root.setAttribute('data-theme', normalized);
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', normalized === 'dark' ? '#0F1A15' : '#0D5C3A');
    }
  }

  function current() {
    return localStorage.getItem(STORAGE_KEY) === 'dark' ? 'dark' : 'light';
  }

  function syncThemeUI() {
    const isDark = current() === 'dark';

    // Standalone topbar theme button (used on quiz.html / sets.html)
    const icon = document.getElementById('theme-icon');
    if (icon && window.Icons) {
      icon.innerHTML = isDark ? Icons.sun : Icons.moon;
    }

    // Sidebar Sun / Moon segmented theme toggle
    const sunIcon = document.getElementById('sidebar-sun-icon');
    const moonIcon = document.getElementById('sidebar-moon-icon');
    if (sunIcon && window.Icons && !sunIcon.dataset.rendered) {
      sunIcon.innerHTML = Icons.sun;
      sunIcon.dataset.rendered = '1';
    }
    if (moonIcon && window.Icons && !moonIcon.dataset.rendered) {
      moonIcon.innerHTML = Icons.moon;
      moonIcon.dataset.rendered = '1';
    }

    const lightBtn = document.getElementById('sidebar-theme-light');
    const darkBtn = document.getElementById('sidebar-theme-dark');
    if (lightBtn) {
      lightBtn.classList.toggle('active', !isDark);
      lightBtn.setAttribute('aria-pressed', !isDark ? 'true' : 'false');
    }
    if (darkBtn) {
      darkBtn.classList.toggle('active', isDark);
      darkBtn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
    }
  }

  apply(current());

  window.setTheme = function (theme) {
    const next = theme === 'dark' ? 'dark' : 'light';
    localStorage.setItem(STORAGE_KEY, next);
    apply(next);
    syncThemeUI();
  };

  window.toggleTheme = function () {
    const next = current() === 'dark' ? 'light' : 'dark';
    window.setTheme(next);
  };

  window.syncThemeUI = syncThemeUI;
  document.addEventListener('DOMContentLoaded', syncThemeUI);
})();
