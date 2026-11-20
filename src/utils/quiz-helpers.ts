export interface ExactWordMap {
  [arabic: string]: string[];
}

export interface WordProgressRecord {
  word_id?: string;
  repetitions?: number;
  correctCount?: number;
  wrongCount?: number;
  status?: string;
}

export interface WordProgressMap {
  [wordKey: string]: WordProgressRecord;
}

export interface FrequentWordCandidate {
  arabic: string;
  firstKey: string;
  occurrenceCount: number;
  allKeysCount: number;
  surah: number;
  ayah: number;
  position: number;
  isLearned: boolean;
}

export interface QuizWordOptionLike {
  key: string;
  arabic?: string;
  meaning_bn: string;
  root?: string | null;
}

/**
 * Strips Quranic pause/stop annotation marks and surrounding whitespace
 * so lookup matches `data/lookup/exact-word.json` keys reliably.
 */
export function normalizeArabicLookupKey(arabic: string | null | undefined): string {
  if (!arabic) return '';
  return String(arabic)
    .replace(/[\u06D6-\u06DC\u06DE\u06E9]/g, '')
    .trim();
}

/**
 * Returns total occurrences of the exact Arabic word form across the full Quran.
 * Note: `exact-word.json` only stores forms occurring >= 2 times, so any valid
 * Quran word absent from the map occurred 1 time.
 */
export function getExactWordOccurrenceCount(
  arabic: string | null | undefined,
  exactWordMap: ExactWordMap | null | undefined
): number {
  if (!arabic || typeof arabic !== 'string') return 0;
  const trimmed = arabic.trim();
  if (!trimmed) return 0;
  if (!exactWordMap || typeof exactWordMap !== 'object') return 1;

  const normalized = normalizeArabicLookupKey(trimmed);
  const directList = exactWordMap[trimmed];
  if (Array.isArray(directList) && directList.length > 0) {
    return directList.length;
  }
  const normalizedList = normalized ? exactWordMap[normalized] : undefined;
  if (Array.isArray(normalizedList) && normalizedList.length > 0) {
    return normalizedList.length;
  }
  return 1;
}

function parseWordKey(key: string): { surah: number; ayah: number; position: number } | null {
  if (!key || typeof key !== 'string') return null;
  const parts = key.split(':').map((n) => parseInt(n, 10));
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  return { surah: parts[0], ayah: parts[1], position: parts[2] };
}

function isWordAlreadyLearned(
  keys: string[],
  progressMap: WordProgressMap | null | undefined
): boolean {
  if (!progressMap || typeof progressMap !== 'object') return false;
  for (const key of keys) {
    const rec = progressMap[key];
    if (rec && Number(rec.repetitions || 0) >= 1 && Number(rec.correctCount || 0) >= 1) {
      return true;
    }
  }
  return false;
}

/**
 * Builds the global MCQ priority list ordered from highest full-Quran frequency
 * to lowest. Unlearned words come strictly first in descending frequency order;
 * if fewer than `limit` unlearned words remain, learned highest-frequency words
 * fill the remaining slots so the drill is never empty.
 */
export function buildGlobalFrequencyQueue(
  exactWordMap: ExactWordMap | null | undefined,
  progressMap: WordProgressMap | null | undefined = {},
  limit = 10
): FrequentWordCandidate[] {
  if (!exactWordMap || typeof exactWordMap !== 'object' || limit <= 0) return [];

  const ranked: FrequentWordCandidate[] = [];
  for (const [arabic, keys] of Object.entries(exactWordMap)) {
    if (!arabic || !Array.isArray(keys) || keys.length === 0) continue;
    const firstKey = keys[0];
    const parsed = parseWordKey(firstKey);
    if (!parsed) continue;

    ranked.push({
      arabic,
      firstKey,
      occurrenceCount: keys.length,
      allKeysCount: keys.length,
      surah: parsed.surah,
      ayah: parsed.ayah,
      position: parsed.position,
      isLearned: isWordAlreadyLearned(keys, progressMap)
    });
  }

  // Sort strictly by highest Quran occurrence count first, tie-break deterministically by key
  ranked.sort((a, b) => {
    if (b.occurrenceCount !== a.occurrenceCount) {
      return b.occurrenceCount - a.occurrenceCount;
    }
    if (a.surah !== b.surah) return a.surah - b.surah;
    if (a.ayah !== b.ayah) return a.ayah - b.ayah;
    return a.position - b.position;
  });

  const unlearned = ranked.filter((item) => !item.isLearned);
  if (unlearned.length >= limit) {
    return unlearned.slice(0, limit);
  }

  const learned = ranked.filter((item) => item.isLearned);
  return [...unlearned, ...learned].slice(0, limit);
}

/**
 * Picks up to `distractorCount` distinct Bengali meaning distractors from `pool`,
 * prioritizing words with a different root than `correctWord` to prevent confusing
 * near-identical grammatical inflections (e.g. আল্লাহ vs আল্লাহকে) when distinct
 * meanings are available.
 */
export function selectMcqDistractors<T extends QuizWordOptionLike>(
  correctWord: T,
  pool: T[],
  distractorCount = 3,
  rng: () => number = Math.random
): T[] {
  const seenMeanings = new Set<string>([String(correctWord.meaning_bn || '').trim()]);
  const uniquePool: T[] = [];

  for (const item of pool) {
    if (!item || !item.meaning_bn) continue;
    const m = String(item.meaning_bn).trim();
    if (!m || item.key === correctWord.key || seenMeanings.has(m)) continue;
    seenMeanings.add(m);
    uniquePool.push(item);
  }

  // Fisher-Yates shuffle across the full pool
  const shuffled = [...uniquePool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const diffRoot = correctWord.root
    ? shuffled.filter((w) => !w.root || w.root !== correctWord.root)
    : shuffled;
  const sameRoot = correctWord.root
    ? shuffled.filter((w) => w.root === correctWord.root)
    : [];

  return [...diffRoot, ...sameRoot].slice(0, distractorCount);
}
