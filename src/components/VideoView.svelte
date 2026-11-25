<script>
  import { onMount, onDestroy } from 'svelte'

  // پخش یوتیوب + زیرنویس فارسی همگام (cues) — زیرنویس‌ها از فایل لِیزی course-videos.js می‌آیند.
  let { video } = $props()

  let playerEl = $state(null)
  let player = null
  let apiFailed = $state(false)
  let apiReady = $state(false)
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

  async function startYouTube() {
    try {
      const YT = await loadApi()
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
          }
        }
      })
    } catch {
      apiFailed = true
    }
  }

  onMount(() => {
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
      {video.channel} • زیرنویس فارسی {video.subtitleVersion || ''}
    </p>
  </div>

  <div class="relative w-full overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-black" style="aspect-ratio: 16 / 9;">
    <div bind:this={playerEl} class="absolute inset-0 w-full h-full"></div>
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
    {#if apiFailed}
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#1d1a18] text-[#f5efe6] p-6 text-center">
        <p class="text-sm">پخش‌کنندهٔ یوتیوب بارگذاری نشد (اتصال اینترنت را بررسی کن).</p>
        <a class="underline text-sm" href={video.watchUrl} target="_blank" rel="noreferrer">مشاهدهٔ ویدیو در یوتیوب</a>
      </div>
    {/if}
  </div>

  {#if video.cues && video.cues.length}
    <div>
      <p class="font-bold text-sm mb-2">متن کامل زیرنویس — برای پرش به هر بخش، روی آن بزن</p>
      <div class="space-y-1 max-h-96 overflow-y-auto rounded-2xl border border-[var(--glass-border)] bg-white/70 p-3">
        {#each video.cues as cue}
          <button
            type="button"
            class="w-full text-right flex gap-3 items-start rounded-xl px-2 py-1.5 text-xs leading-6 hover:bg-[var(--canvas-subtle)] cursor-pointer"
            class:bg-[var(--canvas-subtle)]={currentCue === cue}
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
    زمان کنونی پخش: <span dir="ltr" class="font-mono">{fmt(currentTime)}</span>
    • <a class="underline" href={video.watchUrl} target="_blank" rel="noreferrer">مشاهده در یوتیوب</a>
  </p>
</div>
