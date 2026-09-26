(function () {
  const STORAGE_KEY = 'quran-app-theme';
  const root = document.documentElement;

  function apply(theme) {
    root.setAttribute('data-theme', theme);
  }

  function current() {
    return localStorage.getItem(STORAGE_KEY) || 'light';
  }

  apply(current());

  window.toggleTheme = function () {
    const next = current() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    apply(next);
    const icon = document.getElementById('theme-icon');
    if (icon) icon.textContent = next === 'dark' ? '☀️' : '🌙';
  };

  document.addEventListener('DOMContentLoaded', function () {
    const icon = document.getElementById('theme-icon');
    if (icon) icon.textContent = current() === 'dark' ? '☀️' : '🌙';
  });
})();
