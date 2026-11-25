// مدیریت رویدادهای نشست — تک‌منبع (بازسازی ۲۵ نوامبر ۲۰۲۶).
//
// تنها منبع حقیقتِ نشست، ذخیرهٔ خودِ supabase-js است
// (کلید ml-course-v2-auth) با autoRefreshToken. هیچ stash دستی و هیچ
// refresh دوم با refresh_tokenِ ذخیره‌شدهٔ جدا نیست — و این حذف، خودِ
// رفع اشکال است:
//   - با چرخش refresh token، دو تازه‌کنندهٔ هم‌زمان با یک توکن مسابقه
//     می‌دادند؛ بازنده توکنِ کهنه را بازپخش می‌کرد و Supabase خانوادهٔ
//     نشست را واقعاً می‌سوزاند (refresh_token_not_found) — یعنی کدِ
//     خودمان نشستِ سالم را می‌کشت و بعد «نشست منقضی شده» نشان می‌داد.
//   - هر SIGNED_OUTِ سرخود (تازه‌سازیِ ناموفق در اینترنت ناپایدار،
//     تب دوم) با stash کهنه بازیابی می‌شد، شکست می‌خورد و به دیوار
//     «منقضی شده» + دکمهٔ دستیِ «پاک‌کردن نشست کهنه» می‌رسید —
//     یک مانع دستیِ اضافه سر راه ورود.
// حالا SIGNED_OUT — دستی یا پایان واقعی نشست — فقط فرم سادهٔ ورود است:
// بدون تلاش بازیابی، بدون دیوار خطا، بدون قدم دستی. نشستِ کهنه را
// auth.js در همان مسیرِ انقضای واقعی، خودش و بی‌صدا پاک می‌کند.

export async function handleAuthEvent(event, session, deps) {
  const { onUser, onSignedOut, onRecovery } = deps

  if (event === 'PASSWORD_RECOVERY') {
    if (onRecovery) await onRecovery(session)
    return
  }

  if (event === 'SIGNED_OUT') {
    if (onSignedOut) await onSignedOut()
    return
  }

  if (session && session.user) {
    if (onUser) await onUser(session.user, session)
    return
  }

  // INITIAL_SESSION بدون نشست و بقیهٔ رویدادها: کاری نیست؛
  // initAuth با getSession تصمیم می‌گیرد و فرم ورود نشان داده می‌شود.
}
