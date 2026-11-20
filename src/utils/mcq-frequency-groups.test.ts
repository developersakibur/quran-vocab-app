import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  smartSliceIntoLists,
  buildMcqGroupHierarchy,
  computeSubGroupListStates,
  computeProgressiveHorizon,
  buildMiniStepsForLists,
  didPassMcqListExam,
  findRecommendedResumeList,
  isMcqPassKey,
  toMcqPassStorageKey,
  fromMcqPassStorageKey,
  type FreqTuple
} from './mcq-frequency-groups';

test('smartSliceIntoLists enforces <=5 merge into last list and >=6 new list rule across all edge cases', () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

  assert.deepEqual(smartSliceIntoLists(mk(0)).map((c) => c.length), []);
  assert.deepEqual(smartSliceIntoLists(mk(1)).map((c) => c.length), [1]);
  assert.deepEqual(smartSliceIntoLists(mk(5)).map((c) => c.length), [5]);
  assert.deepEqual(smartSliceIntoLists(mk(10)).map((c) => c.length), [10]);
  assert.deepEqual(smartSliceIntoLists(mk(11)).map((c) => c.length), [11]);
  assert.deepEqual(smartSliceIntoLists(mk(14)).map((c) => c.length), [14]);
  assert.deepEqual(smartSliceIntoLists(mk(15)).map((c) => c.length), [15]);
  assert.deepEqual(smartSliceIntoLists(mk(16)).map((c) => c.length), [10, 6]);
  assert.deepEqual(smartSliceIntoLists(mk(19)).map((c) => c.length), [10, 9]);
  assert.deepEqual(smartSliceIntoLists(mk(20)).map((c) => c.length), [10, 10]);
  assert.deepEqual(smartSliceIntoLists(mk(21)).map((c) => c.length), [10, 11]);
  assert.deepEqual(smartSliceIntoLists(mk(25)).map((c) => c.length), [10, 15]);
  assert.deepEqual(smartSliceIntoLists(mk(26)).map((c) => c.length), [10, 10, 6]);
  assert.deepEqual(smartSliceIntoLists(mk(42)).map((c) => c.length), [10, 10, 10, 12]);
  assert.deepEqual(smartSliceIntoLists(mk(100)).map((c) => c.length), Array(10).fill(10));
});

test('real Quran frequency-index.json builds all 10 groups, 19,123 unique words, 30 Juz in G9 & G10, and zero 1-5 word leftover lists', () => {
  const indexPath = path.resolve(process.cwd(), 'data/lookup/frequency-index.json');
  const raw = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const entries = raw.entries as FreqTuple[];

  const hierarchy = buildMcqGroupHierarchy(entries, raw.totalTokens);

  assert.equal(hierarchy.totalUnique, 19123);
  assert.equal(hierarchy.groups.length, 10);

  // Tier split: 6 Foundation + 4 Deep Mastery
  assert.equal(hierarchy.groups.filter((g) => g.tier === 'foundation').length, 6);
  assert.equal(hierarchy.groups.filter((g) => g.tier === 'deep').length, 4);

  // Exact word counts on key groups
  assert.equal(hierarchy.groups[0].wordCount, 14);
  assert.equal(hierarchy.groups[0].listCount, 1); // 14 merged into 1 full list!
  assert.equal(hierarchy.groups[1].wordCount, 26);
  assert.equal(hierarchy.groups[1].listCount, 3); // 10, 10, 6
  assert.equal(hierarchy.groups[2].wordCount, 42);
  assert.equal(hierarchy.groups[2].listCount, 4); // 10, 10, 10, 12
  assert.equal(hierarchy.groups[3].wordCount, 100);
  assert.equal(hierarchy.groups[3].listCount, 10);
  assert.equal(hierarchy.groups[4].wordCount, 200);
  assert.equal(hierarchy.groups[4].listCount, 20);
  assert.equal(hierarchy.groups[5].wordCount, 612);
  assert.equal(hierarchy.groups[5].subGroups.length, 6); // 6 chapters

  // Group 7: 5 exact frequency tiers (9..5)
  assert.equal(hierarchy.groups[6].wordCount, 1202);
  assert.equal(hierarchy.groups[6].subGroups.length, 5);

  // Group 9 & Group 10: all 30 Juz present
  assert.equal(hierarchy.groups[8].wordCount, 2891);
  assert.equal(hierarchy.groups[8].subGroups.length, 30);
  assert.equal(hierarchy.groups[9].wordCount, 12190);
  assert.equal(hierarchy.groups[9].subGroups.length, 30);

  // Cumulative coverage ends at 100.0%
  assert.equal(hierarchy.groups[9].cumulativeCoveragePct, 100);

  // Integrity check: every single word accounted for once AND no list anywhere has < 6 or > 15 words
  let sumWords = 0;
  const seenKeys = new Set<string>();
  for (const g of hierarchy.groups) {
    for (const sg of g.subGroups) {
      for (const list of sg.lists) {
        assert.ok(list.totalWords >= 6 && list.totalWords <= 15, `List ${list.listKey} has invalid size ${list.totalWords}`);
        assert.ok(!seenKeys.has(list.listKey), `Duplicate listKey ${list.listKey}`);
        seenKeys.add(list.listKey);
        sumWords += list.totalWords;
      }
    }
  }
  assert.equal(sumWords, 19123);
});

test('strict 100% single-exam unlock chain keeps List 1 unlocked and blocks List 2 even if all 10 words were learned across partial attempts', () => {
  const sampleEntries: FreqTuple[] = Array.from({ length: 26 }, (_, i) => [
    `1:1:${i + 1}`,
    `كلمة${i + 1}`,
    `অর্থ${i + 1}`,
    300 - i,
    1,
    ''
  ]);
  const { groups } = buildMcqGroupHierarchy(sampleEntries);
  const g2 = groups.find((g) => g.id === 'g2')!;
  const lists = g2.subGroups[0].lists;
  assert.equal(lists.length, 3); // 10, 10, 6

  // Initial state: List 1 unlocked, List 2 & 3 locked
  const initial = computeSubGroupListStates(lists, {}, {});
  assert.equal(initial[0].isUnlocked, true);
  assert.equal(initial[0].isActive, true);
  assert.equal(initial[1].isUnlocked, false);
  assert.equal(initial[2].isUnlocked, false);

  // User learns 6 words in List 1 -> shows 6/10, List 2 STILL locked
  const progress6: Record<string, { correctCount: number }> = {};
  for (let i = 0; i < 6; i++) progress6[lists[0].words[i].key] = { correctCount: 1 };
  const after6 = computeSubGroupListStates(lists, progress6, {});
  assert.equal(after6[0].learnedCount, 6);
  assert.equal(after6[0].totalWords, 10);
  assert.equal(after6[0].isPassed, false);
  assert.equal(after6[1].isUnlocked, false);

  // Even if all 10 words have correctCount >= 1 across separate failed attempts, List 2 stays LOCKED without a 100% pass record!
  const progress10: Record<string, { correctCount: number }> = {};
  for (let i = 0; i < 10; i++) progress10[lists[0].words[i].key] = { correctCount: 1 };
  const after10WithoutPass = computeSubGroupListStates(lists, progress10, {});
  assert.equal(after10WithoutPass[0].learnedCount, 10);
  assert.equal(after10WithoutPass[1].isUnlocked, false);

  // Strict 100% exam check
  assert.equal(didPassMcqListExam(9, 10), false);
  assert.equal(didPassMcqListExam(10, 10), true);
  assert.equal(didPassMcqListExam(6, 6), true);

  // Once List 1 is passed with 10/10, List 2 unlocks while List 3 remains locked
  const afterPass1 = computeSubGroupListStates(lists, progress10, {
    [lists[0].listKey]: { listKey: lists[0].listKey, passed: true, bestScore: 10, total: 10 }
  });
  assert.equal(afterPass1[0].isPassed, true);
  assert.equal(afterPass1[1].isUnlocked, true);
  assert.equal(afterPass1[1].isActive, true);
  assert.equal(afterPass1[2].isUnlocked, false);
});

test('progressive horizon hides long walls of locked padlocks and expands when showAll is true', () => {
  const sampleEntries: FreqTuple[] = Array.from({ length: 100 }, (_, i) => [
    `2:${Math.floor(i / 10) + 1}:${(i % 10) + 1}`,
    `ك${i + 1}`,
    `ম${i + 1}`,
    75,
    1,
    ''
  ]);
  const { groups } = buildMcqGroupHierarchy(sampleEntries);
  const g4 = groups.find((g) => g.id === 'g4')!;
  const states = computeSubGroupListStates(g4.subGroups[0].lists, {}, {});
  assert.equal(states.length, 10);

  // Default: active (index 0) + next 3 locked = 4 visible, 6 hidden
  const collapsed = computeProgressiveHorizon(states, false, 3);
  assert.equal(collapsed.visibleItems.length, 4);
  assert.equal(collapsed.hiddenCount, 6);

  // Expanded: all 10 visible, 0 hidden
  const expanded = computeProgressiveHorizon(states, true, 3);
  assert.equal(expanded.visibleItems.length, 10);
  assert.equal(expanded.hiddenCount, 0);
});

test('mini-steps batch large sub-groups (>20 lists) into clean 10-list steps and resume finder prioritizes partial progress', () => {
  const sampleEntries: FreqTuple[] = [
    // 14 words in G1 (500+)
    ...Array.from({ length: 14 }, (_, i): FreqTuple => [`1:1:${i + 1}`, `أ${i}`, `ক${i}`, 600, 1, '']),
    // 320 words in G10 Juz 30 (1 time -> 32 lists)
    ...Array.from({ length: 320 }, (_, i): FreqTuple => [`78:${Math.floor(i / 10) + 1}:${(i % 10) + 1}`, `ب${i}`, `খ${i}`, 1, 30, ''])
  ];
  const { groups } = buildMcqGroupHierarchy(sampleEntries);
  const g10 = groups.find((g) => g.id === 'g10')!;
  const juz30 = g10.subGroups.find((sg) => sg.id === 'j30')!;
  const states = computeSubGroupListStates(juz30.lists, {}, {});

  const steps = buildMiniStepsForLists(states, 10);
  assert.equal(steps.length, 4); // 10, 10, 10, 2
  assert.equal(steps[0].items.length, 10);
  assert.equal(steps[0].hasActive, true);

  // Resume finder prefers in-progress list in Juz 30 if user started there
  const partialProgress = { [juz30.lists[0].words[0].key]: { correctCount: 1 } };
  const rec = findRecommendedResumeList(groups, partialProgress, {});
  assert.ok(rec);
  assert.equal(rec.groupId, 'g10');
  assert.equal(rec.subGroupId, 'j30');
  assert.equal(rec.learnedCount, 1);

  // Storage key helpers
  const sk = toMcqPassStorageKey('g10:j30:1');
  assert.equal(isMcqPassKey(sk), true);
  assert.equal(isMcqPassKey('1:1:1'), false);
  assert.equal(fromMcqPassStorageKey(sk), 'g10:j30:1');
});
