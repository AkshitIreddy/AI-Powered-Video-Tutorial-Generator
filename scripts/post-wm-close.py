"""Post WM_CLOSE to every top-level window owned by a Windows process."""

from __future__ import annotations

import argparse
import ctypes


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pid", required=True, type=int)
    options = parser.parse_args()
    if options.pid < 1:
        raise ValueError("pid must be positive")

    wm_close = 0x0010
    closed = 0
    callback_type = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

    @callback_type
    def visit(window: int, _: int) -> bool:
        nonlocal closed
        owner = ctypes.c_ulong()
        ctypes.windll.user32.GetWindowThreadProcessId(window, ctypes.byref(owner))
        if owner.value == options.pid:
            if ctypes.windll.user32.PostMessageW(window, wm_close, 0, 0):
                closed += 1
        return True

    if not ctypes.windll.user32.EnumWindows(visit, 0):
        raise ctypes.WinError()
    print(closed)
    return 0 if closed else 2


if __name__ == "__main__":
    raise SystemExit(main())
