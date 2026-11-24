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
//   in the /launch JSON (Gateway change "phase4-session-header" — approved
//   17:08, deployed ~17:35 on 24 Nov 2026, merge eedc259; the cold test at
//   20:00 proved cell execution with the Bearer header).
//   This client sends BOTH: the header when a session id is known, plus
//   credentials:'include' so the cookie goes too when the browser has it.
//   With an old (pre-eedc259) Gateway the /launch JSON has no session_id,
//   so authed calls 401 — the UI surfaces that honestly instead of faking it.
//
// The session id lives ONLY in module memory. It is never written to
// localStorage / sessionStorage / a cookie / a file.

export class StudioGatewayError extends Error {
  constructor(kind, message, detail = null, code = null, step = null) {
    super(message)
    this.name = 'StudioGatewayError'
    this.kind = kind // 'wake' | 'launch' | 'unauthorized' | 'network' | 'gateway' | 'timeout'
    this.detail = detail
    // فاز ۴ (R-1): کد پایدار خطا + قدمِ افتاده — از بدنهٔ ساخت‌یافتهٔ
    // گیت‌وی (error_code/step) وقتی سرور آن را بدهد؛ وگرنه null و کارت
    // خطا فقط kind را نشان می‌دهد.
    this.code = code
    this.step = step
  }
}

/** Parse a Gateway error body (فاز ۴، R-1). The Gateway returns
 *  {"detail": {"error_code", "step", "message"}} on its own failures;
 *  FastAPI validation failures come as {"detail": [...]}. Returns
 *  {code, step, message} or null when the body carries no structure. */
function parseGatewayErrorBody(text) {
  if (!text) return null
  let body = null
  try {
    body = JSON.parse(text)
  } catch {
    return null
  }
  const d = body && body.detail
  if (d && typeof d === 'object' && !Array.isArray(d) && typeof d.error_code === 'string') {
    return {
      code: d.error_code,
      step: typeof d.step === 'string' ? d.step : null,
      message: typeof d.message === 'string' ? d.message : null
    }
  }
  if (Array.isArray(d) && d.length) {
    return { code: 'VALIDATION_ERROR', step: 'request', message: null }
  }
  return null
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Single wake budget (R-10, فاز ۲ → F4): the 202 loop AND the UI timeout
 *  share this one deadline. Worst case of the v5 loop: first call ~43s
 *  (35s state poll + 8s probe) + 11 x ~18s (8s probe + 10s sleep) = ~241s.
 *  300s leaves margin; StudioView races against this same value (plus a
 *  small grace so the loop's own timeout error — with the last 202 detail
 *  — wins over the generic race error). */
export const WAKE_DEADLINE_MS = 300_000

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
/** Read the wake function's own error body (if any) so the error card can
 *  show the real step that failed instead of the generic non-2xx line.
 *  supabase-js puts the raw Response in error.context; older shapes may
 *  already hold parsed data or a string, so all three are handled. */
async function wakeErrorDetail(error, status) {
  const ctx = error?.context
  let body = null
  try {
    if (ctx && typeof ctx.json === 'function') body = await ctx.json()
    else if (ctx && typeof ctx.text === 'function') body = await ctx.text()
    else if (ctx && typeof ctx === 'object') body = ctx
    else if (typeof ctx === 'string') body = ctx
  } catch {
    body = null
  }
  const fnErr =
    (body && typeof body === 'object' && (body.error || body.message)) ||
    (typeof body === 'string' && body) ||
    null
  const base = error?.message || `status ${status || 'unknown'}`
  const fnPart = fnErr ? String(fnErr).slice(0, 200) : null
  return `wake HTTP ${status || '?'}${fnPart ? ` — ${fnPart}` : ` — ${base}`}`
}

export async function wakeStudio(
  sb,
  { onProgress = () => {}, maxAttempts = 12, deadlineMs = WAKE_DEADLINE_MS } = {}
) {
  if (!sb) {
    throw new StudioGatewayError('wake', 'پیکربندی سرور در این بیلد موجود نیست.')
  }
  const deadline = Date.now() + deadlineMs
  const pastDeadline = () =>
    new StudioGatewayError(
      'wake',
      'استودیو در زمان مقرر بیدار نشد؛ دوباره تلاش کنید.',
      JSON.stringify(lastStarting || null)
    )
  let lastStarting = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (Date.now() >= deadline) throw pastDeadline()
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
      const detail = await wakeErrorDetail(error, status)
      if (status === 401) {
        throw new StudioGatewayError('unauthorized', 'نشست شما منقضی شده است؛ دوباره وارد شوید.', detail)
      }
      if (status === 403) {
        throw new StudioGatewayError('wake', 'این حساب به Jarvis Studio دسترسی ندارد.', detail)
      }
      if (status === 503) {
        throw new StudioGatewayError('wake', 'سرویس بیداری هنوز پیکربندی نشده است.', detail)
      }
      throw new StudioGatewayError('wake', 'بیدار کردن استودیو ناموفق بود.', detail)
    }
    if (data && data.status === 'available' && data.ticket && data.gateway_url) {
      return { ticket: data.ticket, gatewayUrl: data.gateway_url }
    }
    if (data && data.status === 'starting') {
      lastStarting = data
      const waitSec = Number(data.retry_after_seconds ?? 10)
      onProgress({ phase: 'waking', attempt, waitSec, gatewayUrl: data.gateway_url || null })
      // Sleep only up to the deadline: the loop head then throws the
      // timeout error instead of starting another 202 round past it.
      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) continue
      await sleep(Math.min(waitSec * 1000, remainingMs))
      continue
    }
    throw new StudioGatewayError(
      'wake',
      'پاسخ غیرمنتظره از سرویس بیداری.',
      JSON.stringify(data || null)
    )
  }
  throw pastDeadline()
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
    const text = await res.text().catch(() => '')
    const parsed = parseGatewayErrorBody(text)
    throw new StudioGatewayError(
      'launch',
      res.status === 401
        ? 'بلیط ورود منقضی شده است؛ دوباره تلاش کنید.'
        : 'برقراری نشست استودیو ناموفق بود.',
      `launch HTTP ${res.status}${parsed ? ` [${parsed.code}${parsed.step ? ` @ ${parsed.step}` : ''}]` : ''}${parsed?.message ? ` — ${parsed.message}` : text && !parsed ? ` — ${text.slice(0, 200)}` : ''}`,
      parsed?.code || null,
      parsed?.step || null
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

/** Retries for idempotent GETs on transport errors only (R-11, فاز ۲ → F5):
 *  the forwarded-port tunnel intermittently drops responses (HTTP 0 in the
 *  pilot); a dropped GET is safe to retry, a POST /execute or /notebooks
 *  is not (re-running a cell / re-saving). An HTTP status — even a 5xx —
 *  is a real answer and is never retried; only a thrown fetch (no response
 *  at all) retries. Attempts are logged so a flaky tunnel stays visible. */
const GET_RETRY_DELAYS_MS = [500, 1000]

async function gatewayFetch(path, { method = 'GET', body = null, timeoutMs = 150000 } = {}) {
  if (!_gatewayUrl) {
    throw new StudioGatewayError('gateway', 'Gateway متصل نیست.')
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const maxRetries = method === 'GET' ? GET_RETRY_DELAYS_MS.length : 0
  let res
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        res = await fetch(`${_gatewayUrl}${path}`, {
          method,
          credentials: 'include',
          headers: gatewayHeaders(body ? { 'Content-Type': 'application/json' } : {}),
          body: body ? JSON.stringify(body) : null,
          signal: ctrl.signal
        })
        break
      } catch (e) {
        if (e?.name === 'AbortError') {
          throw new StudioGatewayError('timeout', 'پاسخ Gateway دیر رسید (مهلت ۱۵۰ ثانیه).')
        }
        if (attempt < maxRetries) {
          console.warn(
            `[studio-gateway] GET ${path} transport error, retry ${attempt + 1}/${maxRetries}:`,
            e?.message || e
          )
          await sleep(GET_RETRY_DELAYS_MS[attempt])
          continue
        }
        throw new StudioGatewayError('network', 'ارتباط با Gateway قطع شد.', String(e?.message || e))
      }
    }
  } finally {
    clearTimeout(timer)
  }
  if (res.status === 401) {
    const text = await res.text().catch(() => '')
    const parsed = parseGatewayErrorBody(text)
    throw new StudioGatewayError(
      'unauthorized',
      'نشست استودیو معتبر نیست. اگر این خطا تکرار شد، استودیو را ببندید و دوباره باز کنید.',
      `${method} ${path} -> 401 [${parsed?.code || 'SESSION_MISSING'} @ ${parsed?.step || 'session'}]`,
      parsed?.code || 'SESSION_MISSING',
      parsed?.step || 'session'
    )
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const parsed = parseGatewayErrorBody(text)
    throw new StudioGatewayError(
      'gateway',
      `Gateway خطا داد (HTTP ${res.status}).`,
      `${method} ${path} -> ${res.status}${parsed ? ` [${parsed.code}${parsed.step ? ` @ ${parsed.step}` : ''}]` : ''}${parsed?.message ? ` — ${parsed.message}` : text && !parsed ? ` ${text.slice(0, 200)}` : ''}`,
      parsed?.code || null,
      parsed?.step || null
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
