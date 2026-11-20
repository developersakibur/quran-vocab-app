/**
 * Pure Service Worker request routing classifier used to verify offline PWA launch
 * and safe cache strategy selection without intercepting non-GET or third-party APIs.
 */

export type SwRouteStrategy =
  | 'bypass'
  | 'sound-cache-first'
  | 'audio-cache-first'
  | 'surah-data-cache-first'
  | 'navigate-offline-first'
  | 'shell-swr';

export interface SwRequestInfo {
  method: string;
  url: string;
  mode?: string;
  origin: string;
}

export function isAudioCdnUrl(url: string): boolean {
  return (
    url.includes('audio.qurancdn.com') ||
    url.includes('audio-cdn.tarteel.ai') ||
    /\.mp3(\?.*)?$/i.test(url)
  );
}

export function isSoundEffectUrl(url: string): boolean {
  return url.includes('/assets/sounds/');
}

export function isSurahDataUrl(url: string): boolean {
  return (
    url.includes('/data/surah-content/') ||
    url.includes('/data/segments/') ||
    url.includes('/data/word-summaries/') ||
    url.includes('/data/lookup/')
  );
}

export function classifySwRequest(req: SwRequestInfo): SwRouteStrategy {
  if (!req || req.method.toUpperCase() !== 'GET') {
    return 'bypass';
  }

  let parsed: URL;
  try {
    parsed = new URL(req.url);
  } catch {
    return 'bypass';
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'bypass';
  }

  if (isSoundEffectUrl(parsed.href)) {
    return 'sound-cache-first';
  }

  if (isAudioCdnUrl(parsed.href)) {
    return 'audio-cache-first';
  }

  // Never intercept cross-origin non-audio APIs (e.g., Supabase auth/sync)
  if (parsed.origin !== req.origin) {
    return 'bypass';
  }

  if (req.mode === 'navigate') {
    return 'navigate-offline-first';
  }

  if (isSurahDataUrl(parsed.href)) {
    return 'surah-data-cache-first';
  }

  return 'shell-swr';
}

/**
 * Resolves the fallback app shell document for offline navigation requests.
 */
export function resolveNavigationFallbackPath(pathname: string): string {
  const lower = (pathname || '').toLowerCase();
  if (lower.endsWith('/quiz.html')) return './quiz.html';
  if (lower.endsWith('/sets.html')) return './sets.html';
  return './index.html';
}
