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

async function checkVersion() {
  if (checking || typeof document === 'undefined') return
  if (document.hidden) return
  checking = true
  try {
    const res = await fetch('version.json', { cache: 'no-store' })
    if (!res.ok) return
    const data = await res.json().catch(() => null)
    const served = data && typeof data.hash === 'string' ? data.hash : null
    if (!served || served === APP_VERSION) return
    if (isBusy()) return
    window.location.reload()
  } catch {
    /* offline or unreachable — stay on the running bundle */
  } finally {
    checking = false
  }
}

/** Start watching: check on route change, when the tab comes back from
 *  the background, and once shortly after load (catches a page that was
 *  restored from cache with an old bundle). Returns a stop function. */
export function startVersionWatch() {
  if (typeof window === 'undefined') return () => {}
  const onHashChange = () => void checkVersion()
  const onVisibility = () => {
    if (!document.hidden) void checkVersion()
  }
  window.addEventListener('hashchange', onHashChange)
  document.addEventListener('visibilitychange', onVisibility)
  const initialTimer = setTimeout(() => void checkVersion(), 5000)
  return () => {
    window.removeEventListener('hashchange', onHashChange)
    document.removeEventListener('visibilitychange', onVisibility)
    clearTimeout(initialTimer)
  }
}
