from __future__ import annotations

import json
import stat
import threading
from collections.abc import Callable, Mapping
from pathlib import Path

import pytest

from alystria.sandbox import (
    ExecutableSpec,
    ExecutionLimits,
    ExecutionStatus,
    JavaScriptBundle,
    ProbeResult,
    ProcessPlan,
    PyodideAdapter,
    QuickJsWasmAdapter,
    RawProcessResult,
    RuntimeKind,
    SandboxExecutor,
    SandboxInput,
    SandboxPolicyError,
    SandboxRequest,
    TerminationReason,
    WasmtimeWasiAdapter,
    executor_from_runtime_root,
)
from alystria.sandbox.adapters import AttemptWorkspace
from alystria.sandbox.process import ProcessRunner


class FakeRunner(ProcessRunner):
    def __init__(
        self,
        *,
        version: str = "v24.3.0",
        result: RawProcessResult | None = None,
        on_run: Callable[[ProcessPlan], None] | None = None,
    ) -> None:
        self.version = version
        self.result = result or RawProcessResult(0, b"", b"", 7, TerminationReason.EXITED)
        self.on_run = on_run
        self.probes: list[tuple[str, ...]] = []
        self.plans: list[ProcessPlan] = []

    def probe(self, argv: tuple[str, ...], *, environment: Mapping[str, str]) -> ProbeResult:
        self.probes.append(argv)
        assert environment == {"LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "TZ": "UTC"}
        return ProbeResult(0, self.version, "")

    def run(
        self, plan: ProcessPlan, *, cancellation: threading.Event | None = None
    ) -> RawProcessResult:
        self.plans.append(plan)
        if self.on_run:
            self.on_run(plan)
        return self.result


def _executable(path: Path, name: str) -> Path:
    binary = path / name
    binary.write_bytes(b"fake trusted runtime")
    binary.chmod(stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR)
    return binary


def _workspace(path: Path) -> AttemptWorkspace:
    inputs = path / "inputs"
    outputs = path / "outputs"
    control = path / "control"
    for directory in (inputs, outputs, control):
        directory.mkdir(parents=True)
    return AttemptWorkspace(path, inputs, outputs, control)


def _success_envelope(plan: ProcessPlan) -> None:
    assert plan.result_path is not None
    plan.result_path.write_text(
        json.dumps(
            {
                "protocolVersion": 1,
                "ok": True,
                "stdout": "index = 5\n",
                "stderr": "",
                "value": {"index": 5},
                "trace": [
                    {
                        "kind": "line",
                        "message": "binary_search",
                        "line": 4,
                        "variables": {"low": 0, "mid": 4, "high": 8},
                    }
                ],
                "outputs": [{"path": "trace.json", "content": "e30="}],
            }
        ),
        encoding="utf-8",
    )


class TestSandboxContracts:
    def test_rejects_guest_path_traversal_and_duplicates(self) -> None:
        with pytest.raises(SandboxPolicyError, match="normalized relative"):
            SandboxInput("../secret.txt", b"no")
        with pytest.raises(SandboxPolicyError, match="duplicate"):
            SandboxRequest(
                RuntimeKind.PYODIDE,
                source="result = 1",
                inputs=(SandboxInput("data.txt", b"a"), SandboxInput("data.txt", b"b")),
            )

    def test_runtime_payload_types_are_not_interchangeable(self) -> None:
        with pytest.raises(SandboxPolicyError, match="requires module bytes"):
            SandboxRequest(RuntimeKind.WASMTIME_WASI, source="print('unsafe fallback')")
        with pytest.raises(SandboxPolicyError, match="source runtimes"):
            SandboxRequest(RuntimeKind.QUICKJS_WASM, module=b"\x00asm\x01\x00\x00\x00")

    def test_limits_cannot_enable_children_or_unbounded_resources(self) -> None:
        with pytest.raises(SandboxPolicyError, match="fixed at one"):
            ExecutionLimits(max_processes=2)
        with pytest.raises(SandboxPolicyError, match="memory_bytes"):
            ExecutionLimits(memory_bytes=8 * 1024 * 1024)
        with pytest.raises(SandboxPolicyError, match="fixed at UTC"):
            SandboxRequest(RuntimeKind.PYODIDE, source="result = 1", timezone="Europe/London")


class TestRuntimePlanning:
    def test_quickjs_plan_has_only_trusted_paths_and_node_permissions(self, tmp_path: Path) -> None:
        node = _executable(tmp_path, "node")
        runtime_root = tmp_path / "quickjs"
        runtime_root.mkdir()
        module = runtime_root / "index.mjs"
        module.write_text("export const fake = true", encoding="utf-8")
        adapter = QuickJsWasmAdapter(
            JavaScriptBundle(
                ExecutableSpec(node, (tmp_path,), frozenset({"node"}), 24),
                module,
                runtime_root,
            )
        )
        workspace = _workspace(tmp_path / "attempt")
        source = "const password = 'must-not-enter-argv'; result = 4;"
        plan = adapter.prepare(
            SandboxRequest(RuntimeKind.QUICKJS_WASM, source=source), workspace
        )
        assert plan.argv[0] == str(node.resolve())
        assert "--permission" in plan.argv
        assert "--disable-proto=throw" in plan.argv
        assert not any(source in argument for argument in plan.argv)
        assert dict(plan.environment) == {
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
            "TZ": "UTC",
            "SOURCE_DATE_EPOCH": "0",
            "PYTHONHASHSEED": "0",
        }
        request_payload = json.loads((workspace.control / "request.json").read_text())
        assert request_payload["seed"] == 0
        assert request_payload["timezone"] == "UTC"

    def test_wasi_plan_preopens_only_inputs_and_outputs(self, tmp_path: Path) -> None:
        wasmtime = _executable(tmp_path, "wasmtime")
        adapter = WasmtimeWasiAdapter(
            ExecutableSpec(wasmtime, (tmp_path,), frozenset({"wasmtime"}), 28)
        )
        request = SandboxRequest(
            RuntimeKind.WASMTIME_WASI,
            module=b"\x00asm\x01\x00\x00\x00",
            arguments=("one",),
            seed=7,
        )
        workspace = _workspace(tmp_path / "attempt")
        plan = adapter.prepare(request, workspace)
        assert f"--dir={workspace.inputs}::/inputs" in plan.argv
        assert f"--dir={workspace.outputs}::/outputs" in plan.argv
        assert "--env=ALYSTRIA_SEED=7" in plan.argv
        assert plan.argv[-2:] == ("--", "one")
        assert (workspace.control / "program.wasm").stat().st_mode & stat.S_IWUSR == 0

    def test_pyodide_uses_its_hardened_worker_and_not_host_python(self, tmp_path: Path) -> None:
        node = _executable(tmp_path, "node")
        runtime_root = tmp_path / "pyodide"
        runtime_root.mkdir()
        module = runtime_root / "pyodide.mjs"
        module.write_text("export const fake = true", encoding="utf-8")
        adapter = PyodideAdapter(
            JavaScriptBundle(
                ExecutableSpec(node, (tmp_path,), frozenset({"node"}), 24),
                module,
                runtime_root,
            )
        )
        workspace = _workspace(tmp_path / "attempt")
        plan = adapter.prepare(
            SandboxRequest(RuntimeKind.PYODIDE, source="result = 23"), workspace
        )
        assert plan.argv[0] == str(node.resolve())
        assert plan.argv[-3].endswith("pyodide_worker.mjs")
        assert all("python" not in Path(argument).name.casefold() for argument in plan.argv)

    def test_diagnostics_reject_old_or_untrusted_binary(self, tmp_path: Path) -> None:
        binary = _executable(tmp_path, "node")
        outside = tmp_path / "trusted"
        outside.mkdir()
        module = outside / "index.mjs"
        module.write_text("", encoding="utf-8")
        adapter = QuickJsWasmAdapter(
            JavaScriptBundle(
                ExecutableSpec(binary, (outside,), frozenset({"node"}), 24), module, outside
            )
        )
        diagnostic = adapter.diagnose(FakeRunner())
        assert not diagnostic.available
        assert any("outside trusted runtime roots" in issue for issue in diagnostic.issues)

    def test_diagnostics_reject_unsupported_node_version(self, tmp_path: Path) -> None:
        node = _executable(tmp_path, "node")
        runtime_root = tmp_path / "quickjs"
        runtime_root.mkdir()
        module = runtime_root / "index.mjs"
        module.write_text("", encoding="utf-8")
        adapter = QuickJsWasmAdapter(
            JavaScriptBundle(
                ExecutableSpec(node, (tmp_path,), frozenset({"node"}), 24),
                module,
                runtime_root,
            )
        )
        diagnostic = adapter.diagnose(FakeRunner(version="v22.14.0"))
        assert not diagnostic.available
        assert diagnostic.issues == ("runtime major 22 is below required 24",)


class TestSandboxExecutor:
    def _quickjs_executor(self, tmp_path: Path, runner: FakeRunner) -> SandboxExecutor:
        node = _executable(tmp_path, "node")
        runtime_root = tmp_path / "quickjs"
        runtime_root.mkdir()
        module = runtime_root / "index.mjs"
        module.write_text("export const fake = true", encoding="utf-8")
        return SandboxExecutor(
            (
                QuickJsWasmAdapter(
                    JavaScriptBundle(
                        ExecutableSpec(node, (tmp_path,), frozenset({"node"}), 24),
                        module,
                        runtime_root,
                    )
                ),
            ),
            runner=runner,
            temporary_root=tmp_path,
        )

    def test_normalizes_success_trace_value_and_ephemeral_outputs(self, tmp_path: Path) -> None:
        runner = FakeRunner(on_run=_success_envelope)
        executor = self._quickjs_executor(tmp_path, runner)
        result = executor.execute(
            SandboxRequest(RuntimeKind.QUICKJS_WASM, source="result = { index: 5 }", seed=19)
        )
        assert result.status is ExecutionStatus.SUCCEEDED
        assert result.stdout == "index = 5\n"
        assert result.value == {"index": 5}
        assert result.trace[0].variables == (("high", 8), ("low", 0), ("mid", 4))
        assert result.outputs[0].content == b"{}"
        assert result.outputs[0].sha256 == (
            "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"
        )
        assert not any(path.name.startswith("alystria-sandbox-") for path in tmp_path.iterdir())

    @pytest.mark.parametrize(
        ("reason", "expected"),
        [
            (TerminationReason.TIMED_OUT, ExecutionStatus.TIMED_OUT),
            (TerminationReason.CANCELLED, ExecutionStatus.CANCELLED),
            (TerminationReason.OUTPUT_LIMIT, ExecutionStatus.RESOURCE_EXHAUSTED),
            (TerminationReason.START_FAILED, ExecutionStatus.UNAVAILABLE),
        ],
    )
    def test_maps_outer_termination_without_accepting_partial_result(
        self, tmp_path: Path, reason: TerminationReason, expected: ExecutionStatus
    ) -> None:
        runner = FakeRunner(result=RawProcessResult(None, b"", b"", 50, reason, "boom"))
        executor = self._quickjs_executor(tmp_path, runner)
        result = executor.execute(SandboxRequest(RuntimeKind.QUICKJS_WASM, source="while(true){}"))
        assert result.status is expected
        assert result.value is None

    def test_cancelled_before_start_never_probes_or_runs(self, tmp_path: Path) -> None:
        runner = FakeRunner()
        executor = self._quickjs_executor(tmp_path, runner)
        cancellation = threading.Event()
        cancellation.set()
        result = executor.execute(
            SandboxRequest(RuntimeKind.QUICKJS_WASM, source="result = 1"),
            cancellation=cancellation,
        )
        assert result.status is ExecutionStatus.CANCELLED
        assert runner.probes == []
        assert runner.plans == []

    def test_unavailable_runtime_fails_closed(self, tmp_path: Path) -> None:
        runner = FakeRunner()
        executor = SandboxExecutor((), runner=runner, temporary_root=tmp_path)
        result = executor.execute(SandboxRequest(RuntimeKind.PYODIDE, source="result = 1"))
        assert result.status is ExecutionStatus.UNAVAILABLE
        assert runner.plans == []

    def test_malformed_worker_output_is_runtime_error(self, tmp_path: Path) -> None:
        def malformed(plan: ProcessPlan) -> None:
            assert plan.result_path is not None
            plan.result_path.write_text('{"protocolVersion": 999}', encoding="utf-8")

        executor = self._quickjs_executor(tmp_path, FakeRunner(on_run=malformed))
        result = executor.execute(SandboxRequest(RuntimeKind.QUICKJS_WASM, source="result = 1"))
        assert result.status is ExecutionStatus.RUNTIME_ERROR
        assert "protocol version" in result.diagnostics[0]

    def test_output_path_traversal_is_rejected(self, tmp_path: Path) -> None:
        def traversal(plan: ProcessPlan) -> None:
            assert plan.result_path is not None
            plan.result_path.write_text(
                json.dumps(
                    {
                        "protocolVersion": 1,
                        "ok": True,
                        "stdout": "",
                        "stderr": "",
                        "value": None,
                        "trace": [],
                        "outputs": [{"path": "../escape", "content": ""}],
                    }
                ),
                encoding="utf-8",
            )

        executor = self._quickjs_executor(tmp_path, FakeRunner(on_run=traversal))
        result = executor.execute(SandboxRequest(RuntimeKind.QUICKJS_WASM, source="result = 1"))
        assert result.status is ExecutionStatus.RUNTIME_ERROR
        assert "normalized relative" in result.diagnostics[0]

    def test_aggregate_output_limit_counts_value_trace_and_files(self, tmp_path: Path) -> None:
        def excessive(plan: ProcessPlan) -> None:
            assert plan.result_path is not None
            plan.result_path.write_text(
                json.dumps(
                    {
                        "protocolVersion": 1,
                        "ok": True,
                        "stdout": "12345678",
                        "stderr": "",
                        "value": "12345678",
                        "trace": [],
                        "outputs": [],
                    }
                ),
                encoding="utf-8",
            )

        executor = self._quickjs_executor(tmp_path, FakeRunner(on_run=excessive))
        result = executor.execute(
            SandboxRequest(
                RuntimeKind.QUICKJS_WASM,
                source="result = 1",
                limits=ExecutionLimits(output_bytes=12),
            )
        )
        assert result.status is ExecutionStatus.RESOURCE_EXHAUSTED
        assert "aggregate" in result.diagnostics[0]

    def test_wasi_trace_and_outputs_are_normalized(self, tmp_path: Path) -> None:
        wasmtime = _executable(tmp_path, "wasmtime")

        def write_output(plan: ProcessPlan) -> None:
            (plan.cwd / "outputs" / "answer.txt").write_text("5", encoding="utf-8")

        runner = FakeRunner(
            version="wasmtime 32.0.0",
            result=RawProcessResult(
                0,
                b"answer=5\n\x1eALYSTRIA_TRACE {\"kind\":\"result\",\"message\":\"found\"}\n",
                b"",
                12,
                TerminationReason.EXITED,
            ),
            on_run=write_output,
        )
        executor = SandboxExecutor(
            (
                WasmtimeWasiAdapter(
                    ExecutableSpec(wasmtime, (tmp_path,), frozenset({"wasmtime"}), 28)
                ),
            ),
            runner=runner,
            temporary_root=tmp_path,
        )
        result = executor.execute(
            SandboxRequest(RuntimeKind.WASMTIME_WASI, module=b"\x00asm\x01\x00\x00\x00")
        )
        assert result.status is ExecutionStatus.SUCCEEDED
        assert result.stdout == "answer=5\n"
        assert result.trace[0].message == "found"
        assert result.outputs[0].content == b"5"


def test_runtime_root_discovery_does_not_search_host_path(tmp_path: Path) -> None:
    executor = executor_from_runtime_root(tmp_path, runner=FakeRunner(), temporary_root=tmp_path)
    diagnostics = {item.runtime: item for item in executor.diagnose()}
    assert all(not item.available for item in diagnostics.values())
    assert diagnostics[RuntimeKind.WASMTIME_WASI].issues == ("Wasmtime is not configured",)
