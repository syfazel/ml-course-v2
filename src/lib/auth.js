// لایه Auth فاز ۱ برای سایت یادگیری ماشین (نسخه دوم)
// ثبت‌نام عمومی بسته است؛ نقش فقط از public.members خوانده می‌شود.

import { sb, SUPABASE_STORAGE_KEY } from './supabase.js'
import { auth } from './auth-store.svelte.js'
import {
  stashSession,
  clearStashedSession,
  markDeliberateSignOut,
  consumeDeliberateSignOut,
  handleAuthEvent,
  recoverStashedSession
} from './auth-events.js'
import {
  authErrorMessage,
  loginErrorMessage,
  validateEmail,
  validateNewPassword,
  validateChangePassword,
  isRateLimitError,
  isSessionExpiredError,
  isNetworkError,
  MEMBER_NOT_FOUND_MESSAGE,
  MEMBER_READ_FAILED_MESSAGE,
  STALE_SESSION_CLEARED_MESSAGE,
  SESSION_EXPIRED_MESSAGE
} from './auth-errors.js'

export {
  handleAuthEvent,
  stashSession,
  clearStashedSession,
  isRateLimitError,
  isSessionExpiredError
}

const VALID_ROLES = new Set(['teacher', 'student'])
// فاز ۳ (F6): خواندن عضویت ۳ تلاش با backoff. گاردِ «در حال اجرا» دیگر
// null برنمی‌گرداند — فراخواننده‌های هم‌زمان همان وعدهٔ در حال اجرا را
// می‌گیرند تا یک خواندنِ در جریان، «عضویت پیدا نشد» نشان داده نشود.
const FETCH_MEMBER_ATTEMPTS = 3
const FETCH_MEMBER_BACKOFF_MS = [500, 1500]
let fetchMemberInflight = null
let authSubscription = null

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function isRetryableMemberError(error) {
  if (isSessionExpiredError(error)) return false
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

    if (isSessionExpiredError(error)) {
      auth.resetSession({ expired: true, notice: SESSION_EXPIRED_MESSAGE })
      auth.memberErrorKind = 'expired'
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

// پاک‌کردن نشست کهنه و ورود تازه (فاز ۳، F6): برای وقتی که نشستِ
// ذخیره‌شده کهنه/خراب است و ورود تازه پشت «نشست منقضی شده» قفل شده.
// ترتیب مهم است: اول stash پاک می‌شود تا رویداد SIGNED_OUTِ ناشی از
// signOut با همان stashِ کهنه بازیابی نکند؛ بعد signOut؛ و اگر signOut
// به‌خاطر شبکه ناموفق بود، کلید ذخیرهٔ خودِ supabase-js هم مستقیم
// پاک می‌شود تا نشست کهنه دوباره خوانده نشود.
export async function clearStaleSession() {
  markDeliberateSignOut(true)
  clearStashedSession()
  try {
    if (sb) await sb.auth.signOut()
  } catch {
    consumeDeliberateSignOut()
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(SUPABASE_STORAGE_KEY)
    }
  } catch {
    // نادیده گرفته می‌شود
  }
  auth.resetSession({ expired: false, notice: null })
  return { ok: true, text: STALE_SESSION_CLEARED_MESSAGE, kind: 'ok' }
}

export async function initAuth() {
  if (!sb) {
    auth.initialized = true
    return () => {}
  }

  if (typeof window !== 'undefined') {
    // تشخیص فرود بازیابی رمز، مستقل از رویداد PASSWORD_RECOVERY (که ممکن است
    // پیش از ثبت اشتراک شلیک شده باشد): هش #/reset-password، یا ?code= در
    // نشانی (پیوند PKCE)، یا type=recovery در هش (پیوند توکن ضمنی).
    // نکته: پیوند بازیابیِ فرستاده‌شده از داشبورد Supabase با کلاینت PKCE
    // کار نمی‌کند، چون code_verifier فقط در مرورگری ذخیره می‌شود که درخواست
    // بازیابی از همان‌جا (فرم «فراموشی رمز» سایت) فرستاده شده باشد؛ پس
    // بازیابی همیشه باید از خود سایت آغاز شود، نه از داشبورد.
    const url = new URL(window.location.href)
    const isRecoveryLanding =
      window.location.hash === '#/reset-password' ||
      url.searchParams.has('code') ||
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
    },
    async onExpired() {
      auth.resetSession({ expired: true, notice: SESSION_EXPIRED_MESSAGE })
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
      stashSession(data.session)
      if (auth.recoveryMode) {
        // نشست از پیوند بازیابی آمده، نه از ورود عادی: فرم تعیین رمز تازه
        // نشان داده شود، نه خانه.
        await deps.onRecovery(data.session)
      } else {
        await deps.onUser(data.session.user)
      }
    } else {
      const recovered = await recoverStashedSession(sb)
      if (recovered?.user) {
        await deps.onUser(recovered.user)
      }
    }
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
    stashSession(data.session)

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
  markDeliberateSignOut(true)
  clearStashedSession()
  try {
    if (sb) await sb.auth.signOut()
  } finally {
    auth.resetSession({ expired: false, notice: null })
  }
}
