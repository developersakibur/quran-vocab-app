/**
 * Pure domain logic for Full-Quran MCQ Frequency Groups,
 * 30-Juz / Frequency Sub-Groups, Smart Remainder-Merging 10-Word Lists,
 * Strict 100% Single-Exam Progressive Unlock, and Duolingo-style Progressive Horizon.
 */

export type FreqTuple = [
  key: string,
  arabic: string,
  meaningBn: string,
  occurrenceCount: number,
  juz: number,
  root: string
];

export interface FreqWordEntry {
  key: string;
  arabic: string;
  meaning_bn: string;
  occurrenceCount: number;
  juz: number;
  root: string;
  surah: number;
  ayah: number;
  verse_key: string;
}

export interface McqWordList {
  listKey: string;       // Canonical stable key e.g. "g1:main:1" or "g10:j30:1"
  groupId: string;
  subGroupId: string;
  listNumber: number;    // 1-based index within the sub-group
  words: FreqWordEntry[];
  totalWords: number;
}

export interface McqSubGroup {
  id: string;            // e.g. "main", "ch1", "f9", "f4-ch1", "j1".."j30"
  groupId: string;
  titleBn: string;
  subtitleBn: string;
  badgeBn?: string;
  sectionLabelBn?: string; // Optional grouping header (e.g. "৪ বার আসা শব্দ" vs "৩ বার আসা শব্দ" in G8)
  juz?: number;
  wordCount: number;
  occurrenceSum: number;
  lists: McqWordList[];
}

export interface McqMainGroupConfig {
  id: string;
  order: number;
  tier: 'foundation' | 'deep';
  titleBn: string;
  rangeLabelBn: string;
  minFreq: number;
  maxFreq: number;
  subMode: 'direct' | 'chapters' | 'freq-tiers' | 'freq-chapters' | 'juz';
  descriptionBn: string;
}

export interface McqMainGroup extends McqMainGroupConfig {
  wordCount: number;
  listCount: number;
  occurrenceSum: number;
  coveragePct: number;
  cumulativeCoveragePct: number;
  subGroups: McqSubGroup[];
}

export interface WordProgressRecord {
  word_id?: string;
  repetitions?: number;
  correctCount?: number;
  wrongCount?: number;
  status?: string;
  lastReviewed?: number;
}

export interface McqPassRecord {
  listKey: string;
  passed: boolean;
  bestScore?: number;
  total?: number;
  passedAt?: number;
}

export interface McqListComputedState {
  list: McqWordList;
  learnedCount: number;
  totalWords: number;
  isPassed: boolean;
  isUnlocked: boolean;
  isActive: boolean;
  status: 'passed' | 'active' | 'locked';
}

export interface ProgressiveHorizonResult {
  visibleItems: McqListComputedState[];
  hiddenCount: number;
  totalCount: number;
  activeIndex: number;
}

export interface ResumeRecommendation {
  groupId: string;
  groupTitleBn: string;
  subGroupId: string;
  subGroupTitleBn: string;
  listNumber: number;
  listKey: string;
  learnedCount: number;
  totalWords: number;
}

export const MCQ_PASS_PREFIX = 'mcq_pass:';

export const MCQ_MAIN_GROUP_CONFIGS: McqMainGroupConfig[] = [
  {
    id: 'g1',
    order: 1,
    tier: 'foundation',
    titleBn: 'অতি-মৌলিক শব্দ',
    rangeLabelBn: '৫০০+ বার',
    minFreq: 500,
    maxFreq: Number.POSITIVE_INFINITY,
    subMode: 'direct',
    descriptionBn: 'কুরআনের সবচেয়ে বেশি ব্যবহৃত ১৪টি মূল শব্দ'
  },
  {
    id: 'g2',
    order: 2,
    tier: 'foundation',
    titleBn: 'মূল ভিত্তি',
    rangeLabelBn: '২০০–৪৯৯ বার',
    minFreq: 200,
    maxFreq: 499,
    subMode: 'direct',
    descriptionBn: 'প্রতিটি পৃষ্ঠায় বারবার আসা অপরিহার্য শব্দ'
  },
  {
    id: 'g3',
    order: 3,
    tier: 'foundation',
    titleBn: 'সর্বাধিক পরিচিত',
    rangeLabelBn: '১০০–১৯৯ বার',
    minFreq: 100,
    maxFreq: 199,
    subMode: 'direct',
    descriptionBn: 'শতাধিকবার ব্যবহৃত শক্তিশালী কুরআনী শব্দ'
  },
  {
    id: 'g4',
    order: 4,
    tier: 'foundation',
    titleBn: 'নিয়মিত শব্দ',
    rangeLabelBn: '৫০–৯৯ বার',
    minFreq: 50,
    maxFreq: 99,
    subMode: 'direct',
    descriptionBn: 'ঠিক ১০০টি শব্দ — ১০টি পূর্ণাঙ্গ ১০-শব্দের লিস্ট'
  },
  {
    id: 'g5',
    order: 5,
    tier: 'foundation',
    titleBn: 'মধ্যম-উচ্চ স্তর',
    rangeLabelBn: '২৫–৪৯ বার',
    minFreq: 25,
    maxFreq: 49,
    subMode: 'direct',
    descriptionBn: '২০০টি শব্দ — শেষ করলে কুরআনের প্রায় অর্ধেক বোঝা সম্ভব'
  },
  {
    id: 'g6',
    order: 6,
    tier: 'foundation',
    titleBn: 'গুরুত্বপূর্ণ ভাণ্ডার',
    rangeLabelBn: '১০–২৪ বার',
    minFreq: 10,
    maxFreq: 24,
    subMode: 'chapters',
    descriptionBn: '৬টি ছোট অধ্যায়ে সাজানো — মূল ভিত্তির শেষ ধাপ (৫৯% কুরআন)'
  },
  {
    id: 'g7',
    order: 7,
    tier: 'deep',
    titleBn: 'সম্প্রসারিত শব্দ',
    rangeLabelBn: '৫–৯ বার',
    minFreq: 5,
    maxFreq: 9,
    subMode: 'freq-tiers',
    descriptionBn: '৯ বার থেকে ৫ বার — ৫টি প্রাকৃতিক ফ্রিকোয়েন্সি স্তরে বিভক্ত'
  },
  {
    id: 'g8',
    order: 8,
    tier: 'deep',
    titleBn: 'মাঝারি পুনরাবৃত্তি',
    rangeLabelBn: '৩–৪ বার',
    minFreq: 3,
    maxFreq: 4,
    subMode: 'freq-chapters',
    descriptionBn: '৪ বার ও ৩ বার আসা শব্দগুলো ১০-লিস্টের ছোট অধ্যায়ে বিভক্ত'
  },
  {
    id: 'g9',
    order: 9,
    tier: 'deep',
    titleBn: 'দ্বি-ব্যবহৃত শব্দ',
    rangeLabelBn: '২ বার',
    minFreq: 2,
    maxFreq: 2,
    subMode: 'juz',
    descriptionBn: 'কুরআনের ৩০ পারা অনুযায়ী সাজানো — প্রতি পারায় গড়ে মাত্র ৯–১০ লিস্ট'
  },
  {
    id: 'g10',
    order: 10,
    tier: 'deep',
    titleBn: 'একক শব্দ (বিরল)',
    rangeLabelBn: '১ বার',
    minFreq: 1,
    maxFreq: 1,
    subMode: 'juz',
    descriptionBn: 'কুরআনের ৩০ পারা অনুযায়ী প্রতিটি বিরল একক শব্দ (১০০% কুরআন)'
  }
];

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export function toBnDigits(val: number | string): string {
  return String(val).replace(/\d/g, (d) => BN_DIGITS[Number(d)] || d);
}

export function isMcqPassKey(wordId: string | null | undefined): boolean {
  return typeof wordId === 'string' && wordId.startsWith(MCQ_PASS_PREFIX);
}

export function toMcqPassStorageKey(listKey: string): string {
  return `${MCQ_PASS_PREFIX}${listKey}`;
}

export function fromMcqPassStorageKey(storageKey: string): string | null {
  if (!isMcqPassKey(storageKey)) return null;
  return storageKey.slice(MCQ_PASS_PREFIX.length);
}

/**
 * Smart remainder-merging slicer:
 * - Standard list size = 10 words.
 * - If total <= 15: single list containing all items (never splits e.g. 14 into 10 + 4).
 * - If remainder (total % 10) is 1..5: merges into the last full list (producing 11..15 words).
 * - If remainder (total % 10) is 6..9: creates a separate final list (producing 6..9 words).
 */
export function smartSliceIntoLists<T>(items: T[], baseSize = 10, mergeThreshold = 5): T[][] {
  if (!Array.isArray(items) || items.length === 0) return [];
  const total = items.length;
  if (total <= baseSize + mergeThreshold) {
    return [items.slice()];
  }

  const fullCount = Math.floor(total / baseSize);
  const rem = total % baseSize;
  const chunks: T[][] = [];

  for (let i = 0; i < fullCount; i++) {
    const start = i * baseSize;
    const isLastFull = i === fullCount - 1;
    if (isLastFull && rem >= 1 && rem <= mergeThreshold) {
      chunks.push(items.slice(start));
    } else {
      chunks.push(items.slice(start, start + baseSize));
    }
  }

  if (rem > mergeThreshold) {
    chunks.push(items.slice(fullCount * baseSize));
  }

  return chunks;
}

export function hydrateFreqTuple(tuple: FreqTuple): FreqWordEntry {
  const [key, arabic, meaning_bn, occurrenceCount, juz, root] = tuple;
  const parts = String(key || '1:1:1').split(':');
  const surah = parseInt(parts[0] || '1', 10) || 1;
  const ayah = parseInt(parts[1] || '1', 10) || 1;
  return {
    key,
    arabic,
    meaning_bn,
    occurrenceCount: Number(occurrenceCount || 1),
    juz: Number(juz || 1),
    root: root || '',
    surah,
    ayah,
    verse_key: `${surah}:${ayah}`
  };
}

function makeListsForSubGroup(
  groupId: string,
  subGroupId: string,
  words: FreqWordEntry[]
): McqWordList[] {
  const chunks = smartSliceIntoLists(words, 10, 5);
  return chunks.map((chunk, idx) => {
    const listNumber = idx + 1;
    return {
      listKey: `${groupId}:${subGroupId}:${listNumber}`,
      groupId,
      subGroupId,
      listNumber,
      words: chunk,
      totalWords: chunk.length
    };
  });
}

function splitIntoChapters(
  groupId: string,
  idPrefix: string,
  words: FreqWordEntry[],
  sectionLabelBn?: string,
  targetListsPerChapter = 10
): McqSubGroup[] {
  const allLists = makeListsForSubGroup(groupId, idPrefix, words);
  const totalLists = allLists.length;
  if (totalLists === 0) return [];

  // Divide into balanced ~10-list chapters (merging tiny trailing <=3 list tail into previous chapter)
  const chapterCount = totalLists <= targetListsPerChapter + 3
    ? 1
    : Math.max(1, Math.round(totalLists / targetListsPerChapter));

  const subGroups: McqSubGroup[] = [];
  let cursor = 0;

  for (let ch = 1; ch <= chapterCount; ch++) {
    const remainingLists = totalLists - cursor;
    const remainingChapters = chapterCount - ch + 1;
    const take = ch === chapterCount
      ? remainingLists
      : Math.ceil(remainingLists / remainingChapters);
    const sliceLists = allLists.slice(cursor, cursor + take);
    cursor += take;

    const chId = chapterCount === 1 ? idPrefix : `${idPrefix}-ch${ch}`;
    const chWords = sliceLists.flatMap((l) => l.words);
    const chLists: McqWordList[] = sliceLists.map((l, idx) => ({
      listKey: `${groupId}:${chId}:${idx + 1}`,
      groupId,
      subGroupId: chId,
      listNumber: idx + 1,
      words: l.words,
      totalWords: l.words.length
    }));

    const occSum = chWords.reduce((s, w) => s + w.occurrenceCount, 0);
    subGroups.push({
      id: chId,
      groupId,
      titleBn: chapterCount === 1
        ? (sectionLabelBn || `অধ্যায় ${toBnDigits(ch)}`)
        : `অধ্যায় ${toBnDigits(ch)}`,
      subtitleBn: `${toBnDigits(chWords.length)}টি শব্দ · ${toBnDigits(chLists.length)}টি লিস্ট`,
      sectionLabelBn,
      wordCount: chWords.length,
      occurrenceSum: occSum,
      lists: chLists
    });
  }

  return subGroups;
}

export function buildMcqGroupHierarchy(
  rawEntries: FreqTuple[],
  totalTokensOverride?: number
): { groups: McqMainGroup[]; totalUnique: number; totalTokens: number; totalLists: number } {
  const entries = rawEntries.map(hydrateFreqTuple);
  const totalTokens = totalTokensOverride && totalTokensOverride > 0
    ? totalTokensOverride
    : entries.reduce((s, e) => s + e.occurrenceCount, 0);

  let cumulativeOcc = 0;
  let totalLists = 0;
  const groups: McqMainGroup[] = [];

  for (const cfg of MCQ_MAIN_GROUP_CONFIGS) {
    const matched = entries.filter(
      (e) => e.occurrenceCount >= cfg.minFreq && e.occurrenceCount <= cfg.maxFreq
    );
    const occSum = matched.reduce((s, e) => s + e.occurrenceCount, 0);
    cumulativeOcc += occSum;

    let subGroups: McqSubGroup[] = [];

    if (cfg.subMode === 'direct') {
      const lists = makeListsForSubGroup(cfg.id, 'main', matched);
      subGroups = [{
        id: 'main',
        groupId: cfg.id,
        titleBn: `${cfg.titleBn} (${cfg.rangeLabelBn})`,
        subtitleBn: `${toBnDigits(matched.length)}টি শব্দ · ${toBnDigits(lists.length)}টি লিস্ট`,
        wordCount: matched.length,
        occurrenceSum: occSum,
        lists
      }];
    } else if (cfg.subMode === 'chapters') {
      subGroups = splitIntoChapters(cfg.id, 'ch', matched, undefined, 10);
    } else if (cfg.subMode === 'freq-tiers') {
      // Group 7: exact frequency tiers 9, 8, 7, 6, 5
      for (let freq = cfg.maxFreq; freq >= cfg.minFreq; freq--) {
        const tierWords = matched.filter((w) => w.occurrenceCount === freq);
        if (tierWords.length === 0) continue;
        const lists = makeListsForSubGroup(cfg.id, `f${freq}`, tierWords);
        subGroups.push({
          id: `f${freq}`,
          groupId: cfg.id,
          titleBn: `${toBnDigits(freq)} বার আসা শব্দ`,
          subtitleBn: `${toBnDigits(tierWords.length)}টি শব্দ · ${toBnDigits(lists.length)}টি লিস্ট`,
          wordCount: tierWords.length,
          occurrenceSum: tierWords.reduce((s, w) => s + w.occurrenceCount, 0),
          lists
        });
      }
    } else if (cfg.subMode === 'freq-chapters') {
      // Group 8: 4 times & 3 times split cleanly into ~10-list chapters
      for (let freq = cfg.maxFreq; freq >= cfg.minFreq; freq--) {
        const tierWords = matched.filter((w) => w.occurrenceCount === freq);
        if (tierWords.length === 0) continue;
        const label = `${toBnDigits(freq)} বার আসা শব্দ (${toBnDigits(tierWords.length)}টি)`;
        const chapters = splitIntoChapters(cfg.id, `f${freq}`, tierWords, label, 10);
        subGroups.push(...chapters);
      }
    } else if (cfg.subMode === 'juz') {
      // Group 9 & Group 10: 30 Juz (পারা ১ থেকে পারা ৩০)
      const byJuz = new Map<number, FreqWordEntry[]>();
      for (let j = 1; j <= 30; j++) byJuz.set(j, []);
      for (const w of matched) {
        const j = w.juz >= 1 && w.juz <= 30 ? w.juz : 1;
        byJuz.get(j)!.push(w);
      }
      for (let j = 1; j <= 30; j++) {
        const juzWords = byJuz.get(j) || [];
        if (juzWords.length === 0) continue;
        const lists = makeListsForSubGroup(cfg.id, `j${j}`, juzWords);
        const juzTitle = j === 30
          ? `পারা ${toBnDigits(j)} (আম্মাপারা)`
          : `পারা ${toBnDigits(j)}`;
        subGroups.push({
          id: `j${j}`,
          groupId: cfg.id,
          titleBn: juzTitle,
          subtitleBn: `${toBnDigits(juzWords.length)}টি শব্দ · ${toBnDigits(lists.length)}টি লিস্ট`,
          juz: j,
          wordCount: juzWords.length,
          occurrenceSum: juzWords.reduce((s, w) => s + w.occurrenceCount, 0),
          lists
        });
      }
    }

    const groupListCount = subGroups.reduce((s, sg) => s + sg.lists.length, 0);
    totalLists += groupListCount;

    groups.push({
      ...cfg,
      wordCount: matched.length,
      listCount: groupListCount,
      occurrenceSum: occSum,
      coveragePct: totalTokens > 0 ? Number(((occSum / totalTokens) * 100).toFixed(1)) : 0,
      cumulativeCoveragePct: totalTokens > 0 ? Number(((cumulativeOcc / totalTokens) * 100).toFixed(1)) : 0,
      subGroups
    });
  }

  return {
    groups,
    totalUnique: entries.length,
    totalTokens,
    totalLists
  };
}

/**
 * Checks whether a word counts as "learned" (answered right at least once).
 */
export function isWordLearned(
  wordKey: string,
  progressMap: Record<string, WordProgressRecord> | null | undefined
): boolean {
  if (!progressMap || !wordKey) return false;
  const rec = progressMap[wordKey];
  if (!rec) return false;
  return Number(rec.correctCount || 0) >= 1 || Number(rec.repetitions || 0) >= 1;
}

/**
 * Computes learned counts (e.g. 6/10) and strict 100% single-exam unlock states for a sub-group's lists.
 * Rule:
 * - List 1 (index 0) is ALWAYS unlocked.
 * - List i (index > 0) is unlocked ONLY if List i-1 has `passed === true` in passedMap.
 */
export function computeSubGroupListStates(
  lists: McqWordList[],
  progressMap: Record<string, WordProgressRecord> | null | undefined,
  passedMap: Record<string, McqPassRecord> | null | undefined
): McqListComputedState[] {
  const states: McqListComputedState[] = [];
  let prevPassed = true; // List 1 is always unlocked!
  let activeMarked = false;

  for (let i = 0; i < lists.length; i++) {
    const list = lists[i];
    let learnedCount = 0;
    for (const w of list.words) {
      if (isWordLearned(w.key, progressMap)) learnedCount++;
    }

    const passRec = passedMap ? passedMap[list.listKey] : null;
    const isPassed = Boolean(passRec && passRec.passed);
    // If the list is already passed with 100%, reflect full learned count for visual consistency
    const displayLearned = isPassed ? list.totalWords : Math.min(learnedCount, list.totalWords);
    const isUnlocked = i === 0 || prevPassed;
    const isActive = isUnlocked && !isPassed && !activeMarked;
    if (isActive) activeMarked = true;

    const status: 'passed' | 'active' | 'locked' = isPassed
      ? 'passed'
      : isUnlocked
        ? 'active'
        : 'locked';

    states.push({
      list,
      learnedCount: displayLearned,
      totalWords: list.totalWords,
      isPassed,
      isUnlocked,
      isActive,
      status
    });

    prevPassed = isPassed;
  }

  return states;
}

/**
 * Splits a large sub-group's list states (e.g. > 20 lists inside a Juz of Group 10 or 5-time tier of G7)
 * into clean ~10-list mini-steps so a screen never overwhelms the learner.
 */
export function buildMiniStepsForLists(
  listStates: McqListComputedState[],
  stepSize = 10
): Array<{
  stepIndex: number;
  labelBn: string;
  startNum: number;
  endNum: number;
  items: McqListComputedState[];
  passedCount: number;
  hasActive: boolean;
}> {
  if (listStates.length <= 20) {
    return [{
      stepIndex: 0,
      labelBn: `লিস্ট ${toBnDigits(1)}–${toBnDigits(listStates.length)}`,
      startNum: 1,
      endNum: listStates.length,
      items: listStates,
      passedCount: listStates.filter((s) => s.isPassed).length,
      hasActive: listStates.some((s) => s.isActive)
    }];
  }

  const steps = [];
  for (let i = 0; i < listStates.length; i += stepSize) {
    const slice = listStates.slice(i, i + stepSize);
    const startNum = slice[0].list.listNumber;
    const endNum = slice[slice.length - 1].list.listNumber;
    steps.push({
      stepIndex: steps.length,
      labelBn: `ধাপ ${toBnDigits(steps.length + 1)} (${toBnDigits(startNum)}–${toBnDigits(endNum)})`,
      startNum,
      endNum,
      items: slice,
      passedCount: slice.filter((s) => s.isPassed).length,
      hasActive: slice.some((s) => s.isActive)
    });
  }
  return steps;
}

/**
 * Duolingo-style Progressive Horizon:
 * Shows all passed lists + active unlocked list + up to `upcomingLockedCount` (default 3) locked lists.
 * Hides the rest behind a "বাকি সব লিস্ট দেখুন" toggle to eliminate padlock fatigue.
 */
export function computeProgressiveHorizon(
  listStates: McqListComputedState[],
  showAll = false,
  upcomingLockedCount = 3
): ProgressiveHorizonResult {
  const totalCount = listStates.length;
  const activeIndex = listStates.findIndex((s) => s.isActive);

  if (showAll || totalCount <= upcomingLockedCount + 2) {
    return {
      visibleItems: listStates,
      hiddenCount: 0,
      totalCount,
      activeIndex
    };
  }

  // Last unlocked index (either active index or last passed index)
  let lastUnlockedIdx = activeIndex;
  if (lastUnlockedIdx === -1) {
    // Either all passed or all locked (not possible since index 0 is unlocked)
    lastUnlockedIdx = listStates.reduce((acc, s, idx) => (s.isUnlocked ? idx : acc), 0);
  }

  const cutoff = Math.min(totalCount, lastUnlockedIdx + 1 + upcomingLockedCount);
  return {
    visibleItems: listStates.slice(0, cutoff),
    hiddenCount: Math.max(0, totalCount - cutoff),
    totalCount,
    activeIndex
  };
}

/**
 * Evaluates whether an MCQ list exam passed (strict 100% single-sitting requirement).
 */
export function didPassMcqListExam(score: number, total: number): boolean {
  return total > 0 && score === total;
}

/**
 * Finds the best next list to resume:
 * 1. First unlocked, unpassed list that already has partial progress (learnedCount > 0).
 * 2. Otherwise the first unlocked, unpassed list in the earliest group (e.g. Group 1 List 1).
 */
export function findRecommendedResumeList(
  groups: McqMainGroup[],
  progressMap: Record<string, WordProgressRecord> | null | undefined,
  passedMap: Record<string, McqPassRecord> | null | undefined
): ResumeRecommendation | null {
  let firstUnpassedFallback: ResumeRecommendation | null = null;

  for (const group of groups) {
    for (const sub of group.subGroups) {
      const states = computeSubGroupListStates(sub.lists, progressMap, passedMap);
      for (const st of states) {
        if (st.isUnlocked && !st.isPassed) {
          const rec: ResumeRecommendation = {
            groupId: group.id,
            groupTitleBn: group.titleBn,
            subGroupId: sub.id,
            subGroupTitleBn: sub.titleBn,
            listNumber: st.list.listNumber,
            listKey: st.list.listKey,
            learnedCount: st.learnedCount,
            totalWords: st.totalWords
          };
          if (st.learnedCount > 0) {
            return rec;
          }
          if (!firstUnpassedFallback) {
            firstUnpassedFallback = rec;
          }
        }
      }
    }
  }

  return firstUnpassedFallback;
}
