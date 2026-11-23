/**
 * Core Frequent Words List Utilities (Chapters 1–5 from MCQ Frequency Groups)
 * Extracts, sorts (highest frequency first), filters, and summarizes the most
 * frequent Quranic words across MCQ Chapters 1–5 (g1..g5, occurrenceCount >= 25).
 */

export const CORE_FREQUENT_GROUP_IDS = ['g1', 'g2', 'g3', 'g4', 'g5'] as const;
export type CoreFrequentGroupId = (typeof CORE_FREQUENT_GROUP_IDS)[number];

export interface FrequentWordEntry {
  key: string;
  arabic: string;
  meaning_bn: string;
  occurrenceCount: number;
  juz?: number;
  root?: string;
  surah: number;
  ayah: number;
  position?: number;
  verse_key?: string;
}

export interface FrequentGroupSource {
  id: string;
  order: number;
  titleBn: string;
  rangeLabelBn?: string;
  subGroups: Array<{
    lists: Array<{
      words: FrequentWordEntry[];
    }>;
  }>;
}

export interface CoreFrequentWordItem extends FrequentWordEntry {
  rank: number;
  groupId: CoreFrequentGroupId;
  chapterOrder: number;
  chapterTitleBn: string;
  position: number;
}

export interface FrequentChapterStat {
  groupId: CoreFrequentGroupId;
  order: number;
  titleBn: string;
  rangeLabelBn: string;
  wordCount: number;
  occurrenceSum: number;
}

export interface FrequentWordsSummary {
  totalWords: number;
  chapters1To4Words: number;
  totalOccurrences: number;
  coveragePct: number;
  chapters: FrequentChapterStat[];
}

export function stripArabicDiacritics(input: string): string {
  if (!input) return '';
  return String(input)
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .trim();
}

function parsePositionFromKey(key: string): number {
  const parts = String(key || '').split(':');
  const pos = parseInt(parts[2] || '1', 10);
  return Number.isFinite(pos) && pos > 0 ? pos : 1;
}

/**
 * Flattens words from MCQ Chapters 1–5 (g1..g5), deduplicates by word key,
 * and sorts strictly descending by Quran occurrenceCount.
 */
export function buildCoreFrequentWordsList(
  groups: readonly FrequentGroupSource[] | null | undefined,
  allowedGroupIds: readonly string[] = CORE_FREQUENT_GROUP_IDS
): CoreFrequentWordItem[] {
  if (!Array.isArray(groups) || groups.length === 0) return [];

  const allowedSet = new Set(allowedGroupIds);
  const seenKeys = new Set<string>();
  const collected: Omit<CoreFrequentWordItem, 'rank'>[] = [];

  for (const group of groups) {
    if (!group || !allowedSet.has(group.id)) continue;
    for (const sub of group.subGroups || []) {
      for (const list of sub.lists || []) {
        for (const w of list.words || []) {
          if (!w || !w.key || seenKeys.has(w.key)) continue;
          seenKeys.add(w.key);
          const parts = String(w.key).split(':');
          const surah = Number(w.surah) || parseInt(parts[0] || '1', 10) || 1;
          const ayah = Number(w.ayah) || parseInt(parts[1] || '1', 10) || 1;
          const position = Number(w.position) || parsePositionFromKey(w.key);
          collected.push({
            ...w,
            surah,
            ayah,
            position,
            occurrenceCount: Number(w.occurrenceCount || 0),
            groupId: group.id as CoreFrequentGroupId,
            chapterOrder: Number(group.order || 1),
            chapterTitleBn: group.titleBn || ''
          });
        }
      }
    }
  }

  collected.sort((a, b) => {
    if (b.occurrenceCount !== a.occurrenceCount) {
      return b.occurrenceCount - a.occurrenceCount;
    }
    if (a.chapterOrder !== b.chapterOrder) {
      return a.chapterOrder - b.chapterOrder;
    }
    return a.key.localeCompare(b.key);
  });

  return collected.map((item, idx) => ({
    ...item,
    rank: idx + 1
  }));
}

/**
 * Filters Core Frequent Words by chapter ('all' | 'g1'..'g5') and free-text query
 * (matches Arabic with or without harakat, Bengali meaning, or occurrence count).
 * Always preserves strictly descending frequency order.
 */
export function filterCoreFrequentWords(
  items: readonly CoreFrequentWordItem[],
  chapterFilter: string = 'all',
  query: string = ''
): CoreFrequentWordItem[] {
  if (!Array.isArray(items) || items.length === 0) return [];

  const trimmed = String(query || '').trim();
  const normalizedQuery = trimmed.toLowerCase();
  const normalizedArabicQuery = stripArabicDiacritics(trimmed);

  return items.filter((item) => {
    if (chapterFilter && chapterFilter !== 'all' && item.groupId !== chapterFilter) {
      return false;
    }
    if (!trimmed) return true;

    const meaningMatch = String(item.meaning_bn || '').toLowerCase().includes(normalizedQuery);
    if (meaningMatch) return true;

    const arabicDirect = String(item.arabic || '').includes(trimmed);
    if (arabicDirect) return true;

    if (normalizedArabicQuery && stripArabicDiacritics(item.arabic || '').includes(normalizedArabicQuery)) {
      return true;
    }

    const countStr = String(item.occurrenceCount);
    if (countStr.includes(normalizedQuery)) return true;

    return false;
  });
}

/**
 * Computes chapter-by-chapter counts and cumulative Quran coverage for Chapters 1–5.
 */
export function summarizeCoreFrequentWords(
  items: readonly CoreFrequentWordItem[],
  groups: readonly FrequentGroupSource[] | null | undefined,
  totalTokens: number = 77429
): FrequentWordsSummary {
  const groupMeta = new Map<string, FrequentGroupSource>();
  for (const g of groups || []) {
    if (g && g.id) groupMeta.set(g.id, g);
  }

  const chapterMap = new Map<CoreFrequentGroupId, { count: number; occ: number }>();
  for (const id of CORE_FREQUENT_GROUP_IDS) {
    chapterMap.set(id, { count: 0, occ: 0 });
  }

  let totalOccurrences = 0;
  let chapters1To4Words = 0;

  for (const item of items || []) {
    const bucket = chapterMap.get(item.groupId);
    if (bucket) {
      bucket.count += 1;
      bucket.occ += item.occurrenceCount;
    }
    totalOccurrences += item.occurrenceCount;
    if (item.chapterOrder <= 4) {
      chapters1To4Words += 1;
    }
  }

  const chapters: FrequentChapterStat[] = CORE_FREQUENT_GROUP_IDS.map((id, idx) => {
    const meta = groupMeta.get(id);
    const bucket = chapterMap.get(id)!;
    return {
      groupId: id,
      order: meta ? Number(meta.order) : idx + 1,
      titleBn: meta ? meta.titleBn : `অধ্যায় ${idx + 1}`,
      rangeLabelBn: meta && meta.rangeLabelBn ? meta.rangeLabelBn : '',
      wordCount: bucket.count,
      occurrenceSum: bucket.occ
    };
  });

  const coveragePct = totalTokens > 0
    ? Number(((totalOccurrences / totalTokens) * 100).toFixed(1))
    : 0;

  return {
    totalWords: (items || []).length,
    chapters1To4Words,
    totalOccurrences,
    coveragePct,
    chapters
  };
}
