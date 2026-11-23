<script>
  import { COURSE_CONTENT } from '../data/course-content.js'
  import LabView from './LabView.svelte'

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

  <!-- آزمایشگاه تکلیف پایانی (زنده) -->
  {#if cap.lesson?.lab}
    <section class="paper-card p-5">
      <LabView
        lab={cap.lesson.lab}
        dataset={COURSE_CONTENT.labDatasets?.['100'] || null}
        labCode="capstone-day-40"
      />
    </section>
  {/if}
</div>
