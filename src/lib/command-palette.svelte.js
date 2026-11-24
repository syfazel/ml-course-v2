// وضعیت مشترک پالت فرمان Ctrl+K — یک مسیر باز کردن برای میانبور
// صفحه‌کلید (Ctrl+K / ⌘K) و دکمهٔ لمسی سایدبار؛ پالت فقط در چیدمانِ
// واردشده mount می‌شود، پس در صفحهٔ ورود و داخل استودیو اصلاً وجود ندارد.
// باز کردن با دکمه دقیقاً همان تابع باز کردن با میانبور را صدا می‌زند.
export const paletteState = $state({ open: false })

export function openPalette() {
  paletteState.open = true
}

export function closePalette() {
  paletteState.open = false
}
