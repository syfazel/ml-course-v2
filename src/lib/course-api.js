// لایه ارتباط با جداول SQL نسخه ۲ (day_progress، quiz_answers، mistakes، events، audit_logs)
// و تابع RPC سروری submit_quiz_attempt(text, jsonb).

import { sb } from './supabase.js'
import { auth } from './auth-store.svelte.js'
import {
  isSessionExpiredError,
  isUnauthorizedError,
  SESSION_EXPIRED_MESSAGE
} from './auth-errors.js'
import { refreshSessionOnce } from './auth.js'

// (۲۵ نوامبر ۲۰۲۶) 401 روی خواندن/نوشتن داده، نشست را پاک نمی‌کند:
// توکن ممکن است در همان لحظه در حال چرخش باشد. یک refresh در پس‌زمینه
// امتحان می‌شود و خطا فقط همان فراخوانی را برمی‌گرداند — کاربر وارد
// مانده و تلاش بعدی با توکن تازه انجام می‌شود. فقط مرگ صریحِ
// refresh token (isSessionExpiredErrorِ محدودشده) نشست را می‌بندد.
function handleApiError(error, fallbackMessage) {
  if (isSessionExpiredError(error)) {
    auth.resetSession({ expired: true, notice: SESSION_EXPIRED_MESSAGE })
    return SESSION_EXPIRED_MESSAGE
  }
  if (isUnauthorizedError(error)) {
    void refreshSessionOnce().catch(() => {})
    return 'دسترسی به سرور در این لحظه برقرار نشد؛ دوباره تلاش کنید.'
  }
  return error?.message || fallbackMessage
}

// ---------- پیشرفت درس روز ۰ (day_progress) ----------
export async function fetchDayProgress(unitCode = 'day-0') {
  if (!sb || !auth.canOperate) return { data: null, error: null }
  let query = sb
    .from('day_progress')
    .select('id, user_id, unit_code, status, completed_steps, score_exact, started_at, completed_at, updated_at')
    .eq('unit_code', unitCode)

  if (auth.isStudent) {
    query = query.eq('user_id', auth.user.id)
  }

  const { data, error } = await query.maybeSingle()
  if (error) {
    return { data: null, error: handleApiError(error, 'خواندن پیشرفت درس ناموفق بود.') }
  }
  return { data: data || null, error: null }
}

export async function saveDayProgress({ unitCode = 'day-0', completedSteps = [], status = 'in_progress' }) {
  if (!sb || !auth.canOperate) {
    return { data: null, error: 'نشست معتبر برای ذخیره پیشرفت وجود ندارد.' }
  }
  // طبق قانون RLS: فقط شاگرد در day_progress می‌نویسد (استاد فقط پیش‌نمایش دارد)
  if (!auth.isStudent) {
    return { data: null, error: null, readOnlyPreview: true }
  }

  const now = new Date().toISOString()
  const payload = {
    user_id: auth.user.id,
    unit_code: unitCode,
    status,
    completed_steps: completedSteps,
    completed_at: status === 'completed' ? now : null,
    updated_at: now
  }

  const { data, error } = await sb
    .from('day_progress')
    .upsert(payload, { onConflict: 'user_id,unit_code' })
    .select('id, user_id, unit_code, status, completed_steps, score_exact, started_at, completed_at, updated_at')
    .single()

  if (error) {
    return { data: null, error: handleApiError(error, 'ذخیره پیشرفت درس ناموفق بود.') }
  }
  return { data, error: null }
}

// ---------- همهٔ ردیف‌های پیشرفت (فاز ۲: سایدبار + دروازه‌ها) ----------
export async function fetchAllDayProgress() {
  if (!sb || !auth.canOperate) return { data: [], error: null }
  const { data, error } = await sb
    .from('day_progress')
    .select('id, user_id, unit_code, status, completed_steps, score_exact, started_at, completed_at, updated_at')
    .order('unit_code', { ascending: true })
  if (error) {
    return { data: [], error: handleApiError(error, 'خواندن پیشرفت درس‌ها ناموفق بود.') }
  }
  return { data: data || [], error: null }
}

// ---------- همهٔ تلاش‌های آزمون (فاز ۲: دروازه‌ها) ----------
export async function fetchAllQuizAttempts() {
  if (!sb || !auth.canOperate) return { data: [], error: null }
  const { data, error } = await sb
    .from('quiz_answers')
    .select('id, user_id, quiz_code, attempt_no, answers, correct_count, total_questions, score_percent, passed_gate, created_at')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) {
    return { data: [], error: handleApiError(error, 'خواندن سابقه آزمون‌ها ناموفق بود.') }
  }
  return { data: data || [], error: null }
}

// ---------- ثبت رویداد یادگیری شاگرد (events) ----------
export async function logLearningEvent(eventType, unitCode = 'day-0', payload = {}) {
  if (!sb || !auth.canOperate || !auth.isStudent) return
  try {
    await sb.from('events').insert({
      user_id: auth.user.id,
      event_type: eventType,
      unit_code: unitCode,
      payload
    })
  } catch {
    // خطای غیرمسدودکننده در ثبت رویداد
  }
}

// ---------- آزمون نمونه با RPC سروری submit_quiz_attempt(text, jsonb) ----------
export async function fetchQuizAttempts(quizCode = 'quiz-day-0') {
  if (!sb || !auth.canOperate) return { data: [], error: null }
  let query = sb
    .from('quiz_answers')
    .select('id, user_id, quiz_code, attempt_no, answers, correct_count, total_questions, score_percent, passed_gate, created_at')
    .eq('quiz_code', quizCode)
    .order('attempt_no', { ascending: false })

  if (auth.isStudent) {
    query = query.eq('user_id', auth.user.id)
  }

  const { data, error } = await query
  if (error) {
    return { data: [], error: handleApiError(error, 'خواندن سابقه آزمون ناموفق بود.') }
  }
  return { data: data || [], error: null }
}

export async function submitQuizAttempt(quizCode, answersArray) {
  if (!sb || !auth.canOperate) {
    return { data: null, error: 'ابتدا وارد حساب کاربری خود شوید.' }
  }
  if (!auth.isStudent) {
    return { data: null, error: 'فقط شاگرد می‌تواند آزمون را ثبت کند.' }
  }

  const { data, error } = await sb.rpc('submit_quiz_attempt', {
    p_quiz_code: quizCode,
    p_answers: answersArray
  })

  if (error) {
    return { data: null, error: handleApiError(error, 'ثبت و تصحیح آزمون ناموفق بود.') }
  }
  return { data, error: null }
}

// ---------- دفترچه‌های آزمایشگاه (lab_notebooks) — فاز ۳ ----------
// سلول‌ها به‌شکل [{title, code, output}] ذخیره می‌شوند؛ خروجی فقط برای مرور است،
/// نه برای نمره (تصحیح لب با استاد است، نه خودکار).
export async function fetchLabNotebook(labCode) {
  if (!sb || !auth.canOperate) return { data: null, error: null }
  let query = sb
    .from('lab_notebooks')
    .select('id, user_id, lab_code, cells, updated_at, created_at')
    .eq('lab_code', labCode)
    .is('deleted_at', null)
  if (auth.isStudent) {
    query = query.eq('user_id', auth.user.id)
  }
  const { data, error } = await query.maybeSingle()
  if (error) {
    return { data: null, error: handleApiError(error, 'خواندن دفترچهٔ آزمایشگاه ناموفق بود.') }
  }
  return { data: data || null, error: null }
}

export async function saveLabNotebook(labCode, cells) {
  if (!sb || !auth.canOperate) {
    return { data: null, error: 'نشست معتبر برای ذخیره دفترچه وجود ندارد.' }
  }
  if (!auth.isStudent) {
    return { data: null, error: null, readOnlyPreview: true }
  }
  const now = new Date().toISOString()
  const existing = await fetchLabNotebook(labCode)
  if (existing.error) return { data: null, error: existing.error }
  if (existing.data) {
    const { data, error } = await sb
      .from('lab_notebooks')
      .update({ cells, updated_at: now })
      .eq('id', existing.data.id)
      .select('id, user_id, lab_code, cells, updated_at, created_at')
      .single()
    if (error) {
      return { data: null, error: handleApiError(error, 'ذخیره دفترچهٔ آزمایشگاه ناموفق بود.') }
    }
    return { data, error: null }
  }
  const { data, error } = await sb
    .from('lab_notebooks')
    .insert({ user_id: auth.user.id, lab_code: labCode, cells, updated_at: now })
    .select('id, user_id, lab_code, cells, updated_at, created_at')
    .single()
  if (error) {
    return { data: null, error: handleApiError(error, 'ذخیره دفترچهٔ آزمایشگاه ناموفق بود.') }
  }
  return { data, error: null }
}

export async function fetchAllLabNotebooks() {
  if (!sb || !auth.canOperate || !auth.isTeacher) {
    return { data: [], error: null }
  }
  const { data, error } = await sb
    .from('lab_notebooks')
    .select('id, user_id, lab_code, cells, updated_at, created_at')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(100)
  if (error) {
    return { data: [], error: handleApiError(error, 'خواندن دفترچه‌های آزمایشگاه ناموفق بود.') }
  }
  return { data: data || [], error: null }
}

// ---------- داشبورد استاد (فقط برای isTeacher؛ بدون داده ساختگی) ----------
export async function fetchTeacherDashboardData() {
  if (!sb || !auth.canOperate || !auth.isTeacher) {
    return { data: null, error: 'دسترسی به داشبورد فقط برای استاد مجاز است.' }
  }

  const [membersRes, progressRes, quizzesRes, mistakesRes, eventsRes, auditRes] =
    await Promise.all([
      sb
        .from('members')
        .select('id, auth_id, role, display_name, username, created_at')
        .order('role', { ascending: true }),
      sb
        .from('day_progress')
        .select('id, user_id, unit_code, status, completed_steps, score_exact, started_at, completed_at, updated_at')
        .order('updated_at', { ascending: false }),
      sb
        .from('quiz_answers')
        .select('id, user_id, quiz_code, attempt_no, correct_count, total_questions, score_percent, passed_gate, created_at')
        .order('created_at', { ascending: false })
        .limit(100),
      sb
        .from('mistakes')
        .select('id, user_id, quiz_code, question_index, selected_option, concept_tag, reviewed, created_at')
        .order('created_at', { ascending: false })
        .limit(50),
      sb
        .from('events')
        .select('id, user_id, event_type, unit_code, payload, created_at')
        .order('created_at', { ascending: false })
        .limit(30),
      sb
        .from('audit_logs')
        .select('id, actor_role, action, target_table, target_id, meta, created_at')
        .order('created_at', { ascending: false })
        .limit(30)
    ])

  const firstErr =
    membersRes.error ||
    progressRes.error ||
    quizzesRes.error ||
    mistakesRes.error ||
    eventsRes.error ||
    auditRes.error

  if (firstErr) {
    return {
      data: null,
      error: handleApiError(firstErr, 'خواندن داده‌های داشبورد استاد ناموفق بود.')
    }
  }

  const members = membersRes.data || []
  const student = members.find((m) => m.role === 'student') || null

  return {
    data: {
      student,
      members,
      progress: progressRes.data || [],
      quizzes: quizzesRes.data || [],
      mistakes: mistakesRes.data || [],
      events: eventsRes.data || [],
      auditLogs: auditRes.data || []
    },
    error: null
  }
}
