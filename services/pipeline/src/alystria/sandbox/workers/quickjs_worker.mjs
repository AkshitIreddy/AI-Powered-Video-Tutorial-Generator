// Trusted QuickJS-WASM host. No Node object, module loader, filesystem, socket,
// timer, or other ambient capability is installed in the guest context.
import { readFile, writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";

const [, , requestPath, resultPath] = process.argv;
const encoder = new TextEncoder();

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
  const module = await import(request.runtimeModule);
  if (typeof module.getQuickJS !== "function") {
    throw new Error("trusted QuickJS bundle does not export getQuickJS");
  }
  const QuickJS = await module.getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(Math.max(8 * 1024 * 1024, Math.floor(request.limits.memoryBytes / 2)));
  runtime.setMaxStackSize(1 * 1024 * 1024);
  const deadline = performance.now() + request.limits.wallTimeMs;
  runtime.setInterruptHandler(() => performance.now() >= deadline);
  const context = runtime.newContext();
  const stdout = [];
  const stderr = [];
  const trace = [];
  const outputs = [];
  let outputBytes = 0;

  const reserveBytes = (count) => {
    outputBytes += count;
    if (outputBytes > request.limits.outputBytes) {
      throw new Error("sandbox output limit exceeded");
    }
  };
  const reserve = (text) => reserveBytes(encoder.encode(text).byteLength);
  const hostFunction = (name, implementation) => {
    const handle = context.newFunction(name, (...handles) => {
      const values = handles.map((handle) => context.dump(handle));
      implementation(...values);
      return context.undefined;
    });
    context.setProp(context.global, name, handle);
    handle.dispose();
  };
  hostFunction("__alystria_print", (...values) => {
    const text = `${values.map(String).join(" ")}\n`;
    reserve(text);
    stdout.push(text);
  });
  hostFunction("__alystria_error", (...values) => {
    const text = `${values.map(String).join(" ")}\n`;
    reserve(text);
    stderr.push(text);
  });
  hostFunction("__alystria_trace", (kind, message, variables, line, column) => {
    if (trace.length >= request.limits.maxTraceEvents) {
      throw new Error("sandbox trace event limit exceeded");
    }
    trace.push({
      kind: typeof kind === "string" ? kind : "custom",
      message: typeof message === "string" ? message : String(message ?? ""),
      variables: variables && typeof variables === "object" && !Array.isArray(variables) ? variables : {},
      line: Number.isInteger(line) && line > 0 ? line : null,
      column: Number.isInteger(column) && column > 0 ? column : null,
    });
  });
  hostFunction("__alystria_write", (path, value, encoding = "utf8") => {
    if (typeof path !== "string" || path.startsWith("/") || path.includes("\\") ||
        path.split("/").some((part) => !part || part === "." || part === "..")) {
      throw new Error("output path is not a normalized relative path");
    }
    if (outputs.length >= request.limits.maxOutputFiles) {
      throw new Error("sandbox output file limit exceeded");
    }
    if (typeof value !== "string" || !["utf8", "base64"].includes(encoding)) {
      throw new Error("output must be a UTF-8 or base64 string");
    }
    const content = encoding === "base64"
      ? Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
      : encoder.encode(value);
    reserveBytes(content.byteLength);
    outputs.push({ path, content: Buffer.from(content).toString("base64") });
  });

  const frozenInputs = Object.fromEntries(request.inputs.map((item) => [item.path, item.content]));
  const bootstrap = `
    "use strict";
    (() => {
      let state = ${request.seed >>> 0};
      Math.random = () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
      };
      const NativeDate = Date;
      class DeterministicDate extends NativeDate {
        constructor(...args) { super(...(args.length ? args : [0])); }
        static now() { return 0; }
      }
      globalThis.Date = DeterministicDate;
      globalThis.inputs = Object.freeze(${JSON.stringify(frozenInputs)});
      globalThis.stdin = ${JSON.stringify(Buffer.from(request.stdin, "base64").toString("utf8"))};
      globalThis.arguments = Object.freeze(${JSON.stringify(request.arguments)});
      globalThis.console = Object.freeze({ log: __alystria_print, error: __alystria_error, warn: __alystria_error });
      globalThis.trace = __alystria_trace;
      globalThis.writeOutput = __alystria_write;
      for (const name of ["fetch", "WebSocket", "XMLHttpRequest", "require", "process", "module", "Deno", "Bun"])
        Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false });
    })();
  `;
  let setup = context.evalCode(bootstrap, "alystria:bootstrap.js");
  if (setup.error) {
    const error = context.dump(setup.error);
    setup.error.dispose();
    context.dispose(); runtime.dispose();
    throw new Error(`QuickJS bootstrap failed: ${JSON.stringify(error)}`);
  }
  setup.value.dispose();

  const wrapped = `"use strict"; (() => {\n${request.source}\n; return typeof result === "undefined" ? null : result; })()`;
  const evaluated = context.evalCode(wrapped, "<alystria>");
  let ok = true;
  let value = null;
  if (evaluated.error) {
    ok = false;
    const error = context.dump(evaluated.error);
    evaluated.error.dispose();
    const message = typeof error === "object" && error ? (error.stack || error.message) : String(error);
    reserve(`${message}\n`);
    stderr.push(`${message}\n`);
  } else {
    value = context.dump(evaluated.value);
    evaluated.value.dispose();
  }
  context.dispose();
  runtime.dispose();
  JSON.stringify(value); // Reject cyclic/non-serializable host dumps before writing.
  return { protocolVersion: 1, ok, stdout: stdout.join(""), stderr: stderr.join(""), value, trace, outputs };
}

let result;
try {
  result = await main();
} catch (error) {
  result = failure(error);
}
await writeFile(resultPath, JSON.stringify(result), { encoding: "utf8", mode: 0o600 });
