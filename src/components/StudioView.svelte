<script>
  // Jarvis Studio — the desk (Phase 4 + Phase A: free notebook + terminal).
  // Entry flow: wake (Edge Function, JWT) -> one-time ticket -> /launch ->
  // cinematic opening -> dual desk (code tablet 55% / observation canvas
  // 45%) with /execute cells (HTTP polling only — no browser WebSocket;
  // the tunnel breaks it), notebook auto-save to the Gateway AND sync to
  // Supabase lab_notebooks (the same pattern as LabView: save by title,
  // only the student's own rows; the teacher gets a read-only preview).
  // Phase A — free mode: #/studio WITHOUT ?lab= opens a blank notebook
  // (custom title, add/remove cells, list + reopen from the Gateway);
  // ?lab=lab-<id> stays exactly the lab mode from before. A real PTY
  // terminal (xterm.js, HTTP polling only) lives under the cells in
  // both modes. The terminal is NOT a keepalive: polling it does not
  // extend the 30-minute idle deadline.
  // Status light string: ready = dim brass, running = gold pulse,
  // success = patina green, error = saffron + Persian message.
  // Close: best-effort save, the in-memory session is forgotten. There is
  // NO explicit stop path: closing the Studio does not stop the Codespace;
  // it shuts itself down after 30 minutes idle (Gateway idle deadline).
  import { onMount, onDestroy, tick } from 'svelte'
  import { Terminal } from 'xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import 'xterm/css/xterm.css'
  import { sb } from '../lib/supabase.js'
  import { auth } from '../lib/auth-store.svelte.js'
  import { COURSE_CONTENT } from '../data/course-content.js'
  import { fetchLabNotebook, saveLabNotebook } from '../lib/course-api.js'
  import {
    wakeStudio,
    launchStudioSession,
    studioGateway,
    clearStudioSession,
    WAKE_DEADLINE_MS,
    StudioGatewayError
  } from '../lib/studio-gateway.js'
  import StudioOpening from './StudioOpening.svelte'
  import { setBusy, clearBusy, APP_VERSION, isBusy, isFreshVersionAvailable } from '../lib/version-check.js'

  // Phase R0 — wake state machine: sleeping -> waking -> launching ->
  // ready | error. The wake call itself polls with the server's
  // retry_after_seconds (see wakeStudio); this layer races the SAME
  // deadline the loop uses (R-10, فاز ۲ → F4), plus a 10s grace so the
  // loop's own timeout error — with the last 202 detail — wins over the
  // generic race error. Previously a hard 180s race cut the ~241s worst
  // case of the loop short.
  const WAKE_TIMEOUT_MS = WAKE_DEADLINE_MS + 10000

  // فاز ۴ → F8: مبدأ واقعی ورود — App مسیری را که کاربر از آن به استودیو
  // آمده (درس، خانه، داشبورد استاد، ...) در returnTo می‌فرستد؛ «بازگشت به
  // درس» به همان‌جا برمی‌گردد. فقط وقتی مبدأ ثبت نشده (ورود مستقیم با
  // #/studio)، به خانهٔ دوره برمی‌گردد (تصمیم‌های واگذارشده، مورد ۵) —
  // نه به درسِ لب.
  let { labCode = null, returnTo = null } = $props()

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
  // فاز A — دفترچهٔ آزاد: ورود بدون ?lab= یعنی حالت آزاد (دفترچهٔ خالی
  // با نام دلخواه)؛ ?lab=lab-<id> یعنی حالت لب‌محور مثل قبل. resolveLesson
  // فقط در حالت لب‌محور صدا می‌شود — fallback به نخستین لب فقط برای لب
  // نامعتبر است، نه برای ورود آزاد.
  const isFreeMode = labCode == null
  const lesson = isFreeMode ? null : resolveLesson(labCode)
  const labCodeResolved = lesson ? `lab-${lesson.id}` : null
  const datasets = lesson ? COURSE_CONTENT.labDatasets[String(lesson.id)] || [] : []
  function isValidReturnHash(h) {
    return typeof h === 'string' && h.startsWith('#/') && !h.startsWith('#/studio')
  }
  const returnHash = isValidReturnHash(returnTo) ? returnTo : '#/'

  // ---------- state ----------
  let phase = $state('waking') // waking | launching | opening | ready | error
  let wakeState = $state('sleeping') // sleeping | waking | launching | ready | error
  let wakeAttempt = $state(0)
  let wakeElapsedSec = $state(0)
  let wakeNote = $state('')
  let errorMsg = $state('')
  let errorDetail = $state('')
  // فاز ۴ (R-1): کد پایدار خطا + قدمِ افتاده، برای کارت خطا.
  let errorCode = $state(null)
  let errorStep = $state(null)
  let cells = $state([])
  let activeCell = $state(0)
  let running = $state(false)
  let statusLight = $state('waking') // idle | waking | running | ok | error
  let statusLightLabel = $state('در حال بیدار شدن')
  let gatewayStatus = $state(null)
  let saveState = $state(null) // null | 'saving' | 'saved' | 'error'
  let saveNote = $state('')
  let sessionLost = $state(false) // فاز ۲ → F9: نشست گیت‌وی وسط درس از دست رفت
  let datasetOpen = $state(-1)
  let sliderDegree = $state(2)
  let sliderServer = $state(null) // null | { state: 'running'|'ok'|'error', r2, stdout, error }
  let sheetOpen = $state(false)

  // ---------- دفترچهٔ آزاد (فاز A) ----------
  let freeName = $state(null) // نام گیت‌وی (ASCII، سازگار با NAME_RE گیت‌وی)
  let freeTitle = $state('دفترچهٔ آزاد')
  let freeList = $state(null) // null | [{name, title}]
  let freeListOpen = $state(false)
  let freeListLoading = $state(false)

  // ---------- ترمینال واقعی (فاز A) ----------
  let term = null
  let termFit = null
  let termOffset = 0
  let termPollTimer = null
  let termInputChain = Promise.resolve()
  let termOpen = $state(false)

  // کارت شیشه‌ای یک‌بارمصرف روز اول در میز — همان پرچم سایدبار، پس واقعاً یک‌بار است.
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
  let showDay1DeskHint = $state(!day1HintSeen())
  function dismissDay1DeskHint() {
    try {
      window.localStorage?.setItem(DAY1_HINT_KEY, '1')
    } catch {
      /* ذخیرهٔ محلی در دسترس نیست؛ فقط همین نشست مخفی می‌شود */
    }
    showDay1DeskHint = false
  }
  let gateway = null
  let statusTimer = null
  let wakeTimer = null
  let flowSeq = 0
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
  if (isFreeMode) {
    cells = [newFreeCell(1)]
    freeName = `free-${Math.random().toString(36).slice(2, 8)}`
  }

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

  // ---------- همگام‌سازی لغزنده با سلول (R2): برازش سمت مرورگر را در کرنل
  // واقعی اجرا می‌کند و R² سرور را کنار R² سمت مرورگر می‌گذارد. از همان
  // gateway.execute و همان رشتهٔ نور وضعیت runCell استفاده می‌کند؛ سلول
  // تازه به دفترچه اضافه نمی‌شود و چیزی ذخیره نمی‌شود (فقط راستی‌آزمایی). ----------
  function fmtNum(v) {
    return String(Number(v.toPrecision(6)))
  }
  // فاز ۴ (R-1): متن خطای سلول با کد + قدم — وقتی سرور کد ساخت‌یافته
  // داده باشد، در همان جعبهٔ خطا دیده می‌شود، نه فقط در کارت خطا.
  function gatewayErrorText(e) {
    const base =
      e instanceof StudioGatewayError ? e.message : 'اجرای سلول ناموفق بود.'
    if (e instanceof StudioGatewayError && (e.code || e.step)) {
      return `${base} (کد: ${e.code || e.kind}${e.step ? ` · قدم: ${e.step}` : ''})`
    }
    return base
  }

  async function syncSliderToCell() {
    if (!gateway || running || phase !== 'ready' || !sliderFit) return
    running = true
    sliderServer = { state: 'running', r2: null, stdout: '', error: '' }
    statusLight = 'running'
    statusLightLabel = 'در حال اجرا'
    const { points } = sliderPoints
    const xs = points.map(([x]) => fmtNum(x)).join(', ')
    const ys = points.map(([, y]) => fmtNum(y)).join(', ')
    const code = [
      'import numpy as np',
      `x = np.array([${xs}], dtype=float)`,
      `y = np.array([${ys}], dtype=float)`,
      `coef = np.polyfit(x, y, ${sliderDegree})`,
      'p = np.poly1d(coef)',
      'yhat = p(x)',
      'ss_res = float(((y - yhat) ** 2).sum())',
      'ss_tot = float(((y - y.mean()) ** 2).sum())',
      'r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0',
      'print("coef:", [round(float(c), 6) for c in coef])',
      'print("R2 =", round(float(r2), 4))'
    ].join('\n')
    try {
      const out = await gateway.execute(code, isFreeMode ? freeName : labCodeResolved)
      const res = gatewayOutcomeToOutput(out)
      if (res.error) {
        sliderServer = { state: 'error', r2: null, stdout: res.stdout || '', error: res.error }
        statusLight = 'error'
        statusLightLabel = 'خطا'
      } else {
        const m = res.stdout.match(/R2\s*=\s*([0-9.]+)/)
        sliderServer = {
          state: 'ok',
          r2: m ? Number(m[1]) : null,
          stdout: res.stdout,
          error: ''
        }
        statusLight = 'ok'
        statusLightLabel = 'موفق'
      }
      void refreshStatus()
    } catch (e) {
      sliderServer = { state: 'error', r2: null, stdout: '', error: gatewayErrorText(e) }
      statusLight = 'error'
      statusLightLabel = 'خطا'
      if (e instanceof StudioGatewayError) errorDetail = e.detail || ''
    } finally {
      running = false
    }
  }

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

  // فاز ۴ (F7): دیگر شمارش معکوس خاموشی از idle_deadline_utc خوانده
  // نمی‌شود — آن مهلت با هر پول /status تازه می‌شد و هیچ‌وقت کم نمی‌شد،
  // و مهلت واقعیِ Codespace به بی‌فعالیتیِ ترمینال بستگی دارد، نه HTTP.
  // refreshStatus فقط وضعیت + تشخیص نشست مرده را انجام می‌دهد.
  async function refreshStatus() {
    if (!gateway) return
    try {
      gatewayStatus = await gateway.status()
    } catch (e) {
      /* مهلت بیکاری یخ می‌زند؛ خطای واقعی هنگام اجراست — ولی ۴۰۱ یعنی
         نشست مرده است و بنر «بیداری دوباره» را نشان می‌دهیم (فاز ۲ → F9). */
      if (e instanceof StudioGatewayError && e.kind === 'unauthorized') sessionLost = true
    }
  }

  async function startFlow() {
    // رفع F2 — چک صریح نسخه پیش از بیداری: اگر نسخهٔ تازه‌ای هست، رفرش
    // کن تا بیداری با باندل تازه شروع شود؛ اگر چک ناموفق شد (شبکه) یا
    // کاربر مشغول است، بیداری مسدود نمی‌شود و با همین باندل ادامه می‌یابد.
    if (!isBusy() && (await isFreshVersionAvailable())) {
      window.location.reload()
      return
    }
    const mySeq = ++flowSeq
    phase = 'waking'
    wakeState = 'sleeping'
    wakeAttempt = 0
    wakeElapsedSec = 0
    statusLight = 'waking'
    statusLightLabel = 'در حال بیدار شدن'
    errorMsg = ''
    errorDetail = ''
    errorCode = null
    errorStep = null
    wakeNote = ''
    sessionLost = false
    let timeoutId = null
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(
        () =>
          reject(
            new StudioGatewayError(
              'timeout',
              'بیداری استودیو بیش از ۵ دقیقه طول کشید؛ دوباره تلاش کنید.'
            )
          ),
        WAKE_TIMEOUT_MS
      )
    })
    try {
      const { ticket, gatewayUrl } = await Promise.race([
        wakeStudio(sb, {
          onProgress: (p) => {
            if (mySeq !== flowSeq) return
            wakeState = 'waking'
            wakeAttempt = p.attempt
            wakeNote = `تلاش ${p.attempt} — بیداری Codespace… (${p.waitSec} ثانیه صبر)`
          }
        }),
        timeoutPromise
      ])
      clearTimeout(timeoutId)
      if (mySeq !== flowSeq) return
      phase = 'launching'
      wakeState = 'launching'
      wakeNote = ''
      await launchStudioSession(gatewayUrl, ticket)
      if (mySeq !== flowSeq) return
      gateway = studioGateway(gatewayUrl)
      void loadSaved()
      void refreshStatus()
      statusTimer = setInterval(() => void refreshStatus(), 30000)
      wakeState = 'ready'
      phase = 'opening'
    } catch (e) {
      clearTimeout(timeoutId)
      if (mySeq !== flowSeq) return
      phase = 'error'
      wakeState = 'error'
      errorMsg =
        e instanceof StudioGatewayError
          ? e.message
          : 'ورود به استودیو ناموفق بود.'
      errorDetail = e?.detail || e?.message || ''
      // فاز ۴ (R-1): کد خطا + قدم — کدِ ساخت‌یافتهٔ سرور، وگرنه kind.
      errorCode =
        e instanceof StudioGatewayError ? e.code || e.kind || null : null
      errorStep = e instanceof StudioGatewayError ? e.step || null : null
      statusLight = 'error'
      statusLightLabel = 'خطا'
    }
  }

  // لغو بیداری: جریان در حال اجرا را باطل می‌کند و بدون ذخیره برمی‌گردد
  // (ذخیره در این مرحله می‌تواند دفترچهٔ ذخیره‌شده را با سلول‌های خالی
  // بازنویسی کند، پس عمداً انجام نمی‌شود).
  function cancelWake() {
    flowSeq += 1
    clearStudioSession()
    window.location.hash = returnHash
  }

  // بیداری دوباره پس از از دست رفتن نشست وسط درس (فاز ۲ → F9):
  // سلول‌ها و دفترچهٔ باز در حافظهٔ کامپوننت می‌مانند — startFlow آن‌ها را
  // دست نمی‌زند (loadSaved فقط یک بار و فقط کد/خروجیِ ذخیره‌شده را اعمال
  // می‌کند) — پس بیداری دوباره دفترچهٔ باز را از دست نمی‌دهد.
  function rewake() {
    sessionLost = false
    clearStudioSession()
    void startFlow()
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
      const out = await gateway.execute(cell.code, isFreeMode ? freeName : labCodeResolved)
      sessionLost = false // نشست زنده است — بنر بازیابی (اگر بود) برداشته می‌شود
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
      cell.output = { stdout: '', error: gatewayErrorText(e) }
      statusLight = 'error'
      statusLightLabel = 'خطا'
      if (e instanceof StudioGatewayError) errorDetail = e.detail || ''
      if (e instanceof StudioGatewayError && e.kind === 'unauthorized') sessionLost = true
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
    if (isFreeMode) return handleFreeSave()
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

  // ---------- دفترچهٔ آزاد (فاز A): ذخیره / فهرست / بازگشایی ----------
  function newFreeCell(n) {
    return {
      kind: 'free',
      title: `سلول ${n}`,
      note: '',
      expected: '',
      code: '',
      output: null,
      running: false,
      matched: null
    }
  }

  function freeNotebookJson() {
    return {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {
        kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
        language_info: { name: 'python', version: '3.11' },
        title: freeTitle,
        free: true
      },
      cells: cells.map((c) => ({
        cell_type: 'code',
        execution_count: null,
        metadata: {},
        outputs: c.output
          ? [
              {
                output_type: 'stream',
                name: c.output.error ? 'stderr' : 'stdout',
                text: c.output.error || c.output.stdout || ''
              }
            ]
          : [],
        source: c.code
      }))
    }
  }

  async function handleFreeSave() {
    if (!gateway || !freeName) return
    saveState = 'saving'
    saveNote = ''
    try {
      // اول Gateway: فایل دفترچه همان‌جا منبع حقیقت است — بازنویسی کامل،
      // تا سلول‌های افزوده‌شدهٔ /execute (هر اجرا یک سلول می‌افزاید) تمیز شوند.
      await gateway.saveNotebook(freeName, freeNotebookJson())
    } catch (e) {
      saveState = 'error'
      saveNote = 'ذخیره در Gateway ناموفق بود.'
      return
    }
    // بعد سینک Supabase با همان الگوی LabView — کلید free-<name> تا
    // دفترچه‌های آزاد در lab_notebooks کنار لب‌ها بمانند و استاد هم ببیندشان.
    const payload = cells.map((c) => ({
      title: c.title,
      code: c.code,
      output: c.output
        ? { stdout: c.output.stdout || '', error: c.output.error || null }
        : null
    }))
    const res = await saveLabNotebook(`free-${freeName}`, payload)
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

  async function refreshFreeList() {
    if (!gateway) return
    freeListLoading = true
    try {
      const res = await gateway.listNotebooks()
      const names = (res.notebooks || []).filter((n) => n.startsWith('free-'))
      const items = []
      for (const name of names) {
        let title = name
        try {
          const nb = await gateway.loadNotebook(name)
          if (typeof nb?.metadata?.title === 'string' && nb.metadata.title) {
            title = nb.metadata.title
          }
        } catch {
          /* نام جای عنوان می‌نشیند */
        }
        items.push({ name, title })
      }
      freeList = items
    } catch (e) {
      freeList = []
      saveNote = 'خواندن فهرست دفترچه‌ها ناموفق بود.'
    } finally {
      freeListLoading = false
    }
  }

  async function openFreeNotebook(name) {
    if (!gateway || running) return
    try {
      const nb = await gateway.loadNotebook(name)
      const loaded = (nb.cells || []).map((c, i) => ({
        kind: 'free',
        title: `سلول ${i + 1}`,
        note: '',
        expected: '',
        code: Array.isArray(c.source)
          ? c.source.join('')
          : typeof c.source === 'string'
            ? c.source
            : '',
        output: null,
        running: false,
        matched: null
      }))
      cells = loaded.length ? loaded : [newFreeCell(1)]
      freeName = name
      freeTitle =
        typeof nb?.metadata?.title === 'string' && nb.metadata.title
          ? nb.metadata.title
          : name
      freeListOpen = false
      activeCell = 0
      saveState = null
      saveNote = ''
    } catch (e) {
      saveNote = 'باز کردن دفترچه ناموفق بود.'
    }
  }

  function newFreeNotebook() {
    cells = [newFreeCell(1)]
    freeName = `free-${Math.random().toString(36).slice(2, 8)}`
    freeTitle = 'دفترچهٔ آزاد'
    activeCell = 0
    saveState = null
    saveNote = ''
    freeListOpen = false
  }

  function addFreeCell() {
    cells = [...cells, newFreeCell(cells.length + 1)]
    activeCell = cells.length - 1
  }

  function removeFreeCell(i) {
    if (cells.length <= 1) return
    cells = cells.filter((_, j) => j !== i)
    if (activeCell >= cells.length) activeCell = cells.length - 1
  }

  // ---------- ترمینال واقعی (فاز A) ----------
  // xterm.js + HTTP polling — وب‌سوکت از پورت فورواردشده خراب است، پس
  // خروجی با GET /terminal/output پول می‌شود و کلیدها با POST
  // /terminal/input فرستاده می‌شوند (زنجیرهٔ ترتیبی تا کلیدها جابه‌جا
  // نشوند). ترمینال keepalive نیست: پول آن مهلت ۳۰ دقیقه‌ای را عقب
  // نمی‌اندازد — فقط ۴۰۱ یعنی نشست مرده است و بنر بازیابی را نشان می‌دهد.
  async function termPollOnce() {
    if (!gateway || !term || !termOpen || phase !== 'ready') return
    try {
      const res = await gateway.terminalOutput(termOffset)
      if (typeof res.base_offset === 'number' && res.base_offset > termOffset) {
        term.clear()
      }
      if (res.output) term.write(res.output)
      if (typeof res.next_offset === 'number') termOffset = res.next_offset
    } catch (e) {
      if (e instanceof StudioGatewayError && e.kind === 'unauthorized') sessionLost = true
    }
  }

  async function openTerminal() {
    if (!gateway || phase !== 'ready') return
    termOpen = true
    await tick()
    if (!term) {
      term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        theme: { background: '#1d1a18', foreground: '#ede6da', cursor: '#b5720a' }
      })
      termFit = new FitAddon()
      term.loadAddon(termFit)
      term.open(document.getElementById('studio-terminal'))
      term.onData((data) => {
        termInputChain = termInputChain
          .then(() => gateway.terminalInput(data))
          .catch(() => {})
      })
      term.onResize(({ cols, rows }) => {
        if (gateway) void gateway.terminalResize(cols, rows).catch(() => {})
      })
    }
    try {
      termFit.fit()
      await gateway.terminalResize(term.cols, term.rows)
    } catch {
      /* اندازهٔ پیش‌فرض سرور کافی است */
    }
    termOffset = 0
    await termPollOnce()
    if (termPollTimer) clearInterval(termPollTimer)
    termPollTimer = setInterval(() => void termPollOnce(), 800)
  }

  function closeTerminal() {
    termOpen = false
    if (termPollTimer) {
      clearInterval(termPollTimer)
      termPollTimer = null
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

  onMount(() => {
    if ((!lesson && !isFreeMode) || !auth.canOperate) {
      phase = 'error'
      errorMsg = !auth.canOperate
        ? 'برای ورود به استودیو نخست وارد شوید.'
        : 'آزمایشگاهی برای این درس پیدا نشد.'
      statusLight = 'error'
      statusLightLabel = 'خطا'
      return
    }
    wakeTimer = setInterval(() => {
      if (phase === 'waking' || phase === 'launching') wakeElapsedSec += 1
    }, 1000)
    const onKey = (e) => {
      if (e.code === 'KeyS' && (e.ctrlKey || e.metaKey) && phase === 'ready') {
        e.preventDefault()
        void handleSave()
      }
    }
    window.addEventListener('keydown', onKey)
    const onResize = () => {
      if (term && termOpen) {
        try {
          termFit.fit()
        } catch {
          /* جا دادن ترمینال شکست — اندازهٔ فعلی می‌ماند */
        }
      }
    }
    window.addEventListener('resize', onResize)
    void startFlow()
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  })

  onDestroy(() => {
    if (statusTimer) clearInterval(statusTimer)
    if (wakeTimer) clearInterval(wakeTimer)
    if (termPollTimer) clearInterval(termPollTimer)
    if (term) {
      try {
        term.dispose()
      } catch {
        /* ترمینال در حال بسته شدن است */
      }
      term = null
    }
    clearBusy('studio-wake')
    clearBusy('studio-opening')
    clearBusy('studio-cell')
    clearStudioSession()
    if (phase === 'ready') {
      void handleSave()
    }
  })

  // Phase R0 — version-check safety: never auto-reload while the wake is
  // in progress, the opening is playing, or a cell is running.
  $effect(() => {
    if (phase === 'waking' || phase === 'launching') setBusy('studio-wake')
    else clearBusy('studio-wake')
    if (phase === 'opening') setBusy('studio-opening')
    else clearBusy('studio-opening')
  })
  $effect(() => {
    if (running) setBusy('studio-cell')
    else clearBusy('studio-cell')
  })
</script>

{#if phase === 'opening'}
  <StudioOpening onDone={onOpeningDone} />
{:else if phase === 'waking' || phase === 'launching'}
  <div class="min-h-dvh warm-mesh flex flex-col items-center justify-center gap-5 p-6 text-center">
    <!-- R3 — لوپ شیلد با اسم روی صفحهٔ بیداری/launching -->
    <video
      src="studio-opening/jarvis-studio-shield-loop-v2-name.mp4"
      poster="studio-opening/jarvis-studio-shield-loop-poster.jpg"
      autoplay
      muted
      loop
      playsinline
      preload="auto"
      class="h-40 w-40 rounded-3xl object-cover shadow-[0_8px_24px_rgba(30,25,22,0.12)]"
      aria-label="Jarvis Studio — در حال بیدار کردن استودیو"
    ></video>
    <h1 class="text-xl font-extrabold">Jarvis Studio</h1>
    <p class="text-sm text-[var(--ink-soft)]">
      {wakeState === 'sleeping'
        ? 'استودیو در خواب است — در حال بیدار کردن…'
        : wakeState === 'waking'
          ? `در حال بیدار کردن استودیو… (تلاش ${wakeAttempt} — ${wakeElapsedSec} ثانیه گذشته)`
          : 'در حال برقراری نشست…'}
    </p>
    {#if wakeNote}<p class="text-xs text-[var(--ink-soft)]">{wakeNote}</p>{/if}
    <p class="text-xs text-[var(--ink-soft)]">بیداری Codespace معمولاً ۲۰ تا ۲۵ ثانیه طول می‌کشد؛ اگر بیش از ۵ دقیقه شد، خودکار متوقف می‌شود.</p>
    <button type="button" class="btn-ml-ghost text-sm" onclick={cancelWake}>لغو و بازگشت به درس</button>
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
      <!-- فاز ۱ (R-8) + فاز ۴ (R-1): قدم + دلیل + نسخه روی کارت خطا —
           کدِ خطا و قدمِ افتاده (وقتی معلوم‌اند) کنار هش باندل. -->
      {#if errorCode}
        <p class="mt-3 text-[11px] text-[var(--ink-soft)]">
          کد خطا: <span class="font-code" dir="ltr">{errorCode}</span>{#if errorStep}
            · قدم: <span class="font-code" dir="ltr">{errorStep}</span>{/if}
        </p>
      {/if}
      <p class="mt-1 text-[11px] text-[var(--ink-soft)]">نسخهٔ باندل: <span class="font-code" dir="ltr">{APP_VERSION}</span></p>
    </div>
    <div class="flex gap-2">
      <button type="button" class="btn-ml-primary" onclick={() => void startFlow()}>تلاش دوباره</button>
      <button type="button" class="btn-ml-ghost" onclick={closeStudio}>بازگشت به درس</button>
    </div>
  </div>
{:else}
  <!-- ================= the desk ================= -->
  <div class="studio-desk h-dvh warm-mesh flex flex-col">
    <header class="glass-chrome sticky top-0 z-40">
      <div class="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3">
        <img src="logo/jarvis-studio-shield-32.png" alt="" width="32" height="32" />
        <div class="leading-tight">
          <p class="font-extrabold">Jarvis Studio</p>
          {#if isFreeMode}
            <input
              class="mt-0.5 w-56 rounded-lg border bg-transparent px-2 py-1 text-xs font-bold outline-none"
              style="border-color: var(--line)"
              bind:value={freeTitle}
              aria-label="نام دفترچهٔ آزاد"
              placeholder="نام دفترچهٔ آزاد"
            />
          {:else}
            <p class="text-xs text-[var(--ink-soft)]">
              {lesson?.lab?.title || 'استودیو'} — درس {lesson?.code || ''}
            </p>
          {/if}
        </div>
        <div class="ms-auto flex items-center gap-3">
          <span class="status-light" data-state={statusLight} title="وضعیت Gateway">
            <span class="status-dot"></span>
            <span class="text-xs font-bold">{statusLightLabel}</span>
          </span>
          <button type="button" class="btn-ml-ghost !min-h-[36px] text-sm" onclick={closeStudio}>
            {isFreeMode ? 'بازگشت' : 'بازگشت به درس'}
          </button>
        </div>
      </div>
      <!-- رشتهٔ نور وضعیت -->
      <div class="status-thread" data-state={statusLight} aria-hidden="true"></div>
    </header>

    {#if gateway && !gateway.hasSessionHeader}
      <div class="mx-auto mt-3 w-full max-w-[1400px] px-4">
        <p class="rounded-xl border px-3 py-2 text-xs leading-6" style="border-color: rgba(181,114,10,.4); background: rgba(181,114,10,.08); color: var(--saffron-text)">
          نشست فقط با کوکی برقرار شد؛ چون مرورگر کوکی Lax را در fetch نمی‌فرستد، اجرای سلول ممکن است ۴۰۱ بدهد.
          پشتیبانی از هدر Authorization در Gateway تأیید و دیپلوی شده (۲۴ نوامبر) — این پیام یعنی Gateway در حال اجرا هنوز نسخهٔ قدیمی است؛ با بیداری دوباره نسخهٔ تازه می‌آید.
        </p>
      </div>
    {/if}

    {#if sessionLost}
      <!-- فاز ۲ → F9: نشست وسط درس از دست رفت — بیداری دوباره بدون بستن
           استودیو و بدون از دست دادن دفترچهٔ باز. -->
      <div class="mx-auto mt-3 w-full max-w-[1400px] px-4">
        <div class="flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2" style="border-color: rgba(181,114,10,.4); background: rgba(181,114,10,.08);">
          <p class="text-xs leading-6 font-bold" style="color: var(--saffron-text)">نشست استودیو از دست رفت — دفترچهٔ باز حفظ شده است.</p>
          <button type="button" class="btn-ml-primary !min-h-[44px] text-sm" onclick={rewake}>بیداری دوباره</button>
        </div>
      </div>
    {/if}

    <main class="mx-auto grid min-h-0 w-full max-w-[1400px] flex-1 gap-4 overflow-y-auto px-4 py-4 lg:grid-cols-[55%_45%]">
      <!-- لوح کد -->
      <section class="flex min-w-0 flex-col gap-4">
        <!-- کارت شیشه‌ای یک‌بارمصرف روز اول در میز (R2) -->
        {#if showDay1DeskHint}
          <div class="glass-card p-3">
            <p class="text-xs font-extrabold leading-6">روز اول در استودیو</p>
            <p class="text-xs leading-6 text-[var(--ink-soft)]">
              سلول‌ها را با Shift+Enter اجرا کن؛ لغزندهٔ پایین درجهٔ برازش را زنده عوض می‌کند و
              دکمهٔ «همگام‌سازی با سلول» نتیجهٔ سرور را با محاسبهٔ مرورگر مقایسه می‌کند.
            </p>
            <div class="mt-2 flex justify-end">
              <button
                type="button"
                class="btn-ml-ghost !min-h-[32px] px-3 text-xs"
                onclick={dismissDay1DeskHint}
              >
                فهمیدم
              </button>
            </div>
          </div>
        {/if}

        {#if isFreeMode}
          <!-- نوار دفترچهٔ آزاد (فاز A) -->
          <div class="glass-card flex flex-wrap items-center gap-2 p-3">
            <button type="button" class="btn-ml-ghost !min-h-[36px] text-sm" onclick={newFreeNotebook}>دفترچهٔ تازه</button>
            <button
              type="button"
              class="btn-ml-ghost !min-h-[36px] text-sm"
              onclick={() => {
                freeListOpen = !freeListOpen
                if (freeListOpen) void refreshFreeList()
              }}
            >
              دفترچه‌ها
            </button>
            <button type="button" class="btn-ml-ghost !min-h-[36px] text-sm" disabled={running} onclick={addFreeCell}>سلول تازه +</button>
            <span class="text-xs text-[var(--ink-soft)]">پایتون کامل — هر کدی بنویس و با Shift+Enter اجرا کن.</span>
          </div>
          {#if freeListOpen}
            <div class="glass-card p-3">
              <p class="text-xs font-extrabold">دفترچه‌های آزاد من</p>
              {#if freeListLoading}
                <p class="mt-2 text-xs text-[var(--ink-soft)]">در حال خواندن فهرست…</p>
              {:else if freeList && freeList.length}
                <div class="mt-2 flex flex-col gap-1">
                  {#each freeList as item}
                    <button
                      type="button"
                      class="flex items-center gap-2 rounded-lg px-2 py-2 text-start text-sm hover:bg-black/5"
                      onclick={() => void openFreeNotebook(item.name)}
                    >
                      <span class="font-bold">{item.title}</span>
                      <span class="font-code text-[11px] text-[var(--ink-soft)]" dir="ltr">{item.name}</span>
                    </button>
                  {/each}
                </div>
              {:else}
                <p class="mt-2 text-xs text-[var(--ink-soft)]">هنوز دفترچهٔ آزادی نساخته‌ای — همین دفترچهٔ باز با نخستین ذخیره در فهرست می‌آید.</p>
              {/if}
            </div>
          {/if}
        {:else}
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
        {/if}

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
              {#if isFreeMode && cells.length > 1}
                <button
                  type="button"
                  class="btn-ml-ghost !min-h-[44px] text-sm"
                  disabled={running}
                  onclick={() => removeFreeCell(i)}
                >
                  حذف سلول
                </button>
              {/if}
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
          <button type="button" class="btn-ml-ghost text-sm" onclick={() => (termOpen ? closeTerminal() : void openTerminal())}>
            {termOpen ? 'بستن ترمینال' : 'ترمینال'}
          </button>
          {#if saveNote}<span class="text-xs text-[var(--ink-soft)]">{saveNote}</span>{/if}
        </div>

        {#if termOpen}
          <!-- ترمینال واقعی (فاز A) — xterm.js + HTTP polling -->
          <section class="glass-card overflow-hidden">
            <div class="flex items-center gap-2 p-3">
              <h2 class="text-sm font-extrabold">ترمینال</h2>
              <span class="text-xs text-[var(--ink-soft)]">شل واقعی Codespace — pip install و دستورهای شل اینجا کار می‌کنند.</span>
              <button type="button" class="btn-ml-ghost ms-auto !min-h-[32px] px-2 text-xs" onclick={closeTerminal}>بستن</button>
            </div>
            <div id="studio-terminal" class="h-[300px] bg-[#1d1a18] p-2 text-left" dir="ltr"></div>
          </section>
        {/if}

        <!-- لغزندهٔ پارامتر زنده (تولز ۳) — محاسبهٔ سمت مرورگر + همگام‌سازی با سلول (R2) -->
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
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="btn-ml-ghost !min-h-[44px] text-sm"
              disabled={running || !gateway || phase !== 'ready'}
              onclick={() => void syncSliderToCell()}
            >
              {sliderServer?.state === 'running' ? 'در حال همگام‌سازی…' : 'همگام‌سازی با سلول'}
            </button>
            {#if sliderServer?.state === 'ok' && sliderServer.r2 != null}
              <span class="text-sm">
                سرور: R² = <span dir="ltr" class="font-code font-bold">{sliderServer.r2.toFixed(2)}</span>
              </span>
              {#if sliderFit}
                <span class="text-xs text-[var(--ink-soft)]">
                  {Math.abs(sliderServer.r2 - sliderFit.r2) < 0.005
                    ? 'با محاسبهٔ مرورگر می‌خواند'
                    : 'با محاسبهٔ مرورگر کمی فرق دارد'}
                </span>
              {/if}
            {:else if sliderServer?.state === 'error'}
              <span class="text-xs font-bold" style="color: var(--saffron-text)">{sliderServer.error}</span>
            {/if}
          </div>
          {#if sliderServer?.state === 'ok' && sliderServer.stdout}
            <pre dir="ltr" class="mt-2 whitespace-pre-wrap rounded-xl bg-[#1d1a18] p-3 text-left text-xs leading-6 text-[#f5efe6]">{sliderServer.stdout}</pre>
          {/if}
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

        <!-- فاز ۴ (F7): هشدار صادقانه به‌جای شمارش دروغین — مهلت واقعی
             به بی‌فعالیتیِ ترمینال بستگی دارد و کار در این صفحه (اجرا،
             ذخیره، پول وضعیت) آن را عقب نمی‌اندازد. -->
        <p class="text-[11px] leading-5 text-[var(--ink-soft)]">
          بستن استودیو کرنل را خاموش نمی‌کند؛ Codespace پس از ۳۰ دقیقه بی‌فعالیتیِ ترمینال
          خودکار خاموش می‌شود — فعالیت در این صفحه آن را بیدار نگه نمی‌دارد، و پول
          ترمینال هم آن را عقب نمی‌اندازد. توقف صریح از اینجا ممکن نیست.
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
      padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
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
      bottom: calc(14px + env(safe-area-inset-bottom, 0px));
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
    /* کپسول شناور «درس | استودیو» — بالای دکمهٔ خروجی تا روی هم نیفتند؛
       با safe-area تا روی گوشی‌های بریده (ناچ) زیر نشانگر خانه نرود */
    .mobile-view-capsule {
      display: inline-flex;
      position: fixed;
      bottom: calc(70px + env(safe-area-inset-bottom, 0px));
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
