// موتور اجرای پایتون آزمایشگاه‌ها — پورت وفادار موتور پوستهٔ دانشجویی.
// ورکر Pyodide (v0.26.4 از jsDelivr) + فالبک رشتهٔ اصلی؛ سقف اجرای هر سلول ۱۲۰ ثانیه
// (مصوب معماری فاز ۰؛ پوستهٔ قدیمی ۳۰ ثانیه داشت). بدون service_role، بدون دادهٔ سرور.
import workerSource from './pyodide-worker-source.js?raw'
import {
  CELL_WRAPPER,
  INSPECT_SNIPPET,
  STDOUT_STRUCT_SNIPPET,
  RESET_SNIPPET,
  PACKAGE_FOR_IMPORT
} from './pyodide-snippets.js'

const PYODIDE_BASE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/'
const CELL_TIMEOUT_MS = 120000
const LOAD_TIMEOUT_MS = 120000

let backend = null // 'worker' | 'main' | null
let backendPromise = null
let worker = null
let workerInit = null
let seq = 0
const pending = new Map()
let activeKill = null
let state = 'idle' // idle | loading | ready | failed
const listeners = new Set()

function setState(s) {
  state = s
  listeners.forEach((f) => f(s))
}

export function getState() {
  return state
}

export function onStateChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function stoppedResult(interrupted) {
  return {
    stdout: '',
    stderr: '',
    error: null,
    timeout: true,
    interrupted,
    structured: null,
    variables: []
  }
}

function structFromLiteral(v) {
  if (v === null || v === undefined) return null
  if (Array.isArray(v)) {
    if (v.length === 0) return null
    if (v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
      return v.length >= 3 ? { kind: 'chart', values: v.slice(0, 50) } : null
    }
    if (v.every((x) => Array.isArray(x))) {
      const w = Math.max(...v.map((r) => r.length))
      return {
        kind: 'table',
        columns: Array.from({ length: w }, (_, i) => `خانه ${i + 1}`),
        rows: v
          .slice(0, 20)
          .map((r) => Array.from({ length: w }, (_, i) => (r[i] === undefined ? '' : String(r[i]))))
      }
    }
    if (v.every((x) => x !== null && typeof x === 'object' && !Array.isArray(x))) {
      const cols = []
      for (const d of v)
        for (const k of Object.keys(d)) if (!cols.includes(k)) cols.push(k)
      return {
        kind: 'table',
        columns: cols,
        rows: v.slice(0, 20).map((d) => cols.map((c) => (c in d ? String(d[c]) : '')))
      }
    }
    return {
      kind: 'table',
      columns: ['شماره', 'مقدار'],
      rows: v.slice(0, 20).map((x, i) => [String(i + 1), String(x)])
    }
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v)
    if (entries.length === 0) return null
    if (
      entries.every(([, val]) => Array.isArray(val)) &&
      new Set(entries.map(([, val]) => val.length)).size === 1
    ) {
      const cols = entries.map(([k]) => k)
      const len = entries[0][1].length
      if (len === 0) return null
      return {
        kind: 'table',
        columns: cols,
        rows: Array.from({ length: Math.min(20, len) }, (_, ri) =>
          entries.map(([, val]) => String(val[ri]))
        )
      }
    }
    return {
      kind: 'table',
      columns: ['کلید', 'مقدار'],
      rows: entries.slice(0, 20).map(([k, val]) => [k, String(val)])
    }
  }
  return null
}

function parseInspectPayloads(inspectJson, stdoutLiteralJson, hadError) {
  let variables = []
  let structured = null
  if (inspectJson) {
    try {
      const parsed = JSON.parse(inspectJson)
      variables = Array.isArray(parsed.variables) ? parsed.variables : []
      structured = hadError ? null : (parsed.structured ?? null)
    } catch {
      return { variables: [], structured: null }
    }
  }
  if (!structured && !hadError && stdoutLiteralJson) {
    try {
      structured = structFromLiteral(JSON.parse(stdoutLiteralJson).value)
    } catch {
      structured = null
    }
  }
  return { variables, structured }
}

/* ---- ورکر ---- */
function startWorker() {
  return new Promise((resolve, reject) => {
    let w
    try {
      const blob = new Blob([workerSource], { type: 'application/javascript' })
      w = new Worker(URL.createObjectURL(blob))
    } catch (e) {
      reject(e)
      return
    }
    worker = w
    const timer = setTimeout(() => {
      killWorker()
      reject(new Error('worker init timeout'))
    }, LOAD_TIMEOUT_MS)
    workerInit = {
      resolve: () => {
        clearTimeout(timer)
        resolve()
      },
      reject: (e) => {
        clearTimeout(timer)
        reject(e)
      }
    }
    w.onmessage = (e) => {
      const msg = e.data || {}
      if (msg.type === 'ready') {
        if (workerInit) workerInit.resolve()
        return
      }
      if (msg.type === 'init-error') {
        if (workerInit) workerInit.reject(new Error(msg.message || 'init'))
        return
      }
      const p = pending.get(msg.id)
      if (p) {
        pending.delete(msg.id)
        p(msg)
      }
    }
    w.onerror = () => {
      if (workerInit) workerInit.reject(new Error('worker error'))
    }
    w.postMessage({ type: 'init' })
  })
}

function killWorker() {
  if (worker) {
    try {
      worker.terminate()
    } catch {
      /* noop */
    }
    worker = null
  }
  pending.forEach((res) =>
    res({
      type: 'result',
      stdout: '',
      stderr: '',
      error: null,
      inspectJson: null,
      stdoutLiteralJson: null,
      killed: true
    })
  )
  pending.clear()
}

/* ---- فالبک رشتهٔ اصلی ---- */
let mainApi = null
let mainLoadPromise = null
const mainLoaded = new Set()
let mainOut = []
let mainErr = []

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-pyodide="1"]')
    if (existing) {
      if (window.loadPyodide) resolve()
      else {
        existing.addEventListener('load', resolve)
        existing.addEventListener('error', () => reject(new Error('load')))
      }
      return
    }
    const el = document.createElement('script')
    el.src = src
    el.dataset.pyodide = '1'
    el.onload = resolve
    el.onerror = () => {
      el.remove()
      reject(new Error('load'))
    }
    document.head.appendChild(el)
  })
}

async function loadMain() {
  if (mainApi) return mainApi
  if (mainLoadPromise) return mainLoadPromise
  mainLoadPromise = (async () => {
    await loadScript(PYODIDE_BASE + 'pyodide.js')
    if (!window.loadPyodide) throw new Error('loadPyodide missing')
    const api = await window.loadPyodide({ indexURL: PYODIDE_BASE })
    api.setStdout({ batched: (s) => mainOut.push(s) })
    api.setStderr({ batched: (s) => mainErr.push(s) })
    mainApi = api
    return api
  })().catch((e) => {
    mainLoadPromise = null
    throw e
  })
  return mainLoadPromise
}

function packagesForCode(code, map) {
  const pkgs = new Set()
  const re = /(?:^|\n)\s*(?:import|from)\s+([a-zA-Z_][a-zA-Z0-9_]*)/g
  let m
  while ((m = re.exec(code)) !== null) {
    const n = m[1]
    if (n && map[n]) pkgs.add(map[n])
  }
  return [...pkgs]
}

async function inspectPairMain(api, stdout, hadError) {
  let inspectJson = null
  let stdoutLiteralJson = null
  try {
    let raw = await api.runPythonAsync(INSPECT_SNIPPET)
    if (typeof raw !== 'string') raw = api.globals.get('__muse_inspect_json__')
    if (typeof raw === 'string') inspectJson = raw
  } catch {
    return { inspectJson: null, stdoutLiteralJson: null }
  }
  if (!hadError) {
    let structured = null
    try {
      structured = inspectJson ? JSON.parse(inspectJson).structured : null
    } catch {
      structured = null
    }
    const text = (stdout || '').trim()
    if (!structured && (text.charAt(0) === '[' || text.charAt(0) === '{')) {
      try {
        api.globals.set('_muse_out', text)
        let raw2 = await api.runPythonAsync(STDOUT_STRUCT_SNIPPET)
        if (typeof raw2 !== 'string') raw2 = api.globals.get('__muse_stdout_json__')
        if (typeof raw2 === 'string') stdoutLiteralJson = raw2
      } catch {
        stdoutLiteralJson = null
      }
    }
  }
  return { inspectJson, stdoutLiteralJson }
}

async function ensureEngine() {
  if (backend) return backend
  if (backendPromise) return backendPromise
  setState('loading')
  backendPromise = (async () => {
    try {
      await startWorker()
      backend = 'worker'
      setState('ready')
      return backend
    } catch {
      killWorker()
      try {
        await loadMain()
        backend = 'main'
        setState('ready')
        return backend
      } catch (e) {
        backendPromise = null
        setState('failed')
        throw e
      }
    }
  })()
  return backendPromise
}

export async function runCell(code) {
  let be
  try {
    be = await ensureEngine()
  } catch {
    return {
      engineFailed: true,
      stdout: '',
      stderr: '',
      error: null,
      timeout: false,
      interrupted: false,
      structured: null,
      variables: []
    }
  }
  if (be === 'worker') {
    return new Promise((resolve) => {
      const w = worker
      if (!w) {
        resolve(stoppedResult(false))
        return
      }
      const id = ++seq
      let settled = false
      const finish = (r) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        pending.delete(id)
        activeKill = null
        resolve(r)
      }
      const timer = setTimeout(() => {
        killWorker()
        backend = null
        backendPromise = null
        setState('idle')
        finish(stoppedResult(false))
      }, CELL_TIMEOUT_MS)
      pending.set(id, (msg) => {
        if (msg.type !== 'result' || msg.killed) {
          finish(stoppedResult(false))
          return
        }
        const { variables, structured } = parseInspectPayloads(
          msg.inspectJson,
          msg.stdoutLiteralJson,
          msg.error !== null
        )
        finish({
          stdout: msg.stdout,
          stderr: msg.stderr,
          error: msg.error,
          timeout: false,
          interrupted: false,
          structured,
          variables
        })
      })
      activeKill = () => {
        killWorker()
        backend = null
        backendPromise = null
        setState('idle')
        finish(stoppedResult(true))
      }
      w.postMessage({ type: 'run', id, code })
    })
  }
  /* فالبک رشتهٔ اصلی: همان اسنیپت‌ها، تضمین ضعیف‌تر برای هنگ */
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      activeKill = null
      resolve(stoppedResult(false))
    }, CELL_TIMEOUT_MS)
    activeKill = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      activeKill = null
      resolve(stoppedResult(true))
    }
    ;(async () => {
      const api = await loadMain()
      const needed = packagesForCode(code, PACKAGE_FOR_IMPORT).filter(
        (p) => !mainLoaded.has(p)
      )
      if (needed.length) {
        await api.loadPackage(needed)
        needed.forEach((p) => mainLoaded.add(p))
      }
      mainOut = []
      mainErr = []
      let error = null
      try {
        api.globals.set('_muse_src', code)
        await api.runPythonAsync(CELL_WRAPPER)
      } catch (err) {
        error = err && err.message ? String(err.message) : String(err)
      }
      const stdout = mainOut.join('\n').replace(/\n+$/, '')
      const stderr = mainErr.join('\n').replace(/\n+$/, '')
      const pair = await inspectPairMain(api, stdout, error !== null)
      const { variables, structured } = parseInspectPayloads(
        pair.inspectJson,
        pair.stdoutLiteralJson,
        error !== null
      )
      return {
        stdout,
        stderr,
        error,
        timeout: false,
        interrupted: false,
        structured,
        variables
      }
    })().then(
      (r) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        activeKill = null
        resolve(r)
      },
      () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        activeKill = null
        resolve({
          engineFailed: true,
          stdout: '',
          stderr: '',
          error: null,
          timeout: false,
          interrupted: false,
          structured: null,
          variables: []
        })
      }
    )
  })
}

export async function resetNamespace() {
  const be = backend
  if (be === 'worker' && worker) {
    const id = ++seq
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 15000)
      pending.set(id, () => {
        clearTimeout(timer)
        pending.delete(id)
        resolve()
      })
      worker.postMessage({ type: 'reset', id })
    })
  } else if (be === 'main' && mainApi) {
    try {
      await mainApi.runPythonAsync(RESET_SNIPPET)
    } catch {
      /* noop */
    }
  }
}

export function freshKernel() {
  killWorker()
  backend = null
  backendPromise = null
  if (mainApi) {
    try {
      mainApi = null
      mainLoadPromise = null
      mainLoaded.clear()
    } catch {
      /* noop */
    }
  }
  setState('idle')
}

export function interrupt() {
  if (activeKill) activeKill()
}
