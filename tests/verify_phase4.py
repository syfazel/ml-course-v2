#!/usr/bin/env python3
"""Phase 4 verification client for the Gateway header-auth change.
# Phase 2 (G2): mock tickets are RANDOM per Gateway run — read them from
# the JSON file the mock publishes (MOCK_TICKETS_FILE, default
# /tmp/jarvis_mock_tickets.json) or from MOCK_TICKET_* env vars. The old
# fixed test-ticket-* strings no longer exist.
def _load_tickets():
    import os
    path = os.environ.get("MOCK_TICKETS_FILE", "/tmp/jarvis_mock_tickets.json")
    try:
        return json.load(open(path))
    except Exception:
        return {
            "student": os.environ.get("MOCK_TICKET_STUDENT", ""),
            "teacher": os.environ.get("MOCK_TICKET_TEACHER", ""),
            "expired": os.environ.get("MOCK_TICKET_EXPIRED", ""),
        }


TICKETS = _load_tickets()

Tests the Bearer <session_id> auth path against the mock RPC.
Usage: python3 verify_phase4.py [base-url]
Local run: start the Gateway with JARVIS_STUDIO_ALLOW_MOCK_RPC=1 on 8100
(mock tickets are read from /tmp/jarvis_mock_tickets.json), run this.
"""
import http.cookiejar
import json
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8100"

jar = http.cookiejar.CookieJar()
jar_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def req(method, path, payload=None, headers=None, use_jar=False, timeout=60):
    """One request; retries TRANSPORT errors only (an HTTP status is a real
    answer and is never retried)."""
    url = BASE + path
    data = json.dumps(payload).encode() if payload is not None else None
    hdrs = dict(headers or {})
    if data:
        hdrs["Content-Type"] = "application/json"
    for attempt in range(4):
        r = urllib.request.Request(url, data=data, headers=hdrs, method=method)
        t0 = time.time()
        try:
            with (jar_opener.open if use_jar else urllib.request.urlopen)(r, timeout=timeout) as resp:
                return resp.status, time.time() - t0, resp.read().decode(), resp.headers
        except urllib.error.HTTPError as e:
            return e.code, time.time() - t0, e.read().decode(), e.headers
        except Exception as e:
            if attempt == 3:
                return None, time.time() - t0, f"ERROR: {type(e).__name__}: {e}", {}
            time.sleep(1)
    return None, 0, "ERROR: unreachable", {}


results = []


def check(name, cond, extra=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name} {extra}")
    results.append(bool(cond))
    return cond


def main():
    print(f"BASE: {BASE}\n")
    # T0: /health public
    st, dt, body, _ = req("GET", "/health")
    check("T0 /health public 200", st == 200 and '"ok"' in body, f"HTTP {st} {body[:120]}")

    # T1: /launch student ticket -> 200 + session_id + cookie
    st, dt, body, headers = req("GET", f"/launch?ticket={TICKETS['student']}")
    launched = {}
    try:
        launched = json.loads(body)
    except Exception:
        pass
    sid = launched.get("session_id")
    all_cookies = []
    if hasattr(headers, "get_all"):
        all_cookies = headers.get_all("Set-Cookie", []) or []
    set_cookie = " ".join(all_cookies)
    check("T1 /launch valid student ticket -> 200 + role student",
          st == 200 and launched.get("status") == "ok" and launched.get("role") == "student",
          f"HTTP {st} {body[:160]}")
    check("T1 /launch JSON includes non-empty session_id",
          isinstance(sid, str) and len(sid) >= 20, f"session_id present: {bool(sid)}")
    check("T1 cookie still set (studio_session)", "studio_session=" in set_cookie)
    check("T1 cookie SameSite=Lax unchanged", "samesite=lax" in set_cookie.lower())
    if not sid:
        print("RESULT: 0 pass (no session_id; aborting)")
        sys.exit(1)
    bearer = {"Authorization": f"Bearer {sid}"}

    # T2: /status with Bearer header only (no cookie jar) -> 200
    st, dt, body, _ = req("GET", "/status", headers=bearer)
    try:
        status_body = json.loads(body)
    except Exception:
        status_body = {}
    check("T2 /status header-only -> 200", st == 200, f"HTTP {st} {body[:120]}")
    check("T2 gateway version is gateway-phase4-1.0",
          status_body.get("gateway") == "gateway-phase4-1.0",
          f"gateway={status_body.get('gateway')}")

    # T3: /execute with Bearer header only -> 200, correct result
    st, dt, body, _ = req("POST", "/execute",
                          {"code": 'print("hello phase4")\n2 + 3', "notebook": "phase4-test"},
                          headers=bearer)
    try:
        ex = json.loads(body)
    except Exception:
        ex = {}
    check("T3 /execute header-only -> 200 + result 5",
          st == 200 and ex.get("result") == "5" and "hello phase4" in ex.get("stdout", ""),
          f"HTTP {st} {body[:160]}")

    # T4: state persists via header (x=41 -> 42)
    st, _, body, _ = req("POST", "/execute", {"code": "x = 41", "notebook": "phase4-test"}, headers=bearer)
    st, _, body, _ = req("POST", "/execute", {"code": "x + 1", "notebook": "phase4-test"}, headers=bearer)
    try:
        ex = json.loads(body)
    except Exception:
        ex = {}
    check("T4 state persists via header x=41 -> 42", st == 200 and ex.get("result") == "42",
          f"HTTP {st} {body[:120]}")

    # T5: structured ZeroDivisionError via header
    st, _, body, _ = req("POST", "/execute", {"code": "1/0", "notebook": "phase4-test"}, headers=bearer)
    try:
        ex = json.loads(body)
    except Exception:
        ex = {}
    check("T5 1/0 structured ZeroDivisionError via header",
          st == 200 and ex.get("status") == "error" and (ex.get("error") or {}).get("ename") == "ZeroDivisionError",
          f"HTTP {st} {body[:160]}")

    # T6: /execute with neither cookie nor header -> 401
    st, _, body, _ = req("POST", "/execute", {"code": "1+1", "notebook": "phase4-test"})
    check("T6 /execute no auth -> 401", st == 401, f"HTTP {st}")

    # T7: /execute with bogus Bearer -> 401
    st, _, body, _ = req("POST", "/execute", {"code": "1+1", "notebook": "phase4-test"},
                         headers={"Authorization": "Bearer bogus-session-id"})
    check("T7 /execute bogus Bearer -> 401", st == 401, f"HTTP {st}")

    # T8: /status with neither -> 401
    st, _, body, _ = req("GET", "/status")
    check("T8 /status no auth -> 401", st == 401, f"HTTP {st}")

    # T9: cookie path still works — launch teacher ticket with the jar,
    # then /execute with the jarred cookie (no header).
    st, _, body, _ = req("GET", f"/launch?ticket={TICKETS['teacher']}", use_jar=True)
    check("T9 /launch teacher ticket -> 200", st == 200, f"HTTP {st} {body[:120]}")
    st, _, body, _ = req("POST", "/execute",
                         {"code": "7 * 6", "notebook": "phase4-test"}, use_jar=True)
    try:
        ex = json.loads(body)
    except Exception:
        ex = {}
    check("T9 /execute cookie-only -> 200 + result 42",
          st == 200 and ex.get("result") == "42", f"HTTP {st} {body[:120]}")

    # T10: ticket reuse -> 401 (student ticket already consumed)
    st, _, body, _ = req("GET", f"/launch?ticket={TICKETS['student']}")
    check("T10 /launch reuse same ticket -> 401", st == 401, f"HTTP {st}")

    # T11: expired ticket -> 401
    st, _, body, _ = req("GET", f"/launch?ticket={TICKETS['expired']}")
    check("T11 /launch expired ticket -> 401", st == 401, f"HTTP {st}")

    # T12: /notebooks with Bearer header -> 200 and lists the test notebook
    st, _, body, _ = req("GET", "/notebooks", headers=bearer)
    try:
        nb = json.loads(body)
    except Exception:
        nb = {}
    check("T12 /notebooks header-only -> 200 + phase4-test listed",
          st == 200 and "phase4-test" in (nb.get("notebooks") or []),
          f"HTTP {st} {body[:120]}")

    passed = sum(results)
    print(f"\nRESULT: {passed} pass, {len(results) - passed} fail (of {len(results)})")
    sys.exit(0 if passed == len(results) else 1)


if __name__ == "__main__":
    main()
