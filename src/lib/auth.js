// لایه Auth فاز ۱ برای سایت یادگیری ماشین (نسخه دوم)
// ثبت‌نام عمومی بسته است؛ نقش فقط از public.members خوانده می‌شود.

import { sb } from './supabase.js'
import { auth } from './auth-store.svelte.js'
import {
  stashSession,
  clearStashedSession,
  markDeliberateSignOut,
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
  MEMBER_NOT_FOUND_MESSAGE,
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
let fetchMemberRunning = false
let authSubscription = null

export async function fetchMember(user) {
  if (!sb || !user) return null
  if (auth.member && auth.member.auth_id === user.id) return auth.member
  if (fetchMemberRunning) return null

  fetchMemberRunning = true
  try {
    const { data, error } = await sb
      .from('members')
      .select('id, auth_id, role, display_name, username, created_at, updated_at')
      .eq('auth_id', user.id)
      .maybeSingle()

    if (error) {
      if (isSessionExpiredError(error)) {
        auth.resetSession({ expired: true, notice: SESSION_EXPIRED_MESSAGE })
        return null
      }
      auth.member = null
      auth.memberError = 'خطا در خواندن اطلاعات عضویت از سرور. لطفاً دوباره تلاش کنید.'
      return null
    }

    if (!data || !VALID_ROLES.has(data.role)) {
      auth.member = null
      auth.memberError = MEMBER_NOT_FOUND_MESSAGE
      return null
    }

    auth.member = data
    auth.memberError = null
    return data
  } catch {
    auth.member = null
    auth.memberError = 'ارتباط برای بررسی عضویت برقرار نشد.'
    return null
  } finally {
    fetchMemberRunning = false
  }
}

export async function initAuth() {
  if (!sb) {
    auth.initialized = true
    return () => {}
  }

  if (typeof window !== 'undefined' && window.location.hash === '#/reset-password') {
    auth.recoveryMode = true
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
      await deps.onUser(data.session.user)
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
      kind: 'error'
    }
  }

  const emailErr = validateEmail(email)
  if (emailErr) return { ok: false, text: emailErr, kind: 'error' }
  if (!password) return { ok: false, text: 'لطفاً رمز عبور را وارد کنید.', kind: 'error' }

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
      return {
        ok: false,
        text: auth.memberError || MEMBER_NOT_FOUND_MESSAGE,
        kind: 'error'
      }
    }

    return { ok: true, text: 'ورود با موفقیت انجام شد.', kind: 'ok', member }
  } finally {
    auth.loading = false
  }
}

export async function requestPasswordReset(email) {
  if (!sb) {
    return { ok: false, text: 'پیکربندی سرور موجود نیست.', kind: 'error' }
  }
  const emailErr = validateEmail(email)
  if (emailErr) return { ok: false, text: emailErr, kind: 'error' }

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
    return { ok: false, text: 'پیکربندی سرور موجود نیست.', kind: 'error' }
  }
  const bad = validateNewPassword(nextPassword, confirmPassword)
  if (bad) return { ok: false, text: bad, kind: 'error' }

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
    return { ok: false, text: SESSION_EXPIRED_MESSAGE, kind: 'expired' }
  }
  const bad = validateChangePassword(currentPassword, nextPassword, confirmPassword)
  if (bad) return { ok: false, text: bad, kind: 'error' }

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
