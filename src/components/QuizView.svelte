<script>
  import { auth } from '../lib/auth-store.svelte.js'
  import { submitQuizAttempt, logLearningEvent } from '../lib/course-api.js'

  // نمای عمومی آزمون — روز ۰ و ۲۷ آزمون نمره‌دار فاز ۲ از همین نما استفاده می‌کنند.
  // quiz: { quizCode, unitCode, title, description, questions: [{ index, concept, prompt, options: [{ label, note? }] }] }
  // گزینه‌ها در آزمون‌های نمره‌دار هیچ توضیحی ندارند (کلید فقط سرور است)؛
  // فقط آزمون نمونهٔ روز ۰ توضیح گزینه دارد.
  let { quiz, attempts = [], onAttemptSubmitted } = $props()

  let selected = $state(Array(quiz.questions.length).fill(null))
  let submitting = $state(false)
  let result = $state(null)
  let errorMessage = $state(null)

  let allAnswered = $derived(selected.every((v) => v !== null))

  function choose(qIdx, optIdx) {
    if (!auth.isStudent) return
    const copy = [...selected]
    copy[qIdx] = optIdx
    selected = copy
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!auth.isStudent || !allAnswered) return
    errorMessage = null
    submitting = true
    try {
      const res = await submitQuizAttempt(quiz.quizCode, selected)
      if (res.error) {
        errorMessage = res.error
        return
      }
      result = res.data
      void logLearningEvent('quiz_submitted_ui', quiz.unitCode, {
        quiz_code: quiz.quizCode,
        attempt_no: res.data?.attempt_no,
        score_percent: res.data?.score_percent,
        passed_gate: res.data?.passed_gate
      })
      if (onAttemptSubmitted) {
        await onAttemptSubmitted()
      }
    } finally {
      submitting = false
    }
  }
</script>

<div class="space-y-6">
  <header class="glass-card p-5 sm:p-6 space-y-2">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="text-xs font-bold text-[var(--amber-dark)]">
        تصحیح در سرور انجام می‌شود
      </span>
      <span class="badge bg-red-100 text-red-900 border-0 font-bold">
        دروازه دقیق ۶۰٫۰٪
      </span>
    </div>
    <h1 class="text-2xl font-extrabold">{quiz.title}</h1>
    <p class="text-xs text-[var(--ink-soft)] leading-6">
      {quiz.description} هیچ کلید پاسخی در مرورگر نگهداری نمی‌شود و اشتباه‌ها به‌صورت خودکار برای مرور و داشبورد استاد ثبت می‌گردند.
    </p>

    {#if auth.isTeacher}
      <div class="mt-2 rounded-xl bg-amber-50 border border-amber-300 px-3 py-2 text-xs text-amber-900">
        حالت پیش‌نمایش استاد: طبق قانون امنیتی، استاد نمی‌تواند به‌جای شاگرد آزمون ثبت کند.
      </div>
    {/if}
  </header>

  {#if errorMessage}
    <div class="rounded-xl bg-red-50 border border-red-300 p-4 text-sm text-red-900">
      {errorMessage}
    </div>
  {/if}

  {#if result}
    <section
      class="glass-card p-5 border-2 space-y-2"
      class:border-emerald-400={result.passed_gate}
      class:border-red-400={!result.passed_gate}
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-lg font-extrabold">
          نتیجه تلاش شماره {result.attempt_no}
        </h2>
        <span
          class="badge border-0 font-bold text-white"
          class:bg-emerald-600={result.passed_gate}
          class:bg-red-600={!result.passed_gate}
        >
          {result.passed_gate ? 'قبول در دروازه ۶۰٪' : 'زیر آستانه ۶۰٪'}
        </span>
      </div>
      <p class="text-sm">
        تعداد پاسخ درست: <strong>{result.correct_count}</strong> از
        <strong>{result.total_questions}</strong> — نمره دقیق بدون گردکردن:
        <strong dir="ltr">{result.score_percent}%</strong>
      </p>
      {#if quiz.questions[0]?.options[0]?.note}
        <p class="text-xs text-[var(--ink-soft)]">
          توضیح یک‌جمله‌ای هر گزینه اکنون در زیر سؤالات نمایش داده شده است.
        </p>
      {:else}
        <p class="text-xs text-[var(--ink-soft)]">
          برای مرور اشتباه‌ها، به درس برگردید؛ استاد هم اشتباه‌ها را در داشبورد می‌بیند.
        </p>
      {/if}
    </section>
  {/if}

  <form class="space-y-4" onsubmit={handleSubmit}>
    {#each quiz.questions as q, qIdx}
      <fieldset class="paper-card p-5 space-y-3">
        <div class="flex items-center justify-between gap-2">
          <legend class="text-sm sm:text-base font-extrabold">
            سؤال {q.index}. {q.prompt}
          </legend>
          <span class="badge badge-sm badge-ghost shrink-0">{q.concept}</span>
        </div>

        <div class="space-y-2">
          {#each q.options as opt, optIdx}
            {@const picked = selected[qIdx] === optIdx}
            <label
              class="block rounded-xl border p-3 cursor-pointer transition"
              class:border-amber-500={picked}
              class:bg-amber-50={picked}
              class:border-[var(--line)]={!picked}
              class:bg-white={!picked}
            >
              <div class="flex items-start gap-2.5">
                <input
                  type="radio"
                  name={`q-${q.index}`}
                  class="radio radio-sm radio-warning mt-1"
                  checked={picked}
                  disabled={!auth.isStudent || submitting}
                  onchange={() => choose(qIdx, optIdx)}
                />
                <div class="space-y-1">
                  <span class="text-sm font-medium block">{opt.label}</span>
                  {#if (result || auth.isTeacher) && opt.note}
                    <span class="text-xs text-[var(--ink-soft)] block">
                      توضیح گزینه: {opt.note}
                    </span>
                  {/if}
                </div>
              </div>
            </label>
          {/each}
        </div>
      </fieldset>
    {/each}

    {#if auth.isStudent}
      <div class="glass-card p-4 flex flex-wrap items-center justify-between gap-3">
        <span class="text-xs text-[var(--ink-soft)]">
          {allAnswered
            ? `همه ${quiz.questions.length} سؤال پاسخ داده شدند. آماده ارسال به سرور.`
            : `برای ثبت آزمون، به هر ${quiz.questions.length} سؤال پاسخ دهید.`}
        </span>
        <button
          type="submit"
          class="btn-ml-primary"
          disabled={!allAnswered || submitting}
        >
          {submitting ? 'در حال تصحیح در سرور...' : 'ثبت پاسخ‌ها و تصحیح'}
        </button>
      </div>
    {/if}
  </form>

  <!-- سابقه تلاش‌های ثبت‌شده از دیتابیس -->
  <section class="paper-card p-5 space-y-3">
    <h2 class="text-sm font-extrabold">سابقه تلاش‌های ثبت‌شده در دیتابیس</h2>
    {#if attempts.length === 0}
      <p class="text-xs text-[var(--ink-soft)]">هنوز هیچ تلاشی برای این آزمون ثبت نشده است.</p>
    {:else}
      <div class="overflow-x-auto">
        <table class="table table-sm text-xs">
          <thead>
            <tr>
              <th>تلاش</th>
              <th>درست / کل</th>
              <th>نمره دقیق</th>
              <th>وضعیت دروازه</th>
              <th>زمان</th>
            </tr>
          </thead>
          <tbody>
            {#each attempts as row}
              <tr>
                <td>#{row.attempt_no}</td>
                <td>{row.correct_count} / {row.total_questions}</td>
                <td dir="ltr" class="font-bold">{row.score_percent}%</td>
                <td>
                  <span
                    class="badge badge-xs border-0"
                    class:bg-emerald-100={row.passed_gate}
                    class:text-emerald-800={row.passed_gate}
                    class:bg-red-100={!row.passed_gate}
                    class:text-red-800={!row.passed_gate}
                  >
                    {row.passed_gate ? 'قبول' : 'مردود'}
                  </span>
                </td>
                <td dir="ltr">{new Date(row.created_at).toLocaleString('fa-IR')}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</div>
