import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSavedVocabFlashcardDeck,
  FlashcardSessionState,
  KNOWLEDGE_RATINGS
} from './flashcard-deck';

test('buildSavedVocabFlashcardDeck normalizes bookmarked words into flashcard items', () => {
  const bookmarks = [
    {
      word_id: '1:1:1',
      arabic: 'بِسْمِ',
      meaning_bn: 'নামে',
      root: 'سمو',
      verse_key: '1:1'
    },
    {
      word_id: '1:2:1',
      arabic: 'ٱلْحَمْدُ',
      meaning_bn: 'সকল প্রশংসা',
      root: 'حمد'
    }
  ];

  const deck = buildSavedVocabFlashcardDeck(bookmarks);
  assert.equal(deck.length, 2);
  assert.equal(deck[0].key, '1:1:1');
  assert.equal(deck[0].surah, 1);
  assert.equal(deck[0].ayah, 1);
  assert.equal(deck[0].isSavedVocab, true);
  assert.equal(deck[1].verse_key, '1:2');
});

test('FlashcardSessionState handles flip-to-reveal and 4-level knowledge ratings accurately', () => {
  const deck = buildSavedVocabFlashcardDeck([
    { word_id: '1:1:1', arabic: 'بِسْمِ', meaning_bn: 'নামে', root: 'سمو', verse_key: '1:1' },
    { word_id: '1:1:3', arabic: 'ٱلرَّحْمَٰنِ', meaning_bn: 'পরম করুণাময়', root: 'رحم', verse_key: '1:1' },
    { word_id: '1:1:4', arabic: 'ٱلرَّحِيمِ', meaning_bn: 'অসীম দয়ালু', root: 'رحم', verse_key: '1:1' }
  ]);

  const session = new FlashcardSessionState(deck);
  assert.equal(session.getTotalCount(), 3);
  assert.equal(session.isFlipped(), false);

  // Flip first card and rate 'again' (grade 1)
  session.toggleFlip();
  assert.equal(session.isFlipped(), true);
  const r1 = session.rateCurrentCard('again');
  assert.equal(r1?.grade, 1);
  assert.equal(session.isFlipped(), false); // resets flip for next card

  // Flip second card and rate 'good' (grade 4)
  session.reveal();
  assert.equal(session.isFlipped(), true);
  const r2 = session.rateCurrentCard('good');
  assert.equal(r2?.grade, 4);

  // Flip third card and rate 'easy' (grade 5)
  session.toggleFlip();
  const r3 = session.rateCurrentCard('easy');
  assert.equal(r3?.grade, 5);

  assert.equal(session.isFinished(), true);
  const stats = session.getStats();
  assert.equal(stats.completed, 3);
  assert.equal(stats.passedCount, 2);
  assert.equal(stats.counts.again, 1);
  assert.equal(stats.counts.good, 1);
  assert.equal(stats.counts.easy, 1);
  assert.equal(stats.missedCards.length, 1);
  assert.equal(stats.missedCards[0].key, '1:1:1');
  assert.equal(stats.accuracyPercent, 67);
});

test('KNOWLEDGE_RATINGS exposes 4 levels mapped to SM-2 grades', () => {
  assert.equal(KNOWLEDGE_RATINGS.length, 4);
  assert.deepEqual(
    KNOWLEDGE_RATINGS.map((r) => [r.id, r.grade]),
    [
      ['again', 1],
      ['hard', 3],
      ['good', 4],
      ['easy', 5]
    ]
  );
});
