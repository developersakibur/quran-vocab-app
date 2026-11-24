/* ============================================================
   AUDIO DOWNLOAD MANAGER — PURE CORE LOGIC
   Zero DOM / browser globals so every state transition, manifest
   aggregation, queue operation, and cache reconciliation rule is
   unit-testable via `node:test`.
   ============================================================ */

export type AudioDownloadType = 'ayah' | 'word';

export type RowDownloadStatus =
  | 'idle'
  | 'queued'
  | 'downloading'
  | 'partial'
  | 'completed';

export interface SurahAudioEntry {
  bytes: number;
  savedAt: number;
}

export interface WordAudioEntry {
  count: number;
  bytes: number;
  savedAt: number;
  unavailableUrls?: string[];
}

export interface AudioManifest {
  version: number;
  surahAudio: Record<number, SurahAudioEntry>;
  wordAudio: Record<number, WordAudioEntry>;
  reconciledAt: number;
}

export interface SurahMetaLite {
  surah: number;
  total_words: number;
  name_bn_script?: string;
  name_bn?: string;
  name_transliteration?: string;
  name_ar?: string;
}

export interface DownloadTask {
  id: string;
  type: AudioDownloadType;
  surah: number;
  mode: 'single' | 'bulk';
}

export interface ActiveDownloadState {
  task: DownloadTask;
  percent: number;
  receivedBytes: number;
  totalBytes: number;
  completedUnits: number;
  totalUnits: number;
}

export interface AudioOverviewStats {
  completedSurahs: number;
  totalSurahs: number;
  completedWordSurahs: number;
  partialWordSurahs: number;
  totalSavedWords: number;
  totalWords: number;
  totalSurahBytes: number;
  totalWordBytes: number;
  totalAudioBytes: number;
  hasAnySurahAudio: boolean;
  hasAnyWordAudio: boolean;
}

export interface SurahRowDownloadState {
  surah: number;
  type: AudioDownloadType;
  status: RowDownloadStatus;
  doneUnits: number;
  totalUnits: number;
  percent: number;
  bytes: number;
  queuePosition: number; // 0 if not queued, 1-based if queued
  canDelete: boolean;
}

export interface CacheScanResult {
  surahCounts: Record<number, number>;
  surahBytes?: Record<number, number>;
  wordCounts: Record<number, number>;
  wordBytes?: Record<number, number>;
}

export const AUDIO_MANIFEST_VERSION = 1;
export const DEFAULT_WORD_AUDIO_BYTES = 16 * 1024;
export const DEFAULT_SURAH_AUDIO_FALLBACK_BYTES = 2_400_000;
export const MAX_PARALLEL_SURAH_DOWNLOADS = 3;
export const MAX_PARALLEL_WORD_SURAH_TASKS = 3;
export const WORD_AUDIO_CONCURRENCY = 12;

// Optional registry of permanently missing (HTTP 404/410) CDN files if any arise in the future.
// Runtime 404/410 responses are also automatically recorded in each Surah's `unavailableUrls`.
export const KNOWN_UNAVAILABLE_WBW_BY_SURAH: Readonly<Record<number, readonly string[]>> = {};

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export function toBnDigits(val: string | number): string {
  return String(val).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

export function makeTaskId(type: AudioDownloadType, surah: number): string {
  return `${type}:${Math.floor(surah)}`;
}

export function createEmptyAudioManifest(): AudioManifest {
  return {
    version: AUDIO_MANIFEST_VERSION,
    surahAudio: {},
    wordAudio: {},
    reconciledAt: 0
  };
}

export function parseAudioManifest(raw: unknown): AudioManifest {
  const base = createEmptyAudioManifest();
  if (!raw || typeof raw !== 'object') return base;

  const obj = raw as Record<string, unknown>;
  if (obj.surahAudio && typeof obj.surahAudio === 'object') {
    for (const [key, val] of Object.entries(obj.surahAudio as Record<string, unknown>)) {
      const sNum = parseInt(key, 10);
      if (!Number.isInteger(sNum) || sNum < 1 || sNum > 114) continue;
      if (val && typeof val === 'object') {
        const entry = val as Record<string, unknown>;
        const bytes = Number(entry.bytes);
        const savedAt = Number(entry.savedAt) || 0;
        base.surahAudio[sNum] = {
          bytes: Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes) : 0,
          savedAt: Number.isFinite(savedAt) ? savedAt : 0
        };
      }
    }
  }

  if (obj.wordAudio && typeof obj.wordAudio === 'object') {
    for (const [key, val] of Object.entries(obj.wordAudio as Record<string, unknown>)) {
      const sNum = parseInt(key, 10);
      if (!Number.isInteger(sNum) || sNum < 1 || sNum > 114) continue;
      if (val && typeof val === 'object') {
        const entry = val as Record<string, unknown>;
        const count = Math.floor(Number(entry.count) || 0);
        const bytes = Number(entry.bytes);
        const savedAt = Number(entry.savedAt) || 0;
        const unavailableUrls = Array.isArray(entry.unavailableUrls)
          ? Array.from(new Set(entry.unavailableUrls.filter((u): u is string => typeof u === 'string' && u.length > 0)))
          : undefined;
        if (count > 0) {
          base.wordAudio[sNum] = {
            count,
            bytes: Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes) : count * DEFAULT_WORD_AUDIO_BYTES,
            savedAt: Number.isFinite(savedAt) ? savedAt : 0,
            ...(unavailableUrls && unavailableUrls.length > 0 ? { unavailableUrls } : {})
          };
        }
      }
    }
  }

  const reconciledAt = Number(obj.reconciledAt);
  base.reconciledAt = Number.isFinite(reconciledAt) && reconciledAt > 0 ? reconciledAt : 0;
  return base;
}

export function estimateSurahFallbackBytes(meta?: SurahMetaLite): number {
  if (meta && typeof meta.total_words === 'number' && meta.total_words > 0) {
    return Math.max(350_000, Math.round(meta.total_words * 15_500));
  }
  return DEFAULT_SURAH_AUDIO_FALLBACK_BYTES;
}

export function recordSurahAudioSaved(
  manifest: AudioManifest,
  surah: number,
  bytes: number,
  nowMs = Date.now(),
  meta?: SurahMetaLite
): AudioManifest {
  const sNum = Math.floor(surah);
  if (sNum < 1 || sNum > 114) return manifest;
  const safeBytes = Number.isFinite(bytes) && bytes > 0 ? Math.round(bytes) : estimateSurahFallbackBytes(meta);
  return {
    ...manifest,
    surahAudio: {
      ...manifest.surahAudio,
      [sNum]: { bytes: safeBytes, savedAt: nowMs }
    }
  };
}

export function recordWordAudioProgress(
  manifest: AudioManifest,
  surah: number,
  newCount: number,
  addedBytes: number,
  maxWords?: number,
  nowMs = Date.now()
): AudioManifest {
  const sNum = Math.floor(surah);
  if (sNum < 1 || sNum > 114) return manifest;
  const clampedCount = Math.max(
    0,
    maxWords && maxWords > 0 ? Math.min(Math.floor(newCount), maxWords) : Math.floor(newCount)
  );
  if (clampedCount <= 0) {
    return removeSurahWordAudioFromManifest(manifest, sNum);
  }
  const prev = manifest.wordAudio[sNum];
  const prevBytes = prev ? prev.bytes : 0;
  const safeAdded = Number.isFinite(addedBytes) && addedBytes > 0 ? Math.round(addedBytes) : 0;
  const nextBytes =
    safeAdded > 0
      ? prevBytes + safeAdded
      : Math.max(prevBytes, clampedCount * DEFAULT_WORD_AUDIO_BYTES);

  return {
    ...manifest,
    wordAudio: {
      ...manifest.wordAudio,
      [sNum]: {
        count: clampedCount,
        bytes: nextBytes,
        savedAt: nowMs
      }
    }
  };
}

export function removeSurahAudioFromManifest(manifest: AudioManifest, surah: number): AudioManifest {
  const sNum = Math.floor(surah);
  if (!(sNum in manifest.surahAudio)) return manifest;
  const next = { ...manifest.surahAudio };
  delete next[sNum];
  return { ...manifest, surahAudio: next };
}

export function removeSurahWordAudioFromManifest(manifest: AudioManifest, surah: number): AudioManifest {
  const sNum = Math.floor(surah);
  if (!(sNum in manifest.wordAudio)) return manifest;
  const next = { ...manifest.wordAudio };
  delete next[sNum];
  return { ...manifest, wordAudio: next };
}

export function clearTabFromManifest(manifest: AudioManifest, type: AudioDownloadType): AudioManifest {
  if (type === 'ayah') {
    return { ...manifest, surahAudio: {} };
  }
  return { ...manifest, wordAudio: {} };
}

export function reconcileManifestWithCacheScan(
  manifest: AudioManifest,
  scan: CacheScanResult,
  metaList: SurahMetaLite[],
  nowMs = Date.now()
): { manifest: AudioManifest; changed: boolean } {
  const metaBySurah = new Map<number, SurahMetaLite>();
  for (const s of metaList) {
    metaBySurah.set(s.surah, s);
  }

  let changed = false;
  const nextSurahAudio: Record<number, SurahAudioEntry> = {};
  const nextWordAudio: Record<number, WordAudioEntry> = {};

  // Reconcile full Surah recitation entries
  for (const [k, v] of Object.entries(scan.surahCounts || {})) {
    const sNum = parseInt(k, 10);
    if (!Number.isInteger(sNum) || sNum < 1 || sNum > 114 || !v) continue;
    const prev = manifest.surahAudio[sNum];
    const measuredBytes = scan.surahBytes && scan.surahBytes[sNum];
    const bytes =
      measuredBytes && measuredBytes > 0
        ? Math.round(measuredBytes)
        : prev && prev.bytes > 0
          ? prev.bytes
          : estimateSurahFallbackBytes(metaBySurah.get(sNum));
    nextSurahAudio[sNum] = {
      bytes,
      savedAt: prev ? prev.savedAt : nowMs
    };
    if (!prev || prev.bytes !== bytes) {
      changed = true;
    }
  }
  for (const prevKey of Object.keys(manifest.surahAudio)) {
    const sNum = parseInt(prevKey, 10);
    if (!(sNum in nextSurahAudio)) {
      changed = true;
    }
  }

  // Reconcile word-by-word entries
  for (const [k, rawCount] of Object.entries(scan.wordCounts || {})) {
    const sNum = parseInt(k, 10);
    if (!Number.isInteger(sNum) || sNum < 1 || sNum > 114) continue;
    const cachedCount = Math.max(0, Math.floor(rawCount));
    if (cachedCount <= 0) continue;

    const meta = metaBySurah.get(sNum);
    const maxW = meta && meta.total_words > 0 ? meta.total_words : cachedCount;
    const prev = manifest.wordAudio[sNum];

    // Preserve verified permanent-404 URLs (plus known CDN 404s when all other words are cached)
    const unavailableSet = new Set<string>(prev && Array.isArray(prev.unavailableUrls) ? prev.unavailableUrls : []);
    const knownForSurah = KNOWN_UNAVAILABLE_WBW_BY_SURAH[sNum];
    if (knownForSurah && knownForSurah.length > 0 && cachedCount + knownForSurah.length >= maxW) {
      for (const u of knownForSurah) unavailableSet.add(u);
    }

    const unavailableUrls = Array.from(unavailableSet);
    const count = Math.min(cachedCount + unavailableUrls.length, maxW);
    if (count <= 0) continue;

    const measuredBytes = scan.wordBytes && scan.wordBytes[sNum];
    let bytes: number;
    if (measuredBytes && measuredBytes > 0) {
      bytes = Math.round(measuredBytes);
    } else if (prev && prev.count === count && prev.bytes > 0) {
      bytes = prev.bytes;
    } else if (prev && prev.count > 0 && prev.bytes > 0) {
      const avgPerWord = prev.bytes / prev.count;
      bytes = Math.round(avgPerWord * cachedCount);
    } else {
      bytes = cachedCount * DEFAULT_WORD_AUDIO_BYTES;
    }

    nextWordAudio[sNum] = {
      count,
      bytes,
      savedAt: prev ? prev.savedAt : nowMs,
      ...(unavailableUrls.length > 0 ? { unavailableUrls } : {})
    };
    const prevUnavailLen = prev && Array.isArray(prev.unavailableUrls) ? prev.unavailableUrls.length : 0;
    if (!prev || prev.count !== count || Math.abs(prev.bytes - bytes) > 1024 || prevUnavailLen !== unavailableUrls.length) {
      changed = true;
    }
  }
  for (const prevKey of Object.keys(manifest.wordAudio)) {
    const sNum = parseInt(prevKey, 10);
    if (!(sNum in nextWordAudio)) {
      changed = true;
    }
  }

  return {
    manifest: {
      version: AUDIO_MANIFEST_VERSION,
      surahAudio: nextSurahAudio,
      wordAudio: nextWordAudio,
      reconciledAt: nowMs
    },
    changed
  };
}

export function computeAudioOverviewStats(
  manifest: AudioManifest,
  metaList: SurahMetaLite[],
  inFlightBytes = 0
): AudioOverviewStats {
  const totalSurahs = metaList.length > 0 ? metaList.length : 114;
  let totalWords = 0;
  let completedSurahs = 0;
  let completedWordSurahs = 0;
  let partialWordSurahs = 0;
  let totalSavedWords = 0;
  let totalSurahBytes = 0;
  let totalWordBytes = 0;

  if (metaList.length > 0) {
    for (const s of metaList) {
      const sNum = s.surah;
      const wTotal = Math.max(0, s.total_words || 0);
      totalWords += wTotal;

      const surahEntry = manifest.surahAudio[sNum];
      if (surahEntry) {
        completedSurahs++;
        totalSurahBytes += Math.max(0, surahEntry.bytes || 0);
      }

      const wordEntry = manifest.wordAudio[sNum];
      if (wordEntry && wordEntry.count > 0) {
        const clamped = wTotal > 0 ? Math.min(wordEntry.count, wTotal) : wordEntry.count;
        totalSavedWords += clamped;
        totalWordBytes += Math.max(0, wordEntry.bytes || 0);
        if (wTotal > 0 && clamped >= wTotal) {
          completedWordSurahs++;
        } else {
          partialWordSurahs++;
        }
      }
    }
  } else {
    totalWords = 77429;
    for (const entry of Object.values(manifest.surahAudio)) {
      completedSurahs++;
      totalSurahBytes += Math.max(0, entry.bytes || 0);
    }
    for (const entry of Object.values(manifest.wordAudio)) {
      if (entry.count > 0) {
        totalSavedWords += entry.count;
        totalWordBytes += Math.max(0, entry.bytes || 0);
      }
    }
  }

  const safeInFlight = Number.isFinite(inFlightBytes) && inFlightBytes > 0 ? Math.round(inFlightBytes) : 0;
  return {
    completedSurahs,
    totalSurahs,
    completedWordSurahs,
    partialWordSurahs,
    totalSavedWords,
    totalWords,
    totalSurahBytes,
    totalWordBytes,
    totalAudioBytes: totalSurahBytes + totalWordBytes + safeInFlight,
    hasAnySurahAudio: completedSurahs > 0,
    hasAnyWordAudio: totalSavedWords > 0
  };
}

function normalizeActiveList(
  active: ActiveDownloadState | ActiveDownloadState[] | null | undefined
): ActiveDownloadState[] {
  if (!active) return [];
  return Array.isArray(active) ? active : [active];
}

export function getParallelTaskLimit(type: AudioDownloadType): number {
  return type === 'ayah' ? MAX_PARALLEL_SURAH_DOWNLOADS : MAX_PARALLEL_WORD_SURAH_TASKS;
}

export function canStartTaskType(
  active: ActiveDownloadState | ActiveDownloadState[] | null,
  type: AudioDownloadType
): boolean {
  const list = normalizeActiveList(active);
  const runningForType = list.filter((a) => a.task.type === type).length;
  return runningForType < getParallelTaskLimit(type);
}

export function pickNextRunnableTask(
  queue: DownloadTask[],
  active: ActiveDownloadState | ActiveDownloadState[] | null
): { task: DownloadTask | null; queue: DownloadTask[] } {
  const list = normalizeActiveList(active);
  for (let i = 0; i < queue.length; i++) {
    if (canStartTaskType(list, queue[i].type)) {
      const task = queue[i];
      const nextQueue = [...queue.slice(0, i), ...queue.slice(i + 1)];
      return { task, queue: nextQueue };
    }
  }
  return { task: null, queue };
}

export function sumInFlightBytes(
  active: ActiveDownloadState | ActiveDownloadState[] | null
): number {
  const list = normalizeActiveList(active);
  let total = 0;
  for (const item of list) {
    if (item.task.type === 'ayah' && Number.isFinite(item.receivedBytes) && item.receivedBytes > 0) {
      total += Math.round(item.receivedBytes);
    }
  }
  return total;
}

export function computeSurahRowDownloadState(
  surah: SurahMetaLite,
  type: AudioDownloadType,
  manifest: AudioManifest,
  active: ActiveDownloadState | ActiveDownloadState[] | null,
  queue: DownloadTask[]
): SurahRowDownloadState {
  const sNum = surah.surah;
  const taskId = makeTaskId(type, sNum);
  const totalUnits = type === 'ayah' ? 1 : Math.max(1, surah.total_words || 1);

  const surahEntry = manifest.surahAudio[sNum];
  const wordEntry = manifest.wordAudio[sNum];

  const savedUnits =
    type === 'ayah'
      ? surahEntry
        ? 1
        : 0
      : Math.min(totalUnits, wordEntry ? Math.max(0, wordEntry.count) : 0);

  const savedBytes =
    type === 'ayah'
      ? surahEntry
        ? surahEntry.bytes
        : 0
      : wordEntry
        ? wordEntry.bytes
        : 0;

  const activeList = normalizeActiveList(active);
  const matchedActive = activeList.find((a) => a.task.id === taskId) || null;
  if (matchedActive) {
    const doneUnits = type === 'ayah' ? 0 : Math.max(savedUnits, matchedActive.completedUnits);
    const percent =
      type === 'ayah'
        ? Math.max(0, Math.min(99, Math.round(matchedActive.percent || 0)))
        : Math.max(0, Math.min(99, Math.round((doneUnits / totalUnits) * 100)));
    const bytes = type === 'ayah' ? matchedActive.receivedBytes : savedBytes;
    return {
      surah: sNum,
      type,
      status: 'downloading',
      doneUnits,
      totalUnits,
      percent,
      bytes,
      queuePosition: 0,
      canDelete: false
    };
  }

  const queueIdx = queue.findIndex((t) => t.id === taskId);
  if (queueIdx !== -1) {
    const percent = Math.round((savedUnits / totalUnits) * 100);
    return {
      surah: sNum,
      type,
      status: 'queued',
      doneUnits: savedUnits,
      totalUnits,
      percent,
      bytes: savedBytes,
      queuePosition: queueIdx + 1,
      canDelete: false
    };
  }

  if (savedUnits >= totalUnits) {
    return {
      surah: sNum,
      type,
      status: 'completed',
      doneUnits: totalUnits,
      totalUnits,
      percent: 100,
      bytes: savedBytes,
      queuePosition: 0,
      canDelete: true
    };
  }

  if (savedUnits > 0) {
    return {
      surah: sNum,
      type,
      status: 'partial',
      doneUnits: savedUnits,
      totalUnits,
      percent: Math.max(1, Math.min(99, Math.round((savedUnits / totalUnits) * 100))),
      bytes: savedBytes,
      queuePosition: 0,
      canDelete: true
    };
  }

  return {
    surah: sNum,
    type,
    status: 'idle',
    doneUnits: 0,
    totalUnits,
    percent: 0,
    bytes: 0,
    queuePosition: 0,
    canDelete: false
  };
}

export function enqueueDownloadTask(
  queue: DownloadTask[],
  active: ActiveDownloadState | ActiveDownloadState[] | null,
  task: Omit<DownloadTask, 'id'>
): { queue: DownloadTask[]; added: boolean } {
  const id = makeTaskId(task.type, task.surah);
  const activeList = normalizeActiveList(active);
  if (activeList.some((a) => a.task.id === id)) {
    return { queue, added: false };
  }
  if (queue.some((t) => t.id === id)) {
    return { queue, added: false };
  }
  return {
    queue: [...queue, { ...task, id }],
    added: true
  };
}

export function enqueueBulkDownloadTasks(
  queue: DownloadTask[],
  active: ActiveDownloadState | ActiveDownloadState[] | null,
  type: AudioDownloadType,
  metaList: SurahMetaLite[],
  manifest: AudioManifest
): { queue: DownloadTask[]; addedCount: number } {
  let nextQueue = queue.slice();
  let addedCount = 0;

  for (const s of metaList) {
    const isCompleted =
      type === 'ayah'
        ? Boolean(manifest.surahAudio[s.surah])
        : (manifest.wordAudio[s.surah]?.count || 0) >= Math.max(1, s.total_words || 1);
    if (isCompleted) continue;

    const res = enqueueDownloadTask(nextQueue, active, {
      type,
      surah: s.surah,
      mode: 'bulk'
    });
    if (res.added) {
      nextQueue = res.queue;
      addedCount++;
    }
  }

  return { queue: nextQueue, addedCount };
}

export function dequeueDownloadTask(queue: DownloadTask[]): {
  task: DownloadTask | null;
  queue: DownloadTask[];
} {
  if (queue.length === 0) return { task: null, queue };
  return {
    task: queue[0],
    queue: queue.slice(1)
  };
}

export function removeTaskFromQueue(
  queue: DownloadTask[],
  type: AudioDownloadType,
  surah: number
): { queue: DownloadTask[]; removed: boolean } {
  const id = makeTaskId(type, surah);
  const next = queue.filter((t) => t.id !== id);
  return { queue: next, removed: next.length !== queue.length };
}

export function clearDownloadQueueForType(
  queue: DownloadTask[],
  type?: AudioDownloadType
): DownloadTask[] {
  if (!type) return [];
  return queue.filter((t) => t.type !== type);
}

export function formatAudioBytesBn(bytes: number, compact = false): string {
  const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (safe === 0) {
    return compact ? '০ এমবি' : '০.০ মেগাবাইট';
  }
  const kb = safe / 1024;
  if (kb < 1024) {
    const roundedKb = Math.max(1, Math.round(kb));
    return compact ? `${toBnDigits(roundedKb)} কেবি` : `${toBnDigits(roundedKb)} কিলোবাইট`;
  }
  const mb = safe / (1024 * 1024);
  if (mb < 1024) {
    const formatted = mb >= 100 ? mb.toFixed(1) : mb >= 10 ? mb.toFixed(1) : mb.toFixed(2);
    return compact ? `${toBnDigits(formatted)} এমবি` : `${toBnDigits(formatted)} মেগাবাইট`;
  }
  const gb = mb / 1024;
  const formatted = gb.toFixed(2);
  return compact ? `${toBnDigits(formatted)} জিবি` : `${toBnDigits(formatted)} গিগাবাইট`;
}

export function parseCacheAudioUrl(url: string): { type: AudioDownloadType; surah: number } | null {
  if (!url) return null;
  if (url.includes('audio-cdn.tarteel.ai')) {
    const m = url.match(/\/(\d{3})\.mp3/);
    if (m) {
      const s = parseInt(m[1], 10);
      if (s >= 1 && s <= 114) return { type: 'ayah', surah: s };
    }
  } else if (url.includes('audio.qurancdn.com/wbw') || url.includes('/wbw/')) {
    const m = url.match(/\/(\d{3})_(\d{3})_(\d{3})\.mp3/);
    if (m) {
      const s = parseInt(m[1], 10);
      if (s >= 1 && s <= 114) return { type: 'word', surah: s };
    }
  }
  return null;
}

export function doesCacheUrlMatchSurahWord(url: string, surah: number): boolean {
  const parsed = parseCacheAudioUrl(url);
  return Boolean(parsed && parsed.type === 'word' && parsed.surah === Math.floor(surah));
}

export function doesCacheUrlMatchSurahRecitation(url: string, surah: number): boolean {
  const parsed = parseCacheAudioUrl(url);
  return Boolean(parsed && parsed.type === 'ayah' && parsed.surah === Math.floor(surah));
}

/**
 * Deduplicate word URLs while preserving natural verse order and omitting known unavailable URLs.
 */
export function dedupeWordUrls(urls: readonly string[], unavailable?: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    if (typeof raw !== 'string' || !raw) continue;
    if (unavailable && unavailable.has(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

export interface SharedWordPoolJob<TResult> {
  id: string;
  urls: readonly string[];
  isStopped?: () => boolean;
  processUrl: (url: string) => Promise<TResult>;
  onResult?: (url: string, result: TResult) => void;
}

export interface SharedWordDownloadPool {
  runJob<TResult>(job: SharedWordPoolJob<TResult>): Promise<{ processed: number; stopped: boolean }>;
  cancelJob(id: string): void;
  getActiveWorkerCount(): number;
  getActiveJobCount(): number;
}

/**
 * Fair round-robin global worker pool capped at `maxConcurrency` (default 12)
 * across all simultaneously active word-audio Surah tasks (up to 3 Surahs -> 4/4/4 split,
 * 2 Surahs -> 6/6 split, 1 Surah -> full 12 concurrency).
 */
export function createSharedWordDownloadPool(
  maxConcurrency: number = WORD_AUDIO_CONCURRENCY
): SharedWordDownloadPool {
  const limit = Math.max(1, Math.floor(maxConcurrency || WORD_AUDIO_CONCURRENCY));

  interface InternalJob {
    id: string;
    urls: readonly string[];
    cursor: number;
    inFlight: number;
    processed: number;
    cancelled: boolean;
    isStopped: () => boolean;
    processUrl: (url: string) => Promise<unknown>;
    onResult?: (url: string, result: unknown) => void;
    resolve: (summary: { processed: number; stopped: boolean }) => void;
  }

  const jobs: InternalJob[] = [];
  let activeWorkers = 0;
  let rrIndex = 0;
  let pumpScheduled = false;

  function schedulePump(): void {
    if (pumpScheduled) return;
    pumpScheduled = true;
    queueMicrotask(() => {
      pumpScheduled = false;
      pump();
    });
  }

  function isJobStopped(job: InternalJob): boolean {
    return job.cancelled || job.isStopped();
  }

  function trySettleJob(job: InternalJob): void {
    const exhausted = job.cursor >= job.urls.length;
    const stopped = isJobStopped(job);
    if ((exhausted || stopped) && job.inFlight === 0) {
      const idx = jobs.indexOf(job);
      if (idx !== -1) {
        jobs.splice(idx, 1);
        if (rrIndex >= jobs.length) rrIndex = 0;
      }
      job.resolve({ processed: job.processed, stopped: stopped && !exhausted });
    }
  }

  function pickNextWork(): { job: InternalJob; url: string } | null {
    // First settle any already-stopped empty jobs
    for (let i = jobs.length - 1; i >= 0; i--) {
      if (isJobStopped(jobs[i]) && jobs[i].inFlight === 0) {
        trySettleJob(jobs[i]);
      }
    }
    if (jobs.length === 0) return null;

    const count = jobs.length;
    for (let attempt = 0; attempt < count; attempt++) {
      const idx = (rrIndex + attempt) % jobs.length;
      const candidate = jobs[idx];
      if (!isJobStopped(candidate) && candidate.cursor < candidate.urls.length) {
        const url = candidate.urls[candidate.cursor++];
        rrIndex = (idx + 1) % jobs.length;
        return { job: candidate, url };
      }
    }
    return null;
  }

  function pump(): void {
    while (activeWorkers < limit) {
      const next = pickNextWork();
      if (!next) break;
      activeWorkers++;
      next.job.inFlight++;
      runWorkerLoop(next.job, next.url);
    }
  }

  async function runWorkerLoop(initialJob: InternalJob, initialUrl: string): Promise<void> {
    let currentJob: InternalJob | null = initialJob;
    let currentUrl: string | null = initialUrl;

    try {
      while (currentJob && currentUrl !== null) {
        try {
          const result = await currentJob.processUrl(currentUrl);
          if (!isJobStopped(currentJob)) {
            currentJob.processed++;
            if (currentJob.onResult) {
              currentJob.onResult(currentUrl, result);
            }
          }
        } finally {
          currentJob.inFlight--;
          trySettleJob(currentJob);
        }

        const next = pickNextWork();
        if (next) {
          currentJob = next.job;
          currentUrl = next.url;
          currentJob.inFlight++;
        } else {
          currentJob = null;
          currentUrl = null;
        }
      }
    } finally {
      activeWorkers--;
      pump();
    }
  }

  return {
    runJob<TResult>(job: SharedWordPoolJob<TResult>): Promise<{ processed: number; stopped: boolean }> {
      return new Promise((resolve) => {
        const internal: InternalJob = {
          id: job.id,
          urls: job.urls,
          cursor: 0,
          inFlight: 0,
          processed: 0,
          cancelled: false,
          isStopped: job.isStopped || (() => false),
          processUrl: job.processUrl as (url: string) => Promise<unknown>,
          onResult: job.onResult as ((url: string, result: unknown) => void) | undefined,
          resolve
        };
        if (internal.urls.length === 0 || isJobStopped(internal)) {
          resolve({ processed: 0, stopped: isJobStopped(internal) });
          return;
        }
        jobs.push(internal);
        schedulePump();
      });
    },
    cancelJob(id: string): void {
      const target = jobs.find((j) => j.id === id);
      if (!target) return;
      target.cancelled = true;
      trySettleJob(target);
      pump();
    },
    getActiveWorkerCount(): number {
      return activeWorkers;
    },
    getActiveJobCount(): number {
      return jobs.length;
    }
  };
}

