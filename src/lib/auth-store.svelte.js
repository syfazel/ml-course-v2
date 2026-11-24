// وضعیت واکنش‌گرای Auth با Svelte 5 Runes ($state / $derived)
// نقش کاربر (teacher / student) منحصراً از جدول public.members خوانده می‌شود
// و هرگز از سمت کلاینت قابل تغییر نیست.

const VALID_ROLES = new Set(['teacher', 'student'])

class AuthStore {
  initialized = $state(false)
  loading = $state(false)
  user = $state(null)
  member = $state(null)
  memberError = $state(null)
  // فاز ۳ (F6): جنسِ آخرین خطای خواندن عضویت — 'transient' | 'not-found' | 'expired' | null.
  // فقط 'transient' دکمهٔ «تلاش دوباره» دارد؛ بقیه قطعی‌اند.
  memberErrorKind = $state(null)
  recoveryMode = $state(false)
  sessionExpired = $state(false)
  sessionNotice = $state(null)

  role = $derived(
    this.member && VALID_ROLES.has(this.member.role) ? this.member.role : null
  )
  isAuthenticated = $derived(Boolean(this.user))
  isTeacher = $derived(this.role === 'teacher')
  isStudent = $derived(this.role === 'student')

  canOperate = $derived(
    Boolean(
      this.user &&
        this.member &&
        this.member.auth_id === this.user.id &&
        VALID_ROLES.has(this.member.role) &&
        !this.memberError &&
        !this.recoveryMode
    )
  )

  resetSession({ expired = false, notice = null } = {}) {
    this.user = null
    this.member = null
    this.memberError = null
    this.memberErrorKind = null
    this.recoveryMode = false
    this.sessionExpired = expired
    this.sessionNotice = notice
  }
}

export const auth = new AuthStore()
