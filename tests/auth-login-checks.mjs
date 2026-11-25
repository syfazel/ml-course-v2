// Auth login checks — ورود راحت (بازسازی ۲۵ نوامبر ۲۰۲۶).
// با Supabase ساختگی (همان الگوی decisions-local-checks): بدون حساب
// واقعی، بدون رمز واقعی، بدون شبکهٔ واقعی.
//
// چه چیزی را اثبات می‌کند:
//   L1 (رگرسیون اصلی): رمز درست + یک 401 گذرا روی خواندن عضویت
//       → پس از یک refresh، ورود کامل می‌شود و خانه می‌آید؛
//       هرگز «نشست کاربری شما منقضی شده است» نشان داده نمی‌شود.
//   L2: حتی وقتی خواندن عضویت همیشه 401 می‌دهد و refresh هم مرده
//       است، دیوار دستیِ «پاک‌کردن نشست کهنه» نیست و فرم ورود
//       همان‌جا آمادهٔ ورود دوباره است؛ با سالم‌شدن سرور، ورود
//       دوباره بی‌درنگ کار می‌کند (بدون هیچ قدم دستی).
//   L3: پارامتر سرگردانِ ?code= در آدرس، فرم ورود را به فرم
//       «تعیین رمز عبور تازه» تبدیل نمی‌کند.
//   L4: stash قدیمیِ نسخه‌های پیشین در شروعِ بدون نشست پاک می‌شود
//       و ورود تمیز انجام می‌شود.
//   L5: رمز نادرست با شکل واقعیِ سرور (invalid_credentials) → پیام
//       دقیق «ایمیل یا رمز عبور نادرست است.» + قدمِ «بررسی ایمیل و
//       رمز عبور»؛ هرگز «منقضی» نیست.
//   L6 (رگرسیون حادثهٔ ۲۵ نوامبر): 401 گیت‌وی «Invalid API key»
//       (کلید publishable ناقص) → پیام پیکربندی با نام خودش
//       (AUTH_BAD_API_KEY) + دکمهٔ «کپی گزارش خطا»؛ هرگز «نشست
//       منقضی شده» نشان داده نمی‌شود.
import { spawn } from 'node:child_process';

const CHROME = process.env.HOME + '/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome';
const PORT = 9341;
const ORIGIN = 'http://127.0.0.1:4175';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const stub = { membersMode: 'ok', membersCalls: 0, tokenMode: 'ok', refreshMode: 'ok' };
const resetStub = (membersMode, tokenMode = 'ok', refreshMode = 'ok') => {
  stub.membersMode = membersMode;
  stub.membersCalls = 0;
  stub.tokenMode = tokenMode;
  stub.refreshMode = refreshMode;
};

const MEMBER_ROW = [
  {
    id: 'member-1',
    auth_id: 'fake-user-id',
    role: 'teacher',
    display_name: 'Test Teacher',
    username: 'test',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];
const PROGRESS_ROWS = [
  {
    id: 'p1',
    user_id: 'fake-user-id',
    unit_code: 'day-0',
    status: 'done',
    completed_steps: 5,
    score_exact: null,
    started_at: '2026-01-01T00:00:00Z',
    completed_at: '2026-01-02T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
  },
];

function fakeSessionJSON(expiresInSec) {
  const now = Math.floor(Date.now() / 1000);
  return JSON.stringify({
    access_token: 'fake-access-token',
    token_type: 'bearer',
    expires_in: expiresInSec,
    expires_at: now + expiresInSec,
    refresh_token: 'fake-refresh-token',
    user: {
      id: 'fake-user-id',
      aud: 'authenticated',
      email: 'test@example.com',
      role: 'authenticated',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  });
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

function b64(obj) {
  return Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)).toString('base64');
}

const preview = spawn('npx', ['vite', 'preview', '--port', '4175', '--strictPort', '--host', '127.0.0.1'], {
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
  '--user-data-dir=/tmp/chrome-profile-auth-login',
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
    if (m.method === 'Fetch.requestPaused') void onRequestPaused(m.params);
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
  const setInput = (sel, v) => evalJs(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return 'NO-EL';
    try {
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (!desc || !desc.set) return 'NO-SETTER';
      desc.set.call(el, ${JSON.stringify(v)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return 'OK:' + el.value;
    } catch (err) { return 'THREW:' + err.message; }
  })()`);

  async function onRequestPaused(params) {
    const { requestId, request } = params;
    const url = request.url;
    const fulfill = (code, obj, headers = {}) => send('Fetch.fulfillRequest', {
      requestId,
      responseCode: code,
      responseHeaders: [
        { name: 'Content-Type', value: 'application/json' },
        { name: 'Access-Control-Allow-Origin', value: '*' },
        ...Object.entries(headers).map(([name, value]) => ({ name, value })),
      ],
      body: b64(obj),
    });
    const cont = () => send('Fetch.continueRequest', { requestId });
    try {
      if (!url.includes('supabase.co')) return cont();
      if (request.method === 'OPTIONS') {
        return send('Fetch.fulfillRequest', {
          requestId,
          responseCode: 204,
          responseHeaders: [
            { name: 'Access-Control-Allow-Origin', value: '*' },
            { name: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, PATCH, DELETE, OPTIONS' },
            { name: 'Access-Control-Allow-Headers', value: '*' },
            { name: 'Access-Control-Max-Age', value: '86400' },
          ],
          body: '',
        });
      }
      if (url.includes('/auth/v1/token') && url.includes('grant_type=password')) {
        if (stub.tokenMode === 'invalid') {
          // شکل واقعیِ مشاهده‌شده روی سرور زنده (۲۵ نوامبر ۲۰۲۶):
          // 400 {"error_code":"invalid_credentials","msg":"Invalid login credentials"}
          return fulfill(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        }
        if (stub.tokenMode === 'bad-key') {
          // شکل واقعیِ گیت‌وی وقتی کلید publishable بیلد ناقص است
          // (حادثهٔ ۲۵ نوامبر): 401 {"message":"Invalid API key"} —
          // این خطا هرگز نباید «نشست منقضی شده» نشان داده شود.
          return fulfill(401, { message: 'Invalid API key', hint: 'Double check your API key.' });
        }
        return fulfill(200, {
          access_token: 'fake-access-token', token_type: 'bearer', expires_in: 3600,
          refresh_token: 'fake-refresh-token',
          user: { id: 'fake-user-id', aud: 'authenticated', email: 'test@example.com', role: 'authenticated' },
        });
      }
      if (url.includes('/auth/v1/token') && url.includes('grant_type=refresh_token')) {
        if (stub.refreshMode === 'dead') {
          // شکل واقعیِ مشاهده‌شده روی سرور زنده (۲۵ نوامبر ۲۰۲۶):
          // 400 {"error_code":"validation_failed","msg":"Refresh token is not valid"}
          return fulfill(400, { code: 400, error_code: 'validation_failed', msg: 'Refresh token is not valid' });
        }
        return fulfill(200, {
          access_token: 'fake-access-token-2', token_type: 'bearer', expires_in: 3600,
          refresh_token: 'fake-refresh-token-2',
          user: { id: 'fake-user-id', aud: 'authenticated', email: 'test@example.com', role: 'authenticated' },
        });
      }
      if (url.includes('/auth/v1/token') && url.includes('grant_type=pkce')) {
        return fulfill(400, { error: 'invalid_grant', error_description: 'Invalid code' });
      }
      if (url.includes('/rest/v1/members')) {
        stub.membersCalls++;
        if (stub.membersMode === 'unauthorized-always') return fulfill(401, { code: 'PGRST301', message: 'JWT expired' });
        if (stub.membersMode === 'unauthorized-once' && stub.membersCalls === 1) {
          return fulfill(401, { code: 'PGRST301', message: 'JWT expired' });
        }
        if (stub.membersMode === 'empty') return fulfill(200, []);
        return fulfill(200, MEMBER_ROW);
      }
      if (url.includes('/rest/v1/day_progress')) return fulfill(200, PROGRESS_ROWS);
      if (url.includes('/rest/v1/')) return fulfill(200, []);
      if (url.includes('/auth/v1/user')) {
        return fulfill(200, { id: 'fake-user-id', aud: 'authenticated', email: 'test@example.com', role: 'authenticated' });
      }
      return fulfill(400, { error: 'stubbed' });
    } catch {
      return cont();
    }
  }

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Fetch.enable', {
    patterns: [{ urlPattern: '*supabase.co*', requestStage: 'Request' }],
  });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  const seedAndLoad = async (path, seeds) => {
    await send('Page.navigate', { url: ORIGIN + path });
    await sleep(1500);
    await evalJs(`localStorage.clear()`);
    for (const [k, v] of Object.entries(seeds || {})) {
      await evalJs(`localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`);
    }
    await send('Page.reload', { ignoreCache: true });
    await sleep(1200);
  };

  const loginWith = async (email, password) => {
    const e = await setInput('input[type="email"]', email);
    const p = await setInput('input[type="password"]', password);
    if (typeof e !== 'string' || !e.startsWith('OK:')) return `email:${e}`;
    if (typeof p !== 'string' || !p.startsWith('OK:')) return `password:${p}`;
    const clicked = await clickButton('ورود به دوره');
    if (!clicked) return 'no-login-button';
    return 'ok';
  };

  // ===== L1: رمز درست + یک 401 گذرا روی عضویت → خانه، بدون «منقضی» =====
  resetStub('unauthorized-once', 'ok', 'ok');
  await seedAndLoad('#/login', {});
  check('L1a: login page renders', await waitFor(async () => await hasText('ورود به دوره'), 8000));
  check('L1b: credentials typed + login clicked', (await loginWith('test@example.com', 'correct-password')) === 'ok');
  const l1Home = await waitFor(async () => await hasText('سلام، Test Teacher'), 10000);
  check('L1c: home renders after transient members 401 + refresh', l1Home);
  check('L1d: no "session expired" text after correct-password login', !(await hasText('نشست کاربری شما منقضی شده')));
  check('L1e: members was retried after refresh (2+ calls)', stub.membersCalls >= 2, `calls=${stub.membersCalls}`);

  // ===== L2: 401 همیشگی + refresh مرده → بدون دیوار دستی، ورود دوباره کار می‌کند =====
  resetStub('unauthorized-always', 'ok', 'dead');
  await seedAndLoad('#/login', {});
  check('L2a: login page renders', await waitFor(async () => await hasText('ورود به دوره'), 8000));
  check('L2b: credentials typed + login clicked', (await loginWith('test@example.com', 'correct-password')) === 'ok');
  await sleep(2500);
  check('L2c: no manual "clear stale session" wall button', !(await hasText('پاک‌کردن نشست کهنه')));
  check('L2d: login form is still usable (email field present)', (await evalJs(`!!document.querySelector('input[type="email"]')`)) === true);
  // سرور سالم می‌شود؛ ورود دوباره بی‌درنگ و بدون هیچ قدم دستی کار می‌کند.
  resetStub('ok', 'ok', 'ok');
  check('L2e: re-login typed + clicked', (await loginWith('test@example.com', 'correct-password')) === 'ok');
  const l2Home = await waitFor(async () => await hasText('سلام، Test Teacher'), 10000);
  check('L2f: home renders on immediate re-login (no manual clearing)', l2Home);
  check('L2g: still no "session expired" text', !(await hasText('نشست کاربری شما منقضی شده')));

  // ===== L3: ?code= سرگردان، فرم ورود را به بازیابی رمز تبدیل نمی‌کند =====
  resetStub('ok');
  await send('Page.navigate', { url: ORIGIN + '/?code=zzz-stray#/login' });
  await sleep(1500);
  await evalJs(`localStorage.clear()`);
  await send('Page.reload', { ignoreCache: true });
  await sleep(1500);
  check('L3a: login form renders with stray ?code=', await waitFor(async () => await hasText('ورود به دوره'), 8000));
  check('L3b: reset-password form is NOT forced by stray ?code=', !(await hasText('تعیین رمز عبور تازه')));

  // ===== L4: stash قدیمی در شروعِ بدون نشست پاک می‌شود؛ ورود تمیز =====
  resetStub('ok');
  await seedAndLoad('#/login', {
    ml_v2_stashed_session: JSON.stringify({
      access_token: 'stale-access', refresh_token: 'stale-refresh',
      expires_at: Math.floor(Date.now() / 1000) - 3600, user_id: 'fake-user-id',
      stashed_at: Date.now() - 86400000,
    }),
  });
  await waitFor(async () => await hasText('ورود به دوره'), 8000);
  const l4StashGone = await evalJs(`localStorage.getItem('ml_v2_stashed_session') === null`);
  check('L4a: legacy stash is purged on unauthenticated startup', l4StashGone === true);
  check('L4b: login works from the cleaned state', (await loginWith('test@example.com', 'correct-password')) === 'ok');
  const l4Home = await waitFor(async () => await hasText('سلام، Test Teacher'), 10000);
  check('L4c: home renders after clean login', l4Home);

  // ===== L5: رمز نادرست با شکل واقعی سرور → پیام دقیق، نه «ناموفق» کلی =====
  resetStub('ok', 'invalid', 'ok');
  await seedAndLoad('#/login', {});
  check('L5a: login page renders', await waitFor(async () => await hasText('ورود به دوره'), 8000));
  check('L5b: wrong-password typed + login clicked', (await loginWith('test@example.com', 'wrong-password')) === 'ok');
  const l5Text = await waitFor(async () => await hasText('ایمیل یا رمز عبور نادرست است.'), 8000);
  check('L5c: invalid credentials map to the exact message (observed server shape)', l5Text);
  check('L5d: code is AUTH_INVALID_CREDENTIALS', await hasText('AUTH_INVALID_CREDENTIALS'));
  check('L5e: step label shows the password step', await hasText('قدم: بررسی ایمیل و رمز عبور'));
  check('L5f: no "session expired" text on wrong password', !(await hasText('نشست کاربری شما منقضی شده')));

  // ===== L6: کلید API نامعتبر (حادثهٔ ۲۵ نوامبر) هرگز «منقضی» نیست =====
  resetStub('ok', 'bad-key', 'ok');
  await seedAndLoad('#/login', {});
  check('L6a: login page renders', await waitFor(async () => await hasText('ورود به دوره'), 8000));
  check('L6b: login clicked with bad gateway key', (await loginWith('test@example.com', 'correct-password')) === 'ok');
  const l6Text = await waitFor(async () => await hasText('پیکربندی ورود روی سرور خراب است'), 8000);
  check('L6c: bad API key maps to the config message, by its own name', l6Text);
  check('L6d: code is AUTH_BAD_API_KEY', await hasText('AUTH_BAD_API_KEY'));
  check('L6e: gateway 401 NEVER renders as session-expired', !(await hasText('نشست کاربری شما منقضی شده')));
  check('L6f: copy-diagnosis button is offered', await hasText('کپی گزارش خطا برای استاد'));

  // ===== no unhandled page exceptions during the run =====
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
