// وضعیت دروازه‌های ۸ فاز — میانگین دقیق بهترین نمرهٔ آزمون‌های نمره‌دار فاز.
// قانون: دروازه با میانگین دقیق ≥ ۶۰٫۰٪ باز است (۵۹٫۹٪ بسته می‌ماند).
// این محاسبه فقط «وضعیت» را نشان می‌دهد؛ اجرای قفل سخت روی درس‌های فاز بعد
// تصمیم استاد است و در فاز ۲ پیاده نشده است (نگاه کنید به گزارش فاز ۲).

import { COURSE_CONTENT } from '../data/course-content.js'

export const GATE_PCT = 60.0

// کد آزمون درس B شماره n: quiz-{n}-B
export function quizCodeForLessonNumber(n) {
  return `quiz-${n}-B`
}

// بهترین نمرهٔ هر آزمون از روی همهٔ تلاش‌ها
export function bestScoresByQuiz(allAttempts) {
  const best = {}
  for (const a of allAttempts || []) {
    const s = Number(a.score_percent)
    if (Number.isNaN(s)) continue
    if (best[a.quiz_code] === undefined || s > best[a.quiz_code]) {
      best[a.quiz_code] = s
    }
  }
  return best
}

// وضعیت هر فاز: { phase, displayTitle, quizCodes, attempted, total, avg, open }
export function computeGates(allAttempts) {
  const best = bestScoresByQuiz(allAttempts)
  return COURSE_CONTENT.phases.map((p) => {
    const quizCodes = []
    // lessonFrom/lessonTo شناسهٔ واحدند؛ درس‌های B شناسهٔ زوج دارند
    for (let u = p.lessonFrom; u <= p.lessonTo; u++) {
      if (u % 2 === 0) quizCodes.push(quizCodeForLessonNumber(u / 2))
    }
    const scores = quizCodes.map((c) => best[c]).filter((v) => v !== undefined)
    const avg = scores.length
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : null
    return {
      phase: p.phase,
      displayTitle: p.displayTitle,
      quizCodes,
      attempted: scores.length,
      total: quizCodes.length,
      avg,
      open: avg !== null && avg >= GATE_PCT
    }
  })
}

// فاز یک واحد (از روی شناسهٔ واحد ۰ تا ۵۴)
export function phaseOfUnit(unitId) {
  const unit = COURSE_CONTENT.units.find((u) => u.id === unitId)
  return unit ? unit.phase : 0
}
