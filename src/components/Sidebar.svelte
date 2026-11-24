<script>
  import { auth } from '../lib/auth-store.svelte.js'
  import { signOut } from '../lib/auth.js'
  import { router } from '../lib/router.svelte.js'
  import { COURSE_TREE } from '../data/day0-content.js'
  import { COURSE_CONTENT } from '../data/course-content.js'

  let {
    completedSteps = [],
    simpleMode = false,
    onToggleSimpleMode,
    progressMap = {},
    gates = []
  } = $props()
  let expandedPhase = $state('phase-0')
  let expandedLesson = $state('day-0')
  let expandedCoursePhase = $state(1)

  function isStepDone(stepId) {
    return Array.isArray(completedSteps) && completedSteps.includes(stepId)
  }

  function unitCodeFor(unit) {
    return unit.id === 0 ? 'day-0' : `lesson-${unit.id}`
  }

  function unitRoute(unit) {
    return unit.id === 0 ? '#/lesson/day-0' : `#/lesson/${unit.id}`
  }

  function unitStatus(unit) {
    return progressMap[unitCodeFor(unit)] || null
  }

  function gateFor(phaseNo) {
    return gates.find((g) => g.phase === phaseNo) || null
  }

  // Jarvis Studio — ورود از سربرگ؛ اگر روی درسی هستیم، همان لب باز می‌شود.
  const studioKeyHint =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')
      ? '⌘J'
      : 'Ctrl+J'

  // کارت شیشه‌ای یک‌بارمصرف روز اول (سنجش، کشف‌پذیری) — زیر دکمهٔ ورود به استودیو.
  // فقط یک پرچم راهنما در localStorage؛ هیچ نشست/توکنی اینجا ذخیره نمی‌شود.
  const DAY1_HINT_KEY = 'jarvis-studio-day1-hint-seen'
  function day1HintSeen() {
    try {
      return (
        typeof window !== 'undefined' && window.localStorage?.getItem(DAY1_HINT_KEY) === '1'
      )
    } catch {
      return false
    }
  }
  let showDay1Hint = $state(!day1HintSeen())
  function dismissDay1Hint() {
    try {
      window.localStorage?.setItem(DAY1_HINT_KEY, '1')
    } catch {
      /* ذخیرهٔ محلی در دسترس نیست؛ فقط همین نشست مخفی می‌شود */
    }
    showDay1Hint = false
  }
  function studioRoute() {
    const m = router.path.match(/^\/lesson\/(\d+)$/)
    if (m) return `#/studio?lab=lab-${m[1]}`
    if (router.path === '/lesson/day-0') return '#/studio?lab=lab-0'
    return '#/studio'
  }
</script>

<!-- سایدبار سه‌سطحی (فاز ← درس ← مرحله) در سمت راست برای RTL -->
<aside
  class="glass-chrome w-full lg:w-80 lg:min-h-[calc(100vh-2rem)] lg:sticky lg:top-4 rounded-2xl p-4 flex flex-col justify-between gap-5"
  aria-label="ناوبری دوره"
>
  <div class="space-y-5">
    <!-- سرستون برند -->
    <div class="flex items-center justify-between pb-3 border-b border-[var(--line)]">
      <div class="flex items-center gap-2.5 lg:gap-3">
        <img
          src="logo/logo-mark-color.svg"
          alt="نشان دورهٔ یادگیری ماشین"
          class="w-8 lg:w-9 h-auto shrink-0"
        />
        <div>
          <p class="font-extrabold text-sm">یادگیری ماشین</p>
          <p class="text-[11px] text-[var(--ink-soft)]">
            {auth.isTeacher ? 'پنل استاد' : 'پنل شاگرد'} — {auth.member?.display_name}
          </p>
        </div>
      </div>
      <span
        class="badge badge-sm border-0"
        class:bg-amber-100={auth.isTeacher}
        class:text-amber-900={auth.isTeacher}
        class:bg-emerald-100={auth.isStudent}
        class:text-emerald-900={auth.isStudent}
      >
        {auth.isTeacher ? 'استاد' : 'شاگرد'}
      </span>
    </div>

    <!-- ناوبری اصلی -->
    <nav class="space-y-1.5">
      <p class="text-[11px] font-bold text-[var(--ink-soft)] px-2">بخش‌های اصلی</p>

      <button
        type="button"
        class="w-full text-right px-3 py-2.5 rounded-xl text-sm font-medium transition cursor-pointer flex items-center justify-between"
        class:bg-[var(--amber-soft)]={router.path === '/'}
        class:text-[var(--amber-dark)]={router.path === '/'}
        class:font-bold={router.path === '/'}
        onclick={() => router.go('#/')}
      >
        <span>خانه و قدم بعدی</span>
      </button>

      <!-- Jarvis Studio — کپسول تراکوتا + نشان کلید -->
      <button
        type="button"
        class="btn-ml-primary w-full text-sm flex items-center justify-between"
        onclick={() => router.go(studioRoute())}
      >
        <!-- R3 — نشان شفاف ۲۸px -->
        <span class="flex items-center gap-2">
          <img src="logo/jarvis-studio-shield-emblem-transparent-28.png" alt="" width="28" height="28" class="shrink-0" />
          <span>ورود به استودیو</span>
        </span>
        <span class="text-xs opacity-80" dir="ltr">{studioKeyHint}</span>
      </button>

      <!-- کارت شیشه‌ای یک‌بارمصرف روز اول -->
      {#if showDay1Hint}
        <div class="glass-card p-3">
          <p class="text-xs leading-6">هر جا که بودی، با Ctrl+J میز کارت را باز کن</p>
          <div class="mt-2 flex justify-end">
            <button
              type="button"
              class="btn-ml-ghost !min-h-[32px] px-3 text-xs"
              onclick={dismissDay1Hint}
            >
              فهمیدم
            </button>
          </div>
        </div>
      {/if}

      {#if auth.isTeacher}
        <button
          type="button"
          class="w-full text-right px-3 py-2.5 rounded-xl text-sm font-medium transition cursor-pointer flex items-center justify-between"
          class:bg-[var(--amber-soft)]={router.path === '/teacher'}
          class:text-[var(--amber-dark)]={router.path === '/teacher'}
          class:font-bold={router.path === '/teacher'}
          onclick={() => router.go('#/teacher')}
        >
          <span>داشبورد استاد</span>
          <span class="badge badge-xs bg-[var(--coral)] text-white border-0">فقط استاد</span>
        </button>
      {/if}
    </nav>

    <!-- فهرست کامل دوره — ۸ فاز، ۵۵ واحد (فاز ۲) -->
    <div class="space-y-2">
      <p class="text-[11px] font-bold text-[var(--ink-soft)] px-2">
        همهٔ درس‌ها — ۸ فاز، ۵۵ واحد
      </p>

      {#each COURSE_CONTENT.phases as phase}
        {@const gate = gateFor(phase.phase)}
        <div class="rounded-xl border border-[var(--line)] bg-white/55 p-2 space-y-1.5">
          <button
            type="button"
            class="w-full text-right px-2 py-1.5 rounded-lg text-xs font-extrabold flex items-center justify-between cursor-pointer hover:bg-white/70"
            onclick={() =>
              (expandedCoursePhase = expandedCoursePhase === phase.phase ? 0 : phase.phase)}
          >
            <span>فاز {phase.phase} — {phase.displayTitle}</span>
            <span class="text-[var(--ink-soft)]">
              {expandedCoursePhase === phase.phase ? '▾' : '◂'}
            </span>
          </button>
          <p class="px-2 text-[10px] text-[var(--ink-soft)]">
            {#if gate?.avg === null}
              دروازه: هنوز آزمونی ثبت نشده
            {:else if gate.open}
              دروازه باز — میانگین بهترین نمره‌ها {gate.avg.toFixed(1)}٪
            {:else}
              دروازه بسته — میانگین بهترین نمره‌ها {gate.avg.toFixed(1)}٪ (نیاز: ۶۰٫۰٪)
            {/if}
          </p>

          {#if expandedCoursePhase === phase.phase}
            <div class="ps-2 border-s-2 border-amber-300/70 space-y-1">
              {#each COURSE_CONTENT.units.filter((u) => u.phase === phase.phase) as unit}
                {@const st = unitStatus(unit)}
                {@const active =
                  router.path === unitRoute(unit).slice(1) ||
                  (unit.id === 0 && router.path === '/lesson/day-0')}
                <button
                  type="button"
                  class="w-full text-right px-2 py-1.5 rounded-lg text-xs flex items-center justify-between gap-2 cursor-pointer hover:bg-white/80"
                  class:bg-[var(--amber-soft)]={active}
                  class:text-[var(--amber-dark)]={active}
                  class:font-bold={active}
                  onclick={() => router.go(unitRoute(unit))}
                >
                  <span class="truncate">{unit.code} — {unit.title}</span>
                  {#if st === 'completed'}
                    <span class="text-emerald-600 font-bold shrink-0" title="تکمیل‌شده">✓</span>
                  {:else if st === 'in_progress'}
                    <span class="text-amber-600 font-bold shrink-0" title="در حال انجام">•</span>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/each}

      <!-- تکلیف پایانی روز ۴۰ -->
      <button
        type="button"
        class="w-full text-right px-3 py-2 rounded-xl text-xs font-extrabold cursor-pointer hover:bg-white/80 border border-[var(--line)] bg-white/55"
        class:bg-[var(--amber-soft)]={router.path === '/capstone'}
        class:text-[var(--amber-dark)]={router.path === '/capstone'}
        onclick={() => router.go('#/capstone')}
      >
        کپستون نهایی روز ۴۰
      </button>
    </div>

    <!-- درخت سه‌سطحی روز ۰: فاز ← درس ← مرحله -->
    <div class="space-y-2">
      <p class="text-[11px] font-bold text-[var(--ink-soft)] px-2">
        مسیر روز ۰ (فاز ← درس ← مرحله)
      </p>

      {#each COURSE_TREE as phase}
        <div class="rounded-xl border border-[var(--line)] bg-white/55 p-2 space-y-1.5">
          <!-- سطح ۱: فاز -->
          <button
            type="button"
            class="w-full text-right px-2 py-1.5 rounded-lg text-xs font-extrabold flex items-center justify-between cursor-pointer hover:bg-white/70"
            onclick={() =>
              (expandedPhase = expandedPhase === phase.phaseId ? '' : phase.phaseId)}
          >
            <span>{phase.phaseTitle}</span>
            <span class="text-[var(--ink-soft)]">
              {expandedPhase === phase.phaseId ? '▾' : '◂'}
            </span>
          </button>

          {#if expandedPhase === phase.phaseId}
            <div class="ps-2 border-s-2 border-amber-300/70 space-y-1.5">
              {#each phase.lessons as lesson}
                <!-- سطح ۲: درس -->
                <div>
                  <button
                    type="button"
                    class="w-full text-right px-2 py-1.5 rounded-lg text-xs font-bold flex items-center justify-between cursor-pointer hover:bg-white/80"
                    class:bg-[var(--amber-soft)]={router.path === '/lesson/day-0'}
                    class:text-[var(--amber-dark)]={router.path === '/lesson/day-0'}
                    onclick={() => {
                      expandedLesson = lesson.unitCode
                      router.go(lesson.route)
                    }}
                  >
                    <span>{lesson.title}</span>
                    <span class="text-[10px] opacity-75">{lesson.badge}</span>
                  </button>

                  {#if expandedLesson === lesson.unitCode}
                    <!-- سطح ۳: مراحل درس -->
                    <ul class="mt-1 ps-3 space-y-1 border-s border-[var(--line)]">
                      {#each lesson.steps as step}
                        <li>
                          <button
                            type="button"
                            class="w-full text-right px-2 py-1 rounded-md text-xs flex items-center justify-between gap-2 cursor-pointer hover:bg-white/80"
                            class:font-bold={router.path === '/lesson/day-0' && router.step === step.id}
                            onclick={() => router.go(`#/lesson/day-0?step=${step.id}`)}
                          >
                            <span class="truncate">{step.title}</span>
                            {#if isStepDone(step.id)}
                              <span class="text-emerald-600 font-bold" title="تکمیل‌شده">✓</span>
                            {/if}
                          </button>
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </div>
              {/each}

              <!-- آزمون نمونه روز ۰ -->
              <button
                type="button"
                class="w-full text-right px-2 py-1.5 rounded-lg text-xs font-bold flex items-center justify-between cursor-pointer hover:bg-white/80"
                class:bg-[var(--amber-soft)]={router.path === '/quiz/quiz-day-0'}
                class:text-[var(--amber-dark)]={router.path === '/quiz/quiz-day-0'}
                onclick={() => router.go('#/quiz/quiz-day-0')}
              >
                <span>آزمون نمونه روز ۰ (۶ سؤال)</span>
                <span class="text-[10px] text-[var(--coral)]">دروازه ۶۰٪</span>
              </button>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>

  <!-- فوتر سایدبار: حالت ساده + خروج -->
  <div class="pt-3 border-t border-[var(--line)] space-y-2">
    <button
      type="button"
      class="btn-ml-ghost w-full text-xs flex items-center justify-between"
      onclick={onToggleSimpleMode}
    >
      <span>حالت ساده (بدون شیشه)</span>
      <span class="font-bold">{simpleMode ? 'روشن' : 'خاموش'}</span>
    </button>

    <button
      type="button"
      class="btn-ml-ghost w-full text-xs text-red-700 border-red-200 hover:bg-red-50"
      onclick={() => signOut()}
    >
      خروج از حساب
    </button>
  </div>
</aside>
