/* ============================================================
   DOWNLOAD HEADER HELPER
   Monotonic, flicker-free header text and throttled DOM updates
   for parallel word-audio and full-surah recitation downloads.
   ============================================================ */
(function () {
  const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

  function toBn(val) {
    return String(val).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
  }

  function getSurahName(s, fallbackNum) {
    if (s) {
      return s.name_bn_script || s.name_bn || s.name_transliteration || `সূরা ${toBn(s.surah)}`;
    }
    return fallbackNum ? `সূরা ${toBn(fallbackNum)}` : 'সূরা';
  }

  function getLowestIncompleteSurah(meta, counts, type) {
    if (!Array.isArray(meta) || meta.length === 0) return null;
    const sorted = meta.slice().sort((a, b) => a.surah - b.surah);
    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i];
      const total = type === 'ayah' ? 1 : Math.max(1, s.total_words || 0);
      const done = (counts && counts[s.surah]) || 0;
      if (done < total) return s;
    }
    return null;
  }

  function countCompletedSurahs(meta, counts, type) {
    if (!Array.isArray(meta) || meta.length === 0) return 0;
    let completed = 0;
    for (let i = 0; i < meta.length; i++) {
      const s = meta[i];
      const total = type === 'ayah' ? 1 : Math.max(1, s.total_words || 0);
      if (((counts && counts[s.surah]) || 0) >= total) {
        completed++;
      }
    }
    return completed;
  }

  function formatParallelWordHeader(params) {
    const meta = (params && params.meta) || [];
    const counts = (params && params.counts) || {};
    const overallDone = (params && params.overallDone) || 0;
    const totalWords = (params && params.totalWords) || 0;

    const totalSurahs = meta.length || 114;
    const completedSurahs = countCompletedSurahs(meta, counts, 'word');
    const lowestIncomplete = getLowestIncompleteSurah(meta, counts, 'word');
    const percent = totalWords > 0
      ? Math.max(0, Math.min(100, Math.round((overallDone / totalWords) * 100)))
      : 0;

    if (!lowestIncomplete) {
      return {
        label: `সব শব্দ অডিও সম্পন্ন (${toBn(totalSurahs)}/${toBn(totalSurahs)})`,
        percent: 100,
        primarySurah: null
      };
    }

    return {
      label: `শব্দ অডিও • সূরা ${getSurahName(lowestIncomplete)} (${toBn(completedSurahs)}/${toBn(totalSurahs)})`,
      percent,
      primarySurah: lowestIncomplete.surah
    };
  }

  function formatParallelSurahHeader(params) {
    const meta = (params && params.meta) || [];
    const total = Math.max(1, (params && params.totalSurahs) || 114);
    const completed = Math.max(0, Math.min(total, (params && params.completedSurahs) || 0));
    const percent = Math.max(0, Math.min(100, Math.round((params && params.overallPercent) || 0)));
    const rawActive = (params && params.activeSurahs) || [];
    const sortedActive = Array.from(new Set(rawActive)).sort((a, b) => a - b);

    if (sortedActive.length === 0) {
      return {
        label: `তিলাওয়াত ডাউনলোড (${toBn(completed)}/${toBn(total)})`,
        percent,
        primarySurah: null
      };
    }

    const primaryNum = sortedActive[0];
    const primaryMeta = meta.find((s) => s.surah === primaryNum);
    const primaryName = getSurahName(primaryMeta, primaryNum);
    const extraCount = sortedActive.length - 1;
    const surahSegment = extraCount > 0
      ? `সূরা ${primaryName} + আরও ${toBn(extraCount)}টি`
      : `সূরা ${primaryName}`;

    return {
      label: `${surahSegment} • ${toBn(completed)}/${toBn(total)}`,
      percent,
      primarySurah: primaryNum
    };
  }

  function createThrottleGate(intervalMs) {
    const safeInterval = Math.max(50, Math.floor(intervalMs || 300));
    let lastEmitTs = -Infinity;
    return {
      shouldEmit(nowMs, force) {
        const ts = typeof nowMs === 'number' ? nowMs : Date.now();
        if (force || ts - lastEmitTs >= safeInterval) {
          lastEmitTs = ts;
          return true;
        }
        return false;
      },
      reset() {
        lastEmitTs = -Infinity;
      }
    };
  }

  /**
   * Updates a download button's icon and label without destroying its DOM tree
   * on every progress tick (prevents flicker & layout thrashing).
   */
  function setDownloadButtonState(btn, iconSvg, labelText) {
    if (!btn) return;
    let iconEl = btn.querySelector(':scope > .icon');
    let labelEl = btn.querySelector(':scope > .dl-btn-label');

    if (!iconEl || !labelEl) {
      btn.innerHTML = '';
      iconEl = document.createElement('span');
      iconEl.className = 'icon';
      labelEl = document.createElement('span');
      labelEl.className = 'dl-btn-label';
      btn.appendChild(iconEl);
      btn.appendChild(labelEl);
    }

    if (iconSvg && iconEl.dataset.iconKey !== iconSvg) {
      iconEl.innerHTML = iconSvg;
      iconEl.dataset.iconKey = iconSvg;
    }
    if (labelEl.textContent !== labelText) {
      labelEl.textContent = labelText;
    }
  }

  window.DownloadHeaderHelper = {
    getLowestIncompleteSurah,
    countCompletedSurahs,
    formatParallelWordHeader,
    formatParallelSurahHeader,
    createThrottleGate,
    setDownloadButtonState
  };
})();
