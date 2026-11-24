// Decisions bundle — local CDP checks: 48px boot mark, Ctrl+K palette,
// return-to-lesson (F8 verify + direct-entry default), all with real text
// markers. STUBBED Supabase + STUBBED fake gateway (same pattern as the
// phase-4 harness). No real accounts, no real codes, no real network.
import { spawn } from 'node:child_process';

const CHROME = process.env.HOME + '/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome';
const PORT = 9339;
const ORIGIN = 'http://127.0.0.1:4173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const stub = { membersMode: 'ok', membersCalls: 0, tokenMode: 'ok', tokenCalls: 0 };
const resetStub = (mode, tokenMode = 'ok') => {
  stub.membersMode = mode;
  stub.membersCalls = 0;
  stub.tokenMode = tokenMode;
  stub.tokenCalls = 0;
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
const EVENT_ROWS = [
  {
    id: 'e1',
    user_id: 'fake-user-id',
    event_type: 'lesson_completed',
    unit_code: 'lesson-1',
    payload: {},
    created_at: '2026-01-02T00:00:00Z',
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

// ---------- CDP plumbing ----------
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

const preview = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort', '--host', '127.0.0.1'], {
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
  '--user-data-dir=/tmp/chrome-profile-decisions',
  '--ignore-certificate-errors',
  'about:blank',
], { stdio: 'ignore' });

let ws;
let abortBundle = false;
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
  const keyEvent = (type, code, key, modifiers = 0) =>
    send('Input.dispatchKeyEvent', { type, code, key, modifiers });
  const pressKey = async (code, key, modifiers = 0) => {
    await keyEvent('keyDown', code, key, modifiers);
    await keyEvent('keyUp', code, key, modifiers);
  };
  const pressCtrlK = () => pressKey('KeyK', 'k', 2);
  const pressCtrlJ = () => pressKey('KeyJ', 'j', 2);
  // setInput با تشخیص برگشتی (برای اشکال‌زدایی: 'OK:<value>' یعنی موفق).
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
    const fulfillGateway = (code, obj) => send('Fetch.fulfillRequest', {
      requestId,
      responseCode: code,
      responseHeaders: [
        { name: 'Content-Type', value: 'application/json' },
        { name: 'Access-Control-Allow-Origin', value: ORIGIN },
        { name: 'Access-Control-Allow-Credentials', value: 'true' },
        { name: 'Vary', value: 'Origin' },
      ],
      body: b64(obj),
    });
    try {
      // B1: abort the main bundle so Svelte never mounts — the boot mark
      // stays visible and can be inspected as the pre-mount state.
      if (abortBundle && /\/assets\/index-[^/]+\.js$/.test(url)) {
        return send('Fetch.failRequest', { requestId, errorReason: 'Aborted' });
      }
      if (url.includes('/__gateway/launch')) {
        return fulfillGateway(401, { detail: { error_code: 'TICKET_INVALID', step: 'ticket', message: 'invalid or expired ticket' } });
      }
      if (url.includes('/__gateway/')) {
        return fulfillGateway(404, { detail: { error_code: 'NOTEBOOK_NOT_FOUND', step: 'notebook', message: 'notebook not found' } });
      }
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
      if (url.includes('/functions/v1/wake')) {
        return fulfill(200, { status: 'available', ticket: 'fake-ticket-1', gateway_url: new URL(url).origin + '/__gateway' });
      }
      if (url.includes('/auth/v1/token') && url.includes('grant_type=password')) {
        stub.tokenCalls++;
        if (stub.tokenMode === 'invalid') {
          return fulfill(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
        }
        return fulfill(200, {
          access_token: 'fake-access-token', token_type: 'bearer', expires_in: 3600,
          refresh_token: 'fake-refresh-token',
          user: { id: 'fake-user-id', aud: 'authenticated', email: 'test@example.com', role: 'authenticated' },
        });
      }
      if (url.includes('/auth/v1/token') && url.includes('grant_type=refresh_token')) {
        return fulfill(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token: Refresh Token Not Found' });
      }
      if (url.includes('/rest/v1/members')) {
        stub.membersCalls++;
        if (stub.membersMode === 'unauthorized') return fulfill(401, { message: 'JWT expired' });
        if (stub.membersMode === 'empty') return fulfill(200, []);
        if (stub.membersMode === 'fail500') return fulfill(500, { message: 'stubbed 500', code: '500' });
        return fulfill(200, MEMBER_ROW);
      }
      if (url.includes('/rest/v1/day_progress')) return fulfill(200, PROGRESS_ROWS);
      if (url.includes('/rest/v1/events')) return fulfill(200, EVENT_ROWS);
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
    patterns: [
      { urlPattern: '*supabase.co*', requestStage: 'Request' },
      { urlPattern: '*assets/index-*', requestStage: 'Request' },
    ],
  });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  const seedAndLoad = async (path, seeds) => {
    await send('Page.navigate', { url: ORIGIN + path });
    await sleep(1500);
    const href = await evalJs('location.href');
    if (typeof href !== 'string' || !href.startsWith(ORIGIN)) {
      throw new Error('page did not load: ' + JSON.stringify(href));
    }
    await evalJs(`localStorage.clear()`);
    for (const [k, v] of Object.entries(seeds || {})) {
      await evalJs(`localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`);
    }
    await send('Page.reload', { ignoreCache: true });
    await sleep(1200);
  };

  // ===== B1: boot mark visible while the bundle is blocked (pre-mount) =====
  abortBundle = true;
  await send('Page.navigate', { url: ORIGIN + '/#/' });
  await sleep(2500);
  const b1Mark = await evalJs(`!!document.getElementById('boot-mark')`);
  check('B1a: boot mark present before mount (bundle aborted)', b1Mark === true);
  const b1Img = await evalJs(`(() => {
    const img = document.querySelector('#boot-mark img');
    if (!img) return null;
    return { src: img.getAttribute('src'), w: img.getAttribute('width'), nw: img.naturalWidth, nh: img.naturalHeight };
  })()`);
  check('B1b: boot img is the 48px ML mark', !!b1Img && String(b1Img.src || '').includes('logo-favicon-48.png') && Number(b1Img.w) === 48 && b1Img.nw === 48 && b1Img.nh === 48, JSON.stringify(b1Img));
  const b1Bg = await evalJs(`(() => {
    const el = document.getElementById('boot-mark');
    if (!el) return '';
    return getComputedStyle(el).backgroundColor;
  })()`);
  check('B1c: boot background is canvas #FAF7F2', b1Bg === 'rgb(250, 247, 242)', String(b1Bg));
  abortBundle = false;

  // ===== B2: after a normal mount the boot mark is gone =====
  resetStub('ok');
  await seedAndLoad('#/login', {});
  const b2Login = await waitFor(async () => await hasText('ورود به دوره'), 8000);
  check('B2a: login page renders after mount', b2Login);
  const b2Gone = await evalJs(`!document.getElementById('boot-mark')`);
  check('B2b: boot mark removed once the app mounts', b2Gone === true);

  // ===== P: Ctrl+K palette (seeded teacher session, home) =====
  resetStub('ok');
  await seedAndLoad('#/', { 'ml-course-v2-auth': fakeSessionJSON(3600) });
  const pHome = await waitFor(async () => await hasText('سلام، Test Teacher'), 8000);
  check('P0: home renders with the seeded session', pHome);
  await pressCtrlK();
  const p1Open = await waitFor(async () => await hasText('پرش سریع میان درس‌ها'), 5000);
  check('P1: Ctrl+K opens the palette', p1Open);
  const p1NoStudio = await evalJs(`!location.hash.startsWith('#/studio')`);
  check('P1b: Ctrl+K does not open the studio', p1NoStudio === true);
  const p2Typed = await setInput('input[aria-label="جست‌وجوی درس"]', 'خط قیمت');
  check('P2a: query typed into the palette', typeof p2Typed === 'string' && p2Typed.startsWith('OK:'), String(p2Typed));
  await sleep(400);
  const p2Count = await evalJs(`document.querySelectorAll('[data-palette-item]').length`);
  check('P2b: filter "خط قیمت" leaves exactly 1 unit', p2Count === 1, `count=${p2Count}`);
  const p2Text = await evalJs(`(() => {
    const panel = document.querySelector('[data-palette-panel]');
    return panel ? panel.innerText.includes('۱-ب — خط قیمت، کاسه هزینه و پایین رفتن از تپه') : false;
  })()`);
  check('P2c: the one item is lesson 1-B with its display name', p2Text);
  await pressKey('Enter', 'Enter');
  const p3Hash = await waitFor(async () => (await evalJs('location.hash')) === '#/lesson/2', 5000);
  check('P3a: Enter navigates to #/lesson/2', p3Hash, await evalJs('location.hash'));
  const p3Closed = await evalJs(`!document.querySelector('[data-palette-panel]')`);
  check('P3b: palette closes after navigation', p3Closed === true);
  // LessonView's H1 is the lesson themeName («تپه و کاسه»), not the unit
  // title — the unit title lives in the sidebar list, not in main.
  const p3Lesson = await waitFor(async () => {
    const mainText = await evalJs(`(() => {
      const m = document.querySelector('main');
      return m ? m.innerText : '';
    })()`);
    return typeof mainText === 'string' && mainText.includes('تپه و کاسه');
  }, 8000);
  check('P3c: lesson 1-B page renders (H1 themeName in main, not the sidebar list)', p3Lesson);

  // P4: arrow-key navigation across several matches
  await pressCtrlK();
  await waitFor(async () => await hasText('پرش سریع میان درس‌ها'), 5000);
  await setInput('input[aria-label="جست‌وجوی درس"]', 'توجه');
  await sleep(400);
  const p4Count = await evalJs(`document.querySelectorAll('[data-palette-item]').length`);
  check('P4a: filter "توجه" leaves several units', p4Count >= 2, `count=${p4Count}`);
  const p4SecondId = await evalJs(`(() => {
    const items = [...document.querySelectorAll('[data-palette-item]')];
    return items[1] ? items[1].getAttribute('data-unit-id') : null;
  })()`);
  await pressKey('ArrowDown', 'ArrowDown');
  await sleep(200);
  const p4Active = await evalJs(`(() => {
    const a = document.querySelector('[data-palette-item][data-active="true"]');
    return a ? a.getAttribute('data-unit-id') : null;
  })()`);
  check('P4b: ArrowDown moves the active item to the 2nd match', p4Active === p4SecondId, `active=${p4Active} second=${p4SecondId}`);
  await pressKey('Enter', 'Enter');
  const p4Expected = p4SecondId === '0' ? '#/lesson/day-0' : `#/lesson/${p4SecondId}`;
  const p4Hash = await waitFor(async () => (await evalJs('location.hash')) === p4Expected, 5000);
  check('P4c: Enter navigates to the 2nd match', p4Hash, `${await evalJs('location.hash')} expected=${p4Expected}`);

  // P5: Esc closes without navigating
  const p5Before = await evalJs('location.hash');
  await pressCtrlK();
  await waitFor(async () => await hasText('پرش سریع میان درس‌ها'), 5000);
  await pressKey('Escape', 'Escape');
  await sleep(300);
  const p5Closed = await evalJs(`!document.querySelector('[data-palette-panel]')`);
  const p5HashSame = (await evalJs('location.hash')) === p5Before;
  check('P5: Esc closes the palette without navigating', p5Closed === true && p5HashSame, `hash=${await evalJs('location.hash')}`);

  // P6: Ctrl+J still toggles the studio (no conflict with Ctrl+K) —
  // independent of P4: start from a known lesson.
  resetStub('ok');
  await seedAndLoad('#/lesson/2', { 'ml-course-v2-auth': fakeSessionJSON(3600) });
  await waitFor(async () => {
    const mainText = await evalJs(`(() => {
      const m = document.querySelector('main');
      return m ? m.innerText : '';
    })()`);
    return typeof mainText === 'string' && mainText.includes('تپه و کاسه');
  }, 8000);
  await pressCtrlJ();
  const p6Studio = await waitFor(async () => (await evalJs('location.hash')).startsWith('#/studio'), 5000);
  check('P6a: Ctrl+J opens the studio (no palette conflict)', p6Studio, await evalJs('location.hash'));
  const p6NoPalette = await evalJs(`!document.querySelector('[data-palette-panel]')`);
  check('P6b: palette is not open after Ctrl+J', p6NoPalette === true);
  const p6Card = await waitFor(async () => await hasText('بلیط ورود منقضی شده است'), 10000);
  check('P6c: studio error card appears (fake gateway 401)', p6Card);
  const p6Back = await clickButton('بازگشت به درس');
  check('P6d: back button clicked', p6Back === true);
  const p6Hash = await waitFor(async () => (await evalJs('location.hash')) === '#/lesson/2', 5000);
  check('P6e: back returns to the lesson entered from (F8 via Ctrl+J)', p6Hash, await evalJs('location.hash'));

  // ===== R1: return-to-lesson from lesson 1 via the sidebar button (F8) =====
  resetStub('ok');
  await seedAndLoad('#/lesson/1', { 'ml-course-v2-auth': fakeSessionJSON(3600) });
  await waitFor(async () => await hasText('یادگیری ماشین چیست؟'), 8000);
  const r1Clicked = await clickButton('ورود به استودیو');
  check('R1a: sidebar studio button clicked from lesson 1', r1Clicked === true);
  const r1Card = await waitFor(async () => await hasText('بلیط ورود منقضی شده است'), 10000);
  check('R1b: launch error card appears', r1Card);
  const r1Back = await clickButton('بازگشت به درس');
  check('R1c: back button clicked', r1Back === true);
  const r1Hash = await waitFor(async () => (await evalJs('location.hash')) === '#/lesson/1', 5000);
  check('R1d: back returns to #/lesson/1 (the recorded origin)', r1Hash, await evalJs('location.hash'));

  // ===== R2: direct entry to #/studio with no recorded origin =====
  resetStub('ok');
  await seedAndLoad('#/studio', { 'ml-course-v2-auth': fakeSessionJSON(3600) });
  const r2Card = await waitFor(async () => await hasText('بلیط ورود منقضی شده است'), 10000);
  check('R2a: launch error card appears on direct studio entry', r2Card);
  const r2Back = await clickButton('بازگشت به درس');
  check('R2b: back button clicked', r2Back === true);
  const r2Hash = await waitFor(async () => (await evalJs('location.hash')) === '#/', 5000);
  check('R2c: direct entry without origin returns to course home #/ (not lesson 0)', r2Hash, await evalJs('location.hash'));

  // ===== T: ورودی لمسی پالت از سایدبار (390px) =====
  resetStub('ok');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await seedAndLoad('#/', { 'ml-course-v2-auth': fakeSessionJSON(3600) });
  const tHome = await waitFor(async () => await hasText('سلام، Test Teacher'), 8000);
  check('T0: home renders at 390px with the seeded session', tHome);
  const tVisible = await evalJs(`(() => {
    const b = document.querySelector('[data-open-palette]');
    if (!b) return false;
    const r = b.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
  })()`);
  check('T1: sidebar quick-search button is visible at 390px', tVisible === true);
  const tClicked = await evalJs(`(() => {
    const b = document.querySelector('[data-open-palette]');
    if (!b) return false;
    b.click();
    return true;
  })()`);
  check('T2: sidebar quick-search button clicked', tClicked === true);
  const tOpen = await waitFor(async () => await hasText('پرش سریع میان درس‌ها'), 5000);
  check('T3: tapping the sidebar button opens the palette', tOpen);
  await pressKey('Escape', 'Escape');
  await sleep(300);
  const tClosed = await evalJs(`!document.querySelector('[data-palette-panel]')`);
  check('T4: Esc closes the palette opened by touch', tClosed === true);
  // دکمه فقط در چیدمانِ واردشده است: نه در صفحهٔ ورود، نه داخل استودیو.
  await seedAndLoad('#/login', {});
  await waitFor(async () => await hasText('ورود به دوره'), 8000);
  const tNoButtonLogin = await evalJs(`!document.querySelector('[data-open-palette]')`);
  check('T5: quick-search button is absent on the login page', tNoButtonLogin === true);
  resetStub('ok');
  await seedAndLoad('#/studio', { 'ml-course-v2-auth': fakeSessionJSON(3600) });
  const tStudioCard = await waitFor(async () => await hasText('بلیط ورود منقضی شده است'), 10000);
  check('T6a: studio error card appears', tStudioCard);
  const tNoButtonStudio = await evalJs(`!document.querySelector('[data-open-palette]')`);
  check('T6b: quick-search button is absent inside the studio', tNoButtonStudio === true);

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
