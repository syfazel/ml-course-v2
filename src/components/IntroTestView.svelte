<script>
  // Phase R0 — isolated opening test route (#/intro-test).
  // Renders the cinematic opening with MOCK data only: no login, no token,
  // no Codespace wake, no Gateway, no session. The debug panel probes the
  // 6 WebP images + 3 MP3s independently and shows their load status, so
  // a "no picture" or "no sound" failure can be told apart from a stale
  // bundle or a dead Codespace. The opening itself keeps its locked
  // behavior (8s, no buttons/timeline; onDone -> finished state).
  import { onMount } from 'svelte'
  import { router } from '../lib/router.svelte.js'
  import StudioOpening from './StudioOpening.svelte'

  const IMAGE_ASSETS = [
    { key: 'emblem', label: 'نشان عقاب', src: 'studio-opening/emblem.webp' },
    { key: 'emblemBaseOpen', label: 'نشان (منقار باز)', src: 'studio-opening/emblemBaseOpen.webp' },
    { key: 'lowerBeak', label: 'منقار پایین', src: 'studio-opening/lowerBeak.webp' },
    { key: 'upperBeak', label: 'منقار بالا', src: 'studio-opening/upperBeak.webp' },
    { key: 'wordmarkLight', label: 'لوگوی متنی (روشن)', src: 'studio-opening/wordmarkLight.webp' },
    { key: 'wordmarkDark', label: 'لوگوی متنی (تیره)', src: 'studio-opening/wordmarkDark.webp' }
  ]
  const AUDIO_ASSETS = [
    { key: 'intro', label: 'صدای ورودی', src: 'studio-opening/intro.mp3' },
    { key: 'eagle', label: 'غرش عقاب', src: 'studio-opening/eagle.mp3' },
    { key: 'jarvis', label: 'صدای جارویس', src: 'studio-opening/jarvis.mp3' }
  ]

  let statuses = $state({})
  let done = $state(false)
  let playKey = $state(0)
  let panelOpen = $state(true)

  let loadedCount = $derived(
    Object.values(statuses).filter((s) => s.state === 'loaded').length
  )
  let errorCount = $derived(
    Object.values(statuses).filter((s) => s.state === 'error').length
  )

  function setStatus(key, state, detail = '') {
    statuses = { ...statuses, [key]: { state, detail } }
  }

  function probeAssets() {
    for (const a of IMAGE_ASSETS) {
      setStatus(a.key, 'loading')
      const im = new Image()
      im.onload = () => setStatus(a.key, 'loaded', `${im.naturalWidth}×${im.naturalHeight}`)
      im.onerror = () => setStatus(a.key, 'error', 'لود نشد')
      im.src = a.src
    }
    for (const a of AUDIO_ASSETS) {
      setStatus(a.key, 'loading')
      const au = new Audio()
      au.preload = 'auto'
      au.addEventListener('canplaythrough', () => setStatus(a.key, 'loaded'), { once: true })
      au.addEventListener('error', () => setStatus(a.key, 'error', 'لود نشد'), { once: true })
      au.src = a.src
      au.load()
    }
  }

  function replay() {
    done = false
    playKey += 1
  }

  function backToCourse() {
    router.go('#/')
  }

  onMount(() => {
    probeAssets()
  })
</script>

{#if !done}
  {#key playKey}
    <StudioOpening onDone={() => (done = true)} />
  {/key}
{:else}
  <div class="min-h-dvh warm-mesh flex flex-col items-center justify-center gap-4 p-6 text-center">
    <img src="logo/jarvis-studio-shield-64.png" alt="Jarvis Studio" width="64" height="64" />
    <h1 class="text-xl font-extrabold">افتتاحیه تمام شد</h1>
    <p class="text-sm text-[var(--ink-soft)]">
      ۸ ثانیهٔ سینمایی پخش شد — این فقط یک پیش‌نمایش آزمایشی بود، بدون ورود و بدون استودیو.
    </p>
    <div class="flex flex-wrap justify-center gap-2">
      <button type="button" class="btn-ml-primary" onclick={replay}>پخش دوباره</button>
      <button type="button" class="btn-ml-ghost" onclick={backToCourse}>بازگشت به دوره</button>
    </div>
  </div>
{/if}

<!-- پنل دیباگ — وضعیت لود دارایی‌های افتتاحیه -->
<div
  class="intro-debug"
  role="group"
  aria-label="وضعیت لود دارایی‌های افتتاحیه"
  onclick={(e) => e.stopPropagation()}
>
  <button type="button" class="intro-debug-head" onclick={() => (panelOpen = !panelOpen)}>
    <span class="font-bold">تست افتتاحیه</span>
    <span class="intro-debug-count" data-state={errorCount > 0 ? 'error' : 'ok'}>
      {loadedCount}/{IMAGE_ASSETS.length + AUDIO_ASSETS.length} لود شد
    </span>
    <span aria-hidden="true">{panelOpen ? '▾' : '▴'}</span>
  </button>
  {#if panelOpen}
    <ul class="intro-debug-list">
      {#each [...IMAGE_ASSETS, ...AUDIO_ASSETS] as a}
        {@const s = statuses[a.key] || { state: 'loading', detail: '' }}
        <li>
          <span class="intro-debug-dot" data-state={s.state}></span>
          <span>{a.label}</span>
          <span class="intro-debug-detail" dir="ltr">
            {s.state === 'loaded' ? (s.detail || '✓') : s.state === 'error' ? (s.detail || 'خطا') : '…'}
          </span>
        </li>
      {/each}
    </ul>
    <p class="intro-debug-hint">برای پخش با صدا روی صحنه ضربه بزن. این صفحه بدون ورود و بدون استودیو است.</p>
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
  .intro-debug-count[data-state='error'] {
    color: #ffb199;
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
  .intro-debug-dot[data-state='error'] {
    background: #ff7e47;
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
