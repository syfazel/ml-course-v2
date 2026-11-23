// مدیریت رویدادهای نشست (اقتباس‌شده از auth-events.js در sclack_A)

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
    if (parsed && parsed.refresh_token) return parsed
    return null
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
