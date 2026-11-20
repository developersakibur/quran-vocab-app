import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMorphologySummaryBn, translateAuthErrorBn } from './bengali-morphology.ts';

test('formatMorphologySummaryBn converts English corpus morphology into 100% Bengali and Arabic without English text', () => {
  const sampleWord = {
    key: '1:1:1',
    surah: 1,
    ayah: 1,
    position: 1,
    word_type: 'noun',
    pos: 'N',
    root: 'سمو',
    bangla: 'নামে',
    morphology_summary:
      'The first word of verse (1:1) is divided into 2 morphological segments. A preposition and noun. The prefixed preposition <i class="ab">bi</i> is usually translated as "with" or "by". The noun is masculine and is in the genitive case (<span class="at">مجرور</span>). The noun\'s triliteral root is <i class="ab">sīn mīm wāw</i> (<span class="at">س م و</span>). Together the segments form a preposition phrase known as <i class="ab">jār wa majrūr</i> (<span class="at">جار ومجرور</span>).'
  };

  const html = formatMorphologySummaryBn(sampleWord);

  // Strip HTML tags to inspect visible text
  const visibleText = html.replace(/<[^>]+>/g, '');

  // Must contain Bengali morphology details
  assert.ok(visibleText.includes('গঠন ও বিভাজন:'));
  assert.ok(visibleText.includes('২টি ব্যাকরণগত অংশে বিভক্ত'));
  assert.ok(visibleText.includes('বিশেষ্য (ইসম)'));
  assert.ok(visibleText.includes('পুংলিঙ্গ (মুযাক্কার)'));
  assert.ok(visibleText.includes('যের বা মাজরুর'));
  assert.ok(visibleText.includes('নামে'));

  // Must contain ZERO English words
  assert.equal(/[A-Za-z]/.test(visibleText), false, `Expected zero English letters in visible text, got: ${visibleText}`);
});

test('translateAuthErrorBn translates English Supabase auth errors into pure Bengali', () => {
  const invalidLogin = translateAuthErrorBn({ message: 'Invalid login credentials' });
  assert.equal(/[A-Za-z]/.test(invalidLogin), false);
  assert.ok(invalidLogin.includes('ভুল ইমেইল বা পাসওয়ার্ড'));

  const alreadyReg = translateAuthErrorBn({ message: 'User already registered' });
  assert.equal(/[A-Za-z]/.test(alreadyReg), false);
  assert.ok(alreadyReg.includes('ইতিপূর্বেই একাউন্ট খোলা হয়েছে'));

  const genericErr = translateAuthErrorBn({ message: 'Unexpected server error 500' });
  assert.equal(/[A-Za-z]/.test(genericErr), false);
});
