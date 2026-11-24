import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSafeAuthRedirectUrl,
  parseAuthCallbackLocation,
  validateEmailAddress,
  validatePasswordResetInput,
  resolveAuthRedirectStatus,
  translateSupabaseAuthErrorBn,
} from './supabase-auth-flow';

describe('supabase-auth-flow pure utilities', () => {
  it('builds safe http(s) redirect URLs and rejects unsafe schemes', () => {
    assert.equal(
      buildSafeAuthRedirectUrl('https://developersakibur.github.io', '/quran-vocab-app/'),
      'https://developersakibur.github.io/quran-vocab-app/'
    );
    assert.equal(
      buildSafeAuthRedirectUrl('http://localhost:3000', '/'),
      'http://localhost:3000/'
    );
    assert.equal(buildSafeAuthRedirectUrl('file://', '/index.html'), undefined);
    assert.equal(buildSafeAuthRedirectUrl('javascript:alert(1)', '/'), undefined);
    assert.equal(buildSafeAuthRedirectUrl('null', '/'), undefined);
  });

  it('classifies recovery, signup, error, and normal app routes accurately', () => {
    const recoveryHash = parseAuthCallbackLocation(
      '',
      '#access_token=abc&refresh_token=xyz&type=recovery'
    );
    assert.equal(recoveryHash.kind, 'recovery');
    assert.equal(recoveryHash.isAuthCallback, true);
    assert.equal(recoveryHash.hasError, false);

    const recoveryPkce = parseAuthCallbackLocation('?code=pkce-123&type=recovery', '');
    assert.equal(recoveryPkce.kind, 'recovery');
    assert.equal(recoveryPkce.isAuthCallback, true);

    const signupHash = parseAuthCallbackLocation(
      '',
      '#access_token=abc&refresh_token=xyz&type=signup'
    );
    assert.equal(signupHash.kind, 'signup');
    assert.equal(signupHash.isAuthCallback, true);

    const expiredErr = parseAuthCallbackLocation(
      '',
      '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'
    );
    assert.equal(expiredErr.kind, 'error');
    assert.equal(expiredErr.hasError, true);
    assert.equal(expiredErr.errorCode, 'otp_expired');

    // Normal app routes must never be mistaken for auth callbacks
    assert.equal(parseAuthCallbackLocation('?word=1:1:2', '').kind, 'none');
    assert.equal(parseAuthCallbackLocation('', '#surah=2').kind, 'none');
    assert.equal(parseAuthCallbackLocation('', '#account').kind, 'none');
  });

  it('validates email addresses and new password inputs strictly', () => {
    assert.equal(validateEmailAddress('user@example.com').valid, true);
    assert.equal(validateEmailAddress('  ').valid, false);
    assert.equal(validateEmailAddress('invalid-email').valid, false);

    assert.equal(validatePasswordResetInput('', '').valid, false);
    assert.equal(validatePasswordResetInput('12345', '12345').valid, false);
    assert.equal(validatePasswordResetInput('secret123', 'secret124').valid, false);
    assert.equal(validatePasswordResetInput('secret123', 'secret123').valid, true);
  });

  it('resolves auth redirect state machine transitions for recovery vs signup', () => {
    assert.equal(resolveAuthRedirectStatus('PASSWORD_RECOVERY', true, null), 'recovery');

    const recoveryPending = parseAuthCallbackLocation('?code=abc&type=recovery', '');
    assert.equal(resolveAuthRedirectStatus('SIGNED_IN', true, recoveryPending), 'recovery');
    assert.equal(resolveAuthRedirectStatus('INITIAL_SESSION', true, recoveryPending), 'recovery');

    const signupPending = parseAuthCallbackLocation('', '#access_token=abc&type=signup');
    assert.equal(resolveAuthRedirectStatus('SIGNED_IN', true, signupPending), 'verified');

    const errorPending = parseAuthCallbackLocation('', '#error=access_denied&error_code=otp_expired');
    assert.equal(resolveAuthRedirectStatus('INITIAL_SESSION', false, errorPending), 'error');

    assert.equal(resolveAuthRedirectStatus('SIGNED_IN', true, null), 'none');
  });

  it('translates password reset & recovery errors into clear Bengali messages', () => {
    assert.ok(
      translateSupabaseAuthErrorBn('New password should be different from the old password.').includes('ভিন্ন')
    );
    assert.ok(
      translateSupabaseAuthErrorBn({ message: 'Email link is invalid or has expired (otp_expired)' }).includes('মেয়াদ')
    );
    assert.ok(
      translateSupabaseAuthErrorBn('Auth session missing!').includes('সক্রিয় নেই')
    );
    assert.ok(
      translateSupabaseAuthErrorBn('For security purposes, you can only request this after 42 seconds.').includes('বিরতি')
    );
  });
});
