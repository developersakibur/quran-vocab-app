/* ============================================================
   FONT SETTINGS MANAGER
   Controls live Arabic and Bangla font scaling across reading views
   with instant CSS custom properties and localStorage persistence.
   ============================================================ */
(function (global) {
  const ARABIC_KEY = 'quran-app:arabic-font-scale';
  const BANGLA_KEY = 'quran-app:bangla-font-scale';

  const BOUNDS = {
    min: 0.75,
    max: 1.6,
    step: 0.05,
    defaultScale: 1.0
  };

  const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  const listeners = new Set();

  function toBnDigits(val) {
    return String(val).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
  }

  function clampScale(raw) {
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
      return BOUNDS.defaultScale;
    }
    const num = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(num)) return BOUNDS.defaultScale;
    const clamped = Math.min(BOUNDS.max, Math.max(BOUNDS.min, num));
    const snapped = BOUNDS.min + Math.round((clamped - BOUNDS.min) / BOUNDS.step) * BOUNDS.step;
    return Math.round(Math.min(BOUNDS.max, Math.max(BOUNDS.min, snapped)) * 100) / 100;
  }

  function formatPercentBn(scale) {
    return `${toBnDigits(Math.round(clampScale(scale) * 100))}%`;
  }

  function readStoredScale(key) {
    try {
      const val = localStorage.getItem(key);
      return val !== null ? clampScale(val) : BOUNDS.defaultScale;
    } catch (e) {
      return BOUNDS.defaultScale;
    }
  }

  let scales = {
    arabic: readStoredScale(ARABIC_KEY),
    bangla: readStoredScale(BANGLA_KEY)
  };

  function applyRootVariables() {
    const root = document.documentElement;
    if (!root) return;
    root.style.setProperty('--arabic-scale', String(scales.arabic));
    root.style.setProperty('--bangla-scale', String(scales.bangla));
  }

  function syncSidebarUI() {
    const arSlider = document.getElementById('sidebar-font-arabic-range');
    const arVal = document.getElementById('sidebar-font-arabic-val');
    const arDec = document.getElementById('sidebar-font-arabic-dec');
    const arInc = document.getElementById('sidebar-font-arabic-inc');

    const bnSlider = document.getElementById('sidebar-font-bangla-range');
    const bnVal = document.getElementById('sidebar-font-bangla-val');
    const bnDec = document.getElementById('sidebar-font-bangla-dec');
    const bnInc = document.getElementById('sidebar-font-bangla-inc');

    const resetBtn = document.getElementById('sidebar-font-reset-btn');

    if (arSlider) arSlider.value = String(scales.arabic);
    if (arVal) arVal.textContent = formatPercentBn(scales.arabic);
    if (arDec) arDec.disabled = scales.arabic <= BOUNDS.min;
    if (arInc) arInc.disabled = scales.arabic >= BOUNDS.max;

    if (bnSlider) bnSlider.value = String(scales.bangla);
    if (bnVal) bnVal.textContent = formatPercentBn(scales.bangla);
    if (bnDec) bnDec.disabled = scales.bangla <= BOUNDS.min;
    if (bnInc) bnInc.disabled = scales.bangla >= BOUNDS.max;

    if (resetBtn) {
      const isDefault = scales.arabic === BOUNDS.defaultScale && scales.bangla === BOUNDS.defaultScale;
      resetBtn.disabled = isDefault;
    }
  }

  function persistAndNotify() {
    applyRootVariables();
    try {
      localStorage.setItem(ARABIC_KEY, String(scales.arabic));
      localStorage.setItem(BANGLA_KEY, String(scales.bangla));
    } catch (e) {}
    syncSidebarUI();
    listeners.forEach((cb) => {
      try {
        cb({ ...scales });
      } catch (e) {}
    });
  }

  function setArabicScale(val) {
    scales.arabic = clampScale(val);
    persistAndNotify();
    return scales.arabic;
  }

  function setBanglaScale(val) {
    scales.bangla = clampScale(val);
    persistAndNotify();
    return scales.bangla;
  }

  function stepArabic(delta) {
    return setArabicScale(scales.arabic + (delta > 0 ? BOUNDS.step : -BOUNDS.step));
  }

  function stepBangla(delta) {
    return setBanglaScale(scales.bangla + (delta > 0 ? BOUNDS.step : -BOUNDS.step));
  }

  function resetScales() {
    scales.arabic = BOUNDS.defaultScale;
    scales.bangla = BOUNDS.defaultScale;
    persistAndNotify();
    return { ...scales };
  }

  function bindSidebarControls() {
    const arSlider = document.getElementById('sidebar-font-arabic-range');
    const arDec = document.getElementById('sidebar-font-arabic-dec');
    const arInc = document.getElementById('sidebar-font-arabic-inc');

    const bnSlider = document.getElementById('sidebar-font-bangla-range');
    const bnDec = document.getElementById('sidebar-font-bangla-dec');
    const bnInc = document.getElementById('sidebar-font-bangla-inc');

    const resetBtn = document.getElementById('sidebar-font-reset-btn');

    if (arSlider) {
      arSlider.oninput = (e) => setArabicScale(e.target.value);
      arSlider.onchange = (e) => setArabicScale(e.target.value);
    }
    if (arDec) arDec.onclick = () => stepArabic(-1);
    if (arInc) arInc.onclick = () => stepArabic(1);

    if (bnSlider) {
      bnSlider.oninput = (e) => setBanglaScale(e.target.value);
      bnSlider.onchange = (e) => setBanglaScale(e.target.value);
    }
    if (bnDec) bnDec.onclick = () => stepBangla(-1);
    if (bnInc) bnInc.onclick = () => stepBangla(1);

    if (resetBtn) resetBtn.onclick = () => resetScales();

    syncSidebarUI();
  }

  // Apply CSS vars immediately before first paint
  applyRootVariables();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindSidebarControls);
  } else {
    bindSidebarControls();
  }

  global.FontSettings = {
    bounds: { ...BOUNDS },
    getScales: () => ({ ...scales }),
    setArabicScale,
    setBanglaScale,
    stepArabic,
    stepBangla,
    resetScales,
    syncUI: syncSidebarUI,
    formatPercentBn,
    onChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
