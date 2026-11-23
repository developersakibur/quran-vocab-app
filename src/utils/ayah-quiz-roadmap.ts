/**
 * Pure domain logic for the Surah-by-Surah Ayah Word Quiz Roadmap:
 * - 114 Surahs progress overview & search/filter
 * - Per-Surah Ayah list with per-ayah learned/total word counts
 * - Strict sequential unlock: Ayah 1 of every Surah starts unlocked;
 *   Ayah N unlocks only after passing Ayah N-1 with 100% score
 * - Anti-overwhelm mini-step pagination for long Surahs (> 20 ayahs)
 */

export const AYAH_PASS_PREFIX = 'ayah_pass:';

export interface SurahMetaLike {
  surah?: number;
  number?: number;
  name_arabic?: string;
  name_transliteration?: string;
  name_bn?: string;
  name_bn_script?: string;
  type?: string;
  revelation_bn?: string;
  total_ayahs?: number;
  total_words?: number;
}

export interface AyahWordLike {
  key: string;
  position?: number;
  arabic: string;
  meaning_bn?: string;
  root?: string | null;
}

export interface AyahRecordLike {
  surah: number;
  ayah: number;
  verse_key?: string;
  arabic?: string;
  translation_bn?: string;
  words?: AyahWordLike[];
}

export interface WordProgressLike {
  word_id?: string;
  repetitions?: number;
  correctCount?: number;
  wrongCount?: number;
  status?: string;
  lastReviewed?: number;
}

export interface AyahPassRecord {
  verseKey: string;
  surah: number;
  ayah: number;
  passed: boolean;
  score?: number;
  total?: number;
  passedAt?: number;
}

export interface AyahQuizItemState {
  surah: number;
  ayah: number;
  verseKey: string;
  arabic: string;
  totalWords: number;
  learnedCount: number;
  pct: number;
  isPassed: boolean;
  isUnlocked: boolean;
  isActive: boolean;
  status: 'passed' | 'active' | 'locked';
}

export interface SurahAyahRoadmapSummary {
  surah: number;
  totalAyahs: number;
  completedAyahs: number;
  totalWords: number;
  learnedWords: number;
  pct: number;
  isComplete: boolean;
  activeAyahNumber: number;
  states: AyahQuizItemState[];
}

export interface AyahQuizSurahRow {
  surah: number;
  nameArabic: string;
  nameBnScript: string;
  nameBn: string;
  nameTransliteration: string;
  revelationBn: string;
  totalAyahs: number;
  totalWords: number;
  completedAyahs: number;
  pct: number;
  isComplete: boolean;
  isStarted: boolean;
  nextAyahNumber: number;
  lastPassedAt: number;
}

export interface GlobalAyahQuizOverview {
  completedAyahs: number;
  totalAyahs: number;
  completedSurahs: number;
  startedSurahs: number;
  totalSurahs: number;
  pct: number;
}

export interface ResumeAyahRecommendation {
  surah: number;
  surahNameBn: string;
  ayah: number;
  completedAyahs: number;
  totalAyahs: number;
  isSurahStarted: boolean;
}

export interface AyahMiniStep {
  stepIndex: number;
  startAyah: number;
  endAyah: number;
  labelBn: string;
  passedCount: number;
  totalCount: number;
  hasActive: boolean;
  items: AyahQuizItemState[];
}

export type AyahSurahFilterMode = 'all' | 'in-progress' | 'completed';

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export function toBnDigits(value: number | string): string {
  return String(value).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)] || d);
}

export function normalizeDigitsToAscii(value: string): string {
  return String(value || '').replace(/[০-৯]/g, (ch) => {
    const idx = BN_DIGITS.indexOf(ch);
    return idx >= 0 ? String(idx) : ch;
  });
}

export function isAyahPassKey(key: unknown): boolean {
  return typeof key === 'string' && key.startsWith(AYAH_PASS_PREFIX);
}

export function makeAyahPassKey(surah: number, ayah: number): string {
  return `${AYAH_PASS_PREFIX}${Math.floor(Number(surah))}:${Math.floor(Number(ayah))}`;
}

export function parseAyahPassKey(key: unknown): { surah: number; ayah: number; verseKey: string } | null {
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

export function didPassAyahQuiz(score: number, total: number): boolean {
  return Number(total) > 0 && Number(score) >= Number(total);
}

export function isWordLearned(rec: WordProgressLike | null | undefined): boolean {
  if (!rec) return false;
  if (rec.status === 'mastered') return true;
  if (Number(rec.repetitions || 0) >= 1) return true;
  if (Number(rec.correctCount || 0) >= 1) return true;
  return false;
}

export function getQuizEligibleWords(ayah: AyahRecordLike | null | undefined): AyahWordLike[] {
  if (!ayah || !Array.isArray(ayah.words)) return [];
  return ayah.words
    .filter((w) => w && typeof w.meaning_bn === 'string' && w.meaning_bn.trim().length > 0)
    .slice()
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
}

/**
 * Fisher-Yates shuffle for quiz words so ayah words never appear in predictable
 * sequential ayah order. Guarantees a non-identical order whenever length > 1
 * and items are distinct.
 */
export function shuffleQuizWords<T>(words: readonly T[], rng: () => number = Math.random): T[] {
  if (!Array.isArray(words) || words.length <= 1) {
    return Array.isArray(words) ? words.slice() : [];
  }

  const out = words.slice();
  const n = out.length;

  for (let i = n - 1; i > 0; i--) {
    const raw = Number(rng());
    const clamped = Number.isFinite(raw) ? Math.min(0.999999999, Math.max(0, raw)) : 0;
    const j = Math.floor(clamped * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }

  // If random draw produced the exact original sequential order, rotate by 1..n-1
  const isIdenticalOrder = out.every((item, idx) => item === words[idx]);
  if (isIdenticalOrder && n > 1) {
    const first = out.shift() as T;
    out.push(first);
  }

  return out;
}

export function computeSurahAyahStates(
  surahNumber: number,
  ayahs: AyahRecordLike[],
  progressMap: Record<string, WordProgressLike> = {},
  passedMap: Record<string, AyahPassRecord | boolean> = {}
): AyahQuizItemState[] {
  const sNum = Math.floor(Number(surahNumber) || 1);
  const sortedAyahs = (Array.isArray(ayahs) ? ayahs : [])
    .slice()
    .sort((a, b) => Number(a.ayah || 0) - Number(b.ayah || 0));

  const states: AyahQuizItemState[] = [];
  let prevPassed = true; // Ayah 1 of every Surah is always unlocked
  let activeAssigned = false;

  for (let i = 0; i < sortedAyahs.length; i++) {
    const a = sortedAyahs[i];
    const ayahNum = Number(a.ayah || i + 1);
    const verseKey = a.verse_key || `${sNum}:${ayahNum}`;
    const quizWords = getQuizEligibleWords(a);
    const totalWords = quizWords.length;

    let learnedCount = 0;
    for (const w of quizWords) {
      if (isWordLearned(progressMap[w.key])) {
        learnedCount++;
      }
    }

    const passEntry = passedMap[verseKey];
    const isPassed = Boolean(
      passEntry === true || (passEntry && typeof passEntry === 'object' && passEntry.passed)
    );

    const isUnlocked = i === 0 || prevPassed;
    const isActive = isUnlocked && !isPassed && !activeAssigned;
    if (isActive) activeAssigned = true;

    const effectiveLearned = isPassed ? totalWords : Math.min(learnedCount, totalWords);
    const pct = totalWords > 0 ? Math.round((effectiveLearned / totalWords) * 100) : (isPassed ? 100 : 0);

    const status: 'passed' | 'active' | 'locked' = isPassed
      ? 'passed'
      : isUnlocked
        ? 'active'
        : 'locked';

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

export function computeSurahAyahSummary(
  surahNumber: number,
  ayahs: AyahRecordLike[],
  progressMap: Record<string, WordProgressLike> = {},
  passedMap: Record<string, AyahPassRecord | boolean> = {}
): SurahAyahRoadmapSummary {
  const states = computeSurahAyahStates(surahNumber, ayahs, progressMap, passedMap);
  const totalAyahs = states.length;
  let completedAyahs = 0;
  let totalWords = 0;
  let learnedWords = 0;

  for (const st of states) {
    if (st.isPassed) completedAyahs++;
    totalWords += st.totalWords;
    learnedWords += st.learnedCount;
  }

  const activeItem = states.find((s) => s.isActive)
    || states.find((s) => s.isUnlocked && !s.isPassed)
    || states[states.length - 1];

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

export function buildAyahQuizSurahRows(
  surahsMeta: SurahMetaLike[],
  passedMap: Record<string, AyahPassRecord | boolean> = {}
): AyahQuizSurahRow[] {
  // Index passed ayahs per surah in a single pass
  const passedBySurah = new Map<number, Set<number>>();
  const latestPassAtBySurah = new Map<number, number>();

  for (const [verseKey, val] of Object.entries(passedMap || {})) {
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
    passedBySurah.get(sNum)!.add(aNum);

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
    const passedSet = passedBySurah.get(surah) || new Set<number>();

    // Count contiguous unlocked/completed ayahs & total passed ayahs
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
    const revelationBn = meta.revelation_bn || (rawType === 'meccan' || rawType === 'makki' ? 'মাক্কী' : 'মাদানী');

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

export function computeGlobalAyahQuizOverview(surahRows: AyahQuizSurahRow[]): GlobalAyahQuizOverview {
  let completedAyahs = 0;
  let totalAyahs = 0;
  let completedSurahs = 0;
  let startedSurahs = 0;

  for (const row of surahRows) {
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
    totalSurahs: surahRows.length,
    pct
  };
}

export function findRecommendedResumeAyah(surahRows: AyahQuizSurahRow[]): ResumeAyahRecommendation | null {
  if (!Array.isArray(surahRows) || surahRows.length === 0) return null;

  // 1. Prefer the most recently practiced in-progress surah
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

  // 2. Otherwise pick the first incomplete surah
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

  // 3. All 114 surahs completed -> offer Surah 1 Ayah 1 revision
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

export function filterAyahQuizSurahs(
  surahRows: AyahQuizSurahRow[],
  query: string = '',
  filterMode: AyahSurahFilterMode = 'all'
): AyahQuizSurahRow[] {
  const cleanQuery = normalizeDigitsToAscii(String(query || '').trim().toLowerCase());

  return (Array.isArray(surahRows) ? surahRows : []).filter((row) => {
    if (filterMode === 'in-progress' && !(row.isStarted && !row.isComplete)) {
      return false;
    }
    if (filterMode === 'completed' && !row.isComplete) {
      return false;
    }

    if (!cleanQuery) return true;

    const numStr = String(row.surah);
    const haystack = [
      numStr,
      row.nameBnScript.toLowerCase(),
      row.nameBn.toLowerCase(),
      row.nameTransliteration.toLowerCase(),
      row.nameArabic
    ].join(' ');

    return haystack.includes(cleanQuery);
  });
}

export function buildAyahMiniSteps(
  ayahStates: AyahQuizItemState[],
  stepSize: number = 20
): AyahMiniStep[] {
  const list = Array.isArray(ayahStates) ? ayahStates : [];
  if (list.length === 0) return [];

  const size = Math.max(5, Math.floor(stepSize));
  if (list.length <= size) {
    const passedCount = list.filter((s) => s.isPassed).length;
    return [
      {
        stepIndex: 0,
        startAyah: list[0].ayah,
        endAyah: list[list.length - 1].ayah,
        labelBn: `আয়াত ${toBnDigits(list[0].ayah)}–${toBnDigits(list[list.length - 1].ayah)}`,
        passedCount,
        totalCount: list.length,
        hasActive: list.some((s) => s.isActive),
        items: list
      }
    ];
  }

  const steps: AyahMiniStep[] = [];
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
