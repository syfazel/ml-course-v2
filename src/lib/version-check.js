// Phase R0 — automatic stale-bundle detection.
// The running bundle embeds __APP_VERSION__ (git short hash, set by Vite
// define in vite.config.js) and every build emits version.json with the
// same hash. When the served hash differs from the running one, the app
// hard-reloads — in-app hash navigation never reloads the JS by itself,
// which is exactly how the 2026-11-24 18:54 opening fix sat undeployed
// on the user's phone while the live site already had it.
//
// Safety: NEVER reload while the user is busy — a cell is running, the
// opening is playing, the wake is in progress, or the user is typing in
// an input. Callers mark busy reasons with setBusy/clearBusy; typing is
// detected directly from document.activeElement.
export const APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'

// رفع F2 — پولینگ دوره‌ای نسخه: هر ۲ دقیقه (فقط وقتی تب نمایان و
// بی‌کار است؛ checkVersion خودش تب پنهان یا مشغول را رد می‌کند).
export const VERSION_POLL_MS = 120_000

const busyReasons = new Set()

export function setBusy(reason) {
  busyReasons.add(reason)
}

export function clearBusy(reason) {
  busyReasons.delete(reason)
}

function isTyping() {
  const el = typeof document !== 'undefined' ? document.activeElement : null
  if (!el) return false
  const tag = (el.tagName || '').toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  return el.isContentEditable === true
}

export function isBusy() {
  return busyReasons.size > 0 || isTyping()
}

let checking = false

/** Fetch the served version hash; null when unreachable or malformed.
 *  Never throws and never reloads — safe to call before a wake. */
async function fetchServedHash() {
  try {
    const res = await fetch('version.json', { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    const served = data && typeof data.hash === 'string' ? data.hash : null
    return served
  } catch {
    /* offline or unreachable — stay on the running bundle */
    return null
  }
}

async function checkVersion() {
  if (checking || typeof document === 'undefined') return
  if (document.hidden) return
  checking = true
  try {
    const served = await fetchServedHash()
    if (!served || served === APP_VERSION) return
    if (isBusy()) return
    window.location.reload()
  } finally {
    checking = false
  }
}

/** رفع F2 — چک صریح نسخه پیش از بیداری: true یعنی نسخهٔ تازه‌ای روی
 *  سرور هست و بیداری باید با باندل تازه شروع شود (رفرش). false یعنی یا
 *  نسخه همان است یا چک ناموفق شد (شبکه) — در هر دو حالت بیداری با همین
 *  باندل ادامه می‌یابد و هرگز مسدود نمی‌شود. خودش رفرش نمی‌کند. */
export async function isFreshVersionAvailable() {
  if (typeof document === 'undefined') return false
  if (document.hidden) return false
  const served = await fetchServedHash()
  return served !== null && served !== APP_VERSION
}

/** Start watching: check on route change, when the tab comes back from
 *  the background, once shortly after load (catches a page that was
 *  restored from cache with an old bundle), and every 2 minutes while
 *  the tab is visible (رفع F2 — تبی که ساعت‌ها باز مانده، نسخهٔ تازه را
 *  خودش می‌بیند؛ checkVersion خودش تب پنهان یا مشغول را رد می‌کند).
 *  Returns a stop function. */
export function startVersionWatch() {
  if (typeof window === 'undefined') return () => {}
  const onHashChange = () => void checkVersion()
  const onVisibility = () => {
    if (!document.hidden) void checkVersion()
  }
  window.addEventListener('hashchange', onHashChange)
  document.addEventListener('visibilitychange', onVisibility)
  const initialTimer = setTimeout(() => void checkVersion(), 5000)
  const pollTimer = setInterval(() => void checkVersion(), VERSION_POLL_MS)
  return () => {
    window.removeEventListener('hashchange', onHashChange)
    document.removeEventListener('visibilitychange', onVisibility)
    clearTimeout(initialTimer)
    clearInterval(pollTimer)
  }
}
