<script>
  // Jarvis Studio — the desk (Phase 4).
  // Entry flow: wake (Edge Function, JWT) -> one-time ticket -> /launch ->
  // cinematic opening -> dual desk (code tablet 55% / observation canvas
  // 45%) with /execute cells (HTTP polling only — no browser WebSocket;
  // the tunnel breaks it), notebook auto-save to the Gateway AND sync to
  // Supabase lab_notebooks (the same pattern as LabView: save by title,
  // only the student's own rows; the teacher gets a read-only preview).
  // Status light string: ready = dim brass, running = gold pulse,
  // success = patina green, error = saffron + Persian message.
  // Close: best-effort save, the in-memory session is forgotten. There is
  // NO explicit stop path: closing the Studio does not stop the Codespace;
  // it shuts itself down after 30 minutes idle (Gateway idle deadline).
  import { onMount, onDestroy } from 'svelte'
  import { sb } from '../lib/supabase.js'
  import { auth } from '../lib/auth-store.svelte.js'
  import { COURSE_CONTENT } from '../data/course-content.js'
  import { fetchLabNotebook, saveLabNotebook } from '../lib/course-api.js'
  import {
    wakeStudio,
    launchStudioSession,
    studioGateway,
    clearStudioSession,
    StudioGatewayError
  } from '../lib/studio-gateway.js'
  import StudioOpening from './StudioOpening.svelte'

  let { labCode = null } = $props()

  // ---------- resolve the lesson + its datasets ----------
  const lessonIds = Object.keys(COURSE_CONTENT.lessons || {}).sort(
    (a, b) => Number(a) - Number(b)
  )
  function resolveLesson(code) {
    if (code) {
      const id = String(code).replace(/^lab-/, '')
      const l = COURSE_CONTENT.lessons[id]
      if (l && l.lab) return l
    }
    for (const id of lessonIds) {
      const l = COURSE_CONTENT.lessons[id]
      if (l && l.lab) return l
    }
    return null
  }
  const lesson = resolveLesson(labCode)
  const labCodeResolved = lesson ? `lab-${lesson.id}` : null
  const datasets = lesson ? COURSE_CONTENT.labDatasets[String(lesson.id)] || [] : []
  const returnHash = lesson ? `#/lesson/${lesson.id}` : '#/'

  // ---------- state ----------
  let phase = $state('waking') // waking | launching | opening | ready | error
  let wakeNote = $state('')
  let errorMsg = $state('')
  let errorDetail = $state('')
  let cells = $state([])
  let activeCell = $state(0)
  let running = $state(false)
  let statusLight = $state('waking') // idle | waking | running | ok | error
  let statusLightLabel = $state('در حال بیدار شدن')
  let gatewayStatus = $state(null)
  let idleLeftSec = $state(null)
  let saveState = $state(null) // null | 'saving' | 'saved' | 'error'
  let saveNote = $state('')
  let datasetOpen = $state(-1)
  let sliderDegree = $state(2)
  let sheetOpen = $state(false)
  let gateway = null
  let statusTimer = null
  let countdownTimer = null
  let savedApplied = false

  // ---------- cells (LabView's buildCells pattern, incl. dataset cells) ----------
  function buildCells() {
    const list = (lesson?.lab?.cells || []).map((c) => ({
      kind: 'lab',
      title: c.title,
      note: c.note || '',
      expected: c.expected || '',
      code: c.code,
      output: null,
      running: false,
      matched: null
    }))
    if (datasets[0]) {
      const ds = datasets[0]
      list.push({
        kind: 'dataset-define',
        title: `داده — ${ds.nameFa}`,
        note: ds.descFa || '',
        expected: '',
        code: ds.defineCode,
        output: null,
        running: false,
        matched: null
      })
      if (ds.computeCode) {
        list.push({
          kind: 'dataset-compute',
          title: `محاسبه — ${ds.computeDescFa || ds.nameFa}`,
          note: '',
          expected: '',
          code: ds.computeCode,
          output: null,
          running: false,
          matched: null
        })
      }
    }
    return list
  }
  cells = buildCells()

  // ---------- golden thread map (tool 1): 4 canonical stages ----------
  const STAGES = ['بارگذاری داده', 'پاک‌سازی', 'آموزش مدل', 'ارزیابی']
  function stageOfCell(i) {
    const n = Math.max(1, cells.length)
    return Math.min(3, Math.floor((i / n) * 4))
  }
  let stageDone = $derived(
    STAGES.map((_, s) => {
      const inStage = cells
        .map((c, i) => ({ c, i }))
        .filter(({ i }) => stageOfCell(i) === s)
      if (!inStage.length) return false
      return inStage.every(({ c }) => c.output && !c.output.error)
    })
  )
  let activeStage = $derived(cells.length ? stageOfCell(activeCell) : 0)
  function gotoStage(s) {
    const idx = cells.findIndex((_, i) => stageOfCell(i) === s)
    if (idx >= 0) {
      activeCell = idx
      document.getElementById(`studio-cell-${idx}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      })
    }
  }

  // ---------- parameter slider data (tool 3): real least-squares, client-side ----------
  function numericColumns(ds) {
    if (!ds) return []
    return ds.columnsFa
      .map((name, ci) => {
        const vals = (ds.rows || []).map((r) => Number(r[ci])).filter((v) => Number.isFinite(v))
        return vals.length >= 4 && vals.length === (ds.rows || []).length
          ? { name, values: vals }
          : null
      })
      .filter(Boolean)
  }
  const DEMO_POINTS = [
    [60, 3000], [70, 3500], [80, 4000], [90, 4700], [100, 5000],
    [110, 5400], [120, 6000], [130, 6400], [140, 7100], [150, 7500],
    [160, 7900], [170, 8600]
  ]
  let sliderPoints = $derived.by(() => {
    const cols = numericColumns(datasets[0])
    if (cols.length >= 2) {
      return {
        points: cols[0].values.map((x, i) => [x, cols[1].values[i]]),
        xLabel: cols[0].name,
        yLabel: cols[1].name,
        demo: false
      }
    }
    return { points: DEMO_POINTS, xLabel: 'اندازه (متر مربع)', yLabel: 'قیمت (میلیون تومان)', demo: true }
  })
  function solveLinear(A, b) {
    const n = b.length
    const M = A.map((row, i) => [...row, b[i]])
    for (let col = 0; col < n; col++) {
      let piv = col
      for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r
      if (Math.abs(M[piv][col]) < 1e-12) return null
      ;[M[col], M[piv]] = [M[piv], M[col]]
      for (let r = 0; r < n; r++) {
        if (r === col) continue
        const f = M[r][col] / M[col][col]
        for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c]
      }
    }
    return M.map((row, i) => row[n] / M[i][i])
  }
  function polyfit(points, degree) {
    const m = degree + 1
    const A = Array.from({ length: m }, () => Array(m).fill(0))
    const b = Array(m).fill(0)
    for (const [x, y] of points) {
      const p = [1]
      for (let k = 1; k < m; k++) p.push(p[k - 1] * x)
      for (let i = 0; i < m; i++) {
        b[i] += p[i] * y
        for (let j = 0; j < m; j++) A[i][j] += p[i] * p[j]
      }
    }
    return solveLinear(A, b)
  }
  let sliderFit = $derived.by(() => {
    const { points } = sliderPoints
    const coef = polyfit(points, sliderDegree)
    if (!coef) return null
    const f = (x) => coef.reduce((acc, c, k) => acc + c * Math.pow(x, k), 0)
    const mean = points.reduce((a, [, y]) => a + y, 0) / points.length
    const ssTot = points.reduce((a, [, y]) => a + Math.pow(y - mean, 2), 0)
    const ssRes = points.reduce((a, [x, y]) => a + Math.pow(y - f(x), 2), 0)
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0
    return { coef, f, r2 }
  })
  let sliderNote = $derived(
    sliderDegree === 3
      ? 'بیش‌برازش — خط از نقطه‌ها رد می‌شود ولی برای دادهٔ تازه تعمیم نمی‌دهد.'
      : sliderDegree === 2
        ? 'منحنی ملایم — تعادل خوبی میان سادگی و انطباق دارد.'
        : 'خط راست — ساده ولی شاید کم‌برازش.'
  )
  let sliderChart = $derived.by(() => {
    const { points } = sliderPoints
    if (!sliderFit) return null
    const W = 320
    const H = 180
    const pad = 14
    const xs = points.map(([x]) => x)
    const ys = points.map(([, y]) => y)
    const x0 = Math.min(...xs)
    const x1 = Math.max(...xs)
    const y0 = Math.min(...ys)
    const y1 = Math.max(...ys)
    const sx = (x) => pad + ((x - x0) / (x1 - x0 || 1)) * (W - pad * 2)
    const sy = (y) => H - pad - ((y - y0) / (y1 - y0 || 1)) * (H - pad * 2)
    let d = ''
    for (let k = 0; k <= 80; k++) {
      const x = x0 + ((x1 - x0) * k) / 80
      d += `${k === 0 ? 'M' : 'L'}${sx(x).toFixed(1)},${sy(sliderFit.f(x)).toFixed(1)} `
    }
    return {
      W,
      H,
      path: d,
      dots: points.map(([x, y]) => ({ cx: sx(x), cy: sy(y) }))
    }
  })

  // ---------- dataset drawer helpers (tool 2) ----------
  function histogram(values) {
    const min = Math.min(...values)
    const max = Math.max(...values)
    const bins = Array(8).fill(0)
    for (const v of values) {
      const b = max === min ? 0 : Math.min(7, Math.floor(((v - min) / (max - min)) * 8))
      bins[b]++
    }
    const top = Math.max(1, ...bins)
    return bins.map((n) => n / top)
  }

  // ---------- entry flow ----------
  async function loadSaved() {
    if (!labCodeResolved) return
    try {
      const res = await fetchLabNotebook(labCodeResolved)
      const saved = res?.data?.cells
      if (Array.isArray(saved) && saved.length && !savedApplied) {
        savedApplied = true
        for (const s of saved) {
          const cell = cells.find((c) => c.title === s.title)
          if (cell && typeof s.code === 'string') {
            cell.code = s.code
            if (s.output) {
              cell.output = s.output
              cell.matched =
                cell.expected && s.output.stdout
                  ? s.output.stdout.trim() === cell.expected.trim()
                  : null
            }
          }
        }
      }
    } catch {
      /* خواندن دفترچه اختیاری است */
    }
  }

  async function refreshStatus() {
    if (!gateway) return
    try {
      gatewayStatus = await gateway.status()
      if (gatewayStatus?.idle_deadline_utc) {
        idleLeftSec = Math.max(
          0,
          Math.floor(
            (new Date(gatewayStatus.idle_deadline_utc).getTime() - Date.now()) / 1000
          )
        )
      }
    } catch {
      /* مهلت بیکاری یخ می‌زند؛ خطای واقعی هنگام اجراست */
    }
  }

  async function startFlow() {
    phase = 'waking'
    statusLight = 'waking'
    statusLightLabel = 'در حال بیدار شدن'
    errorMsg = ''
    errorDetail = ''
    wakeNote = ''
    try {
      const { ticket, gatewayUrl } = await wakeStudio(sb, {
        onProgress: (p) => {
          wakeNote = `تلاش ${p.attempt} — بیداری Codespace… (${p.waitSec} ثانیه صبر)`
        }
      })
      phase = 'launching'
      wakeNote = ''
      await launchStudioSession(gatewayUrl, ticket)
      gateway = studioGateway(gatewayUrl)
      void loadSaved()
      void refreshStatus()
      statusTimer = setInterval(() => void refreshStatus(), 30000)
      phase = 'opening'
    } catch (e) {
      phase = 'error'
      errorMsg =
        e instanceof StudioGatewayError
          ? e.message
          : 'ورود به استودیو ناموفق بود.'
      errorDetail = e?.detail || e?.message || ''
      statusLight = 'error'
      statusLightLabel = 'خطا'
    }
  }

  function onOpeningDone() {
    phase = 'ready'
    statusLight = 'idle'
    statusLightLabel = 'آماده'
  }

  // ---------- run / save ----------
  function gatewayOutcomeToOutput(out) {
    const stdout = [out.stdout || '', out.result != null ? String(out.result) : '']
      .filter(Boolean)
      .join('')
    let error = null
    if (out.status === 'timeout') error = 'مهلت اجرا (۱۲۰ ثانیه) تمام شد.'
    else if (out.error) error = `${out.error.ename || 'خطا'}: ${out.error.evalue || ''}`.trim()
    else if (out.stderr) error = out.stderr
    return { stdout, error }
  }

  async function runCell(i, advance = false) {
    const cell = cells[i]
    if (!cell || running || !gateway || phase !== 'ready') return
    running = true
    activeCell = i
    cell.running = true
    cell.output = null
    cell.matched = null
    statusLight = 'running'
    statusLightLabel = 'در حال اجرا'
    try {
      const out = await gateway.execute(cell.code, labCodeResolved)
      cell.output = gatewayOutcomeToOutput(out)
      cell.matched =
        cell.expected && cell.output.stdout
          ? cell.output.stdout.trim() === cell.expected.trim()
          : null
      statusLight = cell.output.error ? 'error' : 'ok'
      statusLightLabel = cell.output.error ? 'خطا' : 'موفق'
      if (window.innerWidth < 768) sheetOpen = true
      await handleSave()
      void refreshStatus()
    } catch (e) {
      cell.output = {
        stdout: '',
        error:
          e instanceof StudioGatewayError
            ? e.message
            : 'اجرای سلول ناموفق بود.'
      }
      statusLight = 'error'
      statusLightLabel = 'خطا'
      if (e instanceof StudioGatewayError) errorDetail = e.detail || ''
    } finally {
      cell.running = false
      running = false
      if (advance && i + 1 < cells.length) {
        activeCell = i + 1
        document.getElementById(`studio-cell-${i + 1}`)?.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest'
        })
      }
    }
  }

  async function runAll() {
    for (let i = 0; i < cells.length; i++) {
      // eslint-disable-next-line no-await-in-loop
      await runCell(i)
      if (phase !== 'ready') break
    }
  }

  async function handleSave() {
    if (!labCodeResolved) return
    saveState = 'saving'
    saveNote = ''
    const payload = cells.map((c) => ({
      title: c.title,
      code: c.code,
      output: c.output
        ? { stdout: c.output.stdout || '', error: c.output.error || null }
        : null
    }))
    const res = await saveLabNotebook(labCodeResolved, payload)
    if (res.error) {
      saveState = 'error'
      saveNote = 'ذخیره در Supabase ناموفق بود؛ دفترچه در Gateway مانده است.'
    } else if (res.readOnlyPreview) {
      saveState = 'saved'
      saveNote = 'پیش‌نمایش استاد — ذخیره نمی‌شود.'
    } else {
      saveState = 'saved'
      saveNote = 'دفترچه ذخیره شد.'
    }
  }

  function cellKeydown(e, i) {
    if (e.code === 'Enter' && e.shiftKey) {
      e.preventDefault()
      void runCell(i, true)
    } else if (e.code === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void runCell(i, false)
    }
  }

  async function closeStudio() {
    try {
      await handleSave()
    } catch {
      /* best-effort */
    }
    clearStudioSession()
    window.location.hash = returnHash
  }

  function formatCountdown(sec) {
    if (sec == null) return '—'
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  onMount(() => {
    if (!lesson || !auth.canOperate) {
      phase = 'error'
      errorMsg = !lesson
        ? 'آزمایشگاهی برای این درس پیدا نشد.'
        : 'برای ورود به استودیو نخست وارد شوید.'
      statusLight = 'error'
      statusLightLabel = 'خطا'
      return
    }
    countdownTimer = setInterval(() => {
      if (idleLeftSec != null && idleLeftSec > 0) idleLeftSec -= 1
    }, 1000)
    const onKey = (e) => {
      if (e.code === 'KeyS' && (e.ctrlKey || e.metaKey) && phase === 'ready') {
        e.preventDefault()
        void handleSave()
      }
    }
    window.addEventListener('keydown', onKey)
    void startFlow()
    return () => window.removeEventListener('keydown', onKey)
  })

  onDestroy(() => {
    if (statusTimer) clearInterval(statusTimer)
    if (countdownTimer) clearInterval(countdownTimer)
    clearStudioSession()
    if (phase === 'ready' && labCodeResolved) {
      void handleSave()
    }
  })
</script>

{#if phase === 'opening'}
  <StudioOpening onDone={onOpeningDone} />
{:else if phase === 'waking' || phase === 'launching'}
  <div class="min-h-dvh warm-mesh flex flex-col items-center justify-center gap-5 p-6 text-center">
    <img src="logo/jarvis-studio-shield-64.png" alt="Jarvis Studio" width="64" height="64" />
    <h1 class="text-xl font-extrabold">Jarvis Studio</h1>
    <p class="text-sm text-[var(--ink-soft)]">
      {phase === 'waking' ? 'در حال بیدار کردن استودیو…' : 'در حال برقراری نشست…'}
    </p>
    {#if wakeNote}<p class="text-xs text-[var(--ink-soft)]">{wakeNote}</p>{/if}
    <p class="text-xs text-[var(--ink-soft)]">بیداری Codespace حدود ۲۰ تا ۲۵ ثانیه طول می‌کشد.</p>
  </div>
{:else if phase === 'error'}
  <div class="min-h-dvh warm-mesh flex flex-col items-center justify-center gap-4 p-6 text-center">
    <img src="logo/jarvis-studio-shield-64.png" alt="Jarvis Studio" width="64" height="64" />
    <h1 class="text-xl font-extrabold">Jarvis Studio</h1>
    <div class="glass-card max-w-md p-5">
      <p class="text-sm font-bold" style="color: var(--saffron-text)">{errorMsg}</p>
      {#if errorDetail}
        <p class="font-code mt-2 text-[11px] leading-5 text-[var(--ink-soft)]" dir="ltr">{errorDetail}</p>
      {/if}
    </div>
    <div class="flex gap-2">
      <button type="button" class="btn-ml-primary" onclick={() => void startFlow()}>تلاش دوباره</button>
      <button type="button" class="btn-ml-ghost" onclick={closeStudio}>بازگشت به درس</button>
    </div>
  </div>
{:else}
  <!-- ================= the desk ================= -->
  <div class="studio-desk min-h-dvh warm-mesh flex flex-col">
    <header class="glass-chrome sticky top-0 z-40">
      <div class="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3">
        <img src="logo/jarvis-studio-shield-32.png" alt="" width="32" height="32" />
        <div class="leading-tight">
          <p class="font-extrabold">Jarvis Studio</p>
          <p class="text-xs text-[var(--ink-soft)]">
            {lesson?.lab?.title || 'استودیو'} — درس {lesson?.code || ''}
          </p>
        </div>
        <div class="ms-auto flex items-center gap-3">
          <span class="status-light" data-state={statusLight} title="وضعیت Gateway">
            <span class="status-dot"></span>
            <span class="text-xs font-bold">{statusLightLabel}</span>
            <span class="text-xs text-[var(--ink-soft)]">خاموشی خودکار تا {formatCountdown(idleLeftSec)}</span>
          </span>
          <button type="button" class="btn-ml-ghost !min-h-[36px] text-sm" onclick={closeStudio}>
            بازگشت به درس
          </button>
        </div>
      </div>
      <!-- رشتهٔ نور وضعیت -->
      <div class="status-thread" data-state={statusLight} aria-hidden="true"></div>
    </header>

    {#if gateway && !gateway.hasSessionHeader}
      <div class="mx-auto mt-3 w-full max-w-[1400px] px-4">
        <p class="rounded-xl border px-3 py-2 text-xs leading-6" style="border-color: rgba(181,114,10,.4); background: rgba(181,114,10,.08); color: var(--saffron-text)">
          نشست با کوکی برقرار شد؛ چون مرورگر کوکی Lax را در fetch نمی‌فرستد، اجرای سلول ممکن است ۴۰۱ بدهد.
          رفع آن تغییر کوچک Gateway است (پذیرش هدر Authorization) — در انتظار تأیید یاسین.
        </p>
      </div>
    {/if}

    <main class="mx-auto grid w-full max-w-[1400px] flex-1 gap-4 px-4 py-4 lg:grid-cols-[55%_45%]">
      <!-- لوح کد -->
      <section class="flex min-w-0 flex-col gap-4">
        <!-- نقشهٔ رشتهٔ طلایی (تولز ۱) -->
        <nav class="glass-card flex items-center gap-1 overflow-x-auto p-3" aria-label="نقشهٔ آزمایش">
          {#each STAGES as stage, s}
            <button
              type="button"
              class="thread-step"
              data-state={stageDone[s] ? 'done' : s === activeStage ? 'active' : 'todo'}
              onclick={() => gotoStage(s)}
            >
              <span class="thread-dot"></span>
              <span class="text-xs font-bold whitespace-nowrap">{s + 1}. {stage}</span>
            </button>
            {#if s < STAGES.length - 1}<span class="thread-line" aria-hidden="true"></span>{/if}
          {/each}
        </nav>

        <p class="text-sm leading-8 text-[var(--ink-soft)]">{lesson?.lab?.intro || ''}</p>

        {#each cells as cell, i}
          <article
            id="studio-cell-{i}"
            class="glass-card overflow-hidden"
            class:active-cell={i === activeCell}
          >
            <button type="button" class="flex w-full items-center gap-2 p-3 text-start" onclick={() => (activeCell = i)}>
              <span class="thread-dot" data-state={cell.output?.error ? 'error' : cell.output ? 'done' : 'todo'}></span>
              <span class="text-sm font-bold">{cell.title}</span>
              <span class="ms-auto text-xs text-[var(--ink-soft)]">Shift+Enter اجرا و رفتن</span>
            </button>
            {#if cell.note}<p class="px-4 pb-2 text-xs leading-6 text-[var(--ink-soft)]">{cell.note}</p>{/if}
            <textarea
              dir="ltr"
              class="font-code block w-full resize-y border-y bg-[#1d1a18] p-3 text-left text-[13px] leading-6 text-[#ede6da] outline-none"
              rows={Math.max(3, cell.code.split('\n').length + 1)}
              bind:value={cell.code}
              onkeydown={(e) => cellKeydown(e, i)}
              onfocus={() => (activeCell = i)}
              spellcheck="false"
              aria-label={cell.title}
            ></textarea>
            <div class="flex flex-wrap items-center gap-2 p-3">
              <button
                type="button"
                class="btn-ml-primary !min-h-[44px] text-sm"
                disabled={running}
                onclick={() => void runCell(i)}
              >
                {cell.running ? 'در حال اجرا…' : 'اجرا'}
              </button>
              {#if cell.expected}
                <span class="text-xs text-[var(--ink-soft)]">خروجی مورد انتظار: <span dir="ltr" class="font-code">{cell.expected}</span></span>
              {/if}
              {#if cell.matched === true}
                <span class="text-xs font-bold" style="color: var(--patina)">خروجی با انتظار می‌خواند</span>
              {:else if cell.matched === false}
                <span class="text-xs font-bold" style="color: var(--saffron-text)">خروجی با انتظار نمی‌خواند</span>
              {/if}
            </div>
            {#if cell.output}
              <div class="px-3 pb-3">
                {#if cell.output.stdout}
                  <pre dir="ltr" class="whitespace-pre-wrap rounded-xl bg-[#1d1a18] p-3 text-left text-xs leading-6 text-[#f5efe6]">{cell.output.stdout}</pre>
                {/if}
                {#if cell.output.error}
                  <p class="mt-2 rounded-xl px-3 py-2 text-xs leading-6" style="background: rgba(181,114,10,.1); color: var(--saffron-text)">{cell.output.error}</p>
                {/if}
              </div>
            {/if}
          </article>
        {/each}

        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="btn-ml-primary text-sm" disabled={running} onclick={() => void runAll()}>
            {running ? 'در حال اجرا…' : 'اجرای همهٔ سلول‌ها'}
          </button>
          <button type="button" class="btn-ml-ghost text-sm" disabled={running} onclick={() => void handleSave()}>
            {saveState === 'saving' ? 'در حال ذخیره…' : 'ذخیرهٔ دفترچه'}
          </button>
          {#if saveNote}<span class="text-xs text-[var(--ink-soft)]">{saveNote}</span>{/if}
        </div>

        <!-- لغزندهٔ پارامتر زنده (تولز ۳) — محاسبهٔ سمت مرورگر، بدون کرنل -->
        <section class="glass-card p-4">
          <h2 class="text-sm font-extrabold">لغزندهٔ پارامتر زنده — درجهٔ چندجمله‌ای</h2>
          <div class="mt-3 flex items-center gap-3">
            <input
              type="range"
              min="1"
              max="3"
              step="1"
              bind:value={sliderDegree}
              class="w-full accent-[#b8421f]"
              aria-label="درجهٔ چندجمله‌ای"
            />
            <span class="font-code text-sm font-bold" dir="ltr">{sliderDegree}</span>
            {#if sliderFit}
              <span class="text-sm">R² = <span dir="ltr" class="font-code font-bold">{sliderFit.r2.toFixed(2)}</span></span>
            {/if}
          </div>
          {#if sliderChart}
            <svg viewBox="0 0 {sliderChart.W} {sliderChart.H}" class="mt-2 w-full rounded-xl border" style="border-color: var(--line); background: #fffdf9" role="img" aria-label="نمودار برازش چندجمله‌ای">
              <path d={sliderChart.path} fill="none" stroke={sliderDegree === 3 ? '#b5720a' : '#166b5e'} stroke-width="2" />
              {#each sliderChart.dots as dot}
                <circle cx={dot.cx} cy={dot.cy} r="3.5" fill="#b8421f" />
              {/each}
            </svg>
          {/if}
          <p class="mt-2 text-xs leading-6 text-[var(--ink-soft)]">
            {sliderNote}
            {#if sliderPoints.demo} <span>(دادهٔ نمایشی — جدول خانه‌ها)</span>{/if}
          </p>
        </section>
      </section>

      <!-- بوم مشاهده -->
      <section class="obs-col flex min-w-0 flex-col gap-4" class:sheet-open={sheetOpen}>
        <!-- کپسول‌های دیتاست (تولز ۲) -->
        {#if datasets.length}
          <div class="flex flex-wrap gap-2">
            {#each datasets as ds, di}
              <button type="button" class="dataset-capsule" onclick={() => (datasetOpen = datasetOpen === di ? -1 : di)}>
                <span class="text-xs font-extrabold">{ds.nameFa}</span>
                <span class="text-[11px] text-[var(--ink-soft)]">{ds.rows.length} سطر × {ds.columnsFa.length} ستون</span>
                <svg viewBox="0 0 64 20" class="h-5 w-16" aria-hidden="true">
                  {#each (numericColumns(ds)[0]?.values || []) as v, vi}
                    {@const vs = numericColumns(ds)[0].values}
                    {@const mn = Math.min(...vs)}
                    {@const mx = Math.max(...vs)}
                    <circle
                      cx={4 + (vi / Math.max(1, vs.length - 1)) * 56}
                      cy={18 - ((v - mn) / (mx - mn || 1)) * 16}
                      r="1.6"
                      fill="#166b5e"
                    />
                  {/each}
                </svg>
              </button>
            {/each}
          </div>
        {/if}

        {#if datasetOpen >= 0 && datasets[datasetOpen]}
          {@const ds = datasets[datasetOpen]}
          <div class="glass-card p-4">
            <div class="flex items-center gap-2">
              <h2 class="text-sm font-extrabold">{ds.nameFa}</h2>
              <button type="button" class="btn-ml-ghost ms-auto !min-h-[32px] px-2 text-xs" onclick={() => (datasetOpen = -1)}>بستن</button>
            </div>
            <p class="mt-1 text-xs leading-6 text-[var(--ink-soft)]">{ds.descFa || ''}</p>
            <div class="mt-3 overflow-x-auto">
              <table class="w-full text-xs">
                <thead>
                  <tr>
                    {#each ds.columnsFa as col}<th class="border-b px-2 py-1 text-start font-bold" style="border-color: var(--line)">{col}</th>{/each}
                  </tr>
                </thead>
                <tbody>
                  {#each ds.rows.slice(0, 5) as row}
                    <tr>
                      {#each row as val}<td class="border-b px-2 py-1" style="border-color: var(--line)" dir="ltr">{val}</td>{/each}
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
            {#each ds.columnsFa as col, ci}
              {@const vals = (ds.rows || []).map((r) => Number(r[ci])).filter((v) => Number.isFinite(v))}
              {#if vals.length >= 4}
                <div class="mt-3">
                  <p class="text-xs font-bold">{col}</p>
                  <div class="mt-1 flex h-10 items-end gap-[3px]">
                    {#each histogram(vals) as h, bi}
                      <div
                        class="flex-1 rounded-t"
                        style="height: {Math.max(8, h * 100)}%; background: {['#166b5e', '#b8421f', '#b5720a'][bi % 3]}"
                      ></div>
                    {/each}
                  </div>
                </div>
              {/if}
            {/each}
            {#if ds.computeDescFa}
              <p class="mt-3 text-xs leading-6 text-[var(--ink-soft)]">{ds.computeDescFa}</p>
            {/if}
          </div>
        {/if}

        <!-- کنسول خروجی خوانا -->
        <div class="glass-card flex-1 p-4">
          <h2 class="text-sm font-extrabold">بوم مشاهده — خروجی‌ها</h2>
          {#if cells.some((c) => c.output)}
            <div class="mt-3 flex flex-col gap-3">
              {#each cells as cell}
                {#if cell.output}
                  <div>
                    <p class="mb-1 text-xs font-bold">{cell.title}</p>
                    {#if cell.output.stdout}
                      <pre dir="ltr" class="whitespace-pre-wrap rounded-xl bg-[#1d1a18] p-3 text-left text-xs leading-6 text-[#f5efe6]">{cell.output.stdout}</pre>
                    {/if}
                    {#if cell.output.error}
                      <p class="mt-1 rounded-xl px-3 py-2 text-xs leading-6" style="background: rgba(181,114,10,.1); color: var(--saffron-text)">{cell.output.error}</p>
                    {/if}
                  </div>
                {/if}
              {/each}
            </div>
          {:else}
            <p class="mt-3 text-xs leading-6 text-[var(--ink-soft)]">
              هنوز خروجی‌ای نیست — یک سلول را اجرا کن تا جوابش اینجا بیاید.
            </p>
          {/if}
        </div>

        <p class="text-[11px] leading-5 text-[var(--ink-soft)]">
          بستن استودیو کرنل را خاموش نمی‌کند؛ Codespace پس از ۳۰ دقیقه بیکاری خودکار خاموش می‌شود.
          توقف صریح از اینجا ممکن نیست.
        </p>
      </section>
    </main>

    <!-- موبایل: دکمهٔ شناور خروجی -->
    <button type="button" class="mobile-sheet-fab" onclick={() => (sheetOpen = !sheetOpen)}>
      {sheetOpen ? 'بستن خروجی' : 'خروجی'}
    </button>

    <!-- موبایل: کپسول شناور «درس | استودیو» -->
    <div class="mobile-view-capsule" role="group" aria-label="جابه‌جایی میان درس و استودیو">
      <button type="button" class="mobile-view-seg" onclick={closeStudio}>درس</button>
      <span class="mobile-view-seg" data-active="true" aria-current="page">استودیو</span>
    </div>
  </div>
{/if}

<style>
  .studio-desk {
    --gold-thread: #b5720a;
  }
  .status-thread {
    height: 2px;
    background: var(--gold-thread);
    opacity: 0.35;
    transition: opacity 300ms ease, background-color 300ms ease;
  }
  .status-thread[data-state='running'] {
    opacity: 1;
    animation: thread-pulse 1.2s ease-in-out infinite;
  }
  .status-thread[data-state='ok'] {
    background: var(--patina);
    opacity: 0.9;
  }
  .status-thread[data-state='error'] {
    background: var(--saffron);
    opacity: 1;
  }
  @keyframes thread-pulse {
    0%, 100% { opacity: 0.45; }
    50% { opacity: 1; }
  }
  .status-light {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .status-dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--gold-thread);
    opacity: 0.45;
    flex: none;
  }
  .status-light[data-state='running'] .status-dot {
    opacity: 1;
    animation: thread-pulse 1.2s ease-in-out infinite;
  }
  .status-light[data-state='ok'] .status-dot {
    background: var(--patina);
    opacity: 1;
  }
  .status-light[data-state='error'] .status-dot {
    background: var(--saffron);
    opacity: 1;
  }
  .thread-step {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 999px;
    border: 1px solid var(--glass-border);
    background: var(--glass-tint);
    flex: none;
  }
  .thread-step[data-state='active'] {
    border-color: rgba(181, 114, 10, 0.65);
    box-shadow: 0 0 0 3px rgba(181, 114, 10, 0.14);
    animation: thread-pulse 1.6s ease-in-out infinite;
  }
  .thread-line {
    flex: 1 1 24px;
    min-width: 16px;
    height: 1.5px;
    background: var(--gold-thread);
    opacity: 0.55;
  }
  .thread-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #b5720a;
    opacity: 0.45;
    flex: none;
  }
  .thread-dot[data-state='done'] {
    background: var(--patina);
    opacity: 1;
  }
  .thread-dot[data-state='error'] {
    background: var(--saffron);
    opacity: 1;
  }
  .active-cell {
    border-color: rgba(181, 114, 10, 0.55);
    box-shadow: 0 0 0 3px rgba(181, 114, 10, 0.12);
  }
  .dataset-capsule {
    display: inline-flex;
    flex-direction: column;
    gap: 2px;
    align-items: flex-start;
    padding: 8px 12px;
    border-radius: 14px;
    border: 1px solid var(--glass-border);
    background: var(--glass-tint);
    text-align: start;
  }
  .mobile-sheet-fab {
    display: none;
  }
  .mobile-view-capsule {
    display: none;
  }
  @media (max-width: 768px) {
    .studio-desk main {
      grid-template-columns: 1fr !important;
      padding-bottom: 130px;
    }
    .obs-col {
      position: fixed;
      inset-inline: 0;
      bottom: 0;
      z-index: 50;
      max-height: 70%;
      overflow-y: auto;
      padding: 12px;
      border-radius: 20px 20px 0 0;
      background: var(--glass-tint-strong);
      border: 1px solid var(--glass-border);
      box-shadow: 0 -12px 32px rgba(30, 25, 22, 0.18);
      transform: translateY(105%);
      transition: transform 300ms ease;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }
    .obs-col.sheet-open {
      transform: translateY(0);
    }
    .mobile-sheet-fab {
      display: inline-flex;
      position: fixed;
      bottom: 14px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 51;
      min-height: 44px;
      padding-inline: 20px;
      border-radius: 999px;
      background: var(--terracotta);
      color: #fff;
      font-weight: 700;
      align-items: center;
      box-shadow: 0 8px 24px rgba(30, 25, 22, 0.2);
    }
    /* کپسول شناور «درس | استودیو» — بالای دکمهٔ خروجی تا روی هم نیفتند */
    .mobile-view-capsule {
      display: inline-flex;
      position: fixed;
      bottom: 70px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 51;
      padding: 4px;
      border-radius: 999px;
      border: 1px solid var(--glass-border);
      background: var(--glass-tint-strong);
      box-shadow: 0 8px 24px rgba(30, 25, 22, 0.2);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      align-items: center;
    }
    .mobile-view-seg {
      display: inline-flex;
      align-items: center;
      min-height: 36px;
      padding-inline: 18px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 700;
      color: var(--ink);
    }
    .mobile-view-seg[data-active='true'] {
      background: var(--terracotta);
      color: #fff;
    }
  }
</style>
