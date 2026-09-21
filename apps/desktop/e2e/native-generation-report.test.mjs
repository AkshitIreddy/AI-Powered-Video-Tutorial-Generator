import assert from "node:assert/strict";
import test from "node:test";

import { summarizeNativeWindowPlacement } from "./native-generation-report.mjs";

test("reports the actual contained primary-only fallback without claiming a secondary monitor", () => {
  const receipt = placementReceipt({ primary: true, monitors: 1 });
  const summary = summarizeNativeWindowPlacement(receipt);
  assert.equal(summary.visibleNativeWindow, true);
  assert.equal(summary.visiblePrimaryMonitorWindow, true);
  assert.equal(summary.visibleSecondaryMonitorWindow, false);
  assert.equal(summary.placementMode, "primary-only-display");
  assert.equal(summary.monitorCount, 1);
  assert.equal(summary.selectedDisplay.deviceName, "\\\\.\\DISPLAY5");
});

test("reports a contained non-primary placement as a secondary window", () => {
  const receipt = placementReceipt({ primary: false, monitors: 2 });
  const summary = summarizeNativeWindowPlacement(receipt);
  assert.equal(summary.visiblePrimaryMonitorWindow, false);
  assert.equal(summary.visibleSecondaryMonitorWindow, true);
  assert.equal(summary.placementMode, "secondary-display");
  assert.equal(summary.monitorCount, 2);
});

test("rejects an uncontained or incomplete placement receipt", () => {
  const receipt = placementReceipt({ primary: false, monitors: 2 });
  receipt.win32.contained = false;
  assert.throws(() => summarizeNativeWindowPlacement(receipt), /incomplete or not contained/);
});

function placementReceipt({ primary, monitors }) {
  const selectedMonitor = {
    primary,
    deviceName: "\\\\.\\DISPLAY5",
    workArea: { left: 0, top: 0, right: 3440, bottom: 1440, width: 3440, height: 1440 },
  };
  return {
    visibilityState: "visible",
    captureViewport: { width: 2320, height: 1305 },
    win32: {
      contained: true,
      selectedMonitor,
      monitors: Array.from({ length: monitors }, (_, index) => index === 0 ? selectedMonitor : {
        primary: true,
        deviceName: "\\\\.\\DISPLAY1",
        workArea: { left: 0, top: 0, right: 2560, bottom: 1600, width: 2560, height: 1600 },
      }),
    },
  };
}
