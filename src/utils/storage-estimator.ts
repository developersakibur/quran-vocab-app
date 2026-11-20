export type AudioCacheKind = 'surah' | 'word' | 'other';

export interface ClassifiedAudioUrl {
  kind: AudioCacheKind;
  surah: number | null;
}

export interface AudioCacheKeySummary {
  ayahCounts: Record<number, number>;
  wordCounts: Record<number, number>;
  surahUrls: string[];
  wordUrls: string[];
  otherUrls: string[];
}

export function classifyAudioCacheUrl(url: string): ClassifiedAudioUrl {
  const str = String(url || '');
  if (str.includes('audio-cdn.tarteel.ai')) {
    const m = str.match(/\/(\d{3})\.mp3/);
    if (m) {
      const s = parseInt(m[1], 10);
      if (s >= 1 && s <= 114) return { kind: 'surah', surah: s };
    }
    return { kind: 'surah', surah: null };
  }
  if (str.includes('audio.qurancdn.com/wbw') || str.includes('/wbw/')) {
    const m = str.match(/\/(\d{3})_(\d{3})_(\d{3})\.mp3/);
    if (m) {
      const s = parseInt(m[1], 10);
      if (s >= 1 && s <= 114) return { kind: 'word', surah: s };
    }
    return { kind: 'word', surah: null };
  }
  return { kind: 'other', surah: null };
}

export function summarizeAudioCacheKeys(urls: string[]): AudioCacheKeySummary {
  const ayahCounts: Record<number, number> = {};
  const wordCounts: Record<number, number> = {};
  const surahUrls: string[] = [];
  const wordUrls: string[] = [];
  const otherUrls: string[] = [];

  for (const url of urls || []) {
    const classified = classifyAudioCacheUrl(url);
    if (classified.kind === 'surah') {
      surahUrls.push(url);
      if (classified.surah !== null) {
        ayahCounts[classified.surah] = 1;
      }
    } else if (classified.kind === 'word') {
      wordUrls.push(url);
      if (classified.surah !== null) {
        wordCounts[classified.surah] = (wordCounts[classified.surah] || 0) + 1;
      }
    } else {
      otherUrls.push(url);
    }
  }

  return { ayahCounts, wordCounts, surahUrls, wordUrls, otherUrls };
}

export function selectSampleIndices(totalCount: number, maxSamples: number): number[] {
  const n = Math.max(0, Math.floor(Number(totalCount) || 0));
  const cap = Math.max(1, Math.floor(Number(maxSamples) || 1));
  if (n === 0) return [];
  if (n <= cap) {
    return Array.from({ length: n }, (_, i) => i);
  }
  const indices: number[] = [];
  const step = (n - 1) / (cap - 1);
  const seen = new Set<number>();
  for (let i = 0; i < cap; i++) {
    const idx = Math.min(n - 1, Math.round(i * step));
    if (!seen.has(idx)) {
      seen.add(idx);
      indices.push(idx);
    }
  }
  return indices;
}

export function estimateBucketBytesFromSample(
  totalCount: number,
  sampleSizes: number[],
  fallbackBytesPerItem: number = 16 * 1024,
): number {
  const count = Math.max(0, Math.floor(Number(totalCount) || 0));
  if (count === 0) return 0;

  const valid = (sampleSizes || []).filter((s) => Number.isFinite(s) && s > 0);
  if (valid.length === 0) {
    return Math.round(count * Math.max(1, fallbackBytesPerItem));
  }

  const sum = valid.reduce((acc, v) => acc + v, 0);
  const avg = sum / valid.length;
  return Math.round(avg * count);
}
