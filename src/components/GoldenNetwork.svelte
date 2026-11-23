<script>
  import { onMount, onDestroy } from 'svelte'
  import {
    Scene,
    PerspectiveCamera,
    WebGLRenderer,
    BufferGeometry,
    Float32BufferAttribute,
    PointsMaterial,
    Points,
    LineSegments,
    LineBasicMaterial
  } from 'three'

  // شبکهٔ طلایی رویه‌ای — «رشتهٔ طلایی یادگیری»: چند صد ذره + خطوط اتصال،
  // حرکت آرام، واکنش ملایم به موس، حلقهٔ ذاتی (بی‌نهایت، بدون درز).
  // فقط وقتی سوار می‌شود که LoginView تشخیص داده حرکت مجاز و دستگاه توانمند است.
  let { paused = false } = $props()

  let host = $state(null)
  let canvas = $state(null)
  let failed = $state(false)

  let renderer = null
  let scene = null
  let camera = null
  let geoPoints = null
  let geoLines = null
  let base = null // Float32Array(N*3) — موقعیت پایهٔ ذره‌ها
  let phase = null // Float32Array(N) — فاز نوسان هر ذره
  let lineEnds = null // Int32Array(pairs*2) — اندیس‌های دو سر هر خط
  let raf = 0
  let simTime = 0
  let lastNow = 0
  let running = false
  let mouseX = 0
  let mouseY = 0
  let ro = null

  const N = 240
  const LINK_DIST = 2.4
  const MAX_LINES = 900

  // PRNG قطعی — شبکه در هر بارگذاری یک شکل ثابت دارد
  function mulberry32(seed) {
    let a = seed >>> 0
    return () => {
      a |= 0
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  function init() {
    try {
      renderer = new WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'low-power'
      })
    } catch {
      failed = true
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    renderer.setClearColor(0x000000, 0)

    scene = new Scene()
    camera = new PerspectiveCamera(60, 1, 0.1, 100)
    camera.position.set(0, 0, 10)

    const rand = mulberry32(20261124)
    base = new Float32Array(N * 3)
    phase = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      base[i * 3] = (rand() * 2 - 1) * 9
      base[i * 3 + 1] = (rand() * 2 - 1) * 5
      base[i * 3 + 2] = (rand() * 2 - 1) * 3.5 - 2.5
      phase[i] = rand() * Math.PI * 2
    }

    geoPoints = new BufferGeometry()
    geoPoints.setAttribute('position', new Float32BufferAttribute(base, 3))
    scene.add(
      new Points(
        geoPoints,
        new PointsMaterial({
          color: 0xe3a93f,
          size: 0.1,
          sizeAttenuation: true,
          transparent: true,
          opacity: 0.85,
          depthWrite: false
        })
      )
    )

    // خطوط: جفت‌هایی که در موقعیت پایه به هم نزدیک‌اند (یک‌بار محاسبه می‌شود)
    const pairs = []
    for (let i = 0; i < N && pairs.length < MAX_LINES; i++) {
      for (let j = i + 1; j < N && pairs.length < MAX_LINES; j++) {
        const dx = base[i * 3] - base[j * 3]
        const dy = base[i * 3 + 1] - base[j * 3 + 1]
        const dz = base[i * 3 + 2] - base[j * 3 + 2]
        if (dx * dx + dy * dy + dz * dz < LINK_DIST * LINK_DIST) pairs.push([i, j])
      }
    }
    lineEnds = new Int32Array(pairs.length * 2)
    pairs.forEach(([a, b], k) => {
      lineEnds[k * 2] = a
      lineEnds[k * 2 + 1] = b
    })
    geoLines = new BufferGeometry()
    geoLines.setAttribute(
      'position',
      new Float32BufferAttribute(new Float32Array(pairs.length * 6), 3)
    )
    scene.add(
      new LineSegments(
        geoLines,
        new LineBasicMaterial({
          color: 0xc89b3c,
          transparent: true,
          opacity: 0.32,
          depthWrite: false
        })
      )
    )

    resize()
    ro = new ResizeObserver(resize)
    ro.observe(host)
    window.addEventListener('pointermove', onPointer, { passive: true })
  }

  function resize() {
    if (!renderer || !host) return
    const w = host.clientWidth || 1
    const h = host.clientHeight || 1
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  function onPointer(e) {
    mouseX = (e.clientX / window.innerWidth - 0.5) * 2
    mouseY = (e.clientY / window.innerHeight - 0.5) * 2
  }

  function frame(now) {
    if (!running) return
    raf = requestAnimationFrame(frame)
    const dt = Math.min((now - lastNow) / 1000, 0.1)
    lastNow = now
    simTime += dt
    const t = simTime

    const pos = geoPoints.attributes.position.array
    for (let i = 0; i < N; i++) {
      const p = phase[i]
      pos[i * 3] = base[i * 3] + Math.sin(t * 0.22 + p) * 0.28
      pos[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * 0.17 + p * 1.7) * 0.22
      pos[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * 0.13 + p) * 0.18
    }
    geoPoints.attributes.position.needsUpdate = true

    const lp = geoLines.attributes.position.array
    for (let k = 0; k < lineEnds.length; k += 2) {
      const a = lineEnds[k] * 3
      const b = lineEnds[k + 1] * 3
      const o = k * 3
      lp[o] = pos[a]
      lp[o + 1] = pos[a + 1]
      lp[o + 2] = pos[a + 2]
      lp[o + 3] = pos[b]
      lp[o + 4] = pos[b + 1]
      lp[o + 5] = pos[b + 2]
    }
    geoLines.attributes.position.needsUpdate = true

    // چرخش آرام + واکنش ملایم به موس
    const targetY = t * 0.02 + mouseX * 0.12
    const targetX = mouseY * 0.08
    scene.rotation.y += (targetY - scene.rotation.y) * 0.03
    scene.rotation.x += (targetX - scene.rotation.x) * 0.03

    renderer.render(scene, camera)
  }

  function start() {
    if (running || failed || !renderer) return
    running = true
    lastNow = performance.now()
    raf = requestAnimationFrame(frame)
  }

  function stop() {
    running = false
    cancelAnimationFrame(raf)
  }

  onMount(() => {
    init()
    if (!failed && !paused) start()
  })

  // توقف/پخش از LoginView: حلقه را متوقف یا از سر می‌گیرد (فریم آخر می‌ماند)
  $effect(() => {
    if (paused) stop()
    else start()
  })

  onDestroy(() => {
    stop()
    ro?.disconnect()
    window.removeEventListener('pointermove', onPointer)
    try {
      renderer?.dispose()
    } catch {
      /* noop */
    }
  })
</script>

{#if !failed}
  <div bind:this={host} class="teaser-network" aria-hidden="true">
    <canvas bind:this={canvas}></canvas>
  </div>
{/if}
