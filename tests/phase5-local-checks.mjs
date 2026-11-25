// چک‌های محلی فاز ۵ (فقط چیزهایی که بدون یاسین ممکن‌اند):
//   1. تست تاب‌آوری R1 دوباره روی بیلد نهایی (#/intro-test سالم و با ?fail=emblem,jarvis)
//   2. چیدمان ۳۹۰px: ورود (بدون نشست)، خانه + #/status (با نشست ساختگی)، #/intro-test
//   3. شبیه‌سازی تست کهنگی نسخه (F2): بازنویسی version.json در dist سرو‌شده
//      و دیدن اینکه تبِ بازِ نمایان، نسخهٔ تازه را خودش رفرش می‌کند یا نه.
// بدون نشست/توکن واقعی؛ Supabase با استاب CDP پاسخ داده می‌شود (الگوی فاز ۴:
// نشست ساختگی در localStorage + پاسخ‌های ساختگی برای token/members/rest).
// خروجی: خلاصه در stdout + فایل tests/phase5-local-results.json.
// اجرا: node tests/phase5-local-checks.mjs
// توجه: صدای افتتاحیه در headless شنیده نمی‌شود — شنیدن واقعی صدای جارویس
// فقط با گوشی/مرورگر واقعی یاسین در دروازهٔ R4 اثبات می‌شود.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const ROOT = process.env.HOME + '/workspace/ml-course-v2-work';
const DIST = ROOT + '/dist';
const CHROME = process.env.HOME + '/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome';
const PREVIEW_PORT = 4177;
const CDP_PORT = 9340;
const ORIGIN = `http://127.0.0.1:${PREVIEW_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

// ---------- استاب Supabase (الگوی فاز ۴) ----------
function fakeSessionJSON(expiresInSec) {
  const now = Math.floor(Date.now() / 1000);
  return JSON.stringify({
    access_token: 'fake-access-token',
    token_type: 'bearer',
    expires_in: expiresInSec,
    expires_at: now + expiresInSec,
    refresh_token: 'fake-refresh-token',
    user: {
      id: 'fake-user-id', aud: 'authenticated', email: 'test@example.com',
      role: 'authenticated', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
  });
}
function fakeTokenResponse() {
  return {
    access_token: 'fake-access-token', token_type: 'bearer', expires_in: 3600,
    refresh_token: 'fake-refresh-token',
    user: {
      id: 'fake-user-id', aud: 'authenticated', email: 'test@example.com',
      role: 'authenticated', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
  };
}
const MEMBER_ROW = [{
  id: 'member-1', auth_id: 'fake-user-id', role: 'teacher', display_name: 'Test Teacher',
  username: 'test', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}];

const preview = spawn('npx', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort', '--host', '127.0.0.1'], {
  cwd: ROOT, stdio: 'ignore',
});
for (let i = 0; i < 30; i++) {
  try { const r = await fetch(ORIGIN + '/'); if (r.ok) break; } catch {}
  await sleep(300);
}
console.log('preview up');

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--no-sandbox',
  '--disable-dev-shm-usage', '--user-data-dir=/tmp/chrome-profile-phase5',
  '--ignore-certificate-errors',
  // SwiftShader: بدون GPU هم WebGL در دسترس باشد — وگرنه GoldenNetwork
  // خانه (Three.js) console.error می‌دهد.
  '--use-gl=angle', '--use-angle=swiftshader',
  'about:blank',
], { stdio: 'ignore' });

let code = 0;
const savedVersionJson = fs.readFileSync(DIST + '/version.json', 'utf8');
try {
  const getWsUrl = async () => {
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
        const targets = await res.json();
        const page = targets.find((t) => t.type === 'page');
        if (page) return page.webSocketDebuggerUrl;
      } catch {}
      await sleep(250);
    }
    throw new Error('devtools not up');
  };
  const ws = new WebSocket(await getWsUrl());
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const events = [];
  const failedReqs = [];
  const b64 = (obj) => Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)).toString('base64');
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Fetch.requestPaused') {
      const { requestId, request } = m.params;
      const url = request.url;
      const fulfill = (code, obj) => ws.send(JSON.stringify({ id: ++id, method: 'Fetch.fulfillRequest', params: {
        requestId, responseCode: code,
        responseHeaders: [
          { name: 'Content-Type', value: 'application/json' },
          // درس فاز ۴: فراخوانی credentialed پاسخ با ACAO:* را رد می‌کند —
          // origin دقیق + Allow-Credentials بده.
          { name: 'Access-Control-Allow-Origin', value: ORIGIN },
          { name: 'Access-Control-Allow-Credentials', value: 'true' },
          { name: 'Vary', value: 'Origin' },
        ],
        body: b64(obj),
      }}));
      const cont = () => ws.send(JSON.stringify({ id: ++id, method: 'Fetch.continueRequest', params: { requestId } }));
      try {
        if (!url.includes('supabase.co')) return cont();
        if (request.method === 'OPTIONS') {
          return ws.send(JSON.stringify({ id: ++id, method: 'Fetch.fulfillRequest', params: {
            requestId, responseCode: 204,
            responseHeaders: [
              { name: 'Access-Control-Allow-Origin', value: ORIGIN },
              { name: 'Access-Control-Allow-Credentials', value: 'true' },
              { name: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, PATCH, DELETE, OPTIONS' },
              { name: 'Access-Control-Allow-Headers', value: '*' },
              { name: 'Access-Control-Max-Age', value: '86400' },
            ], body: '',
          }}));
        }
        if (url.includes('/auth/v1/token') && url.includes('grant_type=password')) return fulfill(200, fakeTokenResponse());
        if (url.includes('/auth/v1/token') && url.includes('grant_type=refresh_token')) return fulfill(400, { error: 'invalid_grant' });
        if (url.includes('/rest/v1/members')) return fulfill(200, MEMBER_ROW);
        if (url.includes('/rest/v1/')) return fulfill(200, []);
        if (url.includes('/auth/v1/user')) return fulfill(200, fakeTokenResponse().user);
        return fulfill(400, { error: 'stubbed' });
      } catch { return cont(); }
      return;
    }
    if (m.method === 'Network.loadingFailed') failedReqs.push(m.params.errorText + ' ' + (m.params.type || ''));
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400 && !m.params.response.url.includes('supabase.co')) {
      failedReqs.push(`HTTP ${m.params.response.status} ${m.params.response.url}`);
    }
    if (m.method === 'Runtime.exceptionThrown') events.push('exception: ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '?').slice(0, 200));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      events.push('console.error: ' + (m.params.args?.map((a) => a.value ?? a.description ?? '').join(' ') || '').slice(0, 200));
    }
  };
  const send = (method, params = {}) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*supabase.co*', requestStage: 'Request' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__p5errors = [];
    window.addEventListener('error', (e) => window.__p5errors.push('error: ' + (e.message || '?')));
    window.addEventListener('unhandledrejection', (e) => window.__p5errors.push('unhandledrejection: ' + (e.reason?.message || e.reason || '?')));
  ` });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.text || 'eval error' };
    return r.result?.result?.value;
  };
  const waitFor = async (fn, timeoutMs = 10000, stepMs = 300) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) { if (await fn()) return true; await sleep(stepMs); }
    return false;
  };
  const pageErrors = async () => {
    const errs = (await evalJs(`window.__p5errors || []`)) || [];
    return [...errs, ...events.splice(0)];
  };
  const bodyText = () => evalJs(`document.body ? document.body.innerText : ''`);
  const hasText = async (s) => (await bodyText())?.includes(s);
  const go = async (hash) => {
    await send('Page.navigate', { url: ORIGIN + '/' + hash });
    await sleep(1500);
  };
  // seedAndLoad (الگوی فاز ۴): رفتن به مسیر، seed نشست ساختگی، ریلود تازه.
  const seedAndLoad = async (path, seeds) => {
    await send('Page.navigate', { url: ORIGIN + path });
    await sleep(1500);
    await evalJs(`localStorage.clear()`);
    for (const [k, v] of Object.entries(seeds || {})) {
      await evalJs(`localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`);
    }
    await send('Page.reload', { ignoreCache: true });
    await sleep(1500);
    await passEntryGate();
  };

  // دروازهٔ ورود (۲۵ نوامبر ۲۰۲۶): اگر اسپلش «برای ورود ضربه بزن» هست،
  // آن را می‌زنیم و ویدیو را تا نزدیک پایان جلو می‌بریم تا 'ended' همان‌جا
  // بخورد (شتاب تست؛ رفتار واقعی همان پخش کامل ۱۰ ثانیه‌ای است).
  const passEntryGate = async () => {
    if (!(await hasText('برای ورود ضربه بزن'))) return true;
    const clicked = await evalJs(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('برای ورود ضربه بزن'));
      if (!b) return false;
      b.click();
      return true;
    })()`);
    if (!clicked) return false;
    const ff = await waitFor(async () => await evalJs(`(() => {
      const v = document.querySelector('video[src*="video-opening-site-entry-v3"]');
      if (!v || !isFinite(v.duration) || v.duration <= 1) return false;
      v.currentTime = v.duration - 0.3;
      return true;
    })()`), 5000);
    if (!ff) return false;
    return await waitFor(async () => await hasText('ورود به دوره'), 8000);
  };

  // ===== 1. R1 دوباره: افتتاحیه سالم =====
  await go('#/intro-test');
  const doneOk = await waitFor(async () => (await bodyText())?.includes('افتتاحیه تمام شد'), 20000);
  let txt = await bodyText();
  check('R1a: افتتاحیهٔ سالم در ~۸ ثانیه تمام می‌شود', doneOk === true);
  check('R1a: پنل دیباگ 9/9 لود شد', typeof txt === 'string' && txt.includes('9/9 لود شد'), (txt.match(/\d+\/9 لود شد/) || ['?'])[0]);
  check('R1a: rAF بعد از ثانیهٔ ۸ متوقف شد', typeof txt === 'string' && txt.includes('rAF بعد از ثانیهٔ ۸ متوقف شد'));
  check('R1a: بدون خطای صفحه/کنسول', (await pageErrors()).length === 0, (await pageErrors()).join(' | '));

  // ===== 2. R1 دوباره: با دو دارایی مسدود =====
  // نکته: تغییر فقط-هش، کامپوننت IntroTestView را دوباره mount نمی‌کند و
  // failKeys همان [] اول می‌ماند — برای همین اول به about:blank می‌رویم و
  // بعد با لود تازه وارد می‌شویم (مثل تست R1 در مرورگر ابری).
  failedReqs.length = 0;
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(800);
  await send('Page.navigate', { url: ORIGIN + '/#/intro-test?fail=emblem,jarvis' });
  await sleep(1500);
  const doneFail = await waitFor(async () => (await bodyText())?.includes('افتتاحیه تمام شد'), 25000);
  txt = await bodyText();
  check('R1b: افتتاحیه با دارایی مسدود هم تمام می‌شود (بدون بوم خالی)', doneFail === true);
  check('R1b: پنل دیباگ 7/9 لود شد', typeof txt === 'string' && txt.includes('7/9 لود شد'), (txt.match(/\d+\/9 لود شد/) || ['?'])[0]);
  check('R1b: دارایی‌های مسدود با «جایگزین» نام برده شده‌اند', typeof txt === 'string' && txt.includes('جایگزین'));
  check('R1b: بدون خطای صفحه/کنسول', (await pageErrors()).length === 0, (await pageErrors()).join(' | '));

  // ===== 3. چیدمان ۳۹۰px =====
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const check390 = async (label, extra = '') => {
    const overflow = await evalJs(`document.documentElement.scrollWidth`);
    const errs = await pageErrors();
    const len = await evalJs(`document.body ? document.body.innerText.length : 0`);
    check(`390px: ${label} سرریز افقی ندارد`, typeof overflow === 'number' && overflow <= 390, `scrollWidth=${overflow}`);
    check(`390px: ${label} بدون خطای صفحه`, errs.length === 0, errs.join(' | '));
    check(`390px: ${label} محتوا دارد`, typeof len === 'number' && len > 100, `chars=${len}`);
    if (extra) check(`390px: ${label} واقعاً همان صفحه است`, await hasText(extra), `باید «${extra}» دیده شود`);
  };
  // بدون نشست: صفحهٔ ورود (اول از دروازهٔ ورود رد می‌شویم)
  await go('#/login');
  await sleep(2500);
  await passEntryGate();
  await check390('ورود (بدون نشست)', 'ورود به دوره');
  // با نشست ساختگی: خانهٔ واقعی + صفحهٔ وضعیت واقعی
  await seedAndLoad('#/', { 'ml-course-v2-auth': fakeSessionJSON(3600) });
  await waitFor(async () => await hasText('یادگیری ماشین'), 10000);
  await check390('خانه (با نشست ساختگی)', 'یادگیری ماشین');
  await seedAndLoad('#/status', { 'ml-course-v2-auth': fakeSessionJSON(3600) });
  await waitFor(async () => await hasText('وضعیت نسخه‌ها'), 10000);
  await check390('وضعیت (با نشست ساختگی)', 'وضعیت نسخه‌ها');
  // بدون نشست: intro-test
  await send('Page.navigate', { url: ORIGIN + '/#/intro-test' });
  await sleep(2500);
  await check390('intro-test', 'تست افتتاحیه');
  await send('Emulation.clearDeviceMetricsOverride');

  // ===== 4. شبیه‌سازی تست کهنگی نسخه (F2) =====
  // تب روی هشِ dist سرو‌شده باز است؛ version.json را به هش تازه بازنویسی
  // می‌کنیم (مثل یک دیپلوی وسط باز بودن تب) و می‌بینیم تبِ نمایانِ بی‌کار
  // خودش رفرش می‌شود یا نه. بعد hashchange را محرک می‌زنیم.
  // بدون نشست: تبِ تمیزِ ورود.
  await send('Page.navigate', { url: ORIGIN + '/#/' });
  await sleep(1500);
  await evalJs(`localStorage.clear()`);
  await send('Page.reload', { ignoreCache: true });
  await sleep(8000); // تایمر ۵ ثانیه‌ای اولیه بگذرد
  await evalJs(`window.__p5mark = Date.now()`);
  const orig = JSON.parse(savedVersionJson);
  const fake = { ...orig, hash: '0000000', commit: '0000000' };
  fs.writeFileSync(DIST + '/version.json', JSON.stringify(fake, null, 2));
  const servedNew = await (await fetch(ORIGIN + '/version.json')).json();
  check('F2-sim: version.json سرو‌شده هش تازه دارد', servedNew.hash === '0000000');
  let reloaded = false;
  for (let i = 0; i < 15; i++) {
    await sleep(10000);
    const mark = await evalJs(`typeof window.__p5mark`);
    if (mark === 'undefined') { reloaded = true; break; }
  }
  check('F2-sim: تبِ بازِ نمایان ظرف ~۱۵۰ ثانیه خودش رفرش شد', reloaded === true, reloaded ? 'رفرش شد' : 'رفرش نشد — پولینگ دوره‌ای نیست (نسخهٔ تازه فقط با hashchange/visibilitychange دیده می‌شود)');
  if (!reloaded) {
    await evalJs(`window.location.hash = '#/lesson/1'`);
    const reloadedAfterHash = await waitFor(async () => (await evalJs(`typeof window.__p5mark`)) === 'undefined', 20000);
    check('F2-sim: بعد از hashchange، نسخهٔ تازه دیده و رفرش شد', reloadedAfterHash === true, reloadedAfterHash ? 'رفرش شد' : 'حتی hashchange هم رفرش نکرد');
  }
  fs.writeFileSync(DIST + '/version.json', savedVersionJson);

  console.log(`\n==== ${results.filter((r) => r.ok).length}/${results.length} phase5 local checks passed ====`);
  fs.writeFileSync(ROOT + '/tests/phase5-local-results.json', JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  code = results.every((r) => r.ok) ? 0 : 1;
} catch (e) {
  console.error('PHASE5 ERROR:', e?.message || e);
  code = 1;
  try { fs.writeFileSync(DIST + '/version.json', savedVersionJson); } catch {}
} finally {
  try { chrome.kill('SIGKILL'); } catch {}
  try { preview.kill('SIGKILL'); } catch {}
}
process.exit(code);
