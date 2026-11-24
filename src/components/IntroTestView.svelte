<script>
  // Phase R0/R1 — isolated opening test route (#/intro-test).
  // Renders the cinematic opening with MOCK data only: no login, no token,
  // no Codespace wake, no Gateway, no session. The debug panel shows the
  // opening's own resilient preloader results (retries + fallbacks), so a
  // "no picture" or "no sound" failure can be told apart from a stale
  // bundle or a dead Codespace. The opening itself keeps its locked
  // behavior (8s, no buttons/timeline; onDone -> finished state).
  //
  // Resilience test (R1): open with ?fail= to force-fail assets, e.g.
  //   #/intro-test?fail=emblem,jarvis
  //   #/intro-test?fail=wordmarkLight.webp,eagle.mp3
  // The named assets never load: the opening must paint its visible
  // fallback and name them in the saffron bar instead of going blank.
  import { onMount } from 'svelte'
  import { router } from '../lib/router.svelte.js'
  import StudioOpening from './StudioOpening.svelte'
  import { OPENING_ASSETS, ERROR_LABELS } from '../lib/studio-opening-preload.js'

  // Accept keys ("emblem", "jarvis") or file names ("emblem.webp", "jarvis.mp3").
  function parseFailKeys(raw) {
    if (!raw) return []
    const byName = new Map()
    for (const a of OPENING_ASSETS) {
      byName.set(a.key, a.key)
      byName.set(a.src.split('/').pop(), a.key)
      byName.set(a.src.split('/').pop().replace(/\.(webp|mp3)$/, ''), a.key)
    }
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => byName.get(s))
      .filter(Boolean)
  }

  const failKeys = parseFailKeys(router.params?.fail || '')

  let statuses = $state({})
  let done = $state(false)
  let loopStopped = $state(false)
  let playKey = $state(0)
  let panelOpen = $state(true)

  let loadedCount = $derived(
    Object.values(statuses).filter((s) => s.state === 'loaded').length
  )
  let errorCount = $derived(
    Object.values(statuses).filter((s) => s.state === 'failed').length
  )

  function setStatus(key, state, detail = '') {
    statuses = { ...statuses, [key]: { state, detail } }
  }

  function resetStatuses() {
    statuses = {}
    for (const a of OPENING_ASSETS) setStatus(a.key, 'loading')
  }

  // R1 — fed by the opening's own preloader (single source of truth):
  // each asset reports loaded/failed with its retry count.
  function onAssetResult(result) {
    const tries = result.attempts > 0 ? ` · ${result.attempts} تلاش` : ''
    const detail =
      result.status === 'loaded'
        ? `${result.detail || ''}${tries}`.trim()
        : `${ERROR_LABELS[result.error] || 'لود نشد'}${tries} · جایگزین`
    setStatus(result.key, result.status === 'loaded' ? 'loaded' : 'failed', detail)
  }

  function replay() {
    done = false
    loopStopped = false
    resetStatuses()
    playKey += 1
  }

  function backToCourse() {
    router.go('#/')
  }

  onMount(() => {
    resetStatuses()
  })
</script>

{#if !done}
  {#key playKey}
    <StudioOpening
      onDone={() => (done = true)}
      onAssets={onAssetResult}
      onLoopStopped={() => (loopStopped = true)}
      failKeys={failKeys}
    />
  {/key}
{:else}
  <div class="min-h-dvh warm-mesh flex flex-col items-center justify-center gap-4 p-6 text-center">
    <img src="logo/jarvis-studio-shield-64.png" alt="Jarvis Studio" width="64" height="64" />
    <h1 class="text-xl font-extrabold">افتتاحیه تمام شد</h1>
    <p class="text-sm text-[var(--ink-soft)]">
      ۸ ثانیهٔ سینمایی پخش شد — این فقط یک پیش‌نمایش آزمایشی بود، بدون ورود و بدون استودیو.
    </p>
    {#if loopStopped}
      <p class="text-xs font-bold" style="color:#B5720A">چرخهٔ انیمیشن بعد از ثانیهٔ ۸ کاملاً متوقف شد (rAF خاموش).</p>
    {/if}
    <div class="flex flex-wrap justify-center gap-2">
      <button type="button" class="btn-ml-primary" onclick={replay}>پخش دوباره</button>
      <button type="button" class="btn-ml-ghost" onclick={backToCourse}>بازگشت به دوره</button>
    </div>
  </div>
{/if}

<!-- پنل دیباگ — وضعیت لود دارایی‌های افتتاحیه (از پیش‌لودر خود افتتاحیه) -->
<div
  class="intro-debug"
  role="group"
  aria-label="وضعیت لود دارایی‌های افتتاحیه"
  onclick={(e) => e.stopPropagation()}
>
  <button type="button" class="intro-debug-head" onclick={() => (panelOpen = !panelOpen)}>
    <span class="font-bold">تست افتتاحیه</span>
    <span class="intro-debug-count" data-state={errorCount > 0 ? 'error' : 'ok'}>
      {loadedCount}/{OPENING_ASSETS.length} لود شد
    </span>
    <span aria-hidden="true">{panelOpen ? '▾' : '▴'}</span>
  </button>
  {#if panelOpen}
    <ul class="intro-debug-list">
      {#each OPENING_ASSETS as a}
        {@const s = statuses[a.key] || { state: 'loading', detail: '' }}
        <li>
          <span class="intro-debug-dot" data-state={s.state}></span>
          <span>{a.label}</span>
          <span class="intro-debug-detail" dir="ltr">
            {s.state === 'loaded' ? (s.detail || '✓') : s.state === 'failed' ? (s.detail || 'خطا') : '…'}
          </span>
        </li>
      {/each}
    </ul>
    {#if failKeys.length > 0}
      <p class="intro-debug-hint">تست تاب‌آوری فعال است — دارایی‌های مسدودشده: {failKeys.join('، ')}.</p>
    {/if}
    {#if loopStopped}
      <p class="intro-debug-hint">rAF بعد از ثانیهٔ ۸ متوقف شد.</p>
    {/if}
    <p class="intro-debug-hint">برای پخش با صدا روی صحنه ضربه بزن؛ اگر صدا بلاک شد، دکمهٔ «ضربه برای صدا» می‌آید. این صفحه بدون ورود و بدون استودیو است.</p>
  {/if}
</div>

<style>
  .intro-debug {
    position: fixed;
    top: 10px;
    inset-inline-start: 10px;
    z-index: 60;
    width: min(240px, calc(100vw - 20px));
    border-radius: 12px;
    border: 1px solid rgba(230, 179, 90, 0.35);
    background: rgba(7, 24, 21, 0.82);
    color: #f7f1e3;
    font-size: 11px;
    line-height: 1.7;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  }
  .intro-debug-head {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 10px;
    text-align: start;
  }
  .intro-debug-count {
    margin-inline-start: auto;
    font-weight: 700;
    color: #48e5cf;
  }
  /* R1 — error colour is saffron #B5720A (dot); the count text uses a
     lighter saffron tint of the same hue so it stays readable on dark. */
  .intro-debug-count[data-state='error'] {
    color: #e8a33d;
  }
  .intro-debug-list {
    list-style: none;
    margin: 0;
    padding: 2px 10px 6px;
  }
  .intro-debug-list li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .intro-debug-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #e6b35a;
    flex: none;
  }
  .intro-debug-dot[data-state='loaded'] {
    background: #48e5cf;
  }
  .intro-debug-dot[data-state='failed'] {
    background: #b5720a;
  }
  .intro-debug-detail {
    margin-inline-start: auto;
    color: rgba(247, 241, 227, 0.7);
    font-size: 10px;
  }
  .intro-debug-hint {
    margin: 0;
    padding: 0 10px 8px;
    color: rgba(247, 241, 227, 0.65);
    font-size: 10px;
    line-height: 1.7;
  }
</style>
