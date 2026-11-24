<script>
  import { auth } from '../lib/auth-store.svelte.js'
  import { router } from '../lib/router.svelte.js'
  import { COURSE_CONTENT } from '../data/course-content.js'
  import { saveDayProgress, logLearningEvent } from '../lib/course-api.js'
  import LabView from './LabView.svelte'

  // نمای عمومی درس — واحدهای ۱ تا ۵۴ (روز ۰ نمای خودش را دارد).
  let { lesson, progress = null, onProgressUpdated } = $props()

  let unitCode = $derived(`lesson-${lesson.id}`)
  let completedSteps = $derived(
    Array.isArray(progress?.completed_steps) ? progress.completed_steps : []
  )
  let savingStep = $state(null)
  let errorMessage = $state(null)

  // خودآزمایی تمرینی: گزینهٔ انتخاب‌شدهٔ هر تمرین (محلی، نمره ندارد)
  let picked = $state({})
  let teachBack = $state({ concept: '', example: '', trap: '' })

  let phase = $derived(COURSE_CONTENT.phases.find((p) => p.phase === lesson.phase) || null)
  let unitVideos = $derived(
    (COURSE_CONTENT.videos || []).filter((v) => v.unit === lesson.id)
  )
  let quizCode = $derived(lesson.graded ? `quiz-${Math.floor(lesson.id / 2)}-B` : null)
  let prevUnit = $derived(lesson.id > 0 ? COURSE_CONTENT.units[lesson.id - 1] : null)
  let nextUnit = $derived(
    lesson.id < COURSE_CONTENT.units.length - 1 ? COURSE_CONTENT.units[lesson.id + 1] : null
  )

  function unitRoute(unit) {
    return unit.id === 0 ? '#/lesson/day-0' : `#/lesson/${unit.id}`
  }

  function isStepDone(stepId) {
    return completedSteps.includes(stepId)
  }

  async function toggleStep(stepId) {
    if (!auth.isStudent || savingStep) return
    const next = isStepDone(stepId)
      ? completedSteps.filter((s) => s !== stepId)
      : [...completedSteps, stepId]
    savingStep = stepId
    errorMessage = null
    try {
      const res = await saveDayProgress({
        unitCode,
        completedSteps: next,
        status: next.length >= lesson.steps.length ? 'completed' : 'in_progress'
      })
      if (res.error) {
        errorMessage = res.error
        return
      }
      void logLearningEvent(isStepDone(stepId) ? 'lesson_step_unchecked' : 'lesson_step_completed', unitCode, {
        step_id: stepId
      })
      if (onProgressUpdated && res.data) onProgressUpdated(res.data)
    } finally {
      savingStep = null
    }
  }

  function pickExercise(exIdx, optIdx) {
    if (picked[exIdx] !== undefined) return
    picked = { ...picked, [exIdx]: optIdx }
  }
</script>

<div class="space-y-6">
  <header class="glass-card p-5 sm:p-6 space-y-2">
    <div class="overflow-hidden rounded-xl border border-[var(--glass-border)]">
      <img
        src={`covers/cover-phase${lesson.phase}.jpg`}
        alt={`کاور فاز ${lesson.phase} — ${phase?.displayTitle || ''}`}
        class="aspect-[21/9] w-full object-cover"
        loading="eager"
      />
    </div>
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="text-xs font-bold text-[var(--amber-dark)]">
        {lesson.code} — فاز {lesson.phase} · {phase?.displayTitle || ''}
      </span>
      <span class="badge badge-ghost font-bold">روز یادگیری {lesson.day} · ۵۰ دقیقه</span>
    </div>
    <h1 class="text-2xl font-extrabold">{lesson.themeName}</h1>
    <p class="text-sm text-[var(--ink-soft)] leading-7">{lesson.themeBlurb}</p>
    <p class="text-xs text-[var(--ink-soft)]">مبنا: {lesson.basis}</p>

    {#if auth.isTeacher}
      <div class="mt-2 rounded-xl bg-amber-50 border border-amber-300 px-3 py-2 text-xs text-amber-900">
        حالت پیش‌نمایش استاد: تیک مرحله‌ها و خودآزمایی فقط برای شاگرد فعال است؛ دادهٔ شاگرد تغییر نمی‌کند.
      </div>
    {/if}
  </header>

  {#if errorMessage}
    <div class="rounded-xl bg-red-50 border border-red-300 p-4 text-sm text-red-900">
      {errorMessage}
    </div>
  {/if}

  <!-- مرحله‌های درس -->
  <div class="space-y-4">
    {#each lesson.steps as step}
      <article class="paper-card p-5 space-y-3" id={`step-${step.id}`}>
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="space-y-1">
            <h2 class="text-base sm:text-lg font-extrabold leading-7">{step.title}</h2>
            {#if step.source}
              <p class="text-[11px] text-[var(--ink-soft)]">{step.source}</p>
            {/if}
          </div>
          {#if auth.isStudent}
            <button
              type="button"
              class="btn btn-sm shrink-0 border-0 font-bold"
              class:btn-success={isStepDone(step.id)}
              class:text-white={isStepDone(step.id)}
              class:btn-ghost={!isStepDone(step.id)}
              disabled={savingStep === step.id}
              onclick={() => toggleStep(step.id)}
            >
              {savingStep === step.id ? '...' : isStepDone(step.id) ? '✓ خواندم' : 'خواندم'}
            </button>
          {/if}
        </div>

        <div class="space-y-2.5 text-[17px] leading-[2] text-[var(--ink)] sm:text-[18px]">
          {#each step.blocks as block}
            {#if block.t === 'p'}
              <p>{block.x}</p>
            {:else if block.t === 'list'}
              <ul class="list-disc ps-5 space-y-1.5">
                {#each block.items as item}
                  <li>{item}</li>
                {/each}
              </ul>
            {:else if block.t === 'table'}
              <div class="overflow-x-auto">
                <table class="table table-sm text-sm">
                  {#if block.caption}
                    <caption class="caption-top text-xs text-[var(--ink-soft)] pb-2 text-right">
                      {block.caption}
                    </caption>
                  {/if}
                  <thead>
                    <tr>
                      {#each block.head as h}
                        <th>{h}</th>
                      {/each}
                    </tr>
                  </thead>
                  <tbody>
                    {#each block.rows as row}
                      <tr>
                        {#each row as cell}
                          <td>{cell}</td>
                        {/each}
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {:else if block.t === 'callout'}
              <div
                class="rounded-xl border px-4 py-3 text-[15px] leading-8"
                class:bg-emerald-50={block.kind === 'key'}
                class:border-emerald-200={block.kind === 'key'}
                class:text-emerald-900={block.kind === 'key'}
                class:bg-amber-50={block.kind === 'warn'}
                class:border-amber-300={block.kind === 'warn'}
                class:text-amber-900={block.kind === 'warn'}
              >
                {block.x}
              </div>
            {/if}
          {/each}
        </div>
      </article>
    {/each}
  </div>

  <!-- ویدیوها (یوتیوب + زیرنویس فارسی) -->
  {#if unitVideos.length}
    <section class="space-y-3">
      <h2 class="text-lg font-extrabold">ویدیوهای این درس ({unitVideos.length})</h2>
      <div class="grid grid-cols-1 gap-3">
        {#each unitVideos as v}
          <button
            type="button"
            class="paper-card p-4 flex items-start justify-between gap-3 text-right cursor-pointer hover:shadow-[0_8px_24px_rgba(30,25,22,0.08)] transition"
            onclick={() => router.go(`#/video/${v.key}`)}
          >
            <span>
              <span class="block text-sm font-extrabold leading-7">{v.title}</span>
              <span class="block text-xs text-[var(--ink-soft)] mt-1">{v.channel} • زیرنویس فارسی</span>
            </span>
            <span class="badge badge-sm shrink-0 mt-1">پخش با زیرنویس</span>
          </button>
        {/each}
      </div>
    </section>
  {/if}

  <!-- خودآزمایی تمرینی (نمره ندارد؛ پاسخ پس از انتخاب نمایش داده می‌شود) -->
  <section class="space-y-3">
    <h2 class="text-lg font-extrabold">{lesson.exerciseTitle}</h2>
    <p class="text-xs text-[var(--ink-soft)] leading-6">{lesson.exerciseIntro}</p>
    <div class="grid grid-cols-1 gap-4">
      {#each lesson.exerciseItems as ex, exIdx}
        <article class="paper-card p-5 space-y-3">
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-sm font-extrabold leading-7">{ex.prompt}</h3>
            <span class="badge badge-sm badge-ghost shrink-0">{ex.concept}</span>
          </div>
          <div class="space-y-2">
            {#each ex.options as opt, optIdx}
              {@const chosen = picked[exIdx] === optIdx}
              {@const revealed = picked[exIdx] !== undefined}
              {@const isCorrect = optIdx === ex.answer}
              <button
                type="button"
                class="block w-full text-right rounded-xl border p-3 transition"
                class:border-emerald-500={revealed && isCorrect}
                class:bg-emerald-50={revealed && isCorrect}
                class:border-amber-500={chosen && !isCorrect}
                class:bg-amber-50={chosen && !isCorrect}
                class:border-[var(--line)]={!revealed && !chosen}
                class:bg-white={!revealed && !chosen}
                class:cursor-pointer={!revealed}
                class:opacity-70={revealed && !isCorrect && !chosen}
                disabled={revealed || !auth.isStudent}
                onclick={() => pickExercise(exIdx, optIdx)}
              >
                <span class="text-sm font-medium block">{opt}</span>
              </button>
            {/each}
          </div>
          {#if picked[exIdx] !== undefined}
            <p class="text-xs leading-6 rounded-xl bg-[var(--bg-warm)] border border-[var(--line)] px-3 py-2">
              {ex.why}
            </p>
          {/if}
        </article>
      {/each}
    </div>
  </section>

  <!-- واژگان -->
  <details class="paper-card p-5">
    <summary class="cursor-pointer text-sm font-extrabold">
      واژگان این درس ({lesson.glossary.length} واژه)
    </summary>
    <ul class="mt-3 space-y-2.5">
      {#each lesson.glossary as w}
        <li class="text-sm leading-7 border-b border-[var(--line)] pb-2 last:border-0">
          <strong>{w.fa}</strong>
          <span dir="ltr" class="text-xs text-[var(--ink-soft)]"> — {w.en}</span>
          <span class="block text-[var(--ink-soft)]">{w.def}</span>
        </li>
      {/each}
    </ul>
  </details>

  <!-- بازگو (سه جمله — فقط محلی) -->
  <section class="paper-card p-5 space-y-3">
    <h2 class="text-sm font-extrabold">بازگو — سه جمله به زبان خودت (فقط در همین مرورگر می‌ماند)</h2>
    <div class="space-y-3">
      <label class="block space-y-1">
        <span class="text-xs font-bold">{lesson.teach?.concept}</span>
        <textarea
          class="textarea textarea-bordered w-full text-sm leading-7"
          rows="2"
          bind:value={teachBack.concept}
          placeholder="جمله اول را اینجا بنویس..."
        ></textarea>
      </label>
      <label class="block space-y-1">
        <span class="text-xs font-bold">{lesson.teach?.example}</span>
        <textarea
          class="textarea textarea-bordered w-full text-sm leading-7"
          rows="2"
          bind:value={teachBack.example}
          placeholder="جمله دوم را اینجا بنویس..."
        ></textarea>
      </label>
      <label class="block space-y-1">
        <span class="text-xs font-bold">{lesson.teach?.trap}</span>
        <textarea
          class="textarea textarea-bordered w-full text-sm leading-7"
          rows="2"
          bind:value={teachBack.trap}
          placeholder="جمله سوم را اینجا بنویس..."
        ></textarea>
      </label>
    </div>
  </section>

  <!-- آزمایشگاه زنده (Pyodide در مرورگر + ذخیرهٔ دفترچه) -->
  {#if lesson.lab}
    <section class="paper-card p-5">
      <LabView
        lab={lesson.lab}
        dataset={COURSE_CONTENT.labDatasets?.[String(lesson.id)] || null}
        labCode={`lab-${lesson.id}`}
      />
      <div class="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="btn-ml-ghost text-sm"
          onclick={() => router.go(`#/studio?lab=lab-${lesson.id}`)}
        >
          تمرین در Jarvis Studio
        </button>
        <span class="text-xs text-[var(--ink-soft)]">
          با کرنل واقعی (TensorFlow) — Ctrl+J هم همان‌جا می‌برد.
        </span>
      </div>
    </section>
  {/if}

  <!-- آزمون یا پیوند به درس B -->
  {#if lesson.graded && quizCode}
    <section class="glass-card next-step-card p-5 sm:p-6 space-y-3">
      <h2 class="text-base font-extrabold">آزمون نمره‌دار این درس</h2>
      <p class="text-xs text-[var(--ink-soft)] leading-6">
        {lesson.quizTitle} — ۶ سؤال، تصحیح سروری، دروازه دقیق ۶۰٫۰٪. بهترین نمره ملاک دروازهٔ فاز است.
      </p>
      <button type="button" class="btn-ml-primary" onclick={() => router.go(`#/quiz/${quizCode}`)}>
        رفتن به آزمون
      </button>
    </section>
  {:else}
    <section class="glass-card p-5 space-y-2">
      <p class="text-sm leading-7">
        آزمون نمره‌دار این درس در درس {lesson.code.replace('الف', 'ب')} است؛ اول این درس را کامل بخوانید.
      </p>
      {#if nextUnit}
        <button type="button" class="btn-ml-ghost text-xs" onclick={() => router.go(unitRoute(nextUnit))}>
          رفتن به درس بعدی: {nextUnit.code} — {nextUnit.title}
        </button>
      {/if}
    </section>
  {/if}

  <!-- ناوبری درس قبلی / بعدی -->
  <nav class="flex items-center justify-between gap-3">
    {#if prevUnit}
      <button type="button" class="btn-ml-ghost text-xs" onclick={() => router.go(unitRoute(prevUnit))}>
        → {prevUnit.code} — {prevUnit.title}
      </button>
    {:else}
      <span></span>
    {/if}
    {#if nextUnit}
      <button type="button" class="btn-ml-ghost text-xs" onclick={() => router.go(unitRoute(nextUnit))}>
        {nextUnit.code} — {nextUnit.title} ←
      </button>
    {/if}
  </nav>
</div>
