<script>
  import { tick } from 'svelte'
  import { auth } from '../lib/auth-store.svelte.js'
  import { isSupabaseConfigured } from '../lib/supabase.js'
  import {
    signIn,
    requestPasswordReset,
    completePasswordReset,
    retryMemberRead,
    signOut
  } from '../lib/auth.js'
  import { memberErrorCode } from '../lib/auth-errors.js'
  import { router } from '../lib/router.svelte.js'
  import { APP_VERSION } from '../lib/version-check.js'
  // شبکهٔ Three.js را لِیزی لود می‌کنیم تا باندل اصلی سبک بماند؛
  // روی دستگاه ضعیف یا reduced-motion اصلاً دانلود نمی‌شود.

  let mode = $state('login') // 'login' | 'forgot'
  let email = $state('')
  let password = $state('')
  let nextPassword = $state('')
  let confirmPassword = $state('')
  let busy = $state(false)
  let feedback = $state(null) // { text, kind, code, step, status }
  let copiedReport = $state(false)
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

  // دروازهٔ ورود — افتتاحیهٔ تاییدشده (v3) پیش از صفحهٔ ورود (تیک یاسین ۲۵ نوامبر ~۱۳:۱۶):
  // اول صفحهٔ «برای ورود ضربه بزن»؛ همان ضربه ویدیو را با صدا پخش می‌کند و
  // بعد از تمام‌شدن ویدیو فرم ورود می‌آید. در reduced-motion و در مسیر
  // بازیابی رمز، دروازه اصلاً نشان داده نمی‌شود. اگر ویدیو خطا بدهد یا
  // ظرف ۲۰ ثانیه تمام نشود، دروازه رد می‌شود تا کاربر هیچ‌وقت گیر نکند.
  let entryVideoEl = $state(null)
  let entryWatchdog = null
  const skipEntry = reducedMotion || auth.recoveryMode || router.path === '/reset-password'
  let entryState = $state(skipEntry ? 'done' : 'splash') // 'splash' | 'playing' | 'done'
  const entryActive = $derived(entryState !== 'done')

  async function startEntry() {
    entryState = 'playing'
    await tick()
    entryWatchdog = setTimeout(() => {
      if (entryState === 'playing') entryState = 'done'
    }, 20000)
    try {
      await entryVideoEl?.play()
    } catch {
      clearTimeout(entryWatchdog)
      entryState = 'done'
    }
  }

  function finishEntry() {
    clearTimeout(entryWatchdog)
    entryState = 'done'
  }

  async function handleLogin(e) {
    e.preventDefault()
    feedback = null
    copiedReport = false
    busy = true
    try {
      const res = await signIn(email, password)
      if (!res.ok) {
        feedback = { text: res.text, kind: res.kind, code: res.code || null, retryMember: res.retryMember || false, step: res.step || null }
        return
      }
      password = ''
      router.go('#/')
    } finally {
      busy = false
    }
  }

  // فاز ۳ (F6): تلاش دوبارهٔ خواندن عضویت — هم از بنر خطا، هم از
  // بازخورد «وارد شدید ولی خواندن عضویت نشد». در صورت موفقیت، خانه.
  async function handleRetryMember() {
    feedback = null
    copiedReport = false
    busy = true
    try {
      const res = await retryMemberRead()
      if (res.ok) {
        router.go('#/')
        return
      }
      feedback = { text: res.text, kind: res.kind, code: res.code || null, retryMember: res.retryMember || false, step: res.step || null }
    } finally {
      busy = false
    }
  }

  function stepLabel(step) {
    if (step === 'password') return 'قدم: بررسی ایمیل و رمز عبور'
    if (step === 'member') return 'قدم: خواندن اطلاعات عضویت'
    return null
  }

  // گزارش تشخیص برای فرستادن به استاد/میوز (۲۵ نوامبر ۲۰۲۶): باندل،
  // قدمِ شکست، کد خطا و زمان — بدون ایمیل، بدون رمز، بدون توکن.
  // اگر ورود باز هم نشد، همین گزارش را بفرست تا دقیقاً همان‌جا گرفته شود.
  async function copyDiagnosisReport() {
    if (!feedback?.code) return
    const report = JSON.stringify({
      bundle: APP_VERSION,
      step: feedback.step || null,
      code: feedback.code,
      at: new Date().toISOString()
    })
    try {
      await navigator.clipboard.writeText(report)
      copiedReport = true
      setTimeout(() => {
        copiedReport = false
      }, 2500)
    } catch {
      // کلیپ‌بورد در دسترس نیست؛ گزارش همان‌جا خوانا می‌ماند.
    }
  }

  async function handleForgot(e) {
    e.preventDefault()
    feedback = null
    busy = true
    try {
      const res = await requestPasswordReset(email)
      feedback = { text: res.text, kind: res.kind, code: res.code || null }
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
      feedback = { text: res.text, kind: res.kind, code: res.code || null }
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
  <!-- دروازهٔ ورود — افتتاحیهٔ تاییدشده پیش از صفحهٔ ورود -->
  {#if entryActive}
    <div
      class="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 p-6 text-center text-[#f7f1e3]"
      style="background-image: linear-gradient(rgba(20,16,12,0.78), rgba(20,16,12,0.92)), url('covers/cover-hero.jpg'); background-size: cover; background-position: center;"
    >
      {#if entryState === 'splash'}
        <img
          src="logo/logo-mark-inverse.svg"
          alt=""
          aria-hidden="true"
          class="w-16 h-auto"
        />
        <div class="space-y-1">
          <h1 class="text-2xl font-extrabold">دورهٔ یادگیری ماشین</h1>
          <p class="text-sm opacity-80">افتتاحیهٔ ۱۰ ثانیه‌ای — با صدا پخش می‌شود</p>
        </div>
        <button type="button" class="btn-ml-primary text-base px-8 py-3" onclick={startEntry}>
          ▶ برای ورود ضربه بزن
        </button>
      {:else}
        <video
          bind:this={entryVideoEl}
          class="absolute inset-0 w-full h-full object-cover"
          src="covers/video-opening-site-entry-v3.mp4"
          playsinline
          preload="auto"
          onended={finishEntry}
          onerror={finishEntry}
          aria-label="افتتاحیهٔ ورود به دورهٔ یادگیری ماشین"
        ></video>
      {/if}
    </div>
  {/if}
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
      <img
        src="logo/logo-mark-inverse.svg"
        alt=""
        aria-hidden="true"
        class="mx-auto block w-14 sm:w-16 h-auto mb-2"
      />
      <h1 class="teaser-h1">دورهٔ یادگیری ماشین</h1>
      <p class="teaser-tagline">از دادهٔ پراکنده تا شبکه‌ای که یاد می‌گیرد</p>
    </header>

    <div class="glass-card w-full max-w-md p-6 sm:p-8 space-y-6">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <img
            src="logo/logo-mark-color.svg"
            alt="نشان دورهٔ یادگیری ماشین"
            class="w-7 h-auto shrink-0"
          />
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
        <!-- (۲۵ نوامبر ۲۰۲۶) فقط یک خط راهنما — دیگر دیوار «منقضی شده»
             با دکمهٔ دستیِ «پاک‌کردن نشست کهنه» نیست: نشست کهنه در
             مسیر انقضای واقعی، خودش و بی‌صدا پاک می‌شود و فرم ورود
             همین‌جا آماده است. -->
        <div class="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p>{auth.sessionNotice}</p>
        </div>
      {/if}

      {#if auth.memberError}
        <div class="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900 space-y-3">
          <p>{auth.memberError}</p>
          <!-- فاز ۴ (R-1): کد پایدار خطا کنار متن بنر. -->
          {#if auth.memberErrorKind}
            <p class="font-code text-[11px] opacity-80" dir="ltr">کد خطا: {memberErrorCode(auth.memberErrorKind)}</p>
          {/if}
          {#if auth.memberErrorKind === 'transient'}
            <!-- فاز ۳ (F6): خطای گذرا — دوباره خواندن عضویت، بدون خروج. -->
            <button type="button" class="btn-ml-primary text-xs w-full" onclick={handleRetryMember} disabled={busy}>
              {busy ? 'در حال تلاش دوباره...' : 'تلاش دوباره'}
            </button>
          {/if}
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
          class:bg-amber-50={feedback.kind === 'rate-limited' || feedback.kind === 'expired' || feedback.kind === 'member-unread'}
          class:border-amber-300={feedback.kind === 'rate-limited' || feedback.kind === 'expired' || feedback.kind === 'member-unread'}
          class:text-amber-900={feedback.kind === 'rate-limited' || feedback.kind === 'expired' || feedback.kind === 'member-unread'}
          class:bg-red-50={feedback.kind === 'error'}
          class:border-red-300={feedback.kind === 'error'}
          class:text-red-900={feedback.kind === 'error'}
        >
          <p>{feedback.text}</p>
          <!-- قدمِ شکست (۲۵ نوامبر ۲۰۲۶): رمز بود یا خواندن عضویت؟ -->
          {#if stepLabel(feedback.step)}
            <p class="mt-1 text-xs opacity-80">{stepLabel(feedback.step)}</p>
          {/if}
          <!-- فاز ۴ (R-1): کد پایدار خطا کنار متن بازخورد. -->
          {#if feedback.code}
            <p class="font-code mt-1 text-[11px] opacity-80" dir="ltr">کد خطا: {feedback.code}</p>
            <button type="button" class="btn-ml-ghost text-xs w-full mt-2" onclick={copyDiagnosisReport} disabled={busy}>
              {copiedReport ? 'گزارش کپی شد' : 'کپی گزارش خطا برای استاد'}
            </button>
          {/if}
          {#if feedback.retryMember}
            <!-- فاز ۳ (F6): وارد شده‌ای، فقط خواندن عضویت نشد — تلاش دوباره. -->
            <button type="button" class="btn-ml-primary text-xs w-full mt-3" onclick={handleRetryMember} disabled={busy}>
              {busy ? 'در حال تلاش دوباره...' : 'تلاش دوباره'}
            </button>
          {/if}
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

      <!-- فاز ۱ (R-8): هش باندل روی صفحهٔ ورود — وقتی ورود خراب است،
           معلوم باشد کدام باندل در حال اجراست. -->
      <p class="pt-2 text-center text-[11px] text-[var(--ink-soft)]">نسخهٔ باندل: <span class="font-code" dir="ltr">{APP_VERSION}</span></p>
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
