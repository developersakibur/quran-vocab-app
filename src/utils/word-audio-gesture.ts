/**
 * Word Audio & Gesture Helper Module
 * Provides pure utilities for URL formatting, gesture recognition, and memory caching.
 */

export const DEFAULT_WORD_AUDIO_BASE = 'https://audio.qurancdn.com/wbw';
export const DEFAULT_AYAH_AUDIO_BASE = 'https://everyayah.com/data/Alafasy_128kbps';
export const DEFAULT_HOLD_THRESHOLD_MS = 380;
export const DEFAULT_MOVE_THRESHOLD_PX = 10;

/**
 * Builds the CDN URL for a single word's pronunciation audio.
 * @param wordKey e.g. "1:1:1" or "2:255:3"
 * @param baseUrl optional base URL
 */
export function buildWordAudioUrl(wordKey: string, baseUrl = DEFAULT_WORD_AUDIO_BASE): string {
  if (!wordKey || typeof wordKey !== 'string') return '';
  const parts = wordKey.split(':');
  if (parts.length < 3) return '';

  const s = String(parseInt(parts[0], 10) || 0).padStart(3, '0');
  const a = String(parseInt(parts[1], 10) || 0).padStart(3, '0');
  const w = String(parseInt(parts[2], 10) || 0).padStart(3, '0');

  const cleanBase = baseUrl.replace(/\/+$/, '');
  return `${cleanBase}/${s}_${a}_${w}.mp3`;
}

/**
 * Builds the CDN URL for an entire ayah's audio.
 * @param surah e.g. 1
 * @param ayah e.g. 1
 * @param baseUrl optional base URL
 */
export function buildAyahAudioUrl(surah: number | string, ayah: number | string, baseUrl = DEFAULT_AYAH_AUDIO_BASE): string {
  const s = String(parseInt(String(surah), 10) || 0).padStart(3, '0');
  const a = String(parseInt(String(ayah), 10) || 0).padStart(3, '0');
  const cleanBase = baseUrl.replace(/\/+$/, '');
  return `${cleanBase}/${s}${a}.mp3`;
}

/**
 * State machine for press-and-hold gestures on words
 */
export interface GestureState {
  startX: number;
  startY: number;
  startTime: number;
  isHolding: boolean;
  didTriggerLongPress: boolean;
}

export class WordGestureController {
  private holdThresholdMs: number;
  private moveThresholdPx: number;

  constructor(options?: { holdThresholdMs?: number; moveThresholdPx?: number }) {
    this.holdThresholdMs = options?.holdThresholdMs ?? DEFAULT_HOLD_THRESHOLD_MS;
    this.moveThresholdPx = options?.moveThresholdPx ?? DEFAULT_MOVE_THRESHOLD_PX;
  }

  public initGesture(x: number, y: number, now = Date.now()): GestureState {
    return {
      startX: x,
      startY: y,
      startTime: now,
      isHolding: true,
      didTriggerLongPress: false
    };
  }

  public shouldCancelOnMove(state: GestureState, curX: number, curY: number): boolean {
    if (!state.isHolding) return false;
    const dx = Math.abs(curX - state.startX);
    const dy = Math.abs(curY - state.startY);
    return dx > this.moveThresholdPx || dy > this.moveThresholdPx;
  }

  public isLongPressThresholdMet(state: GestureState, now = Date.now()): boolean {
    if (!state.isHolding) return false;
    return (now - state.startTime) >= this.holdThresholdMs;
  }
}

/**
 * In-memory deduplicating cache for Surah data
 */
export class SurahMemoryCache<T = unknown> {
  private cache = new Map<number, T>();
  private inFlight = new Map<number, Promise<T>>();

  public has(surahNum: number): boolean {
    return this.cache.has(surahNum);
  }

  public get(surahNum: number): T | undefined {
    return this.cache.get(surahNum);
  }

  public set(surahNum: number, data: T): void {
    this.cache.set(surahNum, data);
  }

  public clear(): void {
    this.cache.clear();
    this.inFlight.clear();
  }

  public async getOrFetch(surahNum: number, fetcher: (num: number) => Promise<T>): Promise<T> {
    if (this.cache.has(surahNum)) {
      return this.cache.get(surahNum)!;
    }

    if (this.inFlight.has(surahNum)) {
      return this.inFlight.get(surahNum)!;
    }

    const promise = (async () => {
      try {
        const result = await fetcher(surahNum);
        this.cache.set(surahNum, result);
        return result;
      } finally {
        this.inFlight.delete(surahNum);
      }
    })();

    this.inFlight.set(surahNum, promise);
    return promise;
  }
}
