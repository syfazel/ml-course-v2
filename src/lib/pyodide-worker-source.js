"use strict";
/* Pyodide notebook worker for the student shell. Same protocol and the
   same Python snippets (cell wrapper, variable inspection, stdout
   literal structuring, kernel reset) as the main site's lab engine:
   messages {type:"init"} / {type:"run",id,code} / {type:"reset",id} /
   {type:"inspect",id}; replies "ready" / "init-error" / "result" /
   "reset-done" / "inspect-result". */
var PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
var CELL_WRAPPER = "import ast as _muse_ast\n_muse_tree = _muse_ast.parse(_muse_src)\n_muse_has_last = False\n_muse_last_val = None\nif _muse_tree.body and isinstance(_muse_tree.body[-1], _muse_ast.Expr):\n    _muse_last_node = _muse_tree.body[-1]\n    _muse_rest = _muse_ast.Module(body=_muse_tree.body[:-1], type_ignores=[])\n    exec(compile(_muse_rest, '<cell>', 'exec'), globals())\n    _muse_last_val = eval(compile(_muse_ast.Expression(_muse_last_node.value), '<cell>', 'eval'), globals())\n    _muse_has_last = True\nelse:\n    exec(compile(_muse_tree, '<cell>', 'exec'), globals())\nglobals()['__muse_has_last__'] = _muse_has_last\nglobals()['__muse_last__'] = _muse_last_val";
var INSPECT_SNIPPET = "\nimport json as _j, types as _t, math as _m\n\ndef _is_num(_x):\n    return isinstance(_x, (int, float)) and not isinstance(_x, bool) and _m.isfinite(float(_x))\n\ndef _s(_x):\n    if isinstance(_x, float):\n        return repr(round(_x, 6))\n    if isinstance(_x, str):\n        return _x[:60]\n    _r = repr(_x)\n    return _r[:60]\n\ndef _struct(_o):\n    if _o is None:\n        return None\n    _tn = type(_o).__name__\n    _mod = type(_o).__module__ or ''\n    if _tn == 'DataFrame' and _mod.startswith('pandas'):\n        try:\n            _cols = [str(_c) for _c in list(_o.columns)]\n            _rows = [[_s(_v) for _v in _row] for _row in _o.head(20).values.tolist()]\n            return {'kind': 'table', 'columns': _cols, 'rows': _rows}\n        except Exception:\n            return None\n    if _tn == 'Series' and _mod.startswith('pandas'):\n        try:\n            _vals = _o.tolist()\n        except Exception:\n            return None\n        return _struct(_vals)\n    if _tn == 'ndarray':\n        try:\n            return _struct(_o.tolist())\n        except Exception:\n            return None\n    if isinstance(_o, dict):\n        if len(_o) == 0:\n            return None\n        _vals = list(_o.values())\n        if all(isinstance(_v, (list, tuple)) for _v in _vals) and len(set(len(_v) for _v in _vals)) == 1 and len(_vals[0]) > 0:\n            _cols = [str(_k) for _k in _o.keys()]\n            _rows = [[_s(_v) for _v in _row] for _row in list(zip(*_vals))[:20]]\n            return {'kind': 'table', 'columns': _cols, 'rows': _rows}\n        _rows = [[str(_k), _s(_v)] for _k, _v in list(_o.items())[:20]]\n        return {'kind': 'table', 'columns': ['کلید', 'مقدار'], 'rows': _rows}\n    if isinstance(_o, (list, tuple, set)):\n        _lst = list(_o)\n        if len(_lst) == 0:\n            return None\n        if all(_is_num(_x) for _x in _lst):\n            if len(_lst) >= 3:\n                return {'kind': 'chart', 'values': [float(_x) for _x in _lst[:50]]}\n            return None\n        if all(isinstance(_x, dict) for _x in _lst):\n            _cols = []\n            for _d in _lst:\n                for _k in _d.keys():\n                    if str(_k) not in _cols:\n                        _cols.append(str(_k))\n            _rows = [[_s(_d.get(_c)) if _c in _d else '' for _c in _cols] for _d in _lst[:20]]\n            return {'kind': 'table', 'columns': _cols, 'rows': _rows}\n        if all(isinstance(_x, (list, tuple)) for _x in _lst):\n            _w = max(len(_x) for _x in _lst)\n            _cols = ['خانه ' + str(_i + 1) for _i in range(_w)]\n            _rows = [[_s(_x[_i]) if _i < len(_x) else '' for _i in range(_w)] for _x in _lst[:20]]\n            return {'kind': 'table', 'columns': _cols, 'rows': _rows}\n        if all(isinstance(_x, (str, int, float, bool)) or _x is None for _x in _lst):\n            _rows = [[str(_i + 1), _s(_x)] for _i, _x in enumerate(_lst[:20])]\n            return {'kind': 'table', 'columns': ['شماره', 'مقدار'], 'rows': _rows}\n        _rows = [[str(_i + 1), _s(_x)] for _i, _x in enumerate(_lst[:20])]\n        return {'kind': 'table', 'columns': ['شماره', 'مقدار'], 'rows': _rows}\n    return None\n\ndef _type_fa(_v):\n    if isinstance(_v, bool):\n        return 'درست / نادرست'\n    if isinstance(_v, int):\n        return 'عدد صحیح'\n    if isinstance(_v, float):\n        return 'عدد اعشاری'\n    if isinstance(_v, str):\n        return 'متن'\n    if isinstance(_v, list):\n        return 'فهرست'\n    if isinstance(_v, tuple):\n        return 'تاپل (فهرست ثابت)'\n    if isinstance(_v, dict):\n        return 'دیکشنری'\n    if isinstance(_v, set):\n        return 'مجموعه'\n    if _v is None:\n        return 'خالی (هیچ)'\n    _tn = type(_v).__name__\n    if _tn == 'ndarray':\n        return 'آرایه نامپای'\n    if _tn == 'DataFrame':\n        return 'جدول پانداس'\n    if _tn == 'Series':\n        return 'سری پانداس'\n    return _tn\n\ndef _summary(_v):\n    try:\n        if isinstance(_v, str):\n            return ('«' + _v[:50] + ('…' if len(_v) > 50 else '') + '»') if _v else '«» (متن خالی)'\n        if isinstance(_v, (list, tuple, set)):\n            _lst = list(_v)\n            _pre = ', '.join(_s(_x) for _x in _lst[:4])\n            return str(len(_lst)) + ' خانه' + (('؛ شروع: ' + _pre) if _lst else '')\n        if isinstance(_v, dict):\n            _items = list(_v.items())[:3]\n            _pre = ', '.join(str(_k) + ': ' + _s(_x) for _k, _x in _items)\n            return str(len(_v)) + ' کلید' + (('؛ مثل: ' + _pre) if _items else '')\n        _tn = type(_v).__name__\n        if _tn == 'ndarray':\n            return 'شکل ' + str(tuple(_v.shape)) + '؛ شروع: ' + ', '.join(_s(_x) for _x in _v.flatten().tolist()[:4])\n        if _tn == 'DataFrame':\n            return str(_v.shape[0]) + ' سطر × ' + str(_v.shape[1]) + ' ستون؛ ستون‌ها: ' + ', '.join(str(_c) for _c in list(_v.columns)[:5])\n        if _tn == 'Series':\n            return str(len(_v)) + ' خانه؛ شروع: ' + ', '.join(_s(_x) for _x in _v.tolist()[:4])\n        return _s(_v)\n    except Exception:\n        return '…'\n\n_vars = []\nfor _name, _val in list(globals().items()):\n    if _name.startswith('_'):\n        continue\n    if isinstance(_val, _t.ModuleType) or isinstance(_val, _t.FunctionType) or isinstance(_val, type):\n        continue\n    if callable(_val) and type(_val).__name__ in ('builtin_function_or_method', 'method'):\n        continue\n    _vars.append({'name': _name, 'type': type(_val).__name__, 'typeFa': _type_fa(_val), 'summary': _summary(_val)})\n_vars.sort(key=lambda _d: _d['name'])\n_structured = None\nif globals().get('__muse_has_last__'):\n    try:\n        _structured = _struct(globals().get('__muse_last__'))\n    except Exception:\n        _structured = None\n_result_json = _j.dumps({'variables': _vars, 'structured': _structured}, ensure_ascii=False)\nglobals()['__muse_inspect_json__'] = _result_json\n_result_json\n";
var STDOUT_STRUCT_SNIPPET = "\nimport json as _j, ast as _a\n_out = None\ntry:\n    _parsed = _a.literal_eval(_muse_out)\n    _out = _parsed\nexcept Exception:\n    _out = None\n_out_json = _j.dumps({'value': _out}, ensure_ascii=False, default=str)\nglobals()['__muse_stdout_json__'] = _out_json\n_out_json\n";
var RESET_SNIPPET = "for _k in [k for k in list(globals().keys()) if not k.startswith('__') or k.startswith('__muse')]:\n    del globals()[_k]";
var PACKAGE_FOR_IMPORT = {"numpy":"numpy","pandas":"pandas","sklearn":"scikit-learn","scipy":"scipy"};
var pyodide = null;
var loadedPackages = new Set();
var stdoutBuf = [];
var stderrBuf = [];
function packagesForCode(code) {
  var pkgs = new Set();
  var re = /(?:^|\n)\s*(?:import|from)\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
  var m;
  while ((m = re.exec(code)) !== null) {
    var name = m[1];
    if (name && PACKAGE_FOR_IMPORT[name]) pkgs.add(PACKAGE_FOR_IMPORT[name]);
  }
  return Array.from(pkgs);
}
async function ensurePackages(code) {
  var needed = packagesForCode(code).filter(function (p) { return !loadedPackages.has(p); });
  if (needed.length === 0) return;
  await pyodide.loadPackage(needed);
  needed.forEach(function (p) { loadedPackages.add(p); });
}
async function inspectPair(stdout, hadError) {
  var inspectJson = null;
  var stdoutLiteralJson = null;
  try {
    var raw = await pyodide.runPythonAsync(INSPECT_SNIPPET);
    if (typeof raw !== "string") raw = pyodide.globals.get("__muse_inspect_json__");
    if (typeof raw === "string") inspectJson = raw;
  } catch (e) {
    return { inspectJson: null, stdoutLiteralJson: null };
  }
  if (!hadError) {
    var structured = null;
    try { structured = inspectJson ? JSON.parse(inspectJson).structured : null; } catch (e) { structured = null; }
    var text = (stdout || "").trim();
    if (!structured && (text.charAt(0) === "[" || text.charAt(0) === "{")) {
      try {
        pyodide.globals.set("_muse_out", text);
        var raw2 = await pyodide.runPythonAsync(STDOUT_STRUCT_SNIPPET);
        if (typeof raw2 !== "string") raw2 = pyodide.globals.get("__muse_stdout_json__");
        if (typeof raw2 === "string") stdoutLiteralJson = raw2;
      } catch (e) { stdoutLiteralJson = null; }
    }
  }
  return { inspectJson: inspectJson, stdoutLiteralJson: stdoutLiteralJson };
}
self.onmessage = async function (e) {
  var msg = e.data || {};
  if (msg.type === "init") {
    try {
      importScripts(PYODIDE_BASE + "pyodide.js");
      if (typeof loadPyodide !== "function") throw new Error("loadPyodide missing");
      pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });
      pyodide.setStdout({ batched: function (s) { stdoutBuf.push(s); } });
      pyodide.setStderr({ batched: function (s) { stderrBuf.push(s); } });
      self.postMessage({ type: "ready" });
    } catch (err) {
      self.postMessage({ type: "init-error", message: err && err.message ? String(err.message) : String(err) });
    }
    return;
  }
  if (!pyodide) return;
  if (msg.type === "run") {
    stdoutBuf = [];
    stderrBuf = [];
    var error = null;
    try {
      await ensurePackages(msg.code);
      pyodide.globals.set("_muse_src", msg.code);
      await pyodide.runPythonAsync(CELL_WRAPPER);
    } catch (err) {
      error = err && err.message ? String(err.message) : String(err);
    }
    var stdout = stdoutBuf.join("\n").replace(/\n+$/, "");
    var stderr = stderrBuf.join("\n").replace(/\n+$/, "");
    var pair = await inspectPair(stdout, error !== null);
    self.postMessage({ type: "result", id: msg.id, stdout: stdout, stderr: stderr, error: error, inspectJson: pair.inspectJson, stdoutLiteralJson: pair.stdoutLiteralJson });
    return;
  }
  if (msg.type === "reset") {
    try { await pyodide.runPythonAsync(RESET_SNIPPET); } catch (e) {}
    self.postMessage({ type: "reset-done", id: msg.id });
    return;
  }
  if (msg.type === "inspect") {
    var ij = null;
    try {
      var r = await pyodide.runPythonAsync(INSPECT_SNIPPET);
      if (typeof r !== "string") r = pyodide.globals.get("__muse_inspect_json__");
      if (typeof r === "string") ij = r;
    } catch (e) {}
    self.postMessage({ type: "inspect-result", id: msg.id, inspectJson: ij });
    return;
  }
};
