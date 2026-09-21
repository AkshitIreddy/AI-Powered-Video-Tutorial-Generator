export function summarizeNativeWindowPlacement(recordingWindow) {
  const win32 = recordingWindow?.win32;
  const monitor = win32?.selectedMonitor;
  const monitors = win32?.monitors;
  const visible = recordingWindow?.visibilityState === "visible";
  if (!win32 || win32.contained !== true || !monitor || typeof monitor.primary !== "boolean"
    || typeof monitor.deviceName !== "string" || !monitor.deviceName.trim()
    || !Array.isArray(monitors) || monitors.length < 1) {
    throw new Error("Native window placement receipt is incomplete or not contained in its selected display");
  }
  const selectedDisplay = {
    deviceName: monitor.deviceName,
    primary: monitor.primary,
    workArea: monitor.workArea,
  };
  return {
    visibleNativeWindow: visible,
    windowContainedInSelectedMonitor: true,
    visibleSecondaryMonitorWindow: visible && monitor.primary === false,
    visiblePrimaryMonitorWindow: visible && monitor.primary === true,
    placementMode: monitor.primary
      ? monitors.length === 1 ? "primary-only-display" : "primary-display"
      : "secondary-display",
    monitorCount: monitors.length,
    selectedDisplay,
  };
}
