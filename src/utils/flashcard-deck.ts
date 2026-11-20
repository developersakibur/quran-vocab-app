export interface RawBookmarkItem {
  word_id: string;
  arabic: string;
  meaning_bn: string;
  root?: string;
  verse_key?: string;
  addedAt?: number;
  ayah_arabic?: string;
  ayah_translation_bn?: string;
}

export interface FlashcardItem {
  key: string;
  arabic: string;
  meaning_bn: string;
  root: string;
  verse_key: string;
  surah: number;
  ayah: number;
  ayah_arabic?: string;
  ayah_translation_bn?: string;
  isSavedVocab: boolean;
}

export type RatingId = 'again' | 'hard' | 'good' | 'easy';

export interface KnowledgeRatingOption {
  id: RatingId;
  grade: number;
  labelBn: string;
  subLabelBn: string;
  passed: boolean;
}

export const KNOWLEDGE_RATINGS: KnowledgeRatingOption[] = [
  {
    id: 'again',
    grade: 1,
    labelBn: 'আবার',
    subLabelBn: 'মনে নেই • ১ দিন',
    passed: false
  },
  {
    id: 'hard',
    grade: 3,
    labelBn: 'কঠিন',
    subLabelBn: 'কষ্টে মনে পড়েছে • ২ দিন',
    passed: true
  },
  {
    id: 'good',
    grade: 4,
    labelBn: 'ভালো',
    subLabelBn: 'পেরেছি • ৪ দিন',
    passed: true
  },
  {
    id: 'easy',
    grade: 5,
    labelBn: 'সহজ',
    subLabelBn: 'খুব সহজ • ৭ দিন',
    passed: true
  }
];

export function buildSavedVocabFlashcardDeck(
  bookmarks: RawBookmarkItem[]
): FlashcardItem[] {
  if (!Array.isArray(bookmarks) || bookmarks.length === 0) {
    return [];
  }

  return bookmarks
    .filter((bm) => bm && Boolean(bm.word_id) && Boolean(bm.arabic))
    .map((bm) => {
      const refStr = bm.verse_key || bm.word_id || '1:1:1';
      const parts = refStr.split(':').map((n) => parseInt(n, 10));
      const surah = parts[0] || 1;
      const ayah = parts[1] || 1;

      return {
        key: bm.word_id,
        arabic: bm.arabic,
        meaning_bn: bm.meaning_bn || '—',
        root: bm.root || '',
        verse_key: bm.verse_key || `${surah}:${ayah}`,
        surah,
        ayah,
        ayah_arabic: bm.ayah_arabic || '',
        ayah_translation_bn: bm.ayah_translation_bn || '',
        isSavedVocab: true
      };
    });
}

export interface SessionStats {
  total: number;
  completed: number;
  passedCount: number;
  counts: Record<RatingId, number>;
  missedCards: FlashcardItem[];
  progressPercent: number;
  accuracyPercent: number;
}

export class FlashcardSessionState {
  private cards: FlashcardItem[];
  private currentIndex = 0;
  private flipped = false;
  private counts: Record<RatingId, number> = {
    again: 0,
    hard: 0,
    good: 0,
    easy: 0
  };
  private missedCards: FlashcardItem[] = [];

  constructor(cards: FlashcardItem[]) {
    this.cards = Array.isArray(cards) ? cards.slice() : [];
  }

  getCurrentCard(): FlashcardItem | null {
    if (this.currentIndex < 0 || this.currentIndex >= this.cards.length) {
      return null;
    }
    return this.cards[this.currentIndex];
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  getTotalCount(): number {
    return this.cards.length;
  }

  isFlipped(): boolean {
    return this.flipped;
  }

  toggleFlip(): boolean {
    if (this.isFinished()) return false;
    this.flipped = !this.flipped;
    return this.flipped;
  }

  reveal(): void {
    if (!this.isFinished()) {
      this.flipped = true;
    }
  }

  isFinished(): boolean {
    return this.currentIndex >= this.cards.length;
  }

  rateCurrentCard(ratingId: RatingId): KnowledgeRatingOption | null {
    const current = this.getCurrentCard();
    if (!current) return null;

    const rating = KNOWLEDGE_RATINGS.find((r) => r.id === ratingId);
    if (!rating) return null;

    this.counts[ratingId] = (this.counts[ratingId] || 0) + 1;
    if (!rating.passed) {
      this.missedCards.push(current);
    }

    this.currentIndex += 1;
    this.flipped = false;
    return rating;
  }

  getStats(): SessionStats {
    const total = this.cards.length;
    const completed = Math.min(this.currentIndex, total);
    const passedCount = this.counts.hard + this.counts.good + this.counts.easy;
    const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;
    const accuracyPercent = completed > 0 ? Math.round((passedCount / completed) * 100) : 0;

    return {
      total,
      completed,
      passedCount,
      counts: { ...this.counts },
      missedCards: this.missedCards.slice(),
      progressPercent,
      accuracyPercent
    };
  }
}
