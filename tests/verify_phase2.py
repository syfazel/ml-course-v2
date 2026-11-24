#!/usr/bin/env python3
"""Phase 2 verification client for the Jarvis Studio pilot Gateway.
Posts code snippets to /execute and prints exact results + timings.
Usage: python3 verify_phase2.py [base-url]
"""
import json
import sys
import time
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://ubiquitous-umbrella-7r4pp7ppj4qfx9g6-8000.app.github.dev"


def post(path, payload=None, timeout=180):
    url = BASE + path
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json"} if data else {},
        method="POST" if data is not None else "GET",
    )
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read().decode()
            return r.status, time.time() - t0, body
    except urllib.error.HTTPError as e:
        return e.code, time.time() - t0, e.read().decode()
    except Exception as e:
        return None, time.time() - t0, f"ERROR: {type(e).__name__}: {e}"


def execute(code, notebook="phase2"):
    st, dt, body = post("/execute", {"code": code, "notebook": notebook})
    print(f"--- /execute ({dt:.1f}s, HTTP {st}) ---")
    print(f"CODE: {code[:200]}")
    print(f"RESP: {body[:2000]}")
    print()
    return st, body


def main():
    print(f"BASE: {BASE}")
    st, dt, body = post("/health")
    print(f"/health: HTTP {st} ({dt:.1f}s) {body}\n")
    st, dt, body = post("/status")
    print(f"/status: HTTP {st} ({dt:.1f}s) {body}\n")

    # T1: TF import + version + import time
    execute(
        "import time; t0=time.time()\n"
        "import tensorflow as tf\n"
        "print('tf', tf.__version__, 'import_s', round(time.time()-t0,1))"
    )
    # T2: tiny model fit on synthetic data
    execute(
        "import numpy as np, tensorflow as tf, time\n"
        "x = np.random.rand(200, 8).astype('float32')\n"
        "y = (x.sum(axis=1) > 4).astype('float32')\n"
        "m = tf.keras.Sequential([tf.keras.layers.Dense(16, activation='relu', input_shape=(8,)), tf.keras.layers.Dense(1, activation='sigmoid')])\n"
        "m.compile(optimizer='adam', loss='binary_crossentropy', metrics=['accuracy'])\n"
        "t0=time.time()\n"
        "h = m.fit(x, y, epochs=3, batch_size=32, verbose=0)\n"
        "print('fit_s', round(time.time()-t0,1), 'loss', [round(v,4) for v in h.history['loss']], 'acc', [round(v,4) for v in h.history['accuracy']])"
    )
    # T3: other library imports + versions + times
    execute(
        "import time\n"
        "for mod, attr in [('pandas','__version__'),('sklearn','__version__'),('scipy','__version__'),('matplotlib','__version__'),('seaborn','__version__'),('xgboost','__version__'),('PIL','__version__'),('h5py','version'),('gymnasium','__version__')]:\n"
        "    t0=time.time()\n"
        "    m=__import__(mod)\n"
        "    v=getattr(m,attr,None)\n"
        "    print(mod, v, 'import_s', round(time.time()-t0,1))"
    )
    # T4: Phase 1 regression — hello + state persistence
    execute("print('hello gateway')\n2 + 3")
    execute("x = 41")
    execute("x + 1")
    # T5: error path
    execute("1/0")
    # T6: notebooks round-trip
    st, dt, body = post("/notebooks")
    print(f"GET /notebooks: HTTP {st} ({dt:.1f}s) {body}\n")
    st, dt, body = post("/notebooks", {"name": "phase2rt", "content": {"nbformat": 4, "nbformat_minor": 0, "metadata": {}, "cells": [{"cell_type": "code", "execution_count": None, "metadata": {}, "outputs": [], "source": "1 + 1"}]}})
    print(f"POST /notebooks phase2rt: HTTP {st} ({dt:.1f}s) {body}\n")
    st, dt, body = post("/notebooks/phase2rt")
    print(f"GET /notebooks/phase2rt: HTTP {st} ({dt:.1f}s) {body[:500]}\n")
    # T7: disk usage from inside
    execute(
        "import shutil, subprocess, sys\n"
        "u = shutil.disk_usage('/')\n"
        "print('disk total GB', round(u.total/1e9,2), 'used GB', round(u.used/1e9,2), 'free GB', round(u.free/1e9,2))\n"
        "out = subprocess.check_output([sys.executable, '-c', 'import sysconfig; print(sysconfig.get_paths()[\"purelib\"])']).decode().strip()\n"
        "print('site-packages:', out)\n"
        "du = subprocess.check_output(['du','-sh',out]).decode().strip()\n"
        "print('site-packages size:', du)"
    )
    # T8: pip freeze (exact resolved versions)
    execute(
        "import subprocess, sys\n"
        "out = subprocess.check_output([sys.executable, '-m', 'pip', 'freeze']).decode()\n"
        "print(out)"
    )
    st, dt, body = post("/status")
    print(f"/status final: HTTP {st} ({dt:.1f}s) {body}\n")


if __name__ == "__main__":
    main()
