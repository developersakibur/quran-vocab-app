import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CORE_FREQUENT_GROUP_IDS,
  buildCoreFrequentWordsList,
  filterCoreFrequentWords,
  summarizeCoreFrequentWords,
  stripArabicDiacritics,
  type FrequentGroupSource
} from './frequent-words.ts';

function buildGroupsFromRealIndex(): { groups: FrequentGroupSource[]; totalTokens: number } {
  const indexPath = path.resolve(process.cwd(), 'data/lookup/frequency-index.json');
  const raw = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const configs = [
    { id: 'g1', order: 1, titleBn: 'অতি-মৌলিক শব্দ', rangeLabelBn: '৫০০+ বার', min: 500, max: Infinity },
    { id: 'g2', order: 2, titleBn: 'মূল ভিত্তি', rangeLabelBn: '২০০–৪৯৯ বার', min: 200, max: 499 },
    { id: 'g3', order: 3, titleBn: 'সর্বাধিক পরিচিত', rangeLabelBn: '১০০–১৯৯ বার', min: 100, max: 199 },
    { id: 'g4', order: 4, titleBn: 'নিয়মিত শব্দ', rangeLabelBn: '৫০–৯৯ বার', min: 50, max: 99 },
    { id: 'g5', order: 5, titleBn: 'মধ্যম-উচ্চ স্তর', rangeLabelBn: '২৫–৪৯ বার', min: 25, max: 49 },
    { id: 'g6', order: 6, titleBn: 'গুরুত্বপূর্ণ ভাণ্ডার', rangeLabelBn: '১০–২৪ বার', min: 10, max: 24 }
  ];

  const groups: FrequentGroupSource[] = configs.map((cfg) => {
    const words = raw.entries
      .filter((t: [string, string, string, number, number, string]) => t[3] >= cfg.min && t[3] <= cfg.max)
      .map((t: [string, string, string, number, number, string]) => {
        const [s, a, p] = String(t[0]).split(':');
        return {
          key: t[0],
          arabic: t[1],
          meaning_bn: t[2],
          occurrenceCount: Number(t[3]),
          juz: Number(t[4]),
          root: t[5] || '',
          surah: parseInt(s, 10),
          ayah: parseInt(a, 10),
          position: parseInt(p, 10)
        };
      });
    return {
      id: cfg.id,
      order: cfg.order,
      titleBn: cfg.titleBn,
      rangeLabelBn: cfg.rangeLabelBn,
      subGroups: [{ lists: [{ words }] }]
    };
  });

  return { groups, totalTokens: Number(raw.totalTokens) };
}

test('buildCoreFrequentWordsList extracts Chapters 1-5 strictly descending and excludes Chapter 6+', () => {
  const { groups, totalTokens } = buildGroupsFromRealIndex();
  const list = buildCoreFrequentWordsList(groups);

  // Chapters 1-5 contain 14 + 26 + 42 + 100 + 200 = 382 words (all occurrenceCount >= 25)
  assert.equal(list.length, 382);
  assert.equal(list[0].rank, 1);
  assert.equal(list[0].occurrenceCount, 1112);
  assert.equal(list[list.length - 1].rank, 382);
  assert.ok(list[list.length - 1].occurrenceCount >= 25);

  for (let i = 1; i < list.length; i++) {
    assert.ok(
      list[i - 1].occurrenceCount >= list[i].occurrenceCount,
      `Expected descending frequency at index ${i}: ${list[i - 1].occurrenceCount} vs ${list[i].occurrenceCount}`
    );
    assert.equal(list[i].rank, i + 1);
    assert.ok((CORE_FREQUENT_GROUP_IDS as readonly string[]).includes(list[i].groupId));
  }

  const summary = summarizeCoreFrequentWords(list, groups, totalTokens);
  assert.equal(summary.totalWords, 382);
  assert.equal(summary.chapters1To4Words, 182);
  assert.equal(summary.chapters.map((c) => c.wordCount).join(','), '14,26,42,100,200');
  assert.equal(summary.coveragePct, 47.3);
});

test('filterCoreFrequentWords filters by chapter and diacritic-insensitive Arabic or Bengali meaning', () => {
  const { groups } = buildGroupsFromRealIndex();
  const list = buildCoreFrequentWordsList(groups);

  const ch1 = filterCoreFrequentWords(list, 'g1', '');
  assert.equal(ch1.length, 14);
  assert.ok(ch1.every((w) => w.occurrenceCount >= 500));

  const bnSearch = filterCoreFrequentWords(list, 'all', 'আল্লাহ');
  assert.ok(bnSearch.length >= 2);
  assert.ok(bnSearch[0].occurrenceCount >= bnSearch[1].occurrenceCount);

  // Diacritic-insensitive Arabic search (e.g. typing الله finds ٱللَّهِ / ٱللَّهُ)
  assert.equal(stripArabicDiacritics('ٱللَّهِ'), 'الله');
  const arSearch = filterCoreFrequentWords(list, 'all', 'الله');
  assert.ok(arSearch.some((w) => w.key === '1:1:2'));
});
