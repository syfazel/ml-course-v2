// روتینگ ساده مبتنی بر هش برای اسکلت فاز ۱
// مسیرها: #/ (خانه) | #/login | #/reset-password | #/lesson/day-0 | #/quiz/quiz-day-0 | #/teacher

function parseHash() {
  if (typeof window === 'undefined') return { path: '/', step: null, params: {} }
  const raw = (window.location.hash || '#/').replace(/^#/, '') || '/'
  const [pathPart, queryPart] = raw.split('?')
  const params = new URLSearchParams(queryPart || '')
  return {
    path: pathPart.startsWith('/') ? pathPart : '/' + pathPart,
    step: params.get('step'),
    params: Object.fromEntries(params.entries())
  }
}

class HashRouter {
  path = $state(parseHash().path)
  step = $state(parseHash().step)
  params = $state(parseHash().params)

  init() {
    if (typeof window === 'undefined') return () => {}
    const onHashChange = () => {
      const parsed = parseHash()
      this.path = parsed.path
      this.step = parsed.step
      this.params = parsed.params
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }

  go(target) {
    if (typeof window === 'undefined') return
    const normalized = target.startsWith('#') ? target : '#' + target
    if (window.location.hash !== normalized) {
      window.location.hash = normalized
    } else {
      const parsed = parseHash()
      this.path = parsed.path
      this.step = parsed.step
      this.params = parsed.params
    }
  }
}

export const router = new HashRouter()
