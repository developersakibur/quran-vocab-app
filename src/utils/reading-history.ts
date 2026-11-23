export interface ReadingHistoryEntry {
  id: string;
  activity_date: string; // YYYY-MM-DD (local)
  surah: number; // 1..114
  read_word_keys: string[];
  listen_word_keys: string[];
  read_count: number;
  listen_count: number;
  surah_listen_count: number;
  read_seconds: number;
  listen_seconds: number;
  total_seconds: number;
  last_ayah: number;
  updated_at: number;
}

export type ActivityFilter = 'all' | 'read' | 'listen';
export type RangeFilter = '7d' | '30d' | 'all';

export interface StudyTimeTickInput {
  isReadingActive: boolean;
  isAudioPlaying: boolean;
  deltaSec: number;
  ayah?: number;
  nowMs?: number;
}

export interface HistorySummary {
  todaySeconds: number;
  totalSeconds: number;
  todayReadWords: number;
  todayListenCount: number;
  todaySurahListens: number;
  totalReadWords: number;
  totalListenCount: number;
  activeDaysCount: number;
}

export interface HistoryDateGroup {
  activity_date: string;
  headingBn: string;
  dayTotalSeconds: number;
  dayReadWords: number;
  dayListenCount: number;
  daySurahListens: number;
  items: ReadingHistoryEntry[];
}

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const BN_MONTHS = [
  'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল',
  'মে', 'জুন', 'জুলাই', 'আগস্ট',
  'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর',
];

export function toBnDigits(value: number | string): string {
  return String(value).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

export function getLocalDateKey(ts: number = Date.now()): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function makeHistoryId(activityDate: string, surah: number): string {
  return `${activityDate}|${Math.max(1, Math.min(114, Math.floor(surah)))}`;
}

export function parseLocalDateKey(dateKey: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(year, month - 1, day);
}

export function diffDaysBetweenKeys(laterKey: string, earlierKey: string): number {
  const a = parseLocalDateKey(laterKey);
  const b = parseLocalDateKey(earlierKey);
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcA - utcB) / 86_400_000);
}

export function formatDurationBn(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  if (sec === 0) return '০ মিনিট';
  if (sec < 60) return `${toBnDigits(sec)} সেকেন্ড`;
  if (sec < 3600) {
    const mins = Math.floor(sec / 60);
    return `${toBnDigits(mins)} মিনিট`;
  }
  const hours = Math.floor(sec / 3600);
  const remMins = Math.floor((sec % 3600) / 60);
  if (remMins === 0) return `${toBnDigits(hours)} ঘণ্টা`;
  return `${toBnDigits(hours)} ঘণ্টা ${toBnDigits(remMins)} মি.`;
}

export function formatCompactDurationBn(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  if (sec === 0) return '০ মি.';
  if (sec < 60) return `${toBnDigits(sec)} সে.`;
  if (sec < 3600) return `${toBnDigits(Math.floor(sec / 60))} মি.`;
  const hours = Math.floor(sec / 3600);
  const remMins = Math.floor((sec % 3600) / 60);
  if (remMins === 0) return `${toBnDigits(hours)} ঘণ্টা`;
  return `${toBnDigits(hours)} ঘ. ${toBnDigits(remMins)} মি.`;
}

export function formatHistoryDateHeadingBn(dateKey: string, todayKey: string): string {
  const dt = parseLocalDateKey(dateKey);
  const today = parseLocalDateKey(todayKey);
  if (!dt) return dateKey;

  const dayStr = toBnDigits(dt.getDate());
  const monthStr = BN_MONTHS[dt.getMonth()] || '';
  const baseLabel = `${dayStr} ${monthStr}`;

  if (today) {
    const delta = diffDaysBetweenKeys(todayKey, dateKey);
    if (delta === 0) return `আজ — ${baseLabel}`;
    if (delta === 1) return `গতকাল — ${baseLabel}`;
    if (dt.getFullYear() !== today.getFullYear()) {
      return `${baseLabel}, ${toBnDigits(dt.getFullYear())}`;
    }
  }
  return baseLabel;
}

export function createEmptyHistoryEntry(
  activityDate: string,
  surah: number,
  nowMs: number = Date.now(),
): ReadingHistoryEntry {
  const safeSurah = Math.max(1, Math.min(114, Math.floor(Number(surah) || 1)));
  return {
    id: makeHistoryId(activityDate, safeSurah),
    activity_date: activityDate,
    surah: safeSurah,
    read_word_keys: [],
    listen_word_keys: [],
    read_count: 0,
    listen_count: 0,
    surah_listen_count: 0,
    read_seconds: 0,
    listen_seconds: 0,
    total_seconds: 0,
    last_ayah: 1,
    updated_at: nowMs,
  };
}

function uniqueStringArray(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of arr) {
    const s = String(item || '').trim();
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

export function normalizeHistoryEntry(raw: Partial<ReadingHistoryEntry>): ReadingHistoryEntry {
  const activityDate = String(raw.activity_date || getLocalDateKey());
  const surah = Math.max(1, Math.min(114, Math.floor(Number(raw.surah) || 1)));
  const readWordKeys = uniqueStringArray(raw.read_word_keys);
  const listenWordKeys = uniqueStringArray(raw.listen_word_keys);
  const readCount = Math.max(readWordKeys.length, Math.floor(Number(raw.read_count) || 0));
  const listenCount = Math.max(listenWordKeys.length, Math.floor(Number(raw.listen_count) || 0));
  const surahListenCount = Math.max(0, Math.floor(Number(raw.surah_listen_count) || 0));
  const readSeconds = Math.max(0, Math.floor(Number(raw.read_seconds) || 0));
  const listenSeconds = Math.max(0, Math.floor(Number(raw.listen_seconds) || 0));
  const totalSeconds = Math.max(
    Math.floor(Number(raw.total_seconds) || 0),
    readSeconds,
    listenSeconds,
  );
  const lastAyah = Math.max(1, Math.floor(Number(raw.last_ayah) || 1));
  const updatedAt = Math.max(0, Math.floor(Number(raw.updated_at) || 0));

  return {
    id: makeHistoryId(activityDate, surah),
    activity_date: activityDate,
    surah,
    read_word_keys: readWordKeys,
    listen_word_keys: listenWordKeys,
    read_count: readCount,
    listen_count: listenCount,
    surah_listen_count: surahListenCount,
    read_seconds: readSeconds,
    listen_seconds: listenSeconds,
    total_seconds: totalSeconds,
    last_ayah: lastAyah,
    updated_at: updatedAt,
  };
}

export function applyWordRead(
  entry: ReadingHistoryEntry,
  wordKey: string,
  ayah: number,
  nowMs: number = Date.now(),
): ReadingHistoryEntry {
  const key = String(wordKey || '').trim();
  const base = normalizeHistoryEntry(entry);
  if (!key) return base;

  const hasKey = base.read_word_keys.includes(key);
  const nextKeys = hasKey ? base.read_word_keys : [...base.read_word_keys, key];

  return {
    ...base,
    read_word_keys: nextKeys,
    read_count: Math.max(base.read_count, nextKeys.length),
    last_ayah: ayah >= 1 ? Math.floor(ayah) : base.last_ayah,
    updated_at: Math.max(base.updated_at, nowMs),
  };
}

export function applyWordListen(
  entry: ReadingHistoryEntry,
  wordKey: string,
  ayah: number,
  durationSec: number = 0,
  nowMs: number = Date.now(),
): ReadingHistoryEntry {
  const key = String(wordKey || '').trim();
  const base = normalizeHistoryEntry(entry);
  if (!key) return base;

  const hasKey = base.listen_word_keys.includes(key);
  const nextKeys = hasKey ? base.listen_word_keys : [...base.listen_word_keys, key];
  const addedSec = Math.max(0, Math.min(30, Math.round(Number(durationSec) || 0)));

  return {
    ...base,
    listen_word_keys: nextKeys,
    listen_count: Math.max(base.listen_count + 1, nextKeys.length),
    listen_seconds: base.listen_seconds + addedSec,
    total_seconds: base.total_seconds + addedSec,
    last_ayah: ayah >= 1 ? Math.floor(ayah) : base.last_ayah,
    updated_at: Math.max(base.updated_at, nowMs),
  };
}

export function applyAyahListen(
  entry: ReadingHistoryEntry,
  ayah: number,
  durationSec: number = 0,
  nowMs: number = Date.now(),
): ReadingHistoryEntry {
  const base = normalizeHistoryEntry(entry);
  const addedSec = Math.max(0, Math.min(180, Math.round(Number(durationSec) || 0)));

  return {
    ...base,
    listen_count: base.listen_count + 1,
    listen_seconds: base.listen_seconds + addedSec,
    total_seconds: base.total_seconds + addedSec,
    last_ayah: ayah >= 1 ? Math.floor(ayah) : base.last_ayah,
    updated_at: Math.max(base.updated_at, nowMs),
  };
}

export function applySurahListenStart(
  entry: ReadingHistoryEntry,
  ayah: number = 1,
  nowMs: number = Date.now(),
): ReadingHistoryEntry {
  const base = normalizeHistoryEntry(entry);
  return {
    ...base,
    surah_listen_count: base.surah_listen_count + 1,
    last_ayah: ayah >= 1 ? Math.floor(ayah) : base.last_ayah,
    updated_at: Math.max(base.updated_at, nowMs),
  };
}

export function applyStudyTimeTick(
  entry: ReadingHistoryEntry,
  input: StudyTimeTickInput,
): ReadingHistoryEntry {
  const base = normalizeHistoryEntry(entry);
  const sec = Math.max(0, Math.min(15, Math.round(Number(input.deltaSec) || 0)));
  if (sec <= 0) return base;
  if (!input.isAudioPlaying && !input.isReadingActive) return base;

  const nowMs = typeof input.nowMs === 'number' ? input.nowMs : Date.now();
  const nextAyah = input.ayah && input.ayah >= 1 ? Math.floor(input.ayah) : base.last_ayah;

  // Non-overlapping time accounting:
  // If audio is playing, credit listen_seconds and total_seconds once (even if user is also reading).
  if (input.isAudioPlaying) {
    return {
      ...base,
      listen_seconds: base.listen_seconds + sec,
      total_seconds: base.total_seconds + sec,
      last_ayah: nextAyah,
      updated_at: Math.max(base.updated_at, nowMs),
    };
  }

  return {
    ...base,
    read_seconds: base.read_seconds + sec,
    total_seconds: base.total_seconds + sec,
    last_ayah: nextAyah,
    updated_at: Math.max(base.updated_at, nowMs),
  };
}

export function clampRecitationDeltaSec(
  prevTimeSec: number | null,
  nextTimeSec: number,
): number {
  if (prevTimeSec === null || !Number.isFinite(prevTimeSec) || !Number.isFinite(nextTimeSec)) {
    return 0;
  }
  const delta = nextTimeSec - prevTimeSec;
  if (delta > 0 && delta <= 3.5) {
    return delta;
  }
  return 0;
}

export function isUserActiveForReading(params: {
  isVisible: boolean;
  lastInteractionTs: number;
  nowMs: number;
  idleThresholdMs?: number;
}): boolean {
  const threshold = params.idleThresholdMs ?? 60_000;
  if (!params.isVisible) return false;
  const elapsed = params.nowMs - params.lastInteractionTs;
  return elapsed >= 0 && elapsed <= threshold;
}

export function mergeHistoryEntries(
  localRaw: Partial<ReadingHistoryEntry> | null | undefined,
  cloudRaw: Partial<ReadingHistoryEntry> | null | undefined,
): ReadingHistoryEntry {
  if (!localRaw && !cloudRaw) {
    return createEmptyHistoryEntry(getLocalDateKey(), 1);
  }
  if (!localRaw) return normalizeHistoryEntry(cloudRaw!);
  if (!cloudRaw) return normalizeHistoryEntry(localRaw);

  const local = normalizeHistoryEntry(localRaw);
  const cloud = normalizeHistoryEntry(cloudRaw);

  const readKeys = uniqueStringArray([...local.read_word_keys, ...cloud.read_word_keys]);
  const listenKeys = uniqueStringArray([...local.listen_word_keys, ...cloud.listen_word_keys]);

  const readSeconds = Math.max(local.read_seconds, cloud.read_seconds);
  const listenSeconds = Math.max(local.listen_seconds, cloud.listen_seconds);
  const totalSeconds = Math.max(
    local.total_seconds,
    cloud.total_seconds,
    readSeconds,
    listenSeconds,
  );

  const cloudIsNewer = cloud.updated_at > local.updated_at;

  return {
    id: local.id,
    activity_date: local.activity_date,
    surah: local.surah,
    read_word_keys: readKeys,
    listen_word_keys: listenKeys,
    read_count: Math.max(local.read_count, cloud.read_count, readKeys.length),
    listen_count: Math.max(local.listen_count, cloud.listen_count, listenKeys.length),
    surah_listen_count: Math.max(local.surah_listen_count, cloud.surah_listen_count),
    read_seconds: readSeconds,
    listen_seconds: listenSeconds,
    total_seconds: totalSeconds,
    last_ayah: cloudIsNewer ? cloud.last_ayah : local.last_ayah,
    updated_at: Math.max(local.updated_at, cloud.updated_at),
  };
}

export function summarizeHistoryTotals(
  entries: ReadingHistoryEntry[],
  todayKey: string = getLocalDateKey(),
): HistorySummary {
  let todaySeconds = 0;
  let totalSeconds = 0;
  let todayReadWords = 0;
  let todayListenCount = 0;
  let todaySurahListens = 0;
  let totalReadWords = 0;
  let totalListenCount = 0;
  const activeDates = new Set<string>();

  for (const raw of entries || []) {
    const e = normalizeHistoryEntry(raw);
    const hasActivity =
      e.total_seconds > 0 ||
      e.read_count > 0 ||
      e.listen_count > 0 ||
      e.surah_listen_count > 0;
    if (!hasActivity) continue;

    activeDates.add(e.activity_date);
    totalSeconds += e.total_seconds;
    totalReadWords += e.read_count;
    totalListenCount += e.listen_count + e.surah_listen_count;

    if (e.activity_date === todayKey) {
      todaySeconds += e.total_seconds;
      todayReadWords += e.read_count;
      todayListenCount += e.listen_count + e.surah_listen_count;
      todaySurahListens += e.surah_listen_count;
    }
  }

  return {
    todaySeconds,
    totalSeconds,
    todayReadWords,
    todayListenCount,
    todaySurahListens,
    totalReadWords,
    totalListenCount,
    activeDaysCount: activeDates.size,
  };
}

export function groupHistoryByDateAndSurah(
  entries: ReadingHistoryEntry[],
  options: {
    activityFilter?: ActivityFilter;
    rangeFilter?: RangeFilter;
    todayKey?: string;
  } = {},
): HistoryDateGroup[] {
  const activityFilter: ActivityFilter = options.activityFilter || 'all';
  const rangeFilter: RangeFilter = options.rangeFilter || '30d';
  const todayKey = options.todayKey || getLocalDateKey();

  const maxAgeDays =
    rangeFilter === '7d' ? 6 : rangeFilter === '30d' ? 29 : Number.POSITIVE_INFINITY;

  const grouped = new Map<string, ReadingHistoryEntry[]>();

  for (const raw of entries || []) {
    const e = normalizeHistoryEntry(raw);

    const hasRead = e.read_count > 0 || e.read_word_keys.length > 0 || e.read_seconds > 0;
    const hasListen =
      e.listen_count > 0 ||
      e.listen_word_keys.length > 0 ||
      e.surah_listen_count > 0 ||
      e.listen_seconds > 0;
    const hasAny = hasRead || hasListen || e.total_seconds > 0;

    if (!hasAny) continue;
    if (activityFilter === 'read' && !hasRead) continue;
    if (activityFilter === 'listen' && !hasListen) continue;

    if (Number.isFinite(maxAgeDays)) {
      const age = diffDaysBetweenKeys(todayKey, e.activity_date);
      if (age < 0 || age > maxAgeDays) continue;
    }

    const list = grouped.get(e.activity_date) || [];
    list.push(e);
    grouped.set(e.activity_date, list);
  }

  const sortedDates = Array.from(grouped.keys()).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

  return sortedDates.map((dateKey) => {
    const items = (grouped.get(dateKey) || []).sort((a, b) => {
      if (b.updated_at !== a.updated_at) return b.updated_at - a.updated_at;
      return a.surah - b.surah;
    });

    let dayTotalSeconds = 0;
    let dayReadWords = 0;
    let dayListenCount = 0;
    let daySurahListens = 0;

    for (const item of items) {
      if (activityFilter === 'read') {
        dayTotalSeconds += item.read_seconds;
      } else if (activityFilter === 'listen') {
        dayTotalSeconds += item.listen_seconds;
      } else {
        dayTotalSeconds += item.total_seconds;
      }
      dayReadWords += item.read_count;
      dayListenCount += item.listen_count;
      daySurahListens += item.surah_listen_count;
    }

    return {
      activity_date: dateKey,
      headingBn: formatHistoryDateHeadingBn(dateKey, todayKey),
      dayTotalSeconds,
      dayReadWords,
      dayListenCount,
      daySurahListens,
      items,
    };
  });
}

export interface HistoryPaginationResult {
  visibleGroups: HistoryDateGroup[];
  totalItems: number;
  shownItems: number;
  remainingItems: number;
  hasMore: boolean;
}

/**
 * Paginate date-grouped reading history so only the latest `limit` items
 * (default 10) are rendered initially, preserving date group boundaries.
 */
export function paginateHistoryGroups(
  groups: HistoryDateGroup[],
  limit: number = 10,
): HistoryPaginationResult {
  const safeGroups = Array.isArray(groups) ? groups : [];
  const safeLimit = Math.max(1, Math.floor(Number(limit) || 10));

  let totalItems = 0;
  for (const g of safeGroups) {
    totalItems += Array.isArray(g.items) ? g.items.length : 0;
  }

  const visibleGroups: HistoryDateGroup[] = [];
  let shownItems = 0;

  for (const g of safeGroups) {
    if (shownItems >= safeLimit) break;
    const items = Array.isArray(g.items) ? g.items : [];
    if (items.length === 0) continue;

    const remainingSlot = safeLimit - shownItems;
    const sliced = items.slice(0, remainingSlot);
    if (sliced.length > 0) {
      visibleGroups.push({
        ...g,
        items: sliced,
      });
      shownItems += sliced.length;
    }
  }

  const remainingItems = Math.max(0, totalItems - shownItems);
  return {
    visibleGroups,
    totalItems,
    shownItems,
    remainingItems,
    hasMore: remainingItems > 0,
  };
}
