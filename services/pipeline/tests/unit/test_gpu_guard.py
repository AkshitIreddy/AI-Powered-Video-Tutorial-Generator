from __future__ import annotations

import os
import subprocess
import sys
import threading
import uuid
from pathlib import Path

import pytest

import alystria.gpu_guard as gpu_guard_module
from alystria.gpu_guard import (
    GPU_LOCK_PATH_ENV,
    GPU_TEMP_DIR_ENV,
    GpuExecutionGuard,
    GpuGuardBusyError,
    GpuGuardPolicyError,
)


def _child_environment() -> dict[str, str]:
    environment = os.environ.copy()
    source_root = str(Path(__file__).resolve().parents[2] / "src")
    environment["PYTHONPATH"] = os.pathsep.join(
        item for item in (source_root, environment.get("PYTHONPATH", "")) if item
    )
    return environment


def _run_child(script: str, marker: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        (sys.executable, "-c", script, str(marker)),
        cwd=Path(__file__).resolve().parents[2],
        env=_child_environment(),
        stdin=subprocess.DEVNULL,
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
        creationflags=int(getattr(subprocess, "CREATE_NO_WINDOW", 0)),
    )


def test_guard_holds_real_cross_process_writer_ownership_but_allows_readers(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "gpu use.txt"
    marker.write_text("no\n", encoding="utf-8")
    child = """
import sys
from pathlib import Path
from alystria.gpu_guard import GpuExecutionGuard, GpuGuardBusyError
try:
    with GpuExecutionGuard(Path(sys.argv[1]), owner='child'):
        pass
except GpuGuardBusyError:
    raise SystemExit(23)
raise SystemExit(0)
"""

    with GpuExecutionGuard(marker, owner="parent"):
        assert marker.read_text(encoding="utf-8") == "yes\n"
        result = _run_child(child, marker)
        assert result.returncode == 23, (result.stdout, result.stderr)
        assert marker.read_text(encoding="utf-8") == "yes\n"

    assert marker.read_text(encoding="utf-8") == "no\n"


def test_guard_releases_owned_marker_on_failure_and_never_resets_foreign_yes(
    tmp_path: Path,
) -> None:
    marker = tmp_path / "gpu use.txt"
    marker.write_text("no\n", encoding="utf-8")
    with (
        pytest.raises(RuntimeError, match="runner failed"),
        GpuExecutionGuard(marker, owner="failing-runner"),
    ):
        assert marker.read_text(encoding="utf-8") == "yes\n"
        raise RuntimeError("runner failed")
    assert marker.read_text(encoding="utf-8") == "no\n"

    marker.write_text("yes\n", encoding="utf-8")
    with (
        pytest.raises(GpuGuardBusyError, match="verify the previous workload"),
        GpuExecutionGuard(marker, owner="must-not-reset"),
    ):
        raise AssertionError("unreachable")
    assert marker.read_text(encoding="utf-8") == "yes\n"


def test_abrupt_process_exit_leaves_conservative_stale_claim(tmp_path: Path) -> None:
    marker = tmp_path / "gpu use.txt"
    marker.write_text("no\n", encoding="utf-8")
    child = """
import os
import sys
from pathlib import Path
from alystria.gpu_guard import GpuExecutionGuard
with GpuExecutionGuard(Path(sys.argv[1]), owner='crashing-child'):
    os._exit(0)
"""

    result = _run_child(child, marker)

    assert result.returncode == 0, (result.stdout, result.stderr)
    assert marker.read_text(encoding="utf-8") == "yes\n"
    with pytest.raises(GpuGuardBusyError, match="verify the previous workload"):
        GpuExecutionGuard(marker, owner="recovery-without-human").__enter__()


def test_declared_named_mutex_excludes_another_thread_before_marker_claim(
    tmp_path: Path,
) -> None:
    first_marker = tmp_path / "first gpu use.txt"
    second_marker = tmp_path / "second gpu use.txt"
    first_marker.write_text("no\n", encoding="utf-8")
    second_marker.write_text("no\n", encoding="utf-8")
    mutex_name = f"alystria-test-gpu-{uuid.uuid4().hex}"
    outcome: list[BaseException] = []

    def contend() -> None:
        try:
            with GpuExecutionGuard(
                second_marker,
                mutex_name=mutex_name,
                owner="contender",
            ):
                raise AssertionError("contender acquired owned mutex")
        except BaseException as error:
            outcome.append(error)

    with GpuExecutionGuard(first_marker, mutex_name=mutex_name, owner="owner"):
        thread = threading.Thread(target=contend)
        thread.start()
        thread.join(timeout=10)
        assert not thread.is_alive()

    assert len(outcome) == 1
    assert isinstance(outcome[0], GpuGuardBusyError)
    assert second_marker.read_text(encoding="utf-8") == "no\n"
    assert first_marker.read_text(encoding="utf-8") == "no\n"


def test_guard_rejects_unknown_or_indirect_marker_state(tmp_path: Path) -> None:
    unknown = tmp_path / "unknown.txt"
    unknown.write_text("maybe\n", encoding="utf-8")
    with pytest.raises(GpuGuardPolicyError, match="exactly yes or no"):
        GpuExecutionGuard(unknown, owner="unknown").__enter__()
    assert unknown.read_text(encoding="utf-8") == "maybe\n"

    target = tmp_path / "target.txt"
    target.write_text("no\n", encoding="utf-8")
    link = tmp_path / "link.txt"
    try:
        link.symlink_to(target)
    except OSError:
        pytest.skip("This host does not permit unprivileged symlink creation")
    with pytest.raises(GpuGuardPolicyError, match="reparse point"):
        GpuExecutionGuard(link, owner="symlink").__enter__()
    assert target.read_text(encoding="utf-8") == "no\n"

    real_parent = tmp_path / "real-parent"
    real_parent.mkdir()
    (real_parent / "gpu use.txt").write_text("no\n", encoding="utf-8")
    linked_parent = tmp_path / "linked-parent"
    linked_parent.symlink_to(real_parent, target_is_directory=True)
    with pytest.raises(GpuGuardPolicyError, match="reparse point"):
        GpuExecutionGuard(linked_parent / "gpu use.txt", owner="ancestor-link").__enter__()


def test_guard_creates_one_desktop_temp_fallback_without_overwriting_explicit_state(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv(GPU_LOCK_PATH_ENV, raising=False)
    monkeypatch.setenv(GPU_TEMP_DIR_ENV, str(tmp_path))

    with GpuExecutionGuard(owner="fallback-owner") as guard:
        marker = guard.marker_path
        assert marker.parent == tmp_path
        assert marker.read_text(encoding="utf-8") == "yes\n"
    assert marker.read_text(encoding="utf-8") == "no\n"

    missing_explicit = tmp_path / "missing" / "gpu use.txt"
    monkeypatch.setenv(GPU_LOCK_PATH_ENV, str(missing_explicit))
    with pytest.raises(GpuGuardPolicyError, match="missing ancestor"):
        GpuExecutionGuard(owner="explicit-must-not-fallback").__enter__()
    assert marker.read_text(encoding="utf-8") == "no\n"


def test_preserved_claim_stays_busy_after_unresolved_process(tmp_path: Path) -> None:
    marker = tmp_path / "gpu use.txt"
    marker.write_text("no\n", encoding="utf-8")

    with GpuExecutionGuard(marker, owner="uncertain-process") as guard:
        guard.preserve_claim()

    assert marker.read_text(encoding="utf-8") == "yes\n"
    with pytest.raises(GpuGuardBusyError, match="verify the previous workload"):
        GpuExecutionGuard(marker, owner="next-process").__enter__()


def test_marker_close_failure_still_releases_every_named_mutex(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    events: list[str] = []

    class Marker:
        def read(self) -> bytes:
            return b"no\n"

        def write(self, value: bytes) -> None:
            events.append(f"write:{value.decode().strip()}")

        def close(self) -> None:
            events.append("marker-close")
            raise OSError("marker close failed")

    class Mutex:
        def close(self) -> None:
            events.append("mutex-close")

    marker_path = tmp_path / "gpu use.txt"
    marker_path.write_text("no\n", encoding="utf-8")
    monkeypatch.setattr(gpu_guard_module, "_open_marker", lambda _path: Marker())
    monkeypatch.setattr(gpu_guard_module, "_acquire_named_mutex", lambda _name: Mutex())
    guard = GpuExecutionGuard(marker_path, owner="cleanup-test")
    guard.__enter__()

    with pytest.raises(OSError, match="marker close failed"):
        guard.__exit__(None, None, None)

    assert events[-3:] == ["write:no", "marker-close", "mutex-close"]
