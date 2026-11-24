#!/usr/bin/env python3
"""Phase 3 verification client for the Jarvis Studio pilot Gateway.
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

Tests the one-time ticket + session cookie flow against the mock RPC.
Usage: python3 verify_phase3.py [base-url]
"""
import http.cookiejar
import json
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://ubiquitous-sniffle-pgqpp7ppq4g2r56w-8000.app.github.dev"

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def req(method, path, payload=None, use_jar=True, timeout=60):
    """One request with retries on TRANSPORT errors only (the forwarded-port
    tunnel intermittently drops responses; an HTTP status is a real answer
    and is never retried)."""
    url = BASE + path
    data = json.dumps(payload).encode() if payload is not None else None
    for attempt in range(4):
        r = urllib.request.Request(
            url, data=data,
            headers={"Content-Type": "application/json"} if data else {},
            method=method,
        )
        t0 = time.time()
        try:
            with (opener.open if use_jar else urllib.request.urlopen)(r, timeout=timeout) as resp:
                return resp.status, time.time() - t0, resp.read().decode(), resp.headers
        except urllib.error.HTTPError as e:
            return e.code, time.time() - t0, e.read().decode(), e.headers
        except Exception as e:
            if attempt == 3:
                return None, time.time() - t0, f"ERROR: {type(e).__name__}: {e}", {}
            time.sleep(2)
    return None, 0, "ERROR: unreachable", {}


def check(name, cond, extra=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name} {extra}")
    return cond


results = []


def main():
    print(f"BASE: {BASE}\n")
    # T0: /health stays public
    st, dt, body, _ = req("GET", "/health", use_jar=False)
    results.append(check("T0 /health public 200", st == 200 and '"ok"' in body, f"HTTP {st} {body}"))

    # T1: /launch with the valid student ticket
    st, dt, body, headers = req("GET", f"/launch?ticket={TICKETS['student']}", use_jar=False)
    print(f"T1 /launch student: HTTP {st} {body}")
    # NOTE: the tunnel relay adds its own Set-Cookie; .get() returns only
    # the first one — read ALL of them.
    if hasattr(headers, "get_all"):
        _all = headers.get_all("Set-Cookie", []) or []
    else:
        _all = [headers.get("Set-Cookie", "")]
    set_cookie = "; ".join(_all)
    print(f"   Set-Cookie headers: {len(_all)}; studio_session present: {'studio_session=' in set_cookie}")
    try:
        launched = json.loads(body)
    except Exception:
        launched = {}
    ok = st == 200 and launched.get("status") == "ok" and launched.get("role") == "student"
    results.append(check("T1 /launch valid student ticket -> 200 + role student", ok))
    results.append(check("T1 cookie has studio_session", "studio_session=" in set_cookie))
    results.append(check("T1 cookie HttpOnly", "HttpOnly" in set_cookie))
    results.append(check("T1 cookie Secure", "Secure" in set_cookie))
    results.append(check("T1 cookie SameSite=Lax", "samesite=lax" in set_cookie.lower()))
    results.append(check("T1 cookie Max-Age=28800", "Max-Age=28800" in set_cookie))
    results.append(check("T1 cookie Path=/", "Path=/" in set_cookie))
    # feed the cookie into our jar for the authed calls below
    if "studio_session=" in set_cookie:
        from urllib.parse import urlparse
        host = urlparse(BASE).netloc
        jar.set_cookie(http.cookiejar.Cookie(
            version=0, name="studio_session",
            value=set_cookie.split("studio_session=")[1].split(";")[0],
            port=None, port_specified=False,
            domain=host,
            domain_specified=True, domain_initial_dot=False,
            path="/", path_specified=True, secure=True, expires=None,
            discard=False, comment=None, comment_url=None, rest={},
        ))

    # T2: /status with cookie
    st, dt, body, _ = req("GET", "/status")
    print(f"T2 /status with cookie: HTTP {st} {body[:400]}")
    results.append(check("T2 /status with cookie -> 200 + gateway-phase3", st == 200 and "gateway-phase3" in body))

    # T3: /execute with cookie
    st, dt, body, _ = req("POST", "/execute", {"code": "print('hello gateway')\n2 + 3", "notebook": "phase3"})
    print(f"T3 /execute with cookie: HTTP {st} {body[:300]}")
    results.append(check("T3 /execute with cookie -> hello + 5", st == 200 and "hello gateway" in body and '"5"' in body))

    # T4: /execute without cookie -> 401
    st, dt, body, _ = req("POST", "/execute", {"code": "print(1)"}, use_jar=False)
    results.append(check("T4 /execute without cookie -> 401", st == 401, f"HTTP {st} {body[:120]}"))

    # T5: ticket reuse -> 401
    st, dt, body, _ = req("GET", f"/launch?ticket={TICKETS['student']}", use_jar=False)
    results.append(check("T5 /launch reused ticket -> 401", st == 401, f"HTTP {st} {body[:120]}"))

    # T6: expired ticket -> 401
    st, dt, body, _ = req("GET", f"/launch?ticket={TICKETS['expired']}", use_jar=False)
    results.append(check("T6 /launch expired ticket -> 401", st == 401, f"HTTP {st} {body[:120]}"))

    # T7: bogus ticket -> 401
    st, dt, body, _ = req("GET", "/launch?ticket=not-a-real-ticket", use_jar=False)
    results.append(check("T7 /launch bogus ticket -> 401", st == 401, f"HTTP {st} {body[:120]}"))

    # T8: teacher ticket -> 200 + role teacher
    st, dt, body, _ = req("GET", f"/launch?ticket={TICKETS['teacher']}", use_jar=False)
    print(f"T8 /launch teacher: HTTP {st} {body}")
    try:
        launched_t = json.loads(body)
    except Exception:
        launched_t = {}
    results.append(check("T8 /launch valid teacher ticket -> 200 + role teacher", st == 200 and launched_t.get("role") == "teacher"))

    # T9: regression with the student session — state, error, notebooks
    st, dt, body, _ = req("POST", "/execute", {"code": "x = 41", "notebook": "phase3"})
    st, dt, body, _ = req("POST", "/execute", {"code": "x + 1", "notebook": "phase3"})
    results.append(check("T9a state persists x=41 -> 42", st == 200 and '"42"' in body, f"HTTP {st} {body[:200]}"))
    st, dt, body, _ = req("POST", "/execute", {"code": "1/0", "notebook": "phase3"})
    results.append(check("T9b 1/0 -> structured ZeroDivisionError, kernel alive", st == 200 and "ZeroDivisionError" in body, f"HTTP {st} {body[:200]}"))
    st, dt, body, _ = req("GET", "/notebooks")
    results.append(check("T9c GET /notebooks with cookie -> 200", st == 200, f"HTTP {st} {body[:200]}"))
    # T9d: GET /notebooks without cookie -> 401 (cache-buster: the tunnel
    # was observed serving stale authed GETs)
    st, dt, body, _ = req("GET", f"/notebooks?cb={int(time.time())}", use_jar=False)
    results.append(check("T9d GET /notebooks without cookie -> 401", st == 401, f"HTTP {st}"))
    st, dt, body, _ = req("POST", "/notebooks", {"name": "phase3rt", "content": {"nbformat": 4, "nbformat_minor": 0, "metadata": {}, "cells": [{"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": "1 + 1"}]}})
    results.append(check("T9e POST /notebooks phase3rt with cookie -> 200", st == 200, f"HTTP {st} {body[:150]}"))
    st, dt, body, _ = req("GET", "/notebooks/phase3rt")
    results.append(check("T9f GET /notebooks/phase3rt round-trip", st == 200 and "1 + 1" in body, f"HTTP {st} {body[:200]}"))

    # T10: /status without cookie -> 401 (cache-buster, see T9d)
    st, dt, body, _ = req("GET", f"/status?cb={int(time.time())}", use_jar=False)
    results.append(check("T10 /status without cookie -> 401", st == 401, f"HTTP {st}"))

    print(f"\n==== {sum(results)}/{len(results)} checks passed ====")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
