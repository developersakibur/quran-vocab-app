import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCTION_APP_BASE_URL,
  TOTAL_QURAN_WORDS,
  SHARE_CARD_TEMPLATES,
  toBnDigits,
  formatCountBn,
  isValidWordKey,
  parseWordKeyFromLocation,
  buildWordShareUrl,
  computeWordCoveragePercent,
  formatCoveragePercentBn,
  normalizeBengaliUnicode,
  buildWordShareCaption,
  buildWordShareFilename,
  resolveShareTemplateId,
} from './word-share-card';

describe('word-share-card pure utilities', () => {
  it('converts ASCII digits to Bengali digits accurately', () => {
    assert.equal(toBnDigits(2699), '২৬৯৯');
    assert.equal(toBnDigits('0.001%'), '০.০০১%');
    assert.equal(formatCountBn(2699), '২,৬৯৯');
    assert.equal(formatCountBn(0), '১');
  });

  it('validates Quran word keys strictly', () => {
    assert.equal(isValidWordKey('1:1:2'), true);
    assert.equal(isValidWordKey('114:6:3'), true);
    assert.equal(isValidWordKey('2:282:120'), true);
    assert.equal(isValidWordKey('0:1:1'), false);
    assert.equal(isValidWordKey('115:1:1'), false);
    assert.equal(isValidWordKey('1:0:1'), false);
    assert.equal(isValidWordKey('1:1:0'), false);
    assert.equal(isValidWordKey('1:1'), false);
    assert.equal(isValidWordKey('surah=1'), false);
    assert.equal(isValidWordKey(null), false);
  });

  it('parses deep-link word keys from query params (including fbclid) and hash', () => {
    assert.deepEqual(
      parseWordKeyFromLocation('?word=1:1:2', ''),
      { wordKey: '1:1:2', source: 'query' }
    );
    assert.deepEqual(
      parseWordKeyFromLocation('?word=2:255:1&fbclid=IwAR3xyz987&utm_source=fb', ''),
      { wordKey: '2:255:1', source: 'query' }
    );
    assert.deepEqual(
      parseWordKeyFromLocation('', '#word=112:1:2'),
      { wordKey: '112:1:2', source: 'hash' }
    );
    // Hash route takes precedence over stale query parameter
    assert.deepEqual(
      parseWordKeyFromLocation('?word=1:1:2', '#surah=2'),
      { wordKey: null, source: null }
    );
    assert.deepEqual(
      parseWordKeyFromLocation('?word=1:1:2', '#word=1:2:1'),
      { wordKey: '1:2:1', source: 'hash' }
    );
    // Invalid surah rejected gracefully
    assert.deepEqual(
      parseWordKeyFromLocation('?word=999:1:1', ''),
      { wordKey: null, source: null }
    );
  });

  it('builds canonical production deep-link URLs and safe PNG filenames', () => {
    assert.equal(
      buildWordShareUrl('1:1:2'),
      `${PRODUCTION_APP_BASE_URL}?word=1:1:2`
    );
    assert.equal(
      buildWordShareUrl('invalid'),
      PRODUCTION_APP_BASE_URL
    );
    assert.equal(buildWordShareFilename('1:1:2'), 'quran-word-1-1-2.png');
    assert.equal(buildWordShareFilename('bad'), 'quran-word-word.png');
  });

  it('calculates adaptive coverage percentages without collapsing rare words to zero', () => {
    // High-frequency word (e.g. Allah: ~2699 occurrences)
    const highPct = computeWordCoveragePercent(2699, TOTAL_QURAN_WORDS);
    assert.ok(highPct > 3.4 && highPct < 3.55);
    assert.equal(formatCoveragePercentBn(highPct), '৩.৪৯');

    // Medium-frequency word (e.g. 57 occurrences)
    const medPct = computeWordCoveragePercent(57, TOTAL_QURAN_WORDS);
    assert.equal(formatCoveragePercentBn(medPct), '০.০৭');

    // Hapax legomenon (1 occurrence) must show 3 decimals, never 0%
    const rarePct = computeWordCoveragePercent(1, TOTAL_QURAN_WORDS);
    assert.equal(formatCoveragePercentBn(rarePct), '০.০০১');
  });

  it('builds curiosity-hook caption with exact stats & deep-link and never leaks meaning', () => {
    const caption = buildWordShareCaption({
      wordKey: '1:1:2',
      arabic: 'ٱللَّهِ',
      surah: 1,
      ayah: 1,
      position: 2,
      surahNameBn: 'আল-ফাতিহা',
      occurrences: 2699,
      totalQuranWords: TOTAL_QURAN_WORDS,
    });

    assert.ok(caption.includes('আপনি কি এই শব্দের অর্থ জানেন?'));
    assert.ok(caption.includes('পবিত্র কুরআনে এই শব্দটি ২,৬৯৯ বার এসেছে।'));
    assert.ok(caption.includes('এই একটি শব্দ শিখলেই কুরআনের ৩.৪৯% অংশ বুঝতে পারবেন।'));
    assert.ok(caption.includes('জানা থাকলে কমেন্টে লিখুন, আর সঠিক অর্থ ও উচ্চারণ মিলিয়ে নিতে নিচের লিংকে ট্যাপ করুন:'));
    assert.ok(caption.includes('https://developersakibur.github.io/quran-vocab-app/?word=1:1:2'));
    assert.equal(caption.includes('আল্লাহর'), false);
  });

  it('provides 6 distinct templates and resolves unknown template IDs safely', () => {
    assert.equal(SHARE_CARD_TEMPLATES.length, 6);
    assert.deepEqual(
      SHARE_CARD_TEMPLATES.map((t) => t.id),
      ['emerald', 'cream', 'midnight', 'burgundy', 'teal', 'sand']
    );
    assert.equal(resolveShareTemplateId('cream'), 'cream');
    assert.equal(resolveShareTemplateId('midnight'), 'midnight');
    assert.equal(resolveShareTemplateId('burgundy'), 'burgundy');
    assert.equal(resolveShareTemplateId('teal'), 'teal');
    assert.equal(resolveShareTemplateId('sand'), 'sand');
    assert.equal(resolveShareTemplateId('unknown'), 'emerald');
    assert.equal(resolveShareTemplateId(null), 'emerald');
  });

  it('normalizes decomposed Bengali nuktas, split vowel signs, and invisible artifacts to clean precomposed Unicode', () => {
    // Decomposed য+় (\u09AF\u09BC), ড+় (\u09A1\u09BC), ঢ+় (\u09A2\u09BC)
    const decomposed = 'আ\u09AF\u09BCাত প\u09A1\u09BCা আষা\u09A2\u09BC ক\u09C7\u09BEরআন ম\u09C7\u09D7ন\u200B\uFEFF';
    const normalized = normalizeBengaliUnicode(decomposed);

    assert.equal(normalized.includes('\u09BC'), false);
    assert.equal(normalized.includes('\u200B'), false);
    assert.equal(normalized.includes('\uFEFF'), false);
    assert.equal(normalized, 'আ\u09DFাত প\u09DCা আষা\u09DD ক\u09CBরআন ম\u09CCন');

    const caption = buildWordShareCaption({
      wordKey: '1:1:1',
      arabic: 'بِسْمِ',
      surah: 1,
      ayah: 1,
      position: 1,
      surahNameBn: 'আল-ফাতিহা',
      occurrences: 22,
    });
    assert.equal(caption, normalizeBengaliUnicode(caption));
    assert.equal(caption.includes('\u09BC'), false);
  });
});
