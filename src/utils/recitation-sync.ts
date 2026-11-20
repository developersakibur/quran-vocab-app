/**
 * Recitation Sync Utilities
 * Handles millisecond-accurate word & ayah alignment for full surah audio recitations
 */

export interface AyahSegmentData {
  segments: Array<[number, number, number]>; // [word_position, start_ms, end_ms]
  duration_sec: number;
  duration_ms: number;
  timestamp_from: number;
  timestamp_to: number;
}

export interface SurahSegmentsData {
  surah_number: number;
  audio_url: string;
  duration: number;
  ayah_count: number;
  ayahs: Record<string, AyahSegmentData>;
}

export interface ActiveSyncState {
  surahNumber: number;
  ayahNumber: number | null;
  verseKey: string | null;
  wordPosition: number | null;
  wordKey: string | null;
}

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export function padSurahNumber(num: number | string): string {
  const n = typeof num === 'string' ? parseInt(num, 10) : num;
  if (isNaN(n) || n <= 0) return '001';
  return String(n).padStart(3, '0');
}

export function toBnDigits(num: number | string): string {
  return String(num).replace(/\d/g, (d) => BN_DIGITS[parseInt(d, 10)]);
}

export function formatDurationEn(totalSeconds: number): string {
  if (isNaN(totalSeconds) || totalSeconds < 0) return '00:00';
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatDurationBn(totalSeconds: number): string {
  return toBnDigits(formatDurationEn(totalSeconds));
}

/**
 * Given current audio playback time in milliseconds, locates the active ayah and word token.
 */
export function findActiveSegment(data: SurahSegmentsData | null, currentMs: number): ActiveSyncState {
  const defaultState: ActiveSyncState = {
    surahNumber: data?.surah_number || 1,
    ayahNumber: null,
    verseKey: null,
    wordPosition: null,
    wordKey: null,
  };

  if (!data || !data.ayahs || currentMs < 0) {
    return defaultState;
  }

  const surahNum = data.surah_number;
  const ayahEntries = Object.entries(data.ayahs);

  // 1. Locate current ayah
  let currentAyahKey: string | null = null;
  let currentAyahData: AyahSegmentData | null = null;

  for (const [aKey, aData] of ayahEntries) {
    if (currentMs >= aData.timestamp_from && currentMs <= aData.timestamp_to + 250) {
      currentAyahKey = aKey;
      currentAyahData = aData;
      break;
    }
  }

  // Fallback: if within a small gap between ayahs, attach to closest preceding or upcoming ayah
  if (!currentAyahKey) {
    for (let i = 0; i < ayahEntries.length; i++) {
      const [aKey, aData] = ayahEntries[i];
      if (currentMs < aData.timestamp_from) {
        // We are before this ayah
        if (i > 0) {
          const prev = ayahEntries[i - 1];
          if (currentMs <= prev[1].timestamp_to + 800) {
            currentAyahKey = prev[0];
            currentAyahData = prev[1];
          }
        }
        break;
      }
    }
  }

  if (!currentAyahKey || !currentAyahData) {
    return defaultState;
  }

  const ayahNumber = parseInt(currentAyahKey, 10);
  const verseKey = `${surahNum}:${ayahNumber}`;

  // 2. Locate active word within the ayah
  let wordPosition: number | null = null;
  let wordKey: string | null = null;

  if (Array.isArray(currentAyahData.segments)) {
    for (const [pos, startMs, endMs] of currentAyahData.segments) {
      // Allow a small 80ms grace window for smooth visual transition
      if (currentMs >= startMs - 40 && currentMs <= endMs + 80) {
        wordPosition = pos;
        wordKey = `${surahNum}:${ayahNumber}:${pos}`;
        break;
      }
    }
  }

  return {
    surahNumber: surahNum,
    ayahNumber,
    verseKey,
    wordPosition,
    wordKey,
  };
}

/**
 * Returns the exact seek time in seconds for a specific Ayah.
 */
export function getAyahSeekSeconds(data: SurahSegmentsData | null, ayahNumber: number): number | null {
  if (!data || !data.ayahs) return null;
  const aData = data.ayahs[String(ayahNumber)];
  if (!aData || typeof aData.timestamp_from !== 'number') return null;
  return Math.max(0, aData.timestamp_from / 1000);
}

/**
 * Returns the exact seek time in seconds for a specific Word.
 */
export function getWordSeekSeconds(
  data: SurahSegmentsData | null,
  ayahNumber: number,
  wordPosition: number
): number | null {
  if (!data || !data.ayahs) return null;
  const aData = data.ayahs[String(ayahNumber)];
  if (!aData || !Array.isArray(aData.segments)) return null;

  const segment = aData.segments.find(([pos]) => pos === wordPosition);
  if (!segment) return null;

  // segment[1] is startMs
  return Math.max(0, segment[1] / 1000);
}

export interface RecitationWordStates {
  surahNumber: number;
  activeAyahNumber: number | null;
  activeWordKey: string | null;
  recitedWordKeys: string[];
}

/**
* Computes the instant word states at `currentMs`:
* - `activeWordKey`: the word currently being recited (gets light ash background + instant color change)
* - `recitedWordKeys`: all words from `startAyahNumber` up to `currentMs` that have already been recited (get green color)
* - Words after `currentMs` are omitted from both and remain in normal color.
*/
export function computeRecitationWordStates(
  data: SurahSegmentsData | null,
  currentMs: number,
  startAyahNumber: number = 1
): RecitationWordStates {
  const surahNum = data?.surah_number || 1;
  if (!data || !data.ayahs || currentMs < 0) {
    return {
      surahNumber: surahNum,
      activeAyahNumber: null,
      activeWordKey: null,
      recitedWordKeys: [],
    };
  }

  let activeAyahNumber: number | null = null;
  let activeWordKey: string | null = null;
  const recitedSet = new Set<string>();
  const ayahNumbers = Object.keys(data.ayahs)
    .map((k) => parseInt(k, 10))
    .filter((n) => !isNaN(n) && n >= startAyahNumber)
    .sort((a, b) => a - b);

  for (const ayahNum of ayahNumbers) {
    const aData = data.ayahs[String(ayahNum)];
    if (!aData || !Array.isArray(aData.segments)) continue;

    // If this entire ayah is in the future, stop scanning further ayahs
    if (currentMs < aData.timestamp_from) {
      break;
    }

    // If this entire ayah has already finished
    if (currentMs > aData.timestamp_to) {
      for (const [pos] of aData.segments) {
        recitedSet.add(`${surahNum}:${ayahNum}:${pos}`);
      }
      continue;
    }

    // Current playback is inside this ayah
    activeAyahNumber = ayahNum;
    const segs = aData.segments;

    for (let i = 0; i < segs.length; i++) {
      const [pos, startMs, endMs] = segs[i];
      const nextStartMs = i + 1 < segs.length ? segs[i + 1][1] : endMs;
      const effectiveEndMs = Math.max(endMs, Math.min(endMs + 40, nextStartMs));
      const wKey = `${surahNum}:${ayahNum}:${pos}`;

      if (currentMs >= startMs && currentMs < effectiveEndMs && !activeWordKey) {
        activeWordKey = wKey;
      } else if (currentMs >= effectiveEndMs) {
        recitedSet.add(wKey);
      }
    }
  }

  if (activeWordKey) {
    recitedSet.delete(activeWordKey);
  }

  return {
    surahNumber: surahNum,
    activeAyahNumber,
    activeWordKey,
    recitedWordKeys: Array.from(recitedSet),
  };
}

export interface AutoScrollViewportInput {
  scrollY: number;
  viewportHeight: number;
  topbarBottom: number;
  playerTop: number;
  elementTopInViewport: number;
  elementHeight: number;
  force?: boolean;
}

/**
 * Pure calculation for auto-scroll Y position during recitation.
 * Keeps active word/ayah cleanly inside the safe viewport band between `.topbar`
 * and the floating `.recitation-player-bar`. Returns `null` when no scroll is needed.
 */
export function computeAutoScrollTargetTop(input: AutoScrollViewportInput): number | null {
  const {
    scrollY,
    viewportHeight,
    topbarBottom,
    playerTop,
    elementTopInViewport,
    elementHeight,
    force = false,
  } = input;

  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return null;

  const safeTop = Math.max(0, topbarBottom) + 16;
  const effectivePlayerTop = playerTop > 0 && playerTop < viewportHeight ? playerTop : viewportHeight;
  const safeBottom = Math.max(safeTop + 80, effectivePlayerTop - 16);
  const safeHeight = Math.max(80, safeBottom - safeTop);

  // For tall ayah cards, only require top + first ~120px to stay visible inside the safe band
  const visibleCheckHeight = Math.min(Math.max(elementHeight, 24), 120);
  const elTop = elementTopInViewport;
  const elCheckBottom = elTop + visibleCheckHeight;

  const desiredViewportY = safeTop + Math.min(96, Math.round(safeHeight * 0.25));
  const isOutsideSafeBand = elTop < safeTop || elCheckBottom > safeBottom;

  if (!force && !isOutsideSafeBand) {
    return null;
  }

  if (force && !isOutsideSafeBand && Math.abs(elTop - desiredViewportY) <= 48) {
    return null;
  }

  const targetScrollTop = Math.max(0, Math.round(scrollY + (elTop - desiredViewportY)));
  if (Math.abs(targetScrollTop - scrollY) <= 4) {
    return null;
  }

  return targetScrollTop;
}

/**
 * Estimates realistic audio byte size for legacy opaque (`no-cors`) CacheStorage entries
 * so Chrome's ~7 MB/entry side-channel quota padding never inflates the user's storage meter.
 */
export function estimateLegacyOpaqueAudioBytes(
  url: string,
  surahDurationSec?: number | null,
  surahTotalWords?: number | null
): number {
  if (!url) return 0;

  if (url.includes('audio.qurancdn.com/wbw') || url.includes('/wbw/')) {
    // Word-by-word MP3 files average ~12-16 KB (16 KB is conservative and realistic)
    return 16 * 1024;
  }

  if (url.includes('audio-cdn.tarteel.ai')) {
    // Tarteel full surah MP3s are ~128 kbps = 16,000 bytes/sec
    if (typeof surahDurationSec === 'number' && surahDurationSec > 0) {
      return Math.round(surahDurationSec * 16000);
    }
    if (typeof surahTotalWords === 'number' && surahTotalWords > 0) {
      return Math.max(400_000, Math.round(surahTotalWords * 16_000));
    }
    return 3_500_000;
  }

  return 32 * 1024;
}


