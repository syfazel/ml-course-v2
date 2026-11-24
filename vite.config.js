import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// Phase R0 — build version: the running bundle embeds this hash and every
// build also emits public/version.json with the same hash, so the app can
// detect a newer deploy and hard-reload instead of running a stale bundle
// (the 2026-11-24 18:54 failure: in-app navigation never reloads the JS).
function buildHash() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim()
  } catch {
    return `dev-${Date.now().toString(36)}`
  }
}

const APP_HASH = buildHash()
const BUILT_AT = new Date().toISOString()

function versionPlugin() {
  return {
    name: 'app-version',
    closeBundle() {
      const outDir = resolve(process.cwd(), 'dist')
      mkdirSync(outDir, { recursive: true })
      writeFileSync(
        resolve(outDir, 'version.json'),
        JSON.stringify({ hash: APP_HASH, commit: APP_HASH, builtAt: BUILT_AT }, null, 2)
      )
    }
  }
}

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(APP_HASH)
  },
  plugins: [tailwindcss(), svelte(), versionPlugin()]
})
