/**
 * Pure data transformation and calculation module for Progress Chart
 * Processes Supabase storage data, local progress-v1 records, and daily activity.
 */

export interface ProgressRecord {
  word_id?: string;
  wordId?: string;
  last_reviewed?: number | string | null;
  lastReviewed?: number | string | null;
  status?: string;
  repetitions?: number;
  box?: number;
  updated_at?: string;
}

export interface ActivityRecord {
  date: string; // 'YYYY-MM-DD'
  wordsLearnedCount?: number;
  reviewsCount?: number;
  lastActiveAt?: number;
}

export interface DailyFrequencyPoint {
  date: string; // 'YYYY-MM-DD'
  dayLabel: string; // short label e.g. '12 Nov' or '১২ নভে'
  count: number;
  reviewsCount: number;
  cumulativeCount: number;
}

export interface ProgressChartSummary {
  points: DailyFrequencyPoint[];
  totalWordsLearned: number;
  totalReviews: number;
  dailyAverage: number;
  activeDaysCount: number;
  peakDay: { date: string; count: number; dayLabel: string } | null;
  streakDays: number;
}

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const BN_MONTHS = ['জানু', 'ফেব্রু', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টে', 'অক্টো', 'নভে', 'ডিসে'];

export function toBnDigits(num: number | string): string {
  return String(num).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)] ?? d);
}

/**
 * Format a 'YYYY-MM-DD' string to Bengali label e.g. '১২ নভে'
 */
export function formatBnDateLabel(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length < 3) return dateStr;
  const day = parseInt(parts[2], 10);
  const monthIdx = parseInt(parts[1], 10) - 1;
  const monthName = BN_MONTHS[monthIdx] || parts[1];
  return `${toBnDigits(day)} ${monthName}`;
}

/**
 * Normalizes any timestamp or ISO string into 'YYYY-MM-DD'
 */
export function normalizeDateToYMD(val: number | string | Date | null | undefined): string | null {
  if (!val) return null;
  try {
    const d = typeof val === 'number' ? new Date(val) : new Date(String(val));
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

/**
 * Aggregates word learning records over the last N days (default 30).
 */
export function aggregateWordLearningFrequency(
  progressData: Record<string, ProgressRecord> | ProgressRecord[] | null | undefined,
  activityData: ActivityRecord[] | null | undefined,
  options: {
    days?: number;
    referenceDate?: Date | string;
    includeDemoIfEmpty?: boolean;
  } = {}
): ProgressChartSummary {
  const days = options.days && options.days > 0 ? options.days : 30;
  const refDate = options.referenceDate ? new Date(options.referenceDate) : new Date();

  // Create an ordered date lookup for the last N days
  const dateMap = new Map<string, { count: number; reviews: number }>();
  const dateKeys: string[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(refDate);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    dateKeys.push(key);
    dateMap.set(key, { count: 0, reviews: 0 });
  }

  // 1. Ingest activityData if provided
  if (Array.isArray(activityData)) {
    for (const act of activityData) {
      if (!act || !act.date) continue;
      if (dateMap.has(act.date)) {
        const item = dateMap.get(act.date)!;
        item.count += act.wordsLearnedCount || 0;
        item.reviews += act.reviewsCount || 0;
      }
    }
  }

  // 2. Ingest progressData (from Supabase or StorageManager 'progress-v1')
  // Each record represents a word. We check last_reviewed or lastReviewed or updated_at.
  const progressList: ProgressRecord[] = [];
  if (Array.isArray(progressData)) {
    progressList.push(...progressData);
  } else if (progressData && typeof progressData === 'object') {
    Object.values(progressData).forEach((v) => {
      if (v && typeof v === 'object') progressList.push(v);
    });
  }

  // If activityData didn't populate counts or we want to count unique words per day:
  const wordsCountedPerDay = new Map<string, Set<string>>();
  for (const prog of progressList) {
    const rawDate = prog.last_reviewed ?? prog.lastReviewed ?? prog.updated_at;
    const ymd = normalizeDateToYMD(rawDate);
    if (ymd && dateMap.has(ymd)) {
      const wordId = String(prog.word_id || prog.wordId || 'unknown');
      if (!wordsCountedPerDay.has(ymd)) {
        wordsCountedPerDay.set(ymd, new Set());
      }
      wordsCountedPerDay.get(ymd)!.add(wordId);
    }
  }

  // Merge unique words per day if activityData count was 0
  for (const [ymd, wordsSet] of wordsCountedPerDay.entries()) {
    const item = dateMap.get(ymd);
    if (item) {
      if (item.count === 0) {
        item.count = wordsSet.size;
      } else {
        item.count = Math.max(item.count, wordsSet.size);
      }
    }
  }

  // Build points array
  let cumulative = 0;
  let totalLearned = 0;
  let totalReviews = 0;
  let activeDays = 0;
  let maxCount = -1;
  let peakDay: { date: string; count: number; dayLabel: string } | null = null;

  const points: DailyFrequencyPoint[] = dateKeys.map((dateStr) => {
    const entry = dateMap.get(dateStr) || { count: 0, reviews: 0 };
    const count = entry.count;
    const reviews = entry.reviews || count;

    cumulative += count;
    totalLearned += count;
    totalReviews += reviews;

    if (count > 0) activeDays++;

    const dayLabel = formatBnDateLabel(dateStr);

    if (count > maxCount && count > 0) {
      maxCount = count;
      peakDay = { date: dateStr, count, dayLabel };
    }

    return {
      date: dateStr,
      dayLabel,
      count,
      reviewsCount: reviews,
      cumulativeCount: cumulative,
    };
  });

  const dailyAverage = days > 0 ? Number((totalLearned / days).toFixed(1)) : 0;

  // Calculate streak from the end
  let streak = 0;
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].count > 0 || points[i].reviewsCount > 0) {
      streak++;
    } else {
      // Allow today to still be 0 if yesterday was active
      if (i === points.length - 1) continue;
      break;
    }
  }

  return {
    points,
    totalWordsLearned: totalLearned,
    totalReviews,
    dailyAverage,
    activeDaysCount: activeDays,
    peakDay,
    streakDays: streak,
  };
}

/**
 * Deterministic realistic sample data for 30-day preview
 */
export function generateDemo30DayData(referenceDate?: Date | string): ProgressChartSummary {
  const refDate = referenceDate ? new Date(referenceDate) : new Date();
  const demoCounts = [
    3, 5, 4, 7, 6, 8, 5,
    9, 11, 8, 12, 10, 14, 11,
    13, 16, 12, 15, 18, 14, 17,
    16, 20, 18, 22, 19, 21, 24, 20, 25
  ]; // Progressive realistic learning curve
  const activityList: ActivityRecord[] = [];

  for (let i = 29; i >= 0; i--) {
    const d = new Date(refDate);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const count = demoCounts[29 - i] ?? 5;
    activityList.push({
      date: dateStr,
      wordsLearnedCount: count,
      reviewsCount: count + Math.floor(count * 0.4),
      lastActiveAt: d.getTime(),
    });
  }

  return aggregateWordLearningFrequency(null, activityList, { days: 30, referenceDate: refDate });
}
