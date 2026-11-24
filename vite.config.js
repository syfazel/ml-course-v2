import { defineConfig, loadEnv } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Phase R0 — build version: the running bundle embeds this hash and every
// build also emits public/version.json with the same hash, so the app can
// detect a newer deploy and hard-reload instead of running a stale bundle
// (the 2026-11-24 18:54 failure: in-app navigation never reloads the JS).

// Phase 1 — build gates (R-3, R-5). Two hard failures, both with an
// explicit message instead of a green build that breaks at runtime:
//   1. Missing Supabase config: without VITE_SUPABASE_URL /
//      VITE_SUPABASE_PUBLISHABLE_KEY the app builds with sb = null and the
//      login is dead for ~11 minutes (the 2026-11-24 17:40 incident).
//      A build without config must not build at all.
//   2. Dirty git tree / unknown commit: version.json must identify the
//      exact committed source. A hash of an uncommitted tree (or a fake
//      dev-… hash) is a lie the deploy can no longer tell, so the build
//      fails instead of stamping it.
// Both gates apply to `vite build` only; `vite dev` keeps working locally
// (the app itself shows the yellow "server not configured" banner there).
const REQUIRED_ENV = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY']

function checkBuildEnv(mode) {
  // loadEnv reads .env.local / .env.* the same way Vite does; environment
  // variables (CI) win over the file. Values are only checked for presence
  // and shape — never printed.
  const fileEnv = loadEnv(mode, process.cwd(), '')
  const missing = []
  for (const key of REQUIRED_ENV) {
    const value = (process.env[key] || fileEnv[key] || '').trim()
    if (!value) missing.push(key)
  }
  if (missing.length > 0) {
    throw new Error(
      `[build-gate] FAIL: پیکربندی Supabase نیست — متغیرهای لازم خالی‌اند: ${missing.join(', ')}. ` +
        'بیلد بدون .env.local (یا متغیر محیطی) متوقف شد؛ بیلدِ بدون کانفیگ، ورود را خراب می‌کند (حادثهٔ ۱۷:۴۰، ۲۴ نوامبر ۲۰۲۶).'
    )
  }
  const url = (process.env.VITE_SUPABASE_URL || fileEnv.VITE_SUPABASE_URL || '').trim()
  if (!/^https?:\/\/.+\..+/.test(url)) {
    throw new Error(
      '[build-gate] FAIL: ‏VITE_SUPABASE_URL یک URL معتبر نیست (باید با http(s):// شروع شود).'
    )
  }
}

function buildHash() {
  // Only a clean tree gets a hash. Dirty tree or a non-git directory is a
  // build failure, not a "-dirty" stamp: version.json must point at one
  // exact commit, or the deploy cannot be traced back to its source.
  let head
  try {
    head = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    throw new Error(
      '[build-gate] FAIL: هش نسخه از گیت خوانده نشد (این پوشه یک ریپوی گیت نیست یا گیت در دسترس نیست).'
    )
  }
  if (!/^[0-9a-f]+$/.test(head)) {
    throw new Error(`[build-gate] FAIL: هش گیت نامعتبر برگشت: ${head}`)
  }
  let dirty = ''
  try {
    dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim()
  } catch {
    throw new Error('[build-gate] FAIL: وضعیت درخت گیت خوانده نشد.')
  }
  if (dirty) {
    const firstLines = dirty.split('\n').slice(0, 5).join('; ')
    throw new Error(
      '[build-gate] FAIL: درخت گیت کثیف است — بیلد فقط از درخت تمیز انجام می‌شود ' +
        `(تغییرهای کامیت‌نشده: ${firstLines}${dirty.split('\n').length > 5 ? '…' : ''}). ` +
        'اول کامیت کن، بعد بیلد بگیر.'
    )
  }
  return head
}

const BUILT_AT = new Date().toISOString()

function versionPlugin(appHash) {
  return {
    name: 'app-version',
    closeBundle() {
      const outDir = resolve(process.cwd(), 'dist')
      mkdirSync(outDir, { recursive: true })
      writeFileSync(
        resolve(outDir, 'version.json'),
        // Phase 0 — extended manifest: wakeVersion is the deployed wake Edge
        // Function version (manual until phase 1 automates it); gatewayCommit
        // is "unknown" because the running Gateway reports only a static
        // version string, not its commit (G4 — fixed in phase 2). Never guess.
        JSON.stringify({ hash: appHash, commit: appHash, builtAt: BUILT_AT, wakeVersion: 'v5', gatewayCommit: 'unknown' }, null, 2)
      )
    }
  }
}

export default defineConfig(({ command, mode }) => {
  let appHash = 'dev'
  if (command === 'build') {
    checkBuildEnv(mode)
    appHash = buildHash()
  }
  return {
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(appHash)
    },
    plugins: [tailwindcss(), svelte(), versionPlugin(appHash)]
  }
})
