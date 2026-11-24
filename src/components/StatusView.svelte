<script>
  // فاز ۴ (D5) — صفحهٔ وضعیت داخلی: هر سه نسخهٔ دیپلوی در یک جا.
  // مانیفست = version.json (فرانت‌اند + wake + کامیت گیت‌ویِ ثبت‌شده در
  // زمان بیلد)؛ نسخهٔ زندهٔ گیت‌وی فقط وقتی نشست استودیو هست، از
  // /status خوانده می‌شود — وگرنه صادقانه «نشست زنده نیست» می‌آید،
  // نه حدس. هیچ رمز/توکنی اینجا خوانده یا نشان داده نمی‌شود.
  import { onMount } from 'svelte'
  import { APP_VERSION } from '../lib/version-check.js'
  import { studioGateway } from '../lib/studio-gateway.js'

  let manifest = $state(null)
  let manifestError = $state(null)
  let liveGateway = $state(null) // null | { state, ... }

  onMount(() => {
    void loadManifest()
    void loadLiveGateway()
  })

  async function loadManifest() {
    try {
      const res = await fetch('version.json', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      manifest = await res.json()
    } catch {
      manifestError = 'خواندن مانیفست دیپلوی (version.json) ناموفق بود.'
    }
  }

  async function loadLiveGateway() {
    const gw = studioGateway()
    if (!gw.gatewayUrl) {
      liveGateway = {
        state: 'unavailable',
        note: 'نشست زندهٔ استودیو نیست — نسخهٔ زندهٔ گیت‌وی فقط داخل استودیو دیده می‌شود.'
      }
      return
    }
    liveGateway = { state: 'loading' }
    try {
      const st = await gw.status()
      liveGateway = {
        state: 'ok',
        commit: st.gateway_commit || 'unknown',
        builtAt: st.gateway_built_at || 'unknown',
        version: st.gateway || 'unknown',
        kernel: st.kernel || '—',
        uptime: typeof st.uptime_seconds === 'number' ? st.uptime_seconds : null
      }
    } catch {
      liveGateway = {
        state: 'unavailable',
        note: 'گیت‌وی در دسترس نیست — شاید نشست منقضی شده یا ماشین خاموش است.'
      }
    }
  }

  function fmtUptime(sec) {
    if (sec == null) return '—'
    const m = Math.floor(sec / 60)
    if (m < 60) return `${m} دقیقه`
    return `${Math.floor(m / 60)} ساعت و ${m % 60} دقیقه`
  }
</script>

<div class="space-y-6">
  <header class="glass-card p-5 sm:p-6">
    <p class="text-xs font-bold text-[var(--amber-dark)]">وضعیت داخلی — مانیفست دیپلوی</p>
    <h1 class="text-2xl font-extrabold">وضعیت نسخه‌ها</h1>
    <p class="text-xs text-[var(--ink-soft)]">
      هر سه نسخهٔ دیپلوی‌شده در یک جا؛ «نامشخص» یعنی آن نسخه ثبت نشده است، نه اینکه حدس زده شود.
    </p>
  </header>

  {#if manifestError}
    <div class="rounded-xl bg-red-50 border border-red-300 p-4 text-sm text-red-900">
      {manifestError}
    </div>
  {:else if !manifest}
    <div class="paper-card p-8 text-center text-sm text-[var(--ink-soft)]">
      در حال خواندن مانیفست…
    </div>
  {:else}
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <!-- فرانت‌اند -->
      <section class="glass-card p-4 space-y-2">
        <h2 class="text-sm font-extrabold">فرانت‌اند (سایت دوره)</h2>
        <p class="text-xs text-[var(--ink-soft)]">
          باندلِ در حال اجرا: <span class="font-code" dir="ltr">{APP_VERSION}</span>
        </p>
        <p class="text-xs text-[var(--ink-soft)]">
          هشِ دیپلوی‌شده: <span class="font-code" dir="ltr">{manifest.hash || 'unknown'}</span>
        </p>
        <p class="text-xs text-[var(--ink-soft)]">
          زمان بیلد: <span dir="ltr">{manifest.builtAt || 'unknown'}</span>
        </p>
        <p class="text-xs font-bold">
          {#if manifest.hash && manifest.hash === APP_VERSION}
            <span style="color: var(--patina)">هماهنگ — همین نسخهٔ دیپلوی‌شده در حال اجراست.</span>
          {:else}
            <span style="color: var(--saffron-text)">نسخهٔ تازه‌تر روی سرور است — با رفرش به‌روز می‌شود.</span>
          {/if}
        </p>
      </section>

      <!-- بیداری -->
      <section class="glass-card p-4 space-y-2">
        <h2 class="text-sm font-extrabold">بیداری (Edge Function)</h2>
        <p class="text-xs text-[var(--ink-soft)]">
          نسخهٔ دیپلوی‌شده: <span class="font-code" dir="ltr">{manifest.wakeVersion || 'unknown'}</span>
        </p>
        <p class="text-xs text-[var(--ink-soft)]">
          سورس کانونی در ریپوی پایلوت است؛ بعد از هر دیپلوی داشبورد، diff با فایل کانونی اجباری است.
        </p>
      </section>

      <!-- گیت‌وی -->
      <section class="glass-card p-4 space-y-2">
        <h2 class="text-sm font-extrabold">گیت‌وی (Codespace)</h2>
        <p class="text-xs text-[var(--ink-soft)]">
          کامیتِ ثبت‌شده در مانیفست: <span class="font-code" dir="ltr">{manifest.gatewayCommit || 'unknown'}</span>
        </p>
        <p class="text-xs text-[var(--ink-soft)]">
          {#if manifest.gatewayCommit && manifest.gatewayCommit !== 'unknown'}
            کد مرج‌شده در زمان بیلد — با ری‌استارت بعدی Codespace فعال می‌شود.
          {:else}
            کامیت گیت‌وی در زمان بیلد ثبت نشده است.
          {/if}
        </p>
        {#if !liveGateway}
          <p class="text-xs text-[var(--ink-soft)]">در حال بررسی گیت‌وی زنده…</p>
        {:else if liveGateway.state === 'loading'}
          <p class="text-xs text-[var(--ink-soft)]">در حال بررسی گیت‌وی زنده…</p>
        {:else if liveGateway.state === 'ok'}
          <p class="text-xs text-[var(--ink-soft)]">
            زنده: <span class="font-code" dir="ltr">{liveGateway.commit}</span>
            · کرنل: {liveGateway.kernel} · روشن از: {fmtUptime(liveGateway.uptime)}
          </p>
          <p class="text-xs text-[var(--ink-soft)]">
            زمان کامیت: <span dir="ltr">{liveGateway.builtAt}</span>
          </p>
        {:else}
          <p class="text-xs text-[var(--ink-soft)]">{liveGateway.note}</p>
        {/if}
      </section>
    </div>

    <section class="paper-card p-5 space-y-2">
      <h2 class="text-sm font-extrabold">مانیفست خام (version.json)</h2>
      <pre dir="ltr" class="whitespace-pre-wrap rounded-xl bg-[#1d1a18] p-3 text-left text-xs leading-6 text-[#f5efe6]">{JSON.stringify(manifest, null, 2)}</pre>
    </section>
  {/if}
</div>
