#!/usr/bin/env python3
"""Phase 4 LIVE verification: Bearer header auth against the real Gateway.
Usage: python3 verify_phase4_live.py --ticket A --ticket2 B --gateway URL
Tickets are single-use test tickets inserted in Supabase by the parent.
Never write ticket plaintexts to any file; this script takes them on the
command line only.
"""
import argparse
import json
import random
import sys
import time
import urllib.error
import urllib.request

ap = argparse.ArgumentParser()
ap.add_argument("--ticket", required=True)
ap.add_argument("--ticket2", required=False, default=None)
ap.add_argument("--gateway", required=True)
args = ap.parse_args()
BASE = args.gateway.rstrip("/")

results = []


def check(name, cond, extra=""):
    print(f"[{'PASS' if cond else 'FAIL'}] {name} {extra}")
    results.append(bool(cond))
    return cond


def req(method, path, payload=None, headers=None, timeout=60, retries=1):
    """One request; retries TRANSPORT errors once (an HTTP status is a real
    answer and is never retried)."""
    url = BASE + path
    data = json.dumps(payload).encode() if payload is not None else None
    hdrs = dict(headers or {})
    if data:
        hdrs["Content-Type"] = "application/json"
    last = None
    for attempt in range(retries + 1):
        r = urllib.request.Request(url, data=data, headers=hdrs, method=method)
        try:
            with urllib.request.urlopen(r, timeout=timeout) as resp:
                return resp.status, resp.read().decode(), resp.headers
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode(), e.headers
        except Exception as e:
            last = f"ERROR: {type(e).__name__}: {e}"
            if attempt < retries:
                time.sleep(2)
    return None, last, {}


def cb():
    return f"?cb={random.randint(10**9, 10**10)}"


def j(body):
    try:
        return json.loads(body)
    except Exception:
        return {}


def main():
    print(f"BASE: {BASE}\n")
    # T0: /health public
    st, body, _ = req("GET", "/health" + cb())
    check("T0 /health public 200", st == 200 and '"ok"' in body, f"HTTP {st}")

    # T1: /launch ticket A -> 200 + session_id + cookie
    st, body, headers = req("GET", f"/launch?ticket={args.ticket}" + "&" + cb()[1:])
    d = j(body)
    sid = d.get("session_id")
    set_cookie = headers.get("Set-Cookie", "")
    check("T1 /launch ticket A -> 200 + session_id", st == 200 and bool(sid),
          f"HTTP {st} role={d.get('role')} sid={'yes' if sid else 'NO'}")
    cookie_hdr = None
    if set_cookie:
        cookie_hdr = set_cookie.split(";")[0].strip()
    check("T1b /launch sets studio_session cookie", bool(cookie_hdr and "studio_session=" in cookie_hdr),
          f"cookie={'yes' if cookie_hdr else 'NO'}")

    if not sid:
        print("ABORT: no session_id from /launch")
        sys.exit(1)
    bearer = {"Authorization": f"Bearer {sid}"}

    # T2: /status header-only -> 200 + gateway gateway-phase4-1.0
    # (field is "gateway", not "version" — see app/main.py /status)
    st, body, _ = req("GET", "/status" + cb(), headers=bearer)
    d = j(body)
    check("T2 /status Bearer-only -> 200 gateway gateway-phase4-1.0",
          st == 200 and d.get("gateway") == "gateway-phase4-1.0",
          f"HTTP {st} gateway={d.get('gateway')}")

    # T3: /execute header-only hello -> 5
    st, body, _ = req("POST", "/execute", {"code": 'print("hello header live")\n2 + 3'}, headers=bearer)
    d = j(body)
    check("T3 /execute Bearer-only -> 5", st == 200 and d.get("result") == "5",
          f"HTTP {st} result={d.get('result')}")

    # T4: /execute no-auth -> 401
    st, body, _ = req("POST", "/execute", {"code": "1+1"})
    check("T4 /execute no-auth -> 401", st == 401, f"HTTP {st}")

    # T5: /execute bogus Bearer -> 401
    st, body, _ = req("POST", "/execute", {"code": "1+1"},
                      headers={"Authorization": "Bearer deadbeefdeadbeef"})
    check("T5 /execute bogus Bearer -> 401", st == 401, f"HTTP {st}")

    # T6: /execute cookie-only -> 200
    if cookie_hdr:
        st, body, _ = req("POST", "/execute", {"code": "6*7"}, headers={"Cookie": cookie_hdr})
        d = j(body)
        check("T6 /execute cookie-only -> 42", st == 200 and d.get("result") == "42",
              f"HTTP {st} result={d.get('result')}")
    else:
        check("T6 /execute cookie-only -> 42", False, "no cookie captured")

    # T7: state persists via header: x=41 -> x+1 -> 42
    st, body, _ = req("POST", "/execute", {"code": "x = 41"}, headers=bearer)
    st, body, _ = req("POST", "/execute", {"code": "x + 1"}, headers=bearer)
    d = j(body)
    check("T7 state persists x=41 -> 42 (header)", st == 200 and d.get("result") == "42",
          f"HTTP {st} result={d.get('result')}")

    # T8: structured ZeroDivisionError via header
    st, body, _ = req("POST", "/execute", {"code": "1/0"}, headers=bearer)
    d = j(body)
    err = d.get("error") or {}
    check("T8 1/0 structured ZeroDivisionError (header)",
          st == 200 and err.get("ename") == "ZeroDivisionError",
          f"HTTP {st} ename={err.get('ename')}")

    # T9: /status no-auth -> 401
    st, body, _ = req("GET", "/status" + cb())
    check("T9 /status no-auth -> 401", st == 401, f"HTTP {st}")

    # T10: /notebooks header-only -> 200
    st, body, _ = req("GET", "/notebooks" + cb(), headers=bearer)
    check("T10 /notebooks Bearer-only -> 200", st == 200, f"HTTP {st}")

    # T11: /launch reuse ticket A -> 401
    st, body, _ = req("GET", f"/launch?ticket={args.ticket}" + "&" + cb()[1:])
    check("T11 /launch reuse ticket A -> 401", st == 401, f"HTTP {st}")

    # T12: second session via ticket B (if given)
    if args.ticket2:
        st, body, headers = req("GET", f"/launch?ticket={args.ticket2}" + "&" + cb()[1:])
        d = j(body)
        sid2 = d.get("session_id")
        check("T12 /launch ticket B -> 200 + session_id", st == 200 and bool(sid2),
              f"HTTP {st} role={d.get('role')}")
        if sid2:
            st, body, _ = req("POST", "/execute", {"code": "10 + 32"},
                              headers={"Authorization": f"Bearer {sid2}"})
            d = j(body)
            check("T12b /execute Bearer (session B) -> 42", st == 200 and d.get("result") == "42",
                  f"HTTP {st} result={d.get('result')}")

    n_pass = sum(results)
    print(f"\nRESULT: {n_pass} pass, {len(results) - n_pass} fail (of {len(results)})")
    sys.exit(0 if n_pass == len(results) else 1)


if __name__ == "__main__":
    main()
