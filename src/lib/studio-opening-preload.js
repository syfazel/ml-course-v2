// Jarvis Studio — Opening asset preloader (Phase R1).
// Loads the 6 WebP images + 3 MP3s the cinematic opening needs, with
// Promise.allSettled semantics: one bad asset never blocks the show.
// Each asset gets up to 2 retries with exponential backoff (400ms, 800ms).
// A final failure is reported (never thrown) so the opening can paint a
// visible golden-emerald fallback and name the asset in the saffron bar.
//
// Result shape per asset:
//   { key, kind: 'image'|'audio', label, src,
//     status: 'loaded'|'failed', attempts, error, detail }
// error is one of: 'load-error' | 'timeout' | 'empty' | 'test-blocked'.

export const OPENING_ASSETS = [
  { key: 'emblem', kind: 'image', label: 'نشان عقاب', src: 'studio-opening/emblem.webp' },
  { key: 'emblemBaseOpen', kind: 'image', label: 'نشان (منقار باز)', src: 'studio-opening/emblemBaseOpen.webp' },
  { key: 'lowerBeak', kind: 'image', label: 'منقار پایین', src: 'studio-opening/lowerBeak.webp' },
  { key: 'upperBeak', kind: 'image', label: 'منقار بالا', src: 'studio-opening/upperBeak.webp' },
  { key: 'wordmarkLight', kind: 'image', label: 'لوگوی متنی (روشن)', src: 'studio-opening/wordmarkLight.webp' },
  { key: 'wordmarkDark', kind: 'image', label: 'لوگوی متنی (تیره)', src: 'studio-opening/wordmarkDark.webp' },
  { key: 'intro', kind: 'audio', label: 'صدای ورودی', src: 'studio-opening/intro.mp3' },
  { key: 'eagle', kind: 'audio', label: 'غرش عقاب', src: 'studio-opening/eagle.mp3' },
  { key: 'jarvis', kind: 'audio', label: 'صدای جارویس', src: 'studio-opening/jarvis.mp3' }
]

export const MAX_RETRIES = 2
export const RETRY_BASE_MS = 400
export const ASSET_TIMEOUT_MS = 8000

export const ERROR_LABELS = {
  'load-error': 'لود نشد',
  timeout: 'مهلت لود تمام شد',
  empty: 'فایل خالی رسید',
  'test-blocked': 'در تست مسدود شد'
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function loadImageOnce(src) {
  return new Promise((resolve, reject) => {
    const im = new Image()
    const timer = setTimeout(() => {
      im.onload = null
      im.onerror = null
      reject({ code: 'timeout', el: im })
    }, ASSET_TIMEOUT_MS)
    im.onload = () => {
      clearTimeout(timer)
      if (im.naturalWidth > 0) resolve(im)
      else reject({ code: 'empty', el: im })
    }
    im.onerror = () => {
      clearTimeout(timer)
      reject({ code: 'load-error', el: im })
    }
    im.src = src
  })
}

function loadAudioOnce(src) {
  return new Promise((resolve, reject) => {
    const au = new Audio()
    au.preload = 'auto'
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      reject({ code: 'timeout', el: au })
    }, ASSET_TIMEOUT_MS)
    function cleanup() {
      clearTimeout(timer)
      au.removeEventListener('canplaythrough', onOk)
      au.removeEventListener('canplay', onOk)
      au.removeEventListener('error', onErr)
    }
    function onOk() {
      if (settled) return
      settled = true
      cleanup()
      resolve(au)
    }
    function onErr() {
      if (settled) return
      settled = true
      cleanup()
      reject({ code: 'load-error', el: au })
    }
    au.addEventListener('canplaythrough', onOk, { once: true })
    au.addEventListener('canplay', onOk, { once: true })
    au.addEventListener('error', onErr, { once: true })
    au.src = src
    au.load()
  })
}

async function loadAssetWithRetries(asset, failKeys, onAttempt) {
  if (failKeys.has(asset.key)) {
    // Deterministic resilience-test hook (only via the /intro-test
    // ?fail= list): the asset is never fetched, it just fails.
    return {
      ...asset,
      status: 'failed',
      attempts: 0,
      error: 'test-blocked',
      detail: '',
      el: null
    }
  }
  const loadOnce = asset.kind === 'image' ? loadImageOnce : loadAudioOnce
  let lastError = 'load-error'
  let lastEl = null
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    if (onAttempt) onAttempt(asset, attempt)
    try {
      const el = await loadOnce(asset.src)
      return {
        ...asset,
        status: 'loaded',
        attempts: attempt,
        error: null,
        detail:
          asset.kind === 'image'
            ? `${el.naturalWidth}×${el.naturalHeight}`
            : 'آمادهٔ پخش',
        el
      }
    } catch (err) {
      lastError = err.code || 'load-error'
      lastEl = err.el || null
      if (attempt <= MAX_RETRIES) {
        await sleep(RETRY_BASE_MS * Math.pow(2, attempt - 1))
      }
    }
  }
  return {
    ...asset,
    status: 'failed',
    attempts: MAX_RETRIES + 1,
    error: lastError,
    detail: '',
    el: lastEl
  }
}

// Preload every opening asset in parallel. Never rejects: the result
// array always has one entry per asset, fulfilled or failed.
// onAsset(result) is called for each asset as it settles, so the UI can
// show live progress instead of waiting for the slowest asset.
export function preloadOpeningAssets({ onAsset = null, onAttempt = null, failKeys = [] } = {}) {
  const failSet = new Set(failKeys)
  const jobs = OPENING_ASSETS.map(async (asset) => {
    const result = await loadAssetWithRetries(asset, failSet, onAttempt)
    if (onAsset) onAsset(result)
    return result
  })
  return Promise.all(jobs)
}
