/* ============================================================
   DISTRACTOR GENERATOR
   Priority order (per product spec):
     1. Same-root word within the same Surah
     2. Any other word within the same Surah (random)
   (Cross-surah lookups are skipped for now since only the
   current Surah's word data is loaded into memory — keeps
   pages lightweight. Root/exact-word lookup files are still
   used to find same-root matches inside the loaded word set.)
   ============================================================ */
(function (global) {

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /**
   * @param {Object} correctWord - {arabic, meaning_bn, key, root}
   * @param {Array}  allWords    - full word list of the current surah
   * @returns {Array<string>} 3 distractor meanings
   */
  function buildDistractors(correctWord, allWords) {
    const seenMeanings = new Set([correctWord.meaning_bn]);
    const distractors = [];

    // Priority 1: same root, different meaning, within this surah
    if (correctWord.root) {
      const sameRootPool = shuffle(
        allWords.filter(w => w.root === correctWord.root && !seenMeanings.has(w.meaning_bn))
      );
      for (const w of sameRootPool) {
        if (distractors.length >= 3) break;
        distractors.push(w.meaning_bn);
        seenMeanings.add(w.meaning_bn);
      }
    }

    // Priority 2: fill remaining slots with random other words in this surah
    if (distractors.length < 3) {
      const remainingPool = shuffle(
        allWords.filter(w => !seenMeanings.has(w.meaning_bn))
      );
      for (const w of remainingPool) {
        if (distractors.length >= 3) break;
        distractors.push(w.meaning_bn);
        seenMeanings.add(w.meaning_bn);
      }
    }

    return distractors;
  }

  global.DistractorGenerator = { buildDistractors, shuffle };
})(window);
