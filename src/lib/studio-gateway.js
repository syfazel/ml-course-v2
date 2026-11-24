// Jarvis Studio — Gateway client (Phase 4).
// Talks to the wake Edge Function (Supabase) and the Gateway running in the
// pilot Codespace. HTTP polling only: browser WebSocket through the forwarded
// Codespaces port is broken (4 failed attempts in the pilot), so no browser
// WebSocket is designed into this path.
//
// Auth — the part that matters:
//   The Gateway issues a server-side session at GET /launch and sets the
//   `studio_session` cookie (HttpOnly; Secure; SameSite=Lax). A Lax cookie is
//   NOT sent by the browser on a cross-site fetch (github.io -> github.dev),
//   so the cookie alone cannot authenticate the Studio UI. The Gateway must
//   ALSO accept `Authorization: Bearer <session_id>` and return `session_id`
//   in the /launch JSON (Gateway change "phase4-session-header", pending
//   Yasin's go-ahead after the execution-risk check on the pilot repo).
//   This client sends BOTH: the header when a session id is known, plus
//   credentials:'include' so the cookie goes too when the browser has it.
//   With the current (Phase 3) Gateway the /launch JSON has no session_id,
//   so authed calls 401 — the UI surfaces that honestly instead of faking it.
//
// The session id lives ONLY in module memory. It is never written to
// localStorage / sessionStorage / a cookie / a file.

export class StudioGatewayError extends Error {
  constructor(kind, message, detail = null) {
    super(message)
    this.name = 'StudioGatewayError'
    this.kind = kind // 'wake' | 'launch' | 'unauthorized' | 'network' | 'gateway' | 'timeout'
    this.detail = detail
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let _sessionId = null
let _gatewayUrl = null

export function getStudioSessionId() {
  return _sessionId
}

export function clearStudioSession() {
  _sessionId = null
  _gatewayUrl = null
}

/** Call the wake Edge Function with the student's Supabase JWT.
 *  Handles the 202 "starting" reply by retrying after `retry_after_seconds`.
 *  Returns { ticket, gatewayUrl }. Throws StudioGatewayError on failure. */
export async function wakeStudio(sb, { onProgress = () => {}, maxAttempts = 12 } = {}) {
  if (!sb) {
    throw new StudioGatewayError('wake', 'پیکربندی سرور در این بیلد موجود نیست.')
  }
  let lastStarting = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let data = null
    let error = null
    try {
      const res = await sb.functions.invoke('wake', { method: 'POST' })
      data = res.data
      error = res.error
    } catch (e) {
      throw new StudioGatewayError('network', 'ارتباط با سرور بیداری برقرار نشد.', String(e?.message || e))
    }
    if (error) {
      const status = error?.context?.status || error?.status
      if (status === 401) {
        throw new StudioGatewayError('unauthorized', 'نشست شما منقضی شده است؛ دوباره وارد شوید.')
      }
      if (status === 403) {
        throw new StudioGatewayError('wake', 'این حساب به Jarvis Studio دسترسی ندارد.')
      }
      if (status === 503) {
        throw new StudioGatewayError('wake', 'سرویس بیداری هنوز پیکربندی نشده است.')
      }
      throw new StudioGatewayError(
        'wake',
        'بیدار کردن استودیو ناموفق بود.',
        error?.message || `status ${status || 'unknown'}`
      )
    }
    if (data && data.status === 'available' && data.ticket && data.gateway_url) {
      return { ticket: data.ticket, gatewayUrl: data.gateway_url }
    }
    if (data && data.status === 'starting') {
      lastStarting = data
      const waitSec = Number(data.retry_after_seconds ?? 10)
      onProgress({ phase: 'waking', attempt, waitSec, gatewayUrl: data.gateway_url || null })
      await sleep(waitSec * 1000)
      continue
    }
    throw new StudioGatewayError(
      'wake',
      'پاسخ غیرمنتظره از سرویس بیداری.',
      JSON.stringify(data || null)
    )
  }
  throw new StudioGatewayError(
    'wake',
    'استودیو در زمان مقرر بیدار نشد؛ دوباره تلاش کنید.',
    JSON.stringify(lastStarting || null)
  )
}

/** Exchange a one-time ticket for a session at GET /launch.
 *  Returns { user, role, sessionId } — sessionId is null on the Phase 3
 *  Gateway (no session_id in the JSON yet), non-null after the Phase 4
 *  Gateway change. The ticket is consumed by this call (one-time, 30s). */
export async function launchStudioSession(gatewayUrl, ticket) {
  let res
  try {
    res = await fetch(`${gatewayUrl}/launch?ticket=${encodeURIComponent(ticket)}`, {
      credentials: 'include'
    })
  } catch (e) {
    throw new StudioGatewayError('network', 'ارتباط با Gateway برقرار نشد.', String(e?.message || e))
  }
  if (!res.ok) {
    throw new StudioGatewayError(
      'launch',
      res.status === 401
        ? 'بلیط ورود منقضی شده است؛ دوباره تلاش کنید.'
        : 'برقراری نشست استودیو ناموفق بود.',
      `launch HTTP ${res.status}`
    )
  }
  const data = await res.json().catch(() => ({}))
  _gatewayUrl = gatewayUrl
  _sessionId = typeof data.session_id === 'string' && data.session_id ? data.session_id : null
  return { user: data.user || null, role: data.role || null, sessionId: _sessionId }
}

function gatewayHeaders(extra = {}) {
  const headers = { ...extra }
  if (_sessionId) headers['Authorization'] = `Bearer ${_sessionId}`
  return headers
}

async function gatewayFetch(path, { method = 'GET', body = null, timeoutMs = 150000 } = {}) {
  if (!_gatewayUrl) {
    throw new StudioGatewayError('gateway', 'Gateway متصل نیست.')
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res
  try {
    res = await fetch(`${_gatewayUrl}${path}`, {
      method,
      credentials: 'include',
      headers: gatewayHeaders(body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : null,
      signal: ctrl.signal
    })
  } catch (e) {
    if (e?.name === 'AbortError') {
      throw new StudioGatewayError('timeout', 'پاسخ Gateway دیر رسید (مهلت ۱۵۰ ثانیه).')
    }
    throw new StudioGatewayError('network', 'ارتباط با Gateway قطع شد.', String(e?.message || e))
  } finally {
    clearTimeout(timer)
  }
  if (res.status === 401) {
    throw new StudioGatewayError(
      'unauthorized',
      'نشست استودیو معتبر نیست. اگر این خطا تکرار شد، استودیو را ببندید و دوباره باز کنید.',
      `${method} ${path} -> 401`
    )
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new StudioGatewayError(
      'gateway',
      `Gateway خطا داد (HTTP ${res.status}).`,
      `${method} ${path} -> ${res.status} ${text.slice(0, 200)}`
    )
  }
  return res.json().catch(() => ({}))
}

/** A bound Gateway handle. All calls need a session from launchStudioSession. */
export function studioGateway(gatewayUrl) {
  if (gatewayUrl) _gatewayUrl = gatewayUrl
  return {
    get gatewayUrl() {
      return _gatewayUrl
    },
    get hasSessionHeader() {
      return Boolean(_sessionId)
    },
    status: () => gatewayFetch('/status', { timeoutMs: 30000 }),
    execute: (code, notebook) =>
      gatewayFetch('/execute', { method: 'POST', body: { code, notebook } }),
    listNotebooks: () => gatewayFetch('/notebooks', { timeoutMs: 30000 }),
    saveNotebook: (name, content) =>
      gatewayFetch('/notebooks', { method: 'POST', body: { name, content }, timeoutMs: 30000 }),
    loadNotebook: (name) =>
      gatewayFetch(`/notebooks/${encodeURIComponent(name)}`, { timeoutMs: 30000 })
  }
}
