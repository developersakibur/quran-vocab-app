export interface WordMorphologyInput {
  key?: string;
  surah?: number;
  ayah?: number;
  position?: number;
  word_type?: string;
  pos?: string;
  root?: string;
  bangla?: string;
  morphology_summary?: string;
}

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export function toBnNumber(num: number | string): string {
  return String(num ?? '').replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

/**
 * Converts English Corpus Morphology HTML/text into 100% pure Bengali + Arabic script
 * with zero English words.
 */
export function formatMorphologySummaryBn(word: WordMorphologyInput): string {
  if (!word) return 'এই শব্দের ব্যাকরণগত বিস্তারিত তথ্য শীঘ্রই যুক্ত হবে।';
  const raw = String(word.morphology_summary || '');
  const lower = raw.toLowerCase();

  const items: string[] = [];

  // 1. Morphological segment count
  const segMatch = raw.match(/divided into (\d+) morphological segments?/i);
  if (segMatch) {
    const segCount = toBnNumber(segMatch[1]);
    const segParts: string[] = [];
    if (lower.includes('preposition')) segParts.push('অব্যয় (হরফে যার)');
    if (lower.includes('conjunction')) segParts.push('সংযোজক অব্যয় (হরফে আতফ)');
    if (lower.includes('determiner') || lower.includes('definite article')) segParts.push('নির্দিষ্টতাবাচক আলিফ-লাম (ال)');
    if (lower.includes('emphatic')) segParts.push('নিশ্চয়তাবাচক অব্যয় (তাকীদ)');
    if (lower.includes('interrogative')) segParts.push('প্রশ্নবোধক অব্যয় (ইস্তিফহাম)');
    if (lower.includes('vocative')) segParts.push('সম্বোধনসূচক অব্যয় (হরফে নিদা)');
    if (lower.includes('negative')) segParts.push('নেতিবাচক অব্যয় (নফি)');
    if (lower.includes('proper noun')) segParts.push('নামবাচক বিশেষ্য');
    else if (lower.includes('noun')) segParts.push('বিশেষ্য');
    if (lower.includes('adjective')) segParts.push('বিশেষণ');
    if (lower.includes('verb')) segParts.push('ক্রিয়া');
    if (lower.includes('personal pronoun') || lower.includes('object pronoun') || lower.includes('subject pronoun') || lower.includes('pronoun')) {
      segParts.push('সর্বনাম (দমীর)');
    }
    const segDesc = segParts.length > 0 ? ` (${segParts.join(' + ')})` : '';
    items.push(`<strong>গঠন ও বিভাজন:</strong> শব্দটি ${segCount}টি ব্যাকরণগত অংশে বিভক্ত${segDesc}।`);
  }

  // 2. Part of speech & verb form
  const posItems: string[] = [];
  if (lower.includes('proper noun')) {
    posItems.push('নামবাচক বিশেষ্য (ইসমে আলাম)');
  } else if (lower.includes('active participle')) {
    posItems.push('কর্তৃবাচক বিশেষ্য (ইসমে ফায়েল)');
  } else if (lower.includes('passive participle')) {
    posItems.push('কর্মবাচক বিশেষ্য (ইসমে মাফউল)');
  } else if (lower.includes('verbal noun')) {
    posItems.push('ক্রিয়াবাচক বিশেষ্য (মাসদার)');
  } else if (lower.includes('relative pronoun')) {
    posItems.push('সম্বন্ধবাচক সর্বনাম (ইসমে মাওসুল)');
  } else if (lower.includes('demonstrative pronoun')) {
    posItems.push('নির্দেশক সর্বনাম (ইসমে ইশারা)');
  } else if (lower.includes('imperfect verb')) {
    posItems.push('বর্তমান/ভবিষ্যৎ কালবাচক ক্রিয়া (ফেলে মুদারি)');
  } else if (lower.includes('perfect verb')) {
    posItems.push('অতীত কালবাচক ক্রিয়া (ফেলে মাদি)');
  } else if (lower.includes('imperative verb')) {
    posItems.push('অনুজ্ঞাসূচক ক্রিয়া (ফেলে আমর)');
  } else if (word.word_type === 'verb' || word.pos === 'V' || lower.includes('verb')) {
    posItems.push('ক্রিয়াপদ (ফেল)');
  } else if (word.word_type === 'adjective' || word.pos === 'ADJ' || lower.includes('adjective')) {
    posItems.push('বিশেষণ (সিফাত)');
  } else if (word.word_type === 'particle' || word.pos === 'P' || lower.includes('particle')) {
    posItems.push('অব্যয় পদ (হরফ)');
  } else {
    posItems.push('বিশেষ্য (ইসম)');
  }

  const formMatch = raw.match(/form\s*\(([IVX]+)\)/i);
  if (formMatch) {
    posItems.push(`ক্রিয়ার ফর্ম: বাব-${formMatch[1]}`);
  }
  items.push(`<strong>পদের শ্রেণি:</strong> ${posItems.join(' • ')}।`);

  // 3. Gender, Number, Person
  const traits: string[] = [];
  if (lower.includes('masculine')) traits.push('পুংলিঙ্গ (মুযাক্কার)');
  if (lower.includes('feminine')) traits.push('স্ত্রীলিঙ্গ (মুয়ান্নাস)');
  if (lower.includes('singular')) traits.push('একবচন (ওয়াহিদ)');
  if (lower.includes('dual')) traits.push('দ্বিবচন (তাসনিয়া)');
  if (lower.includes('plural')) traits.push('বহুবচন (জমা)');
  if (lower.includes('first person')) traits.push('উত্তম পুরুষ (মুতাকাল্লিম)');
  if (lower.includes('second person')) traits.push('মধ্যম পুরুষ (মুখাতাব)');
  if (lower.includes('third person')) traits.push('নাম পুরুষ (গায়েব)');
  if (lower.includes('indefinite')) traits.push('অনির্দিষ্ট (নাকিরাহ)');
  if (lower.includes('definite') && !lower.includes('indefinite')) traits.push('নির্দিষ্ট (মারিফাহ)');

  if (traits.length > 0) {
    items.push(`<strong>লিঙ্গ, বচন ও পুরুষ:</strong> ${traits.join(' • ')}।`);
  }

  // 4. Case / Mood (I'rab)
  const irab: string[] = [];
  if (lower.includes('nominative')) irab.push('পেশ বা মারফু (<span class="at">مرفوع</span>) অবস্থায় রয়েছে');
  if (lower.includes('accusative')) irab.push('যবর বা মানসুব (<span class="at">منصوب</span>) অবস্থায় রয়েছে');
  if (lower.includes('genitive')) irab.push('যের বা মাজরুর (<span class="at">مجرور</span>) অবস্থায় রয়েছে');
  if (lower.includes('jussive')) irab.push('জযম বা মাজযুম (<span class="at">مجزوم</span>) অবস্থায় রয়েছে');
  if (lower.includes('subjunctive')) irab.push('মানসুব (<span class="at">منصوب</span>) অবস্থায় রয়েছে');
  if (lower.includes('preposition phrase') || lower.includes('jār wa majrūr')) {
    irab.push('যার ও মাজরুর (<span class="at">جار ومجرور</span>) পদগুচ্ছ গঠন করেছে');
  }
  if (irab.length > 0) {
    items.push(`<strong>ব্যাকরণগত অবস্থা:</strong> ${irab.join(' এবং ')}।`);
  }

  // 5. Root
  const arabicSpans: string[] = [];
  const spanRegex = /<span class="at">([^<]+)<\/span>/g;
  let m: RegExpExecArray | null;
  while ((m = spanRegex.exec(raw)) !== null) {
    if (m[1] && !arabicSpans.includes(m[1].trim())) {
      arabicSpans.push(m[1].trim());
    }
  }

  if (word.root) {
    items.push(`<strong>মূল ধাতু (মাদ্দাহ):</strong> <span class="at">${word.root}</span> (${word.root.split('').join(' - ')})।`);
  } else if (lower.includes('no root')) {
    items.push('<strong>মূল ধাতু:</strong> এটি একটি অব্যয় বা সর্বনাম জাতীয় শব্দ হওয়ায় এর কোনো ত্রি-বর্ণ বা চতুর্বর্ণ মূল ধাতু নেই।');
  }

  if (arabicSpans.length > 0) {
    items.push(`<strong>সংশ্লিষ্ট আরবী রূপ:</strong> ${arabicSpans.map((s) => `<span class="at">${s}</span>`).join(' ، ')}।`);
  }

  const posParts = (word.key || `${word.surah}:${word.ayah}:${word.position}`).split(':');
  items.push(
    `<strong>শব্দার্থ ও অবস্থান:</strong> সূরা ${toBnNumber(posParts[0])}, আয়াত ${toBnNumber(posParts[1])}-এর ${toBnNumber(posParts[2])} নং শব্দ — বাংলা অর্থ: «${word.bangla || ''}»।`
  );

  return items.map((line) => `<div class="morph-bn-item">${line}</div>`).join('');
}

export function translateAuthErrorBn(err: { message?: string } | null | undefined): string {
  const msg = String((err && err.message) || '').toLowerCase();
  if (msg.includes('invalid login credentials')) {
    return 'ভুল ইমেইল বা পাসওয়ার্ড। অনুগ্রহ করে সঠিক তথ্য দিয়ে পুনরায় চেষ্টা করুন।';
  }
  if (msg.includes('already registered') || msg.includes('already been registered')) {
    return 'এই ইমেইল দিয়ে ইতিপূর্বেই একাউন্ট খোলা হয়েছে। অনুগ্রহ করে লগইন করুন।';
  }
  if (msg.includes('password should be at least')) {
    return 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।';
  }
  if (msg.includes('rate limit') || msg.includes('too many requests')) {
    return 'অতিরিক্ত চেষ্টার কারণে সাময়িকভাবে বিরতি দেওয়া হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।';
  }
  if (msg.includes('network') || msg.includes('fetch')) {
    return 'ইন্টারনেট সংযোগে সমস্যা হচ্ছে। আপনার নেটওয়ার্ক যাচাই করুন।';
  }
  return 'অনুরোধটি সম্পন্ন করা যায়নি। অনুগ্রহ করে তথ্য যাচাই করে আবার চেষ্টা করুন।';
}
