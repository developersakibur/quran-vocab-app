/* ============================================================
   SUPABASE AUTH & PASSWORD RESET FLOW CORE (Pure TypeScript)
   Deterministic URL callback classification, email & password
   reset validation, auth state-machine transitions, and Bengali
   error localization for Supabase Email Auth.
   ============================================================ */

export type AuthCallbackKind = 'none' | 'signup' | 'recovery' | 'error';

export interface ParsedAuthCallback {
  kind: AuthCallbackKind;
  isAuthCallback: boolean;
  hasError: boolean;
  errorCode: string;
  errorDescription: string;
}

export interface ValidationResult {
  valid: boolean;
  errorBn: string;
}

export type AuthRedirectStatus = 'none' | 'verified' | 'recovery' | 'error';

export const MIN_PASSWORD_LENGTH = 6;

/**
 * Safely build an http(s) redirect URL from origin + pathname (blocks file:/javascript:/null).
 */
export function buildSafeAuthRedirectUrl(origin: string, pathname: string): string | undefined {
  const cleanOrigin = String(origin || '').trim();
  if (!/^https?:\/\/[^/\s]+$/i.test(cleanOrigin)) {
    return undefined;
  }
  const cleanPath = String(pathname || '/').trim() || '/';
  return `${cleanOrigin}${cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`}`;
}

/**
 * Parse Supabase redirect callback parameters from window.location.search & hash.
 * Supports both implicit fragment callbacks (#access_token=...&type=recovery)
 * and PKCE query callbacks (?code=...&type=recovery), as well as error redirects.
 */
export function parseAuthCallbackLocation(search: string, hash: string): ParsedAuthCallback {
  const cleanSearch = String(search || '').trim();
  const cleanHash = String(hash || '').trim();

  const searchParams = new URLSearchParams(cleanSearch.startsWith('?') ? cleanSearch.slice(1) : cleanSearch);
  const hashRaw = cleanHash.startsWith('#') ? cleanHash.slice(1) : cleanHash;
  const hashParams = new URLSearchParams(hashRaw.includes('=') ? hashRaw : '');

  const getParam = (key: string): string => (hashParams.get(key) || searchParams.get(key) || '').trim();

  const error = getParam('error');
  const errorCode = getParam('error_code');
  const errorDescription = getParam('error_description');
  const type = getParam('type').toLowerCase();
  const hasTokenOrCode = Boolean(
    getParam('access_token')
    || getParam('refresh_token')
    || getParam('code')
    || getParam('token_hash')
  );

  if (error || errorCode || errorDescription) {
    return {
      kind: 'error',
      isAuthCallback: false,
      hasError: true,
      errorCode: errorCode || error,
      errorDescription: errorDescription || error || 'Verification link invalid or expired',
    };
  }

  if (type === 'recovery') {
    return {
      kind: 'recovery',
      isAuthCallback: true,
      hasError: false,
      errorCode: '',
      errorDescription: '',
    };
  }

  if (type === 'signup' || type === 'email' || type === 'magiclink' || hasTokenOrCode) {
    return {
      kind: 'signup',
      isAuthCallback: true,
      hasError: false,
      errorCode: '',
      errorDescription: '',
    };
  }

  return {
    kind: 'none',
    isAuthCallback: false,
    hasError: false,
    errorCode: '',
    errorDescription: '',
  };
}

/**
 * Validate an email address format before submitting auth requests.
 */
export function validateEmailAddress(rawEmail: string): ValidationResult {
  const email = String(rawEmail || '').trim();
  if (!email) {
    return { valid: false, errorBn: 'অনুগ্রহ করে আপনার ইমেইল ঠিকানা লিখুন।' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return { valid: false, errorBn: 'সঠিক ইমেইল ঠিকানা লিখুন (যেমন: name@example.com)।' };
  }
  return { valid: true, errorBn: '' };
}

/**
 * Validate new password and confirmation password during password recovery.
 */
export function validatePasswordResetInput(newPassword: string, confirmPassword: string): ValidationResult {
  const pass = String(newPassword ?? '');
  const confirm = String(confirmPassword ?? '');

  if (!pass) {
    return { valid: false, errorBn: 'নতুন পাসওয়ার্ড লিখুন।' };
  }
  if (pass.length < MIN_PASSWORD_LENGTH) {
    return { valid: false, errorBn: 'নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।' };
  }
  if (pass !== confirm) {
    return { valid: false, errorBn: 'নতুন পাসওয়ার্ড ও নিশ্চিত পাসওয়ার্ড হুবহু মিলতে হবে।' };
  }
  return { valid: true, errorBn: '' };
}

/**
 * Determine the next redirect UI status from a Supabase onAuthStateChange event
 * combined with any pending URL callback metadata.
 */
export function resolveAuthRedirectStatus(
  authEvent: string,
  hasUser: boolean,
  pendingCallback: ParsedAuthCallback | null
): AuthRedirectStatus {
  if (authEvent === 'PASSWORD_RECOVERY') {
    return 'recovery';
  }

  if (!pendingCallback) {
    return 'none';
  }

  if (pendingCallback.hasError) {
    return 'error';
  }

  if (hasUser && (authEvent === 'SIGNED_IN' || authEvent === 'INITIAL_SESSION')) {
    if (pendingCallback.kind === 'recovery') {
      return 'recovery';
    }
    if (pendingCallback.isAuthCallback) {
      return 'verified';
    }
  }

  return 'none';
}

/**
 * Map Supabase auth/recovery error messages to clear, user-friendly Bengali text.
 */
export function translateSupabaseAuthErrorBn(errOrMessage: unknown): string {
  const raw =
    typeof errOrMessage === 'string'
      ? errOrMessage
      : String((errOrMessage as { message?: unknown })?.message || '');
  const msg = raw.toLowerCase();

  if (msg.includes('invalid login credentials')) {
    return 'ভুল ইমেইল বা পাসওয়ার্ড। অনুগ্রহ করে সঠিক তথ্য দিয়ে পুনরায় চেষ্টা করুন।';
  }
  if (msg.includes('email not confirmed')) {
    return 'আপনার ইমেইল এখনও যাচাই করা হয়নি। ইনবক্সের লিংকে ক্লিক করে ইমেইল নিশ্চিত করুন।';
  }
  if (msg.includes('already registered') || msg.includes('already been registered')) {
    return 'এই ইমেইল দিয়ে ইতিপূর্বেই একাউন্ট খোলা হয়েছে। অনুগ্রহ করে লগইন করুন।';
  }
  if (msg.includes('password should be at least')) {
    return 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।';
  }
  if (msg.includes('same_password') || msg.includes('different from the old password')) {
    return 'নতুন পাসওয়ার্ডটি আগের পাসওয়ার্ডের থেকে ভিন্ন হতে হবে।';
  }
  if (msg.includes('otp_expired') || msg.includes('expired') || msg.includes('invalid flow state')) {
    return 'লিংকটির মেয়াদ শেষ হয়ে গেছে বা ইতিমধ্যে ব্যবহৃত হয়েছে। অনুগ্রহ করে নতুন লিংক পাঠান।';
  }
  if (msg.includes('auth session missing') || msg.includes('session_not_found')) {
    return 'রিসেট সেশনটি আর সক্রিয় নেই। অনুগ্রহ করে আবার পাসওয়ার্ড রিসেট লিংক পাঠান।';
  }
  if (msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('security purposes')) {
    return 'অতিরিক্ত চেষ্টার কারণে সাময়িকভাবে বিরতি দেওয়া হয়েছে। এক মিনিট পর আবার চেষ্টা করুন।';
  }
  if (msg.includes('network') || msg.includes('fetch')) {
    return 'ইন্টারনেট সংযোগে সমস্যা হচ্ছে। আপনার নেটওয়ার্ক যাচাই করুন।';
  }
  return 'অনুরোধটি সম্পন্ন করা যায়নি। অনুগ্রহ করে তথ্য যাচাই করে আবার চেষ্টা করুন।';
}
