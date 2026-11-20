export interface DailyPracticeActivity {
  date: string; // YYYY-MM-DD
  reviewsCount: number;
  wordsLearnedCount: number;
}

export interface CalendarDayCell {
  dateYmd: string;
  dayNumber: number;
  dayNumberBn: string;
  weekdayIndex: number; // 0 (Sun) - 6 (Sat)
  isPracticed: boolean;
  drillsCount: number;
  wordsLearnedCount: number;
  isToday: boolean;
  isFuture: boolean;
}

export interface MonthCalendarGrid {
  year: number;
  monthIndex: number; // 0-11
  monthTitleBn: string;
  weekdayHeadersBn: string[];
  leadingEmptySlots: number;
  days: CalendarDayCell[];
  practicedDaysInMonth: number;
  totalDrillsInMonth: number;
}

export interface StreakMetrics {
  currentStreakDays: number;
  longestStreakDays: number;
  totalPracticedDays: number;
}

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export const BN_FULL_MONTHS = [
  'জানুয়ারি',
  'ফেব্রুয়ারি',
  'মার্চ',
  'এপ্রিল',
  'মে',
  'জুন',
  'জুলাই',
  'আগস্ট',
  'সেপ্টেম্বর',
  'অক্টোবর',
  'নভেম্বর',
  'ডিসেম্বর'
];

export const BN_WEEKDAY_HEADERS = ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র', 'শনি'];

export function toBnNumberStr(val: number | string): string {
  return String(val).replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)] ?? d);
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function hasPerformedPracticeDrill(record?: DailyPracticeActivity | null): boolean {
  if (!record) return false;
  return (record.reviewsCount || 0) > 0 || (record.wordsLearnedCount || 0) > 0;
}

export function buildMonthCalendarGrid(
  year: number,
  monthIndex: number,
  activityMap: Record<string, DailyPracticeActivity>,
  todayYmd: string
): MonthCalendarGrid {
  const firstDayUtc = new Date(Date.UTC(year, monthIndex, 1));
  const leadingEmptySlots = firstDayUtc.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

  const days: CalendarDayCell[] = [];
  let practicedDaysInMonth = 0;
  let totalDrillsInMonth = 0;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateYmd = `${year}-${pad2(monthIndex + 1)}-${pad2(d)}`;
    const weekdayIndex = (leadingEmptySlots + d - 1) % 7;
    const act = activityMap[dateYmd];
    const isPracticed = hasPerformedPracticeDrill(act);
    const drillsCount = act ? Math.max(act.reviewsCount || 0, act.wordsLearnedCount || 0) : 0;
    const wordsLearnedCount = act ? (act.wordsLearnedCount || 0) : 0;

    if (isPracticed) {
      practicedDaysInMonth += 1;
      totalDrillsInMonth += drillsCount;
    }

    days.push({
      dateYmd,
      dayNumber: d,
      dayNumberBn: toBnNumberStr(d),
      weekdayIndex,
      isPracticed,
      drillsCount,
      wordsLearnedCount,
      isToday: dateYmd === todayYmd,
      isFuture: dateYmd > todayYmd
    });
  }

  const monthNameBn = BN_FULL_MONTHS[monthIndex] || '';
  const monthTitleBn = `${monthNameBn} ${toBnNumberStr(year)}`;

  return {
    year,
    monthIndex,
    monthTitleBn,
    weekdayHeadersBn: BN_WEEKDAY_HEADERS.slice(),
    leadingEmptySlots,
    days,
    practicedDaysInMonth,
    totalDrillsInMonth
  };
}

export function computeStreakMetrics(
  activityMap: Record<string, DailyPracticeActivity>,
  todayYmd: string
): StreakMetrics {
  const practicedDates = Object.keys(activityMap)
    .filter((ymd) => hasPerformedPracticeDrill(activityMap[ymd]))
    .sort();

  const totalPracticedDays = practicedDates.length;
  if (totalPracticedDays === 0) {
    return { currentStreakDays: 0, longestStreakDays: 0, totalPracticedDays: 0 };
  }

  // Compute longest streak across sorted YYYY-MM-DD dates
  let longestStreakDays = 1;
  let running = 1;

  for (let i = 1; i < practicedDates.length; i++) {
    const prevMs = Date.parse(`${practicedDates[i - 1]}T00:00:00Z`);
    const curMs = Date.parse(`${practicedDates[i]}T00:00:00Z`);
    const diffDays = Math.round((curMs - prevMs) / 86400000);
    if (diffDays === 1) {
      running += 1;
      if (running > longestStreakDays) {
        longestStreakDays = running;
      }
    } else if (diffDays > 1) {
      running = 1;
    }
  }

  // Compute current streak ending today or yesterday
  const practicedSet = new Set(practicedDates);
  const todayMs = Date.parse(`${todayYmd}T00:00:00Z`);
  const yesterdayYmd = new Date(todayMs - 86400000).toISOString().slice(0, 10);

  let currentStreakDays = 0;
  if (practicedSet.has(todayYmd) || practicedSet.has(yesterdayYmd)) {
    let cursorMs = practicedSet.has(todayYmd) ? todayMs : todayMs - 86400000;
    while (true) {
      const ymd = new Date(cursorMs).toISOString().slice(0, 10);
      if (practicedSet.has(ymd)) {
        currentStreakDays += 1;
        cursorMs -= 86400000;
      } else {
        break;
      }
    }
  }

  return {
    currentStreakDays,
    longestStreakDays: Math.max(longestStreakDays, currentStreakDays),
    totalPracticedDays
  };
}
