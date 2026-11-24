<script>
  import { onMount } from 'svelte'
  import { auth } from '../lib/auth-store.svelte.js'
  import { router } from '../lib/router.svelte.js'
  import { DAY0_LESSON } from '../data/day0-content.js'
  import { saveDayProgress, logLearningEvent } from '../lib/course-api.js'

  let { day0Progress = null, onProgressUpdated } = $props()

  let saving = $state(false)
  let statusMessage = $state(null)
  let errorMessage = $state(null)
  let exerciseNotes = $state({})

  let completedSteps = $derived(
    Array.isArray(day0Progress?.completed_steps) ? day0Progress.completed_steps : []
  )

  onMount(() => {
    void logLearningEvent('lesson_opened', 'day-0', { step: router.step || 'all' })
  })

  async function toggleStep(stepId) {
    if (!auth.isStudent) return
    errorMessage = null
    statusMessage = null

    const set = new Set(completedSteps)
    if (set.has(stepId)) {
      set.delete(stepId)
    } else {
      set.add(stepId)
    }
    const nextSteps = Array.from(set)
    const nextStatus =
      nextSteps.length >= DAY0_LESSON.steps.length
        ? 'completed'
        : nextSteps.length > 0
          ? 'in_progress'
          : 'not_started'

    saving = true
    try {
      const res = await saveDayProgress({
        unitCode: 'day-0',
        completedSteps: nextSteps,
        status: nextStatus
      })
      if (res.error) {
        errorMessage = res.error
        return
      }
      if (res.data && onProgressUpdated) {
        onProgressUpdated(res.data)
      }
      void logLearningEvent('step_toggled', 'day-0', {
        step_id: stepId,
        completed_count: nextSteps.length,
        status: nextStatus
      })
      statusMessage = 'پیشرفت شما در سرور ثبت شد.'
    } finally {
      saving = false
    }
  }
</script>

<div class="space-y-6">
  <header class="glass-card p-5 sm:p-6 space-y-2">
    <div class="overflow-hidden rounded-xl border border-[var(--glass-border)]">
      <img
        src="covers/cover-day0.jpg"
        alt="کاور روز ۰ — جهت‌یابی و نقشهٔ راه دوره"
        class="aspect-[21/9] w-full object-cover"
        loading="eager"
      />
    </div>
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="text-xs font-bold text-[var(--amber-dark)]">فاز ۰ ← روز ۰</span>
      <span class="badge bg-[var(--amber-soft)] text-[var(--amber-dark)] border-0">
        {DAY0_LESSON.badge}
      </span>
    </div>
    <h1 class="text-2xl font-extrabold">{DAY0_LESSON.title}</h1>
    <p class="text-xs text-[var(--ink-soft)]">
      پیشرفت این درس ذخیره می‌شود و فقط شما و استاد آن را می‌بینید.
    </p>

    {#if auth.isTeacher}
      <div class="mt-2 rounded-xl bg-amber-50 border border-amber-300 px-3 py-2 text-xs text-amber-900">
        حالت پیش‌نمایش استاد: شما محتوای درس را می‌بینید، اما تغییری در پیشرفت شاگرد ثبت نمی‌شود.
      </div>
    {/if}
  </header>

  {#if errorMessage}
    <div class="rounded-xl bg-red-50 border border-red-300 p-3 text-sm text-red-900">
      {errorMessage}
    </div>
  {/if}

  {#if statusMessage}
    <div class="rounded-xl bg-emerald-50 border border-emerald-300 p-3 text-sm text-emerald-900">
      {statusMessage}
    </div>
  {/if}

  <!-- مراحل درس (کارت‌های مات برای خوانایی متن طولانی) -->
  <div class="space-y-4">
    {#each DAY0_LESSON.steps as step}
      {@const done = completedSteps.includes(step.id)}
      {@const highlighted = router.step === step.id}
      <section
        id={step.id}
        class="paper-card p-5 sm:p-6 space-y-3 transition"
        class:ring-2={highlighted}
        class:ring-amber-500={highlighted}
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-lg font-extrabold">{step.title}</h2>
            <p class="text-xs text-[var(--ink-soft)]">{step.summary}</p>
          </div>

          {#if auth.isStudent}
            <button
              type="button"
              class="btn btn-sm rounded-xl border"
              class:bg-emerald-600={done}
              class:text-white={done}
              class:border-emerald-600={done}
              class:bg-white={!done}
              disabled={saving}
              onclick={() => toggleStep(step.id)}
            >
              {done ? '✓ تکمیل شد' : 'علامت‌زدن به‌عنوان تکمیل'}
            </button>
          {:else}
            <span class="badge badge-sm badge-ghost">
              {done ? 'تکمیل‌شده توسط شاگرد' : 'در انتظار شاگرد'}
            </span>
          {/if}
        </div>

        <div class="space-y-2.5 text-[17px] leading-[2] text-[var(--ink)] sm:text-[18px]">
          {#each step.body as paragraph}
            <p>{paragraph}</p>
          {/each}
        </div>

        {#if step.exercises}
          <div class="pt-3 border-t border-[var(--line)] space-y-3">
            <h3 class="text-sm font-bold text-[var(--amber-dark)]">تمرین‌های جهت‌یابی (۶ مورد)</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              {#each step.exercises as ex, idx}
                <div class="rounded-xl bg-[var(--bg-warm)] border border-[var(--line)] p-3 space-y-2">
                  <p class="text-xs font-bold">تمرین {idx + 1}: {ex.prompt}</p>
                  <textarea
                    rows="2"
                    class="textarea textarea-bordered w-full text-xs bg-white"
                    placeholder="یادداشت کوتاه شما برای خودارزیابی..."
                    bind:value={exerciseNotes[ex.id]}
                    disabled={!auth.isStudent}
                  ></textarea>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </section>
    {/each}
  </div>

  <!-- حرکت به آزمون نمونه -->
  <div class="glass-card p-5 flex flex-wrap items-center justify-between gap-4">
    <div>
      <p class="font-bold text-sm">آماده آزمون نمونه روز ۰ هستید؟</p>
      <p class="text-xs text-[var(--ink-soft)]">
        ۶ سؤال تک‌مفهومی با تصحیح سروری و ثبت خودکار اشتباه‌ها.
      </p>
    </div>
    <button
      type="button"
      class="btn-ml-primary"
      onclick={() => router.go('#/quiz/quiz-day-0')}
    >
      رفتن به آزمون نمونه
    </button>
  </div>
</div>
