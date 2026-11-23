<script>
  import { onMount } from 'svelte'
  import { auth } from './lib/auth-store.svelte.js'
  import { initAuth } from './lib/auth.js'
  import { router } from './lib/router.svelte.js'
  import {
    fetchDayProgress,
    fetchQuizAttempts,
    fetchAllDayProgress,
    fetchAllQuizAttempts
  } from './lib/course-api.js'
  import { computeGates } from './lib/gates.js'
  import { COURSE_CONTENT } from './data/course-content.js'
  import { QUIZ_DAY0 } from './data/quiz-day0.js'

  import LoginView from './components/LoginView.svelte'
  import Sidebar from './components/Sidebar.svelte'
  import HomeView from './components/HomeView.svelte'
  import LessonDay0View from './components/LessonDay0View.svelte'
  import LessonView from './components/LessonView.svelte'
  import QuizView from './components/QuizView.svelte'
  import CapstoneView from './components/CapstoneView.svelte'
  import TeacherDashboardView from './components/TeacherDashboardView.svelte'
  import VideoView from './components/VideoView.svelte'

  let simpleMode = $state(false)
  let day0Progress = $state(null)
  let quizAttempts = $state([])
  let allProgress = $state([])
  let allAttempts = $state([])

  let gates = $derived(computeGates(allAttempts))
  let progressMap = $derived(
    Object.fromEntries(allProgress.map((p) => [p.unit_code, p.status]))
  )

  // شناسهٔ واحد از روی مسیر: /lesson/day-0 → 0 ، /lesson/{n} → n
  let currentUnitId = $derived.by(() => {
    if (router.path === '/lesson/day-0') return 0
    const m = router.path.match(/^\/lesson\/(\d+)$/)
    return m ? Number(m[1]) : null
  })

  // آزمون فعلی از روی مسیر
  let currentQuiz = $derived.by(() => {
    if (router.path === '/quiz/quiz-day-0') return QUIZ_DAY0
    const m = router.path.match(/^\/quiz\/(quiz-\d+-B)$/)
    if (!m) return null
    return COURSE_CONTENT.quizzes[m[1]] || null
  })

  // ویدیوی فعلی از روی مسیر — زیرنویس‌ها لِیزی لود می‌شوند
  let currentVideoKey = $derived.by(() => {
    const m = router.path.match(/^\/video\/([a-z0-9-]+)$/)
    return m ? m[1] : null
  })
  let currentVideo = $state(null)
  let videoLoading = $state(false)
  let videoError = $state(null)
  $effect(() => {
    const key = currentVideoKey
    if (!key) {
      currentVideo = null
      videoError = null
      return
    }
    videoLoading = true
    videoError = null
    import('./data/course-videos.js')
      .then((mod) => {
        const found = (mod.COURSE_VIDEOS || []).find((v) => v.key === key)
        if (found) currentVideo = found
        else videoError = 'ویدیوی مورد نظر پیدا نشد.'
        videoLoading = false
      })
      .catch(() => {
        videoError = 'بارگذاری زیرنویس‌های ویدیو ناموفق بود.'
        videoLoading = false
      })
  })
  let currentQuizAttempts = $derived.by(() => {
    if (!currentQuiz) return []
    return allAttempts.filter((a) => a.quiz_code === currentQuiz.quizCode)
  })

  async function refreshCourseState() {
    if (!auth.canOperate) return
    const [progRes, quizRes, allProgRes, allQuizRes] = await Promise.all([
      fetchDayProgress('day-0'),
      fetchQuizAttempts('quiz-day-0'),
      fetchAllDayProgress(),
      fetchAllQuizAttempts()
    ])
    if (!progRes.error) day0Progress = progRes.data
    if (!quizRes.error) quizAttempts = quizRes.data
    if (!allProgRes.error) allProgress = allProgRes.data
    if (!allQuizRes.error) allAttempts = allQuizRes.data
  }

  function onLessonProgressUpdated(updatedRow) {
    if (!updatedRow) return
    const idx = allProgress.findIndex((p) => p.unit_code === updatedRow.unit_code)
    if (idx >= 0) {
      allProgress = allProgress.map((p, i) => (i === idx ? updatedRow : p))
    } else {
      allProgress = [...allProgress, updatedRow]
    }
    if (updatedRow.unit_code === 'day-0') day0Progress = updatedRow
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
      allProgress = []
      allAttempts = []
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
      {progressMap}
      {gates}
    />

    <main class="flex-1 min-w-0">
      {#if router.path === '/lesson/day-0'}
        <LessonDay0View
          {day0Progress}
          onProgressUpdated={onLessonProgressUpdated}
        />
      {:else if currentUnitId !== null && COURSE_CONTENT.lessons[currentUnitId]}
        <LessonView
          lesson={COURSE_CONTENT.lessons[currentUnitId]}
          progress={allProgress.find((p) => p.unit_code === `lesson-${currentUnitId}`) || null}
          onProgressUpdated={onLessonProgressUpdated}
        />
      {:else if currentQuiz}
        <QuizView
          quiz={currentQuiz}
          attempts={currentQuizAttempts}
          onAttemptSubmitted={refreshCourseState}
        />
      {:else if currentVideoKey}
        {#if videoLoading}
          <div class="glass-card p-6 text-sm">در حال بارگذاری ویدیو و زیرنویس‌ها…</div>
        {:else if videoError || !currentVideo}
          <div class="glass-card p-6 text-sm text-amber-900 bg-amber-50 border border-amber-300">
            {videoError || 'ویدیوی مورد نظر پیدا نشد.'}
          </div>
        {:else}
          {#key currentVideo.key}
            <VideoView video={currentVideo} />
          {/key}
        {/if}
      {:else if router.path === '/capstone'}
        <CapstoneView />
      {:else if router.path === '/teacher'}
        <TeacherDashboardView />
      {:else}
        <HomeView
          {day0Progress}
          latestQuiz={quizAttempts[0] || null}
          {allProgress}
          {gates}
        />
      {/if}
    </main>
  </div>
{/if}
