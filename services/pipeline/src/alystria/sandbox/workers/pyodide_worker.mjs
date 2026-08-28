// Trusted Pyodide host. Guest Python sees only Pyodide's in-memory filesystem;
// no host directory is mounted and the JavaScript bridge is blocked before exec.
import { readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";

const [, , requestPath, resultPath] = process.argv;

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function failure(error) {
  return {
    protocolVersion: 1,
    ok: false,
    stdout: "",
    stderr: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    value: null,
    trace: [],
    outputs: [],
  };
}

async function main() {
  const request = JSON.parse(await readFile(requestPath, "utf8"));
  if (request.protocolVersion !== 1 || typeof request.runtimeModule !== "string") {
    throw new Error("invalid sandbox request protocol");
  }
  const runtimeModuleUrl = new URL(request.runtimeModule);
  const runtime = await import(runtimeModuleUrl.href);
  if (typeof runtime.loadPyodide !== "function") {
    throw new Error("trusted Pyodide bundle does not export loadPyodide");
  }
  const hostStdout = [];
  const hostStderr = [];
  let hostBytes = 0;
  const capture = (destination) => (message) => {
    const text = `${message}\n`;
    hostBytes += byteLength(text);
    if (hostBytes > request.limits.outputBytes) {
      throw new Error("sandbox output limit exceeded");
    }
    destination.push(text);
  };
  // Node's permission model intentionally blocks process.binding. Pyodide's
  // generated Emscripten loader needs only the filesystem constants binding,
  // so replace process with the smallest compatible facade before loading it.
  const nativeProcess = globalThis.process;
  let sandboxExitCode = 0;
  const inertStream = Object.freeze({
    isTTY: false,
    write: () => true,
    read: () => null,
    on: () => inertStream,
    once: () => inertStream,
    removeListener: () => inertStream,
  });
  const safeProcess = {
    argv: Object.freeze(["node", "alystria-pyodide-worker"]),
    browser: false,
    platform: nativeProcess.platform,
    version: nativeProcess.version,
    versions: Object.freeze({ node: nativeProcess.versions.node }),
    type: "sandbox",
    stdin: inertStream,
    stdout: inertStream,
    stderr: inertStream,
    binding: (name) => {
      if (name !== "constants") throw new Error(`process.binding:${name}`);
      return Object.freeze({ fs: fsConstants });
    },
    get exitCode() { return sandboxExitCode; },
    set exitCode(value) { sandboxExitCode = Number(value) || 0; },
  };
  Object.freeze(safeProcess);
  Object.defineProperty(globalThis, "process", {
    value: safeProcess,
    writable: false,
    configurable: false,
  });
  const pyodide = await runtime.loadPyodide({
    indexURL: fileURLToPath(new URL(".", runtimeModuleUrl)),
    stdout: capture(hostStdout),
    stderr: capture(hostStderr),
    fullStdLib: false,
    env: {
      LANG: request.locale,
      LC_ALL: request.locale,
      TZ: request.timezone,
      SOURCE_DATE_EPOCH: "0",
      PYTHONHASHSEED: String(request.seed),
      ALYSTRIA_SEED: String(request.seed),
    },
  });

  // Keep trusted imports in lexical bindings, then remove host bridges. Python's
  // own import guard below also rejects `js`, `pyodide`, networking, package
  // installers, process control, and foreign-function modules.
  const forbiddenGlobals = [
    "require", "module", "Buffer", "fetch", "WebSocket",
    "XMLHttpRequest", "EventSource", "navigator", "Worker", "SharedWorker",
  ];
  for (const name of forbiddenGlobals) {
    try { delete globalThis[name]; } catch { /* verified below */ }
    if (typeof globalThis[name] !== "undefined") {
      throw new Error(`cannot remove forbidden host capability: ${name}`);
    }
  }

  pyodide.FS.mkdirTree("/inputs");
  pyodide.FS.mkdirTree("/outputs");
  pyodide.FS.mkdirTree("/work");
  for (const input of request.inputs) {
    const destination = `/inputs/${input.path}`;
    const parent = destination.slice(0, destination.lastIndexOf("/"));
    pyodide.FS.mkdirTree(parent);
    pyodide.FS.writeFile(destination, Uint8Array.from(Buffer.from(input.content, "base64")));
    pyodide.FS.chmod(destination, 0o444);
  }
  const inputSnapshot = new Map(request.inputs.map((input) => [input.path, input.content]));
  pyodide.globals.set("__alystria_request_json", JSON.stringify(request));
  const harness = String.raw`
def __alystria_execute():
    import base64 as _b64
    import builtins as _builtins
    import io as _io
    import json as _json
    import os as _os
    import random as _random
    import sys as _sys
    import traceback as _traceback

    _request = _json.loads(__alystria_request_json)
    _blocked = frozenset({
        "js", "pyodide", "micropip", "importlib", "ctypes", "socket", "ssl",
        "urllib", "http", "ftplib", "asyncio", "subprocess", "multiprocessing",
        "webbrowser", "pydoc", "site", "ensurepip"
    })
    _original_import = _builtins.__import__
    def _safe_import(name, globals=None, locals=None, fromlist=(), level=0):
        root = name.partition(".")[0]
        if root in _blocked:
            raise ImportError(f"module {root!r} is unavailable in the Alystria sandbox")
        return _original_import(name, globals, locals, fromlist, level)
    for _name in tuple(_sys.modules):
        if _name.partition(".")[0] in _blocked:
            _sys.modules.pop(_name, None)
    _builtins.__import__ = _safe_import

    _os.environ.clear()
    _os.environ.update({
        "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "TZ": "UTC",
        "SOURCE_DATE_EPOCH": "0", "ALYSTRIA_SEED": str(_request["seed"]),
    })
    _os.chdir("/work")
    _random.seed(_request["seed"])
    _sys.argv = ["tutorial.py", *_request["arguments"]]
    _sys.stdin = _io.StringIO(_b64.b64decode(_request["stdin"]).decode("utf-8", "replace"))
    _captured_out, _captured_err = _io.StringIO(), _io.StringIO()
    _previous_out, _previous_err = _sys.stdout, _sys.stderr
    _trace = []
    _trace_limit = int(_request["limits"]["maxTraceEvents"])

    def _scalar(value):
        if isinstance(value, str):
            return value[:253] + "..." if len(value) > 256 else value
        if value is None or isinstance(value, (int, float, bool)):
            return value
        text = repr(value)
        return text[:253] + "..." if len(text) > 256 else text

    def _tracer(frame, event, arg):
        if frame.f_code.co_filename != "<alystria>" or len(_trace) >= _trace_limit:
            return _tracer
        if event in {"call", "line", "return"}:
            variables = {
                str(key): _scalar(value)
                for key, value in sorted(frame.f_locals.items())
                if not str(key).startswith("__")
            }
            _trace.append({
                "kind": event,
                "message": frame.f_code.co_name,
                "line": frame.f_lineno if frame.f_lineno > 0 else None,
                "variables": variables,
            })
        return _tracer

    _ok, _value = True, None
    try:
        _sys.stdout, _sys.stderr = _captured_out, _captured_err
        _user_globals = {"__name__": "__main__", "__builtins__": _builtins}
        _sys.settrace(_tracer)
        exec(compile(_request["source"], "<alystria>", "exec"), _user_globals)
        _value = _user_globals.get("result")
    except BaseException:
        _ok = False
        _traceback.print_exc(limit=20, file=_captured_err)
    finally:
        _sys.settrace(None)
        _sys.stdout, _sys.stderr = _previous_out, _previous_err

    def _json_value(value, depth=0):
        if depth > 32:
            raise ValueError("result nesting exceeds 32 levels")
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        if isinstance(value, (list, tuple)):
            return [_json_value(item, depth + 1) for item in value]
        if isinstance(value, dict) and all(isinstance(key, str) for key in value):
            return {key: _json_value(item, depth + 1) for key, item in value.items()}
        return repr(value)

    _outputs, _output_bytes = [], 0
    for _directory, _directories, _files in _os.walk("/outputs", followlinks=False):
        _directories[:] = sorted(_directories)
        for _file in sorted(_files):
            _path = _os.path.join(_directory, _file)
            if _os.path.islink(_path):
                raise ValueError("symbolic-link outputs are forbidden")
            with open(_path, "rb") as _handle:
                _content = _handle.read(_request["limits"]["outputBytes"] + 1)
            _output_bytes += len(_content)
            if _output_bytes > _request["limits"]["outputBytes"]:
                raise ValueError("sandbox output limit exceeded")
            if len(_outputs) >= _request["limits"]["maxOutputFiles"]:
                raise ValueError("sandbox output file limit exceeded")
            _outputs.append({
                "path": _os.path.relpath(_path, "/outputs").replace("\\", "/"),
                "content": _b64.b64encode(_content).decode("ascii"),
            })
    return _json.dumps({
        "protocolVersion": 1,
        "ok": _ok,
        "stdout": _captured_out.getvalue(),
        "stderr": _captured_err.getvalue(),
        "value": _json_value(_value),
        "trace": _trace,
        "outputs": _outputs,
    }, ensure_ascii=False, allow_nan=False)

__alystria_execute()
`;
  const encoded = await pyodide.runPythonAsync(harness);
  const discoveredInputs = [];
  const visitInputs = (directory, relative = "") => {
    for (const name of pyodide.FS.readdir(directory).filter((name) => name !== "." && name !== "..").sort()) {
      const full = `${directory}/${name}`;
      const guest = relative ? `${relative}/${name}` : name;
      const info = pyodide.FS.lstat(full);
      if (pyodide.FS.isDir(info.mode)) visitInputs(full, guest);
      else discoveredInputs.push(guest);
    }
  };
  visitInputs("/inputs");
  if (discoveredInputs.length !== inputSnapshot.size ||
      discoveredInputs.some((path) => !inputSnapshot.has(path))) {
    throw new Error("sandbox modified the read-only input tree");
  }
  for (const [path, expected] of inputSnapshot) {
    const actual = Buffer.from(pyodide.FS.readFile(`/inputs/${path}`)).toString("base64");
    if (actual !== expected) throw new Error("sandbox modified a read-only input");
  }
  const result = JSON.parse(encoded);
  result.stdout = hostStdout.join("") + result.stdout;
  result.stderr = hostStderr.join("") + result.stderr;
  if (byteLength(result.stdout) + byteLength(result.stderr) > request.limits.outputBytes) {
    throw new Error("sandbox output limit exceeded");
  }
  return result;
}

let result;
try {
  result = await main();
} catch (error) {
  result = failure(error);
}
await writeFile(resultPath, JSON.stringify(result), { encoding: "utf8", mode: 0o600 });
