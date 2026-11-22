/* ============================================================
   SMART FLASHCARD ROTATION & WEAK WORDS STATE MACHINE (PURE LOGIC)
   - Handles 4-tier priority queue across 2,000-5,000+ learned words
   - Enforces Quiz-only Weak Words entry & 1-correct Weak MCQ graduation
   - Powers the "শেখা শব্দ" (Learned Words) table filtering & sorting
   ============================================================ */

export type PracticeRecordSource = 'quiz' | 'flashcard' | 'weak';

export type FlashcardRatingId = 'hard' | 'medium' | 'easy';

export interface WordProgressRecord {
  word_id: string;
  status?: string;
  box?: number;
  repetitions?: number;
  interval?: number;
  intervalDays?: number;
  easeFactor?: number;
  correctCount?: number;
  wrongCount?: number;
  lastGrade?: number;
  lastReviewed?: number | null;
  nextReview?: number | null;
  nextReviewDate?: string | null;
  rememberScore?: number;
  // New fields for Learned-Words Flashcard Rotation
  learnedInQuiz?: boolean;
  learnedAt?: number | null;
  flashcardRating?: number | null; // 1 = ভুলে গেছি / কঠিন, 3 = মোটামুটি, 5 = ভালো মনে আছে / সহজ
  flashcardLastReviewed?: number | null;
  flashcardReviewCount?: number;
  // Cached display metadata so Learned Words table loads fast offline
  arabic?: string;
  meaning_bn?: string;
  root?: string;
  verse_key?: string;
}

export interface WeakWordRecord {
  word_id: string;
  mistakeCount: number;
  consecutiveCorrect: number;
  lastMistakeAt: number;
  arabic: string;
  meaning_bn: string;
  root: string;
  verse_key: string;
}

export interface WeakWordTransitionResult {
  action: 'upsert' | 'delete' | 'none';
  record?: WeakWordRecord;
}

export interface SmartFlashcardRatingOption {
  id: FlashcardRatingId;
  grade: number;
  labelBn: string;
  subLabelBn: string;
}

export const SMART_FLASHCARD_RATINGS: readonly SmartFlashcardRatingOption[] = [
  {
    id: 'hard',
    grade: 1,
    labelBn: 'ভুলে গেছি / কঠিন',
    subLabelBn: 'আবার দ্রুত আসবে',
  },
  {
    id: 'medium',
    grade: 3,
    labelBn: 'মোটামুটি মনে আছে',
    subLabelBn: 'মাঝারি অগ্রাধিকার',
  },
  {
    id: 'easy',
    grade: 5,
    labelBn: 'ভালো মনে আছে',
    subLabelBn: 'তালিকার নিচে যাবে',
  },
];

export const DEFAULT_FLASHCARD_BATCH_SIZE = 10;

export function isValidWordKey(key: string): boolean {
  if (typeof key !== 'string') return false;
  if (key.startsWith('mcq_pass:') || key.startsWith('ayah_pass:')) return false;
  return /^\d+:\d+:\d+$/.test(key.trim());
}

/**
 * Determines whether a word has been successfully learned / answered correctly in quizzes.
 * Backward-compatible with existing word_progress records that only have correctCount / repetitions.
 */
export function isWordLearnedInQuiz(rec: WordProgressRecord | null | undefined): boolean {
  if (!rec || !isValidWordKey(rec.word_id)) return false;
  if (rec.learnedInQuiz === true) return true;
  if (Number(rec.correctCount || 0) >= 1) return true;
  if (Number(rec.repetitions || 0) >= 1) return true;
  return false;
}

/**
 * 4-Tier Smart Flashcard Priority Queue:
 * Tier 1: Newly learned in quiz, NEVER reviewed in flashcards yet (100% appear first!)
 * Tier 2: Flashcard rating <= 2 (ভুলে গেছি / কঠিন) — oldest reviewed first
 * Tier 3: Flashcard rating 3-4 (মোটামুটি) — oldest reviewed first
 * Tier 4: Flashcard rating >= 5 (ভালো মনে আছে / সহজ) — pushed to bottom, oldest reviewed first
 */
export function getFlashcardPriorityTier(rec: WordProgressRecord | null | undefined): 1 | 2 | 3 | 4 {
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

export function getFlashcardStatusLabelBn(rec: WordProgressRecord | null | undefined): {
  tier: 1 | 2 | 3 | 4;
  filterKey: 'new' | 'review' | 'mastered';
  labelBn: string;
} {
  const tier = getFlashcardPriorityTier(rec);
  const count = Math.max(0, Number(rec?.flashcardReviewCount || 0));
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
      labelBn: count > 0 ? `মোটামুটি · ${count} বার` : 'মোটামুটি',
    };
  }
  return {
    tier: 4,
    filterKey: 'mastered',
    labelBn: count > 0 ? `মনে আছে · ${count} বার` : 'মনে আছে',
  };
}

/**
 * Compares two learned words for the Smart Flashcard Priority Queue.
 * Lower tier always wins. Within Tier 1: oldest learnedAt first (FIFO).
 * Within Tiers 2-4: oldest flashcardLastReviewed first so every word cycles fairly.
 */
export function compareSmartFlashcardPriority(a: WordProgressRecord, b: WordProgressRecord): number {
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

export interface SmartFlashcardSummary {
  totalLearned: number;
  unreviewedNewCount: number;
  hardCount: number;
  mediumCount: number;
  easyCount: number;
}

export function summarizeLearnedWords(
  progressMap: Record<string, WordProgressRecord> | null | undefined
): SmartFlashcardSummary {
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

/**
 * Selects the next smart batch (default 10) from ALL learned words using the 4-tier priority queue.
 * Scales smoothly to 5,000+ words in < 5ms.
 */
export function selectSmartFlashcardBatch(
  progressMap: Record<string, WordProgressRecord> | null | undefined,
  batchSize: number = DEFAULT_FLASHCARD_BATCH_SIZE,
  excludeKeys?: Set<string> | string[]
): WordProgressRecord[] {
  if (!progressMap) return [];
  const limit = Math.max(1, Math.floor(Number(batchSize) || DEFAULT_FLASHCARD_BATCH_SIZE));
  const excluded = excludeKeys
    ? excludeKeys instanceof Set
      ? excludeKeys
      : new Set(excludeKeys)
    : null;

  const learned: WordProgressRecord[] = [];
  for (const [key, item] of Object.entries(progressMap)) {
    const rec = item && item.word_id ? item : item ? { ...item, word_id: key } : null;
    if (!rec || !isWordLearnedInQuiz(rec)) continue;
    if (excluded && excluded.has(rec.word_id)) continue;
    learned.push(rec);
  }

  learned.sort(compareSmartFlashcardPriority);
  return learned.slice(0, limit);
}

/**
 * Pure Weak Words State Machine:
 * - source === 'quiz':
 *     - wrong (!isCorrect) => add/increment weak word
 *     - correct (isCorrect) => do NOT delete existing weak word (must pass Weak Words drill)
 * - source === 'flashcard':
 *     - NEVER adds or deletes weak words
 * - source === 'weak':
 *     - correct (isCorrect) => immediately delete from weak words!
 *     - wrong (!isCorrect) => increment mistakeCount and keep in weak words
 */
export function computeWeakWordTransition(
  curWeak: WeakWordRecord | null | undefined,
  isCorrect: boolean,
  source: PracticeRecordSource,
  wordMeta: { word_id: string; arabic?: string; meaning_bn?: string; root?: string; verse_key?: string },
  nowMs: number = Date.now()
): WeakWordTransitionResult {
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
        arabic: wordMeta.arabic || curWeak?.arabic || '',
        meaning_bn: wordMeta.meaning_bn || curWeak?.meaning_bn || '',
        root: wordMeta.root || curWeak?.root || '',
        verse_key: wordMeta.verse_key || curWeak?.verse_key || '',
      },
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
        arabic: wordMeta.arabic || curWeak?.arabic || '',
        meaning_bn: wordMeta.meaning_bn || curWeak?.meaning_bn || '',
        root: wordMeta.root || curWeak?.root || '',
        verse_key: wordMeta.verse_key || curWeak?.verse_key || '',
      },
    };
  }

  return { action: 'none' };
}

export interface LearnedWordDisplayItem {
  word_id: string;
  arabic: string;
  meaning_bn: string;
  root?: string;
  verse_key?: string;
  progress: WordProgressRecord;
}

export type LearnedWordsFilter = 'all' | 'new' | 'review' | 'mastered';

export function filterAndSortLearnedWords(
  items: LearnedWordDisplayItem[],
  query: string = '',
  filter: LearnedWordsFilter = 'all'
): LearnedWordDisplayItem[] {
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

  // Sort most recently learned / practiced first for effortless revision browsing
  filtered.sort((a, b) => {
    const timeA = Number(a.progress.lastReviewed || a.progress.learnedAt || 0);
    const timeB = Number(b.progress.lastReviewed || b.progress.learnedAt || 0);
    if (timeB !== timeA) return timeB - timeA;
    return String(a.word_id).localeCompare(String(b.word_id));
  });

  return filtered;
}
