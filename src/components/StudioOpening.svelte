<script>
  // Jarvis Studio — Cinematic Opening (Phase 4).
  // Full-screen, full sound, NO buttons / timeline / banner (Yasin's tick
  // 2026-11-24 15:39). Starts on mount — the entry gesture (the "enter
  // studio" click or Ctrl+J) unlocks the audio in this same document.
  // The animation logic lives in ../lib/studio-opening.js (ported IIFE);
  // the hidden chrome below (banner / pill / dock / restore button) stays
  // in the DOM only because that script references every id.
  import { onMount, onDestroy } from 'svelte'
  import { createStudioOpening } from '../lib/studio-opening.js'

  // R1 — onAssets: per-asset preload result (for the /intro-test panel);
  // onLoopStopped: fires once when the rAF loop fully stops after second 8;
  // failKeys: asset keys to force-fail (resilience test hook, /intro-test only).
  let { onDone = () => {}, onAssets = () => {}, onLoopStopped = () => {}, failKeys = [] } = $props()

  let stageEl
  let handle = null

  onMount(() => {
    handle = createStudioOpening(stageEl, {
      onDone: () => onDone(),
      onAssets,
      onLoopStopped,
      failKeys
    })
  })

  onDestroy(() => {
    handle?.destroy()
    handle = null
  })
</script>

<div id="stage" class="theme-dark studio-opening" bind:this={stageEl}>
  <canvas id="fxCanvas"></canvas>
  <div class="vignette"></div>

  <!-- R1 — saffron asset-status bar (visible only when an asset finally fails) -->
  <div id="assetStatusBar" class="hidden" role="status"></div>

  <!-- R1 — tap-for-sound layer (visible only while audio is blocked) -->
  <button id="tapSoundLayer" type="button" class="hidden" aria-label="ضربه برای پخش صدا">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z" fill="currentColor" stroke="none"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>
    <span>ضربه برای صدا</span>
  </button>

  <!-- R1 — mobile DOM layers: SVG ring + wordmark reveal (compact screens only) -->
  <svg id="domRing" viewBox="0 0 100 100" aria-hidden="true">
    <circle id="domRingGold" cx="50" cy="50" r="48" pathLength="100" />
    <circle id="domRingCyan" cx="50" cy="50" r="44" pathLength="100" />
  </svg>
  <img id="domWordmarkLight" src="studio-opening/wordmarkLight.webp" alt="" aria-hidden="true" />
  <img id="domWordmarkDark" src="studio-opening/wordmarkDark.webp" alt="" aria-hidden="true" />

  <!-- Hidden chrome (display:none via CSS) — ids required by the script -->
  <button id="soundBanner" type="button" aria-label="پخش با صدای عقاب و جارویس">
    <span>🔊</span>
    <span>برای پخش سینمایی با غرش عقاب و صدای جارویس کلیک کنید</span>
  </button>

  <div id="phasePill">
    <span class="phase-dot"></span>
    <span id="phaseLabel">فعال‌سازی هسته جارویس</span>
    <span class="timecode" id="timecodeText">0.0s / 8.0s</span>
  </div>

  <div id="controlDock">
    <div class="timeline-row">
      <div class="progress-track" id="progressTrack" title="جابه‌جایی در تایم‌لاین">
        <div class="climax-mark" title="باز شدن منقار و اوج صدای عقاب"></div>
        <div class="voice-mark" title="نگارش خوشنویسی و صدای جارویس"></div>
        <div class="progress-fill" id="progressFill"></div>
      </div>
    </div>

    <div class="controls-row">
      <div class="btn-group">
        <button class="ctrl-btn primary" id="replayBtn" type="button">
          <span>▶</span>
          <span>پخش مجدد با صدا</span>
        </button>
        <button class="ctrl-btn" id="eagleSfxBtn" type="button" title="تست باز شدن منقار و صدای عقاب">
          <span>🦅</span>
          <span>تست عقاب + منقار</span>
        </button>
        <button class="ctrl-btn jarvis-accent" id="jarvisVoiceBtn" type="button" title="تست صدای شخصیت جارویس و موج صوتی">
          <span>🎙️</span>
          <span>تست صدای جارویس</span>
        </button>
        <button class="ctrl-btn" id="muteBtn" type="button">
          <span id="muteIcon">🔊</span>
          <span id="muteText">صدا روشن</span>
        </button>
      </div>

      <div class="btn-group">
        <div class="dur-pills" role="group" aria-label="مدت زمان انیمیشن">
          <button class="dur-pill" data-dur="6.5" type="button">6.5s</button>
          <button class="dur-pill selected" data-dur="8.0" type="button">8.0s</button>
          <button class="dur-pill" data-dur="9.5" type="button">9.5s</button>
        </div>
        <button class="ctrl-btn" id="themeBtn" type="button">
          <span id="themeIcon">☀️</span>
          <span id="themeText">تم روشن</span>
        </button>
        <button class="ctrl-btn" id="cleanBtn" type="button" title="مخفی کردن کنترل‌ها برای نمایش تمام‌صفحه">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
          <span>نمایش خالص</span>
        </button>
      </div>
    </div>
  </div>

  <button id="restoreUiBtn" type="button">نمایش کنترل‌ها</button>

  <audio id="introAudio" preload="auto" src="studio-opening/intro.mp3"></audio>
  <audio id="eagleAudio" preload="auto" src="studio-opening/eagle.mp3"></audio>
  <audio id="jarvisAudio" preload="auto" src="studio-opening/jarvis.mp3"></audio>
</div>

<style>

    :root {
      --bg-dark-inner: #0c2c27;
      --bg-dark-mid: #051613;
      --bg-dark-outer: #020807;
      --bg-light-inner: #fffcf6;
      --bg-light-outer: #f5ebd9;
      --gold: #e6b35a;
      --gold-bright: #ffe29a;
      --copper: #c84b20;
      --emerald: #135d54;
      --hud-cyan: #48e5cf;
      --glass-bg: rgba(7, 24, 21, 0.76);
      --glass-border: rgba(230, 179, 90, 0.28);
      --text-main: #f7f1e3;
      --text-muted: rgba(247, 241, 227, 0.68);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-tap-highlight-color: transparent;
    }

    #stage {
      position: relative;
      width: 100%;
      height: 100vh;
      height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      background: radial-gradient(circle at 50% 42%, var(--bg-dark-inner) 0%, var(--bg-dark-mid) 46%, var(--bg-dark-outer) 100%);
      transition: background 0.65s cubic-bezier(0.22, 1, 0.36, 1);
      cursor: pointer;
    }

    #stage.theme-light {
      background: radial-gradient(circle at 50% 42%, var(--bg-light-inner) 0%, var(--bg-light-outer) 100%);
    }

    #fxCanvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
      pointer-events: none;
    }

    .vignette {
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: radial-gradient(ellipse at center, transparent 46%, rgba(0, 0, 0, 0.66) 100%);
      transition: opacity 0.65s ease;
    }

    #stage.theme-light .vignette {
      background: radial-gradient(ellipse at center, transparent 58%, rgba(15, 61, 54, 0.14) 100%);
    }

    /* Sound Unlock Banner */
    #soundBanner {
      position: absolute;
      top: 18px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 30;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 20px;
      border-radius: 999px;
      background: rgba(9, 34, 30, 0.9);
      border: 1px solid rgba(230, 179, 90, 0.58);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.48), 0 0 26px rgba(230, 179, 90, 0.25);
      color: #fff6e0;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      backdrop-filter: blur(12px);
      transition: opacity 0.35s ease, transform 0.35s ease;
      animation: bannerPulse 2.1s infinite ease-in-out;
    }

    #soundBanner.hidden {
      opacity: 0;
      pointer-events: none;
      transform: translateX(-50%) translateY(-12px);
      animation: none;
    }

    @keyframes bannerPulse {
      0%, 100% { box-shadow: 0 10px 30px rgba(0, 0, 0, 0.48), 0 0 16px rgba(230, 179, 90, 0.22); }
      50% { box-shadow: 0 10px 34px rgba(0, 0, 0, 0.56), 0 0 34px rgba(72, 229, 207, 0.45); }
    }

    /* Top-right status pill */
    #phasePill {
      position: absolute;
      top: 18px;
      right: 18px;
      z-index: 20;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 7px 14px;
      border-radius: 999px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      backdrop-filter: blur(12px);
      font-size: 12px;
      color: var(--text-main);
      transition: opacity 0.35s ease, transform 0.35s ease;
    }

    #stage.theme-light #phasePill {
      background: rgba(255, 252, 246, 0.88);
      border-color: rgba(15, 61, 54, 0.2);
      color: #0f3d36;
    }

    .phase-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--gold);
      box-shadow: 0 0 10px var(--gold);
    }

    .timecode {
      font-family: 'Inter', monospace;
      font-variant-numeric: tabular-nums;
      opacity: 0.85;
      direction: ltr;
    }

    /* Bottom Floating Control Dock */
    #controlDock {
      position: absolute;
      bottom: 18px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 25;
      width: min(820px, calc(100% - 24px));
      padding: 12px 16px;
      border-radius: 20px;
      background: var(--glass-bg);
      border: 1px solid var(--glass-border);
      backdrop-filter: blur(16px);
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.5);
      display: flex;
      flex-direction: column;
      gap: 10px;
      transition: opacity 0.35s ease, transform 0.35s ease;
      cursor: default;
    }

    #stage.theme-light #controlDock {
      background: rgba(255, 252, 246, 0.9);
      border-color: rgba(15, 61, 54, 0.18);
      box-shadow: 0 16px 40px rgba(15, 61, 54, 0.12);
      color: #0f3d36;
    }

    .studio-opening.clean-mode #controlDock,
    .studio-opening.clean-mode #phasePill {
      opacity: 0;
      pointer-events: none;
      transform: translateX(-50%) translateY(18px);
    }

    .studio-opening.clean-mode #phasePill {
      transform: translateY(-12px);
    }

    #restoreUiBtn {
      position: absolute;
      bottom: 16px;
      left: 16px;
      z-index: 30;
      padding: 8px 14px;
      border-radius: 999px;
      border: 1px solid rgba(230, 179, 90, 0.35);
      background: rgba(7, 24, 21, 0.78);
      color: #f7f1e3;
      font-family: inherit;
      font-size: 12px;
      cursor: pointer;
      backdrop-filter: blur(10px);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
    }

    .studio-opening.clean-mode #restoreUiBtn {
      opacity: 0.8;
      pointer-events: auto;
    }

    .studio-opening.clean-mode #restoreUiBtn:hover {
      opacity: 1;
    }

    /* Timeline Bar */
    .timeline-row {
      display: flex;
      align-items: center;
      gap: 12px;
      direction: ltr;
    }

    .progress-track {
      position: relative;
      flex: 1;
      height: 6px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.14);
      overflow: hidden;
      cursor: pointer;
    }

    #stage.theme-light .progress-track {
      background: rgba(15, 61, 54, 0.14);
    }

    .progress-fill {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 0%;
      border-radius: 999px;
      background: linear-gradient(90deg, #135d54 0%, #e6b35a 55%, #48e5cf 100%);
      box-shadow: 0 0 12px rgba(230, 179, 90, 0.6);
    }

    /* Climax marker (Eagle Beak & Cry at 2.12/8.0 = 26.5%) */
    .climax-mark {
      position: absolute;
      left: 26.5%;
      top: 0;
      bottom: 0;
      width: 3px;
      background: #ff7e47;
      box-shadow: 0 0 8px #ff7e47;
    }

    /* J.A.R.V.I.S. Voice marker (at 4.85/8.0 = 60.6%) */
    .voice-mark {
      position: absolute;
      left: 60.6%;
      top: 0;
      bottom: 0;
      width: 3px;
      background: #48e5cf;
      box-shadow: 0 0 8px #48e5cf;
    }

    /* Buttons Row */
    .controls-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .btn-group {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 7px;
    }

    .ctrl-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 12px;
      border-radius: 11px;
      border: 1px solid rgba(255, 255, 255, 0.14);
      background: rgba(255, 255, 255, 0.06);
      color: var(--text-main);
      font-family: inherit;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      white-space: nowrap;
    }

    #stage.theme-light .ctrl-btn {
      background: rgba(15, 61, 54, 0.06);
      border-color: rgba(15, 61, 54, 0.16);
      color: #0f3d36;
    }

    .ctrl-btn:hover {
      background: rgba(230, 179, 90, 0.18);
      border-color: rgba(230, 179, 90, 0.5);
      transform: translateY(-1px);
    }

    .ctrl-btn.primary {
      background: linear-gradient(135deg, #d4882a 0%, #b8421b 100%);
      border-color: rgba(255, 226, 154, 0.48);
      color: #fffaf0;
      box-shadow: 0 6px 18px rgba(200, 75, 32, 0.36);
    }

    .ctrl-btn.primary:hover {
      filter: brightness(1.1);
      transform: translateY(-1px);
    }

    .ctrl-btn.jarvis-accent {
      border-color: rgba(72, 229, 207, 0.38);
      background: rgba(72, 229, 207, 0.1);
    }

    .ctrl-btn.jarvis-accent:hover {
      background: rgba(72, 229, 207, 0.22);
      border-color: rgba(72, 229, 207, 0.65);
    }

    .ctrl-btn.active {
      background: rgba(230, 179, 90, 0.24);
      border-color: rgba(230, 179, 90, 0.65);
    }

    .dur-pills {
      display: inline-flex;
      padding: 2px;
      border-radius: 10px;
      background: rgba(0, 0, 0, 0.28);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    #stage.theme-light .dur-pills {
      background: rgba(15, 61, 54, 0.08);
      border-color: rgba(15, 61, 54, 0.14);
    }

    .dur-pill {
      padding: 5px 8px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: inherit;
      font-family: 'Inter', sans-serif;
      font-size: 11.5px;
      font-weight: 500;
      cursor: pointer;
      opacity: 0.72;
      transition: all 0.2s ease;
    }

    .dur-pill.selected {
      background: rgba(230, 179, 90, 0.28);
      opacity: 1;
      color: #ffe29a;
    }

    #stage.theme-light .dur-pill.selected {
      background: #0f3d36;
      color: #fffcf6;
    }

    @media (max-width: 640px) {
      #controlDock {
        bottom: 10px;
        padding: 10px 12px;
      }
      .ctrl-btn {
        padding: 6px 9px;
        font-size: 11px;
      }
      #phasePill {
        top: 10px;
        right: 10px;
        font-size: 11px;
      }
      #soundBanner {
        top: 52px;
        font-size: 11.5px;
        padding: 8px 14px;
      }
    }
  
    /* تیک یاسین ۱۵:۳۹ — افتتاحیه بدون هیچ دکمه/تایم‌لاین/بنری.
       این چهار عنصر فقط به‌خاطر ارجاع‌های اسکریپت در DOM می‌مانند. */
    .studio-opening #soundBanner,
    .studio-opening #phasePill,
    .studio-opening #controlDock,
    .studio-opening #restoreUiBtn {
      display: none !important;
    }
    .studio-opening {
      position: fixed;
      inset: 0;
      width: 100dvw;
      height: 100dvh;
      z-index: 60;
    }

    /* R1 — resilience UI (error colour is saffron #B5720A, never
       terracotta and never gate-red; no emoji as icons). */
    #assetStatusBar {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      z-index: 70;
      background: #B5720A;
      color: #241a05;
      font-size: 11px;
      font-weight: 600;
      line-height: 1.6;
      text-align: center;
      padding: 5px 12px;
      pointer-events: none;
    }
    #assetStatusBar.hidden,
    #tapSoundLayer.hidden {
      display: none;
    }
    #tapSoundLayer {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      z-index: 65;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 22px;
      border-radius: 999px;
      background: rgba(9, 34, 30, 0.92);
      border: 1px solid rgba(230, 179, 90, 0.58);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.48), 0 0 26px rgba(230, 179, 90, 0.25);
      color: #fff6e0;
      font-family: inherit;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      backdrop-filter: blur(12px);
      animation: tapPulse 2.1s infinite ease-in-out;
    }
    @keyframes tapPulse {
      0%, 100% { box-shadow: 0 10px 30px rgba(0, 0, 0, 0.48), 0 0 16px rgba(230, 179, 90, 0.22); }
      50% { box-shadow: 0 10px 34px rgba(0, 0, 0, 0.56), 0 0 34px rgba(72, 229, 207, 0.45); }
    }
    #domRing {
      position: absolute;
      display: none;
      pointer-events: none;
      overflow: visible;
    }
    #domRingGold {
      fill: none;
      stroke: #ffd67a;
      stroke-width: 1.6;
      stroke-linecap: round;
    }
    #domRingCyan {
      fill: none;
      stroke: #48e5cf;
      stroke-width: 1.1;
      stroke-linecap: round;
    }
    #domWordmarkLight,
    #domWordmarkDark {
      position: absolute;
      display: none;
      pointer-events: none;
      filter: drop-shadow(0 0 10px rgba(230, 179, 90, 0.45));
    }

</style>
