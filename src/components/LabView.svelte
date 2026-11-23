<script>
  import { onMount, onDestroy } from 'svelte'
  import {
    getState,
    onStateChange,
    runCell,
    resetNamespace,
    freshKernel,
    interrupt
  } from '../lib/pyodide-runner.js'
  import { fetchLabNotebook, saveLabNotebook } from '../lib/course-api.js'
  import { auth } from '../lib/auth-store.svelte.js'

  // آزمایشگاه زنده: سلول‌های پایتون با موتور Pyodide (ورکر + فالبک)،
  // دادهٔ آزمایشگاه، ذخیرهٔ دفترچه در lab_notebooks، و بازخورد استاد.
  let { lab, dataset = null, labCode } = $props()

  let cells = $state([])
  let engineState = $state('idle')
  let variables = $state([])
  let saveState = $state(null) // null | 'saving' | 'saved' | 'error'
  let saveError = $state(null)
  let savedAt = $state(null)
  let unsub = null

  function buildCells() {
    const list = (lab?.cells || []).map((c) => ({
      kind: 'lab',
      title: c.title,
      note: c.note || '',
      expected: c.expected || '',
      code: c.code,
      output: null,
      running: false,
      matched: null
    }))
    if (dataset && dataset[0]) {
      const ds = dataset[0]
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

  onMount(async () => {
    cells = buildCells()
    engineState = getState()
    unsub = onStateChange((s) => {
      engineState = s
    })
    // دفترچهٔ ذخیره‌شدهٔ شاگرد (اگر هست) کدهای ویرایش‌شده را برمی‌گرداند
    try {
      const res = await fetchLabNotebook(labCode)
      const saved = res?.data?.cells
      if (Array.isArray(saved) && saved.length) {
        for (const s of saved) {
          const cell = cells.find((c) => c.title === s.title)
          if (cell && typeof s.code === 'string') cell.code = s.code
        }
        savedAt = res.data.updated_at
      }
    } catch {
      /* خواندن دفترچه اختیاری است */
    }
  })

  onDestroy(() => {
    if (unsub) unsub()
  })

  async function runAt(i) {
    const cell = cells[i]
    if (!cell || cell.running) return
    cell.running = true
    cell.output = null
    cell.matched = null
    const res = await runCell(cell.code)
    cell.running = false
    cell.output = res
    if (Array.isArray(res.variables)) variables = res.variables
    if (cell.expected) {
      cell.matched = (res.stdout || '').trim() === cell.expected.trim()
    }
  }

  async function runAll() {
    for (let i = 0; i < cells.length; i++) {
      // eslint-disable-next-line no-await-in-loop
      await runAt(i)
    }
  }

  async function handleReset() {
    await resetNamespace()
    variables = []
  }

  function handleFresh() {
    freshKernel()
    variables = []
    for (const c of cells) c.output = null
  }

  async function handleSave() {
    saveState = 'saving'
    saveError = null
    const payload = cells.map((c) => ({
      title: c.title,
      code: c.code,
      output: c.output
        ? { stdout: c.output.stdout || '', error: c.output.error || null }
        : null
    }))
    const res = await saveLabNotebook(labCode, payload)
    if (res.error) {
      saveState = 'error'
      saveError = res.error
    } else if (res.readOnlyPreview) {
      saveState = 'saved'
      savedAt = null
    } else {
      saveState = 'saved'
      savedAt = res.data?.updated_at || new Date().toISOString()
    }
  }

  function engineLabel(s) {
    if (s === 'loading') return 'در حال بارگذاری موتور پایتون…'
    if (s === 'ready') return 'موتور پایتون آماده است'
    if (s === 'failed') return 'بارگذاری موتور ناموفق بود — اتصال اینترنت را بررسی کن و دوباره تلاش کن.'
    return 'موتور هنوز بارگذاری نشده — با اولین اجرا دانلود می‌شود (ممکن است چند ثانیه طول بکشد).'
  }
</script>

<div class="space-y-5">
  <div>
    <h3 class="text-lg font-extrabold">{lab?.title || 'آزمایشگاه'}</h3>
    {#if lab?.intro}
      <p class="text-sm leading-7 text-[var(--ink-soft)] mt-1">{lab.intro}</p>
    {/if}
  </div>

  <!-- وضعیت موتور + کنترل‌های هسته -->
  <div class="flex flex-wrap items-center gap-2 text-xs">
    <span
      class="rounded-full px-3 py-1 border"
      class:bg-emerald-50={engineState === 'ready'}
      class:border-emerald-300={engineState === 'ready'}
      class:text-emerald-900={engineState === 'ready'}
      class:bg-amber-50={engineState === 'loading' || engineState === 'idle'}
      class:border-amber-300={engineState === 'loading' || engineState === 'idle'}
      class:text-amber-900={engineState === 'loading' || engineState === 'idle'}
      class:bg-red-50={engineState === 'failed'}
      class:border-red-300={engineState === 'failed'}
      class:text-red-900={engineState === 'failed'}
    >
      {engineLabel(engineState)}
    </span>
    <button type="button" class="btn-ml-ghost text-xs" onclick={runAll}>اجرای همهٔ سلول‌ها</button>
    <button type="button" class="btn-ml-ghost text-xs" onclick={handleReset}>پاک‌کردن فضای نام</button>
    <button type="button" class="btn-ml-ghost text-xs" onclick={handleFresh}>شروع تازهٔ هسته</button>
    {#if auth.isStudent}
      <button type="button" class="btn-ml-ghost text-xs" onclick={handleSave} disabled={saveState === 'saving'}>
        {saveState === 'saving' ? 'در حال ذخیره…' : 'ذخیرهٔ دفترچه'}
      </button>
    {/if}
    {#if saveState === 'saved'}
      <span class="text-emerald-800">دفترچه ذخیره شد.</span>
    {:else if saveState === 'error'}
      <span class="text-amber-800">{saveError || 'ذخیره ناموفق بود.'}</span>
    {/if}
  </div>

  <!-- دادهٔ آزمایشگاه -->
  {#if dataset && dataset[0]}
    {@const ds = dataset[0]}
    <div class="rounded-2xl border border-[var(--glass-border)] bg-white/70 p-4 space-y-3">
      <div>
        <p class="font-bold text-sm">{ds.nameFa}</p>
        {#if ds.descFa}<p class="text-xs leading-6 text-[var(--ink-soft)] mt-1">{ds.descFa}</p>{/if}
      </div>
      {#if ds.columnsFa && ds.rows}
        <div class="overflow-x-auto">
          <table class="w-full text-xs border-collapse">
            <thead>
              <tr>
                {#each ds.columnsFa as col}<th class="border border-[var(--glass-border)] px-2 py-1 text-right bg-[var(--canvas-subtle)]">{col}</th>{/each}
              </tr>
            </thead>
            <tbody>
              {#each ds.rows as row}
                <tr>
                  {#each row as v}<td class="border border-[var(--glass-border)] px-2 py-1">{v}</td>{/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}

  <!-- سلول‌ها -->
  {#each cells as cell, i}
    <div class="rounded-2xl border border-[var(--glass-border)] bg-white/70 p-4 space-y-3">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="font-bold text-sm">{cell.title}</p>
          {#if cell.note}<p class="text-xs leading-6 text-[var(--ink-soft)] mt-1">{cell.note}</p>{/if}
        </div>
        <button
          type="button"
          class="btn-ml-primary text-xs shrink-0"
          onclick={() => runAt(i)}
          disabled={cell.running || engineState === 'loading'}
        >
          {cell.running ? 'در حال اجرا…' : 'اجرا'}
        </button>
      </div>

      <label class="block">
        <span class="sr-only">کد سلول {i + 1}</span>
        <textarea
          dir="ltr"
          rows={Math.max(3, cell.code.split('\n').length)}
          class="w-full rounded-xl border border-[var(--glass-border)] bg-[#1d1a18] text-[#f5efe6] font-mono text-xs leading-6 p-3 text-left"
          bind:value={cell.code}
        ></textarea>
      </label>

      {#if cell.running}
        <div class="flex items-center gap-2 text-xs text-[var(--ink-soft)]">
          <span>در حال اجرا — سقف ۱۲۰ ثانیه</span>
          <button type="button" class="btn-ml-ghost text-xs" onclick={interrupt}>توقف اجرا</button>
        </div>
      {/if}

      {#if cell.output}
        {@const o = cell.output}
        <div class="space-y-2">
          {#if o.engineFailed}
            <p class="text-xs rounded-xl bg-amber-50 border border-amber-300 text-amber-900 p-3">
              موتور پایتون بارگذاری نشد. اتصال اینترنت را بررسی کن و دوباره تلاش کن.
            </p>
          {:else if o.timeout}
            <p class="text-xs rounded-xl bg-amber-50 border border-amber-300 text-amber-900 p-3">
              {o.interrupted
                ? 'اجرا متوقف شد.'
                : 'اجرا به سقف ۱۲۰ ثانیه رسید و متوقف شد. کد را کوچک‌تر کن یا حلقه را بررسی کن.'}
            </p>
          {:else}
            {#if o.stdout}
              <pre dir="ltr" class="text-xs leading-6 whitespace-pre-wrap rounded-xl bg-[#1d1a18] text-[#f5efe6] p-3 text-left">{o.stdout}</pre>
            {/if}
            {#if o.stderr}
              <pre dir="ltr" class="text-xs leading-6 whitespace-pre-wrap rounded-xl bg-amber-50 border border-amber-300 text-amber-900 p-3 text-left">{o.stderr}</pre>
            {/if}
            {#if o.error}
              <pre dir="ltr" class="text-xs leading-6 whitespace-pre-wrap rounded-xl bg-amber-50 border border-amber-300 text-amber-900 p-3 text-left">{o.error}</pre>
            {/if}
            {#if o.structured && o.structured.kind === 'table'}
              <div class="overflow-x-auto">
                <table class="w-full text-xs border-collapse">
                  <thead>
                    <tr>
                      {#each o.structured.columns as col}<th class="border border-[var(--glass-border)] px-2 py-1 text-right bg-[var(--canvas-subtle)]">{col}</th>{/each}
                    </tr>
                  </thead>
                  <tbody>
                    {#each o.structured.rows as row}
                      <tr>
                        {#each row as v}<td class="border border-[var(--glass-border)] px-2 py-1">{v}</td>{/each}
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {:else if o.structured && o.structured.kind === 'chart'}
              {@const vals = o.structured.values}
              {@const mx = Math.max(...vals.map((v) => Math.abs(v)), 1)}
              <div class="space-y-1">
                {#each vals as v}
                  <div class="flex items-center gap-2 text-xs">
                    <div class="h-3 rounded bg-[var(--patina)]" style="width: {Math.max(2, (Math.abs(v) / mx) * 100)}%"></div>
                    <span class="font-mono" dir="ltr">{v}</span>
                  </div>
                {/each}
              </div>
            {/if}
            {#if cell.expected}
              {#if cell.matched}
                <p class="text-xs text-emerald-800">خروجی با مورد انتظار می‌خواند.</p>
              {:else}
                <details class="text-xs">
                  <summary class="cursor-pointer text-[var(--ink-soft)]">خروجی با مورد انتظار فرق دارد — مورد انتظار را ببین</summary>
                  <pre dir="ltr" class="mt-2 whitespace-pre-wrap rounded-xl bg-[var(--canvas-subtle)] p-3 text-left">{cell.expected}</pre>
                </details>
              {/if}
            {/if}
          {/if}
        </div>
      {/if}
    </div>
  {/each}

  <!-- متغیرها -->
  {#if variables.length}
    <div class="rounded-2xl border border-[var(--glass-border)] bg-white/70 p-4">
      <p class="font-bold text-sm mb-2">متغیرهای فضای نام</p>
      <div class="overflow-x-auto">
        <table class="w-full text-xs border-collapse">
          <thead>
            <tr><th class="border border-[var(--glass-border)] px-2 py-1 text-right">نام</th><th class="border border-[var(--glass-border)] px-2 py-1 text-right">نوع</th><th class="border border-[var(--glass-border)] px-2 py-1 text-right">مقدار</th></tr>
          </thead>
          <tbody>
            {#each variables as v}
              <tr>
                <td class="border border-[var(--glass-border)] px-2 py-1 font-mono" dir="ltr">{v.name}</td>
                <td class="border border-[var(--glass-border)] px-2 py-1">{v.type}</td>
                <td class="border border-[var(--glass-border)] px-2 py-1 font-mono" dir="ltr">{v.value}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  <!-- راهنمای ژوپیتر -->
  {#if (lab?.installSteps && lab.installSteps.length) || (lab?.jupyterSteps && lab.jupyterSteps.length)}
    <details class="text-xs leading-7 text-[var(--ink-soft)]">
      <summary class="cursor-pointer font-bold text-sm text-[var(--ink)]">در ژوپیتر کامپیوتر خودت</summary>
      {#if lab.installSteps}
        <ul class="list-disc pr-5 mt-2 space-y-1">
          {#each lab.installSteps as s}<li>{s}</li>{/each}
        </ul>
      {/if}
      {#if lab.jupyterSteps}
        <ul class="list-disc pr-5 mt-2 space-y-1">
          {#each lab.jupyterSteps as s}<li>{s}</li>{/each}
        </ul>
      {/if}
    </details>
  {/if}
</div>
