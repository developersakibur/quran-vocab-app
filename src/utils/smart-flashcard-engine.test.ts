import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isWordLearnedInQuiz,
  computeNextLearnedInQuiz,
  getFlashcardPriorityTier,
  selectSmartFlashcardBatch,
  summarizeLearnedWords,
  computeWeakWordTransition,
  filterAndSortLearnedWords,
  SMART_FLASHCARD_RATINGS,
  type WordProgressRecord,
  type WeakWordRecord,
} from './smart-flashcard-engine';

test('isWordLearnedInQuiz accepts learnedInQuiz and legacy records, respects explicit false demotion, and skips meta keys', () => {
  assert.equal(isWordLearnedInQuiz({ word_id: '1:1:1', learnedInQuiz: true }), true);
  assert.equal(isWordLearnedInQuiz({ word_id: '1:1:2', correctCount: 1 }), true);
  assert.equal(isWordLearnedInQuiz({ word_id: '1:1:3', repetitions: 2 }), true);
  assert.equal(isWordLearnedInQuiz({ word_id: '1:1:4', correctCount: 0, repetitions: 0, wrongCount: 1 }), false);
  // Explicitly demoted via Flashcard Hard/Forgot must return false even if historically answered correctly
  assert.equal(isWordLearnedInQuiz({ word_id: '1:1:5', learnedInQuiz: false, correctCount: 3, repetitions: 2 }), false);
  assert.equal(isWordLearnedInQuiz({ word_id: 'mcq_pass:g1:main:1', repetitions: 1, correctCount: 10 }), false);
  assert.equal(isWordLearnedInQuiz({ word_id: 'ayah_pass:1:1', repetitions: 1, correctCount: 4 }), false);
});

test('4-tier priority queue always surfaces Tier 1 (new) -> Tier 2 (hard) -> Tier 3 (medium) -> Tier 4 (easy)', () => {
  const progressMap: Record<string, WordProgressRecord> = {
    '1:1:1': { word_id: '1:1:1', learnedInQuiz: true, flashcardRating: 5, flashcardLastReviewed: 1000, flashcardReviewCount: 2 },
    '1:1:2': { word_id: '1:1:2', learnedInQuiz: true, flashcardRating: 3, flashcardLastReviewed: 2000, flashcardReviewCount: 1 },
    '1:1:3': { word_id: '1:1:3', learnedInQuiz: true, flashcardRating: 1, flashcardLastReviewed: 3000, flashcardReviewCount: 1 },
    '1:1:4': { word_id: '1:1:4', learnedInQuiz: true, learnedAt: 5000 }, // Never seen in flashcard
    '1:2:1': { word_id: '1:2:1', learnedInQuiz: true, learnedAt: 4000 }, // Older never-seen -> before 1:1:4
    '1:2:2': { word_id: '1:2:2', learnedInQuiz: true, flashcardRating: 1, flashcardLastReviewed: 1500, flashcardReviewCount: 2 }, // Older hard
    '1:2:3': { word_id: '1:2:3', learnedInQuiz: true, flashcardRating: 5, flashcardLastReviewed: 500, flashcardReviewCount: 3 }, // Older easy
  };

  const batch = selectSmartFlashcardBatch(progressMap, 10);
  assert.deepEqual(
    batch.map((r) => r.word_id),
    [
      '1:2:1', // Tier 1 (oldest new)
      '1:1:4', // Tier 1 (newer new)
      '1:2:2', // Tier 2 (oldest hard)
      '1:1:3', // Tier 2 (newer hard)
      '1:1:2', // Tier 3 (medium)
      '1:2:3', // Tier 4 (oldest easy)
      '1:1:1', // Tier 4 (newer easy)
    ]
  );

  const summary = summarizeLearnedWords(progressMap);
  assert.equal(summary.totalLearned, 7);
  assert.equal(summary.unreviewedNewCount, 2);
  assert.equal(summary.hardCount, 2);
  assert.equal(summary.mediumCount, 1);
  assert.equal(summary.easyCount, 2);
});

test('Smart 10-card rotation scales cleanly across 2,500 learned words so newly learned words appear first and easy words drop to the bottom', () => {
  const progressMap: Record<string, WordProgressRecord> = {};

  // 2,485 already-easy words + 15 brand-new learned words
  for (let i = 1; i <= 2485; i++) {
    const key = `2:${Math.ceil(i / 10)}:${((i - 1) % 10) + 1}`;
    progressMap[key] = {
      word_id: key,
      learnedInQuiz: true,
      learnedAt: i * 100,
      flashcardRating: 5,
      flashcardLastReviewed: 100000 + i * 10,
      flashcardReviewCount: 1,
    };
  }

  const newKeys: string[] = [];
  for (let j = 1; j <= 15; j++) {
    const key = `3:1:${j}`;
    newKeys.push(key);
    progressMap[key] = {
      word_id: key,
      learnedInQuiz: true,
      learnedAt: 900000 + j,
    };
  }

  // Batch 1 should pick the first 10 brand-new words
  const batch1 = selectSmartFlashcardBatch(progressMap, 10);
  assert.equal(batch1.length, 10);
  assert.deepEqual(batch1.map((b) => b.word_id), newKeys.slice(0, 10));

  // Simulate user rating all 10 as Easy (5) -> they move to Tier 4 bottom
  let now = 500000;
  for (const item of batch1) {
    item.flashcardRating = 5;
    item.flashcardLastReviewed = now++;
    item.flashcardReviewCount = 1;
  }

  // Batch 2 should pick remaining 5 new words + 5 oldest easy words (NOT the ones just rated!)
  const batch2 = selectSmartFlashcardBatch(progressMap, 10);
  assert.equal(batch2.length, 10);
  assert.deepEqual(batch2.slice(0, 5).map((b) => b.word_id), newKeys.slice(10, 15));
  for (const oldEasy of batch2.slice(5)) {
    assert.equal(getFlashcardPriorityTier(oldEasy), 4);
    assert.ok(!newKeys.includes(oldEasy.word_id));
  }
});

test('Weak Words & Learned Words state machine: flashcard hard demotes from Learned to Weak; weak MCQ correct re-graduates immediately', () => {
  const meta = {
    word_id: '1:1:1',
    arabic: 'بِسْمِ',
    meaning_bn: 'নামে',
    root: 'سمو',
    verse_key: '1:1',
  };

  // 1. Quiz wrong -> adds to weak words
  const t1 = computeWeakWordTransition(null, false, 'quiz', meta, 1000);
  assert.equal(t1.action, 'upsert');
  assert.equal(t1.record?.mistakeCount, 1);

  const existingWeak: WeakWordRecord = t1.record!;

  // 2. Flashcard Hard/Forgot -> moves word INTO weak words AND demotes out of Learned Words
  const tFcHardNew = computeWeakWordTransition(null, false, 'flashcard', meta, 2000);
  assert.equal(tFcHardNew.action, 'upsert');
  assert.equal(tFcHardNew.record?.mistakeCount, 1);

  const tFcHardExisting = computeWeakWordTransition(existingWeak, false, 'flashcard', meta, 2100);
  assert.equal(tFcHardExisting.action, 'upsert');
  assert.equal(tFcHardExisting.record?.mistakeCount, 2);

  // Flashcard Medium/Easy -> keeps weak words untouched and preserves Learned Words status
  assert.equal(computeWeakWordTransition(existingWeak, true, 'flashcard', meta, 2200).action, 'none');

  const learnedRec: WordProgressRecord = { word_id: '1:1:1', learnedInQuiz: true, correctCount: 2, repetitions: 2 };
  assert.equal(computeNextLearnedInQuiz(learnedRec, false, 'flashcard'), false);
  assert.equal(computeNextLearnedInQuiz(learnedRec, true, 'flashcard'), true);

  // 3. Regular quiz correct -> does NOT clear weak word (must be cleared inside Weak Words drill)
  assert.equal(computeWeakWordTransition(existingWeak, true, 'quiz', meta, 3000).action, 'none');

  // 4. Weak Words MCQ wrong -> increments mistakeCount and stays out of Learned Words
  const t4 = computeWeakWordTransition(existingWeak, false, 'weak', meta, 4000);
  assert.equal(t4.action, 'upsert');
  assert.equal(t4.record?.mistakeCount, 2);
  const demotedRec: WordProgressRecord = { word_id: '1:1:1', learnedInQuiz: false, correctCount: 2, repetitions: 0 };
  assert.equal(computeNextLearnedInQuiz(demotedRec, false, 'weak'), false);

  // 5. Weak Words MCQ correct -> immediately deletes from weak words AND returns word to Learned Words!
  const t5 = computeWeakWordTransition(t4.record!, true, 'weak', meta, 5000);
  assert.equal(t5.action, 'delete');
  assert.equal(computeNextLearnedInQuiz(demotedRec, true, 'weak'), true);
});

test('filterAndSortLearnedWords filters by Bengali/Arabic query and recall status accurately', () => {
  const items = [
    {
      word_id: '1:1:1',
      arabic: 'بِسْمِ',
      meaning_bn: 'নামে',
      verse_key: '1:1',
      progress: { word_id: '1:1:1', learnedInQuiz: true, lastReviewed: 1000 }, // new
    },
    {
      word_id: '1:1:2',
      arabic: 'ٱللَّهِ',
      meaning_bn: 'আল্লাহর',
      verse_key: '1:1',
      progress: { word_id: '1:1:2', learnedInQuiz: true, lastReviewed: 3000, flashcardRating: 1, flashcardLastReviewed: 3000, flashcardReviewCount: 1 }, // review
    },
    {
      word_id: '1:1:3',
      arabic: 'ٱلرَّحْمَٰنِ',
      meaning_bn: 'পরম করুণাময়',
      verse_key: '1:1',
      progress: { word_id: '1:1:3', learnedInQuiz: true, lastReviewed: 2000, flashcardRating: 5, flashcardLastReviewed: 2000, flashcardReviewCount: 2 }, // mastered
    },
  ];

  assert.deepEqual(
    filterAndSortLearnedWords(items, '', 'all').map((i) => i.word_id),
    ['1:1:2', '1:1:3', '1:1:1'] // sorted newest activity first
  );
  assert.deepEqual(
    filterAndSortLearnedWords(items, '', 'new').map((i) => i.word_id),
    ['1:1:1']
  );
  assert.deepEqual(
    filterAndSortLearnedWords(items, '', 'review').map((i) => i.word_id),
    ['1:1:2']
  );
  assert.deepEqual(
    filterAndSortLearnedWords(items, '', 'mastered').map((i) => i.word_id),
    ['1:1:3']
  );
  assert.deepEqual(
    filterAndSortLearnedWords(items, 'করুণাময়', 'all').map((i) => i.word_id),
    ['1:1:3']
  );
  assert.equal(SMART_FLASHCARD_RATINGS.length, 3);
});
