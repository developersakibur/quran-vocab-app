/**
 * Word Concordance Utilities
 * Splits Quranic word occurrences into:
 *   1. Exact same Arabic word (`exact-word.json`)
 *   2. Different words sharing the same Arabic root (`same-root.json`)
 * Also handles waqf-mark normalization and surah-grouped batch resolution.
 */

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export interface ParsedWordKey {
  key: string;
  surah: number;
  ayah: number;
  position: number;
}

export interface ConcordanceSplitResult {
  exactKeys: string[];
  rootDifferentKeys: string[];
}

export interface SurahKeyGroup {
  surah: number;
  keys: string[];
}

/**
 * Strips Quranic waqf/pause annotations, Rub el Hizb (۞), and Sajdah (۩)
 * while preserving Arabic base letters and harakat so exact-word lookup matches
 * words that carry end-of-ayah pause marks.
 */
export function normalizeExactArabicKey(arabic: string): string {
  if (!arabic) return '';
  return String(arabic)
    .replace(/[\u06D6-\u06DC\u06DE\u06E9]/g, '')
    .trim();
}

export function parseWordKey(key: string): ParsedWordKey | null {
  if (!key || typeof key !== 'string') return null;
  const parts = key.split(':');
  if (parts.length !== 3) return null;
  const surah = parseInt(parts[0], 10);
  const ayah = parseInt(parts[1], 10);
  const position = parseInt(parts[2], 10);
  if (!Number.isFinite(surah) || !Number.isFinite(ayah) || !Number.isFinite(position)) {
    return null;
  }
  return { key, surah, ayah, position };
}

export function formatWordLocationBn(key: string): string {
  const parsed = parseWordKey(key);
  if (!parsed) return '';
  return `${parsed.surah}:${parsed.ayah}:${parsed.position}`.replace(/\d/g, (d) => BN_DIGITS[parseInt(d, 10)]);
}

/**
 * Resolves exact-word occurrences from `exact-word.json`, falling back to
 * waqf-normalized Arabic lookup and hapax-legomenon single-occurrence fallback.
 */
export function lookupExactWordKeys(
  concordance: Record<string, string[]> | null | undefined,
  arabic: string,
  currentWordKey?: string
): string[] {
  const map = concordance || {};
  const trimmed = (arabic || '').trim();
  const normalized = normalizeExactArabicKey(trimmed);

  let raw: string[] = [];
  if (trimmed && Array.isArray(map[trimmed])) {
    raw = map[trimmed];
  } else if (normalized && Array.isArray(map[normalized])) {
    raw = map[normalized];
  }

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const k of raw) {
    if (k && !seen.has(k)) {
      seen.add(k);
      deduped.push(k);
    }
  }

  if (deduped.length === 0 && currentWordKey) {
    return [currentWordKey];
  }

  if (currentWordKey && !seen.has(currentWordKey)) {
    deduped.unshift(currentWordKey);
  }

  return deduped;
}

/**
 * Ensures Section 1 (exact matches) and Section 2 (same root, different words)
 * never overlap: any key appearing in exactKeys or matching currentWordKey
 * is excluded from rootDifferentKeys.
 */
export function splitConcordanceKeys(
  currentWordKey: string,
  exactKeys: string[],
  rootKeys: string[]
): ConcordanceSplitResult {
  const cleanExact: string[] = [];
  const exactSeen = new Set<string>();
  for (const k of exactKeys || []) {
    if (k && !exactSeen.has(k)) {
      exactSeen.add(k);
      cleanExact.push(k);
    }
  }

  const excluded = new Set<string>(exactSeen);
  if (currentWordKey) excluded.add(currentWordKey);

  const rootDifferentKeys: string[] = [];
  const rootSeen = new Set<string>();
  for (const k of rootKeys || []) {
    if (k && !excluded.has(k) && !rootSeen.has(k)) {
      rootSeen.add(k);
      rootDifferentKeys.push(k);
    }
  }

  return {
    exactKeys: cleanExact,
    rootDifferentKeys
  };
}

/**
 * Groups wordKeys ("surah:ayah:word") by surah number in first-seen order
 * so a page slice only fetches each unique surah once.
 */
export function groupKeysBySurah(wordKeys: string[]): SurahKeyGroup[] {
  const map = new Map<number, string[]>();
  for (const key of wordKeys || []) {
    const parsed = parseWordKey(key);
    if (!parsed) continue;
    if (!map.has(parsed.surah)) {
      map.set(parsed.surah, []);
    }
    map.get(parsed.surah)!.push(key);
  }

  return Array.from(map.entries()).map(([surah, keys]) => ({ surah, keys }));
}
