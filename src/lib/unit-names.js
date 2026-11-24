// فاز ۴ (F12): نام نمایشی واحد به‌جای کد خام در متن نمایشی.
// unit_code در دیتابیس: 'day-0' یا 'lesson-{n}'؛ نام نمایشی همان الگوی
// سایدبار است: «کد — عنوان». کد ناشناخته بدون اختراع نام، همان‌طور که
// هست نشان داده می‌شود (نه نام ساختگی).
import { COURSE_CONTENT } from '../data/course-content.js'

export function unitDisplayName(unitCode) {
  if (!unitCode) return '—'
  let id = null
  if (unitCode === 'day-0') id = 0
  else {
    const m = String(unitCode).match(/^lesson-(\d+)$/)
    if (m) id = Number(m[1])
  }
  if (id === null) return unitCode
  const unit = (COURSE_CONTENT.units || []).find((u) => u.id === id)
  if (!unit) return unitCode
  return `${unit.code} — ${unit.title}`
}
