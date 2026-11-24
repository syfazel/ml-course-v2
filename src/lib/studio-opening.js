// Jarvis Studio — Cinematic Opening (ported from the ticked standalone file
// `Jarvis_Studio___Cinematic_Opening_v2__Eagle_Beak___J.A.R.V.I.S._Voice__1_fl8u.html`,
// ticked by Yasin 2026-11-24 15:39: full-screen, full sound, NO buttons / timeline /
// replay / banner; starts on entry via the "enter studio" click or Ctrl+J).
// Port notes (deliberate, minimal deviations from the original):
//  - Runs scoped inside a Svelte component root (no document.getElementById,
//    no document.body): `root` IS the #stage element.
//  - No global window keydown handler (Space / h / m): Space belongs to the
//    desk; the controls it drove are hidden by Yasin's tick.
//  - No window 'load' listener (the site already loaded): auto-start fires
//    when the 6 WebP assets load; a 2.5s fallback starts it anyway.
//  - The original loop never ends (no completion callback). This port fires
//    `options.onDone` once, ~0.9s after the 8s timeline completes, with a
//    12s hard fallback, so the Studio desk can take over.
//  - Audio + image assets are files under public/studio-opening/ (extracted
//    byte-identical from the original), not base64 data URIs.
//  - destroy() cancels the RAF loop, stops all audio and removes listeners.
//    Call it on component unmount.
//  - clean-mode is applied to the root element, not <body>; the component's
//    CSS hides #soundBanner / #phasePill / #controlDock / #restoreUiBtn with
//    display:none (the ids stay in the DOM: this script references all of them).
export function createStudioOpening(root, options = {}) {

      // ============================================================
      // 1. ASSET LOADING (Logo + Surgical Beak Layers + Audio Meta)
      // ============================================================
      const ASSETS = {
        emblem: "studio-opening/emblem.webp",
        emblemBaseOpen: "studio-opening/emblemBaseOpen.webp",
        lowerBeak: "studio-opening/lowerBeak.webp",
        upperBeak: "studio-opening/upperBeak.webp",
        wordmarkLight: "studio-opening/wordmarkLight.webp",
        wordmarkDark: "studio-opening/wordmarkDark.webp"
      };

      const AUDIO_META = {"total_dur": 8.0, "voice_start": 4.85, "voice_dur": 1.471, "split_ratio": 0.49, "viz_env": [0.002, 0.359, 0.393, 0.291, 0.205, 0.324, 0.551, 1.0, 0.943, 0.877, 0.695, 0.598, 0.566, 0.555, 0.557, 0.623, 0.326, 0.129, 0.162, 0.805, 0.941, 0.682, 0.412, 0.193, 0.113, 0.121, 0.119, 0.105, 0.074, 0.02, 0.002, 0.0, 0.035, 0.127, 0.154, 0.152, 0.127, 0.135, 0.002, 0.098, 0.264, 0.549, 0.82, 0.518, 0.443, 0.387, 0.25, 0.053, 0.09, 0.15, 0.162, 0.102, 0.168, 0.164, 0.191, 0.209, 0.08, 0.102, 0.074, 0.045, 0.066, 0.037, 0.01, 0.004]};

      const imgs = {};
      let loadedCount = 0;
      const assetKeys = Object.keys(ASSETS);

      assetKeys.forEach((k) => {
        const im = new Image();
        im.onload = () => {
          loadedCount++;
          if (loadedCount === assetKeys.length && !animStarted) {
            startAnimation(false);
          }
        };
        im.src = ASSETS[k];
        imgs[k] = im;
      });

      // Exact coordinates in 560x560 emblem pixel space (verified via beak_grid.png)
      const EMB_DIM = 560;
      const EAGLE_EYE_NORM = { x: 298 / EMB_DIM, y: 82 / EMB_DIM };
      const LOWER_PIVOT_NORM = { x: 304 / EMB_DIM, y: 105 / EMB_DIM };
      const UPPER_PIVOT_NORM = { x: 330 / EMB_DIM, y: 92 / EMB_DIM };
      const BEAK_EMIT_NORM = { x: 368 / EMB_DIM, y: 112 / EMB_DIM };

      // ============================================================
      // 2. DOM ELEMENTS & STATE
      // ============================================================
      const stage = root;
      const canvas = root.querySelector("#fxCanvas");
      const ctx = canvas.getContext("2d");
      const introAudio = root.querySelector("#introAudio");
      const eagleAudio = root.querySelector("#eagleAudio");
      const jarvisAudio = root.querySelector("#jarvisAudio");

      const soundBanner = root.querySelector("#soundBanner");
      const phaseLabel = root.querySelector("#phaseLabel");
      const timecodeText = root.querySelector("#timecodeText");
      const progressTrack = root.querySelector("#progressTrack");
      const progressFill = root.querySelector("#progressFill");
      const replayBtn = root.querySelector("#replayBtn");
      const eagleSfxBtn = root.querySelector("#eagleSfxBtn");
      const jarvisVoiceBtn = root.querySelector("#jarvisVoiceBtn");
      const muteBtn = root.querySelector("#muteBtn");
      const muteIcon = root.querySelector("#muteIcon");
      const muteText = root.querySelector("#muteText");
      const themeBtn = root.querySelector("#themeBtn");
      const themeIcon = root.querySelector("#themeIcon");
      const themeText = root.querySelector("#themeText");
      const cleanBtn = root.querySelector("#cleanBtn");
      const restoreUiBtn = root.querySelector("#restoreUiBtn");
      const durPills = root.querySelectorAll(".dur-pill");

      const BASE_DURATION = AUDIO_META.total_dur || 8.0;
      const VOICE_START = AUDIO_META.voice_start || 4.85;
      const VOICE_DUR = AUDIO_META.voice_dur || 1.47;
      const SPLIT_RATIO = AUDIO_META.split_ratio || 0.49;
      const VIZ_ENV = AUDIO_META.viz_env || [];

      let targetDuration = BASE_DURATION;
      let isLightTheme = false;
      let isMuted = false;
      let audioUnlocked = false;
      let animStarted = false;
      let rafId = null;
      let doneFired = false;
      let doneTimer = null;
      let hardDoneTimer = null;

      let baseTime = 0;
      let lastFrameTs = 0;
      let climaxTriggered = false;
      let wingBurstFired = false;
      let manualEagleAge = -1;
      let manualVoiceAge = -1;
      let shakeIntensity = 0;
      let sonicWaveTimer = 0;

      // Subtle interactive parallax offset
      let pointerNX = 0, pointerNY = 0;
      let smoothPX = 0, smoothPY = 0;
      stage.addEventListener("pointermove", (e) => {
        const rect = stage.getBoundingClientRect();
        pointerNX = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
        pointerNY = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
      });
      stage.addEventListener("pointerleave", () => {
        pointerNX = 0;
        pointerNY = 0;
      });

      // ============================================================
      // 3. CANVAS SIZING & PARTICLE POOLS
      // ============================================================
      let W = 0, H = 0, DPR = 1;
      function resizeCanvas() {
        DPR = Math.min(window.devicePixelRatio || 1, 2);
        W = stage.clientWidth || window.innerWidth;
        H = stage.clientHeight || window.innerHeight;
        canvas.width = Math.floor(W * DPR);
        canvas.height = Math.floor(H * DPR);
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      }
      window.addEventListener("resize", resizeCanvas);
      resizeCanvas();

      const ambientDust = [];
      const sparks = [];
      const wingFeathers = [];
      const shockwaves = [];
      const beakSonicArcs = [];

      function initAmbientDust() {
        ambientDust.length = 0;
        for (let i = 0; i < 72; i++) {
          ambientDust.push({
            x: Math.random() * W,
            y: Math.random() * H,
            r: 0.7 + Math.random() * 2.1,
            vx: (Math.random() - 0.5) * 15,
            vy: -7 - Math.random() * 17,
            alpha: 0.14 + Math.random() * 0.55,
            hue: Math.random() > 0.35 ? "gold" : "cyan",
            twinkle: Math.random() * Math.PI * 2
          });
        }
      }
      initAmbientDust();

      function spawnSparks(x, y, count, speedMin, speedMax, color, lifeMax = 0.85) {
        for (let i = 0; i < count; i++) {
          const ang = Math.random() * Math.PI * 2;
          const spd = speedMin + Math.random() * (speedMax - speedMin);
          sparks.push({
            x, y,
            vx: Math.cos(ang) * spd,
            vy: Math.sin(ang) * spd,
            r: 1.0 + Math.random() * 2.4,
            life: 0,
            maxLife: 0.35 + Math.random() * lifeMax,
            color
          });
        }
      }

      function spawnWingBurst(cx, cy, radius) {
        wingFeathers.length = 0;
        for (let side of [-1, 1]) {
          for (let i = 0; i < 38; i++) {
            const spread = i / 38;
            const baseAngle = side === 1
              ? (-0.58 + spread * 1.38)
              : (Math.PI + 0.58 - spread * 1.38);
            const speed = radius * (1.15 + Math.random() * 1.75);
            wingFeathers.push({
              x: cx + side * radius * 0.18,
              y: cy - radius * 0.08 + (Math.random() - 0.5) * radius * 0.25,
              vx: Math.cos(baseAngle) * speed,
              vy: Math.sin(baseAngle) * speed - radius * 0.28,
              size: 4 + Math.random() * 9.5,
              life: 0,
              maxLife: 0.75 + Math.random() * 0.65,
              tone: i % 3 === 0 ? "#ffe08c" : (i % 3 === 1 ? "#e07b2a" : "#c84b20")
            });
          }
        }
      }

      function spawnBeakSonicArc(x, y, radius) {
        beakSonicArcs.push({
          x, y,
          r: radius * 0.06,
          maxR: radius * 0.85,
          life: 0,
          maxLife: 0.72
        });
      }

      function triggerShockwave(cx, cy, maxR) {
        shockwaves.push(
          { x: cx, y: cy, r: maxR * 0.45, maxR: maxR * 2.65, life: 0, maxLife: 1.05, color: "#ffda83", lw: 4.5 },
          { x: cx, y: cy, r: maxR * 0.38, maxR: maxR * 2.25, life: 0, maxLife: 1.30, color: "#48e5cf", lw: 2.8 }
        );
        shakeIntensity = 9.0;
      }

      // ============================================================
      // 4. EASING & MATH
      // ============================================================
      const clamp01 = (v) => Math.max(0, Math.min(1, v));
      const lerp = (a, b, t) => a + (b - a) * t;
      const easeOutCubic = (t) => 1 - Math.pow(1 - clamp01(t), 3);
      const easeInOutQuart = (t) => {
        t = clamp01(t);
        return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
      };
      const easeOutBack = (t) => {
        t = clamp01(t);
        const c1 = 1.45, c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
      };

      // Computes smooth beak opening factor [0..1] for soaring eagle cry
      function computeBeakOpenAmount(age) {
        // age: seconds since eagle cry start (active 0.0s .. 1.55s)
        if (age < 0 || age > 1.62) return 0;
        let open = 0;
        if (age < 0.16) {
          // Rapid fierce jaw drop as eagle begins soaring cry
          open = easeOutCubic(age / 0.16);
        } else if (age < 1.15) {
          // Sustained wide open with organic syrinx micro-vibration!
          const sustain = 1.0 - 0.14 * ((age - 0.16) / 0.99);
          const flutter = 0.065 * Math.sin(age * 42 * Math.PI * 2) * (1 - (age - 0.16) / 1.2);
          open = sustain + flutter;
        } else {
          // Smooth majestic close back to resting emblem
          open = (1 - easeInOutQuart((age - 1.15) / 0.47)) * 0.86;
        }
        return clamp01(open);
      }

      // ============================================================
      // 5. AUDIO CONTROLS
      // ============================================================
      function syncAudioRate() {
        const rate = BASE_DURATION / targetDuration;
        try {
          introAudio.playbackRate = rate;
        } catch (e) {}
      }

      function stopAllAudio() {
        [introAudio, eagleAudio, jarvisAudio].forEach((a) => {
          try { a.pause(); a.currentTime = 0; } catch (e) {}
        });
      }

      function playIntroSound(fromBaseSec = 0) {
        if (isMuted) return;
        syncAudioRate();
        try {
          eagleAudio.pause();
          jarvisAudio.pause();
          introAudio.currentTime = Math.min(fromBaseSec, BASE_DURATION - 0.05);
          const p = introAudio.play();
          if (p && typeof p.then === "function") {
            p.then(() => {
              audioUnlocked = true;
              soundBanner.classList.add("hidden");
            }).catch(() => {
              audioUnlocked = false;
              soundBanner.classList.remove("hidden");
            });
          }
        } catch (e) {}
      }

      function playEagleOnly() {
        const layout = getLayout();
        const eyeX = layout.cx + (EAGLE_EYE_NORM.x - 0.5) * layout.emblemSize;
        const eyeY = layout.cy + (EAGLE_EYE_NORM.y - 0.5) * layout.emblemSize;
        manualEagleAge = 0;
        triggerShockwave(layout.cx, layout.cy, layout.emblemRadius);
        spawnSparks(eyeX, eyeY, 28, 60, 270, "#ffe8a3", 0.9);
        if (isMuted) return;
        try {
          eagleAudio.currentTime = 0;
          const p = eagleAudio.play();
          if (p && typeof p.then === "function") {
            p.then(() => {
              audioUnlocked = true;
              soundBanner.classList.add("hidden");
            }).catch(() => {});
          }
        } catch (e) {}
      }

      function playJarvisVoiceOnly() {
        manualVoiceAge = 0;
        if (isMuted) return;
        try {
          jarvisAudio.currentTime = 0;
          const p = jarvisAudio.play();
          if (p && typeof p.then === "function") {
            p.then(() => {
              audioUnlocked = true;
              soundBanner.classList.add("hidden");
            }).catch(() => {});
          }
        } catch (e) {}
      }

      function getLayout() {
        const minDim = Math.min(W, H);
        const isCompact = H < 560 || W < 520;
        const emblemSize = Math.min(305, Math.max(160, minDim * (isCompact ? 0.35 : 0.39)));
        const cx = W * 0.5;
        const cy = H * (isCompact ? 0.35 : 0.385);
        const wordmarkW = emblemSize * 1.22;
        const wordmarkH = wordmarkW * (132 / 680);
        const wordmarkY = cy + emblemSize * 0.5 + Math.max(12, emblemSize * 0.06);
        return {
          cx, cy,
          emblemSize,
          emblemRadius: emblemSize * 0.478,
          wordmarkW, wordmarkH, wordmarkY
        };
      }

      // ============================================================
      // 6. DRAWING HELPERS (HUD Rings, Open Beak, Voice Waveform)
      // ============================================================
      function drawFourPointStar(x, y, radius, alpha, rotation = 0) {
        if (alpha <= 0.01 || radius <= 0.5) return;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(rotation);
        ctx.globalCompositeOperation = "lighter";

        const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
        grad.addColorStop(0, `rgba(255, 250, 224, ${alpha})`);
        grad.addColorStop(0.25, `rgba(255, 206, 102, ${alpha * 0.78})`);
        grad.addColorStop(0.6, `rgba(200, 75, 32, ${alpha * 0.24})`);
        grad.addColorStop(1, "rgba(200, 75, 32, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();

        const drawSpike = (len, wid) => {
          const sg = ctx.createLinearGradient(-len, 0, len, 0);
          sg.addColorStop(0, "rgba(255,235,170,0)");
          sg.addColorStop(0.5, `rgba(255,252,235,${alpha})`);
          sg.addColorStop(1, "rgba(255,235,170,0)");
          ctx.fillStyle = sg;
          ctx.beginPath();
          ctx.ellipse(0, 0, len, wid, 0, 0, Math.PI * 2);
          ctx.fill();
        };
        drawSpike(radius * 1.48, Math.max(1.2, radius * 0.045));
        ctx.rotate(Math.PI / 2);
        drawSpike(radius * 0.88, Math.max(1.0, radius * 0.038));
        ctx.restore();
      }

      function drawJarvisHudRings(cx, cy, radius, t, ts, voiceActiveAmt) {
        const hudIn = easeOutCubic(clamp01((t - 0.12) / 1.35));
        if (hudIn <= 0.01) return;

        ctx.save();
        ctx.translate(cx, cy);
        const alphaBase = (isLightTheme ? 0.24 : 0.34) * hudIn + voiceActiveAmt * 0.22;
        const goldCol = isLightTheme ? `rgba(180, 108, 30, ${alphaBase})` : `rgba(230, 179, 90, ${alphaBase})`;
        const cyanCol = isLightTheme ? `rgba(15, 93, 84, ${alphaBase * 0.9})` : `rgba(72, 229, 207, ${alphaBase * 0.85})`;

        // Outer subtle segmented HUD ring
        ctx.save();
        ctx.rotate(ts * 0.00024);
        ctx.strokeStyle = cyanCol;
        ctx.lineWidth = 1.1;
        const r1 = radius * 1.16;
        for (let i = 0; i < 6; i++) {
          const a0 = i * (Math.PI / 3) + 0.14;
          const a1 = a0 + 0.62;
          ctx.beginPath();
          ctx.arc(0, 0, r1, a0, a1);
          ctx.stroke();
        }
        ctx.restore();

        // Counter-rotating golden telemetry tick ring
        ctx.save();
        ctx.rotate(-ts * 0.00032);
        ctx.strokeStyle = goldCol;
        const r2 = radius * 1.09;
        const ticks = 48;
        for (let i = 0; i < ticks; i++) {
          const ang = (i / ticks) * Math.PI * 2;
          const major = i % 6 === 0;
          const len = major ? 7 : 3;
          ctx.lineWidth = major ? 1.5 : 0.85;
          ctx.beginPath();
          ctx.moveTo(Math.cos(ang) * r2, Math.sin(ang) * r2);
          ctx.lineTo(Math.cos(ang) * (r2 + len), Math.sin(ang) * (r2 + len));
          ctx.stroke();
        }
        ctx.restore();

        // Thin scanning crosshair accents (4 cardinal brackets)
        ctx.strokeStyle = cyanCol;
        ctx.lineWidth = 1.25;
        const r3 = radius * 1.23;
        for (let i = 0; i < 4; i++) {
          const a = i * (Math.PI / 2);
          ctx.beginPath();
          ctx.arc(0, 0, r3, a - 0.08, a + 0.08);
          ctx.stroke();
        }
        ctx.restore();
      }

      function drawAnimatedEmblemWithBeak(emblemSize, beakOpen) {
        const half = emblemSize / 2;

        // If beak is closed, render the 100% original crisp emblem directly!
        if (beakOpen <= 0.008 || !imgs.emblemBaseOpen.complete || !imgs.lowerBeak.complete || !imgs.upperBeak.complete) {
          ctx.drawImage(imgs.emblem, -half, -half, emblemSize, emblemSize);
          return;
        }

        // 1. Draw seamless inpainted base emblem (without closed beak)
        ctx.drawImage(imgs.emblemBaseOpen, -half, -half, emblemSize, emblemSize);

        // Helper: convert 560x560 emblem coords to local centered coords
        const sx = (px) => (px / EMB_DIM - 0.5) * emblemSize;
        const sy = (py) => (py / EMB_DIM - 0.5) * emblemSize;

        // 2. Draw anatomically accurate dark crimson inner throat & curved tongue ONLY in inner mouth (x: 300..344)
        const lowDeg = beakOpen * 25.0;   // clockwise downward jaw open
        const upDeg = -beakOpen * 5.5;    // slight upward tilt of upper hooked beak
        const lowRad = (lowDeg * Math.PI) / 180;
        const upRad = (upDeg * Math.PI) / 180;

        // Compute rotated inner-mouth points so cavity tracks jaw cleanly without spilling past x=344
        const pLx = sx(304), pLy = sy(105);
        const rotLow = (px, py) => {
          const dx = sx(px) - pLx, dy = sy(py) - pLy;
          return [
            pLx + dx * Math.cos(lowRad) - dy * Math.sin(lowRad),
            pLy + dx * Math.sin(lowRad) + dy * Math.cos(lowRad)
          ];
        };

        const [mBotMidX, mBotMidY] = rotLow(340, 107);
        const [mBotBackX, mBotBackY] = rotLow(314, 106);

        ctx.save();
        // Deep shadowed avian mouth interior
        const mGrad = ctx.createLinearGradient(sx(300), sy(104), sx(346), sy(114));
        mGrad.addColorStop(0, "#1c0508");
        mGrad.addColorStop(0.55, "#4d1118");
        mGrad.addColorStop(1, "#2a090d");
        ctx.fillStyle = mGrad;
        ctx.beginPath();
        ctx.moveTo(sx(298), sy(104));
        ctx.quadraticCurveTo(sx(326), sy(98), sx(346), sy(101));
        ctx.quadraticCurveTo(sx(340), (sy(101) + mBotMidY) * 0.52, mBotMidX, mBotMidY);
        ctx.lineTo(mBotBackX, mBotBackY);
        ctx.closePath();
        ctx.fill();

        // Subtle curved eagle tongue inside throat
        if (beakOpen > 0.15) {
          const [tTipX, tTipY] = rotLow(338, 105);
          ctx.fillStyle = `rgba(182, 66, 58, ${0.85 * Math.min(1, beakOpen * 1.4)})`;
          ctx.beginPath();
          ctx.moveTo(sx(308), sy(106));
          ctx.quadraticCurveTo(sx(325), sy(104 + beakOpen * 4), tTipX, tTipY - emblemSize * 0.008);
          ctx.quadraticCurveTo(sx(324), mBotBackY + emblemSize * 0.005, sx(308), sy(108));
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();

        // 3. Draw rotated Lower Mandible pivoting around mouth corner (304, 105)
        ctx.save();
        ctx.translate(pLx, pLy);
        ctx.rotate(lowRad);
        ctx.drawImage(imgs.lowerBeak, -half - pLx, -half - pLy, emblemSize, emblemSize);
        ctx.restore();

        // 4. Draw subtly lifted Upper Hooked Beak pivoting around cere (330, 92)
        const pUx = sx(330), pUy = sy(92);
        ctx.save();
        ctx.translate(pUx, pUy);
        ctx.rotate(upRad);
        ctx.drawImage(imgs.upperBeak, -half - pUx, -half - pUy, emblemSize, emblemSize);
        ctx.restore();
      }

      function drawJarvisVoiceWaveform(cx, y, width, voiceProgress, activeStrength, ts) {
        if (activeStrength <= 0.01) return;
        const barCount = 44;
        const halfW = width * 0.5;
        const step = width / barCount;

        ctx.save();
        ctx.globalCompositeOperation = isLightTheme ? "source-over" : "lighter";

        // Current energy from real extracted voice envelope
        const envIdx = Math.min(VIZ_ENV.length - 1, Math.max(0, Math.floor(voiceProgress * VIZ_ENV.length)));
        const curEnergy = VIZ_ENV.length ? VIZ_ENV[envIdx] : 0.6;

        for (let i = 0; i < barCount; i++) {
          const norm = i / (barCount - 1); // 0..1
          const centerDist = Math.abs(norm - 0.5) * 2; // 0 at center, 1 at edges
          const windowFalloff = Math.pow(1 - centerDist, 1.35);
          const wave = 0.5 + 0.5 * Math.sin(norm * 14 - ts * 0.018 + curEnergy * 6);
          const barH = (2.5 + curEnergy * 22 * wave * windowFalloff) * activeStrength;
          const bx = cx - halfW + i * step;

          const grad = ctx.createLinearGradient(bx, y - barH, bx, y + barH);
          if (isLightTheme) {
            grad.addColorStop(0, "rgba(19, 93, 84, 0.2)");
            grad.addColorStop(0.5, `rgba(19, 93, 84, ${0.85 * activeStrength})`);
            grad.addColorStop(1, "rgba(19, 93, 84, 0.2)");
          } else {
            grad.addColorStop(0, "rgba(72, 229, 207, 0.15)");
            grad.addColorStop(0.5, `rgba(255, 224, 140, ${0.92 * activeStrength})`);
            grad.addColorStop(1, "rgba(72, 229, 207, 0.15)");
          }
          ctx.fillStyle = grad;
          ctx.fillRect(bx, y - barH * 0.5, Math.max(1.8, step * 0.52), barH);
        }
        ctx.restore();
      }

      function getPhaseName(t) {
        if (t < 1.35) return "فعال‌سازی هسته جارویس";
        if (t < 2.12) return "گشودن بال‌های عقاب";
        if (t < 3.75) return "باز شدن منقار و اوج صدای عقاب";
        if (t < 4.85) return "درخشش فلزی نشان جارویس";
        if (t < 6.45) return "نگارش خوشنویسی و صدای جارویس";
        return "آماده ورود به Jarvis Studio";
      }

      // ============================================================
      // 7. MAIN 60 FPS CINEMATIC RENDER LOOP
      // ============================================================
      function renderFrame(ts) {
        if (!lastFrameTs) lastFrameTs = ts;
        const dt = Math.min(0.05, (ts - lastFrameTs) / 1000);
        lastFrameTs = ts;

        const speedScale = BASE_DURATION / targetDuration;
        if (baseTime < BASE_DURATION) {
          baseTime = Math.min(BASE_DURATION, baseTime + dt * speedScale);
        }
        // Port addition: the original loop never ends; fire onDone once
        // shortly after the 8s timeline completes so the desk can take over.
        if (baseTime >= BASE_DURATION && !doneFired) {
          doneFired = true;
          doneTimer = setTimeout(() => {
            if (typeof options.onDone === "function") options.onDone();
          }, 900);
        }

        // Smooth mouse parallax
        smoothPX += (pointerNX - smoothPX) * Math.min(1, dt * 6);
        smoothPY += (pointerNY - smoothPY) * Math.min(1, dt * 6);

        // Update UI readouts
        const realElapsed = (baseTime / BASE_DURATION) * targetDuration;
        progressFill.style.width = `${(baseTime / BASE_DURATION) * 100}%`;
        timecodeText.textContent = `${realElapsed.toFixed(1)}s / ${targetDuration.toFixed(1)}s`;
        phaseLabel.textContent = getPhaseName(baseTime);

        const layout = getLayout();
        const cx = layout.cx + smoothPX * 6;
        const cy = layout.cy + smoothPY * 5;
        const { emblemSize, emblemRadius, wordmarkW, wordmarkH, wordmarkY } = layout;

        // One-shot triggers
        if (!wingBurstFired && baseTime >= 1.32) {
          wingBurstFired = true;
          spawnWingBurst(cx, cy, emblemRadius);
        }
        if (!climaxTriggered && baseTime >= 2.12) {
          climaxTriggered = true;
          triggerShockwave(cx, cy, emblemRadius);
          const ex = cx + (EAGLE_EYE_NORM.x - 0.5) * emblemSize;
          const ey = cy + (EAGLE_EYE_NORM.y - 0.5) * emblemSize;
          spawnSparks(ex, ey, 36, 75, 320, "#ffe8a3", 1.0);
        }

        // Update manual test timers
        if (manualEagleAge >= 0) {
          manualEagleAge += dt;
          if (manualEagleAge > 1.75) manualEagleAge = -1;
        }
        if (manualVoiceAge >= 0) {
          manualVoiceAge += dt;
          if (manualVoiceAge > VOICE_DUR + 0.45) manualVoiceAge = -1;
        }

        // Compute active beak open amount (from main timeline OR manual test button)
        const timelineEagleAge = baseTime >= 2.08 ? (baseTime - 2.08) : -1;
        const beakOpen = Math.max(
          computeBeakOpenAmount(timelineEagleAge),
          computeBeakOpenAmount(manualEagleAge)
        );

        // Emit sonic soundwave arcs directly from open beak while eagle is crying!
        if (beakOpen > 0.35) {
          sonicWaveTimer += dt;
          if (sonicWaveTimer >= 0.19) {
            sonicWaveTimer = 0;
            const bx = cx + (BEAK_EMIT_NORM.x - 0.5) * emblemSize;
            const by = cy + (BEAK_EMIT_NORM.y - 0.5) * emblemSize;
            spawnBeakSonicArc(bx, by, emblemRadius);
          }
        } else {
          sonicWaveTimer = 0.16;
        }

        // Compute J.A.R.V.I.S. voice active envelope
        let voiceProgress = -1;
        let voiceStrength = 0;
        if (baseTime >= VOICE_START && baseTime <= VOICE_START + VOICE_DUR + 0.35) {
          voiceProgress = clamp01((baseTime - VOICE_START) / VOICE_DUR);
          const fadeIn = clamp01((baseTime - VOICE_START) / 0.12);
          const fadeOut = clamp01((VOICE_START + VOICE_DUR + 0.35 - baseTime) / 0.35);
          voiceStrength = fadeIn * fadeOut;
        }
        if (manualVoiceAge >= 0) {
          voiceProgress = clamp01(manualVoiceAge / VOICE_DUR);
          const fadeIn = clamp01(manualVoiceAge / 0.12);
          const fadeOut = clamp01((VOICE_DUR + 0.45 - manualVoiceAge) / 0.35);
          voiceStrength = Math.max(voiceStrength, fadeIn * fadeOut);
        }

        // Camera micro-shake decay
        let shakeX = 0, shakeY = 0;
        if (shakeIntensity > 0.08) {
          shakeX = (Math.random() - 0.5) * shakeIntensity * 2;
          shakeY = (Math.random() - 0.5) * shakeIntensity * 2;
          shakeIntensity *= Math.pow(0.03, dt);
        } else {
          shakeIntensity = 0;
        }

        ctx.clearRect(0, 0, W, H);
        ctx.save();
        ctx.translate(shakeX, shakeY);

        // ----------------------------------------------------------
        // LAYER A: Volumetric God-Rays & Atmospheric Aura
        // ----------------------------------------------------------
        const auraIn = easeOutCubic((baseTime - 0.3) / 1.7);
        const breathe = 0.92 + 0.08 * Math.sin(ts * 0.0022);
        const climaxBoost = Math.max(
          baseTime >= 2.12 ? Math.exp(-(baseTime - 2.12) * 1.8) * 0.58 : 0,
          beakOpen * 0.32
        );

        if (auraIn > 0.01) {
          ctx.save();
          ctx.translate(cx, cy);
          const auraR = emblemRadius * (2.45 + climaxBoost * 0.5) * breathe;
          const ag = ctx.createRadialGradient(0, 0, emblemRadius * 0.15, 0, 0, auraR);
          if (isLightTheme) {
            ag.addColorStop(0, `rgba(212, 136, 42, ${0.22 * auraIn + climaxBoost * 0.18})`);
            ag.addColorStop(0.45, `rgba(19, 93, 84, ${0.12 * auraIn})`);
            ag.addColorStop(1, "rgba(19, 93, 84, 0)");
          } else {
            ag.addColorStop(0, `rgba(230, 179, 90, ${0.25 * auraIn + climaxBoost * 0.35})`);
            ag.addColorStop(0.42, `rgba(19, 135, 118, ${0.22 * auraIn + voiceStrength * 0.12})`);
            ag.addColorStop(1, "rgba(5, 22, 19, 0)");
          }
          ctx.fillStyle = ag;
          ctx.beginPath();
          ctx.arc(0, 0, auraR, 0, Math.PI * 2);
          ctx.fill();

          if (!isLightTheme) {
            ctx.globalCompositeOperation = "lighter";
            ctx.rotate(ts * 0.00018);
            for (let i = 0; i < 10; i++) {
              ctx.rotate((Math.PI * 2) / 10);
              const rg = ctx.createLinearGradient(0, 0, 0, -auraR * 1.18);
              rg.addColorStop(0, `rgba(230, 179, 90, ${(0.048 + climaxBoost * 0.065) * auraIn})`);
              rg.addColorStop(1, "rgba(230, 179, 90, 0)");
              ctx.fillStyle = rg;
              ctx.beginPath();
              ctx.moveTo(-emblemRadius * 0.08, 0);
              ctx.lineTo(-emblemRadius * 0.34, -auraR * 1.18);
              ctx.lineTo(emblemRadius * 0.34, -auraR * 1.18);
              ctx.lineTo(emblemRadius * 0.08, 0);
              ctx.closePath();
              ctx.fill();
            }
          }
          ctx.restore();
        }

        // ----------------------------------------------------------
        // LAYER B: Floating Ambient Dust
        // ----------------------------------------------------------
        for (let p of ambientDust) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.twinkle += dt * 2.6;
          if (p.y < -10) { p.y = H + 10; p.x = Math.random() * W; }
          if (p.x < -10) p.x = W + 10;
          if (p.x > W + 10) p.x = -10;
          const tw = 0.55 + 0.45 * Math.sin(p.twinkle);
          const a = p.alpha * tw * (isLightTheme ? 0.45 : 0.85);
          ctx.fillStyle = p.hue === "gold"
            ? `rgba(244, 198, 108, ${a})`
            : (isLightTheme ? `rgba(19, 93, 84, ${a * 0.7})` : `rgba(72, 229, 207, ${a * 0.72})`);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }

        // ----------------------------------------------------------
        // LAYER C: J.A.R.V.I.S. Holographic HUD Telemetry Rings
        // ----------------------------------------------------------
        drawJarvisHudRings(cx, cy, emblemRadius, baseTime, ts, voiceStrength);

        // ----------------------------------------------------------
        // LAYER D: Act 1 — Blazing Energy Ring Trace (0.0s - 1.5s)
        // ----------------------------------------------------------
        const ringProg = easeInOutQuart(baseTime / 1.44);
        const ringFade = baseTime < 2.2 ? 1.0 : clamp01(1 - (baseTime - 2.2) / 0.75);
        if (ringProg > 0.005 && ringFade > 0.01) {
          ctx.save();
          ctx.globalCompositeOperation = isLightTheme ? "source-over" : "lighter";
          const startAng = -Math.PI / 2;
          const sweep = ringProg * Math.PI * 2;

          ctx.strokeStyle = isLightTheme
            ? `rgba(184, 104, 28, ${0.85 * ringFade})`
            : `rgba(255, 214, 122, ${0.94 * ringFade})`;
          ctx.lineWidth = 3.2;
          ctx.shadowColor = "#e6b35a";
          ctx.shadowBlur = isLightTheme ? 8 : 22;
          ctx.beginPath();
          ctx.arc(cx, cy, emblemRadius * 1.015, startAng, startAng + sweep);
          ctx.stroke();

          ctx.strokeStyle = `rgba(72, 229, 207, ${0.72 * ringFade})`;
          ctx.lineWidth = 2.0;
          ctx.shadowColor = "#48e5cf";
          ctx.shadowBlur = 14;
          ctx.beginPath();
          ctx.arc(cx, cy, emblemRadius * 0.94, startAng + Math.PI, startAng + Math.PI - sweep, true);
          ctx.stroke();

          if (baseTime < 1.48) {
            const headAng = startAng + sweep;
            const hx = cx + Math.cos(headAng) * emblemRadius * 1.015;
            const hy = cy + Math.sin(headAng) * emblemRadius * 1.015;
            drawFourPointStar(hx, hy, 26, 0.95 * ringFade, headAng);
            if (Math.random() < 0.75) {
              spawnSparks(hx, hy, 2, 25, 95, "#ffd97d", 0.5);
            }
          }
          ctx.restore();
        }

        // ----------------------------------------------------------
        // LAYER E: Wing-Burst Feather Ribbons & Shockwaves
        // ----------------------------------------------------------
        for (let i = wingFeathers.length - 1; i >= 0; i--) {
          const f = wingFeathers[i];
          f.life += dt;
          if (f.life >= f.maxLife) { wingFeathers.splice(i, 1); continue; }
          const p = f.life / f.maxLife;
          f.x += f.vx * dt * (1 - p * 0.65);
          f.y += f.vy * dt * (1 - p * 0.65) + 38 * dt;
          ctx.save();
          ctx.translate(f.x, f.y);
          ctx.rotate(Math.atan2(f.vy, f.vx));
          ctx.globalCompositeOperation = isLightTheme ? "source-over" : "lighter";
          ctx.fillStyle = f.tone;
          ctx.globalAlpha = Math.sin(p * Math.PI) * (isLightTheme ? 0.72 : 0.92);
          ctx.beginPath();
          ctx.ellipse(0, 0, f.size * 1.85, f.size * 0.34, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        for (let i = shockwaves.length - 1; i >= 0; i--) {
          const sw = shockwaves[i];
          sw.life += dt;
          if (sw.life >= sw.maxLife) { shockwaves.splice(i, 1); continue; }
          const p = easeOutCubic(sw.life / sw.maxLife);
          const curR = lerp(sw.r, sw.maxR, p);
          ctx.save();
          ctx.globalCompositeOperation = isLightTheme ? "source-over" : "lighter";
          ctx.strokeStyle = sw.color;
          ctx.globalAlpha = (1 - p) * (isLightTheme ? 0.55 : 0.85);
          ctx.lineWidth = sw.lw * (1 - p * 0.7);
          ctx.beginPath();
          ctx.arc(sw.x, sw.y, curR, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }

        // ----------------------------------------------------------
        // LAYER F: Main Emblem + LIVE ANIMATED OPEN BEAK + Sheen
        // ----------------------------------------------------------
        const embReveal = clamp01((baseTime - 1.2) / 1.0);
        if (embReveal > 0.005 && imgs.emblem && imgs.emblem.complete) {
          const scaleE = baseTime < 2.2
            ? lerp(0.58, 1.03, easeOutBack(embReveal))
            : lerp(1.03, 1.0, easeOutCubic((baseTime - 2.2) / 0.85));
          const popPulse = baseTime >= 2.12 ? Math.exp(-(baseTime - 2.12) * 4.2) * 0.055 : 0;
          const finalScale = scaleE + popPulse + beakOpen * 0.028;
          const embAlpha = easeOutCubic(clamp01((baseTime - 1.2) / 0.7));

          // Slight proud upward tilt when eagle cries!
          const proudTilt = -beakOpen * 0.025;

          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(proudTilt);
          ctx.scale(finalScale, finalScale);
          ctx.globalAlpha = embAlpha;

          ctx.shadowColor = isLightTheme ? "rgba(15, 61, 54, 0.25)" : "rgba(0, 0, 0, 0.74)";
          ctx.shadowBlur = isLightTheme ? 28 : 44;
          ctx.shadowOffsetY = 12;

          drawAnimatedEmblemWithBeak(emblemSize, beakOpen);

          ctx.shadowColor = "transparent";
          ctx.shadowBlur = 0;
          ctx.shadowOffsetY = 0;

          // Liquid-Gold Metallic Specular Sweep (3.75s - 4.95s)
          const sheenT = (baseTime - 3.75) / 1.15;
          if (sheenT > 0 && sheenT < 1) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(0, 0, emblemRadius * 0.99, 0, Math.PI * 2);
            ctx.clip();
            ctx.globalCompositeOperation = "lighter";
            const sx = lerp(-emblemSize * 0.9, emblemSize * 0.9, easeInOutQuart(sheenT));
            ctx.rotate(-0.48);
            const sg = ctx.createLinearGradient(sx - 55, 0, sx + 55, 0);
            sg.addColorStop(0, "rgba(255, 240, 190, 0)");
            sg.addColorStop(0.5, "rgba(255, 244, 200, 0.44)");
            sg.addColorStop(1, "rgba(255, 240, 190, 0)");
            ctx.fillStyle = sg;
            ctx.fillRect(sx - 60, -emblemSize, 120, emblemSize * 2);
            ctx.restore();
          }

          if (baseTime > 2.12 && !isLightTheme) {
            ctx.globalCompositeOperation = "lighter";
            ctx.strokeStyle = `rgba(230, 179, 90, ${0.22 + 0.12 * Math.sin(ts * 0.003) + voiceStrength * 0.25})`;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.arc(0, 0, emblemRadius * 1.005, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.restore();

          // Sonic Cry Arcs radiating directly from the open beak!
          for (let i = beakSonicArcs.length - 1; i >= 0; i--) {
            const arc = beakSonicArcs[i];
            arc.life += dt;
            if (arc.life >= arc.maxLife) { beakSonicArcs.splice(i, 1); continue; }
            const p = easeOutCubic(arc.life / arc.maxLife);
            const r = lerp(arc.r, arc.maxR, p);
            const a = (1 - p) * (isLightTheme ? 0.65 : 0.92);
            ctx.save();
            ctx.globalCompositeOperation = isLightTheme ? "source-over" : "lighter";
            ctx.strokeStyle = `rgba(255, 214, 112, ${a})`;
            ctx.lineWidth = 2.6 * (1 - p * 0.6);
            ctx.beginPath();
            ctx.arc(arc.x, arc.y, r, -0.58, 0.68);
            ctx.stroke();
            ctx.restore();
          }

          // Eagle Eye Piercing Golden Star-Flare
          const eyeX = cx + (EAGLE_EYE_NORM.x - 0.5) * emblemSize * finalScale;
          const eyeY = cy + (EAGLE_EYE_NORM.y - 0.5) * emblemSize * finalScale;
          let eyeIntensity = 0;
          if (baseTime >= 2.10 && baseTime < 3.60) {
            const et = baseTime - 2.10;
            eyeIntensity = Math.min(1, et / 0.08) * Math.exp(-et * 2.15);
          }
          if (manualEagleAge >= 0) {
            eyeIntensity = Math.max(eyeIntensity, Math.min(1, manualEagleAge / 0.08) * Math.exp(-manualEagleAge * 2.15));
          }
          if (eyeIntensity > 0.01) {
            drawFourPointStar(eyeX, eyeY, emblemSize * 0.25 * (0.65 + 0.45 * eyeIntensity), eyeIntensity, baseTime * 0.5);
          }
        }

        // ----------------------------------------------------------
        // LAYER G: SYNCHRONIZED CURSIVE "Jarvis Studio" + J.A.R.V.I.S. VOICE!
        // ----------------------------------------------------------
        const wmImg = isLightTheme ? imgs.wordmarkDark : imgs.wordmarkLight;
        // Compute exact 2-word cursive progression synced to J.A.R.V.I.S. speaking "Jarvis" then "Studio"!
        let wmProg = 0;
        const jarvisEnd = VOICE_START + VOICE_DUR * SPLIT_RATIO;
        const studioEnd = VOICE_START + VOICE_DUR + 0.12;
        if (baseTime >= VOICE_START) {
          if (baseTime < jarvisEnd) {
            // Word 1: "Jarvis" (0.0 -> 0.49 of wordmark width)
            const t1 = clamp01((baseTime - VOICE_START) / (jarvisEnd - VOICE_START));
            wmProg = easeInOutQuart(t1) * 0.49;
          } else {
            // Word 2: "Studio" (0.49 -> 1.00 of wordmark width)
            const t2 = clamp01((baseTime - jarvisEnd) / (studioEnd - jarvisEnd));
            wmProg = 0.49 + easeInOutQuart(t2) * 0.51;
          }
        }

        if (wmProg > 0.005 && wmImg && wmImg.complete) {
          const wx = cx - wordmarkW / 2;
          const wy = wordmarkY + lerp(10, 0, easeOutCubic((baseTime - VOICE_START) / 0.75));

          ctx.save();
          ctx.beginPath();
          ctx.rect(wx - 10, wy - 16, (wordmarkW + 20) * wmProg, wordmarkH + 32);
          ctx.clip();

          const glowBoost = voiceStrength * 14;
          ctx.shadowColor = isLightTheme ? "rgba(15, 61, 54, 0.16)" : `rgba(230, 179, 90, ${0.34 + voiceStrength * 0.3})`;
          ctx.shadowBlur = (isLightTheme ? 10 : 18) + glowBoost;
          ctx.drawImage(wmImg, wx, wy, wordmarkW, wordmarkH);
          ctx.restore();

          // Glowing holographic gold-cyan calligraphy stylus tracking the active cursive stroke!
          if (wmProg > 0.02 && wmProg < 0.99) {
            const penX = wx + wordmarkW * wmProg;
            const penY = wy + wordmarkH * 0.46 + Math.sin(wmProg * 34) * (wordmarkH * 0.15);
            drawFourPointStar(penX, penY, 22, 0.9, wmProg * 3.5);
            if (Math.random() < 0.78) {
              spawnSparks(penX, penY, 1, 16, 72, Math.random() > 0.4 ? "#ffe49e" : "#48e5cf", 0.55);
            }
          }
        }

        // Live J.A.R.V.I.S. Holographic Voice Waveform beneath cursive text while speaking!
        const waveY = wordmarkY + wordmarkH + 16;
        if (voiceStrength > 0.01) {
          drawJarvisVoiceWaveform(cx, waveY, Math.min(260, wordmarkW * 0.72), voiceProgress, voiceStrength, ts);
        }

        // Crisp Golden Divider & Tagline Reveal after voice settles
        const tagProg = easeOutCubic((baseTime - (VOICE_START + VOICE_DUR * 0.75)) / 1.0);
        if (tagProg > 0.01) {
          const lineY = wordmarkY + wordmarkH + 16;
          const halfLine = Math.min(120, wordmarkW * 0.36) * tagProg;
          const divFade = clamp01(1 - voiceStrength * 0.65);
          ctx.save();
          const lg = ctx.createLinearGradient(cx - halfLine, lineY, cx + halfLine, lineY);
          lg.addColorStop(0, "rgba(230, 179, 90, 0)");
          lg.addColorStop(0.5, isLightTheme
            ? `rgba(15, 61, 54, ${0.42 * tagProg * divFade})`
            : `rgba(230, 179, 90, ${0.65 * tagProg * divFade})`);
          lg.addColorStop(1, "rgba(230, 179, 90, 0)");
          ctx.strokeStyle = lg;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(cx - halfLine, lineY);
          ctx.lineTo(cx + halfLine, lineY);
          ctx.stroke();

          ctx.font = `500 ${Math.max(9.5, Math.min(11.5, emblemSize * 0.038))}px Inter, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = isLightTheme
            ? `rgba(15, 61, 54, ${0.65 * tagProg})`
            : `rgba(247, 232, 198, ${0.72 * tagProg})`;
          ctx.fillText("CREATIVE INTELLIGENCE".split("").join(" "), cx, lineY + 12);
          ctx.restore();
        }

        // ----------------------------------------------------------
        // LAYER H: Sparks Overlay
        // ----------------------------------------------------------
        for (let i = sparks.length - 1; i >= 0; i--) {
          const sp = sparks[i];
          sp.life += dt;
          if (sp.life >= sp.maxLife) { sparks.splice(i, 1); continue; }
          const p = sp.life / sp.maxLife;
          sp.x += sp.vx * dt;
          sp.y += sp.vy * dt;
          sp.vx *= 0.96;
          sp.vy *= 0.96;
          ctx.save();
          ctx.globalCompositeOperation = isLightTheme ? "source-over" : "lighter";
          ctx.fillStyle = sp.color;
          ctx.globalAlpha = (1 - p) * (isLightTheme ? 0.8 : 1);
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, sp.r * (1 - p * 0.5), 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }

        ctx.restore();
        rafId = requestAnimationFrame(renderFrame);
      }

      // ============================================================
      // 8. LIFECYCLE & INTERACTIVE CONTROLS
      // ============================================================
      function startAnimation(withSound = true) {
        animStarted = true;
        if (rafId) cancelAnimationFrame(rafId);
        baseTime = 0;
        lastFrameTs = 0;
        climaxTriggered = false;
        wingBurstFired = false;
        manualEagleAge = -1;
        manualVoiceAge = -1;
        shakeIntensity = 0;
        sparks.length = 0;
        wingFeathers.length = 0;
        shockwaves.length = 0;
        beakSonicArcs.length = 0;

        if (withSound) {
          playIntroSound(0);
        } else {
          playIntroSound(0);
        }
        rafId = requestAnimationFrame(renderFrame);
      }

      soundBanner.addEventListener("click", (e) => {
        e.stopPropagation();
        isMuted = false;
        updateMuteUI();
        startAnimation(true);
      });

      stage.addEventListener("click", (e) => {
        if (e.target.closest("#controlDock") || e.target.closest("#restoreUiBtn")) return;
        isMuted = false;
        updateMuteUI();
        startAnimation(true);
      });

      replayBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        startAnimation(true);
      });

      eagleSfxBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        playEagleOnly();
      });

      jarvisVoiceBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        playJarvisVoiceOnly();
      });

      function updateMuteUI() {
        muteIcon.textContent = isMuted ? "🔇" : "🔊";
        muteText.textContent = isMuted ? "بی‌صدا" : "صدا روشن";
        muteBtn.classList.toggle("active", isMuted);
        introAudio.muted = isMuted;
        eagleAudio.muted = isMuted;
        jarvisAudio.muted = isMuted;
        if (isMuted) {
          soundBanner.classList.add("hidden");
        }
      }

      muteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        isMuted = !isMuted;
        updateMuteUI();
        if (!isMuted && baseTime < BASE_DURATION) {
          playIntroSound(baseTime);
        }
      });

      themeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        isLightTheme = !isLightTheme;
        stage.classList.toggle("theme-light", isLightTheme);
        themeIcon.textContent = isLightTheme ? "🌙" : "☀️";
        themeText.textContent = isLightTheme ? "تم سینمایی" : "تم روشن";
      });

      durPills.forEach((pill) => {
        pill.addEventListener("click", (e) => {
          e.stopPropagation();
          durPills.forEach((p) => p.classList.remove("selected"));
          pill.classList.add("selected");
          targetDuration = parseFloat(pill.dataset.dur);
          startAnimation(true);
        });
      });

      cleanBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        root.classList.add("clean-mode");
      });

      restoreUiBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        root.classList.remove("clean-mode");
      });

      progressTrack.addEventListener("click", (e) => {
        e.stopPropagation();
        const rect = progressTrack.getBoundingClientRect();
        const ratio = clamp01((e.clientX - rect.left) / rect.width);
        baseTime = ratio * BASE_DURATION;
        climaxTriggered = baseTime >= 2.12;
        wingBurstFired = baseTime >= 1.32;
        if (!isMuted && audioUnlocked) {
          playIntroSound(baseTime);
        }
      });

      // Port: the site document already loaded. If the assets stall,
      // start anyway after 2.5s; and never hold the desk longer than 12s.
      setTimeout(() => {
        if (!animStarted) startAnimation(false);
      }, 2500);
      hardDoneTimer = setTimeout(() => {
        if (!doneFired) {
          doneFired = true;
          if (typeof options.onDone === "function") options.onDone();
        }
      }, 12000);

      function destroy() {
        if (rafId) cancelAnimationFrame(rafId);
        if (doneTimer) clearTimeout(doneTimer);
        if (hardDoneTimer) clearTimeout(hardDoneTimer);
        window.removeEventListener("resize", resizeCanvas);
        stopAllAudio();
      }

      return { destroy, startAnimation };
    }
