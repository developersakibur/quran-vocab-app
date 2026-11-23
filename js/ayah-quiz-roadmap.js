/* ============================================================
   AYAH WORD QUIZ ROADMAP ENGINE (BROWSER RUNTIME)
   - Surah Directory with Completed Ayah Progress (114 Surahs)
   - Per-Surah Ayah List with Learned/Total Word Fractions
   - Strict Sequential Unlock: Ayah 1 unlocked for every Surah;
     Ayah N unlocks only after passing Ayah N-1 with 100% score
   - Anti-Overwhelm 20-Ayah Mini-Step Tabs for Long Surahs
   ============================================================ */

(function (global) {
  'use strict';

  const AYAH_PASS_PREFIX = 'ayah_pass:';
  const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

  function toBnDigits(value) {
    return String(value).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)] || d);
  }

  function normalizeDigitsToAscii(value) {
    return String(value || '').replace(/[০-৯]/g, (ch) => {
      const idx = BN_DIGITS.indexOf(ch);
      return idx >= 0 ? String(idx) : ch;
    });
  }

  function isAyahPassKey(key) {
    return typeof key === 'string' && key.startsWith(AYAH_PASS_PREFIX);
  }

  function makeAyahPassKey(surah, ayah) {
    return `${AYAH_PASS_PREFIX}${Math.floor(Number(surah))}:${Math.floor(Number(ayah))}`;
  }

  function parseAyahPassKey(key) {
    if (!isAyahPassKey(key)) return null;
    const raw = String(key).slice(AYAH_PASS_PREFIX.length);
    const parts = raw.split(':');
    if (parts.length !== 2) return null;
    const surah = parseInt(parts[0], 10);
    const ayah = parseInt(parts[1], 10);
    if (!Number.isFinite(surah) || !Number.isFinite(ayah) || surah < 1 || surah > 114 || ayah < 1) {
      return null;
    }
    return { surah, ayah, verseKey: `${surah}:${ayah}` };
  }

  function didPassAyahQuiz(score, total) {
    return Number(total) > 0 && Number(score) >= Number(total);
  }

  function isWordLearned(rec) {
    if (!rec) return false;
    if (rec.status === 'mastered') return true;
    if (Number(rec.repetitions || 0) >= 1) return true;
    if (Number(rec.correctCount || 0) >= 1) return true;
    return false;
  }

  function getQuizEligibleWords(ayah) {
    if (!ayah || !Array.isArray(ayah.words)) return [];
    return ayah.words
      .filter((w) => w && typeof w.meaning_bn === 'string' && w.meaning_bn.trim().length > 0)
      .slice()
      .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  }

  function shuffleQuizWords(words, rng) {
    if (!Array.isArray(words) || words.length <= 1) {
      return Array.isArray(words) ? words.slice() : [];
    }
    const randFn = typeof rng === 'function' ? rng : Math.random;
    const out = words.slice();
    const n = out.length;

    for (let i = n - 1; i > 0; i--) {
      const raw = Number(randFn());
      const clamped = Number.isFinite(raw) ? Math.min(0.999999999, Math.max(0, raw)) : 0;
      const j = Math.floor(clamped * (i + 1));
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }

    const isIdenticalOrder = out.every((item, idx) => item === words[idx]);
    if (isIdenticalOrder && n > 1) {
      const first = out.shift();
      out.push(first);
    }

    return out;
  }

  function computeSurahAyahStates(surahNumber, ayahs, progressMap, passedMap) {
    const pMap = progressMap || {};
    const passMap = passedMap || {};
    const sNum = Math.floor(Number(surahNumber) || 1);
    const sortedAyahs = (Array.isArray(ayahs) ? ayahs : [])
      .slice()
      .sort((a, b) => Number(a.ayah || 0) - Number(b.ayah || 0));

    const states = [];
    let prevPassed = true; // Ayah 1 of every Surah is always unlocked
    let activeAssigned = false;

    for (let i = 0; i < sortedAyahs.length; i++) {
      const a = sortedAyahs[i];
      const ayahNum = Number(a.ayah || i + 1);
      const verseKey = a.verse_key || `${sNum}:${ayahNum}`;
      const quizWords = getQuizEligibleWords(a);
      const totalWords = quizWords.length;

      let learnedCount = 0;
      for (let j = 0; j < quizWords.length; j++) {
        if (isWordLearned(pMap[quizWords[j].key])) {
          learnedCount++;
        }
      }

      const passEntry = passMap[verseKey];
      const isPassed = Boolean(
        passEntry === true || (passEntry && typeof passEntry === 'object' && passEntry.passed)
      );

      const isUnlocked = i === 0 || prevPassed;
      const isActive = isUnlocked && !isPassed && !activeAssigned;
      if (isActive) activeAssigned = true;

      const effectiveLearned = isPassed ? totalWords : Math.min(learnedCount, totalWords);
      const pct = totalWords > 0 ? Math.round((effectiveLearned / totalWords) * 100) : (isPassed ? 100 : 0);

      const status = isPassed ? 'passed' : isUnlocked ? 'active' : 'locked';

      states.push({
        surah: sNum,
        ayah: ayahNum,
        verseKey,
        arabic: String(a.arabic || ''),
        totalWords,
        learnedCount: effectiveLearned,
        pct,
        isPassed,
        isUnlocked,
        isActive,
        status
      });

      prevPassed = isPassed;
    }

    return states;
  }

  function computeSurahAyahSummary(surahNumber, ayahs, progressMap, passedMap) {
    const states = computeSurahAyahStates(surahNumber, ayahs, progressMap, passedMap);
    const totalAyahs = states.length;
    let completedAyahs = 0;
    let totalWords = 0;
    let learnedWords = 0;

    for (let i = 0; i < states.length; i++) {
      const st = states[i];
      if (st.isPassed) completedAyahs++;
      totalWords += st.totalWords;
      learnedWords += st.learnedCount;
    }

    const activeItem =
      states.find((s) => s.isActive) ||
      states.find((s) => s.isUnlocked && !s.isPassed) ||
      states[states.length - 1];

    const pct = totalAyahs > 0 ? Math.round((completedAyahs / totalAyahs) * 100) : 0;

    return {
      surah: Math.floor(Number(surahNumber) || 1),
      totalAyahs,
      completedAyahs,
      totalWords,
      learnedWords,
      pct,
      isComplete: totalAyahs > 0 && completedAyahs >= totalAyahs,
      activeAyahNumber: activeItem ? activeItem.ayah : 1,
      states
    };
  }

  function buildAyahQuizSurahRows(surahsMeta, passedMap) {
    const passMap = passedMap || {};
    const passedBySurah = new Map();
    const latestPassAtBySurah = new Map();

    const entries = Object.entries(passMap);
    for (let i = 0; i < entries.length; i++) {
      const verseKey = entries[i][0];
      const val = entries[i][1];
      const isPassed = Boolean(val === true || (val && typeof val === 'object' && val.passed));
      if (!isPassed) continue;

      const cleanKey = verseKey.startsWith(AYAH_PASS_PREFIX)
        ? verseKey.slice(AYAH_PASS_PREFIX.length)
        : verseKey;
      const parts = cleanKey.split(':');
      if (parts.length !== 2) continue;
      const sNum = parseInt(parts[0], 10);
      const aNum = parseInt(parts[1], 10);
      if (!sNum || !aNum) continue;

      if (!passedBySurah.has(sNum)) passedBySurah.set(sNum, new Set());
      passedBySurah.get(sNum).add(aNum);

      const passedAt = (val && typeof val === 'object' && Number(val.passedAt || 0)) || 0;
      const prevLatest = latestPassAtBySurah.get(sNum) || 0;
      if (passedAt > prevLatest) {
        latestPassAtBySurah.set(sNum, passedAt);
      }
    }

    return (Array.isArray(surahsMeta) ? surahsMeta : []).map((meta) => {
      const surah = Number(meta.surah || meta.number || 0);
      const totalAyahs = Math.max(1, Number(meta.total_ayahs || 1));
      const totalWords = Math.max(0, Number(meta.total_words || 0));
      const passedSet = passedBySurah.get(surah) || new Set();

      let completedAyahs = 0;
      let nextAyahNumber = 1;
      let foundNext = false;

      for (let a = 1; a <= totalAyahs; a++) {
        if (passedSet.has(a)) {
          completedAyahs++;
        } else if (!foundNext) {
          nextAyahNumber = a;
          foundNext = true;
        }
      }

      if (!foundNext) {
        nextAyahNumber = totalAyahs;
      }

      const pct = totalAyahs > 0 ? Math.round((completedAyahs / totalAyahs) * 100) : 0;
      const isComplete = completedAyahs >= totalAyahs;
      const isStarted = completedAyahs > 0;
      const rawType = String(meta.type || '').toLowerCase();
      const revelationBn =
        meta.revelation_bn || (rawType === 'meccan' || rawType === 'makki' ? 'মাক্কী' : 'মাদানী');

      return {
        surah,
        nameArabic: String(meta.name_arabic || ''),
        nameBnScript: String(meta.name_bn_script || meta.name_transliteration || `সূরা ${toBnDigits(surah)}`),
        nameBn: String(meta.name_bn || ''),
        nameTransliteration: String(meta.name_transliteration || ''),
        revelationBn,
        totalAyahs,
        totalWords,
        completedAyahs,
        pct,
        isComplete,
        isStarted,
        nextAyahNumber,
        lastPassedAt: latestPassAtBySurah.get(surah) || 0
      };
    });
  }

  function computeGlobalAyahQuizOverview(surahRows) {
    let completedAyahs = 0;
    let totalAyahs = 0;
    let completedSurahs = 0;
    let startedSurahs = 0;

    for (let i = 0; i < (surahRows || []).length; i++) {
      const row = surahRows[i];
      completedAyahs += row.completedAyahs;
      totalAyahs += row.totalAyahs;
      if (row.isComplete) completedSurahs++;
      else if (row.isStarted) startedSurahs++;
    }

    const pct = totalAyahs > 0 ? Math.round((completedAyahs / totalAyahs) * 1000) / 10 : 0;

    return {
      completedAyahs,
      totalAyahs,
      completedSurahs,
      startedSurahs,
      totalSurahs: (surahRows || []).length,
      pct
    };
  }

  function findRecommendedResumeAyah(surahRows) {
    if (!Array.isArray(surahRows) || surahRows.length === 0) return null;

    const inProgress = surahRows
      .filter((r) => r.isStarted && !r.isComplete)
      .sort((a, b) => {
        if (b.lastPassedAt !== a.lastPassedAt) return b.lastPassedAt - a.lastPassedAt;
        return a.surah - b.surah;
      });

    if (inProgress.length > 0) {
      const pick = inProgress[0];
      return {
        surah: pick.surah,
        surahNameBn: pick.nameBnScript,
        ayah: pick.nextAyahNumber,
        completedAyahs: pick.completedAyahs,
        totalAyahs: pick.totalAyahs,
        isSurahStarted: true
      };
    }

    const firstIncomplete = surahRows.find((r) => !r.isComplete);
    if (firstIncomplete) {
      return {
        surah: firstIncomplete.surah,
        surahNameBn: firstIncomplete.nameBnScript,
        ayah: firstIncomplete.nextAyahNumber,
        completedAyahs: firstIncomplete.completedAyahs,
        totalAyahs: firstIncomplete.totalAyahs,
        isSurahStarted: firstIncomplete.isStarted
      };
    }

    const first = surahRows[0];
    return {
      surah: first.surah,
      surahNameBn: first.nameBnScript,
      ayah: 1,
      completedAyahs: first.completedAyahs,
      totalAyahs: first.totalAyahs,
      isSurahStarted: true
    };
  }

  function filterAyahQuizSurahs(surahRows, query, filterMode) {
    const mode = filterMode || 'all';
    const cleanQuery = normalizeDigitsToAscii(String(query || '').trim().toLowerCase());

    return (Array.isArray(surahRows) ? surahRows : []).filter((row) => {
      if (mode === 'in-progress' && !(row.isStarted && !row.isComplete)) {
        return false;
      }
      if (mode === 'completed' && !row.isComplete) {
        return false;
      }
      if (!cleanQuery) return true;

      const haystack = [
        String(row.surah),
        row.nameBnScript.toLowerCase(),
        row.nameBn.toLowerCase(),
        row.nameTransliteration.toLowerCase(),
        row.nameArabic
      ].join(' ');

      return haystack.includes(cleanQuery);
    });
  }

  function buildAyahMiniSteps(ayahStates, stepSize) {
    const list = Array.isArray(ayahStates) ? ayahStates : [];
    if (list.length === 0) return [];

    const size = Math.max(5, Math.floor(stepSize || 20));
    if (list.length <= size) {
      return [
        {
          stepIndex: 0,
          startAyah: list[0].ayah,
          endAyah: list[list.length - 1].ayah,
          labelBn: `আয়াত ${toBnDigits(list[0].ayah)}–${toBnDigits(list[list.length - 1].ayah)}`,
          passedCount: list.filter((s) => s.isPassed).length,
          totalCount: list.length,
          hasActive: list.some((s) => s.isActive),
          items: list
        }
      ];
    }

    const steps = [];
    for (let i = 0; i < list.length; i += size) {
      const chunk = list.slice(i, i + size);
      const startAyah = chunk[0].ayah;
      const endAyah = chunk[chunk.length - 1].ayah;
      steps.push({
        stepIndex: steps.length,
        startAyah,
        endAyah,
        labelBn: `আয়াত ${toBnDigits(startAyah)}–${toBnDigits(endAyah)}`,
        passedCount: chunk.filter((s) => s.isPassed).length,
        totalCount: chunk.length,
        hasActive: chunk.some((s) => s.isActive),
        items: chunk
      });
    }
    return steps;
  }

  global.AyahQuizRoadmap = {
    AYAH_PASS_PREFIX,
    isAyahPassKey,
    makeAyahPassKey,
    parseAyahPassKey,
    didPassAyahQuiz,
    isWordLearned,
    getQuizEligibleWords,
    shuffleQuizWords,
    computeSurahAyahStates,
    computeSurahAyahSummary,
    buildAyahQuizSurahRows,
    computeGlobalAyahQuizOverview,
    findRecommendedResumeAyah,
    filterAyahQuizSurahs,
    buildAyahMiniSteps
  };
})(typeof window !== 'undefined' ? window : globalThis);
