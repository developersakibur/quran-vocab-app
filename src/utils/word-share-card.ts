/* ============================================================
   WORD SHARE CARD CORE (Pure TypeScript Utilities)
   Deterministic calculations, deep-link parsing/formatting,
   curiosity-hook Bengali caption builder, and template registry
   for per-word social sharing.
   ============================================================ */

export const PRODUCTION_APP_BASE_URL = 'https://developersakibur.github.io/quran-vocab-app/';
export const TOTAL_QURAN_WORDS = 77433;
export const SHARE_TEMPLATE_STORAGE_KEY = 'quran-word-share-template-v1';

export type ShareTemplateId = 'emerald' | 'cream' | 'midnight';

export interface ShareCardTemplateMeta {
  id: ShareTemplateId;
  labelBn: string;
  shortLabelBn: string;
  swatchBg: string;
  swatchBorder: string;
  swatchAccent: string;
}

export const SHARE_CARD_TEMPLATES: readonly ShareCardTemplateMeta[] = [
  {
    id: 'emerald',
    labelBn: 'এমেরাল্ড ও গোল্ড',
    shortLabelBn: 'এমেরাল্ড',
    swatchBg: 'linear-gradient(135deg, #0F5A3B 0%, #062418 100%)',
    swatchBorder: '#D9B45A',
    swatchAccent: '#F5CF6B',
  },
  {
    id: 'cream',
    labelBn: 'ক্রিম ও সবুজ',
    shortLabelBn: 'ক্রিম',
    swatchBg: 'linear-gradient(135deg, #FCF9F2 0%, #EFE6D5 100%)',
    swatchBorder: '#0D5C3A',
    swatchAccent: '#0D5C3A',
  },
  {
    id: 'midnight',
    labelBn: 'মিডনাইট গোল্ড',
    shortLabelBn: 'মিডনাইট',
    swatchBg: 'linear-gradient(135deg, #172531 0%, #0A1117 100%)',
    swatchBorder: '#E2C174',
    swatchAccent: '#F2CF78',
  },
] as const;

export interface WordSharePayload {
  wordKey: string;
  arabic: string;
  surah: number;
  ayah: number;
  position: number;
  surahNameBn: string;
  occurrences: number;
  totalQuranWords?: number;
}

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

/**
 * Convert ASCII digits in a number or string into Bengali digits.
 */
export function toBnDigits(value: number | string): string {
  return String(value).replace(/\d/g, (d) => BN_DIGITS[Number(d)] ?? d);
}

/**
 * Format an integer count with standard grouping in Bengali digits.
 */
export function formatCountBn(count: number): string {
  const safe = Number.isFinite(count) ? Math.max(1, Math.round(count)) : 1;
  return toBnDigits(safe.toLocaleString('en-US'));
}

/**
 * Validate a Quran word key in strict "S:A:P" format (Surah 1..114, Ayah >= 1, Pos >= 1).
 */
export function isValidWordKey(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const trimmed = raw.trim();
  const match = /^(\d{1,3}):(\d{1,3}):(\d{1,3})$/.exec(trimmed);
  if (!match) return false;
  const surah = Number(match[1]);
  const ayah = Number(match[2]);
  const pos = Number(match[3]);
  return surah >= 1 && surah <= 114 && ayah >= 1 && ayah <= 286 && pos >= 1 && pos <= 200;
}

/**
 * Parse a word deep-link key from window.location.search and window.location.hash.
 * Supports:
 *   - ?word=1:1:2
 *   - ?word=1:1:2&fbclid=IwAR...
 *   - #word=1:1:2
 * Hash `#word=` takes precedence if explicitly present; otherwise `?word=` is used
 * only when no other hash route is active.
 */
export function parseWordKeyFromLocation(search: string, hash: string): {
  wordKey: string | null;
  source: 'hash' | 'query' | null;
} {
  const cleanHash = (hash || '').trim();
  if (cleanHash.startsWith('#word=')) {
    const rawHashVal = decodeURIComponent(cleanHash.slice('#word='.length).split('&')[0] || '').trim();
    if (isValidWordKey(rawHashVal)) {
      return { wordKey: rawHashVal, source: 'hash' };
    }
  }

  // Only inspect ?word= when there is no explicit non-empty hash route (e.g. #surah=2, #bookmarks)
  if (!cleanHash || cleanHash === '#') {
    const cleanSearch = (search || '').trim();
    if (cleanSearch) {
      const params = new URLSearchParams(cleanSearch.startsWith('?') ? cleanSearch.slice(1) : cleanSearch);
      const rawQueryVal = (params.get('word') || '').trim();
      if (isValidWordKey(rawQueryVal)) {
        return { wordKey: rawQueryVal, source: 'query' };
      }
    }
  }

  return { wordKey: null, source: null };
}

/**
 * Build canonical production deep-link URL for a specific word.
 * Uses `?word=S:A:P` so GitHub Pages serves index.html cleanly and Facebook/WhatsApp
 * query parameters (like `fbclid`) never corrupt the word key.
 */
export function buildWordShareUrl(wordKey: string, baseUrl: string = PRODUCTION_APP_BASE_URL): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const cleanKey = String(wordKey || '').trim();
  if (!isValidWordKey(cleanKey)) {
    return normalizedBase;
  }
  return `${normalizedBase}?word=${cleanKey}`;
}

/**
 * Compute percentage of total Quranic words covered by knowing this exact word.
 */
export function computeWordCoveragePercent(
  occurrences: number,
  totalQuranWords: number = TOTAL_QURAN_WORDS
): number {
  const safeCount = Number.isFinite(occurrences) && occurrences > 0 ? occurrences : 1;
  const safeTotal = Number.isFinite(totalQuranWords) && totalQuranWords > 0 ? totalQuranWords : TOTAL_QURAN_WORDS;
  const pct = (safeCount / safeTotal) * 100;
  return Math.min(100, Math.max(0, pct));
}

/**
 * Format coverage percentage in Bengali digits with adaptive precision
 * so rare words never collapse to "০%".
 *   - >= 0.01% -> 2 decimal places (e.g. ৩.৪৯, ০.০৭)
 *   - < 0.01%  -> 3 decimal places (e.g. ০.০০১, ০.০০৪)
 */
export function formatCoveragePercentBn(percent: number): string {
  const safe = Number.isFinite(percent) && percent > 0 ? percent : 0.001;
  const formatted = safe >= 0.01 ? safe.toFixed(2) : Math.max(0.001, safe).toFixed(3);
  return toBnDigits(formatted);
}

/**
 * Build the curiosity-hook Bengali caption + deep-link (deliberately omits Bengali meaning).
 */
export function buildWordShareCaption(
  payload: WordSharePayload,
  baseUrl: string = PRODUCTION_APP_BASE_URL
): string {
  const countBn = formatCountBn(payload.occurrences);
  const pct = computeWordCoveragePercent(payload.occurrences, payload.totalQuranWords);
  const pctBn = formatCoveragePercentBn(pct);
  const shareUrl = buildWordShareUrl(payload.wordKey, baseUrl);

  return [
    'আপনি কি এই শব্দের অর্থ জানেন?',
    '',
    `পবিত্র কুরআনে এই শব্দটি ${countBn} বার এসেছে।`,
    `এই শব্দটির অর্থ জানলে কুরআনের ${pctBn}% বাংলা অর্থ আপনি জানবেন।`,
    '',
    'অর্থ জানতে লিংকে ক্লিক করুন:',
    shareUrl,
  ].join('\n');
}

/**
 * Build a safe download/share PNG filename for a word key.
 */
export function buildWordShareFilename(wordKey: string): string {
  const safeKey = isValidWordKey(wordKey) ? wordKey.replace(/:/g, '-') : 'word';
  return `quran-word-${safeKey}.png`;
}

/**
 * Resolve and validate a template ID, falling back to 'emerald'.
 */
export function resolveShareTemplateId(raw: unknown): ShareTemplateId {
  if (raw === 'emerald' || raw === 'cream' || raw === 'midnight') {
    return raw;
  }
  return 'emerald';
}
