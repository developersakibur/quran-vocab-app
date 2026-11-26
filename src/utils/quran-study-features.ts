/* ============================================================
   QURAN STUDY FEATURES — PURE LOGIC MODULE
   Covers:
   1. 30-Juz (Para) Directory & Surah:Ayah Quick-Jump Parser
   2. Global Quran Word Search (Bangla, Arabic, Root)
   3. Live Quran Coverage % & Daily Goal Engine
   4. Root Family Explorer Index & Filter
   5. Ayah Repeat / Range Loop State Machine
   6. Custom Side Ayah Scrubber Math
   ============================================================ */

export interface JuzEntry {
  juz: number;
  nameAr: string;
  nameBn: string;
  startSurah: number;
  startAyah: number;
  endSurah: number;
  endAyah: number;
}

export type FrequencyTuple = [
  key: string,
  arabic: string,
  meaningBn: string,
  count: number,
  juz: number,
  root: string
];

export interface GlobalSearchResult {
  key: string;
  arabic: string;
  meaningBn: string;
  count: number;
  juz: number;
  root: string;
  surah: number;
  ayah: number;
  matchType: 'exact' | 'prefix' | 'contains';
}

export type GlobalSearchMode = 'all' | 'bangla' | 'arabic' | 'root';

export interface QuranCoverageStats {
  learnedUniqueCount: number;
  coveredTokens: number;
  totalTokens: number;
  coveragePercent: number;
  nextMilestonePercent: number;
  milestoneProgressPercent: number;
}

export interface DailyGoalState {
  todayCount: number;
  target: number;
  percent: number;
  remaining: number;
  achieved: boolean;
}

export interface RootFamilySummary {
  root: string;
  spacedRoot: string;
  totalOccurrences: number;
  uniqueWordCount: number;
  sampleMeaningBn: string;
  topWords: Array<{
    key: string;
    arabic: string;
    meaningBn: string;
    count: number;
    juz: number;
  }>;
}

export interface AyahSegmentTiming {
  timestamp_from: number;
  timestamp_to: number;
  segments?: Array<[number, number, number]>;
}

export interface AyahLoopConfig {
  enabled: boolean;
  mode: 'single' | 'range';
  repeatLimit: number; // 0 = infinite, 3 = 3x, 5 = 5x
  completedLoops: number;
  startAyah: number;
  endAyah: number;
}

export type AyahLoopTransition =
  | { action: 'none' }
  | { action: 'seek'; targetMs: number; nextCompletedLoops: number }
  | { action: 'complete'; nextCompletedLoops: number };

export const TOTAL_QURAN_TOKENS = 77429;
export const DAILY_GOAL_PRESETS = [5, 10, 20, 30] as const;

export const JUZ_DIRECTORY: readonly JuzEntry[] = [
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

const BN_TO_EN_MAP: Record<string, string> = {
  '০': '0',
  '১': '1',
  '২': '2',
  '৩': '3',
  '৪': '4',
  '৫': '5',
  '৬': '6',
  '৭': '7',
  '৮': '8',
  '৯': '9'
};

export function normalizeDigitsToAscii(input: string): string {
  return String(input || '').replace(/[০-৯]/g, (ch) => BN_TO_EN_MAP[ch] ?? ch);
}

/**
 * Parses direct Surah:Ayah quick-jump inputs like "2:255", "২:২৫৫", "2 255", "18.10".
 */
export function parseSurahAyahJump(
  rawQuery: string,
  surahAyahTotals?: ReadonlyMap<number, number> | Record<number, number>
): { surah: number; ayah: number } | null {
  const normalized = normalizeDigitsToAscii(rawQuery).trim();
  if (!normalized) return null;

  const match = normalized.match(/^(\d{1,3})\s*[:./\-\s]\s*(\d{1,3})$/);
  if (!match) return null;

  const surah = parseInt(match[1], 10);
  const ayah = parseInt(match[2], 10);
  if (!Number.isInteger(surah) || surah < 1 || surah > 114) return null;
  if (!Number.isInteger(ayah) || ayah < 1) return null;

  if (surahAyahTotals) {
    const maxAyah =
      surahAyahTotals instanceof Map
        ? surahAyahTotals.get(surah)
        : (surahAyahTotals as Record<number, number>)[surah];
    if (typeof maxAyah === 'number' && maxAyah > 0 && ayah > maxAyah) {
      return null;
    }
  }

  return { surah, ayah };
}

/**
 * Strips Quranic tashkeel, harakat, waqf marks, tatweel and normalizes Alef/Ya/Ta Marbuta
 * so Arabic word and root searches match regardless of diacritics.
 */
export function normalizeArabicForSearch(text: string): string {
  return String(text || '')
    .normalize('NFC')
    // Remove Quranic annotation marks, harakat, superscipt alef, maddah, tatweel
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640\u200C\u200D]/g, '')
    // Unify Alef variants (including Alef Wasla ٱ)
    .replace(/[أإآٱٲٳٵ]/g, 'ا')
    // Unify Ya / Alef Maqsura
    .replace(/[ىيئ]/g, 'ي')
    // Unify Waw with Hamza
    .replace(/ؤ/g, 'و')
    // Unify Ta Marbuta -> Ha for forgiving search
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatSpacedRoot(root: string): string {
  const compact = String(root || '').replace(/\s+/g, '');
  if (!compact) return '';
  return Array.from(compact).join(' ');
}

/**
 * Searches across all 19,123 unique Quranic frequency entries by Bangla meaning,
 * diacritic-insensitive Arabic word, or Arabic root. Ranked by match precision then frequency.
 */
export function searchGlobalQuranWords(
  entries: readonly FrequencyTuple[],
  rawQuery: string,
  mode: GlobalSearchMode = 'all',
  limit = 60
): GlobalSearchResult[] {
  const trimmed = String(rawQuery || '').trim();
  if (!trimmed || !Array.isArray(entries) || entries.length === 0) return [];

  const qLower = trimmed.toLowerCase();
  const qAr = normalizeArabicForSearch(trimmed);
  const qRootCompact = qAr.replace(/\s+/g, '');
  const hasArabic = /[\u0600-\u06FF]/.test(trimmed);

  const ranked: Array<{ score: number; item: GlobalSearchResult }> = [];

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
    let matchType: 'exact' | 'prefix' | 'contains' = 'contains';

    // 1. Bangla meaning match
    if (mode === 'all' || mode === 'bangla') {
      const bnLower = meaningBn.toLowerCase();
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

    // 2. Arabic word match
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

    // 3. Root match
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

/**
 * Computes exact live Quran token coverage percentage from learned words against
 * the full 77,429-token Quranic frequency index.
 */
export function computeQuranCoverageStats(
  progressMap: Record<string, { word_id?: string; arabic?: string; status?: string; correctCount?: number; repetitions?: number }>,
  frequencyEntries: readonly FrequencyTuple[],
  totalTokens = TOTAL_QURAN_TOKENS
): QuranCoverageStats {
  const safeTotal = Math.max(1, Number(totalTokens || TOTAL_QURAN_TOKENS));

  // Build quick lookup from representative key & normalized/exact Arabic -> frequency entry index
  const byKey = new Map<string, number>();
  const byExactArabic = new Map<string, number>();
  for (let i = 0; i < frequencyEntries.length; i++) {
    const entry = frequencyEntries[i];
    if (!entry) continue;
    byKey.set(entry[0], i);
    if (entry[1] && !byExactArabic.has(entry[1])) {
      byExactArabic.set(entry[1], i);
    }
  }

  const matchedEntryIndices = new Set<number>();
  let learnedUniqueCount = 0;
  let fallbackUnindexedTokens = 0;

  for (const [mapKey, rec] of Object.entries(progressMap || {})) {
    if (!rec) continue;
    // Skip non-word keys like mcq_pass:* or ayah_pass:*
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
    coveredTokens += Number(frequencyEntries[idx]?.[3] || 0);
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

export function normalizeDailyGoalTarget(target: number): number {
  const n = Math.floor(Number(target));
  if (!Number.isFinite(n) || n < 5) return 10;
  return Math.min(100, n);
}

export function computeDailyGoalState(todayCount: number, target: number): DailyGoalState {
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

/**
 * Builds the Root Family Explorer directory sorted by total Quranic occurrences descending.
 */
export function buildRootFamiliesIndex(
  frequencyEntries: readonly FrequencyTuple[],
  sameRootMap?: Record<string, string[]> | null
): RootFamilySummary[] {
  const byRoot = new Map<
    string,
    {
      totalFromFreq: number;
      words: Array<{ key: string; arabic: string; meaningBn: string; count: number; juz: number }>;
    }
  >();

  for (let i = 0; i < frequencyEntries.length; i++) {
    const e = frequencyEntries[i];
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

  const families: RootFamilySummary[] = [];
  for (const [root, bucket] of byRoot.entries()) {
    bucket.words.sort((a, b) => b.count - a.count);
    const sameRootCount =
      sameRootMap && Array.isArray(sameRootMap[root]) ? sameRootMap[root].length : 0;
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

export function filterRootFamilies(
  families: readonly RootFamilySummary[],
  rawQuery: string
): RootFamilySummary[] {
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

/**
 * Evaluates whether the audio recitation should loop back to the loop start ayah.
 */
export function evaluateAyahLoopTransition(
  curMs: number,
  ayahsMap: Record<string, AyahSegmentTiming> | null | undefined,
  config: AyahLoopConfig
): AyahLoopTransition {
  if (!config || !config.enabled || !ayahsMap) return { action: 'none' };

  const startNum = Math.max(1, Math.floor(config.startAyah || 1));
  const endNum = config.mode === 'range'
    ? Math.max(startNum, Math.floor(config.endAyah || startNum))
    : startNum;

  const startData = ayahsMap[String(startNum)];
  const endData = ayahsMap[String(endNum)];
  if (!startData || !endData) return { action: 'none' };

  // Trigger loop when playback reaches within 35ms of end timestamp
  if (curMs < endData.timestamp_to - 35) {
    return { action: 'none' };
  }

  const nextCompletedLoops = config.completedLoops + 1;
  // repeatLimit === 0 means infinite repeat
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

/**
 * Maps a 0..1 vertical drag ratio along the custom side scrollbar to an exact Ayah number (1..totalAyahs).
 */
export function computeScrubberAyahFromRatio(ratio: number, totalAyahs: number): number {
  const safeTotal = Math.max(1, Math.floor(Number(totalAyahs) || 1));
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  return Math.max(1, Math.min(safeTotal, Math.round(clamped * (safeTotal - 1)) + 1));
}

/**
 * Maps the currently visible Ayah (1..totalAyahs) back to a 0..1 vertical thumb ratio.
 */
export function computeScrubberRatioFromAyah(currentAyah: number, totalAyahs: number): number {
  const safeTotal = Math.max(1, Math.floor(Number(totalAyahs) || 1));
  if (safeTotal <= 1) return 0;
  const clamped = Math.max(1, Math.min(safeTotal, Math.floor(Number(currentAyah) || 1)));
  return (clamped - 1) / (safeTotal - 1);
}
