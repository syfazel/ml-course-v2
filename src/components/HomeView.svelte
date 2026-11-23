<script>
  import { auth } from '../lib/auth-store.svelte.js'
  import { router } from '../lib/router.svelte.js'
  import { DAY0_LESSON } from '../data/day0-content.js'

  let { day0Progress = null, latestQuiz = null } = $props()

  // نقشهٔ راه — نام‌های قفل‌شدهٔ ۸ فاز (تیک گام ۲، ۲۴ نوامبر ۰۰:۳۶)
  const PHASES = [
    { n: 1, title: 'یادگیری با نظارت: رگرسیون و طبقه‌بندی' },
    { n: 2, title: 'الگوریتم‌های پیشرفتهٔ یادگیری' },
    { n: 3, title: 'یادگیری بدون نظارت، پیشنهاددهنده و تقویتی' },
    { n: 4, title: 'شبکه‌های عصبی و یادگیری عمیق' },
    { n: 5, title: 'بهبود شبکه‌های عمیق: بهینه‌سازی و تنظیم' },
    { n: 6, title: 'ساختاردهی پروژه‌های یادگیری ماشین' },
    { n: 7, title: 'شبکه‌های کانولوشنی: دیدن با ماشین' },
    { n: 8, title: 'مدل‌های توالی و ترنسفورمر' }
  ]

  let completedCount = $derived(
    Array.isArray(day0Progress?.completed_steps)
      ? day0Progress.completed_steps.length
      : 0
  )
  let totalSteps = DAY0_LESSON.steps.length
  let isDay0Done = $derived(
    day0Progress?.status === 'completed' || completedCount >= totalSteps
  )

  let nextAction = $derived.by(() => {
    if (auth.isTeacher) {
      return {
        label: 'مشاهده داشبورد استاد و وضعیت شاگرد',
        description:
          'نمای کلی پیشرفت درس روز ۰، سابقه آزمون‌های ثبت‌شده، اشتباه‌ها و لاگ ممیزی زنده را بررسی کنید.',
        cta: 'ورود به داشبورد استاد',
        target: '#/teacher'
      }
    }
    if (!isDay0Done) {
      return {
        label: 'ادامه روز ۰: جهت‌یابی و نقشه راه دوره',
        description: `تا الان ${completedCount} از ${totalSteps} مرحله روز ۰ را تکمیل کرده‌اید. پس از تکمیل مراحل، آزمون نمونه ۶ سؤالی آماده است.`,
        cta: completedCount === 0 ? 'شروع روز ۰' : 'ادامه روز ۰',
        target: '#/lesson/day-0'
      }
    }
    if (!latestQuiz || !latestQuiz.passed_gate) {
      return {
        label: 'انجام آزمون نمونه روز ۰ (۶ سؤال)',
        description:
          'مراحل درس روز ۰ را کامل کرده‌اید. حالا آزمون نمونه را ثبت کنید تا تصحیح سروری و دروازه ۶۰٪ آزمایش شود.',
        cta: 'شروع آزمون نمونه',
        target: '#/quiz/quiz-day-0'
      }
    }
    return {
      label: 'اسکلت فاز ۱ با موفقیت گذرانده شد',
      description: `آخرین نمره دقیق شما ${latestQuiz.score_percent}٪ بوده و دروازه ۶۰٪ باز شده است. آماده انتقال درس‌های فاز ۲ هستید.`,
      cta: 'مرور دوباره درس روز ۰',
      target: '#/lesson/day-0'
    }
  })
</script>

<div class="space-y-6">
  <!-- بنر کاور اصلی -->
  <div class="overflow-hidden rounded-3xl border border-[var(--glass-border)] shadow-[0_8px_24px_rgba(30,25,22,0.06)]">
    <img
      src="covers/cover-hero.jpg"
      alt="کاور اصلی دوره یادگیری ماشین"
      class="h-44 w-full object-cover sm:h-64"
      loading="eager"
    />
  </div>

  <!-- سلام -->
  <header class="space-y-1">
    <p class="text-xs font-bold text-[var(--amber-dark)]">خانه دوره — اسکلت فاز ۱</p>
    <h1 class="text-2xl sm:text-3xl font-extrabold">
      سلام، {auth.member?.display_name || 'کاربر گرامی'}
    </h1>
    <p class="text-sm text-[var(--ink-soft)]">
      {auth.isTeacher
        ? 'شما با نقش استاد وارد شده‌اید؛ می‌توانید درس و آزمون را پیش‌نمایش ببینید و گزارش واقعی شاگرد را در داشبورد رصد کنید.'
        : 'خوش آمدید. پیشرفت شما به‌طور امن ذخیره می‌شود و فقط برای شما و استاد قابل مشاهده است.'}
    </p>
  </header>

  <!-- کارت «قدم بعدی» تمام‌عرض -->
  <section class="glass-card next-step-card p-6 sm:p-7 space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="badge bg-[var(--amber)] text-white border-0 font-bold">قدم بعدی</span>
      {#if !auth.isTeacher}
        <span class="text-xs text-[var(--ink-soft)]">
          پیشرفت روز ۰: {completedCount} از {totalSteps} مرحله
        </span>
      {/if}
    </div>

    <div class="space-y-2">
      <h2 class="text-xl font-extrabold">{nextAction.label}</h2>
      <p class="text-sm text-[var(--ink-soft)] leading-7">{nextAction.description}</p>
    </div>

    <div class="pt-1 flex flex-wrap gap-3">
      <button
        type="button"
        class="btn-ml-primary"
        onclick={() => router.go(nextAction.target)}
      >
        {nextAction.cta}
      </button>

      {#if auth.isTeacher}
        <button
          type="button"
          class="btn-ml-ghost text-sm"
          onclick={() => router.go('#/lesson/day-0')}
        >
          پیش‌نمایش درس روز ۰
        </button>
      {/if}
    </div>
  </section>

  <!-- کارت درس بعدی + وضعیت آزمون -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    <article class="glass-card p-5 space-y-3">
      <div class="overflow-hidden rounded-xl border border-[var(--glass-border)]">
        <img
          src="covers/cover-day0.jpg"
          alt="کاور روز ۰ — جهت‌یابی و نقشهٔ راه دوره"
          class="aspect-video w-full object-cover"
          loading="lazy"
        />
      </div>
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold text-[var(--ink-soft)]">درس بعدی در مسیر</span>
        <span class="badge badge-sm bg-[var(--amber-soft)] text-[var(--amber-dark)] border-0">
          {DAY0_LESSON.badge}
        </span>
      </div>
      <h3 class="text-base font-extrabold">{DAY0_LESSON.title}</h3>
      <p class="text-xs text-[var(--ink-soft)] leading-6">
        ۴ مرحله مفهومی + ۶ تمرین جهت‌یابی، متصل به جدول <code>day_progress</code> با کلید
        <code>unit_code = 'day-0'</code>.
      </p>
      <button
        type="button"
        class="btn-ml-ghost text-xs w-full"
        onclick={() => router.go('#/lesson/day-0')}
      >
        بازکردن درس روز ۰
      </button>
    </article>

    <article class="glass-card p-5 space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-xs font-bold text-[var(--ink-soft)]">آزمون نمونه (تصحیح سروری)</span>
        <span class="badge badge-sm bg-red-100 text-red-800 border-0">دروازه ۶۰٪</span>
      </div>
      <h3 class="text-base font-extrabold">آزمون ۶ سؤالی روز ۰</h3>
      {#if latestQuiz}
        <p class="text-xs text-[var(--ink-soft)] leading-6">
          آخرین تلاش (شماره {latestQuiz.attempt_no}): نمره دقیق
          <strong class="text-[var(--ink)]">{latestQuiz.score_percent}٪</strong> —
          {latestQuiz.passed_gate ? 'قبول در دروازه' : 'نیازمند تلاش مجدد'}.
        </p>
      {:else}
        <p class="text-xs text-[var(--ink-soft)] leading-6">
          هنوز تلاشی ثبت نشده است. تصحیح منحصراً از طریق <code>submit_quiz_attempt</code> در سرور انجام می‌شود.
        </p>
      {/if}
      <button
        type="button"
        class="btn-ml-ghost text-xs w-full"
        onclick={() => router.go('#/quiz/quiz-day-0')}
      >
        ورود به آزمون نمونه
      </button>
    </article>
  </div>

  <!-- نقشهٔ راه — ۸ فاز (کاورها نهایی‌اند؛ محتوای فازها در فاز ۲ می‌آید) -->
  <section class="space-y-4">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h2 class="text-lg font-extrabold">نقشهٔ راه دوره — ۸ فاز</h2>
      <span class="text-xs text-[var(--ink-soft)]">کاورها نهایی‌اند؛ محتوای فازها در فاز ۲ می‌آید</span>
    </div>
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {#each PHASES as phase}
        <article class="glass-card overflow-hidden">
          <img
            src={`covers/cover-phase${phase.n}.jpg`}
            alt={`کاور فاز ${phase.n} — ${phase.title}`}
            class="aspect-video w-full object-cover"
            loading="lazy"
          />
          <div class="space-y-1 p-4">
            <span class="text-xs font-bold text-[var(--terracotta)]">فاز {phase.n}</span>
            <h3 class="text-sm font-extrabold leading-6">{phase.title}</h3>
          </div>
        </article>
      {/each}
    </div>
  </section>
</div>
