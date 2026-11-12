(function () {
  const STORAGE_KEY = 'quran-app-theme';
  const root = document.documentElement;

  function apply(theme) {
    root.setAttribute('data-theme', theme);
  }

  function current() {
    return localStorage.getItem(STORAGE_KEY) || 'light';
  }

  function setIcon() {
    const icon = document.getElementById('theme-icon');
    if (icon && window.Icons) {
      icon.innerHTML = current() === 'dark' ? Icons.sun : Icons.moon;
    }
  }

  apply(current());

  window.toggleTheme = function () {
    const next = current() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    apply(next);
    setIcon();
  };

  document.addEventListener('DOMContentLoaded', setIcon);
})();
