/**
 * Adaptive Parallel Download Utilities
 * Computes safe browser/device-aware concurrency limits and provides a clean
 * bounded worker pool for parallel data, word audio, and surah recitation downloads.
 */

export interface DeviceNetworkProfile {
  hardwareConcurrency?: number;
  deviceMemory?: number;
  effectiveType?: string;
  saveData?: boolean;
}

export interface ConcurrencyLimits {
  data: number;
  wordAudio: number;
  surahAudio: number;
}

export interface WorkerPoolOptions<T> {
  shouldStop?: () => boolean;
  onItemComplete?: (done: number, total: number, item: T, index: number) => void;
}

export interface WorkerPoolResult {
  done: number;
  total: number;
  stopped: boolean;
}

/**
 * Determines optimal parallel download concurrency based on device CPU cores,
 * memory, and network connection type without exceeding browser socket caps.
 */
export function detectOptimalConcurrency(profile: DeviceNetworkProfile = {}): ConcurrencyLimits {
  const cores = typeof profile.hardwareConcurrency === 'number' && profile.hardwareConcurrency > 0
    ? Math.floor(profile.hardwareConcurrency)
    : 4;
  const mem = typeof profile.deviceMemory === 'number' && profile.deviceMemory > 0
    ? profile.deviceMemory
    : 4;
  const netType = (profile.effectiveType || '').toLowerCase();
  const saveData = Boolean(profile.saveData);

  if (saveData || netType === 'slow-2g' || netType === '2g') {
    return { data: 3, wordAudio: 3, surahAudio: 1 };
  }

  if (netType === '3g' || mem <= 2 || cores <= 2) {
    return { data: 5, wordAudio: 6, surahAudio: 2 };
  }

  return {
    data: Math.min(10, Math.max(6, cores)),
    wordAudio: Math.min(12, Math.max(8, cores + 2)),
    surahAudio: Math.min(4, Math.max(2, Math.floor(cores / 2)))
  };
}

/**
 * Executes an array of tasks using a bounded parallel worker pool.
 */
export async function runWorkerPool<T>(
  items: T[],
  concurrency: number,
  workerFn: (item: T, index: number) => Promise<void>,
  options: WorkerPoolOptions<T> = {}
): Promise<WorkerPoolResult> {
  const total = Array.isArray(items) ? items.length : 0;
  if (total === 0) {
    return { done: 0, total: 0, stopped: false };
  }

  const limit = Math.min(Math.max(1, Math.floor(concurrency || 1)), total);
  const shouldStop = options.shouldStop || (() => false);
  let nextIdx = 0;
  let done = 0;
  let stopped = false;

  async function worker(): Promise<void> {
    while (true) {
      if (shouldStop()) {
        stopped = true;
        return;
      }
      const idx = nextIdx++;
      if (idx >= total) return;

      const item = items[idx];
      await workerFn(item, idx);

      if (shouldStop()) {
        stopped = true;
        return;
      }

      done++;
      if (options.onItemComplete) {
        options.onItemComplete(done, total, item, idx);
      }
    }
  }

  const workers: Array<Promise<void>> = [];
  for (let i = 0; i < limit; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return { done, total, stopped };
}

export interface SurahMetaLite {
  surah: number;
  total_words?: number;
  name_bn_script?: string;
  name_bn?: string;
  name_transliteration?: string;
}

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export function toBengaliDigits(value: number | string): string {
  return String(value).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

/**
 * Returns the lowest-numbered Surah that is still incomplete so parallel
 * out-of-order workers never cause the header title to jump backwards.
 */
export function getLowestIncompleteSurah(
  meta: SurahMetaLite[],
  counts: Record<number, number>,
  type: 'ayah' | 'word'
): SurahMetaLite | null {
  if (!Array.isArray(meta) || meta.length === 0) return null;
  const sorted = meta.slice().sort((a, b) => a.surah - b.surah);
  for (const s of sorted) {
    const total = type === 'ayah' ? 1 : Math.max(1, s.total_words || 0);
    const done = counts[s.surah] || 0;
    if (done < total) {
      return s;
    }
  }
  return null;
}

export function countCompletedSurahs(
  meta: SurahMetaLite[],
  counts: Record<number, number>,
  type: 'ayah' | 'word'
): number {
  if (!Array.isArray(meta) || meta.length === 0) return 0;
  let completed = 0;
  for (const s of meta) {
    const total = type === 'ayah' ? 1 : Math.max(1, s.total_words || 0);
    if ((counts[s.surah] || 0) >= total) {
      completed++;
    }
  }
  return completed;
}

function getSurahLabelName(s: SurahMetaLite | null | undefined, fallbackNum?: number): string {
  if (s) {
    return s.name_bn_script || s.name_bn || s.name_transliteration || `সূরা ${toBengaliDigits(s.surah)}`;
  }
  return fallbackNum ? `সূরা ${toBengaliDigits(fallbackNum)}` : 'সূরা';
}

export interface ParallelWordHeaderInput {
  meta: SurahMetaLite[];
  counts: Record<number, number>;
  overallDone: number;
  totalWords: number;
}

export interface DownloadHeaderState {
  label: string;
  percent: number;
  primarySurah: number | null;
}

/**
 * Builds a monotonic, flicker-free header label for parallel word-audio batch downloads.
 */
export function formatParallelWordHeader(input: ParallelWordHeaderInput): DownloadHeaderState {
  const totalSurahs = input.meta.length || 114;
  const completedSurahs = countCompletedSurahs(input.meta, input.counts, 'word');
  const lowestIncomplete = getLowestIncompleteSurah(input.meta, input.counts, 'word');
  const percent = input.totalWords > 0
    ? Math.max(0, Math.min(100, Math.round((input.overallDone / input.totalWords) * 100)))
    : 0;

  if (!lowestIncomplete) {
    return {
      label: `সব শব্দ অডিও সম্পন্ন (${toBengaliDigits(totalSurahs)}/${toBengaliDigits(totalSurahs)})`,
      percent: 100,
      primarySurah: null
    };
  }

  const surahName = getSurahLabelName(lowestIncomplete);
  return {
    label: `শব্দ অডিও • সূরা ${surahName} (${toBengaliDigits(completedSurahs)}/${toBengaliDigits(totalSurahs)})`,
    percent,
    primarySurah: lowestIncomplete.surah
  };
}

export interface ParallelSurahHeaderInput {
  activeSurahs: number[];
  completedSurahs: number;
  totalSurahs: number;
  overallPercent: number;
  meta: SurahMetaLite[];
}

/**
 * Builds a stable header label for concurrent full-surah recitation downloads.
 * Anchors to the lowest-numbered active surah plus "+ Nটি" so worker chunk ordering
 * never causes the surah name to flicker back and forth.
 */
export function formatParallelSurahHeader(input: ParallelSurahHeaderInput): DownloadHeaderState {
  const total = Math.max(1, input.totalSurahs || 114);
  const completed = Math.max(0, Math.min(total, input.completedSurahs || 0));
  const percent = Math.max(0, Math.min(100, Math.round(input.overallPercent || 0)));
  const sortedActive = Array.from(new Set(input.activeSurahs)).sort((a, b) => a - b);

  if (sortedActive.length === 0) {
    return {
      label: `তিলাওয়াত ডাউনলোড (${toBengaliDigits(completed)}/${toBengaliDigits(total)})`,
      percent,
      primarySurah: null
    };
  }

  const primaryNum = sortedActive[0];
  const primaryMeta = input.meta.find((s) => s.surah === primaryNum);
  const primaryName = getSurahLabelName(primaryMeta, primaryNum);
  const extraCount = sortedActive.length - 1;

  const surahSegment = extraCount > 0
    ? `সূরা ${primaryName} + আরও ${toBengaliDigits(extraCount)}টি`
    : `সূরা ${primaryName}`;

  return {
    label: `${surahSegment} • ${toBengaliDigits(completed)}/${toBengaliDigits(total)}`,
    percent,
    primarySurah: primaryNum
  };
}

export interface ThrottleGate {
  shouldEmit: (nowMs: number, force?: boolean) => boolean;
  reset: () => void;
}

/**
 * Deterministic time-based throttle gate for smooth DOM progress updates.
 */
export function createThrottleGate(intervalMs = 300): ThrottleGate {
  const safeInterval = Math.max(50, Math.floor(intervalMs));
  let lastEmitTs = -Infinity;

  return {
    shouldEmit(nowMs: number, force = false): boolean {
      if (force || nowMs - lastEmitTs >= safeInterval) {
        lastEmitTs = nowMs;
        return true;
      }
      return false;
    },
    reset(): void {
      lastEmitTs = -Infinity;
    }
  };
}

