/* ============================================================
   SMART FLASHCARD ROTATION & WEAK WORDS STATE MACHINE (BROWSER MODULE)
   Mirrors src/utils/smart-flashcard-engine.ts for browser runtime.
   ============================================================ */
(function (global) {
  'use strict';

  const DEFAULT_FLASHCARD_BATCH_SIZE = 10;

  const SMART_FLASHCARD_RATINGS = [
    {
      id: 'hard',
      grade: 1,
      labelBn: 'ভুলে গেছি / কঠিন',
      subLabelBn: 'আবার দ্রুত আসবে'
    },
    {
      id: 'medium',
      grade: 3,
      labelBn: 'মোটামুটি মনে আছে',
      subLabelBn: 'মাঝারি অগ্রাধিকার'
    },
    {
      id: 'easy',
      grade: 5,
      labelBn: 'ভালো মনে আছে',
      subLabelBn: 'তালিকার নিচে যাবে'
    }
  ];

  function isValidWordKey(key) {
    if (typeof key !== 'string') return false;
    if (key.startsWith('mcq_pass:') || key.startsWith('ayah_pass:')) return false;
    return /^\d+:\d+:\d+$/.test(key.trim());
  }

  function isWordLearnedInQuiz(rec) {
    if (!rec || !isValidWordKey(rec.word_id)) return false;
    if (rec.learnedInQuiz === true) return true;
    if (Number(rec.correctCount || 0) >= 1) return true;
    if (Number(rec.repetitions || 0) >= 1) return true;
    return false;
  }

  function getFlashcardPriorityTier(rec) {
    if (!rec) return 1;
    const fcReviewed = Number(rec.flashcardLastReviewed || 0);
    const fcCount = Number(rec.flashcardReviewCount || 0);
    const rating = rec.flashcardRating;

    if (fcReviewed <= 0 && fcCount <= 0 && (rating === null || rating === undefined)) {
      return 1;
    }

    const numRating = Number(rating || 3);
    if (numRating <= 2) return 2;
    if (numRating <= 4) return 3;
    return 4;
  }

  function toBnNum(num) {
    const bn = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
    return String(num).replace(/[0-9]/g, (d) => bn[Number(d)]);
  }

  function getFlashcardStatusLabelBn(rec) {
    const tier = getFlashcardPriorityTier(rec);
    const count = Math.max(0, Number((rec && rec.flashcardReviewCount) || 0));
    if (tier === 1) {
      return { tier: 1, filterKey: 'new', labelBn: 'নতুন · কুইজে শেখা' };
    }
    if (tier === 2) {
      return { tier: 2, filterKey: 'review', labelBn: 'রিভিশন দরকার' };
    }
    if (tier === 3) {
      return {
        tier: 3,
        filterKey: 'review',
        labelBn: count > 0 ? `মোটামুটি · ${toBnNum(count)} বার` : 'মোটামুটি'
      };
    }
    return {
      tier: 4,
      filterKey: 'mastered',
      labelBn: count > 0 ? `মনে আছে · ${toBnNum(count)} বার` : 'মনে আছে'
    };
  }

  function compareSmartFlashcardPriority(a, b) {
    const tierA = getFlashcardPriorityTier(a);
    const tierB = getFlashcardPriorityTier(b);
    if (tierA !== tierB) return tierA - tierB;

    if (tierA === 1) {
      const learnedA = Number(a.learnedAt || a.lastReviewed || 0);
      const learnedB = Number(b.learnedAt || b.lastReviewed || 0);
      if (learnedA !== learnedB) return learnedA - learnedB;
    } else {
      const revA = Number(a.flashcardLastReviewed || 0);
      const revB = Number(b.flashcardLastReviewed || 0);
      if (revA !== revB) return revA - revB;
    }

    return String(a.word_id).localeCompare(String(b.word_id));
  }

  function summarizeLearnedWords(progressMap) {
    let totalLearned = 0;
    let unreviewedNewCount = 0;
    let hardCount = 0;
    let mediumCount = 0;
    let easyCount = 0;

    if (!progressMap) {
      return { totalLearned, unreviewedNewCount, hardCount, mediumCount, easyCount };
    }

    for (const [key, item] of Object.entries(progressMap)) {
      const rec = item && item.word_id ? item : item ? { ...item, word_id: key } : null;
      if (!rec || !isWordLearnedInQuiz(rec)) continue;
      totalLearned++;
      const tier = getFlashcardPriorityTier(rec);
      if (tier === 1) unreviewedNewCount++;
      else if (tier === 2) hardCount++;
      else if (tier === 3) mediumCount++;
      else easyCount++;
    }

    return { totalLearned, unreviewedNewCount, hardCount, mediumCount, easyCount };
  }

  function selectSmartFlashcardBatch(progressMap, batchSize = DEFAULT_FLASHCARD_BATCH_SIZE, excludeKeys = null) {
    if (!progressMap) return [];
    const limit = Math.max(1, Math.floor(Number(batchSize) || DEFAULT_FLASHCARD_BATCH_SIZE));
    const excluded = excludeKeys
      ? excludeKeys instanceof Set
        ? excludeKeys
        : new Set(excludeKeys)
      : null;

    const learned = [];
    for (const [key, item] of Object.entries(progressMap)) {
      const rec = item && item.word_id ? item : item ? { ...item, word_id: key } : null;
      if (!rec || !isWordLearnedInQuiz(rec)) continue;
      if (excluded && excluded.has(rec.word_id)) continue;
      learned.push(rec);
    }

    learned.sort(compareSmartFlashcardPriority);
    return learned.slice(0, limit);
  }

  function computeWeakWordTransition(curWeak, isCorrect, source, wordMeta, nowMs = Date.now()) {
    if (source === 'flashcard') {
      return { action: 'none' };
    }

    if (source === 'weak') {
      if (isCorrect) {
        return curWeak ? { action: 'delete' } : { action: 'none' };
      }
      const mistakeCount = curWeak ? Number(curWeak.mistakeCount || 0) + 1 : 1;
      return {
        action: 'upsert',
        record: {
          word_id: wordMeta.word_id,
          mistakeCount,
          consecutiveCorrect: 0,
          lastMistakeAt: nowMs,
          arabic: wordMeta.arabic || (curWeak && curWeak.arabic) || '',
          meaning_bn: wordMeta.meaning_bn || (curWeak && curWeak.meaning_bn) || '',
          root: wordMeta.root || (curWeak && curWeak.root) || '',
          verse_key: wordMeta.verse_key || (curWeak && curWeak.verse_key) || ''
        }
      };
    }

    // source === 'quiz'
    if (!isCorrect) {
      const mistakeCount = curWeak ? Number(curWeak.mistakeCount || 0) + 1 : 1;
      return {
        action: 'upsert',
        record: {
          word_id: wordMeta.word_id,
          mistakeCount,
          consecutiveCorrect: 0,
          lastMistakeAt: nowMs,
          arabic: wordMeta.arabic || (curWeak && curWeak.arabic) || '',
          meaning_bn: wordMeta.meaning_bn || (curWeak && curWeak.meaning_bn) || '',
          root: wordMeta.root || (curWeak && curWeak.root) || '',
          verse_key: wordMeta.verse_key || (curWeak && curWeak.verse_key) || ''
        }
      };
    }

    return { action: 'none' };
  }

  function filterAndSortLearnedWords(items, query = '', filter = 'all') {
    const q = String(query || '').trim().toLowerCase();

    const filtered = (items || []).filter((item) => {
      if (!item || !item.word_id) return false;
      if (filter !== 'all') {
        const status = getFlashcardStatusLabelBn(item.progress);
        if (status.filterKey !== filter) return false;
      }
      if (!q) return true;
      const ar = String(item.arabic || '').toLowerCase();
      const bn = String(item.meaning_bn || '').toLowerCase();
      const root = String(item.root || '').toLowerCase();
      const ref = String(item.verse_key || item.word_id || '').toLowerCase();
      return ar.includes(q) || bn.includes(q) || root.includes(q) || ref.includes(q);
    });

    filtered.sort((a, b) => {
      const timeA = Number((a.progress && (a.progress.lastReviewed || a.progress.learnedAt)) || 0);
      const timeB = Number((b.progress && (b.progress.lastReviewed || b.progress.learnedAt)) || 0);
      if (timeB !== timeA) return timeB - timeA;
      return String(a.word_id).localeCompare(String(b.word_id));
    });

    return filtered;
  }

  global.SmartFlashcardEngine = {
    DEFAULT_FLASHCARD_BATCH_SIZE,
    SMART_FLASHCARD_RATINGS,
    isValidWordKey,
    isWordLearnedInQuiz,
    getFlashcardPriorityTier,
    getFlashcardStatusLabelBn,
    compareSmartFlashcardPriority,
    summarizeLearnedWords,
    selectSmartFlashcardBatch,
    computeWeakWordTransition,
    filterAndSortLearnedWords
  };
})(typeof window !== 'undefined' ? window : globalThis);
