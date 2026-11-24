#!/usr/bin/env bash
# deploy.sh — تنها راه مجاز دیپلوی فرانت‌اند به GitHub Pages (فاز ۱، قانون R-5).
#
# ترتیب: بیلد (با گیت‌های vite.config.js) → pre-deploy-check → تست دود
# پیش‌دیپلوی (فاز ۵، F11: بیلد واقعاً در مرورگر بالا می‌آید) → در ورک‌تری
# دیپلوی: fetch origin/gh-pages + ریست (جلوگیری از non-fast-forward از
# gh-pages کهنهٔ محلی) → rsync → کامیت → پوش → curl پس از پوش با صبر
# ۱۲۰ ثانیه‌ای و تطبیق هش باندل و version.json.
#
# درس فاز ۰ — rsync حتماً این دو exclude را دارد:
#   --exclude=.git --exclude=.gitignore
# ورک‌تری دیپلوی یک worktree لینک‌شده است؛ فایل `.git` آن یک اشاره‌گر
# متنی (gitdir:) است، نه پوشه. rsync بدون این excludeها، با --delete،
# آن اشاره‌گر (و .gitignore) را پاک می‌کند و worktree با
# «not a git repository» می‌میرد — دقیقاً همان اتفاقی که در دیپلوی فاز ۰
# افتاد و با بازسازی دستی فایل اشاره‌گر رفع شد. هرگز این دو exclude را
# برندار.
#
# استفاده:
#   scripts/deploy.sh                  # دیپلوی واقعی به gh-pages
#   scripts/deploy.sh --dry-run DIR    # تا مرحلهٔ پوش، بدون پوش واقعی:
#                                      # بیلد + چک‌ها + rsync به پوشهٔ
#                                      # اسکرچ DIR + راستی‌آزمایی همان
#                                      # خروجی با همان منطق curl.
#                                      # هیچ fetch/commit/push انجام نمی‌شود.
#
# این اسکریپت فقط از داخل ریپوی فرانت‌اند اجرا می‌شود؛ کپی آن در جای
# دیگر یا اجرا از مسیر اشتباه رد می‌شود.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ ! -f "$ROOT/vite.config.js" ] || [ ! -f "$ROOT/package.json" ] || [ ! -d "$ROOT/.git" ]; then
  echo "[deploy] FAIL: این اسکریپت از جای اشتباه اجرا شد — ریشهٔ ریپوی فرانت‌اند پیدا نشد: $ROOT" >&2
  exit 1
fi

SITE_URL="https://syfazel.github.io/ml-course-v2"
DEPLOY_DIR="$HOME/workspace/ml-course-v2-deploy"
DRY_RUN=0
SCRATCH_DIR=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      SCRATCH_DIR="${2:-}"
      [ -n "$SCRATCH_DIR" ] || { echo "[deploy] FAIL: --dry-run یک پوشهٔ اسکرچ می‌خواهد." >&2; exit 1; }
      shift 2 ;;
    *)
      echo "[deploy] FAIL: آرگومان ناشناخته: $1 (فقط --dry-run DIR)" >&2
      exit 1 ;;
  esac
done

fail() { echo "[deploy] FAIL: $*" >&2; exit 1; }
ok()   { echo "[deploy] OK: $*"; }

# 1. بیلد — گیت‌های env و درخت تمیز در vite.config.js اجرا می‌شوند.
echo "[deploy] مرحلهٔ ۱/۵: بیلد…"
(cd "$ROOT" && npm run build) || fail "بیلد ناموفق بود."
HEAD="$(git -C "$ROOT" rev-parse --short HEAD)"
ok "بیلد سبز، HEAD=$HEAD"

# 2. گیت‌های پیش‌دیپلوی
echo "[deploy] مرحلهٔ ۲/۵: pre-deploy-check…"
if [ "$DRY_RUN" = "1" ]; then
  mkdir -p "$SCRATCH_DIR"
  DEPLOY_DIR="$SCRATCH_DIR" PRE_CHECK_DRY_RUN=1 "$ROOT/scripts/pre-deploy-check.sh" || fail "pre-deploy-check رد شد."
else
  "$ROOT/scripts/pre-deploy-check.sh" || fail "pre-deploy-check رد شد."
fi

# 2.5. تست دود پیش‌دیپلوی (فاز ۵، F11): بیلدِ ساخته‌شده واقعاً در مرورگر
# بالا می‌آید — خانه، ورود، #/status، #/intro-test. بدون نشست/توکن واقعی؛
# در dry-run هم اجرا می‌شود (فقط dist محلی را سرو می‌کند، هیچ پوشی نیست).
echo "[deploy] مرحلهٔ ۲/۵ (دود): smoke_predeploy…"
node "$ROOT/tests/smoke_predeploy.mjs" || fail "تست دود پیش‌دیپلوی رد شد."

BUNDLE="$(basename "$(ls "$ROOT"/dist/assets/index-*.js | head -n 1)")"

if [ "$DRY_RUN" = "1" ]; then
  # --- dry-run: rsync به اسکرچ، بدون fetch/commit/push ---
  echo "[deploy] مرحلهٔ ۳/۵ (dry-run): rsync به اسکرچ…"
  # درس فاز ۰: این دو exclude اشاره‌گر .git ورک‌تری را زنده نگه می‌دارند.
  rsync -a --delete --exclude=.git --exclude=.gitignore "$ROOT/dist/" "$SCRATCH_DIR/" \
    || fail "rsync به اسکرچ ناموفق بود."
  ok "rsync به $SCRATCH_DIR انجام شد"

  echo "[deploy] مرحلهٔ ۴/۵ (dry-run): راستی‌آزمایی خروجی اسکرچ با همان منطق curl…"
  SCRATCH_HASH="$(curl -fsSL "file://$SCRATCH_DIR/version.json" | sed -n 's/.*"hash"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
  [ "$SCRATCH_HASH" = "$HEAD" ] || fail "هش version.json اسکرچ ($SCRATCH_HASH) با HEAD ($HEAD) نمی‌خواند."
  [ -f "$SCRATCH_DIR/assets/$BUNDLE" ] || fail "باندل $BUNDLE در اسکرچ نیست."
  [ -f "$SCRATCH_DIR/index.html" ] || fail "index.html در اسکرچ نیست."
  ok "اسکرچ: version.json هش $HEAD، باندل $BUNDLE و index.html حاضرند"
  echo "[deploy] DRY-RUN OK — هیچ fetch/commit/push انجام نشد. برای دیپلوی واقعی: scripts/deploy.sh"
  exit 0
fi

# --- دیپلوی واقعی ---
echo "[deploy] مرحلهٔ ۳/۵: تازه‌کردن ورک‌تری دیپلوی (fetch + reset)…"
git -C "$DEPLOY_DIR" fetch origin gh-pages || fail "git fetch origin gh-pages ناموفق بود."
git -C "$DEPLOY_DIR" reset --hard origin/gh-pages || fail "git reset به origin/gh-pages ناموفق بود."
ok "ورک‌تری دیپلوی با origin/gh-pages هماهنگ شد"

echo "[deploy] مرحلهٔ ۴/۵: rsync + کامیت + پوش…"
# درس فاز ۰: این دو exclude اشاره‌گر .git ورک‌تری را زنده نگه می‌دارند.
rsync -a --delete --exclude=.git --exclude=.gitignore "$ROOT/dist/" "$DEPLOY_DIR/" \
  || fail "rsync به ورک‌تری دیپلوی ناموفق بود."
(cd "$DEPLOY_DIR" && git add -A)
if [ -n "$(git -C "$DEPLOY_DIR" status --porcelain)" ]; then
  git -C "$DEPLOY_DIR" commit -m "Deploy $HEAD (frontend $HEAD)" \
    || fail "کامیت دیپلوی ناموفق بود."
  ok "کامیت دیپلوی ثبت شد"
else
  ok "تغییری برای کامیت نبود (همان هش زنده است)"
fi
git -C "$DEPLOY_DIR" push origin gh-pages || fail "پوش به gh-pages ناموفق بود."
DEPLOY_COMMIT="$(git -C "$DEPLOY_DIR" rev-parse --short HEAD)"
ok "پوش شد، gh-pages=$DEPLOY_COMMIT"

# 5. راستی‌آزمایی زنده: صبر تا ۱۲۰ ثانیه، هر ۱۰ ثانیه یک بار.
echo "[deploy] مرحلهٔ ۵/۵: راستی‌آزمایی زنده (تا ۱۲۰ ثانیه صبر برای Pages)…"
ATTEMPT=0
while [ "$ATTEMPT" -lt 12 ]; do
  ATTEMPT=$((ATTEMPT + 1))
  LIVE_HASH="$(curl -fsSL --max-time 15 "$SITE_URL/version.json?v=$HEAD" 2>/dev/null | sed -n 's/.*"hash"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1 || true)"
  if [ "$LIVE_HASH" = "$HEAD" ]; then
    BUNDLE_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SITE_URL/assets/$BUNDLE" || echo '000')"
    INDEX_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$SITE_URL/" || echo '000')"
    if [ "$BUNDLE_CODE" = "200" ] && [ "$INDEX_CODE" = "200" ]; then
      ok "زنده: version.json هش $HEAD، باندل $BUNDLE ‏۲۰۰، index ‏۲۰۰ (تلاش $ATTEMPT)"
      echo "[deploy] DEPLOY OK — $SITE_URL (frontend $HEAD, gh-pages $DEPLOY_COMMIT)"
      exit 0
    fi
    echo "[deploy] هش درست شد ولی باندل/index هنوز ۲۰۰ نیست (باندل=$BUNDLE_CODE، index=$INDEX_CODE) — ادامهٔ صبر…" >&2
  fi
  [ "$ATTEMPT" -lt 12 ] && sleep 10
done
fail "پس از ۱۲۰ ثانیه، version.json زنده هش $HEAD را نشان نداد (آخرین مقدار دیده‌شده: ${LIVE_HASH:-هیچ}). دیپلوی پوش شد ولی تأیید زنده نشد — وضعیت را دستی بررسی کن."
