// لایه Auth فاز ۱ برای سایت یادگیری ماشین (نسخه دوم)
// ثبت‌نام عمومی بسته است؛ نقش فقط از public.members خوانده می‌شود.

import { sb, SUPABASE_STORAGE_KEY } from './supabase.js'
import { auth } from './auth-store.svelte.js'
import { handleAuthEvent } from './auth-events.js'
import {
  authErrorMessage,
  loginErrorMessage,
  validateEmail,
  validateNewPassword,
  validateChangePassword,
  isRateLimitError,
  isSessionExpiredError,
  isUnauthorizedError,
  isNetworkError,
  MEMBER_NOT_FOUND_MESSAGE,
  MEMBER_READ_FAILED_MESSAGE,
  STALE_SESSION_CLEARED_MESSAGE,
  SESSION_EXPIRED_MESSAGE
} from './auth-errors.js'

export { handleAuthEvent, isRateLimitError, isSessionExpiredError }

const VALID_ROLES = new Set(['teacher', 'student'])
// فاز ۳ (F6): خواندن عضویت ۳ تلاش با backoff. گاردِ «در حال اجرا» دیگر
// null برنمی‌گرداند — فراخواننده‌های هم‌زمان همان وعدهٔ در حال اجرا را
// می‌گیرند تا یک خواندنِ در جریان، «عضویت پیدا نشد» نشان داده نشود.
const FETCH_MEMBER_ATTEMPTS = 3
const FETCH_MEMBER_BACKOFF_MS = [500, 1500]
let fetchMemberInflight = null
let authSubscription = null

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// تازه‌سازیِ تک‌نمونه‌ایِ نشست (۲۵ نوامبر ۲۰۲۶): فراخواننده‌های هم‌زمان
// همان وعدهٔ در حال اجرا را می‌گیرند تا دو refresh هم‌زمان با یک
// refresh_token مسابقه ندهند — با چرخش توکن، دومی «توکنِ استفاده‌شده»
// است و نشست را می‌سوزاند.
let refreshInflight = null
export async function refreshSessionOnce() {
  if (!sb) return { ok: false, expired: false }
  if (refreshInflight) return refreshInflight
  refreshInflight = (async () => {
    try {
      const { data, error } = await sb.auth.refreshSession()
      if (error) {
        return { ok: false, expired: isSessionExpiredError(error) }
      }
      if (data?.session?.user) return { ok: true, session: data.session }
      return { ok: false, expired: false }
    } catch {
      return { ok: false, expired: false }
    } finally {
      refreshInflight = null
    }
  })()
  return refreshInflight
}

// نشست واقعاً زنده است؟ getSession در supabase-js اگر توکن منقضی شده
// باشد خودش یک بار refresh را امتحان می‌کند، پس «نشست هست» یعنی زنده.
async function sessionIsAlive() {
  if (!sb) return false
  try {
    const { data } = await sb.auth.getSession()
    return Boolean(data?.session?.user)
  } catch {
    return false
  }
}

// «منقضی» فقط وقتی اعلام می‌شود که نشستی زنده نمانده باشد — و در همان
// لحظه، ذخیرهٔ نشست بی‌صدا و کامل پاک می‌شود تا ورود تازه با بقایای
// کهنه قفل نشود. اگر نشست زنده است، false برمی‌گردد و فراخواننده
// خطا را گذرا می‌شمرد، نه منقضی.
async function markExpiredIfDead() {
  if (await sessionIsAlive()) return false
  await clearAllAuthStorage()
  auth.resetSession({ expired: true, notice: SESSION_EXPIRED_MESSAGE })
  auth.memberErrorKind = 'expired'
  return true
}

function isRetryableMemberError(error) {
  if (isSessionExpiredError(error)) return false
  if (isUnauthorizedError(error)) return false
  const status = error?.status || error?.statusCode
  if (typeof status === 'number' && status >= 400 && status < 500) return false
  return true
}

async function fetchMemberAttempt(user) {
  for (let attempt = 1; attempt <= FETCH_MEMBER_ATTEMPTS; attempt++) {
    let data = null
    let error = null
    try {
      const res = await sb
        .from('members')
        .select('id, auth_id, role, display_name, username, created_at, updated_at')
        .eq('auth_id', user.id)
        .maybeSingle()
      data = res.data
      error = res.error
    } catch (e) {
      error = e
    }

    if (!error) {
      if (!data || !VALID_ROLES.has(data.role)) {
        // قطعی: چنین عضویتی نیست — تلاش دوباره بی‌فایده است.
        auth.member = null
        auth.memberError = MEMBER_NOT_FOUND_MESSAGE
        auth.memberErrorKind = 'not-found'
        return null
      }
      auth.member = data
      auth.memberError = null
      auth.memberErrorKind = null
      return data
    }

    if (isUnauthorizedError(error)) {
      // 401 روی خواندن داده، «انقضا» نیست: توکن ممکن است همین لحظه در
      // حال چرخش باشد. یک بار refresh کن و همان خواندن را تکرار کن.
      // فقط وقتی refresh صریحاً بگوید توکن مرده و نشستی هم زنده
      // نمانده، «منقضی» اعلام می‌شود؛ وگرنه نشستِ تازه‌ساخته‌شده با
      // رمز درست حفظ می‌شود و خطا «گذرا» است (دکمهٔ تلاش دوباره).
      const refreshed = await refreshSessionOnce()
      if (refreshed.ok) continue
      if (refreshed.expired && (await markExpiredIfDead())) return null
      auth.member = null
      auth.memberError = MEMBER_READ_FAILED_MESSAGE
      auth.memberErrorKind = 'transient'
      return null
    }

    if (isSessionExpiredError(error)) {
      if (await markExpiredIfDead()) return null
      auth.member = null
      auth.memberError = MEMBER_READ_FAILED_MESSAGE
      auth.memberErrorKind = 'transient'
      return null
    }

    if (attempt < FETCH_MEMBER_ATTEMPTS && isRetryableMemberError(error)) {
      await sleep(FETCH_MEMBER_BACKOFF_MS[attempt - 1] || 1500)
      continue
    }

    auth.member = null
    auth.memberError = 'خطا در خواندن اطلاعات عضویت از سرور. لطفاً دوباره تلاش کنید.'
    auth.memberErrorKind = 'transient'
    return null
  }
  // هر سه تلاش با 401 گذشت ولی refresh هر بار موفق بود: گذرا، نه منقضی.
  if (!auth.member && !auth.memberErrorKind) {
    auth.memberError = MEMBER_READ_FAILED_MESSAGE
    auth.memberErrorKind = 'transient'
  }
  return null
}

export async function fetchMember(user) {
  if (!sb || !user) return null
  if (auth.member && auth.member.auth_id === user.id) return auth.member
  if (fetchMemberInflight) return fetchMemberInflight
  fetchMemberInflight = fetchMemberAttempt(user)
  try {
    return await fetchMemberInflight
  } finally {
    fetchMemberInflight = null
  }
}

// تلاش دوبارهٔ دستیِ خواندن عضویت — از بنر خطا و از بازخورد «وارد شدید
// ولی خواندن عضویت نشد». در صورت موفقیت، فراخواننده به خانه می‌رود.
export async function retryMemberRead() {
  if (!sb || !auth.user) {
    return { ok: false, text: SESSION_EXPIRED_MESSAGE, kind: 'expired', code: 'AUTH_SESSION_EXPIRED' }
  }
  auth.loading = true
  try {
    const member = await fetchMember(auth.user)
    if (member) {
      return { ok: true, text: 'اطلاعات عضویت خوانده شد.', kind: 'ok', member }
    }
    if (auth.memberErrorKind === 'expired') {
      return { ok: false, text: SESSION_EXPIRED_MESSAGE, kind: 'expired', code: 'AUTH_SESSION_EXPIRED' }
    }
    if (auth.memberErrorKind === 'transient') {
      return { ok: false, text: MEMBER_READ_FAILED_MESSAGE, kind: 'member-unread', retryMember: true, code: 'MEMBER_READ_TRANSIENT' }
    }
    return { ok: false, text: auth.memberError || MEMBER_NOT_FOUND_MESSAGE, kind: 'error', code: 'MEMBER_NOT_FOUND' }
  } finally {
    auth.loading = false
  }
}

// پاک‌کردن کاملِ بقایای نشست (۲۵ نوامبر ۲۰۲۶): کلید اصلیِ supabase-js،
// verifier کهنهٔ PKCE همان کلید، و stash قدیمیِ نسخه‌های پیشین.
// عمداً فقط همین کلیدهای ویژهٔ همین سایت پاک می‌شوند — نه هیچ الگوی
// `sb-*` و نه «supabase»: همین origin ‏(syfazel.github.io)‏ میزبان
// sclack_A هم هست و نشستِ آن برنامه با کلید sb-* خودش زنده است؛
// پاک‌کردن کورِ آن‌ها، یاسین را از sclack_A هم بیرون می‌انداخت.
// نسخهٔ پیشین فقط کلید اصلی را پاک می‌کرد و verifier کهنه می‌توانست
// مبادلهٔ PKCE بعدی (بازیابی رمز) را مسموم کند.
// این تابع بی‌صدا است: مسیرِ انقضای واقعی خودش آن را صدا می‌زند و
// کاربر دیگر لازم نیست دستی «نشست کهنه» را پاک کند.
export async function clearAllAuthStorage() {
  if (typeof window === 'undefined') return
  const keys = [
    SUPABASE_STORAGE_KEY,
    `${SUPABASE_STORAGE_KEY}-code-verifier`,
    'ml_v2_stashed_session'
  ]
  const stores = []
  try {
    if (window.localStorage) stores.push(window.localStorage)
  } catch {}
  try {
    if (window.sessionStorage) stores.push(window.sessionStorage)
  } catch {}
  for (const store of stores) {
    for (const key of keys) {
      try {
        store.removeItem(key)
      } catch {}
    }
  }
}

// بقایای قدیمی که دیگر خوانده نمی‌شوند (فقط stash نسخه‌های پیشین):
// در initAuth وقتی نشستی زنده نیست، بی‌صدا پاک می‌شوند تا ورود تازه
// از بقایای کهنه شروع نشود. کلید اصلیِ نشست اینجا دست نمی‌خورد —
// مبادلهٔ PKCE بازیابی ممکن است همان لحظه در حال تکمیل باشد.
function clearLegacyAuthKeys() {
  if (typeof window === 'undefined') return
  try {
    if (window.localStorage) window.localStorage.removeItem('ml_v2_stashed_session')
  } catch {}
  try {
    if (window.sessionStorage) window.sessionStorage.removeItem('ml_v2_stashed_session')
  } catch {}
}

// پاک‌کردن نشست کهنه و ورود تازه — حالا خودکار و بی‌صدا در مسیر انقضا
// انجام می‌شود؛ این تابع فقط برای سازگاریِ فراخواننده‌های قدیمی مانده
// است و دیگر دکمه‌ای در صفحهٔ ورود ندارد.
export async function clearStaleSession() {
  try {
    if (sb) await sb.auth.signOut()
  } catch {}
  await clearAllAuthStorage()
  auth.resetSession({ expired: false, notice: null })
  return { ok: true, text: STALE_SESSION_CLEARED_MESSAGE, kind: 'ok' }
}

export async function initAuth() {
  if (!sb) {
    auth.initialized = true
    return () => {}
  }

  if (typeof window !== 'undefined') {
    // تشخیص فرود بازیابی رمز، فقط از هش (۲۵ نوامبر ۲۰۲۶): نسخهٔ پیشین
    // هر `?code=` در آدرس را «بازیابی» می‌شمرد و فرم «تعیین رمز تازه»
    // را جای فرم ورود می‌نشاند — حتی برای پیوندی که code از جای دیگری
    // آمده بود. فرود واقعیِ بازیابی همیشه هش #/reset-password را دارد
    // (redirectTo همان است)؛ و اگر هش نباشد، رویداد PASSWORD_RECOVERY
    // خودِ supabase-js (detectSessionInUrl) همان کار را می‌کند.
    const isRecoveryLanding =
      window.location.hash === '#/reset-password' ||
      window.location.hash.includes('type=recovery')
    if (isRecoveryLanding) {
      auth.recoveryMode = true
    }
  }

  const deps = {
    sb,
    async onUser(user) {
      auth.user = user
      auth.sessionExpired = false
      auth.sessionNotice = null
      await fetchMember(user)
    },
    async onRecovery(session) {
      if (session?.user) {
        auth.user = session.user
      }
      auth.recoveryMode = true
      auth.sessionExpired = false
      if (
        typeof window !== 'undefined' &&
        window.location.hash !== '#/reset-password'
      ) {
        window.location.hash = '#/reset-password'
      }
    },
    async onSignedOut() {
      auth.resetSession({ expired: false, notice: null })
    }
  }

  if (authSubscription) {
    authSubscription.unsubscribe()
    authSubscription = null
  }

  const { data: listener } = sb.auth.onAuthStateChange((event, session) => {
    void handleAuthEvent(event, session, deps)
  })
  authSubscription = listener?.subscription || null

  auth.loading = true
  try {
    const { data } = await sb.auth.getSession()
    if (data?.session?.user) {
      if (auth.recoveryMode) {
        // نشست از پیوند بازیابی آمده، نه از ورود عادی: فرم تعیین رمز تازه
        // نشان داده شود، نه خانه.
        await deps.onRecovery(data.session)
      } else {
        await deps.onUser(data.session.user)
      }
    }
    // بدون نشست: فقط فرم سادهٔ ورود. هیچ بازیابیِ دستی و هیچ دیوار
    // «منقضی شده» نیست — تنها منبع نشست، ذخیرهٔ خود supabase-js است.
    // فقط بقایای قدیمیِ ناخوانا پاک می‌شوند تا ورود تازه تمیز شروع شود.
    if (!data?.session?.user) clearLegacyAuthKeys()
  } finally {
    auth.loading = false
    auth.initialized = true
  }

  return () => {
    if (authSubscription) {
      authSubscription.unsubscribe()
      authSubscription = null
    }
  }
}

export async function signIn(email, password) {
  if (!sb) {
    return {
      ok: false,
      text: 'پیکربندی سرور احراز هویت در این بیلد موجود نیست.',
      kind: 'error',
      code: 'AUTH_NO_CONFIG'
    }
  }

  const emailErr = validateEmail(email)
  if (emailErr) return { ok: false, text: emailErr, kind: 'error', code: 'AUTH_VALIDATION' }
  if (!password) return { ok: false, text: 'لطفاً رمز عبور را وارد کنید.', kind: 'error', code: 'AUTH_VALIDATION' }

  const cleanEmail = email.trim().toLowerCase()
  auth.loading = true
  try {
    const { data, error } = await sb.auth.signInWithPassword({
      email: cleanEmail,
      password
    })
    if (error) return { ok: false, ...loginErrorMessage(error) }

    auth.user = data.user
    auth.sessionExpired = false
    auth.sessionNotice = null

    const member = await fetchMember(data.user)
    if (!member) {
      // فاز ۳ (F6): موفقیت رمز و شکستِ خواندن عضویت دو وضعیت جدا هستند.
      // نشست معتبر ذخیره شده است؛ «ورود ناموفق» دروغ است. فقط وقتی
      // عضویت واقعاً پیدا نشد (not-found) یا نشست منقضی است، ورود رد
      // می‌شود؛ در شکستِ گذرا، کاربر وارد شده می‌ماند و «تلاش دوباره»
      // می‌زند.
      if (auth.memberErrorKind === 'transient') {
        return {
          ok: false,
          kind: 'member-unread',
          retryMember: true,
          code: 'MEMBER_READ_TRANSIENT',
          text: MEMBER_READ_FAILED_MESSAGE
        }
      }
      if (auth.memberErrorKind === 'expired') {
        return { ok: false, text: SESSION_EXPIRED_MESSAGE, kind: 'expired', code: 'AUTH_SESSION_EXPIRED' }
      }
      return {
        ok: false,
        text: auth.memberError || MEMBER_NOT_FOUND_MESSAGE,
        kind: 'error',
        code: 'MEMBER_NOT_FOUND'
      }
    }

    return { ok: true, text: 'ورود با موفقیت انجام شد.', kind: 'ok', member }
  } finally {
    auth.loading = false
  }
}

export async function requestPasswordReset(email) {
  if (!sb) {
    return { ok: false, text: 'پیکربندی سرور موجود نیست.', kind: 'error', code: 'AUTH_NO_CONFIG' }
  }
  const emailErr = validateEmail(email)
  if (emailErr) return { ok: false, text: emailErr, kind: 'error', code: 'AUTH_VALIDATION' }

  const cleanEmail = email.trim().toLowerCase()
  const redirectTo =
    typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}#/reset-password`
      : undefined

  const { error } = await sb.auth.resetPasswordForEmail(cleanEmail, {
    redirectTo
  })
  if (error) return { ok: false, ...authErrorMessage('ارسال پیوند بازیابی رمز', error) }

  return {
    ok: true,
    text: `پیوند بازیابی رمز به ${cleanEmail} فرستاده شد. صندوق ایمیل و پوشهٔ اسپم را بررسی کنید.`,
    kind: 'ok'
  }
}

export async function completePasswordReset(nextPassword, confirmPassword) {
  if (!sb) {
    return { ok: false, text: 'پیکربندی سرور موجود نیست.', kind: 'error', code: 'AUTH_NO_CONFIG' }
  }
  const bad = validateNewPassword(nextPassword, confirmPassword)
  if (bad) return { ok: false, text: bad, kind: 'error', code: 'AUTH_VALIDATION' }

  const { error } = await sb.auth.updateUser({ password: nextPassword })
  if (error) return { ok: false, ...authErrorMessage('ثبت رمز تازه', error) }

  auth.recoveryMode = false
  if (typeof window !== 'undefined' && window.location.hash === '#/reset-password') {
    window.location.hash = '#/'
  }
  return {
    ok: true,
    text: 'رمز عبور تازه ثبت شد. اکنون می‌توانید با رمز جدید وارد شوید.',
    kind: 'ok'
  }
}

export async function changePassword(currentPassword, nextPassword, confirmPassword) {
  if (!sb || !auth.user?.email) {
    return { ok: false, text: SESSION_EXPIRED_MESSAGE, kind: 'expired', code: 'AUTH_SESSION_EXPIRED' }
  }
  const bad = validateChangePassword(currentPassword, nextPassword, confirmPassword)
  if (bad) return { ok: false, text: bad, kind: 'error', code: 'AUTH_VALIDATION' }

  const { error: verifyErr } = await sb.auth.signInWithPassword({
    email: auth.user.email,
    password: currentPassword
  })
  if (verifyErr) return { ok: false, ...authErrorMessage('تأیید رمز فعلی', verifyErr) }

  const { error } = await sb.auth.updateUser({ password: nextPassword })
  if (error) return { ok: false, ...authErrorMessage('تغییر رمز عبور', error) }

  return { ok: true, text: 'رمز عبور با موفقیت تغییر کرد.', kind: 'ok' }
}

export async function updateDisplayName(displayName) {
  if (!sb || !auth.canOperate || !auth.member) {
    throw new Error('ابتدا با حساب معتبر وارد شوید.')
  }
  const clean = (displayName || '').trim()
  if (!clean) throw new Error('نام نمایشی را وارد کنید.')
  if (clean.length > 80) throw new Error('نام نمایشی نباید بیشتر از ۸۰ نویسه باشد.')

  const { data, error } = await sb
    .from('members')
    .update({ display_name: clean, updated_at: new Date().toISOString() })
    .eq('auth_id', auth.user.id)
    .select('id, auth_id, role, display_name, username, created_at, updated_at')
    .single()

  if (error) {
    if (isSessionExpiredError(error)) {
      auth.resetSession({ expired: true, notice: SESSION_EXPIRED_MESSAGE })
      throw new Error(SESSION_EXPIRED_MESSAGE)
    }
    throw new Error('ذخیره نام نمایشی ناموفق بود.')
  }

  auth.member = data
  return data
}

export async function signOut() {
  try {
    if (sb) await sb.auth.signOut()
  } finally {
    await clearAllAuthStorage()
    auth.resetSession({ expired: false, notice: null })
  }
}
