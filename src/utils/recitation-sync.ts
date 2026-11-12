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
