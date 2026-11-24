<script>
  import { onMount } from 'svelte'
  import { COURSE_CONTENT } from '../data/course-content.js'
  import { router } from '../lib/router.svelte.js'
  import { auth } from '../lib/auth-store.svelte.js'
  import { paletteState, openPalette, closePalette } from '../lib/command-palette.svelte.js'

  // پالت فرمان Ctrl+K — پرش سریع میان ۵۵ واحد دوره (تصمیم‌های واگذارشده،
  // مورد ۴). نام واحدها از همان منبع سایدبار است: «کد — عنوان». با میانبور
  // Ctrl+J استودیو تداخل ندارد (KeyK در برابر KeyJ)؛ وسط تایپ در فیلد
  // دیگری باز نمی‌شود؛ فقط در چیدمانِ واردشده mount می‌شود، پس در صفحهٔ
  // ورود و داخل استودیو اصلاً وجود ندارد. باز شدن از میانبور صفحه‌کلید
  // و از دکمهٔ لمسی «جستجوی سریع» سایدبار یک مسیر است: تابع مشترک
  // openPalette در lib/command-palette.svelte.js.
  let query = $state('')
  let active = $state(0)
  let inputEl = $state(null)

  // نرمال‌سازی جست‌وجو: ی/ک عربی → فارسی، ارقام فارسی/عربی → لاتین، تا
  // «1-الف» هم «۱-الف» را پیدا کند.
  function normalize(s) {
    return String(s ?? '')
      .replace(/[ي]/g, 'ی')
      .replace(/[ك]/g, 'ک')
      .replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
      .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
  }

  const units = COURSE_CONTENT.units || []
  let filtered = $derived.by(() => {
    const q = normalize(query)
    if (!q) return units
    return units.filter((u) => normalize(`${u.code} ${u.title}`).includes(q))
  })
  let safeActive = $derived(
    filtered.length === 0 ? -1 : Math.min(Math.max(active, 0), filtered.length - 1)
  )

  function unitRoute(unit) {
    return unit.id === 0 ? '#/lesson/day-0' : `#/lesson/${unit.id}`
  }
  function close() {
    closePalette()
    query = ''
    active = 0
  }
  function goTo(unit) {
    if (!unit) return
    close()
    router.go(unitRoute(unit))
  }

  function onWindowKey(e) {
    if (!auth.canOperate) return
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') {
      const t = e.target
      const typing =
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      // وسط تایپ در فیلد دیگری باز نمی‌شود؛ وقتی خودش باز است فقط فوکوس می‌گیرد.
      if (typing && !paletteState.open) return
      e.preventDefault()
      if (!paletteState.open) openPalette()
      else inputEl?.focus()
      return
    }
    if (e.key === 'Escape' && paletteState.open) {
      e.preventDefault()
      close()
    }
  }

  function onInputKey(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (filtered.length > 0) active = Math.min(safeActive + 1, filtered.length - 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (filtered.length > 0) active = Math.max(safeActive - 1, 0)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (safeActive >= 0) goTo(filtered[safeActive])
    }
  }

  $effect(() => {
    if (paletteState.open) inputEl?.focus()
  })

  onMount(() => {
    window.addEventListener('keydown', onWindowKey)
    return () => window.removeEventListener('keydown', onWindowKey)
  })
</script>

{#if paletteState.open}
  <div
    class="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[15vh]"
    style="background: rgba(30, 25, 22, 0.35);"
    onclick={(e) => {
      if (e.target === e.currentTarget) close()
    }}
  >
    <div
      data-palette-panel
      class="glass-card w-full max-w-lg overflow-hidden"
      role="dialog"
      aria-label="پرش سریع میان درس‌ها"
    >
      <div class="px-4 pt-4 pb-2">
        <h2 class="text-sm font-bold">پرش سریع میان درس‌ها</h2>
        <p class="text-xs opacity-70">۵۵ واحد — نام یا کد درس را بنویسید</p>
      </div>
      <div class="px-4 pb-2">
        <input
          bind:this={inputEl}
          bind:value={query}
          oninput={() => {
            active = 0
          }}
          onkeydown={onInputKey}
          type="text"
          aria-label="جست‌وجوی درس"
          placeholder="جست‌وجوی درس…"
          autocomplete="off"
          class="input input-bordered w-full"
        />
      </div>
      {#if filtered.length === 0}
        <p class="px-4 pb-4 text-sm opacity-70">درسی با این نام پیدا نشد.</p>
      {:else}
        <ul class="max-h-[50vh] overflow-y-auto px-2 pb-2" role="listbox">
          {#each filtered as unit, i}
            <li>
              <button
                type="button"
                role="option"
                aria-selected={i === safeActive}
                data-palette-item
                data-unit-id={unit.id}
                data-active={i === safeActive}
                class="w-full text-right px-3 py-2 rounded-lg text-sm truncate"
                style={i === safeActive ? 'background: rgba(184, 66, 31, 0.08);' : ''}
                onclick={() => goTo(unit)}
                onmouseenter={() => {
                  active = i
                }}
              >
                {unit.code} — {unit.title}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="px-4 py-2 text-xs opacity-60 border-t">↑↓ جابه‌جا · Enter رفتن · Esc بستن</div>
    </div>
  </div>
{/if}
