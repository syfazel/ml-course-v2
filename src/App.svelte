<script>
  import { onMount } from 'svelte'
  import { auth } from './lib/auth-store.svelte.js'
  import { initAuth } from './lib/auth.js'
  import { router } from './lib/router.svelte.js'
  import { fetchDayProgress, fetchQuizAttempts } from './lib/course-api.js'

  import LoginView from './components/LoginView.svelte'
  import Sidebar from './components/Sidebar.svelte'
  import HomeView from './components/HomeView.svelte'
  import LessonDay0View from './components/LessonDay0View.svelte'
  import QuizDay0View from './components/QuizDay0View.svelte'
  import TeacherDashboardView from './components/TeacherDashboardView.svelte'

  let simpleMode = $state(false)
  let day0Progress = $state(null)
  let quizAttempts = $state([])

  async function refreshCourseState() {
    if (!auth.canOperate) return
    const [progRes, quizRes] = await Promise.all([
      fetchDayProgress('day-0'),
      fetchQuizAttempts('quiz-day-0')
    ])
    if (!progRes.error) day0Progress = progRes.data
    if (!quizRes.error) quizAttempts = quizRes.data
  }

  function toggleSimpleMode() {
    simpleMode = !simpleMode
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('simple-mode', simpleMode)
    }
  }

  onMount(() => {
    const stopRouter = router.init()
    let stopAuth = () => {}
    initAuth().then((unsub) => {
      stopAuth = unsub
    })
    return () => {
      stopRouter()
      stopAuth()
    }
  })

  $effect(() => {
    if (auth.canOperate) {
      void refreshCourseState()
    } else {
      day0Progress = null
      quizAttempts = []
    }
  })
</script>

{#if !auth.initialized}
  <div class="min-h-screen flex items-center justify-center p-4">
    <div class="glass-card px-6 py-4 text-sm font-medium">
      در حال بررسی نشست کاربری...
    </div>
  </div>
{:else if !auth.canOperate || router.path === '/login' || router.path === '/reset-password'}
  <LoginView />
{:else}
  <div class="min-h-screen p-4 max-w-7xl mx-auto flex flex-col lg:flex-row gap-5">
    <!-- در dir="rtl"، اولین فرزند flex در سمت راست قرار می‌گیرد -->
    <Sidebar
      completedSteps={day0Progress?.completed_steps || []}
      {simpleMode}
      onToggleSimpleMode={toggleSimpleMode}
    />

    <main class="flex-1 min-w-0">
      {#if router.path === '/lesson/day-0'}
        <LessonDay0View
          {day0Progress}
          onProgressUpdated={(updated) => (day0Progress = updated)}
        />
      {:else if router.path === '/quiz/quiz-day-0'}
        <QuizDay0View
          attempts={quizAttempts}
          onAttemptSubmitted={refreshCourseState}
        />
      {:else if router.path === '/teacher'}
        <TeacherDashboardView />
      {:else}
        <HomeView {day0Progress} latestQuiz={quizAttempts[0] || null} />
      {/if}
    </main>
  </div>
{/if}
