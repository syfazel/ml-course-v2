<script>
  import { COURSE_CONTENT } from '../data/course-content.js'

  let cap = COURSE_CONTENT.capstone
</script>

<div class="space-y-6">
  <header class="glass-card p-5 sm:p-6 space-y-2">
    <div class="overflow-hidden rounded-xl border border-[var(--glass-border)]">
      <img
        src="covers/cover-hero.jpg"
        alt="کاور اصلی دوره یادگیری ماشین"
        class="aspect-[21/9] w-full object-cover"
        loading="eager"
      />
    </div>
    <span class="text-xs font-bold text-[var(--amber-dark)]">تکلیف پایانی — روز ۴۰</span>
    <h1 class="text-2xl font-extrabold">کپستون نهایی روز ۴۰</h1>
    <p class="text-sm text-[var(--ink-soft)] leading-7">{cap.finalText}</p>
  </header>

  <!-- کپستون‌های ۸ فاز -->
  <section class="space-y-3">
    <h2 class="text-lg font-extrabold">کپستون هر فاز</h2>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      {#each cap.phaseCapstones as pc}
        <article class="paper-card p-5 space-y-2">
          <span class="text-xs font-bold text-[var(--terracotta)]">فاز {pc.phase}</span>
          <h3 class="text-sm font-extrabold leading-6">{pc.displayTitle}</h3>
          <p class="text-xs text-[var(--ink-soft)] leading-6">{pc.capstone}</p>
        </article>
      {/each}
    </div>
  </section>

  <!-- آزمایشگاه تکلیف پایانی (خواندنی؛ اجرا در فاز ۳) -->
  {#if cap.lesson?.lab}
    <details class="paper-card p-5">
      <summary class="cursor-pointer text-sm font-extrabold">
        {cap.lesson.lab.title}
      </summary>
      <p class="mt-2 text-xs text-[var(--ink-soft)] leading-6">{cap.lesson.lab.intro}</p>
      <p class="mt-1 text-[11px] text-[var(--ink-soft)]">
        اجرای زنده با ژوپیتر در فاز ۳ می‌آید؛ فعلاً سلول‌ها فقط خواندنی‌اند.
      </p>
      <div class="mt-3 space-y-3">
        {#each cap.lesson.lab.cells as cell}
          <div class="rounded-xl border border-[var(--line)] overflow-hidden">
            <p class="text-xs font-bold px-3 py-2 bg-[var(--bg-warm)]">{cell.title}</p>
            <pre dir="ltr" class="font-code text-left text-[13px] leading-6 px-3 py-2 overflow-x-auto bg-[#1d1a18] text-[#ede6da]">{cell.code}</pre>
            <p class="text-xs leading-6 px-3 py-2 text-[var(--ink-soft)]">
              {cell.note} — خروجی مورد انتظار: <code dir="ltr">{cell.expected}</code>
            </p>
          </div>
        {/each}
      </div>
    </details>
  {/if}
</div>
