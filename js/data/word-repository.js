/* ============================================================
   WORD REPOSITORY
   Single entry point for reading Quran static data (surah list,
   surah content/words). UI code should call these functions
   instead of calling fetch() on data/*.json directly — this
   keeps the data-access path in one place (and adds a simple
   in-memory cache so the same file isn't fetched twice in one
   page session).

   Note: this does NOT replace the Service Worker's own disk
   cache (sw.js) — that still makes the files available offline.
   This layer only avoids redundant fetches within a single page.
   ============================================================ */
(function (global) {
  let surahsMetaCache = null;
  const surahContentCache = {}; // { [surahNum]: parsedJson }

  async function getSurahsMeta() {
    if (surahsMetaCache) return surahsMetaCache;
    const res = await fetch('data/surahs-meta.json');
    if (!res.ok) throw new Error('surahs-meta.json লোড হয়নি (status ' + res.status + ')');
    surahsMetaCache = await res.json();
    return surahsMetaCache;
  }

  async function getSurahContent(surahNum) {
    if (surahContentCache[surahNum]) return surahContentCache[surahNum];
    const res = await fetch(`data/surah-content/${surahNum}.json`);
    if (!res.ok) throw new Error(`surah-content/${surahNum}.json লোড হয়নি (status ${res.status})`);
    const data = await res.json();
    surahContentCache[surahNum] = data;
    return data;
  }

  /** Flat list of {arabic, meaning_bn, key, root} for every word with a meaning, for one surah. */
  async function getWordsForSurah(surahNum) {
    const content = await getSurahContent(surahNum);
    const words = [];
    content.ayahs.forEach(ayah => {
      ayah.words.forEach(w => {
        if (w.meaning_bn) {
          words.push({ arabic: w.arabic, meaning_bn: w.meaning_bn, key: w.key, root: w.root });
        }
      });
    });
    return words;
  }

  global.WordRepository = { getSurahsMeta, getSurahContent, getWordsForSurah };
})(window);
