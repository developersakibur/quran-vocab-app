/* ============================================================
   QURAN STUDY FEATURES — BROWSER RUNTIME & UI MODULE
   Provides:
   1. 30-Juz (Para) Directory & Surah:Ayah Quick-Jump
   2. Global Arabic + Bangla + Root Search View (#view-search)
   3. Live Quran Coverage % & Daily Goal Widget
   4. Root Family & Verb Forms Explorer (#view-roots)
   5. Ayah Repeat / Range Loop Engine
   6. Custom Draggable Side Ayah Scrubber for Long Surahs
   ============================================================ */

(function (global) {
  'use strict';

  const TOTAL_QURAN_TOKENS = 77429;
  const DAILY_GOAL_PRESETS = [5, 10, 20, 30];
  const DAILY_GOAL_TARGET_KEY = 'quran-app:daily-goal-target';
  const DAILY_GOAL_PROGRESS_KEY = 'quran-app:daily-goal-progress';

  const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  const BN_TO_EN = {
    '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
    '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9'
  };

  function toBn(val) {
    return String(val ?? '').replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
  }

  function formatBnInt(num) {
    return toBn(Number(num || 0).toLocaleString('en-US'));
  }

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  const JUZ_DIRECTORY = [
    { juz: 1, nameAr: 'الم', nameBn: 'আলিফ-লাম-মীম', startSurah: 1, startAyah: 1, endSurah: 2, endAyah: 141 },
    { juz: 2, nameAr: 'سَيَقُولُ', nameBn: 'সায়াকূলু', startSurah: 2, startAyah: 142, endSurah: 2, endAyah: 252 },
    { juz: 3, nameAr: 'تِلْكَ الرُّسُلُ', nameBn: 'তিলকার রুসুলু', startSurah: 2, startAyah: 253, endSurah: 3, endAyah: 92 },
    { juz: 4, nameAr: 'لَنْ تَنَالُوا', nameBn: 'লান তানালু', startSurah: 3, startAyah: 93, endSurah: 4, endAyah: 23 },
    { juz: 5, nameAr: 'وَالْمُحْصَنَاتُ', nameBn: 'ওয়াল মুহসানাতু', startSurah: 4, startAyah: 24, endSurah: 4, endAyah: 147 },
    { juz: 6, nameAr: 'لَا يُحِبُّ اللَّهُ', nameBn: 'লা ইউহিব্বুল্লাহু', startSurah: 4, startAyah: 148, endSurah: 5, endAyah: 81 },
    { juz: 7, nameAr: 'وَإِذَا سَمِعُوا', nameBn: 'ওয়া ইযা সামিঊ', startSurah: 5, startAyah: 82, endSurah: 6, endAyah: 110 },
    { juz: 8, nameAr: 'وَلَوْ أَنَّنَا', nameBn: 'ওয়া লাও আন্নানা', startSurah: 6, startAyah: 111, endSurah: 7, endAyah: 87 },
    { juz: 9, nameAr: 'قَالَ الْمَلَأُ', nameBn: 'ক্বালাল মালাউ', startSurah: 7, startAyah: 88, endSurah: 8, endAyah: 40 },
    { juz: 10, nameAr: 'وَاعْلَمُوا', nameBn: 'ওয়া’লামূ', startSurah: 8, startAyah: 41, endSurah: 9, endAyah: 92 },
    { juz: 11, nameAr: 'يَعْتَذِرُونَ', nameBn: 'ইয়া’তাযিরূনা', startSurah: 9, startAyah: 93, endSurah: 11, endAyah: 5 },
    { juz: 12, nameAr: 'وَمَا مِنْ دَابَّةٍ', nameBn: 'ওয়া মা মিন দাব্বাতিন', startSurah: 11, startAyah: 6, endSurah: 12, endAyah: 52 },
    { juz: 13, nameAr: 'وَمَا أُبَرِّئُ', nameBn: 'ওয়া মা উবাররিউ', startSurah: 12, startAyah: 53, endSurah: 14, endAyah: 52 },
    { juz: 14, nameAr: 'رُبَمَا', nameBn: 'রুবামা', startSurah: 15, startAyah: 1, endSurah: 16, endAyah: 128 },
    { juz: 15, nameAr: 'سُبْحَانَ الَّذِي', nameBn: 'সুবহানাল্লাযী', startSurah: 17, startAyah: 1, endSurah: 18, endAyah: 74 },
    { juz: 16, nameAr: 'قَالَ أَلَمْ', nameBn: 'ক্বালা আলাম', startSurah: 18, startAyah: 75, endSurah: 20, endAyah: 135 },
    { juz: 17, nameAr: 'اقْتَرَبَ لِلنَّاسِ', nameBn: 'ইক্বতারাবা লিন্নাসি', startSurah: 21, startAyah: 1, endSurah: 22, endAyah: 78 },
    { juz: 18, nameAr: 'قَدْ أَفْلَحَ', nameBn: 'ক্বাদ আফলাহা', startSurah: 23, startAyah: 1, endSurah: 25, endAyah: 20 },
    { juz: 19, nameAr: 'وَقَالَ الَّذِينَ', nameBn: 'ওয়া ক্বালাল্লাযীনা', startSurah: 25, startAyah: 21, endSurah: 27, endAyah: 55 },
    { juz: 20, nameAr: 'أَمَّنْ خَلَقَ', nameBn: 'আম্মান খালাক্বা', startSurah: 27, startAyah: 56, endSurah: 29, endAyah: 45 },
    { juz: 21, nameAr: 'اتْلُ مَا أُوحِيَ', nameBn: 'উতলু মা ঊহিয়া', startSurah: 29, startAyah: 46, endSurah: 33, endAyah: 30 },
    { juz: 22, nameAr: 'وَمَنْ يَقْنُتْ', nameBn: 'ওয়া মাইঁ ইয়াক্বনুত', startSurah: 33, startAyah: 31, endSurah: 36, endAyah: 27 },
    { juz: 23, nameAr: 'وَمَا لِيَ', nameBn: 'ওয়া মালিয়া', startSurah: 36, startAyah: 28, endSurah: 39, endAyah: 31 },
    { juz: 24, nameAr: 'فَمَنْ أَظْلَمُ', nameBn: 'ফামান আযলামু', startSurah: 39, startAyah: 32, endSurah: 41, endAyah: 46 },
    { juz: 25, nameAr: 'إِلَيْهِ يُرَدُّ', nameBn: 'ইলাইহি ইউরাদ্দু', startSurah: 41, startAyah: 47, endSurah: 45, endAyah: 37 },
    { juz: 26, nameAr: 'حم', nameBn: 'হা-মীম', startSurah: 46, startAyah: 1, endSurah: 51, endAyah: 30 },
    { juz: 27, nameAr: 'قَالَ فَمَا خَطْبُكُمْ', nameBn: 'ক্বালা ফামা খাতবুকুম', startSurah: 51, startAyah: 31, endSurah: 57, endAyah: 29 },
    { juz: 28, nameAr: 'قَدْ سَمِعَ اللَّهُ', nameBn: 'ক্বাদ সামিআল্লাহু', startSurah: 58, startAyah: 1, endSurah: 66, endAyah: 12 },
    { juz: 29, nameAr: 'تَبَارَكَ الَّذِي', nameBn: 'তাবারাকাল্লাযী', startSurah: 67, startAyah: 1, endSurah: 77, endAyah: 50 },
    { juz: 30, nameAr: 'عَمَّ', nameBn: 'আম্মা (আম্মাপারা)', startSurah: 78, startAyah: 1, endSurah: 114, endAyah: 6 }
  ];

  function normalizeDigitsToAscii(input) {
    return String(input || '').replace(/[০-৯]/g, (ch) => BN_TO_EN[ch] ?? ch);
  }

  function parseSurahAyahJump(rawQuery, surahAyahTotals) {
    const normalized = normalizeDigitsToAscii(rawQuery).trim();
    if (!normalized) return null;

    const match = normalized.match(/^(\d{1,3})\s*[:./\-\s]\s*(\d{1,3})$/);
    if (!match) return null;

    const surah = parseInt(match[1], 10);
    const ayah = parseInt(match[2], 10);
    if (!Number.isInteger(surah) || surah < 1 || surah > 114) return null;
    if (!Number.isInteger(ayah) || ayah < 1) return null;

    if (surahAyahTotals) {
      const maxAyah = surahAyahTotals instanceof Map
        ? surahAyahTotals.get(surah)
        : surahAyahTotals[surah];
      if (typeof maxAyah === 'number' && maxAyah > 0 && ayah > maxAyah) {
        return null;
      }
    }
    return { surah, ayah };
  }

  function normalizeArabicForSearch(text) {
    return String(text || '')
      .normalize('NFC')
      .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640\u200C\u200D]/g, '')
      .replace(/[أإآٱٲٳٵ]/g, 'ا')
      .replace(/[ىيئ]/g, 'ي')
      .replace(/ؤ/g, 'و')
      .replace(/ة/g, 'ه')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function formatSpacedRoot(root) {
    const compact = String(root || '').replace(/\s+/g, '');
    if (!compact) return '';
    return Array.from(compact).join(' ');
  }

  function normalizeBanglaForSearch(text) {
    return String(text || '')
      .normalize('NFC')
      .replace(/য়/g, 'য়')
      .replace(/ড়/g, 'ড়')
      .replace(/ঢ়/g, 'ঢ়')
      .toLowerCase();
  }

  function searchGlobalQuranWords(entries, rawQuery, mode = 'all', limit = 60) {
    const trimmed = String(rawQuery || '').trim();
    if (!trimmed || !Array.isArray(entries) || entries.length === 0) return [];

    const qLower = normalizeBanglaForSearch(trimmed);
    const qAr = normalizeArabicForSearch(trimmed);
    const qRootCompact = qAr.replace(/\s+/g, '');
    const hasArabic = /[\u0600-\u06FF]/.test(trimmed);

    const ranked = [];

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e || e.length < 4) continue;
      const key = String(e[0] || '');
      const arabic = String(e[1] || '');
      const meaningBn = String(e[2] || '');
      const count = Number(e[3] || 0);
      const juz = Number(e[4] || 1);
      const root = String(e[5] || '');

      let bestScore = 0;
      let matchType = 'contains';

      if (mode === 'all' || mode === 'bangla') {
        const bnLower = normalizeBanglaForSearch(meaningBn);
        if (bnLower === qLower) {
          bestScore = Math.max(bestScore, 300);
          matchType = 'exact';
        } else if (bnLower.startsWith(qLower) || bnLower.includes(` ${qLower}`) || bnLower.includes(`(${qLower}`)) {
          if (bestScore < 200) {
            bestScore = 200;
            matchType = 'prefix';
          }
        } else if (bnLower.includes(qLower)) {
          if (bestScore < 100) {
            bestScore = 100;
            matchType = 'contains';
          }
        }
      }

      if ((mode === 'all' || mode === 'arabic') && qAr && hasArabic) {
        const wordAr = normalizeArabicForSearch(arabic);
        if (wordAr === qAr || arabic === trimmed) {
          bestScore = Math.max(bestScore, 320);
          matchType = 'exact';
        } else if (wordAr.startsWith(qAr)) {
          if (bestScore < 220) {
            bestScore = 220;
            matchType = 'prefix';
          }
        } else if (wordAr.includes(qAr)) {
          if (bestScore < 120) {
            bestScore = 120;
            matchType = 'contains';
          }
        }
      }

      if ((mode === 'all' || mode === 'root') && qRootCompact && root) {
        const rootNorm = normalizeArabicForSearch(root).replace(/\s+/g, '');
        if (rootNorm === qRootCompact) {
          bestScore = Math.max(bestScore, 310);
          matchType = 'exact';
        } else if (rootNorm.startsWith(qRootCompact)) {
          if (bestScore < 210) {
            bestScore = 210;
            matchType = 'prefix';
          }
        } else if (rootNorm.includes(qRootCompact)) {
          if (bestScore < 110) {
            bestScore = 110;
            matchType = 'contains';
          }
        }
      }

      if (bestScore > 0) {
        const parts = key.split(':');
        ranked.push({
          score: bestScore,
          item: {
            key,
            arabic,
            meaningBn,
            count,
            juz,
            root,
            surah: parseInt(parts[0], 10) || 1,
            ayah: parseInt(parts[1], 10) || 1,
            matchType
          }
        });
      }
    }

    ranked.sort((a, b) => (b.score - a.score) || (b.item.count - a.item.count));
    return ranked.slice(0, Math.max(1, limit)).map((r) => r.item);
  }

  function computeQuranCoverageStats(progressMap, frequencyEntries, totalTokens = TOTAL_QURAN_TOKENS) {
    const safeTotal = Math.max(1, Number(totalTokens || TOTAL_QURAN_TOKENS));
    const entries = Array.isArray(frequencyEntries) ? frequencyEntries : [];

    const byKey = new Map();
    const byExactArabic = new Map();
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) continue;
      byKey.set(entry[0], i);
      if (entry[1] && !byExactArabic.has(entry[1])) {
        byExactArabic.set(entry[1], i);
      }
    }

    const matchedEntryIndices = new Set();
    let learnedUniqueCount = 0;
    let fallbackUnindexedTokens = 0;

    for (const [mapKey, rec] of Object.entries(progressMap || {})) {
      if (!rec) continue;
      if (mapKey.startsWith('mcq_pass:') || mapKey.startsWith('ayah_pass:')) continue;
      const isLearned =
        rec.status === 'mastered' ||
        rec.status === 'learning' ||
        Number(rec.correctCount || 0) > 0 ||
        Number(rec.repetitions || 0) > 0;
      if (!isLearned) continue;

      learnedUniqueCount++;
      const wordId = rec.word_id || mapKey;
      let idx = byKey.get(wordId);
      if (idx === undefined && rec.arabic) {
        idx = byExactArabic.get(rec.arabic);
      }
      if (idx !== undefined) {
        matchedEntryIndices.add(idx);
      } else {
        fallbackUnindexedTokens += 1;
      }
    }

    let coveredTokens = fallbackUnindexedTokens;
    for (const idx of matchedEntryIndices) {
      coveredTokens += Number(entries[idx]?.[3] || 0);
    }
    coveredTokens = Math.min(safeTotal, coveredTokens);

    const rawPercent = (coveredTokens / safeTotal) * 100;
    const coveragePercent = Math.round(rawPercent * 10) / 10;

    const milestones = [5, 10, 20, 35, 50, 75, 100];
    let prevMilestone = 0;
    let nextMilestonePercent = 100;
    for (const m of milestones) {
      if (coveragePercent < m) {
        nextMilestonePercent = m;
        break;
      }
      prevMilestone = m;
    }

    const span = Math.max(1, nextMilestonePercent - prevMilestone);
    const milestoneProgressPercent = Math.max(
      0,
      Math.min(100, Math.round(((coveragePercent - prevMilestone) / span) * 100))
    );

    return {
      learnedUniqueCount,
      coveredTokens,
      totalTokens: safeTotal,
      coveragePercent,
      nextMilestonePercent,
      milestoneProgressPercent
    };
  }

  function getLocalDateKey(d = new Date()) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function normalizeDailyGoalTarget(target) {
    const n = Math.floor(Number(target));
    if (!Number.isFinite(n) || n < 5) return 10;
    return Math.min(100, n);
  }

  function getDailyGoalTarget() {
    try {
      const raw = localStorage.getItem(DAILY_GOAL_TARGET_KEY);
      if (!raw) return 10;
      return normalizeDailyGoalTarget(parseInt(raw, 10));
    } catch (_) {
      return 10;
    }
  }

  function setDailyGoalTarget(target) {
    const safe = normalizeDailyGoalTarget(target);
    try {
      localStorage.setItem(DAILY_GOAL_TARGET_KEY, String(safe));
    } catch (_) {}
    return safe;
  }

  function getTodayWordCount() {
    try {
      const raw = localStorage.getItem(DAILY_GOAL_PROGRESS_KEY);
      if (!raw) return 0;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.date === getLocalDateKey()) {
        return Math.max(0, parseInt(parsed.count, 10) || 0);
      }
      return 0;
    } catch (_) {
      return 0;
    }
  }

  function incrementTodayWordCount(delta = 1) {
    const today = getLocalDateKey();
    const current = getTodayWordCount();
    const next = Math.max(0, current + Math.max(1, Math.floor(delta || 1)));
    try {
      localStorage.setItem(DAILY_GOAL_PROGRESS_KEY, JSON.stringify({ date: today, count: next }));
    } catch (_) {}
    return next;
  }

  function computeDailyGoalState(todayCount, target) {
    const safeCount = Math.max(0, Math.floor(Number(todayCount) || 0));
    const safeTarget = normalizeDailyGoalTarget(target);
    const percent = Math.min(100, Math.round((safeCount / safeTarget) * 100));
    const remaining = Math.max(0, safeTarget - safeCount);
    return {
      todayCount: safeCount,
      target: safeTarget,
      percent,
      remaining,
      achieved: safeCount >= safeTarget
    };
  }

  function buildRootFamiliesIndex(frequencyEntries, sameRootMap) {
    const byRoot = new Map();
    const entries = Array.isArray(frequencyEntries) ? frequencyEntries : [];

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e || !e[5]) continue;
      const root = String(e[5]).trim();
      if (!root) continue;

      let bucket = byRoot.get(root);
      if (!bucket) {
        bucket = { totalFromFreq: 0, words: [] };
        byRoot.set(root, bucket);
      }
      const count = Math.max(1, Number(e[3] || 1));
      bucket.totalFromFreq += count;
      bucket.words.push({
        key: String(e[0]),
        arabic: String(e[1]),
        meaningBn: String(e[2] || ''),
        count,
        juz: Number(e[4] || 1)
      });
    }

    const families = [];
    for (const [root, bucket] of byRoot.entries()) {
      bucket.words.sort((a, b) => b.count - a.count);
      const sameRootCount = sameRootMap && Array.isArray(sameRootMap[root]) ? sameRootMap[root].length : 0;
      const totalOccurrences = Math.max(bucket.totalFromFreq, sameRootCount);
      const sampleMeaningBn = bucket.words
        .slice(0, 3)
        .map((w) => w.meaningBn)
        .filter(Boolean)
        .join(' · ');

      families.push({
        root,
        spacedRoot: formatSpacedRoot(root),
        totalOccurrences,
        uniqueWordCount: bucket.words.length,
        sampleMeaningBn,
        topWords: bucket.words
      });
    }

    families.sort((a, b) => (b.totalOccurrences - a.totalOccurrences) || (b.uniqueWordCount - a.uniqueWordCount));
    return families;
  }

  function filterRootFamilies(families, rawQuery) {
    const trimmed = String(rawQuery || '').trim();
    if (!trimmed) return families.slice();

    const qLower = trimmed.toLowerCase();
    const qRootCompact = normalizeArabicForSearch(trimmed).replace(/\s+/g, '');

    return families.filter((fam) => {
      if (qRootCompact && normalizeArabicForSearch(fam.root).replace(/\s+/g, '').includes(qRootCompact)) {
        return true;
      }
      if (fam.sampleMeaningBn.toLowerCase().includes(qLower)) {
        return true;
      }
      return fam.topWords.some(
        (w) =>
          w.meaningBn.toLowerCase().includes(qLower) ||
          (qRootCompact && normalizeArabicForSearch(w.arabic).includes(qRootCompact))
      );
    });
  }

  function evaluateAyahLoopTransition(curMs, ayahsMap, config) {
    if (!config || !config.enabled || !ayahsMap) return { action: 'none' };

    const startNum = Math.max(1, Math.floor(config.startAyah || 1));
    const endNum = config.mode === 'range'
      ? Math.max(startNum, Math.floor(config.endAyah || startNum))
      : startNum;

    const startData = ayahsMap[String(startNum)];
    const endData = ayahsMap[String(endNum)];
    if (!startData || !endData) return { action: 'none' };

    if (curMs < endData.timestamp_to - 35) {
      return { action: 'none' };
    }

    const nextCompletedLoops = (config.completedLoops || 0) + 1;
    if (config.repeatLimit === 0 || nextCompletedLoops < config.repeatLimit) {
      return {
        action: 'seek',
        targetMs: Math.max(0, startData.timestamp_from),
        nextCompletedLoops
      };
    }

    return {
      action: 'complete',
      nextCompletedLoops
    };
  }

  function computeScrubberAyahFromRatio(ratio, totalAyahs) {
    const safeTotal = Math.max(1, Math.floor(Number(totalAyahs) || 1));
    const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
    return Math.max(1, Math.min(safeTotal, Math.round(clamped * (safeTotal - 1)) + 1));
  }

  function computeScrubberRatioFromAyah(currentAyah, totalAyahs) {
    const safeTotal = Math.max(1, Math.floor(Number(totalAyahs) || 1));
    if (safeTotal <= 1) return 0;
    const clamped = Math.max(1, Math.min(safeTotal, Math.floor(Number(currentAyah) || 1)));
    return (clamped - 1) / (safeTotal - 1);
  }

  // ============================================================
  // LAZY CACHED LOOKUP LOADERS (Zero redundant network hits)
  // ============================================================
  let freqIndexPromise = null;
  let sameRootPromise = null;
  let verbFormsPromise = null;
  let cachedRootFamilies = null;

  async function loadFrequencyIndex() {
    if (!freqIndexPromise) {
      freqIndexPromise = fetch('data/lookup/frequency-index.json?v=34')
        .then((r) => {
          if (!r.ok) throw new Error('Failed to load frequency index');
          return r.json();
        })
        .catch((err) => {
          freqIndexPromise = null;
          throw err;
        });
    }
    return freqIndexPromise;
  }

  async function loadSameRootMap() {
    if (!sameRootPromise) {
      sameRootPromise = fetch('data/lookup/same-root.json?v=34')
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}));
    }
    return sameRootPromise;
  }

  async function loadVerbFormsMap() {
    if (!verbFormsPromise) {
      verbFormsPromise = fetch('data/lookup/verb-forms.json?v=34')
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({}));
    }
    return verbFormsPromise;
  }

  async function loadRootFamilies() {
    if (cachedRootFamilies) return cachedRootFamilies;
    const [freqData, sameRootMap] = await Promise.all([
      loadFrequencyIndex(),
      loadSameRootMap()
    ]);
    cachedRootFamilies = buildRootFamiliesIndex(freqData.entries || [], sameRootMap);
    return cachedRootFamilies;
  }

  // ============================================================
  // UI 1: LIVE QURAN COVERAGE % & DAILY GOAL WIDGET
  // ============================================================
  async function renderCoverageAndDailyGoalWidget(mountEl, options = {}) {
    if (!mountEl) return;
    const compact = Boolean(options.compact);

    try {
      const [progressMap, freqData] = await Promise.all([
        global.QuranDB && typeof global.QuranDB.getAllWordProgressMap === 'function'
          ? global.QuranDB.getAllWordProgressMap()
          : Promise.resolve({}),
        loadFrequencyIndex().catch(() => ({ totalTokens: TOTAL_QURAN_TOKENS, entries: [] }))
      ]);

      const coverage = computeQuranCoverageStats(
        progressMap,
        freqData.entries || [],
        freqData.totalTokens || TOTAL_QURAN_TOKENS
      );

      let dailyGoalTarget = getDailyGoalTarget();
      const todayCount = getTodayWordCount();
      let goal = computeDailyGoalState(todayCount, dailyGoalTarget);

      const draw = () => {
        goal = computeDailyGoalState(getTodayWordCount(), dailyGoalTarget);
        const pctStr = toBn(coverage.coveragePercent.toFixed(1));
        const radius = 26;
        const circumference = 2 * Math.PI * radius;
        const dashOffset = circumference * (1 - goal.percent / 100);

        if (compact) {
          mountEl.innerHTML = `
            <div class="study-coverage-strip" aria-label="কুরআন বোঝার অগ্রগতি ও দৈনিক লক্ষ্য">
              <div class="study-coverage-strip-left">
                <div class="study-coverage-strip-title">
                  কুরআনের <strong class="tabular-nums">${pctStr}%</strong> শব্দ আপনার জানা
                </div>
                <div class="study-coverage-strip-sub tabular-nums">
                  ${formatBnInt(coverage.learnedUniqueCount)}টি ইউনিক শব্দ · ${formatBnInt(coverage.coveredTokens)} / ${formatBnInt(coverage.totalTokens)} বার
                </div>
              </div>
              <div class="study-coverage-strip-right tabular-nums">
                <span class="study-goal-chip ${goal.achieved ? 'achieved' : ''}">
                  আজ: ${toBn(goal.todayCount)}/${toBn(goal.target)}
                </span>
              </div>
            </div>
          `;
          return;
        }

        mountEl.innerHTML = `
          <section class="study-coverage-card" aria-label="কুরআন বোঝার লাইভ অগ্রগতি ও দৈনিক লক্ষ্য">
            <div class="study-coverage-grid">
              <!-- Live Quran Understanding % -->
              <div class="study-coverage-col">
                <div class="study-kicker">কুরআন বোঝার অগ্রগতি</div>
                <div class="study-coverage-hero-row">
                  <strong class="study-coverage-pct tabular-nums">${pctStr}%</strong>
                  <span class="study-coverage-sub tabular-nums">
                    ${formatBnInt(coverage.coveredTokens)} / ${formatBnInt(coverage.totalTokens)} শব্দ
                  </span>
                </div>
                <div class="study-progress-track" role="progressbar" aria-valuenow="${coverage.milestoneProgressPercent}" aria-valuemin="0" aria-valuemax="100">
                  <div class="study-progress-fill" style="width:${Math.max(coverage.coveragePercent > 0 ? 4 : 0, coverage.milestoneProgressPercent)}%"></div>
                </div>
                <div class="study-coverage-meta tabular-nums">
                  <span>শেখা শব্দ: <strong>${formatBnInt(coverage.learnedUniqueCount)}টি</strong></span>
                  <span aria-hidden="true">·</span>
                  <span>পরবর্তী লক্ষ্য: <strong>${toBn(coverage.nextMilestonePercent)}%</strong></span>
                </div>
              </div>

              <!-- Daily Goal Ring & Target Presets -->
              <div class="study-goal-col">
                <div class="study-goal-ring-wrap">
                  <svg class="study-goal-svg" viewBox="0 0 64 64" aria-hidden="true">
                    <circle class="study-goal-track" cx="32" cy="32" r="${radius}" />
                    <circle class="study-goal-arc ${goal.achieved ? 'achieved' : ''}" cx="32" cy="32" r="${radius}"
                      stroke-dasharray="${circumference.toFixed(1)}"
                      stroke-dashoffset="${dashOffset.toFixed(1)}" />
                  </svg>
                  <div class="study-goal-ring-label tabular-nums">
                    <strong>${toBn(goal.todayCount)}</strong>
                    <span>/${toBn(goal.target)}</span>
                  </div>
                </div>
                <div class="study-goal-details">
                  <div class="study-kicker">দৈনিক লক্ষ্য</div>
                  <div class="study-goal-status">
                    ${goal.achieved
                      ? 'আলহামদুলিল্লাহ! আজকের লক্ষ্য পূরণ হয়েছে'
                      : `আরও ${toBn(goal.remaining)}টি শব্দ অনুশীলন বাকি`}
                  </div>
                  <div class="study-goal-presets" role="group" aria-label="দৈনিক লক্ষ্য নির্বাচন">
                    ${DAILY_GOAL_PRESETS.map((n) => `
                      <button type="button" class="study-goal-preset-btn ${dailyGoalTarget === n ? 'active' : ''}" data-goal-target="${n}" aria-pressed="${dailyGoalTarget === n}">
                        ${toBn(n)}
                      </button>
                    `).join('')}
                  </div>
                </div>
              </div>
            </div>
          </section>
        `;

        mountEl.querySelectorAll('.study-goal-preset-btn').forEach((btn) => {
          btn.onclick = () => {
            const nextVal = parseInt(btn.getAttribute('data-goal-target'), 10);
            dailyGoalTarget = setDailyGoalTarget(nextVal);
            draw();
            if (typeof options.onGoalChange === 'function') options.onGoalChange(dailyGoalTarget);
          };
        });
      };

      draw();
    } catch (err) {
      console.warn('[StudyFeatures] Coverage widget failed:', err);
    }
  }

  // ============================================================
  // UI 2: 30-JUZ (PARA) DIRECTORY LIST
  // ============================================================
  function renderJuzDirectoryList(listEl, allSurahs, onJump) {
    if (!listEl) return;
    const surahNameMap = new Map();
    (allSurahs || []).forEach((s) => {
      surahNameMap.set(s.surah, s.name_bn_script || s.name_transliteration || `সূরা ${toBn(s.surah)}`);
    });

    listEl.innerHTML = '';
    const frag = document.createDocumentFragment();

    JUZ_DIRECTORY.forEach((entry) => {
      const startName = surahNameMap.get(entry.startSurah) || `সূরা ${toBn(entry.startSurah)}`;
      const endName = surahNameMap.get(entry.endSurah) || `সূরা ${toBn(entry.endSurah)}`;

      const li = document.createElement('li');
      li.className = 'juz-row';
      li.innerHTML = `
        <button type="button" class="juz-row-btn" data-juz="${entry.juz}" aria-label="পারা ${toBn(entry.juz)} ${entry.nameBn}, ${startName} আয়াত ${toBn(entry.startAyah)} থেকে">
          <div class="surah-number juz-number tabular-nums">${toBn(entry.juz)}</div>
          <div class="juz-info">
            <div class="juz-title-row">
              <span class="juz-name-bn">পারা ${toBn(entry.juz)} · ${escapeHtml(entry.nameBn)}</span>
              <span class="juz-name-ar" dir="rtl">${escapeHtml(entry.nameAr)}</span>
            </div>
            <div class="juz-range-row tabular-nums">
              <span>${escapeHtml(startName)} ${toBn(entry.startSurah)}:${toBn(entry.startAyah)}</span>
              <span aria-hidden="true">→</span>
              <span>${escapeHtml(endName)} ${toBn(entry.endSurah)}:${toBn(entry.endAyah)}</span>
            </div>
          </div>
          <span class="juz-arrow icon" aria-hidden="true">${(global.Icons && global.Icons.chevronRight) || ''}</span>
        </button>
      `;

      const btn = li.querySelector('.juz-row-btn');
      btn.onclick = () => {
        if (typeof onJump === 'function') {
          onJump(entry.startSurah, entry.startAyah, entry.juz);
        }
      };
      frag.appendChild(li);
    });

    listEl.appendChild(frag);
  }

  // ============================================================
  // UI 3: GLOBAL ARABIC + BANGLA + ROOT SEARCH VIEW (#view-search)
  // ============================================================
  const searchViewState = {
    query: '',
    mode: 'all'
  };

  async function renderGlobalSearchView(container, helpers = {}) {
    if (!container) return;
    if (typeof helpers.initialQuery === 'string' && helpers.initialQuery.trim()) {
      searchViewState.query = helpers.initialQuery.trim();
    }

    const icons = global.Icons || {};
    const surahMetaList = helpers.allSurahs || [];
    const surahMap = new Map();
    const surahTotals = new Map();
    surahMetaList.forEach((s) => {
      surahMap.set(s.surah, s.name_bn_script || s.name_transliteration || `সূরা ${toBn(s.surah)}`);
      surahTotals.set(s.surah, s.total_ayahs || 0);
    });

    container.innerHTML = `
      <div class="study-view-shell">
        <div class="study-search-card">
          <div class="study-search-input-wrap">
            <span class="study-search-icon" aria-hidden="true">${icons.search || ''}</span>
            <input
              type="text"
              class="study-search-input"
              id="global-search-input"
              placeholder="বাংলা অর্থ, আরবি শব্দ, মূল অক্ষর (رحم) বা আয়াত (২:২৫৫) লিখুন…"
              value="${escapeHtml(searchViewState.query)}"
              autocomplete="off"
              aria-label="পূর্ণ কুরআনে শব্দ, অর্থ বা মূল অক্ষর খুঁজুন"
            >
            <button type="button" class="study-search-clear-btn" id="global-search-clear" style="display:${searchViewState.query ? 'inline-flex' : 'none'}" aria-label="অনুসন্ধান মুছুন">
              <span class="icon">${icons.close || ''}</span>
            </button>
          </div>

          <div class="study-segmented-bar" role="tablist" aria-label="সার্চের ধরন">
            <button type="button" class="study-seg-btn ${searchViewState.mode === 'all' ? 'active' : ''}" data-search-mode="all" role="tab" aria-selected="${searchViewState.mode === 'all'}">সব</button>
            <button type="button" class="study-seg-btn ${searchViewState.mode === 'bangla' ? 'active' : ''}" data-search-mode="bangla" role="tab" aria-selected="${searchViewState.mode === 'bangla'}">বাংলা অর্থ</button>
            <button type="button" class="study-seg-btn ${searchViewState.mode === 'arabic' ? 'active' : ''}" data-search-mode="arabic" role="tab" aria-selected="${searchViewState.mode === 'arabic'}">আরবি শব্দ</button>
            <button type="button" class="study-seg-btn ${searchViewState.mode === 'root' ? 'active' : ''}" data-search-mode="root" role="tab" aria-selected="${searchViewState.mode === 'root'}">মূল অক্ষর</button>
          </div>

          <div class="study-quick-chips" aria-label="জনপ্রিয় অনুসন্ধান">
            ${['দয়া', 'ক্ষমা', 'জান্নাত', 'আল্লাহ', 'ر ح م', 'ع ل م', '২:২৫৫'].map((chip) => `
              <button type="button" class="study-quick-chip" data-quick-q="${escapeHtml(chip)}">${escapeHtml(chip)}</button>
            `).join('')}
          </div>
        </div>

        <div id="global-search-jump-mount"></div>
        <div id="global-search-results-mount">
          <div class="loading-spinner" style="margin:32px auto"></div>
        </div>
      </div>
    `;

    const inputEl = container.querySelector('#global-search-input');
    const clearBtn = container.querySelector('#global-search-clear');
    const jumpMount = container.querySelector('#global-search-jump-mount');
    const resultsMount = container.querySelector('#global-search-results-mount');

    let entries = [];
    try {
      const data = await loadFrequencyIndex();
      entries = data.entries || [];
    } catch (err) {
      resultsMount.innerHTML = `<div class="card error-box">শব্দভাণ্ডার লোড করা যায়নি। ইন্টারনেট সংযোগ যাচাই করুন।</div>`;
      return;
    }

    function runSearch() {
      const q = searchViewState.query.trim();
      if (clearBtn) clearBtn.style.display = q ? 'inline-flex' : 'none';

      // Check direct Surah:Ayah quick-jump
      const jump = parseSurahAyahJump(q, surahTotals);
      if (jump) {
        const sName = surahMap.get(jump.surah) || `সূরা ${toBn(jump.surah)}`;
        jumpMount.innerHTML = `
          <button type="button" class="quick-jump-banner" id="global-quick-jump-btn">
            <div class="quick-jump-text">
              <span class="quick-jump-kicker">সরাসরি আয়াতে যান</span>
              <strong>${escapeHtml(sName)} · আয়াত ${toBn(jump.surah)}:${toBn(jump.ayah)}</strong>
            </div>
            <span class="quick-jump-go">খুলুন <span class="icon">${icons.arrowRight || ''}</span></span>
          </button>
        `;
        const jBtn = jumpMount.querySelector('#global-quick-jump-btn');
        if (jBtn) {
          jBtn.onclick = () => {
            if (typeof helpers.onJumpAyah === 'function') {
              helpers.onJumpAyah(jump.surah, jump.ayah);
            }
          };
        }
      } else {
        jumpMount.innerHTML = '';
      }

      if (!q) {
        resultsMount.innerHTML = `
          <div class="study-empty-card">
            <div class="study-empty-title">পূর্ণ কুরআনের ১৯,১২৩টি ইউনিক শব্দ খুঁজুন</div>
            <p class="study-empty-desc">
              বাংলা অর্থ (যেমন: <strong>ক্ষমা</strong>, <strong>দয়া</strong>), আরবি শব্দ (যেমন: <strong>الرحيم</strong>), মূল অক্ষর (যেমন: <strong>ر ح م</strong>) অথবা সরাসরি <strong>২:২৫৫</strong> লিখে মুহূর্তেই খুঁজে নিন।
            </p>
          </div>
        `;
        return;
      }

      const matches = searchGlobalQuranWords(entries, q, searchViewState.mode, 60);
      if (matches.length === 0) {
        if (jump) {
          resultsMount.innerHTML = '';
          return;
        }
        resultsMount.innerHTML = `
          <div class="study-empty-card">
            <div class="study-empty-title">কোনো শব্দ পাওয়া যায়নি</div>
            <p class="study-empty-desc">“${escapeHtml(q)}” এর সাথে মিল রেখে কোনো শব্দ পাওয়া যায়নি। অন্য বানান বা ‘সব’ মোড চেষ্টা করুন।</p>
          </div>
        `;
        return;
      }

      resultsMount.innerHTML = `
        <div class="study-results-meta tabular-nums">
          <span>${toBn(matches.length)}${matches.length >= 60 ? '+' : ''}টি ফলাফল পাওয়া গেছে (সর্বাধিক ব্যবহৃত ক্রমে)</span>
        </div>
        <ul class="study-word-results-list" id="global-search-list">
          ${matches.map((m) => {
            const sName = surahMap.get(m.surah) || `সূরা ${toBn(m.surah)}`;
            const rootHtml = m.root ? `<span aria-hidden="true">·</span><span>মূল: <span dir="rtl">${escapeHtml(formatSpacedRoot(m.root))}</span></span>` : '';
            return `
              <li class="study-word-result-row">
                <button type="button" class="study-word-result-main" data-word-key="${escapeHtml(m.key)}">
                  <div class="study-word-ar" dir="rtl">${escapeHtml(m.arabic)}</div>
                  <div class="study-word-info">
                    <div class="study-word-bn">${escapeHtml(m.meaningBn)}</div>
                    <div class="study-word-meta tabular-nums">
                      <span>${formatBnInt(m.count)} বার</span>
                      <span aria-hidden="true">·</span>
                      <span>${escapeHtml(sName)} ${toBn(m.surah)}:${toBn(m.ayah)}</span>
                      ${rootHtml}
                    </div>
                  </div>
                </button>
                <div class="study-word-row-actions">
                  <button type="button" class="study-mini-icon-btn" data-audio-key="${escapeHtml(m.key)}" aria-label="${escapeHtml(m.meaningBn)} উচ্চারণ শুনুন" title="শব্দের অডিও শুনুন">
                    <span class="icon">${icons.volume2 || icons.speaker || ''}</span>
                  </button>
                  ${m.root ? `
                    <button type="button" class="study-mini-icon-btn" data-open-root="${escapeHtml(m.root)}" aria-label="মূল অক্ষর ${escapeHtml(formatSpacedRoot(m.root))} দেখুন" title="এই রুটের সব শব্দ">
                      <span class="icon">${icons.roots || icons.layers || ''}</span>
                    </button>
                  ` : ''}
                </div>
              </li>
            `;
          }).join('')}
        </ul>
      `;

      resultsMount.querySelectorAll('.study-word-result-main').forEach((btn) => {
        btn.onclick = () => {
          const wKey = btn.getAttribute('data-word-key');
          if (wKey && typeof helpers.onOpenWord === 'function') {
            helpers.onOpenWord(wKey);
          }
        };
      });

      resultsMount.querySelectorAll('[data-audio-key]').forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const wKey = btn.getAttribute('data-audio-key');
          if (wKey && typeof helpers.onPlayWordAudio === 'function') {
            helpers.onPlayWordAudio(wKey, btn);
          }
        };
      });

      resultsMount.querySelectorAll('[data-open-root]').forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const rootVal = btn.getAttribute('data-open-root');
          if (rootVal && typeof helpers.onOpenRoot === 'function') {
            helpers.onOpenRoot(rootVal);
          }
        };
      });
    }

    let debounceTimer = null;
    if (inputEl) {
      inputEl.oninput = () => {
        searchViewState.query = inputEl.value;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(runSearch, 120);
      };
      inputEl.onkeydown = (e) => {
        if (e.key === 'Enter') {
          const jump = parseSurahAyahJump(inputEl.value, surahTotals);
          if (jump && typeof helpers.onJumpAyah === 'function') {
            e.preventDefault();
            helpers.onJumpAyah(jump.surah, jump.ayah);
          }
        }
      };
    }

    if (clearBtn && inputEl) {
      clearBtn.onclick = () => {
        searchViewState.query = '';
        inputEl.value = '';
        inputEl.focus();
        runSearch();
      };
    }

    container.querySelectorAll('[data-search-mode]').forEach((tabBtn) => {
      tabBtn.onclick = () => {
        searchViewState.mode = tabBtn.getAttribute('data-search-mode') || 'all';
        container.querySelectorAll('[data-search-mode]').forEach((t) => {
          const active = t === tabBtn;
          t.classList.toggle('active', active);
          t.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        runSearch();
      };
    });

    container.querySelectorAll('[data-quick-q]').forEach((chip) => {
      chip.onclick = () => {
        const val = chip.getAttribute('data-quick-q') || '';
        searchViewState.query = val;
        if (inputEl) inputEl.value = val;
        runSearch();
      };
    });

    runSearch();
  }

  // ============================================================
  // UI 4: ROOT FAMILY & VERB FORMS EXPLORER VIEW (#view-roots)
  // ============================================================
  const rootViewState = {
    query: '',
    selectedRoot: null,
    visibleLimit: 50
  };

  async function renderRootExplorerView(container, helpers = {}) {
    if (!container) return;
    if (typeof helpers.initialRoot === 'string' && helpers.initialRoot.trim()) {
      rootViewState.selectedRoot = helpers.initialRoot.trim();
    } else if (helpers.resetSelection) {
      rootViewState.selectedRoot = null;
    }

    const icons = global.Icons || {};
    container.innerHTML = `<div class="loading-spinner" style="margin:40px auto"></div>`;

    let families = [];
    try {
      families = await loadRootFamilies();
    } catch (err) {
      container.innerHTML = `<div class="card error-box">মূল অক্ষর (রুট) তালিকা লোড করা যায়নি।</div>`;
      return;
    }

    const surahMap = new Map();
    (helpers.allSurahs || []).forEach((s) => {
      surahMap.set(s.surah, s.name_bn_script || s.name_transliteration || `সূরা ${toBn(s.surah)}`);
    });

    async function drawRootDetail(rootStr) {
      const fam = families.find((f) => f.root === rootStr);
      if (!fam) {
        rootViewState.selectedRoot = null;
        drawRootDirectory();
        return;
      }

      // Check if any word in this root family has verb forms in verb-forms.json
      let verbForms = null;
      try {
        const vfMap = await loadVerbFormsMap();
        for (const w of fam.topWords) {
          if (vfMap && vfMap[w.key]) {
            verbForms = vfMap[w.key];
            break;
          }
        }
      } catch (_) {}

      const verbFormsHtml = verbForms ? `
        <div class="detail-card root-verb-card">
          <div class="root-section-heading">ক্রিয়ার মূল ৬টি রূপ (Verb Forms)</div>
          <div class="root-verb-grid">
            ${verbForms.perfect ? `<div class="root-verb-cell"><span class="root-verb-lbl">অতীত (ماض)</span><strong dir="rtl">${escapeHtml(verbForms.perfect)}</strong></div>` : ''}
            ${verbForms.imperfect ? `<div class="root-verb-cell"><span class="root-verb-lbl">বর্তমান (مضارع)</span><strong dir="rtl">${escapeHtml(verbForms.imperfect)}</strong></div>` : ''}
            ${verbForms.imperative ? `<div class="root-verb-cell"><span class="root-verb-lbl">আদেশ (أمر)</span><strong dir="rtl">${escapeHtml(verbForms.imperative)}</strong></div>` : ''}
            ${verbForms.active_participle ? `<div class="root-verb-cell"><span class="root-verb-lbl">কর্তা (فاعل)</span><strong dir="rtl">${escapeHtml(verbForms.active_participle)}</strong></div>` : ''}
            ${verbForms.passive_participle ? `<div class="root-verb-cell"><span class="root-verb-lbl">কর্ম (مفعول)</span><strong dir="rtl">${escapeHtml(verbForms.passive_participle)}</strong></div>` : ''}
            ${verbForms.verbal_noun ? `<div class="root-verb-cell"><span class="root-verb-lbl">ক্রিয়ামূল (مصدر)</span><strong dir="rtl">${escapeHtml(verbForms.verbal_noun)}</strong></div>` : ''}
          </div>
        </div>
      ` : '';

      container.innerHTML = `
        <div class="study-view-shell">
          <button type="button" class="root-back-btn" id="btn-root-back-list">
            <span class="icon">${icons.arrowLeft || ''}</span>
            <span>সব মূল অক্ষরের তালিকায় ফিরুন</span>
          </button>

          <div class="detail-card root-detail-hero">
            <div class="root-detail-hero-top">
              <div>
                <div class="study-kicker">কুরআনিক মূল অক্ষর (রুট)</div>
                <div class="root-detail-ar" dir="rtl">${escapeHtml(fam.spacedRoot)}</div>
              </div>
              <div class="root-detail-stats tabular-nums">
                <div><strong>${formatBnInt(fam.totalOccurrences)}</strong><span>মোট ব্যবহার</span></div>
                <div><strong>${formatBnInt(fam.uniqueWordCount)}</strong><span>ইউনিক রূপ</span></div>
              </div>
            </div>
            ${fam.sampleMeaningBn ? `<div class="root-detail-summary-bn">${escapeHtml(fam.sampleMeaningBn)}</div>` : ''}
            <button type="button" class="root-quiz-cta" id="btn-root-start-quiz">
              <span class="icon">${icons.target || ''}</span>
              <span>এই রুটের শব্দগুলো দিয়ে কুইজ খেলুন (${toBn(Math.min(10, fam.topWords.length))}টি শব্দ)</span>
            </button>
          </div>

          ${verbFormsHtml}

          <div class="study-results-meta tabular-nums">
            <span>এই মূল অক্ষর থেকে গঠিত ${formatBnInt(fam.topWords.length)}টি কুরআনিক শব্দ</span>
          </div>

          <ul class="study-word-results-list">
            ${fam.topWords.map((w) => {
              const parts = w.key.split(':');
              const sNum = parseInt(parts[0], 10) || 1;
              const aNum = parseInt(parts[1], 10) || 1;
              const sName = surahMap.get(sNum) || `সূরা ${toBn(sNum)}`;
              return `
                <li class="study-word-result-row">
                  <button type="button" class="study-word-result-main" data-word-key="${escapeHtml(w.key)}">
                    <div class="study-word-ar" dir="rtl">${escapeHtml(w.arabic)}</div>
                    <div class="study-word-info">
                      <div class="study-word-bn">${escapeHtml(w.meaningBn)}</div>
                      <div class="study-word-meta tabular-nums">
                        <span>${formatBnInt(w.count)} বার</span>
                        <span aria-hidden="true">·</span>
                        <span>${escapeHtml(sName)} ${toBn(sNum)}:${toBn(aNum)}</span>
                      </div>
                    </div>
                  </button>
                  <div class="study-word-row-actions">
                    <button type="button" class="study-mini-icon-btn" data-audio-key="${escapeHtml(w.key)}" aria-label="${escapeHtml(w.meaningBn)} উচ্চারণ শুনুন">
                      <span class="icon">${icons.volume2 || icons.speaker || ''}</span>
                    </button>
                  </div>
                </li>
              `;
            }).join('')}
          </ul>
        </div>
      `;

      const backBtn = container.querySelector('#btn-root-back-list');
      if (backBtn) {
        backBtn.onclick = () => {
          rootViewState.selectedRoot = null;
          drawRootDirectory();
        };
      }

      const quizBtn = container.querySelector('#btn-root-start-quiz');
      if (quizBtn) {
        quizBtn.onclick = () => {
          if (typeof helpers.onStartRootQuiz === 'function') {
            helpers.onStartRootQuiz(fam);
          }
        };
      }

      container.querySelectorAll('.study-word-result-main').forEach((btn) => {
        btn.onclick = () => {
          const wKey = btn.getAttribute('data-word-key');
          if (wKey && typeof helpers.onOpenWord === 'function') helpers.onOpenWord(wKey);
        };
      });

      container.querySelectorAll('[data-audio-key]').forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const wKey = btn.getAttribute('data-audio-key');
          if (wKey && typeof helpers.onPlayWordAudio === 'function') helpers.onPlayWordAudio(wKey, btn);
        };
      });
    }

    function drawRootDirectory() {
      container.innerHTML = `
        <div class="study-view-shell">
          <div class="study-search-card">
            <div class="study-kicker">রুট ফ্যামিলি অভিধান · ${formatBnInt(families.length)}টি কুরআনিক মূল অক্ষর</div>
            <div class="study-search-input-wrap" style="margin-top:8px">
              <span class="study-search-icon" aria-hidden="true">${icons.search || ''}</span>
              <input
                type="text"
                class="study-search-input"
                id="root-search-input"
                placeholder="মূল অক্ষর (যেমন: رحم বা ر ح م) বা বাংলা অর্থ খুঁজুন…"
                value="${escapeHtml(rootViewState.query)}"
                autocomplete="off"
                aria-label="মূল অক্ষর খুঁজুন"
              >
              <button type="button" class="study-search-clear-btn" id="root-search-clear" style="display:${rootViewState.query ? 'inline-flex' : 'none'}" aria-label="অনুসন্ধান মুছুন">
                <span class="icon">${icons.close || ''}</span>
              </button>
            </div>
          </div>

          <div id="root-directory-list-mount"></div>
        </div>
      `;

      const inputEl = container.querySelector('#root-search-input');
      const clearBtn = container.querySelector('#root-search-clear');
      const listMount = container.querySelector('#root-directory-list-mount');

      function renderRows() {
        const filtered = filterRootFamilies(families, rootViewState.query);
        if (clearBtn) clearBtn.style.display = rootViewState.query ? 'inline-flex' : 'none';

        if (filtered.length === 0) {
          listMount.innerHTML = `
            <div class="study-empty-card">
              <div class="study-empty-title">কোনো মূল অক্ষর পাওয়া যায়নি</div>
              <p class="study-empty-desc">অন্য আরবি রুট বা বাংলা অর্থ দিয়ে চেষ্টা করুন।</p>
            </div>
          `;
          return;
        }

        const slice = filtered.slice(0, rootViewState.visibleLimit);
        listMount.innerHTML = `
          <div class="study-results-meta tabular-nums">
            <span>মোট ${formatBnInt(filtered.length)}টি মূল অক্ষর (সর্বাধিক ব্যবহৃত ক্রমে)</span>
          </div>
          <ul class="root-family-list" id="root-family-list">
            ${slice.map((fam) => `
              <li class="root-family-item">
                <button type="button" class="root-family-btn" data-root="${escapeHtml(fam.root)}">
                  <div class="root-letters-box" dir="rtl">${escapeHtml(fam.spacedRoot)}</div>
                  <div class="root-family-info">
                    <div class="root-family-meanings">${escapeHtml(fam.sampleMeaningBn || 'কুরআনিক শব্দগুচ্ছ')}</div>
                    <div class="root-family-meta tabular-nums">
                      <span>${formatBnInt(fam.totalOccurrences)} বার এসেছে</span>
                      <span aria-hidden="true">·</span>
                      <span>${formatBnInt(fam.uniqueWordCount)}টি শব্দরূপ</span>
                    </div>
                  </div>
                  <span class="root-chevron icon" aria-hidden="true">${icons.chevronRight || ''}</span>
                </button>
              </li>
            `).join('')}
          </ul>
          ${filtered.length > slice.length ? `
            <button type="button" class="concordance-more-btn" id="btn-root-load-more" style="margin-top:12px">
              আরও মূল অক্ষর দেখুন (${formatBnInt(filtered.length - slice.length)}টি বাকি)
            </button>
          ` : ''}
        `;

        listMount.querySelectorAll('.root-family-btn').forEach((btn) => {
          btn.onclick = () => {
            rootViewState.selectedRoot = btn.getAttribute('data-root');
            drawRootDetail(rootViewState.selectedRoot);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          };
        });

        const moreBtn = listMount.querySelector('#btn-root-load-more');
        if (moreBtn) {
          moreBtn.onclick = () => {
            rootViewState.visibleLimit += 60;
            renderRows();
          };
        }
      }

      let t = null;
      if (inputEl) {
        inputEl.oninput = () => {
          rootViewState.query = inputEl.value;
          rootViewState.visibleLimit = 50;
          clearTimeout(t);
          t = setTimeout(renderRows, 100);
        };
      }
      if (clearBtn && inputEl) {
        clearBtn.onclick = () => {
          rootViewState.query = '';
          inputEl.value = '';
          rootViewState.visibleLimit = 50;
          inputEl.focus();
          renderRows();
        };
      }

      renderRows();
    }

    if (rootViewState.selectedRoot) {
      await drawRootDetail(rootViewState.selectedRoot);
    } else {
      drawRootDirectory();
    }
  }

  // ============================================================
  // UI 5: CUSTOM DRAGGABLE SIDE AYAH SCRUBBER FOR LONG SURAHS
  // ============================================================
  function createAyahSideScrubber() {
    let rootEl = null;
    let railEl = null;
    let thumbEl = null;
    let bubbleEl = null;
    let labelEl = null;

    let surahNumber = null;
    let totalAyahs = 0;
    let currentAyah = 1;
    let isDragging = false;
    let isVisible = false;
    let ensureRenderedCallback = null;
    let hideBubbleTimer = null;
    let scrollRaf = null;

    function ensureDOM() {
      if (rootEl) return;
      rootEl = document.createElement('div');
      rootEl.id = 'ayah-side-scrubber';
      rootEl.className = 'ayah-side-scrubber';
      rootEl.setAttribute('aria-label', 'দ্রুত আয়াত স্ক্রলবার');
      rootEl.innerHTML = `
        <div class="ayah-scrubber-bubble tabular-nums" id="ayah-scrubber-bubble" aria-hidden="true">
          <span id="ayah-scrubber-label">আয়াত ১ / ২৮৬</span>
        </div>
        <div class="ayah-scrubber-rail" id="ayah-scrubber-rail" role="slider" tabindex="0" aria-orientation="vertical" aria-label="আয়াত নির্বাচন করুন" aria-valuemin="1" aria-valuemax="1" aria-valuenow="1">
          <div class="ayah-scrubber-track"></div>
          <div class="ayah-scrubber-thumb" id="ayah-scrubber-thumb">
            <span class="ayah-scrubber-grip"></span>
          </div>
        </div>
      `;
      document.body.appendChild(rootEl);

      railEl = rootEl.querySelector('#ayah-scrubber-rail');
      thumbEl = rootEl.querySelector('#ayah-scrubber-thumb');
      bubbleEl = rootEl.querySelector('#ayah-scrubber-bubble');
      labelEl = rootEl.querySelector('#ayah-scrubber-label');

      function updateVisualPosition(ayahNum, showBubble) {
        currentAyah = Math.max(1, Math.min(totalAyahs || 1, ayahNum));
        const ratio = computeScrubberRatioFromAyah(currentAyah, totalAyahs || 1);
        const railHeight = railEl ? railEl.clientHeight : 260;
        const thumbHeight = thumbEl ? thumbEl.offsetHeight || 44 : 44;
        const travel = Math.max(0, railHeight - thumbHeight);
        const yPx = Math.round(ratio * travel);

        if (thumbEl) thumbEl.style.transform = `translateY(${yPx}px)`;
        if (bubbleEl) {
          bubbleEl.style.transform = `translateY(${yPx}px)`;
          if (showBubble) {
            bubbleEl.classList.add('visible');
            clearTimeout(hideBubbleTimer);
            if (!isDragging) {
              hideBubbleTimer = setTimeout(() => {
                if (bubbleEl && !isDragging) bubbleEl.classList.remove('visible');
              }, 900);
            }
          }
        }
        if (labelEl) {
          labelEl.textContent = `আয়াত ${toBn(currentAyah)} / ${toBn(totalAyahs)}`;
        }
        if (railEl) {
          railEl.setAttribute('aria-valuemax', String(totalAyahs));
          railEl.setAttribute('aria-valuenow', String(currentAyah));
          railEl.setAttribute('aria-valuetext', `আয়াত ${toBn(currentAyah)} এর মধ্যে ${toBn(totalAyahs)}`);
        }
      }

      let suppressScrollSyncUntil = 0;

      function jumpToAyah(targetAyah, smooth = false) {
        if (!surahNumber || totalAyahs <= 0) return;
        const safeAyah = Math.max(1, Math.min(totalAyahs, targetAyah));
        suppressScrollSyncUntil = Date.now() + 260;
        if (typeof ensureRenderedCallback === 'function') {
          ensureRenderedCallback(safeAyah);
        }
        const card = document.getElementById(`ayah-card-${surahNumber}-${safeAyah}`);
        if (card) {
          const topbar = document.querySelector('.topbar');
          const offset = (topbar ? topbar.offsetHeight : 60) + 12;
          const top = card.getBoundingClientRect().top + window.scrollY - offset;
          window.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'instant' });
        }
      }

      function ratioFromClientY(clientY) {
        const rect = railEl.getBoundingClientRect();
        const thumbH = thumbEl ? thumbEl.offsetHeight || 44 : 44;
        const usable = Math.max(1, rect.height - thumbH);
        return Math.max(0, Math.min(1, (clientY - rect.top - thumbH / 2) / usable));
      }

      let lastJumpedAyah = 0;

      railEl.addEventListener('pointerdown', (e) => {
        if (!isVisible || totalAyahs < 2) return;
        e.preventDefault();
        isDragging = true;
        rootEl.classList.add('dragging');
        try { railEl.setPointerCapture(e.pointerId); } catch (_) {}

        const ratio = ratioFromClientY(e.clientY);
        const ayahNum = computeScrubberAyahFromRatio(ratio, totalAyahs);
        lastJumpedAyah = ayahNum;
        updateVisualPosition(ayahNum, true);
        jumpToAyah(ayahNum, false);
      });

      railEl.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const ratio = ratioFromClientY(e.clientY);
        const ayahNum = computeScrubberAyahFromRatio(ratio, totalAyahs);
        updateVisualPosition(ayahNum, true);
        if (ayahNum !== lastJumpedAyah) {
          lastJumpedAyah = ayahNum;
          jumpToAyah(ayahNum, false);
        }
      });

      function endDrag(e) {
        if (!isDragging) return;
        isDragging = false;
        rootEl.classList.remove('dragging');
        try {
          if (e && e.pointerId !== undefined) railEl.releasePointerCapture(e.pointerId);
        } catch (_) {}
        jumpToAyah(currentAyah, false);
        clearTimeout(hideBubbleTimer);
        hideBubbleTimer = setTimeout(() => {
          if (bubbleEl && !isDragging) bubbleEl.classList.remove('visible');
        }, 700);
      }

      railEl.addEventListener('pointerup', endDrag);
      railEl.addEventListener('pointercancel', endDrag);

      railEl.addEventListener('keydown', (e) => {
        if (!isVisible || totalAyahs < 2) return;
        let step = 0;
        if (e.key === 'ArrowDown') step = 1;
        else if (e.key === 'ArrowUp') step = -1;
        else if (e.key === 'PageDown') step = 10;
        else if (e.key === 'PageUp') step = -10;
        else if (e.key === 'Home') { e.preventDefault(); updateVisualPosition(1, true); jumpToAyah(1, true); return; }
        else if (e.key === 'End') { e.preventDefault(); updateVisualPosition(totalAyahs, true); jumpToAyah(totalAyahs, true); return; }
        if (step !== 0) {
          e.preventDefault();
          const nextAyah = Math.max(1, Math.min(totalAyahs, currentAyah + step));
          updateVisualPosition(nextAyah, true);
          jumpToAyah(nextAyah, true);
        }
      });

      window.addEventListener('scroll', () => {
        if (!isVisible || isDragging || totalAyahs < 2) return;
        if (Date.now() < suppressScrollSyncUntil) return;
        if (scrollRaf) return;
        scrollRaf = requestAnimationFrame(() => {
          scrollRaf = null;
          if (!isVisible || isDragging || Date.now() < suppressScrollSyncUntil) return;
          const docEl = document.documentElement;
          const maxScroll = Math.max(1, docEl.scrollHeight - window.innerHeight);
          const scrollRatio = window.scrollY >= maxScroll - 24
            ? 1
            : Math.max(0, Math.min(1, window.scrollY / maxScroll));
          const approxAyah = computeScrubberAyahFromRatio(scrollRatio, totalAyahs);
          updateVisualPosition(approxAyah, false);
        });
      }, { passive: true });

      rootEl._updateVisualPosition = updateVisualPosition;
      rootEl._jumpToAyah = jumpToAyah;
    }

    return {
      attach(sNum, total, ensureRenderedFn) {
        surahNumber = parseInt(sNum, 10);
        totalAyahs = Math.max(0, parseInt(total, 10) || 0);
        ensureRenderedCallback = ensureRenderedFn || null;
        ensureDOM();

        // Show custom side scrollbar for Surahs with 12+ ayahs (especially long surahs like Al-Baqarah)
        if (totalAyahs >= 12) {
          isVisible = true;
          rootEl.classList.add('visible');
          rootEl._updateVisualPosition(1, false);
        } else {
          this.hide();
        }
      },
      syncAyah(ayahNum) {
        if (!isVisible || !rootEl || isDragging) return;
        rootEl._updateVisualPosition(ayahNum, false);
      },
      jumpTo(ayahNum) {
        if (!rootEl || !isVisible) return;
        rootEl._updateVisualPosition(ayahNum, true);
        rootEl._jumpToAyah(ayahNum, false);
      },
      hide() {
        isVisible = false;
        isDragging = false;
        if (rootEl) {
          rootEl.classList.remove('visible', 'dragging');
          if (bubbleEl) bubbleEl.classList.remove('visible');
        }
      }
    };
  }

  const sideScrubber = createAyahSideScrubber();

  global.QuranStudyFeatures = {
    TOTAL_QURAN_TOKENS,
    DAILY_GOAL_PRESETS,
    JUZ_DIRECTORY,
    normalizeDigitsToAscii,
    parseSurahAyahJump,
    normalizeArabicForSearch,
    formatSpacedRoot,
    searchGlobalQuranWords,
    computeQuranCoverageStats,
    getDailyGoalTarget,
    setDailyGoalTarget,
    getTodayWordCount,
    incrementTodayWordCount,
    computeDailyGoalState,
    buildRootFamiliesIndex,
    filterRootFamilies,
    evaluateAyahLoopTransition,
    computeScrubberAyahFromRatio,
    computeScrubberRatioFromAyah,
    loadFrequencyIndex,
    loadSameRootMap,
    loadVerbFormsMap,
    loadRootFamilies,
    renderCoverageAndDailyGoalWidget,
    renderJuzDirectoryList,
    renderGlobalSearchView,
    renderRootExplorerView,
    sideScrubber
  };
})(typeof window !== 'undefined' ? window : globalThis);
