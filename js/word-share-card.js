/* ============================================================
   WORD SOCIAL SHARE CARD GENERATOR & PREVIEW SHEET
   - High-DPI 1080x1080 (1:1) HTML5 Canvas 2D renderer
   - 6 selectable Islamic manuscript templates (Emerald, Cream, Midnight, Burgundy, Teal, Sand)
   - Curiosity-hook layout (Bengali meaning intentionally omitted)
   - Native mobile Web Share API (files + caption) with desktop fallback
   ============================================================ */
(function (global) {
  'use strict';

  const PRODUCTION_APP_BASE_URL = 'https://developersakibur.github.io/quran-vocab-app/';
  const DEFAULT_TOTAL_QURAN_WORDS = 77429;
  const TEMPLATE_STORAGE_KEY = 'quran-word-share-template-v1';
  const CARD_SIZE = 1080;

  const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

  const TEMPLATES = [
    {
      id: 'emerald',
      labelBn: 'এমেরাল্ড ও গোল্ড',
      shortLabelBn: 'এমেরাল্ড',
      swatchBg: 'linear-gradient(135deg, #0F5A3B 0%, #062418 100%)',
      swatchBorder: '#D9B45A',
      swatchAccent: '#F5CF6B',
      palette: {
        bgStops: [
          [0, '#125F3E'],
          [0.52, '#0A3B26'],
          [1, '#051F14'],
        ],
        glowColor: 'rgba(245, 207, 107, 0.14)',
        outerBorder: 'rgba(217, 180, 90, 0.72)',
        innerBorder: 'rgba(217, 180, 90, 0.34)',
        ornament: '#D9B45A',
        promptColor: '#F3D68A',
        dividerColor: 'rgba(217, 180, 90, 0.45)',
        arabicColor: '#FFFBF0',
        arabicShadow: 'rgba(2, 16, 10, 0.45)',
        refColor: '#BFE2CE',
        panelBg: 'rgba(255, 255, 255, 0.068)',
        panelBorder: 'rgba(217, 180, 90, 0.36)',
        panelDivider: 'rgba(217, 180, 90, 0.24)',
        statText: '#F1F7F4',
        statHighlight: '#F7D26D',
        ctaBg: '#DFBA5E',
        ctaText: '#062417',
        brandColor: 'rgba(218, 238, 227, 0.74)',
      },
    },
    {
      id: 'cream',
      labelBn: 'ক্রিম ও সবুজ',
      shortLabelBn: 'ক্রিম',
      swatchBg: 'linear-gradient(135deg, #FCF9F2 0%, #EFE6D5 100%)',
      swatchBorder: '#0D5C3A',
      swatchAccent: '#0D5C3A',
      palette: {
        bgStops: [
          [0, '#FDFBF5'],
          [0.6, '#F7F1E4'],
          [1, '#EDE4D1'],
        ],
        glowColor: 'rgba(13, 92, 58, 0.065)',
        outerBorder: 'rgba(13, 92, 58, 0.72)',
        innerBorder: 'rgba(186, 148, 61, 0.46)',
        ornament: '#0D5C3A',
        promptColor: '#0D5C3A',
        dividerColor: 'rgba(186, 148, 61, 0.55)',
        arabicColor: '#073822',
        arabicShadow: 'rgba(7, 56, 34, 0.08)',
        refColor: '#4E6559',
        panelBg: 'rgba(255, 255, 255, 0.88)',
        panelBorder: 'rgba(13, 92, 58, 0.22)',
        panelDivider: 'rgba(13, 92, 58, 0.14)',
        statText: '#1D2F27',
        statHighlight: '#0B5A38',
        ctaBg: '#0D5C3A',
        ctaText: '#FFFDF8',
        brandColor: '#566A60',
      },
    },
    {
      id: 'midnight',
      labelBn: 'মিডনাইট গোল্ড',
      shortLabelBn: 'মিডনাইট',
      swatchBg: 'linear-gradient(135deg, #172531 0%, #0A1117 100%)',
      swatchBorder: '#E2C174',
      swatchAccent: '#F2CF78',
      palette: {
        bgStops: [
          [0, '#1A2A38'],
          [0.54, '#101B24'],
          [1, '#080E14'],
        ],
        glowColor: 'rgba(226, 193, 116, 0.13)',
        outerBorder: 'rgba(226, 193, 116, 0.68)',
        innerBorder: 'rgba(226, 193, 116, 0.28)',
        ornament: '#E2C174',
        promptColor: '#EBD08A',
        dividerColor: 'rgba(226, 193, 116, 0.42)',
        arabicColor: '#FAF7F0',
        arabicShadow: 'rgba(0, 0, 0, 0.52)',
        refColor: '#A9BCCB',
        panelBg: 'rgba(255, 255, 255, 0.055)',
        panelBorder: 'rgba(226, 193, 116, 0.30)',
        panelDivider: 'rgba(226, 193, 116, 0.20)',
        statText: '#E8EFF5',
        statHighlight: '#F4D27B',
        ctaBg: '#E2C174',
        ctaText: '#0B131A',
        brandColor: 'rgba(191, 208, 222, 0.72)',
      },
    },
    {
      id: 'burgundy',
      labelBn: 'রয়েল মেরুন ও গোল্ড',
      shortLabelBn: 'মেরুন',
      swatchBg: 'linear-gradient(135deg, #561728 0%, #240810 100%)',
      swatchBorder: '#E6C275',
      swatchAccent: '#F3D283',
      palette: {
        bgStops: [
          [0, '#561728'],
          [0.54, '#330C17'],
          [1, '#1A050B'],
        ],
        glowColor: 'rgba(230, 194, 117, 0.14)',
        outerBorder: 'rgba(230, 194, 117, 0.72)',
        innerBorder: 'rgba(230, 194, 117, 0.32)',
        ornament: '#E6C275',
        promptColor: '#F3D792',
        dividerColor: 'rgba(230, 194, 117, 0.46)',
        arabicColor: '#FFF9EE',
        arabicShadow: 'rgba(16, 2, 6, 0.50)',
        refColor: '#EBCBD3',
        panelBg: 'rgba(255, 255, 255, 0.068)',
        panelBorder: 'rgba(230, 194, 117, 0.34)',
        panelDivider: 'rgba(230, 194, 117, 0.22)',
        statText: '#FBF2F4',
        statHighlight: '#F5D37E',
        ctaBg: '#E6C275',
        ctaText: '#1E060D',
        brandColor: 'rgba(240, 211, 218, 0.76)',
      },
    },
    {
      id: 'teal',
      labelBn: 'ময়ূরনীল ও গোল্ড',
      shortLabelBn: 'ময়ূরনীল',
      swatchBg: 'linear-gradient(135deg, #0F5566 0%, #052029 100%)',
      swatchBorder: '#E6C067',
      swatchAccent: '#F4CE74',
      palette: {
        bgStops: [
          [0, '#0F5566'],
          [0.54, '#083440'],
          [1, '#041B23'],
        ],
        glowColor: 'rgba(242, 202, 110, 0.14)',
        outerBorder: 'rgba(230, 192, 103, 0.72)',
        innerBorder: 'rgba(230, 192, 103, 0.32)',
        ornament: '#E6C067',
        promptColor: '#F4D588',
        dividerColor: 'rgba(230, 192, 103, 0.45)',
        arabicColor: '#F8FDFF',
        arabicShadow: 'rgba(2, 16, 22, 0.48)',
        refColor: '#B9E1EA',
        panelBg: 'rgba(255, 255, 255, 0.068)',
        panelBorder: 'rgba(230, 192, 103, 0.34)',
        panelDivider: 'rgba(230, 192, 103, 0.22)',
        statText: '#EEF8FA',
        statHighlight: '#F5D074',
        ctaBg: '#E6C067',
        ctaText: '#041B23',
        brandColor: 'rgba(195, 230, 238, 0.75)',
      },
    },
    {
      id: 'sand',
      labelBn: 'সোনালি বালি ও ব্রোঞ্জ',
      shortLabelBn: 'স্যান্ড',
      swatchBg: 'linear-gradient(135deg, #FCF6E9 0%, #E5D0AA 100%)',
      swatchBorder: '#7D4718',
      swatchAccent: '#4B2B14',
      palette: {
        bgStops: [
          [0, '#FCF6E9'],
          [0.58, '#F2E4C9'],
          [1, '#E5D0AA'],
        ],
        glowColor: 'rgba(156, 90, 27, 0.08)',
        outerBorder: 'rgba(125, 71, 24, 0.70)',
        innerBorder: 'rgba(156, 90, 27, 0.42)',
        ornament: '#8A4E1A',
        promptColor: '#7A4213',
        dividerColor: 'rgba(156, 90, 27, 0.50)',
        arabicColor: '#3D2412',
        arabicShadow: 'rgba(61, 36, 18, 0.10)',
        refColor: '#6E4E34',
        panelBg: 'rgba(255, 252, 245, 0.86)',
        panelBorder: 'rgba(125, 71, 24, 0.24)',
        panelDivider: 'rgba(125, 71, 24, 0.16)',
        statText: '#3A2618',
        statHighlight: '#8D4B12',
        ctaBg: '#4B2B14',
        ctaText: '#FFFBF2',
        brandColor: '#6D523B',
      },
    },
  ];

  function toBnDigits(value) {
    return String(value).replace(/\d/g, (d) => BN_DIGITS[Number(d)] || d);
  }

  function formatCountBn(count) {
    const safe = Number.isFinite(count) ? Math.max(1, Math.round(count)) : 1;
    return toBnDigits(safe.toLocaleString('en-US'));
  }

  function isValidWordKey(raw) {
    if (typeof raw !== 'string') return false;
    const trimmed = raw.trim();
    const match = /^(\d{1,3}):(\d{1,3}):(\d{1,3})$/.exec(trimmed);
    if (!match) return false;
    const surah = Number(match[1]);
    const ayah = Number(match[2]);
    const pos = Number(match[3]);
    return surah >= 1 && surah <= 114 && ayah >= 1 && ayah <= 286 && pos >= 1 && pos <= 200;
  }

  function parseWordKeyFromLocation(search, hash) {
    const cleanHash = String(hash || '').trim();
    if (cleanHash.startsWith('#word=')) {
      let rawHashVal = '';
      try {
        rawHashVal = decodeURIComponent(cleanHash.slice('#word='.length).split('&')[0] || '').trim();
      } catch (_err) {
        rawHashVal = cleanHash.slice('#word='.length).split('&')[0].trim();
      }
      if (isValidWordKey(rawHashVal)) {
        return { wordKey: rawHashVal, source: 'hash' };
      }
    }

    if (!cleanHash || cleanHash === '#') {
      const cleanSearch = String(search || '').trim();
      if (cleanSearch) {
        const params = new URLSearchParams(cleanSearch.startsWith('?') ? cleanSearch.slice(1) : cleanSearch);
        const rawQueryVal = (params.get('word') || '').trim();
        if (isValidWordKey(rawQueryVal)) {
          return { wordKey: rawQueryVal, source: 'query' };
        }
      }
    }

    return { wordKey: null, source: null };
  }

  function buildWordShareUrl(wordKey, baseUrl) {
    const root = baseUrl || PRODUCTION_APP_BASE_URL;
    const normalizedBase = root.endsWith('/') ? root : root + '/';
    const cleanKey = String(wordKey || '').trim();
    if (!isValidWordKey(cleanKey)) return normalizedBase;
    return normalizedBase + '?word=' + cleanKey;
  }

  function getTotalQuranWords() {
    if (Array.isArray(global.SURAHS_META) && global.SURAHS_META.length > 0) {
      let sum = 0;
      for (let i = 0; i < global.SURAHS_META.length; i += 1) {
        const w = Number(global.SURAHS_META[i].total_words);
        if (Number.isFinite(w) && w > 0) sum += w;
      }
      if (sum > 70000) return sum;
    }
    return DEFAULT_TOTAL_QURAN_WORDS;
  }

  function computeWordCoveragePercent(occurrences, totalQuranWords) {
    const safeCount = Number.isFinite(occurrences) && occurrences > 0 ? occurrences : 1;
    const safeTotal = Number.isFinite(totalQuranWords) && totalQuranWords > 0
      ? totalQuranWords
      : getTotalQuranWords();
    const pct = (safeCount / safeTotal) * 100;
    return Math.min(100, Math.max(0, pct));
  }

  function formatCoveragePercentBn(percent) {
    const safe = Number.isFinite(percent) && percent > 0 ? percent : 0.001;
    const formatted = safe >= 0.01 ? safe.toFixed(2) : Math.max(0.001, safe).toFixed(3);
    return toBnDigits(formatted);
  }

  function normalizeBengaliUnicode(input) {
    const raw = String(input == null ? '' : input);
    if (!raw) return '';
    const nfc = typeof raw.normalize === 'function' ? raw.normalize('NFC') : raw;
    return nfc
      .replace(/\u09A1\u09BC/g, '\u09DC')
      .replace(/\u09A2\u09BC/g, '\u09DD')
      .replace(/\u09AF\u09BC/g, '\u09DF')
      .replace(/\u09C7\u09BE/g, '\u09CB')
      .replace(/\u09C7\u09D7/g, '\u09CC')
      .replace(/[\u200B\u200E\u200F\uFEFF]/g, '')
      .replace(/\r\n?/g, '\n');
  }

  function buildWordShareCaption(payload, baseUrl) {
    const countBn = formatCountBn(payload.occurrences);
    const pct = computeWordCoveragePercent(payload.occurrences, payload.totalQuranWords);
    const pctBn = formatCoveragePercentBn(pct);
    const shareUrl = buildWordShareUrl(payload.wordKey, baseUrl);

    return normalizeBengaliUnicode(
      [
        'আপনি কি এই শব্দের অর্থ জানেন?',
        '',
        'পবিত্র কুরআনে এই শব্দটি ' + countBn + ' বার এসেছে।',
        'এই একটি শব্দ শিখলেই কুরআনের ' + pctBn + '% অংশ বুঝতে পারবেন।',
        '',
        'জানা থাকলে কমেন্টে লিখুন, আর সঠিক অর্থ ও উচ্চারণ মিলিয়ে নিতে নিচের লিংকে ট্যাপ করুন:',
        shareUrl,
      ].join('\n')
    );
  }

  function buildWordShareFilename(wordKey) {
    const safeKey = isValidWordKey(wordKey) ? wordKey.replace(/:/g, '-') : 'word';
    return 'quran-word-' + safeKey + '.png';
  }

  function resolveShareTemplateId(raw) {
    if (
      raw === 'emerald'
      || raw === 'cream'
      || raw === 'midnight'
      || raw === 'burgundy'
      || raw === 'teal'
      || raw === 'sand'
    ) {
      return raw;
    }
    return 'emerald';
  }

  function getTemplateById(templateId) {
    const id = resolveShareTemplateId(templateId);
    return TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
  }

  function loadSavedTemplateId() {
    try {
      return resolveShareTemplateId(localStorage.getItem(TEMPLATE_STORAGE_KEY));
    } catch (_err) {
      return 'emerald';
    }
  }

  function saveTemplateId(templateId) {
    try {
      localStorage.setItem(TEMPLATE_STORAGE_KEY, resolveShareTemplateId(templateId));
    } catch (_err) {
      // Ignore storage quota errors
    }
  }

  /* ------------------------------------------------------------
     CANVAS 2D DRAWING HELPERS
     ------------------------------------------------------------ */

  function drawRoundedRectPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function drawIslamicCornerStar(ctx, cx, cy, outerR, color) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.6;

    // 8-point Rub el Hizb geometric star (two rotated squares)
    const size = outerR * 1.24;
    ctx.globalAlpha = 0.72;
    ctx.strokeRect(-size / 2, -size / 2, size, size);
    ctx.save();
    ctx.rotate(Math.PI / 4);
    ctx.strokeRect(-size / 2, -size / 2, size, size);
    ctx.restore();

    // Inner jewel dot
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(0, 0, outerR * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawOrnamentalDivider(ctx, cx, y, halfWidth, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.8;

    ctx.beginPath();
    ctx.moveTo(cx - halfWidth, y);
    ctx.lineTo(cx - 18, y);
    ctx.moveTo(cx + 18, y);
    ctx.lineTo(cx + halfWidth, y);
    ctx.stroke();

    // Central diamond
    ctx.beginPath();
    ctx.moveTo(cx, y - 7);
    ctx.lineTo(cx + 8, y);
    ctx.lineTo(cx, y + 7);
    ctx.lineTo(cx - 8, y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * Draw a single centered line composed of styled segments:
   * [{ text, font, color }]
   */
  function drawCenteredSegments(ctx, segments, centerX, y) {
    let totalWidth = 0;
    const measured = [];
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      ctx.font = seg.font;
      const w = ctx.measureText(seg.text).width;
      measured.push({ seg, w });
      totalWidth += w;
    }

    let cursorX = centerX - totalWidth / 2;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < measured.length; i += 1) {
      const item = measured[i];
      ctx.font = item.seg.font;
      ctx.fillStyle = item.seg.color;
      ctx.fillText(item.seg.text, cursorX, y);
      cursorX += item.w;
    }
  }

  async function ensureCanvasFontsReady() {
    if (!document.fonts) return;
    const bnSample = 'আপনি কি এই শব্দের অর্থ জানেন? কুরআন সূরা আয়াত ০১২৩৪৫৬৭৮৯';
    const arSample = 'بِسْمِ اللَّهِ';
    try {
      await Promise.allSettled([
        document.fonts.ready,
        document.fonts.load('400 120px "IndoPak"', arSample),
        document.fonts.load('400 120px "Amiri"', arSample),
        document.fonts.load('700 40px "Noto Sans Bengali"', bnSample),
        document.fonts.load('600 32px "Noto Sans Bengali"', bnSample),
        document.fonts.load('400 28px "Noto Sans Bengali"', bnSample),
      ]);
    } catch (_err) {
      // Proceed cleanly with available fonts
    }
  }

  function getPreferredArabicFontFamily() {
    try {
      const cssVar = getComputedStyle(document.documentElement)
        .getPropertyValue('--font-arabic')
        .trim();
      if (cssVar) return cssVar;
    } catch (_err) {
      // Fallback below
    }
    return '"IndoPak", "Amiri", "Noto Naskh Arabic", serif';
  }

  async function renderCardCanvas(payload, templateId) {
    await ensureCanvasFontsReady();

    const template = getTemplateById(templateId);
    const p = template.palette;
    const canvas = document.createElement('canvas');
    canvas.width = CARD_SIZE;
    canvas.height = CARD_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');

    const cx = CARD_SIZE / 2;

    // 1. Radial Background
    const bgGrad = ctx.createRadialGradient(cx, 370, 60, cx, 520, 760);
    for (let i = 0; i < p.bgStops.length; i += 1) {
      bgGrad.addColorStop(p.bgStops[i][0], p.bgStops[i][1]);
    }
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, CARD_SIZE, CARD_SIZE);

    // Subtle soft radial halo behind the Arabic calligraphy
    const haloGrad = ctx.createRadialGradient(cx, 385, 20, cx, 385, 320);
    haloGrad.addColorStop(0, p.glowColor);
    haloGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = haloGrad;
    ctx.fillRect(0, 0, CARD_SIZE, CARD_SIZE);

    // 2. Double Architectural Hairline Frame + 4 Corner Islamic Geometric Stars
    ctx.save();
    drawRoundedRectPath(ctx, 34, 34, CARD_SIZE - 68, CARD_SIZE - 68, 30);
    ctx.strokeStyle = p.outerBorder;
    ctx.lineWidth = 2.4;
    ctx.stroke();

    drawRoundedRectPath(ctx, 50, 50, CARD_SIZE - 100, CARD_SIZE - 100, 22);
    ctx.strokeStyle = p.innerBorder;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();

    drawIslamicCornerStar(ctx, 84, 84, 15, p.ornament);
    drawIslamicCornerStar(ctx, CARD_SIZE - 84, 84, 15, p.ornament);
    drawIslamicCornerStar(ctx, 84, CARD_SIZE - 84, 15, p.ornament);
    drawIslamicCornerStar(ctx, CARD_SIZE - 84, CARD_SIZE - 84, 15, p.ornament);

    // 3. Top Curiosity Prompt
    const bnFont = '"Noto Sans Bengali", system-ui, -apple-system, sans-serif';
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 41px ' + bnFont;
    ctx.fillStyle = p.promptColor;
    ctx.fillText('আপনি কি এই শব্দের অর্থ জানেন?', cx, 136);
    ctx.restore();

    drawOrnamentalDivider(ctx, cx, 188, 170, p.dividerColor);

    // 4. Hero Arabic Word (Auto-scaled for crisp harakat without clipping)
    const arabicText = String(payload.arabic || '').trim();
    const arabicFamily = getPreferredArabicFontFamily();
    let arabicFontSize = 170;
    const maxArabicWidth = 820;

    ctx.save();
    ctx.direction = 'rtl';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    while (arabicFontSize > 86) {
      ctx.font = '400 ' + arabicFontSize + 'px ' + arabicFamily;
      if (ctx.measureText(arabicText).width <= maxArabicWidth) break;
      arabicFontSize -= 6;
    }

    ctx.shadowColor = p.arabicShadow;
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = p.arabicColor;
    ctx.fillText(arabicText, cx, 366);
    ctx.restore();

    // 5. Surah & Ayah Reference Line (Subtle Metadata)
    const surahName = normalizeBengaliUnicode(payload.surahNameBn || ('সূরা ' + toBnDigits(payload.surah || 1)));
    const surahLabel = surahName.startsWith('সূরা ') ? surahName : ('সূরা ' + surahName);
    const ayahBn = toBnDigits(payload.ayah || 1);
    ctx.save();
    ctx.direction = 'ltr';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 28px ' + bnFont;
    ctx.fillStyle = p.refColor;
    ctx.fillText(normalizeBengaliUnicode(surahLabel + '  ·  আয়াত ' + ayahBn), cx, 508);
    ctx.restore();

    // 6. Curiosity Stat Panel (Frequency + Quran Coverage %)
    const panelX = 94;
    const panelY = 564;
    const panelW = CARD_SIZE - 188;
    const panelH = 266;

    ctx.save();
    drawRoundedRectPath(ctx, panelX, panelY, panelW, panelH, 26);
    ctx.fillStyle = p.panelBg;
    ctx.fill();
    ctx.strokeStyle = p.panelBorder;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.restore();

    const countBn = formatCountBn(payload.occurrences);
    const pct = computeWordCoveragePercent(payload.occurrences, payload.totalQuranWords);
    const pctBn = formatCoveragePercentBn(pct);

    // Stat Line 1: পবিত্র কুরআনে এই শব্দটি <count> বার এসেছে
    const statBodyFont = '600 32px ' + bnFont;
    const statHighlightFont = '700 40px ' + bnFont;

    drawCenteredSegments(
      ctx,
      [
        { text: 'পবিত্র কুরআনে এই শব্দটি ', font: statBodyFont, color: p.statText },
        { text: countBn, font: statHighlightFont, color: p.statHighlight },
        { text: ' বার এসেছে', font: statBodyFont, color: p.statText },
      ],
      cx,
      panelY + 72
    );

    // Inner subtle hairline divider
    ctx.save();
    ctx.strokeStyle = p.panelDivider;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - 260, panelY + 128);
    ctx.lineTo(cx + 260, panelY + 128);
    ctx.stroke();
    ctx.restore();

    // Stat Line 2 (2 balanced centered lines for crisp readability)
    drawCenteredSegments(
      ctx,
      [
        { text: 'এই একটি শব্দ শিখলেই কুরআনের ', font: statBodyFont, color: p.statText },
        { text: pctBn + '%', font: statHighlightFont, color: p.statHighlight },
      ],
      cx,
      panelY + 180
    );

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = statBodyFont;
    ctx.fillStyle = p.statText;
    ctx.fillText('অংশ বুঝতে পারবেন', cx, panelY + 226);
    ctx.restore();

    // 7. Footer CTA Badge + Brand Signature
    const ctaText = 'সঠিক অর্থ ও উচ্চারণ দেখতে লিংকে যান';
    ctx.save();
    ctx.font = '700 28px ' + bnFont;
    const ctaTextW = ctx.measureText(ctaText).width;
    const ctaPadX = 42;
    const ctaW = Math.min(panelW, ctaTextW + ctaPadX * 2);
    const ctaH = 64;
    const ctaX = cx - ctaW / 2;
    const ctaY = 874;

    drawRoundedRectPath(ctx, ctaX, ctaY, ctaW, ctaH, 32);
    ctx.fillStyle = p.ctaBg;
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = p.ctaText;
    ctx.fillText(ctaText, cx, ctaY + ctaH / 2 + 1);
    ctx.restore();

    // Brand Signature Line
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 23px ' + bnFont;
    ctx.fillStyle = p.brandColor;
    ctx.fillText('কুরআন ভোকাবুলারি  •  শব্দে শব্দে কুরআন শিখুন', cx, 984);
    ctx.restore();

    return canvas;
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('PNG blob generation failed'));
        },
        'image/png',
        1.0
      );
    });
  }

  async function renderCardBlob(payload, templateId) {
    const canvas = await renderCardCanvas(payload, templateId);
    return canvasToBlob(canvas);
  }

  /* ------------------------------------------------------------
     CLIPBOARD & DOWNLOAD HELPERS
     ------------------------------------------------------------ */

  async function copyTextToClipboard(text) {
    const cleanText = normalizeBengaliUnicode(text);
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(cleanText);
        return true;
      } catch (_err) {
        // Fall through to execCommand fallback
      }
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = cleanText;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return Boolean(ok);
    } catch (_err) {
      return false;
    }
  }

  function triggerBlobDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1500);
  }

  function notifyToast(message) {
    if (typeof global.showToast === 'function') {
      global.showToast(message);
      return;
    }
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toast._wordShareTimer);
    toast._wordShareTimer = setTimeout(() => {
      toast.classList.remove('show');
    }, 2800);
  }

  /* ------------------------------------------------------------
     RESPONSIVE SHARE PREVIEW SHEET / MODAL CONTROLLER
     ------------------------------------------------------------ */

  const sheetState = {
    isOpen: false,
    payload: null,
    templateId: loadSavedTemplateId(),
    currentBlob: null,
    currentObjectUrl: null,
    renderSeq: 0,
    els: null,
  };

  function revokeCurrentPreviewUrl() {
    if (sheetState.currentObjectUrl) {
      URL.revokeObjectURL(sheetState.currentObjectUrl);
      sheetState.currentObjectUrl = null;
    }
  }

  function getIconSvg(name) {
    return (global.Icons && global.Icons[name]) ? global.Icons[name] : '';
  }

  function ensureModalMounted() {
    if (sheetState.els) return sheetState.els;

    const backdrop = document.createElement('div');
    backdrop.className = 'word-share-backdrop';
    backdrop.id = 'word-share-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');

    backdrop.innerHTML = [
      '<div class="word-share-sheet" id="word-share-sheet" role="dialog" aria-modal="true" aria-labelledby="word-share-title">',
      '  <div class="word-share-handle" aria-hidden="true"></div>',
      '  <div class="word-share-header">',
      '    <div class="word-share-header-text">',
      '      <h2 class="word-share-title" id="word-share-title">শব্দটি শেয়ার করুন</h2>',
      '      <p class="word-share-subtitle" id="word-share-subtitle">কার্ড টেমপ্লেট বেছে নিয়ে শেয়ার বা সেভ করুন</p>',
      '    </div>',
      '    <button type="button" class="word-share-close-btn" id="word-share-close-btn" aria-label="বন্ধ করুন">',
      '      <span class="icon">' + getIconSvg('close') + '</span>',
      '    </button>',
      '  </div>',
      '  <div class="word-share-body">',
      '    <div class="word-share-preview-frame">',
      '      <div class="word-share-preview-loading" id="word-share-loading">',
      '        <div class="loading-spinner"></div>',
      '        <span>কার্ড তৈরি হচ্ছে...</span>',
      '      </div>',
      '      <img class="word-share-preview-img" id="word-share-preview-img" alt="শেয়ার কার্ড প্রিভিউ" />',
      '    </div>',
      '    <div class="word-share-templates-section">',
      '      <span class="word-share-section-label">কার্ডের ডিজাইন</span>',
      '      <div class="word-share-template-grid" id="word-share-template-grid" role="radiogroup" aria-label="কার্ড টেমপ্লেট নির্বাচন">',
      TEMPLATES.map((tpl) => {
        return [
          '<button type="button" class="word-share-tpl-btn" data-template-id="' + tpl.id + '" role="radio" aria-checked="false">',
          '  <span class="word-share-tpl-swatch" style="background:' + tpl.swatchBg + ';border-color:' + tpl.swatchBorder + '">',
          '    <span class="word-share-tpl-dot" style="background:' + tpl.swatchAccent + '"></span>',
          '  </span>',
          '  <span class="word-share-tpl-name">' + tpl.shortLabelBn + '</span>',
          '</button>',
        ].join('');
      }).join(''),
      '      </div>',
      '    </div>',
      '    <div class="word-share-caption-card">',
      '      <div class="word-share-caption-top">',
      '        <span class="word-share-section-label">শেয়ারের লেখা ও লিংক</span>',
      '        <button type="button" class="word-share-copy-inline-btn" id="word-share-copy-caption-btn">',
      '          <span class="icon">' + getIconSvg('copy') + '</span>',
      '          <span>লেখা কপি</span>',
      '        </button>',
      '      </div>',
      '      <div class="word-share-caption-text" id="word-share-caption-text"></div>',
      '      <p class="word-share-hint">ফেসবুকে লেখা অটো না এলে \'লেখা কপি\' করে পেস্ট করুন।</p>',
      '    </div>',
      '  </div>',
      '  <div class="word-share-footer">',
      '    <button type="button" class="word-share-primary-btn" id="word-share-native-btn">',
      '      <span class="icon">' + getIconSvg('share') + '</span>',
      '      <span id="word-share-native-label">শেয়ার করুন</span>',
      '    </button>',
      '    <div class="word-share-secondary-row">',
      '      <button type="button" class="word-share-secondary-btn" id="word-share-save-btn">',
      '        <span class="icon">' + getIconSvg('download') + '</span>',
      '        <span>ইমেজ সেভ</span>',
      '      </button>',
      '      <button type="button" class="word-share-secondary-btn" id="word-share-link-btn">',
      '        <span class="icon">' + getIconSvg('copy') + '</span>',
      '        <span>লিংক কপি</span>',
      '      </button>',
      '    </div>',
      '  </div>',
      '</div>',
    ].join('\n');

    document.body.appendChild(backdrop);

    const els = {
      backdrop,
      sheet: backdrop.querySelector('#word-share-sheet'),
      closeBtn: backdrop.querySelector('#word-share-close-btn'),
      subtitle: backdrop.querySelector('#word-share-subtitle'),
      loading: backdrop.querySelector('#word-share-loading'),
      previewImg: backdrop.querySelector('#word-share-preview-img'),
      templateBtns: Array.from(backdrop.querySelectorAll('.word-share-tpl-btn')),
      captionText: backdrop.querySelector('#word-share-caption-text'),
      copyCaptionBtn: backdrop.querySelector('#word-share-copy-caption-btn'),
      nativeBtn: backdrop.querySelector('#word-share-native-btn'),
      nativeLabel: backdrop.querySelector('#word-share-native-label'),
      saveBtn: backdrop.querySelector('#word-share-save-btn'),
      linkBtn: backdrop.querySelector('#word-share-link-btn'),
    };

    // Close handlers
    els.closeBtn.addEventListener('click', closeSheet);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeSheet();
    });

    // Template switchers
    els.templateBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextId = resolveShareTemplateId(btn.getAttribute('data-template-id'));
        if (nextId === sheetState.templateId && sheetState.currentBlob) return;
        sheetState.templateId = nextId;
        saveTemplateId(nextId);
        syncTemplateButtons();
        regeneratePreview();
      });
    });

    // Copy caption + link
    els.copyCaptionBtn.addEventListener('click', async () => {
      if (!sheetState.payload) return;
      const caption = buildWordShareCaption(sheetState.payload);
      const ok = await copyTextToClipboard(caption);
      notifyToast(ok ? 'শেয়ারের লেখা ও লিংক কপি হয়েছে' : 'কপি করা যায়নি');
    });

    // Copy direct link only
    els.linkBtn.addEventListener('click', async () => {
      if (!sheetState.payload) return;
      const url = buildWordShareUrl(sheetState.payload.wordKey);
      const ok = await copyTextToClipboard(url);
      notifyToast(ok ? 'শব্দের লিংক কপি হয়েছে' : 'লিংক কপি করা যায়নি');
    });

    // Save PNG directly
    els.saveBtn.addEventListener('click', async () => {
      if (!sheetState.payload) return;
      try {
        const blob = sheetState.currentBlob || await renderCardBlob(sheetState.payload, sheetState.templateId);
        sheetState.currentBlob = blob;
        triggerBlobDownload(blob, buildWordShareFilename(sheetState.payload.wordKey));
        notifyToast('ইমেজ কার্ড সেভ করা হয়েছে');
      } catch (_err) {
        notifyToast('ইমেজ তৈরি করতে সমস্যা হয়েছে');
      }
    });

    // Primary Share CTA (Web Share API Level 2 with clean desktop/fallback flow)
    els.nativeBtn.addEventListener('click', handlePrimaryShare);

    // Keyboard Escape to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sheetState.isOpen) {
        e.preventDefault();
        closeSheet();
      }
    });

    sheetState.els = els;
    return els;
  }

  function syncTemplateButtons() {
    if (!sheetState.els) return;
    sheetState.els.templateBtns.forEach((btn) => {
      const id = btn.getAttribute('data-template-id');
      const isSelected = id === sheetState.templateId;
      btn.classList.toggle('is-active', isSelected);
      btn.setAttribute('aria-checked', isSelected ? 'true' : 'false');
    });
  }

  async function regeneratePreview() {
    if (!sheetState.els || !sheetState.payload) return;
    const seq = ++sheetState.renderSeq;
    const { loading, previewImg } = sheetState.els;

    loading.classList.add('is-visible');
    sheetState.currentBlob = null;

    try {
      const blob = await renderCardBlob(sheetState.payload, sheetState.templateId);
      if (seq !== sheetState.renderSeq || !sheetState.isOpen) return;

      revokeCurrentPreviewUrl();
      const url = URL.createObjectURL(blob);
      sheetState.currentBlob = blob;
      sheetState.currentObjectUrl = url;

      previewImg.onload = () => {
        if (seq === sheetState.renderSeq) {
          loading.classList.remove('is-visible');
          previewImg.classList.add('is-ready');
        }
      };
      previewImg.src = url;
    } catch (err) {
      if (seq === sheetState.renderSeq) {
        loading.classList.remove('is-visible');
        console.warn('[WordShareCard] Preview render failed:', err);
        notifyToast('কার্ড প্রিভিউ তৈরি করতে সমস্যা হয়েছে');
      }
    }
  }

  async function handlePrimaryShare() {
    if (!sheetState.payload || !sheetState.els) return;
    const btn = sheetState.els.nativeBtn;
    btn.disabled = true;

    try {
      const payload = sheetState.payload;
      const caption = buildWordShareCaption(payload);
      const shareUrl = buildWordShareUrl(payload.wordKey);
      const filename = buildWordShareFilename(payload.wordKey);
      const blob = sheetState.currentBlob || await renderCardBlob(payload, sheetState.templateId);
      sheetState.currentBlob = blob;

      const shareTitle = normalizeBengaliUnicode('আপনি কি এই শব্দের অর্থ জানেন?');

      // 1. Mobile Native Share with Image File + Clean Precomposed Bengali Unicode Caption
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof File === 'function') {
        const pngFile = new File([blob], filename, { type: 'image/png' });
        const canShareFiles = typeof navigator.canShare === 'function'
          && navigator.canShare({ files: [pngFile] });

        if (canShareFiles) {
          try {
            await navigator.share({
              files: [pngFile],
              title: shareTitle,
              text: caption,
            });
            return;
          } catch (err) {
            if (err && err.name === 'AbortError') return;
            // Otherwise fall through to desktop/fallback below
          }
        } else {
          // Device supports navigator.share(text/url) without files:
          try {
            await navigator.share({
              title: shareTitle,
              text: caption,
              url: shareUrl,
            });
            return;
          } catch (err) {
            if (err && err.name === 'AbortError') return;
          }
        }
      }

      // 2. Desktop / Unsupported Browser Fallback:
      // Auto-copy caption+link AND download PNG so user can post in 1 step
      await copyTextToClipboard(caption);
      triggerBlobDownload(blob, filename);
      notifyToast('ইমেজ সেভ এবং লেখা ও লিংক কপি হয়েছে');
    } catch (err) {
      if (!err || err.name !== 'AbortError') {
        console.warn('[WordShareCard] Share failed:', err);
        notifyToast('শেয়ার করা যায়নি — ইমেজ সেভ করে চেষ্টা করুন');
      }
    } finally {
      btn.disabled = false;
    }
  }

  function closeSheet() {
    if (!sheetState.isOpen || !sheetState.els) return;
    sheetState.isOpen = false;
    sheetState.renderSeq += 1;
    sheetState.els.backdrop.classList.remove('is-open');
    sheetState.els.backdrop.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('share-modal-open');

    setTimeout(() => {
      if (!sheetState.isOpen) {
        revokeCurrentPreviewUrl();
        if (sheetState.els && sheetState.els.previewImg) {
          sheetState.els.previewImg.removeAttribute('src');
          sheetState.els.previewImg.classList.remove('is-ready');
        }
        sheetState.currentBlob = null;
      }
    }, 220);
  }

  async function openSheet(payload) {
    if (!payload || !payload.wordKey || !payload.arabic) return;
    const els = ensureModalMounted();

    const normalized = {
      wordKey: String(payload.wordKey).trim(),
      arabic: String(payload.arabic).trim(),
      surah: Number(payload.surah) || 1,
      ayah: Number(payload.ayah) || 1,
      position: Number(payload.position) || 1,
      surahNameBn: normalizeBengaliUnicode(payload.surahNameBn || ('সূরা ' + toBnDigits(payload.surah || 1))),
      occurrences: Math.max(1, Number(payload.occurrences) || 1),
      totalQuranWords: payload.totalQuranWords || getTotalQuranWords(),
    };

    sheetState.payload = normalized;
    sheetState.isOpen = true;
    sheetState.templateId = loadSavedTemplateId();

    const subtitleSurah = normalized.surahNameBn.startsWith('সূরা ')
      ? normalized.surahNameBn
      : ('সূরা ' + normalized.surahNameBn);
    els.subtitle.textContent = normalizeBengaliUnicode(subtitleSurah + ' · আয়াত ' + toBnDigits(normalized.ayah));
    els.captionText.textContent = buildWordShareCaption(normalized);
    els.previewImg.classList.remove('is-ready');
    syncTemplateButtons();

    document.body.classList.add('share-modal-open');
    els.backdrop.classList.add('is-open');
    els.backdrop.setAttribute('aria-hidden', 'false');

    await regeneratePreview();
  }

  function isOpen() {
    return sheetState.isOpen;
  }

  global.WordShareCore = {
    PRODUCTION_APP_BASE_URL,
    DEFAULT_TOTAL_QURAN_WORDS,
    TEMPLATES,
    toBnDigits,
    formatCountBn,
    isValidWordKey,
    parseWordKeyFromLocation,
    buildWordShareUrl,
    getTotalQuranWords,
    computeWordCoveragePercent,
    formatCoveragePercentBn,
    normalizeBengaliUnicode,
    buildWordShareCaption,
    buildWordShareFilename,
    resolveShareTemplateId,
  };

  global.WordShareCard = {
    open: openSheet,
    close: closeSheet,
    isOpen,
    renderCardBlob,
    renderCardCanvas,
    getTemplates: () => TEMPLATES.slice(),
  };
})(window);
