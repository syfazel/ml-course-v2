// مدیریت رویدادهای نشست (اقتباس‌شده از auth-events.js در sclack_A)
//
// نشست — تک‌منبع (فاز ۳، F6):
// منبع حقیقتِ نشست، ذخیرهٔ خودِ supabase-js است (کلید ml-course-v2-auth)؛
// stash دستیِ اینجا فقط fallback برای دو مسیر است: رویداد SIGNED_OUT و
// خالی‌بودن getSession در initAuth. به stashِ منقضی هرگز اعتماد نمی‌شود —
// readStashedSession ورودیِ منقضی را پاک می‌کند و null برمی‌گرداند — تا
// چرخهٔ «نشست منقضی شده» از stash کهنه ساخته نشود.

const STASH_KEY = 'ml_v2_stashed_session'
let deliberateSignOut = false
let recoveryInFlight = false

function getStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage
    }
  } catch {
    // نادیده گرفته می‌شود
  }
  return null
}

export function stashSession(session) {
  if (!session || !session.refresh_token || !session.access_token) return
  // نشستِ همین حالا منقضی را اصلاً stash نکن — وگرنه fallback بعدی
  // با همان نشست مرده تلاش می‌کند و چرخهٔ «منقضی شده» می‌سازد.
  if (
    typeof session.expires_at === 'number' &&
    session.expires_at * 1000 <= Date.now()
  ) {
    return
  }
  const storage = getStorage()
  if (!storage) return
  try {
    storage.setItem(
      STASH_KEY,
      JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at || null,
        user_id: session.user?.id || null,
        stashed_at: Date.now()
      })
    )
  } catch {
    // نادیده گرفته می‌شود
  }
}

export function readStashedSession() {
  const storage = getStorage()
  if (!storage) return null
  try {
    const raw = storage.getItem(STASH_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !parsed.refresh_token) return null
    // چک انقضا — فقط fallback: ورودیِ منقضی را پاک کن و null بده؛
    // با نشست مرده هرگز refreshSession صدا زده نمی‌شود.
    if (
      typeof parsed.expires_at === 'number' &&
      parsed.expires_at * 1000 <= Date.now()
    ) {
      clearStashedSession()
      return null
    }
    if (
      !parsed.expires_at &&
      typeof parsed.stashed_at === 'number' &&
      Date.now() - parsed.stashed_at > 7 * 24 * 60 * 60 * 1000
    ) {
      clearStashedSession()
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function clearStashedSession() {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.removeItem(STASH_KEY)
  } catch {
    // نادیده گرفته می‌شود
  }
}

export function markDeliberateSignOut(flag = true) {
  deliberateSignOut = Boolean(flag)
}

export function consumeDeliberateSignOut() {
  const was = deliberateSignOut
  deliberateSignOut = false
  return was
}

export async function recoverStashedSession(sb) {
  if (!sb || recoveryInFlight) return null
  const stashed = readStashedSession()
  if (!stashed || !stashed.refresh_token) return null

  recoveryInFlight = true
  try {
    const { data, error } = await sb.auth.refreshSession({
      refresh_token: stashed.refresh_token
    })
    if (!error && data?.session?.user) {
      stashSession(data.session)
      return data.session
    }
    clearStashedSession()
    return null
  } catch {
    return null
  } finally {
    recoveryInFlight = false
  }
}

export async function handleAuthEvent(event, session, deps) {
  const { sb, onUser, onSignedOut, onRecovery, onExpired } = deps

  if (event === 'PASSWORD_RECOVERY') {
    if (session) stashSession(session)
    if (onRecovery) await onRecovery(session)
    return
  }

  if (event === 'SIGNED_OUT') {
    if (consumeDeliberateSignOut()) {
      clearStashedSession()
      if (onSignedOut) await onSignedOut()
      return
    }
    const recovered = await recoverStashedSession(sb)
    if (recovered && recovered.user) {
      if (onUser) await onUser(recovered.user, recovered)
      return
    }
    clearStashedSession()
    if (onExpired) await onExpired()
    return
  }

  if (session && session.user) {
    stashSession(session)
    if (onUser) await onUser(session.user, session)
    return
  }

  if (sb) {
    const { data } = await sb.auth.getSession()
    if (data?.session?.user) {
      stashSession(data.session)
      if (onUser) await onUser(data.session.user, data.session)
      return
    }
    const recovered = await recoverStashedSession(sb)
    if (recovered && recovered.user) {
      if (onUser) await onUser(recovered.user, recovered)
      return
    }
  }
}
