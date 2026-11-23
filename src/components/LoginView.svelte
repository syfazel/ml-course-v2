<script>
  import { auth } from '../lib/auth-store.svelte.js'
  import { isSupabaseConfigured } from '../lib/supabase.js'
  import {
    signIn,
    requestPasswordReset,
    completePasswordReset,
    signOut
  } from '../lib/auth.js'
  import { router } from '../lib/router.svelte.js'
  // شبکهٔ Three.js را لِیزی لود می‌کنیم تا باندل اصلی سبک بماند؛
  // روی دستگاه ضعیف یا reduced-motion اصلاً دانلود نمی‌شود.

  let mode = $state('login') // 'login' | 'forgot'
  let email = $state('')
  let password = $state('')
  let nextPassword = $state('')
  let confirmPassword = $state('')
  let busy = $state(false)
  let feedback = $state(null) // { text, kind }
  let videoEl = $state(null)

  // تیزر «رشتهٔ طلایی یادگیری» — تشخیص در لحظهٔ ساخت کامپوننت (نه onMount)
  // تا ویدیو حتی یک فریم هم با حرکتِ ناخواسته شروع نشود.
  const reducedMotion = $state(
    typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  const weakDevice = $state(
    typeof navigator !== 'undefined' &&
      ((navigator.hardwareConcurrency || 4) <= 2 ||
        (navigator.deviceMemory || 8) <= 4)
  )
  // شبکهٔ Three.js فقط وقتی حرکت مجاز است و دستگاه توانمند است
  const showNetwork = $derived(!reducedMotion && !weakDevice)
  let paused = $state(reducedMotion)

  function toggleMotion() {
    paused = !paused
    if (!videoEl) return
    if (paused) videoEl.pause()
    else videoEl.play().catch(() => {})
  }

  async function handleLogin(e) {
    e.preventDefault()
    feedback = null
    busy = true
    try {
      const res = await signIn(email, password)
      if (!res.ok) {
        feedback = { text: res.text, kind: res.kind }
        return
      }
      password = ''
      router.go('#/')
    } finally {
      busy = false
    }
  }

  async function handleForgot(e) {
    e.preventDefault()
    feedback = null
    busy = true
    try {
      const res = await requestPasswordReset(email)
      feedback = { text: res.text, kind: res.kind }
    } finally {
      busy = false
    }
  }

  async function handleCompleteReset(e) {
    e.preventDefault()
    feedback = null
    busy = true
    try {
      const res = await completePasswordReset(nextPassword, confirmPassword)
      feedback = { text: res.text, kind: res.kind }
      if (res.ok) {
        nextPassword = ''
        confirmPassword = ''
        mode = 'login'
      }
    } finally {
      busy = false
    }
  }
</script>

<div class="teaser-root">
  <!-- لایهٔ ۰ — پوستر ثابت (زیر ویدیو؛ در reduced-motion و پیش از پخش هم همین دیده می‌شود) -->
  <img
    src="covers/cover-hero.jpg"
    alt=""
    aria-hidden="true"
    class="teaser-base"
  />
  <!-- لایهٔ ۱ — ویدیوی Veo تمام‌صفحه (حلقه ۱۰ ثانیه‌ای؛ درز حلقه اندازه‌گیری شد: تفاوت فریم اول و آخر ۲٫۴۱ از ۲۵۵ — بدون درز، پس محو لازم نیست) -->
  <video
    bind:this={videoEl}
    class="teaser-video"
    autoplay={!reducedMotion}
    muted
    loop
    playsinline
    preload="metadata"
    poster="covers/cover-hero.jpg"
  >
    <source src="covers/video-entry-veo-v1.mp4" type="video/mp4" />
    مرورگر شما ویدیو را پخش نمی‌کند.
  </video>
  <!-- لایهٔ ۲ — شبکهٔ طلایی Three.js (لِیزی؛ فقط وقتی حرکت مجاز است) -->
  {#if showNetwork}
    {#await import('./GoldenNetwork.svelte') then { default: GoldenNetwork }}
      <GoldenNetwork {paused} />
    {/await}
  {/if}
  <!-- لایهٔ ۳ — گرادیان گرم برای کنتراست تیتر و کارت -->
  <div class="teaser-scrim" aria-hidden="true"></div>

  <!-- لایهٔ ۴ — محتوا -->
  <div
    class="relative z-10 min-h-screen flex flex-col items-center justify-center gap-5 p-4 py-8"
  >
    <header class="teaser-hero text-center space-y-1">
      <h1 class="teaser-h1">دورهٔ یادگیری ماشین</h1>
      <p class="teaser-tagline">از دادهٔ پراکنده تا شبکه‌ای که یاد می‌گیرد</p>
    </header>

    <div class="glass-card w-full max-w-md p-6 sm:p-8 space-y-6">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="four-dots" aria-hidden="true">
            <span></span><span></span><span></span><span></span>
          </div>
          <div>
            <p class="text-base font-extrabold tracking-tight">ورود بسته</p>
            <p class="text-xs text-[var(--ink-soft)]">ویژه استاد و شاگرد</p>
          </div>
        </div>
        <span class="badge badge-sm bg-[var(--amber-soft)] text-[var(--amber-dark)] border-0">
          فاز ۱
        </span>
      </div>

      {#if !isSupabaseConfigured}
        <div class="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p class="font-bold mb-1">پیکربندی سرور در این بیلد تنظیم نشده است</p>
          <p class="text-xs leading-6">
            متغیرهای محیطی <code>VITE_SUPABASE_URL</code> و
            <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> مقداردهی نشده‌اند؛ بنابراین کلاینت
            در حالت بدون کلید (<code>sb = null</code>) قرار دارد.
          </p>
        </div>
      {/if}

      {#if auth.sessionNotice}
        <div class="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {auth.sessionNotice}
        </div>
      {/if}

      {#if auth.memberError}
        <div class="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900 space-y-3">
          <p>{auth.memberError}</p>
          <button type="button" class="btn-ml-ghost text-xs w-full" onclick={() => signOut()}>
            خروج از حساب فعلی
          </button>
        </div>
      {/if}

      {#if feedback}
        <div
          class="rounded-xl p-3 text-sm border"
          class:bg-emerald-50={feedback.kind === 'ok'}
          class:border-emerald-300={feedback.kind === 'ok'}
          class:text-emerald-900={feedback.kind === 'ok'}
          class:bg-amber-50={feedback.kind === 'rate-limited' || feedback.kind === 'expired'}
          class:border-amber-300={feedback.kind === 'rate-limited' || feedback.kind === 'expired'}
          class:text-amber-900={feedback.kind === 'rate-limited' || feedback.kind === 'expired'}
          class:bg-red-50={feedback.kind === 'error'}
          class:border-red-300={feedback.kind === 'error'}
          class:text-red-900={feedback.kind === 'error'}
        >
          {feedback.text}
        </div>
      {/if}

      {#if auth.recoveryMode || router.path === '/reset-password'}
        <form class="space-y-4" onsubmit={handleCompleteReset}>
          <div class="space-y-1">
            <h2 class="text-base font-bold">تعیین رمز عبور تازه</h2>
            <p class="text-xs text-[var(--ink-soft)]">
              رمز جدید باید دست‌کم ۸ نویسه باشد.
            </p>
          </div>

          <label class="block space-y-1">
            <span class="text-sm font-medium">رمز عبور تازه</span>
            <input
              type="password"
              dir="ltr"
              autocomplete="new-password"
              class="input input-bordered w-full bg-white/90 text-left"
              bind:value={nextPassword}
              required
            />
          </label>

          <label class="block space-y-1">
            <span class="text-sm font-medium">تکرار رمز عبور تازه</span>
            <input
              type="password"
              dir="ltr"
              autocomplete="new-password"
              class="input input-bordered w-full bg-white/90 text-left"
              bind:value={confirmPassword}
              required
            />
          </label>

          <button
            type="submit"
            class="btn-ml-primary w-full"
            disabled={busy || !isSupabaseConfigured}
          >
            {busy ? 'در حال ثبت...' : 'ثبت رمز عبور تازه'}
          </button>

          <button
            type="button"
            class="btn-ml-ghost w-full text-sm"
            onclick={() => {
              auth.recoveryMode = false
              mode = 'login'
              router.go('#/login')
            }}
          >
            بازگشت به صفحه ورود
          </button>
        </form>
      {:else if mode === 'forgot'}
        <form class="space-y-4" onsubmit={handleForgot}>
          <div class="space-y-1">
            <h2 class="text-base font-bold">بازیابی رمز عبور</h2>
            <p class="text-xs text-[var(--ink-soft)]">
              ایمیل حساب خود را وارد کنید تا پیوند بازیابی به نشانی <code>#/reset-password</code> برایتان فرستاده شود.
            </p>
          </div>

          <label class="block space-y-1">
            <span class="text-sm font-medium">ایمیل</span>
            <input
              type="email"
              dir="ltr"
              autocomplete="email"
              placeholder="name@example.com"
              class="input input-bordered w-full bg-white/90 text-left"
              bind:value={email}
              required
            />
          </label>

          <button
            type="submit"
            class="btn-ml-primary w-full"
            disabled={busy || !isSupabaseConfigured}
          >
            {busy ? 'در حال ارسال...' : 'ارسال پیوند بازیابی'}
          </button>

          <button
            type="button"
            class="btn-ml-ghost w-full text-sm"
            onclick={() => {
              feedback = null
              mode = 'login'
            }}
          >
            بازگشت به ورود
          </button>
        </form>
      {:else}
        <form class="space-y-4" onsubmit={handleLogin}>
          <label class="block space-y-1">
            <span class="text-sm font-medium">ایمیل</span>
            <input
              type="email"
              dir="ltr"
              autocomplete="email"
              placeholder="name@gmail.com"
              class="input input-bordered w-full bg-white/90 text-left"
              bind:value={email}
              required
            />
          </label>

          <label class="block space-y-1">
            <span class="text-sm font-medium">رمز عبور</span>
            <input
              type="password"
              dir="ltr"
              autocomplete="current-password"
              class="input input-bordered w-full bg-white/90 text-left"
              bind:value={password}
              required
            />
          </label>

          <button
            type="submit"
            class="btn-ml-primary w-full"
            disabled={busy || !isSupabaseConfigured}
          >
            {busy ? 'در حال ورود...' : 'ورود به دوره'}
          </button>

          <div class="flex items-center justify-between pt-1 text-xs text-[var(--ink-soft)]">
            <button
              type="button"
              class="underline hover:text-[var(--amber-dark)] cursor-pointer"
              onclick={() => {
                feedback = null
                mode = 'forgot'
              }}
            >
              رمز عبور را فراموش کرده‌ام
            </button>
            <span>ثبت‌نام عمومی بسته است</span>
          </div>
        </form>
      {/if}
    </div>

    {#if !reducedMotion}
      <button
        type="button"
        class="teaser-motion-btn"
        onclick={toggleMotion}
        aria-pressed={!paused}
      >
        {paused ? 'پخش حرکت' : 'توقف حرکت'}
      </button>
    {/if}
  </div>
</div>
