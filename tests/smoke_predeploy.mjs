// Smoke test پیش‌دیپلوی (فاز ۵، F11).
// بیلدِ ساخته‌شده (dist/) واقعاً در مرورگر بالا می‌آید یا نه؟
// چک‌ها: خانه، صفحهٔ ورود، #/status (با نشست ساختگی — بدون نشست، #/status
// صفحهٔ ورود را نشان می‌دهد، پس بدون seed، چکِ آن مثبت کاذب می‌شود)،
// #/intro-test. بدون نشست/توکن واقعی.
// Supabase با استاب CDP پاسخ داده می‌شود (الگوی فاز ۴) تا تست به شبکهٔ
// بیرون وابسته نباشد؛ این تست اتصال زندهٔ Supabase را چک نمی‌کند — آن با
// راستی‌آزمایی زندهٔ deploy.sh (curl روی version.json) و ورود یاسین اثبات می‌شود.
// اجرا: node tests/smoke_predeploy.mjs [dist-dir]
// خروجی: exit 0 یعنی همه سبز، exit 1 یعنی رد (با دلیل).
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const ROOT = process.env.HOME + '/workspace/ml-course-v2-work';
const DIST = process.argv[2] || ROOT + '/dist';
const CHROME = process.env.HOME + '/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome';
const PREVIEW_PORT = 4176;
const CDP_PORT = 9339;
const ORIGIN = `http://127.0.0.1:${PREVIEW_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

function fakeSessionJSON(expiresInSec) {
  const now = Math.floor(Date.now() / 1000);
  return JSON.stringify({
    access_token: 'fake-access-token', token_type: 'bearer', expires_in: expiresInSec,
    expires_at: now + expiresInSec, refresh_token: 'fake-refresh-token',
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

const headHash = JSON.parse(fs.readFileSync(DIST + '/version.json', 'utf8')).hash;

const preview = spawn('npx', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort', '--host', '127.0.0.1'], {
  cwd: ROOT, stdio: 'ignore',
});
for (let i = 0; i < 30; i++) {
  try { const r = await fetch(ORIGIN + '/'); if (r.ok) break; } catch {}
  await sleep(300);
}

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--no-sandbox',
  '--disable-dev-shm-usage', '--user-data-dir=/tmp/chrome-profile-phase5-smoke',
  '--ignore-certificate-errors',
  // SwiftShader: بدون GPU هم WebGL در دسترس باشد — وگرنه GoldenNetwork
  // خانه (Three.js) console.error می‌دهد و تست دود بی‌دلیل رد می‌شود.
  '--use-gl=angle', '--use-angle=swiftshader',
  'about:blank',
], { stdio: 'ignore' });

let code = 0;
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
  await send('Fetch.enable', { patterns: [{ urlPattern: '*supabase.co*', requestStage: 'Request' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__smokeErrors = [];
    window.addEventListener('error', (e) => window.__smokeErrors.push('error: ' + (e.message || '?')));
    window.addEventListener('unhandledrejection', (e) => window.__smokeErrors.push('unhandledrejection: ' + (e.reason?.message || e.reason || '?')));
  ` });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.text || 'eval error' };
    return r.result?.result?.value;
  };
  const waitFor = async (fn, timeoutMs = 10000, stepMs = 250) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) { if (await fn()) return true; await sleep(stepMs); }
    return false;
  };
  const pageErrors = async () => {
    const errs = (await evalJs(`window.__smokeErrors || []`)) || [];
    return [...errs, ...events.splice(0)];
  };
  const bodyText = () => evalJs(`document.body ? document.body.innerText : ''`);
  const hasText = async (s) => (await bodyText())?.includes(s);

  // دروازهٔ ورود (۲۵ نوامبر ۲۰۲۶): اگر اسپلش «برای ورود ضربه بزن» هست،
  // آن را می‌زنیم و ویدیو را تا نزدیک پایان جلو می‌بریم تا 'ended' همان‌جا
  // بخورد (شتاب تست؛ رفتار واقعی همان پخش کامل ۱۰ ثانیه‌ای است).
  // اول صبر می‌کنیم اسپلش یا فرم خودش را نشان بدهد — بلافاصله بعد از
  // ریلود، صفحه هنوز mount نشده و نبودِ اسپلش به‌معنای نبودِ دروازه نیست.
  const passEntryGate = async () => {
    const appeared = await waitFor(async () => (await hasText('برای ورود ضربه بزن')) || (await hasText('ورود به دوره')), 8000);
    if (!appeared) return false;
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

  // version.json روی دیسک با هش بیلد می‌خواند
  const served = await (await fetch(ORIGIN + '/version.json')).json();
  check('smoke: version.json هش dist را دارد', served.hash === headHash, `served=${served.hash} dist=${headHash}`);

  // بدون نشست: خانه (صفحهٔ ورود) و صفحهٔ ورود.
  // اول localStorage را تمیز کن — پروفایل مشترک کروم بین اجراها می‌ماند و
  // نشست ساختگیِ اجرای قبلی (`#/status`) وگرنه در `#/` خانهٔ واردشده را
  // نشان می‌دهد و چکِ «ورود به دوره» بی‌دلیل رد می‌شود (رد ۵/۶ در dry-run
  // رفع F2: فقط `#/` رد شد، `#/login` با همان نشانگر سبز بود).
  await send('Page.navigate', { url: ORIGIN + '/#/' });
  await sleep(1500);
  await evalJs(`localStorage.clear()`);
  await send('Page.reload', { ignoreCache: true });
  await sleep(1500);
  await passEntryGate();
  let mounted = await waitFor(async () => await hasText('ورود به دوره'), 10000);
  let errs = await pageErrors();
  check('smoke: خانه بالا می‌آید', mounted && errs.length === 0, mounted ? errs.join(' | ') : 'نشانگر دیده نشد');
  await send('Page.navigate', { url: ORIGIN + '/#/login' });
  await sleep(1200);
  await passEntryGate();
  mounted = await waitFor(async () => await hasText('ورود به دوره'), 10000);
  errs = await pageErrors();
  check('smoke: صفحهٔ ورود بالا می‌آید', mounted && errs.length === 0, mounted ? errs.join(' | ') : 'نشانگر دیده نشد');

  // با نشست ساختگی: صفحهٔ وضعیت واقعی (نه صفحهٔ ورود)
  await send('Page.navigate', { url: ORIGIN + '/#/status' });
  await sleep(1500);
  await evalJs(`localStorage.clear()`);
  await evalJs(`localStorage.setItem('ml-course-v2-auth', ${JSON.stringify(fakeSessionJSON(3600))})`);
  await send('Page.reload', { ignoreCache: true });
  const statusOk = await waitFor(async () => await hasText('وضعیت نسخه‌ها'), 10000);
  const statusErrs = await pageErrors();
  check('smoke: صفحهٔ وضعیت بالا می‌آید (با نشست ساختگی)', statusOk && statusErrs.length === 0, statusOk ? statusErrs.join(' | ') : '«وضعیت نسخه‌ها» دیده نشد');
  const statusTxt = await bodyText();
  // gatewayCommit از version.json همان بیلد خوانده می‌شود — نه هاردکد؛
  // بعد از مرج فاز ۴، کامیت پایلوت عوض می‌شود و تست نباید بی‌دلیل رد شود.
  const gw = served.gatewayCommit;
  check('smoke: صفحهٔ وضعیت سه نسخه را نشان می‌دهد', typeof statusTxt === 'string' && statusTxt.includes('v5') && typeof gw === 'string' && gw !== 'unknown' && statusTxt.includes(gw), `gatewayCommit=${gw}`);

  // بدون نشست: intro-test (مسیر بدون ورود)
  await send('Page.navigate', { url: ORIGIN + '/#/intro-test' });
  const panel = await waitFor(async () => await hasText('تست افتتاحیه'), 10000);
  const introErrs = await pageErrors();
  check('smoke: مسیر intro-test بالا می‌آید + پنل دیباگ', panel && introErrs.length === 0, panel ? introErrs.join(' | ') : 'پنل دیده نشد');

  console.log(`\n==== ${results.filter((r) => r.ok).length}/${results.length} smoke checks passed ====`);
  code = results.every((r) => r.ok) ? 0 : 1;
} catch (e) {
  console.error('SMOKE ERROR:', e?.message || e);
  code = 1;
} finally {
  try { chrome.kill('SIGKILL'); } catch {}
  try { preview.kill('SIGKILL'); } catch {}
}
process.exit(code);
