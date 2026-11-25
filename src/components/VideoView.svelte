<script>
  import { onMount, onDestroy } from 'svelte'

  // پخش یوتیوب + زیرنویس فارسی همگام (cues) — زیرنویس‌ها از فایل لِیزی course-videos.js می‌آیند.
  let { video } = $props()

  let playerEl = $state(null)
  let player = null
  let apiReady = $state(false)
  // حالت جایگزین: اگر پخش‌کنندهٔ API یوتیوب ساخته نشد یا خطا داد (مثلاً خطای
  // 153 بابت Referer)، به‌جای جعبهٔ سیاه یک iframe ساده نشان داده می‌شود.
  let useFallback = $state(false)
  let playerError = $state(null)
  let currentCue = $state(null)
  let currentTime = $state(0)
  let pollTimer = null

  // پیش‌پخش درس (تیک یاسین ۲۵ نوامبر ~۱۶:۳۴): پیش از هر ویدیوی درس، همان
  // افتتاحیهٔ تاییدشدهٔ v3 پخش می‌شود (با صدا، به اندازهٔ پخش‌کننده) — هر بار،
  // بدون سرکوب «یک بار در هر نشست» (VideoView با {#key} برای هر ویدیو remount
  // می‌شود، پس onMount هر ویدیو تازه است). با پایان ویدیو، رد کردن، خطا یا
  // تایم‌اوت ۲۰ ثانیه‌ای (مثل fallback دروازهٔ ورود) پیش‌پخش پنهان و یوتیوب
  // می‌آید. اگر مرورگر پخش خودکار با صدا را رد کند، دکمهٔ «پخش افتتاحیه»
  // نشان داده می‌شود — نه ردِ بی‌صدا.
  let prerollVideoEl = $state(null)
  let showPreroll = $state(true)
  let prerollNeedsTap = $state(false)
  let prerollWatchdog = null

  let apiPromise = null
  function loadApi() {
    if (apiPromise) return apiPromise
    apiPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined') return reject(new Error('no window'))
      if (window.YT && window.YT.Player) return resolve(window.YT)
      const existing = document.querySelector('script[data-yt-api="1"]')
      const prev = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => {
        if (prev) prev()
        resolve(window.YT)
      }
      if (existing) {
        setTimeout(() => {
          if (window.YT && window.YT.Player) resolve(window.YT)
          else reject(new Error('yt api timeout'))
        }, 15000)
        return
      }
      const el = document.createElement('script')
      el.src = 'https://www.youtube.com/iframe_api'
      el.dataset.ytApi = '1'
      el.onerror = () => reject(new Error('yt api load'))
      document.head.appendChild(el)
      setTimeout(() => {
        if (window.YT && window.YT.Player) resolve(window.YT)
        else reject(new Error('yt api timeout'))
      }, 20000)
    })
    return apiPromise
  }

  function cueAt(t) {
    if (!video?.cues) return null
    return video.cues.find((c) => t >= c.start && t < c.end) || null
  }

  function fmt(t) {
    const m = Math.floor(t / 60)
    const s = Math.floor(t % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }

  function seekTo(cue) {
    if (!player) return
    try {
      player.seekTo(cue.start, true)
      player.playVideo()
    } catch {
      /* noop */
    }
  }

  async function startPrerollPlayback() {
    prerollNeedsTap = false
    try {
      await prerollVideoEl?.play()
    } catch {
      // پخش خودکار با صدا رد شد (بدون gesture تازه) — دکمهٔ ضربه نشان داده می‌شود.
      prerollNeedsTap = true
    }
  }

  function finishPreroll() {
    if (!showPreroll) return
    clearTimeout(prerollWatchdog)
    prerollWatchdog = null
    showPreroll = false
    prerollNeedsTap = false
    startYouTube()
  }

  function handlePlayerError(code) {
    // خطای پخش‌کنندهٔ API (مثلاً 101/150: جاسازی بسته است؛ 153: Referer
    // نرسیده) — پخش‌کنندهٔ API را کنار بگذار و به iframe ساده برو.
    playerError = code ?? 'unknown'
    try {
      if (pollTimer) clearInterval(pollTimer)
      pollTimer = null
      player?.destroy()
    } catch {
      /* noop */
    }
    player = null
    useFallback = true
  }

  async function loadApiWithRetry() {
    try {
      return await loadApi()
    } catch {
      // یک تلاش تازه: promiseٔ ردشده و اسکریپت خراب را دور بریز تا تلاش
      // دوم واقعاً از اول لود کند (نه همان promiseٔ ردشده).
      apiPromise = null
      const bad = document.querySelector('script[data-yt-api="1"]')
      if (bad) bad.remove()
      await new Promise((r) => setTimeout(r, 2000))
      return await loadApi()
    }
  }

  async function startYouTube() {
    try {
      const YT = await loadApiWithRetry()
      apiReady = true
      player = new YT.Player(playerEl, {
        videoId: video.youtubeId,
        playerVars: { rel: 0, modestbranding: 1 },
        events: {
          onReady: () => {
            pollTimer = setInterval(() => {
              try {
                const t = player.getCurrentTime()
                currentTime = t
                const cue = cueAt(t)
                if (cue !== currentCue) currentCue = cue
              } catch {
                /* noop */
              }
            }, 250)
          },
          onError: (e) => handlePlayerError(e?.data)
        }
      })
    } catch {
      // حتی با یک تلاش دوباره API لود نشد (یوتیوب از این اتصال در دسترس
      // نیست) — iframe ساده شانس دوم است؛ اگر آن هم باز نشد، پیام زیر
      // پخش‌کننده دلیلش را می‌گوید و لینک یوتیوب می‌ماند.
      useFallback = true
    }
  }

  onMount(() => {
    // اسکرول صفحهٔ ویدیو (۲۵ نوامبر ۲۰۲۶): هش‌روتینگ scrollY را صفر نمی‌کند،
    // پس اگر کاربر از پایینِ صفحهٔ درس روی ویدیو زده باشد، صفحهٔ ویدیو با
    // همان اسکرول قبلی باز می‌شود و پخش‌کنندهٔ افتتاحیه بالای دید می‌ماند
    // (viewport روی بخش متن زیرنویس می‌افتد). موقع mount اسکرول را به بالا
    // برمی‌گردانیم تا افتتاحیه توی دید باشد. پرش با کلیک روی سطر زیرنویس
    // دست نخورده — آن seekTo روی پخش‌کننده است، نه اسکرول صفحه.
    window.scrollTo(0, 0)
    // اول پیش‌پخش با صدا؛ API یوتیوب موازی لود می‌شود تا بعد از پیش‌پخش
    // بی‌درنگ پخش‌کننده ساخته شود.
    prerollWatchdog = setTimeout(() => finishPreroll(), 20000)
    loadApi().catch(() => {})
    startPrerollPlayback()
  })

  onDestroy(() => {
    if (prerollWatchdog) clearTimeout(prerollWatchdog)
    if (pollTimer) clearInterval(pollTimer)
    try {
      player?.destroy()
    } catch {
      /* noop */
    }
    player = null
  })
</script>

<div class="space-y-5">
  <div>
    <h2 class="text-xl font-extrabold leading-9">{video.title}</h2>
    <p class="text-xs text-[var(--ink-soft)] mt-1">
      {video.channel}{video.subtitleVersion ? ` • زیرنویس فارسی ${video.subtitleVersion}` : ' • بدون زیرنویس فارسی'}
    </p>
  </div>

  <div class="relative w-full overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-black" style="aspect-ratio: 16 / 9;">
    {#if useFallback}
      <iframe
        title={video.title}
        src="https://www.youtube.com/embed/{video.youtubeId}"
        class="absolute inset-0 w-full h-full"
        referrerpolicy="strict-origin-when-cross-origin"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen
      ></iframe>
    {:else}
      <div bind:this={playerEl} class="absolute inset-0 w-full h-full"></div>
    {/if}
    {#if showPreroll}
      <video
        bind:this={prerollVideoEl}
        class="absolute inset-0 z-20 w-full h-full object-cover bg-black"
        src="covers/video-opening-site-entry-v3.mp4"
        playsinline
        preload="auto"
        onended={finishPreroll}
        onerror={finishPreroll}
        aria-label="افتتاحیهٔ درس"
      ></video>
      {#if prerollNeedsTap}
        <button
          type="button"
          class="absolute inset-0 z-30 flex items-center justify-center bg-black/60 text-[#f7f1e3] text-lg font-extrabold cursor-pointer"
          onclick={startPrerollPlayback}
          aria-label="پخش افتتاحیه"
        >
          ▶ پخش افتتاحیه
        </button>
      {/if}
      <button
        type="button"
        class="absolute z-40 bottom-3 left-3 rounded-full bg-black/70 px-4 py-1.5 text-sm font-bold text-white cursor-pointer"
        onclick={finishPreroll}
        aria-label="رد کردن افتتاحیه"
      >
        رد کردن
      </button>
    {/if}
    {#if currentCue}
      <div
        class="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-4 pb-3 pt-8 text-center"
        style="background: linear-gradient(180deg, transparent, rgba(30,25,22,0.78) 45%);"
      >
        {#each currentCue.lines as line}
          <p class="text-white text-base sm:text-lg leading-8" style="text-shadow: 0 1px 6px rgba(0,0,0,0.6);">{line}</p>
        {/each}
      </div>
    {/if}
  </div>

  {#if useFallback}
    <p class="text-xs leading-6 text-[var(--ink-soft)]">
      پخش‌کنندهٔ اصلی یوتیوب بارگذاری نشد{#if playerError} (خطای {playerError}){/if}، پس نسخهٔ سادهٔ آن آمد؛ زیرنویس فارسی همگام در این حالت کار نمی‌کند. اگر این قاب هم خالی ماند، یعنی یوتیوب از این اینترنت در دسترس نیست — با VPN امتحان کن یا از لینک «مشاهده در یوتیوب» پایین استفاده کن.
    </p>
  {/if}

  {#if video.cues && video.cues.length}
    <div>
      <p class="font-bold text-sm mb-2">{useFallback ? 'متن کامل زیرنویس (فقط خواندن)' : 'متن کامل زیرنویس — برای پرش به هر بخش، روی آن بزن'}</p>
      <div class="space-y-1 max-h-96 overflow-y-auto rounded-2xl border border-[var(--glass-border)] bg-white/70 p-3">
        {#each video.cues as cue}
          <button
            type="button"
            class="w-full text-right flex gap-3 items-start rounded-xl px-2 py-1.5 text-xs leading-6 hover:bg-[var(--canvas-subtle)] cursor-pointer"
            class:bg-[var(--canvas-subtle)]={currentCue === cue}
            disabled={useFallback}
            onclick={() => seekTo(cue)}
          >
            <span class="font-mono shrink-0 text-[var(--ink-soft)]" dir="ltr">{fmt(cue.start)}</span>
            <span>{cue.lines.join(' ')}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <p class="text-xs text-[var(--ink-soft)]">
    {#if !useFallback}زمان کنونی پخش: <span dir="ltr" class="font-mono">{fmt(currentTime)}</span> • {/if}<a class="underline" href={video.watchUrl} target="_blank" rel="noreferrer">مشاهده در یوتیوب</a>
  </p>
</div>
