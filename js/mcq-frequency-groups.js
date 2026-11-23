/* ============================================================
   MCQ FREQUENCY GROUPS & PROGRESSIVE UNLOCK ENGINE (Browser Runtime)
   - Loads pre-built full-Quran frequency index (19,123 unique words)
   - Organizes into 10 Main Groups (2 tiers: Core Foundation + Deep Mastery)
   - Smart remainder-merging rule: <=5 leftover words merge into last list; >=6 form new list
   - Exact frequency sub-groups (G7, G8) & 30 Juz/Para sub-groups (G9, G10)
   - Strict 100% single-exam unlock progression + Duolingo-style Progressive Horizon
   ============================================================ */

(function (global) {
  'use strict';

  const MCQ_PASS_PREFIX = 'mcq_pass:';
  const INDEX_URL = 'data/lookup/frequency-index.json?v=34';
  const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

  const MCQ_MAIN_GROUP_CONFIGS = [
    {
      id: 'g1',
      order: 1,
      tier: 'foundation',
      titleBn: 'অতি-মৌলিক শব্দ',
      rangeLabelBn: '৫০০+ বার',
      minFreq: 500,
      maxFreq: Infinity,
      subMode: 'direct',
      descriptionBn: 'কুরআনের সবচেয়ে বেশি ব্যবহৃত ১৪টি মূল শব্দ'
    },
    {
      id: 'g2',
      order: 2,
      tier: 'foundation',
      titleBn: 'মূল ভিত্তি',
      rangeLabelBn: '২০০–৪৯৯ বার',
      minFreq: 200,
      maxFreq: 499,
      subMode: 'direct',
      descriptionBn: 'প্রতিটি পৃষ্ঠায় বারবার আসা অপরিহার্য শব্দ'
    },
    {
      id: 'g3',
      order: 3,
      tier: 'foundation',
      titleBn: 'সর্বাধিক পরিচিত',
      rangeLabelBn: '১০০–১৯৯ বার',
      minFreq: 100,
      maxFreq: 199,
      subMode: 'direct',
      descriptionBn: 'শতাধিকবার ব্যবহৃত শক্তিশালী কুরআনী শব্দ'
    },
    {
      id: 'g4',
      order: 4,
      tier: 'foundation',
      titleBn: 'নিয়মিত শব্দ',
      rangeLabelBn: '৫০–৯৯ বার',
      minFreq: 50,
      maxFreq: 99,
      subMode: 'direct',
      descriptionBn: 'ঠিক ১০০টি শব্দ — ১০টি পূর্ণাঙ্গ ১০-শব্দের লিস্ট'
    },
    {
      id: 'g5',
      order: 5,
      tier: 'foundation',
      titleBn: 'মধ্যম-উচ্চ স্তর',
      rangeLabelBn: '২৫–৪৯ বার',
      minFreq: 25,
      maxFreq: 49,
      subMode: 'direct',
      descriptionBn: '২০০টি শব্দ — শেষ করলে কুরআনের প্রায় অর্ধেক বোঝা সম্ভব'
    },
    {
      id: 'g6',
      order: 6,
      tier: 'foundation',
      titleBn: 'গুরুত্বপূর্ণ ভাণ্ডার',
      rangeLabelBn: '১০–২৪ বার',
      minFreq: 10,
      maxFreq: 24,
      subMode: 'chapters',
      descriptionBn: '৬টি ছোট অধ্যায়ে সাজানো — মূল ভিত্তির শেষ ধাপ (৫৯% কুরআন)'
    },
    {
      id: 'g7',
      order: 7,
      tier: 'deep',
      titleBn: 'সম্প্রসারিত শব্দ',
      rangeLabelBn: '৫–৯ বার',
      minFreq: 5,
      maxFreq: 9,
      subMode: 'freq-tiers',
      descriptionBn: '৯ বার থেকে ৫ বার — ৫টি প্রাকৃতিক ফ্রিকোয়েন্সি স্তরে বিভক্ত'
    },
    {
      id: 'g8',
      order: 8,
      tier: 'deep',
      titleBn: 'মাঝারি পুনরাবৃত্তি',
      rangeLabelBn: '৩–৪ বার',
      minFreq: 3,
      maxFreq: 4,
      subMode: 'freq-chapters',
      descriptionBn: '৪ বার ও ৩ বার আসা শব্দগুলো ১০-লিস্টের ছোট অধ্যায়ে বিভক্ত'
    },
    {
      id: 'g9',
      order: 9,
      tier: 'deep',
      titleBn: 'দ্বি-ব্যবহৃত শব্দ',
      rangeLabelBn: '২ বার',
      minFreq: 2,
      maxFreq: 2,
      subMode: 'juz',
      descriptionBn: 'কুরআনের ৩০ পারা অনুযায়ী সাজানো — প্রতি পারায় গড়ে মাত্র ৯–১০ লিস্ট'
    },
    {
      id: 'g10',
      order: 10,
      tier: 'deep',
      titleBn: 'একক শব্দ (বিরল)',
      rangeLabelBn: '১ বার',
      minFreq: 1,
      maxFreq: 1,
      subMode: 'juz',
      descriptionBn: 'কুরআনের ৩০ পারা অনুযায়ী প্রতিটি বিরল একক শব্দ (১০০% কুরআন)'
    }
  ];

  function toBnDigits(val) {
    return String(val).replace(/\d/g, (d) => BN_DIGITS[Number(d)] || d);
  }

  function isMcqPassKey(wordId) {
    return typeof wordId === 'string' && wordId.startsWith(MCQ_PASS_PREFIX);
  }

  function toMcqPassStorageKey(listKey) {
    return MCQ_PASS_PREFIX + listKey;
  }

  function fromMcqPassStorageKey(storageKey) {
    if (!isMcqPassKey(storageKey)) return null;
    return storageKey.slice(MCQ_PASS_PREFIX.length);
  }

  function smartSliceIntoLists(items, baseSize = 10, mergeThreshold = 5) {
    if (!Array.isArray(items) || items.length === 0) return [];
    const total = items.length;
    if (total <= baseSize + mergeThreshold) {
      return [items.slice()];
    }
    const fullCount = Math.floor(total / baseSize);
    const rem = total % baseSize;
    const chunks = [];
    for (let i = 0; i < fullCount; i++) {
      const start = i * baseSize;
      const isLastFull = i === fullCount - 1;
      if (isLastFull && rem >= 1 && rem <= mergeThreshold) {
        chunks.push(items.slice(start));
      } else {
        chunks.push(items.slice(start, start + baseSize));
      }
    }
    if (rem > mergeThreshold) {
      chunks.push(items.slice(fullCount * baseSize));
    }
    return chunks;
  }

  function hydrateFreqTuple(tuple) {
    const key = tuple[0] || '1:1:1';
    const parts = String(key).split(':');
    const surah = parseInt(parts[0] || '1', 10) || 1;
    const ayah = parseInt(parts[1] || '1', 10) || 1;
    return {
      key,
      arabic: tuple[1] || '',
      meaning_bn: tuple[2] || '',
      occurrenceCount: Number(tuple[3] || 1),
      juz: Number(tuple[4] || 1),
      root: tuple[5] || '',
      surah,
      ayah,
      verse_key: `${surah}:${ayah}`
    };
  }

  function makeListsForSubGroup(groupId, subGroupId, words) {
    const chunks = smartSliceIntoLists(words, 10, 5);
    return chunks.map((chunk, idx) => {
      const listNumber = idx + 1;
      return {
        listKey: `${groupId}:${subGroupId}:${listNumber}`,
        groupId,
        subGroupId,
        listNumber,
        words: chunk,
        totalWords: chunk.length
      };
    });
  }

  function splitIntoChapters(groupId, idPrefix, words, sectionLabelBn, targetListsPerChapter = 10) {
    const allLists = makeListsForSubGroup(groupId, idPrefix, words);
    const totalLists = allLists.length;
    if (totalLists === 0) return [];

    const chapterCount = totalLists <= targetListsPerChapter + 3
      ? 1
      : Math.max(1, Math.round(totalLists / targetListsPerChapter));

    const subGroups = [];
    let cursor = 0;
    for (let ch = 1; ch <= chapterCount; ch++) {
      const remainingLists = totalLists - cursor;
      const remainingChapters = chapterCount - ch + 1;
      const take = ch === chapterCount
        ? remainingLists
        : Math.ceil(remainingLists / remainingChapters);
      const sliceLists = allLists.slice(cursor, cursor + take);
      cursor += take;

      const chId = chapterCount === 1 ? idPrefix : `${idPrefix}-ch${ch}`;
      const chWords = [];
      for (const l of sliceLists) {
        for (const w of l.words) chWords.push(w);
      }
      const chLists = sliceLists.map((l, idx) => ({
        listKey: `${groupId}:${chId}:${idx + 1}`,
        groupId,
        subGroupId: chId,
        listNumber: idx + 1,
        words: l.words,
        totalWords: l.words.length
      }));
      const occSum = chWords.reduce((s, w) => s + w.occurrenceCount, 0);
      subGroups.push({
        id: chId,
        groupId,
        titleBn: chapterCount === 1
          ? (sectionLabelBn || `অধ্যায় ${toBnDigits(ch)}`)
          : `অধ্যায় ${toBnDigits(ch)}`,
        subtitleBn: `${toBnDigits(chWords.length)}টি শব্দ · ${toBnDigits(chLists.length)}টি লিস্ট`,
        sectionLabelBn,
        wordCount: chWords.length,
        occurrenceSum: occSum,
        lists: chLists
      });
    }
    return subGroups;
  }

  function buildHierarchy(rawEntries, totalTokensOverride) {
    const entries = rawEntries.map(hydrateFreqTuple);
    const totalTokens = totalTokensOverride && totalTokensOverride > 0
      ? totalTokensOverride
      : entries.reduce((s, e) => s + e.occurrenceCount, 0);

    let cumulativeOcc = 0;
    let totalLists = 0;
    const groups = [];

    for (const cfg of MCQ_MAIN_GROUP_CONFIGS) {
      const matched = entries.filter(
        (e) => e.occurrenceCount >= cfg.minFreq && e.occurrenceCount <= cfg.maxFreq
      );
      const occSum = matched.reduce((s, e) => s + e.occurrenceCount, 0);
      cumulativeOcc += occSum;

      let subGroups = [];
      if (cfg.subMode === 'direct') {
        const lists = makeListsForSubGroup(cfg.id, 'main', matched);
        subGroups = [{
          id: 'main',
          groupId: cfg.id,
          titleBn: `${cfg.titleBn} (${cfg.rangeLabelBn})`,
          subtitleBn: `${toBnDigits(matched.length)}টি শব্দ · ${toBnDigits(lists.length)}টি লিস্ট`,
          wordCount: matched.length,
          occurrenceSum: occSum,
          lists
        }];
      } else if (cfg.subMode === 'chapters') {
        subGroups = splitIntoChapters(cfg.id, 'ch', matched, undefined, 10);
      } else if (cfg.subMode === 'freq-tiers') {
        for (let freq = cfg.maxFreq; freq >= cfg.minFreq; freq--) {
          const tierWords = matched.filter((w) => w.occurrenceCount === freq);
          if (tierWords.length === 0) continue;
          const lists = makeListsForSubGroup(cfg.id, `f${freq}`, tierWords);
          subGroups.push({
            id: `f${freq}`,
            groupId: cfg.id,
            titleBn: `${toBnDigits(freq)} বার আসা শব্দ`,
            subtitleBn: `${toBnDigits(tierWords.length)}টি শব্দ · ${toBnDigits(lists.length)}টি লিস্ট`,
            wordCount: tierWords.length,
            occurrenceSum: tierWords.reduce((s, w) => s + w.occurrenceCount, 0),
            lists
          });
        }
      } else if (cfg.subMode === 'freq-chapters') {
        for (let freq = cfg.maxFreq; freq >= cfg.minFreq; freq--) {
          const tierWords = matched.filter((w) => w.occurrenceCount === freq);
          if (tierWords.length === 0) continue;
          const label = `${toBnDigits(freq)} বার আসা শব্দ (${toBnDigits(tierWords.length)}টি)`;
          const chapters = splitIntoChapters(cfg.id, `f${freq}`, tierWords, label, 10);
          subGroups.push(...chapters);
        }
      } else if (cfg.subMode === 'juz') {
        const byJuz = new Map();
        for (let j = 1; j <= 30; j++) byJuz.set(j, []);
        for (const w of matched) {
          const j = w.juz >= 1 && w.juz <= 30 ? w.juz : 1;
          byJuz.get(j).push(w);
        }
        for (let j = 1; j <= 30; j++) {
          const juzWords = byJuz.get(j) || [];
          if (juzWords.length === 0) continue;
          const lists = makeListsForSubGroup(cfg.id, `j${j}`, juzWords);
          const juzTitle = j === 30
            ? `পারা ${toBnDigits(j)} (আম্মাপারা)`
            : `পারা ${toBnDigits(j)}`;
          subGroups.push({
            id: `j${j}`,
            groupId: cfg.id,
            titleBn: juzTitle,
            subtitleBn: `${toBnDigits(juzWords.length)}টি শব্দ · ${toBnDigits(lists.length)}টি লিস্ট`,
            juz: j,
            wordCount: juzWords.length,
            occurrenceSum: juzWords.reduce((s, w) => s + w.occurrenceCount, 0),
            lists
          });
        }
      }

      const groupListCount = subGroups.reduce((s, sg) => s + sg.lists.length, 0);
      totalLists += groupListCount;

      groups.push({
        ...cfg,
        wordCount: matched.length,
        listCount: groupListCount,
        occurrenceSum: occSum,
        coveragePct: totalTokens > 0 ? Number(((occSum / totalTokens) * 100).toFixed(1)) : 0,
        cumulativeCoveragePct: totalTokens > 0 ? Number(((cumulativeOcc / totalTokens) * 100).toFixed(1)) : 0,
        subGroups
      });
    }

    return {
      entries,
      groups,
      totalUnique: entries.length,
      totalTokens,
      totalLists
    };
  }

  function isWordLearned(wordKey, progressMap) {
    if (!progressMap || !wordKey) return false;
    const rec = progressMap[wordKey];
    if (!rec) return false;
    return Number(rec.correctCount || 0) >= 1 || Number(rec.repetitions || 0) >= 1;
  }

  function computeSubGroupListStates(lists, progressMap, passedMap) {
    const states = [];
    let prevPassed = true;
    let activeMarked = false;

    for (let i = 0; i < lists.length; i++) {
      const list = lists[i];
      let learnedCount = 0;
      for (const w of list.words) {
        if (isWordLearned(w.key, progressMap)) learnedCount++;
      }

      const passRec = passedMap ? passedMap[list.listKey] : null;
      const isPassed = Boolean(passRec && passRec.passed);
      const displayLearned = isPassed ? list.totalWords : Math.min(learnedCount, list.totalWords);
      const isUnlocked = i === 0 || prevPassed;
      const isActive = isUnlocked && !isPassed && !activeMarked;
      if (isActive) activeMarked = true;

      const status = isPassed ? 'passed' : isUnlocked ? 'active' : 'locked';

      states.push({
        list,
        learnedCount: displayLearned,
        totalWords: list.totalWords,
        isPassed,
        isUnlocked,
        isActive,
        status
      });
      prevPassed = isPassed;
    }

    return states;
  }

  function computeSubGroupSummary(subGroup, progressMap, passedMap) {
    const states = computeSubGroupListStates(subGroup.lists, progressMap, passedMap);
    let learnedWords = 0;
    let passedLists = 0;
    for (const st of states) {
      learnedWords += st.learnedCount;
      if (st.isPassed) passedLists++;
    }
    return {
      states,
      learnedWords,
      totalWords: subGroup.wordCount,
      passedLists,
      totalLists: subGroup.lists.length,
      pct: subGroup.wordCount > 0 ? Math.round((learnedWords / subGroup.wordCount) * 100) : 0
    };
  }

  function computeGroupSummary(group, progressMap, passedMap) {
    let learnedWords = 0;
    let passedLists = 0;
    for (const sg of group.subGroups) {
      const s = computeSubGroupSummary(sg, progressMap, passedMap);
      learnedWords += s.learnedWords;
      passedLists += s.passedLists;
    }
    return {
      learnedWords,
      totalWords: group.wordCount,
      passedLists,
      totalLists: group.listCount,
      pct: group.wordCount > 0 ? Math.round((learnedWords / group.wordCount) * 100) : 0
    };
  }

  function computeOverallSummary(hierarchy, progressMap, passedMap) {
    let totalLearnedWords = 0;
    let totalPassedLists = 0;
    let learnedOccurrenceTokens = 0;

    for (const g of hierarchy.groups) {
      for (const sg of g.subGroups) {
        const states = computeSubGroupListStates(sg.lists, progressMap, passedMap);
        for (const st of states) {
          totalLearnedWords += st.learnedCount;
          if (st.isPassed) totalPassedLists++;
          for (const w of st.list.words) {
            if (st.isPassed || isWordLearned(w.key, progressMap)) {
              learnedOccurrenceTokens += w.occurrenceCount;
            }
          }
        }
      }
    }

    const quranCoveragePct = hierarchy.totalTokens > 0
      ? Number(((learnedOccurrenceTokens / hierarchy.totalTokens) * 100).toFixed(1))
      : 0;

    return {
      totalLearnedWords,
      totalUnique: hierarchy.totalUnique,
      totalPassedLists,
      totalLists: hierarchy.totalLists,
      quranCoveragePct
    };
  }

  function buildMiniStepsForLists(listStates, stepSize = 10) {
    if (listStates.length <= 20) {
      return [{
        stepIndex: 0,
        labelBn: `লিস্ট ${toBnDigits(1)}–${toBnDigits(listStates.length)}`,
        startNum: 1,
        endNum: listStates.length,
        items: listStates,
        passedCount: listStates.filter((s) => s.isPassed).length,
        hasActive: listStates.some((s) => s.isActive)
      }];
    }
    const steps = [];
    for (let i = 0; i < listStates.length; i += stepSize) {
      const slice = listStates.slice(i, i + stepSize);
      const startNum = slice[0].list.listNumber;
      const endNum = slice[slice.length - 1].list.listNumber;
      steps.push({
        stepIndex: steps.length,
        labelBn: `ধাপ ${toBnDigits(steps.length + 1)} (${toBnDigits(startNum)}–${toBnDigits(endNum)})`,
        startNum,
        endNum,
        items: slice,
        passedCount: slice.filter((s) => s.isPassed).length,
        hasActive: slice.some((s) => s.isActive)
      });
    }
    return steps;
  }

  function computeProgressiveHorizon(listStates, showAll = false, upcomingLockedCount = 3) {
    const totalCount = listStates.length;
    const activeIndex = listStates.findIndex((s) => s.isActive);
    if (showAll || totalCount <= upcomingLockedCount + 2) {
      return { visibleItems: listStates, hiddenCount: 0, totalCount, activeIndex };
    }
    let lastUnlockedIdx = activeIndex;
    if (lastUnlockedIdx === -1) {
      lastUnlockedIdx = listStates.reduce((acc, s, idx) => (s.isUnlocked ? idx : acc), 0);
    }
    const cutoff = Math.min(totalCount, lastUnlockedIdx + 1 + upcomingLockedCount);
    return {
      visibleItems: listStates.slice(0, cutoff),
      hiddenCount: Math.max(0, totalCount - cutoff),
      totalCount,
      activeIndex
    };
  }

  function didPassMcqListExam(score, total) {
    return total > 0 && score === total;
  }

  function findRecommendedResumeList(groups, progressMap, passedMap) {
    let firstUnpassedFallback = null;
    for (const group of groups) {
      for (const sub of group.subGroups) {
        const states = computeSubGroupListStates(sub.lists, progressMap, passedMap);
        for (const st of states) {
          if (st.isUnlocked && !st.isPassed) {
            const rec = {
              groupId: group.id,
              groupTitleBn: group.titleBn,
              subGroupId: sub.id,
              subGroupTitleBn: sub.titleBn,
              listNumber: st.list.listNumber,
              listKey: st.list.listKey,
              learnedCount: st.learnedCount,
              totalWords: st.totalWords
            };
            if (st.learnedCount > 0) return rec;
            if (!firstUnpassedFallback) firstUnpassedFallback = rec;
          }
        }
      }
    }
    return firstUnpassedFallback;
  }

  /**
   * Builds a rich distractor pool for a specific list using nearby words from the same group
   * (plus high-frequency fallback words if a group is small like Group 1).
   */
  function buildDistractorPoolForList(hierarchy, groupId, listWords) {
    const pool = [...listWords];
    const seenMeanings = new Set(listWords.map((w) => String(w.meaning_bn || '').trim()));
    const group = hierarchy.groups.find((g) => g.id === groupId);

    const addFromList = (arr, limit) => {
      let added = 0;
      for (const w of arr) {
        if (added >= limit) break;
        const m = String(w.meaning_bn || '').trim();
        if (!m || seenMeanings.has(m)) continue;
        seenMeanings.add(m);
        pool.push(w);
        added++;
      }
    };

    if (group) {
      for (const sg of group.subGroups) {
        for (const l of sg.lists) {
          addFromList(l.words, 48 - pool.length);
          if (pool.length >= 48) break;
        }
        if (pool.length >= 48) break;
      }
    }

    if (pool.length < 36 && Array.isArray(hierarchy.entries)) {
      addFromList(hierarchy.entries.slice(0, 120), 48 - pool.length);
    }

    return pool;
  }

  // Memoized async loader (single fetch + memory cache; SW caches JSON offline!)
  let cachedHierarchy = null;
  let loadPromise = null;

  async function loadHierarchy() {
    if (cachedHierarchy) return cachedHierarchy;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
      const res = await fetch(INDEX_URL);
      if (!res.ok) throw new Error('Failed to load frequency index');
      const data = await res.json();
      const rawEntries = Array.isArray(data && data.entries) ? data.entries : [];
      cachedHierarchy = buildHierarchy(rawEntries, Number(data && data.totalTokens) || 0);
      return cachedHierarchy;
    })().finally(() => {
      loadPromise = null;
    });

    return loadPromise;
  }

  function findGroup(hierarchy, groupId) {
    return (hierarchy && hierarchy.groups || []).find((g) => g.id === groupId) || null;
  }

  function findSubGroup(group, subGroupId) {
    if (!group || !Array.isArray(group.subGroups)) return null;
    if (!subGroupId) return group.subGroups[0] || null;
    return group.subGroups.find((sg) => sg.id === subGroupId) || group.subGroups[0] || null;
  }

  function findList(subGroup, listNumber) {
    if (!subGroup || !Array.isArray(subGroup.lists)) return null;
    const num = parseInt(listNumber, 10) || 1;
    return subGroup.lists.find((l) => l.listNumber === num) || subGroup.lists[0] || null;
  }

  const CORE_FREQUENT_GROUP_IDS = ['g1', 'g2', 'g3', 'g4', 'g5'];

  function stripArabicDiacritics(input) {
    if (!input) return '';
    return String(input)
      .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .trim();
  }

  function getCoreFrequentWords(hierarchy, allowedGroupIds = CORE_FREQUENT_GROUP_IDS) {
    if (!hierarchy || !Array.isArray(hierarchy.groups)) return [];
    const allowedSet = new Set(allowedGroupIds);
    const seen = new Set();
    const collected = [];

    for (const group of hierarchy.groups) {
      if (!group || !allowedSet.has(group.id)) continue;
      for (const sub of group.subGroups || []) {
        for (const list of sub.lists || []) {
          for (const w of list.words || []) {
            if (!w || !w.key || seen.has(w.key)) continue;
            seen.add(w.key);
            const parts = String(w.key).split(':');
            const surah = Number(w.surah) || parseInt(parts[0] || '1', 10) || 1;
            const ayah = Number(w.ayah) || parseInt(parts[1] || '1', 10) || 1;
            const position = parseInt(parts[2] || '1', 10) || 1;
            collected.push({
              ...w,
              surah,
              ayah,
              position,
              occurrenceCount: Number(w.occurrenceCount || 0),
              groupId: group.id,
              chapterOrder: Number(group.order || 1),
              chapterTitleBn: group.titleBn || ''
            });
          }
        }
      }
    }

    collected.sort((a, b) => {
      if (b.occurrenceCount !== a.occurrenceCount) return b.occurrenceCount - a.occurrenceCount;
      if (a.chapterOrder !== b.chapterOrder) return a.chapterOrder - b.chapterOrder;
      return a.key.localeCompare(b.key);
    });

    return collected.map((item, idx) => ({
      ...item,
      rank: idx + 1
    }));
  }

  function filterCoreFrequentWords(items, chapterFilter = 'all', query = '') {
    if (!Array.isArray(items) || items.length === 0) return [];
    const trimmed = String(query || '').trim();
    const normalizedQuery = trimmed.toLowerCase();
    const normalizedArabic = stripArabicDiacritics(trimmed);

    return items.filter((item) => {
      if (chapterFilter && chapterFilter !== 'all' && item.groupId !== chapterFilter) {
        return false;
      }
      if (!trimmed) return true;
      if (String(item.meaning_bn || '').toLowerCase().includes(normalizedQuery)) return true;
      if (String(item.arabic || '').includes(trimmed)) return true;
      if (normalizedArabic && stripArabicDiacritics(item.arabic || '').includes(normalizedArabic)) return true;
      if (String(item.occurrenceCount).includes(normalizedQuery)) return true;
      return false;
    });
  }

  function summarizeCoreFrequentWords(items, hierarchy) {
    const groups = (hierarchy && hierarchy.groups) || [];
    const totalTokens = Number(hierarchy && hierarchy.totalTokens) || 77429;
    const groupMeta = new Map();
    for (const g of groups) {
      if (g && g.id) groupMeta.set(g.id, g);
    }
    const buckets = new Map();
    for (const id of CORE_FREQUENT_GROUP_IDS) buckets.set(id, { count: 0, occ: 0 });

    let totalOccurrences = 0;
    let chapters1To4Words = 0;
    for (const item of items || []) {
      const b = buckets.get(item.groupId);
      if (b) {
        b.count += 1;
        b.occ += item.occurrenceCount;
      }
      totalOccurrences += item.occurrenceCount;
      if (item.chapterOrder <= 4) chapters1To4Words += 1;
    }

    const chapters = CORE_FREQUENT_GROUP_IDS.map((id, idx) => {
      const meta = groupMeta.get(id);
      const b = buckets.get(id);
      return {
        groupId: id,
        order: meta ? Number(meta.order) : idx + 1,
        titleBn: meta ? meta.titleBn : `অধ্যায় ${toBnDigits(idx + 1)}`,
        rangeLabelBn: (meta && meta.rangeLabelBn) || '',
        wordCount: b.count,
        occurrenceSum: b.occ
      };
    });

    const coveragePct = totalTokens > 0
      ? Number(((totalOccurrences / totalTokens) * 100).toFixed(1))
      : 0;

    return {
      totalWords: (items || []).length,
      chapters1To4Words,
      totalOccurrences,
      coveragePct,
      chapters
    };
  }

  global.McqFrequencyGroups = {
    MCQ_PASS_PREFIX,
    MCQ_MAIN_GROUP_CONFIGS,
    CORE_FREQUENT_GROUP_IDS,
    toBnDigits,
    isMcqPassKey,
    toMcqPassStorageKey,
    fromMcqPassStorageKey,
    smartSliceIntoLists,
    loadHierarchy,
    findGroup,
    findSubGroup,
    findList,
    isWordLearned,
    computeSubGroupListStates,
    computeSubGroupSummary,
    computeGroupSummary,
    computeOverallSummary,
    buildMiniStepsForLists,
    computeProgressiveHorizon,
    didPassMcqListExam,
    findRecommendedResumeList,
    buildDistractorPoolForList,
    getCoreFrequentWords,
    filterCoreFrequentWords,
    summarizeCoreFrequentWords
  };
})(window);
