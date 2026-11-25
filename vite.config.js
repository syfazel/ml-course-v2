import { defineConfig, loadEnv } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { execSync, execFileSync } from 'node:child_process'
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
  // گیت کلید کامل (۲۵ نوامبر ۲۰۲۶): بازیابیِ ناقصِ .env.local در
  // ۲۴ نوامبر، کلید publishable را به ۱۵ نویسه («sb_publishable_» خالی)
  // بریده بود و همهٔ گیت‌های «حضور» سبز می‌شدند — در حالی که گیت‌وی
  // سوپابیس هر ورود را با 401 «Invalid API key» رد می‌کرد و کد قدیمی
  // همان 401 را «نشست منقضی شده» نشان می‌داد. کلید کامل یا
  // sb_publishable_ با دست‌کم ۲۰ نویسهٔ بعدش است، یا JWT قدیمیِ بلند؛
  // کوتاه‌تر از آن، بیلد متوقف می‌شود و هرگز دیپلوی نمی‌شود.
  const key = (process.env.VITE_SUPABASE_PUBLISHABLE_KEY || fileEnv.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim()
  const looksFull =
    /^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key) ||
    /^eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}$/.test(key)
  if (!looksFull) {
    throw new Error(
      '[build-gate] FAIL: ‏VITE_SUPABASE_PUBLISHABLE_KEY کامل نیست ' +
        `(طول ${key.length} نویسه؛ کلید کامل sb_publishable_ دست‌کم ۳۵ نویسه است). ` +
        'کلید ناقص، ورود را با 401 گیت‌وی می‌شکند (حادثهٔ ۲۵ نوامبر ۲۰۲۶). ' +
        'کلید کامل را از داشبورد Supabase یا تاریخ gh-pages بازیابی کن، بعد بیلد بگیر.'
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

function pilotGatewayCommit() {
  // فاز ۴ (D5): کامیت گیت‌وی در مانیفست — HEAD شاخهٔ main ریپوی پایلوتِ
  // کنار همین ریپو در زمان بیلد (نه HEAD شاخهٔ جاری: روی برنچِ فاز،
  // HEAD کدِ مرج‌نشده است و ثبت آن دروغ می‌شود — R-12). اگر ریپوی
  // پایلوت نیست یا main ندارد، صادقانه 'unknown' می‌ماند (هرگز حدس
  // زده نمی‌شود)؛ نسخهٔ واقعاً در حال اجرا را /status گیت‌وی (G4)
  // گزارش می‌کند و صفحهٔ وضعیت آن را نشان می‌دهد.
  // توجه: این کامیتِ کدِ مرج‌شده است؛ با ری‌استارت بعدی Codespace
  // فعال می‌شود، نه با همین دیپلوی فرانت‌اند.
  try {
    const root = resolve(process.cwd(), '..', 'jarvis-studio-pilot')
    const head = execFileSync('git', ['-C', root, 'rev-parse', '--short', 'main'], {
      encoding: 'utf8'
    }).trim()
    return /^[0-9a-f]+$/.test(head) ? head : 'unknown'
  } catch {
    return 'unknown'
  }
}

function versionPlugin(appHash) {
  return {
    name: 'app-version',
    closeBundle() {
      const outDir = resolve(process.cwd(), 'dist')
      mkdirSync(outDir, { recursive: true })
      writeFileSync(
        resolve(outDir, 'version.json'),
        // Phase 0 + Phase 4 — extended manifest: wakeVersion is the
        // deployed wake Edge Function version (manual); gatewayCommit is
        // the pilot repo HEAD at build time ('unknown' if the pilot repo
        // is not beside this repo — never guessed).
        JSON.stringify({ hash: appHash, commit: appHash, builtAt: BUILT_AT, wakeVersion: 'v5', gatewayCommit: pilotGatewayCommit() }, null, 2)
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
