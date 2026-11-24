// پیام‌های خطای فارسی و اعتبارسنجی ورودی‌ها برای Auth سایت ML
// هیچ رمز یا کلیدی در پیام‌ها بازتاب داده نمی‌شود.

export function isRateLimitError(err) {
  if (!err) return false
  const status = err.status || err.statusCode
  const msg = String(err.message || err).toLowerCase()
  return (
    status === 429 ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('over_email_send_rate_limit') ||
    msg.includes('over_request_rate_limit')
  )
}

export function isSessionExpiredError(err) {
  if (!err) return false
  const status = err.status || err.statusCode
  const code = String(err.code || '').toLowerCase()
  const msg = String(err.message || err).toLowerCase()
  return (
    status === 401 ||
    code === 'session_not_found' ||
    code === 'refresh_token_not_found' ||
    code === 'invalid_refresh_token' ||
    msg.includes('jwt expired') ||
    msg.includes('invalid jwt') ||
    msg.includes('refresh token') ||
    msg.includes('session not found') ||
    msg.includes('auth session missing')
  )
}

export function isNetworkError(err) {
  if (!err) return false
  const msg = String(err.message || err).toLowerCase()
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('load failed') ||
    msg.includes('network request failed')
  )
}

export function loginErrorMessage(err) {
  if (isRateLimitError(err)) {
    return {
      text: 'تعداد تلاش‌های ورود بیش از حد مجاز بوده است. چند دقیقه صبر کنید و دوباره تلاش کنید.',
      kind: 'rate-limited',
      code: 'AUTH_RATE_LIMITED'
    }
  }
  if (isNetworkError(err)) {
    return {
      text: 'ارتباط با سرور احراز هویت برقرار نشد. اتصال اینترنت را بررسی کنید.',
      kind: 'error',
      code: 'AUTH_NETWORK'
    }
  }
  const msg = String((err && err.message) || err || '').toLowerCase()

  if (
    msg.includes('invalid login credentials') ||
    msg.includes('invalid_credentials')
  ) {
    return {
      text: 'ایمیل یا رمز عبور نادرست است.',
      kind: 'error',
      code: 'AUTH_INVALID_CREDENTIALS'
    }
  }
  if (msg.includes('user not found')) {
    return {
      text: 'حساب کاربری با این ایمیل پیدا نشد.',
      kind: 'error',
      code: 'AUTH_USER_NOT_FOUND'
    }
  }
  if (msg.includes('email not confirmed')) {
    return {
      text: 'حساب کاربری هنوز تأیید نشده است. لطفاً با استاد هماهنگ کنید.',
      kind: 'error',
      code: 'AUTH_EMAIL_NOT_CONFIRMED'
    }
  }
  if (isSessionExpiredError(err)) {
    return {
      text: 'نشست کاربری شما منقضی شده است. لطفاً دوباره وارد شوید.',
      kind: 'expired',
      code: 'AUTH_SESSION_EXPIRED'
    }
  }
  return {
    text: 'ورود ناموفق بود. لطفاً دوباره تلاش کنید.',
    kind: 'error',
    code: 'AUTH_FAILED'
  }
}

export function authErrorMessage(where, err) {
  if (isRateLimitError(err)) {
    return {
      text: 'به سقف مجاز درخواست‌ها رسیدید. کمی صبر کنید و دوباره تلاش کنید.',
      kind: 'rate-limited',
      code: 'AUTH_RATE_LIMITED'
    }
  }
  if (isSessionExpiredError(err)) {
    return {
      text: 'نشست کاربری شما منقضی شده است. لطفاً دوباره وارد شوید.',
      kind: 'expired',
      code: 'AUTH_SESSION_EXPIRED'
    }
  }
  if (isNetworkError(err)) {
    return {
      text: 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.',
      kind: 'error',
      code: 'AUTH_NETWORK'
    }
  }
  const msg = String((err && err.message) || err || '').toLowerCase()
  if (msg.includes('invalid login credentials')) {
    return {
      text: 'رمز عبور فعلی نادرست است.',
      kind: 'error',
      code: 'AUTH_INVALID_CREDENTIALS'
    }
  }
  if (msg.includes('same password') || msg.includes('different from the old')) {
    return {
      text: 'رمز عبور تازه باید با رمز فعلی متفاوت باشد.',
      kind: 'error',
      code: 'AUTH_VALIDATION'
    }
  }
  return {
    text: `${where} ناموفق بود. لطفاً دوباره تلاش کنید.`,
    kind: 'error',
    code: 'AUTH_FAILED'
  }
}

// فاز ۴ (R-1): کد پایدار برای بنر خطای عضویت — memberErrorKind در
// auth-store فقط 'transient' | 'expired' | 'not-found' است.
export function memberErrorCode(kind) {
  if (kind === 'transient') return 'MEMBER_READ_TRANSIENT'
  if (kind === 'expired') return 'AUTH_SESSION_EXPIRED'
  if (kind === 'not-found') return 'MEMBER_NOT_FOUND'
  return 'AUTH_FAILED'
}

export const MEMBER_NOT_FOUND_MESSAGE =
  'حساب شما در فهرست اعضای مجاز دوره پیدا نشد. تا زمان ثبت عضویت توسط استاد، امکان دسترسی به دوره وجود ندارد.'

export const SESSION_EXPIRED_MESSAGE =
  'نشست کاربری شما منقضی شده است. لطفاً دوباره وارد شوید.'

// فاز ۳ (F6): رمز درست بود و نشست معتبر ذخیره شده، ولی خواندن عضویت
// از سرور نشد — «ورود ناموفق» نیست؛ وضعیت جداگانه با اقدامِ تلاش دوباره.
export const MEMBER_READ_FAILED_MESSAGE =
  'وارد شدید، ولی خواندن اطلاعات عضویت از سرور نشد. «تلاش دوباره» را بزنید.'

export const STALE_SESSION_CLEARED_MESSAGE =
  'نشست کهنه پاک شد. اکنون با ایمیل و رمز عبور وارد شوید.'

export function validateEmail(email) {
  const clean = (email || '').trim()
  if (!clean) return 'لطفاً ایمیل خود را وارد کنید.'
  const at = clean.lastIndexOf('@')
  if (at <= 0 || at === clean.length - 1) {
    return 'قالب ایمیل معتبر نیست.'
  }
  const domain = clean.slice(at + 1).toLowerCase()
  if (!domain.includes('.') || /\s/.test(clean)) {
    return 'قالب ایمیل معتبر نیست.'
  }
  return null
}

export function validateNewPassword(next, confirm) {
  if (!next || !confirm) return 'رمز تازه و تکرار آن را وارد کنید.'
  if (next.length < 8) return 'رمز تازه باید دست‌کم ۸ نویسه باشد.'
  if (next !== confirm) return 'تکرار رمز تازه با رمز تازه یکسان نیست.'
  return null
}

export function validateChangePassword(current, next, confirm) {
  if (!current || !next || !confirm) return 'هر سه فیلد رمز عبور را کامل وارد کنید.'
  if (next.length < 8) return 'رمز تازه باید دست‌کم ۸ نویسه باشد.'
  if (next !== confirm) return 'تکرار رمز تازه با رمز تازه یکسان نیست.'
  if (next === current) return 'رمز تازه باید با رمز فعلی متفاوت باشد.'
  return null
}
