#!/usr/bin/env bash
# pre-deploy-check.sh — گیت‌های پیش‌دیپلوی (فاز ۱، قوانین R-3 و R-5).
#
# چه چیزی را چک می‌کند (هر مورد با FAIL متوقف می‌شود):
#   1. درخت گیت تمیز است (دیپلوی فقط از کامیت، نه از تغییرهای ثبت‌نشده).
#   2. dist ساخته شده و version.json + index.html دارد؛ هش version.json
#      دقیقاً برابر هش HEAD است.
#   3. کانفیگ Supabase در باندل پخته شده است: باندل باید URL سوپابیس را
#      داشته باشد (اثبات اینکه بیلد با .env.local انجام شد، نه بدون آن —
#      حادثهٔ ۱۷:۴۰ که بیلد بدون env سبز شد و ورود ۱۱ دقیقه مرد).
#      مقدار URL هرگز چاپ نمی‌شود؛ فقط grep -q.
#   4. همهٔ فایل‌های public/ در dist حضور دارند (سینک ناقص dist که
#      رسانه‌های افتتاحیه را ۴۰۴ کرد، دیگر ممکن نیست).
#   5. مقصد دقیقاً ورک‌تری دیپلوی است (شاخهٔ gh-pages، همان origin)؛
#      در حالت dry-run، مقصد باید یک پوشهٔ اسکرچِ ساده باشد، نه یک ریپو.
#
# استفاده:
#   scripts/pre-deploy-check.sh
#   DEPLOY_DIR=/path/to/scratch PRE_CHECK_DRY_RUN=1 scripts/pre-deploy-check.sh
#
# هیچ‌چیز را نمی‌نویسد، پوش نمی‌کند و دیپلوی نمی‌کند — فقط چک می‌کند.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ ! -f "$ROOT/vite.config.js" ] || [ ! -f "$ROOT/package.json" ] || [ ! -d "$ROOT/.git" ]; then
  echo "[pre-deploy-check] FAIL: این اسکریپت از جای اشتباه اجرا شد — ریشهٔ ریپوی فرانت‌اند پیدا نشد: $ROOT" >&2
  exit 1
fi

DEPLOY_DIR="${DEPLOY_DIR:-$HOME/workspace/ml-course-v2-deploy}"
DRY_RUN="${PRE_CHECK_DRY_RUN:-0}"
SITE_ORIGIN_EXPECTED="github.com/syfazel/ml-course-v2"

fail() { echo "[pre-deploy-check] FAIL: $*" >&2; exit 1; }
ok()   { echo "[pre-deploy-check] OK: $*"; }

# 1. درخت تمیز
if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  fail "درخت گیت کثیف است — دیپلوی فقط از درخت تمیز."
fi
HEAD="$(git -C "$ROOT" rev-parse --short HEAD)"
ok "درخت تمیز، HEAD=$HEAD"

# 2. dist + version.json
[ -f "$ROOT/dist/version.json" ] || fail "dist/version.json نیست — اول npm run build."
[ -f "$ROOT/dist/index.html" ] || fail "dist/index.html نیست."
SERVED_HASH="$(sed -n 's/.*"hash"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT/dist/version.json" | head -n 1)"
[ -n "$SERVED_HASH" ] || fail "هش در dist/version.json خوانده نشد."
[ "$SERVED_HASH" = "$HEAD" ] || fail "هش version.json ($SERVED_HASH) با HEAD ($HEAD) نمی‌خواند."
ok "version.json هش $HEAD را دارد"

# 3. کانفیگ در باندل پخته شده است
EXPECTED_URL="${VITE_SUPABASE_URL:-}"
if [ -z "$EXPECTED_URL" ] && [ -f "$ROOT/.env.local" ]; then
  EXPECTED_URL="$(sed -n 's/^VITE_SUPABASE_URL=//p' "$ROOT/.env.local" | head -n 1 | tr -d '\r' | sed 's/^["'\'']//;s/["'\'']$//')"
fi
[ -n "$EXPECTED_URL" ] || fail "VITE_SUPABASE_URL نه در محیط است نه در .env.local."
BUNDLE="$(ls "$ROOT"/dist/assets/index-*.js 2>/dev/null | head -n 1)"
[ -n "$BUNDLE" ] || fail "باندل index-*.js در dist/assets پیدا نشد."
if ! grep -qF "$EXPECTED_URL" "$BUNDLE"; then
  fail "باندل کانفیگ Supabase را ندارد (URL در $(basename "$BUNDLE") پیدا نشد) — بیلد بدون env بوده است."
fi
ok "کانفیگ Supabase در باندل $(basename "$BUNDLE") پخته شده است"

# 3b. کلید کامل در باندل است (۲۵ نوامبر ۲۰۲۶): کلید ناقصِ ۱۵ نویسه‌ایِ
# «sb_publishable_» هم در باندل بود و همهٔ چک‌ها را رد می‌کرد، ولی
# گیت‌وی هر ورود را با 401 «Invalid API key» می‌زد. باندل باید یک
# کلید کامل (sb_publishable_ با دست‌کم ۲۰ نویسهٔ بعدش، یا JWT بلند)
# داشته باشد؛ وگرنه دیپلوی متوقف می‌شود. مقدار کلید هرگز چاپ نمی‌شود.
if ! grep -qE 'sb_publishable_[A-Za-z0-9_-]{20,}' "$BUNDLE" && ! grep -qE 'eyJ[A-Za-z0-9_-]{100,}\.eyJ[A-Za-z0-9_-]{100,}\.' "$BUNDLE"; then
  fail "باندل کلید publishable کامل ندارد (فقط پیشوند کوتاه) — ورود با 401 گیت‌وی می‌شکند. کلید کامل را بازیابی کن و دوباره بیلد بگیر."
fi
ok "کلید publishable کامل در باندل $(basename "$BUNDLE") هست"

# 4. همهٔ فایل‌های public/ در dist هستند
MISSING=0
while IFS= read -r -d '' f; do
  # find از داخل $ROOT اجرا می‌شود، پس f شکل public/... دارد.
  rel="${f#public/}"
  if [ ! -f "$ROOT/dist/$rel" ]; then
    echo "[pre-deploy-check] FAIL: فایل public/$rel در dist نیست." >&2
    MISSING=1
  fi
done < <(cd "$ROOT" && find public -type f -print0)
[ "$MISSING" = 0 ] || fail "فایل‌های public در dist ناقص‌اند."
ok "همهٔ فایل‌های public/ در dist حضور دارند"

# 5. مقصد
if [ "$DRY_RUN" = "1" ]; then
  [ -d "$DEPLOY_DIR" ] || fail "پوشهٔ اسکرچ dry-run نیست: $DEPLOY_DIR"
  # «داخل ریپوی گیت بودن» را با خودِ گیت می‌سنجیم، نه با وجود فایل .git:
  # اسکرچِ تست، عمداً یک فایل .git نگهبان دارد تا exclude ِ rsync اثبات
  # شود — آن فایل به هیچ gitdir واقعی اشاره نمی‌کند و rev-parse ردش می‌کند.
  if git -C "$DEPLOY_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    fail "مقصد dry-run داخل یک ریپوی گیت است ($DEPLOY_DIR) — اسکرچ باید پوشهٔ ساده باشد."
  fi
  ok "مقصد dry-run یک پوشهٔ اسکرچ ساده است: $DEPLOY_DIR"
else
  DEPLOY_REAL="$(readlink -f "$DEPLOY_DIR" 2>/dev/null || echo "$DEPLOY_DIR")"
  EXPECTED_REAL="$(readlink -f "$HOME/workspace/ml-course-v2-deploy" 2>/dev/null || echo "$HOME/workspace/ml-course-v2-deploy")"
  [ "$DEPLOY_REAL" = "$EXPECTED_REAL" ] || fail "مقصد دیپلوی باید دقیقاً $EXPECTED_REAL باشد، نه $DEPLOY_DIR."
  [ -e "$DEPLOY_DIR/.git" ] || fail "مقصد ورک‌تری گیت نیست (.git ندارد): $DEPLOY_DIR"
  BRANCH="$(git -C "$DEPLOY_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  [ "$BRANCH" = "gh-pages" ] || fail "شاخهٔ مقصد باید gh-pages باشد، نه $BRANCH."
  ORIGIN_URL="$(git -C "$DEPLOY_DIR" config --get remote.origin.url 2>/dev/null || echo '')"
  case "$ORIGIN_URL" in
    *"$SITE_ORIGIN_EXPECTED"*) ;;
    *) fail "origin مقصد باید $SITE_ORIGIN_EXPECTED باشد، نه $ORIGIN_URL." ;;
  esac
  ok "مقصد ورک‌تری دیپلوی است (gh-pages، $SITE_ORIGIN_EXPECTED)"
fi

echo "[pre-deploy-check] ALL CHECKS PASSED"
