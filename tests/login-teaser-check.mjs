// Login entry-gate check — دروازهٔ ورود با افتتاحیهٔ تاییدشده (۲۵ نوامبر ۲۰۲۶).
// بدون حساب واقعی، بدون رمز واقعی، بدون شبکهٔ واقعی: پیش‌نمایش محلی
// dist + کروم headless از راه CDP (همان الگوی tests/auth-login-checks.mjs).
//
// رفتار موردانتظار (تیک یاسین ۲۵ نوامبر ~۱۳:۱۶):
//   اول صفحهٔ «برای ورود ضربه بزن»؛ همان ضربه ویدیوی افتتاحیه را با صدا
//   پخش می‌کند؛ بعد از تمام‌شدن ویدیو (۱۰ ثانیه) فرم ورود می‌آید.
//   در reduced-motion و در مسیر بازیابی رمز، دروازه اصلاً نشان داده نمی‌شود.
//
//   T0: روی بارگذاری، اسپلش دروازه دیده می‌شود و فرم ورود هنوز نیست.
//   T1: بعد از ضربه، ویدیوی افتتاحیه با صدا پخش می‌شود و جلو می‌رود.
//   T2: بعد از تمام‌شدن ویدیو، فرم ورود می‌آید و ویدیوی Veo پس‌زمینه پخش می‌شود.
//   T3: ویژگی‌های ویدیوی Veo سر جایشان‌اند: muted، loop، playsinline، preload=metadata، autoplay.
//   T4: دکمهٔ «توقف حرکت» ویدیوی Veo را pause و دوباره play می‌کند.
//   T5: با prefers-reduced-motion: reduce دروازه نیست، فرم مستقیم می‌آید و
//       ویدیوی Veo autoplay نمی‌شود و دکمهٔ توقف حرکت رندر نمی‌شود.
//   T6: در مسیر #/reset-password دروازه نیست و فرم تعیین رمز مستقیم می‌آید.
//   T7: کارت ورود سر جایش است و version.json هشِ همین کامیت را می‌گوید.
import { spawn, execSync } from 'node:child_process';

const CHROME = process.env.HOME + '/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome';
const PORT = 9342;
const ORIGIN = 'http://127.0.0.1:4176';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('devtools not up');
}

const preview = spawn('npx', ['vite', 'preview', '--port', '4176', '--strictPort', '--host', '127.0.0.1'], {
  cwd: process.env.HOME + '/workspace/ml-course-v2-work',
  stdio: 'ignore',
});
for (let i = 0; i < 30; i++) {
  try {
    const r = await fetch(ORIGIN + '/');
    if (r.ok) break;
  } catch {}
  await sleep(300);
}
console.log('preview up');

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  // فقط محیط تست: پخش خودکارِ بی‌صدا در مرورگر واقعی مجاز است،
  // ولی کروم headless بدون این پرچم آن را مسدود می‌کند.
  '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=/tmp/chrome-profile-login-teaser',
  '--ignore-certificate-errors',
  'about:blank',
], { stdio: 'ignore' });

let ws;
const pageExceptions = [];
try {
  ws = new WebSocket(await getWsUrl());
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      pageExceptions.push(m.params?.exceptionDetails?.text || 'page exception');
    }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.text || 'eval error' };
    return r.result?.result?.value;
  };
  const text = () => evalJs(`document.body ? document.body.innerText : ''`);
  const hasText = async (s) => (await text())?.includes(s);
  const clickButton = (label) => evalJs(`(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes(${JSON.stringify(label)}));
    if (!b) return false;
    b.click();
    return true;
  })()`);
  const waitFor = async (fn, timeoutMs = 8000, stepMs = 200) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (await fn()) return true;
      await sleep(stepMs);
    }
    return false;
  };
  const videoState = () => evalJs(`(() => {
    const v = document.querySelector('video.teaser-video');
    if (!v) return null;
    return {
      src: v.currentSrc || '',
      poster: v.getAttribute('poster') || '',
      paused: v.paused,
      muted: v.muted,
      loop: v.loop,
      playsInline: v.playsInline,
      preload: v.getAttribute('preload') || '',
      autoplayAttr: v.hasAttribute('autoplay'),
      currentTime: v.currentTime,
      readyState: v.readyState,
    };
  })()`);
  const entryVideoState = () => evalJs(`(() => {
    const v = document.querySelector('video[src*="video-opening-site-entry-v3"]');
    if (!v) return null;
    return {
      src: v.currentSrc || '',
      paused: v.paused,
      muted: v.muted,
      loop: v.loop,
      currentTime: v.currentTime,
      duration: v.duration,
      readyState: v.readyState,
    };
  })()`);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  // ===== بارگذاری معمولی: اول اسپلش دروازه، فرم ورود هنوز نیست =====
  await send('Page.navigate', { url: ORIGIN + '/#/login' });
  await sleep(1500);
  await evalJs(`localStorage.clear()`);
  await send('Page.reload', { ignoreCache: true });
  await sleep(2000);
  check('T0a: entry splash shows on load', await waitFor(async () => await hasText('برای ورود ضربه بزن'), 8000));
  check('T0b: login card is NOT shown yet', !(await hasText('ورود به دوره')));

  // ===== ضربه → ویدیوی افتتاحیه با صدا پخش می‌شود =====
  check('T1a: splash button clicked', (await clickButton('برای ورود ضربه بزن')) === true);
  await sleep(1200);
  const e1 = await entryVideoState();
  check('T1b: entry video element exists', e1 !== null);
  check('T1c: entry video src is the approved opening', typeof e1?.src === 'string' && e1.src.includes('video-opening-site-entry-v3.mp4'), e1?.src || 'no-src');
  check('T1d: entry video plays WITH sound (not muted)', e1?.paused === false && e1?.muted === false, `paused=${e1?.paused} muted=${e1?.muted}`);
  const et0 = e1?.currentTime;
  await sleep(2000);
  const e2 = await entryVideoState();
  check('T1e: entry video currentTime advances', typeof et0 === 'number' && typeof e2?.currentTime === 'number' && e2.currentTime > et0, `t0=${et0} t1=${e2?.currentTime}`);

  // ===== تمام‌شدن ویدیو → فرم ورود + ویدیوی Veo =====
  check('T2a: login card appears after the video ends', await waitFor(async () => await hasText('ورود به دوره'), 20000, 500));
  const v1 = await videoState();
  check('T2b: background video element exists', v1 !== null);
  check('T2c: background video src is the Veo entry video', typeof v1?.src === 'string' && v1.src.includes('video-entry-veo-v1.mp4'), v1?.src || 'no-src');
  check('T2d: background video poster is cover-hero', typeof v1?.poster === 'string' && v1.poster.includes('covers/cover-hero.jpg'), v1?.poster || 'no-poster');
  check('T3: Veo muted + loop + playsinline + preload=metadata + autoplay', v1?.muted === true && v1?.loop === true && v1?.playsInline === true && v1?.preload === 'metadata' && v1?.autoplayAttr === true);

  const t0 = v1?.currentTime;
  await sleep(2000);
  const v2 = await videoState();
  check('T3b: Veo video is playing (not paused)', v2?.paused === false, `paused=${v2?.paused}`);
  check('T3c: Veo currentTime advances', typeof t0 === 'number' && typeof v2?.currentTime === 'number' && v2.currentTime > t0, `t0=${t0} t1=${v2?.currentTime}`);

  check('T4a: stop-motion toggle clicked (pause)', (await clickButton('توقف حرکت')) === true);
  await sleep(400);
  const v3 = await videoState();
  check('T4b: video paused after toggle', v3?.paused === true, `paused=${v3?.paused}`);
  check('T4c: toggle clicked again (resume)', (await clickButton('پخش حرکت')) === true);
  await sleep(800);
  const v4 = await videoState();
  check('T4d: video playing again after second toggle', v4?.paused === false, `paused=${v4?.paused}`);

  // ===== reduced-motion: دروازه نیست، فرم مستقیم می‌آید =====
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Page.reload', { ignoreCache: true });
  await sleep(2000);
  check('T5a: no entry splash under reduced-motion', !(await hasText('برای ورود ضربه بزن')));
  check('T5b: login card shows directly under reduced-motion', await hasText('ورود به دوره'));
  const v5 = await videoState();
  check('T5c: Veo video does NOT autoplay under reduced-motion', v5?.paused === true && v5?.autoplayAttr === false, `paused=${v5?.paused} autoplayAttr=${v5?.autoplayAttr}`);
  check('T5d: stop-motion toggle is not rendered under reduced-motion', !(await hasText('توقف حرکت')));
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  // ===== مسیر بازیابی رمز: دروازه نیست =====
  await send('Page.navigate', { url: ORIGIN + '/#/reset-password' });
  await sleep(2000);
  check('T6a: no entry splash on reset-password route', !(await hasText('برای ورود ضربه بزن')));
  check('T6b: reset form shows directly', await hasText('تعیین رمز عبور تازه'));

  // ===== نسخهٔ بیلد =====
  const version = await (await fetch(ORIGIN + '/version.json')).json().catch(() => null);
  const headHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  check('T7: version.json hash matches this commit', version?.hash === headHash, `hash=${version?.hash} head=${headHash}`);

  check('X1: no unhandled page exceptions', pageExceptions.length === 0, pageExceptions.join(' | '));

  ws.close();
} finally {
  try { ws?.close(); } catch {}
  chrome.kill('SIGKILL');
  preview.kill('SIGKILL');
}

const failed = results.filter((r) => !r.ok);
console.log(`\n==== ${results.length - failed.length}/${results.length} passed ====`);
if (failed.length) {
  console.log('FAILED:', failed.map((f) => f.name).join(' | '));
  process.exit(1);
}
