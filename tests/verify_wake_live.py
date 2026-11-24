#!/usr/bin/env python3
"""Jarvis Studio Phase 3 — LIVE wake test driver (run after the Supabase deploy).

Chain under test: Edge Function wake -> codespace start -> ticket
-> Gateway /launch -> /execute, against the REAL verify_studio_ticket RPC.

Two modes:
  1. Full chain (needs a course-user JWT in env WAKE_JWT):
       WAKE_JWT=<jwt> python3 verify_wake_live.py
     Calls POST /functions/v1/wake (retries on 202), then /launch with the
     returned ticket, then /execute hello + state + error regression.
  2. Direct ticket (no JWT needed; ticket inserted via the Supabase
     dashboard SQL Editor first — see notes below):
       python3 verify_wake_live.py --ticket <64-hex> --gateway <url>
     Tests Gateway <-> real RPC only: /launch, cookie, /execute, regression.
     The dashboard insert for a test ticket (expires in 10 min):
       insert into public.studio_tickets
         (ticket_hash, user_id, user_email, role, codespace_name, expires_at)
       values ('<sha256 of the ticket>', '<teacher uuid>', 'syfazel@gmail.com',
               'teacher', 'ubiquitous-sniffle-pgqpp7ppq4g2r56w',
               now() + interval '10 minutes');
     (user_id: the teacher's auth.users id, readable in the dashboard Auth
     users list. The ticket plaintext is the 64-hex string whose SHA-256 is
     stored; compute it with: printf %s <ticket> | sha256sum.)

Exit 0 only if every check passes. All output is evidence, not claims.
"""
import json
import os
import random
import sys
import time
import urllib.request
import urllib.error

SUPABASE_URL = "https://awznimzcsmpaadvqwodg.supabase.co"
WAKE_URL = SUPABASE_URL + "/functions/v1/wake"
ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
CODESPACES_NAME = "ubiquitous-sniffle-pgqpp7ppq4g2r56w"
GATEWAY_URL = f"https://{CODESPACES_NAME}-8000.app.github.dev"

PASS = 0
FAIL = 0


def check(name, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"PASS {name} {detail}")
    else:
        FAIL += 1
        print(f"FAIL {name} {detail}")


def req(method, url, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    for k, v in (headers or {}).items():
        r.add_header(k, v)
    if data is not None:
        r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, timeout=65) as resp:
            return resp.status, resp.read().decode(), resp.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(), e.headers
    except Exception as e:
        return 0, f"transport error: {e}", {}


def call_wake(jwt):
    """POST /wake; follow 202 retries for up to ~3 min. Returns (ticket, gateway_url) or (None, None)."""
    headers = {"Authorization": f"Bearer {jwt}", "apikey": ANON_KEY}
    for attempt in range(18):
        status, body, _ = req("POST", WAKE_URL, {}, headers)
        print(f"wake attempt {attempt + 1}: HTTP {status} {body[:300]}")
        if status == 200:
            try:
                data = json.loads(body)
            except Exception:
                return None, None
            if data.get("ticket") and data.get("gateway_url"):
                return data["ticket"], data["gateway_url"]
            return None, None
        if status == 202:
            try:
                retry = int(json.loads(body).get("retry_after_seconds", 10))
            except Exception:
                retry = 10
            time.sleep(min(retry, 15))
            continue
        return None, None
    return None, None


def session_cookie_for(ticket, gateway):
    # Cache-buster: the tunnel was seen serving stale authenticated GETs.
    url = f"{gateway}/launch?ticket={ticket}&_={random.randint(0, 10 ** 9)}"
    status, body, headers = req("GET", url, headers={"Cookie": ""})
    cookies = headers.get_all("Set-Cookie") or []
    session = None
    for c in cookies:
        if c.startswith("studio_session="):
            session = c.split(";")[0]
    print(f"/launch: HTTP {status} {body[:200]} cookie={'yes' if session else 'no'}")
    return status, session


def execute(gateway, cookie, code):
    status, body, _ = req(
        "POST", f"{gateway}/execute",
        {"code": code, "notebook": "wake-live-test"},
        headers={"Cookie": cookie},
    )
    return status, body


def main():
    args = sys.argv[1:]
    ticket = None
    gateway = GATEWAY_URL
    if "--ticket" in args:
        ticket = args[args.index("--ticket") + 1]
    if "--gateway" in args:
        gateway = args[args.index("--gateway") + 1]

    if not ticket:
        jwt = os.environ.get("WAKE_JWT", "")
        if not jwt:
            print("No --ticket and no WAKE_JWT env: nothing to test.")
            print("Full chain needs a course-user JWT; direct mode needs --ticket + --gateway.")
            return 2
        ticket, gateway = call_wake(jwt)
        check("wake returns ticket+gateway", bool(ticket), f"gateway={gateway}")
        if not ticket:
            print(f"RESULT: {PASS} pass, {FAIL} fail")
            return 1

    status, session = session_cookie_for(ticket, gateway)
    check("launch valid ticket -> 200 + cookie", status == 200 and bool(session), f"HTTP {status}")
    if not session:
        print(f"RESULT: {PASS} pass, {FAIL} fail")
        return 1
    # Reuse must fail (one-time ticket).
    status2, _ = session_cookie_for(ticket, gateway)
    check("launch reuse same ticket -> 401", status2 == 401, f"HTTP {status2}")

    # Diagnostic delay: the first /execute after /launch dropped its
    # response twice (runs 2-3) while the cell still executed server-side.
    # WAKE_DELAY_AFTER_LAUNCH (seconds) tests whether it is a timing race.
    delay = float(os.environ.get("WAKE_DELAY_AFTER_LAUNCH", "0"))
    if delay:
        print(f"waiting {delay}s after launch before first execute ...")
        time.sleep(delay)

    s, b = execute(gateway, session, 'print("hello wake live")\n2 + 3')
    try:
        ok = s == 200 and json.loads(b).get("result") == "5"
    except Exception:
        ok = False
    check("execute hello -> 5", ok, f"HTTP {s} {b[:150]}")

    s, b = execute(gateway, session, "x = 41")
    s2, b2 = execute(gateway, session, "x + 1")
    try:
        ok = s2 == 200 and json.loads(b2).get("result") == "42"
    except Exception:
        ok = False
    check("state persists x=41 -> 42", ok, f"HTTP {s2} {b2[:150]}")

    s, b = execute(gateway, session, "1/0")
    try:
        d = json.loads(b)
        ok = s == 200 and d.get("status") == "error" and d.get("error", {}).get("ename") == "ZeroDivisionError"
    except Exception:
        ok = False
    check("1/0 structured ZeroDivisionError", ok, f"HTTP {s} {b[:150]}")

    s, b, _ = req("GET", f"{gateway}/status?_={random.randint(0, 10 ** 9)}", headers={"Cookie": session})
    try:
        ok = s == 200 and json.loads(b).get("kernel") == "alive"
    except Exception:
        ok = False
    check("status with session -> alive", ok, f"HTTP {s}")

    s, b, _ = req("GET", f"{gateway}/status?_={random.randint(0, 10 ** 9)}")
    check("status without session -> 401", s == 401, f"HTTP {s}")

    print(f"RESULT: {PASS} pass, {FAIL} fail")
    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
