// پیام‌های خطای فارسی و اعتبارسنجی ورودی‌ها برای Auth سایت ML
// هیچ رمز یا کلیدی در پیام‌ها بازتاب داده نمی‌شود.
//
// بازنویسی ۲۵ نوامبر ۲۰۲۶ — طبقه‌بندی از روی شکل‌های واقعیِ مشاهده‌شده
// روی سرور زنده (نه حدس و نه شکل‌های ساختگیِ تست‌ها):
//   ورود با رمز نادرست:  400 {"error_code":"invalid_credentials",
//                        "msg":"Invalid login credentials"}
//   refresh مرده:        400 {"error_code":"validation_failed",
//                        "msg":"Refresh token is not valid"}
//   کلید API نامعتبر:    401 {"message":"Invalid API key"} (از گیت‌وی؛
//                        وقتی کلید publishable بیلد ناقص باشد)
//   JWT خراب روی داده:   401 {"code":"PGRST301","message":"..."} (پست‌گرست)
//   کاربر با JWT خراب:   403 {"error_code":"bad_jwt","msg":"..."}
//   عضویتِ anon:         {"code":"42501","message":"permission denied..."}
// درسِ حادثهٔ ۲۵ نوامبر: تشخیص با زیررشتهٔ پیام، شکننده است —
// «Invalid API key» با 401، زیر طبقه‌بندیِ قدیمیِ «هر 401 یعنی منقضی»
// مستقیم به «نشست منقضی شده» می‌رسید. پس طبقه‌بندی فقط با
// status + error_code انجام می‌شود؛ پیام فقط مکملِ آن‌هاست.

// شکل یکتا برای خواندن خطا: supabase-js گاهی code را در err.code و
// گاهی در err.error_code می‌گذارد، و پیام را در message یا msg.
function shapeOf(err) {
  if (!err) return { status: null, code: '', msg: '' }
  const status = err.status ?? err.statusCode ?? null
  const code = String(err.code ?? err.error_code ?? '').toLowerCase()
  const msg = String(err.message ?? err.msg ?? err ?? '').toLowerCase()
  return { status: typeof status === 'number' ? status : null, code, msg }
}

export function errorFingerprint(err) {
  const { status, code, msg } = shapeOf(err)
  return { status, code: code || null, message: msg ? msg.slice(0, 120) : null }
}

export function isRateLimitError(err) {
  const { status, code, msg } = shapeOf(err)
  return (
    status === 429 ||
    code.includes('rate_limit') ||
    code.includes('over_email_send_rate_limit') ||
    code.includes('over_request_rate_limit') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('over_email_send_rate_limit') ||
    msg.includes('over_request_rate_limit')
  )
}

// کلید API نامعتبر (گیت‌وی): بیلد با کلید ناقص/اشتباه. این خطای
// پیکربندیِ سرور است، نه خطای کاربر و نه انقضای نشست — باید با نام
// خودش نشان داده شود تا دوباره پشت «منقضی» یا «ناموفق» پنهان نشود.
export function isInvalidApiKeyError(err) {
  const { status, msg } = shapeOf(err)
  return status === 401 && msg.includes('invalid api key')
}

// «نشست منقضی شده» فقط وقتی درست است که لایهٔ Auth صریحاً بگوید
// refresh token مرده است. شکل واقعیِ مشاهده‌شده: validation_failed با
// «Refresh token is not valid»؛ شکل‌های قدیمی‌تر هم به‌عنوان پشتیبان
// می‌مانند. 401 به‌تنهایی، «JWT expired» روی داده، و «invalid jwt»
// انقضا نیستند — آن‌ها isUnauthorizedError اند (refresh و تکرار).
export function isSessionExpiredError(err) {
  const { code, msg } = shapeOf(err)
  return (
    code === 'session_not_found' ||
    code === 'refresh_token_not_found' ||
    code === 'invalid_refresh_token' ||
    (code === 'validation_failed' && msg.includes('refresh token')) ||
    msg.includes('refresh token not found') ||
    msg.includes('invalid refresh token') ||
    msg.includes('session not found')
  )
}

// 401 لایهٔ داده (PostgREST و جز آن): توکنِ همراه درخواست پذیرفته نشد.
// به‌تنهایی انقضا نیست — توکن ممکن است در همان لحظه در حال چرخش باشد.
// پاسخ درست: یک بار refresh و تکرار همان خواندن؛ فقط اگر refresh هم
// صریحاً بگوید توکن مرده و نشستی زنده نمانده، «منقضی» اعلام می‌شود.
export function isUnauthorizedError(err) {
  const { status, code, msg } = shapeOf(err)
  return (
    status === 401 ||
    code === 'pgrst301' ||
    msg.includes('jwt expired') ||
    msg.includes('invalid jwt') ||
    msg.includes('invalid token')
  )
}

export function isNetworkError(err) {
  const { msg } = shapeOf(err)
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
  if (isInvalidApiKeyError(err)) {
    return {
      text: 'پیکربندی ورود روی سرور خراب است (کلید ارتباط نامعتبر). لطفاً به استاد اطلاع دهید.',
      kind: 'error',
      code: 'AUTH_BAD_API_KEY'
    }
  }
  if (isNetworkError(err)) {
    return {
      text: 'ارتباط با سرور احراز هویت برقرار نشد. اتصال اینترنت را بررسی کنید.',
      kind: 'error',
      code: 'AUTH_NETWORK'
    }
  }
  const { code, msg } = shapeOf(err)

  if (
    code === 'invalid_credentials' ||
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
  if (isInvalidApiKeyError(err)) {
    return {
      text: 'پیکربندی ورود روی سرور خراب است (کلید ارتباط نامعتبر). لطفاً به استاد اطلاع دهید.',
      kind: 'error',
      code: 'AUTH_BAD_API_KEY'
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
  const { msg } = shapeOf(err)
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
