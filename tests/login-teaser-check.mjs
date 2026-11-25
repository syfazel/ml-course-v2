// Login teaser check — ویدیوی Veo پس‌زمینهٔ صفحهٔ ورود (۲۵ نوامبر ۲۰۲۶).
// بدون حساب واقعی، بدون رمز واقعی، بدون شبکهٔ واقعی: پیش‌نمایش محلی
// dist + کروم headless از راه CDP (همان الگوی tests/auth-login-checks.mjs).
//
//   T1: ویدیوی پس‌زمینهٔ ورود، ویدیوی Veo است (src + poster).
//   T2: ویژگی‌ها سر جایشان‌اند: muted، loop، playsinline، preload=metadata، autoplay.
//   T3: ویدیو در حال پخش است و currentTime جلو می‌رود (نه فریم صفر).
//   T4: دکمهٔ «توقف حرکت» ویدیو را pause و دوباره play می‌کند.
//   T5: هیچ ارجاعی به تیزر v3 در صفحهٔ ورود نیست.
//   T6: با prefers-reduced-motion: reduce ویدیو autoplay نمی‌شود و
//       دکمهٔ توقف حرکت رندر نمی‌شود (رفتار reduced-motion حفظ شده).
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

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  // ===== بارگذاری معمولی: ویدیوی Veo پس‌زمینه است و پخش می‌شود =====
  await send('Page.navigate', { url: ORIGIN + '/#/login' });
  await sleep(1500);
  await evalJs(`localStorage.clear()`);
  await send('Page.reload', { ignoreCache: true });
  await sleep(2000);
  check('T0: login card renders', await waitFor(async () => await hasText('ورود به دوره'), 8000));

  const v1 = await videoState();
  check('T1a: background video element exists', v1 !== null);
  check('T1b: video src is the Veo entry video', typeof v1?.src === 'string' && v1.src.includes('video-entry-veo-v1.mp4'), v1?.src || 'no-src');
  check('T1c: video poster is cover-hero', typeof v1?.poster === 'string' && v1.poster.includes('covers/cover-hero.jpg'), v1?.poster || 'no-poster');
  check('T2: muted + loop + playsinline + preload=metadata + autoplay', v1?.muted === true && v1?.loop === true && v1?.playsInline === true && v1?.preload === 'metadata' && v1?.autoplayAttr === true);

  const t0 = v1?.currentTime;
  await sleep(2000);
  const v2 = await videoState();
  check('T3a: video is playing (not paused)', v2?.paused === false, `paused=${v2?.paused}`);
  check('T3b: currentTime advances (not stuck on frame 0)', typeof t0 === 'number' && typeof v2?.currentTime === 'number' && v2.currentTime > t0, `t0=${t0} t1=${v2?.currentTime}`);

  check('T4a: stop-motion toggle clicked (pause)', (await clickButton('توقف حرکت')) === true);
  await sleep(400);
  const v3 = await videoState();
  check('T4b: video paused after toggle', v3?.paused === true, `paused=${v3?.paused}`);
  // برچسب دکمه با pause عوض می‌شود: «توقف حرکت» → «پخش حرکت».
  check('T4c: toggle clicked again (resume)', (await clickButton('پخش حرکت')) === true);
  await sleep(800);
  const v4 = await videoState();
  check('T4d: video playing again after second toggle', v4?.paused === false, `paused=${v4?.paused}`);

  const pageHtml = await evalJs(`document.documentElement.outerHTML`);
  check('T5: no v3 teaser reference on the login page', typeof pageHtml === 'string' && !pageHtml.includes('video-teaser-logo-v3'));

  // ===== reduced-motion: ویدیو autoplay نمی‌شود، دکمه نیست =====
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Page.reload', { ignoreCache: true });
  await sleep(2000);
  const v5 = await videoState();
  check('T6a: video does NOT autoplay under reduced-motion', v5?.paused === true && v5?.autoplayAttr === false, `paused=${v5?.paused} autoplayAttr=${v5?.autoplayAttr}`);
  check('T6b: stop-motion toggle is not rendered under reduced-motion', !(await hasText('توقف حرکت')));
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

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
