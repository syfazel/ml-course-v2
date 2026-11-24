<script>
  import { onMount } from 'svelte'
  import { auth } from '../lib/auth-store.svelte.js'
  import { fetchTeacherDashboardData, fetchAllLabNotebooks } from '../lib/course-api.js'
  import { computeGates } from '../lib/gates.js'
  import { unitDisplayName } from '../lib/unit-names.js'

  let loading = $state(true)
  let error = $state(null)
  let dashboard = $state(null)
  let notebooks = $state([])
  let notebooksError = $state(null)
  let openNotebookId = $state(null)

  let gates = $derived(dashboard ? computeGates(dashboard.quizzes) : [])
  let memberByAuthId = $derived(
    Object.fromEntries((dashboard?.members || []).map((m) => [m.auth_id, m]))
  )

  async function load() {
    loading = true
    error = null
    try {
      const [res, nbRes] = await Promise.all([
        fetchTeacherDashboardData(),
        fetchAllLabNotebooks()
      ])
      if (res.error) {
        error = res.error
        dashboard = null
      } else {
        dashboard = res.data
      }
      if (nbRes.error) notebooksError = nbRes.error
      else notebooks = nbRes.data || []
    } finally {
      loading = false
    }
  }

  onMount(() => {
    if (auth.isTeacher) {
      void load()
    } else {
      loading = false
    }
  })
</script>

{#if !auth.isTeacher}
  <div class="paper-card p-6 text-center space-y-2">
    <h1 class="text-lg font-extrabold text-red-700">دسترسی غیرمجاز</h1>
    <p class="text-sm text-[var(--ink-soft)]">
      داشبورد استاد فقط با نقش <code>teacher</code> قابل مشاهده است.
    </p>
  </div>
{:else}
  <div class="space-y-6">
    <header class="glass-card p-5 sm:p-6 flex flex-wrap items-center justify-between gap-4">
      <div class="space-y-1">
        <p class="text-xs font-bold text-[var(--amber-dark)]">داشبورد استاد — اسکلت فاز ۱</p>
        <h1 class="text-2xl font-extrabold">نظارت زنده بر پیشرفت شاگرد</h1>
        <p class="text-xs text-[var(--ink-soft)]">
          تمام اعداد زیر مستقیماً از جداول Supabase خوانده می‌شوند (صفر داده ساختگی).
        </p>
      </div>
      <button type="button" class="btn-ml-ghost text-xs" disabled={loading} onclick={load}>
        {loading ? 'در حال بارگذاری...' : 'به‌روزرسانی داده‌ها'}
      </button>
    </header>

    {#if error}
      <div class="rounded-xl bg-red-50 border border-red-300 p-4 text-sm text-red-900">
        {error}
      </div>
    {:else if loading && !dashboard}
      <div class="paper-card p-8 text-center text-sm text-[var(--ink-soft)]">
        در حال خواندن داده‌ها از سرور...
      </div>
    {:else if dashboard}
      <!-- نمای کلی شاگرد -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="glass-card p-4 space-y-1">
          <p class="text-xs text-[var(--ink-soft)]">شاگرد ثبت‌شده</p>
          <p class="text-base font-extrabold">
            {dashboard.student ? dashboard.student.display_name : 'هنوز ثبت نشده'}
          </p>
          <p class="text-[11px] text-[var(--ink-soft)]" dir="ltr">
            {dashboard.student?.username || '—'}
          </p>
        </div>

        <div class="glass-card p-4 space-y-1">
          <p class="text-xs text-[var(--ink-soft)]">وضعیت درس روز ۰</p>
          <p class="text-base font-extrabold">
            {dashboard.progress.find((p) => p.unit_code === 'day-0')?.status || 'شروع نشده'}
          </p>
          <p class="text-[11px] text-[var(--ink-soft)]">
            مراحل تکمیل‌شده:
            {dashboard.progress.find((p) => p.unit_code === 'day-0')?.completed_steps?.length || 0}
          </p>
        </div>

        <div class="glass-card p-4 space-y-1">
          <p class="text-xs text-[var(--ink-soft)]">تلاش‌های آزمون</p>
          <p class="text-base font-extrabold">{dashboard.quizzes.length}</p>
          <p class="text-[11px] text-[var(--ink-soft)]">
            آخرین نمره:
            {dashboard.quizzes[0] ? `${dashboard.quizzes[0].score_percent}٪` : '—'}
          </p>
        </div>

        <div class="glass-card p-4 space-y-1">
          <p class="text-xs text-[var(--ink-soft)]">اشتباه‌های ثبت‌شده</p>
          <p class="text-base font-extrabold">{dashboard.mistakes.length}</p>
          <p class="text-[11px] text-[var(--ink-soft)]">
            رویدادها: {dashboard.events.length} | ممیزی: {dashboard.auditLogs.length}
          </p>
        </div>
      </div>

      <!-- وضعیت دروازه‌های ۸ فاز -->
      <section class="paper-card p-5 space-y-3">
        <h2 class="text-sm font-extrabold">وضعیت دروازه‌های ۸ فاز (میانگین دقیق بهترین نمره‌ها — ۶۰٫۰٪)</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {#each gates as g}
            <div
              class="rounded-xl border p-3"
              class:border-emerald-300={g.open}
              class:bg-emerald-50={g.open}
              class:border-[var(--line)]={!g.open}
            >
              <p class="text-xs font-extrabold">فاز {g.phase} — {g.displayTitle}</p>
              <p class="text-xs mt-1">
                {#if g.avg === null}
                  هنوز آزمونی ثبت نشده
                {:else}
                  میانگین: <strong dir="ltr">{g.avg.toFixed(1)}٪</strong> — {g.open ? 'باز' : 'بسته'}
                  ({g.attempted} از {g.total} آزمون)
                {/if}
              </p>
            </div>
          {/each}
        </div>
        <p class="text-[11px] text-[var(--ink-soft)]">
          قفل سخت روی درس‌های فاز بعد در فاز ۲ پیاده نشده است؛ دروازه‌ها فعلاً وضعیت‌اند و تصمیم دربارهٔ قفل با استاد است.
        </p>
      </section>

      <!-- جدول پیشرفت درس -->
      <section class="paper-card p-5 space-y-3">
        <h2 class="text-sm font-extrabold">پیشرفت درس‌به‌درس</h2>
        {#if dashboard.progress.length === 0}
          <p class="text-xs text-[var(--ink-soft)]">هیچ ردیف پیشرفتی هنوز ثبت نشده است.</p>
        {:else}
          <div class="overflow-x-auto">
            <table class="table table-sm text-xs">
              <thead>
                <tr>
                  <th>واحد</th>
                  <th>وضعیت</th>
                  <th>مراحل تکمیل‌شده</th>
                  <th>آخرین تغییر</th>
                </tr>
              </thead>
              <tbody>
                {#each dashboard.progress as row}
                  <tr>
                    <!-- فاز ۴ (F12): نام نمایشی واحد به‌جای کد خام. -->
                    <td>{unitDisplayName(row.unit_code)}</td>
                    <td>{row.status}</td>
                    <td>{Array.isArray(row.completed_steps) ? row.completed_steps.join('، ') || '—' : '—'}</td>
                    <td dir="ltr">{new Date(row.updated_at).toLocaleString('fa-IR')}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>

      <!-- اشتباه‌های آزمون -->
      <section class="paper-card p-5 space-y-3">
        <h2 class="text-sm font-extrabold">دفترچه‌های آزمایشگاه شاگرد (lab_notebooks)</h2>
        {#if notebooksError}
          <p class="text-xs text-amber-800">{notebooksError}</p>
        {:else if notebooks.length === 0}
          <p class="text-xs text-[var(--ink-soft)]">هنوز دفترچه‌ای ذخیره نشده است.</p>
        {:else}
          <div class="space-y-2">
            {#each notebooks as nb}
              {@const member = memberByAuthId[nb.user_id]}
              <details
                class="rounded-xl border border-[var(--glass-border)] p-3"
                open={openNotebookId === nb.id}
                ontoggle={(e) => {
                  if (e.currentTarget.open) openNotebookId = nb.id
                  else if (openNotebookId === nb.id) openNotebookId = null
                }}
              >
                <summary class="cursor-pointer text-xs font-bold flex flex-wrap gap-2 justify-between">
                  <span>{nb.lab_code} — {member?.display_name || member?.username || nb.user_id}</span>
                  <span class="text-[var(--ink-soft)] font-normal">
                    {(nb.cells || []).length} سلول • {new Date(nb.updated_at).toLocaleString('fa-IR')}
                  </span>
                </summary>
                <div class="mt-3 space-y-3">
                  {#each nb.cells || [] as c}
                    <div class="rounded-xl border border-[var(--line)] overflow-hidden">
                      <p class="text-xs font-bold px-3 py-2 bg-[var(--bg-warm)]">{c.title}</p>
                      <pre dir="ltr" class="font-code text-left text-[13px] leading-6 px-3 py-2 overflow-x-auto bg-[#1d1a18] text-[#ede6da]">{c.code}</pre>
                      {#if c.output?.stdout}
                        <pre dir="ltr" class="text-xs leading-6 px-3 py-2 whitespace-pre-wrap">{c.output.stdout}</pre>
                      {/if}
                    </div>
                  {/each}
                </div>
              </details>
            {/each}
          </div>
        {/if}
      </section>

      <section class="paper-card p-5 space-y-3">
        <h2 class="text-sm font-extrabold">اشتباه‌های آزمون (mistakes)</h2>
        {#if dashboard.mistakes.length === 0}
          <p class="text-xs text-[var(--ink-soft)]">هنوز هیچ اشتباهی ثبت نشده است.</p>
        {:else}
          <div class="overflow-x-auto">
            <table class="table table-sm text-xs">
              <thead>
                <tr>
                  <th>آزمون</th>
                  <th>شماره سؤال</th>
                  <th>گزینه انتخابی</th>
                  <th>برچسب مفهوم</th>
                  <th>زمان</th>
                </tr>
              </thead>
              <tbody>
                {#each dashboard.mistakes as m}
                  <tr>
                    <td dir="ltr">{m.quiz_code}</td>
                    <td>سؤال {m.question_index}</td>
                    <td>گزینه {m.selected_option + 1}</td>
                    <td>{m.concept_tag || '—'}</td>
                    <td dir="ltr">{new Date(m.created_at).toLocaleString('fa-IR')}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>

      <!-- رویدادها و لاگ ممیزی -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section class="paper-card p-5 space-y-3">
          <h2 class="text-sm font-extrabold">رویدادهای شاگرد (events)</h2>
          {#if dashboard.events.length === 0}
            <p class="text-xs text-[var(--ink-soft)]">رویدادی ثبت نشده است.</p>
          {:else}
            <ul class="space-y-2 text-xs">
              {#each dashboard.events as ev}
                <li class="rounded-lg bg-[var(--bg-warm)] p-2.5 border border-[var(--line)]">
                  <div class="flex justify-between font-bold">
                    <span dir="ltr">{ev.event_type}</span>
                    <!-- فاز ۴ (F12): نام نمایشی واحد به‌جای کد خام. -->
                    <span class="text-[var(--ink-soft)]">{unitDisplayName(ev.unit_code)}</span>
                  </div>
                  <div class="text-[11px] text-[var(--ink-soft)] mt-1" dir="ltr">
                    {new Date(ev.created_at).toLocaleString('fa-IR')}
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </section>

        <section class="paper-card p-5 space-y-3">
          <h2 class="text-sm font-extrabold">لاگ ممیزی خودکار (audit_logs)</h2>
          {#if dashboard.auditLogs.length === 0}
            <p class="text-xs text-[var(--ink-soft)]">لاگ ممیزی ثبت نشده است.</p>
          {:else}
            <ul class="space-y-2 text-xs">
              {#each dashboard.auditLogs as log}
                <li class="rounded-lg bg-[var(--bg-warm)] p-2.5 border border-[var(--line)]">
                  <div class="flex justify-between font-bold">
                    <span dir="ltr">{log.action} ({log.target_table || '—'})</span>
                    <span class="badge badge-xs badge-ghost">{log.actor_role || '—'}</span>
                  </div>
                  <div class="text-[11px] text-[var(--ink-soft)] mt-1" dir="ltr">
                    {new Date(log.created_at).toLocaleString('fa-IR')}
                  </div>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      </div>
    {/if}
  </div>
{/if}
